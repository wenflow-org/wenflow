<template>
  <div class="virtual-session-page">
    <header class="session-header">
      <div class="header-left">
        <el-button text @click="router.push('/admin/virtual-learners')">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <div class="session-identity">
          <span class="session-name">{{ profile?.userName || '加载中...' }}</span>
          <div class="session-tags">
            <el-tag :type="getStatusType(session?.status)" size="small" round>
              {{ getStatusLabel(session?.status) }}
            </el-tag>
            <el-tag type="info" size="small" round>
              {{ getStageLabel(session?.currentStage) }}
            </el-tag>
          </div>
        </div>
      </div>
      <div class="header-center">
        <div class="stage-progress">
          <div
            class="stage-node"
            :class="{ done: goalReady, active: session?.currentStage === 'goal' && !goalReady }"
          >
            <div class="node-icon">
              <el-icon v-if="goalReady"><Check /></el-icon>
              <el-icon v-else-if="session?.currentStage === 'goal'" class="is-loading"><Loading /></el-icon>
              <span v-else>1</span>
            </div>
            <span class="node-label">Goal</span>
          </div>
          <div class="stage-line" :class="{ done: goalReady }"></div>
          <div
            class="stage-node"
            :class="{ done: pathStatus === 'active' || pathStatus === 'ready', active: pathStatus === 'generating' }"
          >
            <div class="node-icon">
              <el-icon v-if="pathStatus === 'active' || pathStatus === 'ready'"><Check /></el-icon>
              <el-icon v-else-if="pathStatus === 'generating'" class="is-loading"><Loading /></el-icon>
              <el-icon v-else-if="pathStatus === 'failed'"><Warning /></el-icon>
              <span v-else>2</span>
            </div>
            <span class="node-label">路径</span>
          </div>
          <div class="stage-line" :class="{ done: pathStatus === 'active' || pathStatus === 'ready' }"></div>
          <div
            class="stage-node"
            :class="{ done: session?.status === 'completed', active: session?.currentStage === 'learning' && session?.status !== 'completed' }"
          >
            <div class="node-icon">
              <el-icon v-if="session?.status === 'completed'"><Check /></el-icon>
              <el-icon v-else-if="session?.currentStage === 'learning'" class="is-loading"><Loading /></el-icon>
              <span v-else>3</span>
            </div>
            <span class="node-label">学习</span>
          </div>
        </div>
      </div>
      <div class="header-right">
        <div class="stat-group">
          <div class="stat-chip">
            <span class="stat-val">{{ totalRounds }}</span>
            <span class="stat-lbl">轮次</span>
          </div>
        </div>
      </div>
    </header>

    <div class="path-banner" v-if="pathStatus === 'active' || pathStatus === 'ready'">
      <el-icon><Check /></el-icon>
      <span>路径已生成：{{ pathData?.title || '学习路径' }}</span>
      <el-tag size="small" type="success" round>{{ pathData?.totalMilestones }} 里程碑</el-tag>
    </div>
    <div class="path-banner generating" v-else-if="pathStatus === 'generating' || (goalReady && pathStatus === 'idle')">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>路径生成中...</span>
    </div>
    <div class="path-banner failed" v-else-if="pathStatus === 'failed'">
      <el-icon><Warning /></el-icon>
      <span>路径生成失败</span>
      <el-button type="danger" size="small" round :loading="advanceLoading" @click="retryPathGeneration">
        重试
      </el-button>
    </div>

    <div class="learning-banner" v-if="session?.currentStage === 'learning' && session?.status !== 'completed'">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>学习进度：</span>
      <el-tag size="small" type="primary" round>
        第 {{ learningProgress.currentMilestone }} / {{ learningProgress.totalMilestones }} 里程碑
      </el-tag>
      <span v-if="learningProgress.currentTask" class="current-task">
        当前任务：{{ learningProgress.currentTask }}
      </span>
    </div>

    <div class="session-body">
      <aside class="left-panel">
        <div class="panel-section">
          <div class="section-title">画像信息</div>
          <div class="profile-summary">
            <div class="avatar-block">
              <div class="avatar">{{ profile?.userName?.charAt(0) || '?' }}</div>
              <div class="avatar-info">
                <div class="avatar-name">{{ profile?.userName }}</div>
                <el-tag size="small" type="info" round>{{ profile?.knowledgeLevel }}</el-tag>
              </div>
            </div>
            <div class="profile-fields">
              <div class="field-row" v-if="profile?.learningGoal">
                <span class="field-icon">🎯</span>
                <span class="field-value">{{ profile?.learningGoal }}</span>
              </div>
              <div class="field-row" v-if="profile?.profile?.occupation">
                <span class="field-icon">💼</span>
                <span class="field-value">{{ profile?.profile?.occupation }}</span>
              </div>
              <div class="field-row" v-if="profile?.profile?.age">
                <span class="field-icon">📅</span>
                <span class="field-value">{{ profile?.profile?.age }}岁</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <div class="section-title">模拟配置</div>
          <div class="config-row">
            <span class="config-label">模式</span>
            <el-tag :type="profile?.simulationMode === 'ai' ? 'success' : 'info'" size="small" round>
              {{ profile?.simulationMode === 'ai' ? 'AI 自动' : '手动' }}
            </el-tag>
          </div>
          <div class="config-row" v-if="profile?.simulationMode === 'ai'">
            <span class="config-label">Temperature</span>
            <span class="config-value">{{ profile?.simulationTemperature || 0.8 }}</span>
          </div>
        </div>

        <div class="panel-section">
          <div class="section-title">账号</div>
          <div class="field-row">
            <span class="field-icon">📧</span>
            <span class="field-value mono">{{ profile?.email }}</span>
          </div>
          <div class="field-row">
            <span class="field-icon">🔑</span>
            <span class="field-value mono">{{ profile?.password || 'VirtualTest123' }}</span>
          </div>
          <el-button text type="primary" size="small" @click="loginAsVirtual" style="margin-top: 8px;">
            登录此账号查看
          </el-button>
        </div>
      </aside>

      <main class="center-panel">
        <div class="chat-area">
          <div class="messages-scroll" ref="messagesRef">
            <div v-if="messages.length === 0" class="empty-chat">
              <div class="empty-icon">💬</div>
              <p>点击下方按钮开始模拟对话</p>
            </div>
            <div
              v-for="(msg, index) in messages"
              :key="index"
              class="chat-bubble"
              :class="msg.role"
            >
              <div class="bubble-avatar">{{ msg.role === 'user' ? '👤' : '🤖' }}</div>
              <div class="bubble-body">
                <div class="bubble-name">{{ msg.role === 'user' ? '虚拟用户' : 'AI 导师' }}</div>
                <div class="bubble-text">{{ msg.content }}</div>
              </div>
            </div>
          </div>

          <div class="quick-replies" v-if="lastQuickReplies.length > 0">
            <span class="replies-label">可选回复</span>
            <div class="replies-list">
              <el-tag
                v-for="reply in lastQuickReplies"
                :key="reply"
                size="small"
                effect="plain"
                round
              >
                {{ reply }}
              </el-tag>
            </div>
          </div>
        </div>

        <div class="control-bar">
          <div class="control-primary" v-if="session?.currentStage === 'goal'">
            <el-button
              type="primary"
              :loading="stepLoading"
              @click="executeSingleStep"
              :disabled="session?.status === 'completed'"
              round
            >
              <el-icon><VideoPlay /></el-icon>
              单步模拟
            </el-button>
            <el-button
              type="success"
              :loading="autoLoading"
              @click="executeAutoLoop"
              :disabled="session?.status === 'completed'"
              round
            >
              <el-icon><Refresh /></el-icon>
              自动循环
            </el-button>
          </div>

          <div class="control-primary" v-else-if="pathStatus === 'active' || pathStatus === 'ready'">
            <el-button
              type="primary"
              :loading="learningStartLoading"
              @click="startLearning"
              :disabled="session?.currentStage === 'learning'"
              round
            >
              <el-icon><VideoPlay /></el-icon>
              开始学习
            </el-button>
            <el-button
              type="success"
              :loading="learningStepLoading"
              @click="executeLearningStep"
              :disabled="session?.currentStage !== 'learning'"
              round
            >
              <el-icon><VideoPlay /></el-icon>
              学习一步
            </el-button>
            <el-button
              type="warning"
              :loading="autoLearningLoading"
              @click="executeAutoLearning"
              :disabled="session?.currentStage !== 'learning'"
              round
            >
              <el-icon><Refresh /></el-icon>
              自动学习
            </el-button>
          </div>

          <div class="control-primary" v-else-if="session?.currentStage === 'learning'">
            <el-button
              type="success"
              :loading="learningStepLoading"
              @click="executeLearningStep"
              round
            >
              <el-icon><VideoPlay /></el-icon>
              学习一步
            </el-button>
            <el-button
              type="warning"
              :loading="autoLearningLoading"
              @click="executeAutoLearning"
              round
            >
              <el-icon><Refresh /></el-icon>
              自动学习
            </el-button>
          </div>

          <div class="control-secondary">
            <el-button
              v-if="session?.status === 'completed'"
              type="info"
              round
              size="small"
              @click="exportChat"
            >
              导出对话
            </el-button>
          </div>
        </div>
      </main>

      <aside class="right-panel">
        <div class="panel-section">
          <div class="section-header">
            <div class="section-title">执行日志</div>
            <div class="section-actions">
              <el-select v-model="logFilter" size="small" style="width: 110px;" placeholder="筛选">
                <el-option label="全部" value="all" />
                <el-option label="虚拟回复" value="virtual-reply" />
                <el-option label="Goal响应" value="goal-response" />
                <el-option label="学习响应" value="learning-reply" />
                <el-option label="阶段转换" value="stage-transition" />
                <el-option label="错误" value="error" />
              </el-select>
            </div>
          </div>
          <div class="logs-scroll">
            <div v-if="filteredLogs.length === 0" class="empty-logs">
              暂无日志
            </div>
            <div
              v-for="(log, index) in filteredLogs"
              :key="index"
              class="log-entry"
              :class="log.phase"
            >
              <div class="log-head" @click="toggleLogExpand(index)">
                <div class="log-left">
                  <span class="log-dot" :class="log.phase"></span>
                  <el-tag size="small" :type="getLogTagType(log.phase)" round>
                    {{ getLogPhaseLabel(log.phase) }}
                  </el-tag>
                  <span v-if="log.durationMs" class="log-dur">{{ log.durationMs }}ms</span>
                </div>
                <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              </div>
              <div class="log-summary" v-if="getLogSummary(log)">
                {{ getLogSummary(log) }}
              </div>
              <el-collapse-transition>
                <div class="log-detail" v-if="expandedLogs.has(index)">
                  <pre>{{ JSON.stringify(log.details, null, 2) }}</pre>
                </div>
              </el-collapse-transition>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft, VideoPlay, Refresh, Loading, Check, Warning } from '@element-plus/icons-vue';
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

