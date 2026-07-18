<template>
  <div class="admin-page execution-logs-page">
    <AdminPageHeader
      title="执行日志"
      :icon="Cpu"
      :highlights="executionHighlights"
    >
      <template #actions>
        <el-button @click="loadLogs" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
        <el-button @click="handleExport">
          <el-icon><Download /></el-icon>
          导出当前页
        </el-button>
      </template>
    </AdminPageHeader>

    <section class="admin-filter-panel">
      <div class="admin-section-head">
        <div class="admin-section-head__copy">
          <h3 class="admin-section-head__title">筛选</h3>
        </div>
        <el-button class="filter-toggle" text @click="filterExpanded = !filterExpanded">
          {{ filterExpanded ? '收起' : `展开${activeFilterCount ? ` · ${activeFilterCount} 项` : ''}` }}
        </el-button>
      </div>
      <div v-show="filterExpanded" class="admin-filter-grid admin-filter-grid--wide">
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">时间范围</label>
          <el-select v-model="filters.timeRange" class="filter-select" @change="filters.timeRangeExact = null">
            <el-option label="今天" value="today" />
            <el-option label="昨天" value="yesterday" />
            <el-option label="最近 7 天" value="week" />
            <el-option label="最近 30 天" value="month" />
            <el-option label="全部" value="all" />
          </el-select>
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">能力类型</label>
          <el-select
            v-model="filters.agentName"
            placeholder="全部 Agent"
            clearable
            class="filter-select"
          >
            <el-option
              v-for="agent in agentOptions"
              :key="agent.value"
              :label="agent.label"
              :value="agent.value"
            />
          </el-select>
        </div>

        <div class="admin-filter-field">
          <label class="admin-filter-field__label">节点 ID（精确）</label>
          <el-input
            v-model="filters.agentId"
            placeholder="如 ai-teaching-agent"
            clearable
            class="filter-input"
          />
        </div>

        <div class="admin-filter-field">
          <label class="admin-filter-field__label">Trace ID</label>
          <el-input
            v-model="filters.traceId"
            placeholder="链路追踪 ID"
            clearable
            class="filter-input"
          />
        </div>

        <div class="admin-filter-field">
          <label class="admin-filter-field__label">Session ID</label>
          <el-input
            v-model="filters.sessionId"
            placeholder="学习会话 ID"
            clearable
            class="filter-input"
          />
        </div>

        <div class="admin-filter-field">
          <label class="admin-filter-field__label">状态</label>
          <el-select
            v-model="filters.status"
            placeholder="全部状态"
            clearable
            class="filter-select"
          >
            <el-option label="成功" value="success">
              <span class="status-dot success"></span> 成功
            </el-option>
            <el-option label="失败" value="error">
              <span class="status-dot error"></span> 失败
            </el-option>
            <el-option label="超时" value="timeout">
              <span class="status-dot warning"></span> 超时
            </el-option>
          </el-select>
        </div>

        <div class="admin-filter-field">
          <label class="admin-filter-field__label">来源</label>
          <el-select v-model="filters.sourceEntry" placeholder="全部来源" clearable class="filter-select">
            <el-option label="用户侧" value="user" />
            <el-option label="测试站点" value="test" />
            <el-option label="Admin 后台" value="admin" />
            <el-option label="平台内部" value="platform" />
          </el-select>
        </div>

        <div class="admin-filter-field admin-filter-field--span-2">
          <label class="admin-filter-field__label">精确时间</label>
          <el-date-picker
            v-model="filters.timeRangeExact"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            :shortcuts="timeShortcuts"
            clearable
            class="time-picker"
          />
        </div>

        <div class="admin-filter-field admin-filter-field--span-2 search-item">
          <label class="admin-filter-field__label">搜索</label>
          <el-input
            v-model="filters.keyword"
            placeholder="搜索输入/输出/错误"
            clearable
            class="search-input"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>

        <div class="filter-actions">
          <el-button type="primary" @click="handleSearch" :loading="loading">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button type="default" @click="handleReset">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </div>
      </div>
    </section>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      title="执行日志加载失败"
    >
      <template #default>
        <div class="admin-error-row">
          <span>{{ loadError }}</span>
          <el-button size="small" @click="loadLogs">重试</el-button>
        </div>
      </template>
    </el-alert>

    <div class="admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-checkbox v-model="autoRefresh" size="small">
          自动刷新 ({{ refreshInterval }}s)
        </el-checkbox>
      </div>
    </div>

    <!-- 日志列表 -->
    <section class="logs-shell">
      <div class="logs-shell__toolbar">
        <span class="logs-shell__count">本页 {{ logs.length }} 条，共 {{ pagination.total }} 条</span>
      </div>
      <div class="logs-list" v-loading="loading">
        <div
          v-for="log in logs"
          :key="log.id"
          class="log-card"
          role="button"
          tabindex="0"
          @click="showDetail(log)"
          @keydown.enter="showDetail(log)"
          @keydown.space.prevent="showDetail(log)"
        >
          <div class="log-card__main">
            <div class="log-card__primary">
              <span class="log-card__time">{{ formatTime(log.createdAt) }}</span>
              <span class="log-card__agent">{{ getAgentDisplayName(log.agentName) }}</span>
              <span 
                class="log-card__status-dot" 
                :class="`log-card__status-dot--${log.status}`"
                :title="getLogStatusText(log.status)"
              ></span>
            </div>
            <div class="log-card__secondary">
              <span class="log-card__meta" v-if="log.traceId">trace:{{ log.traceId.slice(0, 8) }}</span>
              <span class="log-card__meta" v-if="log.sessionId">session:{{ log.sessionId.slice(0, 8) }}</span>
              <span class="log-card__meta" v-if="log.sourceEntry">{{ getSourceLabel(log.sourceEntry) }}</span>
            </div>
          </div>
          <div class="log-card__aside">
            <span class="log-card__duration">{{ formatDuration(log.durationMs) }}</span>
          </div>
        </div>

      <!-- 空状态 -->
      <el-empty v-if="!loading && logs.length === 0" description="暂无记录" />
      </div>
    </section>

    <!-- 分页 -->
    <div class="pagination-wrapper" v-if="pagination.total > 0">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :total="pagination.total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      title="执行日志详情"
      size="min(calc(100vw - 24px), 880px)"
      direction="rtl"
      destroy-on-close
    >
      <div v-if="selectedLog" class="drawer-content">
        <!-- Hero -->
        <div class="drawer-hero">
          <div class="drawer-hero__status">
            <span 
              class="drawer-hero__status-dot" 
              :class="`drawer-hero__status-dot--${selectedLog.status}`"
            ></span>
            <span class="drawer-hero__status-text">{{ getLogStatusText(selectedLog.status) }}</span>
          </div>
          <h2 class="drawer-hero__title">{{ getAgentDisplayName(selectedLog.agentName) }}</h2>
          <p class="drawer-hero__subtitle">{{ formatDateTime(selectedLog.createdAt) }} • {{ formatDuration(selectedLog.durationMs) }}</p>
        </div>

        <!-- 概览网格 -->
        <div class="drawer-overview-grid">
          <div class="drawer-overview-item" v-if="selectedLog.action">
            <span class="drawer-overview-item__label">动作</span>
            <span class="drawer-overview-item__value">{{ selectedLog.action }}</span>
          </div>
          <div class="drawer-overview-item" v-if="selectedLog.sourceEntry">
            <span class="drawer-overview-item__label">来源</span>
            <span class="drawer-overview-item__value">{{ getSourceLabel(selectedLog.sourceEntry) }}</span>
          </div>
          <div class="drawer-overview-item" v-if="selectedLog.executionLayer">
            <span class="drawer-overview-item__label">执行层</span>
            <span class="drawer-overview-item__value">{{ getExecutionLayerLabel(selectedLog.executionLayer) }}</span>
          </div>
        </div>

        <!-- Tabs -->
        <el-tabs v-model="activeTab" class="drawer-tabs">
          <!-- 基本信息 -->
          <el-tab-pane label="基本信息" name="basic">
            <el-descriptions :column="2" class="drawer-descriptions">
              <el-descriptions-item label="Trace ID" v-if="selectedLog.traceId">
                {{ selectedLog.traceId }}
              </el-descriptions-item>
              <el-descriptions-item label="Session ID" v-if="selectedLog.sessionId">
                {{ selectedLog.sessionId }}
              </el-descriptions-item>
              <el-descriptions-item label="执行主体类型" v-if="selectedLog.actorType">
                {{ getActorTypeLabel(selectedLog.actorType) }}
              </el-descriptions-item>
              <el-descriptions-item label="执行主体 ID" v-if="selectedLog.actorId">
                {{ selectedLog.actorId }}
              </el-descriptions-item>
              <el-descriptions-item label="调用方" v-if="selectedLog.invokerId">
                {{ getInvokerLabel(selectedLog) }}
              </el-descriptions-item>
              <el-descriptions-item label="提供方" v-if="selectedLog.providerId">
                {{ selectedLog.providerId }}
              </el-descriptions-item>
              <el-descriptions-item label="状态码" v-if="selectedLog.statusCode">
                {{ selectedLog.statusCode }}
              </el-descriptions-item>
              <el-descriptions-item label="尝试次数" v-if="selectedLog.attempts">
                {{ selectedLog.attempts }}<template v-if="selectedLog.maxRetries"> / {{ selectedLog.maxRetries }}</template>
              </el-descriptions-item>
              <el-descriptions-item label="Path ID" v-if="selectedLog.pathId">
                {{ selectedLog.pathId }}
              </el-descriptions-item>
              <el-descriptions-item label="阶段" v-if="selectedLog.phase">
                {{ selectedLog.phase }}<template v-if="selectedLog.phaseStatus"> / {{ selectedLog.phaseStatus }}</template>
              </el-descriptions-item>
            </el-descriptions>
            <div class="drawer-actions" v-if="canOpenPromptLogs(selectedLog)">
              <el-button type="primary" size="small" @click="openPromptLogs(selectedLog!)">
                打开 Prompt 调用日志
              </el-button>
            </div>
          </el-tab-pane>

          <el-tab-pane label="Prompt 子日志" name="prompts">
            <div class="prompt-child-panel" v-loading="promptLogsLoading">
              <template v-if="promptLogs.length">
                <div class="prompt-child-summary-grid">
                  <div class="prompt-child-summary-card">
                    <span class="prompt-child-summary-card__label">子日志数</span>
                    <strong>{{ promptLogStats.total }}</strong>
                  </div>
                  <div class="prompt-child-summary-card">
                    <span class="prompt-child-summary-card__label">成功</span>
                    <strong>{{ promptLogStats.success }}</strong>
                  </div>
                  <div class="prompt-child-summary-card">
                    <span class="prompt-child-summary-card__label">失败</span>
                    <strong>{{ promptLogStats.error }}</strong>
                  </div>
                  <div class="prompt-child-summary-card">
                    <span class="prompt-child-summary-card__label">异常标记</span>
                    <strong>{{ promptLogStats.drift }}</strong>
                  </div>
                </div>

                <div class="prompt-child-list">
                  <article v-for="item in promptLogs" :key="item.id" class="prompt-child-card">
                    <div class="prompt-child-card__head">
                      <div class="prompt-child-card__meta">
                        <strong>{{ item.agentId }}</strong>
                        <el-tag size="small" :type="item.success ? 'success' : 'danger'">
                          {{ item.success ? '成功' : '失败' }}
                        </el-tag>
                        <el-tag v-if="item.promptDrift" size="small" type="warning">Prompt 漂移</el-tag>
                        <span v-if="item.systemPromptVersion" class="prompt-child-card__version">v{{ item.systemPromptVersion }}</span>
                      </div>
                      <span class="prompt-child-card__duration">{{ formatDuration(item.durationMs) }}</span>
                    </div>
                    <div class="prompt-child-card__submeta">
                      <span>{{ formatDateTime(item.createdAt) }}</span>
                      <span v-if="item.pipelineRunId">Run {{ item.pipelineRunId }}</span>
                      <span v-if="item.pipelineStepIndex !== null && item.pipelineStepIndex !== undefined">步骤 {{ item.pipelineStepIndex }}</span>
                    </div>
                    <p v-if="describePromptLogIssue(item)" class="prompt-child-card__issue">{{ describePromptLogIssue(item) }}</p>
                    <div v-if="item.errorMessage" class="prompt-child-card__error">{{ item.errorMessage }}</div>
                  </article>
                </div>
              </template>
              <el-empty v-else description="暂无 Prompt 子日志" />

              <div class="drawer-actions" v-if="selectedLog && canOpenPromptLogs(selectedLog)">
                <el-button type="primary" plain size="small" @click="openPromptLogs(selectedLog)">
                  打开完整 Prompt 日志
                </el-button>
              </div>
            </div>
          </el-tab-pane>

          <!-- 输入数据 -->
          <el-tab-pane label="输入数据" name="input" v-if="selectedLog.input">
            <div class="drawer-code-header">
              <el-button type="primary" link size="small" @click="copyToClipboard(selectedLog.input)">
                <el-icon><DocumentCopy /></el-icon>
                复制
              </el-button>
            </div>
            <pre class="drawer-code-block drawer-code-block--input" v-html="highlightJson(formatJson(selectedLog.input))"></pre>
          </el-tab-pane>

          <!-- 输出结果 -->
          <el-tab-pane label="输出结果" name="output" v-if="selectedLog.output && selectedLog.status === 'success'">
            <div class="drawer-code-header">
              <el-button type="primary" link size="small" @click="copyToClipboard(selectedLog.output)">
                <el-icon><DocumentCopy /></el-icon>
                复制
              </el-button>
            </div>
            <pre class="drawer-code-block drawer-code-block--output" v-html="highlightJson(formatJson(selectedLog.output))"></pre>
          </el-tab-pane>

          <!-- 错误信息 -->
          <el-tab-pane label="错误信息" name="error" v-if="selectedLog.error">
            <div class="drawer-code-header">
              <el-button type="danger" link size="small" @click="copyToClipboard(selectedLog.error)">
                <el-icon><DocumentCopy /></el-icon>
                复制
              </el-button>
            </div>
            <pre class="drawer-code-block drawer-code-block--error">{{ selectedLog.error }}</pre>
          </el-tab-pane>
        </el-tabs>
      </div>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">关闭</el-button>
          <el-button type="primary" @click="exportDetail">
            <el-icon><Download /></el-icon>
            导出 JSON
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import {
  Search,
  Refresh,
  DocumentCopy,
  Download,
  Cpu
} from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { adminAxios, adminRuntimeDefinitionsApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';
import { toast } from '../../utils/toast';

interface Log {
  id: string;
  agentName: string;
  agentId?: string;
  callerAgent?: string | null;
  action: string;
  status: 'success' | 'error' | 'timeout';
  input?: string;
  output?: string;
  error?: string;
  errorCode?: string;
  traceId?: string;
  sessionId?: string;
  sourceEntry?: string;
  executionLayer?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  invokerId?: string | null;
  invokerType?: string | null;
  providerId?: string | null;
  providerType?: string | null;
  routeSource?: string | null;
  statusCode?: number | null;
  attempts?: number | null;
  maxRetries?: number | null;
  messageCount?: number | null;
  finishReason?: string | null;
  phase?: string | null;
  phaseStatus?: string | null;
  pathId?: string | null;
  sourceConversationId?: string | null;
  triggerSource?: string | null;
  metadata?: string;
  durationMs: number;
  createdAt: string;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
}

interface PromptLog {
  id: string;
  agentId: string;
  systemPromptVersion?: number | null;
  promptDrift?: boolean;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs: number;
  pipelineRunId?: string | null;
  pipelineStepIndex?: number | null;
  traceId?: string | null;
  parentExecutionId?: string | null;
  createdAt: string;
}

// 状态
const loading = ref(false);
const loadError = ref('');
const logs = ref<Log[]>([]);
const filterExpanded = ref(typeof window === 'undefined' || window.innerWidth > 768);
const pagination = reactive<Pagination>({
  total: 0,
  page: 1,
  limit: 20
});
const stats = reactive({
  total: 0,
  success: 0,
  error: 0,
  timeout: 0,
  bySource: { user: 0, test: 0, admin: 0, platform: 0 }
});
// 服务端是否返回了全量统计；未返回时高亮区显示 '--'，不用当前页数据冒充全量
const statsAvailable = ref(false);

// 筛选器
const filters = reactive({
  agentName: '',
  agentId: '',
  traceId: '',
  sessionId: '',
  status: '',
  sourceEntry: '',
  timeRange: 'today',
  timeRangeExact: null as [string, string] | null,
  keyword: ''
});

const activeFilterCount = computed(() => [
  filters.agentName,
  filters.agentId,
  filters.traceId,
  filters.sessionId,
  filters.status,
  filters.sourceEntry,
  filters.timeRange !== 'today' ? filters.timeRange : '',
  filters.timeRangeExact,
  filters.keyword,
].filter(Boolean).length);

// 时间快捷选项
const timeShortcuts = [
  { text: '最近15分钟', value: () => { const now = new Date(); return [new Date(now.getTime() - 15 * 60 * 1000).toISOString(), now.toISOString()]; } },
  { text: '最近1小时', value: () => { const now = new Date(); return [new Date(now.getTime() - 60 * 60 * 1000).toISOString(), now.toISOString()]; } },
  { text: '最近3小时', value: () => { const now = new Date(); return [new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(), now.toISOString()]; } },
  { text: '今天', value: () => { const now = new Date(); const start = new Date(now.setHours(0,0,0,0)); return [start.toISOString(), now.toISOString()]; } },
];

// 选项
const agentOptions = ref<Array<{ label: string; value: string }>>([
  { label: '需求收集', value: 'RequirementCollection' },
  { label: '路径规划', value: 'PathPlanning' },
  { label: '教学执行', value: 'Teaching' },
  { label: '教学编排', value: 'TeachingOrchestration' },
  { label: '伴学介入', value: 'LearningCompanion' },
  { label: '课后产出', value: 'SessionWrapup' }
]);

// 自动刷新
const autoRefresh = ref(false);
const refreshInterval = ref(5);
let refreshTimer: ReturnType<typeof setInterval> | null = null;
// 请求 in-flight 标志：自动刷新 tick 遇到上一次请求未结束时跳过，避免慢请求重叠乱序写 logs
let loadInFlight = false;
// 请求序号：仅最新一次请求允许写回结果，丢弃乱序到达的过期响应
let loadSeq = 0;

const executionHighlights = computed(() => {
  if (!statsAvailable.value) {
    return [
      { label: '-- 条日志', tone: 'info' as const },
      { label: '成功 --%', tone: 'neutral' as const },
      { label: '失败 -- 条', tone: 'neutral' as const },
      { label: '超时 -- 条', tone: 'neutral' as const }
    ];
  }
  return [
    { label: `${formatNumber(stats.total)} 条日志`, tone: 'info' as const },
    { label: `成功 ${calculatePercent(stats.success, stats.total)}%`, tone: 'success' as const },
    { label: `失败 ${formatNumber(stats.error)} 条`, tone: stats.error > 0 ? 'danger' as const : 'neutral' as const },
    { label: `超时 ${formatNumber(stats.timeout)} 条`, tone: stats.timeout > 0 ? 'warning' as const : 'neutral' as const }
  ];
});

// 详情抽屉
const drawerVisible = ref(false);
const selectedLog = ref<Log | null>(null);
const activeTab = ref('basic');
const promptLogsLoading = ref(false);
const promptLogs = ref<PromptLog[]>([]);
const route = useRoute();
const router = useRouter();

const promptLogStats = computed(() => ({
  total: promptLogs.value.length,
  success: promptLogs.value.filter((item) => item.success).length,
  error: promptLogs.value.filter((item) => !item.success).length,
  drift: promptLogs.value.filter((item) => item.promptDrift).length,
}));

// 加载日志
const loadLogs = async (options?: { skipIfInFlight?: boolean }) => {
  if (options?.skipIfInFlight && loadInFlight) return;
  loadInFlight = true;
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = '';
  try {
    const params: Record<string, string | number> = {
      page: pagination.page,
      limit: pagination.limit
    };

if (filters.agentName) params.agentName = filters.agentName;
    if (filters.agentId) params.agentId = filters.agentId;
    if (filters.traceId) params.traceId = filters.traceId;
    if (filters.sessionId) params.sessionId = filters.sessionId;
    if (filters.status) params.status = filters.status;
    if (filters.sourceEntry) params.sourceEntry = filters.sourceEntry;
    if (filters.timeRangeExact && filters.timeRangeExact[0]) {
      params.startTime = filters.timeRangeExact[0];
      params.endTime = filters.timeRangeExact[1];
    } else if (filters.timeRange) {
      params.timeRange = filters.timeRange;
    }
    if (filters.keyword) params.keyword = filters.keyword;

    const response = await adminAxios.get('/admin/agents/logs', { params });

    // 已有更新的请求发出，当前响应已过期，直接丢弃避免乱序覆盖
    if (seq !== loadSeq) return;

    if (response.data.success) {
      logs.value = response.data.data.logs;
      pagination.total = response.data.data.pagination.total;

      const serverStats = response.data.data.stats;
      if (serverStats) {
        statsAvailable.value = true;
        stats.total = serverStats.total || 0;
        stats.success = serverStats.success || 0;
        stats.error = serverStats.error || 0;
        stats.timeout = serverStats.timeout || 0;
        if (serverStats.bySource) {
          stats.bySource = serverStats.bySource;
        }
      } else {
        // 服务端未返回全量统计：不回退用当前页数据冒充，高亮区显示 '--'
        statsAvailable.value = false;
        stats.total = 0;
        stats.success = 0;
        stats.error = 0;
        stats.timeout = 0;
      }
    }
  } catch (error) {
    console.error('加载日志失败:', error);
    if (seq === loadSeq) {
      loadError.value = '无法获取日志数据，请检查服务连接后重试。';
    }
  } finally {
    // 仅最新一次请求负责复位状态位，过期请求直接退出，避免提前放行新的 tick
    if (seq === loadSeq) {
      loading.value = false;
      loadInFlight = false;
    }
  }
};

const getAgentDisplayName = (name: string) => {
  const map: Record<string, string> = {
    'goal-conversation-agent': '目标对话',
    'path-agent': '学习路径规划',
    'path-orchestrator': '路径编排',
    'ai-teaching-agent': 'AI 授课',
    'learner-model-agent': '学习者模型',
    'learner-orchestrator': '学习者编排器',
    'content-generator': '内容生成',
    'peer-agent': '伴学介入(旧ID)',
    'skill:peer-reinforcement': '伴学介入',
    'session-wrapup-agent': '课后产出',
    'path-scene-framing': '路径场景收敛',
    'stage-designer': '阶段任务设计器',
    'RequirementCollection': '需求收集',
    'PathPlanning': '路径规划',
    'Teaching': '教学执行',
    'TeachingOrchestration': '教学编排',
    'LearningCompanion': '伴学介入',
    'SessionWrapup': '课后产出',
    'ai-teaching': '教学编排'
  };
  return map[name] || name;
};

// 搜索
const handleSearch = () => {
  pagination.page = 1;
  loadLogs();
};

// 重置
const handleReset = () => {
  filters.agentName = '';
  filters.agentId = '';
  filters.traceId = '';
  filters.sessionId = '';
  filters.status = '';
  filters.sourceEntry = '';
  filters.timeRange = 'today';
  filters.timeRangeExact = null;
  filters.keyword = '';
  pagination.page = 1;
  loadLogs();
};

// 分页
const handlePageChange = (page: number) => {
  pagination.page = page;
  loadLogs();
};

const handleSizeChange = (size: number) => {
  pagination.limit = size;
  pagination.page = 1;
  loadLogs();
};

// 显示详情
const showDetail = (log: Log) => {
  selectedLog.value = log;
  activeTab.value = 'basic';
  drawerVisible.value = true;
  void loadPromptLogs(log);
};

const buildPromptLogQuery = (log: Pick<Log, 'id' | 'agentId' | 'pathId' | 'traceId' | 'actorType' | 'executionLayer'> | null | undefined) => {
  const query: Record<string, string> = {};
  if (!log) return query;
  if (log.actorType === 'skill' || log.executionLayer === 'skill') {
    query.parentExecutionId = log.id;
  }
  if (log.traceId) query.traceId = log.traceId;
  if (log.agentId) query.agentId = log.agentId;
  if (log.pathId) query.pathId = log.pathId;
  return query;
};

const canOpenPromptLogs = (log: Pick<Log, 'id' | 'agentId' | 'pathId' | 'traceId' | 'actorType' | 'executionLayer'> | null | undefined) => {
  return Object.keys(buildPromptLogQuery(log)).length > 0;
};

const openPromptLogs = (log: Pick<Log, 'id' | 'agentId' | 'pathId' | 'traceId' | 'actorType' | 'executionLayer'>) => {
  const query = buildPromptLogQuery(log);
  router.push({ path: '/admin/prompt-call-logs', query });
};

const loadPromptLogs = async (log: Pick<Log, 'id' | 'agentId' | 'pathId' | 'traceId' | 'actorType' | 'executionLayer'>) => {
  const query = buildPromptLogQuery(log);
  if (!Object.keys(query).length) {
    promptLogs.value = [];
    return;
  }

  promptLogsLoading.value = true;
  try {
    const response = await adminRuntimeDefinitionsApi.getPromptCallLogs({
      limit: 20,
      agentId: query.agentId,
      pathId: query.pathId,
      traceId: query.traceId,
      parentExecutionId: query.parentExecutionId,
    });
    promptLogs.value = response.data?.data || [];
  } catch {
    promptLogs.value = [];
    toast.error('加载 Prompt 子日志失败');
  } finally {
    promptLogsLoading.value = false;
  }
};

// 复制到剪贴板
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    toast.success('已复制到剪贴板');
  }).catch(() => {
    toast.error('复制失败');
  });
};

