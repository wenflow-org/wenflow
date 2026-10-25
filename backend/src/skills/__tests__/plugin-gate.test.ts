/**
 * 插件启停门禁（2026-10-24 用户「插件就是配置启用」）。
 *
 * 契约：停用插件时，成员 Skill 在统一分发点被拦下，不进入 handler；
 * 门禁放在 executeSkillWithResult 而不是各 handler，新增成员不会漏判。
 */
const getPluginStates = jest.fn();

jest.mock('../../services/plugin-states.service', () => ({
  getPluginStates: (...args: any[]) => getPluginStates(...args),
}));

import { executeSkillWithResult } from '../index';
import { pluginIdOfSkill, pluginNameOf, isKnownPluginId } from '../../config/plugin-catalog';

describe('插件目录', () => {
  it('成员 Skill → 插件；带 skill: 前缀也能识别', () => {
    expect(pluginIdOfSkill('web-search')).toBe('web');
    expect(pluginIdOfSkill('skill:web-fetch')).toBe('web');
    expect(pluginIdOfSkill('decision-gate')).toBe('decision');
    expect(pluginIdOfSkill('not-a-plugin-skill')).toBeNull();
  });

  it('插件 id 与中文名一一对应，未知 id 拒绝入参', () => {
    expect(pluginNameOf('mcp')).toBe('MCP 工具调用');
    expect(isKnownPluginId('image')).toBe(true);
    expect(isKnownPluginId('bogus')).toBe(false);
  });
});

describe('executeSkillWithResult 插件门禁', () => {
  beforeEach(() => {
    getPluginStates.mockReset();
    getPluginStates.mockResolvedValue({ web: true, decision: true, image: true, mcp: true });
  });

  it('停用的插件 → 成员 Skill 不执行，报出插件名', async () => {
    getPluginStates.mockResolvedValue({ web: false, decision: true, image: true, mcp: true });
    await expect(executeSkillWithResult({ id: 'skill:web-search' }, {})).rejects.toThrow(
      '插件「联网」已停用，Skill「web-search」未执行'
    );
  });

  it('启用的插件 → 门禁放行（未知 Skill 仍走原有 handler 缺失分支）', async () => {
    await expect(executeSkillWithResult({ id: 'not-a-plugin-skill' }, {})).rejects.toThrow(
      'Skill handler not found: not-a-plugin-skill'
    );
  });

  it('非插件成员不查启停状态', async () => {
    await expect(executeSkillWithResult({ id: 'not-a-plugin-skill' }, {})).rejects.toThrow('Skill handler not found');
    expect(getPluginStates).not.toHaveBeenCalled();
  });
});
