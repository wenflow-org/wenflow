/* 从 kc-multipath.json 提取逐日动态调整轨迹（用户级 metrics + perPath 分路径） */
const fs = require('fs');
const p = process.argv[2] || 'C:/tmp/kc-multipath.json';
const data = JSON.parse(fs.readFileSync(p, 'utf-8'));

console.log(`学习者 ${data.learnerName} | userId=${data.userId} | baseDate=${data.baseDate}`);
console.log('\n路径：');
for (const x of data.paths || []) console.log(`  #${x.index + 1} ${x.story} session=${x.sessionId} goalOk=${x.goalOk} stage=${x.stage}/${x.status}`);

const tls = data.timelines || {};
const sid = Object.keys(tls)[0];
if (!sid) { console.log('\n(暂无时间线)'); process.exit(0); }
const tl = tls[sid];
console.log(`\n### 逐日时间线（用户级，含 perPath 分路径）— session ${sid}`);
for (const d of tl.days || []) {
  const m = d.metrics || {};
  const dl = d.dayLoad || {};
  console.log(`\n day${d.dayIndex} ${d.simulatedDay}  dayLoad={课${dl.lessons} 分${dl.minutes} 疲劳加成${dl.fatigueBonus}}`);
  console.log(`   用户级 metrics: lss=${m.lss} ktl=${m.ktl} lf=${m.lf} lsb=${m.lsb}  pacing=${d.pacing || '-'}`);
  for (const pp of d.perPath || []) console.log(`   perPath ${String(pp.pathId).slice(0, 22)}: lss=${pp.lss} ktl=${pp.ktl} lf=${pp.lf} lsb=${pp.lsb}`);
  for (const a of d.difficultyAdjustments || []) console.log(`   难度调整 task=${String(a.taskId).slice(0, 10)} ${a.baseline}→${a.adjusted} ${a.direction} applied=${a.applied} 理由=${(a.reasons || []).join('/')}`);
  if (d.memory) console.log(`   记忆: 痕迹${d.memory.traceCount} 到期${d.memory.dueCount} 脆弱${d.memory.fragileCount} 稳${d.memory.stableCount} 平均保留${d.memory.avgRetention}`);
  if (d.reviewQuota) console.log(`   温故额度: 上限${d.reviewQuota.limitLoad} 已用${d.reviewQuota.usedLoad} 剩${d.reviewQuota.remainingLoad}`);
  if (d.signals && d.signals.length) console.log(`   信号: ${d.signals.join(', ')}`);
  if (d.degraded && d.degraded.length) console.log(`   ⚠ 降级: ${JSON.stringify(d.degraded)}`);
}
