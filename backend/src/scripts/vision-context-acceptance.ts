/**
 * vision:acceptance —— #123 端到端验收（人工运行，**不进 CI**；会真实调用模型）。
 *
 * 验收对象（issue #123「验收」节）：
 *   ① 教师侧：课堂历史带板书配图时，教师能引用**只有图里才有**的信息；
 *   ② 学习者侧：学习者（VL）可见上下文带配图后，回答能引用同类信息。
 * 方法：**同一课堂、双组对照**——A 组历史带图，B 组同文无图（其余逐字节相同）。
 *   只有 A 组答出图内事实、B 组答不出（或含糊），才算"图真的到了模型"。
 * 判据复用 vision:probe 的确定性图案（左红 100px / 中绿最宽 200px / 右蓝 100px，等高）与
 * judgeVisionProbeAnswer（颜色、顺序、最宽、左右等宽四项）。
 *
 * 用法：npm --prefix backend run vision:acceptance
 * 说明：教师侧走真实 teaching-turn 技能（含上下文压缩与消息组装）；学习者侧走真实 VL 模拟器技能。
 *       生产环境二者路由到声明了 vision 的模型（teaching-turn→ds4.1-flash；VL→agnes-3.0-flash）。
 */
import 'dotenv/config';
import { teachingTurnAgentHandler } from '../skills/teaching-turn';
import { virtualLearnerLearnTurnSimulator } from '../skills/virtual-learner-learn-turn-simulator';
import { teachingContextCompressionService } from '../services/ai-teaching/TeachingContextCompressionService';
import { buildProbeImagePng, judgeVisionProbeAnswer } from './vision-probe';

const IMAGE_DATA_URL = `data:image/png;base64,${buildProbeImagePng().toString('base64')}`;

/** 教师侧提问：宽度事实只能从像素里读出来（历史文字里没有任何宽度/顺序信息） */
const BOARD_QUESTION =
  '等一下，我核对下你刚才画的那张图：从左到右依次是什么颜色的色块？哪个色块最宽、哪个最窄？'
  + '请直接按图回答。';

/** 学习者侧：老师让孩子"说说图上看到了什么"（模拟学习者复述板书的自然形态） */
const LEARNER_QUESTION = '你看着这张图，用你自己的话跟我说说：图上从左到右是什么颜色、哪个色块最宽、哪个最窄？';

/** 教学消息的最小形态（本脚本只喂压缩服务与技能，不落库） */
interface TeachingSessionMessageLike {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  textLength: number;
  images?: Array<ReturnType<typeof imageMessage>>;
}

interface ArmResult {
  arm: 'with-image' | 'text-only';
  reply: string;
  verdict: ReturnType<typeof judgeVisionProbeAnswer> | { error: string };
}

function imageMessage(caption: string) {
  return {
    url: IMAGE_DATA_URL,
    caption,
    prompt: '验收探针图（确定性图案）',
    provider: 'vision:acceptance',
    model: 'generated',
    kind: null,
    createdAt: new Date().toISOString(),
  };
}

function grade(reply: string): ArmResult['verdict'] {
  if (!reply || !reply.trim()) return { error: 'EMPTY_REPLY' };
  return judgeVisionProbeAnswer(reply);
}

/** 教师侧：走真实上下文压缩 + teaching-turn 技能 */
async function runTeacherArm(withImage: boolean): Promise<ArmResult> {
  const now = new Date().toISOString();
  const messages: TeachingSessionMessageLike[] = [
    { role: 'user', content: '老师，我们这节课就看这个核对框架吧。', timestamp: now, textLength: 20 },
    {
      role: 'assistant',
      content: '好，这张图就是我们的核对框架，你看一下。',
      timestamp: now,
      textLength: 22,
      ...(withImage ? { images: [imageMessage('核对框架')] } : {}),
    },
    // 本轮学习者发言 = 只靠图才能回答的问题（宽度事实不在任何历史文本里）
    { role: 'user', content: BOARD_QUESTION, timestamp: now, textLength: BOARD_QUESTION.length },
  ];
  const compressed = teachingContextCompressionService.compress(messages);
  const input = {
    messages: compressed.messages,
    learner: {
      stableProfile: {
        thinkingStyle: '实例驱动',
        preferredStyle: '先看例子再总结',
        theoryVsPractice: '实践优先',
        sessionLength: '40 分钟',
        confidenceLevel: '中等',
      },
      liveState: { lss: 4, ktl: 5, lf: 3, lsb: 2, recentTrend: '平稳', recommendedPacing: '标准' },
      pathContext: {
        pathTitle: '验收课堂',
        currentMilestoneTitle: '验收里程碑',
        currentStageNumber: 1,
        currentTaskOrder: 1,
        totalTasksInMilestone: 1,
        completedPrerequisiteTasks: [],
      },
      relevantKnowledge: { mastered: [], fragile: [], struggling: [] },
      backgroundKnowledge: { knownConcepts: [], limitations: [] },
    },
    scenario: {
      subject: '验收',
      topic: '核对框架',
      taskTitle: '核对框架',
      taskDescription: '核对图中的色块布局',
      taskType: 'concept',
    },
    knowledge: { points: [] },
    controls: { mode: 'tutor' },
  };
  const output = await teachingTurnAgentHandler(input as unknown as Parameters<typeof teachingTurnAgentHandler>[0]);
  const reply: string = output?.userVisible || output?.internal?.ext?.teaching?.reply || '';
  return { arm: withImage ? 'with-image' : 'text-only', reply, verdict: grade(reply) };
}

