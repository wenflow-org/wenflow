<template>
  <div class="mk-card skl-card" :style="{ '--skl-cols': cols }">
    <div class="skl" v-for="i in rows" :key="i">
      <span
        v-for="j in cols"
        :key="j"
        class="skl__bar"
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
  border-bottom: 1px solid #f0f2f5;
}
.skl:last-child { border-bottom: none; }
.skl__bar {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, #eef2f7 25%, #f7f9fc 50%, #eef2f7 75%);
  background-size: 200% 100%;
  animation: skl-shimmer 1.2s ease infinite;
}
@keyframes skl-shimmer {
  to { background-position: -200% 0; }
}

/* 暗色模式：亮灰渐变换深底等阶（原来 #eef2f7/#f7f9fc 每页加载闪白条） */
html[data-theme='dark'] .skl { border-bottom-color: #232f45; }
html[data-theme='dark'] .skl__bar {
  background: linear-gradient(90deg, #1d2739 25%, #2a3a55 50%, #1d2739 75%);
}
</style>
