<template>
  <div class="mk-page mk-page--fill oc-host">
    <!-- 页头（原型 pageTitle：页名+副标；刷新是各页签真实能力，随 tab 显示）。
         P3-33（设计评审）：原页头 primary「导出数据」做的是 tab 导航、与页签栏完全重复入口——
         已撤（原型只是组件参考，页签即唯一入口），页头动作位留给当前页签真实能力（刷新） -->
    <MkPageHead title="系统工具" sub="数据导出、会话安全与运维工具">
      <template #actions>
        <button v-if="tab === 'tools'" type="button" class="mk-btn mk-btn--sm" :disabled="refreshing" @click="refreshAll">{{ refreshing ? '刷新中…' : '刷新' }}</button>
        <button v-else-if="tab === 'security'" type="button" class="mk-btn mk-btn--sm" @click="securityRef?.refresh?.()">刷新</button>
      </template>
    </MkPageHead>

    <!-- 原型骨架：单张卡内「.tabs 页签 + 页签体」（Users 卡内页签判例）。状态条退役——
         死信计数在死信卡头、会话计数在页签角标、CSV 说明在导出表单脚注，不再三处投影 -->
    <section class="mk-card oc-card">
      <div class="tabs oc-tabs" role="tablist" aria-label="系统工具视图切换">
        <button type="button" role="tab" class="tab" :aria-selected="tab === 'tools'" @click="switchTab('tools')">运维工具</button>
        <button type="button" role="tab" class="tab" :aria-selected="tab === 'export'" @click="switchTab('export')">数据导出</button>
        <!-- P3-34（设计评审）：未知态角标由孤悬「—」改「待访问」弱灰小字——「—」像渲染残留、
             与「外挂能力 0」真计数并读语义无法区分；title 保留「未访问≠0」语义 -->
        <button type="button" role="tab" class="tab" :aria-selected="tab === 'security'" @click="switchTab('security')">会话安全<span class="tab__count" :title="securityCount === null ? '尚未访问该页签，计数未拉取（待访问 ≠ 0）' : undefined">{{ securityCount === null ? '待访问' : securityCount }}</span></button>
      </div>
      <div class="oc-card__body">

    <!-- ===== Tab1: 运维工具 ===== -->
    <template v-if="tab === 'tools'">
    <!-- 全宽页签体（原型 renderOpsCenter tools/export/security 三 pane 均通栏；2026-10-02
         撤 mk-narrow 限宽——此前仅本页签被 1200px 居中收窄，宽屏下两翼留白、三个页签不一致） -->
    <div class="oc-tab-body">
    <!-- 时间推进模拟 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">时间推进模拟</h4>
        <span class="mk-card__meta">不写库：按衰减模型预览「N 天后」学习者画像变化</span>
      </div>
      <div class="dt-body">
        <div class="dt-grid">
          <label class="mk-field">
            <span class="mk-field__label">用户 ID</span>
            <input v-model="advance.userId" class="mk-field__input mono" placeholder="留空 = 当前管理员" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">天数（1-365）</span>
            <input v-model.number="advance.days" type="number" min="1" max="365" class="mk-field__input" />
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
        <h4 class="mk-card__title">事件 Outbox 死信</h4>
        <span class="mk-card__meta">dead 为无出口终态，worker 不再拾取；修复根因后可人工重放</span>
        <!-- 死信告警（原状态条语义迁入卡头）：失败显式降 bad，积压 >0 显式 warn——
             零值与加载中不得伪装成「确认无死信」 -->
        <span v-if="deadFailed" class="mk-badge mk-badge--bad">加载失败</span>
        <span v-else-if="!deadLoading && deadCount > 0" class="mk-badge mk-badge--warn">{{ deadCount }} 条待重放</span>
        <div class="mk-card__head-right">
          <!-- P3（2026-10-04 全站评审）：空态不给假动作——0 死信时禁点（此前点了会弹
               「重放全部 0 条死信」确认框，暗示一个不存在的可执行动作） -->
          <button
            type="button"
            class="mk-btn mk-btn--sm"
            :disabled="requeueBusy || (!deadLoading && !deadFailed && deadCount === 0)"
            :title="!deadLoading && !deadFailed && deadCount === 0 ? '暂无死信可重放' : undefined"
            @click="requeueAll"
          >
            {{ requeueBusy ? '重放中…' : '重放全部死信' }}
          </button>
        </div>
      </div>
      <MkLoading v-if="deadLoading" />
      <template v-else-if="deadItems.length">
        <div class="mk-table-scroll">
          <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed，2026-10-01 对齐 Users 判例），
               单元格 nowrap、列按内容自然分宽；事件类型 / 错误信息两处长内容列 max-width 截断兜底 -->
          <table class="mk-table oc-dead-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>用户</th>
                <th>聚合</th>
                <th class="mk-th--right">尝试</th>
                <th>错误</th>
                <th>发生时间</th>
                <th class="mk-th--right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in deadItems" :key="item.id">
                <td><span class="mono oc-ev" :title="item.eventType">{{ item.eventType }}</span></td>
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
          <!-- CP8：死信总条数由卡头 warn 徽标单源承载，列表尾不再复读「共 N 条死信」 -->
          <span>最近 50 条</span>
          <button type="button" class="mk-link" @click="loadDead">刷新</button>
        </div>
      </template>
      <MkEmptyState
        v-else-if="deadFailed"
        title="死信清单加载失败"
        action-text="重试"
        compact
        @action="loadDead"
      />
      <MkEmptyState
        v-else
        title="没有死信事件"
        description="outbox 全部正常投递，worker 无积压。"
        compact
      />
    </section>
    </div><!-- /oc-tab-body -->
    </template>

    <!-- ===== Tab2: 数据导出（原型表单形态：范围 chips 多选 + 右对齐「开始导出」；
         时间范围 / JSONL 格式后端导出接口不支持，不渲染假控件） ===== -->
    <template v-else-if="tab === 'export'">
    <div class="oc-tab-body oc-export">
      <div class="mk-field">
        <span class="mk-field__label">导出范围</span>
        <div class="mk-pills" role="group" aria-label="导出范围多选">
          <button
            v-for="item in exportDefs"
            :key="item.key"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': exportSel.includes(item.key) }"
            :aria-pressed="exportSel.includes(item.key)"
            :title="item.desc"
            @click="toggleExport(item.key)"
          >{{ item.label }}</button>
        </div>
      </div>
      <div v-if="exportSel.some((k) => LOG_EXPORT_KEYS.has(k))" class="mk-field oc-export__limit">
        <span class="mk-field__label">日志行数上限</span>
        <select v-model="logLimit" class="mk-filter__select" :disabled="exporting !== ''">
          <option :value="1000">1000 行</option>
          <option :value="5000">5000 行</option>
          <option :value="20000">20000 行</option>
        </select>
      </div>
      <div class="oc-export__foot">
        <span class="oc-export__hint">已选 {{ exportSel.length }} 项 · CSV（UTF-8 BOM，Excel / WPS 可直接打开）</span>
        <button
          type="button"
          class="mk-btn mk-btn--primary oc-export__go"
          :disabled="!exportSel.length || exporting !== ''"
          @click="runExport"
        >{{ exporting !== '' ? '导出中…' : '开始导出' }}</button>
      </div>
      <ul class="oc-export__notes">
        <li>执行日志默认导出最近 1000 行，可切换上限；其余业务表导出最近 20000 条。</li>
        <li>用户导出默认排除虚拟学习者与测试账号；如需全量请在后端接口加 includeTest=1。</li>
        <li>导出为只读操作，不产生审计记录；敏感字段（密码哈希、API Key）一律不包含。</li>
      </ul>
    </div>
    </template>

    <!-- ===== Tab3: 会话安全（SessionSecurity embedded） ===== -->
    <SessionSecurity v-else ref="securityRef" embedded @count="securityCount = $event" />
      </div><!-- /oc-card__body -->
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { timeAgo, errMsg, shortId } from './live'
import { askConfirm } from './useConfirm'
import { adminDevtoolsApi, adminAxios } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import SessionSecurity from './SessionSecurity.vue'

