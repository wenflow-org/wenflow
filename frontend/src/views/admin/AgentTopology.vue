<!--
  AgentTopology.vue
  ============================================================
  路由: /admin/agents/topology
  作用: 可视化 5 Agent x N Skill 拓扑关系 + 调用统计

  节点类型: agent (5 个顶层 Agent, 紫色大卡片) / skill (下属 Skill, 白底小卡片, 按 parent agent 列分布)

  交互: 点击 Skill 节点 -> 跳转 Skill 编辑, 时间窗口切换 (24h / 7d / 30d), 失败率高亮 (successRate < 90% 红边框)

  依赖：@vue-flow/core
-->
<template>
  <div class="admin-page topology-page">
    <AdminPageHeader
      title="Agent 拓扑"
      :icon="Connection"
      :highlights="topologyHighlights"
    >
      <template #actions>
        <el-button type="primary" :icon="Grid" @click="router.push('/admin/skills')">
          Skill 目录
        </el-button>
        <el-radio-group v-model="range" size="default" @change="loadAll">
          <el-radio-button value="24h">24 小时</el-radio-button>
          <el-radio-button value="7d">7 天</el-radio-button>
          <el-radio-button value="30d">30 天</el-radio-button>
        </el-radio-group>
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </template>
    </AdminPageHeader>

    <section class="admin-list-card topology-panel">
        <div class="admin-section-head topology-panel__head">
          <div class="admin-section-head__copy">
            <h3 class="admin-section-head__title">运行拓扑</h3>
          </div>
        <div class="topology-panel__meta">
          <span>{{ rangeLabel }} 视图</span>
          <span v-if="summary">{{ summary.agentCount }} Agent / {{ summary.skillCount }} Skill</span>
        </div>
      </div>

      <div class="topology-panel__legend">
        <span class="topology-panel__legend-item">
          <span class="topology-panel__legend-dot topology-panel__legend-dot--agent"></span>
          Agent 节点
        </span>
        <span class="topology-panel__legend-item">
          <span class="topology-panel__legend-dot topology-panel__legend-dot--skill"></span>
          Skill 节点
        </span>
        <span class="topology-panel__legend-item">
          <span class="topology-panel__legend-dot topology-panel__legend-dot--idle"></span>
          空闲 / 低调用
        </span>
        <span class="topology-panel__legend-item">
          <span class="topology-panel__legend-dot topology-panel__legend-dot--danger"></span>
          成功率异常
        </span>
      </div>

      <div class="topology-canvas" v-loading="loading">
        <VueFlow
          v-if="elements.length > 0"
          :model-value="elements"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :elements-selectable="true"
          :pan-on-drag="true"
          :zoom-on-scroll="true"
          :min-zoom="0.3"
          :max-zoom="1.5"
          :default-viewport="{ x: 0, y: 0, zoom: 0.85 }"
          fit-view-on-init
          class="vf-canvas"
        >
          <Background pattern-color="#d8e0ed" :gap="18" />
          <Controls />

          <template #node-agent="{ data }">
            <div class="vf-agent-node" :class="`vf-agent-node--${data.monitoringGroup?.toLowerCase()}`">
              <div class="vf-agent-node__head">
                <span class="vf-agent-node__kind">AGENT</span>
                <span v-if="data.stats?.totalCalls > 0" class="vf-agent-node__pulse"></span>
              </div>
              <div class="vf-agent-node__title">{{ data.label }}</div>
              <div class="vf-agent-node__desc">{{ data.description }}</div>
              <div class="vf-agent-node__stats">
                <div class="stat-cell">
                  <div class="num">{{ data.memberCount }}</div>
                  <div class="lbl">下辖 Skill</div>
                </div>
                <div class="stat-cell">
                  <div class="num">{{ data.stats?.totalCalls || 0 }}</div>
                  <div class="lbl">调用</div>
                </div>
                <div class="stat-cell">
                  <div class="num">{{ data.stats?.successRate != null ? `${data.stats.successRate}%` : '--' }}</div>
                  <div class="lbl">成功率</div>
                </div>
              </div>
            </div>
          </template>

          <template #node-skill="{ data }">
            <div
              class="vf-skill-node"
              :class="{
                'vf-skill-node--idle': !data.stats?.totalCalls,
                'vf-skill-node--unhealthy': data.stats?.totalCalls > 0 && (data.stats?.successRate ?? 100) < 90
              }"
              role="button"
              tabindex="0"
              @click="openSkillWorkbench(data)"
              @keydown.enter="openSkillWorkbench(data)"
              @keydown.space.prevent="openSkillWorkbench(data)"
            >
              <div class="vf-skill-node__head">
                <span class="vf-skill-node__kind">SKILL</span>
                <span v-if="data.noPromptFile" class="vf-skill-node__chip" title="该节点由代码处理，没有独立 Prompt 文件">代码节点</span>
              </div>
              <div class="vf-skill-node__title">{{ data.label }}</div>
              <div class="vf-skill-node__stats">
                <span class="mini-stat">
                  <span class="num">{{ data.stats?.totalCalls || 0 }}</span>
                  <span class="lbl">调用</span>
                </span>
                <span class="mini-stat" v-if="data.stats?.successRate != null">
                  <span class="num">{{ data.stats.successRate }}%</span>
                  <span class="lbl">成功</span>
                </span>
                <span class="mini-stat" v-if="data.stats?.avgDuration">
                  <span class="num">{{ Math.round(data.stats.avgDuration / 100) / 10 }}s</span>
                  <span class="lbl">平均</span>
                </span>
              </div>
            </div>
          </template>
        </VueFlow>

        <el-result
          v-else-if="!loading && loadError"
          icon="error"
          title="拓扑数据加载失败"
          :sub-title="loadError"
        >
          <template #extra>
            <el-button type="primary" @click="loadAll">重新加载</el-button>
          </template>
        </el-result>
        <el-empty v-else-if="!loading" description="暂无拓扑数据" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh, Grid, Connection } from '@element-plus/icons-vue';
