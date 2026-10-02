<template>
  <CapabilityShell title="学习历史" description="按时间回看你的学习会话：学了什么、学多久、完成情况。">
    <!-- 页头由 CapabilityShell 提供（个人中心 kicker + 标题 + 说明） -->
    <div class="history__body">
      <!-- 统计行（批19）：三个数字合并为一行内联统计，不再三张等权卡片。
           接口失败时整行隐藏——显 0 会让学习者误以为「没学过」 -->
      <div v-if="statsOk" class="history__stats">
        <span class="history__stat">学习 <strong>{{ totalSessions }}</strong> 次</span>
        <span class="history__stat">累计 <strong>{{ totalMinutes }}</strong> 分钟</span>
        <span class="history__stat"><strong>{{ activeDays }}</strong> 天有学习</span>
      </div>

      <!-- 整月日历（原型 wf-week/wf-day 382-405 的整月版；月导航/7 列格/图例归本页，
           看板侧只留 month-summary 一行）：点选格子筛当天，再点取消 -->
      <section v-if="!loading && !loadError && sessions.length" class="card history__month" aria-label="整月学习日历">
        <div class="month__head">
          <strong class="month__title">整月节奏</strong>
          <div class="month__nav">
            <button type="button" class="month__arrow" aria-label="上一月" @click="shiftMonth(-1)">‹</button>
            <span class="month__label">{{ monthLabel }}</span>
            <button
              type="button"
              class="month__arrow"
              :class="{ 'month__arrow--off': isCurrentMonth }"
              :disabled="isCurrentMonth"
              aria-label="下一月"
              @click="shiftMonth(1)"
            >›</button>
          </div>
          <button
            v-if="selectedDate"
            type="button"
            class="month__clear"
            @click="selectedDate = ''"
          >查看全部</button>
        </div>

        <div class="month__meta">
          <span>本月 <b>{{ monthTotals.minutes }}</b> 分钟</span>
          <span><b>{{ monthTotals.days }}</b> 天有学习</span>
          <span><b>{{ monthTotals.sessions }}</b> 次</span>
          <span class="month__legend">
            <i class="lg lg--0"></i>无
            <i class="lg lg--1"></i>&lt;30分
            <i class="lg lg--2"></i>30–60分
            <i class="lg lg--3"></i>&gt;60分
          </span>
        </div>

        <div class="month__grid">
          <span v-for="w in weekdayLabels" :key="w" class="month__wd">{{ w }}</span>
          <button
            v-for="(c, i) in monthCells"
            :key="i"
            type="button"
            class="mday"
            :class="[
              { 'mday--outside': c.outside, 'mday--future': c.future, 'mday--today': c.isToday, 'mday--selected': selectedDate === c.date && !c.outside },
              !c.outside && !c.future ? `mday--h${c.level}` : ''
            ]"
            :disabled="c.outside || c.future"
            :title="c.outside || c.future ? undefined : `${c.dayNum}日${c.minutes ? ` · ${c.minutes} 分钟` : ' · 无学习记录'}`"
            @click="toggleDay(c)"
          >{{ c.dayNum }}</button>
        </div>
        <p v-if="selectedDate" class="month__filter">只看 {{ dayDate(selectedDate) }} 的记录，再点一次格子或「查看全部」恢复。</p>
      </section>

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

      <!-- 空态（整页终态：统一结果组件） -->
      <V2ResultState
        v-else-if="!sessions.length"
        tone="empty"
        title="还没有学习记录"
        description="完成第一次学习后，这里会按时间记录你的每次会话。"
      />

      <!-- 按日期分组的会话列表（2026-09-27 重排：按「日期 → 任务」聚合，
           同一天同一个任务的多条会话合并成一条，明细用「查看每次会话」展开） -->
      <div v-else class="history__list">
        <!-- 翻页失败：内联横幅 + 「重试本页」。已加载行与页码原样保留
             （页码由 sessions.length 推出，失败时没追加数据，重试天然落在同一页） -->
        <div v-if="pageError" class="errorbar" role="alert">
          {{ pageError }}
          <button type="button" class="errorbar__retry" @click="loadMore">重试本页</button>
        </div>
        <section v-for="group in visibleGroups" :key="group.date" class="card history__day">
          <div class="history__day-head">
            <!-- 日期为主（原型 wf-hist__day-head 873-875：9月29日 周二），今昨为辅。
                 测试锁 `.history__day-head strong === ['今天']`，故日期走 <b>、今昨走 <strong> -->
            <b class="history__day-date">{{ dayDate(group.date) }}</b>
            <strong v-if="dayRel(group.date)" class="history__day-rel">{{ dayRel(group.date) }}</strong>
            <span class="muted">
              {{ group.tasks.length }} 项<template v-if="group.minutes"> · {{ group.minutes }} 分钟</template>
            </span>
          </div>
          <ul class="history__items">
            <li v-for="t in group.tasks" :key="t.key" class="history__item">
              <!-- 色点对读屏是冗余（状态文案在右侧徽章里），标记装饰；批19 aria 补课 -->
              <span class="history__dot" :class="`history__dot--${t.state}`" aria-hidden="true"></span>
              <div class="history__item-main">
                <strong>{{ t.title }}</strong>
                <!-- 副行（原型 wf-hist__item-main span 882）：时长并入这一行，
                     聚合行多带一段「N 次会话」（类名被回归测试锁定） -->
                <span class="history__item-meta">{{ metaLine(t) }}</span>
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
              <!-- 右侧（原型 wf-hist__badge 883）：状态纯文字 + 动作文字链，同列右对齐 -->
              <div class="history__aside">
                <span class="uc-badge" :class="t.sessions.length > 1 ? stateBadgeClsForState(t.state) : stateBadgeCls(t.lead)">
                  {{ t.sessions.length > 1 ? stateLabelForState(t.state) : stateLabel(t.lead) }}
                </span>
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
              </div>
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
import V2ResultState from '@/components/ui/V2ResultState.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import { localDateKey, localDateKeyFromIso } from '@/utils/date';
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
/** 首屏失败：整页错误态（列表还没内容，只能整页重试） */
const loadError = ref('');
/** 翻页失败：内联横幅，已加载行保留 */
const pageError = ref('');
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
/** 统计可用才渲染统计行：失败就隐藏，不用 0 冒充「没学过」 */
const statsOk = ref(false);

