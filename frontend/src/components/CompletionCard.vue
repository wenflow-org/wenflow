<template>
  <div class="completion-card">
    <div class="completion-header">
      <span class="completion-icon completion-icon--header" aria-hidden="true"><CircleCheckFilled /></span>
      <h3 class="completion-title">本次学习已结束</h3>
    </div>

    <div class="completion-body">
      <div v-if="advisory?.shouldSuggest" class="completion-section advisory-section" :class="`advisory-section--${advisory.priority}`">
        <h4 class="section-title"><span class="completion-icon" aria-hidden="true"><MagicStick /></span>{{ advisory.ui.title }}</h4>
        <p class="section-content">{{ advisoryBody }}</p>
        <!-- 安抚句顺着上一句流下去，不另起一段（2026-11-03 用户反馈「这句话还是换段了」）：
             宽屏下「主要原因…」「确认后会…」各自独立成行，一句一行的碎排版就是用户指的问题。 -->
        <p v-if="advisory.attribution?.reason" class="section-attribution">
          <span class="attribution-tag">主要原因</span>{{ advisory.attribution.reason }}
          <span class="section-hint section-hint--inline">{{ settleReassurance }}</span>
        </p>
        <p v-else class="section-hint">{{ settleReassurance }}</p>
        <div v-if="advisoryKept" class="section-hint">你已选择保持原计划，这条建议不会再调整后续安排。</div>
        <div v-else class="advisory-options">
          <button
            v-for="option in advisory.ui.options"
            :key="option.key"
            type="button"
            class="completion-btn completion-btn--small"
            :class="isAdjustmentAction(option.key) ? 'completion-btn--primary' : 'completion-btn--default'"
            :disabled="busy"
            @click="emit('advisory-action', option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="completion-summary">
        <!-- 主题独占一行：任务标题是一整句话，和「31 分钟」这类短读数挤在同一行的等分格里
             只会把它压成多行、并把其余格子撑出大片空白（2026-11-03 排版优化）。 -->
        <div class="summary-item summary-item--topic"><span class="summary-label">主题</span><span class="summary-value">{{ topic }}</span></div>
        <div class="summary-item"><span class="summary-label">知识点</span><span class="summary-value">{{ knowledgeCountText }}</span></div>
        <div class="summary-item"><span class="summary-label">用时</span><span class="summary-value">{{ duration }}</span></div>
        <div class="summary-item"><span class="summary-label">学习消息</span><span class="summary-value">{{ summaryCounters.display.messages ?? messageCount }} 条</span></div>
        <!-- 主题总结并入概览卡（2026-11-06 走查）：它原本是紧挨着概览卡的另一张满宽卡，只有两行字，
             却要再套一层边框 + 卡间距。现在作为概览卡的正文直接跟在读数下面，少一层套娃。 -->
        <p class="summary-topic">{{ summary.topicSummary }}</p>
      </div>

      <div id="sec-knowledge" class="completion-section">
        <h4 class="section-title"><span class="completion-icon" aria-hidden="true"><Collection /></span>知识点掌握</h4>
        <ul v-if="knowledgeItems.length" class="knowledge-list">
          <li v-for="item in knowledgeItems" :key="item.name" class="knowledge-item">
            <div class="knowledge-head">
              <span class="knowledge-name">{{ item.name }}</span>
              <span class="status-tag" :class="tagClass(getKnowledgeTagType(item.status))">{{ getKnowledgeStatusLabel(item.status) }}</span>
            </div>
            <p class="knowledge-evidence">{{ item.evidence }}</p>
          </li>
        </ul>
        <p v-else class="section-content">{{ summary.knowledgeSummary }}</p>
      </div>

      <div v-if="evaluation" id="sec-perf" class="completion-section">
        <h4 class="section-title"><span class="completion-icon" aria-hidden="true"><DataAnalysis /></span>本节表现</h4>
        <p class="section-hint">{{ sessionInterpretation }}</p>
        <div class="metrics-grid metrics-grid--three">
          <div v-for="item in sessionMetricCards" :key="item.key" class="metric-card" :class="`metric-card--${item.tone}`">
            <!-- 每个数字底下那行固定名词解释（「即时学习产出，越高说明本节吸收越充分。」）2026-11-06 撤除：
                 它不随数据变化、7 张卡各印一行，把 3+4 个读数撑成 1.5 屏。解释改挂标题右上 ⓘ，
                 点开才看（与学习状态页「指标说明」同一套 details 交互）。 -->
            <details class="metric-help">
              <summary class="metric-help__btn" :aria-label="`${item.label}说明`" title="指标说明">ⓘ</summary>
              <p class="metric-help__body">{{ item.desc }}</p>
            </details>
            <span class="metric-label">{{ item.label }}</span>
            <span class="metric-value"><span class="metric-number">{{ sessionCounters.display[item.key] ?? item.value }}</span><span class="metric-badge">{{ item.level }}</span></span>
          </div>
        </div>
      </div>

      <div v-if="evaluation" id="sec-longterm" class="completion-section">
        <h4 class="section-title"><span class="completion-icon" aria-hidden="true"><TrendCharts /></span>长期学习状态</h4>
        <p class="section-hint">{{ longTermInterpretation }}</p>
        <div class="metrics-grid">
          <div v-for="item in longTermMetricCards" :key="item.key" class="metric-card" :class="`metric-card--${item.tone}`">
            <details class="metric-help">
              <summary class="metric-help__btn" :aria-label="`${item.label}说明`" title="指标说明">ⓘ</summary>
              <p class="metric-help__body">{{ item.desc }}</p>
            </details>
            <span class="metric-label">{{ item.label }}</span>
            <span class="metric-value"><span class="metric-number">{{ longTermCounters.display[item.key] ?? item.value }}</span><span class="metric-badge">{{ item.level }}</span></span>
          </div>
        </div>
      </div>

      <!-- 关键收获 / 下一步建议（2026-11-06 走查）：两张卡各只有 3 条三十几字的列表，
           单列满宽时每条只占左半边、右侧 45% 全空。PC ≥1024 并成左右双栏等高卡：
           左边「这节课收获了什么」、右边「下一步怎么练」，语义对照，纵向省掉约 180px。 -->
      <div class="completion-duo">
        <div v-if="keyTakeaways.length" id="sec-takeaways" class="completion-section">
          <h4 class="section-title"><span class="completion-icon" aria-hidden="true"><Collection /></span>关键收获</h4>
          <ol class="ordered-list"><li v-for="(item, idx) in keyTakeaways" :key="`${idx}-${item}`">{{ item }}</li></ol>
        </div>

        <div id="sec-next" class="completion-section">
          <h4 class="section-title"><span class="completion-icon" aria-hidden="true"><Compass /></span>下一步建议</h4>
          <ol v-if="actionPlan.length" class="ordered-list"><li v-for="(item, idx) in actionPlan" :key="`${idx}-${item}`"><MarkdownRenderer :content="item" /></li></ol>
          <div v-else class="section-content"><MarkdownRenderer :content="summary.practiceAdvice" /></div>
        </div>
      </div>

      <div id="sec-evaluation" class="completion-section">
        <h4 class="section-title"><span class="completion-icon" aria-hidden="true"><TrendCharts /></span>学习评价</h4>
        <div v-if="hasHighlights" class="evaluation-block">
          <p v-if="formattedStrengths" class="evaluation-line"><strong>亮点：</strong>{{ formattedStrengths }}</p>
          <p v-if="formattedImprovements" class="evaluation-line"><strong>改进：</strong>{{ formattedImprovements }}</p>
        </div>
        <p v-else class="section-content">{{ summary.learningEvaluation }}</p>
      </div>
    </div>

    <!-- 卡尾动作区（提示 + 继续练习/完成任务）2026-11-06 整块撤除：
         ① 那条「本节任务已计入路径进度。」+ 分割线 + 孤立灰按钮，是卡片最底下 80px 的小尾巴；
         ② 「继续练习」「完成任务」现在都在页面顶部固定操作栏里（与「返回学习路径」并排），
            PC 与移动端吸底条共用同一套 handler，卡内不再重复一组。 -->
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, watch } from 'vue';
/* element-plus 图标已移除（依赖整体下线）：改用内联 SVG，无依赖、随 currentColor 取色、随字号缩放。
   数据来自本地常量（静态可信标记，不经用户输入）。 */
