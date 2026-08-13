<template>
  <div v-if="notFound" class="mk-page ld">
    <div class="mk-empty">
      <strong>未找到该学习者</strong>
      <span>学习者可能已被删除，或链接已失效。</span>
      <button type="button" class="mk-link" @click="closeSubPage">← 返回学习者中心</button>
    </div>
  </div>
  <div v-else-if="detailError" class="mk-page ld">
    <div class="mk-empty">
      <span class="mk-empty__icon" aria-hidden="true">◌</span>
      <strong>详情加载失败</strong>
      <span>暂时无法获取该学习者的完整快照。</span>
      <button type="button" class="mk-empty__action" @click="loadDetail(subPage?.id, isLive)">重试</button>
    </div>
  </div>
  <div v-else-if="d" class="mk-page ld">

    <!-- 头部：身份与状态 -->
    <div class="ld-head">
      <button type="button" class="ld-back" @click="closeSubPage">← 学习者中心</button>
      <div class="ld-id">
        <span class="ld-avatar">{{ d.name.charAt(0) }}</span>
        <div>
          <h1 class="ld-name">{{ d.name }}</h1>
          <span class="ld-sub">{{ d.email }} · 加入 {{ d.joined }}</span>
        </div>
        <div class="ld-badges">
          <span class="mk-badge" :class="trendBadge">趋势：{{ trendText }}</span>
          <span class="mk-badge" :class="fatigueBadge">疲劳：{{ d.fatigue }}</span>
          <span class="mk-badge" :class="snapshotBadge" :title="snapshotHint">快照 {{ d.snapshot.version }} · {{ d.snapshot.generatedAt }}</span>
        </div>
        <button type="button" class="mk-status__action" :disabled="recomputing" @click="recompute">
          {{ recomputing ? '重算中…' : '重算快照' }}
        </button>
      </div>
    </div>

    <!-- Tab 栏（6 → 3 合并：总览 / 画像 / 证据；旧 tab 名由 normalizeLearnerTab 重定向） -->
    <div class="ld-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': tab === t.id }"
        @click="switchTab(t.id)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- ============ 总览：进度 + 概念掌握图形 + 活跃 + 会话 + 建议行动 ============ -->
    <div v-if="tab === 'overview'" class="ld-grid">
      <div class="ld-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">当前进度</h3>
            <span class="mk-badge mk-badge--info">{{ d.pct }}%</span>
          </div>
          <div class="ld-progress">
            <strong>{{ d.path }}</strong>
            <span class="ld-progress__stage">{{ d.stage }}</span>
            <div class="ld-progress__bar"><i :style="{ width: d.pct + '%' }"></i></div>
            <p class="ld-progress__task">正在做：{{ d.task }}</p>
            <p v-if="milestoneTasks" class="ld-progress__task">当前里程碑：已完成 {{ milestoneTasks.done }}/{{ milestoneTasks.total }} 个任务</p>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">概念掌握</h3>
            <span class="mk-card__meta">{{ conceptBars.length }} 个概念</span>
          </div>
          <div v-if="conceptBars.length" class="ld-bars">
            <div v-for="c in conceptBars" :key="c.label" class="ld-bar">
              <div class="ld-bar__head">
                <strong :title="`转移就绪：${c.readiness} · 误解风险：${c.risk}`">{{ c.label }}</strong>
                <span class="ld-bar__badges">
                  <span class="mk-badge" :class="barToneBadge(c.tone)">{{ c.readiness }}</span>
                  <span class="ld-bar__risk" :class="`ld-bar__risk--${c.riskTone}`">误解 {{ c.risk }}</span>
                  <span v-if="c.evidenceCount > 0" class="ld-bar__ev" :title="`证据 ${c.evidenceCount} 条`">{{ c.evidenceCount }} 证据</span>
                </span>
              </div>
              <div class="ld-bar__track">
                <i :class="`ld-bar__fill is-${c.tone}`" :style="{ width: c.width + '%' }"></i>
              </div>
            </div>
          </div>
          <p v-else class="ld-none">
            {{ isLive ? '暂无概念账本数据' : '演示模式下无数据' }}
            <span v-if="isLive" class="ld-none__hint">重算快照后由知识记忆服务生成。</span>
          </p>
        </section>
      </div>

      <div class="ld-col">
        <!-- 活跃柱图暂无真实数据源：live 且全 0 时隐藏，避免展示假趋势 -->
        <section v-if="!isLive || d.trend7d.some((v) => v > 0)" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">7 天活跃趋势</h3>
            <span class="mk-card__meta">{{ trendHint }}</span>
          </div>
          <div class="ld-trend">
            <span
              v-for="(v, i) in d.trend7d"
              :key="i"
              class="ld-trend__bar"
              :class="{ 'ld-trend__bar--down': d.trend === 'down' }"
              :style="{ height: (v / 7) * 100 + '%' }"
              :title="`${['周一','周二','周三','周四','周五','周六','周日'][i]} · 活跃 ${v}`"
            ></span>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近会话</h3>
            <span class="mk-card__meta">人类化证据</span>
          </div>
          <div class="ld-sessions">
            <div v-for="(s, i) in d.sessions" :key="i" class="ld-session">
              <span class="ld-session__dot" :class="`is-${s.tone}`"></span>
              <div class="ld-session__main">
                <strong>{{ evidenceTypeZh(s.title) }}</strong>
                <span>{{ s.result }}</span>
                <span v-if="s.concepts && s.concepts.length" class="ld-chips">
                  <span v-for="c in s.concepts.slice(0, 3)" :key="c" class="ld-chip">{{ c }}</span>
                </span>
              </div>
              <span class="ld-session__time">{{ s.time }}</span>
            </div>
            <p v-if="!d.sessions.length" class="ld-none">暂无会话记录</p>
          </div>
        </section>

        <section v-if="teachingHints" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">建议行动</h3>
            <span class="mk-card__meta">教学建议摘要</span>
          </div>
          <div class="ld-actions">
            <p v-if="teachingHints.recommendedApproach"><span class="ld-actions__k">方式</span>{{ teachingHints.recommendedApproach }}</p>
            <p v-if="teachingHints.promptEnhancement"><span class="ld-actions__k">Prompt</span>{{ teachingHints.promptEnhancement }}</p>
            <p v-if="riskFactors.length"><span class="ld-actions__k ld-actions__k--warn">风险</span>{{ riskFactors.join('；') }}</p>
            <button type="button" class="mk-status__action" :disabled="recomputing" @click="recompute">
              {{ recomputing ? '重算中…' : '重算快照' }}
            </button>
          </div>
        </section>
      </div>
    </div>

    <!-- ============ 画像：认知 + 偏好情绪 + 行为历史 + 课程控制 + 派生 + 记忆 + 教学建议 ============ -->
    <div v-else-if="tab === 'profile'" class="ld-tabpage">
      <template v-if="profile">
        <section class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">认知特征</h3></div>
          <div class="ld-kv">
            <div v-for="kv in cognitiveRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">偏好与情绪</h3></div>
          <div class="ld-kv">
            <div v-for="kv in preferenceRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="behaviorRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">学习行为基线</h3></div>
          <div class="ld-kv">
            <div v-for="kv in behaviorRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="historyRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">互动历史</h3></div>
          <div class="ld-kv">
            <div v-for="kv in historyRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="curriculumRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">课程控制</h3></div>
          <div class="ld-kv">
            <div v-for="kv in curriculumRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="derivedRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">派生洞察</h3></div>
          <div class="ld-kv">
            <div v-for="kv in derivedRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="narrativeInsights.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">叙述洞察</h3></div>
          <div class="ld-insights">
            <p v-for="(n, i) in narrativeInsights" :key="i">{{ n }}</p>
          </div>
        </section>
        <section v-if="memoryRows.length || foundations.reusable.length || foundations.blocked.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">全局信号与背景</h3></div>
          <div class="ld-kv">
            <div v-for="kv in memoryRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
          <div class="ld-found">
            <div>
              <span class="ld-concept-label ld-concept-label--ok">可复用基础 {{ foundations.reusable.length }}</span>
              <div class="ld-concept-list">
                <span v-for="c in foundations.reusable" :key="c" class="ld-concept ld-concept--ok">{{ c }}</span>
                <span v-if="!foundations.reusable.length" class="ld-none">—</span>
              </div>
            </div>
            <div>
              <span class="ld-concept-label ld-concept-label--bad">被阻塞基础 {{ foundations.blocked.length }}</span>
              <div class="ld-concept-list">
                <span v-for="c in foundations.blocked" :key="c" class="ld-concept ld-concept--bad">{{ c }}</span>
                <span v-if="!foundations.blocked.length" class="ld-none">—</span>
              </div>
            </div>
          </div>
        </section>
        <section v-if="controlFlags.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">教学控制信号</h3></div>
          <div class="ld-flags">
            <span v-for="f in controlFlags" :key="f.text" class="mk-badge" :class="f.on ? 'mk-badge--warn' : 'mk-badge--muted'">
              {{ f.text }}：{{ f.on ? '是' : '否' }}
            </span>
          </div>
        </section>
        <section v-if="teachingHints" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">强调 / 避免</h3></div>
          <div class="ld-two">
            <div>
              <span class="ld-concept-label ld-concept-label--ok">强调</span>
              <div class="ld-concept-list">
                <span v-for="c in teachingHints.emphasize || []" :key="c" class="ld-concept ld-concept--ok">{{ c }}</span>
                <span v-if="!(teachingHints.emphasize || []).length" class="ld-none">—</span>
              </div>
            </div>
            <div>
              <span class="ld-concept-label ld-concept-label--bad">避免</span>
              <div class="ld-concept-list">
                <span v-for="c in teachingHints.avoid || []" :key="c" class="ld-concept ld-concept--bad">{{ c }}</span>
                <span v-if="!(teachingHints.avoid || []).length" class="ld-none">—</span>
              </div>
            </div>
          </div>
        </section>
      </template>
      <p v-else class="ld-none">
        {{ isLive ? '暂无认知画像数据' : '演示模式下无数据' }}
        <span v-if="isLive" class="ld-none__hint">重算快照后生成。</span>
      </p>
    </div>

    <!-- ============ 证据：指标卡常驻 + 动态状态 + 人类化时间线 + 概念证据密度 ============ -->
    <div v-else-if="tab === 'evidence'" class="ld-tabpage">
      <template v-if="dynamicState">
        <div class="ld-metrics">
          <div v-for="m in metricCards" :key="m.label" class="ld-metric">
            <span>{{ m.label }}</span>
            <strong :class="m.cls">{{ m.value }}</strong>
            <em>{{ m.hint }}</em>
          </div>
        </div>
        <section class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">趋势与建议</h3></div>
          <div class="ld-kv">
            <div v-for="kv in dynamicRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
      </template>
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">证据时间线</h3>
          <span class="mk-card__meta">{{ evidence.length }} 条 · 点色=事件语义，置信=把握度</span>
        </div>
        <div v-if="evidence.length" class="ld-evidence">
          <div v-for="(e, i) in evidence" :key="i" class="ld-ev">
            <span
              class="ld-ev__dot"
              :class="`is-${evidenceDotTone(e.signal, e.score)}`"
              :title="evidenceTooltip(e.signal, e.score)"
            ></span>
            <div class="ld-ev__main">
              <strong>{{ evidenceTypeZh(e.title) }}</strong>
              <span>{{ e.detail || evidenceSignalZh(e.signal) || '—' }}</span>
              <span v-if="e.concepts.length" class="ld-chips">
                <span v-for="c in e.concepts.slice(0, 4)" :key="c" class="ld-chip">{{ c }}</span>
              </span>
            </div>
            <span v-if="evidenceLowConfidence(e.score)" class="ld-ev__lack" title="置信度低于 50%，结论仅供参考">证据不足</span>
            <span class="ld-ev__time">{{ e.time }}</span>
          </div>
        </div>
        <p v-else class="ld-none">
          {{ isLive ? '暂无证据记录' : '演示模式下无数据' }}
          <span v-if="isLive" class="ld-none__hint">学习事件累积后自动生成。</span>
        </p>
      </section>
      <section v-if="conceptStats.length" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">概念证据密度</h3>
          <span class="mk-card__meta">证据条数（conceptLedger）</span>
        </div>
        <div class="ld-bars ld-bars--dense">
          <div v-for="c in conceptStats" :key="c.label" class="ld-bar">
            <div class="ld-bar__head">
              <strong>{{ c.label }}</strong>
              <span class="ld-bar__badges">
                <span class="ld-bar__ev">{{ c.count }} 证据</span>
              </span>
            </div>
            <div class="ld-bar__track">
              <i :class="`ld-bar__fill is-${c.tone}`" :style="{ width: c.width + '%' }"></i>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { subPage, closeSubPage, learnerDetails, isLive } from './store'
