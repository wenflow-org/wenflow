<template>
  <div class="admin-page learner-center-page">
    <AdminPageHeader
      title="学习者中心"
      :icon="Reading"
      :highlights="centerHighlights"
    />

    <section class="learner-center-shell">
      <div class="learner-center-shell__head">
        <div class="learner-center-shell__copy">
          <span class="learner-center-shell__kicker">模块导航</span>
          <h2>{{ activeTabMeta.title }}</h2>
        </div>
        <div class="learner-center-shell__switcher" role="tablist" aria-label="学习者中心模块切换">
          <button
            v-for="item in tabOptions"
            :key="item.key"
            type="button"
            class="learner-center-shell__tab"
            :class="{ 'is-active': activeTab === item.key }"
            :aria-pressed="activeTab === item.key"
            @click="activeTab = item.key"
          >
            <strong>{{ item.label }}</strong>
            <span>{{ item.short }}</span>
          </button>
        </div>
      </div>

      <div class="learner-center-shell__body">
        <LearnerModelsPanel v-if="activeTab === 'models'" embedded />
        <TeachingSessionsPanel v-else embedded />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Reading } from '@element-plus/icons-vue'
import LearnerModelsPanel from './LearnerModels.vue'
import TeachingSessionsPanel from './TeachingSessions.vue'
import AdminPageHeader from './components/AdminPageHeader.vue'

const route = useRoute()
const router = useRouter()
const activeTab = ref<'models' | 'sessions'>('models')

// 统计数据
const stats = ref({
  totalModels: 0,
  activeModels: 0,
  totalSessions: 0,
  activeSessions: 0,
  needAttention: 0,
  activeIn7Days: 0
})

const tabOptions = [
  {
    key: 'models' as const,
    label: '学习者模型',
    short: '快照目录',
    title: '学习者模型快照',
    desc: ''
  },
  {
    key: 'sessions' as const,
    label: '教学会话',
    short: '质量巡检',
    title: '教学会话巡检',
    desc: ''
  }
]

const activeTabMeta = computed(() => {
  return tabOptions.find((item) => item.key === activeTab.value) || tabOptions[0]
})

const centerHighlights = computed(() => [
  { label: `${stats.value.totalModels} 个模型`, tone: 'info' as const },
  { label: `${stats.value.activeModels} 活跃`, tone: 'success' as const },
  { label: `${stats.value.needAttention} 需关注`, tone: stats.value.needAttention > 0 ? 'danger' as const : 'neutral' as const },
  { label: `${stats.value.totalSessions} 个会话`, tone: 'neutral' as const }
])

// 加载统计数据
const loadStats = async () => {
  // TODO: 从 API 加载真实数据
  // 这里先使用模拟数据
  stats.value = {
    totalModels: 156,
    activeModels: 42,
    totalSessions: 89,
    activeSessions: 23,
    needAttention: 7,
    activeIn7Days: 58
  }
}

onMounted(() => {
  const tabFromQuery = String(route.query.tab || '')
  if (tabFromQuery === 'sessions' || tabFromQuery === 'models') {
    activeTab.value = tabFromQuery
  }
  loadStats()
})

watch(activeTab, (next) => {
  router.replace({ query: { ...route.query, tab: next } })
})
</script>

<style scoped>
.learner-center-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  position: relative;
}

.learner-center-shell {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 18px;
}

.learner-center-shell__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: var(--admin-border-subtle);
}

.learner-center-shell__copy {
  display: grid;
  gap: 6px;
  max-width: 720px;
}

.learner-center-shell__kicker {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  padding: 0 10px;
  align-items: center;
  border-radius: 999px;
  background: var(--admin-color-info-bg);
  color: var(--admin-text-brand);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.summary-card-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.learner-center-shell__copy h2 {
  margin: 0;
  font-size: 1.2rem;
  line-height: 1.2;
  color: var(--admin-text-primary);
}

.learner-center-shell__copy p {
  margin: 0;
  color: var(--admin-text-secondary);
  line-height: 1.6;
}

.learner-center-shell__switcher {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 6px;
  width: min(420px, 100%);
  padding: 4px;
  border-radius: var(--admin-radius-md);
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface-alt);
}

.learner-center-shell__tab {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: calc(var(--admin-radius-md) - 4px);
  border: none;
  background: transparent;
  text-align: left;
  color: var(--admin-text-secondary);
  transition: all 180ms ease;
  cursor: pointer;
}

.learner-center-shell__tab strong {
  font-size: 0.95rem;
  color: var(--admin-text-primary);
}

.learner-center-shell__tab span {
  font-size: 0.78rem;
  color: var(--admin-text-muted);
}

.learner-center-shell__tab:hover {
  background: rgba(255, 255, 255, 0.72);
}

.learner-center-shell__tab.is-active {
  background: var(--admin-bg-surface);
  box-shadow: inset 0 0 0 1px rgba(52, 120, 246, 0.12);
}

.learner-center-shell__body {
  min-width: 0;
}

.learner-center-shell__tab.is-active {
  border-color: var(--admin-color-info-border);
  background: var(--admin-color-info-bg);
  box-shadow: var(--admin-shadow-sm);
}

.learner-center-shell__body {
  min-width: 0;
}

@media (max-width: 900px) {
  .learner-center-shell__switcher {
    grid-template-columns: 1fr;
  }
}
</style>
