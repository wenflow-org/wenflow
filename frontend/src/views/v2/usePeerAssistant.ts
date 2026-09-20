/**
 * 伴学浮窗域（V2LearningPage.vue 拆分）：角色「小启」dock 式浮窗
 * 消息收发（流式 + 传输失败回退非流式）、触发频控自动展开、历史回填与重置
 */
import { computed, nextTick, ref, type Ref } from 'vue';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { nowTime } from './learningChat';

export interface PeerChatItem {
  role: 'peer' | 'me';
  text: string;
  time: string;
  /** 伴学策略（英文枚举），展示为学法标签；主动消息/失败兜底为 null */
  strategy?: string | null;
  /** 小启消息自带的后续追问快选（skill followUpQuestions） */
  followUps?: string[];
}

/** 伴学策略 → 学法标签（与 peer-reinforcement skill 枚举对齐） */
const PEER_STRATEGY_LABEL: Record<string, string> = {
  feynman: '费曼讲解',
  debate: '观点辩论',
  counterexample: '反例挑战',
  analogy: '类比迁移',
  'error-analysis': '错因复盘',
};

export function usePeerAssistant(session: Ref<{ sessionId: string; revision: number } | null>) {
  const peerOpen = ref(false);
  const peerUnread = ref(false);
  /** 伴学窗打开来源：'trigger'（AI 侦测卡点自动推）| 'user'（用户点 FAB 主动开聊）
      驱动头部状态行文案（不再固定死「看到你卡了一下」） */
  const peerEntry = ref<'trigger' | 'user'>('user');
  /** 触发频控：相邻触发的冷却窗口（ms），防止每轮对话都强制弹窗打扰 */
  const PEER_TRIGGER_COOLDOWN = 60_000;
  /** 距上次自动展开的时间戳：冷却期内仅累计未读红点，不强制展开 */
  let lastPeerAutoOpen = 0;
  /** 用户手动收起过：本轮会话内不再自动展开（尊重用户意图，仅红点提示） */
  let peerManuallyMinimized = false;
  const peerItems = ref<PeerChatItem[]>([]);
  const peerInput = ref('');
  const peerSending = ref(false);
  const peerScrollEl = ref<HTMLElement | null>(null);
  /** 伴学窗流式发送的独立 AbortController（与主对话互不干扰） */
  let peerStreamAbort: AbortController | null = null;

  /** 最近一条小启消息的策略：头部状态行展示「正在用 XX 陪你练」 */
  const peerLastStrategy = ref<string | null>(null);

  /** 头部状态行文案：随打开来源 + 最近策略动态变化 */
  const peerHeadline = computed(() => {
    const base = peerEntry.value === 'trigger'
      ? '看到你在这里卡了一下，来搭把手'
      : '随时找我聊卡点，陪你理一理';
    const s = peerLastStrategy.value ? PEER_STRATEGY_LABEL[peerLastStrategy.value] : null;
    return s ? `${base} · ${s}` : base;
  });

  function strategyLabelOf(p: PeerChatItem) {
    return p.strategy ? PEER_STRATEGY_LABEL[p.strategy] || null : null;
  }

  async function scrollPeerDown() {
    await nextTick();
    if (peerScrollEl.value) peerScrollEl.value.scrollTop = peerScrollEl.value.scrollHeight;
  }

  function openPeer() {
    peerOpen.value = true;
    peerUnread.value = false;
    scrollPeerDown();
  }

  /** 用户主动点 FAB 开聊：来源标记为 user，清掉旧的「自动触发」状态文案 */
  function openPeerByUser() {
    peerEntry.value = 'user';
    openPeer();
  }

  /** AI 侦测卡点自动推消息并展开（受频控与「手动收起过」约束） */
  function openPeerByTrigger() {
    peerEntry.value = 'trigger';
    peerUnread.value = true;
    const now = Date.now();
    const inCooldown = now - lastPeerAutoOpen < PEER_TRIGGER_COOLDOWN;
    if (!inCooldown && !peerManuallyMinimized) {
      peerOpen.value = true;
      lastPeerAutoOpen = now;
      scrollPeerDown();
    }
  }

  /** 用户手动收起：本轮会话内不再自动展开（仅红点），避免「收起又被弹开」的打扰循环；
      收起视为已读（红点清除，用户已看到内容） */
  function minimizePeer() {
    peerOpen.value = false;
    peerUnread.value = false;
    peerManuallyMinimized = true;
  }

  /** 记录伴学消息并更新「最近策略」（驱动头部状态行）；新回合消息则清除入口标记 */
  function pushPeerItem(item: PeerChatItem) {
    peerItems.value.push(item);
    if (item.role === 'peer') {
      if (item.strategy) peerLastStrategy.value = item.strategy;
    } else {
      // 用户发言后，下一条小启回复前保持「正在陪你聊」
      peerLastStrategy.value = null;
      peerEntry.value = 'user';
    }
  }

  async function sendPeerCore(text: string) {
    if (peerSending.value || !session.value) return;
    peerInput.value = '';
    pushPeerItem({ role: 'me', text, time: nowTime() });
    scrollPeerDown();
    peerSending.value = true;
    // peer skill 为 JSON 输出（无 delta）：等待期间仅显示 typing 指示器，final 后一次性上屏
    try {
      let r: Record<string, any>;
      try {
        peerStreamAbort = new AbortController();
        r = await aiTeachingAPI.streamSendPeerMessage(session.value.sessionId, text, { signal: peerStreamAbort.signal }) as unknown as Record<string, any>;
      } catch (peerError) {
        // 传输层失败且未收到任何内容：回退非流式重发；业务失败交给外层报错；
        // 用户离页触发的 abort 不重发
        const pe = peerError as { cancelled?: boolean; transport?: boolean };
        if (pe.cancelled) throw peerError;
        if (!pe.transport) throw peerError;
        r = await aiTeachingAPI.sendPeerMessage(session.value.sessionId, text) as unknown as Record<string, any>;
      } finally {
        peerStreamAbort = null;
      }
      if (r?.peerResponse) {
        pushPeerItem({
          role: 'peer',
          text: String(r.peerResponse),
          time: nowTime(),
          strategy: r.peerStrategy || null,
          followUps: Array.isArray(r.peerFollowUpQuestions)
            ? r.peerFollowUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 3)
            : [],
        });
      }
    } catch (e) {
      // 离页中止：静默丢弃
      if ((e as { cancelled?: boolean })?.cancelled) return;
      pushPeerItem({ role: 'peer', text: '这次没接上，等下再跟我说一句试试。', time: nowTime() });
    } finally {
      peerSending.value = false;
      scrollPeerDown();
    }
  }

  async function sendPeer(e?: unknown) {
    // IME 组合期守卫：拼音选词回车不发送
    const ke = e as KeyboardEvent | undefined;
    if (ke && (ke.isComposing || ke.keyCode === 229)) return;
    const t = peerInput.value.trim();
    if (!t) return;
    await sendPeerCore(t);
  }

  /** 点击小启给的追问快选：直接发送该追问 */
  async function sendPeerDirect(text: string) {
    const t = String(text || '').trim();
    if (!t || peerSending.value || !session.value) return;
    await sendPeerCore(t);
  }

  /** 重新开课时清空伴学窗（上一会话内容不残留到新开课） */
  function resetPeer() {
    peerItems.value = [];
    peerUnread.value = false;
    peerOpen.value = false;
    peerManuallyMinimized = false;
    lastPeerAutoOpen = 0;
  }

  /** 恢复会话时回填伴学历史：peer 标记消息 + assistant 内嵌 peerMessage（boot 专用） */
  function restorePeerHistory(restored: Array<{ role: 'me' | 'peer'; text: string; strategy: string | null }>) {
    if (!restored.length) return;
    peerItems.value = restored.map((m) => ({
      ...m,
      time: nowTime(),
      followUps: [],
    }));
    // 恢复入口标记为 trigger（历史里可能含自动伴学）
    peerEntry.value = 'trigger';
    // 回填最近策略（驱动头部「正在用 XX 陪你练」）
    const lastPeerStrategy = [...restored].reverse().find((m) => m.role === 'peer' && m.strategy)?.strategy;
    peerLastStrategy.value = lastPeerStrategy || null;
  }

  /** 离页/卸载时中止伴学在途流式请求 */
  function abortPeer() {
    peerStreamAbort?.abort();
  }

  return {
    peerOpen, peerUnread, peerItems, peerInput, peerSending, peerScrollEl,
    peerHeadline, strategyLabelOf, openPeerByUser, openPeerByTrigger, minimizePeer,
    pushPeerItem, sendPeer, sendPeerDirect, resetPeer, restorePeerHistory, abortPeer
  };
}
