/**
 * 学习负荷 PMC 引擎（learning-load.pmc）单测
 *
 * 三条不变量：
 *  ① **单课日不漂移**：单课日 D_day=单节 LSS，新引擎推进一次 = 旧模型（按课 EWMA）推进一次，逐字一致；
 *  ② **多课日真的累加**：一天 N 节课 → 当日负荷求和 → KTL/LF 明显高于"只上 1 节"；
 *  ③ **空闲日自然回落**：D_day=0 推进 → KTL/LF 按各自半衰期衰减，不归零、单调降。
 */
import {
  PMC_KTL_LAMBDA,
  PMC_LF_LAMBDA,
  PMC_KTL_HALF_LIFE_DAYS,
  PMC_LF_HALF_LIFE_DAYS,
  lambdaForHalfLife,
  halfLifeForLambda,
  stepPmc,
  replayDailySeries,
  buildDailyLoadSeries,
  deriveFormState,
  classifyForm,
  type FormThresholds,
} from '../learning-load.pmc';
import { dedupeLessonRows, replayDailyPmc } from '../learning-load-pmc.service';

/** 旧模型（learning-state.service 的按课 EWMA）复刻：单课日应与新引擎逐字一致 */
const legacyStep = (prevKtl: number, prevLf: number, lss: number) => ({
  ktl: PMC_KTL_LAMBDA * prevKtl + (1 - PMC_KTL_LAMBDA) * lss,
  lf: PMC_LF_LAMBDA * prevLf + (1 - PMC_LF_LAMBDA) * lss,
});

describe('λ ↔ 半衰期换算', () => {
  it('沿用旧模型的 λ，半衰期仍为 13.5 / 1.9 天', () => {
    expect(PMC_KTL_LAMBDA).toBe(0.95);
    expect(PMC_LF_LAMBDA).toBe(0.7);
    expect(PMC_KTL_HALF_LIFE_DAYS).toBeCloseTo(13.51, 1);
    expect(PMC_LF_HALF_LIFE_DAYS).toBeCloseTo(1.94, 1);
  });

  it('lambdaForHalfLife / halfLifeForLambda 互逆', () => {
    for (const h of [1, 1.9, 7, 13.5, 42]) {
      expect(halfLifeForLambda(lambdaForHalfLife(h))).toBeCloseTo(h, 6);
    }
    expect(lambdaForHalfLife(0)).toBe(0);
    expect(halfLifeForLambda(1)).toBe(0);
  });
});

describe('单课日不漂移（与旧模型逐字一致）', () => {
  it('单课日 stepPmc == 旧按课 EWMA 一步', () => {
    const prev = { ktl: 5.6, lf: 2.2 };
    const lss = 4.0;
    const next = stepPmc(prev, lss);
    const legacy = legacyStep(prev.ktl, prev.lf, lss);
    expect(next.ktl).toBeCloseTo(legacy.ktl, 12);
    expect(next.lf).toBeCloseTo(legacy.lf, 12);
    expect(next.lsb).toBeCloseTo(next.ktl - next.lf, 12);
    expect(next.dayLoad).toBe(lss);
  });

  it('连续 N 个单课日（每日 1 节）与旧模型逐课推进逐字一致', () => {
    const dailyLss = [4, 5, 3, 6, 4];
    const pmc = replayDailySeries(dailyLss);
    let ktl = 0;
    let lf = 0;
    for (const lss of dailyLss) {
      const s = legacyStep(ktl, lf, lss);
      ktl = s.ktl;
      lf = s.lf;
    }
    expect(pmc[pmc.length - 1].ktl).toBeCloseTo(ktl, 12);
    expect(pmc[pmc.length - 1].lf).toBeCloseTo(lf, 12);
  });
});

