/**
 * 端到端验证 prompt-eval：
 * 1. 通过 API 创建带 inputPayload 的 DB 评估用例（path/stage）
 * 2. 跑批量评估（caseIds）
 * 3. 确认契约检查通过
 */
import dotenv from 'dotenv';
dotenv.config();
import http from 'http';
import prisma from '../src/config/database';
import { signSessionToken } from '../src/utils/session-token';

let ADMIN_TOKEN = '';

function request(method: string, url: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0,
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    }, (res) => {
      let chunk = '';
      res.on('data', (d) => { chunk += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(chunk)); } catch { resolve({ raw: chunk }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const admin = await prisma.users.findFirst({
    where: { isAdmin: true, deletedAt: null },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new Error('DB 中没有管理员用户');
  ADMIN_TOKEN = signSessionToken({ userId: admin.id, email: admin.email, isAdmin: true }, 'admin', '1h');

  const BASE = 'http://localhost:3001/api/admin/prompt-ops';

  // 1. 创建 path 用例（带结构化输入）
  const caseId = `verify-path-${Date.now().toString(36)}`;
  const createRes = await request('POST', `${BASE}/eval-cases`, {
    agentId: 'skill:path-planning',
    caseId,
    name: '三个月前端（端到端验证）',
    messages: [{ role: 'user', content: '我想用三个月学会前端做出作品集，每周两次每次一小时' }],
    inputPayload: {
      type: 'path',
      goal: '我想用三个月学会前端做出作品集，每周两次每次一小时',
      currentLevel: 'beginner',
      expectedMilestones: 3,
    },
    expectations: { expectedMilestones: 3, mustIncludeFields: ['cognitiveCore', 'milestones'] },
    enabled: true,
  });
  console.log('create path case:', createRes.success ? 'OK' : JSON.stringify(createRes));

  // 2. 跑批量评估（caseIds）
  const runRes = await request('POST', `${BASE}/run-eval`, {
    agentId: 'skill:path-planning',
    caseIds: [caseId],
    repeatCount: 1,
  });
  const summary = runRes.data?.summary;
  console.log('\nrun-eval summary:', JSON.stringify(summary));
  const checks = runRes.data?.results?.[0]?.checks;
  console.log('checks:', JSON.stringify(checks, null, 2));

  // 3. 创建 goal 用例（人话校验 mustContainText + mustNotInclude）
  const goalCaseId = `verify-goal-${Date.now().toString(36)}`;
  const goalCreate = await request('POST', `${BASE}/eval-cases`, {
    agentId: 'skill:goal-conversation',
    caseId: goalCaseId,
    name: '考英语（人话校验验证）',
    messages: [{ role: 'user', content: '我想考英语，时间不多，帮我想想怎么安排' }],
    expectations: {
      mustContainText: ['目标'],
      mustNotInclude: ['我不知道', '暂时无法'],
    },
    enabled: true,
  });
  console.log('\ncreate goal case:', goalCreate.success ? 'OK' : JSON.stringify(goalCreate));

  // 3.5 跑 goal 用例，确认 mustContain/mustNotInclude 检查出现且全过
  const goalRun = await request('POST', `${BASE}/run-eval`, {
    agentId: 'skill:goal-conversation',
    caseIds: [goalCaseId],
    repeatCount: 1,
  });
  const goalChecks = goalRun.data?.results?.[0]?.checks;
  console.log('goal run summary:', JSON.stringify(goalRun.data?.summary));
  console.log('goal checks:', JSON.stringify(goalChecks, null, 2));

  // 4. 清理：删除用例
  const list = await request('GET', `${BASE}/eval-cases?agentId=skill:path-planning`);
  const created = (list.data || []).find((c: any) => c.caseId === caseId);
  if (created) {
    const del = await request('DELETE', `${BASE}/eval-cases/${created.id}`);
    console.log('\ncleanup delete:', del.success ? 'OK' : JSON.stringify(del));
  }
  const goalList = await request('GET', `${BASE}/eval-cases?agentId=skill:goal-conversation`);
  const goalCreated = (goalList.data || []).find((c: any) => c.caseId === goalCaseId);
  if (goalCreated) {
    const del = await request('DELETE', `${BASE}/eval-cases/${goalCreated.id}`);
    console.log('cleanup delete goal:', del.success ? 'OK' : JSON.stringify(del));
  }

  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });