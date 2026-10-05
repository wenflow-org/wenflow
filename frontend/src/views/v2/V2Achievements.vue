<template>
  <CapabilityShell title="成就" description="查看你的学习里程碑，每一次小进步都算数。">
    <!-- 页头由 CapabilityShell 提供（个人中心 kicker + 标题 + 说明） -->
    <div class="ach__body">
      <!-- 加载中 -->
      <div v-if="loading" class="ach__loading">
        <SkeletonLoader variant="cards" :count="6" />
      </div>

      <!-- 失败 -->
      <div v-else-if="loadError" class="errorbar">
        成就加载失败。<button type="button" class="errorbar__retry" @click="load">重试</button>
      </div>

      <template v-else>
        <!-- 概览（原型 wf-ovline 835-839 / 2072-2076）：三行——大数字 → 进度条 → 蓝色 XP 行 -->
        <section class="card ov-line" aria-label="成就概览">
          <div class="ov-line__top">
            <strong>{{ unlockedCount }} / {{ items.length }}</strong>
            <!-- P3-46（设计评审）：「4 / 14 个成就已解锁，还剩 10 个」同句复读——删「还剩 N 个」，
                 剩余量由左式 4 / 14 与进度条表达 -->
            <span>个成就已解锁</span>
          </div>
          <div class="ov-line__bar" role="img" :aria-label="`解锁进度 ${unlockPct}%`">
            <i :style="{ width: unlockPct + '%' }"></i>
          </div>
          <!-- P3-46：「1360 XP · 其中成就 260」归属含糊——改「成就贡献 260 XP · 总计 1360 XP」
               （两值相等时无需区分归属，回到单一 XP 数） -->
          <div class="ov-line__xp">
            <template v-if="totalXpAll !== totalXp">成就贡献 {{ totalXp }} XP · 总计 {{ totalXpAll }} XP</template>
            <template v-else>{{ totalXpAll }} XP</template>
          </div>
        </section>

        <!-- 筛选（原型 wf-filters 2078-2082）：全部/已解锁/未解锁 三枚状态 chip 与
             类型 chip 同走 .wf-filter 胶囊语言，行内不再放竖分隔线（类型筛选降级保留） -->
        <div class="filters">
          <button
            v-for="f in statusFilters"
            :key="f.key"
            type="button"
            class="filter"
            :class="{ 'filter--active': statusFilter === f.key }"
            @click="statusFilter = f.key"
          >{{ f.label }}</button>
          <button
            v-for="t in typeFilters"
            :key="t.key"
            type="button"
            class="filter"
            :class="{ 'filter--active': typeFilter === t.key }"
            @click="typeFilter = typeFilter === t.key ? '' : t.key"
          >{{ t.label }}</button>
        </div>

        <!-- 成就网格（原型 wf-ach 2085-2129）：icon → 标题 → 描述 → 一行状态，四行无分隔线 -->
        <div v-if="visible.length" class="grid">
          <article
            v-for="a in visible"
            :key="a.id"
            class="card ach-card"
            :class="{ 'ach-card--locked': !a.unlocked, 'ach-card--unlocked': a.unlocked }"
          >
            <!-- 分享（原型无此入口，功能保留但降为卡角轻量图标钮，不占行也不抢状态行） -->
            <button
              v-if="a.unlocked"
              type="button"
              class="ach-share"
              title="分享成就"
              aria-label="分享成就"
              @click.stop="shareAchievement(a)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
            </button>

            <span class="ach-card__icon" :class="iconCls(a)" aria-hidden="true">{{ achMark(a) }}</span>
            <strong class="ach-card__name">{{ a.name }}</strong>
            <p class="ach-card__desc">{{ descText(a) }}</p>
            <span class="ach-card__state" :class="{ 'ach-card__state--on': a.unlocked }">
              {{ stateText(a) }}<span v-if="a.unlocked && formatDate(a.earnedAt)" class="ach-card__date"> · {{ formatDate(a.earnedAt) }}</span>
            </span>
          </article>
        </div>
        <div v-else class="empty">
          <p>这个分类下还没有成就</p>
          <button type="button" class="btn-ghost" @click="statusFilter = 'all'; typeFilter = ''">查看全部</button>
        </div>
      </template>
    </div>

    <!-- AI 生成提示（页脚由 CapabilityShell 提供） -->
    <div class="ach__ai-note">
      <AiContentNote />
      <!-- Toast：必须留在 CapabilityShell 内——模板多根会变成 Fragment 根节点，
           外层 <Transition mode="out-in"> 的 leave 收尾后 enter 永不挂载，
           离开本页后整个路由视图永久空白（用户实测：成就→账户 黑屏）。 -->
      <Transition name="toast">
        <div v-if="toastMsg" class="ach-toast">{{ toastMsg }}</div>
      </Transition>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import request from '@/utils/api';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
