import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/system.db', { readOnly: true });
const all = (s, ...a) => db.prepare(s).all(...a);
console.log('distinct status:', JSON.stringify(all('SELECT DISTINCT status FROM agent_prompts')));
console.log('teaching-turn:', JSON.stringify(all("SELECT agentId, version, maxTokens, status FROM agent_prompts WHERE agentId='skill:teaching-turn' ORDER BY version DESC LIMIT 3")));
console.log('learn-turn ACTIVE check:', JSON.stringify(all("SELECT version, maxTokens, status FROM agent_prompts WHERE agentId='skill:virtual-learner-learn-turn-simulator' ORDER BY version DESC LIMIT 2")));
db.close();