import { DatabaseSync } from 'node:sqlite';

const sysDb = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/system.db');
const q = (s, ...a) => sysDb.prepare(s).run(...a);
const all = (s, ...a) => sysDb.prepare(s).all(...a);

const updates = [
  { agentId: 'skill:virtual-learner-learn-turn-simulator', from: 800, to: 8000 },
  { agentId: 'skill:virtual-learner-goal-dialogue-simulator', from: 1200, to: 8000 },
  { agentId: 'skill:teaching-opening-generator', from: 1200, to: 8000 },
  { agentId: 'skill:teaching-turn', from: 4000, to: 8000 },
  { agentId: 'skill:virtual-learner-persona-designer', from: null, to: 8000 },
  { agentId: 'skill:virtual-learner-scenario-designer', from: null, to: 8000 },
  { agentId: 'skill:virtual-learner-actor-auditor', from: 5000, to: 8000 },
];

console.log('=== Updating agent_prompts maxTokens ===');
for (const u of updates) {
  const before = all(`SELECT agentId, version, maxTokens, status FROM agent_prompts WHERE agentId = ? AND status = 'ACTIVE'`, u.agentId);
  if (before.length === 0) {
    console.log(`SKIP ${u.agentId}: no ACTIVE prompt`);
    continue;
  }
  const b = before[0];
  console.log(`BEFORE: ${b.agentId} v${b.version} maxTokens=${b.maxTokens}`);
  q(`UPDATE agent_prompts SET maxTokens = ?, updatedAt = ? WHERE agentId = ? AND status = 'ACTIVE'`, u.to, Date.now(), u.agentId);
  console.log(`AFTER:  ${b.agentId} v${b.version} maxTokens=${u.to}`);
}

console.log('\n=== Verify ===');
for (const u of updates) {
  for (const r of all(`SELECT agentId, version, maxTokens, status FROM agent_prompts WHERE agentId = ? AND status = 'ACTIVE'`, u.agentId))
    console.log(`${r.agentId} v${r.version} maxTokens=${r.maxTokens} status=${r.status}`);
}

sysDb.close();
console.log('DONE');