<template>
  <div class="learner-center-page">
    <AdminPageHeader
      kicker="学习者中心"
      title="学习者中心"
      desc="学习者画像快照与教学会话巡检，集中查看真实学习轨迹与产物。"
      :icon="Reading"
    />

    <el-tabs v-model="activeTab" class="learner-center-tabs">
      <el-tab-pane label="学习者模型" name="models">
        <LearnerModelsPanel v-if="activeTab === 'models'" />
      </el-tab-pane>
      <el-tab-pane label="教学会话" name="sessions">
        <TeachingSessionsPanel v-if="activeTab === 'sessions'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Reading } from '@element-plus/icons-vue'
import LearnerModelsPanel from './LearnerModels.vue'
import TeachingSessionsPanel from './TeachingSessions.vue'
import AdminPageHeader from './components/AdminPageHeader.vue'

const route = useRoute()
const router = useRouter()
const activeTab = ref<'models' | 'sessions'>('models')

onMounted(() => {
  const tabFromQuery = String(route.query.tab || '')
  if (tabFromQuery === 'sessions' || tabFromQuery === 'models') {
    activeTab.value = tabFromQuery
  }
})

import { watch } from 'vue'
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

.learner-center-tabs {
  position: relative;
  z-index: 1;
}

/* 让 tab 内的 sticky toolbar 能生效：el-tabs__content 默认 overflow:hidden 会裁掉吸顶元素 */
:deep(.learner-center-tabs > .el-tabs__content) {
  overflow: visible;
}

:deep(.learner-center-tabs > .el-tabs__header) {
  margin-bottom: 16px;
}

:deep(.learner-center-tabs .el-tabs__item) {
  font-size: 0.95rem;
  font-weight: 600;
}

/* 子页面已经有自己的 page-hero / admin-page-header，这里直接隐藏避免双 hero */
:deep(.learner-models-page .page-hero),
:deep(.learner-models-page .admin-page-header),
:deep(.teaching-sessions-page .page-hero),
:deep(.teaching-sessions-page .admin-page-header) {
  display: none;
}
</style>
