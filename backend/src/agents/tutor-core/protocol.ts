/**
 * Tutor Core - AI 授课核心模块
 * 
 * 导出所有授课相关的组件
 */

// 学习状态管理
export {
  createInitialLearningState,
  generateStateSnapshot,
  updateCognitiveEngagement,
  updateEmotion,
  updateLearningPressure,
  updateBehavior,
  assembleStatePrompt,
  analyzeCognitiveLevel,
  type LearningState,
  type StudentStateSnapshot,
  type CognitiveLevel,
  type LSSLevel
} from './learning-state';

// 干预策略
export {
  selectStrategy,
  generateStylePrompt,
  getJoke,
  getHackerStory,
  generateStrategyContent,
  type InterventionStrategy,
  type InterventionType
} from './intervention-strategies';

// AI 授课 Agent
export {
  tutorAgentDefinition,
  tutorAgentHandler,
  clearSessionState,
  getSessionState
} from './index';
