#!/usr/bin/env node
/**
 * 同路径对照实验搭建（2026-10-13 用户令：「做两个虚拟学习者，给他们不同的身份，但是路径都是这个」）
 *
 * 目的：把真人路径 lp_1791817016486_mot0ov1（教育心理学判断框架）**复刻**给两个身份迥异的
 * 虚拟学习者，让同一条路径落在「零基础务实产品经理」与「教育学硕士教研员」身上，今晚各自上课，
 * 观察同一套课对不同先验知识/性格的学习者是否成立。
 *
 * 做三件事（幂等，按名字复用已存在的 VL）：
 *   1. 建两个 VL（不同身份：先验知识、性格、动机、故事都不同）
 *   2. 复刻路径：复制 learning_paths + milestones + subtasks 到该 VL 名下（新 id，状态重置为未学；
 *      aiPromptTemplate 内按 subtask id 键控的 misconceptionHints.byTask 做 id 重映射）
 *   3. 建会话并把 session.learningPathId 绑到复刻路径（绕过 goal→path 生成，直接用这条路径上课）
 *
 * 用法：
 *   node scripts/vlab-eval/ab-pair-setup.mjs --apply            # 落库（默认 dry-run 只打印计划）
 *   node scripts/vlab-eval/ab-pair-setup.mjs --learn            # 对 manifest 里的会话起课（start-learning）
 *   node scripts/vlab-eval/ab-pair-setup.mjs --learn --auto     # 再跑 auto-learning 完成首阶段
 *   node scripts/vlab-eval/ab-pair-setup.mjs --grind            # 逐课推进（每课 teaching-step 到完课 + finalize）
 *   可选：--base=http://127.0.0.1:3011 --source=lp_xxx
 *   --case=<json>：换案例（身份/源路径/产物目录外置），见 CASE 定义处的形状说明
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { adminLoginOnce, getAdminCookie } from './admin-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d); };

const BASE = arg('base', 'http://127.0.0.1:3011');
/** 案例文件（--case=<json>）：把「两个身份 + 源路径 + 产物目录」外置，同一套机制可用于任何一条课。
 *  case.json 形状：{ runDir: '20261014/ab-pair-guide', source: 'lp_xxx', identities: [<同下方 IDENTITIES 结构>] } */
const CASE = (() => {
  const p = arg('case', '');
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  return { ...JSON.parse(fs.readFileSync(abs, 'utf8')), _file: abs };
})();
const SOURCE = arg('source', CASE?.source || 'lp_1791817016486_mot0ov1');
const APPLY = arg('apply', false) === true;
const LEARN = arg('learn', false) === true;
const AUTO = arg('auto', false) === true;
const DB_PATH = arg('db', path.join(ROOT, 'backend/prisma/dev.db'));
const OUT_DIR = CASE?.runDir ? path.join(ROOT, 'doc/local/runs', CASE.runDir) : path.join(ROOT, 'doc/local/runs/20261013/ab-pair');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
let cookie = '';

