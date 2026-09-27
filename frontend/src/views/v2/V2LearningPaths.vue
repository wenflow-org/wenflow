<template>
  <div class="paths v2-page">
    <V2Nav />

    <main class="paths__main">
      <!-- 从目标页过来：生成提示 -->
      <transition name="toast">
        <div v-if="goalBanner" class="goal-banner">
          <span class="goal-banner__dot"></span>
          这版路径正在生成，一般 1-3 分钟。页面会自动刷新状态。
          <button type="button" class="goal-banner__close" @click="goalBanner = false">×</button>
        </div>
      </transition>

      <!-- 页头 -->
      <div class="paths__hero">
        <div>
          <h1>{{ cards.length ? '继续你的学习计划' : '还没有学习路径' }}</h1>
          <p>{{ cards.length ? '查看当前任务、路径进度和需要处理的问题。' : '规划第一个目标，问流会为你生成可执行的学习路径。' }}</p>
        </div>
      </div>

      <!-- 加载 -->
      <div v-if="loading" class="paths__loading">
        <SkeletonLoader variant="list" :count="4" />
      </div>

      <!-- 失败 -->
      <div v-else-if="loadError" class="errorbar">
        路径加载失败。<button type="button" class="errorbar__retry" @click="load">重试</button>
      </div>

      <template v-else>
        <!-- 筛选（无任何路径时整行隐藏：空态下五个「0」芯片是噪音，2026-09-24 全新账号走查发现） -->
        <div v-if="cards.length" class="filters">
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

        <!-- 搜索 + 排序（批18）：路径多了以后不能只靠分类芯片逐个翻；q 入 URL 与筛选同口径 -->
        <div v-if="cards.length" class="paths__tools">
          <label class="paths__search">
            <Search :size="15" :stroke-width="1.75" aria-hidden="true" />
            <input
              v-model="search"
              type="search"
              placeholder="搜索路径标题或内容"
              aria-label="搜索学习路径"
            />
            <button v-if="search" type="button" class="paths__search-clear" aria-label="清空搜索" @click="search = ''">×</button>
          </label>
          <label class="paths__sort">
            <span class="paths__sort-label">排序</span>
            <select v-model="sort" aria-label="排序方式">
              <option value="default">默认</option>
              <option value="progress">按进度</option>
            </select>
          </label>
        </div>

        <!-- 移动端筛选（批13）：芯片行在 375 折两行占首屏 ~9%，≤1100 收进按钮 + 底部弹层；
             桌面仍用芯片行。单选即点即生效并收起。 -->
        <button
          v-if="cards.length"
          type="button"
          class="paths__filter-btn"
          :aria-expanded="filterSheetOpen ? 'true' : 'false'"
          @click="filterSheetOpen = true"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 5h18l-7 8v5l-4-2v-3z"/></svg>
          筛选 · {{ activeFilterLabel }}
        </button>
        <div v-if="filterSheetOpen" class="paths__filter-mask" @click.self="filterSheetOpen = false">
          <div class="paths__filter-sheet" role="dialog" aria-label="筛选路径">
            <div class="paths__filter-head">
              <strong>筛选路径</strong>
              <button type="button" class="paths__filter-close" aria-label="关闭" @click="filterSheetOpen = false">×</button>
            </div>
            <button
              v-for="f in filterList"
              :key="f.key"
              type="button"
              class="paths__filter-opt"
              :class="{ 'is-active': filter === f.key }"
              @click="filter = f.key; filterSheetOpen = false"
            >
              <span>{{ f.label }}</span>
              <b>{{ f.count }}</b>
              <i v-if="filter === f.key" class="paths__filter-tick" aria-hidden="true">✓</i>
            </button>
          </div>
        </div>

        <!-- 卡片列表 -->
        <div v-if="visibleCards.length" class="cards">
          <article
            v-for="card in visibleCards"
            :key="card.id"
            class="pcard"
            :class="[`pcard--${card.kind}`, { 'pcard--menu-open': menuFor === card.id }]"
            @click="openPath(card)"
          >
            <div class="pcard__head">
              <span class="pcard__thumb" aria-hidden="true">{{ thumbLetter(card) }}</span>
              <div class="pcard__body">
                <h3 class="pcard__title">
                  <!-- 标题是真链接：键盘 Tab/读屏由此进入详情（整卡点击只是鼠标便利，批18） -->
                  <router-link :to="'/learning-path/' + card.id" @click.stop>{{ card.title }}</router-link>
                </h3>
                <p class="pcard__desc">{{ card.desc }}</p>
              </div>
              <div class="pcard__head-right">
                <span v-if="card.kind === 'generating' || card.kind === 'failed'" class="pcard__badge" :class="badgeCls(card)">{{ statusLabel(card) }}</span>
                <span class="pcard__more-wrap">
                  <button
                    type="button"
                    class="pcard__more"
                    :class="{ 'is-open': menuFor === card.id }"
                    title="更多操作"
                    aria-label="更多操作"
                    aria-haspopup="menu"
                    :aria-expanded="menuFor === card.id ? 'true' : 'false'"
                    @click.stop="menuFor = menuFor === card.id ? '' : card.id"
                  >
                    <MoreHorizontal :size="17" aria-hidden="true" />
                  </button>
                  <!-- 防误触（2026-09-27）：菜单开着时全屏透明遮罩把「关菜单的那一tap」吃掉，
                       不让它落到「删除路径」或卡片导航上；开菜单的卡片钉住不抬升，
                       否则 transform 会把 fixed 遮罩的包含块改成卡片自身 -->
                  <div v-if="menuFor === card.id" class="pcard__menu-scrim" @click.stop="menuFor = ''"></div>
                  <div v-if="menuFor === card.id" class="pcard__menu" role="menu" @click.stop>
                    <button type="button" v-if="card.kind === 'failed'" class="pcard__menu-item" role="menuitem" @click="doRetry(card)">
                      <RotateCcw :size="15" aria-hidden="true" />重新生成
                    </button>
                    <div v-if="card.kind === 'failed'" class="pcard__menu-sep" role="separator"></div>
                    <button type="button" class="pcard__menu-item pcard__menu-item--danger" role="menuitem" @click="askDelete(card)">
                      <Trash2 :size="15" aria-hidden="true" />删除路径
                    </button>
                  </div>
                </span>
              </div>
            </div>

            <!-- ready：进度行 + 底部信息栏 -->
            <template v-if="card.kind === 'ready' || card.kind === 'completed'">
              <div class="pcard__progress-row">
                <div class="pcard__progress"><i :style="{ width: card.percent + '%' }"></i></div>
                <span class="pcard__percent">{{ card.percent }}%</span>
              </div>
              <div class="pcard__foot">
                <span class="pcard__meta">
                  阶段 {{ Math.max(1, Math.min(card.stageDone + 1, card.stages)) }} / {{ card.stages }}
                  <template v-if="card.hours"> · 预计 {{ card.hours }} 小时</template>
                </span>
                <span class="pcard__cta">
                  {{ card.kind === 'completed' ? '查看学习成果' : '继续学习' }}
                  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M13 5v6H5v2h8v6l7-7z"/></svg>
                </span>
              </div>
              <div v-if="deleting === card.id" class="pcard__confirm" @click.stop>
                <span>确认删除这条路径？删除后不可自行恢复。</span>
                <button type="button" class="pcard__confirm-yes" @click="doDelete(card)">删除</button>
                <button type="button" class="pcard__confirm-no" @click="deleting = ''">取消</button>
              </div>
            </template>

            <!-- generating：生成中（不做假骨架填高：真实信息只有 phaseText 与刷新，2026-09-23 批18） -->
            <template v-else-if="card.kind === 'generating'">
              <div class="pcard__generating">
                <span class="spinner--sm spinner" style="border-color: color-mix(in srgb, var(--cyan) 30%, transparent); border-top-color: var(--cyan);"></span>
                <span>{{ card.phaseText }}</span>
              </div>
              <div class="pcard__actions">
                <button type="button" class="btn-ghost" @click.stop="refreshStatus(card)">刷新状态</button>
              </div>
            </template>

            <!-- failed：待重试 -->
            <template v-else>
              <div class="pcard__fail-reason">{{ card.errorText || '生成失败，目标和已确认信息已保留。' }}</div>
              <div v-if="deleting === card.id" class="pcard__confirm" @click.stop>
                <span>确认删除这条路径？删除后不可自行恢复。</span>
                <button type="button" class="pcard__confirm-yes" @click="doDelete(card)">删除</button>
                <button type="button" class="pcard__confirm-no" @click="deleting = ''">取消</button>
              </div>
              <div class="pcard__actions">
                <button type="button" class="btn-primary" :class="{ 'btn-primary--off': retrying === card.id }" @click.stop="doRetry(card)">
                  <span v-if="retrying === card.id" class="spinner spinner--sm"></span>
                  {{ retrying === card.id ? '正在重新生成…' : card.retryLabel }}
                </button>
              </div>
            </template>
          </article>
        </div>

        <!-- 筛选/搜索空态 -->
        <div v-else class="empty">
          <div class="empty__illus"><span></span><span></span><span></span></div>
          <p>{{ emptyText }}</p>
          <router-link v-if="cards.length === 0" to="/goal-conversation" class="btn-primary">规划第一个目标</router-link>
          <button v-else type="button" class="btn-ghost" @click="search ? (search = '') : (filter = 'all')">{{ search ? '清除搜索' : '查看全部' }}</button>
        </div>
      </template>
    </main>

    <!-- AI 生成提示 + 页脚：一起沉底 -->
    <div class="paths__foot">
      <div class="paths__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MoreHorizontal, RotateCcw, Search, Trash2 } from 'lucide-vue-next';
