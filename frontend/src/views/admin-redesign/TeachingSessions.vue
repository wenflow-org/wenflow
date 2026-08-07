<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">会话 {{ rows.length }}</span>
      <span class="mk-status__meta">进行中 {{ inProgressCount }}</span>
      <span class="mk-status__meta">有建议 {{ advisoryCount }}</span>
      <span class="mk-status__meta">缺总结 {{ missingWrapupCount }}</span>
    </div>

    <div class="mk-card">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in pills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': pill === p.id }"
              @click="pill = p.id"
            >
              {{ p.label }}
            </button>
          </div>
          <select v-model="statusFilter" class="mk-filter__select" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索主题 / 用户 / ID" />
        </div>
        <span class="mk-card__meta">{{ filtered.length }} / {{ rows.length }}</span>
      </div>

      <div class="mk-table-scroll">
        <table v-if="filtered.length" class="mk-table">
          <thead>
            <tr>
              <th>会话</th>
              <th>用户</th>
              <th>状态</th>
              <th>互动</th>
              <th>产物</th>
              <th>关注</th>
              <th style="text-align:right">详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id" class="ts-row" @click="openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.topic }}</strong>
                  <span class="mk-cell-sub">{{ r.subject }} · {{ taskTypeText(r.taskType) }}</span>
                </div>
              </td>
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.userName }}</strong>
                  <span class="mk-cell-sub">{{ r.email }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusText(r.status) }}</span></td>
              <td class="mk-num">{{ r.duration ? fmtDuration(r.duration) : '—' }} · {{ r.messageCount }} 条</td>
              <td>
                <span class="mk-badge" :class="r.wrapupStatus === 'complete' ? 'mk-badge--ok' : 'mk-badge--muted'">
                  {{ r.wrapupStatus === 'complete' ? '有总结' : '缺总结' }}
                </span>
                <span v-if="r.hasAdvisory" class="mk-badge mk-badge--info" style="margin-left:4px">建议</span>
              </td>
              <td><span class="mk-badge" :class="attentionBadge(r.attention)">{{ r.attention === 'high' ? '高' : r.attention === 'medium' ? '中' : '低' }}</span></td>
              <td style="text-align:right"><span class="ts-go">→</span></td>
            </tr>
          </tbody>
        </table>

        <div v-else class="mk-empty">
          <strong>{{ rows.length ? '当前筛选无会话' : '还没有教学会话' }}</strong>
          <span>{{ rows.length ? '放宽筛选条件。' : '真实学习者开始上课后出现在这里。' }}</span>
        </div>
      </div>
    </div>

    <!-- 详情抽屉 -->
    <Teleport to="body">
      <div v-if="detail" ref="maskRef" class="ts-mask">
        <aside ref="panelRef" class="ts-panel" role="dialog" aria-label="会话详情">
          <header class="ts-panel__head">
            <div class="ts-panel__title">
              <span class="mk-badge" :class="attentionBadge(detail.attention)">
                {{ detail.attention === 'high' ? '高关注' : detail.attention === 'medium' ? '中关注' : '低关注' }}
              </span>
              <h3>{{ detail.topic }}</h3>
              <span class="ts-panel__id">{{ detail.id }}</span>
            </div>
            <button type="button" class="ts-panel__close" aria-label="关闭" @click="detail = null">✕</button>
          </header>

          <div class="ts-panel__body">
            <div class="ts-facts">
              <div><span>用户</span><strong>{{ detail.userName }}</strong></div>
              <div><span>学科</span><strong>{{ detail.subject }}</strong></div>
              <div><span>状态</span><strong>{{ statusText(detail.status) }}</strong></div>
              <div><span>开始</span><strong>{{ detail.startAt }}</strong></div>
              <div><span>时长</span><strong>{{ detail.duration ? fmtDuration(detail.duration) : '—' }}</strong></div>
              <div><span>消息</span><strong>{{ detail.messageCount }}</strong></div>
            </div>

            <section v-if="detail.wrapup" class="ts-section">
              <h4>会话总结 <span class="ts-src">来源：{{ detail.wrapupSource }}</span></h4>
              <div class="ts-card" v-if="detail.wrapup.topicSummary">
                <span>主题摘要</span>
                <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('topic') }">{{ detail.wrapup.topicSummary }}</p>
                <button v-if="isLong(detail.wrapup.topicSummary)" type="button" class="ts-more" @click="toggleCard('topic')">{{ openCards.has('topic') ? '收起' : '展开全文' }}</button>
              </div>
              <div class="ts-card" v-if="detail.wrapup.knowledgeSummary">
                <span>知识总结</span>
                <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('knowledge') }">{{ detail.wrapup.knowledgeSummary }}</p>
                <button v-if="isLong(detail.wrapup.knowledgeSummary)" type="button" class="ts-more" @click="toggleCard('knowledge')">{{ openCards.has('knowledge') ? '收起' : '展开全文' }}</button>
              </div>
              <div class="ts-card" v-if="detail.wrapup.practiceAdvice">
                <span>练习建议</span>
                <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('practice') }">{{ detail.wrapup.practiceAdvice }}</p>
                <button v-if="isLong(detail.wrapup.practiceAdvice)" type="button" class="ts-more" @click="toggleCard('practice')">{{ openCards.has('practice') ? '收起' : '展开全文' }}</button>
              </div>
              <div class="ts-card" v-if="detail.wrapup.learningEvaluation">
                <span>学习评估</span>
                <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('evaluation') }">{{ detail.wrapup.learningEvaluation }}</p>
                <button v-if="isLong(detail.wrapup.learningEvaluation)" type="button" class="ts-more" @click="toggleCard('evaluation')">{{ openCards.has('evaluation') ? '收起' : '展开全文' }}</button>
              </div>
            </section>

            <section v-if="detail.advisory" class="ts-section">
              <h4>额外建议</h4>
              <div class="ts-card ts-card--advisory">
                <span>优先级 {{ detail.advisory.priority || '—' }}</span>
                <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('advisory') }">{{ detail.advisory.text || detail.advisory.body || detail.advisory }}</p>
                <button v-if="isLong(String(detail.advisory.text || detail.advisory.body || detail.advisory))" type="button" class="ts-more" @click="toggleCard('advisory')">{{ openCards.has('advisory') ? '收起' : '展开全文' }}</button>
              </div>
            </section>

            <details class="ts-section ts-raw">
              <summary>原始数据</summary>
              <pre class="ts-json">{{ detail.rawJson }}</pre>
            </details>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dataSource } from './store'
