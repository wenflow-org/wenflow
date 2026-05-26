/**
 * Virtual Learner Simulation Agent - Prompt模板
 */

import type { SimulationContext, VirtualLearnerProfile, ReactionContext, LearnerLatentState, KnowledgePointState } from './types';

export const DEFAULT_SIMULATION_PROMPT = `你正在模拟一个真实学习者在当前情境下的自然反应。目标不是给出最正确的答案，而是给出最像这个人此刻会说的话。

## 你扮演的角色

{PROFILE_SECTION}

## 你当前的学习目标

{GOAL_SECTION}

## 你的知识水平

{KNOWLEDGE_SECTION}

## 你的性格特征

{PERSONALITY_SECTION}

## 学习偏好

{LEARNING_STYLE_SECTION}

## 动机类型

{MOTIVATION_SECTION}

## 对话历史

{CONVERSATION_HISTORY}

## 当前对话阶段

{STAGE_SECTION}

## 当前阶段额外约束

{STAGE_BEHAVIOR_SECTION}

## 当前潜在关切池

{CONCERN_POOL_SECTION}

## 你当前的内部学习状态

{LEARNER_STATE_SECTION}

## 你当前的知识状态

{KNOWLEDGE_STATE_SECTION}

## 当前需要你回复的消息

{LAST_MESSAGE}

## 回答原则

1. 保持角色一致性，始终以这个人的身份说话。

2. 使用自然口语，不要过于工整，不要像在写标准答案。

3. 保持知识边界：会就会，不会就不会，不要凭空变聪明。

4. 回复长度和语气按人物设定走，不要刻意表演。

5. 参考当前阶段作答：goal 更像在澄清需求，path 更像在判断方案，learning 更像在完成任务或暴露困难。

6. 可以有轻微情绪、犹豫和状态波动，但不要夸张。

7. 允许出现真实学习者常见现象：理解偏差、遗漏、假装懂了、记忆不稳、想跳步。但只有在当前状态支持时才表现出来，不要机械触发。

8. 是否追问、是否接受方案、是否继续推进，优先根据当前 learnerState 和 knowledgeState 决定。

9. “自我感觉会了”和“真实掌握了”可以不一致；如果两者不一致，让语言自然体现这种偏差，不要直接解释设定。

10. 你的重点是“像这个人此刻会怎样反应”，不是把所有信息一次性说满。

11. 不要机械复述对方刚刚的总结、提炼或转述，除非你是在纠正其中某一处不准确。

12. 不要总是用“我理解你…”“是的，你说得对…”“你提到的是…”这类模板化、客服式、访谈式开头。

13. 更常见的自然做法是：直接回答，被问到细节就给细节，被问到例子就给例子，被误解时就纠正一点。

## 输出格式

只输出一个 JSON 对象：
{
  "reply": "你的回复内容（作为虚拟用户的发言）",
  "thoughtProcess": "可选，你的角色思考过程（仅供调试）",
  "emotion": "可选，当前情绪状态（neutral/slightly_frustrated/happy/confident/confused）",
  "learnerState": {
    "understandingLevel": 0.0,
    "perceivedDifficulty": 0.0,
    "confusionLevel": 0.0,
    "frustrationLevel": 0.0,
    "motivationLevel": 0.0,
    "selfPerceivedMastery": 0.0,
    "actualMastery": 0.0,
    "memoryStrength": 0.0,
    "wantsClarification": false,
    "readyToAdvance": false,
    "attentionLevel": 0.0,
    "persistenceLevel": 0.0,
    "remainingUnknowns": ["..."],
    "detectedMisconceptions": ["..."],
    "stableErrorStyle": ["..."]
  }
}

不要输出其他任何内容。`;

const clamp01 = (value: unknown, fallback: number) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
};

