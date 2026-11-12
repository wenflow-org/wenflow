/**
 * 管理端登录页的交互底线：
 * - 429 锁定直接显示服务端「请 N 秒后重试」与 remainingTime，不在前端猜等待时长；
 * - 提交中防重复点击（按钮禁用 + 入口 guard）；
 * - 密码可见切换是图标按钮：title / aria-label 随状态翻转。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Login from '../Login.vue'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: { login: loginMock },
  markAdminSession: vi.fn()
}))
vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))
vi.mock('@/utils/authFlash', () => ({ consumeAuthFlashMessage: () => '' }))
vi.mock('@/composables/useIsDark', () => ({ useIsDark: () => false }))

async function mountLogin() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login', component: Login },
      { path: '/admin/overview', component: { template: '<div />' } },
      { path: '/', component: { template: '<div />' } }
    ]
  })
  await router.push('/admin/login')
  await router.isReady()
  const w = mount(Login, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

async function fillAndSubmit(w: Awaited<ReturnType<typeof mountLogin>>) {
  await w.find('input[autocomplete="username"]').setValue('admin')
  await w.find('input[autocomplete="current-password"]').setValue('secret')
  await w.find('form').trigger('submit')
  await flushPromises()
}

describe('登录页', () => {
  beforeEach(() => {
    loginMock.mockReset()
  })

  it('429 锁定显示服务端给出的剩余时长（不再用前端猜的「约 1 分钟」）', async () => {
    loginMock.mockRejectedValueOnce({
      response: {
        status: 429,
        data: { error: { message: '登录失败次数过多，请 900 秒后重试', remainingTime: 900 } }
      }
    })
    const w = await mountLogin()
    await fillAndSubmit(w)
    expect(w.find('.errorbar').text()).toBe('登录失败次数过多，请 900 秒后重试')
    w.unmount()
  })

  it('提交中：按钮禁用，再次提交不会发第二个请求', async () => {
    let release: (v: unknown) => void = () => {}
    loginMock.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const w = await mountLogin()
    await fillAndSubmit(w)
    const submit = w.find('button[type="submit"]')
    expect(submit.attributes('disabled')).toBeDefined()
    await w.find('form').trigger('submit')
    expect(loginMock).toHaveBeenCalledTimes(1)
    release({ data: { success: false, message: '登录失败，请检查账号密码' } })
    await flushPromises()
    w.unmount()
  })

  it('密码可见钮有 title + aria-label，切换后文案翻转', async () => {
    const w = await mountLogin()
    const eye = w.find('.field__eye')
    expect(eye.attributes('title')).toBe('显示密码')
    expect(eye.attributes('aria-label')).toBe('显示密码')
    await eye.trigger('click')
    expect(eye.attributes('title')).toBe('隐藏密码')
    expect(eye.attributes('aria-label')).toBe('隐藏密码')
    w.unmount()
  })
})
