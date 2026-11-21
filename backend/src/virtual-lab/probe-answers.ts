/**
 * 前置自测（quick probes）在虚拟实验室里的作答规划 —— 2026-11-21。
 *
 * 背景：真实链路的前置自测是「方案确认前的一张表单」，作答随确认请求的 `probeAnswers`
 * 一次性提交，服务端按 `confirmedProposal.prerequisiteDiagnostics[].correctOption` 确定性判分
 * （见 services/learning/goal-probe-answers.ts）。虚拟实验室此前只发 `confirmProposal`，
 * 从不提交作答，导致「前置答对/答错 → path-planning 跳过或补前置」这条链完全测不到。
 *
 * 本模块只做两件事：
 *   1) 从方案里抽出探测题（含判分键，只进旁路诊断，不回流学习者）；
 *   2) 按学习者画像的 struggleConcepts 生成一份确定性的作答计划：
 *      - 命中已知卡点 → 故意选一个错误项（演一个真实的前置缺口）；
 *      - 未命中 → 选正确项（演一个基础够用的学习者）。
 * 不随机：同一画像/同一题得到同一答案，便于复现与对账。
 */

export interface ProbePrompt {
  probeId: string;
  targetConcept?: string;
  question?: string;
  options: Array<{ id: string; text?: string }>;
  /** 判分键；只给模拟编排层用，不得进入学习者可见上下文 */
  correctOption?: string;
}

export interface ProbeAnswer {
  probeId: string;
  targetConcept?: string;
  userAnswer: string;
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeOptions(raw: unknown): Array<{ id: string; text?: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; text?: string }> = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const id = text(item, 40);
      if (id) out.push({ id, text: id });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = text(record.id, 40);
    if (!id) continue;
    const label = text(record.text, 200);
    out.push({ id, ...(label ? { text: label } : {}) });
  }
  return out.slice(0, 8);
}

/** 从 confirmedProposal 抽探测题；字段名兼容驼峰/下划线，非法项直接丢弃。 */
export function extractProbePrompts(confirmedProposal: unknown): ProbePrompt[] {
  if (!confirmedProposal || typeof confirmedProposal !== 'object') return [];
  const source = confirmedProposal as Record<string, unknown>;
  const raw = source.prerequisiteDiagnostics ?? source.prerequisite_diagnostics;
  if (!Array.isArray(raw)) return [];
  const out: ProbePrompt[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const probeId = text(record.probeId ?? record.probe_id, 80);
    const options = normalizeOptions(record.options);
    if (!probeId || !options.length) continue;
    const correctOption = text(record.correctOption ?? record.correct_option, 40) || undefined;
    const question = text(record.question, 300) || undefined;
    const targetConcept = text(record.targetConcept ?? record.target_concept, 80) || undefined;
    out.push({
      probeId,
      options,
      ...(question ? { question } : {}),
      ...(targetConcept ? { targetConcept } : {}),
      ...(correctOption ? { correctOption } : {}),
    });
  }
  return out;
}

function normalizeConcept(value: string): string {
  return value.toLowerCase().replace(/[\s\u3000，。、；：？！“”‘’（）《》【】[\]{}<>·,.;:!?()"'`~@#$%^&*+=|\\/_—-]+/g, '');
}

function targetHitsStruggle(targetConcept: string | undefined, struggleConcepts: string[]): boolean {
  const target = normalizeConcept(targetConcept || '');
  if (target.length < 2) return false;
  return struggleConcepts.some((item) => {
    const concept = normalizeConcept(item);
    if (concept.length < 2) return false;
    return target.includes(concept) || concept.includes(target);
  });
}

/**
 * 按画像生成确定性作答。
 * - 命中 struggleConcepts → 选一个与判分键不同的选项（没有判分键时选第二项）；
 * - 未命中 → 有判分键选判分键，否则选第一项。
 */
export function buildProbeAnswers(probes: ProbePrompt[], struggleConcepts: string[]): ProbeAnswer[] {
  const out: ProbeAnswer[] = [];
  for (const probe of probes) {
    if (!probe.options.length) continue;
    const ids = probe.options.map((option) => option.id);
    const correct = probe.correctOption && ids.includes(probe.correctOption) ? probe.correctOption : null;
    const struggling = targetHitsStruggle(probe.targetConcept, struggleConcepts);
    let answer: string;
    if (struggling) {
      // 有判分键时选任意一个非正确项；没有判分键时退到第二项（别把第一项当“错误项”）。
      answer = correct ? (ids.find((id) => id !== correct) || ids[0]) : (ids[1] || ids[0]);
    } else {
      answer = correct || ids[0];
    }
    out.push({
      probeId: probe.probeId,
      userAnswer: answer,
      ...(probe.targetConcept ? { targetConcept: probe.targetConcept } : {}),
    });
  }
  return out;
}
