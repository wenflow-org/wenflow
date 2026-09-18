/**
 * 批量虚拟学习者 → 推进到「路径生成」（只读 DB + admin API）
 *
 * 目标：一次造 N 个**互不相同**的虚拟学习者，分批推进到 path 生成完成
 * （goal 对话 → 路径规划 → 阶段任务设计），**不进入学习**（autoAdvanceToLearning=false）。
 *
 * 设计（对齐仓库既有做法，不依赖 Prisma 生成客户端）：
 * - 用 `node:sqlite` 只读查库做进度/结果统计（schema 常变，Prisma 客户端会漂移）；
 * - 用 admin API 干活（登录凭据取 `backend/.env` 的 INIT_ADMIN_*）；
 * - **两阶段**：① `POST /batch-create`（服务端会生成人设 + 故事）→ 轮询批次进度；
 *   ② 逐个 `start-session` → `run-full { autoAdvanceToPath: true }`；
 * - 可重入：已有 `learning_paths` 的学习者默认跳过（`--force` 可重跑）。
 *
 * 用法：
 *   node scripts/vl-batch-path.mjs --count=50 --batch=10 --stories=1 --concurrency=2 --tag=vl50
 *   常用：--dry-run（只打印计划）/ --phase=create|advance|both（默认 both）
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:3001';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');

const arg = (name, def = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? true : def;
};
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

const COUNT = num(arg('count'), 50);
const BATCH = num(arg('batch'), 10);
const STORIES = num(arg('stories'), 1);
const CONCURRENCY = num(arg('concurrency'), 2);
const TAG = String(arg('tag') || `vl${COUNT}`);
const PHASE = String(arg('phase') || 'both');
const FORCE = Boolean(arg('force', false));
const DRY = Boolean(arg('dry-run', false));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const q = (sql, params = []) => { const db = new DatabaseSync(DB_PATH, { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } };
const q1 = (sql, params = []) => q(sql, params)[0] || null;

let cookie = '';
async function login() {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('admin 登录失败（检查 backend/.env 的 INIT_ADMIN_NAME/PASSWORD）');
}

async function api(method, urlPath, bodyObj, { retries = 3, timeoutMs = 900000, allowBusinessError = false } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
      if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(BASE + urlPath, {
        method, headers, body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
      if (!res.ok || json?.success === false) {
        lastErr = String(json?.error?.message || json?.error || text).slice(0, 200);
        // 忙/瞬时：退避重试（虚拟会话租约 409、网关 5xx、限流 429）
        if (res.status === 409 || res.status >= 500 || res.status === 429) { await sleep(12000 * (attempt + 1)); continue; }
        if (allowBusinessError && res.ok) return json;   // 交回调用方按业务字段判定
        throw new Error(`${method} ${urlPath}: ${lastErr}`);
      }
      return json;
    } catch (e) {
      lastErr = (e?.cause?.code ? e.cause.code + ' ' : '') + e.message;
      await sleep(8000 * (attempt + 1));
    }
  }
  throw new Error(`${method} ${urlPath} 失败: ${lastErr}`);
}

/** 50 个互不相同的名字（人设/故事由服务端按名字+近期场景提示词生成，天然多样） */
const FIRST = ['林', '陈', '王', '李', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '罗', '郑', '梁', '谢', '唐'];
const GIVEN = ['晓雨', '志强', '婉如', '浩然', '思远', '雅静', '子墨', '一鸣', '书瑶', '嘉禾', '明轩', '若曦', '怀瑾', '修远', '清和', '知行', '衡之', '慕白', '望舒', '裕安'];
function makeNames(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(`${FIRST[i % FIRST.length]}${GIVEN[Math.floor(i / FIRST.length) % GIVEN.length]}`);
  return out;
}

/** 两维错开：姓按 i 循环、名按 ⌊i/20⌋ 循环后仍会重名，这里改用互质步长保证 50 个不重复 */
function makeNames50(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = FIRST[i % FIRST.length];
    const g = GIVEN[(i * 7 + Math.floor(i / FIRST.length)) % GIVEN.length];
    out.push(`${f}${g}`);
  }
  return [...new Set(out)].slice(0, n);
}

async function createBatch(names, cohort) {
  const started = await api('POST', '/api/admin/virtual-learners/batch-create', {
    rows: names.map((name) => ({ name, storyCount: STORIES })),
    cohort,
    note: `vl-batch-path ${TAG}`,
  });
  const batchId = started?.data?.id || started?.data?.batchId;
  if (!batchId) throw new Error('batch-create 未返回 batchId: ' + JSON.stringify(started).slice(0, 200));
  log(`批次 ${batchId} 已提交（${names.length} 人）`);
  return batchId;
}

async function waitBatch(batchId, timeoutMs = 45 * 60 * 1000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    const r = await api('GET', `/api/admin/virtual-learners/batch-create/${batchId}`);
    const d = r?.data || {};
    const line = `status=${d.status} created=${d.created ?? '-'}/${d.total ?? '-'} personaLeft=${d.personaLeft ?? '-'} stories=${d.storiesDone ?? '-'}/${d.totalStories ?? '-'} failed=${(d.failed || []).length}`;
    if (line !== last) { log('  ' + line); last = line; }
    if (d.status && d.status !== 'running' && d.status !== 'pending' && d.status !== 'queued') return d;
    await sleep(10000);
  }
  log('  批次等待超时，继续（已创建的部分仍可用）');
  return null;
}

/** 该用户名下是否已有 learning_paths */
const hasPath = (userId) => Boolean(q1('SELECT id FROM learning_paths WHERE userId=? LIMIT 1', [userId]));

