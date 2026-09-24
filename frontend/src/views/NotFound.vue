<template>
  <div class="not-found-page">
    <div class="not-found-card">
      <p class="not-found-code">404</p>
      <h1 class="not-found-title">页面不存在</h1>
      <p class="not-found-desc">你访问的页面可能已被移动、删除，或链接有误。</p>
      <div class="not-found-actions">
        <router-link to="/" class="nf-btn nf-btn--primary">返回首页</router-link>
        <router-link to="/dashboard" class="nf-btn nf-btn--ghost">前往学习台</router-link>
        <!-- 管理员打错路径时不再只有学习者侧出口（/admin/<未知> 由 AdminConsole 吞掉并提示，
             走不到这里，所以本出口只兜「/admn/xxx」这类彻底写错的路径） -->
        <router-link v-if="adminSession" to="/admin/overview" class="nf-btn nf-btn--ghost">前往管理控制台</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { hasAdminSession } from '@/api/adminApi';

const adminSession = hasAdminSession();
</script>

<style scoped>
.not-found-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--canvas, var(--bg-body, #f5f7fa));
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

/* 暗色模式：容器/文字/幽灵按钮随主题翻转（--canvas 亮色在 .v2-page 或 v2.css :root 定义；
   html[data-theme='dark'] 时由 v2.css 覆写为 #0f1620，此处仅兜底无 v2 上下文时的直设） */
[data-theme='dark'] .not-found-page {
  background: #141415;
}
[data-theme='dark'] .not-found-title {
  color: #efeff0;
}
[data-theme='dark'] .not-found-desc {
  color: #aaacb1;
}
[data-theme='dark'] .nf-btn--ghost {
  border-color: rgba(230, 237, 247, 0.16);
  color: #d7d8da;
  background: rgba(24, 34, 48, 0.7);
}
</style>
