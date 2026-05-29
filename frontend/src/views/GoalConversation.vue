<template>
  <div class="goal-conversation-page planning-upgrade">
    <div class="planning-bg-layer">
      <div class="planning-bg-orb planning-bg-orb--1"></div>
      <div class="planning-bg-orb planning-bg-orb--2"></div>
    </div>

    <header class="dashboard-header planning-header" :class="{ 'dashboard-header--scrolled': headerScrolled }">
      <div class="header-container planning-header__inner">
<button type="button" class="brand planning-brand" @click="router.push(navDashboardPath)">
          <img src="/logo.png" alt="问流 WenFlow" class="brand-logo planning-brand__logo" />
        </button>

        <nav class="header-nav planning-nav" aria-label="应用导航">
          <router-link :to="navDashboardPath" class="nav-item">{{ isTestMode ? '测试学习台' : '学习台' }}</router-link>
          <router-link :to="conversationBasePath" class="nav-item nav-item--active">{{ isTestMode ? '测试目标规划' : '目标规划' }}</router-link>
          <router-link :to="navLearningPathsPath" class="nav-item">{{ isTestMode ? '测试学习路径' : '学习路径' }}</router-link>
          <router-link :to="navLearningStatePath" class="nav-item">{{ isTestMode ? '测试学习状态' : '学习状态' }}</router-link>
          <router-link :to="navAchievementsPath" class="nav-item">{{ isTestMode ? '测试成就' : '成就' }}</router-link>
        </nav>

        <div class="header-right planning-header__actions">
          <span v-if="!isTestMode && virtualDebugSummary" class="session-badge stage-info">{{ virtualDebugSummary }}</span>
          <router-link :to="newConversationPath" class="header-cta">{{ isTestMode ? '创建新测试目标' : '创建新目标' }}</router-link>
          <el-dropdown>
            <button type="button" class="user-chip planning-user-chip">
              <span>{{ userInitial }}</span>
              <strong>{{ userStore.user?.name || '同学' }}</strong>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/user')">
                  <el-icon><User /></el-icon>
                  能力中心
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">
                  <el-icon><Switch /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <main class="main-content planning-main">
      <section class="planning-conversation-layout" :class="{ 'planning-conversation-layout--entry': !showPlanningSidePanels }">
        <aside v-if="showPlanningSidePanels" class="planning-status-card planning-side-card glass-card">
          <div class="planning-side-card__head">
            <h2>当前方向</h2>
            <div class="planning-status-stack">
              <span class="planning-status-item planning-status-item--current">{{ activePlanningStageLabel }}</span>
            </div>
          </div>

          <div class="planning-understand__meter">
            <span>方向清晰度</span>
            <div class="planning-meter-bar">
              <div class="planning-meter-bar__fill" :style="{ width: `${planningConfidencePercent}%` }"></div>
            </div>
            <strong>{{ planningConfidencePercent }}%</strong>
          </div>

          <section class="planning-card-group planning-confirmed-block">
            <span class="planning-block-label">已确认信息</span>
            <div v-if="understandingSummaryCards.length > 0" class="planning-summary-stack">
              <article
                v-for="item in understandingSummaryCards"
                :key="item.label"
                class="planning-summary-item"
              >
                <div class="planning-summary-item__head">
                  <span>{{ item.label }}</span>
                </div>
                <strong>{{ item.value }}</strong>
              </article>
            </div>
            <div v-else class="planning-status-empty">
              你说清楚的信息，会在这里逐步整理出来。
            </div>
          </section>

          <section v-if="isTestMode" class="planning-card-group planning-debug-block">
            <div class="planning-debug-block__head">
              <span class="planning-block-label">调试面板</span>
              <strong>{{ testDebugSummary }}</strong>
            </div>
            <div v-if="virtualDebugSummary" class="planning-debug-block__hint">
              {{ virtualDebugSummary }}
            </div>

            <div class="planning-debug-metrics">
              <article v-for="item in testDebugCards" :key="item.label" class="planning-debug-metric">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </article>
            </div>

            <div v-if="testRequestTraces.length > 0" class="planning-debug-traces">
              <details v-for="trace in testRequestTraces" :key="trace.id" class="planning-debug-trace">
                <summary class="planning-debug-trace__summary">
                  <div>
                    <strong>{{ trace.title }}</strong>
                    <span>{{ trace.subtitle }}</span>
                    <span>{{ trace.statusLabel }}</span>
                  </div>
                  <div class="planning-debug-trace__meta">
                    <em>{{ trace.badge }}</em>
                    <span>{{ trace.badgeNote }}</span>
                  </div>
                </summary>

                <div class="planning-debug-trace__body">
                  <section class="planning-debug-trace__section">
                    <span class="planning-debug-trace__label">本轮用户输入</span>
                    <pre>{{ trace.input }}</pre>
                  </section>

                  <section class="planning-debug-trace__section">
                    <span class="planning-debug-trace__label">请求状态快照</span>
                    <pre>{{ trace.stateSnapshot }}</pre>
                  </section>

                  <section class="planning-debug-trace__section">
                    <span class="planning-debug-trace__label">发送给模型的完整 messages</span>
                    <pre>{{ trace.requestMessages }}</pre>
                  </section>

                  <section class="planning-debug-trace__section">
                    <span class="planning-debug-trace__label">本轮尝试详情</span>
                    <pre>{{ trace.attempts }}</pre>
                  </section>

                  <section v-if="trace.rawUserVisible" class="planning-debug-trace__section">
                    <span class="planning-debug-trace__label">最后一次原始文本输出</span>
                    <pre>{{ trace.rawUserVisible }}</pre>
                  </section>
                </div>
              </details>
            </div>

            <div v-else class="planning-status-empty">
              发起测试对话后，这里会显示每轮请求实际发送给模型的全部内容。
            </div>
          </section>

        </aside>

        <section class="planning-chat-card glass-card">
<div class="planning-chat-card__head planning-chat-card__head--workbench">
            <div class="planning-chat-card__copy">
              <h2 v-if="!hasConversationStarted">{{ isTestMode ? '说一件你想测试的目标表达。' : '说一件你最近卡住的事。' }}</h2>
              <p v-if="!hasConversationStarted" class="planning-chat-card__intro">想到哪说到哪，先不用整理。</p>
              <p v-if="!isTestMode && virtualDebugSummary && !hasConversationStarted" class="planning-chat-card__intro planning-chat-card__intro--virtual">{{ virtualDebugSummary }}</p>
            </div>

            <div class="planning-chat-card__meta" :class="{ 'planning-chat-card__meta--compact': hasConversationStarted }">
              <router-link v-if="!hasConversationStarted" :to="navDashboardPath" class="planning-secondary-btn">回到学习台</router-link>
              <div v-if="hasConversationStarted && !isVirtualFormalView" class="planning-chat-card__head-actions">
                <button type="button" class="planning-secondary-btn" @click="resetConversation">重置本次目标</button>
              </div>
            </div>
          </div>

<div v-if="isCompleted && generatedPathStatus !== 'generating'" class="planning-completion-card">
            <h3>已经可以先生成一版路径。</h3>
            <p v-if="realProblemText">我目前理解的重点是：{{ realProblemText }}</p>
            <div class="planning-completion-card__actions">
              <button class="proposal-btn proposal-btn-primary" @click="navigateToLearningPath">
                <span>查看学习路径</span>
                <el-icon><ArrowRight /></el-icon>
              </button>
              <button v-if="!isTestMode && !isVirtualFormalView" class="proposal-btn proposal-btn-secondary" @click="showRegenerateDialog = true">重新规划</button>
            </div>
          </div>

          <div v-else class="planning-chat-flow">
            <div v-if="!hasConversationStarted && !loading" class="planning-start-card">
              <div class="planning-start-card__copy">
                <span class="planning-start-card__role">AI 规划师</span>
                <strong>先告诉我，你现在最想解决的是什么问题。</strong>
                <p>不需要一开始就说得很准确。可以先描述你眼前最真实的麻烦、想达成的结果，或者你现在卡住的地方。</p>
              </div>
              <div class="planning-start-card__examples">
                <button
                  v-for="item in entryPromptExamples"
                  :key="item"
                  type="button"
                  class="planning-start-card__example"
                  @click="setInput(item)"
                >
                  {{ item }}
                </button>
              </div>
            </div>

            <div v-if="hasConversationStarted || loading" class="planning-messages" ref="chatContent">
              <article v-for="msg in sortedMessages" :key="msg.id" class="planning-msg" :class="`planning-msg--${msg.role}`">
                <div class="planning-msg__meta">
                  <span class="planning-msg__role">{{ msg.role === 'ai' ? '问流' : '你' }}</span>
                  <span v-if="isTestMode && getTraceStatusBadge(msg)" class="planning-msg__debug-badge" :class="`planning-msg__debug-badge--${getTraceStatusBadge(msg)?.tone || 'info'}`">
                    {{ getTraceStatusBadge(msg)?.label }}
                  </span>
                  <small>{{ formatTime(msg.time) }}</small>
                </div>
                <p v-html="msg.role === 'ai' ? formatMessage(msg.content) : msg.content"></p>

                <details
                  v-if="isTestMode && getTraceCardForMessage(msg)"
                  class="planning-msg-trace"
                  :open="isTraceExpanded(msg.id)"
                  @toggle="handleTraceDetailsToggle(msg.id, ($event.currentTarget as HTMLDetailsElement).open)"
                >
                  <summary class="planning-msg-trace__summary" @click.prevent="toggleTraceForMessage(msg.id)">
                    {{ msg.role === 'user' ? '查看本轮请求详情' : '查看本轮请求与输出' }}
                  </summary>

                  <template v-if="getTraceCardForMessage(msg)">
                    <div class="planning-msg-trace__meta">
                      <span>{{ getTraceCardForMessage(msg)?.statusLabel }}</span>
                      <span>{{ getTraceCardForMessage(msg)?.stageBeforeLabel }}</span>
                      <span>{{ getTraceCardForMessage(msg)?.promptVersionLabel }}</span>
                      <span>{{ getTraceCardForMessage(msg)?.parseModeLabel }}</span>
                      <span>{{ getTraceCardForMessage(msg)?.attemptLabel }}</span>
                    </div>

                    <div class="planning-msg-trace__section">
                      <span class="planning-msg-trace__label">本轮用户输入</span>
                      <pre>{{ getTraceCardForMessage(msg)?.input }}</pre>
                    </div>

                    <div class="planning-msg-trace__section">
                      <span class="planning-msg-trace__label">请求状态快照</span>
                      <pre>{{ getTraceCardForMessage(msg)?.stateSnapshot }}</pre>
                    </div>

                    <div class="planning-msg-trace__section">
                      <span class="planning-msg-trace__label">发送给模型的完整 messages</span>
                      <pre>{{ getTraceCardForMessage(msg)?.requestMessages }}</pre>
                    </div>

                    <div class="planning-msg-trace__section">
                      <span class="planning-msg-trace__label">可见回复</span>
                      <pre>{{ getTraceCardForMessage(msg)?.visibleReply }}</pre>
                    </div>

                    <details class="planning-msg-trace__raw-details">
                      <summary>展开原始输出</summary>

                      <div class="planning-msg-trace__section">
                        <span class="planning-msg-trace__label">最后一次原始文本</span>
                        <pre>{{ getTraceCardForMessage(msg)?.rawUserVisible }}</pre>
                      </div>

                      <div v-if="(getTraceCardForMessage(msg)?.attempts.length || 0) > 0" class="planning-msg-trace__attempts">
                        <article
                          v-for="attempt in getTraceCardForMessage(msg)?.attempts || []"
                          :key="`${msg.id}-attempt-${attempt.attemptIndex}`"
                          class="planning-msg-trace__attempt"
                        >
                          <div class="planning-msg-trace__attempt-head">
                            <strong>Attempt {{ attempt.attemptIndex }}</strong>
                            <span>{{ attempt.parseMode }}</span>
                            <em>{{ attempt.structuredOutputValid ? '结构化成功' : '结构化失败' }}</em>
                          </div>
                          <div v-if="attempt.failureType !== 'none'" class="planning-msg-trace__failure">
                            Failure: {{ attempt.failureType }}
                          </div>
                          <div v-if="attempt.violations.length > 0" class="planning-msg-trace__violations">
                            <span v-for="(violation, index) in attempt.violations" :key="`${msg.id}-${attempt.attemptIndex}-${index}`">{{ violation }}</span>
                          </div>
                          <pre>{{ attempt.rawContent }}</pre>
                        </article>
                      </div>
                    </details>
                  </template>
                </details>

                <div v-if="msg.role === 'ai' && msg.quickReplies && msg.quickReplies.length > 0 && !msg.quickRepliesUsed && currentStage !== 'proposing'" class="planning-replies">
                  <span
                    v-for="(reply, index) in msg.quickReplies"
                    :key="index"
                    class="planning-reply-chip"
                    :class="{ 'planning-reply-chip--selected': isQuickReplySelected(reply.text) }"
                    @click="toggleQuickReplySelection(reply.text, msg.id)"
                  >
                    {{ reply.text }}
                  </span>
                </div>

                <div v-if="msg.role === 'ai' && isFailedMessage(msg.content)" class="planning-msg__retry">
                  <button class="planning-retry-btn" @click="retryLastMessage" :disabled="loading">
                    <el-icon><RefreshRight /></el-icon>
                    <span>重试</span>
                  </button>
                </div>
              </article>

              <div v-if="loading" class="planning-msg planning-msg--ai">
                <div class="planning-msg__meta">
                  <span class="planning-msg__role">问流</span>
                </div>
                <div class="typing-indicator glass-card">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </div>
              </div>
            </div>

