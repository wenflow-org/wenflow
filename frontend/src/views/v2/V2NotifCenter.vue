<template>
  <div class="nc" ref="rootRef">
    <!-- 合并触发按钮：通知 + AI 任务，无边框圆形铃铛 -->
    <button
      type="button"
      class="nc__bell"
      :class="{ 'nc__bell--open': open, 'nc__bell--busy': busyItems.length }"
      :aria-label="`通知${unread > 0 ? `（${unread} 条未读）` : ''}${busyItems.length ? `，${busyItems.length} 个 AI 任务进行中` : ''}`"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <!-- AI 任务运行中：脉冲环 -->
      <span v-if="busyItems.length" class="nc__pulse-ring" aria-hidden="true"></span>
      <!-- 通知未读：红色数字角标（优先级高于脉冲环） -->
      <span v-if="unread > 0" class="nc__dot">{{ unread > 99 ? '99+' : unread }}</span>
    </button>

    <!-- 合并下拉面板 -->
    <Transition name="nc-pop">
      <div v-if="open" class="nc__panel" role="dialog" aria-label="通知与 AI 任务">
        <!-- Tab 切换 -->
        <div class="nc__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="nc__tab"
            :class="{ 'nc__tab--on': tab === 'notif' }"
            :aria-selected="tab === 'notif'"
            @click="tab = 'notif'"
          >通知<template v-if="unread"> · {{ unread }}</template></button>
          <button
            type="button"
            role="tab"
            class="nc__tab"
            :class="{ 'nc__tab--on': tab === 'tasks' }"
            :aria-selected="tab === 'tasks'"
            @click="tab = 'tasks'"
          >AI 任务<template v-if="busyItems.length"> · {{ busyItems.length }} 进行中</template></button>
        </div>

        <div class="nc__body">
          <!-- ============ 通知 Tab ============ -->
          <template v-if="tab === 'notif'">
            <div v-if="notifLoading" class="nc__empty"><span class="mk-spinner"></span> 加载中…</div>
            <template v-else-if="notifItems.length">
              <div
                v-for="n in notifItems"
                :key="n.id"
                class="nc__item"
                :class="{ 'nc__item--unread': !n.isRead }"
                :title="n.body || ''"
                @click="onNotifClick(n)"
              >
                <div class="nc__item-main">
                  <strong>{{ n.title }}</strong>
                  <span v-if="n.body" class="nc__item-body">{{ n.body }}</span>
                  <span class="nc__item-time">{{ timeAgo(n.createdAt) }}</span>
                </div>
                <span v-if="!n.isRead" class="nc__item-dot" aria-hidden="true"></span>
              </div>
              <div class="nc__foot">
                <button v-if="notifTotal > notifItems.length" type="button" class="nc__more" @click="notifLoadMore">加载更多</button>
                <button v-if="unread > 0" type="button" class="nc__readall" @click="notifReadAll">全部已读</button>
              </div>
            </template>
            <!-- 加载失败：显示错误行（区别于空态） -->
            <div v-else-if="notifError" class="nc__empty nc__empty--error">
              <span>通知加载失败</span>
              <button type="button" class="nc__retry" @click="notifLoad(true)">重试</button>
            </div>
            <div v-else class="nc__empty">
              <span class="nc__empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a2.5 2.5 0 0 0-5 0v.68C6.63 5.36 5 7.93 5 11v5l-2 2v1h18v-1l-2-2z" opacity=".85"/></svg>
              </span>
              <span>暂无通知</span>
            </div>
          </template>

          <!-- ============ AI 任务 Tab ============ -->
          <template v-else>
            <!-- 进行中任务 -->
            <div v-if="busyItems.length" class="nc__section">
              <div class="nc__section-label">
                <span class="nc__section-label-icon nc__section-label-icon--running" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                </span>
                运行中
              </div>
              <div v-for="item in busyItems" :key="item.key" class="nc__task nc__task--running">
                <div class="nc__task-bar"></div>
                <div class="nc__task-content">
                  <div class="nc__task-row">
                    <strong>{{ item.title }}</strong>
                    <span class="nc__task-status nc__task-status--running">运行中</span>
                  </div>
                  <span v-if="item.detail" class="nc__task-detail">{{ item.detail }}</span>
                  <div class="nc__task-progress"><i></i></div>
                </div>
              </div>
            </div>

            <!-- 已完成记录 -->
            <div v-if="feed.length" class="nc__section" :class="{ 'nc__section--border': busyItems.length }">
              <div class="nc__section-label">
                <span class="nc__section-label-icon nc__section-label-icon--done" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                </span>
                已完成 · {{ feed.length }}
              </div>
              <ul class="nc__feed">
                <li
                  v-for="ev in feed"
                  :key="ev.key"
                  class="nc__task nc__task--done"
                  :class="`nc__task--${ev.tone}`"
                >
                  <div class="nc__task-bar nc__task-bar--done" :class="`nc__task-bar--${ev.tone}`"></div>
                  <div class="nc__task-content">
                    <div class="nc__task-row">
                      <span class="nc__task-label">{{ ev.label }}</span>
                      <span v-if="ev.subject" class="nc__task-subject">{{ ev.subject }}</span>
                      <span class="nc__task-time">{{ ev.time }}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="nc__task-dismiss"
                    title="移除"
                    @click="feedDismiss(ev.key)"
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
                  </button>
                </li>
              </ul>
              <button v-if="feedTruncated" type="button" class="nc__more" @click="feedLoadMore">查看更早 ›</button>
            </div>

            <!-- 空态 -->
            <div v-if="!busyItems.length && !feed.length" class="nc__empty">
              <span class="nc__empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M9 7h6M9 12h6M9 17h3"/><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
              </span>
              <p>暂无 AI 任务</p>
              <span>AI 处理任务时会在这里显示进度</span>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * V2NotifCenter：通知 + AI 任务 合并中心（导航栏单铃铛入口）
 * - 铃铛：无边框圆形（初始风格），通知未读红点数字、AI 任务运行中脉冲环
 * - 面板：Tab 切换「通知」/「AI 任务」，默认落在有内容的一栏
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import api from '@/utils/api';
import { timeAgo } from '@/views/admin-redesign/live';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { getAgentLogs } from '@/api/userCustom';

