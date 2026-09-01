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
        <SkeletonLoader variant="cards" :count="6" />
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
          <section class="card ov"><small>解锁进度</small><b>{{ items.length ? Math.round((unlockedCount / items.length) * 100) : 0 }}%</b><span>{{ unlockedCount }} / {{ items.length }}</span></section>
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
          <article
            v-for="a in visible"
            :key="a.id"
            class="card ach-card"
            :class="{
              'ach-card--locked': !a.unlocked,
              'ach-card--unlocked': a.unlocked
            }"
          >
            <!-- share button -->
            <button v-if="a.unlocked" type="button" class="ach-share" @click.stop="shareAchievement(a)" title="分享成就">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
            </button>

            <div class="ach-card__head">
              <span class="ach-card__icon-wrap" :class="`ach-card__icon--${a.unlocked ? 'on' : 'off'}`">
                <span class="ach-card__icon-emoji">{{ a.icon }}</span>
              </span>
              <div class="ach-card__head-right">
                <span v-if="a.unlocked" class="ach-rarity" :class="rarityOf(a.xpReward).cls">
                  {{ rarityOf(a.xpReward).label }}
                </span>
                <span class="ach-card__badge" :class="a.unlocked ? 'ach-card__badge--on' : 'ach-card__badge--off'">
                  {{ a.unlocked ? '已解锁' : '未解锁' }}
                </span>
              </div>
            </div>
            <strong class="ach-card__name">{{ a.name }}</strong>
            <p class="ach-card__desc">{{ descText(a) }}</p>
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

    <!-- AI 生成提示 + 页脚：一起沉底 -->
    <div class="ach__foot">
      <div class="ach__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toastMsg" class="ach-toast">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import request from '@/utils/api';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
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
const toastMsg = ref('');

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

/* 服务端成就条件含内部缩写 KTL（知识掌握度），直出前补全中文释义 */
function descText(a: Achievement): string {
  return String(a.description || '').replace(/KTL/g, '知识掌握度（KTL）');
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

function rarityOf(xp: number): { label: string; cls: string; color: string } {
  if (xp >= 200) return { label: '史诗', cls: 'rarity--epic', color: '#8d6bff' }
  if (xp >= 100) return { label: '稀有', cls: 'rarity--rare', color: '#3478f6' }
  if (xp >= 50) return { label: '精良', cls: 'rarity--uncommon', color: '#1e9e58' }
  return { label: '普通', cls: 'rarity--common', color: '#67758f' }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ''; }, 2200);
}

function shareAchievement(a: Achievement) {
  const text = `我在问流解锁了成就「${a.name}」！+${a.xpReward} XP`
  if (navigator.share) {
    navigator.share({ title: a.name, text }).catch(() => {})
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制到剪贴板');
    }).catch(() => {
      showToast('复制失败');
    })
  } else {
    showToast('浏览器不支持分享');
  }
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
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.ach__foot { margin-top: auto; }
.ach__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.ach__ai-note :deep(.ai-note) { font-size: 11px; opacity: 0.75; }

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
  border: 1px solid var(--line); background: var(--surface, #fff);
  border-radius: 999px; padding: 7px 15px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}
.filter--active { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.07); color: var(--blue-deep); }
.filter--type { padding: 6px 12px; font-size: 12px; }
.filters__sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }

/* ── Achievement Card ── */
.ach-card {
  padding: 16px; display: flex; flex-direction: column; gap: 8px;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
  position: relative;
}
.ach-card:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(23, 32, 51, 0.09); }

