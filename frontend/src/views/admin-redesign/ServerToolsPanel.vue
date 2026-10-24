<template>
  <!-- 运维工具面板（原「系统工具」页 Tab1；2026-10-16 用户拍板该场景解散并入运营中心：
       本组件作为运营中心宿主的一个页签体渲染，id/role=tabpanel/aria-labelledby 由宿主透传落到本根节点） -->
  <div class="stp-body">
    <!-- 时间推进模拟 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">时间推进模拟</h4>
        <span class="mk-card__meta">模拟预览「N 天后」的学习者画像变化，不改动真实数据</span>
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

    <!-- Outbox 死信 -->
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
            :title="deadFailed ? '清单未加载成功，请先重试' : (!deadLoading && deadCount === 0 ? '暂无待重放的事件' : undefined)"
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
          <table class="mk-table stp-dead-table">
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
        description="请先重试加载，再决定是否重放。"
        action-text="重试"
        compact
        @action="loadDead"
      />
      <MkEmptyState
        v-else
        title="没有待重放的事件"
        description="事件投递全部正常，无待处理积压。"
        compact
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { askConfirm } from './useConfirm'
import { adminDevtoolsApi } from '@/api/adminApi'
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
onMounted(() => { void loadDead() })

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
/* 死信表（自动布局）：单元格 nowrap；事件类型长名截断（title 全值） */
.stp-dead-table td { white-space: nowrap; }
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
</style>
