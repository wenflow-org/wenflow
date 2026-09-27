<template>
  <div class="state v2-page">
    <V2Nav />

    <main class="state__main">
      <!-- 页头 -->
      <div class="state__hero">
        <div>
          <h1>{{ heroTitle }}</h1>
          <p>基于你的学习记录实时评估。</p>
        </div>
        <!-- 2026-09-27：本页不再放「学习路径」入口（导航已有），hero 按钮改跳学习历史（原侧栏学习记录卡删除） -->
        <router-link to="/user/learning-history" class="btn-ghost">查看学习历史</router-link>
      </div>

      <!-- 体检卡（批19）：整体状态为主指标突出，学习压力/掌握趋势/疲劳程度降为行内状态条
           （原 4 张等权 KPI 卡墙）；读取失败/加载中各自有形态 -->
      <section class="card vitals" :class="{ 'vitals--fail': currentLoadFailed }">
        <div v-if="vitalsLoading" class="vitals__loading">
          <SkeletonLoader variant="lines" :count="2" />
        </div>
        <template v-else>
          <div class="vitals__main">
            <small>{{ vitalMain.label }}</small>
            <div class="vitals__value" :style="{ color: vitalMain.color }">
              {{ vitalMain.value }}<i v-if="vitalMain.unit"> {{ vitalMain.unit }}</i>
            </div>
            <span class="metric__note" :class="`metric__note--${vitalMain.tone}`">{{ vitalMain.note }}</span>
          </div>
          <div class="vitals__subs">
            <span v-for="m in vitalSubs" :key="m.key" class="vitals__sub">
              <small>{{ m.label }}</small>
              <b :style="{ color: m.color }">{{ m.value }}<i v-if="m.unit"> {{ m.unit }}</i></b>
              <span class="metric__note" :class="`metric__note--${m.tone}`">{{ m.note }}</span>
            </span>
          </div>
        </template>
      </section>

      <div class="state__grid">
        <div class="state__col" :class="{ 'state__col--empty': !hasAnyLoad }">
          <!-- 趋势图 -->
          <section class="card band">
            <div class="band__head">
              <button type="button" class="band__toggle" :aria-expanded="openBands.chart" @click="toggleBand('chart')">
                <strong>健康度 · 疲劳 · 状态</strong>
                <span class="band__meta">近 {{ range }} 天趋势</span>
                <span class="band__chev" :class="{ 'band__chev--open': openBands.chart }" aria-hidden="true">▾</span>
              </button>
              <div class="band__extra" @click.stop>
                <div class="seg">
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': range === 42 }" @click="setRange(42)">42 天</button>
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': range === 90 }" @click="setRange(90)">90 天</button>
                </div>
              </div>
            </div>
            <div v-show="openBands.chart" class="band__body">

            <!-- 图例（批19 术语自然化；2026-09-27 删状态 chip：与体检卡主指标重复） -->
            <div class="ff-legend">
              <span><i class="ff-dot ff-dot--fitness"></i>掌握趋势</span>
              <span><i class="ff-dot ff-dot--fatigue"></i>疲劳度</span>
              <span><i class="ff-dot ff-dot--lsb"></i>整体状态（掌握 − 疲劳）</span>
            </div>

            <div v-if="trendLoading" class="chart__loading"><SkeletonLoader variant="lines" :count="3" /></div>
            <div v-else-if="trendError" class="chart__empty">
              <strong>学习状态数据加载失败</strong>
              <p>网络或服务暂时不可用，稍后再试。</p>
              <button type="button" class="chart__retry" @click="loadTrends">重试</button>
            </div>
            <div v-else-if="!hasAnyLoad" class="chart__empty">
              <strong>学习状态正在积累中</strong>
              <p>完成第一个任务后开始记录，连续学习约 3 天即可看到掌握趋势、疲劳度与整体状态曲线。</p>
            </div>
            <template v-else>
              <div class="ff-chart" @mousemove="onChartHover" @mouseleave="hoverDay = null">
                <svg :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="none" aria-hidden="true">
                  <!-- 横向网格线（2026-09-27 外部评审：原来没有任何坐标参照，曲线悬空感） -->
                  <g class="ff-grid">
                    <line
                      v-for="i in 5" :key="i"
                      :x1="0" :x2="chartW"
                      :y1="(chartH / 4) * (i - 1)" :y2="(chartH / 4) * (i - 1)"
                      vector-effect="non-scaling-stroke"
                    />
                  </g>
                  <rect
                    v-for="p in points" :key="p.date"
                    class="ff-bar"
                    :x="p.bx" :y="p.by" :width="barW" :height="p.bh" rx="1.5"
                  />
                  <path v-if="lsbLineD" :d="lsbLineD" class="ff-line ff-line--lsb" />
                  <path v-if="ktlLineD" :d="ktlLineD" class="ff-line ff-line--fitness" />
                  <path v-if="lfLineD" :d="lfLineD" class="ff-line ff-line--fatigue" />
                  <template v-if="hoverDay">
                    <line class="ff-cursor" :x1="hoverDay.x" :x2="hoverDay.x" y1="0" :y2="chartH" />
                    <circle v-if="hoverDay.ky !== null" class="ff-pt ff-pt--fitness" :cx="hoverDay.x" :cy="hoverDay.ky" r="4" />
                    <circle v-if="hoverDay.ly !== null" class="ff-pt ff-pt--fatigue" :cx="hoverDay.x" :cy="hoverDay.ly" r="4" />
                    <circle v-if="hoverDay.sy !== null" class="ff-pt ff-pt--lsb" :cx="hoverDay.x" :cy="hoverDay.sy" r="4" />
                  </template>
                </svg>
              </div>
              <div v-if="displayDay" class="ff-info">
                <b>{{ displayDay.label }}</b>
                <span>时长 {{ displayDay.minutes }} 分钟</span>
                <span class="ff-info__fitness">掌握 {{ displayDay.ktl ?? '—' }}</span>
                <span class="ff-info__fatigue">疲劳 {{ displayDay.lf ?? '—' }}</span>
                <span>状态 {{ displayDay.lsb ?? '—' }}（{{ displayDay.zone?.label || '暂无' }}）</span>
              </div>
              <!-- ff-zones 三档阈值行已删（2026-09-27）：口径折进侧栏「指标说明」，图上一行字不占 -->
            </template>
            </div><!-- /band__body -->
          </section>

          <!-- AI 建议（skill: adaptive-guidance-copy 生成，静态规则兜底） -->
          <section class="card band">
            <div class="band__head">
              <button type="button" class="band__toggle" :aria-expanded="openBands.suggest" @click="toggleBand('suggest')">
                <strong>AI 建议</strong>
                <span class="band__meta">{{ suggestSource }}</span>
                <span class="band__chev" :class="{ 'band__chev--open': openBands.suggest }" aria-hidden="true">▾</span>
              </button>
            </div>
            <!-- 加载失败常显（收起也不许吞掉错误，P1 口径） -->

            <!-- skill 生成块 -->
            <!-- P1 修复：guidance 加载失败可见提示（可原地重试，不再冒充"没有数据"） -->
            <div v-if="guidanceLoadFailed" class="chart__empty" role="alert">
              AI 建议暂时取不到（生成较慢或失败）。
              <button type="button" class="guide-retry" :disabled="guidanceLoading" @click="loadGuidance">
                {{ guidanceLoading ? '重试中…' : '重试' }}
              </button>
            </div>
            <div v-show="openBands.suggest" class="band__body">
            <template v-if="skillCopy">
              <div class="guide">
                <h3 class="guide__title">{{ skillCopy.headline }}</h3>
                <p v-if="skillCopy.subtitle" class="guide__sub">{{ skillCopy.subtitle }}</p>
                <p v-if="evidenceHint" class="guide__evidence">依据：{{ evidenceHint }}（详见下方「学习调控」）</p>
              </div>
              <div v-if="skillWarning" class="guide__warn">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 7 12H5l7-12zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z"/></svg>
                {{ skillWarning }}
              </div>
              <div v-if="guideActions.length" class="suggest__list">
                <article v-for="(a, i) in guideActions" :key="i" class="sug">
                  <span class="sug__icon" :style="{ background: a.bg, color: a.ink }" v-html="a.icon"></span>
                  <div class="sug__body">
                    <strong>{{ a.title }}</strong>
                    <p v-if="a.desc">{{ a.desc }}</p>
                  </div>
                  <router-link :to="a.resolved" class="sug__cta">{{ a.action || '前往' }}</router-link>
                </article>
              </div>
              <div class="guide__foot">
                <span v-if="skillCopy.nextStep"><b>下一步</b>{{ skillCopy.nextStep }}</span>
                <span v-if="skillCopy.paceHint"><b>节奏</b>{{ skillCopy.paceHint }}</span>
              </div>
            </template>

            <!-- 状态评审诊断（diagnosis 层，Slice 2c）：评审向的行话默认收起（2026-09-27 降噪） -->
            <section v-if="reviewNarrative || reviewInsights.length" class="review">
              <button type="button" class="review__toggle" :aria-expanded="reviewOpen" @click="reviewOpen = !reviewOpen">
                <h3 class="review__title">状态评审</h3>
                <span class="review__src">{{ reviewSource === 'model' ? 'AI 诊断' : '规则' }}</span>
                <span class="band__chev" :class="{ 'band__chev--open': reviewOpen }" aria-hidden="true">▾</span>
              </button>
              <div v-show="reviewOpen" class="review__body">
                <p v-if="reviewReliabilityText" class="review__rel">{{ reviewReliabilityText }}</p>
                <p v-if="reviewNarrative" class="review__narrative">{{ reviewNarrative }}</p>
                <ul v-if="reviewInsights.length" class="review__list">
                  <li v-for="(it, i) in reviewInsights" :key="i" class="review__item">
                    <strong>{{ it.claim }}</strong>
                    <span v-if="it.action" class="review__action">{{ it.action }}</span>
                  </li>
                </ul>
              </div>
            </section>

            <!-- 静态规则兜底块 -->
            <template v-else>
              <div v-if="!suggestionCards.length" class="chart__empty">
                {{ guidanceLoadFailed
                  ? 'AI 建议暂时取不到，可点上方重试。'
                  : (hasAnyLoad ? '当前没有特别建议，保持节奏就好。' : '完成第一次学习后，这里会出现 AI 建议。') }}
              </div>
              <div v-else class="suggest__list">
                <article v-for="(s, i) in suggestionCards" :key="i" class="sug" :class="`sug--${s.level}`">
                  <span class="sug__icon" :style="{ background: s.bg, color: s.ink }" v-html="s.icon"></span>
                  <div class="sug__body">
                    <strong>{{ s.title }}</strong>
                    <p>{{ s.message }}</p>
                  </div>
                  <router-link v-if="s.to" :to="s.to" class="sug__cta">{{ s.cta }}</router-link>
                </article>
              </div>
            </template>

            </div><!-- /band__body：预警常显，不随折叠消失 -->

            <!-- 预警（数据告警，两种模式都展示） -->
            <div v-if="warningsLoadFailed" class="chart__empty" role="alert">
              预警数据加载失败，请刷新页面重试。
            </div>
            <div v-if="skillCopy && warningRows.length" class="suggest__list suggest__list--warnings">
              <article v-for="(w, i) in warningRows" :key="i" class="sug" :class="`sug--${w.level}`">
                <span class="sug__icon" :style="{ background: w.bg, color: w.ink }" v-html="w.icon"></span>
                <div class="sug__body">
                  <strong>{{ w.title }}</strong>
                  <p>{{ w.message }}</p>
                </div>
              </article>
            </div>
          </section>

          <!-- 学习调控（2026-09-27 重构）：待你确认 / 已自动处理 / 已执行的调整。
               原「AI 决策记录」是纯日志；现在待确认卡带 pathId + advisory 摘要，
               本页成为完课卡之外的第二确认入口。 -->
          <section class="card band">
            <div class="band__head">
              <button type="button" class="band__toggle" :aria-expanded="openBands.decisions" @click="toggleBand('decisions')">
                <strong>学习调控</strong>
                <span class="band__meta">{{ pendingAdjust.length ? `${pendingAdjust.length} 条待确认` : '暂无待确认' }}</span>
                <span class="band__chev" :class="{ 'band__chev--open': openBands.decisions }" aria-hidden="true">▾</span>
              </button>
            </div>
            <div v-show="openBands.decisions" class="band__body">
              <!-- 待你确认：课后 advisory，确认走与完课卡同一个 replan 接口 -->
              <section class="ctl">
                <p class="ctl__label">待你确认<b v-if="pendingAdjust.length">{{ pendingAdjust.length }}</b></p>
                <p v-if="!pendingAdjust.length" class="ctl__empty">没有待处理的调整。课后 AI 认为需要调整时，会在这里出现，你可以在这里确认或忽略。</p>
                <article v-for="card in pendingAdjust" :key="card.id" class="ctl-card">
                  <header class="ctl-card__head">
                    <span class="dec__tag dec__tag--blue">{{ card.pathTitle || '当前路径' }}</span>
                    <span v-if="card.mergedCount && card.mergedCount > 1" class="ctl-card__merged">近 {{ card.mergedCount }} 次课反复提示</span>
                    <time v-if="decisionTime(card.at)">{{ decisionTime(card.at) }}</time>
                  </header>
                  <p class="ctl-card__body">{{ card.body || card.judgment }}</p>
                  <p class="ctl-card__evidence">依据：{{ card.captured }}</p>
                  <div v-if="confirmingId !== card.id" class="ctl-card__actions">
                    <button type="button" class="ctl-btn ctl-btn--primary" :disabled="replanBusy" @click="confirmingId = card.id">确认调整</button>
                    <button type="button" class="ctl-btn" :disabled="!card.pathId" @click="jumpToAdjust(card)">查看建议</button>
                    <button type="button" class="ctl-btn ctl-btn--ghost" @click="dismissDecision(card)">保持原计划</button>
                  </div>
                  <div v-else class="ctl-card__confirm">
                    <span>这会调整该路径的后续阶段安排，已完成内容保留不变。</span>
                    <button type="button" class="ctl-btn ctl-btn--primary" :disabled="replanBusy" @click="confirmAdjust(card)">{{ replanBusy ? '正在调整…' : '确认' }}</button>
                    <button type="button" class="ctl-btn ctl-btn--ghost" @click="confirmingId = ''">取消</button>
                  </div>
                </article>
              </section>

              <!-- 系统已自动处理：一句话一条，不再捕获/判断/动作三行铺开 -->
              <section v-if="autoHandled.length" class="ctl">
                <p class="ctl__label">系统已自动处理<b>{{ autoHandled.length }}</b></p>
                <ul class="ctl__rows">
                  <li v-for="card in autoHandled" :key="card.id">
                    <span class="dec__tag" :class="decisionKindMeta[card.kind]?.cls">{{ decisionKindMeta[card.kind]?.label }}</span>
                    <span class="ctl__row-text">{{ card.captured }}。{{ card.action }}</span>
                  </li>
                </ul>
              </section>

              <!-- 已执行的调整：replan 历史 -->
              <section v-if="replannedRows.length" class="ctl">
                <p class="ctl__label">已执行的调整<b>{{ replannedRows.length }}</b></p>
                <ul class="ctl__rows">
                  <li v-for="card in replannedRows" :key="card.id">
                    <span class="dec__tag dec__tag--purple">已调整</span>
                    <span class="ctl__row-text">{{ card.captured }}。{{ card.action }}</span>
                    <time v-if="decisionTime(card.at)" class="ctl__row-time">{{ decisionTime(card.at) }}</time>
                  </li>
                </ul>
              </section>
            </div><!-- /band__body -->
          </section>
        </div>

        <!-- 侧栏 -->
        <aside class="side">
          <!-- P1 修复：learnerCenter 失败提示 -->
          <section v-if="learnerCenterLoadFailed" class="card sidecard" role="alert">
            <span class="kicker">学习画像</span>
            <p class="chart__empty">画像数据加载失败，请刷新页面重试。</p>
          </section>
          <section v-if="preferenceItems.length && hasAnyLoad" class="card band sidecard">
            <div class="band__head">
              <button type="button" class="band__toggle" :aria-expanded="openBands.prefs" @click="toggleBand('prefs')">
                <span class="kicker">学习偏好</span>
                <span class="band__meta">{{ preferenceItems.length }} 项</span>
                <span class="band__chev" :class="{ 'band__chev--open': openBands.prefs }" aria-hidden="true">▾</span>
              </button>
            </div>
            <div v-show="openBands.prefs" class="band__body">
              <ul class="pref">
                <li v-for="(p, i) in preferenceItems" :key="i"><strong>{{ p.label }}</strong><span>{{ p.value }}</span></li>
              </ul>
            </div>
          </section>
          <!-- 2026-09-27：独立「学习记录」卡删除——整卡只有一个链接，入口上移到 hero 按钮 -->
          <section class="card band sidecard">
            <div class="band__head">
              <button type="button" class="band__toggle" :aria-expanded="openBands.legend" @click="toggleBand('legend')">
                <span class="kicker">指标说明</span>
                <span class="band__chev" :class="{ 'band__chev--open': openBands.legend }" aria-hidden="true">▾</span>
              </button>
            </div>
            <div v-show="openBands.legend" class="band__body">
            <ul class="legend">
              <li><b class="dot dot--blue"></b>掌握趋势：长期学习积累的掌握水平，变化平缓（曲线里的 KTL）</li>
              <li><b class="dot dot--purple"></b>疲劳度：近期学习压力的累积，变化较快（曲线里的 LF）</li>
              <li><b class="dot dot--green"></b>整体状态＝掌握 − 疲劳（曲线里的 LSB）：≥40 精力充沛 · 20–39 最优训练区 · &lt;20 需要休息</li>
              <li><b class="dot dot--amber"></b>保持规律学习让掌握趋势稳步上升；疲劳偏高时安排休息，避免长期处于低状态区</li>
            </ul>
            </div><!-- /band__body -->
          </section>
        </aside>
      </div>
    </main>

    <!-- AI 生成提示 + 页脚：一起沉底 -->
    <div class="state__foot">
      <div class="state__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import request from '@/utils/api';
