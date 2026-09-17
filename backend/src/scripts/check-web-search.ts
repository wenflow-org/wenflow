/**
 * search:check —— 网页搜索冒烟脚本（验证外挂能力 web-search 可真实调用）。
 *
 * 用法：
 *   npm --prefix backend run search:check
 *   npm --prefix backend run search:check -- "TinyFish 搜索 API"
 *
 * 退出码：成功 0；失败 1（并打印 SearchError 的 code，便于区分未配置 / 上游故障）。
 */

import 'dotenv/config';
import { searchWeb, SearchError } from '../services/search';

function readQueryArg(): string {
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
  return positional?.trim() || 'latest AI news today';
}

async function main(): Promise<void> {
  const query = readQueryArg();
  const startedAt = Date.now();
  const result = await searchWeb({ query, maxResults: 5 });

  console.log(
    `[search:check] OK provider=${result.provider} 命中 ${result.results.length} 条` +
      `（尝试链 ${result.attempts.join(' -> ') || '-'}，${Date.now() - startedAt}ms）`
  );
  for (const item of result.results) {
    console.log(`  ${item.position}. ${item.title}`);
    console.log(`     ${item.url}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof SearchError) {
    console.error(`[search:check] FAIL ${error.code}: ${error.message}`);
  } else {
    console.error(`[search:check] FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
