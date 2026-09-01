/**
 * 目标规划会话状态管理：由问流后端 goal-conversation skill 驱动。
 * 只负责交互与展示：会话由后端真实 skill 处理，本地仅做视图恢复（localStorage），不新增任何落库逻辑。
 */
import { computed, reactive, ref } from 'vue';
import {
  startGoalConversation,
  replyGoalConversation,
  getGoalConversation,
  regenerateGoalConversation,
  streamStartGoalConversation,
  streamReplyGoalConversation,
  streamRegenerateGoalConversation,
  type GoalConversationEnvelope,
  type GoalUnderstanding
} from '@/api/goalConversation';
import { useInteractionMeta, type InteractionMeta } from '@/composables/useInteractionMeta';

export interface LiveMessage {
  role: 'user' | 'ai';
  content: string;
  time: string;
  failed?: boolean;
  id?: string;
}

export interface LiveField {
  key: string;
  label: string;
  value: string;
  status: 'done' | 'todo';
  fresh?: boolean;
}

const CID_KEY = 'v2_goal_cid';
const MSG_KEY = 'v2_goal_msgs';

/**
 * 会话代次（generation token）：reset/resetView 自增。
 * 进行中的流式请求（run/resumeById）在响应落地前校验代次，
 * 不一致说明会话已被重置（清空重聊/规划新目标），过期响应整体丢弃，
 * 避免在途 final 把已清空的 conversationId/messages/localStorage 写回。
 */
let generation = 0;
/** 当前在途流式请求的 AbortController（stop() 中止生成用） */
let currentAbort: AbortController | null = null;
/** 用户主动点击「停止生成」：中止后置 failed 提供重试入口（区别于离页中止的静默） */
let userStopped = false;

const INVALID_PATTERN = /待确认|待收集|未知|尚未|不确定|暂无|没有发现|未提供|n\/?a/i;

function pickText(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      if (t && !INVALID_PATTERN.test(t)) return t;
    }
  }
  return '';
}

function toList(input: unknown): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t && !INVALID_PATTERN.test(t) && !out.includes(t)) out.push(t);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const t = pickText(obj.title, obj.name, obj.stage, obj.label, obj.summary, obj.description);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatMsgTime(raw?: string): string {
  if (!raw) return nowTime();
  // 后端可能回 ISO；统一成 HH:mm
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime()) && (raw.includes('T') || raw.includes('-'))) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (/^\d{1,2}:\d{2}/.test(raw)) return raw.slice(0, 5);
  return raw;
}

const conversationId = ref('');
const messages = ref<LiveMessage[]>([]);
/** 流式渐进渲染：SSE delta 累积的原始模型文本（goal skill 为 JSON 输出，final 到达前展示此文本；到达后以官方消息为准） */
const streamingText = ref('');
let messageSeq = 0;
const pushMessage = (m: LiveMessage): LiveMessage => {
  const withId: LiveMessage = { ...m, id: m.id ?? `m_${Date.now().toString(36)}_${++messageSeq}` };
  messages.value.push(withId);
  return withId;
};
/** 交互特征采集器（认知负荷量测 · 前端情报层），暴露给页面做输入埋点 */
const metaTracker = useInteractionMeta();
const stage = ref<'understanding' | 'proposing' | 'ready' | 'completed' | ''>('');
const confidence = ref(0);
const isCompleted = ref(false);
const understanding = ref<GoalUnderstanding>({});
const collected = ref<Record<string, unknown>>({});
const quickReplies = ref<Array<{ text: string; icon?: string }>>([]);
const confirmedProposal = ref<Record<string, unknown> | null>(null);
const learningPath = ref<{ id: string; status?: string } | null>(null);
const sending = ref(false);
const failed = ref<'start' | 'reply' | 'confirm' | 'supplement' | 'resume' | ''>('');
const lastPayload = ref('');
const freshKeys = ref<string[]>([]);
const started = ref(false);
/** 快捷回复操作提示：每个会话只展示一次（首次出现快捷回复时） */
const quickReplyHintShown = ref(false);

