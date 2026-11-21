/**
 * 追加语义回归（2026-11-21）：
 * - 「修正后重发」不再替换/裁掉已保存消息，而是追加一轮新的用户回合；
 * - 「再回答一次」不再删除旧 AI 回复，而是把对应问题追加为新回合；
 * - 发送失败只回滚本轮乐观追加，历史消息一条不动。
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useMessageActions } from '../useMessageActions'
import type { ChatMsg } from '../learningChat'

const user = (id: string, text: string, images?: ChatMsg['images']): ChatMsg => ({ id, role: 'user', text, time: '10:00', ...(images ? { images } : {}) })
const ai = (id: string, text: string): ChatMsg => ({ id, role: 'ai', text, time: '10:01' })

function setup(initial: ChatMsg[], send: (text: string, images?: ChatMsg['images']) => Promise<boolean>) {
  const msgs = ref<ChatMsg[]>(initial)
  const doSend = vi.fn(async (text: string, _retry?: boolean, _skip?: boolean, _key?: string, images?: ChatMsg['images']) => {
    const ok = await send(text, images)
    return ok
  })
  const actions = useMessageActions({
    msgs,
    typing: ref(false),
    completed: ref(false),
    session: ref({ sessionId: 's1', revision: 1 }),
    doSend,
  })
  return { msgs, doSend, actions }
}

describe('useMessageActions 追加语义', () => {
  it('修正后重发：保留原消息及其后所有消息，只追加新一轮用户回合', async () => {
    const { msgs, actions } = setup(
      [user('u1', '原问题'), ai('a1', '原回答'), user('u2', '最后一问'), ai('a2', '最后一答')],
      async (text, images) => {
        msgs.value.push(user('u3', text, images), ai('a3', `对「${text}」的新回答`))
        return true
      },
    )
    const original = msgs.value.map((m) => `${m.id}:${m.text}`)
    const target = msgs.value[2]
    actions.startEdit(target)
    actions.editingText.value = '修正后的问题'
    await actions.saveEdit(target)

    // 原有四条消息逐字保留，没有替换/截断
    expect(msgs.value.slice(0, 4).map((m) => `${m.id}:${m.text}`)).toEqual(original)
    // 新回合追加在末尾
    expect(msgs.value.slice(4).map((m) => `${m.role}:${m.text}`)).toEqual([
      'user:修正后的问题',
      'ai:对「修正后的问题」的新回答',
    ])
  })

  it('修正后重发失败：只回滚本轮乐观追加，原有对话保留', async () => {
    const { msgs, actions, doSend } = setup(
      [user('u1', '原问题'), ai('a1', '原回答'), user('u2', '最后一问')],
      async (text) => {
        msgs.value.push(user('u3', text), ai('a_left', '这次回复失败了。'))
        return false
      },
    )
    const original = msgs.value.map((m) => `${m.id}:${m.text}`)
    const target = msgs.value[2]
    actions.startEdit(target)
    actions.editingText.value = '修正后的问题'
    await actions.saveEdit(target)

    expect(doSend).toHaveBeenCalledWith('修正后的问题', true, false, undefined, [])
    expect(msgs.value.map((m) => `${m.id}:${m.text}`)).toEqual(original)
  })

  it('再回答一次：保留旧 AI 回复，把对应问题作为新回合追加', async () => {
    const { msgs, actions } = setup(
      [user('u1', '问题'), ai('a1', '旧回答')],
      async (text, images) => {
        msgs.value.push(user('u2', text, images), ai('a2', '新回答'))
        return true
      },
    )
    await actions.regenerateMessage(msgs.value[1])

    expect(msgs.value.map((m) => `${m.role}:${m.text}`)).toEqual([
      'user:问题',
      'ai:旧回答',
      'user:问题',
      'ai:新回答',
    ])
  })

  it('再回答一次失败：回滚追加回合，旧回答仍在', async () => {
    const { msgs, actions } = setup(
      [user('u1', '问题'), ai('a1', '旧回答')],
      async (text) => {
        msgs.value.push(user('u2', text), ai('a2', '这次回复失败了。'))
        return false
      },
    )
    await actions.regenerateMessage(msgs.value[1])
    expect(msgs.value.map((m) => `${m.id}:${m.text}`)).toEqual(['u1:问题', 'a1:旧回答'])
  })

  it('只允许对最新一条 AI 回复再回答一次（历史中段不开放）', async () => {
    const { msgs, actions, doSend } = setup(
      [user('u1', '问题1'), ai('a1', '回答1'), user('u2', '问题2')],
      async () => true,
    )
    await actions.regenerateMessage(msgs.value[1])
    expect(doSend).not.toHaveBeenCalled()
    expect(msgs.value).toHaveLength(3)
  })
})