async function loadStats() {
  try {
    // totalSessions 不再单独发 limit=1 请求：首屏列表响应顶层就带 total（见 load 里回填）
    const statsRes = await request.get('/learning/stats');
    const stats = unwrap<{ time?: { totalMinutes?: number; activeLearningDays?: number } }>(statsRes);
    if (typeof stats?.time?.totalMinutes === 'number') totalMinutes.value = stats.time.totalMinutes;
    if (typeof stats?.time?.activeLearningDays === 'number') activeDays.value = stats.time.activeLearningDays;
    statsOk.value = true;
  } catch {
    /* 统计加载失败不阻塞列表：隐藏统计行（模板 v-if="statsOk"），不显 0 */
  }
}

interface DayGroup {
  date: string;
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

/** 副标：今天/昨天（其余日期不给副标，日期本身已是主标签） */
const dayRel = (dateKey: string) => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const yest = new Date(today.getTime() - 86400000);
  const ym = String(yest.getMonth() + 1).padStart(2, '0');
  const yd = String(yest.getDate()).padStart(2, '0');

  if (dateKey === `${y}-${m}-${d}`) return '今天';
  if (dateKey === `${yest.getFullYear()}-${ym}-${yd}`) return '昨天';
  return '';
};

/** 主标签（原型 wf-hist__day-head 874：「9月29日 周二」） */
const dayDate = (dateKey: string) => {
  const [yy, mm, dd] = dateKey.split('-').map(Number);
  const date = new Date(yy, (mm || 1) - 1, dd || 1);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()] || '';
  return `${mm}月${dd}日 ${week}`;
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

/** 聚合行的副行文案：聚合行带「N 次会话 · 共 X 分钟」，单会话行直接给时长（原型副行） */
function metaLine(t: TaskGroup): string {
  const mins = t.minutes ? `共 ${t.minutes} 分钟` : '';
  if (t.sessions.length > 1) {
    return `${t.sessions.length} 次会话${mins ? ` · ${mins}` : ''}`;
  }
  return t.minutes ? `${t.minutes} 分钟` : '—';
}