import { liveLearners, liveGetLearnerDetail, liveGetLearnerEvidence, liveRecomputeLearner, timeAgo, errMsg } from './live'
import { evidenceDotTone, evidenceLowConfidence, evidenceSignalZh, evidenceTooltip, evidenceTypeZh } from './evidence'
import { conceptBarTone, conceptBarWidth, transferReadinessZh, misconceptionRiskZh, normalizeLearnerTab } from './learner-profile'
import type { ConceptBarTone, ConceptLedgerItem, LearnerTab } from './learner-profile'
import { toast } from '@/utils/toast'

interface Detail {
  name: string
  email: string
  joined: string
  trend: 'up' | 'down' | 'flat'
  fatigue: string
  path: string
  stage: string
  task: string
  pct: number
  concepts: { mastered: string[]; struggling: string[]; fragile: string[] }
  trend7d: number[]
  sessions: { time: string; title: string; result: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; concepts?: string[] }[]
  snapshot: { version: string; generatedAt: string }
}

interface EvidenceItem {
  title: string
  detail: string
  time: string
  score: number
  signal: string
  concepts: string[]
}

const liveDetail = ref<Detail | null>(null)
const rawDetail = ref<Record<string, unknown> | null>(null)
const liveEvidence = ref<EvidenceItem[]>([])
const recomputing = ref(false)
const tab = ref<LearnerTab>('overview')

const tabs = [
  { id: 'overview' as const, label: '总览' },
  { id: 'profile' as const, label: '画像' },
  { id: 'evidence' as const, label: '证据' }
]

/** 深链兼容：旧 6-tab 名（cognitive/dynamic/memory/teaching）重定向到新 3-tab */
function switchTab(id: string) {
  tab.value = normalizeLearnerTab(id)
}

