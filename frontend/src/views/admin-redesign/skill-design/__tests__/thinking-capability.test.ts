/**
 * 思考配置 × 模型能力（2026-10-24）。
 *
 * 网关按注册表能力裁剪 thinking / reasoning_effort；裁剪是静默的，
 * 所以页面必须在配置处说明「写了也不会发」。这里钉住提示的触发边界：
 * - 不支持思考 + 开启 → 提示不发送
 * - 支持思考但没声明该档位 + 选了那一档 → 提示档位不发送（挡位是逐模型声明的）
 * - 关闭思考 / 跟随默认 / 模型不在目录 → 不提示（不猜）
 */
import { describe, expect, it } from 'vitest'
import { thinkingCapabilityNotice } from '../sdp-shared'

const NON_THINKING = { thinking: false, efforts: [] as string[] }
/** 声明了思考、一档强度都没声明 */
const THINKING_ONLY = { thinking: true, efforts: [] as string[] }
/** 声明了 low/high/max（deepseek-v4.1-flash 的现状） */
const FULL = { thinking: true, efforts: ['low', 'high', 'max'] }

describe('thinkingCapabilityNotice', () => {
  it('模型不支持思考 + 开启 → 明确说不发送', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'default' }, NON_THINKING))
      .toBe('当前模型不支持思考，开启后不会发送思考参数')
  })

  it('模型不支持思考但配置为关闭 → 不提示（关闭本来就不会发）', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'disabled', reasoningEffort: 'default' }, NON_THINKING)).toBe('')
  })

  it('支持思考但一档强度都没声明 + 选了档位 → 提示档位不发送', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'high' }, THINKING_ONLY))
      .toBe('当前模型不支持推理强度，该档位不会发送')
  })

  it('选中的档位在模型声明里 → 不提示', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'max' }, FULL)).toBe('')
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'low' }, FULL)).toBe('')
  })

  it('模型声明了别的档位、但没这一档 → 提示只说这台模型认哪几档', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'medium' }, FULL))
      .toBe('当前模型只认 low / high / max 这几档，medium 不会发送')
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'minimal' }, FULL))
      .toBe('当前模型只认 low / high / max 这几档，minimal 不会发送')
  })

  it('模型不在目录（cap 未知）→ 不猜、不提示', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'high' }, null)).toBe('')
  })

  it('跟随默认（thinkingMode=default）且没选强度 → 不提示', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'default', reasoningEffort: 'default' }, NON_THINKING)).toBe('')
  })
})
