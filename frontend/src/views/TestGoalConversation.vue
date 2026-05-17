<template>
  <div class="test-goal-page">
    <header class="test-goal-header" :class="{ 'test-goal-header--scrolled': headerScrolled }">
      <div class="test-goal-header__inner">
        <button type="button" class="test-goal-brand" @click="router.push('/admin/test/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="test-goal-brand__logo" />
          <span>测试目标规划</span>
        </button>

        <nav class="test-goal-nav" aria-label="应用导航">
          <router-link to="/admin/test/dashboard">测试学习台</router-link>
          <router-link to="/admin/test/goal-full" class="is-active">测试目标规划</router-link>
          <router-link to="/admin/test/learning-paths">测试学习路径</router-link>
          <router-link to="/admin/test/learning-state">测试学习状态</router-link>
        </nav>

        <div class="test-goal-header__actions">
          <button type="button" class="test-goal-btn test-goal-btn--ghost" @click="resetConversation">新建测试</button>
        </div>
      </div>
    </header>

    <main class="test-goal-shell">
      <aside class="test-goal-sidebar">
        <section class="test-goal-card">
          <span class="test-goal-card__eyebrow">模式</span>
          <h2>全量上下文</h2>
          <p>每轮都会把当前测试会话的全部历史传给 GoalConversationAgent，仅保存在内存里，不落数据库。</p>
        </section>

        <section class="test-goal-card">
          <span class="test-goal-card__eyebrow">状态</span>
          <div class="test-goal-stat-grid">
            <article class="test-goal-stat">
              <span>阶段</span>
              <strong>{{ stageLabel }}</strong>
            </article>
            <article class="test-goal-stat">
              <span>方向清晰度</span>
              <strong>{{ confidencePercent }}%</strong>
            </article>
          </div>
          <div class="test-goal-meter">
            <div class="test-goal-meter__fill" :style="{ width: `${confidencePercent}%` }"></div>
          </div>

          <div v-if="learningPath" class="test-goal-path-status">
            <span>路径状态</span>
            <strong>{{ pathStatusLabel }}</strong>
            <p v-if="learningPath.id">路径 ID：{{ learningPath.id }}</p>
          </div>
        </section>

        <section class="test-goal-card">
          <span class="test-goal-card__eyebrow">调试信息</span>
          <div class="test-goal-kv" v-for="item in debugCards" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </section>

        <section class="test-goal-card">
          <span class="test-goal-card__eyebrow">已确认信息</span>
          <div v-if="understandingSummaryCards.length > 0" class="test-goal-summary-list">
            <article v-for="item in understandingSummaryCards" :key="item.label" class="test-goal-summary-item">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
          <p v-else class="test-goal-empty">全量模式下整理出的关键信息会显示在这里。</p>
        </section>
      </aside>

      <section class="test-goal-main">
        <section class="test-goal-card test-goal-card--chat">
          <div class="test-goal-chat-head">
            <div>
              <span class="test-goal-card__eyebrow">对话区</span>
              <h1 v-if="!hasConversationStarted">输入一个目标，观察全量历史如何影响后续对话。</h1>
              <p v-else>这个测试页不会写正式 goal 会话，但已经接入正式学习路径生成能力。</p>
            </div>
            <router-link v-if="!hasConversationStarted" to="/admin/test/dashboard" class="test-goal-btn test-goal-btn--ghost">回到测试学习台</router-link>
          </div>

          <div v-if="isCompleted && generatedPathStatus !== 'generating'" class="test-goal-completion-card">
            <h3>已经可以先查看这版路径。</h3>
            <p v-if="realProblemText">我目前理解的重点是：{{ realProblemText }}</p>
            <div class="test-goal-completion-card__actions">
              <button class="test-goal-btn test-goal-btn--primary" @click="navigateToLearningPath">
                查看学习路径
              </button>
              <button class="test-goal-btn test-goal-btn--ghost" @click="resetConversation">重新开始测试</button>
            </div>
          </div>

          <div v-else-if="!hasConversationStarted && !loading" class="test-goal-examples">
            <button
              v-for="item in entryPromptExamples"
              :key="item"
              type="button"
              class="test-goal-example"
              @click="setInput(item)"
            >
              {{ item }}
            </button>
          </div>

          <div v-else-if="hasConversationStarted || loading" ref="chatContent" class="test-goal-messages">
            <article v-for="msg in sortedMessages" :key="msg.id" class="test-goal-message" :class="`test-goal-message--${msg.role}`">
              <div class="test-goal-message__meta">
                <span>{{ msg.role === 'ai' ? '问流' : '你' }}</span>
                <small>{{ formatTime(msg.time) }}</small>
              </div>
              <div class="test-goal-message__body" v-html="msg.role === 'ai' ? formatMessage(msg.content) : msg.content"></div>

              <div
                v-if="msg.role === 'ai' && msg.quickReplies && msg.quickReplies.length > 0 && !msg.quickRepliesUsed && stage !== 'proposing'"
                class="test-goal-replies"
              >
                <button
                  v-for="(reply, index) in msg.quickReplies"
                  :key="`${msg.id}-${index}-${reply.text}`"
                  type="button"
                  class="test-goal-reply-chip"
                  @click="applyQuickReply(reply.text)"
                >
                  {{ reply.text }}
                </button>
              </div>
            </article>

            <div v-if="loading" class="test-goal-message test-goal-message--ai">
              <div class="test-goal-message__meta">
                <span>问流</span>
              </div>
              <div class="test-goal-loading">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>

          <div class="test-goal-composer">
            <section v-if="latestTraceCard" class="test-goal-trace-panel">
              <div class="test-goal-trace-panel__head">
                <div>
                  <span class="test-goal-card__eyebrow">最后一轮输出</span>
                  <strong>{{ latestTraceCard.statusLabel }}</strong>
                </div>
                <div class="test-goal-trace-panel__meta">
                  <span>{{ latestTraceCard.parseModeLabel }}</span>
                  <span>{{ latestTraceCard.attemptLabel }}</span>
                </div>
              </div>

              <div class="test-goal-trace-panel__section">
                <span class="test-goal-trace-panel__label">可见回复</span>
                <pre>{{ latestTraceCard.visibleReply }}</pre>
              </div>

              <details class="test-goal-trace-panel__details">
                <summary>展开原始输出</summary>

                <div class="test-goal-trace-panel__section">
                  <span class="test-goal-trace-panel__label">最后一次原始文本</span>
                  <pre>{{ latestTraceCard.rawUserVisible }}</pre>
                </div>

                <div v-if="latestTraceCard.attempts.length > 0" class="test-goal-trace-panel__attempts">
                  <article
                    v-for="attempt in latestTraceCard.attempts"
                    :key="`attempt-${attempt.attemptIndex}`"
                    class="test-goal-trace-attempt"
                  >
                    <div class="test-goal-trace-attempt__head">
                      <strong>Attempt {{ attempt.attemptIndex }}</strong>
                      <span>{{ attempt.parseMode }}</span>
                      <em>{{ attempt.structuredOutputValid ? '结构化成功' : '结构化失败' }}</em>
                    </div>
                    <div v-if="attempt.failureType && attempt.failureType !== 'none'" class="test-goal-trace-attempt__failure">
                      Failure: {{ attempt.failureType }}
                    </div>
                    <div v-if="attempt.violations && attempt.violations.length > 0" class="test-goal-trace-attempt__violations">
                      <span v-for="(violation, index) in attempt.violations" :key="`${attempt.attemptIndex}-${index}`">{{ violation }}</span>
                    </div>
                    <pre>{{ attempt.rawContent }}</pre>
                  </article>
                </div>
              </details>
            </section>

            <transition name="slide-up">
              <div v-if="showProposalActionPanel && !loading" class="test-goal-proposal" :class="{ 'test-goal-proposal--supplement': supplementMode }">
                <span class="test-goal-proposal__eyebrow">{{ supplementMode ? '补充信息，重新整理方向' : '确认并生成路径' }}</span>

                <div v-if="!supplementMode" class="test-goal-proposal__list">
                  <div v-if="proposalProblemText" class="test-goal-proposal__item">
                    <strong>核心问题</strong>
                    <p>{{ proposalProblemText }}</p>
                  </div>

                  <div v-if="proposalOutcomeText" class="test-goal-proposal__item">
                    <strong>预计产出</strong>
                    <p>{{ proposalOutcomeText }}</p>
                  </div>

                  <div v-if="proposalStageHighlights.length > 0" class="test-goal-proposal__item">
                    <strong>路径大纲</strong>
                    <ol class="test-goal-proposal__path-list">
                      <li
                        v-for="(item, index) in proposalStageHighlights"
                        :key="`${index}-${item}`"
                      >
                        <span class="test-goal-proposal__path-index">{{ index + 1 }}</span>
                        <span>{{ item }}</span>
                      </li>
                    </ol>
                  </div>
                </div>

                <div v-if="supplementMode" class="test-goal-proposal__supplement-input">
                  <div class="test-goal-proposal__supplement-field">
                    <textarea
                      ref="inputField"
                      v-model="userInput"
                      @keydown.enter.exact.prevent="sendMessage"
                      @keydown.enter.shift.exact="inputNewLine"
                      placeholder="补充背景、限制或偏好..."
                      :disabled="loading"
                      rows="1"
                      @input="autoResize"
                    ></textarea>
                    <button @click="sendMessage" :disabled="loading || !userInput.trim()" class="test-goal-proposal__supplement-send">
                      <el-icon v-if="loading"><Loading /></el-icon>
                      <el-icon v-else><Promotion /></el-icon>
                    </button>
                  </div>
                </div>

                <div class="test-goal-proposal__actions">
                  <template v-if="!supplementMode">
                    <button class="test-goal-btn test-goal-btn--primary" @click="handleConfirmProposal" :disabled="loading">
                      确认并生成路径
                    </button>
                    <button class="test-goal-btn test-goal-btn--ghost" @click="handleContinueSupplement" :disabled="loading">
                      还想补充
                    </button>
                  </template>
                  <template v-else>
                    <button class="test-goal-btn test-goal-btn--ghost" @click="handleCancelSupplement">取消</button>
                  </template>
                </div>
              </div>
            </transition>

            <div v-if="!showProposalActionPanel" class="test-goal-composer">
              <textarea
                ref="inputField"
                v-model="userInput"
                @keydown.enter.exact.prevent="sendMessage"
                @keydown.enter.shift.exact="inputNewLine"
                :placeholder="hasConversationStarted ? '继续补充信息，观察全量历史如何影响下一轮回复…' : '先输入一个测试目标，例如刚才那条 3-6 岁儿童发展指南…'"
                :disabled="loading"
                rows="1"
                @input="autoResize"
              ></textarea>
              <button @click="sendMessage" :disabled="loading || !userInput.trim()" class="test-goal-btn test-goal-btn--primary">
                <el-icon v-if="loading"><Loading /></el-icon>
                <el-icon v-else><Promotion /></el-icon>
                <span>发送</span>
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MarkdownIt from 'markdown-it';
import { Loading, Promotion } from '@element-plus/icons-vue';
import { toast } from '@/utils/toast';
import type { GoalConversationEnvelope } from '@/api/goalConversation';
import {
  deleteTestGoalConversation,
  getTestGoalConversation,
  replyTestGoalConversation,
  startTestGoalConversation
} from '@/api/testGoalConversation';