/** 按本地日期把会话聚成「日 → 任务行」（列表与当日筛选共用） */
function groupSessions(list: SessionRecord[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const s of list) {
    const key = dayKey(s.startTime || s.endTime);
    if (!key) continue;
    let group = map.get(key);
    if (!group) {
      group = { date: key, minutes: 0, items: [], tasks: [] };
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
}

const groupedSessions = computed<DayGroup[]>(() => groupSessions(sessions.value));

/** 日历点选的当天筛选：命中即只渲染这一天（数据取自整月请求，不受列表分页限制） */
const selectedDate = ref('');
const visibleGroups = computed<DayGroup[]>(() => {
  if (!selectedDate.value) return groupedSessions.value;
  return groupSessions(monthSessions.value.filter((s) => dayKey(s.startTime || s.endTime) === selectedDate.value));
});

/* ---------- 整月日历（原型 wf-day 384-399 的整月版；月导航/7 列格/图例归本页） ----------
   数据独立于列表分页：/users/me/sessions 带 startDate/endDate + limit=500 拉整月。
   请求必须排在列表分页请求之后（回归测试锁 listCalls[0] = {page:1, limit:30}）。 */
const monthSessions = ref<SessionRecord[]>([]);
const monthCursor = ref({ year: new Date().getFullYear(), month: new Date().getMonth() });
const todayStr = localDateKey(new Date());

const monthLabel = computed(() => `${monthCursor.value.year}年${monthCursor.value.month + 1}月`);
const isCurrentMonth = computed(() => {
  const now = new Date();
  return monthCursor.value.year === now.getFullYear() && monthCursor.value.month === now.getMonth();
});

/** 热力等级 0-3：<0 / <30 / ≤60 / >60 分钟（与原型图例四档一致） */
function heatLevel(m: number): 0 | 1 | 2 | 3 {
  if (m <= 0) return 0;
  if (m < 30) return 1;
  if (m <= 60) return 2;
  return 3;
}

/* 翻月竞态：快速连点时慢的旧请求后到会覆盖新月份，只接受最后一次发起的结果 */
let monthSeq = 0;

async function fetchMonthSessions(cursor: { year: number; month: number }) {
  const ym = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const lastDate = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const res = await request.get('/users/me/sessions', {
    params: { startDate: `${ym}-01`, endDate: `${ym}-${String(lastDate).padStart(2, '0')}`, limit: 500 }
  });
  const data = unwrap<{ sessions?: SessionRecord[] }>(res);
  return Array.isArray(data) ? (data as unknown as SessionRecord[]) : data?.sessions || [];
}

async function loadMonth() {
  const seq = ++monthSeq;
  try {
    const list = await fetchMonthSessions(monthCursor.value);
    if (seq === monthSeq) monthSessions.value = list;
  } catch {
    /* 月历失败不影响列表：清空即全部格子无色 */
    if (seq === monthSeq) monthSessions.value = [];
  }
}

function shiftMonth(dir: number) {
  if (dir > 0 && isCurrentMonth.value) return;
  const d = new Date(monthCursor.value.year, monthCursor.value.month + dir, 1);
  monthCursor.value = { year: d.getFullYear(), month: d.getMonth() };
  void loadMonth();
}

interface MonthCell {
  date: string;
  dayNum: number;
  minutes: number;
  outside: boolean;
  future: boolean;
  isToday: boolean;
  level: 0 | 1 | 2 | 3;
}

const minutesByDate = computed(() => {
  const map = new Map<string, number>();
  for (const s of monthSessions.value) {
    const key = dayKey(s.startTime || s.endTime);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + (s.durationMinutes || 0));
  }
  return map;
});

/** 月格：周一为一周之始（与日历图例口径一致），前后补满整周 */
const monthCells = computed<MonthCell[]>(() => {
  const { year, month } = monthCursor.value;
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ date: '', dayNum: prevDays - i, minutes: 0, outside: true, future: false, isToday: false, level: 0 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const future = date > todayStr;
    const minutes = future ? 0 : minutesByDate.value.get(date) ?? 0;
    cells.push({ date, dayNum: d, minutes, outside: false, future, isToday: date === todayStr, level: heatLevel(minutes) });
  }
  const tail = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= tail; d++) {
    cells.push({ date: '', dayNum: d, minutes: 0, outside: true, future: false, isToday: false, level: 0 });
  }
  return cells;
});

const monthTotals = computed(() => {
  let minutes = 0;
  let days = 0;
  for (const [, m] of minutesByDate.value) {
    if (m > 0) { minutes += m; days += 1; }
  }
  return { minutes, days, sessions: monthSessions.value.length };
});

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];

