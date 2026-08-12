<template>
  <div class="ach v2-page">
    <V2Nav />

    <main class="ach__main">
      <!-- 页头 -->
      <div class="ach__hero">
        <h1>查看你的学习里程碑</h1>
        <p>每一次小进步都算数。</p>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="ach__loading">
        <span class="spinner"></span>
        <p>正在加载成就…</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="loadError" class="errorbar">
        成就加载失败。<button type="button" class="errorbar__retry" @click="load">重试</button>
      </div>

      <template v-else>
        <!-- 概览 -->
        <div class="overview">
          <section class="card ov"><small>已解锁</small><b>{{ unlockedCount }}</b><span>个成就</span></section>
          <section class="card ov"><small>待解锁</small><b>{{ items.length - unlockedCount }}</b><span>个成就</span></section>
          <section class="card ov"><small>已获得经验值</small><b>{{ totalXp }}</b><span>XP</span></section>
          <section class="card ov"><small>完成率</small><b>{{ items.length ? Math.round((unlockedCount / items.length) * 100) : 0 }}%</b><span>&nbsp;</span></section>
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
            v-for="t in typeFilters"
            :key="t.key"
            type="button"
            class="filter filter--type"
            :class="{ 'filter--active': typeFilter === t.key }"
            @click="typeFilter = typeFilter === t.key ? '' : t.key"
          >{{ t.label }}</button>
        </div>

        <!-- 成就网格 -->
        <div v-if="visible.length" class="grid">
          <article v-for="a in visible" :key="a.id" class="card ach-card" :class="{ 'ach-card--locked': !a.unlocked }">
            <div class="ach-card__head">
              <span class="ach-card__icon" :class="`ach-card__icon--${a.unlocked ? 'on' : 'off'}`">{{ a.icon }}</span>
              <span class="ach-card__badge" :class="a.unlocked ? 'ach-card__badge--on' : 'ach-card__badge--off'">
                {{ a.unlocked ? '已解锁' : '未解锁' }}
              </span>
            </div>
            <strong class="ach-card__name">{{ a.name }}</strong>
            <p class="ach-card__desc">{{ a.description }}</p>
            <div class="ach-card__foot">
              <template v-if="a.unlocked">
                <span class="ach-card__xp">+{{ a.xpReward }} XP</span>
                <span class="ach-card__date">{{ formatDate(a.earnedAt) }}</span>
              </template>
              <template v-else>
                <div class="ach-card__prog">
                  <div class="ach-card__prog-bar"><i :style="{ width: progressPct(a) + '%' }"></i></div>
                  <span>{{ fmtNum(progressOf(a).current) }} / {{ fmtNum(progressOf(a).total) }}</span>
                </div>
                <span class="ach-card__xp ach-card__xp--off">{{ a.xpReward }} XP</span>
              </template>
            </div>
          </article>
        </div>
        <div v-else class="empty">
          <p>这个分类下还没有成就</p>
          <button type="button" class="btn-ghost" @click="statusFilter = 'all'; typeFilter = ''">查看全部</button>
        </div>
      </template>
    </main>

    <V2Footer />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import request from '@/utils/api';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import './v2.css';
import { unwrapArray } from './unwrap';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  type: string;
  unlocked: boolean;
  progress?: { current: number; total: number; percentage: number };
  earnedAt?: string | Date;
}

const items = ref<Achievement[]>([]);
const loading = ref(true);
const loadError = ref(false);
const statusFilter = ref<'all' | 'unlocked' | 'locked'>('all');
const typeFilter = ref('');

const statusFilters = [
  { key: 'all' as const, label: '全部' },
  { key: 'unlocked' as const, label: '已解锁' },
  { key: 'locked' as const, label: '未解锁' }
];

const TYPE_LABELS: Record<string, string> = {
  milestone: '里程碑',
  streak: '连续学习',
  completion: '完成度',
  mastery: '知识掌握'
};

const typeFilters = computed(() => {
  const types = [...new Set(items.value.map((a) => a.type))];
  return types.map((t) => ({ key: t, label: TYPE_LABELS[t] ?? t }));
});

const unlockedCount = computed(() => items.value.filter((a) => a.unlocked).length);
const totalXp = computed(() => items.value.filter((a) => a.unlocked).reduce((s, a) => s + (a.xpReward ?? 0), 0));

function progressOf(a: Achievement) {
  return a.progress ?? { current: 0, total: 1, percentage: 0 };
}

/* 进度数字格式化：整数不显示小数，小数最多 1 位 */
function fmtNum(n: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
}

function progressPct(a: Achievement) {
  const p = progressOf(a);
  return p.percentage ?? (p.total ? Math.round((p.current / p.total) * 100) : 0);
}

const visible = computed(() => {
  let list = items.value;
  if (statusFilter.value === 'unlocked') list = list.filter((a) => a.unlocked);
  if (statusFilter.value === 'locked') list = list.filter((a) => !a.unlocked);
  if (typeFilter.value) list = list.filter((a) => a.type === typeFilter.value);
  return [...list].sort((x, y) => Number(y.unlocked) - Number(x.unlocked) || progressPct(y) - progressPct(x));
});

function formatDate(d?: string | Date) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const response = await request.get('/achievements/all');
    items.value = unwrapArray<Achievement>(response);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
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
  cursor: pointer; transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}
.filter--active { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.07); color: var(--blue-deep); }
.filter--type { padding: 6px 12px; font-size: 12px; }
.filters__sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.ach-card { padding: 16px; display: flex; flex-direction: column; gap: 8px; transition: transform 0.16s ease, box-shadow 0.16s ease; }
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

<style scoped>
.ach-card__icon { font-size: 20px; }
.ach__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.spinner {
  width: 36px; height: 36px; border-radius: 50%;
  border: 4px solid rgba(52, 120, 246, 0.15);
  border-top-color: #3478f6;
  animation: ach-spin 0.9s linear infinite;
}
@keyframes ach-spin { to { transform: rotate(360deg); } }
.errorbar {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: #c0454a;
  font-size: 13px; font-weight: 600;
}
.errorbar__retry { text-decoration: underline; cursor: pointer; font-weight: 800; }
.btn-ghost {
  padding: 9px 16px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 13px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.empty { display: grid; justify-items: center; gap: 12px; padding: 48px 0; color: var(--faint); font-size: 13px; }
.ach { min-height: 100vh; display: flex; flex-direction: column; background: var(--canvas); }
.ach__main { flex: 1; width: 100%; }
</style>