/* Locked treatment */
.ach-card--locked {
  background: var(--canvas, #fafcff);
  opacity: 0.6;
  filter: grayscale(0.3);
}
.ach-card--locked:hover {
  opacity: 0.8;
  filter: grayscale(0);
}

/* ── Unlock stagger animation ── */
.ach-card--unlocked {
  animation: ach-unlock 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.ach-card--unlocked:nth-child(1) { animation-delay: 0ms; }
.ach-card--unlocked:nth-child(2) { animation-delay: 60ms; }
.ach-card--unlocked:nth-child(3) { animation-delay: 120ms; }
.ach-card--unlocked:nth-child(4) { animation-delay: 180ms; }
.ach-card--unlocked:nth-child(5) { animation-delay: 240ms; }
.ach-card--unlocked:nth-child(6) { animation-delay: 300ms; }
.ach-card--unlocked:nth-child(7) { animation-delay: 360ms; }
.ach-card--unlocked:nth-child(8) { animation-delay: 420ms; }

@keyframes ach-unlock {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.ach-card__head { display: flex; align-items: center; justify-content: space-between; }
.ach-card__head-right { display: flex; align-items: center; gap: 6px; }

/* ── Icon wrapper with pseudo-element treatment ── */
.ach-card__icon-wrap {
  width: 48px; height: 48px;
  border-radius: 14px;
  display: grid; place-items: center;
  position: relative;
  overflow: hidden;
}
.ach-card__icon-wrap::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit;
  opacity: 0.12;
}
.ach-card__icon--on { color: var(--blue-deep); }
.ach-card__icon--on .ach-card__icon-wrap::before {
  background: linear-gradient(135deg, var(--blue), var(--accent));
}
.ach-card__icon--off { color: var(--faint); }
.ach-card__icon--off .ach-card__icon-wrap::before {
  background: var(--line);
}
.ach-card__icon-emoji {
  font-size: 24px;
  position: relative;
  z-index: 1;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1));
}

/* ── Rarity tag ── */
.ach-rarity {
  font-size: 10px; font-weight: 800;
  padding: 2px 7px; border-radius: 999px;
  letter-spacing: 0.3px;
}
.rarity--common { color: #67758f; background: rgba(103,117,143,0.1); }
.rarity--uncommon { color: #1e9e58; background: rgba(30,158,88,0.1); }
.rarity--rare { color: #3478f6; background: rgba(52,120,246,0.1); }
.rarity--epic { color: #8d6bff; background: rgba(141,107,255,0.12); }

/* ── Badge ── */
.ach-card__badge { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; }
.ach-card__badge--on { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.ach-card__badge--off { color: var(--muted); background: var(--line, #e8edf5); }
.ach-card__name { font-size: 15px; }
.ach-card__desc { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.55; flex: 1; }
.ach-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px dashed var(--line); padding-top: 10px; }
.ach-card__xp { font-size: 12px; font-weight: 800; color: var(--accent, #6a4de0); }
.ach-card__xp--off { color: var(--faint); }
.ach-card__date { font-size: 11.5px; color: var(--faint); }
.ach-card__prog { display: flex; align-items: center; gap: 8px; flex: 1; }
.ach-card__prog-bar { flex: 1; height: 6px; border-radius: 99px; background: var(--line, #edf1f8); overflow: hidden; }
.ach-card__prog-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.ach-card__prog span { font-size: 11px; color: var(--faint); white-space: nowrap; }

/* ── Share button ── */
.ach-share {
  position: absolute; top: 8px; right: 8px;
  width: 28px; height: 28px;
  border-radius: 8px; border: 0;
  background: rgba(0,0,0,0.04);
  color: var(--faint);
  display: grid; place-items: center;
  cursor: pointer;
  opacity: 0; transition: opacity 0.15s, background 0.15s;
}
.ach-card:hover .ach-share { opacity: 1; }
.ach-share:hover { background: rgba(0,0,0,0.08); color: var(--ink); }

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
.ach__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.spinner {
  width: 36px; height: 36px; border-radius: 50%;
  border: 4px solid rgba(52, 120, 246, 0.15);
  border-top-color: var(--blue, #3478f6);
  animation: ach-spin 0.9s linear infinite;
}
@keyframes ach-spin { to { transform: rotate(360deg); } }
.errorbar {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: var(--red, #c0454a);
  font-size: 13px; font-weight: 600;
}
.errorbar__retry { text-decoration: underline; cursor: pointer; font-weight: 800; }
.btn-ghost {
  padding: 9px 16px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 13px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.empty { display: grid; justify-items: center; gap: 12px; padding: 48px 0; color: var(--faint); font-size: 13px; }
.ach { min-height: calc(100vh - 41px); display: flex; flex-direction: column; background: var(--canvas); }
.ach__main { width: 100%; }

/* ── Toast ── */
.ach-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: #1e293b; color: #fff;
  padding: 10px 20px; border-radius: 12px;
  font-size: 13px; font-weight: 600;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  z-index: 9999;
  pointer-events: none;
}
.toast-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.toast-leave-active { transition: all 0.2s ease-in; }
.toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(12px) scale(0.95); }
.toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.97); }
</style>
