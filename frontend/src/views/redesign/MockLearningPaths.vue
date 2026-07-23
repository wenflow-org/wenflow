<template>
  <div class="paths">
    <MockNav active="paths" />

    <main class="paths__main">
      <!-- 页头 -->
      <div class="paths__hero">
        <div>
          <span class="kicker">路径总览</span>
          <h1>继续你的学习计划</h1>
          <p>查看当前任务、路径进度和需要处理的问题。</p>
        </div>
        <span class="btn-primary" @click="labGo('goal')">＋ 规划新目标</span>
      </div>

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
        <!-- 进行中 -->
        <article v-for="card in visibleCards" :key="card.id" class="pcard" :class="`pcard--${card.status}`">
          <div class="pcard__head">
            <span class="pcard__badge" :class="badgeCls(card.status)">{{ statusLabel(card) }}</span>
            <span class="pcard__more" title="更多操作">⋯</span>
          </div>
          <h3 class="pcard__title">{{ card.title }}</h3>
          <p class="pcard__desc">{{ card.desc }}</p>

          <!-- ready：阶段与进度 -->
          <template v-if="card.status === 'ready'">
            <div class="pcard__stages">
              <span
                v-for="s in card.stages"
                :key="s"
                class="pcard__stage-dot"
                :class="{ 'pcard__stage-dot--done': s <= card.stageDone, 'pcard__stage-dot--current': s === card.stageDone + 1 }"
              >{{ s }}</span>
              <span class="pcard__stage-text">阶段 {{ card.stageDone + 1 }} / {{ card.stages }}</span>
            </div>
            <div class="pcard__progress"><i :style="{ width: card.percent + '%' }"></i></div>
            <div class="pcard__nums">
              <span>整体 {{ card.percent }}%</span>
              <span>预计投入 {{ card.hours }} 小时</span>
            </div>
            <div class="pcard__actions">
              <span class="btn-primary" @click="labGo('path-detail')">继续学习</span>
              <span class="btn-ghost" @click="labGo('path-detail')">查看详情</span>
            </div>
          </template>

          <!-- generating：生成中 -->
          <template v-else-if="card.status === 'generating'">
            <div class="pcard__generating">
              <span class="mini-spinner mini-spinner--blue"></span>
              <span>主结构生成中，一般 1 分钟内完成…</span>
            </div>
            <div class="pcard__skeleton"><i style="width: 76%"></i><i style="width: 52%"></i><i style="width: 64%"></i></div>
            <div class="pcard__actions">
              <span class="btn-ghost" @click="bumpGenerating(card.id)">刷新状态</span>
            </div>
          </template>

          <!-- failed：待重试 -->
          <template v-else-if="card.status === 'failed'">
            <div class="pcard__fail-reason">主结构生成失败（服务响应异常），目标和已确认信息已保留。</div>
            <div class="pcard__actions">
              <span class="btn-primary" :class="{ 'btn-primary--busy': retrying === card.id }" @click="doRetry(card.id)">
                <span v-if="retrying === card.id" class="mini-spinner"></span>
                {{ retrying === card.id ? '正在重新生成…' : '重新生成主结构' }}
              </span>
              <span class="btn-ghost">查看失败详情</span>
            </div>
          </template>
        </article>
      </div>

      <!-- 筛选空态 -->
      <div v-else class="empty">
        <div class="empty__illus"><span></span><span></span><span></span></div>
        <p>这个分类下还没有路径</p>
        <span class="btn-ghost" @click="filter = 'all'">查看全部</span>
      </div>
    </main>
    <MockFooter />

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
import { computed, onBeforeUnmount, ref } from 'vue';
import MockNav from './MockNav.vue';
import MockFooter from './MockFooter.vue';
import { labGo } from './labStore';

type CardStatus = 'ready' | 'generating' | 'failed';
interface PathCard {
  id: string;
  title: string;
  desc: string;
  status: CardStatus;
  stages: number;
  stageDone: number;
  percent: number;
  hours: number;
}

const cards = ref<PathCard[]>([
  { id: 'p1', title: 'Excel 报表自动化', desc: '用 Python + pandas 自动合并销售报表到汇总表。', status: 'ready', stages: 4, stageDone: 1, percent: 40, hours: 5 },
  { id: 'p2', title: '职场沟通表达', desc: '围绕周会发言和跨部门协作的表达训练。', status: 'generating', stages: 4, stageDone: 0, percent: 0, hours: 4 },
  { id: 'p3', title: 'AI 自媒体副业', desc: '用 AI 工具搭一条内容生产流程。', status: 'failed', stages: 4, stageDone: 0, percent: 0, hours: 6 }
]);

const filter = ref<'all' | 'ready' | 'done' | 'generating' | 'failed'>('all');
const retrying = ref('');
const toast = ref('');

let toastTimer = 0;
function showToast(text: string) {
  toast.value = text;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200);
}

/* 生成中的卡片：演示自动轮询翻转 */
let genTimer = 0;
function scheduleGeneratingFlip(id: string) {
  window.clearTimeout(genTimer);
  genTimer = window.setTimeout(() => {
    const c = cards.value.find((x) => x.id === id);
    if (c && c.status === 'generating') {
      c.status = 'ready';
      c.percent = 5;
      showToast(`「${c.title}」已生成，可以开始了`);
    }
  }, 6000);
}
scheduleGeneratingFlip('p2');

function bumpGenerating(id: string) {
  showToast('已刷新，仍在生成中…');
  scheduleGeneratingFlip(id);
}

function doRetry(id: string) {
  if (retrying.value) return;
  retrying.value = id;
  window.setTimeout(() => {
    const c = cards.value.find((x) => x.id === id);
    if (c) {
      c.status = 'ready';
      c.percent = 5;
      showToast(`「${c.title}」重新生成成功`);
    }
    retrying.value = '';
  }, 2200);
}

const countOf = (s: CardStatus) => cards.value.filter((c) => c.status === s).length;
const filterList = computed(() => [
  { key: 'all' as const, label: '全部', count: cards.value.length },
  { key: 'ready' as const, label: '进行中', count: countOf('ready') },
  { key: 'done' as const, label: '已完成', count: 0 },
  { key: 'generating' as const, label: '生成中', count: countOf('generating') },
  { key: 'failed' as const, label: '待重试', count: countOf('failed') }
]);

const visibleCards = computed(() => {
  if (filter.value === 'all') return cards.value;
  if (filter.value === 'done') return [];
  return cards.value.filter((c) => c.status === filter.value);
});

function statusLabel(card: PathCard) {
  if (card.status === 'ready') return '进行中';
  if (card.status === 'generating') return '主结构生成中';
  return '主结构失败';
}
function badgeCls(status: CardStatus) {
  return status === 'ready' ? 'pcard__badge--blue' : status === 'generating' ? 'pcard__badge--cyan' : 'pcard__badge--red';
}

onBeforeUnmount(() => {
  window.clearTimeout(genTimer);
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
  cursor: pointer; transition: .14s ease;
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
  transition: .16s ease;
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
