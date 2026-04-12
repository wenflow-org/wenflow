<template>
  <div class="class-test-page">
    <header class="page-header">
      <div class="header-left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h1 class="page-title">AI 授课测试</h1>
      </div>
      <div class="header-right">
        <el-tag v-if="sessionActive" type="success" size="large">
          <el-icon><VideoPlay /></el-icon>
          授课中
        </el-tag>
        <el-tag v-else type="info" size="large">
          <el-icon><VideoPause /></el-icon>
          未开始
        </el-tag>
      </div>
    </header>

    <div v-if="!sessionActive" class="setup-panel">
      <el-card class="setup-card">
        <template #header>
          <div class="card-header">
            <el-icon><Setting /></el-icon>
            <span>配置授课会话</span>
          </div>
        </template>

        <el-tabs v-model="setupMode" class="setup-tabs">
          <el-tab-pane label="📂 从学习路径选择" name="path">
            <div v-loading="pathsLoading" class="path-selector">
              <el-empty v-if="!pathsLoading && learningPaths.length === 0" description="暂无学习路径，请先创建学习路径">
                <el-button type="primary" @click="$router.push('/goal-conversation')">去创建</el-button>
              </el-empty>

              <template v-if="learningPaths.length > 0">
                <el-form label-width="100px" class="setup-form">
                  <el-form-item label="学习路径">
                    <el-select
                      v-model="selectedPathId"
                      placeholder="选择学习路径"
                      clearable
                      @change="onPathChange"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="p in learningPaths"
                        :key="p.id"
                        :label="p.name || p.title || p.id"
                        :value="p.id"
                      >
                        <div class="path-option">
                          <span>{{ p.name || p.title || '未命名' }}</span>
                          <el-tag size="small" type="info">{{ p.subject || '综合' }}</el-tag>
                        </div>
                      </el-option>
                    </el-select>
                  </el-form-item>

                  <el-form-item v-if="selectedPathId" label="里程碑">
                    <el-select
                      v-model="selectedMilestoneId"
                      placeholder="选择里程碑"
                      clearable
                      @change="onMilestoneChange"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="m in currentMilestones"
                        :key="m.id"
                        :label="m.title || `阶段${m.stageNumber}`"
                        :value="m.id"
                      />
                    </el-select>
                  </el-form-item>

                  <el-form-item v-if="selectedMilestoneId" label="任务">
                    <el-select
                      v-model="selectedTaskId"
                      placeholder="选择任务"
                      clearable
                      @change="onTaskChange"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="t in currentTasks"
                        :key="t.id"
                        :label="t.title"
                        :value="t.id"
                      >
                        <div class="task-option">
                          <span>{{ t.title }}</span>
                          <el-tag v-if="t.taskType" size="small" type="info">{{ t.taskType }}</el-tag>
                        </div>
                      </el-option>
                    </el-select>
                  </el-form-item>

                  <el-form-item v-if="selectedTask" label="已选任务">
                    <el-alert
                      :title="selectedTask.title"
                      :description="selectedTask.description || '暂无描述'"
                      type="success"
                      :closable="false"
                      show-icon
                    />
                  </el-form-item>
                </el-form>
              </template>
            </div>
          </el-tab-pane>

          <el-tab-pane label="✏️ 手动输入" name="manual">
            <el-form :model="sessionForm" label-width="100px" class="setup-form">
              <el-form-item label="学科">
                <el-input
                  v-model="sessionForm.subject"
                  placeholder="例如：Python 编程、数学、英语"
                  clearable
                />
              </el-form-item>

              <el-form-item label="主题">
                <el-input
                  v-model="sessionForm.topic"
                  placeholder="例如：函数基础、二次方程、语法时态"
                  clearable
                />
              </el-form-item>

              <el-form-item label="难度">
                <el-slider
                  v-model="sessionForm.difficulty"
                  :min="1"
                  :max="10"
                  :step="1"
                  show-stops
                  :marks="{ 1: '入门', 5: '中等', 10: '困难' }"
                />
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>

        <div class="setup-actions">
          <el-button
            type="primary"
            size="large"
            @click="startSession"
            :loading="starting"
            :disabled="!canStart"
          >
            <el-icon><VideoPlay /></el-icon>
            开始授课
          </el-button>
        </div>
      </el-card>

      <el-card class="history-card" v-if="!viewingHistory">
        <template #header>
          <div class="card-header">
            <el-icon><Clock /></el-icon>
            <span>历史会话</span>
            <el-button text size="small" @click="loadHistory" style="margin-left: auto">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
        </template>

        <div v-loading="historyLoading" class="history-list">
          <el-empty v-if="!historyLoading && sessionHistory.length === 0" description="暂无历史会话" />

          <div
            v-for="item in sessionHistory"
            :key="item.id"
            class="history-item"
          >
            <div class="history-item-header" @click="viewSessionDetail(item.id)">
              <span class="history-item-title">{{ item.subject }} - {{ item.topic }}</span>
              <el-tag :type="item.status === 'completed' ? 'success' : 'info'" size="small">
                {{ item.status === 'completed' ? '已完成' : '进行中' }}
              </el-tag>
            </div>
            <div class="history-item-meta">
              <span>{{ formatDateTime(item.startTime) }}</span>
              <span>{{ item.duration ? formatTime(item.duration) : '--' }}</span>
              <span>{{ item.messageCount }} 条消息</span>
            </div>
            <div class="history-item-actions">
              <el-button size="small" type="primary" @click="continueSession(item)">
                <el-icon><VideoPlay /></el-icon>
                继续授课
              </el-button>
              <el-button size="small" text @click="viewSessionDetail(item.id)">
                查看回放
              </el-button>
            </div>
          </div>
        </div>
      </el-card>

      <el-card class="history-detail-card" v-if="viewingHistory">
        <template #header>
          <div class="card-header">
            <el-button text @click="viewingHistory = false">
              <el-icon><ArrowLeft /></el-icon>
              返回列表
            </el-button>
            <span>{{ historyDetail.subject }} - {{ historyDetail.topic }}</span>
            <el-button text size="small" @click="exportSession">
              <el-icon><Download /></el-icon>
              导出
            </el-button>
          </div>
        </template>

        <div class="history-detail-info">
          <el-descriptions :column="3" size="small" border>
            <el-descriptions-item label="开始时间">{{ formatDateTime(historyDetail.startTime) }}</el-descriptions-item>
            <el-descriptions-item label="结束时间">{{ historyDetail.endTime ? formatDateTime(historyDetail.endTime) : '未结束' }}</el-descriptions-item>
            <el-descriptions-item label="时长">{{ historyDetail.duration ? formatTime(historyDetail.duration) : '--' }}</el-descriptions-item>
            <el-descriptions-item label="消息数">{{ historyDetail.messages.length }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ historyDetail.status === 'completed' ? '已完成' : '进行中' }}</el-descriptions-item>
            <el-descriptions-item label="学科">{{ historyDetail.subject }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="history-detail-messages">
          <div
            v-for="(msg, index) in historyDetail.messages"
            :key="index"
            :class="['message-item', msg.role]"
          >
            <div class="message-avatar">
              <el-avatar
                :size="28"
                :style="{ backgroundColor: msg.role === 'user' ? '#409eff' : '#67c23a' }"
              >
                <el-icon v-if="msg.role === 'user'"><User /></el-icon>
                <el-icon v-else><ChatDotRound /></el-icon>
              </el-avatar>
            </div>
            <div class="message-body">
              <div class="message-bubble">
                <MarkdownRenderer :content="msg.content" />
              </div>
              <div class="message-meta">
                <span class="message-time">{{ formatDateTime(msg.timestamp) }}</span>
              </div>
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <div v-else class="class-body">
      <aside class="left-panel">
        <el-card class="info-card">
          <template #header>
            <div class="card-header">
              <el-icon><InfoFilled /></el-icon>
              <span>会话信息</span>
            </div>
          </template>
          <div class="info-content">
            <div class="info-item">
              <span class="info-label">学科</span>
              <span class="info-value">{{ sessionInfo.subject }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">主题</span>
              <span class="info-value info-value-topic" :title="sessionInfo.topic">{{ sessionInfo.topic }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">难度</span>
              <span class="info-value">{{ sessionInfo.difficulty }}/10</span>
            </div>
            <div class="info-item">
              <span class="info-label">消息数</span>
              <span class="info-value">{{ messages.length }} 条</span>
            </div>
            <div class="info-item">
              <span class="info-label">用时</span>
              <span class="info-value">{{ formatTime(activeTime) }}</span>
            </div>
          </div>
        </el-card>

        <KnowledgePointList :knowledge-points="knowledgePoints" />

        <el-card class="state-card">
          <template #header>
            <div class="card-header">
              <el-icon><DataLine /></el-icon>
              <span>学习状态</span>
            </div>
          </template>
          <div class="state-content">
            <div v-if="lastSessionEvaluation" class="state-content">
              <div class="state-item">
                <div class="state-label">
                  <span>LSS 学习压力</span>
                  <span class="state-value">{{ lastSessionEvaluation.lss.toFixed(2) }}</span>
                </div>
                <el-progress
                  :percentage="Math.min(100, (lastSessionEvaluation.lss / 10) * 100)"
                  :stroke-width="8"
                  :color="getLSSColor"
                  :show-text="false"
                />
              </div>
              <div class="state-item">
                <div class="state-label">
                  <span>KTL 知识掌握</span>
                  <span class="state-value">{{ lastSessionEvaluation.ktl.toFixed(2) }}</span>
                </div>
                <el-progress
                  :percentage="Math.min(100, (lastSessionEvaluation.ktl / 10) * 100)"
                  :stroke-width="8"
                  :color="getKTLColor"
                  :show-text="false"
                />
              </div>
              <div class="state-item">
                <div class="state-label">
                  <span>LF 学习疲劳</span>
                  <span class="state-value">{{ lastSessionEvaluation.lf.toFixed(2) }}</span>
                </div>
                <el-progress
                  :percentage="Math.min(100, (lastSessionEvaluation.lf / 10) * 100)"
                  :stroke-width="8"
                  :color="getLFColor"
                  :show-text="false"
                />
              </div>
              <div class="state-item">
                <div class="state-label">
                  <span>LSB 状态平衡</span>
                  <span class="state-value">{{ lastSessionEvaluation.lsb.toFixed(2) }}</span>
                </div>
                <el-progress
                  :percentage="Math.max(0, Math.min(100, ((lastSessionEvaluation.lsb + 10) / 20) * 100))"
                  :stroke-width="8"
                  :color="getLSBColor"
                  :show-text="false"
                />
              </div>
            </div>
            <div v-else class="state-content">
              <div class="state-item">
                <div class="state-label">
                  <span>评估中...</span>
                </div>
                <el-progress
                  :percentage="100"
                  :stroke-width="8"
                  :color="'#409eff'"
                  :show-text="false"
                  :indeterminate="true"
                />
              </div>
            </div>
          </div>
        </el-card>
      </aside>

      <main class="chat-area">
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
                  <span v-if="msg.role === 'assistant' && msg.analysis" class="message-analysis">
                    认知: {{ msg.analysis.cognitiveLevel }} | 理解: {{ msg.analysis.understanding }}
                  </span>
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
                <CompletionCard
                  v-if="index === completionMessageIndex && completionMessageIndex >= 0 && !completionCardShown"
                  :topic="sessionInfo.topic"
                  :mastered-count="msg.masteredCount || 0"
                  :total-count="msg.totalCount || 0"
                  :duration="formatTime(activeTime)"
                  :message-count="messages.length"
                  :summary="{
                    topicSummary: msg.content || '本节课已完成。',
                    knowledgeSummary: `已完成 ${msg.masteredCount || 0}/${msg.totalCount || 0} 个知识点。`,
                    practiceAdvice: msg.practiceAdvice || '建议复盘本节课核心知识点。',
                    learningEvaluation: '本次测试课已完成，可继续进入下一主题。'
                  }"
                  @action="handleCompletionAction"
                />
                <KnowledgePointCard
                  v-if="msg.role === 'assistant' && index === messages.length - 1 && msg.knowledgePoint && !aiLoading && !msg.isCompletion"
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
      </main>

      <!-- Peer chat notification and window -->
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

      <!-- Floating button to open peer chat -->
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

      <aside class="right-panel">
        <el-card v-if="lastAnalysis" class="analysis-card">
          <template #header>
            <div class="card-header">
              <el-icon><Monitor /></el-icon>
              <span>最新认知分析</span>
            </div>
          </template>
          <div class="analysis-content">
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="认知水平">
                <el-tag :type="getLevelTagType(lastAnalysis.cognitiveLevel)">
                  {{ lastAnalysis.cognitiveLevel }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="水平得分">
                {{ lastAnalysis.levelScore }}
              </el-descriptions-item>
              <el-descriptions-item label="理解程度">
                {{ lastAnalysis.understanding }}
              </el-descriptions-item>
              <el-descriptions-item label="参与度">
                {{ lastAnalysis.engagement }}
              </el-descriptions-item>
              <el-descriptions-item label="情绪状态">
                {{ lastAnalysis.emotionalState }}
              </el-descriptions-item>
            </el-descriptions>

            <div v-if="lastAnalysis.confusionPoints?.length" class="confusion-points">
              <div class="confusion-title">
                <el-icon><WarningFilled /></el-icon>
                困惑点
              </div>
              <ul>
                <li v-for="(point, i) in lastAnalysis.confusionPoints" :key="i">
                  {{ point }}
                </li>
              </ul>
            </div>
          </div>
        </el-card>

        <el-card v-if="lastIntervention" class="intervention-card">
          <template #header>
            <div class="card-header">
              <el-icon><Guide /></el-icon>
              <span>干预建议</span>
            </div>
          </template>
          <div class="intervention-content">
            <el-tag :type="getInterventionType(lastIntervention.priority)">
              优先级: {{ lastIntervention.priority }}
            </el-tag>
            <div class="intervention-type">{{ lastIntervention.type }}</div>
            <div class="intervention-reasoning">{{ lastIntervention.reasoning }}</div>
          </div>
        </el-card>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft,
  VideoPlay,
  VideoPause,
  Setting,
  InfoFilled,
  DataLine,
  User,
  ChatDotRound,
  Promotion,
  Loading,
  Monitor,
  WarningFilled,
  Guide,
  Operation,
  Clock,
  Refresh,
  Download,
  Timer,
  ChatLineRound,
  CircleCheck
} from '@element-plus/icons-vue';
import { aiTeachingAPI } from '@/api/aiTeaching';
import type { SessionHistoryItem, SessionDetail, ActiveSessionInfo, KnowledgePointStatus } from '@/api/aiTeaching';
import { learningAPI } from '@/api/learning';
import type { LearningPath, Stage, Task } from '@/api/learning';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import KnowledgePointCard from '@/components/KnowledgePointCard.vue';
import KnowledgePointList from '@/components/KnowledgePointList.vue';
import CompletionCard from '@/components/CompletionCard.vue';
import PeerNotification from '@/components/PeerNotification.vue';
import PeerChatWindow from '@/components/PeerChatWindow.vue';

const router = useRouter();

const setupMode = ref<'path' | 'manual'>('path');
const pathsLoading = ref(false);
const learningPaths = ref<LearningPath[]>([]);
const selectedPathId = ref('');
const selectedMilestoneId = ref('');
const selectedTaskId = ref('');

const historyLoading = ref(false);
const sessionHistory = ref<SessionHistoryItem[]>([]);
const viewingHistory = ref(false);
const historyDetail = ref<SessionDetail>({
  id: '',
  subject: '',
  topic: '',
  startTime: '',
  endTime: null,
  duration: null,
  status: '',
  messages: [],
  state: {},
});

const peerNotificationVisible = ref(false);
const peerChatWindowVisible = ref(false);
const peerChatMessages = ref<Array<{ role: string; content: string; timestamp: string }>>([]);

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

const sessionForm = ref({
  subject: '',
  topic: '',
  difficulty: 5
});
const starting = ref(false);

const currentMilestones = computed<Stage[]>(() => {
  const path = learningPaths.value.find(p => p.id === selectedPathId.value);
  if (!path) return [];
  return ((path as any).milestones || path.stages || []) as Stage[];
});

const currentTasks = computed<Task[]>(() => {
  const milestone = currentMilestones.value.find(m => m.id === selectedMilestoneId.value);
  return milestone?.subtasks || [];
});

const selectedTask = computed<Task | undefined>(() => {
  return currentTasks.value.find(t => t.id === selectedTaskId.value);
});

const canStart = computed(() => {
  if (setupMode.value === 'manual') {
    return !!sessionForm.value.subject && !!sessionForm.value.topic;
  }
  return !!selectedTaskId.value;
});

function onPathChange() {
  selectedMilestoneId.value = '';
  selectedTaskId.value = '';
}

function onMilestoneChange() {
  selectedTaskId.value = '';
}

function onTaskChange() {
  const task = selectedTask.value;
  const path = learningPaths.value.find(p => p.id === selectedPathId.value);
  if (task && path) {
    sessionForm.value.subject = path.subject || path.name || '综合';
    sessionForm.value.topic = task.title + (task.description ? ` - ${task.description}` : '');
  }
}

async function loadLearningPaths() {
  pathsLoading.value = true;
  try {
    learningPaths.value = await learningAPI.getPaths();
  } catch (e: any) {
    console.error('加载学习路径失败:', e);
  } finally {
    pathsLoading.value = false;
  }
}

const sessionActive = ref(false);
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
  isCompletion?: boolean;
  masteredCount?: number;
  totalCount?: number;
  practiceAdvice?: string;
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref('');
const aiLoading = ref(false);
const messageListRef = ref<HTMLElement | null>(null);

const lastAnalysis = ref<ChatMessage['analysis'] | null>(null);
const lastIntervention = ref<{
  type: string;
  priority: number;
  content: string;
  reasoning: string;
} | null>(null);

const currentState = ref({
  lss: 0,
  ktl: 0,
  lf: 0,
  lsb: 0
});

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

const knowledgePoints = ref<KnowledgePointStatus[]>([]);

const completionCardShown = ref(false);
const completionMessageIndex = ref(-1);
const peerLoading = ref(false);

const elapsedTime = ref(0);
const activeTime = ref(0);
let timerInterval: number | null = null;
let lastActivityTime = ref(Date.now());

const getLSSColor = (val: number) => {
  if (val < 40) return '#67c23a';
  if (val < 70) return '#e6a23c';
  return '#f56c6c';
};

const getKTLColor = (val: number) => {
  if (val < 40) return '#f56c6c';
  if (val < 70) return '#e6a23c';
  return '#67c23a';
};

const getLFColor = (val: number) => {
  if (val < 40) return '#67c23a';
  if (val < 70) return '#e6a23c';
  return '#f56c6c';
};

const getLSBColor = (val: number) => {
  const normalized = (val + 1) * 50;
  if (normalized < 40) return '#f56c6c';
  if (normalized < 70) return '#e6a23c';
  return '#67c23a';
};

const getLevelTagType = (level: string) => {
  const map: Record<string, string> = {
    'remember': 'info',
    'understand': 'success',
    'apply': 'warning',
    'analyze': 'danger',
    'evaluate': 'danger',
    'create': 'danger'
  };
  return map[level.toLowerCase()] || 'info';
};

const getInterventionType = (priority: number) => {
  if (priority <= 2) return 'success';
  if (priority <= 5) return 'warning';
  return 'danger';
};

const strategyLabel = (id: string) => {
  return STRATEGY_LABELS[id] || id;
};

async function startSession() {
  if (!canStart.value) {
    ElMessage.warning('请选择或填写学科和主题');
    return;
  }

  starting.value = true;
  try {
    const session = await aiTeachingAPI.startSession(
      sessionForm.value.subject,
      sessionForm.value.topic,
      sessionForm.value.difficulty,
      selectedTask.value?.id
    );

    sessionInfo.value = {
      sessionId: session.sessionId,
      subject: session.subject,
      topic: session.topic,
      difficulty: sessionForm.value.difficulty
    };

    sessionActive.value = true;
    
    // 重置所有状态
    messages.value = [];
    knowledgePoints.value = [];
    peerChatMessages.value = [];
    currentState.value = { lss: 0, ktl: 0, lf: 0, lsb: 0 };
    lastAnalysis.value = null;
    lastIntervention.value = null;
    lastSessionEvaluation.value = null;
    completionMessageIndex.value = -1;
    completionCardShown.value = false;
    peerNotificationVisible.value = false;
    peerChatWindowVisible.value = false;
    elapsedTime.value = 0;
    activeTime.value = 0;

    messages.value.push({
      role: 'assistant',
      content: session.welcomeMessage || `欢迎来到 **${session.subject}** 课堂！\n\n今天我们学习的主题是：**${session.topic}**\n\n请随时提问或回答我的问题，我会根据你的学习状态调整教学方式。`,
      timestamp: new Date().toISOString()
    });

    startTimer();
    ElMessage.success('授课会话已开始');
  } catch (error: any) {
    ElMessage.error(error.message || '开始会话失败');
  } finally {
    starting.value = false;
  }
}

const sendMessage = async () => {
  const text = userInput.value.trim();
  if (!text || aiLoading.value || !sessionInfo.value.sessionId) return;

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

    const masteredCount = result.knowledgePoints?.filter(kp => kp.status === 'mastered').length || 0;
    const totalCount = result.knowledgePoints?.length || 0;

    messages.value.push({
      role: 'assistant',
      content: result.aiResponse,
      timestamp: new Date().toISOString(),
      analysis: result.analysis,
      strategies: result.strategies || [],
      knowledgePoint: result.knowledgePoint,
      knowledgePoints: result.knowledgePoints,
      isCompletion: result.isCompletion,
      masteredCount,
      totalCount,
      practiceAdvice: result.completionAdvice,
    });

    if (result.isCompletion && completionMessageIndex.value === -1) {
      completionMessageIndex.value = messages.value.length - 1;
    }

    lastAnalysis.value = result.analysis;

    if (result.state) {
      currentState.value = result.state;
    }

    if (result.knowledgePoints && result.knowledgePoints.length > 0) {
      knowledgePoints.value = result.knowledgePoints;
    }

    if (result.peerTriggered) {
      // 添加同伴消息到 peerChatMessages
      if (result.peerMessage) {
        peerChatMessages.value.push({
          role: 'peer',
          content: result.peerMessage,
          timestamp: new Date().toISOString(),
        });
      }
      // 延迟显示通知，确保消息已添加
      nextTick(() => {
        peerNotificationVisible.value = true;
      });
    }

    scrollToBottom();
  } catch (error: any) {
    ElMessage.error(error.message || '发送消息失败');
    // 标记最后一条用户消息为失败
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

  // 移除失败消息和后续可能的错误提示
  messages.value.splice(index, 1);
  
  // 重新发送
  userInput.value = msg.content;
  sendMessage();
};

const handleKnowledgeAction = async (action: 'mastered' | 'need-more' | 'pause') => {
  lastActivityTime.value = Date.now();
  const actionMessages: Record<string, string> = {
    'mastered': '这个知识点我掌握了，继续下一个。',
    'need-more': '这个知识点我没完全理解，能用另一种方式再讲一遍吗？',
    'pause': '我想休息一下，稍后回来继续。'
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

const handleCompletionAction = async (action: 'end' | 'continue' | 'explore') => {
  completionCardShown.value = true;
  completionMessageIndex.value = -1;
  if (action === 'end') {
    await endSession();
  } else if (action === 'continue') {
    userInput.value = '我准备好了，继续学习下一个主题。';
    sendMessage();
  } else {
    userInput.value = '我想在当前主题下继续深入探索，有没有更有趣的角度或延伸内容？';
    sendMessage();
  }
};

const handlePeerSend = async (text: string) => {
  if (!sessionInfo.value.sessionId) return;

  peerLoading.value = true;
  try {
    const result = await aiTeachingAPI.sendPeerMessage(
      sessionInfo.value.sessionId,
      text
    );
    peerChatMessages.value.push({
      role: 'peer',
      content: result.peerResponse,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    ElMessage.error(error.message || '同伴消息发送失败');
  } finally {
    peerLoading.value = false;
  }
};

const endSession = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要结束当前授课会话吗？',
      '结束授课',
      {
        confirmButtonText: '确定结束',
        cancelButtonText: '继续授课',
        type: 'warning'
      }
    );

    const result = await aiTeachingAPI.endSession(sessionInfo.value.sessionId);

    sessionActive.value = false;
    stopTimer();

    messages.value.push({
      role: 'assistant',
      content: '授课会话已结束。感谢你的学习！',
      timestamp: new Date().toISOString()
    });

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
      showEvaluationDialog.value = true;
    }

    ElMessage.success('会话已结束');
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '结束会话失败');
    }
  }
};

