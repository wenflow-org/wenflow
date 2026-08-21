<template>
  <section class="runtime" :class="{ 'runtime--busy': busyItems.length }" aria-live="polite">
    <!-- 进行中任务：有实时价值，保留可见度 -->
    <div v-if="busyItems.length" class="runtime__busy">
      <div v-for="item in busyItems" :key="item.key" class="runtime__busy-item">
        <div class="runtime__busy-bar"></div>
        <div class="runtime__busy-content">
          <div class="runtime__busy-head">
            <span class="runtime__busy-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            </span>
            <strong>{{ item.title }}</strong>
            <span v-if="item.detail" class="runtime__busy-detail">{{ item.detail }}</span>
          </div>
          <div class="runtime__busy-progress"><i></i></div>
        </div>
      </div>
    </div>

    <!-- 历史动态：默认折叠成一行摘要，点击展开 -->
    <button
      v-else-if="feedSummary"
      type="button"
      class="runtime__summary"
      :class="{ 'runtime__summary--open': expanded }"
      @click="expanded = !expanded"
    >
      <span class="runtime__summary-dot" aria-hidden="true"></span>
      <span class="runtime__summary-text">{{ feedSummary }}</span>
      <span class="runtime__summary-time">{{ lastSyncText }}</span>
      <svg class="runtime__summary-chevron" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
    </button>

    <!-- 展开后的历史列表 -->
    <transition name="rt-expand">
      <div v-if="expanded && feed.length && !busyItems.length" class="runtime__feed-wrap">
        <ul class="runtime__feed">
          <li
            v-for="ev in feed"
            :key="ev.key"
            class="runtime__ev"
            :class="`runtime__ev--${ev.tone}`"
          >
            <div class="runtime__ev-indicator"></div>
            <span class="runtime__ev-label">{{ ev.label }}</span>
            <span v-if="ev.subject" class="runtime__ev-subject">{{ ev.subject }}</span>
            <span class="runtime__ev-time">{{ ev.time }}</span>
          </li>
        </ul>
        <button v-if="feedTruncated" type="button" class="runtime__more" @click="loadMore">查看更早 ›</button>
      </div>
    </transition>

    <!-- 空态：极简一行 -->
    <div v-if="!busyItems.length && !feed.length" class="runtime__idle">
      <span class="runtime__idle-dot"></span>
      <span>AI 暂无活动</span>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * V2Runtime：Dashboard 运行状态区（用户侧「前端状态感」）
 * 展示 AI 正在为用户做什么（路径生成 / 课堂进行中）+ 最近完成的 AI 动态（折叠）。
 * 全部使用学习者侧只读接口，不做后端改动。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { getAgentLogs } from '@/api/userCustom';

interface BusyItem { key: string; title: string; detail?: string }
interface FeedEvent { key: string; label: string; subject?: string; text: string; time: string; tone: 'ok' | 'err' | 'muted'; rawTime: number }

const busyItems = ref<BusyItem[]>([]);
const feed = ref<FeedEvent[]>([]);
const refreshing = ref(false);
const lastSync = ref<number | null>(null);
const expanded = ref(false);
let busy = false;
let pollTimer = 0;
let manualCursor = 0;
let feedAll: FeedEvent[] = [];
const PAGE_SIZE = 8;
const SLOW_MS = 60_000;
const FAST_MS = 12_000;

const lastSyncText = computed(() => {
  if (!lastSync.value) return '';
  const s = Math.max(0, Math.round((Date.now() - lastSync.value) / 1000));
  if (s < 60) return `${s} 秒前`;
  return `${Math.round(s / 60)} 分钟前`;
});

const feedTruncated = computed(() => feedAll.length > feed.value.length);

/** 历史摘要：最近一条 + 总数，一行说完 */
const feedSummary = computed(() => {
  if (!feed.value.length) return '';
  const latest = feed.value[0];
  if (latest.subject) return `${latest.label} · ${latest.subject}`;
  return latest.label;
});

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

/** agentId 语义化映射（后端注册的官方 agent 名称） */
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
  const logs = body?.data?.logs;
  return Array.isArray(logs) ? logs : [];
}

