<template>
  <div v-if="data" class="brief">
    <!-- 结论先行：今日简报 -->
    <header class="brief-head" :class="`brief-head--${data.tone}`">
      <div class="brief-head__verdict">
        <div class="brief-score-wrap">
          <div class="brief-score" :style="{ '--pct': data.score }" :title="scoreTitle">
            <svg viewBox="0 0 44 44">
              <circle class="brief-score__track" cx="22" cy="22" r="19" />
              <circle class="brief-score__bar" cx="22" cy="22" r="19" :stroke-dasharray="scoreDash" />
            </svg>
            <strong>{{ data.score }}</strong>
          </div>
          <span class="brief-score__cap">健康分</span>
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

    <div class="brief-grid">
      <!-- KPI 行：今日窗口指标 -->
      <section class="brief-kpis">
        <div
          v-for="(k, i) in data.kpis"
          :key="k.label"
          class="kpi kpi--clickable"
          :title="`跳转到${kpiTargets[i] === 'execution-logs' ? '执行日志' : kpiTargets[i] === 'users' ? '用户' : kpiTargets[i] === 'goal-conversations' ? '目标对话' : 'Skill 目录'}`"
          @click="jump(kpiTargets[i])"
        >
          <span class="kpi__label">{{ k.label }}</span>
          <strong class="kpi__value">{{ k.value }}</strong>
          <span class="kpi__hint">{{ k.hint }}</span>
        </div>
      </section>

      <!-- 学习漏斗 -->
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

      <!-- 系统脉搏 -->
      <section class="brief-card">
        <h4>24h 系统脉搏</h4>
        <div class="pulse">
          <div
            v-for="(b, i) in data.pulse"
            :key="i"
            class="pulse__bar"
            :class="{ 'pulse__bar--issue': b.issue, 'pulse__bar--idle': !b.calls }"
            :style="{ height: barHeight(b.calls) }"
              :title="barTitle(i, b)"
          ></div>
        </div>
        <div class="pulse__meta">
          <span>24h 调用 <strong>{{ data.totalCalls }}</strong></span>
          <span>异常 <strong :class="{ 'is-bad': data.totalIssues > 0 }">{{ data.totalIssues }}</strong></span>
          <span>高峰 {{ data.peak }}</span>
        </div>
        <div class="pulse__axis">
          <i v-for="a in pulseAxis" :key="a">{{ a }}</i>
        </div>
      </section>

      <!-- 总结产出质量 -->
      <section class="brief-card">
        <h4>总结产出质量</h4>
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
              <i class="wq__bar wq__bar--blue" :style="{ width: pct(data.wrapup.evaluationAiFallback, data.wrapup.sampleSize) }"></i>
              <i class="wq__bar wq__bar--bad" :style="{ width: pct(data.wrapup.evaluationFailed, data.wrapup.sampleSize) }"></i>
            </div>
            <span class="wq__nums">{{ data.wrapup.evaluationModel }} 模型 / {{ data.wrapup.evaluationAiFallback }} AI 兜底 / {{ data.wrapup.evaluationFailed }} 失败</span>
          </div>
          <p class="wq__note">样本 {{ data.wrapup.sampleSize }} 次</p>
        </div>
        <p v-else-if="data.wrapup.sampleSize > 0" class="brief-card__note">已积累 {{ data.wrapup.sampleSize }} 次课后总结，统计解析中。</p>
        <p v-else class="brief-card__note">还没有课后总结样本。</p>
      </section>

      <!-- LLM 用量与失败归因 -->
      <section class="brief-card">
        <h4>LLM 用量与失败归因</h4>
        <div v-if="usageHasData" class="usage">
          <div class="usage__big">
            <strong>{{ fmtTokens(data.usage.totalTokens7d) }}</strong>
            <span>近 7 天 token</span>
            <em>{{ data.usage.calls7d }} 次调用 · 失败 {{ data.usage.failed7d }}</em>
          </div>
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
            <span class="usage__label">失败归因（尝试级，含重试）</span>
            <ul class="usage__fails">
              <li v-for="f in data.usage.failures7d" :key="f.category" class="usage__fail" :title="`跳转到执行日志`" @click="jump('execution-logs')">
                <span class="usage__dot"></span>
                <span>{{ f.category }}</span>
                <strong>{{ f.count }}</strong>
              </li>
            </ul>
          </div>
        </div>
        <p v-else class="brief-card__note">近 7 天还没有 LLM 调用记录。</p>
      </section>

      <!-- 近 7 天目标对话趋势 -->
      <section class="brief-card brief-card--trend">
        <div class="trend__head">
          <h4>新增目标对话 · 近 7 天</h4>
          <span class="trend__legend">
            <i class="trend__dot trend__dot--new"></i>当日新增
            <i class="trend__dot trend__dot--done"></i>其中完成
          </span>
        </div>
        <div v-if="data.trend.length" class="trend">
          <div
            v-for="d in data.trend"
            :key="d.date"
            class="trend__col"
            :class="{ 'trend__col--today': isToday(d.date) }"
            :title="`${d.date} · 新增 ${d.total} · 完成 ${d.completed} · 按创建日期归集`"
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
        <p v-else class="brief-card__note">近 7 天还没有目标对话。</p>
        <p v-if="data.trend.length" class="trend__sum">
          合计新增 {{ trendSum.total }} · 完成 {{ trendSum.completed }} · 完成率 {{ trendSum.rate }}
        </p>
      </section>

      <!-- 动态时间线（全宽） -->
      <section class="brief-card brief-card--feed brief-card--feed-full">
        <div class="brief-card__head brief-card__head--feed">
          <h4>动态</h4>
          <label class="feed-filter">
            <input type="checkbox" v-model="hideTestAccounts" />
            <span>隐藏虚拟/测试账号</span>
          </label>
        </div>
        <ul v-if="visibleFeed.length" class="feed feed--full">
          <li v-for="(f, i) in visibleFeed" :key="i">
            <span class="feed__dot" :class="`feed__dot--${f.tone}`"></span>
            <div>
              <strong>{{ f.text }}</strong>
              <span>{{ f.time }}</span>
            </div>
          </li>
        </ul>
        <p v-else-if="data.feed.length" class="feed__empty">近期动态均为虚拟/测试账号，取消勾选即可查看。</p>
        <p v-else class="feed__empty">还没有动态</p>
      </section>
    </div>
  </div>
  <div v-else-if="liveLoading" class="brief brief--loading">
    <p class="brief-card__note"><span class="mk-spinner"></span> 正在加载真实数据…</p>
  </div>
  <div v-else class="brief brief--empty">
    <p class="brief-card__note">真实数据暂不可用，请刷新或稍后重试。</p>
    <button type="button" class="brief-empty__retry" @click="retryOverview">重试</button>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { overviewHealth, investigateAgent, intent, dataSource } from './store';
