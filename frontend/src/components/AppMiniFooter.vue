<template>
  <footer class="app-mini-footer">
    <div class="app-mini-footer__inner">
      <div class="app-mini-footer__brand">
        <span class="app-mini-footer__logo" aria-hidden="true">问</span>
        <span class="app-mini-footer__name">问流 WenFlow</span>
        <span class="app-mini-footer__tag">让 AI 真正陪你学</span>
      </div>
      <nav class="app-mini-footer__links" aria-label="footer">
        <router-link to="/vision" class="app-mini-footer__link">愿景</router-link>
        <router-link to="/docs" class="app-mini-footer__link">开发文档</router-link>
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

const year = computed(() => new Date().getFullYear());
const version = '0.9';
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: linear-gradient(135deg, #3478f6 0%, #2563eb 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
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
