/**
 * 推进虚拟学习者会话 — 从当前阶段到全路径完成
 * 
 * 用法: node scripts/run-vl-full.mjs <sessionId>
 */
import http from 'http';

const BASE = 'localhost:3001';
const SESSION_ID = process.argv[2] || 'ee795d57-54ea-4051-8da1-9005318cc7c0';

function fetch(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', 'Origin': 'http://localhost:5173' };
    if (cookie) headers['Cookie'] = cookie;
    
    const req = http.request({ hostname: 'localhost', port: 3001, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        // 提取 set-cookie
        const setCookies = res.headers['set-cookie'] || [];
        const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
        resolve({ status: res.statusCode, body, cookie: cookieStr });
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
    name: 'admin',
    password: 'ChangeMe_2026_Admin',
    remember: true
  });
  console.log(`  status: ${login.status}`);
  const loginData = JSON.parse(login.body);
  console.log(`  success: ${loginData.success}`);
  if (!login.cookie) {
    console.log('  ERROR: No cookie set');
    return;
  }
  console.log(`  cookie: ${login.cookie.substring(0, 40)}...`);

  console.log(`\n2. 调用 run-full (session: ${SESSION_ID})...`);
  console.log('  这可能需要几分钟（LLM 调用多个教学回合）...');
  
  const runFull = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/run-full`, {
    maxRounds: 20,
    maxMilestones: 10,
    continueOnTaskComplete: true,
    autoAdvanceToPath: true,
    autoAdvanceToLearning: true
  }, login.cookie);
  
  console.log(`  status: ${runFull.status}`);
  try {
    const result = JSON.parse(runFull.body);
    console.log(`  success: ${result.success}`);
    if (result.result) {
      console.log(`  result:`, JSON.stringify(result.result, null, 2).substring(0, 500));
    } else if (result.error) {
      console.log(`  error: ${result.error.message || JSON.stringify(result.error)}`);
    }
  } catch {
    console.log(`  raw: ${runFull.body.substring(0, 500)}`);
  }
}

main().catch(console.error);
