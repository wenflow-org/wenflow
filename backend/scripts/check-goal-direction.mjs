#!/usr/bin/env node
/**
 * Goal 方向检查（2026-11-17 进入态/起步路径改造）：
 * 只推进 goal 阶段（autopilot target='stage'），不改教学、不跑裁判。
 *
 * 检查项：
 *  - entry_state 是否按预期判为 exploratory / focused
 *  - exploratory 是否收敛为 2 阶段、objectiveScopeHours<=2、out_of_scope 有留白
 *  - 是否没有追问「用在哪 / 深入到什么程度 / 最近一次卡住」这类开放态不该问的问题
 *  - focused 控制例是否未被误压成 2 阶段
 *  - goal 是否真的收敛（proposing/ready/completed 或已绑定路径），而不是卡在 understanding
 *
 * 用法：
 *   node scripts/check-goal-direction.mjs --cases-file=src/scripts/campaigns/2026-11-17-goal-direction.json
 *   node scripts/check-goal-direction.mjs --cases=x01-wang-yangming --concurrency=1
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const backendRoot = resolve(import.meta.dirname, '..');
const { PrismaClient } = require('@prisma/client');

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
function log(caseId, line) {
  console.log(`[${new Date().toISOString()}]${caseId ? `[${caseId}]` : ''} ${line}`);
}

const baseUrl = arg('base-url', process.env.E2E_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const ORIGIN = process.env.E2E_ORIGIN || 'http://localhost:5173';
const adminName = arg('admin-name', process.env.E2E_ADMIN_NAME || 'admin');
const adminPassword = arg('admin-password', process.env.E2E_ADMIN_PASSWORD || process.env.INIT_ADMIN_PASSWORD || 'ChangeMe_2026_Admin');
const casesPath = resolve(backendRoot, arg('cases-file', join('src', 'scripts', 'campaigns', '2026-11-17-goal-direction.json')));
const runRoot = resolve(backendRoot, arg('run-dir', join('.runtime', 'goal-direction', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))));
const timeoutMin = Math.max(3, Number(arg('timeout-min', '20')) || 20);
const pollMs = Math.max(5_000, Number(arg('poll-sec', '10')) * 1000 || 10_000);
const waitPathSec = Math.max(0, Number(arg('wait-path-sec', '90')) || 0);

const spec = readJson(casesPath, { cases: [] });
const allCases = Array.isArray(spec.cases) ? spec.cases : [];
const caseIds = String(arg('cases', '')).split(',').map((s) => s.trim()).filter(Boolean);
const cases = caseIds.length
  ? caseIds.map((id) => allCases.find((c) => c.id === id || c.id.startsWith(id))).filter(Boolean)
  : allCases;
if (!cases.length) {
  console.error(`没有匹配到 case（cases-file=${casesPath}）`);
  process.exit(1);
}

let cookie = '';
async function login() {
  const response = await fetch(`${baseUrl}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name: adminName, password: adminPassword, remember: true }),
  });
  const setCookie = response.headers.getSetCookie?.().join('; ') || response.headers.get('set-cookie') || '';
  cookie = setCookie.split(';')[0] || '';
  if (!response.ok || !cookie) throw new Error(`管理员登录失败 http=${response.status}`);
}
async function api(method, path, body, timeoutMs = 120_000) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}
const dataOf = (body) => body?.data && typeof body.data === 'object' ? body.data : null;

function storyFor(c) {
  return {
    id: `story_${c.id}`,
    title: `${c.id}｜${c.domain || ''}`,
    sourceType: 'goal',
    outline: [c.story?.role, c.story?.scenario].filter(Boolean).join('｜'),
    visibleOpening: c.story?.opening || c.goal,
    triggerEvent: c.story?.trigger || '',
    goalSeed: { surfaceGoal: c.goal, realProblem: c.story?.problem || '' },
    pressurePoints: [c.story?.problem, c.story?.scenario].filter(Boolean),
    behaviorHooks: [c.story?.trigger].filter(Boolean),
  };
}

const prisma = new PrismaClient();

function findForbiddenAsk(aiText) {
  // 只看「问句」：x03 实测 AI 说「先不预设你要学到多深、用在哪」是明确不追问，
  // 旧实现扫全段文本会把它误判成追问。按句切分，仅检查带问号的句子。
  const sentences = aiText.split(/(?<=[。！？?!\n])/).map((s) => s.trim()).filter(Boolean);
  const forbidden = /用在哪|用在哪里|深入到什么程度|想深入.{0,6}程度|最近一次.{0,8}卡住|卡在哪|什么程度/;
  return sentences.find((s) => /[？?]/.test(s) && forbidden.test(s)) || null;
}

async function inspectGoal(c, sessionId) {
  const session = await prisma.virtual_sessions.findUnique({
    where: { id: sessionId },
    select: { goalConversationId: true, status: true, currentStage: true },
  });
  if (!session?.goalConversationId) return { session, conversation: null };
  const conv = await prisma.goal_conversations.findUnique({ where: { id: session.goalConversationId } });
  if (!conv) return { session, conversation: null };
  let data = {};
  try { data = JSON.parse(conv.collectedData || '{}'); } catch { /* ignore */ }
  const understanding = data.understanding || {};
  const proposal = data.confirmedProposal || null;
  const aiText = (Array.isArray(data.messages) ? data.messages : [])
    .filter((m) => m?.role === 'ai' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('\n');
  let path = null;
  if (conv.learningPathId) {
    path = await prisma.learning_paths.findUnique({
      where: { id: conv.learningPathId },
      include: { milestones: { orderBy: { stageNumber: 'asc' } } },
    });
  }
  const forbiddenAsk = findForbiddenAsk(aiText);
  return {
    session,
    conversation: conv,
    data,
    metrics: {
      stage: conv.stage,
      status: conv.status,
      entryState: understanding.entry_state || null,
      intentType: understanding.intent_type || null,
      turns: Array.isArray(data.messages) ? data.messages.filter((m) => m?.role === 'ai').length : 0,
      hasProposal: !!proposal,
      keyStages: Array.isArray(proposal?.key_stages) ? proposal.key_stages.length : 0,
      plannedMilestones: proposal?.plannedMilestones ?? null,
      previewStages: Array.isArray(proposal?.previewStages) ? proposal.previewStages.length : 0,
      scopeSize: proposal?.scope_size ?? null,
      objectiveScopeHours: understanding?.time_dimensions?.objectiveScopeHours ?? null,
      sessionsLengthMin: understanding?.time_dimensions?.sessionsLengthMin ?? understanding?.available_resources?.time_per_session ?? null,
      outOfScope: Array.isArray(proposal?.out_of_scope) ? proposal.out_of_scope : [],
      firstDeliverable: proposal?.first_deliverable ?? null,
      pathId: conv.learningPathId || null,
      pathStatus: path?.status ?? null,
      pathMilestones: path?.milestones?.length ?? 0,
      pathHours: path?.estimatedHours ?? null,
      askedForbidden: !!forbiddenAsk,
      askedForbiddenText: forbiddenAsk,
      aiTurns: aiText ? aiText.split('\n').slice(-4) : [],
    },
  };
}

