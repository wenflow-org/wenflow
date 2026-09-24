/**
 * 应用日界（**单一真理源**）——所有「按天归组 / 按天比较」都必须走这里。
 *
 * 口径（2026-09-22 拍板，收敛此前互相冲突的三套实现）：
 * - **一律用应用时区的本地日**：不得用 UTC 切日（`toISOString().slice(0,10)`），
 *   也不得用服务器**机器本地**时区（同一份数据在不同时区的机器上会被切成不同的"天"）。
 *   UTC 切日的历史事故：UTC+8 用户在 00:00–08:00 的学习被记进「昨天」，
 *   与前端 `frontend/src/utils/date.ts` 的本地日口径（2026-08-21 拍板）互相矛盾。
 * - 存储层不受影响：时间戳一律存**绝对时刻**（epoch / ISO-Z）。"按本地时间记录"的正解是
 *   「归属与展示按本地时区」，而不是把本地墙钟时间存进库（那样会丢时刻、踩 DST/换时区）。
 *
 * 时区来源：平台设置 `timezone`（默认 Asia/Shanghai）；虚拟学习者的日期模拟可用
 * `dateSimulation.timezone` 覆盖（见 simulated-day.service）。函数均接受显式 tz 参数，
 * 便于按用户/租户覆盖与测试注入。
 */
import systemPrisma from '../../config/system-database';

export const DEFAULT_APP_TIME_ZONE = 'Asia/Shanghai';
const DAY_MS = 24 * 60 * 60 * 1000;
const PLATFORM_TIMEZONE_KEY = 'timezone';

let appTimeZone = normalizeTimeZone(process.env.APP_TIMEZONE) || DEFAULT_APP_TIME_ZONE;

/** 当前应用时区（同步读缓存值；刷新见 refreshAppTimeZoneFromSettings）。 */
export function getAppTimeZone(): string {
  return appTimeZone;
}

/** 校验并归一 IANA 时区名；非法返回 null。 */
export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return null;
  }
}

/** 设置应用时区（非法值忽略，返回是否生效）。 */
export function setAppTimeZone(value: unknown): boolean {
  const normalized = normalizeTimeZone(value);
  if (!normalized) return false;
  appTimeZone = normalized;
  return true;
}

/**
 * 从平台设置刷新应用时区（启动时与设置更新后调用）。
 * 读不到/非法时保持现值，不抛错——日界不可因设置服务抖动而失效。
 */
export async function refreshAppTimeZoneFromSettings(): Promise<string> {
  try {
    const row = await systemPrisma.platform_settings.findUnique({ where: { key: PLATFORM_TIMEZONE_KEY } });
    if (row?.value !== undefined && row.value !== null) setAppTimeZone(row.value);
  } catch {
    // 保持现值
  }
  return appTimeZone;
}

/** 某时刻在指定时区下的 UTC 偏移（毫秒；东区为正）。 */
function timeZoneOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - at.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 非法日期（脏数据）→ 返回空串，调用方按"落不进任何桶"处理；**不抛错**（时区名非法才抛）。 */
function isInvalidDate(instant: Date): boolean {
  return !(instant instanceof Date) || Number.isNaN(instant.getTime());
}

/** 绝对时刻 → 该时区下的日期键 'YYYY-MM-DD'；非法日期返回 ''。 */
export function dayKeyOf(instant: Date, tz: string = appTimeZone): string {
  if (isInvalidDate(instant)) return '';
  const shifted = new Date(instant.getTime() + timeZoneOffsetMs(tz, instant));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 绝对时刻 → 该时区下的小时桶键 'YYYY-MM-DD-H'（0-23，不补零，与既有展示键一致）；非法日期返回 ''。 */
export function hourKeyOf(instant: Date, tz: string = appTimeZone): string {
  if (isInvalidDate(instant)) return '';
  const shifted = new Date(instant.getTime() + timeZoneOffsetMs(tz, instant));
  return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth() + 1}-${shifted.getUTCDate()}-${shifted.getUTCHours()}`;
}

/** 某时区下"当前整点"的绝对时刻（分秒毫秒归零，按该时区的整点）。 */
export function startOfHour(instant: Date, tz: string = appTimeZone): Date {
  const offset = timeZoneOffsetMs(tz, instant);
  const shifted = instant.getTime() + offset;
  const floored = shifted - (shifted % 3600000);
  return new Date(floored - offset);
}

/** 'YYYY-MM-DD'（本地日历日）→ 该本地日 00:00 的绝对时刻。 */
export function parseDayKeyStart(dayKey: string, tz: string = appTimeZone): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dayKey));
  if (!m) return new Date(NaN);
  const wallClockAsUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 偏移随 DST 变化：先用近似时刻求偏移，再用得到的时刻复算一次收敛
  let offset = timeZoneOffsetMs(tz, new Date(wallClockAsUtc));
  let instant = wallClockAsUtc - offset;
  offset = timeZoneOffsetMs(tz, new Date(instant));
  instant = wallClockAsUtc - offset;
  return new Date(instant);
}

/** 绝对时刻所在本地日的 00:00（绝对时刻）。 */
export function startOfDay(instant: Date, tz: string = appTimeZone): Date {
  return parseDayKeyStart(dayKeyOf(instant, tz), tz);
}

/** 日期键加 N 个日历日（日历运算，不受 DST/时区影响）。 */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dayKey));
  if (!m) return dayKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * 绝对时刻所在本地日的 23:59:59.999（绝对时刻）。
 * 用"**次日**本地零点 - 1ms"计算，而不是 start + 24h - 1ms——后者在夏令时切换日
 * （本地日长 23h 或 25h）会越界到次日/漏掉末尾一小时。
 */
export function endOfDay(instant: Date, tz: string = appTimeZone): Date {
  const nextKey = addDaysToDayKey(dayKeyOf(instant, tz), 1);
  return new Date(parseDayKeyStart(nextKey, tz).getTime() - 1);
}

/** 两个绝对时刻之间相隔的**本地日**数（同日为 0；负差钳到 0）。 */
export function dayDiffInDays(from: Date, to: Date, tz: string = appTimeZone): number {
  const a = startOfDay(from, tz).getTime();
  const b = startOfDay(to, tz).getTime();
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/** 展示用：绝对时刻 → 该时区的可读本地时间。 */
export function formatLocal(instant: Date, tz: string = appTimeZone): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant);
}

export const DAY_BOUNDARY_DAY_MS = DAY_MS;
