<template>
  <div class="dialogue-learning-page" v-loading="pageLoading">
    <!-- 顶部导航栏 -->
    <header class="learning-header">
      <div class="header-left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <div class="path-info" v-if="taskInfo">
          <span class="path-name">{{ taskInfo.pathName }}</span>
          <el-icon><ArrowRight /></el-icon>
          <span class="task-name">{{ taskInfo.taskTitle }}</span>
        </div>
      </div>
      <div class="header-center">
        <h1 class="task-title" v-if="taskInfo">{{ taskInfo.taskTitle }}</h1>
      </div>
      <div class="header-right">
        <el-tag :type="sessionActive ? 'success' : 'info'" size="large">
          {{ sessionActive ? '学习中' : '未开始' }}
        </el-tag>
      </div>
    </header>

    <div class="learning-body">
      <!-- 左侧：进度和信息 -->
      <aside class="sidebar-left">
        <!-- 进度卡片 -->
        <div class="progress-card">
          <div class="progress-header">
            <el-icon><TrendCharts /></el-icon>
            <span>学习进度</span>
          </div>
          <el-progress
            :percentage="progressPercentage"
            :stroke-width="12"
            :color="progressColor"
            class="progress-bar"
          />
          <div class="progress-info">
            <span class="progress-text">
              第 {{ currentRound }} / {{ totalRounds || 8 }} 轮
            </span>
            <span class="progress-estimate">
              预计 {{ estimatedTime }} 分钟
            </span>
          </div>
        </div>

        <!-- 学生状态卡片 -->
        <div class="state-card">
          <div class="state-header">
            <el-icon><DataLine /></el-icon>
            <span>学习状态</span>
          </div>
          <div class="state-content">
            <div class="state-item">
              <span class="state-label">认知深度</span>
              <el-progress
                :percentage="studentState.cognitive * 100"
                :stroke-width="8"
                :color="getCognitiveColor"
                :format="(val: number) => (val / 100).toFixed(2)"
              />
            </div>
            <div class="state-item">
              <span class="state-label">压力程度</span>
              <el-progress
                :percentage="studentState.stress * 100"
                :stroke-width="8"
                :color="getStressColor"
                :format="(val: number) => (val / 100).toFixed(2)"
              />
            </div>
            <div class="state-item">
              <span class="state-label">投入程度</span>
              <el-progress
                :percentage="studentState.engagement * 100"
                :stroke-width="8"
                :color="getEngagementColor"
                :format="(val: number) => (val / 100).toFixed(2)"
              />
            </div>
          </div>
          <div v-if="studentState.anomaly" class="state-warning">
            <el-alert
              :title="studentState.anomalyReason || '检测到异常学习状态'"
              type="warning"
              :closable="false"
              show-icon
            />
          </div>
          <div v-if="studentState.intervention" class="state-intervention">
            <el-alert
              :title="studentState.intervention"
              type="info"
              :closable="false"
              show-icon
            />
          </div>
        </div>

        <!-- 学习提示卡片 -->
        <div class="hints-card">
          <div class="hints-header">
            <el-icon><Lightning /></el-icon>
            <span>学习提示</span>
          </div>
          <div class="hints-content">
            <p>💡 认真思考每个问题</p>
            <p>💡 不要害怕犯错，错误是学习的机会</p>
            <p>💡 遇到困难可以点击"提示"按钮</p>
            <p>💡 完成至少 4 轮对话后可以跳过</p>
          </div>
        </div>
      </aside>

      <!-- 中间：对话区域 -->
      <main class="main-content">
        <ConversationPanel
          :messages="conversationHistory"
          :current-content="currentContent"
          :loading="aiLoading"
          @response-submit="handleSubmitResponse"
        />
      </main>

      <!-- 右侧：操作按钮 -->
      <aside class="sidebar-right">
        <div class="action-buttons">
          <el-button
            type="warning"
            size="large"
            @click="handleHint"
            :disabled="!canGetHint"
            class="action-btn"
          >
            <el-icon><Lightning /></el-icon>
            请求提示
          </el-button>
          
          <el-button
            type="info"
            size="large"
            @click="handleSkip"
            :disabled="!canSkip"
            class="action-btn"
          >
            <el-icon><CircleClose /></el-icon>
            跳过此任务
          </el-button>
          
          <el-button
            type="success"
            size="large"
            @click="handleComplete"
            :disabled="!dialogueComplete"
            class="action-btn"
          >
            <el-icon><Check /></el-icon>
            完成任务
          </el-button>
          
          <el-button
            v-if="dialogueComplete"
            type="primary"
            size="large"
            @click="openFeedback"
            class="action-btn"
          >
            <el-icon><Star /></el-icon>
            提供反馈
          </el-button>
        </div>

        <!-- 学习统计 -->
        <div class="stats-card">
          <div class="stats-header">
            <el-icon><DataAnalysis /></el-icon>
            <span>本次学习</span>
          </div>
          <div class="stats-content">
            <div class="stat-item">
              <span class="stat-label">已用时间</span>
              <span class="stat-value">{{ formatTime(elapsedTime) }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">回答问题</span>
              <span class="stat-value">{{ conversationHistory.filter(m => m.role === 'user').length }} 个</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">平均响应</span>
              <span class="stat-value">{{ avgResponseTime }} 秒</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
    
    <!-- 反馈对话框 -->
    <FeedbackDialog
      ref="feedbackDialogRef"
      :sessionId="sessionId"
      :taskId="taskId"
      :strategy="currentStrategy"
      :uiType="currentUIType"
      :roundNumber="currentRound"
      @submitted="handleFeedbackSubmitted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft,
  ArrowRight,
  TrendCharts,
  DataLine,
  Lightning,
  CircleClose,
  Check,
  DataAnalysis,
  Star
} from '@element-plus/icons-vue';
import { dialogueAPI } from '@/api/dialogue';
import ConversationPanel from '@/components/ConversationPanel.vue';
import FeedbackDialog from '@/components/FeedbackDialog.vue';
import type {
  ContentAgentOutput,
  StudentState,
  DialogueMessage
} from '@/types/learning';

