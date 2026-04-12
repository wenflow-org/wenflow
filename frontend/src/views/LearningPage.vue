<template>
  <div class="learning-page" v-loading="pageLoading">
    <header class="learning-header">
      <div class="header-left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <div class="path-info" v-if="task">
          <span class="path-name" :title="task.learningPath?.name">{{ task.learningPath?.name }}</span>
          <span v-if="task.week?.weekNumber" class="week-name">阶段 {{ task.week.weekNumber }}</span>
        </div>
      </div>
      <div class="header-center">
        <h1 class="task-title" v-if="task">{{ task.title }}</h1>
      </div>
      <div class="header-right">
        <el-tag v-if="sessionPaused" type="warning" size="large" class="status-tag">
          <el-icon><VideoPause /></el-icon>
          已暂停
        </el-tag>
        <el-tag v-else-if="sessionActive" type="success" size="large" class="status-tag">
          <el-icon><VideoPlay /></el-icon>
          授课中
        </el-tag>
        <el-tag v-else type="info" size="large" class="status-tag">
          <el-icon><VideoPause /></el-icon>
          未开始
        </el-tag>
        <el-button 
          v-if="sessionPaused"
          type="success" 
          size="default"
          @click="resumeSessionFromPause"
          class="header-action-btn"
        >
          <el-icon><VideoPlay /></el-icon>
          恢复授课
        </el-button>
        <el-button 
          v-if="sessionActive && !sessionPaused"
          type="warning" 
          size="default"
          @click="pauseSession"
          class="header-action-btn"
        >
          <el-icon><VideoPause /></el-icon>
          暂停授课
        </el-button>
        <el-button 
          v-if="sessionActive && !sessionPaused"
          type="danger" 
          size="default"
          @click="endSession"
          class="header-action-btn"
        >
          <el-icon><VideoPause /></el-icon>
          结束授课
        </el-button>
      </div>
    </header>

    <div v-if="sessionInitializing" class="session-initializing">
      <el-icon class="loading-icon"><Loading /></el-icon>
      <p>正在初始化授课会话...</p>
    </div>

    <div v-if="sessionPaused" class="session-paused">
      <el-icon :size="48" color="#e6a23c"><VideoPause /></el-icon>
      <h2>授课已暂停</h2>
      <p>点击"恢复授课"按钮继续学习</p>
      <el-button type="success" @click="resumeSessionFromPause">
        <el-icon><VideoPlay /></el-icon>
        恢复授课
      </el-button>
    </div>

    <div class="learning-body" v-if="task && sessionActive && !sessionPaused">
      <main class="main-content">
        <div class="chat-shell">
          <aside v-if="knowledgePoints.length > 0" class="chat-knowledge-pane">
            <KnowledgePointList :knowledge-points="knowledgePoints" />
          </aside>

          <div class="chat-area">
          <div class="message-list" ref="messageListRef">
            <template v-for="(msg, index) in messages" :key="index">
              <div :class="['message-item', msg.role]">
                <div class="message-avatar">
                  <el-avatar
                    :size="36"
                    :style="{
                      backgroundColor: msg.role === 'user' ? '#409eff' : '#67c23a'
                    }"
                  >
                    <el-icon v-if="msg.role === 'user'"><User /></el-icon>
                    <el-icon v-else><ChatDotRound /></el-icon>
                  </el-avatar>
                </div>
                <div class="message-body">
                  <div class="message-bubble" :class="{ failed: (msg as any).failed }">
                    <MarkdownRenderer :content="msg.content" />
                    <div v-if="(msg as any).failed" class="message-error">
                      <el-icon><WarningFilled /></el-icon>
                      <span>发送失败</span>
                      <el-button text size="small" @click="retryMessage(index)">
                        <el-icon><Refresh /></el-icon>
                        重试
                      </el-button>
                    </div>
                  </div>
                  <div class="message-meta">
                    <span class="message-time">{{ formatDateTime(msg.timestamp) }}</span>
                  </div>
                  <div v-if="msg.strategies && msg.strategies.length" class="message-strategies">
                    <el-tag
                      v-for="s in msg.strategies"
                      :key="s"
                      size="small"
                      type="info"
                      effect="plain"
                    >
                      {{ strategyLabel(s) }}
                    </el-tag>
                  </div>
                  <div class="message-actions" v-if="msg.role === 'assistant' || msg.role === 'user'">
                    <el-button 
                      size="small" 
                      text 
                      @click="copyMessage(msg.content)"
                    >
                      <el-icon><CopyDocument /></el-icon>
                      复制
                    </el-button>
                  </div>
                  <KnowledgePointCard
                    v-if="msg.role === 'assistant' && index === messages.length - 1 && msg.knowledgePoint && !aiLoading"
                    :knowledge-point="msg.knowledgePoint"
                    @action="handleKnowledgeAction"
                  />
                </div>
              </div>
            </template>

            <div v-if="aiLoading" class="message-item assistant">
              <div class="message-avatar">
                <el-avatar :size="36" style="background-color: #67c23a">
                  <el-icon><ChatDotRound /></el-icon>
                </el-avatar>
              </div>
              <div class="message-body">
                <div class="message-bubble thinking">
                  <el-icon class="loading-icon"><Loading /></el-icon>
                  <span>AI 思考中...</span>
                </div>
              </div>
            </div>
          </div>

          <div class="input-area">
            <div v-if="showCompletionPrompt" class="completion-prompt">
              <div class="completion-prompt-main">
                <p class="completion-prompt-title">已达到课程完成条件</p>
                <p class="completion-prompt-desc">你可以继续追问，也可以现在结束并生成评估总结。</p>
              </div>
              <div class="completion-prompt-actions">
                <el-button size="small" @click="dismissCompletionPrompt">继续学习</el-button>
                <el-button type="success" size="small" :loading="endingSession" @click="confirmCompletionEnd">
                  结束并评估
                </el-button>
              </div>
            </div>

            <el-input
              v-model="userInput"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
              placeholder="输入你的问题或回答... (Ctrl+Enter 发送)"
              @keydown.ctrl.enter="sendMessage"
              :disabled="aiLoading"
              class="message-input"
            />
            <div class="input-actions">
              <el-button
                type="primary"
                @click="sendMessage"
                :loading="aiLoading"
                :disabled="!userInput.trim()"
              >
                <el-icon><Promotion /></el-icon>
                发送
              </el-button>
            </div>
          </div>
          </div>
        </div>

        <PeerNotification
          :visible="peerNotificationVisible"
          @click="peerChatWindowVisible = true; peerNotificationVisible = false;"
          @close="peerNotificationVisible = false"
        />

        <PeerChatWindow
          :visible="peerChatWindowVisible"
          :messages="peerChatMessages"
          @send="handlePeerChatSend"
          @close="peerChatWindowVisible = false"
        />

        <el-button
          v-if="peerChatMessages.length > 0 && !peerChatWindowVisible"
          class="peer-chat-float-btn"
          type="success"
          circle
          size="large"
          @click="peerChatWindowVisible = true"
        >
          <el-icon><ChatDotRound /></el-icon>
        </el-button>
      </main>
    </div>

    <el-dialog
      v-model="showEvaluationDialog"
      title="授课结束评估"
      width="600px"
      :close-on-click-modal="false"
    >
      <CompletionCard
        :topic="sessionInfo.topic"
        :mastered-count="knowledgePoints.filter(kp => kp.status === 'mastered').length"
        :total-count="knowledgePoints.length"
        :duration="formatTime(completionDurationSeconds || activeTime)"
        :message-count="messages.length"
        :evaluation="sessionEvaluation"
        :summary="sessionSummary || {
          topicSummary: '本节课完成了相关主题的学习。',
          knowledgeSummary: '知识点已学习完成。',
          practiceAdvice: '建议继续巩固学习。',
          learningEvaluation: '学习表现良好。'
        }"
        @action="handleCompletionAction"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft, VideoPlay, VideoPause,
  User, ChatDotRound, Promotion, Loading, WarningFilled,
  Refresh, CopyDocument
} from '@element-plus/icons-vue';
import { aiTeachingAPI } from '@/api/aiTeaching';
import type { KnowledgePointStatus } from '@/api/aiTeaching';
import api from '../utils/api';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import KnowledgePointCard from '@/components/KnowledgePointCard.vue';
import KnowledgePointList from '@/components/KnowledgePointList.vue';
import CompletionCard from '@/components/CompletionCard.vue';
import PeerNotification from '@/components/PeerNotification.vue';
import PeerChatWindow from '@/components/PeerChatWindow.vue';

