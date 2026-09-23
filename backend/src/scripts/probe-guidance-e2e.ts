/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * adaptive-guidance-copy 端到端探针（审计 P1 §2.4d）。
 *
 * 两处修复要真模型验证：
 *   ① 规则 6 的进度计数路径写全为 learningState.tasks.*（此前只说 tasks.*，模型得猜在哪）
 *   ② 规则 8 的 learningSignal **在真实载荷里根本不存在**（实测 narratives 只有
 *      surfaceGoal/motivation/backgroundExperience/painPoints/currentLevel）⇒ 该分支是死的。
 *      改为消费真实存在的 learner.profile.narrativeInsights.practicePreferenceNote。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-guidance-e2e.ts
 */
import 'dotenv/config';
import { adaptiveGuidanceCopy } from '../skills/adaptive-guidance-copy';

const base = {
  view: 'dashboard' as const,
  path: { title: '向上汇报的结构化表达', subject: '职场表达', totalMilestones: 4, completedMilestones: 1 },
  learningState: { tasks: { total: 12, completed: 5, inProgress: 2, started: 7, todo: 5, completionRate: 41.7 } },
  sessionWrapup: null,
  advisory: null,
};

const CASES = [
  {
    label: '有交付形式偏好',
    learnerSnapshot: {
      profile: {
        name: '林慧敏',
        narratives: { surfaceGoal: '想学会向上汇报' },
        narrativeInsights: { practicePreferenceNote: '看教程没用，想直接拿自己的真实汇报来改' },
      },
      dynamicState: { recentTrend: 'stable', recommendedPacing: 'moderate' },
    },
  },
  {
    label: '无偏好（不应凭空承诺）',
    learnerSnapshot: {
      profile: { name: '林慧敏', narratives: { surfaceGoal: '想学会向上汇报' }, narrativeInsights: {} },
      dynamicState: { recentTrend: 'stable', recommendedPacing: 'moderate' },
    },
  },
];

async function main() {
  for (const c of CASES) {
    try {
      const out: any = await adaptiveGuidanceCopy({ ...base, learnerSnapshot: c.learnerSnapshot } as any);
      // 真实返回形状：{ success, output, duration, quality, debug }
      const result = out?.output ?? out;
      console.log(`[probe] ${c.label}`);
      console.log(`  subtitle = ${String(result?.subtitle || '').slice(0, 100)}`);
      console.log(`  pathHint = ${String(result?.pathHint || '').slice(0, 110)}`);
      const blob = JSON.stringify(result);
      const usesTasks = /已完成\s*5|进行中\s*2|12\s*个任务/.test(blob);
      const honorsPreference = /真实汇报|手头的一份材料|直接改/.test(blob);
      console.log(`  进度取自 learningState.tasks = ${usesTasks} | 兑现偏好承诺 = ${honorsPreference}`);
    } catch (error) {
      console.log(`[probe] ${c.label} 失败 | ${(error as Error).message}`);
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
