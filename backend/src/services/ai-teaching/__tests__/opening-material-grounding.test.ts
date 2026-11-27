/**
 * 开场材料落地护栏（2026-11-12 实测「开场问题非常严重」）：
 * 模型把 taskDescription 里的对话/清单说成「这段/上面给的」而不摆本体——
 * 学生第一屏没有任何材料，课从第一句就悬空。护栏从 description 抽出材料行，
 * 开场 message 未含大半时整块补挂。
 */
import { ensureOpeningMaterialGrounding, ensureOpeningSampleHonesty, ensureOpeningTaskMaterial, extractOpeningMaterialLines } from '../teaching-session-views';
import type { TeachingScenarioContext } from '../teaching-context-types';

const ctx = (taskDescription: string) => ({ taskDescription }) as unknown as TeachingScenarioContext;

const baseOpening = {
  message: '这段对话里，助手看起来像是记得你前面说过的话。今天我们就拿它当样本。',
  question: '',
  quickReplies: [{ text: '开始' }],
  mode: 'example-first' as const,
};

const RUN_DIALOG_DESCRIPTION = [
  '下面这段跑步咨询对话完整给出，可逐轮对照。',
  '轮1 用户：我在为下个月的全程马拉松做准备。',
  '轮2 助手：全程马拉松 42.195 公里，备赛周期通常 16-20 周。',
  '轮3 用户：我这几天睡眠不太好。',
  '轮4 助手：睡眠不足会影响恢复，建议今晚早点休息。',
  '轮5 用户：顺便看看补水要注意什么。',
  '轮6 助手：长距离训练中每 15-20 分钟补水一次。',
  '轮7 用户：今天跑多远？',
  '轮8 助手：你今天可以安排一次 30 公里的长距离跑。',
  '任务分两步。第一步：逐轮标注每轮各自给出了什么信息。第二步：判断这位助手是否记住了前面几轮说过的话。',
].join('');

describe('extractOpeningMaterialLines（材料行抽取）', () => {
  it('抽出「轮N / 1.」开头的材料行，指令句不进材料', () => {
    const lines = extractOpeningMaterialLines(RUN_DIALOG_DESCRIPTION);
    expect(lines).toHaveLength(8);
    expect(lines[0].startsWith('轮1')).toBe(true);
    expect(lines[7].startsWith('轮8')).toBe(true);
    expect(lines.join('')).not.toContain('任务分两步');
  });
});

describe('ensureOpeningMaterialGrounding（开场材料落地护栏）', () => {
  it('2026-11-12 实测形态：开场只说「这段对话」不摆本体 → 整块补挂', () => {
    const result = ensureOpeningMaterialGrounding(baseOpening, ctx(RUN_DIALOG_DESCRIPTION));
    expect(result.message).toContain('本课材料先摆出来');
    expect(result.message).toContain('轮1 用户：我在为下个月的全程马拉松做准备。');
    expect(result.message).toContain('轮8 助手：你今天可以安排一次 30 公里的长距离跑。');
    // 原开场保留在前
    expect(result.message.startsWith('这段对话里')).toBe(true);
  });

  it('模型已把材料摆出大半（≥60%）→ 不重复补挂', () => {
    const selfContained = {
      ...baseOpening,
      message: [
        '先把样本摆出来：',
        '轮1 用户：我在为下个月的全程马拉松做准备。轮2 助手：全程马拉松 42.195 公里，备赛周期通常 16-20 周。',
        '轮3 用户：我这几天睡眠不太好。轮4 助手：睡眠不足会影响恢复，建议今晚早点休息。',
        '轮5 用户：顺便看看补水要注意什么。轮6 助手：长距离训练中每 15-20 分钟补水一次。',
        '轮7 用户：今天跑多远？轮8 助手：你今天可以安排一次 30 公里的长距离跑。',
      ].join('\n'),
    };
    const result = ensureOpeningMaterialGrounding(selfContained, ctx(RUN_DIALOG_DESCRIPTION));
    expect(result.message).toBe(selfContained.message);
  });

  it('description 没有材料线索词（普通任务）→ 不动', () => {
    const result = ensureOpeningMaterialGrounding(baseOpening, ctx('练习 10 道时态选择题，逐题写排除理由。1. 先限时完成。'));
    expect(result).toBe(baseOpening);
  });

  it('材料行不足 2 条 → 不动（避免把编号步骤误当材料）', () => {
    const result = ensureOpeningMaterialGrounding(
      baseOpening,
      ctx('下面这三步走。1. 先读题。2. 再作答。'),
    );
    expect(result).toBe(baseOpening);
  });
});

