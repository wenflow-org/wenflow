<template>
  <div class="mk-page mk-page--fill">
    <!-- 终端状态条（对齐 Users 布局：标题 + 统计 + spacer + 主操作） -->
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">执行日志</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ liveLogsTotal }} 条</span>
      <span v-if="logs.length" class="mk-status__meta">失败 {{ errCount }} · 成功率 {{ successRate }}%</span>
      <span v-if="logs.length" class="mk-status__meta mono" :title="'延迟分位（仅成功日志）：P50 = 中位耗时 · P99 = 99% 请求耗时'">耗时 P50 {{ latencyP50 }} · P99 {{ latencyP99 }}</span>
      <button
        v-if="testCount > 0"
        type="button"
        class="mk-status__meta-link"
        :class="{ 'mk-status__meta-link--on': testFilter !== '' }"
        :title="testFilter === 'only' ? '仅看测试 → 点击恢复全部' : testFilter === 'hide' ? '已排除测试 → 点击仅看测试' : '连通性/探活测试日志（模型接入页产生），点击排除 → 再点仅看 → 三态切换'"
        @click="cycleTestFilter"
      >
        测试 {{ testCount }}
      </button>
      <span v-if="isFiltered" class="mk-status__filter">
        {{ filterLabel }}
        <button type="button" class="mk-status__clear" @click="clearFilter">×</button>
      </span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" @click="exportJson">导出</button>
      </span>
    </div>

    <!-- 日志 / Trace 链路 tab 切换（Trace 为执行日志下钻视图） -->
    <div class="mk-pills el-tabs">
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': elTab === 'logs' }" @click="elTab = 'logs'">日志</button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': elTab === 'trace' }" @click="elTab = 'trace'">Trace 链路</button>
    </div>

    <!-- ===== Tab2: Trace 链路（嵌入 TraceWaterfall 组件） ===== -->
    <TraceWaterfall v-if="elTab === 'trace'" embedded />

    <!-- ===== Tab1: 日志流（默认） ===== -->
    <template v-if="elTab === 'logs'">
    <!-- 日志流 -->
    <!-- P0 修复：加载失败显示错误横幅 + 重试，不再伪装成「暂无日志」 -->
    <div v-if="liveLogsError" class="exec-error" role="alert">
      <span>{{ liveLogsError }}</span>
      <button type="button" @click="retryLiveLogs">重试</button>
    </div>
    <MockSkeletonTable v-else-if="(liveLoading || liveLogsLoading) && !logs.length" :cols="4" :rows="6" />
    <div v-else-if="filtered.length" class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <!-- 左侧筛选组（对齐 Users：pills + 搜索框） -->
        <div class="mk-filter">
          <div class="mk-pills">
            <button v-for="p in statusPills" :key="p.id" type="button" class="mk-pill" :class="{ 'mk-pill--active': statusFilter === p.id }" @click="statusFilter = statusFilter === p.id ? '' : p.id">{{ p.label }}</button>
          </div>
          <input v-model="keyword" class="mk-filter__input" placeholder="关键词搜索" @keydown.enter="applyServerQuery" />
          <input v-model="traceId" class="mk-filter__input" placeholder="traceId" @keydown.enter="applyServerQuery" />
        </div>
        <!-- 右侧：错误类别 / 自动刷新 / 高级 / 列设置（对齐 Users：切换控件 + 统计） -->
        <div class="mk-card__head-right">
          <span class="mk-card__meta" v-if="errorCategory">类别「{{ errorCategory }}」<button type="button" class="mk-link" @click="errorCategory = ''; applyServerQuery()">×</button></span>
          <label class="log-auto"><input type="checkbox" v-model="autoRefresh" /> 自动刷新</label>
          <span class="mk-card__meta">第 {{ liveLogsPage }} / {{ totalPagesOf(liveLogsTotal, liveLogsPageSize) }} 页</span>
          <button type="button" class="mk-link" :class="{ 'mk-link--active': advOpen }" @click="advOpen = !advOpen">高级</button>
          <div class="exec-cols">
            <button type="button" class="mk-link" :class="{ 'mk-link--active': colsOpen }" @click="colsOpen = !colsOpen" :aria-expanded="colsOpen">列</button>
            <div v-if="colsOpen" class="exec-cols__menu" @click.stop>
              <label v-for="c in colDefs" :key="c.key" class="exec-cols__item" :title="c.title">
                <input type="checkbox" :checked="!hiddenCols.has(c.key)" @change="toggleCol(c.key)" />
                <span>{{ c.label }}</span>
              </label>
              <button v-if="hiddenCols.size" type="button" class="exec-cols__reset" @click="hiddenCols = new Set()">恢复全部列</button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="advOpen" class="log-advpanel">
        <select v-model="agentFilter" class="mk-filter__select mono">
          <option value="">全部节点</option>
          <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
        </select>
        <input v-model="sessionId" class="mk-filter__input" placeholder="sessionId" @keydown.enter="applyServerQuery" />
        <select v-model="timeRange" class="mk-filter__select" @change="applyServerQuery">
          <option value="today">今天</option>
          <option value="yesterday">昨天</option>
          <option value="week">近 7 天</option>
          <option value="month">近 30 天</option>
          <option value="all">全部</option>
        </select>
        <label class="log-auto"><input type="checkbox" v-model="autoRefresh" /> 自动刷新</label>
      </div>
      <MockSkeletonTable v-if="(liveLoading || liveLogsLoading) && !logs.length" :cols="6" :rows="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <table class="mk-table mk-table--click mk-table--fixed exec-table">

          <colgroup>
            <col v-if="!hiddenCols.has('time')" style="width:var(--mk-col-time-full)">
            <col v-if="!hiddenCols.has('kind')" style="width:36px">
            <col v-if="!hiddenCols.has('agent')" style="width:120px">
            <col v-if="!hiddenCols.has('msg')" style="width:180px">
            <col v-if="!hiddenCols.has('model')" style="width:140px">
            <col v-if="!hiddenCols.has('tokens')" style="width:132px">
            <col v-if="!hiddenCols.has('dur')" style="width:52px">
            <col v-if="!hiddenCols.has('status')" style="width:56px">
            <col v-if="!hiddenCols.has('trace')" style="width:86px">
          </colgroup>
          <thead>
            <tr>
              <th v-if="!hiddenCols.has('time')">时间</th>
              <th v-if="!hiddenCols.has('kind')">类型</th>
              <th v-if="!hiddenCols.has('agent')">节点</th>
              <th v-if="!hiddenCols.has('msg')">调用</th>
              <th v-if="!hiddenCols.has('model')">模型</th>
              <th v-if="!hiddenCols.has('tokens')">输入 / 输出</th>
              <th v-if="!hiddenCols.has('dur')" class="right">耗时</th>
              <th v-if="!hiddenCols.has('status')">状态</th>
              <th v-if="!hiddenCols.has('trace')" class="right">Trace</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="log in shown" :key="log.id">
              <tr class="exec-row" :class="[`exec-row--${log.status}`, { 'exec-row--test': isTestLog(log), 'exec-row--open': openId === log.id }]" @click="openId = openId === log.id ? '' : log.id">
                <td v-if="!hiddenCols.has('time')"><span class="mono exec-time" :title="fmtFull(log.ts)">{{ fmtTime(log.ts) }}</span></td>
                <td v-if="!hiddenCols.has('kind')">
                  <span class="exec-kind-group">
                    <span class="mk-badge" :class="`mk-badge--${kindTone(log)}`">{{ kindText(log) }}</span>
                    <span v-if="isTestLog(log)" class="exec-test-tag" title="模型接入页的连通性/探活测试调用（system-canary）">测试</span>
                  </span>
                </td>
                <td v-if="!hiddenCols.has('agent')"><span class="mono exec-stage" :title="log.agent" @click.stop="openSkillDrawer(log.agent)">{{ log.stage }}</span></td>
                <td v-if="!hiddenCols.has('msg')">
                  <div class="exec-cell">
                    <div class="exec-cell__line">
                      <!-- 主行：错误行显示错误摘要（红）；成功行显示调用内容预览（prompt 提取），
                           无内容时弱化「执行完成」——避免与状态列"成功"重复占位（原恒显"执行完成"零信息量） -->
                      <strong v-if="log.status === 'err'" class="exec-title exec-title--err" :title="log.title || log.detail">{{ log.title || log.detail }}</strong>
                      <strong v-else-if="contentPreview(log)" class="exec-title exec-title--preview" :title="log.title">{{ contentPreview(log) }}</strong>
                      <strong v-else class="exec-title exec-title--ok" :title="log.title">{{ log.title }}</strong>
                    </div>
                    <div class="exec-cell__line exec-cell__sub">
                      <span v-if="log.errorCode" class="tline__errcode mono" :title="log.errorCode">{{ errorCodeLabel(log.errorCode) ?? `[${log.errorCategory || 'err'}] ${log.errorCode}` }}</span>
                      <span v-if="log.statusCode && log.statusCode >= 400" class="tline__http mono">HTTP {{ log.statusCode }}</span>
                      <span v-if="log.recoveredByRetry" class="tline__recovered">重试 {{ (log.attempts || 1) - 1 }} 次后成功</span>
                      <span v-if="promptOf(log)?.drift" class="tline__drift">{{ TERMS.driftRuntime }}</span>
                      <span v-if="log.sessionId" class="tline__session mono" :title="`按业务会话在链路中归组查看：${log.sessionId}`" @click.stop="showTrace(undefined, log.sessionId)">会话 {{ shortTrace(log.sessionId) }}</span>
                    </div>
                  </div>
                </td>
                <td v-if="!hiddenCols.has('model')"><span class="mono exec-model__name" :title="log.model || undefined">{{ log.model || '—' }}</span></td>
                <td v-if="!hiddenCols.has('tokens')"><span class="mono exec-tokens" :title="tokensTitle(log)">{{ tokensText(log) }}</span></td>
                <td v-if="!hiddenCols.has('dur')" class="right"><span class="mono exec-dur" :title="fmtMs(log.durationMs)">{{ fmtMs(log.durationMs) }}</span></td>
                <td v-if="!hiddenCols.has('status')"><span class="exec-status" :class="`exec-status--${log.status}`">{{ statusText[log.status] }}</span></td>
                <td v-if="!hiddenCols.has('trace')" class="right"><span class="mono exec-trace" :title="`${log.traceId} · 在链路中查看完整 Trace`" @click.stop="showTrace(log.traceId)">{{ shortTrace(log.traceId) }}</span></td>
              </tr>
              <tr v-if="openId === log.id" class="exec-detail">
                <td :colspan="visibleColCount">
                  <div class="exec-detail__box">
                    <div class="tline__payload-meta">
                      <span class="mono">trace {{ log.traceId }}</span>
                      <span class="exec-detail__links">
                        <button type="button" class="mk-link" @click.stop="showTrace(log.traceId)">在链路中查看完整 Trace →</button>
                        <button v-if="log.sessionId" type="button" class="mk-link" @click.stop="showTrace(undefined, log.sessionId)">按会话归组查看 →</button>
                      </span>
                    </div>
                    <!-- 摘要行：表格弱化列的完整值（类型/模型/输入输出），展开即看全不丢信息 -->
                    <div class="exec-detail__meta mono">
                      <span class="mk-badge" :class="`mk-badge--${kindTone(log)}`">{{ kindText(log) }}</span>
                      <span v-if="log.model" :title="log.model">{{ log.model }}</span>
                      <span v-if="log.promptTokens != null || log.completionTokens != null || promptOf(log)?.tokens" :title="tokensTitle(log)">{{ tokensText(log) }}</span>
                      <span v-if="log.errorCode" class="tline__errcode">{{ errorCodeLabel(log.errorCode) ?? log.errorCode }}</span>
                      <span v-if="log.statusCode && log.statusCode >= 400">HTTP {{ log.statusCode }}</span>
                    </div>
                    <p v-if="detailLoading === log.id" class="tline__none"><span class="mk-spinner" aria-hidden="true"></span> 拉取日志详情中…</p>
                      <template v-else-if="detailCache[log.id]">
                        <!-- 重试时间线：网关升级后的逐次尝试遥测 -->
                        <div v-if="detailCache[log.id].attempts.length" class="tline__section">
                          <span class="tline__label">调用时间线{{ detailCache[log.id].attemptCount > 1 ? ` · 已尝试 ${detailCache[log.id].attemptCount}/${detailCache[log.id].maxAttempts} 次` : '' }}</span>
                          <div class="tline-attempts">
                            <div v-for="(a, i) in detailCache[log.id].attempts" :key="i" class="tline-attempt" :class="{ 'tline-attempt--fail': !a.success, 'tline-attempt--retry': a.willRetry }">
                              <div class="tline-attempt__head">
                                <span class="tline-attempt__no">P#{{ a.promptAttemptNo }} · N#{{ a.transportAttemptNo }}</span>
                                <span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span>
                                <span v-if="a.willRetry" class="tline-attempt__retry">将在 {{ a.backoffMs ?? '—' }}ms 后自动重试</span>
                                <span class="tline-attempt__dur mono">{{ fmtMs(a.durationMs) }}</span>
                              </div>
                              <div class="tline-attempt__meta mono">
                                <span>{{ a.provider || 'provider?' }}</span>
                                <span>{{ a.model || 'model?' }}</span>
                                <span v-if="a.statusCode">HTTP {{ a.statusCode }}</span>
                                <span v-if="a.promptTokens != null">P {{ a.promptTokens }} / C {{ a.completionTokens ?? 0 }}</span>
                                <span v-if="a.ttftMs != null" :title="'TTFT（首字节）'">TTFT {{ a.ttftMs }}ms</span>
                                <span v-if="a.promptCacheHitTokens" class="tline-attempt__cache" :title="'DeepSeek 自动前缀缓存命中'">缓存 {{ a.promptCacheHitTokens }} token</span>
                                <span v-if="a.routeSource">路由 {{ a.routeSource }}</span>
                                <span v-if="a.endpointHost">{{ a.endpointHost }}</span>
                              </div>
                              <p v-if="a.errorMessage" class="tline-attempt__err">{{ a.errorCode ? `${errorCodeLabel(a.errorCode) ?? a.errorCode} · ` : '' }}{{ a.errorMessage }}</p>
                            </div>
                          </div>
                        </div>
                        <div v-if="detailCache[log.id].error" class="tline__section">
                          <span class="tline__label tline__label--err">错误</span>
                          <pre>{{ detailCache[log.id].error }}</pre>
                        </div>
                        <div v-if="log.gatewayDurMs" class="tline__section">
                          <span class="tline__label">网关合并</span>
                          <p class="tline__none">{{ fmtMs(log.gatewayDurMs) }}（同一调用链的 api-gateway 记录，已合并展示）</p>
                        </div>
                        <div v-if="detailCache[log.id].input" class="tline__section">
                          <span class="tline__label">输入</span>
                          <pre>{{ detailCache[log.id].input }}</pre>
                        </div>
                        <div v-if="detailCache[log.id].output" class="tline__section">
                          <span class="tline__label">输出</span>
                          <pre>{{ detailCache[log.id].output }}</pre>
                        </div>
                        <!-- Prompt 契约维度（prompt_call_logs，同 traceId 关联） -->
                        <div v-if="promptOf(log)" class="tline__section tline__prompt">
                          <span class="tline__label">Prompt 契约</span>
                          <div class="tline__prompt-meta mono">
                            <span>版本 v{{ promptOf(log)!.version || '—' }}</span>
                            <span v-if="promptOf(log)!.drift" class="tline__prompt-drift">{{ TERMS.driftRuntime }}</span>
                            <span v-if="promptOf(log)!.tokens">{{ promptOf(log)!.tokens }}</span>
                            <span v-if="promptOf(log)!.errorCode">{{ errorCodeLabel(promptOf(log)!.errorCode) ?? `[${promptOf(log)!.errorCode}]` }} {{ promptOf(log)!.errorMessage }}</span>
                          </div>
                          <pre v-if="promptOf(log)!.userPayload">{{ promptOf(log)!.userPayload }}</pre>
                          <pre v-if="promptOf(log)!.rawModelOutput">{{ promptOf(log)!.rawModelOutput }}</pre>
                          <pre v-if="promptOf(log)!.extractedJson">{{ promptOf(log)!.extractedJson }}</pre>
                          <pre v-if="promptOf(log)!.normalizedOutput">{{ promptOf(log)!.normalizedOutput }}</pre>
                        </div>
                        <p v-if="detailFailed[log.id]" class="tline__none tline__none--err">详情拉取失败，请稍后重试</p>
                        <p v-else-if="!detailCache[log.id].attempts.length && !detailCache[log.id].error && !detailCache[log.id].input && !detailCache[log.id].output" class="tline__none">无 payload 记录</p>
                      </template>
                      <p v-else class="tline__none">详情不可用</p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <Pagination v-model:page="currentPage" v-model:pageSize="currentPageSize" :total="liveLogsTotal" :loading="liveLogsLoading" />
    </div>

    <div v-else class="mk-empty">
      <strong v-if="traceMiss">未找到「{{ traceMiss }}」的日志（可能超出保留期或 ID 不完整）</strong>
      <strong v-else>{{ isFiltered ? '当前筛选无日志' : '暂无日志' }}</strong>
      <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { intent, openSkillDrawer, clearInvestigation, dataSource } from './store'
