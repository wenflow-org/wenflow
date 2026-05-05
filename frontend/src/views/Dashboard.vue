<template>
  <div class="dashboard-page">
    <div class="dashboard-bg-layer">
      <div class="dashboard-bg-orb dashboard-bg-orb--1"></div>
      <div class="dashboard-bg-orb dashboard-bg-orb--2"></div>
      <div class="dashboard-bg-grid"></div>
    </div>

    <header class="dashboard-header" :class="{ 'dashboard-header--scrolled': scrolled }">
      <div class="header-container">
        <button type="button" class="brand" @click="router.push('/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="brand-logo" />
        </button>

        <nav class="header-nav" aria-label="应用导航">
          <router-link to="/dashboard" class="nav-item nav-item--active">学习台</router-link>
          <router-link to="/goal-conversation" class="nav-item">AI 规划</router-link>
          <router-link to="/learning-paths" class="nav-item">学习路径</router-link>
          <router-link to="/learning-state" class="nav-item">学习状态</router-link>
          <router-link to="/achievements" class="nav-item">成就</router-link>
        </nav>

        <div class="header-right">
          <router-link to="/goal-conversation" class="header-cta">开始新目标</router-link>
          <el-dropdown>
            <button type="button" class="user-chip">
              <span>{{ userInitial }}</span>
              <strong>{{ userStore.user?.name || '同学' }}</strong>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/user')">
                  <el-icon><User /></el-icon>
                  能力中心
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">
                  <el-icon><Switch /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <main class="dashboard-main">
      <section class="dashboard-hero surface-card">
        <div class="dashboard-hero__copy">
          <span class="pill">学习台</span>
          <h1>{{ dashboardTitle }}</h1>
          <p>{{ dashboardSubtitle }}</p>

          <div class="dashboard-list-section">
            <div class="dashboard-list-section__head">
              <span class="section-kicker">今天建议</span>
              <strong>先完成一件最重要的小事</strong>
            </div>

            <div class="dashboard-list">
              <router-link v-for="item in todayActionItems" :key="item.id" :to="item.to" class="dashboard-list__item" :class="`dashboard-list__item--${item.tone}`">
                <span class="dashboard-list__dot" :class="`dashboard-list__dot--${item.dot}`"></span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.desc }}</p>
                </div>
                <span class="dashboard-list__action">{{ item.action }}</span>
              </router-link>
            </div>
          </div>
        </div>

        <aside class="focus-card">
          <div class="focus-card__head">
            <span class="section-kicker">你现在主要在学习</span>
            <span class="focus-card__badge">{{ hasLearningPath ? '进行中' : '待开始' }}</span>
          </div>

          <div class="focus-card__summary">
            <h2>{{ primaryPathTitle }}</h2>
            <p>{{ primaryPathDesc }}</p>
          </div>


          <div class="focus-card__stats">
            <article>
              <span>路径数量</span>
              <strong>{{ pathCount }}</strong>
              <p>{{ hasLearningPath ? '当前学习路径数量' : '规划目标后会生成路径' }}</p>
            </article>
            <article>
              <span>当前进度</span>
              <strong>{{ completedTaskCount }}/{{ totalTaskCount }}</strong>
              <p>{{ currentPathHint }}</p>
            </article>
            <article>
              <span>下一步</span>
              <strong>{{ nextStepLabel }}</strong>
              <p>{{ nextStepHint }}</p>
            </article>
          </div>

          <router-link :to="hasLearningPath ? '/learning-paths' : '/goal-conversation'" class="btn btn--primary btn--full">
            {{ hasLearningPath ? '查看主路径' : '先去规划目标' }}
          </router-link>
        </aside>
      </section>

      <section class="dashboard-calendar-section">
        <div class="dashboard-calendar-layout">
          <article class="surface-card dashboard-calendar-panel">
            <LoadCalendar @day-select="handleCalendarDaySelect" />
          </article>

          <aside class="surface-card dashboard-calendar-status">
            <div v-if="!selectedCalendarDay" class="dashboard-calendar-status__empty">
              <div class="dashboard-calendar-status__empty-icon">📅</div>
              <p>点击日历中的某一天，查看当天状态</p>
            </div>

            <div v-else class="dashboard-calendar-status__content">
              <div class="dashboard-calendar-status__head">
                <span class="section-kicker">所选日期状态</span>
                <strong>{{ calendarDayFormatDate(selectedCalendarDay.date) }}</strong>
              </div>

              <div class="dashboard-calendar-status__cards">
                <article class="dashboard-calendar-status__card">
                  <span>学习总时长</span>
                  <strong>{{ calendarDayFormatDuration(selectedCalendarDay.durationMinutes) }}</strong>
                </article>
                <article class="dashboard-calendar-status__card">
                  <span>学习会话</span>
                  <strong>{{ selectedCalendarDay.sessionCount }}次</strong>
                </article>
                <article class="dashboard-calendar-status__card">
                  <span>主要内容</span>
                  <strong class="dashboard-calendar-status__text">{{ selectedCalendarDay.primaryTaskTitle || '暂无任务' }}</strong>
                </article>
                <article class="dashboard-calendar-status__card">
                  <span>负荷等级</span>
                  <strong class="dashboard-calendar-status__zone" :class="calendarDayZone(selectedCalendarDay.durationMinutes).cls">
                    {{ calendarDayZone(selectedCalendarDay.durationMinutes).label }}
                  </strong>
                </article>
              </div>

              <div class="dashboard-calendar-status__analysis">
                <strong>当天观察</strong>
                <p>{{ calendarDayAnalysis }}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import { Switch, User } from '@element-plus/icons-vue';
