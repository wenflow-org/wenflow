<template>
  <div class="tc" ref="rootRef">
    <!-- 导航栏触发按钮 -->
    <button
      type="button"
      class="tc__btn"
      :class="{
        'tc__btn--busy': busyItems.length,
        'tc__btn--open': open,
        'tc__btn--has-feed': !busyItems.length && feed.length
      }"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      :title="busyItems.length ? `${busyItems.length} 个任务进行中` : 'AI 任务进度'"
      @click="open = !open"
    >
      <!-- 有任务：活动图标 + 脉冲环 -->
      <span v-if="busyItems.length" class="tc__btn-icon tc__btn-icon--active" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>
        <span class="tc__pulse-ring" aria-hidden="true"></span>
      </span>
      <!-- 无任务但有历史：静谧圆点图标 -->
      <span v-else-if="feed.length" class="tc__btn-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 7h6M9 12h6M9 17h3"/><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        <span class="tc__btn-dot" aria-hidden="true"></span>
      </span>
      <!-- 完全空：灰色图标 -->
      <span v-else class="tc__btn-icon tc__btn-icon--idle" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 7h6M9 12h6M9 17h3"/><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      </span>
    </button>

    <!-- 下拉面板 -->
    <Transition name="tc-panel">
      <div v-if="open" class="tc__panel" role="menu">
        <!-- 面板标题栏 -->
        <header class="tc__head">
          <div class="tc__head-left">
            <span class="tc__head-dot" :class="{ 'tc__head-dot--on': busyItems.length }"></span>
            <strong>AI 任务</strong>
            <span v-if="busyItems.length" class="tc__head-count">{{ busyItems.length }} 进行中</span>
          </div>
          <button
            v-if="feed.length"
            type="button"
            class="tc__clear"
            title="清除已完成"
            @click="clearFeed"
          >
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            清除
          </button>
        </header>

        <div class="tc__body">
          <!-- 进行中任务 -->
          <div v-if="busyItems.length" class="tc__section">
            <div class="tc__section-label">
              <span class="tc__section-label-icon tc__section-label-icon--running" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
              </span>
              运行中
            </div>
            <div v-for="item in busyItems" :key="item.key" class="tc__task tc__task--running">
              <div class="tc__task-bar"></div>
              <div class="tc__task-content">
                <div class="tc__task-row">
                  <strong>{{ item.title }}</strong>
                  <span class="tc__task-status tc__task-status--running">运行中</span>
                </div>
                <span v-if="item.detail" class="tc__task-detail">{{ item.detail }}</span>
                <div class="tc__task-progress"><i></i></div>
              </div>
            </div>
          </div>

          <!-- 已完成记录 -->
          <div v-if="feed.length" class="tc__section" :class="{ 'tc__section--border': busyItems.length }">
            <div class="tc__section-label">
              <span class="tc__section-label-icon tc__section-label-icon--done" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
              </span>
              已完成 · {{ feed.length }}
            </div>
            <ul class="tc__feed">
              <li
                v-for="ev in feed"
                :key="ev.key"
                class="tc__task tc__task--done"
                :class="`tc__task--${ev.tone}`"
              >
                <div class="tc__task-bar tc__task-bar--done" :class="`tc__task-bar--${ev.tone}`"></div>
                <div class="tc__task-content">
                  <div class="tc__task-row">
                    <span class="tc__task-label">{{ ev.label }}</span>
                    <span v-if="ev.subject" class="tc__task-subject">{{ ev.subject }}</span>
                    <span class="tc__task-time">{{ ev.time }}</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="tc__task-dismiss"
                  title="移除"
                  @click="dismissFeed(ev.key)"
                >
                  <svg viewBox="0 0 24 24" width="11" height="11"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
                </button>
              </li>
            </ul>
            <button v-if="feedTruncated" type="button" class="tc__more" @click="loadMore">查看更早 ›</button>
          </div>

          <!-- 空态 -->
          <div v-if="!busyItems.length && !feed.length" class="tc__empty">
            <span class="tc__empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M9 7h6M9 12h6M9 17h3"/><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            </span>
            <p>暂无 AI 任务</p>
            <span>AI 处理任务时会在这里显示进度</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * V2TaskCenter：导航栏 AI 任务进度中心
 * 三种状态：运行中（活跃图标+脉冲）、已完成（带圆点提示）、空闲（灰色图标）
 * 支持：单条清除、全部清除、展开历史
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { getAgentLogs } from '@/api/userCustom';

interface BusyItem { key: string; title: string; detail?: string }
interface FeedEvent {
  key: string; label: string; subject?: string; text: string;
  time: string; tone: 'ok' | 'err' | 'muted'; rawTime: number
}

