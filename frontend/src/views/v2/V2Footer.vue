<template>
  <footer class="v2footer">
    <div class="v2footer__inner">
      <router-link to="/dashboard" class="v2footer__brand">
        <img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" class="v2footer__logo" />
        <span class="v2footer__brand-text">
          <span class="v2footer__name">问流 WenFlow</span>
          <span class="v2footer__tag">从问题到学习路径</span>
        </span>
      </router-link>
      <nav class="v2footer__links" aria-label="footer">
        <router-link to="/vision" class="v2footer__link">愿景</router-link>
        <router-link to="/docs" class="v2footer__link">开发者文档</router-link>
        <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer" class="v2footer__link">GitHub</a>
      </nav>
      <div class="v2footer__meta">
        <span>© {{ year }} 问流</span>
        <span class="v2footer__divider">·</span>
        <span>v{{ version }}</span>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { version as appVersion } from '../../../package.json';
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();
const year = computed(() => new Date().getFullYear());
const version = appVersion;
</script>

<style scoped>
.v2footer {
  margin-top: auto;
  /* 顶部柔和渐变分隔线：白底向浅灰过渡 */
  border-top: 1px solid var(--line, rgba(227, 233, 244, 0.55));
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface, #fff) 50%, transparent), color-mix(in srgb, var(--surface, #fff) 75%, transparent));
}
.v2footer__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 12px 28px 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 24px;
}
.v2footer__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  text-decoration: none;
}
.v2footer__logo {
  /* 与右侧两行品牌文字齐高：name 13×1.2 + tag 11×1.3 ≈ 30px */
  width: 30px; height: 30px; object-fit: contain;
  border-radius: 9px; flex-shrink: 0;
}
.v2footer__brand-text { display: grid; gap: 0; min-width: 0; }
.v2footer__name { font-size: 13px; font-weight: 700; color: var(--ink, #172033); line-height: 1.2; }
.v2footer__tag {
  font-size: 11px; color: var(--faint, #8492ab);
  line-height: 1.3;
}
.v2footer__links { display: inline-flex; align-items: center; gap: 12px; }
.v2footer__link {
  position: relative;
  font-size: 12.5px; color: var(--muted, #5b6577);
  text-decoration: none;
  padding: 8px 3px;
  transition: color 0.15s ease;
}
.v2footer__link::after {
  content: ''; position: absolute; left: 0; right: 100%; bottom: 4px;
  height: 2px; border-radius: 2px;
  background: var(--blue-deep, #1f57cc);
  transition: right 0.18s ease;
}
.v2footer__link:hover { color: var(--blue-deep, #1f57cc); }
.v2footer__link:hover::after { right: 0; }
.v2footer__meta {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 11.5px; color: var(--faint, #8492ab);
  font-variant-numeric: tabular-nums;
}
.v2footer__divider { opacity: 0.5; }
/* 移动端不放页脚：品牌块/链接/版权在 ≤900px 整体收起，导航职能交给底部 tab，
   省下的 ~30px 还给内容（滚动页底部少一层 chrome）。断点取 900 而非 720 的原因：
   底部导航 ≤1100px 就出现，但 901–1100 平板段顶部链接已折叠，愿景/开发者文档的
   唯一入口就是本页脚，该段保留。AI 生成声明是合规项、不在页脚内，不受影响。 */
@media (max-width: 900px) {
  .v2footer { display: none; }
}
</style>