import { fetchLogDetail, reloadLiveSpans, liveLoading, liveLogsLoading, liveLogsError, liveLogsTotal, liveLogsPage, liveLogsPageSize, liveLogStats, livePromptIndex, liveLogsFiltered, loadPromptIndex, totalPagesOf, type LogDetail, type PromptMetaRow, type SpanQuery } from './live'
import { useSafePolling } from '@/composables/useSafePolling'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import TraceWaterfall from './TraceWaterfall.vue'
import { TERMS, errorCodeLabel } from './terms'

/* 日志 / Trace 链路 tab（Trace 为执行日志下钻视图） */
const elTab = ref<'logs' | 'trace'>('logs')
/** 切到 Trace tab 并让瀑布聚焦指定链路/会话（openTrace/openSession 深链接入） */
function showTrace(traceId?: string, sessionId?: string) {
  elTab.value = 'trace'
  if (sessionId) intent.sessionId = sessionId
  else if (traceId) intent.traceId = traceId
}
/* 深链：openTrace/openSession 设置 intent.traceFocus 后导航到本页 → 自动切 Trace tab */
watch(
  () => intent.traceFocus,
  (focus) => {
    if (focus) {
      intent.traceFocus = false
      elTab.value = 'trace'
    }
  },
  { immediate: true }
)

