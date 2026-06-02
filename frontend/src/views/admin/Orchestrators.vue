<template>
  <div class="orchestrators-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title">
        编排监控
      </h2>
      <p class="page-hero__subtitle">监控编排链路的调用趋势、成功率、超时与成员活跃情况。</p>
    </div>

    <div class="toolbar-panel" style="position: relative; z-index: 1;">
      <div class="toolbar-panel__intro">
        <div>
          <h3>监控范围</h3>
          <p>默认先看各编排器的整体健康，再按需展开成员和最近趋势，结构设计请前往编排定义。</p>
        </div>
      </div>
      <div class="toolbar">
        <el-select v-model="timeRange" class="time-select">
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
    </div>

    <div class="overview-strip" v-if="orchestratorStats.length" style="position: relative; z-index: 1;">
      <div class="overview-pill">
        <span class="overview-pill__label">编排器</span>
        <strong>{{ orchestratorStats.length }}</strong>
      </div>
      <div class="overview-pill">
        <span class="overview-pill__label">健康</span>
        <strong>{{ orchestratorStats.filter(item => item.health === 'healthy').length }}</strong>
      </div>
      <div class="overview-pill">
        <span class="overview-pill__label">预警/异常</span>
        <strong>{{ orchestratorStats.filter(item => item.health === 'warning' || item.health === 'error').length }}</strong>
      </div>
      <div class="overview-pill">
        <span class="overview-pill__label">总调用</span>
        <strong>{{ orchestratorStats.reduce((sum, item) => sum + item.total, 0) }}</strong>
      </div>
    </div>

    <div class="orchestrator-list-card" v-loading="loading" style="position: relative; z-index: 1;">
      <div v-if="orchestratorStats.length" class="orchestrator-list">
        <article v-for="item in orchestratorStats" :key="item.id" class="orchestrator-row" :class="`orchestrator-row--${item.health}`">
          <div class="orchestrator-row__summary">
            <div class="orchestrator-row__identity">
              <div class="orchestrator-row__title-row">
                <strong class="orchestrator-row__name">{{ item.name }}</strong>
                <el-tag :type="statusTagType(item.health)" size="small">{{ statusText(item.health) }}</el-tag>
              </div>
              <div class="orchestrator-row__meta">
                <span>{{ item.id }}</span>
                <span>成员 {{ item.members.length }}</span>
                <span>{{ showAggregated ? '聚合全编排链路' : '仅编排器本体' }}</span>
              </div>
            </div>

            <div class="orchestrator-row__metrics">
              <div class="orchestrator-metric">
                <span>总调用</span>
                <strong>{{ item.total }}</strong>
              </div>
              <div class="orchestrator-metric">
                <span>成功率</span>
                <strong>{{ item.successRate.toFixed(1) }}%</strong>
              </div>
              <div class="orchestrator-metric">
                <span>平均耗时</span>
                <strong>{{ item.avgDuration }}ms</strong>
              </div>
              <div class="orchestrator-metric">
                <span>超时</span>
                <strong>{{ item.timeout }}</strong>
              </div>
            </div>

            <div class="orchestrator-row__actions">
              <el-button class="table-link-btn" @click="toggleMembers(item.id)">
                {{ expandedIds.has(item.id) ? '收起详情' : '展开详情' }}
              </el-button>
              <el-button class="table-link-btn" @click="goExecutionLogs(item)">查看日志</el-button>
            </div>
          </div>

          <div v-if="expandedIds.has(item.id)" class="orchestrator-row__details">
            <section class="detail-panel">
              <div class="detail-panel__header">
                <h4>成员 Agent</h4>
                <span>{{ item.members.length }} 个</span>
              </div>
              <div class="member-tags">
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
            </section>

            <section class="detail-panel">
              <div class="detail-panel__header">
                <h4>最近调用趋势</h4>
                <span>{{ item.trend.length ? '近 8 个采样点' : '暂无数据' }}</span>
              </div>
              <div class="trend-list" v-if="item.trend.length > 0">
                <div class="trend-row" v-for="point in item.trend" :key="`${item.id}-${point.label}`">
                  <span class="trend-time">{{ point.label }}</span>
                  <div class="trend-bar-wrap">
                    <div class="trend-bar" :style="{ width: `${point.width}%` }"></div>
                  </div>
                  <span class="trend-value">{{ point.value }}</span>
                </div>
              </div>
              <el-empty v-else description="暂无趋势数据" :image-size="42" />
            </section>
          </div>
        </article>
      </div>
      <el-empty v-else description="暂无编排器监控数据" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Connection } from '@element-plus/icons-vue';
