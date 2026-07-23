<template>
  <div class="dash">
    <!-- 应用导航（共享组件） -->
    <MockNav active="dashboard" />

    <main class="dash__main">
      <!-- 压缩问候栏 -->
      <div class="greet">
        <div class="greet__left">
          <strong>下午好，123</strong>
          <span class="greet__dot"></span>
          <span>7月19日 周日</span>
        </div>
        <div v-if="state !== 'empty'" class="streak" title="连续学习天数">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
          连续 2 天 · 今天还没开始
        </div>
      </div>

      <!-- AI 提示条 -->
      <div v-if="!tipDismissed" class="tip" :class="`tip--${state}`">
        <span class="tip__icon">
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74c.6.52 1 1.31 1 2.26v1h6v-1c0-.95.4-1.74 1-2.26A7 7 0 0 0 12 2z"/></svg>
        </span>
        <p>{{ tipText }}</p>
        <span class="tip__close" title="知道了" @click="tipDismissed = true">×</span>
      </div>

      <!-- 主区：今日行动 + 路径进度 -->
      <div class="dash__grid-main">
        <!-- 进行中：今日行动卡 -->
        <section v-if="state === 'active'" class="card action">
          <!-- 休息态 -->
          <template v-if="resting">
            <div class="action__eyebrow action__eyebrow--rest"><span>今天休息</span></div>
            <h1 class="action__title">给自己放个小假</h1>
            <p class="action__desc">连续记录会在明天重新计算。想回来的时候，任务还在这里等你。</p>
            <div class="action__footer">
              <span class="btn-primary" @click="resting = false">恢复学习</span>
            </div>
          </template>
          <!-- 正常任务态 -->
          <template v-else>
            <div class="action__eyebrow">
              <span>今日行动</span>
              <span class="action__from">来自路径「Excel 报表自动化」</span>
            </div>
            <transition name="task-fade" mode="out-in">
              <div :key="taskIndex" class="action__task">
                <h1 class="action__title">{{ currentTask.title }}</h1>
                <p class="action__desc">{{ currentTask.desc }}</p>
                <div class="action__meta">
                  <span class="tag tag--blue">阶段 2 / 4</span>
                  <span class="tag">约 {{ currentTask.minutes }} 分钟</span>
                  <span class="tag">{{ currentTask.kind }}</span>
                </div>
              </div>
            </transition>
            <div class="action__footer">
              <span class="btn-primary" @click="labGo('learning')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                开始学习
              </span>
              <span class="btn-ghost" @click="cycleTask">换一个</span>
              <span class="link-muted" @click="resting = true">今天休息</span>
            </div>
            <div class="action__today">
              <div class="action__today-bar"><i :style="{ width: todayPercent + '%' }"></i></div>
              <span>今日已学 0 / {{ currentTask.minutes }} 分钟</span>
            </div>
          </template>
        </section>

        <!-- 需要处理：修复卡 -->
        <section v-else-if="state === 'attention'" class="card action action--alert">
          <template v-if="regenPhase === 'done'">
            <div class="action__eyebrow action__eyebrow--ok"><span>已就绪</span></div>
            <h1 class="action__title">路径重新生成成功</h1>
            <p class="action__desc">4 个阶段已经就位，今天的第一个任务可以开始了。</p>
            <div class="action__footer">
              <span class="btn-primary" @click="labGo('learning')">开始学习</span>
            </div>
          </template>
          <template v-else>
            <div class="action__eyebrow action__eyebrow--alert">
              <span>需要先处理</span>
              <span class="action__from">路径「Excel 报表自动化」</span>
            </div>
            <h1 class="action__title">这版路径没生成出来，重试一般能好</h1>
            <p class="action__desc">主结构生成失败（服务响应异常）。你的目标和已确认信息都保留着，不会丢。</p>
            <div class="action__meta">
              <span class="tag tag--red">生成失败</span>
              <span class="tag">已自动重试 1 次</span>
              <span class="tag">信息已保留</span>
            </div>
            <div class="action__footer">
              <span class="btn-primary" :class="{ 'btn-primary--busy': regenPhase === 'working' }" @click="doRegen">
                <span v-if="regenPhase === 'working'" class="mini-spinner"></span>
                {{ regenPhase === 'working' ? '正在重新生成…' : '重新生成路径' }}
              </span>
              <span class="btn-ghost">查看失败详情</span>
              <span class="link-muted" @click="labGo('goal')">先修改目标</span>
            </div>
          </template>
        </section>

        <!-- 新手态：引导卡 -->
        <section v-else class="card action action--empty">
          <div class="action__eyebrow"><span>开始你的第一个学习计划</span></div>
          <h1 class="action__title">用 2 分钟，聊出一条能执行的路径</h1>
          <p class="action__desc">不用整理、不用说得很准。讲讲最近想解决的事，问流会帮你收敛成目标和阶段安排。</p>
          <div class="action__examples">
            <span v-for="e in examples" :key="e" class="example" @click="labGo('goal')">{{ e }}</span>
          </div>
          <div class="action__footer">
            <span class="btn-primary" @click="labGo('goal')">开始规划目标</span>
            <span class="link-muted" @click="labGo('paths')">先看看路径长什么样</span>
          </div>
        </section>

        <!-- 路径进度卡 -->
        <aside v-if="state !== 'empty'" class="card path">
          <div class="path__head">
            <div class="path__title">
              <strong>Excel 报表自动化</strong>
              <span class="path__sub">每天 1 小时 · 目标 1 周</span>
            </div>
            <span class="badge" :class="state === 'attention' ? 'badge--red' : 'badge--blue'">
              {{ state === 'attention' ? '需要处理' : '进行中' }}
            </span>
          </div>
          <ol class="steps">
            <li class="step step--done">
              <span class="step__dot"></span>
              <div class="step__body"><strong>Python 环境搭建与基础概念</strong><small>已完成 · 用时 40 分钟</small></div>
            </li>
            <li class="step" :class="state === 'attention' ? 'step--blocked' : 'step--current'">
              <span class="step__dot"></span>
              <div class="step__body">
                <strong>pandas 读取单个 Excel 文件</strong>
                <small>{{ state === 'attention' ? '等待路径生成完成' : '进行中 · 今天从这里开始' }}</small>
              </div>
            </li>
            <li class="step">
              <span class="step__dot"></span>
              <div class="step__body"><strong>将数据写入 / 追加到汇总表</strong><small>未开始</small></div>
            </li>
            <li class="step">
              <span class="step__dot"></span>
              <div class="step__body"><strong>封装脚本并测试</strong><small>未开始</small></div>
            </li>
          </ol>
          <div class="path__foot">
            <div class="path__progress"><i :style="{ width: state === 'attention' ? '25%' : '40%' }"></i></div>
            <div class="path__nums">
              <span>整体 {{ state === 'attention' ? '25%' : '40%' }}</span>
              <span>预计还需 4.5 小时</span>
            </div>
          </div>
        </aside>

        <!-- 新手态路径占位卡 -->
        <aside v-else class="card path path--empty">
          <div class="path__head">
            <div class="path__title"><strong>还没有学习路径</strong></div>
          </div>
          <div class="path__empty-body">
            <div class="path__empty-illus"><span></span><span></span><span></span><span></span></div>
            <p>规划第一个目标后，这里会出现你的阶段地图。</p>
          </div>
        </aside>
      </div>

      <!-- 本周节奏 + 激励区 -->
      <div class="dash__grid-week">
        <section class="card week">
          <div class="card-head">
            <strong>本周节奏</strong>
            <span v-if="state !== 'empty'" class="link-muted" @click="monthOpen = !monthOpen">
              {{ monthOpen ? '收起整月' : '展开整月 ›' }}
            </span>
          </div>
          <div v-if="state !== 'empty'" class="week__grid">
            <button
              v-for="d in week"
              :key="d.label"
              type="button"
              class="day"
              :class="{ 'day--today': d.today, 'day--selected': selectedDate === d.date }"
              @click="selectDay(d.date)"
            >
              <span class="day__label">{{ d.label }}</span>
              <span class="day__cell" :style="{ background: d.color, color: d.ink }">{{ d.minutes || '' }}</span>
              <span class="day__min">{{ d.minutes ? d.minutes + '分' : '—' }}</span>
            </button>
          </div>
          <div v-else class="week__empty">完成第一次学习后，这里会点亮你的节奏。</div>
          <div v-if="state !== 'empty'" class="week__stats">
            <span>近 7 天 <b>170</b> 分钟</span>
            <span><b>4</b> 天有学习</span>
            <span>比前 7 天多 <b>85</b> 分钟</span>
          </div>
        </section>

        <div class="side-stack">
          <section class="card mini">
            <div class="mini__icon mini__icon--flame">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
            </div>
            <div>
              <strong>{{ state === 'empty' ? '点亮第一天' : '连续 2 天' }}</strong>
              <p>{{ state === 'empty' ? '今天学 10 分钟，开始连续记录' : '今天再学 25 分钟，续上第 3 天' }}</p>
            </div>
          </section>
          <section class="card mini">
            <div class="mini__icon mini__icon--medal">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>
            </div>
            <div>
              <strong>成就「小步快跑」</strong>
              <p>{{ state === 'empty' ? '完成 3 次学习即可解锁' : '再完成 1 次学习即可解锁' }}</p>
            </div>
          </section>
        </div>
      </div>

      <!-- 整月日历（可展开） -->
      <section v-if="state !== 'empty' && monthOpen" class="card month">
        <div class="card-head">
          <strong>整月节奏</strong>
        <div class="month__nav">
            <span class="month__arrow" :class="{ 'month__arrow--off': monthKey === '2026-06' }" @click="shiftMonth(-1)">‹</span>
            <span>{{ monthKey === '2026-07' ? '2026年7月' : '2026年6月' }}</span>
            <span class="month__arrow" :class="{ 'month__arrow--off': monthKey === '2026-07' }" @click="shiftMonth(1)">›</span>
          </div>
          <span class="link-muted" @click="monthOpen = false">收起</span>
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
        <div class="month__body">
          <div class="month__weeks">
            <div v-for="w in monthWeeks" :key="w.label" class="mweek">
              <div class="mweek__side">
                <strong>{{ w.label }}</strong>
                <small>{{ w.minutes }}分 · {{ w.days }}天</small>
              </div>
              <div class="mweek__days">
                <button
                  v-for="d in w.cells"
                  :key="w.label + d.num"
                  type="button"
                  class="mday"
                  :class="{
                    'mday--prev': d.prev,
                    'mday--future': d.future,
                    'mday--today': d.today,
                    'mday--selected': selectedDate === d.date && !d.prev && !d.future
                  }"
                  :style="!d.prev && !d.future ? { background: d.color, color: d.ink } : {}"
                  :disabled="d.prev || d.future"
                  @click="selectDayInMonth(d.date)"
                >
                  {{ d.num }}
                </button>
              </div>
            </div>
          </div>
          <aside class="day-detail">
            <div class="day-detail__date">{{ selectedInfo.title }}</div>
            <template v-if="selectedInfo.minutes > 0">
              <div class="day-detail__grid">
                <div><small>总时长</small><strong>{{ selectedInfo.minutes }} 分钟</strong></div>
                <div><small>学习次数</small><strong>{{ selectedInfo.sessions }} 次</strong></div>
                <div><small>强度</small><strong>{{ selectedInfo.zone }}</strong></div>
                <div><small>主要内容</small><strong>{{ selectedInfo.topic }}</strong></div>
              </div>
              <p class="day-detail__note">{{ selectedInfo.note }}</p>
            </template>
            <p v-else class="day-detail__empty">{{ selectedInfo.note }}</p>
          </aside>
        </div>
      </section>

      <!-- 快捷入口 -->
      <div class="quick">
        <span class="quick__item" @click="labGo('state')">
          <span class="quick__icon quick__icon--pulse">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 13h4l2-7 4 12 2-7h6v2h-4.6l-2.4 8.4L9.6 7.6 7.6 15H3v-2z"/></svg>
          </span>
          <span class="quick__body"><strong>学习状态</strong><small>节奏 · 负荷 · AI 建议</small></span>
          <span class="quick__go">›</span>
        </span>
        <span class="quick__item" @click="labGo('paths')">
          <span class="quick__icon quick__icon--layers">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 2 10 5-10 5L2 7l10-5zm0 7.6L18.9 7 12 4.4 5.1 7 12 9.6zM2 12l10 5 10-5v2l-10 5L2 14v-2zm0 5 10 5 10-5v2l-10 5L2 19v-2z" opacity=".9"/></svg>
          </span>
          <span class="quick__body"><strong>全部路径</strong><small>{{ state === 'empty' ? '还没有路径' : '1 条进行中' }}</small></span>
          <span class="quick__go">›</span>
        </span>
        <span class="quick__item" @click="labGo('achievements')">
          <span class="quick__icon quick__icon--medal">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2z"/></svg>
          </span>
          <span class="quick__body"><strong>成就</strong><small>{{ state === 'empty' ? '完成学习即可解锁' : '已解锁 2 / 8' }}</small></span>
          <span class="quick__go">›</span>
        </span>
      </div>
    </main>
    <MockFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MockNav from './MockNav.vue';
