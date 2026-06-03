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
          <span v-if="virtualDebugSummary">{{ virtualDebugSummary }}</span>
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
                <details
                  v-if="isTestMode && ((msg.role === 'assistant' && getLearningTraceCard(msg)) || (msg.role === 'user' && getLearningInputTraceCard(msg)))"
                  class="learning-msg-trace"
                >
                  <summary class="learning-msg-trace__summary">
                    {{ getLearningTraceSummaryLabelForMessage(msg) }}
                  </summary>

                  <template v-if="msg.role === 'user' && getLearningInputTraceCard(msg)">
                    <div class="learning-msg-trace__meta">
                      <span>{{ getLearningInputTraceCard(msg)?.kindLabel }}</span>
                      <span>{{ getLearningInputTraceCard(msg)?.summary }}</span>
                      <span v-if="getLearningInputTraceCard(msg)?.promptVersionLabel">{{ getLearningInputTraceCard(msg)?.promptVersionLabel }}</span>
                    </div>

                    <div v-for="section in getLearningInputTraceCard(msg)?.sections || []" :key="section.key" class="learning-msg-trace__section">
                      <span class="learning-msg-trace__label">{{ section.label }}</span>
                      <pre>{{ section.content }}</pre>
                    </div>

                    <div class="learning-msg-trace__actions">
                      <el-button size="small" text @click="openTurnDebugDialog(getAssistantMessageForUserTurn(msg), 'input')">查看输入</el-button>
                    </div>
                  </template>

                  <template v-else-if="getLearningTraceCard(msg)">
                    <div class="learning-msg-trace__meta">
                      <span>{{ getLearningTraceCard(msg)?.kindLabel }}</span>
                      <span>{{ getLearningTraceCard(msg)?.summary }}</span>
                      <span v-if="getLearningTraceCard(msg)?.promptVersionLabel">{{ getLearningTraceCard(msg)?.promptVersionLabel }}</span>
                    </div>

                    <div v-if="getLearningTraceCard(msg)?.metricChips.length" class="learning-msg-trace__metric-grid">
                      <article
                        v-for="metric in getLearningTraceCard(msg)?.metricChips || []"
                        :key="metric.label"
                        class="learning-msg-trace__metric"
                      >
                        <span>{{ metric.label }}</span>
                        <strong>{{ metric.value }}</strong>
                      </article>
                    </div>

                    <div v-for="section in getLearningTraceCard(msg)?.sections || []" :key="section.key" class="learning-msg-trace__section">
                      <span class="learning-msg-trace__label">{{ section.label }}</span>
                      <pre>{{ section.content }}</pre>
                    </div>

                    <section v-if="getLearningTraceCard(msg)?.peerCard" class="learning-msg-trace__peer">
                      <div class="learning-msg-trace__peer-head">
                        <div>
                          <span class="learning-msg-trace__peer-eyebrow">伴学介入</span>
                          <strong>{{ getLearningTraceCard(msg)?.peerCard?.title }}</strong>
                        </div>
                        <span class="learning-msg-trace__peer-badge">skill:peer-reinforcement</span>
                      </div>

                      <div v-if="getLearningTraceCard(msg)?.peerCard?.summary" class="learning-msg-trace__peer-summary">
                        {{ getLearningTraceCard(msg)?.peerCard?.summary }}
                      </div>

                      <div v-for="section in getLearningTraceCard(msg)?.peerCard?.sections || []" :key="section.key" class="learning-msg-trace__section">
                        <span class="learning-msg-trace__label">{{ section.label }}</span>
                        <pre>{{ section.content }}</pre>
                      </div>
                    </section>

                    <div class="learning-msg-trace__actions">
                      <el-button v-if="getPromptDebugPayload(msg)" size="small" text @click="openTurnDebugDialog(msg, 'input')">查看输入</el-button>
                      <el-button v-if="msg.promptDebug?.normalizedOutput || msg.promptDebug?.rawModelOutput" size="small" text @click="openTurnDebugDialog(msg, 'output')">查看输出</el-button>
                    </div>
                  </template>
                </details>
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
                <el-icon class="loading-icon"><Loading /></el-icon>
                <span>思考中...</span>
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
              <span>已达到课程完成条件</span>
              <div class="learning-completion__actions">
                <el-button size="small" @click="dismissCompletionPrompt">继续学习</el-button>
                <el-button type="success" size="small" :loading="endingSession" @click="confirmCompletionEnd">结束并评估</el-button>
              </div>
            </div>

            <div class="learning-composer">
              <el-input
                v-model="userInput"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 4 }"
                placeholder="输入你的想法… (Ctrl+Enter 发送)"
                @keydown.ctrl.enter="sendMessage"
                :disabled="aiLoading"
              />
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

      <button
        v-if="showLearningDebugFloat"
        type="button"
        class="learning-debug-float-btn"
        :class="{ 'learning-debug-float-btn--stacked': showPeerFloatButton }"
        @click="openPathInputDialog"
      >
        <strong>Learn / Raw</strong>
        <span>{{ learningDebugQuickChipText }}</span>
      </button>

      <el-drawer
        v-model="showPathInputDialog"
        title="Learn 调试数据"
        size="min(92vw, 900px)"
        destroy-on-close
        class="learning-debug-drawer"
      >
        <div class="learning-debug-dialog__summary">{{ latestTeachingInputSummary }}</div>
        <div v-if="pathHandoffSections.length" class="learning-debug-dialog__group">
          <div class="learning-debug-dialog__group-title">Path 交付数据</div>
          <div class="learning-debug-dialog__grid">
            <section v-for="section in pathHandoffSections" :key="section.key" class="learning-debug-card">
              <span class="learning-debug-card__eyebrow">{{ section.label }}</span>
              <pre>{{ section.content }}</pre>
            </section>
          </div>
        </div>

        <div v-if="pathInputSections.length" class="learning-debug-dialog__group">
          <div class="learning-debug-dialog__group-title">编排器处理后的教学输入</div>
        <div class="learning-debug-dialog__grid">
          <section v-for="section in pathInputSections" :key="section.key" class="learning-debug-card">
            <span class="learning-debug-card__eyebrow">{{ section.label }}</span>
            <pre>{{ section.content }}</pre>
          </section>
        </div>
        </div>

        <div v-if="latestTeachingPromptDebugSections.length" class="learning-debug-dialog__group">
          <div class="learning-debug-dialog__group-title">最近一轮 Teaching Turn Prompt Debug</div>
          <div class="learning-debug-dialog__grid">
            <section v-for="section in latestTeachingPromptDebugSections" :key="section.key" class="learning-debug-card">
              <span class="learning-debug-card__eyebrow">{{ section.label }}</span>
              <pre>{{ section.content }}</pre>
            </section>
          </div>
        </div>

        <div v-if="latestPeerPromptDebugSections.length" class="learning-debug-dialog__group">
          <div class="learning-debug-dialog__group-title">最近一轮 Peer Skill 调试</div>
          <div class="learning-debug-dialog__grid">
            <section v-for="section in latestPeerPromptDebugSections" :key="section.key" class="learning-debug-card">
              <span class="learning-debug-card__eyebrow">{{ section.label }}</span>
              <pre>{{ section.content }}</pre>
            </section>
          </div>
        </div>

        <div v-if="!pathHandoffSections.length && !pathInputSections.length && !latestTeachingPromptDebugSections.length && !latestPeerPromptDebugSections.length" class="learning-debug-dialog__empty">
          当前没有可展示的调试数据。
        </div>
      </el-drawer>

      <el-dialog
        v-model="showTurnDebugDialog"
        :title="turnDebugDialogTitle"
        width="960px"
        class="learning-debug-dialog"
      >
        <div v-if="selectedTurnDebugSections.length" class="learning-debug-dialog__grid">
          <section v-for="section in selectedTurnDebugSections" :key="section.key" class="learning-debug-card">
            <span class="learning-debug-card__eyebrow">{{ section.label }}</span>
            <pre>{{ section.content }}</pre>
          </section>
        </div>
        <div v-else class="learning-debug-dialog__empty">当前没有可展示的调试数据。</div>
      </el-dialog>
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
}

