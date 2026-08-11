<template>
  <CapabilityShell title="调用日志">
    <template #actions>
      <div class="actions">
        <button type="button" class="uc-btn uc-btn--sm" :disabled="exporting" @click="exportLogs('json')">
          {{ exportingFormat === 'json' ? '导出中...' : '导出 JSON' }}
        </button>
        <button type="button" class="uc-btn uc-btn--sm" :disabled="exporting" @click="exportLogs('csv')">
          {{ exportingFormat === 'csv' ? '导出中...' : '导出 CSV' }}
        </button>
        <button type="button" class="uc-btn uc-btn--primary uc-btn--sm" @click="copyDiagnosticsSummary">
          复制排查信息
        </button>
      </div>
    </template>
    <div class="agent-logs-page">

    <!-- 筛选器 -->
    <div class="filters">
      <label class="filter-item">
        <span class="filter-label">Agent</span>
        <select v-model="filters.agentId" class="uc-field__input filter-select">
          <option value="">全部</option>
          <option value="skill:path-planning">Path Agent</option>
          <option value="teaching-agent">AI Teaching Agent</option>
          <option value="ai-teaching-agent">AI Teaching Agent (legacy)</option>
          <option value="learner-model-agent">Learner State Hub</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">活动类型</span>
        <select v-model="filters.capabilityType" class="uc-field__input filter-select">
          <option value="">全部</option>
          <option value="goal">目标对话</option>
          <option value="path">路径规划</option>
          <option value="teaching">教学讲解</option>
          <option value="tutoring">辅导答疑</option>
          <option value="profile">学习画像更新</option>
          <option value="system">系统底层调用</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">状态</span>
        <select v-model="filters.success" class="uc-field__input filter-select">
          <option :value="undefined">全部</option>
          <option :value="true">成功</option>
          <option :value="false">失败</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">时间范围</span>
        <div class="filter-dates">
          <input v-model="startDateInput" type="date" class="uc-field__input" @change="onStartDateChange" />
          <span class="filter-dates__sep">至</span>
          <input v-model="endDateInput" type="date" class="uc-field__input" @change="onEndDateChange" />
        </div>
      </label>
      <label class="filter-item filter-item--switch">
        <span class="uc-switch">
          <input type="checkbox" v-model="filters.includeSystem" />
          <span class="uc-switch__track"></span>
        </span>
        <span class="filter-switch-label">{{ filters.includeSystem ? '显示底层调用' : '隐藏底层调用' }}</span>
      </label>
      <div class="filter-actions">
        <button type="button" class="uc-btn uc-btn--primary uc-btn--sm" :disabled="loading" @click="queryLogs">
          {{ loading ? '查询中…' : '查询' }}
        </button>
        <button type="button" class="uc-btn uc-btn--sm" @click="resetFilters">重置</button>
      </div>
    </div>

    <div v-if="!loadError" class="stats">
      <div class="stat-card">
        <span>总调用</span>
        <strong>{{ pagination.total }}</strong>
      </div>
      <div class="stat-card">
        <span>成功率（本页）</span>
        <strong>{{ successRate }}%</strong>
      </div>
      <div class="stat-card">
        <span>平均耗时（本页）</span>
        <strong>{{ avgDuration }}ms</strong>
      </div>
      <div class="stat-card">
        <span>Token（本页）</span>
        <strong>{{ totalTokens }}</strong>
      </div>
    </div>

    <!-- 日志列表 -->
    <article class="uc-card uc-card--flush logs-card">
      <div v-if="loadError" class="uc-errorbar" role="alert" style="margin: 16px">
        {{ loadError }}
        <button type="button" class="uc-errorbar__retry" @click="loadLogs">重新加载</button>
      </div>

      <div v-else-if="loading && !displayLogs.length" class="uc-loading">
        <span class="uc-spinner"></span>
        加载日志…
      </div>

      <div v-else-if="!displayLogs.length" class="uc-empty">
        <strong>暂无日志</strong>
        <span>调整筛选条件或稍后再来查看</span>
      </div>

      <template v-else>
      <div class="uc-table-wrap">
        <table class="uc-table logs-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>来源</th>
              <th>能力</th>
              <th>状态</th>
              <th>耗时</th>
              <th>Token</th>
              <th>模型</th>
              <th>错误</th>
              <th>时间</th>
              <th class="uc-table__right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in displayLogs" :key="row.id">
              <td>{{ formatAgentId(row.agentId) }}</td>
              <td><span class="uc-badge" :class="sourceBadgeClass(row)">{{ getLogSourceLabel(row) }}</span></td>
              <td class="uc-table__muted">{{ getCapabilityTypeLabel(row.agentId) }}</td>
              <td><span class="uc-badge" :class="row.success ? 'uc-badge--ok' : 'uc-badge--bad'">
                {{ row.success ? '成功' : '失败' }}
              </span></td>
              <td class="uc-table__muted">{{ row.durationMs ?? '-' }}</td>
              <td class="uc-table__muted">{{ row.tokensUsed ?? '-' }}</td>
              <td class="uc-table__muted">{{ getModelSourceInfo(row).label }}</td>
              <td class="uc-table__muted logs-error-cell">{{ row.error || '-' }}</td>
              <td class="uc-table__muted">{{ formatDate(row.calledAt) }}</td>
              <td class="uc-table__right">
                <button type="button" class="uc-btn uc-btn--link" @click="viewDetail(row)">详情</button>
                <button type="button" class="uc-btn uc-btn--link" @click="copyLogFeedback(row)">复制</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 手作分页 -->
      <div class="pagination">
        <span class="pagination__total">共 {{ pagination.total }} 条</span>
        <select v-model.number="pagination.limit" class="uc-field__input pagination__size" @change="onLimitChange">
          <option :value="10">10条/页</option>
          <option :value="20">20条/页</option>
          <option :value="50">50条/页</option>
          <option :value="100">100条/页</option>
        </select>
        <div class="pagination__nav">
          <button type="button" class="uc-btn uc-btn--sm" :disabled="pagination.page <= 1 || loading" @click="goPage(pagination.page - 1)">上一页</button>
          <span class="pagination__page">第 {{ pagination.page }} / {{ totalPages }} 页</span>
          <button type="button" class="uc-btn uc-btn--sm" :disabled="pagination.page >= totalPages || loading" @click="goPage(pagination.page + 1)">下一页</button>
        </div>
      </div>
      </template>
    </article>

    <!-- 详情弹窗 -->
    <div v-if="detailVisible && currentLog" class="uc-dialog-mask" @click.self="closeDetail">
      <div class="uc-dialog uc-dialog--detail" role="dialog" aria-modal="true" aria-label="日志详情与诊断">
        <div class="uc-dialog__head">
          <h3>日志详情与诊断</h3>
          <button type="button" class="uc-dialog__close" aria-label="关闭" @click="closeDetail">✕</button>
        </div>
        <div class="uc-dialog__body">
          <div v-if="detailError" class="uc-errorbar" role="alert" style="margin-bottom: 12px">
            {{ detailError }}
          </div>

          <div v-if="detailLoading" class="uc-loading">
            <span class="uc-spinner"></span>
            加载详情…
          </div>

          <template v-else>
          <details class="detail-collapse" open>
            <summary>基础信息</summary>
            <div class="detail-facts">
              <div class="detail-fact"><span>ID</span><strong>{{ currentLog.id }}</strong></div>
              <div class="detail-fact"><span>Agent</span><strong>{{ currentLog.agentId }}</strong></div>
              <div class="detail-fact"><span>能力类型</span><strong>{{ getCapabilityTypeLabel(currentLog.agentId) }}</strong></div>
              <div class="detail-fact"><span>状态</span><span class="uc-badge" :class="currentLog.success ? 'uc-badge--ok' : 'uc-badge--bad'">
                {{ currentLog.success ? '成功' : '失败' }}
              </span></div>
              <div class="detail-fact"><span>耗时</span><strong>{{ currentLog.durationMs }}ms</strong></div>
              <div class="detail-fact"><span>Token</span><strong>{{ currentLog.tokensUsed || '-' }}</strong></div>
              <div class="detail-fact"><span>模型来源</span><strong>{{ getModelSourceInfo(currentLog).label }}</strong></div>
              <div class="detail-fact"><span>Provider</span><strong>{{ getModelSourceInfo(currentLog).providerName }}</strong></div>
              <div class="detail-fact detail-fact--wide"><span>Provider 地址</span><strong>{{ getModelSourceInfo(currentLog).providerBaseUrl }}</strong></div>
              <div class="detail-fact"><span>时间</span><strong>{{ formatDate(currentLog.calledAt) }}</strong></div>
              <div class="detail-fact"><span>Trace ID</span><strong>{{ currentLog.traceId || detailMetadata.traceId || '-' }}</strong></div>
              <div class="detail-fact"><span>错误码</span><strong>{{ currentLog.errorCode || detailMetadata.errorCode || '-' }}</strong></div>
              <div class="detail-fact"><span>来源入口</span><strong>{{ currentLog.sourceEntry || detailMetadata.sourceEntry || '-' }}</strong></div>
              <div class="detail-fact"><span>调用方</span><strong>{{ currentLog.callerAgent || detailMetadata.callerAgent || '-' }}</strong></div>
            </div>
          </details>

          <details v-if="currentLog.error" class="detail-collapse" open>
            <summary>错误信息</summary>
            <div class="detail-error-box">{{ currentLog.error }}</div>
          </details>

          <details class="detail-collapse" open>
            <summary>输入与上下文</summary>
            <pre class="code-block">{{ formatJson(currentLog.metadata) }}</pre>
          </details>

          <details class="detail-collapse" open>
            <summary>输入 / 输出摘要</summary>
            <div class="io-block">
              <span class="io-label">输入 (input)</span>
              <pre class="code-block">{{ formatTextBlock(currentLog.input) }}</pre>
            </div>
            <div class="io-block">
              <span class="io-label">输出 (output)</span>
              <pre class="code-block">{{ formatTextBlock(currentLog.output) }}</pre>
            </div>
          </details>
          </template>
        </div>
        <div class="uc-dialog__foot">
          <button type="button" class="uc-btn dialog-btn--close" @click="closeDetail">关闭</button>
          <button type="button" class="uc-btn uc-btn--primary" :disabled="!currentLog" @click="copyLogFeedback(currentLog)">
            复制
          </button>
        </div>
      </div>
    </div>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { toast } from '../../utils/toast';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { getAgentLogDetail, getAgentLogs, exportAgentLogs } from '@/api/userCustom';
