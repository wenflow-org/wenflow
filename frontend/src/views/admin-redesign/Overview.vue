<template>
  <div v-if="data" class="mk-page">
    <!-- 页头（原型 pageTitle）：面包屑管「我在哪」，页头管「这页是什么 + 主操作」 -->
    <MkPageHead title="平台总览" :sub="headSub">
      <template #actions>
        <!-- 刷新状态独立于副文：副文只放事实段（运行全景/数据截至/最近活动），
             避免长句在页头副文盒内断词换行（视觉走查 2026-10-03） -->
        <span
          class="ov-refresh-note"
          :class="{ 'ov-refresh-note--warn': autoRefreshStopped || overviewStale }"
          role="status"
        >{{ refreshNote }}</span>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="liveRefreshing" @click="refreshNow">
          {{ liveRefreshing ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>

    <!-- KPI（原型 .grid auto-fit 210 + .card.kpi）：label 12 / 数值 28 / ▲▼趋势 foot。
         趋势口径 = 昨日同时刻窗口（后端 overview/stats 基线字段），口径注释进悬停 tooltip。 -->
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
            <span v-if="k.trend" class="trend" :class="k.trend.up ? 'trend--up' : 'trend--down'">{{ k.trend.up ? '▲' : '▼' }} {{ k.trend.pct }}</span>
            <span class="kpi-note">{{ k.foot }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 系统状态（原型 .statusbar）：点色=结论、粗体=标题、meta=子项、右端=动作。
          密度优化（2026-10-03）：原来「结论 + 异常项（长句） + 健康/仿真/总结 + 动作」全挤一条，
          且 .mk-status__meta-link 的负外边距把 gap 吃光 → 读成一堵字墙。
          按「结论 / 明细」两层重组：
            行 1 = 结论（点 + 粗体标题）+ 右端动作出口；
            行 2 = 全部明细项（关注项 + 子系统状态），各带 22px 真实间隙、从属层。
          关注项文案较长（agentId + 采样窗口口径），与结论同行必然折行，故移入明细行。
          用显式列布局（--stack）而非 flex-basis:100% 换行：后者在 grid 行固有高度里
          百分比 basis 对不确定宽度解析失败，行高按单行 48px 定死、第二行溢出被裁
          （2026-10-03 实测 gridTemplateRows 该行 48px / scrollHeight 87px）。
          块序对齐原型 1353-1398：pagehead → KPI 栅格 → statusbar → 教学闭环卡。 -->
    <div class="mk-status ov-status--stack" :class="[`mk-status--${data.tone}`, `ov-status--${data.tone}`]">
      <div class="ov-row">
        <span class="mk-status__dot"></span>
        <span class="mk-status__title">{{ health.headline }}</span>
        <!-- 结论行的 __sep 已撤（明细项搬到第二行后，分隔线右侧无内容可分隔——
             裸评审 2026-10-03 实测为悬空 1×13px 竖线残留） -->
        <!-- subline（今日调用/失败）与 KPI 前两卡完全重复，不进状态条——
             1280 实测它会把「查看健康中心」动作挤换行（2026-10-01 视觉回顾） -->
        <div class="mk-status__actions">
          <button type="button" class="mk-status__action" @click="jump('health-center')">查看健康中心</button>
        </div>
      </div>
      <!-- 明细行：关注项（agent 失败）+ 子系统状态（健康/仿真/总结），各带真实间隙 -->
      <div class="ov-row ov-subs">
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
          :title="healthTitle"
          @click="healthChipClick"
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
          <button
            v-if="loopFailedPaths"
            type="button"
            class="pill pill--warn pill--link"
            title="进行中路径里的失败数 · 点击查看失败路径"
            @click="jumpToFailedPaths"
          ><span class="pill__dot"></span>路径失败 {{ loopFailedPaths }}</button>
        </span>
      </div>
      <div class="card__body">
        <div class="loop">
          <template v-for="(s, i) in loopStages" :key="s.name">
            <span v-if="i" class="loop__arrow" aria-hidden="true">→</span>
            <div
              class="loop__step"
              :class="`loop__step--${s.tone}`"
              role="button"
              tabindex="0"
              :title="s.title"
              @click="jump(s.scene)"
              @keydown.enter.prevent="jump(s.scene)"
              @keydown.space.prevent="jump(s.scene)"
            >
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
          <!-- P1#2：手写 .barchart 无「今日进行中」语义（清晨当日累计尚小 → 柱高塌陷读成活跃崩塌），
               换全站统一 OvBars：零值「·」+ 今日列高亮内建；今日列 title 补「截至现在」防误读。 -->
          <OvBars :cols="barchartCols" :bar-width="40" :min-bars-height="120" />
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
          <p v-if="!feedRows.length && data.feed.length" class="note">近期动态均为测试/模拟/探针账号（默认隐藏）。</p>
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
              @click="openSubPage('skill', s.agentId)"
              @keydown.enter.prevent="openSubPage('skill', s.agentId)"
              @keydown.space.prevent="openSubPage('skill', s.agentId)"
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
          <span v-if="todoItems.length" class="pill pill--warn"><span class="pill__dot"></span>{{ todoItems.length }}</span>
        </div>
        <div class="card__body">
          <div class="ranklist">
            <div v-for="t in todoItems" :key="t.key" class="rankrow rankrow--todo">
              <!-- 主行 + 口径副行（拆分见 todoItems）：长句不再一行堆满 -->
              <div class="todo-main">
                <span class="todo-text" :title="t.text">{{ t.main }}</span>
                <span v-if="t.note" class="todo-note">{{ t.note }}</span>
              </div>
              <button type="button" class="mk-btn mk-btn--sm" @click="t.action()">{{ t.actLabel }} →</button>
            </div>
          </div>
          <p v-if="!todoItems.length" class="note">没有待处理的事项。</p>
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
import { overviewHealth, investigateAgent, intent, dataSource, openSubPage } from './store';
import {
  liveOverviewFull, overviewHideTest, refreshLiveOverview, liveLoading, liveRefreshing,
  liveVirtualRunStats, liveVirtualStatsError, liveVirtualStatsLoaded,
  recentActivityText, type LiveOverviewFull
} from './live';
import { errorCategoryText } from './statusText';
import OvBars from './OvBars.vue';
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
/** P2 异常→动作闭环：五环各接深链（跳目标页 scene），点击行为与 title 同步披露 */
interface LoopStage { name: string; meta: string; val: string; tone: 'active' | 'done' | 'alert'; title: string; scene: string }
const loopStages = computed<LoopStage[]>(() => {
  const d = data.value;
  const evalOk = (d?.wrapup.evaluationModel ?? 0) + (d?.wrapup.evaluationAiFallback ?? 0);
  const pathsFailed = d?.loop.pathsFailed ?? 0;
  return [
    {
      name: '目标对话', meta: '澄清真实目标与约束',
      val: `${d?.loop.conversationsActive ?? 0} 进行中`, tone: 'active',
      title: '进行中的目标对话（overview/stats · 随轮询刷新）· 点击查看目标对话',
      scene: 'goal-conversations',
    },
    {
      // P2：失败环不再恒 done——有失败路径时转 alert（着色条件与计数随 title 披露）
      name: '路径规划', meta: '生成阶段化学习路径',
      val: `${d?.loop.pathsActive ?? 0} 进行中`, tone: pathsFailed > 0 ? 'alert' : 'done',
      title: `进行中路径 ${d?.loop.pathsActive ?? 0} · 失败 ${pathsFailed}（overview/stats · 随轮询刷新）· 点击查看学习路径`,
      scene: 'learning-paths',
    },
    {
      name: '教学回合', meta: '回合式讲解与追问',
      val: teachTotal.value == null ? '—' : `${teachTotal.value.toLocaleString()} 累计`, tone: 'done',
      title: '教学会话累计数（教学会话列表 total · 进页时拉取）· 点击查看教学会话',
      scene: 'teaching-sessions',
    },
    {
      name: '课后评估', meta: '产出与掌握度评估',
      val: `${evalOk} 份`, tone: 'done',
      title: `评估产出 ${evalOk} 份 · 失败 ${d?.wrapup.evaluationFailed ?? 0}（wrapup 样本口径 · 随轮询刷新）· 点击查看教学会话`,
      scene: 'teaching-sessions',
    },
    {
      name: '记忆复习', meta: '遗忘曲线调度复习',
      val: memDue.value == null ? '—' : `${memDue.value} 待办`,
      tone: (memDue.value ?? 0) > 0 ? 'alert' : 'done',
      title: '到期未复习的记忆条数（记忆与复盘 totals.due · 进页时拉取）· 点击查看记忆与复盘',
      scene: 'memory-review',
    },
  ];
});
const loopFailedPaths = computed(() => data.value?.loop.pathsFailed ?? 0);
/* P2 异常→动作闭环：路径失败 pill → 学习路径列表并落「失败」筛选（OpsContent 消费 intent.statusFilter） */
function jumpToFailedPaths() {
  intent.agentFilter = '';
  intent.traceId = '';
  intent.sessionId = '';
  intent.errorCategory = '';
  intent.timeRange = '';
  intent.tab = '';
  intent.statusFilter = 'failed';
  intent.scene = 'learning-paths';
}
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

/* 页头副文（原型 pageTitle p）：数据截至 + 刷新语义（P2 文案纠偏）。
   - 「数据截至」只绑定真实拉到数据的时刻（不再拿挂载时刻冒充；未拉到前不渲染该段）；
   - 「每 10s 自动刷新」改如实：失败指数退避至 60s，连续失败熔断后停止、需手动「刷新」恢复；
   - recency：由 live.ts 已映射的 24h 逐小时脉搏推「最近真实活动 HH:00（约 N 小时前）」。 */
const headSub = computed(() => {
  const parts: string[] = ['WenFlow 运行全景'];
  if (lastUpdated.value) parts.push(`数据截至 ${lastUpdated.value}`);
  const recency = recentActivityText(data.value?.pulse || []);
  if (recency) parts.push(recency);
  return parts.join(' · ');
});
/** 刷新状态贴「刷新」钮显示（熔断/展示旧数据=琥珀告警；正常=faint 一句） */
const refreshNote = computed(() =>
  autoRefreshStopped.value
    ? '自动刷新已停止，点「刷新」恢复'
    : overviewStale.value
      ? '展示上次成功数据'
      : '10s 自动刷新'
);
/* 手动刷新：成功即打点真实数据时刻；若此前已熔断停止轮询，一并如实恢复 */
function refreshNow() {
  void refreshOverviewTracked(true).then((ok) => {
    if (!ok) return;
    lastUpdated.value = nowHm();
    if (autoRefreshStopped.value) {
      autoRefreshStopped.value = false;
      // stop+start（useSafePolling.reset 在 isActive 时不重排定时器，需显式重启）
      stopAutoRefresh();
      startAutoRefresh();
    }
  });
}

/* ===== KPI（原型 .kpi）=====
   ▲▼趋势已恢复（2026-10-01）：基线改「昨日同时刻」等长窗口（后端 todayCallsBaseline/
   activeTodayBaseline），不再与昨日全日直接比——旧趋势 foot 因「今日进行中 vs 昨日全日」
   失真下线（凌晨 ▼-97% 实证），等的就是这个口径。口径注释（全量含虚拟/测试、总用户）
   退到悬停 tooltip（hint），foot 只留 超时/失败/新增 与基线说明。 */
interface KpiCard { label: string; value: string; foot: string; hint: string; trend?: { pct: string; up: boolean } }
const kpiCards = computed<KpiCard[]>(() =>
  (data.value?.kpis ?? []).map((k) => ({ label: k.label, value: k.value, foot: k.foot, hint: k.hint, trend: k.trend }))
);

/* ===== 近 7 天活跃学习者（OvBars 全站统一柱图语言，2026-10-02 P1#2）=====
   原手写 .barchart 无「今日进行中」语义：清晨当日累计尚小时柱高塌陷，读成「活跃崩塌」。
   OvBars 内建零值「·」与今日列高亮；今日列 label 改「今日」、title 补「截至现在（非全日）」。
   柱顶数值 = 活跃人数（主序列），新增人数保留在 title（口径与原手写版一致）。 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const todayKey = computed(() => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
});
const activeMax = computed(() => Math.max(1, ...(data.value?.growth7d.map((g) => g.activeUsers) || [])));
/** 与 TokenCost.trendCols 同规则：零值不画残影柱（0%），微值保底 6% 可见 */
const barPct = (v: number, max: number) => (v > 0 ? `${Math.max(Math.round((v / max) * 100), 6)}%` : '0%');
const barchartCols = computed(() => (data.value?.growth7d || []).map((g) => {
  const d = new Date(`${g.date}T00:00:00`);
  const active = g.activeUsers || 0;
  const isToday = g.date === todayKey.value;
  const cap = Number.isNaN(d.getTime()) ? g.date.slice(5) : WEEKDAYS[d.getDay()];
  return {
    key: g.date,
    label: isToday ? '今日' : cap,
    today: isToday,
    num: String(active),
    title: `${g.date}：活跃 ${active} 人 · 新增 ${g.newUsers}${isToday ? ' · 今日数据截至现在（非全日）' : ''}`,
    bars: [{ pct: barPct(active, activeMax.value), tone: 'blue' as const }],
  };
}));

/* 系统健康摘要：拉统一健康清单（60s 缓存），只取 warn/error 计数。
   P1#3 三态纪律：加载中 / 加载失败 / 空清单 / 有数据是四种不同事实，
   不得全部坍缩成「加载中」，更不能让「拉不到」冒充正常——失败态着弱琥珀并给重试出口。 */
const healthCheck = ref<{ total: number; warn: number; error: number } | null>(null);
const healthState = ref<'loading' | 'ready' | 'error' | 'empty'>('loading');
const healthTone = computed<Tone>(() => {
  if (healthState.value === 'error') return 'warn';
  if (healthState.value === 'empty') return 'muted';
  if (healthState.value !== 'ready' || !healthCheck.value) return 'muted';
  return healthCheck.value.error > 0 ? 'bad' : healthCheck.value.warn > 0 ? 'warn' : 'ok';
});
const healthText = computed(() => {
  if (healthState.value === 'error') return '加载失败（可重试）';
  if (healthState.value === 'empty') return '无检查项';
  if (healthState.value !== 'ready' || !healthCheck.value) return '健康检查加载中';
  if (healthCheck.value.error > 0) return `${healthCheck.value.error} 项异常`;
  if (healthCheck.value.warn > 0) return `${healthCheck.value.warn} 项需关注`;
  return `${healthCheck.value.total} 项检查全部正常`;
});
const healthTitle = computed(() => {
  if (healthState.value === 'error') return '健康检查清单加载失败 · 点击就地重试（完整清单走右侧「查看健康中心」）';
  if (healthState.value === 'empty') return '健康中心暂无检查项 · 点击查看健康中心';
  if (healthState.value === 'loading') return '健康检查加载中 · 点击查看健康中心';
  return '查看健康中心完整检查清单';
});
function healthChipClick() {
  // 失败态点击 = 就地重试（健康中心仍可从状态条右侧动作进入），兑现「可重试」承诺
  if (healthState.value === 'error') { void loadHealth(); return; }
  jump('health-center');
}
async function loadHealth() {
  try {
    const res = await adminHealthCenterApi.get()
    const items = res.data?.data?.items ?? []
    if (!items.length) {
      healthState.value = 'empty'
      return
    }
    healthCheck.value = {
      total: items.length,
      warn: items.filter((i) => i.severity === 'warn').length,
      error: items.filter((i) => i.severity === 'error').length,
    }
    healthState.value = 'ready'
  } catch {
    // 失败保留上次成功计数（不回置 null），状态转 error 如实呈现
    healthState.value = 'error'
  }
}
/* 仿真通道摘要：失败率用「系统失败率」；阈值 ≥50% 红、≥20% 或存在失败 黄、无会话灰。
   P1#3 同律：「未加载 / 加载失败」≠「空闲」——消费 live.ts P1#19 暴露的三态状态位，
   统计未落地前不渲染「仿真空闲」，失败态如实降级为需关注。 */
const runStats = liveVirtualRunStats
const simTone = computed<Tone>(() => {
  if (liveVirtualStatsError.value) return 'warn'
  if (!liveVirtualStatsLoaded.value) return 'muted'
  const r = runStats.value
  if (!r.totalSessions && !r.todayCalls) return 'muted'
  if (r.systemFailureRate >= 50) return 'bad'
  if (r.systemFailureRate >= 20 || r.failed > 0) return 'warn'
  return 'ok'
})
const simHeadline = computed(() => {
  if (liveVirtualStatsError.value) return '统计加载失败'
  if (!liveVirtualStatsLoaded.value) return '统计加载中'
  const r = runStats.value
  if (!r.totalSessions && !r.todayCalls) return '仿真空闲'
  if (r.systemFailureRate >= 20) return `需要关注：系统失败率 ${r.systemFailureRate}%`
  return '仿真运行平稳'
})
const simTitle = computed(() => {
  const parts: string[] = ['虚拟学习者 / 仿真通道健康度（仅虚拟/测试账号，与真实用户口径互斥）']
  if (liveVirtualStatsError.value) {
    parts.push(`统计加载失败：${liveVirtualStatsError.value}`, '进入「虚拟学习者」页可重试')
  } else if (!liveVirtualStatsLoaded.value) {
    parts.push('统计加载中…')
  } else {
    const r = runStats.value
    parts.push(
      `总会话 ${r.totalSessions}`,
      `已完成 ${r.completed}`,
      `系统失败 ${r.failed}`,
      `人为终止 ${r.abandoned}`,
      `进行中 ${r.running}`
    )
  }
  parts.push('点击进入「虚拟学习者」')
  return parts.join(' · ')
})

const hasWrapupStats = computed(() => {
  const w = data.value?.wrapup;
  if (!w) return false;
  return w.summaryModel > 0 || w.summaryFallback > 0 || w.evaluationModel > 0 || w.evaluationAiFallback > 0 || w.evaluationFailed > 0;
});

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
  if (ok) lastUpdated.value = nowHm()
}

// 动态筛选：默认隐藏虚拟学习者与测试/审计账号（后端 excludeTest 已按此过滤）
const hideTestAccounts = overviewHideTest
// KPI 目标：今日调用 / 今日成功率 / 用户活跃 / 进行中对话（纯真实口径 4 卡）
const kpiTargets: Array<{ scene: string; tab?: string }> = [
  { scene: 'execution-logs' },
  { scene: 'execution-logs' },
  { scene: 'people' },
  { scene: 'goal-conversations' }
]

function kpiTitle(i: number): string {
  // 口径说明随数据来（live.ts kpis.hint），前端只补跳转动作
  const hint = kpiCards.value[i]?.hint || ''
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
  // 首层不裸透英文枚举（P2）：provider_timeout → 「上游超时」；未知枚举回退原文
  if (f.errorCategory) return `失败类别 · ${errorCategoryText(f.errorCategory)}`
  return f.tone === 'bad' || f.tone === 'warn' ? '点击查看日志' : ''
}
function feedJump(f: { tone: string; errorCategory?: string }) {
  if (f.tone !== 'bad' && f.tone !== 'warn') return
  jumpToFailures(f.errorCategory || '')
}

/* 待处理事项（原型 Row B 第二卡）：与状态条同源，不另起口径。
   密度优化（2026-10-03）：text 里末尾括号是口径标注（「近 7 天 · 200 条采样」），
   与主句挤一行读着冗长 → 拆成主行 + 口径副行（副行弱化为 faint 小字）。
   只做展示层拆分，文案单一事实源仍在 live.ts。 */
interface TodoItem { key: string; text: string; main: string; note: string; tone: Tone; actLabel: string; action: () => void }
/** 拆末尾括号口径：「甲 采样窗口 1 次失败（近 7 天 · 200 条采样）」→ main/note */
function splitTodoNote(text: string): { main: string; note: string } {
  const m = text.match(/^(.*?)\s*[（(]([^（）()]+)[）)]\s*$/)
  return m ? { main: m[1], note: m[2] } : { main: text, note: '' }
}
const todoItems = computed<TodoItem[]>(() => {
  const items: TodoItem[] = [];
  for (const a of effectiveActions.value) {
    items.push({
      key: `a-${a.agentId}-${a.text}`,
      text: a.text,
      ...splitTodoNote(a.text),
      tone: a.tone,
      actLabel: '去排查',
      action: () => investigateAgent(a.agentId),
    });
  }
  const w = wrapupIssue.value;
  if (w) {
    items.push({ key: 'wrapup', text: w.text, ...splitTodoNote(w.text), tone: w.tone as Tone, actLabel: '教学会话', action: () => jump('teaching-sessions') });
  }
  return items;
});

/* R6：10s 自动刷新（setTimeout 链 + 并发守卫 + 指数退避 10s→60s + 熔断停止）。
   P2「更新于」假新鲜修复：只有确认拉到新数据才更新时间戳（数据截至 = 真实数据时刻）。 */
const lastUpdated = ref('')
const overviewStale = ref(false)
/** 熔断标记：连续失败停止轮询后必须如实告知（headSub 不再宣称「自动刷新中」） */
const autoRefreshStopped = ref(false)
const nowHm = () => new Date().toTimeString().slice(0, 5)
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
const { start: startAutoRefresh, stop: stopAutoRefresh } = useSafePolling(
  async () => {
    const ok = await refreshOverviewTracked()
    if (ok) lastUpdated.value = nowHm()
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
      autoRefreshStopped.value = true
      console.error(`[Overview] auto-refresh stopped after ${n} consecutive failures — backend may be down`)
    },
  }
)
onMounted(() => {
  void loadHealth()
  void loadLoopExtras()
  // 数据截至不预设挂载时刻：轮询首轮（immediate）成功拉到数据后由回调打点
  startAutoRefresh()
})
watch(dataSource, () => {
  lastUpdated.value = nowHm()
  startAutoRefresh()
})
</script>

<style scoped>
/* =====================================================================
   总览页 = newui「UI-分支优化设计」renderOverview 的逐类复刻。
   类名与原型一一对应（card/kpi/feed/ranklist/loop）；柱图已收敛到全站统一
   OvBars 组件（2026-10-02 P1#2，手写 .barchart 退役）。
   色与圆角全走 --mk-* token（数值与原型 --brand/--r-* 同源）。
   全局原语已覆盖的：页头（MkPageHead=pagehead）、状态条（mk-status=statusbar）、
   按钮（mk-btn=btn）。原型 row3 第三卡「学习状态分布」不落（后端暂无
   学习状态聚合口径，用户拍板不做顶替卡，row3 两卡排布，2026-10-01）。
   ===================================================================== */

/* ---- 页头刷新注记（贴「刷新」钮；熔断/旧数据=琥珀，正常=faint）---- */
.ov-refresh-note { flex: none; align-self: center; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.ov-refresh-note--warn { color: var(--mk-amber); font-weight: 600; }

/* ---- 页根 grid 行轨按内容定尺（密度优化 2026-10-03）----
   .mk-page 的 auto 行轨在本页会把状态条压到 min-height（两行内容实为 89.6px，行轨只给
   48px，第二行溢出被裁；实测 gridTemplateRows 该行 48px / scrollHeight 79px）。
   归因：auto 行轨按「最小贡献」定尺，嵌套 flex 内容的 max-content 未参与。
   内容型行轨一律 max-content（同编排图步骤卡判例）。仅本页生效，不动共享 .mk-page。 */
.mk-page { grid-auto-rows: max-content; }

/* ---- 状态条两行布局（密度优化 2026-10-03）----
   .ov-status--stack 覆盖基类的单行 flex：改纵向堆叠两行（结论行 / 子系统行），
   高度随内容自动（auto），不再被 grid 行固有高度按单行 48px 定死（见模板注释）。
   行 1 沿用基类的横排间距；行 2 与行 1 之间给 1px 分隔线 + 7px 起距。 */
.ov-status--stack { flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 0; }
.ov-status--stack .ov-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-height: 30px; }
.ov-status--stack .ov-subs { gap: 8px 22px; margin-top: 3px; padding-top: 7px; border-top: 1px solid var(--mk-line); }
/* 复原 .mk-status__meta-link 的负外边距（-6px 热区补偿会把本行 gap 吃成字墙）；
   本行间隙改由 .ov-subs 的 gap 真实给出 */
.ov-status--stack .ov-subs .mk-status__meta-link { margin: 0; }
/* 结论为 warn/bad 时给整条一层极淡同色底 + 同色描边（2026-10-03 用户反馈
   「重点预警不突出」）：白面状态条落在满页白卡之间，与「一切正常」无从区分，
   预警被读成背景。底色用既有 token（亮 #fffbeb/#fef2f2 · 暗 rgba 14%），
   与 .pill--warn / 闭环 alert 同一套语义色。
   只在本页生效——不写进共享 .mk-status，避免 20 个列表页的状态条一起换底色。 */
.ov-status--warn {
  background: var(--mk-amber-bg);
  border-color: color-mix(in srgb, var(--mk-amber) 30%, var(--mk-line));
}
.ov-status--bad {
  background: var(--mk-red-bg);
  border-color: color-mix(in srgb, var(--mk-red) 30%, var(--mk-line));
}

/* ---- KPI（.grid auto-fit 210 + .card.kpi）---- */
.kpigrid {
  /* flex 填满（2026-10-03 用户拍板「内容区随视口流式」）：同 .mk-kpi-grid，N 卡铺满整行不留空轨 */
  display: flex;
  flex-wrap: wrap;
  gap: var(--mk-space-4);
}
.kpigrid > * { flex: 1 1 210px; min-width: 0; }
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
.kpi__foot {
  display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted);
}
/* 注记整句不拆（1280 实测「…较昨日同」后「时刻」孤行、balance 又断在「·」前更碎）：
   空间不够时让 trend 与注记各自成行，注记保持完整；极端窄幅才截断 */
