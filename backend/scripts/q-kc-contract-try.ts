/* eslint-disable no-console */
/**
 * kc-mapper 契约离线验证（不发布、不写库）：
 *   ① 编译 core.yaml → 过守门检查（五块结构 / 字段冻结）
 *   ② 用**真实路径输入**（案例路径的 cognitiveCore + milestones + subtasks）调一次模型
 *   ③ 打印新契约产出的 KC，和库里旧契约的 KC 对比粒度
 *
 * 用法：npx ts-node --transpile-only scripts/q-kc-contract-try.ts --path=<pathId>
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { loadCoreFile } from '../src/services/prompt-lab/core-file-loader';
import { compileCoreFile, checkFiveBlockStructure, checkFieldFreeze } from '../src/services/prompt-lab/core-compiler';

const pathId = process.argv.find((a) => a.startsWith('--path='))?.slice('--path='.length) || 'lp_1790149867127_ulb8vl2';
const CJK_JOIN = /(并|且|和|还|同时|与)/;

async function main() {
  const p = prisma as any;

  // ── ① 编译 + 守门检查（纯本地，不发布） ─────────────────────────────
  const loaded = loadCoreFile('kc-mapper');
  if (!loaded?.core) { console.error('核心文件 schema 不合法', loaded?.diagnostics); process.exit(1); }
  const compiled = compileCoreFile(loaded.core, { coreVersion: 1 });
  const structure = checkFiveBlockStructure(compiled.prompt);
  const fieldFreeze = checkFieldFreeze(loaded.core, compiled.prompt);
  console.log(`编译：coreHash=${compiled.coreHash.slice(0, 12)} 长度=${compiled.prompt.length}`);
  console.log(`守门：五块结构 issues=${structure.length}  字段冻结 issues=${fieldFreeze.length}`);
  if (structure.length || fieldFreeze.length) {
    console.log('  ', JSON.stringify([...structure, ...fieldFreeze]).slice(0, 600));
  }

  // ── ② 取真实输入 ────────────────────────────────────────────────
  const path = await p.learning_paths.findUnique({ where: { id: pathId }, select: { aiPromptTemplate: true, title: true } });
  const tpl = JSON.parse(path.aiPromptTemplate);
  const cognitiveCore = tpl?.cognitiveCore ?? null;
  const milestones = await p.milestones.findMany({
    where: { learningPathId: pathId }, orderBy: { order: 'asc' },
    select: { title: true, coreConceptName: true, description: true },
  });
  const subtasks = await p.subtasks.findMany({
    where: { milestones: { learningPathId: pathId } }, orderBy: { order: 'asc' },
    select: { title: true, taskType: true, linkedConceptName: true, knowledgeType: true, cognitiveLevel: true },
  });
  console.log(`\n输入：${path.title}  概念=${(cognitiveCore?.coreConcepts || []).length} 里程碑=${milestones.length} 子任务=${subtasks.length}`);

  const payload = { cognitiveCore, milestones, subtasks, prerequisiteTree: null };

  // ── ③ 调用（与生产同参：temperature 0.3） ──────────────────────────
  const base = (process.env.AI_API_URL || '').replace(/\/$/, '');
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'deepseek-v4-flash',
      temperature: 0.3,
      max_tokens: 8000,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: compiled.body },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  });
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content ?? '';
  console.log(`模型：served=${j?.model} http=${r.status} 输出长度=${text.length}`);
  if (!text) { console.log('空输出：', JSON.stringify(j).slice(0, 300)); return; }

  let parsed: any = null;
  try {
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    parsed = JSON.parse(text.slice(s, e + 1));
  } catch (err) { console.log('JSON 解析失败：', String(err).slice(0, 200)); console.log(text.slice(0, 400)); return; }

  const nameOf = new Map<string, string>();
  for (const n of parsed?.kcGraph?.nodes || []) nameOf.set(String(n.kcId), String(n.name));
  const groups: any[] = Array.isArray(parsed?.conceptKcs) ? parsed.conceptKcs : [];
  const names: string[] = [];
  console.log('\n### 新契约产出');
  for (const g of groups) {
    const ks = (g?.kcs || []).map((k: any) => String(k.name ?? nameOf.get(String(k.kcId)) ?? '?'));
    console.log(`  [${g?.conceptId}] ${ks.join(' → ')}`);
    names.push(...ks);
  }
  const lens = names.map((n) => n.length);
  const compound = names.filter((n) => CJK_JOIN.test(n));
  const quoted = names.filter((n) => /[「」『』“”]/.test(n));
  console.log(`\nKC 数=${names.length}  长度：中位 ${lens.sort((a, b) => a - b)[Math.floor(lens.length / 2)]} 最长 ${Math.max(...lens)}`);
  console.log(`含并列连接=${compound.length}  含引号原文=${quoted.length}  >12 字=${names.filter((n) => n.length > 12).length}`);
  if (compound.length) console.log('  并列：' + compound.join('、'));

  // 任务→KC 的复用形态：这才是「能力 vs 步骤」的判据
  const links: any[] = Array.isArray(parsed?.taskKcLinks) ? parsed.taskKcLinks : [];
  const kcUse = new Map<string, string[]>();
  console.log('\n### 任务 → KC（新契约）');
  for (const l of links) {
    const ids: string[] = l?.linkedKCs ?? l?.kcIds ?? l?.kcs ?? [];
    console.log(`  · ${String(l?.taskTitle ?? '?').slice(0, 26)} → [${ids.length}] ${ids.map((i) => nameOf.get(String(i)) ?? i).join(' / ')}`);
    for (const i of ids) {
      const b = kcUse.get(String(i)) ?? [];
      b.push(String(l?.taskTitle ?? '?'));
      kcUse.set(String(i), b);
    }
  }
  const sharedNew = [...kcUse.entries()].filter(([, t]) => t.length > 1);
  console.log(`  被 >1 任务共用：${sharedNew.length}/${kcUse.size}  （旧契约：${(() => {
    const oldLinks: any[] = Array.isArray(tpl?.kcAnnotation?.taskKcLinks) ? tpl.kcAnnotation.taskKcLinks : [];
    const u = new Map<string, number>();
    for (const l of oldLinks) for (const i of (l?.linkedKCs ?? l?.kcIds ?? l?.kcs ?? [])) u.set(String(i), (u.get(String(i)) ?? 0) + 1);
    return `${[...u.values()].filter((c) => c > 1).length}/${u.size}`;
  })()}）`);
  for (const [id, tasks] of sharedNew) console.log(`    ★ ${nameOf.get(id)} ← ${tasks.length} 任务`);

  // ── 与库里旧契约对比 ──────────────────────────────────────────────
  const oldGroups: any[] = Array.isArray(tpl?.kcAnnotation?.conceptKcs) ? tpl.kcAnnotation.conceptKcs : [];
  const oldNames: string[] = [];
  const oldNameOf = new Map<string, string>();
  for (const n of tpl?.kcAnnotation?.kcGraph?.nodes || []) oldNameOf.set(String(n.kcId), String(n.name));
  for (const g of oldGroups) for (const k of g?.kcs || []) oldNames.push(String(k?.name ?? oldNameOf.get(String(k?.kcId)) ?? '?'));
  const oldLens = oldNames.map((n) => n.length).sort((a, b) => a - b);
  console.log(`\n### 旧契约（库里现存）`);
  console.log(`KC 数=${oldNames.length}  长度：中位 ${oldLens[Math.floor(oldLens.length / 2)]} 最长 ${Math.max(...oldLens)}  含并列=${oldNames.filter((n) => CJK_JOIN.test(n)).length}  >12 字=${oldNames.filter((n) => n.length > 12).length}`);
}
main().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