/** 详情加载：成功全量数据；失败但有列表兜底 → 显示兜底；失败且无兜底 → 明确错误态 */
const detailError = ref(false)
/** 请求超时保护：详情接口挂起时不再无限「加载中…」，超时后走兜底/错误态 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('详情请求超时')), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

watch(
  () => [subPage.value?.id, isLive.value] as const,
  ([id, live]) => {
    void loadDetail(id, live)
  },
  { immediate: true }
)

async function loadDetail(id: string | undefined, live: boolean) {
  liveDetail.value = null
  rawDetail.value = null
  liveEvidence.value = []
  detailError.value = false
  tab.value = 'overview'
  if (!id || !live) return
  const base = liveLearners.value.find((l) => l.userId === id)
  const pathId = base?.pathId
  try {
    const raw = (await withTimeout(liveGetLearnerDetail(id, pathId), 12000)) as Record<string, unknown>
    rawDetail.value = raw
    const model = (raw.model as Record<string, unknown>) || raw
    const km = ((model.knowledgeMemory as Record<string, unknown>) || (raw.knowledgeMemory as Record<string, unknown>) || {}) as Record<string, unknown>
    const currentPath = (km.currentPath || {}) as Record<string, unknown>
    const progress = (currentPath.progress || {}) as Record<string, number>
    const globalSignals = (km.globalSignals || {}) as Record<string, unknown>
    const conceptStates = Array.isArray(currentPath.conceptStates)
      ? (currentPath.conceptStates as { label?: string; status?: string }[])
      : []
    const totalTasks = Number(progress.totalTasks || 0)
    const completedTasks = Number(progress.completedTasks || 0)
    const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    const evidenceItems = await liveGetLearnerEvidence(id, pathId).catch(() => [] as Record<string, unknown>[])
    liveEvidence.value = evidenceItems.map((e) => ({
      title: String(e.type || e.kind || '学习事件'),
      detail: String(e.signal || ''),
      time: timeAgo(String(e.happenedAt || e.createdAt || '')),
      signal: String(e.signal || ''),
      score: Number(e.score || 0),
      concepts: Array.isArray(e.conceptKeys) ? e.conceptKeys.map(String) : []
    }))
    liveDetail.value = {
      name: base?.name || String(model.userName || id),
      email: base?.email || '',
      joined: '—',
      trend: base?.trend || 'flat',
      fatigue: base?.fatigue || '低',
      path: String((currentPath.pathTitle as string) || model.pathTitle || '尚未开始学习'),
      stage: base?.currentMilestone || String(progress.totalMilestones ? `已完成 ${progress.completedMilestones ?? 0}/${progress.totalMilestones} 个里程碑` : ''),
      task: base?.currentTask || '未开始',
      pct,
      concepts: {
        mastered: (globalSignals.masteredConcepts as string[]) || [],
        struggling: base?.struggling || conceptStates.filter((c) => c.status === 'struggling').map((c) => String(c.label)),
        fragile: base?.fragile || conceptStates.filter((c) => c.status === 'fragile').map((c) => String(c.label))
      },
      trend7d: [0, 0, 0, 0, 0, 0, 0],
      sessions: liveEvidence.value.slice(0, 6).map((e) => ({
        time: e.time,
        title: e.title,
        result: evidenceSignalZh(e.signal) || e.detail || '—',
        tone: evidenceDotTone(e.signal, e.score),
        concepts: e.concepts
      })),
      snapshot: {
        version: base ? `置信 ${(base.confidence * 100).toFixed(0)}%${evidenceLowConfidence(base.confidence) ? ' · 证据不足' : ''}` : '—',
        generatedAt: timeAgo(base?.generatedAt)
      }
    }
  } catch (e) {
    if (base) {
      // 列表兜底：详情接口失败时至少展示列表里已有的信息
      liveDetail.value = {
        name: base.name,
        email: base.email,
        joined: '—',
        trend: base.trend,
        fatigue: base.fatigue,
        path: base.pathTitle || '尚未开始学习',
        stage: base.currentMilestone || '',
        task: base.currentTask || '未开始',
        pct: 0,
        concepts: { mastered: [], struggling: base.struggling, fragile: base.fragile },
        trend7d: [0, 0, 0, 0, 0, 0, 0],
        sessions: [],
        snapshot: {
          version: `置信 ${(base.confidence * 100).toFixed(0)}%${evidenceLowConfidence(base.confidence) ? ' · 证据不足' : ''}`,
          generatedAt: timeAgo(base.generatedAt)
        }
      }
      toast.error(`详情接口暂时不可用，已显示列表快照：${errMsg(e)}`)
    } else {
      detailError.value = true
    }
  }
}

async function recompute() {
  const id = subPage.value?.id
  if (!id || recomputing.value) return
  recomputing.value = true
  try {
    if (isLive.value) {
      const base = liveLearners.value.find((l) => l.userId === id)
      await liveRecomputeLearner(id, base?.pathId)
      toast.success('快照已重算（真实）')
      const prevTab = tab.value
      await loadDetail(id, true)
      tab.value = prevTab
    } else {
      await new Promise((r) => setTimeout(r, 800))
      toast.success('快照已重算')
    }
  } catch (e) {
    toast.error(`重算失败：${errMsg(e)}`)
  } finally {
    recomputing.value = false
  }
}

const d = computed<Detail | null>(() => {
  if (isLive.value) {
    if (detailError.value) return null
    return liveDetail.value || {
      name: '加载中…', email: '', joined: '', trend: 'flat', fatigue: '低',
      path: '', stage: '', task: '', pct: 0,
      concepts: { mastered: [], struggling: [], fragile: [] },
      trend7d: [0, 0, 0, 0, 0, 0, 0], sessions: [],
      snapshot: { version: '—', generatedAt: '—' }
    }
  }
  const found = learnerDetails.find((x) => x.id === subPage.value?.id)
  return found || null
})

/** demo 模式：未知 ID 一律显示「未找到」空态，严禁回退展示其他人的数据 */
const notFound = computed(() => !isLive.value && !learnerDetails.some((x) => x.id === subPage.value?.id))

