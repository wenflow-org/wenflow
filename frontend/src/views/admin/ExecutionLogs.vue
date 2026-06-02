<template>
  <div class="execution-logs-page">
    <div class="page-hero">
      <h2 class="page-hero__title">
        <el-icon class="title-icon"><Cpu /></el-icon>
        运行执行日志
      </h2>
      <p class="page-hero__subtitle">查看运行节点的真实执行链路：从哪里触发、执行是否成功、输入输出是什么，以及是否需要继续下钻到 Prompt 调用日志。</p>
    </div>

    <!-- 统计信息 -->
    <div class="stats-bar" v-if="pagination.total > 0">
      <div class="stat-item">
        <span class="stat-label">总日志数</span>
        <span class="stat-value">{{ formatNumber(stats.total) }}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item success" @click="setFilter('status', 'success')">
        <span class="stat-dot success"></span>
        <span class="stat-label">成功</span>
        <span class="stat-value">{{ formatNumber(stats.success) }}</span>
        <span class="stat-percent">({{ calculatePercent(stats.success, stats.total) }}%)</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item error" @click="setFilter('status', 'error')">
        <span class="stat-dot error"></span>
        <span class="stat-label">失败</span>
        <span class="stat-value">{{ formatNumber(stats.error) }}</span>
        <span class="stat-percent">({{ calculatePercent(stats.error, stats.total) }}%)</span>
      </div>
      <div class="stat-divider"></div>
