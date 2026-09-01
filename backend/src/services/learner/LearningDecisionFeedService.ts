/**
 * LearningDecisionFeedService
 *
 * 把分散在各处的真实调控信号组装成「AI 决策记录」卡片：
 * 捕获了什么（证据）→ 怎么判断（理由）→ 参与什么决策（动作）。
 *
 * 数据来源（全部服务端已有，无 LLM 调用）：
 * - teaching_sessions.advisory（结算时 ReplanAdvisoryService 生成的调整建议）
 * - teaching_sessions.wrapup.progress（当堂知识点掌握/未掌握）
 * - learning_paths.replanReason / replanTriggerSource（路径版本调整）
 * - learnerSnapshot.knowledgeMemory.globalSignals（长期脆弱/挣扎概念）
 * - LearnerStateSummaryOutput.global（节奏/状态级别）
 */

import type { LearnerSnapshot } from '../../agents/learner-model-agent/types';
import type { LearnerStateSummaryOutput } from './LearnerStateSummaryService';

export type LearningDecisionKind =
  | 'path-adjust'
  | 'path-replanned'
  | 'kp-carryover'
  | 'concept-watch'
  | 'pace';

export interface LearningDecisionCard {
  id: string;
  kind: LearningDecisionKind;
  /** 捕获：AI 观察到的证据点 */
  captured: string;
  /** 判断：基于证据的解释 */
  judgment: string;
  /** 动作：这个判断参与了什么决策 */
  action: string;
  priority: 'high' | 'medium' | 'low' | 'info';
  at: string | null;
}

interface SessionLike {
  status?: string | null;
  endTime?: Date | null;
  updatedAt?: Date | null;
  advisory?: string | null;
  wrapup?: string | null;
}

interface PathLike {
  id: string;
  title?: string | null;
  replanReason?: string | null;
  replanTriggerSource?: string | null;
  replanMode?: string | null;
  updatedAt?: Date | null;
}

function parseJsonSafe<T = any>(raw: unknown): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function joinNames(names: unknown[], limit = 3): string {
  const list = (names || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!list.length) return '';
  const head = list.slice(0, limit).join('、');
  return list.length > limit ? `${head} 等 ${list.length} 个` : head;
}

const PRIORITY_ORDER: Record<LearningDecisionCard['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3
};

export class LearningDecisionFeedService {
  build(input: {
    paths: PathLike[];
    sessions: SessionLike[];
    learnerSnapshot: LearnerSnapshot | null;
    summary: LearnerStateSummaryOutput | null;
  }): LearningDecisionCard[] {
    const cards: LearningDecisionCard[] = [];

    // ---------- 1. 课后调整建议（advisory，最强的调控证据） ----------
    for (const session of input.sessions || []) {
      const advisory = parseJsonSafe<any>(session.advisory);
      if (!advisory?.shouldSuggest) continue;

      const wrapup = parseJsonSafe<any>(session.wrapup);
      const focus = joinNames([
        ...(wrapup?.progress?.stillLearning || []),
        ...(wrapup?.progress?.movedToReview || [])
      ]);
      cards.push({
        id: `path-adjust-${toIso(session.endTime) || toIso(session.updatedAt) || cards.length}`,
        kind: 'path-adjust',
        captured: focus
          ? `一节课结束后，「${focus}」仍不稳定`
          : '一节课结束后，学习信号提示后续推进方式需要重新确认',
        judgment: String(advisory.rationale || '当前学习者状态提示后续安排需要重新确认。'),
        action: String(advisory?.ui?.title || '建议调整后续路径'),
        priority: advisory.priority === 'high' ? 'high' : advisory.priority === 'medium' ? 'medium' : 'low',
        at: toIso(session.endTime) || toIso(session.updatedAt)
      });
    }

    // ---------- 2. 路径调整（replan 已发生的决策） ----------
    const replanned = (input.paths || [])
      .filter((path) => path.replanReason && String(path.replanReason).trim())
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    for (const path of replanned.slice(0, 1)) {
      cards.push({
        id: `path-replanned-${path.id}`,
        kind: 'path-replanned',
        captured: `路径「${path.title || '学习路径'}」完成了一次调整`,
        judgment: String(path.replanReason),
        action: '已按当前证据调整后续阶段安排，已完成的内容不受影响',
        priority: 'medium',
        at: toIso(path.updatedAt)
      });
    }

    // ---------- 3. 长期概念观察（学习者快照信号） ----------
    const signals = input.learnerSnapshot?.knowledgeMemory?.globalSignals;
    const watchNames = joinNames([
      ...(signals?.fragileConcepts || []),
      ...(signals?.strugglingConcepts || [])
    ]);
    if (watchNames) {
      cards.push({
        id: 'concept-watch',
        kind: 'concept-watch',
        captured: `「${watchNames}」在近几次练习中不够稳定`,
        judgment: '这些点会拖慢后续相关内容的推进',
        action: '后续教学会在这些点上放慢确认',
        priority: 'info',
        at: null
      });
    }

    // ---------- 4. 知识点跨课传递（无 advisory 的正常延续） ----------
    if (!cards.some((card) => card.kind === 'path-adjust')) {
      const latest = (input.sessions || []).find((session) => {
        const wrapup = parseJsonSafe<any>(session.wrapup);
        return (wrapup?.progress?.stillLearning || []).length > 0;
      });
      if (latest) {
        const wrapup = parseJsonSafe<any>(latest.wrapup);
        const names = joinNames(wrapup?.progress?.stillLearning || []);
        if (names) {
          cards.push({
            id: `kp-carryover-${toIso(latest.endTime) || toIso(latest.updatedAt) || 'latest'}`,
            kind: 'kp-carryover',
            captured: `上节课「${names}」还没掌握`,
            judgment: '这些点会随课程知识点传递延续到下一节',
            action: '下节课开头优先巩固',
            priority: 'info',
            at: toIso(latest.endTime) || toIso(latest.updatedAt)
          });
        }
      }
    }

    // ---------- 5. 节奏调控（状态级建议） ----------
    const global = input.summary?.global;
    if (global && (global.stateLevel === 'recover' || global.warningLevel === 'critical')) {
      cards.push({
        id: 'pace',
        kind: 'pace',
        captured: '近 7 天疲劳度持续高于健康度',
        judgment: '继续加量，吸收效率会下降',
        action: '建议今天轻量学习或休息',
        priority: global.warningLevel === 'critical' ? 'medium' : 'info',
        at: null
      });
    }

    return cards
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
      .slice(0, 5);
  }
}

export const learningDecisionFeedService = new LearningDecisionFeedService();
export default learningDecisionFeedService;
