<template>
  <el-dialog
    v-model="dialogVisible"
    :title="task?.title"
    :width="isMobile ? '95%' : '900px'"
    :fullscreen="isMobile"
    class="task-detail-dialog"
    @close="handleClose"
  >
    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <div v-else-if="task" class="task-detail-content">
      <!-- 任务基本信息 -->
      <div class="task-info-section">
        <div class="task-header">
          <el-tag :type="getStatusType(task.status)" class="status-tag">
            {{ getStatusText(task.status) }}
          </el-tag>
          <el-tag type="info" class="type-tag">
            <el-icon><Document /></el-icon>
            {{ getTaskTypeText(task.taskType) }}
          </el-tag>

          <div class="time-info">
            <el-icon><Clock /></el-icon>
            预计 {{ task.estimatedMinutes }} 分钟
            <span v-if="task.status === 'completed'"> | 实际 {{ task.actualMinutes }} 分钟</span>
          </div>
        </div>

        <p class="task-description">{{ task.description }}</p>

        <div class="breadcrumb">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>{{ task.learningPath?.name }}</el-breadcrumb-item>
            <el-breadcrumb-item>Week {{ task.week?.weekNumber }} - {{ task.week?.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
      </div>

      <!-- 安德森框架认知信息 -->
      <div v-if="task.knowledgeType || task.cognitiveLevel" class="anderson-section">
        <el-divider content-position="left">
          <el-icon><TrendCharts /></el-icon>
          学习类型与认知层级
        </el-divider>
        
        <div class="anderson-grid">
          <div class="anderson-item" v-if="task.knowledgeType">
            <span class="label">知识类型：</span>
            <el-tag :color="getKnowledgeTypeColor(task.knowledgeType)" effect="light">
              {{ getKnowledgeTypeLabel(task.knowledgeType) }}
            </el-tag>
          </div>
          
          <div class="anderson-item" v-if="task.cognitiveLevel">
            <span class="label">认知层级：</span>
            <el-tag :color="getCognitiveLevelColor(task.cognitiveLevel)" effect="light">
              {{ getCognitiveLevelLabel(task.cognitiveLevel) }}
            </el-tag>
          </div>
          
          <div class="anderson-item" v-if="task.coreConcept">
            <span class="label">核心概念：</span>
            <span class="value">{{ task.coreConcept }}</span>
          </div>
          
          <div class="anderson-item" v-if="task.transferable !== undefined">
            <span class="label">可迁移：</span>
            <el-tag :type="task.transferable ? 'success' : 'info'" size="small">
              {{ task.transferable ? '是' : '否' }}
            </el-tag>
          </div>
        </div>
        
        <div v-if="task.displayLabel" class="display-hint">
          {{ task.displayLabel }}
        </div>
        
        <div v-if="task.annotationConfidence && task.annotationConfidence < 0.7" class="low-confidence-warning">
          <el-alert type="warning" :closable="false">
            此任务标注置信度较低 ({{ Math.round(task.annotationConfidence * 100) }}%)
          </el-alert>
        </div>
      </div>

      <!-- AI提示区域 -->
      <div v-if="task.aiHints && task.aiHints.length > 0" class="hints-section">
        <el-divider content-position="left">
          <el-icon><InfoFilled /></el-icon>
          AI提示
        </el-divider>

        <el-card class="hints-card">
          <ul class="hints-list">
            <li v-for="(hint, index) in task.aiHints" :key="index">
              {{ hint }}
            </li>
          </ul>
        </el-card>
      </div>

      <!-- 学习资源 -->
      <div v-if="task.resources && task.resources.length > 0" class="resources-section">
        <el-divider content-position="left">
          <el-icon><Link /></el-icon>
          学习资源
        </el-divider>

        <div class="resources-list">
          <el-button
            v-for="(resource, index) in task.resources"
            :key="index"
            :icon="Link"
            link
            @click="openResource(resource.url || resource)"
          >
            {{ resource.title || resource }}
          </el-button>
        </div>
      </div>

      <!-- 学习目标 -->
      <div v-if="task.week?.learningObjectives" class="objectives-section">
        <el-divider content-position="left">
          <el-icon><Aim /></el-icon>
          学习目标 (本周)
        </el-divider>

        <ul class="objectives-list">
          <li v-for="(objective, index) in task.week.learningObjectives" :key="index">
            {{ objective }}
          </li>
        </ul>
      </div>

      <!-- AI辅导聊天 -->
      <div class="ai-tutor-section">
        <el-divider content-position="left">
          <el-icon><ChatLineRound /></el-icon>
          AI辅导 (ZPD分层策略)
        </el-divider>

        <div class="chat-container">
          <div v-if="aiChatHistory.length === 0" class="chat-empty">
            <el-icon><ChatDotRound /></el-icon>
            <p>遇到问题？向AI老师提问吧！</p>
          </div>

          <div v-else class="chat-messages" ref="chatContainer">
            <div
              v-for="(msg, index) in aiChatHistory"
              :key="index"
              class="chat-message"
              :class="msg.role"
            >
              <div class="message-role">
                {{ msg.role === 'user' ? '你' : 'AI老师' }}
                <span v-if="msg.role === 'assistant' && msg.hintLevel" class="hint-level">
                  ({{ getHintLevelText(msg.hintLevel) }})
                </span>
              </div>
              <div class="message-content">{{ msg.content }}</div>
            </div>
          </div>

          <div class="chat-input">
            <el-input
              v-model="aiQuestion"
              :disabled="aiLoading"
              placeholder="输入你的问题..."
              @keydown.enter="handleSendQuestion"
            >
              <template #append>
                <el-button
                  :loading="aiLoading"
                  :icon="'Promotion'"
                  @click="handleSendQuestion"
                >
                  发送
                </el-button>
              </template>
            </el-input>
          </div>
        </div>
      </div>

      <!-- 学习计时器 & 操作 -->
      <div class="action-section">
        <el-divider />

        <div class="timer-container">
          <div v-if="!timerRunning && task.status !== 'completed'" class="timer-display">
            <span>{{ formatTime(0) }}</span>
          </div>
          <div v-else-if="timerRunning" class="timer-display active">
            <span class="timer-icon">⏱️</span>
            <span class="timer-value">{{ formatTime(elapsedTime) }}</span>
          </div>
          <div v-else-if="task.status === 'completed'" class="timer-display completed">
            <el-icon><SuccessFilled /></el-icon>
            <span>{{ formatTime(task.actualMinutes || task.estimatedMinutes) }}</span>
          </div>

          <div class="timer-buttons">
            <el-button
              v-if="task.status !== 'completed'"
              type="primary"
              :icon="timerRunning ? 'VideoPause' : 'VideoPlay'"
              @click="handleTimerToggle"
            >
              {{ timerRunning ? '暂停学习' : '开始学习' }}
            </el-button>

            <el-button
              v-if="timerRunning || elapsedTime > 0"
              type="warning"
              :icon="'Refresh'"
              @click="handleResetTimer"
              plain
            >
              重置
            </el-button>

            <el-button
              v-if="task.status !== 'completed' && elapsedTime > 0"
              type="success"
              :icon="'Check'"
              @click="handleCompleteTask"
            >
              完成任务
            </el-button>
          </div>
        </div>

        <div class="notes-section">
          <el-input
            v-model="notes"
            type="textarea"
            :rows="3"
            placeholder="记录学习笔记..."
            resize="vertical"
          />
        </div>

        <!-- 主观难度选择器 -->
        <div class="difficulty-section" v-if="task.status !== 'completed' && elapsedtime > 0">
          <label class="difficulty-label">
            <el-icon><TrendCharts /></el-icon>
            本次学习难度评分：
          </label>
          <el-slider
            v-model="subjectiveDifficulty"
            :min="1"
            :max="10"
            :step="1"
            show-stops
            :marks="{ 1: '简单', 5: '适中', 10: '困难' }"
            class="difficulty-slider"
          />
          <div class="difficulty-value">当前评分：{{ subjectiveDifficulty }} / 10</div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
      <el-button
        v-if="task?.status !== 'completed' && timerRunning"
        type="primary"
        :icon="'Check'"
        @click="handleCompleteTask"
      >
        完成任务
      </el-button>
    </template>
  </el-dialog>

  <!-- 学习评分弹窗 -->
  <LearningRatingDialog
    v-model="showRatingDialog"
    :duration="Math.ceil(elapsedTime / 60) || task?.estimatedMinutes || 30"
    :task-id="props.taskId"
    @submit="handleRatingSubmit"
    @skip="handleRatingSkip"
  />

  <!-- 学习报告弹窗 -->
  <LearningReportDialog
    v-model="showReportDialog"
    :report="learningReport"
    :loading="reportLoading"
    @continue="handleReportContinue"
  />
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Loading, Document, Clock, InfoFilled, Link, Aim, SuccessFilled, ChatLineRound, ChatDotRound, TrendCharts } from '@element-plus/icons-vue';
import api from '../utils/api';
import { metricsAPI } from '../api/metrics';
import LearningRatingDialog from '../components/LearningRatingDialog.vue';
import LearningReportDialog from '../components/LearningReportDialog.vue';

interface Props {
  modelValue: boolean;
  taskId?: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  taskType: string;
  status: string;
  estimatedMinutes: number;
  actualMinutes?: number;
  knowledgeType?: string;
  cognitiveLevel?: string;
  coreConcept?: string;
  transferable?: boolean;
  displayLabel?: string;
  annotationConfidence?: number;
  week: {
    weekNumber: number;
    title: string;
    description: string;
    learningObjectives: string[];
  };
  learningPath: {
    id: string;
    name: string;
    subject: string;
  };
  aiHints: string[];
  resources: any[];
}

const props = defineProps<Props>();
const emit = defineEmits(['update:modelValue', 'taskCompleted']);

const dialogVisible = ref(props.modelValue);
const loading = ref(false);
const task = ref<Task | null>(null);

// 响应式布局：检测移动端
const screenWidth = ref(window.innerWidth);
const isMobile = computed(() => screenWidth.value < 768);

const handleResize = () => {
  screenWidth.value = window.innerWidth;
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});

