import systemPrisma from '../config/system-database';
import {
  createRetryBudget,
  RETRY_BUDGET_HARD_LIMITS,
  type RetryBudget
} from '../gateway/api-gateway/retry-budget';
import { logger } from '../utils/logger';

const RELIABILITY_SETTING_KEY = 'aiReliability';
const RUNTIME_CACHE_TTL_MS = 30_000;

export interface PlatformReliabilitySettings {
  maxUpstreamAttempts: number;
  maxTransportRetries: number;
  maxLogicalRetries: number;
  defaultRequestTimeoutMs: number;
  retryBaseDelayMs: number;
  maxRetryAfterMs: number;
  jitterEnabled: boolean;
}

export const DEFAULT_PLATFORM_RELIABILITY_SETTINGS: PlatformReliabilitySettings = {
  maxUpstreamAttempts: 5,
  maxTransportRetries: 3,
  maxLogicalRetries: 3,
  // 上游（deepseek-v4-flash）响应慢：单次调用 5 分钟常超时，放宽到 10 分钟（2026-08-30）
  defaultRequestTimeoutMs: 600_000,
  retryBaseDelayMs: 1_000,
  maxRetryAfterMs: 10_000,
  jitterEnabled: true
};

let runtimeCache: { value: PlatformReliabilitySettings; expiresAt: number } | null = null;

export function clearReliabilitySettingsCache(): void {
  runtimeCache = null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function normalizePlatformReliabilitySettings(
  input: Partial<PlatformReliabilitySettings> | null | undefined
): PlatformReliabilitySettings {
  return {
    maxUpstreamAttempts: clampInteger(
      input?.maxUpstreamAttempts,
      DEFAULT_PLATFORM_RELIABILITY_SETTINGS.maxUpstreamAttempts,
      1,
      RETRY_BUDGET_HARD_LIMITS.maxUpstreamAttempts
    ),
    maxTransportRetries: clampInteger(
      input?.maxTransportRetries,
      DEFAULT_PLATFORM_RELIABILITY_SETTINGS.maxTransportRetries,
      0,
      RETRY_BUDGET_HARD_LIMITS.maxTransportRetries
    ),
    maxLogicalRetries: clampInteger(
      input?.maxLogicalRetries,
      DEFAULT_PLATFORM_RELIABILITY_SETTINGS.maxLogicalRetries,
      0,
      RETRY_BUDGET_HARD_LIMITS.maxLogicalRetries
    ),
    defaultRequestTimeoutMs: clampInteger(
      input?.defaultRequestTimeoutMs,
      DEFAULT_PLATFORM_RELIABILITY_SETTINGS.defaultRequestTimeoutMs,
      RETRY_BUDGET_HARD_LIMITS.minRequestTimeoutMs,
      RETRY_BUDGET_HARD_LIMITS.maxRequestTimeoutMs
    ),
    retryBaseDelayMs: clampInteger(
      input?.retryBaseDelayMs,
      DEFAULT_PLATFORM_RELIABILITY_SETTINGS.retryBaseDelayMs,
      RETRY_BUDGET_HARD_LIMITS.minRetryBaseDelayMs,
      RETRY_BUDGET_HARD_LIMITS.maxRetryBaseDelayMs
    ),
    maxRetryAfterMs: clampInteger(
      input?.maxRetryAfterMs,
      DEFAULT_PLATFORM_RELIABILITY_SETTINGS.maxRetryAfterMs,
      0,
      RETRY_BUDGET_HARD_LIMITS.maxRetryAfterMs
    ),
    jitterEnabled: input?.jitterEnabled !== false
  };
}

export async function getPlatformReliabilitySettings(): Promise<PlatformReliabilitySettings> {
  const stored = await systemPrisma.platform_settings.findUnique({
    where: { key: RELIABILITY_SETTING_KEY }
  });
  if (!stored) return { ...DEFAULT_PLATFORM_RELIABILITY_SETTINGS };
  try {
    return normalizePlatformReliabilitySettings(JSON.parse(stored.value));
  } catch {
    throw new Error('AI 可靠性设置值无效');
  }
}

export async function updatePlatformReliabilitySettings(
  input: Partial<PlatformReliabilitySettings>
): Promise<PlatformReliabilitySettings> {
  const value = normalizePlatformReliabilitySettings(input);
  await systemPrisma.platform_settings.upsert({
    where: { key: RELIABILITY_SETTING_KEY },
    update: { value: JSON.stringify(value) },
    create: { key: RELIABILITY_SETTING_KEY, value: JSON.stringify(value) }
  });
  runtimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
  return value;
}

export async function getRuntimeReliabilitySettings(): Promise<PlatformReliabilitySettings> {
  if (runtimeCache && runtimeCache.expiresAt > Date.now()) return runtimeCache.value;
  try {
    const value = await getPlatformReliabilitySettings();
    runtimeCache = { value, expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.warn('[reliability-settings] 读取平台设置失败，使用代码默认值', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { ...DEFAULT_PLATFORM_RELIABILITY_SETTINGS };
  }
}

export async function createRuntimeRetryBudget(): Promise<RetryBudget> {
  const settings = await getRuntimeReliabilitySettings();
  return createRetryBudget(settings);
}

export async function getEffectiveLogicalRetryLimit(
  skillId?: string,
  platformDefault?: number
): Promise<number> {
  const fallback = platformDefault ?? (await getRuntimeReliabilitySettings()).maxLogicalRetries;
  if (!skillId) return fallback;
  try {
    const skillConfig = await systemPrisma.skill_model_configs.findUnique({
      where: { skillId },
      select: { maxLogicalRetries: true }
    });
    if (skillConfig?.maxLogicalRetries !== null && skillConfig?.maxLogicalRetries !== undefined) {
      return Math.min(
        fallback,
        clampInteger(
          skillConfig.maxLogicalRetries,
          fallback,
          0,
          RETRY_BUDGET_HARD_LIMITS.maxLogicalRetries
        )
      );
    }
  } catch (error) {
    logger.warn('[reliability-settings] 读取 Skill 重试覆盖失败，使用平台默认值', {
      skillId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return fallback;
}

export function getReliabilityHardLimits() {
  return RETRY_BUDGET_HARD_LIMITS;
}
