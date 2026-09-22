/**
 * AI 独立评审（两段式，**只读库、不改任何数据**）
 *
 * 动机（上一轮人工 + 子代理评审发现的疑点）：不管用户提的是什么问题，系统一律产出
 * "学习路径"（50/50，无负向出口）。本脚本用外部模型把这个疑点变成可复核的量化结果。
 *
 * ★ 评审设计的两个关键点（防偏）：
 *   1) **分诊盲评**：判定"问题本质属于哪一类"时，**不给模型看系统产出的路径**。
 *      否则模型会看到"已经有路径了"而倾向辩护（实测：给了路径 → 6/6 判 capability）。
 *   2) **布尔值机械推导**：`needsLearningPath` 由代码按 `primary === 'capability'` 算出，
 *      不让模型自己选边；模型只负责分类 + 给证据。
 *
 * 阶段一 triage（默认 3 次，取多数）：输入 = 学习者特征 + 故事（表层诉求/本质问题/隐藏缺口/误判）
 *   → { primary, secondary[], recommendedResponse, evidence, rationale, confidence }
 * 阶段二 path（默认 1 次）：输入 = 案例 + 阶段一结论 + 系统产出的路径
 *   → { pathVerdict: adequate|partial|misdirected, addressesPrimary, misalignmentReason, evidence, confidence }
 *
 * 用法：
 *   export EVAL_API_KEY=sk-xxx        # 或 --key-file=路径（key 不写入仓库）
 *   node scripts/vl-ai-audit.mjs --tag=vl50 --model=flash --concurrency=5 --runs=3
 * 参数：--phase=triage|path|both（默认 both）｜--model=flash|pro｜--concurrency ≤5（硬上限）
 *       --runs 分诊次数（默认 3，多数投票 + 一致率）｜--path-runs（默认 1）
 *       --limit 只跑前 N 例｜--out 输出 json｜--key-file 读 key 的文件
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
// 安全：不内置任何端点 fallback（曾硬编码公网 IP，等于把生产 LLM 入口写进公开仓库）——必须显式提供
const BASE = process.env.EVAL_API_BASE;
if (!BASE) {
  console.error('缺少 EVAL_API_BASE 环境变量（例如 http://127.0.0.1:30001/v1），拒绝执行。');
  process.exit(1);
}

const arg = (n, d = null) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : (process.argv.includes(`--${n}`) ? true : d); };
const TAG = String(arg('tag') || 'vl50');
const MODEL = ({ flash: 'deepseek-v4-flash', pro: 'deepseek-v4-pro' })[String(arg('model') || 'flash')] || String(arg('model') || 'deepseek-v4-flash');
const PHASE = String(arg('phase') || 'both');
const CONCURRENCY = Math.min(Number(arg('concurrency', 5)) || 5, 5); // 硬性上限 5
const RUNS = Math.max(1, Number(arg('runs', 3)) || 3);
const PATH_RUNS = Math.max(1, Number(arg('path-runs', 1)) || 1);
const LIMIT = Number(arg('limit', 0)) || 0;
/** 取故事的哪一篇：first（默认）| last | 数字下标。多故事样本（如基准学习者追加新故事后）用 last 对齐。 */
const STORY_SEL = String(arg('story') || 'first');

const keyFile = arg('key-file') || process.env.EVAL_KEY_FILE;
const KEY = process.env.EVAL_API_KEY
  || (keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '');
if (!KEY) { console.error('缺少 API key：请设置 EVAL_API_KEY 或 --key-file=路径'); process.exit(2); }

// ---------- 读数据（只读） ----------
const db = new DatabaseSync(DB, { readOnly: true });
const all = (sql, p = []) => db.prepare(sql).all(...p);
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const jparse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
/** 按 --story 选取要评审的那一篇故事（默认 first）。 */
function pickStory(storyPool) {
  const list = Array.isArray(storyPool) ? storyPool : [];
  if (!list.length) return {};
  if (STORY_SEL === 'last') return list[list.length - 1] || {};
  if (/^\d+$/.test(STORY_SEL)) return list[Number(STORY_SEL)] || {};
  return list[0] || {};
}

