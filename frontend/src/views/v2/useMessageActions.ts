/**
 * 消息操作域（V2LearningPage.vue 拆分）：
 * 气泡悬浮操作条（复制/点赞点踩）+ 最后一条用户消息的内联编辑与重新生成
 */
import { ref, type Ref } from 'vue';
import { toast } from '@/utils/toast';
import { feedbackApi } from '@/api/feedback';
import type { ChatMsg } from './learningChat';

export function useMessageActions(deps: {
  msgs: Ref<ChatMsg[]>;
  typing: Ref<boolean>;
  completed: Ref<boolean>;
  session: Ref<{ sessionId: string; revision: number } | null>;
  doSend: (text: string, allowStaleRetry?: boolean, skipUserPush?: boolean) => Promise<void>;
}) {
  const { msgs, typing, completed, session, doSend } = deps;

  const hoveredMsgId = ref<string | null>(null);

  function onBubbleEnter(id: string) { hoveredMsgId.value = id; }
  function onBubbleLeave() { hoveredMsgId.value = null; }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制到剪贴板');
    } catch { toast.error('复制失败'); }
  }

  /** 消息级点赞/点踩上报：内容去重（后端按内容哈希 key），失败静默不打扰 */
  async function sendMessageFeedback(m: ChatMsg, thumbsUp: boolean) {
    if (!session.value || !m.text) return;
    try {
      await feedbackApi.submitMessage({
        sessionId: session.value.sessionId,
        messageText: m.text,
        thumbsUp
      });
    } catch {
      /* 反馈失败不影响对话，静默 */
    }
  }

  /* ---------- 用户消息内联编辑（ChatGPT/Claude 标准能力） ----------
     仅允许编辑「最后一条用户消息」：编辑后替换文本 + 裁掉其后所有消息 + 重新发送。
     后端 teaching 会话为顺序追加，重发即新回合，无需后端改动。 */
  const editingMsgId = ref<string | null>(null);
  const editingText = ref('');

  /** 可编辑条件：最后一条用户消息（且不在流式/结算中） */
  function canEditMessage(m: ChatMsg): boolean {
    if (typing.value || completed.value || editingMsgId.value) return false;
    const lastUserIdx = msgs.value.map((x) => x.role).lastIndexOf('user');
    return lastUserIdx >= 0 && msgs.value[lastUserIdx] === m;
  }

  function startEdit(m: ChatMsg) {
    editingMsgId.value = m.id ?? null;
    editingText.value = m.text;
  }

  function cancelEdit() {
    editingMsgId.value = null;
    editingText.value = '';
  }

  /** 保存编辑：替换文本 → 裁掉其后所有消息 → 重新发送 */
  async function saveEdit(m: ChatMsg) {
    const t = editingText.value.trim();
    if (!t || !session.value) { cancelEdit(); return; }
    if (t === m.text) { cancelEdit(); return; }
    const idx = msgs.value.indexOf(m);
    if (idx < 0) { cancelEdit(); return; }
    // 替换本条 + 裁掉其后（含 AI 回复）
    msgs.value.splice(idx, msgs.value.length - idx, { ...m, text: t });
    editingMsgId.value = null;
    editingText.value = '';
    // 重新发送（不重复 push 用户消息，消息已替换）
    await doSend(t, true, true);
  }

  async function regenerateMessage(m: ChatMsg) {
    if (typing.value || !session.value) return;
    // Find the user message preceding this AI message
    const idx = msgs.value.indexOf(m);
    let lastUser = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs.value[i].role === 'user') { lastUser = msgs.value[i].text; break; }
    }
    if (!lastUser) { toast.info('找不到对应的问题'); return; }
    // Remove the current AI message and re-send（不重复 push 用户消息）
    msgs.value.splice(idx, 1);
    await doSend(lastUser, true, true);
  }

  return {
    hoveredMsgId, onBubbleEnter, onBubbleLeave, copyMessage, sendMessageFeedback,
    editingMsgId, editingText, canEditMessage, startEdit, cancelEdit, saveEdit, regenerateMessage
  };
}
