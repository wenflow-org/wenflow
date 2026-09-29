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

/** 写入次数：保证每次写入的 mtime 严格单调递增（见下） */
let mtimeSeq = 0

function writeTempConfig(content: string): void {
  fs.writeFileSync(tempConfig, content, 'utf-8')
  /* 变更检测（reloadLlmProvidersIfChanged）只比 mtimeMs，同一毫秒内的两次写入会被正当地
     判成「未变」——所以测试得手动把 mtime 拨开。原来用的是固定 `st.mtimeMs + 5`：
     拨出来的值只领先真实时钟 5ms，**后续某次真实写入恰好落在那一毫秒就撞上**，测试随机变红
     （2026-09-29 CI 实测红过一次：`expect(reloaded).toBe(true)` 收到 false，本地 NTFS 不复现）。
     改为按写入序号单调前推（每次多 1 分钟，永远领先任何真实时钟），彻底消除这个窗口。 */
  mtimeSeq += 1
  fs.utimesSync(tempConfig, new Date(), new Date(Date.now() + mtimeSeq * 60_000))
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
    // 跨 provider 重名合法（同一模型多通道服务是常态）：解析不抛，运行时裸 id first-wins
    const dup = parseLlmProvidersConfig(JSON.stringify({
      providers: {
        a: { models: { 'same-id': { tier: 'chat' } } },
        b: { models: { 'same-id': { tier: 'chat' } } }
      }
    }));
    expect(dup.models).toHaveLength(2);
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

    it('多通道重名：裸 id first-wins，限定式仍可精确指到后续通道', () => {
      writeTempConfig(JSON.stringify({
        providers: {
          first: { name: '先声明', models: { 'shared-model': { label: 'S1', tier: 'chat', defaultMaxTokens: 32768 } } },
          second: { name: '后声明', baseUrl: 'http://second.local/v1', apiKeyEnv: 'UT_SECOND_KEY', models: { 'shared-model': { label: 'S2', tier: 'chat', defaultMaxTokens: 32768 } } }
        },
        aliases: {},
        defaults: { chat: 'shared-model', reasoning: 'shared-model' }
      }));
      expect(reloadLlmProvidersIfChanged().reloaded).toBe(true);
      expect(MODEL_MAP.get('shared-model')?.providerId).toBe('first'); // 裸 id 归声明在前的通道
      const viaQualified = resolveModelRef('second/shared-model');
      expect(viaQualified?.providerId).toBe('second');
      expect(viaQualified?.definition.providerEndpoint?.baseUrl).toBe('http://second.local/v1');
      expect(MODEL_MAP.size).toBe(1); // 扁平注册表去重，不重复收录
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