interface NotifItem {
  id: string; title: string; body: string | null; kind: string;
  link: string | null; isRead: boolean; createdAt: string;
}
interface BusyItem { key: string; title: string; detail?: string }
interface FeedEvent {
  key: string; label: string; subject?: string; text: string;
  time: string; tone: 'ok' | 'err' | 'muted'; rawTime: number;
}

/* ---------- 面板状态 ---------- */
const open = ref(false);
const tab = ref<'notif' | 'tasks'>('notif');
const rootRef = ref<HTMLElement | null>(null);

/* ---------- 通知 ---------- */
const notifItems = ref<NotifItem[]>([]);
const notifTotal = ref(0);
const notifPage = ref(1);
const notifLoading = ref(false);
const notifError = ref(false);

const unread = computed(() => notifItems.value.filter((n) => !n.isRead).length);

async function notifLoad(reset = true) {
  if (reset) { notifPage.value = 1; notifItems.value = []; }
  notifLoading.value = true;
  notifError.value = false;
  try {
    const res = await api.get('/notifications', { params: { page: notifPage.value, limit: 10 } });
    const data = res.data?.data ?? {};
    const list = data.items || [];
    if (reset) notifItems.value = list;
    else notifItems.value = [...notifItems.value, ...list];
    notifTotal.value = data.total ?? notifItems.value.length;
  } catch {
    notifError.value = true;
  } finally {
    notifLoading.value = false;
  }
}
function notifLoadMore() { notifPage.value += 1; void notifLoad(false); }
async function notifReadAll() {
  try {
    await api.post('/notifications/read-all');
    notifItems.value = notifItems.value.map((n) => ({ ...n, isRead: true }));
  } catch { /* 静默 */ }
}
function onNotifClick(n: NotifItem) {
  if (!n.isRead) {
    void api.post(`/notifications/${encodeURIComponent(n.id)}/read`);
    n.isRead = true;
  }
  if (n.link) window.location.href = n.link;
}

/* ---------- AI 任务（原 V2TaskCenter 逻辑） ---------- */
const busyItems = ref<BusyItem[]>([]);
const feed = ref<FeedEvent[]>([]);
const refreshing = ref(false);
const lastSync = ref<number | null>(null);
let busy = false;
let pollTimer = 0;
let manualCursor = 0;
let feedAll: FeedEvent[] = [];
const dismissed = new Set<string>();
const PAGE_SIZE = 8;
const SLOW_MS = 60_000;
const FAST_MS = 12_000;

const feedTruncated = computed(() => feedAll.length > feed.value.length);

