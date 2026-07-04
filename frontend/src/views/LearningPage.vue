<template>
  <div class="learning-page" v-loading="pageLoading">

    <div v-if="sessionInitializing" class="session-initializing">
      <el-icon class="loading-icon"><Loading /></el-icon>
      <p>{{ sessionInitMessage }}</p>
    </div>

    <div v-else-if="task && task.learningPath?.canStartLearning === false" class="session-paused blocked-state">
      <el-icon :size="48" color="#e6a23c"><WarningFilled /></el-icon>
      <h2>等待阶段任务生成完成</h2>
      <p>{{ task.learningPath?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习。' }}</p>
      <el-button type="primary" @click="goBack">返回路径详情</el-button>
    </div>

    <div v-else-if="sessionPaused" class="session-paused">
      <el-icon :size="48" color="#e6a23c"><VideoPause /></el-icon>
      <h2>授课已暂停</h2>
      <p>点击"恢复授课"按钮继续学习</p>
      <el-button type="success" @click="resumeSessionFromPause">
        <el-icon><VideoPlay /></el-icon> 恢复授课
      </el-button>
    </div>

    <template v-else-if="task">
      <section class="learning-header-card">
        <div class="learning-header-card__top">
          <div class="learning-header-card__title">
            <span class="pill">当前任务</span>
            <h1>{{ task.title }}</h1>
            <p v-if="task.learningPath?.name" class="learning-header-card__path">{{ task.learningPath.name }}</p>
          </div>
          <div class="learning-header-card__controls">
            <span v-if="sessionActive" class="learning-header-card__status">学习执行中</span>
            <el-dropdown
              v-if="sessionActive"
              trigger="click"
              @command="handleSessionCommand"
            >
              <el-button class="learning-header-card__more-btn" circle>
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="pause">
                    <el-icon><VideoPause /></el-icon> 暂停并离开
                  </el-dropdown-item>
                  <el-dropdown-item command="reset" divided>
                    <el-icon><Refresh /></el-icon> 重新开始
                  </el-dropdown-item>
                  <el-dropdown-item command="end" divided class="danger-item">
                    <el-icon><WarningFilled /></el-icon> 结束课程
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>

        <div v-if="task.week?.weekNumber" class="learning-header-card__meta">
          <span>阶段 {{ task.week.weekNumber }}</span>
        </div>
      </section>

      <div class="learning-layout-shell">
      <section class="learning-layout" :class="{ 'learning-layout--no-sidebar': knowledgePoints.length === 0 }">
        <aside v-if="knowledgePoints.length > 0" class="learning-sidebar">
          <div class="learning-sidebar__progress">
            <div class="learning-sidebar__head">
              <strong>本节学习进度</strong>
            </div>
            <div class="learning-sidebar__progress-bar">
              <div class="learning-sidebar__progress-fill" :style="{ width: kpProgressPercent + '%' }"></div>
            </div>
            <div class="learning-sidebar__progress-meta">
              <span>{{ kpMasteredCount }} / {{ knowledgePoints.length }} 知识点已掌握</span>
              <strong v-if="kpCurrentFocus">当前焦点：{{ kpCurrentFocus }}</strong>
            </div>
          </div>

          <div class="learning-sidebar__nav">
            <article
              v-for="(kp, idx) in knowledgePoints"
              :key="kp.name"
              class="learning-kp"
              :class="[`learning-kp--${kp.status}`, { 'learning-kp--current': idx === kpCurrentIndex }]"
            >
              <div class="learning-kp__head">
                <span class="learning-kp__order">{{ idx + 1 }}</span>
                <div class="learning-kp__title-group">
                  <strong>{{ kp.name }}</strong>
                </div>
                <span class="learning-kp__state">{{ kpStatusLabel(kp.status) }}</span>
              </div>
              <div class="learning-kp__bar">
                <div class="learning-kp__fill" :style="{ width: (kp.progress || 0) + '%' }"></div>
              </div>
            </article>
          </div>
        </aside>

        <div class="learning-main">
          <div class="learning-messages" ref="messageListRef">
            <template v-for="(msg, index) in messages" :key="index">
              <article class="learning-msg" :class="`learning-msg--${msg.role}`">
                <span class="learning-msg__role">{{ msg.role === 'user' ? '你' : 'AI' }}</span>
                <div class="learning-msg__body">
                  <MarkdownRenderer :content="msg.content" />
                  <div v-if="(msg as any).failed" class="message-error">
                    <el-icon><WarningFilled /></el-icon>
                    <span>发送失败</span>
                    <el-button text size="small" @click="retryMessage(index)">
                      <el-icon><Refresh /></el-icon> 重试
                    </el-button>
                  </div>
                </div>
                <div v-if="msg.role === 'assistant' || msg.role === 'user'" class="learning-msg__actions">
                  <el-button size="small" text @click="copyMessage(msg.content)">
                    <el-icon><CopyDocument /></el-icon> 复制
                  </el-button>
                </div>
                <div v-if="msg.quickReplies && msg.quickReplies.length && !msg.quickRepliesUsed && index === 0" class="quick-replies">
                  <div
                    v-for="reply in msg.quickReplies"
                    :key="reply.text"
                    class="quick-reply-card"
                    @click="useOpeningQuickReply(reply.text, index)"
                  >
                    <span class="reply-text">{{ reply.text }}</span>
                  </div>
                </div>
                <KnowledgePointCard
                  v-if="msg.role === 'assistant' && index === messages.length - 1 && msg.knowledgePoint && !aiLoading"
                  :knowledge-point="msg.knowledgePoint"
                  @action="handleKnowledgeAction"
                />
              </article>
            </template>

            <article v-if="aiLoading" class="learning-msg learning-msg--assistant">
              <span class="learning-msg__role">AI</span>
              <div class="learning-msg__body learning-msg__body--thinking">
                <TypingIndicator variant="minimal" label="思考中" />
              </div>
            </article>
          </div>

          <div class="learning-bottom">
            <CheckpointCard
              v-if="activeCheckpoint"
              ref="checkpointRef"
              :checkpoint="activeCheckpoint"
              :submitting="checkpointSubmitting"
              @submit="handleCheckpointSubmit"
              @skip="handleCheckpointSkip"
              @continue="handleCheckpointContinue"
              @review="handleCheckpointReview"
              @retry="handleCheckpointRetry"
            />

            <div v-if="showCompletionPrompt" class="learning-completion">
              <div class="learning-completion__copy">
                <strong>{{ completionPromptTitle }}</strong>
                <p>{{ completionPromptDescription }}</p>
              </div>
              <div class="learning-completion__actions">
                <el-button size="small" @click="dismissCompletionPrompt">继续学习</el-button>
                <el-button type="success" size="small" :loading="endingSession" @click="confirmCompletionEnd">结束当前任务并评估</el-button>
              </div>
            </div>

            <div ref="composerRef" class="learning-composer">
              <div class="learning-composer__field">
                <el-input
                  v-model="userInput"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 4 }"
                  placeholder="输入你的想法… (Ctrl+Enter 发送)"
                  @keydown.ctrl.enter="sendMessage"
                  :disabled="aiLoading"
                />
                <span
                  v-if="userInput.length >= 80"
                  class="learning-composer__counter"
                  :class="{ 'learning-composer__counter--warn': userInput.length > 800 }"
                >
                  {{ userInput.length }}{{ userInput.length > 800 ? ' / 建议 800 字内' : '' }}
                </span>
              </div>
              <el-button
                type="primary"
                @click="sendMessage"
                :loading="aiLoading"
                :disabled="!userInput.trim()"
              >发送</el-button>
            </div>
          </div>
        </div>
      </section>
      </div>

      <PeerNotification
        :visible="peerNotificationVisible"
        @click="openPeerChatFromNotification"
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
    </template>

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
        :wrapup="sessionWrapup"
        :advisory="sessionAdvisory"
        @action="handleCompletionAction"
        @advisory-action="handleWrapupAdvisoryAction"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import {
  aiTeachingAPI,
  type Checkpoint,
  type CheckpointSubmitPayload,
  type CheckpointSubmitResult,
  type KnowledgePointStatus,
  type ReplanAdvisory,
  type WrapupArtifact
} from '@/api/aiTeaching';
import { adminApi } from '@/api/adminApi';
import api from '../utils/api';
import { API_BASE_URL } from '../utils/api';
import CheckpointCard from '@/components/learning/CheckpointCard.vue';
import {
  VideoPlay, VideoPause,
  ChatDotRound, Loading, WarningFilled,
  Refresh, CopyDocument, MoreFilled
} from '@element-plus/icons-vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import KnowledgePointCard from '@/components/KnowledgePointCard.vue';
import TypingIndicator from '@/components/TypingIndicator.vue';
import CompletionCard from '@/components/CompletionCard.vue';
import PeerNotification from '@/components/PeerNotification.vue';
import PeerChatWindow from '@/components/PeerChatWindow.vue';

const route = useRoute();
const router = useRouter();
const taskId = computed(() => route.params.taskId as string);
const virtualSessionId = computed(() => typeof route.query.virtualSessionId === 'string' ? route.query.virtualSessionId.trim() : '');
const viewMode = computed(() => typeof route.query.viewMode === 'string' ? route.query.viewMode.trim() : '');

const isTestMode = computed(() => route.meta.isTestMode === true);
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
const isVirtualSessionView = computed(() => !!virtualSessionId.value);
const isAdminVirtualSessionView = computed(() => isAdminRoute.value && isVirtualSessionView.value);
const dashboardPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/dashboard' : '/dashboard';
  }
  return '/dashboard';
});
const learningPathDetailBasePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-path' : '/learning-path';
  }
  return '/learning-path';
});
const learningEvaluationBasePath = computed(() => {
  if (isTestMode.value && isAdminRoute.value) {
    return '/admin/test/learn';
  }
  return '/learn';
});