import MockFooter from './MockFooter.vue';
import { labGo } from './labStore';

const props = defineProps<{ state: 'active' | 'attention' | 'empty' }>();

/* ---------- 视图状态 ---------- */
const monthOpen = ref(false);
type MonthKey = '2026-07' | '2026-06';

const monthKey = ref<MonthKey>('2026-07');
const selectedDate = ref('2026-07-18');
const tipDismissed = ref(false);
const resting = ref(false);
const regenPhase = ref<'idle' | 'working' | 'done'>('idle');

watch(
  () => props.state,
  () => {
    tipDismissed.value = false;
    resting.value = false;
    regenPhase.value = 'idle';
  }
);

/* ---------- AI 提示 ---------- */
const tipText = computed(() => {
  if (props.state === 'attention') return '路径生成失败通常是暂时的。重新生成约 30 秒，已确认的信息都会保留。';
  if (props.state === 'empty') return '不确定学什么？就从最近最花时间的那件麻烦事聊起。';
  return '你最近 3 次学习都在 21 点后。趁下午状态好，现在 25 分钟就能完成今天的任务。';
});

/* ---------- 今日任务（可轮换） ---------- */
const tasks = [
  { title: '用 pandas 读取销售报表，预览前 5 行数据', desc: '三行代码读完一个 Excel 文件。学完这一步，你就拿到了自动化的第一块积木。', minutes: 25, kind: '练手任务' },
  { title: '看懂 read_excel 的 3 个常用参数', desc: 'sheet_name、usecols、dtype。弄明白它们，读取报表时少走弯路。', minutes: 15, kind: '概念巩固' },
  { title: '把读出的数据存成临时副本', desc: '给报表数据做个“快照”，为下一步写入汇总表做准备。', minutes: 20, kind: '小步练习' }
];
const taskIndex = ref(0);
const currentTask = computed(() => tasks[taskIndex.value]);
const todayPercent = ref(0);
function cycleTask() {
  taskIndex.value = (taskIndex.value + 1) % tasks.length;
}

