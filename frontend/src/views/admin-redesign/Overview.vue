<template>
  <div v-if="data" class="mk-page">
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

      <!-- 系统脉搏 -->
      <section class="brief-card">
        <div class="brief-card__head">
          <h4>24h 系统脉搏</h4>
          <!-- 「执行日志 →」原与下方趋势卡同文案同屏重复，按各自时间窗差异化 -->
          <button type="button" class="brief-card__go" title="按时间窗查看 24h 调用与异常日志" @click="jump('execution-logs')">24h 日志 →</button>
        </div>
        <!-- 统一柱状语言（OvBars）：24 列稀标签、无数值行；红柱=该小时有异常 -->
        <OvBars v-if="data.pulse.length" :cols="pulseCols" :show-nums="false" :label-every="4" :min-bars-height="96" />
        <div class="pulse__meta">
          <span title="近 24 小时调用量（滚动窗口，仅真实用户）">24h 调用 <strong>{{ data.totalCalls }}</strong></span>
          <span title="近 24 小时失败 + 超时合计（仅真实用户）">异常 <strong :class="{ 'is-bad': data.totalIssues > 0 }">{{ data.totalIssues }}</strong></span>
          <span title="近 24 小时调用高峰时段（仅真实用户）">高峰 {{ data.peak }}</span>
        </div>
      </section>

      <!-- 近 7 天调用趋势（G1：每日调用/失败，真实用户口径） -->
      <section class="brief-card brief-card--trend">
        <div class="trend__head">
          <h4 title="近 7 天每日调用量（真实用户口径）">调用趋势 · 近 7 天</h4>
          <button type="button" class="brief-card__go" title="按时间窗查看近 7 天调用与失败日志" @click="jump('execution-logs')">7 天日志 →</button>
        </div>
        <div v-if="trend7dSum > 0" class="ov-trend">
          <OvBars :cols="trend7dCols" :min-bars-height="104" />
          <p class="ov-trend__sum">合计 {{ trend7dSum.toLocaleString() }} 次调用 · 失败 {{ trend7dFail.toLocaleString() }} 次</p>
        </div>
        <p v-else class="brief-card__note">近 7 天暂无真实调用。</p>
      </section>

      <!-- 用户增长（G2/G3：每日新增注册 / 活跃用户，与调用趋势同属 7 天趋势区） -->
      <section class="brief-card brief-card--trend">
        <div class="trend__head">
          <h4 title="近 7 天每日新增注册 / 活跃用户（真实用户）">用户增长 · 近 7 天</h4>
          <button type="button" class="brief-card__go" @click="jump('people')">用户与学习者 →</button>
        </div>
        <div v-if="growthSum > 0" class="ov-growth">
          <OvBars :cols="growthCols" :min-bars-height="72" />
          <div class="ov-growth__legend">
            <span><i class="ov-growth__dot ov-growth__dot--new"></i>新增</span>
            <span><i class="ov-growth__dot ov-growth__dot--active"></i>活跃</span>
            <span class="mk-card__meta">7 天新增 {{ growthNewSum }} · 活跃峰值 {{ growthPeakActive }}</span>
          </div>
        </div>
        <p v-else class="brief-card__note">近 7 天暂无新增或活跃用户。</p>
      </section>

      <!-- 近 7 天目标对话趋势（与调用/用户增长同属趋势区） -->
      <section class="brief-card brief-card--trend">
        <div class="trend__head">
          <h4 title="每日新增目标对话 vs 当天完成（近 7 天）">目标对话 · 新增与完成</h4>
          <span class="trend__head-right">
            <span class="trend__legend">
              <i class="trend__dot trend__dot--new"></i>当日新增
              <i class="trend__dot trend__dot--done"></i>当日完成
            </span>
            <button type="button" class="brief-card__go" @click="jump('goal-conversations')">目标对话 →</button>
          </span>
        </div>
        <OvBars v-if="data.trend.length" :cols="trendCols" :min-bars-height="88" />
        <p v-else class="brief-card__note">近 7 天暂无新增目标对话。</p>
        <p v-if="data.trend.length" class="trend__sum">
          合计新增 {{ trendSum.total }} · 完成 {{ trendSum.completed }}
        </p>
        <!-- 累计口径收编自「学习漏斗」卡（走查 2026-09-27 撤卡）：假漏斗（1:N 展开配 ×倍数）只留真指标
             ——任务完成率。任务 1:N 于路径属正常，不显示路径/任务的倍数 -->
        <p v-if="cum.tasks !== '—'" class="trend__cum" title="累计口径：任务完成率 = 完成任务 / 任务总数">
          累计 {{ cum.conversations }} 对话 · {{ cum.paths }} 路径 · 任务完成 {{ cum.done }}/{{ cum.tasks }}（{{ cum.doneRate }}）
        </p>
      </section>

      <!-- Top Skill 卡移至 LLM 用量卡之后（2026-09-27 三卡整改：与动态同排，grid 无空洞） -->

      <!-- 学习漏斗卡已撤（走查 2026-09-27）：用户→对话→路径→任务是 1:N 展开不是转化，
           ×倍数无信息量；真指标（任务完成率）收编进上方「目标对话」卡的累计行 -->

      <!-- LLM 用量与失败归因（跨 2 列；头部时间窗 + 数据即跳转入口） -->
      <section class="brief-card brief-card--wide2">
        <div class="brief-card__head brief-card__head--usage">
          <h4 title="近 7 天（滚动窗口）">LLM 用量与失败归因</h4>
          <span class="brief-card__meta">近 7 天</span>
        </div>
        <div v-if="usageHasData" class="usage">
          <!-- Hero：Token 总量 + 调用/失败 双辅助指标（均为执行日志快捷入口） -->
          <div class="usage__hero">
            <button type="button" class="usage__stat usage__stat--big" title="近 7 天真实用户 Token 消耗 · 查看执行日志" @click="jump('execution-logs')">
              <span class="usage__stat-label">Token 消耗</span>
              <strong>{{ fmtTokens(data.usage.totalTokens7d) }}</strong>
              <span class="usage__stat-sub">仅真实用户<template v-if="usageFullDiffers"> · 全量 {{ fmtTokens(data.usage.totalTokens7dAll ?? 0) }}</template></span>
            </button>
            <i class="usage__hero-sep" aria-hidden="true"></i>
            <button type="button" class="usage__stat" title="近 7 天调用次数 · 查看执行日志" @click="jump('execution-logs')">
              <span class="usage__stat-label">调用</span>
              <strong>{{ data.usage.calls7d.toLocaleString() }}</strong>
              <span class="usage__stat-sub">次</span>
            </button>
            <button
              type="button"
              class="usage__stat"
              :class="{ 'usage__stat--bad': data.usage.failed7d > 0 }"
              title="近 7 天失败次数 · 查看失败执行日志"
              @click="jump('execution-logs')"
            >
              <span class="usage__stat-label">失败</span>
              <strong>{{ data.usage.failed7d.toLocaleString() }}</strong>
              <span class="usage__stat-sub">次<template v-if="usageFailRate"> · 失败率 {{ usageFailRate }}</template></span>
            </button>
          </div>
          <div class="usage__cols">
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
              <!-- 与左侧「模型用量」同款行+条形：同一张卡里只保留一种图表语言 -->
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
        </div>
        <p v-else class="brief-card__note">近 7 天暂无 LLM 调用记录。</p>
      </section>

      <!-- Top Skill 活跃榜（G4：近 7 天调用最多的节点；1001-1280 档跨满整行，见媒体查询） -->
      <section class="brief-card brief-card--skills">
        <div class="brief-card__head">
          <h4 title="近 7 天调用最多的 Skill（真实用户口径）">Top Skill · 近 7 天</h4>
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

      <!-- 动态时间线（宽 2/3：与 Top Skill 同排；异常事件置顶，普通事件折叠，近 24h 时间窗。
           原全宽每行只填 ~40%，收窄后右侧不再有大片空行） -->
      <section class="brief-card brief-card--feed brief-card--wide2">
        <div class="brief-card__head brief-card__head--feed">
          <h4>动态 · 近 24h<span v-if="lastUpdated" class="feed-fresh">更新于 {{ lastUpdated }}</span><span v-if="overviewStale" class="feed-fresh feed-fresh--stale" role="status">刷新失败，展示上次数据</span></h4>
          <label class="feed-filter">
            <input type="checkbox" v-model="hideTestAccounts" />
            <span>隐藏模拟账号</span>
          </label>
        </div>
        <template v-if="anomalyFeed.length">
          <ul class="feed feed--full">
            <li
              v-for="(f, i) in anomalyFeed"
              :key="`a${i}`"
              class="feed__item"
              :class="`feed__item--${f.tone}`"
              :title="`查看 ${f.errorCategory || '失败'} 类别日志（近 7 天）`"
              role="button"
              tabindex="0"
              @click="feedJump(f)"
              @keydown.enter.prevent="feedJump(f)"
              @keydown.space.prevent="feedJump(f)"
            >
              <span class="feed__dot" :class="`feed__dot--${f.tone}`"></span>
              <div class="feed__body">
                <strong>{{ f.text }}</strong>
                <span>{{ f.time }}</span>
              </div>
              <i class="feed__go">排查 →</i>
            </li>
          </ul>
          <button v-if="normalFeed.length" type="button" class="feed__toggle" @click="showNormalEvents = !showNormalEvents">
            {{ showNormalEvents ? '收起普通事件' : `普通事件 ${normalFeed.length} 条` }}
          </button>
          <ul v-if="showNormalEvents" class="feed feed--full">
            <li v-for="(f, i) in normalFeed" :key="`n${i}`">
              <span class="feed__dot" :class="`feed__dot--${f.tone}`"></span>
              <div>
                <strong>{{ f.text }}</strong>
                <span>{{ f.time }}</span>
              </div>
            </li>
          </ul>
        </template>
        <ul v-else-if="normalFeed.length" class="feed feed--full">
          <li v-for="(f, i) in normalFeed" :key="`n${i}`">
            <span class="feed__dot" :class="`feed__dot--${f.tone}`"></span>
            <div>
              <strong>{{ f.text }}</strong>
              <span>{{ f.time }}</span>
            </div>
          </li>
        </ul>
        <p v-else-if="data.feed.length" class="feed__empty">近期动态均为模拟账号，取消「隐藏模拟账号」即可查看。</p>
        <p v-else class="feed__empty">近 24h 暂无动态。</p>
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
const dayLabel = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
};
const pulseMax = computed(() => Math.max(1, ...(data.value?.pulse.map((b) => b.calls) || [])));
const pulseCols = computed(() => (data.value?.pulse || []).map((b) => ({
  key: b.label || `h-${b.calls}-${b.issue}`,
  label: b.label || '',
  title: `${b.label || '该时段'}：调用 ${b.calls} 次 · 异常 ${b.issue} 次`,
  bars: [{ pct: barPct(b.calls, pulseMax.value), tone: b.issue > 0 ? ('red' as const) : ('blue' as const) }],
})));

