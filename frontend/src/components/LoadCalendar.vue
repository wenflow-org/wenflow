<template>
  <div class="load-calendar">
    <div class="calendar-header">
      <div class="header-left">
        <h3 class="calendar-title">学习负荷日历</h3>
        <div class="month-selector">
          <button @click="changeMonth(-1)" class="month-btn">
            <span>◀</span>
          </button>
          <span class="current-month">{{ currentMonthLabel }}</span>
          <button @click="changeMonth(1)" class="month-btn">
            <span>▶</span>
          </button>
        </div>
        <div class="zone-legend">
          <span class="zone-item">
            <i class="zone-dot z1"></i>
            <span>Z1 轻度</span>
          </span>
          <span class="zone-item">
            <i class="zone-dot z2"></i>
            <span>Z2 中度</span>
          </span>
          <span class="zone-item">
            <i class="zone-dot z3"></i>
            <span>Z3 高强度</span>
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
            <span class="stat-label">学习会话</span>
            <span class="stat-value">{{ monthStats.sessionCount }}次</span>
          </div>
        </div>
      </div>
    </div>

    <div class="loading-state" v-if="loading">
      <el-icon class="loading-icon"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <div class="empty-state" v-else-if="!loading && weeksList.length === 0">
      <span class="empty-icon">📅</span>
      <p>本月暂无学习记录</p>
      <p class="empty-hint">开始学习后，这里会显示你的学习日历</p>
    </div>

    <div v-if="!loading && weeksList.length > 0 && selectedDay" class="selected-day-bar">
      <div>
        <div class="selected-day-label">已选日期</div>
        <div class="selected-day-value">
          {{ formatDetailDate(selectedDay.date) }}
          <span class="selected-day-meta">{{ getDayHeadline(selectedDay) }}</span>
        </div>
      </div>
      <button type="button" class="selected-day-btn" @click="openSelectedDayDetail">
        查看当天明细
      </button>
    </div>

    <div class="weeks-container" v-if="!loading && weeksList.length > 0">
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
              <div class="task-title" v-if="day.primaryTaskTitle">
                {{ day.primaryTaskTitle }}
              </div>
              <div class="day-meta" v-if="day.sessionCount > 0">
                <span>{{ day.sessionCount }}次会话</span>
                <span class="day-zone" :class="getLoadZoneClass(day.durationMinutes)">
                  {{ getLoadZoneLabel(day.durationMinutes) }}
                </span>
              </div>
              <div class="no-data" v-else-if="day.isCurrentMonth && !isFutureDay(day.date)">
                <span class="no-data-text">点击查看</span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>

    <el-drawer
      v-model="dayDetailOpen"
      size="460px"
      :with-header="false"
      class="day-detail-drawer"
    >
      <div v-if="selectedDay" class="day-detail">
        <div class="detail-header">
          <div>
            <div class="detail-date">{{ formatDetailDate(selectedDay.date) }}</div>
            <h4 class="detail-title">{{ getDayHeadline(selectedDay) }}</h4>
          </div>
          <div class="detail-zone" :class="getLoadZoneClass(selectedDay.durationMinutes)">
            {{ getLoadZoneLabel(selectedDay.durationMinutes) }}
          </div>
        </div>

        <div class="detail-summary-grid">
          <div class="detail-summary-card">
            <span class="detail-summary-label">学习总时长</span>
            <strong class="detail-summary-value">{{ formatDuration(selectedDay.durationMinutes) }}</strong>
          </div>
          <div class="detail-summary-card">
            <span class="detail-summary-label">学习会话</span>
            <strong class="detail-summary-value">{{ selectedDay.sessionCount }}次</strong>
          </div>
          <div class="detail-summary-card">
            <span class="detail-summary-label">主要内容</span>
            <strong class="detail-summary-value detail-summary-text">{{ selectedDay.primaryTaskTitle || '暂无任务标题' }}</strong>
          </div>
          <div class="detail-summary-card">
            <span class="detail-summary-label">当天状态</span>
            <strong class="detail-summary-value detail-summary-text">{{ getDayStateSummary(selectedDay) }}</strong>
          </div>
        </div>

        <div class="detail-analysis" v-if="selectedDay.sessionCount > 0">
          <h5 class="detail-section-title">当天观察</h5>
          <p class="detail-analysis-text">{{ getDayAnalysis(selectedDay) }}</p>
        </div>

        <div class="detail-analysis detail-analysis-empty" v-else>
          <h5 class="detail-section-title">当天情况</h5>
          <p class="detail-analysis-text">这一天还没有学习会话记录。可以把它当作休息日，或者补一次短时学习。</p>
        </div>

        <div class="detail-sessions">
          <h5 class="detail-section-title">会话详情</h5>
          <div v-if="selectedDay.sessions.length > 0" class="session-list">
            <div v-for="session in selectedDay.sessions" :key="session.id" class="session-card">
              <div class="session-card-header">
                <div>
                  <div class="session-title">{{ session.taskTitle || '学习会话' }}</div>
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
          <div v-else class="detail-empty">暂无详细学习记录</div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Loading } from '@element-plus/icons-vue';
import api from '../utils/api';
import dayjs from 'dayjs';

