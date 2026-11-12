/**
 * 路径生成进度文案（#112 剩余半）。
 *
 * 背景：列表页在 2026-10-17 已区分「阶段数满 = 课时正在写入」，但详情页的生成条一直只写
 * `正在准备课程（N/M）…`——阶段数满后同一句会停 4 分钟左右（实测 10 分钟级生成里的尾巴），
 * 读起来像 100% 卡死。另外后端 `generation-status` 一直带着 `currentStageNumber` 与
 * `heartbeatAt`，详情页一个都没用：用户看不到「正在做第几阶段」，也看不出进程是否还活着。
 *
 * 本模块只做纯函数格式化，供详情页/目标页渲染与单测；口径与列表页保持同一套判据
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
    primary = '正在生成路径…';
  } else if (total > 0 && clampedDone >= total) {
    primary = '课时正在写入…';
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

/* ---------- 目标页 gen-pill（走查 2026-11-02 P22 三缺陷） ----------
   确认后约 1.5s 后端就落了路径记录、会话 isCompleted——但阶段/课时生成还在后端跑
   （实测约 7 分钟）。目标页此前只看会话 phase，pill 提前跳平静终态、刷新即消失、
   完成弹层永远说「还在生成中」。修法：与列表页同源（generation-status 轮询），
   状态 → 文案的映射收在本模块纯函数里，供单测锁定。 */

/** 终态判据：与列表页（V2LearningPaths pollOnce）同一套口径，不另造第三种写法 */
export function isGenerationSettled(lifecycle: GenerationLifecycleLike | null | undefined): boolean {
  if (!lifecycle) return false;
  return lifecycle.phase === 'ready' || lifecycle.status === 'failed' || lifecycle.status === 'stale';
}

/** 生成中 pill 的紧凑阶段短语（口径同 buildGenerationProgress 主行 / 列表页 phaseTextOf） */
export function genStageLabel(lifecycle: GenerationLifecycleLike): string {
  const done = isPositiveInt(lifecycle.completedStages) ? lifecycle.completedStages : 0;
  const total = isPositiveInt(lifecycle.totalStages) ? lifecycle.totalStages : 0;
  const clampedDone = total > 0 ? Math.min(done, total) : done;
  if (lifecycle.phase === 'core') return '规划阶段与课时';
  if (total > 0 && clampedDone >= total) return '课时正在写入';
  if (total > 0) return `课程准备中（${clampedDone}/${total}）`;
  return '课程准备中';
}

export interface GenPillCopy {
  tone: 'run' | 'done' | 'fail';
  text: string;
}

/**
 * status → pill 文案的唯一映射。
 * - 生成中 → run「正在生成路径 · {真实阶段}」；
 * - 完成 → done「路径已创建 · 生成完成」（点击去路径详情）；
 * - 失败/stale → fail「生成失败」（重试入口在路径列表的失败卡上）；
 * - 状态接口尚未应答（null/undefined，短暂窗口）→ run 过渡「路径已创建 · 生成中」——
 *   P22 红线：生成未确认完成前不得给平静终态。
 */
export function genPillCopy(lifecycle: GenerationLifecycleLike | null | undefined): GenPillCopy {
  if (!lifecycle) return { tone: 'run', text: '路径已创建 · 生成中' };
  if (lifecycle.status === 'failed' || lifecycle.status === 'stale') {
    return { tone: 'fail', text: '生成失败' };
  }
  if (lifecycle.phase === 'ready') {
    return { tone: 'done', text: '路径已创建 · 生成完成' };
  }
  return { tone: 'run', text: `正在生成路径 · ${genStageLabel(lifecycle)}` };
}

/* ---------- 用户侧时间锚点（2026-11-11 走查：列表四张卡只有「已完成 / 100%」，分不出新旧） ----------
   统一口径：
   - 可见文案用相对时间（刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前），超过 30 天回落 YYYY-MM-DD，
     避免「48 天前」这类越读越难换算的数字；
   - title 给绝对时间（本地时区 YYYY-MM-DD HH:mm），需要精确核对时可直接看；
   - 只格式化，不猜业务：调用方决定锚点是「最近学习 / 更新于 / 创建于」。
   全部按本地时区，不用 toISOString().slice（UTC 切日会差一天）。 */

const pad2 = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** 本地绝对时间：2026-11-11 10:32；无效值返回 '' */
export function formatLocalDateTime(value: string | number | null | undefined): string {
  const time = toTimestamp(value);
  if (time === null) return '';
  const d = new Date(time);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 本地日期：2026-11-11；无效值返回 '' */
export function formatLocalDate(value: string | number | null | undefined): string {
  const time = toTimestamp(value);
  if (time === null) return '';
  const d = new Date(time);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 相对时间（面向人读）；未来/坏时间按「刚刚」处理，不产负数与 NaN */
export function formatRelativeTime(value: string | number | null | undefined, now: number = Date.now()): string {
  const time = toTimestamp(value);
  if (time === null) return '';
  const diff = Math.max(now - time, 0);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours} 小时前`;
  const date = new Date(time);
  const today = new Date(now);
  const dayDiff = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
      - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / DAY_MS
  );
  if (dayDiff === 1) return '昨天';
  if (dayDiff < 30) return `${dayDiff} 天前`;
  return formatLocalDate(time);
}

export interface PathActivityAnchor {
  /** 可见文案：「最近学习 2 小时前」 */
  text: string;
  /** 绝对时间（含创建时间），给 title 用 */
  title: string;
}

export interface PathActivityAnchorInput {
  createdAt?: string | null;
  updatedAt?: string | null;
  tasks?: Array<{ completedAt?: string | null }> | null;
}

/**
 * 路径卡的「时间锚点」：优先用任务完成时间（真实学习），
 * 其次路径更新时间（任务状态/结构变化），最后创建时间。
 * createdAt 与 updatedAt 相差不足 1 分钟视为「创建后没再变过」，写「创建于」而不是「更新于」。
 */
export function buildPathActivityAnchor(
  input: PathActivityAnchorInput,
  now: number = Date.now()
): PathActivityAnchor | null {
  const created = toTimestamp(input.createdAt);
  const updated = toTimestamp(input.updatedAt);
  let completed: number | null = null;
  for (const task of input.tasks ?? []) {
    const at = toTimestamp(task?.completedAt);
    if (at !== null && (completed === null || at > completed)) completed = at;
  }

  let at: number | null = null;
  let prefix = '';
  if (completed !== null) {
    at = completed;
    prefix = '最近学习';
  } else if (created !== null && updated !== null && Math.abs(updated - created) < 60_000) {
    at = created;
    prefix = '创建于';
  } else if (updated !== null) {
    at = updated;
    prefix = '更新于';
  } else if (created !== null) {
    at = created;
    prefix = '创建于';
  }
  if (at === null) return null;

  const relative = formatRelativeTime(at, now);
  const absolute = formatLocalDateTime(at);
  if (!relative || !absolute) return null;
  const titleParts = [`${prefix} ${absolute}`];
  if (prefix !== '创建于' && created !== null) {
    const createdText = formatLocalDateTime(created);
    if (createdText) titleParts.push(`创建于 ${createdText}`);
  }
  return { text: `${prefix} ${relative}`, title: titleParts.join(' · ') };
}
