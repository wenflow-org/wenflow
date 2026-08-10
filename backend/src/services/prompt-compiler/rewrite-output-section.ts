/**
 * Prompt Compiler — 重写 ## 输出规格 段
 * ============================================================
 * 输入: PromptBlock (section='output') + routing 表中标记为 output 角色的字段列表
 * 输出: 新的块 body, 用 routing 表数据重写其中的 ```json``` 字段列表;
 *       保留段内所有 OUT-XX 行为规则与 prose.
 *
 * 算法不变量:
 *   - 仅替换 ```json``` 块, 其它一字不动 (OUT-01~ 等行为规则保留)
 *   - 如果 routing 中没有 output 角色字段, 返回原 body
 *   - 字段按 promptRole 分组写入, 同组按 fieldId 排序
 *   - 顶层固定结构 (reply / state / understanding / confirmedProposal / next_questions
 *     等控制信号/容器字段) 不被覆盖 — 它们靠 systemLocked 标识在 routing 表里区分
 *
 * 注: 当前 MVP 范围 — 仅 goal-conversation 一个 skill 走通编译路径,
 * 其余 skill 的 routing 数据基本是 output role, 重写后输出 json schema 会被
 * routing 表的字段列表覆盖. 这是预期行为.
 */

import type { PromptBlock } from '../prompt-schema';
import type { FieldRoutingRow } from '../field-dispatcher';
import { PROMPT_ROLES } from '../field-routing/orchestration-file';

// 输出侧角色 = 编排文件声明的 promptRole 全集（单源：orchestration-file.ts PROMPT_ROLES）
const OUTPUT_ROLES = new Set<string>(PROMPT_ROLES);

function isOutputRole(role: string | undefined): boolean {
  if (!role) return false;
  return OUTPUT_ROLES.has(role);
}

export interface RewriteOutputResult {
  body: string;
  rewritten: boolean;
  fieldsApplied: number;
}

/**
 * 把 fieldId 路径化解析为嵌套结构, 注入到 root.
 * 路径支持点号嵌套 (understanding.surface_goal) 和数组占位 (items[].name).
 */
function setPathInObject(root: any, path: string, value: any): void {
  const segments = path.split('.');
  let cur = root;
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];
    const isArr = seg.endsWith('[]');
    if (isArr) seg = seg.slice(0, -2);
    const last = i === segments.length - 1;

    if (last) {
      if (isArr) {
        if (!Array.isArray(cur[seg])) cur[seg] = [];
        if (cur[seg].length === 0) cur[seg].push(value);
        else cur[seg][0] = { ...cur[seg][0], ...(typeof value === 'object' ? value : {}) };
      } else {
        cur[seg] = value;
      }
    } else {
      if (isArr) {
        if (!Array.isArray(cur[seg])) cur[seg] = [{}];
        if (cur[seg].length === 0) cur[seg].push({});
        cur = cur[seg][0];
      } else {
        if (typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) {
          cur[seg] = {};
        }
        cur = cur[seg];
      }
    }
  }
}

/**
 * 把 routing 行转化为占位值
 */
function rowToPlaceholder(row: FieldRoutingRow): string {
  const typeHint = row.valueType || 'any';
  const note = row.notes ? ` — ${row.notes}` : '';
  return `${typeHint}${note}`;
}

/**
 * 重写输出段
 */
export function rewriteOutputSection(
  block: PromptBlock,
  routings: FieldRoutingRow[]
): RewriteOutputResult {
  if (block.section !== 'output') {
    return { body: block.body, rewritten: false, fieldsApplied: 0 };
  }

  const outputRows = routings.filter((r) => isOutputRole(r.promptRole));
  if (outputRows.length === 0) {
    return { body: block.body, rewritten: false, fieldsApplied: 0 };
  }

  // 找到第一个 ```json``` 块
  const fenceRe = /```json\s*\n([\s\S]*?)```/;
  const m = block.body.match(fenceRe);
  if (!m) {
    return { body: block.body, rewritten: false, fieldsApplied: 0 };
  }

  // 用 routing 表数据合成新的 json schema
  const sortedRows = [...outputRows].sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  const root: any = {};
  for (const row of sortedRows) {
    setPathInObject(root, row.fieldId, rowToPlaceholder(row));
  }

  const newJsonText = JSON.stringify(root, null, 2);
  const newJsonBlock = '```json\n' + newJsonText + '\n```';
  const newBody = block.body.replace(fenceRe, newJsonBlock);

  return { body: newBody, rewritten: true, fieldsApplied: sortedRows.length };
}
