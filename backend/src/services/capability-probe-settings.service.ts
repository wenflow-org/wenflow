import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';

const SETTING_KEY_ENABLED = 'aiCapabilityProbeEnabled';
const SETTING_KEY_INTERVAL = 'aiCapabilityProbeInterval';
const RUNTIME_CACHE_TTL_MS = 30_000;

export const DEFAULT_CAPABILITY_PROBE_ENABLED = false;

export const DEFAULT_CAPABILITY_PROBE_INTERVAL_MS = 120_000;
export const MIN_CAPABILITY_PROBE_INTERVAL_MS = 10_000;
export const MAX_CAPABILITY_PROBE_INTERVAL_MS = 86_400_000;

let enabledRuntimeCache: { value: boolean; expiresAt: number } | null = null;
let intervalRuntimeCache: { value: number; expiresAt: number } | null = null;

export function clearCapabilityProbeSettingsCache(): void {
  enabledRuntimeCache = null;
  intervalRuntimeCache = null;
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

export function normalizeCapabilityProbeInterval(input: unknown): number {
  const n = typeof input === 'string' ? Number(input) : input;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return DEFAULT_CAPABILITY_PROBE_INTERVAL_MS;
  }
  return Math.max(MIN_CAPABILITY_PROBE_INTERVAL_MS, Math.min(MAX_CAPABILITY_PROBE_INTERVAL_MS, n));
}

export async function getPlatformCapabilityProbeEnabled(): Promise<boolean> {
  const stored = await systemPrisma.platform_settings.findUnique({
    where: { key: SETTING_KEY_ENABLED }
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
    where: { key: SETTING_KEY_ENABLED },
    update: { value: JSON.stringify(value) },
    create: { key: SETTING_KEY_ENABLED, value: JSON.stringify(value) }
  });
  enabledRuntimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
  return value;
}

export async function getRuntimeCapabilityProbeEnabled(): Promise<boolean> {
  if (enabledRuntimeCache && enabledRuntimeCache.expiresAt > Date.now()) return enabledRuntimeCache.value;
  try {
    const value = await getPlatformCapabilityProbeEnabled();
    enabledRuntimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.warn('[capability-probe-settings] 读取开关失败，使用代码默认值', {
      error: error instanceof Error ? error.message : String(error)
    });
    return DEFAULT_CAPABILITY_PROBE_ENABLED;
  }
}

export async function getPlatformCapabilityProbeInterval(): Promise<number> {
  const stored = await systemPrisma.platform_settings.findUnique({
    where: { key: SETTING_KEY_INTERVAL }
  });
  if (!stored) return DEFAULT_CAPABILITY_PROBE_INTERVAL_MS;
  try {
    return normalizeCapabilityProbeInterval(JSON.parse(stored.value));
  } catch {
    return DEFAULT_CAPABILITY_PROBE_INTERVAL_MS;
  }
}

export async function updatePlatformCapabilityProbeInterval(input: unknown): Promise<number> {
  const value = normalizeCapabilityProbeInterval(input);
  await systemPrisma.platform_settings.upsert({
    where: { key: SETTING_KEY_INTERVAL },
    update: { value: JSON.stringify(value) },
    create: { key: SETTING_KEY_INTERVAL, value: JSON.stringify(value) }
  });
  intervalRuntimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
  return value;
}

export async function getRuntimeCapabilityProbeInterval(): Promise<number> {
  if (intervalRuntimeCache && intervalRuntimeCache.expiresAt > Date.now()) return intervalRuntimeCache.value;
  try {
    const value = await getPlatformCapabilityProbeInterval();
    intervalRuntimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.warn('[capability-probe-settings] 读取探测间隔失败，使用代码默认值', {
      error: error instanceof Error ? error.message : String(error)
    });
    return DEFAULT_CAPABILITY_PROBE_INTERVAL_MS;
  }
}
