<template>
  <div v-if="data" class="mk-page">
    <!-- 页头（原型 pageTitle）：面包屑管「我在哪」，页头管「这页是什么 + 主操作」；
         状态条只放结论与异常，不再重复页名。 -->
    <MkPageHead title="平台总览" :sub="headSub">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="liveRefreshing" @click="refreshNow">
          {{ liveRefreshing ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>
    <!-- 结论先行（原型 .statusbar 形态）：一条状态条承载 今日结论 + 排查入口 + 健康/仿真摘要。
         原大横幅（健康环 + 行动作列表）按 newui「UI-分支优化设计」原型退役——原型用一条
         48px 状态条表达同样的层级：点色=结论、粗体=标题、meta=口径与子项、右端=动作；
         排查/健康/仿真各收成一个可点 meta（悬停有完整口径），信息一项不丢。 -->
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
        <button type="button" class="mk-status__action" @click="jump('health-center')">健康中心 →</button>
        <button type="button" class="mk-status__action" @click="jump('virtual-learners')">虚拟学习者 →</button>
      </div>
    </div>

    <div class="brief-grid">
      <!-- KPI 行：今日窗口指标（共享 MkKpi，clickable 跳转） -->
      <section class="brief-kpis">
        <MkKpi
          v-for="(k, i) in data.kpis"
          :key="k.label"
          :label="k.label"
          :value="k.value"
          :hint="k.hint"
          :title="kpiTitle(i)"
          clickable
          @click="jump(kpiTargets[i].scene, kpiTargets[i].tab)"
        />
      </section>

      <!-- 教学闭环（原型 .loop 招牌块）：五环各一卡，展示当前各环规模与去向。
           口径（悬停可见）：对话/路径/评估来自 overview/stats（随 10s 轮询刷新）；
           教学回合=会话累计、记忆复习=到期待办（进页拉一次，低频足够）。 -->
      <section class="brief-card brief-card--full">
        <div class="brief-card__head">
          <h4>教学闭环</h4>
          <span class="brief-card__meta">目标对话 → 路径规划 → 教学回合 → 课后评估 → 记忆复习</span>
          <span v-if="loopFailedPaths" class="mk-status__filter" title="进行中路径里的失败数">失败 {{ loopFailedPaths }}</span>
        </div>
        <div class="mk-loop">
          <template v-for="(s, i) in loopStages" :key="s.name">
            <span v-if="i" class="mk-loop__arrow" aria-hidden="true">→</span>
            <div class="mk-loop__step" :class="`mk-loop__step--${s.tone}`" :title="s.title">
              <span class="mk-loop__no">阶段 {{ i + 1 }}</span>
              <span class="mk-loop__name">{{ s.name }}</span>
              <span class="mk-loop__meta">{{ s.meta }}</span>
              <span class="mk-loop__val">{{ s.val }}</span>
            </div>
          </template>
        </div>
      </section>

      <!-- 近 7 天活跃学习者（原型 Row A 左：整页唯一大图，单序列蓝柱） -->
      <section class="brief-card brief-card--chart2">
        <div class="brief-card__head">
          <h4>近 7 天活跃学习者</h4>
          <span class="brief-card__meta">单位：人 · 每日活跃</span>
          <button type="button" class="brief-card__go" @click="jump('people')">用户与学习者 →</button>
        </div>
        <OvBars v-if="growthSum > 0" :cols="activeCols" :min-bars-height="96" />
        <p v-else class="brief-card__note">近 7 天暂无活跃用户。</p>
      </section>

      <!-- 最近事件（原型 Row A 右：feed，异常置顶、点色分级，坏事件可点进日志） -->
      <section class="brief-card brief-card--feed">
        <div class="brief-card__head">
          <h4>最近事件<span v-if="lastUpdated" class="feed-fresh">更新于 {{ lastUpdated }}</span><span v-if="overviewStale" class="feed-fresh feed-fresh--stale" role="status">刷新失败，展示上次数据</span></h4>
          <span class="brief-card__meta">近 24h</span>
        </div>
        <ul v-if="feedRows.length" class="feed feed--full">
          <li
            v-for="(f, i) in feedRows"
            :key="`f${i}`"
            class="feed__item"
            :class="`feed__item--${f.tone}`"
            :title="(f.tone === 'bad' || f.tone === 'warn') ? `查看 ${f.errorCategory || '失败'} 类别日志` : f.text"
            :role="(f.tone === 'bad' || f.tone === 'warn') ? 'button' : undefined"
            :tabindex="(f.tone === 'bad' || f.tone === 'warn') ? 0 : undefined"
            @click="feedJump(f)"
            @keydown.enter.prevent="feedJump(f)"
            @keydown.space.prevent="feedJump(f)"
          >
            <span class="feed__dot" :class="`feed__dot--${f.tone}`"></span>
            <div class="feed__body">
              <strong>{{ f.text }}</strong>
              <span>{{ f.time }}</span>
            </div>
            <i v-if="f.tone === 'bad' || f.tone === 'warn'" class="feed__go">排查 →</i>
          </li>
        </ul>
        <p v-else-if="data.feed.length" class="feed__empty">近期动态均为模拟账号（默认隐藏）。</p>
        <p v-else class="feed__empty">近 24h 暂无动态。</p>
      </section>

      <!-- Row B 三小卡（原型节奏）：Skill Top5 / 待处理事项 / 模型与失败 -->
      <section class="brief-card">
        <div class="brief-card__head">
          <h4 title="近 7 天调用最多的 Skill（真实用户口径）">Skill 调用量 Top 5</h4>
          <button type="button" class="brief-card__go" @click="jump('skills')">Skill 运行 →</button>
        </div>
        <ul v-if="data.topSkills.length" class="ov-skills">
          <li
            v-for="(s, i) in data.topSkills"
            :key="s.agentId"
            class="ov-skill"
            :title="`${s.agentId}：${s.calls} 次调用 · ${s.failed} 次失败 · 点击查看 Skill 运行`"
            role="button"
            tabindex="0"
            :aria-label="`查看 ${s.agentId} 的 Skill 运行`"
            @click="jump('skills')"
            @keydown.enter.prevent="jump('skills')"
            @keydown.space.prevent="jump('skills')"
          >
            <span class="ov-skill__rank">{{ i + 1 }}</span>
            <span class="ov-skill__name mono" :title="s.agentId">{{ s.agentId }}</span>
            <div class="ov-skill__track">
              <i class="ov-skill__bar" :style="{ width: skillPct(s.calls) }"></i>
            </div>
            <span class="ov-skill__calls mono">{{ s.calls }}<template v-if="s.failed"> · <em class="ov-skill__fail">{{ s.failed }}</em></template></span>
          </li>
        </ul>
        <p v-else class="brief-card__note">近 7 天暂无调用，无排行。</p>
      </section>

      <section class="brief-card">
        <div class="brief-card__head">
          <h4>待处理事项</h4>
          <span v-if="todoItems.length" class="mk-badge mk-badge--warn">{{ todoItems.length }}</span>
        </div>
        <ul v-if="todoItems.length" class="ov-todos">
          <li v-for="t in todoItems" :key="t.key">
            <span class="feed__dot" :class="`feed__dot--${t.tone}`"></span>
            <span class="ov-todos__text" :title="t.text">{{ t.text }}</span>
            <button type="button" class="brief-card__go" @click="t.action()">{{ t.actLabel }} →</button>
          </li>
        </ul>
        <p v-else class="brief-card__note">没有待处理的事项。</p>
      </section>

      <!-- 模型与失败（原 LLM 宽卡收编为小卡：meter 行语言，与原型「分布卡」同构） -->
      <section class="brief-card">
        <div class="brief-card__head">
          <h4 title="近 7 天（滚动窗口）">模型与失败 · 近 7 天</h4>
          <span class="brief-card__meta" title="近 7 天真实用户 Token 消耗 · 点击查看执行日志">
            <button type="button" class="brief-card__go" @click="jump('execution-logs')">{{ fmtTokens(data.usage.totalTokens7d) }}<template v-if="usageFailRate"> · 失败率 {{ usageFailRate }}</template> →</button>
          </span>
        </div>
        <div v-if="usageHasData" class="usage">
          <div v-if="data.usage.models7d.length" class="usage__section">
            <span class="usage__label">模型用量</span>
            <div class="usage__rows">
              <div v-for="m in data.usage.models7d" :key="m.model" class="usage__row">
                <span class="usage__row-name" :title="m.model">{{ m.model }}</span>
                <div class="usage__bar-track">
                  <i class="usage__bar" :style="{ width: modelPct(m.tokens) }"></i>
                </div>
                <span class="usage__row-num">{{ fmtTokens(m.tokens) }}</span>
              </div>
            </div>
          </div>
          <div v-if="data.usage.failures7d.length" class="usage__section">
            <span class="usage__label">失败原因分布</span>
            <div class="usage__rows">
              <div
                v-for="f in data.usage.failures7d"
                :key="f.category"
                class="usage__row usage__row--clickable"
                :title="`查看 ${f.category} 类别失败日志（近 7 天）`"
                role="button"
                tabindex="0"
                @click="jumpToFailures(f.category)"
                @keydown.enter.prevent="jumpToFailures(f.category)"
                @keydown.space.prevent="jumpToFailures(f.category)"
              >
                <span class="usage__row-name"><i class="usage__dot"></i>{{ f.category }}</span>
                <div class="usage__bar-track">
                  <i class="usage__bar usage__bar--amber" :style="{ width: failPct(f.count) }"></i>
                </div>
                <span class="usage__row-num">{{ f.count }}</span>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="brief-card__note">近 7 天暂无 LLM 调用记录。</p>
      </section>
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
import MkKpi from '@/components/mk/MkKpi.vue';
import MkPageHead from '@/components/mk/MkPageHead.vue';
import MkEmptyState from '@/components/mk/MkEmptyState.vue';
import MkLoading from '@/components/mk/MkLoading.vue';
import OvBars from './OvBars.vue';
import { useSafePolling } from '@/composables/useSafePolling';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

// 简报数据即 live.ts 的总览全量类型（单一事实源）：此前手工复制全部字段，live.ts 演进时
// 两份定义会漂移（新增字段这里收不到、改口径不同步），改为直接复用其导出类型
type BriefData = LiveOverviewFull;

// 结论来自 store（由 spans 推导，与日志/瀑布/Skill 同源）；全部数据来自后端统计
const health = computed(() => overviewHealth.value);

// 健康结论与行动项同源：health 提示异常时即使静态 actions 为空也要给出排查入口，避免「需关注」与「无事可做」并存
const effectiveActions = computed(() => {
  if (!data.value) return [];
  if (data.value.actions.length) return data.value.actions;
  const tone = health.value.tone;
  if (tone === 'warn') {
    // 兜底动作不伪造 agentId（健康结论由 spans 推导，并无具体异常 agent）：空串让
    // investigateAgent 只带失败状态筛选、不带 agent 过滤，避免跳进「过滤后为空」的日志视图
    return [{ text: '教学链路出现失败，检查模型服务与限流配置', tone: 'bad' as Tone, agentId: '', link: '' }];
  }
  return [];
});

const data = computed<BriefData | null>(() => liveOverviewFull.value);

/* ===== 教学闭环条（原型 .loop）=====
   五环规模：对话/路径/评估在 overview/stats 里（随轮询刷新）；
   教学回合（会话累计）与记忆复习（到期待办）是另外两个端点，进页拉一次——
   这两环是低频口径（累计数/当日待办），不需要 10s 级新鲜度，也不该进轮询加重负载。 */
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

/* ===== 统一柱状图（OvBars）数据映射：四个柱状图收敛为同一种视觉语言
   （2026-09-27 走查「四个柱状图两种款式」——脉搏/调用趋势是 ECharts、
   用户增长/目标对话是手写 DOM，现全部走 OvBars 列式结构） ===== */
const barPct = (v: number, max: number) => `${v > 0 ? Math.max(Math.round((v / max) * 100), 6) : 3}%`;
/* 页头副文（原型 pageTitle p）：数据截至 + 刷新语义，让「刷新」按钮有时间锚点 */
const headSub = computed(() => {
  const stale = overviewStale.value ? ' · 刷新失败，展示上次数据' : ' · 每 10s 自动刷新';
  return `WenFlow 运行全景 · 数据截至 ${lastUpdated.value || '—'}${stale}`;
});
function refreshNow() { void refreshOverviewTracked(true); }
const dayLabel = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
};
const activeCols = computed(() => (data.value?.growth7d || []).map((g) => ({
  key: g.date,
  label: dayLabel(g.date),
  today: isToday(g.date),
  title: `${g.date}：活跃 ${g.activeUsers} 人（新增 ${g.newUsers}）`,
  num: String(g.activeUsers || 0),
  bars: [{ pct: barPct(g.activeUsers, growth7dMax.value), tone: 'blue' as const }],
})));

const growth7dMax = computed(() => Math.max(1, ...(data.value?.growth7d || []).flatMap((g) => [g.newUsers, g.activeUsers])));
const growthSum = computed(() => (data.value?.growth7d || []).reduce((a, g) => a + g.newUsers + g.activeUsers, 0));
const skillMax = computed(() => Math.max(1, ...(data.value?.topSkills.map((s) => s.calls) || [])));
const skillPct = (calls: number) => `${calls > 0 ? Math.max(Math.round((calls / skillMax.value) * 100), 6) : 0}%`;

/* 系统健康摘要条：拉统一健康清单（60s 缓存），只取 warn/error 计数 */
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
/* 仿真通道摘要条（虚拟学习者）：独立于真实用户 KPI，避免首屏把仿真失败遮住。
   失败率用「系统失败率」（failed/total，不含人为终止）；阈值：≥50% 红、≥20% 或存在失败 黄、否则绿；
   无会话且无今日虚拟调用 → 灰（仿真空闲）。 */
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
    '虚拟学习者 / 仿真通道健康度（仅虚拟/测试账号，与上方真实用户口径互斥）',
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

/** 全量副口径存在且与真实口径有差异 → 展示「含虚拟/测试」注记（口径诚实：默认真实 + 注明全量） */
const fmtTokens = (n: number) => (n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || '—'));
const modelMax = computed(() => Math.max(1, ...(data.value?.usage.models7d.map((m) => m.tokens) || [])));
const modelPct = (tokens: number) => `${tokens > 0 ? Math.round((tokens / modelMax.value) * 100) : 0}%`;
/* 失败率（失败/调用）：裸失败次数没有分母读不出好坏（走查 2026-09-27 两卡重设计） */
const usageFailRate = computed(() => {
  const u = data.value?.usage;
  if (!u || !u.calls7d) return null;
  return `${((u.failed7d / u.calls7d) * 100).toFixed(1)}%`;
});
const failMax = computed(() => Math.max(1, ...(data.value?.usage.failures7d.map((f) => f.count) || [])));
const failPct = (count: number) => `${count > 0 ? Math.max(Math.round((count / failMax.value) * 100), 6) : 0}%`;

