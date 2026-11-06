/**
 * 有板指代漂移守卫（2026-11-04 无板任务实锤；2026-11-05 #244 修正判据）：
 * 会话 st_1793793002486_egco4nf（读懂身边人行为的心理学解释）里，模型在没有任何
 * boardContext、本轮也没出 figure 的回合讲「左边那栏…左边第 2 条…右边第 4 条给了个答案」
 * ——所指的板从未存在，学生全屏找不到（payload figures:0 diagrams:0，库内核实）。
 *
 * 契约：本轮没有真实板书 + 本轮无图 + reply 命中看板指代词 → 校验失败
 * （TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD，走 retryStrategy maxAttempts 2 重写）；
 * 板真实存在或本轮真出了 figure/diagram 时指代合法不拦；
 * 内容词（左脑半球/图像记忆/第一原则）不命中。
 *
 * #244：本文件原先全部用「boardContext 字段缺席」作输入，与生产形态不符——引擎
 * （teaching-turn-engine.ts:534）每轮**无条件**注入 `describeBoardForTeacher(board)`，
 * 无板时那是非空提示串「本任务暂无板书…」，旧判据 `!input.boardContext` 恒为 false，
 * 守卫在生产里一次都不会触发（全库 BOARD_DEIXIS 0 行）。因此无板用例一律改用
 * **生产注入形态**（真实 describeBoardForTeacher(null) 输出 + boardPresent=false），
 * 并保留「字段缺席」形态作为回落判据的回归。
 */
import {
  teachingTurnPromptSpec,
  validateTeachingTurnOutput,
  type TeachingTurnInput,
} from '../index';
import { describeBoardForTeacher } from '../../../services/ai-teaching/board-state';

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

/** 生产无板形态：引擎每轮都会写进去的那两个字段（board-state.ts + teaching-turn-engine.ts:534） */
const productionBoardlessInput: TeachingTurnInput = {
  ...baseInput,
  boardContext: describeBoardForTeacher(null),
  boardPresent: false,
};

function parsedWith(reply: string, extra: Record<string, unknown> = {}) {
  return {
    reply,
    analysis: { cognitiveLevel: 'understand', levelScore: 2, engagement: 0.8, emotionalState: 'neutral', loadIndex: 0.4 },
    knowledge: { currentPoint: '区分行为描述与可推翻问法', points: [] },
    pedagogy: { strategies: ['explain'] },
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    ...extra,
  };
}