/* 工具/导出/会话安全 tab（阶段 1 导航收敛：会话安全折入系统工具）：
   URL 查询驱动（?tab=），旧深链 /admin/export-data、/admin/devtools、
   /admin/session-security 经路由重定向带 query 落地 */
const OC_TABS = ['tools', 'export', 'security'] as const
type OcTab = (typeof OC_TABS)[number]
const tab = ref<OcTab>('tools')
const route = useRoute()
const router = useRouter()
/** 会话安全域计数（SessionSecurity embedded 上报）；null = 尚未访问该 tab，
    此时页签角标显「待访问」弱灰小字而非 0（0 会被读成「确认无会话」，是另一种假信号；
    原「—」孤悬破折号像渲染残留，P3-34 改词） */
const securityCount = ref<number | null>(null)
const securityRef = ref<{ refresh?: () => void } | null>(null)
/* URL → tab（深链/刷新/前进后退）；非法值回落 tools。组件单测可无 router 挂载，故访问保持可选 */
watch(
  () => route?.query.tab,
  (t) => {
    const v = typeof t === 'string' && (OC_TABS as readonly string[]).includes(t) ? (t as OcTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'tools') tab.value = 'tools'
  },
  { immediate: true }
)
function switchTab(t: OcTab) {
  tab.value = t
  /* tools 死信懒加载统一交给文件尾的 tab watcher：此处直接调会与 watcher 同帧各发一次请求 */
  /* URL 同步（?tab=…）：深链/刷新/前进后退可寻址 */
  if (route && route.query.tab !== t) void router?.replace({ query: { ...route.query, tab: t } })
}