const ICONS: Record<string, string> = {
  CircleCheckFilled: `<circle cx="10" cy="10" r="8.2" fill="currentColor"/><path d="M6.1 10.4l2.6 2.6 5.2-5.4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  Compass: `<circle cx="10" cy="10" r="7.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.3 6.7l-1.9 4.7-4.7 1.9 1.9-4.7z" fill="currentColor"/>`,
  /* 三个「实心矩形」图标必须显式 fill="currentColor"：SVG 默认 fill 是纯黑，
     不写就从 currentColor 掉进 #000，在深色卡片上糊成一团黑影（2026-11-06 走查：
     知识点掌握 / 本节表现 / 关键收获 三个标题图标全黑）。 */
  Collection: `<g fill="currentColor"><rect x="3" y="4.4" width="3.2" height="11.2" rx="1"/><rect x="8.4" y="4.4" width="3.2" height="11.2" rx="1"/><rect x="13.8" y="4.4" width="3.2" height="11.2" rx="1"/></g>`,
  TrendCharts: `<path d="M3 15.6l4.2-4.7 3 2.7 6.4-7.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  DataAnalysis: `<g fill="currentColor"><rect x="3.8" y="10" width="3.2" height="7" rx="1"/><rect x="8.4" y="6.3" width="3.2" height="10.7" rx="1"/><rect x="13" y="3.2" width="3.2" height="13.8" rx="1"/></g>`,
  MagicStick: `<path d="M3.8 16.4L14.4 5.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M15.4 3.1l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor"/>`,
};
const icon = (name: string) => () =>
  h('svg', { viewBox: '0 0 20 20', width: '1em', height: '1em', 'aria-hidden': 'true', innerHTML: ICONS[name] ?? '' });