const examples = ['用 Python 自动化处理 Excel 报表', '提升职场沟通和表达能力', '用 AI 工具做自媒体副业'];

/* ---------- 修复卡：重新生成 ---------- */
function doRegen() {
  if (regenPhase.value !== 'idle') return;
  regenPhase.value = 'working';
  window.setTimeout(() => {
    regenPhase.value = 'done';
  }, 2200);
}

/* ---------- 热力色 ---------- */
const heat = (m: number) => {
  if (m <= 0) return { color: '#eef2f8', ink: '#8190a5' };
  if (m < 30) return { color: 'rgba(52,120,246,.20)', ink: '#1f57cc' };
  if (m <= 60) return { color: 'rgba(52,120,246,.45)', ink: '#10337e' };
  return { color: 'rgba(52,120,246,.85)', ink: '#fff' };
};

/* ---------- 本周条（7/13 - 7/19，今天 19 日周日） ---------- */
const rawWeek = [
  { label: '一', date: '2026-07-13', minutes: 35 },
  { label: '二', date: '2026-07-14', minutes: 0 },
  { label: '三', date: '2026-07-15', minutes: 50 },
  { label: '四', date: '2026-07-16', minutes: 0 },
  { label: '五', date: '2026-07-17', minutes: 20 },
  { label: '六', date: '2026-07-18', minutes: 65 },
  { label: '日', date: '2026-07-19', minutes: 0, today: true }
];
const week = computed(() =>
  rawWeek.map((d) => ({ ...d, ...heat(props.state === 'empty' ? 0 : d.minutes) }))
);