import dayjs from 'dayjs';
import '@/components/user/uc.css';

interface AgentLogItem {
  id: string;
  agentId?: string;
  success?: boolean;
  durationMs?: number;
  tokensUsed?: number;
  error?: string | null;
  errorCode?: string | null;
  calledAt?: string;
  traceId?: string | null;
  sourceEntry?: string | null;
  callerAgent?: string | null;
  logSource?: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
}

interface AgentLogQueryParams {
  page?: number;
  limit?: number;
  agentId?: string;
  capabilityType?: string;
  success?: boolean;
  includeSystem?: boolean;
  startDate?: string;
  endDate?: string;
  format?: 'json' | 'csv';
}

const loading = ref(false);
const logs = ref<AgentLogItem[]>([]);
const detailVisible = ref(false);
const currentLog = ref<AgentLogItem | null>(null);
const isMobileDetail = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
const loadError = ref('');
const exportingFormat = ref<'' | 'json' | 'csv'>('');
const exporting = computed(() => exportingFormat.value !== '');

const filters = reactive({
  agentId: '',
  capabilityType: '',
  success: undefined as boolean | undefined,
  includeSystem: false,
  startDate: '',
  endDate: ''
});

const dateRange = ref<[Date, Date] | null>(null);
// 手作日期筛选（原生 date input）
const startDateInput = ref(filters?.startDate || '');
const endDateInput = ref(filters?.endDate || '');

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
});

