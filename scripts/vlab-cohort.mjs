// 三人队列实验：3 个新建虚拟学习者 → 各自生成路径 → 学完全部任务 → 跨日衰减模拟 → 画像系统验证
// 用法: node scripts/vlab-cohort.mjs [--resume]
// 状态: logs/cohort-state.json（幂等，断点续跑）；日志: logs/cohort.log；报告: doc/COHORT_EXPERIMENT_REPORT.md
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:3001';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const STATE_PATH = path.join(ROOT, 'logs', 'cohort-state.json');
const LOG_PATH = path.join(ROOT, 'logs', 'cohort.log');
const REPORT_PATH = path.join(ROOT, 'doc', 'COHORT_EXPERIMENT_REPORT.md');
const REQUEST_TIMEOUT_MS = 240000;

// ---------- 三个学习者配置（不同摩擦预算 × 不同领域，形成对照） ----------
const LEARNERS = [
  { name: '报表助理阿成', learningGoal: '学会用 Python 自动处理每周报表，节省时间', frictionBudget: 'low', knowledgeLevel: 'beginner', notes: '低摩擦对照：配合度高、回复充分' },
  { name: '备考新人小夏', learningGoal: '备考初级会计职称，系统掌握会计基础', frictionBudget: 'normal', knowledgeLevel: 'beginner', notes: '正常摩擦对照：工作繁忙+碎片时间' },
  { name: '转岗设计师阿哲', learningGoal: '从零学 UI 设计基础，转岗设计师', frictionBudget: 'high', knowledgeLevel: 'beginner', notes: '高摩擦对照：拖延、自我怀疑、回复简短' },
];

// ---------- 工具 ----------
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
};

let cookie = '';
let state = null;

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { state = null; }
  }
  if (!state) {
    state = {
      startedAt: new Date().toISOString(),
      learners: LEARNERS.map((l) => ({
        name: l.name, frictionBudget: l.frictionBudget,
        profileId: null, sessionId: null, goalConversationId: null,
        learningPathId: null, phase: 'setup', // setup|goal|path|learn|decay|done
        taskCount: 0, completedTasks: 0, totalTasks: null,
        stallCount: 0, lastError: null, checkpoints: [],
      })),
      decayDone: false,
    };
    saveState();
  }
}

