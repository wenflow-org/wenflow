<template>
  <div class="paths v2-page">
    <V2Nav />

    <main class="paths__main">
      <!-- 从目标页过来：生成提示 -->
      <transition name="toast">
        <div v-if="goalBanner" class="goal-banner">
          <span class="goal-banner__dot"></span>
          这版路径正在生成，一般 1-3 分钟。页面会自动刷新状态。
          <span class="goal-banner__close" @click="goalBanner = false">×</span>
        </div>
      </transition>

      <!-- 页头 -->
      <div class="paths__hero">
        <div>
          <span class="kicker">路径总览</span>
          <h1>{{ cards.length ? '继续你的学习计划' : '还没有学习路径' }}</h1>
          <p>{{ cards.length ? '查看当前任务、路径进度和需要处理的问题。' : '规划第一个目标，问流会为你生成可执行的学习路径。' }}</p>
          <AiContentNote />
        </div>
        <router-link to="/goal-conversation" class="btn-primary">＋ 规划新目标</router-link>
      </div>

      <!-- 加载 -->
      <div v-if="loading" class="paths__loading">
        <span class="spinner"></span>
        <p>正在加载学习路径…</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="loadError" class="errorbar">
        路径加载失败。<span class="errorbar__retry" @click="load">重试</span>
      </div>

      <template v-else>
        <!-- 筛选 -->
        <div class="filters">
          <button
            v-for="f in filterList"
            :key="f.key"
            type="button"
            class="filter"
            :class="{ 'filter--active': filter === f.key }"
            @click="filter = f.key"
          >
            {{ f.label }} <b>{{ f.count }}</b>
          </button>
        </div>

        <!-- 卡片列表 -->
        <div v-if="visibleCards.length" class="cards">
          <article v-for="card in visibleCards" :key="card.id" class="pcard" :class="`pcard--${card.kind}`">
            <div class="pcard__head">
              <span class="pcard__badge" :class="badgeCls(card)">{{ statusLabel(card) }}</span>
              <span class="pcard__more-wrap">
                <span class="pcard__more" title="更多操作" @click.stop="menuFor = menuFor === card.id ? '' : card.id">⋯</span>
                <span v-if="menuFor === card.id" class="pcard__menu">
                  <span v-if="card.kind === 'failed'" class="pcard__menu-item" @click="doRetry(card)">重新生成</span>
                  <span class="pcard__menu-item pcard__menu-item--danger" @click="askDelete(card)">删除路径</span>
                </span>
              </span>
            </div>
            <h3 class="pcard__title">{{ card.title }}</h3>
            <p class="pcard__desc">{{ card.desc }}</p>

            <!-- ready：阶段与进度 -->
            <template v-if="card.kind === 'ready' || card.kind === 'completed'">
              <div v-if="card.stages > 0" class="pcard__stages">
                <span
                  v-for="s in card.stages"
                  :key="s"
                  class="pcard__stage-dot"
                  :class="{ 'pcard__stage-dot--done': s <= card.stageDone, 'pcard__stage-dot--current': s === card.stageDone + 1 && card.kind === 'ready' }"
                >{{ s }}</span>
                <span class="pcard__stage-text">阶段 {{ Math.min(card.stageDone + 1, card.stages) }} / {{ card.stages }}</span>
              </div>
              <div class="pcard__progress"><i :style="{ width: card.percent + '%' }"></i></div>
              <div class="pcard__nums">
                <span>{{ card.kind === 'completed' ? '已完成' : `整体 ${card.percent}%` }}</span>
                <span v-if="card.hours">预计投入 {{ card.hours }} 小时</span>
              </div>
              <div v-if="deleting === card.id" class="pcard__confirm">
                确认删除这条路径？
                <span class="pcard__confirm-yes" @click="doDelete(card)">删除</span>
                <span class="pcard__confirm-no" @click="deleting = ''">取消</span>
              </div>
              <div class="pcard__actions">
                <router-link :to="`/learning-path/${card.id}`" class="btn-primary">
                  {{ card.kind === 'completed' ? '查看学习成果' : '继续学习' }}
                </router-link>
                <router-link :to="`/learning-path/${card.id}`" class="btn-ghost">查看详情</router-link>
              </div>
            </template>

            <!-- generating：生成中 -->
            <template v-else-if="card.kind === 'generating'">
              <div class="pcard__generating">
                <span class="spinner--sm spinner" style="border-color: rgba(67,176,216,.3); border-top-color: #43b0d8;"></span>
                <span>{{ card.phaseText }}</span>
              </div>
              <div class="pcard__skeleton"><i style="width: 76%"></i><i style="width: 52%"></i><i style="width: 64%"></i></div>
              <div class="pcard__actions">
                <span class="btn-ghost" @click="refreshStatus(card)">刷新状态</span>
              </div>
            </template>

            <!-- failed：待重试 -->
            <template v-else>
              <div class="pcard__fail-reason">{{ card.errorText || '生成失败，目标和已确认信息已保留。' }}</div>
              <div v-if="deleting === card.id" class="pcard__confirm">
                确认删除这条路径？
                <span class="pcard__confirm-yes" @click="doDelete(card)">删除</span>
                <span class="pcard__confirm-no" @click="deleting = ''">取消</span>
              </div>
              <div class="pcard__actions">
                <span class="btn-primary" :class="{ 'btn-primary--off': retrying === card.id }" @click="doRetry(card)">
                  <span v-if="retrying === card.id" class="spinner spinner--sm"></span>
                  {{ retrying === card.id ? '正在重新生成…' : card.retryLabel }}
                </span>
                <router-link :to="`/learning-path/${card.id}`" class="btn-ghost">查看详情</router-link>
              </div>
            </template>
          </article>
        </div>

        <!-- 筛选空态 -->
        <div v-else class="empty">
          <div class="empty__illus"><span></span><span></span><span></span></div>
          <p>{{ filter === 'all' ? '还没有学习路径，从规划一个目标开始' : '这个分类下还没有路径' }}</p>
          <router-link v-if="filter === 'all'" to="/goal-conversation" class="btn-primary">规划第一个目标</router-link>
          <span v-else class="btn-ghost" @click="filter = 'all'">查看全部</span>
        </div>
      </template>
    </main>

    <V2Footer />

    <!-- toast -->
    <transition name="toast">
      <div v-if="toast" class="toast">
        <span class="toast__icon">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
        </span>
        {{ toast }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import request, { AI_REQUEST_TIMEOUT } from '@/utils/api';
import { learningAPI } from '@/api/learning';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import V2Footer from './V2Footer.vue';
import './v2.css';

type CardKind = 'ready' | 'generating' | 'failed' | 'completed';
interface PathCard {
  id: string;
  title: string;
  desc: string;
  kind: CardKind;
  stages: number;
  stageDone: number;
  percent: number;
  hours?: number;
  retryType: 'core' | 'stage_design' | null;
  retryLabel: string;
  phaseText: string;
  errorText: string;
  status?: string;
}

const route = useRoute();
const cards = ref<PathCard[]>([]);
const loading = ref(true);
const loadError = ref(false);
const filter = ref<'all' | 'ready' | 'completed' | 'generating' | 'failed'>('all');
const retrying = ref('');
const menuFor = ref('');
const deleting = ref('');
const toast = ref('');
const goalBanner = ref(route.query.from === 'goal');

let toastTimer = 0;
function showToast(text: string) {
  toast.value = text;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ''), 3600);
}

