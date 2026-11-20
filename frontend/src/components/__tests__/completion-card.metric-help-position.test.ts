/**
 * 指标说明浮层的位置护栏（2026-11-20 真课 390/320 截图实锤）：
 * 三列指标在窄屏每张卡只有 75px，ⓘ 浮层若固定 240px 且右对齐，首列会整块跑到负坐标；
 * 长期状态是两列，每行第一张都有同样问题。
 * 现在：宽度收到 55vw，左列从图标左缘向右展开，其余列仍右对齐。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../CompletionCard.vue'), 'utf8').replace(/\s+/g, ' ');

describe('CompletionCard 指标说明浮层不越出屏幕', () => {
  it('宽度按视口收窄，320 档不再固定 240px', () => {
    expect(source).toContain('.metric-help__body {');
    expect(source).toContain('width: min(240px, 55vw);');
    expect(source).not.toContain('width: min(240px, 70vw);');
  });

  it('窄屏首列改为左对齐，覆盖三列表现卡与两列长期卡', () => {
    expect(source).toContain('#sec-perf .metric-card:first-child .metric-help__body');
    expect(source).toContain('#sec-longterm .metric-card:first-child .metric-help__body');
    expect(source).toContain('#sec-longterm .metric-card:nth-child(odd) .metric-help__body');
    expect(source).toMatch(/#sec-perf \.metric-card:first-child \.metric-help__body,[\s\S]{0,200}left: 0; right: auto;/);
  });
});
