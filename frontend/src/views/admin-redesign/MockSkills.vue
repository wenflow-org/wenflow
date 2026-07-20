<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ rows.length }} 个 Skill</span>
      <span class="mk-status__meta">24h 活跃 {{ activeCount }}</span>
      <span class="mk-status__meta">需关注 {{ attentionCount }}</span>
      <div class="mk-pills" style="margin-left:auto">
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" @click="onlyAttention = false">全部</button>
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" @click="onlyAttention = true">仅看需关注</button>
      </div>
    </div>

    <!-- 健康矩阵 -->
    <div v-if="filtered.length" class="sk-grid">
      <button
        v-for="s in filtered"
        :key="s.id"
        type="button"
        class="sk-card"
        :class="`sk-card--${s.health}`"
      >
        <span class="sk-card__head">
          <span class="sk-card__dot"></span>
          <span class="sk-card__cat">{{ s.category }}</span>
          <span v-if="s.health !== 'ok'" class="sk-card__flag">{{ s.health === 'error' ? '异常' : '关注' }}</span>
        </span>
        <strong class="sk-card__name">{{ s.name }}</strong>
        <span class="sk-card__id">{{ s.id }}</span>
        <span class="sk-card__stats">
          <span>{{ s.calls }} 调用</span>
          <span :class="{ 'mk-na': s.calls === 0 }">{{ s.calls ? s.rate : '—' }}</span>
        </span>
      </button>
    </div>

    <div v-else class="mk-empty">
      <strong>{{ onlyAttention ? '没有需关注的 Skill' : '全部 Skill 处于空闲' }}</strong>
      <span>{{ onlyAttention ? '一切健康。' : '产生真实调用后，这里会出现运行数据。' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ state: 'normal' | 'attention' | 'empty' }>()

interface Skill {
  id: string
  name: string
  category: string
  calls: number
  rate: string
  health: 'ok' | 'warn' | 'error'
}

const base: Skill[] = [
  { id: 'goal-conversation', name: '目标对话', category: 'analysis', calls: 1284, rate: '97.2%', health: 'ok' },
  { id: 'goal-profile-inference', name: '目标画像推断', category: 'analysis', calls: 856, rate: '95.8%', health: 'ok' },
  { id: 'generic-planner', name: '通用路径规划', category: 'generation', calls: 640, rate: '92.1%', health: 'ok' },
  { id: 'teaching-round', name: '教学回合', category: 'teaching', calls: 2210, rate: '96.4%', health: 'ok' },
  { id: 'basic-evaluator', name: '质量评估器', category: 'analysis', calls: 930, rate: '98.1%', health: 'ok' },
  { id: 'session-wrapup', name: '课后产出', category: 'generation', calls: 415, rate: '94.0%', health: 'ok' },
  { id: 'dialogue-concept-extractor', name: '对话概念抽取', category: 'analysis', calls: 1180, rate: '99.0%', health: 'ok' },
  { id: 'basic-generator', name: '基础内容生成', category: 'generation', calls: 775, rate: '93.5%', health: 'ok' },
  { id: 'confidence-handler', name: '置信度处理', category: 'analysis', calls: 300, rate: '96.0%', health: 'ok' },
  { id: 'data-mapping', name: '数据映射', category: 'analysis', calls: 188, rate: '95.2%', health: 'ok' },
  { id: 'adaptive-guidance-copy', name: '动态引导文案', category: 'generation', calls: 262, rate: '97.7%', health: 'ok' },
  { id: 'acceptance-evidence-evaluator', name: '任务完成度评估', category: 'analysis', calls: 154, rate: '95.9%', health: 'ok' }
]

const rows = ref<Skill[]>([])
watch(
  () => props.state,
  (s) => {
    if (s === 'attention') {
      rows.value = base.map((x) =>
        x.id === 'teaching-round'
          ? { ...x, rate: '71.3%', health: 'error' as const }
          : x.id === 'basic-generator'
            ? { ...x, rate: '84.2%', health: 'warn' as const }
            : x
      )
    } else if (s === 'empty') {
      rows.value = base.map((x) => ({ ...x, calls: 0, rate: '—' }))
    } else {
      rows.value = base.map((x) => ({ ...x }))
    }
  },
  { immediate: true }
)

const onlyAttention = ref(false)
const isAttention = (s: Skill) => s.health !== 'ok' || s.calls === 0
const filtered = computed(() => (onlyAttention.value ? rows.value.filter(isAttention) : rows.value))

const activeCount = computed(() => rows.value.filter((s) => s.calls > 0).length)
const attentionCount = computed(() => rows.value.filter((s) => s.health !== 'ok').length)
const statusTone = computed(() => (attentionCount.value ? 'mk-status--bad' : activeCount.value ? 'mk-status--ok' : 'mk-status--muted'))
const statusTitle = computed(() =>
  attentionCount.value ? `${attentionCount.value} 个节点异常` : activeCount.value ? 'Skill 网络健康' : '还没有运行数据'
)
</script>

<style scoped>
.sk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.sk-card {
  display: grid;
  gap: 6px;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.14s ease;
}
.sk-card:hover { border-color: rgba(52, 120, 246, 0.35); transform: translateY(-1px); }
.sk-card--error { border-color: rgba(220, 38, 38, 0.4); background: linear-gradient(180deg, #fff7f7, #fff); }
.sk-card--warn { border-color: rgba(180, 83, 9, 0.35); }

.sk-card__head { display: flex; align-items: center; gap: 7px; }
.sk-card__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-green); }
.sk-card--warn .sk-card__dot { background: var(--mk-amber); }
.sk-card--error .sk-card__dot { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
@keyframes sk-blink { 50% { opacity: 0.3; } }
.sk-card__cat { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mk-faint); }
.sk-card__flag { margin-left: auto; font-size: 10.5px; font-weight: 800; color: var(--mk-red); }
.sk-card--warn .sk-card__flag { color: var(--mk-amber); }

.sk-card__name { font-size: 13.5px; font-weight: 700; }
.sk-card__id {
  font-family: var(--mk-mono);
  font-size: 11px;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-card__stats {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  border-top: 1px dashed var(--mk-line);
  padding-top: 7px;
  margin-top: 2px;
}
</style>
