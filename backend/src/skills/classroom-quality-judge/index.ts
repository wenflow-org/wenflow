/**
 * classroom-quality-judge —— 课堂级独立 LLM 评审（handler-only 小 skill，2026-11-13）。
 *
 * 为什么存在：virtual-learner-referee 只看 publicTrace，板书/图文载荷、逐轮脚手架、
 * 收束产出这些课堂内部证据它拿不到——u07/u17 的「教师引用板上左栏」因此被误判为不可证。
 * 本 skill 直接评审单节课的完整逐轮记录（含学习者真实看到的 figures/板书载荷与 wrapup），
 * 证据粒度到轮次，产出与 referee 同构的结构化病历单（code/severity/evidenceIds）。
 *
 * 形态照 goal-confirm-adjudicator 混合成例：handler-only 注册（不进 agentMembers、
 * 不进字段路由），prompt 由 prompts/core/classroom-quality-judge.yaml 编译产物承载。
 * 调用方是跑数脚本 judge-minibatch-classrooms.ts（黑盒会话终态后逐节课调用），
 * 与教学主链路完全解耦——课堂评审缺席不影响任何教学行为。
 */
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import type { SkillDefinition, SkillExecutionResult } from '../protocol';

export const CLASSROOM_QUALITY_JUDGE_PROMPT = loadPromptFile('skill:classroom-quality-judge')?.systemPrompt || '';

export interface ClassroomJudgeTranscriptTurn {
  /** transcript 内序号（0 起），即评审 evidence 引用的定位坐标 */
  index: number;
  role: 'teacher' | 'learner';
  /** 该轮正文（已截断） */
  content: string;
  /** 平台真实渲染的板书载荷文本（无则 null） */
  board: string | null;
  /** 平台真实渲染的图文载荷文本（无则 null） */
  figure: string | null;
  /** 该轮携带的理解检查卡片题干（无则 null） */
  checkpoint: string | null;
}

export interface ClassroomQualityJudgeInput {
  classroom: {
    pathTitle?: string | null;
    stageTitle?: string | null;
    taskTitle?: string | null;
    taskDescription?: string | null;
    /** tutor | review | extension */
    mode?: string | null;
    learnerGoal?: string | null;
    learnerOccupation?: string | null;
    turnCount?: number | null;
  };
  transcript: ClassroomJudgeTranscriptTurn[];
  /** 本课任务级白板最终快照（teachingState.sessionArtifacts.board 的紧凑摘要；无则 present=false） */
  board?: { present: boolean; digest: string | null };
  wrapup: { present: boolean; summary: string | null; lss: number | null };
}

export interface ClassroomQualityJudgeOutput {
  verdict: 'pass' | 'pass_with_concerns' | 'fail' | 'inconclusive';
  scores: {
    overall: number;
    openingAnchor: number | null;
    criteriaClarity: number | null;
    scaffolding: number | null;
    boardConsistency: number | null;
    closureQuality: number | null;
  };
  findings: Array<{
    code: string;
    severity: 'critical' | 'major' | 'minor' | 'info';
    category: 'opening' | 'criteria' | 'scaffolding' | 'board' | 'notation' | 'closure' | 'assessment' | 'boundary';
    title: string;
    detail: string;
    evidenceIds: string[];
  }>;
  recommendations: Array<{
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    action: string;
    rationale: string;
    findingCodes: string[];
  }>;
  evidence: Array<{
    id: string;
    index: number | null;
    path: 'content' | 'board' | 'figure' | 'checkpoint' | 'wrapup';
    excerpt: string;
    interpretation: string;
  }>;
}

const VERDICTS = ['pass', 'pass_with_concerns', 'fail', 'inconclusive'] as const;
const SEVERITIES = ['critical', 'major', 'minor', 'info'] as const;
const CATEGORIES = ['opening', 'criteria', 'scaffolding', 'board', 'notation', 'closure', 'assessment', 'boundary'] as const;
const EVIDENCE_PATHS = ['content', 'board', 'figure', 'checkpoint', 'wrapup'] as const;

function clampScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.max(0, Math.min(100, score)));
}

