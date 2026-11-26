/**
 * 2026-11-25 全站走查（PC 1440/1024 + 移动 390/320）的回归锁。
 *
 * 本轮量到并修掉的四类问题：
 * ① 资料库 901~1100 档内衬仍是 28px，1024 实测内容轨 69..955，邻页 55..969；
 * ② 路径详情面包屑尾巴与下方 h1 同名，同一行路径名连出两次；
 * ③ 学习状态：卡头「待确认」与「待我处理」重复表态、上方摘要与待确认卡重复同一条依据；
 *    320 下指标数值被拆行 / 档位签被省略、复习清单条目名被省略；
 * ④ 课堂页 320：任务名两行仍截尾、副标题只剩被省略的路径名，节次丢失。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');

const library = read('../V2Library.vue');
const detail = read('../V2LearningPathDetail.vue');
const state = read('../V2LearningState.vue');
const dashboard = read('../V2Dashboard.vue');
const learn = read('../V2LearningPage.vue');

describe('资料库内容轨：901~1100 与邻页同一条 14px 边线', () => {
  it('≤1100 只补横向内衬，纵向留白交给 ≤720 档', () => {
    const block = library.slice(library.indexOf('@media (max-width: 1100px)'));
    const rule = block.slice(0, block.indexOf('.library__main {') + 200);
    expect(rule).toMatch(/padding-left:\s*14px/);
    expect(rule).toMatch(/padding-right:\s*14px/);
  });
});

describe('路径详情：路径名只在 hero h1 出现一次', () => {
  it('面包屑只剩返回链', () => {
    const crumbs = detail.slice(detail.indexOf('<div class="crumbs">'), detail.indexOf('<!-- 加载 -->'));
    expect(crumbs).toContain('‹ 路径列表');
    expect(crumbs).not.toContain('crumbs__current');
    expect(crumbs).not.toContain('crumbs__sep');
    expect(detail).not.toMatch(/\.crumbs__current\s*\{/);
  });

  it('h1 仍由 pathTitle 承担可见标题', () => {
    expect(detail).toMatch(/<h1>\{\{\s*pathTitle\s*\}\}<\/h1>/);
  });
});

describe('学习状态：同一状态与同一条依据只说一次', () => {
  it('卡头不再挂「待确认」角标（状态由「待我处理 N」承担）', () => {
    expect(state).not.toContain('advisory__pending');
    expect(state).toContain('待我处理');
  });

  it('有待确认卡时，上方摘要不复读同一条课堂依据', () => {
    expect(state).toContain('v-if="evidenceHint && !pendingAdjust.length"');
  });
});

describe('学习状态 320：数值/档位/条目名不靠省略号保命', () => {
  it('指标脚部在 ≤360 改为纵排，数值与单位不断开', () => {
    const narrow = state.slice(state.indexOf('@media (max-width: 360px)'));
    expect(narrow).toContain('.vitals--meta .vitals__foot');
    expect(narrow).toMatch(/flex-direction:\s*column/);
    expect(state).toMatch(/\.vitals--meta b \{[^}]*white-space:\s*nowrap/);
  });

  it('复习清单 ≤360 改两行：名称独占一行，进度条与百分比在下一行', () => {
    const narrow = state.slice(state.lastIndexOf('@media (max-width: 360px)'));
    expect(narrow).toContain('grid-template-areas: "name name" "bar pct"');
    expect(narrow).toMatch(/\.rlist__name \{[^}]*white-space:\s*normal/);
  });

  it('调控卡头 ≤640 允许换行，路径名不再被药丸省略号截断', () => {
    const block = state.slice(state.indexOf('@media (max-width: 640px)'));
    expect(block).toMatch(/\.ctl-card__head \{[^}]*flex-wrap:\s*wrap/);
  });
});

describe('学习台：今日格与成就提示在 320 读完', () => {
  it('今日格用两字「今天」，不再被省略成「待…」', () => {
    expect(dashboard).toContain("d.isToday ? '今天' : '—'");
    expect(dashboard).not.toContain("d.isToday ? '待点亮' : '—'");
  });

  it('成就提示不用「·」分隔，换行后不以标点起行', () => {
    expect(dashboard).toContain('progress: `进度 ${prog}`');
    expect(dashboard).not.toMatch(/progress: `·\s*进度/);
  });
});

describe('课堂页 320：任务名读完、节次保住', () => {
  it('≤360 标题放宽到三行，路径名让位给节次', () => {
    const narrow = learn.slice(learn.indexOf('@media (max-width: 360px)'));
    expect(narrow).toContain('-webkit-line-clamp: 3');
    expect(narrow).toContain('.learn__pathname { display: none; }');
    expect(learn).toContain('class="learn__pathname"');
  });
});