type ChatMessage = {
  id: string;
  role: 'user' | 'ai';
  content: string;
  time: Date;
  quickReplies?: Array<{ text: string; icon?: string }>;
  quickRepliesUsed?: boolean;
};

type TraceAttempt = {
  attemptIndex: number;
  parseMode: string;
  structuredOutputValid: boolean;
  failureType?: string;
  violations?: string[];
  rawContent: string;
};

type RequestTrace = {
  stateApplied?: boolean;
  structuredOutputValid?: boolean;
  parseMode?: string | null;
  attemptCount?: number;
  failureType?: string;
  violations?: string[];
  observationMode?: boolean;
  rawUserVisible?: string;
  attempts?: TraceAttempt[];
};

const md = new MarkdownIt({ html: true, linkify: true, breaks: true });

const route = useRoute();
const router = useRouter();
const headerScrolled = ref(false);
const chatContent = ref<HTMLElement | null>(null);
const inputField = ref<HTMLTextAreaElement | null>(null);
const userInput = ref('');
const loading = ref(false);
const sessionId = ref('');
const stage = ref<'understanding' | 'proposing' | 'ready' | 'completed'>('understanding');
const confidence = ref(0);
const understanding = ref<Record<string, any>>({});
const collected = ref<Record<string, any>>({});
const debug = ref<Record<string, any>>({ contextMode: 'full', historyCount: 0, retryCount: 0 });
const userMessages = ref<ChatMessage[]>([]);
const aiMessages = ref<ChatMessage[]>([]);
const learningPath = ref<{ id: string; status?: string; name?: string } | null>(null);
const confirmedProposal = ref<Record<string, any> | null>(null);

