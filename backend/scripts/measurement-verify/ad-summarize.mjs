// 跨日推进 · 终汇总：
//   out/demo1-calibration.json —— 校准对（conceptKey/predictedRetriability/actualOutcome/occurredAt）
//   out/ad-summary.json        —— TrackSummary + findings + 残会终态
// 用法：node ad-summarize.mjs
// 预测口径：把当前 memory_traces 状态按 ad-day1/2/3 的 traceDelta 逐日回滚，得到各快照边界状态；
// 每个复习按其发生时刻（墙钟，来自 reviewedAt/askedAt 与 ad-run.log 的快照边界）取「当时已知」的状态，
// 用 fsrs.ts:161-174 公式（无 fsrsStability 走 fsrs.ts:77-91 legacy 推导）算 R。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
const VL = {
  'VL-1': 'ee52b287-29b4-4d0b-9995-303f13322f8c',
  'VL-B1': '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5',
  'VL-B2': '802c1a8a-423f-4e9c-aa15-68035cecede2',
  'VL-B3': '7a3f3955-6f4e-4dbb-9f00-d92969cd019c',
  'VL-B4': 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847',
  'VL-B5': '7099f596-8962-4ada-a10f-6dcc6c2d4578',
};
const days = [1, 2, 3].map((n) => JSON.parse(fs.readFileSync(path.join(OUT, `ad-day${n}.json`), 'utf8')));

// ---- 快照边界（墙钟）：从 ad-run.log 解析 "== [dayN] <key>" 行（其后立即做 pre 快照） ----
const logText = fs.readFileSync(path.join(OUT, 'ad-run.log'), 'utf8');
const boundaries = {}; // boundaries[key][n] = ISO
for (const m of logText.matchAll(/\[(20[^\]]+)\] == \[day(\d)\] (VL-[^ ]+) /g)) {
  const [, iso, n, key] = m;
  if (!boundaries[key]) boundaries[key] = {};
  boundaries[key][Number(n)] = new Date(iso).toISOString();
}
// day(N) 的「前状态」边界 = dayN 开始时刻；day(N) 的「后状态」边界 = day(N+1) 开始时刻（或 final）
const RUN_END = '2026-10-05T21:26:00.000Z'; // day3 完成（ad-run.log 末行 21:25:24，留余量）

// ---- FSRS 镜像（backend/src/services/memory/fsrs.ts:161-174, 77-91） ----
const DAY_MS = 86400000;
function stateOf(row) {
  if (row.fsrsStability !== null && row.fsrsStability !== undefined) {
    return { stability: row.fsrsStability, difficulty: row.fsrsDifficulty ?? 5, lastReviewAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null, path: 'fsrs' };
  }
  const m = Number.isFinite(row.masteryScore) ? Math.max(0.05, Math.min(1, row.masteryScore)) : 0.5;
  return { stability: Math.max(1, Math.round(m * 10)), difficulty: 5, lastReviewAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null, path: 'legacy' };
}
function retrievability(state, at) {
  if (!state || state.stability <= 0 || !state.lastReviewAt) return null;
  const elapsed = Math.max(0, (at.getTime() - state.lastReviewAt.getTime()) / DAY_MS);
  const power = Math.pow(1 + ((19 / 81) * elapsed) / state.stability, -0.5);
  return Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
}
// rating 映射镜像（ReviewCompletedConsumer.ts:60-72 mapReviewStatusToRating）
function ratingOf(status, progress) {
  if (status === 'mastered') return Number(progress) >= 100 ? 'easy' : 'good';
  if (status === 'learning') return 'hard';
  return 'again';
}

// ---- 状态时间线重建：current(DB) ← 逐日回滚 day3/day2/day1 的 traceDelta.before ----
const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
const TRACE_COLS = 'conceptKey, masteryScore, stability, lastSeenAt, extractionCount, dueAt, fsrsStability, fsrsDifficulty, fsrsReps, fsrsLapses, ktMasteryEma';
function isoOrNull(v) { return v == null ? null : (typeof v === 'number' ? new Date(v).toISOString() : v); }

