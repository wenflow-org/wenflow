<template>
  <div class="orchestrators-page">
    <div class="page-header">
      <h2 class="page-title">
        <el-icon class="page-title-icon"><Connection /></el-icon>
        编排器视图
      </h2>
      <p class="page-subtitle">监控 Agent 编排流程和执行链路</p>
    </div>

    <div class="toolbar">
      <el-select v-model="timeRange" class="time-select" size="large">
        <el-option label="今天" value="today" />
        <el-option label="昨天" value="yesterday" />
        <el-option label="近 7 天" value="week" />
        <el-option label="近 30 天" value="month" />
        <el-option label="全部" value="all" />
      </el-select>
      <el-switch
        v-model="showAggregated"
        inline-prompt
        active-text="看全编排链路"
        inactive-text="仅编排器本体"
      />
      <el-button type="primary" :loading="loading" @click="loadData">刷新</el-button>
    </div>

    <div class="cards-grid" v-loading="loading">
      <el-card v-for="item in orchestratorStats" :key="item.id" shadow="hover" class="stats-card">
        <div class="card-head">
          <div>
            <div class="card-title">{{ item.name }}</div>
            <div class="card-id">{{ item.id }}</div>
          </div>
          <el-tag :type="statusTagType(item.health)" size="small">{{ statusText(item.health) }}</el-tag>
        </div>

        <div class="metrics">
          <div class="metric"><span>总调用</span><strong>{{ item.total }}</strong></div>
          <div class="metric"><span>成功率</span><strong>{{ item.successRate.toFixed(1) }}%</strong></div>
          <div class="metric"><span>平均耗时</span><strong>{{ item.avgDuration }}ms</strong></div>
          <div class="metric"><span>超时数</span><strong>{{ item.timeout }}</strong></div>
        </div>

        <div class="member-row">
          <div class="member-head">
            <span class="member-title">所属 Agent</span>
            <div class="member-actions">
              <el-button text type="primary" size="small" @click="toggleMembers(item.id)">
                {{ expandedIds.has(item.id) ? '收起' : `查看(${item.members.length})` }}
              </el-button>
              <el-button text size="small" @click="goExecutionLogs(item)">查看日志</el-button>
            </div>
          </div>

          <div class="member-tags" v-if="expandedIds.has(item.id)">
            <el-tag
              v-for="member in item.members"
              :key="`${item.id}-${member.agentId}`"
              size="small"
              effect="plain"
              class="member-tag"
              @click="goExecutionLogsByMember(member.agentId)"
            >
              {{ member.name }}
            </el-tag>
          </div>
          <div class="member-tags" v-else>
            <el-tag
              v-for="member in item.members.slice(0, 4)"
              :key="`${item.id}-${member.agentId}`"
              size="small"
              effect="plain"
              class="member-tag"
              @click="goExecutionLogsByMember(member.agentId)"
            >
              {{ member.name }}
            </el-tag>
            <el-tag v-if="item.members.length > 4" size="small" effect="plain">+{{ item.members.length - 4 }}</el-tag>
          </div>
        </div>

        <div class="trend-title">最近调用趋势</div>
        <div class="trend-list" v-if="item.trend.length > 0">
          <div class="trend-row" v-for="point in item.trend" :key="`${item.id}-${point.label}`">
            <span class="trend-time">{{ point.label }}</span>
            <div class="trend-bar-wrap">
              <div class="trend-bar" :style="{ width: `${point.width}%` }"></div>
            </div>
            <span class="trend-value">{{ point.value }}</span>
          </div>
        </div>
        <el-empty v-else description="暂无趋势数据" :image-size="46" />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Connection } from '@element-plus/icons-vue';
import { adminAgentsApi, type OrchestratorRelationItem } from '@/api/adminApi';

type TimeRange = 'today' | 'yesterday' | 'week' | 'month' | 'all';

interface TrendPoint {
  label: string;
  value: number;
  width: number;
}

interface OrchestratorStats {
  id: string;
  name: string;
  group: string;
  total: number;
  success: number;
  timeout: number;
  error: number;
  successRate: number;
  avgDuration: number;
  health: 'healthy' | 'warning' | 'error' | 'idle';
  trend: TrendPoint[];
  members: Array<{
    agentId: string;
    name: string;
    role: 'agent' | 'orchestrator';
  }>;
}

const ORCHESTRATOR_DISPLAY_NAME: Record<string, string> = {
  'requirement-orchestrator': '需求编排器',
  'path-orchestrator': '路径编排器',
  'ai-teaching-agent': '教学编排器'
};

const router = useRouter();
const loading = ref(false);
const showAggregated = ref(true);
const timeRange = ref<TimeRange>('today');
const orchestratorStats = ref<OrchestratorStats[]>([]);
const expandedIds = ref(new Set<string>());

