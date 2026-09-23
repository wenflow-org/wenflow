/**
 * material:check —— material-collector 的**真跑**冒烟（真实 search / fetch / LLM，不走 mock）。
 *
 * 用法：
 *   cd backend && npx ts-node --transpile-only src/scripts/check-material-collector.ts
 *
 * 目的：用真实案例回答"网络搜索/抓取接进 goal→path 后到底能不能拿到可引用的资料"。
 * 重点看两件事：
 *   1) 权威文档（《3-6 岁儿童学习与发展指南》）能否取到正文并抽出**带引文**的要点；
 *   2) 不存在的资料是否**显式 not_found**（不得用模型记忆冒充）。
 */

import 'dotenv/config';
import { collectMaterialPack, type MaterialPackResult } from '../skills/material-collector';

interface Case {
  label: string;
  /** 传给 collectMaterialPack 的选项覆盖（用于 A/B 隔离） */
  options?: Record<string, unknown>;
  need: {
    kind?: string;
    title: string;
    publisher?: string;
    why?: string;
    queries?: string[];
  };
  expect: string;
}

const CASES: Case[] = [
  {
    label: 'A · 用户 demo：3-6 岁儿童学习与发展指南（真实权威文档）',
    need: {
      kind: 'standard',
      title: '3-6岁儿童学习与发展指南',
      publisher: '中华人民共和国教育部',
      why: '用户想系统学这本指南的内容；模型只知道它存在，不知道具体内容，路径设计必须依赖原文',
      queries: ['3-6岁儿童学习与发展指南 全文 教育部', '3-6岁儿童学习与发展指南 五大领域 目标'],
    },
    expect: 'ok 或 partial：pack 非空 + keyPoints 每条带 cite/sourceUrl',
  },
  {
    label: 'A2 · 同一案例、但**关闭逐字引文校验**（隔离"引文校验是否就是瓶颈"）',
    need: {
      kind: 'standard',
      title: '3-6岁儿童学习与发展指南',
      publisher: '中华人民共和国教育部',
      why: '同一需求，唯一变量 = verifyQuotes=false：若这里能出 pack，说明瓶颈是引文逐字校验过严',
      queries: ['3-6岁儿童学习与发展指南 全文 教育部', '3-6岁儿童学习与发展指南 五大领域 目标'],
    },
    options: { verifyQuotes: false },
    expect: '若 ok/partial ⇒ 瓶颈在引文校验；若仍 not_found ⇒ 瓶颈在抓取/抽取本身',
  },
  {
    label: 'B · 对照：不存在的资料（幻觉防护）',
    need: {
      kind: 'standard',
      title: '火星温室农业种植国家标准 2099',
      publisher: '不存在的机构',
      why: '验证"取不到就显式 not_found"，不允许用模型记忆编造内容',
    },
    expect: 'not_found：pack=null，notes 说明原因',
  },
];

function render(c: Case, result: MaterialPackResult, elapsedMs: number): void {
  const pack = (result as unknown as { pack?: Record<string, unknown> | null }).pack || null;
  const keyPoints = Array.isArray((pack as { keyPoints?: unknown[] } | null)?.keyPoints)
    ? ((pack as { keyPoints: Array<Record<string, unknown>> }).keyPoints)
    : [];
  const sections = Array.isArray((pack as { sections?: unknown[] } | null)?.sections)
    ? ((pack as { sections: Array<Record<string, unknown>> }).sections)
    : [];

  console.log(`\n──── ${c.label} ────`);
  console.log(`  期望：${c.expect}`);
  console.log(`  结果：status=${result.status}  ${elapsedMs}ms  ${result.status === 'not_found' ? '（未取到可用资料，未编造 ✅）' : ''}`);

  if (pack) {
    console.log(`  资料：${String(pack.title ?? '-')}  |  出版方=${String(pack.publisher ?? '-')}`);
    console.log(`  来源：tier=${String(pack.sourceTier ?? '-')}  version=${String(pack.version ?? '-')}  license=${String(pack.license ?? '-')}`);
    console.log(`  URL ：${String(pack.sourceUrl ?? '-')}`);
    console.log(`  摘要：${String(pack.tldr ?? '-').slice(0, 120)}`);
    console.log(`  章节 ${sections.length} 个：${sections.slice(0, 6).map((s) => String(s.title ?? '')).join(' / ')}`);
    console.log(`  要点 ${keyPoints.length} 条（含引文校验），前 3 条：`);
    for (const point of keyPoints.slice(0, 3)) {
      const cite = String(point.cite ?? '').replace(/\s+/g, ' ').slice(0, 90);
      console.log(`    · ${String(point.text ?? '').slice(0, 90)}`);
      console.log(`      ↳ 引文：${cite}…`);
    }
  }
  const coverage = (result as { coverage?: { covered?: unknown[]; missing?: unknown[] } }).coverage;
  if (coverage) {
    console.log(`  覆盖：covered=${coverage.covered?.length ?? 0} missing=${coverage.missing?.length ?? 0}`);
  }
  const notes = (result as { notes?: unknown[] }).notes;
  if (Array.isArray(notes) && notes.length > 0) {
    console.log(`  退化台账：${notes.slice(0, 4).map((n) => String(n).slice(0, 100)).join(' | ')}`);
  }
}

async function main(): Promise<void> {
  for (const c of CASES) {
    const startedAt = Date.now();
    try {
      const result = await collectMaterialPack(c.need as never, { maxSources: 3, ...(c.options || {}) } as never);
      render(c, result, Date.now() - startedAt);
    } catch (error) {
      console.log(`\n──── ${c.label} ────`);
      console.log(`  THREW ${error instanceof Error ? error.message : String(error)}（${Date.now() - startedAt}ms）`);
    }
  }
}

main().catch((error: unknown) => {
  console.error('[material:check] FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