function evaluate(c, m) {
  const reasons = [];
  if (!m) return ['没有 goal 会话可检查'];
  if (m.pathStatus === 'failed') reasons.push('路径生成失败');
  const expectedEntry = c.expectEntryState;
  if (expectedEntry && m.entryState !== expectedEntry) {
    reasons.push(`entry_state=${m.entryState ?? 'null'}，期望 ${expectedEntry}`);
  }
  if (c.expectStarter) {
    if (!m.hasProposal && !m.pathMilestones) reasons.push('没有产出 confirmedProposal/路径');
    if (m.keyStages > (c.expectMaxStages ?? 2)) reasons.push(`key_stages=${m.keyStages}，超过起步上限 ${c.expectMaxStages ?? 2}`);
    if (m.plannedMilestones && m.plannedMilestones > (c.expectMaxStages ?? 2)) {
      reasons.push(`plannedMilestones=${m.plannedMilestones}，超过起步上限`);
    }
    if (typeof m.objectiveScopeHours === 'number' && m.objectiveScopeHours > (c.expectMaxHours ?? 2)) {
      reasons.push(`objectiveScopeHours=${m.objectiveScopeHours}，超过起步上限 ${c.expectMaxHours ?? 2}`);
    }
    if (m.hasProposal && m.outOfScope.length === 0) reasons.push('out_of_scope 为空，没有远期留白');
    if (m.askedForbidden) reasons.push(`追问了开放态不该问的用途/深度/卡点问题${m.askedForbiddenText ? `：${String(m.askedForbiddenText).slice(0, 80)}` : ''}`);
    if (m.pathMilestones > (c.expectMaxStages ?? 2)) reasons.push(`路径阶段=${m.pathMilestones}，超过起步上限 ${c.expectMaxStages ?? 2}`);
  }
  if (c.expectStarter === false) {
    if (m.entryState === 'exploratory') reasons.push('明确目标被误判为 exploratory');
    if (m.keyStages && m.keyStages < (c.expectMinStages ?? 3)) reasons.push(`key_stages=${m.keyStages}，低于完整路径下限 ${c.expectMinStages ?? 3}`);
    if (m.pathMilestones && m.pathMilestones < (c.expectMinStages ?? 3)) reasons.push(`路径阶段=${m.pathMilestones}，低于完整路径下限`);
  }
  if (m.stage === 'understanding' && !m.pathId) reasons.push('goal 仍停在 understanding，没有收敛');
  if (!m.hasProposal && !m.pathId && m.stage !== 'completed') reasons.push('没有方案也没有路径');
  return reasons;
}