import AdminPageHeader from './components/AdminPageHeader.vue';
import { VueFlow, Position, type Node, type Edge } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import { adminAgentTopologyApi } from '@/api/adminApi';
import { toast } from '@/utils/toast';

const router = useRouter();

interface TopologySummary {
  agentCount?: number;
  skillCount?: number;
  totalCalls?: number;
  unhealthyCount: number;
  [key: string]: unknown;
}

interface TopologyNode {
  id: string;
  type?: string;
  parentAgentId?: string;
  [key: string]: unknown;
}

interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

const range = ref<'24h' | '7d' | '30d'>('7d');
const loading = ref(false);
const loadError = ref('');
const summary = ref<TopologySummary | null>(null);
const elements = ref<Array<Node | Edge>>([]);

const rangeLabel = computed(() => {
  if (range.value === '24h') return '24 小时';
  if (range.value === '30d') return '30 天';
  return '7 天';
});

const topologyHighlights = computed(() => {
  if (!summary.value) return [];
  return [
    { label: `${summary.value.agentCount} 个 Agent`, tone: 'info' as const },
    { label: `${summary.value.skillCount} 个 Skill`, tone: 'neutral' as const },
    { label: `${summary.value.totalCalls} 次调用 (${rangeLabel.value})`, tone: 'neutral' as const },
    {
      label: summary.value.unhealthyCount > 0
        ? `${summary.value.unhealthyCount} 个异常`
        : '全部健康',
      tone: summary.value.unhealthyCount > 0 ? 'danger' as const : 'success' as const
    }
  ];
});


const AGENT_WIDTH = 260;
const AGENT_HEIGHT = 180;
const SKILL_WIDTH = 220;
const SKILL_HEIGHT = 130;
const AGENT_GAP_X = 320;
const SKILL_GAP_Y = 30;
const SKILL_TOP_OFFSET = 250;

