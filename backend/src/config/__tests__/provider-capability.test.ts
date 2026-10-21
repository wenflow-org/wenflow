/**
 * 通道能力矩阵（2026-10-20）。
 *
 * 锁定 `supportsSystemRole` 的默认规则，防止未来改注册表时悄悄退回到
 * 「全局折叠」或「全都保留 system」两种极端：
 * - inherit（平台通道）未声明 → 折叠（安全默认，对齐 2026-09-22 事故后行为）
 * - own（自带 baseUrl）未声明 → 保留 system（标准 OpenAI 兼容）
 * - 显式声明永远优先；未登记 provider → 保留 system
 */
import { parseLlmProvidersConfig, providerAcceptsSystemRole } from '../models.config';

describe('providerAcceptsSystemRole（纯能力矩阵）', () => {
  it('未登记 provider → 保留 system', () => {
    expect(providerAcceptsSystemRole(undefined)).toBe(true);
    expect(providerAcceptsSystemRole(null)).toBe(true);
  });

  it('inherit 通道未声明 → 折叠（平台聚合网关的安全默认）', () => {
    expect(providerAcceptsSystemRole({ endpointSource: 'inherit' })).toBe(false);
  });

  it('own 通道未声明 → 保留 system', () => {
    expect(providerAcceptsSystemRole({ endpointSource: 'own' })).toBe(true);
  });

  it('显式声明优先于端点来源', () => {
    expect(providerAcceptsSystemRole({ endpointSource: 'inherit', supportsSystemRole: true })).toBe(true);
    expect(providerAcceptsSystemRole({ endpointSource: 'own', supportsSystemRole: false })).toBe(false);
  });
});

describe('parseLlmProvidersConfig：supportsSystemRole 透传', () => {
  const config = (providerExtra: string) => JSON.stringify({
    providers: {
      platform: {
        name: '平台',
        recommended: true,
        ...JSON.parse(providerExtra),
        models: {
          'm1': { label: 'M1', tier: 'chat' },
        },
      },
    },
    aliases: { chat: ['m1'] },
    defaults: { chat: 'm1', reasoning: 'm1' },
  });

  it('声明 false 时写入 ProviderDefinition', () => {
    const snapshot = parseLlmProvidersConfig(config('{"supportsSystemRole":false}'));
    expect(snapshot.providers[0].supportsSystemRole).toBe(false);
    expect(snapshot.providers[0].endpointSource).toBe('inherit');
  });

  it('未声明时字段保持 undefined（由默认规则决定）', () => {
    const snapshot = parseLlmProvidersConfig(config('{}'));
    expect(snapshot.providers[0].supportsSystemRole).toBeUndefined();
  });
});