const emit = defineEmits<{
  (e: 'day-select', day: DayData): void;
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

const loading = ref(false);
const weeksList = ref<DayData[][]>([]);
const monthStats = ref<MonthStats | null>(null);
const currentYear = ref(new Date().getFullYear());
const currentMonth = ref(new Date().getMonth());
const selectedDay = ref<DayData | null>(null);
const dayDetailOpen = ref(false);

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
  loading.value = true;
  
  try {
    // 构建当月的起始和结束日期
    const startDate = new Date(currentYear.value, currentMonth.value, 1);
    const endDate = new Date(currentYear.value, currentMonth.value + 1, 0);
    
    const startDateStr = dayjs(startDate).format('YYYY-MM-DD');
    const endDateStr = dayjs(endDate).format('YYYY-MM-DD');
    
    // 调用后端API获取当月学习会话
    const response = await api.get('/users/me/sessions', {
      params: {
        startDate: startDateStr,
        endDate: endDateStr,
        limit: 100
      }
    });
    
    const sessions = response?.data || response || [];
    
    buildCalendar(sessions);
    
  } catch (error) {
    console.error('获取月份数据失败:', error);
    // 即使失败也构建空日历
    buildCalendar([]);
  } finally {
    loading.value = false;
  }
};

// 构建日历
const buildCalendar = (sessions: SessionEntry[]) => {
  const weeks: DayData[][] = [];
  
  const year = currentYear.value;
  const month = currentMonth.value;
  
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
};

const openSelectedDayDetail = () => {
  if (!selectedDay.value) return;
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
  fetchMonthData();
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
  const firstDay = week[0];
  const lastDay = week[week.length - 1];
  
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
  if (studyDays >= 7) return '全勤达人';
  if (studyDays >= 5) return '学习达人';
  if (studyDays >= 3) return '积极学习';
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
  return h > 0 ? `${h}h${m}m` : `${m}m`;
};

const getLoadZoneClass = (minutes: number) => {
  if (minutes >= 120) return 'zone-high';
  if (minutes >= 60) return 'zone-medium';
  if (minutes > 0) return 'zone-low';
  return 'zone-rest';
};

const getLoadZoneLabel = (minutes: number) => {
  if (minutes >= 120) return '高强度';
  if (minutes >= 60) return '中等强度';
  if (minutes > 0) return '轻度学习';
  return '休息日';
};

const formatDetailDate = (dateStr: string) => dayjs(dateStr).format('M月D日 dddd');

const formatSessionTime = (startTime: string, endTime?: string | null) => {
  const start = dayjs(startTime).format('HH:mm');
  const end = endTime ? dayjs(endTime).format('HH:mm') : null;
  return end ? `${start} - ${end}` : `${start} 开始`;
};

const getSessionStatusLabel = (session: SessionEntry) => {
  if (session.taskStatus === 'completed') return '任务已完成';
  if (session.taskStatus === 'in_progress') return '任务进行中';
  if (session.endTime) return '会话已结束';
  if (session.status === 'completed') return '会话已结束';
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
  if (day.sessionCount === 0) return '暂无状态数据';

  const states = day.sessions.map((session) => session.parsedState).filter(Boolean) as SessionState[];
  if (states.length === 0) return getLoadZoneLabel(day.durationMinutes);

  const avgStress = states.reduce((sum, state) => sum + (state.stress || 0), 0) / states.length;
  const avgEngagement = states.reduce((sum, state) => sum + (state.engagement || 0), 0) / states.length;
  if (states.some((state) => state.anomaly)) return '有异常波动';
  if (avgStress >= 0.75) return '投入高，压力偏大';
  if (avgEngagement >= 0.7) return '专注度不错';
  return '整体平稳';
};

const getDayAnalysis = (day: DayData) => {
  if (day.sessionCount === 0) return '这一天没有可分析的学习行为。';
  if (day.durationMinutes >= 120) return `这一天累计学习 ${formatDuration(day.durationMinutes)}，强度已经比较高。${day.primaryTaskTitle ? `主要围绕“${day.primaryTaskTitle}”展开。` : ''}`;
  if (day.durationMinutes >= 60) return `这一天学习投入比较扎实，累计 ${formatDuration(day.durationMinutes)}。${day.primaryTaskTitle ? `主要内容是“${day.primaryTaskTitle}”。` : ''}`;
  return `这一天是轻量学习日，累计 ${formatDuration(day.durationMinutes)}，更适合热身、复习或保持节奏。`;
};

onMounted(() => {
  fetchMonthData();
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
  font-size: 0.7rem;
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
  font-size: 0.7rem;
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
  font-size: 0.6rem;
  color: #718096;
  display: block;
}

.day-date {
  font-size: 0.9rem;
  font-weight: 600;
  color: #2d3748;
}

.study-time {
  font-size: 0.6rem;
  color: #4a5568;
  font-weight: 500;
}

.card-content {
  padding: 0.4rem 0.5rem;
  min-height: 30px;
}

.task-title {
  font-size: 0.65rem;
  color: #4a5568;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-meta {
  margin-top: 0.35rem;
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
  color: #cbd5e0;
  font-size: 0.8rem;
}

.day-detail {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
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
  .selected-day-bar {
    flex-direction: column;
    align-items: flex-start;
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
}
</style>