import { liveOverviewFull, overviewHideTest, refreshLiveOverview, liveLoading } from './live';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

interface BriefData {
  tone: Tone;
  score: number;
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
  };
  trend: { date: string; total: number; completed: number }[];
  funnel: { label: string; value: string; idle: boolean }[];
  rates: string[];
  pulse: { calls: number; issue: number; label?: string }[];
  totalCalls: number;
  totalIssues: number;
  peak: string;
  feed: { text: string; time: string; tone: Tone }[];
}

// 结论来自 store（由 spans 推导，与日志/瀑布/Skill 同源）；funnel/pulse/feed 为演示数据
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

const pulse = (hot: number[]) =>
  Array.from({ length: 24 }, (_, i) => ({
    calls: hot[i] || 0,
    issue: 0
  }));

const demoUsage: BriefData['usage'] = {
  calls7d: 1824,
  failed7d: 96,
  totalTokens7d: 4018915,
  models7d: [{ model: 'deepseek-v4-flash', calls: 1530, tokens: 4018915 }],
  failures7d: [
    { category: 'provider_http', count: 243 },
    { category: 'authentication', count: 26 },
    { category: 'protocol', count: 25 },
    { category: 'caller_abort', count: 12 },
    { category: 'rate_limit', count: 11 }
  ]
};
const demoTrend: BriefData['trend'] = [
  { date: '07-27', total: 2, completed: 1 },
  { date: '07-28', total: 4, completed: 2 },
  { date: '07-29', total: 3, completed: 1 },
  { date: '07-30', total: 6, completed: 3 },
  { date: '07-31', total: 5, completed: 2 },
  { date: '08-01', total: 7, completed: 3 },
  { date: '08-02', total: 4, completed: 2 }
];