/* ---------- 整月日历（6 月 / 7 月） ---------- */
type Cell = { num: number; date: string; minutes: number; prev?: boolean; future?: boolean; today?: boolean; color: string; ink: string };
type WeekRow = { label: string; minutes: number; days: number; cells: Cell[] };

const MONTHS = {
  '2026-07': { year: 2026, monthIdx: 6, today: 19, minutesMap: { 2: 30, 3: 15, 6: 25, 9: 40, 11: 20, 13: 35, 15: 50, 17: 20, 18: 65 } as Record<number, number> },
  '2026-06': { year: 2026, monthIdx: 5, today: 0, minutesMap: { 3: 20, 10: 30, 17: 25, 24: 40 } as Record<number, number> }
};

function isoDate(year: number, monthIdx: number, day: number): string {
  const date = new Date(year, monthIdx, day);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function buildMonth(cfg: (typeof MONTHS)['2026-07']): WeekRow[] {
  const { year, monthIdx, today, minutesMap } = cfg;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const startOffset = new Date(year, monthIdx, 1).getDay();
  const prevDays = new Date(year, monthIdx, 0).getDate();

  const cells: Cell[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    const day = prevDays - i;
    cells.push({ num: day, date: isoDate(year, monthIdx - 1, day), minutes: 0, prev: true, color: 'transparent', ink: 'inherit' });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const isFuture = today > 0 && d > today;
    const minutes = isFuture ? 0 : (minutesMap[d] ?? 0);
    cells.push({ num: d, date: isoDate(year, monthIdx, d), minutes, future: isFuture, today: d === today, ...heat(minutes) });
  }
  const tail = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= tail; d++) {
    cells.push({ num: d, date: isoDate(year, monthIdx + 1, d), minutes: 0, prev: true, color: 'transparent', ink: 'inherit' });
  }

  const rows: WeekRow[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const slice = cells.slice(i, i + 7);
    const learned = slice.filter((c) => c.minutes > 0);
    const hasToday = slice.some((c) => c.today);
    rows.push({
      label: hasToday ? '本周' : `第${rows.length + 1}周`,
      minutes: learned.reduce((s, c) => s + c.minutes, 0),
      days: learned.length,
      cells: slice
    });
  }
  return rows;
}

