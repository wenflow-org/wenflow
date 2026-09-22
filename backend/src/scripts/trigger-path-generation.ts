/* eslint-disable no-console -- 一次性触发 CLI：验证 kc-mapper 修复后 KC 图是否落库 */
/**
 * 触发一次完整路径生成（生产同款函数 GoalConversationService.quickGeneratePath：
 * mock conversation → pathOrchestrator.generateFromGoal → stage-enrichment → kc-mapper 落库）。
 * 用途：2026-09-22 kcAnnotation 契约 bug 修复后的真实运行验证。
 */
import 'dotenv/config';
import goalConversationService from '../services/learning/goal-conversation.service';

const USER_ID = process.env.TRIGGER_USER_ID || 'user_30a97921-8fcf-454c-801a-9983dc83db1c';

async function main() {
  const started = Date.now();
  console.log(`[trigger] 开始生成 userId=${USER_ID}`);
  const result = await goalConversationService.quickGeneratePath(USER_ID, {
    goal: '明天上午 10 点要用 Excel 给 300 行的销售明细按日期和品类分类汇总，现在只会最基础的求和',
    level: 'beginner',
    timePerDay: '1 小时',
    learningStyle: 'mixed',
  });
  const path = result?.internal?.core?.learningPath;
  console.log(`[trigger] 完成 pathId=${path?.id} name=${path?.name} 耗时=${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[trigger] 失败:', e); process.exit(1); });