const loadOne = async (orchestrator: OrchestratorRelationItem): Promise<OrchestratorStats> => {
  const query = showAggregated.value
    ? { agentName: orchestrator.group }
    : { agentId: orchestrator.orchestratorId };

  const [baseRes, timeoutRes] = await Promise.all([
    adminAgentsApi.getLogs({
      page: 1,
      limit: 200,
      ...query,
      timeRange: timeRange.value
    }),
    adminAgentsApi.getLogs({
      page: 1,
      limit: 1,
      ...query,
      timeRange: timeRange.value,
      status: 'timeout'
    })
  ]);

  const payload = baseRes.data?.data || {};
  const logs = payload.logs || [];
  const stats = payload.stats || { total: 0, success: 0, error: 0, timeout: 0 };
  const timeoutCount = timeoutRes.data?.data?.stats?.timeout ?? 0;

  const avgDuration = logs.length > 0
    ? Math.round(logs.reduce((sum: number, log: any) => sum + (log.durationMs || 0), 0) / logs.length)
    : 0;

  const successRate = stats.total > 0 ? (stats.success / stats.total) * 100 : 100;
  const health = calcHealth(stats.total, successRate, timeoutCount);

  return {
    id: orchestrator.orchestratorId,
    name: ORCHESTRATOR_DISPLAY_NAME[orchestrator.orchestratorId] || orchestrator.orchestratorId,
    group: orchestrator.group,
    total: stats.total || 0,
    success: stats.success || 0,
    timeout: timeoutCount,
    error: stats.error || 0,
    successRate,
    avgDuration,
    health,
    trend: buildTrend(logs),
    members: orchestrator.members
  };
};

const buildTrend = (logs: any[]): TrendPoint[] => {
  const buckets = new Map<string, number>();
  const sorted = [...logs]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-8);

  for (const log of sorted) {
    const d = new Date(log.createdAt);
    const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }

  const points = Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
  const max = points.reduce((m, p) => Math.max(m, p.value), 1);

  return points.map(point => ({
    ...point,
    width: Math.max(6, Math.round((point.value / max) * 100))
  }));
};

const calcHealth = (total: number, successRate: number, timeout: number): 'healthy' | 'warning' | 'error' | 'idle' => {
  if (total === 0) return 'idle';
  if (successRate >= 95 && timeout === 0) return 'healthy';
  if (successRate >= 80) return 'warning';
  return 'error';
};

const statusTagType = (status: OrchestratorStats['health']) => {
  if (status === 'healthy') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'error') return 'danger';
  return 'info';
};

const statusText = (status: OrchestratorStats['health']) => {
  if (status === 'healthy') return '健康';
  if (status === 'warning') return '预警';
  if (status === 'error') return '异常';
  return '空闲';
};

const toggleMembers = (orchestratorId: string) => {
  const next = new Set(expandedIds.value);
  if (next.has(orchestratorId)) {
    next.delete(orchestratorId);
  } else {
    next.add(orchestratorId);
  }
  expandedIds.value = next;
};

const goExecutionLogs = (item: OrchestratorStats) => {
  router.push({
    name: 'AdminExecutionLogs',
    query: {
      agentName: item.group,
      source: 'orchestrators'
    }
  });
};

const goExecutionLogsByMember = (agentId: string) => {
  router.push({
    name: 'AdminExecutionLogs',
    query: {
      agentId,
      source: 'orchestrators'
    }
  });
};

const loadData = async () => {
  loading.value = true;
  try {
    const relationRes = await adminAgentsApi.getOrchestratorRelations();
    const orchestrators = relationRes.data?.data?.orchestrators || [];
    const result = await Promise.all(orchestrators.map(loadOne));
    orchestratorStats.value = result;
  } catch (error) {
    console.error('加载编排器视图失败:', error);
    ElMessage.error('加载编排器视图失败');
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);
</script>

<style scoped>
.orchestrators-page {
  padding: 1.25rem;
  padding-bottom: 24px;
}

.page-header {
  margin-bottom: 1rem;
}

.page-title {
  margin: 0;
  color: var(--text-primary);
}

.page-subtitle {
  margin: 0.4rem 0 0;
  color: var(--text-secondary);
}

.toolbar {
  margin-bottom: 1rem;
  display: flex;
  gap: 0.7rem;
  align-items: center;
}

.time-select {
  width: 180px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 1rem;
}

.stats-card {
  border-radius: var(--fluent-radius-lg);
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 0.8rem;
}

.card-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.card-id {
  margin-top: 0.15rem;
  font-family: monospace;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
  margin-bottom: 0.9rem;
}

.metric {
  border: 1px solid var(--border-default);
  border-radius: var(--fluent-radius-md);
  padding: 0.55rem 0.65rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.metric span {
  color: var(--text-secondary);
  font-size: 0.84rem;
}

.metric strong {
  color: var(--text-primary);
}

.member-row {
  margin-bottom: 0.8rem;
}

.member-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.45rem;
}

.member-title {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.member-actions {
  display: flex;
  gap: 0.35rem;
}

.member-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.member-tag {
  cursor: pointer;
}

.trend-title {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-bottom: 0.45rem;
}

.trend-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.trend-row {
  display: grid;
  grid-template-columns: 48px 1fr 24px;
  gap: 0.45rem;
  align-items: center;
}

.trend-time {
  font-family: monospace;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.trend-bar-wrap {
  height: 7px;
  border-radius: 999px;
  background: var(--bg-muted);
}

.trend-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #14b8a6, #0ea5e9);
}

.trend-value {
  text-align: right;
  color: var(--text-primary);
  font-size: 0.8rem;
}
</style>
