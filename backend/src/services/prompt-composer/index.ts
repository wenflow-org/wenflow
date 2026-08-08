/**
 * Prompt Template Composer (V3 §6 P1.5)
 * ============================================================
 * 从 orchestrator_field_routings 表渲染一段「字段路由 supplement」，
 * 拼到 skill 的 system prompt 末尾。
 *
 * 设计原则：
 *   1. 不替换原 prompt 主体（避免一次性大改）
 *   2. 只追加一段"运行时字段契约"，admin 改路由会立即生效
 *   3. supplement 的 promptRole 分组：
 *      - hard-required → "必填字段"
 *      - soft-info → "可选信息字段"
 *      - hidden-inference → "隐藏推断（不要展示给用户）"
 *      - public-reply → "面向用户的回复字段"
 *      - proposal-output → "方向方案产物"
 *      - control-signal → "控制信号"
 *   4. render: hidden 的字段，supplement 中明确写"不在用户可见输出中暴露"
 */

import {
  getAgentRoutings,
  type FieldRoutingRow,
} from '../field-dispatcher';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

const SUPPLEMENT_BANNER = '═══ 字段路由 SUPPLEMENT（运行时由路由表自动渲染，admin 可调）═══';
const SUPPLEMENT_END_BANNER = '═══ SUPPLEMENT 结束 ═══';

// supplement 渲染缓存：路由表经 field-dispatcher 30s TTL 缓存，渲染文本与之同周期缓存，
// 避免每轮对话重复拼接；admin 改表后最多 30s 生效（与路由表缓存一致）。
const SUPPLEMENT_RENDER_TTL_MS = 30_000;
interface SupplementRenderCacheEntry {
  loadedAt: number;
  text: string;
  fieldsCovered: number;
  routingHash: string | null;
}
const supplementRenderCache = new Map<string, SupplementRenderCacheEntry>();

/**
 * 路由快照指纹：由路由行关键字段（fieldId/promptRole/valueType/pathInRawOutput/handoff）
 * 确定性导出。用于：
 *  - supplement 渲染缓存 key
 *  - prompt_call_logs.routingContextHash（admin 改表后 hash 变化，版本归因可见）
 */
