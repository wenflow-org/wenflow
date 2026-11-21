import { buildWrapupUserPrompt } from '../index';
import type { SessionWrapupInput } from '../index';

/**
 * 2026-11-21 契约断点回归：wrapup 规则要求按 sessionStructure.lessonReport
 * 报告主线契约（missingKcs/independentCount/parkingLot），但 payload 组装器
 * 此前从未序列化该键——模型拿不到报告，规则成了死条款（真实 smoke 里
 * met=false 被写成“已独立作答”）。
 *
 * 本测试锁住：两种 payload 模式都必须带【课堂契约报告】分区，且内容原样可见。
 */
function baseInput(): SessionWrapupInput {
  return {
    messages: [
      { role: 'assistant', content: '先看材料里的鲜果易腐、运费高。' },
      { role: 'user', content: '那这条写原料导向。' },
    ],
    knowledgePoints: [{ name: '区位分析', status: 'learning', progress: 60 }],
    sessionInfo: {
      subject: '地理',
      topic: '区位分析',
      durationMinutes: 20,
      userMessageCount: 1,
      assistantMessageCount: 1,
      taskType: 'practice',
      taskTitle: '区位大题',
      taskDescription: '把材料条件翻成得分点',
    },
    sessionStructure: {
      endReason: 'task-completed',
      lessonReport: {
        met: false,
        coveredKcs: ['区位分析'],
        missingKcs: ['材料信息提取'],
        independentKcs: [],
        independentCount: 0,
        requiredIndependent: 1,
        reasons: ['材料信息提取仍只有引导下作答'],
        parkingLot: [{ question: '模板能不能直接套？' }],
        exitTicket: { asked: true, passed: false, conceptName: '材料信息提取' },
      },
    },
  };
}

describe('teaching-wrapup payload：课堂契约报告不得丢', () => {
  it('primary 模式序列化 lessonReport（缺项/独立计数/停车区可见）', () => {
    const prompt = buildWrapupUserPrompt(baseInput(), 'primary');
    expect(prompt).toContain('【课堂契约报告】');
    expect(prompt).toContain('"missingKcs":["材料信息提取"]');
    expect(prompt).toContain('"independentCount":0');
    expect(prompt).toContain('"parkingLot"');
    expect(prompt).toContain('"met":false');
  });

  it('evaluation-fallback 模式同样序列化 lessonReport', () => {
    const prompt = buildWrapupUserPrompt(baseInput(), 'evaluation-fallback');
    expect(prompt).toContain('【课堂契约报告】');
    expect(prompt).toContain('"missingKcs":["材料信息提取"]');
  });

  it('无 lessonReport 时保留分区并输出 null（提示词结构稳定）', () => {
    const input = baseInput();
    input.sessionStructure = { endReason: 'task-completed' };
    const prompt = buildWrapupUserPrompt(input, 'primary');
    expect(prompt).toContain('【课堂契约报告】null');
  });
});