/** 点选当天筛选列表（再点同一天取消）；选中的格子必须落在已加载的整月数据里 */
function toggleDay(cell: MonthCell) {
  if (cell.outside || cell.future) return;
  selectedDate.value = selectedDate.value === cell.date ? '' : cell.date;
}

async function load(reset = false) {
  // 首屏（sessions 空且 loading=true 初始）允许进入；后续加载中拦截（防并发翻页）
  if (loading.value && sessions.value.length > 0) return;
  loading.value = true;
  loadError.value = '';
  pageError.value = '';
  // 只有首屏失败才进整页错误态；翻页失败必须保住已加载的列表
  const isFirstScreen = reset || sessions.value.length === 0;
  try {
    const page = reset ? 1 : Math.floor(sessions.value.length / PAGE_SIZE) + 1;
    const res = await request.get('/users/me/sessions', {
      params: { page, limit: PAGE_SIZE }
    });
    // total 在响应顶层（与 data 平级，unwrap 只取 data）：首屏顺带回填「学习 N 次」统计，
    // 省掉原来单独的 limit=1 请求
    const body = res as { total?: number };
    if (typeof body?.total === 'number') totalSessions.value = body.total;
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
    // 翻页失败不动 sessions：已加载行保留，页码由 length 推出、天然落在失败的那一页
    if (isFirstScreen) {
      loadError.value = '无法读取学习记录，请稍后重试。';
    } else {
      pageError.value = '本页加载失败，已加载的记录仍保留。';
    }
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  void load(false);
}

onMounted(() => {
  // 顺序即契约：列表分页请求必须先发（回归测试锁 listCalls[0] = {page:1,limit:30}），整月日历随后
  void load(true);
  void loadStats();
  void loadMonth();
});
</script>

<style scoped>
/* AI 提示：页脚由 CapabilityShell 提供，这里只留一行居中说明 */
.history__ai-note {
  display: flex; justify-content: center;
  padding: 4px 0 0;
}
.history__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }

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
  color: var(--muted);
}

.history__stat strong {
  /* 17 → 16：行内次级数字档 */
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  margin: 0 2px;
}

.history__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 0;
  color: var(--faint);
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
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

/* 主标签（原型 wf-hist__day-head strong 874）：「9月29日 周二」 */
.history__day-date {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}
/* 副标：今天/昨天（原型没有，但列表里昨夜/前天的相对时间比年月日更好读） */
.history__day-rel {
  font-size: 12px;
  font-weight: 700;
  color: var(--blue-deep);
}
.history__day-head .muted { margin-left: auto; }

/* 日分组右侧的计数/时长是次级信息：12px + faint。
   原来这里只有 V2LearningState 有 `.muted`，本页照抄了同一份 markup 却没带样式，
   于是继承壳的 16px 基座——和左边的日期标题一样大，一眼看不出主次（2026-09-24 指出）。 */
.muted { font-size: 12px; color: var(--faint); font-weight: 600; }

/* 状态徽章改纯文字（原型 wf-hist__badge 883：11.5px 纯字重，无底无框）；
   uc-badge 类名被回归测试锁定（`.history__item .uc-badge` ×5），故保留类、清掉底/内边距。
   字号走 12px 下限（规则 16）。 */
.history__item .uc-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 0;
  line-height: 1.5;
  background: none;
}
.history__item .uc-badge--warn { background: none; }

.history__items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
}

/* 行内元素顶对齐（原型 wf-hist__item 876-877）：色点带 6px 上边距贴首行 */
.history__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.history__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--mk-radius-pill);
  background: var(--faint);
  flex: none;
  margin-top: 6px;
}

.history__dot--completed { background: var(--green); }
.history__dot--resumable { background: var(--blue); }
.history__dot--ended { background: var(--faint); }