const hideLastAiQuickReplies = () => {
  for (let i = aiMessages.value.length - 1; i >= 0; i--) {
    if (aiMessages.value[i].quickReplies && aiMessages.value[i].quickReplies!.length > 0) {
      aiMessages.value[i].quickRepliesUsed = true;
      break;
    }
  }
};

const entryPromptExamples = [
  '我们要考就是。知识类的东西了，什么3~6岁儿童，反正指南什么的',
  '我想看看全量历史模式下，它会不会更保留我最早的原话',
  '我想测试一个容易被带偏的学习目标，看看它什么时候开始收窄方向'
];

const hasConversationStarted = computed(() => Boolean(sessionId.value || userMessages.value.length || aiMessages.value.length));
const confidencePercent = computed(() => Math.max(0, Math.min(100, Math.round(confidence.value * 100))));
const sortedMessages = computed(() => [...userMessages.value, ...aiMessages.value].sort((a, b) => a.time.getTime() - b.time.getTime()));
const generatedPathStatus = computed(() => learningPath.value?.status || 'idle');
const isCompleted = computed(() => stage.value === 'completed');
const showProposalActionPanel = computed(() => stage.value === 'proposing' && !loading.value && !isCompleted.value);
const supplementMode = ref(false);
const realProblemText = computed(() => String(understanding.value.real_problem || collected.value.real_problem || '').trim());
const surfaceGoalText = computed(() => String(understanding.value.surface_goal || collected.value.surface_goal || '').trim());
const pathStatusLabel = computed(() => {
  switch (generatedPathStatus.value) {
    case 'generating':
      return '生成中';
    case 'ready':
    case 'completed':
      return '已完成';
    case 'failed':
      return '生成失败';
    default:
      return '未生成';
  }
});

