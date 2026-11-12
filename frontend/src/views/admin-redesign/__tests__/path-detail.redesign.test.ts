/**
 * PathDetail 路径深链适配层（2026-10-12 拍板：路径不再有独立详情页）。
 *
 * 断言 = 解析行为与数据诚实性：
 *  - 有关联对话 → 就地换开座舱（?view=session-real&id=gc_x&stage=path），from 原样带走
 *  - 无关联对话（孤儿路径；2026-11-01 外部评审 P1/P2 重做）→ 信息卡直出路径基础信息
 *    （所属用户 / 状态 / 里程碑·任务数 / 短式可复制 ID）并给「去目标对话」回链；
 *    内容查看收编到学习者详情（原 M-2「就地渲染阶段任务」随之退役），面包屑回写路径名
 *  - 接口失败 → 错误态可重试
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PathDetail from '../PathDetail.vue'
import PathJourneyPanel from '../PathJourneyPanel.vue'
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

  it('孤儿路径 → 信息卡直出基础信息 + 可复制 ID + 回链，不再落死空态（2026-11-01 评审 P1/P2）', async () => {
    detailMock.mockResolvedValue({ data: { data: orphanBody() } })
    const w = mountShim()
    await settle()
    const text = w.text()
    // 信息卡：标题 / 状态（active→学习中）/ 里程碑与任务计数 / 复制入口
    expect(text).toContain('毛笔小楷入门')
    expect(text).toContain('学习中')
    expect(text).toContain('1 个 · 1 条')
    expect(text).toContain('复制')
    // 说明句只留状态事实（2026-11-02 文案清理：纯指路的「路径内容仍可在学习者详情里查看」
    // 已撤——本卡下方已有「返回列表」「去目标对话」两个出口）
    expect(text).toContain('该路径没有关联的目标对话，因此没有可跳转的学习会话座舱')
    expect(text).not.toContain('路径内容仍可在学习者详情里查看')
    expect(text).toContain('去目标对话')
    // 面包屑回写路径名（不再是裸 id）
    expect(subPage.value?.label).toBe('毛笔小楷入门')
    expect(subPage.value?.view).toBe('path')
    w.unmount()
  })

  it('孤儿路径：subject 与 title 同值 → 卡头不重复渲染（2026-11-04 次要标签冗余修复）', async () => {
    // 生成路径常把目标文本同写进 title/subject（如「对着《灵飞经》练中锋线条…」），
    // 若照旧无条件渲染 meta，卡头会同一句话出现两遍。
    detailMock.mockResolvedValue({
      data: { data: { ...orphanBody(), title: '毛笔小楷入门', subject: '毛笔小楷入门' } }
    })
    const w = mountShim()
    await settle()
    // 标题只在卡头出现一次（面包屑不回显在本组件文本里）
    const occurrences = w.text().split('毛笔小楷入门').length - 1
    expect(occurrences).toBe(1)
    expect(w.find('.mk-card__meta').exists()).toBe(false)
    w.unmount()
  })

  it('孤儿路径：subject 与 title 不同 → 卡头照常显示 subject 副标', async () => {
    detailMock.mockResolvedValue({
      data: { data: { ...orphanBody(), title: '毛笔小楷入门', subject: '钢笔楷书' } }
    })
    const w = mountShim()
    await settle()
    const meta = w.find('.mk-card__meta')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toBe('钢笔楷书')
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

describe('PathJourneyPanel 任务行（2026-11-11 全站打磨）', () => {
  it('任务名有 title 可查全值；缺预计时长时只留类型，不写「0 分钟」', async () => {
    detailMock.mockResolvedValue({
      data: {
        data: {
          title: '毛笔小楷入门',
          status: 'active',
          milestones: [{
            id: 'ms_1',
            stageNumber: 1,
            title: '执笔与运笔',
            status: 'active',
            subtasks: [
              { id: 't_1', title: '中锋线条练习', status: 'in_progress', taskType: 'practice', estimatedMinutes: 20 },
              { id: 't_2', title: '没有时长的任务', status: 'todo', taskType: 'reading', estimatedMinutes: 0 }
            ]
          }]
        }
      }
    })
    const w = mount(PathJourneyPanel, {
      props: { pathId: 'lp_1' },
      global: { stubs: { teleport: true } }
    })
    await settle()
    const titles = w.findAll('.pd-task__title')
    expect(titles[0].attributes('title')).toBe('中锋线条练习')
    expect(titles[1].attributes('title')).toBe('没有时长的任务')
    const subs = w.findAll('.pd-task__sub').map((s) => s.text())
    expect(subs[0]).toBe('练习 · 20 分钟')
    expect(subs[1]).toBe('阅读')
    expect(subs[1]).not.toContain('0 分钟')
    w.unmount()
  })
})
