import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';

const SETTING_KEY = 'aiCapabilityProbeEnabled';
const RUNTIME_CACHE_TTL_MS = 30_000;

export const DEFAULT_CAPABILITY_PROBE_ENABLED = true;

let runtimeCache: { value: boolean; expiresAt: number } | null = null;

export function clearCapabilityProbeSettingsCache(): void {
  runtimeCache = null;
}

export function normalizeCapabilityProbeEnabled(input: unknown): boolean {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    if (input === 'true') return true;
    if (input === 'false') return false;
  }
  if (typeof input === 'number') return input !== 0;
  return DEFAULT_CAPABILITY_PROBE_ENABLED;
}

export async function getPlatformCapabilityProbeEnabled(): Promise<boolean> {
  const stored = await systemPrisma.platform_settings.findUnique({
    where: { key: SETTING_KEY }
  });
  if (!stored) return DEFAULT_CAPABILITY_PROBE_ENABLED;
  try {
    return normalizeCapabilityProbeEnabled(JSON.parse(stored.value));
  } catch {
    throw new Error('AI 能力探测开关设置值无效');
  }
}

export async function updatePlatformCapabilityProbeEnabled(input: unknown): Promise<boolean> {
  const value = normalizeCapabilityProbeEnabled(input);
  await systemPrisma.platform_settings.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(value) },
    create: { key: SETTING_KEY, value: JSON.stringify(value) }
  });
  runtimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
  return value;
}

export async function getRuntimeCapabilityProbeEnabled(): Promise<boolean> {
  if (runtimeCache && runtimeCache.expiresAt > Date.now()) return runtimeCache.value;
  try {
    const value = await getPlatformCapabilityProbeEnabled();
    runtimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.warn('[capability-probe-settings] 读取开关失败，使用代码默认值', {
      error: error instanceof Error ? error.message : String(error)
    });
    return DEFAULT_CAPABILITY_PROBE_ENABLED;
  }
}
