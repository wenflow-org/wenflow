<template>
  <footer class="mfooter">
    <div class="mfooter__inner">
      <div class="mfooter__brand" @click="labGo('dashboard')">
        <img src="/favicon.png" alt="问流" class="mfooter__logo" />
        <span class="mfooter__name">问流 WenFlow</span>
        <span class="mfooter__tag">从问题到学习路径</span>
      </div>
      <nav class="mfooter__links" aria-label="footer">
        <a href="/vision" class="mfooter__link" target="_blank" rel="noreferrer">愿景</a>
        <a href="/docs" class="mfooter__link" target="_blank" rel="noreferrer">开发者文档</a>
        <a href="https://github.com/wenflow-org/wenflow" class="mfooter__link" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <div class="mfooter__meta">
        <span>© {{ year }} 问流</span>
        <span class="mfooter__divider">·</span>
        <span>v0.1.0</span>
        <span class="mfooter__divider">·</span>
        <span class="mfooter__proto">重设计原型</span>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { labGo } from './labStore';

const year = computed(() => new Date().getFullYear());
</script>

<style scoped>
.mfooter {
  margin-top: 8px;
  border-top: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.6);
}
.mfooter__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 28px 26px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px 20px;
}
.mfooter__brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  min-width: 0;
}
.mfooter__logo {
  width: 26px;
  height: 26px;
  object-fit: contain;
  flex-shrink: 0;
}
.mfooter__name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
}
.mfooter__tag {
  font-size: 12px;
  color: var(--faint);
  padding-left: 9px;
  border-left: 1px solid var(--line);
}
.mfooter__links {
  display: inline-flex;
  align-items: center;
  gap: 18px;
}
.mfooter__link {
  font-size: 13px;
  color: var(--muted);
  text-decoration: none;
  transition: color 0.15s ease;
}
.mfooter__link:hover {
  color: var(--blue-deep);
}
.mfooter__meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.mfooter__divider {
  opacity: 0.5;
}
.mfooter__proto {
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.08);
  border: 1px solid rgba(52, 120, 246, 0.22);
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 700;
}

@media (max-width: 720px) {
  .mfooter__inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 16px 22px;
  }
  .mfooter__tag {
    display: none;
  }
}
</style>
