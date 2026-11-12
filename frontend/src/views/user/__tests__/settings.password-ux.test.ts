/**
 * 设置页 · 修改密码与注销（2026-11-11 走查）
 *
 * ① 三个密码框校验失败只弹 toast：「哪个框错了」在提示消失后就丢了，焦点也不跟过去。
 *    改为字段下就地报错 + 自动聚焦到出错字段，Enter 可提交，提交中按钮锁住防重复。
 * ② 密码没有可见切换；浏览器密码管理器也认不出当前/新密码（缺 autocomplete）。
 * ③ 注销按钮在密码为空时也能点，点完才报错；危险卡与左侧安全表单视觉上几乎同权。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/utils/api', () => ({ default: { post: (...args: unknown[]) => post(...args), get: vi.fn() } }));
const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));
vi.mock('@/utils/toast', () => ({ toast }));
vi.mock('@/api/userCustom', () => ({
  getUserApiConfig: vi.fn(async () => ({ data: {} })),
  updateUserApiConfig: vi.fn(async () => ({ data: {} })),
  disableUserApiConfig: vi.fn(async () => ({ data: {} })),
  testApiConnection: vi.fn(async () => ({ data: {} })),
  fetchApiModels: vi.fn(async () => ({ data: { models: [] } })),
  getUserMcpConfig: vi.fn(async () => ({ data: { tools: [] } })),
  updateUserMcpConfig: vi.fn(async () => ({ data: {} })),
  executeMcpTool: vi.fn(async () => ({ data: {} }))
}));
vi.mock('@/components/user/CapabilityShell.vue', () => ({ default: { template: '<div><slot /></div>' } }));

import Settings from '../Settings.vue';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../Settings.vue'), 'utf8');
const template = source.slice(0, source.indexOf('<script'));

async function mountSettings() {
  // 焦点断言要求节点真的在 document 里（默认 mount 是游离节点）
  const w = mount(Settings, { attachTo: document.body });
  await flushPromises();
  return w;
}

function pwdInputs(w: Awaited<ReturnType<typeof mountSettings>>) {
  return w.findAll<HTMLInputElement>('.pwd-grid input');
}

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ data: {} });
});

describe('设置页：修改密码', () => {
  it('进入页面聚焦当前密码（键盘用户不用先穿过顶部导航）', async () => {
    const w = await mountSettings();
    expect(document.activeElement).toBe(pwdInputs(w)[0].element);
    w.unmount();
  });

  it('密码框带 autocomplete，密码管理器能区分当前/新密码', () => {
    expect(template).toContain('autocomplete="current-password"');
    expect(template.match(/autocomplete="new-password"/g)!.length).toBe(2);
  });

  it('每个密码框都能切换可见性，且切换不改变值与校验状态', async () => {
    const w = await mountSettings();
    const inputs = pwdInputs(w);
    await inputs[1].setValue('abcd1234');
    expect(inputs[1].attributes('type')).toBe('password');

    await w.findAll('.pwd-grid .uc-field__eye')[1].trigger('click');
    expect(inputs[1].attributes('type')).toBe('text');
    expect((inputs[1].element as HTMLInputElement).value).toBe('abcd1234');
    w.unmount();
  });

  it('新密码过短：错误贴在字段下、焦点回到新密码，不发请求', async () => {
    const w = await mountSettings();
    const inputs = pwdInputs(w);
    await inputs[0].setValue('oldpass');
    await inputs[1].setValue('short');
    await inputs[2].setValue('short');
    await inputs[0].trigger('keyup.enter');
    await flushPromises();

    expect(w.text()).toContain('新密码至少 8 位');
    expect(document.activeElement).toBe(inputs[1].element);
    expect(post).not.toHaveBeenCalled();
    w.unmount();
  });

  it('字母数字不齐：说明缺什么，不发请求', async () => {
    const w = await mountSettings();
    const inputs = pwdInputs(w);
    await inputs[0].setValue('oldpass');
    await inputs[1].setValue('abcdefgh');
    await inputs[2].setValue('abcdefgh');
    await inputs[0].trigger('keyup.enter');
    await flushPromises();

    expect(w.text()).toContain('新密码需同时包含字母和数字');
    expect(post).not.toHaveBeenCalled();
    w.unmount();
  });

  it('两次新密码不一致：错误落在确认框并聚焦它', async () => {
    const w = await mountSettings();
    const inputs = pwdInputs(w);
    await inputs[0].setValue('oldpass');
    await inputs[1].setValue('abcd1234');
    await inputs[2].setValue('abcd12345');
    await inputs[0].trigger('keyup.enter');
    await flushPromises();

    expect(w.text()).toContain('两次输入的新密码不一致');
    expect(document.activeElement).toBe(inputs[2].element);
    expect(post).not.toHaveBeenCalled();
    w.unmount();
  });

  it('校验通过后提交，提交中不重复发请求', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    post.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
    const w = await mountSettings();
    const inputs = pwdInputs(w);
    await inputs[0].setValue('oldpass');
    await inputs[1].setValue('abcd1234');
    await inputs[2].setValue('abcd1234');

    const submit = w.findAll('button').find((b) => b.text().includes('更新密码'))!;
    await submit.trigger('click');
    await submit.trigger('click');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/change-password', {
      oldPassword: 'oldpass',
      newPassword: 'abcd1234'
    });

    resolvePost({ data: {} });
    await flushPromises();
    expect(toast.success).toHaveBeenCalled();
    w.unmount();
  });

  it('服务端拒绝时错误留在卡内可见（不是一闪而过的 toast）', async () => {
    post.mockRejectedValue({ response: { data: { error: { message: '当前密码不正确' } } } });
    const w = await mountSettings();
    const inputs = pwdInputs(w);
    await inputs[0].setValue('wrong');
    await inputs[1].setValue('abcd1234');
    await inputs[2].setValue('abcd1234');
    await w.findAll('button').find((b) => b.text().includes('更新密码'))!.trigger('click');
    await flushPromises();

    expect(w.text()).toContain('当前密码不正确');
    w.unmount();
  });
});

describe('设置页：注销危险区', () => {
  it('密码为空时注销按钮不可点，输入后才可用', async () => {
    const w = await mountSettings();
    const dangerButton = w.findAll('button').find((b) => b.text().includes('注销账号'))!;
    expect(dangerButton.attributes('disabled')).toBeDefined();

    const dangerInput = w.find('input[aria-label="当前密码（确认注销）"]');
    await dangerInput.setValue('oldpass');
    expect(dangerButton.attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('危险卡有「不可撤销」标记与独立底色，不与左侧安全表单同权', () => {
    expect(template).toContain('class="danger-tag">不可撤销');
    expect(source).toMatch(/\.uc-card--danger \{[^}]*background:\s*color-mix/);
    expect(source).toMatch(/\.uc-card--danger \.uc-card__head h3 \{[^}]*color:\s*var\(--red-ink\)/);
  });

  it('账号安全分区有可见标题', () => {
    expect(template).toContain('class="settings-sec__title">账号安全');
  });
});
