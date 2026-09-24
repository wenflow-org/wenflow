<template>
  <CapabilityShell title="学习历史" description="按时间回看你的学习会话：学了什么、学多久、完成情况。">
    <!-- 页头由 CapabilityShell 提供（个人中心 kicker + 标题 + 说明） -->
    <div class="history__body">
      <!-- 统计（与首页/状态页同口径：后端已默认过滤 discarded/superseded 内部会话） -->
      <div class="history__stats">
        <div class="card history__stat">
          <span>学习次数</span>
          <strong>{{ totalSessions }}<i> 次</i></strong>
        </div>
        <div class="card history__stat">
          <span>累计时长</span>
          <strong>{{ totalMinutes }}<i> 分钟</i></strong>
        </div>
        <div class="card history__stat">
          <span>学习天数</span>
          <strong>{{ activeDays }}<i> 天</i></strong>
        </div>
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

      <!-- 按日期分组的会话列表 -->
      <div v-else class="history__list">
        <section v-for="group in groupedSessions" :key="group.date" class="card history__day">
          <div class="history__day-head">
            <strong>{{ group.label }}</strong>
            <span class="muted">{{ group.items.length }} 次 · {{ group.minutes }} 分钟</span>
          </div>
          <ul class="history__items">
            <li v-for="s in group.items" :key="s.id" class="history__item">
              <span class="history__dot" :class="`history__dot--${sessionState(s)}`"></span>
              <div class="history__item-main">
                <strong>{{ taskTitle(s) }}</strong>
                <span v-if="sessionSummary(s)" class="history__item-sub">{{ sessionSummary(s) }}</span>
              </div>
              <span class="uc-badge" :class="stateBadgeCls(s)">{{ stateLabel(s) }}</span>
              <span class="history__item-time">{{ s.durationMinutes ? `${s.durationMinutes} 分钟` : '—' }}</span>
              <!-- 可继续的会话（active/paused）才给「继续」；已结束/已完成不再误导 -->
              <router-link
                v-if="sessionState(s) === 'resumable' && s.taskId"
                :to="`/learn/${s.taskId}`"
                class="history__resume"
              >继续 ›</router-link>
              <router-link
                v-else-if="canViewFeedback(s)"
                :to="feedbackLink(s)"
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
  if (status === 'paused') return '已暂停';
  if (status === 'active' || status === 'in_progress') return '进行中';
  if (status === 'timeout') return '已超时';
  // discarded = 用户点「重新开始」后旧会话被丢弃（duration 是真实有效时长，计入学习）
  if (status === 'discarded') return '已重开';
  if (status === 'superseded') return '已取代';
  return '已结束';
}

function stateBadgeCls(s: SessionRecord): string {
  const state = sessionState(s);
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

function sessionSummary(s: SessionRecord): string {
  try {
    const state = s.teachingState ? JSON.parse(s.teachingState) : null;
    const topic = state?.topicSummary || state?.summary?.topicSummary || state?.knowledgeSummary;
    if (typeof topic === 'string' && topic.trim()) return topic.trim().slice(0, 60);
    const msg = s.messages ? JSON.parse(s.messages) : null;
    if (Array.isArray(msg) && msg.length) {
      const last = msg[msg.length - 1];
      const text = plainSnippet(String(last?.content || last?.text || ''));
      if (text) return text.slice(0, 60);
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

const groupedSessions = computed<DayGroup[]>(() => {
  const map = new Map<string, DayGroup>();
  for (const s of sessions.value) {
    const key = dayKey(s.startTime || s.endTime);
    if (!key) continue;
    let group = map.get(key);
    if (!group) {
      group = { date: key, label: dayLabel(key), minutes: 0, items: [] };
      map.set(key, group);
    }
    group.items.push(s);
    group.minutes += s.durationMinutes || 0;
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

.history__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.history__stat {
  padding: 16px 18px;
  display: grid;
  gap: 4px;
}

.history__stat span {
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #67758f);
}

.history__stat strong {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink, #172033);
}

.history__stat strong i {
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  color: var(--muted, #5b6577);
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
  padding: 5px 12px;
  border: 1px solid color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  border-radius: var(--mk-radius-pill);
  white-space: nowrap;
  transition: background 0.15s ease;
}
.history__resume:hover { background: color-mix(in srgb, var(--blue) 12%, transparent); }

.history__feedback {
  font-size: 12px; font-weight: 800;
  color: var(--muted, #5b6577);
  text-decoration: none;
  padding: 5px 12px;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: var(--mk-radius-pill);
  white-space: nowrap;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.history__feedback:hover { color: var(--blue-deep, #1f57cc); border-color: rgba(52, 120, 246, 0.4); }

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
  .history__stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .history__stat {
    padding: 10px 12px;
    gap: 2px;
  }

  /* 加载态桌面 40px 上下留白，移动端收到 28（基线：加载/空态 ≤32） */
  .history__loading {
    padding: 28px 0;
  }

  .history__stat span {
    font-size: 12px;
  }

  .history__stat strong {
    font-size: 19px;
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