const route = useRoute();
const router = useRouter();
const taskId = computed(() => route.params.taskId as string);

const pageLoading = ref(true);
const task = ref<any>(null);

const sessionInitializing = ref(false);
const sessionActive = ref(false);
const sessionPaused = ref(false);
const sessionInfo = ref({
  sessionId: '',
  subject: '',
  topic: '',
  difficulty: 5
});

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  analysis?: {
    cognitiveLevel: string;
    levelScore: number;
    understanding: string;
    confusionPoints: string[];
    engagement: string;
    emotionalState: string;
  };
  strategies?: string[];
  knowledgePoint?: string | null;
  knowledgePoints?: KnowledgePointStatus[];
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref('');
const aiLoading = ref(false);
const messageListRef = ref<HTMLElement | null>(null);

const knowledgePoints = ref<KnowledgePointStatus[]>([]);
const showCompletionPrompt = ref(false);
const completionDurationSeconds = ref(0);

const peerNotificationVisible = ref(false);
const peerChatWindowVisible = ref(false);
const peerChatMessages = ref<Array<{ role: string; content: string; timestamp: string }>>([]);

const elapsedTime = ref(0);
const activeTime = ref(0);
let timerInterval: number | null = null;
let lastActivityTime = ref(Date.now());

const lastSessionEvaluation = ref<{
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  messageCount: number;
  avgUnderstanding: number;
  duration: number;
} | null>(null);

