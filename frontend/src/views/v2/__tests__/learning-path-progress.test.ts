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
import {
  buildPathActivityAnchor,
  formatLocalDateTime,
  formatRelativeTime,
} from '../learningPathProgress';

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
  it('core 阶段不再承诺具体分钟数（#112：实测 56 条里 34 条 >120s）', () => {
    const copy = buildGenerationProgress({ phase: 'core', completedStages: 0, totalStages: 5 }, NOW);
    expect(copy.primary).toContain('正在生成路径');
    expect(copy.primary, '时长承诺复活（2026-11-05 口径：一律不承诺时长）').not.toContain('分钟');
    expect(copy.primary, '用户侧文案又写回了 1-2/1-3 分钟的数值承诺').not.toMatch(/1-[23]\s*分钟/);
  });

  it('阶段数满 → 课时正在写入（不再显示 M/M 的「准备课程」）', () => {
    const copy = buildGenerationProgress(
      { phase: 'stage_design', completedStages: 5, totalStages: 5, currentStageNumber: null },
      NOW
    );
    expect(copy.primary).toBe('课时正在写入…');
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
    expect(copy.primary).toBe('课时正在写入…');
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

/* 2026-11-11 走查：路径列表四张卡都只写「已完成 / 100%」，分不出新旧。
   时间锚点抽成纯函数，列表页与学习台共用；这里锁相对时间分档与「最近学习 > 更新 > 创建」优先级。 */
describe('路径时间锚点（2026-11-11 用户侧走查 #4）', () => {
  const NOW = Date.parse('2026-11-11T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const DAY = 24 * 60 * 60 * 1000;

  it('相对时间分档：刚刚 / 分钟 / 小时 / 昨天 / 天前 / 超 30 天回落日期', () => {
    expect(formatRelativeTime(ago(30_000), NOW)).toBe('刚刚');
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe('5 分钟前');
    expect(formatRelativeTime(ago(3 * 3_600_000), NOW)).toBe('3 小时前');
    expect(formatRelativeTime(ago(26 * 3_600_000), NOW)).toBe('昨天');
    expect(formatRelativeTime(ago(4 * DAY), NOW)).toBe('4 天前');
    expect(formatRelativeTime(ago(45 * DAY), NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('坏时间戳不产 NaN；未来时间按「刚刚」处理', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
    expect(formatRelativeTime(null, NOW)).toBe('');
    expect(formatRelativeTime(ago(-60_000), NOW)).toBe('刚刚');
    expect(formatLocalDateTime('not-a-date')).toBe('');
  });

  it('优先任务完成时间（真实学习），并给绝对时间 title', () => {
    const anchor = buildPathActivityAnchor(
      {
        createdAt: ago(10 * DAY),
        updatedAt: ago(9 * DAY),
        tasks: [{ completedAt: ago(2 * 3_600_000) }, { completedAt: ago(5 * DAY) }],
      },
      NOW
    );
    expect(anchor?.text).toBe('最近学习 2 小时前');
    expect(anchor?.title).toContain('最近学习');
    expect(anchor?.title).toContain('创建于');
  });

  it('没有完成记录时：创建后没变过 → 创建于；改过 → 更新于', () => {
    const createdOnly = buildPathActivityAnchor(
      { createdAt: ago(3 * DAY), updatedAt: ago(3 * DAY), tasks: [] },
      NOW
    );
    expect(createdOnly?.text).toBe('创建于 3 天前');

    const updated = buildPathActivityAnchor(
      { createdAt: ago(10 * DAY), updatedAt: ago(2 * 3_600_000), tasks: [] },
      NOW
    );
    expect(updated?.text).toBe('更新于 2 小时前');
  });

  it('全部字段缺失返回 null：不编造「刚刚」', () => {
    expect(buildPathActivityAnchor({}, NOW)).toBeNull();
    expect(buildPathActivityAnchor({ createdAt: null, updatedAt: null, tasks: [{ completedAt: null }] }, NOW)).toBeNull();
  });
});
