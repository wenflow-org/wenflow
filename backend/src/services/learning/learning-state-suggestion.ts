/**
 * 学习状态展示层建议（纯函数，零 DB/副作用）
 *
 * 从 learning-state.service 抽出：该服务本身已超 2000 行，而建议生成不需要任何状态，
 * 独立成模块既满足 services 分层棘轮，也让「相对量判据」与 /state/warnings 共用同一真理源。
 *
 * 关键语义：PMC 口径下冷启动期（KTL 基座未成熟）form<0 是「正在建立适应」，不是疲劳；
 * 因此状态建议必须走 classifyLoad 的 mature 判定，不能再用绝对 LSB 分档。
 */
import { classifyLoad } from './learning-load-verdict';
import type { LearningStateDisplayMetrics } from './learning-state.service';

export interface LearningStateDisplaySuggestion {
  level: 'critical' | 'warning' | 'normal' | 'optimal';
  message: string;
  action: string;
  categories: {
    pressure: { status: string; message: string };
    state: { status: string; message: string };
    growth: { status: string; message: string };
    duration: { status: string; message: string };
  };
}

export function buildDisplaySuggestion(metrics: LearningStateDisplayMetrics): LearningStateDisplaySuggestion {
  const { lss, ktl, lf } = metrics;
  // display 0-100 → internal（判据阈值按内部刻度标定）。
  const verdict = classifyLoad({ ktl: ktl / 10, lf: lf / 10 });

  // 1. 压力建议（基于LSS）
  let pressureAdvice: { status: string; message: string };
  if (lss > 80) {
    pressureAdvice = {
      status: 'danger',
      message: '压力极大，建议暂停学习，休息放松'
    };
  } else if (lss > 70) {
    pressureAdvice = {
      status: 'warning',
      message: '压力较大，明天降低难度或减少学习时间'
    };
  } else if (lss >= 50) {
    pressureAdvice = {
      status: 'normal',
      message: '压力正常，继续保持'
    };
  } else if (lss >= 30) {
    pressureAdvice = {
      status: 'info',
      message: '压力较小，可适当增加挑战'
    };
  } else {
    pressureAdvice = {
      status: 'success',
      message: '强度太低，建议增加学习任务量'
    };
  }

  // 2. 状态建议（相对量判据，与 /state/warnings 同源）
  let stateAdvice: { status: string; message: string };
  let level: 'critical' | 'warning' | 'normal' | 'optimal';
  let mainMessage: string;
  let mainAction: string;

  if (!verdict.mature) {
    level = 'normal';
    stateAdvice = {
      status: 'info',
      message: '正在建立学习负荷基座，暂不判定疲劳'
    };
    mainMessage = '状态正在建立';
    mainAction = '保持稳定节奏，完成更多课程后再评估';
  } else if (verdict.fatigueRisk === 'high') {
    level = 'critical';
    stateAdvice = {
      status: 'danger',
      message: '急性负荷明显高于适应基座，建议休息1-2天'
    };
    mainMessage = '过度疲劳，建议强制休息';
    mainAction = '停止所有新任务，复习旧知识或休息1-2天';
  } else if (verdict.fatigueRisk === 'medium' || verdict.imbalanced) {
    level = 'warning';
    stateAdvice = {
      status: 'warning',
      message: '近期负荷涨得比适应基座快，注意休息'
    };
    mainMessage = '疲劳偏高，建议降低难度';
    mainAction = '选择简单任务，观看视频教程，避免高强度学习';
  } else if (verdict.recovered) {
    level = 'optimal';
    stateAdvice = {
      status: 'success',
      message: '恢复良好，有余力挑战更高难度'
    };
    mainMessage = '学习状态极佳';
    mainAction = '尝试项目实践，深入研究，挑战自己';
  } else {
    level = 'normal';
    stateAdvice = {
      status: 'normal',
      message: '正常学习状态，继续当前节奏'
    };
    mainMessage = '正常学习状态';
    mainAction = '继续当前学习节奏，保持稳定';
  }

  // 3. 长期训练负荷建议（KTL 是负荷，高=负荷重，不解读为掌握水平）
  let growthAdvice: { status: string; message: string };
  if (!verdict.mature) {
    growthAdvice = {
      status: 'info',
      message: '长期负荷仍在积累，暂不评估负荷趋势'
    };
  } else if (ktl >= 70) {
    growthAdvice = {
      status: 'warning',
      message: '长期训练负荷较高，注意休息与巩固'
    };
  } else if (ktl >= 50) {
    growthAdvice = {
      status: 'normal',
      message: '长期训练负荷中等，保持当前节奏'
    };
  } else if (ktl >= 30) {
    growthAdvice = {
      status: 'info',
      message: '长期训练负荷较低，可适当增加学习量'
    };
  } else {
    growthAdvice = {
      status: 'info',
      message: '长期训练负荷很低，建议逐步增加学习投入'
    };
  }

  // 4. 时长建议（与状态同一相对量：高疲劳时不得同时说「精力充沛」）
  let durationAdvice: { status: string; message: string };
  if (!verdict.mature) {
    durationAdvice = {
      status: 'info',
      message: '学习记录积累中，暂不评估疲劳'
    };
  } else if (verdict.fatigueRisk === 'high') {
    durationAdvice = {
      status: 'warning',
      message: '近期急性负荷明显高于适应基座，注意劳逸结合'
    };
  } else if (verdict.recovered) {
    durationAdvice = {
      status: 'success',
      message: '精力充沛，可以适当增加学习时间'
    };
  } else {
    durationAdvice = {
      status: 'normal',
      message: '学习时长合理，注意适当休息'
    };
  }

  return {
    level,
    message: mainMessage,
    action: mainAction,
    categories: {
      pressure: pressureAdvice,
      state: stateAdvice,
      growth: growthAdvice,
      duration: durationAdvice
    }
  };
}