// 与后端 UTC 切日同口径；后端日期为 MM-DD 短格式，兼容匹配（computed：跨午夜后仍正确）
const todayStr = computed(() => new Date().toISOString().slice(0, 10));
const isToday = (date: string) => date === todayStr.value || date === todayStr.value.slice(5);
/* 总结质量条件行：恒真满分卡已撤（2026-09-27），只在出现兜底/失败时于头部动作列表露头 */
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

// 重试按钮：force 跳过 liveLoading 守卫保证点击必重拉；成败走 tracked 包装（失败不刷时间戳）
async function retryOverview() {
  const ok = await refreshOverviewTracked(true)
  if (ok) lastUpdated.value = new Date().toTimeString().slice(0, 5)
}

// 动态筛选：默认隐藏虚拟学习者与测试/审计账号（后端 excludeTest 已按此过滤并重新拉取）
const hideTestAccounts = overviewHideTest
// KPI 目标：今日调用 / 今日成功率 / 用户活跃 / 系统活跃（纯真实口径 4 卡；虚拟仿真走「虚拟学习者」页）
// 导航收敛 2026-09-04：users+learner-center → people（tab: account|state）；goal-conversations → sessions
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

/* R5：失败归因/异常流 → 执行日志（带错误类别 + 状态 + 近 7 天时间窗筛选）。
   超时类别走「仅超时」态，其余走「仅失败」态（后端 status 语义一致） */
