/**
 * #112 剩余半：详情页生成条文案（阶段位次 + 心跳年龄）。
 *
 * 关键回归点：
 * - 阶段数满时不得再显示「正在准备课程（M/M）…」（那是 4 分钟假死的来源，列表页已改成
 *   「课时正在写入」）；
 * - 心跳年龄只允许说「最近一次进展在 X 前」——DTO 没有 startedAt，写成「已等待 X」是把
 *   两件事混成一句；
 * - 时钟回拨 / 坏时间戳不编造负数等待。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGenerationProgress, formatWaited, HEARTBEAT_NOTICE_MS } from '../learningPathProgress';

const detailSource = readFileSync(resolve(__dirname, '../V2LearningPathDetail.vue'), 'utf8');

const NOW = Date.parse('2026-10-18T08:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatWaited', () => {
  it('秒 / 分秒 / 小时三档', () => {
    expect(formatWaited(42_000)).toBe('42 秒');
    expect(formatWaited(220_000)).toBe('3 分 40 秒');
    expect(formatWaited(180_000)).toBe('3 分');
    expect(formatWaited(3_720_000)).toBe('1 小时 2 分');
    expect(formatWaited(3_600_000)).toBe('1 小时');
  });

  it('无效输入返回 null（不产 NaN 文案）', () => {
    expect(formatWaited(Number.NaN)).toBeNull();
    expect(formatWaited(-1)).toBeNull();
  });
});

describe('buildGenerationProgress 主行', () => {
  it('core 阶段给时长承诺（#112 的 10 分钟实测口径）', () => {
    const copy = buildGenerationProgress({ phase: 'core', completedStages: 0, totalStages: 5 }, NOW);
    expect(copy.primary).toContain('正在生成路径');
    expect(copy.primary).toContain('1-2 分钟');
  });

  it('阶段数满 → 课时正在写入（不再显示 M/M 的「准备课程」）', () => {
    const copy = buildGenerationProgress(
      { phase: 'stage_design', completedStages: 5, totalStages: 5, currentStageNumber: null },
      NOW
    );
    expect(copy.primary).toBe('课时正在写入，马上就好…');
    expect(copy.primary).not.toContain('5/5');
  });

  it('有 currentStageNumber → 显示第几阶段与已完成数', () => {
    const copy = buildGenerationProgress(
      { phase: 'stage_design', completedStages: 2, totalStages: 6, currentStageNumber: 3 },
      NOW
    );
    expect(copy.primary).toBe('正在准备第 3 阶段（已完成 2/6）…');
  });

  it('无 currentStageNumber → 退回计数文案', () => {
    const copy = buildGenerationProgress({ phase: 'stage_design', completedStages: 1, totalStages: 4 }, NOW);
    expect(copy.primary).toBe('正在准备课程（1/4）…');
  });

  it('缺阶段数（0/total=0）不产「（0/0）」', () => {
    const copy = buildGenerationProgress({ phase: 'stage_design', completedStages: 0, totalStages: 0 }, NOW);
    expect(copy.primary).toBe('正在准备课程…');
    expect(copy.primary).not.toContain('/');
  });

  it('completed 超过 total 时按 total 夹紧（脏数据不显示 7/5）', () => {
    const copy = buildGenerationProgress({ phase: 'stage_design', completedStages: 7, totalStages: 5, currentStageNumber: 9 }, NOW);
    expect(copy.primary).toBe('课时正在写入，马上就好…');
  });
});

describe('buildGenerationProgress 副行（心跳）', () => {
  it('心跳新鲜（≤60s）→ 轻量建议', () => {
    for (const age of [0, 30_000, HEARTBEAT_NOTICE_MS]) {
      const copy = buildGenerationProgress({ phase: 'stage_design', completedStages: 1, totalStages: 4, heartbeatAt: ago(age) }, NOW);
      expect(copy.secondary).toBe('你也可以先去别的页面看看。');
    }
  });

  it('心跳陈旧（>60s）→ 只声称「最近一次进展在 X 前」，不说成整场等待时长', () => {
    const copy = buildGenerationProgress(
      { phase: 'stage_design', completedStages: 1, totalStages: 4, heartbeatAt: ago(220_000) },
      NOW
    );
    expect(copy.secondary).toBe('最近一次进展在 3 分 40 秒 前，仍在生成。');
    expect(copy.secondary).not.toContain('已等待');
  });

  it('心跳缺失 / 坏时间戳 / 未来时间 → 退回轻量建议', () => {
    for (const bad of [null, undefined, 'not-a-date', new Date(NOW + 60_000).toISOString()]) {
      const copy = buildGenerationProgress({ phase: 'stage_design', completedStages: 1, totalStages: 4, heartbeatAt: bad as string | null }, NOW);
      expect(copy.secondary).toBe('你也可以先去别的页面看看。');
    }
  });
});

describe('详情页接线（防回退）', () => {
  it('生成条走 buildGenerationProgress，不再在模板里内联拼 N/M 文案', () => {
    expect(detailSource).toContain('buildGenerationProgress(lifecycle.value, genNowTick.value)');
    expect(detailSource).toContain('genProgress?.primary');
    expect(detailSource).toContain('genProgress?.secondary');
    // 旧写法（#112 假死来源）不得复活
    expect(detailSource).not.toContain('`正在准备课程（${lifecycle.completedStages}');
  });

  it('轮询推进时钟（副行的「最近一次进展 X 前」才会走）', () => {
    const poll = detailSource.slice(detailSource.indexOf('async function pollOnce'), detailSource.indexOf('async function doRetry'));
    expect(poll).toContain('genNowTick.value = Date.now()');
  });
});