const CircleCheckFilled = icon('CircleCheckFilled');
const MagicStick = icon('MagicStick');
const DataAnalysis = icon('DataAnalysis');
const TrendCharts = icon('TrendCharts');
const Collection = icon('Collection');
const Compass = icon('Compass');
import MarkdownRenderer from './MarkdownRenderer.vue';
import type { ReplanAdvisory, WrapupArtifact } from '@/api/aiTeaching';
import { learnerMetric } from '@/utils/learnerMetrics';

const props = defineProps<{
  topic: string;
  masteredCount: number;
  totalCount: number;
  duration: string;
  messageCount: number;
  wrapup: WrapupArtifact;
  advisory?: ReplanAdvisory | null;
  busy?: boolean;
  taskId?: string;
  /** 结算门禁：末问/小测未完成时隐藏常规动作栏，只保留下方恢复卡 */
  blocked?: boolean;
  /** 与 masteredCount/totalCount 同源的课次知识点（含进行中进度）；只用于把「0/2 已学会」补成完整读数 */
  knowledgePoints?: Array<{ status?: string; progress?: number }>;
}>();

/* 「继续练习 / 返回 / 完成任务」的 action 事件随卡尾动作区一起撤除：
   推进与离开现在都在页面的固定操作栏（PC）与吸底条（≤640）里，共用同一套 handler。
   本卡只保留建议卡的选项事件。 */
const emit = defineEmits<{ 'advisory-action': [action: string] }>();

const summary = computed(() => props.wrapup.summary);
const evaluation = computed(() => props.wrapup.evaluation);
const stateUpdate = computed(() => props.wrapup.stateUpdate || null);
const advisory = computed(() => props.advisory || null);
/**
 * 建议正文（2026-11-03）：旧模板会在末尾拖一句与按钮上方提示同义的安抚句
 * （「该调整只会调整后续阶段的课程安排，不会覆盖/不影响你已完成的内容。」），
 * 已存库的建议仍带着它——渲染时剥掉，避免同义重复和孤行；模板侧已不再生成这句。
 */
/** 结算安抚句：有归因时并进同一段流，无归因时独立成行（文案单源，防 R6 同文件重复）
    （2026-11-04 去「已完成的内容不会改变」这句替用户表态的安抚，只说调整动作） */
const settleReassurance = '确认后会调整后续学习安排。';
const advisoryBody = computed(() => (advisory.value?.ui.body || '')
  .replace(/该调整只会调整后续阶段的课程安排，(?:不会覆盖|不影响)你已完成的内容。/g, '')
  .trim());
/** 学习者已明确「保持原计划」：建议卡转已决策态，不再给可重复点击的按钮 */
const advisoryKept = computed(() => advisory.value?.learnerResponse?.action === 'keep');
const busy = computed(() => props.busy === true);
const isAdjustmentAction = (action: string) => ['confirm', 'reinforce', 'slow_down', 'resequence', 'accelerate'].includes(action);

const toFixed = (v: number | undefined) => Number(v || 0).toFixed(1);
const getSimpleLevel = (v: number, h: number, m: number) => (v >= h ? { level: '高', tone: 'good' } : v >= m ? { level: '中', tone: 'normal' } : { level: '低', tone: 'warn' });
const getStress = (v: number) => (v >= 70 ? { level: '高', tone: 'warn' } : v >= 40 ? { level: '中', tone: 'normal' } : { level: '低', tone: 'good' });
// display 0-100 刻度（与学习状态页 /state/current 一致）：阈值 10 / -20 对应内部 1 / -2。
const getBalance = (v: number) => (v >= 10 ? { level: '平衡', tone: 'good' } : v >= -20 ? { level: '轻微失衡', tone: 'normal' } : { level: '失衡', tone: 'warn' });