import request, { AI_REQUEST_TIMEOUT } from '@/utils/api';
import { toast } from '@/utils/toast';
import { learningAPI } from '@/api/learning';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import V2Footer from './V2Footer.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';

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
const router = useRouter();
const cards = ref<PathCard[]>([]);
const loading = ref(true);
const loadError = ref(false);
type FilterKey = 'all' | 'ready' | 'completed' | 'generating' | 'failed';
const FILTER_KEYS: FilterKey[] = ['all', 'ready', 'completed', 'generating', 'failed'];
/* 筛选态入 URL（?filter=）：返回/刷新/分享都不丢（此前存组件 ref，返回列表重置回「全部」）。
   all 时删键保持 URL 干净；replace 不清 from=goal 等同页既有 query。 */
const filter = ref<FilterKey>(
  FILTER_KEYS.includes(route.query.filter as FilterKey) ? (route.query.filter as FilterKey) : 'all'
);
/* 搜索（q 入 URL，与 filter 同口径：返回/刷新不丢）与排序（运行态，不入 URL） */
const search = ref(typeof route.query.q === 'string' ? route.query.q : '');
const sort = ref<'default' | 'progress'>('default');
const retrying = ref('');
const menuFor = ref('');
const deleting = ref('');
const goalBanner = ref(route.query.from === 'goal');
/** 生成状态轮询连续失败计数（超过阈值停止空转） */
const pollFailCount = ref(0);