function jumpToFailures(category: string) {
  intent.errorCategory = category || ''
  intent.statusFilter = category === 'provider_timeout' ? 'warn' : 'err'
  intent.timeRange = 'week'
  intent.agentFilter = ''
  intent.traceId = ''
  intent.sessionId = ''
  intent.scene = 'execution-logs'
}

/* 异常流条目点击 → 带类别跳执行日志（普通事件不可点） */
function feedJump(f: { tone: string; errorCategory?: string }) {
  if (f.tone !== 'bad' && f.tone !== 'warn') return
  jumpToFailures(f.errorCategory || '')
}

/* R6：10s 自动刷新（使用 setTimeout 链 + 并发守卫 + 指数退避，
   后端不可用时不会堆积请求导致内存暴涨） */
const lastUpdated = ref('')
/* P2「更新于」假新鲜修复：live.ts 的 refreshLiveOverview 吞错不抛（live.ts 只读不改），
   这里在 Overview 侧包装成败判定——fetchLiveOverview 成功路径必写入新对象（liveOverviewFull 引用替换），
   失败/守卫早退时引用不变，据此决定是否更新时间戳并在状态条标注降级 */
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
  // 引用未变且确无他人在刷：本次请求失败，保留旧数据并标注「刷新失败」；
  // 若并发守卫/初始加载在跑（liveRefreshing/liveLoading），不算失败也不假刷时间戳，交给在跑的那次
  if (liveRefreshing.value || liveLoading.value) return false
  overviewStale.value = true
  return false
}
const { start: startAutoRefresh } = useSafePolling(
  async () => {
    const ok = await refreshOverviewTracked()
    // 只有确认拉到新数据才更新「更新于」：失败时保留旧时间戳，避免假新鲜
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
const isTestAccount = (text: string) => {
  const email = String(text || '').replace(/^新用户注册：/, '');
  if (email.startsWith('virtual_') || email.endsWith('@test.local')) return true;
  return /^(audit_probe_|e2e_|ui_check|motion_review|qa_audit_)/.test(email);
};
const testFilteredFeed = computed(() => {
  const feed = data.value?.feed || [];
  return hideTestAccounts.value ? feed.filter((f) => !isTestAccount(f.text)) : feed;
});
/* 最近事件（原型 feed）：异常在前（后端已按 bad/warn → ok/muted 排序），坏/警事件可点进日志。
   原「隐藏模拟账号」开关随原型化收编为默认行为（overviewHideTest 默认开），不再占卡头。 */
const feedRows = computed(() => testFilteredFeed.value.slice(0, 12));

/* 待处理事项（原型 Row B 第二卡）：Skill 失败排查 + 总结质量，与状态条同源不另起口径 */
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
</script>

<style scoped>
/* 页面容器已统一走 .mk-page（shared.css）：容器级 padding/边距/超大屏 max-width 封顶随全站规范 */
/* live 数据不可用时的空态 */

/* 教学闭环卡通栏（原型 .loop 在总览占整行；wide2 只跨 2 列不够它用） */
.brief-card--full { grid-column: 1 / -1; }

/* Row A：图（跨 2 列）+ 事件流（1 列）＝原型 1.6fr/1fr 的三列栅格读法 */
.brief-card--chart2 { grid-column: span 2; }
/* 待处理事项行（原型 rankrow：点色 + 文本 + 右侧动作） */
.ov-todos { list-style: none; margin: 0; padding: 0; display: grid; }
.ov-todos li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--mk-line); }
.ov-todos li:last-child { border-bottom: 0; }
.ov-todos__text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--mk-fs-body); color: var(--mk-ink); }

