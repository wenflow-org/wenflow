/**
 * P1.6 落后触发器的用户可见面（TIME-TRUST-SCHEME-20261001）：
 *  1) 决策流（学习状态页 advisory 链路）：快照带 deadline_pace_behind → 复用既有
 *     「节奏调控」（kind='pace'）卡片形状出一张卡，前端零改动可渲染；
 *  2) 通知侧：落后信号首次产生时发一条 kind='deadline' 站内提醒，
 *     同一用户同一路径只发一次（userId+kind+link 查重，复用通知表现有列）。
 */
import { learningDecisionFeedService } from '../LearningDecisionFeedService';
import {
  notifyDeadlineBehindOnce,
  buildDeadlineNotificationLink,
  DEADLINE_NOTIFICATION_KIND,
} from '../deadline-notify.service';
import { DEADLINE_PACE_BEHIND_CODE } from '../LearnerSnapshotService';
import prisma from '../../../config/database';

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    notifications: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const findFirstMock = prisma.notifications.findFirst as jest.Mock;
const createMock = prisma.notifications.create as jest.Mock;

function snapshotWith(over: { behind?: boolean; pathId?: string; pathTitle?: string; deadline?: string | null }) {
  const snapshot = {
    replanSignal: {
      shouldSuggest: over.behind ?? true,
      priority: 'medium',
      recommendation: 'resequence',
      scope: 'downstream_path',
      rationale: '外部截止前时间进度已走到约 50%，实际完成约 30%，进度明显落后于剩余时间；建议确认后续安排（收缩范围或调整节奏），已完成内容不受影响。',
      reasonCodes: over.behind === false ? [] : [DEADLINE_PACE_BEHIND_CODE],
    },
    knowledgeMemory: {
      currentPath: {
        learningPathId: over.pathId ?? 'lp-1',
        pathTitle: over.pathTitle ?? '高数期末冲刺',
        deadline: over.deadline !== undefined ? over.deadline : '2026-11-01T00:00:00.000Z',
        progress: { totalTasks: 20, completedTasks: 6 },
      },
      globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [] },
    },
  };
  return snapshot;
}

describe('LearningDecisionFeedService · 截止进度失配卡（P1.6）', () => {
  it('快照带 deadline_pace_behind → 复用 pace 卡形状出卡，带 pathId 直达信息', () => {
    const cards = learningDecisionFeedService.build({
      paths: [],
      sessions: [],
      learnerSnapshot: snapshotWith({}) as never,
      summary: null,
    });
    const card = cards.find((c) => c.id === 'pace-deadline-lp-1');
    expect(card).toBeTruthy();
    expect(card!.kind).toBe('pace'); // 复用既有「节奏调控」形状
    expect(card!.captured).toContain('2026-11-01');
    expect(card!.pathId).toBe('lp-1');
    expect(card!.pathTitle).toBe('高数期末冲刺');
    expect(card!.recommendation).toBe('resequence');
  });

  it('无落后信号 → 不出卡', () => {
    const cards = learningDecisionFeedService.build({
      paths: [],
      sessions: [],
      learnerSnapshot: snapshotWith({ behind: false }) as never,
      summary: null,
    });
    expect(cards.some((c) => c.id.startsWith('pace-deadline-'))).toBe(false);
  });
});

describe('notifyDeadlineBehindOnce · 通知防重（P1.6）', () => {
  const base = {
    userId: 'u1',
    pathId: 'lp-1',
    pathTitle: '高数期末冲刺',
    deadline: '2026-11-01T00:00:00.000Z',
    replanSignal: snapshotWith({}).replanSignal,
  };

  beforeEach(() => {
    findFirstMock.mockReset();
    createMock.mockReset();
  });

  it('落后信号首次产生 → 创建 kind=deadline 通知，link 直达路径详情', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({});
    const out = await notifyDeadlineBehindOnce(base);
    expect(out.sent).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0][0].data;
    expect(data.kind).toBe(DEADLINE_NOTIFICATION_KIND);
    expect(data.kind).toBe('deadline');
    expect(data.link).toBe(buildDeadlineNotificationLink('lp-1'));
    expect(data.link).toBe('/learning-path/lp-1');
    expect(data.userId).toBe('u1');
    expect(data.title).toContain('截止');
  });

  it('同 path 同类型已发过（link 命中）→ 不再发', async () => {
    findFirstMock.mockResolvedValue({ id: 'n-1' });
    const out = await notifyDeadlineBehindOnce(base);
    expect(out.sent).toBe(false);
    expect(out.reason).toBe('already-notified');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('信号不含 deadline_pace_behind → 不发', async () => {
    const out = await notifyDeadlineBehindOnce({
      ...base,
      replanSignal: { reasonCodes: ['fatigue_high'] } as never,
    });
    expect(out.sent).toBe(false);
    expect(out.reason).toBe('not-behind');
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('路径无 deadline → 不发', async () => {
    const out = await notifyDeadlineBehindOnce({ ...base, deadline: null });
    expect(out.sent).toBe(false);
    expect(out.reason).toBe('no-deadline');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('写库失败 → fail-open 返回 error，不抛出', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockRejectedValue(new Error('db down'));
    const out = await notifyDeadlineBehindOnce(base);
    expect(out.sent).toBe(false);
    expect(out.reason).toBe('error');
  });
});
