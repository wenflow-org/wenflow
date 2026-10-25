/**
 * 拉取结果浮窗（PullModelsDialog，2026-10-24 用户「拉取作为浮窗」）：
 * 勾选对话候选、已添加只读、筛选与全选、非对话模型去对应配置。
 */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PullModelsDialog from '../PullModelsDialog.vue'

const MODELS = [
  'deepseek-v4.1-flash',
  'agnes-3.0-flash',
  'mimo-v2.5-flash',
  'BAAI/bge-m3',
  'agnes-image-2.5-flash',
  'jev-latest',
  'agnes-video-2.5',
]

function mountDialog(registered: string[] = ['deepseek-v4.1-flash']) {
  return mount(PullModelsDialog, {
    props: { providerName: '平台', models: MODELS, registered },
    global: { stubs: { teleport: true } },
  })
}

async function open(wrapper: ReturnType<typeof mountDialog>) {
  ;(wrapper.vm as unknown as { openWith: () => void }).openWith()
  await nextTick()
  await flushPromises()
}

describe('PullModelsDialog', () => {
  it('按用途分组：对话候选可勾，其他用途给配置入口或「暂未接入」', async () => {
    const w = mountDialog()
    await open(w)
    const chatRows = w.findAll('.pmd-sec:not(.pmd-sec--other) .pmd-row')
    expect(chatRows).toHaveLength(3)
    expect(w.findAll('.pmd-row--other')).toHaveLength(4)

    const rowText = (needle: string) => w.findAll('.pmd-row').find((r) => r.text().includes(needle))!
    expect(rowText('deepseek-v4.1-flash').text()).toContain('已添加')
    expect(rowText('deepseek-v4.1-flash').find('input').attributes('disabled')).toBeDefined()
    expect(rowText('BAAI/bge-m3').find('button').text()).toBe('基础设施配置')
    expect(rowText('agnes-image-2.5-flash').find('button').text()).toBe('插件配置')
    expect(rowText('agnes-video-2.5').text()).toContain('暂未接入')
    expect(rowText('agnes-video-2.5').find('button').exists()).toBe(false)
    // 段头两个数不一致时写清「可添加」：3 个候选里有 1 个已登记
    const head = w.find('.pmd-sec__head')
    expect(head.text()).toContain('3')
    expect(head.text()).toContain('可添加 2')
  })

  it('勾选后确认：只回传勾中的对话模型', async () => {
    const w = mountDialog()
    await open(w)
    await w.findAll('.pmd-sec:not(.pmd-sec--other) .pmd-row')[1].find('input').setValue(true)
    await nextTick()
    await w.findAll('.pmd-sec:not(.pmd-sec--other) .pmd-row')[2].find('input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('2')

    const confirm = w.findAll('button').find((b) => b.text().includes('配置选中的 2 个'))!
    await confirm.trigger('click')
    expect(w.emitted('confirm')?.[0]).toEqual([['agnes-3.0-flash', 'mimo-v2.5-flash']])
  })

  it('全选只作用于当前筛选出的可添加模型，已添加的不勾', async () => {
    const w = mountDialog(['deepseek-v4.1-flash', 'agnes-3.0-flash'])
    await open(w)
    await w.find('.pmd-filter').setValue('flash')
    await nextTick()
    const all = w.find('.pmd-all input')
    await all.setValue(true)
    await nextTick()
    const rows = w.findAll('.pmd-sec:not(.pmd-sec--other) .pmd-row')
    expect(rows.map((r) => (r.find('input').element as HTMLInputElement).checked)).toEqual([false, false, true])
    expect(w.find('.pmd-foot__count').text()).toContain('1')
  })

  it('非对话模型的配置入口回传去向并关闭浮窗', async () => {
    const w = mountDialog()
    await open(w)
    const infra = w.findAll('.pmd-row--other button').find((b) => b.text() === '基础设施配置')!
    await infra.trigger('click')
    expect(w.emitted('navigate')?.[0]).toEqual(['infra'])
    expect(w.find('.pmd').exists()).toBe(false)
  })

  it('没有对话模型时给出空态，全选禁用', async () => {
    const w = mount(PullModelsDialog, {
      props: { providerName: '平台', models: ['BAAI/bge-m3'], registered: [] },
      global: { stubs: { teleport: true } },
    })
    await open(w)
    expect(w.find('.pmd-empty').text()).toContain('没有拉取到对话模型')
    expect(w.find('.pmd-all input').attributes('disabled')).toBeDefined()
  })
})