async function advanceOne(row) {
  const t0 = Date.now();
  const detail = await api('GET', `/api/admin/virtual-learners/${row.profileId}`);
  const stories = detail?.data?.profile?.storyPool || detail?.data?.storyPool || [];
  if (!stories.length) return { ...row, ok: false, error: '无故事（storyPool 为空）' };
  const storyId = stories[0].id || stories[0].storyId;

  const started = await api('POST', `/api/admin/virtual-learners/${row.profileId}/start-session`, { storyId });
  const sessionId = started?.data?.id;
  if (!sessionId) return { ...row, ok: false, error: 'start-session 失败' };

  // allowBusinessError：run-full 在"进不了教学阶段"时会返回 success=false，
  // 但那对我们（只要路径生成）不是失败——成败一律以 data.pathGenerated 判定。
  const res = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/run-full`, {
    maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false,
    autoAdvanceToPath: true, autoAdvanceToLearning: false,
  }, { allowBusinessError: true });
  const d = res?.data || {};
  const lp = q1('SELECT id FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [row.userId]);
  const ms = lp ? q1('SELECT COUNT(*) c FROM milestones WHERE learningPathId=?', [lp.id])?.c || 0 : 0;
  const st = lp ? q1('SELECT COUNT(*) c FROM subtasks s JOIN milestones m ON m.id=s.milestoneId WHERE m.learningPathId=?', [lp.id])?.c || 0 : 0;
  return {
    ...row, ok: Boolean(d.pathGenerated),
    pathId: lp?.id || null, milestones: ms, subtasks: st,
    goalRounds: d.goalRounds ?? null, finalStage: d.finalStage || null,
    seconds: Math.round((Date.now() - t0) / 1000), error: d.error ? String(d.error).slice(0, 120) : null,
  };
}

async function main() {
  if (DRY) {
    log(`DRY RUN：将创建 ${COUNT} 人（每批 ${BATCH}，每人 ${STORIES} 个故事），并发 ${CONCURRENCY}，tag=${TAG}`);
    log('名字示例：' + makeNames50(Math.min(COUNT, 5)).join('、') + ' …');
    return;
  }
  await login();
  log(`登录成功｜目标 ${COUNT} 人 / 每批 ${BATCH} / 并发 ${CONCURRENCY} / tag=${TAG} / phase=${PHASE}`);

  const before = new Set(q('SELECT id FROM virtual_learner_profiles').map((r) => r.id));
  const names = makeNames50(COUNT);

  // ---------- Phase A：批量创建（人设 + 故事由服务端生成） ----------
  if (PHASE === 'both' || PHASE === 'create') {
    for (let i = 0; i < COUNT; i += BATCH) {
      const slice = names.slice(i, i + BATCH);
      log(`== 创建批次 ${Math.floor(i / BATCH) + 1}/${Math.ceil(COUNT / BATCH)}（${slice.length} 人）`);
      const batchId = await createBatch(slice, `${TAG}-b${Math.floor(i / BATCH) + 1}`);
      await waitBatch(batchId);
    }
  }

  // ---------- Phase B：逐个推进到路径生成 ----------
  if (PHASE === 'both' || PHASE === 'advance') {
    // 只认**本次标签**创建的人（notes 里带 tag）：共用环境里并行工作流也在造人，
    // 用"快照 diff"会把他们的样本混进来（实测捞到了别人的「林阿婆」）。
    const fresh = q(
      `SELECT p.id AS profileId, p.userId AS userId, u.name AS name
         FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
        WHERE (p.notes LIKE ? OR p.tags LIKE ?)
        ORDER BY p.createdAt ASC`,
      [`%${TAG}%`, `%${TAG}%`],
    ).filter((r) => FORCE || !hasPath(r.userId));
    log(`== 待推进 ${fresh.length} 人（跳过已有路径的 ${COUNT - fresh.length} 人）`);

    const results = [];
    let cursor = 0;
    const worker = async (slot) => {
      while (cursor < fresh.length) {
        const row = fresh[cursor++];
        const idx = results.length + 1;
        log(`  [${slot}] #${idx}/${fresh.length} ${row.name} 开始…`);
        try {
          const r = await advanceOne(row);
          results.push(r);
          log(`  [${slot}] #${idx} ${row.name} → ${r.ok ? 'OK' : 'FAIL'} path=${r.ok ? 'Y' : 'N'} M=${r.milestones} S=${r.subtasks} ${r.seconds}s${r.error ? ' err=' + r.error : ''}`);
        } catch (e) {
          results.push({ ...row, ok: false, error: String(e.message) });
          log(`  [${slot}] #${idx} ${row.name} → 异常：${String(e.message).slice(0, 500)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, fresh.length)) }, (_, i) => worker(i + 1)));

    const outDir = path.join(ROOT, 'backend', 'prisma', '..', 'vlab-runs');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${TAG}-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ tag: TAG, count: COUNT, results }, null, 2), 'utf8');

    const ok = results.filter((r) => r.ok).length;
    const secs = results.map((r) => r.seconds || 0);
    log('');
    log('=== 汇总 ===');
    log(`成功 ${ok}/${results.length}｜总时长 ${Math.round(secs.reduce((a, b) => a + b, 0) / 60)} 分钟｜中位 ${secs.sort((a, b) => a - b)[Math.floor(secs.length / 2)] || 0}s/人`);
    for (const r of results) log(`  ${r.ok ? '✓' : '✗'} ${String(r.name).padEnd(6)} M=${String(r.milestones).padStart(2)} S=${String(r.subtasks).padStart(2)} ${String(r.seconds ?? '-').padStart(4)}s ${r.error ? '| ' + r.error : ''}`);
    log(`明细：${outFile}`);
  }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
