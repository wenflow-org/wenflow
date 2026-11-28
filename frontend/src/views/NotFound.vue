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
  color: var(--color-primary, #2f6ae0);
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
}

.not-found-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--ink, var(--text-primary));
}

.not-found-desc {
  font-size: 14px;
  color: var(--muted, var(--text-secondary));
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
  border-radius: var(--mk-radius-md);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.nf-btn:active {
  transform: scale(0.98);
}

.nf-btn--primary {
  background: var(--color-primary, #2f6ae0);
  color: var(--wf-text-on-primary);
}

.nf-btn--primary:hover {
  background: var(--blue-deep, var(--color-primary-dark));
}

.nf-btn--ghost {
  border: 1px solid var(--line, var(--border-color));
  color: var(--ink, var(--text-primary));
  background: transparent;
}

.nf-btn--ghost:hover {
  border-color: var(--blue, var(--color-primary));
  color: var(--blue-deep, var(--color-primary-dark));
  background: color-mix(in srgb, var(--blue, var(--color-primary)) 5%, var(--surface, transparent));
}

@media (prefers-reduced-motion: no-preference) {
  .not-found-card {
    animation: nf-card-in 0.36s var(--mk-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
  }
}

@keyframes nf-card-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

[data-theme='dark'] .not-found-page {
  background: var(--canvas);
}
[data-theme='dark'] .not-found-title {
  color: var(--ink);
}
[data-theme='dark'] .not-found-desc {
  color: var(--muted);
}
[data-theme='dark'] .nf-btn--ghost {
  border-color: var(--line);
  color: var(--ink);
  background: var(--surface);
}
</style>

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   本页此前一个媒体查询都没有：实测 390 下 404 数字 72px（占屏宽近 1/5）、
   容器留白 24px、按钮左右内边距 22px（学习侧同款按钮的移动端是 17px）。 */
@media (max-width: 640px) {
  .not-found-page { padding: 16px; }
  .not-found-code { font-size: 56px; }
  .not-found-desc { margin-bottom: 20px; }
  .nf-btn { padding: 9px 17px; font-size: 13.5px; }
}
</style>
