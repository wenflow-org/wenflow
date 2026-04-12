/**
 * 隐形干预策略模块
 * 
 * 核心原则：学生感觉不到你在干预，但行为被引导了
 */

import { LearningState, LSSLevel } from './learning-state';

// 干预策略类型
export type InterventionType = 
  | 'empathy_first'      // 共情优先
  | 'socratic_probe'     // 苏格拉底式追问
  | 'quick_win'          // 快速成就感
  | 'decompose'          // 任务拆解
  | 'backtrack'          // 回溯前置知识
  | 'ice_breaker'        // 破冰/放松
  | 'encourage_try'      // 鼓励尝试
  | 'predict_first';     // 先预测再验证

// 干预策略定义
export interface InterventionStrategy {
  name: string;
  type: InterventionType;
  style: string;
  tone: 'casual' | 'curious' | 'energetic' | 'relaxed' | 'encouraging';
  technique: string;
  instruction: string;
  example: string;
  priority: number;
}

// 状态→策略映射表
const STATE_TO_STRATEGY_MAP: Array<{
  name: string;
  trigger: (state: LearningState) => boolean;
  strategy: InterventionStrategy;
}> = [
  {
    name: '挫败 + 低掌握',
    trigger: (s) => s.emotion.frustration > 0.6 && s.understanding.mastery < 0.4,
    strategy: {
      name: '任务拆解',
      type: 'decompose',
      style: 'supportive',
      tone: 'casual',
      technique: 'micro_steps',
      instruction: '将任务拆解为 3 个超小步骤，每步≤30 秒完成',
      example: '没事，咱们把这个大象放进冰箱，分三步走：1... 2... 3...',
      priority: 1
    }
  },
  
  {
    name: '低深度 + 高专注',
    trigger: (s) => s.cognitiveEngagement.depthScore < 0.3 && s.emotion.focus > 0.7,
    strategy: {
      name: '苏格拉底追问',
      type: 'socratic_probe',
      style: 'socratic',
      tone: 'curious',
      technique: 'what_if_question',
      instruction: '提出"为什么"或"如果...会怎样"类问题',
      example: '你写对了，但你想过如果把这一行删掉，程序会报什么错吗？',
      priority: 5
    }
  },
  
  {
    name: '高压力 + 高成就',
    trigger: (s) => s.lss.level === 'yellow' && s.emotion.achievement > 0.7,
    strategy: {
      name: '快速收尾',
      type: 'quick_win',
      style: 'encouraging',
      tone: 'energetic',
      technique: 'quick_close',
      instruction: '快速收尾，让学生带着成就感离开',
      example: '今天手感热得发烫！搞定最后这个小功能我们就收工！',
      priority: 3
    }
  },
  
  {
    name: '沉默 + 疲劳',
    trigger: (s) => s.behavior.silenceCount >= 2 && s.lf.value > 6,
    strategy: {
      name: '破冰放松',
      type: 'ice_breaker',
      style: 'friendly',
      tone: 'relaxed',
      technique: 'break_suggestion',
      instruction: '讲个冷笑话/黑客小故事，然后建议休息',
      example: '（讲个冷笑话）说真的，你要不要去喝口水？我等你回来。',
      priority: 4
    }
  },
  
  {
    name: '连续错误',
    trigger: (s) => s.behavior.consecutiveErrors >= 3,
    strategy: {
      name: '回溯讲解',
      type: 'backtrack',
      style: 'patient',
      tone: 'casual',
      technique: 'backtrack',
      instruction: '退回前置知识点，重新讲解',
      example: '我们发现这个问题根源在前面的 XXX，我们快速回顾一下...',
      priority: 2
    }
  },
  
  {
    name: '复制不运行',
    trigger: (s) => s.behavior.copyWithoutRun >= 2,
    strategy: {
      name: '先预测',
      type: 'predict_first',
      style: 'interactive',
      tone: 'curious',
      technique: 'predict_first',
      instruction: '要求先预测输出，再运行验证',
      example: '先别急着运行，你猜猜这行代码会输出什么？',
      priority: 6
    }
  },
  
  {
    name: '没尝试就问',
    trigger: (s) => s.behavior.askBeforeTry >= 2,
    strategy: {
      name: '鼓励尝试',
      type: 'encourage_try',
      style: 'encouraging',
      tone: 'encouraging',
      technique: 'encourage_try',
      instruction: '鼓励先尝试，承诺会帮助',
      example: '你先写写看，写错了也没关系，我会帮你看的！',
      priority: 7
    }
  },
  
  {
    name: '极高挫败感',
    trigger: (s) => s.emotion.frustration > 0.8,
    strategy: {
      name: '情绪疏导',
      type: 'empathy_first',
      style: 'empathy',
      tone: 'casual',
      technique: 'reframe',
      instruction: '停止教学，进行情绪疏导，用轻松的方式重新表述问题',
      example: '害，这部分确实绕。咱们换个思路，如果你要把这行代码解释给你奶奶听，你会怎么说？',
      priority: 0 // 最高优先级
    }
  },
  
  {
    name: '红色压力预警',
    trigger: (s) => s.lss.level === 'red',
    strategy: {
      name: '紧急暂停',
      type: 'ice_breaker',
      style: 'friendly',
      tone: 'relaxed',
      technique: 'emergency_break',
      instruction: '建议暂停学习，给予肯定和鼓励',
      example: '今天已经学了不少了，你现在的状态需要休息一下。咱们下次继续，你做得很好！',
      priority: 0 // 最高优先级
    }
  }
];