<div class="planning-composer" :class="{ 'planning-composer--entry': !hasConversationStarted }">
              <transition name="slide-up">
                <div v-if="showProposalActionPanel && !loading" class="planning-proposal" :class="{ 'planning-proposal--pending': !supplementMode, 'planning-proposal--supplement': supplementMode }">
                  <span class="planning-proposal__eyebrow">{{ supplementMode ? '补充信息，重新整理方向' : '确认并生成路径' }}</span>

                  <div v-if="!supplementMode" class="planning-proposal__list">
                    <div v-if="proposalProblemText" class="planning-proposal__item">
                      <strong>核心问题</strong>
                      <p>{{ proposalProblemText }}</p>
                    </div>

                    <div v-if="proposalOutcomeText" class="planning-proposal__item">
                      <strong>预计产出</strong>
                      <p>{{ proposalOutcomeText }}</p>
                    </div>

                    <div v-if="proposalStageHighlights.length > 0" class="planning-proposal__item">
                      <strong>路径大纲</strong>
                      <ol class="planning-proposal__path-list">
                        <li
                          v-for="(item, index) in proposalStageHighlights"
                          :key="`${index}-${item}`"
                        >
                          <span class="planning-proposal__path-index">{{ index + 1 }}</span>
                          <span>{{ item }}</span>
                        </li>
                      </ol>
                    </div>
                  </div>

                  <div v-if="supplementMode" class="planning-proposal__supplement-input">
                    <div class="planning-proposal__supplement-field">
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
                      <button @click="sendMessage" :disabled="loading || !userInput.trim()" class="planning-proposal__supplement-send">
                        <el-icon v-if="loading"><Loading /></el-icon>
                        <el-icon v-else><Promotion /></el-icon>
                      </button>
                    </div>
                  </div>

                  <div class="planning-proposal__actions">
                    <template v-if="!supplementMode">
                      <button class="proposal-btn proposal-btn-primary" @click="handleConfirmProposal" :disabled="loading">
                        <el-icon v-if="loading"><Loading /></el-icon>
                        <span>确认并生成路径</span>
                      </button>
                      <button class="proposal-btn proposal-btn-secondary" @click="handleContinueSupplement">还想补充</button>
                    </template>
                    <template v-else>
                      <button class="proposal-btn proposal-btn-secondary" @click="handleCancelSupplement">取消</button>
                    </template>
                  </div>
                </div>
              </transition>

              <div v-if="!showProposalActionPanel" class="planning-composer__box planning-composer__box--final">
                <div class="planning-composer__field">
                  <div v-if="selectedQuickReplies.length > 0" class="planning-composer__selected-tags">
                    <button
                      v-for="(item, idx) in selectedQuickReplies"
                      :key="idx"
                      type="button"
                      class="planning-selected-reply planning-selected-reply--dismissible"
                      @click="toggleQuickReplySelection(item, selectedFromMessageId || undefined)"
                    >
                      <span>{{ item }}</span>
                      <span class="planning-selected-reply__remove">×</span>
                    </button>
                  </div>
                  <textarea
                    ref="inputField"
                    v-model="userInput"
                    @keydown.enter.exact.prevent="sendMessage"
                    @keydown.enter.shift.exact="inputNewLine"
                    :placeholder="hasConversationStarted ? '回答上面的问题，或补充你的基础、时间和限制…' : '先说说你最近想解决什么，或现在卡在哪里...'"
                    :disabled="loading"
                    rows="1"
                    @input="autoResize"
                  ></textarea>
                </div>
                <div class="planning-composer__row">
                  <button @click="sendMessage" :disabled="loading || (!userInput.trim() && selectedQuickReplies.length === 0)" class="planning-send-btn">
                    <el-icon v-if="loading"><Loading /></el-icon>
                    <el-icon v-else><Promotion /></el-icon>
                    <span>发送</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

      </section>

      <!-- 重新规划对话框 -->
      <el-dialog
        v-if="!isTestMode"
        v-model="showRegenerateDialog"
        title="重新规划学习路径"
        width="500px"
        class="regenerate-dialog"
      >
        <div class="regenerate-content">
          <p class="regenerate-hint">你可以选择以下操作：</p>
          
          <div class="regenerate-options">
            <div class="option-card" @click="regeneratePath">
              <div class="option-icon">🔄</div>
              <div class="option-info">
                <h4>重新生成路径</h4>
                <p>基于当前对话内容，重新生成学习路径</p>
              </div>
            </div>
            
            <div class="option-divider">或者提供调整建议</div>
            
            <el-input
              v-model="regenerateAdjustments"
              type="textarea"
              :rows="3"
              placeholder="例如：希望更注重实践、增加项目练习、调整难度等..."
              class="adjustments-input"
            />
            
            <el-button
              type="primary"
              :loading="regenerating"
              :disabled="!regenerateAdjustments.trim()"
              @click="regeneratePath"
              class="regenerate-btn"
            >
              根据建议重新生成
            </el-button>
          </div>
          
          <div class="fresh-start-section">
            <el-divider>或者</el-divider>
            <el-button type="danger" plain @click="startFresh()">
              <el-icon><Delete /></el-icon>
              完全重新开始
            </el-button>
            <p class="fresh-start-hint">删除当前对话，重新描述学习目标</p>
          </div>
        </div>
      </el-dialog>
     </main>
   </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import { ArrowRight, Loading, Promotion, RefreshRight, User, Switch, Delete } from '@element-plus/icons-vue';
import { useUserStore } from '../stores/user';
import MarkdownIt from 'markdown-it';
import type { GoalConversationEnvelope } from '@/api/goalConversation';
import {
  deleteGoalConversation,
  getGoalConversation,
  type GoalConversationContextMode,
  regenerateGoalConversation,
  replyGoalConversation,
  startGoalConversation
} from '@/api/goalConversation';
import {
  deleteTestGoalConversation,
  getTestGoalConversation,
  replyTestGoalConversation,
  startTestGoalConversation
} from '@/api/testGoalConversation';
import { adminApi } from '@/api/adminApi';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true
});

const ACTIVE_GOAL_CONVERSATION_KEY = 'active_goal_conversation_id';
const ACTIVE_TEST_GOAL_CONVERSATION_KEY = 'active_test_goal_conversation_id';

const headerScrolled = ref(false);
const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
const contextMode = computed<GoalConversationContextMode>(() => route.meta.contextMode === 'full' ? 'full' : 'recent');
const isTestMode = computed(() => route.meta.isTestMode === true);
const testGoalConversationBasePath = computed(() => (isAdminRoute.value ? '/admin/test/goal-full' : '/test/goal-full'));
const testLearningPathsBasePath = computed(() => (isAdminRoute.value ? '/admin/test/learning-paths' : '/test/learning-paths'));
const testLearningPathDetailBasePath = computed(() => (isAdminRoute.value ? '/admin/test/learning-path' : '/test/learning-path'));
const testDashboardBasePath = computed(() => (isAdminRoute.value ? '/admin/test/dashboard' : '/dashboard'));
const testLearningStateBasePath = computed(() => (isAdminRoute.value ? '/admin/test/learning-state' : '/learning-state'));
const testAchievementsBasePath = computed(() => (isAdminRoute.value ? '/admin/test/achievements' : '/achievements'));
const conversationBasePath = computed(() => (isTestMode.value ? testGoalConversationBasePath.value : '/goal-conversation'));
const navDashboardPath = computed(() => (isTestMode.value ? testDashboardBasePath.value : '/dashboard'));
const navLearningPathsPath = computed(() => (isTestMode.value ? testLearningPathsBasePath.value : '/learning-paths'));
const navLearningStatePath = computed(() => (isTestMode.value ? testLearningStateBasePath.value : '/learning-state'));
const navAchievementsPath = computed(() => (isTestMode.value ? testAchievementsBasePath.value : '/achievements'));
const conversationStorageKey = computed(() => isTestMode.value ? ACTIVE_TEST_GOAL_CONVERSATION_KEY : ACTIVE_GOAL_CONVERSATION_KEY);
const virtualSessionId = computed(() => typeof route.query.virtualSessionId === 'string' ? route.query.virtualSessionId.trim() : '');
const viewMode = computed(() => typeof route.query.viewMode === 'string' ? route.query.viewMode.trim() : '');
const buildRouteQuery = () => {
  const query = new URLSearchParams();
  if (virtualSessionId.value) query.set('virtualSessionId', virtualSessionId.value);
  if (viewMode.value) query.set('viewMode', viewMode.value);
  return query.toString();
};
const newConversationPath = computed(() => {
  const suffix = buildRouteQuery();
  return suffix ? `${conversationBasePath.value}?${suffix}` : conversationBasePath.value;
});
const isVirtualFormalView = computed(() => !isTestMode.value && !!virtualSessionId.value);

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });
    userStore.logout();
    toast.success('已退出登录');
    router.push('/login');
  } catch {
    // 用户取消
  }
};

const chatContent = ref<HTMLElement | null>(null);
const inputField = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const userInput = ref('');
const loading = ref(false);
const conversationId = ref('');
const currentStage = ref('understanding');
const isCompleted = ref(false);
const conversationComplete = ref(false);
const generatedPathId = ref<string | null>(null);
const generatedPathStatus = ref<string | null>(null);
const showRegenerateDialog = ref(false);
const regenerateAdjustments = ref('');
const regenerating = ref(false);
const showUnderstandingExpanded = ref(false);
const showAllSuggestions = ref(false);
const showUploadPanel = ref(false);
const confidence = ref(0);
const lastUserMessage = ref('');
const realProblemConfirmed = ref(false);

const MAX_QUICK_REPLY_SELECTION = 4;
const selectedQuickReplies = ref<string[]>([]);
const selectedFromMessageId = ref<string | null>(null);
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const acceptedMimeTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg'
];
const acceptedExtensions = ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'png', 'jpg', 'jpeg'];
const acceptedFileTypes = '.pdf,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg';
const isDraggingFile = ref(false);

type PlanningUploadStatus = 'ready' | 'error';

interface PlanningUploadFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: PlanningUploadStatus;
  error?: string;
  previewUrl?: string;
}

const uploadedFiles = ref<PlanningUploadFile[]>([]);

const hasUploadedFiles = computed(() => uploadedFiles.value.length > 0);

const isQuickReplySelected = (text: string) => {
  return selectedQuickReplies.value.includes(text);
};

const toggleQuickReplySelection = (text: string, messageId?: string) => {
  if (loading.value) return;
  const previousCombined = selectedQuickReplies.value.join('、');
  
  if (messageId && selectedFromMessageId.value && selectedFromMessageId.value !== messageId) {
    selectedQuickReplies.value = [];
    selectedFromMessageId.value = null;
  }
  
  if (!selectedFromMessageId.value && messageId) {
    selectedFromMessageId.value = messageId;
  }
  
  const idx = selectedQuickReplies.value.indexOf(text);
  if (idx >= 0) {
    selectedQuickReplies.value.splice(idx, 1);
  } else {
    if (selectedQuickReplies.value.length >= MAX_QUICK_REPLY_SELECTION) {
      toast.warning(`最多选择 ${MAX_QUICK_REPLY_SELECTION} 项`);
      return;
    }
    selectedQuickReplies.value.push(text);
  }

  if (userInput.value.trim() === previousCombined || userInput.value.trim() === selectedQuickReplies.value.join('、')) {
    userInput.value = '';
  }
};

const clearQuickReplySelection = () => {
  selectedQuickReplies.value = [];
  selectedFromMessageId.value = null;
};

const createUploadId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const getFileExtension = (file: File) => {
  const ext = file.name.split('.').pop();
  return ext ? ext.toLowerCase() : '';
};

const validateFile = (file: File) => {
  const extension = getFileExtension(file);
  const isMimeAccepted = acceptedMimeTypes.includes(file.type);
  const isExtAccepted = acceptedExtensions.includes(extension);

  if (!isMimeAccepted && !isExtAccepted) {
    return '暂不支持该文件类型';
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return '文件不能超过 10MB';
  }

  return null;
};

const createPreviewUrl = (file: File) => {
  if (file.type.startsWith('image/')) {
    return URL.createObjectURL(file);
  }
  return undefined;
};

const addFiles = (files: File[]) => {
  files.forEach((file) => {
    const error = validateFile(file);
    const uploadFile: PlanningUploadFile = {
      id: createUploadId(),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      progress: error ? 0 : 100,
      status: error ? 'error' : 'ready',
      error: error || undefined,
      previewUrl: createPreviewUrl(file)
    };

    uploadedFiles.value.push(uploadFile);

    if (error) {
      toast.warning(`${file.name}：${error}`);
    }
  });
};

const openFilePicker = () => {
  fileInputRef.value?.click();
};

const handleFileInputChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files || []);
  if (files.length > 0) {
    addFiles(files);
  }
  target.value = '';
};

const handleFileDragEnter = () => {
  isDraggingFile.value = true;
};

const handleFileDragOver = () => {
  isDraggingFile.value = true;
};

const handleFileDragLeave = (event: DragEvent) => {
  const currentTarget = event.currentTarget as HTMLElement | null;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!currentTarget || !relatedTarget || !currentTarget.contains(relatedTarget)) {
    isDraggingFile.value = false;
  }
};

const handleFileDrop = (event: DragEvent) => {
  isDraggingFile.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length > 0) {
    addFiles(files);
  }
};

const revokePreviewUrl = (previewUrl?: string) => {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
};

const removeUploadedFile = (id: string) => {
  const target = uploadedFiles.value.find((item) => item.id === id);
  if (target) {
    revokePreviewUrl(target.previewUrl);
  }
  uploadedFiles.value = uploadedFiles.value.filter((item) => item.id !== id);
};

const retryUploadedFile = (id: string) => {
  const target = uploadedFiles.value.find((item) => item.id === id);
  if (!target) return;

  const error = validateFile(target.file);
  target.error = error || undefined;
  target.status = error ? 'error' : 'ready';
  target.progress = error ? 0 : 100;

  if (error) {
    toast.warning(`${target.name}：${error}`);
  }
};

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getUploadStatusLabel = (status: PlanningUploadStatus) => {
  if (status === 'ready') return '待解析';
  return '校验失败';
};

const getFileIcon = (file: PlanningUploadFile) => {
  if (file.type.startsWith('image/')) return '🖼';
  const extension = getFileExtension(file.file);
  if (extension === 'pdf') return '📕';
  if (extension === 'docx') return '📘';
  if (extension === 'csv' || extension === 'xlsx') return '📊';
  return '📄';
};

const composeQuickReplyPayload = () => {
  if (selectedQuickReplies.value.length === 0) return '';
  const base = selectedQuickReplies.value.join('、');
  const trimmed = userInput.value.trim();
  if (trimmed) {
    return `${base}\n${trimmed}`;
  }
  return base;
};

const understanding = ref<{
  surface_goal?: string;
  real_problem?: string;
  motivation?: string;
  urgency?: string;
  background?: {
    current_level?: string;
    expected_time?: string;
    available_time?: string;
    constraints?: string[];
    strengths?: string[];
  };
  pain_points?: string;
}>({});

interface QuickReply {
  text: string;
  icon?: string;
}

interface Message {
  id: string;
  role: 'ai' | 'user';
  content: string;
  time: Date;
  traceId?: string;
  isObservationFailure?: boolean;
  quickReplies?: QuickReply[];
  quickRepliesUsed?: boolean;
}

interface WorkbenchInfoItem {
  label: string;
  value: string;
  note?: string;
}

interface WorkbenchPendingItem {
  title: string;
  desc: string;
  emphasis?: 'question' | 'missing';
}

interface ConversationRound {
  id: string;
  userText: string;
  aiText: string;
  time: string;
}

interface TestRequestTraceView {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeNote: string;
  statusLabel: string;
  input: string;
  stateSnapshot: string;
  requestMessages: string;
  attempts: string;
  rawUserVisible: string;
}

interface TestLatestTraceAttemptView {
  attemptIndex: number;
  parseMode: string;
  structuredOutputValid: boolean;
  failureType: string;
  violations: string[];
  rawContent: string;
}

interface TestLatestTraceCardView {
  statusLabel: string;
  stageBeforeLabel: string;
  promptVersionLabel: string;
  parseModeLabel: string;
  attemptLabel: string;
  input: string;
  stateSnapshot: string;
  requestMessages: string;
  visibleReply: string;
  rawUserVisible: string;
  attempts: TestLatestTraceAttemptView[];
}

interface TraceStatusBadgeView {
  label: string;
  tone: 'warning' | 'success' | 'info';
}

const expandedTraceMessageId = ref<string | null>(null);

const aiMessages = ref<Message[]>([]);
const userMessages = ref<Message[]>([]);
const nextQuestions = ref<string[]>([]);
const collectedData = ref<Record<string, any>>({});
const structuredData = ref<Record<string, any> | null>(null);
const confirmedProposal = ref<Record<string, any> | null>(null);
const confidenceScores = ref<Record<string, any> | null>(null);
const testDebug = ref<Record<string, any>>({});
const virtualContext = ref<any>(null);

const sortedMessages = computed(() => {
  const allMessages = [...aiMessages.value, ...userMessages.value];
  return allMessages.sort((a, b) => {
    const timeA = a.time instanceof Date ? a.time.getTime() : new Date(a.time).getTime();
    const timeB = b.time instanceof Date ? b.time.getTime() : new Date(b.time).getTime();
    return timeA - timeB;
  });
});

const isVirtualSessionView = computed(() => !!virtualSessionId.value);

const stages = {
  understanding: { label: '理解中', color: 'info' },
  proposing: { label: '方案确认中', color: 'warning' },
  ready: { label: '理解完成', color: 'success' },
  completed: { label: '已生成路径', color: 'success' }
};