const showEvaluationDialog = ref(false);
const endingSession = ref(false);
const sessionEvaluation = ref({
  lss: 0,
  ktl: 0,
  lf: 0,
  lsb: 0,
  messageCount: 0,
  avgUnderstanding: 0,
  duration: 0
});

const sessionSummary = ref<{
  topicSummary: string;
  knowledgeSummary: string;
  practiceAdvice: string;
  learningEvaluation: string;
} | null>(null);

const allKnowledgePointsMastered = computed(() => {
  return knowledgePoints.value.length > 0
    && knowledgePoints.value.every((kp) => kp.status === 'mastered');
});

const STRATEGY_LABELS: Record<string, string> = {
  'socratic-questioning': '苏格拉底式引导',
  'analogy': '类比隐喻',
  'example': '举例说明',
  'decomposition': '脚手架拆解',
  'visualization': '双重编码',
  'storytelling': '情境导入',
  'challenge': '挑战提问',
  'reflection': '元认知追问',
  'scaffolding': '支架式教学',
  'direct-instruction': '直接讲解',
  'empathy-first': '共情优先',
  'quick-win': '快速成功',
  'backtrack': '回溯基础',
  'ice-breaker': '破冰',
  'encourage-try': '鼓励尝试',
  'predict-first': '先预测',
};

const strategyLabel = (id: string) => {
  return STRATEGY_LABELS[id] || id;
};

const copyMessage = async (content: string) => {
  try {
    await navigator.clipboard.writeText(content);
    ElMessage.success('已复制到剪贴板');
  } catch (error) {
    ElMessage.error('复制失败');
  }
};

const loadTaskData = async () => {
  if (!taskId.value) return;
  
  pageLoading.value = true;
  try {
    const response = await api.get(`/learning/tasks/${taskId.value}`);
    task.value = response.data || response;
    
    if (task.value?.week?.learningObjectives) {
      const objectives = task.value.week.learningObjectives;
      if (typeof objectives === 'string') {
        try {
          task.value.week.learningObjectives = JSON.parse(objectives);
        } catch (e) {
          task.value.week.learningObjectives = [objectives];
        }
      }
    }
  } catch (error: any) {
    ElMessage.error('加载任务失败');
    console.error(error);
  } finally {
    pageLoading.value = false;
  }
};

const startSession = async () => {
  if (!task.value) return;
  
  sessionInitializing.value = true;
  
  try {
    const subject = task.value.learningPath?.subject || '综合';
    const topic = task.value.title;
    const difficulty = 5;
    
    const session = await aiTeachingAPI.startSession(
      subject,
      topic,
      difficulty,
      task.value.id
    );
    
    sessionInfo.value = {
      sessionId: session.sessionId,
      subject: session.subject,
      topic: session.topic,
      difficulty
    };
    
    sessionActive.value = true;
    sessionInitializing.value = false;
    
    messages.value = [];
    knowledgePoints.value = [];
    peerChatMessages.value = [];
    lastSessionEvaluation.value = null;
    sessionSummary.value = null;
    showCompletionPrompt.value = false;
    completionDurationSeconds.value = 0;
    peerNotificationVisible.value = false;
    peerChatWindowVisible.value = false;
    elapsedTime.value = 0;
    activeTime.value = 0;
    
    messages.value.push({
      role: 'assistant',
      content: session.welcomeMessage,
      timestamp: new Date().toISOString()
    });
    
    startTimer();
    ElMessage.success('授课会话已开始');
  } catch (error: any) {
    sessionInitializing.value = false;
    ElMessage.error(error.message || '开始会话失败');
  }
};

