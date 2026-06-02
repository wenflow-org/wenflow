<template>
  <div class="test-learn-page" v-loading="pageLoading">
    <header class="test-learn-header" :class="{ 'test-learn-header--scrolled': headerScrolled }">
      <div class="test-learn-header__inner">
        <button type="button" class="test-learn-brand" @click="router.push('/admin/test/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="test-learn-brand__logo" />
          <span>测试授课页面</span>
        </button>

        <nav class="test-learn-nav" aria-label="测试站点导航">
          <router-link to="/admin/test/dashboard">测试学习台</router-link>
          <router-link to="/admin/test/goal-full">测试目标规划</router-link>
          <router-link to="/admin/test/learning-paths">测试学习路径</router-link>
          <router-link :to="pathDetailLink" class="is-active">测试授课页面</router-link>
        </nav>

        <div class="test-learn-header__actions">
          <button class="test-learn-btn test-learn-btn--ghost" @click="goBack">返回路径详情</button>
        </div>
      </div>
    </header>

    <main class="test-learn-shell">
      <div v-if="sessionInitializing" class="test-learn-card test-learn-empty">
        <el-icon class="spin"><Loading /></el-icon>
        <p>{{ sessionInitMessage }}</p>
      </div>

      <div v-else-if="task && task.learningPath?.canStartLearning === false" class="test-learn-card test-learn-blocked">
        <h2>等待阶段任务生成完成</h2>
        <p>{{ task.learningPath?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习。' }}</p>
        <button class="test-learn-btn test-learn-btn--primary" @click="goBack">返回路径详情</button>
      </div>

      <div v-else-if="sessionPaused" class="test-learn-card test-learn-blocked">
        <h2>授课已暂停</h2>
        <p>点击“继续”恢复刚才的测试会话。</p>
        <button class="test-learn-btn test-learn-btn--primary" @click="resumeSessionFromPause">继续</button>
      </div>

      <template v-else-if="task">
        <section class="test-learn-hero test-learn-card">
          <div>
            <span class="test-learn-eyebrow">测试授课</span>
            <h1>{{ task.title }}</h1>
            <p>{{ task.learningPath?.name || '当前任务测试页' }}</p>
            <div class="test-learn-chip-row">
              <span class="test-learn-chip">任务 ID: {{ taskId }}</span>
              <span class="test-learn-chip">会话 ID: {{ sessionInfo.sessionId || '--' }}</span>
              <span class="test-learn-chip">授课状态: {{ sessionActive ? '进行中' : '未开始' }}</span>
              <span class="test-learn-chip">检查点: {{ activeCheckpoint ? '进行中' : '无' }}</span>
            </div>
          </div>

          <div class="test-learn-hero__actions">
            <button v-if="!sessionActive && !sessionPaused" class="test-learn-btn test-learn-btn--primary" @click="startSession">开始</button>
            <button v-if="sessionPaused" class="test-learn-btn test-learn-btn--primary" @click="resumeSessionFromPause">继续</button>
            <button v-if="sessionActive" class="test-learn-btn test-learn-btn--ghost" @click="pauseSession">暂停</button>
            <button v-if="sessionInfo.sessionId" class="test-learn-btn test-learn-btn--ghost" @click="resetSession">重新开始</button>
          </div>
        </section>

        <section class="test-learn-grid">
          <aside class="test-learn-sidebar">
            <section class="test-learn-card">
              <span class="test-learn-eyebrow">会话状态</span>
              <div class="test-learn-kv-list">
                <div class="test-learn-kv"><span>主题</span><strong>{{ sessionInfo.topic || '--' }}</strong></div>
                <div class="test-learn-kv"><span>消息数</span><strong>{{ messages.length }}</strong></div>
                <div class="test-learn-kv"><span>已用时长</span><strong>{{ formatTime(activeTime) }}</strong></div>
                <div class="test-learn-kv"><span>知识点数</span><strong>{{ knowledgePoints.length }}</strong></div>
              </div>
            </section>

            <section class="test-learn-card">
              <span class="test-learn-eyebrow">任务上下文</span>
              <div class="test-learn-kv-list">
                <div class="test-learn-kv"><span>任务类型</span><strong>{{ task.taskType || '--' }}</strong></div>
                <div class="test-learn-kv"><span>任务标签</span><strong>{{ task.displayLabel || '--' }}</strong></div>
                <div class="test-learn-kv"><span>知识类型</span><strong>{{ task.knowledgeType || '--' }}</strong></div>
                <div class="test-learn-kv"><span>认知层级</span><strong>{{ task.cognitiveLevel || '--' }}</strong></div>
                <div class="test-learn-kv"><span>核心概念</span><strong>{{ task.coreConcept || '--' }}</strong></div>
              </div>
            </section>

            <section class="test-learn-card">
              <span class="test-learn-eyebrow">知识点状态</span>
              <div v-if="knowledgePoints.length > 0" class="test-learn-kp-list">
                <article v-for="(kp, idx) in knowledgePoints" :key="kp.name" class="test-learn-kp-item">
                  <div class="test-learn-kp-item__head">
                    <span>{{ idx + 1 }}</span>
                    <strong>{{ kp.name }}</strong>
                    <em>{{ kpStatusLabel(kp.status) }}</em>
                  </div>
                  <div class="test-learn-kp-item__bar">
                    <div class="test-learn-kp-item__fill" :style="{ width: `${kp.progress || 0}%` }"></div>
                  </div>
                </article>
              </div>
              <p v-else class="test-learn-empty-copy">本节尚未返回知识点状态。</p>
            </section>

            <section v-if="activeCheckpoint" class="test-learn-card">
              <span class="test-learn-eyebrow">Pending Checkpoint</span>
              <strong>{{ activeCheckpoint.title }}</strong>
              <p>{{ activeCheckpoint.question }}</p>
              <div class="test-learn-chip-row">
                <span class="test-learn-chip">type: {{ activeCheckpoint.type }}</span>
                <span class="test-learn-chip">allowSkip: {{ activeCheckpoint.allowSkip ? 'true' : 'false' }}</span>
              </div>
            </section>
          </aside>

          <section class="test-learn-main">
            <section class="test-learn-card">
              <div class="test-learn-section-head">
                <div>
                  <span class="test-learn-eyebrow">消息流</span>
                  <h2>授课对话</h2>
                </div>
              </div>

              <div class="test-learn-messages">
                <article v-for="(msg, index) in messages" :key="index" class="test-learn-message" :class="`test-learn-message--${msg.role}`">
                  <div class="test-learn-message__meta">
                    <span>{{ msg.role === 'user' ? '你' : 'AI' }}</span>
                    <small>{{ formatTimestamp(msg.timestamp) }}</small>
                  </div>
                  <div class="test-learn-message__body">
                    <MarkdownRenderer :content="msg.content" />
                    <div v-if="(msg as any).failed" class="test-learn-message__error">发送失败，可点击重试。</div>
                  </div>

                  <div v-if="msg.quickReplies && msg.quickReplies.length > 0 && !msg.quickRepliesUsed" class="test-learn-chip-row">
                    <button v-for="reply in msg.quickReplies" :key="reply.text" class="test-learn-chip test-learn-chip--button" @click="useOpeningQuickReply(reply.text, index)">
                      {{ reply.text }}
                    </button>
                  </div>

                  <div v-if="msg.analysis || msg.strategies?.length || msg.knowledgePoint" class="test-learn-debug-box">
                    <div class="test-learn-kv-list">
                      <div class="test-learn-kv"><span>knowledgePoint</span><strong>{{ msg.knowledgePoint || '--' }}</strong></div>
                      <div class="test-learn-kv"><span>cognitiveLevel</span><strong>{{ msg.analysis?.cognitiveLevel || '--' }}</strong></div>
                      <div class="test-learn-kv"><span>understanding</span><strong>{{ msg.analysis?.understanding || '--' }}</strong></div>
                    </div>
                    <div v-if="msg.strategies?.length" class="test-learn-chip-row">
                      <span v-for="strategy in msg.strategies" :key="strategy" class="test-learn-chip">{{ strategyLabel(strategy) }}</span>
                    </div>
                  </div>

                  <details v-if="msg.role === 'assistant' && getLearningTraceCard(msg)" class="test-learn-trace">
                    <summary class="test-learn-trace__summary">
                      {{ getLearningTraceSummaryLabel(msg) }}
                    </summary>

                    <template v-if="getLearningTraceCard(msg)">
                      <div class="test-learn-trace__meta">
                        <span>{{ getLearningTraceCard(msg)?.kindLabel }}</span>
                        <span>{{ getLearningTraceCard(msg)?.summary }}</span>
                        <span v-if="getLearningTraceCard(msg)?.promptVersionLabel">{{ getLearningTraceCard(msg)?.promptVersionLabel }}</span>
                      </div>

                      <div v-if="getLearningTraceCard(msg)?.metricChips.length" class="test-learn-trace__metric-grid">
                        <article
                          v-for="metric in getLearningTraceCard(msg)?.metricChips || []"
                          :key="metric.label"
                          class="test-learn-trace__metric"
                        >
                          <span>{{ metric.label }}</span>
                          <strong>{{ metric.value }}</strong>
                        </article>
                      </div>

                      <div v-if="(getLearningTraceCard(msg)?.inputSections.length || 0) > 0" class="test-learn-trace__group">
                        <span class="test-learn-trace__group-title">本轮输入</span>
                        <div v-for="section in getLearningTraceCard(msg)?.inputSections || []" :key="`input-${section.key}`" class="test-learn-trace__section">
                          <span class="test-learn-trace__label">{{ section.label }}</span>
                          <pre>{{ section.content }}</pre>
                        </div>
                      </div>

                      <div v-if="(getLearningTraceCard(msg)?.outputSections.length || 0) > 0" class="test-learn-trace__group">
                        <span class="test-learn-trace__group-title">本轮输出</span>
                        <div v-for="section in getLearningTraceCard(msg)?.outputSections || []" :key="`output-${section.key}`" class="test-learn-trace__section">
                          <span class="test-learn-trace__label">{{ section.label }}</span>
                          <pre>{{ section.content }}</pre>
                        </div>
                      </div>

                      <section v-if="getLearningTraceCard(msg)?.peerCard" class="test-learn-trace__peer">
                        <div class="test-learn-trace__peer-head">
                          <div>
                            <span class="test-learn-trace__peer-eyebrow">伴学介入</span>
                            <strong>{{ getLearningTraceCard(msg)?.peerCard?.title }}</strong>
                          </div>
                          <span class="test-learn-trace__peer-badge">skill:peer-reinforcement</span>
                        </div>

                        <div v-if="getLearningTraceCard(msg)?.peerCard?.summary" class="test-learn-trace__peer-summary">
                          {{ getLearningTraceCard(msg)?.peerCard?.summary }}
                        </div>

                        <div v-for="section in getLearningTraceCard(msg)?.peerCard?.sections || []" :key="section.key" class="test-learn-trace__section">
                          <span class="test-learn-trace__label">{{ section.label }}</span>
                          <pre>{{ section.content }}</pre>
                        </div>
                      </section>
                    </template>
                  </details>

                  <div class="test-learn-message__actions">
                    <button class="test-learn-btn test-learn-btn--inline" @click="copyMessage(msg.content)">复制</button>
                    <button v-if="(msg as any).failed" class="test-learn-btn test-learn-btn--inline" @click="retryMessage(index)">重试</button>
                  </div>
                </article>

                <article v-if="aiLoading" class="test-learn-message test-learn-message--assistant">
                  <div class="test-learn-message__meta"><span>AI</span></div>
                  <div class="test-learn-message__body test-learn-message__body--loading">
                    <el-icon class="spin"><Loading /></el-icon>
                    <span>思考中...</span>
                  </div>
                </article>
              </div>

              <div v-if="showCompletionPrompt" class="test-learn-completion">
                <span>已达到本节完成条件</span>
                <div class="test-learn-chip-row">
                  <button class="test-learn-btn test-learn-btn--ghost" @click="dismissCompletionPrompt">继续</button>
                  <button class="test-learn-btn test-learn-btn--primary" @click="confirmCompletionEnd">完成并评估</button>
                </div>
              </div>
            </section>

            <section v-if="latestPromptDebug" class="test-learn-card">
              <div class="test-learn-section-head">
                <div>
                  <span class="test-learn-eyebrow">提示词调试</span>
                  <h2>最近一轮教学调用</h2>
                </div>
              </div>

              <div class="test-learn-kv-list">
                <div class="test-learn-kv"><span>Agent ID</span><strong>{{ latestPromptDebug.agentId || '--' }}</strong></div>
                <div class="test-learn-kv"><span>提示词版本</span><strong>{{ latestPromptDebug.systemPromptVersion ?? '--' }}</strong></div>
                <div class="test-learn-kv"><span>耗时</span><strong>{{ latestPromptDebug.durationMs ?? '--' }}</strong></div>
                <div class="test-learn-kv"><span>尝试次数</span><strong>{{ latestPromptDebug.attempts?.length || 0 }}</strong></div>
              </div>

              <div v-if="latestTeachingTraceCard" class="test-learn-trace-panel">
                <div class="test-learn-trace-panel__head">
                  <div>
                    <span class="test-learn-eyebrow">结构化摘要</span>
                    <strong>{{ latestTeachingTraceCard.summary }}</strong>
                  </div>
                  <div class="test-learn-trace-panel__meta">
                    <span>{{ latestTeachingTraceCard.kindLabel }}</span>
                    <span v-if="latestTeachingTraceCard.promptVersionLabel">{{ latestTeachingTraceCard.promptVersionLabel }}</span>
                  </div>
                </div>

                <div v-if="latestTeachingTraceCard.metricChips.length" class="test-learn-trace__metric-grid">
                  <article
                    v-for="metric in latestTeachingTraceCard.metricChips"
                    :key="`latest-${metric.label}`"
                    class="test-learn-trace__metric"
                  >
                    <span>{{ metric.label }}</span>
                    <strong>{{ metric.value }}</strong>
                  </article>
                </div>

                <div v-if="latestTeachingTraceCard.inputSections.length" class="test-learn-trace__group">
                  <span class="test-learn-trace__group-title">本轮输入</span>
                  <div v-for="section in latestTeachingTraceCard.inputSections" :key="`latest-input-${section.key}`" class="test-learn-trace__section">
                    <span class="test-learn-trace__label">{{ section.label }}</span>
                    <pre>{{ section.content }}</pre>
                  </div>
                </div>

                <div v-if="latestTeachingTraceCard.outputSections.length" class="test-learn-trace__group">
                  <span class="test-learn-trace__group-title">本轮输出</span>
                  <div v-for="section in latestTeachingTraceCard.outputSections" :key="`latest-output-${section.key}`" class="test-learn-trace__section">
                    <span class="test-learn-trace__label">{{ section.label }}</span>
                    <pre>{{ section.content }}</pre>
                  </div>
                </div>

                <section v-if="latestTeachingTraceCard.peerCard" class="test-learn-trace__peer">
                  <div class="test-learn-trace__peer-head">
                    <div>
                      <span class="test-learn-trace__peer-eyebrow">伴学介入</span>
                      <strong>{{ latestTeachingTraceCard.peerCard.title }}</strong>
                    </div>
                    <span class="test-learn-trace__peer-badge">skill:peer-reinforcement</span>
                  </div>

                  <div v-if="latestTeachingTraceCard.peerCard.summary" class="test-learn-trace__peer-summary">
                    {{ latestTeachingTraceCard.peerCard.summary }}
                  </div>

                  <div v-for="section in latestTeachingTraceCard.peerCard.sections" :key="`latest-peer-${section.key}`" class="test-learn-trace__section">
                    <span class="test-learn-trace__label">{{ section.label }}</span>
                    <pre>{{ section.content }}</pre>
                  </div>
                </section>
              </div>

              <div v-if="latestSessionStateSections.length" class="test-learn-trace-panel">
                <div class="test-learn-trace-panel__head">
                  <div>
                    <span class="test-learn-eyebrow">课堂状态</span>
                    <strong>当前会话状态</strong>
                  </div>
                </div>

                <div v-for="section in latestSessionStateSections" :key="`session-${section.key}`" class="test-learn-trace__section">
                  <span class="test-learn-trace__label">{{ section.label }}</span>
                  <pre>{{ section.content }}</pre>
                </div>
              </div>

              <details class="test-learn-raw-panel" open>
                <summary>展开 userPayload</summary>
                <pre>{{ latestPromptDebug.userPayload }}</pre>
              </details>

              <details class="test-learn-raw-panel">
                <summary>展开 rawModelOutput</summary>
                <pre>{{ latestPromptDebug.rawModelOutput }}</pre>
              </details>

              <details class="test-learn-raw-panel">
                <summary>展开 normalizedOutput</summary>
                <pre>{{ JSON.stringify(latestPromptDebug.normalizedOutput, null, 2) }}</pre>
              </details>
            </section>

            <section v-if="activeCheckpoint" class="test-learn-card">
              <div class="test-learn-section-head">
                <div>
                  <span class="test-learn-eyebrow">检查点</span>
                  <h2>{{ activeCheckpoint.title }}</h2>
                </div>
              </div>

              <CheckpointCard
                ref="checkpointRef"
                :checkpoint="activeCheckpoint"
                :submitting="checkpointSubmitting"
                @submit="handleCheckpointSubmit"
                @skip="handleCheckpointSkip"
                @continue="handleCheckpointContinue"
                @review="handleCheckpointReview"
                @retry="handleCheckpointRetry"
              />
            </section>

            <section class="test-learn-card">
              <div class="test-learn-composer">
                <el-input
                  v-model="userInput"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 4 }"
                  placeholder="输入测试消息… (Ctrl+Enter 发送)"
                  @keydown.ctrl.enter="sendMessage"
                  :disabled="aiLoading || !sessionInfo.sessionId"
                />
                <button class="test-learn-btn test-learn-btn--primary" :disabled="!userInput.trim() || aiLoading || !sessionInfo.sessionId" @click="sendMessage">发送</button>
              </div>
            </section>
          </section>
        </section>

        <PeerNotification
          :visible="peerNotificationVisible"
          @click="openPeerChatFromNotification"
          @close="peerNotificationVisible = false"
        />
        <PeerChatWindow
          :visible="peerChatWindowVisible"
          :messages="peerChatMessages"
          :loading="peerInitializing"
          @send="handlePeerChatSend"
          @close="peerChatWindowVisible = false"
        />
        <button
          v-if="peerChatMessages.length > 0 && !peerChatWindowVisible"
          class="test-learn-peer-float"
          @click="peerChatWindowVisible = true"
        >同伴讨论</button>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Loading } from '@element-plus/icons-vue';