/* 数字计数动画：0 → 终值（rAF，reduced-motion 直接终值） */
const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useCountUpMap(source: () => Record<string, number>, durationMs = 800): { display: Record<string, string> } {
  const display = reactive<Record<string, string>>({});
  let raf = 0;
  // 展示格式:整数计数(知识点 x/x、消息条数)保持整数,指标值统一一位小数;
  // 两条输出路径(reduced-motion 直出/动画帧)同口径,不再漏原始浮点
  const fmt = (v: number, asInt: boolean) => (asInt ? String(Math.round(v)) : Number(v).toFixed(1));
  const render = () => {
    const targets = source();
    if (prefersReducedMotion) {
      Object.assign(display, Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, fmt(v, Number.isInteger(v))])));
      return;
    }
    const start = performance.now();
    const fromMap = { ...display };
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(targets)) {
        const from = Number(fromMap[k]) || 0;
        next[k] = fmt(from + (v - from) * eased, Number.isInteger(v));
      }
      Object.assign(display, next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  };
  onMounted(() => {
    render();
    if (!prefersReducedMotion) {
      watch(source, () => {
        if (document.visibilityState === 'visible') render();
      });
    }
  });
  onUnmounted(() => cancelAnimationFrame(raf));
  return { display };
}

const summaryCounters = useCountUpMap(() => ({
  mastered: props.masteredCount,
  messages: props.messageCount,
}));

/**
 * 知识点读数（2026-11-03 走查 S4-3）。
 *
 * 实测：学员当堂两次小测都答对、导师说「这个任务要练的动作你已经独立走完了」，
 * 页头却单摆一句「知识点 0/2 已学会」——数字本身没错（两条都还在 learning、进度 80/90），
 * 错在把它当结论单独呈现，读者只会得到"全没学会"的印象，与同屏的当堂反馈相反。
 * 修法：把同源知识点里的**进行中进度**一并说出来，让读数完整，不改判定阈值
 * （是否升为 mastered 属教学口径，不在展示层动）。
 */
const inProgressPoints = computed(() => (props.knowledgePoints || [])
  .filter((p) => String(p.status || '') === 'learning' && Number(p.progress) > 0));
const topProgress = computed(() => inProgressPoints.value
  .reduce((max, p) => Math.max(max, Number(p.progress) || 0), 0));
const knowledgeCountText = computed(() => {
  const mastered = summaryCounters.display.mastered ?? props.masteredCount;
  const base = `${mastered}/${props.totalCount} 已学会`;
  // 尾巴的去留用真值判定：数字在滚动动画里会经过 0，不能让「全部已学会」的课闪一帧「2 项在学」
  const allMastered = props.masteredCount >= props.totalCount;
  if (inProgressPoints.value.length === 0 || allMastered) return base;
  const tail = topProgress.value > 0
    ? `${inProgressPoints.value.length} 项在学，最高 ${topProgress.value}%`
    : `${inProgressPoints.value.length} 项在学`;
  return `${base} · ${tail}`;
});
const sessionCounters = useCountUpMap(() => {
  const out: Record<string, number> = {};
  for (const card of sessionMetricCards.value) out[card.key] = Number(card.raw);
  return out;
});
const longTermCounters = useCountUpMap(() => {
  const out: Record<string, number> = {};
  for (const card of longTermMetricCards.value) out[card.key] = Number(card.raw);
  return out;
});

const sessionMetricCards = computed(() => {
  if (!evaluation.value) return [];
  const k = Number(evaluation.value.sessionKtl ?? evaluation.value.ktl);
  const s = Number(evaluation.value.sessionLss ?? evaluation.value.lss);
  const f = Number(evaluation.value.sessionLf ?? evaluation.value.lf);
  // 会话级 KTL = 后端 evaluation.sessionKtl = **本节知识获得质量**（high = 学生能独立完成核心任务）。
  // 高=好在这里是对的，别照着下面「长期 KTL=训练负荷（高=坏）」把它一起反过来——
  // 两者同名不同义，判据见 prompts/skill.session-wrapup.md 的「评分参考」。
  const kl = getSimpleLevel(k, 7, 4);
  const sl = getStress(s * 10);
  const fl = getStress(f * 10);
  return [
    { key: 'k', label: '本节掌握增量', value: toFixed(k), raw: k, level: kl.level, tone: kl.tone, desc: '即时学习产出，越高说明本节吸收越充分。' },
    { key: 's', label: '本节学习压力', value: toFixed(s), raw: s, level: sl.level, tone: sl.tone, desc: '当前课程负荷强度，偏高时建议先复盘。' },
    { key: 'f', label: '本节疲劳累积', value: toFixed(f), raw: f, level: fl.level, tone: fl.tone, desc: '即时疲劳变化，偏高时适合切换轻任务。' },
  ];
});