async function loadAll() {
  loading.value = true;
  loadError.value = '';
  try {
    const r = await adminAgentTopologyApi.getTopology(range.value);
    const { nodes, edges, summary: s } = r.data?.data || {};
    summary.value = s;
    elements.value = buildElements(nodes || [], edges || []);
  } catch (err: any) {
    loadError.value = '无法获取拓扑数据，请检查服务连接后重试。';
    toast.error(err?.response?.data?.error?.message || '加载拓扑失败');
  } finally {
    loading.value = false;
  }
}

function buildElements(rawNodes: TopologyNode[], rawEdges: TopologyEdge[]): Array<Node | Edge> {
  const result: Array<Node | Edge> = [];

  const agents = rawNodes.filter(n => n.type === 'agent');
  const skills = rawNodes.filter(n => n.type === 'skill');

  // 5 Agent 横排
  agents.forEach((agent, i) => {
    result.push({
      id: agent.id,
      type: 'agent',
      position: { x: i * AGENT_GAP_X, y: 0 },
      data: agent,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: { width: `${AGENT_WIDTH}px`, height: `${AGENT_HEIGHT}px` }
    } as Node);
  });

  // 每个 Agent 下方按列排下属 Skills
  const agentIndex = new Map(agents.map((a, i) => [a.id, i]));
  const skillCountPerAgent = new Map<string, number>();

  skills.forEach((skill) => {
    const parentIdx = agentIndex.get(skill.parentAgentId || '');
    if (parentIdx == null) return;
    const localIdx = skillCountPerAgent.get(skill.parentAgentId || '') || 0;
    skillCountPerAgent.set(skill.parentAgentId || '', localIdx + 1);

    // Agent 中心 x = parentIdx * AGENT_GAP_X + AGENT_WIDTH/2
    // Skill 中心 x = Agent 中心 x（垂直对齐）
    const skillX = parentIdx * AGENT_GAP_X + (AGENT_WIDTH - SKILL_WIDTH) / 2;
    const skillY = SKILL_TOP_OFFSET + localIdx * (SKILL_HEIGHT + SKILL_GAP_Y);

    result.push({
      id: skill.id,
      type: 'skill',
      position: { x: skillX, y: skillY },
      data: skill,
      sourcePosition: Position.Top,
      targetPosition: Position.Top,
      style: { width: `${SKILL_WIDTH}px`, height: `${SKILL_HEIGHT}px` }
    } as Node);
  });

  // edges
  rawEdges.forEach((edge) => {
    result.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: false,
      style: { stroke: '#a78bfa', strokeWidth: 1.5 }
    } as Edge);
  });

  return result;
}

function openSkillWorkbench(data: { id?: string }) {
  router.push({ name: 'AdminAgentEditor', params: { agentId: (data.id || '').replace(/^skill:/, '') } });
}

onMounted(() => {
  loadAll();
});
</script>

<style scoped>
.topology-page {
  /* 继承 admin-page 的 display: grid, padding, background */
  gap: 16px;
}

.topology-panel {
  padding: 18px 20px;
}

.topology-panel__head {
  margin-bottom: 12px;
}

.topology-panel__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  color: var(--admin-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.topology-panel__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 12px;
  color: var(--admin-text-muted);
  font-size: var(--admin-text-micro);
  font-weight: 600;
}

.topology-panel__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.topology-panel__legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.topology-panel__legend-dot--agent {
  background: #2f5dac;
}

.topology-panel__legend-dot--skill {
  background: var(--admin-text-brand);
}

.topology-panel__legend-dot--danger {
  background: var(--admin-color-error);
}

.topology-panel__legend-dot--idle {
  background: transparent;
  border: 1px dashed #94a3b8;
}

.topology-canvas {
  flex: 1;
  min-height: 720px;
  background: linear-gradient(180deg, #fcfdff, #f6f8fc);
  border: var(--admin-border-subtle);
  border-radius: 16px;
  overflow: hidden;
  position: relative;
}

.vf-canvas {
  width: 100%;
  height: 100%;
  min-height: 720px;
}

/* ========== Agent node ========== */
.vf-agent-node {
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #f7faff, #eef4ff);
  color: var(--admin-text-primary);
  border: 1px solid rgba(52, 120, 246, 0.28);
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 12px 28px rgba(46, 86, 148, 0.12);
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: default;
  user-select: none;
}

.vf-agent-node__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vf-agent-node__kind {
  font-size: var(--admin-text-micro);
  font-weight: 800;
  letter-spacing: 0.08em;
  background: rgba(52, 120, 246, 0.08);
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--admin-text-brand);
}