import { toast } from '@/utils/toast';
import { aiTeachingAPI, type Checkpoint, type CheckpointSubmitPayload, type CheckpointSubmitResult, type KnowledgePointStatus, type WrapupArtifact, type ReplanAdvisory } from '@/api/aiTeaching';
import api, { API_BASE_URL } from '@/utils/api';
import CheckpointCard from '@/components/learning/CheckpointCard.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import PeerNotification from '@/components/PeerNotification.vue';
import PeerChatWindow from '@/components/PeerChatWindow.vue';

const route = useRoute();
const router = useRouter();
const taskId = computed(() => route.params.taskId as string);
const pathId = computed(() => (route.query.pathId as string) || '');
const pathDetailLink = computed(() => pathId.value ? `/admin/test/learning-path/${pathId.value}` : '/admin/test/learning-paths');

const pageLoading = ref(true);
const task = ref<any>(null);
const sessionInitializing = ref(false);
const sessionInitMode = ref<'new' | 'resumed'>('new');
const sessionActive = ref(false);
const sessionPaused = ref(false);
const sessionInfo = ref({ sessionId: '', subject: '', topic: '', difficulty: 5 });

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
  inputSections: TraceSectionView[];
  outputSections: TraceSectionView[];
  peerCard?: LearningPeerTraceCard | null;
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref('');
const aiLoading = ref(false);
const checkpointRef = ref<InstanceType<typeof CheckpointCard> | null>(null);
const activeCheckpoint = ref<Checkpoint | null>(null);
const checkpointSubmitting = ref(false);
const knowledgePoints = ref<KnowledgePointStatus[]>([]);
const latestPromptDebug = ref<any | null>(null);
const sessionDetailState = ref<any | null>(null);
const sessionWrapup = ref<WrapupArtifact | null>(null);
const sessionAdvisory = ref<ReplanAdvisory | null>(null);
const showCompletionPrompt = ref(false);
const peerNotificationVisible = ref(false);
const peerChatWindowVisible = ref(false);
const peerChatMessages = ref<Array<{ role: 'user' | 'peer'; content: string; timestamp: string }>>([]);
const peerInitializing = ref(false);
const elapsedTime = ref(0);
const activeTime = ref(0);
let timerInterval: number | null = null;
const lastActivityTime = ref(Date.now());
const autoPausing = ref(false);
const headerScrolled = ref(false);