/* ---------- Tab 数据推导 ---------- */
/** demo 模式的完整诊断数据（对齐真实 learner-models 结构） */
const DEMO_RAW: Record<string, unknown> = {
  profile: {
    cognitive: {
      metacognitionLevel: '中等（能说出哪里不懂，但归因常偏表面）',
      thinkingStyle: '示例驱动：先看成品再理解原理',
      confusionPattern: '把不熟悉的概念归到已知框架里，造成隐性误用',
      priorKnowledgeStructure: '办公场景经验丰富，编程概念零散',
      selfAssessmentAccuracy: '偏低（自评掌握的模块实测正确率 62%）'
    },
    preferences: { learningStyle: '做中学，容忍短视频，不耐长文档', pacePreference: '25 分钟小任务' },
    emotional: { baseline: '平稳，周五下午易焦躁', motivationDriver: '解决周报这一件事' },
    behavioral: {
      avgResponseTime: 42,
      avgMessageLength: 38,
      avgInteractionInterval: 3,
      engagementLevel: 0.82,
      consistencyScore: 0.76
    },
    learning: { ktl: 5.9, lf: 3.2, lss: 6.8, lsb: 0.71, recentProgress: 'improving', streak: 9 },
    history: {
      totalSessions: 23,
      totalMessages: 412,
      avgSessionDuration: 21,
      topicsExplored: ['Excel 自动化', '数据清洗', '周报生成'],
      conceptsStruggled: ['数据透视表', '数组公式'],
      conceptsMastered: ['单元格引用', 'SUMIF', '筛选']
    },
    curriculumControls: {
      taskGranularityLevel: 'small',
      conceptDensityLevel: 'medium',
      reviewFrequencyLevel: 'high',
      progressionStrategyNote: '先建立可复用模板，再逐步拆解原理'
    },
    derivedInsights: {
      learningVelocity: 0.62,
      optimalSessionLength: 25,
      recommendedDifficulty: 'medium',
      suggestedApproach: '示例驱动 + 小步练习',
      riskFactors: ['自评偏高导致跳练'],
      strengths: ['真实场景迁移快', '习惯复盘']
    },
    narrativeInsights: [
      '目标单一且清晰：解决周报自动化这一件事，动机强烈。',
      '办公场景经验丰富，编程概念零散，先备知识结构偏经验型。',
      '示例驱动型学习者：先看成品再理解原理，反感长文档。',
      '自评偏高，容易跳过巩固环节，需要客观反馈校准。'
    ]
  },
  dynamicState: {
    metrics: { lss: 6.8, ktl: 5.9, lf: 3.2, lsb: 0.71 },
    recentTrend: '上升',
    fatigueRisk: '低',
    confidenceTrend: '缓升',
    recentSessionQuality: '良好（近 3 次 2 次一次通过）',
    recommendedPacing: '保持当前节奏，可尝试每周加 1 次挑战任务',
    recommendedInteraction: { hintTiming: 'immediate', encouragement: 'medium', challenge: 'medium' }
  },
  learningControlState: {
    shouldAvoidNewConcepts: false,
    shouldPreferConsolidation: true,
    shouldOfferBreak: false
  },
  knowledgeMemory: {
    currentPath: {
      pathTitle: 'Excel 自动化入门',
      progress: { totalTasks: 16, completedTasks: 7, totalMilestones: 3, completedMilestones: 1, totalTasksInMilestone: 6, completedTasksInMilestone: 4 },
      conceptStates: [
        { label: '单元格引用', status: 'mastered', masteryScore: 0.92 },
        { label: 'SUMIF', status: 'mastered', masteryScore: 0.88 },
        { label: '筛选', status: 'learning', masteryScore: 0.6 },
        { label: '数据透视表', status: 'struggling', masteryScore: 0.35 },
        { label: '数组公式', status: 'fragile', masteryScore: 0.4 }
      ]
    },
    globalSignals: {
      masteredConcepts: ['单元格引用', 'SUMIF', '筛选'],
      fragileConcepts: ['数组公式'],
      strugglingConcepts: ['数据透视表']
    },
    globalBackground: {
      conceptLedger: [
        { conceptKey: 'cell-ref', label: '单元格引用', transferReadiness: 'high', misconceptionRisk: 'low', evidenceCount: 6 },
        { conceptKey: 'sumif', label: 'SUMIF', transferReadiness: 'high', misconceptionRisk: 'low', evidenceCount: 5 },
        { conceptKey: 'filter', label: '筛选', transferReadiness: 'medium', misconceptionRisk: 'medium', evidenceCount: 3 },
        { conceptKey: 'pivot', label: '数据透视表', transferReadiness: 'low', misconceptionRisk: 'high', evidenceCount: 2 },
        { conceptKey: 'array', label: '数组公式', transferReadiness: 'low', misconceptionRisk: 'medium', evidenceCount: 1 }
      ],
      recurringConfusions: [{ label: '数组公式', pattern: '近期多次出现 review / fragile 信号' }],
      reusableFoundations: ['单元格引用', 'SUMIF'],
      blockedFoundations: ['数组公式', '数据透视表']
    }
  },
  teachingHints: {
    recommendedApproach: '示例驱动 + 小步练习：每个概念先给可复用模板，再拆原理',
    promptEnhancement: '涉及表格结构时主动给出示例列名；置信度低时复述确认',
    emphasize: ['单元格引用', 'SUMIF', '筛选', '真实场景迁移'],
    avoid: ['数组公式（暂时）', '术语堆叠', '长时间纯讲解'],
    riskFactors: ['自评偏高导致跳练', '周五下午疲劳窗口', '数据透视表可能触发畏难']
  }
}

const DEMO_EVIDENCE: EvidenceItem[] = [
  { title: 'task-completed', detail: '数据清洗练习 2/3 · 掌握 +0.12', time: '6 分钟前', score: 0.92, signal: 'mastery', concepts: ['数据清洗'] },
  { title: 'teaching-session', detail: '「数据透视表」连续 2 次未达标', time: '3 天前', score: 0.86, signal: 'struggle', concepts: ['数据透视表'] },
  { title: 'summary', detail: '会话后段认知负荷偏高', time: '昨天 21:14', score: 0.7, signal: 'fatigue', concepts: [] },
  { title: 'task-completed', detail: 'SUMIF 实战 · 一次通过', time: '昨天', score: 0.95, signal: 'mastery', concepts: ['SUMIF'] },
  { title: 'evaluation', detail: '数据透视表入门 · 标记复习', time: '3 天前', score: 0.32, signal: 'incomplete', concepts: ['数据透视表'] }
]

const profile = computed(() => {
  if (!isLive.value) return DEMO_RAW.profile as Record<string, unknown>
  return (rawDetail.value?.profile || null) as Record<string, unknown> | null
})
const dynamicState = computed(() => {
  if (!isLive.value) return DEMO_RAW.dynamicState as Record<string, unknown>
  return (rawDetail.value?.dynamicState || null) as Record<string, unknown> | null
})
interface TeachingHintsShape {
  recommendedApproach?: string
  promptEnhancement?: string
  emphasize?: string[]
  avoid?: string[]
  riskFactors?: string[]
}

const teachingHints = computed(() => {
  if (!isLive.value) return DEMO_RAW.teachingHints as TeachingHintsShape
  return (rawDetail.value?.teachingHints || null) as TeachingHintsShape | null
})
const knowledgeMemory = computed(() => {
  if (!isLive.value) return DEMO_RAW.knowledgeMemory as Record<string, unknown>
  return (rawDetail.value?.knowledgeMemory || null) as Record<string, unknown> | null
})
const controlState = computed(() => {
  if (!isLive.value) return DEMO_RAW.learningControlState as Record<string, unknown>
  return (rawDetail.value?.learningControlState || null) as Record<string, unknown> | null
})
/** 证据记录：live 用接口数据，demo 用演示时间线 */
const evidence = computed(() => (isLive.value ? liveEvidence.value : DEMO_EVIDENCE))

/** 后端快照的英文枚举 → 中文（参照 LearnerCenter mapTrend/mapFatigue 模式） */
const EN_ZH: Record<string, string> = {
  high: '高', medium: '中', low: '低',
  intuitive: '直觉型', logical: '逻辑型', visual: '视觉型', practical: '实践型', mixed: '混合型',
  'concept-confusion': '概念混淆', 'application-difficulty': '应用困难', 'principle-misunderstanding': '原理误解', none: '无',
  scattered: '零散', systematic: '系统', blank: '空白',
  overconfident: '偏高', accurate: '准确', underconfident: '偏低',
  video: '视频', reading: '阅读', practice: '实践',
  'theory-first': '理论优先', 'practice-first': '实践优先', balanced: '均衡',
  short: '短', long: '长',
  easy: '简单', hard: '挑战',
  interest: '兴趣驱动', 'problem-solving': '问题驱动', 'external-pressure': '外部压力', career: '职业目标',
  confident: '自信', moderate: '适中', anxious: '焦虑',
  improving: '上升', stable: '稳定', declining: '下降',
  rising: '上升', falling: '下降',
  strong: '良好', weak: '较弱',
  slow: '放缓', fast: '加快',
  immediate: '即时', delayed: '延迟', 'on-request': '按需',
  small: '小步', large: '大步',
  true: '是', false: '否'
}
const zh = (v: unknown): string => {
  const s = String(v ?? '')
  return EN_ZH[s] ?? s
}

