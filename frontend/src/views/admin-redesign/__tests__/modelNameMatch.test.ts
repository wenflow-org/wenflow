/**
 * 上游清单 ↔ 平台登记表的名字对齐（2026-10-16 用户走查「下面那张卡是干嘛的」）。
 *
 * 接入页签曾同屏两份模型名单：上游中转站返回的原始清单（30+ 个 chip）与平台登记的模型表
 * （4 行能力限额）。两者数量不一致又没说关系，读起来像同一件事说两遍。重排后：
 *   连接卡只说关系（上游 N 个 / 对上 M 个）· 登记表收「上游未登记」折叠。
 * 两处计数必须同口径，故都在本模块算——这个文件守住口径本身。
 */
import { describe, expect, it } from 'vitest'
import { normalizeModelName, splitUpstreamByRegistry } from '../modelNameMatch'

describe('modelNameMatch：名字归一', () => {
  it('取 vendor/ 后的尾段（上游同一个模型常有两种写法）', () => {
    expect(normalizeModelName('deepseek/deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(normalizeModelName('BAAI/bge-large-en-v1.5')).toBe('bge-large-en-v1.5')
  })

  it('无前缀名原样；大小写与首尾空白归一到同一键', () => {
    expect(normalizeModelName('agnes-3.0-flash')).toBe('agnes-3.0-flash')
    expect(normalizeModelName('  Agnes-3.0-FLASH  ')).toBe('agnes-3.0-flash')
  })

  it('空值/非串给空键（空键不参与匹配，避免把空串当成命中）', () => {
    expect(normalizeModelName('')).toBe('')
    expect(normalizeModelName('   ')).toBe('')
    expect(normalizeModelName(undefined as unknown as string)).toBe('')
  })
})

describe('modelNameMatch：上游清单切分', () => {
  const registered = ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'agnes-3.0-flash']

  it('带 vendor 前缀的孪生名算命中（同一个模型两种写法不能算成两个未登记）', () => {
    const { registered: hit, unregistered } = splitUpstreamByRegistry(
      ['deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', 'agnes-3.0-flash', 'BAAI/bge-m3'],
      registered
    )
    expect(hit).toEqual(['deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', 'agnes-3.0-flash'])
    expect(unregistered).toEqual(['BAAI/bge-m3'])
  })

  it('登记侧同样走归一（登记 id 带前缀时也能对上无前缀的上游名）', () => {
    const { unregistered } = splitUpstreamByRegistry(['deepseek-v4.1-flash'], ['deepseek/deepseek-v4.1-flash'])
    expect(unregistered).toEqual([])
  })

  it('全没对上：一个都不落下，也不抛（运营接了个不相干的中转站是常态）', () => {
    const { registered: hit, unregistered } = splitUpstreamByRegistry(['m-1', 'm-2'], registered)
    expect(hit).toEqual([])
    expect(unregistered).toEqual(['m-1', 'm-2'])
  })

  it('保留上游原始写法（前缀不丢），空名归入未登记但不与空键混淆', () => {
    const { unregistered } = splitUpstreamByRegistry(['', 'openai/gpt-6-luna'], registered)
    expect(unregistered).toEqual(['', 'openai/gpt-6-luna'])
  })
})