const longTermMetricCards = computed(() => {
  if (!stateUpdate.value) return [];
  const { ktl, lsb, lf, lss, mature } = stateUpdate.value;
  // 长期态内部刻度为 0-10（PMC），展示统一到 0-100——与学习状态页的 KTL/LF/LSS/LSB 同刻度，
  // 避免同一用户在两页看到 10 倍差（2026-10-23 走查：反馈 0.1 vs 状态页 1.2）。
  const display = (v: number | undefined) => Number(v || 0) * 10;
  const ktlD = display(ktl);
  const lsbD = display(lsb);
  const lfD = display(lf);
  const lssD = display(lss);
  // 长期态 KTL = 训练负荷（LearningStateMetrics.ktl，LSS 的慢 EWMA，高=负荷重）。
  // 此前用 getSimpleLevel(ktl,7,4)（高=好）并叫它「知识掌握」，与管理端（按后端语义判高=坏、
  // 显示为红）结论相反。现与 LSS/LF 同向走 getStress，标签取自 @/utils/learnerMetrics 单点。
  const kl = getStress(ktlD);
  // 冷启动（PMC 基座未成熟）form<0 属正常爬升，不按「失衡」警示。
  const bl = mature === false ? { level: '积累中', tone: 'normal' } : getBalance(lsbD);
  const fl = getStress(lfD);
  const sl = getStress(lssD);
  return [
    { key: 'ktl', label: learnerMetric('ktl').label, value: toFixed(ktlD), raw: ktlD, level: kl.level, tone: kl.tone, desc: '长期累积的训练负荷，偏高说明学习压力在堆积，宜适时降强度。' },
    { key: 'lsb', label: '整体状态', value: toFixed(lsbD), raw: lsbD, level: bl.level, tone: bl.tone, desc: '掌握与疲劳差值，越接近正值越理想。' },
    { key: 'lf', label: '学习疲劳', value: toFixed(lfD), raw: lfD, level: fl.level, tone: fl.tone, desc: '短期疲劳累计，偏高时建议降强度。' },
    { key: 'lss', label: '学习压力', value: toFixed(lssD), raw: lssD, level: sl.level, tone: sl.tone, desc: '整体学习压力水平，持续偏高需节奏调整。' },
  ];
});

const sanitizeKnowledgeEvidence = (text: string) => text
  .replace(/newlyMastered/gi, '本节新收获')
  .replace(/unchangedMastered/gi, '已学会')
  .replace(/mastered/gi, '已学会')
  .replace(/avgUnderstanding/gi, '课堂理解度')
  .replace(/\bstatus\b/gi, '当前表现');

const knowledgeItems = computed(() => (summary.value?.knowledgeItems || []).map((item) => ({
  ...item,
  evidence: sanitizeKnowledgeEvidence(item.evidence),
})));
const keyTakeaways = computed(() => summary.value?.keyTakeaways || []);
const actionPlan = computed(() => summary.value?.actionPlan || []);
const evaluationHighlights = computed(() => summary.value?.evaluationHighlights || null);
const hasHighlights = computed(() => {
  const h = evaluationHighlights.value;
  return !!(h && ((h.strengths?.length || 0) > 0 || (h.improvements?.length || 0) > 0));
});
const sessionInterpretation = computed(() => summary.value?.metricInterpretation?.session || '本节表现反映本次课堂的即时投入和产出。');
const longTermInterpretation = computed(() => summary.value?.metricInterpretation?.longTerm || '长期状态来自历史累计，不等于单节课程成绩。');

/* 「本节进展」卡片 2026-11-06 撤销：它的三行（已学会 / 建议回看 / 继续练习）与紧随其后的
   「知识点掌握」逐条重复——同一批知识点、同一组标签，只是换了措辞和顺序，读者要在两屏之间
   对照才发现「说的是同一件事」。知识点掌握卡已上提到主题总结正下方，成为唯一的掌握度视图。 */

