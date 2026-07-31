<template>
  <section class="state-observatory" aria-labelledby="state-observatory-title">
    <header class="state-observatory__head">
      <div>
        <span class="state-observatory__kicker">CURRENT RUN · STATE OBSERVATORY</span>
        <h3 id="state-observatory-title">双源状态观测</h3>
        <p>Actor 主观自报与 Platform 正式计算独立展示，仅用于对照，不合并为同一指标。</p>
      </div>
      <div class="state-observatory__counts" aria-label="状态数据统计">
        <span
          ><b>{{ actorEntries.length }}</b> Actor 状态点</span
        >
        <span
          ><b>{{ platformEntries.length }}</b> Platform 记录</span
        >
        <span v-if="frictionBudget"
          >FRICTION <b>{{ frictionBudgetLabel }}</b></span
        >
        <span v-if="degradedCount" class="state-observatory__degraded"
          ><b>{{ degradedCount }}</b> 降级来源</span
        >
      </div>
    </header>

    <div
      v-if="loading && !timeline"
      class="state-observatory__loading"
      aria-label="状态时间线加载中"
    >
      <span v-for="index in 6" :key="index"></span>
    </div>

    <div v-else class="state-sources">
      <article class="state-source state-source--actor">
        <header class="state-source__head">
          <div>
            <span class="source-mark source-mark--actor">A</span>
            <div>
              <h4>Actor 主观状态</h4>
              <p>角色模型逐步自报，连续指标统一换算为 0-100 展示值。</p>
            </div>
          </div>
          <span class="source-badge">SIMULATED</span>
        </header>

        <div v-if="actorEntries.length" class="state-source__body">
          <div class="stage-switch" aria-label="Actor 阶段筛选">
            <button
              v-for="option in actorStageOptions"
              :key="option.key"
              type="button"
              :class="{ active: actorStage === option.key }"
              :aria-pressed="actorStage === option.key"
              @click="actorStage = option.key"
            >
              {{ option.label }}
              <span>{{ option.count }}</span>
            </button>
          </div>

          <div v-if="actorEmotionEntries.length" class="emotion-track">
            <div class="emotion-track__label">
              <span>情绪轨迹</span>
              <small>离散类别，不数值化</small>
            </div>
            <div class="emotion-track__steps">
              <span
                v-for="entry in actorEmotionEntries"
                :key="`${entry.sequence}-${entry.emotion}-${entry.generatedAt}`"
                :class="['emotion-step', emotionTone(entry.emotion), { degraded: entry.degraded }]"
                :title="`#${entry.sequence} ${emotionLabel(entry.emotion || '')}${entry.degraded ? ' · fallback' : ''}`"
              >
                <i></i>
                <b>#{{ entry.sequence }}</b>
              </span>
            </div>
          </div>

          <div v-if="visibleActorMetrics.length" class="metric-lanes">
            <div
              v-for="metric in visibleActorMetrics"
              :key="metric.key"
              class="metric-lane"
              :style="{ '--metric-color': metric.color }"
            >
              <div class="metric-lane__label">
                <span>{{ metric.label }}</span>
                <small>{{ metric.note }}</small>
              </div>
              <svg
                viewBox="0 0 300 48"
                role="img"
                :aria-label="`${metric.label}趋势`"
                preserveAspectRatio="none"
              >
                <line x1="5" y1="24" x2="295" y2="24" class="metric-lane__guide" />
                <polyline
                  v-if="actorMetricPoints(metric.key)"
                  :points="actorMetricPoints(metric.key)"
                  class="metric-lane__line"
                />
                <circle
                  v-for="dot in actorMetricDots(metric.key)"
                  :key="`${metric.key}-${dot.index}`"
                  :cx="dot.x"
                  :cy="dot.y"
                  r="2.7"
                  class="metric-lane__dot"
                />
              </svg>
              <strong>{{ formatMetric(actorMetricLatest(metric.key)) }}</strong>
            </div>
          </div>

          <ol class="state-events" aria-label="Actor 最近状态事件">
            <li
              v-for="entry in recentActorEntries"
              :key="`${entry.stage}-${entry.sequence}-${entry.generatedAt}`"
            >
              <div class="state-event__rail">
                <span>#{{ entry.sequence }}</span>
                <i></i>
              </div>
              <div class="state-event__content">
                <div class="state-event__head">
                  <div>
                    <strong>{{ phaseLabel(entry.phaseFocus, entry.stage) }}</strong>
                    <span v-if="entry.emotion">{{ emotionLabel(entry.emotion) }}</span>
                    <span v-if="entry.transition">{{ transitionLabel(entry.transition) }}</span>
                  </div>
                  <time>{{ formatEventTime(entry.generatedAt) }}</time>
                </div>
                <div v-if="actorEventMetrics(entry).length" class="state-event__metrics">
                  <span v-for="metric in actorEventMetrics(entry)" :key="metric.label">
                    {{ metric.label }} <b>{{ formatMetric(metric.value) }}</b>
                  </span>
                </div>
                <p v-if="entry.stateChangeReason">{{ entry.stateChangeReason }}</p>
                <p v-else-if="entry.blockers?.length" class="state-event__blocker">
                  阻塞：{{ entry.blockers.join('；') }}
                </p>
                <span v-if="entry.degraded" class="degraded-flag"
                  >FALLBACK · 本回合不宜用于保真结论</span
                >
              </div>
            </li>
          </ol>
        </div>

        <div v-else class="state-source__empty">
          <strong>尚无 Actor 状态</strong>
          <p>执行首个 Goal 或 Learn 自动回合后，这里会出现角色主观状态。</p>
        </div>
      </article>

      <article class="state-source state-source--platform">
        <header class="state-source__head">
          <div>
            <span class="source-mark source-mark--platform">P</span>
            <div>
              <h4>Platform 实测状态</h4>
              <p>正式 Teaching Session 结束后提交的 LSS、KTL、LF、LSB。</p>
            </div>
          </div>
          <span class="source-badge">PLATFORM</span>
        </header>

        <div v-if="platformUnavailable" class="state-source__empty state-source__empty--error">
          <strong>Platform 状态暂不可用</strong>
          <p>Actor 时间线仍可查看；刷新后将重新读取当前 Run 的正式 Teaching Session 指标。</p>
        </div>

        <div v-else-if="platformEntries.length" class="state-source__body">
          <div class="metric-lanes metric-lanes--platform">
            <div
              v-for="metric in platformMetricDefinitions"
              :key="metric.key"
              class="metric-lane"
              :style="{ '--metric-color': metric.color }"
            >
              <div class="metric-lane__label">
                <span>{{ metric.label }}</span>
                <small>{{ metric.note }}</small>
              </div>
              <svg
                viewBox="0 0 300 48"
                role="img"
                :aria-label="`${metric.label}趋势`"
                preserveAspectRatio="none"
              >
                <line
                  x1="5"
                  :y1="metric.key === 'lsb' ? 24 : 43"
                  x2="295"
                  :y2="metric.key === 'lsb' ? 24 : 43"
                  class="metric-lane__guide"
                />
                <polyline
                  v-if="platformMetricPoints(metric.key)"
                  :points="platformMetricPoints(metric.key)"
                  class="metric-lane__line"
                />
                <circle
                  v-for="dot in platformMetricDots(metric.key)"
                  :key="`${metric.key}-${dot.index}`"
                  :cx="dot.x"
                  :cy="dot.y"
                  r="2.7"
                  class="metric-lane__dot"
                />
              </svg>
              <strong>{{
                formatPlatformMetric(metric.key, platformMetricLatest(metric.key))
              }}</strong>
            </div>
          </div>

          <ol class="state-events state-events--platform" aria-label="Platform 状态提交记录">
            <li v-for="(entry, index) in recentPlatformEntries" :key="entry.teachingSessionId">
              <div class="state-event__rail">
                <span>T{{ platformEntries.length - index }}</span>
                <i></i>
              </div>
              <div class="state-event__content">
                <div class="state-event__head">
                  <div>
                    <strong>{{ entry.metrics ? '状态已提交' : '等待状态提交' }}</strong>
                    <span>{{ platformSourceLabel(entry.source) }}</span>
                  </div>
                  <time>{{ formatEventTime(entry.calculatedAt) }}</time>
                </div>
                <div
                  v-if="entry.metrics"
                  class="state-event__metrics state-event__metrics--platform"
                >
                  <span
                    >LSS <b>{{ formatMetric(entry.metrics.lss) }}</b></span
                  >
                  <span
                    >KTL <b>{{ formatMetric(entry.metrics.ktl) }}</b></span
                  >
                  <span
                    >LF <b>{{ formatMetric(entry.metrics.lf) }}</b></span
                  >
                  <span
                    >LSB <b>{{ formatPlatformMetric('lsb', entry.metrics.lsb) }}</b></span
                  >
                </div>
                <p class="state-event__session">
                  SESSION {{ shortId(entry.teachingSessionId)
                  }}<template v-if="entry.taskId"> · TASK {{ shortId(entry.taskId) }}</template>
                </p>
                <span v-if="entry.degraded" class="degraded-flag">
                  {{
                    entry.evaluationSource === 'ai-fallback'
                      ? 'AI FALLBACK'
                      : entry.source === 'missing'
                        ? 'PENDING / MISSING'
                        : 'DEGRADED SOURCE'
                  }}
                </span>
              </div>
            </li>
          </ol>
        </div>

        <div v-else class="state-source__empty">
          <strong>尚无 Platform 状态提交</strong>
          <p>该 Run 尚未结束正式 Teaching Session；平台指标不会用账号的其他实验历史补齐。</p>
        </div>
      </article>
    </div>

    <footer class="state-observatory__note">
      <span>Actor：模拟角色的主观感受，不是心理测量结果。</span>
      <span>Platform：正式行为链路计算结果，仅绑定当前 Run 出现的 Teaching Session。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'

  type ActorStage = 'goal' | 'learning'
  type PlatformMetricKey = 'lss' | 'ktl' | 'lf' | 'lsb'

  interface ActorStateEntry {
    sequence: number
    stage: ActorStage
    taskId?: string | null
    phaseFocus?: string | null
    emotion?: string | null
    degraded?: boolean
    transition?: string | null
    stateChangeReason?: string | null
    visibleSignal?: string | null
    metrics?: Record<string, number>
    flags?: Record<string, boolean>
    blockers?: string[]
    generatedAt?: string | null
  }

  interface PlatformStateEntry {
    teachingSessionId: string
    taskId?: string | null
    pathId?: string | null
    status?: string
    metrics?: Record<PlatformMetricKey, number> | null
    calculatedAt?: string | null
    source?: 'committed-metric' | 'teaching-wrapup' | 'missing'
    summarySource?: string | null
    evaluationSource?: string | null
    degraded?: boolean
  }

  interface StateTimeline {
    scope?: string
    actor?: { scale?: string; entries?: ActorStateEntry[] }
    platform?: {
      scale?: string
      status?: 'ok' | 'unavailable'
      errorCode?: string | null
      entries?: PlatformStateEntry[]
    }
  }

  interface MetricDefinition {
    key: string
    label: string
    note: string
    color: string
  }

  const props = defineProps<{
    timeline?: StateTimeline | null
    loading?: boolean
    frictionBudget?: string | null
  }>()

  const actorEntries = computed(() =>
    Array.isArray(props.timeline?.actor?.entries) ? props.timeline.actor.entries : []
  )
  const platformEntries = computed(() =>
    Array.isArray(props.timeline?.platform?.entries) ? props.timeline.platform.entries : []
  )
  const platformUnavailable = computed(() => props.timeline?.platform?.status === 'unavailable')
  const actorStage = ref<ActorStage>('learning')

  const actorMetricDefinitions: Record<ActorStage, MetricDefinition[]> = {
    goal: [
      { key: 'goalReadiness', label: '目标就绪', note: '愿意继续', color: '#2f6fb3' },
      { key: 'feltUnderstood', label: '被理解感', note: '主观感受', color: '#5b7c99' },
      { key: 'problemClarity', label: '问题清晰', note: '自我判断', color: '#43856f' },
      { key: 'executionConcern', label: '执行顾虑', note: '越高越担忧', color: '#b66b3d' }
    ],
    learning: [
      { key: 'cognitiveLoad', label: '认知负荷', note: '主观负荷', color: '#b66b3d' },
      { key: 'confidence', label: '信心', note: '学习者自评', color: '#2f6fb3' },
      { key: 'satisfaction', label: '满意度', note: '本任务体验', color: '#43856f' },
      { key: 'taskUnderstanding', label: '任务理解', note: '当前理解', color: '#74649a' }
    ]
  }

  const platformMetricDefinitions: Array<MetricDefinition & { key: PlatformMetricKey }> = [
    { key: 'lss', label: 'LSS', note: '学习压力', color: '#b66b3d' },
    { key: 'ktl', label: 'KTL', note: '掌握趋势', color: '#2f6fb3' },
    { key: 'lf', label: 'LF', note: '疲劳程度', color: '#74649a' },
    { key: 'lsb', label: 'LSB', note: '状态平衡 ±100', color: '#43856f' }
  ]

  const actorStageOptions = computed(() =>
    (['goal', 'learning'] as ActorStage[])
      .map((stage) => ({
        key: stage,
        label: stage === 'goal' ? '澄清' : '学习',
        count: actorEntries.value.filter((entry) => entry.stage === stage).length
      }))
      .filter((option) => option.count > 0)
  )

  const filteredActorEntries = computed(() =>
    actorEntries.value.filter((entry) => entry.stage === actorStage.value)
  )
  const visibleActorMetrics = computed(() =>
    actorMetricDefinitions[actorStage.value].filter((definition) =>
      filteredActorEntries.value.some(
        (entry) => finiteNumber(entry.metrics?.[definition.key]) !== null
      )
    )
  )
  const recentActorEntries = computed(() => [...filteredActorEntries.value].slice(-6).reverse())
  const actorEmotionEntries = computed(() =>
    filteredActorEntries.value.filter((entry) => Boolean(entry.emotion))
  )
  const recentPlatformEntries = computed(() => [...platformEntries.value].slice(-6).reverse())
  const degradedCount = computed(
    () =>
      actorEntries.value.filter((entry) => entry.degraded).length +
      platformEntries.value.filter((entry) => entry.degraded).length
  )
  const frictionBudgetLabel = computed(() => {
    const labels: Record<string, string> = {
      none: 'NONE',
      low: 'LOW',
      normal: 'NORMAL',
      high: 'HIGH',
      stress_test: 'STRESS'
    }
    return labels[props.frictionBudget || ''] || String(props.frictionBudget || '').toUpperCase()
  })

  watch(
    actorEntries,
    (entries) => {
      const latestStage = entries[entries.length - 1]?.stage
      if (latestStage) actorStage.value = latestStage
    },
    { immediate: true }
  )

  function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean')
      return null
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }

  function sparklineDots(values: Array<number | null>, min: number, max: number) {
    const available = values
      .map((value, index) => ({ value, index }))
      .filter((item): item is { value: number; index: number } => item.value !== null)
    if (!available.length) return []
    const denominator = Math.max(values.length - 1, 1)
    return available.map((item) => ({
      index: item.index,
      x: Number((values.length === 1 ? 150 : 5 + (item.index / denominator) * 290).toFixed(2)),
      y: Number(
        (43 - ((Math.max(min, Math.min(max, item.value)) - min) / (max - min)) * 38).toFixed(2)
      )
    }))
  }

  function actorMetricValues(key: string) {
    return filteredActorEntries.value.map((entry) => finiteNumber(entry.metrics?.[key]))
  }

  function actorMetricDots(key: string) {
    return sparklineDots(actorMetricValues(key), 0, 100)
  }

  function actorMetricPoints(key: string) {
    return actorMetricDots(key)
      .map((dot) => `${dot.x},${dot.y}`)
      .join(' ')
  }

  function actorMetricLatest(key: string) {
    return [...actorMetricValues(key)].reverse().find((value) => value !== null) ?? null
  }

  function platformMetricValues(key: PlatformMetricKey) {
    return platformEntries.value.map((entry) => finiteNumber(entry.metrics?.[key]))
  }

  function platformMetricDots(key: PlatformMetricKey) {
    return sparklineDots(platformMetricValues(key), key === 'lsb' ? -100 : 0, 100)
  }

  function platformMetricPoints(key: PlatformMetricKey) {
    return platformMetricDots(key)
      .map((dot) => `${dot.x},${dot.y}`)
      .join(' ')
  }

  function platformMetricLatest(key: PlatformMetricKey) {
    return [...platformMetricValues(key)].reverse().find((value) => value !== null) ?? null
  }

  function actorEventMetrics(entry: ActorStateEntry) {
    const definitions = actorMetricDefinitions[entry.stage]
    return definitions
      .map((definition) => ({
        label: definition.label,
        value: finiteNumber(entry.metrics?.[definition.key])
      }))
      .filter((metric): metric is { label: string; value: number } => metric.value !== null)
      .slice(0, 4)
  }

  function formatMetric(value: number | null | undefined) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '--'
  }

  function formatPlatformMetric(key: string, value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
    return key === 'lsb' && value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
  }

  function formatEventTime(value?: string | null) {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }

  function phaseLabel(phase?: string | null, stage?: ActorStage) {
    const labels: Record<string, string> = {
      opening: '开始表达',
      understanding: '问题澄清',
      proposal_evaluation: '方案评估',
      trying: '尝试',
      blocked: '受阻',
      verifying: '验证理解',
      ready_to_close: '准备收口'
    }
    return labels[phase || ''] || (stage === 'goal' ? '澄清回合' : '学习回合')
  }

  function emotionLabel(emotion: string) {
    const labels: Record<string, string> = {
      neutral: '平静',
      slightly_frustrated: '轻微受挫',
      happy: '积极',
      confident: '有信心',
      confused: '困惑'
    }
    return labels[emotion] || emotion
  }

  function emotionTone(emotion?: string | null) {
    return emotion === 'confused'
      ? 'emotion-step--confused'
      : emotion === 'slightly_frustrated'
        ? 'emotion-step--frustrated'
        : emotion === 'happy' || emotion === 'confident'
          ? 'emotion-step--positive'
          : 'emotion-step--neutral'
  }

  function transitionLabel(transition: string) {
    return transition === 'task_completed' ? '任务归档' : transition
  }

  function platformSourceLabel(source?: PlatformStateEntry['source']) {
    return source === 'committed-metric'
      ? '正式提交'
      : source === 'teaching-wrapup'
        ? 'Wrapup 恢复'
        : '暂无指标'
  }

  function shortId(value?: string | null) {
    if (!value) return '--'
    return value.length > 10 ? `${value.slice(0, 8)}…` : value
  }
