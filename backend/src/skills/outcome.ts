import type { RuntimeEnvelope } from '../services/prompt-lab/envelope-adapter';

/**
 * 统一 Skill 内部协议（Phase 2 起步脚手架）。
 * 仅后端内部使用，禁止直接当作 route/frontend 公开 DTO。
 *
 * 五层边界：
 * - RawModelOutput → CanonicalArtifact（本文件 artifact）
 * - ProposedTransition（可选，Phase 3）
 * - RuntimeEnvelope（可观测/编排桥接，非前端契约）
 * - Presentation DTO 由各 route/coordinator adapter 投影
 */

export type SkillTransitionKind =
  | 'none'
  | 'replace'
  | 'merge'
  | 'append'
  | 'create';

export type SkillInputSource =
  | 'accumulator-snapshot'
  | 'visible-thread'
  | 'workflow-snapshot'
  | 'evidence-snapshot'
  | 'simulation-state';

export type SkillDurableOwner =
  | 'none'
  | 'goal-conversation'
  | 'teaching-session'
  | 'learning-path'
  | 'virtual-session';

/**
 * 提议的状态迁移元数据。
 * Phase 3 才会统一校验；当前仅作可选 sidecar，不强制消费。
 */
export interface ProposedTransition {
  kind: SkillTransitionKind;
  /** 业务阶段标签（如 wrapup-generated / discussion-generated） */
  phase?: string | null;
  /** 是否可直接作为 durable 写入口 */
  durable?: boolean;
  /** 完整 nextState 或 patch 载荷；形状由各 skill 自管 */
  payload?: unknown;
  /** 三轴元数据（协议预留，暂不强制） */
  axes?: {
    inputSource?: SkillInputSource;
    transitionKind?: SkillTransitionKind;
    durableOwner?: SkillDurableOwner;
  };
}

export interface SkillOutcomeMeta {
  skillId: string;
  /** model | fallback | partial | failed */
  quality: 'model' | 'fallback' | 'partial' | 'failed';
  /** 人类可读降级/失败原因 */
  reason?: string | null;
  generatedAt?: string;
}

/**
 * 内部 canonical skill 结果。
 * TArtifact 为领域产物（如 SessionWrapupArtifact / PeerCanonicalArtifact）。
 */
export interface SkillOutcome<TArtifact = unknown> {
  schemaVersion: 'skill-outcome/v1';
  meta: SkillOutcomeMeta;
  /** 原始模型载荷（可选，调试/重试用） */
  raw?: unknown;
  /** 领域 canonical artifact */
  artifact: TArtifact;
  /** Phase 3：状态迁移；无迁移 skill 填 null */
  transition: ProposedTransition | null;
  /** 与 callPrompt 对齐的 runtime envelope 桥接 */
  runtimeEnvelope?: RuntimeEnvelope | null;
}

export function buildSkillOutcome<TArtifact>(input: {
  skillId: string;
  artifact: TArtifact;
  quality?: SkillOutcomeMeta['quality'];
  reason?: string | null;
  raw?: unknown;
  transition?: ProposedTransition | null;
  runtimeEnvelope?: RuntimeEnvelope | null;
  generatedAt?: string;
}): SkillOutcome<TArtifact> {
  return {
    schemaVersion: 'skill-outcome/v1',
    meta: {
      skillId: input.skillId,
      quality: input.quality ?? 'model',
      reason: input.reason ?? null,
      generatedAt: input.generatedAt || new Date().toISOString(),
    },
    raw: input.raw,
    artifact: input.artifact,
    transition: input.transition === undefined ? null : input.transition,
    runtimeEnvelope: input.runtimeEnvelope ?? null,
  };
}

/** peer 等无 durable 迁移的独立 artifact */
export function noneTransition(phase?: string | null): ProposedTransition {
  return {
    kind: 'none',
    phase: phase ?? null,
    durable: false,
    axes: {
      transitionKind: 'none',
      durableOwner: 'none',
    },
  };
}