import LoadCalendar from '../components/LoadCalendar.vue';
import { learningAPI, type LearningStats } from '../api/learning';
import { useUserStore } from '../stores/user';

const router = useRouter();
const userStore = useUserStore();
const stats = ref<LearningStats | null>(null);
const loading = ref(false);
const scrolled = ref(false);
const selectedCalendarDay = ref<any>(null);

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const pathCount = computed(() => stats.value?.paths?.total || 0);
const hasLearningPath = computed(() => pathCount.value > 0);
const completedTaskCount = computed(() => stats.value?.tasks.completed || stats.value?.subtasks?.completed || 0);
const inProgressTaskCount = computed(() => stats.value?.tasks.inProgress || stats.value?.subtasks?.inProgress || 0);
const totalTaskCount = computed(() => completedTaskCount.value + inProgressTaskCount.value || 1);
const totalLearningMinutes = computed(() => stats.value?.time.totalCompleted || stats.value?.time.totalMinutes || 0);

const dashboardTitle = computed(() => {
  if (!hasLearningPath.value) return `你好，${userStore.user?.name || '同学'}，先从一个具体目标开始。`;
  return `欢迎回来，${userStore.user?.name || '同学'}。`;
});

const dashboardSubtitle = computed(() => {
  if (!hasLearningPath.value) return '描述一件你最近想解决的事，把它缩小到可以开始的一步。';
  return '今天先完成一件最重要的小事。';
});

const primaryPathTitle = computed(() => (hasLearningPath.value ? '当前学习重点' : '还没有学习路径'));
const primaryPathDesc = computed(() => (
  hasLearningPath.value
    ? '你正在推进一条学习路径。'
    : '从一个具体目标开始，系统会根据你的情况生成第一版学习路径。'
));

const currentPathHint = computed(() => {
  if (inProgressTaskCount.value > 0) return `${inProgressTaskCount.value} 个任务进行中`;
  if (completedTaskCount.value > 0) return '已完成部分任务';
  return hasLearningPath.value ? '路径已生成' : '需要先规划目标';
});

const nextStepLabel = computed(() => (hasLearningPath.value ? '查看任务' : '规划目标'));
const nextStepHint = computed(() => (hasLearningPath.value ? '当前路径中有一项小任务待完成。' : '先描述你想解决的事。'));

const currentStateLabel = computed(() => {
  const lsb = stats.value?.state?.lsb;
  if (typeof lsb !== 'number') return '暂无状态数据';
  if (lsb >= 4) return '可以继续深入';
  if (lsb >= 0) return '适合轻量推进';
  if (lsb >= -3) return '建议放慢一点';
  return '今天先恢复状态';
});