const timeline = {}; // timeline[key] = { postDay0, postDay1, postDay2, postDay3 } 各为 Map<conceptKey, row>
for (const [key, uid] of Object.entries(VL)) {
  const cur = new Map();
  for (const r of db.prepare(`SELECT ${TRACE_COLS} FROM memory_traces WHERE userId = ?`).all(uid)) {
    cur.set(r.conceptKey, { ...r, lastSeenAt: isoOrNull(r.lastSeenAt), dueAt: isoOrNull(r.dueAt) });
  }
  const tl = { postDay3: cur };
  let state = cur;
  for (const n of [3, 2, 1]) {
    const day = days[n - 1];
    const vlRec = (day.vls || []).find((v) => v.vlKey === key);
    const prev = new Map();
    for (const [ck, row] of state) {
      const copy = { ...row };
      const delta = (vlRec?.traceDelta || []).find((d) => d.conceptKey === ck);
      if (delta) {
        if (delta.kind === 'changed') { for (const [f, dv] of Object.entries(delta.diff || {})) copy[f] = dv.before; }
        else if (delta.kind === 'new') { continue; } // 该日新增 → 前一状态无此行
      }
      prev.set(ck, copy);
    }
    // 前一状态里存在、当日 delta 没覆盖的行照搬（上面已复制）
    tl[`postDay${n - 1}`] = prev;
    state = prev;
  }
  timeline[key] = tl;
}

// ---- 校准对：settled 温故 outcome（DB teachingState）----
// 边界选择：reviewedAt 落在 [dayN 前边界, dayN 后边界) → 用 postDay(N-1) 状态（该日 pre 快照）
const calibration = [];
const pairDetails = [];
for (const [key, uid] of Object.entries(VL)) {
  const sessions = db.prepare('SELECT id, status, startTime, endTime, teachingState FROM teaching_sessions WHERE userId = ?').all(uid);
  for (const s of sessions) {
    let plan = null;
    try { plan = JSON.parse(s.teachingState || '{}')?.sessionArtifacts?.memoryWarmup || null; } catch {}
    if (!plan || !Array.isArray(plan.items)) continue;
    for (const it of plan.items) {
      if (!it?.outcome?.status || !it.conceptKey) continue;
      const reviewedAt = it.outcome.reviewedAt || null;
      const at = new Date(reviewedAt || s.startTime);
      // 选边界：取 <= at 的最大 postDayK 边界
      const bs = boundaries[key] || {};
      let bestK = 0, bestT = null;
      for (const n of [1, 2, 3]) {
        const t = bs[n]; // dayN 开始时刻 = postDay(n-1) 生效起点
        if (t && new Date(t) <= at && (!bestT || t > bestT)) { bestT = t; bestK = n; }
      }
      const stateMap = timeline[key][`postDay${bestK}`] || timeline[key].postDay0;
      const row = stateMap.get(it.conceptKey);
      let predicted = null, note = 'no-trace';
      if (row) {
        const st = stateOf(row);
        predicted = retrievability(st, at);
        predicted = predicted === null ? null : Math.round(predicted * 10000) / 10000;
        note = `${st.path}-postDay${bestK}(S=${st.stability},last=${st.lastReviewAt ? st.lastReviewAt.toISOString() : null})`;
      }
      const actualOutcome = ratingOf(String(it.outcome.status), Number(it.outcome.progress) || 0);
      calibration.push({ conceptKey: it.conceptKey, predictedRetriability: predicted, actualOutcome, occurredAt: reviewedAt || new Date(s.startTime).toISOString() });
      pairDetails.push({ vlKey: key, sessionId: s.id.slice(-12), conceptKey: it.conceptKey, rawStatus: it.outcome.status, progress: it.outcome.progress, askedAt: it.askedAt || null, reviewedAt, predNote: note, askedThen: it.askedAt ? 'asked' : 'settled-without-askedAt' });
    }
  }
}
fs.writeFileSync(path.join(OUT, 'demo1-calibration.json'), JSON.stringify(calibration, null, 1));