const datasets: BriefData = {
  tone: 'ok',
  score: 92,
  headline: '运行平稳',
  subline: '学习链路与模型服务都在正常区间。',
  actions: [],
  kpis: [
    { label: '今日调用', value: '273', hint: '超时 2' },
    { label: '今日成功率', value: '99.3%', hint: '2 次失败' },
    { label: '今日新增', value: '6', hint: '新用户' },
    { label: '今日活跃', value: '18', hint: '总 32 名用户' },
    { label: '进行中对话', value: '12', hint: '目标规划' },
    { label: '活跃 Skill', value: '16', hint: '近 24h' }
  ],
  wrapup: {
    sampleSize: 42,
    summaryModel: 38,
    summaryFallback: 4,
    evaluationModel: 31,
    evaluationAiFallback: 8,
    evaluationFailed: 3
  },
  usage: demoUsage,
  trend: demoTrend,
  funnel: [
    { label: '用户', value: '128', idle: false },
    { label: '目标对话', value: '86', idle: false },
    { label: '路径', value: '64', idle: false },
    { label: '任务', value: '342', idle: false },
    { label: '完成', value: '217', idle: false }
  ],
  rates: ['67%', '74%', '×5.3 个/条', '63%'],
  pulse: pulse([2, 1, 0, 0, 1, 3, 6, 9, 14, 18, 22, 19, 16, 21, 25, 28, 24, 19, 15, 12, 8, 5, 4, 3]),
  totalCalls: 273,
  totalIssues: 0,
  peak: '15:00',
  feed: [
    { text: '「数据分析入门」路径第 3 阶段完成', time: '6 分钟前', tone: 'ok' },
    { text: '新用户注册：liu**@163.com', time: '18 分钟前', tone: 'muted' },
    { text: '路径「Excel 自动化」生成成功', time: '42 分钟前', tone: 'ok' },
    { text: '学习者快照重算完成 ×12', time: '1 小时前', tone: 'muted' }
  ]
}

const data = computed<BriefData | null>(() => {
  // live 模式：全部来自真实统计；数据为空/拉取失败时不回退 demo 假数据（模板有 v-else 空态）
  if (dataSource.value === 'live') return liveOverviewFull.value
  return datasets
});
const maxCalls = computed(() => Math.max(1, ...(data.value?.pulse.map((b) => b.calls) || [])));
const barHeight = (calls: number) => `${calls > 0 ? Math.max((calls / maxCalls.value) * 100, 8) : 4}%`;
const scoreDash = computed(() => `${(data.value?.score ?? 0) * 1.194} 119.4`);
const scoreTitle = computed(() =>
  data.value ? `健康分 = 今日调用成功率（${data.value.score} 分）\n${health.value.subline}` : ''
);
// 后端滚动窗口桶带 label（'HH:00'），柱图 title 直接用它；demo 数据无 label 时按下标兜底
const barTitle = (hour: number, b: { calls: number; issue: number; label?: string }) =>
  `${b.label || `${String(hour).padStart(2, '0')}:00`} · ${b.calls} 次调用 · ${b.issue} 异常`;