const trend7dMax = computed(() => Math.max(1, ...(data.value?.trend7d.map((d) => d.calls) || [])));
const trend7dCols = computed(() => (data.value?.trend7d || []).map((d) => ({
  key: d.date,
  label: dayLabel(d.date),
  today: isToday(d.date),
  title: `${d.date}：调用 ${d.calls.toLocaleString()} 次 · 失败 ${d.failed.toLocaleString()} 次`,
  num: d.calls.toLocaleString(),
  bars: [
    { pct: barPct(d.calls, trend7dMax.value), tone: 'blue' as const },
    { pct: barPct(d.failed, trend7dMax.value), tone: 'amber' as const },
  ],
})));

const growthCols = computed(() => (data.value?.growth7d || []).map((g) => ({
  key: g.date,
  label: dayLabel(g.date),
  today: isToday(g.date),
  title: `${g.date}：新增 ${g.newUsers} · 活跃 ${g.activeUsers}`,
  num: String(g.newUsers || 0),
  bars: [
    { pct: barPct(g.newUsers, growth7dMax.value), tone: 'blue' as const },
    { pct: barPct(g.activeUsers, growth7dMax.value), tone: 'green' as const },
  ],
})));

const trendCols = computed(() => (data.value?.trend || []).map((d) => ({
  key: d.date,
  label: isToday(d.date) ? '今日' : trendLabel(d.date),
  today: isToday(d.date),
  title: `${d.date}：新增 ${d.total} 个对话，完成 ${d.completed} 个`,
  num: String(d.total || 0),
  bars: [
    { pct: trendH(d.total), tone: 'blue' as const },
    { pct: trendH(d.completed), tone: 'green' as const },
  ],
})));
const trend7dSum = computed(() => (data.value?.trend7d || []).reduce((a, d) => a + d.calls, 0));
const trend7dFail = computed(() => (data.value?.trend7d || []).reduce((a, d) => a + d.failed, 0));
const growth7dMax = computed(() => Math.max(1, ...(data.value?.growth7d || []).flatMap((g) => [g.newUsers, g.activeUsers])));
const growthSum = computed(() => (data.value?.growth7d || []).reduce((a, g) => a + g.newUsers + g.activeUsers, 0));
const growthNewSum = computed(() => (data.value?.growth7d || []).reduce((a, g) => a + g.newUsers, 0));
const growthPeakActive = computed(() => Math.max(0, ...(data.value?.growth7d || []).map((g) => g.activeUsers)));
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
const usageFullDiffers = computed(() => {
  const u = data.value?.usage;
  if (!u || !u.totalTokens7dAll || !u.calls7dAll) return false;
  return u.totalTokens7dAll > u.totalTokens7d || u.calls7dAll > u.calls7d;
});
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
const trendMax = computed(() => Math.max(1, ...(data.value?.trend.map((d) => d.total) || [])));
const trendH = (n: number) => `${n > 0 ? Math.max((n / trendMax.value) * 100, 10) : 4}%`;
const trendLabel = (date: string) => {
  const m = String(date).match(/\d{2}-\d{2}$/);
  return m ? m[0] : String(date).slice(5);
};
// 与后端 UTC 切日同口径；后端日期为 MM-DD 短格式，兼容匹配（computed：跨午夜后仍正确）
const todayStr = computed(() => new Date().toISOString().slice(0, 10));
const isToday = (date: string) => date === todayStr.value || date === todayStr.value.slice(5);
const trendSum = computed(() => {
  const trend = data.value?.trend || [];
  const total = trend.reduce((a, d) => a + d.total, 0);
  const completed = trend.reduce((a, d) => a + d.completed, 0);
    return { total, completed };
});
/* 累计口径（收编自已撤的「学习漏斗」卡，走查 2026-09-27）：漏斗的 ×倍数是 1:N 展开不是
   转化率，无信息量；只保留真指标——任务完成率（完成任务/任务总数）。下标与后端 funnel
   数组顺序耦合：0 用户 / 1 目标对话 / 2 路径 / 3 任务 / 4 完成 */