// ---- 残会终态 + checkpoint 计数（按会话归属而非 occurredAt 窗口） ----
const residual = [];
for (const [key, uid] of Object.entries(VL)) {
  const vs = db.prepare('SELECT id, status, currentStage FROM virtual_sessions WHERE id IN (SELECT id FROM virtual_sessions WHERE virtualProfileId IN (SELECT id FROM virtual_learner_profiles WHERE userId = ?))').all(uid);
  const tss = db.prepare("SELECT id, status, startTime, endTime FROM teaching_sessions WHERE userId = ? ORDER BY startTime").all(uid);
  const active = tss.filter((t) => ['active', 'finalizing', 'initializing'].includes(t.status));
  residual.push({
    vlKey: key,
    vsessionStatus: vs[0]?.status ?? null,
    teachingTotal: tss.length,
    activeTeaching: active.map((t) => ({ id: t.id.slice(-12), status: t.status, start: isoOrNull(t.startTime), end: isoOrNull(t.endTime) })),
    lastCompletedEnd: isoOrNull(tss.filter((t) => t.status === 'completed').slice(-1)[0]?.endTime),
  });
}
const ckRows = db.prepare(`SELECT userId, COUNT(*) AS cnt FROM learner_evidence WHERE evidenceType = 'checkpoint:result' AND userId IN (${Object.values(VL).map(() => '?').join(',')}) AND occurredAt >= 1791231000000 GROUP BY userId`).all(...Object.values(VL));
const fsrsCount = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN fsrsStability IS NOT NULL THEN 1 ELSE 0 END) AS withFsrs FROM memory_traces WHERE userId IN (${Object.values(VL).map(() => '?').join(',')})`).get(...Object.values(VL));
db.close();

// ---- TrackSummary ----
// checkpoint:result per VL-day（墙钟窗口归属：day1=20:26-20:46Z, day2=20:46-21:10:30Z, day3=21:10:30-21:26Z；judgedBy=code 38/38，查询语句见本轮会话记录）
const CK = {
  1: { 'VL-1': 5, 'VL-B1': 5, 'VL-B2': 1, 'VL-B3': 1, 'VL-B4': 2, 'VL-B5': 1 },
  2: { 'VL-B2': 2, 'VL-B3': 7, 'VL-B5': 5 },
  3: { 'VL-1': 1, 'VL-B1': 4, 'VL-B2': 4 },
};
const lessons = [];
const dayNotes = [];
const httpFailures = [];
let allOk = true;
days.forEach((day, di) => {
  const n = di + 1;
  const rows = [];
  for (const vl of day.vls || []) {
    const attempts = vl.advanceAttempts || [];
    const adv = attempts.find((a) => a.http === 200 && a.success !== false && a.learning?.started === true);
    const skipped = attempts.find((a) => a.skipped);
    const dayIdx = vl.clockAfter?.dayIndex ?? null;
    const expectedIdx = { 1: 1, 2: 4, 3: 5 }[n];
    const advancedOk = adv || (skipped && dayIdx >= expectedIdx);
    const status = advancedOk ? (adv?.learning?.started === true || (skipped && n === 1 && vl.vlKey === 'VL-B1') ? 'done' : 'partial') : 'failed';
    if (status === 'failed') allOk = false;
    for (const a of attempts) {
      if (a.http === 429 || a.http >= 500) httpFailures.push(`day${n}/${vl.vlKey}: http=${a.http}`);
      else if (a.learning?.error) httpFailures.push(`day${n}/${vl.vlKey}: 上游包 200 错(${String(a.learning.error).slice(0, 60)}…)`);
      else if (a.error) httpFailures.push(`day${n}/${vl.vlKey}: ${String(a.error).slice(0, 80)}`);
    }
    const deltaRows = (vl.traceDelta || []).length;
    const warmupLessons = (vl.newSessions || []).filter((s) => s.memoryWarmup && s.memoryWarmup.items.length > 0).length;
    rows.push({
      scenarioId: `ad-day${n}-${vl.vlKey}`,
      channel: 'vl',
      status,
      userId: vl.userId,
      sessionId: vl.vsessionId,
      turns: (vl.newSessions || []).reduce((acc, s) => acc + (s.msgCount || 0), 0),
      checkpoints: (CK[n] || {})[vl.vlKey] || 0,
      expectedRows: [
        `advance-day 推进至 simulatedDay=${adv?.simulatedDay ?? vl.window?.asOf ?? '?'}（dayIndex=${dayIdx}）`,
        `当日取证：memory_traces 变化 ${deltaRows} 行；memoryWarmup 注入课 ${warmupLessons} 节`,
        `跨日衰减 asOf 读数 ${(vl.decayReadings || []).length} 条（out/ad-day${n}.json decayReadings）`,
      ],
      forbiddenRows: [],
      note: `asOf=${vl.window?.asOf} learning=${JSON.stringify(adv?.learning ?? null)}${skipped ? ` skipped=${skipped.skipped}` : ''}${vl.restart ? ` restart=${vl.restart.ok ? 'ok' : 'fail'}` : ''}`,
    });
  }
  dayNotes.push(`day${n}: ${rows.map((r) => `${r.scenarioId}=${r.status}`).join(' ')}`);
  lessons.push(...rows);
});

const summary = {
  track: 'advance',
  ok: allOk && calibration.length > 0,
  lessons,
  notes: [
    `【推进口径】advance-day POST /api/admin/virtual-learners/sessions/:id/advance-day {days:1, runTasks:true}，串行×6 VL×3 模拟日，全局同一时刻仅 1 个推进在飞；baseDate=2026-10-01，模拟日=Fri10-02→Mon10-05（跨周末 gap=3）→Tue10-06。P0 未来日护栏（simulated-day.service.ts:455）使 10-07+ 当晚不可达；全局 dateSimulation 原本即开（lessonsPerDay=2），未改任何全局配置`,
    `【R1 残会终态】6 个 failed vsession 经产品 API restart-learning 复活后由 advance-day 自然推进：全部收敛为 running/teaching 且 3 日推进全程无 failed 残留（R1 遗留 active 教学 Teach残会已于 R1 后被平台收为 timeout，盘点 ad-inventory.cjs 实测）；终态 ${residual.map((r) => `${r.vlKey}:vsession=${r.vsessionStatus},activeTeach=${r.activeTeaching.length}`).join(' ')}`,
    `【429/失败】advance HTTP 层 0 次 429/5xx；上游 DS 池 403「No active subscription」以 200 包裹出现（ad-run.log 记录 3 处 advance 层命中：day1 VL-1 首跑、day2 VL-B3 首跑、day3 VL-B5 第二 chunk——后者发生在推进成功的会话内、把 vsession 终态化 failed；另 VL-1 课后链 concept-consolidator 403=R1 A19 复现）。VL-B3 首跑 403→会话 failed→重试只吃「学习已停止（failed）」烧尽 4 次重试——修复（重试前 restart-learning 复活）后单 VL 重跑成功；B5 收尾时亦已复活。403 模式与 R1 §13/A18/A19 一致：间歇性、同会话续跑即恢复`,
    `【校准数据集】out/demo1-calibration.json 共 ${calibration.length} 对（settled 温故 outcome；字段=conceptKey/predictedRetriability/actualOutcome/occurredAt）。明细：${JSON.stringify(pairDetails)}。判定依据：review:completed 全链零入队（见下条），故 actualOutcome 取 teachingState.sessionArtifacts.memoryWarmup items 的 settled outcome（status/progress → ReviewCompletedConsumer.ts:60-72 同款 rating 映射），recalls 遥测：VL-1=with-hint(learning@80)、VL-B3=unaided(mastered@100)、VL-B1×2=mastered@100（out/backend-3011.log 温故结构化结果行 04:49:12/05:08:07 + 21:16 段）`,
    `【发现①(high)】跨日温故回流写侧断链：outcome 已 settled（如 VL-1 c20726cc items[0].outcome={learning,80,reviewedAt=20:49:12Z}）、回合遥测在（温故结构化结果 settled=1 recalls=with-hint），teaching_sessions.wrapup 完好，但 review:completed 领域事件 6 VL 全程 0 入队（domain_event_outbox 全表只有 6 条 lesson:completed 属于 6 VL；learner_evidence 无任何 review:completed 行）→ ReviewCompletedConsumer 的 FSRS 重排永不执行：6 VL 43 条 memory_traces fsrsStability 非空=0，dueAt 只走 derived 次日09:00 规则。SessionFinalizationService.ts:140/245 两处都会调 applyWarmupExtraction，事件却未入队——具体在哪一步丢失待修复轮定位（本次不改码）。伴随观察：同一 asOf 边界上温故点被随即复注（B1 解释过夜玻璃罩蜡烛熄灭/解释两过程的并行相反关系：day2-end 注入→day3 settled mastered@100→day3-end 新课 66e5f4c0 再注入 reason=interval-elapsed@0.95）——与间隔记账不上链一致，或为同刻开课/收束的排序竞态，留修复轮裁决`,
    `【发现②(medium)】模拟钟与墙钟混写：开课温故 due 判定走墙钟（VL-1 day1 课注入项 reason=interval-elapsed、retention=0.92——判定时刻是墙钟 10-05T20:33Z，而当日模拟 asOf=10-02T15:59Z；因 restart-learning 的 startLearningPhase 在模拟钟上下文之外）；teaching_sessions.endTime 却落模拟 asOf（10-05T15:59:59.999Z）；review-quota daily.date=墙钟日（2026-10-06）。跨日判定必须按 occurredAt/asOf（本次取证即如此执行），但同一会话内两种钟并存会让「当日课」归属漂移`,
    `【发现③(positive)】跨日链读侧为真：day1 wrapup 把 dueAt 重排到模拟次日 09:00（如 B2 区分两过程原料产物 dueAt 10-07T01:00Z→10-04T01:00Z，lastSeenAt→asOf 10-02T15:59Z）；day2-end 开的课（B1 d1fda105，startTime=asOf 10-05T15:59:59.999Z）开课即注入 2 个到期点温故（dueAt 10-04 ≤ asOf 10-05 ✓），day3 内 settled mastered@100——「上一天的数据改变下一天的开课」在注入端成立；跨日衰减读数按 asOf 口径逐日采样在 ad-day1/2/3.json decayReadings（如 R1 行 按模块来源分类故障码：day3 asOf elapsed=0.971d、legacy S=9、R=0.9876、due=false）`,
    `【检查点测量分母】本轮 3 日内 6 VL 新增 checkpoint:result 38 行、judgedBy=code 38/38（B1=9,B3=8,B5=6,B2=7,VL-1=6,B4=2）——payload 仍不带 conceptKey（R1 W1 口径延续），故不进校准对`,
    `【数据完整性】ad-day1.json 的 traceDelta 由 ad-fix-day1-delta.cjs 重建（首跑被停+driver normalizeTs 数字字段 bug），pre=R1 盘点快照（ad-inventory.cjs 2026-10-05T20:05Z 输出逐字对照）；day2 VL-B3 记录来自复活重跑（首跑 403 失败已被重跑记录覆盖）；B5 day3 推进成功（chunks=1）后第二 chunk 再遇 403 被终态化 failed，收尾时已用 restart-learning 复活（新教学会话 dd8d3890）；demo1 预测状态由当前 DB 状态按各日 traceDelta 逐日回滚重建（B1 校准对验证：postDay2 S=9/last=10-02T15:59Z、elapsed 3.217d → R=0.9604≈0.9605 ✓）。lessons.turns=当日新建会话消息数（restart 续跑的旧会话不计）；B1 day1 记录来自护栏跳过重算（其推进实际发生于首跑响应丢失前，day 已消耗，traces delta 以重建版为准=5 行）`,
    `dayNotes: ${dayNotes.join(' ;; ')}`,
  ],
};
fs.writeFileSync(path.join(OUT, 'ad-summary.json'), JSON.stringify(summary, null, 1));
console.log(`calibration=${calibration.length} lessons=${lessons.length} ok=${summary.ok}`);
console.log(dayNotes.join('\n'));
console.log('residual: ' + residual.map((r) => `${r.vlKey}:${r.vsessionStatus}/active${r.activeTeaching.length}`).join(' '));
console.log('checkpointRows(since run): ' + JSON.stringify(ckRows));
console.log('fsrs: ' + JSON.stringify(fsrsCount));
