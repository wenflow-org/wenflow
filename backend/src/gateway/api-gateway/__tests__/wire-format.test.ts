/**
 * Wire format golden tests（2026-10-20）。
 *
 * 这些用例锁的是「发给上游的消息数组长什么样」——不是折叠函数内部实现。
 * 背景：审计发现同一条 prompt 在 WenFlow 里没有唯一的渲染结果（三处 buildMessages
 * 各自拼装 + 网关全局折叠），golden test 只能测到中间态。本文件把两种合法形态
 * （原生 system / 折叠进首条 user）逐字节固定下来，并覆盖多轮、多 system、无 user、
 * 多模态四种边界。
 */
import type { ChatMessageContent } from '../types';
import {
  foldSystemMessagesIntoUser,
  mergeSystemTextIntoContent,
  renderWireMessages,
  resolveSystemPromptFoldPolicy,
  type WireMessage,
} from '../wire-format';

type Msg = { role: 'system' | 'user' | 'assistant'; content: ChatMessageContent };

const IMAGE_PART = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } };

describe('renderWireMessages（同一条逻辑会话的两种合法 wire format）', () => {
  const conversation: Msg[] = [
    { role: 'system', content: 'SYS-RULES' },
    { role: 'user', content: 'U1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'U2' },
  ];

  it('标准上游：完整保留 system 角色与多轮顺序（golden）', () => {
    const out = renderWireMessages(conversation as WireMessage[], { foldSystem: false });
    expect(out).toEqual([
      { role: 'system', content: 'SYS-RULES' },
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'U2' },
    ]);
  });

  it('折叠通道：system 只进首条 user，其余消息顺序不变（golden）', () => {
    const out = renderWireMessages(conversation as WireMessage[], { foldSystem: true });
    expect(out).toEqual([
      { role: 'user', content: 'SYS-RULES\n\n---\nU1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'U2' },
    ]);
  });

  it('策略解析：环境覆盖优先于通道能力', () => {
    expect(resolveSystemPromptFoldPolicy(true, undefined)).toBe(false);
    expect(resolveSystemPromptFoldPolicy(false, undefined)).toBe(true);
    expect(resolveSystemPromptFoldPolicy(false, '0')).toBe(false);
    expect(resolveSystemPromptFoldPolicy(true, '1')).toBe(true);
    expect(resolveSystemPromptFoldPolicy(true, '')).toBe(false);
  });

  it('多 system：按序拼接后再折叠', () => {
    const out = foldSystemMessagesIntoUser([
      { role: 'system', content: 'S1' },
      { role: 'system', content: 'S2' },
      { role: 'user', content: 'U' },
    ] as WireMessage[]);
    expect(out).toEqual([{ role: 'user', content: 'S1\n\nS2\n\n---\nU' }]);
  });

  it('只有 system：生成一条 user 承载，不丢内容', () => {
    const out = foldSystemMessagesIntoUser([{ role: 'system', content: 'SYS' }] as WireMessage[]);
    expect(out).toEqual([{ role: 'user', content: 'SYS' }]);
  });

  it('多模态首条 user：system 插入首个文本块前，图片块保留', () => {
    const out = foldSystemMessagesIntoUser([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: [{ type: 'text', text: '看图' }, IMAGE_PART] },
    ] as WireMessage[]);
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'SYS\n\n---' },
          { type: 'text', text: '看图' },
          IMAGE_PART,
        ],
      },
    ]);
  });

  it('mergeSystemTextIntoContent：无文本块时插到最前；无内容时给纯文本', () => {
    expect(mergeSystemTextIntoContent('SYS', [IMAGE_PART])).toEqual([
      { type: 'text', text: 'SYS\n\n---' },
      IMAGE_PART,
    ]);
    expect(mergeSystemTextIntoContent('SYS', undefined)).toBe('SYS\n\n---\n');
  });

  it('无 system 时两种策略都原样返回（引用不变）', () => {
    const input = [{ role: 'user' as const, content: 'U' }] as WireMessage[];
    expect(renderWireMessages(input, { foldSystem: true })).toBe(input);
    expect(renderWireMessages(input, { foldSystem: false })).toBe(input);
  });
});
