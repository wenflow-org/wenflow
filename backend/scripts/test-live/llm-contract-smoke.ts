/**
 * test:live —— 真实 LLM 契约烟测（2026-10-20）。
 *
 * 定位：单元测试锁的是代码形状，本脚本锁的是**真实上游行为**。它回答三个问题：
 *   1. 带 system 的约束到底有没有到达模型（折叠/原生两种 wire format 都算通过）；
 *   2. 多轮 history 的顺序有没有被打乱；
 *   3. 流式、JSON 模式、top_p 这些参数在上游是否被接受。
 *
 * 安全与成本：
 * - 默认 **dry-run**，只打印计划，不发请求；必须显式 `--live`（或 LIVE_LLM=1）才花钱；
 * - 每次调用 max_tokens ≤ 64，默认模型优先选最便宜的已注册 chat 模型；
 * - 全部用例合计约 5 次调用、几百 token，成本可忽略；
 * - 不写业务表（callPrompt 会写 prompt_call_logs 遥测，这是正常调用链行为）。
 *
 * 用法：
 *   npm --prefix backend run test:live:plan
 *   npm --prefix backend run test:live
 *   npm --prefix backend run test:live -- --model=deepseek-v4.1-flash --max-tokens=32
 *
 * 退出码：0 全过（软用例 unsupported 不算失败）；1 有硬用例失败；2 环境不满足。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAPIGateway } from '../../src/gateway/api-gateway';
import { getModelDefinition, MODEL_MAP } from '../../src/config/models.config';
import { callPrompt } from '../../src/composers/prompt-composer';
import type { PromptCallSpec } from '../../src/composers/types';
import prisma from '../../src/config/database';
import { telemetryWriter } from '../../src/services/telemetry-writer.service';
import { createRetryBudget } from '../../src/gateway/api-gateway/retry-budget';

type CaseStatus = 'pass' | 'fail' | 'unsupported' | 'error';

interface CaseResult {
  name: string;
  hard: boolean;
  status: CaseStatus;
  durationMs: number;
  usage?: { prompt?: number; completion?: number; total?: number };
  responseModel?: string | null;
  prompt: string;
  answerPreview: string;
  detail?: string;
}

interface ParsedArgs {
  live: boolean;
  model: string | null;
  maxTokens: number;
  outDir: string | null;
  json: boolean;
}

const SYSTEM_TOKEN = 'BLUE';
const SECRET = 'PINEAPPLE_M42';

function parseArgs(argv: string[]): ParsedArgs {
  let live = process.env.LIVE_LLM === '1';
  let model: string | null = null;
  let maxTokens = 32;
  let outDir: string | null = null;
  let json = false;
  for (const arg of argv) {
    if (arg === '--live') live = true;
    else if (arg.startsWith('--model=')) model = arg.slice('--model='.length).trim() || null;
    else if (arg.startsWith('--max-tokens=')) {
      const n = Number(arg.slice('--max-tokens='.length));
      if (Number.isFinite(n)) maxTokens = Math.max(8, Math.min(256, Math.floor(n)));
    } else if (arg.startsWith('--out=')) outDir = arg.slice('--out='.length).trim() || null;
    else if (arg === '--json') json = true;
  }
  return { live, model, maxTokens, outDir, json };
}

/** 默认挑最便宜的 chat 模型；没有价目时回落到 deepseek。 */
function pickDefaultModel(): string {
  const chat = Array.from(MODEL_MAP.values()).filter((m) => m.tier === 'chat');
  if (chat.length === 0) return 'deepseek-v4.1-flash';
  const priced = chat
    .filter((m) => typeof m.pricing?.inputPer1M === 'number')
    .sort((a, b) => (a.pricing!.inputPer1M! + (a.pricing!.outputPer1M ?? 0) * 4)
      - (b.pricing!.inputPer1M! + (b.pricing!.outputPer1M ?? 0) * 4));
  return priced[0]?.id || chat[0].id;
}