import { toast } from '@/utils/toast';
import { metricsAPI } from '@/api/metrics';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import V2Footer from './V2Footer.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
import { localDateKeyFromIso } from '@/utils/date';
import { unwrap, unwrapArray } from './unwrap';

type MetricKey = 'lsb' | 'lss' | 'ktl' | 'lf';

const current = ref<Record<string, any> | null>(null);
const warnings = ref<Array<Record<string, any>>>([]);
const trendLoading = ref(true);
const trendError = ref(false);
const range = ref<42 | 90>(42);

/* ---------- 折叠带（批11 首屏重构）：桌面默认全开展示，移动端默认只留
   「结论（指标卡）+ 学习曲线 + AI 建议」首屏，长尾内容（决策/偏好/说明）收起。
   折叠状态在挂载时按视口定一次，之后手动切换不随视口变化。 ---------- */
const isNarrowAtMount = typeof window !== 'undefined'
  && window.matchMedia('(max-width: 1100px)').matches;
const openBands = ref({
  chart: true,                 // 趋势图是本页核心，任何宽度都默认展开
  suggest: true,               // AI 建议是本页最可行动的内容，全宽度默认展开（批19 从移动端收起改为常开）
  decisions: true,             // 学习调控（2026-09-27 升级为可操作调控流）：待确认项必须可见
  prefs: !isNarrowAtMount,     // 学习偏好：PC 常开（2026-09-27 用户反馈），窄屏收起省密度
  legend: !isNarrowAtMount,    // 指标说明：PC 常开（2026-09-27 用户反馈），窄屏收起
});
const reviewOpen = ref(false);
function toggleBand(key: keyof typeof openBands.value) {
  openBands.value[key] = !openBands.value[key];
}

