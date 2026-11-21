/**
 * P1-1 回归（2026-10-22 流程架构审计）：path-reviewer 结论必须真正被消费。
 *
 * 事故：`executeSkill` 返回**已解包的 output 本体**（无 `{ success, output }` 包装），
 * 代码却按 `reviewResult?.success && reviewResult?.output` 判空 → 恒 false，
 * 评审 LLM 照常计费但结论全丢，CIDDP 自动重规划分支成为死码。
 *
 * 这里静态锁住调用契约：评审必须走 `executeSkillWithResult`，且仍按 success/output 判空。
 * 行为分支本身依赖真实 LLM，无法在单测里便宜地端到端复现；契约锁能防住这次同型回归。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// 本文件位于 backend/src/services/learning/generation/__tests__/ → 仓库根上溯 6 层
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
// 评审/重规划循环 2026-11-07（#172-6）拆到 path-review-replan.ts（分层守卫：core 拆分）；
// core 一起读进来，防止有人把这段代码搬回去时漏锁。
const CORE_SOURCE = read('backend/src/services/learning/generation/path-generation.core.ts');
const SOURCES = [
  read('backend/src/services/learning/generation/path-review-replan.ts'),
  CORE_SOURCE,
].join('\n');

describe('P1-1 path-reviewer 结果消费契约', () => {
  it('评审调用使用 executeSkillWithResult（不是 executeSkill 的解包 output）', () => {
    expect(SOURCES).toContain('const reviewResult = await executeSkillWithResult(pathReviewerDefinition, {');
    expect(SOURCES).not.toContain('const reviewResult = await executeSkill(pathReviewerDefinition, {');
  });

  it('仍按 success/output 判空，并保留 passed=false 的返工分支（现仅在显式实验分组）', () => {
    expect(SOURCES).toContain('if (reviewResult?.success && reviewResult?.output) {');
    expect(SOURCES).toContain('if (pathReview.passed === false && pathReview.replanInstructions) {');
  });

  it('普通路径生成不再同步评审/自动重规划，改为落库事务登记后台评审事件', () => {
    // 2026-11-21：模型评审转后台观察；主线只做确定性检查 → 落库 → 启动阶段设计。
    expect(CORE_SOURCE).not.toContain('reviewPathWithAutoReplan(');
    expect(CORE_SOURCE).toContain('enqueuePathQualityReviewEvent(tx, {');
    // 不可变路径版本随落库写入，后台结果按版本栅栏回写。
    expect(CORE_SOURCE).toContain('pathVersion: runId ?? null');
  });
});