function toFeed(logs: AgentLog[]): FeedEvent[] {
  return logs.map((log) => {
    const meta = (() => {
      try { return log.metadata ? JSON.parse(log.metadata) : {}; }
      catch { return {}; }
    })() as Record<string, unknown>;
    const label = AGENT_LABEL[log.agentId] ?? fallbackLabel(log.agentId);
    const subject = (meta.subject || meta.taskTitle || meta.title) as string | undefined;
    return {
      key: log.id || `${log.calledAt}-${log.agentId}`,
      label,
      subject,
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
        title: '正在生成你的学习路径',
        detail: lc.phase === 'stage_design' && lc.totalStages
          ? `阶段任务准备中（${lc.completedStages ?? 0}/${lc.totalStages}）`
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
  if (busy !== prevBusy && !busy && prevCount > 0) {
    await refreshFeed();
  }
  lastSync.value = Date.now();
  refreshing.value = false;
}

async function refreshFeed() {
  try {
    const res = await getAgentLogs({ limit: 30, includeSystem: false });
    const logs = unwrapLogs(res);
    feedAll = toFeed(logs);
    applyFeedWindow();
  } catch { /* 轮询失败静默 */ }
}

function applyFeedWindow() {
  feed.value = feedAll.slice(0, PAGE_SIZE);
}

function loadMore() {
  manualCursor += PAGE_SIZE;
  feed.value = feedAll.slice(0, PAGE_SIZE + manualCursor);
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

onMounted(() => {
  void refresh();
  schedulePoll();
});

onBeforeUnmount(() => {
  window.clearTimeout(pollTimer);
});
</script>

<style scoped>
.runtime {
  margin-bottom: 12px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  /* 极轻阴影，不像独立大卡片 */
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.03);
}

/* ================= 进行中任务 ================= */
.runtime__busy {
  display: grid;
  gap: 6px;
  padding: 6px;
}
.runtime__busy-item {
  display: flex;
  align-items: stretch;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--blue) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 14%, transparent);
}
.runtime__busy-bar {
  width: 3px;
  flex-shrink: 0;
  background: var(--blue);
  animation: rtBarGlow 2s ease-in-out infinite;
}
@keyframes rtBarGlow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.runtime__busy-content {
  flex: 1;
  min-width: 0;
  padding: 7px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.runtime__busy-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.runtime__busy-icon {
  display: inline-flex;
  align-items: center;
  color: var(--blue);
  flex-shrink: 0;
}
.runtime__busy-content strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.runtime__busy-detail {
  font-size: 11.5px;
  color: var(--muted);
  font-weight: 400;
}
.runtime__busy-progress {
  height: 2px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  overflow: hidden;
}
.runtime__busy-progress i {
  display: block;
  height: 100%;
  width: 40%;
  border-radius: 1px;
  background: var(--blue);
  animation: rtProgress 1.8s ease-in-out infinite;
}
@keyframes rtProgress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

/* ================= 历史摘要行（折叠态） ================= */
.runtime__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 14px;
  border: 0;
  background: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background 0.15s;
}
.runtime__summary:hover {
  background: color-mix(in srgb, var(--ink) 2.5%, transparent);
}
.runtime__summary-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--faint);
  flex-shrink: 0;
  opacity: 0.5;
}
.runtime__summary-text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.runtime__summary-time {
  font-size: 11px;
  color: var(--faint);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.runtime__summary-chevron {
  color: var(--faint);
  flex-shrink: 0;
  transition: transform 0.2s;
}
.runtime__summary--open .runtime__summary-chevron {
  transform: rotate(180deg);
}

/* ================= 展开后的列表 ================= */
.runtime__feed-wrap {
  border-top: 1px solid var(--line);
  padding: 4px 0;
}
.runtime__feed {
  list-style: none;
  margin: 0;
  padding: 0 8px;
}
.runtime__ev {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  transition: background 0.12s;
}
.runtime__ev:hover {
  background: color-mix(in srgb, var(--ink) 3%, transparent);
}
.runtime__ev-indicator {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
  background: var(--faint);
  opacity: 0.35;
}
.runtime__ev--ok .runtime__ev-indicator { background: var(--green); opacity: 0.5; }
.runtime__ev--err .runtime__ev-indicator { background: var(--red); opacity: 0.5; }
.runtime__ev-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.runtime__ev-subject {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.runtime__ev-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--faint);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.runtime__more {
  display: block;
  width: 100%;
  padding: 6px;
  border: 0;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--faint);
  font-size: 11.5px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  font: inherit;
  text-align: center;
}
.runtime__more:hover {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 4%, transparent);
}

/* ================= 空态 ================= */
.runtime__idle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
}
.runtime__idle-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--faint);
  opacity: 0.4;
}
.runtime__idle span:last-child {
  font-size: 12px;
  color: var(--faint);
}

/* ================= 展开动画 ================= */
.rt-expand-enter-active,
.rt-expand-leave-active {
  transition: max-height 0.25s ease, opacity 0.2s ease;
  overflow: hidden;
  max-height: 400px;
}
.rt-expand-enter-from,
.rt-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

/* ================= 暗色模式 ================= */
[data-theme='dark'] .runtime__summary:hover {
  background: color-mix(in srgb, var(--ink) 5%, transparent);
}
[data-theme='dark'] .runtime__ev:hover {
  background: color-mix(in srgb, var(--ink) 5%, transparent);
}
</style>
