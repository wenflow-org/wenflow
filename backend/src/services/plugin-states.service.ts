/**
 * 插件启停状态（2026-10-24）。
 *
 * 存储：`platform_settings` 单键 `pluginStates`（JSON：{ web: true, ... }）。
 * 缺省 = 全部启用——停用是收窄能力，不能因设置行缺失把主链打断。
 * 读取失败同样按启用处理（fail-open）：这里是能力开关，不是安全边界。
 *
 * 缓存 5s：executeSkill 在每次能力调用前读一次，避免每跳一次 DB；
 * 写接口会同步刷新缓存，运营刚点的开关立即生效。
 */
import systemPrisma from '../config/system-database';
import { PLUGIN_CATALOG, type PluginId } from '../config/plugin-catalog';
import { logger } from '../utils/logger';

const SETTING_KEY = 'pluginStates';
const CACHE_TTL_MS = 5_000;

export type PluginStates = Record<PluginId, boolean>;

function defaultStates(): PluginStates {
  return Object.fromEntries(PLUGIN_CATALOG.map((g) => [g.id, true])) as PluginStates;
}

function normalize(raw: unknown): PluginStates {
  const states = defaultStates();
  if (raw && typeof raw === 'object') {
    for (const id of Object.keys(states) as PluginId[]) {
      const value = (raw as Record<string, unknown>)[id];
      if (typeof value === 'boolean') states[id] = value;
    }
  }
  return states;
}

let cache: { at: number; states: PluginStates } | null = null;

export async function getPluginStates(): Promise<PluginStates> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.states;
  try {
    const row = await systemPrisma.platform_settings.findUnique({ where: { key: SETTING_KEY } });
    const states = row?.value ? normalize(JSON.parse(row.value)) : defaultStates();
    cache = { at: Date.now(), states };
    return states;
  } catch (error) {
    logger.warn('[plugin-states] 读取失败，按全部启用处理', {
      error: error instanceof Error ? error.message : String(error),
    });
    return defaultStates();
  }
}

export async function setPluginEnabled(id: PluginId, enabled: boolean): Promise<PluginStates> {
  const current = await getPluginStates();
  const next: PluginStates = { ...current, [id]: enabled };
  await systemPrisma.platform_settings.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  });
  cache = { at: Date.now(), states: next };
  return next;
}

/** 测试缝：清空进程内缓存，让下一次读取回到 DB */
export function resetPluginStatesCache(): void {
  cache = null;
}

/** 启动/热更新时预热一次（失败不阻塞启动） */
export async function warmPluginStates(): Promise<void> {
  await getPluginStates();
}
