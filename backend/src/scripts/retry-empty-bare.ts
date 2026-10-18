/* eslint-disable @typescript-eslint/no-explicit-any -- 一次性补打脚本：results/samples 是逐行 JSON，行的字段随样本形态变化（对齐 verify / eval 系列先例） */
/**
 * retry-empty-bare.ts — 补打裸评审空回答项（200+空体=网关桩形态）
 * 读 results.jsonl，对 answer 为空的样本重试（3 次，间隔 20s），记录响应诊断；
 * 就地更新 results.jsonl 并重建 bare-review-20261011.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import apiConfigService from '../services/apiConfig.service';

const OUT = path.join(__dirname, '..', '..', '..', 'doc', 'local', 'runs', '20261011', 'vl-evals', 'bare-review-20261011');
const RESULTS = path.join(OUT, 'results.jsonl');
const SAMPLES = path.join(OUT, 'samples.jsonl');

async function main() {
  const results: any[] = fs.readFileSync(RESULTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const samples: any[] = fs.readFileSync(SAMPLES, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const textOf = new Map(samples.map((s) => [s.id, s.text]));
  const empty = results.filter((r) => !r.answer);
  console.log(`空回答 ${empty.length} 条，补打`);
  const cfg = await apiConfigService.getConfig();
  const base = String(cfg.apiUrl || '').replace(/\/$/, '');
  const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  for (const [i, r] of empty.entries()) {
    const text = textOf.get(r.id) || '';
    // 审计 2026-10-12：无原文直接跳过——旧实现发空提示语，模型的「没收到内容」回复被当有效答案写回。
    if (!text.trim()) { console.log(`[${i + 1}/${empty.length}] 跳过 ${String(r.title || r.id).slice(0, 20)}：样本无 text（改用 retry-empty-bare2 从库取原文）`); continue; }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: r.model, temperature: 0.3, max_tokens: 2000, messages: [{ role: 'user', content: `${text}\n\n${r.question}` }] }),
          signal: AbortSignal.timeout(240_000),
        });
        const raw = await res.text();
        let j: any = {}; try { j = JSON.parse(raw); } catch { /* 非JSON */ }
        r.httpStatus = res.status;
        const choice = j.choices?.[0];
        r.diag = {
          bodyBytes: raw.length,
          finishReason: choice?.finish_reason ?? null,
          completionTokens: j.usage?.completion_tokens ?? null,
          promptTokens: j.usage?.prompt_tokens ?? null,
          errSnippet: j?.error?.message ? String(j.error.message).slice(0, 120) : null,
        };
        if (res.ok && choice?.message?.content && String(choice.message.content).trim()) {
          r.answer = String(choice.message.content).trim();
          console.log(`[${i + 1}/${empty.length}] ${r.title.slice(0, 20)} → ${r.answer.length} 字（第 ${attempt} 次）`);
          break;
        }
        console.log(`[${i + 1}/${empty.length}] ${r.title.slice(0, 20)} HTTP ${res.status} bytes=${raw.length} finish=${r.diag.finishReason} tokens=${r.diag.completionTokens}${attempt < 3 ? '，20s 重试' : ''}`);
      } catch (e: any) {
        console.log(`[${i + 1}/${empty.length}] ${e.message}${attempt < 3 ? '，20s 重试' : ''}`);
      }
      if (attempt < 3) await new Promise((rr) => setTimeout(rr, 20_000));
    }
    fs.writeFileSync(RESULTS, results.map((x) => JSON.stringify(x)).join('\n') + '\n');
    await new Promise((rr) => setTimeout(rr, 15_000));
  }

  // 重建 md
  const done = results.filter((r) => r.answer).length;
  const md: string[] = ['# 裸评审 · 当前数据（2026-10-11）', '',
    `- 口径：无评审提示词/无角色/无评分维度，数据原文 + 一句「有什么问题」；无 system 消息；temperature 0.3`,
    `- 样本：路径 8 条（bucket: new-rules=新规则后再生 / stock=存量 / cohort=深度轨）+ 课堂 8 节（近 14h 完结课）`,
    `- 有效回答 ${done}/${results.length}；空回答项记录响应诊断（finishReason/usage）于 results.jsonl`,
    `- 原始结果：results.jsonl（逐字）；样本清单：samples.jsonl`, ''];
  for (const r of results) {
    md.push(`\n---\n\n## [${r.kind === 'path' ? '路径' : '课堂'}｜${r.bucket || '-'}] ${r.title}`, '', `**问**：${r.question}`, '');
    md.push(r.answer || `（无回答，HTTP ${r.httpStatus}，诊断：${JSON.stringify(r.diag || {})}）`);
  }
  fs.writeFileSync(path.join(OUT, 'bare-review-20261011.md'), md.join('\n') + '\n');
  console.log(`补打完成：有效 ${done}/${results.length} → ${OUT}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
