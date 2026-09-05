/**
 * 端到端验证：simulated 评估模式（虚拟学习者扮演输入）
 * 1. 新建场景（scenario）+ goal 多轮模拟（dialogueRounds=2）
 * 2. 复用已有虚拟人（personaId）+ 单轮（首句来自其故事池）
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

  // 1. 新建场景 + 多轮模拟（goal）
  console.log('===== 场景 1：反馈多轮模拟对话 =====');
  const run1 = await request('POST', `${BASE}/run-eval`, {
    agentId: 'skill:goal-conversation',
    adhocCases: [{
      id: 'sim-scenario',
      name: '考英语（场景模拟·多轮）',
      messages: [{ role: 'user', content: '' }],
      expectations: {
        mode: 'simulated',
        scenario: '我想考英语，时间不多，每周只能挤两次一小时',
        dialogueRounds: 2,
        frictionBudget: 'normal',
        mustIncludeFields: ['stage'],
        mustContainText: ['目标'],
        convergeRequires: ['real_problem'],
      },
    }],
    repeatCount: 1,
  });
  const r1 = run1.data?.results?.[0];
  console.log('summary:', JSON.stringify(run1.data?.summary));
  console.log('checks:', JSON.stringify(r1?.checks, null, 2));
  console.log('studentTurns:', r1?.studentTurns, 'converged:', r1?.converged);
  // ===== 输入/输出字段展示（验证 simMeta + output.fields + transcript.fields）=====
  console.log('simMeta:', JSON.stringify(r1?.simMeta, null, 1));
  console.log('output.fields:', JSON.stringify(r1?.output?.fields));
  console.log('transcript fields per round:');
  for (const t of r1?.transcript || []) {
    if (t.fields) console.log(`  [r${t.round}] fields:`, JSON.stringify(t.fields));
  }
  console.log('transcript:');
  for (const t of r1?.transcript || []) {
    console.log(`  [r${t.round} ${t.role}] ${String(t.content).slice(0, 120)}`);
    if (t.error) console.log(`       ERROR: ${t.error}`);
    if (t.learnerState) console.log(`       learnerState: readyToProceed=${t.learnerState.readyToProceed} phaseFocus=${t.learnerState.phaseFocus} feltUnderstood=${t.learnerState.feltUnderstood}`);
  }

  // 2. 复用已有虚拟人（personaId 来自其故事池，单轮）
  console.log('\n===== 场景 2：复用已有虚拟人 =====');
  const profile = await prisma.virtual_learner_profiles.findFirst({
    where: { profile: { contains: 'storyPool' } },
    orderBy: { createdAt: 'desc' },
  });
  if (profile) {
    const run2 = await request('POST', `${BASE}/run-eval`, {
      agentId: 'skill:goal-conversation',
      adhocCases: [{
        id: 'sim-persona',
        name: '复用虚拟人（首句来自故事池）',
        messages: [{ role: 'user', content: '' }],
        expectations: {
          mode: 'simulated',
          personaId: profile.id,
          dialogueRounds: 1,
          frictionBudget: 'normal',
        },
      }],
      repeatCount: 1,
    });
    const r2 = run2.data?.results?.[0];
    console.log('persona:', profile.id, '| summary:', JSON.stringify(run2.data?.summary));
    console.log('首条学生诉求:', JSON.stringify(r2?.input?.userInput).slice(0, 150));
    console.log('checks:', JSON.stringify(r2?.checks));
  } else {
    console.log('无可用虚拟人，跳过');
  }

  // 3. DB 用例：simulated 保存（messages 为空）+ 批量跑（用户真实路径）
  console.log('\n===== 场景 3：DB simulated 用例保存 + 批量跑 =====');
  const simCaseId = `sim-db-${Date.now().toString(36)}`;
  const create = await request('POST', `${BASE}/eval-cases`, {
    agentId: 'skill:goal-conversation',
    caseId: simCaseId,
    name: '考英语（DB模拟用例）',
    messages: [], // simulated 模式允许空
    expectations: {
      mode: 'simulated',
      scenario: '想学 Python 做自动化，但白天上班晚上带娃，只有周末两小时',
      dialogueRounds: 1,
      frictionBudget: 'normal',
      mustIncludeFields: ['stage'],
    },
    enabled: true,
  });
  console.log('create:', create.success ? 'OK' : JSON.stringify(create));

  const list = await request('GET', `${BASE}/eval-cases?agentId=skill:goal-conversation`);
  const saved = (list.data || []).find((c: any) => c.caseId === simCaseId);
  console.log('saved expectations:', JSON.stringify(saved?.expectations).slice(0, 200));

  const run3 = await request('POST', `${BASE}/run-eval`, {
    agentId: 'skill:goal-conversation',
    caseIds: [simCaseId],
    repeatCount: 1,
  });
  console.log('run3 summary:', JSON.stringify(run3.data?.summary));
  console.log('run3 result input.userInput:', JSON.stringify(run3.data?.results?.[0]?.input?.userInput).slice(0, 140));
  console.log('run3 checks:', JSON.stringify(run3.data?.results?.[0]?.checks));

  // 清理
  if (saved) {
    const del = await request('DELETE', `${BASE}/eval-cases/${saved.id}`);
    console.log('cleanup:', del.success ? 'OK' : JSON.stringify(del));
  }

  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });