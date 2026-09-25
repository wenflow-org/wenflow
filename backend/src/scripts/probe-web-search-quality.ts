/* eslint-disable no-console -- 一次性验收 CLI：面向人读的输出 */
/**
 * 联网检索质量探针（真实网络，无 LLM、无落库）——选源侧优化的前后对照工具。
 *
 * 它做什么：把 goal 的 needsMaterial 形状的资料需求交给**真实的** services/search，
 * 打印：各查询的 provider/延迟、原始候选（host/tier/文档线索分布）、
 * **旧入选**（ranked.slice(0, maxSources)）vs **新入选**（selectDiversifiedSources 同 host cap）
 * 的差异——同站多页占满名额的修复效果一目了然。
 *
 * 用法（backend/ 下）：
 *   npx ts-node --transpile-only src/scripts/probe-web-search-quality.ts \
 *     --title=3-6岁儿童学习与发展指南 --kind=指南 --publisher=教育部
 *   npx ts-node --transpile-only src/scripts/probe-web-search-quality.ts \
 *     --title="Common Core State Standards Mathematics Grade 3" --max-sources=5
 */
import 'dotenv/config';
import {
  buildQueries,
  classifySourceTier,
  detectQueryLanguage,
  documentSourceScore,
  rankSources,
  selectDiversifiedSources,
} from '../skills/material-collector';
import { searchWeb } from '../services/search';
import type { MaterialNeed } from '../skills/material-collector';

function arg(name: string): string | null {
  const hit = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function argAll(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
}

const TITLE = arg('title') || '3-6岁儿童学习与发展指南';
const KIND = arg('kind') || '';
const PUBLISHER = arg('publisher') || '';
const NEED: MaterialNeed = {
  title: TITLE,
  kind: KIND || undefined,
  publisher: PUBLISHER || undefined,
  why: '探针对照',
  queries: argAll('query'),
};
const MAX_SOURCES = Number(arg('max-sources') || 5);
const MAX_PER_HOST = Number(arg('max-per-host') || 2);
const EXPLICIT_QUERIES = argAll('query');

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 72);
}

function describeSelection(selection: ReturnType<typeof rankSources>): string[] {
  return selection.map((entry, index) => {
    const tier = classifySourceTier(entry.url, entry.title);
    const doc = documentSourceScore(entry.url, entry.title);
    return `  ${index + 1}. [tier=${tier} doc=${doc}] ${shortUrl(entry.url)}｜${entry.title.slice(0, 30)}`;
  });
}

async function main(): Promise<void> {
  const language = detectQueryLanguage(TITLE);
  const queries = EXPLICIT_QUERIES.length > 0
    ? Array.from(new Set(EXPLICIT_QUERIES)).slice(0, 5)
    : buildQueries(NEED, {});
  console.log(`[probe] 需求：${TITLE}｜语言推断=${language ?? '（不推断）'}`);
  console.log(`[probe] 查询（${queries.length} 条）：${queries.join(' ／ ')}`);
  console.log(`[probe] 入选规则：maxSources=${MAX_SOURCES}，maxPerHost=${MAX_PER_HOST}\n`);

  const candidates: import('../services/search/types').SearchResultItem[] = [];
  for (const query of queries) {
    try {
      const response = await searchWeb(
        {
          query,
          maxResults: 8,
          purpose: `采集外部权威资料：${TITLE}`,
          language: language ?? undefined,
        },
        { timeoutMs: 20_000 }
      );
      console.log(`[search] "${query}" → provider=${response.provider} ${response.latencyMs}ms ${response.results.length} 条`);
      candidates.push(...response.results);
    } catch (error) {
      console.log(`[search] "${query}" → 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const ranked = rankSources(candidates);
  if (ranked.length === 0) {
    console.log('\n[probe] 无可用候选源（检索失败或全被黑名单丢弃）');
    return;
  }

  const hostCounts = new Map<string, number>();
  for (const entry of ranked) {
    try {
      const host = new URL(entry.url).hostname;
      hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    } catch { /* 非法 URL 已被 rankSources 丢弃 */ }
  }

  console.log(`\n[probe] 候选 ${ranked.length} 条｜host 分布：`);
  for (const [host, count] of [...hostCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(count).padStart(2)}× ${host}`);
  }

  const oldSelection = ranked.slice(0, MAX_SOURCES);
  const newSelection = selectDiversifiedSources(ranked, { maxSources: MAX_SOURCES, maxPerHost: MAX_PER_HOST });

  console.log(`\n[probe] 旧入选（ranked.slice，会吃光在同站多页上）：`);
  console.log(describeSelection(oldSelection).join('\n'));
  console.log(`\n[probe] 新入选（同 host ≤${MAX_PER_HOST}）：`);
  console.log(describeSelection(newSelection).join('\n'));

  const oldHosts = new Set(oldSelection.map((entry) => entry.url));
  const gained = newSelection.filter((entry) => !oldHosts.has(entry.url));
  console.log(`\n[probe] 差异：新入选因 host cap 新进了 ${gained.length} 条：`);
  for (const entry of gained) console.log(`   + ${shortUrl(entry.url)}`);
}

void main().catch((error) => {
  console.error('[probe] 失败', error);
  process.exitCode = 1;
});
