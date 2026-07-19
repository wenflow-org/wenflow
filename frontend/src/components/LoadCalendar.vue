<template>
  <div class="load-calendar">
    <div class="calendar-header">
      <div class="header-left">
        <h3 class="calendar-title">学习节奏日历</h3>
        <div class="month-selector">
          <button type="button" @click="changeMonth(-1)" class="month-btn" aria-label="上个月" title="上个月">
            <span>◀</span>
          </button>
          <span class="current-month">{{ currentMonthLabel }}</span>
          <button type="button" @click="changeMonth(1)" class="month-btn" aria-label="下个月" title="下个月">
            <span>▶</span>
          </button>
        </div>
        <div class="zone-legend">
          <span class="zone-item">
            <i class="zone-dot z1"></i>
            <span>轻度：少于 1 小时</span>
          </span>
          <span class="zone-item">
            <i class="zone-dot z2"></i>
            <span>中度：1 到 2 小时</span>
          </span>
          <span class="zone-item">
            <i class="zone-dot z3"></i>
            <span>高强度：2 小时以上</span>
          </span>
        </div>
      </div>
      <div class="header-right">
        <div class="month-stats" v-if="monthStats">
          <div class="stat-item">
            <span class="stat-label">本月学习</span>
            <span class="stat-value">{{ monthStats.totalMinutes }}分钟</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">学习天数</span>
            <span class="stat-value">{{ monthStats.studyDays }}天</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">学习次数</span>
            <span class="stat-value">{{ monthStats.sessionCount }}次</span>
          </div>
        </div>
      </div>
    </div>

    <div class="empty-state" v-if="loading && weeksList.length === 0">
      <el-icon class="loading-icon"><Loading /></el-icon>
      <p>正在加载本月学习记录...</p>
    </div>

    <div class="empty-state" v-else-if="!loading && loadError">
      <p>学习记录加载失败</p>
      <button type="button" class="selected-day-btn" @click="fetchMonthData">重新加载</button>
    </div>

    <div class="empty-state" v-else-if="!loading && monthStats?.sessionCount === 0">
      <span class="empty-icon">📅</span>
      <p>本月还没有学习记录</p>
      <p class="empty-hint">完成一次学习后，这里会显示日期和时长。</p>
    </div>

    <div v-if="weeksList.length > 0" class="weeks-container-wrap">
      <div class="weeks-loading-overlay" v-if="loading">
        <div class="loading-state weeks-loading-state">
          <el-icon class="loading-icon"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
      </div>

      <div class="weeks-container">
        <div
          v-for="(week, weekIndex) in weeksList"
          :key="weekIndex"
          class="week-row"
          :class="{ 'current-week': isCurrentWeek(week) }"
        >
          <div class="week-stats">
            <div class="week-label">{{ getWeekLabel(week, weekIndex) }}</div>
            <div class="week-summary">
              <div class="summary-item">
                <span class="summary-label">总时长</span>
                <span class="summary-value">{{ getWeekTotalMinutes(week) }}分钟</span>
              </div>
              <div class="summary-item">
                <span class="summary-label">学习天数</span>
                <span class="summary-value">{{ getWeekStudyDays(week) }}天</span>
              </div>
            </div>
            <div class="week-achievement" v-if="getWeekAchievement(week)">
              <span class="achievement-icon">🏆</span>
              <span class="achievement-text">{{ getWeekAchievement(week) }}</span>
            </div>
          </div>

          <div class="days-grid">
            <button
              v-for="day in week"
              :key="day.date"
              type="button"
              class="day-card"
              :class="{
                'has-load': day.durationMinutes > 0,
                'is-today': isToday(day.date),
                'is-empty': !day.isCurrentMonth,
                'is-clickable': day.isCurrentMonth && !isFutureDay(day.date),
                'is-selected': selectedDay?.date === day.date
              }"
              :disabled="!day.isCurrentMonth || isFutureDay(day.date)"
              @click="openDayDetail(day)"
            >
              <div class="card-header" :style="day.durationMinutes > 0 ? { backgroundColor: getBgColor(day.durationMinutes) } : {}">
                <div class="header-left">
                  <span class="day-weekday">{{ day.weekLabel }}</span>
                  <span class="day-date">{{ day.dayNum }}</span>
                </div>
                <div class="header-right" v-if="day.durationMinutes > 0">
                  <span class="study-time">{{ formatDuration(day.durationMinutes) }}</span>
                </div>
              </div>

              <div class="card-content">
                <div class="day-meta" v-if="day.durationMinutes > 0">
                  <span class="day-zone" :class="getLoadZoneClass(day.durationMinutes)">
                    {{ getLoadZoneLabel(day.durationMinutes) }}
                  </span>
                </div>
                <div class="no-data" v-else-if="day.isCurrentMonth && !isFutureDay(day.date)">
                  <span class="no-data-text">选择日期</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <el-drawer
      v-model="dayDetailOpen"
      :size="drawerSize"
      :direction="drawerDirection"
      :with-header="false"
      :lock-scroll="false"
      :close-on-click-modal="true"
      class="day-detail-drawer"
    >
      <div v-if="selectedDay" class="day-detail">
        <div class="day-detail-sheet-handle" v-if="isMobileDrawer"></div>
        <div class="detail-header">
          <div>
            <div class="detail-date">{{ formatDetailDate(selectedDay.date) }}</div>
            <h4 class="detail-title">{{ getDayHeadline(selectedDay) }}</h4>
          </div>
          <div class="detail-header-actions">
            <div class="detail-zone" :class="getLoadZoneClass(selectedDay.durationMinutes)">
              {{ getLoadZoneLabel(selectedDay.durationMinutes) }}
            </div>
            <button type="button" class="detail-close-btn" @click="dayDetailOpen = false" aria-label="关闭当天明细">
              <span>关闭</span>
            </button>
          </div>
        </div>

        <div class="detail-summary-grid">
          <div class="detail-summary-card">
            <span class="detail-summary-label">学习总时长</span>
            <strong class="detail-summary-value">{{ formatDuration(selectedDay.durationMinutes) }}</strong>
          </div>
          <div class="detail-summary-card">
            <span class="detail-summary-label">学习次数</span>
            <strong class="detail-summary-value">{{ selectedDay.sessionCount }}次</strong>
          </div>
          <div class="detail-summary-card">
            <span class="detail-summary-label">主要内容</span>
            <strong class="detail-summary-value detail-summary-text">{{ selectedDay.primaryTaskTitle || '未关联具体任务' }}</strong>
          </div>
          <div class="detail-summary-card">
            <span class="detail-summary-label">学习状态</span>
            <strong class="detail-summary-value detail-summary-text">{{ getDayStateSummary(selectedDay) }}</strong>
          </div>
        </div>

        <div class="detail-analysis" v-if="selectedDay.sessionCount > 0">
          <h5 class="detail-section-title">当天观察</h5>
          <p class="detail-analysis-text">{{ getDayAnalysis(selectedDay) }}</p>
        </div>

        <div class="detail-analysis detail-analysis-empty" v-else>
          <h5 class="detail-section-title">当天情况</h5>
          <p class="detail-analysis-text">这一天没有学习记录。</p>
        </div>

        <div class="detail-sessions">
          <h5 class="detail-section-title">学习记录</h5>
          <div v-if="selectedDay.sessions.length > 0" class="session-list">
            <div v-for="session in selectedDay.sessions" :key="session.id" class="session-card">
              <div class="session-card-header">
                <div>
                  <div class="session-title">{{ session.taskTitle || '本次学习' }}</div>
                  <div class="session-time">{{ formatSessionTime(session.startTime, session.endTime) }}</div>
                </div>
                <div class="session-duration">{{ formatDuration(session.durationMinutes) }}</div>
              </div>
              <div class="session-meta">
                <span class="session-chip">{{ getSessionStatusLabel(session) }}</span>
                <span v-if="session.parsedState" class="session-chip session-chip-state">{{ getSessionStateLabel(session.parsedState) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="detail-empty">暂无学习明细</div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Loading } from '@element-plus/icons-vue';
import api from '../utils/api';
import dayjs from 'dayjs';

const emit = defineEmits<{
  (e: 'day-select', day: DayData | null): void;
}>();

interface SessionState {
  cognitive?: number;
  stress?: number;
  engagement?: number;
  anomaly?: boolean;
}

interface SessionEntry {
  id: string;
  startTime: string;
  endTime?: string | null;
  durationMinutes: number;
  taskId?: string | null;
  taskTitle?: string | null;
  taskStatus?: string | null;
  status?: string | null;
  parsedState?: SessionState | null;
}

interface DayData {
  date: string;
  dayNum: number;
  weekLabel: string;
  isCurrentMonth: boolean;
  durationMinutes: number;
  primaryTaskTitle: string;
  sessionCount: number;
  sessions: SessionEntry[];
}

interface MonthStats {
  totalMinutes: number;
  studyDays: number;
  sessionCount: number;
}

const isDisplayableSession = (session: SessionEntry) => {
  if ((session.durationMinutes || 0) > 0) return true;
  if (session.endTime) return true;
  if (session.status === 'completed') return true;
  return false;
};

const loading = ref(true);
const loadError = ref('');
const weeksList = ref<DayData[][]>([]);
const monthStats = ref<MonthStats | null>(null);
const currentYear = ref(new Date().getFullYear());
const currentMonth = ref(new Date().getMonth());
const selectedDay = ref<DayData | null>(null);
const dayDetailOpen = ref(false);
const isMobileDrawer = ref(false);
let monthRequestId = 0;

const syncDrawerViewport = () => {
  isMobileDrawer.value = window.innerWidth <= 768;
};

const drawerDirection = computed(() => (isMobileDrawer.value ? 'btt' : 'rtl'));
const drawerSize = computed(() => (isMobileDrawer.value ? '78vh' : '460px'));

// 获取本地日期字符串（格式：YYYY-MM-DD）
const getLocalDateStr = (date: Date): string => {
  return dayjs(date).format('YYYY-MM-DD');
};

// 获取今天的本地日期字符串
const getTodayStr = (): string => {
  return dayjs().format('YYYY-MM-DD');
};

const currentMonthLabel = computed(() => {
  return `${currentYear.value}年${currentMonth.value + 1}月`;
});

// 获取月份数据
const fetchMonthData = async () => {
  const requestId = ++monthRequestId;
  const requestedYear = currentYear.value;
  const requestedMonth = currentMonth.value;
  loading.value = true;
  loadError.value = '';
  
  try {
    // 构建当月的起始和结束日期
    const startDate = new Date(requestedYear, requestedMonth, 1);
    const endDate = new Date(requestedYear, requestedMonth + 1, 0);
    
    const startDateStr = dayjs(startDate).format('YYYY-MM-DD');
    const endDateStr = dayjs(endDate).format('YYYY-MM-DD');
    
    // 调用后端API获取当月学习会话（该接口仅支持 limit，上限取 500；达到上限说明可能仍有数据被截断）
    const SESSION_FETCH_LIMIT = 500;
    const response = await api.get('/users/me/sessions', {
      params: {
        startDate: startDateStr,
        endDate: endDateStr,
        limit: SESSION_FETCH_LIMIT
      }
    });

    const sessions = response?.data || response || [];

    if (Array.isArray(sessions) && sessions.length >= SESSION_FETCH_LIMIT) {
      console.warn(`[LoadCalendar] 当月会话数达到拉取上限 ${SESSION_FETCH_LIMIT}，超出部分未显示`);
    }
    
    if (requestId !== monthRequestId) return;
    buildCalendar(sessions, requestedYear, requestedMonth);
    
  } catch (error) {
    if (requestId !== monthRequestId) return;
    console.error('获取月份数据失败:', error);
    loadError.value = '学习记录加载失败';
    buildCalendar([], requestedYear, requestedMonth);
  } finally {
    if (requestId === monthRequestId) loading.value = false;
  }
};

// 构建日历
const buildCalendar = (sessions: SessionEntry[], year: number, month: number) => {
  const weeks: DayData[][] = [];
  
  // 获取当月第一天和最后一天
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // 获取当月第一天是星期几（0=周日）
  const firstDayOfWeek = firstDay.getDay();
  
  // 构建会话映射（按日期）
  const sessionMap = new Map<string, { duration: number; sessions: SessionEntry[]; primaryTaskTitle: string }>();
  const displaySessions = sessions.filter(isDisplayableSession);
  
  displaySessions.forEach((session) => {
    const dateStr = session.startTime ? dayjs(session.startTime).format('YYYY-MM-DD') : '';
    if (dateStr) {
      const existing = sessionMap.get(dateStr) || { duration: 0, sessions: [], primaryTaskTitle: '' };
      sessionMap.set(dateStr, {
        duration: existing.duration + (session.durationMinutes || 0),
        sessions: [...existing.sessions, session],
        primaryTaskTitle: existing.primaryTaskTitle || session.taskTitle || '学习任务'
      });
    }
  });
  
  // 计算需要显示的天数（包含上月末尾几天和下月开头几天）
  const totalDays = lastDay.getDate();
  const totalCells = Math.ceil((firstDayOfWeek + totalDays) / 7) * 7;
  
  // 计算统计
  let totalMinutes = 0;
  let studyDays = 0;
  let sessionCount = 0;
  
  // 生成周数据
  let currentWeek: DayData[] = [];
  
  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - firstDayOfWeek;
    const date = new Date(year, month, 1 + dayOffset);
    
    // 使用本地时间格式化日期
    const dateStr = getLocalDateStr(date);
    const isCurrentMonth = date.getMonth() === month;
    const sessionData = sessionMap.get(dateStr);
    
    const dayData: DayData = {
      date: dateStr,
      dayNum: date.getDate(),
      weekLabel: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      isCurrentMonth,
      durationMinutes: sessionData?.duration || 0,
      primaryTaskTitle: sessionData?.primaryTaskTitle || '',
      sessionCount: sessionData?.sessions.length || 0,
      sessions: (sessionData?.sessions || []).slice().sort((a, b) => dayjs(a.startTime).valueOf() - dayjs(b.startTime).valueOf())
    };
    
    currentWeek.push(dayData);
    
    // 统计当月数据
    if (isCurrentMonth && sessionData) {
      totalMinutes += sessionData.duration;
      studyDays++;
      sessionCount += sessionData.sessions.length;
    }
    
    // 每周结束
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  
  weeksList.value = weeks;
  monthStats.value = {
    totalMinutes,
    studyDays,
    sessionCount
  };
};

const openDayDetail = (day: DayData) => {
  if (!day.isCurrentMonth || isFutureDay(day.date)) return;
  selectedDay.value = day;
  emit('day-select', day);
  dayDetailOpen.value = true;
};

// 切换月份
const changeMonth = (delta: number) => {
  const newMonth = currentMonth.value + delta;
  if (newMonth < 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else if (newMonth > 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value = newMonth;
  }
  selectedDay.value = null;
  dayDetailOpen.value = false;
  emit('day-select', null);
  void fetchMonthData();
};

// 判断是否是当前周
const isCurrentWeek = (week: DayData[]) => {
  const today = getTodayStr();
  return week.some(day => day.date === today);
};

// 判断是否是今天
const isToday = (dateStr: string) => {
  return dateStr === getTodayStr();
};

// 判断是否是未来日期
const isFutureDay = (dateStr: string) => {
  const today = dayjs().startOf('day');
  const date = dayjs(dateStr);
  return date.isAfter(today);
};

// 获取周标签
const getWeekLabel = (week: DayData[], index: number) => {
  if (isCurrentWeek(week)) {
    return '本周';
  }
  
  return `第${index + 1}周`;
};

// 获取周总时长
const getWeekTotalMinutes = (week: DayData[]) => {
  return week
    .filter(day => day.isCurrentMonth)
    .reduce((sum, day) => sum + day.durationMinutes, 0);
};

// 获取周学习天数
const getWeekStudyDays = (week: DayData[]) => {
  return week.filter(day => day.isCurrentMonth && day.durationMinutes > 0).length;
};

// 获取周成就
const getWeekAchievement = (week: DayData[]) => {
  const studyDays = getWeekStudyDays(week);
  if (studyDays >= 7) return '本周学习 7 天';
  if (studyDays >= 5) return '本周保持稳定投入';
  if (studyDays >= 3) return `本周学习 ${studyDays} 天`;
  return null;
};

// 获取背景颜色
const getBgColor = (minutes: number) => {
  if (minutes >= 120) return 'rgba(239, 68, 68, 0.2)';
  if (minutes >= 60) return 'rgba(251, 191, 36, 0.2)';
  return 'rgba(59, 130, 246, 0.2)';
};

// 格式化时长
const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}小时${m > 0 ? `${m}分钟` : ''}` : `${m}分钟`;
};

const getLoadZoneClass = (minutes: number) => {
  if (minutes >= 120) return 'zone-high';
  if (minutes >= 60) return 'zone-medium';
  if (minutes > 0) return 'zone-low';
  return 'zone-rest';
};

const getLoadZoneLabel = (minutes: number) => {
  if (minutes >= 120) return '高强度';
  if (minutes >= 60) return '中度';
  if (minutes > 0) return '轻度';
  return '休息日';
};

const formatDetailDate = (dateStr: string) => {
  const date = dayjs(dateStr);
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.day()];
  return `${date.format('M月D日')} ${weekday}`;
};

const formatSessionTime = (startTime: string, endTime?: string | null) => {
  const start = dayjs(startTime).format('HH:mm');
  const end = endTime ? dayjs(endTime).format('HH:mm') : null;
  return end ? `${start} - ${end}` : `${start} 开始`;
};

const getSessionStatusLabel = (session: SessionEntry) => {
  if (session.taskStatus === 'completed') return '任务已完成';
  if (session.taskStatus === 'in_progress') return '任务进行中';
  if (session.endTime) return '本次学习已结束';
  if (session.status === 'completed') return '本次学习已结束';
  if (session.status === 'active') return '仍在进行';
  return '已记录';
};

const getSessionStateLabel = (state?: SessionState | null) => {
  if (!state) return '状态未评估';
  if (state.anomaly) return '状态异常';
  if ((state.stress || 0) >= 0.75) return '压力偏高';
  if ((state.engagement || 0) >= 0.7) return '投入度高';
  if ((state.cognitive || 0) >= 0.7) return '理解顺畅';
  return '状态平稳';
};

const getDayHeadline = (day: DayData) => {
  if (day.sessionCount === 0) return '这一天没有学习记录';
  if (day.sessionCount === 1) return '这一天完成了 1 次学习会话';
  return `这一天完成了 ${day.sessionCount} 次学习会话`;
};

const getDayStateSummary = (day: DayData) => {
  if (day.sessionCount === 0) return '状态未评估';

  const states = day.sessions.map((session) => session.parsedState).filter(Boolean) as SessionState[];
  if (states.length === 0) return '状态未评估';

  const avgStress = states.reduce((sum, state) => sum + (state.stress || 0), 0) / states.length;
  const avgEngagement = states.reduce((sum, state) => sum + (state.engagement || 0), 0) / states.length;
  if (states.some((state) => state.anomaly)) return '有异常波动';
  if (avgStress >= 0.75) return '压力偏高';
  if (avgEngagement >= 0.7) return '专注度较好';
  return '过程平稳';
};

const getDayAnalysis = (day: DayData) => {
  if (day.sessionCount === 0) return '今天还没有学习记录。可以休息，也可以补一次短时学习。';
  const stateSummary = getDayStateSummary(day);
  const taskFragment = day.primaryTaskTitle ? `主要围绕“${day.primaryTaskTitle}”展开。` : '';

  if (day.durationMinutes >= 120) {
    if (stateSummary === '压力偏高') {
      return `今天学习时长较长，累计 ${formatDuration(day.durationMinutes)}，而且压力偏高。建议适当放慢节奏，注意恢复。${taskFragment}`;
    }
    if (stateSummary === '专注度较好') {
      return `今天学习时长较长，累计 ${formatDuration(day.durationMinutes)}，但整体专注度不错。后续注意恢复，就能把这个节奏维持住。${taskFragment}`;
    }
    if (stateSummary === '过程平稳') {
      return `今天学习时长较长，累计 ${formatDuration(day.durationMinutes)}，但过程整体平稳。建议之后安排恢复。${taskFragment}`;
    }
    return `今天学习时长较长，累计 ${formatDuration(day.durationMinutes)}。当前还没有足够状态数据，建议结合体感安排恢复。${taskFragment}`;
  }

  if (day.durationMinutes >= 60) {
    if (stateSummary === '压力偏高') {
      return `今天学习投入比较扎实，累计 ${formatDuration(day.durationMinutes)}，但压力有点高。可以继续推进，同时注意别把节奏拉得太满。${taskFragment}`;
    }
    if (stateSummary === '专注度较好') {
      return `今天学习投入比较扎实，累计 ${formatDuration(day.durationMinutes)}，专注度也不错。保持这个节奏就好。${taskFragment}`;
    }
    if (stateSummary === '过程平稳') {
      return `今天学习投入比较扎实，累计 ${formatDuration(day.durationMinutes)}，过程也比较平稳。适合继续稳步推进。${taskFragment}`;
    }
    return `今天学习投入比较扎实，累计 ${formatDuration(day.durationMinutes)}。当前还没有足够状态数据，可以继续观察自己的学习节奏。${taskFragment}`;
  }

  if (stateSummary === '压力偏高') {
    return `今天是一次轻量学习，累计 ${formatDuration(day.durationMinutes)}，但过程里已经出现了压力偏高的信号。接下来适合放慢一点。${taskFragment}`;
  }
  if (stateSummary === '专注度较好') {
    return `今天完成了一次轻量学习，累计 ${formatDuration(day.durationMinutes)}，专注度不错，适合继续保持节奏。${taskFragment}`;
  }
  if (stateSummary === '过程平稳') {
    return `今天完成了一次轻量学习，累计 ${formatDuration(day.durationMinutes)}，过程平稳，适合热身、复习或保持节奏。${taskFragment}`;
  }
  return `今天完成了一次轻量学习，累计 ${formatDuration(day.durationMinutes)}。当前还没有足够状态数据，适合作为热身或短时复习。${taskFragment}`;
};

onMounted(() => {
  syncDrawerViewport();
  window.addEventListener('resize', syncDrawerViewport);
  fetchMonthData();
});

onUnmounted(() => {
  monthRequestId += 1;
  window.removeEventListener('resize', syncDrawerViewport);
});
</script>

<style scoped>
.load-calendar {
  background: transparent;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.calendar-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1a202c;
  margin: 0 0 0.5rem 0;
}

.month-selector {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.month-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #e2e8f0;
  background: white;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.75rem;
}

.month-btn:hover {
  background: #f1f5f9;
  border-color: #3b82f6;
  color: #3b82f6;
}

.current-month {
  font-size: 0.9rem;
  font-weight: 600;
  color: #1e293b;
  min-width: 80px;
  text-align: center;
}

.zone-legend {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.zone-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: #4a5568;
}

.zone-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.zone-dot.z1 { background: #3b82f6; }
.zone-dot.z2 { background: #f59e0b; }
.zone-dot.z3 { background: #ef4444; }

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.month-stats {
  display: flex;
  gap: 1rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.stat-label {
  font-size: 0.75rem;
  color: #64748b;
}

.stat-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: #1e293b;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: #64748b;
}

.loading-icon {
  font-size: 1.5rem;
  animation: spin 1s linear infinite;
  margin-bottom: 0.5rem;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.empty-state p {
  margin: 0.25rem 0;
}

.empty-hint {
  font-size: 0.8rem;
  color: #94a3b8;
}

.selected-day-bar {
  margin-bottom: 1rem;
  padding: 0.9rem 1rem;
  border-radius: 12px;
  background: rgba(102, 126, 234, 0.08);
  border: 1px solid rgba(102, 126, 234, 0.14);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.selected-day-label {
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 0.2rem;
}

.selected-day-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.selected-day-meta {
  margin-left: 0.5rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: #475569;
}

.selected-day-btn {
  border: none;
  border-radius: 999px;
  background: #4f46e5;
  color: white;
  padding: 0.55rem 0.9rem;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.selected-day-btn:hover {
  background: #4338ca;
}

.weeks-container-wrap {
  position: relative;
}

.weeks-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.72);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.weeks-loading-state {
  padding: 1rem 1.25rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(226, 232, 240, 0.92);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
}

.weeks-container {
  overflow-x: auto;
}

.week-row {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: #f7fafc;
  border-radius: 8px;
  margin-bottom: 1rem;
  border: 1px solid #e2e8f0;
}

.week-row.current-week {
  background: linear-gradient(135deg, #ebf8ff 0%, #faf5ff 100%);
  border-color: #4299e1;
}

.week-stats {
  width: 140px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.week-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #2d3748;
}

.week-summary {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
}

.summary-label {
  color: #718096;
}

.summary-value {
  font-weight: 600;
  color: #2d3748;
}

.week-achievement {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-radius: 6px;
  font-size: 0.7rem;
  color: #92400e;
  font-weight: 600;
}

.days-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5rem;
  flex: 1;
}

.day-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  min-height: 70px;
  transition: all 0.2s;
  text-align: left;
  padding: 0;
  width: 100%;
  appearance: none;
}

.day-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.day-card.is-empty {
  opacity: 0.4;
  background: #f8fafc;
}

.day-card.is-today {
  border-color: #4299e1;
  box-shadow: 0 2px 8px rgba(66, 153, 225, 0.3);
}

.day-card.has-load {
  border-color: #cbd5e0;
}

.day-card.is-clickable {
  cursor: pointer;
}

.day-card.is-selected {
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.18);
}

.day-card:disabled {
  cursor: default;
}

.card-header {
  padding: 0.4rem 0.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f7fafc;
}

.day-weekday {
  font-size: 0.6875rem;
  color: #64748b;
  display: block;
}

.day-date {
  font-size: 0.9rem;
  font-weight: 600;
  color: #2d3748;
}

.study-time {
  font-size: 0.6875rem;
  color: #4a5568;
  font-weight: 500;
}

.card-content {
  padding: 0.4rem 0.5rem;
  min-height: 24px;
}

.day-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  font-size: 0.62rem;
  color: #64748b;
}

.day-zone {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.38rem;
  border-radius: 999px;
  font-weight: 600;
}

.zone-low {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}

.zone-medium {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

.zone-high {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}

.zone-rest {
  background: rgba(148, 163, 184, 0.12);
  color: #64748b;
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.no-data-text {
  color: #64748b;
  font-size: 0.8rem;
}

.day-detail {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  height: 100%;
  overflow: auto;
}

.day-detail-sheet-handle {
  width: 44px;
  height: 5px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.45);
  align-self: center;
  margin-top: -0.25rem;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.detail-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.detail-date {
  font-size: 0.875rem;
  color: #64748b;
  margin-bottom: 0.35rem;
}

.detail-title {
  margin: 0;
  font-size: 1.3rem;
  color: #0f172a;
}

.detail-zone {
  padding: 0.4rem 0.7rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

.detail-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 0.9rem;
  border: 1px solid #dbe4ef;
  border-radius: 999px;
  background: #fff;
  color: #334155;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.detail-close-btn:hover {
  background: #f8fafc;
}

.detail-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.detail-summary-card {
  padding: 0.9rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
}

.detail-summary-label {
  display: block;
  font-size: 0.76rem;
  color: #64748b;
  margin-bottom: 0.35rem;
}

.detail-summary-value {
  display: block;
  font-size: 1.05rem;
  color: #0f172a;
}

.detail-summary-text {
  line-height: 1.5;
}

.detail-section-title {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  color: #0f172a;
}

.detail-analysis {
  padding: 1rem 1.05rem;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(255, 255, 255, 0.7) 100%);
  border: 1px solid rgba(102, 126, 234, 0.12);
}

.detail-analysis-empty {
  background: #f8fafc;
  border-color: #e2e8f0;
}

.detail-analysis-text {
  margin: 0;
  line-height: 1.7;
  color: #334155;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.session-card {
  padding: 1rem;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: white;
}

.session-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.session-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.session-time {
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: #64748b;
}

.session-duration {
  font-size: 0.82rem;
  font-weight: 700;
  color: #2563eb;
  white-space: nowrap;
}

.session-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.75rem;
}

.session-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  font-size: 0.72rem;
  font-weight: 600;
}

.session-chip-state {
  background: rgba(102, 126, 234, 0.1);
  color: #4f46e5;
}

.detail-empty {
  padding: 1rem;
  border-radius: 12px;
  background: #f8fafc;
  color: #64748b;
  text-align: center;
}

/* 响应式 */
@media (max-width: 1024px) {
  .week-stats {
    width: 120px;
  }
}

@media (max-width: 768px) {
  .day-detail {
    padding-bottom: calc(0.5rem + var(--safe-area-bottom));
  }

  .detail-header {
    flex-direction: column;
  }

  .detail-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .selected-day-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .session-card-header {
    flex-direction: column;
  }

  .session-duration {
    white-space: normal;
  }

  .detail-summary-grid {
    grid-template-columns: 1fr;
  }

  .days-grid {
    grid-template-columns: repeat(7, 1fr);
    gap: 0.25rem;
  }
  
  .week-stats {
    display: none;
  }
  
  .month-stats {
    display: none;
  }

  :deep(.day-detail-drawer.el-drawer) {
    width: 100% !important;
    max-width: 100%;
    border-radius: 24px 24px 0 0;
  }

  :deep(.day-detail-drawer .el-drawer__body) {
    padding: 16px 16px 0;
    overflow: hidden;
  }
}

@media (max-width: 480px) {
  .selected-day-bar,
  .session-card,
  .detail-empty {
    padding: 0.875rem;
  }

  .detail-summary-card,
  .detail-analysis {
    padding: 0.875rem;
  }

  .detail-close-btn {
    min-height: 38px;
    padding-inline: 0.8rem;
  }

  .days-grid {
    gap: 0.2rem;
  }
}

/* ========== 暗色模式 ========== */
[data-theme="dark"] .calendar-title {
  color: #edf2f6;
}

[data-theme="dark"] .month-btn {
  background: #1e2d3a;
  border-color: #3a4f61;
  color: #afc5d3;
}

[data-theme="dark"] .month-btn:hover {
  background: #2a3d4d;
  border-color: #5a94f8;
  color: #8db3fa;
}

[data-theme="dark"] .current-month {
  color: #edf2f6;
}

[data-theme="dark"] .zone-item {
  color: #a3b5c6;
}

[data-theme="dark"] .stat-label {
  color: #8ba3b5;
}

[data-theme="dark"] .stat-value {
  color: #edf2f6;
}

[data-theme="dark"] .empty-state p {
  color: #8ba3b5;
}

[data-theme="dark"] .empty-hint {
  color: #6b8294;
}

[data-theme="dark"] .selected-day-bar {
  background: rgba(90, 148, 248, 0.12);
  border-color: rgba(90, 148, 248, 0.2);
}

[data-theme="dark"] .selected-day-label {
  color: #8ba3b5;
}

[data-theme="dark"] .selected-day-value {
  color: #edf2f6;
}

[data-theme="dark"] .selected-day-meta {
  color: #a3b5c6;
}

[data-theme="dark"] .week-row {
  background: #1a252f;
  border-color: #2a3d4d;
}

[data-theme="dark"] .week-row.current-week {
  background: linear-gradient(135deg, rgba(90, 148, 248, 0.14) 0%, rgba(169, 143, 255, 0.1) 100%);
  border-color: #5a94f8;
}

[data-theme="dark"] .week-label {
  color: #d4e0e8;
}

[data-theme="dark"] .summary-label {
  color: #8ba3b5;
}

[data-theme="dark"] .summary-value {
  color: #d4e0e8;
}

[data-theme="dark"] .week-achievement {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(245, 158, 11, 0.12) 100%);
  color: #f5b54a;
}

[data-theme="dark"] .day-card {
  background: #1e2d3a;
  border-color: #2a3d4d;
}

[data-theme="dark"] .day-card:hover {
  background: #24384a;
  border-color: #4a6173;
}

[data-theme="dark"] .day-card.is-empty {
  background: #16202b;
  opacity: 0.45;
}

[data-theme="dark"] .day-card.is-today {
  border-color: #5a94f8;
}

[data-theme="dark"] .day-card.is-selected {
  border-color: #8db3fa;
}

[data-theme="dark"] .card-header {
  background: #1a252f;
}

[data-theme="dark"] .day-weekday {
  color: #8ba3b5;
}

[data-theme="dark"] .day-date {
  color: #d4e0e8;
}

[data-theme="dark"] .study-time {
  color: #a3b5c6;
}

[data-theme="dark"] .day-meta {
  color: #8ba3b5;
}

[data-theme="dark"] .zone-low {
  background: rgba(59, 130, 246, 0.18);
  color: #8db3fa;
}

[data-theme="dark"] .zone-medium {
  background: rgba(245, 158, 11, 0.18);
  color: #f5b54a;
}

[data-theme="dark"] .zone-high {
  background: rgba(239, 68, 68, 0.18);
  color: #f49a9c;
}

[data-theme="dark"] .zone-rest {
  background: rgba(139, 163, 181, 0.16);
  color: #a3b5c6;
}

[data-theme="dark"] .no-data-text {
  color: #6b8294;
}

[data-theme="dark"] .day-detail {
  background: #1a252f;
  border-color: #2a3d4d;
}

[data-theme="dark"] .detail-date,
[data-theme="dark"] .detail-title,
[data-theme="dark"] .detail-summary-value,
[data-theme="dark"] .session-title {
  color: #edf2f6;
}

[data-theme="dark"] .detail-close-btn {
  background: #1e2d3a;
  border-color: #3a4f61;
  color: #afc5d3;
}

[data-theme="dark"] .detail-close-btn:hover {
  background: #2a3d4d;
}

[data-theme="dark"] .detail-summary-card {
  background: #1e2d3a;
  border-color: #2a3d4d;
}

[data-theme="dark"] .detail-summary-label,
[data-theme="dark"] .session-time,
[data-theme="dark"] .session-meta {
  color: #8ba3b5;
}

[data-theme="dark"] .detail-summary-text,
[data-theme="dark"] .detail-analysis-text {
  color: #afc5d3;
}

[data-theme="dark"] .detail-analysis {
  background: linear-gradient(135deg, rgba(90, 148, 248, 0.12) 0%, rgba(26, 37, 47, 0.7) 100%);
  border-color: rgba(90, 148, 248, 0.2);
}

[data-theme="dark"] .detail-analysis-empty {
  background: #1e2d3a;
  border-color: #2a3d4d;
  color: #8ba3b5;
}

[data-theme="dark"] .session-card {
  background: #1e2d3a;
  border-color: #2a3d4d;
}

[data-theme="dark"] .session-duration {
  color: #8db3fa;
}

[data-theme="dark"] .session-chip {
  background: #2a3d4d;
  color: #a3b5c6;
}

[data-theme="dark"] .session-chip-state {
  background: rgba(90, 148, 248, 0.14);
  color: #8db3fa;
}

[data-theme="dark"] .detail-empty {
  background: #1e2d3a;
  color: #8ba3b5;
}
</style>