function usageOf(raw: any): CaseResult['usage'] {
  const u = raw?.usage;
  if (!u || typeof u !== 'object') return undefined;
  return {
    prompt: Number(u.prompt_tokens) || 0,
    completion: Number(u.completion_tokens) || 0,
    total: Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0),
  };
}

function preview(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * system 是否到达模型：只要回答里出现指定 token 即算通过。
 * 不要求「只有 token」——模型可以解释/拒绝，但没看到 system 时不可能凭空说出该 token。
 */
function systemArrived(text: string): boolean {
  return new RegExp(`\\b${SYSTEM_TOKEN}\\b`, 'i').test(String(text || ''));
}

function costUsd(usage: CaseResult['usage'], model: string): number | null {
  const p = getModelDefinition(model)?.pricing;
  if (!usage || !p) return null;
  const input = (usage.prompt || 0) / 1_000_000 * (p.inputPer1M ?? 0);
  const output = (usage.completion || 0) / 1_000_000 * (p.outputPer1M ?? 0);
  return input + output;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const started = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - started };
}

interface WireSnapshot {
  roles: string[];
  hasSystem: boolean;
  firstUserPreview: string;
}

async function gatewayCall(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  extra: Record<string, unknown> = {}
): Promise<{ content: string; responseModel: string | null; usage?: CaseResult['usage']; raw: any; wire?: WireSnapshot }> {
  let wireBody: any = null;
  const response: any = await getAPIGateway().execute(
    {
      model,
      temperature: 0,
      max_tokens: 32,
      messages,
      ...extra,
    } as any,
    { skillId: 'live-contract-smoke', action: 'gateway-call' } as any,
    {
      traceId: `live-smoke-${randomUUID()}`,
      // 探针不要用生产重试预算：429 时网关内部连打 4 次只会更快耗光免费额度。
      // 单次尝试 + 本脚本的 10s 退避重试，对上游更友好，也更容易定位真实契约问题。
      retryBudget: createRetryBudget({ maxTransportRetries: 0, maxUpstreamAttempts: 1 }),
      // 测试缝：直接拿到最终请求体，断言 wire format 不再靠猜
      onWireRequest: (body: any) => { wireBody = body; },
    } as any
  );
  const wire: WireSnapshot | undefined = wireBody
    ? {
        roles: Array.isArray(wireBody.messages) ? wireBody.messages.map((m: any) => String(m?.role)) : [],
        hasSystem: Array.isArray(wireBody.messages) && wireBody.messages.some((m: any) => m?.role === 'system'),
        firstUserPreview: preview(
          String(
            (Array.isArray(wireBody.messages) ? wireBody.messages.find((m: any) => m?.role === 'user')?.content : '') ?? ''
          )
        ),
      }
    : undefined;
  return {
    content: String(response?.choices?.[0]?.message?.content ?? ''),
    responseModel: response?.model ?? null,
    usage: usageOf(response),
    raw: response,
    wire,
  };
}

