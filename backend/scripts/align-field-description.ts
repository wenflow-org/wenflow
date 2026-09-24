/**
 * dev 工具：把本地老库里的字段描述对齐到编排声明（一次性修正，非日常流程）
 *
 * 为什么需要它：`field_definitions` 的种子是**只建不更新**（保留后台编辑），
 * 所以本地长期库会残留旧 yaml 写入的描述；而 `prompts:drift-check` 比对「声明 vs DB」会 FAIL。
 * CI 是空库、种子即新文案，不会出现这个差异——纯粹是本地库陈旧。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/align-field-description.ts --stage=path --fieldId=subtasks.type [--write]
 * 默认 dry-run。改动编排描述后本地门禁变红时用它对齐；确属后台编辑过的描述不要跑。
 */
import dotenv from 'dotenv';
import systemPrisma from '../src/config/system-database';
import { loadOrchestrationFiles } from '../src/services/field-routing/orchestration-file';

dotenv.config();
const arg = (n: string) => {
  const hit = process.argv.find((i) => i.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};
const WRITE = process.argv.includes('--write');
const stage = arg('stage');
const fieldId = arg('fieldId');

(async () => {
  if (!stage || !fieldId) { console.error('用法：--stage=path --fieldId=subtasks.type [--write]'); process.exit(1); }
  const files = await loadOrchestrationFiles();
  const declared = (files as any[])
    .flatMap((f) => (f.fields || []).map((x: any) => ({ stage: f.stage ?? f.name ?? '', ...x })))
    .find((f: any) => f.stage === stage && f.fieldId === fieldId);
  if (!declared) { console.error(`编排声明里找不到 ${stage}/${fieldId}`); process.exit(1); }
  const rows = await systemPrisma.field_definitions.findMany({ where: { stage, fieldId } });
  for (const r of rows as any[]) {
    console.log(`${stage}/${fieldId}\n  DB:   ${r.description}\n  声明: ${declared.description}`);
    if (WRITE && r.description !== declared.description) {
      await systemPrisma.field_definitions.update({ where: { id: r.id }, data: { description: declared.description } });
      console.log('  → 已对齐');
    }
  }
  console.log(WRITE ? '== 已写入 ==' : '== dry-run（加 --write 执行）==');
  await systemPrisma.$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await systemPrisma.$disconnect(); process.exit(1); });
