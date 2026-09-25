/**
 * 缓存内容审计：teaching-turn 载荷逐块稳定性 + 发散点 + 稳定优先重排模拟
 *
 * 用法（backend 下）：npx ts-node --transpile-only src/scripts/analyze-prompt-cache-content.ts [sessionId?]
 * 数据源：prompt_call_logs(skill:teaching-turn) + llm_execution_attempts（真实用量与缓存命中）
 *
 * 输出三块：
 *  A. 按会话的逐块 diff：每个载荷块跨回合有几种取值（identical / churn / every-turn）
 *  B. 相邻两回合载荷的首个发散字节位置 → 当前可命中前缀；对比「稳定块前置重排」后的理论前缀
 *  C. 5 个零缓存上报 skill 的 attempts 采样（routing/模型/是否有 cache 字段）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const AGENT = 'skill:teaching-turn';
const ZERO_CACHE_SKILLS = [
  'skill:replan-attribution',
  'skill:concept-consolidator',
  'skill:learner-state-review',
  'skill:learner-progress-report',
  'skill:concept-load-estimator',
];

interface AttemptRow {
  promptCallId: string | null;
  promptTokens: number | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  messageCount: number | null;
  promptAttemptNo: number | null;
  success: number | null;
  resolvedModel: string | null;
  endpointHost: string | null;
}

interface CallRow {
  id: string;
  userId: string | null;
  pathId: string | null;
  systemPromptHash: string | null;
  userPayload: string | null;
  createdAt: Date;
}

function firstDivergence(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a === b ? -1 : n;
}

function fmtBytes(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)}K` : `${n}B`;
}

// 粗估 token：中文为主的 JSON 混合文本按 ~2.4 字节/token
function estTokens(bytes: number): number {
  return Math.round(bytes / 2.4);
}

async function main(): Promise<void> {
  const calls = (await prisma.prompt_call_logs.findMany({
    where: { agentId: AGENT, createdAt: { gte: new Date(Date.now() - 36 * 3600 * 1000) } },
    orderBy: { createdAt: 'asc' },
  })) as unknown as Array<CallRow & Record<string, unknown>>;

  if (!calls.length) {
    console.log('no teaching-turn calls in window');
    return;
  }

  // 会话切分：同 userId 且相邻间隔 < 15min
  const sessions: Array<typeof calls> = [];
  let cur: typeof calls = [];
  for (const c of calls) {
    if (cur.length && (cur[cur.length - 1].userId !== c.userId || c.createdAt.getTime() - cur[cur.length - 1].createdAt.getTime() > 15 * 60 * 1000)) {
      sessions.push(cur);
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length) sessions.push(cur);

  console.log(`calls=${calls.length} sessions=${sessions.length}`);

  // attempts 一次性取齐
  const callIds = calls.map((c) => c.id);
  const attemptByCall = new Map<string, AttemptRow[]>();
  for (let i = 0; i < callIds.length; i += 200) {
    const batch = callIds.slice(i, i + 200);
    const rows = (await prisma.llm_execution_attempts.findMany({
      where: { promptCallId: { in: batch } },
      orderBy: [{ promptCallId: 'asc' }, { promptAttemptNo: 'asc' }],
    })) as unknown as AttemptRow[];
    for (const r of rows) {
      if (!r.promptCallId) continue;
      const list = attemptByCall.get(r.promptCallId) || [];
      list.push(r);
      attemptByCall.set(r.promptCallId, list);
    }
  }

  for (const s of sessions.filter((x) => x.length >= 3)) {
    const first = s[0];
    console.log(`\n=== session user=${first.userId} path=${first.pathId || '-'} turns=${s.length} ${first.createdAt.toISOString().slice(5, 16)}~${s[s.length - 1].createdAt.toISOString().slice(11, 16)}`);
    const sysHashes = new Set(s.map((c) => c.systemPromptHash));
    console.log(`systemPromptHash: ${[...sysHashes].join(' | ')} (${sysHashes.size} 种)`);

    // A. 逐块稳定性
    const blockValues = new Map<string, Set<string>>();
    const blockBytes = new Map<string, number[]>();
    for (const c of s) {
      if (!c.userPayload) continue;
      const pl = JSON.parse(c.userPayload) as Record<string, unknown>;
      for (const [k, v] of Object.entries(pl)) {
        const str = typeof v === 'string' ? v : JSON.stringify(v);
        if (!blockValues.has(k)) { blockValues.set(k, new Set()); blockBytes.set(k, []); }
        blockValues.get(k)!.add(str);
        blockBytes.get(k)!.push(str.length);
      }
    }
    // 序列化键序（取最后一次载荷的实际键序）
    const keyOrder = Object.keys(JSON.parse(s[s.length - 1].userPayload || '{}'));
    console.log('载荷键序:', keyOrder.join(' → '));
    const n = s.length;
    console.log('块稳定性（distinct=跨回合不同取值数）:');
    for (const k of keyOrder) {
      const dv = blockValues.get(k)!;
      const bytes = blockBytes.get(k)!;
      const avg = Math.round(bytes.reduce((x, y) => x + y, 0) / bytes.length);
      const cls = dv.size === 1 ? 'identical ' : dv.size === n ? 'every-turn' : 'churn     ';
      console.log(`  ${cls} ${k.padEnd(24)} ${fmtBytes(avg).padStart(7)}  distinct=${dv.size}/${n}`);
    }

    // B. 相邻回合发散点 + 重排模拟
    let curCacheSum = 0;
    let reorderCacheSum = 0;
    let payloadSum = 0;
    let pairs = 0;
    for (let i = 1; i < s.length; i += 1) {
      const a = s[i - 1].userPayload || '';
      const b = s[i].userPayload || '';
      const div = firstDivergence(a, b);
      curCacheSum += div < 0 ? b.length : div;
      payloadSum += b.length;
      // 稳定优先重排：与上一回合 identical 的块（按键序放在前面）+ 会话内 identical 块恒定
      const pa = JSON.parse(a) as Record<string, unknown>;
      const pb = JSON.parse(b) as Record<string, unknown>;
      let stable = 0;
      const stableKeys = keyOrder.filter((k) => {
        const va = pa[k] === undefined ? undefined : JSON.stringify(pa[k]);
        const vb = pb[k] === undefined ? undefined : JSON.stringify(pb[k]);
        return va !== undefined && vb !== undefined && va === vb;
      });
      for (const k of stableKeys) stable += JSON.stringify(pb[k]).length + k.length + 4;
      reorderCacheSum += stable;
      pairs += 1;
    }
    if (pairs > 0) {
      console.log(`相邻对 ${pairs} 组：`);
      console.log(`  当前载荷内可命中前缀均值: ${fmtBytes(Math.round(curCacheSum / pairs))}（占载荷 ${Math.round((curCacheSum / pairs / (payloadSum / pairs)) * 100)}%）`);
      console.log(`  稳定块前置重排后理论上限: ${fmtBytes(Math.round(reorderCacheSum / pairs))}（占载荷 ${Math.round((reorderCacheSum / pairs / (payloadSum / pairs)) * 100)}%）`);
    }

    // attempts 用量
    let hit = 0; let miss = 0; let pt = 0; let calls2 = 0;
    for (const c of s) {
      for (const at of attemptByCall.get(c.id) || []) {
        if (at.promptAttemptNo !== 1) continue;
        hit += at.promptCacheHitTokens || 0;
        miss += at.promptCacheMissTokens || 0;
        pt += at.promptTokens || 0;
        calls2 += 1;
      }
    }
    if (calls2) {
      const lastMsgs = (attemptByCall.get(s[s.length - 1].id) || []).find((x) => x.promptAttemptNo === 1)?.messageCount;
      console.log(`  首attempt 用量: prompt均值 ${Math.round(pt / calls2)} tok, hit均值 ${Math.round(hit / calls2)} tok (${Math.round((hit / Math.max(pt, 1)) * 100)}%), miss均值 ${Math.round(miss / calls2)} tok; 末回合 messageCount=${lastMsgs}`);
    }
  }

  // C. 零缓存 skill 抽样
  console.log('\n=== 零缓存上报 skill 抽样（最近 5 条/each）===');
  for (const skill of ZERO_CACHE_SKILLS) {
    const rows = (await prisma.prompt_call_logs.findMany({
      where: { agentId: skill },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, providerId: true, model: true, createdAt: true },
    })) as Array<{ id: string; providerId: string | null; model: string | null; createdAt: Date }>;
    if (!rows.length) { console.log(`${skill}: 无记录`); continue; }
    let withAttempts = 0; let hitSum = 0; let ptSum = 0;
    for (const r of rows) {
      const ats = (await prisma.llm_execution_attempts.findMany({ where: { promptCallId: r.id } })) as unknown as AttemptRow[];
      if (ats.length) withAttempts += 1;
      for (const at of ats) { hitSum += at.promptCacheHitTokens || 0; ptSum += at.promptTokens || 0; }
      if (r === rows[0]) console.log(`  ${skill} 最新: provider=${r.providerId} model=${r.model} ${r.createdAt.toISOString().slice(0, 16)}`);
    }
    console.log(`    5条中 ${withAttempts} 条有 attempts; hit合计 ${hitSum}/${ptSum} tok`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