function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function api(method, urlPath, bodyObj, retries = 3) {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173', Connection: 'close' };
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(BASE + urlPath, {
        method,
        headers,
        body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
      if (res.ok) {
        // 业务级失败（HTTP 200 但 success=false）→ 抛错（可重试的按类别处理）
        if (json && json.success === false && json.error) {
          const msg = typeof json.error === 'string' ? json.error : (json.error?.message || JSON.stringify(json.error));
          lastErr = `BIZ: ${String(msg).slice(0, 200)}`;
          if (/学习会话已停止|学习已停止|没有绑定教学会话|BUSY|lease|租约/i.test(String(msg))) {
            await sleep(10000 * (i + 1));
            continue;
          }
          throw new Error(`api ${method} ${urlPath} biz failed: ${lastErr}`);
        }
        return json;
      }
      lastErr = `HTTP ${res.status}: ${(json?.error?.message || json?.error || JSON.stringify(json)).slice(0, 200)}`;
      if (res.status >= 500 || res.status === 429 || res.status === 409 || res.status === 408) {
        await sleep(15000 * (i + 1));
        continue;
      }
      return json; // 4xx 不重试（除 408/409）
    } catch (e) {
      lastErr = e.name === 'TimeoutError' ? 'timeout' : e.message;
      await sleep(10000 * (i + 1));
    }
  }
  throw new Error(`api ${method} ${urlPath} failed after retries: ${lastErr}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openDb() {
  return new DatabaseSync(DB_PATH, { readOnly: false });
}

// ---------- 登录 ----------
async function login() {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : ''; };
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  cookie = setCookie.split(';')[0];
  if (!cookie) throw new Error('login failed: no cookie');
  log('LOGIN OK');
}

// ---------- 阶段 1: 创建学习者（分步幂等） ----------
async function setupLearner(l) {
  const rec = state.learners.find((x) => x.name === l.name);
  if (rec.sessionId) return; // 已完成

  if (!rec.profileId) {
    const created = await api('POST', '/api/admin/virtual-learners', {
      name: l.name,
      learningGoal: l.learningGoal,
      knowledgeLevel: l.knowledgeLevel,
      notes: l.notes,
      tags: ['cohort-experiment', `friction-${l.frictionBudget}`],
    });
    const profileId = created.data?.id;
    if (!profileId) throw new Error(`create learner ${l.name} failed`);
    rec.profileId = profileId;
    rec.personaDone = false;
    saveState();
    log(`[${l.name}] profile created ${profileId}`);
  }

  // 增强人设（LLM）——draft-profile 只返回不写库，需 PUT 回写
  if (!rec.personaDone) {
    const persona = await api('POST', `/api/admin/virtual-learners/${rec.profileId}/draft-profile`, undefined, 3);
    const personaSeed = persona?.data?.generatedProfile || persona?.data?.personaSeed;
    if (personaSeed) {
      await api('PUT', `/api/admin/virtual-learners/${rec.profileId}`, { profile: personaSeed }, 3);
      rec.personaDone = true;
      saveState();
      log(`[${l.name}] persona generated & saved`);
    } else {
      rec.personaDone = true;
      saveState();
      log(`[${l.name}] draft-profile returned no personaSeed, using basic profile`);
    }
  }

  // 生成故事（LLM）——已有 storyPool 则跳过
  const detail = await api('GET', `/api/admin/virtual-learners/${rec.profileId}`, undefined, 2);
  const stories = detail.data?.profile?.storyPool || [];
  if (!stories.length) {
    await api('POST', `/api/admin/virtual-learners/${rec.profileId}/draft-stories`, undefined, 4);
    log(`[${l.name}] draft-stories done`);
  }

  // 启动会话
  const detail2 = await api('GET', `/api/admin/virtual-learners/${rec.profileId}`, undefined, 2);
  const stories2 = detail2.data?.profile?.storyPool || [];
  if (!stories2.length) throw new Error(`no story for ${l.name}`);
  const started = await api('POST', `/api/admin/virtual-learners/${rec.profileId}/start-session`, {
    storyId: stories2[0].id || stories2[0].storyId,
    frictionBudget: l.frictionBudget,
  });
  rec.sessionId = started.data?.id;
  if (!rec.sessionId) throw new Error(`start session failed for ${l.name}`);
  rec.phase = 'goal';
  saveState();
  log(`[${l.name}] session started ${rec.sessionId} story=${stories2[0].title}`);
}

// 失败自动重建会话（旧会话卡死时弃用，重新 start-session）
async function rebuildSession(l) {
  const rec = state.learners.find((x) => x.name === l.name);
  const detail = await api('GET', `/api/admin/virtual-learners/${rec.profileId}`, undefined, 2);
  const stories = detail.data?.profile?.storyPool || [];
  if (!stories.length) throw new Error(`no story for rebuild ${l.name}`);
  const started = await api('POST', `/api/admin/virtual-learners/${rec.profileId}/start-session`, {
    storyId: stories[0].id || stories[0].storyId,
    frictionBudget: l.frictionBudget,
  }, 3);
  rec.sessionId = started.data?.id;
  rec.goalConversationId = null;
  rec.learningPathId = null;
  rec.phase = 'goal';
  rec.stallCount = 0;
  saveState();
  log(`[${l.name}] session rebuilt -> ${rec.sessionId}`);
}

// ---------- 阶段 2: goal 对话（每次调用最多 3 步，主循环轮转并行） ----------
async function runGoal(l) {
  const rec = state.learners.find((x) => x.name === l.name);
  if (!['setup', 'goal'].includes(rec.phase)) return;
  rec.phase = 'goal';
  saveState();
  const maxStepsPerCall = 3;
  for (let i = 0; i < maxStepsPerCall; i++) {
    if (rec.goalConversationId) {
      const db = openDb();
      const row = db.prepare('SELECT stage FROM goal_conversations WHERE id=?').get(rec.goalConversationId);
      db.close();
      if (row && ['proposing', 'ready', 'completed'].includes(row.stage)) {
        log(`[${l.name}] goal converged (${row.stage})`);
        rec.phase = 'path';
        saveState();
        return;
      }
    }
    try {
      const r = await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/step`);
      const d = r?.data || {};
      if (!rec.goalConversationId && d.goalConversationId) rec.goalConversationId = d.goalConversationId;
      if (!rec.goalConversationId) {
        const db = openDb();
        const gc = db.prepare(`SELECT id FROM goal_conversations WHERE userId IN (SELECT userId FROM virtual_learner_profiles WHERE id=?) ORDER BY createdAt DESC LIMIT 1`)
          .get(rec.profileId);
        db.close();
        if (gc) rec.goalConversationId = gc.id;
      }
      saveState();
      log(`[${l.name}] goal step ok${d.currentStage ? ' stage=' + d.currentStage : ''}`);
      if (d.currentStage === 'completed') return;
      rec.stallCount = 0;
      await sleep(2000);
    } catch (e) {
      rec.stallCount++;
      rec.lastError = String(e.message).slice(0, 200);
      saveState();
      log(`[${l.name}] goal step FAILED: ${e.message}`);
      if (rec.stallCount >= 6) {
        log(`[${l.name}] too many goal failures, rebuilding session`);
        try { await rebuildSession(l); } catch (e2) { log(`[${l.name}] rebuild failed: ${e2.message}`); }
        return;
      }
      await sleep(20000);
    }
  }
}