async function runCase(c) {
  const dir = join(runRoot, c.id);
  const statePath = join(dir, 'state.json');
  const state = {
    caseId: c.id,
    domain: c.domain,
    goal: c.goal,
    createdAt: new Date().toISOString(),
  };

  const created = await api('POST', '/api/admin/virtual-learners', {
    name: c.learnerName || `[goal-dir] ${c.id}`,
    learningGoal: c.goal,
    knowledgeLevel: 'beginner',
    profile: {
      role: c.story?.role || '',
      scenario: c.story?.scenario || '',
      note: 'goal-direction check 自动创建，跑完可删',
      storyPool: [storyFor(c)],
    },
    tags: ['goal-direction', 'disposable'],
    notes: 'auto-created by check-goal-direction.mjs',
  });
  const profile = dataOf(created.body);
  if (created.status !== 200 || !profile?.id) throw new Error(`创建学习者失败 http=${created.status}`);
  state.profileId = String(profile.id);
  state.userId = String(profile.userId || '');
  log(c.id, `学习者 profile=${state.profileId}`);

  const started = await api('POST', `/api/admin/virtual-learners/${state.profileId}/start-blackbox-session`, {});
  const session = dataOf(started.body);
  if (started.status !== 200 || !session?.id) throw new Error(`建会话失败 http=${started.status}`);
  state.sessionId = String(session.id);
  log(c.id, `会话 session=${state.sessionId}`);

  const auto = await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot/start`, {
    target: 'stage',
  }, 120_000);
  if (auto.status !== 200) throw new Error(`autopilot 启动失败 http=${auto.status} ${JSON.stringify(auto.body).slice(0, 200)}`);
  log(c.id, `autopilot target=stage ${JSON.stringify(dataOf(auto.body))}`);

  const began = Date.now();
  let lastStage = '';
  let lastAuto = '';
  let timedOut = false;
  while (Date.now() - began < timeoutMin * 60_000) {
    const detail = await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`);
    const autoStatus = await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot`);
    const s = dataOf(detail.body);
    const a = dataOf(autoStatus.body);
    const stage = String(s?.currentStage || '?');
    const autoState = String(a?.status || '?');
    if (`${stage}/${autoState}` !== `${lastStage}/${lastAuto}`) {
      log(c.id, `stage=${stage} status=${s?.status} autopilot=${autoState} elapsed=${Math.round((Date.now() - began) / 60000)}min`);
      lastStage = stage;
      lastAuto = autoState;
    }
    const terminal = ['completed', 'failed', 'abandoned'].includes(String(s?.status));
    if (terminal || stage !== 'goal' || ['completed', 'failed', 'stopped'].includes(autoState)) {
      state.endedBy = terminal ? 'session-terminal' : stage !== 'goal' ? 'stage-changed' : 'autopilot-ended';
      break;
    }
    await new Promise((r) => setTimeout(r, pollMs));
    if (Date.now() - began >= timeoutMin * 60_000) timedOut = true;
  }
  state.timedOut = timedOut;
  state.elapsedMs = Date.now() - began;
  if (timedOut) {
    await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot/stop`, {});
    log(c.id, '超时，已 stop autopilot');
  }

  // 阶段切换后等路径生成落库（最多 waitPathSec；0=不等）
  if (!timedOut && waitPathSec > 0) {
    const deadline = Date.now() + waitPathSec * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      const peek = await inspectGoal(c, state.sessionId);
      if (peek.metrics?.pathMilestones > 0) break;
      if (peek.metrics?.pathStatus && ['ready', 'failed', 'abandoned'].includes(String(peek.metrics.pathStatus))) break;
      log(c.id, `等待路径生成… pathStatus=${peek.metrics?.pathStatus ?? 'none'} milestones=${peek.metrics?.pathMilestones ?? 0}`);
    }
  } else if (!timedOut) {
    await new Promise((r) => setTimeout(r, 8_000));
  }
  const inspected = await inspectGoal(c, state.sessionId);
  const reasons = evaluate(c, inspected.metrics);
  const result = {
    id: c.id,
    learnerName: c.learnerName,
    goal: c.goal,
    profileId: state.profileId,
    sessionId: state.sessionId,
    elapsedMs: state.elapsedMs,
    timedOut: state.timedOut,
    endedBy: state.endedBy,
    pass: reasons.length === 0,
    reasons,
    metrics: inspected.metrics || null,
    path: inspected.conversation?.learningPathId
      ? { id: inspected.conversation.learningPathId, milestones: inspected.metrics?.pathMilestones ?? 0 }
      : null,
  };
  writeJson(statePath, state);
  writeJson(join(dir, 'result.json'), result);
  log(c.id, result.pass ? 'PASS' : `FAIL：${reasons.join('；')}`);
  if (inspected.metrics) {
    const m = inspected.metrics;
    log(c.id, `entry=${m.entryState} intent=${m.intentType} stage=${m.stage} turns=${m.turns} proposal=${m.keyStages}段/${m.objectiveScopeHours ?? '?'}h scope=${String(m.scopeSize || '').slice(0, 24)} path=${m.pathMilestones}段`);
  }
  return result;
}

(async () => {
  await login();
  log(null, `goal-direction check：${cases.length} 例 → ${runRoot}`);
  const results = [];
  for (const c of cases) {
    try {
      results.push(await runCase(c));
    } catch (error) {
      const failure = { id: c.id, pass: false, reasons: [String(error?.message || error)], metrics: null };
      writeJson(join(runRoot, c.id, 'result.json'), failure);
      log(c.id, `ERROR：${failure.reasons[0]}`);
      results.push(failure);
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const summary = { runAt: new Date().toISOString(), cases: results.length, passed, failed: results.length - passed, results };
  writeJson(join(runRoot, 'summary.json'), summary);
  console.log(`\n汇总：${passed}/${results.length} 通过 → ${join(runRoot, 'summary.json')}`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (error) => {
  console.error('FATAL', error?.message || error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