const sessionInitMessage = computed(() => sessionInitMode.value === 'resumed' ? '正在恢复上次授课进度...' : '正在初始化授课会话...');

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

const strategyLabel = (id: string) => STRATEGY_LABELS[id] || id;
const kpStatusLabel = (status: string) => ({ mastered: '已掌握', learning: '学习中', pending: '待学习', review: '待复习' }[status] || status);
const formatTimestamp = (timestamp?: string) => timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

const getLearnDebug = (msg: any) => {
  const value = msg?.promptDebug?.learnDebug;
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
    inputSections: [],
    outputSections: sections,
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

const buildTurnDebugSummary = (msg: any) => {
  const payload = getPromptDebugPayload(msg);
  if (!payload) {
    return '查看这一轮的 teaching-turn 输入输出';
  }

  const coreConcept = payload?.scenario?.cognitiveFrame?.currentCoreConcept?.name || payload?.scenario?.taskProfile?.coreConcept || '';
  const learnerMessage = typeof payload?.latestLearnerMessage === 'string' ? payload.latestLearnerMessage : '';
  return [coreConcept, learnerMessage ? `最近输入：${learnerMessage}` : ''].filter(Boolean).join(' · ') || '查看这一轮的 teaching-turn 输入输出';
};

const buildTeachingTurnTraceCard = (msg: ChatMessage): LearningTraceCard | null => {
  const payload = getPromptDebugPayload(msg);
  const normalized = getPromptDebugNormalizedOutput(msg);
  const learnDebug = getLearnDebug(msg);
  const analysis = resolveDebugAnalysis(msg);
  const knowledgePoint = resolveDebugKnowledgePoint(msg);
  const strategies = resolveDebugStrategies(msg);

  if (!payload && !normalized && !learnDebug && !analysis && !knowledgePoint && strategies.length === 0 && !msg.peerTriggered && !msg.peerMessage && !msg.peerDebug) {
    return null;
  }

  const inputSections = [
    buildTraceSection('pathBackgroundContext', '路径背景上下文', learnDebug?.input?.pathBackgroundContext || null),
    buildTraceSection('classroomContext', '课堂上下文', learnDebug?.input?.classroomContext || null),
    buildTraceSection('learnerStateContext', '学习者状态上下文', learnDebug?.input?.learnerStateContext || null),
    buildTraceSection('classroomEventContext', '课堂事件上下文', learnDebug?.input?.classroomEventContext || null),
    buildTraceSection('teachingControlContext', '教学控制上下文', learnDebug?.input?.teachingControlContext || null),
    buildTraceSection('latestLearnerMessage', '本轮用户输入', payload?.latestLearnerMessage || null),
    buildTraceSection('taskProfile', '任务画像 taskProfile', payload?.scenario?.taskProfile || null),
    buildTraceSection('cognitiveFrame', '局部认知图景 cognitiveFrame', payload?.scenario?.cognitiveFrame || null),
    buildTraceSection('knowledgeBoard', '当前知识看板 knowledge', payload?.knowledge || null),
  ].filter(Boolean) as TraceSectionView[];

  const outputSections = [
    buildTraceSection('visibleReply', '可见回复', msg.content),
    buildTraceSection('stageDecision', '本轮阶段决策', learnDebug?.output?.stageDecision || null),
    buildTraceSection('completionCandidateEvidence', '完成判定依据', learnDebug?.output?.completionCandidateEvidence || normalized?.control?.completionCandidateEvidence || null),
    buildTraceSection('classroomContextAfter', '本轮后课堂上下文', learnDebug?.output?.classroomContext || null),
    buildTraceSection('learnerStateAfter', '本轮后学习者状态', learnDebug?.output?.learnerStateContext || null),
    buildTraceSection('knowledgeStateAfter', '本轮后知识状态', learnDebug?.output?.knowledgeState || null),
    buildTraceSection('auxiliaryActions', '辅助动作决策', learnDebug?.output?.auxiliaryActions || null),
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
    inputSections,
    outputSections,
    peerCard: buildPeerTraceCard(msg),
  };
};

const getLearningTraceCard = (msg: ChatMessage): LearningTraceCard | null => {
  const openingCard = buildOpeningTraceCard(msg);
  if (openingCard) return openingCard;
  return buildTeachingTurnTraceCard(msg);
};

const getLearningTraceSummaryLabel = (msg: ChatMessage) => {
  const card = getLearningTraceCard(msg);
  if (!card) return '查看本轮教学输入与输出';
  if (card.kind === 'opening') return '查看开场交互块';
  return card.peerCard ? '查看本轮教学输入、输出与伴学介入' : '查看本轮教学输入与输出';
};

const latestTeachingTraceCard = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const msg = messages.value[index];
    if (msg.role === 'assistant') {
      const card = getLearningTraceCard(msg);
      if (card) return card;
    }
  }
  return null;
});