describe('ensureOpeningTaskMaterial（材料卡，2026-11-27）', () => {
  const materialCtx = (taskMaterialPayload: string) => ({ taskMaterialPayload }) as unknown as TeachingScenarioContext;
  const DATA_TABLE = [
    '| 时间 | 客流 |',
    '| --- | --- |',
    '| 15:00 | 23 |',
    '| 16:00 | 27 |',
    '| 17:00 | 19 |',
    '| 18:00 | 24 |',
  ].join('\n');
  const opening = { message: '在示例片段里读数：先看 15:00 和 16:00 这两格。', question: '', quickReplies: [], mode: 'example-first' as const };

  it('开场说「在片段里读数」但没摆表 → 材料卡带表头与数据行，message 不动', () => {
    const result = ensureOpeningTaskMaterial(opening, materialCtx(DATA_TABLE));
    expect(result.message).toBe(opening.message);
    expect(result.material?.title).toBe('本课材料');
    expect(result.material?.text).toContain('| 15:00 | 23 |');
    expect(result.material?.text).toContain('| 18:00 | 24 |');
  });

  it('开场已经把表摆出来 → 不再给材料卡（不重复）', () => {
    const selfContained = { ...opening, message: `先看这张表：\n${DATA_TABLE}\n15:00 和 16:00 分别是多少？` };
    expect(ensureOpeningTaskMaterial(selfContained, materialCtx(DATA_TABLE)).material).toBeUndefined();
  });

  it('材料是数值表但开场没提材料 → 仍然给卡（读数课第一屏必须有数）', () => {
    const generic = { ...opening, message: '今天我们练看表读数。' };
    expect(ensureOpeningTaskMaterial(generic, materialCtx(DATA_TABLE)).material?.text).toContain('| 15:00 | 23 |');
  });

  it('非数值材料且开场未指代 → 不给卡（不把长手册灌进开场）', () => {
    const prose = '这是一份很长的内部手册，讲了很多背景、流程和注意事项，但没有表格。';
    const generic = { ...opening, message: '今天我们开始这节课。' };
    expect(ensureOpeningTaskMaterial(generic, materialCtx(prose)).material).toBeUndefined();
  });

  // 2026-11-26 阶段协议：整表不一次曝光，材料卡只给表头 + 第一行；
  // 2026-11-27：卡与老师气泡分离，message 里不再出现材料块。
  it('deferToBoard：卡里只给表头与第一行，其余留给课堂', () => {
    const result = ensureOpeningTaskMaterial(opening, materialCtx(DATA_TABLE), { deferToBoard: true });
    expect(result.message).toBe(opening.message);
    expect(result.material?.text).toContain('| 15:00 | 23 |');
    expect(result.material?.text).not.toContain('| 17:00 | 19 |');
    expect(result.material?.text).not.toContain('| 18:00 | 24 |');
  });

  it('deferToBoard 对短材料（≤2 行）不裁剪', () => {
    const short = '| 指标 | 值 |\n| --- | --- |';
    expect(ensureOpeningTaskMaterial(opening, materialCtx(short), { deferToBoard: true }).material?.text)
      .toContain('| 指标 | 值 |');
  });

  // 2026-11-27 真课（苏格拉底论证课）：开场说「用的是两小段…的示意转述」，旧词表
  // 一个都没命中，护栏放行；即便命中，旧裁剪只取前 2 行（两个标题），一句材料也没有。
  const TRANSCRIPT_MATERIAL = [
    '（以下按《申辩篇》受审段大意改写的示意性转述，非译本原文）',
    '',
    '第一段（带「所以」）：',
    '① 一个人若整天研究天上地下之事，还把弱的说法说成强的，就很难说他不敬神。',
    '② 苏格拉底并不研究天上地下之事，也不把弱的说法说成强的。',
    '③ 所以说他不敬神，站不住。',
    '',
    '第二段（打乱顺序）：',
    '① 喜剧里那个坐在吊篮里、研究天上事情的苏格拉底，是诗人编出来的。',
    '② 观众看完戏，就把那个形象记在了我头上。',
  ].join('\n');

  it('预测开场：卡里只给第一段的题面（组标题 + 第①句），不把结论句先贴出来', () => {
    const realOpening = {
      message: '这节课要练一件事：把一段话拆成前提和结论，用的是两小段围绕苏格拉底否认「研究天上地下之事」的示意转述。开头先不急着拆，凭直觉判断一下。',
      question: '',
      quickReplies: [],
      mode: 'predict' as const,
    };
    const result = ensureOpeningTaskMaterial(realOpening, materialCtx(TRANSCRIPT_MATERIAL), { deferToBoard: true });
    // 老师气泡保持人话；材料进入独立卡
    expect(result.message).toBe(realOpening.message);
    expect(result.material?.title).toBe('本课材料 · 示意转述');
    expect(result.material?.text).toContain('第一段（带「所以」）：');
    expect(result.material?.text).toContain('① 一个人若整天研究天上地下之事');
    // 预测题先不给答案句（②是否认、③是结论）
    expect(result.material?.text).not.toContain('② 苏格拉底并不研究');
    expect(result.material?.text).not.toContain('③ 所以说他不敬神');
    expect(result.material?.text).not.toContain('第二段');
    expect(result.material?.text).not.toContain('喜剧里那个坐在吊篮里');
    // 免责括注压进标题，不再占据材料正文
    expect(result.material?.text).not.toContain('非译本原文');
  });
});

