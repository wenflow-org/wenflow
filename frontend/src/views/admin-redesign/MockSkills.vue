<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ cards.length }} 个 Skill</span>
      <span class="mk-status__meta">有调用 {{ activeCount }}</span>
      <span class="mk-status__meta">失败节点 {{ errorCount }}</span>
      <div class="mk-pills" style="margin-left:auto">
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" @click="onlyAttention = false">全部</button>
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" @click="onlyAttention = true">仅看需关注</button>
      </div>
    </div>

    <!-- 健康矩阵：卡片即入口 -->
    <div v-if="filtered.length" class="sk-grid">
      <button
        v-for="s in filtered"
        :key="s.id"
        type="button"
        class="sk-card"
        :class="`sk-card--${s.health}`"
        @click="openSkillDrawer(s.id)"
      >
        <span class="sk-card__head">
          <span class="sk-card__dot"></span>
          <span class="sk-card__cat">{{ s.category }}</span>
          <span v-if="s.health !== 'ok'" class="sk-card__flag">{{ s.health === 'error' ? '异常' : '空闲' }}</span>
        </span>
        <strong class="sk-card__name">{{ s.name }}</strong>
        <span class="sk-card__id">{{ s.id }}</span>
        <span class="sk-card__stats">
          <span>{{ s.calls }} 调用</span>
          <span v-if="s.errors" class="sk-card__err">{{ s.errors }} 失败</span>
          <span v-else :class="{ 'mk-na': !s.calls }">{{ s.calls ? '无失败' : '—' }}</span>
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
import { computed, ref } from 'vue'
import { skillProfiles, skillStatOf, openSkillDrawer } from './mockStore'

type Health = 'ok' | 'idle' | 'error'

const onlyAttention = ref(false)

// 卡片数据 = 档案 + 由 spans 推导的实时统计（与日志/瀑布/总览同源）
const cards = computed(() =>
  skillProfiles.map((p) => {
    const stat = skillStatOf(p.id)
    const health: Health = stat.errors > 0 ? 'error' : stat.calls === 0 ? 'idle' : 'ok'
    return { ...p, ...stat, health }
  })
)

const filtered = computed(() => (onlyAttention.value ? cards.value.filter((c) => c.health !== 'ok') : cards.value))
const activeCount = computed(() => cards.value.filter((c) => c.calls > 0).length)
const errorCount = computed(() => cards.value.filter((c) => c.errors > 0).length)

const statusTone = computed(() => (errorCount.value ? 'mk-status--bad' : activeCount.value ? 'mk-status--ok' : 'mk-status--muted'))
const statusTitle = computed(() =>
  errorCount.value ? `${errorCount.value} 个节点存在失败` : activeCount.value ? 'Skill 网络健康' : '还没有运行数据'
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

.sk-card__head { display: flex; align-items: center; gap: 7px; }
.sk-card__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-green); }
.sk-card--idle .sk-card__dot { background: #c3cede; }
.sk-card--error .sk-card__dot { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
@keyframes sk-blink { 50% { opacity: 0.3; } }
.sk-card__cat { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mk-faint); }
.sk-card__flag { margin-left: auto; font-size: 10.5px; font-weight: 800; color: var(--mk-red); }
.sk-card--idle .sk-card__flag { color: var(--mk-faint); }

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
.sk-card__err { color: var(--mk-red); font-weight: 700; }
</style>
