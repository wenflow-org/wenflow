/**
 * material:ab:path-pack —— path 阶段「资料包（MaterialPack）」的语义化 A/B（真实长 web 资料）。
 *
 * 背景（2026-10-17 走查）：goal 用 brief（语义采样 24k）、learn 用按查询召回，只有 path 的资料包
 * 仍是「tldr = 正文前 1200 字 + 锚点小节/要点」。对 64 份 >24k 的联网资料，path 实际上只看到开头。
 *
 * 三臂（同一份资料、同一批探针、同一口径）：
 *   A 现状：buildPackFromMaterial 原样（tldr 头部截断 + 锚点 sections/keyPoints）
 *   B 语义 tldr：仅把 tldr 换成 selectRepresentativeText（混合采样，40% 头部 + MMR）
 *   C 语义 tldr + 语义要点：B 之上，把 keyPoints 换成 selectDiverseChunks 的 MMR 选块（同预算 24×160）
 *   D 语义 tldr + 分层 24 点
 *   E 语义 tldr + 分层 48 点
 *   G **新链路的入库半边**：入库时补 ATX 标题（normalizeWebTextStructure → parseDocument 出 anchors）+ 旧 pack
 *   F **新链路完整版**：G 的结构 + buildPackFromMaterialAsync（语义 tldr + 分层 48 点）——即生产实现
 *
 * 判据（避开目录页污染，与 ab-material-semantic 同教训）：
 *   探针只取**块正文**（去掉块首标题行）中段的 36 字片段，且该片段不得出现在全文前 1500 字里；
 *   看资料包文本（tldr + sections + keyPoints）是否包含它。late = 全文后半（块序号 ≥50%），
 *   head = 全文前 1/4（用来验证语义采样没有把开头丢掉）。
 *
 * 隔离：真实文档拷进临时沙箱再跑，对真实资料库只读。
 * 用法：npm --prefix backend run material:ab:path-pack
 *      npm --prefix backend run material:ab:path-pack -- --docs=10
 * 退出码：恒为 0（对照测量，不是门禁）。
 */

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveMaterialsRoot, readMaterial, writeMaterial, type MaterialRecord } from '../services/materials/material-store';
import { chunkMaterialMarkdown, type MaterialChunk } from '../services/materials/material-chunker';
import {
  MAX_PACK_KEY_POINTS,
  MAX_POINT_CHARS,
  MAX_TLDR_CHARS,
  buildPackFromMaterial,
  buildPackFromMaterialAsync,
} from '../services/materials/material-pack.builder';
import { parseDocument } from '../services/materials/document-parser';
import { normalizeWebTextStructure } from '../services/materials/material-web-structure';
import {
  ensureMaterialVectorIndex,
  selectDiverseChunks,
  selectRepresentativeText,
} from '../services/materials/material-semantic.service';
import type { MaterialVectorIndex } from '../services/materials/material-vector-store';

const DEFAULT_MIN_DOC_CHARS = 20_000;
const LATE_SAMPLES = 6;
const HEAD_SAMPLES = 4;
const PROBE_CHARS = 36;

interface SourceDoc {
  userId: string;
  id: string;
  name: string;
  chars: number;
  /** 在切换 MATERIAL_UPLOAD_DIR 之前读入的内存副本（切换后 readMaterial 会指向空沙箱）。 */
  record: MaterialRecord;
  markdown: string;
}

interface Row {
  name: string;
  chars: number;
  chunks: number;
  anchors: number;
  lateTotal: number;
  lateA: number;
  lateB: number;
  lateC: number;
  lateD: number;
  lateE: number;
  headTotal: number;
  headA: number;
  headB: number;
  headC: number;
  headD: number;
  headE: number;
  lateF: number;
  lateG: number;
  headF: number;
  headG: number;
  packA: number;
  packB: number;
  packC: number;
  packD: number;
  packE: number;
  packF: number;
  packG: number;
}

