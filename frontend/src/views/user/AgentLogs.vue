<template>
  <CapabilityShell title="调用日志">
    <template #actions>
      <div class="actions">
        <button type="button" class="btn btn--ghost btn--sm" :disabled="exporting" @click="exportLogs('json')">
          <el-icon><Download /></el-icon>
          {{ exportingFormat === 'json' ? '导出中...' : '导出 JSON' }}
        </button>
        <button type="button" class="btn btn--ghost btn--sm" :disabled="exporting" @click="exportLogs('csv')">
          <el-icon><Download /></el-icon>
          {{ exportingFormat === 'csv' ? '导出中...' : '导出 CSV' }}
        </button>
        <button type="button" class="btn btn--primary btn--sm" @click="copyDiagnosticsSummary">
          <el-icon><DocumentCopy /></el-icon>
          复制排查信息
        </button>
      </div>
    </template>
    <div class="agent-logs-page">

    <!-- 筛选器 -->
    <div class="filters">
      <el-form :inline="true" :model="filters">
        <el-form-item label="Agent">
          <el-select v-model="filters.agentId" placeholder="全部" clearable>
            <el-option label="Path Agent" value="skill:path-planning" />
            <el-option label="AI Teaching Agent" value="ai-teaching-agent" />
            <el-option label="Learner State Hub" value="learner-model-agent" />
          </el-select>
        </el-form-item>
        <el-form-item label="活动类型">
          <el-select v-model="filters.capabilityType" placeholder="全部" clearable>
            <el-option label="目标对话" value="goal" />
            <el-option label="路径规划" value="path" />
            <el-option label="教学讲解" value="teaching" />
            <el-option label="辅导答疑" value="tutoring" />
            <el-option label="进度追踪" value="tracking" />
            <el-option label="学习画像更新" value="profile" />
            <el-option label="系统底层调用" value="system" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.success" placeholder="全部" clearable>
            <el-option label="成功" :value="true" />
            <el-option label="失败" :value="false" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-switch
            v-model="filters.includeSystem"
            inline-prompt
            active-text="显示底层调用"
            inactive-text="隐藏底层调用"
          />
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="onDateRangeChange"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="queryLogs">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div v-if="!loadError" class="stats">
      <div class="stat-card">
        <span>总调用</span>
        <strong>{{ pagination.total }}</strong>
      </div>
      <div class="stat-card">
        <span>成功率</span>
        <strong>{{ successRate }}%</strong>
      </div>
      <div class="stat-card">
        <span>平均耗时</span>
        <strong>{{ avgDuration }}ms</strong>
      </div>
      <div class="stat-card">
        <span>Token</span>
        <strong>{{ totalTokens }}</strong>
      </div>
    </div>

    <!-- 日志列表 -->
    <div class="logs-list">
      <el-result v-if="loadError" icon="error" title="日志加载失败" :sub-title="loadError">
        <template #extra>
          <el-button type="primary" @click="loadLogs">重新加载</el-button>
        </template>
      </el-result>

      <template v-else>
      <div class="logs-table-panel">
        <div class="logs-table-panel__scroller">
      <el-table :data="displayLogs" v-loading="loading" style="width: 100%">
        <el-table-column prop="agentId" label="Agent" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">
            {{ formatAgentId(row.agentId) }}
          </template>
        </el-table-column>
        <el-table-column label="来源" width="80">
          <template #default="{ row }">
            <el-tag :type="getLogSourceType(row)" size="small" effect="plain">
              {{ getLogSourceLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="能力" width="88">
          <template #default="{ row }">
            {{ getCapabilityTypeLabel(row.agentId) }}
          </template>
        </el-table-column>
        <el-table-column prop="success" label="状态" width="70">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">
              {{ row.success ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="durationMs" label="耗时" width="70" />
        <el-table-column prop="tokensUsed" label="Token" width="70" />
        <el-table-column label="模型" min-width="100" show-overflow-tooltip>
          <template #default="{ row }">
            {{ getModelSourceInfo(row).label }}
          </template>
        </el-table-column>
        <el-table-column prop="error" label="错误" min-width="120" show-overflow-tooltip />
        <el-table-column prop="calledAt" label="时间" width="140">
          <template #default="{ row }">
            {{ formatDate(row.calledAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button link type="primary" @click="viewDetail(row)">详情</el-button>
              <el-button link type="primary" @click="copyLogFeedback(row)">复制</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadLogs"
          @current-change="loadLogs"
        />
      </div>
      </template>
    </div>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailVisible"
      title="日志详情与诊断"
      width="min(880px, calc(100vw - 32px))"
      :fullscreen="isMobileDetail"
    >
      <div v-loading="detailLoading" v-if="currentLog" class="detail-panel">
        <el-alert
          v-if="detailError"
          type="warning"
          show-icon
          :closable="false"
          :title="detailError"
          class="detail-error-alert"
        />

        <el-collapse v-model="detailSections" class="detail-collapse">
          <el-collapse-item name="basic" title="基础信息">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="ID">{{ currentLog.id }}</el-descriptions-item>
              <el-descriptions-item label="Agent">{{ currentLog.agentId }}</el-descriptions-item>
              <el-descriptions-item label="能力类型">{{ getCapabilityTypeLabel(currentLog.agentId) }}</el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag :type="currentLog.success ? 'success' : 'danger'">
                  {{ currentLog.success ? '成功' : '失败' }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="耗时">{{ currentLog.durationMs }}ms</el-descriptions-item>
              <el-descriptions-item label="Token">{{ currentLog.tokensUsed || '-' }}</el-descriptions-item>
              <el-descriptions-item label="模型来源">{{ getModelSourceInfo(currentLog).label }}</el-descriptions-item>
              <el-descriptions-item label="Provider">{{ getModelSourceInfo(currentLog).providerName }}</el-descriptions-item>
              <el-descriptions-item label="Provider 地址" :span="2">{{ getModelSourceInfo(currentLog).providerBaseUrl }}</el-descriptions-item>
              <el-descriptions-item label="时间">{{ formatDate(currentLog.calledAt) }}</el-descriptions-item>
              <el-descriptions-item label="Trace ID">{{ currentLog.traceId || detailMetadata.traceId || '-' }}</el-descriptions-item>
              <el-descriptions-item label="错误码">{{ currentLog.errorCode || detailMetadata.errorCode || '-' }}</el-descriptions-item>
              <el-descriptions-item label="来源入口">{{ currentLog.sourceEntry || detailMetadata.sourceEntry || '-' }}</el-descriptions-item>
              <el-descriptions-item label="调用方">{{ currentLog.callerAgent || detailMetadata.callerAgent || '-' }}</el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>

          <el-collapse-item name="error" title="错误信息" v-if="currentLog.error">
            <div class="detail-error-box">{{ currentLog.error }}</div>
          </el-collapse-item>

          <el-collapse-item name="context" title="输入与上下文">
            <pre class="code-block">{{ formatJson(currentLog.metadata) }}</pre>
          </el-collapse-item>

          <el-collapse-item name="io" title="输入 / 输出摘要">
            <el-descriptions :column="1" border class="io-descriptions">
              <el-descriptions-item label="输入 (input)">
                <pre class="code-block">{{ formatTextBlock(currentLog.input) }}</pre>
              </el-descriptions-item>
              <el-descriptions-item label="输出 (output)">
                <pre class="code-block">{{ formatTextBlock(currentLog.output) }}</pre>
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>
        </el-collapse>
      </div>
      <template #footer>
        <el-button class="dialog-btn dialog-btn--close" @click="detailVisible = false">关闭</el-button>
        <el-button class="dialog-btn dialog-btn--copy" :disabled="!currentLog" @click="copyLogFeedback(currentLog)">
          <el-icon><CopyDocument /></el-icon>
          复制
        </el-button>
      </template>
    </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { CopyDocument, DocumentCopy, Download } from '@element-plus/icons-vue';
import { toast } from '../../utils/toast';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { getAgentLogDetail, getAgentLogs, exportAgentLogs } from '@/api/userCustom';
import dayjs from 'dayjs';

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
const detailSections = ref<string[]>(['basic', 'context']);
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

const onDateRangeChange = (dates: [Date, Date] | null) => {
  if (dates && dates.length === 2) {
    filters.startDate = dayjs(dates[0]).format('YYYY-MM-DD');
    filters.endDate = dayjs(dates[1]).format('YYYY-MM-DD');
  } else {
    filters.startDate = '';
    filters.endDate = '';
  }
};

const resetFilters = () => {
  filters.agentId = '';
  filters.capabilityType = '';
  filters.success = undefined;
  filters.includeSystem = false;
  filters.startDate = '';
  filters.endDate = '';
  dateRange.value = null;
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
    const hasError = !!(currentLog.value?.error || currentLog.value?.errorCode);
    detailSections.value = hasError
      ? ['basic', 'error', 'context', 'io']
      : ['basic', 'context', 'io'];
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
  
  // 友好显示映射
  const agentNames: Record<string, string> = {
    'skill:path-planning': '学习路径规划',
    'skill:goal-conversation': '目标对话',
    'ai-teaching-agent': 'AI 授课',
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

const getLogSourceType = (log: AgentLogItem) => {
  return getLogSourceLabel(log) === '平台底层' ? 'info' : 'success';
};

const getCapabilityType = (agentId?: string) => {
  const mapping: Record<string, string> = {
    'skill:goal-conversation': 'goal',
    'skill:path-planning': 'path',
    'ai-teaching-agent': 'teaching',
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

<style scoped lang="scss">
.agent-logs-page {
  --brand-ink: #0d4f76;
  --brand-soft: #e8f4fb;
  --accent-ink: #0f766e;
  --accent-soft: #e8f7f5;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  display: grid;
  gap: 16px;

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .filters {
    margin: 0;
    padding: 14px 16px 4px;
    border: 1px solid var(--line, #e3e9f4);
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
    min-width: 0;
  }

  :deep(.filters .el-form) {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: center;
  }

  :deep(.filters .el-form-item) {
    margin-bottom: 10px;
    margin-right: 0;
  }

  :deep(.filters .el-select) {
    width: 140px;
  }

  :deep(.filters .el-date-editor) {
    width: 260px;
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
    background: #fff;
    box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
    display: grid;
    gap: 6px;

    span {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted, #5b6577);
    }

    strong {
      font-size: 22px;
      font-weight: 800;
      color: var(--ink, #172033);
      line-height: 1.2;
    }
  }

  .logs-list {
    padding: 16px;
    border: 1px solid var(--line, #e3e9f4);
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
    min-width: 0;
    overflow: hidden;

    .log-card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }

    .cards-headline {
      margin-bottom: 14px;

      h3 {
        margin: 0 0 4px;
        font-size: 16px;
        color: var(--text-primary);
      }

      p {
        margin: 0;
        font-size: 13px;
        color: var(--text-secondary);
      }
    }

    .log-card {
      border-radius: 22px;
      border: 1px solid #d9e8f2;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(249, 252, 255, 0.92) 100%);

      &__header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 14px;

        p {
          margin: 8px 0 0;
          color: var(--el-text-color-secondary);
          line-height: 1.5;
        }
      }

      &__title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;

        h3 {
          margin: 0;
          font-size: 18px;
          color: var(--el-text-color-primary);
        }
      }

      &__meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }

      &__meta-item {
        display: grid;
        gap: 6px;
        padding: 12px;
        border-radius: 14px;
        background: var(--bg-muted);
        min-width: 0;

        span {
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }

        strong {
          color: var(--el-text-color-primary);
          word-break: break-word;
        }
      }

      &__error {
        margin-bottom: 14px;
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--color-danger-bg);
        border: 1px solid var(--color-danger-border);
        color: var(--color-danger-dark);
        font-size: 13px;
        line-height: 1.6;
        word-break: break-word;
      }

      &__actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
    }

    .log-action-btn {
      border-radius: 10px;
      font-weight: 600;
      padding: 7px 10px;
    }

    .log-action-btn--detail {
      border-color: #c6dff0;
      color: var(--brand-ink);
      background: var(--brand-soft);
    }

    .log-action-btn--copy {
      border-color: #bfe4de;
      color: var(--accent-ink);
      background: var(--accent-soft);
    }

    .logs-table-panel {
      min-width: 0;
      width: 100%;

      &__scroller {
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
      }

      :deep(.el-table) {
        width: 100% !important;
      }

      :deep(.el-table__header),
      :deep(.el-table__body) {
        width: 100% !important;
      }

      .table-actions {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: 2px;
      }

      .table-actions :deep(.el-button) {
        margin-left: 0;
        padding: 0 4px;
      }
    }

    .el-button + .el-button {
      margin-left: 0;
    }

    .pagination {
      margin-top: 20px;
      display: flex;
      justify-content: flex-end;
    }
  }

  [data-theme='dark'] {
    .logs-list {
      background: linear-gradient(180deg, rgba(26, 37, 47, 0.84), rgba(15, 24, 32, 0.76));
      border-color: rgba(96, 165, 250, 0.1);
      box-shadow: 0 20px 38px rgba(0, 0, 0, 0.22);
    }

    .logs-list :deep(.stats .el-card) {
      background: linear-gradient(180deg, rgba(26, 37, 47, 0.88), rgba(15, 24, 32, 0.8));
      border-color: rgba(96, 165, 250, 0.1);
      box-shadow: 0 18px 32px rgba(0, 0, 0, 0.22);
    }
  }

  @media (max-width: 1024px) {
    .logs-list {
      .log-card-grid {
        grid-template-columns: 1fr;
      }
    }
  }

  @media (max-width: 768px) {
    .logs-list {
      padding: 16px;

      .log-card {
        &__meta {
          grid-template-columns: 1fr;
        }
      }
    }

    .filters {
      padding: 16px 16px 2px;
      border-radius: 20px;
    }

    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    :deep(.filters .el-form) {
      display: grid;
      gap: 8px;
    }

    :deep(.filters .el-form-item) {
      width: 100%;
      margin-right: 0;
    }

    :deep(.filters .el-form-item__content) {
      width: 100%;
    }

    :deep(.filters .el-select),
    :deep(.filters .el-date-editor),
    :deep(.filters .el-button) {
      width: 100%;
    }

    .actions {
      width: 100%;
      justify-content: stretch;
    }

    .actions > * {
      flex: 1 1 100%;
    }

    .logs-table-panel__header {
      gap: 8px;
    }

    .logs-table-panel__scroller {
      margin-inline: -4px;
      padding-inline: 4px;
    }

    .pagination {
      justify-content: flex-start;
      overflow-x: auto;
    }

    :deep(.el-dialog) {
      margin: 0;
      border-radius: 0;
    }

    :deep(.el-dialog__header),
    :deep(.el-dialog__body),
    :deep(.el-dialog__footer) {
      padding-left: 16px;
      padding-right: 16px;
    }

    :deep(.io-descriptions .el-descriptions__label) {
      width: auto;
      min-width: 84px;
      white-space: normal;
    }
  }

  .code-block {
    background: var(--bg-muted);
    border: 1px solid var(--border-light);
    padding: 10px;
    border-radius: 8px;
    max-height: 300px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: var(--text-primary);
  }

  .detail-alert {
    margin-bottom: 14px;
  }

  .detail-panel {
    border: 1px solid #d9e6ef;
    border-radius: 12px;
    background: #f9fcff;
    padding: 10px;
  }

  .detail-error-alert {
    margin-bottom: 10px;
  }

  .detail-collapse {
    :deep(.el-collapse-item__header) {
      font-weight: 700;
      color: #1c4a67;
      background: #f3f9fe;
      border-radius: 8px;
      padding: 0 12px;
    }

    :deep(.el-collapse-item__content) {
      padding: 12px 6px 8px;
    }
  }

  .detail-error-box {
    background: #fff3f2;
    border: 1px solid #f0c7c2;
    color: #9d3f3a;
    border-radius: 10px;
    padding: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .dialog-btn {
    border-radius: 10px;
    font-weight: 600;
  }

  .dialog-btn--close {
    border-color: #d6e0e8;
    color: #4e6475;
    background: #f7fafc;
  }

  .dialog-btn--copy {
    border: none;
    color: #fff;
    background: linear-gradient(135deg, #1f7aa8 0%, #0f766e 100%);
  }

  .dialog-btn--copy:hover {
    filter: brightness(1.03);
    box-shadow: 0 6px 14px rgba(20, 96, 132, 0.3);
  }

  :deep(.el-dialog) {
    max-width: calc(100vw - 24px);
  }

  :deep(.el-dialog__body) {
    max-height: min(72vh, 760px);
    overflow: auto;
    overflow-x: hidden;
  }

  :deep(.el-descriptions__table) {
    width: 100%;
    table-layout: fixed;
  }

  :deep(.el-descriptions__cell) {
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  :deep(.io-descriptions .el-descriptions__label) {
    width: 110px;
    min-width: 110px;
    white-space: nowrap;
  }

  :deep(.io-descriptions .el-descriptions__content) {
    padding-left: 10px;
  }
}

[data-theme="dark"] .agent-logs-page .filters,
[data-theme="dark"] .agent-logs-page .logs-list {
  background: rgba(26, 37, 47, 0.72);
  border-color: rgba(255, 255, 255, 0.1);
}

[data-theme="dark"] .agent-logs-page .detail-panel {
  background: rgba(22, 34, 46, 0.85);
  border-color: rgba(138, 173, 197, 0.3);
}

[data-theme="dark"] .agent-logs-page .dialog-btn--close {
  background: rgba(18, 30, 41, 0.8);
  border-color: rgba(138, 173, 197, 0.3);
  color: #b8d6ea;
}

[data-theme="dark"] .agent-logs-page .log-card {
  border-color: rgba(138, 173, 197, 0.25);
  background: linear-gradient(180deg, rgba(24, 39, 52, 0.9) 0%, rgba(20, 33, 45, 0.86) 100%);
}
</style>