const closeEvaluationAndReturn = () => {
  showEvaluationDialog.value = false;
  goBack();
};

function exportSession() {
  const messages = historyDetail.value.messages;
  let markdown = `# AI 授课会话记录\n\n`;
  markdown += `**主题**：${historyDetail.value.subject} - ${historyDetail.value.topic}\n`;
  markdown += `**时间**：${formatDateTime(historyDetail.value.startTime)} - ${historyDetail.value.endTime ? formatDateTime(historyDetail.value.endTime) : '未结束'}\n`;
  markdown += `**时长**：${historyDetail.value.duration ? formatTime(historyDetail.value.duration) : '--'}\n`;
  markdown += `**消息数**：${messages.length} 条\n\n`;
  markdown += `---\n\n## 对话记录\n\n`;

  for (const msg of messages) {
    const roleMap: Record<string, string> = {
      'user': '学生',
      'assistant': 'AI 教师',
      'peer': '💬 同伴',
    };
    const time = formatDateTime(msg.timestamp);
    const role = roleMap[msg.role] || msg.role;
    markdown += `### [${time}] ${role}\n\n${msg.content}\n\n`;
  }

  markdown += `---\n\n## 学习状态评估\n\n`;
  if (historyDetail.value.state) {
    const state = historyDetail.value.state;
    markdown += `- **LSS 学习压力**：${state.lss?.toFixed(2) || '0.00'}\n`;
    markdown += `- **KTL 知识掌握**：${state.ktl?.toFixed(2) || '0.00'}\n`;
    markdown += `- **LF 学习疲劳**：${state.lf?.toFixed(2) || '0.00'}\n`;
    markdown += `- **LSB 状态平衡**：${state.lsb?.toFixed(2) || '0.00'}\n`;
  }

  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `授课记录-${historyDetail.value.subject}-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  
  ElMessage.success('导出成功');
}

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

const goBack = () => {
  router.push('/dashboard');
};

async function loadHistory() {
  historyLoading.value = true;
  try {
    sessionHistory.value = await aiTeachingAPI.getHistory();
  } catch (e: any) {
    console.error('加载历史会话失败:', e);
  } finally {
    historyLoading.value = false;
  }
}

async function viewSessionDetail(sessionId: string) {
  const detail = await aiTeachingAPI.getSessionDetail(sessionId);
  if (detail) {
    historyDetail.value = detail;
    viewingHistory.value = true;
  } else {
    ElMessage.error('获取会话详情失败');
  }
}

async function continueSession(item: SessionHistoryItem) {
  const detail = await aiTeachingAPI.getSessionDetail(item.id);
  if (!detail) {
    ElMessage.error('获取会话详情失败');
    return;
  }

  // 重置所有状态
  messages.value = [];
  knowledgePoints.value = [];
  peerChatMessages.value = [];
  currentState.value = { lss: 0, ktl: 0, lf: 0, lsb: 0 };
  lastAnalysis.value = null;
  lastIntervention.value = null;
  lastSessionEvaluation.value = null;
  completionMessageIndex.value = -1;
  completionCardShown.value = false;
  peerNotificationVisible.value = false;
  peerChatWindowVisible.value = false;
  elapsedTime.value = 0;
  activeTime.value = 0;

  sessionInfo.value = {
    sessionId: item.id,
    subject: item.subject,
    topic: item.topic,
    difficulty: 5,
  };

  messages.value = detail.messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    timestamp: m.timestamp,
    analysis: (m as any).analysis,
  }));

  knowledgePoints.value = (detail as any).knowledgePoints || [];
  lastSessionEvaluation.value = detail.state ? {
    lss: detail.state.lss,
    ktl: detail.state.ktl,
    lf: detail.state.lf,
    lsb: detail.state.lsb,
    messageCount: detail.messages.length,
    duration: item.duration || 0,
    avgUnderstanding: 0.5,
  } : null;

  sessionActive.value = true;
  viewingHistory.value = false;
  startTimer();
  ElMessage.success('已恢复历史会话，继续授课');
}

function formatDateTime(iso: string) {
  if (!iso) return '--';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(async () => {
  loadLearningPaths();
  loadHistory();
  const activeSessions = await aiTeachingAPI.getActiveSessions();
  if (activeSessions.length > 0) {
    const latest = activeSessions[0];
    ElMessageBox.confirm(
      `检测到未结束的会话：${latest.subject} - ${latest.topic}（${latest.messageCount} 条消息）`,
      '恢复会话',
      {
        confirmButtonText: '继续授课',
        cancelButtonText: '新建会话',
        type: 'info',
      }
    ).then(() => {
      continueSession({
        id: latest.sessionId,
        subject: latest.subject,
        topic: latest.topic,
        startTime: latest.startTime,
        endTime: null,
        duration: null,
        status: 'active',
        messageCount: latest.messageCount,
      });
    }).catch(() => {});
  }
});

onUnmounted(() => {
  stopTimer();
});
</script>

<style scoped>
.class-test-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f5f7fa;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background-color: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setup-panel {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  padding: 40px;
}

.setup-card {
  width: 100%;
  max-width: 600px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
  color: #303133;
}

.setup-form {
  padding: 20px 0;
}

.setup-tabs {
  margin-bottom: 16px;
}

.setup-actions {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}

.history-card {
  margin-top: 16px;
  width: 100%;
  max-width: 600px;
}

.history-list {
  max-height: 400px;
  overflow-y: auto;
}

.history-item {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.history-item:hover {
  border-color: #409eff;
  background-color: #f5f7fa;
}

.history-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.history-item-title {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}

.history-item-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #909399;
}

.history-item-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e4e7ed;
}

.history-detail-card {
  margin-top: 16px;
  width: 100%;
  max-width: 600px;
}

.history-detail-info {
  margin-bottom: 16px;
}

.history-detail-messages {
  max-height: 500px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-detail-messages .message-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.history-detail-messages .message-item.user {
  flex-direction: row-reverse;
}

.history-detail-messages .message-avatar {
  flex-shrink: 0;
}

.history-detail-messages .message-body {
  max-width: 80%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-detail-messages .message-item.user .message-body {
  align-items: flex-end;
}

.history-detail-messages .message-bubble {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.history-detail-messages .message-item.user .message-bubble {
  background-color: #409eff;
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.history-detail-messages .message-item.assistant .message-bubble {
  background-color: #f5f7fa;
  color: #303133;
  border-bottom-left-radius: 4px;
}

.history-detail-messages .message-meta {
  font-size: 11px;
  color: #909399;
}

.path-selector {
  min-height: 200px;
}

.path-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.task-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.class-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 0;
  padding: 0;
}

.left-panel,
.right-panel {
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding: 16px;
}

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  overflow: hidden;
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
  border-bottom: 1px solid #f0f2f5;
}

.info-label {
  font-size: 13px;
  color: #909399;
}

.info-value {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
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
  color: #606266;
}

.state-value {
  font-weight: 600;
  color: #303133;
}

.message-list {
  flex: 1;
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
  border: 1px solid #f56c6c;
  background-color: #fef0f0;
}

.message-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #f56c6c;
  color: #f56c6c;
  font-size: 12px;
}

.message-error .el-button {
  color: #f56c6c;
  margin-left: 8px;
}

.message-error .el-button:hover {
  color: #f74c4c;
}

.message-item.assistant .message-bubble {
  background-color: #f5f7fa;
  color: #303133;
  border-bottom-left-radius: 4px;
}

.message-item.user .message-bubble {
  background-color: #409eff;
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.message-bubble.thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
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
  color: #909399;
  display: flex;
  gap: 12px;
}

.message-analysis {
  color: #67c23a;
}

.message-strategies {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.input-area {
  border-top: 1px solid #e4e7ed;
  padding: 16px;
  background-color: #ffffff;
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
  color: #303133;
}

.intervention-reasoning {
  font-size: 13px;
  color: #606266;
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

.evaluation-dialog-content {
  padding: 8px 0;
}

.evaluation-summary {
  width: 100%;
}

.eval-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.eval-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background-color: #f5f7fa;
  border-radius: 8px;
  text-align: center;
}

.eval-label {
  font-size: 12px;
  color: #909399;
}

.eval-value {
  font-size: 20px;
  font-weight: 600;
}

.eval-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #606266;
}

.stat-item strong {
  margin-left: auto;
  color: #303133;
}

.dialog-footer {
  display: flex;
  justify-content: center;
}

.peer-chat-float-btn {
  position: fixed;
  bottom: 100px;
  right: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 9997;
  transition: all 0.3s ease;
}

.peer-chat-float-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.left-panel::-webkit-scrollbar,
.right-panel::-webkit-scrollbar,
.message-list::-webkit-scrollbar {
  width: 6px;
}

.left-panel::-webkit-scrollbar-track,
.right-panel::-webkit-scrollbar-track,
.message-list::-webkit-scrollbar-track {
  background: #f0f2f5;
}

.left-panel::-webkit-scrollbar-thumb,
.right-panel::-webkit-scrollbar-thumb,
.message-list::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}
</style>
