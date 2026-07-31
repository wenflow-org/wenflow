<template>
  <div class="dash v2-page">
    <V2Nav />

    <main class="dash__main">
      <!-- 问候栏（headline/subtitle 由学习者 skill 回填） -->
      <div class="greet">
        <div class="greet__left">
          <strong>{{ greetHeadline }}</strong>
          <span class="greet__dot"></span>
          <span>{{ dateText }}</span>
          <span v-if="greetSub" class="greet__sub">{{ greetSub }}</span>
        </div>
        <div v-if="streakDays > 0" class="streak" title="连续学习天数">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
          连续 {{ streakDays }} 天{{ todayMinutes > 0 ? '' : ' · 今天还没开始' }}
        </div>
      </div>

      <!-- AI 提示条（warningCopy/paceHint 回填，按状态分级） -->
      <div v-if="tipText && !tipDismissed" class="tip" :class="`tip--${tipTone}`">
        <span class="tip__icon">
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74c.6.52 1 1.31 1 2.26v1h6v-1c0-.95.4-1.74 1-2.26A7 7 0 0 0 12 2z"/></svg>
        </span>
        <p>{{ tipText }}</p>
        <span class="tip__ai" title="内容由 AI 生成，仅供参考">AI</span>
        <span class="tip__close" title="知道了" @click="tipDismissed = true">×</span>
      </div>

      <!-- 加载 -->
      <div v-if="loading" class="dash__loading">
        <span class="spinner"></span>
      </div>

      <template v-else>
        <!-- 主区：今日行动 + 路径进度 -->
        <div class="dash__grid-main">
          <!-- 进行中：今日行动卡 -->
          <section v-if="pageState === 'active'" class="card action">
            <template v-if="resting">
              <div class="action__eyebrow action__eyebrow--rest"><span>今天休息</span></div>
              <h1 class="action__title">给自己放个小假</h1>
              <p class="action__desc">想回来的时候，任务还在这里等你。</p>
              <div class="action__footer">
                <span class="btn-primary" @click="resting = false">恢复学习</span>
              </div>
            </template>
            <template v-else>
              <div class="action__eyebrow">
                <span>今日行动</span>
                <span class="action__from">来自路径「{{ primaryPath?.title }}」</span>
              </div>
              <h1 class="action__title">{{ todayTask?.title || '今天没有待办任务' }}</h1>
              <p v-if="actionDesc" class="action__desc">{{ actionDesc }}</p>
              <p v-if="actionReason" class="action__reason">
                <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74c.6.52 1 1.31 1 2.26v1h6v-1c0-.95.4-1.74 1-2.26A7 7 0 0 0 12 2z"/></svg>
                {{ actionReason }}
              </p>
              <div class="action__meta">
                <span class="tag tag--blue">阶段 {{ stageInfo }}</span>
                <span class="tag">约 {{ todayTask?.minutes || '—' }} 分钟</span>
                <span class="tag">{{ todayTask?.kind || '任务' }}</span>
              </div>
              <div class="action__footer">
                <!-- skill todayActions 回填（≤3 条，语义跳转已解析） -->
                <template v-if="skillActions.length">
                  <router-link :to="skillActions[0].to" class="btn-primary">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                    {{ skillActions[0].label }}
                  </router-link>
                  <router-link v-for="a in skillActions.slice(1)" :key="a.label" :to="a.to" class="btn-ghost">{{ a.label }}</router-link>
                </template>
                <template v-else>
                  <span v-if="todayTask" class="btn-primary" @click="goLearn">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                    开始学习
                  </span>
                  <router-link to="/learning-paths" class="link-muted">查看全部路径</router-link>
                </template>
                <span class="link-muted" @click="resting = true">今天休息</span>
              </div>
              <div class="action__today">
                <div class="action__today-bar"><i :style="{ width: todayBarPct + '%' }"></i></div>
                <span>今日已学 {{ todayMinutes }} / {{ todayTask?.minutes || 25 }} 分钟</span>
              </div>
            </template>
          </section>

          <!-- 需要处理：修复卡 -->
          <section v-else-if="pageState === 'attention'" class="card action action--alert">
            <div class="action__eyebrow action__eyebrow--alert">
              <span>需要先处理</span>
              <span class="action__from">路径「{{ primaryPath?.title }}」</span>
            </div>
            <h1 class="action__title">这版路径没生成出来，重试一般能好</h1>
            <p class="action__desc">{{ primaryPath?.errorText || '生成失败。你的目标和已确认信息都保留着，不会丢。' }}</p>
            <div class="action__meta">
              <span class="tag tag--red">{{ primaryPath?.retryType === 'stage_design' ? '阶段任务失败' : '主结构失败' }}</span>
              <span class="tag">信息已保留</span>
            </div>
            <div class="action__footer">
              <span class="btn-primary" :class="{ 'btn-primary--off': retrying }" @click="doRetry">
                <span v-if="retrying" class="spinner spinner--sm"></span>
                {{ retrying ? '正在重新生成…' : '重新生成路径' }}
              </span>
              <router-link :to="`/learning-path/${primaryPath?.id}`" class="btn-ghost">查看详情</router-link>
              <router-link to="/goal-conversation" class="link-muted">先修改目标</router-link>
            </div>
          </section>

          <!-- 新手态：引导卡 -->
          <section v-else class="card action action--empty">
            <div class="action__eyebrow"><span>开始你的第一个学习计划</span></div>
            <h1 class="action__title">用 2 分钟，聊出一条能执行的路径</h1>
            <p class="action__desc">{{ guidanceEmptyText }}</p>
            <div class="action__examples">
              <router-link v-for="e in examples" :key="e" to="/goal-conversation" class="example">{{ e }}</router-link>
            </div>
            <div class="action__footer">
              <router-link to="/goal-conversation" class="btn-primary">开始规划目标</router-link>
              <router-link to="/learning-paths" class="link-muted">先看看路径长什么样</router-link>
            </div>
          </section>

          <!-- 路径进度卡 -->
          <aside v-if="primaryPath" class="card path">
            <div class="path__head">
              <div class="path__title">
                <strong>{{ primaryPath.title }}</strong>
                <span class="path__sub">{{ pathHintText }}</span>
              </div>
              <span class="badge" :class="pathBadge.cls">{{ pathBadge.text }}</span>
            </div>
            <div v-if="pathStruggleNote" class="path__note">
              <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 7 12H5l7-12zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z"/></svg>
              {{ pathStruggleNote }}
            </div>
            <ol v-if="primaryPath.stages.length" class="steps">
              <li v-for="(s, i) in primaryPath.stages" :key="i" class="step" :class="`step--${s.status}`">
                <span class="step__dot"></span>
                <div class="step__body">
                  <strong>{{ s.title }}</strong>
                  <small>{{ s.note }}</small>
                </div>
              </li>
            </ol>
            <div class="path__foot">
              <div class="path__progress"><i :style="{ width: primaryPath.percent + '%' }"></i></div>
              <div class="path__nums">
                <span>整体 {{ primaryPath.percent }}%</span>
                <span v-if="primaryPath.hours">预计投入 {{ primaryPath.hours }} 小时</span>
              </div>
            </div>
            <router-link :to="`/learning-path/${primaryPath.id}`" class="path__detail-link">查看路径详情 ›</router-link>
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
              <span class="link-muted" @click="monthOpen = !monthOpen">{{ monthOpen ? '收起整月' : '展开整月 ›' }}</span>
            </div>
            <div v-if="hasAnyMinutes" class="week__grid">
              <button
                v-for="d in weekDays"
                :key="d.date"
                type="button"
                class="day"
                :class="{ 'day--today': d.isToday, 'day--selected': selectedDate === d.date }"
                @click="selectDay(d.date)"
              >
                <span class="day__label">{{ d.weekLabel }}</span>
                <span class="day__cell" :style="{ background: d.color, color: d.ink }">{{ d.minutes || '' }}</span>
                <span class="day__min">{{ d.minutes ? d.minutes + '分' : '—' }}</span>
              </button>
            </div>
            <div v-else class="week__empty">完成第一次学习后，这里会点亮你的节奏。</div>
            <div v-if="hasAnyMinutes" class="week__stats">
              <span>近 7 天 <b>{{ weekTotal }}</b> 分钟</span>
              <span><b>{{ weekActiveDays }}</b> 天有学习</span>
            </div>
          </section>

          <div class="side-stack">
            <section class="card mini">
              <div class="mini__icon mini__icon--flame">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
              </div>
              <div>
                <strong>{{ streakDays > 0 ? `连续 ${streakDays} 天` : '点亮第一天' }}</strong>
                <p>{{ streakDays > 0 ? (todayMinutes > 0 ? '今天已学习，继续保持' : '今天学一会儿，续上记录') : '今天学 10 分钟，开始连续记录' }}</p>
              </div>
            </section>
            <section class="card mini" v-if="nearestAchievement">
              <div class="mini__icon mini__icon--medal">{{ nearestAchievement.icon }}</div>
              <div>
                <strong>成就「{{ nearestAchievement.name }}」<span v-if="nearestAchievement.achieved" class="mini__badge">待解锁</span></strong>
                <p>{{ nearestAchievement.hint }}</p>
              </div>
            </section>
          </div>
        </div>

        <!-- 整月日历 -->
        <section v-if="monthOpen" class="card month">
          <div class="card-head">
            <strong>整月节奏</strong>
            <div class="month__nav">
              <span class="month__arrow" @click="shiftMonth(-1)">‹</span>
              <span>{{ monthLabel }}</span>
              <span class="month__arrow" :class="{ 'month__arrow--off': isCurrentMonth }" @click="shiftMonth(1)">›</span>
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
              <div v-for="(w, wi) in monthWeeks" :key="wi" class="mweek">
                <div class="mweek__side">
                  <strong>{{ w.label }}</strong>
                  <small>{{ w.minutes }}分 · {{ w.days }}天</small>
                </div>
                <div class="mweek__days">
                  <button
                    v-for="(c, ci) in w.cells"
                    :key="ci"
                    type="button"
                    class="mday"
                    :class="{ 'mday--prev': c.outside, 'mday--future': c.future, 'mday--today': c.isToday, 'mday--selected': selectedDate === c.date && !c.outside }"
                    :style="!c.outside && !c.future ? { background: c.color, color: c.ink } : {}"
                    :disabled="c.outside || c.future"
                    @click="selectedDate = c.date"
                  >
                    {{ c.dayNum }}
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
              <button type="button" class="day-detail__more" @click="daySheetOpen = true">查看当天明细 ›</button>
            </aside>
          </div>
        </section>

        <!-- 快捷入口 -->
        <div class="quick">
          <router-link to="/learning-state" class="quick__item">
            <span class="quick__icon quick__icon--pulse">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 13h4l2-7 4 12 2-7h6v2h-4.6l-2.4 8.4L9.6 7.6 7.6 15H3v-2z"/></svg>
            </span>
            <span class="quick__body"><strong>学习状态</strong><small>节奏 · 负荷 · AI 建议</small></span>
            <span class="quick__go">›</span>
          </router-link>
          <router-link to="/learning-paths" class="quick__item">
            <span class="quick__icon quick__icon--layers">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 2 10 5-10 5L2 7l10-5zm0 7.6L18.9 7 12 4.4 5.1 7 12 9.6zM2 12l10 5 10-5v2l-10 5L2 14v-2zm0 5 10 5 10-5v2l-10 5L2 19v-2z" opacity=".9"/></svg>
            </span>
            <span class="quick__body"><strong>全部路径</strong><small>{{ pathsCountText }}</small></span>
            <span class="quick__go">›</span>
          </router-link>
          <router-link to="/achievements" class="quick__item">
            <span class="quick__icon quick__icon--medal">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2z"/></svg>
            </span>
            <span class="quick__body"><strong>成就</strong><small>{{ achievementsText }}</small></span>
            <span class="quick__go">›</span>
          </router-link>
        </div>
      </template>
    </main>

    <!-- 当天学习复盘抽屉 -->
    <transition name="sheet">
      <div v-if="daySheetOpen" class="sheet-mask" @click.self="daySheetOpen = false">
        <aside class="sheet" role="dialog" aria-label="当天学习明细">
          <header class="sheet__head">
            <div class="sheet__head-main">
              <div class="sheet__date">{{ daySheet.title }}</div>
              <h3 class="sheet__headline">{{ daySheet.headline }}</h3>
            </div>
            <div class="sheet__head-right">
              <span class="sheet__zone" :class="`sheet__zone--${daySheet.zoneCls}`">{{ daySheet.zone }}</span>
              <span class="sheet__close" title="关闭" @click="daySheetOpen = false">×</span>
            </div>
          </header>

          <div class="sheet__scroll">
            <div v-if="daySheet.count > 0" class="sheet__summary">
              <div><small>总时长</small><strong>{{ daySheet.minutes }} 分钟</strong></div>
              <div><small>学习次数</small><strong>{{ daySheet.count }} 次</strong></div>
              <div><small>状态摘要</small><strong>{{ daySheet.stateSummary }}</strong></div>
              <div class="sheet__summary-wide"><small>主要内容</small><strong>{{ daySheet.primaryTask }}</strong></div>
            </div>

            <div class="sheet__block">
              <h4>当天观察</h4>
              <p>{{ daySheet.analysis }}</p>
            </div>

            <div class="sheet__block">
              <h4>学习记录</h4>
              <div v-if="daySheet.count === 0" class="sheet__empty">这一天没有学习记录。可以休息，也可以补一次短时学习。</div>

              <article v-for="s in daySheet.sessions" :key="s.id" class="scard">
                <div class="scard__head">
                  <div class="scard__title">
                    <strong>{{ s.title }}</strong>
                    <small>{{ s.timeRange }}</small>
                  </div>
                  <span class="scard__duration">{{ s.durationText }}</span>
                </div>

                <div class="scard__chips">
                  <span class="chip">{{ s.statusLabel }}</span>
                  <span v-if="s.understanding !== null" class="chip chip--blue">理解 {{ s.understanding }}%</span>
                  <span v-if="s.engagement !== null" class="chip chip--cyan">投入 {{ s.engagement }}%</span>
                  <span v-if="s.cognitiveLabel" class="chip chip--purple">认知 · {{ s.cognitiveLabel }}</span>
                </div>

                <div v-if="s.confusions.length" class="scard__confuse">
                  卡点：{{ s.confusions.join('、') }}
                </div>

                <div v-if="s.stages.length" class="scard__stages">
                  <template v-for="(st, i) in s.stages" :key="i">
                    <span class="scard__stage">{{ st.label }}</span>
                    <span v-if="i < s.stages.length - 1" class="scard__stage-sep">›</span>
                  </template>
                </div>

                <button v-if="s.events.length" type="button" class="scard__toggle" @click="toggleSessionEvents(s.id)">
                  {{ openSessionEvents.has(s.id) ? '收起课堂事件 ⌃' : `课堂事件 ${s.events.length} 条 ⌄` }}
                </button>
                <ol v-if="openSessionEvents.has(s.id)" class="scard__events">
                  <li v-for="(e, i) in s.events" :key="i">
                    <span class="scard__event-time">{{ e.time }}</span>
                    <span class="scard__event-text">{{ e.summary }}</span>
                  </li>
                </ol>
              </article>
            </div>
          </div>
        </aside>
      </div>
    </transition>

    <V2Footer />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import request from '@/utils/api';
