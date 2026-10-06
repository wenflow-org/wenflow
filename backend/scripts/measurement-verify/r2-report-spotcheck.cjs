// R2 报告撰写人只读抽查：把报告将引用的关键数字从落盘产物中逐一复核。
// 只读 JSON 产物，不触碰 DB、不触碰 src、零写入（除本脚本自身落在允许路径）。
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'out');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const log = (...a) => console.log(...a);
const sec = (t) => log(`\n===== ${t} =====`);

// ---------- 1. demo1-calibration.json ----------
sec('demo1-calibration.json');
const cal = read('demo1-calibration.json');
log(JSON.stringify(cal, null, 1));

// ---------- 2. crossloop-prior-misconceptions.json ----------
sec('crossloop-prior-misconceptions.json');
const pm = read('crossloop-prior-misconceptions.json');
log(JSON.stringify(pm, null, 1));

// ---------- 3. crossloop-a3-recheck.json ----------
sec('crossloop-a3-recheck.json');
log(JSON.stringify(read('crossloop-a3-recheck.json'), null, 1));

// ---------- 4. seq-summary.json ----------
sec('seq-summary.json');
const ss = read('seq-summary.json');
log('topKeys=', Object.keys(ss).join(','));
for (const k of ['runNote', 'sectionPresence', 'boardTrail', 'verdicts', 'a2OldConceptInTeacherTalk']) {
  if (ss[k] !== undefined) log(`${k} =`, JSON.stringify(ss[k]).slice(0, 2200));
}

// ---------- 5. crossloop-seq.json（带段名头的文本）：S7/S9/S11/S12/S15 ----------
sec('crossloop-seq.json');
const csRaw = fs.readFileSync(path.join(dir, 'crossloop-seq.json'), 'utf8');
log('sectionHeads =', (csRaw.match(/^===== .*$/gm) || []).join(' | '));
const secOf = (raw, name, len) => {
  const i = raw.indexOf(`===== ${name}`);
  return i < 0 ? `(missing ${name})` : raw.slice(i, i + (len || 1400));
};
for (const s of ['S7', 'S9', 'S11', 'S12', 'S15']) log(secOf(csRaw, s, 1600));

// ---------- 6. crossloop-adv.json（带段名头的文本）：A1/A2/A3/A6/A7 ----------
sec('crossloop-adv.json');
const caRaw = fs.readFileSync(path.join(dir, 'crossloop-adv.json'), 'utf8');
log('sectionHeads =', (caRaw.match(/^===== .*$/gm) || []).join(' | '));
for (const s of ['A1', 'A3', 'A5', 'A6', 'A7']) log(secOf(caRaw, s, 1300));

// ---------- 7. seq-a3.result.json：降级轨迹与首检查点 ----------
sec('seq-a3.result.json');
const a3 = read('seq-a3.result.json');
log('topKeys=', Object.keys(a3).join(','));
for (const k of ['verdicts', 'degradedPoints', 'boardHistory', 'memoryTracesDelta']) {
  if (a3[k] !== undefined) log(`${k} =`, JSON.stringify(a3[k]).slice(0, 2600));
}
const a3cp = (a3.checkpoints || [])[0];
if (a3cp) log('firstCheckpoint.question =', JSON.stringify((a3cp.checkpoint || a3cp).question || a3cp).slice(0, 600));

// ---------- 8. seq-a1.result.json：首检查点题干 ----------
sec('seq-a1.result.json');
const a1 = read('seq-a1.result.json');
log('topKeys=', Object.keys(a1).join(','));
const a1cp = (a1.checkpoints || [])[0];
if (a1cp) log('firstCheckpoint =', JSON.stringify(a1cp.checkpoint || a1cp).slice(0, 700));

// ---------- 9. seq-a2.result.json：老师话术/难度证据/预测理由 ----------
sec('seq-a2.result.json');
const a2 = read('seq-a2.result.json');
log('topKeys=', Object.keys(a2).join(','));
if (a2.oldConceptInTeacherTalk) log('oldConceptInTeacherTalk =', JSON.stringify(a2.oldConceptInTeacherTalk).slice(0, 900));
// 难度证据可能嵌在 turns/prompts 里，全局 grep 字面
const a2raw = fs.readFileSync(path.join(dir, 'seq-a2.result.json'), 'utf8');
for (const frag of ['"lessonLss"', '"successBandAction"', '"stallRisk"', 'lastLessonRecap', '"temporalGap"']) {
  const i = a2raw.indexOf(frag);
  log(`grep ${frag} -> idx=${i}`, i >= 0 ? a2raw.slice(i, i + 260) : '');
}

// ---------- 10. seq-a1.after / seq-a2.after：EWMA 与台账 ----------
sec('seq-a1.after.json / seq-a2.after.json');
const f1 = read('seq-a1.after.json');
const f2 = read('seq-a2.after.json');
log('a1.after topKeys=', Object.keys(f1).join(','));
log('a2.after topKeys=', Object.keys(f2).join(','));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
log('a1.after pick =', JSON.stringify(pick(f1, ['memoryTraces', 'misconceptionLedger', 'learningMetrics', 'ewma', 'predictions'])).slice(0, 1500));
if (f2.comparison) log('a2.comparison =', JSON.stringify(f2.comparison).slice(0, 2600));

// ---------- 11. ad-summary.json ----------
sec('ad-summary.json');
const ads = read('ad-summary.json');
log('topKeys=', Object.keys(ads).join(','));
log(JSON.stringify(ads, null, 1).slice(0, 6000));

// ---------- 12. ad-day2.json：B1 traceDelta / decayReadings ----------
sec('ad-day2.json');
const d2 = read('ad-day2.json');
log('topKeys=', Object.keys(d2).join(','));
const d2raw = JSON.stringify(d2);
for (const frag of ['2026-10-04T01:00:00.000Z', 'interval-elapsed', 'retrievability']) {
  const i = d2raw.indexOf(frag);
  log(`grep ${frag} -> idx=${i}`, i >= 0 ? d2raw.slice(Math.max(0, i - 160), i + 160) : '');
}