import { timeAgo } from './live'
import { statusText } from './statusText'
import { useOverlay, useMaskClose } from './useOverlay'
import { adminTeachingSessionsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'

defineProps<{ state: string }>()

interface WrapupSummary {
  topicSummary?: string
  knowledgeSummary?: string
  practiceAdvice?: string
  learningEvaluation?: string
}

interface Row {
  id: string
  topic: string
  subject: string
  taskType: string
  userName: string
  email: string
  status: string
  duration: number
  messageCount: number
  wrapupStatus: string
  hasAdvisory: boolean
  attention: 'high' | 'medium' | 'low'
  startAt: string
  wrapup: WrapupSummary | null
  wrapupSource: string
  advisory: Record<string, unknown> | null
  rawJson: string
}

/* ---------- demo 数据 ---------- */
const demoRows: Row[] = [
  {
    id: 'ts-demo-1', topic: '数据清洗练习：缺失值处理', subject: 'Excel 自动化', taskType: 'practice',
    userName: '陈晓', email: 'chenxiao@…', status: 'completed', duration: 1840, messageCount: 12,
    wrapupStatus: 'complete', hasAdvisory: true, attention: 'low', startAt: '32 分钟前',
    wrapup: {
      topicSummary: '围绕缺失值识别与填充策略展开，从 ISBLANK 判断到 IF 嵌套填充，最后落到真实周报的清洗演练。',
      knowledgeSummary: '掌握了 ISBLANK 与 IF 组合判断；理解缺失值填充要先看分布再定策略，均值填充不是万能的。',
      practiceAdvice: '建议完成一次真实表格的缺失值清洗：先统计每列缺失率，再分别给出填充或删除的理由。',
      learningEvaluation: '理解到位，练习一次通过，可以进入下一阶段「数据透视」。'
    },
    wrapupSource: '模型生成', advisory: { priority: 'medium', text: '可安排一次真实数据练习巩固：用她自己团队的周报（脱敏后）做一次完整清洗，强化迁移。' },
    rawJson: '{\n  "demo": true\n}'
  },
  {
    id: 'ts-demo-2', topic: 'JOIN 实战 3/4', subject: 'SQL 基础', taskType: 'practice',
    userName: '赵敏', email: 'zhaomin@…', status: 'error', duration: 620, messageCount: 4,
    wrapupStatus: 'missing', hasAdvisory: true, attention: 'high', startAt: '4 分钟前',
    wrapup: null, wrapupSource: '—', advisory: { priority: 'high', text: '连续 3 次任务失败且本次会话异常中断：建议伴学介入，把 JOIN 去重拆成「先 DISTINCT 再 JOIN」两步，并临时降低练习难度。' },
    rawJson: '{\n  "demo": true\n}'
  },
  {
    id: 'ts-demo-3', topic: '提问训练：把模糊问题拆成假设', subject: '数据分析思维', taskType: 'acquire',
    userName: '刘一帆', email: 'liu**@…', status: 'completed', duration: 1500, messageCount: 9,
    wrapupStatus: 'complete', hasAdvisory: true, attention: 'medium', startAt: '22 分钟前',
    wrapup: {
      topicSummary: '练习把「为什么转化率低」拆成可验证的子假设。',
      knowledgeSummary: '能列出 3 个候选假设，但对「采样偏差」的理解还停留在定义层面。',
      practiceAdvice: '用一个真实运营场景，写出假设并标注每个假设需要的证据。',
      learningEvaluation: '框架已有，概念「采样偏差」挣扎，建议安排一次专项复盘。'
    },
    wrapupSource: '模型生成', advisory: { priority: 'medium', text: '概念「采样偏差」连续两次未达标，建议下节课前插入 5 分钟图例复盘。' },
    rawJson: '{\n  "demo": true\n}'
  },
  {
    id: 'ts-demo-4', topic: '函数练习 2/5：参数与返回值', subject: 'Python 入门', taskType: 'practice',
    userName: '孙可', email: 'sunke@…', status: 'completed', duration: 2100, messageCount: 15,
    wrapupStatus: 'complete', hasAdvisory: false, attention: 'low', startAt: '2 小时前',
    wrapup: {
      topicSummary: '默认参数与返回值的基础训练。',
      knowledgeSummary: '默认参数掌握；对「作用域」仍有混淆，把全局变量当返回值用。',
      practiceAdvice: '完成 3 道纯函数改写练习。',
      learningEvaluation: '通过但用时偏长，建议下一课前做 5 分钟热身。'
    },
    wrapupSource: '规则回退', advisory: null,
    rawJson: '{\n  "demo": true\n}'
  },
  {
    id: 'ts-demo-5', topic: '邮件表达：开场与诉求句', subject: '职场英语', taskType: 'reading',
    userName: '周洁', email: 'zhoujie@…', status: 'in_progress', duration: 480, messageCount: 3,
    wrapupStatus: 'missing', hasAdvisory: false, attention: 'low', startAt: '18 分钟前',
    wrapup: null, wrapupSource: '—', advisory: null,
    rawJson: '{\n  "demo": true\n}'
  },
  {
    id: 'ts-demo-6', topic: '五十音图：か行・さ行', subject: '日语 N5', taskType: 'quiz',
    userName: '冯远', email: 'fengyuan@…', status: 'timeout', duration: 360, messageCount: 2,
    wrapupStatus: 'missing', hasAdvisory: true, attention: 'high', startAt: '1 小时前',
    wrapup: null, wrapupSource: '—', advisory: { priority: 'high', text: '测验超时且中途离开：近 5 天活跃度持续下降，建议触发挽留流程并下调每日任务量。' },
    rawJson: '{\n  "demo": true\n}'
  }
]

const rows = ref<Row[]>([])

watch(
  () => dataSource.value,
  async (src) => {
    if (src !== 'live') {
      rows.value = [...demoRows]
      return
    }
    try {
      const res = await adminTeachingSessionsApi.list({ limit: 100 })
      const body = res.data?.data ?? res.data ?? {}
      const items = body.items || []
      rows.value = items.map((s: Record<string, unknown>) => mapRow(s))
    } catch {
      rows.value = []
    }
  },
  { immediate: true }
)

function mapRow(s: Record<string, unknown>): Row {
  const wrapup = (s.wrapup as Record<string, unknown>) || null
  const summary = (wrapup?.summary as WrapupSummary) || null
  const advisory = (s.advisory as Record<string, unknown>) || null
  const wrapupStatus = wrapup?.status === 'complete' ? 'complete' : 'missing'
  const attention: Row['attention'] =
    s.status === 'error' || s.status === 'timeout' || (s.status === 'completed' && wrapupStatus === 'missing')
      ? 'high'
      : advisory?.priority === 'high'
        ? 'high'
        : advisory
          ? 'medium'
          : 'low'
  return {
    id: String(s.id),
    topic: String(s.topic || s.taskId || '未命名会话'),
    subject: String(s.subject || '—'),
    taskType: String(s.taskType || ''),
    userName: String(s.userName || s.userId),
    email: String(s.email || ''),
    status: String(s.status || ''),
    duration: Number(s.duration || 0),
    messageCount: Number(s.messageCount || 0),
    wrapupStatus,
    hasAdvisory: !!advisory,
    attention,
    startAt: timeAgo(String(s.startTime || '')),
    wrapup: summary,
    wrapupSource: (wrapup?.sources as Record<string, string>)?.summary === 'model' ? '模型生成' : '规则/其他',
    advisory,
    rawJson: JSON.stringify({ wrapup, advisory }, null, 2)
  }
}

/* 筛选 */
const pill = ref<'all' | 'attention' | 'missing'>('all')
const keyword = ref('')
const statusFilter = ref('')
const pills = [
  { id: 'all' as const, label: '全部' },
  { id: 'attention' as const, label: '待关注' },
  { id: 'missing' as const, label: '缺总结' }
]
/* 状态筛选选项（覆盖教学会话实际出现的全部状态枚举；进行中含 in_progress/active） */
const statusOptions = [
  { value: 'completed', label: '已完成' },
  { value: 'in_progress', label: '进行中' },
  { value: 'timeout', label: '超时' },
  { value: 'paused', label: '已暂停' },
  { value: 'superseded', label: '已被替代' },
  { value: 'discarded', label: '已废弃' },
  { value: 'error', label: '错误' }
]

const filtered = computed(() => {
  let list = rows.value
  if (pill.value === 'attention') list = list.filter((r) => r.attention !== 'low')
  if (pill.value === 'missing') list = list.filter((r) => r.wrapupStatus === 'missing')
  if (statusFilter.value) {
    list = list.filter(
      (r) => r.status === statusFilter.value || (statusFilter.value === 'in_progress' && r.status === 'active')
    )
  }
  const q = keyword.value.trim().toLowerCase()
  if (q) list = list.filter((r) => `${r.topic} ${r.userName} ${r.email} ${r.id}`.toLowerCase().includes(q))
  return list
})

const inProgressCount = computed(() => rows.value.filter((r) => r.status === 'in_progress' || r.status === 'active').length)
const advisoryCount = computed(() => rows.value.filter((r) => r.hasAdvisory).length)
const missingWrapupCount = computed(() => rows.value.filter((r) => r.wrapupStatus === 'missing').length)
const attentionCount = computed(() => rows.value.filter((r) => r.attention !== 'low').length)

const statusTone = computed(() => (!rows.value.length ? 'mk-status--muted' : attentionCount.value ? 'mk-status--warn' : 'mk-status--ok'))
const statusTitle = computed(() =>
  !rows.value.length ? '还没有教学会话' : attentionCount.value ? `${attentionCount.value} 个会话待关注` : '会话产物完整'
)

/* 详情 */
const detail = ref<Row | null>(null)
useEscape(() => !!detail.value, () => { detail.value = null })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!detail.value), panelRef)
useMaskClose(maskRef, () => { detail.value = null })
const openCards = ref<Set<string>>(new Set())

