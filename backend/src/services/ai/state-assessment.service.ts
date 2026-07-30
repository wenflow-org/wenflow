/**
 * AI 状态评估服务
 *
 * 本服务只保留规则式干预策略生成（generateInterventionStrategy）。
 * 原 LLM 评估方法（assessCognitiveState / integrateAIandEMA）经调用调查确认
 * 无任何上游调用者，已随 skill:state-assessment 一并退役删除。
 */

/**

 * 综合状态评估

 */

export interface StudentStateAssessment {

  cognitive: number;

  stress: number;

  engagement: number;

  anomaly: boolean;

  anomalyReason?: string;

  intervention?: string;

  assessedAt?: string;

}

/**
 * AI 状态评估服务（规则式，无 LLM 调用）
 */
export class AIStateAssessmentService {

  /**
   * 根据状态生成干预策略
   */
  generateInterventionStrategy(state: StudentStateAssessment): string {
    const { stress, cognitive, engagement } = state;

    // 四象限干预策略
    if (stress > 0.7 && cognitive < 0.4) {
      return `
【当前状态】压力大，掌握度低
【策略】情绪安抚 + 支架降级
1. 先共情："看起来这个问题有点挑战性，很正常"
2. 降低难度："我们先不想复杂的部分，只看..."
3. 提供脚手架："这是第一步，你试试..."
4. 不要追问："不用急着回答，先理解"`;
    }

    if (stress > 0.7 && cognitive > 0.6) {
      return `
【当前状态】压力大，但掌握度高
【策略】静默追踪 + 适时肯定
1. 肯定能力："你的思路很清晰"
2. 给予时间："慢慢想，不用急"
3. 提供提示（不是答案）："关键点是 xxx"
4. 不要催促："想好了再回答"`;
    }

    if (stress < 0.4 && cognitive < 0.4) {
      return `
【当前状态】放松，但没用心
【策略】苏格拉底反问 + 认知冲突
1. 制造认知冲突："你确定吗？我有个反例..."
2. 强制作答："先说说你的想法"
3. 追问："为什么？证据是什么？"
4. 提高参与度："如果是你，会怎么设计？"`;
    }

    if (stress < 0.4 && cognitive > 0.6) {
      return `
【当前状态】放松且掌握得好
【策略】进阶拔高 + 角色互换
1. 提高难度："如果条件变成 xxx，怎么办？"
2. 角色互换："如果是你教别人，会怎么讲？"
3. 拓展延伸："这个和 xxx 有什么联系？"
4. 鼓励创造："你能设计一个类似的问题吗？"`;
    }

    // 默认策略
    return `
【当前状态】正常学习状态
【策略】正常引导
1. 继续当前节奏
2. 适时提供反馈
3. 鼓励学生思考`;
  }
}

// 导出单例
export const aiStateAssessmentService = new AIStateAssessmentService();