// 笔记自动保存（防抖）
const debounce = (fn: Function, delay: number) => {
  let timeoutId: number | null = null;
  return (...args: any[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
};

const saveNotesToStorage = debounce(() => {
  if (props.taskId) {
    localStorage.setItem(`task_notes_${props.taskId}`, notes.value);
  }
}, 1000);

// 计时器相关
const timerRunning = ref(false);
const elapsedTime = ref(0);
const notes = ref('');
const timerInterval = ref<number | null>(null);
const activeSessionId = ref<string | null>(null); // 当前学习会话ID

// 主观难度选择（1-10）
const subjectiveDifficulty = ref(5);

// 学习评分弹窗
const showRatingDialog = ref(false);
const pendingCompletion = ref(false);

// 学习报告弹窗
const showReportDialog = ref(false);
const reportLoading = ref(false);
const learningReport = ref({
  lsb: 0,
  reasoning: '',
  suggestion: '',
  lss: 0,
  ktl: 0,
  lf: 0
});

interface StateResponseData {
  lsb?: number;
  lss?: number;
  ktl?: number;
  lf?: number;
  reasoning?: string;
  suggestion?: string | { message?: string; action?: string };
}

const normalizeStateData = (payload: any): StateResponseData => {
  if (!payload) {
    return {};
  }

  if (typeof payload === 'object' && payload.data && typeof payload.data === 'object') {
    return payload.data as StateResponseData;
  }

  return payload as StateResponseData;
};

const getSuggestionText = (suggestion: StateResponseData['suggestion'], fallbackLsb: number) => {
  if (typeof suggestion === 'string') {
    return suggestion;
  }

  if (suggestion?.message) {
    return suggestion.action ? `${suggestion.message}（${suggestion.action}）` : suggestion.message;
  }

  return generateLSBSuggestion(fallbackLsb);
};

const calculateCompositeDifficulty = (ratings: { difficulty: number; cognitiveLoad: number; effectiveness: number }) => {
  const score =
    ratings.difficulty * 0.3 +
    ratings.cognitiveLoad * 0.3 +
    ratings.effectiveness * 0.4;

  return Math.max(1, Math.min(10, Number(score.toFixed(1))));
};

// AI辅导相关
const aiQuestion = ref('');
const aiLoading = ref(false);
const aiChatHistory = ref<Array<{
  role: 'user' | 'assistant';
  content: string;
  hintLevel?: string;
}>>([]);
const chatContainer = ref<HTMLElement | null>(null);

// 自动滚动到聊天底部
const scrollToBottom = async () => {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTo({
      top: chatContainer.value.scrollHeight,
      behavior: 'smooth'
    });
  }
};

// 监听modelValue变化
watch(() => props.modelValue, (val) => {
  dialogVisible.value = val;
  if (val && props.taskId) {
    loadTaskDetail();
  }
});

// 监听taskId变化
watch(() => props.taskId, (newTaskId) => {
  if (newTaskId && dialogVisible.value) {
    loadTaskDetail();
  }
});

// 同步dialogVisible到modelValue
watch(dialogVisible, (val) => {
  emit('update:modelValue', val);
});

// 监听笔记变化并自动保存
watch(notes, saveNotesToStorage);

// 加载任务详情
const loadTaskDetail = async () => {
  if (!props.taskId) return;

  loading.value = true;
  try {
    const response = await api.get<{ success: boolean; data: Task }>(`/learning/tasks/${props.taskId}`);
    task.value = response.data;

    // 恢复已保存的笔记
    const savedNotes = localStorage.getItem(`task_notes_${props.taskId}`);
    if (savedNotes) {
      notes.value = savedNotes;
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载任务详情失败');
  } finally {
    loading.value = false;
  }
};

// 时钟计时器

const startTimer = async () => {

  try {

    // 创建学习会话

    if (props.taskId && !activeSessionId.value) {

      const response = await api.post<{ success: boolean; data: { id: string } }>('/sessions/start', {

        taskId: props.taskId

      });

      activeSessionId.value = response.data.id;

      console.log('学习会话已开始:', activeSessionId.value);

    }



    // 启动计时器

    timerRunning.value = true;

    timerInterval.value = window.setInterval(() => {

      elapsedTime.value++;

    }, 1000);

  } catch (error: any) {

    ElMessage.error(error.message || '启动计时器失败');

  }

};



const stopTimer = async () => {

  // 停止计时器

  timerRunning.value = false;

  if (timerInterval.value) {

    clearInterval(timerInterval.value);

    timerInterval.value = null;

  }



  // 结束学习会话（如果有会话且时间大于 0）

  if (activeSessionId.value && elapsedTime.value > 0) {

    try {

      await api.post(`/sessions/${activeSessionId.value}/end`, {

        notes: notes.value

      });

      console.log('学习会话已结束');

      activeSessionId.value = null;
    } catch (error: any) {
      console.error('结束会话失败:', error);
      // 不显示错误，因为可能是用户点击完成按钮时处理的
    }
  }
};

const handleTimerToggle = () => {
  if (timerRunning.value) {
    stopTimer();
  } else {
    startTimer();
  }
};

const handleResetTimer = async () => {
  await stopTimer(); // 先停止计时器和会话
  elapsedTime.value = 0;
  activeSessionId.value = null;
  notes.value = '';
};

// 完成任务 - 先显示评分弹窗
const handleCompleteTask = async () => {
  if (!props.taskId) return;

  // 停止计时器（但不结束会话）
  timerRunning.value = false;
  if (timerInterval.value) {
    clearInterval(timerInterval.value);
    timerInterval.value = null;
  }

  // 标记为待完成状态，等待评分
  pendingCompletion.value = true;

  // 显示评分弹窗
  showRatingDialog.value = true;
};

// 处理评分提交
const handleRatingSubmit = async (ratings: { difficulty: number; cognitiveLoad: number; effectiveness: number; notes: string }) => {
  if (!props.taskId) return;

  const actualMinutes = Math.ceil(elapsedTime.value / 60) || task.value?.estimatedMinutes || 30;

  try {
    // 先结束学习会话（如果有）
    if (activeSessionId.value) {
      await api.post(`/sessions/${activeSessionId.value}/end`, {
        notes: notes.value || ratings.notes
      });
      activeSessionId.value = null;
    }

    // 完成任务
    await api.post(`/learning/tasks/${props.taskId}/complete`, {
      actualMinutes,
      subjectiveDifficulty: calculateCompositeDifficulty(ratings),
      notes: notes.value || ratings.notes
    });

    // 获取学习报告
    reportLoading.value = true;
    showReportDialog.value = true;
    
    const stateData = normalizeStateData(await metricsAPI.getCurrentState());
    const lsb = stateData.lsb ?? 0;
    
    learningReport.value = {
      lsb,
      reasoning: stateData.reasoning || generateLSBReasoning(lsb),
      suggestion: getSuggestionText(stateData.suggestion, lsb),
      lss: stateData.lss ?? 0,
      ktl: stateData.ktl ?? 0,
      lf: stateData.lf ?? 0
    };
    
    reportLoading.value = false;

    // 重置状态
    elapsedTime.value = 0;
    pendingCompletion.value = false;

    // 重新加载任务详情
    await loadTaskDetail();

    // 通知父组件
    emit('taskCompleted');
  } catch (error: any) {
    ElMessage.error(error.message || '完成任务失败');
    pendingCompletion.value = false;
    reportLoading.value = false;
    showReportDialog.value = false;
  }
};

// 生成 LSB 解释
const generateLSBReasoning = (lsb: number) => {
  if (lsb < -30) return '你的疲劳度已经明显超过知识积累，学习效率可能受到影响。';
  if (lsb < 0) return '当前状态不太理想，疲劳感略高于知识吸收。';
  if (lsb < 20) return '学习状态一般，建议适当调整学习节奏。';
  if (lsb < 40) return '学习状态良好，知识正在稳步积累。';
  return '学习状态优秀！知识积累明显高于疲劳度，保持这个节奏！';
};

// 生成 LSB 建议
const generateLSBSuggestion = (lsb: number) => {
  if (lsb < -30) return '建议立即休息，可以出去走走或做些放松活动，待状态恢复后再继续。';
  if (lsb < 0) return '建议休息10-15分钟，喝杯水，适当活动一下身体。';
  if (lsb < 20) return '可以继续学习，但建议注意劳逸结合，每45分钟休息5分钟。';
  if (lsb < 40) return '继续保持当前的学习节奏，可以尝试更有挑战性的内容。';
  return '状态很棒！趁热打铁，可以攻克一些难点。';
};

// 处理学习报告弹窗继续按钮
const handleReportContinue = () => {
  showReportDialog.value = false;
};

// 处理跳过评分
const handleRatingSkip = async () => {
  if (!props.taskId) return;

  const actualMinutes = Math.ceil(elapsedTime.value / 60) || task.value?.estimatedMinutes || 30;

  try {
    // 先结束学习会话（如果有）
    if (activeSessionId.value) {
      await api.post(`/sessions/${activeSessionId.value}/end`, {
        notes: notes.value
      });
      activeSessionId.value = null;
    }

    // 完成任务（使用默认评分）
    await api.post(`/learning/tasks/${props.taskId}/complete`, {
      actualMinutes,
      subjectiveDifficulty: 5,
      notes: notes.value
    });

    // 获取学习报告
    reportLoading.value = true;
    showReportDialog.value = true;
    
    const stateData = normalizeStateData(await metricsAPI.getCurrentState());
    const lsb = stateData.lsb ?? 0;
    
    learningReport.value = {
      lsb,
      reasoning: stateData.reasoning || generateLSBReasoning(lsb),
      suggestion: getSuggestionText(stateData.suggestion, lsb),
      lss: stateData.lss ?? 0,
      ktl: stateData.ktl ?? 0,
      lf: stateData.lf ?? 0
    };
    
    reportLoading.value = false;

    // 重置状态
    elapsedTime.value = 0;
    pendingCompletion.value = false;

    // 重新加载任务详情
    await loadTaskDetail();

    // 通知父组件
    emit('taskCompleted');
  } catch (error: any) {
    ElMessage.error(error.message || '完成任务失败');
    pendingCompletion.value = false;
    reportLoading.value = false;
    showReportDialog.value = false;
  }
};

// 关闭对话框
const handleClose = async () => {
  if (timerRunning.value) {
    ElMessage.warning('请先暂停学习再关闭');
    return;
  }

  // 停止计时器和会话
  await stopTimer();

  // 重置状态
  dialogVisible.value = false;
  elapsedTime.value = 0;
  activeSessionId.value = null;
  notes.value = '';
};

// 打开资源链接
const openResource = (url: string) => {
  window.open(url, '_blank');
};

// 格式化时间
const formatTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

// 获取状态类型
const getStatusType = (status: string) => {
  const statusMap: Record<string, any> = {
    todo: 'info',
    in_progress: 'warning',
    completed: 'success',
    skipped: 'danger'
  };
  return statusMap[status] || 'info';
};

// 获取状态文本
const getStatusText = (status: string) => {
  const statusMap: Record<string, string> = {
    todo: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    skipped: '已跳过'
  };
  return statusMap[status] || status;
};

// 获取任务类型文本
const getTaskTypeText = (type: string) => {
  const typeMap: Record<string, string> = {
    reading: '阅读',
    practice: '练习',
    project: '项目',
    quiz: '测验'
  };
  return typeMap[type] || type;
};

// 发送AI问题
const handleSendQuestion = async () => {
  const question = aiQuestion.value.trim();
  if (!question || !task.value) return;

  // 添加用户消息
  aiChatHistory.value.push({
    role: 'user',
    content: question
  });
  await scrollToBottom();

  aiQuestion.value = '';
  aiLoading.value = true;

  try {
    const response = await api.post<{ success: boolean; data: { answer: string; hintLevel: string } }>('/ai/zpd-tutor', {
      question,
      taskId: task.value.id,
      taskDescription: task.value.description,
      taskContext: {
        taskType: task.value.taskType,
        weekNumber: task.value.week.weekNumber,
        subject: task.value.learningPath.subject
      }
    });

    // 添加AI回复
    aiChatHistory.value.push({
      role: 'assistant',
      content: response.data.answer,
      hintLevel: response.data.hintLevel
    });

    await scrollToBottom();
    ElMessage.success('AI回复成功');
  } catch (error: any) {
    ElMessage.error(error.message || 'AI辅导失败');
    // 移除用户消息
    aiChatHistory.value.pop();
  } finally {
    aiLoading.value = false;
  }
};

// 获取hintLevel对应的文本
const getHintLevelText = (level: string) => {
  const levelMap: Record<string, string> = {
    full: '完整答案',
    guided: '引导提示',
    minimal: '最小提示',
    discussion: '讨论模式'
  };
  return levelMap[level] || level;
};

// 知识类型映射
const getKnowledgeTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    factual: '知识点',
    conceptual: '原理理解',
    procedural: '动手操作',
    metacognitive: '反思总结'
  };
  return labels[type] || type;
};

const getKnowledgeTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    factual: 'var(--color-pending)',
    conceptual: 'var(--color-primary)',
    procedural: 'var(--color-efficient)',
    metacognitive: 'var(--color-danger)'
  };
  return colors[type] || 'var(--color-pending)';
};

const getCognitiveLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    remember: 'var(--color-pending)',
    understand: 'var(--color-muted)',
    apply: 'var(--color-success)',
    analyze: 'var(--color-efficient)',
    evaluate: 'var(--color-danger)',
    create: 'var(--color-primary)'
  };
  return colors[level] || 'var(--color-pending)';
};
  return colors[type] || '#909399';
};

// 认知层级映射
const getCognitiveLevelLabel = (level: string) => {
  const labels: Record<string, string> = {
    remember: '了解',
    understand: '搞懂',
    apply: '实战',
    analyze: '拆解',
    evaluate: '决策',
    create: '创造'
  };
  return labels[level] || level;
};

const getCognitiveLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    remember: '#C0C4CC',
    understand: '#909399',
    apply: '#67C23A',
    analyze: '#E6A23C',
    evaluate: '#F56C6C',
    create: '#409EFF'
  };
  return colors[level] || '#909399';
};
</script>

<style scoped>
.task-detail-dialog .el-dialog__body {
  padding: 20px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 12px;
  color: var(--text-secondary);
  transition: color var(--transition-normal);
}

