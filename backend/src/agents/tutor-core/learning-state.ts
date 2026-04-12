/**
 * 教学状态管理模块
 * 
 * 管理学生的学习状态，包括：
 * - 认知深度（带时间衰减）
 * - 情绪状态
 * - 学习压力（LSS）
 * - 行为特征
 */

// 认知层级
export type CognitiveLevel = 'ski' | 'mki' | 'dki'; // 浅层/中层/深层

// 学习压力等级
export type LSSLevel = 'green' | 'yellow' | 'red';

// 学生状态快照
export interface StudentStateSnapshot {
  currentTopic: string;           // 当前知识点
  mastery: number;                // 掌握度 0-1
  frustration: number;            // 挫败感 0-1
  focus: number;                  // 专注度 0-1
  achievement: number;            // 成就感 0-1
  lssLevel: LSSLevel;             // 学习压力等级
  depthScore: number;             // 认知深度 0-1
  consecutiveErrors: number;      // 连续错误次数
  silenceCount: number;           // 沉默次数
  timeInSession: number;          // 本次学习时长（分钟）
}

// 完整学习状态
export interface LearningState {
  // 知识理解
  understanding: {
    currentTopic: string;
    mastery: number;
    knowledgeGaps: string[];
  };
  
  // 情绪状态
  emotion: {
    frustration: number;
    focus: number;
    achievement: number;
    confidence: number;
  };
  
  // 学习压力（LSS/KTL/LF）
  lss: {
    level: LSSLevel;
    value: number;
  };
  ktl: {
    value: number;
  };
  lf: {
    value: number;
  };
  
  // 认知参与度
  cognitiveEngagement: {
    depthScore: number;
    history: Array<{
      level: CognitiveLevel;
      timestamp: number;
    }>;
  };
  
  // 行为特征
  behavior: {
    consecutiveErrors: number;
    silenceCount: number;
    copyWithoutRun: number;
    askBeforeTry: number;
    responseTime: number[];
  };
  
  // 会话信息
  session: {
    startTime: number;
    messageCount: number;
    topics: string[];
  };
}

// 认知层级权重
const LEVEL_WEIGHTS: Record<CognitiveLevel, number> = {
  ski: 1,  // 浅层知识互动
  mki: 2,  // 中层知识互动
  dki: 3   // 深层知识互动
};

/**
 * 创建初始学习状态
 */
export function createInitialLearningState(topic: string): LearningState {
  return {
    understanding: {
      currentTopic: topic,
      mastery: 0,
      knowledgeGaps: []
    },
    emotion: {
      frustration: 0,
      focus: 0.7,
      achievement: 0,
      confidence: 0.5
    },
    lss: {
      level: 'green',
      value: 0
    },
    ktl: {
      value: 0
    },
    lf: {
      value: 0
    },
    cognitiveEngagement: {
      depthScore: 0.5,
      history: []
    },
    behavior: {
      consecutiveErrors: 0,
      silenceCount: 0,
      copyWithoutRun: 0,
      askBeforeTry: 0,
      responseTime: []
    },
    session: {
      startTime: Date.now(),
      messageCount: 0,
      topics: [topic]
    }
  };
}

/**
 * 生成状态快照（用于 Prompt 注入）
 */
export function generateStateSnapshot(state: LearningState): {
  snapshot: StudentStateSnapshot;
  emergency: string | null;
} {
  const snapshot: StudentStateSnapshot = {
    currentTopic: state.understanding.currentTopic,
    mastery: state.understanding.mastery,
    frustration: state.emotion.frustration,
    focus: state.emotion.focus,
    achievement: state.emotion.achievement,
    lssLevel: state.lss.level,
    depthScore: state.cognitiveEngagement.depthScore,
    consecutiveErrors: state.behavior.consecutiveErrors,
    silenceCount: state.behavior.silenceCount,
    timeInSession: Math.round((Date.now() - state.session.startTime) / 60000)
  };

  const emergency = checkEmergency(snapshot);

  return { snapshot, emergency };
}

/**
 * 检查是否需要紧急干预
 */