const latestSessionStateSections = computed(() => {
  const state = sessionDetailState.value;
  if (!state || typeof state !== 'object') return [];

  return [
    buildTraceSection('classroomContext', '课堂上下文', state.classroomContext || null),
    buildTraceSection('learnerStateContext', '学习者状态上下文', state.learnerStateContext || null),
    buildTraceSection('teachingControlContext', '教学控制上下文', state.teachingControlContext || null),
    buildTraceSection('stageHistory', '阶段轨迹', state.stageHistory || null),
    buildTraceSection('classroomEventHistory', '课堂事件历史', state.classroomEventHistory || null),
  ].filter(Boolean) as TraceSectionView[];
});

const handleScroll = () => { headerScrolled.value = window.scrollY > 20; };

const copyMessage = async (content: string) => {
  try {
    await navigator.clipboard.writeText(content);
    toast.success('已复制到剪贴板');
  } catch {
    toast.error('复制失败');
  }
};

const loadTaskData = async () => {
  if (!taskId.value) return;
  pageLoading.value = true;
  try {
    const response = await api.get(`/learning/tasks/${taskId.value}`);
    task.value = response.data || response;
  } catch (error: any) {
    toast.error(error.message || '加载任务失败');
  } finally {
    pageLoading.value = false;
  }
};

