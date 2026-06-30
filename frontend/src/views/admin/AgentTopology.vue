<!--
  AgentTopology.vue
  ============================================================
  路由�?admin/agents/topology
  作用：可视化 5 Agent × N Skill 拓扑关系 + 调用统计

  节点类型�?    - agent�? 个顶�?Agent（紫色大卡片�?    - skill：下�?Skill（白底小卡片，按 parent agent 列分布）

  交互�?    - �?Skill 节点 �?跳转 Skill 编辑
    - 时间窗口切换�?4h / 7d / 30d�?    - 失败率高亮（successRate < 90% 红边框）

  依赖：@vue-flow/core
-->
<template>
  <div class="topology-page">
    <AdminPageHeader
      kicker="Agent 拓扑"
      title="5 Agent × 22 Skill 拓扑"
      desc="可视化平�?5 个顶�?Agent �?22 �?Skill 的隶属关系与运行健康。点�?Skill 节点直达 Skill 编辑�?
    >
      <template #actions>
        <el-button type="primary" :icon="Grid" @click="router.push('/admin/skills')">
          运行节点管理
        </el-button>
        <el-radio-group v-model="range" size="default" @change="loadAll">
          <el-radio-button value="24h">24 小时</el-radio-button>
          <el-radio-button value="7d">7 �?/el-radio-button>
          <el-radio-button value="30d">30 �?/el-radio-button>
        </el-radio-group>
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </template>
    </AdminPageHeader>

    <section class="health-strip" v-if="summary">
      <div class="health-card">
        <div class="label">顶层 Agent</div>
        <div class="value">{{ summary.agentCount }}</div>
      </div>
      <div class="health-card">
        <div class="label">下辖 Skill</div>
        <div class="value">{{ summary.skillCount }}</div>
      </div>
      <div class="health-card">
        <div class="label">{{ rangeLabel }} 调用</div>
        <div class="value">{{ summary.totalCalls }}</div>
      </div>
      <div class="health-card" :class="{ 'health-card--danger': summary.unhealthyCount > 0 }">
        <div class="label">异常节点</div>
        <div class="value">{{ summary.unhealthyCount }}</div>
      </div>
      <div class="health-card health-card--muted">
        <div class="label">空闲 Skill</div>
        <div class="value">{{ summary.idleCount }}</div>
      </div>
    </section>

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
        <Background pattern-color="#cdd8ee" :gap="24" />
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
                <div class="num">{{ data.stats?.successRate != null ? `${data.stats.successRate}%` : '�? }}</div>
                <div class="lbl">成功�?/div>
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
            @click="openSkillWorkbench(data)"
          >
            <div class="vf-skill-node__head">
              <span class="vf-skill-node__kind">SKILL</span>
              <span v-if="data.noPromptFile" class="vf-skill-node__chip" title="无独�?prompt 文件，handler-only">handler</span>
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
            <div class="vf-skill-node__hint">点击进入 Skill 编辑 �?/div>
          </div>
        </template>
      </VueFlow>

      <el-empty v-else-if="!loading" description="�?manifest 数据" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh, Grid } from '@element-plus/icons-vue';
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

const range = ref<'24h' | '7d' | '30d'>('7d');
const loading = ref(false);
const summary = ref<any>(null);
const elements = ref<Array<Node | Edge>>([]);

const rangeLabel = computed(() => {
  if (range.value === '24h') return '24 小时';
  if (range.value === '30d') return '30 �?;
  return '7 �?;
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
  try {
    const r: any = await adminAgentTopologyApi.getTopology(range.value);
    const { nodes, edges, summary: s } = r.data?.data || {};
    summary.value = s;
    elements.value = buildElements(nodes || [], edges || []);
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '加载拓扑失败');
  } finally {
    loading.value = false;
  }
}

function buildElements(rawNodes: any[], rawEdges: any[]): Array<Node | Edge> {
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

  // 每个 Agent 下方按列排下�?Skills
  const agentIndex = new Map(agents.map((a, i) => [a.id, i]));
  const skillCountPerAgent = new Map<string, number>();

  skills.forEach((skill) => {
    const parentIdx = agentIndex.get(skill.parentAgentId);
    if (parentIdx == null) return;
    const localIdx = skillCountPerAgent.get(skill.parentAgentId) || 0;
    skillCountPerAgent.set(skill.parentAgentId, localIdx + 1);

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

function openSkillWorkbench(data: any) {
  router.push({ name: 'AdminAgentEditor', params: { agentId: data.id } });
}

onMounted(() => {
  loadAll();
});
</script>

<style scoped>
.topology-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px;
  min-height: 100%;
}

/* 页头�?AdminPageHeader 组件统一管理 */

.health-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.health-card {
  background: var(--admin-bg-surface);
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 12px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.health-card .label {
  font-size: 12px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.health-card .value {
  font-size: 28px;
  font-weight: 800;
  font-family: 'JetBrains Mono', Consolas, monospace;
  color: #1a2a44;
}

.health-card--danger .value {
  color: #b91c1c;
}

.health-card--muted .value {
  color: #94a3b8;
}

.topology-canvas {
  flex: 1;
  min-height: 720px;
  background: linear-gradient(180deg, #f8fafc, #eef2ff);
  border: 1px solid rgba(205, 216, 238, 0.9);
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
  background: linear-gradient(135deg, #6d28d9, #4338ca);
  color: white;
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 6px 24px rgba(99, 102, 241, 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: default;
  user-select: none;
}

.vf-agent-node__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vf-agent-node__kind {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  background: var(--admin-bg-surface);
  padding: 3px 8px;
  border-radius: 6px;
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
  font-size: 18px;
  font-weight: 800;
}

.vf-agent-node__desc {
  font-size: 11px;
  opacity: 0.85;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.vf-agent-node__stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
  margin-top: auto;
  background: var(--admin-bg-surface);
  border-radius: 8px;
  padding: 8px 4px;
}

.vf-agent-node__stats .stat-cell {
  text-align: center;
  font-size: 11px;
}

.vf-agent-node__stats .num {
  font-size: 16px;
  font-weight: 800;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.vf-agent-node__stats .lbl {
  font-size: 9px;
  opacity: 0.75;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ========== Skill node ========== */
.vf-skill-node {
  width: 100%;
  height: 100%;
  background: var(--admin-bg-surface);
  border: 1.5px solid rgba(139, 92, 246, 0.25);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}

.vf-skill-node:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.18);
  border-color: rgba(139, 92, 246, 0.5);
}

.vf-skill-node--idle {
  opacity: 0.6;
  border-style: dashed;
}

.vf-skill-node--unhealthy {
  border-color: rgba(239, 68, 68, 0.6);
  background: linear-gradient(180deg, white, rgba(239, 68, 68, 0.04));
}

.vf-skill-node__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vf-skill-node__kind {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  background: rgba(139, 92, 246, 0.1);
  color: #6d28d9;
  padding: 2px 6px;
  border-radius: 4px;
}

.vf-skill-node__chip {
  font-size: 9px;
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
}

.vf-skill-node__title {
  font-size: 13px;
  font-weight: 700;
  color: #1a2a44;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.vf-skill-node__stats {
  display: flex;
  gap: 10px;
  margin-top: auto;
}

.vf-skill-node__stats .mini-stat {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.vf-skill-node__stats .num {
  font-size: 12px;
  font-weight: 700;
  color: #1a2a44;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.vf-skill-node__stats .lbl {
  font-size: 9px;
  color: #94a3b8;
  text-transform: uppercase;
}

.vf-skill-node__hint {
  font-size: 10px;
  color: #8b5cf6;
  font-weight: 600;
  text-align: right;
  opacity: 0;
  transition: opacity 0.15s;
}

.vf-skill-node:hover .vf-skill-node__hint {
  opacity: 1;
}
</style>