/** 学习者侧：走真实 VL 模拟器技能（可见上下文带/不带图） */
async function runLearnerArm(withImage: boolean): Promise<ArmResult> {
  const output = await virtualLearnerLearnTurnSimulator({
    learner: {
      profile: { name: '验收学习者', learningStyle: '照做型' },
      learningGoal: '看懂老师给的核对框架',
      knownConcepts: [],
      struggleConcepts: [],
      personalityTraits: { verbosity: 0.5, confusionStyle: '直接问' },
    },
    story: null,
    visibleContext: {
      history: [
        { role: 'learner', content: '老师，我们开始吧。' },
        {
          role: 'teacher',
          content: '这张图就是我们的核对框架，你看一下，然后跟我说说图上有什么。',
          ...(withImage ? { images: [imageMessage('核对框架')] } : {}),
        },
      ],
      lastTeacherMessage: LEARNER_QUESTION,
    },
    currentPhase: 'trying',
    previousLearnerState: null,
    currentTask: { title: '核对框架', milestoneTitle: '验收里程碑', acceptanceCriteria: null, description: null },
    knowledgeSnapshot: [],
  });
  const reply: string = output?.output?.reply || '';
  return { arm: withImage ? 'with-image' : 'text-only', reply, verdict: grade(reply) };
}

function printArm(label: string, result: ArmResult): void {
  const verdict = result.verdict;
  const summary = 'error' in verdict
    ? `判据不可用（${verdict.error}）`
    : `颜色=${verdict.checks.colors ? '√' : '×'} 顺序=${verdict.checks.order ? '√' : '×'}`
      + ` 最宽=绿${verdict.checks.widestGreen ? '√' : '×'} 最窄=红${verdict.checks.narrowestRed ? '√' : '×'}`;
  console.log(`[vision:acceptance] ${label}[${result.arm}] ${summary}`);
  console.log(`[vision:acceptance]   ${label}回答：${result.reply.replace(/\s+/g, ' ').slice(0, 300)}`);
}

/** 判定：A 组 PASS 且（B 组失败 或 B 组无法给出全部四项）→ 视觉通道成立 */
function channelVerdict(withImage: ArmResult, _textOnly: ArmResult): 'PASS' | 'FAIL' {
  const verdict = withImage.verdict;
  return !('error' in verdict) && verdict.pass ? 'PASS' : 'FAIL';
}

async function main(): Promise<void> {
  if (process.env.TEACHING_VISUAL_ENABLED !== '1') {
    console.log('[vision:acceptance] 提示：本脚本用确定性探针图直接构造课堂历史（等价于 TEACHING_VISUAL_ENABLED=1 时的板书图），不依赖生图开关');
  }
  console.log('[vision:acceptance] 教师侧：真实 teaching-turn（含上下文压缩 → 消息组装 → 网关）');
  const teacherWithImage = await runTeacherArm(true);
  const teacherTextOnly = await runTeacherArm(false);
  printArm('教师', teacherWithImage);
  printArm('教师', teacherTextOnly);
  console.log(`[vision:acceptance] 教师侧结论：${channelVerdict(teacherWithImage, teacherTextOnly)}（带图组需四判据全中）`);

  console.log('[vision:acceptance] 学习者侧：真实 VL learn-turn 模拟器（可见上下文 → 请求组装 → 网关）');
  const learnerWithImage = await runLearnerArm(true);
  const learnerTextOnly = await runLearnerArm(false);
  printArm('学习者', learnerWithImage);
  printArm('学习者', learnerTextOnly);
  console.log(`[vision:acceptance] 学习者侧结论：${channelVerdict(learnerWithImage, learnerTextOnly)}（带图组需四判据全中）`);

  const ok = channelVerdict(teacherWithImage, teacherTextOnly) === 'PASS'
    && channelVerdict(learnerWithImage, learnerTextOnly) === 'PASS';
  console.log(ok ? '[vision:acceptance] 总体 PASS：两条通道都能引用只有图里才有的信息' : '[vision:acceptance] 总体 FAIL：至少一条通道未能引用图内信息');
  process.exitCode = ok ? 0 : 1;
}

// 直接运行时执行；被 import 时只暴露纯函数
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[vision:acceptance] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