const suggestions = [
  { text: '我想用 Python 自动化处理 Excel 报表，每天能节省时间', icon: '🐍', type: 'tech' },
  { text: '我想学会沟通技巧，提高职场表达和人际交往能力', icon: '💬', type: 'soft' },
  { text: '我想做自媒体副业，用 AI 工具提高内容创作效率', icon: '📱', type: 'career' },
  { text: '我想提升商业思维，学会分析商业模式和市场机会', icon: '💡', type: 'soft' },
  { text: '我想转行做数据分析，从零基础到能找到工作', icon: '📊', type: 'transition' },
  { text: '我想帮孩子提高数学成绩，培养数学思维能力', icon: '🎓', type: 'student' }
];

const stageLabel = computed(() => stages[currentStage.value]?.label || '交流中');
const stageBadgeClass = computed(() => `stage-${stages[currentStage.value]?.color || 'info'}`);

const currentAiMessage = computed(() => aiMessages.value[aiMessages.value.length - 1] || null);
const activeQuickReplyMessage = computed(() => {
  for (let i = aiMessages.value.length - 1; i >= 0; i--) {
    const msg = aiMessages.value[i];
    if (msg.quickReplies?.length && !msg.quickRepliesUsed) {
      return msg;
    }
  }

  return null;
});
const activeQuickReplyMessageId = computed(() => activeQuickReplyMessage.value?.id);
const activeQuickReplies = computed(() => {
  if (currentStage.value === 'proposing' || isCompleted.value) {
    return [] as QuickReply[];
  }

  return activeQuickReplyMessage.value?.quickReplies || [];
});

const hasConversationStarted = computed(() => Boolean(conversationId.value || userMessages.value.length > 0 || loading.value));
const showPlanningSidePanels = computed(() => hasConversationStarted.value);
const shouldShowUploadPanel = computed(() => showUploadPanel.value);
const shouldShowUploadSummary = computed(() => !showUploadPanel.value && hasUploadedFiles.value);
const uploadSummaryHint = computed(() => {
  const errorCount = uploadedFiles.value.filter((item) => item.status === 'error').length;
  if (errorCount > 0) {
    return `${errorCount} 份材料需要处理，点击展开继续管理`;
  }
  if (uploadedFiles.value.length === 1) {
    return uploadedFiles.value[0].name;
  }
  return '点击展开继续管理材料';
});

const showSuggestions = computed(() => {
  return currentStage.value === 'understanding' && aiMessages.value.length <= 1 && !isCompleted.value;
});

const visibleSuggestions = computed(() => {
  return showAllSuggestions.value ? suggestions : suggestions.slice(0, 3);
});

const entryPromptExamples = computed(() => suggestions.slice(0, 3).map((item) => item.text));

const showUnderstandingPanel = computed(() => {
  const hasUnderstanding = isValidValue(understanding.value.surface_goal) ||
                           isValidValue(understanding.value.real_problem) ||
                           isValidValue(understanding.value.background?.current_level) ||
                           isValidValue(understanding.value.background?.expected_time) ||
                           isValidValue(understanding.value.pain_points);
  
  return !conversationComplete.value && hasUnderstanding;
});

// 过滤无效值的辅助函数
const isValidValue = (value: any): boolean => {
  if (!value) return false;
  if (typeof value === 'string') {
    const text = value.trim();
    const invalidValues = ['待确认', '待收集', '未知', '未明确', 'null', 'undefined', ''];
    if (invalidValues.includes(text)) return false;

    const invalidPatterns = [/尚未/, /不明确/, /未.*表达/, /可能是/, /初步判断/, /需要厘清/, /待补充/];
    if (invalidPatterns.some((pattern) => pattern.test(text))) return false;

    return true;
  }
  return true;
};

const toPlainText = (text: string) => {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[.*?\]\(.*?\)/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const clipText = (text: string, maxLength = 120) => {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
};

const getValidText = (...values: any[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && isValidValue(value)) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return '';
};

const toTextArray = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'number') return String(item);
        return '';
      })
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string' && isValidValue(value)) {
    return [value.trim()];
  }

  return [];
};

const uniqueTextList = (items: string[]) => {
  return Array.from(new Set(items.map((item) => item.trim()).filter((item) => item.length > 0)));
};

const extractQuestionFromText = (text: string) => {
  const matches = text.match(/[^。！？!?]*[？?]/g);
  if (!matches || matches.length === 0) return '';
  return matches[matches.length - 1].replace(/\s+/g, ' ').trim();
};

const surfaceGoalText = computed(() => getValidText(
  understanding.value.surface_goal,
  collectedData.value.surface_goal
));

const realProblemText = computed(() => getValidText(
  understanding.value.real_problem,
  collectedData.value.real_problem,
  surfaceGoalText.value
));

const motivationText = computed(() => getValidText(
  understanding.value.motivation,
  collectedData.value.motivation
));

const painPointText = computed(() => getValidText(
  understanding.value.pain_points,
  collectedData.value.pain_points
));

const urgencyText = computed(() => getValidText(
  understanding.value.urgency,
  collectedData.value.urgency
));

const currentBaselineText = computed(() => getValidText(
  understanding.value.background?.current_level,
  understanding.value.current_baseline?.level,
  collectedData.value.level
));

const baselineEvidenceText = computed(() => getValidText(understanding.value.current_baseline?.evidence));

const backgroundExperienceText = computed(() => [currentBaselineText.value, baselineEvidenceText.value]
  .filter((item, index, array) => item && array.indexOf(item) === index)
  .join(' · '));

const availableTimeText = computed(() => getValidText(
  understanding.value.background?.available_time,
  understanding.value.available_resources?.time_budget,
  understanding.value.available_resources?.time_horizon,
  collectedData.value.timePerDay
));

const expectedTimeText = computed(() => getValidText(
  understanding.value.success_criteria?.time_window,
  understanding.value.background?.expected_time,
  understanding.value.available_resources?.time_horizon,
  collectedData.value.expected_time
));

const firstDeliverableText = computed(() => getValidText(
  understanding.value.success_criteria?.observable_result,
  understanding.value.success_criteria?.acceptance_check,
  confirmedProposal.value?.first_deliverable,
  confirmedProposal.value?.learning_direction
));

const constraintChips = computed(() => uniqueTextList([
  ...toTextArray(understanding.value.constraints_and_boundaries),
  ...toTextArray(understanding.value.background?.constraints),
  ...toTextArray(collectedData.value.background?.constraints)
]).slice(0, 6));

const successCriteriaTexts = computed(() => uniqueTextList([
  ...toTextArray(understanding.value.success_criteria?.observable_result),
  ...toTextArray(understanding.value.success_criteria?.acceptance_check),
  ...toTextArray(understanding.value.success_criteria?.time_window)
]));

const outOfScopeTexts = computed(() => {
  const explicit = constraintChips.value.filter((item) => /(暂不|先不|不要|不做|不处理|不包含|避免)/.test(item));
  if (explicit.length > 0) {
    return explicit.slice(0, 2);
  }

  return constraintChips.value.slice(0, 2);
});

const proposalKeyStages = computed(() => uniqueTextList(toTextArray(confirmedProposal.value?.key_stages)));

const proposalDirectionText = computed(() => getValidText(
  confirmedProposal.value?.learning_direction,
  currentAiSummaryText.value
));

const proposalDeliverableText = computed(() => getValidText(
  confirmedProposal.value?.first_deliverable,
  firstDeliverableText.value
));

const proposalProblemText = computed(() => getValidText(
  realProblemText.value,
  painPointText.value,
  surfaceGoalText.value,
  proposalDirectionText.value,
  currentAiSummaryText.value
));

const proposalOutcomeText = computed(() => getValidText(
  proposalDeliverableText.value,
  successCriteriaTexts.value[0],
  firstDeliverableText.value,
  proposalDirectionText.value
));

const proposalCommitmentText = computed(() => {
  return [availableTimeText.value, expectedTimeText.value]
    .filter((item, index, array) => item && array.indexOf(item) === index)
    .join(' · ');
});

const proposalMetaPills = computed(() => uniqueTextList([
  availableTimeText.value,
  expectedTimeText.value
]));

const normalizedUrgencyText = computed(() => {
  const value = urgencyText.value;
  if (!value) return '';
  if (/(高|紧急|尽快|马上|迫切)/.test(value)) return '较高';
  if (/(低|不急|以后|慢慢)/.test(value)) return '较低';
  if (/(中|适中|一般)/.test(value)) return '适中';
  return value;
});

const proposalStageOverviewText = computed(() => {
  return proposalStageHighlights.value.join(' / ');
});

const pitfallExperienceText = computed(() => getValidText(
  baselineEvidenceText.value,
  painPointText.value
));

const understandingSummaryCards = computed<WorkbenchInfoItem[]>(() => {
  const items: WorkbenchInfoItem[] = [
    { label: '真实问题', value: realProblemText.value || surfaceGoalText.value },
    { label: '核心痛点', value: painPointText.value },
    { label: '学习动机', value: motivationText.value },
    { label: '当前水平', value: currentBaselineText.value },
    { label: '过往卡点', value: pitfallExperienceText.value },
    { label: '期望周期', value: expectedTimeText.value },
    { label: '可用时间', value: availableTimeText.value },
    { label: '紧迫程度', value: normalizedUrgencyText.value }
  ];

  return items.filter((item) => item.value);
});

const toPrettyJson = (value: any) => {
  if (value === null || value === undefined) return '{}';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const testDebugCards = computed(() => {
  if (!isTestMode.value) return [] as Array<{ label: string; value: string }>;

  const conversationContextCount = testDebug.value.conversationContextCount
    ?? testDebug.value.historyCount
    ?? 0;

  const cards = [
    { label: '上下文策略', value: String(testDebug.value.contextStrategy || 'n/a') },
    { label: '上下文证据数', value: String(conversationContextCount) },
    { label: '可见消息数', value: String(testDebug.value.visibleMessageCount ?? sortedMessages.value.length) },
    { label: '状态字段数', value: String(testDebug.value.stateFieldCount ?? 0) },
    { label: 'Prompt 版本', value: String(testDebug.value.promptVersion ?? 0) },
    { label: '解析模式', value: String(testDebug.value.parseMode || 'n/a') },
    { label: '尝试次数', value: String(testDebug.value.attemptCount ?? 0) },
    { label: '实际重试', value: String(testDebug.value.actualRetryCount ?? 0) },
    { label: '格式失败', value: String(testDebug.value.formatFailureCount ?? 0) },
    { label: '状态已应用', value: testDebug.value.stateApplied === false ? '否' : '是' }
  ];

  if (isVirtualSessionView.value) {
    cards.unshift(
      { label: '虚拟会话', value: virtualSessionId.value || '--' },
      { label: '视图模式', value: viewMode.value || 'debug' }
    );
  }

  return cards;
});

const testDebugSummary = computed(() => {
  if (!isTestMode.value) return '';
  const traceCount = Array.isArray(testDebug.value.requestLog) ? testDebug.value.requestLog.length : 0;
  return `${traceCount} 次请求`;
});

const virtualDebugSummary = computed(() => {
  if (!virtualContext.value) return '';
  const profile = virtualContext.value.profile || {};
  const story = virtualContext.value.storyContext || {};
  const session = virtualContext.value.virtualSession || {};
  return [
    profile.userName ? `画像：${profile.userName}` : '',
    story.title ? `故事：${story.title}` : '',
    session.currentStage ? `阶段：${session.currentStage}` : ''
  ].filter(Boolean).join(' · ');
});

const testRequestTraces = computed<TestRequestTraceView[]>(() => {
  if (!isTestMode.value || !Array.isArray(testDebug.value.requestLog)) {
    return [];
  }

  return [...testDebug.value.requestLog]
    .map((trace: any, index: number) => {
      const messageCount = Array.isArray(trace?.requestMessages) ? trace.requestMessages.length : 0;
      const systemCount = Array.isArray(trace?.requestMessages)
        ? trace.requestMessages.filter((item: any) => item?.role === 'system').length
        : 0;
      const userCount = Array.isArray(trace?.requestMessages)
        ? trace.requestMessages.filter((item: any) => item?.role === 'user').length
        : 0;
      const timestamp = trace?.timestamp
        ? new Date(trace.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '--:--:--';
      const conversationContextCount = Number(
        trace?.conversationContextCount
        ?? (messageCount >= 2 ? Math.max(0, messageCount - 2) : 0)
      );

      return {
        id: String(trace?.id || `trace-${index}`),
        title: `第 ${index + 1} 轮 · ${timestamp}`,
        subtitle: `stageBefore=${trace?.stageBefore || 'unknown'} · prompt=v${trace?.promptVersion || 0}`,
        badge: `${messageCount} 条请求消息`,
        badgeNote: `包含 ${systemCount} 条 system、${userCount} 条 user，以及 ${conversationContextCount} 条 conversationContext 证据`,
        statusLabel: trace?.stateApplied === false ? '结构化失败，状态未更新' : '结构化成功，状态已更新',
        input: String(trace?.input || ''),
        stateSnapshot: toPrettyJson(trace?.stateSnapshot || {}),
        requestMessages: toPrettyJson(trace?.requestMessages || []),
        attempts: toPrettyJson(trace?.attempts || []),
        rawUserVisible: String(trace?.rawUserVisible || '')
      };
    })
    .reverse();
});

const latestTestTraceCard = computed<TestLatestTraceCardView | null>(() => {
  if (!isTestMode.value || !Array.isArray(testDebug.value.requestLog) || testDebug.value.requestLog.length === 0) {
    return null;
  }

  const trace = testDebug.value.requestLog[testDebug.value.requestLog.length - 1] || {};
  const attempts = Array.isArray(trace?.attempts)
    ? trace.attempts.map((item: any) => ({
        attemptIndex: Number(item?.attemptIndex || 0),
        parseMode: String(item?.parseMode || 'none'),
        structuredOutputValid: item?.structuredOutputValid === true,
        failureType: String(item?.failureType || 'none'),
        violations: Array.isArray(item?.violations) ? item.violations.map((violation: any) => String(violation)) : [],
        rawContent: String(item?.rawContent || '')
      }))
    : [];

  const latestAiContent = currentAiMessage.value?.content || '';
  const visibleReply = latestAiContent.trim() || String(trace?.rawUserVisible || '').trim() || '本轮没有写入可见回复。';
  const rawUserVisible = String(trace?.rawUserVisible || '').trim() || '本轮没有单独返回 rawUserVisible。';
  const parseMode = String(trace?.parseMode || 'none');
  const attemptCount = Number(trace?.attemptCount || attempts.length || 0);
  const stateApplied = trace?.stateApplied === true;

  return {
    statusLabel: stateApplied ? '结构化成功，状态已更新' : '结构化失败，状态未更新',
    parseModeLabel: `解析模式：${parseMode}`,
    attemptLabel: `尝试 ${attemptCount} 次`,
    visibleReply,
    rawUserVisible,
    attempts
  };
});

const testTraceById = computed<Record<string, any>>(() => {
  if (!isTestMode.value || !Array.isArray(testDebug.value.requestLog)) {
    return {};
  }

  return testDebug.value.requestLog.reduce((acc: Record<string, any>, trace: any) => {
    const id = String(trace?.id || '');
    if (id) {
      acc[id] = trace;
    }
    return acc;
  }, {});
});

const buildTraceCardFromTrace = (trace: any, visibleReply: string): TestLatestTraceCardView | null => {
  if (!trace) return null;

  const attempts = Array.isArray(trace?.attempts)
    ? trace.attempts.map((item: any) => ({
        attemptIndex: Number(item?.attemptIndex || 0),
        parseMode: String(item?.parseMode || 'none'),
        structuredOutputValid: item?.structuredOutputValid === true,
        failureType: String(item?.failureType || 'none'),
        violations: Array.isArray(item?.violations) ? item.violations.map((violation: any) => String(violation)) : [],
        rawContent: String(item?.rawContent || '')
      }))
    : [];

  const parseMode = String(trace?.parseMode || 'none');
  const attemptCount = Number(trace?.attemptCount || attempts.length || 0);
  const stateApplied = trace?.stateApplied === true;

  return {
    statusLabel: stateApplied ? '结构化成功，状态已更新' : '结构化失败，状态未更新',
    stageBeforeLabel: `请求前阶段：${String(trace?.stageBefore || 'unknown')}`,
    promptVersionLabel: `Prompt：v${Number(trace?.promptVersion || 0)}`,
    parseModeLabel: `解析模式：${parseMode}`,
    attemptLabel: `尝试 ${attemptCount} 次`,
    input: String(trace?.input || '').trim() || '本轮没有记录输入。',
    stateSnapshot: toPrettyJson(trace?.stateSnapshot || {}),
    requestMessages: toPrettyJson(trace?.requestMessages || []),
    visibleReply: visibleReply.trim() || String(trace?.rawUserVisible || '').trim() || '本轮没有写入可见回复。',
    rawUserVisible: String(trace?.rawUserVisible || '').trim() || '本轮没有单独返回 rawUserVisible。',
    attempts
  };
};

const getTraceCardForMessage = (message: Message): TestLatestTraceCardView | null => {
  if (!isTestMode.value || !message.traceId) return null;
  return buildTraceCardFromTrace(testTraceById.value[message.traceId], message.content || '');
};

const getTraceStatusBadge = (message: Message): TraceStatusBadgeView | null => {
  if (!isTestMode.value || !message.traceId) {
    return null;
  }

  const trace = testTraceById.value[message.traceId];
  if (!trace) {
    return null;
  }

  if (trace?.stateApplied === false) {
    return {
      label: trace?.structuredOutputValid === false ? '结构失败，已记录原始输出' : '状态未应用',
      tone: 'warning'
    };
  }

  return {
    label: '状态已应用',
    tone: 'success'
  };
};

const toggleTraceForMessage = (messageId: string) => {
  expandedTraceMessageId.value = expandedTraceMessageId.value === messageId ? null : messageId;
};

const isTraceExpanded = (messageId: string) => expandedTraceMessageId.value === messageId;

const handleTraceDetailsToggle = (messageId: string, isOpen: boolean) => {
  expandedTraceMessageId.value = isOpen ? messageId : (expandedTraceMessageId.value === messageId ? null : expandedTraceMessageId.value);
};

const attachTraceIdToLatestUserMessage = () => {
  if (!isTestMode.value || userMessages.value.length === 0 || !Array.isArray(testDebug.value.requestLog)) {
    return;
  }

  const latestTrace = testDebug.value.requestLog[testDebug.value.requestLog.length - 1];
  if (!latestTrace?.id) return;

  const latestUserMessage = userMessages.value[userMessages.value.length - 1];
  if (latestUserMessage) {
    latestUserMessage.traceId = String(latestTrace.id);
    latestUserMessage.isObservationFailure = latestTrace?.stateApplied === false;
  }
};

const attachTraceIdToLatestAiMessage = () => {
  if (!isTestMode.value || aiMessages.value.length === 0 || !Array.isArray(testDebug.value.requestLog)) {
    return;
  }

  const latestTrace = testDebug.value.requestLog[testDebug.value.requestLog.length - 1];
  if (!latestTrace?.id) return;

  const latestAiMessage = aiMessages.value[aiMessages.value.length - 1];
  if (latestAiMessage) {
    latestAiMessage.traceId = String(latestTrace.id);
    latestAiMessage.isObservationFailure = latestTrace?.stateApplied === false;
  }
};

const reconcileMessageTraceIds = () => {
  if (!isTestMode.value || !Array.isArray(testDebug.value.requestLog)) {
    return;
  }

  const traces = testDebug.value.requestLog;
  userMessages.value.forEach((message, index) => {
    const trace = traces[index];
    if (trace?.id) {
      message.traceId = String(trace.id);
      message.isObservationFailure = trace?.stateApplied === false;
    }
  });

  aiMessages.value.forEach((message, index) => {
    const trace = traces[index];
    if (trace?.id) {
      message.traceId = String(trace.id);
      message.isObservationFailure = trace?.stateApplied === false;
    }
  });
};

const pendingClarificationItems = computed<WorkbenchPendingItem[]>(() => {
  const items: WorkbenchPendingItem[] = [];

  nextQuestions.value.slice(0, 2).forEach((question, index) => {
    items.push({
      title: index === 0 ? '当前关键问题' : `后续待确认 ${index + 1}`,
      desc: question,
      emphasis: 'question'
    });
  });

  if (!surfaceGoalText.value) {
    items.push({
      title: '表面目标还不够明确',
      desc: '先用一句话说清你现在最想学什么，或想解决什么。',
      emphasis: 'missing'
    });
  }

  if (!realProblemText.value || realProblemText.value === surfaceGoalText.value) {
    items.push({
      title: '真实问题还没落到场景',
      desc: '需要把“想学什么”进一步落到真实场景、阻碍和影响上。',
      emphasis: 'missing'
    });
  }

  if (!currentBaselineText.value) {
    items.push({
      title: '当前基础还没校准',
      desc: '确认你现在会到什么程度，才能判断第一版应该先补概念还是先做最小实践。',
      emphasis: 'missing'
    });
  }

  if (!availableTimeText.value) {
    items.push({
      title: '可投入资源还不够清楚',
      desc: '每天或每周能投入多少时间，会直接决定路径颗粒度。',
      emphasis: 'missing'
    });
  }

  if (!constraintChips.value.length) {
    items.push({
      title: '边界条件还没收齐',
      desc: '哪些不能接受、哪些暂不处理，会直接影响第一版路径的范围。',
      emphasis: 'missing'
    });
  }

  if (!firstDeliverableText.value) {
    items.push({
      title: '第一版交付目标还没明确',
      desc: '先确认第一次最小结果是什么，避免一开始就把目标做大。',
      emphasis: 'missing'
    });
  }

  const deduped = items.filter((item, index, array) => {
    return array.findIndex((candidate) => candidate.title === item.title && candidate.desc === item.desc) === index;
  });

  if (deduped.length === 0) {
    return [{
      title: '已具备生成条件',
      desc: '核心问题、基础、时间和边界已经足够清楚，可以先确认方向后生成第一版路径。',
      emphasis: 'question'
    }];
  }

  return deduped;
});

const currentAiPlainText = computed(() => currentAiMessage.value ? toPlainText(currentAiMessage.value.content) : '');
const currentQuestionText = computed(() => {
  const nextQuestion = nextQuestions.value.find((question) => question.trim().length > 0);
  if (nextQuestion) {
    return nextQuestion.trim();
  }

  const extracted = extractQuestionFromText(currentAiPlainText.value);
  if (extracted) {
    return extracted;
  }

  if (!conversationId.value) {
    return '你最近最想解决的一件事是什么？';
  }

  return '这件事里现在最关键、最需要先确认的一点是什么？';
});

const currentAiSummaryText = computed(() => {
  if (!currentAiPlainText.value) return '';

  if (currentQuestionText.value && currentAiPlainText.value.includes(currentQuestionText.value)) {
    return clipText(currentAiPlainText.value.replace(currentQuestionText.value, '').trim(), 180);
  }

  return clipText(currentAiPlainText.value, 180);
});

const showProposalActionPanel = computed(() => {
  return currentStage.value === 'proposing' && !isCompleted.value;
});

const supplementMode = ref(false);

const proposalSuggestions = computed(() => {
  const suggestions: string[] = [];
  if (understanding.value.background?.expected_time) {
    suggestions.push(`预计见效时间：${understanding.value.background.expected_time}`);
  }
  if (understanding.value.background?.available_time) {
    suggestions.push(`可用学习时间：${understanding.value.background.available_time}`);
  }
  return suggestions.slice(0, 2);
});

const proposalStageHighlights = computed(() => uniqueTextList([
  ...proposalKeyStages.value
]).slice(0, 4));

const handleConfirmProposal = async () => {
  await confirmProposal('确认，生成路径');
};

const handleContinueSupplement = () => {
  supplementMode.value = true;
  nextTick(() => {
    inputField.value?.focus();
    autoResize();
  });
};

const handleCancelSupplement = () => {
  supplementMode.value = false;
};

const inputHint = computed(() => {
  if (currentStage.value === 'proposing') return '先确认方向是否正确，或继续补边界';
  if (!conversationId.value) return '先说现状，我来帮你收窄。';
  if (nextQuestions.value.length > 0) return `当前聚焦：${nextQuestions.value[0]}`;
  if (!realProblemText.value) return '先把真实问题说具体，路径才不会变空';
  return '补充这一轮信息，帮助系统决定下一步如何追问';
});

const topbarDescription = computed(() => {
  if (isCompleted.value || generatedPathStatus.value === 'generated') {
    return '已经把问题收敛到可执行范围，现在可以直接查看这次生成的学习路径。';
  }

  if (currentStage.value === 'proposing') {
    return '方向已经初步收敛，先确认第一版切入点是否正确。';
  }

  return '先把混乱说出来，再把问题理清楚。';
});

const topbarPill = computed(() => {
  if (isCompleted.value || generatedPathStatus.value === 'generated') return '可查看路径';
  if (currentStage.value === 'proposing') return '待确认';
  return '规划中';
});

const topbarPrimaryActionLabel = computed(() => {
  if (generatedPathStatus.value === 'generating') return '路径生成中';
  return '查看生成路径';
});

const canShowTopbarPrimaryAction = computed(() => {
  return Boolean(generatedPathId.value) && generatedPathStatus.value !== 'failed';
});

const planningConfidencePercent = computed(() => Math.max(0, Math.min(100, Math.round(confidence.value * 100))));

const activePlanningStageLabel = computed(() => {
  if (isCompleted.value || currentStage.value === 'completed' || currentStage.value === 'ready') return '可生成路径';
  if (currentStage.value === 'proposing') return '方案确认中';
  return '继续澄清中';
});

const readStoredConversationId = () => {
  return localStorage.getItem(conversationStorageKey.value) || '';
};

const writeStoredConversationId = (id: string) => {
  if (!id) {
    localStorage.removeItem(conversationStorageKey.value);
    return;
  }

  localStorage.setItem(conversationStorageKey.value, id);
};

const syncConversationRoute = (id: string) => {
  const normalized = id.trim();
  const currentRouteId = typeof route.params.conversationId === 'string' ? route.params.conversationId : '';

  if (normalized === currentRouteId) {
    return;
  }

  const suffix = buildRouteQuery();
  router.replace(normalized
    ? `${conversationBasePath.value}/${normalized}${suffix ? `?${suffix}` : ''}`
    : `${conversationBasePath.value}${suffix ? `?${suffix}` : ''}`);
};

const mapStoredMessage = (message: any, index: number): Message | null => {
  if (!message || (message.role !== 'user' && message.role !== 'ai')) {
    return null;
  }

  return {
    id: `${message.role}-${message.time || index}`,
    role: message.role,
    content: String(message.content || ''),
    time: message.time ? new Date(message.time) : new Date(),
    quickReplies: [],
    quickRepliesUsed: true
  };
};

const syncConversationState = (response: GoalConversationEnvelope) => {
  const core = response.internal.core;
  const goalExt = response.internal.ext.goalConversation;

  conversationId.value = core.conversationId || conversationId.value;
  currentStage.value = core.stage || currentStage.value;
  confidence.value = typeof core.confidence === 'number' ? core.confidence : confidence.value;
  isCompleted.value = !!core.isCompleted;
  conversationComplete.value = !!core.isCompleted;

  nextQuestions.value = Array.isArray(goalExt.nextQuestions)
    ? goalExt.nextQuestions.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  collectedData.value = goalExt.collected || {};

  if (goalExt.understanding) {
    understanding.value = { ...understanding.value, ...goalExt.understanding };
  }

  structuredData.value = goalExt.structuredData || structuredData.value;
  confidenceScores.value = goalExt.confidenceScores || confidenceScores.value;

  if (goalExt.confirmedProposal) {
    confirmedProposal.value = goalExt.confirmedProposal;
  } else if (core.stage === 'understanding') {
    confirmedProposal.value = null;
  }

  if (core.learningPath) {
    generatedPathId.value = core.learningPath.id;
    generatedPathStatus.value = core.learningPath.status || null;
  }

  if (response.meta?.debug) {
    testDebug.value = response.meta.debug;
  }

  if (conversationId.value) {
    writeStoredConversationId(conversationId.value);
    syncConversationRoute(conversationId.value);
  }
};

const loadVirtualContext = async () => {
  if (!virtualSessionId.value) {
    virtualContext.value = null;
    return '';
  }

  const response = await adminApi.getVirtualSessionContext(virtualSessionId.value);
  if (!response.data?.success) {
    throw new Error(response.data?.error || '加载虚拟会话上下文失败');
  }

  virtualContext.value = response.data.data;
  return String(response.data.data?.bindings?.goalConversationId || '');
};

const syncConversationHistory = (messages: any[] = []) => {
  const mappedMessages = messages
    .map((message, index) => mapStoredMessage(message, index))
    .filter((message): message is Message => Boolean(message));

  aiMessages.value = mappedMessages.filter((message) => message.role === 'ai');
  userMessages.value = mappedMessages.filter((message) => message.role === 'user');

  reconcileMessageTraceIds();

};

const hydrateConversation = (response: GoalConversationEnvelope, options?: { messages?: any[] }) => {
  syncConversationState(response);

  if (options?.messages) {
    syncConversationHistory(options.messages);
  }
};

const restoreConversation = async (targetConversationId?: string) => {
  const routeConversationId = typeof route.params.conversationId === 'string' ? route.params.conversationId : '';
  const virtualGoalConversationId = virtualSessionId.value ? await loadVirtualContext() : '';
  const storedId = (targetConversationId || virtualGoalConversationId || routeConversationId).trim();
  if (!storedId) return;

  loading.value = true;
  try {
    const response = isTestMode.value
      ? await getTestGoalConversation(storedId)
      : await getGoalConversation(storedId);
    hydrateConversation(response, {
      messages: response.meta.messages
    });
    await scrollToBottom();
  } catch (error: any) {
    writeStoredConversationId('');
    if (error?.response?.status !== 404) {
      toast.error(error.message || '恢复对话失败，请稍后重试');
    }
  } finally {
    loading.value = false;
  }
};

const resetLocalConversationState = () => {
  understanding.value = {};
  nextQuestions.value = [];
  collectedData.value = {};
  structuredData.value = null;
  confirmedProposal.value = null;
  confidenceScores.value = null;
  testDebug.value = {};
  showUnderstandingExpanded.value = false;
  showAllSuggestions.value = false;
  realProblemConfirmed.value = false;
  confidence.value = 0;
  currentStage.value = 'understanding';
  conversationId.value = '';
  conversationComplete.value = false;
  isCompleted.value = false;
  generatedPathId.value = null;
  generatedPathStatus.value = null;
  showUploadPanel.value = false;
  userInput.value = '';
  lastUserMessage.value = '';
  clearQuickReplySelection();
  aiMessages.value = [];
  userMessages.value = [];
  uploadedFiles.value.forEach((file) => revokePreviewUrl(file.previewUrl));
  uploadedFiles.value = [];
  if (!virtualSessionId.value) {
    writeStoredConversationId('');
    syncConversationRoute('');
  }
};

const formatMessage = (text: string) => md.render(text);
const formatTime = (date: Date | string) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isFailedMessage = (content: string) => {
  const failKeywords = ['走神了', '抱歉', '出错了', '失败了', '请稍后', '网络错误'];
  return failKeywords.some(keyword => content.includes(keyword));
};

// 导航到学习路径
const navigateToLearningPath = () => {
  const learningPathsRoute = isTestMode.value ? testLearningPathsBasePath.value : '/learning-paths';
  const learningPathDetailBase = isTestMode.value ? testLearningPathDetailBasePath.value : '/learning-path';
  const query = new URLSearchParams();
  if (virtualSessionId.value) query.set('virtualSessionId', virtualSessionId.value);
  if (viewMode.value) query.set('viewMode', viewMode.value);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  if (generatedPathStatus.value === 'generating') {
    router.push(`${learningPathsRoute}${suffix}`);
  } else if (generatedPathId.value) {
    router.push(`${learningPathDetailBase}/${generatedPathId.value}${suffix}`);
  } else {
    router.push(`${learningPathsRoute}${suffix}`);
  }
};

  // 重新生成学习路径
  const regeneratePath = async () => {
    if (isTestMode.value) return;
    if (!conversationId.value || regenerating.value) return;

    regenerating.value = true;
    try {
      const response = await regenerateGoalConversation(
        conversationId.value,
        regenerateAdjustments.value || undefined
      );
      syncConversationState(response);
      toast.success(response.userVisible || '学习路径已重新生成！');
      showRegenerateDialog.value = false;
      regenerateAdjustments.value = '';
    } catch (error: any) {
      console.error('重新生成路径失败:', error);
      toast.error(error.message || '重新生成失败，请重试');
    } finally {
      regenerating.value = false;
    }
  };

  // 完全重新开始（删除当前对话）
  const startFresh = async () => {
    try {
      await ElMessageBox.confirm(
        '确定要完全重新开始吗？当前对话和学习路径将被删除。',
        '重新开始',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        }
      );

      if (conversationId.value) {
        if (isTestMode.value) {
          await deleteTestGoalConversation(conversationId.value);
        } else {
          await deleteGoalConversation(conversationId.value);
        }
      }

      resetLocalConversationState();
      showRegenerateDialog.value = false;

      toast.success('已重置，请重新描述你的学习目标');
    } catch {
      // 用户取消
    }
  };

// 导航到首页
const navigateToHome = () => {
  const token = localStorage.getItem('token');
  if (token) {
    router.push(navDashboardPath.value);
  } else {
    router.push('/');
  }
};

const retryLastMessage = async () => {
    if (!lastUserMessage.value || loading.value) return;
    if (aiMessages.value.length > 0) {
      aiMessages.value.pop();
    }
    await sendMessageInternal(lastUserMessage.value);
  };

  const confirmRealProblem = () => {
    realProblemConfirmed.value = true;
    toast.success('已确认，继续描述你的需求');
  };

  const resetConversation = async () => {
    try {
      await ElMessageBox.confirm('确定要重置本次目标吗？当前对话将被清空。', '重置本次目标', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      });

      if (conversationId.value) {
        if (isTestMode.value) {
          await deleteTestGoalConversation(conversationId.value);
        } else {
          await deleteGoalConversation(conversationId.value);
        }
      }

      resetLocalConversationState();
      
      toast.info(isTestMode.value ? '已清空测试会话，请重新描述你的目标' : '已清空，请重新描述你的学习目标');
    } catch {
      // 用户取消
    }
  };

  // 清空所有历史记录（开发调试用）
  const clearAllHistory = async () => {
    };

const setInput = (text: string) => {
  userInput.value = text;
  showAllSuggestions.value = false;
  nextTick(() => inputField.value?.focus());
  autoResize();
};

const autoResize = () => {
  const textarea = inputField.value;
  if (textarea) {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 120;
    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
  }
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

const getStructuredFailureEnvelope = (error: any): GoalConversationEnvelope | null => {
  if (!isStructuredOutputInvalidError(error)) return null;
  return error?.response?.data?.data || null;
};

const isObservationFailureResponse = (response: GoalConversationEnvelope | null | undefined) => {
  if (!isTestMode.value || !response?.meta?.debug) return false;
  return response.meta.debug.observationMode === true && response.meta.debug.stateApplied === false;
};

const startConversation = async (goal: string) => {
  loading.value = true;
  try {
    const response = isTestMode.value
      ? await startTestGoalConversation(goal)
      : await startGoalConversation(goal, {
          contextMode: contextMode.value
        });
    syncConversationState(response);
    attachTraceIdToLatestUserMessage();

    if (isObservationFailureResponse(response)) {
      scrollToBottom();
      toast.warning('本轮结构化失败，已保留请求并记录原始输出。');
      return;
    }

    aiMessages.value.push({
      id: Date.now().toString(),
      role: 'ai',
      content: response.userVisible,
      time: new Date(),
      quickReplies: response.renderHints.quickReplies,
      quickRepliesUsed: false
    });
    attachTraceIdToLatestAiMessage();
    scrollToBottom();
  } catch (error: any) {
    console.error('开始对话失败:', error);
    const failureEnvelope = getStructuredFailureEnvelope(error);
    if (failureEnvelope) {
      syncConversationState(failureEnvelope);
      attachTraceIdToLatestUserMessage();
      toast.warning('本轮结构化输出连续失败，状态未更新。可点击重试再试一次。');
    } else {
      toast.error(error.message || '开始对话失败，请稍后重试');
    }
  } finally {
    loading.value = false;
  }
};

// 隐藏上一条 AI 消息的快速回复按钮
const hideLastAiQuickReplies = () => {
  // 找到最后一条有 quickReplies 的 AI 消息
  for (let i = aiMessages.value.length - 1; i >= 0; i--) {
    if (aiMessages.value[i].quickReplies && aiMessages.value[i].quickReplies.length > 0) {
      aiMessages.value[i].quickRepliesUsed = true;
      break;
    }
  }
};

const sendMessage = async () => {
  const trimmedInput = userInput.value.trim();
  const hasSelections = selectedQuickReplies.value.length > 0;
  
  if (!trimmedInput && !hasSelections) return;
  if (loading.value) return;
  
  if (supplementMode.value) {
    supplementMode.value = false;
  }
  
  const content = hasSelections ? composeQuickReplyPayload() : trimmedInput;
  
  hideLastAiQuickReplies();
  clearQuickReplySelection();
  
  userInput.value = '';
  autoResize();
  lastUserMessage.value = content;
  userMessages.value.push({
    id: Date.now().toString(),
    role: 'user',
    content,
    time: new Date()
  });
  scrollToBottom();
  if (!conversationId.value) {
    await startConversation(content);
    return;
  }
  await sendMessageInternal(content);
};

// 快速回复已改为多选模式，点击由 toggleQuickReplySelection 处理

// 确认方案 - 生成学习路径
const confirmProposal = async (confirmText = '确认方案，生成学习路径') => {
  if (loading.value) return;

  hideLastAiQuickReplies();

  userMessages.value.push({
    id: Date.now().toString(),
    role: 'user',
    content: confirmText,
    time: new Date()
  });
  scrollToBottom();

  try {
    if (!conversationId.value) {
      await startConversation(confirmText);
      return;
    }

    loading.value = true;
      const response = isTestMode.value
        ? await replyTestGoalConversation(conversationId.value, confirmText, { confirmProposal: true })
        : await replyGoalConversation(conversationId.value, confirmText, {
            contextMode: contextMode.value,
            confirmProposal: true
          });
    syncConversationState(response);
    attachTraceIdToLatestUserMessage();

    if (isObservationFailureResponse(response)) {
      scrollToBottom();
      toast.warning('本轮结构化失败，已保留请求并记录原始输出。');
      return;
    }

    aiMessages.value.push({
      id: Date.now().toString(),
      role: 'ai',
      content: response.userVisible || '已确认方案，正在生成学习路径...',
      time: new Date(),
      quickReplies: response.renderHints.quickReplies,
      quickRepliesUsed: false
    });
    attachTraceIdToLatestAiMessage();

    scrollToBottom();

    // 确认按钮点击后必定跳转学习路径页（强兜底，不依赖 stage/learningPath）
    const nextConversationId = conversationId.value || response.internal.core.conversationId || '';
    const targetBase = isTestMode.value ? testLearningPathsBasePath.value : '/learning-paths';
    const query = new URLSearchParams({
      from: 'goal',
      auto: '1'
    });
    if (nextConversationId) {
      query.set('conversationId', nextConversationId);
    }
    router.push(`${targetBase}?${query.toString()}`);
  } catch (error: any) {
    console.error('确认方案失败:', error);
    if (isTestMode.value && error?.status === 404) {
      toast.error(error.message || '测试会话已失效，请重新开始测试目标对话');
      resetLocalConversationState();
      return;
    }
    const failureEnvelope = getStructuredFailureEnvelope(error);
    if (failureEnvelope) {
      syncConversationState(failureEnvelope);
      attachTraceIdToLatestUserMessage();
      if (!isTestMode.value && userMessages.value.length > 0) {
        userMessages.value.pop();
      }
      toast.warning('本轮结构化输出连续失败，状态未更新。请重试确认。');
    } else {
      toast.error(error.message || '确认失败，请重试');
    }
  } finally {
    loading.value = false;
  }
};

const sendMessageInternal = async (content: string) => {
  loading.value = true;
  try {
    const response = isTestMode.value
      ? await replyTestGoalConversation(conversationId.value, content)
      : await replyGoalConversation(conversationId.value, content, {
          contextMode: contextMode.value
        });
    syncConversationState(response);
    attachTraceIdToLatestUserMessage();

    if (isObservationFailureResponse(response)) {
      scrollToBottom();
      toast.warning('本轮结构化失败，已保留请求并记录原始输出。');
      return;
    }

    aiMessages.value.push({
      id: Date.now().toString(),
      role: 'ai',
      content: response.userVisible,
      time: new Date(),
      quickReplies: response.renderHints.quickReplies,
      quickRepliesUsed: false
    });
    attachTraceIdToLatestAiMessage();

    if (response.internal.core.isCompleted) {
      toast.success('问题理解完成！');
    }

    scrollToBottom();
  } catch (error: any) {
    console.error('回复失败:', error);
    if (isTestMode.value && error?.status === 404) {
      toast.error(error.message || '测试会话已失效，请重新开始测试目标对话');
      resetLocalConversationState();
      return;
    }
    const failureEnvelope = getStructuredFailureEnvelope(error);
    if (failureEnvelope) {
      syncConversationState(failureEnvelope);
      attachTraceIdToLatestUserMessage();
      if (!isTestMode.value && userMessages.value.length > 0) {
        userMessages.value.pop();
      }
      toast.warning('本轮结构化输出连续失败，状态未更新。请点击重试再试一次。');
    } else {
      toast.error(error.message || '回复失败，请稍后重试');
    }
  } finally {
    loading.value = false;
  }
};

const handleScroll = () => {
  headerScrolled.value = window.scrollY > 50;
};

onMounted(() => {
  void restoreConversation();
  
  window.addEventListener('scroll', handleScroll);
});

watch(
  () => route.query.virtualSessionId,
  (nextId, prevId) => {
    const nextValue = typeof nextId === 'string' ? nextId : '';
    const prevValue = typeof prevId === 'string' ? prevId : '';
    if (nextValue === prevValue) return;
    resetLocalConversationState();
    void restoreConversation();
  }
);

watch(
  () => route.params.conversationId,
  (newConversationId, oldConversationId) => {
    const nextId = typeof newConversationId === 'string' ? newConversationId : '';
    const prevId = typeof oldConversationId === 'string' ? oldConversationId : '';

    if (!nextId) {
      resetLocalConversationState();
      return;
    }

    if (nextId !== prevId && nextId !== conversationId.value) {
      resetLocalConversationState();
      void restoreConversation(nextId);
    }
  }
);

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
  uploadedFiles.value.forEach((file) => revokePreviewUrl(file.previewUrl));
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.goal-conversation-page {
  height: 100vh;
  height: 100dvh;
  background: var(--bg-body);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.animated-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.4;
  animation: float 20s ease-in-out infinite;
}

.gradient-orb-1 {
  width: 800px;
  height: 800px;
  background: var(--gradient-primary);
  top: -300px;
  right: -200px;
}

.gradient-orb-2 {
  width: 600px;
  height: 600px;
  background: var(--gradient-achievement);
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(50px, 50px) scale(1.05);
  }
}

/* ========== 头部导航 ========== */
.dashboard-header {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid transparent;
  transition: all 0.3s ease;
}

.header-scrolled,
.dashboard-header--scrolled {
  background: rgba(255, 255, 255, 0.95);
  border-bottom-color: var(--border-default);
  box-shadow: var(--shadow-sm);
}

[data-theme="dark"] .dashboard-header {
  background: rgba(26, 37, 47, 0.85);
}

[data-theme="dark"] .header-scrolled,
[data-theme="dark"] .dashboard-header--scrolled {
  background: rgba(26, 37, 47, 0.95);
}

.header-container {
  max-width: 1600px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
}

.brand-icon {
  font-size: 1.75rem;
}

.brand-text {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.header-divider {
  width: 1px;
  height: 24px;
  background: var(--border-light);
}

.session-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-badge {
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-full);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.session-badge.stage-info {
  background: var(--color-progress-bg);
  border: 1px solid var(--color-progress-border);
  color: var(--text-on-info-light);
}

.session-badge.stage-warning {
  background: var(--color-efficient-bg);
  border: 1px solid var(--color-efficient-border);
  color: var(--text-on-warning-light);
}

.session-badge.stage-success {
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
  color: var(--text-on-success-light);
}

.session-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: var(--radius-xl);
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.nav-item:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

.nav-item-active {
  background: var(--color-primary);
  color: white;
}

.nav-item-active:hover {
  background: var(--color-primary);
  color: white;
}

.nav-item-highlight {
  background: var(--gradient-primary);
  color: white;
}

.nav-item-highlight:hover {
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid var(--border-light);
  transition: border-color 0.2s ease;
}

.user-avatar:hover {
  border-color: var(--color-primary);
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-primary);
  color: white;
  font-weight: 600;
  font-size: 1rem;
}

/* ========== 玻璃卡片 ========== */
.glass-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
}

[data-theme="dark"] .glass-card {
  background: rgba(26, 37, 47, 0.7);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ========== 主内容区 ========== */
.main-content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 2rem;
}

.content-container {
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

/* ========== 问题理解面板 ========== */
.understanding-panel {
  margin: 1.5rem 0 0;
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
}

.panel-header-actions {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.panel-title-wrapper {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.panel-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: var(--gradient-warning);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.panel-title-content {
  flex: 1;
}

.panel-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.25rem 0;
}

.panel-subtitle {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

.confidence-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.panel-summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.summary-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.8rem;
  border-radius: var(--radius-full);
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
}

.summary-chip-primary {
  background: rgba(102, 126, 234, 0.12);
  color: var(--color-primary-dark);
}

.confidence-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.confidence-bar-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.confidence-bar {
  width: 100px;
  height: 8px;
  background: rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.confidence-fill {
  height: 100%;
  min-width: 8px;
  border-radius: var(--radius-full);
  transition: width 0.3s ease, background 0.3s ease;
}

.confidence-fill.high {
  background: var(--gradient-success);
}

.confidence-fill.medium {
  background: var(--gradient-warning);
}

.confidence-fill.low {
  background: var(--gradient-danger);
}

.confidence-value {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 36px;
  text-align: right;
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.understanding-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

@media (max-width: 1024px) {
  .understanding-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .understanding-grid {
    grid-template-columns: 1fr;
  }
}

.understanding-card {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
  padding: 1rem;
  border-radius: var(--radius-xl);
  transition: all 0.2s ease;
}

.understanding-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.card-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.card-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-value {
  font-size: 0.9375rem;
  color: var(--text-primary);
  font-weight: 600;
  word-break: break-word;
}

.card-value.surface {
  color: var(--color-primary);
}

.card-value.real {
    color: var(--color-warning);
  }

  .real-problem-card {
    border: 2px solid var(--color-success);
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(16, 185, 129, 0.1));
    position: relative;
    overflow: hidden;
  }

  .real-problem-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--gradient-success);
  }

  .real-problem-card .card-icon {
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.1);
    }
  }

  .real-problem-hint {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--border-light);
    font-style: italic;
  }

  .real-problem-actions {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(16, 185, 129, 0.05);
    border-radius: var(--radius-xl);
    animation: fadeIn 0.3s ease;
  }