const resetSessionState = () => {
  stopTimer();
  messages.value = [];
  knowledgePoints.value = [];
  activeCheckpoint.value = null;
  latestPromptDebug.value = null;
  sessionDetailState.value = null;
  sessionWrapup.value = null;
  sessionAdvisory.value = null;
  showCompletionPrompt.value = false;
  peerChatMessages.value = [];
  peerNotificationVisible.value = false;
  peerChatWindowVisible.value = false;
  elapsedTime.value = 0;
  activeTime.value = 0;
  sessionPaused.value = false;
};

const persistPauseOnPageHide = () => {
  if (!sessionInfo.value.sessionId || !sessionActive.value || autoPausing.value) return;
  const token = localStorage.getItem('token');
  if (!token) return;
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

const startTimer = () => {
  stopTimer();
  timerInterval = window.setInterval(() => {
    elapsedTime.value += 1;
    if (Date.now() - lastActivityTime.value < 60 * 1000) {
      activeTime.value += 1;
    }
  }, 1000);
};

const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
};

const resumeSession = async (sessionId: string) => {
  const detail = await aiTeachingAPI.getSessionDetail(sessionId);
  if (!detail) {
    throw new Error('继续授课失败，未找到会话详情');
  }
  resetSessionState();
  sessionInfo.value = {
    sessionId,
    subject: detail.subject,
    topic: detail.topic,
    difficulty: 5,
  };
    messages.value = detail.messages as ChatMessage[];
    knowledgePoints.value = detail.knowledgePoints || [];
    sessionDetailState.value = detail.state || null;
    activeCheckpoint.value = detail.pendingCheckpoint || null;
    latestPromptDebug.value = null;
    showCompletionPrompt.value = false;
    sessionPaused.value = false;
    sessionActive.value = true;
    sessionInitializing.value = false;
    startTimer();
    toast.success('已恢复测试授课进度');
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
      difficulty: 5,
    };
    sessionActive.value = true;
    sessionInitializing.value = false;
    messages.value.push({
      role: 'assistant',
      content: session.opening?.message ? `${session.opening.message}\n\n${session.opening.question}` : session.welcomeMessage,
      timestamp: new Date().toISOString(),
      quickReplies: session.opening?.quickReplies || [],
      quickRepliesUsed: false,
    });
    startTimer();
    toast.success('测试授课会话已开始，课程进度将在 48 小时内保留');
  } catch (error: any) {
    sessionInitializing.value = false;
    toast.error(error.message || '开始会话失败');
  }
};