const deleteBusy = ref(false);

function normalize(p: Record<string, any>): PathCard {
  const lc = p.generationLifecycle;
  const title = p.title || p.name || '未命名路径';
  // AI 生成的简短摘要优先（path-planning summary），旧数据回退用户目标原文
  const desc = p.summary || p.description || '';
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
      ? '主结构生成中，一般 1-2 分钟内完成…'
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
  const percent = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
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
  if (!generating.length) return;
  type PollStatus = {
    card: (typeof generating)[number];
    lc: Awaited<ReturnType<typeof learningAPI.getPathGenerationStatus>>;
  };
  // 多卡并行查状态:原先串行 for 循环,N 张卡 = 每轮 N 个串行 RTT
  const results = await Promise.allSettled(
    generating.map(async (c): Promise<PollStatus> => ({ card: c, lc: await learningAPI.getPathGenerationStatus(c.id) }))
  );
  const settled = results.filter(
    (r): r is Extract<(typeof results)[number], { status: 'fulfilled' }> => r.status === 'fulfilled'
  );
  const finished = settled.filter(
    (r) => r.value.lc.phase === 'ready' || r.value.lc.status === 'failed' || r.value.lc.status === 'stale'
  );
  if (finished.length) {
    for (const r of finished) {
      if (r.value.lc.phase === 'ready') toast.success(`「${r.value.card.title}」已生成，可以开始了`);
      else toast.error(`「${r.value.card.title}」生成失败，可重试`);
    }
    await load();
    return;
  }
  for (const r of settled) {
    const { card, lc } = r.value;
    card.phaseText = lc.phase === 'core' ? '主结构生成中…' : `阶段任务准备中（${lc.completedStages ?? 0}/${lc.totalStages ?? '?'}）…`;
  }
  const failCount = results.length - settled.length;
  // 单条失败静默累计;连续失败过多说明状态接口异常,停止空转轮询
  if (failCount > 0 && failCount >= generating.length && pollFailCount.value >= 6) {
    toast.warning('生成状态查询失败，请手动刷新');
    return;
  }
  if (failCount >= generating.length) {
    pollFailCount.value += 1;
  } else {
    pollFailCount.value = 0;
  }
  schedulePolling();
}

