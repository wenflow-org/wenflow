/**
 * mcp:check —— 真 MCP 客户端冒烟 + 同源差分测试。
 *
 * 目的（Phase 0 试点）：
 *   1. 验证 McpClient 能对真 MCP server 完成 initialize / tools/list / tools/call；
 *   2. 用「同一 provider 的 REST 通道」做对照，diff 两条通道的结果集合与延迟
 *      （公益 Tavily 同时提供 /mcp 与 /api/tavily/search，且同一底层引擎）。
 *
 * 用法：
 *   npm --prefix backend run mcp:check
 *   npm --prefix backend run mcp:check -- "Tavily search API"
 *
 * 环境变量：
 *   MCP_ENDPOINT   默认 https://tavily.fuhuagoogle.top/mcp
 *   MCP_API_KEY    缺省回退 TAVILY_API_KEY
 *   TAVILY_API_URL REST 对照端点，默认 https://tavily.fuhuagoogle.top/api/tavily/search
 *   MCP_TOOL       默认 tavily_search
 *
 * 退出码：成功 0；失败 1。
 */

import 'dotenv/config';
import { McpClient, McpClientError } from '../core/mcp/McpClient';
import { safeHttpRequest } from '../utils/safe-http';

const DEFAULT_MCP_ENDPOINT = 'https://tavily.fuhuagoogle.top/mcp';
const DEFAULT_REST_ENDPOINT = 'https://tavily.fuhuagoogle.top/api/tavily/search';
const DEFAULT_TOOL = 'tavily_search';
const MAX_RESULTS = 5;

function readQueryArg(): string {
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
  return positional?.trim() || 'Tavily search API';
}

/** MCP tools/call 的正文包在 content[].text 里（通常是 JSON 字符串） */
function extractPayloadText(result: { content: Array<{ type?: string; text?: string }> }): unknown {
  for (const block of result.content || []) {
    if (typeof block?.text === 'string' && block.text.trim()) {
      try {
        return JSON.parse(block.text);
      } catch {
        return block.text;
      }
    }
  }
  return null;
}

function collectUrls(payload: unknown): string[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((item) => (item as { url?: string })?.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

function sameSet(a: string[], b: string[]): number {
  const setB = new Set(b);
  return a.filter((url) => setB.has(url)).length;
}

async function main(): Promise<void> {
  const endpoint = (process.env.MCP_ENDPOINT || DEFAULT_MCP_ENDPOINT).trim();
  const apiKey = (process.env.MCP_API_KEY || process.env.TAVILY_API_KEY || '').trim();
  const restEndpoint = (process.env.TAVILY_API_URL || DEFAULT_REST_ENDPOINT).trim();
  const toolName = (process.env.MCP_TOOL || DEFAULT_TOOL).trim();
  const query = readQueryArg();

  if (!apiKey) {
    console.error('[mcp:check] FAIL 缺少 MCP_API_KEY / TAVILY_API_KEY');
    process.exitCode = 1;
    return;
  }

  console.log(`[mcp:check] endpoint=${endpoint}`);
  console.log(`[mcp:check] query="${query}"`);

  /* ---------- ① MCP 通道 ---------- */
  const client = new McpClient({ endpoint, apiKey, timeoutMs: 90_000 });
  const mcpStarted = Date.now();
  const handshake = await client.initialize();
  console.log(
    `[mcp:check] initialize OK protocol=${handshake.protocolVersion || '-'}` +
      ` server=${handshake.serverInfo?.name || '-'}@${handshake.serverInfo?.version || '-'}` +
      ` session=${client.session ? '有' : '无'}（${Date.now() - mcpStarted}ms）`
  );

  const tools = await client.listTools();
  console.log(`[mcp:check] tools/list 命中 ${tools.length} 个：${tools.map((t) => t.name).join(', ')}`);

  const mcpCallStarted = Date.now();
  const callResult = await client.callTool(toolName, { query, max_results: MAX_RESULTS });
  const mcpLatency = Date.now() - mcpCallStarted;
  const mcpPayload = extractPayloadText(callResult);
  const mcpUrls = collectUrls(mcpPayload);
  console.log(
    `[mcp:check] tools/call ${toolName} OK isError=${callResult.isError}` +
      ` 结果 ${mcpUrls.length} 条（${mcpLatency}ms）`
  );
  for (const url of mcpUrls.slice(0, 3)) console.log(`    - ${url}`);

  /* ---------- ② REST 对照通道 ---------- */
  const restStarted = Date.now();
  const restResponse = await safeHttpRequest<{ results?: Array<{ url?: string }> }>(restEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: { query, max_results: MAX_RESULTS },
    responseType: 'json',
    timeoutMs: 90_000,
    privateNetworkPolicy: 'public-only',
  });
  const restLatency = Date.now() - restStarted;
  if (restResponse.status < 200 || restResponse.status >= 300) {
    console.error(
      `[mcp:check] REST 对照失败 HTTP ${restResponse.status}：${JSON.stringify(restResponse.data).slice(0, 200)}`
    );
    console.error('[mcp:check] 差分跳过（REST 通道未取到有效对照）');
    return;
  }
  const restUrls = collectUrls(restResponse.data);
  console.log(`[mcp:check] REST 对照 OK 结果 ${restUrls.length} 条（${restLatency}ms）`);

  /* ---------- ③ 差分 ---------- */
  const overlap = sameSet(mcpUrls, restUrls);
  const onlyMcp = mcpUrls.filter((url) => !restUrls.includes(url));
  const onlyRest = restUrls.filter((url) => !mcpUrls.includes(url));
  console.log(
    `[mcp:check] 差分：交集 ${overlap}/${Math.max(mcpUrls.length, restUrls.length)}` +
      ` · 仅 MCP ${onlyMcp.length} · 仅 REST ${onlyRest.length}`
  );
  if (onlyMcp.length) console.log(`    仅 MCP: ${onlyMcp.join(', ')}`);
  if (onlyRest.length) console.log(`    仅 REST: ${onlyRest.join(', ')}`);
}

main().catch((error: unknown) => {
  if (error instanceof McpClientError) {
    console.error(`[mcp:check] FAIL ${error.code}: ${error.message}`);
  } else {
    console.error(`[mcp:check] FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