// 统计数据
const successRate = computed(() => {
  if (logs.value.length === 0) return 0;
  const successCount = logs.value.filter(l => l.success).length;
  return ((successCount / logs.value.length) * 100).toFixed(1);
});

const avgDuration = computed(() => {
  if (logs.value.length === 0) return 0;
  const total = logs.value.reduce((sum, l) => sum + (l.durationMs || 0), 0);
  return Math.round(total / logs.value.length);
});

const totalTokens = computed(() => {
  return logs.value.reduce((sum, l) => sum + (l.tokensUsed || 0), 0);
});

const displayLogs = computed(() => {
  return filters.capabilityType
    ? logs.value.filter((log) => getCapabilityType(log.agentId) === filters.capabilityType)
    : logs.value;
});
const detailMetadata = computed(() => parseMetadata(currentLog.value?.metadata));

onMounted(() => {
  syncDetailViewport();
  window.addEventListener('resize', syncDetailViewport);
  loadLogs();
});

onUnmounted(() => {
  window.removeEventListener('resize', syncDetailViewport);
});

const syncDetailViewport = () => {
  isMobileDetail.value = window.innerWidth <= 768;
};

const loadLogs = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const params: AgentLogQueryParams = {
      page: pagination.page,
      limit: pagination.limit
    };
    
    if (filters.agentId) params.agentId = filters.agentId;
    if (filters.capabilityType) params.capabilityType = filters.capabilityType;
    // el-select clearable 清空时会置为 ''，仅布尔值才下发筛选
    if (typeof filters.success === 'boolean') params.success = filters.success;
    params.includeSystem = filters.includeSystem;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;

    const res = await getAgentLogs(params);
    logs.value = res.data?.logs || [];
    pagination.total = res.data?.pagination?.total || 0;
  } catch (error: any) {
    logs.value = [];
    pagination.total = 0;
    loadError.value = error?.response?.data?.error?.message || '无法读取调用日志，请稍后重试。';
    toast.error('日志加载失败');
    console.error('加载日志失败:', error);
  } finally {
    loading.value = false;
  }
};

