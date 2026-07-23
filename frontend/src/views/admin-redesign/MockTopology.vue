<template>
  <div class="mk-page">
    <div class="mk-status" :class="hasError ? 'mk-status--bad' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ hasError ? '拓扑存在异常节点' : '拓扑运行正常' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ agentNodes.length }} Agent</span>
      <span class="mk-status__meta">{{ skillNodes.length }} Skill</span>
      <span class="mk-status__meta">提示：点 Skill 看详情，点 Agent 查日志</span>
    </div>

    <div class="topo-canvas">
      <svg :viewBox="`0 0 ${W} ${H}`" class="topo-svg" role="img" aria-label="Agent 拓扑图">
        <path
          v-for="(e, i) in edges"
          :key="`e-${i}`"
          :d="e.d"
          fill="none"
          :stroke="e.color"
          :stroke-width="e.width"
          :stroke-dasharray="e.dashed ? '4 4' : undefined"
          opacity="0.75"
        />

        <!-- Agent 节点（点击 → 查该节点日志） -->
        <g v-for="a in agentNodes" :key="a.id" class="topo-click" @click="investigateAgent(a.id)">
          <rect
            :x="a.x" :y="a.y" :width="a.w" :height="a.h"
            rx="12"
            :fill="a.error ? '#fef2f2' : '#ffffff'"
            :stroke="a.error ? '#dc2626' : '#e1e8f2'"
            :stroke-width="a.error ? 2 : 1"
          />
          <text :x="a.x + 14" :y="a.y + 22" class="topo-kind" :fill="a.error ? '#dc2626' : '#8492ab'">
            AGENT{{ a.error ? ' · 异常' : '' }}
          </text>
          <text :x="a.x + 14" :y="a.y + 42" class="topo-name">{{ a.name }}</text>
          <text :x="a.x + 14" :y="a.y + 60" class="topo-meta">{{ a.meta }}</text>
        </g>

        <!-- Skill 节点（点击 → 详情抽屉） -->
        <g v-for="s in skillNodes" :key="s.id" class="topo-click" @click="openSkillDrawer(s.skillId)">
          <rect
            :x="s.x" :y="s.y" :width="s.w" :height="s.h"
            rx="9"
            :fill="s.error ? '#fef2f2' : s.idle ? '#fafbfc' : '#ffffff'"
            :stroke="s.error ? '#f87171' : '#e1e8f2'"
          />
          <circle :cx="s.x + 12" :cy="s.y + s.h / 2" r="3.5" :fill="s.error ? '#dc2626' : s.idle ? '#c3cede' : '#15803d'" />
          <text :x="s.x + 22" :y="s.y + 17" class="topo-skill">{{ s.name }}</text>
          <text :x="s.x + 22" :y="s.y + 31" class="topo-skill-meta">{{ s.meta }}</text>
        </g>
      </svg>

      <div class="topo-legend">
        <span><i class="lg lg--ok"></i>正常</span>
        <span><i class="lg lg--idle"></i>空闲</span>
        <span><i class="lg lg--err"></i>异常</span>
        <span class="topo-legend__note">线宽 ∝ 调用量 · 虚线 = 跨阶段接力</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { skillProfiles, skillStatOf, openSkillDrawer, investigateAgent, spans, dataSource } from './mockStore'
import { liveTopoNodes } from './mockLive'

const W = 1080
const H = 470

interface AgentDef { id: string; name: string }
interface SkillItem { id: string; name: string; agentId: string; calls: number; errors: number }

const demoAgentDefs: AgentDef[] = [
  { id: 'goal-agent', name: '目标 Agent' },
  { id: 'path-agent', name: '路径 Agent' },
  { id: 'teaching-agent', name: '教学 Agent' },
  { id: 'learner-agent', name: '学习者 Agent' },
  { id: 'virtual-agent', name: '虚拟学习者 Agent' }
]

const isLive = computed(() => dataSource.value === 'live' && liveTopoNodes.value.length > 0)

/* live：真实拓扑节点（agent + skill，含真实统计与隶属） */
const liveAgents = computed<AgentDef[]>(() =>
  liveTopoNodes.value.filter((n) => n.type === 'agent').map((n) => ({ id: n.id, name: n.label }))
)
const liveSkills = computed<SkillItem[]>(() =>
  liveTopoNodes.value
    .filter((n) => n.type === 'skill' && n.parentAgentId)
    .map((n) => ({
      id: n.id.replace(/^skill:/, ''),
      name: n.label.replace(/ Skill$/, ''),
      agentId: n.parentAgentId as string,
      calls: n.stats.totalCalls,
      errors: n.stats.failed
    }))
)