const FIELD_DEFS: Array<{ key: string; label: string; read: (u: GoalUnderstanding, c: Record<string, unknown>) => string }> = [
  { key: 'real_problem', label: '想解决的问题', read: (u, c) => pickText(u.real_problem, u.pain_points, u.surface_goal, c.real_problem, c.problem) },
  { key: 'motivation', label: '学习动机', read: (u, c) => pickText(u.motivation, c.motivation) },
  { key: 'current_level', label: '当前水平', read: (u, c) => pickText(u.background?.current_level, u.current_baseline?.level, c.level) },
  { key: 'pain_points', label: '过往卡点', read: (u, c) => pickText(u.current_baseline?.evidence, c.obstacle) },
  { key: 'time_horizon', label: '期望周期', read: (u, c) => pickText(u.success_criteria?.time_window, u.background?.expected_time, u.available_resources?.time_horizon, c.expected_time) },
  { key: 'time_per_session', label: '可用时间', read: (u, c) => pickText(u.background?.available_time, u.available_resources?.time_per_session, u.available_resources?.time_budget, c.timePerDay) },
  { key: 'urgency', label: '紧迫程度', read: (u, c) => pickText(u.urgency, c.urgency) },
  { key: 'success_criteria', label: '成功标准', read: (u) => pickText(u.success_criteria?.observable_result, u.success_criteria?.acceptance_check) }
];

const fields = computed<LiveField[]>(() =>
  FIELD_DEFS.map((def) => {
    const value = def.read(understanding.value, collected.value);
    return {
      key: def.key,
      label: def.label,
      value,
      status: value ? 'done' : 'todo',
      fresh: freshKeys.value.includes(def.key)
    };
  })
);

const filledCount = computed(() => fields.value.filter((f) => f.status === 'done').length);

const stageIndex = computed(() => {
  if (stage.value === 'completed' || stage.value === 'ready' || isCompleted.value) return 3;
  if (stage.value === 'proposing') return 2;
  return 1;
});

const proposal = computed(() => {
  const cp = confirmedProposal.value;
  if (!cp) return null;
  const problem = pickText(
    cp.real_problem, cp.problem,
    understanding.value.real_problem, understanding.value.pain_points, understanding.value.surface_goal
  );
  const outcome = pickText(
    cp.first_deliverable, cp.expected_outcome, cp.outcome,
    understanding.value.success_criteria?.observable_result
  );
  const stages = toList(cp.key_stages ?? cp.stages ?? cp.outline).slice(0, 5);
  const skip = toList(cp.out_of_scope ?? cp.not_now ?? cp.exclude).slice(0, 6);
  if (!problem && !outcome && stages.length === 0) return null;
  return { problem, outcome, stages, skip };
});

function applyEnvelope(env: GoalConversationEnvelope, opts: { userText?: string; replaceMessages?: boolean } = {}, gen = generation) {
  // 会话代次不一致：会话已被重置，丢弃过期响应
  if (gen !== generation) return;
  // final 到达：流式气泡完成，以官方消息为准
  streamingText.value = '';
  const core = env.internal?.core;
  const ext = env.internal?.ext?.goalConversation;

  // AI 回复落地：更新交互特征采集的"上一条回复时间"锚点
  metaTracker.markAssistantLanded();

  if (core?.conversationId) {
    conversationId.value = core.conversationId;
    localStorage.setItem(CID_KEY, core.conversationId);
  }
  stage.value = core?.stage ?? '';
  confidence.value = Math.round((core?.confidence ?? 0) * 100);
  isCompleted.value = core?.isCompleted === true;
  learningPath.value = core?.learningPath ?? null;

  const prevValues = new Map(fields.value.map((f) => [f.key, f.value]));
  if (ext?.understanding) understanding.value = ext.understanding;
  if (ext?.collected) collected.value = ext.collected;
  confirmedProposal.value = ext?.confirmedProposal ?? null;
  quickReplies.value = env.renderHints?.quickReplies ?? ext?.quickReplies ?? [];

  // 新收录字段高亮
  const fresh: string[] = [];
  for (const f of fields.value) {
    if (f.status === 'done' && prevValues.get(f.key) !== f.value) fresh.push(f.key);
  }
  freshKeys.value = fresh;

  // 消息：优先使用后端返回的完整历史
  if (Array.isArray(env.meta?.messages) && env.meta.messages.length > 0) {
    messages.value = env.meta.messages.map((m) => ({
      role: m.role,
      content: m.content,
      time: formatMsgTime(m.time),
      id: `h_${Math.random().toString(36).slice(2, 10)}`
    }));
  } else {
    // 乐观插入后可能已有用户气泡，避免重复
    if (opts.userText) {
      const last = messages.value[messages.value.length - 1];
      if (!(last?.role === 'user' && last.content === opts.userText)) {
        pushMessage({ role: 'user', content: opts.userText, time: nowTime() });
      }
    }
    if (env.userVisible) pushMessage({ role: 'ai', content: env.userVisible, time: nowTime() });
  }
  localStorage.setItem(MSG_KEY, JSON.stringify(messages.value.slice(-60)));
  started.value = true;
}

