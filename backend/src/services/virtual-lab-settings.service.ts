/**
 * 虚拟学习者专属运行设置（平台级，存 system 库 platform_settings）。
 *
 * 与「平台全局可靠性设置」独立：本设置只作用于虚拟学习者出站 LLM 通道
 * （sourceEntry === 'simulation'），不会挤占真实用户/平台自身的额度。
 */
import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';

const VIRTUAL_LAB_SETTING_KEY = 'virtualLab';
const RUNTIME_CACHE_TTL_MS = 30_000;

/**
 * 日期模拟（虚拟侧）：控制"学习分散在各自然天"的仿真推进。
 * 设计见 doc/VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md §八（默认关闭，现网零变化）。
 */
export interface VirtualLabDateSimulationSettings {
  /** 默认 false：未开启时任何推进/时间线都不生效（现网零变化） */
  enabled: boolean;
  /** 模拟时区（默认与日界实现一致） */
  timezone: string;
  /** 每次推进的每日学习时长上限（分钟） */
  defaultDailyMinutesCap: number;
  /** 每周学习天数（0 = 不限） */
  defaultDaysPerWeek: number;
  /** 每次推进跨几个自然日 */
  defaultPaceDaysPerAdvance: number;
  /** 单会话最多模拟天数（护栏） */
  maxSimulatedDays: number;
  /** 触发高优先级干预时暂停推进 */
  pauseOnIntervention: boolean;
  /** 批量/自动学习是否自动跨日 */
  autoAdvanceEnabled: boolean;
  /** 课表：一周中上课的星期（0=周日 … 6=周六）；推进时跳过非上课日 */
  courseWeekdays: number[];
  /** 课表：每天安排几节 */
  lessonsPerDay: number;
}

export interface VirtualLabSettings {
  /** 虚拟学习者专属出站 LLM 请求速率上限（RPM）；0 = 不限 */
  virtualLearnerRpmLimit: number;
  /** 虚拟侧日期模拟设置（默认关） */
  dateSimulation: VirtualLabDateSimulationSettings;
}

export const DEFAULT_VIRTUAL_LAB_SETTINGS: VirtualLabSettings = {
  // 默认不限，避免未配置时改变现网行为
  virtualLearnerRpmLimit: 0,
  dateSimulation: {
    enabled: false,
    timezone: 'Asia/Shanghai',
    defaultDailyMinutesCap: 45,
    defaultDaysPerWeek: 5,
    defaultPaceDaysPerAdvance: 1,
    maxSimulatedDays: 90,
    pauseOnIntervention: false,
    autoAdvanceEnabled: false,
    courseWeekdays: [1, 2, 3, 4, 5],
    lessonsPerDay: 1,
  }
};

let runtimeCache: { value: VirtualLabSettings; expiresAt: number } | null = null;

export function clearVirtualLabSettingsCache(): void {
  runtimeCache = null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function clampString(value: unknown, fallback: string, maxLength = 64): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : fallback;
}

function normalizeWeekdays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback];
  const set = new Set<number>();
  for (const item of value) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  const arr = [...set].sort((a, b) => a - b);
  return arr.length ? arr : [...fallback];
}

function normalizeDateSimulation(input: unknown): VirtualLabDateSimulationSettings {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const d = DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation;
  return {
    enabled: clampBoolean(raw.enabled, d.enabled),
    timezone: clampString(raw.timezone, d.timezone),
    defaultDailyMinutesCap: clampInteger(raw.defaultDailyMinutesCap, d.defaultDailyMinutesCap, 5, 480),
    defaultDaysPerWeek: clampInteger(raw.defaultDaysPerWeek, d.defaultDaysPerWeek, 0, 7),
    defaultPaceDaysPerAdvance: clampInteger(raw.defaultPaceDaysPerAdvance, d.defaultPaceDaysPerAdvance, 1, 30),
    maxSimulatedDays: clampInteger(raw.maxSimulatedDays, d.maxSimulatedDays, 1, 365),
    pauseOnIntervention: clampBoolean(raw.pauseOnIntervention, d.pauseOnIntervention),
    autoAdvanceEnabled: clampBoolean(raw.autoAdvanceEnabled, d.autoAdvanceEnabled),
    courseWeekdays: normalizeWeekdays(raw.courseWeekdays, d.courseWeekdays),
    lessonsPerDay: clampInteger(raw.lessonsPerDay, d.lessonsPerDay, 1, 10),
  };
}

/**
 * 深合并：现有 PUT 可能只带一个块（如 VL RPM 输入框只发 virtualLearnerRpmLimit），
 * 不能因此把 dateSimulation 重置回默认。逐块合并后再归一。
 */
export function mergeVirtualLabSettings(
  existing: Partial<VirtualLabSettings> | null | undefined,
  input: Partial<VirtualLabSettings>
): Partial<VirtualLabSettings> {
  const base = existing ?? DEFAULT_VIRTUAL_LAB_SETTINGS;
  return {
    ...base,
    ...input,
    dateSimulation: normalizeDateSimulation({
      ...(base.dateSimulation || DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation),
      ...(input.dateSimulation || {}),
    }),
  };
}

export function normalizeVirtualLabSettings(
  input: Partial<VirtualLabSettings> | null | undefined
): VirtualLabSettings {
  return {
    virtualLearnerRpmLimit: clampInteger(
      input?.virtualLearnerRpmLimit,
      DEFAULT_VIRTUAL_LAB_SETTINGS.virtualLearnerRpmLimit,
      0,
      100_000
    ),
    dateSimulation: normalizeDateSimulation(input?.dateSimulation),
  };
}

export async function getVirtualLabSettings(): Promise<VirtualLabSettings> {
  const stored = await systemPrisma.platform_settings.findUnique({
    where: { key: VIRTUAL_LAB_SETTING_KEY }
  });
  if (!stored) return { ...DEFAULT_VIRTUAL_LAB_SETTINGS };
  try {
    return normalizeVirtualLabSettings(JSON.parse(stored.value));
  } catch {
    throw new Error('虚拟学习者设置值无效');
  }
}

export async function updateVirtualLabSettings(
  input: Partial<VirtualLabSettings>
): Promise<VirtualLabSettings> {
  // 深合并：现有 PUT 可能只带 virtualLearnerRpmLimit（如 VL RPM 输入框），
  // 不能因此把 dateSimulation 重置回默认。
  const existing = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
  const value = normalizeVirtualLabSettings(mergeVirtualLabSettings(existing, input));
  await systemPrisma.platform_settings.upsert({
    where: { key: VIRTUAL_LAB_SETTING_KEY },
    update: { value: JSON.stringify(value) },
    create: { key: VIRTUAL_LAB_SETTING_KEY, value: JSON.stringify(value) }
  });
  runtimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
  return value;
}

export async function getRuntimeVirtualLabSettings(): Promise<VirtualLabSettings> {
  if (runtimeCache && runtimeCache.expiresAt > Date.now()) return runtimeCache.value;
  try {
    const value = await getVirtualLabSettings();
    runtimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.warn('[virtual-lab-settings] 读取设置失败，使用代码默认值', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { ...DEFAULT_VIRTUAL_LAB_SETTINGS };
  }
}