const sendMessage = async () => {
  const text = userInput.value.trim();
  if (!text || aiLoading.value || !sessionInfo.value.sessionId) return;

  showCompletionPrompt.value = false;
  
  lastActivityTime.value = Date.now();
  
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: new Date().toISOString()
  });
  
  userInput.value = '';
  aiLoading.value = true;
  
  scrollToBottom();
  
  try {
    const result = await aiTeachingAPI.sendMessage(
      sessionInfo.value.sessionId,
      text
    );
    
    messages.value.push({
      role: 'assistant',
      content: result.aiResponse,
      timestamp: new Date().toISOString(),
      analysis: result.analysis,
      strategies: result.strategies || [],
      knowledgePoint: result.knowledgePoint,
      knowledgePoints: result.knowledgePoints,
    });
    
    if (result.knowledgePoints && result.knowledgePoints.length > 0) {
      knowledgePoints.value = result.knowledgePoints;
    }
    
    if (result.isCompletion && !endingSession.value) {
      if (allKnowledgePointsMastered.value) {
        showCompletionPrompt.value = true;
        ElMessage.success('🎉 已完成本节课程目标，可选择结束并生成评估');
      } else {
        ElMessage.info('检测到完成信号，但还有知识点未完全掌握，可继续学习');
      }
    }
    
    if (result.peerTriggered) {
      if (result.peerMessage) {
        peerChatMessages.value.push({
          role: 'peer',
          content: result.peerMessage,
          timestamp: new Date().toISOString(),
        });
      }
      nextTick(() => {
        peerNotificationVisible.value = true;
      });
    }
    
    scrollToBottom();
  } catch (error: any) {
    ElMessage.error(error.message || '发送消息失败');
    if (messages.value.length > 0) {
      const lastMsg = messages.value[messages.value.length - 1];
      if (lastMsg.role === 'user') {
        (lastMsg as any).failed = true;
      }
    }
  } finally {
    aiLoading.value = false;
  }
};

const retryMessage = async (index: number) => {
  const msg = messages.value[index];
  if (!msg || msg.role !== 'user') return;
  
  messages.value.splice(index, 1);
  userInput.value = msg.content;
  sendMessage();
};

const handleKnowledgeAction = async (action: 'mastered' | 'need-more') => {
  lastActivityTime.value = Date.now();
  const actionMessages: Record<string, string> = {
    'mastered': '这个知识点我掌握了，继续下一个。',
    'need-more': '这个知识点我没完全理解，能用另一种方式再讲一遍吗？'
  };
  
  userInput.value = actionMessages[action];
  sendMessage();
};

