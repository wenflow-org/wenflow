/**
 * 思考配置 × 模型能力（2026-10-24）。
 *
 * 网关按注册表能力裁剪 thinking / reasoning_effort；裁剪是静默的，
 * 所以页面必须在配置处说明「写了也不会发」。这里钉住提示的触发边界：
 * - 不支持思考 + 开启 → 提示不发送
 * - 支持思考但不支持强度 + 选了档位 → 提示档位不发送
 * - 关闭思考 / 跟随默认 / 模型不在目录 → 不提示（不猜）
 */
import { describe, expect, it } from 'vitest'
import { thinkingCapabilityNotice } from '../sdp-shared'

const NON_THINKING = { thinking: false, reasoning: false }
const THINKING_ONLY = { thinking: true, reasoning: false }
const FULL = { thinking: true, reasoning: true }

describe('thinkingCapabilityNotice', () => {
  it('模型不支持思考 + 开启 → 明确说不发送', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'default' }, NON_THINKING))
      .toBe('当前模型不支持思考，开启后不会发送思考参数')
  })

  it('模型不支持思考但配置为关闭 → 不提示（关闭本来就不会发）', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'disabled', reasoningEffort: 'default' }, NON_THINKING)).toBe('')
  })

  it('支持思考但不支持强度 + 选了档位 → 提示档位不发送', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'high' }, THINKING_ONLY))
      .toBe('当前模型不支持推理强度，该档位不会发送')
  })

  it('能力齐全 → 不提示', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'max' }, FULL)).toBe('')
  })

  it('模型不在目录（cap 未知）→ 不猜、不提示', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'enabled', reasoningEffort: 'high' }, null)).toBe('')
  })

  it('跟随默认（thinkingMode=default）且没选强度 → 不提示', () => {
    expect(thinkingCapabilityNotice({ thinkingMode: 'default', reasoningEffort: 'default' }, NON_THINKING)).toBe('')
  })
})
