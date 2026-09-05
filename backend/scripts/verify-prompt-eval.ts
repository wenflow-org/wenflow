/** 验证 prompt-eval run-eval 支持 path-planning/stage-designer */
import dotenv from 'dotenv';
dotenv.config();
import http from 'http';
import prisma from '../src/config/database';
import { signSessionToken } from '../src/utils/session-token';

async function buildAdminToken(): Promise<string> {
  const admin = await prisma.users.findFirst({
    where: { isAdmin: true, deletedAt: null },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new Error('DB 中没有管理员用户');
  // legacy token（不带 jti）→ adminMiddleware 走兼容放行
  return signSessionToken({ userId: admin.id, email: admin.email, isAdmin: true }, 'admin', '1h');
}

function post(url: string, body: any, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let chunk = '';
      res.on('data', (d) => { chunk += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(chunk)); } catch { resolve({ raw: chunk }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const ADMIN_TOKEN = await buildAdminToken();

  // 1. path-planning adhoc 评估（验证 milestone 契约 + expectedMilestones 注入）
  const pathRes = await post('http://localhost:3001/api/admin/prompt-ops/run-eval', {
    agentId: 'skill:path-planning',
    adhocCases: [{
      id: 'p1',
      name: '三个月前端',
      messages: [{ role: 'user', content: '我想用三个月学会前端做出作品集，每周两次每次一小时' }],
      inputPayload: {
        type: 'path',
        goal: '我想用三个月学会前端做出作品集，每周两次每次一小时',
        currentLevel: 'beginner',
        metadata: { availableTime: '每周两次每次一小时' },
        expectedMilestones: 3, // 模拟 coordinator 的 targetMilestones 注入
      },
      expectations: {
        expectedMilestones: 3,
        mustIncludeFields: ['cognitiveCore', 'milestones'],
      },
    }],
    repeatCount: 1,
  }, ADMIN_TOKEN);
  console.log('=== path-planning run-eval ===');
  console.log('success:', pathRes.success, '| error:', pathRes.error?.message || '');
  if (pathRes.data) {
    console.log('summary:', JSON.stringify(pathRes.data.summary));
    console.log('results[0].checks:', JSON.stringify(pathRes.data.results?.[0]?.checks, null, 2));
    console.log('results[0].output:', JSON.stringify(pathRes.data.results?.[0]?.output)?.slice(0, 400));
  }

  // 2. stage-designer adhoc 评估
  const stageRes = await post('http://localhost:3001/api/admin/prompt-ops/run-eval', {
    agentId: 'skill:stage-designer',
    adhocCases: [{
      id: 's1',
      name: '血压记录阶段',
      messages: [{ role: 'user', content: '为当前阶段设计子任务' }],
      inputPayload: {
        milestone: { stageNumber: 1, title: '识别记录工具可靠性', coreConcept: 'concept-1', estimatedHours: 1 },
        cognitiveCore: {
          cognitiveDomain: '在约束下识别并建立可靠记录',
          coreConcepts: [{ id: 'concept-1', name: '记录工具可靠性的判断与选择', role: 'hub' }],
        },
        normalizedInput: null,
        expectedSubtaskCount: 4, // 模拟 coordinator 的 targetSubtasksPerStage 注入
      },
      expectations: { expectedSubtaskCount: 4, mustIncludeFields: ['subtasks'] },
    }],
    repeatCount: 1,
  }, ADMIN_TOKEN);
  console.log('\n=== stage-designer run-eval ===');
  console.log('success:', stageRes.success, '| error:', stageRes.error?.message || '');
  if (stageRes.data) {
    console.log('summary:', JSON.stringify(stageRes.data.summary));
    console.log('results[0].checks:', JSON.stringify(stageRes.data.results?.[0]?.checks, null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });