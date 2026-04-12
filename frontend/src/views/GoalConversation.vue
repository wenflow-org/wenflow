<template>
  <div class="goal-conversation-page">
    <!-- 动态背景 -->
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
    </div>

    <!-- 顶部导航栏 -->
    <header class="dashboard-header" :class="{ 'header-scrolled': headerScrolled }">
      <div class="header-container">
        <div class="header-left">
          <div class="brand" @click="navigateToHome">
            <span class="brand-icon">🎓</span>
            <span class="brand-text">问流 WenFlow</span>
          </div>
          <div class="header-divider"></div>
          <div class="session-info">
            <span class="session-badge" :class="stageBadgeClass">{{ stageLabel }}</span>
            <span class="session-title">AI 规划</span>
          </div>
        </div>

        <nav class="header-nav">
          <router-link to="/dashboard" class="nav-item">
            <el-icon><HomeFilled /></el-icon>
            <span>学习台</span>
          </router-link>
          <router-link to="/goal-conversation" class="nav-item nav-item-active">
            <el-icon><EditPen /></el-icon>
            <span>AI 规划</span>
          </router-link>
          <router-link to="/learning-paths" class="nav-item">
            <el-icon><FolderOpened /></el-icon>
            <span>学习路径</span>
          </router-link>
        </nav>

        <div class="header-right">
          <ThemeSwitcher />
          
          <!-- 用户头像 -->
          <el-dropdown class="user-dropdown">
            <div class="user-avatar">
              <img v-if="userStore.user?.avatarUrl" :src="userStore.user.avatarUrl" alt="avatar" />
              <div v-else class="avatar-placeholder">
                {{ userStore.user?.name?.charAt(0) || 'U' }}
              </div>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="$router.push('/user')">
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

    <!-- 主内容区 -->
      <main class="main-content">
        <div class="content-container">
        <!-- 问题理解面板 -->
        <transition name="slide-down">
          <div class="understanding-panel glass-card" v-if="showUnderstandingPanel">
          <div class="panel-header">
            <div class="panel-title-wrapper">
              <div class="panel-icon">🎯</div>
              <div class="panel-title-content">
                <h3 class="panel-title">{{ panelTitle }}</h3>
                <p class="panel-subtitle">{{ panelSubtitle }}</p>
              </div>
            </div>
            <div class="panel-header-actions">
              <div class="confidence-wrapper">
                <div class="confidence-label">理解度</div>
                <div class="confidence-bar-wrapper">
                  <div class="confidence-bar">
                    <div class="confidence-fill" :style="{ width: (confidence * 100) + '%' }" :class="confidenceClass"></div>
                  </div>
                  <span class="confidence-value">{{ Math.round(confidence * 100) }}%</span>
                </div>
              </div>
              <button type="button" class="panel-toggle" @click="showUnderstandingExpanded = !showUnderstandingExpanded">
                {{ showUnderstandingExpanded ? '收起摘要' : '展开摘要' }}
              </button>
            </div>
          </div>

          <div class="panel-summary-row">
            <span class="summary-chip summary-chip-primary">{{ understandingHeadline }}</span>
            <span v-if="hasLevel" class="summary-chip">当前水平：{{ understanding.background?.current_level }}</span>
            <span v-if="understanding.background?.expected_time" class="summary-chip">期望见效：{{ understanding.background.expected_time }}</span>
          </div>

          <div class="panel-content" v-if="showUnderstandingExpanded">
            <div class="understanding-grid">
              <!-- 痛点 -->
              <div class="understanding-card glass-card" v-if="understanding.pain_points">
                <div class="card-icon">💢</div>
                <div class="card-content">
                  <span class="card-label">核心痛点</span>
                  <span class="card-value">{{ understanding.pain_points }}</span>
                </div>
              </div>
              
              <!-- 紧迫度 -->
              <div class="understanding-card glass-card" v-if="understanding.urgency">
                <div class="card-icon">🔥</div>
                <div class="card-content">
                  <span class="card-label">紧迫程度</span>
                  <span class="card-value">{{ urgencyLabel }}</span>
                </div>
              </div>

              <div class="understanding-card glass-card" v-if="hasMotivation">
                <div class="card-icon">💡</div>
                <div class="card-content">
                  <span class="card-label">学习动机</span>
                  <span class="card-value">{{ understanding.motivation }}</span>
                </div>
              </div>
            </div>
            
            <!-- 约束标签 -->
            <div class="understanding-tags" v-if="understanding.background?.constraints?.length">
              <span class="tag" v-for="c in understanding.background.constraints" :key="c">{{ c }}</span>
            </div>
          </div>
        </div>
      </transition>

      <!-- 聊天主区域 -->
      <div class="chat-main" ref="chatMain">
        <div class="chat-content" ref="chatContent">
          <!-- 消息列表 -->
          <div v-for="msg in sortedMessages" :key="msg.id" class="message-group" :class="msg.role">
            <div class="message-wrapper" :class="msg.role">
              <!-- AI 头像 -->
              <div v-if="msg.role === 'ai'" class="avatar ai-avatar">
                <div class="avatar-icon">🤖</div>
              </div>

              <div class="message-body">
                <div class="message-header" :class="{ 'user-header': msg.role === 'user' }">
                  <span class="sender-name">{{ msg.role === 'ai' ? 'AI 规划师' : '你' }}</span>
                  <span class="message-time">{{ formatTime(msg.time) }}</span>
                </div>
                <div class="message-bubble" :class="msg.role === 'ai' ? 'ai-bubble glass-card' : 'user-bubble'" v-html="msg.role === 'ai' ? formatMessage(msg.content) : msg.content"></div>
                
                <!-- 快速回复卡片 -->
                <div v-if="msg.role === 'ai' && msg.quickReplies && msg.quickReplies.length > 0 && !msg.quickRepliesUsed && currentStage !== 'proposing'" class="quick-replies">
                  <div
                    v-for="(reply, index) in msg.quickReplies"
                    :key="index"
                    class="quick-reply-card"
                    @click="sendQuickReply(reply.text, msg.id)"
                  >
                    <span class="reply-icon" v-if="reply.icon">{{ reply.icon }}</span>
                    <span class="reply-text">{{ reply.text }}</span>
                  </div>
                </div>
                
                <!-- 重试按钮 -->
                <div v-if="msg.role === 'ai' && isFailedMessage(msg.content)" class="retry-section">
                  <button class="retry-btn" @click="retryLastMessage" :disabled="loading">
                    <el-icon><RefreshRight /></el-icon>
                    <span>重试</span>
                  </button>
                </div>
              </div>

              <!-- 用户头像 -->
              <div v-if="msg.role === 'user'" class="avatar user-avatar">
                <div class="avatar-icon">👤</div>
              </div>
            </div>
          </div>

          <!-- 加载中 -->
          <div v-if="loading" class="message-group ai">
            <div class="message-wrapper ai">
              <div class="avatar ai-avatar">
                <div class="avatar-icon">🤖</div>
              </div>
              <div class="message-body">
                <div class="typing-indicator glass-card">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部输入区 -->
      <!-- 完成后的提示 -->
      <div class="input-section" v-if="isCompleted && generatedPathStatus !== 'generating'">
        <div class="completion-banner glass-card">
          <div class="completion-icon-wrapper">
            <span class="completion-icon">✨</span>
          </div>
          <h3 class="completion-title">问题理解完成！</h3>
          <p class="completion-subtitle">AI 已经理解你的学习目标，接下来可以查看推荐的学习路径</p>
          <div class="completion-summary" v-if="understanding.real_problem">
            <span class="summary-label">🎯 真正要解决的问题：</span>
            <span class="summary-value">{{ understanding.real_problem }}</span>
          </div>
          <div class="completion-actions">
            <button class="cta-btn" @click="navigateToLearningPath">
              <span>查看学习路径</span>
              <el-icon><ArrowRight /></el-icon>
            </button>
          </div>
          <div class="completion-secondary-actions">
            <button class="text-action-btn" @click="showRegenerateDialog = true">
              <el-icon><RefreshRight /></el-icon>
              <span>重新规划</span>
            </button>
            <button class="text-action-btn" @click="router.push('/dashboard')">
              <span>回到学习台</span>
            </button>
          </div>
          </div>
      </div>

      <div class="input-section" v-else>
        <div class="input-wrapper glass-card">
          <!-- 方向确认面板 -->
          <transition name="slide-up">
            <div v-if="showProposalActionPanel" class="proposal-action-panel">
              <div class="proposal-header">
                <span class="proposal-icon">🎯</span>
                <h3 class="proposal-title">请确认方向</h3>
              </div>
              <div class="proposal-content" v-if="understanding.real_problem">
                <span class="proposal-label">核心问题：</span>
                <span class="proposal-value">{{ understanding.real_problem }}</span>
              </div>
              <div class="proposal-suggestions" v-if="proposalSuggestions.length > 0">
                <span class="proposal-suggestion-label">阶段建议：</span>
                <ul class="proposal-suggestion-list">
                  <li v-for="(suggestion, idx) in proposalSuggestions" :key="idx">{{ suggestion }}</li>
                </ul>
              </div>
              <div class="proposal-actions">
                <button class="proposal-btn proposal-btn-primary" @click="handleConfirmProposal" :disabled="loading">
                  <el-icon v-if="loading"><Loading /></el-icon>
                  <span>确认并生成路径</span>
                </button>
                <button class="proposal-btn proposal-btn-secondary" @click="handleContinueSupplement">
                  <span>继续补充</span>
                </button>
              </div>
            </div>
          </transition>

          <!-- 快捷建议 -->
          <transition name="slide-up">
            <div v-if="showSuggestions" class="suggestions-section">
              <div class="suggestions-chips">
                <div
                  v-for="suggestion in visibleSuggestions"
                  :key="suggestion.text"
                  class="suggestion-chip"
                  :class="suggestion.type"
                  @click="setInput(suggestion.text)"
                >
                  <span class="chip-icon">{{ suggestion.icon }}</span>
                  <span class="chip-text">{{ suggestion.text }}</span>
                </div>
                <button
                  v-if="suggestions.length > 3"
                  type="button"
                  class="suggestions-more"
                  @click="showAllSuggestions = !showAllSuggestions"
                >
                  {{ showAllSuggestions ? '收起示例' : `更多示例 +${suggestions.length - 3}` }}
                </button>
              </div>
            </div>
          </transition>

          <!-- 输入框 -->
          <div class="input-row">
            <div class="input-container">
              <textarea
                ref="inputField"
                v-model="userInput"
                @keydown.enter.exact.prevent="sendMessage"
                @keydown.enter.shift.exact="inputNewLine"
                placeholder="告诉我你想学什么，或者想解决什么问题..."
                :disabled="loading"
                rows="1"
                @input="autoResize"
              ></textarea>
              <div class="input-actions">
                <button
                  @click="sendMessage"
                  :disabled="loading || !userInput.trim()"
                  class="send-btn"
                >
                  <el-icon v-if="loading"><Loading /></el-icon>
                  <el-icon v-else><Promotion /></el-icon>
                </button>
              </div>
            </div>
          </div>

          </div>