function errorResult(name: string, hard: boolean, prompt: string, error: unknown): CaseResult {
  const record = (error ?? {}) as { message?: string; code?: string };
  return {
    name,
    hard,
    status: 'error',
    durationMs: 0,
    prompt,
    answerPreview: '',
    detail: `${record.code ? `${record.code}: ` : ''}${record.message || String(error)}`.slice(0, 240),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 上游限流/瞬时错误重试一次（默认退避 3s）。
 * 真实烟测最常见的失败不是契约坏了，而是 429；不重试会把噪声记成红。
 */
async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 10000): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const text = `${(error as { code?: string })?.code ?? ''} ${String((error as Error)?.message || error)}`;
      const transient = /429|rate.?limit|RETRY_BUDGET_EXHAUSTED|timeout|ECONNRESET|ETIMEDOUT/i.test(text);
      if (!transient || i === attempts - 1) throw error;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function runCases(args: ParsedArgs, model: string): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const maxTokens = args.maxTokens;

  // 1) system 约束是否到达模型（硬）
  {
    const prompt = `You must reply with the single word ${SYSTEM_TOKEN} and nothing else.`;
    try {
      const { value, durationMs } = await timed(() => withTransientRetry(() => gatewayCall(model, [
        { role: 'system', content: `You are a contract probe. ${prompt}` },
        { role: 'user', content: 'Reply now.' },
      ])));
      const ok = systemArrived(value.content) && value.wire?.hasSystem === false;
      results.push({
        name: 'gateway.system_contract',
        hard: true,
        status: ok ? 'pass' : 'fail',
        durationMs,
        usage: value.usage,
        responseModel: value.responseModel,
        prompt,
        answerPreview: preview(value.content),
        detail: ok
          ? `system 文本约束被遵从；wire=[${value.wire?.roles.join(',')}]（平台通道已折叠）`
          : `期望回答包含 ${SYSTEM_TOKEN} 且平台通道折叠 system；wire=[${value.wire?.roles.join(',') ?? '未捕获'}]`,
      });
    } catch (error) {
      results.push(errorResult('gateway.system_contract', true, prompt, error));
    }
    await sleep(5000);
  }

  // 2) 多轮 history 顺序（硬）
  {
    const prompt = `The secret word is ${SECRET}.`;
    try {
      const { value, durationMs } = await timed(() => withTransientRetry(() => gatewayCall(model, [
        { role: 'system', content: `You are a memory probe. ${prompt}` },
        { role: 'user', content: 'What is the secret word?' },
        { role: 'assistant', content: 'I will answer on the next turn.' },
        { role: 'user', content: 'Now answer with the secret word only.' },
      ])));
      const ok = value.content.toUpperCase().includes(SECRET);
      results.push({
        name: 'gateway.history_secret',
        hard: true,
        status: ok ? 'pass' : 'fail',
        durationMs,
        usage: value.usage,
        responseModel: value.responseModel,
        prompt,
        answerPreview: preview(value.content),
        detail: ok
          ? `history 顺序与 system 记忆均保持；wire=[${value.wire?.roles.join(',') ?? '未捕获'}]`
          : `期望回答包含 ${SECRET}；wire=[${value.wire?.roles.join(',') ?? '未捕获'}]`,
      });
    } catch (error) {
      results.push(errorResult('gateway.history_secret', true, prompt, error));
    }
    await sleep(5000);
  }

  // 3) 流式：网关聚合后仍应有内容（硬）
  {
    const prompt = 'Count from 1 to 3, comma separated.';
    try {
      const { value, durationMs } = await timed(() => withTransientRetry(() => gatewayCall(model, [
        { role: 'user', content: prompt },
      ], { stream: true })));
      const ok = value.content.trim().length > 0;
      results.push({
        name: 'gateway.stream',
        hard: true,
        status: ok ? 'pass' : 'fail',
        durationMs,
        usage: value.usage,
        responseModel: value.responseModel,
        prompt,
        answerPreview: preview(value.content),
        detail: ok ? '流式请求被上游接受并聚合返回内容' : '流式返回空内容',
      });
    } catch (error) {
      results.push(errorResult('gateway.stream', true, prompt, error));
    }
    await sleep(5000);
  }

  // 4) JSON 模式 + top_p（软：部分上游明确不支持，记 unsupported 不算失败）
  {
    const prompt = 'Return exactly {"ok":true} as JSON.';
    try {
      const { value, durationMs } = await timed(() => withTransientRetry(() => gatewayCall(model, [
        { role: 'user', content: prompt },
      ], { response_format: { type: 'json_object' }, top_p: 0.9 })));
      let parsedOk = false;
      try {
        const parsed = JSON.parse(value.content);
        parsedOk = parsed && typeof parsed === 'object' && parsed.ok === true;
      } catch { parsedOk = false; }
      results.push({
        name: 'gateway.json_and_topp',
        hard: false,
        status: parsedOk ? 'pass' : 'fail',
        durationMs,
        usage: value.usage,
        responseModel: value.responseModel,
        prompt,
        answerPreview: preview(value.content),
        detail: parsedOk ? 'response_format 与 top_p 均被接受，返回合法 JSON' : '参数被接受但输出不是目标 JSON',
      });
    } catch (error: any) {
      const message = String(error?.message || error);
      const unsupported = /response_format|top_p|unsupported|not support|invalid.*param/i.test(message);
      results.push({
        name: 'gateway.json_and_topp',
        hard: false,
        status: unsupported ? 'unsupported' : 'error',
        durationMs: 0,
        prompt,
        answerPreview: '',
        detail: message.slice(0, 240),
      });
    }
    await sleep(5000);
  }

  // 5) 完整 composer 路径（硬）：systemOverride → buildMessages → gateway → telemetry
  {
    const prompt = `You must reply with the single word ${SYSTEM_TOKEN} and nothing else.`;
    const traceId = `live-smoke-composer-${randomUUID()}`;
    try {
      const spec: PromptCallSpec<string, { text: string }> = {
        agentId: 'live-contract-smoke',
        defaultSystemPrompt: `You are a composer probe. ${prompt}`,
        requireActivePrompt: false,
        caller: { skillId: 'live-contract-smoke', action: 'composer-call' },
        buildUserPayload: (input) => input,
        // 文本输出：必须同时给出 extractedJson（包装层以它判断「是否有可消费输出」），
        // 否则会走默认 JSON 抽取 → success=false、tokenUsage 也不落库。
        parseRawOutput: (raw) => {
          const cleaned = String(raw || '').trim();
          return cleaned
            ? { parsed: cleaned, extractedJson: cleaned }
            : { parsed: null, extractedJson: null, failureReason: 'response is empty' };
        },
        validateParsedOutput: () => ({ valid: true }),
        normalizeOutput: (parsed) => ({ text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed ?? '') }),
      };
      const { value, durationMs } = await timed(async () => {
        const result = await withTransientRetry(() => callPrompt(spec, 'Reply now.', {
          systemPromptOverride: `You are a composer probe. ${prompt}`,
          generationOverride: { model, temperature: 0, maxTokens },
          traceId,
          retryBudget: createRetryBudget({ maxTransportRetries: 0, maxUpstreamAttempts: 1 }),
        }));
        return result;
      });
      // 遥测回读：既补齐 token/模型，也验证 prompt_call_logs 真的落了这一行。
      // prompt 遥测是后台写，查询前先 flush，避免读到「还没落库」的假阴性。
      let telemetry: { tokenUsage?: string | null; model?: string | null } | null = null;
      try {
        await telemetryWriter.flush();
        telemetry = await prisma.prompt_call_logs.findFirst({
          where: { traceId },
          orderBy: { createdAt: 'desc' },
          select: { tokenUsage: true, model: true },
        });
      } catch { /* 遥测不可用不判失败 */ }
      const usage = (() => {
        if (value.debug?.tokenUsage?.total != null) return value.debug.tokenUsage;
        if (!telemetry?.tokenUsage) return undefined;
        try {
          const parsed = JSON.parse(telemetry.tokenUsage);
          return { prompt: parsed.prompt, completion: parsed.completion, total: parsed.total };
        } catch { return undefined; }
      })();
      const raw = String(value.debug?.rawModelOutput ?? '');
      const ok = systemArrived(raw);
      results.push({
        name: 'composer.full_path',
        hard: true,
        status: ok ? 'pass' : 'fail',
        durationMs,
        usage,
        responseModel: telemetry?.model ?? null,
        prompt,
        answerPreview: preview(raw),
        detail: ok
          ? `composer → gateway 全链路可用；prompt_call_logs ${telemetry ? '已落库' : '未回读到'}；success=${value.success}`
          : `期望回答包含 ${SYSTEM_TOKEN}；success=${value.success} error=${value.error?.code ?? 'none'}`,
      });
    } catch (error) {
      results.push(errorResult('composer.full_path', true, prompt, error));
    }
  }

  return results;
}