function buildLearnerStateSection(state?: LearnerLatentState): string {
  if (!state) return '当前无显式状态快照，请基于画像和上下文做最合理模拟。';

  const lines: string[] = [];
  if (state.understandingLevel !== undefined) lines.push(`当前理解程度：${clamp01(state.understandingLevel, 0.5)}`);
  if (state.selfPerceivedMastery !== undefined) lines.push(`自我感觉掌握：${clamp01(state.selfPerceivedMastery, 0.5)}`);
  if (state.actualMastery !== undefined) lines.push(`真实掌握程度：${clamp01(state.actualMastery, 0.5)}`);
  if (state.memoryStrength !== undefined) lines.push(`记忆强度：${clamp01(state.memoryStrength, 0.5)}`);
  if (state.perceivedDifficulty !== undefined) lines.push(`主观难度感受：${clamp01(state.perceivedDifficulty, 0.5)}`);
  if (state.confusionLevel !== undefined) lines.push(`困惑程度：${clamp01(state.confusionLevel, 0.5)}`);
  if (state.frustrationLevel !== undefined) lines.push(`挫败感：${clamp01(state.frustrationLevel, 0.2)}`);
  if (state.motivationLevel !== undefined) lines.push(`当前动机：${clamp01(state.motivationLevel, 0.6)}`);
  if (state.attentionLevel !== undefined) lines.push(`注意力水平：${clamp01(state.attentionLevel, 0.7)}`);
  if (state.persistenceLevel !== undefined) lines.push(`坚持度：${clamp01(state.persistenceLevel, 0.6)}`);
  if (state.wantsClarification !== undefined) lines.push(`是否想追问：${state.wantsClarification ? '是' : '否'}`);
  if (state.readyToAdvance !== undefined) lines.push(`是否准备进入下一步：${state.readyToAdvance ? '是' : '否'}`);
  if (state.remainingUnknowns?.length) lines.push(`仍未弄清：${state.remainingUnknowns.join('、')}`);
  if (state.detectedMisconceptions?.length) lines.push(`当前错误理解：${state.detectedMisconceptions.join('、')}`);
  if (state.stableErrorStyle?.length) lines.push(`稳定错误风格：${state.stableErrorStyle.join('、')}`);
  if (state.emotion) lines.push(`当前情绪：${state.emotion}`);

  return lines.length ? lines.join('\n') : '当前无显式状态快照，请基于画像和上下文做最合理模拟。';
}

function buildKnowledgeStateSection(knowledgeState?: KnowledgePointState[]): string {
  if (!knowledgeState?.length) return '当前没有显式知识点状态，请根据 knowledgeLevel 与 known/struggle concepts 模拟。';

  return knowledgeState.slice(0, 8).map(item => {
    const errors = item.errorPatterns?.length ? `；稳定错误：${item.errorPatterns.join('、')}` : '';
    return `${item.key}：掌握=${clamp01(item.mastery, 0.5)}，信心=${clamp01(item.confidence, 0.5)}，记忆=${clamp01(item.memoryStrength, 0.5)}，自我感觉=${clamp01(item.selfPerceivedMastery, 0.5)}，迁移=${clamp01(item.transferScore, 0.5)}${errors}`;
  }).join('\n');
}

function buildProfileSection(profile: VirtualLearnerProfile): string {
  const p = profile.profile;
  const parts: string[] = [];
  
  if (p.age) parts.push(`年龄：${p.age}岁`);
  if (p.occupation) parts.push(`职业：${p.occupation}`);
  if (p.education) parts.push(`学历：${p.education}`);
  if (p.background) parts.push(`背景：${p.background}`);
  if (p.priorAttempts) parts.push(`之前的学习经历：${p.priorAttempts}`);
  
  if (parts.length === 0) {
    return '普通学习者';
  }
  
  return parts.join('\n');
}

function buildKnowledgeSection(profile: VirtualLearnerProfile): string {
  const levelDesc = {
    beginner: '初学者：对这个领域几乎没有了解，需要从基础开始',
    intermediate: '中级：有一定基础，了解基本概念，但缺乏实践经验',
    advanced: '高级：有较多经验和知识，希望进一步提升'
  };
  
  let section = levelDesc[profile.knowledgeLevel] || levelDesc.beginner;
  
  if (profile.knownConcepts && profile.knownConcepts.length > 0) {
    section += `\n\n已掌握的概念：${profile.knownConcepts.join('、')}`;
  }
  
  if (profile.struggleConcepts && profile.struggleConcepts.length > 0) {
    section += `\n\n感到困难的概念：${profile.struggleConcepts.join('、')}`;
  }
  
  return section;
}

