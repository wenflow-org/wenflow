/* eslint-disable @typescript-eslint/no-explicit-any -- 测试桩：system.db mock 的 upsert 入参与读回文件无类型导出（对齐 auth.middleware 先例） */
/**
 * 模型供应商注册表写服务（管理台 BYOK 编辑器后端）：
 * 写前三道闸（结构校验 / defaults 自洽 / 备份）、原子写与热重载、$header 保真、
 * 只读降级、密钥不落文件、以及各增删改的拒绝面（重复 id、默认模型引用、改名等）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mockSecretRows = new Map<string, { providerId: string; apiKey: string; apiKeyEnv: string | null }>();

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    provider_secrets: {
      findUnique: async ({ where }: { where: { providerId: string } }) => mockSecretRows.get(where.providerId) ?? null,
      findMany: async () => [...mockSecretRows.values()],
      upsert: async ({ where, create, update }: { where: { providerId: string }; create: any; update: any }) => {
        const prev = mockSecretRows.get(where.providerId);
        mockSecretRows.set(where.providerId, {
          providerId: where.providerId,
          apiKey: update.apiKey ?? create.apiKey,
          apiKeyEnv: update.apiKeyEnv ?? create.apiKeyEnv ?? prev?.apiKeyEnv ?? null
        });
      },
      deleteMany: async ({ where }: { where: { providerId: string } }) => {
        mockSecretRows.delete(where.providerId);
      }
    }
  }
}));

jest.mock('../../../utils/secret-crypto', () => ({
  __esModule: true,
  encryptSecret: (value: string) => `wfsec:v1:test:${Buffer.from(value, 'utf-8').toString('base64')}`,
  decryptSecret: (value: string) =>
    value.startsWith('wfsec:v1:test:') ? Buffer.from(value.slice('wfsec:v1:test:'.length), 'base64').toString('utf-8') : null
}));

import {
  PLATFORM_PROVIDER_ID,
  RegistryEditError,
  addModel,
  buildProvidersView,
  clearProviderKey,
  createProvider,
  deleteModel,
  deleteProvider,
  updateModel,
  updateProvider
} from '../model-providers.service';
import * as modelsConfig from '../../../config/models.config';
import { invalidateProviderSecretCache, resolveProviderApiKey } from '../../provider-secrets.service';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-providers-test-'));
const tempConfig = path.join(tmpDir, 'llm-providers.json');

const HEADER = '供应商注册表（测试夹具）';

const FIXTURE = {
  $header: HEADER,
  $rules: ['规则一'],
  providers: {
    platform: {
      name: '平台',
      recommended: true,
      models: {
        'm-chat': { label: 'M Chat', tier: 'chat' },
        'm-extra': { label: 'M Extra', tier: 'chat' },
        'm-reason': { label: 'M Reason', tier: 'reasoning', supportsThinking: true }
      }
    },
    custom: {
      name: '自建通道',
      enabled: true,
      baseUrl: 'https://api.example.com/v1',
      apiKeyEnv: 'CUSTOM_KEY',
      models: {}
    }
  },
  aliases: { chat: ['m-chat', 'm-extra'] },
  defaults: { chat: 'm-chat', reasoning: 'm-reason' }
};

function writeFixture(): void {
  fs.writeFileSync(tempConfig, `${JSON.stringify(FIXTURE, null, 2)}\n`, 'utf-8');
}

/**
 * 写服务的规范输出（与 collapseShortArrays + 换行沿袭同规则）。
 * 单测里直接复刻一遍，是为了把「编辑一轮后文件逐字节不变」钉成回归断言——
 * 那是 git diff 卫生与运维改文件时的可预期性（格式被悄悄重排会淹没真实改动）。
 */
function canonical(value: unknown, eol: '\n' | '\r\n'): string {
  const collapsed = JSON.stringify(value, null, 2).replace(/\[[^[\]{}]*\]/g, (match) => {
    const flat = match.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/\[ /, '[').replace(/ \]/, ']');
    return flat.length <= 120 ? flat : match;
  });
  const text = `${collapsed}\n`;
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

function readFile(): any {
  return JSON.parse(fs.readFileSync(tempConfig, 'utf-8'));
}

function providerIds(): string[] {
  return Object.keys(readFile().providers);
}