/** 只允许读取指定根目录内的路径：解析后校验前缀，防目录穿越。 */
function safePathWithin(root: string, ...parts: string[]): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target === base) return null;
  return target.startsWith(base + path.sep) ? target : null;
}

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = hit ? Number(hit.split('=')[1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

function flat(text: string): string {
  return String(text || '').replace(/\s+/g, '');
}

function clamp(text: string, max: number): string {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) : s;
}

/** 枚举真实库里最大的若干份联网资料（只读；优先 web origin）。 */
function collectSources(limit: number, minChars: number): SourceDoc[] {
  const root = path.resolve(resolveMaterialsRoot());
  if (!fs.existsSync(root)) return [];
  const out: SourceDoc[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const userId = entry.name;
    const dir = safePathWithin(root, userId);
    if (!dir) continue;
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith('.vectors.json')) continue;
      const jsonPath = safePathWithin(root, userId, file);
      if (!jsonPath) continue;
      const id = file.slice(0, -'.json'.length);
      let record: { name?: string; origin?: string; charCount?: number } = {};
      try {
        record = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
          name?: string;
          origin?: string;
          charCount?: number;
        };
      } catch {
        continue;
      }
      if (record.origin !== 'web') continue;
      const chars = Number(record.charCount || 0);
      if (chars < minChars) continue;
      const found = readMaterial(userId, id);
      if (!found || !found.markdown.trim()) continue;
      out.push({ userId, id, name: String(record.name || id), chars, record: found.record, markdown: found.markdown });
    }
  }
  out.sort((a, b) => b.chars - a.chars);
  if (out.length <= limit) return out;
  // 按长度做等距抽样：只取最大 10 份会全是 100k 封顶文档，样本对"中等长篇"没有代表性
  const picked: SourceDoc[] = [];
  const step = (out.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i += 1) picked.push(out[Math.round(i * step)]);
  return picked;
}

/** 把已读入内存的 record + markdown 原样拷进沙箱（保 anchors，保证 A 臂就是生产行为）。
 *  id 由 (userId, 原 id) 确定性派生：重复跑复用同一份侧车索引，不重复付嵌入成本。 */
function sandboxCopy(source: SourceDoc): { record: MaterialRecord; markdown: string } {
  const stableId = crypto.createHash('sha256').update(`${source.userId}:${source.id}`, 'utf8').digest('hex').slice(0, 32);
  const record: MaterialRecord = { ...source.record, id: stableId };
  // writeMaterial 内部按清洗后的 userId 拼目录（userDirectory），不需要也不应在这里手拼路径
  writeMaterial(record, source.markdown);
  return { record, markdown: source.markdown };
}

/**
 * 块正文（去掉块首标题行）。
 * 注意：chunk.text 含标题行，直接用会把「标题命中」当成「正文覆盖」——这是 AB-1 踩过的假阳性。
 */
function chunkBody(chunk: MaterialChunk): string {
  const titleFlat = flat(chunk.title).slice(0, 12);
  const lines = String(chunk.text || '').split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const f = flat(line);
    if (!f) continue;
    if (/^\s*#{1,6}/.test(line)) continue;
    if (titleFlat && f.startsWith(titleFlat)) continue;
    kept.push(f);
  }
  return kept.join('');
}

/**
 * 资料包是否"看到了"这个块的正文：在块正文上滑 36 字窗口（步长 12），任一窗口出现在包文本里即算覆盖。
 * 不用"块中段片段"是公平性要求：资料包本身就是**节选**（每点 ≤160 字），只会引用段落开头，
 * 拿段落中段去比会把"引了开头"误判成"没覆盖"。目录污染仍按 headFlat 过滤。
 */
function coversChunk(packText: string, body: string, headFlat: string): boolean {
  if (body.length < PROBE_CHARS) return false;
  for (let i = 0; i + PROBE_CHARS <= body.length; i += 12) {
    const window = body.slice(i, i + PROBE_CHARS);
    if (headFlat.includes(window)) continue;
    if (packText.includes(window)) return true;
  }
  return false;
}

function pickProbeChunks(chunks: MaterialChunk[], from: number, to: number, max: number): MaterialChunk[] {
  const candidates = chunks.filter((c) => c.index >= from && c.index < to && chunkBody(c).length >= PROBE_CHARS);
  if (candidates.length === 0) return [];
  const step = Math.max(1, Math.floor(candidates.length / max));
  const out: MaterialChunk[] = [];
  for (let i = 0; i < candidates.length && out.length < max; i += step) out.push(candidates[i]);
  return out;
}

function packTextOf(pack: NonNullable<ReturnType<typeof buildPackFromMaterial>['pack']>): string {
  return flat(
    [
      pack.title,
      pack.tldr,
      ...pack.sections.map((s) => `${s.title}${s.summary || ''}`),
      ...pack.keyPoints.map((k) => k.text),
    ].join('')
  );
}