// ---------- 阶段 3: path 生成（ready 即切 learn；advance 只调一次） ----------
async function runPath(l) {
  const rec = state.learners.find((x) => x.name === l.name);
  if (!['goal', 'path'].includes(rec.phase)) return;
  if (rec.phase === 'goal') { rec.phase = 'path'; saveState(); }

  // 检查是否已 ready：优先按 userId 查 learning_paths（virtual_sessions.learningPathId 可能未同步，
  // goal 收束后系统自动触发的 path 生成不会写回该列——2026-08-17 实测教训）
  const db = openDb();
  let pathId = null;
  const userId = getLearnerUserId(rec.profileId);
  const lp = db.prepare(`SELECT id FROM learning_paths WHERE userId=? AND status='active' ORDER BY updatedAt DESC LIMIT 1`).get(userId);
  pathId = lp?.id || null;
  if (!pathId) {
    const vs = db.prepare('SELECT learningPathId FROM virtual_sessions WHERE id=?').get(rec.sessionId);
    pathId = vs?.learningPathId || null;
  }
  let subtaskCount = 0;
  let milestoneCount = 0;
  if (pathId) {
    const m = db.prepare('SELECT COUNT(*) c FROM milestones WHERE learningPathId=?').get(pathId);
    milestoneCount = m?.c || 0;
    const s = db.prepare('SELECT COUNT(*) c FROM subtasks s2 JOIN milestones m2 ON m2.id=s2.milestoneId WHERE m2.learningPathId=?').get(pathId);
    subtaskCount = s?.c || 0;
    rec.learningPathId = pathId;
  }
  db.close();
  if (subtaskCount > 0) {
    rec.totalTasks = subtaskCount;
    rec.phase = 'learn';
    rec.stallCount = 0;
    saveState();
    // 关键修复：把 learningPathId 写回 virtual_sessions（start-learning 依赖该列；
    // goal 自动触发的 path 生成不会写回，实测 2026-08-17）
    const dbw = openDb();
    dbw.prepare('UPDATE virtual_sessions SET learningPathId=?, updatedAt=? WHERE id=?')
      .run(pathId, new Date().toISOString(), rec.sessionId);
    dbw.close();
    log(`[${l.name}] path ready: tasks=${subtaskCount} ms=${milestoneCount} -> learn (bound)`);
    return;
  }

  // 未 ready：advance 只调一次（用 advanceCalled 标志）
  if (!rec.advanceCalled) {
    try {
      await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/advance-path`);
      rec.advanceCalled = true;
      saveState();
      log(`[${l.name}] advance-path called`);
    } catch (e) {
      rec.stallCount++;
      rec.lastError = String(e.message).slice(0, 200);
      saveState();
      log(`[${l.name}] advance-path failed: ${e.message}`);
    }
  }
  log(`[${l.name}] waiting stageDesign... tasks=${subtaskCount}`);
  await sleep(15000);
}

// ---------- 阶段 4: 学完所有任务（每次调用最多 3 步，主循环轮转） ----------
async function runLearning(l) {
  const rec = state.learners.find((x) => x.name === l.name);
  if (!['path', 'learn'].includes(rec.phase)) return;
  if (rec.phase === 'path') { rec.phase = 'learn'; saveState(); }

  // 确保学习会话已启动（learningStarted 标志，重启脚本可续）
  if (!rec.learningStarted) {
    const db0 = openDb();
    const anyTask = db0.prepare('SELECT COUNT(*) c FROM subtasks s JOIN milestones m2 ON m2.id=s.milestoneId WHERE m2.learningPathId=?').get(rec.learningPathId);
    db0.close();
    if (!anyTask?.c) { log(`[${l.name}] no subtasks, skip learning`); rec.phase = 'learn-done'; saveState(); return; }
    try {
      const sl = await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/start-learning`, {}, 3);
      if (sl?.data?.teachingSessionId) {
        rec.learningStarted = true;
        saveState();
        log(`[${l.name}] learning started (${String(sl.data.teachingSessionId).slice(0, 20)})`);
      } else {
        log(`[${l.name}] start-learning returned without teachingSessionId, retrying with restart-learning`);
        await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/restart-learning`, {}, 3);
        rec.learningStarted = true;
        saveState();
        log(`[${l.name}] learning restarted`);
      }
      return; // 本调用先启动，下一步再跑
    } catch (e) {
      rec.stallCount++;
      rec.lastError = String(e.message).slice(0, 200);
      saveState();
      log(`[${l.name}] start-learning failed: ${e.message}`);
      // 会话未绑定路径 → 写回 learningPathId 后重试一次
      if (/学习路径不存在/.test(String(e.message))) {
        try {
          const dbw = openDb();
          dbw.prepare('UPDATE virtual_sessions SET learningPathId=?, updatedAt=? WHERE id=?')
            .run(rec.learningPathId, new Date().toISOString(), rec.sessionId);
          dbw.close();
          log(`[${l.name}] rebound learningPathId to session, retrying start-learning`);
          const sl2 = await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/start-learning`, {}, 2);
          if (sl2?.data?.teachingSessionId) {
            rec.learningStarted = true;
            saveState();
            log(`[${l.name}] learning started after rebind (${String(sl2.data.teachingSessionId).slice(0, 20)})`);
          }
        } catch (e2) {
          log(`[${l.name}] rebind+retry failed: ${e2.message}`);
        }
      }
      // 会话失败/停止 → 立即用 restart-learning 恢复（保留已生成的 path）
      if (/学习会话已停止|学习已停止|重新开始学习/i.test(String(e.message))) {
        try {
          const rl = await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/restart-learning`, {}, 3);
          if (rl?.data?.teachingSessionId || rl?.data?.success) {
            rec.learningStarted = true;
            saveState();
            log(`[${l.name}] learning restarted via restart-learning`);
          }
        } catch (e2) {
          log(`[${l.name}] restart-learning failed: ${e2.message}`);
          if (rec.stallCount >= 3) {
            log(`[${l.name}] rebuilding session`);
            try { await rebuildSession(l); rec.learningStarted = false; } catch (e3) { log(`[${l.name}] rebuild failed: ${e3.message}`); }
          }
        }
      } else if (rec.stallCount >= 3) {
        log(`[${l.name}] start-learning retries exhausted, rebuilding session`);
        try { await rebuildSession(l); rec.learningStarted = false; } catch (e2) { log(`[${l.name}] rebuild failed: ${e2.message}`); }
      }
      await sleep(30000);
      return;
    }
  }

  for (let i = 0; i < 3; i++) {
    try {
      const r = await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/teaching-step`);
      const d = r?.data || {};
      if (d.error) {
        const msg = String(d.error);
        log(`[${l.name}] step error: ${msg.slice(0, 150)}`);
        // 学习会话丢失 → 重新启动
        if (/没有绑定教学会话|学习已停止/.test(msg)) {
          rec.learningStarted = false;
          saveState();
        }
        await sleep(30000);
        continue;
      }
      if (d.isPathCompleted) {
        rec.phase = 'learn-done';
        saveState();
        log(`[${l.name}] ALL TASKS COMPLETED! total=${rec.totalTasks}`);
        return;
      }
      if (d.taskCompleted) {
        rec.completedTasks++;
        rec.checkpoints.push({
          at: new Date().toISOString(),
          task: d.milestoneProgress?.currentTask || null,
          milestone: d.milestoneProgress?.currentMilestone ?? null,
          totalMilestones: d.milestoneProgress?.totalMilestones ?? null,
        });
        const snap = await snapshotLearner(l, `task-${rec.completedTasks}`);
        rec.checkpoints[rec.checkpoints.length - 1].memoryTraces = snap.memoryTraces;
        rec.checkpoints[rec.checkpoints.length - 1].evidence = snap.evidence;
        saveState();
        log(`[${l.name}] task ${rec.completedTasks}/${rec.totalTasks} completed (m${d.milestoneProgress?.currentMilestone}/${d.milestoneProgress?.totalMilestones})`);
      }
      rec.stallCount = 0;
      await sleep(1500);
    } catch (e) {
      rec.stallCount++;
      rec.lastError = String(e.message).slice(0, 200);
      saveState();
      log(`[${l.name}] teaching step FAILED: ${e.message}`);
      // 学习会话丢失/停止 → 重置 learningStarted，下次进入 start-learning/restart-learning 恢复（保留当前任务）
      if (/学习已停止|没有绑定教学会话|学习会话已停止/.test(String(e.message))) {
        rec.learningStarted = false;
        saveState();
      }
      if (rec.stallCount >= 6) {
        log(`[${l.name}] too many teaching failures, rebuilding session (restart from goal)`);
        try { await rebuildSession(l); rec.learningStarted = false; } catch (e2) { log(`[${l.name}] rebuild failed: ${e2.message}`); }
        return;
      }
      await sleep(20000);
    }
  }
}

