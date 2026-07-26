/**
 * 故事当次学习需求解析。
 *
 * 顶层模型：虚拟人（稳定人设）→ 多故事（产生学习需求）→ 经 Goal 对话传递 → 正式 Path。
 * Path 本身不读 story；只消费 Goal 的 description / handoff。
 * 因此故事需求必须在 Goal 入口（开场发言 = conversation.description）传对。
 */

export type StoryDemandSource =
  | 'story.visibleOpening'
  | 'story.goalSeed.surfaceGoal'
  | 'story.goalSeed.realProblem'
  | 'story.triggerEvent'
  | 'story.outline'
  | 'profile.learningGoal'
  | 'none';

export interface StoryDemandResolution {
  /** 进入正式 Goal 对话的首条用户诉求 / conversation.description */
  text: string;
  source: StoryDemandSource;
  storyId: string | null;
  surfaceGoal: string | null;
  realProblem: string | null;
}

function asText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function pickGoalSeed(story: any): { surfaceGoal: string; realProblem: string } {
  const seed = story?.goalSeed && typeof story.goalSeed === 'object' ? story.goalSeed : null;
  return {
    surfaceGoal: asText(seed?.surfaceGoal),
    realProblem: asText(seed?.realProblem),
  };
}

/**
 * 从会话绑定的故事上下文解析「当次」学习诉求。
 * 优先级：可见开场 → 故事表面目标 → 真实问题 → 触发事件/大纲 → 画像长期倾向（兜底）。
 */
export function resolveStorySessionDemand(params: {
  story?: any | null;
  profileLearningGoal?: string | null;
}): StoryDemandResolution {
  const story = params.story && typeof params.story === 'object' ? params.story : null;
  const storyId = asText(story?.storyId || story?.id) || null;
  const { surfaceGoal, realProblem } = pickGoalSeed(story);

  const candidates: Array<{ text: string; source: StoryDemandSource }> = [
    { text: asText(story?.visibleOpening), source: 'story.visibleOpening' },
    { text: surfaceGoal, source: 'story.goalSeed.surfaceGoal' },
    { text: realProblem, source: 'story.goalSeed.realProblem' },
    { text: asText(story?.triggerEvent || story?.storyTriggerEvent), source: 'story.triggerEvent' },
    { text: asText(story?.outline || story?.storyOutline), source: 'story.outline' },
    { text: asText(params.profileLearningGoal), source: 'profile.learningGoal' },
  ];

  const hit = candidates.find((item) => item.text);
  if (!hit) {
    return {
      text: '',
      source: 'none',
      storyId,
      surfaceGoal: surfaceGoal || null,
      realProblem: realProblem || null,
    };
  }

  return {
    text: hit.text,
    source: hit.source,
    storyId,
    surfaceGoal: surfaceGoal || null,
    realProblem: realProblem || null,
  };
}

/**
 * Path 旁路/手动推进时：优先用 Goal 对话已写入的 description（= 开场诉求经正式链路），
 * 其次用故事需求；画像 learningGoal 仅作最后兜底，不是正规传递路径。
 */
export function resolvePathRawGoalFromSession(params: {
  goalConversationDescription?: string | null;
  story?: any | null;
  profileLearningGoal?: string | null;
}): { rawGoal: string; source: string } {
  const fromGoal = asText(params.goalConversationDescription);
  if (fromGoal) {
    return { rawGoal: fromGoal, source: 'goal.conversation.description' };
  }

  const demand = resolveStorySessionDemand({
    story: params.story,
    profileLearningGoal: params.profileLearningGoal,
  });
  if (demand.text) {
    return { rawGoal: demand.text, source: demand.source };
  }

  return { rawGoal: '', source: 'none' };
}
