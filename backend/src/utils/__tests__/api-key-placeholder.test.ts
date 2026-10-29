/**
 * API Key 占位值识别单测（#142）：文档占位 / 空白 → 未配置；真实 key 一律放行。
 */
import { isConfiguredApiKey, isPlaceholderApiKey } from '../api-key-placeholder';

describe('api-key-placeholder（占位 key 识别）', () => {
  it('空值形态（空串/纯空白/null/undefined）按未配置处理', () => {
    expect(isPlaceholderApiKey('')).toBe(true);
    expect(isPlaceholderApiKey('   ')).toBe(true);
    expect(isPlaceholderApiKey(null)).toBe(true);
    expect(isPlaceholderApiKey(undefined)).toBe(true);
  });

  it('.env.example 文档占位值按未配置处理（含大小写/首尾空白变体）', () => {
    expect(isPlaceholderApiKey('sk-your-api-key')).toBe(true);
    expect(isPlaceholderApiKey('SK-Your-API-Key')).toBe(true);
    expect(isPlaceholderApiKey('  sk-your-api-key  ')).toBe(true);
    expect(isPlaceholderApiKey('sk-your-key')).toBe(true);
    expect(isPlaceholderApiKey('your-api-key')).toBe(true);
    expect(isPlaceholderApiKey('replace-with-your-tinyfish-search-key')).toBe(true);
  });

  it('replace-with- / sk-your- 模板前缀按未配置处理', () => {
    expect(isPlaceholderApiKey('replace-with-anything')).toBe(true);
    expect(isPlaceholderApiKey('sk-your-own-key-here')).toBe(true);
  });

  it('真实 key 一律放行（配置判断不受影响）', () => {
    expect(isPlaceholderApiKey('sk-real-abc123def456')).toBe(false);
    expect(isPlaceholderApiKey('sk-proj-9h2Xk1LmNpQrStUv')).toBe(false);
    expect(isPlaceholderApiKey('tvly-abc123')).toBe(false);
    expect(isPlaceholderApiKey('cfut_deadbeef')).toBe(false);
    // 形似但不是文档占位：sk-your- 前缀之外的自定义串不算占位
    expect(isPlaceholderApiKey('sk-yourapi-key-official')).toBe(false);
  });

  it('isConfiguredApiKey 与 isPlaceholderApiKey 互为反口', () => {
    expect(isConfiguredApiKey('sk-real-abc123def456')).toBe(true);
    expect(isConfiguredApiKey('sk-your-api-key')).toBe(false);
    expect(isConfiguredApiKey('')).toBe(false);
  });
});
