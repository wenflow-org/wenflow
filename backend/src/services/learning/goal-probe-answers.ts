/**
 * 前置自测（quick probes）作答的确定性合并 —— 2026-11-02 业务口径梳理。
 *
 * 旧链路（已废除）：每答一题就当成一条对话消息发给模型，走一个**完整回合**，由模型回填
 * `understanding.prerequisiteCheckResults`。两题场景实测卡住：答第 1 题 → 面板全部按钮
 * 禁用、等 30-90s → 方案重渲染（题目可能少一道/换题）→ 才能答第 2 题。
 *
 * 新链路：自测是「方案确认前的一张表单」——面板内本地作答（可改），点「确认，生成我的路径」
 * 时随确认请求一次性提交。本模块负责确定性合并与判分（判分键取
 * `confirmedProposal.prerequisiteDiagnostics[].correctOption`，不依赖模型读消息、不依赖模型判分）。
 */
import type { PrerequisiteCheckResultShape } from './learner-load-profile';

export interface ProbeAnswerInput {
  probeId: string;
  userAnswer: string;
  targetConcept?: string;
}

/** 一次确认最多收多少条作答（题目数上限 1-3，留余量；同时挡住超大数组） */
const MAX_PROBE_ANSWERS = 10;

function trimString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 请求体 → 规范化作答（丢弃空项/重复题号/超长字段），probeId 与 userAnswer 必填 */
export function normalizeProbeAnswerInput(raw: unknown): ProbeAnswerInput[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProbeAnswerInput[] = [];
  for (const item of raw.slice(0, MAX_PROBE_ANSWERS)) {
    if (!item || typeof item !== 'object') continue;
    const probeId = trimString((item as Record<string, unknown>).probeId, 80);
    const userAnswer = trimString((item as Record<string, unknown>).userAnswer, 16);
    if (!probeId || !userAnswer || seen.has(probeId)) continue;
    seen.add(probeId);
    const targetConcept = trimString((item as Record<string, unknown>).targetConcept, 80);
    out.push({ probeId, userAnswer, ...(targetConcept ? { targetConcept } : {}) });
  }
  return out;
}

/** 方案/理解块的松散 JSON 形态（模型产出，字段不保证齐全） */
type JsonRecord = Record<string, unknown>;
/** confirmedProposal.prerequisiteDiagnostics 的单题形态：只读三个可能用到的字段 */
interface DiagnosticProbe {
  probeId?: unknown;
  targetConcept?: unknown;
  correctOption?: unknown;
}

function diagnosticsOf(confirmedProposal: unknown): DiagnosticProbe[] {
  if (!confirmedProposal || typeof confirmedProposal !== 'object') return [];
  const source = confirmedProposal as JsonRecord;
  const raw = source.prerequisiteDiagnostics ?? source.prerequisite_diagnostics;
  return Array.isArray(raw) ? (raw as DiagnosticProbe[]) : [];
}

/**
 * 把作答合并进 `understanding.prerequisiteCheckResults`。
 *
 * - 只认 `confirmedProposal.prerequisiteDiagnostics` 里真实存在的 probeId（旧面板/伪造题号直接丢弃）；
 * - 同名 probeId 以本次作答覆盖（用户改选），其它历史结果保留；
 * - `isCorrect` 只在出题方给了 `correctOption` 时确定性给出（无键则不写，交给下游按未知处理）。
 *
 * 两个入参按 `unknown` 收：它们来自模型 JSON / 会话快照，调用方（service）里的静态类型就是 unknown。
 */
export function mergeProbeAnswersIntoUnderstanding(
  understanding: unknown,
  confirmedProposal: unknown,
  answers: ProbeAnswerInput[],
): JsonRecord {
  const base: JsonRecord = understanding && typeof understanding === 'object' ? (understanding as JsonRecord) : {};
  if (answers.length === 0) return base;

  const probeById = new Map<string, DiagnosticProbe>();
  for (const probe of diagnosticsOf(confirmedProposal)) {
    if (probe && typeof probe.probeId === 'string' && probe.probeId.trim()) {
      probeById.set(probe.probeId.trim(), probe);
    }
  }

  const byId = new Map<string, PrerequisiteCheckResultShape>();
  const existing = Array.isArray(base.prerequisiteCheckResults) ? base.prerequisiteCheckResults : [];
  for (const row of existing) {
    if (row && typeof row === 'object' && typeof row.probeId === 'string') byId.set(row.probeId, row);
  }

  for (const answer of answers) {
    const probe = probeById.get(answer.probeId);
    if (!probe) continue;
    const correctOption = trimString(probe.correctOption, 16);
    const targetConcept = answer.targetConcept || trimString(probe.targetConcept, 80);
    byId.set(answer.probeId, {
      probeId: answer.probeId,
      ...(targetConcept ? { targetConcept } : {}),
      userAnswer: answer.userAnswer,
      ...(correctOption ? { isCorrect: answer.userAnswer === correctOption } : {}),
    });
  }

  return {
    ...base,
    prerequisiteCheckResults: Array.from(byId.values()).slice(0, MAX_PROBE_ANSWERS * 2),
  };
}