const stageLabelMap: Record<string, string> = {
  understanding: '继续澄清中',
  proposing: '方向待确认',
  ready: '可生成路径',
  completed: '测试会话完成'
};

const stageLabel = computed(() => stageLabelMap[stage.value] || stage.value);

const debugCards = computed(() => [
  { label: '历史条数', value: String(debug.value.historyCount ?? sortedMessages.value.length) },
  { label: '上下文模式', value: String(debug.value.contextMode || 'full') },
  { label: '重试次数', value: String(debug.value.actualRetryCount ?? debug.value.retryCount ?? 0) },
  { label: '解析模式', value: String(debug.value.parseMode || 'n/a') },
  { label: '观察模式', value: debug.value.observationMode ? '已开启' : '关闭' }
]);

const latestTrace = computed<RequestTrace | null>(() => {
  const requestLog = Array.isArray(debug.value?.requestLog) ? debug.value.requestLog : [];
  if (!requestLog.length) return null;
  return requestLog[requestLog.length - 1] as RequestTrace;
});

const latestVisibleReply = computed(() => {
  const latestAiMessage = aiMessages.value[aiMessages.value.length - 1];
  return latestAiMessage?.content || '';
});

const latestTraceCard = computed(() => {
  const trace = latestTrace.value;
  if (!trace) return null;

  const attempts = Array.isArray(trace.attempts) ? trace.attempts : [];
  const parseMode = String(trace.parseMode || 'none');
  const attemptCount = Number(trace.attemptCount || attempts.length || 0);
  const stateApplied = trace.stateApplied === true;

  return {
    statusLabel: stateApplied ? '结构化成功，状态已更新' : '结构化失败，状态未更新',
    parseModeLabel: `解析模式：${parseMode}`,
    attemptLabel: `尝试 ${attemptCount} 次`,
    visibleReply: latestVisibleReply.value || String(trace.rawUserVisible || '').trim() || '本轮没有写入可见回复。',
    rawUserVisible: String(trace.rawUserVisible || '').trim() || '本轮没有单独返回 rawUserVisible。',
    attempts
  };
});

const understandingSummaryCards = computed(() => {
  const cards = [
    { label: '真实问题', value: understanding.value.real_problem || collected.value.real_problem || '' },
    { label: '核心痛点', value: understanding.value.pain_points || collected.value.pain_points || '' },
    { label: '学习动机', value: understanding.value.motivation || collected.value.motivation || '' },
    { label: '当前水平', value: understanding.value.current_baseline?.level || collected.value.level || '' },
    { label: '过往卡点', value: understanding.value.pain_points || collected.value.pain_points || '' },
    { label: '期望周期', value: understanding.value.available_resources?.time_horizon || collected.value.expected_time || '' },
    { label: '可用时间', value: understanding.value.available_resources?.time_budget || collected.value.timePerDay || '' }
  ];

  return cards.filter((item) => typeof item.value === 'string' && item.value.trim().length > 0);
});

