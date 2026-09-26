/* eslint-disable no-console -- 一次性诊断 CLI */
/* eslint-disable @typescript-eslint/no-explicit-any -- 探针：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/**
 * 目标阶段「path 长度」上下限探测（输出侧）：以不同**广度**的目标走完 目标对话→确认生成，
 * 量生成路径的形态（阶段数/任务数/预计小时/生成耗时）。
 *   N1 极窄：单一具体动作的目标
 *   N2 中等：单一主题（复刻前两轮的体量做基线）
 *   N3 极宽：跨多领域的大目标
 * 用法：npx ts-node --transpile-only src/scripts/probe-path-length-limits.ts
 */
import 'dotenv/config';
import axios from 'axios';

const BASE = 'http://localhost:3001/api';

interface ProbeResult {
  tag: string;
  goalChars: number;
  turns: number;
  confirmMs: number;
  http: number;
  stages: number;
  tasks: number;
  hours: number | null;
  error: string;
}

async function login(): Promise<string> {
  // 探针账号从环境变量读取（PROBE_ACCOUNT_NAME / PROBE_ACCOUNT_PASSWORD），不写入源码
  const name = process.env.PROBE_ACCOUNT_NAME || '';
  const password = process.env.PROBE_ACCOUNT_PASSWORD || '';
  if (!name || !password) throw new Error('缺少 PROBE_ACCOUNT_NAME / PROBE_ACCOUNT_PASSWORD 环境变量，无法登录');
  const res = await axios.post(`${BASE}/auth/login`, { name, password });
  return (res.headers['set-cookie']?.[0] || '').split(';')[0];
}

function pickReplies(goal: string): string[] {
  if (goal.startsWith('我想给')) {
    return [
      '就用阳台上现有的两根竹竿和扎带，我不想额外买材料。季度不用很长，这个周末能做完就行。',
      '就按这个来',
    ];
  }
  if (goal.startsWith('我想转行')) {
    return [
      '我现在25岁，大专学历，在工厂做质检，想半年内找到一份初级的软件开发工作，能接受降薪。',
      '就按这个来',
    ];
  }
  return ['白天上班，只有晚上和周末有空，希望两个月内能上手。', '就按这个来'];
}

async function runProbe(cookie: string, tag: string, goal: string): Promise<ProbeResult> {
  const replies = pickReplies(goal);
  const out: ProbeResult = { tag, goalChars: goal.length, turns: 0, confirmMs: 0, http: 0, stages: 0, tasks: 0, hours: null, error: '' };
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
  try {
    const started = Date.now();
    const start = await axios.post(`${BASE}/goal-conversation/start`, { input: { text: goal } }, { headers, timeout: 240_000 });
    out.http = start.status;
    const startData = start.data?.data || {};
    const cid = startData?.internal?.core?.conversationId;
    if (!cid) { out.error = 'no conversationId'; return out; }
    let last: any = startData;
    for (const reply of replies) {
      const url = `${BASE}/goal-conversation/${cid}/reply`;
      console.log('   -> POST', url, '| reply:', reply.slice(0, 20));
      const isConfirm = reply === '就按这个来';
      const res = await axios.post(url, { input: { text: reply }, contextMode: 'recent', confirmProposal: isConfirm }, { headers, timeout: 240_000 });
      last = res.data?.data || {};
      out.turns += 1;
    }
    out.confirmMs = Date.now() - started;
    // 确认后路径进入生成；轮询 learning-paths
    await new Promise((r) => setTimeout(r, 20_000));
    for (let i = 0; i < 10; i++) {
      const list = await axios.get(`${BASE}/learning/paths`, { headers, timeout: 60_000 });
      const paths = list.data?.data?.paths || list.data?.data || [];
      const hit = (Array.isArray(paths) ? paths : []).find((p: any) => (p.name || p.title || '').includes(goal.slice(0, 6)) || (p.description || '').includes(goal.slice(4, 20)));
      if (hit && (hit.totalMilestones || 0) > 0) {
        out.stages = hit.totalMilestones || 0;
        out.tasks = hit.taskCount || 0;
        out.hours = hit.estimatedHours ?? null;
        return out;
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
    out.error = 'path not found/not ready after polling';
    return out;
  } catch (e: any) {
    out.error = (e?.response?.data?.error?.message || e.message || '').slice(0, 160);
    out.http = e?.response?.status || out.http;
    console.log('   !! reply failed:', JSON.stringify(e?.response?.data || {}).slice(0, 200), '| url:', e?.config?.url, '| status:', e?.response?.status);
    return out;
  }
}

async function main(): Promise<void> {
  const cookie = await login();
  const probes: Array<[string, string]> = [
    ['N1-极窄(单动作)', '我想给阳台那盆小番茄搭个架子，让它别倒'],
    ['N3-极宽(转行)', '我想转行做程序员，从零基础到能找到工作'],
  ];
  const results: ProbeResult[] = [];
  for (const [tag, goal] of probes) {
    const r = await runProbe(cookie, tag, goal);
    results.push(r);
    console.log(`${tag.padEnd(16)} goalChars=${String(r.goalChars).padEnd(4)} turns=${r.turns} http=${r.http} 总耗时=${String(r.confirmMs).padEnd(7)}ms | stages=${r.stages} tasks=${r.tasks} hours=${r.hours}${r.error ? ' | err=' + r.error : ''}`);
  }
  console.log('\n基线（前两轮同域目标，复习用）：4 阶段 / 12 任务 / 4.8h；4 阶段 / 8 任务 / 4.6h');
}

main().catch((e) => {
  console.error(e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e);
  process.exitCode = 1;
});