describe('ensureOpeningSampleHonesty（示例口径护栏）', () => {
  const DESC_WITH_SAMPLE = '下面是豆包收到「帮我订一张明天去上海的高铁票」后的一段示例回复：「好的，我来帮你安排……」任务：逐句回看这段示例。';
  const ctxSample = { taskDescription: DESC_WITH_SAMPLE } as unknown as TeachingScenarioContext;
  const base = { message: '', question: '', quickReplies: [{ text: '开始' }], mode: 'example-first' as const };

  it('2026-11-12 实测形态：「你大概见过」→ 改写为（示例），材料本体保留', () => {
    const opening = { ...base, message: '这段豆包回复你大概见过：用户说「帮我订一张明天去上海的高铁票」，它答「好的，我来帮你安排……」。这节课就逐句回看它。' };
    const result = ensureOpeningSampleHonesty(opening, ctxSample);
    expect(result.message).not.toContain('你大概见过');
    expect(result.message).toContain('（示例）');
    expect(result.message).toContain('帮我订一张明天去上海的高铁票');
  });

  it('疑问形态（向学习者提问）不误改', () => {
    const opening = { ...base, message: '你在豆包里大概遇到过这种情况吗？说说当时它怎么答的。' };
    const result = ensureOpeningSampleHonesty(opening, ctxSample);
    expect(result.message).toBe(opening.message);
  });

  it('description 无示例标记 / message 无经验断言 → 不动', () => {
    const cleanCtx = { taskDescription: '练习 10 道时态题，逐题写排除理由。' } as unknown as TeachingScenarioContext;
    const opening = { ...base, message: '这段对话你大概见过。' };
    expect(ensureOpeningSampleHonesty(opening, cleanCtx).message).toBe('这段对话你大概见过。');
    const noClaim = { ...base, message: '下面是一段示例回复。' };
    expect(ensureOpeningSampleHonesty(noClaim, ctxSample).message).toBe(noClaim.message);
  });
});