const handlePeerChatSend = async (text: string) => {
  if (!sessionInfo.value.sessionId) return;
  
  peerChatMessages.value.push({
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  });
  
  try {
    const result = await aiTeachingAPI.sendPeerMessage(sessionInfo.value.sessionId, text);
    peerChatMessages.value.push({
      role: 'peer',
      content: result.peerResponse,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    ElMessage.error(error.message || '同伴消息发送失败');
    peerChatMessages.value.pop();
  }
};

const handleCompletionAction = (action: 'end') => {
  if (action === 'end') {
    closeEvaluationAndReturn();
  }
};

const dismissCompletionPrompt = () => {
  showCompletionPrompt.value = false;
};

const confirmCompletionEnd = async () => {
  await endSession({
    skipConfirm: true,
    silentSuccess: true,
  });
};

const pauseSession = () => {
  if (!sessionActive.value || sessionPaused.value) return;
  
  sessionPaused.value = true;
  stopTimer();
  
  ElMessage.info('授课已暂停，可随时恢复');
};

const resumeSessionFromPause = () => {
  if (!sessionPaused.value) return;
  
  sessionPaused.value = false;
  startTimer();
  
  ElMessage.success('授课已恢复');
};

const endSession = async (options?: {
  skipConfirm?: boolean;
  silentSuccess?: boolean;
  skipEvaluationDialog?: boolean;
  redirectAfterEnd?: boolean;
}) => {
  if (endingSession.value || !sessionInfo.value.sessionId) {
    return;
  }

  try {
    if (!options?.skipConfirm) {
      await ElMessageBox.confirm(
        '确定要结束当前授课会话吗？',
        '结束授课',
        {
          confirmButtonText: '确定结束',
          cancelButtonText: '继续授课',
          type: 'warning'
        }
      );
    }

    endingSession.value = true;
    
    const result = await aiTeachingAPI.endSession(sessionInfo.value.sessionId);
    showCompletionPrompt.value = false;
    
    sessionActive.value = false;
    sessionPaused.value = false;
    stopTimer();
    
    messages.value.push({
      role: 'assistant',
      content: '授课会话已结束。感谢你的学习！',
      timestamp: new Date().toISOString()
    });
    
    if (result.summary) {
      sessionSummary.value = result.summary;
    }

    const evaluationDurationMinutes = result.evaluation?.duration ?? result.duration;
    completionDurationSeconds.value = typeof evaluationDurationMinutes === 'number'
      ? evaluationDurationMinutes * 60
      : activeTime.value;

    if (result.evaluation) {
      lastSessionEvaluation.value = {
        lss: result.evaluation.lss || 0,
        ktl: result.evaluation.ktl || 0,
        lf: result.evaluation.lf || 0,
        lsb: result.evaluation.lsb || 0,
        messageCount: result.evaluation.messageCount || messages.value.length,
        avgUnderstanding: result.evaluation.avgUnderstanding || 0,
        duration: result.evaluation.duration || activeTime.value,
      };
      
      sessionEvaluation.value = {
        lss: result.evaluation.lss || 0,
        ktl: result.evaluation.ktl || 0,
        lf: result.evaluation.lf || 0,
        lsb: result.evaluation.lsb || 0,
        messageCount: result.evaluation.messageCount || messages.value.length,
        avgUnderstanding: result.evaluation.avgUnderstanding || 0,
        duration: result.evaluation.duration || activeTime.value,
      };
    }

    if (!options?.skipEvaluationDialog) {
      showEvaluationDialog.value = true;
    }
    
    const actualMinutes = Math.ceil(activeTime.value / 60);
    await api.post(`/learning/tasks/${taskId.value}/complete`, {
      actualMinutes
    });
    
    if (options?.redirectAfterEnd) {
      closeEvaluationAndReturn();
    }

    if (!options?.silentSuccess) {
      ElMessage.success('会话已结束');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '结束会话失败');
    }
  } finally {
    endingSession.value = false;
  }
};

const closeEvaluationAndReturn = () => {
  showEvaluationDialog.value = false;
  if (task.value?.learningPath?.id) {
    router.push(`/learning-path/${task.value.learningPath.id}`);
  } else {
    router.push('/dashboard');
  }
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
};

const startTimer = () => {
  lastActivityTime.value = Date.now();
  timerInterval = window.setInterval(() => {
    elapsedTime.value++;
    const idleSeconds = Math.floor((Date.now() - lastActivityTime.value) / 1000);
    if (idleSeconds < 30) {
      activeTime.value++;
    }
  }, 1000);
};

const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
};

