<template>
  <div class="history v2-page">
    <V2Nav />

    <main class="history__main">
      <!-- 页头 -->
      <div class="history__hero">
        <div>
          <span class="kicker">学习历史</span>
          <h1>每一次学习，都有迹可循</h1>
          <p>按时间回看你的学习会话：学了什么、学多久、完成情况。</p>
        </div>
      </div>

      <!-- 统计（全量口径：后端 /users/me/sessions total + /learning/stats） -->
      <div class="history__stats">
        <div class="history__stat">
          <span>学习次数</span>
          <strong>{{ totalSessions }}<i> 次</i></strong>
        </div>
        <div class="history__stat">
          <span>累计时长</span>
          <strong>{{ totalMinutes }}<i> 分钟</i></strong>
        </div>
        <div class="history__stat">
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
              <span class="history__dot" :class="{ 'history__dot--done': isDone(s) }"></span>
              <div class="history__item-main">
                <strong>{{ taskTitle(s) }}</strong>
                <span v-if="sessionSummary(s)" class="history__item-sub">{{ sessionSummary(s) }}</span>
              </div>
              <span class="uc-badge" :class="isDone(s) ? 'uc-badge--ok' : 'uc-badge--muted'">
                {{ isDone(s) ? '已完成' : '进行中' }}
              </span>
              <span class="history__item-time">{{ s.durationMinutes ? `${s.durationMinutes} 分钟` : '—' }}</span>
              <!-- 进行中的会话：可继续学习（/learn/:taskId 会恢复或重开课） -->
              <router-link
                v-if="!isDone(s) && s.taskId"
                :to="`/learn/${s.taskId}`"
                class="history__resume"
              >继续 ›</router-link>
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
    </main>

    <!-- AI 生成提示 + 页脚：一起沉底 -->
    <div class="history__foot">
      <div class="history__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import request from '@/utils/api';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import AiContentNote from '@/components/AiContentNote.vue';
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
  completedAt?: string | null;
}

const PAGE_SIZE = 30;

const sessions = ref<SessionRecord[]>([]);
const loading = ref(false);
const loadError = ref('');
const hasMore = ref(true);

const doneStatuses = new Set(['completed', 'done', 'finished', 'closed']);

const isDone = (s: SessionRecord) =>
  doneStatuses.has(String(s.status || '').toLowerCase()) || Boolean(s.completedAt);

const taskTitle = (s: SessionRecord) => s.taskTitle || '未命名任务';

function sessionSummary(s: SessionRecord): string {
  try {
    const state = s.teachingState ? JSON.parse(s.teachingState) : null;
    const topic = state?.topicSummary || state?.summary?.topicSummary || state?.knowledgeSummary;
    if (typeof topic === 'string' && topic.trim()) return topic.trim().slice(0, 60);
    const msg = s.messages ? JSON.parse(s.messages) : null;
    if (Array.isArray(msg) && msg.length) {
      const last = msg[msg.length - 1];
      const text = String(last?.content || last?.text || '');
      if (text.trim()) return text.trim().slice(0, 60);
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

const dayKey = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '');

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
  if (loading.value) return;
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
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.history__foot { margin-top: auto; }
.history__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.history__ai-note :deep(.ai-note) { font-size: 11px; opacity: 0.75; }

.history__main {
  flex: 1;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid;
  gap: 16px;
  align-content: start;
}

.history__hero h1 {
  margin: 0 0 6px;
  font-size: 28px;
  letter-spacing: -0.01em;
}

.history__hero p {
  margin: 0;
  font-size: 13.5px;
  color: var(--muted, #5b6577);
  line-height: 1.7;
}

.history__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.history__stat {
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid var(--line, #e3e9f4);
  background: var(--surface, #fff);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
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
  border-radius: 999px;
  background: var(--faint, #67758f);
  flex: none;
}

.history__dot--done {
  background: var(--green, #1e9e58);
}

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
  border: 1px solid rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.06);
  border-radius: 999px;
  white-space: nowrap;
  transition: background 0.15s ease;
}
.history__resume:hover { background: rgba(52, 120, 246, 0.12); }

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

@media (max-width: 640px) {
  .history__stats {
    grid-template-columns: 1fr;
  }

  .history__item-time {
    display: none;
  }
}
</style>
