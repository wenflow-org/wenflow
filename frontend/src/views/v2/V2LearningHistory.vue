<template>
  <CapabilityShell title="学习历史" description="按时间回看你的学习会话：学了什么、学多久、完成情况。">
    <!-- 页头由 CapabilityShell 提供（个人中心 kicker + 标题 + 说明） -->
    <div class="history__body">
      <!-- 统计行（批19）：三个数字合并为一行内联统计，不再三张等权卡片 -->
      <div class="history__stats">
        <span class="history__stat">学习 <strong>{{ totalSessions }}</strong> 次</span>
        <span class="history__stat">累计 <strong>{{ totalMinutes }}</strong> 分钟</span>
        <span class="history__stat">共 <strong>{{ activeDays }}</strong> 天有学习</span>
      </div>

      <!-- 错误 -->
      <div v-if="loadError" class="errorbar" role="alert">
        {{ loadError }}
        <button type="button" class="errorbar__retry" @click="load(true)">重新加载</button>
      </div>

      <!-- 加载 -->
      <div v-else-if="loading && !sessions.length" class="history__loading">
        <span class="spinner"></span>
        加载学习记录…
      </div>

      <!-- 空态 -->
      <div v-else-if="!sessions.length" class="chart__empty">
        <strong>还没有学习记录</strong>
        <p>完成第一次学习后，这里会按时间记录你的每次会话。</p>
      </div>

      <!-- 按日期分组的会话列表（2026-09-27 重排：按「日期 → 任务」聚合，
           同一天同一个任务的多条会话合并成一条，明细用「查看每次会话」展开） -->
      <div v-else class="history__list">
        <section v-for="group in groupedSessions" :key="group.date" class="card history__day">
          <div class="history__day-head">
            <strong>{{ group.label }}</strong>
            <span class="muted">
              {{ group.items.length }} 次<template v-if="group.minutes"> · {{ group.minutes }} 分钟</template>
            </span>
          </div>
          <ul class="history__items">
            <li v-for="t in group.tasks" :key="t.key" class="history__item">
              <!-- 色点对读屏是冗余（状态文案在右侧徽章里），标记装饰；批19 aria 补课 -->
              <span class="history__dot" :class="`history__dot--${t.state}`" aria-hidden="true"></span>
              <div class="history__item-main">
                <strong>{{ t.title }}</strong>
                <span v-if="t.sessions.length > 1" class="history__item-meta">
                  {{ t.sessions.length }} 次会话<template v-if="t.minutes"> · 共 {{ t.minutes }} 分钟</template>
                </span>
                <span v-if="summaryOf(t)" class="history__item-sub">{{ summaryOf(t) }}</span>
                <!-- 明细：同日同任务的每次会话（时长/状态各自成行）。
                     动作只给「查看反馈」（每次会话各自的反馈页，目标不同）；
                     「继续/重新开始」由聚合行统一给（目标与明细相同的链接不重复渲染）。 -->
                <details v-if="t.sessions.length > 1" class="history__subs">
                  <summary>查看每次会话</summary>
                  <ul class="history__sublist">
                    <li v-for="s in t.sessions" :key="s.id">
                      <span class="history__sub-time">{{ sessionClock(s) }}</span>
                      <span class="uc-badge" :class="stateBadgeCls(s)">{{ stateLabel(s) }}</span>
                      <span class="history__sub-min">{{ s.durationMinutes ? `${s.durationMinutes} 分钟` : '—' }}</span>
                      <router-link
                        v-if="canViewFeedback(s)"
                        :to="feedbackLink(s)"
                        class="history__feedback"
                      >查看反馈 ›</router-link>
                    </li>
                  </ul>
                </details>
              </div>
              <span class="uc-badge" :class="t.sessions.length > 1 ? stateBadgeClsForState(t.state) : stateBadgeCls(t.lead)">
                {{ t.sessions.length > 1 ? stateLabelForState(t.state) : stateLabel(t.lead) }}
              </span>
              <span class="history__item-time">{{ t.minutes ? `${t.minutes} 分钟` : '—' }}</span>
              <!-- 动作与状态匹配（2026-09-27）：可继续 → 继续；中断未完成 → 重新开始；已完成且有小结 → 查看反馈 -->
              <router-link
                v-if="t.state === 'resumable' && t.lead.taskId"
                :to="`/learn/${t.lead.taskId}`"
                class="history__resume"
              >继续 ›</router-link>
              <router-link
                v-else-if="t.state === 'ended' && t.lead.taskId"
                :to="`/learn/${t.lead.taskId}`"
                class="history__restart"
              >重新开始 ›</router-link>
              <router-link
                v-else-if="feedbackLinkFor(t)"
                :to="feedbackLinkFor(t)"
                class="history__feedback"
              >查看反馈 ›</router-link>
            </li>
          </ul>
        </section>

        <!-- 加载更多 -->
        <div v-if="hasMore" class="history__more">
          <button type="button" class="btn-ghost" :disabled="loading" @click="loadMore">
            {{ loading ? '加载中…' : '加载更多' }}
          </button>
        </div>
        <p v-else-if="sessions.length" class="history__end">— 已加载全部记录 —</p>
      </div>
    </div>

    <!-- AI 生成提示（页脚由 CapabilityShell 提供） -->
    <div class="history__ai-note">
      <AiContentNote />
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import request from '@/utils/api';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import { localDateKeyFromIso } from '@/utils/date';
import { unwrap } from './unwrap';

