#!/usr/bin/env node
/**
 * CI 状态回看（**只读**）——一条命令看清最近 run 的失败 job / 失败步骤 / 关键错误行。
 *
 * 为什么需要它：排查 CI 时每次都要手写 GitHub REST 调用（runs → jobs → logs），
 * 既慢又容易漏看"失败步骤里的第一行错误"。本脚本把它固化下来。
 *
 * 鉴权（不打印、不落盘）：
 *   1. 环境变量 `GITHUB_TOKEN` / `GH_TOKEN`（CI 里常用）；
 *   2. 否则从本机 git 凭据取（`git credential fill`，仅 github.com）。
 *
 * 用法：
 *   node scripts/ci-status.mjs                     # 当前分支最近 3 次 run
 *   node scripts/ci-status.mjs --branch=develop --runs=5
 *   node scripts/ci-status.mjs --logs             # 额外抓失败步骤的关键错误行
 *   node scripts/ci-status.mjs --run=35314711550 --logs
 */
import { execFileSync } from 'node:child_process';

const REPO = 'wenflow-org/wenflow';
const API = 'https://api.github.com';

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? true : fallback;
}

function currentBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'develop';
  }
}

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    const line = out.split('\n').find((l) => l.startsWith('password='));
    return line ? line.slice('password='.length).trim() : null;
  } catch {
    return null;
  }
}

const TOKEN = readToken();
const HEADERS = {
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`);
  return res.json();
}

/** 从 job 日志里挑出"最像错误"的行（GitHub 的 ##[error] 优先，其次编译/测试汇总行） */
function pickErrorLines(text) {
  const strip = (l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, '').replace(/\u001b\[[0-9;]*m/g, '');
  const lines = text.split('\n').map(strip);
  const marked = lines.filter((l) => /##\[error\]/.test(l));
  const summary = lines.filter((l) =>
    /error TS\d+|✖ \d+ problems|Test Suites:.*failed|Tests:.*failed|npm ERR!|^Error:/.test(l)
  );
  const merged = [...new Set([...marked, ...summary])].map((l) => l.replace(/^##\[error\]\s*/, '').trim());
  return merged.slice(0, 12);
}

async function reportRun(run, { withLogs }) {
  const head = `${run.id} | ${String(run.head_sha).slice(0, 8)} | ${run.status} | ${run.conclusion || '-'} | ${run.created_at}`;
  console.log(`\nRUN ${head}`);
  console.log(`    ${(run.display_title || '').slice(0, 90)}`);
  if (run.status !== 'completed') {
    console.log('    (进行中，稍后再看)');
    return;
  }
  const { jobs } = await api(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=30`);
  for (const job of jobs || []) {
    const failedSteps = (job.steps || []).filter((s) => s.conclusion === 'failure');
    const icon = job.conclusion === 'success' ? '✅' : job.conclusion === 'failure' ? '❌' : '•';
    console.log(`    ${icon} ${job.name.padEnd(44)} ${job.conclusion || '-'}`);
    for (const s of failedSteps) console.log(`        失败步骤：${s.name}`);
    if (!withLogs || failedSteps.length === 0) continue;
    if (!TOKEN) {
      console.log('        (无 token，跳过日志)');
      continue;
    }
    try {
      const res = await fetch(`${API}/repos/${REPO}/actions/jobs/${job.id}/logs`, { headers: HEADERS, redirect: 'follow' });
      const errs = pickErrorLines(await res.text());
      for (const e of errs) console.log(`        > ${e.slice(0, 200)}`);
    } catch (err) {
      console.log(`        (日志抓取失败：${err.message})`);
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.log('⚠ 未取到 GitHub token（环境变量 GITHUB_TOKEN / gh 凭据都没有）——只能看公开信息，日志会跳过。');
  }
  const runId = arg('run');
  const withLogs = Boolean(arg('logs', false));

  if (runId) {
    const run = await api(`/repos/${REPO}/actions/runs/${runId}`);
    await reportRun(run, { withLogs });
    return;
  }

  const branch = arg('branch') || currentBranch();
  const runs = Number(arg('runs') || 3);
  const data = await api(`/repos/${REPO}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=${Math.min(20, runs)}`);
  console.log(`分支 ${branch} 最近 ${data.workflow_runs.length} 次 run：`);
  for (const run of data.workflow_runs) {
    await reportRun(run, { withLogs: withLogs && run.conclusion === 'failure' });
  }
}

main().catch((err) => {
  console.error('ci-status 失败：', err.message);
  process.exitCode = 1;
});