/** 本地时间戳（报告目录用；ISO 里的 UTC 日期在跨零点时容易读错）。 */
function localStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function renderMarkdown(args: ParsedArgs, model: string, results: CaseResult[], startedAt: string): string {
  const totalCost = results.reduce((sum, r) => sum + (costUsd(r.usage, model) ?? 0), 0);
  const totalTokens = results.reduce((sum, r) => sum + (r.usage?.total ?? 0), 0);
  const hardFailed = results.filter((r) => r.hard && r.status !== 'pass');
  const lines: string[] = [];
  lines.push(`# Live LLM 契约烟测报告`);
  lines.push('');
  lines.push(`- 时间：${startedAt}`);
  lines.push(`- 模型：\`${model}\`（注册表 tier/能力：${JSON.stringify({
    tier: getModelDefinition(model)?.tier ?? null,
    supportsThinking: getModelDefinition(model)?.supportsThinking ?? null,
  })}）`);
  lines.push(`- max_tokens：${args.maxTokens}`);
  lines.push(`- 结论：${hardFailed.length === 0 ? '**PASS**（硬用例全过）' : `**FAIL**（${hardFailed.length} 个硬用例未过）`}`);
  lines.push(`- 用量：${totalTokens} tokens，估算 $${totalCost.toFixed(6)}`);
  lines.push('');
  lines.push('| 用例 | 类型 | 状态 | 耗时 | tokens | 响应模型 | 回答预览 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.hard ? '硬' : '软'} | ${r.status} | ${r.durationMs}ms | ${r.usage?.total ?? '—'} | ${r.responseModel ?? '—'} | ${r.answerPreview.replace(/\|/g, '\\|') || '—'} |`);
  }
  lines.push('');
  lines.push('## 明细');
  for (const r of results) {
    lines.push(`### ${r.name} — ${r.status}`);
    lines.push(`- 提示：${r.prompt}`);
    lines.push(`- 说明：${r.detail ?? '—'}`);
    lines.push(`- 回答：${r.answerPreview || '—'}`);
    lines.push('');
  }
  lines.push('## 判读');
  lines.push('- `gateway.system_contract`：system 文本若被上游静默丢弃，模型不会输出指定 token；该用例是 2026-09-22 事故的端到端回归。');
  lines.push('- `gateway.history_secret`：验证 system + 多轮 user/assistant 的顺序没有被打乱。');
  lines.push('- `composer.full_path`：走完整 composer（systemOverride → buildMessages → gateway → 遥测），覆盖 topP/maxTokens 解析链。');
  lines.push('- `gateway.json_and_topp` 为软用例：上游明确报参数不支持时记 unsupported，不判失败。');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const model = args.model || pickDefaultModel();
  const startedAt = new Date().toISOString();

  if (!args.live) {
    console.log('[test:live] dry-run（未发请求）。将使用模型：', model);
    console.log('计划用例：gateway.system_contract / gateway.history_secret / gateway.stream / gateway.json_and_topp / composer.full_path');
    console.log('加 --live（或 LIVE_LLM=1）才会真正调用上游。');
    return;
  }

  if (!process.env.AI_API_URL || !process.env.AI_API_KEY) {
    console.error('[test:live] 缺少 AI_API_URL / AI_API_KEY，无法发真实请求');
    process.exitCode = 2;
    return;
  }

  const results = await runCases(args, model);
  const hardFailed = results.filter((r) => r.hard && r.status !== 'pass');

  if (args.json) {
    console.log(JSON.stringify({ startedAt, model, maxTokens: args.maxTokens, results }, null, 2));
  } else {
    console.table(results.map((r) => ({
      case: r.name,
      hard: r.hard,
      status: r.status,
      ms: r.durationMs,
      tokens: r.usage?.total ?? '—',
      model: r.responseModel ?? '—',
      answer: r.answerPreview,
    })));
  }

  const outDir = args.outDir
    ? path.resolve(args.outDir)
    : path.join(process.cwd(), '..', 'outputs', `test-live-${localStamp(new Date())}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ startedAt, model, maxTokens: args.maxTokens, results }, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), renderMarkdown(args, model, results, startedAt), 'utf8');
  console.log(`[test:live] 报告已写出：${outDir}`);
  await prisma.$disconnect();

  if (hardFailed.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('[test:live] 未预期异常：', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 2;
});