/* 总览栅格：三等宽列（等宽才能形成稳定节奏；LLM 宽卡/动态全宽按需跨列） */
.brief-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
}
.brief-kpis {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.brief-card {
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.brief-card h4 {
  margin: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mk-faint);
}
.brief-card__note { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 短卡（用量）：等高拉伸时把内容贴底，避免"卡片内空一大块" */
.brief-card > .usage:last-child { margin-top: auto; }
/* 空态说明：卡内垂直居中（等高栅格中避免贴顶 + 大留白） */
.brief-card > .brief-card__note:last-child {
  margin-top: auto;
  margin-bottom: auto;
  text-align: center;
  line-height: 1.7;
  padding: 8px 0;
}
/* 「总结产出质量」卡已撤（走查 2026-09-27：恒真满分卡零信息量），
   劣化时由简报头动作列表的条件行承担（见模板 wrapupIssue） */

/* 卡片头部统一：标题左 + 快捷跳转/时间窗 右（见板 = 状态一瞥 + 一键直达） */
.brief-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.brief-card__meta {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-weight: 700;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.brief-card__go {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  cursor: pointer;
  padding: 2px 6px;
  margin-right: -6px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0.75;
  transition: opacity 0.12s ease, background 0.12s ease;
}
.brief-card__go:hover { opacity: 1; background: #eff6ff; }

/* 近 7 天调用趋势（ECharts 图表；仅保留容器与合计行） */
.usage { display: grid; gap: 14px; }
/* Hero：Token 总量主角 + 调用/失败 辅指标（横向一排，均可点击跳执行日志） */
/* 模型用量 / 失败原因 横向两栏（宽卡内避免纵向长串） */
.usage__section { display: grid; gap: 6px; }
.usage__label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); letter-spacing: 0.04em; }
.usage__rows { display: grid; gap: 5px; }
.usage__row { display: grid; grid-template-columns: minmax(0, 1fr) 88px 52px; gap: 8px; align-items: center; font-size: var(--mk-fs-micro); }
.usage__row--clickable { cursor: pointer; border-radius: 6px; transition: background 0.12s ease; }
.usage__row--clickable:hover { background: var(--mk-btn-hover-bg); }
.usage__row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--mk-ink); }
.usage__bar-track { height: 6px; border-radius: var(--mk-radius-pill); background: #f0f3f9; overflow: hidden; }
.usage__bar { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: linear-gradient(90deg, color-mix(in srgb, var(--mk-blue) 72%, white), var(--mk-blue)); }
/* 失败原因条形：琥珀与「异常」语义一致，区别于模型用量的蓝 */
.usage__bar--amber { background: linear-gradient(90deg, color-mix(in srgb, var(--mk-amber) 72%, white), var(--mk-amber)); }
.usage__row-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--mk-muted); }
.usage__dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--mk-amber); margin-right: 6px; vertical-align: 1px; }

