<template>
  <div class="admin-page learner-center-page">
    <AdminPageHeader
      title="学习者中心"
      :icon="Reading"
    >
      <template #actions>
        <div class="learner-center-tabs" role="tablist" aria-label="学习者内容切换">
          <button
            v-for="item in tabOptions"
            :key="item.key"
            type="button"
            class="learner-center-tabs__item"
            :class="{ 'is-active': activeTab === item.key }"
            :aria-pressed="activeTab === item.key"
            @click="activeTab = item.key"
          >
            {{ item.label }}
          </button>
        </div>
      </template>
    </AdminPageHeader>

    <div class="learner-center-content">
      <LearnerModelsPanel v-if="activeTab === 'models'" embedded />
      <TeachingSessionsPanel v-else embedded />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Reading } from '@element-plus/icons-vue'
import LearnerModelsPanel from './LearnerModels.vue'
import TeachingSessionsPanel from './TeachingSessions.vue'
import AdminPageHeader from './components/AdminPageHeader.vue'

const route = useRoute()
const router = useRouter()
const activeTab = ref<'models' | 'sessions'>('models')

const tabOptions = [
  {
    key: 'models' as const,
    label: '模型快照'
  },
  {
    key: 'sessions' as const,
    label: '教学会话'
  }
]

onMounted(() => {
  const tabFromQuery = String(route.query.tab || '')
  if (tabFromQuery === 'sessions' || tabFromQuery === 'models') {
    activeTab.value = tabFromQuery
  }
})

watch(activeTab, (next) => {
  router.replace({ query: { ...route.query, tab: next } })
})
</script>

<style scoped>
.learner-center-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  position: relative;
}

.learner-center-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: var(--admin-radius-md);
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface-alt);
}

.learner-center-tabs__item {
  min-height: 40px;
  padding: 0 14px;
  border-radius: calc(var(--admin-radius-md) - 4px);
  border: none;
  background: transparent;
  text-align: center;
  color: var(--admin-text-secondary);
  font-size: 0.9rem;
  font-weight: 600;
  transition: all 180ms ease;
  cursor: pointer;
}

.learner-center-tabs__item:hover {
  background: rgba(255, 255, 255, 0.72);
  color: var(--admin-text-primary);
}

.learner-center-tabs__item.is-active {
  background: var(--admin-bg-surface);
  box-shadow: inset 0 0 0 1px rgba(52, 120, 246, 0.12);
  color: var(--admin-text-primary);
}

.learner-center-content {
  min-width: 0;
}

@media (max-width: 900px) {
  .learner-center-tabs {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .learner-center-tabs {
    grid-template-columns: 1fr;
  }
}
</style>