// 脉搏 x 轴：live 用后端 label（滚动窗口，index 0 = 23h 前）；demo 无 label 回退壁钟刻度
const pulseAxis = computed<string[]>(() => {
  const labels = data.value?.pulse.map((b) => b.label).filter(Boolean) as string[];
  if (labels && labels.length === 24) {
    return [labels[0], labels[6], labels[12], labels[18], labels[23]];
  }
  return ['00', '06', '12', '18', '23'];
});
const pct = (n: number, total: number) => `${total > 0 ? Math.round((n / total) * 100) : 0}%`;
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
const trendMax = computed(() => Math.max(1, ...(data.value?.trend.map((d) => d.total) || [])));
const trendH = (n: number) => `${n > 0 ? Math.max((n / trendMax.value) * 100, 10) : 4}%`;
const trendLabel = (date: string) => {
  const m = String(date).match(/\d{2}-\d{2}$/);
  return m ? m[0] : String(date).slice(5);
};
// 与后端 UTC 切日同口径；demo 数据为 MM-DD 短格式，兼容匹配（computed：跨午夜后仍正确）
const todayStr = computed(() => new Date().toISOString().slice(0, 10));
const isToday = (date: string) => date === todayStr.value || date === todayStr.value.slice(5);
const trendSum = computed(() => {
  const trend = data.value?.trend || [];
  const total = trend.reduce((a, d) => a + d.total, 0);
  const completed = trend.reduce((a, d) => a + d.completed, 0);
  return {
    total,
    completed,
    rate: total > 0 ? `${Math.round((completed / total) * 100)}%` : '—'
  };
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

// 重试按钮：仅 live 模式会出现空态（demo 恒有数据），force 跳过 liveLoading 守卫保证点击必重拉
async function retryOverview() {
  if (dataSource.value !== 'live') return
  await refreshLiveOverview(true)
}

// 动态筛选：默认隐藏虚拟学习者与测试/审计账号（后端 excludeTest 已按此过滤并重新拉取），
// 前端正则仅为 demo 模式兜底
const hideTestAccounts = overviewHideTest
const kpiTargets = ['execution-logs', 'execution-logs', 'users', 'users', 'goal-conversations', 'skills']
const funnelTargets = ['users', 'goal-conversations', 'goal-conversations', 'learner-center', 'learner-center']
function jump(scene: string) {
  if (!scene) return
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceId = ''
  intent.scene = scene
}
const isTestAccount = (text: string) => {
  const email = String(text || '').replace(/^新用户注册：/, '');
  if (email.startsWith('virtual_') || email.endsWith('@test.local')) return true;
  return /^(audit_probe_|e2e_|ui_check|motion_review)/.test(email);
};
const visibleFeed = computed(() => {
  const feed = data.value?.feed || [];
  return hideTestAccounts.value ? feed.filter((f) => !isTestAccount(f.text)) : feed;
});
// 开关切换 → 后端按 excludeTest 重新拉取动态。
// refreshLiveOverview 内部有 liveLoading 守卫（初始加载中会吞请求），这里用
// pending 标志 + liveLoading 回落 watch 保证开关一定生效（last-wins，只重拉一次）
let pendingOverviewReload = false
async function refreshOverviewQueued() {
  if (dataSource.value !== 'live') return
  if (liveLoading.value) {
    pendingOverviewReload = true
    return
  }
  pendingOverviewReload = false
  await refreshLiveOverview()
}
watch(hideTestAccounts, () => {
  if (dataSource.value === 'live') void refreshOverviewQueued()
})
watch(liveLoading, (loading) => {
  if (!loading && pendingOverviewReload && dataSource.value === 'live') {
    pendingOverviewReload = false
    void refreshLiveOverview()
  }
})
</script>

<style scoped>
.brief {
  padding: 20px;
  display: grid;
  gap: 16px;
  background: #f6f8fc;
  font-size: 14px;
  color: var(--mk-ink);
}
/* live 数据不可用时的空态 */
.brief--empty {
  min-height: 50vh;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  text-align: center;
}
.brief--loading {
  min-height: 50vh;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  text-align: center;
}
.brief-empty__retry {
  padding: 6px 18px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  color: var(--mk-muted);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}
.brief-empty__retry:hover { border-color: rgba(52, 120, 246, 0.45); color: var(--mk-blue); }

/* 简报头 */
.brief-head {
  display: grid;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: #fff;
}
.brief-head--warn { border-color: rgba(180, 83, 9, 0.3); background: linear-gradient(180deg, #fffdf7, #fff); }
.brief-head--muted { background: #fafbfd; }

.brief-head__verdict {
  display: flex;
  align-items: center;
  gap: 14px;
}
.brief-head__verdict h3 { margin: 0; font-size: 18px; }
.brief-head__verdict p { margin: 3px 0 0; color: var(--mk-muted); font-size: 13px; }

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
}
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
  border: 1px solid rgba(52, 120, 246, 0.28);
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
  border-color: rgba(52, 120, 246, 0.45);
}
.brief-actions__clear {
  margin: 0;
  padding-top: 10px;
  border-top: 1px dashed var(--mk-line);
  color: var(--mk-faint);
  font-size: 13px;
}

/* 三列 + KPI 行（KPI 全宽，下方三卡一行，动态全宽） */
.brief-grid {
  display: grid;
  grid-template-columns: 1.1fr 1.2fr 1fr;
  gap: 14px;
  align-items: stretch;
}
.brief-kpis {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}
.kpi {
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: #fff;
}
.kpi__label { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--mk-faint); }
.kpi__value {
  font-size: 22px;
  font-weight: 800;
  font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
}
.kpi__hint { font-size: 11px; color: var(--mk-faint); }
.kpi--clickable { cursor: pointer; transition: border-color 0.12s ease, transform 0.12s ease; }
.kpi--clickable:hover { border-color: rgba(52, 120, 246, 0.5); transform: translateY(-1px); }
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
/* 短卡（总结/用量）：等高拉伸时把末尾信息贴底，避免"卡片内空一大块" */
.brief-card > .wq:last-child,
.brief-card > .usage:last-child,
.brief-card > .brief-card__note:last-child { margin-top: auto; }
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
  accent-color: #3478f6;
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

/* LLM 用量与失败归因 */
.usage { display: grid; gap: 14px; }
.usage__big { display: grid; gap: 2px; }
.usage__big strong {
  font-size: 26px;
  font-weight: 800;
  font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
}
.usage__big span { font-size: 11.5px; color: var(--mk-faint); font-weight: 600; letter-spacing: 0.04em; }
.usage__big em { font-style: normal; font-size: 12.5px; color: var(--mk-muted); }
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
.trend__legend { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: var(--mk-faint); white-space: nowrap; }
.trend__dot { width: 7px; height: 7px; border-radius: 2px; display: inline-block; margin-right: 3px; }
.trend__dot--new { background: linear-gradient(180deg, #6aa0ff, #3d7cff); }
.trend__dot--done { background: linear-gradient(180deg, #34d399, #15803d); }
.trend { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.trend__col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; min-height: 0; border-radius: 8px; }
.trend__col--today { background: #f0f6ff; box-shadow: inset 0 0 0 1px rgba(52, 120, 246, 0.25); }
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
.funnel__node--idle { border-style: dashed; background: transparent; }
.funnel__node--idle strong { color: var(--mk-faint); }
.funnel__node--clickable { cursor: pointer; transition: border-color 0.12s ease; }
.funnel__node--clickable:hover { border-color: rgba(52, 120, 246, 0.5); }
.funnel__rate { font-size: 10.5px; font-weight: 800; color: var(--mk-faint); }

/* 脉搏 */
.pulse {
  display: flex;
  align-items: flex-end;
  gap: 2.5px;
  height: 84px;
  padding-top: 6px;
}
.pulse__bar {
  flex: 1 1 0;
  min-width: 4px;
  border-radius: 2.5px 2.5px 1px 1px;
  background: linear-gradient(180deg, #6aa0ff, #3d7cff);
  opacity: 0.9;
}
.pulse__bar--issue { background: linear-gradient(180deg, #f87171, #dc2626); opacity: 1; }
.pulse__bar--idle { background: #e6ebf4; }
.pulse__meta {
  display: flex;
  gap: 16px;
  font-size: 12.5px;
  color: var(--mk-muted);
}
.pulse__meta strong { color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.pulse__meta strong.is-bad { color: var(--mk-red); }
.pulse__axis {
  display: flex;
  justify-content: space-between;
  font-size: 9.5px;
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
}

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

@media (max-width: 1280px) and (min-width: 1001px) {
  /* 中等宽度：三列过渡为两列，KPI 与动态卡占整行 */
  .brief-grid { grid-template-columns: 1fr 1fr; }
  .brief-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .brief-card--feed { grid-column: 1 / -1; }
}

@media (max-width: 1000px) {
  .brief-grid { grid-template-columns: 1fr; }
  .brief-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* 4K：内容宽度兜底 + KPI 字号放大 */
@media (min-width: 2000px) {
  .brief { max-width: 1900px; margin: 0 auto; padding: 26px; }
  .kpi__label { font-size: 13px; }
  .kpi__value { font-size: 26px; }
  .kpi__hint { font-size: 13px; }
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
  .pulse__axis { font-size: 11px; }
}
@media (min-width: 2800px) {
  .brief { max-width: 2300px; padding: 32px; }
  .kpi__label { font-size: 15.5px; }
  .kpi__value { font-size: 30px; }
  .kpi__hint { font-size: 15.5px; }
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
  .pulse__axis { font-size: 12.5px; }
}
/* 3600+（zoom 1.3 档）：KPI/卡片延续 2800 放大节奏（约 1.17×），并补齐 2000/2800 未覆盖的卡片内文字（feed/pulse/trend/wq/usage/funnel） */
@media (min-width: 3600px) {
  .brief { max-width: 2700px; padding: 38px; }
  .kpi__label { font-size: 18px; }
  .kpi__value { font-size: 35px; }
  .kpi__hint { font-size: 18px; }
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
  .pulse__axis { font-size: 11px; }
}
</style>
