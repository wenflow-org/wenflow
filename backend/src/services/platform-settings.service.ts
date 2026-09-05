import fs from 'fs/promises';
import path from 'path';
import systemPrisma from '../config/system-database';

export interface PlatformSettings {
  registrationEnabled: boolean;
  /** 单 IP 每日注册配额开关（默认关）；开启后同 IP 24h 内成功注册数受限 */
  registerIpQuotaEnabled?: boolean;
  /** 开启后的每日限额（1-100），默认 5 */
  registerIpDailyQuota?: number;
}

/** 平台 key 统一存这里（避免散落字符串笔误） */
export const PLATFORM_SETTING_KEYS = {
  registrationEnabled: 'registrationEnabled',
  registerIpQuotaEnabled: 'registerIpQuotaEnabled',
  registerIpDailyQuota: 'registerIpDailyQuota'
} as const;

export const DEFAULT_REGISTER_IP_DAILY_QUOTA = 5;
export const MAX_REGISTER_IP_DAILY_QUOTA = 100;

export class PlatformSettingsUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'PLATFORM_SETTINGS_UNAVAILABLE';

  constructor(message = '平台设置暂时不可用') {
    super(message);
    this.name = 'PlatformSettingsUnavailableError';
  }
}

const REGISTRATION_SETTING_KEY = 'registrationEnabled';
const legacySettingsPath = path.join(__dirname, '../../config/platform-settings.json');

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= max) return parsed;
  }
  return fallback;
}

async function readLegacyRegistrationSetting(): Promise<boolean | null> {
  try {
    const raw = await fs.readFile(legacySettingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PlatformSettings>;
    return parseBoolean(parsed.registrationEnabled);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw new PlatformSettingsUnavailableError('旧平台设置无法读取');
  }
}

async function persistPlatformSetting(key: string, value: string): Promise<void> {
  await systemPrisma.platform_settings.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
}

/**
 * 读取单条平台设置（含注册配额相关），无记录/损坏时返回 undefined。
 * 读取失败按「缺失」处理：调用方回退默认值，避免单条设置损坏拖垮整个平台设置。
 */
async function readSetting(key: string): Promise<string | undefined> {
  try {
    const stored = await systemPrisma.platform_settings.findUnique({ where: { key } });
    return stored?.value;
  } catch {
    return undefined;
  }
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  // registrationEnabled：DB 无记录时回退旧文件；旧文件也无 → 503（未初始化）
  const stored = await readSetting(REGISTRATION_SETTING_KEY);
  let registrationEnabled: boolean;
  if (stored !== undefined) {
    const parsed = parseBoolean(stored);
    if (parsed === null) {
      throw new PlatformSettingsUnavailableError('平台注册设置值无效');
    }
    registrationEnabled = parsed;
  } else {
    const legacyValue = await readLegacyRegistrationSetting();
    if (legacyValue === null) {
      throw new PlatformSettingsUnavailableError('平台注册设置尚未初始化');
    }
    registrationEnabled = legacyValue;
    await persistPlatformSetting(REGISTRATION_SETTING_KEY, String(registrationEnabled));
  }

  // registerIpQuotaEnabled：默认关（不限制）；布尔读取失败视为关
  const quotaEnabledStored = await readSetting(PLATFORM_SETTING_KEYS.registerIpQuotaEnabled);
  const registerIpQuotaEnabled = quotaEnabledStored === undefined
    ? false
    : parseBoolean(quotaEnabledStored) === true;

  // registerIpDailyQuota：仅在启用开关时生效；默认 5（上限 100）
  const quotaStored = await readSetting(PLATFORM_SETTING_KEYS.registerIpDailyQuota);
  const registerIpDailyQuota = quotaStored === undefined
    ? DEFAULT_REGISTER_IP_DAILY_QUOTA
    : parsePositiveInt(quotaStored, DEFAULT_REGISTER_IP_DAILY_QUOTA, MAX_REGISTER_IP_DAILY_QUOTA);

  return { registrationEnabled, registerIpQuotaEnabled, registerIpDailyQuota };
}

export async function updatePlatformSettings(input: Partial<PlatformSettings>): Promise<PlatformSettings> {
  if (typeof input.registrationEnabled === 'boolean') {
    await persistPlatformSetting(REGISTRATION_SETTING_KEY, String(input.registrationEnabled));
  }
  if (typeof input.registerIpQuotaEnabled === 'boolean') {
    await persistPlatformSetting(PLATFORM_SETTING_KEYS.registerIpQuotaEnabled, String(input.registerIpQuotaEnabled));
  }
  if (input.registerIpDailyQuota !== undefined) {
    const quota = parsePositiveInt(input.registerIpDailyQuota, DEFAULT_REGISTER_IP_DAILY_QUOTA, MAX_REGISTER_IP_DAILY_QUOTA);
    await persistPlatformSetting(PLATFORM_SETTING_KEYS.registerIpDailyQuota, String(quota));
  }
  return getPlatformSettings();
}