describe('多课日真的累加', () => {
  it('一天 3 节课（各 LSS 5）比一天 1 节（LSS 5）更累', () => {
    const oneLessonADay = replayDailySeries([5]);
    const threeLessonsADay = replayDailySeries([15]); // 同一日的 3 节 LSS 之和
    expect(threeLessonsADay[0].lf).toBeGreaterThan(oneLessonADay[0].lf);
    expect(threeLessonsADay[0].ktl).toBeGreaterThan(oneLessonADay[0].ktl);
    // LF 快，3 节之和应贴近但不超过当日负荷
    expect(threeLessonsADay[0].lf).toBeCloseTo(PMC_LF_LAMBDA * 0 + (1 - PMC_LF_LAMBDA) * 15, 9);
  });

  it('旧模型口径下"一天 3 节"确实读不到累加（对照，说明为什么必须日负荷求和）', () => {
    // 旧模型：一天 3 节课各自推进一次 EWMA（前值递推）
    let ktl = 0;
    let lf = 0;
    for (let i = 0; i < 3; i += 1) {
      const s = legacyStep(ktl, lf, 5);
      ktl = s.ktl;
      lf = s.lf;
    }
    const legacyThree = { ktl, lf };
    // 新模型：日负荷求和后再推进一次
    const pmcThree = stepPmc({ ktl: 0, lf: 0 }, 15);
    expect(pmcThree.lf).toBeGreaterThan(legacyThree.lf);
    expect(pmcThree.ktl).toBeGreaterThan(legacyThree.ktl);
    // 旧模型 3 次递推趋近单节 LSS(5)，新模型趋向 15 的一半——量级差距明显
    expect(legacyThree.lf).toBeLessThan(5);
    expect(pmcThree.lf).toBeGreaterThan(4);
  });

  it('高认知负荷单课（LSS 8）能顶过低负荷两节（各 LSS 3）', () => {
    const heavyOne = stepPmc({ ktl: 0, lf: 0 }, 8);
    const lightTwo = stepPmc({ ktl: 0, lf: 0 }, 6); // 3+3
    expect(heavyOne.lf).toBeGreaterThan(lightTwo.lf);
  });
});

describe('空闲日自然回落', () => {
  it('空闲日以 0 参与：KTL/LF 单调降、不归零、各自按半衰期', () => {
    const afterLoad = stepPmc({ ktl: 0, lf: 0 }, 10); // 先累一天
    const idle = replayDailySeries([0, 0, 0], { ktl: afterLoad.ktl, lf: afterLoad.lf });
    // 单调降
    expect(idle[0].lf).toBeLessThan(afterLoad.lf);
    expect(idle[1].lf).toBeLessThan(idle[0].lf);
    expect(idle[2].lf).toBeLessThan(idle[1].lf);
    // 半衰期精确：3 天空闲后 LF = 初值 × λl^3，KTL = 初值 × λk^3
    expect(idle[2].lf).toBeCloseTo(afterLoad.lf * Math.pow(PMC_LF_LAMBDA, 3), 9);
    expect(idle[2].ktl).toBeCloseTo(afterLoad.ktl * Math.pow(PMC_KTL_LAMBDA, 3), 9);
    // 不归零
    expect(idle[2].lf).toBeGreaterThan(0);
    expect(idle[2].ktl).toBeGreaterThan(0);
  });

  it('空闲 13.5 天后 KTL 恰好减半（半衰期定义）', () => {
    const start = stepPmc({ ktl: 0, lf: 0 }, 10);
    const idle = replayDailySeries(Array(14).fill(0), { ktl: start.ktl, lf: start.lf });
    // 14 天 ≈ 13.5 天半衰期附近
    expect(idle[13].ktl / start.ktl).toBeLessThan(0.55);
    expect(idle[13].ktl / start.ktl).toBeGreaterThan(0.45);
  });
});

