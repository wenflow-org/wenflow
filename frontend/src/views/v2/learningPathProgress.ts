/**
 * 路径生成进度文案（#112 剩余半）。
 *
 * 背景：列表页在 2026-10-17 已区分「阶段数满 = 课时正在写入」，但详情页的生成条一直只写
 * `正在准备课程（N/M）…`——阶段数满后同一句会停 4 分钟左右（实测 10 分钟级生成里的尾巴），
 * 读起来像 100% 卡死。另外后端 `generation-status` 一直带着 `currentStageNumber` 与
 * `heartbeatAt`，详情页一个都没用：用户看不到「正在做第几阶段」，也看不出进程是否还活着。
 *
 * 本模块只做纯函数格式化，供详情页渲染与单测；口径与列表页保持同一套判据
 * （phase=core 给时长承诺；completed >= total 判「写入中」）。
 */

export interface GenerationLifecycleLike {
  phase?: string | null;
  status?: string | null;
  completedStages?: number | null;
  totalStages?: number | null;
  currentStageNumber?: number | null;
  heartbeatAt?: string | null;
}

export interface GenerationProgressCopy {
  primary: string;
  secondary: string;
}

/** 心跳超过这个年龄才提示「已等待」，否则保持轻量副句 */
export const HEARTBEAT_NOTICE_MS = 60_000;

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** 毫秒 → 「3 分 40 秒」/「42 秒」/「1 小时 2 分」；无效输入返回 null */
export function formatWaited(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds ? `${totalMinutes} 分 ${seconds} 秒` : `${totalMinutes} 分`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function heartbeatAgeMs(lifecycle: GenerationLifecycleLike, now: number): number | null {
  const raw = lifecycle.heartbeatAt;
  if (!raw) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const age = now - at;
  // 时钟回拨/未来时间戳：不编造负数等待
  return age < 0 ? null : age;
}

/**
 * 生成中状态的两行文案。
 * - 主行：core 给时长承诺；stage_design 给阶段位次；阶段数满 → 「课时正在写入」；
 * - 副行：心跳超过 60s 时报「已等待 X；最近一次进展 Y 前，仍在生成」，否则给轻量建议。
 */
export function buildGenerationProgress(
  lifecycle: GenerationLifecycleLike,
  now: number = Date.now()
): GenerationProgressCopy {
  const done = isPositiveInt(lifecycle.completedStages) ? lifecycle.completedStages : 0;
  const total = isPositiveInt(lifecycle.totalStages) ? lifecycle.totalStages : 0;
  const clampedDone = total > 0 ? Math.min(done, total) : done;

  let primary: string;
  if (lifecycle.phase === 'core') {
    primary = '正在生成路径（通常几分钟，模型重试时会更久）…';
  } else if (total > 0 && clampedDone >= total) {
    primary = '课时正在写入，马上就好…';
  } else if (total > 0) {
    const current = isPositiveInt(lifecycle.currentStageNumber)
      ? Math.min(lifecycle.currentStageNumber, total)
      : null;
    primary = current
      ? `正在准备第 ${current} 阶段（已完成 ${clampedDone}/${total}）…`
      : `正在准备课程（${clampedDone}/${total}）…`;
  } else {
    primary = '正在准备课程…';
  }

  const age = heartbeatAgeMs(lifecycle, now);
  const waited = age === null ? null : formatWaited(age);
  // 只有心跳年龄可算（DTO 没有 startedAt）——措辞必须只声称「最近一次进展在 X 前」，
  // 不能写成「已等待 X」（那是整场生成的时长，会被读者当成同一件事）。
  const secondary = age !== null && age > HEARTBEAT_NOTICE_MS && waited
    ? `最近一次进展在 ${waited} 前，仍在生成。`
    : '你也可以先去别的页面看看。';

  return { primary, secondary };
}