const learners = all(
  // 注意：不要 LEFT JOIN learning_paths——一人多条路径会让同一学习者出现多行（审计重复计数）。
  // 用子查询取"最近一条路径"即可。
  `SELECT p.userId, u.name, p.profile, p.knowledgeLevel,
          (SELECT lp.id FROM learning_paths lp WHERE lp.userId = p.userId ORDER BY lp.updatedAt DESC LIMIT 1) AS pathId,
          (SELECT lp.title FROM learning_paths lp WHERE lp.userId = p.userId ORDER BY lp.updatedAt DESC LIMIT 1) AS pathTitle,
          (SELECT lp.estimatedHours FROM learning_paths lp WHERE lp.userId = p.userId ORDER BY lp.updatedAt DESC LIMIT 1) AS estimatedHours
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.notes LIKE ? OR p.tags LIKE ?
    ORDER BY u.name`,
  [`%${TAG}%`, `%${TAG}%`],
);

const cases = [];
for (const l of learners) {
  const pr = jparse(l.profile);
  const st = pickStory(pr.storyPool);
  const gs = st.goalSeed && typeof st.goalSeed === 'object' ? st.goalSeed : {};
  const stages = l.pathId
    ? all('SELECT id, stageNumber, title, goal FROM milestones WHERE learningPathId=? ORDER BY stageNumber', [l.pathId])
      .map((m) => ({
        stage: m.stageNumber,
        title: clip(m.title, 60),
        goal: clip(m.goal, 160),
        tasks: all('SELECT title, taskType, cognitiveLevel, estimatedMinutes FROM subtasks WHERE milestoneId=? ORDER BY "order"', [m.id])
          .map((t) => ({ type: t.taskType, level: t.cognitiveLevel, min: t.estimatedMinutes, title: clip(t.title, 80) })),
      }))
    : [];
  cases.push({
    id: l.userId,
    name: l.name,
    learner: {
      level: l.knowledgeLevel,
      availableTime: pr.availableTime,
      loadTolerance: clip(pr.cognitiveLoadTolerance, 90),
      failurePatterns: clip(Array.isArray(pr.failurePatterns) ? pr.failurePatterns.join('；') : pr.failurePatterns, 120),
      emotionalTriggers: clip(Array.isArray(pr.emotionalTriggers) ? pr.emotionalTriggers.join('；') : pr.emotionalTriggers, 120),
    },
    story: {
      domain: clip(gs.domain, 60),
      goalType: clip(gs.goalType, 40),
      surfaceGoal: clip(gs.surfaceGoal, 220),
      realProblem: clip(gs.realProblem, 320),
      hiddenGaps: clip(Array.isArray(st.hiddenDetails) ? st.hiddenDetails.join('；') : st.hiddenDetails, 220),
      misdiagnosis: clip(st.misdiagnosis, 200),
    },
    product: { title: l.pathTitle, hours: l.estimatedHours, stages, taskCount: stages.reduce((a, s) => a + s.tasks.length, 0) },
  });
}
db.close();

const todo = LIMIT ? cases.slice(0, LIMIT) : cases;
const doTriage = PHASE !== 'path';
const doPath = PHASE !== 'triage';
console.log(`批次 ${TAG}：${cases.length} 例${LIMIT ? `（本次前 ${LIMIT}）` : ''}｜模型 ${MODEL}｜并发 ${CONCURRENCY}｜阶段 ${PHASE}｜分诊 ${RUNS} 次/例${doPath ? ` + 路径判定 ${PATH_RUNS} 次/例` : ''}`);

// ---------- 提示词 ----------
const SYSTEM = '你是一名严谨的学习科学 / 教学设计评审员。只依据给定事实判断，不迎合预设结论，不编造。输出必须是单个 JSON 对象，不要 markdown 代码块、不要前后缀。';

const CLASSES = `- capability：存在可迁移的概念/技能缺口，需要"建立认知结构 + 多步练习"才能提升（如：动态规划状态转移、立体几何建系、Excel 条件格式逻辑、药理推导）。
- oneoff_operation：一次性的具体操作/工具用法，学会"点哪里/怎么点"即可，无需建立概念（如：点某个按钮、复制粘贴、转 PDF、导出报表），通常十几分钟内可解决。
- environment_tooling：设备/软件/网络/配置/安装环境导致的阻塞，修好系统即可，不是学习者能力问题（如：依赖缺失、软件报错、文件损坏、系统卡死）。
- permission_process：账号/权限/审批/流程/交接/他人配合导致的阻塞（如：账号被锁、需管理员开权限、需上级批、需人代劳）。
- emotion_relationship：情绪调节/恐惧/面子/焦虑/人际冲突是主要阻塞（如：怕出错、怕丢脸、被顾客情绪拖拽）。`;

