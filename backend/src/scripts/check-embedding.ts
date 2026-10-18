/**
 * embedding:check —— 向量化 / 重排冒烟脚本（验证外挂能力 embedding / rerank 可真实调用）。
 *
 * 用法：
 *   npm --prefix backend run embedding:check
 *   npm --prefix backend run embedding:check -- "学习动机" "自我决定理论" "报名流程"
 *
 * 退出码：成功 0；失败 1（并打印 EmbeddingError 的 code，便于区分未配置 / 上游故障）。
 */

import 'dotenv/config';
import { embedTexts, rerankDocuments, cosineSimilarity, EmbeddingError } from '../services/embedding';

function readArgs(): { query: string; documents: string[] } {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const query = positional[0]?.trim() || '内在动机与自我决定理论';
  const documents =
    positional.length > 1
      ? positional.slice(1).map((s) => s.trim()).filter(Boolean)
      : ['自我决定理论强调自主、胜任与归属三种基本心理需要', '在线课程的报名与支付流程说明', '课堂上的认知负荷与工作记忆限制'];
  return { query, documents };
}

async function main(): Promise<void> {
  const { query, documents } = readArgs();

  const embedStartedAt = Date.now();
  const embedded = await embedTexts({ input: [query, ...documents] });
  const [queryVec, ...docVecs] = embedded.vectors;
  console.log(
    `[embedding:check] embed OK provider=${embedded.provider} model=${embedded.model} dims=${embedded.dimensions}` +
      `（尝试链 ${embedded.attempts.join(' -> ') || '-'}，${Date.now() - embedStartedAt}ms）`
  );
  for (const [index, doc] of documents.entries()) {
    const sim = cosineSimilarity(queryVec.embedding, docVecs[index].embedding);
    console.log(`  cosine(query, #${index + 1})=${sim.toFixed(4)}  ${doc}`);
  }

  const rerankStartedAt = Date.now();
  const reranked = await rerankDocuments({ query, documents });
  console.log(
    `[embedding:check] rerank OK provider=${reranked.provider} model=${reranked.model}` +
      `（尝试链 ${reranked.attempts.join(' -> ') || '-'}，${Date.now() - rerankStartedAt}ms）`
  );
  for (const hit of reranked.results) {
    console.log(`  score=${hit.relevanceScore.toFixed(4)}  #${hit.index + 1}  ${documents[hit.index]}`);
  }

  console.log('[embedding:check] PASS');
}

main().catch((error: unknown) => {
  if (error instanceof EmbeddingError) {
    console.error(`[embedding:check] FAIL ${error.code}: ${error.message}`);
  } else {
    console.error(`[embedding:check] FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
