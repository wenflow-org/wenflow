/**
 * P2 回归（2026-10-22 流程架构审计）：多阶段重排必须在事务内重读模板。
 *
 * 事故：循环共享同一 path 对象，`txParsed` 只在首阶段有 contentSnapshot 时重读；
 * 后续阶段回落到循环外陈旧 parsedTemplate，写回时整包覆盖前一阶段刚写的
 * stageDesigns / _generation 诊断 payload。
 *
 * 行为级复现需要完整 DB 事务夹具；这里锁住事务内基准变量与两个合并源，
 * 防止再退回 parsedTemplate。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// 本文件位于 backend/src/services/learning/replan/__tests__/ → 仓库根上溯 6 层
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, 'backend/src/services/learning/replan/path-replan.service.ts'),
  'utf8',
);

describe('多阶段重排事务内模板基准', () => {
  it('每次都从事务内读到的 txCurrentTemplate 出发，而不是循环外 parsedTemplate', () => {
    expect(SOURCE).toContain('const txCurrentTemplate = parsePathPromptTemplate((await tx.learning_paths.findUnique({');
    expect(SOURCE).toContain(': txCurrentTemplate;');
  });

  it('stageDesigns 与 _generation 的合并源使用 txParsed', () => {
    expect(SOURCE).toContain('...(txParsed?.stageDesigns && typeof txParsed.stageDesigns === \'object\' ? txParsed.stageDesigns : {})');
    expect(SOURCE).toContain('...(txParsed?._generation && typeof txParsed._generation === \'object\' ? txParsed._generation : {})');
  });
});
