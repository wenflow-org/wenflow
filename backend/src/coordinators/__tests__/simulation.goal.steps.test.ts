import { buildGoalStepResult, isRepetitiveLearnerReply } from '../simulation.goal.steps';
import type { ConversationHistoryItem } from '../simulation.types';

const learner = (content: string): ConversationHistoryItem => ({ role: 'user', content });
const agent = (content: string): ConversationHistoryItem => ({ role: 'assistant', content });

describe('isRepetitiveLearnerReply（告别死循环确定性兜底）', () => {
  it('最近两条学习者发言都高度相似 → true（2026-11-11 蓝屏 8 轮告别）', () => {
    const history: ConversationHistoryItem[] = [
      agent('行，去忙吧。'),
      learner('好，那我就先忙别的，回头坐到电脑前再按备忘录试，到时候告诉你停在哪一层。'),
      agent('好，去忙吧。'),
      learner('好，那我先把这阵子的活忙完，等我手能摸到电脑就按备忘录试，到时候告诉你停在哪一层。'),
    ];
    const next = '好，我这就先去把手头的活忙完，等会儿坐到电脑前就按备忘录试，到时候告诉你停在哪一层。';
    expect(isRepetitiveLearnerReply(history, next)).toBe(true);
  });

  it('短回复/正常新信息 → false，不误杀', () => {
    const history: ConversationHistoryItem[] = [
      learner('不知道。'),
      learner('不知道。'),
    ];
    expect(isRepetitiveLearnerReply(history, '不知道。')).toBe(false);
    expect(isRepetitiveLearnerReply(history, '我看了合同，试用期写的是六个月。')).toBe(false);
  });

  it('历史不足两条学习者发言 → false', () => {
    expect(isRepetitiveLearnerReply([learner('好，我先去忙。')], '好，我先去忙。')).toBe(false);
  });
});

describe('buildGoalStepResult 终局信号', () => {
  const base = {
    virtualUserReply: '好，我先去忙。',
    goalResponse: { userVisible: '', stage: 'understanding', confidence: 0 },
    logs: [],
  };

  it('learnerEnded / noPath 透传，currentStage 保持 goal', () => {
    const result = buildGoalStepResult({ ...base, goalReady: false, learnerEnded: true, learnerEndReason: 'leaving' });
    expect(result.currentStage).toBe('goal');
    expect(result.learnerEnded).toBe(true);
    expect(result.learnerEndReason).toBe('leaving');
    expect(result.noPath).toBeUndefined();
  });

  it('noPath 终局不误报 goalReady', () => {
    const result = buildGoalStepResult({ ...base, goalReady: false, noPath: true });
    expect(result.currentStage).toBe('goal');
    expect(result.goalReady).toBe(false);
    expect(result.noPath).toBe(true);
  });
});
