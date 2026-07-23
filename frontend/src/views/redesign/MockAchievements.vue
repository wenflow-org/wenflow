<template>
  <div class="ach">
    <MockNav active="achievements" />

    <main class="ach__main">
      <!-- 页头 -->
      <div class="ach__hero">
        <span class="kicker">成就</span>
        <h1>查看你的学习里程碑</h1>
        <p>每一次小进步都算数。</p>
      </div>

      <!-- 概览 -->
      <div class="overview">
        <section class="card ov"><small>已解锁</small><b>{{ unlockedCount }}</b><span>个成就</span></section>
        <section class="card ov"><small>待解锁</small><b>{{ items.length - unlockedCount }}</b><span>个成就</span></section>
        <section class="card ov"><small>已获得经验值</small><b>{{ totalXp }}</b><span>XP</span></section>
        <section class="card ov"><small>完成率</small><b>{{ Math.round((unlockedCount / items.length) * 100) }}%</b><span>&nbsp;</span></section>
      </div>

      <!-- 筛选 -->
      <div class="filters">
        <button
          v-for="f in statusFilters"
          :key="f.key"
          type="button"
          class="filter"
          :class="{ 'filter--active': statusFilter === f.key }"
          @click="statusFilter = f.key"
        >{{ f.label }}</button>
        <span class="filters__sep"></span>
        <button
          v-for="t in types"
          :key="t"
          type="button"
          class="filter filter--type"
          :class="{ 'filter--active': typeFilter === t }"
          @click="typeFilter = typeFilter === t ? '' : t"
        >{{ t }}</button>
      </div>

      <!-- 成就网格 -->
      <div class="grid">
        <article v-for="a in visible" :key="a.id" class="card ach-card" :class="{ 'ach-card--locked': !a.unlocked }">
          <div class="ach-card__head">
            <span class="ach-card__icon" :class="`ach-card__icon--${a.unlocked ? 'on' : 'off'}`" v-html="iconOf(a.icon)"></span>
            <span class="ach-card__badge" :class="a.unlocked ? 'ach-card__badge--on' : 'ach-card__badge--off'">
              {{ a.unlocked ? '已解锁' : '未解锁' }}
            </span>
          </div>
          <strong class="ach-card__name">{{ a.name }}</strong>
          <p class="ach-card__desc">{{ a.desc }}</p>
          <div class="ach-card__foot">
            <template v-if="a.unlocked">
              <span class="ach-card__xp">+{{ a.xp }} XP</span>
              <span class="ach-card__date">{{ a.earnedAt }}</span>
            </template>
            <template v-else>
              <div class="ach-card__prog">
                <div class="ach-card__prog-bar"><i :style="{ width: (a.current / a.total) * 100 + '%' }"></i></div>
                <span>{{ a.current }} / {{ a.total }}</span>
              </div>
              <span v-if="a.current >= a.total" class="ach-card__claim" @click="claim(a.id)">领取</span>
              <span v-else class="ach-card__xp ach-card__xp--off">{{ a.xp }} XP</span>
            </template>
          </div>
        </article>
      </div>
    </main>
    <MockFooter />

    <!-- toast -->
    <transition name="toast">
      <div v-if="toast" class="toast">
        <span class="toast__icon">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2z"/></svg>
        </span>
        {{ toast }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MockNav from './MockNav.vue';
import MockFooter from './MockFooter.vue';
import { achievements, type MockAchievement } from './mockData';

const items = ref<MockAchievement[]>(achievements.map((a) => ({ ...a })));
const statusFilter = ref<'all' | 'unlocked' | 'locked'>('all');
const typeFilter = ref('');
const toast = ref('');

const statusFilters = [
  { key: 'all' as const, label: '全部' },
  { key: 'unlocked' as const, label: '已解锁' },
  { key: 'locked' as const, label: '未解锁' }
];
const types = ['里程碑', '连续学习', '完成度', '知识掌握'];

const unlockedCount = computed(() => items.value.filter((a) => a.unlocked).length);
const totalXp = computed(() => items.value.filter((a) => a.unlocked).reduce((s, a) => s + a.xp, 0));

const visible = computed(() => {
  let list = items.value;
  if (statusFilter.value === 'unlocked') list = list.filter((a) => a.unlocked);
  if (statusFilter.value === 'locked') list = list.filter((a) => !a.unlocked);
  if (typeFilter.value) list = list.filter((a) => a.type === typeFilter.value);
  return [...list].sort((x, y) => Number(y.unlocked) - Number(x.unlocked) || y.current / y.total - x.current / x.total);
});

let toastTimer = 0;
function claim(id: string) {
  const a = items.value.find((x) => x.id === id);
  if (!a || a.unlocked) return;
  a.unlocked = true;
  a.earnedAt = '今天';
  toast.value = `解锁成就「${a.name}」+${a.xp} XP`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200);
}