const pageLoading = ref(true);
const task = ref<any>(null);
const virtualContext = ref<any>(null);
const effectiveTaskId = computed(() => String(virtualContext.value?.bindings?.currentTaskId || taskId.value || ''));

const sessionInitializing = ref(false);
const sessionInitMode = ref<'new' | 'resumed'>('new');
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
  quickReplies?: Array<{ text: string }>;
  quickRepliesUsed?: boolean;
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
  promptDebug?: any;
  peerTriggered?: boolean;
  peerMessage?: string | null;
  peerDebug?: any;
}

type PeerChatMessage = {
  role: 'user' | 'peer';
  content: string;
  timestamp: string;
};

type MessageResultWithRecovery = Awaited<ReturnType<typeof aiTeachingAPI.sendMessage>> & {
  recovered?: boolean;
};

type CompletionPromptReason = 'completion-candidate' | 'learner-requested-end' | null;

const messages = ref<ChatMessage[]>([]);
const userInput = ref('');
const aiLoading = ref(false);
const messageListRef = ref<HTMLElement | null>(null);
const composerRef = ref<HTMLElement | null>(null);
const checkpointRef = ref<InstanceType<typeof CheckpointCard> | null>(null);
const activeCheckpoint = ref<Checkpoint | null>(null);
const checkpointSubmitting = ref(false);

const knowledgePoints = ref<KnowledgePointStatus[]>([]);
const showCompletionPrompt = ref(false);
const completionPromptReason = ref<CompletionPromptReason>(null);
const completionDurationSeconds = ref(0);

const peerNotificationVisible = ref(false);
const peerChatWindowVisible = ref(false);
const peerChatMessages = ref<PeerChatMessage[]>([]);
const peerInitializing = ref(false);

const elapsedTime = ref(0);
const activeTime = ref(0);
let timerInterval: number | null = null;
let lastActivityTime = ref(Date.now());

const showEvaluationDialog = ref(false);
const endingSession = ref(false);
const sessionWrapup = ref<WrapupArtifact>({
  status: 'summary-only',
  sources: {
    summary: 'fallback',
    evaluation: 'failed',
  },
  summary: {
    topicSummary: '本节课完成了相关主题的学习。',
    knowledgeSummary: '知识点已学习完成。',
    practiceAdvice: '建议继续巩固学习。',
    learningEvaluation: '学习表现良好。',
    knowledgeItems: [],
    keyTakeaways: [],
    actionPlan: [],
    evaluationHighlights: {
      strengths: [],
      improvements: [],
    },
    metricInterpretation: {
      session: '本节表现反映本次课堂的即时投入和产出。',
      longTerm: '长期状态来自历史累计，不等于单节课程成绩。',
    },
    summaryVersion: 'v2',
  },
  evaluation: null,
  progress: {
    newlyMastered: [],
    movedToReview: [],
    stillLearning: [],
    unchangedMastered: [],
  },
  evidence: {
    turnCount: 0,
    avgUnderstanding: null,
    avgEngagement: null,
    dominantCognitiveLevel: null,
    lastCognitiveLevel: null,
    topConfusionPoints: [],
    emotionalSignals: {
      positive: 0,
      neutral: 0,
      frustrated: 0,
      confused: 0,
    },
    completionCandidateSeen: false,
  },
});
const sessionAdvisory = ref<ReplanAdvisory | null>(null);
const autoPausing = ref(false);

