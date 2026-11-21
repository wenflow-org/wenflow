/**
 * 消息操作域（V2LearningPage.vue 拆分）：
 * 气泡悬浮操作条（复制/点赞点踩）+ 最后一条用户消息的「修正后重发」与最后一条 AI 回复的「再回答一次」。
 *
 * 追加语义（2026-11-21）：教学会话在后端是顺序追加，前端不再做「替换文本 + 裁掉其后消息」
 * 或「删掉 AI 气泡再重发」。两个动作都只**追加一轮新的用户回合**，已保存的消息（原问题、
 * 原回答及其后的对话）在界面与服务端 transcript 里都保留；刷新/回放看到的是同一份历史。
 * 动作名也按真实行为写：编辑最后一条用户消息 = 「修正后重发」，重答最后一条 AI 回复 =
 * 「再回答一次」——不再用会被读成「改写历史」的「编辑 / 重新生成」。
 *
 * 失败回滚只针对本轮追加的乐观消息：doSend 返回 false 时，把 messages 截回发送前的长度，
 * 原有对话一条不动；用户仍可用输入框或重试入口再发一次。
 */
import { ref, type Ref } from 'vue';
import { toast } from '@/utils/toast';
import { copyText } from '@/utils/clipboard';
import { feedbackApi } from '@/api/feedback';
import type { ChatMsg } from './learningChat';

export function useMessageActions(deps: {
  msgs: Ref<ChatMsg[]>;
  typing: Ref<boolean>;
  completed: Ref<boolean>;
  session: Ref<{ sessionId: string; revision: number } | null>;
  /** images：随文图片（视觉通道）——修正/重答沿用原消息的图，重发不丢图。
   *  返回值 = 本轮是否真正送达（false 时调用方只回滚本次乐观追加，不碰历史消息）。 */
  doSend: (text: string, allowStaleRetry?: boolean, skipUserPush?: boolean, retryKey?: string, images?: Array<{ url: string; caption?: string }>) => Promise<boolean>;
}) {
  const { msgs, typing, completed, session, doSend } = deps;

  /** 取消息随文图片的请求体形状（气泡侧 ChatImage → 请求侧 {url, caption?}） */
  function msgImages(m: ChatMsg): Array<{ url: string; caption?: string }> {
    return (m.images || []).map((img) => ({ url: img.url, ...(img.caption ? { caption: img.caption } : {}) }));
  }

  /**
   * 追加一轮新的用户回合；失败时只回滚这一轮乐观消息（发送前的历史一条不动）。
   * 不传 skipUserPush：追加动作需要在本地显示新的「你」气泡，与服务端落库保持一致。
   */
  async function appendTurn(text: string, images?: Array<{ url: string; caption?: string }>): Promise<boolean> {
    const before = msgs.value.length;
    const ok = await doSend(text, true, false, undefined, images);
    if (!ok) {
      if (msgs.value.length > before) msgs.value.splice(before);
      toast.error('这次重发没有成功，原有对话已保留');
    }
    return ok;
  }

  const hoveredMsgId = ref<string | null>(null);

  function onBubbleEnter(id: string) { hoveredMsgId.value = id; }
  function onBubbleLeave() { hoveredMsgId.value = null; }

  /**
   * 复制消息正文。返回是否成功（MessageActions 据此决定要不要显示对勾——
   * 失败还画对勾等于骗用户，2026-11-02 走查）。
   * 局域网 http 下 navigator.clipboard 不存在，回退逻辑在 utils/clipboard。
   */
  async function copyMessage(text: string): Promise<boolean> {
    const ok = await copyText(text);
    if (ok) toast.success('已复制到剪贴板');
    else toast.error('复制失败：浏览器未授予剪贴板权限，请手动选中文字复制');
    return ok;
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

  /* ---------- 用户消息「修正后重发」 ----------
     仍只对「最后一条用户消息」开放（避免在历史中段插入新回合把上下文顺序弄乱），
     但行为改为追加：原消息与它后面的所有已保存消息都留在原地，修正文本作为新一轮用户回合发送。 */
  const editingMsgId = ref<string | null>(null);
  const editingText = ref('');

  /** 可修正条件：最后一条用户消息（且不在流式/结算中） */
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

  /** 修正后重发：保留原消息，追加一条修正后的用户回合并等待老师新一轮回复 */
  async function saveEdit(m: ChatMsg) {
    const t = editingText.value.trim();
    if (!t || !session.value) { cancelEdit(); return; }
    if (t === m.text) { cancelEdit(); return; }
    if (typing.value || completed.value) { cancelEdit(); return; }
    editingMsgId.value = null;
    editingText.value = '';
    await appendTurn(t, msgImages(m));
  }

  /** 再回答一次：保留上一条 AI 回复，把对应问题作为新一轮追加发送（不删旧答案） */
  async function regenerateMessage(m: ChatMsg) {
    if (typing.value || completed.value || !session.value) return;
    const idx = msgs.value.indexOf(m);
    // 只允许对「最新一轮老师回复」再回答：历史中段的 AI 消息后面已有其他回合，重发会把
    // 新回答接到错误位置；而删除旧气泡的做法已按追加语义撤除。
    if (idx < 0 || idx !== msgs.value.length - 1 || m.role !== 'ai') {
      toast.info('只能对最新一条回复再回答一次');
      return;
    }
    // Find the user message preceding this AI message
    let lastUser: ChatMsg | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs.value[i].role === 'user') { lastUser = msgs.value[i]; break; }
    }
    // 只发图不打字的回合也放行（text 为空但图片可作为上下文）
    if (!lastUser || (!lastUser.text && !lastUser.images?.length)) { toast.info('找不到对应的问题'); return; }
    // 追加同一问题的新闻答（保留旧 AI 回复）；失败只回滚本次追加
    await appendTurn(lastUser.text, msgImages(lastUser));
  }

  return {
    hoveredMsgId, onBubbleEnter, onBubbleLeave, copyMessage, sendMessageFeedback,
    editingMsgId, editingText, canEditMessage, startEdit, cancelEdit, saveEdit, regenerateMessage
  };
}
