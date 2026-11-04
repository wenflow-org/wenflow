/**
 * 有板指代漂移守卫（2026-11-04 无板任务实锤）：
 * 会话 st_1793793002486_egco4nf（读懂身边人行为的心理学解释）里，模型在没有任何
 * boardContext、本轮也没出 figure 的回合讲「左边那栏…左边第 2 条…右边第 4 条给了个答案」
 * ——所指的板从未存在，学生全屏找不到（payload figures:0 diagrams:0，库内核实）。
 *
 * 契约：boardContext 缺席 + 本轮无图 + reply 命中看板指代词 → 校验失败
 * （TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD，走 retryStrategy maxAttempts 2 重写）；
 * 板真实存在（boardContext 注入）或本轮真出了 figure/diagram 时指代合法不拦；
 * 内容词（左脑半球/图像记忆/第一原则）不命中。
 */
import {
  validateTeachingTurnOutput,
  type TeachingTurnInput,
} from '../index';

const baseInput: TeachingTurnInput = {
  messages: [{ role: 'user', content: '拿同事不吭声的例子改写' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: {
    subject: '心理学',
    topic: '读懂身边人行为',
    taskTitle: '把「他为什么这样」改写成能被证据推翻的问法',
    taskDescription: '区分行为描述与可推翻问法',
    taskType: 'practice',
  },
  knowledge: { points: [] },
};

function parsedWith(reply: string, extra: Record<string, unknown> = {}) {
  return {
    reply,
    analysis: { cognitiveLevel: 'understand', levelScore: 2, engagement: 0.8, emotionalState: 'neutral', loadIndex: 0.4 },
    knowledge: { currentPoint: '区分行为描述与可推翻问法', points: [] as any[] },
    pedagogy: { strategies: ['explain'] },
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    ...extra,
  };
}

describe('无板回合看板指代守卫', () => {
  it('无板 + 无图 + 「左边那栏…右边第 4 条」实锤句式 → 拦（TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD）', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('好，就用这个例子。左边那栏是你脑子里会冒出来的原问法，右边是改写后的。你盯着看一个地方：左边第 2 条「因为他性格内向」——这句话有没有哪种情况能把它推翻？右边第 4 条给了个答案。'),
      baseInput,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
  });

  it('无板 + 无图 + 「板书/如图/图中/表中」同族指代 → 拦', () => {
    for (const reply of [
      '看板上的两个色块对应两个流派。',
      '这张图里，红线标出的就是分叉步。',
      '对照表中左侧是易错做法。',
    ]) {
      const result = validateTeachingTurnOutput(parsedWith(reply), baseInput);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
    }
  });

  it('本轮真出了 figure → 同样的指代合法（引用了图就放行）', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('左边那栏是原问法，右边是改写后的。', {
        figure: { kind: 'compare', caption: '原问法 vs 改写后', labels: [] },
      }),
      baseInput,
    );
    expect(result.valid).toBe(true);
  });

  it('boardContext 注入（板真实存在）→ 指代板上内容合法', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('看板上的左栏：第 2 条「因为他性格内向」。'),
      { ...baseInput, boardContext: '白板现有两栏：左栏原问法 5 条，右栏改写问法 5 条。' },
    );
    expect(result.valid).toBe(true);
  });

  it('内容词不命中：左脑半球/图像记忆/第一原则/左边是公园 是正当课文', () => {
    for (const reply of [
      '心理学里常说左脑负责语言、右脑负责空间——但这是过度简化。',
      '图像记忆是 sensory memory 的一种。',
      '他把家人放在第一原则，这本身就是一个可以被检验的假设。',
      '在描述里「他站在左边是超市，右边是公园」——这是场景信息，不是解释。',
    ]) {
      const result = validateTeachingTurnOutput(parsedWith(reply), baseInput);
      expect(result.valid).toBe(true);
    }
  });
});