const openId = ref('')
const statusFilter = ref('')
const agentFilter = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('week')
const keyword = ref('')
const traceId = ref('')
const sessionId = ref('')
const errorCategory = ref('')
const autoRefresh = ref(false)
const advOpen = ref(false)

/* D3 表格增强：列显隐（localStorage 持久化；9 列 → 勾选隐藏） */
const COLS_KEY = 'wf_exec_hidden_cols'
const colDefs = [
  { key: 'time', label: '时间', title: '记录时间（HH:mm:ss）' },
  { key: 'kind', label: '类型', title: '日志类型（执行/重试/告警）' },
  { key: 'agent', label: '节点', title: 'Skill 节点' },
  { key: 'msg', label: '调用', title: '调用内容与错误信息' },
  { key: 'model', label: '模型', title: '使用的 LLM 模型' },
  { key: 'tokens', label: '输入 / 输出', title: 'Token 用量（输入 / 输出）' },
  { key: 'dur', label: '耗时', title: '执行耗时' },
  { key: 'status', label: '状态', title: '执行状态' },
  { key: 'trace', label: 'Trace', title: '链路 ID（点击直达）' },
] as const
/* 次要列默认隐藏（收进展开区）：表格只留高频辨识列(时间/节点/调用/耗时/状态),
   窄屏无需滚动、信息不丢（点击行看全）。列设置可手动开启。 */