// 导出详情
const exportDetail = () => {
  if (!selectedLog.value) return;

  const blob = new Blob([JSON.stringify(selectedLog.value, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `log-${selectedLog.value.id}.json`;
  link.click();
  URL.revokeObjectURL(url);

  toast.success('导出成功');
};

// 导出当前页
const handleExport = () => {
  const blob = new Blob([JSON.stringify(logs.value, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `agent-logs-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);

  toast.success('导出成功');
};

// 格式化
const formatNumber = (num: number) => {
  return num.toLocaleString();
};

const calculatePercent = (part: number, total: number) => {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
};

const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }
  
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatJson = (json: string) => {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
};

const highlightJson = (json: string): string => {
  if (!json) return '';
  // 先做 HTML 转义，防止日志内容（含用户输入）注入标签造成存储型 XSS
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="json-bool">$1</span>');
};

const describePromptLogIssue = (log: PromptLog) => {
  if (log.success) {
    if (log.promptDrift) return '执行成功，但运行版本存在漂移。';
    return '';
  }
  if (log.errorMessage) return '';
  if (log.errorCode) return `失败，错误码 ${log.errorCode}`;
  return '失败。';
};

const getLogStatusText = (status: string) => {
  const map: Record<string, string> = {
    success: '成功',
    error: '失败',
    timeout: '超时'
  };
  return map[status] || status;
};

const getSourceLabel = (source?: string) => {
  const map: Record<string, string> = {
    user: '用户侧',
    test: '测试站点',
    admin: 'Admin',
    platform: '平台',
    arena: 'Arena',
    lab: '实验室'
  };
  return map[source || ''] || '平台';
};

const getExecutionLayerLabel = (layer?: string | null) => {
  const map: Record<string, string> = {
    orchestrator: '编排层',
    agent: 'Agent 层',
    skill: 'Skill 层',
    'api-gateway': '网关层',
    service: '服务层',
    system: '系统层'
  };
  return map[layer || ''] || (layer || '未知层');
};

const getActorTypeLabel = (actorType?: string | null) => {
  const map: Record<string, string> = {
    agent: 'Agent',
    skill: 'Skill',
    orchestrator: '编排器',
    system: '系统'
  };
  return map[actorType || ''] || (actorType || '未知主体');
};

const getInvokerLabel = (log: Pick<Log, 'invokerType' | 'invokerId'>) => {
  if (!log.invokerId) return '直接触发';
  const prefix = log.invokerType === 'agent'
    ? 'Agent'
    : log.invokerType === 'skill'
      ? 'Skill'
      : log.invokerType === 'orchestrator'
        ? '编排器'
        : '发起方';
  return `${prefix}: ${log.invokerId}`;
};

// 自动刷新
const stopAutoRefreshTimer = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

const startAutoRefreshTimer = () => {
  stopAutoRefreshTimer();
  if (document.hidden) return;
  refreshTimer = setInterval(() => {
    if (document.hidden) return;
    loadLogs({ skipIfInFlight: true });
  }, refreshInterval.value * 1000);
};

// 页面隐藏时暂停轮询，回到前台时恢复并立即补一次刷新
const handleVisibilityChange = () => {
  if (document.hidden) {
    stopAutoRefreshTimer();
  } else if (autoRefresh.value) {
    startAutoRefreshTimer();
    loadLogs({ skipIfInFlight: true });
  }
};

watch(autoRefresh, (value) => {
  if (value) {
    startAutoRefreshTimer();
  } else {
    stopAutoRefreshTimer();
  }
});

onMounted(() => {
  const queryAgentName = String(route.query.agentName || '');
  const queryAgentId = String(route.query.agentId || '');
  if (queryAgentName) {
    filters.agentName = queryAgentName;
  }
  if (queryAgentId) {
    filters.agentId = queryAgentId;
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);
  loadLogs();
});

onUnmounted(() => {
  stopAutoRefreshTimer();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<style scoped>
.execution-logs-page {
  position: relative;
  gap: 14px;
}

.stats-summary-button {
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: transform var(--admin-transition-fast), box-shadow var(--admin-transition-fast), border-color var(--admin-transition-fast);
}

.stats-summary-button:hover {
  transform: translateY(-1px);
  border-color: rgba(52, 120, 246, 0.18);
}

.stats-summary-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.filter-select,
.filter-input,
.search-input,
.time-picker {
  width: 100%;
}

.search-item {
  min-width: 0;
}

.filter-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.filter-toggle {
  display: none;
}

.admin-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.logs-shell {
  display: grid;
  gap: 14px;
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
}

.logs-shell__head {
  margin-bottom: 0;
}

.logs-shell__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.logs-shell__count {
  color: var(--admin-text-primary);
  font-size: 12px;
  font-weight: 700;
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 精简日志卡片 */
.log-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--admin-bg-surface);
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-sm);
  cursor: pointer;
  transition: transform var(--admin-transition-fast), border-color var(--admin-transition-fast);
}

.log-card:hover {
  transform: translateY(-1px);
  border-color: var(--admin-border-hover);
}

.log-card:focus-visible {
  border-color: var(--admin-text-brand);
  box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.12);
}

.log-card__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 6px;
}

.log-card__primary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.log-card__time {
  font-size: 13px;
  color: var(--admin-text-secondary);
  font-family: var(--admin-font-mono);
  font-weight: 500;
  min-width: 80px;
}

.log-card__agent {
  font-size: 14px;
  font-weight: 600;
  color: var(--admin-text-primary);
}

.log-card__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.log-card__status-dot--success {
  background: var(--admin-color-success);
  box-shadow: 0 0 0 3px var(--admin-color-success-bg);
}

.log-card__status-dot--error {
  background: var(--admin-color-error);
  box-shadow: 0 0 0 3px var(--admin-color-error-bg);
}

.log-card__status-dot--timeout {
  background: var(--admin-color-warning);
  box-shadow: 0 0 0 3px var(--admin-color-warning-bg);
}

.log-card__secondary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.log-card__meta {
  font-size: 12px;
  color: var(--admin-text-muted);
  font-family: var(--admin-font-mono);
}

.log-card__aside {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.log-card__duration {
  font-size: 13px;
  color: var(--admin-text-secondary);
  font-family: var(--admin-font-mono);
  font-weight: 500;
  min-width: 60px;
  text-align: right;
}

.log-card__action {
  font-size: 13px;
}

/* 分页 */
.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 8px;
  padding-top: 14px;
  border-top: var(--admin-border-subtle);
}

/* Drawer 样式 */
.drawer-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.drawer-hero {
  padding-bottom: 20px;
  border-bottom: var(--admin-border-subtle);
}

.drawer-hero__status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.drawer-hero__status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.drawer-hero__status-dot--success {
  background: var(--admin-color-success);
}

.drawer-hero__status-dot--error {
  background: var(--admin-color-error);
}

.drawer-hero__status-dot--timeout {
  background: var(--admin-color-warning);
}

.drawer-hero__status-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.drawer-hero__title {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--admin-text-primary);
  line-height: 1.2;
}

.drawer-hero__subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--admin-text-secondary);
  font-family: var(--admin-font-mono);
}

.drawer-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  min-width: 0;
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
}

.prompt-child-panel {
  display: grid;
  gap: 14px;
}

.prompt-child-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.prompt-child-summary-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 12px;
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface-alt);
}

.prompt-child-summary-card__label {
  font-size: 12px;
  color: var(--admin-text-muted);
}

.prompt-child-summary-card strong {
  font-size: 22px;
  color: var(--admin-text-primary);
}

.prompt-child-list {
  display: grid;
  gap: 10px;
}

.prompt-child-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px;
  border-radius: 12px;
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface);
}

.prompt-child-card__head,
.prompt-child-card__meta,
.prompt-child-card__submeta {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.prompt-child-card__head {
  justify-content: space-between;
}

.prompt-child-card__submeta,
.prompt-child-card__duration,
.prompt-child-card__version {
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.prompt-child-card__issue {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: 13px;
}

.prompt-child-card__error {
  color: var(--admin-color-error);
  font-size: 12px;
}

.drawer-overview-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-sm);
}

.drawer-overview-item__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--admin-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.drawer-overview-item__value {
  font-size: 14px;
  font-weight: 600;
  color: var(--admin-text-primary);
  word-break: break-word;
}

.drawer-tabs {
  margin-top: 0;
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
  min-width: 0;
}

.drawer-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.drawer-descriptions :deep(.el-descriptions__cell) {
  min-width: 0;
  overflow-wrap: anywhere;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 16px;
  border-top: var(--admin-border-subtle);
}

.drawer-code-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.drawer-code-block {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: var(--admin-bg-surface-alt);
  color: var(--admin-text-primary);
  padding: 16px;
  font-family: var(--admin-font-mono);
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: var(--admin-radius-md);
  border: var(--admin-border);
}

@media (max-width: 920px) {
  .drawer-descriptions :deep(.el-descriptions__table) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .drawer-descriptions :deep(.el-descriptions__cell) {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
  }
}

.drawer-code-block--input {
  background: var(--admin-color-info-bg);
  border-color: var(--admin-color-info);
}

.drawer-code-block--output {
  background: var(--admin-color-success-bg);
  border-color: var(--admin-color-success);
}

.drawer-code-block--error {
  background: var(--admin-color-error-bg);
  border-color: var(--admin-color-error);
  color: var(--admin-color-error);
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 状态点 */
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}

.status-dot.success {
  background: var(--admin-color-success);
}

.status-dot.error {
  background: var(--admin-color-error);
}

.status-dot.warning {
  background: var(--admin-color-warning);
}

.time-picker {
  width: 280px;
}

.json-key {
  color: var(--admin-color-info);
  font-weight: 600;
}

.json-string {
  color: var(--admin-color-success);
}

.json-number {
  color: #8b5cf6;
}

.json-bool {
  color: var(--admin-color-warning);
}

@media (max-width: 768px) {
  .filter-toggle {
    display: inline-flex;
  }

  .admin-error-row {
    align-items: stretch;
    flex-direction: column;
  }

  .log-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .log-card__aside {
    width: 100%;
    justify-content: space-between;
  }

  .log-card__primary {
    flex-wrap: wrap;
  }

  .filter-actions {
    width: 100%;
  }

  .filter-actions .el-button {
    flex: 1;
  }

  .drawer-overview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