const RESP = `- capability → learning_path（若要配合情绪支持，用 combination）
- oneoff_operation → operation_card（一页操作卡/引导，几步走完）
- environment_tooling → referral_it（交给 IT/维修/官方渠道，或先修环境）
- permission_process → referral_process（走流程/找对的人/申请权限）
- emotion_relationship → emotional_support（情绪支持 + 一次成功体验，而非知识点任务）`;

function triagePrompt(c) {
  return `【案例】学习者：${c.name}（水平 ${c.learner.level}｜可用时间 ${c.learner.availableTime}｜负荷耐受「${c.learner.loadTolerance}」｜失败模式「${c.learner.failurePatterns}」｜情绪触发「${c.learner.emotionalTriggers}」）

故事（"表层诉求"是学习者自己说的；"本质问题/隐藏缺口/误判"是设计者给出的诊断）：
- 领域：${c.story.domain}｜类型：${c.story.goalType}
- 表层诉求：${c.story.surfaceGoal}
- 本质问题：${c.story.realProblem}
- 隐藏缺口：${c.story.hiddenGaps}
- 学习者误判：${c.story.misdiagnosis}

【任务】判断这个人当前最主要的阻塞属于哪一类：
${CLASSES}

判定 primary 的唯一口径：**"哪个阻塞不解决，其它做什么都白搭"**。次要阻塞放进 secondary（可为空）。
不要因为文字里出现"不会用/缺乏能力"就判 capability——那是表层诉求的常见措辞；
若本质是"账号被锁 / 软件坏了 / 系统报错 / 需要别人代劳 / 情绪上过不去"，即使措辞是"不会"，primary 也应是 permission_process / environment_tooling / emotion_relationship。

推荐响应（按 primary 映射）：
${RESP}

【输出】
{
  "primary": "capability|oneoff_operation|environment_tooling|permission_process|emotion_relationship",
  "secondary": [],
  "recommendedResponse": "learning_path|operation_card|referral_it|referral_process|emotional_support|combination",
  "evidence": "直接引用给定文本中的关键句（≤60字）",
  "rationale": "≤80字，说明为什么它是最主要的阻塞",
  "confidence": 0-100
}
只输出 JSON。`;
}

function pathPrompt(c, tri) {
  return `【案例】学习者：${c.name}（水平 ${c.learner.level}｜可用时间 ${c.learner.availableTime}｜负荷耐受「${c.learner.loadTolerance}」）
- 表层诉求：${c.story.surfaceGoal}
- 本质问题：${c.story.realProblem}
- 隐藏缺口：${c.story.hiddenGaps}

【已判定的主要阻塞】${tri?.primary || '（未知）'}${tri?.secondary?.length ? `（次要：${tri.secondary.join('、')}）` : ''}
理由：${tri?.rationale || '（无）'}

【系统实际产出的学习路径】
《${c.product.title}》 共 ${c.product.stages.length} 阶段 / ${c.product.taskCount} 任务 / 声明 ${c.product.hours} 小时
${c.product.stages.map((s) => `· 阶段${s.stage}「${s.title}」目标：${s.goal}\n${s.tasks.map((t) => `    - [${t.type}/${t.level}/${t.min}分钟] ${t.title}`).join('\n')}`).join('\n')}

【任务】只看事实：这条路径是否解决上面那个"主要阻塞"？
- adequate：路径目标与任务确实针对主要阻塞，且强度合理；
- partial：方向沾边但没打到点，或明显过薄/过重、有硬伤（如要求截图/依赖非文本材料）；
- misdirected：路径在解决另一个问题，或把"绕过/求助/兜底"当成学习目标，或强化了学习者的失败模式。

【输出】
{
  "pathVerdict": "adequate|partial|misdirected",
  "addressesPrimary": true|false,
  "misalignmentReason": "≤100字；adequate 时写路径好在哪",
  "evidence": "引用路径里的具体任务（≤60字）",
  "confidence": 0-100
}
只输出 JSON。`;
}