import { learningAPI } from '@/api/learning';
import { useUserStore } from '@/stores/user';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import './v2.css';
import { unwrapArray } from './unwrap';

const router = useRouter();
const userStore = useUserStore();

/* ================= 基础状态 ================= */
const loading = ref(true);
const tipDismissed = ref(false);
const resting = ref(false);
const retrying = ref(false);
const monthOpen = ref(false);

const stats = ref<Record<string, any> | null>(null);
const paths = ref<Array<Record<string, any>>>([]);
const guidance = ref<Record<string, any> | null>(null);
const sessions = ref<Array<Record<string, any>>>([]);
const achievements = ref<Array<Record<string, any>>>([]);

const userName = computed(() => userStore.user?.name || stats.value?.user?.name || '同学');
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
});
const dateText = computed(() => {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}`;
});

const examples = ['用 Python 自动化处理 Excel 报表', '提升职场沟通和表达能力', '用 AI 工具做自媒体副业'];

/* ================= 数据加载 ================= */
async function loadAll() {
  loading.value = true;
  const [statsR, pathsR, guidanceR, sessionsR, achR] = await Promise.allSettled([
    learningAPI.getStats(),
    learningAPI.getPaths(),
    learningAPI.getAdaptiveGuidance(),
    fetchSessions(monthCursor.value),
    request.get('/achievements/all')
  ]);
  if (statsR.status === 'fulfilled') stats.value = statsR.value as Record<string, any>;
  if (pathsR.status === 'fulfilled') paths.value = pathsR.value as unknown as Array<Record<string, any>>;
  if (guidanceR.status === 'fulfilled') guidance.value = guidanceR.value as Record<string, any> | null;
  if (sessionsR.status === 'fulfilled') sessions.value = sessionsR.value;
  if (achR.status === 'fulfilled') achievements.value = unwrapArray(achR.value);
  loading.value = false;
}

async function fetchSessions(cursor: { year: number; month: number }) {
  const first = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-01`;
  const lastDate = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const last = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
  const response = await request.get('/users/me/sessions', { params: { startDate: first, endDate: last, limit: 500 } });
  const raw: unknown = response.data ?? response;
  return (Array.isArray(raw) ? raw : []) as Array<Record<string, any>>;
}

