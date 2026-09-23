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
  generateTeachingVisual,
  isTeachingVisualEnabled,
  isUsableVisualPrompt,
  resolveTeachingVisualMaxPerSession,
  resolveTeachingVisualMaxPerTask,
  resolveTeachingVisualSpec,
} from '../teaching-visual.service';
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

afterEach(() => {
  delete process.env.TEACHING_VISUAL_DISABLED;
  delete process.env.TEACHING_VISUAL_MAX_PER_SESSION;
  delete process.env.TEACHING_VISUAL_MAX_PER_TASK;
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

  it('开关关闭（TEACHING_VISUAL_DISABLED=1）→ 不生成（灰度回滚）', async () => {
    process.env.TEACHING_VISUAL_DISABLED = '1';
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

  it('每任务硬闸门：本任务已有 1 张 → 不再生成（默认每任务 1 张）', async () => {
    // 实测踩坑：模型会**自行**触发 visual，"同一任务最多配一次"只写在提示词里挡不住（一次任务出了 3 张）
    const messages = [messageWithImages(1)];
    const generate = jest.fn();
    expect(await generateTeachingVisual({ request, messages, deps: { generate: generate as never } })).toBeNull();
    expect(generate).not.toHaveBeenCalled();
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
    expect(prompt).toContain('白底');
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
    expect(opportunity!.instruction).toContain('visual');
  });

  it('上一轮没画字符结构 → 不出信号（不是每轮都配图）', () => {
    expect(buildVisualOpportunity([assistant('我们只看一句话：小明在小红后面。')])).toBeNull();
    expect(buildVisualOpportunity([])).toBeNull();
  });

  it('本任务已配过图 → 不再建议（每任务 ≤1）', () => {
    const withImage = assistant('…', [{ url: 'https://img/1.png', caption: null, prompt: 'p', provider: 'agnes', model: 'm', kind: null, createdAt: '2026-09-23T00:00:00.000Z' }]);
    expect(buildVisualOpportunity([assistant('甲（前）●———→ 方向 →'), withImage])).toBeNull();
  });

  it('开关关闭 → 不出信号（灰度回滚）', () => {
    process.env.TEACHING_VISUAL_DISABLED = '1';
    expect(buildVisualOpportunity([assistant('甲（前）●———→ 方向 →')])).toBeNull();
  });
});