interface SessionRecord {
  id: string;
  taskId?: string | null;
  taskTitle?: string | null;
  status?: string;
  startTime?: string;
  endTime?: string | null;
  durationMinutes?: number | null;
  duration?: number | null;
  teachingState?: string | null;
  messages?: string | null;
  /** 当堂小结（有则可查看反馈；数据库无 completedAt 字段，勿再依赖它判断完成） */
  wrapup?: string | null;
}

const PAGE_SIZE = 30;

const sessions = ref<SessionRecord[]>([]);
const loading = ref(true);
const loadError = ref('');
const hasMore = ref(true);

const doneStatuses = new Set(['completed', 'done', 'finished', 'closed']);

/** 会话三态：completed（已完成）/ resumable（可继续：active·paused）/ ended（已结束：timeout·discarded 等）。
    接口只过滤 superseded（stale 行被回收重开，无真实进展）。 */
type SessionState = 'completed' | 'resumable' | 'ended';

function sessionState(s: SessionRecord): SessionState {
  const status = String(s.status || '').toLowerCase();
  if (doneStatuses.has(status)) return 'completed';
  if (status === 'active' || status === 'paused' || status === 'in_progress') return 'resumable';
  return 'ended';
}

function stateLabel(s: SessionRecord): string {
  const status = String(s.status || '').toLowerCase();
  if (doneStatuses.has(status)) return '已完成';
  if (status === 'paused') return '上次停在这里';
  if (status === 'active' || status === 'in_progress') return '进行中';
  // 「已超时」是内部状态名，对学习者没有意义——它就是「中断了、没学完」（2026-09-27）
  if (status === 'timeout') return '中断未完成';
  // discarded = 用户点「重新开始」后旧会话被丢弃（duration 是真实有效时长，计入学习）
  if (status === 'discarded') return '已重开';
  if (status === 'superseded') return '已取代';
  return '已结束';
}

/** 聚合行的状态文案（多会话合并时用）：只说「能不能继续 / 完没完成」 */
function stateLabelForState(state: SessionState): string {
  if (state === 'completed') return '已完成';
  if (state === 'resumable') return '可继续';
  return '未完成';
}

function stateBadgeCls(s: SessionRecord): string {
  return stateBadgeClsForState(sessionState(s));
}

function stateBadgeClsForState(state: SessionState): string {
  if (state === 'completed') return 'uc-badge--ok';
  if (state === 'resumable') return 'uc-badge--warn';
  return 'uc-badge--muted';
}

const taskTitle = (s: SessionRecord) => s.taskTitle || '未命名任务';

/** 有当堂小结的会话可查看反馈（评估页直接按 sessionId 取详情） */
function canViewFeedback(s: SessionRecord): boolean {
  return !!s.taskId && typeof s.wrapup === 'string' && s.wrapup.trim().length > 0;
}

function feedbackLink(s: SessionRecord): string {
  return `/learn/${s.taskId}/evaluation/${s.id}`;
}

