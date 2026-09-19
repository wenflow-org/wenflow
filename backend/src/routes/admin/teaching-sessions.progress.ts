// 教学会话进度推导已下沉到 service 层（DB 访问不落在 routes/**）。
// 保留此模块路径以兼容既有引用（platform.ts / 单测）；实现见 teaching-session-progress.service.ts。
export { deriveTeachingSessionProgress } from '../../services/teaching-session-progress.service';
export type {
  SessionProgress,
  ProgressableSession,
} from '../../services/teaching-session-progress.service';