describe('无板回合看板指代守卫', () => {
  it('生产无板形态（boardPresent=false + 「本任务暂无板书」提示串）+ 无图 + 实锤句式 → 拦', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('好，就用这个例子。左边那栏是你脑子里会冒出来的原问法，右边是改写后的。你盯着看一个地方：左边第 2 条「因为他性格内向」——这句话有没有哪种情况能把它推翻？右边第 4 条给了个答案。'),
      productionBoardlessInput,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
  });

  it('生产无板形态 + 无图 + 「板书/如图/图中」同族指代 → 拦', () => {
    for (const reply of [
      '看板上的两个色块对应两个流派。',
      '这张图里，红线标出的就是分叉步。',
      '对照表中左侧是易错做法。',
    ]) {
      const result = validateTeachingTurnOutput(parsedWith(reply), productionBoardlessInput);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
    }
  });

  it('#244 回落判据：只有「本任务暂无板书」提示串、没有 boardPresent 字段时同样拦', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('左边那栏是原问法，右边是改写后的。'),
      { ...baseInput, boardContext: describeBoardForTeacher(null) },
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
  });

  it('boardContext 字段完全没有（旧入口形态）仍然拦（既有行为不变）', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('左边那栏是原问法，右边是改写后的。'),
      baseInput,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
  });

  it('#244 语义订正：无板回合模型自出 figure 不算「有图」——图会被引擎丢，reply 仍指着空白 → 拦', () => {
    // 旧断言（valid=true）锁的是错误行为：无板回合的 figure/diagram 由
    // teaching-turn-engine「无 boardContext ⇒ 丢弃模型输出的 figure/diagram」闸删掉，
    // 学生屏幕上没有图；若这里放行，reply 的「左边那栏」会原样落库。
    const result = validateTeachingTurnOutput(
      parsedWith('左边那栏是原问法，右边是改写后的。', {
        figure: { kind: 'compare', caption: '原问法 vs 改写后', labels: [] },
      }),
      productionBoardlessInput,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
  });

  it('有板 + 本轮真出了 figure → 同样指代合法（图真的到学生屏幕上）', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('左边那栏是原问法，右边是改写后的。', {
        figure: { kind: 'compare', caption: '原问法 vs 改写后', labels: [] },
      }),
      {
        ...baseInput,
        boardContext: '白板现有两栏：左栏原问法 5 条，右栏改写问法 5 条。',
        boardPresent: true,
      },
    );
    expect(result.valid).toBe(true);
  });

  it('有板（boardPresent=true + 真实板书描述）→ 指代板上内容合法', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('看板上的左栏：第 2 条「因为他性格内向」。'),
      {
        ...baseInput,
        boardContext: '白板现有两栏：左栏原问法 5 条，右栏改写问法 5 条。',
        boardPresent: true,
      },
    );
    expect(result.valid).toBe(true);
  });

  it('有板且回复出现「左栏/右栏」真实指代 → 不得误拦（修过头检查）', () => {
    const result = validateTeachingTurnOutput(
      parsedWith('你盯着右栏第 3 条看：它满足「能被证据推翻」吗？左栏那几条是行为描述。'),
      {
        ...baseInput,
        boardContext: '白板现有两栏：左栏原问法 5 条，右栏改写问法 5 条。',
        boardPresent: true,
      },
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
      const result = validateTeachingTurnOutput(parsedWith(reply), productionBoardlessInput);
      expect(result.valid).toBe(true);
    }
  });

  it('#244 误伤收窄：上表/表里/表中 的裸子串不再判指代（本地库实证为高频内容词）', () => {
    // 本地 dev.db 253 条 assistant 消息里「透视表里」出现 6 次、「表里」11 次；
    // 「课上表现」命中旧正则的 `上表`。旧正则在守卫可达后会把这类话术整轮判废。
    for (const reply of [
      '你这节课上表现得很主动，继续。',
      '课上表现和课后练习都记下来了。',
      '你在透视表里一直做的就是这三个动作：拖进值区、拖进行区、拖进列区。',
      '你说的「表里如一」不是心理学术语。',
      '报表中这一列的合计对不上，我们再算一遍。',
      '课表上有三段时间，你选一段。',
      '不是每张表都能直接交付：得先看数据源。',
    ]) {
      const result = validateTeachingTurnOutput(parsedWith(reply), productionBoardlessInput);
      expect(result.valid).toBe(true);
    }
  });

  it('带限定语的表指代仍然拦：如下表/下表中/对照表中/对照表里/该表里/这表里/上表', () => {
    for (const reply of [
      '如下表所示，两种解释差在可推翻性。',
      '下表中第二行是易错做法。',
      '对照表中左侧是易错做法。',
      '对照表里左边那一列要重写。',
      '该表里第 3 行还空着。',
      '这表里「条件」一栏你还没填。',
      '上表最后一行给了个答案。',
    ]) {
      const result = validateTeachingTurnOutput(parsedWith(reply), productionBoardlessInput);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
    }
  });
});

/**
 * #252：守卫本身保留（纯函数仍判失败），但 spec 接线把它从**硬**失败降为**软**失败——
 * 先带改写指令重试一次，最后一次仍命中就按当前输出继续。硬失败时两次改写都失败会整轮 throw，
 * 接口 500，而引擎只在成功路径提交回合状态，学生这一轮输入随之丢失（实测traceId
 * 1793903123327-mkldlqa8g：两次 attempt 全败 → 500 + 消息未落库）。
 */
describe('无板指代在 spec 上是软失败（#252）', () => {
  const deictic = parsedWith('你看左边那栏的第二条，右边第 4 条其实给了个答案。');

  it('硬校验放行——不再整轮失败', () => {
    const result = teachingTurnPromptSpec.validateParsedOutput!(deictic, productionBoardlessInput);
    expect(result.valid).toBe(true);
  });

  it('软校验仍然拦下——保留「带改写指令重试」的那一次机会', () => {
    const result = teachingTurnPromptSpec.softValidateParsedOutput!(deictic, productionBoardlessInput);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD');
  });

  it('其它失败原因不受影响：硬校验照旧失败、软校验不重复报', () => {
    const missingAnalysis = { reply: '好，我们继续。' } as any;
    const hard = teachingTurnPromptSpec.validateParsedOutput!(missingAnalysis, productionBoardlessInput);
    expect(hard.valid).toBe(false);
    const soft = teachingTurnPromptSpec.softValidateParsedOutput!(missingAnalysis, productionBoardlessInput);
    expect(soft.valid).toBe(true);
  });

  it('有板回合的正当指代不会被软校验拦下', () => {
    const withBoard: TeachingTurnInput = { ...baseInput, boardContext: '【白板】两栏对照', boardPresent: true };
    const result = teachingTurnPromptSpec.softValidateParsedOutput!(parsedWith('左边那栏是条件，右边是做法。'), withBoard);
    expect(result.valid).toBe(true);
  });
});
