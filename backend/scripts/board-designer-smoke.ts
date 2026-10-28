import 'dotenv/config';
import { decideBoardIntent } from '../src/services/ai-teaching/board-intent';
import { designBoard } from '../src/services/ai-teaching/board-designer.service';

(async () => {
  const intent = decideBoardIntent({
    taskType: 'explain',
    kind: 'state-strip',
    studentText: '大棚里明明暖和，菜却长得慢，暖风吹着但菜叶黄、新芽少。',
    lastTeacherText: null,
    boardNumbers: [],
  });
  const out = await designBoard({
    task: { title: '用原料—条件—产物拆解棚暖菜慢', description: '把大棚暖和但菜长得慢拆成原料、条件、产物三个槽位。', taskType: 'explain' },
    scenario: { subject: '生物', topic: '光合作用', learnerLevel: 'beginner' },
    studentSays: '大棚里明明暖和，菜却长得慢，暖风吹着但菜叶黄、新芽少。',
    kindHint: 'state-strip',
    questionIntent: intent,
    lastTeacherReply: null,
    instruction: '画出这张白板的完整形态：骨架、步骤、数值、单位、副标注都写全，一个 ? 都不要留。标题只点题，不写结论。' + intent.instruction,
  }, { userId: 'smoke-user', sessionId: 'smoke-session', taskId: 'smoke-task' });
  console.log(JSON.stringify({ kind: out.figure?.kind ?? null, title: (out.figure as any)?.spec?.title ?? null, reason: out.reason }, null, 1));
  process.exit(out.figure ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
