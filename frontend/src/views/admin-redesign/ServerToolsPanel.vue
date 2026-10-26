<template>
  <!-- 运维工具面板（原「系统工具」页 Tab1；2026-10-16 用户拍板该场景解散并入运营中心：
       本组件作为运营中心宿主的一个页签体渲染，id/role=tabpanel/aria-labelledby 由宿主透传落到本根节点） -->
  <div class="stp-body">
    <!-- Outbox 死信（2026-10-26 移到页签第一张）：运营待办「事件投递失败 → 去处理」落在这里，
         首屏必须就是重放入口，不能先看到一张要求填内部用户 ID 的模拟表单。 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">事件投递失败</h4>
        <!-- 死信告警（原状态条语义迁入卡头）：失败显式降 bad，积压 >0 显式 warn——
             零值与加载中不得伪装成「确认无死信」 -->
        <span v-if="deadFailed" class="mk-badge mk-badge--bad">加载失败</span>
        <span v-else-if="!deadLoading && deadCount > 0" class="mk-badge mk-badge--warn">{{ deadCount }} 条待重放</span>
        <div class="mk-card__head-right">
          <!-- P3（2026-10-04 全站评审）：空态不给假动作——0 死信时禁点（此前点了会弹
               「重放全部 0 条死信」确认框，暗示一个不存在的可执行动作） -->
          <!-- 清单加载失败时作用域未知，禁用重放（否则确认框按 deadCount=0 生成假读数，
               与「重放全部」自相矛盾） -->
          <button
            type="button"
            class="mk-btn mk-btn--sm"
            :disabled="requeueBusy || deadFailed || (!deadLoading && deadCount === 0)"
            @click="requeueAll"
          >
            {{ requeueBusy ? '重放中…' : '重放全部失败事件' }}
          </button>
        </div>
      </div>
      <MkLoading v-if="deadLoading" />
      <template v-else-if="deadItems.length">
        <div class="mk-table-scroll">
          <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed，2026-10-01 对齐 Users 判例），
               单元格 nowrap、列按内容自然分宽；事件类型 / 错误信息两处长内容列 max-width 截断兜底 -->
          <table class="mk-table mk-table--nowrap stp-dead-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>用户</th>
                <th>关联对象</th>
                <th class="mk-th--right">尝试</th>
                <th>错误</th>
                <th>发生时间</th>
                <th class="mk-th--right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in deadItems" :key="item.id">
                <td><span class="mono stp-ev" :title="item.eventType">{{ item.eventType }}</span></td>
                <td><span class="mono mk-cell-text">{{ shortId(item.userId || '—', 10, 4) }}</span></td>
                <td><span class="mono mk-cell-text" :title="item.aggregateId || ''">{{ shortId(item.aggregateId || '—', 10, 4) }}</span></td>
                <td class="mk-num">{{ item.attemptCount }}</td>
                <td><span class="dt-err" :title="item.lastError || ''">{{ item.lastError || '—' }}</span></td>
                <td :title="fmtDate(item.occurredAt)">{{ timeAgo(item.occurredAt) }}</td>
                <td>
                  <div class="mk-actions">
                    <button type="button" class="mk-btn mk-btn--sm" :disabled="requeueBusy" @click="requeueOne(item.eventType)">重放该类</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mk-list-more">
          <!-- CP8：死信总条数由卡头 warn 徽标单源承载，列表尾不再复读「共 N 条死信」。
               口径与后端一致（outbox.worker 按 occurredAt 升序 take 50 → 实为最早 50 条，
               不是「最近」）；总数一并给出，避免把窗口读成全量 -->
          <span>最早 50 条（共 {{ deadCount }} 条）</span>
          <button type="button" class="mk-link" @click="loadDead">刷新</button>
        </div>
      </template>
      <!-- 失败态走 tone=error（红系图标 + role=alert），与页内另两处错误态同口径 -->
      <MkEmptyState
        v-else-if="deadFailed"
        tone="error"
        icon="!"
        title="事件清单加载失败"
        action-text="重试"
        compact
        @action="loadDead"
      />
      <MkEmptyState
        v-else
        title="没有待重放的事件"
        compact
      />
    </section>

    <!-- 时间推进模拟 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">时间推进模拟</h4>
      </div>
      <div class="dt-body">
        <div class="dt-grid">
          <label class="mk-field">
            <span class="mk-field__label">用户 ID</span>
            <input v-model="advance.userId" class="mk-field__input mono" placeholder="留空 = 当前管理员" />
          </label>
          <!-- 天数校验（F6-4）：越界/空值显式报错并拦截，不再静默 clamp（判例
               VirtualLearnerBatchCreate 审核 #58「填 999 显 999 实建 20」）。原实现
               Math.min(365,…) 夹取后结果区显「365 天后」、输入框仍留 999、toast 无提示，
               会被读成「模拟了 999 天」；label 已有 min/max，原生校验因按钮非 submit 从不触发 -->
          <label class="mk-field" :class="{ 'mk-field--error': !!advanceDaysError }">
            <span class="mk-field__label">天数（1-365）</span>
            <input
              v-model.number="advance.days"
              type="number"
              min="1"
              max="365"
              class="mk-field__input"
              :aria-invalid="!!advanceDaysError"
              @input="advanceDaysError = ''"
            />
            <span v-if="advanceDaysError" class="mk-field__err">{{ advanceDaysError }}</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">路径 ID（可选）</span>
            <input v-model="advance.pathId" class="mk-field__input mono" placeholder="留空 = 全局画像" />
          </label>
          <div class="mk-field dt-actions">
            <span class="mk-field__label">&nbsp;</span>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="advanceBusy" @click="runAdvance">
              {{ advanceBusy ? '模拟中…' : '模拟推进' }}
            </button>
          </div>
        </div>
        <div v-if="advanceResult" class="dt-result">
          <div class="dt-result__head">
            <strong>模拟结果：{{ advanceResult.dayDiff }} 天后</strong>
            <span class="mono">{{ fmtDate(advanceResult.simulatedAsOf) }}</span>
            <span v-if="advanceResult.hasMetricRecord" class="mk-badge mk-badge--warn">基于最近指标 {{ fmtDate(advanceResult.latestMetricAt) }}</span>
            <span v-else class="mk-badge mk-badge--muted">无指标记录</span>
          </div>
          <div class="dt-compare">
            <div class="dt-compare__col">
              <h5>当前</h5>
              <pre class="mono">{{ pretty(advanceResult.before) }}</pre>
            </div>
            <div class="dt-compare__col">
              <h5>模拟后</h5>
              <pre class="mono">{{ pretty(advanceResult.after) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 批量吞吐（2026-10-21）：rpm 下限此前只在 CLI 审计里，跑批空转在后台看不出来。
         口径与 scripts/audit-batch-throughput 同一纯函数（窗口内全部尝试，含失败）。 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">批量吞吐</h4>
        <span class="mk-card__meta">最近 {{ throughput?.windowMinutes ?? 60 }} 分钟 · 下限 {{ throughput?.minRpm ?? 20 }} rpm<template v-if="throughput?.idle"> · 空闲</template></span>
        <div class="mk-card__head-right">
          <button type="button" class="mk-btn mk-btn--sm" :disabled="throughputLoading" @click="loadThroughput">{{ throughputLoading ? '读取中…' : '刷新' }}</button>
        </div>
      </div>
      <div v-if="throughputFailed" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">吞吐读取失败</span>
      </div>
      <div v-else class="st-kpis">
        <div class="st-kpi"><span class="st-kpi__label">均值</span><b class="st-kpi__value">{{ throughput?.avgRpm ?? '—' }}</b><span class="st-kpi__hint">rpm</span></div>
        <div class="st-kpi"><span class="st-kpi__label">最低</span><b class="st-kpi__value">{{ throughput?.worstRpm ?? '—' }}</b><span class="st-kpi__hint">单分钟 rpm</span></div>
        <div class="st-kpi"><span class="st-kpi__label">低于下限</span><b class="st-kpi__value">{{ throughput?.lowMinutes ?? '—' }}</b><span class="st-kpi__hint">分钟</span></div>
        <div class="st-kpi" :class="{ 'st-kpi--warn': throughput?.alert }"><span class="st-kpi__label">最长连续</span><b class="st-kpi__value">{{ throughput?.longestLowRun ?? '—' }}</b><span class="st-kpi__hint">分钟</span></div>
      </div>
      <p v-if="throughput?.alert" class="mk-field__hint st-alert" role="alert">⚠ {{ throughput.alertReason }}</p>
    </section>
    <!-- 内容抽检（#121，2026-10-21）：CLI 闭环接到管理端；与 CLI 同表同键，标注后 CLI --metrics 立即可见。
         挂点在运维工具而不是「记忆与复习」：后者已收成学习者详情内的单用户面板，抽检是跨会话的运营动作。 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">内容抽检</h4>
        <span class="mk-card__meta">
          近 7 天 · rate 5% · 抽中 {{ contentReview?.sampled ?? '—' }} / 已标注 {{ contentReview?.labeled ?? '—' }}<template v-if="contentReview"> · 覆盖率 {{ pctText(contentReview.coverage) }} · 错误率 {{ contentReview.errorRate == null ? 'n/a' : pctText(contentReview.errorRate) }} · 今日 {{ contentReview.todayLabeled ?? 0 }}/{{ contentReview.dailyTarget ?? 10 }}</template>
        </span>
        <div class="mk-card__head-right">
          <button type="button" class="mk-btn mk-btn--sm" :disabled="contentLoading" @click="loadContentReview">{{ contentLoading ? '读取中…' : '重新抽样' }}</button>
        </div>
      </div>
      <p v-if="contentFailed" class="mk-alert mk-alert--row" role="alert">内容抽检读取失败</p>
      <div v-else-if="!contentReview?.items.length" class="mk-field__hint">本窗口没有抽中的教师回合。</div>
      <div v-else class="st-cr">
        <div class="st-cr__bar">
          <span class="mk-field__hint">待标注 {{ unlabeledCount }} 条 · 未标注优先</span>
          <label class="st-cr__toggle">
            <input v-model="unlabeledOnly" type="checkbox" />
            只看未标注
          </label>
        </div>
        <div v-if="!contentItems.length" class="mk-field__hint">这批样本已全部标注。</div>
        <div v-for="item in contentItems" :key="item.messageId" class="st-cr__row">
          <span class="st-cr__id mono" :title="`消息 ${item.messageId} · 会话 ${item.sessionId}`">#{{ item.messageId }}</span>
          <span class="st-cr__text" :title="item.content">{{ item.content }}</span>
          <span v-if="item.label" class="mk-badge mk-badge--sm" :class="item.label.verdict === 'incorrect' ? 'mk-badge--bad' : item.label.verdict === 'unsure' ? 'mk-badge--warn' : 'mk-badge--ok'">{{ verdictText(item.label.verdict) }}</span>
          <span class="st-cr__actions">
            <button type="button" class="mk-btn mk-btn--sm" :disabled="labelingId === item.messageId" @click="labelContent(item, 'correct')">正确</button>
            <button type="button" class="mk-btn mk-btn--sm" :disabled="labelingId === item.messageId" @click="labelContent(item, 'incorrect')">判错</button>
            <button type="button" class="mk-btn mk-btn--sm" :disabled="labelingId === item.messageId" @click="labelContent(item, 'unsure')">存疑</button>
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { askConfirm } from './useConfirm'
import { adminDevtoolsApi, adminOpsApi, adminContentReviewApi, type ThroughputReportLike, type ContentReviewItem } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'

/* 运维工具（原「系统工具」页 Tab1 整体迁入，2026-10-16）：时间推进模拟 + outbox 死信重放。
   两件事都是「只看不改数据」或「显式确认后才改」的运维动作。 */

const advanceBusy = ref(false)
const requeueBusy = ref(false)
const refreshing = ref(false)

/* 时间推进 */
const advance = ref({ userId: '', days: 30, pathId: '' })
/** 模拟结果结构：后端 /admin/devtools/advance-time 的 data 载荷（adminApi.ts 侧响应尚未标注类型，按模板消费字段镜像） */
interface AdvanceTimeResult {
  dayDiff: number
  simulatedAsOf: string
  hasMetricRecord?: boolean
  latestMetricAt?: string | null
  before: unknown
  after: unknown
}
const advanceResult = ref<AdvanceTimeResult | null>(null)
/** 天数内联校验文案（空 = 通过）；上限与后端 devtools.ts:25 的 clamp(1,365) 同源 */
const advanceDaysError = ref('')

/** 天数取值校验：越界/留空/非整数显式报错，不做静默夹取（口径同 VirtualLearnerBatchCreate，
    见文件头 F6-4 注释）。后端对越界值同样 clamp 1–365，故前端必须在提交前拦住不一致读数。 */
function resolveAdvanceDays(): { ok: true; days: number } | { ok: false; error: string } {
  // v-model.number 在输入框清空时回填 ''（非 number），故按 unknown 收口
  const raw: unknown = advance.value.days
  const n = Number(raw)
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
    return { ok: false, error: '请填写天数（1–365 的整数）' }
  }
  if (!Number.isInteger(n)) {
    return { ok: false, error: '天数须为整数（1–365）' }
  }
  if (n < 1 || n > 365) {
    return { ok: false, error: '天数须为 1–365 的整数（最大 365 天）' }
  }
  return { ok: true, days: n }
}

async function runAdvance() {
  const check = resolveAdvanceDays()
  if (!check.ok) {
    advanceDaysError.value = check.error
    return
  }
  advanceDaysError.value = ''
  advanceBusy.value = true
  advanceResult.value = null
  try {
    const res = await adminDevtoolsApi.advanceTime({
      userId: advance.value.userId.trim() || undefined,
      days: check.days,
      pathId: advance.value.pathId.trim() || undefined,
    })
    advanceResult.value = res.data?.data ?? res.data
    toast.success('模拟完成（只读预览，未改动真实数据）')
  } catch (e) {
    toast.error(`模拟失败：${errMsg(e)}`)
  } finally {
    advanceBusy.value = false
  }
}

/* 死信 */
/** 死信行结构：镜像 adminApi.ts getOutboxDead 泛型内联类型（api 侧未导出，只能就地声明） */
interface OutboxDeadItem {
  id: string
  eventType: string
  userId: string | null
  aggregateId: string | null
  attemptCount: number
  lastError: string | null
  occurredAt: string
}
const deadCount = ref(0)
const deadItems = ref<OutboxDeadItem[]>([])
const deadLoading = ref(false)
const deadFailed = ref(false)
const deadLoaded = ref(false)

async function loadDead() {
  deadLoading.value = true
  deadFailed.value = false
  try {
    const res = await adminDevtoolsApi.getOutboxDead()
    const data = res.data?.data ?? res.data
    deadCount.value = Number(data?.deadCount || 0)
    deadItems.value = Array.isArray(data?.items) ? data.items : []
    deadLoaded.value = true
  } catch (e) {
    deadFailed.value = true
    toast.error(`事件清单加载失败：${errMsg(e)}`)
  } finally {
    deadLoading.value = false
  }
}

async function requeueAll() {
  // 重放会重新投递事件、产生真实副作用：执行前确认（与 HealthCenter 修复/会话下线同策略）
  const ok = await askConfirm({
    title: '重放全部失败事件',
    message: `将把全部 ${deadCount.value} 条投递失败的事件重新投递一次，可能产生重复的业务副作用。确定继续？`,
    confirmText: '全部重放',
    danger: true,
  })
  if (!ok) return
  requeueBusy.value = true
  try {
    const res = await adminDevtoolsApi.requeueOutboxDead()
    const data = res.data?.data ?? res.data
    toast.success(`已重新投递 ${data?.requeued ?? 0} 条事件`)
    void loadDead()
  } catch (e) {
    const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
    if (code === 'OUTBOX_DEAD_LETTER_ROOT_CAUSE') {
      const force = await askConfirm({
        title: '存在已知根因的投递失败事件',
        message: '这些投递失败的事件带有已知毒丸根因（如非法 FSRS 状态），直接重放会再次投递失败。确认根因已修复后，仍要强制重放吗？',
        confirmText: '强制重放',
        danger: true,
      })
      if (force) {
        try {
          const forced = await adminDevtoolsApi.requeueOutboxDead(undefined, true)
          const data = forced.data?.data ?? forced.data
          toast.success(`已强制重放 ${data?.requeued ?? 0} 条事件`)
          void loadDead()
          return
        } catch (forceError) {
          toast.error(`强制重放失败：${errMsg(forceError)}`)
          return
        }
      }
    }
    toast.error(`重放失败：${errMsg(e)}`)
  } finally {
    requeueBusy.value = false
  }
}

/** 注意：后端按事件类型重放（非单条），按钮与确认文案均需明确「该类型全部」范围 */
async function requeueOne(eventType: string) {
  const count = deadItems.value.filter((i) => i.eventType === eventType).length
  const ok = await askConfirm({
    title: '重放该类事件',
    message: `将把「${eventType}」类全部投递失败的事件重新投递一次（当前清单内 ${count} 条），可能产生重复的业务副作用。确定继续？`,
    confirmText: '重放该类',
    danger: true,
  })
  if (!ok) return
  requeueBusy.value = true
  try {
    const res = await adminDevtoolsApi.requeueOutboxDead(eventType)
    const data = res.data?.data ?? res.data
    toast.success(`已重新投递 ${data?.requeued ?? 0} 条「${eventType}」事件`)
    void loadDead()
  } catch (e) {
    toast.error(`重放失败：${errMsg(e)}`)
  } finally {
    requeueBusy.value = false
  }
}

/** 宿主刷新钮调用的整体重载：只重拉死信清单（时间推进是表单，无需刷新） */
async function refresh() {
  refreshing.value = true
  await loadDead()
  refreshing.value = false
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pretty(obj: unknown): string {
  if (!obj) return '（无）'
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

/* 死信懒加载：与页签同生共死（宿主 v-if 挂载本组件时才拉），故挂载即拉一次 */
/* 批量吞吐（2026-10-21）：窗口 60 分钟 / 下限 20 rpm，与 CLI 默认一致 */
const throughput = ref<ThroughputReportLike | null>(null)
const throughputLoading = ref(false)
const throughputFailed = ref(false)
async function loadThroughput() {
  throughputLoading.value = true
  throughputFailed.value = false
  try {
    const res = await adminOpsApi.throughput({ window: 60, minRpm: 20 })
    throughput.value = res.data?.data ?? null
  } catch {
    throughputFailed.value = true
  } finally {
    throughputLoading.value = false
  }
}

/* 内容抽检（#121）：抽样/标注与 CLI 同表同键；标注后重拉指标 */
interface ContentReviewPayload {
  windowDays: number
  rate: number
  sampled: number
  labeled: number
  coverage: number
  incorrect: number
  unsure: number
  correct: number
  errorRate: number | null
  outsideSample: number
  todayLabeled?: number
  dailyTarget?: number
  items: ContentReviewItem[]
}
const contentReview = ref<ContentReviewPayload | null>(null)
const contentLoading = ref(false)
const contentFailed = ref(false)
const labelingId = ref<number | null>(null)
/* 标注队列（2026-10-21）：抽样是确定性的，但列表此前按原顺序排，已标注行混在中间；
   运营要清完一批就得逐行找。未标注优先 + 只看未标注，让「抽 40 条只标 1 条」的覆盖率有推进抓手。 */
const unlabeledOnly = ref(false)
const unlabeledCount = computed(() => (contentReview.value?.items || []).filter((item) => !item.label).length)
const contentItems = computed(() => {
  const items = [...(contentReview.value?.items || [])]
  items.sort((a, b) => Number(Boolean(a.label)) - Number(Boolean(b.label)) || a.messageId - b.messageId)
  return unlabeledOnly.value ? items.filter((item) => !item.label) : items
})
async function loadContentReview() {
  contentLoading.value = true
  contentFailed.value = false
  try {
    const res = await adminContentReviewApi.list({ days: 7, rate: 0.05 })
    contentReview.value = res.data?.data ?? null
  } catch {
    contentFailed.value = true
  } finally {
    contentLoading.value = false
  }
}
async function labelContent(item: { messageId: number }, verdict: 'correct' | 'incorrect' | 'unsure') {
  labelingId.value = item.messageId
  try {
    await adminContentReviewApi.label({ messageId: item.messageId, verdict })
    toast.success(`消息 #${item.messageId} 已标注：${verdictText(verdict)}`)
    await loadContentReview()
  } catch (e) {
    toast.error(`标注失败：${errMsg(e)}`)
  } finally {
    labelingId.value = null
  }
}
function verdictText(verdict: string): string {
  if (verdict === 'correct') return '正确'
  if (verdict === 'incorrect') return '判错'
  if (verdict === 'unsure') return '存疑'
  return verdict
}
function pctText(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(Number(v) * 1000) / 10}%`
}

onMounted(() => {
  void loadDead()
  void loadThroughput()
  void loadContentReview()
})

/** 宿主可调（刷新钮）；暴露 loadDead 供外部触发重拉 */
defineExpose({ refresh, reload: loadDead })
</script>

<style scoped>
.stp-body {
  padding: 16px;
  display: grid;
  gap: 12px;
  align-content: start;
}
.dt-body { padding: 14px; display: grid; gap: 14px; }
/* 死信表（自动布局）：事件类型长名截断（title 全值）。nowrap 走表级 .mk-table--nowrap */
.stp-ev {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.dt-grid { display: grid; grid-template-columns: 1.6fr 0.7fr 1.4fr auto; gap: 12px; align-items: end; }
.dt-actions { display: grid; gap: 6px; }
.dt-result { border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl); overflow: hidden; }
.dt-result__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-bottom: 1px solid var(--mk-line);
  background: var(--mk-surface);
  font-size: var(--mk-fs-micro);
}
.dt-result__head strong { font-size: var(--mk-fs-body); }
.dt-result__head .mono { color: var(--mk-muted); }
.dt-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.dt-compare__col { padding: 12px; min-width: 0; }
.dt-compare__col + .dt-compare__col { border-left: 1px dashed var(--mk-line); }
.dt-compare__col h5 { margin: 0 0 8px; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); letter-spacing: 0.05em; }
.dt-compare__col pre {
  margin: 0;
  max-height: 300px;
  overflow: auto;
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-muted);
  white-space: pre-wrap;
  word-break: break-all;
}
.dt-err {
  display: inline-block;
  /* 自动布局下 max-content 决定列宽：固定截断上限，长错误信息不独吃表格宽度（title 全值） */
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
}

@media (min-width: 2000px) {
  .dt-grid { grid-template-columns: 1.6fr 0.7fr 1.4fr auto; }
  .dt-compare__col pre { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .dt-compare__col pre { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .dt-compare__col pre { font-size: var(--mk-fs-body); }
}
@media (max-width: 1100px) {
  .dt-grid { grid-template-columns: 1fr 1fr; }
  .dt-compare { grid-template-columns: 1fr; }
  .dt-compare__col + .dt-compare__col { border-left: none; border-top: 1px dashed var(--mk-line); }
}
/* 批量吞吐 KPI（2026-10-21）：四格读数；只有「最长连续」在告警时转 warn */
.st-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; padding: 4px 0 8px; }
.st-kpi { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: 8px; background: var(--mk-surface-2); }
.st-kpi--warn { border-color: var(--mk-amber); }
.st-kpi__label { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.st-kpi__value { font-size: 22px; font-weight: 700; line-height: 1.1; }
.st-kpi__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.st-alert { color: var(--mk-amber); font-weight: 600; }
/* 内容抽检行（2026-10-21）：id / 正文 / 已标注徽章 / 三个判对按钮 */
.st-cr { display: grid; gap: 6px; padding: 4px 0 8px; }
.st-cr__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 8px; }
.st-cr__toggle { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.st-cr__row { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px 8px; border-bottom: 1px dashed var(--mk-line); }
.st-cr__row:last-child { border-bottom: none; }
.st-cr__id { flex: 0 0 auto; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.st-cr__text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-cr__actions { flex: 0 0 auto; display: inline-flex; gap: 4px; }
@media (max-width: 900px) { .st-kpis { grid-template-columns: 1fr 1fr; } }
</style>