const proposalProblemText = computed(() => {
  const text = realProblemText.value || surfaceGoalText.value;
  return text.trim();
});

const proposalOutcomeText = computed(() => {
  const deliverable = confirmedProposal.value?.first_deliverable;
  if (deliverable && typeof deliverable === 'string' && deliverable.trim()) {
    return deliverable.trim();
  }
  return '';
});

const proposalStageHighlights = computed(() => {
  const stages = confirmedProposal.value?.key_stages;
  if (Array.isArray(stages)) {
    return stages
      .filter((item: any) => typeof item === 'string' && item.trim())
      .slice(0, 4);
  }
  return [];
});

const proposalMetaPills = computed(() => {
  const pills: string[] = [];
  const timeBudget = understanding.value.available_resources?.time_budget || collected.value.timePerDay;
  const timeHorizon = understanding.value.available_resources?.time_horizon || collected.value.expected_time;
  if (timeBudget && typeof timeBudget === 'string' && timeBudget.trim()) {
    pills.push(timeBudget.trim());
  }
  if (timeHorizon && typeof timeHorizon === 'string' && timeHorizon.trim()) {
    pills.push(timeHorizon.trim());
  }
  return pills;
});

const formatMessage = (content: string) => md.render(content || '');

const formatTime = (time: Date) => time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const setInput = (value: string) => {
  userInput.value = value;
  nextTick(() => autoResize());
};

const autoResize = () => {
  const textarea = inputField.value;
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
};

const inputNewLine = () => {
  userInput.value += '\n';
  nextTick(() => autoResize());
};

const scrollToBottom = async () => {
  await nextTick();
  if (chatContent.value) {
    chatContent.value.scrollTop = chatContent.value.scrollHeight;
  }
};

const isStructuredOutputInvalidError = (error: any) => {
  return error?.response?.status === 422 && error?.response?.data?.error === 'STRUCTURED_OUTPUT_INVALID';
};

const getFailureEnvelope = (error: any): GoalConversationEnvelope | null => {
  return error?.response?.data?.data || null;
};

const syncState = (response: GoalConversationEnvelope) => {
  sessionId.value = response.internal.core.conversationId || sessionId.value;
  stage.value = response.internal.core.stage;
  confidence.value = response.internal.core.confidence || 0;
  understanding.value = response.internal.ext.goalConversation.understanding || {};
  collected.value = response.internal.ext.goalConversation.collected || {};
  learningPath.value = response.internal.core.learningPath || null;
  debug.value = response.meta?.debug || debug.value;

  if (response.internal.ext.goalConversation.confirmedProposal) {
    confirmedProposal.value = response.internal.ext.goalConversation.confirmedProposal;
  } else if (response.internal.core.stage === 'understanding') {
    confirmedProposal.value = null;
  }

  if (response.meta?.messages) {
    const restored = response.meta.messages.map((msg, index) => ({
      id: `${msg.role}-${index}-${msg.time}`,
      role: msg.role,
      content: msg.content,
      time: new Date(msg.time),
      quickReplies: [] as Array<{ text: string; icon?: string }>,
      quickRepliesUsed: true
    }));

    userMessages.value = restored.filter((msg) => msg.role === 'user');
    aiMessages.value = restored.filter((msg) => msg.role === 'ai');
  }

  const quickReplies = response.renderHints?.quickReplies || [];
  if (quickReplies.length > 0 && aiMessages.value.length > 0) {
    const lastAiMessage = aiMessages.value[aiMessages.value.length - 1];
    lastAiMessage.quickReplies = quickReplies;
    lastAiMessage.quickRepliesUsed = false;
  }
};

const applyQuickReply = async (text: string) => {
  if (loading.value) return;

  hideLastAiQuickReplies();
  userInput.value = text;
  await sendMessage();
};

const handleConfirmProposal = async () => {
  if (!sessionId.value || loading.value) return;
  await sendMessageInternal('确认方案，生成学习路径');
};

const handleContinueSupplement = () => {
  if (loading.value) return;
  supplementMode.value = true;
  userInput.value = userInput.value.trim().length > 0 ? userInput.value : '';
  nextTick(() => {
    autoResize();
    inputField.value?.focus();
  });
};

const handleCancelSupplement = () => {
  supplementMode.value = false;
};