const AGENT_LABEL: Record<string, string> = {
  'skill:path-planning': '生成学习路径',
  'skill:goal-conversation': '目标澄清对话',
  'skill:teaching-turn': '课堂互动处理',
  'skill:peer-reinforcement': '伴学回应',
  'skill:session-wrapup': '生成课后总结',
  'skill:learner-model': '更新学习画像',
  'ai-teaching-agent': '课堂处理',
  'ai-tutor': '伴学回应',
  'system-canary': '系统自检',
  'learner-model-agent': '更新学习画像'
};
const fallbackLabel = (agentId: string) => {
  const plain = agentId.replace(/^skill:/, '');
  const short = plain.split('-').pop() || plain;
  return `AI 任务「${short}」`;
};

interface AgentLog {
  id: string; agentId: string; success: boolean; durationMs?: number;
  calledAt: string; errorCode?: string | null; metadata?: string | null;
}
function unwrapLogs(payload: unknown): AgentLog[] {
  const body = payload as { data?: { logs?: AgentLog[] } } | null;
  return Array.isArray(body?.data?.logs) ? body!.data!.logs! : [];
}
function toFeed(logs: AgentLog[]): FeedEvent[] {
  return logs
    .filter((log) => !dismissed.has(log.id || `${log.calledAt}-${log.agentId}`))
    .map((log) => {
      const meta = (() => {
        try { return log.metadata ? JSON.parse(log.metadata) : {}; }
        catch { return {}; }
      })() as Record<string, unknown>;
      const label = AGENT_LABEL[log.agentId] ?? fallbackLabel(log.agentId);
      const subject = (meta.subject || meta.taskTitle || meta.title) as string | undefined;
      return {
        key: log.id || `${log.calledAt}-${log.agentId}`,
        label, subject,
        text: subject ? `${label} · ${subject}` : label,
        time: timeAgo(log.calledAt),
        tone: log.success ? 'ok' : 'err',
        rawTime: new Date(log.calledAt).getTime() || 0
      };
    });
}
async function collectBusy(): Promise<void> {
  try {
    const paths = await learningAPI.getPaths();
    const busyPath = paths.find(
      (p) => p.generationLifecycle && p.generationLifecycle.phase !== 'ready'
        && p.generationLifecycle.status !== 'failed'
        && p.generationLifecycle.status !== 'stale'
    );
    if (busyPath) {
      const lc = busyPath.generationLifecycle as Record<string, any>;
      busyItems.value.push({
        key: `path-${busyPath.id}`,
        title: '正在生成学习路径',
        detail: lc.phase === 'stage_design' && lc.totalStages
          ? `阶段任务（${lc.completedStages ?? 0}/${lc.totalStages}）`
          : '主结构生成中'
      });
    }
  } catch { /* 忽略 */ }
  try {
    const active = await aiTeachingAPI.getActiveSessions();
    for (const s of active) {
      busyItems.value.push({
        key: `session-${s.sessionId}`,
        title: '课堂进行中',
        detail: s.topic || s.subject || undefined
      });
    }
  } catch { /* 忽略 */ }
}
async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  const prevBusy = busy;
  const prevCount = busyItems.value.length;
  busyItems.value = [];
  await Promise.allSettled([collectBusy(), feedRefresh()]);
  busy = busyItems.value.length > 0;
  if (busy !== prevBusy && !busy && prevCount > 0) await feedRefresh();
  lastSync.value = Date.now();
  refreshing.value = false;
}
async function feedRefresh() {
  try {
    const res = await getAgentLogs({ limit: 30, includeSystem: false });
    feedAll = toFeed(unwrapLogs(res));
    feedApplyWindow();
  } catch { /* 静默 */ }
}
function feedApplyWindow() { feed.value = feedAll.slice(0, PAGE_SIZE); }
function feedLoadMore() {
  manualCursor += PAGE_SIZE;
  feed.value = feedAll.slice(0, PAGE_SIZE + manualCursor);
}
function feedDismiss(key: string) {
  dismissed.add(key);
  feedAll = feedAll.filter((f) => f.key !== key);
  feedApplyWindow();
}
function schedulePoll() {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollOnce, busy ? FAST_MS : SLOW_MS);
}
async function pollOnce() {
  if (document.hidden) { schedulePoll(); return; }
  await refresh();
  schedulePoll();
}

