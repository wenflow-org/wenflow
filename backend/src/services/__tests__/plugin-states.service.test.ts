export {};

const findUnique = jest.fn();
const upsert = jest.fn();

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_settings: {
      findUnique: (...args: any[]) => findUnique(...args),
      upsert: (...args: any[]) => upsert(...args),
    },
  },
}));

import {
  getPluginStates,
  setPluginEnabled,
  resetPluginStatesCache,
} from '../plugin-states.service';

describe('plugin-states（插件启停）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPluginStatesCache();
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
  });

  it('没有设置行 → 全部启用（缺省不能把能力关掉）', async () => {
    await expect(getPluginStates()).resolves.toEqual({ web: true, decision: true, image: true, mcp: true });
  });

  it('只认布尔值，损坏/多余字段忽略', async () => {
    findUnique.mockResolvedValue({ key: 'pluginStates', value: JSON.stringify({ web: false, decision: 'no', other: false }) });
    await expect(getPluginStates()).resolves.toEqual({ web: false, decision: true, image: true, mcp: true });
  });

  it('写开关后刷新缓存，同一进程内立即生效', async () => {
    findUnique.mockResolvedValue({ key: 'pluginStates', value: JSON.stringify({ web: true }) });
    await getPluginStates();
    const states = await setPluginEnabled('web', false);
    expect(states.web).toBe(false);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'pluginStates' },
      update: { value: JSON.stringify({ web: false, decision: true, image: true, mcp: true }) },
    }));
    // 缓存已更新：不再读 DB
    findUnique.mockClear();
    await expect(getPluginStates()).resolves.toMatchObject({ web: false });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('读取失败 → 按全部启用（fail-open，不打断主链）', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(getPluginStates()).resolves.toEqual({ web: true, decision: true, image: true, mcp: true });
  });
});
