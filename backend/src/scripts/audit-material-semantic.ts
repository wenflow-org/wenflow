/**
 * material:semantic:audit —— 用**真实资料库**审计语义层，定位问题（只读，不写用户目录）。
 *
 * 两段：
 *   ① 静态全量扫描（不调模型）：把所有真实资料跑一遍分块，报结构问题
 *      （无正文 / 切不出块 / 单块超上游上限 / 命中块数上限导致尾部丢失 / 块数分布）。
 *   ② 抽样嵌入 + 召回自检（调模型）：对样本资料建向量并做「章节标题当查询词」的自一致检验
 *      （问该章标题，看 top-1 是否回到该章），暴露真实语料上的召回失败与延迟。
 *
 * 用法：
 *   npm --prefix backend run material:semantic:audit
 *   npm --prefix backend run material:semantic:audit -- --embed=40 --recall=3
 *   npm --prefix backend run material:semantic:audit -- --only=static
 *
 * 只读保证：嵌入侧用 buildMaterialVectorIndex（不落盘），不使用任何写侧车路径。
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { resolveMaterialsRoot, readRecord, userDirectory } from '../services/materials/material-store';
import { chunkMaterialMarkdown, MAX_MATERIAL_CHUNKS, DEFAULT_CHUNK_CHARS } from '../services/materials/material-chunker';
import { buildMaterialVectorIndex, selectDiverseChunks } from '../services/materials/material-semantic.service';
import { embedTexts, cosineSimilarity, rerankDocuments, MAX_TEXT_CHARS } from '../services/embedding';

interface MaterialRow {
  userId: string;
  id: string;
  name: string;
  origin: string;
  charCount: number;
}

interface Problem {
  level: 'high' | 'medium' | 'low';
  kind: string;
  where: string;
  detail: string;
}

/** brief 生成的输入预算（与 material-brief.service 的 BRIEF_INPUT_CHARS 同口径） */
const BRIEF_BUDGET = 24_000;

function parseArgs(): { embed: number; recall: number; only: string; rerank: boolean } {
  const arg = (name: string, fallback: number) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    const value = hit ? Number(hit.split('=')[1]) : NaN;
    return Number.isFinite(value) ? value : fallback;
  };
  const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'all';
  const rerank = ['1', 'true', 'yes'].includes((process.argv.find((a) => a.startsWith('--rerank=')) || '').split('=')[1] || '');
  return { embed: arg('embed', 30), recall: arg('recall', 3), only: onlyArg, rerank };
}

/** 枚举真实资料库里的所有资料（新目录 user_<id> 与旧目录 <id> 都覆盖）。 */
function collectMaterials(): MaterialRow[] {
  const root = path.resolve(resolveMaterialsRoot());
  if (!fs.existsSync(root)) return [];
  const rows: MaterialRow[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const userId = entry.name;
    let records: string[] = [];
    try {
      records = fs.readdirSync(path.join(root, entry.name));
    } catch {
      continue;
    }
    for (const file of records) {
      if (!file.endsWith('.json') || file.endsWith('.vectors.json')) continue;
      const id = file.slice(0, -'.json'.length);
      const record = readRecord(userId, id); // 走产品读路径（含 uuid 校验与目录回退）
      if (!record) continue;
      rows.push({
        userId,
        id,
        name: record.name,
        origin: record.origin === 'web' ? 'web' : 'upload',
        charCount: record.charCount || 0,
      });
    }
  }
  return rows;
}