.vf-agent-node__pulse {
  width: 8px;
  height: 8px;
  background: #4ade80;
  border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
  100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
}

.vf-agent-node__title {
  font-size: 17px;
  font-weight: 800;
  color: var(--admin-text-primary);
}

.vf-agent-node__desc {
  font-size: var(--admin-text-micro);
  color: var(--admin-text-secondary);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.vf-agent-node__stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1px;
  margin-top: auto;
  background: rgba(205, 216, 238, 0.95);
  border: 1px solid rgba(205, 216, 238, 0.95);
  border-radius: 10px;
  overflow: hidden;
}

.vf-agent-node__stats .stat-cell {
  text-align: center;
  font-size: var(--admin-text-micro);
  padding: 8px 4px;
  background: rgba(255, 255, 255, 0.88);
}

.vf-agent-node__stats .num {
  font-size: var(--admin-text-title-sm);
  font-weight: 800;
  font-family: 'JetBrains Mono', Consolas, monospace;
  color: var(--admin-text-primary);
}

.vf-agent-node__stats .lbl {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--admin-text-muted);
}

/* ========== Skill node ========== */
.vf-skill-node {
  width: 100%;
  height: 100%;
  position: relative;
  background: var(--admin-bg-surface);
  border: 1px solid rgba(52, 120, 246, 0.18);
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 8px 24px rgba(46, 86, 148, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.vf-skill-node:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(46, 86, 148, 0.12);
  border-color: rgba(52, 120, 246, 0.26);
}

.vf-skill-node--idle {
  opacity: 0.6;
  border-style: dashed;
  background: var(--admin-bg-surface-alt);
}

.vf-skill-node--unhealthy {
  border-color: rgba(239, 68, 68, 0.45);
  background: linear-gradient(180deg, white, rgba(239, 68, 68, 0.04));
}

.vf-skill-node__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.vf-skill-node__kind {
  font-size: var(--admin-text-micro);
  font-weight: 800;
  letter-spacing: 0.08em;
  background: rgba(52, 120, 246, 0.08);
  color: var(--admin-text-brand);
  padding: 3px 8px;
  border-radius: 999px;
}

.vf-skill-node__chip {
  font-size: 9px;
  background: rgba(217, 119, 6, 0.1);
  color: var(--admin-color-warning);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 700;
}

.vf-skill-node__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--admin-text-primary);
  display: block;
  line-height: 1.5;
  min-height: calc(13px * 1.5);
  max-height: calc(13px * 1.5 * 2);
  padding-top: 2px;
  flex-shrink: 0;
  overflow-wrap: anywhere;
  overflow: hidden;
}

.vf-skill-node__stats {
  display: flex;
  gap: 10px;
  margin-top: auto;
  flex-shrink: 0;
}

.vf-skill-node__stats .mini-stat {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.vf-skill-node__stats .num {
  font-size: 12px;
  font-weight: 700;
  color: var(--admin-text-primary);
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.vf-skill-node__stats .lbl {
  font-size: 9px;
  color: var(--admin-text-muted);
  text-transform: uppercase;
}

.topology-panel :deep(.vue-flow__controls) {
  border-radius: 12px;
  border: 1px solid rgba(205, 216, 238, 0.95);
  overflow: hidden;
}

.topology-panel :deep(.vue-flow__edge-textbg) {
  fill: rgba(255, 255, 255, 0.9);
}

.topology-panel :deep(.vue-flow__attribution) {
  display: none;
}

@media (max-width: 768px) {
  .topology-panel {
    padding: 16px;
  }

  .topology-panel__meta,
  .topology-panel__legend {
    gap: 10px;
  }

  .topology-canvas,
  .vf-canvas {
    min-height: 580px;
  }
}
</style>