import { adminAgentsApi, type OrchestratorRelationItem } from '@/api/adminApi';
import { toast } from '../../utils/toast';

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
  'simulation-orchestrator': '虚拟学习者编排器',
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
    console.error('加载编排监控失败:', error);
    toast.error('加载编排监控失败');
  } finally {
    loading.value = false;
  }
};

watch([timeRange, showAggregated], () => {
  loadData();
});

onMounted(loadData);
</script>

<style scoped>
.orchestrators-page {
  padding: 1.25rem;
  padding-bottom: 24px;
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
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.toolbar {
  display: flex;
  gap: 0.7rem;
  align-items: center;
  flex-wrap: wrap;
}

.toolbar-panel {
  margin-bottom: 1rem;
  padding: 16px 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 255, 0.92));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08);
}

.toolbar-panel__intro {
  margin-bottom: 12px;
}

.toolbar-panel__intro h3 {
  margin: 0;
  color: #22344d;
  font-size: 1rem;
}

.toolbar-panel__intro p {
  margin: 6px 0 0;
  color: #7085a6;
  font-size: 0.875rem;
  line-height: 1.6;
}

.time-select {
  width: 180px;
}

.overview-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.overview-pill {
  border-radius: 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 255, 0.96));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08);
  padding: 14px 16px;
  display: grid;
  gap: 6px;
}

.overview-pill__label {
  color: #7b8ba3;
  font-size: 0.75rem;
  font-weight: 600;
}

.overview-pill strong {
  color: #22344d;
  font-size: 1.6rem;
  line-height: 1;
  letter-spacing: -0.04em;
}

.orchestrator-list-card {
  width: 100%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  padding: 0.8rem;
  box-shadow: 0 18px 40px rgba(42, 72, 128, 0.1);
}

.orchestrator-list {
  display: grid;
  gap: 12px;
}

.orchestrator-row {
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 22px;
  padding: 16px 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(247, 250, 255, 0.95));
  display: grid;
  gap: 14px;
}

.orchestrator-row--warning {
  box-shadow: inset 3px 0 0 rgba(245, 158, 11, 0.22);
}

.orchestrator-row--error {
  box-shadow: inset 3px 0 0 rgba(239, 68, 68, 0.22);
}

.orchestrator-row__summary {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr) auto;
  gap: 14px;
  align-items: center;
}

.orchestrator-row__identity,
.orchestrator-row__metrics {
  min-width: 0;
}

.orchestrator-row__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.orchestrator-row__name {
  color: #22344d;
  font-size: 1.05rem;
  line-height: 1.3;
}

.orchestrator-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 6px;
  color: #7085a6;
  font-size: 12px;
}

.orchestrator-row__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.orchestrator-metric {
  border: 1px solid rgba(205, 216, 238, 0.86);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.94));
  padding: 10px 12px;
  display: grid;
  gap: 3px;
}

.orchestrator-metric span {
  color: #7b8ba3;
  font-size: 12px;
  font-weight: 700;
}

.orchestrator-metric strong {
  color: #22344d;
  font-size: 13px;
}

.orchestrator-row__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.table-link-btn {
  border-radius: 14px;
  font-weight: 700;
  min-height: 32px;
  padding: 0 12px;
  color: var(--color-primary-dark, #1f57cc);
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(244, 249, 255, 0.96);
}

.orchestrator-row__details {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.detail-panel {
  border: 1px solid rgba(205, 216, 238, 0.86);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.95));
  padding: 14px 16px;
  display: grid;
  gap: 10px;
}

.detail-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.detail-panel__header h4 {
  margin: 0;
  color: #22344d;
  font-size: 0.95rem;
}

.detail-panel__header span,
.member-title,
.trend-title {
  color: #7b8ba3;
  font-size: 12px;
  font-weight: 700;
}

.member-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.member-tag {
  cursor: pointer;
}

.trend-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.trend-row {
  display: grid;
  grid-template-columns: 48px 1fr 36px;
  gap: 0.45rem;
  align-items: center;
}

.trend-time {
  font-family: monospace;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.trend-bar-wrap {
  height: 10px;
  border-radius: 999px;
  background: var(--bg-muted);
}

.trend-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #14b8a6, #0ea5e9);
  box-shadow: 0 0 8px rgba(20, 184, 166, 0.3);
}

.trend-value {
  text-align: right;
  color: var(--text-primary);
  font-size: 0.8rem;
}

@media (max-width: 1080px) {
  .overview-strip,
  .orchestrator-row__details {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .orchestrator-row__summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .orchestrator-row__actions {
    justify-content: flex-start;
  }

  .orchestrator-row__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .overview-strip,
  .orchestrator-row__details,
  .orchestrator-row__metrics {
    grid-template-columns: minmax(0, 1fr);
  }

  .page-hero,
  .toolbar-panel,
  .orchestrator-row,
  .detail-panel {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
