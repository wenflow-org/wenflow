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

export interface VirtualLabSettings {
  /** 虚拟学习者专属出站 LLM 请求速率上限（RPM）；0 = 不限 */
  virtualLearnerRpmLimit: number;
}

export const DEFAULT_VIRTUAL_LAB_SETTINGS: VirtualLabSettings = {
  // 默认不限，避免未配置时改变现网行为
  virtualLearnerRpmLimit: 0
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

export function normalizeVirtualLabSettings(
  input: Partial<VirtualLabSettings> | null | undefined
): VirtualLabSettings {
  return {
    virtualLearnerRpmLimit: clampInteger(
      input?.virtualLearnerRpmLimit,
      DEFAULT_VIRTUAL_LAB_SETTINGS.virtualLearnerRpmLimit,
      0,
      100_000
    )
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
  const value = normalizeVirtualLabSettings(input);
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