const route = useRoute();
const router = useRouter();
const taskId = computed(() => route.params.taskId as string);

// 页面状态
const pageLoading = ref(true);
const sessionActive = ref(false);

// 会话信息
const sessionId = ref<string>('');
const taskInfo = ref<{
  taskTitle: string;
  pathName: string;
} | null>(null);

// 对话内容
const conversationHistory = ref<DialogueMessage[]>([]);
const currentContent = ref<ContentAgentOutput['content'] | null>(null);
const aiLoading = ref(false);
const dialogueComplete = ref(false);

// 进度信息
const currentRound = ref(1);
const totalRounds = ref<number>(8);

// 学生状态
const studentState = ref<StudentState>({
  cognitive: 0.5,
  stress: 0.3,
  engagement: 0.6,
  anomaly: false,
  assessedAt: new Date()
});

// 时间统计
const elapsedTime = ref(0);
const timerInterval = ref<number | null>(null);
const responseTimes = ref<number[]>([]);
const lastResponseTime = ref<number>(0);

// 反馈相关
const feedbackDialogRef = ref<InstanceType<typeof FeedbackDialog>>();
const currentStrategy = ref<string>('zpd-scaffold');  // 默认策略
const currentUIType = ref<string>('dialogue');  // 默认 UI 类型

// 计算属性
const progressPercentage = computed(() => {
  if (!totalRounds.value) return 0;
  return Math.min(100, Math.round((currentRound.value / totalRounds.value) * 100));
});

const progressColor = computed(() => {
  if (progressPercentage.value < 50) return '#f56c6c';
  if (progressPercentage.value < 75) return '#e6a23c';
  return '#67c23a';
});

const canGetHint = computed(() => {
  return sessionActive.value && !aiLoading.value;
});

const canSkip = computed(() => {
  return conversationHistory.value.filter(m => m.role === 'user').length >= 4;
});

const avgResponseTime = computed(() => {
  if (responseTimes.value.length === 0) return 0;
  return Math.round(responseTimes.value.reduce((a, b) => a + b, 0) / responseTimes.value.length);
});

// 状态颜色
const getCognitiveColor = (val: number) => {
  if (val < 50) return '#f56c6c';
  if (val < 75) return '#e6a23c';
  return '#67c23a';
};