function kvRows(obj: Record<string, unknown> | null, labels: Record<string, string>) {
  if (!obj) return [] as { label: string; value: string }[]
  return Object.entries(labels)
    .filter(([key]) => obj[key] != null && obj[key] !== '')
    .map(([key, label]) => ({ label, value: zh(obj[key]) }))
}

const cognitiveRows = computed(() =>
  kvRows((profile.value?.cognitive || null) as Record<string, unknown> | null, {
    metacognitionLevel: '元认知水平',
    thinkingStyle: '思维风格',
    confusionPattern: '困惑模式',
    priorKnowledgeStructure: '先备知识结构',
    selfAssessmentAccuracy: '自评准确度'
  })
)

const preferenceRows = computed(() => [
  ...kvRows((profile.value?.preferences || null) as Record<string, unknown> | null, {
    preferredStyle: '偏好风格',
    theoryVsPractice: '理论 vs 实践',
    sessionLength: '单次时长',
    preferredDifficulty: '难度偏好',
    prefersHints: '是否偏好提示'
  }),
  ...kvRows((profile.value?.emotional || null) as Record<string, unknown> | null, {
    motivationTrigger: '动机触发',
    urgencyLevel: '紧迫感',
    confidenceLevel: '自信水平',
    frustrationTolerance: '挫败耐受',
    rewardSensitivity: '奖励敏感度'
  })
])

/** 画像补充展示：学习行为基线（behavioral）——运营价值：判断「节奏是否适合当前干预」 */
const behaviorRows = computed(() =>
  kvRows((profile.value?.behavioral || null) as Record<string, unknown> | null, {
    avgResponseTime: '平均响应（秒）',
    avgMessageLength: '平均消息长度（字）',
    avgInteractionInterval: '互动间隔（分钟）',
    engagementLevel: '投入度',
    consistencyScore: '一致性'
  })
)

/** 画像补充展示：互动历史（history）——运营价值：总盘子与主题分布，判断是否深耕单一主题 */
const historyRows = computed(() => {
  const h = (profile.value?.history || null) as Record<string, unknown> | null
  if (!h) return [] as { label: string; value: string }[]
  const rows = kvRows(h, {
    totalSessions: '总会话数',
    totalMessages: '总消息数',
    avgSessionDuration: '平均会话时长（分钟）'
  })
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  if (arr(h.topicsExplored).length) rows.push({ label: '探索主题', value: arr(h.topicsExplored).slice(0, 8).join('、') })
  if (arr(h.conceptsStruggled).length) rows.push({ label: '挣扎过概念', value: arr(h.conceptsStruggled).slice(0, 8).join('、') })
  if (arr(h.conceptsMastered).length) rows.push({ label: '已掌握概念', value: arr(h.conceptsMastered).slice(0, 8).join('、') })
  return rows
})

/** 画像补充展示：课程控制（curriculumControls）——运营价值：平台侧可执行的粒度/密度/复习策略 */
const curriculumRows = computed(() =>
  kvRows((profile.value?.curriculumControls || null) as Record<string, unknown> | null, {
    taskGranularityLevel: '任务粒度',
    conceptDensityLevel: '概念密度',
    reviewFrequencyLevel: '复习频率',
    progressionStrategyNote: '推进策略'
  })
)

/** 画像补充展示：派生洞察（derivedInsights）——运营价值：速度/最佳时长/建议方式直接落到干预动作 */
const derivedRows = computed(() => {
  const dv = (profile.value?.derivedInsights || null) as Record<string, unknown> | null
  if (!dv) return [] as { label: string; value: string }[]
  const rows = kvRows(dv, {
    learningVelocity: '学习速度',
    optimalSessionLength: '最佳单次时长（分钟）',
    recommendedDifficulty: '推荐难度',
    suggestedApproach: '建议方式'
  })
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  if (arr(dv.strengths).length) rows.push({ label: '优势', value: arr(dv.strengths).slice(0, 5).join('、') })
  if (arr(dv.riskFactors).length) rows.push({ label: '风险因素', value: arr(dv.riskFactors).slice(0, 5).join('、') })
  return rows
})

const narrativeInsights = computed(() => {
  const n = profile.value?.narrativeInsights
  if (!n) return [] as string[]
  if (Array.isArray(n)) return n.map(String)
  return Object.values(n as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v.map(String) : [String(v)])).slice(0, 6)
})

const metricCards = computed(() => {
  const m = (dynamicState.value?.metrics || {}) as Record<string, number>
  const fmt = (v?: number) => (v == null ? '—' : v.toFixed(1))
  const tone = (v?: number) => (v == null ? '' : v >= 7 ? 'is-good' : v <= 4 ? 'is-bad' : '')
  return [
    { label: 'LSS 学习状态', value: fmt(m.lss), hint: '整体学习健康度', cls: tone(m.lss) },
    { label: 'KTL 知识轨迹', value: fmt(m.ktl), hint: '知识增长曲线', cls: tone(m.ktl) },
    { label: 'LF 学习疲劳', value: fmt(m.lf), hint: '越低越好', cls: m.lf != null && m.lf >= 6 ? 'is-bad' : '' },
    { label: 'LSB 行为稳定', value: fmt(m.lsb), hint: '行为一致性', cls: tone(m.lsb) }
  ]
})

const dynamicRows = computed(() => {
  /* recommendedInteraction 是 {hintTiming, encouragement, challenge} 对象，拆三项展示 */
  const ri = dynamicState.value?.recommendedInteraction
  const riRows: { label: string; value: string }[] = []
  if (ri != null) {
    const o = ri as Record<string, unknown>
    if (typeof o === 'string') {
      riRows.push({ label: '建议互动', value: zh(o) })
    } else {
      if (o.hintTiming != null && o.hintTiming !== '') riRows.push({ label: '提示时机', value: zh(o.hintTiming) })
      if (o.encouragement != null && o.encouragement !== '') riRows.push({ label: '鼓励方式', value: zh(o.encouragement) })
      if (o.challenge != null && o.challenge !== '') riRows.push({ label: '挑战设计', value: zh(o.challenge) })
    }
  }
  return [
    ...kvRows(dynamicState.value, {
      recentTrend: '近期趋势',
      fatigueRisk: '疲劳风险',
      confidenceTrend: '置信趋势',
      recentSessionQuality: '近期会话质量'
    }),
    ...kvRows(dynamicState.value, {
      recommendedPacing: '建议节奏'
    }),
    ...riRows
  ]
})

const controlFlags = computed(() => {
  const c = controlState.value
  if (!c) return [] as { text: string; on: boolean }[]
  return [
    { text: '避免新概念', on: !!c.shouldAvoidNewConcepts },
    { text: '优先巩固', on: !!c.shouldPreferConsolidation },
    { text: '建议休息', on: !!c.shouldOfferBreak }
  ]
})

