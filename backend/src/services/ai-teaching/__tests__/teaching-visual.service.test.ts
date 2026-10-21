/**
 * 教学配图服务（owner 口径 2026-09-23：「图片是一种特殊的文字，放在教学中」）。
 *
 * 验收点：
 *   1) 正常：把老师的文字描述渲染成一张图（最终 prompt = 风格前缀 + 描述），带 provider/model 留痕；
 *   2) **图 = 一段文字的渲染**：返回的 `prompt` 可回溯，`caption` 原样保留；
 *   3) 闸门：开关关闭 / 描述过短 / 达每会话上限 → 不生成；
 *   4) **fail-open**：生成失败 / 上游返回空图 → 返回 null，**绝不抛**（课堂不能被图拖垮）。
 */
import {
  buildVisualOpportunity,
  composeTeachingVisualPrompt,
  countTeachingVisuals,
  detectAsciiStructure,
  detectPositionDescription,
  detectStructuralCue,
  detectExerciseLeakInReply,
  generateTeachingVisual,
  hasDanglingFigureReference,
  hasIdenticalVisualPrompt,
  isTeachingVisualEnabled,
  isUsableVisualPrompt,
  resolveTeachingVisualMaxPerSession,
  resolveTeachingVisualMaxPerTask,
  resolveTeachingVisualSpec,
  shouldEmitTeachingFigure,
  chooseFigureKind,
  figureKindHintLine,
  stripDanglingFigureReferences,
} from '../teaching-visual.service';
import { ImageError } from '../../image/types';
import type { TeachingSessionMessage } from '../TeachingSessionRepository';

const request = { prompt: '一个直角三角形，直角在左下角，两条直角边分别标 3 和 4', caption: '先把边标上', kind: '示意图' };

function messageWithImages(count: number): TeachingSessionMessage {
  return {
    role: 'assistant',
    content: '看这里',
    timestamp: '2026-09-23T00:00:00.000Z',
    images: Array.from({ length: count }, (_, index) => ({
      url: `https://img.example/${index}.png`,
      caption: null,
      prompt: 'p',
      provider: 'agnes',
      model: 'm',
      kind: null,
      createdAt: '2026-09-23T00:00:00.000Z',
    })),
  };
}

const okGenerate = (async () => ({
  provider: 'agnes',
  attempts: ['agnes'],
  model: 'agnes-image-2.5-flash',
  latencyMs: 12_000,
  images: [{ url: 'https://img.example/ok.png', provider: 'agnes' }],
})) as never;

// 2026-09-27 owner 终审：扩散生图默认**停用**（设计文档 §九）。生成能力保留，仅显式 opt-in
// （TEACHING_VISUAL_ENABLED=1）时启用——本文件所有生成类用例由顶层 beforeEach 统一打开；
// 「默认停用」用例自行 delete 开关后断言 false。
beforeEach(() => {
  process.env.TEACHING_VISUAL_ENABLED = '1';
});

afterEach(() => {
  delete process.env.TEACHING_VISUAL_ENABLED;
  delete process.env.TEACHING_VISUAL_MAX_PER_SESSION;
  delete process.env.TEACHING_VISUAL_MAX_PER_TASK;
  delete process.env.TEACHING_DIAGRAM_DISABLED;
});

