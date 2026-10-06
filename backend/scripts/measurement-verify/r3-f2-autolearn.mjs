// R3 F2 完课推手：POST /auto-learning（runDayLearning 同款 executeAutoLearning，maxTurns 上限内）
// 把当前 active 课推到完课（收口门禁满足 → wrapup → completeCheckpointedSimulationTask → 修复挂点）。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('D:/wenflow/wenflow');
const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href);

const BASE = 'http://127.0.0.1:3011';
const VSESSION = process.argv[2] || '01b3ab42-79c3-45a4-b4f4-0cfeadb96357';
const MAX_TURNS = Number(process.argv[3] || 40);
const cookie = await getAdminCookie(BASE, envGet);
if (!cookie) throw new Error('admin cookie 获取失败');

const t0 = Date.now();
// node:http 长连接（undici 5min headersTimeout 不够整课时长；ad-driver apiLong 同款）
const payload = JSON.stringify({ maxMilestones: 1, maxTurns: MAX_TURNS });
const url = new URL(`${BASE}/api/admin/virtual-learners/sessions/${VSESSION}/auto-learning`);
const result = await new Promise((resolve, reject) => {
  const req = http.request({
    hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST', agent: false,
    headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, (r) => {
    let text = '';
    r.setEncoding('utf8');
    r.on('data', (c) => { text += c; });
    r.on('end', () => resolve({ status: r.statusCode, text }));
  });
  req.on('error', reject);
  req.setTimeout(60 * 60 * 1000, () => { const e = new Error('http timeout'); e.name = 'TimeoutError'; req.destroy(e); });
  req.write(payload);
  req.end();
});
console.log(`auto-learning: http=${result.status} elapsed=${Math.round((Date.now() - t0) / 1000)}s`);
console.log(result.text.slice(0, 900));
