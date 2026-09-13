/**
 * 继续推进虚拟学习者 — 改进版：更长的重试间隔，更智能的恢复
 */
import http from 'http';

const SESSION_ID = 'ee795d57-54ea-4051-8da1-9005318cc7c0';

function fetch(method, path, body, cookie, timeout = 180000) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', 'Origin': 'http://localhost:5173' };
    if (cookie) headers['Cookie'] = cookie;
    const req = http.request({ hostname: 'localhost', port: 3001, path, method, headers, timeout }, (res) => {
      let respBody = '';
      res.on('data', (d) => respBody += d);
      res.on('end', () => {
        const sc = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, body: respBody, cookie: sc.map(c => c.split(';')[0]).join('; ') });
      });
    });
    req.on('error', () => resolve({ status: 0, body: '{"error":"network"}', cookie: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '{"error":"timeout"}', cookie: '' }); });
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('1. 登录...');
  const login = await fetch('POST', '/api/admin-auth/login', {
    name: 'admin', password: 'ChangeMe_2026_Admin', remember: true
  }, 10000);
  const cookie = JSON.parse(login.body).success ? login.cookie : null;
  if (!cookie) return;
  console.log('  OK');

  // 先 restart-learning（会话是 failed 状态）
  console.log('\n2. restart-learning...');
  let r = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie);
  console.log(`  ${JSON.parse(r.body).success ? '✅' : '❌'}`);

  // 循环 teaching-step
  console.log('\n3. 循环 teaching-step...');
  let consecutiveFails = 0;
  
  for (let step = 1; step <= 100; step++) {
    r = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/teaching-step`, {}, cookie);
    
    try {
      const d = JSON.parse(r.body);
      
      if (d.success) {
        consecutiveFails = 0;
        const res = d.data || d;
        const turns = res.turns ?? '?';
        const taskDone = res.taskCompleted ? '📦taskDone' : '';
        const pathDone = res.isPathCompleted ? '🎉pathDone' : '';
        console.log(`  [${step}] ✅ turns=${turns} ${taskDone} ${pathDone}`);
        
        if (res.isPathCompleted) {
          console.log('\n🎉🎉🎉 全路径完成！');
          return;
        }
        if (res.currentTaskStopped) {
          console.log(`  task stopped, restart...`);
          await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie);
        }
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      
      // 失败
      consecutiveFails++;
      const err = (d.error || d.data?.error || '').substring(0, 100);
      console.log(`  [${step}] ❌ ${err}`);
      
      if (err.includes('已完成') || err.includes('不存在') || err.includes('已废弃')) {
        console.log('  终态，退出');
        return;
      }
      
      // restart + 等待（越长越好，让 provider 恢复）
      const waitMs = consecutiveFails >= 3 ? 10000 : 5000;
      console.log(`  restart + 等${waitMs/1000}s...`);
      await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie);
      await new Promise(r => setTimeout(r, waitMs));
      
      // 连续 5 次失败，等更久
      if (consecutiveFails >= 5) {
        console.log(`  连续${consecutiveFails}次失败，等30s让 provider 恢复...`);
        await new Promise(r => setTimeout(r, 30000));
        consecutiveFails = 0;
      }
      
    } catch {
      console.log(`  [${step}] parse error`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log('\n⚠️ 100步上限');
}

main().catch(console.error);
