<template>
  <div id="app">
    <a href="#app-main" class="skip-link">跳到主要内容</a>
    <OfflineBanner />
    <AnnouncementBanner />
    <div id="app-main" tabindex="-1">
      <!-- 2026-10-10 走查修复（b25ff5d6/780dfd27 族未治净的残余）：
           旧实现是 Vue <transition mode="out-in" :duration="200">。显式 duration 只除掉了
           transitionend 依赖；Vue 的进入/离开类推进本身排在 double-rAF 里，whenTransitionEnds
           也在那个 rAF 回调里才被排定——渲染停帧（窗口遮挡/后台化、IAB 失焦面板）时 rAF 不
           出帧，out-in 的"旧页面先离场"永远不 done，新页面永不挂载：URL 已变、视图不换、
           后续导航全死。且停帧时进入类残留（enter-from 常驻）。
           现改为纯 CSS 关键帧入场动画：组件在路由变化时立即挂载，动画只作视觉装饰，
           不参与任何"挂载时机"门控；停帧时最坏只是省掉动画，导航永不冻结。 -->
      <RouterView v-slot="{ Component }">
        <component :is="Component" class="route-fade-in" />
      </RouterView>
    </div>
    <ToastHost />
    <MockConfirm />
  </div>
</template>

<script setup lang="ts">
import { useUserStore } from './stores/user';
import ToastHost from './components/ui/ToastHost.vue';
import OfflineBanner from './components/ui/OfflineBanner.vue';
import AnnouncementBanner from './components/AnnouncementBanner.vue';
import MockConfirm from './views/admin-redesign/Confirm.vue';
import { readTheme, applyDocumentTheme } from './utils/theme';

const userStore = useUserStore();
// 同步恢复登录态，避免子组件 onMounted/watch 时 isLoggedIn 仍为 false
userStore.initFromStorage();

// 主题初始化：从 localStorage 或系统偏好读取，防止首屏闪烁。
// 与 router beforeEach / ThemeToggle / index.html 首屏脚本同源（utils/theme.ts SSOT），
// 避免「路由切换时按旧 key 回退系统偏好 → 日间模式黑白闪烁」。
(function initTheme() {
  applyDocumentTheme(readTheme());
})();
</script>

<style scoped>
#app {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--canvas);
  /* flex 布局：公告条占流后 app-main 用 flex:1 吃掉剩余空间，
     v2-page 的 footer 吸底不再依赖写死的 41px 公告条高度 */
  display: flex;
  flex-direction: column;
}
#app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}

/* 无障碍：跳到主要内容（仅键盘聚焦时可见） */
.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 9999;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--mk-blue-fill, #2f6ae0);
  color: #fff;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  text-decoration: none;
  transform: translateY(-200%);
  transition: transform 0.2s ease;
}

.skip-link:focus-visible {
  transform: translateY(0);
}
</style>

<style>
/* 路由切换 fade-in 微动效（2026-10-10 起为纯 CSS 关键帧：不参与挂载门控，见模板注释） */
.route-fade-in {
  animation: route-fade-in 140ms ease;
}

@keyframes route-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .route-fade-in {
    animation: none;
  }
}
</style>