const getStressColor = (val: number) => {
  if (val < 50) return '#67c23a';
  if (val < 75) return '#e6a23c';
  return '#f56c6c';
};

const getEngagementColor = (val: number) => {
  if (val < 50) return '#f56c6c';
  if (val < 75) return '#e6a23c';
  return '#67c23a';
};

// 加载任务
const loadTask = async () => {
  if (!taskId.value) {
    ElMessage.error('任务 ID 无效');
    router.push('/dashboard');
    return;
  }

  pageLoading.value = true;
  try {
    const result = await dialogueAPI.startDialogueTask(taskId.value);
    
    sessionId.value = result.sessionId;
    taskInfo.value = {
      taskTitle: result.taskTitle,
      pathName: '对话式学习' // 可以从后端获取更多路径信息
    };
    sessionActive.value = true;
    
    // 初始化对话历史
    conversationHistory.value = result.conversationHistory || [];
    
    // 设置初始内容
    currentContent.value = result.initialContent;
    
    // 更新学生状态
    studentState.value = result.studentState || studentState.value;
    
    // 开始计时
    startTimer();
    
    ElMessage.success('任务加载成功');
  } catch (error: any) {
    ElMessage.error(error.message || '加载任务失败');
    console.error('loadTask error:', error);
  } finally {
    pageLoading.value = false;
  }
};

// 提交回答
const handleSubmitResponse = async (response: string) => {
  if (!sessionId.value || aiLoading.value) return;

  // 记录响应时间
  const now = Date.now();
  if (lastResponseTime.value) {
    responseTimes.value.push((now - lastResponseTime.value) / 1000);
  }
  lastResponseTime.value = now;

  // 添加学生回答到历史
  conversationHistory.value.push({
    role: 'user',
    content: response,
    timestamp: new Date().toISOString(),
    metadata: {
      wordCount: response.length
    }
  });

  aiLoading.value = true;
  try {
    const result = await dialogueAPI.submitResponse(sessionId.value, response);
    
    // 更新学生状态
    studentState.value = result.studentState || studentState.value;
    
    // 更新对话历史
    if (result.conversationHistory) {
      conversationHistory.value = result.conversationHistory;
    }
    
    // 添加 AI 反馈到历史
    if (result.feedback) {
      conversationHistory.value.push({
        role: 'assistant',
        content: result.feedback,
        timestamp: new Date().toISOString()
      });
    }
    
    // 更新下一轮内容
    if (result.nextContent) {
      currentContent.value = result.nextContent;
      currentRound.value++;
    }
    
    // 检查对话是否完成
    dialogueComplete.value = result.dialogueComplete;
    if (result.dialogueComplete) {
      sessionActive.value = false;
      ElMessage.success('对话完成！');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '提交回答失败');
    console.error('handleSubmitResponse error:', error);
    
    // 回滚：移除刚才添加的用户消息
    conversationHistory.value.pop();
  } finally {
    aiLoading.value = false;
  }
};

// 请求提示
const handleHint = async () => {
  if (!sessionId.value) return;
  
  try {
    const hint = await dialogueAPI.getHint(sessionId.value);
    ElMessageBox.alert(hint || '暂无提示', '💡 提示', {
      confirmButtonText: '知道了'
    });
  } catch (error: any) {
    ElMessage.error(error.message || '获取提示失败');
  }
};

// 跳过任务
const handleSkip = async () => {
  if (!sessionId.value) return;
  
  try {
    const confirm = await ElMessageBox.confirm(
      '确定要跳过当前任务吗？跳过将无法获得本任务的 XP 奖励。',
      '跳过任务',
      {
        confirmButtonText: '确定跳过',
        cancelButtonText: '继续学习',
        type: 'warning'
      }
    );
    
    if (confirm) {
      await dialogueAPI.skipTask(sessionId.value);
      ElMessage.info('已跳过任务');
      goBack();
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '跳过任务失败');
    }
  }
};

