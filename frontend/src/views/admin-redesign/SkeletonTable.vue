<template>
  <!-- role=status + aria-live（2026-10-06 审核）：骨架屏是全站唯一启动占位
       （AdminConsole）与全部异步页面的 loading 组件，此前是纯装饰节点，读屏用户
       得不到「正在加载」的任何信息（对照 MkLoading 明确给了 role=status）。 -->
  <div
    class="mk-card skl-card"
    :style="{ '--skl-cols': cols }"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="内容加载中"
  >
    <div class="skl" v-for="i in rows" :key="i">
      <span
        v-for="j in cols"
        :key="j"
        class="mk-skeleton skl__bar"
        :style="{ width: barWidth(i, j), maxWidth: '100%' }"
      ></span>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 表格骨架屏：live 数据加载时的占位，替代「加载中…」空态 */
const props = withDefaults(defineProps<{ rows?: number; cols?: number }>(), { rows: 5, cols: 5 })

function barWidth(i: number, j: number) {
  // 伪随机宽度：首列稍宽、末列窄，接近真实表格形态
  const base = j === 0 ? 58 : j === props.cols - 1 ? 18 : 34 + ((i * 17 + j * 29) % 40)
  return `${base}%`
}
</script>

<style scoped>
.skl-card { overflow: hidden; }
.skl {
  display: grid;
  grid-template-columns: repeat(var(--skl-cols, 5), 1fr);
  gap: 14px;
  align-items: center;
  padding: 13px 14px;
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
}
.skl:last-child { border-bottom: none; }
/* shimmer 视觉统一走 .mk-skeleton（shared.css，含暗色与 prefers-reduced-motion）；本类只管形状 */
.skl__bar { height: 12px; }

/* 暗色模式 */
html[data-theme='dark'] .skl { border-bottom-color: var(--wf-border-light); }
</style>