const sendMessage = async () => {
  const text = userInput.value.trim();
  if (!text || aiLoading.value || !sessionInfo.value.sessionId) return;
  lastActivityTime.value = Date.now();
  messages.value.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
  userInput.value = '';
  aiLoading.value = true;
  try {
    const result = await aiTeachingAPI.sendMessage(sessionInfo.value.sessionId, text);
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
    if (result.knowledgePoints && result.knowledgePoints.length > 0) knowledgePoints.value = result.knowledgePoints;
    latestPromptDebug.value = result.promptDebug || null;
    if (result.autoEnded && result.wrapup) {
      sessionActive.value = false;
      sessionPaused.value = false;
      sessionWrapup.value = result.wrapup;
      sessionAdvisory.value = result.advisory || null;
      stopTimer();
      toast.success('本节课已自动结束并生成评估');
      router.push({
        path: `/admin/test/learn/${taskId.value}/evaluation/${sessionInfo.value.sessionId}`,
        query: pathId.value ? { pathId: pathId.value } : undefined,
      });
      return;
    }
    if (result.promptDebug?.learnDebug?.output) {
      sessionDetailState.value = {
        ...(sessionDetailState.value || {}),
        classroomContext: result.promptDebug.learnDebug.output.classroomContext || sessionDetailState.value?.classroomContext,
        learnerStateContext: result.promptDebug.learnDebug.output.learnerStateContext || sessionDetailState.value?.learnerStateContext,
      };
    }
    if (result.isCompletion) {
      showCompletionPrompt.value = true;
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
    if (result.checkpoint) {
      activeCheckpoint.value = result.checkpoint;
      nextTick(() => checkpointRef.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }));
    }
  } catch (error: any) {
    toast.error(error.message || '发送消息失败');
    const lastMsg = messages.value[messages.value.length - 1];
    if (lastMsg?.role === 'user') (lastMsg as any).failed = true;
  } finally {
    aiLoading.value = false;
  }
};

