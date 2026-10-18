/* eslint-disable @typescript-eslint/no-explicit-any -- 一次性补打脚本：results 行字段随样本形态变化（对齐 verify / eval 系列先例） */
/**
 * retry-empty-bare2.ts — 补打 v2：修复「补打拿不到原文」缺陷
 * v1 从 samples.jsonl 取 text，但该文件落盘时剥掉了原文 → 6 条补打实际发的是空文本，
 * 模型回「你没发内容」。v2 从 DB 现取原文（路径树/逐字稿格式化函数与主脚本同源）。
 * 判定需补打：answer 为空，或 answer 命中「没看到/没有贴/没发/看不到你/没有附上」无内容模式。
 * 就地更新 results.jsonl 并重建 bare-review-20261011.md。
 */
import fs from 'node:fs';
import path from 'node:path';
// node:sqlite 属 Node 22 实验 API，本仓库 @types/node 尚未声明；运行时可 require 到。
// eslint-disable-next-line @typescript-eslint/no-require-imports -- 实验 API 无类型声明，import 无法表达运行时存在性
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };
import apiConfigService from '../services/apiConfig.service';
import { fmtPathTree, fmtTranscript } from './bare-review-20261011';

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '..', 'doc', 'local', 'runs', '20261011', 'vl-evals', 'bare-review-20261011');
const RESULTS = path.join(OUT, 'results.jsonl');
const NO_CONTENT = /没有?看到|没有?贴|没发|看不到你|没有?附上|请把.{0,8}(发|贴|上传)/;

async function main() {
  const results: any[] = fs.readFileSync(RESULTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const redo = results.filter((r) => !r.answer || NO_CONTENT.test(r.answer || ''));
  console.log(`需补打 ${redo.length} 条（answer 空 或 命中无内容模式）`);
  const db = new DatabaseSync(path.join(ROOT, 'prisma', 'dev.db'), { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000');
  const textOf = (r: any) => r.kind === 'path' ? fmtPathTree(db, r.id) : fmtTranscript(db, r.id);

  const cfg = await apiConfigService.getConfig();
  const base = String(cfg.apiUrl || '').replace(/\/$/, '');
  const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  for (const [i, r] of redo.entries()) {
    const text = textOf(r);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: r.model, temperature: 0.3, max_tokens: 8000, messages: [{ role: 'user', content: `${text}\n\n${r.question}` }] }),
          signal: AbortSignal.timeout(240_000),
        });
        const raw = await res.text();
        let j: any = {}; try { j = JSON.parse(raw); } catch { /* 非JSON */ }
        r.httpStatus = res.status;
        const choice = j.choices?.[0];
        r.diag = { bodyBytes: raw.length, finishReason: choice?.finish_reason ?? null, completionTokens: j.usage?.completion_tokens ?? null };
        if (res.ok && choice?.message?.content && String(choice.message.content).trim().length > 200) {
          r.answer = String(choice.message.content).trim();
          console.log(`[${i + 1}/${redo.length}] ${r.title.slice(0, 20)} → ${r.answer.length} 字（第 ${attempt} 次，原文 ${text.length} 字）`);
          break;
        }
        console.log(`[${i + 1}/${redo.length}] ${r.title.slice(0, 20)} HTTP ${res.status} finish=${r.diag.finishReason} tokens=${r.diag.completionTokens}${attempt < 3 ? '，20s 重试' : ''}`);
      } catch (e: any) {
        console.log(`[${i + 1}/${redo.length}] ${e.message}${attempt < 3 ? '，20s 重试' : ''}`);
      }
      if (attempt < 3) await new Promise((rr) => setTimeout(rr, 20_000));
    }
    fs.writeFileSync(RESULTS, results.map((x) => JSON.stringify(x)).join('\n') + '\n');
    await new Promise((rr) => setTimeout(rr, 15_000));
  }
  db.close();

  const done = results.filter((r) => r.answer && !NO_CONTENT.test(r.answer)).length;
  const md: string[] = ['# 裸评审 · 当前数据（2026-10-11）', '',
    `- 口径：无评审提示词/无角色/无评分维度，数据原文 + 一句「有什么问题」；无 system 消息；temperature 0.3`,
    `- 样本：路径 8 条（bucket: new-rules=新规则后再生 / stock=存量 / cohort=深度轨）+ 课堂 8 节（近 14h 完结课）`,
    `- 有效回答 ${done}/${results.length}（空回答项留有响应诊断于 results.jsonl）`,
    `- 说明：首轮 6 条遭网关 200+空体（桩形态），补打 v1 又因样本文件剥原文而空转，v2 从 DB 现取原文补齐`,
    `- 原始结果：results.jsonl（逐字）；样本清单：samples.jsonl`, ''];
  for (const r of results) {
    md.push(`\n---\n\n## [${r.kind === 'path' ? '路径' : '课堂'}｜${r.bucket || '-'}] ${r.title}`, '', `**问**：${r.question}`, '');
    md.push(r.answer || `（无回答，HTTP ${r.httpStatus}，诊断：${JSON.stringify(r.diag || {})}）`);
  }
  fs.writeFileSync(path.join(OUT, 'bare-review-20261011.md'), md.join('\n') + '\n');
  console.log(`补打 v2 完成：有效 ${done}/${results.length}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL', e); process.exit(1); });
}