const sessionInitMessage = computed(() => sessionInitMode.value === 'resumed'
  ? '正在恢复上次授课进度...'
  : '正在初始化授课会话...');

const completionPromptTitle = computed(() => completionPromptReason.value === 'learner-requested-end'
  ? '已收到结束当前任务课堂的请求'
  : '当前任务已达到可收束状态');

const completionPromptDescription = computed(() => completionPromptReason.value === 'learner-requested-end'
  ? '确认后将结束当前 task 的当次课堂并进入评价页面；这不代表整个 Learn 阶段已经结束。'
  : '本轮教学判断当前 task 已满足收束条件。你可以继续巩固，也可以确认结束当前 task 的当次课堂并进入评价页面。');

const kpMasteredCount = computed(() => knowledgePoints.value.filter(kp => kp.status === 'mastered').length);
const kpProgressPercent = computed(() => {
  if (!knowledgePoints.value.length) return 0;
  return Math.round((kpMasteredCount.value / knowledgePoints.value.length) * 100);
});
const kpCurrentIndex = computed(() => {
  const idx = knowledgePoints.value.findIndex(kp => kp.status === 'learning');
  return idx >= 0 ? idx : 0;
});
const kpCurrentFocus = computed(() => knowledgePoints.value[kpCurrentIndex.value]?.name || '');
const kpStatusLabel = (status: string) => {
  const map: Record<string, string> = { mastered: '已掌握', learning: '学习中', pending: '待学习', review: '待复习' };
  return map[status] || status;
};

const buildRouteQuery = (extra: Record<string, string> = {}) => {
  const query: Record<string, string> = {};
  if (virtualSessionId.value) query.virtualSessionId = virtualSessionId.value;
  if (viewMode.value) query.viewMode = viewMode.value;
  return { ...query, ...extra };
};

const copyMessage = async (content: string) => {
  try {
    await navigator.clipboard.writeText(content);
    toast.success('已复制到剪贴板');
  } catch (error) {
    toast.error('复制失败');
  }
};

const loadVirtualContext = async () => {
  if (!virtualSessionId.value) {
    virtualContext.value = null;
    return;
  }

  const response = await adminApi.getVirtualSessionContext(virtualSessionId.value);
  if (!response.data?.success) {
    throw new Error(response.data?.error || '加载虚拟会话上下文失败');
  }

  virtualContext.value = response.data.data;
};

const loadTaskData = async () => {
  if (!taskId.value && !virtualSessionId.value) return;
  
  pageLoading.value = true;
  try {
    if (isVirtualSessionView.value) {
      await loadVirtualContext();
    }

    if (!effectiveTaskId.value) {
      throw new Error('当前虚拟 session 还没有绑定学习任务');
    }

    if (isAdminVirtualSessionView.value) {
      const response = await adminApi.getVirtualSessionLearningTask(virtualSessionId.value);
      if (!response.data?.success) {
        throw new Error(response.data?.error || '加载虚拟学习任务失败');
      }
      task.value = response.data.data;
    } else {
      const response = await api.get(`/learning/tasks/${effectiveTaskId.value}`);
      task.value = response.data || response;
    }
    
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
    toast.error(error.message || '加载任务失败');
    console.error(error);
  } finally {
    pageLoading.value = false;
  }
};

const resetSessionState = () => {
  stopTimer();
  messages.value = [];
  knowledgePoints.value = [];
  activeCheckpoint.value = null;
  showCompletionPrompt.value = false;
  completionPromptReason.value = null;
  completionDurationSeconds.value = 0;
  sessionWrapup.value = {
    status: 'summary-only',
    sources: {
      summary: 'fallback',
      evaluation: 'failed',
    },
    summary: {
      topicSummary: '本节课完成了相关主题的学习。',
      knowledgeSummary: '知识点已学习完成。',
      practiceAdvice: '建议继续巩固学习。',
      learningEvaluation: '学习表现良好。',
      knowledgeItems: [],
      keyTakeaways: [],
      actionPlan: [],
      evaluationHighlights: {
        strengths: [],
        improvements: [],
      },
      metricInterpretation: {
        session: '本节表现反映本次课堂的即时投入和产出。',
        longTerm: '长期状态来自历史累计，不等于单节课程成绩。',
      },
      summaryVersion: 'v2',
    },
    evaluation: null,
    progress: {
      newlyMastered: [],
      movedToReview: [],
      stillLearning: [],
      unchangedMastered: [],
    },
    evidence: {
      turnCount: 0,
      avgUnderstanding: null,
      avgEngagement: null,
      dominantCognitiveLevel: null,
      lastCognitiveLevel: null,
      topConfusionPoints: [],
      emotionalSignals: {
        positive: 0,
        neutral: 0,
        frustrated: 0,
        confused: 0,
      },
      completionCandidateSeen: false,
    },
  };
  sessionAdvisory.value = null;
  peerChatMessages.value = [];
  peerNotificationVisible.value = false;
  peerChatWindowVisible.value = false;
  elapsedTime.value = 0;
  activeTime.value = 0;
  sessionPaused.value = false;
};

const persistPauseOnPageHide = () => {
  if (!sessionInfo.value.sessionId || !sessionActive.value || endingSession.value || autoPausing.value) {
    return;
  }

  const token = localStorage.getItem('token');
  if (!token) {
    return;
  }

  autoPausing.value = true;
  void fetch(`${API_BASE_URL}/ai-teaching/sessions/${sessionInfo.value.sessionId}/pause`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reason: 'pagehide' }),
  }).finally(() => {
    autoPausing.value = false;
  });
};

