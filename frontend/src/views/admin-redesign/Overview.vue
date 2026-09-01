<template>
  <div v-if="data" class="mk-page">
    <!-- 结论先行：今日简报 -->
    <header class="brief-head" :class="`brief-head--${data.tone}`">
      <div class="brief-head__verdict">
        <div class="brief-score-wrap">
          <div class="brief-score" :style="{ '--pct': data.score ?? 0 }" :title="scoreTitle">
            <svg viewBox="0 0 44 44">
              <circle class="brief-score__track" cx="22" cy="22" r="19" />
              <circle class="brief-score__bar" cx="22" cy="22" r="19" :stroke-dasharray="scoreDash" />
            </svg>
            <strong>{{ data.score ?? '—' }}</strong>
          </div>
          <span class="brief-score__cap">{{ TERMS.healthScore }}</span>
        </div>
        <div>
          <h3>{{ health.headline }}</h3>
          <p>{{ health.subline }}</p>
        </div>
      </div>
      <ul v-if="effectiveActions.length" class="brief-actions">
        <li v-for="(a, i) in effectiveActions" :key="i">
          <span class="brief-actions__dot" :class="`brief-actions__dot--${a.tone}`"></span>
          <span class="brief-actions__text">{{ a.text }}</span>
          <button type="button" class="brief-actions__btn" @click="investigateAgent(a.agentId)">
            去排查
          </button>
        </li>
      </ul>
      <p v-else class="brief-actions__clear">没有需要立即处理的事项。</p>
    </header>

    <!-- 系统健康摘要条（G 系列新增：13 项检查一瞥 + 跳转健康中心） -->
    <button
      type="button"
      class="ov-health"
      :class="`ov-health--${healthTone}`"
      :title="'查看健康中心完整检查清单'"
      @click="jump('health-center')"
    >
      <span class="ov-health__dot" aria-hidden="true"></span>
      <strong class="ov-health__title">{{ healthText }}</strong>
      <span class="ov-health__sub">系统健康 13 项检查 · 点击查看清单</span>
      <span class="brief-card__go">健康中心 →</span>
    </button>

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
          @click="jump(kpiTargets[i])"
        />
      </section>

      <!-- 系统脉搏 -->
      <section class="brief-card">
        <div class="brief-card__head">
          <h4>24h 系统脉搏</h4>
          <button type="button" class="brief-card__go" @click="jump('execution-logs')">执行日志 →</button>
        </div>
        <MkChart v-if="data.pulse.length" :option="pulseChartOption" height="150px" />
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
          <button type="button" class="brief-card__go" @click="jump('execution-logs')">执行日志 →</button>
        </div>
        <div v-if="trend7dSum > 0" class="ov-trend">
          <MkChart :option="trend7dChartOption" height="160px" />
          <p class="ov-trend__sum">合计 {{ trend7dSum }} 次调用 · 失败 {{ trend7dFail }} 次</p>
        </div>
        <p v-else class="brief-card__note">近 7 天暂无真实调用。</p>
      </section>

      <!-- 用户增长（G2/G3：每日新增注册 / 活跃用户，与调用趋势同属 7 天趋势区） -->
      <section class="brief-card brief-card--trend">
        <div class="trend__head">
          <h4 title="近 7 天每日新增注册 / 活跃用户（真实用户）">用户增长 · 近 7 天</h4>
          <button type="button" class="brief-card__go" @click="jump('users')">用户管理 →</button>
        </div>
        <div v-if="growthSum > 0" class="ov-growth">
          <div class="ov-growth__rows">
            <div v-for="g in data.growth7d" :key="g.date" class="ov-growth__day" :title="`${g.date}：新增 ${g.newUsers} · 活跃 ${g.activeUsers}`">
              <div class="ov-growth__bars">
                <i class="ov-growth__bar ov-growth__bar--new" :style="{ height: barPct(g.newUsers, growth7dMax) }"></i>
                <i class="ov-growth__bar ov-growth__bar--active" :style="{ height: barPct(g.activeUsers, growth7dMax) }"></i>
              </div>
              <span class="ov-growth__label">{{ dayLabel(g.date) }}</span>
            </div>
          </div>
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
          <h4>新增目标对话 · 近 7 天</h4>
          <span class="trend__head-right">
            <span class="trend__legend">
              <i class="trend__dot trend__dot--new"></i>当日新增
              <i class="trend__dot trend__dot--done"></i>当日完成
            </span>
            <button type="button" class="brief-card__go" @click="jump('goal-conversations')">目标对话 →</button>
          </span>
        </div>
        <div v-if="data.trend.length" class="trend">
          <div
            v-for="d in data.trend"
            :key="d.date"
            class="trend__col"
            :class="{ 'trend__col--today': isToday(d.date) }"
            :title="`${d.date}：新增 ${d.total} 个对话，完成 ${d.completed} 个`"
          >
            <span class="trend__num" :class="{ 'trend__num--zero': !d.total }">{{ d.total || '·' }}</span>
            <div class="trend__bars">
              <i class="trend__bar" :style="{ height: trendH(d.total) }"></i>
              <i class="trend__bar trend__bar--ok" :style="{ height: trendH(d.completed) }"></i>
            </div>
            <span class="trend__day" :class="{ 'trend__day--today': isToday(d.date) }">
              {{ trendLabel(d.date) }}{{ isToday(d.date) ? ' 今日' : '' }}
            </span>
          </div>
        </div>
        <p v-else class="brief-card__note">近 7 天暂无新增目标对话。</p>
        <p v-if="data.trend.length" class="trend__sum">
          合计新增 {{ trendSum.total }} · 完成 {{ trendSum.completed }}
        </p>
      </section>

      <!-- 总结产出质量 -->
      <section class="brief-card">
        <div class="brief-card__head">
          <h4 title="最近 50 次课后总结的生成质量分布">总结产出质量</h4>
          <span v-if="wrapupModelPct != null" class="wq__pct" :class="wrapupPctTone" :title="`${data.wrapup.summaryModel}/${data.wrapup.sampleSize} 次由模型直接生成`">
            {{ wrapupModelPct }}% 模型生成
          </span>
          <button type="button" class="brief-card__go" @click="jump('teaching-sessions')">教学会话 →</button>
        </div>
        <div v-if="data.wrapup.sampleSize > 0 && hasWrapupStats" class="wq">
          <div class="wq__row">
            <span class="wq__label">主题总结</span>
            <div class="wq__bars">
              <i class="wq__bar wq__bar--ok" :style="{ width: pct(data.wrapup.summaryModel, data.wrapup.sampleSize) }"></i>
              <i class="wq__bar wq__bar--warn" :style="{ width: pct(data.wrapup.summaryFallback, data.wrapup.sampleSize) }"></i>
            </div>
            <span class="wq__nums">{{ data.wrapup.summaryModel }} 模型 / {{ data.wrapup.summaryFallback }} 兜底</span>
          </div>
          <div class="wq__row">
            <span class="wq__label">表现分析</span>
            <div class="wq__bars">
              <i class="wq__bar wq__bar--ok" :style="{ width: pct(data.wrapup.evaluationModel, data.wrapup.sampleSize) }"></i>
              <i class="wq__bar wq__bar--bad" :style="{ width: pct(data.wrapup.evaluationFailed, data.wrapup.sampleSize) }"></i>
            </div>
            <span class="wq__nums">{{ data.wrapup.evaluationModel }} 模型 / {{ data.wrapup.evaluationFailed }} 失败</span>
          </div>
          <p class="wq__note">样本 {{ data.wrapup.sampleSize }} 次</p>
        </div>
        <p v-else-if="data.wrapup.sampleSize > 0" class="brief-card__note">已积累 {{ data.wrapup.sampleSize }} 次课后总结，正在分析生成质量…</p>
        <p v-else class="brief-card__note">暂无课后总结，教学会话结束后会自动生成。</p>
      </section>

      <!-- Top Skill 活跃榜（G4：近 7 天调用最多的节点） -->
      <section class="brief-card">
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
            @click="jump('skills')"
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

      <!-- 学习漏斗（业务主线，累计口径；下沉到明细区） -->
      <section class="brief-card">
        <h4>学习漏斗 · 累计</h4>
        <div class="funnel">
          <template v-for="(n, i) in data.funnel" :key="n.label">
            <div
              class="funnel__node funnel__node--clickable"
              :class="{ 'funnel__node--idle': n.idle }"
              :title="funnelTargets[i] === 'users' ? '查看用户' : funnelTargets[i] === 'goal-conversations' ? '查看目标对话' : '查看学习者中心'"
              @click="jump(funnelTargets[i])"
            >
              <span>{{ n.label }}</span>
              <strong>{{ n.value }}</strong>
            </div>
            <span
              v-if="i < data.funnel.length - 1"
              class="funnel__rate"
              :title="rateHint(i)"
            >{{ data.rates[i] }}</span>
          </template>
        </div>
      </section>

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
              <span class="usage__stat-sub">仅真实用户</span>
            </button>
            <i class="usage__hero-sep" aria-hidden="true"></i>
            <button type="button" class="usage__stat" title="近 7 天调用次数 · 查看执行日志" @click="jump('execution-logs')">
              <span class="usage__stat-label">调用</span>
              <strong>{{ data.usage.calls7d }}</strong>
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
              <strong>{{ data.usage.failed7d }}</strong>
              <span class="usage__stat-sub">次</span>
            </button>
            <p v-if="usageFullDiffers" class="usage__note">全量口径（含模拟账号）{{ fmtTokens(data.usage.totalTokens7dAll ?? 0) }} · {{ data.usage.calls7dAll ?? 0 }} 次</p>
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
              <ul class="usage__fails">
                <li v-for="f in data.usage.failures7d" :key="f.category" class="usage__fail" :title="`查看 ${f.category} 类别失败日志（近 7 天）`" @click="jumpToFailures(f.category)">
                  <span class="usage__dot"></span>
                  <span>{{ f.category }}</span>
                  <strong>{{ f.count }}</strong>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <p v-else class="brief-card__note">近 7 天暂无 LLM 调用记录。</p>
      </section>

      <!-- 动态时间线（全宽；异常事件置顶，普通事件折叠，近 24h 时间窗） -->
      <section class="brief-card brief-card--feed brief-card--feed-full">
        <div class="brief-card__head brief-card__head--feed">
          <h4>动态 · 近 24h<span v-if="lastUpdated" class="feed-fresh">更新于 {{ lastUpdated }}</span></h4>
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
              @click="feedJump(f)"
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
  <div v-else-if="liveLoading" class="mk-empty mk-empty--min">
    <p class="brief-card__note"><span class="mk-spinner"></span> 正在加载真实数据…</p>
  </div>
  <div v-else class="mk-empty mk-empty--min">
    <p class="brief-card__note">真实数据暂不可用，请刷新或稍后重试。</p>
    <button type="button" class="mk-empty__action" @click="retryOverview">重试</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { overviewHealth, investigateAgent, intent, dataSource } from './store';