describe('buildDailyLoadSeries（逐日铺平、缺日填 0）', () => {
  const addDays = (key: string, days: number) => {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  };

  it('覆盖 [from, to]，缺日补 0，有值日取原值', () => {
    const byDay = new Map([['2026-10-01', 5], ['2026-10-03', 9]]);
    const series = buildDailyLoadSeries(byDay, '2026-10-01', '2026-10-04', addDays);
    expect(series.map((p) => p.dayKey)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(series.map((p) => p.load)).toEqual([5, 0, 9, 0]);
  });

  it('from > to 返回空；非法键不死循环', () => {
    expect(buildDailyLoadSeries(new Map(), '2026-10-05', '2026-10-01', addDays)).toEqual([]);
  });
});

describe('相对量形态（form / acwr）', () => {
  it('稳态（恒定日负荷、足够长时间）form→0、acwr→1', () => {
    // KTL 半衰期 13.5 天，从 0 起步收敛很慢——需 ~300 天才逼近稳态（LF 半衰期 1.9 天早已收敛）
    const series = replayDailySeries(Array(400).fill(4));
    const last = series[series.length - 1];
    const { form, acwr } = deriveFormState(last);
    expect(Math.abs(form)).toBeLessThan(0.05);
    expect(acwr).toBeCloseTo(1, 1);
  });

  it('负荷建立前期 form<0（KTL 追不上 LF 是慢适应通道的正常特征，非缺陷）', () => {
    const series = replayDailySeries(Array(40).fill(4));
    const { form } = deriveFormState(series[series.length - 1]);
    expect(form).toBeLessThan(0);   // 40 天远不足以让 13.5 天半衰期的 KTL 收敛
  });

  it('负荷上升期 form<0、acwr>1（急性/慢性比高，爬升风险）；休息期 form>0、acwr<1', () => {
    const rising = replayDailySeries([2, 4, 6, 8, 10, 12]);
    const rf = deriveFormState(rising[rising.length - 1]);
    expect(rf.form).toBeLessThan(0);
    expect(rf.acwr!).toBeGreaterThan(1);
    const resting = replayDailySeries(Array(10).fill(0), { ktl: 8, lf: 8 });
    const sf = deriveFormState(resting[resting.length - 1]);
    expect(sf.form).toBeGreaterThan(0);
    expect(sf.acwr!).toBeLessThan(1);
  });

  it('ktl≈0 时 acwr 为 null（长期空闲，没有适应基座）', () => {
    expect(deriveFormState({ ktl: 0, lf: 0 }).acwr).toBeNull();
  });

  it('classifyForm：overreached 由 form 定，strained 由 acwr 定，fresh 由 form 定', () => {
    const th: FormThresholds = { freshAbove: 2, overreachedBelow: -3, strainedAcwrAbove: 1.3 };
    expect(classifyForm({ ktl: 10, lf: 6 }, th)).toBe('fresh');        // form=4 ≥ 2, acwr=0.60
    expect(classifyForm({ ktl: 3, lf: 8 }, th)).toBe('overreached');   // form=-5 ≤ -3
    expect(classifyForm({ ktl: 4, lf: 6 }, th)).toBe('strained');      // form=-2（不越 -3）, acwr=1.5 ≥ 1.3
    expect(classifyForm({ ktl: 4.2, lf: 4 }, th)).toBe('optimal');     // form=0.2, acwr=0.95，都不过线
  });
});

/**
 * 跨家族去重（2026-10-16 真实数据抓出的回归）：
 * 一节课会写**两行** learning_state —— `session-wrapup:<sessionId>`（真实会话 LSS）
 * 与 `task-completion:<taskId>`（合成占位 lss=4，两行同 taskId 同日）。旧实现把两行都求和
 * → 日负荷翻倍（周敏 10-12 六节课 12 行，Σ 从真实 ~15.8 顶到 41.76）。去重须保留权威 wrapup 行。
 */
describe('replayDailyPmc 跨家族去重（同日同 taskId 只算一节课）', () => {
  const day = new Date('2026-10-12T15:59:59.999Z');
  const wrap = (taskId: string, lss: number) => ({ calculatedAt: day, lss, ktl: lss, lf: lss, sourceKey: `session-wrapup:teaching_xx_${taskId}`, taskId });
  const tc = (taskId: string) => ({ calculatedAt: day, lss: 4, ktl: 4, lf: 4, sourceKey: `task-completion:${taskId}`, taskId });

  it('同日同 taskId 的 wrapup + task-completion → 只算 wrapup（不翻倍）', () => {
    const rows = [wrap('t1', 2.35), tc('t1'), wrap('t2', 5.76), tc('t2')];
    const deduped = dedupeLessonRows(rows);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((r) => r.lss).sort()).toEqual([2.35, 5.76]);

    const series = replayDailyPmc(rows);
    // 真实日负荷 = 2.35 + 5.76 = 8.11（不是 8.11 + 4 + 4 = 16.11）
    expect(series.daily[0].load).toBeCloseTo(8.11, 6);
    expect(series.daily[0].lessons).toBe(2);
  });

  it('只有 task-completion（无 wrapup 配对）→ 保留（无法配对即不折叠）', () => {
    const rows = [tc('t9')];
    expect(dedupeLessonRows(rows)).toHaveLength(1);
    expect(replayDailyPmc(rows).daily[0].load).toBeCloseTo(4, 6);
  });

  it('taskId 缺失 → 不折叠（宁可多留不误删）', () => {
    const rows = [
      { calculatedAt: day, lss: 5, ktl: 5, lf: 5, sourceKey: 'session-wrapup:x', taskId: null },
      { calculatedAt: day, lss: 4, ktl: 4, lf: 4, sourceKey: 'task-completion:y', taskId: null },
    ];
    expect(dedupeLessonRows(rows)).toHaveLength(2);
    expect(replayDailyPmc(rows).daily[0].load).toBeCloseTo(9, 6);
  });

  it('wrapup 与 task-completion 落在不同天 → 不跨天折叠（各自保留）', () => {
    const rows = [
      { ...wrap('t1', 5), calculatedAt: new Date('2026-10-12T15:59:59.999Z') },
      { ...tc('t1'), calculatedAt: new Date('2026-10-13T15:59:59.999Z') },
    ];
    expect(dedupeLessonRows(rows)).toHaveLength(2);
  });
});