/* ================= 页面状态推导 ================= */
interface StageView { title: string; status: 'done' | 'current' | 'todo' | 'blocked'; note: string }
interface PathView {
  id: string; title: string; sub: string; percent: number; hours?: number;
  stages: StageView[]; failed: boolean; generating: boolean; retryType: string | null; errorText: string;
}

const primaryPath = computed<PathView | null>(() => {
  if (!paths.value.length) return null;
  const p = paths.value.find((x) => x.generationLifecycle?.phase === 'ready' && x.status !== 'completed') ?? paths.value[0];
  return toPathView(p);
});

function toPathView(p: Record<string, any>): PathView {
  const lc = p.generationLifecycle;
  const failed = !!lc && lc.phase !== 'ready' && (lc.status === 'failed' || lc.status === 'stale');
  const generating = !!lc && lc.phase !== 'ready' && !failed;
  const weeks = p.milestones || p.weeks || [];
  let total = 0;
  let done = 0;
  const stages: StageView[] = weeks.map((w: Record<string, any>, i: number) => {
    const tasks = w.subtasks || w.tasks || [];
    const doneCount = tasks.filter((t: Record<string, any>) => t.status === 'completed').length;
    total += tasks.length;
    done += doneCount;
    return {
      title: w.title || `阶段 ${i + 1}`,
      status: tasks.length && doneCount === tasks.length ? 'done' : 'todo',
      note: tasks.length ? `${doneCount}/${tasks.length} 任务` : (w.goal || ''),
      tasks
    };
  });
  const firstOpen = stages.findIndex((s) => s.status !== 'done');
  stages.forEach((s, i) => {
    if (s.status !== 'done') s.status = i === firstOpen ? (failed ? 'blocked' : 'current') : 'todo';
  });
  const percent = total ? Math.round((done / total) * 100) : 0;
  return {
    id: p.id,
    title: p.title || p.name || '未命名路径',
    sub: p.deadlineText ? `目标 ${p.deadlineText}` : (p.subject || ''),
    percent,
    hours: p.estimatedHours,
    stages,
    failed,
    generating,
    retryType: lc?.retryType ?? null,
    errorText: lc?.errorMessage || ''
  };
}