export async function getRoutingSnapshotHash(agentId: string): Promise<string | null> {
  try {
    const rows = await getAgentRoutings(agentId);
    if (!rows.length) return null;
    const snapshot = rows
      .map((r) => ({
        fieldId: r.fieldId,
        promptRole: r.promptRole || null,
        valueType: r.valueType || null,
        pathInRawOutput: r.pathInRawOutput || null,
        handoff: [...(r.handoff || [])].sort(),
        render: r.render,
        internal: r.internal,
        accumulate: r.accumulate,
      }))
      .sort((a, b) => (a.fieldId < b.fieldId ? -1 : 1));
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

const ROLE_GROUP_LABELS: Record<string, string> = {
  'hard-required': '【必填字段（缺一不进 proposing）】',
  'soft-info': '【可选信息字段（不阻止收敛，但有最好填）】',
  'hidden-inference': '【隐藏推断字段（仅做内部累积，不要展示给用户）】',
  'proposal-output': '【方向方案产物（proposing 阶段输出）】',
  'public-reply': '【面向用户的回复字段】',
  'derived-presentation': '【派生展示字段（系统派生，仅供前端展示）】',
  'control-signal': '【控制信号（驱动状态机）】',
};

const ROLE_DISPLAY_ORDER: Array<keyof typeof ROLE_GROUP_LABELS> = [
  'hard-required',
  'soft-info',
  'hidden-inference',
  'proposal-output',
  'public-reply',
  'derived-presentation',
  'control-signal',
];

interface RoutingGroupItem {
  fieldId: string;
  render: 'visible' | 'hidden';
  internal: boolean;
  accumulate: boolean;
  handoff: string[];
  notes?: string | null;
  valueType?: string;
}

function groupRoutings(rows: FieldRoutingRow[]): Map<string, RoutingGroupItem[]> {
  const map = new Map<string, RoutingGroupItem[]>();
  for (const r of rows) {
    const role = r.promptRole || 'unknown';
    if (!map.has(role)) map.set(role, []);
    map.get(role)!.push({
      fieldId: r.fieldId,
      render: r.render,
      internal: r.internal,
      accumulate: r.accumulate,
      handoff: r.handoff || [],
      notes: r.notes,
      valueType: r.valueType,
    });
  }
  return map;
}

function renderRoutingItem(item: RoutingGroupItem): string {
  const tags: string[] = [];
  if (item.render === 'hidden') tags.push('hidden');
  if (item.internal) tags.push('internal');
  if (item.accumulate) tags.push('累积到 learnerProfile');
  if (item.handoff.length) tags.push(`移交→${item.handoff.join('/')}`);
  const tagStr = tags.length ? ` [${tags.join('，')}]` : '';
  const typeStr = item.valueType ? `（${item.valueType}）` : '';
  const noteStr = item.notes ? ` —— ${item.notes}` : '';
  return `  • ${item.fieldId}${typeStr}${tagStr}${noteStr}`;
}

/**
 * 渲染 supplement 文本
 */
export function renderSupplementText(
  rows: FieldRoutingRow[]
): { text: string; fieldsCovered: number } {
  if (!rows.length) {
    return { text: '', fieldsCovered: 0 };
  }
  const groups = groupRoutings(rows);
  const lines: string[] = [];
  lines.push('');
  lines.push(SUPPLEMENT_BANNER);
  lines.push('');
  lines.push('以下是平台「字段路由表」当前的契约。请严格遵守：');
  lines.push('  - 必填字段：不可缺失，缺则强制回退到 understanding 阶段');
  lines.push('  - 隐藏字段：可在内部状态里推断累积，但不要在面向用户的回复中明文展示');
  lines.push('  - 控制信号：必须按枚举/范围给出');
  lines.push('');

  for (const role of ROLE_DISPLAY_ORDER) {
    const items = groups.get(role);
    if (!items?.length) continue;
    lines.push(ROLE_GROUP_LABELS[role]);
    for (const item of items) {
      lines.push(renderRoutingItem(item));
    }
    lines.push('');
  }

  lines.push('【输出 JSON 必须包含的顶层结构】');
  lines.push('  - reply (string)：面向用户的自然语言回复');
  lines.push('  - state.stage / state.confidence / state.done：控制信号');
  lines.push('  - understanding：所有 understanding.* 字段（包括 hidden 的，仅状态层使用）');
  lines.push('  - confirmedProposal：proposal-output 字段（proposing/ready 阶段）');
  lines.push('  - next_questions / quick_replies：public-reply 字段');
  lines.push('');
  lines.push(SUPPLEMENT_END_BANNER);

  return { text: lines.join('\n'), fieldsCovered: rows.length };
}

/**
 * 把 supplement 拼到 system prompt 末尾
 */
export async function composePromptFromAgentRouting(
  agentId: string,
  basePrompt: string
): Promise<{
  finalPrompt: string;
  supplementApplied: boolean;
  fieldsCovered: number;
}> {
  try {
    const now = Date.now();
    const cached = supplementRenderCache.get(agentId);
    if (!cached || now - cached.loadedAt >= SUPPLEMENT_RENDER_TTL_MS) {
      const rows = await getAgentRoutings(agentId);
      const routingHash = await getRoutingSnapshotHash(agentId);
      const { text, fieldsCovered } = renderSupplementText(rows);
      supplementRenderCache.set(agentId, {
        loadedAt: now,
        text,
        fieldsCovered,
        routingHash,
      });
    }
    const entry = supplementRenderCache.get(agentId)!;
    if (!entry.text) {
      return { finalPrompt: basePrompt, supplementApplied: false, fieldsCovered: 0 };
    }
    // 防御：如果 basePrompt 已经包含 supplement banner，先剥掉再追加，避免叠加
    const cleaned = stripExistingSupplement(basePrompt);
    return {
      finalPrompt: `${cleaned}\n${entry.text}`,
      supplementApplied: true,
      fieldsCovered: entry.fieldsCovered,
    };
  } catch (err) {
    logger.warn('[prompt-composer] failed to compose supplement', {
      agentId,
      error: (err as Error).message,
    });
    return { finalPrompt: basePrompt, supplementApplied: false, fieldsCovered: 0 };
  }
}

/** 测试/管理端用：清空 supplement 渲染缓存 */
export function clearSupplementRenderCache(agentId?: string): void {
  if (agentId) {
    supplementRenderCache.delete(agentId);
  } else {
    supplementRenderCache.clear();
  }
}

/**
 * 剥掉已有的 supplement 段（如果之前 prompt 里被人手贴过）
 */
export function stripExistingSupplement(prompt: string): string {
  if (!prompt.includes(SUPPLEMENT_BANNER)) return prompt;
  const idx = prompt.indexOf(SUPPLEMENT_BANNER);
  return prompt.slice(0, idx).trimEnd();
}

/**
 * Feature flag
 */
export function isPromptSupplementEnabled(): boolean {
  const v = process.env.WENFLOW_PROMPT_SUPPLEMENT;
  if (typeof v !== 'string') return true;
  const lo = v.trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(lo);
}

/**
 * 测试用：返回 routing supplement 文本（方便 admin 在管理面板看到当前 supplement）
 */
export async function previewSupplementForAgent(agentId: string): Promise<{
  text: string;
  fieldsCovered: number;
}> {
  const rows = await getAgentRoutings(agentId);
  return renderSupplementText(rows);
}
