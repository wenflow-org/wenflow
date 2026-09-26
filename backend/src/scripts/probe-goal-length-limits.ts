/* eslint-disable no-console -- 一次性诊断 CLI */
/* eslint-disable @typescript-eslint/no-explicit-any -- 探针：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/**
 * 目标阶段「path 长度」边界探测（用户要求：过长过短都测上限）：
 *  S1 极短 3 字        → 能否收敛（追问还是直接进入方案）
 *  S2 短 20 字
 *  S3 前端上限 1000 字
 *  S4 后端上限 4096 字（正好卡线）
 *  S5 超限 5000 字      → 期望明确 400
 * 每枪记录：HTTP 状态、耗时、是否收敛（结构）、AI 回复首段。
 * 用法：npx ts-node --transpile-only src/scripts/probe-goal-length-limits.ts
 * 账号从环境变量读取（PROBE_ACCOUNT_NAME / PROBE_ACCOUNT_PASSWORD），不再写入源码。
 */
import 'dotenv/config';
import axios from 'axios';

const BASE = process.env.API_BASE_URL || 'http://localhost:3001/api';
const NAME = process.env.PROBE_ACCOUNT_NAME || '';
const PASSWORD = process.env.PROBE_ACCOUNT_PASSWORD || '';

if (!NAME || !PASSWORD) {
  console.error('缺少 PROBE_ACCOUNT_NAME / PROBE_ACCOUNT_PASSWORD 环境变量，无法登录');
  process.exit(1);
}

async function login(): Promise<string> {
  const res = await axios.post(`${BASE}/auth/login`, { name: NAME, password: PASSWORD });
  const cookie = res.headers['set-cookie']?.[0] || '';
  return cookie.split(';')[0];
}

interface GoalProbeResult { status: number; ms: number; reply: string; converged: boolean; stages: number; raw: string; info: number; errBody?: string }

async function startGoal(cookie: string, goal: string): Promise<GoalProbeResult> {
  const started = Date.now();
  try {
    const res = await axios.post(
      `${BASE}/goal-conversation/start`,
      { input: { text: goal } },
      { headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, timeout: 240_000 },
    );
    const data = res.data?.data || res.data || {};
    const d = data.state || data;
    const uv = d.userVisible || d;
    const replyText = String(uv.lastAssistantMessage || uv.reply || uv.text || uv.question || '');
    const infoCount = uv.collected ? Object.keys(uv.collected).length : -1;
    const msgs = d.messages || d.turns || [];
    const last = msgs[msgs.length - 1];
    const text = String(last?.content || last?.text || data.reply || '').slice(0, 120).replace(/\n/g, ' ');
    return {
      status: res.status,
      ms: Date.now() - started,
      reply: replyText || text,
      info: infoCount,
      converged: !!d.isComplete || !!d.readyToConfirm || !!d.proposal,
      stages: Array.isArray(d.stages) ? d.stages.length : -1,
      raw: JSON.stringify(Object.keys(d)).slice(0, 120),
    };
  } catch (e: any) {
    return {
      info: -1,
      status: e?.response?.status || 0,
      ms: Date.now() - started,
      reply: (e?.response?.data?.error?.message || e.message || '').slice(0, 160),
      errBody: JSON.stringify(e?.response?.data || {}).slice(0, 200),
      converged: false,
      stages: -1,
      raw: '',
    };
  }
}

function label(tag: string, chars: number, r: { status: number; ms: number; reply: string; converged: boolean; stages: number; raw: string; info: number; errBody?: string }): void {
  console.log(`${tag.padEnd(22)} chars=${String(chars).padEnd(6)} http=${String(r.status).padEnd(4)} ${String(r.ms).padEnd(6)}ms collected=${String(r.info).padEnd(3)} | ${r.reply.slice(0, 90)}`);
  if (r.errBody) console.log('    errBody:', r.errBody);
}

async function main(): Promise<void> {
  const cookie = await login();
  console.log('logged in as', NAME);

  const short = '学英语';
  const short20 = '我想学Python做数据分析';
  const long1000Base = '我是一个在二线城市打工的上班族，每天通勤要一个小时，最近公司裁员谣言很多，心里很慌。'
    + '我想学一门能傍身的技能，但又不知道自己该学什么。'
    + '我高中学历，数学不好，英语只会背单词。'
    + '平时只有晚上九点以后和周末有时间，最多一天一个半小时。'
    + '我不想花钱报班，希望能先自学试试。'
    + '目标是半年内能靠这门技能接到第一单兼职，或者在公司内部转岗用上。'
    + '我关注过短视频剪辑、Python、Excel、还有自媒体写作，但每个都只看了三天教程就放弃了，主要问题是不知道学来干嘛，也没有人反馈我学得好不好。'
    + '这次我想认真一点，但需要有人告诉我先做什么、后做什么，每件事做到什么程度算过关。另外我有点拖延，需要一个能每天提醒我、并且能看见自己进步的机制。';
  const long1000 = long1000Base.repeat(4).slice(0, 1000);
  const base4096 = '我想学Python，从零基础到能找工作，希望覆盖基础语法、面向对象、常用库、爬虫、数据分析和一个完整项目，最好能带我刷面试题，另外我只有晚上有空。';
  const exact4096 = base4096.repeat(Math.ceil(4096 / base4096.length)).slice(0, 4096);
  const base5000 = '我想学理财，希望从记账开始，一直到能自己配置基金组合，需要看得懂的讲解和可执行的每周任务。';
  const over5000 = base5000.repeat(Math.ceil(5000 / base5000.length)).slice(0, 5000);

  console.log('\n=== S1 极短 3 字 ===');
  label('S1-3字', short.length, await startGoal(cookie, short));
  console.log('\n=== S2 短 20 字 ===');
  label('S2-20字', short20.length, await startGoal(cookie, short20));
  console.log('\n=== S3 前端上限 1000 字 ===');
  label('S3-1000字', long1000.length, await startGoal(cookie, long1000));
  console.log('\n=== S4 后端上限 4096 字 ===');
  label('S4-4096字', exact4096.length, await startGoal(cookie, exact4096));
  console.log('\n=== S5 超限 5000 字 ===');
  label('S5-5000字', over5000.length, await startGoal(cookie, over5000));
  console.log('\n=== S6 1 字 ===');
  label('S6-1字', 1, await startGoal(cookie, '学'));
  console.log('\n=== S7 空串 ===');
  label('S7-0字', 0, await startGoal(cookie, ''));
}

main().catch((e) => {
  console.error(e?.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e);
  process.exitCode = 1;
});
