<template>
  <div class="paths v2-page">
    <V2Nav />

    <main class="paths__main">
      <!-- 从目标页过来：生成提示 -->
      <transition name="toast">
        <div v-if="goalBanner && hasGenerating" class="goal-banner">
          <span class="goal-banner__dot"></span>
          这版路径正在生成，一般 1-3 分钟。页面会自动刷新状态。
          <button type="button" class="goal-banner__close" @click="goalBanner = false">×</button>
        </div>
      </transition>

      <!-- 页头按原型 wf-paths__head（index.html 1786-1792）：左 16px 标题 + 右 ghost「新目标」，
           无 hero 大标题与说明文字；失败态仍隐藏（与失败原因同屏会互相矛盾）。
           P3-44（设计评审）：同一「新建目标」动作两入口主名词统一为「新目标」——
           页头短钮「新目标」（Plus 为 aria-hidden 图标非文字）+ 页尾长文案「用 2 分钟规划一个新目标」
           可并存，改文案时两处主名词须同步 -->
      <div v-if="!loadError" class="paths__head">
        <h2>我的学习路径</h2>
        <button type="button" class="paths__new-goal" @click="router.push('/goal-conversation')">
          <Plus :size="15" :stroke-width="2" aria-hidden="true" />
          新目标
        </button>
      </div>

      <!-- 加载 -->
      <div v-if="loading" class="paths__loading">
        <SkeletonLoader variant="list" :count="4" />
      </div>

      <!-- 失败：整页终态走统一结果组件（newui/home wf-error 形态：图标盘 + 标题 + 重试） -->
      <V2ResultState
        v-else-if="loadError"
        tone="error"
        title="路径加载失败"
        description="网络或服务暂时不可用，你的学习进度不受影响。稍后重试即可继续。"
        action-text="重试"
        @action="load"
      />

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
            :class="`pcard--${card.kind}`"
            @click="openPath(card)"
          >
            <div class="pcard__head">
              <div class="pcard__head-main">
                <h3 class="pcard__title">
                  <!-- 标题是真链接：键盘 Tab/读屏由此进入详情（整卡点击只是鼠标便利，批18） -->
                  <router-link :to="'/learning-path/' + card.id" @click.stop>{{ card.title }}</router-link>
                </h3>
                <!-- 副行按原型 wf-pathitem__sub（12px faint）：课时 · 时长；后端没有目标日期字段，不编造 -->
                <p v-if="card.sub" class="pcard__sub">{{ card.sub }}</p>
              </div>
              <div class="pcard__head-right">
                <!-- 状态徽章常驻（原型每张卡都有，1797/1808/1817）：进行中/已完成同样渲染 -->
                <span class="pcard__badge" :class="badgeCls(card)">{{ statusLabel(card) }}</span>
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
                       不让它落到「删除路径」或卡片导航上（卡片已无 hover transform，fixed 遮罩直接铺满视口） -->
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

            <!-- ready/completed：原型 wf-pathcard__foot 两段式——分隔线 + 8px 进度条 + 两端数字 -->
            <template v-if="card.kind === 'ready' || card.kind === 'completed'">
              <div class="pcard__foot">
                <div class="pcard__bar"><i :style="{ width: card.percent + '%' }"></i></div>
                <div class="pcard__nums">
                  <span>整体 {{ card.percent }}%</span>
                  <!-- stages=0（后端未给阶段数）时不渲染「第 1 / 0」这种破数 -->
                  <span v-if="card.stages">第 {{ Math.max(1, Math.min(card.stageDone + 1, card.stages)) }} / {{ card.stages }} 阶段</span>
                </div>
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

          <!-- 原型 wf-newpath（1823-1826 / 725-731）：列表末尾的虚线蓝底新目标入口 -->
          <button type="button" class="cards__newpath" @click="router.push('/goal-conversation')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            用 2 分钟规划一个新目标
          </button>
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
import { MoreHorizontal, Plus, RotateCcw, Search, Trash2 } from 'lucide-vue-next';
import request, { AI_REQUEST_TIMEOUT } from '@/utils/api';
import { toast } from '@/utils/toast';
import { learningAPI } from '@/api/learning';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import V2Footer from './V2Footer.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
import V2ResultState from '@/components/ui/V2ResultState.vue';