async function run(action: 'start' | 'reply' | 'confirm' | 'supplement', text: string, meta?: InteractionMeta) {
  const gen = generation;
  sending.value = true;
  failed.value = '';
  lastPayload.value = text;
  // 流式渐进渲染：SSE delta 累积实时上屏；goal skill 为 JSON 输出（无结构化 delta），
  // 展示原始模型文本作为「正在思考」的可见反馈，final 到达后以官方消息为准替换。
  streamingText.value = '';
  userStopped = false;
  const onDelta = (t: string) => {
    if (gen === generation) streamingText.value += t;
  };
  const abort = new AbortController();
  currentAbort = abort;
  try {
    let env: GoalConversationEnvelope | null = null;
    try {
      if (action === 'start') {
        env = await streamStartGoalConversation(text, { meta }, { onDelta, signal: abort.signal });
      } else if (action === 'confirm') {
        env = await streamReplyGoalConversation(conversationId.value, text, { confirmProposal: true }, { onDelta, signal: abort.signal });
      } else if (action === 'supplement') {
        env = await streamRegenerateGoalConversation(conversationId.value, text, { onDelta, signal: abort.signal });
      } else {
        env = await streamReplyGoalConversation(conversationId.value, text, { meta }, { onDelta, signal: abort.signal });
      }
    } catch (streamError) {
      const e = streamError as { cancelled?: boolean; transport?: boolean; recoveryEnvelope?: GoalConversationEnvelope };
      // 用户主动停止：置 failed 提供重试入口（流式部分保留在 streamingText）
      if (e.cancelled && userStopped) {
        failed.value = action;
        if (action !== 'start' && action !== 'supplement') {
          pushMessage({ role: 'ai', content: '已停止生成。可以点下方「重试」继续，或直接输入新内容。', time: nowTime(), failed: true });
        }
        throw streamError;
      }
      // 离页中止：不重发也不弹重试
      if (e.cancelled) throw streamError;
      if (e.recoveryEnvelope) {
        // 422 恢复信封：模型部分产出可用，应用后视为本轮已处理
        applyEnvelope(e.recoveryEnvelope, { userText: action === 'supplement' ? '' : text }, gen);
      } else if (!e.transport) {
        throw streamError;
      } else {
        // 传输层失败且未收到任何内容：回退非流式重发
        if (action === 'start') {
          env = await startGoalConversation(text, { meta });
        } else if (action === 'confirm') {
          env = await replyGoalConversation(conversationId.value, text, { confirmProposal: true });
        } else if (action === 'supplement') {
          env = await regenerateGoalConversation(conversationId.value, text);
        } else {
          env = await replyGoalConversation(conversationId.value, text, { meta });
        }
      }
    }
    if (env) {
      applyEnvelope(env, { userText: action === 'supplement' ? '' : text }, gen);
    }
  } catch (e) {
    // 会话已被重置：过期失败不写入状态
    if (gen !== generation) return;
    // 非流式回退请求的 422 恢复信封：axios 拦截器把信封放在 error.response.data.data，
    // 与 SSE 路径的 recoveryEnvelope 对齐处理（模型部分产出可用，应用后视为本轮已处理）
    const axiosErr = e as { status?: number; response?: { data?: { error?: string; data?: GoalConversationEnvelope } } };
    const axiosRecovery = axiosErr?.response?.data?.data;
    if (axiosRecovery && (axiosErr.response?.data?.error === 'STRUCTURED_OUTPUT_INVALID' || axiosErr.status === 422)) {
      applyEnvelope(axiosRecovery, { userText: action === 'supplement' ? '' : text }, gen);
      return;
    }
    failed.value = action;
    if (action !== 'start' && action !== 'supplement') {
      pushMessage({ role: 'ai', content: '这次没有成功处理你的回答，点下方「重试」继续。', time: nowTime(), failed: true });
    }
    throw e;
  } finally {
    // 仅当前代次负责收尾 sending，避免过期 run 的 finally 打断新会话的进行中状态
    if (gen === generation) {
      sending.value = false;
      streamingText.value = '';
    }
    if (currentAbort === abort) currentAbort = null;
  }
}
/** 中止当前流式生成：SSE 连接断开，已流出的部分保留在 streamingText（可继续/重试） */
function stop() {
  userStopped = true;
  currentAbort?.abort();
  currentAbort = null;
}

