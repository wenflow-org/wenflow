<template>
  <div v-if="data" class="mk-page">
    <!-- 页头（原型 pageTitle）：面包屑管「我在哪」，页头管「这页是什么 + 主操作」 -->
    <MkPageHead title="平台总览" :sub="headSub">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="liveRefreshing" @click="refreshNow">
          {{ liveRefreshing ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>

    <!-- 系统状态（原型 .statusbar）：点色=结论、粗体=标题、meta=子项、右端=动作。
          排查/健康/仿真各是一个可点 meta（悬停有完整口径）。 -->
    <div class="mk-status" :class="`mk-status--${data.tone}`">
      <span class="mk-status__dot"></span>
      <span class="mk-status__title">{{ health.headline }}</span>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ health.subline }}</span>
      <template v-if="effectiveActions.length">
        <button
          v-for="(a, i) in effectiveActions"
          :key="'agent-' + i"
          type="button"
          class="mk-status__meta-link"
          :class="a.tone === 'bad' ? 'mk-status__meta--bad' : 'mk-status__meta--warn'"
          title="去执行日志排查该 Skill 的失败"
          @click="investigateAgent(a.agentId)"
        >{{ a.text }}</button>
      </template>
      <span v-else class="mk-status__meta">没有需要立即处理的事项</span>
      <button
        type="button"
        class="mk-status__meta-link"
        :class="healthTone === 'bad' ? 'mk-status__meta--bad' : healthTone === 'warn' ? 'mk-status__meta--warn' : ''"
        title="查看健康中心完整检查清单"
        @click="jump('health-center')"
      >健康 · {{ healthText }}</button>
      <button
        type="button"
        class="mk-status__meta-link"
        :class="simTone === 'bad' ? 'mk-status__meta--bad' : simTone === 'warn' ? 'mk-status__meta--warn' : ''"
        :title="simTitle"
        @click="jump('virtual-learners')"
      >仿真 · {{ simHeadline }}</button>
      <button
        v-if="wrapupIssue"
        type="button"
        class="mk-status__meta-link"
        :class="wrapupIssue.tone === 'bad' ? 'mk-status__meta--bad' : 'mk-status__meta--warn'"
        :title="wrapupIssue.text"
        @click="jump('teaching-sessions')"
      >{{ wrapupIssue.text }}</button>
      <div class="mk-status__actions">
        <button type="button" class="mk-status__action" @click="jump('health-center')">查看健康中心</button>
      </div>
    </div>

    <!-- KPI（原型 .grid auto-fit 210 + .card.kpi）：label 12 / 数值 28 / ▲▼趋势 foot。
         趋势真实来源：今日调用 vs 昨日（trend7d）、今日活跃 vs 昨日（growth7d）。 -->
    <div class="kpigrid">
      <div
        v-for="(k, i) in kpiCards"
        :key="k.label"
        class="card card--kpi"
        role="button"
        tabindex="0"
        :title="kpiTitle(i)"
        @click="jump(kpiTargets[i].scene, kpiTargets[i].tab)"
        @keydown.enter.prevent="jump(kpiTargets[i].scene, kpiTargets[i].tab)"
      >
        <div class="kpi">
          <span class="kpi__label">{{ k.label }}</span>
          <span class="kpi__value">{{ k.value }}</span>
          <span class="kpi__foot">
            <span v-if="k.trend" class="trend" :class="k.up ? 'trend--up' : 'trend--down'">{{ k.up ? '▲' : '▼' }} {{ k.trend }}</span>
            <span>{{ k.foot }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 教学闭环（原型 .loop 招牌块）：五环各一卡，读数全真实。
         口径：对话/路径/评估来自 overview/stats（随 10s 轮询）；
         教学回合=会话累计、记忆复习=到期待办（进页拉一次）。 -->
    <div class="card">
      <div class="card__head">
        <span class="card__title">教学闭环</span>
        <span class="card__sub">目标对话 → 路径规划 → 教学回合 → 课后评估 → 记忆复习</span>
        <span class="card__tools">
          <span v-if="loopFailedPaths" class="pill pill--warn" title="进行中路径里的失败数"><span class="pill__dot"></span>路径失败 {{ loopFailedPaths }}</span>
        </span>
      </div>
      <div class="card__body">
        <div class="loop">
          <template v-for="(s, i) in loopStages" :key="s.name">
            <span v-if="i" class="loop__arrow" aria-hidden="true">→</span>
            <div class="loop__step" :class="`loop__step--${s.tone}`" :title="s.title">
              <span class="loop__no">阶段 {{ i + 1 }}</span>
              <span class="loop__name">{{ s.name }}</span>
              <span class="loop__meta">{{ s.meta }}</span>
              <span class="loop__val">{{ s.val }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Row A（原型 1.6fr/1fr）：近 7 天活跃学习者 + 最近事件 -->
    <div class="row2">
      <div class="card">
        <div class="card__head">
          <span class="card__title">近 7 天活跃学习者</span>
          <span class="card__sub">单位：人 · 每日活跃</span>
          <span class="card__tools">
            <button type="button" class="mk-btn mk-btn--sm" @click="jump('people')">用户与学习者 →</button>
          </span>
        </div>
        <div class="card__body">
          <div class="barchart">
            <div v-for="c in barchartCols" :key="c.key" class="col" :title="c.title">
              <span class="val">{{ c.num }}</span>
              <span class="bar" :style="{ height: c.h + 'px' }"></span>
              <span class="cap">{{ c.cap }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__head">
          <span class="card__title">最近事件</span>
          <span class="card__sub">近 24h · 实时</span>
        </div>
        <div class="card__body">
          <div class="feed feed--capped">
            <div
              v-for="(f, i) in feedRows"
              :key="`f${i}`"
              class="feedrow"
              :class="{ 'feedrow--bad': f.tone === 'bad', 'feedrow--link': f.tone === 'bad' || f.tone === 'warn' }"
              :title="(f.tone === 'bad' || f.tone === 'warn') ? '点击查看日志' : undefined"
              :role="(f.tone === 'bad' || f.tone === 'warn') ? 'button' : undefined"
              :tabindex="(f.tone === 'bad' || f.tone === 'warn') ? 0 : undefined"
              @click="feedJump(f)"
              @keydown.enter.prevent="feedJump(f)"
              @keydown.space.prevent="feedJump(f)"
            >
              <span class="feedrow__time">{{ f.time }}</span>
              <div class="feedrow__grow">
                <span class="t">{{ f.text }}</span>
                <span class="d">{{ feedDesc(f) }}</span>
              </div>
            </div>
          </div>
          <p v-if="!feedRows.length && data.feed.length" class="note">近期动态均为模拟账号（默认隐藏）。</p>
          <p v-else-if="!feedRows.length" class="note">近 24h 暂无动态。</p>
        </div>
      </div>
    </div>

    <!-- Row B（原型 auto-fit 280 三小卡） -->
    <div class="row3">
      <div class="card">
        <div class="card__head">
          <span class="card__title">Skill 调用量 Top 5</span>
          <span class="card__sub">近 7 天</span>
        </div>
        <div class="card__body">
          <div class="ranklist">
            <div
              v-for="(s, i) in data.topSkills"
              :key="s.agentId"
              class="rankrow rankrow--link"
              :title="`${s.agentId}：${s.calls} 次调用 · ${s.failed} 次失败 · 点击查看 Skill 运行`"
              role="button"
              tabindex="0"
              @click="jump('skills')"
              @keydown.enter.prevent="jump('skills')"
              @keydown.space.prevent="jump('skills')"
            >
              <span class="rankrow__idx">{{ i + 1 }}</span>
              <span class="rankrow__grow mono">{{ s.agentId }}</span>
              <span class="rankrow__val mono">{{ s.calls }}<template v-if="s.failed"> · {{ s.failed }}</template></span>
            </div>
          </div>
          <p v-if="!data.topSkills.length" class="note">近 7 天暂无调用，无排行。</p>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <span class="card__title">待处理事项</span>
          <span class="card__tools">
            <span v-if="todoItems.length" class="pill pill--warn"><span class="pill__dot"></span>{{ todoItems.length }}</span>
          </span>
        </div>
        <div class="card__body">
          <div class="ranklist">
            <div v-for="t in todoItems" :key="t.key" class="rankrow">
              <span class="rankrow__grow" :title="t.text">{{ t.text }}</span>
              <button type="button" class="mk-btn mk-btn--sm" @click="t.action()">{{ t.actLabel }} →</button>
            </div>
          </div>
          <p v-if="!todoItems.length" class="note">没有待处理的事项。</p>
        </div>
      </div>

      <!-- 模型与失败（原 LLM 宽卡收编）：meterrow 分布行 = 原型「学习状态分布」同款视觉 -->
      <div class="card">
        <div class="card__head">
          <span class="card__title">模型与失败</span>
          <span class="card__sub">近 7 天 · 真实用户<template v-if="usageFailRate"> · 失败率 {{ usageFailRate }}</template></span>
        </div>
        <div class="card__body">
          <div v-if="usageHasData" class="dist">
            <div v-if="data.usage.models7d.length" class="dist__group">
              <span class="dist__label">模型用量</span>
              <div v-for="m in data.usage.models7d" :key="m.model" class="meterrow">
                <span class="meterrow__grow" :title="m.model">{{ m.model }}</span>
                <span class="meter"><i :style="{ width: modelPct(m.tokens), background: 'var(--mk-blue)' }"></i></span>
                <span class="meterrow__val mono">{{ fmtTokens(m.tokens) }}</span>
              </div>
            </div>
            <div v-if="data.usage.failures7d.length" class="dist__group">
              <span class="dist__label">失败原因</span>
              <div
                v-for="f in data.usage.failures7d"
                :key="f.category"
                class="meterrow meterrow--link"
                :title="`查看 ${f.category} 类别失败日志（近 7 天）`"
                role="button"
                tabindex="0"
                @click="jumpToFailures(f.category)"
                @keydown.enter.prevent="jumpToFailures(f.category)"
                @keydown.space.prevent="jumpToFailures(f.category)"
              >
                <span class="meterrow__grow">{{ f.category }}</span>
                <span class="meter"><i :style="{ width: failPct(f.count), background: 'var(--mk-amber)' }"></i></span>
                <span class="meterrow__val mono">{{ f.count }}</span>
              </div>
            </div>
          </div>
          <p v-else class="note">近 7 天暂无 LLM 调用记录。</p>
        </div>
      </div>
    </div>
  </div>
  <MkLoading v-else-if="liveLoading" min text="正在加载真实数据…" />
  <MkEmptyState
    v-else
    min
    title="真实数据暂不可用，请刷新或稍后重试。"
    action-text="重试"
    @action="retryOverview"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { overviewHealth, investigateAgent, intent, dataSource } from './store';
import { liveOverviewFull, overviewHideTest, refreshLiveOverview, liveLoading, liveRefreshing, liveVirtualRunStats, type LiveOverviewFull } from './live';
import { adminHealthCenterApi, adminMemoryReviewApi, adminTeachingSessionsApi } from '@/api/adminApi';
import MkPageHead from '@/components/mk/MkPageHead.vue';
import MkEmptyState from '@/components/mk/MkEmptyState.vue';
import MkLoading from '@/components/mk/MkLoading.vue';
import { useSafePolling } from '@/composables/useSafePolling';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

// 简报数据即 live.ts 的总览全量类型（单一事实源）
type BriefData = LiveOverviewFull;

const health = computed(() => overviewHealth.value);

// 健康结论与行动项同源：health 提示异常时即使静态 actions 为空也要给出排查入口
const effectiveActions = computed(() => {
  if (!data.value) return [];
  if (data.value.actions.length) return data.value.actions;
  const tone = health.value.tone;
  if (tone === 'warn') {
    // 兜底动作不伪造 agentId：空串让 investigateAgent 只带失败状态筛选
    return [{ text: '教学链路出现失败，检查模型服务与限流配置', tone: 'bad' as Tone, agentId: '', link: '' }];
  }
  return [];
});

const data = computed<BriefData | null>(() => liveOverviewFull.value);

/* ===== 教学闭环条（原型 .loop）=====
   五环规模：对话/路径/评估在 overview/stats 里（随轮询刷新）；
   教学回合（会话累计）与记忆复习（到期待办）进页拉一次——低频口径不进轮询。 */
const teachTotal = ref<number | null>(null);
const memDue = ref<number | null>(null);
interface LoopStage { name: string; meta: string; val: string; tone: 'active' | 'done' | 'alert'; title: string }
const loopStages = computed<LoopStage[]>(() => {
  const d = data.value;
  const evalOk = (d?.wrapup.evaluationModel ?? 0) + (d?.wrapup.evaluationAiFallback ?? 0);
  return [
    {
      name: '目标对话', meta: '澄清真实目标与约束',
      val: `${d?.loop.conversationsActive ?? 0} 进行中`, tone: 'active',
      title: '进行中的目标对话（overview/stats · 随轮询刷新）',
    },
    {
      name: '路径规划', meta: '生成阶段化学习路径',
      val: `${d?.loop.pathsActive ?? 0} 进行中`, tone: 'done',
      title: `进行中路径 ${d?.loop.pathsActive ?? 0} · 失败 ${d?.loop.pathsFailed ?? 0}（overview/stats · 随轮询刷新）`,
    },
    {
      name: '教学回合', meta: '回合式讲解与追问',
      val: teachTotal.value == null ? '—' : `${teachTotal.value.toLocaleString()} 累计`, tone: 'done',
      title: '教学会话累计数（教学会话列表 total · 进页时拉取）',
    },
    {
      name: '课后评估', meta: '产出与掌握度评估',
      val: `${evalOk} 份`, tone: 'done',
      title: `评估产出 ${evalOk} 份 · 失败 ${d?.wrapup.evaluationFailed ?? 0}（wrapup 样本口径 · 随轮询刷新）`,
    },
    {
      name: '记忆复习', meta: '遗忘曲线调度复习',
      val: memDue.value == null ? '—' : `${memDue.value} 待办`,
      tone: (memDue.value ?? 0) > 0 ? 'alert' : 'done',
      title: '到期未复习的记忆条数（记忆与复盘 totals.due · 进页时拉取）',
    },
  ];
});
const loopFailedPaths = computed(() => data.value?.loop.pathsFailed ?? 0);
async function loadLoopExtras() {
  try {
    const r = await adminMemoryReviewApi.overview({ limit: 1 });
    memDue.value = Number(r.data?.data?.totals?.due ?? 0);
  } catch { /* 拉不到就留「—」，不阻塞页面 */ }
  try {
    const r = await adminTeachingSessionsApi.list({ limit: 1 });
    teachTotal.value = Number(r.data?.data?.total ?? 0);
  } catch { /* 同上 */ }
}

/* 页头副文（原型 pageTitle p）：数据截至 + 刷新语义 */
const headSub = computed(() => {
  const stale = overviewStale.value ? ' · 刷新失败，展示上次数据' : ' · 每 10s 自动刷新';
  return `WenFlow 运行全景 · 数据截至 ${lastUpdated.value || '—'}${stale}`;
});
function refreshNow() { void refreshOverviewTracked(true); }

/* ===== KPI（原型 .kpi + 趋势 foot）=====
   趋势真实来源：今日调用 vs 昨日（trend7d 末两项）、今日活跃 vs 昨日（growth7d 末两项）。
   成功率/系统活跃无可比基线，不造趋势。 */
interface KpiCard { label: string; value: string; foot: string; trend: string | null; up: boolean }
const kpiCards = computed<KpiCard[]>(() => {
  const base = data.value?.kpis ?? [];
  const calls = data.value?.trend7d ?? [];
  const growth = data.value?.growth7d ?? [];
  const prevCalls = calls.length >= 2 ? calls[calls.length - 2].calls : null;
  const curCalls = calls.length ? calls[calls.length - 1].calls : null;
  const prevActive = growth.length >= 2 ? growth[growth.length - 2].activeUsers : null;
  const curActive = growth.length ? growth[growth.length - 1].activeUsers : null;
  const delta = (t: number | null, y: number | null): { trend: string | null; up: boolean } => {
    if (t == null || y == null || y <= 0) return { trend: null, up: true };
    const pct = Math.round(((t - y) / y) * 100);
    return { trend: `${pct >= 0 ? '+' : ''}${pct}%`, up: pct >= 0 };
  };
  const callTrend = delta(curCalls, prevCalls);
  const activeTrend = delta(curActive, prevActive);
  return base.map((k, i) => {
    const t = i === 0 ? callTrend : i === 2 ? activeTrend : { trend: null, up: true };
    return { label: k.label, value: k.value, foot: k.hint, trend: t.trend, up: t.up };
  });
});

/* ===== 近 7 天活跃学习者（原型 .barchart：顶部数值 + 渐变柱 + 星期帽）===== */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const activeMax = computed(() => Math.max(1, ...(data.value?.growth7d.map((g) => g.activeUsers) || [])));
const barchartCols = computed(() => (data.value?.growth7d || []).map((g) => {
  const d = new Date(`${g.date}T00:00:00`);
  const active = g.activeUsers || 0;
  return {
    key: g.date,
    num: String(active),
    cap: Number.isNaN(d.getTime()) ? g.date.slice(5) : WEEKDAYS[d.getDay()],
    h: Math.max(4, Math.round((active / activeMax.value) * 132)),
    title: `${g.date}：活跃 ${active} 人 · 新增 ${g.newUsers}`,
  };
}));

/* 系统健康摘要：拉统一健康清单（60s 缓存），只取 warn/error 计数 */
const healthCheck = ref<{ total: number; warn: number; error: number } | null>(null);
const healthTone = computed<Tone>(() =>
  !healthCheck.value ? 'muted' : healthCheck.value.error > 0 ? 'bad' : healthCheck.value.warn > 0 ? 'warn' : 'ok'
);
const healthText = computed(() => {
  if (!healthCheck.value) return '健康检查加载中'
  if (healthCheck.value.error > 0) return `${healthCheck.value.error} 项异常`
  if (healthCheck.value.warn > 0) return `${healthCheck.value.warn} 项需关注`
  return `${healthCheck.value.total} 项检查全部正常`
});
async function loadHealth() {
  try {
    const res = await adminHealthCenterApi.get()
    const items = res.data?.data?.items ?? []
    if (!items.length) return
    healthCheck.value = {
      total: items.length,
      warn: items.filter((i) => i.severity === 'warn').length,
      error: items.filter((i) => i.severity === 'error').length,
    }
  } catch {
    healthCheck.value = null
  }
}
/* 仿真通道摘要：失败率用「系统失败率」；阈值 ≥50% 红、≥20% 或存在失败 黄、无会话灰 */
const runStats = liveVirtualRunStats
const simTone = computed<Tone>(() => {
  const r = runStats.value
  if (!r.totalSessions && !r.todayCalls) return 'muted'
  if (r.systemFailureRate >= 50) return 'bad'
  if (r.systemFailureRate >= 20 || r.failed > 0) return 'warn'
  return 'ok'
})
const simHeadline = computed(() => {
  const r = runStats.value
  if (!r.totalSessions && !r.todayCalls) return '仿真空闲'
  if (r.systemFailureRate >= 20) return `需要关注：系统失败率 ${r.systemFailureRate}%`
  return '仿真运行平稳'
})
const simTitle = computed(() => {
  const r = runStats.value
  return [
    '虚拟学习者 / 仿真通道健康度（仅虚拟/测试账号，与真实用户口径互斥）',
    `总会话 ${r.totalSessions}`,
    `已完成 ${r.completed}`,
    `系统失败 ${r.failed}`,
    `人为终止 ${r.abandoned}`,
    `进行中 ${r.running}`,
    '点击进入「虚拟学习者」',
  ].join(' · ')
})

const hasWrapupStats = computed(() => {
  const w = data.value?.wrapup;
  if (!w) return false;
  return w.summaryModel > 0 || w.summaryFallback > 0 || w.evaluationModel > 0 || w.evaluationAiFallback > 0 || w.evaluationFailed > 0;
});
const usageHasData = computed(() => {
  const u = data.value?.usage;
  return !!u && (u.totalTokens7d > 0 || u.models7d.length > 0);
});
const fmtTokens = (n: number) => (n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || '—'));
const modelMax = computed(() => Math.max(1, ...(data.value?.usage.models7d.map((m) => m.tokens) || [])));
const modelPct = (tokens: number) => `${tokens > 0 ? Math.round((tokens / modelMax.value) * 100) : 0}%`;
/* 失败率（失败/调用）：裸失败次数没有分母读不出好坏 */
const usageFailRate = computed(() => {
  const u = data.value?.usage;
  if (!u || !u.calls7d) return null;
  return `${((u.failed7d / u.calls7d) * 100).toFixed(1)}%`;
});
const failMax = computed(() => Math.max(1, ...(data.value?.usage.failures7d.map((f) => f.count) || [])));
const failPct = (count: number) => `${count > 0 ? Math.max(Math.round((count / failMax.value) * 100), 6) : 0}%`;

/* 总结质量条件行：只在出现兜底/失败时露头 */
const wrapupIssue = computed(() => {
  const w = data.value?.wrapup;
  if (!w || !hasWrapupStats.value) return null;
  const parts: string[] = [];
  if (w.summaryFallback > 0) parts.push(`${w.summaryFallback} 次兜底`);
  if (w.evaluationFailed > 0) parts.push(`${w.evaluationFailed} 次失败`);
  if (!parts.length) return null;
  return {
    tone: w.evaluationFailed > 0 ? 'bad' : 'warn',
    text: `最近 ${w.sampleSize} 次课后总结：${parts.join(' · ')}`,
  };
});

// 重试按钮：force 跳过 liveLoading 守卫保证点击必重拉
async function retryOverview() {
  const ok = await refreshOverviewTracked(true)
  if (ok) lastUpdated.value = new Date().toTimeString().slice(0, 5)
}

// 动态筛选：默认隐藏虚拟学习者与测试/审计账号（后端 excludeTest 已按此过滤）
const hideTestAccounts = overviewHideTest
// KPI 目标：今日调用 / 今日成功率 / 用户活跃 / 系统活跃（纯真实口径 4 卡）
const kpiTargets: Array<{ scene: string; tab?: string }> = [
  { scene: 'execution-logs' },
  { scene: 'execution-logs' },
  { scene: 'people' },
  { scene: 'goal-conversations' }
]

const KPI_HINTS: string[] = [
  '今日自然日（00:00 起）',
  '今日真实调用成功率',
  '今日新增注册 + 今日有学习会话的用户',
  '今日进行中的目标对话 + 近 24h 有调用的 Skill',
]
function kpiTitle(i: number): string {
  const hint = KPI_HINTS[i] || ''
  const target = kpiTargets[i]?.scene || ''
  const label = target === 'execution-logs' ? '执行日志'
    : target === 'people' ? '用户与学习者'
      : target === 'goal-conversations' ? '目标对话' : 'Skill 目录'
  return [hint, `点击查看${label}`].filter(Boolean).join(' · ')
}
function jump(scene: string, tab?: string) {
  if (!scene) return
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceId = ''
  intent.errorCategory = ''
  intent.timeRange = ''
  intent.tab = tab || ''
  intent.scene = scene
}

/* R5：失败归因/异常流 → 执行日志（带错误类别 + 状态 + 近 7 天时间窗筛选） */
function jumpToFailures(category: string) {
  intent.errorCategory = category || ''
  intent.statusFilter = category === 'provider_timeout' ? 'warn' : 'err'
  intent.timeRange = 'week'
  intent.agentFilter = ''
  intent.traceId = ''
  intent.sessionId = ''
  intent.scene = 'execution-logs'
}

/* 最近事件（原型 feed：时间列 + 标题/描述两行；坏/警事件可点进日志） */
const isTestAccount = (text: string) => {
  const email = String(text || '').replace(/^新用户注册：/, '');
  if (email.startsWith('virtual_') || email.endsWith('@test.local')) return true;
  return /^(audit_probe_|e2e_|ui_check|motion_review|qa_audit_)/.test(email);
};
const testFilteredFeed = computed(() => {
  const feed = data.value?.feed || [];
  return hideTestAccounts.value ? feed.filter((f) => !isTestAccount(f.text)) : feed;
});
const feedRows = computed(() => testFilteredFeed.value.slice(0, 12));
function feedDesc(f: BriefData['feed'][number]): string {
  if (f.agentId) return `Skill · ${f.agentId}`
  if (f.errorCategory) return `失败类别 · ${f.errorCategory}`
  return f.tone === 'bad' || f.tone === 'warn' ? '点击查看日志' : ''
}
function feedJump(f: { tone: string; errorCategory?: string }) {
  if (f.tone !== 'bad' && f.tone !== 'warn') return
  jumpToFailures(f.errorCategory || '')
}

/* 待处理事项（原型 Row B 第二卡）：与状态条同源，不另起口径 */
interface TodoItem { key: string; text: string; tone: Tone; actLabel: string; action: () => void }
const todoItems = computed<TodoItem[]>(() => {
  const items: TodoItem[] = [];
  for (const a of effectiveActions.value) {
    items.push({
      key: `a-${a.agentId}-${a.text}`,
      text: a.text,
      tone: a.tone,
      actLabel: '去排查',
      action: () => investigateAgent(a.agentId),
    });
  }
  const w = wrapupIssue.value;
  if (w) {
    items.push({ key: 'wrapup', text: w.text, tone: w.tone as Tone, actLabel: '教学会话', action: () => jump('teaching-sessions') });
  }
  return items;
});

/* R6：10s 自动刷新（setTimeout 链 + 并发守卫 + 指数退避）。
   P2「更新于」假新鲜修复：只有确认拉到新数据才更新时间戳。 */
const lastUpdated = ref('')
const overviewStale = ref(false)
async function refreshOverviewTracked(force = false): Promise<boolean> {
  const before = liveOverviewFull.value
  try {
    await refreshLiveOverview(force)
  } catch {
    /* live.ts 内部已吞错，理论不可达；兜底按未刷新处理 */
  }
  if (liveOverviewFull.value !== before) {
    overviewStale.value = false
    return true
  }
  if (liveRefreshing.value || liveLoading.value) return false
  overviewStale.value = true
  return false
}
const { start: startAutoRefresh } = useSafePolling(
  async () => {
    const ok = await refreshOverviewTracked()
    if (ok) lastUpdated.value = new Date().toTimeString().slice(0, 5)
  },
  {
    interval: 10000,
    maxBackoff: 60000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
    onError: (_e, n) => {
      console.warn(`[Overview] auto-refresh failed (${n}/5 consecutive)`)
    },
    onCircuitBroken: (n) => {
      console.error(`[Overview] auto-refresh stopped after ${n} consecutive failures — backend may be down`)
    },
  }
)
onMounted(() => {
  void loadHealth()
  void loadLoopExtras()
  lastUpdated.value = new Date().toTimeString().slice(0, 5)
  startAutoRefresh()
})
watch(dataSource, () => {
  lastUpdated.value = new Date().toTimeString().slice(0, 5)
  startAutoRefresh()
})
</script>

<style scoped>
/* =====================================================================
   总览页 = newui「UI-分支优化设计」renderOverview 的逐类复刻。
   类名与原型一一对应（card/kpi/barchart/feed/ranklist/meterrow/loop）；
   色与圆角全走 --mk-* token（数值与原型 --brand/--r-* 同源）。
   全局原语已覆盖的：页头（MkPageHead=pagehead）、状态条（mk-status=statusbar）、
   按钮（mk-btn=btn）。原型「学习状态分布」卡在本页由「模型与失败」顶替
   （后端暂无学习状态聚合口径），meterrow 视觉同构、数据真实。
   ===================================================================== */

/* ---- KPI（.grid auto-fit 210 + .card.kpi）---- */
.kpigrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
.card--kpi { cursor: pointer; transition: border-color 0.12s ease; }
.card--kpi:hover { border-color: color-mix(in srgb, var(--mk-blue) 45%, var(--mk-line)); }
.card--kpi:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; }
.kpi { display: grid; gap: 6px; padding: 16px; align-content: start; }
.kpi__label { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.kpi__value {
  font-size: 28px; font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums; color: var(--mk-ink); line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kpi__foot { display: flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.trend { font-weight: 700; font-variant-numeric: tabular-nums; }
.trend--up { color: var(--mk-green); }
.trend--down { color: var(--mk-red); }

/* ---- 卡片（原型 .card：head 12/16 分隔线 + body 16）---- */
.card {
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  overflow: clip;
}
.card__head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; border-bottom: 1px solid var(--mk-line); flex-wrap: wrap;
}
.card__head > :first-child { flex: 1 1 auto; }
.card__title { font-weight: 700; font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.card__sub { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.card__tools { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card__body { padding: 16px; }

/* ---- 胶囊（原型 .pill：卡头 tools 徽标）---- */
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px; border-radius: 999px;
  font-size: var(--mk-fs-micro); font-weight: 600;
  border: 1px solid transparent; white-space: nowrap;
}
.pill--warn { color: var(--mk-amber); background: var(--mk-amber-bg); }
.pill__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

/* ---- 闭环条（原型 .loop）---- */
.loop { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; padding: 4px 0; }
.loop__arrow { display: grid; place-items: center; flex: none; color: var(--mk-faint); font-size: var(--mk-fs-emphasis); }
.loop__step {
  flex: 1 1 0; min-width: 138px; display: grid; gap: 5px;
  padding: 12px 14px; border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg); background: var(--mk-surface);
}
.loop__step--active { border-color: var(--mk-blue); background: var(--mk-blue-bg); }
.loop__step--done { border-color: color-mix(in srgb, var(--mk-green) 34%, var(--mk-line)); }
.loop__step--alert { border-color: color-mix(in srgb, var(--mk-amber) 42%, var(--mk-line)); background: var(--mk-amber-bg); }
.loop__no { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.loop__name { font-weight: 700; font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.loop__meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.loop__val { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--mk-ink); }

/* ---- Row A：图（1.6fr）+ 事件（1fr）---- */
.row2 { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.barchart { display: flex; align-items: flex-end; gap: 10px; height: 168px; padding-top: 8px; }
.barchart .col { flex: 1; display: grid; align-content: end; justify-items: center; gap: 6px; min-width: 0; }
.barchart .bar {
  width: 100%; max-width: 40px; min-height: 4px;
  border-radius: 6px 6px 4px 4px;
  background: linear-gradient(180deg, var(--mk-blue), color-mix(in srgb, var(--mk-blue) 62%, var(--mk-surface)));
}
.barchart .val { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-family: var(--mk-mono); }
.barchart .cap { font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* 最近事件（原型 .feed--capped：时间列 + 标题/描述，限高滚动） */
.feed--capped { display: grid; gap: 2px; max-height: 236px; overflow-y: auto; overscroll-behavior: contain; }
.feedrow { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--mk-line); }
.feedrow:last-child { border-bottom: 0; }
.feedrow--bad .t { color: var(--mk-red); }
.feedrow--link { cursor: pointer; border-radius: var(--mk-radius-sm); }
.feedrow--link:hover { background: var(--mk-btn-hover-bg); }
.feedrow__time {
  width: 62px; flex: none; color: var(--mk-faint);
  font-size: var(--mk-fs-micro); font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
}
.feedrow__grow { min-width: 0; display: grid; gap: 2px; }
.feedrow__grow .t {
  font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.feedrow__grow .d {
  color: var(--mk-muted); font-size: var(--mk-fs-micro);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ---- Row B：auto-fit 280 三小卡 ---- */
.row3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.ranklist { display: grid; gap: 2px; }
.rankrow { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--mk-line); }
.rankrow:last-child { border-bottom: 0; }
.rankrow__idx { width: 20px; flex: none; font-family: var(--mk-mono); color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.rankrow__grow {
  flex: 1; min-width: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rankrow--link { cursor: pointer; }
.rankrow--link:hover .rankrow__grow { color: var(--mk-blue); }
.rankrow__val { flex: none; font-variant-numeric: tabular-nums; font-weight: 600; font-size: var(--mk-fs-micro); color: var(--mk-ink); }

/* 分布行（模型用量/失败原因）：label + meter + 数值，原型 .meterrow 同构 */
.dist { display: grid; gap: 14px; }
.dist__group { display: grid; gap: 6px; }
.dist__group + .dist__group { padding-top: 12px; border-top: 1px dashed var(--mk-line); }
.dist__label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); letter-spacing: 0.04em; }
.meterrow { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.meterrow__grow {
  flex: 1; min-width: 0; font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.meterrow--link { cursor: pointer; border-radius: var(--mk-radius-sm); }
.meterrow--link:hover { background: var(--mk-btn-hover-bg); }
.meter { width: 108px; height: 6px; flex: none; border-radius: 999px; background: var(--mk-surface-3); overflow: hidden; }
.meter > i { display: block; height: 100%; border-radius: 999px; }
.meterrow__val { width: 52px; flex: none; text-align: right; font-variant-numeric: tabular-nums; font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); }

/* 空态/说明行（原型 .note） */
.note {
  margin: 0; padding: 10px 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2); color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}

/* 响应式（原型：≤768 图高 132 / feed 限高同步收窄） */
@media (max-width: 1100px) {
  .row2 { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .barchart { height: 132px; }
  .feed--capped { max-height: 132px; }
}
</style>