// 教学风格指令模板
const STYLE_INSTRUCTIONS: Record<string, string> = {
  supportive: `【对话风格】
- 语气：轻松、亲切
- 多用"咱们"、"我们一起"
- 把困难描述为"有趣的小挑战"`,
  
  socratic: `【对话风格】
- 语气：好奇、引导
- 多用"你觉得呢？"、"如果是...会怎样？"
- 不直接给答案，引导学生思考`,
  
  encouraging: `【对话风格】
- 语气：热情、肯定
- 多用"太棒了"、"这就对了"、"你发现了关键！"
- 强调进步和成就`,
  
  empathy: `【对话风格】
- 语气：理解、轻松
- 先承认困难，再给出新视角
- 用幽默化解紧张`,
  
  interactive: `【对话风格】
- 语气：互动、激发
- 多用"你来试试"、"你猜猜"
- 让学生参与而不是被动接受`,
  
  patient: `【对话风格】
- 语气：耐心、温和
- 放慢节奏，详细解释
- 用生活化类比帮助理解`,
  
  friendly: `【对话风格】
- 语气：友好、轻松
- 可以适当开玩笑
- 像朋友一样对话`
};

// 冷笑话库
const JOKES = [
  '为什么程序员总是分不清万圣节和圣诞节？因为 Oct 31 == Dec 25',
  '一个 SQL 语句走进酒吧，看到两张表，问道："我能 JOIN 你们吗？"',
  '有 10 种人：懂二进制的和不懂的',
  '为什么 Java 开发者戴眼镜？因为他们看不到 C#（C Sharp）',
  '程序员最讨厌什么？1. 写文档 2. 别人不写文档 3. 列表从 1 开始',
  'Debug 就像当侦探，但你自己就是凶手'
];

// 黑客小故事
const HACKER_STORIES = [
  '你知道吗？第一个计算机 Bug 是一只真的虫子——1947年，一只飞蛾飞进了哈佛的计算机继电器里。',
  'Linux 的创始人 Linus Torvalds 当年只是想写个终端模拟器，结果不小心写出了整个操作系统内核。',
  'Python 的名字来源于英国喜剧团体 Monty Python，创始人 Guido 在看他们的节目时想出来的。',
  '第一个网页浏览器是由 Tim Berners-Lee 写的，他同时也发明了 WWW。'
];

/**
 * 选择干预策略
 */
export function selectStrategy(state: LearningState): InterventionStrategy | null {
  // 按优先级排序
  const sorted = [...STATE_TO_STRATEGY_MAP].sort(
    (a, b) => a.strategy.priority - b.strategy.priority
  );

  for (const mapping of sorted) {
    if (mapping.trigger(state)) {
      return mapping.strategy;
    }
  }

  return null;
}

/**
 * 生成风格指令 Prompt
 */
export function generateStylePrompt(strategy: InterventionStrategy | null): string {
  if (!strategy) return '';
  
  const styleInstruction = STYLE_INSTRUCTIONS[strategy.style] || '';
  
  return `${styleInstruction}

【教学技巧】
- 方法：${strategy.technique}
- 指令：${strategy.instruction}

【示例风格】
${strategy.example}

⚠️ 重要：不要直接提及学生的情绪状态或学习问题，通过调整你的表达方式来引导
`;
}

/**
 * 获取一个冷笑话
 */
export function getJoke(): string {
  return JOKES[Math.floor(Math.random() * JOKES.length)];
}

/**
 * 获取一个黑客故事
 */
export function getHackerStory(): string {
  return HACKER_STORIES[Math.floor(Math.random() * HACKER_STORIES.length)];
}

/**
 * 根据策略类型生成特定内容
 */
export function generateStrategyContent(
  strategy: InterventionStrategy,
  context: { topic: string; previousContent?: string }
): string {
  switch (strategy.type) {
    case 'decompose':
      return `把"${context.topic}"拆成三个小任务，每步用一句大白话说明`;
      
    case 'socratic_probe':
      return `提出一个"如果...会怎样"的问题，引导学生深入思考`;
      
    case 'quick_win':
      return `设计一个超简单的练习，让学生立刻获得成功体验`;
      
    case 'backtrack':
      return `回顾前置知识点，用类比重新解释`;
      
    case 'ice_breaker':
      return `先讲个冷笑话：${getJoke()}，然后自然过渡`;
      
    case 'encourage_try':
      return `鼓励学生先尝试，强调错误是学习的一部分`;
      
    case 'predict_first':
      return `展示代码，让学生先预测输出结果`;
      
    case 'empathy_first':
      return `承认这部分确实难，然后用生活类比重新解释`;
      
    default:
      return '';
  }
}

export default {
  selectStrategy,
  generateStylePrompt,
  getJoke,
  getHackerStory,
  generateStrategyContent
};