const pageState = computed<'active' | 'attention' | 'empty'>(() => {
  if (!primaryPath.value) return 'empty';
  if (primaryPath.value.failed || primaryPath.value.generating) return 'attention';
  return 'active';
});

/* ================= 今日任务 ================= */
const todayTask = computed(() => {
  const gTask = guidance.value?.summary?.path?.taskTitle;
  if (pageState.value === 'active' && primaryPath.value) {
    const weeks = rawWeeksOf(primaryPath.value.id);
    for (const w of weeks) {
      const tasks = w.subtasks || w.tasks || [];
      const t = tasks.find((x: Record<string, any>) => x.status === 'in_progress') ?? tasks.find((x: Record<string, any>) => x.status !== 'completed');
      if (t) {
        return { id: t.id, title: gTask || t.title || t.displayLabel, desc: t.description || '', minutes: t.estimatedMinutes, kind: t.displayLabel || t.taskType || '任务', status: t.status || 'todo' };
      }
    }
  }
  return null;
});

function rawWeeksOf(pathId: string) {
  const p = paths.value.find((x) => x.id === pathId);
  return p?.milestones || p?.weeks || [];
}

const stageInfo = computed(() => {
  if (!primaryPath.value) return '—';
  const idx = primaryPath.value.stages.findIndex((s) => s.status === 'current' || s.status === 'blocked');
  return `${(idx >= 0 ? idx : 0) + 1} / ${primaryPath.value.stages.length || '?'}`;
});

const guidanceEmptyText = computed(() => guidanceCopy.value?.emptyStateCopy || '不用整理、不用说得很准。讲讲最近想解决的事，问流会帮你收敛成目标和阶段安排。');

/* skill 今日行动（todayActions 语义跳转解析） */
interface SkillAction { label: string; to: string; primary: boolean }
const ACTION_LABEL_BY_TO: Record<string, string> = {
  'continue-learning': '继续学习',
  'learning-state': '查看学习状态',
  achievements: '查看成就',
  'create-goal': '规划新目标',
  'path-detail': '查看路径'
};
const skillActions = computed<SkillAction[]>(() => {
  const list = guidanceCopy.value?.todayActions;
  if (!Array.isArray(list) || !list.length) return [];
  const resolve = (to?: string): string => {
    switch (to) {
      case 'continue-learning':
        return todayTask.value?.id ? `/learn/${todayTask.value.id}` : (primaryPath.value ? `/learning-path/${primaryPath.value.id}` : '/learning-paths');
      case 'learning-state':
        return '/learning-state';
      case 'achievements':
        return '/achievements';
      case 'create-goal':
        return '/goal-conversation';
      case 'path-detail':
        return primaryPath.value ? `/learning-path/${primaryPath.value.id}` : '/learning-paths';
      default:
        return '/learning-paths';
    }
  };
  return list.slice(0, 3).map((item: Record<string, any>, i: number) => ({
    label: i === 0
      ? item.action || item.title || ACTION_LABEL_BY_TO[item.to] || '去学习'
      : ACTION_LABEL_BY_TO[item.to] || item.action || item.title || '去学习',
    to: resolve(item.to),
    primary: i === 0
  }));
});

/* 路径卡描述（pathHint 回填）与卡点提醒 */
const pathHintText = computed(() => guidanceCopy.value?.pathHint || primaryPath.value?.sub || '');
const pathStruggleNote = computed(() => {
  const p = guidanceSummary.value?.path;
  if (!p) return '';
  if (p.hasPrerequisiteGaps) return '有前置知识缺口，建议先补基础再推进';
  if (p.hasStrugglingConcepts) return '近期有卡点的概念，适合安排复习';
  if (p.hasFragileConcepts) return '部分概念还不够稳，注意巩固';
  return '';
});

const todayBarPct = computed(() => {
  const target = todayTask.value?.minutes || 25;
  return Math.min(100, Math.round((todayMinutes.value / target) * 100));
});

/* 今日行动描述：desc 与标题重复时不重复展示 */
const actionDesc = computed(() => {
  const desc = todayTask.value?.desc?.trim();
  if (!desc || desc === todayTask.value?.title) return '';
  return desc;
});

function goLearn() {
  if (todayTask.value?.id) router.push(`/learn/${todayTask.value.id}`);
}

/* ================= 提示条（skill: adaptive-guidance-copy 回填 + 分级） ================= */
const guidanceCopy = computed(() => guidance.value?.copy || null);
const guidanceSummary = computed(() => guidance.value?.summary || null);

/* 今日行动依据：为什么是这节课（来自学习者快照的推荐动作，无信号则不显示） */
const actionReason = computed(() => {
  if (!todayTask.value) return '';
  const rec = guidanceSummary.value?.path?.recommendedAction;
  if (rec === 'review-prerequisites') return '前面课程发现有前置缺口，这节课先补基础再推进';
  if (rec === 'slow-down') return '最近节奏偏紧，今天先稳住这一个任务';
  if (todayTask.value.status === 'in_progress') return '接着上次的进度继续';
  return '';
});