import { unwrapArray } from './unwrap';
import { useUserStore } from '@/stores/user';

interface Achievement {
  id: string;
  name: string;
  description: string;
  /** 后端历史字段（曾放 emoji）。**界面不再渲染它**——emoji 各系统渲染不一致，
      改按 type 给「色块 + 字标」，与管理端 AchIcon.vue 同一套做法。 */
  icon?: string;
  xpReward: number;
  type: string;
  unlocked: boolean;
  progress?: { current: number; total: number; percentage: number };
  earnedAt?: string | Date;
}

const items = ref<Achievement[]>([]);
const loading = ref(true);
const loadError = ref(false);

/** 成就图标：按类型给「色块 + 字标」，与管理端 AchIcon.vue 同一类型域。
    P3-48（设计评审）：单字「里」单独无法解码、读作占位噪音——用户侧改可解码双字
    （里→里程 / 连→连续 / 完→完成 / 掌→掌握，社→社交 同步对齐；管理端 AchIcon 保持单字紧凑档）。
    色块由 .ach-card__icon--* 系列 token 色给底（未解锁一律中性灰）。
    替代原来的 emoji——各系统渲染不一致，且与全站的线性图标 + 色块徽标语言不搭。 */
const ACH_TYPE_MARK: Record<string, string> = {
  milestone: '里程',
  streak: '连续',
  completion: '完成',
  mastery: '掌握',
  social: '社交',
};
function achMark(a: Achievement): string {
  return ACH_TYPE_MARK[a.type] || '成';
}

/** 图标 42×42 的类型色块（原型 wf-ach__icon--streak/complete/mastery/milestone/social 858-862）；
    未解锁一律落到中性灰块（原型锁定卡只给 wf-ach__icon 本体），并由卡整体 opacity 表态。 */
const ACH_TYPE_TONE: Record<string, string> = {
  milestone: 'milestone',
  streak: 'streak',
  completion: 'complete',
  mastery: 'mastery',
  social: 'social',
};
function iconCls(a: Achievement): string {
  return a.unlocked ? `ach-card__icon--${ACH_TYPE_TONE[a.type] || 'neutral'}` : 'ach-card__icon--neutral';
}
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
  mastery: '知识掌握',
  social: '社交互动'
};

/** 类型标签：已知映射 → 未知类型兜底「其他」（不直出英文 key） */
function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? '其他';
}

const typeFilters = computed(() => {
  const types = [...new Set(items.value.map((a) => a.type))];
  return types.map((t) => ({ key: t, label: typeLabel(t) }));
});

const unlockedCount = computed(() => items.value.filter((a) => a.unlocked).length);
const totalXp = computed(() => items.value.filter((a) => a.unlocked).reduce((s, a) => s + (a.xpReward ?? 0), 0));

/* XP 口径：user.xp 是账号权威经验值（成就奖励 + 任务完成奖励，addXp 唯一写入口），
   账号页与等级都用它。本页概览条与账号页同源显示总数，成就贡献作子注——
   此前本页只累加成就奖励（如 10），与账号页的 60 对不上，像两个体系。 */
const userStore = useUserStore();
const totalXpAll = computed(() => userStore.user?.xp || 0);

/* 解锁进度（原型 wf-bar--lg 的 i 宽度） */
const unlockPct = computed(() =>
  items.value.length ? Math.round((unlockedCount.value / items.value.length) * 100) : 0
);

/* 卡片第四行：已解锁 → 「已解锁 · +10 XP」绿字；未解锁 → 「未解锁 · 6 / 10」faint
   （原型 wf-ach__state 865-867；状态药丸与虚线 foot 随卡头徽章一起撤掉） */