const cum = computed(() => {
  const f = data.value?.funnel ?? [];
  const v = (i: number) => f[i]?.value ?? '—';
  return { conversations: v(1), paths: v(2), tasks: v(3), done: v(4), doneRate: data.value?.rates?.[3] ?? '—' };
});
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
/* 异常事件置顶（后端已按 bad/warn → ok/muted 排序），普通事件折叠 */
const anomalyFeed = computed(() => testFilteredFeed.value.filter((f) => f.tone === 'bad' || f.tone === 'warn').slice(0, 6));
const normalFeed = computed(() => testFilteredFeed.value.filter((f) => f.tone !== 'bad' && f.tone !== 'warn').slice(0, 8));
const showNormalEvents = ref(false)
// 开关切换 → 后端按 excludeTest 重新拉取动态。
// refreshLiveOverview 内部有 liveLoading 守卫（初始加载中会吞请求），这里用
// pending 标志 + liveLoading 回落 watch 保证开关一定生效（last-wins，只重拉一次）
let pendingOverviewReload = false
async function refreshOverviewQueued() {
  if (liveLoading.value) {
    pendingOverviewReload = true
    return
  }
  pendingOverviewReload = false
  await refreshLiveOverview()
}
watch(hideTestAccounts, () => {
  void refreshOverviewQueued()
})
watch(liveLoading, (loading) => {
  if (!loading && pendingOverviewReload) {
    pendingOverviewReload = false
    void refreshLiveOverview()
  }
})
</script>