function buildPersonalitySection(profile: VirtualLearnerProfile): string {
  const traits = profile.personalityTraits || {};
  
  const verbosityDesc = {
    terse: '回复简洁，通常1-2句话',
    normal: '回复适中，2-4句话',
    verbose: '回复详细，会展开说明'
  };
  
  const enthusiasmDesc = {
    low: '态度比较冷淡，不太主动',
    normal: '态度正常，有一定积极性',
    high: '态度热情，主动提问和表达'
  };
  
  const confusionDesc = {
    direct: '直接表达困惑和不懂',
    hinting: '暗示性表达困惑，不太直接说不懂'
  };
  
  const patienceDesc = {
    low: '耐心较少，如果对话太久会表现出不耐烦',
    normal: '耐心正常',
    high: '很有耐心，愿意花时间深入讨论'
  };
  
  const questionStyleDesc = {
    none: '不主动提问，被动回答',
    clarifying: '会在不确定时追问澄清',
    challenging: '会对方案提出质疑和自己的想法'
  };
  
  const emotionalRangeDesc = {
    flat: '情绪表达平淡，很少表现出明显情感',
    moderate: '情绪表达适中，会有一些情感波动',
    expressive: '情绪表达丰富，会明显表现出高兴、困惑等'
  };
  
  const parts: string[] = [];
  
  if (traits.verbosity) parts.push(`回复长度倾向：${verbosityDesc[traits.verbosity]}`);
  if (traits.enthusiasm) parts.push(`态度倾向：${enthusiasmDesc[traits.enthusiasm]}`);
  if (traits.confusionStyle) parts.push(`表达困惑的方式：${confusionDesc[traits.confusionStyle]}`);
  if (traits.patience) parts.push(`耐心程度：${patienceDesc[traits.patience]}`);
  if (traits.questionStyle) parts.push(`提问风格：${questionStyleDesc[traits.questionStyle]}`);
  if (traits.emotionalRange) parts.push(`情绪表达幅度：${emotionalRangeDesc[traits.emotionalRange]}`);
  
  if (parts.length === 0) {
    return '回复适中，态度正常，直接表达困惑';
  }
  
  return parts.join('\n');
}

function buildLearningStyleSection(profile: VirtualLearnerProfile): string {
  const style = profile.profile.learningStyle;
  if (!style) return '未特别设定';
  
  const styleDesc = {
    visual: '视觉学习：偏好图表、视频、演示',
    auditory: '听觉学习：偏好讲解、讨论、音频',
    reading: '阅读学习：偏好文字材料、文档',
    kinesthetic: '动手学习：偏好实践、练习、实验'
  };
  
  return styleDesc[style];
}

function buildMotivationSection(profile: VirtualLearnerProfile): string {
  const motivation = profile.profile.motivationType;
  if (!motivation) return '未特别设定';
  
  const motivationDesc = {
    career: '职业发展：学习是为了工作晋升或转行',
    interest: '兴趣爱好：纯粹出于兴趣学习',
    necessity: '实际需要：解决工作或生活中的具体问题',
    social: '社交需求：与他人交流、获得认可'
  };
  
  return motivationDesc[motivation];
}

function buildStageSection(context: SimulationContext): string {
  const historyLength = context.conversationHistory?.length || 0;
  const currentStage = context.currentStage;
  
  let stageDesc = '';
  let roundInfo = '';
  
  if (historyLength <= 3) {
    roundInfo = '对话初期（第1-3轮）：你应该主动介绍自己的情况和需求';
  } else if (historyLength <= 8) {
    roundInfo = '对话中期（第4-8轮）：认真回答导师的问题，必要时追问澄清';
  } else {
    roundInfo = '对话后期（第9轮+）：确认理解，表达对方案的看法，准备进入下一阶段';
  }
  
  if (currentStage === 'goal') {
    stageDesc = `目标澄清阶段：导师正在了解你的学习目标和背景${context.goalState?.stage ? `；系统判断当前子阶段=${context.goalState.stage}` : ''}`;
  } else if (currentStage === 'path') {
    stageDesc = '路径确认阶段：导师正在为你规划学习路径';
  } else if (currentStage === 'learning') {
    const milestone = context.learningState?.currentMilestone ? `；当前里程碑=${context.learningState.currentMilestone}` : '';
    const task = context.learningState?.currentTask ? `；当前任务=${typeof context.learningState.currentTask === 'string' ? context.learningState.currentTask : context.learningState.currentTask.title || '未命名任务'}` : '';
    stageDesc = `学习阶段：正在进行实际学习${milestone}${task}`;
  }

  if (currentStage === 'goal' && context.goalState?.missingFields?.length) {
    stageDesc += `\n仍待澄清的信息：${context.goalState.missingFields.join('、')}`;
  }
  
  return `${stageDesc}\n${roundInfo}`;
}