/** 全局信号与背景摘要（globalBackground 对象不做全量 JSON 倾倒，出摘要 + 可复用/被阻塞 chip 区） */
const memoryRows = computed(() => {
  const km = knowledgeMemory.value
  if (!km) return [] as { label: string; value: string }[]
  const rows: { label: string; value: string }[] = []
  const gs = km.globalSignals
  if (gs != null) {
    if (typeof gs === 'string') {
      rows.push({ label: '全局信号', value: gs })
    } else {
      const o = gs as Record<string, unknown>
      const arr = (v: unknown) => (Array.isArray(v) ? v.length : 0)
      rows.push({ label: '全局信号', value: `已掌握 ${arr(o.masteredConcepts)} · 挣扎 ${arr(o.strugglingConcepts)} · 脆弱 ${arr(o.fragileConcepts)}` })
    }
  }
  const gb = km.globalBackground
  if (gb != null && typeof gb !== 'string') {
    const o = gb as Record<string, unknown>
    const ledgerCount = Array.isArray(o.conceptLedger) ? o.conceptLedger.length : 0
    const confusionCount = Array.isArray(o.recurringConfusions) ? o.recurringConfusions.length : 0
    rows.push({
      label: '全局背景',
      value: `概念账本 ${ledgerCount} 项 · 反复困惑 ${confusionCount} 项 · 可复用基础 ${Array.isArray(o.reusableFoundations) ? o.reusableFoundations.length : 0} · 被阻塞基础 ${Array.isArray(o.blockedFoundations) ? o.blockedFoundations.length : 0}`
    })
  }
  return rows
})

const foundations = computed<{ reusable: string[]; blocked: string[] }>(() => {
  const gb = (knowledgeMemory.value as Record<string, unknown> | null)?.globalBackground
  if (!gb || typeof gb !== 'object') return { reusable: [], blocked: [] }
  const o = gb as Record<string, unknown>
  return {
    reusable: Array.isArray(o.reusableFoundations) ? o.reusableFoundations.map(String) : [],
    blocked: Array.isArray(o.blockedFoundations) ? o.blockedFoundations.map(String) : []
  }
})

/* ---------- 概念掌握图形化（conceptLedger 单源，旧快照回退三组列表） ---------- */
interface ConceptBar {
  label: string
  tone: ConceptBarTone
  width: number
  readiness: string
  risk: string
  riskTone: 'ok' | 'warn' | 'bad'
  evidenceCount: number
}

const conceptBars = computed<ConceptBar[]>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const ledger = (km?.globalBackground as Record<string, unknown> | undefined)?.conceptLedger
  if (Array.isArray(ledger) && ledger.length) {
    return (ledger as ConceptLedgerItem[])
      .map((item) => ({
        label: String(item.label || item.conceptKey || '未命名概念'),
        tone: conceptBarTone(item),
        width: conceptBarWidth(item.transferReadiness),
        readiness: transferReadinessZh(item.transferReadiness),
        risk: misconceptionRiskZh(item.misconceptionRisk),
        riskTone: (String(item.misconceptionRisk || '').toLowerCase() === 'high' ? 'bad' : String(item.misconceptionRisk || '').toLowerCase() === 'medium' ? 'warn' : 'ok') as ConceptBar['riskTone'],
        evidenceCount: Number(item.evidenceCount || 0)
      }))
      .slice(0, 24)
  }
  // 旧快照回退：无 ledger 时按 mastered/struggling/fragile 三组构建
  const c = d.value?.concepts
  if (!c) return []
  const fallback: ConceptBar[] = []
  for (const label of c.mastered) fallback.push({ label, tone: 'ok', width: 90, readiness: '可迁移', risk: '低', riskTone: 'ok', evidenceCount: 0 })
  for (const label of c.fragile) fallback.push({ label, tone: 'warn', width: 55, readiness: '待巩固', risk: '中', riskTone: 'warn', evidenceCount: 0 })
  for (const label of c.struggling) fallback.push({ label, tone: 'bad', width: 25, readiness: '不宜迁移', risk: '高', riskTone: 'bad', evidenceCount: 0 })
  return fallback
})

/** 证据页「概念证据密度」：优先 ledger（evidenceCount），回退 conceptStates（masteryScore 归一化） */
const conceptStats = computed<{ label: string; count: number; tone: ConceptBarTone; width: number }[]>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const ledger = (km?.globalBackground as Record<string, unknown> | undefined)?.conceptLedger
  if (Array.isArray(ledger) && ledger.length) {
    const max = Math.max(1, ...(ledger as ConceptLedgerItem[]).map((i) => Number(i.evidenceCount || 0)))
    return (ledger as ConceptLedgerItem[])
      .map((item) => ({
        label: String(item.label || item.conceptKey || '未命名概念'),
        count: Number(item.evidenceCount || 0),
        tone: conceptBarTone(item),
        width: Math.max(8, Math.round((Number(item.evidenceCount || 0) / max) * 100))
      }))
      .slice(0, 16)
  }
  const states = (km?.currentPath as Record<string, unknown> | undefined)?.conceptStates
  if (Array.isArray(states) && states.length) {
    const max = Math.max(1, ...(states as { masteryScore?: number }[]).map((s) => Number(s.masteryScore || 0) * 100))
    return (states as { label?: string; masteryScore?: number }[])
      .map((s) => ({
        label: String(s.label || '未命名概念'),
        count: Math.round(Number(s.masteryScore || 0) * 100),
        tone: 'muted' as ConceptBarTone,
        width: Math.max(8, Math.round((Number(s.masteryScore || 0) * 100 / max) * 100))
      }))
      .slice(0, 16)
  }
  return []
})

const milestoneTasks = computed<{ done: number; total: number } | null>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const p = (km?.currentPath as Record<string, unknown> | undefined)?.progress as Record<string, unknown> | undefined
  const total = Number(p?.totalTasksInMilestone || 0)
  const done = Number(p?.completedTasksInMilestone ?? 0)
  return total > 0 ? { done, total } : null
})

const riskFactors = computed(() => (teachingHints.value?.riskFactors || []) as string[])

const trendText = computed(() => (d.value?.trend === 'up' ? '↗ 上升' : d.value?.trend === 'down' ? '↘ 下降' : '→ 稳定'))
const trendBadge = computed(() => (d.value?.trend === 'up' ? 'mk-badge--ok' : d.value?.trend === 'down' ? 'mk-badge--bad' : 'mk-badge--muted'))
const fatigueBadge = computed(() => (d.value?.fatigue === '高' ? 'mk-badge--bad' : d.value?.fatigue === '中' ? 'mk-badge--warn' : 'mk-badge--ok'))
/** 低置信不渲染成风险色：中性→琥珀「证据不足」提示（与 LearnerCenter 同阈值，见 evidence.ts） */
const snapshotBadge = computed(() => {
  const v = d.value?.snapshot.version || ''
  return v.includes('证据不足') ? 'mk-badge--warn' : 'mk-badge--muted'
})
const snapshotHint = computed(() => {
  const v = d.value?.snapshot.version || ''
  return v.includes('证据不足') ? '快照置信度低于 50%，证据不足，建议重算' : '快照置信度'
})
const trendHint = computed(() => (d.value?.trend === 'down' ? '连续走低，建议介入' : d.value?.trend === 'up' ? '稳步上升' : '平稳'))

function barToneBadge(tone: ConceptBarTone): string {
  return tone === 'ok' ? 'mk-badge--ok' : tone === 'warn' ? 'mk-badge--warn' : tone === 'bad' ? 'mk-badge--bad' : 'mk-badge--muted'
}
</script>