const greetHeadline = computed(() => guidanceCopy.value?.headline || `${greeting.value}，${userName.value}`);
const greetSub = computed(() => guidanceCopy.value?.subtitle || '');

const tipTone = computed(() => {
  if (pageState.value === 'attention') return 'attention';
  const level = guidanceSummary.value?.global?.stateLevel;
  if (level === 'recover') return 'recover';
  if (guidanceSummary.value?.global?.hasWarnings || guidanceSummary.value?.global?.warningLevel === 'critical') return 'warn';
  return 'normal';
});

const tipText = computed(() => {
  if (pageState.value === 'attention') return '路径生成失败通常是暂时的。重新生成约 30 秒，已确认的信息都会保留。';
  const copy = guidanceCopy.value;
  const warning = copy?.warningCopy;
  if (warning && warning !== '当前没有明显风险。') return warning;
  if (stats.value?.suggestion?.message) return stats.value.suggestion.message;
  if (copy?.paceHint && copy.paceHint !== '当前节奏稳定，继续保持。') return copy.paceHint;
  return '';
});

/* ================= 重试 ================= */
async function doRetry() {
  if (retrying.value || !primaryPath.value) return;
  retrying.value = true;
  try {
    if (primaryPath.value.retryType === 'stage_design') {
      await learningAPI.retryPathEnrichment(primaryPath.value.id);
    } else {
      await learningAPI.retryPathGeneration(primaryPath.value.id);
    }
    window.setTimeout(loadAll, 4000);
  } finally {
    retrying.value = false;
  }
}

/* ================= 路径徽章 ================= */
const pathBadge = computed(() => {
  if (!primaryPath.value) return { text: '', cls: '' };
  if (primaryPath.value.failed) return { text: '需要处理', cls: 'badge--red' };
  if (primaryPath.value.generating) return { text: '生成中', cls: 'badge--cyan' };
  if (primaryPath.value.percent >= 100) return { text: '已完成', cls: 'badge--green' };
  return { text: '进行中', cls: 'badge--blue' };
});

const pathsCountText = computed(() => {
  const total = paths.value.length;
  if (!total) return '还没有路径';
  const active = paths.value.filter((p) => p.generationLifecycle?.phase === 'ready' && p.status !== 'completed').length;
  return active ? `${active} 条进行中` : `${total} 条路径`;
});

const achievementsText = computed(() => {
  const unlocked = achievements.value.filter((a) => a.unlocked).length;
  return achievements.value.length ? `已解锁 ${unlocked} / ${achievements.value.length}` : '完成学习即可解锁';
});

const nearestAchievement = computed(() => {
  const locked = achievements.value.filter((a) => !a.unlocked && a.progress);
  if (!locked.length) return null;
  const nearest = locked.sort((a, b) => (b.progress?.percentage ?? 0) - (a.progress?.percentage ?? 0))[0];
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString());
  return {
    icon: nearest.icon || '🏅',
    name: nearest.name,
    achieved: (nearest.progress?.current ?? 0) >= (nearest.progress?.total ?? 1),
    hint: `${nearest.description}（${fmt(nearest.progress?.current ?? 0)}/${fmt(nearest.progress?.total ?? 1)}）`
  };
});

const todayStr = new Date().toISOString().slice(0, 10);
const minutesByDate = computed(() => {
  const map = new Map<string, number>();
  for (const s of sessions.value) {
    const date = String(s.startTime || '').slice(0, 10);
    if (!date) continue;
    map.set(date, (map.get(date) ?? 0) + (s.durationMinutes ?? 0));
  }
  return map;
});

const todayMinutes = computed(() => minutesByDate.value.get(todayStr) ?? 0);

const streakDays = computed(() => {
  let streak = 0;
  const d = new Date();
  if ((minutesByDate.value.get(todayStr) ?? 0) === 0) d.setDate(d.getDate() - 1);
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if ((minutesByDate.value.get(key) ?? 0) > 0) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
});

const heat = (m: number) => {
  if (m <= 0) return { color: '#eef2f8', ink: 'transparent' };
  if (m < 30) return { color: 'rgba(52,120,246,.20)', ink: '#1f57cc' };
  if (m <= 60) return { color: 'rgba(52,120,246,.45)', ink: '#10337e' };
  return { color: 'rgba(52,120,246,.85)', ink: '#fff' };
};

/* 本周条 */
const weekDays = computed(() => {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  return labels.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    const minutes = minutesByDate.value.get(date) ?? 0;
    return { label, weekLabel: label, date, minutes, isToday: date === todayStr, ...heat(minutes) };
  });
});

const hasAnyMinutes = computed(() => [...minutesByDate.value.values()].some((m) => m > 0));
const weekTotal = computed(() => weekDays.value.reduce((s, d) => s + d.minutes, 0));
const weekActiveDays = computed(() => weekDays.value.filter((d) => d.minutes > 0).length);

/* 整月 */
const monthCursor = ref({ year: new Date().getFullYear(), month: new Date().getMonth() });
const isCurrentMonth = computed(() => {
  const now = new Date();
  return monthCursor.value.year === now.getFullYear() && monthCursor.value.month === now.getMonth();
});
const monthLabel = computed(() => `${monthCursor.value.year}年${monthCursor.value.month + 1}月`);

async function shiftMonth(dir: number) {
  if (dir > 0 && isCurrentMonth.value) return;
  const d = new Date(monthCursor.value.year, monthCursor.value.month + dir, 1);
  monthCursor.value = { year: d.getFullYear(), month: d.getMonth() };
  sessions.value = await fetchSessions(monthCursor.value).catch(() => []);
}