const retryMessage = async (index: number) => {
  const msg = messages.value[index];
  if (!msg || msg.role !== 'user') return;
  messages.value.splice(index, 1);
  userInput.value = msg.content;
  await sendMessage();
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
    const result = await aiTeachingAPI.submitCheckpoint(sessionInfo.value.sessionId, activeCheckpoint.value.id, payload);
    checkpointRef.value?.applyResult(result as CheckpointSubmitResult);
    toast[result.passed ? 'success' : 'info'](result.passed ? '小检核已通过' : '已收到检核反馈，可继续优化答案');
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
const handleCheckpointContinue = () => { activeCheckpoint.value = null; };
const handleCheckpointReview = () => {
  userInput.value = '我想回顾一下刚才这个知识点，请你用更直观的方式再讲一遍。';
  activeCheckpoint.value = null;
};
const handleCheckpointRetry = () => { toast.info('你可以重新作答这道题'); };

const dismissCompletionPrompt = () => {
  showCompletionPrompt.value = false;
};

const confirmCompletionEnd = async () => {
  if (!sessionInfo.value.sessionId) return;
  try {
    const result = await aiTeachingAPI.endSession(sessionInfo.value.sessionId);
    showCompletionPrompt.value = false;
    sessionActive.value = false;
    sessionPaused.value = false;
    stopTimer();
    toast.success(result.wrapup?.evaluation ? '测试评估已生成' : '测试总结已生成');
    router.push({
      path: `/admin/test/learn/${taskId.value}/evaluation/${sessionInfo.value.sessionId}`,
      query: pathId.value ? { pathId: pathId.value } : undefined,
    });
  } catch (error: any) {
    toast.error(error.message || '结束测试会话失败');
  }
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

  const hasPeerMessage = peerChatMessages.value.some((msg) => msg.role === 'peer');
  if (hasPeerMessage) {
    return;
  }

  const latestUserMessage = [...messages.value]
    .reverse()
    .find((msg) => msg.role === 'user' && msg.content?.trim())?.content;

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

const pauseSession = async () => {
  if (!sessionInfo.value.sessionId) return;
  try {
    await aiTeachingAPI.pauseSession(sessionInfo.value.sessionId, 'manual');
    sessionPaused.value = true;
    sessionActive.value = false;
    stopTimer();
    toast.success('授课已暂停');
  } catch (error: any) {
    toast.error(error.message || '暂停授课失败');
  }
};

const resetSession = async () => {
  if (!sessionInfo.value.sessionId) return;
  try {
    await aiTeachingAPI.resetSession(sessionInfo.value.sessionId);
    resetSessionState();
    sessionInfo.value = { sessionId: '', subject: '', topic: '', difficulty: 5 };
    sessionActive.value = false;
    sessionPaused.value = false;
    toast.success('已重新开始授课会话');
  } catch (error: any) {
    toast.error(error.message || '重新开始授课失败');
  }
};

const resumeSessionFromPause = async () => {
  if (!sessionInfo.value.sessionId) return;
  sessionInitMode.value = 'resumed';
  sessionInitializing.value = true;
  try {
    await resumeSession(sessionInfo.value.sessionId);
    toast.success('已继续授课');
  } catch (error: any) {
    sessionInitializing.value = false;
    toast.error(error.message || '继续授课失败');
  }
};

const goBack = () => {
  if (sessionActive.value || sessionPaused.value) {
    void pauseSession().finally(() => {
      router.push(pathDetailLink.value);
    });
    return;
  }
  router.push(pathDetailLink.value);
};

onMounted(async () => {
  await loadTaskData();
  if (task.value?.status === 'completed') {
    toast.info('本任务已完成，请返回路径详情查看评估');
    router.replace(pathDetailLink.value);
    return;
  }
  if (task.value && task.value.learningPath?.canStartLearning !== false) {
    await startSession();
  }
  window.addEventListener('scroll', handleScroll);
  window.addEventListener('pagehide', persistPauseOnPageHide);
  window.addEventListener('beforeunload', persistPauseOnPageHide);
});

onUnmounted(() => {
  stopTimer();
  window.removeEventListener('scroll', handleScroll);
  window.removeEventListener('pagehide', persistPauseOnPageHide);
  window.removeEventListener('beforeunload', persistPauseOnPageHide);
});
</script>

<style scoped>
.test-learn-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fb 100%);
  color: #172033;
}

.test-learn-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(205, 216, 238, 0.9);
}

.test-learn-header--scrolled {
  box-shadow: 0 8px 20px rgba(42, 72, 128, 0.05);
}

.test-learn-header__inner,
.test-learn-shell {
  width: min(1280px, calc(100% - 48px));
  margin: 0 auto;
}

.test-learn-header__inner {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.test-learn-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 900;
  color: #172033;
  cursor: pointer;
}

.test-learn-brand__logo {
  height: 52px;
}

.test-learn-nav {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid rgba(205, 216, 238, 0.9);
}

.test-learn-nav a {
  padding: 8px 12px;
  border-radius: 999px;
  color: #66758d;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.test-learn-nav a.is-active,
.test-learn-nav a.router-link-active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.test-learn-shell {
  padding: 24px 0 72px;
}

.test-learn-card,
.test-learn-empty,
.test-learn-blocked,
.test-learn-hero,
.test-learn-message,
.test-learn-debug-box,
.test-learn-raw-panel {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 250, 255, 0.94));
  border: 1px solid rgba(205, 216, 238, 0.9);
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
  border-radius: 22px;
}

.test-learn-raw-panel {
  margin-top: 12px;
  padding: 14px 16px;
}

.test-learn-raw-panel summary {
  cursor: pointer;
  font-weight: 700;
  color: #1f57cc;
}

.test-learn-raw-panel pre {
  margin: 12px 0 0;
  padding: 14px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 16px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}

.test-learn-empty,
.test-learn-blocked {
  min-height: 240px;
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 22px;
  text-align: center;
}

