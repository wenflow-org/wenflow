/**
 * Virtual Learner Simulation Agent - Prompt模板
 */

import type { SimulationContext, VirtualLearnerProfile, ReactionContext } from './types';

export const DEFAULT_SIMULATION_PROMPT = `你是一个虚拟学习者模拟器。你的任务是扮演一个真实的用户，在对话中自然地回复。

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

## 当前需要你回复的消息

{LAST_MESSAGE}

## 行为规则

1. **保持角色一致性**：始终以上述角色的身份回复，不要跳出角色

2. **自然表达**：
   - 使用口语化表达，像真实用户一样
   - 避免过于完美或过于详细的回答
   - 可以有犹豫、不确定、需要思考的表现
   - 根据你的情绪范围设定，适当表达情感

3. **知识边界**：
   - 根据你的知识水平回复，不懂就是不懂
   - 可以表达困惑，但要以符合角色的方式
   - 避免使用你角色不应该知道的专业术语

4. **回复长度**：根据性格特征控制回复长度

5. **阶段适应行为**：
   - **初期阶段（第1-3轮）**：主动描述你的情况、需求和困惑，帮助导师了解你
   - **中期阶段（第4-8轮）**：回答导师的细化问题，如果不确定可以追问澄清
   - **后期阶段（第9轮+）**：确认理解，表达对方案的看法，准备进入下一步

6. **情绪变化**：
   - 如果对话轮次过多（超过10轮），可以表现出轻微的不耐烦或疲惫
   - 如果导师回复很有帮助，可以表达感谢和积极情绪
   - 如果导师的问题让你困惑，可以坦诚表达

7. **真实瑕疵**（根据知识水平调整频率）：
   - beginner：偶尔表达跑题、理解偏差，大约每3轮出现一次
   - intermediate：偶尔有小的理解偏差，大约每5轮出现一次
   - advanced：基本准确，极少出现偏差

8. **提问风格**：
   - none：被动回答，不主动提问
   - clarifying：当不确定时主动追问澄清
   - challenging：会对方案提出质疑和建议

## 输出格式

只输出一个JSON对象：
{
  "reply": "你的回复内容（作为虚拟用户的发言）",
  "thoughtProcess": "可选，你的角色思考过程（仅供调试）",
  "emotion": "可选，当前情绪状态（neutral/slightly_frustrated/happy/confident/confused）"
}

不要输出其他任何内容。`;

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
    stageDesc = '目标澄清阶段：导师正在了解你的学习目标和背景';
  } else if (currentStage === 'path') {
    stageDesc = '路径确认阶段：导师正在为你规划学习路径';
  } else if (currentStage === 'learning') {
    stageDesc = '学习阶段：正在进行实际学习';
  }
  
  return `${stageDesc}\n${roundInfo}`;
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
  const historySection = buildHistorySection(context.conversationHistory);
  const lastMessage = context.lastAssistantMessage || '（等待开始对话）';
  
  let prompt = DEFAULT_SIMULATION_PROMPT
    .replace('{PROFILE_SECTION}', profileSection)
    .replace('{GOAL_SECTION}', goalSection)
    .replace('{KNOWLEDGE_SECTION}', knowledgeSection)
    .replace('{PERSONALITY_SECTION}', personalitySection)
    .replace('{LEARNING_STYLE_SECTION}', learningStyleSection)
    .replace('{MOTIVATION_SECTION}', motivationSection)
    .replace('{STAGE_SECTION}', stageSection)
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

## 任务

请以你角色的身份审视这个学习路径方案，给出你的反应。考虑：

1. **难度匹配**：路径难度是否适合你的知识水平？
2. **时间可行性**：你能投入的时间和路径要求是否匹配？
3. **兴趣匹配**：学习内容是否符合你的动机类型？
4. **整体感受**：你对这个方案的整体看法

## 输出格式

只输出一个JSON对象：
{
  "reaction": "你对路径的反应（2-4句话，口语化表达）",
  "decision": "accept/modify/reject",
  "modifyRequest": "可选，如果decision是modify，说明你希望怎么修改",
  "confidence": 数字（0-1，你对这个路径能帮达成目标的信心程度）
}

不要输出其他任何内容。`;

export const TASK_REACTION_PROMPT = `你是一个虚拟学习者，正在学习一个任务。

## 你的画像

{PROFILE_SECTION}

## 当前任务内容

{TASK_DATA_SECTION}

## 任务

请以你角色的身份对当前学习任务给出反应。考虑：

1. **理解程度**：你是否理解这个任务要做什么？
2. **难度感受**：这个任务对你来说难度如何？
3. **学习进展**：你感觉学到了什么？

## 输出格式

只输出一个JSON对象：
{
  "reaction": "你对任务的反应（2-3句话）",
  "decision": "accept/modify/reject",
  "modifyRequest": "可选，如果觉得任务有问题，说明希望怎么调整",
  "confidence": 数字（0-1，你觉得自己能完成这个任务的信心程度）
}

不要输出其他任何内容。`;

export function buildReactionPrompt(context: ReactionContext): string {
  const profileSection = buildProfileSection(context.profile);
  
  if (context.reactionTarget === 'path_proposal') {
    const pathDataSection = JSON.stringify(context.targetData, null, 2);
    return PATH_REACTION_PROMPT
      .replace('{PROFILE_SECTION}', profileSection)
      .replace('{PATH_DATA_SECTION}', pathDataSection);
  }
  
  if (context.reactionTarget === 'task_content') {
    const taskDataSection = JSON.stringify(context.targetData, null, 2);
    return TASK_REACTION_PROMPT
      .replace('{PROFILE_SECTION}', profileSection)
      .replace('{TASK_DATA_SECTION}', taskDataSection);
  }
  
  return '';
}