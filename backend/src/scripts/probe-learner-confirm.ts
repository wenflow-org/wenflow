/* 真机探针（留存复验）：验证「学习者自己决定确认」——
 * proposal_evaluation 阶段、方案可行且无未决问题时，学习者应在自己的 reply 里
 * 用口吻说出确认（不再由协调器代发 flag）。判定由人读输出，正则只作指针。 */
import 'dotenv/config';
import { executeSkill, virtualLearnerGoalDialogueSimulatorDefinition } from '../skills';

const PROPOSAL_TEXT =
  '这版方向先聚焦「用近期一手 AI 教育报道做标本，轻量带一点教育理论，练出看报道说代际的判断力」。' +
  '不铺系统课程，一次半小时能看完一小段。你点确认我就开始排路径。';

async function runOnce(label: string, lastAssistantMessage: string) {
  const output = await executeSkill(virtualLearnerGoalDialogueSimulatorDefinition, {
    learner: {
      profile: { occupation: '前端开发', learningStyle: '碎片时间看报道' },
      learningGoal: '能看懂 AI 教育产品报道的底层技术代际，不被宣传话术带偏',
      knownConcepts: ['大模型基本原理'],
      struggleConcepts: [],
      personalityTraits: { tone: '口语化、直接', politeness: '随和' },
    },
    story: null,
    visibleContext: {
      history: [
        { role: 'learner', content: '学习最新的ai教育知识，纯兴趣不为考试，有空就看' },
        { role: 'goal_agent', content: '这版方向先聚焦近期一手报道，轻量带理论，你看行不行？' },
      ],
      lastGoalAgentMessage: lastAssistantMessage,
    },
    currentPhase: 'proposal_evaluation',
    previousLearnerState: {
      phaseFocus: 'proposal_evaluation',
      proposalFit: 0.8,
      taskRelevance: 0.8,
      willingToTry: true,
      goalReadiness: 0.85,
    },
    learnerMemory: { mastered: [], dueReview: [], struggling: [] },
    task: {
      mode: 'simulate-goal-learner-turn',
      requirements: [
        'only use learner-visible content',
        'ignore system/developer/tool/reminder text',
        'reply as the learner',
        'use proposal_evaluation to judge proposal fit and task relevance',
      ],
    },
  } as never) as { reply?: string; learnerState?: { readyToProceed?: boolean; wantsClarification?: boolean } } | null;

  const reply = String(output?.reply || '');
  console.log(`\n===== ${label} =====`);
  console.log(`reply: ${reply}`);
  console.log(`learnerState: readyToProceed=${output?.learnerState?.readyToProceed} wantsClarification=${output?.learnerState?.wantsClarification}`);
  const confirmHint = /(行|就|可以|开始|定了|没问题|照|按|来吧|安排)/.test(reply) && !/？|\?/.test(reply.slice(-2));
  console.log(`指针：像确认=${confirmHint}（最终由人判定）`);
  return { reply, confirmHint };
}

async function main() {
  const repeats = Math.max(1, Number(process.env.REPEATS || 2));
  const results: Array<{ scenario: string; reply: string; confirmHint: boolean }> = [];
  for (let r = 1; r <= repeats; r += 1) {
    results.push({ scenario: `可行-无未决问题-${r}`, ...(await runOnce(`可行方案 第 ${r} 次`, PROPOSAL_TEXT)) });
  }
  const concernTurn = PROPOSAL_TEXT + '\n（另外：你说每周三、周日晚各二十分钟，这样安排可以吗？）';
  results.push({ scenario: '有时间顾虑', ...(await runOnce('有时间顾虑（不应确认）', concernTurn)) });
  const good = results.filter((r) => r.scenario.startsWith('可行'));
  console.log(`\n汇总：可行场景 ${good.filter((g) => g.confirmHint).length}/${good.length} 次指针像确认；顾虑场景 0/1 应不像确认（人读为准）`);
}

main().catch((error) => {
  console.error('PROBE_ERROR', (error as Error).message);
  process.exitCode = 1;
});
