<template>
  <div class="virtual-session-page">
    <div class="bg-layer">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <header class="session-header">
      <div class="header-left">
        <el-button link @click="router.push('/admin/virtual-learners')">
          <el-icon><ArrowLeft /></el-icon>
          返回列表
        </el-button>
        <span class="session-title">
          模拟会话: {{ profile?.userName || '加载中...' }}
        </span>
      </div>
      <div class="header-right">
        <el-tag :type="getStatusType(session?.status)" size="large">
          {{ getStatusLabel(session?.status) }}
        </el-tag>
        <el-tag type="info" size="large">
          {{ getStageLabel(session?.currentStage) }}
        </el-tag>
      </div>
    </header>

    <div class="session-layout">
      <aside class="profile-panel">
        <div class="panel-card">
          <h3>虚拟用户画像</h3>
          <div class="profile-info">
            <div class="info-item">
              <span class="label">名称:</span>
              <span class="value">{{ profile?.userName }}</span>
            </div>
            <div class="info-item">
              <span class="label">邮箱:</span>
              <span class="value">{{ profile?.email }}</span>
            </div>
            <div class="info-item">
              <span class="label">密码:</span>
              <span class="value">{{ profile?.password || 'VirtualTest123' }}</span>
            </div>
            <div class="info-item">
              <span class="label">知识水平:</span>
              <el-tag size="small">{{ profile?.knowledgeLevel }}</el-tag>
            </div>
            <div class="info-item">
              <span class="label">学习目标:</span>
              <span class="value goal">{{ profile?.learningGoal }}</span>
            </div>
            <div class="info-item" v-if="profile?.profile?.occupation">
              <span class="label">职业:</span>
              <span class="value">{{ profile?.profile?.occupation }}</span>
            </div>
            <div class="info-item" v-if="profile?.profile?.age">
              <span class="label">年龄:</span>
              <span class="value">{{ profile?.profile?.age }}岁</span>
            </div>
          </div>
          <el-button type="primary" link size="small" @click="loginAsVirtual">
            登录此账号查看
          </el-button>
        </div>

        <div class="panel-card">
          <h3>模拟配置</h3>
          <div class="config-info">
            <div class="info-item">
              <span class="label">模式:</span>
              <el-tag :type="profile?.simulationMode === 'ai' ? 'success' : 'info'" size="small">
                {{ profile?.simulationMode === 'ai' ? 'AI自动' : '手动' }}
              </el-tag>
            </div>
            <div class="info-item" v-if="profile?.simulationMode === 'ai'">
              <span class="label">Temperature:</span>
              <span class="value">{{ profile?.simulationTemperature || 0.8 }}</span>
            </div>
          </div>
        </div>
      </aside>

      <main class="conversation-panel">
        <div class="panel-card conversation-card">
          <h3>对话流程</h3>

          <div class="messages-container" ref="messagesRef">
            <div v-if="messages.length === 0" class="empty-message">
              点击下方按钮开始模拟对话
            </div>

            <div
              v-for="(msg, index) in messages"
              :key="index"
              class="message-item"
              :class="msg.role"
            >
              <div class="message-role">
                {{ msg.role === 'user' ? '虚拟用户' : 'AI导师' }}
              </div>
              <div class="message-content">
                {{ msg.content }}
              </div>
            </div>
          </div>

          <div class="quick-replies" v-if="lastQuickReplies.length > 0">
            <span class="label">快捷回复选项:</span>
            <div class="replies-list">
              <el-tag
                v-for="reply in lastQuickReplies"
                :key="reply"
                size="small"
                effect="plain"
              >
                {{ reply }}
              </el-tag>
            </div>
          </div>

          <div class="control-panel">
            <el-button
              type="primary"
              :loading="stepLoading"
              @click="executeSingleStep"
              :disabled="session?.status === 'completed'"
            >
              <el-icon><VideoPlay /></el-icon>
              单步模拟
            </el-button>

            <el-button
              type="success"
              :loading="autoLoading"
              @click="executeAutoLoop"
              :disabled="session?.status === 'completed'"
            >
              <el-icon><Refresh /></el-icon>
              自动循环
            </el-button>

            <el-button
              v-if="session?.currentStage === 'goal' && goalReady"
              type="warning"
              :loading="advanceLoading"
              @click="advanceToPath"
            >
              <el-icon><Right /></el-icon>
              生成路径
            </el-button>

            <el-button
              v-if="manualInputVisible"
              type="default"
              @click="manualInputVisible = false"
            >
              <el-icon><Close /></el-icon>
              取消手动输入
            </el-button>
          </div>

          <div class="stage-status">
            <div class="stage-item" :class="{ active: session?.currentStage === 'goal' }">
              <span class="stage-label">Goal对话</span>
              <span class="stage-indicator" v-if="goalReady">Ready</span>
            </div>
            <div class="stage-item" :class="{ active: session?.currentStage === 'path' }">
              <span class="stage-label">路径生成</span>
            </div>
            <div class="stage-item" :class="{ active: session?.currentStage === 'learning' }">
              <span class="stage-label">学习阶段</span>
            </div>
          </div>
        </div>
      </main>

      <aside class="logs-panel">
        <div class="panel-card">
          <h3>执行日志</h3>
          <div class="logs-container">
            <div v-if="logs.length === 0" class="empty-logs">
              暂无日志
            </div>
            <div
              v-for="(log, index) in logs"
              :key="index"
              class="log-item"
              :class="log.phase"
            >
              <div class="log-header">
                <span class="log-time">{{ formatTime(log.timestamp) }}</span>
                <el-tag size="small" :type="getLogTagType(log.phase)">
                  {{ getLogPhaseLabel(log.phase) }}
                </el-tag>
                <span v-if="log.durationMs" class="log-duration">
                  {{ log.durationMs }}ms
                </span>
              </div>
              <div class="log-details" v-if="log.details">
                <pre>{{ JSON.stringify(log.details, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft, VideoPlay, Refresh, Right, Close } from '@element-plus/icons-vue';
import { adminApi } from '@/api/adminApi';

const router = useRouter();
const route = useRoute();
const sessionId = route.params.sessionId as string;

const session = ref<any>(null);
const profile = ref<any>(null);
const logs = ref<any[]>([]);
const messages = ref<any[]>([]);
const messagesRef = ref();

const stepLoading = ref(false);
const autoLoading = ref(false);
const advanceLoading = ref(false);
const manualInputVisible = ref(false);

const goalReady = computed(() => {
  const lastLog = logs.value.filter(l => l.phase === 'goal-response').pop();
  return lastLog?.details?.output?.stage === 'ready';
});

const lastQuickReplies = computed(() => {
  return [];
});

const formatTime = (time: string | Date | null) => {
  if (!time) return '';
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

const getStatusType = (status: string) => {
  switch (status) {
    case 'running': return 'success';
    case 'completed': return 'info';
    case 'failed': return 'danger';
    default: return 'warning';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'created': return '已创建';
    case 'running': return '运行中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    default: return status || '未知';
  }
};

const getStageLabel = (stage: string) => {
  switch (stage) {
    case 'goal': return 'Goal对话阶段';
    case 'path': return '路径生成阶段';
    case 'learning': return '学习阶段';
    default: return stage || '未知';
  }
};

const getLogTagType = (phase: string) => {
  switch (phase) {
    case 'virtual-reply': return 'primary';
    case 'goal-response': return 'success';
    case 'stage-transition': return 'warning';
    case 'error': return 'danger';
    default: return 'info';
  }
};

const getLogPhaseLabel = (phase: string) => {
  switch (phase) {
    case 'virtual-reply': return '虚拟回复';
    case 'goal-response': return 'Goal响应';
    case 'stage-transition': return '阶段转换';
    case 'error': return '错误';
    default: return phase;
  }
};

const loadSession = async () => {
  try {
    const res = await adminApi.getVirtualSession(sessionId);
    if (res.success) {
      session.value = res.data;
      profile.value = res.data.profile;
      logs.value = res.data.logs || [];
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载会话失败');
  }
};

const executeSingleStep = async () => {
  stepLoading.value = true;
  try {
    const res = await adminApi.virtualSessionStep(sessionId);
    if (res.success && res.data) {
      if (res.data.virtualUserReply) {
        messages.value.push({
          role: 'user',
          content: res.data.virtualUserReply
        });
      }
      if (res.data.goalConversationResponse?.userVisible) {
        messages.value.push({
          role: 'assistant',
          content: res.data.goalConversationResponse.userVisible
        });
      }
      logs.value = [...logs.value, ...res.data.logs];
      scrollToBottom();
      
      if (res.data.goalReady) {
        ElMessage.success('Goal对话已完成，可以生成路径');
      }
    } else {
      ElMessage.error(res.error || '单步模拟失败');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '单步模拟失败');
  } finally {
    stepLoading.value = false;
    loadSession();
  }
};

const executeAutoLoop = async () => {
  autoLoading.value = true;
  try {
    const res = await adminApi.virtualSessionAuto(sessionId, { maxRounds: 20 });
    if (res.success && res.data) {
      res.data.results.forEach((result: any) => {
        if (result.virtualUserReply) {
          messages.value.push({
            role: 'user',
            content: result.virtualUserReply
          });
        }
        if (result.goalConversationResponse?.userVisible) {
          messages.value.push({
            role: 'assistant',
            content: result.goalConversationResponse.userVisible
          });
        }
        logs.value = [...logs.value, ...result.logs];
      });
      scrollToBottom();
      ElMessage.success(`自动循环完成，共 ${res.data.totalRounds} 轮`);
    }
  } catch (error: any) {
    ElMessage.error(error.message || '自动循环失败');
  } finally {
    autoLoading.value = false;
    loadSession();
  }
};

const advanceToPath = async () => {
  advanceLoading.value = true;
  try {
    const res = await adminApi.virtualSessionAdvancePath(sessionId);
    if (res.success) {
      ElMessage.success('路径生成已启动');
      loadSession();
    } else {
      ElMessage.error(res.error || '路径生成失败');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '路径生成失败');
  } finally {
    advanceLoading.value = false;
  }
};

const scrollToBottom = () => {
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
};

const loginAsVirtual = () => {
  if (profile.value?.email && profile.value?.password) {
    ElMessage.info(`可以使用邮箱 ${profile.value.email} 和密码 ${profile.value.password || 'VirtualTest123'} 登录查看`);
  }
};

onMounted(() => {
  loadSession();
});
</script>

<style scoped>
.virtual-session-page {
  min-height: 100vh;
  position: relative;
}

.bg-layer {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
}

.bg-orb--1 {
  width: 400px;
  height: 400px;
  background: rgba(99, 102, 241, 0.15);
  top: -100px;
  right: -100px;
}

.bg-orb--2 {
  width: 300px;
  height: 300px;
  background: rgba(168, 85, 247, 0.1);
  bottom: -50px;
  left: -50px;
}

.session-header {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: var(--glass-bg-light, rgba(255, 255, 255, 0.05));
  border-bottom: 1px solid var(--glass-border-light, rgba(255, 255, 255, 0.1));
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.session-title {
  font-size: 18px;
  font-weight: 600;
}

.header-right {
  display: flex;
  gap: 8px;
}

.session-layout {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 280px 1fr 280px;
  gap: 16px;
  padding: 16px 24px;
  min-height: calc(100vh - 60px);
}

.profile-panel,
.logs-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.conversation-panel {
  display: flex;
  flex-direction: column;
}

.panel-card {
  background: var(--glass-bg-light, rgba(255, 255, 255, 0.05));
  border-radius: 12px;
  border: 1px solid var(--glass-border-light, rgba(255, 255, 255, 0.1));
  padding: 16px;
}

.panel-card h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--text-secondary, #6b7280);
}

.profile-info,
.config-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.info-item .label {
  font-size: 13px;
  color: var(--text-muted, #9ca3af);
  min-width: 70px;
}

.info-item .value {
  font-size: 13px;
  color: var(--text-primary, #374151);
}

.info-item .value.goal {
  line-height: 1.4;
}

.conversation-card {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
  min-height: 300px;
  max-height: 400px;
}

.empty-message {
  text-align: center;
  color: var(--text-muted, #9ca3af);
  padding: 40px;
}

.message-item {
  margin-bottom: 16px;
}

.message-item.user {
  text-align: right;
}

.message-item.assistant {
  text-align: left;
}

.message-role {
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
  margin-bottom: 4px;
}

.message-content {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 8px;
  max-width: 80%;
  line-height: 1.4;
}

.message-item.user .message-content {
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-primary, #374151);
}

.message-item.assistant .message-content {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary, #374151);
}

.quick-replies {
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.quick-replies .label {
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
  margin-bottom: 8px;
}

.replies-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.control-panel {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}

.stage-status {
  margin-top: 16px;
  display: flex;
  gap: 16px;
  justify-content: center;
}

.stage-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}

.stage-item.active {
  background: rgba(99, 102, 241, 0.2);
}

.stage-label {
  font-size: 13px;
}

.stage-indicator {
  font-size: 11px;
  color: #10b981;
  font-weight: 600;
}

.logs-container {
  overflow-y: auto;
  max-height: 500px;
}

.empty-logs {
  text-align: center;
  color: var(--text-muted, #9ca3af);
  padding: 20px;
}

.log-item {
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}

.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.log-time {
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
}

.log-duration {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
}

.log-details {
  margin-top: 4px;
}

.log-details pre {
  font-size: 11px;
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0;
}
</style>