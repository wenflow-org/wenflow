/**
 * #97 安全项回归：投影凭据（projection token / context）的本地存放
 *
 * - 只落 sessionStorage：随标签页会话销毁，不再跨页签/跨重启长期残留；
 * - localStorage 里同名旧键（老实现的残留）在任意入口被动清除，且不做迁移；
 * - 「管理端签发 → window.open 新页签以用户身份浏览」依赖浏览器把 opener 的
 *   sessionStorage 复制给新页签，本测试锁定的是写入位置契约（该复制行为在浏览器侧）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProjectionToken,
  getProjectionContext,
  getProjectionToken,
  isProjectionMode,
  setProjectionToken
} from '../projection';

const TOKEN_KEY = 'projection_token';
const CONTEXT_KEY = 'projection_context';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('投影凭据存放位置（sessionStorage）', () => {
  it('写入 token + context 只落 sessionStorage，localStorage 保持干净', () => {
    setProjectionToken('pt_1', { userId: 'u_1', scope: 'dashboard' });

    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('pt_1');
    expect(JSON.parse(sessionStorage.getItem(CONTEXT_KEY) || '{}')).toEqual({
      userId: 'u_1',
      scope: 'dashboard'
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
  });

  it('读取：token 与 context 从 sessionStorage 取回', () => {
    expect(getProjectionToken()).toBeNull();
    expect(getProjectionContext()).toBeNull();

    setProjectionToken('pt_2', { profileId: 'vl_9', source: 'virtual-profile-story' });

    expect(getProjectionToken()).toBe('pt_2');
    expect(getProjectionContext()).toEqual({ profileId: 'vl_9', source: 'virtual-profile-story' });
    expect(isProjectionMode()).toBe(true);
  });

  it('无 context 时只写 token 键', () => {
    setProjectionToken('pt_3');

    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('pt_3');
    expect(sessionStorage.getItem(CONTEXT_KEY)).toBeNull();
    expect(isProjectionMode()).toBe(true);
  });

  it('清理：token + context 双双移除，投影模式随之关闭', () => {
    setProjectionToken('pt_4', { userId: 'u_4' });
    clearProjectionToken();

    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(CONTEXT_KEY)).toBeNull();
    expect(getProjectionToken()).toBeNull();
    expect(getProjectionContext()).toBeNull();
    expect(isProjectionMode()).toBe(false);
  });

  it('旧版 localStorage 残留被动清除（不迁移进 sessionStorage）', () => {
    localStorage.setItem(TOKEN_KEY, 'legacy_pt');
    localStorage.setItem(CONTEXT_KEY, JSON.stringify({ userId: 'legacy_u' }));

    expect(getProjectionToken()).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('写入/清理入口同样清掉旧版 localStorage 残留', () => {
    localStorage.setItem(TOKEN_KEY, 'legacy_pt');
    localStorage.setItem(CONTEXT_KEY, '{"userId":"legacy_u"}');
    setProjectionToken('pt_5', { userId: 'u_5' });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();

    localStorage.setItem(TOKEN_KEY, 'legacy_pt_2');
    localStorage.setItem(CONTEXT_KEY, '{"userId":"legacy_u2"}');
    clearProjectionToken();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
  });

  it('context 非法 JSON 时返回 null 而不抛', () => {
    sessionStorage.setItem(CONTEXT_KEY, '{not-json');

    expect(getProjectionContext()).toBeNull();
  });
});
