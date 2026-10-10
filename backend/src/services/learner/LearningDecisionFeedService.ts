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
import { DEADLINE_PACE_BEHIND_CODE } from './LearnerSnapshotService';

export type LearningDecisionKind =
  | 'path-adjust'
  | 'path-replanned'
  | 'kp-carryover'
  | 'concept-watch'
  | 'pace';

export interface LearningDecisionOption {
  key: string;
  label: string;
  description?: string;
}

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
  /** 2026-09-27 联动补全：path-adjust 卡携带受影响路径与 advisory 原文摘要，
      让学习状态页可以直达确认（此前卡是纯日志，无 pathId 无动作） */
  pathId?: string | null;
  pathTitle?: string | null;
  recommendation?: string | null;
  body?: string;
  options?: LearningDecisionOption[];
  advisory?: Record<string, any>;
  /** 判断+动作完全相同的重复建议合并计数 */
  mergedCount?: number;
}

interface SessionLike {
  status?: string | null;
  endTime?: Date | null;
  updatedAt?: Date | null;
  advisory?: string | null;
  wrapup?: string | null;
  learningPathId?: string | null;
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

/**
 * 把名称列表拼成一行；超过 limit 时写「A、B、C 等 N 个知识点」。
 * unit 必填且不给默认值：原来固定拼「等 N 个」，句子到「个」就断了、读者不知道在数什么
 * （2026-10-08 用户侧视觉检查在桌面与移动两档都报出）。让每个调用点自己说清数的是什么。
 */
function joinNames(names: unknown[], unit: string, limit = 3): string {
  const list = (names || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!list.length) return '';
  const head = list.slice(0, limit).join('、');
  return list.length > limit ? `${head} 等 ${list.length} ${unit}` : head;
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
    // 消账（2026-09-27）：session 所属路径在该课之后已发生过 replan，
    // 视为这条建议已被吸收/取代，不再进入决策流——否则旧建议永远挂着（45% 触发率下尤其灾难）。
    const pathById = new Map((input.paths || []).map((p) => [p.id, p]));
    const pathAdjustCards: LearningDecisionCard[] = [];
    for (const session of input.sessions || []) {
      const advisory = parseJsonSafe<any>(session.advisory);
      if (!advisory?.shouldSuggest) continue;

      const sessionAt = toIso(session.endTime) || toIso(session.updatedAt);
      const sessionPath = session.learningPathId ? pathById.get(session.learningPathId) : null;
      if (
        sessionPath?.replanReason &&
        sessionPath.updatedAt &&
        sessionAt &&
        new Date(toIso(sessionPath.updatedAt) || 0) > new Date(sessionAt)
      ) {
        continue;
      }

      const wrapup = parseJsonSafe<any>(session.wrapup);
      const focus = joinNames([
        ...(wrapup?.progress?.stillLearning || []),
        ...(wrapup?.progress?.movedToReview || [])
      ], '个知识点');
      pathAdjustCards.push({
        id: `path-adjust-${sessionAt || pathAdjustCards.length}`,
        kind: 'path-adjust',
        captured: focus
          ? `一节课结束后，「${focus}」仍不稳定`
          : '一节课结束后，学习信号提示后续推进方式需要重新确认',
        judgment: String(advisory.rationale || '当前学习者状态提示后续安排需要重新确认。'),
        action: String(advisory?.ui?.title || '建议调整后续路径'),
        priority: advisory.priority === 'high' ? 'high' : advisory.priority === 'medium' ? 'medium' : 'low',
        at: sessionAt,
        pathId: session.learningPathId || sessionPath?.id || null,
        pathTitle: sessionPath?.title || null,
        recommendation: advisory.recommendation || null,
        body: advisory?.ui?.body || '',
        options: Array.isArray(advisory?.ui?.options) ? advisory.ui.options : [],
        advisory
      });
    }
    // 同文案去重：判断+动作完全一致的重复建议只留最新一条，带合并计数
    const dedupKey = (card: LearningDecisionCard) => `${card.judgment}|${card.action}`;
    const dedupMap = new Map<string, { card: LearningDecisionCard; count: number }>();
    for (const card of pathAdjustCards) {
      const hit = dedupMap.get(dedupKey(card));
      if (!hit) {
        dedupMap.set(dedupKey(card), { card, count: 1 });
        continue;
      }
      if ((card.at || '') > (hit.card.at || '')) hit.card = card;
      hit.count += 1;
    }
    cards.push(
      ...[...dedupMap.values()].map(({ card, count }) => (count > 1 ? { ...card, mergedCount: count } : card))
    );

    // ---------- 2. 路径调整（replan 已发生的决策） ----------
    // 判据三件套：replanReason 非空「且」有 mode/trigger。真重排必带二者（path-replan.service
    // 固定写三件套；rebuild/regenerate 流经 userProfile.replan 至少带 mode 或 triggerSource）。
    // 2026-10-10 走查 W8：此前只看 replanReason，而路径生成曾把 description 写进该字段 →
    // 每条新路径凭空多一条「已执行的调整」。写入侧已修（path-generation.core），此守卫
    // 兜住存量污染行与未来单写 reason 的旁路。
    const replanned = (input.paths || [])
      .filter((path) =>
        path.replanReason && String(path.replanReason).trim() &&
        (path.replanMode || path.replanTriggerSource)
      )
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
    ], '个知识点');
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
        const names = joinNames(wrapup?.progress?.stillLearning || [], '个知识点');
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

    // ---------- 6. 截止进度失配（P1.6 落后触发器，TIME-TRUST-SCHEME-20261001） ----------
    // 快照 replanSignal 带 deadline_pace_behind（判据：judgeDeadlinePace，进度百分位落后
    // 时间百分位 ≥0.2）时出一张「节奏调控」卡——复用既有卡片形状，前端零改动即可渲染。
    const replanSignal = input.learnerSnapshot?.replanSignal;
    if (replanSignal?.reasonCodes?.includes(DEADLINE_PACE_BEHIND_CODE)) {
      const currentPath = input.learnerSnapshot?.knowledgeMemory?.currentPath;
      const deadlineDay = currentPath?.deadline ? String(currentPath.deadline).slice(0, 10) : null;
      cards.push({
        id: `pace-deadline-${currentPath?.learningPathId || 'current'}`,
        kind: 'pace',
        captured: deadlineDay
          ? `截止日 ${deadlineDay} 前的时间进度，已经跑在当前完成度前面`
          : '设了截止日的路径，当前进度落后于时间进度',
        judgment: replanSignal.rationale
          || '按剩余时间与剩余任务量推算，实际完成百分位已明显落后于时间百分位',
        action: '建议确认一次后续安排：收缩范围或调整节奏，已完成内容不受影响',
        priority: replanSignal.priority === 'high' ? 'medium' : 'info',
        at: null,
        pathId: currentPath?.learningPathId || null,
        pathTitle: currentPath?.pathTitle || null,
        recommendation: replanSignal.recommendation || null
      });
    }

    return cards
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
      .slice(0, 5);
  }
}

export const learningDecisionFeedService = new LearningDecisionFeedService();
export default learningDecisionFeedService;