const queryLogs = () => {
  pagination.page = 1;
  loadLogs();
};

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.limit)));

const goPage = (page: number) => {
  if (page < 1 || page > totalPages.value || page === pagination.page) return;
  pagination.page = page;
  loadLogs();
};

const onLimitChange = () => {
  pagination.page = 1;
  loadLogs();
};

const onStartDateChange = () => {
  filters.startDate = startDateInput.value || '';
  queryLogs();
};

const onEndDateChange = () => {
  filters.endDate = endDateInput.value || '';
  queryLogs();
};

const closeDetail = () => {
  detailVisible.value = false;
  currentLog.value = null;
};

const sourceBadgeClass = (log: AgentLogItem) =>
  getLogSourceLabel(log) === '平台底层' ? 'uc-badge--muted' : 'uc-badge--info';

const resetFilters = () => {
  filters.agentId = '';
  filters.capabilityType = '';
  filters.success = undefined;
  filters.includeSystem = false;
  filters.startDate = '';
  filters.endDate = '';
  dateRange.value = null;
  startDateInput.value = '';
  endDateInput.value = '';
  pagination.page = 1;
  loadLogs();
};

const viewDetail = async (log: AgentLogItem) => {
  currentLog.value = log;
  detailError.value = '';
  detailVisible.value = true;
  detailLoading.value = true;

  try {
    const res = await getAgentLogDetail(log.id);
    const detail = res?.data || res;
    if (detail) {
      currentLog.value = detail;
    }
  } catch (error) {
    detailError.value = '加载完整详情失败，当前展示的是列表摘要信息。';
    console.error('加载日志详情失败:', error);
  } finally {
    detailLoading.value = false;
  }
};

const exportLogs = async (format: 'json' | 'csv') => {
  if (exporting.value) return;
  exportingFormat.value = format;
  try {
    const params: AgentLogQueryParams = { format };
    if (filters.agentId) params.agentId = filters.agentId;
    if (filters.capabilityType) params.capabilityType = filters.capabilityType;
    if (typeof filters.success === 'boolean') params.success = filters.success;
    params.includeSystem = filters.includeSystem;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;

    const data = await exportAgentLogs(params);
    const blob = format === 'csv'
      ? (data as Blob)
      : new Blob([JSON.stringify((data as { data?: unknown })?.data ?? data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `agent-logs-${dayjs().format('YYYYMMDD')}.${format}`);
    toast.success('日志导出完成');
  } catch (error) {
    toast.error('日志导出失败');
    console.error('导出失败:', error);
  } finally {
    exportingFormat.value = '';
  }
};

const copyDiagnosticsSummary = async () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    filters: {
      agentId: filters.agentId || null,
      capabilityType: filters.capabilityType || null,
      success: filters.success,
      startDate: filters.startDate || null,
      endDate: filters.endDate || null
    },
    summary: {
      total: pagination.total,
      visible: displayLogs.value.length,
      successRate: successRate.value,
      avgDuration: avgDuration.value,
      totalTokens: totalTokens.value
    },
    latestLogs: displayLogs.value.slice(0, 10).map(toDiagnosticLog)
  };

  await copyText(JSON.stringify(payload, null, 2), '诊断摘要已复制');
};

const copyLogFeedback = async (log: AgentLogItem | null) => {
  if (!log) return;

  const payload = buildFeedbackPayload(log);

  await copyText(JSON.stringify(payload, null, 2), '反馈包已复制，可直接发给开发同学');
};

