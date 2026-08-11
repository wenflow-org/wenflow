<template>
  <div class="uc v2-page">
    <V2Nav />

    <main class="uc__main">
      <header class="uc__head">
        <div class="uc__head-text">
          <span class="uc__kicker">个人中心</span>
          <h1>{{ title }}</h1>
          <p v-if="description">{{ description }}</p>
        </div>
        <div v-if="$slots.actions" class="uc__head-actions">
          <slot name="actions" />
        </div>
      </header>

      <nav class="uc__tabs" aria-label="个人中心导航">
        <router-link v-for="t in tabs" :key="t.to" :to="t.to" class="uc__tab" :class="{ 'uc__tab--on': isActive(t) }">
          {{ t.label }}
        </router-link>
      </nav>

      <div class="uc__body">
        <slot />
      </div>
    </main>

    <V2Footer />
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import V2Nav from '@/views/v2/V2Nav.vue'
import V2Footer from '@/views/v2/V2Footer.vue'
import '@/views/v2/v2.css'

defineProps<{ title: string; description?: string }>()

const route = useRoute()

const tabs = [
  { to: '/user/account', label: '账户', match: ['/user/account'] },
  { to: '/user/agents', label: 'AI 助手', match: ['/user/agents'] },
  { to: '/user/skills', label: 'Skill', match: ['/user/skills'] },
  { to: '/user/agent-model-settings', label: '高级模型', match: ['/user/agent-model-settings'] },
  { to: '/user/settings', label: 'API 接入', match: ['/user/settings'] },
  { to: '/user/agent-logs', label: '调用日志', match: ['/user/agent-logs'] }
]

function isActive(t: { match: string[] }) {
  return t.match.some((m) => route.path.startsWith(m))
}
</script>

<style scoped>
.uc {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--canvas, #f3f6fb);
  color: var(--ink, #172033);
}

.uc.v2-page > main.uc__main {
  flex: 1;
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 22px 0 40px;
  display: grid;
  gap: 16px;
  align-content: start;
}

.uc__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  padding: 4px 2px 0;
}

.uc__kicker {
  display: inline-block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--blue-deep, #1f57cc);
}

.uc__head h1 {
  margin: 0 0 6px;
  font-size: clamp(24px, 3vw, 30px);
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.uc__head p {
  margin: 0;
  max-width: 48em;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted, #5b6577);
}

.uc__head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.uc__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 2px 0;
}

.uc__tab {
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted, #5b6577);
  background: #fff;
  border: 1px solid var(--line, #e3e9f4);
  text-decoration: none;
  transition: all 0.15s ease;
}

.uc__tab:hover {
  color: var(--blue-deep, #1f57cc);
  border-color: rgba(52, 120, 246, 0.35);
}

.uc__tab--on {
  color: #fff;
  background: linear-gradient(135deg, var(--blue, #3478f6), var(--blue-deep, #1f57cc));
  border-color: transparent;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.22);
}

.uc__body {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.uc__body :deep(.glass-card),
.uc__body :deep(.profile-card),
.uc__body :deep(.uc-card) {
  background: #fff;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
  backdrop-filter: none;
}

.uc__body :deep(.btn-primary),
.uc__body :deep(.el-button--primary) {
  border: 0 !important;
  border-radius: 12px !important;
  background: linear-gradient(135deg, var(--blue, #3478f6), var(--blue-deep, #1f57cc)) !important;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.22);
  font-weight: 700;
}

/* 修复：仅"洗白"默认按钮；保留 danger/link 语义色，避免危险操作与普通按钮混淆 */
.uc__body :deep(.el-button--default:not(.is-link):not(.is-text)) {
  border-radius: 12px !important;
  border-color: var(--line, #e3e9f4) !important;
  background: #fff !important;
  color: var(--muted, #5b6577) !important;
  font-weight: 700;
}

.uc__body :deep(.el-button--default:not(.is-link):not(.is-text).is-disabled) {
  opacity: 0.55;
}

@media (max-width: 900px) {
  .uc.v2-page > main.uc__main {
    width: min(100% - 28px, 1180px);
    padding-bottom: 88px;
  }

  .uc__head {
    flex-direction: column;
  }

  .uc__head-actions {
    width: 100%;
    justify-content: stretch;
  }
}
</style>
