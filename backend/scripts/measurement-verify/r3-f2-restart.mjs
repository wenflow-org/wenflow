// R3 F2 收束推手：VL-B1 的自动课挂在「末问未答等学员作答」（chunks 用完、status=active）。
// 用产品 API restart-learning 复活续跑（R1/R2 实证：未完成课由 restart-learning 按 同 taskId 续跑完成），
// 目标：让 completeCheckpointedSimulationTask 走到修复挂点 applyWarmupExtractionForSession。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('D:/wenflow/wenflow');
const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href);

const BASE = 'http://127.0.0.1:3011';
const VSESSION = '01b3ab42-79c3-45a4-b4f4-0cfeadb96357';
const cookie = await getAdminCookie(BASE, envGet);
if (!cookie) throw new Error('admin cookie 获取失败');

const res = await fetch(`${BASE}/api/admin/virtual-learners/sessions/${VSESSION}/restart-learning`, {
  method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: '{}',
});
const text = await res.text();
console.log('restart-learning:', res.status, text.slice(0, 500));