import { liveOverviewFull, overviewHideTest, refreshLiveOverview, liveLoading } from './live';
import { adminHealthCenterApi } from '@/api/adminApi';
import { TERMS } from './terms';
import MkKpi from './MkKpi.vue';
import MkChart from './MkChart.vue';
import type { EChartsCoreOption } from 'echarts/core';
import { useSafePolling } from '@/composables/useSafePolling';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

interface BriefData {
  tone: Tone;
  score: number | null;
  headline: string;
  subline: string;
  actions: { text: string; link: string; tone: Tone; agentId: string }[];
  kpis: { label: string; value: string; hint: string }[];
  wrapup: {
    sampleSize: number;
    summaryModel: number;
    summaryFallback: number;
    evaluationModel: number;
    evaluationAiFallback: number;
    evaluationFailed: number;
  };
  usage: {
    calls7d: number;
    failed7d: number;
    totalTokens7d: number;
    models7d: { model: string; calls: number; tokens: number }[];
    failures7d: { category: string; count: number }[];
    /** 全量副口径（含虚拟/测试账号，供标注对比） */
    calls7dAll?: number;
    totalTokens7dAll?: number;
  };
  trend: { date: string; total: number; completed: number }[];
  /** G1：近 7 天每日调用/失败趋势 */
  trend7d: { date: string; calls: number; failed: number }[];
  /** G4：近 7 天 Top Skill 活跃榜 */
  topSkills: { agentId: string; calls: number; failed: number }[];
  /** G2/G3：近 7 天每日新增注册 / 活跃用户 */
  growth7d: { date: string; newUsers: number; activeUsers: number }[];
  funnel: { label: string; value: string; idle: boolean }[];
  rates: string[];
  pulse: { calls: number; issue: number; label?: string }[];
  totalCalls: number;
  totalIssues: number;
  peak: string;
  feed: { text: string; time: string; tone: Tone; ts?: number; errorCategory?: string; agentId?: string }[];
}