const monthWeeks = computed(() => buildMonth(MONTHS[monthKey.value]));

const monthTotals = computed(() => {
  const map = MONTHS[monthKey.value].minutesMap;
  const minutes = Object.values(map).reduce((s, m) => s + m, 0);
  const days = Object.keys(map).length;
  const sessions = Object.values(map).reduce((s, m) => s + (m >= 50 ? 2 : 1), 0);
  return { minutes, days, sessions };
});

function shiftMonth(dir: number) {
  if (dir < 0 && monthKey.value === '2026-07') monthKey.value = '2026-06';
  if (dir > 0 && monthKey.value === '2026-06') monthKey.value = '2026-07';
  const day = Number(selectedDate.value.slice(-2));
  const cfg = MONTHS[monthKey.value];
  const clampedDay = Math.min(day, new Date(cfg.year, cfg.monthIdx + 1, 0).getDate());
  selectedDate.value = isoDate(cfg.year, cfg.monthIdx, clampedDay);
}

/* ---------- 选中日详情 ---------- */
const topics: Record<string, Record<number, string>> = {
  '2026-07': {
    2: 'Python 安装与环境配置', 3: '变量与文件路径练习', 6: 'pandas 入门',
    9: 'read_excel 练习', 11: '数据预览与筛选', 13: 'pandas 读取练习',
    15: '写入汇总表演示', 17: '追加数据练习', 18: '阶段 2 练习复盘'
  },
  '2026-06': { 3: '环境准备', 10: '基础语法入门', 17: '文件读写练习', 24: '小测验复盘' }
};

const weekdayName = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const selectedInfo = computed(() => {
  const selectedMonthKey = selectedDate.value.slice(0, 7) as MonthKey;
  const d = Number(selectedDate.value.slice(-2));
  const cfg = MONTHS[selectedMonthKey];
  const minutes = cfg.minutesMap[d] ?? 0;
  const date = new Date(cfg.year, cfg.monthIdx, d);
  const monthNum = cfg.monthIdx + 1;
  const isToday = cfg.today === d;
  const title = `${monthNum}月${d}日 ${weekdayName[date.getDay()]}${isToday ? ' · 今天' : ''}`;
  if (minutes <= 0) {
    return { title, minutes, sessions: 0, zone: '', topic: '', note: isToday ? '今天还没有学习记录，完成今日任务后会显示在这里。' : '当天没有学习记录。' };
  }
  const sessions = minutes >= 50 ? 2 : 1;
  const zone = minutes < 60 ? '轻度' : minutes <= 120 ? '中度' : '高强度';
  const note = d === 18 && selectedMonthKey === '2026-07' ? '本周最长的一次学习，阶段 2 的第一个练习完成了。' : '完成情况良好，节奏稳定。';
  return { title, minutes, sessions, zone, topic: topics[selectedMonthKey][d] ?? '自由练习', note };
});

function selectDay(date: string) {
  if (props.state === 'empty') return;
  selectedDate.value = date;
  monthKey.value = date.slice(0, 7) as MonthKey;
  monthOpen.value = true;
}

/* 月历内选日：保持当前月份 */
function selectDayInMonth(date: string) {
  selectedDate.value = date;
}
</script>


