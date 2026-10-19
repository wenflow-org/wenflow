/**
 * 生成参数来源词（后端枚举码 → 人话）：这些码只在接口里存在，
 * 直接渲染会让「生效值」胶囊露出 active-prompt / route-fallback 这类黑话。
 */
import { describe, expect, it } from 'vitest';
import { callParamSourceLabel } from '../skill-design/sdp-shared';

describe('callParamSourceLabel：来源码人话化', () => {
  it('逐个映射后端 resolve-llm-call-params 的枚举码', () => {
    expect(callParamSourceLabel('active-prompt')).toBe('Prompt 文件声明');
    expect(callParamSourceLabel('route-fallback')).toBe('路由表');
    expect(callParamSourceLabel('skill-override')).toBe('本 Skill 覆盖');
    expect(callParamSourceLabel('runtime-override')).toBe('调用时指定');
    expect(callParamSourceLabel('code-defaults')).toBe('代码默认');
    expect(callParamSourceLabel('none')).toBe('未设');
    expect(callParamSourceLabel('platform-default')).toBe('平台默认');
    expect(callParamSourceLabel('agent-or-platform')).toBe('Agent / 平台默认');
    expect(callParamSourceLabel('unresolved')).toBe('未解析');
  });

  it('缺值给「—」，未知码原样返回（宁可露码，也不把来源藏掉）', () => {
    expect(callParamSourceLabel(undefined)).toBe('—');
    expect(callParamSourceLabel(null)).toBe('—');
    expect(callParamSourceLabel('')).toBe('—');
    expect(callParamSourceLabel('some-new-source')).toBe('some-new-source');
  });

  it('不再返回任何原始枚举码（防回归：新增码必须补映射）', () => {
    // 后端 LlmParamSource 全量 + 契约服务同族码
    for (const raw of [
      'active-prompt', 'route-fallback', 'skill-override', 'runtime-override',
      'code-defaults', 'none', 'route', 'platform-default', 'agent-or-platform', 'unresolved',
    ]) {
      const label = callParamSourceLabel(raw);
      expect(label).not.toBe(raw);
      expect(label).not.toContain('-');
    }
  });
});