const metricOptions: Array<{ key: MetricKey; label: string }> = [
  { key: 'lsb', label: '整体状态' },
  { key: 'lss', label: '学习压力' },
  { key: 'ktl', label: '掌握趋势' },
  { key: 'lf', label: '疲劳程度' }
];

function toneOf(key: MetricKey, v: number): { tone: string; color: string; note: string } {
  if (v === null || v === undefined || Number.isNaN(v)) return { tone: 'blue', color: 'var(--muted)', note: '积累中' };
  if (key === 'lsb') {
    // LSB = KTL - LF（-100 ~ +100），分档对齐后端 <0/<20/<40/≥40 与 heroTitle 文案
    if (v < 0) return { tone: 'red', color: 'var(--red-ink)', note: '严重疲劳，优先休息' };
    if (v >= 40) return { tone: 'green', color: 'var(--green-ink)', note: '精力充沛' };
    if (v >= 20) return { tone: 'blue', color: 'var(--blue-deep)', note: '最优训练区' };
    return { tone: 'amber', color: 'var(--amber-ink)', note: '需要休息' };
  }
  if (key === 'ktl') {
    if (v > 0) return { tone: 'purple', color: 'var(--accent)', note: '上升' };
    if (v === 0) return { tone: 'blue', color: 'var(--blue-deep)', note: '持平' };
    return { tone: 'amber', color: 'var(--amber-ink)', note: '下降' };
  }
  // lss / lf 越低越好
  if (v <= 35) return { tone: 'green', color: 'var(--green-ink)', note: key === 'lss' ? '适中' : '较低' };
  if (v <= 65) return { tone: 'amber', color: 'var(--amber-ink)', note: key === 'lss' ? '偏高' : '偏高' };
  return { tone: 'red', color: 'var(--red-ink)', note: '过高' };
}

const metricCards = computed(() =>
  metricOptions.map((m) => {
    // P1 修复：加载失败显示「读取失败」而非伪装「暂无数据」
    if (currentLoadFailed.value) {
      return { ...m, value: '—', unit: m.key === 'lsb' ? '' : '分', tone: 'red', color: 'var(--red-ink)', note: '读取失败' };
    }
    const v = current.value?.[m.key];
    const t = toneOf(m.key, v);
    return { ...m, value: v ?? '—', unit: m.key === 'lsb' ? '' : '分', ...t };
  })
);

/* 体检卡（批19）：主指标=整体状态，其余三项行内条 */
const vitalsLoading = computed(() => current.value === null && !currentLoadFailed.value);
const vitalMain = computed(() => metricCards.value[0]);
const vitalSubs = computed(() => metricCards.value.slice(1));

const heroTitle = computed(() => {
  const lsb = current.value?.lsb;
  if (lsb == null) return '先来看看你的状态';
  if (lsb >= 70) return '状态不错，继续保持';
  if (lsb >= 40) return '状态平稳，循序渐进';
  return '需要调整一下节奏';
});

/* ---------- 状态趋势（权威口径：后端 /state/trends，LSS/KTL/LF/LSB，与指标卡同源） ----------
   此前趋势图在前端用「纯时长 EWMA（42/7 天）」自算 fitness/fatigue/form，与指标卡的
   LSS/KTL/LF/LSB（质量合成）是两套孤儿模型，且图例文案（13.5 天/2 天）与代码矛盾。
   现统一为后端权威趋势，删除前端自算。 */
interface Zone {
  cls: 'fresh' | 'optimal' | 'risk';
  label: string;
}

interface TrendPoint {
  date: string;
  label: string;
  ktl: number | null;   // 掌握趋势
  lf: number | null;    // 疲劳
  lsb: number | null;   // 整体状态 = KTL − LF
  minutes: number;      // 当日时长（仅展示背景柱，不参与状态计算）
  zone: Zone | null;
  x: number;
  ky: number | null;
  ly: number | null;
  sy: number | null;
  bx: number;
  by: number;
  bh: number;
}