function hitCount(packText: string, probes: MaterialChunk[], headFlat: string): number {
  return probes.filter((chunk) => coversChunk(packText, chunkBody(chunk), headFlat)).length;
}

/** C 臂：MMR 选块替换 keyPoints（取 24 条、每条引块正文开头 160 字，与生产同口径）。 */
function semanticKeyPoints(
  index: MaterialVectorIndex,
  docTitle: string,
  sourceUrl: string
): Array<{ text: string; cite: string; sourceUrl: string }> {
  // 预算按"块原文长度"计，所以放大到 24×1200 再截前 24 条，否则只能选到 4-5 块
  const picked = selectDiverseChunks(index.chunks, MAX_PACK_KEY_POINTS * 1200, 0.7)
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_PACK_KEY_POINTS);
  return picked.map((chunk) => {
    const body = chunkBody(chunk).slice(0, MAX_POINT_CHARS);
    return {
      text: clamp(`${docTitle}｜${chunk.title}｜${body}`, MAX_POINT_CHARS),
      cite: body,
      sourceUrl,
    };
  });
}

/** 余弦（本地实现，只用于分层臂里"取桶内最接近质心的一块"）。 */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * D 臂：**按文档位置分层**选 24 块（把全文等分成 24 段，每段取最接近质心的一块），
 * 每块引正文开头 160 字。path 要的是"每一章都知道"，而不是"全局最不重复的 24 块"——
 * MMR（C 臂）优化的是去冗余，会系统性欠采样某些区段。
 */