const DEFAULT_HIDDEN = ['kind', 'model', 'tokens', 'trace']
const colsOpen = ref(false)
const hiddenCols = ref<Set<string>>(new Set())
try {
  const raw = localStorage.getItem(COLS_KEY)
  // 首次访问(无记录)→ 新默认(次要列收进展开区);已有记录(含空数组=全显示)→ 尊重用户配置
  if (raw == null) hiddenCols.value = new Set(DEFAULT_HIDDEN)
  else {
    const saved = JSON.parse(raw) as unknown
    if (Array.isArray(saved)) hiddenCols.value = new Set(saved.filter((x): x is string => typeof x === 'string'))
  }
} catch { /* 隐私模式忽略 */ }
watch(hiddenCols, (s) => {
  try { localStorage.setItem(COLS_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}, { deep: true })
function toggleCol(key: string) {
  const next = new Set(hiddenCols.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hiddenCols.value = next
}
const visibleColCount = computed(() => colDefs.length - hiddenCols.value.size)

/* prompt 契约维度：与执行日志同 traceId 关联（版本/漂移/tokens/JSON） */
onMounted(() => {
  void loadPromptIndex()
  // 首屏必须触发服务端查询：liveLogsFiltered 只有 applyServerQuery 一个写入点，
  // 不查则页面永远空列表（后端有数据也显示「暂无日志」）
  void applyServerQuery()
})
watch(dataSource, () => {
  void loadPromptIndex()
  void applyServerQuery()
})
function promptOf(log: { traceId: string; agent: string }): PromptMetaRow | undefined {
  const list = livePromptIndex.value[log.traceId]
  if (!list?.length) return undefined
  const agentId = `skill:${log.agent}`
  return list.find((p) => p.agentId === agentId || p.agentId.replace(/^skill:/, '') === log.agent)
}

/* 成功调用的内容预览（消息列主行）：从契约层提取输出摘要，
   让列表行有信息量而非恒显「执行完成」（与状态列冗余）。
   优先级：extractedJson 的键列表 > normalizedOutput 摘要 > userPayload 摘要；均无则空（回落弱化「执行完成」）。 */
function contentPreview(log: { traceId: string; agent: string }): string {
  const p = promptOf(log)
  if (!p) return ''
  const json = p.extractedJson?.trim()
  if (json) {
    const keys = json.slice(0, 400).match(/"([^"]{1,24})"\s*:/g)
    if (keys?.length) return keys.slice(0, 3).map((k) => k.replace(/["\s:]/g, '')).join(' · ')
  }
  const out = p.normalizedOutput?.trim() || p.userPayload?.trim()
  if (out) {
    const oneLine = out.replace(/\s+/g, ' ').trim()
    return oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine
  }
  return ''
}

/* Tokens 列语义（P2）：传输层（agent_call_logs.promptTokens/completionTokens）优先——
   有真实用量展示实际值；无 token 数据的行显示「未统计」（区别于 0，工具提示说明数据来源与含义） */
type TokenRow = { traceId: string; agent: string; promptTokens?: number | null; completionTokens?: number | null }
function tokensText(log: TokenRow): string {
  if (log.promptTokens != null || log.completionTokens != null) {
    return `输入 ${log.promptTokens ?? 0} · 输出 ${log.completionTokens ?? 0}`
  }
  const p = promptOf(log)
  return p?.tokens || '未统计'
}
function tokensTitle(log: TokenRow): string {
  if (log.promptTokens != null || log.completionTokens != null) {
    return `输入 ${log.promptTokens ?? 0} / 输出 ${log.completionTokens ?? 0} token（agent_call_logs 传输层统计）`
  }
  const p = promptOf(log)
  if (p?.tokens) return `${p.tokens}（prompt_call_logs 契约层统计）`
  return '该日志未记录 token 用量（无传输层与契约层数据）'
}

/* live 模式：服务端筛选（时间范围/关键词/状态/节点/traceId/sessionId/错误类别）。
   reloadLiveSpans 写入独立的 liveLogsFiltered（不污染全局 liveSpans）；
   并发与 last-wins 由 live.ts 串行化保证（loading 反馈见 liveLogsLoading） */
function currentQuery(): SpanQuery {
  const status = statusFilter.value === 'err' ? 'error' : statusFilter.value === 'warn' ? 'timeout' : statusFilter.value === 'ok' ? 'success' : undefined
  return {
    timeRange: timeRange.value,
    keyword: keyword.value.trim() || undefined,
    status,
    agentId: agentFilter.value || undefined,
    traceId: traceId.value.trim() || undefined,
    sessionId: sessionId.value.trim() || undefined,
    errorCategory: errorCategory.value || undefined
  }
}

async function applyServerQuery() {
  /* 筛选/搜索/traceId/sessionId 直达/每页条数等变化：回第 1 页（传统分页语义） */
  await reloadLiveSpans(currentQuery())
}

/** 自动刷新：保留当前页码重查（区别于筛选变化回第 1 页） */
function refreshLivePage() {
  return reloadLiveSpans(currentQuery(), liveLogsPage.value)
}

/* 传统分页：页码器 v-model 桥接。翻页 = reloadLiveSpans(page) 整页替换 + 滚动回顶；
   每页条数变更 = 回第 1 页 + 按新 pageSize 重查 */
const currentPage = computed({
  get: () => liveLogsPage.value,
  set: (p: number) => {
    void goPage(p)
  }
})
const currentPageSize = computed({
  get: () => liveLogsPageSize.value,
  set: (s: number) => {
    if (s === liveLogsPageSize.value) return
    liveLogsPageSize.value = s
    void reloadLiveSpans(currentQuery())
  }
})
async function goPage(p: number) {
  if (p < 1 || p === liveLogsPage.value) return
  await reloadLiveSpans(currentQuery(), p)
  /* 翻页替换列表后滚动回顶部（列表长于视口时保持位置感） */
  window.scrollTo(0, 0)
}

/* P0 分页正确性：状态/节点过滤上移服务端（status/agentId 参数，API 已支持），
   消除「本地过滤 × 服务端分页」组合缺陷（旧实现下第 2 页整页被滤掉时，
   「加载更多」空转无感知变化） */
watch([statusFilter, agentFilter], () => {
  void applyServerQuery()
})

/* P0 修复：错误横幅重试 */
function retryLiveLogs() {
  void applyServerQuery()
}

/* 自动刷新：setTimeout 链 + 并发守卫 + 指数退避 */
const { start: startAutoRefresh, stop: stopAutoRefresh } = useSafePolling(
  () => refreshLivePage(),
  {
    interval: 10000,
    maxBackoff: 60000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
  }
)
watch(autoRefresh, (on) => {
  if (on) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
})

/* 导出当前筛选结果为 JSON */
function exportJson() {
  const blob = new Blob([JSON.stringify(filtered.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `execution-logs-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* live 模式：展开行时拉真实 input/output + 重试时间线 */
const DETAIL_CACHE_MAX = 50
const detailCache = ref<Record<string, LogDetail>>({})
const detailLoading = ref('')
/** 详情拉取失败标记（与「无 payload 记录」区分） */
const detailFailed = ref<Record<string, boolean>>({})

/** 简单 LRU：插入新条目，超过上限时淘汰最早插入的条目 */
function setDetail(id: string, d: LogDetail) {
  const next = { ...detailCache.value, [id]: d }
  const keys = Object.keys(next)
  if (keys.length > DETAIL_CACHE_MAX) {
    for (const k of keys.slice(0, keys.length - DETAIL_CACHE_MAX)) delete next[k]
  }
  detailCache.value = next
}

watch(openId, async (id) => {
  if (!id || detailCache.value[id]) return
  detailLoading.value = id
  try {
    const d = await fetchLogDetail(id)
    setDetail(id, d)
    const f = { ...detailFailed.value }
    delete f[id]
    detailFailed.value = f
  } catch {
    setDetail(id, { attempts: [], attemptCount: 0, maxAttempts: 1 })
    detailFailed.value = { ...detailFailed.value, [id]: true }
  } finally {
    if (detailLoading.value === id) detailLoading.value = ''
  }
})

// 从排查意图进入时应用过滤（含失败归因跳转的错误类别与时间范围）
watch(
  () => [intent.agentFilter, intent.statusFilter, intent.errorCategory, intent.timeRange],
  () => {
    agentFilter.value = intent.agentFilter
    statusFilter.value = intent.statusFilter
    if (intent.errorCategory) errorCategory.value = intent.errorCategory
    const TR = ['today', 'yesterday', 'week', 'month', 'all'] as const
    if ((TR as readonly string[]).includes(intent.timeRange)) timeRange.value = intent.timeRange as typeof timeRange.value
  },
  { immediate: true }
)

const logs = computed(() => liveLogsFiltered.value)
const agentOptions = computed(() => [...new Set(logs.value.map((s) => s.agent))].sort())

/** 连通性/探活测试日志识别：sourceEntry = system-canary（模型接入页探活 + 测试连接产生） */
const isTestLog = (l: { sourceEntry?: string }) => l.sourceEntry === 'system-canary'
/** 测试日志筛选：'' = 全部 / hide = 排除测试 / only = 仅看测试 */
const testFilter = ref<'hide' | '' | 'only'>('')

const filtered = computed(() =>
  logs.value.filter((l) => {
    if (testFilter.value === 'hide' && isTestLog(l)) return false
    if (testFilter.value === 'only' && !isTestLog(l)) return false
    if (agentFilter.value && l.agent !== agentFilter.value) return false
    if (statusFilter.value && l.status !== statusFilter.value) return false
    return true
  })
)

const shown = computed(() => filtered.value)

/* 口径与 AuditLogs 一致：时间范围非默认值也计入筛选态，空态才显示「当前筛选无日志」而非「暂无日志」 */
const isFiltered = computed(() => !!(testFilter.value || agentFilter.value || statusFilter.value || keyword.value.trim() || traceId.value.trim() || sessionId.value.trim() || errorCategory.value || timeRange.value !== 'week'))
/* traceId/sessionId 服务端查询未命中时的空态提示（与 TraceWaterfall 的 wf-notice「样本截断」兜底互补：
   此处是服务端精确查询的直接未命中） */
const traceMiss = computed(() => {
  if (filtered.value.length) return ''
  if (traceId.value.trim()) return `traceId ${traceId.value.trim()}`
  if (sessionId.value.trim()) return `sessionId ${sessionId.value.trim()}`
  return ''
})
/* 全量统计来自后端 stats（非 200 行样本） */
const liveStats = computed(() => liveLogStats.value)
const errCount = computed(() =>
  liveStats.value ? liveStats.value.error : logs.value.filter((l) => l.status === 'err').length
)
const successRate = computed(() => {
  const st = liveStats.value
  if (st) return st.total ? Math.round((st.success / st.total) * 100) : '—'
  if (!logs.value.length) return '—'
  const ok = logs.value.filter((l) => l.status === 'ok').length
  return Math.round((ok / logs.value.length) * 100)
})

/* B3 观测深度：延迟分位（P50/P99，仅成功日志；对标 Langfuse 观测台核心指标）。
   用后端 stats（含 latencyPercentiles 时优先），否则样本计算 */
const latencyP50 = computed(() => {
  const st = liveStats.value
  if (st && st.latencyPercentiles?.p50 != null) return fmtMs(st.latencyPercentiles.p50)
  return percentileOf(logs.value.filter((l) => l.status === 'ok').map((l) => l.durationMs), 0.5)
})
const latencyP99 = computed(() => {
  const st = liveStats.value
  if (st && st.latencyPercentiles?.p99 != null) return fmtMs(st.latencyPercentiles.p99)
  return percentileOf(logs.value.filter((l) => l.status === 'ok').map((l) => l.durationMs), 0.99)
})
function percentileOf(durations: number[], q: number): string {
  const arr = durations.filter((d) => typeof d === 'number' && d >= 0).sort((a, b) => a - b)
  if (!arr.length) return '—'
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * q)))
  return fmtMs(arr[idx])
}
const statusTone = computed(() => (!logs.value.length ? 'muted' : errCount.value ? 'bad' : 'ok'))
/** 测试日志计数（当前服务端窗口内的 system-canary 行） */
const testCount = computed(() => logs.value.filter((l) => isTestLog(l)).length)
/** 测试筛选三态循环：全部 → 排除测试 → 仅看测试 → 全部 */
function cycleTestFilter() {
  testFilter.value = testFilter.value === '' ? 'hide' : testFilter.value === 'hide' ? 'only' : ''
  void applyServerQuery()
}
/* 排查徽章：读本地筛选（修复此前读 intent 导致的空值）；live 下补充关键词/时间范围/trace/会话 */
const timeRangeLabels = { today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部' } as const
const filterLabel = computed(() =>
  [
    timeRange.value !== 'week' ? timeRangeLabels[timeRange.value] : '',
    testFilter.value === 'hide' ? '排除测试' : testFilter.value === 'only' ? '仅看测试' : '',
    agentFilter.value || '',
    statusFilter.value === 'err' ? '仅失败' : statusFilter.value === 'warn' ? '仅超时' : statusFilter.value === 'ok' ? '仅成功' : '',
    errorCategory.value ? `类别「${errorCategory.value}」` : '',
    keyword.value.trim() ? `关键词「${keyword.value.trim()}」` : '',
    traceId.value.trim() ? `trace「${traceId.value.trim()}」` : '',
    sessionId.value.trim() ? `会话「${sessionId.value.trim()}」` : ''
  ]
    .filter(Boolean)
    .join(' · ')
)

const statusPills = [
  { id: 'err', label: '失败' },
  { id: 'warn', label: '超时' },
  { id: 'ok', label: '成功' }
]

function clearFilter() {
  testFilter.value = ''
  agentFilter.value = ''
  statusFilter.value = ''
  keyword.value = ''
  traceId.value = ''
  sessionId.value = ''
  errorCategory.value = ''
  timeRange.value = 'week' // 时间范围计入 isFiltered 口径，清除时需一并还原
  clearInvestigation()
  /* 服务端筛选下必须重查：仅清本地值不会刷新列表（traceId/sessionId 不在 watch 内，
     避免输入即查询；状态/节点变化由 watch 触发，此处兜底全清场景） */
  void applyServerQuery()
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
/* 绝对时间：统一 MM-DD HH:MM:SS（日志可能跨天，全部带日期避免同一列表两种格式；
   年/完整时区由 tooltip fmtFull 提供） */
function fmtTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function shortTrace(id: string): string {
  const m = id.match(/^(\w{2}):?([\w-]+)$/)
  if (!m) return id.slice(0, 12)
  const body = m[2] || id
  return body.length > 14 ? `${m[1]}:…${body.slice(-6)}` : id
}
/* 绝对时间 tooltip：YYYY-MM-DD HH:MM:SS（与审计页同格式）；ts 为 epoch 毫秒 */
function fmtFull(ts?: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
/* 类型列：按执行层（api-gateway→网关 / skill→Skill） */
function kindText(log: { kind: 'flow' | 'call'; execLayer?: string }): string {
  if (log.kind === 'flow') return '流程'
  if (log.execLayer === 'skill') return 'Skill'
  if (log.execLayer === 'api-gateway') return '网关'
  return '调用'
}
function kindTone(log: { kind: 'flow' | 'call'; execLayer?: string }): string {
  if (log.kind === 'flow') return 'flow'
  if (log.execLayer === 'skill') return 'skill'
  return 'call'
}
/* 状态列文本（旧 statusBadge 语义：成功/超时/失败） */
const statusText = { ok: '成功', warn: '超时', err: '失败' } as const
</script>

<style scoped>
/* 全宽布局（与其他管理台页面一致）：9 列固定宽度，宽屏下剩余空间由各列按比例均摊，
   空白分散到每一列而不是堆在消息列（fixed table-layout 规范行为） */
/* 状态条走全局 mk-status 体系；此处仅扩展终端页专属的筛选徽章类 */

.mk-status__filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: var(--mk-fs-12);
  font-weight: 700;
}
.mk-status__clear {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: var(--mk-fs-13);
  padding: 0 2px;
}

.log-advpanel {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 2px;
  animation: log-adv-in 0.15s ease;
}
@keyframes log-adv-in {
  from { opacity: 0; transform: translateY(-3px); }
}
.log-auto {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
}

/* P0 修复：执行日志加载失败横幅（对齐 ts-error 规范） */
.exec-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: #c0454a;
  font-size: var(--mk-fs-13);
  font-weight: 600;
}
.exec-error button {
  border: 1px solid rgba(239, 117, 120, 0.4);
  background: transparent;
  color: #c0454a;
  border-radius: 8px;
  padding: 4px 12px;
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.exec-error button:hover {
  background: rgba(239, 117, 120, 0.12);
}

/* 表头与列表布局见下方 exec-* 区块 */

/* ========== 5 列表格（mk-table 布局）：时间 / 调用 / 模型·Tokens / 耗时 / Trace ==========
   列宽设计（内容区 1180px、1440 视口）：
   - 时间：--mk-col-time-full（110px）等宽 HH:MM:SS，跨天 MM-DD HH:MM 不截断
   - 调用：width auto 吸收剩余空间（≈650px），主行标题 ellipsis
   - 模型 / Tokens：--excl-model 176px（模型名 116 + 用量 P/C 60），两行堆叠
   - 耗时：--excl-dur 84px（"123.4ms" 7ch 右对齐）
   - Trace：--excl-trace 116px（"gw:…8y4tm4" 11ch 右对齐） */
.exec-table { }
.exec-table th.right,
.exec-table td.right { text-align: right; }
.exec-table thead th { white-space: nowrap; }
/* 行高压缩：表头/单元格收窄，双行消息列整体更紧凑 */
.exec-table th { padding: 8px 12px; }
.exec-table td { padding: 5px 12px; }

.exec-row--err { background: rgba(220, 38, 38, 0.05); }
.exec-row--open { background: #f6f9ff; }
/* 连通性/探活测试行：弱化（降饱和降透明度），保留可读但不再与业务日志抢眼 */
.exec-row--test { opacity: 0.62; }
.exec-row--test:hover { opacity: 0.85; }
.exec-row--test.exec-row--open { opacity: 0.9; }
.exec-kind-group { display: inline-flex; align-items: center; gap: 5px; }
/* 测试标签：灰底小徽章（与类型徽章并排，业务日志不出现） */
.exec-test-tag {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--mk-line, #e6ebf4);
  color: var(--mk-muted, #5b6577);
  white-space: nowrap;
}
html[data-theme='dark'] .exec-test-tag { background: #2a3850; color: #8fa3bd; }
.exec-cell { min-width: 0; }
.exec-cell__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.exec-cell__line + .exec-cell__line { margin-top: 1px; }
/* 消息主行：标题截断不换行（title 全值）；14px/650 让"执行完成"这类 4 字短标题
   在消息列内具有足够视觉权重，抵消列内余白 */
.exec-title {
  font-size: var(--mk-fs-14);
  font-weight: 650;
  min-width: 0;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 消息列语义变体：错误摘要(红) / 内容预览(灰蓝) / 成功弱化——告别恒显「执行完成」与状态列重复 */
.exec-title--err { color: var(--mk-red, #dc2626); font-weight: 700; }
.exec-title--err:hover { text-decoration: underline; }
.exec-title--preview { color: var(--mk-muted, #5b6577); font-weight: 600; }
.exec-title--ok { color: var(--mk-faint, #5f6f8c); font-weight: 500; }
.exec-cell__sub { flex-wrap: wrap; gap: 5px; }
/* 节点列：等宽短名，长名 ellipsis（title 全值，点击开 Skill 抽屉）。
   display:inline-block 必须显式声明——span 为 inline 元素时 max-width/overflow/ellipsis 全部失效，
   长节点名会溢出节点列侵入消息列（实测 46 字符节点名溢出 132px 与标题重叠） */
.exec-stage {
  display: inline-block;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-blue);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.exec-stage:hover { text-decoration: underline; }
/* 模型 / Tokens 独立列：单行截断（同为 inline span，需 inline-block 让截断生效） */
.exec-model__name {
  display: inline-block;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.exec-tokens {
  display: inline-block;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* 状态列徽章（成功/超时/失败） */
.exec-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.exec-status--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.exec-status--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.exec-status--err { background: var(--mk-red-bg); color: var(--mk-red); }
/* 时间/耗时/Trace 等宽数字列 */
.exec-time {
  font-size: var(--mk-fs-12_5);
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.exec-dur {
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.exec-trace {
  font-size: var(--mk-fs-12_5);
  color: var(--mk-faint);
  white-space: nowrap;
  cursor: pointer;
}
.exec-trace:hover { color: var(--mk-amber); text-decoration: underline; }

/* 展开详情行（colspan=5）：浅底 + 内容盒内聚，干扰最小化 */
.exec-detail td { padding: 6px 14px 14px; background: #fbfcfe; vertical-align: top; }
html[data-theme='dark'] .exec-detail td { background: #101826; }
.exec-detail__box {
  display: grid;
  gap: 8px;
  padding: 10px 14px;
  border-left: 3px solid var(--mk-line);
  border-radius: 0 8px 8px 0;
  background: var(--mk-surface);
}
.exec-detail__links { display: inline-flex; gap: 12px; }
/* 展开区摘要行：次要列完整值(类型/模型/输入输出/错误码)，与 trace 行同层级 */
.exec-detail__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 0 2px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-12);
}
.exec-detail__meta > span { white-space: nowrap; }

/* 窄屏自适应：min-width 只保证默认 5 列(时间/节点/调用/耗时/状态)在窄容器内不塌陷 ≈620px;
   用户开启全部 9 列时由列定宽自然撑超(≈962px),容器横向滚动(AntD Table 标准行为)。
   原 min-width:962px 在 5 列默认下也硬撑导致 1080px 视口多余滚动。 */
.mk-table-scroll .exec-table { min-width: 620px; }

/* ---------- 行内 chip（沿用） ---------- */
.tline__errcode {
  flex-shrink: 0;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.tline__http {
  flex-shrink: 0;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: #dc2626;
  white-space: nowrap;
}
.tline__recovered {
  flex-shrink: 0;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-amber);
  white-space: nowrap;
}
.tline__drift {
  flex-shrink: 0;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-amber);
  background: rgba(217, 119, 6, 0.1);
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.tline__session { font-size: var(--mk-fs-12_5); color: var(--mk-blue, #2c63d0); cursor: pointer; }
.tline__session:hover { text-decoration: underline; }
/* Prompt 契约展开区 */
.tline__prompt { border-left: 3px solid rgba(217, 119, 6, 0.4); padding-left: 10px; }
.tline__prompt-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: var(--mk-fs-11); color: var(--mk-faint); }
.tline__prompt-drift { color: var(--mk-amber); font-weight: 700; }

.exec-detail__box pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tline__payload-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.tline__none { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-faint); }
.tline__none--err { color: var(--mk-red); font-weight: 600; }
.tline__section { display: grid; gap: 4px; }
.tline__label { font-size: var(--mk-fs-11); font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }
.tline__label--err { color: var(--mk-red); }

/* 重试时间线 */
.tline-attempts { display: grid; gap: 6px; }
.tline-attempt {
  border: 1px solid var(--mk-line);
  border-left: 3px solid var(--mk-green);
  border-radius: 8px;
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  background: var(--mk-surface);
}
.tline-attempt--fail { border-left-color: var(--mk-red); background: var(--mk-surface); }
html[data-theme='dark'] .tline-attempt--fail { background: rgba(220, 38, 38, 0.08); }
.tline-attempt--retry { border-left-color: var(--mk-amber); }
.tline-attempt__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tline-attempt__no { font-family: var(--mk-mono); font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-muted); }
.tline-attempt__retry { font-size: var(--mk-fs-11); font-weight: 700; color: var(--mk-amber); }
.tline-attempt__cache { font-weight: 700; color: var(--mk-green, #15803d); }
.tline-attempt__dur { margin-left: auto; font-size: var(--mk-fs-11); color: var(--mk-faint); }
.tline-attempt__meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: var(--mk-fs-11); color: var(--mk-faint); }
.tline-attempt__err { margin: 0; font-size: var(--mk-fs-11); color: var(--mk-red); word-break: break-all; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3，高度换算回逻辑坐标） ========== */
@media (min-width: 2000px) {
  .log-auto { font-size: 13px; }
  .mk-status__filter { font-size: 13px; }
  .mk-status__clear { font-size: 14.5px; }
  /* 列宽：时间列由 shared.css 4K token 覆盖（--mk-col-time-full），固定列 4K 档字号放大 */
  .exec-time,
  .exec-dur,
  .exec-trace,
  .exec-stage,
  .exec-model__name { font-size: 13px; }
  .exec-title { font-size: 15px; }
  .exec-tokens,
  .exec-status { font-size: 13px; }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift { font-size: 12px; }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: 13px; }
  .tline__none,
  .tline__label { font-size: 13px; }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: 12px; }
  .tline-attempt__err { font-size: 13px; }
  .exec-detail__box pre { font-size: 13px; }
  .tline-attempt__no { font-size: 12px; }
  .tline-attempt__meta { font-size: 11.5px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000px 档 */
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：字号继续放大 */
  .log-auto { font-size: 15.5px; }
  .mk-status__filter { font-size: 15.5px; }
  .mk-status__clear { font-size: 17px; }
  .exec-table { }
  .exec-time,
  .exec-dur,
  .exec-trace,
  .exec-stage,
  .exec-model__name { font-size: 15.5px; }
  .exec-title { font-size: 17.5px; }
  .exec-tokens,
  .exec-status { font-size: 14px; }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift { font-size: 14px; }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: 15.5px; }
  .tline__none,
  .tline__label { font-size: 15.5px; }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: 14px; }
  .tline-attempt__err { font-size: 15.5px; }
  .exec-detail__box pre { font-size: 15.5px; }
  .tline-attempt__no { font-size: 14px; }
  .tline-attempt__meta { font-size: 13.5px; }
}

/* ================= 暗色模式（D1 补完）：执行日志终端页 ================= */
html[data-theme='dark'] {
  .log-status { background: #141c2b; border-color: #232f45; }
  .exec-row--open { background: #1b2740; }
  .exec-detail td { background: #131b2a; }
  .exec-detail__box { background: #0f1624; border-color: #232f45; }
  .exec-detail__box pre { color: #c6d4ea; }
  .tline { background: #131b2a; border-color: #232f45; }
  .tline-attempt { background: #17202f; border-color: #232f45; }
  .tline-attempt--fail { background: #241a1a; border-left-color: var(--mk-red); }
  .exec-error { background: rgba(248, 113, 113, 0.14); border-color: rgba(248, 113, 113, 0.35); color: #fca5a5; }
  .exec-cols__menu { background: #17202f; border-color: #232f45; }
  .exec-cols__item:hover { background: #1f2b40; }
}

/* ================= D3 表格增强：列设置菜单 ================= */
.exec-cols { position: relative; display: inline-flex; }
.exec-cols__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: var(--mk-z-menu);
  min-width: 150px;
  padding: 6px;
  display: grid;
  gap: 2px;
  background: var(--mk-surface, #fff);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-pop);
}
.exec-cols__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.exec-cols__item:hover { background: #f0f5ff; }
html[data-theme='dark'] .exec-cols__item:hover { background: #1f2b40; }
.exec-cols__item input { accent-color: var(--mk-blue, #2c63d0); }
.exec-cols__reset {
  margin-top: 4px;
  border: 0;
  background: transparent;
  padding: 6px 8px;
  border-radius: 7px;
  border-top: 1px dashed var(--mk-line);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-blue);
  cursor: pointer;
  text-align: left;
}
.exec-cols__reset:hover { background: #eff6ff; }
html[data-theme='dark'] .exec-cols__reset:hover { background: #1f2b40; }
</style>