const learningStartLoading = ref(false);
const learningStepLoading = ref(false);
const autoLearningLoading = ref(false);

const learningMilestones = ref<any[]>([]);
const learningProgress = ref({
  currentMilestone: 0,
  totalMilestones: 0,
  currentTask: null as string | null
});

const pathStatus = ref<string>('idle');
const pathData = ref<any>(null);
let pathPollTimer: any = null;

const logFilter = ref('all');
const expandedLogs = ref<Set<number>>(new Set());

const totalRounds = computed(() => {
  return logs.value.filter(l => l.phase === 'virtual-reply').length;
});

const filteredLogs = computed(() => {
  if (logFilter.value === 'all') return logs.value;
  return logs.value.filter(l => l.phase === logFilter.value);
});

const goalReady = computed(() => {
  if (session.value?.currentStage === 'path' || session.value?.currentStage === 'learning') return true;
  const lastLog = logs.value.filter(l => l.phase === 'goal-response').pop();
  return lastLog?.details?.output?.stage === 'ready';
});

const lastQuickReplies = computed(() => {
  const lastGoalLog = logs.value.filter(l => l.phase === 'goal-response').pop();
  return lastGoalLog?.details?.output?.quickReplies || [];
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
    case 'goal': return 'Goal对话';
    case 'path': return '路径生成';
    case 'learning': return '学习阶段';
    default: return stage || '未知';
  }
};

