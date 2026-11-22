/**
 * 画像页「评审报告」入口的黑盒模式门（2026-11-22 审计 P2）：
 * 裁判后端硬性要求 experiment.mode === 'blackbox-api'（blackbox-runner.referee），
 * 而启动弹窗默认 assisted——终态运行行若不判模式，大多数运行挂着点了必 502 的按钮。
 * 画像页挂载需整套 live 域 mock（重），按仓内判例做源码级契约断言：
 *  ① runs 映射从 stageResults.experiment.mode 提取 mode（缺省 assisted）；
 *  ② 入口判据 = 终态 && mode==='blackbox-api'；
 *  ③ 跳转带 fromProfile（评审报告页据此给「返回画像」）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'VirtualProfile.vue'), 'utf8');

describe('VirtualProfile 评审报告入口模式门', () => {
  it('runs 映射提取 experiment.mode（缺省 assisted），stageResults 只解析一次', () => {
    expect(src).toContain("mode: (sr as any)?.experiment?.mode ? String((sr as any).experiment.mode) : 'assisted'");
    // paused/durationMs/mode 共用同一份 sr：不再各自 JSON.parse
    const parses = src.match(/JSON\.parse\(s\.stageResults/g) || [];
    expect(parses.length, 'runs 映射内 stageResults 只解析一次').toBe(1);
  });

  it('入口判据含黑盒模式门（不渲染 assisted 运行的评审报告按钮）', () => {
    expect(src).toContain("AUDITABLE_RUN_STATES.includes(runDisplayState(r)) && r.mode === 'blackbox-api'");
  });

  it('跳转带 fromProfile=当前画像 id（报告页返回入口的数据源）', () => {
    expect(src).toContain('fromProfile: pid');
  });
});