/* 近 7 天趋势（柱状区弹性撑满卡片，避免等高网格内留白） */
/* 漏斗卡已撤（2026-09-27）：1:N 展开配 ×倍数是假漏斗，真指标在目标对话卡累计行 */

/* 时间线（全宽卡：横向排列） */
.feed {
  margin: 0;
  padding: 0;
  list-style: none;
  position: relative;
  display: grid;
  gap: 12px;
}
.feed--full {
  /* 两列行式（走查 2026-09-27 重设计）：原来是 auto-fill 碎列，条目长短不一时参差；
     固定两列 + 单行条目（点 | 文本省略 | 时间 | 排查）读起来是整齐的表格感 */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 32px;
}
.feed--full::before { display: none; }
.feed--full li { display: flex; gap: 9px; align-items: center; }
.feed--full li .feed__body { display: flex; align-items: baseline; gap: 8px; }
.feed--full li strong { font-size: var(--mk-fs-micro); font-weight: 600; line-height: 1.45; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 最近事件卡（1 列宽）：单列 + 限高滚动（原型 feed--capped 的读法）。
   不限高时 12 条事件会把 Row A 整行撑到 660px+，图卡被迫跟着拉高一大截。 */
.brief-card--feed .feed--full {
  grid-template-columns: 1fr;
  max-height: 380px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.feed::before {
  content: '';
  position: absolute;
  left: 3.5px;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: var(--mk-line);
}
.feed li {
  display: flex;
  gap: 10px;
  position: relative;
}
.feed__dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #c3cede;
  box-shadow: 0 0 0 3px #fff;
  z-index: 1;
}
.feed__dot--ok { background: var(--mk-green); }
.feed__dot--warn { background: var(--mk-amber); }
.feed__dot--bad { background: var(--mk-red); }
.feed li div { display: grid; gap: 1px; min-width: 0; }
.feed li strong { font-size: var(--mk-fs-body); font-weight: 600; }
.feed li span { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.feed__empty { margin: 0; color: var(--mk-faint); font-size: var(--mk-fs-body); }
/* 新鲜度标注（R6：显示最近一次自动刷新的时间） */
.feed-fresh { margin-left: 6px; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; letter-spacing: 0.02em; }
/* 刷新失败降级标注（琥珀色与全站 warn 档一致，区别于正常时间戳的弱化灰） */
.feed-fresh--stale { color: var(--mk-amber, #b45309); }
/* 异常事件条目（bad/warn 置顶可点）——键盘可达：role=button + tabindex + Enter/Space 见模板。
   「排查 →」原来是 hover 才出现的（opacity 0），鼠标用户之外看不到这个行可点；
   改成常态半透明（0.5）、hover/focus 时点亮，键盘聚焦也画 focus ring。 */
.feed__item { cursor: pointer; border-radius: var(--mk-radius-sm); padding: 6px 8px; margin: -6px -8px; transition: background 0.12s ease; }
.feed__item:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.feed__item:hover { background: var(--mk-btn-hover-bg); }
.feed__item--bad:hover { background: #fff2f2; }
.feed__item--warn:hover { background: #fffaed; }
.feed__item .feed__body { flex: 1; min-width: 0; display: grid; gap: 1px; }
.feed__item--bad strong { color: var(--mk-red, var(--mk-red-strong)); }
.feed__item--warn strong { color: var(--mk-amber, var(--mk-amber)); }
.feed__go { font-style: normal; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue); flex-shrink: 0; align-self: center; opacity: 0.5; transition: opacity 0.12s ease; }
.feed__item:hover .feed__go,
.feed__item:focus-visible .feed__go { opacity: 1; }
/* 普通事件折叠开关 */

@media (max-width: 1280px) and (min-width: 1001px) {
  /* 中等宽度：三列过渡为两列，KPI 2+2 换行，动态卡占整行 */
  .brief-grid { grid-template-columns: 1fr 1fr; }
  .brief-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .brief-card--feed { grid-column: 1 / -1; }}

@media (max-width: 1000px) {
  .brief-grid { grid-template-columns: 1fr; }
  .brief-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* 4K：卡片字号放大（KPI 卡已组件化为 MkKpi，4K 档在组件内；容器随全站 mk-page 全宽） */
@media (min-width: 2000px) {
  .brief-card { padding: 20px 24px; }
  .brief-card h4 { font-size: var(--mk-fs-micro); }
  .brief-card__note { font-size: var(--mk-fs-body); }
  .feed__empty { font-size: var(--mk-fs-body); }
  .feed li strong { font-size: var(--mk-fs-body); }
  .feed li span { font-size: var(--mk-fs-micro); }
  .feed--full li strong { font-size: var(--mk-fs-body); }



  .usage__label { font-size: var(--mk-fs-micro); }
  .usage__row { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .brief-card { padding: 24px 30px; }
  .brief-card h4 { font-size: var(--mk-fs-micro); }
  .brief-card__note { font-size: var(--mk-fs-body); }
  .feed__empty { font-size: var(--mk-fs-body); }
  .feed li strong { font-size: var(--mk-fs-body); }
  .feed li span { font-size: var(--mk-fs-micro); }
  .feed--full li strong { font-size: var(--mk-fs-body); }



  .usage__label { font-size: var(--mk-fs-micro); }
  .usage__row { font-size: var(--mk-fs-micro); }
}
/* 3600+（zoom 1.3 档）：卡片延续 2800 放大节奏（约 1.17×），补齐 2000/2800 未覆盖的卡片内文字（feed/pulse/trend/usage）
   注：本档 px 是"除过 zoom 1.3"的补偿值（2800 档生效时壳层 zoom 1.15）。
   2026-09-24 桌面端验收：5 处补偿不足，有效字号反而小于 2800 档，已上调到 ≥ 2800 的有效值；
   守卫见 scripts/check-design-system.mjs 规则 11（档位字号单调性，按 zoom 折算比较）。 */
@media (min-width: 3600px) {
  .brief-card { padding: 28px 36px; }
  .brief-card h4 { font-size: var(--mk-fs-emphasis); }
  .brief-card__note { font-size: var(--mk-fs-micro); }
  .feed__empty { font-size: var(--mk-fs-micro); }
  .feed li strong { font-size: var(--mk-fs-micro); }
  .feed li span { font-size: var(--mk-fs-micro); }
  .feed--full li strong { font-size: var(--mk-fs-micro); }



  .usage__label { font-size: var(--mk-fs-micro); }
  .usage__row { font-size: var(--mk-fs-micro); }
}

/* ================= 暗色模式（D1）：总览页硬编码浅色覆写 ================= */
html[data-theme='dark'] {
  .brief-card { background: #19191a; }
  .ov-skill__track, .usage__bar-track { background: #2a2b2d; }
  .ov-skill:hover, .usage__row--clickable:hover, .feed__item:hover { background: #252627; }
  .feed__item--bad:hover { background: #2a1414; }
  .feed__item--warn:hover { background: #2a2410; }
  .brief-card__go:hover { background: rgba(91, 141, 239, 0.14); }
  /* 品牌渐变已 token 化（批23），暗色随 --mk-blue 自动翻转，无需覆写 */

  .ov-skill__rank { background: #232325; }
  .feed__dot { background: #4d4e51; box-shadow: 0 0 0 3px #19191a; }
  .ov-skill:nth-child(1) .ov-skill__rank { background: rgba(91, 141, 239, 0.22); color: var(--mk-ghost-fg); }
}
</style>