async function send(text: string, skipUserPush = false) {
  const t = text.trim();
  if (!t || sending.value) return;
  // 先上屏，再等 AI（与 supplement 一致）；skipUserPush=true 时调用方已替换消息（内联编辑）
  if (!skipUserPush) pushMessage({ role: 'user', content: t, time: nowTime() });
  started.value = true;
  localStorage.setItem(MSG_KEY, JSON.stringify(messages.value.slice(-60)));
  const meta = metaTracker.collect(t);
  if (!conversationId.value) {
    await run('start', t, meta);
  } else {
    await run('reply', t, meta);
  }
}

async function confirm() {
  if (!conversationId.value || sending.value) return;
  const label = '确认并生成路径';
  pushMessage({ role: 'user', content: label, time: nowTime() });
  localStorage.setItem(MSG_KEY, JSON.stringify(messages.value.slice(-60)));
  await run('confirm', label);
}

async function supplement(text: string) {
  const t = text.trim();
  if (!conversationId.value || !t || sending.value) return;
  pushMessage({ role: 'user', content: t, time: nowTime() });
  await run('supplement', t);
}

async function retry() {
  const action = failed.value;
  if (!action) return;
  if (action === 'resume') {
    await resume();
    return;
  }
  // 去掉失败提示消息再重试
  messages.value = messages.value.filter((m) => !m.failed);
  await run(action === 'start' ? 'start' : action === 'confirm' ? 'confirm' : action === 'supplement' ? 'supplement' : 'reply', lastPayload.value);
}

async function resume(): Promise<boolean> {
  const cid = localStorage.getItem(CID_KEY);
  if (!cid) return false;
  return resumeById(cid);
}

async function resumeById(cid: string): Promise<boolean> {
  const gen = generation;
  failed.value = '';
  sending.value = true;
  try {
    const env = await getGoalConversation(cid);
    applyEnvelope(env, { replaceMessages: true }, gen);
    if (gen === generation && messages.value.length === 0) {
      const cached = localStorage.getItem(MSG_KEY);
      if (cached) messages.value = JSON.parse(cached) as LiveMessage[];
    }
    return true;
  } catch (e) {
    if (gen === generation) failed.value = 'resume';
    return false;
  } finally {
    if (gen === generation) sending.value = false;
  }
}

function hasSession(): boolean {
  return !!localStorage.getItem(CID_KEY);
}

function reset(clearStorage = true) {
  // 自增代次：作废所有在途请求的响应，防止其把已清空的状态写回
  generation += 1;
  currentAbort?.abort();
  currentAbort = null;
  userStopped = false;
  sending.value = false;
  streamingText.value = '';
  conversationId.value = '';
  messages.value = [];
  stage.value = '';
  confidence.value = 0;
  isCompleted.value = false;
  understanding.value = {};
  collected.value = {};
  quickReplies.value = [];
  confirmedProposal.value = null;
  learningPath.value = null;
  freshKeys.value = [];
  failed.value = '';
  started.value = false;
  quickReplyHintShown.value = false;
  if (clearStorage) {
    localStorage.removeItem(CID_KEY);
    localStorage.removeItem(MSG_KEY);
  }
}

/**
 * 仅清内存状态、保留本地恢复入口：
 * SPA 内从旧会话切换回来时调用，避免模块级残留的上一轮对话直接上屏；
 * localStorage 保留，初始页仍可「继续上次的规划」恢复。
 */
function resetView() {
  reset(false);
}

export function useGoalLive() {
  return reactive({
    conversationId,
    messages,
    stage,
    stageIndex,
    confidence,
    isCompleted,
    fields,
    filledCount,
    totalFields: FIELD_DEFS.length,
    quickReplies,
    proposal,
    learningPath,
    sending,
    streamingText,
    failed,
    started,
    quickReplyHintShown,
    meta: metaTracker,
    send,
    confirm,
    supplement,
    retry,
    resume,
    resumeById,
    hasSession,
    reset,
    resetView,
    stop
  });
}
