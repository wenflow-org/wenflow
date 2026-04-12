// AI Tutor 动态策略服务
// 基于学生状态（压力、认知深度、投入程度）生成个性化辅导策略

export interface StudentState {
  /** 认知深度 (0-1): 学生对知识的理解程度 */
  cognitive: number;
  
  /** 压力程度 (0-1): 学生当前的焦虑/压力水平 */
  stress: number;
  
  /** 投入程度 (0-1): 学生的专注度和参与度 */
  engagement: number;
  
  /** 是否检测到异常状态 */
  anomaly?: boolean;
  
  /** 异常原因描述 */
  anomalyReason?: string;
  
  /** 用户 XP（可选，用于综合判断） */
  xp?: number;
  
  /** 连续学习时长（分钟，可选） */
  continuousStudyMinutes?: number;
}

export interface TutorStrategy {
  /** 策略描述（自然语言） */
  description: string;
  
  /** AI 角色定位 */
  role: string;
  
  /** 具体策略要点 */
  strategies: string[];
  
  /** 推荐的语气风格 */
  tone: 'supportive' | 'challenging' | 'neutral' | 'encouraging';
  
  /** 是否需要主动关心 */
  needsCare: boolean;
  
  /** 关心话语（如果有） */
  careMessage?: string;
}

export class TutorStrategyService {
  /**
   * 根据学生状态生成 Tutor 策略
   */
  getStrategyDescription(state: StudentState): string {
    const strategy = this.getFullStrategy(state);
    
    return `
【当前学生状态】
- 认知深度：${state.cognitive.toFixed(2)}/1.0 ${this.getCognitiveLevel(state.cognitive)}
- 压力程度：${state.stress.toFixed(2)}/1.0 ${this.getStressLevel(state.stress)}
- 投入程度：${state.engagement.toFixed(2)}/1.0 ${this.getEngagementLevel(state.engagement)}
${state.anomaly ? `- 状态异常：${state.anomalyReason || '检测到异常状态'}` : ''}

【你的角色】${strategy.role}

【回应策略】
${strategy.strategies.join('\n')}

【语气风格】${this.getToneDescription(strategy.tone)}`;
  }

  /**
   * 获取完整的策略对象
   */
  getFullStrategy(state: StudentState): TutorStrategy {
    // 四象限干预策略
    if (state.stress > 0.7 && state.cognitive < 0.4) {
      // 高压力 + 低认知：支持型辅导员
      return {
        description: '学生压力大且掌握度低，需要温和支持和脚手架',
        role: '支持型辅导员',
        strategies: [
          '先共情："看起来这个问题有点挑战性，很正常，很多人都会有这种感觉"',
          '降低难度："我们先不想复杂的部分，只看最基础的概念..."',
          '提供脚手架："这是第一步，你试试这样做..."',
          '不要追问："不用急着回答，先理解，有问题随时问我"',
          '多鼓励："你已经迈出了第一步，这很好"'
        ],
        tone: 'supportive',
        needsCare: state.stress > 0.8,
        careMessage: this.generateCareMessage(state) || undefined
      };
    }
    
    if (state.stress > 0.7 && state.cognitive > 0.7) {
      // 高压力 + 高认知：安静的观察者
      return {
        description: '学生压力大但掌握度高，需要肯定和空间',
        role: '安静的观察者',
        strategies: [
          '肯定能力："你的思路很清晰，能看出来你已经理解了"',
          '给予时间："慢慢想，不用急，我等你"',
          '提供提示（不是答案）："关键点是 xxx，你可以顺着这个思路想想"',
          '不要催促："想好了再回答，我相信你可以的"',
          '减轻压力："这个问题确实有难度，我们一起看看"'
        ],
        tone: 'encouraging',
        needsCare: state.stress > 0.85,
        careMessage: this.generateCareMessage(state) || undefined
      };
    }
    
    if (state.stress < 0.4 && state.cognitive < 0.4) {
      // 低压力 + 低认知：挑战性导师
      return {
        description: '学生放松但没用心，需要制造认知冲突和追问',
        role: '挑战性导师',
        strategies: [
          '制造认知冲突："你确定吗？我有个反例，你看看怎么解释..."',
          '强制作答："先说说你的想法，不用怕错"',
          '追问："为什么？证据是什么？你的推理过程是什么？"',
          '提高参与度："如果是你，会怎么设计这个方案？"',
          '激发好胜心："这个问题有点意思，要不要挑战一下？"'
        ],
        tone: 'challenging',
        needsCare: false
      };
    }
    
    if (state.stress < 0.4 && state.cognitive > 0.7) {
      // 低压力 + 高认知：平等讨论者
      return {
        description: '学生放松且掌握得好，可以深度讨论和拓展',
        role: '平等讨论者',
        strategies: [
          '提高难度："如果条件变成 xxx，怎么办？你会怎么调整？"',
          '角色互换："如果是你教别人，会怎么讲这个概念？"',
          '拓展延伸："这个和 xxx 有什么联系？能想到吗？"',
          '鼓励创造："你能设计一个类似的问题吗？"',
          '深度探讨："你觉得这个方法的局限性在哪里？"'
        ],
        tone: 'neutral',
        needsCare: false
      };
    }
    
    // 默认策略（中等状态）
    return {
      description: '学生状态正常，按标准方式辅导',
      role: '学习伙伴',
      strategies: [
        '正常回应学生问题',
        '循序渐进引导思考',
        '鼓励提问和探索',
        '提供适当的例子和帮助'
      ],
      tone: 'neutral',
      needsCare: false
    };
  }