function stratifiedKeyPoints(
  index: MaterialVectorIndex,
  docTitle: string,
  sourceUrl: string,
  count: number = MAX_PACK_KEY_POINTS
): Array<{ text: string; cite: string; sourceUrl: string }> {
  const usable = index.chunks.filter((c) => Array.isArray(c.vector) && c.vector.length > 0).sort((a, b) => a.index - b.index);
  if (usable.length === 0) return [];
  const dims = usable[0].vector.length;
  const centroid = new Array(dims).fill(0);
  for (const chunk of usable) for (let i = 0; i < dims; i += 1) centroid[i] += chunk.vector[i] ?? 0;
  for (let i = 0; i < dims; i += 1) centroid[i] /= usable.length;

  const buckets = Math.min(count, usable.length);
  const out: Array<{ text: string; cite: string; sourceUrl: string }> = [];
  for (let b = 0; b < buckets; b += 1) {
    const from = Math.floor((b * usable.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((b + 1) * usable.length) / buckets));
    let best = usable[from];
    let bestScore = -Infinity;
    for (let i = from; i < to && i < usable.length; i += 1) {
      const score = cosine(centroid, usable[i].vector);
      if (score > bestScore) {
        bestScore = score;
        best = usable[i];
      }
    }
    if (!best) continue;
    const body = chunkBody(best).slice(0, MAX_POINT_CHARS);
    out.push({
      text: clamp(`${docTitle}｜${best.title}｜${body}`, MAX_POINT_CHARS),
      cite: body,
      sourceUrl,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const docs = Math.max(2, arg('docs', 10));
  const minChars = Math.max(1_000, arg('min', DEFAULT_MIN_DOC_CHARS));
  const sources = collectSources(docs, minChars);
  console.log(`[ab-path-pack] 候选联网资料 ${sources.length} 份（>${minChars} 字）`);

  // 持久沙箱缓存：同一份资料重复跑复用侧车索引；--fresh=1 清空重建
  const fresh = process.argv.includes('--fresh=1') || process.argv.includes('--fresh');
  const tmpRoot = path.join(os.tmpdir(), 'wf-ab-pack-cache');
  if (fresh) fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.MATERIAL_UPLOAD_DIR = tmpRoot;
  const rows: Row[] = [];
  const startedAt = Date.now();

  try {
    for (const source of sources) {
      const copied = sandboxCopy(source);
      const { record, markdown } = copied;
      const chunks = chunkMaterialMarkdown(markdown);
      if (chunks.length < 6) continue;

      const headFlat = flat(markdown.slice(0, 1500));
      const half = Math.floor(chunks.length / 2);
      const quarter = Math.max(1, Math.floor(chunks.length / 4));
      const lateProbes = pickProbeChunks(chunks, half, chunks.length, LATE_SAMPLES);
      const headProbes = pickProbeChunks(chunks, 0, quarter, HEAD_SAMPLES);
      if (lateProbes.length === 0) continue;

      // A：生产原样
      const resultA = buildPackFromMaterial(record, markdown);
      if (!resultA.pack) continue;
      const packA = resultA.pack;

      // B：语义 tldr（先确保索引存在，B/C 共用）
      const index = await ensureMaterialVectorIndex(record, markdown, { timeoutMs: 60_000 });
      if (!index) {
        console.warn(`[ab-path-pack] ${source.name}: 索引构建失败，跳过`);
        continue;
      }
      const sampled = await selectRepresentativeText(record, markdown, MAX_TLDR_CHARS, { timeoutMs: 30_000 });
      const packB = { ...packA, tldr: sampled || packA.tldr };
      // C：B + MMR 要点
      const packC = {
        ...packB,
        keyPoints: semanticKeyPoints(index, packA.title, packA.sourceUrl),
      };
      // D：B + 分层覆盖要点（24 条，生产预算）
      const packD = {
        ...packB,
        keyPoints: stratifiedKeyPoints(index, packA.title, packA.sourceUrl),
      };
      // E：分层要点扩到 48 条（测"点数上限"是不是瓶颈）
      const packE = {
        ...packB,
        keyPoints: stratifiedKeyPoints(index, packA.title, packA.sourceUrl, 48),
      };

      // G/F：新链路的入库半边——扁平正文补 ATX 标题后重新解析，拿到真实 anchors
      const structured = normalizeWebTextStructure(markdown);
      const reparsed = await parseDocument(Buffer.from(structured.markdown, 'utf-8'), 'web-source.md');
      const normalizedRecord = reparsed.status === 'ok'
        ? { ...record, anchors: reparsed.anchors, structure: reparsed.structure, charCount: reparsed.charCount }
        : record;
      const resultG = buildPackFromMaterial(normalizedRecord, markdown);
      if (!resultG.pack) continue;
      const packG = resultG.pack;
      // F = 生产实现（语义 tldr + 分层 48 点；复用已建索引，避免重复嵌入）
      const resultF = await buildPackFromMaterialAsync(normalizedRecord, markdown, { index });
      if (!resultF.pack) continue;
      const packF = resultF.pack;

      const textA = packTextOf(packA);
      const textB = packTextOf(packB);
      const textC = packTextOf(packC);
      const textD = packTextOf(packD);
      const textE = packTextOf(packE);
      const textF = packTextOf(packF);
      const textG = packTextOf(packG);

      const row: Row = {
        name: source.name.slice(0, 28),
        chars: markdown.length,
        chunks: chunks.length,
        anchors: (record.anchors || []).length,
        lateTotal: lateProbes.length,
        lateA: hitCount(textA, lateProbes, headFlat),
        lateB: hitCount(textB, lateProbes, headFlat),
        lateC: hitCount(textC, lateProbes, headFlat),
        lateD: hitCount(textD, lateProbes, headFlat),
        lateE: hitCount(textE, lateProbes, headFlat),
        headTotal: headProbes.length,
        headA: hitCount(textA, headProbes, headFlat),
        headB: hitCount(textB, headProbes, headFlat),
        headC: hitCount(textC, headProbes, headFlat),
        headD: hitCount(textD, headProbes, headFlat),
        headE: hitCount(textE, headProbes, headFlat),
        lateF: hitCount(textF, lateProbes, headFlat),
        lateG: hitCount(textG, lateProbes, headFlat),
        headF: hitCount(textF, headProbes, headFlat),
        headG: hitCount(textG, headProbes, headFlat),
        packA: textA.length,
        packB: textB.length,
        packC: textC.length,
        packD: textD.length,
        packE: textE.length,
        packF: textF.length,
        packG: textG.length,
      };
      rows.push(row);
      console.log(
        `[ab-path-pack] ${row.name.padEnd(28)} ${String(row.chars).padStart(6)}字 ` +
          `锚点${String(row.anchors).padStart(3)} 块${String(row.chunks).padStart(3)} ` +
          `A ${row.lateA}/${row.lateTotal} | E ${row.lateE}/${row.lateTotal} | ` +
          `G ${row.lateG}/${row.lateTotal} | F ${row.lateF}/${row.lateTotal} ` +
          `(${((Date.now() - startedAt) / 1000).toFixed(0)}s)`
      );
    }
  } finally {
    // 沙箱保留为索引缓存（同一份资料重复跑不重复付嵌入成本）；--fresh=1 可清空
  }

  if (rows.length === 0) {
    console.log('[ab-path-pack] 没有可测样本');
    return;
  }

  const sum = (pick: (r: Row) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const lateTotal = sum((r) => r.lateTotal);
  const headTotal = sum((r) => r.headTotal);
  const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '-');
  const medianChars = rows.map((r) => r.chars).sort((a, b) => a - b)[Math.floor(rows.length / 2)];

  console.log('\n=== path 资料包 A/B 对照（真实联网长文） ===');
  console.log(`样本 ${rows.length} 份｜正文中位 ${medianChars} 字`);
  console.log('臂  后半正文覆盖       前 1/4 覆盖       包体量(字)');
  console.log(
    `A   ${String(sum((r) => r.lateA)).padStart(3)}/${lateTotal} ${pct(sum((r) => r.lateA), lateTotal).padStart(6)}   ` +
      `${String(sum((r) => r.headA)).padStart(3)}/${headTotal} ${pct(sum((r) => r.headA), headTotal).padStart(6)}   ` +
      `${Math.round(sum((r) => r.packA) / rows.length)}`
  );
  console.log(
    `B   ${String(sum((r) => r.lateB)).padStart(3)}/${lateTotal} ${pct(sum((r) => r.lateB), lateTotal).padStart(6)}   ` +
      `${String(sum((r) => r.headB)).padStart(3)}/${headTotal} ${pct(sum((r) => r.headB), headTotal).padStart(6)}   ` +
      `${Math.round(sum((r) => r.packB) / rows.length)}`
  );
  console.log(
    `C   ${String(sum((r) => r.lateC)).padStart(3)}/${lateTotal} ${pct(sum((r) => r.lateC), lateTotal).padStart(6)}   ` +
      `${String(sum((r) => r.headC)).padStart(3)}/${headTotal} ${pct(sum((r) => r.headC), headTotal).padStart(6)}   ` +
      `${Math.round(sum((r) => r.packC) / rows.length)}`
  );
  console.log(
    `D   ${String(sum((r) => r.lateD)).padStart(3)}/${lateTotal} ${pct(sum((r) => r.lateD), lateTotal).padStart(6)}   ` +
      `${String(sum((r) => r.headD)).padStart(3)}/${headTotal} ${pct(sum((r) => r.headD), headTotal).padStart(6)}   ` +
      `${Math.round(sum((r) => r.packD) / rows.length)}`
  );
  console.log(
    `E   ${String(sum((r) => r.lateE)).padStart(3)}/${lateTotal} ${pct(sum((r) => r.lateE), lateTotal).padStart(6)}   ` +
      `${String(sum((r) => r.headE)).padStart(3)}/${headTotal} ${pct(sum((r) => r.headE), headTotal).padStart(6)}   ` +
      `${Math.round(sum((r) => r.packE) / rows.length)}`
  );
  console.log(
    `G   ${String(sum((r) => r.lateG)).padStart(3)}/${lateTotal} ${pct(sum((r) => r.lateG), lateTotal).padStart(6)}   ` +
      `${String(sum((r) => r.headG)).padStart(3)}/${headTotal} ${pct(sum((r) => r.headG), headTotal).padStart(6)}   ` +
      `${Math.round(sum((r) => r.packG) / rows.length)}`
  );
  console.log(
    `F   ${String(sum((r) => r.lateF)).padStart(3)}/${lateTotal} ${pct(sum((r) => r.lateF), lateTotal).padStart(6)}   ` +
      `${String(sum((r) => r.headF)).padStart(3)}/${headTotal} ${pct(sum((r) => r.headF), headTotal).padStart(6)}   ` +
      `${Math.round(sum((r) => r.packF) / rows.length)}`
  );
  console.log('\nA=现状 B=语义tldr C=语义tldr+MMR24 D=分层24 E=分层48 G=新入库结构+旧pack F=新链路（生产）');
}

main().catch((error) => {
  console.error('[ab-path-pack] 失败', error instanceof Error ? error.message : String(error));
});