const icons: Record<string, string> = {
  flag: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 2h2v20H6V2zm4 2h9l-3 4 3 4h-9V4z"/></svg>',
  flame: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11 21 3 13h6L8 3l10 8h-6l1 10h-2z" opacity=".95"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="m15 4-6 2-6-2v16l6 2 6-2 6 2V6l-6-2zm0 2.2 4 1.3v11.3l-4-1.3V6.2zM9 6.4l4-1.3v11.3l-4 1.3V6.4z"/></svg>',
  medal: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 4a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v16a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2V4zm4 0v14h9V4H8z"/></svg>',
  target: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>'
};
function iconOf(name: string) {
  return icons[name] ?? icons.flag;
}
</script>

<style scoped>
.ach__main {
  max-width: 1080px; margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid; gap: 18px;
}
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.ach__hero h1 { margin: 6px 0 4px; font-size: 28px; letter-spacing: -0.01em; }
.ach__hero p { margin: 0; font-size: 13.5px; color: var(--muted); }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}

.overview { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.ov { padding: 16px 18px; display: grid; gap: 3px; }
.ov small { font-size: 12px; color: var(--faint); font-weight: 700; }
.ov b { font-size: 28px; letter-spacing: -0.02em; }
.ov span { font-size: 11.5px; color: var(--faint); }
.ov:nth-child(1) b { color: var(--green); }
.ov:nth-child(3) b { color: var(--accent); }

.filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.filter {
  border: 1px solid var(--line); background: #fff;
  border-radius: 999px; padding: 7px 15px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: .14s ease;
}
.filter--active { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.07); color: var(--blue-deep); }
.filter--type { padding: 6px 12px; font-size: 12px; }
.filters__sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.ach-card { padding: 16px; display: flex; flex-direction: column; gap: 8px; transition: .16s ease; }
.ach-card:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(23, 32, 51, 0.09); }
.ach-card--locked { background: #fafcff; }
.ach-card__head { display: flex; align-items: center; justify-content: space-between; }
.ach-card__icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; }
.ach-card__icon--on { color: var(--blue-deep); background: linear-gradient(135deg, rgba(52, 120, 246, 0.16), rgba(141, 107, 255, 0.14)); }
.ach-card__icon--off { color: var(--faint); background: #eef2f8; }
.ach-card__badge { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; }
.ach-card__badge--on { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.ach-card__badge--off { color: var(--faint); background: #eef2f8; }
.ach-card__name { font-size: 15px; }
.ach-card__desc { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.55; flex: 1; }
.ach-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px dashed var(--line); padding-top: 10px; }
.ach-card__xp { font-size: 12px; font-weight: 800; color: var(--accent); }
.ach-card__xp--off { color: var(--faint); }
.ach-card__date { font-size: 11.5px; color: var(--faint); }
.ach-card__prog { display: flex; align-items: center; gap: 8px; flex: 1; }
.ach-card__prog-bar { flex: 1; height: 6px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.ach-card__prog-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.ach-card__prog span { font-size: 11px; color: var(--faint); white-space: nowrap; }
.ach-card__claim {
  font-size: 12px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, var(--amber), #ef8f3a);
  padding: 6px 13px; border-radius: 9px; cursor: pointer;
  box-shadow: 0 6px 14px rgba(244, 170, 70, 0.35);
  animation: ach-pulse 1.6s ease-in-out infinite;
}
@keyframes ach-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }

.toast {
  position: fixed; top: 76px; right: 24px; z-index: 50;
  display: flex; align-items: center; gap: 9px;
  background: var(--ink); color: #fff;
  font-size: 13px; font-weight: 600;
  padding: 11px 16px; border-radius: 12px;
  box-shadow: 0 16px 40px rgba(23, 32, 51, 0.3);
}
.toast__icon {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--amber); color: #fff;
  display: grid; place-items: center; flex: 0 0 auto;
}
.toast-enter-active, .toast-leave-active { transition: .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }

@media (max-width: 900px) {
  .ach__main { padding: 16px 14px 32px; }
  .ach__hero h1 { font-size: 22px; }
  .overview { grid-template-columns: repeat(2, 1fr); }
  .grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 560px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
