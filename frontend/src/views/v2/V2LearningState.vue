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
        <router-link to="/learning-paths" class="btn-ghost">查看学习路径</router-link>
      </div>

      <!-- 指标卡 -->
      <div class="metrics">
        <section v-for="m in metricCards" :key="m.key" class="card metric">
          <small>{{ m.label }}</small>
          <div class="metric__value" :style="{ color: m.color }">{{ m.value }}<i v-if="m.unit"> {{ m.unit }}</i></div>
          <span class="metric__note" :class="`metric__note--${m.tone}`">{{ m.note }}</span>
        </section>
      </div>

      <div class="state__grid">
        <div class="state__col">
          <!-- 趋势图 -->
          <section class="card chart">
            <div class="card-head">
              <strong>健康度 · 疲劳 · 状态</strong>
              <div class="chart__controls">
                <div class="seg">
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': range === 42 }" @click="setRange(42)">42 天</button>
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': range === 90 }" @click="setRange(90)">90 天</button>
                </div>
              </div>
            </div>

            <!-- 图例 + 当前状态 -->
            <div class="ff-legend">
              <span><i class="ff-dot ff-dot--fitness"></i>掌握趋势（KTL）</span>
              <span><i class="ff-dot ff-dot--fatigue"></i>疲劳度（LF）</span>
              <span><i class="ff-dot ff-dot--lsb"></i>整体状态（LSB = KTL − LF）</span>
              <span v-if="latestDay && hasAnyLoad" class="ff-form-chip" :class="`ff-form-chip--${latestDay.zone?.cls || 'risk'}`">
                状态 {{ latestDay.lsb ?? '—' }} · {{ latestDay.zone?.label || '暂无' }}
              </span>
            </div>

            <div v-if="trendLoading" class="chart__loading"><SkeletonLoader variant="lines" :count="3" /></div>
            <div v-else-if="trendError" class="chart__empty">
              <strong>学习状态数据加载失败</strong>
              <p>网络或服务暂时不可用，稍后再试。</p>
              <button type="button" class="chart__retry" @click="loadTrends">重试</button>
            </div>
            <div v-else-if="!hasAnyLoad" class="chart__empty">
              <strong>还没有学习状态数据</strong>
              <p>完成学习后，这里会出现掌握趋势、疲劳度与整体状态曲线。</p>
            </div>
            <template v-else>
              <div class="ff-chart" @mousemove="onChartHover" @mouseleave="hoverDay = null">
                <svg :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="none" aria-hidden="true">
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
              <div class="ff-zones">
                <span><i class="ff-dot ff-dot--fresh"></i>精力充沛（LSB ≥ 40）</span>
                <span><i class="ff-dot ff-dot--optimal"></i>最优训练区（20 ≤ LSB &lt; 40）</span>
                <span><i class="ff-dot ff-dot--risk"></i>需要休息 / 高风险（LSB &lt; 20）</span>
              </div>
            </template>
          </section>

          <!-- AI 建议（skill: adaptive-guidance-copy 生成，静态规则兜底） -->
          <section class="card suggest">
            <div class="card-head">
              <strong>AI 建议</strong>
              <span class="muted">{{ suggestSource }}</span>
            </div>

            <!-- skill 生成块 -->
            <!-- P1 修复：guidance 加载失败可见提示 -->
            <div v-if="guidanceLoadFailed" class="chart__empty" role="alert">
              AI 建议加载失败，请刷新页面重试。
            </div>
            <template v-if="skillCopy">
              <div class="guide">
                <h3 class="guide__title">{{ skillCopy.headline }}</h3>
                <p v-if="skillCopy.subtitle" class="guide__sub">{{ skillCopy.subtitle }}</p>
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
                <AiContentNote />
              </div>
            </template>

            <!-- 静态规则兜底块 -->
            <template v-else>
              <div v-if="!suggestionCards.length" class="chart__empty">
                {{ hasAnyLoad ? '当前没有特别建议，保持节奏就好。' : '完成第一次学习后，这里会出现 AI 建议。' }}
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

          <!-- AI 决策记录：捕获了什么 → 怎么判断 → 参与了什么决策 -->
          <section class="card decisions">
            <div class="card-head">
              <strong>AI 决策记录</strong>
              <span class="muted">AI 捕获了什么 · 怎么参与下一步</span>
            </div>
            <div v-if="!decisions.length" class="chart__empty">
              还没有决策记录。上完一节课后，这里会记下 AI 捕获的点与下一步调整。
            </div>
            <article v-for="d in decisions" :key="d.id" class="dec">
              <span class="dec__tag" :class="decisionKindMeta[d.kind]?.cls">{{ decisionKindMeta[d.kind]?.label || '调控' }}</span>
              <div class="dec__body">
                <p><b>捕获</b><span>{{ d.captured }}</span></p>
                <p><b>判断</b><span>{{ d.judgment }}</span></p>
                <p><b>动作</b><span>{{ d.action }}</span></p>
              </div>
              <time v-if="decisionTime(d.at)">{{ decisionTime(d.at) }}</time>
            </article>
          </section>
        </div>

        <!-- 侧栏 -->
        <aside class="side">
          <!-- P1 修复：learnerCenter 失败提示 -->
          <section v-if="learnerCenterLoadFailed" class="card sidecard" role="alert">
            <span class="kicker">学习画像</span>
            <p class="chart__empty">画像数据加载失败，请刷新页面重试。</p>
          </section>
          <section v-if="preferenceItems.length && hasAnyLoad" class="card sidecard">
            <span class="kicker">学习偏好</span>
            <ul class="pref">
              <li v-for="(p, i) in preferenceItems" :key="i"><strong>{{ p.label }}</strong><span>{{ p.value }}</span></li>
            </ul>
          </section>
          <section class="card sidecard">
            <span class="kicker">学习记录</span>
            <router-link to="/learning-history" class="btn-ghost btn-ghost--block">查看学习历史</router-link>
          </section>
          <section class="card sidecard">
            <span class="kicker">指标说明</span>
            <ul class="legend">
              <li><b class="dot dot--blue"></b>掌握趋势（KTL）：长期学习积累的掌握水平，变化平缓</li>
              <li><b class="dot dot--purple"></b>疲劳度（LF）：近期学习压力的累积，变化较快</li>
              <li><b class="dot dot--green"></b>整体状态（LSB = KTL − LF）：疲劳高于掌握时状态下降，提醒休息</li>
              <li><b class="dot dot--amber"></b>保持规律学习让掌握趋势稳步上升；疲劳偏高时安排休息，避免长期处于低状态区</li>
            </ul>
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
import request from '@/utils/api';
import { metricsAPI } from '@/api/metrics';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import V2Footer from './V2Footer.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
import { unwrap, unwrapArray } from './unwrap';

