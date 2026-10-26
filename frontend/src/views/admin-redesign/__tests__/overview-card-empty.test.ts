/**
 * 总览 Row B/Row C 小卡的 0 行空态（2026-10-24 用户「最近事件设计有问题」）。
 *
 * 症状：最近事件卡里 feed 容器无条件渲染且 flex:1 撑满，0 行时那条「近 24h 暂无动态」小字
 * 被顶到卡片最底部（卡头之下两百多像素空白）。
 * 口径：同页四张卡（活跃学习者 / 调用量 Top 5 / 待处理事项 / 最近事件）的 0 行态统一走
 * MkEmptyState + 卡内居中，不留「小字吊在卡底」；卡头列名用可数的全名（调用次数 / 失败次数）。
 * 本页数据由 live 总览装配（组件挂载需整套 mock），故按仓内判例（token-cost-layout.test.ts）
 * 做源码级契约断言。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, '..', f), 'utf8');

describe('总览小卡 0 行空态与列名', () => {
  const src = read('Overview.vue');

  it('最近事件：有事件才渲染 feed 容器，0 行走卡内居中空态（不再有挂在卡底的 note）', () => {
    expect(src).toContain('v-if="feedRows.length"');
    // 空态是共享原语 + 居中类，而不是 <p class="note"> 小字
    expect(src).toMatch(/<MkEmptyState[\s\S]{0,200}class="ov-card__empty"/);
    expect(src).not.toContain('近 24h 暂无动态。</p>');
  });

  it('四张卡的空态同律：卡体转 flex 列 + 空态吃掉剩余高度并居中', () => {
    for (const cls of ['.ov-card--rank', '.ov-card--todo', '.ov-card--chart', '.ov-card--feed']) {
      expect(src, `${cls} 缺 flex 列规则`).toContain(`${cls} .ov-card__body`);
    }
    expect(src).toContain('.ov-card__empty { flex: 1; place-content: center; }');
  });

  it('空态骨架带「为什么空 + 下一步」，不是一行只有标题的空壳', () => {
    // 四处 0 行空态都同时给了 title 与 description
    const empties = src.match(/<MkEmptyState[\s\S]*?\/>/g) || [];
    const cardEmpties = empties.filter((b) => b.includes('ov-card__empty'));
    expect(cardEmpties).toHaveLength(4);
    for (const b of cardEmpties) {
      expect(b, `缺 description：${b.slice(0, 60)}`).toContain('description=');
    }
  });

  it('空态只留一句事实：不写「有调用后会…」「有动静就会…」这类教学第二句', () => {
    expect(src).not.toContain('有调用后会按调用次数从多到少排行');
    expect(src).not.toContain('有人开始学习后');
    expect(src).not.toContain('有需要处理的会出现在这里');
    expect(src).not.toContain('有动静就会出现在这里');
  });

  it('列名用可数的全名：调用次数 / 失败次数（表头与定宽同改，保像素级对齐）', () => {
    expect(src).toContain('>调用次数</span>');
    expect(src).toContain('>失败次数</span>');
    expect(src).toContain('.rankrow__calls { width: 76px;');
    expect(src).toContain('.rankrow__failed { width: 64px;');
    expect(src).toContain('.rankrow__col-failed { width: 64px;');
  });
});
