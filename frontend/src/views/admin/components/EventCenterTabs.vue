<template>
  <nav class="event-center-tabs" aria-label="事件中心">
    <router-link
      v-for="tab in tabs"
      :key="tab.to"
      :to="{ path: tab.to, query: sharedQuery }"
      class="event-center-tabs__item"
      :class="{ 'is-active': route.path === tab.to }"
      custom
      v-slot="{ navigate }"
    >
      <button
        type="button"
        class="event-center-tabs__button"
        :class="{ 'is-active': route.path === tab.to }"
        :aria-pressed="route.path === tab.to"
        @click="navigate"
      >
        {{ tab.label }}
      </button>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

/**
 * 事件中心 tab：流程事件 / Prompt 调用日志 互跳
 * 切换时携带当前 Trace ID 筛选，排查时按链路一次看全两类事件
 */
const props = defineProps<{
  traceId?: string
}>()

const route = useRoute()

const tabs = [
  { to: '/admin/path-generation-events', label: '流程事件' },
  { to: '/admin/prompt-call-logs', label: 'Prompt 调用日志' }
]

const sharedQuery = computed(() => {
  const traceId = props.traceId?.trim()
  return traceId ? { traceId } : {}
})
</script>

<style scoped>
.event-center-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: var(--admin-radius-md);
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface-alt);
  width: fit-content;
}

.event-center-tabs__item {
  text-decoration: none;
}

.event-center-tabs__button {
  min-height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: calc(var(--admin-radius-md) - 4px);
  background: transparent;
  color: var(--admin-text-secondary);
  font-size: var(--admin-text-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--admin-transition-fast);
  white-space: nowrap;
}

.event-center-tabs__button:hover {
  background: rgba(255, 255, 255, 0.72);
  color: var(--admin-text-primary);
}

.event-center-tabs__button.is-active {
  background: var(--admin-bg-surface);
  box-shadow: inset 0 0 0 1px rgba(52, 120, 246, 0.12), var(--admin-shadow-xs);
  color: var(--admin-text-primary);
}
</style>