const todayActionItems = computed(() => {
  if (!hasLearningPath.value) {
    return [
      { id: 'goal', tone: 'primary', dot: 'active', title: '先规划一个目标', desc: '描述你想解决的事，系统会生成学习路径。', action: '规划目标', to: '/goal-conversation' },
      { id: 'state', tone: 'muted', dot: 'dim', title: '查看学习状态', desc: '完成一次学习后，系统会根据你的节奏给出建议。', action: '前往查看', to: '/learning-state' },
      { id: 'record', tone: 'muted', dot: 'dim', title: '查看学习记录', desc: '开始学习后会自动记录学习时间。', action: '前往查看', to: '/achievements' }
    ];
  }

  const lsb = stats.value?.state?.lsb;
  const suggestion = stats.value?.suggestion?.message;

  const task = inProgressTaskCount.value > 0
    ? { id: 'task', tone: 'primary', dot: 'active', title: `继续当前任务（${inProgressTaskCount.value} 个进行中）`, desc: '回到学习路径，接着上次推进。', action: '继续学习', to: '/learning-paths' }
    : { id: 'task', tone: 'primary', dot: 'active', title: '从当前路径开始第一个任务', desc: '今天迈出第一步，比完美更重要。', action: '查看路径', to: '/learning-paths' };

  const record = { id: 'record', tone: 'muted', dot: 'dim', title: '查看学习记录', desc: totalLearningMinutes.value > 0 ? '你已经有学习积累，查看记录可以复盘节奏。' : '开始一次学习后会自动记录。', action: '前往查看', to: '/achievements' };

  let suggest;
  if (typeof lsb === 'number' && suggestion) {
    const tone = lsb >= 0 ? 'accent' : 'warn';
    suggest = { id: 'state', tone, dot: lsb >= 0 ? 'active' : 'warn', title: '查看学习状态', desc: suggestion, action: '前往查看', to: '/learning-state' };
  } else if (typeof lsb === 'number') {
    const tone = lsb >= 0 ? 'accent' : 'warn';
    suggest = { id: 'state', tone, dot: lsb >= 0 ? 'active' : 'warn', title: '查看学习状态', desc: currentStateLabel.value, action: '前往查看', to: '/learning-state' };
  } else {
    suggest = { id: 'state', tone: 'muted', dot: 'dim', title: '查看学习状态', desc: '完成一次学习后，系统会根据你的节奏给出建议。', action: '前往查看', to: '/learning-state' };
  }

  return [task, suggest, record];
});

const handleCalendarDaySelect = (day: any) => {
  selectedCalendarDay.value = day;
};

const calendarDayFormatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const calendarDayZone = (minutes: number) => {
  if (minutes >= 120) return { label: 'Z3 高强度', cls: 'dashboard-calendar-status__zone--z3' };
  if (minutes >= 60) return { label: 'Z2 中度', cls: 'dashboard-calendar-status__zone--z2' };
  if (minutes > 0) return { label: 'Z1 轻度', cls: 'dashboard-calendar-status__zone--z1' };
  return { label: '休息日', cls: 'dashboard-calendar-status__zone--rest' };
};