function buildStageBehaviorSection(context: SimulationContext): string {
  if (context.currentStage === 'goal') {
    return [
      '你是同一个人，不要每轮都像换了一个身份。职业、背景、动机、表达习惯要保持稳定。',
      '一个真实学习者通常不只有一个问题。可能同时有表层目标、真实困扰、时间限制、情绪压力、过去失败经历。',
      '不要一次性把这些都说完。优先回应当前被问到的内容，只在自然时补充 1 个最相关的新信息。',
      '不要把对方的问题重新包装成一段很完整的总结再还给对方，除非你真的在纠正误解。',
      '如果被问“具体场景/最近一次/举个例子”，就落到一个具体片段，给出事件、做法、结果，而不是回到抽象概括。',
      '允许口语里的停顿、修正、半句话、补充说明，不要写得像整理好的访谈记录或汇报材料。',
      '如果导师没有问到关键限制，你可以先保留，不必主动把所有隐藏条件一次性摊开。',
      '你可以在后续轮次逐步换到更深的重点，但不能前后像两个完全不同的人。',
      '如果你有多个问题，请围绕一个核心身份下的多个相关困扰展开，而不是罗列一堆彼此无关的需求。',
      '当系统逐渐理解你时，你的表达应更聚焦、更确认；如果仍被误解，可以补充新的细节或修正之前的说法。'
    ].join('\n');
  }

  if (context.currentStage === 'path') {
    return [
      '你是在评估一个是否适合自己的方案，不是礼貌性地默认接受。',
      '判断重点优先看：起点是否适合、是否解决真实问题、时间是否扛得住、第一步是否愿意开始。'
    ].join('\n');
  }

  return [
    '你是在真实学习，不是在配合老师把流程走完。',
    '如果没懂、记不住、想跳步、注意力下降，都可以自然表现出来。'
  ].join('\n');
}

function buildConcernPoolSection(context: SimulationContext): string {
  if (context.currentStage !== 'goal') return '当前阶段不需要关切池。';

  const concernPool = context.goalState?.concernPool;
  const disclosedConcerns = Array.isArray(context.goalState?.disclosedConcerns) ? context.goalState.disclosedConcerns : [];

  if (!concernPool) {
    return '如果没有显式关切池，就只围绕当前被问到的问题自然作答。';
  }

  const primary = (concernPool.primary || []).filter((item: string) => !disclosedConcerns.includes(item));
  const secondary = (concernPool.secondary || []).filter((item: string) => !disclosedConcerns.includes(item));
  const hidden = (concernPool.hidden || []).filter((item: string) => !disclosedConcerns.includes(item));

  return [
    `已暴露关切：${disclosedConcerns.length ? disclosedConcerns.join('；') : '暂无'}`,
    `主问题：${primary.length ? primary.join('；') : '暂无'}`,
    `次问题：${secondary.length ? secondary.join('；') : '暂无'}`,
    `隐性限制：${hidden.length ? hidden.join('；') : '暂无'}`,
    '规则：优先围绕主问题回应；必要时再自然带出 1 个次问题；隐性限制只有在被问到或情境强相关时才露出。'
  ].join('\n');
}

function buildHistorySection(history: SimulationContext['conversationHistory']): string {
  if (!history || history.length === 0) {
    return '（这是对话的开始）';
  }
  
  const lines = history.map((item, index) => {
    const roleLabel = item.role === 'user' ? '你（虚拟用户）' : 'AI导师';
    return `${index + 1}. ${roleLabel}: ${item.content}`;
  });
  
  return lines.join('\n');
}

export function buildSimulationPrompt(context: SimulationContext): string {
  const profile = context.profile;
  
  const profileSection = buildProfileSection(profile);
  const goalSection = profile.learningGoal;
  const knowledgeSection = buildKnowledgeSection(profile);
  const personalitySection = buildPersonalitySection(profile);
  const learningStyleSection = buildLearningStyleSection(profile);
  const motivationSection = buildMotivationSection(profile);
  const stageSection = buildStageSection(context);
  const stageBehaviorSection = buildStageBehaviorSection(context);
  const concernPoolSection = buildConcernPoolSection(context);
  const historySection = buildHistorySection(context.conversationHistory);
  const learnerStateSection = buildLearnerStateSection(context.learnerState);
  const knowledgeStateSection = buildKnowledgeStateSection(context.knowledgeState);
  const lastMessage = context.lastAssistantMessage || '（等待开始对话）';
  
  let prompt = DEFAULT_SIMULATION_PROMPT
    .replace('{PROFILE_SECTION}', profileSection)
    .replace('{GOAL_SECTION}', goalSection)
    .replace('{KNOWLEDGE_SECTION}', knowledgeSection)
    .replace('{PERSONALITY_SECTION}', personalitySection)
    .replace('{LEARNING_STYLE_SECTION}', learningStyleSection)
    .replace('{MOTIVATION_SECTION}', motivationSection)
    .replace('{STAGE_SECTION}', stageSection)
    .replace('{STAGE_BEHAVIOR_SECTION}', stageBehaviorSection)
    .replace('{CONCERN_POOL_SECTION}', concernPoolSection)
    .replace('{LEARNER_STATE_SECTION}', learnerStateSection)
    .replace('{KNOWLEDGE_STATE_SECTION}', knowledgeStateSection)
    .replace('{CONVERSATION_HISTORY}', historySection)
    .replace('{LAST_MESSAGE}', lastMessage);
  
  if (profile.simulationPrompt) {
    prompt = prompt + '\n\n## 自定义行为指导\n\n' + profile.simulationPrompt;
  }
  
  return prompt;
}

