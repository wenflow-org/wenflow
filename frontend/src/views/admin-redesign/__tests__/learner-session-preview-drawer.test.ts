/**
 * 课堂只读预览抽屉（2026-11-11 学习者详情评审 P1）：
 * - 打开时才请求 /admin/session-console/:id（复用课堂座舱的只读端点）
 * - 只读展示单课总结 + 对话记录，头部的「展开全屏监控」只发事件，由页面决定进入原课堂页
 * - Esc / 遮罩点击 / 关闭按钮都只发 close，不自行导航
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const getRealSessionConsole = vi.hoisted(() => vi.fn())

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: { getRealSessionConsole },
}))

import LearnerSessionPreviewDrawer from '../LearnerSessionPreviewDrawer.vue'

const payload = {
  kind: 'teaching',
  sessionId: 's1',
  teaching: {
    topic: '递归入门',
    status: 'completed',
    startTime: '2026-11-10T10:00:00Z',
    messages: [
      { role: 'user', content: '我不懂递归', time: '2026-11-10T10:01:00Z' },
      { role: 'assistant', content: '先看基线条件', time: null },
    ],
    wrapup: {
      status: 'complete',
      summary: {
        topicSummary: '递归的基线条件与递推',
        knowledgeSummary: '掌握基线条件',
        learningEvaluation: '理解到位',
        practiceAdvice: '',
      },
    },
  },
}

async function mountOpen() {
  const w = mount(LearnerSessionPreviewDrawer, {
    props: { open: false, sessionId: 's1' },
    attachTo: document.body,
  })
  await w.setProps({ open: true })
  await flushPromises()
  await nextTick()
  return w
}

describe('LearnerSessionPreviewDrawer', () => {
  beforeEach(() => {
    getRealSessionConsole.mockReset().mockResolvedValue({ data: { data: payload } })
    document.body.innerHTML = ''
  })

  it('关闭态不渲染、不请求；打开后按会话 id 取数并渲染总结与对话', async () => {
    const w = mount(LearnerSessionPreviewDrawer, { props: { open: false, sessionId: 's1' } })
    expect(w.find('.mk-drawer').exists()).toBe(false)
    expect(getRealSessionConsole).not.toHaveBeenCalled()

    await w.setProps({ open: true })
    await flushPromises()
    expect(getRealSessionConsole).toHaveBeenCalledWith('s1')
    expect(w.find('.mk-drawer').exists()).toBe(true)
    const panel = w.find('.ld-sess-drawer')
    expect(panel.attributes('role')).toBe('dialog')
    expect(panel.attributes('aria-modal')).toBe('true')
    expect(w.text()).toContain('递归入门')
    expect(w.text()).toContain('递归的基线条件与递推')
    expect(w.text()).toContain('掌握基线条件')
    expect(w.text()).toContain('我不懂递归')
    expect(w.text()).toContain('先看基线条件')
    expect(w.text()).toContain('学员')
    expect(w.text()).toContain('老师')
    // 2026-11-11：时间统一 YYYY-MM-DD HH:mm（不再用 cockpitFormat.formatTime 的 2026/11/10 …）
    expect(w.find('.ld-sess-msg__time').text()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(w.find('.mk-drawer__sub').text()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    w.unmount()
  })

  it('「展开全屏监控」只发 expand，关闭按钮只发 close', async () => {
    const w = await mountOpen()
    const expand = w.findAll('.ld-sess-drawer__actions button').find((b) => b.text() === '展开全屏监控')!
    await expand.trigger('click')
    expect(w.emitted('expand')).toHaveLength(1)

    await w.find('.mk-drawer__close').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('Esc 与遮罩点击都发 close', async () => {
    const w = await mountOpen()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(w.emitted('close')).toHaveLength(1)

    const mask = w.find('.mk-drawer__mask')
    await mask.trigger('mousedown')
    await mask.trigger('mouseup')
    expect(w.emitted('close')).toHaveLength(2)
    w.unmount()
  })

  it('接口失败时给错误态与重试入口，不把失败说成空记录', async () => {
    getRealSessionConsole.mockRejectedValueOnce(new Error('boom'))
    const w = await mountOpen()
    expect(w.text()).toContain('课堂记录读取失败')
    expect(w.text()).toContain('boom')
    expect(w.find('.mk-empty').exists()).toBe(true)
    w.unmount()
  })
})
