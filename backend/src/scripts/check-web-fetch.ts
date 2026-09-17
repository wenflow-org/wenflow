/**
 * fetch:check —— 网页抓取冒烟脚本（验证外挂能力 web-fetch 可真实调用）。
 *
 * 用法：
 *   npm --prefix backend run fetch:check
 *   npm --prefix backend run fetch:check -- https://example.com
 *
 * 退出码：成功 0；失败 1（并打印 FetchError 的 code，便于区分未配置 / 上游故障）。
 */

import 'dotenv/config';
import { fetchWeb, FetchError } from '../services/fetch';

function readUrlArg(): string {
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
  return positional?.trim() || 'https://example.com';
}

async function main(): Promise<void> {
  const url = readUrlArg();
  const startedAt = Date.now();
  const result = await fetchWeb({ urls: [url], format: 'markdown' }, { signal: undefined });

  console.log(
    `[fetch:check] OK provider=${result.provider} 抓取 ${result.results.length}/${result.results.length + result.errors.length} 条` +
      `（尝试链 ${result.attempts.join(' -> ') || '-'}，${Date.now() - startedAt}ms）`
  );
  for (const item of result.results) {
    const chars = typeof item.text === 'string' ? item.text.length : '[结构化]';
    console.log(`  ${item.url}`);
    console.log(`     title=${item.title ?? '-'} 字数=${chars} 可疑=${item.suspicious ? '是' : '否'}`);
  }
  for (const item of result.errors) {
    console.log(`  FAILED ${item.url} -> ${item.code}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof FetchError) {
    console.error(`[fetch:check] FAIL ${error.code}: ${error.message}`);
  } else {
    console.error(`[fetch:check] FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