const navigateToLearningPath = () => {
  router.push('/admin/test/learning-paths');
};

const startConversation = async (goal: string) => {
  loading.value = true;
  try {
    const response = await startTestGoalConversation(goal);
    syncState(response);
    router.replace(`/admin/test/goal-full/${response.internal.core.conversationId}`);
    await scrollToBottom();
  } catch (error: any) {
    if (isStructuredOutputInvalidError(error)) {
      const response = getFailureEnvelope(error);
      if (response) {
        syncState(response);
        if (response.internal.core.conversationId) {
          router.replace(`/admin/test/goal-full/${response.internal.core.conversationId}`);
        }
        await scrollToBottom();
        toast.warning('结构化失败，已展示原始输出供测试查看');
        return;
      }
    }

    toast.error(error.message || '开始测试对话失败，请稍后重试');
  } finally {
    loading.value = false;
  }
};

const sendMessageInternal = async (content: string) => {
  loading.value = true;
  try {
    const response = await replyTestGoalConversation(sessionId.value, content);
    syncState(response);
    await scrollToBottom();
  } catch (error: any) {
    if (isStructuredOutputInvalidError(error)) {
      const response = getFailureEnvelope(error);
      if (response) {
        syncState(response);
        await scrollToBottom();
        toast.warning('结构化失败，已展示本轮原始输出');
        return;
      }
    }

    toast.error(error.message || '测试回复失败，请稍后重试');
  } finally {
    loading.value = false;
  }
};

const sendMessage = async () => {
  const content = userInput.value.trim();
  if (!content || loading.value) return;

  if (supplementMode.value) {
    supplementMode.value = false;
  }

  hideLastAiQuickReplies();
  userInput.value = '';
  autoResize();

  if (!sessionId.value) {
    await startConversation(content);
    return;
  }

  await sendMessageInternal(content);
};

const resetConversation = async () => {
  try {
    if (sessionId.value) {
      await deleteTestGoalConversation(sessionId.value);
    }
  } catch {
    // 忽略删除失败，仍允许前端重置
  }

  sessionId.value = '';
  stage.value = 'understanding';
  confidence.value = 0;
  understanding.value = {};
  collected.value = {};
  confirmedProposal.value = null;
  learningPath.value = null;
  debug.value = { contextMode: 'full', historyCount: 0, retryCount: 0 };
  userMessages.value = [];
  aiMessages.value = [];
  userInput.value = '';
  router.replace('/admin/test/goal-full');
  toast.success('测试会话已重置');
};

const restoreConversation = async (id: string) => {
  loading.value = true;
  try {
    const response = await getTestGoalConversation(id);
    syncState(response);
    await scrollToBottom();
  } catch (error: any) {
    toast.error(error.message || '恢复测试会话失败，请稍后重试');
    router.replace('/admin/test/goal-full');
  } finally {
    loading.value = false;
  }
};

const handleScroll = () => {
  headerScrolled.value = window.scrollY > 50;
};

onMounted(() => {
  const id = typeof route.params.conversationId === 'string' ? route.params.conversationId : '';
  if (id) {
    restoreConversation(id);
  }
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});

watch(() => route.params.conversationId, (value) => {
  const id = typeof value === 'string' ? value : '';
  if (id && id !== sessionId.value) {
    restoreConversation(id);
  }
  if (!id && sessionId.value) {
    sessionId.value = '';
    userMessages.value = [];
    aiMessages.value = [];
    learningPath.value = null;
  }
});
</script>

<style scoped>
.test-goal-page {
  min-height: 100vh;
  min-height: 100dvh;
  background:
    radial-gradient(circle at top left, rgba(99, 102, 241, 0.16), transparent 28%),
    radial-gradient(circle at top right, rgba(16, 185, 129, 0.12), transparent 24%),
    linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  color: #0f172a;
}

.test-goal-header {
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(18px);
  background: rgba(248, 250, 252, 0.78);
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.test-goal-header--scrolled {
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
}

.test-goal-header__inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.test-goal-brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  cursor: pointer;
}

.test-goal-brand__logo {
  width: 32px;
  height: 32px;
}

.test-goal-nav {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.test-goal-nav a {
  color: #475569;
  text-decoration: none;
  font-weight: 600;
}

.test-goal-nav a.is-active,
.test-goal-nav a.router-link-active {
  color: #4f46e5;
}

.test-goal-header__actions {
  display: flex;
  align-items: center;
}

.test-goal-shell {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 24px;
}

.test-goal-sidebar,
.test-goal-main {
  min-width: 0;
}

.test-goal-card {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 24px;
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.08);
  padding: 20px;
}