interface TraceMetricChip {
  label: string;
  value: string;
}

interface TraceSectionView {
  key: string;
  label: string;
  content: string;
}

interface LearningPeerTraceCard {
  title: string;
  summary: string;
  sections: TraceSectionView[];
}

interface LearningTraceCard {
  kind: 'opening' | 'teaching-turn';
  kindLabel: string;
  summary: string;
  promptVersionLabel?: string;
  metricChips: TraceMetricChip[];
  sections: TraceSectionView[];
  peerCard?: LearningPeerTraceCard | null;
}

interface LearningInputTraceCard {
  kindLabel: string;
  summary: string;
  promptVersionLabel?: string;
  sections: TraceSectionView[];
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref('');
const aiLoading = ref(false);
const messageListRef = ref<HTMLElement | null>(null);
const checkpointRef = ref<InstanceType<typeof CheckpointCard> | null>(null);
const activeCheckpoint = ref<Checkpoint | null>(null);
const checkpointSubmitting = ref(false);

const knowledgePoints = ref<KnowledgePointStatus[]>([]);
const showCompletionPrompt = ref(false);
const completionDurationSeconds = ref(0);

const peerNotificationVisible = ref(false);
const peerChatWindowVisible = ref(false);
const peerChatMessages = ref<Array<{ role: string; content: string; timestamp: string }>>([]);
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
const showStrategyHints = false;
const autoPausing = ref(false);
const showPathInputDialog = ref(false);
const showTurnDebugDialog = ref(false);
const selectedTurnDebugMode = ref<'input' | 'output'>('input');
const selectedTurnDebug = ref<any | null>(null);

const sessionInitMessage = computed(() => sessionInitMode.value === 'resumed'
  ? '正在恢复上次授课进度...'
  : '正在初始化授课会话...');

const allKnowledgePointsMastered = computed(() => {
  return knowledgePoints.value.length > 0
    && knowledgePoints.value.every((kp) => kp.status === 'mastered');
});

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

const prettyTraceValue = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const buildTraceSection = (key: string, label: string, value: any): TraceSectionView | null => {
  const content = prettyTraceValue(value);
  if (!content) return null;
  return { key, label, content };
};

const latestTeachingInputDebug = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const msg = messages.value[index];
    if (msg.role === 'assistant' && msg.promptDebug?.userPayload) {
      return msg.promptDebug;
    }
  }
  return null;
});