// 结论来自 store（由 spans 推导，与日志/瀑布/Skill 同源）；全部数据来自后端统计
const health = computed(() => overviewHealth.value);

// 健康结论与行动项同源：health 提示异常时即使静态 actions 为空也要给出排查入口，避免「需关注」与「无事可做」并存
const effectiveActions = computed(() => {
  if (!data.value) return [];
  if (data.value.actions.length) return data.value.actions;
  const tone = health.value.tone;
  if (tone === 'warn') {
    return [{ text: '教学链路出现失败，检查模型服务与限流配置', tone: 'bad' as Tone, agentId: 'teaching-agent', link: '' }];
  }
  return [];
});

const data = computed<BriefData | null>(() => liveOverviewFull.value);
// 后端滚动窗口桶带 label（'HH:00'），柱图 title 直接用它
const scoreDash = computed(() => `${(data.value?.score ?? 0) * 1.194} 119.4`);
const scoreTitle = computed(() => {
  if (!data.value) return ''
  const score = data.value.score
  const label = score == null ? '—' : `${score}%`
  return `${TERMS.healthScoreTitle}（${label}）\n${health.value.subline}`
});

/* ===== ECharts 图表（B1 收尾：24h 脉搏 / 7 天调用趋势）===== */
const pulseChartOption = computed<EChartsCoreOption>(() => {
  const pts = data.value?.pulse || [];
  const labels = pts.map((b) => b.label || '');
  return {
    animationDuration: 300,
    grid: { left: 30, right: 8, top: 8, bottom: 20 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const arr = params as Array<{ axisValue: string; data: number; color: string }>;
        const i = arr[0]?.axisValue || '';
        const b = pts[labels.indexOf(i)];
        if (!b) return i
        return `${i}<br/>调用 <b>${b.calls}</b> 次<br/>异常 <b>${b.issue}</b> 次`
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: 'rgba(23,32,51,0.15)' } },
      axisTick: { show: false },
      axisLabel: { color: '#8492ab', fontSize: 10, interval: 3 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: 'rgba(23,32,51,0.06)' } },
      axisLabel: { color: '#8492ab', fontSize: 10 },
    },
    series: [
      {
        name: '调用',
        type: 'bar',
        data: pts.map((b) => b.calls),
        barWidth: '60%',
        itemStyle: {
          color: (p: { dataIndex: number }) => (pts[p.dataIndex]?.issue ? '#f87171' : '#3d7cff'),
          borderRadius: [2, 2, 0, 0],
        },
      },
    ],
  };
});