.test-learn-completion {
  margin-top: 16px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(103, 194, 58, 0.1);
  border: 1px solid rgba(103, 194, 58, 0.18);
  display: grid;
  gap: 10px;
}

.test-learn-peer-float {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 40;
  border: 0;
  border-radius: 999px;
  padding: 12px 16px;
  background: #67c23a;
  color: #fff;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 18px 40px rgba(103, 194, 58, 0.28);
}

.test-learn-hero,
.test-learn-card {
  padding: 18px 20px;
}

.test-learn-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}

.test-learn-eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
  font-size: 12px;
  font-weight: 900;
}

.test-learn-hero h1,
.test-learn-section-head h2,
.test-learn-blocked h2 {
  margin: 10px 0 8px;
  font-size: clamp(28px, 3vw, 38px);
  line-height: 1.12;
}

.test-learn-hero p,
.test-learn-blocked p,
.test-learn-empty-copy,
.test-learn-message__error {
  margin: 0;
  color: #66758d;
  line-height: 1.7;
  font-size: 14px;
}

.test-learn-grid {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 20px;
}

.test-learn-sidebar,
.test-learn-main,
.test-learn-kv-list,
.test-learn-kp-list,
.test-learn-messages {
  display: grid;
  gap: 16px;
}

.test-learn-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.test-learn-kv span {
  color: #66758d;
  font-size: 12px;
  font-weight: 700;
}

.test-learn-kv strong {
  color: #172033;
  font-size: 13px;
}

.test-learn-chip-row,
.test-learn-hero__actions,
.test-learn-message__actions,
.test-learn-composer {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.test-learn-chip {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #4d5b72;
  font-size: 12px;
  font-weight: 700;
  border: 0;
}

.test-learn-chip--button {
  cursor: pointer;
}

.test-learn-kp-item {
  display: grid;
  gap: 8px;
}

.test-learn-kp-item__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.test-learn-kp-item__head span {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(52, 120, 246, 0.1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #1f57cc;
  font-size: 12px;
  font-weight: 900;
}

.test-learn-kp-item__head em {
  margin-left: auto;
  font-style: normal;
  color: #66758d;
  font-size: 12px;
  font-weight: 700;
}

.test-learn-kp-item__bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  overflow: hidden;
}

.test-learn-kp-item__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
}

.test-learn-message {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
}

.test-learn-message--user {
  border-left: 4px solid rgba(52, 120, 246, 0.32);
}

.test-learn-message--assistant {
  border-left: 4px solid rgba(34, 197, 94, 0.28);
}

.test-learn-message__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: #66758d;
}

.test-learn-message__body {
  color: #172033;
}

.test-learn-message__body--loading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.test-learn-debug-box {
  padding: 12px;
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.04);
}

.test-learn-trace,
.test-learn-trace-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(31, 87, 204, 0.04);
  border: 1px solid rgba(31, 87, 204, 0.1);
}

.test-learn-trace__summary {
  cursor: pointer;
  color: #1f57cc;
  font-size: 13px;
  font-weight: 800;
}

.test-learn-trace__meta,
.test-learn-trace-panel__head,
.test-learn-trace-panel__meta,
.test-learn-trace__peer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.test-learn-trace__meta,
.test-learn-trace-panel__meta {
  color: #66758d;
  font-size: 12px;
}

.test-learn-trace__metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.test-learn-trace__metric {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.test-learn-trace__metric span,
.test-learn-trace__label,
.test-learn-trace__peer-eyebrow {
  color: #66758d;
  font-size: 12px;
  font-weight: 700;
}

.test-learn-trace__metric strong,
.test-learn-trace-panel__head strong,
.test-learn-trace__peer-head strong {
  color: #172033;
}

.test-learn-trace__section {
  display: grid;
  gap: 8px;
}

.test-learn-trace__group {
  display: grid;
  gap: 10px;
}

.test-learn-trace__group-title {
  color: #1f57cc;
  font-size: 13px;
  font-weight: 900;
}

.test-learn-trace__section pre {
  margin: 0;
  padding: 14px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 14px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}

.test-learn-trace__peer {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(103, 194, 58, 0.08);
  border: 1px solid rgba(103, 194, 58, 0.16);
}

.test-learn-trace__peer-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(103, 194, 58, 0.16);
  color: #2f7d1f;
  font-size: 12px;
  font-weight: 800;
}

.test-learn-trace__peer-summary {
  color: #3f4e66;
  line-height: 1.7;
  font-size: 13px;
}

.test-learn-section-head {
  margin-bottom: 12px;
}

.test-learn-composer {
  align-items: flex-end;
}

.test-learn-composer :deep(.el-textarea) {
  flex: 1;
}

.test-learn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.92);
  color: #172033;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.test-learn-btn--primary {
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  color: #fff;
}

.test-learn-btn--inline {
  min-height: 32px;
  padding-inline: 12px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1180px) {
  .test-learn-header__inner,
  .test-learn-shell {
    width: min(100% - 32px, 1280px);
  }

  .test-learn-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .test-learn-header__inner,
  .test-learn-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .test-learn-nav {
    flex-wrap: wrap;
  }
}

@media (max-width: 640px) {
  .test-learn-header__inner,
  .test-learn-shell {
    width: calc(100% - 24px);
  }

  .test-learn-nav {
    display: none;
  }

  .test-learn-card,
  .test-learn-empty,
  .test-learn-blocked,
  .test-learn-hero,
  .test-learn-message,
  .test-learn-debug-box {
    border-radius: 20px;
  }
}
</style>
