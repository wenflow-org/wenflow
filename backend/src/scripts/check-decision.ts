/**
 * 决策能力冒烟（外挂能力 decision-gate）。
 *
 * 用法：cd backend && npm run decision:check
 *
 * 打真实 provider，验证三件事：
 *   1) choice 返回带概率的选项；
 *   2) noul 返回 0~1；
 *   3) score 返回分级期望分与 legend（provider 支持时）。
 * 任一判定错误即退出码 1。
 */

import 'dotenv/config';
import { decide, isDecisionConfigured, resolveDecisionProviderOrder } from '../services/decision';

async function main(): Promise<void> {
  if (!isDecisionConfigured()) {
    console.error(
      '[decision:check] 未配置任何 provider（需要 DASHSCOPE_API_KEY；或 CF_ACCOUNT_ID+CF_TOKEN、DECISION_CUSTOM_URL；' +
        '当前顺序 ' + resolveDecisionProviderOrder().join(',') + '）'
    );
    process.exitCode = 1;
    return;
  }

  const response = await decide({
    state: {
      ticket_id: 'T-1001',
      content: '订单支付后超过 24 小时仍未到账，用户无法继续使用核心服务，要求立即处理。',
    },
    questions: {
      department: {
        type: 'choice',
        instructions: '应该由哪个团队处理？',
        criteria: { billing: '支付、退款和账单问题', technical: '产品故障和集成问题' },
      },
      escalate: { type: 'noul', instructions: '是否需要立即通知值班人员？' },
      severity: {
        type: 'score',
        instructions: '这个问题有多严重？',
        criteria: ['轻微问题，不影响功能', '部分功能受影响，但存在替代方案', '核心功能不可用，没有替代方案', '造成严重业务或安全影响'],
      },
    },
  });

  const department = response.answers.department;
  const escalate = response.answers.escalate;
  const severity = response.answers.severity;

  console.log(`[decision:check] provider=${response.provider} model=${response.model} ${response.latencyMs}ms（尝试链 ${response.attempts.join('→')}）`);
  console.log(`  choice: ${department?.choice} ${JSON.stringify(department?.probabilities ?? {})}`);
  console.log(`  noul:   ${escalate?.noul}`);
  console.log(`  score:  ${severity?.score} ${JSON.stringify(severity?.probabilities ?? {})}`);

  const problems: string[] = [];
  if (!department?.choice) problems.push('choice 未返回选项');
  if (typeof escalate?.noul !== 'number') problems.push('noul 未返回概率');
  if (severity && typeof severity.score !== 'number') problems.push('score 未返回分值');

  if (problems.length) {
    console.error(`[decision:check] FAIL：${problems.join('；')}`);
    process.exitCode = 1;
    return;
  }
  console.log('[decision:check] PASS');
}

main().catch((error: unknown) => {
  console.error('[decision:check] 运行失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