const getLogTagType = (phase: string) => {
  switch (phase) {
    case 'virtual-reply': return 'primary';
    case 'goal-response': return 'success';
    case 'stage-transition': return 'warning';
    case 'learning-reply': return 'info';
    case 'learning-response': return 'success';
    case 'learning-start': return 'info';
    case 'error': return 'danger';
    default: return 'info';
  }
};

const getLogPhaseLabel = (phase: string) => {
  switch (phase) {
    case 'virtual-reply': return '虚拟回复';
    case 'goal-response': return 'Goal响应';
    case 'stage-transition': return '阶段转换';
    case 'learning-reply': return '学习回复';
    case 'learning-response': return '学习响应';
    case 'learning-start': return '开始学习';
    case 'error': return '错误';
    default: return phase;
  }
};

const getLogSummary = (log: any) => {
  if (log.phase === 'virtual-reply' && log.details?.output?.reply) {
    const r = log.details.output.reply;
    return r.length > 80 ? r.slice(0, 80) + '...' : r;
  }
  if (log.phase === 'goal-response' && log.details?.output?.userVisible) {
    const r = log.details.output.userVisible;
    return r.length > 80 ? r.slice(0, 80) + '...' : r;
  }
  if (log.phase === 'stage-transition' && log.details) {
    return `${log.details.from || '?'} → ${log.details.to || '?'}`;
  }
  if (log.phase === 'error' && log.details?.error) {
    return log.details.error;
  }
  return '';
};

