<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">运维中心</strong>
      <span class="mk-status__sep"></span>
      <span v-if="tab === 'tools'" class="mk-status__meta" :class="{ 'is-bad': deadCount > 0 }">outbox 死信 {{ deadCount }}</span>
      <span v-else class="mk-status__meta">CSV 下载 · UTF-8（Excel 可直接打开）</span>
      <span class="mk-pills" style="margin-left:auto">
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'tools' }" @click="switchTab('tools')">运维工具</button>
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'export' }" @click="switchTab('export')">数据导出</button>
      </span>
      <button v-if="tab === 'tools'" type="button" class="mk-status__action" :disabled="refreshing" @click="refreshAll">{{ refreshing ? '刷新中…' : '刷新' }}</button>
    </div>

    <!-- ===== Tab1: 运维工具 ===== -->
    <template v-if="tab === 'tools'">
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
        <div class="mk-card__head-right">
          <button type="button" class="mk-btn mk-btn--sm" :disabled="requeueBusy" @click="requeueAll">
            {{ requeueBusy ? '重放中…' : '重放全部死信' }}
          </button>
        </div>
      </div>
      <div v-if="deadLoading" class="dt-loading"><span class="mk-spinner"></span> 加载中…</div>
      <template v-else-if="deadItems.length">
        <div class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>用户</th>
                <th>聚合</th>
                <th class="mk-col--num">尝试</th>
                <th>错误</th>
                <th class="mk-col--time-full">发生时间</th>
                <th class="mk-col--actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in deadItems" :key="item.id">
                <td><span class="mono">{{ item.eventType }}</span></td>
                <td><span class="mono mk-cell-text">{{ shortId(item.userId || '—', 10, 4) }}</span></td>
                <td><span class="mono mk-cell-text">{{ shortId(item.aggregateId || '—', 10, 4) }}</span></td>
                <td class="mk-num">{{ item.attemptCount }}</td>
                <td><span class="dt-err" :title="item.lastError || ''">{{ item.lastError || '—' }}</span></td>
                <td :title="fmtDate(item.occurredAt)">{{ timeAgo(item.occurredAt) }}</td>
                <td>
                  <div class="mk-actions">
                    <button type="button" class="mk-link" :disabled="requeueBusy" @click="requeueOne(item.eventType)">重放该类</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mk-list-more">
          <span>最近 50 条 · 共 {{ deadCount }} 条死信</span>
          <button type="button" class="mk-link" @click="loadDead">重新加载</button>
        </div>
      </template>
      <div v-else-if="deadFailed" class="mk-empty mk-empty--compact">
        <strong>死信清单加载失败</strong>
        <button type="button" class="mk-empty__action" @click="loadDead">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--compact">
        <strong>没有死信事件</strong>
        <span>outbox 全部正常投递，worker 无积压。</span>
      </div>
    </section>
    </template>

    <!-- ===== Tab2: 数据导出 ===== -->
    <template v-else>
      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">业务数据</h4>
          <span class="mk-card__meta">导出前请确认数据范围</span>
        </div>
        <div class="ex-body">
          <div v-for="item in exports" :key="item.key" class="ex-row">
            <div class="ex-row__text">
              <strong>{{ item.label }}</strong>
              <span>{{ item.desc }}</span>
            </div>
            <button type="button" class="mk-btn mk-btn--sm" :disabled="exporting === item.key" @click="doExport(item.key)">
              {{ exporting === item.key ? '导出中…' : '导出 CSV' }}
            </button>
          </div>
        </div>
      </section>

      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">观测与审计</h4>
          <span class="mk-card__meta">执行日志与审计日志行数较多，导出前可选限制</span>
        </div>
        <div class="ex-body">
          <div v-for="item in auditExports" :key="item.key" class="ex-row">
            <div class="ex-row__text">
              <strong>{{ item.label }}</strong>
              <span>{{ item.desc }}</span>
            </div>
            <div class="ex-row__actions">
              <select v-model="limits[item.key]" class="mk-filter__select" :disabled="exporting === item.key">
                <option :value="1000">1000 行</option>
                <option :value="5000">5000 行</option>
                <option :value="20000">20000 行</option>
              </select>
              <button type="button" class="mk-btn mk-btn--sm" :disabled="exporting === item.key" @click="doExport(item.key)">
                {{ exporting === item.key ? '导出中…' : '导出 CSV' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">导出说明</h4>
        </div>
        <div class="ex-body ex-notes">
          <ul>
            <li>导出的 CSV 带 UTF-8 BOM，Excel / WPS 双击可直接打开，中文不乱码。</li>
            <li>执行日志默认导出最近 1000 条，可切换行数上限；其余业务表导出最近 20000 条。</li>
            <li>用户导出默认排除虚拟学习者与测试账号；如需全量请在后端接口加 includeTest=1。</li>
            <li>导出为只读操作，不产生审计记录；敏感字段（密码哈希、API Key）一律不包含。</li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { askConfirm } from './useConfirm'
import { adminDevtoolsApi, adminAxios } from '@/api/adminApi'
import { toast } from '@/utils/toast'

const tab = ref<'tools' | 'export'>('tools')
function switchTab(t: 'tools' | 'export') {
  tab.value = t
  if (t === 'tools' && !deadLoaded.value) void loadDead()
}

const refreshing = ref(false)
const advanceBusy = ref(false)
const requeueBusy = ref(false)

const statusTone = computed(() => (tab.value === 'tools' && deadCount.value > 0 ? 'mk-status--warn' : 'mk-status--ok'))

/* 时间推进 */
const advance = ref({ userId: '', days: 30, pathId: '' })
const advanceResult = ref<any>(null)

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
const deadCount = ref(0)
const deadItems = ref<any[]>([])
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
  await Promise.all([loadDead()])
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

/* ===== Tab2: 数据导出 ===== */
interface ExportDef {
  key: string
  label: string
  desc: string
  limit?: boolean
}

const exports: ExportDef[] = [
  { key: 'users', label: '用户', desc: '全部真实用户：ID / 姓名 / 邮箱 / 角色 / XP / 等级 / 注册与登录时间' },
  { key: 'teaching-sessions', label: '教学会话', desc: '会话：学科 / 主题 / 任务类型 / 模式 / 状态 / 时长 / 起止时间' },
  { key: 'feedback', label: '用户反馈', desc: '反馈：评分 / 难度 / 评论 / 处理状态 / 时间' },
  { key: 'goal-conversations', label: '目标对话', desc: '目标澄清：状态 / 阶段 / 描述 / 创建与更新时间' },
]

const auditExports: ExportDef[] = [
  { key: 'agent-logs', label: '执行日志', desc: 'Agent 调用：成功 / 耗时 / 错误码与分类 / 模型 / Token', limit: true },
  { key: 'audit-logs', label: '审计日志', desc: '管理操作审计：动作 / 目标 / 方法 / 路径 / 状态码 / IP', limit: true },
]

/* 默认值必须落在下拉选项集内（1000/5000/20000），否则 select 初始显示空白 */
const limits = reactive<Record<string, number>>({ 'agent-logs': 1000, 'audit-logs': 1000 })
const exporting = ref('')

async function doExport(key: string) {
  exporting.value = key
  try {
    const limit = limits[key]
    const params = limit ? `?limit=${limit}` : ''
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

void loadDead()
</script>

<style scoped>
.dt-body { padding: 14px; display: grid; gap: 14px; }
.dt-grid { display: grid; grid-template-columns: 1.6fr 0.7fr 1.4fr auto; gap: 12px; align-items: end; }
.dt-actions { display: grid; gap: 6px; }
.dt-result { border: 1px solid var(--mk-line); border-radius: 10px; overflow: hidden; }
.dt-result__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-bottom: 1px solid var(--mk-line);
  background: var(--mk-surface);
  font-size: 12.5px;
}
.dt-result__head strong { font-size: 13px; }
.dt-result__head .mono { color: var(--mk-muted); }
.dt-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.dt-compare__col { padding: 12px; min-width: 0; }
.dt-compare__col + .dt-compare__col { border-left: 1px dashed var(--mk-line); }
.dt-compare__col h5 { margin: 0 0 8px; font-size: 11px; font-weight: 700; color: var(--mk-faint); letter-spacing: 0.05em; }
.dt-compare__col pre {
  margin: 0;
  max-height: 300px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.6;
  color: var(--mk-muted);
  white-space: pre-wrap;
  word-break: break-all;
}

.dt-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 32px 0; color: var(--mk-muted); font-size: 13px; }
.dt-err {
  display: inline-block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--mk-red);
  font-size: 12px;
}

@media (min-width: 2000px) {
  .dt-grid { grid-template-columns: 1.6fr 0.7fr 1.4fr auto; }
  .dt-compare__col pre { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .dt-compare__col pre { font-size: 15px; }
  .ex-row__text strong { font-size: 16.5px; }
  .ex-row__text span { font-size: 15.5px; }
}
@media (min-width: 3600px) {
  .dt-compare__col pre { font-size: 17.5px; }
  .ex-row__text strong { font-size: 19.5px; }
  .ex-row__text span { font-size: 18px; }
}
@media (max-width: 1100px) {
  .dt-grid { grid-template-columns: 1fr 1fr; }
  .dt-compare { grid-template-columns: 1fr; }
  .dt-compare__col + .dt-compare__col { border-left: none; border-top: 1px dashed var(--mk-line); }
}

/* Tab2: 数据导出 */
.ex-body { padding: 8px 14px 12px; display: grid; gap: 2px; }
.ex-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--mk-line);
  flex-wrap: wrap;
}
.ex-row:last-child { border-bottom: none; }
.ex-row__text { display: grid; gap: 2px; min-width: 0; }
.ex-row__text strong { font-size: 13px; }
.ex-row__text span { font-size: 12px; color: var(--mk-muted); max-width: 640px; }
.ex-row__actions { display: flex; align-items: center; gap: 8px; }
.ex-row__actions .mk-filter__select { min-width: 110px; height: 30px; padding: 3px 8px; }
.ex-notes ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 12.5px; color: var(--mk-muted); }
@media (min-width: 2000px) {
  .ex-row__text strong { font-size: 14.5px; }
  .ex-row__text span { font-size: 13.5px; }
}

/* ================= 暗色模式（D1 补完）：运维中心 ================= */
html[data-theme='dark'] {
  /* dt-result/ex-row 已走 var(--mk-*) token，暗色由全局 token 覆盖 */
}
</style>
