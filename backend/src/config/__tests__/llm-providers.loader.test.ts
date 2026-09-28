/**
 * llm-providers.json 加载器（File-as-Truth 模型目录）：
 * 种子加载 / 解析校验 fail-loud / 缺文件内置兜底 / 热重载（坏文件保上一次好目录）/
 * 限定式引用 provider/model / 历史导出原地更新（引用不失效）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AVAILABLE_MODELS,
  MODEL_MAP,
  getProviderCatalog,
  getLlmRegistryStatus,
  getModelDefaults,
  parseLlmProvidersConfig,
  reloadLlmProvidersIfChanged,
  resolveModelRef
} from '../models.config';

const SEED_PATH = path.resolve(__dirname, '../../../config/llm-providers.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-providers-test-'));
const tempConfig = path.join(tmpDir, 'llm-providers.json');

function writeTempConfig(content: string): void {
  fs.writeFileSync(tempConfig, content, 'utf-8');
  // mtime 精度不足以区分连续两次写入，手动拨一下保证 reload 感知
  const st = fs.statSync(tempConfig);
  fs.utimesSync(tempConfig, st.atime, new Date(st.mtimeMs + 5));
}

const VALID_CUSTOM = JSON.stringify({
  providers: {
    testprov: {
      name: '测试通道',
      baseUrl: 'http://testprov.local/v1',
      apiKeyEnv: 'TEST_PROV_KEY',
      models: {
        'custom-model': { label: 'Custom Model', tier: 'chat', defaultMaxTokens: 32768 }
      }
    },
    inheritprov: {
      name: '继承通道',
      models: {
        'inherit-model': { label: 'Inherit Model', tier: 'reasoning', supportsThinking: true }
      }
    }
  },
  aliases: { chat: ['custom-model'] },
  defaults: { chat: 'custom-model', reasoning: 'inherit-model' }
});

afterAll(() => {
  delete process.env.LLM_PROVIDERS_CONFIG;
  // 恢复种子目录，避免影响同进程内其他用例（jest 每个测试文件独立模块实例，此处为保险）
  reloadLlmProvidersIfChanged();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('llm-providers.json 加载器', () => {
  it('种子文件加载：4 个模型 + 平台继承通道 + 停用示例条目可见', () => {
    expect(MODEL_MAP.size).toBe(4);
    expect(getLlmRegistryStatus().source).toBe('file');
    const platform = getProviderCatalog().find((p) => p.id === 'platform');
    expect(platform?.recommended).toBe(true);
    expect(platform?.endpointSource).toBe('inherit');
    // disabled 示例条目不进运行时注册表，但目录可见
    const example = getProviderCatalog().find((p) => p.id === 'deepseek-official');
    expect(example?.enabled).toBe(false);
    expect(MODEL_MAP.has('deepseek-chat')).toBe(false);
  });

  it('resolveModelRef：裸 id / 限定式 / 未知识别（含带斜杠的字面量不误伤）', () => {
    expect(resolveModelRef('deepseek-v4.1-flash')?.definition.id).toBe('deepseek-v4.1-flash');
    expect(resolveModelRef('platform/deepseek-v4-pro')?.providerId).toBe('platform');
    // 未注册 provider → 不按限定式解析，也无同名裸 id → null（调用方按字面量透传）
    expect(resolveModelRef('deepseek-official/deepseek-chat')).toBeNull();
    expect(resolveModelRef('totally-unknown')).toBeNull();
  });

  it('parseLlmProvidersConfig：坏 JSON / 重复 id / baseUrl 缺 apiKeyEnv / 空注册表 全部 fail-loud', () => {
    expect(() => parseLlmProvidersConfig('{oops')).toThrow(/不是合法 JSON/);
    expect(() => parseLlmProvidersConfig(JSON.stringify({
      providers: {
        a: { models: { 'same-id': { tier: 'chat' } } },
        b: { models: { 'same-id': { tier: 'chat' } } }
      }
    }))).toThrow(/重复/);
    expect(() => parseLlmProvidersConfig(JSON.stringify({
      providers: { a: { baseUrl: 'http://x/v1', models: { m: { tier: 'chat' } } } }
    }))).toThrow(/apiKeyEnv/);
    expect(() => parseLlmProvidersConfig(JSON.stringify({
      providers: { a: { enabled: false, models: { m: { tier: 'chat' } } } }
    }))).toThrow(/没有任何 enabled/);
    expect(() => parseLlmProvidersConfig(JSON.stringify({
      providers: { a: { models: { m: { tier: 'chat', supportsReasoningEffort: true } } } }
    }))).toThrow(/supportsThinking/);
  });

  describe('热重载（env 指向临时文件）', () => {
    beforeEach(() => {
      writeTempConfig(VALID_CUSTOM);
      process.env.LLM_PROVIDERS_CONFIG = tempConfig;
    });

    it('有效新文件 → 注册表切换 + 历史数组引用原地更新 + 供应商自带端点进定义', () => {
      const refBefore = AVAILABLE_MODELS;
      const res = reloadLlmProvidersIfChanged();
      expect(res.reloaded).toBe(true);
      expect(AVAILABLE_MODELS).toBe(refBefore); // 引用不失效
      expect(MODEL_MAP.size).toBe(2);
      const def = MODEL_MAP.get('custom-model');
      expect(def?.providerEndpoint).toEqual({ baseUrl: 'http://testprov.local/v1', apiKeyEnv: 'TEST_PROV_KEY' });
      expect(getModelDefaults().chat).toBe('custom-model');
      expect(resolveModelRef('testprov/custom-model')?.definition.id).toBe('custom-model');
    });

    it('坏文件 → 保留上一次好目录并带 error；文件删失同理', () => {
      expect(reloadLlmProvidersIfChanged().reloaded).toBe(true);
      writeTempConfig('{broken');
      const bad = reloadLlmProvidersIfChanged();
      expect(bad.reloaded).toBe(false);
      expect(bad.error).toBeTruthy();
      expect(MODEL_MAP.has('custom-model')).toBe(true); // 上一次好目录仍在
      fs.rmSync(tempConfig);
      const gone = reloadLlmProvidersIfChanged();
      expect(gone.reloaded).toBe(false);
      expect(gone.error).toMatch(/不可读/);
      expect(MODEL_MAP.has('custom-model')).toBe(true);
    });
  });
});