// 快照：memory_traces + learner_evidence + snapshot 摘要
function getLearnerUserId(profileId) {
  const db = openDb();
  const u = db.prepare('SELECT userId FROM virtual_learner_profiles WHERE id=?').get(profileId);
  db.close();
  return u?.userId || null;
}

async function snapshotLearner(l, label) {
  const rec = state.learners.find((x) => x.name === l.name);
  const userId = getLearnerUserId(rec.profileId);
  const db = openDb();
  const traces = db.prepare('SELECT conceptKey, label, masteryScore, stability, lastSeenAt, extractionCount, decayFactor, intervalFactor FROM memory_traces WHERE userId=? ORDER BY updatedAt DESC').all(userId);
  const ev = db.prepare('SELECT evidenceKey, COUNT(*) c FROM learner_evidence WHERE userId=? GROUP BY evidenceKey').all(userId);
  db.close();
  let snapshot = null;
  try {
    const s = await api('GET', `/api/admin/learner-models/${userId}`, undefined, 2);
    snapshot = s?.data?.snapshot ? {
      freshness: s.data.snapshot.freshness,
      dynamicState: s.data.snapshot.dynamicState,
      globalSignals: s.data.snapshot.knowledgeMemory?.globalSignals,
      teachingHints: s.data.snapshot.teachingHints,
    } : null;
  } catch { /* snapshot optional */ }
  const out = {
    label,
    at: new Date().toISOString(),
    traceCount: traces.length,
    mastered: traces.filter((t) => t.stability === 'stable').length,
    fragile: traces.filter((t) => t.stability === 'fragile').length,
    memoryTraces: traces,
    evidence: ev,
    snapshot,
  };
  fs.mkdirSync(path.join(ROOT, 'logs', 'cohort-snapshots'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'logs', 'cohort-snapshots', `${l.name}-${label}.json`), JSON.stringify(out, null, 2), 'utf8');
  return out;
}