const startSession = async () => {
  if (!task.value) return;
  
  sessionInitMode.value = 'new';
  sessionInitializing.value = true;
  
  try {
    const session = await aiTeachingAPI.startSession(task.value.id);

    if (session.mode === 'resumed') {
      sessionInitMode.value = 'resumed';
      await resumeSession(session.sessionId);
      return;
    }

    resetSessionState();
    sessionInfo.value = {
      sessionId: session.sessionId,
      subject: session.subject,
      topic: session.topic,
      difficulty: 5
    };

    if (session.knowledgePoints && session.knowledgePoints.length > 0) {
      knowledgePoints.value = session.knowledgePoints;
    }

    sessionActive.value = true;
    sessionInitializing.value = false;

    messages.value.push({
      role: 'assistant',
      content: session.opening?.message
        ? `${session.opening.message}\n\n${session.opening.question}`
        : session.welcomeMessage,
      timestamp: new Date().toISOString(),
      quickReplies: session.opening?.quickReplies || [],
      quickRepliesUsed: false,
    });
    scrollToBottom();

    startTimer();
    toast.success('授课会话已开始，课程进度将在 48 小时内保留');
  } catch (error: any) {
    sessionInitializing.value = false;
    toast.error(error.message || '开始会话失败');

    if (!sessionInfo.value.sessionId && task.value?.id && !(error?.message || '').includes('未登录')) {
      try {
        const session = await aiTeachingAPI.startSession(task.value.id, { forceNew: true });
        resetSessionState();
        sessionInfo.value = {
          sessionId: session.sessionId,
          subject: session.subject,
          topic: session.topic,
          difficulty: 5
        };
        if (session.knowledgePoints && session.knowledgePoints.length > 0) {
          knowledgePoints.value = session.knowledgePoints;
        }
        sessionActive.value = true;
        sessionInitializing.value = false;
        messages.value.push({
          role: 'assistant',
          content: session.opening?.message
            ? `${session.opening.message}\n\n${session.opening.question}`
            : session.welcomeMessage,
          timestamp: new Date().toISOString(),
          quickReplies: session.opening?.quickReplies || [],
          quickRepliesUsed: false,
        });
        scrollToBottom();
        startTimer();
        toast.success('已跳过旧会话恢复，重新开始本节授课');
      } catch (retryError: any) {
        sessionInitializing.value = false;
        toast.error(retryError.message || '重新初始化授课会话失败');
      }
    }
  }
};

const sendMessage = async () => {
  const text = userInput.value.trim();
  if (!text || aiLoading.value || !sessionInfo.value.sessionId) return;

  showCompletionPrompt.value = false;
  completionPromptReason.value = null;
  
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
    ) as MessageResultWithRecovery;
    
    messages.value.push({
      role: 'assistant',
      content: result.aiResponse,
      timestamp: new Date().toISOString(),
      analysis: result.analysis,
      strategies: result.strategies || [],
      knowledgePoint: result.knowledgePoint,
      knowledgePoints: result.knowledgePoints,
      promptDebug: result.promptDebug || null,
      peerTriggered: result.peerTriggered,
      peerMessage: result.peerMessage || null,
      peerDebug: result.peerDebug || null,
    });

    if (result.autoEnded && result.wrapup) {
      sessionWrapup.value = result.wrapup;
      sessionAdvisory.value = result.advisory || null;
      sessionActive.value = false;
      sessionPaused.value = false;
      activeCheckpoint.value = null;
      showCompletionPrompt.value = false;
      completionPromptReason.value = null;
      stopTimer();

      const evaluationDurationMinutes = result.wrapup?.duration;
      completionDurationSeconds.value = typeof evaluationDurationMinutes === 'number'
        ? evaluationDurationMinutes * 60
        : activeTime.value;

      toast.success(result.wrapup?.evaluation ? '本节课已自动结束并生成评估' : '本节课已自动结束并生成总结');

        await nextTick();
        const pathId = task.value?.learningPath?.id || '';
        router.push({
          path: `${learningEvaluationBasePath.value}/${effectiveTaskId.value}/evaluation/${sessionInfo.value.sessionId}`,
          query: pathId ? buildRouteQuery({ pathId }) : buildRouteQuery(),
        });
        return;
    }

    if (result.knowledgePoints && result.knowledgePoints.length > 0) {
      knowledgePoints.value = result.knowledgePoints;
    }

    if (result.checkpoint) {
      activeCheckpoint.value = result.checkpoint;
      nextTick(() => {
        checkpointRef.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      });
    }
    
    if (result.shouldConfirmEnd && !endingSession.value) {
      completionPromptReason.value = result.endReason || (result.isCompletion ? 'completion-candidate' : 'learner-requested-end');
      showCompletionPrompt.value = true;
      if (completionPromptReason.value === 'learner-requested-end') {
        toast.info('已收到结束本节学习的请求，请确认是否结束并进入评估');
      } else {
        toast.success('已检测到当前任务达到收束条件，可确认结束并进入评估');
      }
    }
    
    if (result.recovered) {
      toast.info('检测到一段时间未活动，已自动恢复会话');
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
    toast.error(error.message || '发送消息失败');
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

const useOpeningQuickReply = async (text: string, messageIndex: number) => {
  const msg = messages.value[messageIndex];
  if (!msg || aiLoading.value) return;
  msg.quickRepliesUsed = true;
  userInput.value = text;
  await sendMessage();
};

const handleCheckpointSubmit = async (payload: CheckpointSubmitPayload) => {
  if (!sessionInfo.value.sessionId || !activeCheckpoint.value || checkpointSubmitting.value) return;

  checkpointSubmitting.value = true;
  try {
    const result = await aiTeachingAPI.submitCheckpoint(
      sessionInfo.value.sessionId,
      activeCheckpoint.value.id,
      payload
    );

    checkpointRef.value?.applyResult(result as CheckpointSubmitResult);

    if (result.passed) {
      toast.success('小检核已通过');
    } else {
      toast.info('已收到检核反馈，可继续优化答案');
    }
  } catch (error: any) {
    toast.error(error.message || '提交检核失败');
  } finally {
    checkpointSubmitting.value = false;
  }
};

const handleCheckpointSkip = () => {
  activeCheckpoint.value = null;
  toast.info('已跳过本次小检核');
};

const handleCheckpointContinue = () => {
  activeCheckpoint.value = null;
};

const handleCheckpointReview = () => {
  userInput.value = '我想回顾一下刚才这个知识点，请你用更直观的方式再讲一遍。';
  activeCheckpoint.value = null;
};

const handleCheckpointRetry = () => {
  toast.info('你可以重新作答这道题');
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
    if (!result.peerResponse?.trim()) {
      throw new Error('同伴暂时没有返回可用内容');
    }
    peerChatMessages.value.push({
      role: 'peer',
      content: result.peerResponse,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    toast.error(error.message || '同伴消息发送失败');
    peerChatMessages.value.pop();
  }
};

const openPeerChatFromNotification = async () => {
  peerChatWindowVisible.value = true;
  peerNotificationVisible.value = false;

  if (peerInitializing.value || !sessionInfo.value.sessionId) {
    return;
  }

  const hasPeerMessage = peerChatMessages.value.some(msg => msg.role === 'peer');
  if (hasPeerMessage) {
    return;
  }

  const latestUserMessage = [...messages.value]
    .reverse()
    .find(msg => msg.role === 'user' && msg.content?.trim())?.content;

  if (!latestUserMessage) {
    return;
  }

  peerInitializing.value = true;
  try {
    const result = await aiTeachingAPI.sendPeerMessage(sessionInfo.value.sessionId, latestUserMessage);
    if (result.peerResponse?.trim()) {
      peerChatMessages.value.push({
        role: 'peer',
        content: result.peerResponse,
        timestamp: new Date().toISOString(),
      });
    } else {
      toast.info('同伴暂时没有生成可展示内容');
    }
  } catch (error: any) {
    toast.error(error.message || '拉取同伴消息失败');
  } finally {
    peerInitializing.value = false;
  }
};

const handleCompletionAction = async (action: 'end' | 'continue-task' | 'complete-task') => {
  if (action === 'continue-task') {
    showEvaluationDialog.value = false;
    toast.success('已保留当前任务进度，你可以稍后继续学习');
    return;
  }

  if (action === 'complete-task') {
    try {
      const actualMinutes = Math.ceil(activeTime.value / 60);
      await api.post(`/learning/tasks/${effectiveTaskId.value}/complete`, {
        actualMinutes
      });
      toast.success('已将本任务标记为完成');
      closeEvaluationAndReturn();
    } catch (error: any) {
      toast.error(error.message || '标记任务完成失败');
    }
    return;
  }

  if (action === 'end') {
    closeEvaluationAndReturn();
  }
};

const dismissCompletionPrompt = () => {
  showCompletionPrompt.value = false;
  completionPromptReason.value = null;
};

const confirmCompletionEnd = async () => {
  await endSession({
    skipConfirm: true,
    silentSuccess: true,
  });
};

const resumeSessionFromPause = async () => {
  if (!task.value) return;

  sessionPaused.value = false;
  await startSession();
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
        '结束后将无法继续当前授课会话，未完成内容不会保留。确定结束吗？',
        '结束课程并离开',
        {
          confirmButtonText: '确定结束',
          cancelButtonText: '继续学习',
          type: 'warning'
        }
      );
    }

    endingSession.value = true;
    
    const result = await aiTeachingAPI.endSession(sessionInfo.value.sessionId);
    showCompletionPrompt.value = false;
    completionPromptReason.value = null;
    activeCheckpoint.value = null;
    
    sessionActive.value = false;
    sessionPaused.value = false;
    stopTimer();
    
    messages.value.push({
      role: 'assistant',
      content: '授课会话已结束。感谢你的学习！',
      timestamp: new Date().toISOString()
    });
    
    sessionWrapup.value = result.wrapup;
    sessionAdvisory.value = result.advisory;

    const evaluationDurationMinutes = result.wrapup?.duration;
    completionDurationSeconds.value = typeof evaluationDurationMinutes === 'number'
      ? evaluationDurationMinutes * 60
      : activeTime.value;

    if (!result.wrapup?.evaluation) {
      toast.warning('课程总结已生成，但课后评估未通过 AI 校验。');
    }

    if (options?.redirectAfterEnd) {
      closeEvaluationAndReturn();
    } else if (!options?.skipEvaluationDialog) {
      const pathId = task.value?.learningPath?.id || '';
      router.push({
        path: `${learningEvaluationBasePath.value}/${effectiveTaskId.value}/evaluation/${sessionInfo.value.sessionId}`,
        query: pathId ? buildRouteQuery({ pathId }) : buildRouteQuery()
      });
      return;
    }

    if (!options?.silentSuccess) {
      toast.success('会话已结束');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error(error.message || '结束会话失败');
      // 兜底: 即使后端结束失败,也复位提示和按钮状态,避免一直卡在"准备结束"
      showCompletionPrompt.value = false;
      completionPromptReason.value = null;
    }
  } finally {
    endingSession.value = false;
  }
};