type MetricKey = 'lsb' | 'lss' | 'ktl' | 'lf';

const current = ref<Record<string, any> | null>(null);
const warnings = ref<Array<Record<string, any>>>([]);
const trendLoading = ref(true);
const trendError = ref(false);
const range = ref<42 | 90>(42);

const metricOptions: Array<{ key: MetricKey; label: string }> = [
  { key: 'lsb', label: '整体状态' },
  { key: 'lss', label: '学习压力' },
  { key: 'ktl', label: '掌握趋势' },
  { key: 'lf', label: '疲劳程度' }
];

function toneOf(key: MetricKey, v: number): { tone: string; color: string; note: string } {
  if (v === null || v === undefined || Number.isNaN(v)) return { tone: 'blue', color: '#5b6577', note: '暂无数据' };
  if (key === 'lsb') {
    // LSB = KTL - LF（-100 ~ +100），分档对齐后端 <0/<20/<40/≥40 与 heroTitle 文案
    if (v < 0) return { tone: 'red', color: '#ef7578', note: '严重疲劳，优先休息' };
    if (v >= 40) return { tone: 'green', color: '#31b16f', note: '精力充沛' };
    if (v >= 20) return { tone: 'blue', color: '#3478f6', note: '最优训练区' };
    return { tone: 'amber', color: '#d9932e', note: '需要休息' };
  }
  if (key === 'ktl') {
    if (v > 0) return { tone: 'purple', color: '#8d6bff', note: '上升' };
    if (v === 0) return { tone: 'blue', color: '#3478f6', note: '持平' };
    return { tone: 'amber', color: '#d9932e', note: '下降' };
  }
  // lss / lf 越低越好
  if (v <= 35) return { tone: 'green', color: '#31b16f', note: key === 'lss' ? '适中' : '较低' };
  if (v <= 65) return { tone: 'amber', color: '#d9932e', note: key === 'lss' ? '偏高' : '偏高' };
  return { tone: 'red', color: '#ef7578', note: '过高' };
}

