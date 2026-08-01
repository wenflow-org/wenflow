import fs from 'fs/promises';
import path from 'path';
import systemPrisma from '../config/system-database';

export interface PlatformSettings {
  registrationEnabled: boolean;
}

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

async function persistRegistrationSetting(registrationEnabled: boolean): Promise<void> {
  await systemPrisma.platform_settings.upsert({
    where: { key: REGISTRATION_SETTING_KEY },
    update: { value: String(registrationEnabled) },
    create: {
      key: REGISTRATION_SETTING_KEY,
      value: String(registrationEnabled)
    }
  });
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  try {
    const stored = await systemPrisma.platform_settings.findUnique({
      where: { key: REGISTRATION_SETTING_KEY }
    });
    if (stored) {
      const registrationEnabled = parseBoolean(stored.value);
      if (registrationEnabled === null) {
        throw new PlatformSettingsUnavailableError('平台注册设置值无效');
      }
      return { registrationEnabled };
    }

    const legacyValue = await readLegacyRegistrationSetting();
    if (legacyValue === null) {
      throw new PlatformSettingsUnavailableError('平台注册设置尚未初始化');
    }
    await persistRegistrationSetting(legacyValue);
    return { registrationEnabled: legacyValue };
  } catch (error) {
    if (error instanceof PlatformSettingsUnavailableError) throw error;
    throw new PlatformSettingsUnavailableError();
  }
}

export async function updatePlatformSettings(input: Partial<PlatformSettings>): Promise<PlatformSettings> {
  if (typeof input.registrationEnabled !== 'boolean') {
    return getPlatformSettings();
  }

  try {
    await persistRegistrationSetting(input.registrationEnabled);
    return { registrationEnabled: input.registrationEnabled };
  } catch {
    throw new PlatformSettingsUnavailableError('平台注册设置保存失败');
  }
}
