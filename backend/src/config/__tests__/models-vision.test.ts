/**
 * 视觉能力声明的注册表测试（#123）。
 *
 * 能力是**声明式**的（网关端点没有能力字段），所以这里锁三件事：
 *  1. 真实配置里平台默认模型与 VL 侧模型声明了 vision（issue 实测结论的回归锚）；
 *  2. 未声明/未知模型一律 false（保守拒绝，不猜）；
 *  3. parseLlmProvidersConfig 对 vision 的解析是显式布尔（true/false 解析、其他值忽略）。
 */
import { MODEL_MAP, parseLlmProvidersConfig, supportsVision } from '../models.config';

describe('supportsVision（注册表声明是唯一事实源）', () => {
  it('实测可用视觉的平台模型已声明', () => {
    expect(supportsVision('deepseek-v4.1-flash')).toBe(true);
    expect(supportsVision('agnes-3.0-flash')).toBe(true);
  });

  it('未声明 / 未知 / 空值一律 false（保守拒绝，不猜能力）', () => {
    expect(supportsVision('deepseek-v4-pro')).toBe(false);
    expect(supportsVision('deepseek-v4-flash')).toBe(false);
    expect(supportsVision('gpt-4o')).toBe(false);
    expect(supportsVision('')).toBe(false);
    expect(supportsVision('   ')).toBe(false);
  });

  it('模型 id 两侧空白容错（与其它 registry 查询同口径）', () => {
    expect(supportsVision(' deepseek-v4.1-flash ')).toBe(true);
  });
});

describe('parseLlmProvidersConfig × vision', () => {
  const raw = JSON.stringify({
    providers: {
      platform: {
        name: '平台通道（继承）',
        models: {
          'vision-yes': { tier: 'chat', vision: true },
          'vision-no': { tier: 'chat', vision: false },
          'vision-none': { tier: 'chat' },
        },
      },
    },
  });

  it('true/false 解析为布尔；未声明则为 undefined（不落默认值）', () => {
    const snapshot = parseLlmProvidersConfig(raw);
    const models = (snapshot as unknown as { models: Array<{ id: string; vision?: boolean }> }).models;
    const byId = new Map(models.map((model) => [model.id, model]));
    expect(byId.get('vision-yes')?.vision).toBe(true);
    expect(byId.get('vision-no')?.vision).toBe(false);
    expect(byId.get('vision-none')?.vision).toBeUndefined();
  });

  it('真实配置里 MODEL_MAP 与 supportsVision 同源（读的是同一份注册表）', () => {
    const declared = Array.from(MODEL_MAP.values()).filter((model) => model.vision === true).map((model) => model.id);
    expect(declared).toEqual(expect.arrayContaining(['deepseek-v4.1-flash', 'agnes-3.0-flash']));
    for (const id of declared) expect(supportsVision(id)).toBe(true);
  });
});