const closeEvaluationAndReturn = () => {
  showEvaluationDialog.value = false;
  if (task.value?.learningPath?.id) {
    router.push({
      path: `${learningPathDetailBasePath.value}/${task.value.learningPath.id}`,
      query: buildRouteQuery({ t: String(Date.now()) })
    });
  } else {
    router.push({ path: dashboardPath.value, query: buildRouteQuery() });
  }
};

const handleWrapupAdvisoryAction = async (action: string) => {
  if (!sessionAdvisory.value?.shouldSuggest) return;

  if (action === 'keep' || action === 'later' || action === 'preview') {
    if (action === 'keep') toast.success('已保留当前学习计划');
    if (action === 'later') toast.info('已保留建议，你可以稍后再决定');
    return;
  }

  if (!task.value?.learningPath?.id) {
    toast.warning('当前任务缺少学习路径信息，暂无法调整下一阶段');
    return;
  }

  try {
    await ElMessageBox.confirm(
      '这会基于当前学习证据调整当前路径的后续阶段，已完成任务会保留不变。是否继续？',
      '调整当前路径',
      {
        confirmButtonText: '确认调整当前路径',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    const reasonMap: Record<string, string> = {
      reinforce: '根据课后建议，为下一阶段补强关键薄弱点',
      resequence: '根据课后建议，调整下一阶段顺序以降低理解风险',
      accelerate: '根据课后建议，压缩下一阶段以加快推进',
      slow_down: '根据课后建议，放慢下一阶段节奏',
    };

    const result = await api.post(`/learning/paths/${task.value.learningPath.id}/replan`, {
      triggerSource: 'ai-teaching',
      mode: 'new_version',
      reason: reasonMap[action] || '根据课后建议调整下一阶段',
      evidence: {
        advisoryAction: action,
        advisory: sessionAdvisory.value,
        wrapup: sessionWrapup.value,
        taskId: effectiveTaskId.value,
        taskTitle: task.value?.title,
      }
    });

    const payload = result.data || result;
    const newPathId = payload?.result?.newPathId || payload?.data?.result?.newPathId;
    toast.success('已调整当前路径的后续阶段');
    if (newPathId) {
      router.push({ path: `${learningPathDetailBasePath.value}/${newPathId}`, query: buildRouteQuery() });
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error(error.message || '调整下一阶段失败');
    }
  }
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }

    if (window.innerWidth <= 768 && composerRef.value) {
      const rect = composerRef.value.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 16 || rect.top < 0) {
        requestAnimationFrame(() => {
          composerRef.value?.scrollIntoView({ block: 'end' });
        });
      }
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

const pauseAndLeave = async () => {
  if (sessionActive.value && !sessionPaused.value && sessionInfo.value.sessionId) {
    try {
      await aiTeachingAPI.pauseSession(sessionInfo.value.sessionId, 'manual');
      sessionPaused.value = true;
      sessionActive.value = false;
      stopTimer();
      toast.success('课程进度已保留，48 小时内可继续学习');
    } catch (error: any) {
      toast.warning(error.message || '暂停保存失败，仍可在 48 小时内尝试恢复');
    }
  }
  const pathId = task.value?.learningPath?.id;
  await router.push(pathId ? { path: `${learningPathDetailBasePath.value}/${pathId}`, query: buildRouteQuery() } : { path: dashboardPath.value, query: buildRouteQuery() });
};

const handleSessionCommand = (command: string) => {
  if (command === 'pause') {
    pauseAndLeave();
  } else if (command === 'end') {
    endSession();
  } else if (command === 'reset') {
    resetAndRestart();
  }
};

const resetAndRestart = async () => {
  if (!sessionInfo.value.sessionId) return;

  try {
    await ElMessageBox.confirm(
      '将清空本节课当前进度（对话、知识点推进、小检核状态），并从开头重新开始。此操作不可撤销。',
      '重新开始本节课',
      {
        confirmButtonText: '确认重置',
        cancelButtonText: '继续学习',
        type: 'warning',
      }
    );
  } catch {
    return;
  }

  try {
    await aiTeachingAPI.resetSession(sessionInfo.value.sessionId);
  } catch (error: any) {
    toast.error(error.message || '重置会话失败，请稍后重试');
    return;
  }

  resetSessionState();
  sessionActive.value = false;
  sessionInfo.value = { sessionId: '', subject: '', topic: '', difficulty: 5 };

  try {
    const session = await aiTeachingAPI.startSession(task.value.id, { forceNew: true });
    sessionInfo.value = {
      sessionId: session.sessionId,
      subject: session.subject,
      topic: session.topic,
      difficulty: 5,
    };
    sessionActive.value = true;
    messages.value.push({
      role: 'assistant',
      content: session.opening?.message
        ? `${session.opening.message}\n\n${session.opening.question}`
        : session.welcomeMessage,
      timestamp: new Date().toISOString(),
      quickReplies: session.opening?.quickReplies || [],
      quickRepliesUsed: false,
    });
    startTimer();
    toast.success('已重新开始本节课，课程进度将在 48 小时内保留');
  } catch (error: any) {
    toast.error(error.message || '重新开始失败');
  }
};

const goBack = () => {
  if (sessionActive.value || sessionPaused.value) {
    pauseAndLeave();
  } else {
    const pathId = task.value?.learningPath?.id;
    router.push(pathId ? { path: `${learningPathDetailBasePath.value}/${pathId}`, query: buildRouteQuery() } : { path: dashboardPath.value, query: buildRouteQuery() });
  }
};

const resumeSession = async (sessionId: string) => {
  sessionInitializing.value = true;
  
  try {
    const detail = isAdminVirtualSessionView.value
      ? await (async () => {
          const response = await adminApi.getVirtualSessionTeachingDetail(virtualSessionId.value);
          if (!response.data?.success) {
            throw new Error(response.data?.error || '获取虚拟授课会话详情失败');
          }
          return response.data.data;
        })()
      : await aiTeachingAPI.getSessionDetail(sessionId);
    if (!detail) {
      toast.error('获取会话详情失败');
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
      analysis: m.analysis,
      strategies: m.strategies,
      knowledgePoint: m.knowledgePoint,
      knowledgePoints: m.knowledgePoints,
      promptDebug: m.promptDebug || null,
      peerTriggered: m.peerTriggered,
      peerMessage: m.peerMessage || null,
      peerDebug: m.peerDebug || null,
    }));

    knowledgePoints.value = Array.isArray(detail.knowledgePoints) ? detail.knowledgePoints : [];
    activeCheckpoint.value = detail.pendingCheckpoint || null;
    showCompletionPrompt.value = false;
    completionPromptReason.value = null;
    completionDurationSeconds.value = 0;
    sessionAdvisory.value = null;
    sessionPaused.value = false;
    
    sessionActive.value = true;
    sessionInitializing.value = false;
    startTimer();
    scrollToBottom();
    
    toast.success('已恢复你在 48 小时内未完成的课程进度');
  } catch (error: any) {
    sessionInitializing.value = false;
    toast.error(error.message || '恢复会话失败');
  }
};