function stateText(a: Achievement): string {
  if (a.unlocked) return `已解锁 · +${a.xpReward} XP`;
  const p = progressOf(a);
  return `未解锁 · ${fmtNum(p.current)} / ${fmtNum(p.total)}`;
}

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

/* XP 为账号权威值：SPA 内完成会话（+50）后 store 可能是登录时旧值，
   与账号页保持一致，挂载时刷新档案 */
onMounted(() => {
  load();
  userStore.fetchProfile().catch(() => {});
});
</script>

<style scoped>
/* AI 提示：页脚由 CapabilityShell 提供，这里只留一行居中说明 */
.ach__ai-note {
  display: flex; justify-content: center;
  padding: 4px 0 0;
}
.ach__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }

/* 内容容器：宽度/内边距交给 CapabilityShell 的 .uc__main，这里只管卡间距 */
.ach__body {
  display: grid; gap: 18px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--shadow-sm);
}

/* 概览条（原型 wf-ovline 835-839 / 2072-2076）：三行——大数字 → 进度条 → 蓝色 XP 行 */
.ov-line { padding: 14px 18px; display: grid; gap: 10px; }
.ov-line__top { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.ov-line__top strong { font-size: 20px; font-weight: 800; color: var(--ink); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.ov-line__xp { font-size: 12.5px; font-weight: 700; color: var(--blue-deep); }
.ov-line__xp span { font-weight: 500; color: var(--faint); }
.ov-line__bar { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--line, #eef0f4) 60%, transparent); overflow: hidden; }
/* 原为纯紫 --accent（旧强调色语言）→ 原型 wf-bar 填充：蓝→青 */
.ov-line__bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width 0.4s ease; }

/* 筛选（原型 wf-filters / wf-filter 840-846）：状态 chip 与类型 chip 同一套胶囊语言 */
.filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.filter {
  /* P3-47（设计评审）：筛选 chips 是本页唯一筛选交互，36px 低于 44px 移动触控地板——
     抬到 44px 扩热区，视觉字号不动 */
  min-height: 44px;
  padding: 7px 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: var(--mk-radius-pill);
  color: var(--muted);
  font: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}
.filter--active { border-color: transparent; background: color-mix(in srgb, var(--blue) 12%, transparent); color: var(--blue-deep); }

/* 网格（原型 wf-ach__grid 847 / 931）：2 列，≥1024 放 3 列。
   撤掉本页自造的 auto-fill minmax(230px,1fr)——1080 宽下会铺成 4 列。 */
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }

/* ── Achievement Card（原型 wf-ach 848-867）：icon → 标题 → 描述 → 一行状态，四行无分隔线 ── */
.ach-card {
  position: relative;
  padding: 14px;
  display: grid;
  gap: 4px;
  justify-items: start;
  align-content: start;
  transition: none;
}

/* ── 42×42 类型色块（原型 wf-ach__icon 853-862）──
    P3-48：字标升双字（19px 单字 → 14px 双字），42px 块内两字 + 字距放得下 */
.ach-card__icon {
  width: 42px; height: 42px;
  border-radius: 12px;
  margin-bottom: 4px;
  display: grid; place-items: center;
  font-size: 14px; font-weight: 800;
  letter-spacing: 0.02em;
}
.ach-card__icon--neutral { background: color-mix(in srgb, var(--line) 60%, transparent); color: var(--faint); }
.ach-card__icon--streak { background: color-mix(in srgb, var(--amber) 15%, transparent); color: var(--amber-ink); }
.ach-card__icon--complete { background: color-mix(in srgb, var(--green) 14%, transparent); color: var(--green-ink); }
.ach-card__icon--mastery { background: color-mix(in srgb, var(--blue) 13%, transparent); color: var(--blue-deep); }
.ach-card__icon--milestone { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.ach-card__icon--social { background: color-mix(in srgb, var(--cyan) 16%, transparent); color: var(--cyan-ink); }

.ach-card__name { font-size: 14px; font-weight: 700; color: var(--ink); }
.ach-card__desc { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.55; }
/* 第四行状态：原型 wf-ach__state 11.5px，本仓字号下限 12px（规则 16） */
.ach-card__state { margin-top: 4px; font-size: 12px; font-weight: 700; color: var(--faint); }
.ach-card__state--on { color: var(--green-ink); }
.ach-card__date { font-weight: 500; color: var(--faint); }
/* 锁定卡：只降透明度（原型 867 opacity .78）；撤掉原 grayscale(0.3) + hover 复原 */
.ach-card--locked { opacity: 0.78; }

/* ── Unlock stagger animation ── */
.ach-card--unlocked {
  animation: ach-unlock 0.4s cubic-bezier(0.4, 0, 0.2, 1) both;
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

/* ── Share button（原型无此入口，保留为卡角常显轻量图标钮） ── */
.ach-share {
  position: absolute; top: 8px; right: 8px;
  width: 28px; height: 28px;
  border-radius: var(--mk-radius-md); border: 0;
  /* 底色用 ink 派生：写死的 rgba(0,0,0,…) 在暗色下看不见 */
  background: color-mix(in srgb, var(--ink) 5%, transparent);
  color: var(--faint);
  display: grid; place-items: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ach-share:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); color: var(--ink); }

@media (max-width: 1100px) {
  /* 收进个人中心后的移动端压缩（2026-09-24 反馈「内容都偏大」）：
     390 下 2 列统计卡的 KPI 数字原为 28px（卡宽仅 ~165px）、成就卡内边距 16px、卡片高 176px——
     一张"我是谁"式的概览要吃掉整屏。按学习侧 KPI 刻度压到 21px/12px 边距。 */
  .grid { grid-template-columns: 1fr 1fr; }
  /* 28×28 → 34×34 → 36×36（mobile:spec 的 lt36 门禁）：分享是卡角唯一的手势目标 */
  .ach-share { width: 36px; height: 36px; top: 4px; right: 4px; }
  /* 总览条原来横向 18px，和下面一整列 .ach-card 的 14px 差 4px——
     同宽卡堆在一列里，内容左缘落在 33/29 两条线上（2026-09-26 对齐走查）。 */
  .ov-line { padding-left: 14px; padding-right: 14px; }
  .ach-card { padding: 12px 14px; }
  .filters { gap: 6px; }
  /* 筛选药丸 36 → 44（P3-47 触控地板；compact 档也须守住 44，内边距收窄补高度）：
     一行 7 颗在 390 下的总宽预算不变。 */
  .filter { padding: 6px 11px; min-height: 44px; font-size: 12.5px; }
}
@media (max-width: 640px) {
  .grid { grid-template-columns: 1fr; }
}
/* ≥1024 放 3 列（原型 wf-ach__grid 931）。放在 max-width:1100 之后：
   1024–1100 区间两组同时命中，同权重下后声明者胜 → 3 列。 */
@media (min-width: 1024px) {
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>

<style scoped>
.ach__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.errorbar {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-radius: var(--mk-radius-xl);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
  color: var(--red-ink);
  font-size: 13px; font-weight: 600;
}
.errorbar__retry { text-decoration: underline; cursor: pointer; font-weight: 800; }
.btn-ghost {
  padding: 9px 16px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface);
  font-size: 13px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.empty { display: grid; justify-items: center; gap: 12px; padding: 48px 0; color: var(--faint); font-size: 13px; }

/* ── Toast ── */
.ach-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: var(--ink); color: var(--surface);
  padding: 10px 20px; border-radius: var(--mk-radius-xl);
  font-size: 13px; font-weight: 600;
  box-shadow: var(--mk-shadow-modal); /* toast = 规范模态档 */
  z-index: 9999;
  pointer-events: none;
}
.toast-enter-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.toast-leave-active { transition: all 0.2s ease-in; }
.toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(12px) scale(0.95); }
.toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.97); }
</style>

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据：卡片内边距 12–16px、空态/加载留白 ≤32px。
   实测 390 下：成就卡图标块原为 48×48（卡片两列、每列仅 ~165px 宽）、
   加载态 64px、空态 48px。
   放在文件末尾：同权重下后出现者胜（中间那个移动块在 .ach__loading/.empty 之前）。
   状态行/日期微标签桌面就是 12px 下限，移动端不再单方面放大（与密度目标相反）。 */
@media (max-width: 1100px) {
  .ach-card__icon { width: 38px; height: 38px; font-size: 17px; }
  .ach__loading { padding: 32px 0; }
  .empty { padding: 32px 0; }
}
</style>