</div>
      </div>
      
      <!-- 重新规划对话框 -->
      <el-dialog
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import api from '../utils/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowRight, Loading, Promotion, RefreshRight, HomeFilled, EditPen, FolderOpened, User, Switch, Delete } from '@element-plus/icons-vue';
import { useUserStore } from '../stores/user';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true
});

const headerScrolled = ref(false);
const router = useRouter();
const userStore = useUserStore();

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });
    userStore.logout();
    ElMessage.success('已退出登录');
    router.push('/login');
  } catch {
    // 用户取消
  }
};

const chatContent = ref<HTMLElement | null>(null);
const inputField = ref<HTMLTextAreaElement | null>(null);
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
const confidence = ref(0);
const lastUserMessage = ref('');
const realProblemConfirmed = ref(false);

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
  quickReplies?: QuickReply[];
  quickRepliesUsed?: boolean;
}

const aiMessages = ref<Message[]>([]);
const userMessages = ref<Message[]>([]);

const sortedMessages = computed(() => {
  const allMessages = [...aiMessages.value, ...userMessages.value];
  return allMessages.sort((a, b) => {
    const timeA = a.time instanceof Date ? a.time.getTime() : new Date(a.time).getTime();
    const timeB = b.time instanceof Date ? b.time.getTime() : new Date(b.time).getTime();
    return timeA - timeB;
  });
});