async function expectEditError(run: () => Promise<unknown>, status: number, fragment: string): Promise<RegistryEditError> {
  try {
    await run();
  } catch (e) {
    expect(e).toBeInstanceOf(RegistryEditError);
    const error = e as RegistryEditError;
    expect(error.status).toBe(status);
    expect(error.message).toContain(fragment);
    return error;
  }
  throw new Error(`期望抛 RegistryEditError（${fragment}），但调用成功了`);
}

beforeAll(() => {
  process.env.LLM_PROVIDERS_CONFIG = tempConfig;
});

beforeEach(() => {
  writeFixture();
  mockSecretRows.clear();
  invalidateProviderSecretCache();
  delete process.env.CUSTOM_KEY;
  // 让模块内的注册表状态对准夹具（每次编辑后都会强制重载，这里只是起点）
  modelsConfig.reloadLlmProvidersIfChanged(true);
});

afterAll(() => {
  delete process.env.LLM_PROVIDERS_CONFIG;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildProvidersView', () => {
  it('回吐注册表原始条目 + 密钥摘要 + 文件可写状态', async () => {
    mockSecretRows.set('custom', { providerId: 'custom', apiKey: 'wfsec:v1:test:YWJjZGVmZ2hpams=', apiKeyEnv: 'CUSTOM_KEY' });
    invalidateProviderSecretCache();
    const view = await buildProvidersView();
    const custom = view.providers.find((p) => p.id === 'custom')!;
    expect(custom.status).toBe('ready');
    expect(custom.keySource).toBe('db');
    // 只回吐尾 4 位（sk-abcdefghijk 的尾巴）
    expect(custom.keyHint).toBe('····hijk');
    expect(view.providers.find((p) => p.id === PLATFORM_PROVIDER_ID)!.status).toBe('inherit');
    expect(view.registry.path).toBe(tempConfig);
    expect(view.registry.readOnly).toBe(false);
  });
});

describe('供应商', () => {
  it('新建供应商：写入文件 + 生成备份 + 默认 apiKeyEnv', async () => {
    const result = await createProvider({ id: 'acme-gw', name: 'Acme 网关', baseUrl: 'https://gw.acme.com/v1/', apiKey: 'sk-acme-123456' });
    expect(result.id).toBe('acme-gw');
    const entry = readFile().providers['acme-gw'];
    expect(entry).toMatchObject({ name: 'Acme 网关', enabled: true, baseUrl: 'https://gw.acme.com/v1', apiKeyEnv: 'PROVIDER_ACME_GW_API_KEY', models: {} });
    // 密钥只进 DB（密文），一个字都不落文件
    expect(mockSecretRows.get('acme-gw')!.apiKey).toBe('wfsec:v1:test:c2stYWNtZS0xMjM0NTY=');
    expect(fs.readFileSync(tempConfig, 'utf-8')).not.toContain('sk-acme-123456');
    const backups = fs.readdirSync(path.join(tmpDir, 'backups'));
    expect(backups).toHaveLength(1);
    // $header / $rules 原样保留
    expect(readFile().$header).toBe(HEADER);
    expect(readFile().$rules).toEqual(['规则一']);
  });

  it('新建供应商的拒绝面：id 非法 / 保留 id / 重复 / 缺地址', async () => {
    await expectEditError(() => createProvider({ id: 'Bad Id', baseUrl: 'https://a.com/v1' }), 400, '只能用小写字母');
    await expectEditError(() => createProvider({ id: PLATFORM_PROVIDER_ID, baseUrl: 'https://a.com/v1' }), 400, '保留 ID');
    await expectEditError(() => createProvider({ id: 'custom', baseUrl: 'https://a.com/v1' }), 409, '已存在');
    await expectEditError(() => createProvider({ id: 'nourl' }), 400, '必须填服务地址');
    await expectEditError(() => createProvider({ id: 'nourl', baseUrl: 'ftp://a.com' }), 400, 'http:// 或 https://');
  });

  it('停用平台通道而没别的启用供应商供模型：被挡（不然全平台无路可走）', async () => {
    await expectEditError(() => updateProvider(PLATFORM_PROVIDER_ID, { enabled: false }), 400, '没有任何 enabled 的 provider 提供模型');
    expect(readFile().providers.platform.enabled).toBeUndefined();
  });

  it('更新供应商：改名/说明/地址与密钥环境变量', async () => {
    await updateProvider('custom', { name: '自建通道 A', description: '团队自建', baseUrl: 'https://new.example.com/v1', apiKey: 'sk-new-key-999999' });
    const entry = readFile().providers.custom;
    expect(entry).toMatchObject({ name: '自建通道 A', description: '团队自建', baseUrl: 'https://new.example.com/v1', apiKeyEnv: 'CUSTOM_KEY' });
    expect(mockSecretRows.get('custom')!.apiKeyEnv).toBe('CUSTOM_KEY');
  });

  it('平台通道：拒绝清空地址（要停用请用启用开关）', async () => {
    // 平台通道没有 baseUrl，走的是 api-config；这里用自定义供应商验证「清空地址」这一条
    await expectEditError(() => updateProvider('custom', { baseUrl: '' }), 400, '服务地址不能清空');
  });

  it('删除：平台通道被拒；自建供应商连密钥一起清（并告警备用链残留）', async () => {
    await addModel('custom', { id: 'cm-1', tier: 'chat' });
    await addModel(PLATFORM_PROVIDER_ID, { id: 'm-chat-2', tier: 'chat', fallbacks: ['cm-1'] });
    mockSecretRows.set('custom', { providerId: 'custom', apiKey: 'wfsec:v1:test:eA==', apiKeyEnv: 'CUSTOM_KEY' });
    await expectEditError(() => deleteProvider(PLATFORM_PROVIDER_ID), 400, '不能删除');
    const result = await deleteProvider('custom');
    expect(providerIds()).toEqual([PLATFORM_PROVIDER_ID]);
    expect(mockSecretRows.has('custom')).toBe(false);
    expect(result.warnings.join(' ')).toContain('备用链');
  });

  it('移除密钥：DB 行删掉，文件里的环境变量名保留', async () => {
    mockSecretRows.set('custom', { providerId: 'custom', apiKey: 'wfsec:v1:test:eA==', apiKeyEnv: 'CUSTOM_KEY' });
    await clearProviderKey('custom');
    expect(mockSecretRows.has('custom')).toBe(false);
    expect(readFile().providers.custom.apiKeyEnv).toBe('CUSTOM_KEY');
  });
});