type CardKind = 'ready' | 'generating' | 'failed' | 'completed';
interface PathCard {
  id: string;
  title: string;
  desc: string;
  /** 副行（原型 wf-pathitem__sub）：课时 · 时长；只存展示文案，desc 仍供搜索 */
  sub: string;
  kind: CardKind;
  stages: number;
  stageDone: number;
  percent: number;
  hours?: number;
  /** 已组好的课数（2026-09-29 口径修正：呈现「已备好什么」，不呈现「预计你要投入多少」） */
  lessons?: number;
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
/** 存在生成中卡才显示「正在生成」横幅：生成早已完成/列表为空时这条提示是误导 */
const hasGenerating = computed(() => cards.value.some((c) => c.kind === 'generating'));
/** 生成状态轮询连续失败计数（超过阈值停止空转） */
const pollFailCount = ref(0);

const deleteBusy = ref(false);

/** 原型副行（wf-pathitem__sub）：「已备好 24 节课 · 约 24 小时」；
    数据不全回退「共 N 阶段」，一个字段都没有就留空（不编造「目标日期」——后端无此字段） */
function buildSub(stages: number, lessons?: number, hours?: number) {
  const parts: string[] = [];
  if (lessons) parts.push(`已备好 ${lessons} 节课`);
  if (hours) parts.push(`约 ${hours} 小时`);
  if (!parts.length && stages) parts.push(`共 ${stages} 阶段`);
  return parts.join(' · ');
}

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
        id: p.id, title, desc, sub: buildSub(stages), kind: 'failed', stages, stageDone: lc.completedStages ?? 0,
        percent: 0, hours, retryType: lc.retryType,
        retryLabel: lc.retryType === 'stage_design' ? '重新准备阶段任务' : '重新生成主结构',
        phaseText: '', errorText: lc.errorMessage || ''
      };
    }
    const phaseText = lc.phase === 'core'
      ? '主结构生成中，一般 1-2 分钟内完成…'
      : `阶段任务准备中（${lc.completedStages ?? 0}/${lc.totalStages ?? '?'}）…`;
    return {
      id: p.id, title, desc, sub: buildSub(stages), kind: 'generating', stages, stageDone: lc.completedStages ?? 0,
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
  const totalStages = stages || weeks.length;
  return {
    id: p.id, title, desc, sub: buildSub(totalStages, totalTasks, hours), kind, stages: totalStages, stageDone,
    percent, hours, lessons: totalTasks, retryType: null, retryLabel: '', phaseText: '', errorText: '', status: p.status
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

/** 整卡可点击：进入路径详情页 */
function openPath(card: PathCard) {
  router.push(`/learning-path/${card.id}`);
}

const filterList = computed(() => [
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
/* 页头按原型 wf-paths__head（718-719）：左标题、右 ghost 按钮 */
.paths__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.paths__head h2 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
/* ghost「新目标」＝原型 wf-btn--ghost（surface 底 + line 描边 + muted 字） */
.paths__new-goal {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 38px; padding: 0 14px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-xl);
  background: var(--surface); color: var(--muted);
  font-family: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.paths__new-goal:hover {
  border-color: color-mix(in srgb, var(--blue) 35%, transparent);
  color: var(--blue-deep);
}
/* 搜索+排序工具行（批18）：全尺寸常显（移动端芯片行收弹层后，这里是唯一检索入口），
   视觉压到原型 chip 语言（1px line / surface 底 / muted 字 / 胶囊） */
.paths__tools { display: flex; align-items: center; gap: 10px; margin: 14px 0 2px; flex-wrap: wrap; }
.paths__search {
  flex: 1 1 220px; max-width: 420px;
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px; min-height: 36px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  color: var(--faint);
  transition: border-color var(--mk-dur-fast, 120ms) ease, box-shadow var(--mk-dur-fast, 120ms) ease;
}
.paths__search:focus-within {
  border-color: var(--blue);
  box-shadow: var(--mk-focus-ring); /* 全站唯一一圈 */
}
.paths__search input {
  flex: 1; min-width: 0; min-height: 36px; border: 0; background: none; font: inherit; font-size: 13px;
  color: var(--ink); outline: none;
}
.paths__search input::placeholder { color: var(--faint); }
.paths__search-clear { border: 0; background: none; padding: 4px; font-size: 15px; color: var(--faint); cursor: pointer; line-height: 1; }
.paths__search-clear:hover { color: var(--ink); }
.paths__sort { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.paths__sort select {
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  min-height: 36px; padding: 7px 14px; border-radius: var(--mk-radius-pill);
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

.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: var(--mk-radius-xl);
  /* 实色主按钮：蓝渐变 + 30% 蓝色发光投影一并退役 */
  background: var(--blue);
  color: var(--text-on-primary); font-size: 14px; font-weight: 700;
  cursor: pointer; text-decoration: none;
  transition: transform 0.18s ease, background 0.18s ease;
}
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-ghost {
  padding: 10px 18px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

/* 状态筛选 chip 行（Vue 侧新增功能）：视觉压到原型 chip 语言——
   1px line 描边 + surface 底 + muted 字；选中态 border 透明 + blue 12% 底 + blue-deep 字 */
.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filter {
  min-height: 36px; padding: 7px 14px;
  border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--mk-radius-pill);
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}
.filter b { margin-left: 4px; color: var(--faint); }
.filter:hover { background: color-mix(in srgb, var(--blue) 6%, transparent); color: var(--blue-deep); }
.filter--active {
  border-color: transparent;
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep);
}
.filter--active b { color: var(--blue-deep); }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
/* 卡片＝原型两段式窄列表卡（wf-pathcard / wf-pathitem）：16px 内边距、16 圆角、无缩略图方块、
   无描述段落、无 hover 抬升（原型 wf-card 只靠光标示意可点，状态由常驻徽章承担） */
.pcard {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}
/* 生成中/失败是原型没有的两种状态：只留极淡底色与描边提示，颜色全部走 token */
.pcard--generating { background: linear-gradient(180deg, color-mix(in srgb, var(--cyan) 4%, transparent), var(--surface) 55%); }
.pcard--failed { border-color: color-mix(in srgb, var(--red) 30%, transparent); }
/* head 顶对齐：标题+副行在左，状态徽章与「⋯」在右（原型 wf-pathcard__head / wf-pathitem__row） */
.pcard__head { display: flex; align-items: flex-start; gap: 12px; }
.pcard__head-main { flex: 1; min-width: 0; }
.pcard__head-right { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
/* 状态徽章＝原型 wf-badge（216-238 / 301-304）：4×10 内边距、999 圆角、12px/800 */
.pcard__badge { padding: 4px 10px; border-radius: var(--mk-radius-pill); font-size: 12px; font-weight: 800; flex: 0 0 auto; }
.pcard__badge--green { color: var(--green-ink); background: color-mix(in srgb, var(--green) 12%, transparent); }
.pcard__badge--blue { color: var(--blue-deep); background: color-mix(in srgb, var(--blue) 11%, transparent); }
.pcard__badge--cyan { color: var(--cyan-ink); background: color-mix(in srgb, var(--cyan) 14%, transparent); }
.pcard__badge--red { color: var(--red-ink); background: color-mix(in srgb, var(--red) 12%, transparent); }
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
  margin: 0; font-size: 15px; font-weight: 700; line-height: 1.4;
  min-width: 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pcard__title a {
  color: inherit; text-decoration: none;
  /* 负边距外扩触诊区（视觉不变、不占布局）；不能用 min-height 撑 44——
     单行标题会被撑出一行空白，就是卡头中间那道「鸿沟」 */
  display: block; padding: 8px 10px; margin: -8px -10px;
}
.pcard__title a:hover { color: var(--blue-deep); }
/* 副行＝原型 wf-pathitem__sub（12px faint）：单行省略，窄卡不换行 */
.pcard__sub {
  margin: 3px 0 0; font-size: 12px; line-height: 1.5; color: var(--faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* foot＝原型 wf-pathcard__foot（359-360）：分隔线 + 7px 间隔 + 进度条 + 两端数字；
   进度条按 wf-bar--lg（267-269）：8px 高、99px 胶囊、轨道 color-mix(line 60%)、填充 blue→cyan */
.pcard__foot {
  margin-top: auto;
  border-top: 1px solid var(--line);
  padding-top: 11px;
  display: grid; gap: 7px;
}
.pcard__bar { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--line) 60%, transparent); overflow: hidden; }
.pcard__bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
.pcard__nums {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 12px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.pcard__actions { display: flex; justify-content: flex-end; margin-top: auto; }

/* 原型 wf-newpath（725-731）：82px 高虚线蓝底块，列表末尾的「规划新目标」入口 */
.cards__newpath {
  grid-column: 1 / -1;
  min-height: 82px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  border: 1.5px dashed color-mix(in srgb, var(--blue) 40%, transparent);
  border-radius: var(--mk-radius-modal);
  background: color-mix(in srgb, var(--blue) 4%, transparent);
  color: var(--blue-deep);
  font-family: inherit; font-size: 14px; font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.cards__newpath:hover {
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  border-color: color-mix(in srgb, var(--blue) 60%, transparent);
}
.cards__newpath svg { width: 17px; height: 17px; }

.pcard__generating {
  display: flex; align-items: center; gap: 9px;
  font-size: 13px; color: var(--blue-deep); font-weight: 600;
}
/* 生成中不再用假骨架填高（批18）：真实信息只有 phaseText 与刷新动作 */

.pcard__fail-reason {
  font-size: 12.5px; line-height: 1.6; color: var(--red);
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
.empty__illus span { width: 26px; height: 8px; border-radius: 999px; background: var(--line); }
.empty__illus span:nth-child(2) { background: color-mix(in srgb, var(--blue) 30%, transparent); }

/* .toast/.toast__icon 本体是死 CSS 已删：全局 toast 由 utils/toast 独立渲染，不落在本组件；
   下面的 toast-enter/leave 是上方 goal-banner <transition name="toast"> 的过渡类，保留 */
.toast-enter-active, .toast-leave-active { transition: .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }

@media (max-width: 1100px) {
  .paths__main { padding: 16px 14px 32px; }
  /* 页头按原型常驻 16px：窄屏给按钮留行，整行可换行不挤压 */
  .paths__head { flex-wrap: wrap; }
  /* 触诊下限（mobile:spec lt44 只紧不松）：搜索框/排序在 375 抬到 44px */
  .paths__search { min-height: 44px; }
  .paths__search input { min-height: 44px; }
  .paths__sort select { min-height: 44px; }
  .cards { grid-template-columns: 1fr; }
  /* ⋯ 触发器 36×36（mobile:spec lt36=0 预算），伪元素把热区再外扩到 50+：
     它贴在卡片右上角、周边没有别的手势目标，扩热区无副作用 */
  .pcard__more { position: relative; width: 36px; height: 36px; }
  .pcard__more::before { content: ''; position: absolute; inset: -8px -7px; }
}
</style>

<style scoped>
.pcard__more-wrap { position: relative; }
.pcard__menu-scrim {
  position: fixed; inset: 0; z-index: 9;
  background: transparent;
  cursor: default;
}
.pcard__menu {
  /* 与触发器隔开 6px 空隙：指尖停在 ⋯ 上时不在任何菜单项里；
     原来贴着（top 40 = 触发器下沿）是误触的另一来源 */
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 10;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl); padding: 6px;
  box-shadow: var(--shadow-md);
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
.pcard__menu-sep { height: 1px; background: var(--line); margin: 5px 4px; }
.pcard__menu-item:hover { background: color-mix(in srgb, var(--surface) 96%, var(--ink)); color: var(--ink); }
.pcard__menu-item--danger { color: var(--red); }
.pcard__menu-item--danger:hover { background: color-mix(in srgb, var(--red) 8%, transparent); color: var(--red); }
.pcard__confirm {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--muted);
  background: var(--canvas); border: 1px dashed var(--line);
  border-radius: var(--mk-radius-lg); padding: 9px 11px;
}
.pcard__confirm > span:first-child { flex: 1; min-width: 0; }
/* 防误触重设计（2026-09-27）：原来「删除/取消」是两粒挨着的小字，一记快 tap 就能
   确认销毁。改成实体按钮——「删除」实底红、「取消」描边 ghost，中间留 8px 间隔，
   高度 36 进触控带；文案补一句后果说明（不可自行恢复），给用户一次真正的阅读机会。 */
.pcard__confirm-yes {
  min-height: 36px; padding: 0 14px;
  border: 0; border-radius: var(--mk-radius-pill);
  background: var(--red); color: var(--text-on-primary);
  font-size: 12.5px; font-weight: 800; cursor: pointer;
  transition: filter 0.15s ease;
}
.pcard__confirm-yes:hover { filter: brightness(1.06); }
.pcard__confirm-no {
  min-height: 36px; padding: 0 12px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  background: var(--surface); color: var(--muted);
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.pcard__confirm-no:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.paths__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.goal-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 15px;
  border-radius: var(--mk-radius-xl);
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
   实测 390 下 .pcard 16px（原型 wf-card 同档）、.empty 56px + min-height 52vh、加载态 64px。
   放在文件末尾：同权重下后出现者胜。 */
@media (max-width: 1100px) {
  /* 筛选 chip：390 下 5 个收进两行——字 12.5 + 内边距 6×12，
     高度由基座 min-height:36px 兜底（chip 语言下沿）＋ 间距 8→6；页内节奏 18→14。 */
  .filters { gap: 6px; }
  .filter { font-size: 12.5px; padding: 6px 12px; }
  .paths__main { gap: 14px; }
  /* 卡标题 15 → 14：用户指着 15.5px 的路径卡标题说「这些就是大了」 */
  .pcard__title { font-size: 14px; }
  .pcard { padding: 14px 16px; gap: 10px; }
  .empty { min-height: 40vh; padding: 32px 0; }
  .paths__loading { padding: 32px 0; }
}

/* ---------- 移动端筛选弹层（批13）：≤1100 芯片行收进按钮 + 底部弹层 ----------
   视觉统一压到原型 chip 语言：1px line 描边 + surface 底 + muted 字 + 胶囊圆角；
   选中态 border 透明 + blue 12% 底 + blue-deep 字（与桌面 .filter--active 同一口径） */
.paths__filter-btn {
  display: none;
  align-items: center; gap: 6px;
  min-height: 36px; padding: 7px 14px;
  align-self: flex-start;
  border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  background: var(--surface); color: var(--muted);
  font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.paths__filter-btn:hover {
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  border-color: color-mix(in srgb, var(--blue) 35%, transparent);
  color: var(--blue-deep);
}
@media (max-width: 1100px) {
  .filters { display: none; }
  /* 移动端触诊下限 44（mobile:spec 只紧不松）：外观仍是 chip，只高一档 */
  .paths__filter-btn { display: inline-flex; min-height: 44px; }
  /* 菜单项进 44 触控带：弹出层是悬浮的，点偏了没有 hover 兜底 */
  .pcard__menu { min-width: 168px; }
  .pcard__menu-item { min-height: 44px; }
  .pcard__confirm-yes,
  .pcard__confirm-no { min-height: 40px; }
}
.paths__filter-mask {
  position: fixed; inset: 0; z-index: 60;
  background: color-mix(in srgb, var(--ink) 45%, transparent);
  display: flex; align-items: flex-end;
}
.paths__filter-sheet {
  width: 100%;
  background: var(--surface);
  border-radius: var(--mk-radius-modal) var(--mk-radius-modal) 0 0;
  padding: 14px 14px calc(14px + env(safe-area-inset-bottom, 0px));
  display: grid; gap: 8px;
  box-shadow: var(--mk-shadow-pop); /* 弹层档（上抛第四档已并入 pop，规范 §0.5） */
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
  color: var(--muted); font-size: 22px;
  cursor: pointer; border-radius: var(--mk-radius-md); font-family: inherit;
}
.paths__filter-opt {
  min-height: 44px;
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  background: var(--surface);
  font-size: 13.5px; font-weight: 600; font-family: inherit;
  color: var(--muted);
  cursor: pointer; text-align: left;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.paths__filter-opt b { margin-left: auto; color: var(--faint); font-size: 12px; }
.paths__filter-opt.is-active {
  border-color: transparent;
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep);
}
.paths__filter-tick { margin-left: auto; font-style: normal; color: var(--blue); font-weight: 800; }
.paths__filter-opt.is-active b { margin-left: 0; color: var(--blue-deep); }
</style>