const toggleLogExpand = (index: number) => {
  if (expandedLogs.value.has(index)) {
    expandedLogs.value.delete(index);
  } else {
    expandedLogs.value.add(index);
  }
};

const exportChat = () => {
  const text = messages.value
    .map(m => `[${m.role === 'user' ? '虚拟用户' : 'AI导师'}] ${m.content}`)
    .join('\n\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${sessionId}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

const loadSession = async () => {
  try {
    const res = await adminApi.getVirtualSession(sessionId);
    if (res.data?.success) {
      session.value = res.data.data;
      profile.value = res.data.data.profile;
      messages.value = [];
      try {
        const logs = res.data.data.logs || [];
        logs.forEach((log: any) => {
          if (log.details?.output?.reply) {
            messages.value.push({
              role: 'user',
              content: log.details.output.reply
            });
          }
          if (log.phase === 'goal-response' && log.details?.output?.userVisible) {
            messages.value.push({
              role: 'assistant',
              content: log.details.output.userVisible
            });
          }
        });
      } catch {
        // ignore parse errors
      }
      logs.value = res.data.data.logs || [];
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载会话失败');
  }
};

const executeSingleStep = async () => {
  stepLoading.value = true;
  try {
    const res = await adminApi.virtualSessionStep(sessionId);
    if (res.data?.success) {
      const data = res.data.data;
      if (data.virtualUserReply) {
        messages.value.push({
          role: 'user',
          content: data.virtualUserReply
        });
      }
      if (data.goalConversationResponse) {
        messages.value.push({
          role: 'assistant',
          content: data.goalConversationResponse.userVisible
        });
      }
      if (data.logs) {
        logs.value = [...logs.value, ...data.logs];
      }
      if (data.goalReady) {
        ElMessage.success('Goal准备完成，可以生成路径');
      }
    } else {
      ElMessage.error(res.data?.error || '单步模拟失败');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '单步模拟失败');
  } finally {
    stepLoading.value = false;
  }
};

const executeAutoLoop = async () => {
  autoLoading.value = true;
  try {
    const res = await adminApi.virtualSessionAuto(sessionId, { maxRounds: 20 });
    if (res.data?.success) {
      const results = res.data.data?.results || [];
      results.forEach((result: any) => {
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
        if (result.logs) {
          logs.value = [...logs.value, ...result.logs];
        }
      });
      scrollToBottom();
      ElMessage.success(`自动循环完成，共 ${results.length} 轮`);
    }
  } catch (error: any) {
    ElMessage.error(error.message || '自动循环失败');
  } finally {
    autoLoading.value = false;
  }
};

const advanceToPath = async () => {
  advanceLoading.value = true;
  try {
    const res = await adminApi.virtualSessionAdvancePath(sessionId);
    if (res.data?.success) {
      ElMessage.success('路径生成已重新启动');
      pathStatus.value = 'generating';
      startPathPolling();
    } else {
      ElMessage.error(res.data?.error || '路径生成失败');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '路径生成失败');
  } finally {
    advanceLoading.value = false;
  }
};

const retryPathGeneration = advanceToPath;

const startLearning = async () => {
  learningStartLoading.value = true;
  try {
    const res = await adminApi.startVirtualLearning(sessionId);
    if (res.data?.success) {
      const data = res.data.data;
      learningMilestones.value = data.milestones || [];
      learningProgress.value = {
        currentMilestone: 1,
        totalMilestones: data.milestones?.length || 0,
        currentTask: null
      };
      
      session.value = {
        ...session.value,
        currentStage: 'learning'
      };
      
      if (data.welcomeMessage) {
        messages.value.push({
          role: 'assistant',
          content: data.welcomeMessage
        });
      }
      
      ElMessage.success('学习阶段已启动');
    } else {
      ElMessage.error(res.data?.error || '启动学习阶段失败');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '启动学习阶段失败');
  } finally {
    learningStartLoading.value = false;
  }
};

const executeLearningStep = async () => {
  learningStepLoading.value = true;
  try {
    const res = await adminApi.virtualSessionLearningStep(sessionId);
    if (res.data?.success) {
      const data = res.data.data;
      
      if (data.userMessage) {
        messages.value.push({
          role: 'user',
          content: data.userMessage
        });
      }
      if (data.aiResponse) {
        messages.value.push({
          role: 'assistant',
          content: data.aiResponse
        });
      }
      if (data.logs) {
        logs.value = [...logs.value, ...data.logs];
      }
      
      if (data.milestoneProgress) {
        learningProgress.value = data.milestoneProgress;
      }
      
      if (data.isPathCompleted) {
        session.value = {
          ...session.value,
          status: 'completed',
          currentStage: 'learning'
        };
        ElMessage.success('学习路径已完成！');
      }
      
      scrollToBottom();
    } else {
      ElMessage.error(res.data?.error || '学习步骤执行失败');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '学习步骤执行失败');
  } finally {
    learningStepLoading.value = false;
  }
};

const executeAutoLearning = async () => {
  autoLearningLoading.value = true;
  try {
    const res = await adminApi.virtualSessionAutoLearning(sessionId, { maxMilestones: 10 });
    if (res.data?.success) {
      const data = res.data.data;
      ElMessage.success(`自动学习完成，共 ${data.totalSteps} 步，${data.completedMilestones} 个里程碑`);
      
      session.value = {
        ...session.value,
        status: 'completed',
        currentStage: 'learning'
      };
      
      await loadSession();
    } else {
      ElMessage.error(res.data?.error || '自动学习失败');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '自动学习失败');
  } finally {
    autoLearningLoading.value = false;
  }
};

const pollPathStatus = async () => {
  try {
    const res = await adminApi.getVirtualSessionPathStatus(sessionId);
    if (res.data?.success) {
      const data = res.data.data;
      pathStatus.value = data.status || 'idle';
      pathData.value = data.path;
      
      if (data.status === 'active' || data.status === 'ready') {
        stopPathPolling();
        ElMessage.success('学习路径生成完成');
      } else if (data.status === 'failed') {
        stopPathPolling();
        ElMessage.error('路径生成失败，可点击重试');
      }
    }
  } catch {
    // ignore poll errors
  }
};

const startPathPolling = () => {
  stopPathPolling();
  pathPollTimer = setInterval(pollPathStatus, 3000);
};

const stopPathPolling = () => {
  if (pathPollTimer) {
    clearInterval(pathPollTimer);
    pathPollTimer = null;
  }
};

watch(goalReady, (ready) => {
  if (ready && pathStatus.value === 'idle') {
    pathStatus.value = 'generating';
    startPathPolling();
  }
});

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

onMounted(async () => {
  await loadSession();
  if (session.value?.learningPathId) {
    pollPathStatus();
  }
});

onUnmounted(() => {
  stopPathPolling();
});
</script>

<style scoped>
.virtual-session-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8f9fc;
}

.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #eef0f4;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.session-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.session-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a1d26;
}

.session-tags {
  display: flex;
  gap: 6px;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.stage-progress {
  display: flex;
  align-items: center;
  gap: 0;
}

.stage-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.node-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  background: #eef0f4;
  color: #9ca3af;
  transition: all 0.3s;
}

.stage-node.done .node-icon {
  background: #10b981;
  color: #fff;
}

.stage-node.active .node-icon {
  background: #6366f1;
  color: #fff;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15);
}

.node-label {
  font-size: 12px;
  color: #9ca3af;
  font-weight: 500;
}

.stage-node.done .node-label {
  color: #10b981;
}

.stage-node.active .node-label {
  color: #6366f1;
}

.stage-line {
  width: 64px;
  height: 2px;
  background: #eef0f4;
  margin: 0 4px;
  margin-bottom: 20px;
  transition: background 0.3s;
}

.stage-line.done {
  background: #10b981;
}

.header-right {
  display: flex;
  align-items: center;
}

.stat-group {
  display: flex;
  gap: 8px;
}

.stat-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 12px;
  background: #f0f1f5;
  border-radius: 8px;
}