// ---------- 调用（带重试；并发池 ≤ 上限） ----------
let calls = 0, failures = 0;
async function callModel(prompt) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${clip(await res.text(), 160)}`);
      const j = await res.json();
      const text = j?.choices?.[0]?.message?.content || '';
      const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`无 JSON：${clip(text, 120)}`);
      const out = JSON.parse(m[0]);
      if (!out.primary && !out.pathVerdict) throw new Error('JSON 缺关键字段');
      calls += 1;
      return { ok: true, out };
    } catch (e) {
      if (attempt === 3) { failures += 1; return { ok: false, error: clip(e?.message || e, 200) }; }
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
}

const results = new Array(todo.length);
let cursor = 0;
const t0 = Date.now();
async function worker() {
  for (;;) {
    const i = cursor; cursor += 1;
    if (i >= todo.length) return;
    const c = todo[i];
    const rec = { name: c.name, id: c.id, pathTitle: c.product.title, taskCount: c.product.taskCount, hours: c.product.hours };
    if (doTriage) {
      const runs = [];
      for (let r = 0; r < RUNS; r += 1) { const res = await callModel(triagePrompt(c)); runs.push(res.ok ? res.out : { error: res.error }); }
      const okRuns = runs.filter((x) => x.primary);
      const tally = new Map();
      for (const x of okRuns) tally.set(x.primary, (tally.get(x.primary) || 0) + 1);
      const majority = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      rec.triageRuns = runs;
      rec.primary = majority;
      rec.triageAgreement = okRuns.length ? (tally.get(majority) || 0) / okRuns.length : 0;
      rec.needsLearningPath = majority === 'capability';           // ★ 机械推导，不让模型选边
      rec.recommendedResponse = okRuns[0]?.recommendedResponse || null;
      rec.confidence = okRuns.length ? Math.round(okRuns.reduce((a, x) => a + (Number(x.confidence) || 0), 0) / okRuns.length) : null;
    }
    if (doPath) {
      const runs = [];
      for (let r = 0; r < PATH_RUNS; r += 1) { const res = await callModel(pathPrompt(c, rec)); runs.push(res.ok ? res.out : { error: res.error }); }
      const okRuns = runs.filter((x) => x.pathVerdict);
      const tally = new Map();
      for (const x of okRuns) tally.set(x.pathVerdict, (tally.get(x.pathVerdict) || 0) + 1);
      rec.pathRuns = runs;
      rec.pathVerdict = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      rec.addressesPrimary = okRuns[0]?.addressesPrimary ?? null;
    }
    results[i] = rec;
    const done = results.filter(Boolean).length;
    const flag = rec.triageAgreement !== undefined && rec.triageAgreement < 1 ? ` ⚠一致${(rec.triageAgreement * 100).toFixed(0)}%` : '';
    console.log(`  [${String(done).padStart(2)}/${todo.length}] ${c.name.padEnd(16)} 主阻塞=${String(rec.primary || '-').padEnd(20)} 路径${rec.needsLearningPath === false ? '不该做✗' : ''}${rec.pathVerdict ? `｜产出=${rec.pathVerdict}` : ''}${flag}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()));

// ---------- 落盘 + 聚合 ----------
const outDir = path.join(ROOT, 'backend', 'vlab-runs');
fs.mkdirSync(outDir, { recursive: true });
const outFile = String(arg('out') || path.join(outDir, `${TAG}-ai-audit-${MODEL}${RUNS > 1 ? `-x${RUNS}` : ''}${PHASE !== 'both' ? `-${PHASE}` : ''}.json`));
fs.writeFileSync(outFile, JSON.stringify({ tag: TAG, model: MODEL, phase: PHASE, runs: RUNS, pathRuns: PATH_RUNS, concurrency: CONCURRENCY, storySel: STORY_SEL, generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');

const cnt = (key) => { const m = new Map(); for (const r of results) { if (!r) continue; const k = r[key]; if (k != null) m.set(k, (m.get(k) || 0) + 1); } return m; };
const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ');
const n = results.filter(Boolean).length;
console.log(`\n===== 汇总（${MODEL}｜${n} 例｜${((Date.now() - t0) / 1000).toFixed(0)}s｜调用 ${calls} 次，失败 ${failures}）=====`);
if (doTriage) {
  console.log(`主阻塞分布: ${fmt(cnt('primary'))}`);
  const noNeed = results.filter((r) => r && r.needsLearningPath === false).length;
  console.log(`★ 判定"不该只产出学习路径"：${noNeed}/${n}（${(noNeed / n * 100).toFixed(0)}%）`);
  console.log(`建议响应分布: ${fmt(cnt('recommendedResponse'))}`);
  const agree = results.filter((r) => r && r.triageAgreement === 1).length;
  const avg = results.filter((r) => r?.triageAgreement != null).reduce((a, r) => a + r.triageAgreement, 0) / n;
  console.log(`分诊一致性：完全一致 ${agree}/${n}，平均一致率 ${(avg * 100).toFixed(0)}%`);
}
if (doPath) console.log(`路径判定分布: ${fmt(cnt('pathVerdict'))}`);
console.log(`明细: ${outFile}`);
