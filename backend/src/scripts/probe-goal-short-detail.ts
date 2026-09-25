/* eslint-disable no-console */
import 'dotenv/config';
import axios from 'axios';
const BASE = 'http://localhost:3001/api';
async function main() {
  const login = await axios.post(`${BASE}/auth/login`, { name: 'EvalRound2', password: 'EvalPass2026' });
  const cookie = (login.headers['set-cookie']?.[0] || '').split(';')[0];
  // 1) 3 字目标的完整响应
  const r3 = await axios.post(`${BASE}/goal-conversation/start`, { input: { text: '学英语' } }, { headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, timeout: 240000 });
  console.log('=== 3字目标 status:', r3.status, '===');
  console.log(JSON.stringify(r3.data, null, 1).slice(0, 1800));
  // 2) 1 字目标连打 3 次
  for (let i = 1; i <= 3; i++) {
    const t = Date.now();
    try {
      const r = await axios.post(`${BASE}/goal-conversation/start`, { input: { text: '学' } }, { headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, timeout: 240000 });
      console.log(`1字 #${i}: http=${r.status} ${Date.now() - t}ms`);
    } catch (e: any) {
      console.log(`1字 #${i}: http=${e?.response?.status} ${Date.now() - t}ms err=${JSON.stringify(e?.response?.data || {}).slice(0, 200)}`);
    }
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
