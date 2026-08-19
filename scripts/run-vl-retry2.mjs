/**
 * 重启虚拟学习者会话 — 先 restart-learning，再循环 teaching-step
 */
import http from 'http';

const SESSION_ID = 'ee795d57-54ea-4051-8da1-9005318cc7c0';

function fetch(method, path, body, cookie, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', 'Origin': 'http://localhost:5173' };
    if (cookie) headers['Cookie'] = cookie;
    const req = http.request({ hostname: 'localhost', port: 3001, path, method, headers, timeout }, (res) => {
      let respBody = '';
      res.on('data', (d) => respBody += d);
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] || [];
        const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
        resolve({ status: res.statusCode, body: respBody, cookie: cookieStr });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '{"error":"timeout"}', cookie: '' }); });
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // 登录
  console.log('1. 登录...');
  const login = await fetch('POST', '/api/admin-auth/login', {
    name: 'admin', password: 'ChangeMe_2026_Admin', remember: true
  }, 10000);
  const loginData = JSON.parse(login.body);
  if (!loginData.success) { console.log('  登录失败:', loginData); return; }
  const cookie = login.cookie;
  console.log('  登录成功');

  // Step 2: restart-learning
  console.log('\n2. restart-learning...');
  const restart = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie);
  console.log(`  status: ${restart.status}`);
  try {
    const d = JSON.parse(restart.body);
    console.log(`  success: ${d.success}`);
    if (d.data) console.log(`  data: ${JSON.stringify(d.data).substring(0, 200)}`);
    if (d.error) console.log(`  error: ${d.error}`);
  } catch { console.log(`  raw: ${restart.body.substring(0, 300)}`); }

  // Step 3: 循环 teaching-step
  console.log('\n3. 循环 teaching-step（50步，每步重试5次）...');
  for (let step = 1; step <= 50; step++) {
    let ok = false;
    for (let retry = 0; retry < 5; retry++) {
      const r = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/teaching-step`, {}, cookie);
      if (r.status === 0) {
        console.log(`  [${step}.${retry}] 超时，等3s重试`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      try {
        const d = JSON.parse(r.body);
        if (d.success) {
          const res = d.data || d;
          console.log(`  [${step}.${retry}] ✅ turns=${res.turns || '?'} ${res.taskCompleted ? '📦 taskDone' : ''} ${res.isPathCompleted ? '🎉 pathDone' : ''}`);
          if (res.isPathCompleted) {
            console.log(`\n🎉 全路径完成！步骤 ${step}`);
            return;
          }
          ok = true;
          break;
        } else {
          const err = (d.error || d.data?.error || '').substring(0, 80);
          console.log(`  [${step}.${retry}] ❌ ${err}`);
          if (err.includes('已完成') || err.includes('不存在') || err.includes('已废弃')) {
            console.log('  会话终态，退出');
            return;
          }
          // provider 错误 → 等5s重试
          if (err.includes('Provider') || err.includes('retry') || err.includes('timeout') || err.includes('503') || err.includes('overload') || err.includes('budget')) {
            console.log(`  等5s重试...`);
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
          // 学习已停止 → restart
          if (err.includes('停止') || err.includes('stopped') || err.includes('failed')) {
            console.log(`  restart-learning...`);
            const rs = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie);
            try {
              const rd = JSON.parse(rs.body);
              console.log(`  restart: ${rd.success ? '✅' : '❌'} ${rd.error ? rd.error.substring(0, 60) : ''}`);
            } catch {}
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          // 未知错误也重试
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
      } catch {
        console.log(`  [${step}.${retry}] parse error: ${r.body.substring(0, 100)}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    if (!ok) {
      console.log(`  [${step}] 5次重试全失败，restart-learning 后继续...`);
      const rs = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie);
      try {
        const rd = JSON.parse(rs.body);
        console.log(`  restart: ${rd.success ? '✅' : '❌'} ${rd.error ? rd.error.substring(0, 60) : ''}`);
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n⚠️ 达到50步上限');
}

main().catch(console.error);
