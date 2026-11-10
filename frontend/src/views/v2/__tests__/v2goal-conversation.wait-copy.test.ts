/**
 * 目标规划等待态文案的护栏（2026-11-06 用户裁定）
 *
 * 截图里三点气泡下面那行是「正在梳理关键信息… · 已等待 11s」。用户要求去掉秒数：
 * 阶段文案本身随 tick 推进（正在梳理关键信息… → 正在拆解阶段… → 正在排布任务…），
 * 已经说明「还在走」；一串一直在涨的秒数只增加焦虑、不增加信息。
 *
 * 本护栏锁两件事：
 *  1) 等待态不再出现「已等待 Ns」这类计时读数（模板与脚本都不得残留）；
 *  2) 阶段文案本身必须保留——去的是秒数，不是状态反馈。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');

describe('等待态：报做什么，不报等了多久', () => {
  it('「已等待 Ns」整层撤除（脚本与模板都不许残留）', () => {
    /* 注释里会复述这条裁定（「去掉 已等待 11s」），所以先剥注释再断 */
    const live = source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(live).not.toContain('已等待');
    expect(live, 'chatWaitMeta 这层间接已被撤除').not.toContain('chatWaitMeta');
  });

  it('阶段文案仍在（去掉的是秒数，不是状态反馈）', () => {
    expect(source).toContain('正在梳理关键信息…');
    expect(source).toContain('const chatWaitText = computed');
    /* 两处等待渲染（首个 delta 前 / 流式进行中）都直接读阶段文案 */
    const reads = source.match(/\{\{ chatWaitText \}\}/g) ?? [];
    expect(reads.length, `等待文案渲染点应为 2 处，实际 ${reads.length}`).toBe(2);
  });

  it('三点气泡仍在（等待的首个视觉信号不能被一起删掉）', () => {
    expect(source).toContain('msg__bubble--typing');
  });
});