onMounted(async () => {
  await loadTaskData();

  if (task.value?.status === 'completed') {
    toast.info('本任务已完成，请返回学习路径查看评估');
    const pathId = task.value?.learningPath?.id;
    router.replace(pathId ? { path: `${learningPathDetailBasePath.value}/${pathId}`, query: buildRouteQuery() } : { path: dashboardPath.value, query: buildRouteQuery() });
    return;
  }

  if (isVirtualSessionView.value) {
    const teachingSessionId = String(virtualContext.value?.bindings?.teachingSessionId || '');
    if (teachingSessionId) {
      await resumeSession(teachingSessionId);
    } else if (task.value && task.value.learningPath?.canStartLearning !== false) {
      toast.info('当前虚拟 session 还没有绑定 Learn 会话，可先在控制中心启动 Learn。');
    }
  } else if (task.value && task.value.learningPath?.canStartLearning !== false) {
    await startSession();
  }

  window.addEventListener('pagehide', persistPauseOnPageHide);
  window.addEventListener('beforeunload', persistPauseOnPageHide);
});

onUnmounted(() => {
  stopTimer();
  window.removeEventListener('pagehide', persistPauseOnPageHide);
  window.removeEventListener('beforeunload', persistPauseOnPageHide);
});
</script>

<style scoped>
.learning-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  --muted: #7a8599;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
  min-height: 100vh;
  min-height: 100dvh;
  height: 100dvh;
  max-width: 100%;
  color: var(--ink);
  background: #f3f6fb;
  overflow: hidden;
}

/* ---- states ---- */
.session-initializing {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
  min-height: 60vh;
  color: var(--muted);
  font-size: 15px;
}

.session-initializing .loading-icon {
  font-size: 36px;
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.session-paused {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 24px;
  min-height: 60vh;
}

.session-paused h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--ink);
}

.session-paused p {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}