<style scoped>
/* ---------- 导航 ---------- */
.nav {
  display: flex; align-items: center; gap: 28px;
  padding: 0 28px; height: 60px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--line);
}
.nav__brand { display: flex; align-items: center; gap: 9px; }
.nav__logo {
  width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff; font-size: 14px; font-weight: 800;
  display: grid; place-items: center;
}
.nav__name { font-weight: 700; font-size: 14px; }
.nav__links { display: flex; gap: 4px; flex: 1; }
.nav__links a {
  padding: 7px 12px; border-radius: 9px;
  font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer;
}
.nav__links a.active { color: var(--blue-deep); background: rgba(52, 120, 246, 0.09); }
.nav__right { display: flex; align-items: center; gap: 12px; }
.nav__cta {
  padding: 8px 16px; border-radius: 999px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 13px; font-weight: 700;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.28); cursor: pointer;
}
.nav__avatar { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; }
.nav__avatar i {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--blue-deep); color: #fff;
  font-style: normal; font-size: 12px;
  display: grid; place-items: center;
}

/* ---------- 布局 ---------- */
.dash__main {
  max-width: 1180px; margin: 0 auto;
  padding: 22px 28px 40px;
  display: grid; gap: 16px;
}
.greet { display: flex; align-items: center; justify-content: space-between; padding: 0 4px; }
.greet__left { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--muted); }
.greet__left strong { font-size: 16px; color: var(--ink); }
.greet__dot { width: 4px; height: 4px; border-radius: 50%; background: var(--faint); }
.streak {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: #b3540a;
  background: rgba(244, 170, 70, 0.16);
  border: 1px solid rgba(244, 170, 70, 0.35);
  padding: 5px 11px; border-radius: 999px;
}