const stages = {
  understanding: { label: '理解问题中', color: 'info' },
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
const confidenceClass = computed(() => {
  if (confidence.value >= 0.7) return 'high';
  if (confidence.value >= 0.4) return 'medium';
  return 'low';
});

const showSuggestions = computed(() => {
  return currentStage.value === 'understanding' && aiMessages.value.length <= 1 && !isCompleted.value;
});

const visibleSuggestions = computed(() => {
  return showAllSuggestions.value ? suggestions : suggestions.slice(0, 3);
});

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

// 面板标题和副标题
const panelTitle = computed(() => {
  if (currentStage.value === 'proposing') return '方案确认中';
  if (currentStage.value === 'ready') return '理解完成';
  return '问题理解中';
});

const panelSubtitle = computed(() => {
  if (currentStage.value === 'proposing') return '请确认学习方向是否正确';
  if (currentStage.value === 'ready') return '可以生成学习路径了';
  return 'AI 正在分析你的学习目标';
});

// 过滤后的有效数据
const hasRealProblem = computed(() => isValidValue(understanding.value.real_problem));
const hasMotivation = computed(() => isValidValue(understanding.value.motivation));
const hasLevel = computed(() => isValidValue(understanding.value.background?.current_level));

const urgencyLabel = computed(() => {
  const urgency = understanding.value.urgency;
  if (urgency === '高') return '🔥 紧急';
  if (urgency === '中') return '⏳ 适中';
  if (urgency === '低') return '📅 不急';
  return urgency;
});

const understandingHeadline = computed(() => {
  if (hasRealProblem.value) return `真正问题：${understanding.value.real_problem}`;
  if (understanding.value.surface_goal) return `当前目标：${understanding.value.surface_goal}`;
  return 'AI 正在整理你的学习目标';
});

const showProposalHint = computed(() => {
  return currentStage.value === 'proposing';
});

const showProposalActionPanel = computed(() => {
  return currentStage.value === 'proposing' && !isCompleted.value;
});

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

const handleConfirmProposal = async () => {
  await confirmProposal('确认，生成路径');
};

const handleContinueSupplement = () => {
  nextTick(() => {
    inputField.value?.focus();
    autoResize();
  });
};

const inputHint = computed(() => {
  if (currentStage.value === 'proposing') return '确认方案方向，或提出调整建议';
  if (!understanding.value.surface_goal) return '描述你想学什么，或想解决什么问题';
  if (!understanding.value.real_problem) return 'AI 正在理解你的真实需求...';
  return '分享更多细节，帮助 AI 更好地规划';
});

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
    if (generatedPathStatus.value === 'generating') {
      router.push('/learning-paths');
    } else if (generatedPathId.value) {
      router.push(`/learning-path/${generatedPathId.value}`);
    } else {
      router.push('/learning-paths');
    }
  };

  // 重新生成学习路径
  const regeneratePath = async () => {
    if (!conversationId.value || regenerating.value) return;

    regenerating.value = true;
    try {
      const response: any = await api.post(
        `/goal-conversation/${conversationId.value}/regenerate`,
        { adjustments: regenerateAdjustments.value || undefined }
      );

      if (response.success) {
        const internal = response.internal || response.data;
        if (internal.learningPath) {
          generatedPathId.value = internal.learningPath.id;
          generatedPathStatus.value = internal.learningPath.status || null;
        }
        ElMessage.success(response.userVisible || '学习路径已重新生成！');
        showRegenerateDialog.value = false;
        regenerateAdjustments.value = '';
      }
    } catch (error: any) {
      console.error('重新生成路径失败:', error);
      ElMessage.error(error.message || '重新生成失败，请重试');
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
        await api.delete(`/goal-conversation/${conversationId.value}`);
      }

      // 重置所有状态
      understanding.value = {};
      showUnderstandingExpanded.value = false;
      showAllSuggestions.value = false;
      realProblemConfirmed.value = false;
      confidence.value = 0;
      currentStage.value = 'understanding';
      conversationId.value = '';
      conversationComplete.value = false;
      generatedPathId.value = null;
      generatedPathStatus.value = null;
      aiMessages.value = [{
        id: 'welcome',
        role: 'ai',
        content: '好的，让我们重新开始！👋\n\n**告诉我你想学什么，我来帮你找到真正要解决的问题。**',
        time: new Date()
      }];
      userMessages.value = [];
      showRegenerateDialog.value = false;

      ElMessage.success('已重置，请重新描述你的学习目标');
    } catch {
      // 用户取消
    }
  };