  /**
   * 检测异常并生成关心话语
   */
  generateCareMessage(state: StudentState): string | null {
    // 压力异常高
    if (state.anomaly && state.stress > 0.7) {
      return "感觉你今天有点不在状态？要不要休息一下？学习是长跑，不用急于一时。";
    }
    
    // 认知深度异常低
    if (state.anomaly && state.cognitive < 0.3) {
      return "是不是遇到什么困难了？需要我帮忙吗？有时候换个角度想问题会更容易。";
    }
    
    // 投入程度异常低
    if (state.anomaly && state.engagement < 0.3) {
      return "看起来你有点分心？如果现在不想学，可以先休息会儿，等状态好点再继续。";
    }
    
    // 连续学习时间过长
    if (state.continuousStudyMinutes && state.continuousStudyMinutes > 90) {
      return "你已经连续学习很久了，休息一下吧！效率比时长更重要。";
    }
    
    return null;
  }

  /**
   * 根据策略生成系统提示词
   */
  buildSystemPrompt(state: StudentState, basePrompt?: string): string {
    const strategy = this.getFullStrategy(state);
    const strategyDesc = this.getStrategyDescription(state);
    
    let prompt = basePrompt || `你是一位问流 AI 学习辅导老师。你的任务是帮助学生理解和解决问题。`;
    
    prompt += `\n\n${strategyDesc}`;
    
    if (strategy.careMessage) {
      prompt += `\n\n【特别关心】\n在回应前先表达关心："${strategy.careMessage}"`;
    }
    
    prompt += `\n\n现在，请根据以上策略回应用户的问题。保持自然、真诚的语气。`;
    
    return prompt;
  }

  // 辅助方法：获取状态级别描述
  private getCognitiveLevel(value: number): string {
    if (value < 0.3) return '(很低)';
    if (value < 0.5) return '(较低)';
    if (value < 0.7) return '(中等)';
    if (value < 0.9) return '(较高)';
    return '(很高)';
  }

  private getStressLevel(value: number): string {
    if (value < 0.3) return '(很低)';
    if (value < 0.5) return '(较低)';
    if (value < 0.7) return '(中等)';
    if (value < 0.9) return '(较高)';
    return '(很高)';
  }

  private getEngagementLevel(value: number): string {
    if (value < 0.3) return '(很低)';
    if (value < 0.5) return '(较低)';
    if (value < 0.7) return '(中等)';
    if (value < 0.9) return '(较高)';
    return '(很高)';
  }

  private getToneDescription(tone: TutorStrategy['tone']): string {
    const toneMap: Record<TutorStrategy['tone'], string> = {
      supportive: '温和、支持、鼓励为主',
      challenging: '犀利、追问、激发思考',
      neutral: '平和、客观、循循善诱',
      encouraging: '肯定、耐心、给予信心'
    };
    return toneMap[tone];
  }
}

export default TutorStrategyService;