<style scoped>
.ld { gap: 16px; }
.ld-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: 6px;
  width: fit-content;
  transition: background 0.14s ease, transform 0.1s ease;
}
.ld-back:hover { background: #eff6ff; }
.ld-back:active { transform: translateY(1px); }
.ld-head { display: grid; gap: 12px; }
.ld-id {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.ld-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--mk-blue, #2c63d0), var(--mk-purple));
  color: #fff;
  display: grid;
  place-content: center;
  font-size: 18px;
  font-weight: 700;
}
.ld-id h3,
.ld-name { margin: 0; font-size: 18px; line-height: 1.4; }
.ld-sub { color: var(--mk-faint); font-size: 12px; }
.ld-badges { display: flex; gap: 8px; flex-wrap: wrap; }

.ld-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.ld-tabpage { display: grid; gap: 14px; align-content: start; }
.ld-none { margin: 0; padding: 18px 16px; color: var(--mk-faint); font-size: 12.5px; }
.ld-none__hint { display: block; margin-top: 4px; font-size: 11.5px; opacity: 0.9; }

.ld-grid {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 14px;
  align-items: start;
}
.ld-col { display: grid; gap: 14px; }

.ld-progress { padding: 16px; display: grid; gap: 8px; }
.ld-progress strong { font-size: 15px; }
.ld-progress__stage { color: var(--mk-muted); font-size: 12.5px; }
.ld-progress__bar {
  height: 8px;
  border-radius: 4px;
  background: #eef2fa;
  overflow: hidden;
  margin: 4px 0;
}
.ld-progress__bar i { display: block; height: 100%; background: linear-gradient(90deg, #6aa0ff, var(--mk-blue, #2c63d0)); }
.ld-progress__task { margin: 0; font-size: 12.5px; color: var(--mk-muted); }

.ld-concepts { padding: 16px; display: grid; gap: 14px; }
.ld-concept-group { display: grid; gap: 7px; }
.ld-concept-label { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
.ld-concept-label--ok { color: var(--mk-green); }
.ld-concept-label--warn { color: var(--mk-amber); }
.ld-concept-label--bad { color: var(--mk-red); }
.ld-concept-list { display: flex; gap: 6px; flex-wrap: wrap; }
.ld-concept {
  padding: 3px 10px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
}
.ld-concept--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.ld-concept--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.ld-concept--bad { background: var(--mk-red-bg); color: var(--mk-red); }

/* 概念掌握条（conceptLedger 图形化） */
.ld-bars { padding: 14px 16px 16px; display: grid; gap: 12px; }
.ld-bars--dense { padding-top: 12px; }
.ld-bar { display: grid; gap: 5px; }
.ld-bar__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.ld-bar__head strong { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-bar__badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.ld-bar__risk { font-size: 10.5px; font-weight: 700; }
.ld-bar__risk--ok { color: var(--mk-green); }
.ld-bar__risk--warn { color: var(--mk-amber); }
.ld-bar__risk--bad { color: var(--mk-red); }
.ld-bar__ev {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-muted);
  background: #eef2fa;
  border-radius: 6px;
  padding: 1px 6px;
  cursor: help;
}
.ld-bar__track {
  height: 7px;
  border-radius: 4px;
  background: #eef2fa;
  overflow: hidden;
}
.ld-bar__fill { display: block; height: 100%; border-radius: 4px; min-width: 3px; }
.ld-bar__fill.is-ok { background: linear-gradient(90deg, #86efac, #22c55e); }
.ld-bar__fill.is-warn { background: linear-gradient(90deg, #fcd34d, #f59e0b); }
.ld-bar__fill.is-bad { background: linear-gradient(90deg, #fca5a5, #dc2626); }
.ld-bar__fill.is-muted { background: linear-gradient(90deg, #d1d5db, #9ca3af); }

.ld-trend {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 90px;
  padding: 16px;
}
.ld-trend__bar {
  flex: 1;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(180deg, #6aa0ff, #3d7cff);
  min-height: 6px;
}
.ld-trend__bar--down { background: linear-gradient(180deg, #fca5a5, #dc2626); }

.ld-sessions { display: grid; }
.ld-session {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.ld-session:last-child { border-bottom: none; }
.ld-session__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ld-session__dot.is-ok { background: var(--mk-green); }
.ld-session__dot.is-warn { background: var(--mk-amber); }
.ld-session__dot.is-bad { background: var(--mk-red); }
.ld-session__dot.is-muted { background: var(--mk-muted); }
.ld-session__main { flex: 1; display: grid; min-width: 0; }
.ld-session__main strong { font-size: 13px; }
.ld-session__main span { font-size: 11.5px; color: var(--mk-faint); }
.ld-session__time { font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; }

/* 建议行动卡 */
.ld-actions { padding: 14px 16px; display: grid; gap: 9px; }
.ld-actions p { margin: 0; font-size: 12.5px; color: var(--mk-muted); line-height: 1.7; }
.ld-actions__k {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 7px;
  border-radius: 6px;
  background: #eff6ff;
  color: var(--mk-blue);
  font-size: 10.5px;
  font-weight: 700;
}
.ld-actions__k--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.ld-actions .mk-status__action { justify-self: start; }

/* 概念 chip（会话/证据行内） */
.ld-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.ld-chip {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--mk-faint);
  background: #f4f6fa;
  border-radius: 5px;
  padding: 0 6px;
}

/* 可复用/被阻塞基础 */
.ld-found { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 14px 16px; }
.ld-found > div { display: grid; gap: 7px; align-content: start; }

/* Tab 通用 */
.ld-kv { display: grid; }
.ld-kv__row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12.5px;
}
.ld-kv__row:last-child { border-bottom: none; }
.ld-kv__row span { color: var(--mk-faint); }
.ld-kv__row strong { font-weight: 600; white-space: pre-wrap; }

.ld-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.ld-metric {
  display: grid;
  gap: 3px;
  padding: 13px 16px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
}
.ld-metric span { font-size: 11.5px; color: var(--mk-muted); font-weight: 600; }
.ld-metric strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.ld-metric strong.is-good { color: var(--mk-green); }
.ld-metric strong.is-bad { color: var(--mk-red); }
.ld-metric em { font-style: normal; font-size: 11px; color: var(--mk-faint); }

.ld-flags { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 16px; }
.ld-insights { padding: 12px 16px; display: grid; gap: 8px; }
.ld-insights p { margin: 0; font-size: 12.5px; color: var(--mk-muted); line-height: 1.7; }
.ld-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 14px 16px; }
.ld-two > div { display: grid; gap: 7px; align-content: start; }

.ld-evidence { display: grid; }
.ld-ev {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.ld-ev:last-child { border-bottom: none; }
.ld-ev__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ld-ev__dot.is-ok { background: var(--mk-green); }
.ld-ev__dot.is-warn { background: var(--mk-amber); }
.ld-ev__dot.is-bad { background: var(--mk-red); }
.ld-ev__dot.is-muted { background: var(--mk-muted); }
.ld-ev__lack {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-amber);
  background: var(--mk-amber-bg);
  border-radius: 6px;
  padding: 1px 6px;
}
.ld-ev__main { flex: 1; display: grid; min-width: 0; }
.ld-ev__main strong { font-size: 12.5px; }
.ld-ev__main span { font-size: 11.5px; color: var(--mk-faint); }
.ld-ev__time { font-size: 11px; color: var(--mk-faint); white-space: nowrap; }

@media (max-width: 1100px) {
  .ld-grid { grid-template-columns: 1fr; }
  .ld-metrics { grid-template-columns: repeat(2, 1fr); }
  .ld-two { grid-template-columns: 1fr; }
  .ld-found { grid-template-columns: 1fr; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .ld-back { font-size: 14.5px; }
  .ld-avatar { width: 54px; height: 54px; font-size: 21px; }
  .ld-id h3, .ld-name { font-size: 21px; }
  .ld-sub { font-size: 14px; }
  .ld-none { font-size: 14.5px; }
  .ld-progress strong { font-size: 17.5px; }
  .ld-progress__stage, .ld-progress__task { font-size: 14.5px; }
  .ld-concept-label { font-size: 13px; }
  .ld-concept { font-size: 14px; }
  .ld-bar__head strong { font-size: 14.5px; }
  .ld-bar__risk, .ld-bar__ev { font-size: 12px; }
  .ld-bar__track { height: 8px; }
  .ld-actions p { font-size: 14.5px; }
  .ld-actions__k { font-size: 12px; }
  .ld-chip { font-size: 12px; }
  .ld-session__main strong { font-size: 15px; }
  .ld-session__main span, .ld-session__time { font-size: 13.5px; }
  .ld-kv__row { font-size: 14.5px; }
  .ld-metric span { font-size: 13.5px; }
  .ld-metric strong { font-size: 26px; }
  .ld-metric em { font-size: 13px; }
  .ld-insights p { font-size: 14.5px; }
  .ld-ev__main strong { font-size: 14.5px; }
  .ld-ev__main span { font-size: 13.5px; }
  .ld-ev__time { font-size: 13px; }
  .ld-none { padding: 21px 19px; }
  .ld-none__hint { font-size: 13.5px; }
  .ld-progress { padding: 18px; gap: 9px; }
  .ld-progress__bar { height: 9px; }
  .ld-concepts { padding: 18px; }
  .ld-concept { padding: 4px 12px; }
  .ld-bars { padding: 16px 18px 18px; }
  .ld-actions { padding: 16px 18px; }
  .ld-found { padding: 16px 18px; }
  .ld-trend { height: 104px; padding: 18px; }
  .ld-session { padding: 13px 18px; gap: 14px; }
  .ld-session__dot { width: 9px; height: 9px; }
  .ld-kv__row { grid-template-columns: 160px 1fr; gap: 14px; padding: 12px 18px; }
  .ld-metrics { gap: 14px; }
  .ld-metric { padding: 15px 18px; }
  .ld-flags { padding: 16px 18px; }
  .ld-insights { padding: 14px 18px; }
  .ld-two { padding: 16px 18px; }
  .ld-ev { padding: 12px 18px; gap: 14px; }
  .ld-ev__dot { width: 9px; height: 9px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000 档的基础上再升一档，对齐 mk 体系 2800（17px 级） */
  .ld-back { font-size: 17px; }
  .ld-avatar { width: 62px; height: 62px; font-size: 24px; }
  .ld-id h3, .ld-name { font-size: 24.5px; }
  .ld-sub { font-size: 16.5px; }
  .ld-none { font-size: 17px; }
  .ld-progress strong { font-size: 20.5px; }
  .ld-progress__stage, .ld-progress__task { font-size: 17px; }
  .ld-concept-label { font-size: 15px; }
  .ld-concept { font-size: 16.5px; }
  .ld-bar__head strong { font-size: 17px; }
  .ld-bar__risk, .ld-bar__ev { font-size: 14px; }
  .ld-bar__track { height: 10px; }
  .ld-actions p { font-size: 17px; }
  .ld-actions__k { font-size: 14px; }
  .ld-chip { font-size: 14px; }
  .ld-session__main strong { font-size: 17.5px; }
  .ld-session__main span, .ld-session__time { font-size: 16px; }
  .ld-kv__row { font-size: 17px; }
  .ld-metric span { font-size: 16px; }
  .ld-metric strong { font-size: 30px; }
  .ld-metric em { font-size: 15.5px; }
  .ld-insights p { font-size: 17px; }
  .ld-ev__main strong { font-size: 17px; }
  .ld-ev__main span { font-size: 16px; }
  .ld-ev__time { font-size: 15px; }
  .ld-none { padding: 25px 22px; }
  .ld-none__hint { font-size: 16px; }
  .ld-progress { padding: 21px; gap: 10px; }
  .ld-progress__bar { height: 11px; }
  .ld-concepts { padding: 21px; }
  .ld-concept { padding: 4px 14px; }
  .ld-bars { padding: 19px 21px 21px; }
  .ld-actions { padding: 19px 21px; }
  .ld-found { padding: 19px 21px; }
  .ld-trend { height: 122px; padding: 21px; }
  .ld-session { padding: 15px 21px; gap: 16px; }
  .ld-session__dot { width: 11px; height: 11px; }
  .ld-kv__row { grid-template-columns: 184px 1fr; gap: 16px; padding: 14px 21px; }
  .ld-metrics { gap: 16px; }
  .ld-metric { padding: 17px 21px; }
  .ld-flags { padding: 19px 21px; }
  .ld-insights { padding: 16px 21px; }
  .ld-two { padding: 19px 21px; }
  .ld-ev { padding: 14px 21px; gap: 16px; }
  .ld-ev__dot { width: 11px; height: 11px; }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .ld-back { font-size: 20px; }
  .ld-avatar { width: 72px; height: 72px; font-size: 28px; }
  .ld-id h3, .ld-name { font-size: 28.5px; }
  .ld-sub { font-size: 19px; }
  .ld-none { font-size: 20px; }
  .ld-progress strong { font-size: 24px; }
  .ld-progress__stage, .ld-progress__task { font-size: 20px; }
  .ld-concept-label { font-size: 17.5px; }
  .ld-concept { font-size: 19px; }
  .ld-bar__head strong { font-size: 20px; }
  .ld-bar__risk, .ld-bar__ev { font-size: 16.5px; }
  .ld-bar__track { height: 12px; }
  .ld-actions p { font-size: 20px; }
  .ld-actions__k { font-size: 16.5px; }
  .ld-chip { font-size: 16.5px; }
  .ld-session__main strong { font-size: 20.5px; }
  .ld-session__main span, .ld-session__time { font-size: 18.5px; }
  .ld-kv__row { font-size: 20px; }
  .ld-metric span { font-size: 18.5px; }
  .ld-metric strong { font-size: 35px; }
  .ld-metric em { font-size: 18px; }
  .ld-insights p { font-size: 20px; }
  .ld-ev__main strong { font-size: 20px; }
  .ld-ev__main span { font-size: 18.5px; }
  .ld-ev__time { font-size: 17.5px; }
  .ld-none { padding: 29px 26px; }
  .ld-none__hint { font-size: 18.5px; }
  .ld-progress { padding: 25px; gap: 12px; }
  .ld-progress__bar { height: 13px; }
  .ld-concepts { padding: 25px; }
  .ld-concept { padding: 5px 16px; }
  .ld-bars { padding: 22px 25px 25px; }
  .ld-actions { padding: 22px 25px; }
  .ld-found { padding: 22px 25px; }
  .ld-trend { height: 143px; padding: 25px; }
  .ld-session { padding: 17px 25px; gap: 19px; }
  .ld-session__dot { width: 13px; height: 13px; }
  .ld-kv__row { grid-template-columns: 216px 1fr; gap: 19px; padding: 16px 25px; }
  .ld-metrics { gap: 19px; }
  .ld-metric { padding: 20px 25px; }
  .ld-flags { padding: 22px 25px; }
  .ld-insights { padding: 19px 25px; }
  .ld-two { padding: 22px 25px; }
  .ld-ev { padding: 16px 25px; gap: 19px; }
  .ld-ev__dot { width: 13px; height: 13px; }
}
</style>