describe('模型', () => {
  it('新增模型：写入规范字段顺序 + 跨供应商备用链告警 + 超出运行时跳数告警', async () => {
    await addModel('custom', { id: 'cm-1', tier: 'chat' });
    const result = await addModel(PLATFORM_PROVIDER_ID, {
      id: 'm-new',
      label: 'M New',
      tier: 'reasoning',
      supportsThinking: true,
      supportsReasoningEffort: true,
      maxOutputTokens: 131072,
      fallbacks: ['m-chat', 'custom/cm-1', 'm-reason']
    });
    const entry = readFile().providers.platform.models['m-new'];
    expect(Object.keys(entry)).toEqual([
      'label', 'tier', 'supportsThinking', 'supportsReasoningEffort', 'maxOutputTokens', 'fallbacks'
    ]);
    expect(entry.fallbacks).toEqual(['m-chat', 'custom/cm-1', 'm-reason']);
    expect(result.warnings.join(' ')).toContain('运行时最多用到第 1 条');
    expect(result.warnings.join(' ')).toContain('属于别的供应商');
  });

  it('新增模型的拒绝面：重复 id / id 非法 / 备用链指向不存在的模型 / 勾强度没勾思考', async () => {
    await addModel('custom', { id: 'cm-1', tier: 'chat' });
    await expectEditError(() => addModel('custom', { id: 'cm-1', tier: 'chat' }), 409, '已有模型');
    await expectEditError(() => addModel('custom', { id: 'cm/1', tier: 'chat' }), 400, '只能用字母');
    await expectEditError(() => addModel('custom', { id: 'cm-2', tier: 'chat', fallbacks: ['ghost'] }), 400, '不在任何供应商目录中');
    await expectEditError(() => addModel('custom', { id: 'cm-3', tier: 'chat', supportsReasoningEffort: true }), 400, '必须同时支持思考模式');
  });

  it('图片理解是独立能力：随模型写入、改回 false 也落盘，视图按布尔回读', async () => {
    await addModel('custom', { id: 'cm-vision', label: 'CM Vision', tier: 'chat', vision: true });
    expect(readFile().providers.custom.models['cm-vision'].vision).toBe(true);
    // 字段顺序按 MODEL_KEY_ORDER：vision 紧跟能力开关，排在限额之前
    expect(Object.keys(readFile().providers.custom.models['cm-vision'])).toEqual(['label', 'tier', 'vision']);

    await updateModel('custom', 'cm-vision', { vision: false });
    expect(readFile().providers.custom.models['cm-vision'].vision).toBe(false);

    const view = await buildProvidersView();
    const model = view.providers.find((p) => p.id === 'custom')!.models.find((m) => m.id === 'cm-vision')!;
    expect(model.vision).toBe(false);
    expect(view.providers.find((p) => p.id === PLATFORM_PROVIDER_ID)!.models.every((m) => m.vision === false)).toBe(true);
  });

  it('模型级生成参数：写入、视图回读、default/清空即删除', async () => {
    await addModel('custom', {
      id: 'cm-gen',
      label: 'CM Gen',
      tier: 'chat',
      defaultThinkingMode: 'disabled',
      defaultReasoningEffort: 'max',
      defaultResponseFormat: 'json_object'
    });
    const entry = readFile().providers.custom.models['cm-gen'];
    expect(Object.keys(entry)).toEqual(['label', 'tier', 'defaultThinkingMode', 'defaultReasoningEffort', 'defaultResponseFormat']);
    expect(entry.defaultThinkingMode).toBe('disabled');

    let view = await buildProvidersView();
    let model = view.providers.find((p) => p.id === 'custom')!.models.find((m) => m.id === 'cm-gen')!;
    expect(model.defaultThinkingMode).toBe('disabled');
    expect(model.defaultReasoningEffort).toBe('max');
    expect(model.defaultResponseFormat).toBe('json_object');

    // 选「跟随平台默认」/ 清空 → 从文件删掉，视图回到 null
    await updateModel('custom', 'cm-gen', {
      defaultThinkingMode: 'default',
      defaultReasoningEffort: null,
      defaultResponseFormat: 'default'
    });
    const after = readFile().providers.custom.models['cm-gen'];
    expect(after.defaultThinkingMode).toBeUndefined();
    expect(after.defaultReasoningEffort).toBeUndefined();
    expect(after.defaultResponseFormat).toBeUndefined();
    view = await buildProvidersView();
    model = view.providers.find((p) => p.id === 'custom')!.models.find((m) => m.id === 'cm-gen')!;
    expect(model.defaultThinkingMode).toBeNull();
    expect(model.defaultReasoningEffort).toBeNull();
    expect(model.defaultResponseFormat).toBeNull();

    // 非法枚举被拒
    await expectEditError(
      () => updateModel('custom', 'cm-gen', { defaultThinkingMode: 'on' }),
      400,
      '思考模式只能是'
    );
  });

  it('改模型：不允许改名、不允许档位乱填、限额必须正数', async () => {
    await addModel('custom', { id: 'cm-1', tier: 'chat' });
    await expectEditError(() => updateModel('custom', 'cm-1', { id: 'cm-2' }), 400, '不支持改名');
    await expectEditError(() => updateModel('custom', 'cm-1', { tier: 'pro' }), 400, '只能是 chat 或 reasoning');
    await expectEditError(() => updateModel('custom', 'cm-1', { maxOutputTokens: 0 }), 400, '必须是正数');
    await expectEditError(() => updateModel('custom', 'cm-9', { label: 'x' }), 404, '没有模型');
  });

  it('改模型：未提供的字段保持原值，清空的字段从文件里消失', async () => {
    await addModel('custom', { id: 'cm-1', tier: 'chat', label: 'CM', defaultMaxTokens: 4096 });
    await updateModel('custom', 'cm-1', { maxOutputTokens: 65536 });
    expect(readFile().providers.custom.models['cm-1']).toMatchObject({ label: 'CM', defaultMaxTokens: 4096, maxOutputTokens: 65536 });
    await updateModel('custom', 'cm-1', { defaultMaxTokens: null });
    expect(readFile().providers.custom.models['cm-1'].defaultMaxTokens).toBeUndefined();
  });

  it('删模型：被默认模型引用时被挡；否则删掉并告警别名残留', async () => {
    await expectEditError(() => deleteModel(PLATFORM_PROVIDER_ID, 'm-chat'), 400, '正被默认对话模型引用');
    await expectEditError(() => deleteModel(PLATFORM_PROVIDER_ID, 'm-reason'), 400, '正被默认推理模型引用');
    const result = await deleteModel(PLATFORM_PROVIDER_ID, 'm-extra');
    expect(readFile().providers.platform.models['m-extra']).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('别名「chat」');
  });
});