.task-detail-content {
  max-height: 70vh;
  overflow-y: auto;
}

.task-info-section {
  margin-bottom: 24px;
}

.task-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.status-tag,
.type-tag {
  font-weight: 500;
}

.time-info {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-description {
  font-size: 16px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 12px;
  transition: color var(--transition-normal);
}

.breadcrumb {
  color: var(--text-muted);
  font-size: 14px;
  transition: color var(--transition-normal);
}

.hints-section,
.resources-section,
.objectives-section {
  margin-bottom: 24px;
}

.hints-card {
  background: linear-gradient(135deg, var(--bg-muted) 0%, var(--bg-active) 100%);
  border: none;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .hints-card {
  background: linear-gradient(135deg, var(--bg-muted) 0%, var(--bg-elevated) 100%);
}

.hints-list,
.objectives-list {
  margin: 0;
  padding-left: 20px;
}

.hints-list li,
.objectives-list li {
  margin-bottom: 8px;
  line-height: 1.6;
}

.hints-list li::marker {
  color: var(--color-primary);
  transition: color var(--transition-normal);
}

.resources-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.action-section {
  margin-top: 24px;
}

.timer-container {
  text-align: center;
  padding: 24px;
  background: var(--bg-muted);
  border-radius: 8px;
  margin-bottom: 20px;
  transition: background var(--transition-normal);
}

.timer-display {
  font-size: 48px;
  font-weight: bold;
  color: var(--text-primary);
  margin-bottom: 20px;
  font-feature-settings: 'tnum';
  transition: color var(--transition-normal);
}

.timer-display.active {
  color: var(--color-primary);
  animation: pulse 1s ease-in-out infinite;
}

.timer-display.completed {
  color: var(--color-success);
}

.timer-value {
  display: inline-block;
  min-width: 180px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.timer-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.notes-section {
  margin-top: 20px;
}

.notes-section :deep(.el-textarea__inner) {
  resize: vertical;
}

/* 主观难度选择器 */
.difficulty-section {
  margin-top: 20px;
  padding: 20px;
  background: linear-gradient(135deg, rgba(52, 152, 219, 0.05) 0%, rgba(52, 152, 219, 0.1) 100%);
  border-radius: 8px;
  border: 1px solid var(--color-progress-border);
  transition: background var(--transition-normal), border var(--transition-normal);
}

[data-theme="dark"] .difficulty-section {
  background: linear-gradient(135deg, rgba(52, 152, 219, 0.08) 0%, rgba(52, 152, 219, 0.15) 100%);
}

.difficulty-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--color-progress);
  margin-bottom: 16px;
  font-size: 14px;
  transition: color var(--transition-normal);
}

.difficulty-slider {
  margin-bottom: 12px;
}

.difficulty-value {
  text-align: center;
  font-size: 14px;
  color: var(--text-secondary);
  transition: color var(--transition-normal);
}

.ai-tutor-section {
  margin-top: 24px;
}

.chat-container {
  background: var(--bg-muted);
  border-radius: 8px;
  padding: 16px;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  transition: background var(--transition-normal);
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-muted);
  transition: color var(--transition-normal);
}