const calendarDayFormatDuration = (minutes: number) => {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m}m` : `${m}m`;
};

const calendarDayAnalysis = computed(() => {
  const day = selectedCalendarDay.value;
  if (!day) return '';
  if (day.durationMinutes === 0) return '这一天还没有学习记录，可以作为休息日，或者补一次短时学习。';
  if (day.durationMinutes >= 120) return `高强度学习日，累计 ${calendarDayFormatDuration(day.durationMinutes)}。建议之后适当安排恢复。`;
  if (day.durationMinutes >= 60) return `学习投入比较扎实，累计 ${calendarDayFormatDuration(day.durationMinutes)}。保持这个节奏就好。`;
  return `轻量学习日，累计 ${calendarDayFormatDuration(day.durationMinutes)}，适合保持节奏或复习。`;
});

async function fetchStats() {
  loading.value = true;
  try {
    stats.value = await learningAPI.getStats();
  } catch (error) {
    console.error('获取统计失败:', error);
  } finally {
    loading.value = false;
  }
}

const handleScroll = () => {
  scrolled.value = window.scrollY > 24;
};

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });
    userStore.logout();
    toast.success('已退出登录');
    router.push('/login');
  } catch {
    // 用户取消
  }
};

onMounted(async () => {
  await fetchStats();
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
.dashboard-page {
  --dash-ink: #172033;
  --dash-muted: #66758d;
  --dash-blue: #3478f6;
  --dash-blue-deep: #1f57cc;
  min-height: 100vh;
  background: #f3f6fb;
  color: var(--dash-ink);
  position: relative;
  overflow-x: hidden;
}

.dashboard-bg-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.dashboard-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.2;
}

.dashboard-bg-orb--1 {
  width: 520px;
  height: 520px;
  top: 80px;
  right: -150px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.38), transparent 70%);
}

.dashboard-bg-orb--2 {
  width: 460px;
  height: 460px;
  left: -170px;
  bottom: 30px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
}

.dashboard-bg-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(23, 32, 51, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(23, 32, 51, 0.035) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), transparent 72%);
}

.dashboard-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
  backdrop-filter: blur(18px);
}

.dashboard-header--scrolled {
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.06);
}

.header-container {
  width: min(1280px, calc(100% - 48px));
  min-height: 72px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.brand,
.header-nav,
.header-right,
.dashboard-hero__actions,
.today-item,
.section-head,
.panel-head,
.focus-card__head {
  display: flex;
  align-items: center;
}

.brand {
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dash-ink);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.brand-logo {
  height: 40px;
}

.brand {
  width: auto;
  justify-content: flex-start;
  flex: 0 0 auto;
}

.brand-logo {
  height: 56px;
  object-fit: contain;
  display: block;
}

.header-nav {
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.nav-item {
  padding: 8px 12px;
  border-radius: 999px;
  color: color-mix(in srgb, var(--dash-ink) 68%, white);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.nav-item:hover,
.nav-item--active {
  background: rgba(52, 120, 246, 0.09);
  color: var(--dash-blue-deep);
}

.header-right {
  gap: 10px;
}

.header-cta,
.btn,
.inline-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  font-weight: 800;
}

.header-cta {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, var(--dash-blue), var(--dash-blue-deep));
  font-size: 13px;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.78);
  color: var(--dash-ink);
}

.user-chip span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(52, 120, 246, 0.1);
  color: var(--dash-blue-deep);
  font-weight: 900;
}

.dashboard-main {
  position: relative;
  z-index: 1;
  width: min(1240px, calc(100% - 48px));
  margin: 0 auto;
  padding: 28px 0 80px;
  display: grid;
  gap: 24px;
}

.surface-card,
.overview-card,
.today-card {
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(16px);
}

.dashboard-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 28px;
  padding: 30px;
  border-radius: 34px;
}

.dashboard-hero__copy,
.focus-card,
.dashboard-panel,
.today-card,
.friction-list,
.achievement-note {
  display: grid;
  gap: 16px;
}

.pill,
.section-kicker {
  width: fit-content;
  font-size: 12px;
  font-weight: 900;
  color: var(--dash-blue-deep);
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: start;
  justify-self: start;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  line-height: 1;
}

.section-kicker {
  letter-spacing: 0.05em;
}

.dashboard-hero h1,
.focus-card h2,
.section-head h2,
.panel-head h2 {
  margin: 0;
  line-height: 1.08;
  letter-spacing: -0.045em;
}

.dashboard-hero h1 {
  max-width: 760px;
  font-size: clamp(38px, 5vw, 64px);
}

.dashboard-hero p,
.focus-card p,
.today-item p,
.overview-card p,
.friction-card p,
.achievement-note p {
  margin: 0;
  color: var(--dash-muted);
  line-height: 1.65;
}

.dashboard-hero__copy > p {
  max-width: 680px;
  font-size: 16px;
}

.dashboard-hero__actions {
  gap: 12px;
  flex-wrap: wrap;
}

.btn {
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 14px;
}

.btn--lg {
  min-height: 50px;
  padding-inline: 24px;
}

.btn--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--dash-blue), var(--dash-blue-deep));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.2);
}

.btn--ghost {
  color: var(--dash-ink);
  background: rgba(255, 255, 255, 0.74);
  border-color: rgba(23, 32, 51, 0.08);
}

.btn--full {
  width: 100%;
}

.today-card {
  margin-top: 8px;
  padding: 18px;
  border-radius: 24px;
}

.dashboard-list-section + .dashboard-list-section {
  margin-top: 24px;
}

.dashboard-list-section__head {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}

.dashboard-list {
  display: grid;
  gap: 10px;
}

.dashboard-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.8);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

a.dashboard-list__item:hover,
button.dashboard-list__item:hover,
.dashboard-list__item:hover {
  background: rgba(243, 246, 251, 1);
  box-shadow: 0 2px 8px rgba(23, 32, 51, 0.06);
}

.dashboard-list__item div {
  flex: 1;
  min-width: 0;
}

.dashboard-list__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 2px;
}

.dashboard-list__dot--active {
  background: var(--dash-blue);
  box-shadow: 0 0 0 6px rgba(52, 120, 246, 0.1);
}

.dashboard-list__dot--done {
  background: #31b16f;
  box-shadow: 0 0 0 6px rgba(49, 177, 111, 0.1);
}

.dashboard-list__dot--warn {
  background: #e6a23c;
  box-shadow: 0 0 0 6px rgba(230, 162, 60, 0.1);
}

.dashboard-list__dot--dim {
  background: #c0c4cc;
  box-shadow: 0 0 0 6px rgba(192, 196, 204, 0.1);
}

.dashboard-list__action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 800;
  color: var(--dash-blue-deep);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(52, 120, 246, 0.08);
  white-space: nowrap;
  transition: background 0.15s ease;
}

.dashboard-list__action--muted {
  color: var(--dash-ink);
  background: rgba(23, 32, 51, 0.06);
}

a.dashboard-list__item:hover .dashboard-list__action {
  background: rgba(52, 120, 246, 0.14);
}

.dashboard-list__item--warn .dashboard-list__action {
  color: #b8860b;
  background: rgba(230, 162, 60, 0.1);
}

.dashboard-list__item--warn:hover .dashboard-list__action {
  background: rgba(230, 162, 60, 0.18);
}

.today-card__head {
  display: grid;
  gap: 4px;
}

.today-card__head span,
.overview-card span,
.focus-card__stats span,
.achievement-summary span {
  font-size: 12px;
  color: var(--dash-muted);
  font-weight: 800;
}

.today-list {
  display: grid;
  gap: 10px;
}

.overview-grid--today {
  margin-top: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.today-item {
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.8);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.today-item:hover {
  background: rgba(243, 246, 251, 1);
  box-shadow: 0 2px 8px rgba(23, 32, 51, 0.06);
}

.today-item__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
}

.today-item__dot--active {
  background: var(--dash-blue);
  box-shadow: 0 0 0 6px rgba(52, 120, 246, 0.1);
}

.today-item__dot--done {
  background: #31b16f;
  box-shadow: 0 0 0 6px rgba(49, 177, 111, 0.1);
}

.today-item__dot--warn {
  background: #e6a23c;
  box-shadow: 0 0 0 6px rgba(230, 162, 60, 0.1);
}

.today-item__dot--dim {
  background: #c0c4cc;
  box-shadow: 0 0 0 6px rgba(192, 196, 204, 0.1);
}

.today-item div {
  flex: 1;
  min-width: 0;
}

.today-item__action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 800;
  color: var(--dash-blue-deep);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(52, 120, 246, 0.08);
  white-space: nowrap;
  transition: background 0.15s ease;
}

.today-item:hover .today-item__action {
  background: rgba(52, 120, 246, 0.14);
}

.today-item--warn .today-item__action {
  color: #b8860b;
  background: rgba(230, 162, 60, 0.1);
}

.today-item--warn:hover .today-item__action {
  background: rgba(230, 162, 60, 0.18);
}

.focus-card {
  padding: 24px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.07), rgba(255, 255, 255, 0.76));
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.focus-card__head,
.section-head,
.panel-head {
  justify-content: space-between;
  gap: 16px;
}

.focus-card__badge {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: var(--dash-blue-deep);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}

.focus-card__summary {
  margin-top: -4px;
}

.focus-card__stats,
.achievement-summary {
  display: grid;
  gap: 10px;
}

.focus-card__stats article,
.achievement-summary article,
.friction-card {
  padding: 15px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.focus-card__stats strong,
.overview-card strong,
.achievement-summary strong {
  display: block;
  margin: 4px 0;
  font-size: 24px;
  line-height: 1;
}

.dashboard-section,
.dashboard-bottom-grid {
  display: grid;
  gap: 18px;
}

.section-head h2,
.panel-head h2 {
  margin-top: 6px;
  font-size: clamp(24px, 3vw, 36px);
}

.inline-link {
  color: var(--dash-blue-deep);
  font-size: 13px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.overview-card {
  display: grid;
  gap: 8px;
  padding: 22px;
  border-radius: 24px;
}

.overview-card--primary {
  border-color: rgba(52, 120, 246, 0.14);
}

.overview-card--success {
  border-color: rgba(49, 177, 111, 0.14);
}

.overview-card--warning {
  border-color: rgba(244, 170, 70, 0.18);
}

.overview-card--accent {
  border-color: rgba(141, 107, 255, 0.16);
}

.overview-card small {
  color: color-mix(in srgb, var(--dash-ink) 74%, white);
  font-weight: 900;
}

.dashboard-bottom-grid {
  grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
}

.dashboard-panel {
  padding: 24px;
  border-radius: 28px;
}

.friction-card strong {
  display: block;
  margin-bottom: 6px;
}

.achievement-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.achievement-note {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  padding: 16px;
  border-radius: 18px;
  background: rgba(52, 120, 246, 0.07);
  color: var(--dash-blue-deep);
}

/* ========== 学习负荷日历 ========== */
.dashboard-calendar-section {
  margin-bottom: 24px;
}

.dashboard-calendar-layout {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  align-items: start;
}

.dashboard-calendar-panel {
  padding: 24px;
  border-radius: 24px;
  overflow: hidden;
}

.dashboard-calendar-status {
  padding: 22px;
  border-radius: 24px;
  display: grid;
  gap: 16px;
  position: sticky;
  top: 88px;
}

.dashboard-calendar-status__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px;
  color: var(--dash-muted);
  gap: 12px;
}

.dashboard-calendar-status__empty-icon {
  font-size: 2rem;
}

.dashboard-calendar-status__empty p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.dashboard-calendar-status__head {
  display: grid;
  gap: 6px;
}

.dashboard-calendar-status__head strong {
  font-size: 18px;
  color: var(--dash-ink);
  line-height: 1.2;
}

.dashboard-calendar-status__cards {
  display: grid;
  gap: 10px;
}

.dashboard-calendar-status__card {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.04);
}

.dashboard-calendar-status__card span {
  font-size: 12px;
  color: var(--dash-muted);
  white-space: nowrap;
}

.dashboard-calendar-status__card strong {
  font-size: 14px;
  color: var(--dash-ink);
  text-align: right;
}

.dashboard-calendar-status__text {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-calendar-status__zone {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.dashboard-calendar-status__zone--z1 {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
}

.dashboard-calendar-status__zone--z2 {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
}

.dashboard-calendar-status__zone--z3 {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.dashboard-calendar-status__zone--rest {
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
}

.dashboard-calendar-status__analysis {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(52, 120, 246, 0.06);
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.dashboard-calendar-status__analysis strong {
  font-size: 12px;
  font-weight: 700;
  color: var(--dash-blue-deep);
}

.dashboard-calendar-status__analysis p {
  margin: 0;
  font-size: 13px;
  color: color-mix(in srgb, var(--dash-ink) 72%, #fff);
  line-height: 1.6;
}

@media (max-width: 1120px) {
  .header-nav {
    display: none;
  }

  .dashboard-hero,
  .dashboard-bottom-grid {
    grid-template-columns: 1fr;
  }

  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-calendar-layout {
    grid-template-columns: 1fr;
  }

  .dashboard-calendar-status {
    position: static;
  }
}

@media (max-width: 700px) {
  .header-container,
  .dashboard-main {
    width: min(100% - 28px, 1240px);
  }

  .header-cta,
  .user-chip strong {
    display: none;
  }

  .dashboard-hero,
  .dashboard-panel,
  .dashboard-calendar-panel {
    padding: 20px;
    border-radius: 24px;
  }

  .overview-grid,
  .achievement-summary {
    grid-template-columns: 1fr;
  }

  .section-head,
  .panel-head,
  .dashboard-hero__actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }
}
</style>
