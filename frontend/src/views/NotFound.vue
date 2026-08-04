<template>
  <div class="not-found-page">
    <div class="not-found-card">
      <p class="not-found-code">404</p>
      <h1 class="not-found-title">页面不存在</h1>
      <p class="not-found-desc">你访问的页面可能已被移动、删除，或链接有误。</p>
      <div class="not-found-actions">
        <router-link to="/" class="nf-btn nf-btn--primary">返回首页</router-link>
        <router-link to="/dashboard" class="nf-btn nf-btn--ghost">前往学习台</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.not-found-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-secondary, #f5f7fa);
}

.not-found-card {
  text-align: center;
  max-width: 420px;
}

.not-found-code {
  font-size: 72px;
  font-weight: 800;
  line-height: 1;
  margin: 0 0 12px;
  color: var(--color-primary, #3478f6);
  letter-spacing: 2px;
}

.not-found-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--text-primary, #303133);
}

.not-found-desc {
  font-size: 14px;
  color: var(--text-secondary, #909399);
  margin: 0 0 28px;
}

.not-found-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.nf-btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 22px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: opacity 0.2s ease;
}

.nf-btn:hover {
  opacity: 0.85;
}

.nf-btn--primary {
  background: var(--color-primary, #3478f6);
  color: #fff;
}

.nf-btn--ghost {
  border: 1px solid var(--border-color, #dcdfe6);
  color: var(--text-primary, #303133);
  background: transparent;
}
</style>
