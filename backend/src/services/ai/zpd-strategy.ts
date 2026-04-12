// ZPD分层策略
// Zone of Proximal Development (最近发展区)
// 根据用户能力水平动态调整AI辅导方式

export interface ZPDProfile {
  level: 'novice' | 'advanced_beginner' | 'competent' | 'proficient' | 'expert';
  xp: number;
  completedTasks: number;
  averageDifficulty?: number;
}

export interface TutoringStrategy {
  hintLevel: 'full' | 'guided' | 'minimal' | 'discussion';
  provideSolution: boolean;
  explanationDetail: 'detailed' | 'moderate' | 'brief';
  encourageThinking: boolean;
  provideExamples: boolean;
}

/**
 * 根据用户ZPD档案确定辅导策略
 */
export function determineTutoringStrategy(profile: ZPDProfile): TutoringStrategy {
  const strategies: Record<ZPDProfile['level'], TutoringStrategy> = {
    novice: {
      hintLevel: 'full',
      provideSolution: true,
      explanationDetail: 'detailed',
      encourageThinking: false,
      provideExamples: true
    },
    advanced_beginner: {
      hintLevel: 'guided',
      provideSolution: true,
      explanationDetail: 'detailed',
      encourageThinking: true,
      provideExamples: true
    },
    competent: {
      hintLevel: 'guided',
      provideSolution: false,
      explanationDetail: 'moderate',
      encourageThinking: true,
      provideExamples: true
    },
    proficient: {
      hintLevel: 'minimal',
      provideSolution: false,
      explanationDetail: 'brief',
      encourageThinking: true,
      provideExamples: false
    },
    expert: {
      hintLevel: 'discussion',
      provideSolution: false,
      explanationDetail: 'brief',
      encourageThinking: true,
      provideExamples: false
    }
  };

  return strategies[profile.level];
}

/**
 * 根据用户XP和完成任务数确定ZPD等级
 */
export function determineZPDLevel(xp: number, completedTasks: number): ZPDProfile['level'] {
  // 等级划分（可根据实际调整）
  if (completedTasks === 0) return 'novice';
  if (xp < 100) return 'novice';
  if (xp < 300) return 'advanced_beginner';
  if (xp < 600) return 'competent';
  if (xp < 1000) return 'proficient';
  return 'expert';
}

/**
 * 构建AI辅导提示词
 */
export function buildTutoringPrompt(
  taskDescription: string,
  userQuestion: string,
  strategy: TutoringStrategy,
  taskContext?: {
    taskType?: string;
    weekNumber?: number;
    subject?: string;
  }
): string {
  let prompt = `你是一位AI学习辅导老师。\n\n`;
  prompt += `**任务背景**: ${taskDescription}\n`;
  prompt += `**学习者问题**: ${userQuestion}\n\n`;

  prompt += `**辅导策略** (${strategy.hintLevel}):\n`;

  switch (strategy.hintLevel) {
    case 'full':
      prompt += `- 提供完整的答案和详细的解释\n`;
      prompt += `- 给出具体的代码示例\n`;
      prompt += `- 解释每个步骤的原因\n`;
      prompt += `- 鼓励学习者\n`;
      break;

    case 'guided':
      prompt += `- 提供关键步骤的提示\n`;
      prompt += `- 不直接给出完整答案，但给出足够的引导\n`;
      prompt += `- 鼓励学习者思考\n`;
      prompt += `- 给出部分示例\n`;
      break;

    case 'minimal':
      prompt += `- 只提供最小限度的提示\n`;
      prompt += `- 引导学习者自己找到答案\n`;
      prompt += `- 鼓励探索和实验\n`;
      break;

    case 'discussion':
      prompt += `- 与学习者进行平等的讨论\n`;
      prompt += `- 提供不同的思路和观点\n`;
      prompt += `- 探讨最佳实践和权衡\n`;
      prompt += `- 尊重学习者的独立判断\n`;
      break;
  }

  if (strategy.provideExamples) {
    prompt += `\n- 请提供相关的代码示例来帮助理解\n`;
  }

  if (taskContext) {
    prompt += `\n**上下文信息**:\n`;
    if (taskContext.subject) prompt += `- 学科: ${taskContext.subject}\n`;
    if (taskContext.taskType) prompt += `- 任务类型: ${taskContext.taskType}\n`;
    if (taskContext.weekNumber) prompt += `- 第${taskContext.weekNumber}周\n`;
  }

  prompt += `\n现在，请以友好、鼓励的语气回答学习者的问题。`;

  return prompt;
}

/**
 * 生成任务相关的引导问题
 */
export function generateGuidingQuestions(
  taskDescription: string,
  strategy: TutoringStrategy
): string[] {
  // 根据策略返回不同深度的引导问题
  const questions: string[] = [];

  if (strategy.hintLevel === 'full' || strategy.hintLevel === 'guided') {
    questions.push(
      '这个任务的关键步骤是什么？',
      '你从哪里开始理解有困难？',
      '需要我详细解释哪个部分？'
    );
  } else if (strategy.hintLevel === 'minimal') {
    questions.push(
      '你尝试了什么方法？',
      '遇到了什么具体的错误？',
      '你觉得问题可能在哪里？'
    );
  } else if (strategy.hintLevel === 'discussion') {
    questions.push(
      '你有什么初步的想法？',
      '有什么不同的实现方式可以比较？',
      '这种方法的优缺点是什么？'
    );
  }

  return questions;
}

export default {
  determineTutoringStrategy,
  determineZPDLevel,
  buildTutoringPrompt,
  generateGuidingQuestions
};
