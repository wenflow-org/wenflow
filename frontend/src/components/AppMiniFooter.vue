<template>
  <footer class="app-mini-footer">
    <div class="app-mini-footer__inner">
      <div class="app-mini-footer__brand">
        <img src="/favicon.png" alt="问流" class="app-mini-footer__logo" />
        <span class="app-mini-footer__name">问流 WenFlow</span>
        <span class="app-mini-footer__tag">从问题到学习路径</span>
      </div>
      <nav class="app-mini-footer__links" aria-label="footer">
        <router-link to="/vision" class="app-mini-footer__link">愿景</router-link>
        <router-link to="/docs" class="app-mini-footer__link">开发者文档</router-link>
        <a
          href="https://github.com/wenflow-org/wenflow"
          target="_blank"
          rel="noreferrer"
          class="app-mini-footer__link"
        >GitHub</a>
      </nav>
      <div class="app-mini-footer__meta">
        <span>© {{ year }} 问流</span>
        <span class="app-mini-footer__divider">·</span>
        <span>v{{ version }}</span>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { version as appVersion } from '../../package.json';

const year = computed(() => new Date().getFullYear());
const version = appVersion;
</script>

<style scoped>
.app-mini-footer {
  margin-top: 48px;
  padding: 24px 0 32px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
  color: var(--text-secondary, #64748b);
  font-size: 13px;
}

.app-mini-footer__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.app-mini-footer__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.app-mini-footer__logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}

.app-mini-footer__name {
  color: var(--text-primary, #0f172a);
  font-weight: 600;
}

.app-mini-footer__tag {
  color: var(--text-tertiary, #94a3b8);
  font-size: 12px;
}

.app-mini-footer__links {
  display: inline-flex;
  align-items: center;
  gap: 18px;
}

.app-mini-footer__link {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 2px 4px;
  color: var(--text-secondary, #64748b);
  text-decoration: none;
  transition: color 0.18s ease;
}

.app-mini-footer__link:hover {
  color: var(--color-primary, #2563eb);
}

.app-mini-footer__meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-tertiary, #94a3b8);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.app-mini-footer__divider {
  opacity: 0.5;
}

[data-theme='dark'] .app-mini-footer {
  border-top-color: rgba(255, 255, 255, 0.06);
}

[data-theme='dark'] .app-mini-footer__link {
  color: var(--neutral-700, #afc5d3);
}

[data-theme='dark'] .app-mini-footer__link:hover {
  color: var(--color-primary-light, #8db3fa);
}

[data-theme='dark'] .app-mini-footer__tag,
[data-theme='dark'] .app-mini-footer__meta {
  color: var(--neutral-600, #8ba3b5);
}

@media (max-width: 640px) {
  .app-mini-footer__inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .app-mini-footer__tag {
    display: none;
  }
}
</style>