.test-goal-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.test-goal-card__eyebrow {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6366f1;
}

.test-goal-card h2,
.test-goal-card h1 {
  margin: 0 0 10px;
  font-size: 24px;
  line-height: 1.2;
}

.test-goal-card p {
  margin: 0;
  color: #475569;
  line-height: 1.6;
}

.test-goal-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.test-goal-stat,
.test-goal-summary-item {
  padding: 14px;
  border-radius: 16px;
  background: rgba(99, 102, 241, 0.06);
}

.test-goal-stat span,
.test-goal-summary-item span,
.test-goal-kv span {
  display: block;
  font-size: 13px;
  color: #64748b;
}

.test-goal-stat strong,
.test-goal-summary-item strong,
.test-goal-kv strong {
  display: block;
  margin-top: 6px;
  font-size: 15px;
  color: #0f172a;
  word-break: break-word;
}

.test-goal-meter {
  margin-top: 14px;
  height: 10px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.16);
  overflow: hidden;
}

.test-goal-meter__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #6366f1 0%, #22c55e 100%);
}

.test-goal-path-status {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.08), rgba(34, 197, 94, 0.08));
  border: 1px solid rgba(99, 102, 241, 0.14);
}

.test-goal-path-status span {
  display: block;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6366f1;
}

.test-goal-path-status strong {
  display: block;
  margin-top: 6px;
  font-size: 18px;
  color: #0f172a;
}

.test-goal-path-status p {
  margin-top: 8px;
  font-size: 13px;
  color: #475569;
}

.test-goal-kv {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.test-goal-kv:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.test-goal-summary-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.test-goal-empty {
  color: #64748b;
}

.test-goal-card--chat {
  min-height: calc(100vh - 130px);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.test-goal-chat-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.test-goal-examples {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.test-goal-example {
  border: 1px solid rgba(99, 102, 241, 0.16);
  background: rgba(99, 102, 241, 0.06);
  border-radius: 18px;
  padding: 14px;
  text-align: left;
  color: #312e81;
  cursor: pointer;
  line-height: 1.5;
}

.test-goal-messages {
  flex: 1;
  min-height: 320px;
  max-height: calc(100vh - 330px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
}

.test-goal-message {
  max-width: 86%;
  padding: 16px;
  border-radius: 20px;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
}

.test-goal-message--user {
  align-self: flex-end;
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  color: #ffffff;
}

.test-goal-message--ai {
  align-self: flex-start;
  background: rgba(248, 250, 252, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.test-goal-message__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 700;
  opacity: 0.8;
}

.test-goal-message__body {
  line-height: 1.7;
  word-break: break-word;
}

.test-goal-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.test-goal-reply-chip {
  border: 1px solid rgba(99, 102, 241, 0.2);
  background: rgba(99, 102, 241, 0.08);
  border-radius: 999px;
  padding: 8px 14px;
  color: #4338ca;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.test-goal-reply-chip:hover {
  background: rgba(99, 102, 241, 0.14);
  border-color: rgba(99, 102, 241, 0.3);
  transform: translateY(-1px);
}

.test-goal-message__body :deep(p) {
  margin: 0;
}

.test-goal-message__body :deep(p + p) {
  margin-top: 10px;
}

.test-goal-completion-card,
.test-goal-proposal {
  margin-bottom: 18px;
  padding: 18px 20px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(99, 102, 241, 0.12), rgba(255, 255, 255, 0.96));
  border: 1px solid rgba(99, 102, 241, 0.12);
  box-shadow: 0 16px 30px rgba(79, 70, 229, 0.08);
  display: grid;
  gap: 14px;
}

.test-goal-proposal__eyebrow {
  display: block;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.test-goal-proposal__list {
  display: grid;
  gap: 12px;
}

.test-goal-proposal__item {
  display: grid;
  gap: 4px;
}

.test-goal-proposal__item + .test-goal-proposal__item {
  padding-top: 12px;
  border-top: 1px solid rgba(99, 102, 241, 0.12);
}

.test-goal-proposal__item strong {
  color: #4338ca;
  font-size: 13px;
  font-weight: 800;
}

.test-goal-proposal__item p {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  line-height: 1.65;
}

.test-goal-proposal__path-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.test-goal-proposal__path-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.12);
  color: #4338ca;
  font-size: 11px;
  font-weight: 800;
}

.test-goal-proposal__path-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #0f172a;
  font-size: 15px;
  line-height: 1.65;
}

.test-goal-completion-card h3 {
  display: block;
  margin: 0 0 10px;
  font-size: 20px;
  color: #111827;
}

.test-goal-completion-card p {
  margin: 0;
  color: #475569;
  line-height: 1.65;
}

.test-goal-completion-card__actions,
.test-goal-proposal__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.test-goal-proposal--supplement {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.94));
  border-color: rgba(245, 158, 11, 0.18);
}