async function refreshStatus(card: PathCard) {
  // 手动刷新：重置断路器计数（用户主动重试应重新计数）
  pollFailCount.value = 0;
  try {
    const lc = await learningAPI.getPathGenerationStatus(card.id);
    if (lc.phase === 'ready') {
      toast.success(`「${card.title}」已生成，可以开始了`);
      await load();
    } else if (lc.status === 'failed' || lc.status === 'stale') {
      toast.error(`「${card.title}」生成失败，可重试`);
      await load();
    } else {
      toast.info('仍在生成中…');
    }
  } catch {
    toast.error('刷新失败，稍后再试');
  }
}

async function doRetry(card: PathCard) {
  if (retrying.value) return;
  // 手动重试：重置断路器计数（用户主动重试应重新计数）
  pollFailCount.value = 0;
  retrying.value = card.id;
  menuFor.value = '';
  try {
    if (card.retryType === 'stage_design') {
      await learningAPI.retryPathEnrichment(card.id);
    } else {
      await learningAPI.retryPathGeneration(card.id);
    }
    toast.info('已提交重新生成，正在处理…');
    const idx = cards.value.findIndex((c) => c.id === card.id);
    if (idx >= 0) cards.value[idx] = { ...cards.value[idx], kind: 'generating', phaseText: '已提交，正在重新生成…' };
    schedulePolling();
  } catch {
    toast.error('重试失败，请稍后再试');
  } finally {
    retrying.value = '';
  }
}

function askDelete(card: PathCard) {
  menuFor.value = '';
  deleting.value = card.id;
}

async function doDelete(card: PathCard) {
  if (deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    await request.delete(`/learning/paths/${card.id}`, { timeout: AI_REQUEST_TIMEOUT });
    cards.value = cards.value.filter((c) => c.id !== card.id);
    toast.success(`已删除「${card.title}」`);
  } catch {
    toast.error('删除失败，请稍后再试');
  } finally {
    deleteBusy.value = false;
    deleting.value = '';
  }
}

const countOf = (k: CardKind) => cards.value.filter((c) => c.kind === k).length;

/** 图标锚点：取路径标题首字符（视觉识别） */
function thumbLetter(card: PathCard) {
  const t = (card.title || '').trim();
  return t ? t.charAt(0).toUpperCase() : '路';
}

/** 整卡可点击：进入路径详情页 */
function openPath(card: PathCard) {
  router.push(`/learning-path/${card.id}`);
}const filterList = computed(() => [
  { key: 'all' as const, label: '全部', count: cards.value.length },
  { key: 'ready' as const, label: '进行中', count: countOf('ready') },
  { key: 'completed' as const, label: '已完成', count: countOf('completed') },
  { key: 'generating' as const, label: '生成中', count: countOf('generating') },
  { key: 'failed' as const, label: '待重试', count: countOf('failed') }
]);

/* 移动端筛选弹层（批13）：Esc 关闭 + 开启时锁页面滚动 */
const filterSheetOpen = ref(false);
const activeFilterLabel = computed(() => filterList.value.find((f) => f.key === filter.value)?.label || '全部');
function onFilterSheetKey(e: KeyboardEvent) {
  if (e.key === 'Escape') filterSheetOpen.value = false;
}
watch(filterSheetOpen, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onFilterSheetKey);
  } else {
    document.body.style.overflow = '';
    window.removeEventListener('keydown', onFilterSheetKey);
  }
});

const emptyText = computed(() => {
  if (search.value) return '没有匹配的路径，换个关键词试试';
  if (cards.value.length === 0) return '还没有学习路径，从规划一个目标开始';
  return '这个分类下还没有路径';
});

const visibleCards = computed(() => {
  let list = cards.value;
  if (filter.value !== 'all') list = list.filter((c) => c.kind === filter.value);
  const kw = search.value.trim().toLowerCase();
  if (kw) list = list.filter((c) => (c.title + ' ' + c.desc).toLowerCase().includes(kw));
  if (sort.value === 'progress') list = [...list].sort((a, b) => b.percent - a.percent);
  return list;
});

/* 筛选态 ↔ URL 双向同步：点芯片 replace 进 query（不产生历史项）；
   浏览器返回/前进时从 query 恢复筛选（filterSheetOpen/sort 等运行态不进 URL） */