const busyItems = ref<BusyItem[]>([]);
const feed = ref<FeedEvent[]>([]);
const refreshing = ref(false);
const lastSync = ref<number | null>(null);
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
let busy = false;
let pollTimer = 0;
let manualCursor = 0;
let feedAll: FeedEvent[] = [];
/** 被用户手动移除的 key，下次刷新不恢复 */
const dismissed = new Set<string>();
const PAGE_SIZE = 8;
const SLOW_MS = 60_000;
const FAST_MS = 12_000;

const feedTruncated = computed(() => feedAll.length > feed.value.length);

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return '刚刚';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 30) return `${d} 天前`;
  return new Date(t).toLocaleDateString('zh-CN');
}

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
  await Promise.allSettled([collectBusy(), refreshFeed()]);

  busy = busyItems.value.length > 0;
  if (busy !== prevBusy && !busy && prevCount > 0) await refreshFeed();
  lastSync.value = Date.now();
  refreshing.value = false;
}

async function refreshFeed() {
  try {
    const res = await getAgentLogs({ limit: 30, includeSystem: false });
    feedAll = toFeed(unwrapLogs(res));
    applyFeedWindow();
  } catch { /* 静默 */ }
}

function applyFeedWindow() {
  feed.value = feedAll.slice(0, PAGE_SIZE);
}

function loadMore() {
  manualCursor += PAGE_SIZE;
  feed.value = feedAll.slice(0, PAGE_SIZE + manualCursor);
}

/** 单条移除 */
function dismissFeed(key: string) {
  dismissed.add(key);
  feedAll = feedAll.filter((f) => f.key !== key);
  applyFeedWindow();
}

