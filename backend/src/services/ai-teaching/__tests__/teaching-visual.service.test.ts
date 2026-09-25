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
  detectExerciseLeakInReply,
  generateTeachingVisual,
  hasIdenticalVisualPrompt,
  isTeachingVisualEnabled,
  isUsableVisualPrompt,
  resolveTeachingVisualMaxPerSession,
  resolveTeachingVisualMaxPerTask,
  resolveTeachingVisualSpec,
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
    expect(opportunity!.instruction).toContain('visual');
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

  it('开关关闭 → 不出信号（灰度回滚）', () => {
    process.env.TEACHING_VISUAL_DISABLED = '1';
    expect(buildVisualOpportunity([assistant('甲（前）●———→ 方向 →')])).toBeNull();
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