interface MonthCell { date: string; dayNum: number; minutes: number; outside: boolean; future: boolean; isToday: boolean; color: string; ink: string }
const monthWeeks = computed(() => {
  const { year, month } = monthCursor.value;
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ date: '', dayNum: prevDays - i, minutes: 0, outside: true, future: false, isToday: false, color: 'transparent', ink: 'inherit' });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const minutes = minutesByDate.value.get(date) ?? 0;
    const future = date > todayStr;
    cells.push({ date, dayNum: d, minutes: future ? 0 : minutes, outside: false, future, isToday: date === todayStr, ...heat(future ? 0 : minutes) });
  }
  const tail = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= tail; d++) {
    cells.push({ date: '', dayNum: d, minutes: 0, outside: true, future: false, isToday: false, color: 'transparent', ink: 'inherit' });
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    const slice = cells.slice(i, i + 7);
    const learned = slice.filter((c) => c.minutes > 0);
    rows.push({
      label: slice.some((c) => c.isToday) ? '本周' : `第${rows.length + 1}周`,
      minutes: learned.reduce((s, c) => s + c.minutes, 0),
      days: learned.length,
      cells: slice
    });
  }
  return rows;
});

const monthTotals = computed(() => {
  let minutes = 0;
  let days = 0;
  for (const [, m] of minutesByDate.value) {
    if (m > 0) { minutes += m; days += 1; }
  }
  const sessionsCount = sessions.value.length;
  return { minutes, days, sessions: sessionsCount };
});

/* 选中日 */
const selectedDate = ref(todayStr);
function selectDay(date: string) {
  selectedDate.value = date;
  if (date.slice(0, 7) !== `${monthCursor.value.year}-${String(monthCursor.value.month + 1).padStart(2, '0')}`) {
    const [y, m] = date.split('-').map(Number);
    monthCursor.value = { year: y, month: m - 1 };
    fetchSessions(monthCursor.value).then((list) => (sessions.value = list)).catch(() => {});
  }
  monthOpen.value = true;
}

const selectedInfo = computed(() => {
  const date = selectedDate.value;
  const minutes = minutesByDate.value.get(date) ?? 0;
  const daySessions = sessions.value.filter((s) => String(s.startTime || '').startsWith(date));
  const d = new Date(date + 'T00:00:00');
  const title = `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}${date === todayStr ? ' · 今天' : ''}`;
  if (minutes <= 0) {
    return { title, minutes, sessions: 0, zone: '', topic: '', note: date === todayStr ? '今天还没有学习记录，完成今日任务后会显示在这里。' : '当天没有学习记录。' };
  }
  const zone = minutes < 60 ? '轻度' : minutes <= 120 ? '中度' : '高强度';
  const topic = daySessions[0]?.taskTitle || '自由练习';
  return { title, minutes, sessions: daySessions.length, zone, topic, note: `${zone}学习，共 ${daySessions.length} 次。` };
});

/* ================= 当天学习复盘抽屉 ================= */
const daySheetOpen = ref(false);
const openSessionEvents = ref<Set<string>>(new Set());

function toggleSessionEvents(id: string) {
  const next = new Set(openSessionEvents.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openSessionEvents.value = next;
}

const COGNITIVE_LABELS: Record<string, string> = {
  remember: '记忆', understand: '理解', apply: '应用',
  analyze: '分析', evaluate: '评估', create: '创造'
};
const STAGE_LABELS: Record<string, string> = {
  opening: '开场', intervention: '干预', teaching: '授课',
  practice: '练习', review: '复习', wrapup: '收尾'
};

function fmtTime(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDuration(minutes: number) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  }
  return `${minutes} 分钟`;
}

function sessionStatusLabel(s: Record<string, any>) {
  if (s.taskStatus === 'completed') return '任务已完成';
  if (s.taskStatus === 'in_progress') return '任务进行中';
  if (s.endTime) return '本次学习已结束';
  if (s.status === 'completed') return '本次学习已结束';
  if (s.status === 'active') return '仍在进行';
  return '已记录';
}