/* ---------- AI 提示条 ---------- */
.tip {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.18);
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.07), rgba(67, 176, 216, 0.05));
}
.tip--attention { border-color: rgba(239, 117, 120, 0.25); background: linear-gradient(135deg, rgba(239, 117, 120, 0.07), rgba(244, 170, 70, 0.05)); }
.tip--empty { border-color: rgba(141, 107, 255, 0.22); background: linear-gradient(135deg, rgba(141, 107, 255, 0.07), rgba(52, 120, 246, 0.04)); }
.tip__icon {
  width: 26px; height: 26px; border-radius: 8px;
  background: #fff; color: var(--blue-deep);
  display: grid; place-items: center; flex: 0 0 auto;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.1);
}
.tip--attention .tip__icon { color: #c0454a; }
.tip--empty .tip__icon { color: var(--accent); }
.tip p { margin: 0; flex: 1; font-size: 13px; line-height: 1.6; color: var(--ink); }
.tip__close { color: var(--faint); font-size: 16px; cursor: pointer; padding: 2px 6px; }

/* ---------- 卡片基座 ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}
.card-head { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.link-muted { font-size: 13px; font-weight: 600; color: var(--faint); cursor: pointer; }
.link-muted:hover { color: var(--blue-deep); }

/* ---------- 主区 ---------- */
.dash__grid-main {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}
.action {
  padding: 26px 28px;
  display: flex; flex-direction: column; gap: 12px;
  position: relative; overflow: hidden;
}
.action::before {
  content: ''; position: absolute; inset: 0 auto 0 0; width: 4px;
  background: linear-gradient(180deg, var(--blue), var(--accent));
}
.action--alert::before { background: linear-gradient(180deg, var(--red), var(--amber)); }
.action--empty::before { background: linear-gradient(180deg, var(--cyan), var(--blue)); }
.action__eyebrow {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; font-weight: 800; letter-spacing: 0.06em; color: var(--blue-deep);
}
.action__eyebrow--alert { color: #c0454a; }
.action__from { font-weight: 600; letter-spacing: 0; color: var(--faint); }
.action__title { margin: 0; font-size: 26px; line-height: 1.3; letter-spacing: -0.01em; }
.action__desc { margin: 0; font-size: 14px; line-height: 1.7; color: var(--muted); max-width: 56ch; }
.action__meta { display: flex; gap: 8px; flex-wrap: wrap; }
.tag {
  padding: 5px 11px; border-radius: 999px;
  background: #f1f5fb; border: 1px solid var(--line);
  font-size: 12px; font-weight: 600; color: var(--muted);
}
.tag--blue { background: rgba(52, 120, 246, 0.09); border-color: rgba(52, 120, 246, 0.3); color: var(--blue-deep); }
.tag--red { background: rgba(239, 117, 120, 0.1); border-color: rgba(239, 117, 120, 0.35); color: #c0454a; }
.action__footer { display: flex; align-items: center; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3); cursor: pointer;
}
.btn-ghost {
  padding: 10px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 14px; font-weight: 700; color: var(--muted); cursor: pointer;
}
.action__today { display: flex; align-items: center; gap: 10px; margin-top: 4px; font-size: 12px; color: var(--faint); }
.action__today-bar { width: 120px; height: 6px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.action__today-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.action__examples { display: flex; gap: 8px; flex-wrap: wrap; }
.example {
  padding: 9px 14px; border-radius: 12px;
  border: 1px dashed rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.05);
  color: var(--blue-deep); font-size: 13px; font-weight: 600; cursor: pointer;
}

/* ---------- 路径进度卡 ---------- */
.path { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
.path__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.path__title strong { font-size: 16px; }
.path__sub { display: block; margin-top: 3px; font-size: 12px; color: var(--faint); }
.badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.badge--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.badge--red { color: #c0454a; background: rgba(239, 117, 120, 0.12); }
.steps { list-style: none; margin: 0; padding: 0; display: grid; }
.step { display: grid; grid-template-columns: 18px 1fr; gap: 10px; position: relative; padding-bottom: 16px; }
.step:last-child { padding-bottom: 0; }
.step::before {
  content: ''; position: absolute; left: 8px; top: 18px; bottom: 0;
  width: 2px; background: #e7edf7;
}
.step:last-child::before { display: none; }
.step__dot {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid #d4deee; background: #fff;
  margin-top: 1px; position: relative; z-index: 1;
}
.step--done .step__dot { border-color: var(--green); background: var(--green); box-shadow: inset 0 0 0 3px #fff; }
.step--done::before { background: var(--green); }
.step--current .step__dot { border-color: var(--blue); box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.15); }
.step--blocked .step__dot { border-color: var(--red); box-shadow: 0 0 0 4px rgba(239, 117, 120, 0.14); }
.step__body strong { display: block; font-size: 13.5px; line-height: 1.4; }
.step__body small { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
.step--current .step__body small { color: var(--blue-deep); font-weight: 600; }
.path__foot { border-top: 1px solid var(--line); padding-top: 12px; display: grid; gap: 8px; }
.path__progress { height: 8px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.path__progress i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.path__nums { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.path--empty { justify-content: flex-start; }
.path__empty-body {
  flex: 1; display: grid; place-content: center; gap: 14px;
  text-align: center; color: var(--faint); font-size: 13px; padding: 24px 0;
}
.path__empty-illus { display: flex; gap: 6px; justify-content: center; }
.path__empty-illus span { width: 26px; height: 8px; border-radius: 99px; background: #e7edf7; }
.path__empty-illus span:nth-child(1) { background: rgba(49, 177, 111, 0.4); }
.path__empty-illus span:nth-child(2) { background: rgba(52, 120, 246, 0.4); }
</style>

<style scoped>
/* ---------- 本周节奏 ---------- */
.dash__grid-week { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 16px; }
.week { padding: 20px 22px; display: grid; gap: 14px; align-content: start; }
.week__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
.day {
  display: grid; gap: 6px; justify-items: center;
  padding: 8px 4px 10px;
  border-radius: 12px; border: 1px solid transparent;
  background: transparent; font: inherit; cursor: pointer;
  transition: 0.14s ease;
}
.day:hover { background: #f6f9ff; }
.day--today { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.05); }
.day--selected { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.12); }
.day__label { font-size: 11px; color: var(--faint); font-weight: 700; }
.day__cell {
  width: 34px; height: 34px; border-radius: 10px;
  display: grid; place-items: center;
  font-size: 12px; font-weight: 800;
}
.day__min { font-size: 11px; color: var(--faint); }
.week__empty {
  padding: 26px 0; text-align: center; color: var(--faint); font-size: 13px;
  border: 1px dashed var(--line); border-radius: 12px; background: #fafcff;
}
.week__stats { display: flex; gap: 18px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.week__stats b { color: var(--ink); }

/* ---------- 激励小卡 ---------- */
.side-stack { display: grid; gap: 16px; align-content: start; }
.mini { display: flex; align-items: center; gap: 14px; padding: 16px 18px; }
.mini__icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: 0 0 auto; }
.mini__icon--flame { color: #d9741a; background: rgba(244, 170, 70, 0.16); }
.mini__icon--medal { color: var(--accent); background: rgba(141, 107, 255, 0.13); }
.mini strong { font-size: 14px; }
.mini p { margin: 3px 0 0; font-size: 12px; color: var(--muted); }

/* ---------- 整月日历 ---------- */
.month { padding: 20px 22px; display: grid; gap: 14px; }
.month__nav { display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 700; color: var(--muted); }
.month__arrow {
  width: 26px; height: 26px; border-radius: 8px;
  border: 1px solid var(--line); background: #fff;
  display: grid; place-items: center; cursor: pointer; color: var(--muted);
}
.month__arrow--off { opacity: 0.35; cursor: default; }
.month__meta { display: flex; align-items: center; gap: 16px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.month__meta b { color: var(--ink); }
.month__legend { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: var(--faint); }
.lg { width: 12px; height: 12px; border-radius: 4px; display: inline-block; margin-left: 6px; }
.lg--0 { background: #eef2f8; }
.lg--1 { background: rgba(52, 120, 246, 0.2); }
.lg--2 { background: rgba(52, 120, 246, 0.45); }
.lg--3 { background: rgba(52, 120, 246, 0.85); }
.month__body { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 18px; }
.month__weeks { display: grid; gap: 6px; }
.mweek { display: grid; grid-template-columns: 108px 1fr; gap: 10px; align-items: center; }
.mweek__side { display: grid; gap: 2px; }
.mweek__side strong { font-size: 12px; }
.mweek__side small { font-size: 11px; color: var(--faint); }
.mweek__days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.mday {
  height: 38px; border-radius: 10px;
  border: 1px solid transparent;
  font: inherit; font-size: 12px; font-weight: 700;
  display: grid; place-items: center;
  cursor: pointer; transition: 0.14s ease;
}
.mday--prev, .mday--future { background: transparent; color: #c3cddf; cursor: default; font-weight: 500; }
.mday--today { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.12); }
.mday--selected { border-color: var(--blue-deep); box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.18); }
.day-detail {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: #fafcff;
  padding: 14px 16px;
  display: grid; gap: 12px; align-content: start;
}
.day-detail__date { font-size: 13px; font-weight: 800; }
.day-detail__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.day-detail__grid small { display: block; font-size: 11px; color: var(--faint); }
.day-detail__grid strong { display: block; margin-top: 2px; font-size: 13px; }
.day-detail__note {
  margin: 0; font-size: 12px; line-height: 1.6; color: var(--muted);
  border-top: 1px dashed var(--line); padding-top: 10px;
}
.day-detail__empty { margin: 0; font-size: 12px; color: var(--faint); line-height: 1.6; }

/* ---------- 快捷入口 ---------- */
.quick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.quick__item {
  display: flex; align-items: center; gap: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 16px;
  cursor: pointer;
  transition: 0.15s ease;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
}
.quick__item:hover { border-color: rgba(52, 120, 246, 0.4); box-shadow: 0 8px 20px rgba(52, 120, 246, 0.1); }
.quick__icon {
  width: 36px; height: 36px; border-radius: 11px;
  display: grid; place-items: center; flex: 0 0 auto;
}
.quick__icon--pulse { color: var(--cyan); background: rgba(67, 176, 216, 0.13); }
.quick__icon--layers { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.quick__icon--medal { color: var(--accent); background: rgba(141, 107, 255, 0.13); }
.quick__body { flex: 1; display: grid; gap: 2px; }
.quick__body strong { font-size: 13.5px; }
.quick__body small { font-size: 11.5px; color: var(--faint); }
.quick__go { color: var(--faint); font-size: 18px; }
.quick__item:hover .quick__go { color: var(--blue-deep); }

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .nav__links { display: none; }
  .dash__grid-main, .dash__grid-week { grid-template-columns: 1fr; }
  .month__body { grid-template-columns: 1fr; }
  .mweek { grid-template-columns: 1fr; gap: 6px; }
  .mweek__side { display: flex; gap: 8px; align-items: baseline; }
  .quick { grid-template-columns: 1fr; }
  .action__title { font-size: 21px; }
  .dash__main { padding: 16px 14px 32px; }
  .greet { flex-direction: column; align-items: flex-start; gap: 8px; }
}
</style>

<style scoped>
/* ---------- 交互补充 ---------- */
.nav__links a { text-decoration: none; }
.nav__cta { text-decoration: none; }
a.btn-primary { text-decoration: none; }
.quick__item { text-decoration: none; color: inherit; }
.example { text-decoration: none; }

.action__eyebrow--rest { color: var(--faint); }
.action__eyebrow--ok { color: var(--green); }

.task-fade-enter-active, .task-fade-leave-active { transition: opacity .18s ease, transform .18s ease; }
.task-fade-enter-from { opacity: 0; transform: translateY(6px); }
.task-fade-leave-to { opacity: 0; transform: translateY(-6px); }
.action__task { display: grid; gap: 12px; }

.mini-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  animation: dash-spin .8s linear infinite;
  display: inline-block;
}
.btn-primary--busy { opacity: .85; cursor: default; }
@keyframes dash-spin { to { transform: rotate(360deg); } }
</style>