const trend7dChartOption = computed<EChartsCoreOption>(() => {
  const days = data.value?.trend7d || [];
  const labels = days.map((d) => dayLabel(d.date));
  return {
    animationDuration: 300,
    grid: { left: 34, right: 8, top: 8, bottom: 20 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
    },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: 'rgba(23,32,51,0.15)' } },
      axisTick: { show: false },
      axisLabel: { color: '#8492ab', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: 'rgba(23,32,51,0.06)' } },
      axisLabel: { color: '#8492ab', fontSize: 10 },
    },
    series: [
      {
        name: '调用',
        type: 'bar',
        data: days.map((d) => d.calls),
        barWidth: '30%',
        itemStyle: { color: '#3d7cff', borderRadius: [2, 2, 0, 0] },
      },
      {
        name: '失败',
        type: 'bar',
        data: days.map((d) => d.failed),
        barWidth: '30%',
        itemStyle: { color: '#d97706', borderRadius: [2, 2, 0, 0] },
      },
    ],
  };
});
const pct = (n: number, total: number) => `${total > 0 ? Math.round((n / total) * 100) : 0}%`;
/* ===== G 系列新增：7 天趋势 / Top Skill / 用户增长 图表 helpers ===== */
const barPct = (v: number, max: number) => `${v > 0 ? Math.max(Math.round((v / max) * 100), 6) : 3}%`;
const dayLabel = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
};
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
const hasWrapupStats = computed(() => {
  const w = data.value?.wrapup;
  if (!w) return false;
  return w.summaryModel > 0 || w.summaryFallback > 0 || w.evaluationModel > 0 || w.evaluationAiFallback > 0 || w.evaluationFailed > 0;
});
/** 总结质量主导百分比（P3）：模型直接生成占比；无样本时为 null */
const wrapupModelPct = computed(() => {
  const w = data.value?.wrapup;
  if (!w || !w.sampleSize || w.sampleSize <= 0) return null;
  return Math.round((w.summaryModel / w.sampleSize) * 100);
});
const wrapupPctTone = computed(() => {
  const p = wrapupModelPct.value;
  if (p == null) return '';
  if (p >= 90) return 'wq__pct--ok';
  if (p >= 70) return 'wq__pct--warn';
  return 'wq__pct--bad';
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
// 漏斗相邻段速率说明（× 为 1:N 关系而非转化率）
const rateHint = (i: number) => {
  const pairs = [
    '每位用户发起的澄清对话数（可 >1）',
    '每条完成澄清对话生成的路径数',
    '每条路径下的任务数（1:N 正常）',
    '任务完成率'
  ]
  return pairs[i] || ''
};

// 重试按钮：force 跳过 liveLoading 守卫保证点击必重拉
async function retryOverview() {
  await refreshLiveOverview(true)
}

// 动态筛选：默认隐藏虚拟学习者与测试/审计账号（后端 excludeTest 已按此过滤并重新拉取）
const hideTestAccounts = overviewHideTest
// KPI 目标：今日调用 / 今日成功率 / 用户活跃 / 系统活跃（纯真实口径 4 卡；虚拟仿真走「虚拟学习者」页）
const kpiTargets = ['execution-logs', 'execution-logs', 'users', 'goal-conversations']
const funnelTargets = ['users', 'goal-conversations', 'goal-conversations', 'learner-center', 'learner-center']

const KPI_HINTS: string[] = [
  '今日自然日（00:00 起）',
  '今日真实调用成功率',
  '今日新增注册 + 今日有学习会话的用户',
  '今日进行中的目标对话 + 近 24h 有调用的 Skill',
]
function kpiTitle(i: number): string {
  const hint = KPI_HINTS[i] || ''
  const target = kpiTargets[i] === 'execution-logs' ? '执行日志' : kpiTargets[i] === 'users' ? '用户管理' : kpiTargets[i] === 'goal-conversations' ? '目标对话' : 'Skill 目录'
  return [hint, `点击查看${target}`].filter(Boolean).join(' · ')
}
function jump(scene: string) {
  if (!scene) return
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceId = ''
  intent.errorCategory = ''
  intent.timeRange = ''
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
const { start: startAutoRefresh } = useSafePolling(
  async () => {
    await refreshLiveOverview()
    lastUpdated.value = new Date().toTimeString().slice(0, 5)
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

/* 简报头 */
.brief-head {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: #fff;
}
.brief-head--warn { border-color: rgba(180, 83, 9, 0.3); background: linear-gradient(180deg, #fffdf7, #fff); }
.brief-head--bad { border-color: rgba(220, 38, 38, 0.35); background: linear-gradient(180deg, #fff7f7, #fff); }
.brief-head--muted { background: #fafbfd; }

.brief-head__verdict {
  display: flex;
  align-items: center;
  gap: 14px;
}
.brief-head__verdict h3 { margin: 0; font-size: 16px; font-weight: 750; }
.brief-head__verdict p { margin: 3px 0 0; color: var(--mk-muted); font-size: 12.5px; }

.brief-score-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.brief-score {
  position: relative;
  width: 52px;
  height: 52px;
}
.brief-score svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.brief-score__track { fill: none; stroke: #edf1f8; stroke-width: 5; }
.brief-score__bar {
  fill: none;
  stroke: var(--mk-blue);
  stroke-width: 5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.5s ease;
}
.brief-head--warn .brief-score__bar { stroke: var(--mk-amber); }
.brief-head--bad .brief-score__bar { stroke: var(--mk-red); }
.brief-head--muted .brief-score__bar { stroke: #c3cede; }
.brief-score strong {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
}
.brief-head--warn .brief-score strong { color: var(--mk-amber); }
.brief-head--bad .brief-score strong { color: var(--mk-red); }
.brief-head--muted .brief-score strong { color: var(--mk-faint); }
.brief-score__cap {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--mk-faint);
  white-space: nowrap;
}

.brief-actions {
  margin: 0;
  padding: 10px 0 0;
  list-style: none;
  border-top: 1px dashed var(--mk-line);
  display: grid;
  gap: 8px;
}
.brief-actions li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.brief-actions__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.brief-actions__dot--bad { background: var(--mk-red); }
.brief-actions__dot--warn { background: var(--mk-amber); }
.brief-actions__text {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  line-height: 1.4;
}
.brief-actions__btn {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 5px 12px;
  border: 1px solid rgba(44, 99, 208, 0.28);
  border-radius: 999px;
  background: #eef5ff;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: 0.12s ease;
}
.brief-actions__btn:hover {
  background: #dbeafe;
  border-color: rgba(44, 99, 208, 0.45);
}
.brief-actions__clear {
  margin: 0;
  padding-top: 10px;
  border-top: 1px dashed var(--mk-line);
  color: var(--mk-faint);
  font-size: 13px;
}

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
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.brief-card h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.brief-card__note { margin: 0; font-size: 12.5px; color: var(--mk-muted); }
/* 短卡（总结/用量）：等高拉伸时把内容贴底，避免"卡片内空一大块" */
.brief-card > .wq:last-child,
.brief-card > .usage:last-child { margin-top: auto; }
/* 空态说明：卡内垂直居中（等高栅格中避免贴顶 + 大留白） */
.brief-card > .brief-card__note:last-child {
  margin-top: auto;
  margin-bottom: auto;
  text-align: center;
  line-height: 1.7;
  padding: 8px 0;
}
.brief-card--feed-full { grid-column: 1 / -1; }
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
  font-size: 11.5px;
  color: var(--mk-muted);
  cursor: pointer;
  user-select: none;
}
.feed-filter input {
  margin: 0;
  accent-color: var(--mk-blue, #2c63d0);
}

/* 总结产出质量 */
.wq { display: grid; gap: 12px; }
.wq__row { display: grid; grid-template-columns: 64px 1fr; gap: 8px 10px; align-items: center; }
.wq__label { font-size: 12px; font-weight: 600; color: var(--mk-muted); }
.wq__bars { display: flex; gap: 2px; height: 8px; border-radius: 99px; overflow: hidden; background: #f0f3f9; }
.wq__bar { height: 100%; border-radius: 99px; }
.wq__bar--ok { background: var(--mk-green); }
.wq__bar--blue { background: var(--mk-blue); }
.wq__bar--warn { background: var(--mk-amber); }
.wq__bar--bad { background: var(--mk-red); }
.wq__nums { grid-column: 2; font-size: 11.5px; color: var(--mk-faint); }
.wq__note { margin: 0; font-size: 12px; color: var(--mk-muted); line-height: 1.6; }
/* P3：模型生成占比徽标（卡头，色随占比） */
.wq__pct {
  font-size: 11.5px; font-weight: 800; padding: 2px 9px; border-radius: 999px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.wq__pct--ok { background: rgba(22, 163, 74, 0.12); color: #15803d; }
.wq__pct--warn { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.wq__pct--bad { background: rgba(220, 38, 38, 0.12); color: #dc2626; }
html[data-theme='dark'] .wq__pct--ok { background: rgba(22, 163, 74, 0.18); color: #4ade80; }
html[data-theme='dark'] .wq__pct--warn { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
html[data-theme='dark'] .wq__pct--bad { background: rgba(248, 113, 113, 0.16); color: #fca5a5; }

/* 卡片头部统一：标题左 + 快捷跳转/时间窗 右（见板 = 状态一瞥 + 一键直达） */
.brief-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.brief-card__meta {
  font-size: 11px;
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
  font-size: 11.5px;
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

/* 系统健康摘要条（简报头下全宽按钮条：状态点 + 结论 + 跳转） */
.ov-health {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.12s ease;
}
.ov-health:hover { border-color: rgba(44, 99, 208, 0.5); }
.ov-health__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-faint); flex-shrink: 0; }
.ov-health--ok .ov-health__dot { background: var(--mk-green); box-shadow: 0 0 0 3px rgba(49, 177, 111, 0.12); }
.ov-health--warn .ov-health__dot { background: var(--mk-amber); }
.ov-health--bad .ov-health__dot { background: var(--mk-red); box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12); }
.ov-health__title { font-size: 13px; font-weight: 800; color: var(--mk-ink); }
.ov-health__sub { flex: 1; font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-health .brief-card__go { margin-right: 0; }

/* 近 7 天调用趋势（ECharts 图表；仅保留容器与合计行） */
.ov-trend { display: grid; gap: 8px; flex: 1; min-height: 0; align-content: end; }
.ov-trend__sum { margin: 0; font-size: 11.5px; color: var(--mk-muted); }

/* Top Skill 排行 */
.ov-skills { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.ov-skill {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 64px auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.ov-skill:hover { background: #f5f8ff; }
.ov-skill__rank {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: #eef2fa;
  color: var(--mk-faint);
  font-size: 10.5px;
  font-weight: 800;
}
.ov-skill:nth-child(1) .ov-skill__rank { background: #dbeafe; color: var(--mk-accent-deep, #1f57cc); }
.ov-skill__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; color: var(--mk-ink); }
.ov-skill__track { height: 6px; border-radius: 99px; background: #f0f3f9; overflow: hidden; }
.ov-skill__bar { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #6aa0ff, #3d7cff); }
.ov-skill__calls { font-size: 12px; color: var(--mk-muted); text-align: right; white-space: nowrap; }
.ov-skill__fail { font-style: normal; color: var(--mk-amber); font-weight: 700; }

/* 用户增长（新增/活跃双柱） */
.ov-growth { display: grid; gap: 8px; flex: 1; min-height: 0; align-content: end; }
.ov-growth__rows {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  flex: 1;
  min-height: 0;
}
.ov-growth__day { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; min-height: 0; }
.ov-growth__bars { display: flex; align-items: flex-end; gap: 3px; height: 68px; }
.ov-growth__bar { width: 8px; border-radius: 3px 3px 1px 1px; }
.ov-growth__bar--new { background: linear-gradient(180deg, #6aa0ff, #3d7cff); }
.ov-growth__bar--active { background: linear-gradient(180deg, #34d399, #15803d); }
.ov-growth__label { font-size: 10.5px; color: var(--mk-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ov-growth__legend { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--mk-muted); }
.ov-growth__legend .mk-card__meta { margin-left: auto; }
.ov-growth__dot { width: 7px; height: 7px; border-radius: 2px; display: inline-block; margin-right: 4px; }
.ov-growth__dot--new { background: #3d7cff; }
.ov-growth__dot--active { background: #15803d; }

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
  border-radius: 8px;
}
.usage__stat:hover { background: rgba(44, 99, 208, 0.06); }
.usage__stat-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mk-faint);
}
.usage__stat strong {
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
  line-height: 1.2;
}
.usage__stat--big strong { font-size: 26px; }
.usage__stat--bad strong { color: var(--mk-red); }
.usage__stat-sub { font-size: 10.5px; color: var(--mk-faint); }
.usage__hero-sep { width: 1px; align-self: center; height: 34px; background: #e6ebf4; flex-shrink: 0; }
.usage__note {
  position: absolute;
  right: 14px;
  bottom: 8px;
  margin: 0;
  font-size: 10.5px;
  color: var(--mk-faint);
  font-weight: 600;
  letter-spacing: 0.02em;
  max-width: 46%;
  text-align: right;
  line-height: 1.5;
}
/* 模型用量 / 失败原因 横向两栏（宽卡内避免纵向长串） */
.usage__cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.usage__section { display: grid; gap: 6px; }
.usage__label { font-size: 11px; font-weight: 700; color: var(--mk-faint); letter-spacing: 0.04em; }
.usage__rows { display: grid; gap: 5px; }
.usage__row { display: grid; grid-template-columns: minmax(0, 1fr) 88px 52px; gap: 8px; align-items: center; font-size: 12px; }
.usage__row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--mk-ink); }
.usage__bar-track { height: 6px; border-radius: 99px; background: #f0f3f9; overflow: hidden; }
.usage__bar { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #6aa0ff, #3d7cff); }
.usage__row-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--mk-muted); }
.usage__fails { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 12px; }
.usage__fails li { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mk-muted); }
.usage__fail { cursor: pointer; border-radius: 6px; transition: background 0.12s ease; }
.usage__fail:hover { background: #f5f8ff; }
.usage__fails strong { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.usage__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mk-amber); flex-shrink: 0; }

/* 近 7 天趋势（柱状区弹性撑满卡片，避免等高网格内留白） */
.brief-card--trend { display: flex; flex-direction: column; }
.brief-card--trend .trend { flex: 1; min-height: 0; }
.trend__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.trend__head-right { display: inline-flex; align-items: center; gap: 12px; }
.trend__legend { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: var(--mk-faint); white-space: nowrap; }
.trend__dot { width: 7px; height: 7px; border-radius: 2px; display: inline-block; margin-right: 3px; }
.trend__dot--new { background: linear-gradient(180deg, #6aa0ff, #3d7cff); }
.trend__dot--done { background: linear-gradient(180deg, #34d399, #15803d); }
.trend { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.trend__col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; min-height: 0; border-radius: 8px; }
.trend__col--today { background: #f0f6ff; box-shadow: inset 0 0 0 1px rgba(44, 99, 208, 0.25); }
.trend__bars { flex: 1; display: flex; align-items: flex-end; justify-content: center; gap: 3px; width: 100%; min-height: 56px; }
.trend__day--today { color: var(--mk-blue); font-weight: 800; }
.trend__sum { margin: 0; padding-top: 8px; border-top: 1px dashed var(--mk-line); font-size: 12px; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.trend__bar { width: 9px; border-radius: 3px 3px 1px 1px; background: linear-gradient(180deg, #6aa0ff, #3d7cff); opacity: 0.85; }
.trend__bar--ok { background: linear-gradient(180deg, #34d399, #15803d); opacity: 1; }
.trend__num { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--mk-muted); font-weight: 700; }
.trend__num--zero { color: var(--mk-faint); font-weight: 600; }
.trend__day { font-size: 10.5px; color: var(--mk-faint); }


/* 漏斗 */
.funnel {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.funnel__node {
  flex: 1 1 64px;
  display: grid;
  gap: 2px;
  padding: 10px 8px;
  border-radius: 10px;
  border: 1px solid var(--mk-line);
  background: #fafbfe;
  text-align: center;
}
.funnel__node span { font-size: 11.5px; color: var(--mk-muted); font-weight: 600; }
.funnel__node strong { font-size: 19px; font-variant-numeric: tabular-nums; }
/* 空置漏斗节点：浅实线 + 淡底（虚线易被误读为加载/禁用态） */
.funnel__node--idle { border-style: solid; border-color: #edf0f5; background: #f7f9fc; }
.funnel__node--idle strong { color: var(--mk-faint); }
.funnel__node--clickable { cursor: pointer; transition: border-color 0.12s ease; }
.funnel__node--clickable:hover { border-color: rgba(44, 99, 208, 0.5); }
.funnel__rate { font-size: 10.5px; font-weight: 800; color: var(--mk-faint); }

/* 脉搏（ECharts 图表；仅保留 meta 行样式） */
.pulse__meta {
  display: flex;
  gap: 16px;
  font-size: 12.5px;
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px 16px;
}
.feed--full::before { display: none; }
.feed--full li { display: flex; gap: 9px; align-items: flex-start; }
.feed--full li strong { font-size: 12.5px; font-weight: 600; line-height: 1.45; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
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
.feed li strong { font-size: 13px; font-weight: 600; }
.feed li span { font-size: 11.5px; color: var(--mk-faint); }
.feed__empty { margin: 0; color: var(--mk-faint); font-size: 13px; }
/* 新鲜度标注（R6：显示最近一次自动刷新的时间） */
.feed-fresh { margin-left: 6px; font-size: 10.5px; color: var(--mk-faint); font-weight: 600; letter-spacing: 0.02em; }
/* 异常事件条目（bad/warn 置顶可点） */
.feed__item { cursor: pointer; border-radius: 8px; padding: 6px 8px; margin: -6px -8px; transition: background 0.12s ease; }
.feed__item:hover { background: #f5f8ff; }
.feed__item--bad:hover { background: #fff2f2; }
.feed__item--warn:hover { background: #fffaed; }
.feed__item .feed__body { flex: 1; min-width: 0; display: grid; gap: 1px; }
.feed__item--bad strong { color: #b91c1c; }
.feed__item--warn strong { color: #b45309; }
.feed__go { font-style: normal; font-size: 11px; font-weight: 700; color: var(--mk-blue); flex-shrink: 0; align-self: center; opacity: 0; transition: opacity 0.12s ease; }
.feed__item:hover .feed__go { opacity: 1; }
/* 普通事件折叠开关 */
.feed__toggle {
  align-self: flex-start;
  padding: 4px 12px;
  border: 1px dashed var(--mk-line);
  border-radius: 999px;
  background: transparent;
  color: var(--mk-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.12s ease;
}
.feed__toggle:hover { border-color: rgba(44, 99, 208, 0.45); color: var(--mk-blue); background: #f5f8ff; }

@media (max-width: 1280px) and (min-width: 1001px) {
  /* 中等宽度：三列过渡为两列，KPI 2+2 换行，动态卡占整行 */
  .brief-grid { grid-template-columns: 1fr 1fr; }
  .brief-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .brief-card--feed { grid-column: 1 / -1; }
  .usage__cols { grid-template-columns: 1fr; }
}

@media (max-width: 1000px) {
  .brief-grid { grid-template-columns: 1fr; }
  .brief-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* 4K：卡片字号放大（KPI 卡已组件化为 MkKpi，4K 档在组件内；容器随全站 mk-page 全宽） */
@media (min-width: 2000px) {
  .brief-card { padding: 20px 24px; }
  .brief-card h4 { font-size: 13.5px; }
  .brief-score { width: 64px; height: 64px; }
  .brief-score strong { font-size: 17px; }
  .brief-score__cap { font-size: 10.5px; }
  .brief-head__verdict h3 { font-size: 20px; }
  .brief-head__verdict p { font-size: 15px; }
  .brief-actions li { font-size: 15px; }
  .brief-actions__btn { font-size: 14px; }
  .brief-actions__clear { font-size: 15px; }
  .brief-card__note { font-size: 14.5px; }
  .feed-filter { font-size: 13.5px; }
  .feed__empty { font-size: 15px; }
  .feed li strong { font-size: 15px; }
  .feed li span { font-size: 13.5px; }
  .feed--full li strong { font-size: 14.5px; }
  .wq__label { font-size: 14px; }
  .wq__nums { font-size: 13.5px; }
  .wq__note { font-size: 14px; }
  .usage__big strong { font-size: 30px; }
  .usage__big span { font-size: 13.5px; }
  .usage__big em { font-size: 14.5px; }
  .usage__label { font-size: 13px; }
  .usage__row { font-size: 14px; }
  .usage__fails li { font-size: 14px; }
  .trend__legend { font-size: 13px; }
  .trend__num { font-size: 13px; }
  .trend__day { font-size: 12.5px; }
  .trend__sum { font-size: 14px; }
  .funnel__node span { font-size: 13.5px; }
  .funnel__node strong { font-size: 22px; }
  .funnel__rate { font-size: 12.5px; }
  .pulse__meta { font-size: 14.5px; }
}
@media (min-width: 2800px) {
  .funnel__node span { font-size: 15.5px; }
  .brief-card { padding: 24px 30px; }
  .brief-card h4 { font-size: 16px; }
  .brief-score { width: 76px; height: 76px; }
  .brief-score strong { font-size: 20px; }
  .brief-score__cap { font-size: 12.5px; }
  .brief-head__verdict h3 { font-size: 24px; }
  .brief-head__verdict p { font-size: 17px; }
  .brief-actions li { font-size: 17px; }
  .brief-actions__btn { font-size: 16px; }
  .brief-actions__clear { font-size: 17px; }
  .brief-card__note { font-size: 16.5px; }
  .feed-filter { font-size: 15.5px; }
  .feed__empty { font-size: 17px; }
  .feed li strong { font-size: 17px; }
  .feed li span { font-size: 15.5px; }
  .feed--full li strong { font-size: 16.5px; }
  .wq__label { font-size: 16px; }
  .wq__nums { font-size: 15.5px; }
  .wq__note { font-size: 16px; }
  .usage__big strong { font-size: 34px; }
  .usage__big span { font-size: 15.5px; }
  .usage__big em { font-size: 16.5px; }
  .usage__label { font-size: 15px; }
  .usage__row { font-size: 16px; }
  .usage__fails li { font-size: 16px; }
  .trend__legend { font-size: 15px; }
  .trend__num { font-size: 15px; }
  .trend__day { font-size: 14.5px; }
  .trend__sum { font-size: 16px; }
  .funnel__node span { font-size: 15.5px; }
  .funnel__node strong { font-size: 26px; }
  .funnel__rate { font-size: 14.5px; }
  .pulse__meta { font-size: 16.5px; }
}
/* 3600+（zoom 1.3 档）：卡片延续 2800 放大节奏（约 1.17×），补齐 2000/2800 未覆盖的卡片内文字（feed/pulse/trend/wq/usage/funnel） */
@media (min-width: 3600px) {
  .brief-card { padding: 28px 36px; }
  .brief-card h4 { font-size: 19px; }
  .brief-card__note { font-size: 14.5px; }
  .brief-score { width: 90px; height: 90px; }
  .brief-score strong { font-size: 23.5px; }
  .brief-score__cap { font-size: 14.5px; }
  .brief-actions li { font-size: 15px; }
  .brief-actions__btn { font-size: 14px; }
  .brief-actions__clear { font-size: 15px; }
  .feed-filter { font-size: 13.5px; }
  .feed__empty { font-size: 15px; }
  .feed li strong { font-size: 15.5px; }
  .feed li span { font-size: 13.5px; }
  .feed--full li strong { font-size: 15px; }
  .wq__label { font-size: 14px; }
  .wq__nums { font-size: 13.5px; }
  .wq__note { font-size: 14px; }
  .usage__big strong { font-size: 30px; }
  .usage__big span { font-size: 13.5px; }
  .usage__big em { font-size: 14.5px; }
  .usage__label { font-size: 13px; }
  .usage__row { font-size: 14px; }
  .usage__fails li { font-size: 14px; }
  .trend__legend { font-size: 13px; }
  .trend__num { font-size: 13px; }
  .trend__day { font-size: 12.5px; }
  .trend__sum { font-size: 14px; }
  .funnel__node span { font-size: 13.5px; }
  .funnel__node strong { font-size: 22px; }
  .funnel__rate { font-size: 12.5px; }
  .pulse__meta { font-size: 14.5px; }
}

/* ================= 暗色模式（D1）：总览页硬编码浅色覆写 ================= */
html[data-theme='dark'] {
  .brief-head { background: #141c2b; }
  .brief-head--warn { background: linear-gradient(180deg, #2a2410, #141c2b); }
  .brief-head--bad { background: linear-gradient(180deg, #2a1414, #141c2b); }
  .brief-head--muted { background: #131b2a; }
  .brief-score__track { stroke: #232f45; }
  .brief-card { background: #141c2b; }
  .brief-actions__btn { background: rgba(91, 141, 239, 0.16); border-color: rgba(91, 141, 239, 0.35); }
  .brief-actions__btn:hover { background: rgba(91, 141, 239, 0.26); }
  .wq__bars, .ov-skill__track, .usage__bar-track { background: #232f45; }
  .ov-skill:hover, .usage__fail:hover, .feed__item:hover { background: #1b2740; }
  .feed__item--bad:hover { background: #2a1414; }
  .feed__item--warn:hover { background: #2a2410; }
  .trend__col--today { background: rgba(91, 141, 239, 0.12); box-shadow: inset 0 0 0 1px rgba(91, 141, 239, 0.3); }
  .funnel__node { background: #1b2740; border-color: #232f45; }
  .funnel__node--idle { background: #131b2a; border-color: #232f45; }
  .usage__hero { background: linear-gradient(180deg, #141c2b, #131b2a); border-color: #232f45; }
  .usage__hero-sep { background: #232f45; }
  .brief-card__go:hover { background: rgba(91, 141, 239, 0.14); }
  .ov-health { background: #141c2b; }
  .ov-growth__bar--new, .trend__bar, .usage__bar { background: linear-gradient(180deg, #6aa0ff, #3d7cff); }
}
</style>
