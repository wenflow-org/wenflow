<template>
  <CapabilityShell title="执行日志" description="回看平台实际执行了什么，定位错误、复盘调用链，并确认这次调用走的是平台默认模型还是你自己的 AI 大模型 API。">
    <template #actions>
      <div class="actions">
        <el-button class="toolbar-btn toolbar-btn--neutral" @click="exportLogs('json')">
          <el-icon><Download /></el-icon>
          导出 JSON
        </el-button>
        <el-button class="toolbar-btn toolbar-btn--neutral" @click="exportLogs('csv')">
          <el-icon><Download /></el-icon>
          导出 CSV
        </el-button>
        <el-button class="toolbar-btn toolbar-btn--primary" @click="copyDiagnosticsSummary">
          <el-icon><DocumentCopy /></el-icon>
          复制诊断摘要
        </el-button>
      </div>
    </template>
    <div class="agent-logs-page">

    <!-- 筛选器 -->
    <div class="filters">
      <el-form :inline="true" :model="filters">
        <el-form-item label="Agent">
          <el-select v-model="filters.agentId" placeholder="全部" clearable>
            <el-option label="Path Agent" value="path-agent" />
            <el-option label="Content Agent" value="content-agent" />
            <el-option label="AI Teaching Agent" value="ai-teaching-agent" />
            <el-option label="Progress Agent" value="progress-agent" />
            <el-option label="Learner Model Agent" value="learner-model-agent" />
          </el-select>
        </el-form-item>
        <el-form-item label="能力类型">
          <el-select v-model="filters.capabilityType" placeholder="全部" clearable>
            <el-option label="需求收集" value="goal" />
            <el-option label="路径规划" value="path" />
            <el-option label="授课内容" value="teaching" />
            <el-option label="辅导答疑" value="tutoring" />
            <el-option label="进度追踪" value="tracking" />
            <el-option label="学习者模型" value="profile" />
            <el-option label="系统调用" value="system" />
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
          <el-button type="primary" @click="loadLogs">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-alert
      title="报错反馈建议"
      description="遇到异常时，先点详情确认输入/错误信息，再使用“复制诊断摘要”或单条日志里的“复制反馈包”发给开发者。"
      type="info"
      show-icon
      class="feedback-alert"
    />

    <!-- 统计信息 -->
    <div class="stats">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">总调用次数</div>
              <div class="value">{{ pagination.total }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">成功率</div>
              <div class="value">{{ successRate }}%</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">平均耗时</div>
              <div class="value">{{ avgDuration }}ms</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">总 Token</div>
              <div class="value">{{ totalTokens }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 日志列表 -->
    <div class="logs-list">
      <div class="logs-table-panel">
        <div class="logs-table-panel__header">
          <div>
            <h3>详细日志</h3>
            <p>展示完整日志记录。默认隐藏平台底层调用，避免和业务 Agent 记录混淆。</p>
          </div>
        </div>

        <div class="logs-table-panel__scroller">
      <el-table :data="displayLogs" v-loading="loading" style="width: 100%">
        <el-table-column prop="agentId" label="Agent" width="150">
          <template #default="{ row }">
            <span>{{ formatAgentId(row.agentId) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="记录来源" width="120">
          <template #default="{ row }">
            <el-tag :type="getLogSourceType(row)" size="small" effect="plain">
              {{ getLogSourceLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="能力类型" width="120">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ getCapabilityTypeLabel(row.agentId) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="success" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'">
              {{ row.success ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="durationMs" label="耗时 (ms)" width="100" />
        <el-table-column prop="tokensUsed" label="Token" width="80" />
        <el-table-column label="模型来源" width="160">
          <template #default="{ row }">
            <el-tag :type="getModelSourceInfo(row).usesUserProvider ? 'success' : 'info'" size="small">
              {{ getModelSourceInfo(row).label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Provider" width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ getModelSourceInfo(row).providerName }}
          </template>
        </el-table-column>
        <el-table-column prop="error" label="错误信息" show-overflow-tooltip />
        <el-table-column prop="calledAt" label="时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.calledAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button class="table-action-btn table-action-btn--detail" text bg @click="viewDetail(row)">
                <el-icon><View /></el-icon>
                查看详情
              </el-button>
              <el-button class="table-action-btn table-action-btn--copy" text bg @click="copyLogFeedback(row)">
                <el-icon><CopyDocument /></el-icon>
                复制反馈包
              </el-button>
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
    </div>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailVisible"
      title="日志详情与诊断"
      width="880px"
      :fullscreen="isMobileDetail"
    >
      <el-alert
        title="先看状态、错误信息、模型来源；确认后可一键复制反馈包给开发者"
        type="info"
        show-icon
        :closable="false"
        class="detail-alert"
      />

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
          复制反馈包
        </el-button>
      </template>
    </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { CopyDocument, DocumentCopy, Download, View } from '@element-plus/icons-vue';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { getAgentLogDetail, getAgentLogs, exportAgentLogs } from '@/api/userCustom';
import dayjs from 'dayjs';

const loading = ref(false);
const logs = ref<any[]>([]);
const detailVisible = ref(false);
const currentLog = ref<any>(null);
const isMobileDetail = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
const detailSections = ref<string[]>(['basic', 'context']);

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
  try {
    const params: any = {
      page: pagination.page,
      limit: pagination.limit
    };
    
    if (filters.agentId) params.agentId = filters.agentId;
    if (filters.success !== undefined) params.success = filters.success;
    params.includeSystem = filters.includeSystem;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;

    const res = await getAgentLogs(params);
    logs.value = res.data.logs;
    pagination.total = res.data.pagination.total;
  } catch (error) {
    console.error('加载日志失败:', error);
  } finally {
    loading.value = false;
  }
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

const viewDetail = async (log: any) => {
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
  try {
    const params: any = { format };
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;

    const data = await exportAgentLogs(params);
    const blob = format === 'csv'
      ? data
      : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `agent-logs-${dayjs().format('YYYYMMDD')}.${format}`);
  } catch (error) {
    console.error('导出失败:', error);
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

const copyLogFeedback = async (log: any) => {
  if (!log) return;

  const payload = buildFeedbackPayload(log);

  await copyText(JSON.stringify(payload, null, 2), '反馈包已复制，可直接发给开发同学');
};

const buildFeedbackPayload = (log: any) => {
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

const formatDate = (date: string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

const formatAgentId = (logOrAgentId: any) => {
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
    'path-agent': '学习路径规划',
    'goal-conversation-agent': '目标对话',
    'ai-teaching-agent': 'AI 授课',
    'ai-tutor': 'AI 辅导',
    'progress-agent': '进度追踪',
    'learner-model-agent': '学习者模型',
    'course-design': '课程设计',
    'system-call': '平台底层调用'
  };
  
  return agentNames[agentId] || agentId;
};

const getLogSourceLabel = (log: any) => {
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

const getLogSourceType = (log: any) => {
  return getLogSourceLabel(log) === '平台底层' ? 'info' : 'success';
};

const getCapabilityType = (agentId: string) => {
  const mapping: Record<string, string> = {
    'goal-conversation-agent': 'goal',
    'path-agent': 'path',
    'content-agent-v5': 'teaching',
    'ai-teaching-agent': 'teaching',
    'ai-tutor': 'tutoring',
    'progress-agent': 'tracking',
    'learner-model-agent': 'profile',
    'unknown': 'system',
    'system-call': 'system'
  };

  return mapping[agentId] || 'system';
};

const getCapabilityTypeLabel = (agentId: string) => {
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

const formatJson = (json: any) => {
  if (!json) return '';
  try {
    return JSON.stringify(typeof json === 'string' ? JSON.parse(json) : json, null, 2);
  } catch {
    return json;
  }
};

const formatTextBlock = (value: any) => {
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

const parseMetadata = (metadata: any) => {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return metadata;
};

const getModelSourceInfo = (log: any) => {
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

const toDiagnosticLog = (log: any) => ({
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
    ElMessage.success(successMessage);
  } catch {
    ElMessage.error('复制失败，请检查浏览器权限');
  }
};
</script>

<style scoped lang="scss">
.agent-logs-page {
  --brand-ink: #0d4f76;
  --brand-soft: #e8f4fb;
  --accent-ink: #0f766e;
  --accent-soft: #e8f7f5;

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .toolbar-btn {
    border-radius: 10px;
    font-weight: 600;
  }

  .toolbar-btn--neutral {
    background: #f7fafc;
    border-color: #d8e6f0;
    color: #255b79;
  }

  .toolbar-btn--neutral:hover {
    background: #eef5fb;
    border-color: #b8d6ea;
    color: #17445f;
  }

  .toolbar-btn--primary {
    color: #fff;
    border: none;
    background: linear-gradient(135deg, #1f7aa8 0%, #0f766e 100%);
  }

  .toolbar-btn--primary:hover {
    filter: brightness(1.03);
    box-shadow: 0 6px 14px rgba(20, 96, 132, 0.3);
  }

  .filters {
    margin-bottom: 20px;
    padding: 18px 20px 2px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(20px);
    box-shadow: var(--shadow-md);
  }

  .feedback-alert {
    margin-bottom: 20px;
  }

  :deep(.feedback-alert .el-alert__title) {
    color: #184a69;
    font-weight: 700;
  }

  .stats {
    margin-bottom: 20px;

      .stat-item {
        text-align: center;

        .label {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }

        .value {
          font-size: 24px;
          font-weight: bold;
          color: var(--text-primary);
        }
      }
    }

  .logs-list {
    padding: 20px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(20px);
    box-shadow: var(--shadow-md);

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

    :deep(.stats .el-card) {
      background: rgba(255, 255, 255, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.3);
      backdrop-filter: blur(20px);
      border-radius: 20px;
      box-shadow: var(--shadow-md);
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

      &__header {
        margin-bottom: 16px;

        h3 {
          margin: 0 0 8px;
          font-size: 18px;
          color: var(--el-text-color-primary);
        }

        p {
          margin: 0;
          color: var(--el-text-color-secondary);
          line-height: 1.6;
        }
      }

      &__scroller {
        overflow-x: auto;
      }

      :deep(.el-table) {
        min-width: 1120px;
      }

      .table-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }

      .table-action-btn {
        border-radius: 8px;
        font-weight: 600;
        width: 100%;
        justify-content: flex-start;
      }

      .table-action-btn--detail {
        color: var(--brand-ink);
        --el-fill-color-light: var(--brand-soft);
      }

      .table-action-btn--copy {
        color: var(--accent-ink);
        --el-fill-color-light: var(--accent-soft);
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

[data-theme="dark"] .agent-logs-page .toolbar-btn--neutral,
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
