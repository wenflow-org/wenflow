<template>
  <div class="auth v2-page">
    <main class="auth__main">
      <router-link to="/" class="auth__logo">
        <img :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="问流 WenFlow" />
      </router-link>

      <!-- 一体式双栏卡：左表单 右演示，天然 1:1 平衡 -->
      <div class="auth__card">
        <section class="auth__form-side">
          <slot />
          <router-link to="/" class="auth__back auth__back--bottom">← 返回首页</router-link>
        </section>

        <aside class="auth__demo-side">
          <!-- 演示面板（目标对话 demo）抽为共享组件：管理端登录同款（2026-10-14 用户拍板「保持用户侧一样」） -->
          <AuthGoalDemo />
        </aside>
      </div>
    </main>

    <!-- compact：认证页是终端用户入口，页脚不露 开发者文档/GitHub（走查 2026-09-27 冗余文案项） -->
    <V2Footer compact />
  </div>
</template>

<script setup lang="ts">
import V2Footer from './V2Footer.vue';
import AuthGoalDemo from '@/components/ui/AuthGoalDemo.vue';
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();

</script>

<style scoped>
.auth { min-height: 100vh; position: relative; }

.auth__main {
  position: relative;
  min-height: calc(100vh - 129px);
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 30px;
  padding: 48px 20px 40px;
}

.auth__logo { display: inline-flex; }
.auth__logo img { height: 84px; width: auto; display: block; }

/* ---------- 一体式双栏卡 ---------- */
.auth__card {
  width: min(820px, 100%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal); /* 圆角阶梯：卡片/弹层 16 */
  box-shadow: var(--mk-shadow-modal); /* 登录壳 = 规范模态档 */
  overflow: hidden;
}

/* 左：表单 */
.auth__form-side {
  padding: 28px 28px 22px;
  display: grid;
  gap: 18px;
  align-content: start;
}
.auth__back {
  font-size: 12.5px; font-weight: 600; color: var(--faint); text-decoration: none; justify-self: start;
  /* ≥36px 可点高度（走查 2026-09-27：19px 高的文字链触控不达标） */
  display: inline-flex; align-items: center; min-height: 36px; padding: 0 4px;
}
.auth__back:hover { color: var(--blue-deep); }
.auth__back--bottom { margin-top: 4px; }

/* 右：演示（柔和蓝调分区）；.demo 子树样式在共享组件 AuthGoalDemo */
.auth__demo-side {
  background: color-mix(in srgb, var(--blue) 5%, var(--surface));
  border-left: 1px solid var(--line);
  padding: 26px 26px 28px;
  display: grid;
  align-content: center;
}

/* 整卡入场：上浮回正（reduced-motion 下瞬显；演示面板内部动画在组件内兜底） */
.auth__card {
  animation: auth-card-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes auth-card-in {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .auth__card { animation: none; }
}

/* ---------- 移动端：上下堆叠 ---------- */
@media (max-width: 900px) {
  .auth__card { grid-template-columns: 1fr; }
  .auth__demo-side {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 20px 22px 22px;
  }
  .auth__form-side { padding: 22px 20px 24px; }
}
@media (max-width: 640px) {
  .auth__demo-side { display: none; }
}

/* ===== 移动端密度（2026-09-24）=====
   实测 390 下：.auth__main 上下 48/40px + gap 30px、品牌 logo 64px、认证卡圆角 20px。
   另外三个认证页（登录/注册/重置）的输入框是 14px——低于 iOS Safari 聚焦缩放阈值，
   点输入框整页会被放大；uc.css、学习页、目标页都按 16px 处理了，这三页此前漏了。
   .field__input 定义在三个页面组件里（不在本文件），从壳上用 :deep 统一收口。
   注意必须带上 .auth__form-side 这个祖先类：单独写 `:deep(.field__input)` 编译出来是
   `[data-v-壳] .field__input`，权重 (0,2,0)，和页面里的 `.field__input[data-v-页]` 打平，
   而页面样式后注入 → 平局下壳会输（实测就是这样：算出来仍是 14px）。
   写成 `.auth__form-side :deep(...)` → `.auth__form-side[data-v-壳] .field__input`，
   权重 (0,3,0)，稳赢。
   2026-09-24 二次修正：字号从 16 收回 14。理由是和个人中心一致的——输入文字比它
   自己的标签（.field__label 12.5px）还大 28%，390 下输入框是全页最重的块。
   低于 16px 在 iOS Safari 聚焦时会有一次整页 zoom，这里接受这个取舍
   （理由与「不要表单里字大大小小」的权衡见 uc.css 的 .uc-field__input 注释）。 */
@media (max-width: 640px) {
  .auth__main { gap: 20px; padding: 28px 16px 24px; }
  .auth__logo img { height: 60px; }
  .auth__card { border-radius: var(--mk-radius-modal); }
  .auth__form-side :deep(.field__input) { font-size: 14px; }
}

/* ---------- 超大屏（2K）：卡片放大；演示面板字级阶梯在共享组件内；2800+ 交由 v2.css zoom ---------- */
@media (min-width: 2000px) and (max-width: 2799px) {
  .auth__logo img { height: 96px; }
  .auth__main { gap: 36px; }
  .auth__card {
    width: min(1080px, 100%);
    border-radius: var(--mk-radius-modal); /* 与基档同阶 16（4K 缩放交给 v2.css zoom 机制） */
  }
  .auth__form-side { padding: 36px 40px 28px; gap: 22px; }
  .auth__demo-side { padding: 36px 36px 38px; }
  .auth__back { font-size: 14px; }
}

/* ---------- 暗色模式：演示面板底色覆写（面板内部底色/芯片直引 var(--surface) 随主题翻转） ---------- */
[data-theme='dark'] .auth__demo-side {
  background: color-mix(in srgb, var(--blue) 9%, var(--surface));
}
</style>