.chat-empty .el-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 16px;
  max-height: 300px;
}

.chat-message {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 8px;
  max-width: 80%;
}

.chat-message.user {
  background: var(--color-primary);
  color: var(--text-on-primary);
  margin-left: auto;
  transition: background var(--transition-normal), color var(--transition-normal);
}

.chat-message.assistant {
  background: var(--bg-surface);
  color: var(--text-primary);
  transition: background var(--transition-normal), color var(--transition-normal);
}

[data-theme="dark"] .chat-message.assistant {
  background: var(--bg-elevated);
}

.message-role {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 4px;
  opacity: 0.8;
}

.hint-level {
  font-size: 11px;
  font-weight: normal;
  opacity: 0.7;
  margin-left: 4px;
}

.message-content {
  line-height: 1.5;
  white-space: pre-wrap;
}

.chat-input {
  margin-top: auto;
}

/* 安德森框架认知信息样式 */
.anderson-section {
  margin-bottom: 24px;
}

.anderson-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 16px;
}

@media (max-width: 768px) {
  .anderson-grid {
    grid-template-columns: 1fr;
  }
}

.anderson-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.anderson-item .label {
  font-weight: 600;
  color: #606266;
  min-width: 80px;
}

.anderson-item .value {
  color: #303133;
}

.display-hint {
  margin-top: 16px;
  padding: 12px;
  background: #f4f4f5;
  border-radius: 8px;
  color: #606266;
  font-size: 14px;
}

.low-confidence-warning {
  margin-top: 16px;
}
</style>

// iFlow 测试修改