.understanding-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.panel-toggle {
  align-self: flex-start;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.panel-toggle:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.tag {
  padding: 0.375rem 0.875rem;
  background: var(--gradient-primary);
  color: white;
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
}

/* ========== 聊天区域 ========== */
.planning-chat-flow {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.planning-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
  overflow-x: hidden;
}

.planning-conversation-layout--entry .planning-messages {
  max-height: none;
  gap: 8px;
}

.planning-conversation-layout--entry .planning-chat-flow {
  min-height: 0;
  gap: 8px;
}

.planning-conversation-layout--entry .planning-start-card {
  align-self: start;
}

.planning-msg {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 16px;
  display: grid;
  gap: 4px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  animation: fadeIn 0.3s ease;
  align-self: start;
}

.planning-msg--ai {
  align-self: flex-start;
  background: rgba(243, 246, 251, 0.94);
}

[data-theme="dark"] .planning-msg--ai {
  background: rgba(30, 41, 59, 0.94);
  border-color: rgba(255, 255, 255, 0.08);
}

.planning-msg--user {
  align-self: flex-end;
  background: rgba(52, 120, 246, 0.09);
}

[data-theme="dark"] .planning-msg--user {
  background: rgba(52, 120, 246, 0.18);
  border-color: rgba(52, 120, 246, 0.2);
}

.planning-msg__meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.planning-msg__meta small {
  font-size: 11px;
  color: var(--planning-muted);
}

.planning-msg__role {
  font-size: 11px;
  font-weight: 700;
  color: var(--planning-blue-deep);
  letter-spacing: 0.04em;
}

.planning-msg__debug-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  border: 1px solid transparent;
  white-space: nowrap;
}

.planning-msg__debug-badge--warning {
  color: #9a3412;
  background: rgba(251, 191, 36, 0.18);
  border-color: rgba(245, 158, 11, 0.3);
}

.planning-msg__debug-badge--success {
  color: #166534;
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.28);
}

.planning-msg__debug-badge--info {
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.24);
}

.planning-msg p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--planning-ink);
}

.planning-msg p :deep(p) {
  margin: 0 0 0.75rem;
}

.planning-msg p :deep(p:last-child) {
  margin-bottom: 0;
}

.planning-msg p :deep(ul),
.planning-msg p :deep(ol) {
  margin: 0.5rem 0 0.75rem;
  padding-left: 1.25rem;
}

.planning-msg p :deep(ul:last-child),
.planning-msg p :deep(ol:last-child) {
  margin-bottom: 0;
}

.planning-msg p :deep(li) {
  margin: 0.25rem 0;
}

.planning-msg p :deep(code) {
  padding: 0.125rem 0.375rem;
  border-radius: 0.375rem;
  background: rgba(52, 120, 246, 0.1);
  color: var(--planning-blue-deep);
  font-size: 0.875em;
}

.planning-msg p :deep(pre) {
  margin: 0.75rem 0;
  padding: 0.875rem 1rem;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.92);
  overflow-x: auto;
}

.planning-msg p :deep(pre code) {
  padding: 0;
  background: transparent;
  color: #e2e8f0;
  font-size: 0.875rem;
}

.planning-msg p :deep(blockquote) {
  margin: 0.75rem 0;
  padding-left: 0.875rem;
  border-left: 3px solid rgba(52, 120, 246, 0.35);
  color: var(--planning-muted);
}

.planning-msg--user p {
  color: var(--planning-ink);
}

[data-theme="dark"] .planning-msg p {
  color: var(--planning-ink);
}

[data-theme="dark"] .planning-msg__meta small {
  color: rgba(148, 163, 184, 0.9);
}

[data-theme="dark"] .planning-msg__role {
  color: rgba(96, 165, 250, 0.95);
}

[data-theme="dark"] .planning-msg__debug-badge--warning {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(251, 191, 36, 0.24);
}

[data-theme="dark"] .planning-msg__debug-badge--success {
  color: #86efac;
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(134, 239, 172, 0.2);
}

[data-theme="dark"] .planning-msg__debug-badge--info {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.16);
  border-color: rgba(147, 197, 253, 0.22);
}

[data-theme="dark"] .planning-msg p :deep(code) {
  background: rgba(52, 120, 246, 0.15);
  color: rgba(96, 165, 250, 0.95);
}

[data-theme="dark"] .planning-msg p :deep(blockquote) {
  border-left-color: rgba(52, 120, 246, 0.4);
  color: rgba(148, 163, 184, 0.85);
}

[data-theme="dark"] .planning-reply-chip {
  background: rgba(30, 41, 59, 0.92);
  border-color: rgba(52, 120, 246, 0.18);
  color: rgba(96, 165, 250, 0.95);
}

[data-theme="dark"] .planning-reply-chip:hover {
  background: rgba(52, 120, 246, 0.12);
  border-color: rgba(52, 120, 246, 0.28);
}

[data-theme="dark"] .planning-selected-strip {
  background: rgba(30, 41, 59, 0.76);
  border-color: rgba(52, 120, 246, 0.25);
}

[data-theme="dark"] .planning-selected-strip__label {
  color: rgba(148, 163, 184, 0.9);
}

[data-theme="dark"] .planning-selected-reply {
  background: rgba(52, 120, 246, 0.12);
  border-color: rgba(52, 120, 246, 0.15);
  color: rgba(96, 165, 250, 0.95);
}

.planning-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 4px;
}

.planning-reply-chip {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--planning-blue-deep);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(52, 120, 246, 0.12);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.planning-reply-chip:hover {
  background: rgba(52, 120, 246, 0.08);
  border-color: rgba(52, 120, 246, 0.2);
}

.planning-reply-chip--selected {
  background: rgba(52, 120, 246, 0.14);
  border-color: rgba(52, 120, 246, 0.24);
  color: var(--planning-blue-deep);
  font-weight: 700;
}

.planning-msg__retry {
  margin-top: 8px;
}

.planning-retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: rgba(239, 68, 68, 0.08);
  color: #c23b3b;
  border: none;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.planning-retry-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.14);
}

.planning-retry-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.planning-selected-strip {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.76);
  border: 1px dashed rgba(52, 120, 246, 0.18);
}

.planning-selected-strip__label {
  font-size: 12px;
  font-weight: 700;
  color: var(--planning-muted);
}

.planning-selected-strip__items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-selected-reply {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--planning-blue-deep);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(52, 120, 246, 0.12);
}

.planning-selected-reply--dismissible {
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.planning-selected-reply--dismissible:hover {
  background: rgba(52, 120, 246, 0.06);
  border-color: rgba(52, 120, 246, 0.24);
}

.planning-selected-reply__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  color: var(--planning-muted);
}

.planning-selected-reply--dismissible:hover .planning-selected-reply__remove {
  color: var(--planning-blue-deep);
}

.typing-indicator {
  display: flex;
  gap: 0.375rem;
  padding: 1rem 1.25rem;
  width: fit-content;
}

.typing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: typing 1.4s infinite;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.7;
  }
  30% {
    transform: translateY(-10px);
    opacity: 1;
  }
}

/* ========== 输入区域 ========== */
.input-section {
  padding: 1rem 0 1.5rem;
  position: relative;
  z-index: 10;
}

.completion-banner {
  padding: 2rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.completion-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--gradient-warning);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  box-shadow: var(--shadow-md);
}

.completion-icon {
  font-size: 2rem;
}

.completion-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.completion-subtitle {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  margin: 0;
}

.completion-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1.25rem;
  background: var(--bg-muted);
  border-radius: var(--radius-lg);
  margin: 0.5rem 0;
}

.summary-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 500;
}

.summary-value {
  font-size: 0.9375rem;
  color: var(--text-primary);
  font-weight: 600;
}

.cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 2rem;
  background: var(--gradient-primary);
  color: white;
  border: none;
  border-radius: var(--radius-xl);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.cta-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.cta-btn-secondary {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 2px solid var(--border-light);
  box-shadow: none;
}

.cta-btn-secondary:hover {
  background: var(--bg-muted);
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
}

.completion-actions {
  display: flex;
  justify-content: center;
  margin-top: 0.5rem;
}

.completion-secondary-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 1rem;
}

.text-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.text-action-btn:hover {
  color: var(--color-primary);
}

.completion-notice {
  text-align: center;
  padding: 3rem 2rem;
  animation: fadeIn 0.5s ease;
}

.input-wrapper {
  display: grid;
  gap: 16px;
}

.planning-composer {
  display: grid;
  gap: 12px;
}

.planning-msg-trace {
  margin-top: 10px;
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.88);
  border: 1px solid rgba(23, 32, 51, 0.08);
}

.planning-msg-trace__summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: var(--planning-blue-deep);
  list-style: none;
}

.planning-msg-trace__summary::-webkit-details-marker {
  display: none;
}

.planning-msg-trace__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-msg-trace__meta span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--planning-blue-deep);
  font-size: 12px;
  font-weight: 600;
}

.planning-msg-trace__section {
  display: grid;
  gap: 8px;
}

.planning-msg-trace__label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--planning-muted);
}

.planning-msg-trace pre,
.planning-msg-trace__attempt pre {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.95);
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

.planning-msg-trace__raw-details {
  display: grid;
  gap: 10px;
}

.planning-msg-trace__raw-details summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--planning-ink);
}

.planning-msg-trace__attempts {
  display: grid;
  gap: 12px;
}

.planning-msg-trace__attempt {
  display: grid;
  gap: 8px;
}

.planning-msg-trace__attempt-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  color: var(--planning-muted);
  font-size: 12px;
}

.planning-msg-trace__attempt-head strong {
  color: var(--planning-ink);
  font-size: 13px;
}

.planning-msg-trace__attempt-head em {
  font-style: normal;
  color: var(--planning-blue-deep);
}

.planning-msg-trace__failure {
  color: #c23b3b;
  font-size: 12px;
  font-weight: 700;
}

.planning-msg-trace__violations {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-msg-trace__violations span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.08);
  color: #c23b3b;
  font-size: 12px;
}

.planning-composer--entry {
  margin-top: 0;
}

.planning-composer__suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.planning-composer__suggestion {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--planning-blue-deep);
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(52, 120, 246, 0.12);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.planning-composer__suggestion:hover {
  background: rgba(52, 120, 246, 0.08);
  border-color: rgba(52, 120, 246, 0.2);
}

.planning-composer__more {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--planning-muted);
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px dashed rgba(23, 32, 51, 0.12);
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}

.planning-composer__more:hover {
  border-color: rgba(52, 120, 246, 0.2);
  color: var(--planning-blue-deep);
  background: rgba(52, 120, 246, 0.04);
}

.planning-composer__box {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  padding: 14px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(23, 32, 51, 0.08);
}

.planning-composer__row {
  display: contents;
}

.planning-composer__field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.planning-composer__selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
}

.planning-composer__box textarea {
  width: auto;
  flex: 1;
  min-width: 180px;
  border: none;
  resize: none;
  outline: none;
  background: transparent;
  color: var(--planning-ink);
  font: inherit;
  font-size: 15px;
  line-height: 1.6;
  min-height: 1.6em;
  max-height: 100px;
  padding: 0;
}

.planning-composer__box textarea::placeholder {
  color: var(--planning-muted);
}

.planning-attach-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(243, 246, 251, 0.78);
  color: var(--planning-muted);
  cursor: pointer;
  transition: all 0.2s ease;
}

.planning-attach-btn span,
.planning-send-btn span {
  display: none;
}

.planning-attach-btn:hover {
  border-color: rgba(52, 120, 246, 0.2);
  color: var(--planning-blue-deep);
  background: rgba(52, 120, 246, 0.06);
}

.planning-attach-btn.active {
  border-color: rgba(52, 120, 246, 0.24);
  background: rgba(52, 120, 246, 0.08);
  color: var(--planning-blue-deep);
}

.planning-send-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--planning-blue), var(--planning-blue-deep));
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(52, 120, 246, 0.3);
}

.planning-send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(52, 120, 246, 0.4);
}

.planning-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.proposal-action-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(102, 126, 234, 0.08) 100%);
  border: 2px solid rgba(16, 185, 129, 0.35);
  border-radius: var(--radius-xl);
  margin-bottom: 0.5rem;
}

[data-theme="dark"] .proposal-action-panel {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(102, 126, 234, 0.15) 100%);
  border-color: rgba(16, 185, 129, 0.5);
}

.proposal-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.proposal-icon {
  font-size: 1.5rem;
}

.proposal-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--color-success);
  margin: 0;
}

.proposal-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.proposal-label {
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 500;
}

.proposal-value {
  font-size: 0.9375rem;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.5;
}

.proposal-suggestions {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.proposal-suggestion-label {
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 500;
}

.proposal-suggestion-list {
  margin: 0;
  padding-left: 1.25rem;
  list-style: disc;
}

.proposal-suggestion-list li {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.proposal-actions {
  display: flex;
  gap: 1rem;
  margin-top: 0.5rem;
}

.proposal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.proposal-btn-primary {
  background: linear-gradient(135deg, var(--planning-blue), var(--planning-blue-deep));
  color: white;
  border: none;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.24);
}

.proposal-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
}

.proposal-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.proposal-btn-secondary {
  background: rgba(255, 255, 255, 0.92);
  color: var(--planning-ink);
  border: 1px solid rgba(23, 32, 51, 0.08);
}

.proposal-btn-secondary:hover {
  border-color: rgba(52, 120, 246, 0.24);
  color: var(--planning-blue-deep);
  background: rgba(52, 120, 246, 0.06);
}

[data-theme="dark"] .proposal-btn-secondary {
  background: rgba(30, 41, 59, 0.92);
  color: var(--planning-ink);
  border-color: rgba(255, 255, 255, 0.08);
}

[data-theme="dark"] .proposal-btn-secondary:hover {
  border-color: rgba(96, 165, 250, 0.28);
  color: rgba(96, 165, 250, 0.95);
  background: rgba(52, 120, 246, 0.12);
}

@media (max-width: 640px) {
  .proposal-actions {
    flex-direction: column;
  }
  
  .proposal-btn {
    width: 100%;
  }
}

.proposal-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--color-info-light);
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  color: var(--color-info);
  font-weight: 500;
}

.confirm-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--bg-muted);
  border-radius: var(--radius-lg);
  margin-bottom: 0.5rem;
}

.confirm-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1.5rem;
  background: var(--gradient-success);
  color: white;
  border: none;
  border-radius: var(--radius-lg);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}

.confirm-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.confirm-hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.hint-icon {
  font-size: 1.125rem;
}