// ---------- 阶段 5: 跨日衰减模拟（每个学习者独立完成一次） ----------
async function runDecay(l) {
  const rec = state.learners.find((x) => x.name === l.name);
  if (rec.phase !== 'learn-done') return;
  rec.phase = 'decay';
  saveState();
  const userId = getLearnerUserId(rec.profileId);
  if (!userId) { log(`[${l.name}] no userId, skip decay`); return; }

  log(`[${l.name}] === 跨日衰减模拟开始 ===`);
  await snapshotLearner(l, 'decay-base');

  const offsets = ['-3 days', '-4 days', '-7 days']; // 累计 3/7/14 天
  let cumDays = 0;
  for (const off of offsets) {
    cumDays += off.startsWith('-') ? Number(off.split(' ')[0].slice(1)) : 0;
    const db = openDb();
    db.prepare(`UPDATE memory_traces SET lastSeenAt = strftime('%Y-%m-%dT%H:%M:%fZ', lastSeenAt, ?) WHERE userId = ?`).run(off, userId);
    db.close();
    log(`[${l.name}] 回拨 ${cumDays} 天`);
    try {
      await api('POST', `/api/admin/learner-models/${userId}/recompute`, {}, 3);
    } catch (e) { log(`[${l.name}] recompute failed: ${e.message}`); }
    await snapshotLearner(l, `decay-${cumDays}d`);
    await sleep(3000);
  }

  // 开课验证旧知唤醒：到期点是否注入看板
  log(`[${l.name}] 开课验证旧知唤醒...`);
  try {
    await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/start-learning`, {}, 3);
    const r1 = await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/teaching-step`, {}, 3);
    const d1 = r1?.data || {};
    await snapshotLearner(l, 'decay-reopen');
    log(`[${l.name}] 复课后第1轮 teacher: ${String(d1.aiResponse || '').slice(0, 260)}`);
    const r2 = await api('POST', `/api/admin/virtual-learners/sessions/${rec.sessionId}/teaching-step`, {}, 3);
    const d2 = r2?.data || {};
    log(`[${l.name}] 复课后第2轮 teacher: ${String(d2.aiResponse || '').slice(0, 260)}`);
  } catch (e) {
    log(`[${l.name}] reopen verification failed: ${e.message}`);
  }
  rec.phase = 'done';
  saveState();
  log(`[${l.name}] === 跨日衰减模拟完成 ===`);
}

