/**
 * 推进虚拟学习者会话 — 从 path → learn → 完成
 * 
 * 步骤：1. accept-path  2. start-learning  3. 循环 teaching-step 直到完成
 * 用法: node scripts/run-vl-learn.mjs <sessionId>
 */
import http from 'http';

const SESSION_ID = process.argv[2] || 'ee795d57-54ea-4051-8da1-9005318cc7c0';

function fetch(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', 'Origin': 'http://localhost:5173' };
    if (cookie) headers['Cookie'] = cookie;
    
    const req = http.request({ hostname: 'localhost', port: 3001, path, method, headers }, (res) => {
      let respBody = '';
      res.on('data', (d) => respBody += d);
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] || [];
        const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
        resolve({ status: res.statusCode, body: respBody, cookie: cookieStr });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('1. 登录 admin...');
  const login = await fetch('POST', '/api/admin-auth/login', {
    name: 'admin', password: 'ChangeMe_2026_Admin', remember: true
  });
  const loginData = JSON.parse(login.body);
  if (!loginData.success) { console.log('  登录失败:', loginData); return; }
  console.log('  登录成功');
  const cookie = login.cookie;

  // Step 2: accept-path
  console.log('\n2. 接受路径评审 (accept-path)...');
  const accept = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/accept-path`, {}, cookie);
  console.log(`  status: ${accept.status}`);
  try {
    const d = JSON.parse(accept.body);
    console.log(`  success: ${d.success}`, d.error ? `error: ${d.error}` : '');
  } catch { console.log(`  raw: ${accept.body.substring(0, 200)}`); }

  // Step 3: start-learning
  console.log('\n3. 启动学习阶段 (start-learning)...');
  const start = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/start-learning`, {}, cookie);
  console.log(`  status: ${start.status}`);
  try {
    const d = JSON.parse(start.body);
    console.log(`  success: ${d.success}`, d.error ? `error: ${d.error}` : '');
    if (d.data) console.log(`  data:`, JSON.stringify(d.data).substring(0, 200));
  } catch { console.log(`  raw: ${start.body.substring(0, 200)}`); }

  // Step 4: 循环 teaching-step
  console.log('\n4. 循环执行教学步骤 (teaching-step)...');
  for (let i = 1; i <= 30; i++) {
    console.log(`\n  [step ${i}] 调用 teaching-step...`);
    const step = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/teaching-step`, {}, cookie);
    try {
      const d = JSON.parse(step.body);
      if (d.success) {
        const r = d.data || d;
        console.log(`    success: true`);
        if (r.taskCompleted) console.log(`    taskCompleted: true`);
        if (r.isPathCompleted) { console.log(`    isPathCompleted: true — 全路径完成!`); break; }
        if (r.error) console.log(`    error: ${r.error}`);
        if (r.currentTaskStopped) console.log(`    currentTaskStopped: true`);
      } else {
        console.log(`    success: false error: ${d.error || (d.data && d.data.error) || 'unknown'}`);
        if (d.error && (d.error.includes('已完成') || d.error.includes('已停止') || d.error.includes('不存在'))) break;
      }
    } catch {
      console.log(`    raw: ${step.body.substring(0, 200)}`);
      break;
    }
    
    // 等待 2 秒避免过快
    await new Promise(r => setTimeout(r, 2000));
  }

  // 最终状态
  console.log('\n5. 检查最终状态...');
  const status = await fetch('GET', `/api/admin/virtual-learners/sessions/${SESSION_ID}/status`, null, cookie);
  try {
    const d = JSON.parse(status.body);
    console.log(`  status: ${d.success ? 'ok' : 'err'}`);
    if (d.data) console.log(`  session:`, JSON.stringify(d.data).substring(0, 300));
  } catch { console.log(`  raw: ${status.body.substring(0, 200)}`); }
}

main().catch(console.error);
