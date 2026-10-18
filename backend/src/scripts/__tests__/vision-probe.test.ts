/**
 * 视觉探针的判据与参数解析（#123）：探针是"声明的把关工具"，
 * 判据必须对真实模型的自由措辞足够宽，又要能拒绝"没读图"的回答。
 */
import { judgeVisionProbeAnswer, parseProbeArgs, buildProbeImagePng } from '../vision-probe';

describe('parseProbeArgs', () => {
  it('解析 --model=（可多次）/ --image= / --stream / --history-image', () => {
    expect(parseProbeArgs(['--model=a', '--model=b', '--image=./x.png'])).toEqual({
      models: ['a', 'b'], image: './x.png', stream: false, historyImage: false,
    });
    expect(parseProbeArgs(['--stream'])).toEqual({ models: [], image: undefined, stream: true, historyImage: false });
    expect(parseProbeArgs(['--history-image'])).toEqual({ models: [], image: undefined, stream: false, historyImage: true });
    expect(parseProbeArgs([])).toEqual({ models: [], image: undefined, stream: false, historyImage: false });
  });
});

describe('buildProbeImagePng', () => {
  it('产出合法 PNG 头（确定性图案，无外部依赖）', () => {
    const png = buildProbeImagePng();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  });
});

describe('judgeVisionProbeAnswer', () => {
  it('真读图（真实模型回答样例）→ PASS', () => {
    const verdict = judgeVisionProbeAnswer(
      '1. 从左到右依次是红色、绿色、蓝色三个色块；2. 中间的绿色色块最宽；3. 左侧的红色色块最窄。'
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.checks).toEqual({ colors: true, order: true, widestGreen: true, narrowestRed: true });
  });

  it('英文回答同样 PASS', () => {
    const verdict = judgeVisionProbeAnswer(
      'From left to right: red, green, blue. The green block is the widest. The narrowest block is red.'
    );
    expect(verdict.pass).toBe(true);
  });

  it('颜色顺序反了 → FAIL（不是顺着文字蒙）', () => {
    const verdict = judgeVisionProbeAnswer('从左到右是蓝色、绿色、红色；绿色最宽；红色最窄。');
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.order).toBe(false);
  });

  it('宽度归属读错（最宽说成红色）→ FAIL', () => {
    const verdict = judgeVisionProbeAnswer('从左到右是红绿蓝；最宽的是红色色块；最窄的是蓝色。');
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.widestGreen).toBe(false);
    expect(verdict.checks.narrowestRed).toBe(false);
  });

  it('没读图（只有颜色没有宽窄事实）→ FAIL', () => {
    const verdict = judgeVisionProbeAnswer('图中有红绿蓝三种颜色的色块。');
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.widestGreen).toBe(false);
  });

  it('空回答 → FAIL 且不抛错', () => {
    expect(judgeVisionProbeAnswer('').pass).toBe(false);
    expect(judgeVisionProbeAnswer(undefined as unknown as string).pass).toBe(false);
  });
});
