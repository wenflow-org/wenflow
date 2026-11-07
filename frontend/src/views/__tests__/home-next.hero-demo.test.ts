/**
 * 首页 Hero 演示「播一次就停」护栏（2026-11-07 用户反馈）
 *
 * 用户原话：「首页这个地方循环播放了」，截图里整张目标规划卡是半透明的灰卡。
 * 病根是时间轴末尾的「淡出重播」：phase 7 做整卡 opacity:0 + 上浮，250ms 后回
 * phase 0 再来一轮，且上限是**两轮**（demoLoops >= 2）。淡出那一帧正是截图里的
 * 半透明卡；落地页上等于每隔几秒闪一下再重来，读起来像卡住重启。
 *
 * 修法：时间轴跑到结果态即止，删掉淡出/回 0 两项，观察器只在首次进视口时启动
 * 时间轴并随即 disconnect（不再充当「离开暂停、回来续播」的开关）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../HomeNext.vue'), 'utf8');
const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
const css = source.slice(source.indexOf('<style'));

describe('首页 Hero 演示：只播一次并停在结果（2026-11-07）', () => {
  it('时间轴不再有淡出/回到起点的循环项', () => {
    expect(script, '时间轴里还有 phase 7（整卡淡出）').not.toContain('[7, 300]');
    expect(script, '时间轴里还有回 phase 0 的重播项').not.toMatch(/\[0,\s*\d+\]/);
    expect(script, '循环计数又回来了').not.toContain('demoLoops');
  });

  it('不再有两轮上限的旁路（那不是「停」而是「再播一遍」）', () => {
    expect(script, 'demoLoops >= 2 的分支说明循环上限还在').not.toContain('>= 2');
    expect(script).toContain('demoDone');
    expect(script, '时间轴走完没有置终态').toMatch(/demoIndex >= demoTimeline\.length[\s\S]{0,80}demoDone = true/);
  });

  it('淡出样式整套退役（截图里那张半透明卡就是它）', () => {
    expect(source, '模板还挂着 is-fading').not.toContain("'is-fading'");
    expect(css, 'is-fading 规则还在，说明只删了模板没删样式').not.toMatch(/\.hn-stage__chat\.is-fading\s*\{/);
    expect(css, '整卡 opacity 过渡会让它在任何重绘时发灰').not.toMatch(/\.hn-stage__chat\s*\{[^}]*transition:[^}]*opacity/);
  });

  it('观察器只负责「首次进视口启动」，不再按进出视口反复开关时间轴', () => {
    expect(script, '离屏分支又接回了 stopDemo（成开关后重进视口会重新计时）').not.toMatch(/else\s*\{\s*stopDemo\(\)/);
    expect(script, '启动后没断开观察器，重进视口还能再启动一轮').toContain('demoObserver?.disconnect()');
    expect(script, 'demoVisible 初值应为 false：进视口前不该开播').toContain('let demoVisible = false');
  });

  it('静态兜底仍在：reduced-motion 直接停在完成态（phase 99）', () => {
    expect(script).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(script).toContain('? 99');
  });
});