const daySheet = computed(() => {
  const date = selectedDate.value;
  const daySessions = sessions.value
    .filter((s) => String(s.startTime || '').startsWith(date))
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  const minutes = daySessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  const primaryTask = daySessions.find((s) => s.taskTitle)?.taskTitle || '未关联具体任务';

  const sessionsView = daySessions.map((s) => {
    const ps = s.parsedState || {};
    const analysis = ps.analysis || {};
    const risk = ps.classroomContext?.risk || {};
    const confusions: string[] = risk.confusionPoints || analysis.confusionPoints || [];
    const stages = Array.isArray(ps.stageHistory)
      ? ps.stageHistory.map((h: Record<string, any>) => ({ label: STAGE_LABELS[h.stage] || h.stage || '课堂' }))
      : [];
    const events = Array.isArray(ps.classroomEventHistory)
      ? ps.classroomEventHistory
          .filter((e: Record<string, any>) => e.summary)
          .slice(0, 12)
          .map((e: Record<string, any>) => ({ time: fmtTime(e.occurredAt), summary: e.summary }))
      : [];
    return {
      id: s.id,
      title: s.taskTitle || '本次学习',
      timeRange: `${fmtTime(s.startTime)}${s.endTime ? ' - ' + fmtTime(s.endTime) : ' 开始'}`,
      durationText: fmtDuration(s.durationMinutes ?? 0),
      statusLabel: sessionStatusLabel(s),
      understanding: typeof analysis.understanding === 'number' ? Math.round(analysis.understanding * 100) : null,
      engagement: typeof analysis.engagement === 'number' ? Math.round(analysis.engagement * 100) : null,
      cognitiveLabel: analysis.cognitiveLevel ? (COGNITIVE_LABELS[analysis.cognitiveLevel] || analysis.cognitiveLevel) : '',
      confusions,
      stages,
      events
    };
  });

  // 状态摘要（沿用旧版聚合逻辑的精神：异常 > 压力 > 投入 > 平稳）
  const evals = sessionsView.filter((s) => s.engagement !== null || s.understanding !== null);
  const hasStruggle = sessionsView.some((s) => s.confusions.length > 0);
  const avgEngagement = evals.length
    ? evals.reduce((sum, s) => sum + (s.engagement ?? 0), 0) / evals.length
    : 0;
  const stateSummary = !daySessions.length
    ? '状态未评估'
    : hasStruggle
      ? '有卡点需要巩固'
      : !evals.length
        ? '状态未评估'
        : avgEngagement >= 70
          ? '专注度较好'
          : '过程平稳';

  // 当天观察（沿用旧版文案引擎：时长分档 × 状态摘要）
  const taskFragment = daySessions.length && primaryTask !== '未关联具体任务' ? `主要围绕“${primaryTask}”展开。` : '';
  let analysis = '';
  if (!daySessions.length) {
    analysis = '这一天没有学习记录。可以休息，也可以补一次短时学习。';
  } else if (minutes >= 120) {
    if (stateSummary === '有卡点需要巩固') analysis = `今天学习时长较长，累计 ${fmtDuration(minutes)}，过程中出现了卡点。建议之后安排一次针对性复习，把卡住的概念巩固下来。${taskFragment}`;
    else if (stateSummary === '专注度较好') analysis = `今天学习时长较长，累计 ${fmtDuration(minutes)}，但整体专注度不错。后续注意恢复，就能把这个节奏维持住。${taskFragment}`;
    else analysis = `今天学习时长较长，累计 ${fmtDuration(minutes)}，过程整体平稳。建议之后安排恢复。${taskFragment}`;
  } else if (minutes >= 60) {
    if (stateSummary === '有卡点需要巩固') analysis = `今天学习投入比较扎实，累计 ${fmtDuration(minutes)}，但也遇到了卡点。可以继续推进，同时记得回头巩固卡住的部分。${taskFragment}`;
    else if (stateSummary === '专注度较好') analysis = `今天学习投入比较扎实，累计 ${fmtDuration(minutes)}，专注度也不错。保持这个节奏就好。${taskFragment}`;
    else analysis = `今天学习投入比较扎实，累计 ${fmtDuration(minutes)}，过程也比较平稳。适合继续稳步推进。${taskFragment}`;
  } else {
    if (stateSummary === '有卡点需要巩固') analysis = `今天是一次轻量学习，累计 ${fmtDuration(minutes)}，但过程里出现了卡点。接下来适合放慢一点，先巩固再继续。${taskFragment}`;
    else if (stateSummary === '专注度较好') analysis = `今天完成了一次轻量学习，累计 ${fmtDuration(minutes)}，专注度不错，适合继续保持节奏。${taskFragment}`;
    else analysis = `今天完成了一次轻量学习，累计 ${fmtDuration(minutes)}，过程平稳，适合热身、复习或保持节奏。${taskFragment}`;
  }

  const zone = minutes >= 120 ? '高强度' : minutes >= 60 ? '中度' : minutes > 0 ? '轻度' : '无记录';
  const zoneCls = minutes >= 120 ? 'high' : minutes >= 60 ? 'mid' : minutes > 0 ? 'low' : 'none';

  return {
    title: selectedInfo.value.title,
    headline: !daySessions.length
      ? '这一天没有学习记录'
      : daySessions.length === 1
        ? '这一天完成了 1 次学习会话'
        : `这一天完成了 ${daySessions.length} 次学习会话`,
    count: daySessions.length,
    minutes,
    primaryTask,
    stateSummary,
    analysis,
    zone,
    zoneCls,
    sessions: sessionsView
  };
});

onMounted(loadAll);
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
.tip__ai {
  flex: 0 0 auto;
  font-size: 10px; font-weight: 900; letter-spacing: 0.04em;
  color: var(--faint);
  border: 1px solid var(--line); border-radius: 6px;
  padding: 2px 5px;
}

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
.action__reason {
  display: inline-flex; align-items: center; gap: 6px;
  margin: 0; padding: 6px 12px; width: fit-content;
  font-size: 12.5px; font-weight: 600; line-height: 1.5;
  color: var(--blue-deep); background: rgba(52, 120, 246, 0.08);
  border: 1px solid rgba(52, 120, 246, 0.14); border-radius: 999px;
}
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
  transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
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
.mini__badge {
  margin-left: 4px; padding: 1px 6px; border-radius: 999px;
  font-size: 10px; font-weight: 700; vertical-align: 2px;
  color: var(--accent); background: rgba(141, 107, 255, 0.12);
}

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
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
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