function checkEmergency(snapshot: StudentStateSnapshot): string | null {
  if (snapshot.frustration > 0.8) {
    return '[EMERGENCY_INSTRUCTION]: 学生挫败感极高，停止教学，立即进行情绪疏导';
  }
  if (snapshot.lssLevel === 'red') {
    return '[EMERGENCY_INSTRUCTION]: 学习压力红色预警，建议暂停或降低难度';
  }
  if (snapshot.depthScore < 0.2 && snapshot.focus > 0.7) {
    return '[PRIORITY_INSTRUCTION]: 认知深度不足，尝试提出"为什么"类问题引导深层思考';
  }
  if (snapshot.consecutiveErrors >= 3) {
    return '[PRIORITY_INSTRUCTION]: 连续错误过多，退回前置知识点重新讲解';
  }
  return null;
}

/**
 * 计算时间权重（指数衰减）
 */
function calculateTimeWeight(position: number, total: number, decayRate = 0.5): number {
  return Math.pow(1 - decayRate, position);
}

/**
 * 计算加权认知深度分数
 */
export function calculateWeightedDepthScore(
  history: Array<{ level: CognitiveLevel; timestamp: number }>,
  windowSize = 10
): number {
  const recent = history.slice(-windowSize);
  
  if (recent.length === 0) return 0.5;
  
  let weightedSum = 0;
  let weightTotal = 0;

  recent.forEach((msg, index) => {
    const position = recent.length - 1 - index; // 0 = 最新
    const weight = calculateTimeWeight(position, recent.length);
    const level = LEVEL_WEIGHTS[msg.level];

    weightedSum += level * weight;
    weightTotal += weight;
  });

  // 归一化到 0-1（假设全是 DKI 时为最大值）
  const maxPossible = 3 * weightTotal;
  return weightedSum / maxPossible;
}

/**
 * 分析消息的认知层级
 */
export function analyzeCognitiveLevel(message: string): CognitiveLevel {
  const lowerMessage = message.toLowerCase();
  
  // 深层认知指标
  const deepIndicators = [
    '为什么', '怎么理解', '原理是什么', '底层', '本质',
    '如果...会怎样', '如果不', '区别是什么', '对比',
    '优化', '更好的方法', '深入', '扩展'
  ];
  
  // 中层认知指标
  const mediumIndicators = [
    '怎么实现', '怎么写', '如何', '例子', '示例',
    '这段代码', '解释一下', '什么意思', '有什么用',
    '步骤', '流程', '顺序'
  ];
  
  // 浅层认知指标
  const shallowIndicators = [
    '是什么', '是什么意思', '定义', '语法', '怎么用',
    '报错了', '错误', '不对', '不清楚', '不懂'
  ];

  // 计算各层级匹配度
  const deepScore = deepIndicators.filter(i => lowerMessage.includes(i)).length;
  const mediumScore = mediumIndicators.filter(i => lowerMessage.includes(i)).length;
  const shallowScore = shallowIndicators.filter(i => lowerMessage.includes(i)).length;

  if (deepScore > mediumScore && deepScore > shallowScore) return 'dki';
  if (mediumScore > shallowScore) return 'mki';
  return 'ski';
}

/**
 * 更新认知参与度
 */
export function updateCognitiveEngagement(
  state: LearningState,
  studentMessage: string
): void {
  const level = analyzeCognitiveLevel(studentMessage);

  state.cognitiveEngagement.history.push({
    level,
    timestamp: Date.now()
  });

  // 保持窗口大小
  if (state.cognitiveEngagement.history.length > 10) {
    state.cognitiveEngagement.history.shift();
  }

  // 重新计算深度分数
  state.cognitiveEngagement.depthScore = calculateWeightedDepthScore(
    state.cognitiveEngagement.history
  );
}

/**
 * 更新情绪状态
 */