const formatTime = (seconds: number | string) => {
  const s = typeof seconds === 'string' ? parseInt(seconds) : seconds;
  if (isNaN(s)) return '00:00';
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatDateTime = (iso: string) => {
  if (!iso) return '--';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const goBack = () => {
  if (sessionPaused.value) {
    // 暂停状态：直接结束并返回，不显示确认和评估弹窗
    endSession({
      skipConfirm: true,
      silentSuccess: true,
      skipEvaluationDialog: true,
      redirectAfterEnd: true,
    });
  } else if (sessionActive.value) {
    // 授课中：需要确认
    ElMessageBox.confirm(
      '授课会话正在进行中，确定要返回吗？',
      '确认返回',
      {
        confirmButtonText: '结束并返回',
        cancelButtonText: '继续授课',
        type: 'warning'
      }
    ).then(() => {
      endSession({
        silentSuccess: true,
        skipEvaluationDialog: true,
        redirectAfterEnd: true,
      });
    }).catch(() => {});
  } else {
    // 未开始/已结束：直接返回
    if (task.value?.learningPath?.id) {
      router.push(`/learning-path/${task.value.learningPath.id}`);
    } else {
      router.push('/dashboard');
    }
  }
};

const resumeSession = async (sessionId: string) => {
  sessionInitializing.value = true;
  
  try {
    const detail = await aiTeachingAPI.getSessionDetail(sessionId);
    if (!detail) {
      ElMessage.error('获取会话详情失败');
      sessionInitializing.value = false;
      return;
    }
    
    sessionInfo.value = {
      sessionId: detail.id,
      subject: detail.subject,
      topic: detail.topic,
      difficulty: 5
    };
    
    messages.value = detail.messages.map((m: any) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      analysis: m.analysis
    }));

    knowledgePoints.value = Array.isArray(detail.knowledgePoints) ? detail.knowledgePoints : [];
    showCompletionPrompt.value = false;
    completionDurationSeconds.value = 0;
    
    if (detail.state) {
      lastSessionEvaluation.value = {
        lss: detail.state.lss || 0,
        ktl: detail.state.ktl || 0,
        lf: detail.state.lf || 0,
        lsb: detail.state.lsb || 0,
        messageCount: detail.messages.length,
        avgUnderstanding: 0.5,
        duration: detail.duration || 0
      };
    }
    
    sessionActive.value = true;
    sessionInitializing.value = false;
    startTimer();
    
    ElMessage.success('已恢复上次未完成的授课');
  } catch (error: any) {
    sessionInitializing.value = false;
    ElMessage.error(error.message || '恢复会话失败');
  }
};

const checkActiveSession = async (): Promise<boolean> => {
  try {
    const activeSessions = await aiTeachingAPI.getActiveSessions(taskId.value);
    
    if (activeSessions && activeSessions.length > 0) {
      const latest = activeSessions[0];
      await resumeSession(latest.sessionId);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('检查活跃会话失败:', error);
    return false;
  }
};

onMounted(async () => {
  await loadTaskData();
  if (task.value) {
    const resumed = await checkActiveSession();
    if (!resumed) {
      startSession();
    }
  }
});

onUnmounted(() => {
  stopTimer();
});
</script>

<style scoped>
.learning-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background:
    radial-gradient(circle at 8% 10%, color-mix(in srgb, var(--color-primary-light) 14%, transparent), transparent 36%),
    radial-gradient(circle at 92% 0%, color-mix(in srgb, var(--color-accent-light) 18%, transparent), transparent 34%),
    var(--bg-body);
}

.session-initializing {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
  color: var(--text-muted);
  transition: color var(--transition-normal);
}

.session-initializing .loading-icon {
  font-size: 32px;
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.session-paused {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 24px;
  color: var(--color-accent-dark);
}

.session-paused h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.session-paused p {
  margin: 0;
  font-size: 14px;
  color: var(--text-muted);
}

.learning-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 64px;
  padding: 8px 20px;
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  border-bottom: 1px solid var(--border-default);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(8px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.path-info {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
}

.path-name {
  font-weight: 500;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.week-name {
  color: var(--color-primary-dark);
  background: color-mix(in srgb, var(--color-primary-light) 20%, transparent);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.header-center {
  flex: 1;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 0 20px;
}

.task-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.25;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.header-action-btn {
  margin-left: 4px;
}

.status-tag {
  white-space: nowrap;
}

.status-tag :deep(.el-tag__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
}

.status-tag :deep(.el-icon) {
  font-size: 14px;
  display: inline-flex;
  align-items: center;
}

@media (max-width: 1100px) {
  .learning-header {
    padding: 8px 12px;
    min-height: 60px;
  }

  .path-info {
    display: none;
  }

  .task-title {
    font-size: 15px;
  }

  .header-center {
    padding: 0 10px;
  }
}

.learning-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  gap: 0;
  padding: 0;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background-color: var(--bg-surface);
  overflow: hidden;
  position: relative;
}

.chat-shell {
  flex: 1;
  min-height: 0;
  width: min(1440px, 100%);
  margin: 0 auto;
  display: flex;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-elevated) 96%, var(--color-primary-light) 4%);
  border-left: 1px solid var(--border-default);
  border-right: 1px solid var(--border-default);
  box-shadow: var(--shadow-sm);
}

.chat-knowledge-pane {
  width: clamp(220px, 24vw, 300px);
  min-width: 220px;
  max-width: 320px;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 12px;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border-default);
}