const agentDefs = computed<AgentDef[]>(() => (isLive.value ? liveAgents.value.slice(0, 5) : demoAgentDefs))

function skillsOf(agentId: string): SkillItem[] {
  if (isLive.value) return liveSkills.value.filter((s) => s.agentId === agentId)
  return skillProfiles
    .filter((p) => p.agentId === agentId)
    .map((p) => {
      const st = skillStatOf(p.id)
      return { id: p.id, name: p.name, agentId: p.agentId, calls: st.calls, errors: st.errors }
    })
}

const hasError = computed(() =>
  isLive.value ? liveSkills.value.some((s) => s.errors > 0) : spans.value.some((s) => s.status === 'err')
)

const agentNodes = computed(() =>
  agentDefs.value.map((a, i) => {
    const members = skillsOf(a.id)
    const errors = members.filter((m) => m.errors > 0).length
    return {
      ...a,
      meta: `${members.length} Skill${errors ? ` · ${errors} 异常` : ''}`,
      x: 24 + i * 212,
      y: 24,
      w: 188,
      h: 74,
      error: errors > 0
    }
  })
)

const skillNodes = computed(() => {
  const out: Array<{ id: string; skillId: string; name: string; meta: string; x: number; y: number; w: number; h: number; idle?: boolean; error?: boolean }> = []
  agentDefs.value.forEach((a, i) => {
    skillsOf(a.id).forEach((p, j) => {
      out.push({
        id: `${a.id}-${j}`,
        skillId: p.id,
        name: p.name,
        meta: p.calls ? `${p.calls} 调用${p.errors ? ` · ${p.errors} 失败` : ''}` : '未调用',
        x: 24 + i * 212,
        y: 140 + j * 58,
        w: 188,
        h: 44,
        idle: p.calls === 0,
        error: p.errors > 0
      })
    })
  })
  return out
})

const edges = computed(() => {
  const out: Array<{ d: string; color: string; width: number; dashed?: boolean }> = []
  agentNodes.value.forEach((a, i) => {
    const ax = a.x + a.w / 2
    const ay = a.y + a.h
    skillsOf(a.id).forEach((p, j) => {
      const sx = 24 + i * 212 + 94
      const sy = 140 + j * 58
      out.push({
        d: `M ${ax} ${ay} C ${ax} ${ay + 22}, ${sx} ${sy - 22}, ${sx} ${sy}`,
        color: p.errors > 0 ? '#dc2626' : '#c3cede',
        width: Math.min(1 + p.calls / 2, 3.5)
      })
    })
    if (i < agentNodes.value.length - 1) {
      out.push({
        d: `M ${a.x + a.w} ${a.y + 37} L ${a.x + 212} ${a.y + 37}`,
        color: '#8492ab',
        width: 1.5,
        dashed: true
      })
    }
  })
  return out
})
</script>

<style scoped>
.topo-canvas {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background:
    radial-gradient(circle, #e6ebf4 1px, transparent 1px) 0 0 / 18px 18px,
    var(--mk-surface);
  overflow: hidden;
}
.topo-svg { display: block; width: 100%; height: auto; }
.topo-click { cursor: pointer; }
.topo-click:hover rect { stroke: #3478f6; }
.topo-kind { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; }
.topo-name { font-size: 13px; font-weight: 700; fill: #1a2a44; }
.topo-meta { font-size: 10.5px; fill: #8492ab; }
.topo-skill { font-size: 11.5px; font-weight: 600; fill: #1a2a44; }
.topo-skill-meta { font-size: 9.5px; fill: #8492ab; font-family: 'JetBrains Mono', monospace; }

.topo-legend {
  display: flex;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid var(--mk-line);
  font-size: 11.5px;
  color: var(--mk-muted);
  align-items: center;
}
.topo-legend span { display: inline-flex; align-items: center; gap: 6px; }
.lg { width: 10px; height: 10px; display: inline-block; }
.lg--ok { background: #15803d; border-radius: 50%; }
.lg--idle { background: #c3cede; border-radius: 50%; }
.lg--err { background: #dc2626; border-radius: 50%; }
.topo-legend__note { margin-left: auto; color: var(--mk-faint); }
</style>