const formatSentenceList = (items: string[] = []) => items.map((i) => i.replace(/[；;。]+$/g, '').trim()).filter(Boolean).join('；');
const formattedStrengths = computed(() => (evaluationHighlights.value ? formatSentenceList(evaluationHighlights.value.strengths) : ''));
const formattedImprovements = computed(() => (evaluationHighlights.value ? formatSentenceList(evaluationHighlights.value.improvements) : ''));

const getKnowledgeTagType = (s: string) => (s === 'mastered' ? 'success' : s === 'learning' ? 'warning' : s === 'review' ? 'danger' : 'info');
const getKnowledgeStatusLabel = (s: string) => (s === 'mastered' ? '已学会' : s === 'learning' ? '继续练习' : s === 'review' ? '建议回看' : '尚未展开');

/* el-tag type → 学习组件 .status-tag 变体。色 token 与旧 EP 覆写一一对应：
   success=success-*、warning=efficient-*、danger=warning-*、info=pending-*。 */
const tagClass = (type: string) => ({
  'status-tag--completed': type === 'success',
  'status-tag--warning': type === 'danger',
  'status-tag--pending': type === 'info',
  'status-tag--efficient': type === 'warning',
});
</script>

<style scoped>
/* 完成卡：绿色极浅底（批次 D，2026-10-02）。
   原为 linear-gradient(135deg, green 10% → green 6%)——同一色相的两档混面，
   差异小到读不出来，却让「卡片默认平面」这条规则有了例外。改为单一平涂
   color-mix(green 8%)：保留「完成=绿」的语义编码，去掉无意义的渐变。
   描边的 30% 绿边是状态识别的主要载体，保留不动。 */
.completion-card { margin-top: 16px; padding: 20px; background: color-mix(in srgb, var(--green) 8%, var(--surface)); border: 1px solid color-mix(in srgb, var(--green) 30%, var(--line)); border-radius: var(--mk-radius-xl); }
/* summary-only 降级档提示：琥珀色系 = 「降级但可用」，与卡内 attribution-tag 同一套 amber token 口径 */
.summary-only-notice { margin: 0 0 12px; padding: 8px 12px; font-size: 12px; line-height: 1.6; color: var(--amber-deep, var(--mk-amber)); background: color-mix(in srgb, var(--amber, #d97706) 8%, var(--surface)); border: 1px solid color-mix(in srgb, var(--amber, #d97706) 30%, var(--line)); border-radius: 8px; }
.completion-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.completion-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--green); }
.completion-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; padding: 12px; background-color: color-mix(in srgb, var(--surface) 82%, transparent); border-radius: 8px; }
.summary-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
/* 主题独占整行：任务标题是一整句话，塞进与「31 分钟」同宽的格子里会被压成 3 行，
   同排其余格子又空出大片（2026-11-03 排版优化，评估页报告模式同样按这条走）。 */
.summary-item--topic { grid-column: 1 / -1; }
.summary-label { font-size: 12px; color: var(--muted); }
.summary-value { font-size: 13px; font-weight: 600; color: var(--green); }
/* 主题总结（原独立卡）作为概览卡正文：与读数之间一条细虚线分隔，不另起一张卡 */
.summary-topic {
  grid-column: 1 / -1;
  margin: 2px 0 0; padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--green) 18%, var(--line));
  font-size: 13px; line-height: 1.7; color: var(--ink);
}
.completion-section { margin-bottom: 16px; padding: 12px; background-color: color-mix(in srgb, var(--surface) 82%, transparent); border-radius: 8px; }
/* 关键收获 / 下一步建议 左右双栏（≥1024）：两张卡各只有 3 条短列表，单列满宽时右半边全空。
   两栏等高（stretch），语义上「收获 → 怎么练」正好对照。窄屏自动回落单列。 */
