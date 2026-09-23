/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
import { lexicalSimilarity } from '../src/services/learner/ConceptConsolidatorService';

const NAME = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length) || '[case] 3-6岁';

async function main() {
  const p = prisma as any;
  const u = await p.users.findFirst({ where: { name: { contains: NAME } }, select: { id: true } });
  const rows = await p.misconception_ledger.findMany({
    where: { userId: u.id },
    select: { id: true, conceptKey: true, canonicalLabel: true, hypothesis: true },
  });
  const byKey: Record<string, any[]> = {};
  for (const r of rows) (byKey[r.conceptKey] ??= []).push(r);
  for (const [key, list] of Object.entries(byKey)) {
    console.log(`\n=== 概念「${key}」 ${list.length} 行 ===`);
    for (const r of list) console.log(`  [${r.canonicalLabel ?? 'NULL'}] ${String(r.hypothesis).slice(0, 46)}`);
    console.log('  pairwise lexicalSimilarity:');
    const pairs: Array<[number, number, number]> = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        pairs.push([i, j, lexicalSimilarity(list[i].hypothesis, list[j].hypothesis)]);
      }
    }
    pairs.sort((a, b) => b[2] - a[2]);
    for (const [i, j, s] of pairs) console.log(`    ${s.toFixed(2)}  #${i}~#${j}${i < 6 && j < 6 ? ` | ${String(list[i].canonicalLabel ?? 'NULL')} ~ ${String(list[j].canonicalLabel ?? 'NULL')}` : ''}`);
    const same = pairs.filter(([i, j]) => (list[i].canonicalLabel ?? '') === (list[j].canonicalLabel ?? ''));
    const diff = pairs.filter(([i, j]) => (list[i].canonicalLabel ?? '') !== (list[j].canonicalLabel ?? ''));
    console.log(`  同标签对的相似度：min=${Math.min(...same.map((x) => x[2])).toFixed(2)} max=${Math.max(...same.map((x) => x[2])).toFixed(2)} n=${same.length}`);
    console.log(`  异标签对的相似度：min=${diff.length ? Math.min(...diff.map((x) => x[2])).toFixed(2) : '-'} max=${diff.length ? Math.max(...diff.map((x) => x[2])).toFixed(2) : '-'} n=${diff.length}`);
  }
}
main().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
