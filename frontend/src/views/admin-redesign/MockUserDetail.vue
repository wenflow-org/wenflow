<template>
  <div v-if="d" class="mk-page ud">
    <button type="button" class="ud-back" @click="closeSubPage">← 用户</button>
    <div class="ud-id">
      <span class="ud-avatar">{{ d.name.charAt(0) }}</span>
      <div>
        <h3>{{ d.name }}</h3>
        <span class="ud-sub">{{ d.email }} · {{ d.role }} · 加入 {{ d.joined }}</span>
      </div>
      <button type="button" class="mk-status__action" style="margin-left:auto">编辑</button>
    </div>

    <div class="ud-stats">
      <div v-for="s in d.stats" :key="s.label" class="ud-stat">
        <span>{{ s.label }}</span>
        <strong>{{ s.value }}</strong>
      </div>
    </div>

    <div class="ud-grid">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">学习路径</h3>
        </div>
        <div class="ud-paths">
          <div v-for="p in d.recentPaths" :key="p.title" class="ud-path">
            <div class="ud-path__main">
              <strong>{{ p.title }}</strong>
              <span>{{ p.stage }}</span>
            </div>
            <div class="ud-path__bar"><i :style="{ width: p.pct + '%' }" :class="{ warn: p.tone === 'warn' }"></i></div>
            <span class="ud-path__pct">{{ p.pct }}%</span>
          </div>
          <p v-if="!d.recentPaths.length" class="ud-none">还没有路径</p>
        </div>
      </section>

      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">最近活跃</h3>
        </div>
        <div class="ud-activity">
          <div v-for="(a, i) in d.activity" :key="i" class="ud-act">
            <span>{{ a.text }}</span>
            <span class="ud-act__time">{{ a.time }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>

  <div v-else class="mk-page">
    <button type="button" class="ud-back" @click="closeSubPage">← 用户</button>
    <div class="mk-empty">
      <strong>该用户暂无更多演示数据</strong>
      <span>演示详情仅覆盖部分样本用户。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { subPage, closeSubPage, userDetails } from './mockStore'

const d = computed(() => userDetails.find((x) => x.id === subPage.value?.id))
</script>

<style scoped>
.ud { gap: 16px; }
.ud-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  width: fit-content;
}
.ud-id { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ud-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #31b16f, #43b0d8);
  color: #fff;
  display: grid;
  place-content: center;
  font-size: 18px;
  font-weight: 800;
}
.ud-id h3 { margin: 0; font-size: 18px; }
.ud-sub { color: var(--mk-faint); font-size: 12px; }

.ud-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.ud-stat {
  display: grid;
  gap: 3px;
  padding: 13px 16px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
}
.ud-stat span { font-size: 11.5px; color: var(--mk-muted); font-weight: 600; }
.ud-stat strong { font-size: 20px; font-variant-numeric: tabular-nums; }

.ud-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
.ud-paths { display: grid; }
.ud-path {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px 40px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.ud-path:last-child { border-bottom: none; }
.ud-path__main { display: grid; min-width: 0; }
.ud-path__main strong { font-size: 13px; }
.ud-path__main span { font-size: 11.5px; color: var(--mk-faint); }
.ud-path__bar { height: 6px; border-radius: 3px; background: #eef2fa; overflow: hidden; }
.ud-path__bar i { display: block; height: 100%; background: linear-gradient(90deg, #6aa0ff, #3478f6); }
.ud-path__bar i.warn { background: linear-gradient(90deg, #fcd34d, #f59e0b); }
.ud-path__pct { font-size: 12px; color: var(--mk-muted); text-align: right; font-variant-numeric: tabular-nums; }
.ud-none { margin: 0; padding: 18px 16px; color: var(--mk-faint); font-size: 12.5px; }

.ud-activity { display: grid; }
.ud-act {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12.5px;
}
.ud-act:last-child { border-bottom: none; }
.ud-act__time { color: var(--mk-faint); font-size: 11.5px; white-space: nowrap; }

@media (max-width: 900px) {
  .ud-stats { grid-template-columns: repeat(2, 1fr); }
  .ud-grid { grid-template-columns: 1fr; }
}
</style>