const buildFeedbackPayload = (log: AgentLogItem) => {
  const metadata = parseMetadata(log?.metadata);
  return {
    copiedAt: new Date().toISOString(),
    version: 'v1',
    log: {
      id: log.id,
      agentId: log.agentId,
      agentLabel: formatAgentId(log),
      capabilityType: getCapabilityTypeLabel(log.agentId),
      success: log.success,
      durationMs: log.durationMs,
      tokensUsed: log.tokensUsed,
      error: log.error,
      errorCode: log.errorCode,
      calledAt: log.calledAt,
      traceId: log.traceId || metadata.traceId,
      sourceEntry: log.sourceEntry || metadata.sourceEntry,
      callerAgent: log.callerAgent || metadata.callerAgent,
      modelSource: getModelSourceInfo(log),
      inputPreview: formatTextBlock(log.input).slice(0, 1200),
      outputPreview: formatTextBlock(log.output).slice(0, 1200),
      metadata: {
        sessionId: metadata.sessionId,
        taskId: metadata.taskId,
        userId: metadata.userId,
        providerId: metadata.providerId,
        providerName: metadata.providerName,
        providerBaseUrl: metadata.providerBaseUrl,
        model: metadata.model,
        endpoint: metadata.endpoint,
      }
    }
  };
};

