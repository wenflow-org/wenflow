/**
 * 认知参与度计算服务
 * 
 * 三层认知参与度模型：
 * - SKI (Surface Knowledge Interaction): 表层参与度 - 知识记忆、简单应用
 * - MKI (Medium Knowledge Interaction): 中层参与度 - 概念理解、模式识别
 * - DKI (Deep Knowledge Interaction): 深层参与度 - 批判思考、知识迁移
 */

export interface CognitiveEngagementInput {
  // SKI（表层）：知识记忆、简单应用
  accuracy: number;         // 答题正确率 0-1
  completionSpeed: number;  // 完成速度（预估时间/实际时间）
  
  // MKI（中层）：概念理解、模式识别
  questionCount: number;    // 提问次数
  questionQuality?: number; // AI 评估的提问质量 0-1
  
  // DKI（深层）：批判思考、知识迁移
  originalQuestions?: number;  // 原创问题数
  insights?: number;           // 洞察分享数
}

export interface CognitiveEngagementOutput {
  ski: number;  // 表层参与度 0-1
  mki: number;  // 中层参与度 0-1
  dki: number;  // 深层参与度 0-1
}

export interface CognitiveEngagementDetails extends CognitiveEngagementOutput {
  breakdown: {
    ski: {
      accuracy: number;
      speed: number;
      formula: string;
    };
    mki: {
      questionFactor: number;
      qualityFactor: number;
      formula: string;
    };
    dki: {
      originalQuestionsFactor: number;
      insightsFactor: number;
      formula: string;
    };
  };
}

/**
 * 计算三层认知参与度
 */
export function calculateCognitiveEngagement(
  input: CognitiveEngagementInput
): CognitiveEngagementOutput {
  const ski = calculateSKI(input.accuracy, input.completionSpeed);
  const mki = calculateMKI(input.questionCount, input.questionQuality);
  const dki = calculateDKI(input.originalQuestions, input.insights);
  
  return { ski, mki, dki };
}

/**
 * 计算表层参与度 (SKI)
 * 公式：SKI = accuracy * 0.7 + min(1, completionSpeed) * 0.3
 */
function calculateSKI(accuracy: number, completionSpeed: number): number {
  const normalizedAccuracy = Math.max(0, Math.min(1, accuracy));
  const normalizedSpeed = Math.max(0, Math.min(1, completionSpeed));
  
  const ski = normalizedAccuracy * 0.7 + normalizedSpeed * 0.3;
  
  return Math.max(0, Math.min(1, ski));
}

/**
 * 计算中层参与度 (MKI)
 * 公式：MKI = min(1, questionCount/5) * (questionQuality || 0.5)
 */
function calculateMKI(questionCount: number, questionQuality?: number): number {
  const countFactor = Math.min(1, Math.max(0, questionCount) / 5);
  const qualityFactor = questionQuality !== undefined 
    ? Math.max(0, Math.min(1, questionQuality))
    : 0.5;
  
  const mki = countFactor * qualityFactor;
  
  return Math.max(0, Math.min(1, mki));
}

/**
 * 计算深层参与度 (DKI)
 * 公式：DKI = min(1, originalQuestions/2) * 0.5 + min(1, insights/2) * 0.5
 */
function calculateDKI(originalQuestions?: number, insights?: number): number {
  const originalFactor = originalQuestions !== undefined
    ? Math.min(1, Math.max(0, originalQuestions) / 2)
    : 0;
  
  const insightsFactor = insights !== undefined
    ? Math.min(1, Math.max(0, insights) / 2)
    : 0;
  
  const dki = originalFactor * 0.5 + insightsFactor * 0.5;
  
  return Math.max(0, Math.min(1, dki));
}

/**
 * 计算认知参与度并返回详细分解
 */
export function calculateCognitiveEngagementWithDetails(
  input: CognitiveEngagementInput
): CognitiveEngagementDetails {
  const normalizedAccuracy = Math.max(0, Math.min(1, input.accuracy));
  const normalizedSpeed = Math.max(0, Math.min(1, input.completionSpeed));
  const countFactor = Math.min(1, Math.max(0, input.questionCount) / 5);
  const qualityFactor = input.questionQuality !== undefined 
    ? Math.max(0, Math.min(1, input.questionQuality))
    : 0.5;
  const originalFactor = input.originalQuestions !== undefined
    ? Math.min(1, Math.max(0, input.originalQuestions) / 2)
    : 0;
  const insightsFactor = input.insights !== undefined
    ? Math.min(1, Math.max(0, input.insights) / 2)
    : 0;
  
  const ski = normalizedAccuracy * 0.7 + normalizedSpeed * 0.3;
  const mki = countFactor * qualityFactor;
  const dki = originalFactor * 0.5 + insightsFactor * 0.5;
  
  return {
    ski: Math.max(0, Math.min(1, ski)),
    mki: Math.max(0, Math.min(1, mki)),
    dki: Math.max(0, Math.min(1, dki)),
    breakdown: {
      ski: {
        accuracy: normalizedAccuracy,
        speed: normalizedSpeed,
        formula: `(${normalizedAccuracy.toFixed(2)} * 0.7) + (${normalizedSpeed.toFixed(2)} * 0.3) = ${ski.toFixed(2)}`
      },
      mki: {
        questionFactor: countFactor,
        qualityFactor,
        formula: `${countFactor.toFixed(2)} * ${qualityFactor.toFixed(2)} = ${mki.toFixed(2)}`
      },
      dki: {
        originalQuestionsFactor: originalFactor,
        insightsFactor,
        formula: `(${originalFactor.toFixed(2)} * 0.5) + (${insightsFactor.toFixed(2)} * 0.5) = ${dki.toFixed(2)}`
      }
    }
  };
}

/**
 * 获取参与度等级描述
 */
export function getEngagementLevel(value: number): string {
  if (value >= 0.8) return '优秀';
  if (value >= 0.6) return '良好';
  if (value >= 0.4) return '中等';
  if (value >= 0.2) return '待提升';
  return '需要关注';
}

/**
 * 获取认知参与度综合评估
 */
export function getCognitiveEngagementAssessment(
  input: CognitiveEngagementInput
): {
  scores: CognitiveEngagementOutput;
  levels: { ski: string; mki: string; dki: string };
  summary: string;
  recommendations: string[];
} {
  const scores = calculateCognitiveEngagement(input);
  const levels = {
    ski: getEngagementLevel(scores.ski),
    mki: getEngagementLevel(scores.mki),
    dki: getEngagementLevel(scores.dki)
  };
  
  const avgScore = (scores.ski + scores.mki + scores.dki) / 3;
  const summary = `综合认知参与度：${(avgScore * 100).toFixed(0)}% (${getEngagementLevel(avgScore)})`;
  
  const recommendations: string[] = [];
  
  if (scores.ski < 0.4) {
    recommendations.push('建议加强基础知识的记忆和练习');
  }
  if (scores.mki < 0.4) {
    recommendations.push('建议多提出问题，加深对概念的理解');
  }
  if (scores.dki < 0.4) {
    recommendations.push('建议尝试提出原创性问题，分享学习见解');
  }
  
  if (scores.dki > scores.ski) {
    recommendations.push('深层思考能力不错，建议同步巩固基础知识');
  }
  
  return {
    scores,
    levels,
    summary,
    recommendations
  };
}

export default {
  calculateCognitiveEngagement,
  calculateCognitiveEngagementWithDetails,
  getEngagementLevel,
  getCognitiveEngagementAssessment
};