// 导航到首页
const navigateToHome = () => {
  const token = localStorage.getItem('token');
  if (token) {
    router.push('/dashboard');
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
    ElMessage.success('已确认，继续描述你的需求');
  };

  const resetConversation = async () => {
    try {
      await ElMessageBox.confirm('确定要重新开始吗？当前对话将被清空。', '重新开始', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      });
      
      understanding.value = {};
      showUnderstandingExpanded.value = false;
      showAllSuggestions.value = false;
      realProblemConfirmed.value = false;
      confidence.value = 0;
      currentStage.value = 'understanding';
      conversationId.value = '';
      conversationComplete.value = false;
      generatedPathId.value = null;
      generatedPathStatus.value = null;
      aiMessages.value = [{
        id: 'welcome',
        role: 'ai',
        content: '好的，让我们重新开始！👋\n\n**告诉我你想学什么，我来帮你找到真正要解决的问题。**',
        time: new Date()
      }];
      userMessages.value = [];
      
      ElMessage.info('已清空，请重新描述你的学习目标');
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

const startConversation = async (goal: string) => {
  loading.value = true;
  try {
    const response: any = await api.post('/goal-conversation/start', { goal });
    
    if (response.success) {
      const internal = response.internal || response.data;
      const userVisible = response.userVisible || internal.message;

      conversationId.value = internal.conversationId || internal.sessionId;
      currentStage.value = internal.stage || 'understanding';
      confidence.value = internal.confidence || 0;
      
      if (internal.understanding) {
        understanding.value = { ...internal.understanding };
      }

      aiMessages.value.push({
        id: Date.now().toString(),
        role: 'ai',
        content: userVisible,
        time: new Date(),
        quickReplies: internal.quickReplies,
        quickRepliesUsed: false
      });
      scrollToBottom();
    }
  } catch (error: any) {
    console.error('开始对话失败:', error);
    ElMessage.error(error.message || '开始对话失败，请稍后重试');
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
  if (!userInput.value.trim() || loading.value) return;
  const content = userInput.value.trim();
  
  // 隐藏快速回复按钮
  hideLastAiQuickReplies();
  
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

// 发送快速回复
const sendQuickReply = async (text: string, messageId?: string) => {
  if (loading.value) return;
  
  // 隐藏快速回复按钮
  if (messageId) {
    const msgIndex = aiMessages.value.findIndex(m => m.id === messageId);
    if (msgIndex !== -1) {
      aiMessages.value[msgIndex].quickRepliesUsed = true;
    }
  } else {
    hideLastAiQuickReplies();
  }
  
  // 检测是否为确认消息，触发路径生成
  if (text.includes('确认') && text.includes('生成')) {
    await confirmProposal(text);
    return;
  }

  const isAdjustDirectionIntent = /调整|修改|换个方向/.test(text);
  const payload = isAdjustDirectionIntent
    ? '我想调整学习方向。请先给我 3 个可调整维度（学习重点、学习节奏、实践方式），并给出可点击的快捷选项。'
    : text;
  
  userInput.value = '';
  lastUserMessage.value = text;
  userMessages.value.push({
    id: Date.now().toString(),
    role: 'user',
    content: text,
    time: new Date()
  });
  scrollToBottom();
  
  if (!conversationId.value) {
    await startConversation(payload);
    return;
  }
  await sendMessageInternal(payload);
};

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
    const response: any = await api.post(`/goal-conversation/${conversationId.value}/reply`, { reply: confirmText });

    if (response.success) {
      const internal = response.internal || response.data;
      currentStage.value = internal.stage;
      confidence.value = internal.confidence || confidence.value;
      isCompleted.value = internal.isCompleted;

      if (internal.understanding) {
        understanding.value = { ...understanding.value, ...internal.understanding };
      }

      aiMessages.value.push({
        id: Date.now().toString(),
        role: 'ai',
        content: internal.message || '已确认方案，正在生成学习路径...',
        time: new Date(),
        quickReplies: internal.quickReplies,
        quickRepliesUsed: false
      });

      if (internal.learningPath) {
        generatedPathId.value = internal.learningPath.id;
        generatedPathStatus.value = internal.learningPath.status || null;
      }

      scrollToBottom();

      // 确认按钮点击后必定跳转学习路径页（强兜底，不依赖 stage/learningPath）
      router.push('/learning-paths?from=goal&auto=1');
    }
  } catch (error: any) {
    console.error('确认方案失败:', error);
    ElMessage.error(error.message || '确认失败，请重试');
  } finally {
    loading.value = false;
  }
};

const sendMessageInternal = async (content: string) => {
  loading.value = true;
  try {
    const response: any = await api.post(`/goal-conversation/${conversationId.value}/reply`, { reply: content });
    
    if (response.success) {
      const internal = response.internal || response.data;
      const userVisible = response.userVisible || internal.message;
      
      currentStage.value = internal.stage;
      confidence.value = internal.confidence || confidence.value;
      isCompleted.value = internal.isCompleted;
      
      if (internal.understanding) {
        understanding.value = { ...understanding.value, ...internal.understanding };
      }
      aiMessages.value.push({
        id: Date.now().toString(),
        role: 'ai',
        content: userVisible,
        time: new Date(),
        quickReplies: internal.quickReplies,
        quickRepliesUsed: false
      });
      if (internal.isCompleted) {
        ElMessage.success('问题理解完成！');
        conversationComplete.value = true;
        if (internal.learningPath) {
          generatedPathId.value = internal.learningPath.id;
          generatedPathStatus.value = internal.learningPath.status || null;
        }
      }
      
      scrollToBottom();
    }
  } catch (error: any) {
    console.error('回复失败:', error);
    ElMessage.error(error.message || '回复失败，请稍后重试');
  } finally {
    loading.value = false;
  }
};

const handleScroll = () => {
  headerScrolled.value = window.scrollY > 50;
};

onMounted(() => {
  aiMessages.value.push({
    id: 'welcome',
    role: 'ai',
    content: '你好！👋 我是你的规划师小智。\n\n**告诉我你想学什么，我来帮你找到真正要解决的问题。**',
    time: new Date()
  });
  
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.goal-conversation-page {
  min-height: 100vh;
  background: var(--bg-body);
  position: relative;
  overflow-x: hidden;
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

.header-scrolled {
  background: rgba(255, 255, 255, 0.95);
  border-bottom-color: var(--border-default);
  box-shadow: var(--shadow-sm);
}

[data-theme="dark"] .dashboard-header {
  background: rgba(26, 37, 47, 0.85);
}

[data-theme="dark"] .header-scrolled {
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
.chat-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.chat-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.message-group {
  display: flex;
  animation: fadeIn 0.3s ease;
}

.message-group.ai {
  justify-content: flex-start;
}

.message-group.user {
  justify-content: flex-end;
}

.message-wrapper {
  display: flex;
  gap: 0.75rem;
  max-width: 80%;
}

.message-wrapper.ai {
  flex-direction: row;
}

.message-wrapper.user {
  flex-direction: row;
}

.avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

.ai-avatar {
  background: var(--gradient-primary);
}

.user-avatar {
  background: var(--gradient-warning);
}

[data-theme="dark"] .confidence-bar {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
}

.avatar-icon {
  font-size: 1.25rem;
}

.message-body {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex: 1;
}

.message-header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 0.5rem;
}

.user-header {
  justify-content: flex-end;
}

.sender-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.message-time {
  font-size: 0.6875rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.message-header.user-header .sender-name {
  order: 2;
}

.message-header.user-header .message-time {
  order: 1;
}

.message-bubble {
  padding: 1rem 1.25rem;
  border-radius: var(--radius-xl);
  line-height: 1.6;
  font-size: 0.9375rem;
  word-wrap: break-word;
}

.ai-bubble {
  color: var(--text-primary);
  border-bottom-left-radius: 0.25rem;
}

.ai-bubble :deep(p) {
  margin: 0 0 0.75rem;
}

.ai-bubble :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-bubble :deep(ul),
.ai-bubble :deep(ol) {
  margin: 0.5rem 0 0.75rem;
  padding-left: 1.25rem;
}

.ai-bubble :deep(ul:last-child),
.ai-bubble :deep(ol:last-child) {
  margin-bottom: 0;
}

.ai-bubble :deep(li) {
  margin: 0.25rem 0;
  padding-left: 0.125rem;
}

.ai-bubble :deep(li::marker) {
  color: var(--text-secondary);
}

.ai-bubble :deep(strong) {
  font-weight: 700;
}

.ai-bubble :deep(code) {
  padding: 0.125rem 0.375rem;
  border-radius: 0.375rem;
  background: rgba(102, 126, 234, 0.12);
  color: var(--color-primary-dark);
  font-size: 0.875em;
}

.ai-bubble :deep(pre) {
  margin: 0.75rem 0;
  padding: 0.875rem 1rem;
  border-radius: var(--radius-lg);
  background: rgba(15, 23, 42, 0.92);
  overflow-x: auto;
}

.ai-bubble :deep(pre code) {
  padding: 0;
  background: transparent;
  color: #e2e8f0;
  font-size: 0.875rem;
}

.ai-bubble :deep(blockquote) {
  margin: 0.75rem 0;
  padding-left: 0.875rem;
  border-left: 3px solid rgba(102, 126, 234, 0.35);
  color: var(--text-secondary);
}

.user-bubble {
  background: var(--gradient-primary);
  color: white;
  border-bottom-right-radius: 0.25rem;
}

.retry-section {
  margin-top: 0.5rem;
}

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.875rem;
  background: var(--color-danger-light);
  color: var(--color-danger);
  border: none;
  border-radius: var(--radius-lg);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: var(--color-danger);
  color: white;
}

.retry-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 快速回复卡片 */
.quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0 0.25rem;
}

.quick-reply-card {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  background: var(--bg-muted);
  border: 1.5px solid var(--border-light);
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  max-width: 100%;
}

.quick-reply-card:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);
}

.quick-reply-card:active {
  transform: translateY(0);
}

.reply-icon {
  font-size: 1rem;
}

.reply-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
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
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-lg);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.proposal-btn-primary {
  background: var(--gradient-success);
  color: white;
  border: none;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.proposal-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
}

.proposal-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.proposal-btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1.5px solid var(--border-default);
}

.proposal-btn-secondary:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
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

textarea {
  flex: 1;
  display: block;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--text-primary);
  background: transparent;
  min-height: 1.6em;
  max-height: 120px;
  padding: 0.2rem 0;
}

textarea::placeholder {
  color: var(--text-muted);
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
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
  max-height: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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

  .completion-secondary-actions {
    gap: 0.5rem 1rem;
  }
}
</style>