.suggestions-section {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.suggestions-label {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.label-icon {
  font-size: 1rem;
}

.suggestions-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.suggestions-more {
  border: 1px dashed var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  padding: 0.5rem 0.875rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.suggestions-more:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.suggestion-chip {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  font-size: 0.8125rem;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.suggestion-chip:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
  transform: translateY(-1px);
}

.suggestion-chip.tech { border-left: 3px solid #667eea; }
.suggestion-chip.exam { border-left: 3px solid #10b981; }
.suggestion-chip.career { border-left: 3px solid #f59e0b; }
.suggestion-chip.soft { border-left: 3px solid #ef4444; }
.suggestion-chip.transition { border-left: 3px solid #8b5cf6; }
.suggestion-chip.student { border-left: 3px solid #ec4899; }

.chip-icon {
  font-size: 0.875rem;
}

.chip-text {
  font-weight: 500;
}

.input-row {
  display: flex;
  gap: 0.75rem;
}

.input-container {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-light);
  transition: all 0.2s ease;
}

.input-container:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.planning-composer textarea {
  scrollbar-gutter: stable;
}

.input-actions {
  display: flex;
  align-items: center;
}

.send-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--gradient-primary);
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  padding-top: 0.25rem;
}

/* 重新规划对话框 */
.regenerate-dialog .el-dialog__body {
    padding: 1.5rem;
  }

  .regenerate-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .regenerate-hint {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    margin: 0;
  }

  .regenerate-options {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .option-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-muted);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all 0.2s ease;
    border: 2px solid transparent;
  }

  .option-card:hover {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }

  .option-icon {
    font-size: 2rem;
  }

  .option-info h4 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    color: var(--text-primary);
  }

  .option-info p {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .option-divider {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .adjustments-input {
    margin-top: 0.5rem;
  }

  .regenerate-btn {
    width: 100%;
  }

  .fresh-start-section {
    text-align: center;
    margin-top: 0.5rem;
  }

  .fresh-start-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin: 0.5rem 0 0;
  }

  /* ========== 动画 ========== */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-20px);
  max-height: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.upload-fold-enter-active,
.upload-fold-leave-active {
  overflow: hidden;
  transition: max-height 0.28s ease, opacity 0.22s ease, transform 0.22s ease, margin 0.28s ease, padding 0.28s ease;
}

.upload-fold-enter-from,
.upload-fold-leave-to {
  opacity: 0;
  transform: translateY(10px);
  max-height: 0;
}

.upload-fold-enter-to,
.upload-fold-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 520px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ========== Planning Upgrade ========== */
.planning-upgrade {
  --planning-ink: #172033;
  --planning-muted: #66758d;
  --planning-blue: #3478f6;
  --planning-blue-deep: #1f57cc;
  background: linear-gradient(180deg, #f7f9fd 0%, #eef3fb 100%);
  color: var(--planning-ink);
}

[data-theme="dark"] .planning-upgrade {
  --planning-ink: #e2e8f0;
  --planning-muted: #94a3b8;
  --planning-blue: #60a5fa;
  --planning-blue-deep: #3b82f6;
  background: linear-gradient(180deg, #0f172a 0%, #111c31 100%);
}

.planning-bg-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.planning-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.24;
}

.planning-bg-orb--1 {
  top: 120px;
  right: -120px;
  width: 460px;
  height: 460px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.18), transparent 70%);
  animation: orb-drift 28s ease-in-out infinite;
}

.planning-bg-orb--2 {
  left: -100px;
  bottom: 80px;
  width: 360px;
  height: 360px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.14), transparent 70%);
  animation: orb-drift 32s ease-in-out infinite reverse;
}

[data-theme="dark"] .planning-bg-orb {
  opacity: 0.14;
}

.planning-header {
  background: rgba(255, 255, 255, 0.84);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
}

[data-theme="dark"] .planning-header {
  background: rgba(15, 23, 42, 0.84);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.planning-header__inner {
  max-width: 1280px;
  min-height: 72px;
}

.planning-brand {
  border: 0;
  background: transparent;
  cursor: pointer;
}

.planning-brand__logo {
  height: 48px;
  width: auto;
  display: block;
}

.planning-nav {
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

[data-theme="dark"] .planning-nav {
  background: rgba(30, 41, 59, 0.72);
  border-color: rgba(255, 255, 255, 0.08);
}

.planning-nav .nav-item {
  border-radius: 999px;
  font-weight: 800;
}

.planning-nav .nav-item-active,
.planning-nav .nav-item:hover {
  background: rgba(52, 120, 246, 0.09);
  color: var(--planning-blue-deep);
}

[data-theme="dark"] .planning-nav .nav-item-active,
[data-theme="dark"] .planning-nav .nav-item:hover {
  background: rgba(52, 120, 246, 0.15);
  color: rgba(96, 165, 250, 0.95);
}

.planning-header__actions {
  gap: 10px;
}

.planning-user-chip {
  width: auto;
  height: auto;
}

/* Dashboard Nav Exact Override */
.dashboard-header {
  z-index: 10;
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
  backdrop-filter: blur(18px);
}

.dashboard-header--scrolled {
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.06);
}

.header-container {
  width: min(1280px, calc(100% - 48px));
  min-height: 72px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0;
}

.brand {
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #172033;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.brand-logo {
  height: 40px;
}

.brand {
  width: auto;
  justify-content: flex-start;
  flex: 0 0 auto;
}

.brand-logo,
.planning-brand__logo {
  height: 56px;
  object-fit: contain;
  display: block;
}

.header-nav {
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.nav-item {
  padding: 8px 12px;
  border-radius: 999px;
  color: color-mix(in srgb, #172033 68%, white);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.nav-item:hover,
.nav-item--active,
.planning-nav .nav-item:hover,
.planning-nav .nav-item--active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.header-right {
  gap: 10px;
}

.header-cta {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.78);
  color: #172033;
}

.user-chip span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
  font-weight: 900;
}

[data-theme="dark"] .planning-user-chip {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(30, 41, 59, 0.76);
  color: rgba(96, 165, 250, 0.95);
}

.planning-main {
  width: min(1240px, calc(100% - 48px));
  margin: 0 auto;
  padding: 28px 0 8px;
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  height: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.planning-topbar-card,
.planning-workbench {
  position: relative;
  z-index: 1;
}

.planning-topbar-card {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-end;
  padding: 20px 24px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 8px 32px rgba(15, 23, 42, 0.06);
}

.planning-topbar-card h1,
.planning-side-card h2,
.planning-chat-card__head h2 {
  margin: 0;
  color: var(--planning-ink);
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.planning-topbar-card h1 {
  margin-top: 8px;
  font-size: clamp(28px, 3.5vw, 42px);
}

.planning-topbar-card p,
.planning-side-card p,
.planning-summary-item strong,
.planning-pending-list p,
.planning-risk-note p,
.planning-chat-card__hint {
  margin: 0;
  color: var(--planning-muted);
  line-height: 1.65;
}

.planning-topbar-card p {
  max-width: 720px;
  margin-top: 6px;
}

.planning-pill,
.planning-section-kicker {
  display: inline-flex;
  width: fit-content;
  color: var(--planning-blue-deep);
  font-size: 12px;
  font-weight: 900;
}

.planning-pill {
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
}

.planning-topbar-card__actions,
.planning-completion-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.planning-secondary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid rgba(52, 120, 246, 0.15);
  background: rgba(255, 255, 255, 0.82);
  color: var(--planning-ink);
  text-decoration: none;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: 180ms ease;
}

.planning-secondary-btn:hover {
  border-color: rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.06);
  color: var(--planning-blue);
}

.planning-conversation-layout {
  display: grid;
  grid-template-columns: minmax(255px, 290px) minmax(0, 1fr);
  gap: 24px;
  align-items: stretch;
  margin-top: 0;
  min-height: 0;
  flex: 1;
}

.planning-conversation-layout--entry {
  grid-template-columns: minmax(0, 1fr);
  justify-content: center;
  min-height: 0;
}

.planning-side-card,
.planning-chat-card {
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.05);
}

.planning-side-card {
  display: grid;
  gap: 20px;
  padding: 22px 20px;
  min-height: 0;
  height: 100%;
  align-self: stretch;
  overflow-y: auto;
  overflow-x: hidden;
}

.planning-status-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-status-item {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(235, 242, 255, 0.92);
  border: 1px solid rgba(52, 120, 246, 0.14);
  color: var(--planning-blue-deep);
  font-size: 12px;
  font-weight: 700;
}

.planning-status-item--current {
  background: rgba(235, 242, 255, 0.92);
  border-color: rgba(52, 120, 246, 0.14);
  color: var(--planning-blue-deep);
}

.planning-understand__meter {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.planning-understand__meter span,
.planning-understand__meter span {
  font-size: 12px;
  font-weight: 600;
  color: var(--planning-muted);
}

.planning-understand__meter strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--planning-blue-deep);
}

.planning-meter-bar {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
}

.planning-meter-bar__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--planning-blue), var(--planning-blue-deep));
}

.planning-understand__constraints {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-constraint {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 14px;
  background: rgba(243, 246, 251, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.14);
  color: color-mix(in srgb, var(--planning-ink) 74%, white);
  font-size: 12px;
  font-weight: 600;
}

.planning-pending__list {
  display: grid;
  gap: 10px;
}

.planning-side-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.planning-side-card__head h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.18;
  letter-spacing: -0.03em;
}

.planning-side-card h2,
.planning-chat-card__head h2 {
  font-size: 24px;
}

.planning-clear-meter {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.planning-clear-meter span,
.planning-summary-item span,
.planning-risk-note span {
  color: var(--planning-muted);
  font-size: 11px;
  font-weight: 600;
}

.planning-clear-meter strong {
  color: var(--planning-blue-deep);
  font-size: 13px;
}

.planning-clear-meter__bar {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
}

.planning-clear-meter__bar div {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--planning-blue), var(--planning-blue-deep));
}

.planning-summary-stack,
.planning-pending-list {
  display: grid;
  gap: 0;
}

.planning-confirmed-block {
  display: grid;
  gap: 10px;
}

.planning-debug-block {
  display: grid;
  gap: 12px;
}

.planning-debug-block__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.planning-debug-block__hint {
  color: var(--planning-muted);
  font-size: 12px;
  line-height: 1.5;
}

.planning-debug-block__head strong {
  color: var(--planning-blue-deep);
  font-size: 12px;
  font-weight: 800;
}

.planning-debug-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.planning-debug-metric {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-debug-metric span {
  color: var(--planning-muted);
  font-size: 11px;
  font-weight: 700;
}

.planning-debug-metric strong {
  color: var(--planning-ink);
  font-size: 13px;
  line-height: 1.4;
}

.planning-debug-traces {
  display: grid;
  gap: 10px;
}

.planning-debug-trace {
  border-radius: 18px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.76);
  overflow: hidden;
}

.planning-debug-trace[open] {
  border-color: rgba(52, 120, 246, 0.2);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
}

.planning-debug-trace__summary {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
}

.planning-debug-trace__summary::-webkit-details-marker {
  display: none;
}

.planning-debug-trace__summary strong {
  display: block;
  color: var(--planning-ink);
  font-size: 13px;
}

.planning-debug-trace__summary span {
  display: block;
  margin-top: 4px;
  color: var(--planning-muted);
  font-size: 11px;
}

.planning-debug-trace__summary div span:last-child {
  color: #b45309;
}

.planning-debug-trace__summary em {
  color: var(--planning-blue-deep);
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  white-space: nowrap;
}

.planning-debug-trace__meta {
  display: grid;
  justify-items: end;
  gap: 4px;
}

.planning-debug-trace__meta span {
  color: var(--planning-muted);
  font-size: 10px;
  text-align: right;
}

.planning-debug-trace__body {
  display: grid;
  gap: 12px;
  padding: 0 16px 16px;
}

.planning-debug-trace__section {
  display: grid;
  gap: 6px;
}

.planning-debug-trace__label {
  color: var(--planning-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.planning-debug-trace__section pre {
  margin: 0;
  padding: 12px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.94);
  color: #dbeafe;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}

.planning-confirmed-block--compact {
  gap: 0;
}

.planning-summary-item,
.planning-pending-list article,
.planning-risk-note,
.planning-completion-card {
  display: grid;
  gap: 8px;
  padding: 0 0 16px;
  border-radius: 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(216, 224, 239, 0.92);
  align-self: start;
}

.planning-summary-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.planning-current-question-card {
  min-height: 100%;
  align-content: start;
}

.planning-card-group {
  display: grid;
  gap: 14px;
}

.planning-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.planning-block-label {
  color: var(--planning-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.planning-block-caption {
  color: var(--planning-blue-deep);
  font-size: 12px;
  font-weight: 800;
}

.planning-stage-stack {
  display: grid;
  gap: 10px;
}

.planning-stage-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 14px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-stage-item span {
  min-width: 34px;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--planning-blue-deep);
  font-size: 12px;
  font-weight: 900;
}

.planning-stage-item strong,
.planning-summary-item strong,
.planning-pending-card strong,
.planning-proposal-detail strong,
.planning-upload-panel__head h3 {
  color: var(--planning-ink);
}

.planning-summary-item strong {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
}

.planning-stage-item strong {
  display: block;
  font-size: 14px;
  line-height: 1.5;
}

.planning-stage-item p,
.planning-summary-item p,
.planning-pending-card p,
.planning-upload-panel__head p {
  margin: 0;
  color: var(--planning-muted);
  line-height: 1.6;
}

.planning-stage-item.is-current {
  border-color: rgba(52, 120, 246, 0.18);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.9));
}

.planning-stage-item.is-complete span {
  background: rgba(16, 185, 129, 0.12);
  color: #0f8a63;
}

.planning-constraint-list,
.planning-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-constraint-list span {
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(23, 32, 51, 0.06);
  color: color-mix(in srgb, var(--planning-ink) 74%, white);
  font-size: 12px;
  font-weight: 800;
}

.planning-constraint-list--soft span {
  background: rgba(255, 255, 255, 0.92);
}

.planning-chat-card {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  padding: 22px;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.planning-conversation-layout:not(.planning-conversation-layout--entry) .planning-chat-card {
  min-height: 0;
  height: 100%;
  padding-bottom: 12px;
  align-self: stretch;
}

.planning-conversation-layout--entry .planning-chat-card {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px;
  align-self: stretch;
  overflow: hidden;
}

.planning-chat-card__head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.planning-chat-card__head--workbench {
  padding-bottom: 2px;
}

.planning-chat-card__hint {
  max-width: 220px;
  font-size: 12px;
  font-weight: 800;
  text-align: right;
}

.planning-chat-card__copy {
  display: grid;
  gap: 4px;
}

.planning-chat-card__intro {
  max-width: 680px;
  margin: 0;
  color: var(--planning-muted);
}

.planning-start-card {
  display: grid;
  gap: 14px;
  padding: 22px;
  border-radius: 24px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.05), rgba(255, 255, 255, 0.96));
  align-content: start;
}

.planning-start-card__copy {
  display: grid;
  gap: 8px;
}

.planning-start-card__role {
  font-size: 11px;
  font-weight: 700;
  color: var(--planning-blue-deep);
  letter-spacing: 0.04em;
}

.planning-start-card__copy strong {
  font-size: 22px;
  line-height: 1.3;
  color: var(--planning-ink);
}

.planning-start-card__copy p {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--planning-muted);
}

.planning-start-card__examples {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-content: flex-start;
  align-items: flex-start;
}