.stat-val {
  font-size: 18px;
  font-weight: 700;
  color: #1a1d26;
  line-height: 1.2;
}

.stat-lbl {
  font-size: 11px;
  color: #9ca3af;
}

.path-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  background: #ecfdf5;
  color: #059669;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.path-banner.generating {
  background: #fffbeb;
  color: #d97706;
}

.path-banner.failed {
  background: #fef2f2;
  color: #dc2626;
}

.learning-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.learning-banner .current-task {
  color: #6b7280;
  font-weight: 400;
  margin-left: 8px;
}

.session-body {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  gap: 0;
  min-height: 0;
  overflow: hidden;
}

.left-panel,
.right-panel {
  background: #fff;
  border-right: 1px solid #eef0f4;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.right-panel {
  border-right: none;
  border-left: 1px solid #eef0f4;
}

.panel-section {
  padding: 16px;
  border-bottom: 1px solid #f3f4f6;
}

.panel-section:last-child {
  border-bottom: none;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-header .section-title {
  margin-bottom: 0;
}

.profile-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.avatar-block {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}

.avatar-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.avatar-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1d26;
}

.profile-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  color: #4b5563;
  line-height: 1.4;
}

.field-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.field-value {
  word-break: break-word;
}

.field-value.mono {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #4b5563;
  margin-bottom: 8px;
}