async function api(method, urlPath, body, timeoutMs = 60000) {
  const url = new URL(BASE + urlPath);
  const payload = body !== undefined ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json', Origin: 'http://localhost:5173',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(text); } catch { /* 保留原文 */ }
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode} ${text.slice(0, 300)}`));
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------------- 两个身份（同路径、不同先验/性格/动机） ----------------
   --case=<json> 时改用案例文件里的 identities（默认档保持 2026-10-13 教育心理学那对不变） */

const IDENTITIES = CASE?.identities || [
  {
    name: '林然',
    tags: ['ab-pair', 'same-path', 'edu-psych', 'novice-pm'],
    knowledgeLevel: 'beginner',
    learningGoal: '学会用教育心理学判断平台的学习建议与能力评估是否有科学依据',
    knownConcepts: ['产品需求设计', '数据指标', 'A/B 测试'],
    struggleConcepts: ['教育心理学原理', '学习理论', '信度与效度'],
    profile: {
      nameHint: '林然',
      age: 35,
      occupation: '教育 SaaS 产品经理',
      education: '计算机本科',
      background: '做教育产品 6 年，懂技术和数据，心理学零基础；平台下个月给学校试点，教研老师开始问专业问题。',
      knownConcepts: ['产品需求设计', '数据指标', 'A/B 测试'],
      struggleConcepts: ['教育心理学原理', '学习理论', '信度与效度'],
      learningStyle: 'practice',
      motivationType: 'necessity',
      availableTime: 'moderate',
      techComfort: 'high',
      priorAttempts: '看过一些科普文章和公众号，记不住也用不上，说不清到底哪套说法对。',
      corePersonality: '务实、直接、时间紧；喜欢要清单和结论，对空话没耐心。',
      personalityDrivers: ['让产品经得起教研质询', '不想在专业问题上被客户问倒'],
      communicationStyle: '说话直接，爱追问「这个有依据吗」「所以具体怎么做」。',
      cognitiveLoadTolerance: '中，反感空话和大段背景介绍',
      metacognitiveProfile: '知道自己在心理学上是外行，但分不清「听起来有道理」和「有科学依据」。',
      behaviorBoundaries: ['不接受空泛励志', '不接受没有结论的长篇'],
      behavioralProfileSummary: '一个务实、要结论、会用工程思维追问依据的产品经理，心理学零基础。',
      personalityTraits: { verbosity: 'normal', enthusiasm: 'medium', confusionStyle: 'direct', patience: 'low', questionStyle: 'probing', emotionalRange: 'moderate' },
      storyPool: [{
        id: 'story_linran-eval',
        title: '被教研问倒的评审会',
        sourceType: 'work',
        storyOutline: '平台下月进校试点，教研老师看完演示后问「你们推荐的学习建议，依据是什么」。林然当场只答出「模型综合了学生数据」，对方追问「哪套教育心理学理论支持这个建议」，他答不上来，会后被要求两周内补一份「建议与评估的科学依据」说明。',
        triggerEvent: '试点前的教研评审会上被追问建议的科学依据。',
        visibleOpening: '我们平台要进学校试点了，教研老师问我「你们推荐的学习建议有什么科学依据」，我当场答不上来。我得赶紧把教育心理学这块补上，起码能判断我们做的东西站不站得住。',
        hiddenDetails: ['他分不清「数据上有效」和「理论上成立」', '把「用户调研满意度」当成科学性证据'],
        misdiagnosis: '以为补一些术语就能应付质询。',
        pressurePoints: ['被专业人士当面质疑', '时间紧'],
        behaviorHooks: ['急着要能直接用在评审上的结论和清单'],
        problemKnowledge: { domainFamiliarity: 'low', knownConcepts: ['产品设计', '数据指标'], struggleConcepts: ['学习理论', '信度效度'], selfAssessment: '自认「外行，但逻辑能跟上」。', hiddenGaps: ['不知道教育心理学的判断框架长什么样'] },
        goalSeed: { domain: '教育心理学', goalType: 'skill', surfaceGoal: '能判断平台的学习建议与评估是否有科学依据', realProblem: '缺一套把教育心理学原理与平台输出对上的判断框架', motivation: 'necessity', urgencyHint: '两周内要出评审说明', constraints: ['时间紧', '要能直接用在评审'] },
      }],
    },
  },
  {
    name: '周雅',
    tags: ['ab-pair', 'same-path', 'edu-psych', 'expert-auditor'],
    knowledgeLevel: 'intermediate',
    learningGoal: '判断 AI 教辅的建议与评估能否进课堂',
    knownConcepts: ['皮亚杰认知发展', '维果茨基最近发展区', '布卢姆分类学', '形成性评估'],
    struggleConcepts: ['信度与效度', '能力推断', '动机理论', 'AI 建议的科学性审查'],
    profile: {
      nameHint: '周雅',
      age: 29,
      occupation: '区教研室教研员（教育学硕士）',
      education: '教育学硕士（课程与教学论）',
      background: '教育心理学教材读过、考过，带过毕业班；现在负责区里教育信息化的教研把关，学校在用一款 AI 教辅。',
      knownConcepts: ['皮亚杰认知发展', '维果茨基最近发展区', '布卢姆分类学', '形成性评估'],
      struggleConcepts: ['信度与效度', '能力推断', '动机理论', 'AI 建议的科学性审查'],
      learningStyle: 'reading',
      motivationType: 'necessity',
      availableTime: 'moderate',
      techComfort: 'medium',
      priorAttempts: '看过产品给的方案说明，觉得「说法都对，但落不到具体判断上」。',
      corePersonality: '学术、严谨、要求深度；会当场指出「这里讲浅了」「这个术语用错了」；不轻易认可。',
      personalityDrivers: ['守住进课堂的门槛', '不让学生被不靠谱的评估误导'],
      communicationStyle: '完整句、带追问；喜欢要证据、要出处，不满足于「大概是这样」。',
      cognitiveLoadTolerance: '高，但讨厌重复和注水',
      metacognitiveProfile: '清楚自己的经典理论底子，短板是「理论到 AI 产品输出」这一跳。',
      behaviorBoundaries: ['不接受术语误用', '不接受把相关性说成因果'],
      behavioralProfileSummary: '一个理论底子扎实、要求证据、会把课程讲浅的地方当场挑出来的教研员。',
      personalityTraits: { verbosity: 'verbose', enthusiasm: 'medium', confusionStyle: 'articulated', patience: 'high', questionStyle: 'probing', emotionalRange: 'moderate' },
      storyPool: [{
        id: 'story_zhouya-audit',
        title: '同一份作业两个分数',
        sourceType: 'work',
        storyOutline: '学校试用的 AI 教辅，同一份作业前后两次给出的「能力评估」差了整整一个档，学生和家长都来问。周雅被要求出一份评估意见：这东西到底能不能进课堂。她翻了产品的说明，理论名词都对，但说不清它的结论是怎么推出来的。',
        triggerEvent: '同一份作业两次能力评估结果矛盾，家长质疑。',
        visibleOpening: '我们学校在试用的 AI 教辅，同一份作业前后给的能力评估差了一档，家长都来问了。我得出一份能不能用的意见——产品说明里理论名词都对，可我判断不了它的结论到底站不站得住，尤其是评估这块。',
        hiddenDetails: ['她能背出经典理论，但没系统想过「能力推断」要满足什么条件', '把「理论名词出现」当成科学性'],
        misdiagnosis: '以为问题出在产品实现，不在评估逻辑本身。',
        pressurePoints: ['被家长质疑', '要签字背书'],
        behaviorHooks: ['要求给出可核验的判断依据，不接受含糊表述'],
        problemKnowledge: { domainFamiliarity: 'high', knownConcepts: ['皮亚杰', '维果茨基', '布卢姆', '形成性评估'], struggleConcepts: ['信度效度', '能力推断'], selfAssessment: '自认「理论有底子，缺审查视角」。', hiddenGaps: ['不清楚从理论到 AI 输出之间的判断链怎么搭'] },
        goalSeed: { domain: '教育心理学', goalType: 'skill', surfaceGoal: '判断 AI 教辅的建议与评估能否进课堂', realProblem: '熟悉经典理论，但缺把理论落到 AI 产品输出上的审查视角', motivation: 'necessity', urgencyHint: '下月要出评估意见', constraints: ['要签字负责', '要求证据'] },
      }],
    },
  },
];

/* ---------------- 路径复刻（DB 直写） ---------------- */

const rand = () => Math.random().toString(36).substring(2, 9);

function insertRow(db, table, row) {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  db.prepare(sql).run(...cols.map((c) => row[c]));
}

function clonePath(db, sourceId, targetUserId, targetName) {
  const src = db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(sourceId);
  if (!src) throw new Error(`源路径不存在: ${sourceId}`);
  const srcMs = db.prepare('SELECT * FROM milestones WHERE learningPathId = ? ORDER BY stageNumber').all(sourceId);
  if (!srcMs.length) throw new Error('源路径没有里程碑');

  const now = Date.now();
  const newPathId = `lp_${now}_${rand()}`;
  const taskIdMap = new Map();

  // 先建 id 映射（misconceptionHints.byTask 键控于 subtask id，需重映射）
  const msIdMap = new Map();
  for (const m of srcMs) {
    msIdMap.set(m.id, `ms_${now}_${rand()}_${m.stageNumber}`);
    const tasks = db.prepare('SELECT id FROM subtasks WHERE milestoneId = ?').all(m.id);
    for (const t of tasks) taskIdMap.set(t.id, `st_${now}_${rand()}_${m.stageNumber}_${t.id.slice(-1)}`);
  }

  // 模板：重映射 byTask 键（其余键控=标题/阶段号，随行复制即可）
  let template = src.aiPromptTemplate;
  try {
    const t = JSON.parse(template);
    if (t.misconceptionHints?.byTask) {
      const remapped = {};
      for (const [oldId, val] of Object.entries(t.misconceptionHints.byTask)) {
        remapped[taskIdMap.get(oldId) || oldId] = val;
      }
      t.misconceptionHints.byTask = remapped;
    }
    t._clonedFrom = sourceId;
    t._clonedAt = new Date().toISOString();
    template = JSON.stringify(t);
  } catch { /* 模板非 JSON 时原样带过 */ }

  insertRow(db, 'learning_paths', {
    ...src,
    id: newPathId,
    userId: targetUserId,
    status: 'active',
    completedMilestones: 0,
    aiPromptTemplate: template,
    createdAt: now,
    updatedAt: now,
    replanMode: null,
    replanReason: null,
    replanTriggerSource: null,
    sourcePathId: sourceId,
    activeGenerationRunId: null,
  });

  for (const m of srcMs) {
    const newMsId = msIdMap.get(m.id);
    insertRow(db, 'milestones', {
      ...m,
      id: newMsId,
      learningPathId: newPathId,
      status: m.stageNumber === 1 ? 'active' : 'locked',
      unlockedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    for (const t of db.prepare('SELECT * FROM subtasks WHERE milestoneId = ?').all(m.id)) {
      insertRow(db, 'subtasks', {
        ...t,
        id: taskIdMap.get(t.id),
        milestoneId: newMsId,
        userId: targetUserId,
        status: 'todo',
        completedAt: null,
        rating: null,
        feedback: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  const taskCount = db.prepare(
    'SELECT COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId = ?)'
  ).get(newPathId).c;
  log(`复刻路径 ${newPathId} → ${targetName}（${srcMs.length} 阶段 / ${taskCount} 任务）`);
  return newPathId;
}

/** 克隆后补跑概念图物化（走平台服务 backfill→materializePathGraph）。克隆直写 DB 会漏掉这一步，
 *  copy 了 aiPromptTemplate.kcGraph 却没写 concept_edges → 学习者图谱 0 关系、全是散点（2026-10-13 复现）。 */
function materializeClonedPaths(pathIds) {
  const ids = pathIds.filter(Boolean);
  if (!ids.length) return;
  const r = spawnSync(process.execPath, [
    'node_modules/ts-node/dist/bin.js', '--transpile-only',
    'src/scripts/backfill-concept-graph.ts', `--path-ids=${ids.join(',')}`,
  ], { cwd: path.join(ROOT, 'backend'), stdio: 'inherit' });
  if (r.status !== 0) log(`[warn] 概念图物化失败（exit ${r.status}）：克隆路径无关系边，图谱显示为散点`);
}

/* ---------------- 主流程 ---------------- */

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // dev server 常驻持库：直写（复刻路径插入 / 会话绑定）会撞 "database is locked"（errcode 5）。
  // busy_timeout 是仓里跑批持锁的既定配方（见 project-perf-audit 记忆：迁移建索引同套路）。
  db.exec('PRAGMA busy_timeout = 15000');
  const source = db.prepare('SELECT id,title,userId FROM learning_paths WHERE id = ?').get(SOURCE);
  if (!source) throw new Error(`源路径不存在：${SOURCE}`);

  if (arg('grind', false)) return runGrind(db);
  if (LEARN) return runLearn(db);

  cookie = await getAdminCookie(BASE, envGet) || await adminLoginOnce(BASE, envGet);
  if (!cookie) throw new Error('admin 登录失败');

  const list = await api('GET', '/api/admin/virtual-learners?page=1&pageSize=200');
  const existing = (list?.data?.profiles || []);
  const manifest = { source: SOURCE, sourceTitle: source.title, base: BASE, createdAt: new Date().toISOString(), pair: [] };
  const clonedPathIds = [];

  for (const ident of IDENTITIES) {
    let vl = existing.find((p) => p.name === ident.name || p.profile?.nameHint === ident.name);
    if (!vl) {
      if (!APPLY) { log(`[dry-run] 将创建 VL「${ident.name}」（${ident.profile.occupation}）`); continue; }
      const created = await api('POST', '/api/admin/virtual-learners', {
        name: ident.name, profile: ident.profile, learningGoal: ident.learningGoal,
        knowledgeLevel: ident.knowledgeLevel, knownConcepts: ident.knownConcepts,
        struggleConcepts: ident.struggleConcepts, tags: ident.tags,
        personalityTraits: ident.profile.personalityTraits,
        notes: `AB 对照实验（同路径 ${SOURCE}）`,
      });
      // 响应形状：{ success, data: { ...virtualProfileRow(id/userId), profile: {...} } }
      vl = created?.data;
      log(`已创建 VL「${ident.name}」id=${vl?.id}`);
    } else {
      log(`复用已存在 VL「${ident.name}」id=${vl.id}`);
    }
    if (!vl?.id || !vl?.userId) throw new Error(`VL「${ident.name}」创建/读取失败`);

    let pathId = null;
    const prior = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
    const priorEntry = prior?.pair?.find((p) => p.name === ident.name);
    if (priorEntry?.pathId && db.prepare('SELECT id FROM learning_paths WHERE id = ?').get(priorEntry.pathId)) {
      pathId = priorEntry.pathId;
      log(`复用已复刻路径 ${pathId}（${ident.name}）`);
    } else if (APPLY) {
      pathId = clonePath(db, SOURCE, vl.userId, ident.name);
      clonedPathIds.push(pathId);
    } else {
      log(`[dry-run] 将为「${ident.name}」复刻路径 ${SOURCE}`);
      continue;
    }

    // 建会话并绑定复刻路径
    let sessionId = priorEntry?.sessionId || null;
    if (!sessionId && APPLY) {
      const sess = await api('POST', `/api/admin/virtual-learners/${vl.id}/start-session`, { storyIndex: 0 });
      sessionId = sess?.data?.id || sess?.data?.session?.id;
      if (!sessionId) throw new Error(`「${ident.name}」start-session 未返回会话`);
      log(`已建会话 ${sessionId}（${ident.name}）`);
    }
    if (sessionId && APPLY) {
      db.prepare('UPDATE virtual_sessions SET learningPathId = ?, currentStage = ?, updatedAt = ? WHERE id = ?')
        .run(pathId, 'learn', Date.now(), sessionId);
      log(`会话 ${sessionId} 已绑定复刻路径 ${pathId}，currentStage=learn`);
    }
    manifest.pair.push({
      name: ident.name, identity: ident.profile.occupation, level: ident.knowledgeLevel,
      vlId: vl.id, userId: vl.userId, pathId, sessionId,
    });
  }

  materializeClonedPaths(clonedPathIds);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
  db.close();
}

/* ---------------- 起课 ---------------- */

async function runLearn(db) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  cookie = await getAdminCookie(BASE, envGet) || await adminLoginOnce(BASE, envGet);
  const RETRIES = Number(arg('retries', 8));
  const RETRY_DELAY_MS = Number(arg('retry-delay-ms', 120000));
  const results = [];

  const sessionStatus = async (sessionId) => {
    const sp = await api('GET', `/api/admin/virtual-learners/sessions/${sessionId}`, undefined, 30000).catch(() => null);
    const sess = sp?.data?.session || sp?.data || {};
    return String(sess.status || '');
  };
  const completedCount = (pathId) => db.prepare(
    `SELECT COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId = ?) AND status = 'completed'`
  ).get(pathId).c;

  await Promise.all(manifest.pair.map(async (p) => {
    if (!p.sessionId) return;
    const logFile = path.join(OUT_DIR, `learn-${p.name}.log`);
    const write = (m) => fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${m}\n`);
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      try {
        // 池级抖动会把会话终态化（404 model_not_found 不可重试）——先复活再续跑
        const st = await sessionStatus(p.sessionId);
        if (['failed', 'abandoned'].includes(st)) {
          write(`第 ${attempt} 轮：会话 ${st} → restart-learning 复活`);
          await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/restart-learning`, {}, 300000);
        }
        try {
          const started = await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/start-learning`, {}, 600000);
          write(`第 ${attempt} 轮 start-learning: success=${started?.success}`);
        } catch (startError) {
          write(`第 ${attempt} 轮 start-learning 报错（继续 auto）：${startError instanceof Error ? startError.message : String(startError)}`);
        }
        if (!AUTO) { results.push({ name: p.name, ok: true, attempt }); return; }
        write(`第 ${attempt} 轮 auto-learning（maxMilestones=1, maxTurns=40）…`);
        const auto = await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/auto-learning`, { maxMilestones: 1, maxTurns: 40 }, 3600000);
        const done = completedCount(p.pathId);
        write(`第 ${attempt} 轮 auto-learning: success=${auto?.success}｜已完成任务 ${done}/29`);
        if (auto?.success || done > 0) { results.push({ name: p.name, ok: true, attempt, completedTasks: done }); return; }
      } catch (error) {
        write(`第 ${attempt} 轮失败：${error instanceof Error ? error.message : String(error)}`);
      }
      if (attempt < RETRIES) {
        write(`等待 ${Math.round(RETRY_DELAY_MS / 1000)}s 后重试（等池轮换到可用账号组）…`);
        await sleep(RETRY_DELAY_MS);
      }
    }
    results.push({ name: p.name, ok: false, completedTasks: completedCount(p.pathId) });
  }));
  console.log(JSON.stringify({ learn: results }, null, 2));
  db.close();
}

/**
 * 磨课模式（--grind）：按驱动权威配方逐课推进（run-vl-batch.mjs learn 段同源）：
 *   每课：start-learning → 逐步 teaching-step 直到完课信号 → 补一步 finalize（endSession→wrapup→
 *   completeTask，少走这步=课永不落库）→ wrapup 落库。会话被池抖动终态化则 restart-learning 复活续跑。
 * 停止：完成 --until-tasks 个任务 或 到 --minutes 时限。
 */
async function runGrind(db) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  cookie = await getAdminCookie(BASE, envGet) || await adminLoginOnce(BASE, envGet);
  const TARGET = Number(arg('until-tasks', 5));
  const MINUTES = Number(arg('minutes', 420));
  const deadline = Date.now() + MINUTES * 60 * 1000;
  const completedCount = (pathId) => db.prepare(
    `SELECT COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId = ?) AND status = 'completed'`
  ).get(pathId).c;
  const sessionInfo = async (sessionId) => {
    const sp = await api('GET', `/api/admin/virtual-learners/sessions/${sessionId}`, undefined, 30000).catch(() => null);
    return (sp?.data?.session || sp?.data || {});
  };

  await Promise.all(manifest.pair.map(async (p) => {
    if (!p.sessionId) return;
    const logFile = path.join(OUT_DIR, `grind-${p.name}.log`);
    const write = (m) => fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${m}\n`);
    write(`磨课开始：目标 ${TARGET} 任务 / 时限 ${MINUTES} 分钟`);
    while (Date.now() < deadline && completedCount(p.pathId) < TARGET) {
      const doneBefore = completedCount(p.pathId);
      try {
        let info = await sessionInfo(p.sessionId);
        if (['failed', 'abandoned'].includes(String(info.status || ''))) {
          write(`会话 ${info.status} → restart-learning 复活（已完成 ${doneBefore}）`);
          await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/restart-learning`, {}, 300000);
          await sleep(5000);
        }
        await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/start-learning`, {}, 600000);
        const baseline = Number(info.completedTasks || 0);
        // 本课循环：逐步 teaching-step（每课 75 分钟上限）
        const lessonDeadline = Date.now() + 75 * 60 * 1000;
        let turns = 0, restarts = 0, stepRetries = 0, completed = false;
        let upstreamPauses = 0;
        /**
         * 收束对峙计数（2026-10-14 实训 #46）：「老师已收口、学员自评说没完」的对峙轮数。
         * 平台只熔断镜像方向（学员连说完成而老师不给信号 → learnerDoneStreak，见 learn-phase），
         * 本方向恒 0；不加反向熔断（那等于拿老师的话强制结课，会造假完成），只把对峙显形到日志，
         * 便于事后判读「这一课是不是又在门口十八相送」。
         */
        let closureStandoff = 0;
        let maxStandoff = 0;
        let lastProbeAt = Date.now();
        while (Date.now() < lessonDeadline) {
          // 每 90s 探一次会话本体：会话被池抖动打成 failed 后 teaching-step 会**快速空转**
          // （2026-10-13 夜跑实锤：一晚 4 个窗口各 1700-2200「轮」，多数是死会话空耗 75 分钟）。
          // 死会话必须立刻退出换轮复活，而不是把窗口烧完。
          if (Date.now() - lastProbeAt > 90000) {
            lastProbeAt = Date.now();
            const probe = await sessionInfo(p.sessionId);
            if (['failed', 'abandoned'].includes(String(probe.status || ''))) {
              write(`课中探测到会话 ${probe.status}（第 ${turns} 步）→ 提前退出，复活后换轮`);
              break;
            }
            // 健康课 20-60 步内完课；步数高且无完课信号 = 停滞空转（消息不涨），提前换轮
            if (turns >= 200) {
              write(`本课 ${turns} 步无完课信号（判定停滞）→ 提前换轮`);
              break;
            }
          }
          let r;
          try {
            r = await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/teaching-step`, {}, 300000);
          } catch (error) {
            const msg = String(error instanceof Error ? error.message : error);
            if (/已停止|已失败/.test(msg) && restarts < 2) {
              restarts += 1;
              write(`学习会话已停止 → restart-learning 自愈 ${restarts}/2`);
              await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/restart-learning`, {}, 120000);
              await sleep(5000);
              continue;
            }
            if (/valid JSON|retry budget exhausted/i.test(msg) && stepRetries < 4) {
              stepRetries += 1;
              write(`模型抖动（${/JSON/i.test(msg) ? '非JSON输出' : '重试预算耗尽'}）→ 原地重试 ${stepRetries}/4`);
              await sleep(10000);
              continue;
            }
            throw error;
          }
          stepRetries = 0;
          const d = r?.data || {};
          turns += 1;
          // 收束对峙：老师已给收束信号但平台判定还不能结（学员自评没完 / 抽样判决没放行）
          const cd = d.closureDecision;
          if (cd && cd.teacherReady === true && cd.canCompleteTask === false) {
            closureStandoff += 1;
            if (closureStandoff > maxStandoff) maxStandoff = closureStandoff;
            if (closureStandoff === 1) write(`收束对峙开始（第 ${turns} 轮）：${String(cd.reason || '').slice(0, 90)}`);
            else if (closureStandoff % 5 === 0) write(`收束对峙已 ${closureStandoff} 轮（第 ${turns} 轮，仍未结）：${String(cd.reason || '').slice(0, 90)}`);
          } else {
            if (maxStandoff > 0 && closureStandoff === 0) write(`收束对峙结束（最长 ${maxStandoff} 轮）`);
            closureStandoff = 0;
          }
          // 上游暂停（池轮换/禁用窗口；后端已改为非终局暂停）：不再 2 秒一锤——30s 退避重推同一回合；
          // 连续 10 次判窗口未恢复，提前换轮（由外层 revive 循环接管）
          if (d.success === false && /已暂停本回合|教学回合暂时未能生成/.test(String(d.aiResponse || ''))) {
            upstreamPauses += 1;
            if (upstreamPauses >= 10) { write(`上游连续 ${upstreamPauses} 次暂停 → 判定窗口未恢复，提前换轮`); break; }
            if (upstreamPauses === 1) write(`上游暂停本回合（${String(d.error || '').slice(0, 60)}）→ 30s 退避重推`);
            await sleep(30000);
            continue;
          }
          const s = d.status || d.sessionStatus || d.phase || '';
          if (
            d.taskCompleted === true || d.isPathCompleted === true || d.firstTaskCompleted === true
            || Number(d.completedTasks || 0) > baseline || s === 'task-done' || s === 'completed'
          ) { completed = true; break; }
          if (s === 'failed') throw new Error(`teaching step failed: ${JSON.stringify(d).slice(0, 120)}`);
          await sleep(2000);
        }
        if (!completed) { write(`本课超时（${turns} 轮未完成），下一轮继续`); continue; }
        // 补一步 finalize（step N+1 才 endSession→wrapup→completeTask→推进）
        for (let f = 0; f < 2; f += 1) {
          try {
            const fd = await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/teaching-step`, {}, 300000);
            if (fd?.data?.taskCompleted === true) continue;
            break;
          } catch { break; }
        }
        await api('POST', `/api/admin/virtual-learners/sessions/${p.sessionId}/wrapup`, {}).catch(() => {});
        write(`本课完成（${turns} 轮）｜已完成 ${completedCount(p.pathId)}/${TARGET}${maxStandoff ? `｜收束对峙最长 ${maxStandoff} 轮` : ''}`);
      } catch (error) {
        write(`本轮失败（${(error instanceof Error ? error.message : String(error)).slice(0, 140)}）→ 20s 后再来`);
        await sleep(20000);
      }
      await sleep(3000);
    }
    write(`磨课结束：已完成 ${completedCount(p.pathId)}/${TARGET}`);
  }));
  console.log(JSON.stringify({ grind: 'done' }, null, 2));
  db.close();
}

main().catch((error) => { console.error('[ab-pair-setup] 失败：', error); process.exitCode = 1; });