.completion-duo { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
.completion-duo > .completion-section { margin-bottom: 16px; }
@media (min-width: 1024px) {
  .completion-duo { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .completion-duo > .completion-section { margin-bottom: 16px; }
}
.advisory-section { border: 1px solid var(--line); }
.section-attribution { margin: 6px 0 0; font-size: 13px; line-height: 1.6; color: var(--ink-2, var(--wf-text-secondary)); }
.attribution-tag {
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: var(--mk-radius-pill);
  font-size: 12px;
  color: var(--amber-deep, var(--mk-amber));
  background: rgba(217, 119, 6, 0.12);
  border: 1px solid rgba(217, 119, 6, 0.3);
}
.advisory-section--high { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); background: color-mix(in srgb, var(--red) 8%, var(--surface)); }
.advisory-section--medium { border-color: color-mix(in srgb, var(--amber) 45%, var(--line)); background: color-mix(in srgb, var(--amber) 10%, var(--surface)); }
.advisory-section--low { border-color: color-mix(in srgb, var(--green) 40%, var(--line)); background: color-mix(in srgb, var(--green) 8%, var(--surface)); }
.section-title { margin: 0 0 10px; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--green); }
/* 图标容器：等价 el-icon（1em、居中、继承字色/字号），移除 EP 依赖 */
.completion-icon { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; line-height: 1; font-size: inherit; flex: none; }
.completion-icon svg { width: 1em; height: 1em; }
.completion-icon--header { width: 24px; height: 24px; font-size: 24px; color: var(--green); }
.section-title .completion-icon { color: var(--accent, var(--mk-blue)); }
.section-hint { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
/* 并进上一段时的行内形态：跟随正文的流，不再自带换行与下边距 */
.section-hint--inline { display: inline; margin: 0 0 0 4px; }
.section-content { margin: 0; font-size: 13px; line-height: 1.7; color: var(--ink); }
.advisory-options { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
/* 指标网格（2026-11-06 屏效比）：
   本节表现 3 项 = 一行 3 列（任何宽度都不拆行）；长期状态 4 项 = PC 一行 4 列、窄屏 2×2。
   此前窄屏把 7 个指标排成 7 行单列，光数字就吃掉近 2 个手机屏（实测 850px）。 */
.metrics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.metrics-grid--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
/* text-align 必须显式写死（2026-11-06 走查）：全局 styles/learning-components.css 里同名
   .metric-card 带 text-align: center（那是学习状态页的 LSS/KTL 大卡），本组件的 scoped
   规则权重更高、但只覆盖自己声明过的属性——text-align 没人声明，于是继承到中心的文本对齐，
   于是出现「标题居中、下面那颗 flex 读数却在左下角」的错位。 */
.metric-card {
  position: relative; padding: 10px; text-align: left;
  border-radius: 8px; border: 1px solid color-mix(in srgb, var(--green) 20%, var(--line));
  background: var(--surface);
}
/* 标签给 ⓘ 让出右上角；读数与档位同一基线（此前档位在标签行，读数是孤立大数字） */
.metric-label { display: block; padding-right: 18px; font-size: 12px; line-height: 1.35; color: var(--muted); }
.metric-badge { flex: none; font-size: 12px; padding: 2px 6px; border-radius: var(--mk-radius-pill); background: color-mix(in srgb, var(--green) 10%, var(--surface)); color: var(--green); }
.metric-value { margin-top: 6px; display: flex; align-items: flex-start; gap: 6px; font-size: 22px; font-weight: 700; color: var(--green); }
/* 指标说明 ⓘ：绝对定位在卡片右上角，不占行高；点开是浮层，不是常驻长句 */
.metric-help { position: absolute; top: 4px; right: 4px; }
.metric-help__btn {
  display: grid; place-items: center;
  width: 20px; height: 20px; border-radius: 50%;
  font-size: 13px; line-height: 1; color: var(--faint);
  cursor: pointer; list-style: none;
}
.metric-help__btn::-webkit-details-marker { display: none; }
.metric-help__btn:hover, .metric-help[open] .metric-help__btn { color: var(--green); background: color-mix(in srgb, var(--green) 10%, transparent); }
.metric-help__body {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
  width: min(240px, 70vw); margin: 0; padding: 8px 10px;
  font-size: 12px; line-height: 1.55; color: var(--ink);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: var(--mk-shadow-modal);
}
.metric-card--good { border-color: color-mix(in srgb, var(--green) 30%, var(--line)); }
.metric-card--normal { border-color: color-mix(in srgb, var(--green) 30%, var(--line)); }
.metric-card--warn { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
.knowledge-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.knowledge-item { padding: 10px; border: 1px solid color-mix(in srgb, var(--green) 18%, var(--line)); border-radius: 8px; background: var(--surface); }
.knowledge-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.knowledge-name { font-size: 13px; font-weight: 600; color: var(--ink); }
.knowledge-evidence { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
/* 有序列表（关键收获 = 纯文本；下一步建议 = MarkdownRenderer 包装）
   2026-11-06 修复字号穿帮：下一步建议的正文走 markdown 渲染器，段落自带 17px/宽松行高，
   于是同一张卡里「关键收获」是 13px、紧邻的「下一步建议」却是 17–18px 大白字——
   比它自己的标题（14px）还大。两条列表统一到 14px，并把渲染器内部段落强制继承字号/颜色/行高。 */
.ordered-list { margin: 0; padding-left: 0; list-style-position: inside; list-style-type: decimal; font-size: 14px; line-height: 1.6; color: var(--ink); }
.ordered-list li { margin: 0 0 6px; overflow-wrap: anywhere; }
.ordered-list li :deep(.markdown-renderer) { display: inline; font-size: inherit; color: inherit; line-height: inherit; }
.ordered-list li :deep(.markdown-renderer > p) { display: inline; margin: 0; font-size: inherit; color: inherit; line-height: inherit; }
.ordered-list li :deep(.markdown-renderer p),
.ordered-list li :deep(.markdown-renderer li) { font-size: inherit; line-height: inherit; color: inherit; }
.ordered-list li:last-child { margin-bottom: 0; }
.evaluation-block { display: grid; gap: 8px; }
.evaluation-line { margin: 0; font-size: 13px; line-height: 1.7; color: var(--ink); }

/* 状态标签：以 .status-tag 原语为基，尺寸对齐旧 el-tag small（色 token 不变）。
   flex/nowrap 是必需的：标签挂在 .knowledge-head（space-between）里，默认可收缩，
   窄屏下会被挤到 51px < 内容 62px，中文随即折成两行、溢出 20px 高的胶囊。 */
.completion-card .status-tag { flex: 0 0 auto; white-space: nowrap; justify-content: center; gap: 0; height: 20px; padding: 0 7px; line-height: 1; letter-spacing: normal; text-transform: none; }
.completion-card .knowledge-name { min-width: 0; }
.status-tag--efficient { background: var(--color-efficient-bg); color: var(--color-efficient-dark); border: 1px solid var(--color-efficient-border); }

/* 第一方按钮：视觉对齐原 el-button 及其全局 EP 覆写（tremor-theme / design-system） */
.completion-btn { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; white-space: nowrap; vertical-align: middle; cursor: pointer; font-family: inherit; line-height: 1; border: 1px solid transparent; border-radius: var(--mk-radius-pill); transition: all 180ms ease; }
/* 2026-09-25 移动框架：这是「保持原计划/查看调整建议/确认调整」一类主决策钮，
   桌面 24→36、≤640 44（原 34 仍低于 HIG 触控下限） */
.completion-btn--small { height: 36px; padding: 5px 13px; font-size: 12px; }
.completion-btn--default { background: var(--bg-surface); border-color: var(--border-default); color: var(--text-primary); font-weight: 600; }
/* 底部动作按钮此前走 el-button 默认型（灰色文字），非 --default 型；对齐其视觉 */
.completion-btn--default:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--mk-blue); color: var(--mk-blue); }
/* 平面化：主按钮保持实心 --mk-blue，去掉配套的蓝色发光投影 */
.completion-btn--primary { background: var(--mk-blue); border-color: var(--mk-blue); color: var(--text-on-primary); font-weight: var(--font-medium); }
.completion-btn--primary:hover:not(:disabled) { background: var(--mk-accent-deep); border-color: var(--mk-accent-deep); color: var(--text-on-primary); box-shadow: var(--wf-shadow-raised); }
.completion-btn--primary:active:not(:disabled) { transform: scale(0.98); }
.completion-btn:disabled { cursor: not-allowed; }
.completion-btn + .completion-btn { margin-left: 12px; }
/* 窄屏 4 项走 2×2（原先 1 列 = 4 行）；3 项保持一行 3 列 */
@media (max-width: 900px) {
  .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .completion-summary {
    grid-template-columns: 1fr;
  }

  /* 3 列窄卡：内边距与读数各收一档，6 字标签 + ⓘ 才不折成三行 */
  .metric-card { padding: 8px 8px 7px; }
  .metric-value { font-size: 18px; gap: 4px; }
  .metric-label { padding-right: 14px; }

  /* 卡尾动作区已整块撤除（动作在页面顶部操作栏 / 窄屏吸底条）；
     这里只剩建议卡里的选项按钮要铺满整宽 */
  .advisory-options .completion-btn {
    width: 100%;
    margin-left: 0;
  }

  /* --small 只有 24px 高，而这里正是「保持原计划 / 查看调整建议 / 确认调整后续阶段」
     这类主决策按钮；窄屏已铺满整宽，触屏高度抬到 34px */
  .completion-btn--small { height: 44px; padding: 8px 12px; }
}
/* 触屏设备（含 641–1023 横屏手机 / 小平板，如 844×390）：此档此前只有 36px，
   低于 40 触控下限，而同页 375 竖屏已达 44——按指针类型统一抬到 44（LY11）。 */
@media (pointer: coarse) {
  .completion-btn--small { height: 44px; padding: 8px 12px; }
}
</style>
