<template>
  <div class="arena-detail">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h2 class="page-title">{{ session?.name || '演练详情' }}</h2>
        <el-tag :type="getStatusType(session?.status)" size="small">
          {{ getStatusText(session?.status) }}
        </el-tag>
      </div>
      <div class="header-actions">
        <el-button type="danger" plain @click="deleteSession">
          <el-icon><Delete /></el-icon>
          删除
        </el-button>
      </div>
    </div>

    <!-- 整体评分 -->
    <el-card v-if="session?.evaluation" class="score-card" shadow="hover">
      <div class="score-overview">
        <div class="main-score">
          <el-progress
            type="dashboard"
            :percentage="session.evaluation.overallScore"
            :color="getScoreColor"
            :width="120"
            :stroke-width="10"
          />
          <span class="score-label">综合评分</span>
        </div>
        <div class="dimension-scores">
          <div class="dim-item">
            <span class="dim-name">画像合理性</span>
            <el-progress :percentage="session.evaluation.personaScore" :color="getScoreColor" />
          </div>
          <div class="dim-item">
            <span class="dim-name">对话自然度</span>
            <el-progress :percentage="session.evaluation.dialogueScore" :color="getScoreColor" />
          </div>
          <div class="dim-item">
            <span class="dim-name">信息完整度</span>
            <el-progress :percentage="session.evaluation.extractionScore" :color="getScoreColor" />
          </div>
          <div class="dim-item">
            <span class="dim-name">方案合理性</span>
            <el-progress :percentage="session.evaluation.proposalScore" :color="getScoreColor" />
          </div>
          <div class="dim-item">
            <span class="dim-name">路径可行性</span>
            <el-progress :percentage="session.evaluation.pathScore" :color="getScoreColor" />
          </div>
        </div>
      </div>
    </el-card>

    <!-- Agent执行流程 -->
    <el-card class="agents-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="card-title">🤖 Agent执行流程</span>
          <div class="header-actions">
            <el-radio-group v-model="executionMode" size="small">
              <el-radio-button label="manual">手动模式</el-radio-button>
              <el-radio-button label="auto">一键运行</el-radio-button>
            </el-radio-group>
            <el-button
              v-if="executionMode === 'auto' && canRunAll"
              type="primary"
              size="small"
              :loading="runningAll"
              @click="runAllAgents"
            >
              <el-icon><VideoPlay /></el-icon>
              一键运行
            </el-button>
            <el-button text @click="showAgentLogs = !showAgentLogs">
              {{ showAgentLogs ? '隐藏日志' : '查看日志' }}
            </el-button>
          </div>
        </div>
      </template>

      <div class="agent-flow">
        <div
          v-for="(agent, index) in agentFlow"
          :key="agent.type"
          class="agent-step"
          :class="{ active: agent.hasData, current: index === currentAgentIndex }"
        >
          <div class="agent-icon">{{ agent.icon }}</div>
          <div class="agent-info">
            <span class="agent-name">{{ agent.name }}</span>
            <span class="agent-status" :class="agent.status">{{ agent.statusText }}</span>
          </div>
          <!-- 手动执行按钮（仅在手动模式下显示） -->
          <el-button
            v-if="executionMode === 'manual' && !agent.hasData && canRunAgent(agent.type)"
            size="small"
            type="primary"
            :loading="runningAgent === agent.type"
            @click="runAgentManually(agent.type)"
          >
            执行
          </el-button>
          <!-- 自动模式下的等待提示 -->
          <el-tag
            v-else-if="executionMode === 'auto' && !agent.hasData && canRunAgent(agent.type)"
            size="small"
            type="info"
          >
            等待中
          </el-tag>
          <template v-else-if="agent.hasData">
            <el-button
              size="small"
              text
              @click="toggleAgentDetail(agent.type)"
            >
              {{ showAgentDetail === agent.type ? '收起' : '详情' }}
            </el-button>
            <el-button
              size="small"
              type="warning"
              plain
              :loading="runningAgent === agent.type"
              @click="runAgentManually(agent.type)"
            >
              <el-icon><RefreshRight /></el-icon>
              重试
            </el-button>
          </template>
          <div v-if="index < agentFlow.length - 1" class="agent-arrow">→</div>
        </div>
      </div>

      <!-- Agent 输入输出详情 -->
      <div v-if="showAgentDetail" class="agent-detail-panel">
        <el-card shadow="hover">
          <template #header>
            <div class="detail-header">
              <span>{{ getAgentName(showAgentDetail) }} - 输入输出详情</span>
              <el-button text @click="showAgentDetail = null">关闭</el-button>
            </div>
          </template>
          <div class="detail-content">
            <!-- 输入 -->
            <div class="input-section">
              <h4>📥 输入</h4>
              <pre v-if="agentInput">{{ JSON.stringify(agentInput, null, 2) }}</pre>
              <el-empty v-else description="无输入数据" />
            </div>
            <!-- 输出 -->
            <div class="output-section">
              <h4>📤 输出</h4>
              <pre v-if="agentOutput">{{ JSON.stringify(agentOutput, null, 2) }}</pre>
              <el-empty v-else description="无输出数据" />
            </div>
          </div>
        </el-card>
      </div>

      <!-- Agent日志 -->
      <div v-if="showAgentLogs" class="agent-logs">
        <el-timeline>
          <el-timeline-item
            v-for="log in session?.agentLogs"
            :key="log.id"
            :type="log.status === 'success' ? 'success' : 'danger'"
            :timestamp="formatTime(log.createdAt)"
          >
            <div class="log-item">
              <span class="log-agent">{{ log.agentName }}</span>
              <span class="log-duration">{{ log.durationMs }}ms</span>
              <span class="log-tokens">{{ log.totalTokens }} tokens</span>
            </div>
          </el-timeline-item>
        </el-timeline>
      </div>
    </el-card>

    <!-- 详情标签页 -->
    <el-tabs v-model="activeTab" class="detail-tabs">
      <!-- 用户画像 -->
      <el-tab-pane label="👤 用户画像" name="persona">
        <el-card v-if="session?.persona" shadow="hover">
          <div class="persona-detail">
            <!-- 基本信息 -->
            <div class="detail-section">
              <h4>基本信息</h4>
              <div class="detail-row">
                <span class="label">表面目标：</span>
                <span class="value">{{ personaData?.surfaceGoal || '-' }}</span>
              </div>
              <div class="detail-row highlight">
                <span class="label">真问题：</span>
                <span class="value">{{ personaData?.realProblem || '-' }}</span>
              </div>
              <div class="detail-row">
                <span class="label">当前水平：</span>
                <span class="value">{{ personaData?.level || '-' }}</span>
              </div>
              <div class="detail-row">
                <span class="label">可用时间：</span>
                <span class="value">{{ personaData?.timePerDay || '-' }}</span>
              </div>
              <div class="detail-row">
                <span class="label">学习阶段：</span>
                <span class="value">{{ personaData?.stages || personaData?.totalWeeks || '-' }}</span>
              </div>
            </div>

            <!-- 场景信息 -->
            <div class="detail-section" v-if="personaData?.scenario?.who || personaData?.scenario?.why">
              <h4>场景信息</h4>
              <div class="detail-row" v-if="personaData?.scenario?.who">
                <span class="label">学习者身份：</span>
                <span class="value">{{ personaData.scenario.who || '本人' }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.scenario?.why">
                <span class="label">真实目的：</span>
                <span class="value">{{ personaData.scenario.why || personaData?.motivation || '-' }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.scenario?.context">
                <span class="label">触发场景：</span>
                <span class="value">{{ personaData.scenario.context }}</span>
              </div>
            </div>

            <!-- 心理状态 -->
            <div class="detail-section" v-if="personaData?.psychology?.learningState || personaData?.psychology?.contradictions?.length">
              <h4>心理状态 <el-tag size="small" type="warning">关键</el-tag></h4>
              <div class="detail-row" v-if="personaData?.psychology?.learningState">
                <span class="label">学习状态：</span>
                <span class="value">
                  <el-tag :type="getLearningStateType(personaData.psychology.learningState)">
                    {{ personaData.psychology.learningState }}
                  </el-tag>
                </span>
              </div>
              <div class="detail-row" v-if="personaData?.psychology?.contradictions?.length">
                <span class="label">矛盾心理：</span>
                <span class="value">
                  <el-tag v-for="(item, idx) in personaData.psychology.contradictions" :key="idx" size="small" type="danger" class="multi-tag">
                    {{ item }}
                  </el-tag>
                </span>
              </div>
              <div class="detail-row" v-if="personaData?.psychology?.fears?.length">
                <span class="label">内心恐惧：</span>
                <span class="value">
                  <el-tag v-for="(item, idx) in personaData.psychology.fears" :key="idx" size="small" type="warning" class="multi-tag">
                    {{ item }}
                  </el-tag>
                </span>
              </div>
              <div class="detail-row" v-if="personaData?.psychology?.biases?.length">
                <span class="label">认知偏差：</span>
                <span class="value">
                  <el-tag v-for="(item, idx) in personaData.psychology.biases" :key="idx" size="small" type="info" class="multi-tag">
                    {{ item }}
                  </el-tag>
                </span>
              </div>
            </div>

            <!-- 外部环境 -->
            <div class="detail-section" v-if="personaData?.external?.timeConstraints?.length || personaData?.external?.economicPressure">
              <h4>外部约束</h4>
              <div class="detail-row" v-if="personaData?.external?.timeConstraints?.length">
                <span class="label">时间限制：</span>
                <span class="value">{{ personaData.external.timeConstraints.join('、') }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.external?.economicPressure">
                <span class="label">经济压力：</span>
                <span class="value">{{ personaData.external.economicPressure }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.external?.socialPressure">
                <span class="label">社会压力：</span>
                <span class="value">{{ personaData.external.socialPressure }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.external?.environment">
                <span class="label">学习环境：</span>
                <span class="value">{{ personaData.external.environment }}</span>
              </div>
            </div>

            <!-- 过往经历 -->
            <div class="detail-section" v-if="personaData?.background?.priorKnowledge?.length || personaData?.background?.learningHistory">
              <h4>过往经历</h4>
              <div class="detail-row" v-if="personaData?.background?.priorKnowledge?.length">
                <span class="label">已有基础：</span>
                <span class="value">{{ personaData.background.priorKnowledge.join('、') }}</span>
              </div>
              <div class="detail-row highlight" v-if="personaData?.background?.learningHistory">
                <span class="label">学习历史：</span>
                <span class="value">{{ personaData.background.learningHistory }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.background?.challenges?.length">
                <span class="label">面临挑战：</span>
                <span class="value">{{ personaData.background.challenges.join('、') }}</span>
              </div>
            </div>

            <!-- 性格偏好 -->
            <div class="detail-section" v-if="personaData?.personality?.type || personaData?.personality?.preference">
              <h4>性格偏好</h4>
              <div class="detail-row" v-if="personaData?.personality?.type">
                <span class="label">性格类型：</span>
                <span class="value">{{ personaData.personality.type || '-' }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.personality?.preference">
                <span class="label">学习偏好：</span>
                <span class="value">{{ personaData.personality.preference || '-' }}</span>
              </div>
              <div class="detail-row" v-if="personaData?.personality?.communicationStyle">
                <span class="label">沟通风格：</span>
                <span class="value">{{ personaData.personality.communicationStyle }}</span>
              </div>
            </div>

            <el-collapse class="raw-collapse">
              <el-collapse-item title="查看完整画像 JSON" name="raw">
                <pre>{{ JSON.stringify(personaData?.raw || session.persona?.content, null, 2) }}</pre>
              </el-collapse-item>
            </el-collapse>
          </div>
        </el-card>
        <el-empty v-else description="暂无画像数据" />
      </el-tab-pane>

      <!-- 对话记录 -->
      <el-tab-pane label="💬 Agent演练对话" name="dialogue">
<!-- 说明文字 -->
        <div class="dialogue-info-box">
          <div class="dialogue-info-title">🤖 Agent演练：目标对话流程模拟</div>
          <div class="dialogue-info-content">
            这是 <strong>UserAgent</strong>（扮演用户）与 <strong>GoalConversationAgent</strong>（学习规划顾问）之间的AI对话演练，<br>
            用于模拟正式平台中的"路径规划"流程（目标对话），测试"引导发现"式教学的有效性。
          </div>
        </div>
        </div>
        <el-card v-if="parsedMessages.length > 0" shadow="hover">
          <template #header>
            <div class="dialogue-header">
              <div>
                <div style="font-size: 16px; font-weight: bold; color: #1976d2;">💬 Agent演练对话</div>
                <div style="font-size: 12px; color: #666; margin-top: 2px;">UserAgent ↔ GoalConversationAgent</div>
              </div>
              <el-tooltip content="两个AI Agent之间的对话演练">
                <el-icon><InfoFilled /></el-icon>
              </el-tooltip>
            </div>
          </template>
          <div class="dialogue-stats">
            <el-statistic title="总轮次" :value="maxRound" />
            <el-statistic title="UserAgent" :value="session.dialogue.userMessageCount" suffix="条">
              <template #prefix>👤</template>
            </el-statistic>
            <el-statistic title="GoalConversationAgent" :value="session.dialogue.aiMessageCount" suffix="条">
              <template #prefix>💬</template>
            </el-statistic>
          </div>
          <div ref="dialogueListRef" class="dialogue-list">
            <!-- 对话说明 -->
            <div v-if="parsedMessages.length > 0" class="dialogue-explanation">
              <strong>对话说明：</strong>
              <span class="dialogue-explanation-text">👤 UserAgent（扮演用户）回复 💬 GoalConversationAgent（学习规划顾问）的引导</span>
            </div>
            <div
              v-for="(msg, index) in parsedMessages"
              :key="index"
              ref="messageRefs"
              class="dialogue-message"
              :class="[msg.role, { 'editing': editingMessageIndex === index }]"
            >
              <div class="message-header">
                <div class="message-meta">
                  <el-tag 
                    :type="msg.role === 'user' ? 'primary' : 'success'" 
                    size="small" 
                    effect="dark"
                    style="font-weight: bold;"
                  >
                    {{ msg.role === 'user' ? '👤 UserAgent' : '💬 GoalConversationAgent' }}
                  </el-tag>
                  <span v-if="msg.round" class="round-badge">第{{ msg.round }}轮</span>
                  <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
                </div>
                <div class="message-actions">
                  <el-button
                    v-if="editingMessageIndex !== index"
                    text
                    size="small"
                    @click="startEditMessage(index, msg)"
                  >
                    <el-icon><Edit /></el-icon>
                  </el-button>
                  <template v-else>
                    <el-button text size="small" type="primary" @click="saveEditMessage(index)">
                      保存
                    </el-button>
                    <el-button text size="small" @click="cancelEditMessage">
                      取消
                    </el-button>
                  </template>
                </div>
              </div>
              <div v-if="editingMessageIndex !== index" class="message-content">
                {{ msg.content }}
              </div>
              <div v-else class="message-edit">
                <el-input
                  v-model="editingMessageContent"
                  type="textarea"
                  :rows="3"
                  resize="none"
                />
              </div>
            </div>
          </div>
          <div class="dialogue-actions">
            <el-button type="primary" @click="regenerateFromRound(selectedRound)">
              <el-icon><RefreshRight /></el-icon>
              从第{{ selectedRound || '?' }}轮重新生成
            </el-button>
            <el-button type="danger" @click="stopDialogue" :disabled="runningAgent !== 'dialogue'">
              <el-icon><VideoPause /></el-icon>
              停止对话
            </el-button>
            <el-input-number v-model="selectedRound" :min="1" :max="maxRound" size="small" style="width: 100px" />
          </div>
        </el-card>
        <el-empty description="暂无Agent演练数据，请先运行对话Agent" />
      </el-tab-pane>

      <!-- 需求提取 -->
      <el-tab-pane label="📋 需求提取" name="extraction">
        <el-card v-if="session?.extraction" shadow="hover">
          <div class="extraction-header">
            <span class="completeness-label">信息完整度</span>
            <el-progress
              :percentage="session.extraction.completenessScore || 0"
              :color="getScoreColor"
              style="width: 200px"
            />
            <span class="completeness-value">{{ session.extraction.completenessScore || 0 }}%</span>
          </div>
          <div v-if="session.extraction.missingFields?.length > 0" class="missing-fields">
            <el-alert
              :title="`缺失字段：${session.extraction.missingFields.join('、')}`"
              type="warning"
              :closable="false"
            />
          </div>
          <div class="extraction-detail">
            <div class="detail-row">
              <span class="label">表面目标：</span>
              <span class="value">{{ session.extraction.surfaceGoal || session.extraction.content?.surfaceGoal || '-' }}</span>
            </div>
            <div class="detail-row highlight">
              <span class="label">真问题：</span>
              <span class="value">{{ session.extraction.realProblem || session.extraction.content?.realProblem || '-' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">当前水平：</span>
              <span class="value">{{ session.extraction.level || session.extraction.content?.level || '-' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">可用时间：</span>
              <span class="value">{{ session.extraction.timePerDay || session.extraction.content?.timePerDay || '-' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">学习阶段：</span>
              <span class="value">{{ session.extraction.stages || session.extraction.content?.stages || session.extraction.totalWeeks || session.extraction.content?.totalWeeks || '-' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">学习动机：</span>
              <span class="value">{{ session.extraction.motivation || session.extraction.content?.motivation || '-' }}</span>
            </div>
          </div>
          <el-collapse class="raw-collapse">
            <el-collapse-item title="查看提取详情 JSON" name="raw">
              <pre>{{ JSON.stringify(session.extraction.content || session.extraction, null, 2) }}</pre>
            </el-collapse-item>
          </el-collapse>
        </el-card>
        <el-empty v-else description="暂无提取数据" />
      </el-tab-pane>

      <!-- 路径生成 -->
      <el-tab-pane label="🎯 路径生成" name="generation">
        <el-card v-if="session?.generation" shadow="hover">
          <div class="generation-stats">
            <el-statistic title="总阶段数" :value="session.generation.proposalContent?.totalStages || session.generation.totalWeeks || 0" />
            <el-statistic title="总任务数" :value="session.generation.totalTasks" />
          </div>
          <el-collapse>
            <el-collapse-item title="方案轮廓" name="proposal">
              <pre>{{ JSON.stringify(session.generation.proposalContent, null, 2) }}</pre>
            </el-collapse-item>
            <el-collapse-item title="学习路径（按阶段组织）" name="path">
              <pre>{{ JSON.stringify(session.generation.pathContent, null, 2) }}</pre>
            </el-collapse-item>
          </el-collapse>
        </el-card>
        <el-empty v-else description="暂无生成数据" />
      </el-tab-pane>

      <!-- 评判报告 -->
      <el-tab-pane label="📊 评判报告" name="evaluation">
        <el-card v-if="session?.evaluation" shadow="hover">
          <div v-if="session.evaluation.report" class="evaluation-report">
            <div v-if="session.evaluation.report.strengths?.length > 0" class="report-section">
              <h4>✅ 优点</h4>
              <ul>
                <li v-for="(item, index) in session.evaluation.report.strengths" :key="index">
                  {{ item }}
                </li>
              </ul>
            </div>
            <div v-if="session.evaluation.report.weaknesses?.length > 0" class="report-section">
              <h4>⚠️ 不足</h4>
              <ul>
                <li v-for="(item, index) in session.evaluation.report.weaknesses" :key="index">
                  {{ item }}
                </li>
              </ul>
            </div>
            <div v-if="session.evaluation.report.issues?.length > 0" class="report-section">
              <h4>❌ 关键问题</h4>
              <ul>
                <li v-for="(item, index) in session.evaluation.report.issues" :key="index">
                  {{ item }}
                </li>
              </ul>
            </div>
          </div>
          <el-empty v-else description="暂无评判报告" />
        </el-card>
      </el-tab-pane>

      <!-- 优化建议 -->
      <el-tab-pane label="💡 优化建议" name="optimization">
        <el-card v-if="session?.optimization" shadow="hover">
          <div v-if="session.optimization.suggestions?.length > 0" class="optimization-list">
            <div
              v-for="(suggestion, index) in session.optimization.suggestions"
              :key="index"
              class="suggestion-item"
            >
              <div class="suggestion-agent">{{ suggestion.agent }}</div>
              <div class="suggestion-issue">{{ suggestion.issue }}</div>
              <div class="suggestion-solution">{{ suggestion.solution }}</div>
            </div>
          </div>
          <div v-if="session.optimization.expectedImprovement" class="expected-improvement">
            <h4>📈 预期改进</h4>
            <pre>{{ JSON.stringify(session.optimization.expectedImprovement, null, 2) }}</pre>
          </div>
          <el-empty v-else description="暂无优化建议" />
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Delete, InfoFilled, Edit, RefreshRight, VideoPlay, VideoPause } from '@element-plus/icons-vue';
import { adminArenaApi } from '@/api/adminApi';

const router = useRouter();
const route = useRoute();
const sessionId = computed(() => route.params.id as string);

// 状态
const loading = ref(false);
const session = ref<any>(null);
const activeTab = ref('persona');
const showAgentLogs = ref(false);
const showAgentDetail = ref<string | null>(null);
const runningAgent = ref<string | null>(null);

// 对话列表滚动
const dialogueListRef = ref<HTMLElement | null>(null);
const messageRefs = ref<HTMLElement[]>([]);

// 执行模式
const executionMode = ref<'manual' | 'auto'>('manual');
const runningAll = ref(false);

// 轮询间隔（用于停止对话）
let currentPollInterval: ReturnType<typeof setInterval> | null = null;

// 滚动对话列表到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (dialogueListRef.value) {
      dialogueListRef.value.scrollTop = dialogueListRef.value.scrollHeight;
    }
  });
};

// 安全解析对话消息（处理后端可能返回字符串的情况）
const parsedMessages = computed(() => {
  const messages = session.value?.dialogue?.messages;
  if (!messages) return [];
  if (typeof messages === 'string') {
    try {
      return JSON.parse(messages);
    } catch (e) {
      console.error('Failed to parse messages:', e);
      return [];
    }
  }
  return messages;
});

// 统一处理 persona 数据访问（优先使用独立字段，否则从 content 中获取）
const personaData = computed(() => {
  const persona = session.value?.persona;
  if (!persona) return null;
  
  const content = persona.content || {};
  return {
    surfaceGoal: persona.surfaceGoal || content.surfaceGoal || '',
    realProblem: persona.realProblem || content.realProblem || '',
    level: persona.level || content.level || '',
    timePerDay: persona.timePerDay || content.timePerDay || '',
    stages: persona.stages || content.stages || persona.totalWeeks || content.totalWeeks || '',
    totalWeeks: persona.totalWeeks || content.totalWeeks || '',
    motivation: persona.motivation || content.motivation || '',
    urgency: persona.urgency || content.urgency || '',
    scenario: content.scenario || {},
    psychology: content.psychology || {},
    external: content.external || {},
    background: content.background || {},
    personality: content.personality || {},
    raw: content
  };
});

// 监听对话数据变化，自动滚动
watch(() => parsedMessages.value.length, () => {
  if (activeTab.value === 'dialogue') {
    scrollToBottom();
  }
}, { flush: 'post' });

// 切换到对话标签页时滚动到底部
watch(activeTab, (newTab) => {
  if (newTab === 'dialogue') {
    setTimeout(scrollToBottom, 100);
  }
});

// 是否可以一键运行
const canRunAll = computed(() => {
  return agentFlow.value.some(agent => !agent.hasData && canRunAgent(agent.type));
});

// 对话编辑相关
const editingMessageIndex = ref<number | null>(null);
const editingMessageContent = ref('');
const selectedRound = ref(1);

// 计算最大轮次
const maxRound = computed(() => {
  if (!session.value?.dialogue?.messages) return 0;
  const messages = parsedMessages.value;
  const rounds = messages.map((m: any) => m.round || 0);
  return Math.max(...rounds, 0);
});

// 格式化时间
function formatTime(timestamp: string) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// 开始编辑消息
function startEditMessage(index: number, msg: any) {
  editingMessageIndex.value = index;
  editingMessageContent.value = msg.content;
}

// 保存编辑
async function saveEditMessage(index: number) {
  if (!session.value?.dialogue || !sessionId.value) return;
  
  try {
    // 确保 messages 是数组
    let messages = session.value.dialogue.messages;
    if (typeof messages === 'string') {
      messages = JSON.parse(messages);
    }
    
    // 更新本地数据
    messages[index].content = editingMessageContent.value;
    messages[index].edited = true;
    messages[index].editedAt = new Date().toISOString();
    
    // 更新 session
    session.value.dialogue.messages = messages;
    
    // 调用 API 保存到后端
    await adminAxios.put(`/admin/arena/sessions/${sessionId.value}/dialogue`, {
      messages: messages
    });
    
    ElMessage.success('已保存到后端');
  } catch (error: any) {
    ElMessage.error('保存失败: ' + (error.message || '未知错误'));
    console.error('Save dialogue failed:', error);
  } finally {
    editingMessageIndex.value = null;
    editingMessageContent.value = '';
  }
}

// 取消编辑
function cancelEditMessage() {
  editingMessageIndex.value = null;
  editingMessageContent.value = '';
}

// 从指定轮次重新生成
async function regenerateFromRound(round: number) {
  if (!round || round < 1) {
    ElMessage.warning('请选择有效的轮次');
    return;
  }

  // 清除之前的轮询
  if (currentPollInterval) {
    clearInterval(currentPollInterval);
    currentPollInterval = null;
  }

  // 启动轮询
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  pollInterval = setInterval(async () => {
    await loadSession();
    if (activeTab.value === 'dialogue') {
      scrollToBottom();
    }
  }, 2000);

  // 保存轮询引用
  currentPollInterval = pollInterval;

  try {
    ElMessage.info(`从第${round}轮重新生成...`);

    const response: any = await adminArenaApi.runAgent(sessionId.value, 'dialogue', {
      fromRound: round
    });

    if (response.data.success) {
      ElMessage.success('重新生成完成');
      await loadSession();
    }
  } catch (error: any) {
    ElMessage.error('重新生成失败：' + (error.response?.data?.error || error.message));
  } finally {
    if (pollInterval) {
      clearInterval(pollInterval);
      currentPollInterval = null;
    }
  }
}

// Agent流程
const agentFlow = computed(() => [
  { type: 'persona', name: '画像Agent', icon: '👤', hasData: !!session.value?.persona, status: getAgentStatus('persona'), statusText: getAgentStatusText('persona') },
  { type: 'userAgent', name: '用户Agent', icon: '🎭', hasData: !!session.value?.persona, status: getAgentStatus('persona'), statusText: '准备就绪' },
  { type: 'dialogue', name: '对话Agent', icon: '💬', hasData: !!session.value?.dialogue, status: getAgentStatus('dialogue'), statusText: getAgentStatusText('dialogue') },
  { type: 'extraction', name: '需求提炼Agent', icon: '📋', hasData: !!session.value?.extraction, status: getAgentStatus('extraction'), statusText: getAgentStatusText('extraction') },
  { type: 'generation', name: '路径规划Agent', icon: '🎯', hasData: !!session.value?.generation, status: getAgentStatus('generation'), statusText: getAgentStatusText('generation') },
  { type: 'evaluation', name: '评判Agent', icon: '📊', hasData: !!session.value?.evaluation, status: getAgentStatus('evaluation'), statusText: getAgentStatusText('evaluation') },
  { type: 'optimization', name: '调整Agent', icon: '💡', hasData: !!session.value?.optimization, status: getAgentStatus('optimization'), statusText: getAgentStatusText('optimization') }
]);

const currentAgentIndex = computed(() => {
  return agentFlow.value.findIndex(a => !a.hasData);
});

// 加载详情
const loadSession = async () => {
  loading.value = true;
  try {
    const response: any = await adminArenaApi.getSession(sessionId.value);
    if (response.data.success) {
      session.value = response.data.data;
      
      // 调试日志
      console.log('Session loaded:', session.value);
      console.log('Persona:', session.value?.persona);
      console.log('Persona surfaceGoal:', session.value?.persona?.surfaceGoal);
      console.log('Persona content:', session.value?.persona?.content);
      console.log('Dialogue:', session.value?.dialogue);
      console.log('Messages:', session.value?.dialogue?.messages);
      console.log('Messages type:', typeof session.value?.dialogue?.messages);
      console.log('Messages length:', session.value?.dialogue?.messages?.length);
      
      // 如果当前在对话标签页，加载完成后滚动到底部
      if (activeTab.value === 'dialogue') {
        setTimeout(scrollToBottom, 100);
      }
    }
  } catch (error: any) {
    ElMessage.error('加载详情失败');
    console.error('Load session error:', error);
  } finally {
    loading.value = false;
  }
};

// 删除
const deleteSession = async () => {
  try {
    await ElMessageBox.confirm('确定删除此演练吗？', '确认删除', { type: 'warning' });
    const response: any = await adminArenaApi.deleteSession(sessionId.value);
    if (response.data.success) {
      ElMessage.success('已删除');
      router.push('/admin/arena');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败');
    }
  }
};

// 手动执行 Agent
const runAgentManually = async (agentType: string) => {
  runningAgent.value = agentType;
  console.log(`Starting ${agentType}...`);

  // 启动轮询，实时更新进度
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  if (agentType === 'dialogue') {
    pollInterval = setInterval(async () => {
      await loadSession();
      // 如果切换到对话标签页，滚动到底部
      if (activeTab.value === 'dialogue') {
        scrollToBottom();
      }
    }, 2000); // 每2秒刷新一次

    // 保存轮询引用，以便停止
    currentPollInterval = pollInterval;
  }

  try {
    ElMessage.info(`正在执行 ${getAgentName(agentType)}...`);
    const response: any = await adminArenaApi.runAgent(sessionId.value, agentType);
    console.log('Run agent response:', response);
    if (response.data.success) {
      ElMessage.success(`${getAgentName(agentType)} 执行完成`);
      console.log('Loading session after agent execution...');
      await loadSession();
      showAgentDetail.value = agentType;
      // 如果是对话Agent，自动切换到对话标签页
      if (agentType === 'dialogue') {
        activeTab.value = 'dialogue';
        setTimeout(scrollToBottom, 100);
      }
    }
  } catch (error: any) {
    console.error('Run agent error:', error);
    ElMessage.error('执行失败：' + (error.response?.data?.error || error.message));
  } finally {
    runningAgent.value = null;
    if (pollInterval) {
      clearInterval(pollInterval);
      currentPollInterval = null;
    }
  }
};

// 停止对话
const stopDialogue = async () => {
  try {
    ElMessage.info('正在停止对话...');
    const response: any = await adminArenaApi.stopDialogue(sessionId.value);
    if (response.data.success) {
      ElMessage.success('对话已停止');

      // 清除轮询
      if (currentPollInterval) {
        clearInterval(currentPollInterval);
        currentPollInterval = null;
      }

      // 更新状态
      runningAgent.value = null;
      await loadSession();
    }
  } catch (error: any) {
    console.error('Stop dialogue error:', error);
    ElMessage.error('停止失败：' + (error.response?.data?.error || error.message));
  }
};

// 一键运行所有 Agent
const runAllAgents = async () => {
  runningAll.value = true;
  // userAgent 是虚拟步骤（画像→用户Agent→对话），不需要单独执行
  const agents = ['persona', 'dialogue', 'extraction', 'generation', 'evaluation', 'optimization'];
  
  try {
    for (const agentType of agents) {
      if (!canRunAgent(agentType)) continue;
      
      runningAgent.value = agentType;
      ElMessage.info(`正在执行 ${getAgentName(agentType)}...`);
      
      const response: any = await adminArenaApi.runAgent(sessionId.value, agentType);
      if (response.data.success) {
        ElMessage.success(`${getAgentName(agentType)} 执行完成`);
        await loadSession();
      }
      
      // 每个 Agent 之间稍微停顿，让 UI 有机会更新
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    ElMessage.success('所有 Agent 执行完成');
  } catch (error: any) {
    ElMessage.error('执行失败：' + (error.response?.data?.error || error.message));
  } finally {
    runningAll.value = false;
    runningAgent.value = null;
  }
};

// 检查是否可以执行 Agent
const canRunAgent = (agentType: string) => {
  const prerequisites: Record<string, string[]> = {
    persona: [],
    userAgent: ['persona'],  // 用户Agent依赖画像
    dialogue: ['persona'],   // 对话Agent依赖画像（通过用户Agent间接）
    extraction: ['dialogue'],
    generation: ['extraction'],
    evaluation: ['generation'],
    optimization: ['evaluation']
  };
  
  // 用户Agent是自动步骤，不需要执行按钮
  if (agentType === 'userAgent') return false;
  
  const required = prerequisites[agentType] || [];
  return required.every((type: string) => {
    const agent = agentFlow.value.find((a: any) => a.type === type);
    return agent?.hasData;
  });
};

// 切换 Agent 详情显示
const toggleAgentDetail = (agentType: string) => {
  showAgentDetail.value = showAgentDetail.value === agentType ? null : agentType;
};

// 获取 Agent 显示名称
const getAgentName = (agentType: string) => {
  const names: Record<string, string> = {
    persona: '画像Agent',
    userAgent: '用户Agent',
    dialogue: '对话Agent',
    extraction: '需求提炼Agent',
    generation: '路径规划Agent',
    evaluation: '评判Agent',
    optimization: '调整Agent'
  };
  return names[agentType] || agentType;
};

// 获取Agent状态
function getAgentStatus(type: string) {
  if (!session.value) return 'pending';
  
  // 用户Agent是虚拟步骤，状态取决于画像是否存在
  if (type === 'userAgent') {
    return session.value.persona ? 'success' : 'pending';
  }
  
  const hasData = session.value[type];
  if (hasData) return 'success';
  if (session.value.status === 'failed') return 'error';
  return 'pending';
}

function getAgentStatusText(type: string) {
  // 用户Agent显示特殊文本
  if (type === 'userAgent') {
    return session.value?.persona ? '准备就绪' : '等待画像';
  }
  
  const status = getAgentStatus(type);
  const map: Record<string, string> = {
    success: '完成',
    error: '失败',
    pending: '待执行'
  };
  return map[status] || '待执行';
}

// 学习状态标签类型
function getLearningStateType(state: string): string {
  const map: Record<string, string> = {
    '焦虑型': 'danger',
    '拖延型': 'warning',
    '突击型': 'primary',
    '持久型': 'success',
    '速成型': 'info'
  };
  return map[state] || 'info';
}

// 状态样式
const getStatusType = (status: string) => {
  const map: Record<string, string> = {
    running: 'warning',
    completed: 'success',
    failed: 'danger'
  };
  return map[status] || 'info';
};

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    running: '运行中',
    completed: '已完成',
    failed: '失败'
  };
  return map[status] || status;
};

// Agent 输入数据
const agentInput = computed(() => {
  if (!showAgentDetail.value || !session.value) return null;
  
  switch (showAgentDetail.value) {
    case 'persona':
      return { prompt: '自动生成用户画像' };
    case 'userAgent':
      // 用户Agent的输入是画像
      return session.value.persona?.content;
    case 'dialogue':
      return session.value.persona?.content;
    case 'extraction':
      return parsedMessages.value;
    case 'generation':
      return session.value.extraction?.content;
    case 'evaluation':
      return {
        persona: personaData.value,
        dialogue: parsedMessages.value,
        extraction: session.value.extraction?.content,
        generation: session.value.generation?.pathContent
      };
    case 'optimization':
      return session.value.evaluation?.report;
    default:
      return null;
  }
});

// Agent 输出数据
const agentOutput = computed(() => {
  if (!showAgentDetail.value || !session.value) return null;
  
  switch (showAgentDetail.value) {
    case 'persona':
      return personaData.value;
    case 'userAgent':
      // 用户Agent的输出是实例化后的数字人状态
      return { 
        message: '数字人已实例化',
        personaName: personaData.value?.name || '匿名',
        status: '准备就绪'
      };
    case 'dialogue':
      return parsedMessages.value;
    case 'extraction':
      return session.value.extraction?.content;
    case 'generation':
      return {
        proposal: session.value.generation?.proposalContent,
        path: session.value.generation?.pathContent
      };
    case 'evaluation':
      return session.value.evaluation?.report;
    case 'optimization':
      return session.value.optimization?.suggestions;
    default:
      return null;
  }
});

// 评分颜色
const getScoreColor = (percentage: number) => {
  if (percentage >= 80) return '#67c23a';
  if (percentage >= 60) return '#e6a23c';
  return '#f56c6c';
};

// 返回
const goBack = () => {
  router.push('/admin/arena');
};

onMounted(() => {
  loadSession();
});
</script>

<style scoped>
.arena-detail {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

/* 评分卡片 */
.score-card {
  margin-bottom: 1.5rem;
}

.score-overview {
  display: flex;
  gap: 3rem;
  align-items: center;
}

.main-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.score-label {
  font-size: 1rem;
  color: var(--text-secondary);
}

.dimension-scores {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dim-item {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.dim-name {
  width: 100px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* Agent流程 */
.agents-card {
  margin-bottom: 1.5rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header .header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.agent-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.agent-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 20px;
  background: var(--bg-surface);
  opacity: 0.6;
  transition: all 0.3s;
  font-size: 13px;
  white-space: nowrap;
}

.agent-step.active {
  opacity: 1;
  background: rgba(59, 130, 246, 0.15);
}

.agent-step.current {
  background: rgba(59, 130, 246, 0.25);
  border: 2px solid var(--color-primary);
}

.agent-icon {
  font-size: 1.1rem;
}

.agent-info {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.agent-name {
  font-weight: 500;
  font-size: 12px;
  color: var(--text-primary);
}

.agent-status {
  font-size: 0.75rem;
}

.agent-status.success {
  color: var(--color-success);
}

.agent-status.error {
  color: var(--color-danger);
}

.agent-status.pending {
  color: var(--text-muted);
}

.agent-arrow {
  font-size: 1.5rem;
  color: var(--text-muted);
}

/* Agent 详情面板 */
.agent-detail-panel {
  margin-top: 1.5rem;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.input-section,
.output-section {
  h4 {
    margin: 0 0 0.5rem 0;
    color: var(--text-primary);
    font-size: 1rem;
  }
  
  pre {
    background: var(--bg-surface);
    padding: 1rem;
    border-radius: 6px;
    overflow: auto;
    max-height: 300px;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text-primary);
    border: 1px solid var(--border-default);
  }
}

/* Agent日志 */
.agent-logs {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-default);
}

.log-item {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.log-agent {
  font-weight: 500;
  color: var(--text-primary);
}

.log-duration,
.log-tokens {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* 详情标签页 */
.detail-tabs {
  margin-top: 1rem;
}

/* 画像详情区块 */
.persona-detail {
  padding: 0.5rem 0;
}

.detail-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--bg-surface);
  border-radius: 8px;
  border: 1px solid var(--border-default);
}

.detail-section h4 {
  margin: 0 0 0.75rem 0;
  font-size: 1rem;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.multi-tag {
  margin-right: 0.5rem;
  margin-bottom: 0.25rem;
}

/* 通用详情样式 */
.detail-row {
  display: flex;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border-default);
}

.detail-row.highlight {
  background: rgba(59, 130, 246, 0.1);
  padding: 0.75rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}

.detail-row .label {
  width: 100px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.detail-row .value {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}

.raw-collapse {
  margin-top: 1rem;
}

/* 对话样式 */
.dialogue-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.dialogue-stats {
  display: flex;
  gap: 2rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-default);
}

.dialogue-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 500px;
  overflow-y: auto;
}

.dialogue-message {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: all 0.3s;
}

.dialogue-message.user {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.3);
}

.dialogue-message.assistant {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
}

.dialogue-message.editing {
  border-color: var(--color-efficient);
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.round-badge {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: var(--bg-surface);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-default);
}

.message-time {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.message-content {
  flex: 1;
  white-space: pre-wrap;
  color: var(--text-primary);
  line-height: 1.6;
  padding-left: 0.5rem;
}

.message-edit {
  padding-left: 0.5rem;
}

.dialogue-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-default);
}

/* 需求提取 */
.extraction-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-default);
}

.completeness-label {
  color: var(--text-secondary);
}

.completeness-value {
  font-weight: 600;
  color: var(--text-primary);
}

.missing-fields {
  margin-bottom: 1rem;
}

/* 评判报告 */
.evaluation-report {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.report-section h4 {
  margin: 0 0 0.5rem 0;
  color: var(--text-primary);
}

.report-section ul {
  margin: 0;
  padding-left: 1.5rem;
}

.report-section li {
  margin: 0.25rem 0;
  color: var(--text-secondary);
}

/* 优化建议 */
.optimization-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.suggestion-item {
  padding: 1rem;
  background: var(--bg-surface);
  border-radius: 8px;
  border-left: 4px solid var(--color-primary);
  border: 1px solid var(--border-default);
}

.suggestion-agent {
  font-weight: 600;
  color: var(--color-primary);
  margin-bottom: 0.5rem;
}

.suggestion-issue {
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.suggestion-solution {
  color: var(--text-primary);
}

.expected-improvement {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-default);
}

.expected-improvement h4 {
  margin: 0 0 0.5rem 0;
  color: var(--text-primary);
}

.expected-improvement pre {
  background: var(--bg-surface);
  padding: 1rem;
  border-radius: 6px;
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

/* 对话信息框 */
.dialogue-info-box {
  background: rgba(59, 130, 246, 0.1);
  padding: 12px;
  margin-bottom: 10px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--color-primary);
  border-left: 4px solid var(--color-primary);
}

.dialogue-info-title {
  font-weight: bold;
  margin-bottom: 4px;
}

.dialogue-info-content {
  line-height: 1.6;
}

.dialogue-header-title {
  font-size: 16px;
  font-weight: bold;
  color: var(--color-primary);
}

.dialogue-header-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.dialogue-explanation {
  background: var(--bg-surface);
  padding: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  border-radius: 4px;
  border: 1px solid var(--border-default);
}

.dialogue-explanation-text {
  margin-left: 8px;
}

/* 夜间模式 */
[data-theme="dark"] .page-title {
  color: var(--text-primary);
}

[data-theme="dark"] .score-card {
  background: rgba(30, 45, 58, 0.74) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] .score-label {
  color: var(--text-secondary);
}

[data-theme="dark"] .dim-name {
  color: var(--text-secondary);
}

[data-theme="dark"] .agents-card {
  background: rgba(30, 45, 58, 0.74) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] .card-header {
  color: var(--text-primary);
}

[data-theme="dark"] .card-title {
  color: var(--text-primary);
}

[data-theme="dark"] .agent-step {
  background: rgba(30, 45, 58, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .agent-step.active {
  background: rgba(59, 130, 246, 0.2);
}

[data-theme="dark"] .agent-step.current {
  background: rgba(59, 130, 246, 0.3);
  border: 2px solid var(--color-primary);
}

[data-theme="dark"] .agent-name {
  color: var(--text-primary);
}

[data-theme="dark"] .agent-arrow {
  color: var(--text-muted);
}

[data-theme="dark"] .detail-header {
  color: var(--text-primary);
}

[data-theme="dark"] .detail-content {
  background: rgba(30, 45, 58, 0.5);
}

[data-theme="dark"] .input-section h4,
[data-theme="dark"] .output-section h4 {
  color: var(--text-primary);
}

[data-theme="dark"] .input-section pre,
[data-theme="dark"] .output-section pre {
  background: rgba(30, 45, 58, 0.6);
  color: var(--text-primary);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .agent-logs {
  border-top-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .log-agent {
  color: var(--text-primary);
}

[data-theme="dark"] .log-duration,
[data-theme="dark"] .log-tokens {
  color: var(--text-secondary);
}

[data-theme="dark"] .detail-tabs {
  --el-bg-color: transparent;
}

[data-theme="dark"] .persona-detail {
  background: transparent;
}

[data-theme="dark"] .detail-section {
  background: rgba(30, 45, 58, 0.5);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .detail-section h4 {
  color: var(--text-primary);
}

[data-theme="dark"] .detail-row {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .detail-row.highlight {
  background: rgba(59, 130, 246, 0.15);
}

[data-theme="dark"] .detail-row .label {
  color: var(--text-secondary);
}

[data-theme="dark"] .detail-row .value {
  color: var(--text-primary);
}

[data-theme="dark"] .dialogue-header-title {
  color: var(--color-primary);
}

[data-theme="dark"] .dialogue-header-subtitle {
  color: var(--text-secondary);
}

[data-theme="dark"] .dialogue-stats {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .dialogue-explanation {
  background: rgba(30, 45, 58, 0.5);
  color: var(--text-secondary);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .dialogue-message.user {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.4);
}

[data-theme="dark"] .dialogue-message.assistant {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
}

[data-theme="dark"] .dialogue-message.editing {
  border-color: var(--color-efficient);
}

[data-theme="dark"] .round-badge {
  background: rgba(30, 45, 58, 0.6);
  color: var(--text-secondary);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .message-time {
  color: var(--text-muted);
}

[data-theme="dark"] .message-content {
  color: var(--text-primary);
}

[data-theme="dark"] .dialogue-actions {
  border-top-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .dialogue-info-box {
  background: rgba(59, 130, 246, 0.15);
  color: var(--color-primary);
}

[data-theme="dark"] .extraction-header {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .completeness-label {
  color: var(--text-secondary);
}

[data-theme="dark"] .completeness-value {
  color: var(--text-primary);
}

[data-theme="dark"] .evaluation-report {
  background: transparent;
}

[data-theme="dark"] .report-section h4 {
  color: var(--text-primary);
}

[data-theme="dark"] .report-section li {
  color: var(--text-secondary);
}

[data-theme="dark"] .optimization-list {
  background: transparent;
}

[data-theme="dark"] .suggestion-item {
  background: rgba(30, 45, 58, 0.5);
  border-left-color: var(--color-primary);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .suggestion-agent {
  color: var(--color-primary);
}

[data-theme="dark"] .suggestion-issue {
  color: var(--text-secondary);
}

[data-theme="dark"] .suggestion-solution {
  color: var(--text-primary);
}

[data-theme="dark"] .expected-improvement {
  border-top-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .expected-improvement h4 {
  color: var(--text-primary);
}

[data-theme="dark"] .expected-improvement pre {
  background: rgba(30, 45, 58, 0.6);
  color: var(--text-primary);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] :deep(.el-card) {
  background: rgba(30, 45, 58, 0.74) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] :deep(.el-tabs__item) {
  color: var(--text-secondary);
}

[data-theme="dark"] :deep(.el-tabs__item.is-active) {
  color: var(--color-primary);
}

[data-theme="dark"] :deep(.el-tabs__active-bar) {
  background-color: var(--color-primary);
}

[data-theme="dark"] :deep(.el-progress__text) {
  color: var(--text-primary);
}

[data-theme="dark"] :deep(.el-statistic__head) {
  color: var(--text-secondary);
}

[data-theme="dark"] :deep(.el-statistic__content) {
  color: var(--text-primary);
}

[data-theme="dark"] :deep(.el-collapse-item__header) {
  background: transparent;
  color: var(--text-primary);
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] :deep(.el-collapse-item__content) {
  background: rgba(30, 45, 58, 0.5);
  color: var(--text-primary);
}

[data-theme="dark"] :deep(.el-timeline-item__timestamp) {
  color: var(--text-muted);
}

[data-theme="dark"] :deep(.el-timeline-item__tail) {
  border-left-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] :deep(.el-timeline-item__node) {
  background: var(--bg-surface);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] :deep(.el-empty__description) {
  color: var(--text-secondary);
}

[data-theme="dark"] :deep(.el-progress-bar__inner) {
  --el-color-success: var(--color-success);
  --el-color-warning: var(--color-efficient);
  --el-color-danger: var(--color-danger);
}

.expected-improvement pre {
  background: var(--bg-surface);
  padding: 1rem;
  border-radius: 6px;
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}
</style>