// 完成任务
const handleComplete = () => {
  if (!dialogueComplete.value) {
    ElMessage.warning('请先完成对话学习');
    return;
  }
  
  ElMessageBox.confirm(
    '恭喜你完成对话学习！是否返回学习路径？',
    '完成任务',
    {
      confirmButtonText: '返回路径',
      cancelButtonText: '继续查看',
      type: 'success'
    }
  ).then(() => {
    // 完成后自动弹出反馈
    openFeedback();
  });
};

// 打开反馈对话框
const openFeedback = () => {
  feedbackDialogRef.value?.open();
};

// 处理反馈提交
const handleFeedbackSubmitted = () => {
  console.log('反馈已提交');
  // 可以在这里添加反馈提交后的处理逻辑
  // 比如：返回学习路径、显示感谢页面等
};

// 返回
const goBack = () => {
  // 如果有学习路径 ID，返回路径详情
  // 否则返回 dashboard
  router.push('/dashboard');
};

// 计时器
const startTimer = () => {
  timerInterval.value = window.setInterval(() => {
    elapsedTime.value++;
  }, 1000);
};

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// 估计时间（基于轮次）
const estimatedTime = computed(() => {
  return (totalRounds.value || 8) * 2; // 每轮约 2 分钟
});

// 重置状态
const resetState = () => {
  // 停止计时器
  if (timerInterval.value) {
    clearInterval(timerInterval.value);
    timerInterval.value = null;
  }
  
  // 重置会话状态
  sessionId.value = '';
  sessionActive.value = false;
  taskInfo.value = null;
  
  // 重置对话内容
  conversationHistory.value = [];
  currentContent.value = null;
  aiLoading.value = false;
  dialogueComplete.value = false;
  
  // 重置进度
  currentRound.value = 1;
  totalRounds.value = 8;
  
  // 重置学生状态
  studentState.value = {
    cognitive: 0.5,
    stress: 0.3,
    engagement: 0.6,
    anomaly: false,
    assessedAt: new Date()
  };
  
  // 重置时间统计
  elapsedTime.value = 0;
  responseTimes.value = [];
  lastResponseTime.value = 0;
  
  // 重置策略
  currentStrategy.value = 'zpd-scaffold';
  currentUIType.value = 'dialogue';
};

// 监听路由变化
watch(taskId, (newTaskId, oldTaskId) => {
  if (newTaskId && newTaskId !== oldTaskId) {
    console.log('[DialogueLearningPage] 任务切换:', oldTaskId, '->', newTaskId);
    resetState();
    loadTask();
  }
});

// 生命周期
onMounted(() => {
  loadTask();
});

onUnmounted(() => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value);
  }
});
</script>

<style scoped>
.dialogue-learning-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--bg-body);
}

.learning-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background-color: var(--bg-surface);
  border-bottom: 1px solid var(--border-default);
  box-shadow: var(--shadow-xs);
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.header-center {
  text-align: center;
}

.path-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}

.path-name,
.task-name {
  font-weight: 500;
}

.task-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.learning-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 16px;
  padding: 16px;
}

.sidebar-left,
.sidebar-right {
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.main-content {
  flex: 1;
  background-color: var(--bg-surface);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  border: 1px solid var(--border-default);
}

.progress-card,
.state-card,
.hints-card,
.stats-card {
  background-color: var(--bg-surface);
  border-radius: 8px;
  padding: 16px;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--border-default);
}

.progress-header,
.state-header,
.hints-header,
.stats-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.progress-bar {
  margin-bottom: 12px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-muted);
}

.state-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.state-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.state-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.state-warning,
.state-intervention {
  margin-top: 12px;
}

.hints-content p {
  margin: 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-btn {
  width: 100%;
}

.stats-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}

.stat-item:last-child {
  border-bottom: none;
}

.stat-label {
  font-size: 13px;
  color: var(--text-muted);
}

.stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

[data-theme="dark"] {
  .dialogue-learning-page {
    background-color: var(--bg-body);
  }

  .learning-header {
    background-color: var(--bg-elevated);
    border-bottom: 1px solid var(--border-default);
  }

  .main-content {
    background-color: var(--bg-elevated);
    border: 1px solid var(--border-default);
  }

  .progress-card,
  .state-card,
  .hints-card,
  .stats-card {
    background-color: var(--bg-elevated);
    border: 1px solid var(--border-default);
  }
}
</style>