// ---------- 主循环 ----------
async function main() {
  loadState();
  await login();
  log('========== COHORT EXPERIMENT START ==========');

  // 每轮：对每个学习者推进一个阶段步骤
  for (let cycle = 0; cycle < 10000; cycle++) {
    let allDone = true;
    for (const l of LEARNERS) {
      const rec = state.learners.find((x) => x.name === l.name);
      if (rec.phase === 'done') continue;
      allDone = false;
      try {
        if (rec.phase === 'setup') await setupLearner(l);
        // 防御：sessionId 已建但 phase 仍为 setup（旧版本状态残留）→ 直接转 goal
        if (rec.phase === 'setup' && rec.sessionId) { rec.phase = 'goal'; saveState(); }
        else if (rec.phase === 'goal') await runGoal(l);
        else if (rec.phase === 'path') await runPath(l);
        else if (rec.phase === 'learn') await runLearning(l);
        else if (rec.phase === 'learn-done') await runDecay(l);
        else if (rec.phase === 'decay') { rec.phase = 'done'; saveState(); }
      } catch (e) {
        rec.stallCount++;
        rec.lastError = String(e.message).slice(0, 200);
        saveState();
        log(`[${l.name}] phase ${rec.phase} ERROR: ${e.message}`);
        await sleep(60000);
      }
    }
    if (allDone) break;
    await sleep(10000);
  }

  // 全部完成（或超时）后生成报告
  log('========== COHORT EXPERIMENT END ==========');
  generateReport();
  process.exit(0);
}

function generateReport() {
  const lines = [];
  lines.push('# 三人队列实验报告（虚拟学习者全链路画像验证）');
  lines.push('');
  lines.push(`> 实验时间：${state.startedAt} ～ ${new Date().toISOString()}`);
  lines.push('> 方法：3 个新建虚拟学习者（frictionBudget: low/normal/high）× 各自生成学习路径 × 学完全部任务 × 回拨 lastSeenAt 模拟 3/7/14 天衰减 × 复课验证旧知唤醒');
  lines.push('');
  for (const rec of state.learners) {
    const l = LEARNERS.find((x) => x.name === rec.name);
    lines.push(`## ${rec.name}（friction=${rec.frictionBudget}）`);
    lines.push('');
    lines.push(`- phase: ${rec.phase}`);
    lines.push(`- 路径: ${rec.learningPathId || '未生成'}`);
    lines.push(`- 任务: ${rec.completedTasks}/${rec.totalTasks ?? '?'}`);
    lines.push(`- lastError: ${rec.lastError || '无'}`);
    if (rec.checkpoints.length) {
      lines.push('');
      lines.push('### 任务完成时间线');
      for (const c of rec.checkpoints) {
        lines.push(`- ${c.at} | m${c.milestone}/${c.totalMilestones} | ${c.task || ''}`);
      }
    }
    lines.push('');
  }
  // 快照文件索引
  const snapDir = path.join(ROOT, 'logs', 'cohort-snapshots');
  if (fs.existsSync(snapDir)) {
    const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json'));
    lines.push('## 快照数据');
    lines.push('');
    lines.push('详细快照（memory_traces / learner_evidence / snapshot）位于 `logs/cohort-snapshots/`：');
    for (const f of files) lines.push(`- ${f}`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`report written to ${REPORT_PATH}`);
}

main().catch((e) => {
  log('FATAL: ' + (e.stack || e.message));
  process.exit(1);
});