watch(filter, (v) => {
  const q = { ...route.query };
  if (v === 'all') delete q.filter;
  else q.filter = v;
  void router.replace({ query: q }).catch(() => {});
});
watch(
  () => route.query.filter,
  (v) => {
    const next: FilterKey = FILTER_KEYS.includes(v as FilterKey) ? (v as FilterKey) : 'all';
    if (filter.value !== next) filter.value = next;
  }
);
watch(search, (v) => {
  const q = { ...route.query };
  if (v) q.q = v;
  else delete q.q;
  void router.replace({ query: q }).catch(() => {});
});
watch(
  () => route.query.q,
  (v) => {
    const next = typeof v === 'string' ? v : '';
    if (search.value !== next) search.value = next;
  }
);

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

function onMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuFor.value = '';
}
function onWindowClick() {
  menuFor.value = '';
}
/* 滚动即收起「⋯」菜单：它悬在卡片之上，滚动后停留位置不可预期，
   是「删除路径」误触的主要来源（2026-09-27 用户反馈容易误触） */
function onWindowScroll() {
  menuFor.value = '';
}

onMounted(() => {
  load();
  if (goalBanner.value) {
    window.setTimeout(() => (goalBanner.value = false), 9000);
  }
  window.addEventListener('keydown', onMenuKey);
  window.addEventListener('click', onWindowClick);
  window.addEventListener('scroll', onWindowScroll, { passive: true });
});

onBeforeUnmount(() => {
  filterSheetOpen.value = false;
  window.clearTimeout(pollTimer);
  window.removeEventListener('keydown', onMenuKey);
  window.removeEventListener('click', onWindowClick);
  window.removeEventListener('scroll', onWindowScroll);
});
</script>

<style scoped>
.paths__main {
  max-width: 1080px; margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid; gap: 18px;
}
.paths__hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
/* 搜索+排序工具行（批18）：全尺寸常显（移动端芯片行收弹层后，这里是唯一检索入口） */
.paths__tools { display: flex; align-items: center; gap: 10px; margin: 14px 0 2px; flex-wrap: wrap; }
.paths__search {
  flex: 1 1 220px; max-width: 420px;
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px; min-height: 38px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  color: var(--faint);
  transition: border-color var(--mk-dur-fast, 120ms) ease, box-shadow var(--mk-dur-fast, 120ms) ease;
}
.paths__search:focus-within {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 14%, transparent);
}
.paths__search input {
  flex: 1; min-width: 0; min-height: 44px; border: 0; background: none; font: inherit; font-size: 13.5px;
  color: var(--ink); outline: none;
}
.paths__search input::placeholder { color: var(--faint); }
.paths__search-clear { border: 0; background: none; padding: 4px; font-size: 15px; color: var(--faint); cursor: pointer; line-height: 1; }
.paths__search-clear:hover { color: var(--ink); }
.paths__sort { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
.paths__sort select {
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink);
  padding: 7px 8px; border-radius: var(--mk-radius-md);
  border: 1px solid var(--line); background: var(--surface); cursor: pointer;
}
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.paths__foot { margin-top: auto; }
.paths__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.paths__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }
.kicker {
  font-size: 12px; font-weight: 800; letter-spacing: .06em;
  color: var(--blue-deep);
}
.paths__hero h1 { margin: 6px 0 4px; font-size: 20px; letter-spacing: -0.01em; }
.paths__hero p { margin: 0; font-size: 13.5px; color: var(--muted); }