const metricCards = computed(() =>
  metricOptions.map((m) => {
    // P1 修复：加载失败显示「读取失败」而非伪装「暂无数据」
    if (currentLoadFailed.value) {
      return { ...m, value: '—', unit: m.key === 'lsb' ? '' : '分', tone: 'red', color: '#ef7578', note: '读取失败' };
    }
    const v = current.value?.[m.key];
    const t = toneOf(m.key, v);
    return { ...m, value: v ?? '—', unit: m.key === 'lsb' ? '' : '分', ...t };
  })
);

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

const maxY = computed(() => {
  const m = Math.max(40, ...series.value.map((d) => Math.max(d.ktl ?? 0, d.lf ?? 0, d.lsb ?? 0)));
  return m * 1.15;
});

const points = computed<TrendPoint[]>(() => {
  const n = series.value.length;
  const usableW = chartW - chartPad * 2;
  const step = n > 1 ? usableW / (n - 1) : 0;
  const yOf = (v: number) => chartH - (v / maxY.value) * chartH;
  return series.value.map((d, i) => {
    const x = chartPad + step * i;
    return {
      ...d,
      x,
      ky: d.ktl !== null ? yOf(d.ktl) : null,
      ly: d.lf !== null ? yOf(d.lf) : null,
      sy: d.lsb !== null ? yOf(d.lsb) : null,
      bx: x - barW.value / 2,
      by: yOf(d.minutes),
      bh: chartH - yOf(d.minutes)
    };
  });
});

