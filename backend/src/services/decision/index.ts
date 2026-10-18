/**
 * 决策模型公开入口（外挂能力 decision-gate）。
 *
 * 用法：
 *   import { decide, isDecisionConfigured } from '../services/decision';
 *   const { answers } = await decide({
 *     state: { 材料: '…', 问题: '…' },
 *     questions: { answerable: { type: 'noul', instructions: '这段材料能否回答该问题？' } },
 *   });
 *   const p = answers.answerable.noul;
 */

export * from './types';
export {
  decide,
  isDecisionEnabled,
  isDecisionConfigured,
} from './decision.service';
export {
  createDecisionProviders,
  resolveDecisionProviderOrder,
  DEFAULT_DECISION_PROVIDER_ORDER,
  IMPLEMENTED_DECISION_PROVIDERS,
} from './providers';