const dailyLoad = ref<Array<{ date: string; minutes: number }>>([]);
const stateTrends = ref<Array<{ date: string; ktl: number | null; lf: number | null; lsb: number | null }>>([]);

/** 分区基于 LSB（对齐 learning-state.service：LSB = KTL − LF，0-100） */
function zoneOfLsb(lsb: number | null): Zone | null {
  if (lsb === null) return null;
  if (lsb >= 40) return { cls: 'fresh', label: '精力充沛' };
  if (lsb >= 20) return { cls: 'optimal', label: '最优训练区' };
  if (lsb >= 0) return { cls: 'risk', label: '需要休息' };
  return { cls: 'risk', label: '高风险区' };
}

/* 窗口自适应：左侧从最早数据日 -2 天开始，今天右侧留 2 天余量（新值不贴右边缘） */
const RIGHT_MARGIN = 2;

const earliestDataOffset = computed(() => {
  let earliest = 0;
  for (const d of dailyLoad.value) {
    if (d.minutes > 0) {
      const days = Math.round((Date.now() - new Date(d.date + 'T00:00:00').getTime()) / 86400000);
      earliest = Math.max(earliest, days);
    }
  }
  return earliest;
});

const windowStartOffset = computed(() => {
  // 数据少时窗口自动收缩（但至少约一周）；数据多时用满所选范围
  const base = Math.min(range.value - 1, earliestDataOffset.value + 2);
  return Math.max(base, 7);
});

const series = computed<Array<Omit<TrendPoint, 'x' | 'ky' | 'ly' | 'sy' | 'bx' | 'by' | 'bh'>>>(() => {
  const loadMap = new Map(dailyLoad.value.map((d) => [d.date, d.minutes]));
  const trendMap = new Map(stateTrends.value.map((t) => [t.date, t]));
  const days: Array<Omit<TrendPoint, 'x' | 'ky' | 'ly' | 'sy' | 'bx' | 'by' | 'bh'>> = [];
  for (let i = windowStartOffset.value; i >= -RIGHT_MARGIN; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = trendMap.get(key) ?? null;
    const lsb = t?.lsb ?? null;
    days.push({
      date: key,
      label: `${d.getMonth() + 1}月${d.getDate()}日`,
      ktl: t?.ktl ?? null,
      lf: t?.lf ?? null,
      lsb,
      minutes: loadMap.get(key) ?? 0,
      zone: zoneOfLsb(lsb)
    });
  }
  return days;
});

const hasAnyLoad = computed(() => stateTrends.value.some((t) => t.lsb !== null));

const chartW = 760;
const chartH = 240;
const chartPad = 8;

/* 2026-09-27 外部视觉评审修复：
   ① 裁掉开头无数据日（原来 42 天窗口里曲线只占右侧 40%，左侧空旷悬空）；
   ② y 轴改动态量程（原来固定 0-100，40-50 的曲线压成一条扁线）；
   ③ 活动柱（时长）用自己的刻度且封顶 28% 图高——原来复用指标刻度，
      分钟数大的日子柱条直接画穿画布（y=-7238 那种）。 */
const activeSeries = computed(() => {
  const days = series.value;
  const first = days.findIndex((d) => d.ktl !== null || d.lf !== null || d.lsb !== null || d.minutes > 0);
  if (first <= 1) return days;
  return days.slice(Math.max(0, first - 2));
});

const valueDomain = computed(() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of activeSeries.value) {
    for (const v of [d.ktl, d.lf, d.lsb]) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) return { lo: 0, hi: 100 };
  const pad = Math.max(5, (hi - lo) * 0.18);
  return { lo: Math.max(0, lo - pad), hi: hi + pad };
});

const maxMinutes = computed(() => Math.max(10, ...activeSeries.value.map((d) => d.minutes)));

const points = computed<TrendPoint[]>(() => {
  const n = activeSeries.value.length;
  const usableW = chartW - chartPad * 2;
  const step = n > 1 ? usableW / (n - 1) : 0;
  const { lo, hi } = valueDomain.value;
  const span = hi - lo || 1;
  const yOf = (v: number) => chartH - ((v - lo) / span) * chartH;
  const barCap = chartH * 0.28;
  return activeSeries.value.map((d, i) => {
    const x = chartPad + step * i;
    const bh = Math.min(barCap, (d.minutes / maxMinutes.value) * barCap);
    return {
      ...d,
      x,
      ky: d.ktl !== null ? yOf(d.ktl) : null,
      ly: d.lf !== null ? yOf(d.lf) : null,
      sy: d.lsb !== null ? yOf(d.lsb) : null,
      bx: x - barW.value / 2,
      by: chartH - bh,
      bh
    };
  });
});

const barW = computed(() => {
  const n = activeSeries.value.length || 1;
  return Math.max(2, Math.min(10, ((chartW - chartPad * 2) / n) * 0.55));
});