const barW = computed(() => {
  const n = series.value.length || 1;
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

const latestDay = computed<TrendPoint | null>(() => points.value[points.value.length - 1] ?? null);
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
      date: String(t.date).slice(0, 10),
      ktl: typeof t.ktl === 'number' ? t.ktl : null,
      lf: typeof t.lf === 'number' ? t.lf : null,
      lsb: typeof t.lsb === 'number' ? t.lsb : null
    }));
    // 当日时长背景柱：仅展示，不参与状态计算（口径不冲突）
    const list = unwrapArray(sessionRes);
    const map = new Map<string, number>();
    for (const s of list) {
      const key = String(s.startTime || '').slice(0, 10);
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

const skillCopy = computed(() => guidance.value?.copy || null);

/* ---------- AI 决策记录（同一接口返回，LearningDecisionFeedService 组装） ---------- */
interface DecisionCard {
  id: string;
  kind: 'path-adjust' | 'path-replanned' | 'kp-carryover' | 'concept-watch' | 'pace';
  captured: string;
  judgment: string;
  action: string;
  priority: 'high' | 'medium' | 'low' | 'info';
  at: string | null;
}

const decisions = computed<DecisionCard[]>(() =>
  Array.isArray(guidance.value?.decisions) ? guidance.value.decisions : []
);

const decisionKindMeta: Record<string, { label: string; cls: string }> = {
  'path-adjust': { label: '路径调整', cls: 'dec__tag--blue' },
  'path-replanned': { label: '路径版本', cls: 'dec__tag--purple' },
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
  const resolve = (to?: string): string => {
    switch (to) {
      case 'continue-learning':
        return pathId ? `/learning-path/${pathId}` : '/dashboard';
      case 'path-detail':
        return pathId ? `/learning-path/${pathId}` : '/learning-paths';
      case 'learning-state':
        return '/learning-state';
      case 'achievements':
        return '/achievements';
      case 'create-goal':
        return '/goal-conversation';
      default:
        return '/dashboard';
    }
  };
  const iconFor = (to?: string) => {
    if (to === 'path-detail') return { icon: svgLayers, bg: 'rgba(52,120,246,.12)', ink: '#1f57cc' };
    if (to === 'achievements') return { icon: svgMedal2, bg: 'rgba(141,107,255,.13)', ink: '#6b4ae0' };
    if (to === 'create-goal') return { icon: svgPlus, bg: 'rgba(67,176,216,.14)', ink: '#3593b5' };
    if (to === 'learning-state') return { icon: svgBulb, bg: 'rgba(244,170,70,.16)', ink: '#b3540a' };
    if (to === 'continue-learning') return { icon: svgPlay, bg: 'rgba(49,177,111,.12)', ink: '#1d7a4c' };
    return { icon: svgHome, bg: 'rgba(52,120,246,.12)', ink: '#1f57cc' };
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
      bg: isCritical ? 'rgba(239,117,120,.12)' : 'rgba(244,170,70,.14)',
      ink: isCritical ? '#c0454a' : '#b3540a',
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
      bg: 'rgba(52,120,246,.12)', ink: '#1f57cc', icon: svgBulb,
      cta: '去调整', to: '/learning-paths'
    });
  }
  for (const w of warnings.value.slice(0, 3)) {
    const isCritical = w.level === 'critical';
    cards.push({
      title: w.title || '学习预警',
      message: w.message || w.suggestion || '',
      level: isCritical ? 'critical' : 'warning',
      bg: isCritical ? 'rgba(239,117,120,.12)' : 'rgba(244,170,70,.14)',
      ink: isCritical ? '#c0454a' : '#b3540a',
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

  request.get('/adaptive-guidance/copy', { params: { view: 'learning-state' } })
    .then((r) => { guidance.value = unwrap(r) as Record<string, any> | null; })
    .catch(() => { guidanceLoadFailed.value = true; });
});
</script>

<style scoped>
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.state__foot { margin-top: auto; }
.state__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.state__ai-note :deep(.ai-note) { font-size: 11px; opacity: 0.75; }

.state__main {
  max-width: 1080px; margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid; gap: 16px;
}
.state__hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.state__hero h1 { margin: 6px 0 4px; font-size: 28px; letter-spacing: -0.01em; }
.state__hero p { margin: 0; font-size: 13.5px; color: var(--muted); }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}
.card-head { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.muted { font-size: 12px; color: var(--faint); }
.btn-ghost {
  padding: 10px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.metric { padding: 16px 18px; display: grid; gap: 8px; }
.metric small { font-size: 12px; color: var(--faint); font-weight: 700; }
.metric__value { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.metric__value i { font-size: 13px; font-style: normal; font-weight: 600; color: var(--faint); }
.metric__note { width: fit-content; font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 999px; }
.metric__note--green { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.metric__note--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.metric__note--purple { color: var(--accent); background: rgba(141, 107, 255, 0.12); }
.metric__note--amber { color: #b3540a; background: rgba(244, 170, 70, 0.16); }

.state__grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.state__col { display: grid; gap: 16px; }

/* ---------- 趋势图 ---------- */
.chart { padding: 20px 22px; display: grid; gap: 16px; }
.seg { display: inline-flex; padding: 3px; background: var(--line, #eef2fa); border-radius: 10px; gap: 2px; }
.seg__item {
  border: 0; background: transparent; padding: 5px 11px; border-radius: 8px;
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
  border: 1px solid rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.06);
  padding: 7px 13px; border-radius: 999px;
  cursor: pointer; white-space: nowrap;
}
.sug__cta:hover { background: rgba(52, 120, 246, 0.12); }
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
.pref strong { font-size: 12.5px; }
.pref span { font-size: 12px; color: var(--muted); }
.legend li { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.dot--green { background: #31b16f; }
.dot--blue { background: #3478f6; }
.dot--purple { background: #8d6bff; }
.dot--amber { background: #f4aa46; }

@media (max-width: 900px) {
  .state__main { padding: 16px 14px 32px; }
  .state__hero h1 { font-size: 22px; }
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .state__grid { grid-template-columns: 1fr; }
  .side { position: static; }
}
</style>

<style scoped>
.metric__note--red { color: #c0454a; background: rgba(239, 117, 120, 0.12); }
.chart__controls { display: flex; gap: 8px; flex-wrap: wrap; }
.chart__loading { display: grid; justify-items: center; padding: 40px 0; }
.chart__retry {
  margin-top: 10px;
  font: inherit; font-size: 12px; font-weight: 800; color: var(--blue-deep);
  border: 1px solid rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.06);
  padding: 7px 16px; border-radius: 999px; cursor: pointer;
}
.chart__retry:hover { background: rgba(52, 120, 246, 0.12); }
.chart__empty {
  padding: 30px 0; text-align: center; color: var(--faint); font-size: 13px;
  border: 1px dashed var(--line); border-radius: 12px; background: var(--canvas, #fafcff);
}
.sug--critical { border-color: rgba(239, 117, 120, 0.35); }
.sug--warning { border-color: rgba(244, 170, 70, 0.35); }
.state__main { width: 100%; }
</style>

<style scoped>
/* skill 引导块 */
.guide { display: grid; gap: 6px; }
.guide__title { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
.guide__sub { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.65; }
.guide__warn {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 600; color: #b3540a;
  background: rgba(244, 170, 70, 0.1);
  border: 1px solid rgba(244, 170, 70, 0.3);
  border-radius: 10px; padding: 9px 12px;
}
.guide__foot {
  display: grid; gap: 6px;
  border-top: 1px dashed var(--line);
  padding-top: 10px;
  font-size: 12.5px; color: var(--muted); line-height: 1.6;
}
.guide__foot b {
  color: var(--blue-deep);
  font-size: 11px;
  margin-right: 8px;
  letter-spacing: 0.05em;
}
.suggest__list--warnings { border-top: 1px dashed var(--line); padding-top: 12px; }

/* ---------- AI 决策记录 ---------- */
.decisions { padding: 20px 22px; display: grid; gap: 12px; }
.dec {
  display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: start;
  padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--canvas, #fbfcff);
}
.dec__tag { font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.dec__tag--blue { color: #1f57cc; background: rgba(52, 120, 246, 0.1); }
.dec__tag--purple { color: #6b4ae0; background: rgba(141, 107, 255, 0.12); }
.dec__tag--cyan { color: #3593b5; background: rgba(67, 176, 216, 0.12); }
.dec__tag--amber { color: #b3540a; background: rgba(244, 170, 70, 0.14); }
.dec__tag--green { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.dec__body { display: grid; gap: 6px; }
.dec__body p { margin: 0; display: grid; grid-template-columns: 34px 1fr; gap: 10px; font-size: 13px; line-height: 1.65; color: var(--ink); }
.dec__body b { font-size: 11px; font-weight: 800; color: var(--faint); padding-top: 2.5px; }
.dec time { font-size: 11.5px; color: var(--faint); white-space: nowrap; padding-top: 2px; }
@media (max-width: 640px) {
  .dec { grid-template-columns: 1fr; gap: 8px; }
  .dec time { justify-self: end; }
}
</style>

<style scoped>
.chart__empty strong { font-size: 14px; color: var(--muted); display: block; margin-bottom: 6px; }
.chart__empty p { margin: 0; font-size: 12.5px; color: var(--faint); }
</style>

<style scoped>
/* ---------- intervals.icu 风格负荷图 ---------- */
.ff-legend {
  display: flex; align-items: center; flex-wrap: wrap; gap: 14px;
  font-size: 12px; color: var(--muted);
}
.ff-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.ff-dot--fitness { background: #3478f6; }
.ff-dot--fatigue { background: #8d6bff; }
.ff-dot--lsb { background: #31b16f; }
.ff-dot--fresh { background: #31b16f; }
.ff-dot--optimal { background: #3478f6; }
.ff-dot--risk { background: #ef7578; }
.ff-form-chip {
  margin-left: auto;
  font-size: 11.5px; font-weight: 800;
  padding: 4px 11px; border-radius: 999px;
}
.ff-form-chip--fresh { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.ff-form-chip--optimal { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.ff-form-chip--risk { color: #c0454a; background: rgba(239, 117, 120, 0.12); }

.ff-chart { width: 100%; }
.ff-chart svg { display: block; width: 100%; height: auto; }
.ff-bar { fill: rgba(52, 120, 246, 0.14); }
.ff-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.ff-line--fitness { stroke: #3478f6; }
.ff-line--fatigue { stroke: #8d6bff; }
.ff-line--lsb { stroke: #31b16f; }
.ff-cursor { stroke: rgba(23, 32, 51, 0.2); stroke-width: 1; stroke-dasharray: 3 3; }
.ff-pt { stroke: #fff; stroke-width: 2; }
.ff-pt--fitness { fill: #3478f6; }
.ff-pt--fatigue { fill: #8d6bff; }
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
.ff-zones {
  display: flex; flex-wrap: wrap; gap: 8px 16px;
  font-size: 11.5px; color: var(--faint);
}
</style>