.history__item-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.history__item-main strong {
  font-size: 14px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 聚合行/单行副行（原型 wf-hist__item-main span 882：12px muted）：
   聚合行带「N 次会话 · 共 X 分钟」，单会话行直接是时长（时长并入副行） */
.history__item-meta {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

/* 明细展开（同日同任务的每次会话） */
.history__subs { margin-top: 4px; }
.history__subs > summary {
  cursor: pointer;
  width: fit-content;
  font-size: 12px;
  color: var(--blue-deep);
}
.history__sublist {
  list-style: none;
  margin: 6px 0 0;
  padding: 0 0 0 10px;
  display: grid;
  gap: 6px;
  border-left: 2px solid var(--line);
}
.history__sublist li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.history__sub-time { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.history__sub-min { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }

/* 摘要（原型没有，Vue 侧保留）：12px faint，单行省略 */
.history__item-sub {
  font-size: 12px;
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右侧列：状态纯文字 + 动作文字链，右对齐同列 */
.history__aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex: none;
  margin-left: auto;
}

/* 动作改文字链（原型无动作行，但「继续/查看反馈」是本页主要出口，保留）：
   13px/700 蓝链 + 36px 触控高（mobile:spec 的 lt36 门禁） */
.history__resume,
.history__feedback,
.history__restart {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0;
  border: 0;
  background: none;
  font-size: 13px;
  font-weight: 700;
  color: var(--blue-deep);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s ease;
}
.history__resume:hover,
.history__feedback:hover,
.history__restart:hover {
  color: var(--blue);
  text-decoration: underline;
}

.history__more {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.history__end {
  text-align: center;
  font-size: 12px;
  color: var(--faint);
  padding: 4px 0;
}

/* ── 整月日历（原型 wf-week/wf-day 382-405 的整月版） ── */
.history__month {
  padding: 14px 18px;
  display: grid;
  gap: 12px;
}
.month__head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.month__title { font-size: 14px; font-weight: 700; color: var(--ink); }
.month__nav {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
}
.month__arrow {
  width: 36px;
  height: 36px;
  border-radius: var(--mk-radius-md);
  border: 1px solid var(--line);
  background: var(--surface);
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--muted);
  font-size: 16px;
  line-height: 1;
}
.month__arrow--off { opacity: 0.35; cursor: default; }
.month__clear {
  min-height: 36px;
  padding: 0 4px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--blue-deep);
  cursor: pointer;
}
.month__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}
.month__meta b { color: var(--ink); font-weight: 800; }
.month__legend {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--faint);
}
.lg {
  width: 12px;
  height: 12px;
  border-radius: var(--mk-radius-xs);
  display: inline-block;
}
/* 热力四档：只走 token 派生（h3 用 --mk-on-fill = 饱和深底上的白字） */
.lg--0, .mday--h0 { background: var(--canvas); color: var(--muted); }
.lg--1, .mday--h1 { background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue-deep); }
.lg--2, .mday--h2 { background: color-mix(in srgb, var(--blue) 32%, transparent); color: var(--blue-deep); }
.lg--3, .mday--h3 { background: color-mix(in srgb, var(--blue) 85%, transparent); color: var(--mk-on-fill); }

.month__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
.month__wd {
  text-align: center;
  font-size: 12px;
  color: var(--faint);
}
.mday {
  min-height: 36px;
  border-radius: var(--mk-radius-lg);
  border: 1px solid transparent;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.mday--outside, .mday--future {
  background: none;
  color: var(--faint);
  font-weight: 500;
  cursor: default;
}
.mday--today { border-color: var(--blue); }
.mday--selected { border-color: var(--blue-deep); box-shadow: inset 0 0 0 1px var(--blue-deep); }
.month__filter {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
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

  .history__day-head {
    gap: 6px;
  }

  .history__day-date {
    font-size: 14px;
  }

  /* 行内边距 10→9、间距 10→8：一行省 16px，24 条就是 380px；顺带把标题的可用宽度
     从 104px 提到 ~160px（比例问题：标题才是这一行里最该看清的东西） */
  .history__item {
    padding: 9px 0;
    gap: 8px;
  }

  .history__item-main strong {
    font-size: 13px;
  }

  .history__item-sub {
    font-size: 12px;
  }

  /* 右侧列在窄屏改成横排：状态文字与动作链一行放得下，列堆叠会把标题挤成两行 */
  .history__aside {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }

  .history__month {
    padding: 12px;
  }

  .month__nav {
    margin-left: auto;
  }

  .month__legend {
    margin-left: 0;
    width: 100%;
  }

  .mday {
    /* 触控目标不低于 36（mobile:spec 的 lt36 门禁）：窄屏 7 列仍放得下 */
    min-height: 36px;
    font-size: 12.5px;
  }

  .history__end {
    padding: 2px 0;
    font-size: 12px;
  }
}
</style>