.test-goal-proposal--supplement .test-goal-proposal__eyebrow {
  color: #b45309;
}

.test-goal-proposal__supplement-input {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(245, 158, 11, 0.04);
  border: 1px solid rgba(245, 158, 11, 0.1);
}

.test-goal-proposal__supplement-field {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 14px;
  border: 1px solid rgba(245, 158, 11, 0.15);
  padding: 10px 14px;
}

.test-goal-proposal__supplement-field textarea {
  flex: 1;
  background: transparent;
  border: none;
  resize: none;
  font-size: 14px;
  line-height: 1.6;
  color: var(--test-goal-ink);
  outline: none;
  min-height: 1.6em;
  max-height: 80px;
}

.test-goal-proposal__supplement-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--test-goal-primary);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.2s;
}

.test-goal-proposal__supplement-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.test-goal-proposal__supplement-send .el-icon {
  font-size: 18px;
}

.test-goal-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: end;
}

.test-goal-trace-panel {
  grid-column: 1 / -1;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(248, 250, 252, 0.94);
}

.test-goal-trace-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.test-goal-trace-panel__head strong {
  display: block;
  color: #0f172a;
  font-size: 15px;
}

.test-goal-trace-panel__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.test-goal-trace-panel__meta span {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.08);
  color: #4338ca;
  font-size: 12px;
  font-weight: 600;
}

.test-goal-trace-panel__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-goal-trace-panel__label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
}

.test-goal-trace-panel pre,
.test-goal-trace-attempt pre {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

.test-goal-trace-panel__details {
  margin-top: 14px;
}

.test-goal-trace-panel__details summary {
  cursor: pointer;
  font-weight: 700;
  color: #334155;
}

.test-goal-trace-panel__attempts {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.test-goal-trace-attempt {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-goal-trace-attempt__head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  color: #334155;
  font-size: 12px;
}

.test-goal-trace-attempt__head strong {
  font-size: 13px;
  color: #0f172a;
}

.test-goal-trace-attempt__head em {
  font-style: normal;
  color: #6366f1;
}

.test-goal-trace-attempt__failure {
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.test-goal-trace-attempt__violations {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.test-goal-trace-attempt__violations span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  font-size: 12px;
}

.test-goal-composer textarea {
  width: 100%;
  resize: none;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  padding: 14px 16px;
  font: inherit;
  color: #0f172a;
  outline: none;
}

.test-goal-composer textarea:focus {
  border-color: rgba(79, 70, 229, 0.44);
  box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.1);
}

.test-goal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  padding: 11px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
}

.test-goal-btn--primary {
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  color: #ffffff;
}

.test-goal-btn--ghost {
  background: rgba(255, 255, 255, 0.76);
  border-color: rgba(148, 163, 184, 0.24);
  color: #334155;
}

.test-goal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-goal-loading {
  display: inline-flex;
  gap: 8px;
}

.test-goal-loading span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #6366f1;
  animation: test-goal-bounce 1.1s infinite ease-in-out;
}

.test-goal-loading span:nth-child(2) {
  animation-delay: 0.12s;
}

.test-goal-loading span:nth-child(3) {
  animation-delay: 0.24s;
}

@keyframes test-goal-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

@media (max-width: 1100px) {
  .test-goal-shell {
    grid-template-columns: 1fr;
  }

  .test-goal-card--chat {
    min-height: auto;
  }
}

@media (max-width: 768px) {
  .test-goal-header__inner,
  .test-goal-shell {
    padding: 16px;
  }

  .test-goal-header__inner,
  .test-goal-chat-head,
  .test-goal-composer {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .test-goal-examples,
  .test-goal-stat-grid {
    grid-template-columns: 1fr;
  }

  .test-goal-message {
    max-width: 100%;
  }

  .test-goal-completion-card__actions,
  .test-goal-proposal__actions {
    flex-direction: column;
  }
}
</style>