export function updateEmotion(
  state: LearningState,
  studentMessage: string,
  isCorrect: boolean | null
): void {
  const lowerMessage = studentMessage.toLowerCase();
  
  // 检测挫败感指标
  const frustrationIndicators = [
    '不懂', '不会', '太难', '搞不定', '搞不懂', '头疼',
    '烦', '放弃', '不明白', '不理解', 'confused', 'stuck'
  ];
  const frustrationCount = frustrationIndicators.filter(i => lowerMessage.includes(i)).length;
  
  // 更新挫败感（平滑更新）
  const newFrustration = Math.min(1, frustrationCount * 0.15 + state.emotion.frustration * 0.7);
  state.emotion.frustration = newFrustration;
  
  // 更新成就感
  if (isCorrect === true) {
    state.emotion.achievement = Math.min(1, state.emotion.achievement + 0.15);
    state.emotion.confidence = Math.min(1, state.emotion.confidence + 0.1);
    state.behavior.consecutiveErrors = 0;
  } else if (isCorrect === false) {
    state.emotion.achievement = Math.max(0, state.emotion.achievement - 0.1);
    state.behavior.consecutiveErrors++;
  }
  
  // 检测专注度
  const focusIndicators = ['继续', '下一个', '然后', '好的', '明白', '懂了'];
  const hasFocus = focusIndicators.some(i => lowerMessage.includes(i));
  if (hasFocus) {
    state.emotion.focus = Math.min(1, state.emotion.focus + 0.1);
  }
  
  // 检测沉默（消息过短）
  if (studentMessage.trim().length < 10) {
    state.behavior.silenceCount++;
  } else {
    state.behavior.silenceCount = Math.max(0, state.behavior.silenceCount - 1);
  }
}

/**
 * 更新学习压力状态（LSS/KTL/LF）
 */
export function updateLearningPressure(state: LearningState): void {
  // 简化的 LSS 计算
  const baseLSS = state.understanding.mastery * 0.3 +
                  state.emotion.frustration * 0.4 +
                  (1 - state.emotion.focus) * 0.3;
  
  state.lss.value = baseLSS;
  
  if (baseLSS > 0.7) {
    state.lss.level = 'red';
  } else if (baseLSS > 0.4) {
    state.lss.level = 'yellow';
  } else {
    state.lss.level = 'green';
  }
  
  // 更新疲劳度（LF）
  const sessionMinutes = (Date.now() - state.session.startTime) / 60000;
  state.lf.value = Math.min(10, sessionMinutes / 10 + state.behavior.consecutiveErrors * 0.5);
}

/**
 * 更新行为特征
 */
export function updateBehavior(state: LearningState, studentMessage: string): void {
  const lowerMessage = studentMessage.toLowerCase();
  
  // 检测复制粘贴行为
  if (lowerMessage.includes('复制') || lowerMessage.includes('粘贴')) {
    state.behavior.copyWithoutRun++;
  }
  
  // 检测未尝试就问
  const askBeforeTryIndicators = ['怎么做', '答案', '直接告诉我', '给代码'];
  if (askBeforeTryIndicators.some(i => lowerMessage.includes(i))) {
    state.behavior.askBeforeTry++;
  }
}

/**
 * 组装状态快照 Prompt
 */
export function assembleStatePrompt(
  snapshot: StudentStateSnapshot,
  emergency: string | null,
  userMessage: string
): string {
  let prompt = '';
  
  // 紧急指令置顶
  if (emergency) {
    prompt += `${emergency}\n\n`;
  }
  
  // 状态快照
  prompt += `【学生学习状态】
- 当前知识点：${snapshot.currentTopic}
- 掌握度：${(snapshot.mastery * 100).toFixed(0)}%
- 挫败感：${(snapshot.frustration * 100).toFixed(0)}%
- 专注度：${(snapshot.focus * 100).toFixed(0)}%
- 认知深度：${(snapshot.depthScore * 100).toFixed(0)}%
- 学习压力：${snapshot.lssLevel === 'green' ? '正常' : snapshot.lssLevel === 'yellow' ? '偏高' : '过高'}
- 连续错误：${snapshot.consecutiveErrors} 次
- 学习时长：${snapshot.timeInSession} 分钟

学生消息：${userMessage}
`;
  
  return prompt;
}

export default {
  createInitialLearningState,
  generateStateSnapshot,
  updateCognitiveEngagement,
  updateEmotion,
  updateLearningPressure,
  updateBehavior,
  assembleStatePrompt,
  analyzeCognitiveLevel
};