describe('写回的文件格式（git diff 卫生 + 换行风格沿袭）', () => {
  it('增删一轮后与写前逐字节相同（含 CRLF 风格与短数组单行）', async () => {
    // 夹具按写服务的规范格式落盘（CRLF + 短数组单行），模拟「这次检出里的真文件」
    fs.writeFileSync(tempConfig, canonical(FIXTURE, '\r\n'), 'utf-8');
    const before = fs.readFileSync(tempConfig, 'utf-8');
    expect(before).toContain('\r\n');
    expect(before).toContain('"aliases"');

    await createProvider({ id: 'tmp-gw', name: '临时网关', baseUrl: 'https://tmp.example.com/v1', apiKey: 'sk-tmp-123456' });
    await addModel('tmp-gw', { id: 'tmp-model', tier: 'chat', fallbacks: ['m-chat'] });
    await updateModel('tmp-gw', 'tmp-model', { label: '临时模型' });
    await deleteProvider('tmp-gw');

    expect(fs.readFileSync(tempConfig, 'utf-8')).toBe(before);
  });

  it('短数组收成一行（不制造满屏无关 diff），长数组保持多行', () => {
    const text = canonical({ a: ['x'], b: ['y'.repeat(140)] }, '\n');
    expect(text).toContain('"a": ["x"]');
    expect(text).toContain('"b": [\n');
  });
});