/* ---------- 交互 ---------- */
function toggle() {
  open.value = !open.value;
  if (open.value) {
    // 默认落有内容的一栏；都空则通知
    tab.value = busyItems.value.length || feed.value.length ? 'tasks' : 'notif';
    if (!notifItems.value.length) void notifLoad();
  }
}
function onDocClick(e: MouseEvent) {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
onMounted(() => {
  void refresh();
  schedulePoll();
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.clearTimeout(pollTimer);
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
.nc { position: relative; flex-shrink: 0; }

/* ================= 铃铛按钮（无边框圆形，初始风格） ================= */
.nc__bell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--muted, #5b6577);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.nc__bell:hover { background: rgba(52, 120, 246, 0.08); color: var(--blue-deep, #1f57cc); }
.nc__bell--open { background: rgba(52, 120, 246, 0.1); color: var(--blue-deep, #1f57cc); }
.nc__bell--busy { color: var(--blue, #3478f6); }

/* 通知未读角标 */
.nc__dot {
  position: absolute;
  top: 3px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--surface, #fff);
}

/* AI 任务运行中脉冲环 */
.nc__pulse-ring {
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--blue, #3478f6) 60%, transparent);
  animation: nc-pulse 1.6s ease-out infinite;
  pointer-events: none;
}
@keyframes nc-pulse {
  0% { transform: scale(0.9); opacity: 0.9; }
  70% { transform: scale(1.35); opacity: 0; }
  100% { transform: scale(1.35); opacity: 0; }
}

/* ================= 面板 ================= */
.nc__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: min(360px, calc(100vw - 32px));
  border-radius: 14px;
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e9f4);
  box-shadow: 0 16px 40px rgba(23, 32, 51, 0.14);
  overflow: hidden;
  z-index: 60;
  transform-origin: top right;
}
.nc-pop-enter-active, .nc-pop-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.nc-pop-enter-from, .nc-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.97); }

/* Tab 切换 */
.nc__tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--line, #e3e9f4);
}
.nc__tab {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted, #5b6577);
  padding: 11px 8px;
  cursor: pointer;
  position: relative;
  transition: color 0.15s ease;
}
.nc__tab:hover { color: var(--blue-deep, #1f57cc); }
.nc__tab--on { color: var(--blue-deep, #1f57cc); }
.nc__tab--on::after {
  content: '';
  position: absolute;
  left: 20%; right: 20%; bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--blue, #3478f6);
}

.nc__body { max-height: min(420px, 60vh); overflow-y: auto; }

/* 通知列表 */
.nc__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 14px;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--line, #e3e9f4) 60%, transparent);
  transition: background 0.13s ease;
}
.nc__item:hover { background: color-mix(in srgb, var(--blue, #3478f6) 5%, transparent); }
.nc__item--unread { background: color-mix(in srgb, var(--blue, #3478f6) 4%, transparent); }
.nc__item-main { display: grid; gap: 2px; min-width: 0; flex: 1; }
.nc__item-main strong { font-size: 13.5px; font-weight: 700; color: var(--ink, #172033); }
.nc__item-body {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.nc__item-time { font-size: 11px; color: var(--faint, #8492ab); }
.nc__item-dot {
  width: 7px; height: 7px; margin-top: 6px;
  border-radius: 50%;
  background: var(--blue, #3478f6);
  flex-shrink: 0;
}

/* 面板底部操作行 */
.nc__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
}
.nc__more, .nc__readall {
  border: 0;
  background: transparent;
  color: var(--blue-deep, #1f57cc);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.nc__more:hover, .nc__readall:hover { background: rgba(52, 120, 246, 0.08); }

/* AI 任务 */
.nc__section { padding: 10px 8px; }
.nc__section--border { border-top: 1px solid var(--line, #e3e9f4); }
.nc__section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--faint, #8492ab);
}
.nc__section-label-icon { display: grid; place-items: center; }
.nc__section-label-icon--running { color: var(--blue, #3478f6); }
.nc__section-label-icon--done { color: #1d7a4c; }
.nc__task {
  display: flex;
  gap: 10px;
  padding: 9px 8px;
  border-radius: 10px;
  align-items: center;
}
.nc__task--running { background: color-mix(in srgb, var(--blue, #3478f6) 5%, transparent); }
.nc__task--done { background: transparent; }
.nc__task:hover { background: color-mix(in srgb, var(--ink, #172033) 5%, transparent); }
.nc__task-bar { width: 3px; align-self: stretch; border-radius: 3px; background: var(--blue, #3478f6); }
.nc__task-bar--done { background: color-mix(in srgb, var(--ink, #172033) 22%, transparent); }
.nc__task-bar--ok { background: #2ea36b; }
.nc__task-bar--err { background: #e5484d; }
.nc__task-bar--muted { background: color-mix(in srgb, var(--ink, #172033) 22%, transparent); }
.nc__task-content { flex: 1; min-width: 0; display: grid; gap: 2px; }
.nc__task-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.nc__task-row strong { font-size: 13px; font-weight: 700; color: var(--ink, #172033); }
.nc__task-label { font-size: 13px; font-weight: 600; color: var(--ink, #172033); }
.nc__task-subject {
  font-size: 12px;
  color: var(--muted, #5b6577);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nc__task-time { margin-left: auto; font-size: 11px; color: var(--faint, #8492ab); flex-shrink: 0; }
.nc__task-status {
  font-size: 10.5px; font-weight: 800;
  color: var(--blue, #3478f6);
  background: color-mix(in srgb, var(--blue, #3478f6) 12%, transparent);
  padding: 2px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
.nc__task-detail { font-size: 12px; color: var(--muted, #5b6577); }
.nc__task-progress {
  height: 3px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--blue, #3478f6) 14%, transparent);
  overflow: hidden;
}
.nc__task-progress i {
  display: block; height: 100%; width: 38%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--blue, #3478f6), color-mix(in srgb, var(--blue, #3478f6) 50%, #8d6bff));
  animation: nc-slide 1.3s ease-in-out infinite;
}
@keyframes nc-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}
.nc__task-dismiss {
  border: 0;
  background: transparent;
  color: var(--faint, #8492ab);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  flex-shrink: 0;
}
.nc__task-dismiss:hover { background: rgba(229, 72, 77, 0.1); color: #c0454a; }
.nc__feed { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }

/* 空态 / 错误 */
.nc__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 34px 16px;
  color: var(--faint, #8492ab);
  font-size: 13px;
  text-align: center;
}
.nc__empty p { margin: 0; font-weight: 700; color: var(--muted, #5b6577); }
.nc__empty-icon { font-size: 22px; }
.nc__empty--error { color: var(--muted, #5b6577); }
.nc__retry {
  font: inherit; font-size: 12px; font-weight: 700;
  color: var(--blue-deep, #1f57cc);
  background: rgba(52, 120, 246, 0.08);
  border: 1px solid rgba(52, 120, 246, 0.35);
  border-radius: 999px;
  padding: 5px 14px;
  cursor: pointer;
}
.nc__retry:hover { background: rgba(52, 120, 246, 0.14); }

/* ================= 暗色模式 ================= */
[data-theme='dark'] .nc__bell { color: var(--muted, #9aa8bf); }
[data-theme='dark'] .nc__bell:hover { background: rgba(77, 139, 248, 0.12); color: var(--blue-deep, #4d8bf8); }
[data-theme='dark'] .nc__bell--open { background: rgba(77, 139, 248, 0.16); color: var(--blue-deep, #4d8bf8); }
[data-theme='dark'] .nc__bell--busy { color: var(--blue, #4d8bf8); }
[data-theme='dark'] .nc__panel {
  background: var(--surface, #182230);
  border-color: var(--line, #2a3648);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.2);
}
[data-theme='dark'] .nc__item:hover { background: color-mix(in srgb, var(--ink, #e6edf7) 5%, transparent); }
[data-theme='dark'] .nc__item--unread { background: color-mix(in srgb, var(--blue, #4d8bf8) 8%, transparent); }
[data-theme='dark'] .nc__task--running { background: color-mix(in srgb, var(--blue, #4d8bf8) 10%, transparent); }
[data-theme='dark'] .nc__task:hover { background: color-mix(in srgb, var(--ink, #e6edf7) 6%, transparent); }
[data-theme='dark'] .nc__more:hover, [data-theme='dark'] .nc__readall:hover { background: rgba(77, 139, 248, 0.14); }
[data-theme='dark'] .nc__retry { color: var(--blue-deep, #4d8bf8); background: rgba(77, 139, 248, 0.12); border-color: rgba(77, 139, 248, 0.4); }
[data-theme='dark'] .nc__tab { color: var(--muted, #9aa8bf); }
[data-theme='dark'] .nc__tab:hover, [data-theme='dark'] .nc__tab--on { color: var(--blue-deep, #4d8bf8); }
[data-theme='dark'] .nc__dot { box-shadow: 0 0 0 2px var(--surface, #182230); }
</style>