<div class="stat-item warning" @click="setFilter('status', 'timeout')">
          <span class="stat-dot warning"></span>
          <span class="stat-label">超时</span>
          <span class="stat-value">{{ formatNumber(stats.timeout) }}</span>
          <span class="stat-percent">({{ calculatePercent(stats.timeout, stats.total) }}%)</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item user" @click="setFilter('sourceEntry', 'user')">
          <span class="stat-dot user"></span>
          <span class="stat-label">用户侧</span>
          <span class="stat-value">{{ stats.bySource?.user || 0 }}</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item test" @click="setFilter('sourceEntry', 'test')">
          <span class="stat-dot test"></span>
          <span class="stat-label">测试站点</span>
          <span class="stat-value">{{ stats.bySource?.test || 0 }}</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item admin" @click="setFilter('sourceEntry', 'admin')">
          <span class="stat-dot admin"></span>
          <span class="stat-label">Admin</span>
          <span class="stat-value">{{ stats.bySource?.admin || 0 }}</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item platform" @click="setFilter('sourceEntry', 'platform')">
          <span class="stat-dot platform"></span>
          <span class="stat-label">平台</span>
          <span class="stat-value">{{ stats.bySource?.platform || 0 }}</span>
        </div>
      </div>

    <!-- 筛选器 -->
    <div class="filter-section">
      <div class="filter-section__intro">
        <div>
          <h3>链路筛选</h3>
          <p>先按节点、Trace、会话、来源和状态收窄问题范围，再查看单次执行详情。</p>
        </div>
      </div>
      <div class="filter-row">
        <div class="filter-item">
          <label>Agent</label>
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

        <div class="filter-item">
          <label>Agent ID</label>
          <el-input
            v-model="filters.agentId"
            placeholder="如 ai-teaching-agent"
            clearable
            class="filter-input"
          />
        </div>

        <div class="filter-item">
          <label>Trace ID</label>
          <el-input
            v-model="filters.traceId"
            placeholder="链路追踪 ID"
            clearable
            class="filter-input"
          />
        </div>

        <div class="filter-item">
          <label>Session ID</label>
          <el-input
            v-model="filters.sessionId"
            placeholder="学习会话 ID"
            clearable
            class="filter-input"
          />
        </div>

        <div class="filter-item">
          <label>状态</label>
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

        <div class="filter-item">
          <label>来源</label>
          <el-select v-model="filters.sourceEntry" placeholder="全部来源" clearable class="filter-select">
            <el-option label="用户侧" value="user" />
            <el-option label="测试站点" value="test" />
            <el-option label="Admin 后台" value="admin" />
            <el-option label="平台内部" value="platform" />
          </el-select>
        </div>

        <div class="filter-item">
          <label>精确时间</label>
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

        <div class="filter-item search-item">
          <label>搜索</label>
          <el-input
            v-model="filters.keyword"
            placeholder="搜索输入/输出/错误..."
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
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-checkbox v-model="autoRefresh" size="small">
          自动刷新 ({{ refreshInterval }}s)
        </el-checkbox>
      </div>
      <div class="toolbar-right">
        <el-button type="default" size="small" @click="handleExport">
          <el-icon><Download /></el-icon>
          导出当前页
        </el-button>
      </div>
    </div>

    <!-- 日志列表 -->
    <div class="logs-list" v-loading="loading">
      <div
        v-for="log in logs"
        :key="log.id"
        class="log-card"
        :class="{ 'log-error': log.status === 'error', 'log-timeout': log.status === 'timeout' }"
      >
        <div class="log-header">
          <div class="log-meta">
            <span class="log-time">{{ formatDateTime(log.createdAt) }}</span>
            <el-tag size="small" :type="getSourceTagType(log.sourceEntry)" effect="plain">
              {{ getSourceLabel(log.sourceEntry) }}
            </el-tag>
            <el-tag size="small" :type="getExecutionLayerTagType(log.executionLayer)" effect="plain">
              {{ getExecutionLayerLabel(log.executionLayer) }}
            </el-tag>
            <el-tag size="small" :type="getActorTypeTagType(log.actorType)" effect="plain">
              {{ getActorTypeLabel(log.actorType) }}
            </el-tag>
            <el-tag size="small" :type="getAgentTagType(log.agentName)">
              {{ getAgentDisplayName(log.agentName) }}
            </el-tag>
            <el-tag v-if="log.actorId && log.actorId !== log.agentId" size="small" type="info" effect="plain">
              {{ log.actorId }}
            </el-tag>
            <el-tag size="small" :type="getLogStatusType(log.status)">
              <el-icon class="status-icon" v-if="log.status === 'success'"><SuccessFilled /></el-icon>
              <el-icon class="status-icon" v-if="log.status === 'timeout'"><Timer /></el-icon>
              <el-icon class="status-icon" v-if="log.status === 'error' && !log.errorCode"><CircleCloseFilled /></el-icon>
              <el-icon class="status-icon" v-if="log.errorCode === 'NETWORK_ERROR'"><Link /></el-icon>
              <el-icon class="status-icon" v-if="log.errorCode === 'VALIDATION_ERROR'"><WarningFilled /></el-icon>
              <el-icon class="status-icon" v-if="log.errorCode === 'MODEL_ERROR'"><Service /></el-icon>
              {{ getLogStatusText(log.status) }}
            </el-tag>
            <span class="log-action" :class="getActionClass(log.action, log.status)">{{ log.action }}</span>
          </div>
          <div class="log-duration">
            <el-icon><Timer /></el-icon>
            {{ formatDuration(log.durationMs) }}
          </div>
        </div>

        <div class="log-preview">
          <div class="preview-row" v-if="log.input">
            <span class="preview-label">输入:</span>
            <pre class="preview-content">{{ truncateJson(log.input, 250) }}</pre>
          </div>
          <div class="preview-row" v-if="log.output && log.status === 'success'">
            <span class="preview-label">输出:</span>
            <pre class="preview-content">{{ truncateJson(log.output, 250) }}</pre>
          </div>
          <div class="preview-row error" v-if="log.error">
            <span class="preview-label">错误:</span>
            <span class="preview-content">{{ log.error }}</span>
          </div>
          <div class="preview-row preview-row--hint" v-if="log.pathId || log.phase || log.triggerSource">
            <span class="preview-label">摘要:</span>
            <span class="preview-chip" v-if="log.pathId">路径 {{ log.pathId }}</span>
            <span class="preview-chip" v-if="log.phase">阶段 {{ log.phase }}<template v-if="log.phaseStatus"> / {{ log.phaseStatus }}</template></span>
            <span class="preview-chip" v-if="log.triggerSource">触发 {{ log.triggerSource }}</span>
          </div>
          <div class="preview-row" v-if="log.traceId">
            <span class="preview-label">Trace:</span>
            <el-button type="primary" link size="small" class="trace-link" @click="filterByTraceId(log.traceId)">
              {{ log.traceId }}
            </el-button>
          </div>
            <div class="preview-row" v-if="log.sessionId">
              <span class="preview-label">Session:</span>
              <span class="preview-content">{{ log.sessionId }}</span>
            </div>
            <div class="preview-row" v-if="log.invokerId">
              <span class="preview-label">发起:</span>
              <span class="preview-content">{{ getInvokerLabel(log) }}</span>
            </div>
            <div class="preview-row" v-if="log.providerId">
              <span class="preview-label">Provider:</span>
              <span class="preview-content">{{ log.providerId }}</span>
            </div>
          </div>

        <div class="log-actions">
          <el-button type="primary" size="small" @click="showDetail(log)">
            <el-icon><View /></el-icon>
            查看详情
          </el-button>
          <el-button
            v-if="canOpenPromptLogs(log)"
            type="default"
            size="small"
            @click="openPromptLogs(log)"
          >
            Prompt 调用日志
          </el-button>
          <el-button type="default" size="small" @click="copyLog(log)">
            <el-icon><DocumentCopy /></el-icon>
            复制
          </el-button>
        </div>
      </div>

      <!-- 空状态 -->
      <el-empty v-if="!loading && logs.length === 0" description="暂无日志记录" />
    </div>

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

    <!-- 详情弹窗 -->
    <el-dialog
      v-model="detailVisible"
      title="执行详情"
      width="min(90vw, 960px)"
      class="detail-dialog"
      destroy-on-close
    >
      <div v-if="selectedLog" class="detail-content">
        <!-- 基本信息 -->
        <div class="detail-section">
          <h4>基本信息</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <label>时间:</label>
              <span>{{ formatDateTime(selectedLog.createdAt) }}</span>
            </div>
            <div class="detail-item">
              <label>Agent:</label>
              <el-tag size="small" :type="getAgentTagType(selectedLog.agentName)">
                {{ getAgentDisplayName(selectedLog.agentName) }}
              </el-tag>
            </div>
            <div class="detail-item">
              <label>动作:</label>
              <span>{{ selectedLog.action }}</span>
            </div>
            <div class="detail-item">
              <label>状态:</label>
              <el-tag size="small" :type="getLogStatusType(selectedLog.status)">
                {{ getLogStatusText(selectedLog.status) }}
              </el-tag>
            </div>
            <div class="detail-item">
              <label>耗时:</label>
              <span>{{ formatDuration(selectedLog.durationMs) }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.traceId">
              <label>Trace ID:</label>
              <span>{{ selectedLog.traceId }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.sessionId">
              <label>Session ID:</label>
              <span>{{ selectedLog.sessionId }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section">
          <h4>链路信息</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <label>入口来源:</label>
              <span>{{ getSourceLabel(selectedLog.sourceEntry) }}</span>
            </div>
            <div class="detail-item">
              <label>执行层:</label>
              <span>{{ getExecutionLayerLabel(selectedLog.executionLayer) }}</span>
            </div>
            <div class="detail-item">
              <label>主体类型:</label>
              <span>{{ getActorTypeLabel(selectedLog.actorType) }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.actorId">
              <label>主体 ID:</label>
              <span>{{ selectedLog.actorId }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.invokerId">
              <label>发起者:</label>
              <span>{{ getInvokerLabel(selectedLog) }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.providerId">
              <label>Provider:</label>
              <span>{{ selectedLog.providerId }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.routeSource">
              <label>路由来源:</label>
              <span>{{ selectedLog.routeSource }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.statusCode !== null && selectedLog.statusCode !== undefined">
              <label>状态码:</label>
              <span>{{ selectedLog.statusCode }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.attempts !== null && selectedLog.attempts !== undefined">
              <label>尝试次数:</label>
              <span>{{ selectedLog.attempts }}<template v-if="selectedLog.maxRetries"> / {{ selectedLog.maxRetries }}</template></span>
            </div>
            <div class="detail-item" v-if="selectedLog.messageCount !== null && selectedLog.messageCount !== undefined">
              <label>消息数:</label>
              <span>{{ selectedLog.messageCount }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.finishReason">
              <label>Finish Reason:</label>
              <span>{{ selectedLog.finishReason }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.phase">
              <label>阶段:</label>
              <span>{{ selectedLog.phase }}<template v-if="selectedLog.phaseStatus"> / {{ selectedLog.phaseStatus }}</template></span>
            </div>
            <div class="detail-item" v-if="selectedLog.pathId">
              <label>Path ID:</label>
              <span>{{ selectedLog.pathId }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.sourceConversationId">
              <label>Source Conversation:</label>
              <span>{{ selectedLog.sourceConversationId }}</span>
            </div>
            <div class="detail-item" v-if="selectedLog.triggerSource">
              <label>Trigger Source:</label>
              <span>{{ selectedLog.triggerSource }}</span>
            </div>
          </div>
          <div class="detail-inline-actions" v-if="canOpenPromptLogs(selectedLog)">
            <el-button type="primary" size="small" @click="openPromptLogs(selectedLog!)">
              打开 Prompt 调用日志
            </el-button>
          </div>
        </div>

        <!-- 输入 -->
        <div class="detail-section detail-section--input" v-if="selectedLog.input">
          <div class="section-header">
            <h4>
              <el-icon class="section-icon"><DocumentCopy /></el-icon>
              输入数据
            </h4>
            <el-button type="primary" link size="small" @click="copyToClipboard(selectedLog.input)">
              <el-icon><DocumentCopy /></el-icon>
              复制
            </el-button>
          </div>
          <pre class="json-block json-block--input" v-html="highlightJson(formatJson(selectedLog.input))"></pre>
        </div>

        <!-- 输出 -->
        <div class="detail-section detail-section--output" v-if="selectedLog.output && selectedLog.status === 'success'">
          <div class="section-header">
            <h4>
              <el-icon class="section-icon"><SuccessFilled /></el-icon>
              输出结果
            </h4>
            <el-button type="primary" link size="small" @click="copyToClipboard(selectedLog.output)">
              <el-icon><DocumentCopy /></el-icon>
              复制
            </el-button>
          </div>
          <pre class="json-block json-block--output" v-html="highlightJson(formatJson(selectedLog.output))"></pre>
        </div>

        <!-- 错误 -->
        <div class="detail-section detail-section--error" v-if="selectedLog.error">
          <div class="section-header">
            <h4>
              <el-icon class="section-icon"><CircleCloseFilled /></el-icon>
              错误信息
            </h4>
            <el-button type="danger" link size="small" @click="copyToClipboard(selectedLog.error)">
              <el-icon><DocumentCopy /></el-icon>
              复制
            </el-button>
          </div>
          <pre class="error-block">{{ selectedLog.error }}</pre>
        </div>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="exportDetail">
          <el-icon><Download /></el-icon>
          导出 JSON
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import {
  Search,
  Refresh,
  View,
  DocumentCopy,
  Download,
  Timer,
  Cpu,
  SuccessFilled,
  CircleCloseFilled,
  Link,
  WarningFilled,
  Service
} from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { adminAxios } from '@/api/adminApi';
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

// 状态
const loading = ref(false);
const logs = ref<Log[]>([]);
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

// 详情弹窗
const detailVisible = ref(false);
const selectedLog = ref<Log | null>(null);
const route = useRoute();
const router = useRouter();

// 加载日志
const loadLogs = async () => {
  loading.value = true;
  try {
    const params: any = {
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

    const response: any = await adminAxios.get('/admin/agents/logs', { params });

    if (response.data.success) {
      logs.value = response.data.data.logs;
      pagination.total = response.data.data.pagination.total;

      const serverStats = response.data.data.stats;
      if (serverStats) {
        stats.total = serverStats.total || 0;
        stats.success = serverStats.success || 0;
        stats.error = serverStats.error || 0;
        stats.timeout = serverStats.timeout || 0;
        if (serverStats.bySource) {
          stats.bySource = serverStats.bySource;
        }
      } else {
        stats.total = pagination.total;
        stats.success = logs.value.filter(l => l.status === 'success').length;
        stats.error = logs.value.filter(l => l.status === 'error').length;
        stats.timeout = logs.value.filter(l => l.status === 'timeout').length;
      }
    }
  } catch (error) {
    console.error('加载日志失败:', error);
    toast.error('加载日志失败');
  } finally {
    loading.value = false;
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

// 设置筛选
const setFilter = (key: string, value: string) => {
  (filters as any)[key] = value;
  handleSearch();
};

// 通过 Trace ID 筛选
const filterByTraceId = (traceId: string) => {
  filters.traceId = traceId;
  handleSearch();
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
  detailVisible.value = true;
};

const canOpenPromptLogs = (log: Pick<Log, 'agentId' | 'pathId'> | null | undefined) => {
  if (!log) return false;
  return Boolean(log.agentId || log.pathId);
};

const openPromptLogs = (log: Pick<Log, 'agentId' | 'pathId'>) => {
  const query: Record<string, string> = {};
  if (log.agentId) query.agentId = log.agentId;
  if (log.pathId) query.pathId = log.pathId;
  router.push({ path: '/admin/prompt-call-logs', query });
};

// 复制日志
const copyLog = (log: Log) => {
  const text = JSON.stringify(log, null, 2);
  copyToClipboard(text);
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

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const truncateJson = (json: string, maxLength: number) => {
  try {
    const obj = JSON.parse(json);
    const str = JSON.stringify(obj, null, 2);
    if (str.length <= maxLength) return str;
    const lines = str.split('\n');
    let result = '';
    let currentLength = 0;
    for (const line of lines) {
      if (currentLength + line.length + 1 > maxLength) break;
      result += line + '\n';
      currentLength += line.length + 1;
    }
    return result.trim() + '...';
  } catch {
    return json.substring(0, maxLength) + '...';
  }
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
  return json
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="json-bool">$1</span>');
};

// 日志状态样式
const getLogStatusType = (status: string) => {
  const map: Record<string, any> = {
    success: 'success',
    error: 'danger',
    timeout: 'warning'
  };
  return map[status] || 'info';
};

const getLogStatusText = (status: string) => {
  const map: Record<string, string> = {
    success: '成功',
    error: '失败',
    timeout: '超时'
  };
  return map[status] || status;
};

const getAgentTagType = (agentName: string) => {
  const map: Record<string, any> = {
    RequirementCollection: 'success',
    PathPlanning: 'primary',
    'path-orchestrator': 'warning',
    'path-scene-framing': 'success',
    'stage-designer': 'success',
    Teaching: 'warning',
    TeachingOrchestration: 'warning',
    'ai-teaching': 'warning',
    'ai-teaching-agent': 'warning',
    LearningCompanion: 'info',
    SessionEvaluation: 'primary',
    Summary: 'success'
  };
  return map[agentName] || 'info';
};

const getSourceTagType = (source?: string) => {
  const map: Record<string, any> = {
    user: 'primary',
    test: '',
    admin: 'warning',
    platform: 'info'
  };
  return map[source || ''] || 'info';
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

const getExecutionLayerTagType = (layer?: string | null) => {
  const map: Record<string, any> = {
    orchestrator: 'warning',
    agent: 'primary',
    skill: 'success',
    'api-gateway': 'info',
    service: '',
    system: 'info'
  };
  return map[layer || ''] || 'info';
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

const getActorTypeTagType = (actorType?: string | null) => {
  const map: Record<string, any> = {
    agent: 'primary',
    skill: 'success',
    orchestrator: 'warning',
    system: 'info'
  };
  return map[actorType || ''] || 'info';
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

const getActionClass = (action: string, status?: string) => {
  if (status === 'error') return 'log-action--error';
  if (status === 'timeout') return 'log-action--timeout';
  if (action === 'invoke' || action.includes('invoke')) return 'log-action--invoke';
  if (action.includes('plan') || action.includes('generate')) return 'log-action--create';
  return '';
};

// 自动刷新
watch(autoRefresh, (value) => {
  if (value) {
    refreshTimer = setInterval(() => {
      loadLogs();
    }, refreshInterval.value * 1000);
  } else {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
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
  loadLogs();
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.execution-logs-page {
  padding: 0;
  position: relative;
}

/* Background orbs */
/* Hero */
.page-hero {
  position: relative;
  z-index: 1;
  padding: 18px 22px;
  border-radius: 22px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94));
  margin-bottom: 12px;
  box-shadow: 0 12px 30px rgba(42, 72, 128, 0.06);
}

.page-hero__title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-hero__subtitle {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
}

.title-icon {
  font-size: 1.75rem;
}

/* 统计栏 */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(246, 249, 255, 0.95));
  border-radius: 20px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  margin-bottom: 1rem;
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
  position: relative;
  z-index: 1;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.stat-item:hover {
  background: var(--bg-muted);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.stat-value {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-percent {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.stat-divider {
  width: 1px;
  height: 24px;
  background: var(--border-default);
}

.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stat-dot.success {
  background: var(--color-success);
}

.stat-dot.error {
  background: var(--color-danger);
}

.stat-dot.warning {
  background: var(--color-accent);
}

.stat-dot.user {
  background: #3b82f6;
}

.stat-dot.test {
  background: #8b5cf6;
}

.stat-dot.admin {
  background: #f59e0b;
}

.stat-dot.platform {
  background: #6b7280;
}

.stat-item.user:hover {
  background: rgba(59, 130, 246, 0.1);
}

.stat-item.test:hover {
  background: rgba(139, 92, 246, 0.1);
}

.stat-item.admin:hover {
  background: rgba(245, 158, 11, 0.1);
}

.stat-item.platform:hover {
  background: rgba(107, 114, 128, 0.1);
}

/* 筛选器 */
.filter-section {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 255, 0.92));
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  margin-bottom: 1rem;
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
  position: relative;
  z-index: 1;
}

.filter-section__intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.filter-section__intro h3 {
  margin: 0;
  font-size: 1rem;
  color: #22344d;
}

.filter-section__intro p {
  margin: 6px 0 0;
  color: #7085a6;
  font-size: 0.875rem;
  line-height: 1.6;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-end;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.filter-item label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.filter-select {
  width: 160px;
}

.filter-input {
  width: 180px;
}

.search-item {
  flex: 1;
  min-width: 200px;
}

.search-input {
  width: 100%;
}

.filter-actions {
  display: flex;
  gap: 0.5rem;
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  position: relative;
  z-index: 1;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

/* 日志列表 */
.logs-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  position: relative;
  z-index: 1;
}

.log-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(247, 250, 255, 0.95));
  border-radius: 18px;
  padding: 1rem;
  box-shadow: 0 10px 22px rgba(42, 72, 128, 0.05);
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-left: 4px solid transparent;
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
}

.log-card:hover {
  box-shadow: 0 14px 28px rgba(42, 72, 128, 0.08);
}

.log-card.log-error {
  border-left-color: var(--color-danger);
  box-shadow: inset 3px 0 12px -4px rgba(239, 68, 68, 0.25);
}

.log-card.log-timeout {
  border-left-color: var(--color-accent);
  box-shadow: inset 3px 0 12px -4px rgba(245, 158, 11, 0.25);
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.log-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.log-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: monospace;
}

.log-action {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: var(--bg-muted);
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-weight: 500;
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.log-action--invoke {
  color: var(--color-primary);
  background: rgba(52, 120, 246, 0.08);
  border-color: rgba(52, 120, 246, 0.2);
}

.log-action--error {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
}

.log-action--timeout {
  color: var(--color-accent);
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.2);
}

.log-action--create {
  color: var(--color-success);
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.2);
}

.log-duration {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.log-preview {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
}

.preview-row {
  display: flex;
  gap: 0.5rem;
  font-size: 0.8125rem;
  align-items: flex-start;
}

.preview-row .preview-label {
  flex-shrink: 0;
  padding-top: 0.5rem;
}

.preview-row .preview-content {
  flex: 1;
  min-width: 0;
}

.preview-row.error {
  color: var(--color-danger);
}

.preview-row--hint {
  flex-wrap: wrap;
  gap: 8px;
}

.preview-label {
  color: var(--text-secondary);
  font-weight: 500;
  flex-shrink: 0;
}

.preview-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #2f65d9;
  font-size: 12px;
  font-weight: 600;
}

.preview-content {
  color: var(--text-primary);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.8125rem;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  max-height: 100px;
  background: var(--bg-subtle);
  padding: 0.5rem;
  border-radius: 4px;
  margin: 0;
}

.log-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* 分页 */
.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-default);
  position: relative;
  z-index: 1;
}

/* 详情弹窗 */
.detail-content {
  max-height: 600px;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 1.5rem;
  border-radius: 12px;
  overflow: hidden;
}

.detail-section--input {
  background: rgba(52, 120, 246, 0.03);
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.detail-section--output {
  background: rgba(16, 185, 129, 0.03);
  border: 1px solid rgba(16, 185, 129, 0.1);
}

.detail-section--error {
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.detail-section h4 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.detail-section--input h4 {
  color: var(--color-primary);
}

.detail-section--output h4 {
  color: var(--color-success);
}

.detail-section--error h4 {
  color: var(--color-danger);
}

.section-icon {
  font-size: 1.125rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.6);
  border-bottom: 1px solid rgba(52, 120, 246, 0.06);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  background: var(--bg-subtle);
  padding: 1rem;
  border-radius: 6px;
}

.detail-item {
  display: flex;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.detail-item label {
  color: var(--text-secondary);
  font-weight: 500;
}

.detail-inline-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.json-block,
.error-block {
  background: var(--bg-subtle);
  color: var(--text-primary);
  padding: 1rem;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.json-block--input {
  background: rgba(52, 120, 246, 0.02);
  border-top: 1px solid rgba(52, 120, 246, 0.06);
}

.json-block--output {
  background: rgba(16, 185, 129, 0.02);
  border-top: 1px solid rgba(16, 185, 129, 0.06);
}

.error-block {
  background: rgba(239, 68, 68, 0.08);
  color: var(--color-danger-dark);
  border-top: 1px solid rgba(239, 68, 68, 0.15);
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
  background: var(--color-success);
}

.status-dot.error {
  background: var(--color-danger);
}

.status-dot.warning {
  background: var(--color-accent);
}

.status-icon {
  margin-right: 4px;
  font-size: 12px;
  vertical-align: middle;
  display: inline-flex;
  align-items: center;
}

.trace-link {
  font-family: monospace;
  font-size: 0.75rem;
}

.time-picker {
  width: 280px;
}

.json-key {
  color: var(--color-primary);
  font-weight: 600;
}

.json-string {
  color: var(--color-success-dark);
}

.json-number {
  color: #8b5cf6;
}

.json-bool {
  color: var(--color-accent);
}

/* Responsive breakpoints */
@media (max-width: 1200px) {
  .filter-row {
    gap: 0.75rem;
  }
  .filter-select { width: 140px; }
  .filter-input { width: 160px; }
}

@media (max-width: 1024px) {
  .stats-bar {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .stat-divider {
    display: none;
  }
  .stat-item {
    flex: 1;
    min-width: 120px;
  }
  .filter-row {
    flex-wrap: wrap;
  }
  .filter-actions {
    width: 100%;
    display: flex;
    justify-content: flex-end;
  }
}

@media (max-width: 768px) {
  .log-meta {
    flex-wrap: wrap;
  }
  .log-header {
    flex-direction: column;
    gap: 0.5rem;
  }
}
</style>