.planning-start-card__example {
  display: inline-flex;
  align-items: center;
  padding: 9px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(23, 32, 51, 0.06);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: color-mix(in srgb, var(--planning-ink) 72%, white);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.planning-start-card__example:hover {
  background: rgba(52, 120, 246, 0.06);
  border-color: rgba(52, 120, 246, 0.18);
  color: var(--planning-blue-deep);
}

.planning-chat-card__meta {
  display: grid;
  justify-items: end;
  gap: 10px;
}

.planning-chat-card__meta--compact {
  width: 100%;
  display: flex;
  justify-content: flex-end;
}

.planning-status-card {
  display: grid;
  gap: 14px;
  min-height: 0;
  align-content: start;
}

.planning-proposal-detail span {
  color: var(--planning-muted);
  font-size: 12px;
  font-weight: 900;
}

.planning-upload-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.planning-upload-panel__head div {
  display: grid;
  gap: 6px;
}

.planning-upload-panel__head h3 {
  margin: 0;
  font-size: 18px;
}

.planning-upload-panel__head p {
  max-width: 280px;
  font-size: 12px;
  font-weight: 700;
}

.planning-upload-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
  padding: 10px 2px 4px;
  border-radius: 0;
  background: transparent;
  border: 0;
}

.planning-upload-preview__copy {
  display: grid;
  gap: 2px;
}

.planning-upload-preview__copy strong {
  font-size: 13px;
  color: var(--planning-ink);
}

.planning-upload-preview__copy p {
  margin: 0;
  font-size: 12px;
  color: var(--planning-muted);
}

.planning-upload-preview__action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: rgba(255, 255, 255, 0.86);
  color: var(--planning-blue-deep);
  border-radius: 999px;
  padding: 8px 12px;
  font: inherit;
  font-size: 12px;
font-weight: 800;
  cursor: pointer;
}

.planning-chat-main {
  min-height: 360px;
  max-height: none;
  overflow: hidden;
  padding: 0;
}

.planning-chat-content {
  max-height: 62vh;
  max-height: min(62vh, calc(100dvh - 280px));
  padding: 4px 4px 12px;
  overflow-y: auto;
}

.planning-message-wrapper {
  max-width: 94%;
}

.planning-message-group.user .planning-message-wrapper {
  margin-left: auto;
}



.planning-input-section {
  grid-row: 3 / 5;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  position: static;
  padding: 0;
  background: transparent;
  border: 0;
}

.planning-input-section--started {
  grid-row: 2 / 5;
}

.planning-input-wrapper {
  margin-top: 16px;
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
}

.planning-composer__actions {
  gap: 8px;
}

.planning-attach-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.92);
  color: var(--planning-blue-deep);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.planning-attach-btn.active,
.planning-attach-btn:hover {
  border-color: rgba(52, 120, 246, 0.24);
  background: rgba(52, 120, 246, 0.08);
}

.planning-proposal {
  padding: 18px 20px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.05), rgba(255, 255, 255, 0.92));
  border: 1px solid rgba(52, 120, 246, 0.12);
  display: grid;
  gap: 12px;
}

.planning-proposal--pending {
  margin-top: 4px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.03), rgba(255, 255, 255, 0.94));
}

.planning-proposal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.planning-proposal__head strong {
  font-size: 16px;
  font-weight: 700;
  color: var(--planning-ink);
}

.planning-proposal__eyebrow {
  display: block;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.planning-proposal__lead {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--planning-ink);
}

.planning-proposal__problem-card {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 22px;
  border: 1px solid rgba(52, 120, 246, 0.14);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(241, 247, 255, 0.98));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.08);
}

.planning-proposal__problem-kicker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: var(--planning-blue-deep);
  font-size: 11px;
  font-weight: 800;
}

.planning-proposal__contract {
  display: grid;
  gap: 10px;
}

.planning-proposal.planning-proposal--pending {
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.12), rgba(255, 255, 255, 0.96));
  border: 1px solid rgba(52, 120, 246, 0.12);
}

.planning-proposal__list {
  display: grid;
  gap: 12px;
}

.planning-proposal__item {
  display: grid;
  gap: 4px;
}

.planning-proposal__item + .planning-proposal__item {
  padding-top: 12px;
  border-top: 1px solid rgba(23, 32, 51, 0.08);
}

.planning-proposal__item strong {
  color: var(--planning-blue-deep);
  font-size: 13px;
  font-weight: 800;
}

.planning-proposal__item p {
  margin: 0;
  color: var(--planning-ink);
  font-size: 15px;
  line-height: 1.65;
}

.planning-proposal__path-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.planning-proposal__path-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: var(--planning-blue-deep);
  font-size: 11px;
  font-weight: 900;
}

.planning-proposal__path-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--planning-ink);
  font-size: 15px;
  line-height: 1.65;
}

.planning-proposal__pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-proposal__pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(52, 120, 246, 0.14);
  color: var(--planning-blue-deep);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}

.planning-proposal__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 2px;
}

.planning-proposal--supplement {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.94));
  border-color: rgba(245, 158, 11, 0.18);
}

.planning-proposal--supplement .planning-proposal__eyebrow {
  color: #b45309;
}

.planning-proposal__supplement-input {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(245, 158, 11, 0.04);
  border: 1px solid rgba(245, 158, 11, 0.1);
}

.planning-proposal__supplement-field {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 14px;
  border: 1px solid rgba(245, 158, 11, 0.15);
  padding: 10px 14px;
}

.planning-proposal__supplement-field textarea {
  flex: 1;
  background: transparent;
  border: none;
  resize: none;
  font-size: 14px;
  line-height: 1.6;
  color: var(--planning-ink);
  outline: none;
  min-height: 1.6em;
  max-height: 80px;
}

.planning-proposal__supplement-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--planning-blue);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.2s;
}

.planning-proposal__supplement-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.planning-proposal__supplement-send .el-icon {
  font-size: 18px;
}

.planning-pending-card--compact {
  padding: 12px 14px;
}

.planning-pending-card--question {
  border-color: rgba(52, 120, 246, 0.16);
  background: rgba(52, 120, 246, 0.06);
}

.planning-alert-list {
  display: grid;
  gap: 10px;
}

.planning-risk-note--stacked {
  background: rgba(255, 247, 232, 0.9);
  border-color: rgba(245, 158, 11, 0.16);
}

.planning-risk-note--stacked p {
  color: var(--planning-ink);
}

.planning-upload-panel {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.planning-upload-summary {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(243, 246, 251, 0.82);
  color: var(--planning-ink);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.planning-upload-summary:hover {
  border-color: rgba(52, 120, 246, 0.18);
  background: rgba(247, 250, 255, 0.94);
}

.planning-upload-summary__copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.planning-upload-summary__copy strong {
  font-size: 14px;
  font-weight: 900;
  color: var(--planning-ink);
}

.planning-upload-summary__copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--planning-muted);
}

.planning-upload-summary__action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 800;
  color: var(--planning-blue-deep);
}

.planning-upload-panel--compact {
  padding: 14px 16px;
  border-radius: 20px;
  background: rgba(243, 246, 251, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-upload-collapse {
  border: 0;
  background: transparent;
  color: var(--planning-blue-deep);
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  padding: 0;
}

.planning-upload-panel__note {
  margin: 0;
  color: var(--planning-muted);
  font-size: 12px;
  line-height: 1.6;
}

.planning-upload-input {
  display: none;
}

.planning-upload-dropzone {
  width: 100%;
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 20px 18px;
  border-radius: 24px;
  border: 1.5px dashed rgba(52, 120, 246, 0.22);
  background: rgba(255, 255, 255, 0.8);
  color: var(--planning-ink);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.planning-upload-dropzone--compact {
  padding: 16px 18px;
  border-radius: 18px;
}

.planning-upload-dropzone:hover,
.planning-upload-dropzone.is-dragging {
  border-style: solid;
  border-color: rgba(52, 120, 246, 0.4);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.92));
  box-shadow: 0 18px 36px rgba(52, 120, 246, 0.08);
}

.planning-upload-dropzone.is-dragging {
  transform: translateY(-1px);
}

.planning-upload-dropzone__copy {
  display: grid;
  gap: 4px;
}

.planning-upload-dropzone__copy strong {
  font-size: 15px;
  font-weight: 900;
  color: var(--planning-ink);
}

.planning-upload-dropzone__copy span {
  margin: 0;
  color: var(--planning-muted);
}

.planning-upload-dropzone__copy span {
  font-size: 13px;
  font-weight: 800;
  color: var(--planning-blue-deep);
}

.planning-upload-list {
  display: grid;
  gap: 10px;
}

.planning-upload-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-upload-item__preview {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(52, 120, 246, 0.1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 22px;
}

.planning-upload-item__preview.is-image {
  background: rgba(23, 32, 51, 0.06);
}

.planning-upload-item__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.planning-upload-item__body {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.planning-upload-item__meta,
.planning-upload-item__status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.planning-upload-item__meta strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--planning-ink);
}

.planning-upload-item__meta span,
.planning-upload-error {
  font-size: 12px;
  color: var(--planning-muted);
}

.planning-upload-status {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}

.planning-upload-status--ready {
  background: rgba(52, 120, 246, 0.1);
  color: var(--planning-blue-deep);
}

.planning-upload-status--error {
  background: rgba(239, 68, 68, 0.12);
  color: #c23b3b;
}

.planning-upload-item__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}

.planning-upload-action {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.planning-upload-action--retry {
  color: var(--planning-blue-deep);
}

.planning-upload-action--remove {
  color: #c23b3b;
}

.planning-completion-card {
  border-color: rgba(52, 120, 246, 0.14);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.9));
}

.planning-completion-card h3 {
  margin: 0;
  color: var(--planning-ink);
}

@media (max-width: 820px) {
  .planning-conversation-layout {
    grid-template-columns: 1fr;
  }

  .planning-side-card {
    height: auto;
    max-height: none;
    overflow: visible;
    align-self: start;
  }

  .planning-main {
    min-height: auto;
    height: auto;
    overflow: visible;
  }

  .planning-chat-card {
    order: 1;
  }

  .planning-chat-card {
    min-height: auto;
    height: auto;
    overflow: visible;
  }

  .planning-messages {
    max-height: 420px;
  }
}

@media (max-width: 820px) {
  .planning-brand__logo {
    height: 42px;
  }

  .planning-main {
    width: min(100% - 28px, 1280px);
    padding-top: 18px;
    padding-bottom: calc(16px + var(--safe-area-bottom));
    min-height: auto;
    height: auto;
    overflow: visible;
  }

  .planning-topbar-card,
  .planning-chat-card__head,
  .planning-topbar-card__actions,
  .planning-chat-card__meta,
  .planning-upload-panel__head,
  .planning-block-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .planning-header__actions .session-badge,
  .planning-nav {
    display: none;
  }

  .planning-chat-card,
  .planning-side-card,
  .planning-topbar-card {
    padding: 18px;
    border-radius: 24px;
  }

  .planning-debug-metrics {
    grid-template-columns: 1fr;
  }

  .planning-conversation-layout--entry .planning-chat-card,
  .planning-conversation-layout:not(.planning-conversation-layout--entry) .planning-chat-card {
    padding: 20px;
    height: auto;
    overflow: visible;
  }

  .planning-chat-main,
  .planning-chat-content {
    min-height: 0;
    max-height: none;
  }

  .planning-upload-item {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .planning-upload-item__actions {
    grid-column: 1 / -1;
    flex-direction: row;
    justify-content: flex-end;
  }

  .planning-msg {
    max-width: 100%;
  }
}

/* ========== 响应式 ========== */
@media (max-width: 768px) {
  .header-container {
    padding: 1rem;
  }

  .header-nav {
    display: none;
  }

  .main-content {
    padding: 0 1rem;
  }

  .header-container {
    padding: 0.9rem 1rem;
    gap: 0.75rem;
  }

  .header-left,
  .header-right,
  .session-info {
    min-width: 0;
  }

  .planning-main {
    width: min(100% - 20px, 1280px);
  }

  .planning-topbar-card p,
  .planning-chat-card__intro,
  .planning-chat-card__hint {
    max-width: none;
  }

  .planning-chat-card__hint,
  .planning-chat-card__meta,
  .planning-chat-card__meta--compact {
    justify-items: start;
    text-align: left;
  }

  .planning-chat-card__meta--compact {
    justify-content: flex-start;
  }

  .planning-conversation-layout,
  .planning-conversation-layout--entry {
    gap: 16px;
  }

  .planning-side-card,
  .planning-chat-card,
  .planning-topbar-card,
  .planning-proposal,
  .planning-start-card {
    border-radius: 20px;
  }

  .planning-chat-card,
  .planning-conversation-layout--entry .planning-chat-card,
  .planning-conversation-layout:not(.planning-conversation-layout--entry) .planning-chat-card {
    padding: 16px;
  }

  .planning-proposal {
    padding: 16px;
  }

  .planning-proposal__head {
    align-items: flex-start;
  }

  .planning-chat-content {
    padding-inline: 0;
  }

  .planning-message-wrapper,
  .planning-msg {
    max-width: 100%;
  }

  .planning-composer__box {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 12px;
  }

  .planning-composer__field {
    align-items: flex-start;
  }

  .planning-composer__selected-tags {
    width: 100%;
  }

  .planning-debug-trace__summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .planning-debug-trace__meta {
    justify-items: start;
  }

  .planning-debug-trace__meta span {
    text-align: left;
  }

  .planning-composer__box textarea {
    width: 100%;
    min-width: 0;
  }

  .planning-composer__row {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 10px;
    width: 100%;
  }

  .planning-attach-btn,
  .planning-send-btn {
    width: 100%;
    min-height: 42px;
    border-radius: 14px;
  }

  .planning-attach-btn {
    height: auto;
    justify-content: center;
    padding: 0 14px;
  }

  .planning-send-btn {
    height: auto;
    justify-content: center;
    gap: 0.45rem;
    padding: 0 16px;
  }

  .planning-attach-btn span,
  .planning-send-btn span {
    display: inline;
  }

  .planning-upload-summary,
  .planning-upload-preview {
    align-items: flex-start;
    flex-direction: column;
  }

  .planning-upload-summary__action,
  .planning-upload-preview__action {
    white-space: normal;
  }

  .planning-upload-summary__copy span,
  .planning-upload-item__meta strong,
  .planning-upload-preview__copy p {
    white-space: normal;
    word-break: break-word;
    overflow: visible;
    text-overflow: clip;
  }

  .planning-upload-item {
    gap: 10px;
  }

  .planning-upload-item__actions {
    align-items: flex-start;
    justify-content: flex-start;
  }

  .planning-proposal__actions,
  .planning-topbar-card__actions,
  .planning-completion-card__actions {
    width: 100%;
  }

  .planning-proposal__actions > *,
  .planning-topbar-card__actions > *,
  .planning-completion-card__actions > * {
    flex: 1 1 100%;
  }

  .understanding-panel {
    margin: 1rem 0 0;
    padding: 1rem;
  }

  .panel-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .panel-header-actions {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
  }

  .confidence-wrapper {
    align-items: flex-start;
    width: 100%;
  }

  .confidence-bar {
    flex: 1;
  }

  .message-wrapper {
    max-width: 90%;
  }

  .input-section {
    padding: 0.75rem 0 1rem;
  }

  .planning-upload-item__meta,
  .planning-upload-item__status-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .completion-secondary-actions {
    gap: 0.5rem 1rem;
  }
}

@media (max-width: 520px) {
  .planning-topbar-card h1 {
    font-size: 1.8rem;
  }

  .planning-side-card__head h2,
  .planning-side-card h2,
  .planning-chat-card__head h2 {
    font-size: 1.25rem;
  }

  .planning-proposal,
  .planning-start-card,
  .planning-upload-panel--compact {
    padding: 14px;
  }

  .planning-upload-item__meta,
  .planning-upload-item__status-row,
  .planning-upload-item__actions {
    flex-direction: column;
    align-items: flex-start;
  }

  .planning-composer__row {
    grid-template-columns: 1fr;
  }
}
</style>