/** 摘要兜底用消息原文时去掉行内 markdown 标记（主题小结本身是纯文本） */
function plainSnippet(text: string): string {
  return text
    .replace(/[*`~#>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 摘要截断：60 字上限 + 省略号（2026-09-27：此前裸 slice 把句子切在半句上，
    看起来像数据坏了） */
function snippet(text: string, max = 60): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function sessionSummary(s: SessionRecord): string {
  try {
    const state = s.teachingState ? JSON.parse(s.teachingState) : null;
    const topic = state?.topicSummary || state?.summary?.topicSummary || state?.knowledgeSummary;
    if (typeof topic === 'string' && topic.trim()) return snippet(topic);
    const msg = s.messages ? JSON.parse(s.messages) : null;
    if (Array.isArray(msg) && msg.length) {
      const last = msg[msg.length - 1];
      const text = plainSnippet(String(last?.content || last?.text || ''));
      if (text) return snippet(text);
    }
  } catch {
    /* 忽略解析失败 */
  }
  return '';
}

/* ---------- 全量统计（后端权威，分页不影响） ----------
   totalSessions：/users/me/sessions 返回的 total（含日期过滤的全量会话数）
   totalMinutes / activeDays：/learning/stats 的 time.totalMinutes / time.activeLearningDays
   此前统计只算「已加载页」（sessions.length），分页后失真。 */
const totalSessions = ref(0);
const totalMinutes = ref(0);
const activeDays = ref(0);

async function loadStats() {
  try {
    const [sessionsRes, statsRes] = await Promise.all([
      request.get('/users/me/sessions', { params: { limit: 1 } }),
      request.get('/learning/stats')
    ]);
    // total 在响应顶层（与 data 平级），不能用 unwrap（它只取 data）
    const sessionsBody = sessionsRes as { total?: number };
    if (typeof sessionsBody?.total === 'number') totalSessions.value = sessionsBody.total;
    const stats = unwrap<{ time?: { totalMinutes?: number; activeLearningDays?: number } }>(statsRes);
    if (typeof stats?.time?.totalMinutes === 'number') totalMinutes.value = stats.time.totalMinutes;
    if (typeof stats?.time?.activeLearningDays === 'number') activeDays.value = stats.time.activeLearningDays;
  } catch {
    /* 统计加载失败不阻塞列表（静默降级为 0） */
  }
}

interface DayGroup {
  date: string;
  label: string;
  minutes: number;
  items: SessionRecord[];
  /** 同日同任务聚合后的行（2026-09-27）：同一天同一个任务的多条会话合并成一条 */
  tasks: TaskGroup[];
}

interface TaskGroup {
  key: string;
  title: string;
  /** 按时间倒序 */
  sessions: SessionRecord[];
  minutes: number;
  state: SessionState;
  /** 代表性会话：可继续优先，其次最新（用于摘要与动作） */
  lead: SessionRecord;
}

/**
 * 会话归属的本地日期键。
 * 勿用 `String(iso).slice(0, 10)`：那是 UTC 切日，UTC+8 用户 00:00–08:00 学完的课
 * 会被归到「昨天」（2026-09-18 走查实测）。
 */
const dayKey = (iso?: string | null) => localDateKeyFromIso(iso);

const dayLabel = (dateKey: string) => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const yest = new Date(today.getTime() - 86400000);
  const ym = String(yest.getMonth() + 1).padStart(2, '0');
  const yd = String(yest.getDate()).padStart(2, '0');

  if (dateKey === `${y}-${m}-${d}`) return '今天';
  if (dateKey === `${yest.getFullYear()}-${ym}-${yd}`) return '昨天';
  const [yy, mm, dd] = dateKey.split('-');
  return `${yy}年${Number(mm)}月${Number(dd)}日`;
};

/** 聚合行的状态：能继续 > 完成过 > 都没完成 */
function aggregateState(list: SessionRecord[]): SessionState {
  if (list.some((s) => sessionState(s) === 'resumable')) return 'resumable';
  if (list.some((s) => sessionState(s) === 'completed')) return 'completed';
  return 'ended';
}

/** 代表性会话：可继续的优先（给「继续」动作），否则取最新一条 */
function leadSession(list: SessionRecord[]): SessionRecord {
  return list.find((s) => sessionState(s) === 'resumable') || list[0];
}

/** 聚合行摘要：优先代表性会话，没有则找最近一条有摘要的 */
function summaryOf(t: TaskGroup): string {
  const lead = sessionSummary(t.lead);
  if (lead) return lead;
  const withSummary = t.sessions.find((s) => sessionSummary(s));
  return withSummary ? sessionSummary(withSummary) : '';
}

/** 聚合行的反馈入口（最近一条有当堂小结的会话的链接；没有则空串） */
function feedbackLinkFor(t: TaskGroup): string {
  const s = t.sessions.find((x) => canViewFeedback(x));
  return s ? feedbackLink(s) : '';
}

/** 明细行的时刻（本地 HH:mm） */
function sessionClock(s: SessionRecord): string {
  const d = new Date(String(s.startTime || s.endTime || ''));
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const groupedSessions = computed<DayGroup[]>(() => {
  const map = new Map<string, DayGroup>();
  for (const s of sessions.value) {
    const key = dayKey(s.startTime || s.endTime);
    if (!key) continue;
    let group = map.get(key);
    if (!group) {
      group = { date: key, label: dayLabel(key), minutes: 0, items: [], tasks: [] };
      map.set(key, group);
    }
    group.items.push(s);
    group.minutes += s.durationMinutes || 0;
    // 聚合键：任务 id 优先，缺 id 退化为标题（旧数据）
    const taskKey = s.taskId || taskTitle(s);
    let task = group.tasks.find((t) => t.key === taskKey);
    if (!task) {
      task = { key: taskKey, title: taskTitle(s), sessions: [], minutes: 0, state: 'completed', lead: s };
      group.tasks.push(task);
    }
    task.sessions.push(s);
    task.minutes += s.durationMinutes || 0;
  }
  for (const group of map.values()) {
    for (const task of group.tasks) {
      task.sessions.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
      task.state = aggregateState(task.sessions);
      task.lead = leadSession(task.sessions);
    }
  }
  return [...map.values()];
});

async function load(reset = false) {
  // 首屏（sessions 空且 loading=true 初始）允许进入；后续加载中拦截（防并发翻页）
  if (loading.value && sessions.value.length > 0) return;
  loading.value = true;
  loadError.value = '';
  try {
    const page = reset ? 1 : Math.floor(sessions.value.length / PAGE_SIZE) + 1;
    const res = await request.get('/users/me/sessions', {
      params: { page, limit: PAGE_SIZE }
    });
    const data = unwrap<{ sessions?: SessionRecord[] }>(res);
    const items = Array.isArray(data) ? data as unknown as SessionRecord[] : data?.sessions || [];
    hasMore.value = items.length >= PAGE_SIZE;
    if (reset) {
      sessions.value = items;
    } else {
      const seen = new Set(sessions.value.map((s) => s.id));
      sessions.value = [...sessions.value, ...items.filter((s) => !seen.has(s.id))];
    }
  } catch {
    loadError.value = '无法读取学习记录，请稍后重试。';
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  void load(false);
}

onMounted(() => {
  void load(true);
  void loadStats();
});
</script>

<style scoped>
/* AI 提示：页脚由 CapabilityShell 提供，这里只留一行居中说明 */
.history__ai-note {
  display: flex; justify-content: center;
  padding: 4px 0 0;
}
.history__ai-note :deep(.ai-note) { font-size: 11px; opacity: 0.75; }

/* 内容容器：宽度/内边距交给 CapabilityShell 的 .uc__main，这里只管卡间距 */
.history__body {
  display: grid;
  gap: 16px;
  align-content: start;
}

/* 统计行（批19）：三个数字内联一行，不再三张等权卡 */
.history__stats {
  display: flex;
  align-items: baseline;
  gap: 22px;
  flex-wrap: wrap;
  padding: 2px 2px 0;
}

.history__stat {
  font-size: 13px;
  color: var(--muted, #5b6577);
}

.history__stat strong {
  /* 17 → 16：行内次级数字档 */
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink, #172033);
  font-variant-numeric: tabular-nums;
  margin: 0 2px;
}

.history__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 0;
  color: var(--faint, #67758f);
  font-size: 13px;
}

.history__list {
  display: grid;
  gap: 14px;
}

.history__day {
  padding: 16px 18px;
}

.history__day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.history__day-head strong {
  font-size: 15px;
  color: var(--ink, #172033);
}

/* 日分组右侧的计数/时长是次级信息：12px + faint。
   原来这里只有 V2LearningState 有 `.muted`，本页照抄了同一份 markup 却没带样式，
   于是继承壳的 16px 基座——和左边的日期标题一样大，一眼看不出主次（2026-09-24 指出）。 */
.muted { font-size: 12px; color: var(--faint, #67758f); font-weight: 600; }

/* 状态徽章贴着行右缘，和左边标题同尺寸（16px）会显得这一行很满；
   收到 12px + 2×8 内边距（业界移动端最小可读字号），并沿用 uc.css .uc-badge 的配色。 */
.history__item .uc-badge {
  font-size: 12px;
  padding: 2px 8px;
  line-height: 1.4;
}

.history__items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
}

.history__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 2px;
  border-top: 1px solid var(--line, #e3e9f4);
}

.history__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--mk-radius-pill);
  background: var(--faint, #67758f);
  flex: none;
}

.history__dot--completed { background: var(--green, #1e9e58); }
.history__dot--resumable { background: var(--blue, #3478f6); }
.history__dot--ended { background: var(--faint, #67758f); }

.history__item-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.history__item-main strong {
  font-size: 14px;
  color: var(--ink, #172033);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 聚合行元信息（N 次会话 · 共 X 分钟） */
.history__item-meta {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted, #5b6577);
}

/* 明细展开（同日同任务的每次会话） */
.history__subs { margin-top: 4px; }
.history__subs > summary {
  cursor: pointer;
  width: fit-content;
  font-size: 12px;
  color: var(--blue-deep, #1f57cc);
}
.history__sublist {
  list-style: none;
  margin: 6px 0 0;
  padding: 0 0 0 10px;
  display: grid;
  gap: 6px;
  border-left: 2px solid var(--line, #e3e9f4);
}
.history__sublist li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.history__sub-time { font-size: 12px; color: var(--muted, #5b6577); font-variant-numeric: tabular-nums; }
.history__sub-min { font-size: 12px; color: var(--faint, #67758f); font-variant-numeric: tabular-nums; }

.history__item-sub {
  font-size: 12px;
  color: var(--faint, #67758f);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history__item-time {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.history__resume {
  font-size: 12px; font-weight: 800;
  color: var(--blue-deep, #1f57cc);
  text-decoration: none;
  /* 30px → 36px（mobile:spec 的 lt36 门禁）：行里就靠这两个按钮操作，
     拇指目标不能只有 30；横向 padding 不动，标题列宽度预算不变。 */
  padding: 5px 12px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  border-radius: var(--mk-radius-pill);
  white-space: nowrap;
  transition: background 0.15s ease;
}
.history__resume:hover { background: color-mix(in srgb, var(--blue) 12%, transparent); }

.history__feedback,
.history__restart {
  font-size: 12px; font-weight: 800;
  color: var(--muted, #5b6577);
  text-decoration: none;
  padding: 5px 12px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: var(--mk-radius-pill);
  white-space: nowrap;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.history__feedback:hover,
.history__restart:hover { color: var(--blue-deep, #1f57cc); border-color: rgba(52, 120, 246, 0.4); }

.history__more {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.history__end {
  text-align: center;
  font-size: 12px;
  color: var(--faint, #67758f);
  padding: 4px 0;
}

@media (max-width: 1100px) {
  /* 断点从 640 一路提到 1100：学习者的「移动端模式」由底部 tab 条定义，而 tab 条
     在 ≤1100 就出现（V2Nav），密度此前卡在 900，901~1100 这一段是本页桌面刻度 +
     壳的移动刻度混着显示（实测 1000px：h1 28px、日分组卡 16×18）。现在与壳、与
     各页移动块统一到 1100，并配合 v2.css 里 .v2-page > main 的 720px 列宽。
     实测 390 下整页 2306px，其中三张统计卡竖排就占 309px（每张 95px，
     只装「学习次数 / 24 次」两行）。桌面本来就是三列，窄屏竖排是因为 26px 的数值
     在 100px 宽的列里放不下——把数值压到 19px、单位 11px、卡片内边距收到 10px 后
     三列重新放得下（320 下每列内容宽 72px，「271 分钟」实测 57px） */
  /* 统计已合并为内联一行（批19），窄屏自动换行，无需特殊处理 */
  .history__stats { gap: 14px; }

  /* 加载态桌面 40px 上下留白，移动端收到 28（基线：加载/空态 ≤32） */
  .history__loading {
    padding: 28px 0;
  }

  .history__stat strong i {
    font-size: 12px;
  }

  .history__body {
    gap: 12px;
  }

  /* 统计卡与日分组再收一档（2026-09-24 反馈「内容都偏大」）。
     原来 .history__stat / .history__day 在这个块里各写了两遍（10px 与 10px 12px / 12px），
     同权重下后一条胜出、前一条是死规则——合并成一条。 */
  .history__day {
    padding: 12px;
  }

  .history__list {
    gap: 10px;
  }

  .history__day-head strong {
    font-size: 14px;
  }

  /* 行内边距 11→9、间距 12→8：一行省 16px，24 条就是 380px；顺带把标题的可用宽度
     从 104px 提到 ~160px（比例问题：标题才是这一行里最该看清的东西） */
  .history__item {
    padding: 9px 2px;
    gap: 8px;
  }

  .history__item-main strong {
    font-size: 13px;
  }

  .history__item-sub {
    font-size: 12px;
  }

  .history__item-time {
    display: none;
  }

  .history__feedback,
  .history__resume {
    padding: 5px 10px;
  }

  .history__end {
    padding: 2px 0;
    font-size: 12px;
  }
}
</style>