function openDetail(r: Row) {
  detail.value = r
  openCards.value = new Set()
}

function toggleCard(key: string) {
  const next = new Set(openCards.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openCards.value = next
}

const isLong = (s?: string) => (s || '').length > 120

/* 状态映射统一走共享字典（覆盖 paused / superseded / discarded 等全部枚举） */
const statusBadge = (s: string) =>
  s === 'completed' || s === 'succeeded' ? 'mk-badge--ok' : s === 'error' || s === 'timeout' || s === 'discarded' ? 'mk-badge--bad' : 'mk-badge--info'
const attentionBadge = (a: string) => (a === 'high' ? 'mk-badge--bad' : a === 'medium' ? 'mk-badge--warn' : 'mk-badge--ok')
const taskTypeText = (t: string) =>
  ({ reading: '阅读', practice: '练习', project: '项目', quiz: '测验', acquire: '获取', deconstruct: '拆解', model: '建模', execute: '执行', diagnose: '诊断', refine: '打磨', consolidate: '巩固' }[t] || t || '任务')
const fmtDuration = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)} 分钟` : `${sec} 秒`)
</script>

<style scoped>
.ts-row { cursor: pointer; }
/* 状态徽章：固定最小宽度，筛选不同状态时列宽不跳动（"已被替代"最长 4 字） */
.ts-row td:nth-child(3) .mk-badge { min-width: 60px; justify-content: center; }
.ts-row:hover { background: #f6f9ff; }
.ts-go { color: var(--mk-faint); font-weight: 700; }
.ts-row:hover .ts-go { color: var(--mk-blue); }

.ts-mask {
  position: fixed;
  inset: 0;
  z-index: var(--mk-z-drawer);
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.ts-panel {
  width: min(560px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: -16px 0 48px rgba(15, 23, 42, 0.18);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: ts-in 0.2s ease;
}

/* 4K 断点见文件末尾（需在基础样式之后定义） */
@keyframes ts-in { from { transform: translateX(30px); opacity: 0; } }
.ts-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid #e1e8f2;
}
.ts-panel__title { display: grid; gap: 6px; justify-items: start; }
.ts-panel__title h3 { margin: 0; font-size: 17px; }
.ts-panel__id { font-family: var(--mk-mono); font-size: 10.5px; color: #8492ab; word-break: break-all; }
.ts-panel__close { border: 0; background: #f0f2f5; width: 30px; height: 30px; border-radius: 8px; cursor: pointer; color: #5b6577; }
.ts-panel__body { padding: 16px 18px; display: grid; gap: 16px; align-content: start; overflow-y: auto; }

.ts-facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.ts-facts > div { display: grid; gap: 2px; }
.ts-facts span { font-size: 11px; color: #8492ab; font-weight: 600; }
.ts-facts strong { font-size: 12.5px; }

@media (max-width: 560px) {
  .ts-facts { grid-template-columns: repeat(2, 1fr); }
}

.ts-section { display: grid; gap: 8px; }
.ts-section h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8492ab;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ts-src { font-size: 10.5px; font-weight: 600; text-transform: none; letter-spacing: 0; }
.ts-card {
  border: 1px solid #e1e8f2;
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}
.ts-card span { font-size: 11px; color: #8492ab; font-weight: 700; }
.ts-card p { margin: 0; font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; }
.ts-card--advisory { border-color: rgba(180, 83, 9, 0.3); background: #fffdf5; }

/* 长文本截断 */
.ts-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ts-clamp--open { -webkit-line-clamp: unset; overflow: visible; }
.ts-more {
  justify-self: start;
  border: 0;
  background: transparent;
  color: #3478f6;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}
.ts-raw summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8492ab;
  padding: 2px 0;
}
.ts-json {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #0d1420;
  color: #8ba3c7;
  font: 10.5px/1.6 'JetBrains Mono', monospace;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 4K：抽屉加宽 + 字号跟随壳层放大（置于基础样式之后确保覆盖） */
@media (min-width: 2000px) {
  .ts-panel { width: min(700px, 100vw); }
  .ts-panel__head { padding: 20px 24px; }
  .ts-panel__title h3 { font-size: 19px; }
  .ts-panel__id { font-size: 12.5px; }
  .ts-panel__body { padding: 20px 24px; }
  .ts-facts span { font-size: 13px; }
  .ts-facts strong { font-size: 14.5px; }
  .ts-section h4 { font-size: 13px; }
  .ts-card p { font-size: 14.5px; }
  .ts-card span { font-size: 13px; }
  .ts-json { font-size: 12.5px; }
  .ts-more { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .ts-panel { width: min(880px, 100vw); }
  .ts-panel__head { padding: 24px 30px; }
  .ts-panel__title h3 { font-size: 23px; }
  .ts-panel__id { font-size: 15px; }
  .ts-panel__body { padding: 24px 30px; }
  .ts-facts span { font-size: 15.5px; }
  .ts-facts strong { font-size: 17px; }
  .ts-section h4 { font-size: 15.5px; }
  .ts-card p { font-size: 17px; }
  .ts-card span { font-size: 15.5px; }
  .ts-json { font-size: 15px; }
  .ts-more { font-size: 16px; }
}
/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
  .ts-panel { width: min(1040px, 100vw); }
  .ts-panel__head { padding: 28px 36px; }
  .ts-panel__title h3 { font-size: 27px; }
  .ts-panel__id { font-size: 17.5px; }
  .ts-panel__body { padding: 28px 36px; }
  .ts-facts span { font-size: 18px; }
  .ts-facts strong { font-size: 20px; }
  .ts-section h4 { font-size: 18px; }
  .ts-card p { font-size: 20px; }
  .ts-card span { font-size: 18px; }
  .ts-json { font-size: 17.5px; }
  .ts-more { font-size: 18.5px; }
}

/* 数值列（互动）表头与单元格居中 */
.mk-table td.mk-num,
.mk-table th:nth-child(4) { text-align: center; }
</style>
