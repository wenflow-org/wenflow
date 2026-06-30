/**
 * Prompt Compiler — 重写 ## 输入说明 段
 * ============================================================
 * 输入: PromptBlock (section='input') + routing 表中标记为 input role 的字段列表
 * 输出: 新的块 body, 用 routing 表数据重写其中的 ```json``` 示例;
 *       保留段内所有 prose bullet 和 IN-XX 编号规则.
 *
 * 算法不变量:
 *   - 仅替换 ```json``` 块, 其它一字不动
 *   - 如果 routing 中没有 input 角色字段, 返回原 body (不空写 json)
 *   - 写入的 json 用 inputFields 路径作 key, valueType 作占位 (含 notes)
 *   - 嵌套路径 (a.b.c) 暂时不展开, 按顶层路径写
 *
 * 注: 当前 routing 表里 promptRole 的 input 类对应:
 *   - 'input-required' / 'input-optional' / 形如 'input-*'
 * 但实际 P-COMPILE.0 阶段 routing 表里基本没有 input 角色字段 (都是 output 角色),
 * 所以这个函数在 MVP 阶段大多 no-op 返回原 body, 这是可接受的.
 */

import type { PromptBlock } from '../prompt-schema';
import type { FieldRoutingRow } from '../field-dispatcher';

/**
 * 判定 routing row 是否属于 input 角色
 */
function isInputRole(role: string | undefined): boolean {
  if (!role) return false;
  // 当前协议保留扩展性: 任何以 input- 开头的角色都算输入字段
  return role.startsWith('input-') || role === 'input';
}

export interface RewriteInputResult {
  body: string;
  rewritten: boolean;
  fieldsApplied: number;
}

/**
 * 重写输入段
 *
 * @param block PromptBlock (section='input')
 * @param routings 该 agent 的全部 routing 行
 * @returns 新 body + 是否实际重写 + 应用的字段数
 */
export function rewriteInputSection(
  block: PromptBlock,
  routings: FieldRoutingRow[]
): RewriteInputResult {
  if (block.section !== 'input') {
    return { body: block.body, rewritten: false, fieldsApplied: 0 };
  }

  const inputRows = routings.filter((r) => isInputRole(r.promptRole));
  if (inputRows.length === 0) {
    // routing 表里没有 input 字段 — no-op, 保留源 body
    return { body: block.body, rewritten: false, fieldsApplied: 0 };
  }

  // 找到 ```json``` 块, 用 routing 数据替换
  const fenceRe = /```json\s*\n([\s\S]*?)```/;
  const m = block.body.match(fenceRe);
  if (!m) {
    // 源里没有 json 示例 (C0 后理论上 22/22 都有, 但兜底), 不主动插入
    return { body: block.body, rewritten: false, fieldsApplied: 0 };
  }

  // 构造新 json: 按 fieldId 排序, valueType + notes 作占位说明
  const fields = [...inputRows].sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  const jsonLines: string[] = ['{'];
  fields.forEach((f, i) => {
    const typeHint = f.valueType || 'any';
    const noteText = f.notes ? ` — ${f.notes}` : '';
    const comma = i < fields.length - 1 ? ',' : '';
    jsonLines.push(`  ${JSON.stringify(f.fieldId)}: ${JSON.stringify(`${typeHint}${noteText}`)}${comma}`);
  });
  jsonLines.push('}');
  const newJsonBlock = '```json\n' + jsonLines.join('\n') + '\n```';

  const newBody = block.body.replace(fenceRe, newJsonBlock);
  return { body: newBody, rewritten: true, fieldsApplied: fields.length };
}
