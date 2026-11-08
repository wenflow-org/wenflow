/**
 * 学员端「API 接入」流程对齐管理台（2026-11-08 走查）
 *
 * 管理台（admin-redesign/ApiConfig.vue）在 11-05~11-07 三轮走查里定下的三条口径，
 * 学员端 /user/settings 的 API 接入区此前都还是旧流程：
 *   ① 「获取模型」只拉列表不落盘，要再点一次「保存配置」——管理台判例「用户流程是
 *      填地址和 key → 获取模型，不该再要求点一次保存」（获取即保存）；
 *   ② 「保存配置」永远可点——管理台判例「脏了才出现，用户看不出这颗按钮存在」，
 *      改为常驻、无未保存改动时禁用 + title 说明；
 *   ③ 内置模式收起态只有一句「无需填写端点或密钥」，已保存的端点/密钥状态不显示，
 *      读成「之前配的全丢了」——补一段已保存事实摘要。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { getUserApiConfigMock, getUserMcpConfigMock } = vi.hoisted(() => ({
  getUserApiConfigMock: vi.fn(async () => ({ data: { enabled: false } })),
  getUserMcpConfigMock: vi.fn(async () => ({ data: { tools: [] } }))
}));

vi.mock('@/api/userCustom', () => ({
  getUserApiConfig: getUserApiConfigMock,
  updateUserApiConfig: vi.fn(async () => ({ data: {} })),
  disableUserApiConfig: vi.fn(async () => ({ data: {} })),
  testApiConnection: vi.fn(async () => ({ data: {} })),
  fetchApiModels: vi.fn(async () => ({ data: { models: [] } })),
  getUserMcpConfig: getUserMcpConfigMock,
  updateUserMcpConfig: vi.fn(async () => ({ data: {} })),
  executeMcpTool: vi.fn(async () => ({ data: {} }))
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/user/CapabilityShell.vue', () => ({ default: { template: '<div class="stub-shell"><slot /></div>' } }));

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../Settings.vue'), 'utf8').replace(/\r\n/g, '\n');

describe('API 接入流程对齐管理台', () => {
  it('获取即保存：loadModels 成功后直接落盘，不要求再点一次保存', () => {
    expect(source).toMatch(/const saved = await saveApiConfig\(\{ silent: true \}\)/);
    expect(source).toMatch(/已保存配置，获取到 \$\{models\.length\} 个可用模型/);
  });

  it('保存常驻 + 脏检查：无未保存改动时禁用并给 title 说明', () => {
    expect(source).toContain(':disabled="busy || !formDirty"');
    expect(source).toContain("'没有未保存的改动'");
    /* 脏检查的判定域：端点/两个模型选择/新填的 Key（留空沿用不算改动） */
    expect(source).toMatch(/apiConfig\.endpoint !== savedSnapshot\.value\.endpoint/);
    expect(source).toMatch(/!!apiConfig\.apiKey\.trim\(\)/);
  });

  it('保存成功后刷新快照（否则保存按钮永远亮着）', () => {
    expect(source).toMatch(/snapshotSaved\(\);\n    return true;/);
    expect(source).toMatch(/snapshotSaved\(\);\n  } catch \{/);
  });

  it('内置模式收起态带已保存端点/密钥摘要（不再读成「配过的全丢了」）', () => {
    expect(source).toContain('已保存端点');
    expect(source).toContain("hasSavedApiKey ? '密钥已配置' : '未配置密钥'");
  });
});

describe('模型接入 / MCP 学员侧隐藏（2026-11-08 产品裁决）', () => {
  beforeEach(() => {
    getUserApiConfigMock.mockClear();
    getUserMcpConfigMock.mockClear();
  });

  async function mountSettings() {
    const { default: Settings } = await import('../Settings.vue');
    const w = mount(Settings);
    await flushPromises();
    return w;
  }

  it('默认隐藏：状态开关 / API 接入 / MCP 三块都不渲染，只留密码与注销', async () => {
    const w = await mountSettings();
    expect(w.find('.settings-status').exists()).toBe(false);
    /* 密码/注销区也用 .settings-cols（--security 档），要排除 */
    expect(w.find('.settings-cols:not(.settings-cols--security)').exists()).toBe(false);
    expect(w.text()).not.toContain('我的 MCP 工具');
    expect(w.text()).toContain('修改密码');
    expect(w.text()).toContain('注销账号');
    w.unmount();
  });

  it('隐藏期间不发起 api-config / mcp 配置请求', async () => {
    const w = await mountSettings();
    expect(getUserApiConfigMock).not.toHaveBeenCalled();
    expect(getUserMcpConfigMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('模板三块挂了开关 v-if，开关收在可 mock 的 settings-features', () => {
    expect(source).toContain("import { SHOW_CUSTOM_MODEL_API, SHOW_MCP_TOOLS } from './settings-features'");
    expect(source).toContain('v-if="SHOW_CUSTOM_MODEL_API"');
    expect(source).toMatch(/<article v-if="SHOW_MCP_TOOLS" class="uc-card">/);
    expect(source).toMatch(/if \(SHOW_CUSTOM_MODEL_API\) jobs\.push\(loadApiConfig\(\)\)/);
    expect(source).toMatch(/if \(SHOW_MCP_TOOLS\) jobs\.push\(loadMcpConfig\(\)\)/);
  });
});