<style scoped>
.dash__loading { display: grid; justify-items: center; padding: 64px 0; }
.badge--green { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.badge--cyan { color: #2b7a99; background: rgba(67, 176, 216, 0.14); }
.path__detail-link {
  font-size: 12.5px; font-weight: 700; color: var(--blue-deep);
  text-decoration: none; text-align: center;
  border-top: 1px solid var(--line); padding-top: 12px;
}
.path__detail-link:hover { text-decoration: underline; }
.step--blocked .step__dot { border-color: var(--red); box-shadow: 0 0 0 4px rgba(239, 117, 120, 0.14); }
.mini__icon--medal { font-size: 18px; }
.link-muted { font-size: 13px; font-weight: 600; color: var(--faint); cursor: pointer; text-decoration: none; }
.link-muted:hover { color: var(--blue-deep); }
.dash__main { width: 100%; }
</style>

<style scoped>
.greet__sub {
  font-size: 12px;
  color: var(--faint);
  max-width: 46ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tip--recover { border-color: rgba(141, 107, 255, 0.28); background: linear-gradient(135deg, rgba(141, 107, 255, 0.08), rgba(67, 176, 216, 0.05)); }
.tip--recover .tip__icon { color: var(--accent); }
.tip--warn { border-color: rgba(244, 170, 70, 0.3); background: linear-gradient(135deg, rgba(244, 170, 70, 0.09), rgba(244, 170, 70, 0.04)); }
.tip--warn .tip__icon { color: #b3540a; }
.tip--attention { border-color: rgba(239, 117, 120, 0.25); background: linear-gradient(135deg, rgba(239, 117, 120, 0.07), rgba(244, 170, 70, 0.05)); }
.tip--attention .tip__icon { color: #c0454a; }
.tip--normal { border-color: rgba(52, 120, 246, 0.18); background: linear-gradient(135deg, rgba(52, 120, 246, 0.07), rgba(67, 176, 216, 0.05)); }
.path__note {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 600; color: #b3540a;
  background: rgba(244, 170, 70, 0.1);
  border: 1px solid rgba(244, 170, 70, 0.3);
  border-radius: 10px;
  padding: 8px 11px;
}
</style>

<style scoped>
/* 超长机器生成标题：两行截断 */
.pcard__title, .hero h1, .path__title strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

<style scoped>
/* ---------- 当天明细入口 ---------- */
.day-detail__more {
  border: 0; background: transparent;
  color: var(--blue-deep);
  font: inherit; font-size: 12.5px; font-weight: 800;
  cursor: pointer; text-align: left;
  padding: 8px 0 0;
}
.day-detail__more:hover { text-decoration: underline; }

/* ---------- 当天学习复盘抽屉 ---------- */
.sheet-mask {
  position: fixed; inset: 0; z-index: 80;
  background: rgba(23, 32, 51, 0.32);
  backdrop-filter: blur(2px);
  display: flex; justify-content: flex-end;
}
.sheet {
  width: min(480px, 100%);
  height: 100%;
  background: var(--canvas);
  border-left: 1px solid var(--line);
  box-shadow: -24px 0 60px rgba(23, 32, 51, 0.18);
  display: flex; flex-direction: column;
}
.sheet__head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 18px 20px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.sheet__date { font-size: 12px; font-weight: 700; color: var(--faint); }
.sheet__headline { margin: 4px 0 0; font-size: 18px; letter-spacing: -0.01em; }
.sheet__head-right { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.sheet__zone { font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.sheet__zone--low { color: #2b7a99; background: rgba(67, 176, 216, 0.14); }
.sheet__zone--mid { color: #b3540a; background: rgba(244, 170, 70, 0.15); }
.sheet__zone--high { color: #6b4ae0; background: rgba(141, 107, 255, 0.14); }
.sheet__zone--none { color: var(--faint); background: #eef2f8; }
.sheet__close {
  width: 30px; height: 30px; border-radius: 9px;
  display: grid; place-items: center;
  color: var(--faint); font-size: 16px; cursor: pointer;
  border: 1px solid var(--line); background: #fff;
}
.sheet__close:hover { color: var(--ink); }

.sheet__scroll {
  flex: 1; overflow-y: auto;
  padding: 16px 18px 28px;
  display: grid; gap: 14px;
  align-content: start;
}
.sheet__summary {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.sheet__summary > div {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 11px 13px;
  display: grid; gap: 3px;
}
.sheet__summary-wide { grid-column: 1 / -1; }
.sheet__summary small { font-size: 11px; color: var(--faint); font-weight: 700; }
.sheet__summary strong { font-size: 14px; line-height: 1.4; }
.sheet__block {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 16px;
  display: grid; gap: 10px;
}
.sheet__block h4 { margin: 0; font-size: 13px; }
.sheet__block p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.7; }
.sheet__empty {
  font-size: 13px; color: var(--faint);
  border: 1px dashed var(--line); border-radius: 12px;
  padding: 18px 14px; text-align: center;
  background: #fafcff;
}

/* ---------- 会话卡 ---------- */
.scard {
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 13px 14px;
  display: grid; gap: 9px;
  background: #fbfcff;
}
.scard + .scard { margin-top: 4px; }
.scard__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.scard__title { min-width: 0; display: grid; gap: 3px; }
.scard__title strong { font-size: 13.5px; line-height: 1.45; }
.scard__title small { font-size: 11.5px; color: var(--faint); font-variant-numeric: tabular-nums; }
.scard__duration {
  flex: 0 0 auto;
  font-size: 12px; font-weight: 800; color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.09);
  padding: 4px 10px; border-radius: 999px;
  white-space: nowrap;
}
.scard__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: 11px; font-weight: 700;
  padding: 3px 9px; border-radius: 999px;
  background: #eef2f8; color: var(--muted);
}
.chip--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.chip--cyan { color: #2b7a99; background: rgba(67, 176, 216, 0.14); }
.chip--purple { color: var(--accent); background: rgba(141, 107, 255, 0.12); }
.scard__confuse {
  font-size: 12px; color: #b3540a; font-weight: 600;
  background: rgba(244, 170, 70, 0.1);
  border: 1px solid rgba(244, 170, 70, 0.28);
  border-radius: 9px;
  padding: 7px 10px;
  line-height: 1.55;
}
.scard__stages { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.scard__stage {
  font-size: 11px; font-weight: 700; color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.07);
  border: 1px solid rgba(52, 120, 246, 0.2);
  padding: 3px 8px; border-radius: 999px;
}
.scard__stage-sep { color: var(--faint); font-size: 11px; }
.scard__toggle {
  justify-self: start;
  border: 0; background: transparent;
  color: var(--faint);
  font: inherit; font-size: 11.5px; font-weight: 700;
  cursor: pointer; padding: 0;
}
.scard__toggle:hover { color: var(--blue-deep); }
.scard__events {
  list-style: none; margin: 0; padding: 8px 0 0;
  border-top: 1px dashed var(--line);
  display: grid; gap: 7px;
}
.scard__events li {
  display: grid; grid-template-columns: 44px 1fr; gap: 8px;
  font-size: 12px; line-height: 1.55; color: var(--muted);
}
.scard__event-time { color: var(--faint); font-variant-numeric: tabular-nums; font-size: 11px; padding-top: 2px; }

/* 抽屉动画 */
.sheet-enter-active, .sheet-leave-active { transition: opacity .22s ease; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .24s cubic-bezier(0.32, 0.72, 0.24, 1); }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateX(40px); }

/* 移动端：底部弹层 */
@media (max-width: 720px) {
  .sheet-mask { align-items: flex-end; }
  .sheet {
    width: 100%; height: auto; max-height: 86vh;
    border-left: 0;
    border-top: 1px solid var(--line);
    border-radius: 20px 20px 0 0;
  }
  .sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(60px); }
}
</style>

<style scoped>
/* 移动端防横向溢出 */
.action__eyebrow { flex-wrap: wrap; row-gap: 4px; }
.action__from { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .greet__left { flex-wrap: wrap; row-gap: 4px; }
  .greet__sub { white-space: normal; flex-basis: 100%; }
  .action__title { overflow-wrap: anywhere; }
}
</style>

<style scoped>
/* 移动端：本周条 7 列收缩适配窄屏 */
@media (max-width: 900px) {
  .week { padding: 16px 14px; }
  .week__grid { gap: 5px; }
  .day { padding: 6px 2px 8px; }
  .day__cell { width: 28px; height: 28px; border-radius: 8px; font-size: 11px; }
  .month { padding: 16px 14px; }
  .month__meta { gap: 10px; }
}
</style>