.kpi__foot .kpi-note { white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 趋势（原型 .trend：粗体 tabular；涨绿跌红） */
.trend { font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }
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
  padding: 12px 16px; border-bottom: 1px solid var(--mk-line);
}
.card__title { font-weight: 700; font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.card__sub { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.card__tools { margin-left: auto; display: flex; align-items: center; gap: 8px; }
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
/* 可点 pill（路径失败 → 学习路径「失败」筛选）：按钮元素需补字体继承与手型 */
.pill--link { cursor: pointer; font-family: inherit; }

/* ---- 闭环条（原型 .loop）---- */
.loop { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; padding: 4px 0; }
.loop__arrow { display: grid; place-items: center; flex: none; color: var(--mk-faint); font-size: var(--mk-fs-emphasis); }
.loop__step {
  flex: 1 1 0; min-width: 138px; display: grid; gap: 5px;
  padding: 12px 14px; border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg); background: var(--mk-surface);
  /* P2：五环可点穿（携 intent 深链跳目标页），交互 affordance 与 .card--kpi 同语言 */
  cursor: pointer;
}
.loop__step:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; }
.loop__step--active { border-color: var(--mk-blue); background: var(--mk-blue-bg); }
.loop__step--done { border-color: color-mix(in srgb, var(--mk-green) 34%, var(--mk-line)); }
.loop__step--alert { border-color: color-mix(in srgb, var(--mk-amber) 42%, var(--mk-line)); background: var(--mk-amber-bg); }
.loop__no { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.loop__name { font-weight: 700; font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.loop__meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.loop__val { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--mk-ink); }

/* ---- Row A：图（1.6fr）+ 事件（1fr）---- */
.row2 { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }

/* 最近事件（原型 .feed--capped：时间列 + 标题/描述，限高滚动）。
   底部 22px 渐隐（mask）提示「下面还有」：内滚区边界落在条目中间时会把最后可见条的
   副标题切半行，不加暗示会被读成「内容坏了」（裸评审 2026-10-03）。浅/深色均走 alpha 遮罩。 */
.feed--capped {
  display: grid; gap: 2px; max-height: 236px; overflow-y: auto; overscroll-behavior: contain;
  -webkit-mask-image: linear-gradient(180deg, black calc(100% - 22px), transparent);
  mask-image: linear-gradient(180deg, black calc(100% - 22px), transparent);
}
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
/* 待处理事项行（密度优化 2026-10-03）：主句 + 口径副行两行堆叠，动作钮跨两行右对齐 */
.rankrow--todo { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0 12px; }
.todo-main { display: grid; gap: 1px; min-width: 0; }
.todo-text {
  font-size: var(--mk-fs-micro); color: var(--mk-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.todo-note { font-size: var(--mk-fs-micro); color: var(--mk-faint); }

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
  .feed--capped { max-height: 132px; }
}
</style>
