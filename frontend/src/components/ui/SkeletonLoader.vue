<template>
  <div class="skeleton-loader" :class="{ 'skeleton-loader--cards': variant === 'cards' }">
    <!-- Card variant: renders card-shaped placeholders -->
    <template v-if="variant === 'cards'">
      <div v-for="i in count" :key="i" class="skel-card">
        <div class="skel-card__header">
          <div class="skel skel--circle"></div>
          <div class="skel skel--badge"></div>
        </div>
        <div class="skel skel--title"></div>
        <div class="skel skel--text"></div>
        <div class="skel skel--text skel--text-short"></div>
      </div>
    </template>

    <!-- List variant: renders list-item-shaped placeholders -->
    <template v-else-if="variant === 'list'">
      <div v-for="i in count" :key="i" class="skel-list-item">
        <div class="skel skel--circle-sm"></div>
        <div class="skel-list-item__text">
          <div class="skel skel--text"></div>
          <div class="skel skel--text skel--text-short"></div>
        </div>
      </div>
    </template>

    <!-- Dashboard variant: renders dashboard-shaped placeholders -->
    <template v-else-if="variant === 'dashboard'">
      <div class="skel-dash">
        <div class="skel-dash-header">
          <div class="skel skel--title skel--text-wide"></div>
          <div class="skel skel--pill"></div>
        </div>
        <div class="skel-dash-grid">
          <div class="skel skel--card-hero"></div>
          <div class="skel skel--card-side"></div>
        </div>
        <div class="skel-dash-grid skel-dash-grid--2">
          <div class="skel skel--card-sm"></div>
          <div class="skel skel--card-sm"></div>
        </div>
      </div>
    </template>

    <!-- Default: simple lines -->
    <template v-else>
      <div v-for="i in count" :key="i" class="skel-row">
        <div class="skel" :style="{ width: widths[i % widths.length] }"></div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'lines' | 'cards' | 'list' | 'dashboard'
  count?: number
}>(), {
  variant: 'lines',
  count: 3
})

const widths = ['100%', '85%', '70%', '90%', '60%']
</script>

<style scoped>
/* ---- 容器 ---- */
.skeleton-loader {
  display: grid;
  gap: 12px;
}

/* ---- 基础 shimmer ---- */
.skel {
  border-radius: 8px;
  background: linear-gradient(
    90deg,
    var(--line) 25%,
    color-mix(in srgb, var(--line) 60%, var(--surface)) 50%,
    var(--line) 75%
  );
  background-size: 200% 100%;
  animation: skel-shimmer 1.5s ease-in-out infinite;
}

@keyframes skel-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ---- 尺寸修饰 ---- */
.skel--circle {
  width: 40px; height: 40px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.skel--circle-sm {
  width: 32px; height: 32px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.skel--title {
  height: 20px; width: 60%;
}
.skel--text {
  height: 14px; width: 100%;
}
.skel--text-short {
  width: 50%;
}
.skel--text-wide {
  width: 80%;
}
.skel--badge {
  height: 24px; width: 80px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.skel--pill {
  height: 36px; width: 120px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.skel--card-hero {
  height: 200px;
  border-radius: 12px;
}
.skel--card-side {
  height: 160px;
  border-radius: 12px;
}
.skel--card-sm {
  height: 120px;
  border-radius: 12px;
}

/* ---- rows（默认 lines 变体） ---- */
.skel-row {
  display: grid;
  gap: 10px;
}

/* ---- cards 变体 ---- */
.skeleton-loader--cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.skel-card {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
}
.skel-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ---- list 变体 ---- */
.skel-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.skel-list-item + .skel-list-item {
  border-top: 1px solid var(--line);
}
.skel-list-item__text {
  display: grid;
  gap: 6px;
  flex: 1;
}

/* ---- dashboard 变体 ---- */
.skel-dash {
  display: grid;
  gap: 16px;
}
.skel-dash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.skel-dash-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 16px;
}
.skel-dash-grid--2 {
  grid-template-columns: 1fr 1fr;
}
</style>