describe('写前闸与降级', () => {
  it('别名指向已不在目录里的模型：保存成功但给出告警', async () => {
    await deleteModel(PLATFORM_PROVIDER_ID, 'm-extra');
    const result = await updateProvider(PLATFORM_PROVIDER_ID, { description: '改一下说明' });
    expect(result.warnings.join(' ')).toContain('别名');
  });

  it('文件不可读（被挪走）时拒绝编辑，不凭空长配置', async () => {
    fs.rmSync(tempConfig);
    await expectEditError(() => updateProvider(PLATFORM_PROVIDER_ID, { name: 'x' }), 409, '读不到注册表文件');
    writeFixture();
  });

  it('目录只读时给出人话并保持文件不变', async () => {
    const before = fs.readFileSync(tempConfig, 'utf-8');
    const accessSpy = jest.spyOn(fs, 'accessSync').mockImplementation(() => {
      const e = new Error('EACCES') as NodeJS.ErrnoException;
      e.code = 'EACCES';
      throw e;
    });
    await expectEditError(() => updateProvider(PLATFORM_PROVIDER_ID, { name: 'x' }), 409, '不可写');
    accessSpy.mockRestore();
    expect(fs.readFileSync(tempConfig, 'utf-8')).toBe(before);
    const view = await buildProvidersView();
    expect(view.registry.readOnly).toBe(false);
  });

  it('写后热重载失败：回滚到写前内容并如实报错', async () => {
    const before = fs.readFileSync(tempConfig, 'utf-8');
    const reloadSpy = jest.spyOn(modelsConfig, 'reloadLlmProvidersIfChanged').mockReturnValue({ reloaded: false, error: '模拟的热重载失败' });
    await expectEditError(() => updateProvider(PLATFORM_PROVIDER_ID, { name: 'x' }), 400, '已回滚到写前内容');
    reloadSpy.mockRestore();
    expect(fs.readFileSync(tempConfig, 'utf-8')).toBe(before);
  });
});

describe('运行时密钥解析（DB 密文 → 环境变量回落）', () => {
  it('DB 有密文时优先于环境变量；清掉 DB 行后回落环境变量；两处都没有返回 null', async () => {
    process.env.CUSTOM_KEY = 'env-key-abcdefgh';
    await expect(resolveProviderApiKey('custom', 'CUSTOM_KEY')).resolves.toEqual({ apiKey: 'env-key-abcdefgh', source: 'env' });
    await updateProvider('custom', { apiKey: 'db-key-12345678' });
    await expect(resolveProviderApiKey('custom', 'CUSTOM_KEY')).resolves.toEqual({ apiKey: 'db-key-12345678', source: 'db' });
    await clearProviderKey('custom');
    await expect(resolveProviderApiKey('custom', 'CUSTOM_KEY')).resolves.toEqual({ apiKey: 'env-key-abcdefgh', source: 'env' });
    delete process.env.CUSTOM_KEY;
    // 进程内 60s 缓存：环境变量在真实部署里靠重启改，测试里显式失效
    invalidateProviderSecretCache();
    await expect(resolveProviderApiKey('custom', 'CUSTOM_KEY')).resolves.toBeNull();
  });
});