<style scoped>
/* 页面容器已统一走 .mk-page（shared.css）：容器级 padding/边距/超大屏 max-width 封顶随全站规范 */
/* live 数据不可用时的空态 */

/* 教学闭环卡通栏（原型 .loop 在总览占整行；wide2 只跨 2 列不够它用） */
.brief-card--full { grid-column: 1 / -1; }

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
/* 跨 2 列：LLM 用量卡填 row3 空洞 */
.brief-card--wide2 { grid-column: span 2; }
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
.brief-card__head--feed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.feed-filter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  cursor: pointer;
  user-select: none;
}
.feed-filter input {
  margin: 0;
  accent-color: var(--mk-blue, #2c63d0);
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
.ov-trend { display: grid; gap: 8px; flex: 1; min-height: 0; align-content: end; }
.ov-trend__sum { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }

/* Top Skill 排行 */
.ov-skills { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.ov-skill {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 64px auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--mk-radius-sm);
  cursor: pointer;
  transition: background 0.12s ease;
}
.ov-skill:hover { background: var(--mk-btn-hover-bg); }
.ov-skill__rank {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
}
.ov-skill:nth-child(1) .ov-skill__rank { background: #dbeafe; color: var(--mk-accent-deep, var(--mk-accent-deep)); }
.ov-skill__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); }
.ov-skill__track { height: 6px; border-radius: var(--mk-radius-pill); background: #f0f3f9; overflow: hidden; }
.ov-skill__bar { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: linear-gradient(90deg, color-mix(in srgb, var(--mk-blue) 72%, white), var(--mk-blue)); }
.ov-skill__calls { font-size: var(--mk-fs-micro); color: var(--mk-muted); text-align: right; white-space: nowrap; }
.ov-skill__fail { font-style: normal; color: var(--mk-amber); font-weight: 700; }

/* 用户增长（新增/活跃双柱）：柱区走 OvBars 统一组件，这里只留图例 */
.ov-growth { display: grid; gap: 8px; flex: 1; min-height: 0; align-content: end; }
.ov-growth__legend { display: flex; align-items: center; gap: 12px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ov-growth__legend .mk-card__meta { margin-left: auto; }
.ov-growth__dot { width: 7px; height: 7px; border-radius: var(--mk-radius-xs); display: inline-block; margin-right: 4px; }
.ov-growth__dot--new { background: var(--mk-blue); }
.ov-growth__dot--active { background: var(--mk-green); }

/* LLM 用量与失败归因 */
.usage { display: grid; gap: 14px; }
/* Hero：Token 总量主角 + 调用/失败 辅指标（横向一排，均可点击跳执行日志） */
.usage__hero {
  display: flex;
  align-items: stretch;
  gap: 18px;
  padding: 12px 16px;
  border-radius: 12px;
  background: linear-gradient(180deg, #f7faff, #fbfcff);
  border: 1px solid #e8edf9;
  position: relative;
}
.usage__stat {
  display: grid;
  gap: 1px;
  justify-items: start;
  border: 0;
  background: transparent;
  padding: 2px 0;
  cursor: pointer;
  text-align: left;
  border-radius: var(--mk-radius-sm);
}
.usage__stat:hover { background: rgba(44, 99, 208, 0.06); }
.usage__stat-label {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mk-faint);
}
.usage__stat strong {
  font-size: var(--mk-fs-20);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
  line-height: 1.2;
}
.usage__stat--big strong { font-size: 26px; }
.usage__stat--bad strong { color: var(--mk-red); }
.usage__stat-sub { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.usage__hero-sep { width: 1px; align-self: center; height: 34px; background: var(--mk-line); flex-shrink: 0; }
/* 模型用量 / 失败原因 横向两栏（宽卡内避免纵向长串） */
.usage__cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
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
.brief-card--trend { display: flex; flex-direction: column; }
.brief-card--trend .ovbars { flex: 1; min-height: 0; }
.trend__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.trend__head-right { display: inline-flex; align-items: center; gap: 12px; }
.trend__legend { display: inline-flex; align-items: center; gap: 8px; font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }
.trend__dot { width: 7px; height: 7px; border-radius: var(--mk-radius-xs); display: inline-block; margin-right: 3px; }
.trend__dot--new { background: linear-gradient(180deg, color-mix(in srgb, var(--mk-blue) 72%, white), var(--mk-blue)); }
.trend__dot--done { background: linear-gradient(180deg, #34d399, var(--mk-green)); }
.trend__sum { margin: 0; padding-top: 8px; border-top: 1px dashed var(--mk-line); font-size: var(--mk-fs-micro); color: var(--mk-muted); font-variant-numeric: tabular-nums; }
/* 累计行（收编自学习漏斗卡）：与合计行同族，弱一档 */
.trend__cum { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 柱区/数字/日期已由 OvBars 统一组件承担（2026-09-27 四图收敛），仅保留卡头图例与合计/累计行 */

/* 漏斗卡已撤（2026-09-27）：1:N 展开配 ×倍数是假漏斗，真指标在目标对话卡累计行 */

/* 脉搏（ECharts 图表；仅保留 meta 行样式） */
.pulse__meta {
  display: flex;
  gap: 16px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.pulse__meta strong { color: var(--mk-ink); font-variant-numeric: tabular-nums; }
/* 异常计数：琥珀色（与异常柱同语义，区别于"失败/需处理"的告警红） */
.pulse__meta strong.is-bad { color: var(--mk-amber); }

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
.feed__toggle {
  align-self: flex-start;
  padding: 4px 12px;
  border: 1px dashed var(--mk-line);
  border-radius: 999px;
  background: transparent;
  color: var(--mk-muted);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  cursor: pointer;
  transition: 0.12s ease;
}
.feed__toggle:hover { border-color: rgba(44, 99, 208, 0.45); color: var(--mk-blue); background: var(--mk-btn-hover-bg); }

@media (max-width: 1280px) and (min-width: 1001px) {
  /* 中等宽度：三列过渡为两列，KPI 2+2 换行，动态卡占整行 */
  .brief-grid { grid-template-columns: 1fr 1fr; }
  .brief-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .brief-card--feed { grid-column: 1 / -1; }
  /* Top Skill 也跨满整行：两列档里它只占 1 列时，span2 的动态卡放不进剩余 1 列，
     会在 Top Skill 行的右列留下空洞 */
  .brief-card--skills { grid-column: 1 / -1; }
  .usage__cols { grid-template-columns: 1fr; }
}

@media (max-width: 1000px) {
  .brief-grid { grid-template-columns: 1fr; }
  .brief-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* 4K：卡片字号放大（KPI 卡已组件化为 MkKpi，4K 档在组件内；容器随全站 mk-page 全宽） */
@media (min-width: 2000px) {
  .brief-card { padding: 20px 24px; }
  .brief-card h4 { font-size: var(--mk-fs-micro); }
  .brief-card__note { font-size: var(--mk-fs-body); }
  .feed-filter { font-size: var(--mk-fs-micro); }
  .feed__empty { font-size: var(--mk-fs-body); }
  .feed li strong { font-size: var(--mk-fs-body); }
  .feed li span { font-size: var(--mk-fs-micro); }
  .feed--full li strong { font-size: var(--mk-fs-body); }



  .usage__label { font-size: var(--mk-fs-micro); }
  .usage__row { font-size: var(--mk-fs-body); }
  .trend__legend { font-size: var(--mk-fs-micro); }
  .trend__sum { font-size: var(--mk-fs-body); }
  .pulse__meta { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .brief-card { padding: 24px 30px; }
  .brief-card h4 { font-size: var(--mk-fs-micro); }
  .brief-card__note { font-size: var(--mk-fs-body); }
  .feed-filter { font-size: var(--mk-fs-micro); }
  .feed__empty { font-size: var(--mk-fs-body); }
  .feed li strong { font-size: var(--mk-fs-body); }
  .feed li span { font-size: var(--mk-fs-micro); }
  .feed--full li strong { font-size: var(--mk-fs-body); }



  .usage__label { font-size: var(--mk-fs-micro); }
  .usage__row { font-size: var(--mk-fs-micro); }
  .trend__legend { font-size: var(--mk-fs-micro); }
  .trend__sum { font-size: var(--mk-fs-micro); }
  .pulse__meta { font-size: var(--mk-fs-body); }
}
/* 3600+（zoom 1.3 档）：卡片延续 2800 放大节奏（约 1.17×），补齐 2000/2800 未覆盖的卡片内文字（feed/pulse/trend/usage）
   注：本档 px 是"除过 zoom 1.3"的补偿值（2800 档生效时壳层 zoom 1.15）。
   2026-09-24 桌面端验收：5 处补偿不足，有效字号反而小于 2800 档，已上调到 ≥ 2800 的有效值；
   守卫见 scripts/check-design-system.mjs 规则 11（档位字号单调性，按 zoom 折算比较）。 */
@media (min-width: 3600px) {
  .brief-card { padding: 28px 36px; }
  .brief-card h4 { font-size: var(--mk-fs-emphasis); }
  .brief-card__note { font-size: var(--mk-fs-micro); }
  .feed-filter { font-size: var(--mk-fs-micro); }
  .feed__empty { font-size: var(--mk-fs-micro); }
  .feed li strong { font-size: var(--mk-fs-micro); }
  .feed li span { font-size: var(--mk-fs-micro); }
  .feed--full li strong { font-size: var(--mk-fs-micro); }



  .usage__label { font-size: var(--mk-fs-micro); }
  .usage__row { font-size: var(--mk-fs-micro); }
  .trend__legend { font-size: var(--mk-fs-micro); }
  .trend__sum { font-size: var(--mk-fs-micro); }
  .pulse__meta { font-size: var(--mk-fs-micro); }
}

/* ================= 暗色模式（D1）：总览页硬编码浅色覆写 ================= */
html[data-theme='dark'] {
  .brief-card { background: #19191a; }
  .ov-skill__track, .usage__bar-track { background: #2a2b2d; }
  .ov-skill:hover, .usage__row--clickable:hover, .feed__item:hover { background: #252627; }
  .feed__item--bad:hover { background: #2a1414; }
  .feed__item--warn:hover { background: #2a2410; }
  .usage__hero { background: linear-gradient(180deg, #19191a, #19191a); border-color: #2a2b2d; }
  .usage__hero-sep { background: #2a2b2d; }
  .brief-card__go:hover { background: rgba(91, 141, 239, 0.14); }
  /* 品牌渐变已 token 化（批23），暗色随 --mk-blue 自动翻转，无需覆写 */

  .ov-skill__rank { background: #232325; }
  .feed__dot { background: #4d4e51; box-shadow: 0 0 0 3px #19191a; }
  .ov-skill:nth-child(1) .ov-skill__rank { background: rgba(91, 141, 239, 0.22); color: var(--mk-ghost-fg); }
  .feed__toggle:hover { background: #252627; }
}
</style>
