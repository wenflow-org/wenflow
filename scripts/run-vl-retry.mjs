/**
 * 重试虚拟学习者会话 — restartLearningPhase + 循环 teaching-step
 * LLM provider 不稳定时自动重试
 */
import http from 'http';

const SESSION_ID = process.argv[2] || 'ee795d57-54ea-4051-8da1-9005318cc7c0';
const MAX_RETRIES = 5;
const STEP_TIMEOUT = 120000; // 2 min per step

function fetch(method, path, body, cookie, timeout = 120000) {
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
  console.log('1. 登录...');
  const login = await fetch('POST', '/api/admin-auth/login', {
    name: 'admin', password: 'ChangeMe_2026_Admin', remember: true
  }, 10000);
  const cookie = JSON.parse(login.body).success ? login.cookie : null;
  if (!cookie) { console.log('  登录失败'); return; }
  console.log('  登录成功');

  // 检查当前状态
  let session = await fetch('GET', `/api/admin/virtual-learners/sessions/${SESSION_ID}/status`, null, cookie);
  let sessionData = JSON.parse(session.body);
  console.log(`\n当前状态: stage=${sessionData.data?.currentStage || '?'} status=${sessionData.data?.status || '?'}`);

  // 如果 failed，先 restart
  if (sessionData.data?.status === 'failed' || sessionData.data?.status === 'abandoned') {
    console.log('\n2. 会话已失败/放弃，重启学习阶段...');
    const restart = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie);
    const rd = JSON.parse(restart.body);
    console.log(`  restart: success=${rd.success} ${rd.error ? 'error: ' + rd.error : ''}`);
    if (rd.data?.welcomeMessage) console.log(`  welcome: ${rd.data.welcomeMessage.substring(0, 80)}...`);
  }

  // 循环执行 teaching-step，带重试
  console.log('\n3. 循环执行教学步骤（带重试）...');
  let stepCount = 0;
  let totalRetries = 0;
  
  for (let i = 0; i < 50; i++) {
    stepCount++;
    let stepSuccess = false;
    
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      console.log(`\n  [step ${stepCount} retry ${retry}] teaching-step...`);
      const step = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/teaching-step`, {}, cookie, STEP_TIMEOUT);
      
      if (step.status === 0) {
        console.log(`    超时，重试...`);
        totalRetries++;
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      
      try {
        const d = JSON.parse(step.body);
        if (d.success) {
          const r = d.data || d;
          stepSuccess = true;
          console.log(`    ✅ success`);
          if (r.taskCompleted) console.log(`    📦 taskCompleted!`);
          if (r.isPathCompleted) {
            console.log(`    🎉 全路径完成!`);
            console.log(`\n=== 完成！总步骤 ${stepCount}，总重试 ${totalRetries} ===`);
            return;
          }
          break; // 成功则跳出重试循环
        } else {
          const err = d.error || (d.data && d.data.error) || 'unknown';
          console.log(`    ❌ ${err.substring(0, 80)}`);
          
          if (err.includes('已完成') || err.includes('已停止') || err.includes('不存在') || err.includes('已废弃')) {
            console.log(`    会话已终态，停止`);
            return;
          }
          
          // provider 错误 → 重试
          if (err.includes('Provider') || err.includes('retry') || err.includes('timeout') || err.includes('overload') || err.includes('503')) {
            totalRetries++;
            console.log(`    等待 5s 后重试...`);
            await new Promise(r => setTimeout(r, 5000));
            
            // 重试前 restart learning
            if (retry === MAX_RETRIES - 1) {
              console.log(`    达到最大重试，restart-learning 后继续...`);
              const restart = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie, STEP_TIMEOUT);
              totalRetries++;
            }
            continue;
          }
          
          // 其他错误也重试
          totalRetries++;
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
      } catch {
        console.log(`    parse error: ${step.body.substring(0, 100)}`);
        totalRetries++;
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
    }
    
    if (!stepSuccess) {
      console.log(`    step ${stepCount} 重试 ${MAX_RETRIES} 次后仍失败，restart-learning...`);
      const restart = await fetch('POST', `/api/admin/virtual-learners/sessions/${SESSION_ID}/restart-learning`, {}, cookie, STEP_TIMEOUT);
      const rd = JSON.parse(restart.body);
      console.log(`    restart: success=${rd.success} ${rd.error ? rd.error.substring(0, 60) : ''}`);
      if (!rd.success) {
        console.log(`    restart 失败，跳过此步骤`);
      }
      totalRetries++;
    }
    
    // 检查会话状态
    session = await fetch('GET', `/api/admin/virtual-learners/sessions/${SESSION_ID}/status`, null, cookie, 10000);
    sessionData = JSON.parse(session.body);
    if (sessionData.data?.status === 'completed') {
      console.log(`\n🎉 会话已完成！总步骤 ${stepCount}，总重试 ${totalRetries}`);
      return;
    }
    if (sessionData.data?.status !== 'running') {
      console.log(`\n⚠️ 会话状态: ${sessionData.data?.status}，停止`);
      return;
    }
    
    // 短暂等待
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`\n⚠️ 达到最大步骤数。总步骤 ${stepCount}，总重试 ${totalRetries}`);
}

main().catch(console.error);