</script>

<style scoped>
  .state-observatory {
    overflow: hidden;
    border: 1px solid #d7e0eb;
    border-radius: 12px;
    background: #ffffff;
    box-shadow: 0 8px 24px rgba(37, 58, 87, 0.05);
  }

  .state-observatory__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding: 17px 20px 15px;
    border-bottom: 1px solid #e4eaf1;
    background: #f9fbfd;
  }

  .state-observatory__kicker {
    color: #607a99;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.1em;
  }

  .state-observatory__head h3 {
    margin: 4px 0 3px;
    color: #172b49;
    font-size: 16px;
  }

  .state-observatory__head p,
  .state-source__head p,
  .state-source__empty p {
    margin: 0;
    color: #718096;
    font-size: 11px;
    line-height: 1.55;
  }

  .state-observatory__counts {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .state-observatory__counts span {
    padding: 4px 8px;
    border: 1px solid #dce4ed;
    border-radius: 5px;
    background: #ffffff;
    color: #65758a;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 9px;
  }

  .state-observatory__counts b {
    color: #243b5a;
    font-size: 11px;
  }

  .state-observatory__counts .state-observatory__degraded {
    border-color: #e9c8ad;
    background: #fff8f1;
    color: #9a572f;
  }

  .state-observatory__loading {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 20px;
  }

  .state-observatory__loading span {
    height: 38px;
    border-radius: 6px;
    background: linear-gradient(90deg, #edf1f5 25%, #f7f9fb 50%, #edf1f5 75%);
    background-size: 200% 100%;
    animation: state-loading 1.4s ease infinite;
  }

  .state-sources {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .state-source {
    min-width: 0;
    padding: 17px 20px 18px;
  }

  .state-source + .state-source {
    border-left: 1px solid #e4eaf1;
  }

  .state-source__head,
  .state-source__head > div {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .state-source__head > div {
    justify-content: flex-start;
  }

  .source-mark {
    display: grid;
    flex: 0 0 27px;
    width: 27px;
    height: 27px;
    place-items: center;
    border-radius: 6px;
    color: #ffffff;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
    font-weight: 900;
  }

  .source-mark--actor {
    background: #74649a;
  }

  .source-mark--platform {
    background: #2f6fb3;
  }

  .state-source__head h4 {
    margin: 0 0 2px;
    color: #243b5a;
    font-size: 13px;
  }

  .source-badge {
    padding: 3px 6px;
    border: 1px solid #dce4ed;
    border-radius: 4px;
    color: #718096;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 8px;
    letter-spacing: 0.08em;
  }

  .state-source__body {
    display: grid;
    gap: 15px;
    margin-top: 15px;
  }

  .stage-switch {
    display: flex;
    gap: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid #edf1f5;
  }

  .stage-switch button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #718096;
    cursor: pointer;
    font: inherit;
    font-size: 10px;
    font-weight: 700;
  }

  .stage-switch button:hover,
  .stage-switch button.active {
    border-color: #d8e1ec;
    background: #f2f6fa;
    color: #243b5a;
  }

  .stage-switch button:active {
    transform: translateY(1px);
  }

  .stage-switch span {
    color: #8c99aa;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 9px;
  }

  .metric-lanes {
    display: grid;
    gap: 7px;
  }

  .emotion-track {
    display: grid;
    grid-template-columns: 94px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid #edf1f5;
    border-bottom: 1px solid #edf1f5;
  }

  .emotion-track__label {
    display: grid;
    gap: 1px;
  }

  .emotion-track__label span {
    color: #334a68;
    font-size: 10px;
    font-weight: 800;
  }

  .emotion-track__label small {
    color: #8a96a6;
    font-size: 8px;
  }

  .emotion-track__steps {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    min-width: 0;
    padding: 4px 1px;
    overflow-x: auto;
  }

  .emotion-step {
    display: grid;
    flex: 0 0 auto;
    justify-items: center;
    gap: 3px;
  }

  .emotion-step i {
    width: 8px;
    height: 8px;
    border: 2px solid #ffffff;
    border-radius: 50%;
    background: #8492a5;
    box-shadow: 0 0 0 1px #bfc9d5;
  }

  .emotion-step b {
    color: #8a96a6;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 7px;
    font-weight: 700;
  }

  .emotion-step--confused i {
    background: #74649a;
    box-shadow: 0 0 0 1px #9a8db8;
  }

  .emotion-step--frustrated i {
    background: #b66b3d;
    box-shadow: 0 0 0 1px #d39a75;
  }

  .emotion-step--positive i {
    background: #43856f;
    box-shadow: 0 0 0 1px #75aa98;
  }

  .emotion-step.degraded i {
    border-color: #fff4e8;
    box-shadow: 0 0 0 2px #cf8656;
  }

  .metric-lane {
    display: grid;
    grid-template-columns: 94px minmax(100px, 1fr) 42px;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .metric-lane__label {
    display: grid;
    min-width: 0;
    gap: 1px;
  }

  .metric-lane__label span {
    color: #334a68;
    font-size: 10px;
    font-weight: 800;
  }

  .metric-lane__label small {
    color: #8a96a6;
    font-size: 8px;
  }

  .metric-lane svg {
    width: 100%;
    height: 38px;
    overflow: visible;
  }

  .metric-lane__guide {
    stroke: #e7ecf2;
    stroke-dasharray: 3 4;
    stroke-width: 1;
  }

  .metric-lane__line {
    fill: none;
    stroke: var(--metric-color);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  .metric-lane__dot {
    fill: #ffffff;
    stroke: var(--metric-color);
    stroke-width: 1.7;
    vector-effect: non-scaling-stroke;
  }

  .metric-lane > strong {
    color: var(--metric-color);
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
    text-align: right;
  }

  .state-events {
    display: grid;
    max-height: 310px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .state-events li {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 8px;
  }

  .state-event__rail {
    display: grid;
    grid-template-rows: auto 1fr;
    justify-items: center;
    min-height: 68px;
  }

  .state-event__rail span {
    display: grid;
    min-width: 25px;
    height: 21px;
    place-items: center;
    border: 1px solid #dce4ed;
    border-radius: 4px;
    background: #ffffff;
    color: #67768a;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 8px;
  }

  .state-event__rail i {
    width: 1px;
    height: 100%;
    background: #e2e8ef;
  }

  .state-events li:last-child .state-event__rail i {
    display: none;
  }

  .state-event__content {
    min-width: 0;
    padding: 1px 0 13px;
  }

  .state-event__head,
  .state-event__head > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
  }

  .state-event__head > div {
    justify-content: flex-start;
    min-width: 0;
    flex-wrap: wrap;
  }

  .state-event__head strong {
    color: #2f435f;
    font-size: 10px;
  }

  .state-event__head span {
    padding-left: 7px;
    border-left: 1px solid #dce4ed;
    color: #758397;
    font-size: 9px;
  }

  .state-event__head time {
    flex-shrink: 0;
    color: #96a0af;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 8px;
  }

  .state-event__metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin-top: 6px;
  }

  .state-event__metrics span {
    color: #78869a;
    font-size: 9px;
  }

  .state-event__metrics b {
    color: #344b68;
    font-family: 'JetBrains Mono', Consolas, monospace;
  }

  .state-event__metrics--platform b {
    color: #2f6fb3;
  }

  .state-event__content p {
    margin: 5px 0 0;
    color: #66758a;
    font-size: 9px;
    line-height: 1.5;
  }

  .state-event__content .state-event__blocker {
    color: #95562f;
  }

  .state-event__content .state-event__session {
    color: #8b96a6;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 8px;
  }

  .degraded-flag {
    display: inline-block;
    margin-top: 6px;
    padding: 2px 5px;
    border: 1px solid #e9c8ad;
    border-radius: 3px;
    background: #fff8f1;
    color: #9a572f;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 8px;
    font-weight: 800;
  }

  .state-source__empty {
    display: grid;
    min-height: 210px;
    place-content: center;
    gap: 4px;
    padding: 28px;
    text-align: center;
  }

  .state-source__empty strong {
    color: #445a75;
    font-size: 12px;
  }

  .state-source__empty--error strong {
    color: #9a572f;
  }

  .state-source__empty p {
    max-width: 340px;
  }

  .state-observatory__note {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    padding: 9px 20px;
    border-top: 1px solid #e4eaf1;
    background: #fbfcfd;
    color: #7d8999;
    font-size: 9px;
  }

  @keyframes state-loading {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .state-observatory__loading span {
      animation: none;
    }
  }

  @media (max-width: 1100px) {
    .state-sources {
      grid-template-columns: 1fr;
    }

    .state-source + .state-source {
      border-top: 1px solid #e4eaf1;
      border-left: 0;
    }
  }

  @media (max-width: 680px) {
    .state-observatory__head {
      flex-direction: column;
      gap: 12px;
      padding: 15px 16px;
    }

    .state-observatory__counts {
      justify-content: flex-start;
    }

    .state-source {
      padding: 15px 16px 17px;
    }

    .source-badge {
      display: none;
    }

    .metric-lane {
      grid-template-columns: 78px minmax(80px, 1fr) 39px;
      gap: 7px;
    }

    .emotion-track {
      grid-template-columns: 78px minmax(0, 1fr);
      gap: 7px;
    }

    .metric-lane svg {
      height: 34px;
    }

    .state-event__head {
      align-items: flex-start;
      flex-direction: column;
      gap: 3px;
    }

    .state-observatory__note {
      padding: 9px 16px;
    }
  }
</style>