/* ---- header card ---- */
.learning-header-card {
  max-width: min(1240px, calc(100% - 48px));
  width: 100%;
  margin: 12px auto 0;
  padding: 12px 28px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
  display: grid;
  gap: 8px;
}

.learning-header-card__top {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
}

.learning-header-card__title {
  display: grid;
  gap: 8px;
  max-width: 820px;
  flex: 1;
  min-width: 0;
}

.learning-header-card__title h1 {
  margin: 0;
  font-size: clamp(16px, 1.9vw, 20px);
  line-height: 1.3;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-weight: 700;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.learning-header-card__path {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.4;
}

.pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--accent-deep);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  width: fit-content;
}

.learning-header-card__controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.learning-header-card__more-btn {
  width: 34px;
  height: 34px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--muted);
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.learning-header-card__more-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(52, 120, 246, 0.04);
}

:deep(.el-dropdown-menu__item) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
}

:deep(.el-dropdown-menu__item .el-icon) {
  font-size: 15px;
  margin: 0;
}

:deep(.el-dropdown-menu__item.danger-item) {
  color: #e86450;
}

:deep(.el-dropdown-menu__item.danger-item:hover) {
  background: rgba(232, 100, 80, 0.06);
  color: #d4503c;
}

.learning-header-card__status {
  font-size: 12px;
  font-weight: 600;
  color: #1a7a42;
  height: 34px;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  border-radius: 12px;
  background: rgba(49, 177, 111, 0.1);
  letter-spacing: 0.02em;
}

.learning-header-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.learning-header-card__meta span {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: #f3f6fb;
  border: 1px solid rgba(23, 32, 51, 0.07);
  font-size: 12px;
  color: var(--ink);
  font-weight: 600;
}

/* ---- layout ---- */
.learning-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 0;
  height: 100%;
  min-height: 0;
  max-width: min(1240px, calc(100% - 48px));
  width: 100%;
  margin: 0 auto;
  overflow: hidden;
}

.learning-layout-shell {
  position: relative;
  max-width: min(1240px, calc(100% - 48px));
  width: 100%;
  margin: 0 auto;
  height: 100%;
}

.learning-layout--no-sidebar {
  grid-template-columns: 1fr;
  height: 100%;
}

/* ---- sidebar ---- */
.learning-sidebar {
  border-right: 1px solid var(--line);
  padding: 24px 20px;
  display: grid;
  gap: 16px;
  align-content: start;
  background: rgba(255, 255, 255, 0.45);
  overflow-y: auto;
}

.learning-sidebar__progress {
  padding: 18px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
  display: grid;
  gap: 14px;
}

.learning-sidebar__head strong {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.learning-sidebar__progress-bar {
  height: 7px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  overflow: hidden;
}

.learning-sidebar__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
  transition: width 0.4s ease;
}

.learning-sidebar__progress-meta {
  display: grid;
  gap: 6px;
}

.learning-sidebar__progress-meta span {
  font-size: 12px;
  color: var(--muted);
}

.learning-sidebar__progress-meta strong {
  font-size: 13px;
  color: var(--ink);
  font-weight: 700;
}

.learning-sidebar__nav {
  display: grid;
  gap: 10px;
}

.learning-kp {
  padding: 14px 16px 12px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(23, 32, 51, 0.07);
  display: grid;
  gap: 10px;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.learning-kp--mastered {
  border-color: rgba(49, 177, 111, 0.2);
  background: rgba(49, 177, 111, 0.02);
}

.learning-kp--mastered .learning-kp__state {
  color: #1a7a42;
  background: rgba(49, 177, 111, 0.1);
  padding: 2px 8px;
  border-radius: 6px;
}

.learning-kp--review {
  border-color: rgba(194, 132, 26, 0.2);
  background: rgba(194, 132, 26, 0.02);
}

.learning-kp--review .learning-kp__state {
  color: #9a6b0a;
  background: rgba(194, 132, 26, 0.1);
  padding: 2px 8px;
  border-radius: 6px;
}

.learning-kp--pending .learning-kp__state {
  color: var(--muted);
  opacity: 0.7;
}

.learning-kp--current {
  background: color-mix(in srgb, var(--accent) 6%, white);
  border-color: rgba(52, 120, 246, 0.2);
  box-shadow: inset 3px 0 0 var(--accent), 0 1px 4px rgba(52, 120, 246, 0.06);
}

.learning-kp--current .learning-kp__state {
  color: #fff;
  background: var(--accent);
  padding: 2px 8px;
  border-radius: 6px;
}

.learning-kp--current .learning-kp__order {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}

.learning-kp__head {
  display: flex;
  align-items: start;
  gap: 10px;
}

.learning-kp__order {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f3f6fb;
  border: 1px solid rgba(23, 32, 51, 0.08);
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  flex-shrink: 0;
}

.learning-kp__title-group {
  display: grid;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.learning-kp__head strong {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  word-break: break-word;
  line-height: 1.4;
}

.learning-kp__state {
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.learning-kp__bar {
  height: 4px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  overflow: hidden;
}

.learning-kp__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
  transition: width 0.4s ease;
}

.learning-kp--mastered .learning-kp__fill {
  background: #31b16f;
}

/* ---- main area ---- */
.learning-main {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  padding: 24px;
  padding-bottom: calc(24px + var(--safe-area-bottom));
  gap: 0;
  overflow: hidden;
}

.learning-bottom {
  display: grid;
  gap: 12px;
  padding-top: 16px;
}

.learning-messages {
  display: grid;
  gap: 16px;
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  padding-right: 8px;
}

.learning-msg {
  max-width: 88%;
  min-width: 220px;
  padding: 16px 20px;
  border-radius: 16px;
  display: grid;
  gap: 8px;
  position: relative;
}

.learning-msg--user {
  max-width: 90%;
}

.learning-msg--assistant {
  justify-self: start;
  background: #fff;
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.03);
}

.learning-msg--user {
  justify-self: end;
  background: color-mix(in srgb, var(--accent) 8%, white);
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.learning-msg__role {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.02em;
}

.learning-msg__body {
  min-width: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--ink);
}

.learning-msg__body :deep(p) {
  margin: 0 0 8px 0;
}

.learning-msg__body :deep(p:last-child) {
  margin-bottom: 0;
}

.learning-msg__body--thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
}

.learning-msg__actions {
  opacity: 0;
  transition: opacity 0.15s ease;
  display: flex;
  margin-top: -2px;
}