function normalize(p: Record<string, any>): PathCard {
  const lc = p.generationLifecycle;
  const title = p.title || p.name || '未命名路径';
  const desc = p.description || p.summary || '';
  const stages: number = lc?.totalStages || p.totalStages || (p.milestones?.length ?? p.weeks?.length ?? 0);
  const hours = p.estimatedHours;

  if (lc && lc.phase !== 'ready') {
    if (lc.status === 'failed' || lc.status === 'stale') {
      return {
        id: p.id, title, desc, kind: 'failed', stages, stageDone: lc.completedStages ?? 0,
        percent: 0, hours, retryType: lc.retryType,
        retryLabel: lc.retryType === 'stage_design' ? '重新准备阶段任务' : '重新生成主结构',
        phaseText: '', errorText: lc.errorMessage || ''
      };
    }
    const phaseText = lc.phase === 'core'
      ? '主结构生成中，一般 1 分钟内完成…'
      : `阶段任务准备中（${lc.completedStages ?? 0}/${lc.totalStages ?? '?'}）…`;
    return {
      id: p.id, title, desc, kind: 'generating', stages, stageDone: lc.completedStages ?? 0,
      percent: 0, hours, retryType: null, retryLabel: '', phaseText, errorText: ''
    };
  }

  // ready
  const weeks = p.milestones || p.weeks || [];
  let totalTasks = 0;
  let doneTasks = 0;
  let stageDone = 0;
  for (const w of weeks) {
    const tasks = w.subtasks || w.tasks || [];
    let stageAllDone = tasks.length > 0;
    for (const t of tasks) {
      totalTasks += 1;
      if (t.status === 'completed') doneTasks += 1;
      else stageAllDone = false;
    }
    if (stageAllDone) stageDone += 1;
  }
  const percent = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : (lc ? 0 : 0);
  const kind: CardKind = p.status === 'completed' || percent >= 100 ? 'completed' : 'ready';
  return {
    id: p.id, title, desc, kind, stages: stages || weeks.length, stageDone,
    percent, hours, retryType: null, retryLabel: '', phaseText: '', errorText: '', status: p.status
  };
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const list = await learningAPI.getPaths();
    cards.value = (list as unknown as Array<Record<string, any>>).map(normalize);
    schedulePolling();
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

/* ---------- 生成中轮询 ---------- */
let pollTimer = 0;
function schedulePolling() {
  window.clearTimeout(pollTimer);
  if (!cards.value.some((c) => c.kind === 'generating')) return;
  pollTimer = window.setTimeout(pollOnce, 5000);
}

async function pollOnce() {
  const generating = cards.value.filter((c) => c.kind === 'generating');
  for (const c of generating) {
    try {
      const lc = await learningAPI.getPathGenerationStatus(c.id);
      if (lc.phase === 'ready') {
        showToast(`「${c.title}」已生成，可以开始了`);
        await load();
        return;
      }
      if (lc.status === 'failed' || lc.status === 'stale') {
        showToast(`「${c.title}」生成失败，可重试`);
        await load();
        return;
      }
      c.phaseText = lc.phase === 'core' ? '主结构生成中…' : `阶段任务准备中（${lc.completedStages ?? 0}/${lc.totalStages ?? '?'}）…`;
    } catch {
      /* 单条失败静默，下轮再试 */
    }
  }
  schedulePolling();
}

async function refreshStatus(card: PathCard) {
  try {
    const lc = await learningAPI.getPathGenerationStatus(card.id);
    if (lc.phase === 'ready') {
      showToast(`「${card.title}」已生成，可以开始了`);
      await load();
    } else {
      showToast('仍在生成中…');
    }
  } catch {
    showToast('刷新失败，稍后再试');
  }
}

async function doRetry(card: PathCard) {
  if (retrying.value) return;
  retrying.value = card.id;
  menuFor.value = '';
  try {
    if (card.retryType === 'stage_design') {
      await learningAPI.retryPathEnrichment(card.id);
    } else {
      await learningAPI.retryPathGeneration(card.id);
    }
    showToast('已提交重新生成，正在处理…');
    const idx = cards.value.findIndex((c) => c.id === card.id);
    if (idx >= 0) cards.value[idx] = { ...cards.value[idx], kind: 'generating', phaseText: '已提交，正在重新生成…' };
    schedulePolling();
  } catch {
    showToast('重试失败，请稍后再试');
  } finally {
    retrying.value = '';
  }
}

function askDelete(card: PathCard) {
  menuFor.value = '';
  deleting.value = card.id;
}

async function doDelete(card: PathCard) {
  try {
    await request.delete(`/learning/paths/${card.id}`, { timeout: AI_REQUEST_TIMEOUT });
    cards.value = cards.value.filter((c) => c.id !== card.id);
    showToast(`已删除「${card.title}」`);
  } catch {
    showToast('删除失败，请稍后再试');
  } finally {
    deleting.value = '';
  }
}

const countOf = (k: CardKind) => cards.value.filter((c) => c.kind === k).length;
const filterList = computed(() => [
  { key: 'all' as const, label: '全部', count: cards.value.length },
  { key: 'ready' as const, label: '进行中', count: countOf('ready') },
  { key: 'completed' as const, label: '已完成', count: countOf('completed') },
  { key: 'generating' as const, label: '生成中', count: countOf('generating') },
  { key: 'failed' as const, label: '待重试', count: countOf('failed') }
]);

const visibleCards = computed(() => {
  if (filter.value === 'all') return cards.value;
  return cards.value.filter((c) => c.kind === filter.value);
});

function statusLabel(card: PathCard) {
  if (card.kind === 'completed') return '已完成';
  if (card.kind === 'ready') return '进行中';
  if (card.kind === 'generating') return '生成中';
  return card.retryType === 'stage_design' ? '阶段任务失败' : '主结构失败';
}
function badgeCls(card: PathCard) {
  if (card.kind === 'completed') return 'pcard__badge--green';
  if (card.kind === 'ready') return 'pcard__badge--blue';
  if (card.kind === 'generating') return 'pcard__badge--cyan';
  return 'pcard__badge--red';
}

onMounted(() => {
  load();
  if (goalBanner.value) {
    window.setTimeout(() => (goalBanner.value = false), 9000);
  }
});

onBeforeUnmount(() => {
  window.clearTimeout(pollTimer);
  window.clearTimeout(toastTimer);
});
</script>

<style scoped>
.paths__main {
  max-width: 1080px; margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid; gap: 18px;
}
.paths__hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.kicker {
  font-size: 12px; font-weight: 800; letter-spacing: .06em;
  color: var(--blue-deep);
}
.paths__hero h1 { margin: 6px 0 4px; font-size: 28px; letter-spacing: -0.01em; }
.paths__hero p { margin: 0; font-size: 13.5px; color: var(--muted); }

.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer; text-decoration: none;
}
.btn-primary--busy { opacity: .85; cursor: default; }
.btn-ghost {
  padding: 10px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filter {
  border: 1px solid var(--line); background: #fff;
  border-radius: 999px; padding: 8px 15px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}
.filter b { margin-left: 4px; color: var(--faint); }
.filter--active { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.07); color: var(--blue-deep); }
.filter--active b { color: var(--blue); }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.pcard {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.pcard:hover { border-color: rgba(52, 120, 246, 0.3); box-shadow: 0 14px 34px rgba(23, 32, 51, 0.09); }
.pcard--generating { background: linear-gradient(180deg, rgba(67, 176, 216, 0.04), var(--surface) 55%); }
.pcard--failed { border-color: rgba(239, 117, 120, 0.3); }
.pcard__head { display: flex; align-items: center; justify-content: space-between; }
.pcard__badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.pcard__badge--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.pcard__badge--cyan { color: #2b7a99; background: rgba(67, 176, 216, 0.14); }
.pcard__badge--red { color: #c0454a; background: rgba(239, 117, 120, 0.12); }
.pcard__more { color: var(--faint); font-size: 18px; cursor: pointer; padding: 0 6px; }
.pcard__title { margin: 0; font-size: 17px; }
.pcard__desc { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.6; }

.pcard__stages { display: flex; align-items: center; gap: 6px; }
.pcard__stage-dot {
  width: 22px; height: 22px; border-radius: 8px;
  background: #eef2f8; color: var(--faint);
  font-size: 11px; font-weight: 800;
  display: grid; place-items: center;
}
.pcard__stage-dot--done { background: var(--green); color: #fff; }
.pcard__stage-dot--current { background: linear-gradient(135deg, var(--blue), var(--blue-deep)); color: #fff; box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.15); }
.pcard__stage-text { margin-left: 6px; font-size: 12px; color: var(--muted); }
.pcard__progress { height: 8px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.pcard__progress i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
.pcard__nums { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.pcard__actions { display: flex; gap: 10px; margin-top: 2px; flex-wrap: wrap; }
.pcard__actions .btn-primary { padding: 9px 18px; font-size: 13px; }
.pcard__actions .btn-ghost { padding: 8px 14px; font-size: 13px; }

.pcard__generating {
  display: flex; align-items: center; gap: 9px;
  font-size: 13px; color: #2b7a99; font-weight: 600;
}
.pcard__skeleton { display: grid; gap: 8px; }
.pcard__skeleton i {
  height: 11px; border-radius: 6px;
  background: linear-gradient(90deg, #e8f4f8 25%, #f4fbfd 50%, #e8f4f8 75%);
  background-size: 200% 100%;
  animation: paths-shimmer 1.5s ease infinite;
}
@keyframes paths-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.pcard__fail-reason {
  font-size: 12.5px; line-height: 1.6; color: #c0454a;
  background: rgba(239, 117, 120, 0.07);
  border: 1px dashed rgba(239, 117, 120, 0.35);
  border-radius: 10px; padding: 9px 12px;
}

.mini-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  animation: paths-spin .8s linear infinite;
  display: inline-block; flex: 0 0 auto;
}
.mini-spinner--blue { border-color: rgba(67, 176, 216, 0.3); border-top-color: var(--cyan); }
@keyframes paths-spin { to { transform: rotate(360deg); } }

.empty {
  display: grid; justify-items: center; gap: 12px;
  padding: 56px 0; color: var(--faint); font-size: 14px;
}
.empty__illus { display: flex; gap: 6px; }
.empty__illus span { width: 26px; height: 8px; border-radius: 99px; background: #e7edf7; }
.empty__illus span:nth-child(2) { background: rgba(52, 120, 246, 0.3); }

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
  background: var(--green); color: #fff;
  display: grid; place-items: center; flex: 0 0 auto;
}
.toast-enter-active, .toast-leave-active { transition: .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }

@media (max-width: 900px) {
  .paths__main { padding: 16px 14px 32px; }
  .paths__hero h1 { font-size: 22px; }
  .cards { grid-template-columns: 1fr; }
}
</style>

<style scoped>
.pcard__badge--green { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.pcard__more-wrap { position: relative; }
.pcard__menu {
  position: absolute; top: 26px; right: 0; z-index: 10;
  background: #fff; border: 1px solid var(--line);
  border-radius: 12px; padding: 5px;
  box-shadow: 0 12px 30px rgba(23, 32, 51, 0.14);
  display: grid; min-width: 120px;
}
.pcard__menu-item {
  padding: 8px 11px; border-radius: 8px;
  font-size: 12.5px; font-weight: 600; color: var(--muted);
  cursor: pointer; white-space: nowrap;
}
.pcard__menu-item:hover { background: #f1f5fb; color: var(--ink); }
.pcard__menu-item--danger { color: #c0454a; }
.pcard__menu-item--danger:hover { background: rgba(239, 117, 120, 0.08); color: #c0454a; }
.pcard__confirm {
  display: flex; align-items: center; gap: 9px;
  font-size: 12.5px; color: var(--muted);
  background: #fafcff; border: 1px dashed var(--line);
  border-radius: 10px; padding: 8px 11px;
}
.pcard__confirm-yes { color: #c0454a; font-weight: 800; cursor: pointer; }
.pcard__confirm-no { color: var(--faint); font-weight: 600; cursor: pointer; }
.paths__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.goal-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 15px;
  border-radius: 13px;
  background: rgba(52, 120, 246, 0.07);
  border: 1px solid rgba(52, 120, 246, 0.25);
  color: var(--blue-deep);
  font-size: 13px; font-weight: 600;
}
.goal-banner__dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--blue);
  animation: goal-pulse 1.4s ease-in-out infinite;
  flex: 0 0 auto;
}
@keyframes goal-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.goal-banner__close { margin-left: auto; cursor: pointer; color: var(--faint); font-size: 16px; }
.goal-banner__close:hover { color: var(--ink); }
.paths__main { width: 100%; }
</style>

<style scoped>
/* 超长机器生成标题：两行截断 */
.pcard__title, .hero h1, .path__title strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