/** 单线路径：跳过 null 断点（无数据日不连线） */
function linePath(key: 'ktl' | 'lf' | 'lsb') {
  const pts = points.value;
  if (!pts.length) return '';
  const parts: string[] = [];
  let pen: string | null = null;
  for (const p of pts) {
    const y = key === 'ktl' ? p.ky : key === 'lf' ? p.ly : p.sy;
    if (y === null) { pen = null; continue; }
    if (pen === null) {
      parts.push(`M${p.x.toFixed(1)},${y.toFixed(1)}`);
      pen = 'L';
    } else {
      parts.push(`L${p.x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  return parts.join(' ');
}

const ktlLineD = computed(() => linePath('ktl'));
const lfLineD = computed(() => linePath('lf'));
const lsbLineD = computed(() => linePath('lsb'));

/** 今天本地日期键（与 series 同格式）。图表右侧 2 天是刻意的留白（非真实数据日），
    「当前状态」必须落在今天而非留白日，否则会展示一个未来日期的空数据。 */
const todayKey = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

const latestDay = computed<TrendPoint | null>(() => {
  const hit = points.value.find((p) => p.date === todayKey.value);
  if (hit) return hit;
  const past = points.value.filter((p) => p.date <= todayKey.value);
  return (past.length ? past[past.length - 1] : points.value[points.value.length - 1]) ?? null;
});
const hoverDay = ref<TrendPoint | null>(null);
const displayDay = computed<TrendPoint | null>(() => hoverDay.value ?? latestDay.value);

function onChartHover(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const relX = ((e.clientX - rect.left) / rect.width) * chartW;
  let best: TrendPoint | null = null;
  let bestDist = Infinity;
  for (const p of points.value) {
    const dist = Math.abs(p.x - relX);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  hoverDay.value = best;
}

let trendSeq = 0;
async function loadTrends() {
  const seq = ++trendSeq;
  trendLoading.value = true;
  try {
    // 权威口径：后端 /state/trends（LSS/KTL/LF/LSB，与指标卡同源），替代前端自算 EWMA
    const [trendRes, sessionRes] = await Promise.all([
      request.get('/state/trends', { params: { days: range.value, range: 'recent' } }),
      request.get('/users/me/sessions', { params: { limit: 500 } })
    ]);
    if (seq !== trendSeq) return;
    const trendData = unwrap<{ trends?: Array<{ date: string; lss: number | null; ktl: number | null; lf: number | null; lsb: number | null }> }>(trendRes);
    stateTrends.value = (trendData?.trends || []).map((t) => ({
      // 后端回的是本地零点 Date 的 ISO 序列化（UTC），必须按本地时区还原，
      // 否则 UTC+8 会整体前移一天（与 V2LearningHistory 同一口径问题）
      date: localDateKeyFromIso(String(t.date)),
      ktl: typeof t.ktl === 'number' ? t.ktl : null,
      lf: typeof t.lf === 'number' ? t.lf : null,
      lsb: typeof t.lsb === 'number' ? t.lsb : null
    }));
    // 当日时长背景柱：仅展示，不参与状态计算（口径不冲突）
    const list = unwrapArray(sessionRes);
    const map = new Map<string, number>();
    for (const s of list) {
      const key = localDateKeyFromIso(typeof s.startTime === 'string' ? s.startTime : null);
      if (!key) continue;
      const duration = typeof s.durationMinutes === 'number' ? s.durationMinutes : 0;
      map.set(key, (map.get(key) ?? 0) + duration);
    }
    dailyLoad.value = [...map.entries()].map(([date, minutes]) => ({ date, minutes }));
    trendError.value = false;
  } catch {
    // 只有最新一次请求的失败才展示错误态（旧请求的失败不覆盖新结果）
    if (seq !== trendSeq) return;
    trendError.value = true;
    stateTrends.value = [];
    dailyLoad.value = [];
  } finally {
    if (seq === trendSeq) trendLoading.value = false;
  }
}

function setRange(r: 42 | 90) {
  range.value = r;
  void loadTrends();
}

/* ---------- skill 引导（adaptive-guidance-copy, view=learning-state） ---------- */
const guidance = ref<Record<string, any> | null>(null);

const router = useRouter();
const skillCopy = computed(() => guidance.value?.copy || null);

/* ---------- 状态评审诊断（diagnosis 层，Slice 2c） ---------- */
const reviewDiagnosis = computed(() => guidance.value?.review?.diagnosis || null);
const reviewSource = computed(() => guidance.value?.review?.source || null);
const reviewNarrative = computed(() => reviewDiagnosis.value?.narrative || '');
const reviewInsights = computed<Array<{ type: string; claim: string; action: string }>>(() =>
  Array.isArray(reviewDiagnosis.value?.insights) ? reviewDiagnosis.value.insights : []
);
const reviewCalibration = computed(() => guidance.value?.review?.calibration || null);
const reviewReliabilityText = computed(() => {
  const c = reviewCalibration.value;
  if (!c || !c.n) return '';
  if (c.hitRate == null) return `历史核对 ${c.n} 条 · 样本不足`;
  return `历史核对 ${c.n} 条 · 命中 ${Math.round(c.hitRate * 100)}%`;
});

/* ---------- 学习调控（2026-09-27 重构）：待确认 / 已自动处理 / 已执行的调整 ----------
   原「AI 决策记录」是纯日志；现在 path-adjust 卡带 pathId + advisory 摘要，
   本页成为完课卡之外的第二确认入口。 */
interface DecisionOption {
  key: string;
  label: string;
  description?: string;
}

interface DecisionCard {
  id: string;
  kind: 'path-adjust' | 'path-replanned' | 'kp-carryover' | 'concept-watch' | 'pace';
  captured: string;
  judgment: string;
  action: string;
  priority: 'high' | 'medium' | 'low' | 'info';
  at: string | null;
  pathId?: string | null;
  pathTitle?: string | null;
  recommendation?: string | null;
  body?: string;
  options?: DecisionOption[];
  advisory?: Record<string, any>;
  mergedCount?: number;
}

const decisions = computed<DecisionCard[]>(() =>
  Array.isArray(guidance.value?.decisions) ? guidance.value.decisions : []
);

const decisionKindMeta: Record<string, { label: string; cls: string }> = {
  'path-adjust': { label: '路径调整', cls: 'dec__tag--blue' },
  'path-replanned': { label: '路径调整', cls: 'dec__tag--purple' },
  'kp-carryover': { label: '课程延续', cls: 'dec__tag--cyan' },
  'concept-watch': { label: '持续关注', cls: 'dec__tag--amber' },
  'pace': { label: '节奏调控', cls: 'dec__tag--green' }
};

function decisionTime(at: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* 三段分组：待确认（可操作，可忽略消账）/ 已自动处理 / 已执行 */
const DISMISS_KEY = 'learning_state_dismissed_advisories';
const dismissedAdvisories = ref<string[]>((() => {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[]; } catch { return []; }
})());
function dismissDecision(card: DecisionCard) {
  dismissedAdvisories.value = [...dismissedAdvisories.value, card.id];
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissedAdvisories.value)); } catch { /* ignore */ }
  confirmingId.value = '';
}

const pendingAdjust = computed(() =>
  decisions.value.filter((d) => d.kind === 'path-adjust' && !dismissedAdvisories.value.includes(d.id))
);
const autoHandled = computed(() =>
  decisions.value.filter((d) => d.kind === 'kp-carryover' || d.kind === 'concept-watch' || d.kind === 'pace')
);
const replannedRows = computed(() => decisions.value.filter((d) => d.kind === 'path-replanned'));

/* AI 建议区的依据行：与待确认调控互相引用（此前两块各自为政） */
const evidenceHint = computed(() => pendingAdjust.value[0]?.captured || '');

/* 内联确认：与完课卡同一个 replan 接口、同一份 evidence 语义 */
const confirmingId = ref('');
const replanBusy = ref(false);
const REPLAN_REASON: Record<string, string> = {
  reinforce: '根据课后建议，为下一阶段补强关键薄弱点',
  resequence: '根据课后建议，调整下一阶段顺序以降低理解风险',
  accelerate: '根据课后建议，压缩下一阶段以加快推进',
  slow_down: '根据课后建议，放慢下一阶段节奏'
};

async function confirmAdjust(card: DecisionCard) {
  if (!card.pathId || replanBusy.value) return;
  replanBusy.value = true;
  try {
    await request.post(`/learning/paths/${card.pathId}/replan`, {
      triggerSource: 'ai-teaching',
      mode: 'overwrite',
      reason: REPLAN_REASON[card.recommendation || 'reinforce'] || '根据课后建议调整后续阶段',
      requireConfirmation: false,
      evidence: { advisoryAction: card.recommendation || 'reinforce', advisory: card.advisory || null }
    });
    toast.success(`已调整「${card.pathTitle || '当前路径'}」的后续阶段`);
    dismissDecision(card);
  } catch (e: any) {
    toast.error(e?.message || '调整失败，请稍后再试');
  } finally {
    replanBusy.value = false;
  }
}

function jumpToAdjust(card: DecisionCard) {
  if (!card.pathId) return;
  router.push({ path: `/learning-path/${card.pathId}`, query: { adjust: 'ai' } });
}

const suggestSource = computed(() => {
  if (!guidance.value) return '系统建议';
  if (guidance.value.source === 'model') return 'AI 生成';
  return '系统建议';
});

const skillWarning = computed(() => {
  const w = skillCopy.value?.warningCopy;
  return w && w !== '当前没有明显风险。' ? w : '';
});

const svgPlay = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const svgLayers = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 2 10 5-10 5L2 7l10-5zm0 7.6L18.9 7 12 4.4 5.1 7 12 9.6zM2 12l10 5 10-5v2l-10 5L2 14v-2zm0 5 10 5 10-5v2l-10 5L2 19v-2z" opacity=".9"/></svg>';
const svgPlus = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>';
const svgMedal2 = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2z"/></svg>';
const svgHome = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 3 9 8h-3v9h-4v-6h-4v6H6v-9H3l9-8z"/></svg>';

const guideActions = computed(() => {
  const list = skillCopy.value?.todayActions;
  if (!Array.isArray(list)) return [];
  const pathId = guidance.value?.summary?.path?.pathId || null;
  const taskId = guidance.value?.summary?.path?.taskId || null;
  const resolve = (to?: string): string => {
    switch (to) {
      case 'continue-learning': {
        // 2026-09-27：直达当前任务（summary.path.taskId），不再落路径详情页多一跳
        if (taskId) return pathId ? `/learn/${taskId}?pathId=${pathId}` : `/learn/${taskId}`;
        return pathId ? `/learning-path/${pathId}` : '/dashboard';
      }
      case 'path-detail':
        return pathId ? `/learning-path/${pathId}` : '/learning-paths';
      case 'learning-state':
        return '/learning-state';
      case 'achievements':
        return '/user/achievements';
      case 'create-goal':
        return '/goal-conversation';
      default:
        return '/dashboard';
    }
  };
  const iconFor = (to?: string) => {
    if (to === 'path-detail') return { icon: svgLayers, bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)' };
    if (to === 'achievements') return { icon: svgMedal2, bg: 'color-mix(in srgb, var(--accent) 13%, transparent)', ink: 'var(--purple-ink)' };
    if (to === 'create-goal') return { icon: svgPlus, bg: 'color-mix(in srgb, var(--cyan) 14%, transparent)', ink: '#3593b5' };
    if (to === 'learning-state') return { icon: svgBulb, bg: 'color-mix(in srgb, var(--amber) 16%, transparent)', ink: 'var(--amber-ink)' };
    if (to === 'continue-learning') return { icon: svgPlay, bg: 'rgba(49,177,111,.12)', ink: 'var(--green-ink)' };
    return { icon: svgHome, bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)' };
  };
  const seen = new Set<string>();
  return list
    .map((item: Record<string, any>) => {
      const resolved = resolve(item?.to);
      return {
        title: String(item?.title || '继续学习'),
        desc: String(item?.desc || ''),
        action: String(item?.action || '前往'),
        resolved,
        ...iconFor(item?.to)
      };
    })
    .filter((a) => {
      // 去重（标题相同只留第一条）+ 过滤指向当前页的动作
      const key = a.title;
      if (seen.has(key) || a.resolved === '/learning-state') return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
});

/* 预警行（skill 模式下追加展示） */
const warningRows = computed(() =>
  warnings.value.slice(0, 3).map((w) => {
    const isCritical = w.level === 'critical';
    return {
      title: w.title || '学习预警',
      message: w.message || w.suggestion || '',
      level: isCritical ? 'critical' : 'warning',
      bg: isCritical ? 'color-mix(in srgb, var(--red) 12%, transparent)' : 'color-mix(in srgb, var(--amber) 14%, transparent)',
      ink: isCritical ? 'var(--red-ink)' : 'var(--amber-ink)',
      icon: svgWarn
    };
  })
);
const svgBulb = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74c.6.52 1 1.31 1 2.26v1h6v-1c0-.95.4-1.74 1-2.26A7 7 0 0 0 12 2z"/></svg>';
const svgWarn = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 7 12H5l7-12zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z"/></svg>';

const suggestionCards = computed(() => {
  const cards: Array<{ title: string; message: string; level: string; bg: string; ink: string; icon: string; cta?: string; to?: string }> = [];
  const sug = current.value?.suggestion;
  if (sug?.message) {
    cards.push({
      title: '节奏建议',
      message: sug.message + (sug.action ? `（${sug.action}）` : ''),
      level: sug.level || 'info',
      bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)', icon: svgBulb,
      cta: '去调整', to: '/learning-paths'
    });
  }
  for (const w of warnings.value.slice(0, 3)) {
    const isCritical = w.level === 'critical';
    cards.push({
      title: w.title || '学习预警',
      message: w.message || w.suggestion || '',
      level: isCritical ? 'critical' : 'warning',
      bg: isCritical ? 'color-mix(in srgb, var(--red) 12%, transparent)' : 'color-mix(in srgb, var(--amber) 14%, transparent)',
      ink: isCritical ? 'var(--red-ink)' : 'var(--amber-ink)',
      icon: svgWarn
    });
  }
  return cards;
});

/* ---------- 偏好 ---------- */
const preferenceItems = computed(() => {
  const items: Array<{ label: string; value: string }> = [];
  const narrative = learnerCenter.value?.profile?.narrativeInsights;
  if (narrative?.contentReceptionPattern) items.push({ label: '适合的方式', value: narrative.contentReceptionPattern });
  if (narrative?.practicePreferenceNote) items.push({ label: '练习偏好', value: narrative.practicePreferenceNote });
  if (narrative?.supportStyleNote) items.push({ label: '支持方式', value: narrative.supportStyleNote });
  return items;
});

const learnerCenter = ref<Record<string, any> | null>(null);
// P1 修复：各数据源失败标记（此前 .catch 吞错 → 错误伪装成无数据）
const currentLoadFailed = ref(false);
const warningsLoadFailed = ref(false);
const learnerCenterLoadFailed = ref(false);
const guidanceLoadFailed = ref(false);
const guidanceLoading = ref(false);

onMounted(() => {
  // 各数据源独立并发，互不阻塞（skill 引导最慢，不应拖住其他区块）
  void loadTrends();

  metricsAPI.getCurrentState()
    .then((v) => { current.value = v as Record<string, any> | null; })
    .catch(() => { currentLoadFailed.value = true; });

  request.get('/state/warnings')
    .then((r) => {
      const w = unwrap<{ warnings?: Array<Record<string, any>> }>(r);
      warnings.value = w?.warnings ?? (Array.isArray(w) ? (w as unknown as Array<Record<string, any>>) : []);
    })
    .catch(() => { warningsLoadFailed.value = true; });

  request.get('/users/me/learner-center', { params: { scope: 'global' } })
    .then((r) => { learnerCenter.value = unwrap(r) as Record<string, any>; })
    .catch(() => { learnerCenterLoadFailed.value = true; });

  void loadGuidance();
});

/**
 * 拉取 skill 引导文案（最慢的一个数据源，独立于其他区块）。
 * 走查（2026-09-24）：网关慢调用可超过前端超时（实测一次 113.9s）→ 请求失败后
 * 页面此前会回落成「完成第一次学习后…」，对已有学习记录的学员是错误信息。
 * 现在失败只提示失败并可原地重试，不再冒充"没有数据"。
 */
function loadGuidance() {
  guidanceLoading.value = true;
  guidanceLoadFailed.value = false;
  return request.get('/adaptive-guidance/copy', { params: { view: 'learning-state' } })
    .then((r) => { guidance.value = unwrap(r) as Record<string, any> | null; })
    .catch(() => { guidanceLoadFailed.value = true; })
    .finally(() => { guidanceLoading.value = false; });
}
</script>

<style scoped>
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.state__foot { margin-top: auto; }
.state__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.state__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }

.state__main {
  max-width: 1080px; margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid; gap: 16px;
}
.state__hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.state__hero h1 { margin: 6px 0 4px; font-size: 20px; letter-spacing: -0.01em; }
.state__hero p { margin: 0; font-size: 13.5px; color: var(--muted); }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--shadow-sm);
}
.card-head { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.muted { font-size: 12px; color: var(--faint); }
.btn-ghost {
  padding: 10px 18px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

/* 体检卡（批19）：主指标大数值 + 三项行内状态条，替代 4 张等权 KPI 卡 */
/* 体检卡（2026-09-27 重排）：四段等位网格（主指标稍宽）+ 发丝线分隔，
   替代原来「左一大块 + 右挤三根」的 flex 布局——1300px 宽下中间是死空白。
   subs 用 display:contents 直接成为卡片网格的格子。 */
.vitals { padding: 16px 20px; display: grid; grid-template-columns: 1.25fr 1fr 1fr 1fr; align-items: center; }
.vitals__loading { grid-column: 1 / -1; }
.vitals__main { display: grid; grid-template-columns: auto auto; gap: 4px 10px; justify-items: start; align-items: center; min-width: 0; padding-right: 18px; }
.vitals__main small { grid-column: 1 / -1; font-size: 12px; color: var(--faint); font-weight: 700; }
/* 34 → 24（2026-09-27 桌面刻度统一：KPI 大数字档 24，原值在令牌体系之外） */
.vitals__value { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.vitals__value i { font-size: 13px; font-style: normal; font-weight: 600; color: var(--faint); }
.vitals__subs { display: contents; }
.vitals__sub { display: grid; grid-template-columns: auto auto; gap: 4px 8px; justify-items: start; align-items: center; min-width: 0; padding: 2px 0 2px 20px; border-left: 1px solid var(--line); }
.vitals__sub small { grid-column: 1 / -1; font-size: 12px; color: var(--faint); font-weight: 700; }
.vitals__sub b { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
.vitals__sub b i { font-size: 12px; font-style: normal; font-weight: 600; color: var(--faint); }
.metric__note { width: fit-content; font-size: 12px; font-weight: 800; padding: 3px 9px; border-radius: var(--mk-radius-pill); }
/* 胶囊底色用「前景 ink × 表面」混色：暗色主题自动降饱和（外部评审：原 rgba 撞色在暗底上刺眼） */
.metric__note--green { color: var(--green-ink); background: color-mix(in srgb, var(--green-ink) 13%, var(--surface)); }
.metric__note--blue { color: var(--blue-deep); background: color-mix(in srgb, var(--blue-deep) 13%, var(--surface)); }
.metric__note--purple { color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, var(--surface)); }
.metric__note--amber { color: var(--amber-ink); background: color-mix(in srgb, var(--amber-ink) 14%, var(--surface)); }
.metric__note--red { color: var(--red-ink); background: color-mix(in srgb, var(--red-ink) 13%, var(--surface)); }

@media (max-width: 720px) {
  /* 窄屏：主指标整行 + 三个子指标 2 列环绕（第三格落下一行时无边框起头） */
  .vitals { grid-template-columns: 1fr 1fr; row-gap: 14px; }
  .vitals__main { grid-column: 1 / -1; padding: 0 0 12px; border-bottom: 1px solid var(--line); }
  .vitals__sub:nth-child(odd) { border-left: 0; padding-left: 0; }
}

.state__grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.state__col { display: grid; gap: 16px; }
/* P2-11：新用户（指标为空）时把「AI 建议」提到最前，作为首屏主内容；图表空态降级为「积累中」说明 */
.state__col--empty .suggest { order: -1; }

/* ---------- 趋势图 ---------- */
.chart { padding: 20px 22px; display: grid; gap: 16px; }
.seg { display: inline-flex; padding: 3px; background: var(--line, #eef2fa); border-radius: var(--mk-radius-lg); gap: 2px; }
.seg__item {
  border: 0; background: transparent; padding: 5px 11px; border-radius: var(--mk-radius-md);
  font: inherit; font-size: 12px; font-weight: 700; color: var(--muted); cursor: pointer;
}
.seg__item--on { background: var(--surface, #fff); color: var(--ink); box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12); }

/* ---------- AI 建议 ---------- */
.suggest { padding: 20px 22px; display: grid; gap: 14px; }
.suggest__list { display: grid; gap: 10px; }
.sug {
  display: grid; grid-template-columns: 38px 1fr auto;
  align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 13px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.sug--done { opacity: .66; background: var(--canvas, #fafcff); }
.sug__icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; }
.sug__body strong { font-size: 13.5px; }
.sug__body p { margin: 3px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.sug__cta {
  font-size: 12px; font-weight: 800; color: var(--blue-deep);
  border: 1px solid color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  padding: 7px 13px; border-radius: var(--mk-radius-pill);
  cursor: pointer; white-space: nowrap;
}
.sug__cta:hover { background: color-mix(in srgb, var(--blue) 12%, transparent); }
.sug__done {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 800; color: var(--green);
  white-space: nowrap;
}

/* ---------- 侧栏 ---------- */
.side { display: grid; gap: 12px; position: sticky; top: 16px; }
.sidecard { padding: 16px 18px; display: grid; gap: 10px; }
.pref, .legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.pref li { display: grid; gap: 2px; }
.pref strong { font-size: 13px; }
.pref span { font-size: 12.5px; color: color-mix(in srgb, var(--ink) 72%, var(--muted)); }
.legend li { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: color-mix(in srgb, var(--ink) 72%, var(--muted)); line-height: 1.65; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.dot--green { background: #31b16f; }
.dot--blue { background: var(--blue); }
.dot--purple { background: var(--accent); }
.dot--amber { background: var(--amber); }

@media (max-width: 1100px) {
  .state__main { padding: 16px 14px 32px; }
  .state__hero h1 { font-size: 18px; }
  .state__grid { grid-template-columns: 1fr; }
  .side { position: static; }
  /* 42/90 天分段控件是触屏主入口之一，28px 高对拇指偏小 → 34px */
  .seg__item { padding: 8px 12px; }
}
</style>

<style scoped>
.metric__note--red { color: var(--red-ink); background: color-mix(in srgb, var(--red-ink) 13%, var(--surface)); }
.chart__controls { display: flex; gap: 8px; flex-wrap: wrap; }
.chart__loading { display: grid; justify-items: center; padding: 40px 0; }
.chart__retry {
  margin-top: 10px;
  min-height: 36px;
  font: inherit; font-size: 12px; font-weight: 800; color: var(--blue-deep);
  border: 1px solid color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  padding: 7px 16px; border-radius: var(--mk-radius-pill); cursor: pointer;
}
.chart__retry:hover { background: color-mix(in srgb, var(--blue) 12%, transparent); }
.chart__empty {
  padding: 30px 0; text-align: center; color: var(--faint); font-size: 13px;
  border: 1px dashed var(--line); border-radius: var(--mk-radius-xl); background: var(--canvas, #fafcff);
}
.sug--critical { border-color: color-mix(in srgb, var(--red) 35%, transparent); }
.sug--warning { border-color: color-mix(in srgb, var(--amber) 35%, transparent); }
.state__main { width: 100%; }
</style>

<style scoped>
/* skill 引导块 */
.guide { display: grid; gap: 6px; }
.guide__title { margin: 0; font-size: 16px; letter-spacing: -0.01em; }
.guide__sub { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.65; }
/* 建议与调控互相引用（2026-09-27）：依据行把 AI 建议挂回到调控区的证据条目 */
.guide__evidence { margin: 0; font-size: 12px; color: var(--blue-deep); line-height: 1.6; }
.guide__warn {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 600; color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber-ink) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--amber-ink) 28%, var(--surface));
  border-radius: var(--mk-radius-lg); padding: 9px 12px;
}
.guide__foot {
  display: grid; gap: 6px;
  border-top: 1px dashed var(--line);
  padding-top: 10px;
  font-size: 12.5px; line-height: 1.7;
  /* 2026-09-27 外部评审：底部两行说明原来 12.5px muted 贴着卡片底边，提亮一档并留出呼吸 */
  color: color-mix(in srgb, var(--ink) 72%, var(--muted));
  padding-bottom: 2px;
}
.guide__foot b {
  color: var(--blue-deep);
  font-size: 12px;
  margin-right: 8px;
  letter-spacing: 0.05em;
}
.suggest__list--warnings { border-top: 1px dashed var(--line); padding-top: 12px; }

/* ---------- AI 决策记录 ---------- */
.review { margin-top: 14px; padding: 14px 18px; border: 1px solid var(--line, #e5e7eb); border-radius: var(--mk-radius-xl); }
/* 评审向内容默认收起（2026-09-27 降噪）：卡头即开合，与 band 同一交互语言 */
.review__toggle {
  width: 100%; min-height: 36px;
  display: flex; align-items: center; gap: 8px;
  padding: 0; border: 0; background: none; cursor: pointer; text-align: left;
}
.review__toggle .band__chev { margin-left: auto; }
.review__body { margin-top: 10px; }
.review__title { margin: 0; font-size: 15px; }
.review__src { font-size: 12px; color: var(--faint, #6b7280); }
.review__rel { margin: 4px 0 0; font-size: 12px; color: var(--faint, #6b7280); }
.review__narrative { margin: 8px 0 0; font-size: 13px; line-height: 1.6; }
.review__list { margin: 10px 0 0; padding-left: 16px; display: grid; gap: 8px; }
.review__item strong { display: block; font-size: 13px; }
.review__action { display: block; margin-top: 2px; font-size: 12px; color: var(--faint, #6b7280); }
/* ---------- 学习调控（2026-09-27）：待确认 / 已自动处理 / 已执行的调整 ---------- */
.ctl { display: grid; gap: 8px; }
.ctl + .ctl { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.ctl__label { margin: 0; font-size: 12px; font-weight: 800; color: var(--faint); letter-spacing: 0.04em; }
.ctl__label b { margin-left: 6px; color: var(--blue); }
.ctl__empty { margin: 0; font-size: 12.5px; color: var(--faint); line-height: 1.6; }
.ctl-card {
  display: grid; gap: 8px;
  padding: 13px 15px;
  border: 1px solid color-mix(in srgb, var(--blue) 28%, var(--line));
  border-radius: 14px;
  background: color-mix(in srgb, var(--blue) 4%, var(--surface));
}
.ctl-card__head { display: flex; align-items: center; gap: 8px; }
.ctl-card__head time { margin-left: auto; font-size: 12px; color: var(--faint); white-space: nowrap; }
.ctl-card__merged { font-size: 12px; color: var(--amber-ink); }
.ctl-card__body { margin: 0; font-size: 13px; line-height: 1.65; color: var(--ink); }
.ctl-card__evidence { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.6; }
.ctl-card__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ctl-card__confirm {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--muted);
  padding: 9px 11px;
  border: 1px dashed var(--line); border-radius: var(--mk-radius-lg);
  background: var(--canvas, #fafcff);
}
.ctl-card__confirm > span { flex: 1; min-width: 0; }
.ctl-btn {
  min-height: 36px; padding: 0 14px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  background: var(--surface, #fff); color: var(--muted);
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.ctl-btn:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.ctl-btn--primary {
  border-color: transparent;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-weight: 800;
}
.ctl-btn--primary:hover { color: #fff; filter: brightness(1.06); border-color: transparent; }
.ctl-btn--primary:disabled { filter: saturate(0.4); cursor: default; }
.ctl-btn--ghost { border-color: transparent; background: transparent; }
.ctl__rows { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.ctl__rows li { display: flex; align-items: baseline; gap: 10px; }
.ctl__row-text { flex: 1; min-width: 0; font-size: 12.5px; color: color-mix(in srgb, var(--ink) 72%, var(--muted)); line-height: 1.6; }
.ctl__row-time { font-size: 12px; color: var(--faint); white-space: nowrap; }
.dec__tag { font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: var(--mk-radius-pill); white-space: nowrap; }
.dec__tag--blue { color: var(--blue-ink); background: color-mix(in srgb, var(--blue-deep) 12%, var(--surface)); }
.dec__tag--purple { color: var(--purple-ink); background: color-mix(in srgb, var(--purple-ink) 12%, var(--surface)); }
.dec__tag--cyan { color: #3593b5; background: color-mix(in srgb, var(--cyan) 12%, var(--surface)); }
.dec__tag--amber { color: var(--amber-ink); background: color-mix(in srgb, var(--amber-ink) 13%, var(--surface)); }
.dec__tag--green { color: var(--green-ink); background: color-mix(in srgb, var(--green-ink) 12%, var(--surface)); }
@media (max-width: 640px) {
  /* 确认调整是本页关键动作，触屏抬到 44 触控带（mobile:spec lt44 口径） */
  .ctl-card__actions .ctl-btn,
  .ctl-card__confirm .ctl-btn { min-height: 44px; flex: 1; }
  .ctl__rows li { flex-wrap: wrap; }
}
</style>

<style scoped>
.chart__empty strong { font-size: 14px; color: var(--muted); display: block; margin-bottom: 6px; }
.chart__empty p { margin: 0; font-size: 12.5px; color: var(--faint); }
/* 引导文案加载失败时的原地重试按钮 */
.guide-retry {
  margin-left: 8px; padding: 10px 12px; border-radius: var(--mk-radius-xl, 999px);
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 12.5px; font-weight: 700; color: var(--blue-deep, #1e5fa8); cursor: pointer;
}
.guide-retry:disabled { opacity: .6; cursor: default; }
</style>

<style scoped>
/* ---------- intervals.icu 风格负荷图 ---------- */
.ff-legend {
  display: flex; align-items: center; flex-wrap: wrap; gap: 14px;
  font-size: 12px; color: var(--muted);
}
.ff-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.ff-dot--fitness { background: var(--blue); }
.ff-dot--fatigue { background: var(--accent); }
.ff-dot--lsb { background: #31b16f; }

.ff-chart { width: 100%; }
.ff-chart svg { display: block; width: 100%; height: auto; }
.ff-bar { fill: color-mix(in srgb, var(--blue) 14%, transparent); }
.ff-grid line { stroke: var(--line); stroke-width: 1; opacity: 0.6; }
.ff-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.ff-line--fitness { stroke: var(--blue); }
.ff-line--fatigue { stroke: var(--accent); }
.ff-line--lsb { stroke: #31b16f; }
.ff-cursor { stroke: color-mix(in srgb, var(--ink) 20%, transparent); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.ff-pt { stroke: #fff; stroke-width: 2; }
.ff-pt--fitness { fill: var(--blue); }
.ff-pt--fatigue { fill: var(--accent); }
.ff-pt--lsb { fill: #31b16f; }

.ff-info {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px;
  font-size: 12.5px; color: var(--muted);
  border-top: 1px dashed var(--line);
  padding-top: 10px;
}
.ff-info b { color: var(--ink); }
.ff-info__fitness { color: var(--blue-deep); font-weight: 700; }
.ff-info__fatigue { color: var(--accent); font-weight: 700; }
</style>

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据：KPI 数字 16px（2026-09-24 用户指着统计卡数字说「数字也很大」后全站统一）、卡片内边距 12–16px、空态/加载留白 ≤32px。
   实测 390 下整页 3359px（最长的一页）。批19 起 KPI 卡墙改为体检卡（vitals），
   主数值桌面 34px、移动 24px 仍受密度口径约束。放在文件末尾：同权重下后出现者胜。 */
@media (max-width: 1100px) {
  .vitals__value { font-size: 24px; }
  .vitals { padding: 14px 16px; }
  .chart,
  .suggest,
  /* 移动端单列堆叠，同宽卡片必须共用一条内容轨道：sidecard 原来横向 14 而
     vitals / band 都是 16，内容左缘落在 29/31 两条线上（2026-09-26 对齐走查）。
     只动横向，竖向 12 是它自己的紧凑节奏。 */
  .sidecard { padding: 12px 16px; }
  .chart__loading { padding: 28px 0; }
  .chart__empty { padding: 24px 0; }
  /* 分段控件（42/90 天）与 AI 建议的 CTA 实测 34px，抬到 36（mobile:spec lt36 门禁）。
     .seg 容器自带 3px 内边距会跟着长高，视觉上仍是同一个药丸。 */
  .seg__item {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
  }
  .sug__cta {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
  }
}

/* ---------- 折叠带（批11 首屏重构）：卡头即开合，long-tail 内容默认收起 ---------- */
.band { padding: 0; }
.band__head { display: flex; align-items: center; }
.band__toggle {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px;
  background: none; border: 0; font-family: inherit;
  text-align: left; cursor: pointer;
}
.band__toggle strong, .band__toggle .kicker { font-size: 14px; }
.band__meta { font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.band__chev { flex: 0 0 auto; color: var(--faint); transition: transform 0.2s ease; }
.band__chev--open { transform: rotate(180deg); }
.band__extra { padding-right: 12px; }
.band__body { padding: 0 16px 16px; }
.band.sidecard .band__toggle { padding: 12px 16px; }
.band.sidecard .band__body { padding: 0 16px 14px; }

/* 折叠带头部在 390 下会被挤爆（2026-09-26 用户侧对齐走查实测）：
   .band__toggle 只分到 231px，而标题「健康度 · 疲劳 · 状态」按 white-space:normal
   折成两行、副标「近 42 天趋势」需要 69px 只给 59px 被截成「近 42 天…」——
   同一个头部同时出两种破版。根因是头部把「标题+副标+箭头」和「分段控件」塞在一行。
   改成让位换行的顺序：标题+副标独占一行（330px 够放 209px 的内容），
   42/90 天分段控件落到第二行贴右缘。
   必须放在本条块之后：同权重下后出现者胜。 */
@media (max-width: 1100px) {
  .band__head { flex-wrap: wrap; row-gap: 2px; }
  .band__toggle { flex: 1 1 100%; }
  /* 标题折行读作「本节知识 / 点」那种断词，比截断更难看，直接禁掉 */
  .band__toggle strong { white-space: nowrap; }
  .band__extra { margin-left: auto; }
}
</style>
