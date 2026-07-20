<template>
  <div class="mk-page">
    <div class="mk-status" :class="rows.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ rows.length ? '外挂组件运行正常' : '还没有外挂组件' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ rows.length }} 个组件</span>
      <span class="mk-status__meta">独立配置 {{ customCount }}</span>
      <span class="mk-status__meta">继承默认 {{ rows.length - customCount }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary">新增组件</button>
    </div>

    <div class="mk-card">
      <table v-if="rows.length" class="mk-table">
        <thead>
          <tr>
            <th>组件</th>
            <th>挂载点</th>
            <th>模型</th>
            <th>温度</th>
            <th>状态</th>
            <th>最近调用</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>
              <div class="mk-cell-main">
                <strong>{{ r.name }}</strong>
                <span class="mk-cell-sub">{{ r.id }}</span>
              </div>
            </td>
            <td><span class="mk-badge mk-badge--muted">{{ r.mount }}</span></td>
            <td class="mono">{{ r.model }}</td>
            <td class="mk-num">{{ r.temp }}</td>
            <td><span class="mk-badge" :class="r.custom ? 'mk-badge--ok' : 'mk-badge--muted'">{{ r.custom ? '独立配置' : '继承默认' }}</span></td>
            <td :class="{ 'mk-na': r.last === '从未' }">{{ r.last }}</td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link">配置</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="mk-empty">
        <strong>还没有外挂组件</strong>
        <span>外挂组件让 Skill 使用独立的模型与参数，而不是全局默认。</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ state: 'normal' | 'empty' }>()

interface Row {
  id: string
  name: string
  mount: string
  model: string
  temp: string
  custom: boolean
  last: string
}

const all: Row[] = [
  { id: 'goal-conversation', name: '目标对话 Skill', mount: '对话', model: 'deepseek-v4-flash', temp: '0.3', custom: true, last: '4 分钟前' },
  { id: 'generic-planner', name: '路径规划 Skill', mount: '推理', model: 'deepseek-v4-pro', temp: '0.2', custom: true, last: '18 分钟前' },
  { id: 'teaching-round', name: '教学回合 Skill', mount: '对话', model: '继承全局', temp: '0.5', custom: false, last: '42 分钟前' },
  { id: 'basic-evaluator', name: '质量评估 Skill', mount: '评估', model: 'deepseek-v4-pro', temp: '0.1', custom: true, last: '1 小时前' },
  { id: 'session-wrapup', name: '课后产出 Skill', mount: '生成', model: '继承全局', temp: '0.7', custom: false, last: '2 小时前' },
  { id: 'turn-simulator', name: '回合模拟 Skill', mount: '模拟', model: '继承全局', temp: '0.8', custom: false, last: '从未' }
]

const rows = ref<Row[]>([])
watch(
  () => props.state,
  (s) => {
    rows.value = s === 'empty' ? [] : all
  },
  { immediate: true }
)

const customCount = computed(() => rows.value.filter((r) => r.custom).length)
</script>

<style scoped>
.mono { font-family: var(--mk-mono); font-size: 12px; }
</style>
