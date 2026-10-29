/**
 * PathDetail 路径深链适配层（2026-10-12 拍板：路径不再有独立详情页）。
 *
 * 断言 = 解析行为与数据诚实性：
 *  - 有关联对话 → 就地换开座舱（?view=session-real&id=gc_x&stage=path），from 原样带走
 *  - 无关联对话（孤儿路径，M-2 2026-10-29 夜审）→ 不再落死空态：就地渲染路径自身内容
 *    （页头注明未关联对话 + PathJourneyPanel 阶段/任务），面包屑回写路径名
 *  - 接口失败 → 错误态可重试
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PathDetail from '../PathDetail.vue'
import { subPage, closeSubPage } from '../store'

const detailMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/adminApi', () => ({
  adminLearningContentApi: {
    getPathDetail: detailMock
  }
}))

vi.mock('../live', async () => {
  const { ref } = await import('vue')
  return {
    timeAgo: (v?: string | null) => (v ? '3 天前' : '—'),
    errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    shortId: (id: string, h: number, t: number) => (id ? `${id.slice(0, h)}…${id.slice(-t)}` : id),
    liveRefreshSeq: ref(0)
  }
})

async function settle() {
  await flushPromises()
  await nextTick()
  await flushPromises()
}

function mountShim() {
  // attachTo：孤儿内容体的治理动作（PathJourneyPanel）Teleport 到页头 [data-path-acts]，
  // 目标解析走 document 查询——组件必须真实挂进文档树
  return mount(PathDetail, { attachTo: document.body })
}

/** 孤儿路径详情行（conversationId=null；带阶段任务供 PathJourneyPanel 渲染断言） */
function orphanBody() {
  return {
    id: 'lp_1',
    title: '毛笔小楷入门',
    status: 'active',
    conversationId: null,
    milestones: [
      {
        id: 'ms_1',
        stageNumber: 1,
        title: '执笔与运笔',
        status: 'active',
        subtasks: [{ id: 't_1', title: '中锋线条练习', status: 'in_progress', taskType: 'practice', estimatedMinutes: 20 }]
      }
    ]
  }
}

beforeEach(() => {
  detailMock.mockReset()
  subPage.value = { view: 'path', id: 'lp_1' }
})

afterEach(() => {
  document.body.innerHTML = ''
  closeSubPage()
})

describe('PathDetail 路径深链适配层', () => {
  it('有关联对话 → 换开座舱并落 Path 页签；from 原样带走（返回键回到来源详情）', async () => {
    detailMock.mockResolvedValue({ data: { data: { id: 'lp_1', title: '数据分析入门', conversationId: 'gc_9' } } })
    subPage.value = {
      view: 'path',
      id: 'lp_1',
      from: { view: 'learner', id: 'u_1', label: '张三' }
    }
    const w = mountShim()
    await settle()
    expect(detailMock).toHaveBeenCalledWith('lp_1')
    expect(subPage.value).toEqual({
      view: 'session-real',
      id: 'gc_9',
      stage: 'path',
      from: { view: 'learner', id: 'u_1', label: '张三' }
    })
    w.unmount()
  })

  it('孤儿路径 → 不再落死空态：页头注明未关联对话，阶段与任务就地渲染（M-2）', async () => {
    // 面板内容体自取同一详情接口：第二次调用返回同一条
    detailMock.mockResolvedValue({ data: { data: orphanBody() } })
    const w = mountShim()
    await settle()
    const text = w.text()
    expect(text).toContain('未关联目标对话')
    expect(text).toContain('毛笔小楷入门')
    expect(text).toContain('执笔与运笔')
    expect(text).toContain('中锋线条练习')
    // 旧的死空态文案不再出现
    expect(text).not.toContain('该路径没有关联的目标对话')
    // 面包屑回写路径名（不再是裸 id）
    expect(subPage.value?.label).toBe('毛笔小楷入门')
    expect(subPage.value?.view).toBe('path')
    w.unmount()
  })

  it('接口失败 → 错误态给重试，不假开座舱', async () => {
    detailMock.mockRejectedValue(new Error('网络不可达'))
    const w = mountShim()
    await settle()
    expect(w.text()).toContain('路径打开失败')
    expect(w.text()).toContain('网络不可达')
    expect(subPage.value?.view).toBe('path')
    // 重试成功后正常换开
    detailMock.mockResolvedValue({ data: { data: { conversationId: 'gc_9' } } })
    const retry = w.findAll('button').find((b) => b.text() === '重试')
    await retry!.trigger('click')
    await settle()
    expect(subPage.value).toMatchObject({ view: 'session-real', id: 'gc_9', stage: 'path' })
    w.unmount()
  })
})
