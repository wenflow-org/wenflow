<template>
  <div class="mk-page">
    <div class="mk-status" :class="incident ? 'mk-status--bad' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ incident ? '教学链路存在异常节点' : '拓扑运行正常' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">5 Agent</span>
      <span class="mk-status__meta">24 Skill</span>
      <span class="mk-status__meta">7 天调用 {{ incident ? '8,412' : '9,040' }}</span>
      <div class="mk-pills" style="margin-left:auto">
        <button type="button" class="mk-pill mk-pill--active">7 天</button>
        <button type="button" class="mk-pill">24 小时</button>
        <button type="button" class="mk-pill">30 天</button>
      </div>
    </div>

    <div class="topo-canvas">
      <svg :viewBox="`0 0 ${W} ${H}`" class="topo-svg" role="img" aria-label="Agent 拓扑图">
        <!-- 边：agent → skill -->
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

        <!-- Agent 节点 -->
        <g v-for="a in agents" :key="a.id">
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

        <!-- Skill 节点 -->
        <g v-for="s in skills" :key="s.id">
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
        <span><i class="lg lg--agent"></i>Agent</span>
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

const props = defineProps<{ state: 'normal' | 'incident' }>()
const incident = computed(() => props.state === 'incident')

const W = 1080
const H = 520

interface AgentNode { id: string; name: string; meta: string; x: number; y: number; w: number; h: number; error?: boolean }
interface SkillNode { id: string; name: string; meta: string; x: number; y: number; w: number; h: number; idle?: boolean; error?: boolean }

const agentDefs = [
  { id: 'goal', name: '目标 Agent', meta: '4 Skill · 收集与理解' },
  { id: 'path', name: '路径 Agent', meta: '3 Skill · 规划与拆解' },
  { id: 'teaching', name: '教学 Agent', meta: '6 Skill · 教学编排' },
  { id: 'learner', name: '学习者 Agent', meta: '4 Skill · 画像与快照' },
  { id: 'sim', name: '虚拟学习者 Agent', meta: '7 Skill · 模拟运行' }
]

const skillDefs: Record<string, Array<{ name: string; calls: number; error?: boolean }>> = {
  goal: [
    { name: '目标对话', calls: 1284 },
    { name: '画像推断', calls: 856 },
    { name: '理解合成', calls: 640 },
    { name: '概念抽取', calls: 1180 }
  ],
  path: [
    { name: '路径规划', calls: 640 },
    { name: '场景定帧', calls: 512 },
    { name: '阶段设计', calls: 498 }
  ],
  teaching: [
    { name: '教学回合', calls: 2210 },
    { name: '伴学补强', calls: 388 },
    { name: '课后产出', calls: 415 }
  ],
  learner: [
    { name: '状态聚合', calls: 930 },
    { name: '快照刷新', calls: 1204 },
    { name: '知识沉淀', calls: 260 }
  ],
  sim: [
    { name: '回合模拟', calls: 320 },
    { name: '路径评估', calls: 96, error: false }
  ]
}

const agents = computed<AgentNode[]>(() =>
  agentDefs.map((a, i) => ({
    ...a,
    x: 24 + i * 212,
    y: 24,
    w: 188,
    h: 74,
    error: incident.value && a.id === 'teaching'
  }))
)

const skills = computed<SkillNode[]>(() => {
  const out: SkillNode[] = []
  agentDefs.forEach((a, i) => {
    skillDefs[a.id].forEach((s, j) => {
      const isErr = incident.value && a.id === 'teaching' && s.name === '教学回合'
      out.push({
        id: `${a.id}-${j}`,
        name: s.name,
        meta: isErr ? '429 限流 · 71.3%' : `${s.calls} 调用`,
        x: 24 + i * 212,
        y: 140 + j * 56,
        w: 188,
        h: 42,
        idle: s.calls < 100,
        error: isErr
      })
    })
  })
  return out
})

const edges = computed(() => {
  const out: Array<{ d: string; color: string; width: number; dashed?: boolean }> = []
  agents.value.forEach((a, i) => {
    const ax = a.x + a.w / 2
    const ay = a.y + a.h
    skillDefs[a.id].forEach((s, j) => {
      const sx = 24 + i * 212 + 94
      const sy = 140 + j * 56
      const err = incident.value && a.id === 'teaching' && s.name === '教学回合'
      out.push({
        d: `M ${ax} ${ay} C ${ax} ${ay + 22}, ${sx} ${sy - 22}, ${sx} ${sy}`,
        color: err ? '#dc2626' : '#c3cede',
        width: Math.min(1 + s.calls / 600, 3.5)
      })
    })
    // 跨阶段接力虚线
    if (i < agents.value.length - 1) {
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
.lg { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.lg--agent { background: #fff; border: 1.5px solid #8492ab; }
.lg--ok { background: #15803d; border-radius: 50%; }
.lg--idle { background: #c3cede; border-radius: 50%; }
.lg--err { background: #dc2626; border-radius: 50%; }
.topo-legend__note { margin-left: auto; color: var(--mk-faint); }
</style>
