import fs from 'fs/promises';
import path from 'path';

export interface PlatformSettings {
  registrationEnabled: boolean;
}

const settingsPath = path.join(__dirname, '../../config/platform-settings.json');

const defaultSettings: PlatformSettings = {
  registrationEnabled: true
};

async function readSettingsFile(): Promise<Partial<PlatformSettings>> {
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(raw) as Partial<PlatformSettings>;
  } catch {
    return {};
  }
}

async function writeSettingsFile(settings: PlatformSettings): Promise<void> {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const current = await readSettingsFile();
  return {
    registrationEnabled:
      typeof current.registrationEnabled === 'boolean'
        ? current.registrationEnabled
        : defaultSettings.registrationEnabled
  };
}

export async function updatePlatformSettings(input: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const existing = await getPlatformSettings();
  const merged: PlatformSettings = {
    registrationEnabled:
      typeof input.registrationEnabled === 'boolean'
        ? input.registrationEnabled
        : existing.registrationEnabled
  };

  await writeSettingsFile(merged);
  return merged;
}