/** 全部清除 */
function clearFeed() {
  feedAll.forEach((f) => dismissed.add(f.key));
  feedAll = [];
  feed.value = [];
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

/* 点击外部关闭 */
function onDocClick(e: MouseEvent) {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(e.target as Node)) open.value = false;
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
.tc {
  position: relative;
  flex-shrink: 0;
}

/* ================= 触发按钮 ================= */
.tc__btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--line, #e3e9f4);
  background: var(--surface, #fff);
  cursor: pointer;
  transition: all 0.15s;
}
.tc__btn:hover {
  border-color: color-mix(in srgb, var(--blue, #3478f6) 30%, var(--line, #e3e9f4));
  background: color-mix(in srgb, var(--blue, #3478f6) 5%, transparent);
}
.tc__btn--open {
  border-color: color-mix(in srgb, var(--blue, #3478f6) 40%, transparent);
  background: color-mix(in srgb, var(--blue, #3478f6) 8%, transparent);
}

/* 图标颜色随状态变化 */
.tc__btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--faint, #67758f);
  position: relative;
}
.tc__btn-icon--idle {
  color: var(--faint, #67758f);
  opacity: 0.5;
}
.tc__btn-icon--active {
  color: var(--blue, #3478f6);
}
.tc__btn--busy .tc__btn-icon {
  color: var(--blue, #3478f6);
}
.tc__btn--has-feed .tc__btn-icon {
  color: var(--muted, #5b6577);
}

/* 有任务时的脉冲环 */
.tc__pulse-ring {
  position: absolute;
  inset: -2px;
  border-radius: 12px;
  border: 2px solid var(--blue, #3478f6);
  animation: tcRing 1.8s ease-out infinite;
  pointer-events: none;
}
@keyframes tcRing {
  0% { opacity: 0.6; transform: scale(0.95); }
  100% { opacity: 0; transform: scale(1.15); }
}

/* 有历史但无任务时的小圆点 */
.tc__btn-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--blue, #3478f6);
}

/* ================= 下拉面板 ================= */
.tc__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  /* 用 rem 让 4K 下随 zoom 缩放保持可读比例 */
  width: 22rem;
  min-width: 340px;
  max-width: 420px;
  max-height: 32rem;
  border-radius: 16px;
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e9f4);
  box-shadow: 0 20px 48px rgba(23, 32, 51, 0.16), 0 4px 12px rgba(23, 32, 51, 0.06);
  z-index: 60;
  transform-origin: top right;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 面板标题栏 */
.tc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line, #e3e9f4);
  background: color-mix(in srgb, var(--ink, #172033) 1.5%, transparent);
  flex-shrink: 0;
}
.tc__head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tc__head-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--faint, #67758f);
  transition: background 0.3s;
}
.tc__head-dot--on {
  background: var(--green, #1e9e58);
  animation: tcBreathe 1.8s ease-in-out infinite;
}
@keyframes tcBreathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.tc__head strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink, #172033);
}
.tc__head-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--green, #1e9e58);
  background: color-mix(in srgb, var(--green, #1e9e58) 10%, transparent);
  padding: 1px 7px;
  border-radius: 6px;
}
.tc__clear {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 11.5px;
  color: var(--faint, #67758f);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.12s;
}
.tc__clear:hover {
  color: var(--red, #ef7578);
  background: color-mix(in srgb, var(--red, #ef7578) 8%, transparent);
}

/* 面板主体 */
.tc__body {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

/* ================= 分组 ================= */
.tc__section {
  padding: 6px 0;
}
.tc__section--border {
  border-top: 1px solid var(--line, #e3e9f4);
}
.tc__section-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted, #5b6577);
  padding: 8px 16px 4px;
}
.tc__section-label-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tc__section-label-icon--running {
  color: var(--blue, #3478f6);
}
.tc__section-label-icon--done {
  color: var(--green, #1e9e58);
}

/* ================= 任务条目 ================= */
.tc__task {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 0 8px 4px;
  border-radius: 10px;
  transition: background 0.12s;
  position: relative;
}
.tc__task:hover {
  background: color-mix(in srgb, var(--ink, #172033) 2.5%, transparent);
}

/* 左侧指示条 */
.tc__task-bar {
  width: 3px;
  flex-shrink: 0;
  border-radius: 3px 0 0 3px;
  background: var(--blue, #3478f6);
  animation: tcBarGlow 2s ease-in-out infinite;
}
@keyframes tcBarGlow {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
.tc__task-bar--done {
  animation: none;
  opacity: 0.35;
}
.tc__task-bar--ok { background: var(--green, #1e9e58); }
.tc__task-bar--err { background: var(--red, #ef7578); }
.tc__task-bar--muted { background: var(--faint, #67758f); }

.tc__task-content {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tc__task-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tc__task--running .tc__task-row strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink, #172033);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc__task-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink, #172033);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tc__task-subject {
  font-size: 12px;
  color: var(--muted, #5b6577);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tc__task-detail {
  font-size: 12px;
  color: var(--muted, #5b6577);
}
.tc__task-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--faint, #67758f);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* 状态标签 */
.tc__task-status {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 4px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  flex-shrink: 0;
}
.tc__task-status--running {
  background: color-mix(in srgb, var(--blue, #3478f6) 12%, transparent);
  color: var(--blue, #3478f6);
  border: 1px solid color-mix(in srgb, var(--blue, #3478f6) 25%, transparent);
}

/* 进度条 */
.tc__task-progress {
  height: 2px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--blue, #3478f6) 12%, transparent);
  overflow: hidden;
}
.tc__task-progress i {
  display: block;
  height: 100%;
  width: 40%;
  border-radius: 1px;
  background: var(--blue, #3478f6);
  animation: tcProgress 1.8s ease-in-out infinite;
}
@keyframes tcProgress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

/* 单条移除按钮 */
.tc__task-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: auto 6px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--faint, #67758f);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: all 0.12s;
}
.tc__task:hover .tc__task-dismiss {
  opacity: 1;
}
.tc__task-dismiss:hover {
  color: var(--red, #ef7578);
  background: color-mix(in srgb, var(--red, #ef7578) 10%, transparent);
}

/* 查看更多 */
.tc__more {
  display: block;
  width: 100%;
  padding: 8px;
  border: 0;
  border-top: 1px solid var(--line, #e3e9f4);
  background: none;
  color: var(--faint, #67758f);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s;
  text-align: center;
}
.tc__more:hover {
  color: var(--blue-deep, #1f57cc);
  background: color-mix(in srgb, var(--blue, #3478f6) 4%, transparent);
}

/* 空态 */
.tc__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 16px;
}
.tc__empty-icon {
  color: var(--faint, #67758f);
  opacity: 0.3;
  margin-bottom: 4px;
}
.tc__empty p {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted, #5b6577);
}
.tc__empty span {
  font-size: 12px;
  color: var(--faint, #67758f);
}

/* ================= 面板动画 ================= */
.tc-panel-enter-active,
.tc-panel-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.tc-panel-enter-from,
.tc-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}

/* ================= 暗色模式 ================= */
[data-theme='dark'] .tc__btn {
  background: var(--surface, #182230);
  border-color: var(--line, #2a3648);
  color: var(--muted, #9aa8bf);
}
[data-theme='dark'] .tc__btn:hover {
  border-color: color-mix(in srgb, var(--blue, #4d8bf8) 30%, var(--line, #2a3648));
  background: color-mix(in srgb, var(--blue, #4d8bf8) 5%, transparent);
}
[data-theme='dark'] .tc__panel {
  background: var(--surface, #182230);
  border-color: var(--line, #2a3648);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.2);
}
[data-theme='dark'] .tc__head {
  background: color-mix(in srgb, var(--ink, #e6edf7) 3%, transparent);
}
[data-theme='dark'] .tc__task:hover {
  background: color-mix(in srgb, var(--ink, #e6edf7) 5%, transparent);
}

/* ================= 移动端 ================= */
@media (max-width: 1100px) {
  .tc__panel {
    position: fixed;
    top: 72px;
    right: 12px;
    left: 12px;
    width: auto;
    min-width: 0;
    max-width: none;
  }
}
</style>
