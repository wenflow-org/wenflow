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

      <template v-else-if="task">
        <section class="test-learn-hero test-learn-card">
          <div>
            <span class="test-learn-eyebrow">Learning Session Workbench</span>
            <h1>{{ task.title }}</h1>
            <p>{{ task.learningPath?.name || '当前任务测试页' }}</p>
            <div class="test-learn-chip-row">
              <span class="test-learn-chip">taskId: {{ taskId }}</span>
              <span class="test-learn-chip">sessionId: {{ sessionInfo.sessionId || '--' }}</span>
              <span class="test-learn-chip">sessionActive: {{ sessionActive ? 'true' : 'false' }}</span>
              <span class="test-learn-chip">checkpoint: {{ activeCheckpoint ? 'open' : 'none' }}</span>
            </div>
          </div>

          <div class="test-learn-hero__actions">
            <button v-if="!sessionActive && !sessionPaused" class="test-learn-btn test-learn-btn--primary" @click="startSession">开始测试授课</button>
            <button v-if="sessionPaused" class="test-learn-btn test-learn-btn--primary" @click="resumeSessionFromPause">恢复授课</button>
            <button v-if="sessionActive" class="test-learn-btn test-learn-btn--ghost" @click="pauseSession">暂停</button>
            <button v-if="sessionInfo.sessionId" class="test-learn-btn test-learn-btn--ghost" @click="resetSession">重置</button>
          </div>
        </section>

        <section class="test-learn-grid">
          <aside class="test-learn-sidebar">
            <section class="test-learn-card">
              <span class="test-learn-eyebrow">会话状态</span>
              <div class="test-learn-kv-list">
                <div class="test-learn-kv"><span>topic</span><strong>{{ sessionInfo.topic || '--' }}</strong></div>
                <div class="test-learn-kv"><span>messages</span><strong>{{ messages.length }}</strong></div>
                <div class="test-learn-kv"><span>elapsed</span><strong>{{ formatTime(activeTime) }}</strong></div>
                <div class="test-learn-kv"><span>knowledgePoints</span><strong>{{ knowledgePoints.length }}</strong></div>
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
            </section>

            <section v-if="activeCheckpoint" class="test-learn-card">
              <div class="test-learn-section-head">
                <div>
                  <span class="test-learn-eyebrow">Checkpoint Workbench</span>
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
                  placeholder="输入你的测试消息… (Ctrl+Enter 发送)"
                  @keydown.ctrl.enter="sendMessage"
                  :disabled="aiLoading || !sessionInfo.sessionId"
                />
                <button class="test-learn-btn test-learn-btn--primary" :disabled="!userInput.trim() || aiLoading || !sessionInfo.sessionId" @click="sendMessage">发送</button>
              </div>
            </section>
          </section>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Loading } from '@element-plus/icons-vue';
import { toast } from '@/utils/toast';
import { aiTeachingAPI, type Checkpoint, type CheckpointSubmitPayload, type CheckpointSubmitResult, type KnowledgePointStatus } from '@/api/aiTeaching';
import api, { API_BASE_URL } from '@/utils/api';
import CheckpointCard from '@/components/learning/CheckpointCard.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';

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
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref('');
const aiLoading = ref(false);
const checkpointRef = ref<InstanceType<typeof CheckpointCard> | null>(null);
const activeCheckpoint = ref<Checkpoint | null>(null);
const checkpointSubmitting = ref(false);
const knowledgePoints = ref<KnowledgePointStatus[]>([]);
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
    throw new Error('恢复授课失败，未找到会话详情');
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
  activeCheckpoint.value = detail.pendingCheckpoint || null;
  sessionPaused.value = false;
  sessionActive.value = true;
  sessionInitializing.value = false;
  startTimer();
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
    toast.success('测试授课会话已开始');
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
    });
    if (result.knowledgePoints && result.knowledgePoints.length > 0) knowledgePoints.value = result.knowledgePoints;
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
    toast.success('已重置授课会话');
  } catch (error: any) {
    toast.error(error.message || '重置授课失败');
  }
};

const resumeSessionFromPause = async () => {
  if (!sessionInfo.value.sessionId) return;
  sessionInitMode.value = 'resumed';
  sessionInitializing.value = true;
  try {
    await resumeSession(sessionInfo.value.sessionId);
    toast.success('已恢复授课');
  } catch (error: any) {
    sessionInitializing.value = false;
    toast.error(error.message || '恢复授课失败');
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
  window.addEventListener('scroll', handleScroll);
  window.addEventListener('pagehide', persistPauseOnPageHide);
});

onUnmounted(() => {
  stopTimer();
  window.removeEventListener('scroll', handleScroll);
  window.removeEventListener('pagehide', persistPauseOnPageHide);
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
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
}

.test-learn-header--scrolled {
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
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
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
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
  padding: 28px 0 80px;
}

.test-learn-card,
.test-learn-empty,
.test-learn-blocked,
.test-learn-hero,
.test-learn-message,
.test-learn-debug-box {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
  border-radius: 24px;
}

.test-learn-empty,
.test-learn-blocked {
  min-height: 240px;
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}

.test-learn-hero,
.test-learn-card {
  padding: 22px;
}

.test-learn-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
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