.config-row:last-child {
  margin-bottom: 0;
}

.config-label {
  color: #9ca3af;
}

.config-value {
  font-weight: 500;
}

.center-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.messages-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.empty-chat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-chat p {
  font-size: 14px;
  margin: 0;
}

.chat-bubble {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  max-width: 85%;
}

.chat-bubble.user {
  flex-direction: row-reverse;
  margin-left: auto;
}

.chat-bubble.assistant {
  margin-right: auto;
}

.bubble-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  background: #f3f4f6;
}

.chat-bubble.user .bubble-avatar {
  background: #eef2ff;
}

.chat-bubble.assistant .bubble-avatar {
  background: #ecfdf5;
}

.bubble-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bubble-name {
  font-size: 11px;
  color: #9ca3af;
  font-weight: 500;
}

.chat-bubble.user .bubble-name {
  text-align: right;
}

.bubble-text {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: #1a1d26;
  word-break: break-word;
}

.chat-bubble.user .bubble-text {
  background: #6366f1;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-bubble.assistant .bubble-text {
  background: #fff;
  border: 1px solid #eef0f4;
  border-bottom-left-radius: 4px;
}

.quick-replies {
  padding: 12px 20px;
  background: #fff;
  border-top: 1px solid #eef0f4;
}

.replies-label {
  font-size: 11px;
  color: #9ca3af;
  font-weight: 500;
  display: block;
  margin-bottom: 6px;
}

.replies-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.control-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-top: 1px solid #eef0f4;
  flex-shrink: 0;
}

.control-primary {
  display: flex;
  gap: 8px;
}

.control-secondary {
  display: flex;
  gap: 8px;
}

.logs-scroll {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.empty-logs {
  text-align: center;
  color: #9ca3af;
  padding: 20px;
  font-size: 13px;
}

.log-entry {
  margin-bottom: 8px;
  border-radius: 8px;
  background: #f9fafb;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.log-entry:hover {
  background: #f3f4f6;
}

.log-entry.error {
  background: #fef2f2;
}

.log-entry.error:hover {
  background: #fee2e2;
}

.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.log-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.log-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ca3af;
  flex-shrink: 0;
}

.log-dot.virtual-reply { background: #6366f1; }
.log-dot.goal-response { background: #10b981; }
.log-dot.stage-transition { background: #f59e0b; }
.log-dot.error { background: #ef4444; }

.log-time {
  font-size: 11px;
  color: #9ca3af;
  font-family: 'SF Mono', 'Consolas', monospace;
}

.log-dur {
  font-size: 11px;
  color: #6b7280;
  font-family: 'SF Mono', 'Consolas', monospace;
}

.log-summary {
  font-size: 12px;
  color: #4b5563;
  margin-top: 4px;
  line-height: 1.4;
  padding-left: 12px;
}

.log-detail {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}

.log-detail pre {
  font-size: 11px;
  font-family: 'SF Mono', 'Consolas', monospace;
  background: #1a1d26;
  color: #e5e7eb;
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0;
  line-height: 1.5;
}

@media (max-width: 1024px) {
  .session-body {
    grid-template-columns: 1fr;
  }
  .left-panel,
  .right-panel {
    border: none;
    border-bottom: 1px solid #eef0f4;
  }
}
</style>
