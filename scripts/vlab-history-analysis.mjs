// 分析历史虚拟会话 stageResults 的结构与各阶段质量信号
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);
const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };
const trunc = (s, n = 150) => {
  if (s == null) return s;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

// 1) stageResults 顶层结构
console.log('===== stageResults 顶层结构（前 4 个会话）=====');
const sessions = q('SELECT id, status, currentStage, stageResults, goalConversationId, learningPathId FROM virtual_sessions ORDER BY updatedAt DESC LIMIT 4');
for (const s of sessions) {
  const sr = parse(s.stageResults) || {};
  console.log(`\n[${s.id.slice(0, 18)}] ${s.status}/${s.currentStage}`);
  console.log('  keys:', Object.keys(sr).join(', '));
  for (const [k, v] of Object.entries(sr)) {
    if (v && typeof v === 'object') console.log(`  ${k}: ${trunc(JSON.stringify(v).slice(0, 200), 200)}`);
  }
}

// 2) goal 阶段：从 goal_conversations 看虚拟对话轮数与节奏
console.log('\n===== 虚拟目标对话（轮数/消息长度/阶段推进）=====');
const gcs = q(`SELECT gc.id, gc.stage, length(gc.messages) AS msgsLen, gc.completedAt IS NOT NULL AS done,
  substr(gc.collectedData,1,60) AS cdHead
  FROM goal_conversations gc JOIN users u ON u.id = gc.userId
  WHERE u.isVirtualLearner = 1 ORDER BY gc.updatedAt DESC LIMIT 10`);
for (const g of gcs) console.log(`- ${g.id.slice(0, 20)} | stage=${g.stage} msgsLen=${g.msgsLen} done=${g.done}`);

// 3) 具体看一个走完 goal 的虚拟对话内容
console.log('\n===== 虚拟 goal 对话样例（消息序列）=====');
const sample = q(`SELECT gc.messages FROM goal_conversations gc JOIN users u ON u.id = gc.userId
  WHERE u.isVirtualLearner = 1 AND length(gc.messages) > 200 ORDER BY gc.updatedAt DESC LIMIT 1`);
if (sample.length) {
  const msgs = parse(sample[0].messages);
  if (Array.isArray(msgs)) {
    console.log('消息总数:', msgs.length);
    let count = 0;
    for (const m of msgs) {
      if (count >= 16) break;
      const c = m.content ?? m.text ?? m;
      console.log(`  [${m.role ?? m.type ?? '?'}] ${trunc(typeof c === 'string' ? c : JSON.stringify(c), 140)}`);
      count++;
    }
  }
}

// 4) path 阶段：虚拟路径的里程碑/子任务分布
console.log('\n===== 虚拟路径（长度分布）=====');
const vpaths = q(`SELECT p.id, p.title, p.totalMilestones, p.status,
  (SELECT COUNT(*) FROM milestones m WHERE m.learningPathId = p.id) AS ms,
  (SELECT COUNT(*) FROM subtasks s JOIN milestones m2 ON m2.id = s.milestoneId WHERE m2.learningPathId = p.id) AS st,
  p.estimatedHours
  FROM learning_paths p JOIN users u ON u.id = p.userId
  WHERE u.isVirtualLearner = 1 ORDER BY p.updatedAt DESC LIMIT 12`);
for (const p of vpaths) console.log(`- ${trunc(p.title, 45)} | ms=${p.ms} st=${p.st} h=${p.estimatedHours} status=${p.status}`);

// 5) teaching 阶段：虚拟教学会话
console.log('\n===== 虚拟教学会话 =====');
const ts = q(`SELECT t.id, t.topic, t.status, t.taskType, length(t.messages) AS mlen,
  t.knowledgeState IS NOT NULL AS hasKS, t.wrapup IS NOT NULL AS hasW
  FROM teaching_sessions t JOIN users u ON u.id = t.userId
  WHERE u.isVirtualLearner = 1 ORDER BY t.updatedAt DESC LIMIT 10`);
for (const t of ts) console.log(`- ${trunc(t.topic, 50)} | ${t.status} ${t.taskType} msgs=${t.mlen} ks=${t.hasKS} w=${t.hasW}`);

db.close();