const formatDate = (date?: string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

const formatAgentId = (logOrAgentId: string | AgentLogItem | null | undefined) => {
  const agentId = typeof logOrAgentId === 'string' ? logOrAgentId : logOrAgentId?.agentId;
  const metadata = typeof logOrAgentId === 'string' ? {} : parseMetadata(logOrAgentId?.metadata);

  if (!agentId || agentId === 'unknown') {
    const action = metadata.action as string | undefined;
    if (action) {
      return `平台底层调用(${action})`;
    }
    return '平台底层调用';
  }
  
  // 友好显示映射（agentId → 展示名）。
  // 来源说明：本页为用户侧执行日志，无现成 agent 清单 API 可复用；id 含
  // 历史/业务别名（ai-teaching-agent、ai-tutor 等）与 admin 注册表不同构，
  // 保持本地字典，仅作显示层映射（未命中时原样回退 agentId）。
  const agentNames: Record<string, string> = {
    'skill:path-planning': '学习路径规划',
    'skill:goal-conversation': '目标对话',
    'ai-teaching-agent': 'AI 授课',
    'teaching-agent': 'AI 授课',
    'ai-tutor': 'AI 辅导',
    'learner-model-agent': '学习者模型',
    'course-design': '课程设计',
    'system-call': '平台底层调用'
  };
  
  return agentNames[agentId] || agentId;
};

const getLogSourceLabel = (log: AgentLogItem) => {
  if (log.logSource === 'business') {
    return '业务层';
  }

  if (log.logSource === 'runtime') {
    return '运行时';
  }

  if (log.logSource === 'infrastructure') {
    return '平台底层';
  }

  if (String(log.id || '').startsWith('acl_')) {
    return '业务层';
  }

  if (log.agentId === 'system-call' || log.agentId === 'unknown') {
    return '平台底层';
  }

  return '业务层';
};

const getCapabilityType = (agentId?: string) => {
  // agent → 能力类型映射（显示层字典，与上方 agentNames 同源；无 agent 清单 API，
  // 保持本地映射，未命中归为 system）
  const mapping: Record<string, string> = {
    'skill:goal-conversation': 'goal',
    'skill:path-planning': 'path',
    'ai-teaching-agent': 'teaching',
    'teaching-agent': 'teaching',
    'ai-tutor': 'tutoring',
    'learner-model-agent': 'profile',
    'unknown': 'system',
    'system-call': 'system'
  };

  return mapping[agentId ?? ''] || 'system';
};

const getCapabilityTypeLabel = (agentId?: string) => {
  const labels: Record<string, string> = {
    goal: '需求收集',
    path: '路径规划',
    teaching: '授课内容',
    tutoring: '辅导答疑',
    tracking: '进度追踪',
    profile: '学习者模型',
    system: '平台底层调用'
  };

  return labels[getCapabilityType(agentId)] || '系统调用';
};

const formatJson = (json: unknown) => {
  if (!json) return '';
  try {
    return JSON.stringify(typeof json === 'string' ? JSON.parse(json) : json, null, 2);
  } catch {
    return json;
  }
};

const formatTextBlock = (value: unknown) => {
  if (!value) {
    return '暂无';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '暂无';
    }

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseMetadata = (metadata: unknown): Record<string, unknown> => {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return metadata as Record<string, unknown>;
};

const getModelSourceInfo = (log: AgentLogItem | null) => {
  const metadata = parseMetadata(log?.metadata);
  const usesUserProvider = !!metadata.usesUserProvider;

  return {
    usesUserProvider,
    label: usesUserProvider ? '用户 AI API' : '平台默认模型',
    providerName: metadata.providerName || 'platform-default',
    providerBaseUrl: metadata.providerBaseUrl || '-',
    providerId: metadata.providerId || 'platform-default'
  };
};

const toDiagnosticLog = (log: AgentLogItem) => ({
  id: log.id,
  agentId: log.agentId,
  agentLabel: formatAgentId(log.agentId),
  capabilityType: getCapabilityTypeLabel(log.agentId),
  success: log.success,
  durationMs: log.durationMs,
  tokensUsed: log.tokensUsed,
  error: log.error,
  calledAt: log.calledAt,
  modelSource: getModelSourceInfo(log),
  metadata: log.metadata
});

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
};

const copyText = async (text: string, successMessage: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch {
    toast.error('复制失败，请检查浏览器权限');
  }
};
</script>

<style scoped>
.agent-logs-page {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: grid;
  gap: 16px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.filters {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 16px;
  background: var(--surface, #fff);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: flex-end;
}

.filter-item {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.filter-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted, #5b6577);
}

.filter-select {
  width: 150px;
}

.filter-dates {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-dates input {
  width: 130px;
}

.filter-dates__sep {
  color: var(--faint, #67758f);
  font-size: 12px;
}

.filter-item--switch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
}

.filter-switch-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted, #5b6577);
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 2px;
}

.stats {
  margin: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.stat-card {
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--line, #e3e9f4);
  background: var(--canvas, #f3f6fb);
  box-shadow: none;
  display: grid;
  gap: 6px;

  span {
    font-size: 12px;
    font-weight: 700;
    color: var(--faint, #67758f);
  }

  strong {
    font-size: 22px;
    font-weight: 800;
    color: var(--ink, #172033);
    line-height: 1.2;
  }
}

.logs-card {
  padding: 0;
  overflow: hidden;
}

.logs-table {
  min-width: 1080px;
}

.logs-error-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pagination {
  margin: 0;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-top: 1px solid var(--line, #e3e9f4);
}

.pagination__total {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
}

.pagination__size {
  width: 110px;
  padding: 6px 10px;
  font-size: 12.5px;
}

.pagination__nav {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pagination__page {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  white-space: nowrap;
}

.uc-dialog--detail {
  width: min(880px, 100%);
}

.detail-collapse {
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 12px;
  background: var(--surface, #fff);
  overflow: hidden;
}

.detail-collapse summary {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink, #172033);
  background: var(--canvas, #f3f6fb);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-collapse summary::after {
  content: '▾';
  color: var(--faint, #67758f);
  font-size: 11px;
  transition: transform 0.15s ease;
}

.detail-collapse:not([open]) summary::after {
  transform: rotate(-90deg);
}

.detail-collapse summary::-webkit-details-marker {
  display: none;
}

.detail-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  padding: 4px 0;
}

.detail-fact {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line, #e3e9f4);
  align-items: baseline;
  font-size: 13px;
}

.detail-fact--wide {
  grid-column: 1 / -1;
}

.detail-fact span {
  color: var(--faint, #67758f);
  font-size: 12px;
  font-weight: 700;
}

.detail-fact strong {
  color: var(--ink, #172033);
  word-break: break-all;
  font-weight: 600;
}

.detail-error-box {
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: #c0454a;
  border-radius: 10px;
  padding: 12px;
  margin: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.code-block {
  background: var(--canvas, #f3f6fb);
  border: 1px solid var(--line, #e3e9f4);
  padding: 10px;
  border-radius: 8px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  color: var(--ink, #172033);
  margin: 12px;
}

.io-block {
  margin: 12px;
}

.io-block + .io-block {
  margin-top: 16px;
}

.io-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #67758f);
  margin-bottom: 6px;
}

.io-block .code-block {
  margin: 0;
}

@media (max-width: 768px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .actions {
    width: 100%;
    justify-content: stretch;
  }

  .actions > * {
    flex: 1 1 100%;
  }

  .filter-dates input {
    width: 100%;
  }

  .filter-select {
    width: 100%;
  }

  .filter-item {
    flex: 1 1 45%;
  }

  .detail-facts {
    grid-template-columns: 1fr;
  }

  .detail-fact--wide {
    grid-column: auto;
  }
}
</style>
