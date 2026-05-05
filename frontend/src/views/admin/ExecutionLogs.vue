<template>
  <div class="execution-logs-page">
    <div class="bg-layer"><div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div></div>

    <div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title">
        <el-icon class="title-icon"><Cpu /></el-icon>
        Agent 监控与日志
      </h2>
      <p class="page-hero__subtitle">实时监控 Agent 运行状态，查看执行日志</p>
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
    </div>

    <!-- 筛选器 -->
    <div class="filter-section">
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
          <label>时间范围</label>
          <el-select
            v-model="filters.timeRange"
            placeholder="时间范围"
            class="filter-select"
          >
            <el-option label="今天" value="today" />
            <el-option label="昨天" value="yesterday" />
            <el-option label="最近7天" value="week" />
            <el-option label="最近30天" value="month" />
            <el-option label="全部" value="all" />
          </el-select>
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
            <el-tag size="small" :type="getAgentTagType(log.agentName)">
              {{ getAgentDisplayName(log.agentName) }}
            </el-tag>
            <el-tag size="small" :type="getLogStatusType(log.status)">
              {{ getLogStatusText(log.status) }}
            </el-tag>
            <span class="log-action">{{ log.action }}</span>
          </div>
          <div class="log-duration">
            <el-icon><Timer /></el-icon>
            {{ formatDuration(log.durationMs) }}
          </div>
        </div>

        <div class="log-preview">
          <div class="preview-row" v-if="log.input">
            <span class="preview-label">输入:</span>
            <span class="preview-content">{{ truncateJson(log.input, 100) }}</span>
          </div>
          <div class="preview-row" v-if="log.output && log.status === 'success'">
            <span class="preview-label">输出:</span>
            <span class="preview-content">{{ truncateJson(log.output, 100) }}</span>
          </div>
          <div class="preview-row error" v-if="log.error">
            <span class="preview-label">错误:</span>
            <span class="preview-content">{{ log.error }}</span>
          </div>
          <div class="preview-row" v-if="log.traceId">
            <span class="preview-label">Trace:</span>
            <span class="preview-content">{{ log.traceId }}</span>
          </div>
          <div class="preview-row" v-if="log.sessionId">
            <span class="preview-label">Session:</span>
            <span class="preview-content">{{ log.sessionId }}</span>
          </div>
        </div>

        <div class="log-actions">
          <el-button type="primary" size="small" @click="showDetail(log)">
            <el-icon><View /></el-icon>
            查看详情
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
      width="min(800px, 90vw)"
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

        <!-- 输入 -->
        <div class="detail-section" v-if="selectedLog.input">
          <div class="section-header">
            <h4>📥 输入</h4>
            <el-button type="default" size="small" @click="copyToClipboard(selectedLog.input)">
              <el-icon><DocumentCopy /></el-icon>
              复制
            </el-button>
          </div>
          <pre class="json-block">{{ formatJson(selectedLog.input) }}</pre>
        </div>

        <!-- 输出 -->
        <div class="detail-section" v-if="selectedLog.output && selectedLog.status === 'success'">
          <div class="section-header">
            <h4>📤 输出</h4>
            <el-button type="default" size="small" @click="copyToClipboard(selectedLog.output)">
              <el-icon><DocumentCopy /></el-icon>
              复制
            </el-button>
          </div>
          <pre class="json-block">{{ formatJson(selectedLog.output) }}</pre>
        </div>

        <!-- 错误 -->
        <div class="detail-section error" v-if="selectedLog.error">
          <div class="section-header">
            <h4>❌ 错误</h4>
            <el-button type="default" size="small" @click="copyToClipboard(selectedLog.error)">
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
  Cpu
} from '@element-plus/icons-vue';
import { useRoute } from 'vue-router';
import { adminAxios } from '@/api/adminApi';
import { toast } from '../../utils/toast';

interface Log {
  id: string;
  agentName: string;
  agentId?: string;
  action: string;
  status: 'success' | 'error' | 'timeout';
  input?: string;
  output?: string;
  error?: string;
  traceId?: string;
  sessionId?: string;
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
  timeout: 0
});

// 筛选器
const filters = reactive({
  agentName: '',
  agentId: '',
  traceId: '',
  sessionId: '',
  status: '',
  timeRange: 'today',
  keyword: ''
});

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
let refreshTimer: NodeJS.Timeout | null = null;

// 详情弹窗
const detailVisible = ref(false);
const selectedLog = ref<Log | null>(null);
const route = useRoute();

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
    if (filters.timeRange) params.timeRange = filters.timeRange;
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
    RequirementCollection: '需求收集',
    PathPlanning: '路径规划',
    Teaching: '教学执行',
    TeachingOrchestration: '教学编排',
    'ai-teaching': '教学编排',
    'ai-teaching-agent': '教学编排',
    LearningCompanion: '伴学介入',
    SessionWrapup: '课后产出'
  };
  return map[name] || name;
};

// 设置筛选
const setFilter = (key: string, value: string) => {
  (filters as any)[key] = value;
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
  filters.timeRange = 'today';
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
    const str = JSON.stringify(obj);
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
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
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; display: flex; align-items: center; gap: 0.5rem; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.title-icon {
  font-size: 1.75rem;
}

/* 统计栏 */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.04), rgba(141, 107, 255, 0.03), var(--glass-bg-light));
  border-radius: var(--fluent-radius-lg);
  border: 1px solid var(--glass-border-light);
  margin-bottom: 1.25rem;
  box-shadow: var(--shadow-sm);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
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

/* 筛选器 */
.filter-section {
  background: var(--glass-bg-light);
  padding: 1.25rem;
  border-radius: var(--fluent-radius-lg);
  border: 1px solid var(--glass-border-light);
  margin-bottom: 1.25rem;
  box-shadow: var(--shadow-sm);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  position: relative;
  z-index: 1;
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
  margin-bottom: 1rem;
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
  background: var(--glass-bg-light);
  border-radius: var(--fluent-radius-lg);
  padding: 1rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--glass-border-light);
  border-left: 4px solid transparent;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
}

.log-card:hover {
  box-shadow: var(--shadow-md);
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
  gap: 0.5rem;
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
}

.preview-row.error {
  color: var(--color-danger);
}

.preview-label {
  color: var(--text-secondary);
  font-weight: 500;
  flex-shrink: 0;
}

.preview-content {
  color: var(--text-primary);
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-actions {
  display: flex;
  gap: 0.5rem;
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
}

.detail-section h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.9375rem;
  color: var(--text-primary);
}

.detail-section.error h4 {
  color: var(--color-danger);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
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

.json-block,
.error-block {
  background: color-mix(in srgb, var(--bg-elevated) 82%, #0f172a 18%);
  color: var(--text-inverse);
  padding: 1rem;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.8125rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.error-block {
  background: color-mix(in srgb, var(--color-danger) 12%, var(--bg-surface) 88%);
  color: var(--color-danger-dark);
  border: 1px solid color-mix(in srgb, var(--color-danger) 35%, var(--bg-surface) 65%);
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

[data-theme="dark"] .page-hero {
  background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.08), transparent 34%), linear-gradient(180deg, rgba(30, 30, 40, 0.92), rgba(20, 20, 30, 0.92));
  border-color: rgba(52, 120, 246, 0.12);
}

[data-theme="dark"] .stats-bar,
[data-theme="dark"] .filter-section,
[data-theme="dark"] .log-card {
  background: var(--glass-bg-dark);
  border-color: var(--glass-border-dark);
}

[data-theme="dark"] .stats-bar {
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), rgba(141, 107, 255, 0.04), var(--glass-bg-dark));
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