.knowledge-empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}

.knowledge-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.knowledge-empty-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.session-info-card,
.state-card,
.intervention-card,
.actions-card {
  flex-shrink: 0;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
  transition: border-color var(--transition-normal);
}

.info-label {
  font-size: 13px;
  color: var(--text-muted);
  transition: color var(--transition-normal);
}

.info-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  transition: color var(--transition-normal);
}

.info-value-topic {
  display: block;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
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
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-secondary);
  transition: color var(--transition-normal);
}

.state-value {
  font-weight: 600;
  color: var(--text-primary);
  transition: color var(--transition-normal);
}

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-surface) 92%, var(--bg-muted) 8%);
}

.message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.message-item.user {
  flex-direction: row-reverse;
}

.message-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 75%;
}

.message-item.user .message-body {
  align-items: flex-end;
}

.message-bubble {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.6;
  font-size: 14px;
}

.message-bubble.failed {
  border: 1px solid var(--color-warning-border);
  background-color: var(--color-warning-bg);
}

.message-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--color-warning);
  color: var(--color-warning);
  font-size: 12px;
}

.message-error .el-button {
  color: var(--color-warning);
  margin-left: 8px;
}

.message-error .el-button:hover {
  color: var(--color-warning-dark);
}

.message-item.assistant .message-bubble {
  background: color-mix(in srgb, var(--bg-subtle) 94%, var(--color-primary-light) 6%);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  border: 1px solid var(--border-default);
}

.message-item.user .message-bubble {
  background: color-mix(in srgb, var(--color-primary) 84%, white 16%);
  color: var(--text-on-primary);
  border-bottom-right-radius: 4px;
}

.message-bubble.thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}

.loading-icon {
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.message-bubble :deep(p) {
  margin: 0 0 8px 0;
}

.message-bubble :deep(p:last-child) {
  margin-bottom: 0;
}

.message-meta {
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  gap: 12px;
}

.message-strategies {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.message-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.input-area {
  border-top: 1px solid color-mix(in srgb, var(--border-default) 70%, var(--color-primary-light) 30%);
  padding: 16px;
  background: color-mix(in srgb, var(--bg-elevated) 90%, var(--bg-muted) 10%);
}

.completion-prompt {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--color-success) 35%, var(--border-default) 65%);
  background: color-mix(in srgb, var(--color-success-bg) 55%, var(--bg-surface) 45%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.completion-prompt-main {
  min-width: 0;
}

.completion-prompt-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.completion-prompt-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
}

.completion-prompt-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.message-input {
  margin-bottom: 12px;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
}

.analysis-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.confusion-points {
  margin-top: 8px;
  padding: 8px;
  background-color: #fef0f0;
  border-radius: 4px;
}

.confusion-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #f56c6c;
  margin-bottom: 8px;
}

.confusion-points ul {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  color: #606266;
}

.intervention-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.intervention-type {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.intervention-reasoning {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-btn {
  width: 100%;
}

.peer-chat-float-btn {
  position: fixed;
  bottom: 100px;
  right: 28px;
  box-shadow: var(--shadow-md);
  z-index: 9997;
  transition: all 0.3s ease;
}

.peer-chat-float-btn:hover {
  transform: scale(1.1);
  box-shadow: var(--shadow-lg);
}

.chat-knowledge-pane::-webkit-scrollbar,
.message-list::-webkit-scrollbar {
  width: 6px;
}

.chat-knowledge-pane::-webkit-scrollbar-track,
.message-list::-webkit-scrollbar-track {
  background: var(--bg-muted);
}

.chat-knowledge-pane::-webkit-scrollbar-thumb,
.message-list::-webkit-scrollbar-thumb {
  background: var(--border-dark);
  border-radius: 3px;
}

.chat-knowledge-pane::-webkit-scrollbar-thumb:hover,
.message-list::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

@media (max-width: 1100px) {
  .chat-shell {
    width: 100%;
    border-left: none;
    border-right: none;
    box-shadow: none;
  }

  .chat-knowledge-pane {
    width: 190px;
    min-width: 190px;
    padding: 10px 8px;
  }

  .completion-prompt {
    flex-direction: column;
    align-items: flex-start;
  }

  .completion-prompt-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