const refreshing = ref(false)
const advanceBusy = ref(false)
const requeueBusy = ref(false)

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

async function runAdvance() {
  advanceBusy.value = true
  advanceResult.value = null
  try {
    const res = await adminDevtoolsApi.advanceTime({
      userId: advance.value.userId.trim() || undefined,
      days: Math.max(1, Math.min(365, advance.value.days || 1)),
      pathId: advance.value.pathId.trim() || undefined,
    })
    advanceResult.value = res.data?.data ?? res.data
    toast.success('模拟完成（只读预览，未写库）')
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
    toast.error(`加载死信失败：${errMsg(e)}`)
  } finally {
    deadLoading.value = false
  }
}

async function requeueAll() {
  // 重放会重新投递事件、产生真实副作用：执行前确认（与 HealthCenter 修复/会话下线同策略）
  const ok = await askConfirm({
    title: '重放全部死信',
    message: `将重放全部 ${deadCount.value} 条死信事件并重新投递，可能产生重复的业务副作用。确定继续？`,
    confirmText: '重放全部',
    danger: false,
  })
  if (!ok) return
  requeueBusy.value = true
  try {
    const res = await adminDevtoolsApi.requeueOutboxDead()
    const data = res.data?.data ?? res.data
    toast.success(`已重放 ${data?.requeued ?? 0} 条死信`)
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
    title: '重放该类型死信',
    message: `将重放事件类型「${eventType}」的全部死信（当前清单内 ${count} 条），可能产生重复的业务副作用。确定继续？`,
    confirmText: '重放该类',
    danger: false,
  })
  if (!ok) return
  requeueBusy.value = true
  try {
    const res = await adminDevtoolsApi.requeueOutboxDead(eventType)
    const data = res.data?.data ?? res.data
    toast.success(`已重放 ${data?.requeued ?? 0} 条「${eventType}」死信`)
    void loadDead()
  } catch (e) {
    toast.error(`重放失败：${errMsg(e)}`)
  } finally {
    requeueBusy.value = false
  }
}

