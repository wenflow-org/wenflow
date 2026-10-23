/**
 * 离线 LLM 评审 · 共享层
 *
 * 设计约束：
 * - **只读库**：所有案例都从 dev.db 只读抽取，评审不写任何业务表。
 * - **密钥只走环境变量**：OFFLINE_EVAL_API_KEY（或 WENFLOW_AUDIT_KEY），
 *   源码/示例/测试不得出现可用字面量。
 * - **决策模型固定 ds4.1**：默认 deepseek-v4.1-flash；换模型必须显式 --model，
 *   并随 judgeVersion 落档，保证结论可复现。
 * - **引文可核验**：任何判 true 的二元 flag 必须附逐字引文；引文不在案例块中即降级，
 *   防止模型凭印象编造问题（沿用 class-audit-judge v4 的三层加固）。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const DEFAULT_DB = join(REPO_ROOT, 'backend', 'prisma', 'dev.db');
export const DEFAULT_API = 'https://newapi.wenflow.org/v1/chat/completions';
export const DEFAULT_MODEL = process.env.OFFLINE_EVAL_MODEL || 'deepseek-v4.1-flash';

/**
 * 读取本地 .env（只补缺失键，绝不覆盖已有环境变量；不打印任何值）。
 * 密钥文件本身在 .gitignore 内，仓库里只有 .env.example 的占位符。
 */
export function loadEnvFile(file = join(REPO_ROOT, 'backend', '.env')) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq < 0) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

export function argNum(args, name, fallback) {
  const n = Number(args[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function openDb(file = DEFAULT_DB) {
  if (!existsSync(file)) throw new Error(`读库不存在：${file}`);
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA busy_timeout=30000');
  return db;
}

export const jparse = (s, fb = null) => {
  try { return JSON.parse(s); } catch { return fb; }
};
export const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…（截断）' : t;
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 文本归一（引文核验用）：去空白、统一省略号/引号。 */
export const norm = (s) => String(s || '')
  .replace(/\s+/g, '')
  .replace(/…（截断）/g, '')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'");

let CHAT_STATS = { calls: 0, failures: 0, retries: 0 };
export function resetChatStats() { CHAT_STATS = { calls: 0, failures: 0, retries: 0 }; }
export function getChatStats() { return { ...CHAT_STATS }; }

function endpoint() {
  return process.env.OFFLINE_EVAL_API_URL || process.env.WENFLOW_AUDIT_API || DEFAULT_API;
}
function apiKey() {
  const key = process.env.OFFLINE_EVAL_API_KEY || process.env.WENFLOW_AUDIT_KEY || '';
  if (!key.trim()) throw new Error('缺少 OFFLINE_EVAL_API_KEY（只从环境变量读取，不要写进源码）');
  return key;
}

/** 单次 chat 调用；429/5xx/超时按指数退避重试。 */
export async function chat(messages, options = {}) {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.2,
    maxTokens = 8000,
    timeoutMs = 300000,
    retries = 2,
  } = options;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      CHAT_STATS.calls += 1;
      const r = await fetch(endpoint(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
        signal: ac.signal,
      });
      const text = await r.text();
      if (!r.ok) {
        const retryable = r.status === 429 || r.status >= 500;
        if (retryable && attempt < retries) {
          CHAT_STATS.retries += 1;
          await sleep(4000 + attempt * 8000);
          continue;
        }
        throw new Error(`http ${r.status}: ${text.slice(0, 300)}`);
      }
      return JSON.parse(text);
    } catch (error) {
      const msg = String(error?.message || error);
      const retryable = /aborted|fetch failed|http 429|http 5\d\d|ECONN|ETIMEDOUT/i.test(msg);
      if (retryable && attempt < retries) {
        CHAT_STATS.retries += 1;
        await sleep(4000 + attempt * 8000);
        continue;
      }
      CHAT_STATS.failures += 1;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  CHAT_STATS.failures += 1;
  throw new Error('chat: exhausted retries');
}

export function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json object');
  return JSON.parse(body.slice(a, b + 1));
}

/** judgeVersion = 口径名 + prompt 哈希 + 模型/温度/K，随每条结论落档。 */
export function makeJudgeVersion({ name, promptText, model, temperature, k }) {
  const hash = createHash('sha256').update(promptText || '').digest('hex').slice(0, 12);
  return `${name}:${hash}:${model}:t${temperature}:k${k}`;
}

export async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function ci95(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return 1.96 * Math.sqrt(variance / xs.length);
}
export const pct = (n, d) => (d > 0 ? Number((n / d).toFixed(3)) : null);
export function round3(v) { return v === null || v === undefined ? null : Math.round(v * 1000) / 1000; }

export function ensureDir(dir) { mkdirSync(dir, { recursive: true }); }

export function scoreBand(score) {
  if (score === null || score === undefined) return 'n/a';
  if (score >= 0.85) return '优';
  if (score >= 0.70) return '良';
  if (score >= 0.55) return '中';
  return '差';
}

export function weightedScore(dims, weights) {
  let sum = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = Number(dims[key]);
    if (!Number.isFinite(value)) continue;
    sum += value * weight;
    total += weight;
  }
  return total > 0 ? sum / total : null;
}

export function majority(values) {
  const trues = values.filter(Boolean).length;
  return trues * 2 > values.length;
}

/** 引文核验：至少一条引文在案例块中逐字出现（归一化后）。 */
export function hasVerbatimQuote(block, quotes, minLen = 6) {
  const nb = norm(block);
  const list = Array.isArray(quotes) ? quotes : [];
  return list.some((q) => {
    const nq = norm(q);
    return nq.length >= minLen && nb.includes(nq);
  });
}

export function validateIssues(rawIssues, dimensions) {
  const issues = [];
  for (const item of Array.isArray(rawIssues) ? rawIssues : []) {
    if (!item || typeof item !== 'object') continue;
    const dimension = String(item.dimension || '').trim();
    if (!dimensions.includes(dimension)) continue;
    const severity = ['low', 'medium', 'high'].includes(item.severity) ? item.severity : 'low';
    issues.push({
      dimension,
      severity,
      quote: clip(item.quote || item.evidence || '', 160),
      suggestion: clip(item.suggestion || item.advice || '', 300),
    });
    if (issues.length >= 8) break;
  }
  return issues;
}

export function printCaseProgress(label, done, total, extra = '') {
  if (done === total || done % 5 === 0) {
    console.log(`[${label}] ${done}/${total}${extra ? ` ${extra}` : ''}`);
  }
}