export const PROFILE_GENERATION_PROMPT = `你是一个学习者画像生成器。根据学习目标和知识水平，生成一个真实、可信的学习者画像。

## 学习目标

{LEARNING_GOAL}

## 知识水平

{KNOWLEDGE_LEVEL}

## 模拟模式

{SIMULATION_MODE}

## 任务

请生成一个符合上述学习目标和知识水平的学习者画像。画像应该：

1. **真实可信**：年龄、职业、学历、背景之间有逻辑关联
2. **目标匹配**：背景经历能解释为什么想学这个目标
3. **水平一致**：学历和背景要符合设定的知识水平
4. **有故事感**：背景描述要有一定细节，不是泛泛而谈
5. **学习偏好合理**：学习风格和动机类型要匹配背景
6. **技术舒适度合理**：根据职业和年龄设定合适的技术水平

## 输出格式

只输出一个JSON对象：
{
  "age": 数字（18-60之间）,
  "occupation": "职业名称",
  "education": "学历（如：本科、硕士、大专、高中）",
  "background": "背景描述（2-4句话，说明为什么想学这个目标，有什么相关经历或困难）",
  "learningStyle": "visual/auditory/reading/kinesthetic",
  "motivationType": "career/interest/necessity/social",
  "availableTime": "minimal/moderate/abundant",
  "techComfort": "low/medium/high",
  "priorAttempts": "可选，之前学习过相关内容但失败的经历",
  "personalityTraits": {
    "verbosity": "terse/normal/verbose",
    "enthusiasm": "low/normal/high",
    "confusionStyle": "direct/hinting",
    "patience": "low/normal/high",
    "questionStyle": "none/clarifying/challenging",
    "emotionalRange": "flat/moderate/expressive"
  }
}

不要输出其他任何内容。`;

function getKnowledgeLevelDesc(level: string): string {
  const descs = {
    beginner: '初学者：对这个领域几乎没有了解，需要从基础概念开始学习',
    intermediate: '中级：有一定基础，了解基本概念，但缺乏实践经验或深度理解',
    advanced: '高级：有较多经验和知识，希望进一步提升或掌握前沿内容'
  };
  return descs[level] || descs.beginner;
}

export function buildProfileGenerationPrompt(
  learningGoal: string,
  knowledgeLevel: string,
  simulationMode?: string,
  personalityTraits?: any
): string {
  let prompt = PROFILE_GENERATION_PROMPT
    .replace('{LEARNING_GOAL}', learningGoal)
    .replace('{KNOWLEDGE_LEVEL}', getKnowledgeLevelDesc(knowledgeLevel))
    .replace('{SIMULATION_MODE}', simulationMode === 'ai' ? 'AI自动扮演（需要生成性格设定）' : '手动控制（性格设定可选）');
  
  if (personalityTraits) {
    prompt += `\n\n## 已有性格设定提示\n\n用户已预设性格倾向，生成时参考这些倾向：\n- 回复长度倾向：${personalityTraits.verbosity || 'normal'}\n- 态度倾向：${personalityTraits.enthusiasm || 'normal'}\n- 表达困惑方式：${personalityTraits.confusionStyle || 'direct'}\n- 耐心程度：${personalityTraits.patience || 'normal'}\n- 提问风格：${personalityTraits.questionStyle || 'none'}\n- 情绪表达幅度：${personalityTraits.emotionalRange || 'moderate'}`;
  }
  
  return prompt;
}

