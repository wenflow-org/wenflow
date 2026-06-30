<template>
  <section class="admin-page-header" :class="{ 'admin-page-header--dense': dense }">
    <div class="admin-page-header__copy">
      <span v-if="kicker" class="admin-page-header__kicker">{{ kicker }}</span>
      <h1 class="admin-page-header__title">
        <el-icon v-if="icon" class="admin-page-header__icon">
          <component :is="icon" />
        </el-icon>
        <slot name="title">{{ title }}</slot>
      </h1>
      <p v-if="desc || $slots.desc" class="admin-page-header__desc">
        <slot name="desc">{{ desc }}</slot>
      </p>
      <div
        v-if="highlights?.length || $slots.highlights"
        class="admin-page-header__highlights"
      >
        <slot name="highlights">
          <span
            v-for="(h, i) in highlights"
            :key="i"
            class="admin-page-header__pill"
            :class="h.tone ? `admin-page-header__pill--${h.tone}` : ''"
          >
            {{ h.label }}
          </span>
        </slot>
      </div>
    </div>

    <div v-if="$slots.actions" class="admin-page-header__actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

interface Highlight {
  label: string
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'
}

defineProps<{
  kicker?: string
  title?: string
  desc?: string
  icon?: Component | string
  highlights?: Highlight[]
  dense?: boolean
}>()
</script>

<style scoped>
.admin-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 26px;
  margin-bottom: 16px;
  border-radius: var(--admin-radius-lg);
  border: var(--admin-border);
  background: var(--admin-bg-surface);
  box-shadow: var(--admin-shadow-sm);
  flex-wrap: wrap;
}

.admin-page-header--dense {
  padding: 14px 20px;
  margin-bottom: 12px;
  border-radius: var(--admin-radius-md);
  box-shadow: none;
}

.admin-page-header__copy {
  display: grid;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.admin-page-header--dense .admin-page-header__copy {
  gap: 4px;
}

.admin-page-header__kicker {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 24px;
  padding: 0 10px;
  border-radius: var(--admin-radius-pill);
  background: var(--admin-color-info-bg);
  color: var(--admin-text-brand);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.admin-page-header__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--admin-text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.admin-page-header--dense .admin-page-header__title {
  font-size: 1.125rem;
}

.admin-page-header__icon {
  font-size: 1.5rem;
  color: var(--admin-text-brand);
  flex-shrink: 0;
}

.admin-page-header__desc {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--admin-text-muted);
  max-width: 760px;
}

.admin-page-header__highlights {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.admin-page-header__pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: var(--admin-radius-pill);
  background: var(--admin-bg-muted);
  border: var(--admin-border-subtle);
  color: var(--admin-text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
}

.admin-page-header__pill--info {
  background: var(--admin-color-info-bg);
  border-color: rgba(52, 120, 246, 0.18);
  color: var(--admin-text-brand);
}
.admin-page-header__pill--success {
  background: var(--admin-color-success-bg);
  border-color: rgba(16, 185, 129, 0.22);
  color: var(--admin-color-success);
}
.admin-page-header__pill--warning {
  background: var(--admin-color-warning-bg);
  border-color: rgba(245, 158, 11, 0.22);
  color: var(--admin-color-warning);
}
.admin-page-header__pill--danger {
  background: var(--admin-color-error-bg);
  border-color: rgba(239, 68, 68, 0.24);
  color: var(--admin-color-error);
}
.admin-page-header__pill--neutral {
  background: var(--admin-color-neutral-bg);
  border-color: rgba(100, 116, 139, 0.18);
  color: var(--admin-color-neutral);
}

.admin-page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* 暗色模式 */
:global([data-theme='dark']) .admin-page-header {
  border-color: var(--admin-border-color);
  background: var(--admin-bg-surface);
  box-shadow: var(--admin-shadow-sm);
}

@media (max-width: 768px) {
  .admin-page-header {
    padding: 16px 18px;
    gap: 12px;
  }
  .admin-page-header__title {
    font-size: 1.25rem;
  }
  .admin-page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