describe('teaching-visual 服务', () => {
  it('正常：文字描述 → 一张图（prompt 可回溯 + caption 保留 + provider 留痕）', async () => {
    const image = await generateTeachingVisual({ request, messages: [], deps: { generate: okGenerate } });

    expect(image).not.toBeNull();
    expect(image!.url).toBe('https://img.example/ok.png');
    expect(image!.caption).toBe('先把边标上');
    expect(image!.kind).toBe('示意图');
    expect(image!.provider).toBe('agnes');
    // 图 = 一段文字的渲染：最终 prompt 含风格前缀 + 老师原描述
    expect(image!.prompt).toContain('教学示意图');
    expect(image!.prompt).toContain('直角三角形');
    expect(image!.prompt).toContain('两条直角边分别标 3 和 4');
  });

  it('默认停用（owner 终审 2026-09-27）：未显式开开关 → isTeachingVisualEnabled=false，且不生成', async () => {
    delete process.env.TEACHING_VISUAL_ENABLED;
    expect(isTeachingVisualEnabled()).toBe(false);
    const generate = jest.fn();
    const image = await generateTeachingVisual({ request, messages: [], deps: { generate: generate as never } });
    expect(image).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('描述过短/空白 → 不生成（不值得画）', async () => {
    expect(isUsableVisualPrompt({ prompt: '图' })).toBe(false);
    expect(isUsableVisualPrompt({ prompt: '   ' })).toBe(false);
    const generate = jest.fn();
    expect(await generateTeachingVisual({ request: { prompt: '图' }, messages: [], deps: { generate: generate as never } })).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('每任务闸门已放开（owner 2026-09-25）：默认不限张数，已有图仍可再生成', async () => {
    const messages = [messageWithImages(2)];
    expect(resolveTeachingVisualMaxPerTask()).toBe(Number.POSITIVE_INFINITY);
    const generate = jest.fn(async () => ({
      provider: 'agnes',
      attempts: ['agnes'],
      model: 'agnes-image-2.5-flash',
      latencyMs: 1,
      images: [{ url: 'https://img.example/ok.png', provider: 'agnes' }],
    }));
    const image = await generateTeachingVisual({ request, messages, deps: { generate: generate as never } });
    expect(image).not.toBeNull();
    expect(generate).toHaveBeenCalled();
  });

  it('env 可再收紧每任务上限（回滚用）；0 = 不限', async () => {
    process.env.TEACHING_VISUAL_MAX_PER_TASK = '1';
    const messages = [messageWithImages(1)];
    const generate = jest.fn();
    expect(await generateTeachingVisual({ request, messages, deps: { generate: generate as never } })).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    process.env.TEACHING_VISUAL_MAX_PER_TASK = '0';
    expect(resolveTeachingVisualMaxPerTask()).toBe(Number.POSITIVE_INFINITY);
  });

  it('达每会话上限 → 不生成', async () => {
    process.env.TEACHING_VISUAL_MAX_PER_TASK = '5';
    process.env.TEACHING_VISUAL_MAX_PER_SESSION = '2';
    expect(resolveTeachingVisualMaxPerSession()).toBe(2);
    const messages = [messageWithImages(2)];
    expect(countTeachingVisuals(messages)).toBe(2);
    const generate = jest.fn();
    expect(await generateTeachingVisual({ request, messages, deps: { generate: generate as never } })).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('fail-open：生成抛错 → 返回 null，不抛', async () => {
    const boom = (async () => { throw new Error('upstream 502'); }) as never;
    await expect(generateTeachingVisual({ request, messages: [], deps: { generate: boom } })).resolves.toBeNull();
  });

  it('fail-open：上游返回空图 → null', async () => {
    const empty = (async () => ({ provider: 'agnes', attempts: ['agnes'], model: 'm', latencyMs: 1, images: [] })) as never;
    await expect(generateTeachingVisual({ request, messages: [], deps: { generate: empty } })).resolves.toBeNull();
  });

  it('composeTeachingVisualPrompt：风格前缀固定，描述原样保留', () => {
    const prompt = composeTeachingVisualPrompt({ prompt: '两条平行线被一条斜线穿过' });
    expect(prompt).toContain('教学示意图');
    expect(prompt).toContain('两条平行线被一条斜线穿过');
    expect(prompt).toContain('简洁');
    expect(prompt).toContain('构图');
  });

  it('请求体：代码裁决的精确尺寸（横向结构不再被压成方图）', async () => {
    const generate = jest.fn(async () => ({
      provider: 'agnes',
      attempts: ['agnes'],
      model: 'agnes-image-2.5-flash',
      latencyMs: 1,
      images: [{ url: 'https://img.example/ok.png', provider: 'agnes' }],
    }));
    await generateTeachingVisual({
      request: { prompt: '把甲、乙的位置摆成一条线', kind: '流程图' },
      messages: [],
      deps: { generate: generate as never },
    });
    const [body] = generate.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(body).toMatchObject({ size: '1312x736', ratio: '16:9', responseFormat: 'url' });
  });
});

describe('同 prompt 去重（2026-09-26：不重复计费）', () => {
  const composedPrompt = composeTeachingVisualPrompt(request);

  const messageWithPrompt = (imagePrompt: string): TeachingSessionMessage => ({
    role: 'assistant',
    content: '看这里',
    timestamp: '2026-09-26T00:00:00.000Z',
    images: [{ url: 'https://img.example/1.png', caption: null, prompt: imagePrompt, provider: 'agnes', model: 'm', kind: null, createdAt: '2026-09-26T00:00:00.000Z' }],
  });

  it('hasIdenticalVisualPrompt：composed prompt 全等才判真', () => {
    expect(hasIdenticalVisualPrompt([messageWithPrompt(composedPrompt)], composedPrompt)).toBe(true);
    expect(hasIdenticalVisualPrompt([messageWithPrompt('别的图')], composedPrompt)).toBe(false);
    expect(hasIdenticalVisualPrompt([], composedPrompt)).toBe(false);
    expect(hasIdenticalVisualPrompt(null, composedPrompt)).toBe(false);
    expect(hasIdenticalVisualPrompt([messageWithPrompt(composedPrompt)], '')).toBe(false);
  });

  it('本会话已画过同一 composed prompt → 不再生成（generate 不被调用）', async () => {
    const generate = jest.fn();
    const image = await generateTeachingVisual({
      request,
      messages: [messageWithPrompt(composedPrompt)],
      deps: { generate: generate as never },
    });
    expect(image).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('同会话不同 prompt（老师换了个画法）→ 正常生成', async () => {
    const generate = jest.fn(async () => ({
      provider: 'agnes',
      attempts: ['agnes'],
      model: 'm',
      latencyMs: 1,
      images: [{ url: 'https://img.example/ok.png', provider: 'agnes' }],
    }));
    const image = await generateTeachingVisual({
      request,
      messages: [messageWithPrompt('另一张图的 prompt')],
      deps: { generate: generate as never },
    });
    expect(image).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('瞬时失败有界重试（2026-09-26）', () => {
  const okResult = {
    provider: 'agnes',
    attempts: ['agnes'],
    model: 'm',
    latencyMs: 1,
    images: [{ url: 'https://img.example/ok.png', provider: 'agnes' }],
  };

  it('快速 5xx → 重试一次成功（generate 共调用 2 次）', async () => {
    let calls = 0;
    const generate = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ImageError('IMAGE_UPSTREAM_HTTP_ERROR', 'upstream 502', 502);
      return okResult;
    });
    const image = await generateTeachingVisual({ request, messages: [], deps: { generate: generate as never } });
    expect(image).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('非瞬时失败（请求本身无效）→ 不重试直接 fail-open', async () => {
    const generate = jest.fn(async () => {
      throw new ImageError('IMAGE_REQUEST_INVALID', 'bad request');
    });
    const image = await generateTeachingVisual({ request, messages: [], deps: { generate: generate as never } });
    expect(image).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('4xx → 不重试（请求问题重试必然复现）', async () => {
    const generate = jest.fn(async () => {
      throw new ImageError('IMAGE_UPSTREAM_HTTP_ERROR', 'upstream 400', 400);
    });
    await generateTeachingVisual({ request, messages: [], deps: { generate: generate as never } });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('失败耗时超预算（模拟真超时 60s）→ 不重试（不把课堂拖两倍）', async () => {
    let clock = 0;
    const generate = jest.fn(async () => {
      throw new ImageError('IMAGE_UPSTREAM_TIMEOUT', 'timed out');
    });
    const image = await generateTeachingVisual({
      request,
      messages: [],
      deps: {
        generate: generate as never,
        // 第一次调用=起始时间，第二次（预算检查）已过去 61s
        now: () => { clock += 61_000; return new Date(clock); },
      },
    });
    expect(image).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('重试成功后正常返回图（留痕 provider/model/prompt）', async () => {
    let calls = 0;
    const generate = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ImageError('IMAGE_EMPTY_RESULT', '0 images');
      return okResult;
    });
    const image = await generateTeachingVisual({ request, messages: [], deps: { generate: generate as never } });
    expect(image!.provider).toBe('agnes');
    expect(image!.prompt).toContain('直角三角形');
  });
});

describe('教学配图规格（kind/prompt → 精确尺寸 + 同向 ratio，代码裁决）', () => {
  it('横向 → 16:9(1312x736)；对比 → 4:3；层级/纵向 → 3:4；未命中/空 → 1:1', () => {
    expect(resolveTeachingVisualSpec('流程图')).toEqual({ size: '1312x736', ratio: '16:9' });
    expect(resolveTeachingVisualSpec('位置线')).toEqual({ size: '1312x736', ratio: '16:9' });
    expect(resolveTeachingVisualSpec('时序图')).toEqual({ size: '1312x736', ratio: '16:9' });
    expect(resolveTeachingVisualSpec('对比图')).toEqual({ size: '1152x864', ratio: '4:3' });
    expect(resolveTeachingVisualSpec('层级结构')).toEqual({ size: '864x1152', ratio: '3:4' });
    expect(resolveTeachingVisualSpec('示意图')).toEqual({ size: '1024x1024', ratio: '1:1' });
    // 实测：老师常把 kind 写成笼统"示意图"，方向线索在 prompt 里（提示词已要求注明"横向构图"）
    expect(resolveTeachingVisualSpec('示意图', '一条水平位置线，左端标后、右端标前')).toEqual({ size: '1312x736', ratio: '16:9' });
    expect(resolveTeachingVisualSpec('示意图', '一条位置线：甲在前、乙在后')).toEqual({ size: '1312x736', ratio: '16:9' });
    expect(resolveTeachingVisualSpec('示意图', '横向关系用横向构图')).toEqual({ size: '1312x736', ratio: '16:9' });
    expect(resolveTeachingVisualSpec('示意图', '纵向层级结构，上层是总类')).toEqual({ size: '864x1152', ratio: '3:4' });
    // 回归（实测）：横向位置线里出现"用一条竖直虚线标出间隔距离"（描述辅助线），曾被误判成纵向
    expect(
      resolveTeachingVisualSpec('示意图', '一条从左到右的直线小路……用一条竖直虚线标出小明和小红之间的间隔距离。')
    ).toEqual({ size: '1312x736', ratio: '16:9' });
    expect(resolveTeachingVisualSpec(null)).toEqual({ size: '1024x1024', ratio: '1:1' });
    expect(resolveTeachingVisualSpec('')).toEqual({ size: '1024x1024', ratio: '1:1' });
  });
});

describe('教学配图时机（S1：老师用字符画结构）', () => {
  const assistant = (content: string, images: TeachingSessionMessage['images'] = []): TeachingSessionMessage => ({
    role: 'assistant',
    content,
    timestamp: '2026-09-23T00:00:00.000Z',
    ...(images && images.length ? { images } : {}),
  });

  it('detectAsciiStructure：真的字符结构图为真；行文里单个箭头为假', () => {
    expect(detectAsciiStructure('这条线是：甲（前）●———→ 方向 →')).toBe(true);
    expect(detectAsciiStructure('    西 ←───────────────→ 东\n    ┌────┬───────┬───────┐\n        小明     小红')).toBe(true);
    // 实测漏网：只有箭头、且只有一种结构字符（首版 ≥3 且 ≥2 种会漏）
    expect(detectAsciiStructure('**（前面）小明 → 走的方向 → （后面）小红**')).toBe(true)
    expect(detectAsciiStructure('先看方向：甲→乙，再看前后')).toBe(false);
    expect(detectAsciiStructure('')).toBe(false);
    expect(detectAsciiStructure(null)).toBe(false);
  });

  it('上一轮画了字符结构 且 本任务还没配过图 → suggested=true', () => {
    const opportunity = buildVisualOpportunity([assistant('这条线是：甲（前）●———→ 方向 →')]);
    expect(opportunity).not.toBeNull();
    expect(opportunity!.suggested).toBe(true);
    expect(opportunity!.reason).toBe('ascii-structure');
    // 2026-09-27 双通道重构：去向从扩散生图改为**结构图（diagram/mermaid）**，且明确"别再用字符画"
    expect(opportunity!.instruction).toContain('diagram');
    expect(opportunity!.instruction).toContain('mermaid');
    expect(opportunity!.instruction).not.toContain('输出 `visual`');
  });

  it('上一轮没画字符结构 → 不出信号（不是每轮都配图）', () => {
    expect(buildVisualOpportunity([assistant('我们只看一句话：小明在小红后面。')])).toBeNull();
    expect(buildVisualOpportunity([])).toBeNull();
  });

  it('放开每任务一次后：已配过图、但紧邻上一轮又画了字符结构 → 仍出信号（总量由会话上限兜底）', () => {
    const withImage = assistant('…', [{ url: 'https://img/1.png', caption: null, prompt: 'p', provider: 'agnes', model: 'm', kind: null, createdAt: '2026-09-23T00:00:00.000Z' }]);
    // 旧口径：配过图就不再建议 → 现在只看紧邻上一轮是否画了字符结构
    expect(buildVisualOpportunity([assistant('甲（前）●———→ 方向 →'), withImage])).toBeNull();
    expect(buildVisualOpportunity([withImage, assistant('架子 → 案板边 → 盆')])).not.toBeNull();
  });

  it('两个时机开关都关 → 不出信号（回放对照）', () => {
    delete process.env.TEACHING_VISUAL_ENABLED; // 顶层 beforeEach 默认开着 visual，这里一并关掉
    process.env.TEACHING_DIAGRAM_DISABLED = '1';
    expect(buildVisualOpportunity([assistant('甲（前）●———→ 方向 →')])).toBeNull();
  });

  // 位置线时机（Scope B，2026-09-27 语料实证：学生描述完位置关系 → 外化成图请他核验）
  const user = (content: string): TeachingSessionMessage => ({ role: 'user', content, timestamp: '2026-09-27T00:00:00.000Z' });
  const assistantWithFigure = (content: string): TeachingSessionMessage => ({
    role: 'assistant',
    content,
    timestamp: '2026-09-27T00:00:00.000Z',
    figures: [{
      engine: 'svg',
      kind: 'position-line',
      axis: { min: 0, max: 100, unit: '米', ticks: [] },
      marks: [{ at: 20, label: '甲', dir: 'right' }],
      spans: [],
      guides: [],
      caption: null,
    }],
  });

  it('detectPositionDescription：位置关系描述为真；日常用语为假', () => {
    expect(detectPositionDescription('小明在小红后面 40 米，两个人都往右走')).toBe(true);
    expect(detectPositionDescription('甲在前乙在后，相距 20 米，同向追及')).toBe(true);
    expect(detectPositionDescription('我画好了：左边是小明，右边是小红，中间写 40 米')).toBe(true);
    expect(detectPositionDescription('我后面再看这个知识点')).toBe(false);
    expect(detectPositionDescription('这个函数的返回值是什么')).toBe(false);
    expect(detectPositionDescription('')).toBe(false);
  });

  it('学生描述了位置关系 → 建议输出 figure（位置线），而不是 mermaid', () => {
    const opportunity = buildVisualOpportunity([user('小明在小红后面 40 米，两个人都往右走')]);
    expect(opportunity).not.toBeNull();
    expect(opportunity!.reason).toBe('position-description');
    expect(opportunity!.instruction).toContain('figure');
    expect(opportunity!.instruction).toContain('position-line');
  });

  it('上一轮已摆过位置线 → 不重复摆；会话上限到了 → 不出信号', () => {
    expect(buildVisualOpportunity([assistantWithFigure('摆好了'), user('小明在小红后面 40 米，都往右走')])).toBeNull();
    process.env.TEACHING_FIGURE_MAX_PER_SESSION = '1';
    try {
      // 历史里已有 1 张、且上一轮不是摆图轮 → 会话上限 1 生效，不再出信号
      expect(buildVisualOpportunity([assistantWithFigure('摆好了'), assistant('下一步看速度差'), user('相距 40 米，同向追及，甲在前')])).toBeNull();
    } finally {
      delete process.env.TEACHING_FIGURE_MAX_PER_SESSION;
    }
  });

  // 结构内容时机（2026-10-18 扩图型）：老师上一轮在讲二维/多对多/象限关系
  it('detectStructuralCue：结构词 + 实质长度才为真', () => {
    expect(detectStructuralCue('一条教育建议往往服务多个目标，所以要成对摆放，看清目标和建议之间的多对多映射关系。')).toBe(true);
    expect(detectStructuralCue('对比一下这两种做法：前者看结果，后者看过程。')).toBe(false); // 太短，宁漏不误
    expect(detectStructuralCue('今天我们继续把上一段读一遍，然后你说说你的理解。')).toBe(false);
  });

  it('老师上一轮讲了二维关系 → 建议输出 figure，并带上图型选择表', () => {
    const opportunity = buildVisualOpportunity([
      assistant('评分点可以先整理成一张两维对账表：行是评分点，列是你答案的段落，逐格判断命中还是重复堆砌，这样容易看出漏答。'),
    ]);
    expect(opportunity).not.toBeNull();
    expect(opportunity!.reason).toBe('structure-content');
    expect(opportunity!.instruction).toContain('matrix');
    expect(opportunity!.instruction).toContain('bipartite');
    expect(opportunity!.instruction).toContain('position-line');
  });

  it('上一轮刚出过图 / 总量到顶 → 结构内容信号退让', () => {
    process.env.TEACHING_FIGURE_MAX_PER_SESSION = '1';
    try {
      expect(
        buildVisualOpportunity([
          assistantWithFigure('这是一张对账矩阵，逐格看命中还是重复堆砌。'),
        ]),
      ).toBeNull();
    } finally {
      delete process.env.TEACHING_FIGURE_MAX_PER_SESSION;
    }
  });

  // 任务级时机（2026-10-18）：任务标题本身就是结构关系时，任务开头就该给一次机会
  it('任务本身是二维关系 → task-structure', () => {
    const opportunity = buildVisualOpportunity([assistant('先说说你的想法。')], '把答案逐条归位到自然/社会经济两大角度');
    expect(opportunity).not.toBeNull();
    expect(opportunity!.reason).toBe('task-structure');
    expect(opportunity!.instruction).toContain('grid');
  });

  it('上一轮已出过 mermaid → 不再追问；任务不像结构关系 → 不出信号', () => {
    const withDiagram: TeachingSessionMessage = {
      role: 'assistant',
      content: '先说说你的想法。',
      timestamp: '2026-10-18T00:00:00.000Z',
      diagrams: [{ engine: 'mermaid', code: 'flowchart TD\nA-->B', caption: null }],
    };
    expect(buildVisualOpportunity([withDiagram], '把答案逐条归位到自然/社会经济两大角度')).toBeNull();
    expect(buildVisualOpportunity([assistant('先说说你的想法。')], '读一遍这段材料并复述大意')).toBeNull();
  });
});

describe('防答案泄漏硬闸门（detectExerciseLeakInReply，2026-09-24 配图审计）', () => {
  it('真实泄漏样本：同轮布置"你自己排位置"→ 判真', () => {
    // 审计样本 1 的原话（消息 [10]）
    expect(detectExerciseLeakInReply(
      '先不急着查账。我想请你在纸上（或者就在这里用文字）把这些位置横着排一遍，每个位置后面标一句「这时它还是不是一整袋」',
    )).toBe(true);
    expect(detectExerciseLeakInReply('请你把它排成一条时间线，从进货到卖出。')).toBe(true);
    expect(detectExerciseLeakInReply('在纸上画一条位置线，标出前后。')).toBe(true);
    expect(detectExerciseLeakInReply('你先摆一下这几个环节，我们再往下走。')).toBe(true);
  });

  it('正常讲解/不布置动手练习 → 判假（不误伤配图）', () => {
    expect(detectExerciseLeakInReply(
      '同样一样东西，在店里换过几个位置、被人动过之后，它在账上能对上的那个"数"就变了。第一次在架子上，是「一袋25公斤」。',
    )).toBe(false);
    expect(detectExerciseLeakInReply('这就是整件事的根子——没人记它什么时候从"整袋"变成了"半袋"。')).toBe(false);
    expect(detectExerciseLeakInReply('')).toBe(false);
    expect(detectExerciseLeakInReply(null)).toBe(false);
  });
});

describe('悬空图引用剥离（hasDanglingFigureReference / stripDanglingFigureReferences，A/B 报告 D10）', () => {
  it('识别指向不存在的图的引用：括号指引 + 第一人称"我画了…"声称', () => {
    expect(hasDanglingFigureReference('我画了一个结构示意（见图），你对照一下。')).toBe(true);
    expect(hasDanglingFigureReference('这一步看（见下图）就明白了。')).toBe(true);
    expect(hasDanglingFigureReference('我画好了结构图，你可以对照。')).toBe(true);
  });

  it('不误伤：祈使句/正常讲解/无图引用词 → 判假', () => {
    expect(hasDanglingFigureReference('你可以自己画一张流程图试试。')).toBe(false);
    expect(hasDanglingFigureReference('这里的关键是把顺序理清楚，从进货到卖出。')).toBe(false);
    expect(hasDanglingFigureReference('')).toBe(false);
    expect(hasDanglingFigureReference(null)).toBe(false);
  });

  it('剥离后不留悬空括号/重复标点（D10 逐字稿样本）', () => {
    const sample = '为了帮你把这张图看得更清楚，我画了一个结构示意（见图），你对照一下自己刚填好的三条线。';
    const out = stripDanglingFigureReferences(sample);
    expect(out).not.toContain('（见图）');
    expect(out).not.toContain('我画了');
    expect(out).not.toContain('，，');
    expect(out).not.toContain(' 。');
    expect(out).toContain('你对照一下自己刚填好的三条线');
  });
});

describe('同图去重（2026-10-19 地理课实跑：同一张三格表连出两次）', () => {
  const figure = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    engine: 'svg',
    kind: 'bins',
    spec,
    caption: null,
    ...extra,
  });
  const assistant = (figures: unknown[]) =>
    ({ role: 'assistant', content: '看这张表', figures } as unknown as TeachingSessionMessage);

  it('上一轮没有图 → 出', () => {
    expect(shouldEmitTeachingFigure([{ role: 'assistant', content: '先说说看' } as TeachingSessionMessage], figure({ bins: [{ label: '甲' }] }))).toBe(true);
  });

  it('与上一轮完全相同（kind + 规格）→ 丢；换配色/换说明句仍算同一张', () => {
    const spec = { bins: [{ label: '可迁移', items: [{ label: '气候' }] }] };
    const messages = [assistant([figure(spec, { palette: 'earth', caption: '旧说明' })])];
    expect(shouldEmitTeachingFigure(messages, figure(spec, { palette: 'tech', caption: '新说明' }))).toBe(false);
  });

  it('只改了图内标题/脚注（结构一字未变）→ 仍算同一张', () => {
    const base = { bins: [{ label: '可迁移', items: [{ label: '气候' }] }] };
    const before = [assistant([figure({ ...base, title: '旧标题', note: '旧脚注' })])];
    const after = figure({ ...base, title: '新标题', note: '学生补了一句措辞后的新脚注' });
    expect(shouldEmitTeachingFigure(before, after)).toBe(false);
  });

  it('同样的分类轴再画一张 → 不出（2026-10-20 实跑：一节里三张 bins，只改了措辞与条目数）', () => {
    // 判据从「条目变了就出」收紧为「bins 的标签没变就是同一张分类图」：
    // 修的是「老师每轮都在摆同一张表」——新条目该进正文，不该再画一遍。
    const before = [assistant([figure({ bins: [{ label: '可迁移', items: [{ label: '气候' }] }] })])];
    const after = figure({ bins: [{ label: '可迁移', items: [{ label: '气候' }, { label: '地形' }] }] });
    expect(shouldEmitTeachingFigure(before, after)).toBe(false);
  });

  it('分类轴换了 → 出（换的是问题，不是措辞）', () => {
    const before = [assistant([figure({ bins: [{ label: '可迁移' }] })])];
    const after = figure({ bins: [{ label: '不可迁移' }] });
    expect(shouldEmitTeachingFigure(before, after)).toBe(true);
  });

  it('换图型 → 出', () => {
    const messages = [assistant([{ engine: 'svg', kind: 'compare', spec: { left: {}, right: {} } }])];
    expect(shouldEmitTeachingFigure(messages, figure({ bins: [{ label: '甲' }] }))).toBe(true);
  });

  it('空图 / 无消息 → 不出（不落空壳）', () => {
    expect(shouldEmitTeachingFigure([], null)).toBe(false);
    expect(shouldEmitTeachingFigure(null, figure({ bins: [{ label: '甲' }] }))).toBe(true);
  });
});

describe('视觉教具路由（2026-10-20：形状由内容裁决，不靠模型自觉）', () => {
  it('靶盘：信度/效度类内容路由到 bullseye', () => {
    expect(chooseFigureKind('信度是稳不稳，效度是准不准，点打在靶心附近才算准')?.kind).toBe('bullseye');
    expect(chooseFigureKind('这两个指标每次测都一致，但系统性偏差很稳定')?.kind).toBe('bullseye');
  });

  it('闭环 / 交集 / 二分 / 辐射各自命中', () => {
    expect(chooseFigureKind('这四个部件是一个闭环，一轮结束还要回到起点')?.kind).toBe('cycle');
    expect(chooseFigureKind('这两个动作词最容易混，边界在哪儿要摆出来')?.kind).toBe('venn');
    expect(chooseFigureKind('一条建议往往同时服务两个目标，是多对多')?.kind).toBe('bipartite');
    expect(chooseFigureKind('幼儿园五大领域，一个总概念长出的子领域')?.kind).toBe('tree');
  });

  it('权衡 / 层级 / 归类 / 对账 / 对照：按语义落到各自的形状', () => {
    expect(chooseFigureKind('这是取舍，要看哪边更重')?.kind).toBe('balance');
    expect(chooseFigureKind('先过后一个门槛，再逐级往上')?.kind).toBe('ladder');
    expect(chooseFigureKind('把这个概念归位，分到三类里')?.kind).toBe('bins');
    expect(chooseFigureKind('逐条核一核对账，看哪一格漏了')?.kind).toBe('matrix');
    expect(chooseFigureKind('对比两种写法的区别')?.kind).toBe('compare');
  });

  it('没有结构线索 / 空文本 → 不路由（沿用原指南，不硬塞形状）', () => {
    expect(chooseFigureKind('今天我们把这段话读完')).toBeNull();
    expect(chooseFigureKind('')).toBeNull();
    expect(chooseFigureKind(null)).toBeNull();
  });

  it('提示句：命中时写出 kind 与理由；未命中返回空串', () => {
    const line = figureKindHintLine(chooseFigureKind('信度和效度'));
    expect(line).toContain('kind=bullseye');
    expect(line).toContain('稳不准');
    expect(figureKindHintLine(null)).toBe('');
  });
});

describe('路由已接进本轮输入（不是只写了个纯函数）', () => {
  const msg = (role: string, content: string) => ({ role, content, timestamp: Date.now() } as unknown as TeachingSessionMessage);

  it('讲信度×效度的回合：instruction 里带 kind=bullseye', () => {
    const opportunity = buildVisualOpportunity(
      [msg('assistant', '信度是稳不稳，效度是准不准：一组点聚不聚、偏不偏，是两件事。')],
      '区分信度与效度',
    );
    expect(opportunity?.suggested).toBe(true);
    expect(opportunity?.instruction).toContain('kind=bullseye');
  });

  it('讲闭环的回合：instruction 里带 kind=cycle', () => {
    const opportunity = buildVisualOpportunity(
      [msg('assistant', '这四个部件是一个闭环，一轮走完还要回到起点。')],
      '四部件为什么是一个环',
    );
    expect(opportunity?.instruction).toContain('kind=cycle');
  });

  it('没有结构线索：不硬塞形状（instruction 里不出现 kind=）', () => {
    const opportunity = buildVisualOpportunity([msg('assistant', '先把这段材料读完，读完我们再聊。')], '读材料');
    expect(opportunity?.instruction.includes('kind=') ?? false).toBe(false);
  });
});

describe('节奏兜底：长回合苏格拉底课至少收一张图（2026-10-20 实跑）', () => {
  const turn = (role: 'assistant' | 'user', content: string, figures?: unknown[]) => ({
    role,
    content,
    timestamp: '2026-10-20T13:00:00.000Z',
    ...(figures ? { figures } : {}),
  } as unknown as TeachingSessionMessage);

  // 真实语料：这节 15 回合 0 图，词表里一个结构词都没命中（交集/覆盖/复用/两处都不在表里）
  const qa: TeachingSessionMessage[] = [];
  for (let i = 0; i < 7; i += 1) {
    qa.push(turn('assistant', `你说得对，再往前走一步：想一想它凭什么是这样？第 ${i} 问。`));
    qa.push(turn('user', `因为它本来就该这样。第 ${i} 答。`));
  }

  it('连续 6 个老师回合没出图 → 给一次「把已站住的链收成一张图」的机会', () => {
    const opportunity = buildVisualOpportunity(qa, '把日志比对接回共识层');
    expect(opportunity?.suggested).toBe(true);
    expect(opportunity?.reason).toBe('recap-cadence');
    expect(opportunity?.instruction).toContain('收成一张图');
    expect(opportunity?.instruction).toContain('不要放进新内容');
  });

  it('不足 6 个回合 → 不打扰（保持追问节奏）', () => {
    const short = qa.slice(-4);
    expect(buildVisualOpportunity(short, '把日志比对接回共识层')).toBeNull();
  });

  it('上一轮刚出过图 → 不触发节奏兜底', () => {
    const withFigure = [...qa, turn('assistant', '这轮收个尾。', [{ kind: 'venn' }])];
    expect(buildVisualOpportunity(withFigure, '把日志比对接回共识层')).toBeNull();
  });

  it('本会话图已到上限 → 不触发（总量仍由上限兜底）', () => {
    const capped: TeachingSessionMessage[] = [
      turn('assistant', '四张图摆完了。', [{ kind: 'venn' }, { kind: 'grid' }, { kind: 'compare' }, { kind: 'tree' }]),
      ...qa,
    ];
    expect(buildVisualOpportunity(capped, '把日志比对接回共识层')).toBeNull();
  });
});

describe('形状路由：架构/请求链路 → compare 的链路形态', () => {
  it('讲架构选型与跨集群往返时，提示句要求走 compare 链路形态', () => {
    const opportunity = buildVisualOpportunity(
      [{ role: 'assistant', content: '外置 ZooKeeper 要跨集群再往返一次，自研 Raft 把共识内置进业务进程。', timestamp: '2026-10-20T00:00:00.000Z' }] as unknown as TeachingSessionMessage[],
      '架构选型：为什么自研 Raft 而不是继续用 ZooKeeper',
    );
    expect(opportunity?.instruction).toContain('kind=compare');
    expect(opportunity?.instruction).toContain('链路形态');
  });
});

describe('去重加严：同义改写与同类数量上限（2026-10-20 实跑：一节 5 张 bins）', () => {
  const msgWith = (figures: unknown[]) => ({
    role: 'assistant', content: '这轮收个尾。', timestamp: '2026-10-20T00:00:00.000Z', figures,
  } as unknown as TeachingSessionMessage);
  const bins = (labels: string[]) => ({ engine: 'svg', kind: 'bins', spec: { bins: labels.map((l) => ({ label: l, items: [] })) } });

  it('同一分类换个说法（漏判（有信号没停）→ 漏判（该停没停））→ 不出', () => {
    const before = [msgWith([bins(['漏判（有信号没停）', '误判（不该停却停）'])])];
    const after = bins(['漏判（该停没停）', '误判：不该停']);
    expect(shouldEmitTeachingFigure(before, after)).toBe(false);
  });

  it('换了一套分类轴（力类依据 vs 运动状态依据）→ 照出', () => {
    const before = [msgWith([bins(['漏判', '误判'])])];
    const after = bins(['力类依据', '运动状态依据']);
    expect(shouldEmitTeachingFigure(before, after)).toBe(true);
  });

  it('同一图型到 3 张就停手（第四种分类改走文字）', () => {
    const messages = [
      msgWith([bins(['甲一', '甲二'])]),
      msgWith([bins(['乙一', '乙二'])]),
      msgWith([bins(['丙一', '丙二'])]),
    ];
    expect(shouldEmitTeachingFigure(messages, bins(['丁一', '丁二']))).toBe(false);
  });
});