const latestTeachingInputPayload = computed(() => {
  const raw = latestTeachingInputDebug.value?.userPayload;
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

const latestTeachingInputSummary = computed(() => {
  const payload = latestTeachingInputPayload.value;
  if (!payload || typeof payload !== 'object') {
    return '展示 teaching-turn 最近一次 userPayload';
  }

  const latestLearnerMessage = typeof payload.latestLearnerMessage === 'string'
    ? payload.latestLearnerMessage.trim()
    : '';
  const taskTitle = typeof payload?.scenario?.taskTitle === 'string'
    ? payload.scenario.taskTitle
    : '';
  const coreConcept = typeof payload?.scenario?.cognitiveFrame?.currentCoreConcept?.name === 'string'
    ? payload.scenario.cognitiveFrame.currentCoreConcept.name
    : '';

  return [taskTitle, coreConcept, latestLearnerMessage ? `最近输入：${latestLearnerMessage}` : '']
    .filter(Boolean)
    .join(' · ') || '展示 teaching-turn 最近一次 userPayload';
});

const showPeerFloatButton = computed(() => peerChatMessages.value.length > 0 && !peerChatWindowVisible.value);
const showLearningDebugFloat = computed(() => {
  return isTestMode.value && (
    pathHandoffSections.value.length > 0
    || pathInputSections.value.length > 0
    || latestTeachingInputDebug.value !== null
    || latestPeerPromptDebug.value !== null
  );
});

const learningDebugQuickChipText = computed(() => {
  const chips = [
    pathHandoffSections.value.length > 0 ? `Path ${pathHandoffSections.value.length}` : '',
    pathInputSections.value.length > 0 ? `Input ${pathInputSections.value.length}` : '',
    latestTeachingInputDebug.value?.systemPromptVersion ? `Prompt v${latestTeachingInputDebug.value.systemPromptVersion}` : '',
    latestPeerPromptDebug.value ? 'Peer skill' : ''
  ].filter(Boolean);

  return chips.length > 0 ? chips.slice(0, 3).join(' · ') : '查看 Learn 原始数据';
});

const virtualDebugSummary = computed(() => {
  if (!virtualContext.value) return '';
  const profile = virtualContext.value.profile || {};
  const story = virtualContext.value.storyContext || {};
  const bindings = virtualContext.value.bindings || {};
  return [
    profile.userName ? `画像：${profile.userName}` : '',
    story.title ? `故事：${story.title}` : '',
    bindings.teachingSessionId ? `session：${String(bindings.teachingSessionId).slice(0, 8)}` : '未启动 Learn session'
  ].filter(Boolean).join(' · ');
});

const pathInputSections = computed(() => {
  const payload = latestTeachingInputPayload.value;
  if (!payload || typeof payload !== 'object') return [];

  const scenario = payload.scenario || {};
  const sections = [
    {
      key: 'taskProfile',
      label: '任务画像 taskProfile',
      value: scenario.taskProfile || null,
    },
    {
      key: 'cognitiveFrame',
      label: '局部认知图景 cognitiveFrame',
      value: scenario.cognitiveFrame || null,
    },
    {
      key: 'taskKnowledgeScope',
      label: '任务知识范围 taskKnowledgeScope',
      value: scenario.taskKnowledgeScope || null,
    },
    {
      key: 'teachingStrategyGuidance',
      label: '教学策略 guidance',
      value: scenario.teachingStrategyGuidance || null,
    },
    {
      key: 'pathContext',
      label: '路径上下文',
      value: {
        pathTitle: scenario.pathTitle || null,
        pathSummary: scenario.pathSummary || null,
        currentMilestoneTitle: scenario.currentMilestoneTitle || null,
        currentStageNumber: scenario.currentStageNumber || null,
        currentTaskOrder: scenario.currentTaskOrder || null,
        totalTasksInMilestone: scenario.totalTasksInMilestone || null,
      },
    },
  ];

  return sections
    .filter((section) => section.value && (typeof section.value !== 'object' || Object.keys(section.value).length > 0))
    .map((section) => ({
      key: section.key,
      label: section.label,
      content: JSON.stringify(section.value, null, 2),
    }));
});

const pathHandoffSections = computed(() => {
  if (!task.value) return [];

  const sections = [
    {
      key: 'taskMeta',
      label: '当前任务基础信息',
      value: {
        taskId: task.value.id || null,
        title: task.value.title || null,
        description: task.value.description || null,
        taskType: task.value.taskType || null,
      },
    },
    {
      key: 'taskProfile',
      label: 'Path 交付的任务画像',
      value: {
        displayLabel: task.value.displayLabel || null,
        knowledgeType: task.value.knowledgeType || null,
        cognitiveLevel: task.value.cognitiveLevel || null,
        coreConcept: task.value.coreConcept || null,
        learningObjectives: task.value.week?.learningObjectives || null,
      },
    },
    {
      key: 'pathContext',
      label: 'Path / 阶段上下文',
      value: {
        learningPathId: task.value.learningPath?.id || null,
        learningPathName: task.value.learningPath?.name || null,
        weekNumber: task.value.week?.weekNumber || null,
        weekTitle: task.value.week?.title || null,
        weekGoal: task.value.week?.goal || null,
      },
    },
  ];

  return sections
    .filter((section) => section.value && Object.values(section.value).some((value) => value !== null && value !== undefined && value !== ''))
    .map((section) => ({
      key: section.key,
      label: section.label,
      content: JSON.stringify(section.value, null, 2),
    }));
});

const buildPromptDebugSections = (promptDebug: any) => {
  if (!promptDebug || typeof promptDebug !== 'object') return [] as Array<{ key: string; label: string; content: string }>;

  return [
    { key: 'userPayload', label: 'userPayload', value: promptDebug.userPayload || null },
    { key: 'normalizedOutput', label: 'normalizedOutput', value: promptDebug.normalizedOutput || null },
    { key: 'rawModelOutput', label: 'rawModelOutput', value: promptDebug.rawModelOutput || null },
    { key: 'attempts', label: 'attempts', value: promptDebug.attempts || null },
  ]
    .filter((section) => section.value !== null && section.value !== undefined && section.value !== '')
    .map((section) => ({
      key: section.key,
      label: section.label,
      content: typeof section.value === 'string' ? section.value : JSON.stringify(section.value, null, 2),
    }));
};

const latestPeerPromptDebug = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const msg = messages.value[index] as any;
    if (msg?.peerDebug?.promptDebug) {
      return msg.peerDebug.promptDebug;
    }
  }
  return null;
});