.learning-msg:hover .learning-msg__actions {
  opacity: 1;
}

.learning-msg__actions :deep(.el-button) {
  font-size: 11px;
  color: var(--muted);
  padding: 3px 10px;
  height: auto;
  border-radius: 8px;
  background: rgba(23, 32, 51, 0.04);
  border: 1px solid rgba(23, 32, 51, 0.06);
  font-weight: 600;
}

.learning-msg__actions :deep(.el-button:hover) {
  color: var(--ink);
  background: rgba(23, 32, 51, 0.08);
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

.message-error :deep(.el-button) {
  font-size: 11px;
  color: var(--color-warning);
  padding: 3px 10px;
  height: auto;
  border-radius: 8px;
  background: rgba(232, 100, 80, 0.06);
  border: 1px solid rgba(232, 100, 80, 0.12);
  font-weight: 600;
  margin-left: 6px;
}

.message-error :deep(.el-button:hover) {
  background: rgba(232, 100, 80, 0.12);
}

.quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.quick-reply-card {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid rgba(52, 120, 246, 0.18);
  background: rgba(52, 120, 246, 0.04);
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.quick-reply-card:hover {
  transform: translateY(-1px);
  background: rgba(52, 120, 246, 0.08);
  border-color: rgba(52, 120, 246, 0.3);
}

/* ---- completion ---- */
.learning-completion {
  padding: 16px 20px;
  border-radius: 14px;
  background: rgba(49, 177, 111, 0.06);
  border: 1px solid rgba(49, 177, 111, 0.15);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.learning-completion__copy {
  display: grid;
  gap: 4px;
}

.learning-completion__copy strong {
  font-size: 14px;
  font-weight: 600;
  color: #1a7a42;
}

.learning-completion__copy p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #3d6f54;
}

.learning-completion__actions {
  display: flex;
  gap: 10px;
}

.learning-completion__actions :deep(.el-button) {
  border-radius: 10px;
  font-weight: 600;
  font-size: 13px;
}

/* ---- composer ---- */
.learning-composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: end;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: #fff;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.learning-composer__field {
  position: relative;
  min-width: 0;
}

.learning-composer__counter {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: 11px;
  color: rgba(15, 23, 42, 0.42);
  letter-spacing: 0.02em;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  background: rgba(255, 255, 255, 0.85);
  padding: 1px 6px;
  border-radius: 999px;
  transition: color 0.2s ease;
}

.learning-composer__counter--warn {
  color: #b45309;
  font-weight: 600;
}

.learning-composer:focus-within {
  border-color: rgba(52, 120, 246, 0.3);
  box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.06);
}

.learning-composer :deep(.el-textarea__inner) {
  border: none;
  background: transparent;
  box-shadow: none;
  resize: none;
  font-size: 14px;
  color: var(--ink);
  padding: 8px 0;
  line-height: 1.6;
}

.learning-composer :deep(.el-button) {
  border-radius: 10px;
  font-weight: 600;
  min-height: 40px;
  padding: 0 20px;
  font-size: 14px;
}

.loading-icon {
  animation: rotating 2s linear infinite;
}

/* ---- peer chat ---- */
.peer-chat-float-btn {
  position: fixed;
  bottom: calc(100px + var(--safe-area-bottom));
  right: max(16px, calc(16px + var(--safe-area-right)));
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  z-index: 9997;
  transition: all 0.3s ease;
}

.peer-chat-float-btn:hover {
  transform: scale(1.1);
}

/* ---- scrollbar ---- */
.learning-messages::-webkit-scrollbar {
  width: 6px;
}

.learning-messages::-webkit-scrollbar-track {
  background: transparent;
}

.learning-messages::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.3);
  border-radius: 3px;
}

.learning-messages::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.5);
}

/* ---- responsive ---- */
@media (max-width: 1100px) {
  .learning-layout-shell {
    max-width: 100%;
  }

  .learning-layout,
  .learning-header-card {
    width: 100%;
    padding: 20px 24px;
  }

  .learning-header-card__top {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .learning-header-card__controls {
    width: 100%;
    flex-wrap: wrap;
  }
}

@media (max-width: 900px) {
  .learning-layout {
    grid-template-columns: 1fr;
    max-width: min(100% - 24px, 1240px);
  }

  .learning-sidebar {
    border-right: none;
    border-bottom: 1px solid var(--line);
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 16px;
  }

  .learning-sidebar__nav {
    max-height: 240px;
  }

  .learning-msg {
    max-width: 95%;
    min-width: 0;
  }
}

@media (max-width: 768px) {
  .learning-page {
    min-height: 100dvh;
    height: auto;
  }

  .learning-header-card {
    max-width: min(100% - 20px, 1240px);
    margin-top: 10px;
    padding: 14px 16px;
    border-radius: 18px;
  }

  .learning-header-card__controls,
  .learning-header-card__meta {
    width: 100%;
  }

  .learning-layout {
    max-width: min(100% - 20px, 1240px);
  }

  .learning-main {
    padding: 16px;
    padding-bottom: calc(16px + var(--safe-area-bottom));
  }

  .learning-messages {
    gap: 12px;
    padding-right: 0;
    overscroll-behavior: contain;
  }

  .learning-msg,
  .learning-msg--user {
    max-width: 100%;
  }

  .learning-completion {
    flex-direction: column;
    align-items: flex-start;
  }

  .learning-completion__actions {
    width: 100%;
    flex-direction: column;
  }

  .learning-completion__actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }

  .learning-bottom {
    gap: 12px;
  }

  .learning-composer {
    grid-template-columns: 1fr;
  }

  .learning-composer :deep(.el-button) {
    width: 100%;
  }

  .peer-chat-float-btn {
    bottom: calc(84px + var(--safe-area-bottom));
    right: max(12px, calc(12px + var(--safe-area-right)));
  }

}

@media (max-width: 520px) {
  .learning-header-card {
    max-width: min(100% - 16px, 1240px);
    padding: 12px 14px;
  }

  .learning-layout {
    max-width: min(100% - 16px, 1240px);
  }

  .learning-sidebar,
  .learning-main {
    padding: 14px;
  }

  .learning-sidebar__progress-meta,
  .learning-msg__actions,
  .learning-completion__actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .learning-msg {
    padding: 14px;
  }

  .quick-replies {
    gap: 6px;
  }

  .quick-reply-card {
    width: 100%;
    justify-content: flex-start;
  }

  .peer-chat-float-btn {
    bottom: calc(76px + var(--safe-area-bottom));
  }

}
</style>