export const PATH_REACTION_PROMPT = `你是一个虚拟学习者，正在审视为你生成的学习路径方案。

## 你的画像

{PROFILE_SECTION}

## 路径方案

{PATH_DATA_SECTION}

## 你的当前学习状态

{LEARNER_STATE_SECTION}

## 你的知识状态

{KNOWLEDGE_STATE_SECTION}

## 任务

请以你角色的身份审视这个学习路径方案，给出你的反应。考虑：

1. **目标匹配**：它是不是在解决你真正想解决的问题？
2. **难度匹配**：路径难度是否适合你的知识水平？
3. **时间可行性**：你能投入的时间和路径要求是否匹配？
4. **前置匹配**：是否从你当前真实起点出发，还是默认你已经会了不该会的内容？
5. **动机匹配**：学习内容和第一步交付是否符合你的动机和耐心？
6. **整体感受**：你对这个方案的整体看法

## 输出格式

只输出一个JSON对象：
{
  "reaction": "你对路径的反应（2-4句话，口语化表达）",
  "decision": "accept/modify/reject",
  "modifyRequest": "可选，如果decision是modify，说明你希望怎么修改",
  "confidence": 数字（0-1，你对这个路径能帮达成目标的信心程度）, 
  "reasons": {
    "goalAlignment": 0.0,
    "difficultyFit": 0.0,
    "timeFit": 0.0,
    "prerequisiteFit": 0.0,
    "motivationFit": 0.0
  },
  "biggestConcern": "一句话指出你最担心的问题"
}

不要输出其他任何内容。`;

export const TASK_REACTION_PROMPT = `你是一个虚拟学习者，正在学习一个任务。

## 你的画像

{PROFILE_SECTION}

## 当前任务内容

{TASK_DATA_SECTION}

## 你的当前学习状态

{LEARNER_STATE_SECTION}

## 你的知识状态

{KNOWLEDGE_STATE_SECTION}

## 任务

请以你角色的身份对当前学习任务给出反应。考虑：

1. **理解程度**：你是否理解这个任务要做什么？
2. **难度感受**：这个任务对你来说难度如何？
3. **学习进展**：你感觉学到了什么？
4. **错误倾向**：如果你会犯错，会以你稳定的错误风格犯错
5. **伪理解**：如果你自我感觉已经懂了但实际没有完全掌握，可以表现出来

## 输出格式

只输出一个JSON对象：
{
  "reply": "你在当前任务下会说的话（2-3句话）",
  "thoughtProcess": "可选，你为什么会这样反应",
  "emotion": "可选，当前情绪状态（neutral/slightly_frustrated/happy/confident/confused）",
  "learnerState": {
    "understandingLevel": 0.0,
    "perceivedDifficulty": 0.0,
    "confusionLevel": 0.0,
    "frustrationLevel": 0.0,
    "motivationLevel": 0.0,
    "selfPerceivedMastery": 0.0,
    "actualMastery": 0.0,
    "memoryStrength": 0.0,
    "wantsClarification": false,
    "readyToAdvance": false,
    "attentionLevel": 0.0,
    "persistenceLevel": 0.0,
    "remainingUnknowns": ["..."],
    "detectedMisconceptions": ["..."],
    "stableErrorStyle": ["..."]
  }
}

不要输出其他任何内容。`;

export function buildReactionPrompt(context: ReactionContext): string {
  const profileSection = buildProfileSection(context.profile);
  const learnerStateSection = buildLearnerStateSection(context.learnerState);
  const knowledgeStateSection = buildKnowledgeStateSection(context.knowledgeState);
  
  if (context.reactionTarget === 'path_proposal') {
    const pathDataSection = JSON.stringify(context.targetData, null, 2);
    return PATH_REACTION_PROMPT
      .replace('{PROFILE_SECTION}', profileSection)
      .replace('{PATH_DATA_SECTION}', pathDataSection)
      .replace('{LEARNER_STATE_SECTION}', learnerStateSection)
      .replace('{KNOWLEDGE_STATE_SECTION}', knowledgeStateSection);
  }
  
  if (context.reactionTarget === 'task_content') {
    const taskDataSection = JSON.stringify(context.targetData, null, 2);
    return TASK_REACTION_PROMPT
      .replace('{PROFILE_SECTION}', profileSection)
      .replace('{TASK_DATA_SECTION}', taskDataSection)
      .replace('{LEARNER_STATE_SECTION}', learnerStateSection)
      .replace('{KNOWLEDGE_STATE_SECTION}', knowledgeStateSection);
  }
  
  return '';
}