const latestTeachingPromptDebugSections = computed(() => buildPromptDebugSections(latestTeachingInputDebug.value));
const latestPeerPromptDebugSections = computed(() => buildPromptDebugSections(latestPeerPromptDebug.value));

const buildRouteQuery = (extra: Record<string, string> = {}) => {
  const query: Record<string, string> = {};
  if (virtualSessionId.value) query.virtualSessionId = virtualSessionId.value;
  if (viewMode.value) query.viewMode = viewMode.value;
  return { ...query, ...extra };
};

const turnDebugDialogTitle = computed(() => selectedTurnDebugMode.value === 'input' ? '本轮教学输入' : '本轮教学输出');

const selectedTurnDebugSections = computed(() => {
  const debug = selectedTurnDebug.value;
  if (!debug) return [];

  if (selectedTurnDebugMode.value === 'input') {
    const payload = getPromptDebugPayload(debug);
    if (!payload) {
      return debug.promptDebug?.userPayload
        ? [{ key: 'rawUserPayload', label: 'Raw Payload', content: String(debug.promptDebug.userPayload) }]
        : [];
    }

    const sections = [
      { key: 'latestLearnerMessage', label: '最近输入', value: payload.latestLearnerMessage || null },
      { key: 'taskProfile', label: '任务画像', value: payload.scenario?.taskProfile || null },
      { key: 'cognitiveFrame', label: '局部认知图景', value: payload.scenario?.cognitiveFrame || null },
      { key: 'learner', label: '学习者状态', value: payload.learner || null },
      { key: 'knowledge', label: '当前知识看板', value: payload.knowledge || null },
      { key: 'recentDialogueContext', label: '最近对话上下文', value: payload.recentDialogueContext || null },
    ];

    return sections
      .filter((section) => section.value !== null && section.value !== undefined && section.value !== '')
      .map((section) => ({
        key: section.key,
        label: section.label,
        content: typeof section.value === 'string' ? section.value : JSON.stringify(section.value, null, 2),
      }));
  }

  const promptDebug = debug.promptDebug || {};
  const sections = [
    { key: 'normalizedOutput', label: '结构化输出 normalizedOutput', value: promptDebug.normalizedOutput || null },
    { key: 'rawModelOutput', label: '模型原始输出 rawModelOutput', value: promptDebug.rawModelOutput || null },
    { key: 'attempts', label: '重试轨迹 attempts', value: promptDebug.attempts || null },
  ];

  return sections
    .filter((section) => section.value !== null && section.value !== undefined && section.value !== '')
    .map((section) => ({
      key: section.key,
      label: section.label,
      content: typeof section.value === 'string' ? section.value : JSON.stringify(section.value, null, 2),
    }));
});