/** 读正文（走产品目录约定：user_<id> 新目录；uuid 旧目录由 sanitize 后同名命中）。 */
function readMarkdown(row: MaterialRow): string {
  const rootResolved = path.resolve(resolveMaterialsRoot());
  const target = path.resolve(userDirectory(row.userId), `${row.id}.md`);
  if (!target.startsWith(rootResolved + path.sep)) return '';
  try {
    return fs.readFileSync(target, 'utf-8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const { embed, recall, only, rerank: doRerank } = parseArgs();
  const rows = collectMaterials();
  console.log(`[audit] 真实资料总数：${rows.length}`);

  const problems: Problem[] = [];
  const stats = {
    empty: 0,
    zeroChunk: 0,
    oversizeChunk: 0,
    capHit: 0,
    totalChunks: 0,
    chunkCounts: [] as number[],
    charCounts: [] as number[],
    chunkSizes: [] as number[],
  };

  if (only === 'all' || only === 'static') {
    // 命中块数上限的资料：额外用大上限重切一次，量化「因上限被丢弃的正文」
    let cappedDroppedChars = 0;
    let cappedWouldBe = 0;
    let totalKeptChars = 0;
    let totalRawChars = 0;
    const lowYield: Array<{ where: string; raw: number; kept: number }> = [];

    for (const row of rows) {
      const markdown = readMarkdown(row);
      if (!markdown.trim()) {
        stats.empty += 1;
        problems.push({ level: 'high', kind: '空正文', where: `${row.origin}/${row.name}`, detail: `记录存在但 .md 为空（${row.id}）` });
        continue;
      }
      const chunks = chunkMaterialMarkdown(markdown);
      stats.chunkCounts.push(chunks.length);
      stats.charCounts.push(markdown.length);
      stats.totalChunks += chunks.length;
      for (const chunk of chunks) stats.chunkSizes.push(chunk.charCount);
      const kept = chunks.reduce((sum, c) => sum + c.charCount, 0);
      totalKeptChars += kept;
      totalRawChars += markdown.length;

      if (markdown.length >= 500 && kept / markdown.length < 0.5) {
        lowYield.push({ where: `${row.origin}/${row.name}`, raw: markdown.length, kept });
      }

      if (chunks.length === 0) {
        stats.zeroChunk += 1;
        problems.push({ level: 'high', kind: '切不出块', where: `${row.origin}/${row.name}`, detail: `${markdown.length} 字但 0 块 → 该资料语义检索完全不可用` });
        continue;
      }
      const maxChunk = Math.max(...chunks.map((c) => c.charCount));
      if (maxChunk > MAX_TEXT_CHARS) {
        stats.oversizeChunk += 1;
        problems.push({ level: 'high', kind: '单块超上限', where: `${row.origin}/${row.name}`, detail: `最大块 ${maxChunk} 字 > 上游上限 ${MAX_TEXT_CHARS} → 建索引会整篇失败` });
      }
      if (chunks.length >= MAX_MATERIAL_CHUNKS) {
        stats.capHit += 1;
        const full = chunkMaterialMarkdown(markdown, { maxChunks: 100_000 });
        const fullKept = full.reduce((sum, c) => sum + c.charCount, 0);
        const dropped = fullKept - kept;
        cappedDroppedChars += dropped;
        cappedWouldBe += full.length;
        problems.push({
          level: 'medium', kind: '命中块数上限', where: `${row.origin}/${row.name}`,
          detail: `建议 ${full.length} 块被截到 ${MAX_MATERIAL_CHUNKS} → 丢 ${dropped} 字（${Math.round((dropped / Math.max(1, fullKept)) * 100)}% 正文不可召回）`,
        });
      }
      if (markdown.length > DEFAULT_CHUNK_CHARS && chunks.length === 1) {
        problems.push({ level: 'medium', kind: '未切开', where: `${row.origin}/${row.name}`, detail: `${markdown.length} 字仍只有 1 块（已保留 ${kept} 字，其余被当样板过滤）` });
      }
    }

    const chunkCounts = stats.chunkCounts.slice().sort((a, b) => a - b);
    const percent = (p: number) => chunkCounts[Math.min(chunkCounts.length - 1, Math.floor(chunkCounts.length * p))] ?? 0;
    console.log('\n=========== ① 静态全量扫描 ===========');
    console.log(`资料总数 ${rows.length}｜空正文 ${stats.empty}｜切不出块 ${stats.zeroChunk}｜单块超上限 ${stats.oversizeChunk}｜命中块数上限 ${stats.capHit}`);
    console.log(`块数分位：p50=${percent(0.5)} p90=${percent(0.9)} p99=${percent(0.99)} max=${chunkCounts[chunkCounts.length - 1] ?? 0}｜总块数 ${stats.totalChunks}`);
    const chars = stats.charCounts.slice().sort((a, b) => a - b);
    const cp = (p: number) => chars[Math.min(chars.length - 1, Math.floor(chars.length * p))] ?? 0;
    console.log(`字数分位：p50=${cp(0.5)} p90=${cp(0.9)} p99=${cp(0.99)} max=${chars[chars.length - 1] ?? 0}`);
    const sizes = stats.chunkSizes.slice().sort((a, b) => a - b);
    const sp = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))] ?? 0;
    const tiny = sizes.filter((s) => s < 200).length;
    console.log(`块大小分位：p10=${sp(0.1)} p50=${sp(0.5)} p90=${sp(0.9)} max=${sizes[sizes.length - 1] ?? 0}｜<200 字的碎块 ${tiny} 块（占 ${Math.round((tiny / Math.max(1, sizes.length)) * 100)}%）`);
    console.log(`因块数上限丢弃正文：${cappedDroppedChars} 字（涉及 ${stats.capHit} 份；这些资料若放开上限共 ${cappedWouldBe} 块）`);
    console.log(`全文保留率：${Math.round((totalKeptChars / Math.max(1, totalRawChars)) * 100)}%（保留 ${totalKeptChars} / 原始 ${totalRawChars} 字；差额=被样板规则过滤）`);
    console.log(`低产出比资料（保留<50%）：${lowYield.length} 份`);
    for (const row of lowYield.slice(0, 8)) {
      problems.push({ level: 'low', kind: '内容保留率低', where: row.where, detail: `原始 ${row.raw} 字仅保留 ${row.kept} 字（${Math.round((row.kept / row.raw) * 100)}%）` });
    }
  }

  if (only === 'all' || only === 'embed') {
    const sample = rows
      .filter((r) => r.charCount > 0)
      .sort((a, b) => b.charCount - a.charCount)
      .slice(0, embed);
    console.log(`\n=========== ② 抽样嵌入 + 召回自检（样本 ${sample.length}，取最大文档）===========`);

    let indexFail = 0;
    let recallOk = 0;
    let recallTotal = 0;
    let recallRerankOk = 0;
    let sampleDocs = 0;
    let sampleOk = 0;
    const latencies: number[] = [];

    for (const row of sample) {
      const markdown = readMarkdown(row);
      if (!markdown.trim()) continue;
      const started = Date.now();
      let index = null as Awaited<ReturnType<typeof buildMaterialVectorIndex>>;
      try {
        index = await buildMaterialVectorIndex(markdown);
      } catch (error) {
        indexFail += 1;
        problems.push({
          level: 'high', kind: '建索引失败', where: `${row.origin}/${row.name}`,
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!index || index.chunks.length === 0) {
        indexFail += 1;
        problems.push({ level: 'high', kind: '索引为空', where: `${row.origin}/${row.name}`, detail: `${markdown.length} 字构建后无块` });
        continue;
      }
      const latency = Date.now() - started;
      latencies.push(latency);

      // 召回自检：拿文档自己「像标题的小节」提问，看召回的块正文是否覆盖该小节
      const probes = pickProbeTitles(index.chunks, recall);
      for (const probe of probes) {
        recallTotal += 1;
        let ranked: Array<{ title: string; text: string; score: number }> = [];
        try {
          const embedded = await embedTexts({ input: probe.query });
          const queryVec = embedded.vectors[0]?.embedding ?? [];
          ranked = index.chunks
            .filter((c) => c.vector.length === queryVec.length)
            .map((c) => ({ title: c.title, text: c.text, score: cosineSimilarity(queryVec, c.vector) }))
            .sort((a, b) => b.score - a.score);
        } catch (error) {
          problems.push({ level: 'high', kind: '查询嵌入失败', where: `${row.origin}/${row.name}`, detail: error instanceof Error ? error.message : String(error) });
          continue;
        }
        const norm = (s: string) => s.replace(/^[#\s]+/, '').replace(/\s+/g, '');
        // 判据看**命中块的正文**是否含该小节文字：合并分块后块标题只代表块首小节，
        // 用标题比对会把「内容确实召回到了、只是不在块首」误判为失败
        const covers = (hits: Array<{ title: string; text: string }>) =>
          hits.some((h) => norm(h.text).includes(norm(probe.title)) || norm(h.title).includes(norm(probe.title)));

        const cosineTop3 = ranked.slice(0, 3);
        const cosineHit = covers(cosineTop3);
        if (cosineHit) recallOk += 1;

        // rerank 对照：把余弦序 top12 交给重排模型再取 top3（评估精排是否救回未命中）
        let rerankHit: boolean | null = null;
        if (doRerank && ranked.length > 1) {
          try {
            const pool = ranked.slice(0, 12);
            const reranked = await rerankDocuments({ query: probe.query, documents: pool.map((h) => h.text) });
            const ordered = reranked.results.map((r) => pool[r.index]).filter(Boolean);
            rerankHit = covers(ordered.slice(0, 3));
            if (rerankHit) recallRerankOk += 1;
          } catch {
            rerankHit = null;
          }
        }

        if (!cosineHit) {
          problems.push({
            level: 'medium', kind: '召回自检未命中', where: `${row.origin}/${row.name}`,
            detail: `问「${probe.query}」→ top1=「${cosineTop3[0]?.title ?? '无'}」(cos=${cosineTop3[0]?.score.toFixed(3) ?? '-'})${rerankHit === null ? '' : rerankHit ? '；rerank 救回' : '；rerank 也仍未命中'}`,
          });
        }
      }

      // ③ 代表采样（brief 接线点）：长文档的样本是否覆盖到文档后段。
      // 判据用**块序号分区**（不受目录页干扰）——早期用「尾部小节标题是否出现在文本里」判过，
      // 会被文档开头的目录页污染（目录里就有全部章节名），得出 sample=0/3 的假失败。
      if (markdown.length > BRIEF_BUDGET) {
        sampleDocs += 1;
        const total = index.chunks.length;
        const picked = selectDiverseChunks(index.chunks, BRIEF_BUDGET, 0.7);
        const headOnly = picked.every((c) => c.index < total / 4);
        if (headOnly) {
          problems.push({
            level: 'medium', kind: '采样退化为只取头部', where: `${row.origin}/${row.name}`,
            detail: `挑中 ${picked.length} 块全部落在前 1/4（共 ${total} 块）`,
          });
        } else {
          sampleOk += 1;
        }
        if (picked.every((c) => c.index < total * 0.75)) {
          problems.push({
            level: 'low', kind: '采样未覆盖末段', where: `${row.origin}/${row.name}`,
            detail: `挑中 ${picked.length} 块最高序号 ${Math.max(...picked.map((c) => c.index))}（共 ${total} 块）`,
          });
        }
      }
    }

    const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const max = latencies.length ? Math.max(...latencies) : 0;
    console.log(`嵌入样本 ${latencies.length} 份｜建索引失败 ${indexFail}｜建索引耗时 avg=${avg}ms max=${max}ms`);
    console.log(`召回自检（余弦 top3）：${recallOk}/${recallTotal} 命中${
      doRerank ? `｜rerank top3：${recallRerankOk}/${recallTotal} 命中` : ''
    }`);
    console.log(`代表采样（>${BRIEF_BUDGET} 字的 ${sampleDocs} 份）：跨出前 1/4 的 ${sampleOk}/${sampleDocs}（穷举「只取头部」的退化）`);
  }

  // ③ 代表采样诊断：看 MMR 到底挑了哪些块（位置分布），判断采样是否退化成「只取头部/只取中心」
  if (only === 'sample') {
    const doc = rows
      .filter((r) => r.charCount > BRIEF_BUDGET)
      .sort((a, b) => b.charCount - a.charCount)[0];
    if (!doc) {
      console.log('\n（没有超过预算的长文档）');
      return;
    }
    const markdown = readMarkdown(doc);
    const index = await buildMaterialVectorIndex(markdown);
    if (!index) {
      console.log('\n（索引构建失败）');
      return;
    }
    const picked = selectDiverseChunks(index.chunks, BRIEF_BUDGET, 0.7).sort((a, b) => a.index - b.index);
    const total = index.chunks.length;
    const coveredChars = picked.reduce((sum, c) => sum + c.charCount, 0);
    console.log(`\n=========== ③ 代表采样诊断｜${doc.name}（${markdown.length} 字 / ${total} 块）===========`);
    console.log(`挑中 ${picked.length} 块，覆盖 ${coveredChars} 字（占正文 ${Math.round((coveredChars / markdown.length) * 100)}%）`);
    console.log(`位置分布（块序号 0..${total - 1}）：${picked.map((c) => c.index).join(', ')}`);
    const inHead = picked.filter((c) => c.index < total / 4).length;
    const inMid = picked.filter((c) => c.index >= total / 4 && c.index < (total * 3) / 4).length;
    const inTail = picked.filter((c) => c.index >= (total * 3) / 4).length;
    console.log(`四分区覆盖：前1/4=${inHead} 中1/2=${inMid} 后1/4=${inTail}`);
    const hist = new Map<string, number>();
    for (const chunk of picked) {
      const key = chunk.title.replace(/^[#\s]+/, '').slice(0, 24);
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
    const ranked = Array.from(hist, ([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count);
    console.log(`独占块数 top5：${ranked.slice(0, 5).map((r) => `${r.count}×「${r.title}」`).join('｜')}`);
    console.log(`不同小节数：${ranked.length}（最多一节独占 ${ranked[0]?.count ?? 0}/${picked.length} = ${Math.round(((ranked[0]?.count ?? 0) / Math.max(1, picked.length)) * 100)}%）`);
    return;
  }

  console.log('\n=========== 问题清单 ===========');
  if (problems.length === 0) {
    console.log('（无）');
  } else {
    const order = { high: 0, medium: 1, low: 2 };
    problems.sort((a, b) => order[a.level] - order[b.level]);
    const byKind = new Map<string, number>();
    for (const p of problems) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    console.log('分类计数：' + Array.from(byKind, ([k, v]) => `${k}=${v}`).join('｜'));
    console.log('');
    for (const p of problems.slice(0, 40)) {
      console.log(`[${p.level.toUpperCase()}] ${p.kind}｜${p.where}\n      ${p.detail}`);
    }
    if (problems.length > 40) console.log(`…（其余 ${problems.length - 40} 条同类，见上方分类计数）`);
  }

  const highCount = problems.filter((p) => p.level === 'high').length;
  console.log(`\n合计问题 ${problems.length}（high=${highCount}）`);
}

/** 选几条「像标题的小节」当查询词；不像标题的（正文片段、句尾带标点、纯数字）跳过。 */
function pickProbeTitles(chunks: Array<{ title: string; charCount: number }>, count: number): Array<{ query: string; title: string }> {
  const out: Array<{ query: string; title: string }> = [];
  for (const chunk of chunks) {
    const title = String(chunk.title || '').replace(/^[#\s]+/, '').trim();
    if (!looksLikeHeading(title)) continue;
    out.push({ query: title, title: chunk.title });
    if (out.length >= count) break;
  }
  return out;
}

/**
 * 是否像「小节标题」——用于挑自检探针，避免拿正文片段/目录行当查询词造成假失败。
 * 排除：过短过长、首尾带标点、含句读（正文句）、目录行（尾部页码）、字间距标题（「内 容 简 介」）、
 * 词尾碎片（首字符小写字母）、纯数字编号。
 */
function looksLikeHeading(title: string): boolean {
  if (title.length < 4 || title.length > 24) return false;
  if (/^[。，、；：,.;:!?！？]/.test(title)) return false;
  if (/[。，；、：]/.test(title)) return false;
  if (/[\u4e00-\u9fa5][\s\u3000]+[\u4e00-\u9fa5][\s\u3000]+[\u4e00-\u9fa5]/.test(title)) return false;
  if (/\s\d{1,4}$/.test(title)) return false; // 目录行：「5.9 References 137」
  if (/^[\d.\-—、\s]+$/.test(title)) return false;
  if (/^(目录|前言|序言|说明|附录|参考|致谢)/.test(title)) return false;
  return /[\u4e00-\u9fa5]/.test(title) || /^[A-Z0-9]/.test(title);
}

main().catch((error: unknown) => {
  console.error('[material:semantic:audit] 运行失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
