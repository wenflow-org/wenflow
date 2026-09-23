/* eslint-disable no-console */
/**
 * KC 命名形态体检（只读）：我们的 KC 到底是"知识组件"还是"过程步骤"？
 * 用法：npx ts-node --transpile-only scripts/q-kc-shape.ts [--path=<id>] [--list]
 */
import 'dotenv/config';
import prisma from '../src/config/database';

const onlyPath = process.argv.find((a) => a.startsWith('--path='))?.slice('--path='.length) || null;
const list = process.argv.includes('--list');

const VERB_PREFIX = /^(提取|区分|定位|解释|构建|识别|对比|判断|转译|生成|复盘|拆解|整合|梳理|归纳|分析|计算|应用|理解|掌握|设计|验证|评估|推导|建立|形成|使用|选择|回捞|对照|内化|调整|拆|读|写|算)/;

async function main() {
  const p = prisma as any;
  const paths = await p.learning_paths.findMany({
    where: { aiPromptTemplate: { contains: 'kcAnnotation' }, ...(onlyPath ? { id: onlyPath } : {}) },
    select: { id: true, title: true, aiPromptTemplate: true },
    orderBy: { createdAt: 'desc' },
    take: onlyPath ? 1 : 40,
  });

  const nameCount = new Map<string, number>();
  const lens: number[] = [];
  let verbish = 0;
  let total = 0;
  const conceptSeq: Array<{ path: string; concept: string; names: string[] }> = [];

  for (const path of paths) {
    let tpl: any = {};
    try { tpl = JSON.parse(path.aiPromptTemplate); } catch { continue; }
    const ann = tpl?.kcAnnotation;
    if (!ann) continue;
    const nodes: any[] = Array.isArray(ann.kcGraph?.nodes) ? ann.kcGraph.nodes : [];
    const nameOf = new Map<string, string>();
    for (const n of nodes) if (n?.kcId) nameOf.set(String(n.kcId), String(n.name ?? n.kcId));
    const groups: any[] = Array.isArray(ann.conceptKcs) ? ann.conceptKcs : [];
    const seen = new Set<string>();
    for (const g of groups) {
      const kcs = Array.isArray(g?.kcs) ? g.kcs : [];
      const names = kcs.map((k: any) => String(k?.name ?? nameOf.get(String(k?.kcId)) ?? '?')).filter((s) => s && s !== '?');
      conceptSeq.push({ path: path.id.slice(-10), concept: String(g?.conceptId ?? '?'), names });
      for (const n of names) {
        if (seen.has(n)) continue;
        seen.add(n);
        total += 1;
        lens.push(n.length);
        if (VERB_PREFIX.test(n)) verbish += 1;
        nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      }
    }
  }

  lens.sort((a, b) => a - b);
  const pct = (q: number) => lens[Math.min(lens.length - 1, Math.floor(lens.length * q))] || 0;
  console.log(`涉及路径=${paths.length}  去重后 KC 名=${total}`);
  console.log(`名字长度：中位 ${pct(0.5)} 字  25% ${pct(0.25)}  75% ${pct(0.75)}  最长 ${lens[lens.length - 1] ?? 0}`);
  console.log(`以动词开头（"提取/区分/定位…"）的占比：${verbish}/${total} = ${(100 * verbish / Math.max(1, total)).toFixed(0)}%`);
  const dup = [...nameCount.entries()].filter(([, c]) => c > 1);
  console.log(`同一 KC 名字串出现在多条路径：${dup.length} 个（跨路径字面复用）`);
  if (dup.length) console.log('  例：' + dup.slice(0, 6).map(([n, c]) => `${n}(${c})`).join('、'));

  const avgPerConcept = conceptSeq.length ? conceptSeq.reduce((a, g) => a + g.names.length, 0) / conceptSeq.length : 0;
  console.log(`每个核心概念下的 KC 数：平均 ${avgPerConcept.toFixed(1)}（共 ${conceptSeq.length} 个概念组）`);

  console.log('\n### 每个核心概念下的 KC 序列（看它像不像"一个流程的步骤"）');
  for (const g of conceptSeq.slice(0, 12)) {
    console.log(`  [${g.path} ${g.concept}] ${g.names.join(' → ')}`);
  }
  if (list) {
    console.log('\n### 全部 KC 名（按长度降序，看有没有像整句话的）');
    [...nameCount.keys()].sort((a, b) => b.length - a.length).slice(0, 20).forEach((n) => console.log(`  ${n.length}字  ${n}`));
  }
}
main().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