async function refreshAll() {
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

/* ===== Tab2: 数据导出（原型表单：范围 chips 多选 + 右对齐「开始导出」） ===== */
interface ExportDef {
  key: string
  label: string
  desc: string
}

const exportDefs: ExportDef[] = [
  { key: 'users', label: '用户', desc: '全部真实用户：ID / 姓名 / 邮箱 / 角色 / XP / 等级 / 注册与登录时间' },
  { key: 'teaching-sessions', label: '教学会话', desc: '会话：学科 / 主题 / 任务类型 / 模式 / 状态 / 时长 / 起止时间' },
  { key: 'feedback', label: '用户反馈', desc: '反馈：评分 / 难度 / 评论 / 处理状态 / 时间' },
  { key: 'goal-conversations', label: '目标对话', desc: '目标澄清：状态 / 阶段 / 描述 / 创建与更新时间' },
  { key: 'agent-logs', label: '执行日志', desc: 'Agent 调用：成功 / 耗时 / 错误码与分类 / 模型 / Token' },
  { key: 'audit-logs', label: '审计日志', desc: '管理操作审计：动作 / 目标 / 方法 / 路径 / 状态码 / IP' },
]

/** 只有日志类导出支持行数上限（后端 ?limit=）；业务表固定最近 20000 条 */
const LOG_EXPORT_KEYS = new Set(['agent-logs', 'audit-logs'])
const logLimit = ref<number>(1000)

const exportSel = ref<string[]>([])
function toggleExport(key: string) {
  exportSel.value = exportSel.value.includes(key)
    ? exportSel.value.filter((k) => k !== key)
    : [...exportSel.value, key]
}

const exporting = ref('')

async function doExport(key: string) {
  exporting.value = key
  try {
    const params = LOG_EXPORT_KEYS.has(key) ? `?limit=${logLimit.value}` : ''
    const response = await adminAxios.get(`/admin/export/${key}${params}`, { responseType: 'blob' })
    const disposition = String(response.headers['content-disposition'] || '')
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
    const filename = match ? decodeURIComponent(match[1]) : `${key}-${Date.now()}.csv`
    const url = URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('导出成功，已开始下载')
  } catch (e) {
    toast.error(`导出失败：${errMsg(e)}`)
  } finally {
    exporting.value = ''
  }
}

/** 顺序导出所选项（共用 exporting 守卫，按钮同时禁用防并发） */
async function runExport() {
  for (const key of exportSel.value) {
    if (exporting.value !== '') return
    await doExport(key)
  }
}

/* 死信懒加载：挂载只拉首屏 tab（深链 ?tab=export/security 不预取多打一次）；
   前进/后退经 route watch 直改 tab、不走 switchTab，故以 tab watcher 兜底补拉 */
if (tab.value === 'tools') void loadDead()
watch(tab, (t) => {
  if (t === 'tools' && !deadLoaded.value) void loadDead()
})
</script>

<style scoped>
/* ================= 宿主布局（原型骨架：页头 → 单卡「页签+页签体」） ================= */
.oc-card {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 页签体在卡内独立滚动；会话安全嵌入组件（.mk-page--fill.ss-embedded）占满剩余高度内滚 */
.oc-card__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.oc-card__body > .mk-page--fill { flex: 1 1 auto; min-height: 0; }
/* 工具/导出页签体：卡体内边距 + 栅格（滚动上移到 oc-card__body） */
.oc-tab-body {
  padding: 16px; /* 原型页签体 --sp-4（此前 14px） */
  display: grid;
  gap: 12px;
  align-content: start;
}
.dt-body { padding: 14px; display: grid; gap: 14px; }
/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （mk-primitives.css）；本页只保留卡内 14px 横向内边距（.tabs 特有 padding）。 */
.oc-tabs { padding: 0 14px; }
/* 死信表（自动布局）：单元格 nowrap；事件类型长名截断（title 全值） */
.oc-dead-table td { white-space: nowrap; }
.oc-ev {
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

/* Tab2: 数据导出（原型表单：field 范围 chips + 右对齐 foot 主钮 + 脚注说明） */
.oc-export { gap: 16px; }
.oc-export__limit { max-width: 320px; }
.oc-export__foot { display: flex; align-items: center; gap: 12px; }
.oc-export__go { margin-left: auto; }
.oc-export__hint { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.oc-export__notes {
  margin: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--mk-line);
  display: grid;
  gap: 6px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}

/* ================= 暗色模式（D1 补完）：系统工具 ================= */
html[data-theme='dark'] {
  /* dt-result/ex-row 已走 var(--mk-*) token，暗色由全局 token 覆盖 */
}
</style>