const getPromptDebugPayload = (msg: any) => {
  const raw = msg?.promptDebug?.userPayload;
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const getPromptDebugNormalizedOutput = (msg: any) => {
  const value = msg?.promptDebug?.normalizedOutput;
  return value && typeof value === 'object' ? value : null;
};

const resolveDebugAnalysis = (msg: any) => {
  if (msg?.analysis && typeof msg.analysis === 'object') {
    return msg.analysis;
  }

  const normalized = getPromptDebugNormalizedOutput(msg);
  const analysis = normalized?.analysis;
  return analysis && typeof analysis === 'object' ? analysis : null;
};

const resolveDebugKnowledgePoint = (msg: any) => {
  if (typeof msg?.knowledgePoint === 'string' && msg.knowledgePoint.trim()) {
    return msg.knowledgePoint;
  }

  const normalized = getPromptDebugNormalizedOutput(msg);
  const currentPoint = normalized?.knowledge?.currentPoint;
  return typeof currentPoint === 'string' && currentPoint.trim() ? currentPoint : null;
};

const resolveDebugStrategies = (msg: any) => {
  if (Array.isArray(msg?.strategies) && msg.strategies.length > 0) {
    return msg.strategies;
  }

  const normalized = getPromptDebugNormalizedOutput(msg);
  const strategies = normalized?.pedagogy?.strategies;
  return Array.isArray(strategies) ? strategies : [];
};

const getPromptDebugPromptVersionLabel = (msg: any) => {
  const version = msg?.promptDebug?.systemPromptVersion;
  if (version === null || version === undefined || version === '') return '';
  return `Prompt v${version}`;
};

const buildOpeningTraceCard = (msg: ChatMessage): LearningTraceCard | null => {
  const openingMode = typeof msg.analysis?.openingMode === 'string' ? msg.analysis.openingMode : null;
  const quickReplies = Array.isArray(msg.quickReplies)
    ? msg.quickReplies.map((item) => item.text).filter(Boolean)
    : [];

  if (!openingMode && quickReplies.length === 0) return null;

  const sections = [
    buildTraceSection('visibleReply', '开场可见内容', msg.content),
    buildTraceSection('openingMode', '开场模式', openingMode),
    buildTraceSection('quickReplies', '快捷回复', quickReplies),
  ].filter(Boolean) as TraceSectionView[];

  return {
    kind: 'opening',
    kindLabel: '开场交互块',
    summary: openingMode ? `mode: ${openingMode}` : '首轮开场消息',
    metricChips: [
      { label: 'mode', value: openingMode || '--' },
      { label: 'quickReplies', value: String(quickReplies.length) },
    ],
    sections,
    peerCard: null,
  };
};

const buildPeerTraceCard = (msg: ChatMessage): LearningPeerTraceCard | null => {
  if (!msg.peerTriggered && !msg.peerMessage && !msg.peerDebug) return null;

  const analysis = resolveDebugAnalysis(msg);
  const sections = [
    buildTraceSection('triggerReason', '触发上下文', {
      cognitiveLevel: analysis?.cognitiveLevel || null,
      understanding: analysis?.understanding ?? null,
      engagement: analysis?.engagement ?? null,
      knowledgePoint: resolveDebugKnowledgePoint(msg),
      strategies: resolveDebugStrategies(msg),
    }),
    buildTraceSection('peerInput', '伴学 Skill 输入', msg.peerDebug?.input || null),
    buildTraceSection('peerMessage', '伴学输出', msg.peerMessage || '本轮触发了伴学，但当前没有返回可见文案。'),
    buildTraceSection('followUpQuestions', '伴学追问', msg.peerDebug?.followUpQuestions || null),
    buildTraceSection('peerPromptDebug', '伴学结构化调试', msg.peerDebug?.promptDebug || null),
  ].filter(Boolean) as TraceSectionView[];

  return {
    title: 'Peer Reinforcement Skill',
    summary: msg.peerTriggered ? '本轮 teaching-turn 决定触发伴学 skill。' : '存在伴学输出。',
    sections,
  };
};

const buildTeachingTurnTraceCard = (msg: ChatMessage): LearningTraceCard | null => {
  const payload = getPromptDebugPayload(msg);
  const normalized = getPromptDebugNormalizedOutput(msg);
  const analysis = resolveDebugAnalysis(msg);
  const knowledgePoint = resolveDebugKnowledgePoint(msg);
  const strategies = resolveDebugStrategies(msg);

  if (!payload && !normalized && !analysis && !knowledgePoint && strategies.length === 0 && !msg.peerTriggered && !msg.peerMessage && !msg.peerDebug) {
    return null;
  }

  const sections = [
    buildTraceSection('latestLearnerMessage', '本轮用户输入', payload?.latestLearnerMessage || null),
    buildTraceSection('taskProfile', '任务画像 taskProfile', payload?.scenario?.taskProfile || null),
    buildTraceSection('cognitiveFrame', '局部认知图景 cognitiveFrame', payload?.scenario?.cognitiveFrame || null),
    buildTraceSection('knowledgeBoard', '当前知识看板 knowledge', payload?.knowledge || null),
    buildTraceSection('visibleReply', '可见回复', msg.content),
    buildTraceSection('completionCandidateEvidence', '完成判定依据', normalized?.control?.completionCandidateEvidence || null),
    buildTraceSection('normalizedOutput', '结构化输出 normalizedOutput', normalized || null),
  ].filter(Boolean) as TraceSectionView[];

  return {
    kind: 'teaching-turn',
    kindLabel: '教学回合',
    summary: buildTurnDebugSummary(msg),
    promptVersionLabel: getPromptDebugPromptVersionLabel(msg),
    metricChips: [
      { label: 'knowledgePoint', value: knowledgePoint || '--' },
      { label: 'cognitiveLevel', value: analysis?.cognitiveLevel || '--' },
      { label: 'understanding', value: analysis?.understanding !== undefined && analysis?.understanding !== null ? String(analysis.understanding) : '--' },
      { label: 'engagement', value: analysis?.engagement !== undefined && analysis?.engagement !== null ? String(analysis.engagement) : '--' },
      { label: 'strategies', value: strategies.length ? strategies.map(strategyLabel).join(' / ') : '--' },
    ],
    sections,
    peerCard: buildPeerTraceCard(msg),
  };
};

const getLearningTraceCard = (msg: ChatMessage): LearningTraceCard | null => {
  const openingCard = buildOpeningTraceCard(msg);
  if (openingCard) return openingCard;
  return buildTeachingTurnTraceCard(msg);
};

const getAssistantMessageForUserTurn = (msg: ChatMessage) => {
  const index = messages.value.indexOf(msg);
  if (index < 0) return null;
  for (let cursor = index + 1; cursor < messages.value.length; cursor += 1) {
    const candidate = messages.value[cursor];
    if (candidate.role === 'assistant') {
      return candidate;
    }
  }
  return null;
};

const getLearningInputTraceCard = (msg: ChatMessage): LearningInputTraceCard | null => {
  if (msg.role !== 'user') return null;
  const assistantMsg = getAssistantMessageForUserTurn(msg);
  const payload = getPromptDebugPayload(assistantMsg);
  if (!payload) return null;

  const sections = [
    buildTraceSection('latestLearnerMessage', '本轮用户输入', payload?.latestLearnerMessage || msg.content),
    buildTraceSection('taskProfile', '任务画像 taskProfile', payload?.scenario?.taskProfile || null),
    buildTraceSection('cognitiveFrame', '局部认知图景 cognitiveFrame', payload?.scenario?.cognitiveFrame || null),
    buildTraceSection('learner', '学习者状态', payload?.learner || null),
    buildTraceSection('knowledgeBoard', '当前知识看板 knowledge', payload?.knowledge || null),
    buildTraceSection('recentDialogueContext', '最近对话上下文', payload?.recentDialogueContext || null),
  ].filter(Boolean) as TraceSectionView[];

  if (sections.length === 0) return null;

  const coreConcept = payload?.scenario?.cognitiveFrame?.currentCoreConcept?.name || payload?.scenario?.taskProfile?.coreConcept || '';
  const learnerMessage = typeof payload?.latestLearnerMessage === 'string' ? payload.latestLearnerMessage : '';

  return {
    kindLabel: '教学输入',
    summary: [coreConcept, learnerMessage ? `最近输入：${learnerMessage}` : ''].filter(Boolean).join(' · ') || '查看本轮教学输入',
    promptVersionLabel: getPromptDebugPromptVersionLabel(assistantMsg),
    sections,
  };
};

const getLearningTraceSummaryLabelForMessage = (msg: ChatMessage) => {
  if (msg.role === 'user') {
    return getLearningInputTraceCard(msg) ? '查看本轮教学输入' : '';
  }
  return getLearningTraceSummaryLabel(msg);
};

const getLearningTraceSummaryLabel = (msg: ChatMessage) => {
  const card = getLearningTraceCard(msg);
  if (!card) return '查看本轮教学输入与输出';
  if (card.kind === 'opening') return '查看开场交互块';
  return card.peerCard ? '查看本轮教学输入、输出与伴学介入' : '查看本轮教学输入与输出';
};

const buildTurnDebugSummary = (msg: any) => {
  const payload = getPromptDebugPayload(msg);
  if (!payload) {
    return '查看这一轮的 teaching-turn 输入输出';
  }

  const coreConcept = payload?.scenario?.cognitiveFrame?.currentCoreConcept?.name || payload?.scenario?.taskProfile?.coreConcept || '';
  const learnerMessage = typeof payload?.latestLearnerMessage === 'string' ? payload.latestLearnerMessage : '';
  return [coreConcept, learnerMessage ? `最近输入：${learnerMessage}` : ''].filter(Boolean).join(' · ') || '查看这一轮的 teaching-turn 输入输出';
};

const openPathInputDialog = () => {
  showPathInputDialog.value = true;
};

const openTurnDebugDialog = (msg: any, mode: 'input' | 'output') => {
  if (!msg) return;
  selectedTurnDebug.value = msg;
  selectedTurnDebugMode.value = mode;
  showTurnDebugDialog.value = true;
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
      stopTimer();

      const evaluationDurationMinutes = result.wrapup?.duration;
      completionDurationSeconds.value = typeof evaluationDurationMinutes === 'number'
        ? evaluationDurationMinutes * 60
        : activeTime.value;

      toast.success(result.wrapup?.evaluation ? '本节课已自动结束并生成评估' : '本节课已自动结束并生成总结');

      await nextTick();
      const pathId = task.value?.learningPath?.id || '';
      router.push({
        path: `/learn/${effectiveTaskId.value}/evaluation/${sessionInfo.value.sessionId}`,
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
    
    if (result.isCompletion && !endingSession.value) {
      if (allKnowledgePointsMastered.value) {
        showCompletionPrompt.value = true;
        toast.success('🎉 已完成本节课程目标，可选择结束并生成评估');
      } else {
        toast.info('检测到完成信号，但还有知识点未完全掌握，可继续学习');
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
        path: `/learn/${effectiveTaskId.value}/evaluation/${sessionInfo.value.sessionId}`,
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
      router.push({ path: `/learning-path/${newPathId}`, query: buildRouteQuery() });
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
    completionDurationSeconds.value = 0;
    sessionAdvisory.value = null;
    sessionPaused.value = false;
    
    sessionActive.value = true;
    sessionInitializing.value = false;
    startTimer();
    
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

.learning-debug-float-btn {
  position: fixed;
  right: max(16px, calc(16px + var(--safe-area-right)));
  bottom: calc(28px + var(--safe-area-bottom));
  z-index: 9998;
  display: grid;
  gap: 4px;
  min-width: 156px;
  padding: 12px 14px;
  border: 0;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  box-shadow: 0 18px 38px rgba(31, 87, 204, 0.28);
  color: #fff;
  text-align: left;
}

.learning-debug-float-btn--stacked {
  bottom: calc(168px + var(--safe-area-bottom));
}

.learning-debug-float-btn strong {
  font-size: 14px;
}

.learning-debug-float-btn span {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.82);
}

.learning-debug-drawer :deep(.el-drawer__header) {
  margin-bottom: 0;
  padding-bottom: 12px;
}

.learning-debug-drawer :deep(.el-drawer__body) {
  padding-top: 0;
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

.learning-msg-trace {
  margin-top: 10px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(15, 23, 42, 0.06);
  overflow: hidden;
}

.learning-msg-trace__summary {
  cursor: pointer;
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
  padding: 12px 14px;
}

.learning-msg-trace__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 14px 12px;
}

.learning-msg-trace__meta span {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #49638f;
  font-size: 11px;
  font-weight: 600;
}

.learning-msg-trace__metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  padding: 0 14px 12px;
}

.learning-msg-trace__metric {
  display: grid;
  gap: 4px;
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.learning-msg-trace__metric span {
  color: var(--muted);
  font-size: 11px;
}

.learning-msg-trace__metric strong {
  color: var(--ink);
  font-size: 12px;
  line-height: 1.5;
}

.learning-msg-trace__section {
  padding: 0 14px 12px;
}

.learning-msg-trace__label {
  display: block;
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
}

.learning-msg-trace pre {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.learning-msg-trace__peer {
  margin: 0 14px 12px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(47, 186, 118, 0.08);
  border: 1px solid rgba(47, 186, 118, 0.14);
}

.learning-msg-trace__peer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.learning-msg-trace__peer-eyebrow {
  display: block;
  color: #4e8a67;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 4px;
}

.learning-msg-trace__peer-head strong {
  color: #1d3a29;
  font-size: 13px;
}

.learning-msg-trace__peer-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #3a7553;
  font-size: 11px;
  font-weight: 700;
}

.learning-msg-trace__peer-summary {
  margin-bottom: 10px;
  color: #43644f;
  font-size: 12px;
  line-height: 1.6;
}

.learning-msg-trace__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 0 14px 12px;
}

.learning-msg-trace__actions :deep(.el-button) {
  font-size: 11px;
  padding: 4px 8px;
}

.learning-debug-dialog__summary {
  margin-bottom: 14px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.learning-debug-dialog__group + .learning-debug-dialog__group {
  margin-top: 18px;
}

.learning-debug-dialog__group-title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.learning-debug-dialog__grid {
  display: grid;
  gap: 14px;
}

.learning-debug-dialog__empty {
  color: var(--muted);
  font-size: 13px;
}

.learning-debug-card {
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.96);
  overflow: hidden;
}

.learning-debug-card__eyebrow {
  display: block;
  padding: 12px 14px 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.learning-debug-card pre {
  margin: 0;
  padding: 14px;
  max-height: 320px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.65;
  color: #dbe7ff;
  background: #0f172a;
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
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.learning-completion span {
  font-size: 14px;
  font-weight: 600;
  color: #1a7a42;
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

  .learning-msg-debug__grid {
    grid-template-columns: 1fr;
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

  .learning-debug-float-btn {
    right: max(12px, calc(12px + var(--safe-area-right)));
    bottom: calc(16px + var(--safe-area-bottom));
  }

  .learning-debug-float-btn--stacked {
    bottom: calc(140px + var(--safe-area-bottom));
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

  .learning-msg__body {
    min-width: 0;
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

  .learning-debug-float-btn {
    left: 16px;
    right: 16px;
    min-width: 0;
  }

  .learning-debug-float-btn--stacked {
    bottom: calc(132px + var(--safe-area-bottom));
  }
}
</style>