.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: var(--mk-radius-xl);
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px color-mix(in srgb, var(--blue) 30%, transparent);
  cursor: pointer; text-decoration: none;
}
.btn-ghost {
  padding: 10px 18px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filter {
  border: 1px solid var(--line); background: var(--surface, #fff);
  border-radius: var(--mk-radius-pill); padding: 8px 15px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}
.filter b { margin-left: 4px; color: var(--faint); }
.filter--active { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.07); color: var(--blue-deep); }
.filter--active b { color: var(--blue); }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.pcard {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
  cursor: pointer;
}
.pcard:hover { border-color: color-mix(in srgb, var(--blue) 30%, transparent); box-shadow: 0 14px 34px rgba(23, 32, 51, 0.09); transform: translateY(-1px); }
/* 状态色侧条 */
.pcard::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  border-radius: 16px 0 0 16px; background: transparent;
}
.pcard--ready::before { background: linear-gradient(180deg, var(--blue), var(--cyan)); }
.pcard--completed::before { background: var(--green); }
.pcard--generating::before { background: var(--cyan); }
.pcard--failed::before { background: linear-gradient(180deg, var(--red), var(--amber)); }
.pcard--generating { background: linear-gradient(180deg, rgba(67, 176, 216, 0.04), var(--surface) 55%); }
.pcard--failed { border-color: color-mix(in srgb, var(--red) 30%, transparent); }
.pcard__head { display: flex; align-items: center; gap: 12px; }
.pcard__thumb {
  width: 36px; height: 36px; border-radius: 11px;
  display: grid; place-items: center;
  color: #fff; font-size: 15px; font-weight: 800;
  flex: 0 0 auto;
}
.pcard--ready .pcard__thumb { background: linear-gradient(135deg, var(--blue), var(--cyan)); }
.pcard--completed .pcard__thumb { background: linear-gradient(135deg, var(--green), #58c98f); }
.pcard--generating .pcard__thumb { background: linear-gradient(135deg, var(--cyan), #7cc7e2); }
.pcard--failed .pcard__thumb { background: linear-gradient(135deg, var(--red), var(--amber)); }
.pcard__body { flex: 1; min-width: 0; }
.pcard__head-right { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.pcard__badge { padding: 3px 9px; border-radius: var(--mk-radius-pill); font-size: 12px; font-weight: 800; flex: 0 0 auto; }
.pcard__badge--green { color: var(--green-ink); background: rgba(49, 177, 111, 0.12); }
.pcard__badge--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.pcard__badge--cyan { color: var(--blue-deep, #2b7a99); background: rgba(67, 176, 216, 0.14); }
.pcard__badge--red { color: var(--red, #c0454a); background: rgba(239, 117, 120, 0.12); }
/* 2026-09-27 防误触：⋯ 从裸文本字形升级成实体幽灵按钮——有边界、有 hover/open 态，
   32×32（移动 36 + 伪元素热区 52+），误触概率与「看起来能不能按」同时收敛 */
.pcard__more {
  width: 32px; height: 32px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--mk-radius-md, 10px);
  background: none; color: var(--faint); cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.pcard__more:hover,
.pcard__more.is-open { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
.pcard__title {
  margin: 0; font-size: 15px; line-height: 1.4;
  min-width: 0;
  /* 固定 2 行展示高度：1 行标题与 2 行标题的卡 head 高度一致，内部元素水平对齐 */
  min-height: calc(1.4em * 2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pcard__title a {
  color: inherit; text-decoration: none;
  /* 块级撑满标题 clamp 区并负边距外扩：单行标题也有 ≥44 触诊高（mobile:spec），视觉不变 */
  display: block; padding: 8px 10px; margin: -8px -10px;
  min-height: 44px;
}
.pcard__title a:hover { color: var(--blue-deep); }
.pcard__desc {
  margin: 4px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.6;
  /* 固定 2 行展示高度（与 title 同理） */
  min-height: calc(1.6em * 2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

.pcard__progress-row { display: flex; align-items: center; gap: 10px; flex: 1; }
.pcard__progress { flex: 1; height: 6px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.pcard__progress i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
.pcard__percent {
  font-size: 12px; font-weight: 800; color: var(--blue-deep);
  font-variant-numeric: tabular-nums; flex: 0 0 auto;
}
.pcard__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; }
.pcard__meta { font-size: 12px; color: var(--faint); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcard__cta {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 800; color: var(--blue-deep);
  white-space: nowrap; flex: 0 0 auto;
  transition: color 0.15s ease, transform 0.15s ease;
}
.pcard__cta svg { transition: transform 0.15s ease; }
.pcard:hover .pcard__cta { transform: translateX(2px); }
.pcard__actions { display: flex; justify-content: flex-end; margin-top: auto; }

.pcard__generating {
  display: flex; align-items: center; gap: 9px;
  font-size: 13px; color: var(--blue-deep, #2b7a99); font-weight: 600;
}
/* 生成中不再用假骨架填高（批18）：真实信息只有 phaseText 与刷新动作 */

.pcard__fail-reason {
  font-size: 12.5px; line-height: 1.6; color: var(--red, #c0454a);
  background: color-mix(in srgb, var(--red) 7%, transparent);
  border: 1px dashed color-mix(in srgb, var(--red) 35%, transparent);
  border-radius: var(--mk-radius-lg); padding: 9px 12px;
}
/* 失败：原因区弹性拉伸，重试按钮压底（与 ready 卡内容高度对齐） */
.pcard--failed .pcard__fail-reason { flex: 1; display: grid; align-content: center; }

.empty {
  display: grid; justify-items: center; align-content: center; gap: 12px;
  /* 空态留白优化：占用剩余视口空间并垂直居中，避免内容缩在顶部、下方大段空白 */
  min-height: 52vh;
  padding: 56px 0; color: var(--faint); font-size: 14px;
}
.empty__illus { display: flex; gap: 6px; }
.empty__illus span { width: 26px; height: 8px; border-radius: 99px; background: #e7edf7; }
.empty__illus span:nth-child(2) { background: color-mix(in srgb, var(--blue) 30%, transparent); }

.toast {
  position: fixed; top: 76px; right: 24px; z-index: 50;
  display: flex; align-items: center; gap: 9px;
  background: var(--ink); color: #fff;
  font-size: 13px; font-weight: 600;
  padding: 11px 16px; border-radius: var(--mk-radius-xl);
  box-shadow: 0 16px 40px rgba(23, 32, 51, 0.3);
}
.toast__icon {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--green); color: #fff;
  display: grid; place-items: center; flex: 0 0 auto;
}
.toast-enter-active, .toast-leave-active { transition: .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }

@media (max-width: 1100px) {
  .paths__main { padding: 16px 14px 32px; }
  /* 移动端页标题 22→20：390 下「继续你的学习计划」占掉 270/362px 宽，
     比页内正文（13.5px）重得多。全站移动端页标题同步收一档（2026-09-24 反馈）。 */
  .paths__hero h1 { font-size: 18px; }
  /* 副标题单行省略（批9 首屏微调）：窄屏不给它第二行 */
  .paths__hero p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  /* 触诊下限（mobile:spec lt44 只紧不松）：搜索框/排序在 375 抬到 44px */
  .paths__search { min-height: 44px; }
  .paths__sort select { min-height: 44px; }
  .cards { grid-template-columns: 1fr; }
  /* ⋯ 触发器 36×36（mobile:spec lt36=0 预算），伪元素把热区再外扩到 50+：
     它贴在卡片右上角、周边没有别的手势目标，扩热区无副作用 */
  .pcard__more { position: relative; width: 36px; height: 36px; }
  .pcard__more::before { content: ''; position: absolute; inset: -8px -7px; }
}
</style>

<style scoped>
.pcard__badge--green { color: var(--green-ink); background: rgba(49, 177, 111, 0.12); }
.pcard__more-wrap { position: relative; }
/* 菜单开着时钉住卡片：hover 抬升的 transform 会把 fixed 遮罩的包含块改成卡片，
   遮罩就只剩卡片那么大；钉住后遮罩真正铺满视口 */
.pcard.pcard--menu-open,
.pcard.pcard--menu-open:hover { transform: none; }
.pcard__menu-scrim {
  position: fixed; inset: 0; z-index: 9;
  background: transparent;
  cursor: default;
}
.pcard__menu {
  /* 与触发器隔开 6px 空隙：指尖停在 ⋯ 上时不在任何菜单项里；
     原来贴着（top 40 = 触发器下沿）是误触的另一来源 */
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 10;
  background: var(--surface, #fff); border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl); padding: 6px;
  box-shadow: 0 12px 30px rgba(23, 32, 51, 0.14);
  display: grid; min-width: 152px;
}
.pcard__menu-item {
  /* 2026-09-27 防误触重设计：两个操作原来是贴着的 33px 文本行，「重新生成」
     一下没点中就落到「删除路径」。加高到 40（移动 44）、拉开间距、加分隔线、
     配 lucide 图标，让两个操作在触觉上就不是一个量级的操作。 */
  min-height: 40px; padding: 0 11px; border-radius: var(--mk-radius-md);
  font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; white-space: nowrap;
  text-align: left;
  display: flex; align-items: center; gap: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}
.pcard__menu-sep { height: 1px; background: var(--line, #e3e9f4); margin: 5px 4px; }
.pcard__menu-item:hover { background: color-mix(in srgb, var(--surface) 96%, var(--ink)); color: var(--ink); }
.pcard__menu-item--danger { color: var(--red, #c0454a); }
.pcard__menu-item--danger:hover { background: rgba(239, 117, 120, 0.08); color: var(--red, #c0454a); }
.pcard__confirm {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--muted);
  background: var(--canvas, #fafcff); border: 1px dashed var(--line);
  border-radius: var(--mk-radius-lg); padding: 9px 11px;
}
.pcard__confirm > span:first-child { flex: 1; min-width: 0; }
/* 防误触重设计（2026-09-27）：原来「删除/取消」是两粒挨着的小字，一记快 tap 就能
   确认销毁。改成实体按钮——「删除」实底红、「取消」描边 ghost，中间留 8px 间隔，
   高度 36 进触控带；文案补一句后果说明（不可自行恢复），给用户一次真正的阅读机会。 */
.pcard__confirm-yes {
  min-height: 36px; padding: 0 14px;
  border: 0; border-radius: var(--mk-radius-pill);
  background: var(--red, #c0454a); color: #fff;
  font-size: 12.5px; font-weight: 800; cursor: pointer;
  transition: filter 0.15s ease;
}
.pcard__confirm-yes:hover { filter: brightness(1.06); }
.pcard__confirm-no {
  min-height: 36px; padding: 0 12px;
  border: 1px solid var(--line, #e3e9f4); border-radius: var(--mk-radius-pill);
  background: var(--surface, #fff); color: var(--muted, #5b6577);
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.pcard__confirm-no:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.paths__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.goal-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 15px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--blue) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 25%, transparent);
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

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据：卡片内边距 12–16px、空态/加载留白 ≤32px。
   实测 390 下 .pcard 18×20、.empty 56px + min-height 52vh、加载态 64px。
   放在文件末尾：同权重下后出现者胜。 */
@media (max-width: 1100px) {
  /* 筛选药丸：390 下 5 个占两行 83px（13px 字 + 8×15 内边距 + 38px 高），
     收到 6×12（34px，仍在 34–38 的控件档）＋ 间距 8→6；页内节奏 18→14。 */
  .filters { gap: 6px; }
  .filter { padding: 6px 12px; }
  .paths__main { gap: 14px; }
  /* 卡标题 15.5 → 14：用户指着 15.5px 的路径卡标题说「这些就是大了」 */
  .pcard__title { font-size: 14px; }
  /* 筛选药丸 13 → 12.5（同一条反馈里的元素） */
  .filter { font-size: 12.5px; padding: 6px 11px; }
  .pcard { padding: 14px 16px; gap: 10px; }
  .empty { min-height: 40vh; padding: 32px 0; }
  .paths__loading { padding: 32px 0; }
}

/* ---------- 移动端筛选弹层（批13）：≤1100 芯片行收进按钮 + 底部弹层 ---------- */
.paths__filter-btn { display: none; }
@media (max-width: 1100px) {
  .filters { display: none; }
  .paths__filter-btn {
    display: inline-flex; align-items: center; gap: 6px;
    min-height: 44px; padding: 0 14px;
    align-self: flex-start;
    border: 1px solid var(--line); border-radius: var(--mk-radius-xl, 12px);
    background: var(--surface); color: var(--muted, #5b6577);
    font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer;
  }
  .paths__filter-btn:hover { color: var(--blue-deep, #1f57cc); border-color: color-mix(in srgb, var(--blue) 40%, transparent); }
  /* 菜单项进 44 触控带：弹出层是悬浮的，点偏了没有 hover 兜底 */
  .pcard__menu { min-width: 168px; }
  .pcard__menu-item { min-height: 44px; }
  .pcard__confirm-yes,
  .pcard__confirm-no { min-height: 40px; }
}
.paths__filter-mask {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(15, 22, 32, 0.45);
  display: flex; align-items: flex-end;
}
.paths__filter-sheet {
  width: 100%;
  background: var(--surface);
  border-radius: 18px 18px 0 0;
  padding: 14px 14px calc(14px + env(safe-area-inset-bottom, 0px));
  display: grid; gap: 8px;
  box-shadow: 0 -14px 40px rgba(15, 22, 32, 0.25);
}
.paths__filter-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 2px 2px 6px;
}
.paths__filter-head strong { font-size: 15px; }
.paths__filter-close {
  width: 44px; height: 44px;
  display: grid; place-items: center;
  border: 0; background: none;
  color: var(--muted, #5b6577); font-size: 22px;
  cursor: pointer; border-radius: var(--mk-radius-md, 10px); font-family: inherit;
}
.paths__filter-opt {
  min-height: 44px;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-lg, 12px);
  background: transparent;
  font-size: 13.5px; font-weight: 600; font-family: inherit;
  color: var(--ink, #172033);
  cursor: pointer; text-align: left;
}
.paths__filter-opt b { margin-left: auto; color: var(--faint, #8492ab); font-size: 12px; }
.paths__filter-opt.is-active {
  border-color: var(--blue, #3478f6);
  background: color-mix(in srgb, var(--blue, #3478f6) 8%, transparent);
  color: var(--blue-deep, #1f57cc);
}
.paths__filter-tick { margin-left: auto; font-style: normal; color: var(--blue, #3478f6); font-weight: 800; }
.paths__filter-opt.is-active b { margin-left: 0; }
</style>