function text(value: unknown, limit = 1000): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function normalizeEvidence(value: unknown, input: ClassroomQualityJudgeInput): ClassroomQualityJudgeOutput['evidence'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item: any, position: number) => {
    const path = EVIDENCE_PATHS.includes(item?.path) ? item.path as ClassroomQualityJudgeOutput['evidence'][number]['path'] : null;
    if (!path) return [];
    const rawIndex = item?.index === null || item?.index === undefined ? null : Number(item.index);
    // wrapup 证据不挂轮次；transcript 证据的 index 必须落在记录范围内
    const index = path === 'wrapup'
      ? null
      : (Number.isInteger(rawIndex) && rawIndex! >= 0 && rawIndex! < input.transcript.length ? rawIndex : null);
    if (path !== 'wrapup' && index === null) return [];
    const id = text(item?.id, 40) || `E${position + 1}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      index,
      path,
      excerpt: text(item?.excerpt, 500),
      interpretation: text(item?.interpretation, 600),
    }];
  }).slice(0, 40);
}

export function normalizeClassroomJudgeOutput(parsed: any, input: ClassroomQualityJudgeInput): ClassroomQualityJudgeOutput {
  const evidence = normalizeEvidence(parsed?.evidence, input);
  const evidenceIds = new Set(evidence.map(item => item.id));
  const findings = (Array.isArray(parsed?.findings) ? parsed.findings : []).flatMap((item: any, index: number) => {
    const refs = (Array.isArray(item?.evidenceIds) ? item.evidenceIds : []).map((id: unknown) => text(id, 40)).filter(id => evidenceIds.has(id));
    if (!refs.length) return [];
    if (!SEVERITIES.includes(item?.severity)) return [];
    const category = CATEGORIES.includes(item?.category) ? item.category : 'boundary';
    return [{
      code: text(item?.code, 80) || `FINDING_${index + 1}`,
      severity: item.severity,
      category,
      title: text(item?.title, 180) || '未命名发现',
      detail: text(item?.detail, 1000),
      evidenceIds: refs,
    }];
  }).slice(0, 24) as ClassroomQualityJudgeOutput['findings'];
  const findingCodes = new Set(findings.map(item => item.code));
  const recommendations = (Array.isArray(parsed?.recommendations) ? parsed.recommendations : []).flatMap((item: any) => {
    const action = text(item?.action, 500);
    if (!action) return [];
    return [{
      priority: ['P0', 'P1', 'P2', 'P3'].includes(item?.priority) ? item.priority : 'P2',
      action,
      rationale: text(item?.rationale, 700),
      findingCodes: (Array.isArray(item?.findingCodes) ? item.findingCodes : []).map((code: unknown) => text(code, 80)).filter(code => findingCodes.has(code)),
    }];
  }).slice(0, 16) as ClassroomQualityJudgeOutput['recommendations'];

  const rawScores = parsed?.scores && typeof parsed.scores === 'object' ? parsed.scores : {};
  const hasBoardPayload = input.transcript.some(turn => turn.board || turn.figure);
  const scores: ClassroomQualityJudgeOutput['scores'] = {
    overall: clampScore(rawScores.overall),
    openingAnchor: input.transcript.some(turn => turn.role === 'teacher') ? clampScore(rawScores.openingAnchor) : null,
    criteriaClarity: clampScore(rawScores.criteriaClarity),
    scaffolding: clampScore(rawScores.scaffolding),
    // 整课没有任何板书/图文载荷时，「板书一致」无从评起 → null（不按 0 分 punish 渲染链）
    boardConsistency: hasBoardPayload ? clampScore(rawScores.boardConsistency) : null,
    closureQuality: clampScore(rawScores.closureQuality),
  };
  const verdict = VERDICTS.includes(parsed?.verdict) ? parsed.verdict : 'inconclusive';
  return { verdict, scores, findings, recommendations, evidence };
}

/** 经 callPrompt 调用 skill:classroom-quality-judge 的 ACTIVE prompt；单测经依赖注入替换本层。 */
export async function executeClassroomQualityJudge(
  input: ClassroomQualityJudgeInput
): Promise<SkillExecutionResult<ClassroomQualityJudgeOutput>> {
  const result = await callPrompt<ClassroomQualityJudgeInput, ClassroomQualityJudgeOutput>({
    agentId: 'skill:classroom-quality-judge',
    defaultSystemPrompt: CLASSROOM_QUALITY_JUDGE_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'classroom-quality-judge' },
    retryStrategy: { maxAttempts: 2 },
    buildUserPayload: (payload) => payload,
    normalizeOutput: (parsed) => normalizeClassroomJudgeOutput(parsed, input),
    validateParsedOutput: (parsed) =>
      parsed && typeof parsed === 'object'
        ? { valid: true }
        : { valid: false, failureReason: 'CLASSROOM_JUDGE_OUTPUT_NOT_OBJECT' },
  }, input);

  if (!result.success || !result.output) {
    const message = result.error?.message || 'CLASSROOM_QUALITY_JUDGE_FAILED';
    return { success: false, duration: 0, error: { code: 'CLASSROOM_QUALITY_JUDGE_FAILED', message } };
  }
  return { success: true, output: result.output, duration: 0 };
}

export const classroomQualityJudgeDefinition: SkillDefinition = {
  name: 'classroom-quality-judge',
  displayName: '课堂质量独立评审 Skill',
  version: '1.0.0',
  category: 'analysis',
  description: '单节课逐轮记录 + 板书/图文载荷 + 收束产出的独立 LLM 病历单（code/severity/evidenceIds），与教学主链路解耦',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      classroom: { type: 'object', description: '课的元信息（路径/阶段/任务标题、课型、学习者目标与职业）' },
      transcript: { type: 'object[]', description: '逐轮记录 [{index, role, content, board, figure, checkpoint}]', required: true },
      board: { type: 'object', description: '任务级白板最终快照 { present, digest }（teachingState.sessionArtifacts.board）' },
      wrapup: { type: 'object', description: '收束产出 { present, summary, lss }' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'pass | pass_with_concerns | fail | inconclusive' },
      scores: { type: 'object', description: 'overall 与五个维度分（无证据维度为 null）' },
      findings: { type: 'object[]', description: '结构化发现 [{code, severity, category, title, detail, evidenceIds}]' },
      recommendations: { type: 'object[]', description: '面向平台/课程维护者的改进建议' },
      evidence: { type: 'object[]', description: '可定位证据 [{id, index, path, excerpt, interpretation}]' },
    },
  },
  capabilities: ['classroom-quality-review', 'board-consistency', 'semantic-verdict'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

export default executeClassroomQualityJudge;
