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
        :title="testFilter === 'only' ? '仅看测试 → 点击恢复默认视图' : '连通性/探活测试日志（模型接入页产生，默认视图已排除），点击仅看测试'"
        @click="toggleTestFilter"
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

    <!-- 日志 / Trace 链路 / 成本分析 tab（Trace 为执行日志下钻视图；成本分析为同源观测并入） -->
    <div class="mk-pills">
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': elTab === 'logs' }" @click="switchElTab('logs')">日志</button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': elTab === 'trace' }" @click="switchElTab('trace')">Trace 链路</button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': elTab === 'cost' }" @click="switchElTab('cost')">成本分析</button>
    </div>

    <!-- ===== Tab2: Trace 链路（嵌入 TraceWaterfall 组件） ===== -->
    <TraceWaterfall v-if="elTab === 'trace'" embedded />

    <!-- ===== Tab3: 成本分析（嵌入 TokenCost 组件，观测同域并入 2026-09-04） ===== -->
    <template v-if="elTab === 'cost'">
      <!-- 成本金额条：读取 token-cost 端点新增的金额字段；单价未配置时显式提示「单价未配置」（绝不用 0 冒充） -->
      <div class="mk-card cost-strip" :class="{ 'cost-strip--unknown': !costPricingKnown }">
        <div class="cost-strip__main">
          <span class="cost-strip__label">调用成本（近 {{ tokenCostFilters.days }} 天{{ tokenCostFilters.includeTest ? ' · 含测试流量' : '' }}）</span>
          <strong v-if="costLoading" class="cost-strip__value">统计中…</strong>
          <strong v-else-if="costUsd !== null" class="cost-strip__value mono">≈ ${{ fmtCostUsd(costUsd) }}</strong>
          <strong v-else-if="costPricedCalls === 0 && costMissingCalls === 0" class="cost-strip__value cost-strip__value--unknown">无调用</strong>
          <strong v-else class="cost-strip__value cost-strip__value--unknown">单价未配置</strong>
          <span class="cost-strip__hint">
            <template v-if="costUsd !== null">
              已定价 {{ costPricedCalls }} 次<template v-if="costMissingCalls > 0"> · {{ costMissingCalls }} 次未定价（未计入）</template>
            </template>
            <template v-else-if="costPricedCalls === 0 && costMissingCalls === 0">近 {{ tokenCostFilters.days }} 天没有带 token 的 LLM 调用</template>
            <template v-else>models.config.ts 的 pricing 尚未填权威单价，暂不展示金额</template>
          </span>
        </div>
        <div v-if="missingPricingModels.length" class="cost-strip__missing" :title="missingPricingModels.join('、')">
          待补单价模型 {{ missingPricingModels.length }} 个：{{ missingPricingModels.join('、') }}
        </div>
      </div>
      <TokenCost embedded />
    </template>

    <!-- ===== Tab1: 日志流（默认） ===== -->
    <template v-if="elTab === 'logs'">
    <!-- 日志流 -->
    <!-- P0 修复：加载失败显示错误横幅 + 重试，不再伪装成「暂无日志」 -->
    <div v-if="liveLogsError" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">{{ liveLogsError }}</span>
      <button type="button" class="mk-alert__btn" @click="retryLiveLogs">重试</button>
    </div>
    <MockSkeletonTable v-else-if="(liveLoading || liveLogsLoading) && !logs.length" :cols="4" :rows="6" />
    <div v-else-if="filtered.length" class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <!-- 左侧筛选组（对齐 Users：pills + 搜索框） -->
        <div class="mk-filter">
          <div class="mk-pills">
            <button v-for="p in statusPills" :key="p.id" type="button" class="mk-pill" :class="{ 'mk-pill--active': statusFilter === p.id }" @click="statusFilter = statusFilter === p.id ? '' : p.id">{{ p.label }}<span v-if="p.count != null" class="mk-pill__count">{{ p.count }}</span></button>
          </div>
          <MkFilterSearch v-model="keyword" placeholder="关键词搜索" @keydown.enter="applyServerQuery" />
          <MkFilterSearch v-model="traceId" placeholder="Trace ID（链路 ID）" title="按调用链路 ID 精确查询：一次请求从进入到出结果的完整链路标识" @keydown.enter="applyServerQuery" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
          <!-- 保存视图：筛选组合命名存档（localStorage），pill 一键恢复 -->
          <SavedViewsBar
            :views="savedViews"
            :active-name="activeSavedViewName"
            :can-save="isFiltered"
            :suggest-name="filterLabel"
            :title-of="savedViewTitle"
            @apply="applySavedView"
            @remove="removeView"
            @save="onSaveView"
          />
        </div>
        <!-- 右侧：错误类别 / 自动刷新 / 高级 / 列设置（对齐 Users：切换控件 + 统计） -->
        <div class="mk-card__head-right">
          <span class="mk-card__meta" v-if="errorCategory">类别「{{ errorCategory }}」<button type="button" class="mk-link" @click="errorCategory = ''; applyServerQuery()">×</button></span>
          <label class="log-auto"><input type="checkbox" v-model="autoRefresh" /> 自动刷新</label>
          <button type="button" class="mk-link" :class="{ 'mk-link--active': advOpen }" @click="advOpen = !advOpen" title="高级筛选">高级</button>
          <MkCols :col-defs="colDefs" :storage-key="COLS_KEY" :default-hidden="DEFAULT_HIDDEN" v-model:hidden="hiddenCols" />
          <span class="mk-card__meta">第 {{ liveLogsPage }} / {{ totalPagesOf(liveLogsTotal, liveLogsPageSize) }} 页</span>
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
            <col v-if="!hiddenCols.has('agent')" style="width:var(--mk-col-model)">
            <!-- 调用文本：弹性吸收列（不设宽度） -->
            <col v-if="!hiddenCols.has('msg')" style="width:var(--mk-col-text)">
            <col v-if="!hiddenCols.has('model')" style="width:var(--mk-col-model-wide)">
            <col v-if="!hiddenCols.has('tokens')" style="width:var(--mk-col-num-wide)">
            <col v-if="!hiddenCols.has('dur')" style="width:var(--mk-col-num)">
            <col v-if="!hiddenCols.has('status')" style="width:var(--mk-col-badge)">
            <col v-if="!hiddenCols.has('trace')" style="width:86px">
          </colgroup>
          <thead>
            <tr>
              <th
                v-if="!hiddenCols.has('time')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="logSortState('calledAt')"
                @click="toggleLogSort('calledAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleLogSort('calledAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="!hiddenCols.has('kind')">类型</th>
              <th v-if="!hiddenCols.has('agent')">节点</th>
              <th v-if="!hiddenCols.has('msg')">调用</th>
              <th v-if="!hiddenCols.has('model')">模型</th>
              <th v-if="!hiddenCols.has('tokens')">输入 / 输出</th>
              <th
                v-if="!hiddenCols.has('dur')"
                scope="col"
                class="right mk-th--sortable"
                :aria-sort="logSortState('durationMs')"
                @click="toggleLogSort('durationMs')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleLogSort('durationMs')">耗时<span class="mk-th__caret" aria-hidden="true"></span></button></th>
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
                      <!-- 链路入口：图标按钮,一眼可见点击直达 Trace(替代隐藏的 Trace 列) -->
                      <button type="button" class="exec-trace-btn" title="查看完整调用链路（Trace）：这条调用从进入到出结果的全部阶段" @click.stop="showTrace(log.traceId)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7 6h7a3 3 0 0 1 3 3"/><path d="M7 18h7a3 3 0 0 0 3-3"/></svg>
                      </button>
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
                        <button type="button" class="mk-btn mk-btn--ghost mk-btn--sm" @click.stop="showTrace(log.traceId)">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7 6h7a3 3 0 0 1 3 3"/><path d="M7 18h7a3 3 0 0 0 3-3"/></svg>
                          查看完整调用链路
                        </button>
                        <button v-if="log.sessionId" type="button" class="mk-btn mk-btn--sm" @click.stop="showTrace(undefined, log.sessionId)">按会话归组查看</button>
                      </span>
                    </div>
                    <!-- 摘要行：表格弱化列的完整值（类型/模型/输入输出），展开即看全不丢信息 -->
                    <div class="exec-detail__meta mono">
                      <span class="mk-badge" :class="`mk-badge--${kindTone(log)}`">{{ kindText(log) }}</span>
                      <span v-if="detailCache[log.id]?.fallbackFrom" class="tline__recovered" :title="'主模型重试耗尽后自动降级换模型重跑'">已从 {{ detailCache[log.id]?.fallbackFrom }} 降级</span>
                      <span v-if="log.model" :title="log.model">{{ log.model }}</span>
                      <span v-if="log.promptTokens != null || log.completionTokens != null || promptOf(log)?.tokens" :title="tokensTitle(log)">{{ tokensText(log) }}</span>
                      <span v-if="log.errorCode" class="tline__errcode">{{ errorCodeLabel(log.errorCode) ?? log.errorCode }}</span>
                      <span v-if="log.statusCode && log.statusCode >= 400">HTTP {{ log.statusCode }}</span>
                    </div>
                    <MkLoading v-if="detailLoading === log.id" inline text="拉取日志详情中…" />
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
                                <span v-if="a.routeSource" :title="a.routeSource">路由 {{ routeSourceLabel(a.routeSource) ?? a.routeSource }}</span>
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
                        <p v-else-if="!detailCache[log.id].attempts.length && !detailCache[log.id].error && !detailCache[log.id].input && !detailCache[log.id].output" class="tline__none">无请求内容记录</p>
                      </template>
                      <div v-else class="tline__section">
                        <span class="tline__label tline__label--err">{{ detailFailed[log.id] ? '详情拉取失败' : '详情不可用' }}</span>
                        <button v-if="detailFailed[log.id]" type="button" class="mk-btn mk-btn--ghost mk-btn--sm" @click.stop="retryDetail(log.id)">重试拉取</button>
                      </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <Pagination v-model:page="currentPage" v-model:pageSize="currentPageSize" :total="liveLogsTotal" :loading="liveLogsLoading" />
    </div>

    <MkEmptyState
      v-else
      :title="traceMiss ? `未找到「${traceMiss}」的日志（可能超出保留期或 ID 不完整）` : isFiltered ? '当前筛选无日志' : '暂无日志'"
    >
      <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
    </MkEmptyState>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent, openSkillDrawer, clearInvestigation, dataSource, tokenCostFilters } from './store'
import { fetchLogDetail, reloadLiveSpans, liveLoading, liveLogsLoading, liveLogsError, liveLogsTotal, liveLogsPage, liveLogsPageSize, liveLogStats, livePromptIndex, liveLogsFiltered, loadPromptIndex, totalPagesOf, type LogDetail, type PromptMetaRow, type SpanQuery } from './live'
import { useSafePolling } from '@/composables/useSafePolling'
import MockSkeletonTable from './SkeletonTable.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import TraceWaterfall from './TraceWaterfall.vue'
import TokenCost from './TokenCost.vue'
import { adminTokenCostApi } from '@/api/adminApi'
import { TERMS, errorCodeLabel, routeSourceLabel } from './terms'
import { useTableSort } from './useTableSort'
import SavedViewsBar from './SavedViewsBar.vue'
import { useSavedViews, sameViewQuery, type SavedView } from './useSavedViews'

/* 日志 / Trace 链路 / 成本分析 tab（Trace 为执行日志下钻视图；成本分析为观测同域并入） */
const EL_TABS = ['logs', 'trace', 'cost'] as const
type ElTab = (typeof EL_TABS)[number]
const elTab = ref<ElTab>('logs')
const route = useRoute()
const router = useRouter()
/* URL ↔ tab 双向同步：?tab=logs|trace|cost（深链/刷新可寻址；合并宿主页统一约定） */
watch(
  () => route.query.tab,
  (t) => {
    const v = typeof t === 'string' && (EL_TABS as readonly string[]).includes(t) ? (t as ElTab) : null
    if (v && v !== elTab.value) elTab.value = v
    else if (!v && elTab.value !== 'logs') elTab.value = 'logs'
  },
  { immediate: true }
)
/** 切 tab（同步 ?tab= URL，深链/刷新可寻址） */
function switchElTab(t: ElTab) {
  elTab.value = t
  if (route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}

/* 成本金额条（成本 tab）：读取 token-cost 端点金额字段，口径跟随共享筛选
   （store.tokenCostFilters，与嵌入的 TokenCost 组件同一份状态，切换时间窗同步刷新）。
   单价未配置时后端返回 usd=null，这里显示「单价未配置」而非 0 / 空白；
   pricingStatus.missingPricingModels 给出运维补价清单。 */
const costLoading = ref(false)
const costLoaded = ref(false)
const costUsd = ref<number | null>(null)
const costPricingKnown = ref(false)
const costPricedCalls = ref(0)
const costMissingCalls = ref(0)
const missingPricingModels = ref<string[]>([])

function fmtCostUsd(v: number): string {
  if (!Number.isFinite(v) || v < 0) return '0.000000'
  return v.toFixed(6)
}

async function loadCostSummary() {
  if (costLoading.value) return
  costLoading.value = true
  try {
    const res = await adminTokenCostApi.getSummary({ days: tokenCostFilters.days, includeTest: tokenCostFilters.includeTest })
    const totals = res.data?.data?.totals ?? null
    costUsd.value = totals?.usd ?? null
    costPricingKnown.value = totals?.pricingKnown ?? false
    costPricedCalls.value = totals?.pricedCalls ?? 0
    costMissingCalls.value = totals?.callsMissingPricing ?? 0
    missingPricingModels.value = res.data?.pricingStatus?.missingPricingModels ?? []
    costLoaded.value = true
  } catch {
    // 金额条为辅助信息：失败静默（嵌入的 TokenCost 组件自身有加载失败提示/重试）
    costUsd.value = null
    costPricingKnown.value = false
  } finally {
    costLoading.value = false
  }
}
/* 进入成本 tab 时懒加载一次（深链 ?tab=cost 由 route watch 改写 elTab 后触发） */
watch(elTab, (t) => {
  if (t === 'cost' && !costLoaded.value) void loadCostSummary()
}, { immediate: true })
// 筛选变化（与 TokenCost 同源）→ 金额条失效；在成本 tab 上立即刷新，否则下次进入刷新
// （此前括号错位把本 watch 嵌进了 elTab 回调：每切一次 tab 泄漏注册一个 watcher）
watch(tokenCostFilters, () => {
  costLoaded.value = false
  if (elTab.value === 'cost') void loadCostSummary()
})
/** 切到 Trace tab 并让瀑布聚焦指定链路/会话（openTrace/openSession 深链接入） */
function showTrace(traceId?: string, sessionId?: string) {
  elTab.value = 'trace'
  if (sessionId) intent.sessionId = sessionId
  else if (traceId) intent.traceId = traceId
  if (route.query.tab !== 'trace') void router.replace({ query: { ...route.query, tab: 'trace' } })
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
/** 测试日志筛选（服务端参数）：'' = 默认（后端已排除测试）/ only = 仅看测试 */
const testFilter = ref<'only' | ''>('')
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
const hiddenCols = ref<Set<string>>(new Set())
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
    return `输入 ${log.promptTokens ?? 0} / 输出 ${log.completionTokens ?? 0} token（传输层统计）`
  }
  const p = promptOf(log)
  if (p?.tokens) return `${p.tokens}（调用内容统计）`
  return '该日志未记录 token 用量'
}

/* live 模式：服务端筛选（时间范围/关键词/状态/节点/traceId/sessionId/错误类别）。
   reloadLiveSpans 写入独立的 liveLogsFiltered（不污染全局 liveSpans）；
   并发与 last-wins 由 live.ts 串行化保证（loading 反馈见 liveLogsLoading） */
/* 服务端排序：复用 useTableSort 的状态/语义（排序在后端执行，不调用 sortRows）。
   默认时间倒序；点表头「时间 / 耗时」切换，变更后回第 1 页重查。
   只暴露列表自身列——token 列是网关行合并口径，不适合服务端排序。 */
const {
  sortKey: logSortKey,
  sortDir: logSortDir,
  toggle: toggleLogSort,
  sortState: logSortState
} = useTableSort({
  keys: ['calledAt', 'durationMs'],
  defaultKey: 'calledAt',
  defaultDir: 'desc',
  storageKey: 'wf_exec_logs_sort'
})

function currentQuery(): SpanQuery {
  const status = statusFilter.value === 'err' ? 'error' : statusFilter.value === 'warn' ? 'timeout' : statusFilter.value === 'ok' ? 'success' : undefined
  return {
    timeRange: timeRange.value,
    keyword: keyword.value.trim() || undefined,
    status,
    agentId: agentFilter.value || undefined,
    traceId: traceId.value.trim() || undefined,
    sessionId: sessionId.value.trim() || undefined,
    errorCategory: errorCategory.value || undefined,
    /* 测试日志筛选上移服务端（P0 分页正确性）：仅看测试 = sourceEntry=system-canary；
       默认/排除态不传该参数（后端默认视图已排除 canary），页码 total 与行数保持一致 */
    sourceEntry: testFilter.value === 'only' ? 'system-canary' : undefined,
    sort: (logSortKey.value || undefined) as SpanQuery['sort'],
    order: logSortDir.value
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

/* P0 分页正确性：状态/节点/测试过滤上移服务端（status/agentId/sourceEntry 参数，API 已支持），
   消除「本地过滤 × 服务端分页」组合缺陷（旧实现下第 2 页整页被滤掉时，
   「加载更多」空转无感知变化） */
watch([statusFilter, agentFilter, testFilter], () => {
  void applyServerQuery()
})

/* 服务端排序变化：与筛选同义，回第 1 页重查 */
watch([logSortKey, logSortDir], () => {
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

async function loadDetail(id: string) {
  if (detailCache.value[id]) return
  detailLoading.value = id
  try {
    const d = await fetchLogDetail(id)
    setDetail(id, d)
    const f = { ...detailFailed.value }
    delete f[id]
    detailFailed.value = f
  } catch {
    // 不写占位缓存:此前失败详情被空缓存占位后无法重试(仅 LRU 淘汰才能重拉)
    detailFailed.value = { ...detailFailed.value, [id]: true }
  } finally {
    if (detailLoading.value === id) detailLoading.value = ''
  }
}
function retryDetail(id: string) {
  detailFailed.value = { ...detailFailed.value, [id]: false }
  void loadDetail(id)
}
watch(openId, (id) => {
  if (id) void loadDetail(id)
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

/* —— 筛选 ↔ URL query 双向同步（P0 动线修复：总览「去排查」的故障视图刷新/分享不再丢失）——
   全量快照语义：agent/status/cat/range/q/trace/session/test，缺省参数 = 该项默认值。
   URL → 筛选（深链/刷新/前进后退）；筛选 → URL（replace，不压历史栈）。
   注册在 intent watch 之后：深链直达时 URL 权威（覆盖 intent 空值回写）；
   站内跳转时 AdminConsole 已把 intent 带进 query，两源一致不抖动。 */
const FILTER_QUERY_KEYS = ['agent', 'status', 'cat', 'range', 'q', 'trace', 'session', 'test'] as const
const EL_TIME_RANGES = ['today', 'yesterday', 'week', 'month', 'all'] as const
const queryVal = (v: unknown): string => (typeof v === 'string' ? v : '')
watch(
  () => FILTER_QUERY_KEYS.map((k) => route.query[k]),
  (vals) => {
    const [agent, status, cat, range, q, trace, session, test] = vals.map(queryVal)
    agentFilter.value = agent
    statusFilter.value = ['err', 'warn', 'ok'].includes(status) ? status : ''
    errorCategory.value = cat
    keyword.value = q
    traceId.value = trace
    sessionId.value = session
    timeRange.value = (EL_TIME_RANGES as readonly string[]).includes(range)
      ? (range as typeof timeRange.value)
      : 'week'
    testFilter.value = test === 'only' ? 'only' : ''
  },
  { immediate: true }
)
/** 当前筛选快照（仅含非默认值；键与 URL query 同名——保存视图与深链共用同一形状） */
function filterSnapshot(): Record<string, string> {
  const desired: Record<string, string> = {}
  if (agentFilter.value) desired.agent = agentFilter.value
  if (statusFilter.value) desired.status = statusFilter.value
  if (errorCategory.value) desired.cat = errorCategory.value
  if (timeRange.value !== 'week') desired.range = timeRange.value
  if (keyword.value.trim()) desired.q = keyword.value.trim()
  if (traceId.value.trim()) desired.trace = traceId.value.trim()
  if (sessionId.value.trim()) desired.session = sessionId.value.trim()
  if (testFilter.value) desired.test = testFilter.value
  return desired
}

watch(
  [statusFilter, agentFilter, timeRange, keyword, traceId, sessionId, errorCategory, testFilter],
  () => {
    const desired = filterSnapshot()
    const cur = route.query
    if (FILTER_QUERY_KEYS.every((k) => queryVal(cur[k]) === (desired[k] || ''))) return
    const next = { ...cur }
    for (const k of FILTER_QUERY_KEYS) delete next[k]
    Object.assign(next, desired)
    void router.replace({ query: next })
  },
  { immediate: true }
)

/* —— 保存视图：筛选组合命名存档（localStorage），pill 一键恢复 —— */
const { views: savedViews, save: saveViewToStore, remove: removeView } = useSavedViews('wf_exec_saved_views')

/** 快照可读摘要（pill 悬停说明），与 filterLabel 同一套措辞 */
function describeQuery(q: Record<string, string>): string {
  const parts: string[] = []
  if (q.range) parts.push(timeRangeLabels[q.range as keyof typeof timeRangeLabels] || q.range)
  if (q.test === 'only') parts.push('仅看测试')
  if (q.agent) parts.push(q.agent)
  if (q.status === 'err') parts.push('仅失败')
  else if (q.status === 'warn') parts.push('仅超时')
  else if (q.status === 'ok') parts.push('仅成功')
  if (q.cat) parts.push(`类别「${q.cat}」`)
  if (q.q) parts.push(`关键词「${q.q}」`)
  if (q.trace) parts.push(`trace「${q.trace}」`)
  if (q.session) parts.push(`会话「${q.session}」`)
  return parts.join(' · ') || '默认筛选'
}
function savedViewTitle(v: SavedView): string {
  return `${describeQuery(v.query)}（点击应用 · × 删除）`
}

/** 应用保存视图：整体重写筛选 refs 后服务端重查（URL 同步 watch 会随之回写 ?query） */
function applySavedView(v: SavedView) {
  const q = v.query || {}
  agentFilter.value = q.agent || ''
  statusFilter.value = ['err', 'warn', 'ok'].includes(q.status) ? q.status : ''
  errorCategory.value = q.cat || ''
  keyword.value = q.q || ''
  traceId.value = q.trace || ''
  sessionId.value = q.session || ''
  timeRange.value = (EL_TIME_RANGES as readonly string[]).includes(q.range)
    ? (q.range as typeof timeRange.value)
    : 'week'
  testFilter.value = q.test === 'only' ? 'only' : ''
  /* keyword/trace/session 等输入项不在 watch 内（输入即查询防抖动），需显式重查 */
  void applyServerQuery()
}

/** 当前筛选恰好命中的保存视图名（高亮该 pill；默认视图不高亮） */
const activeSavedViewName = computed(() => {
  const snap = filterSnapshot()
  if (!Object.keys(snap).length) return ''
  return savedViews.value.find((v) => sameViewQuery(v.query, snap))?.name || ''
})

function onSaveView(name: string) {
  saveViewToStore(name, filterSnapshot())
}

const logs = computed(() => liveLogsFiltered.value)
const agentOptions = computed(() => [...new Set(logs.value.map((s) => s.agent))].sort())

/** 连通性/探活测试日志识别：sourceEntry = system-canary（模型接入页探活 + 测试连接产生） */
const isTestLog = (l: { sourceEntry?: string }) => l.sourceEntry === 'system-canary'
/* testFilter 声明在上方筛选 ref 区（需早于 requery watch 引用）。
   旧三态的「排除测试」与默认视图语义重合（后端默认排除 canary），已并入默认态 */

/* P0 分页正确性：测试日志筛选随查询上移服务端（sourceEntry 参数），
   与 status/agentId 同批修复「本地过滤 × 服务端分页」组合缺陷——
   旧实现在当前页行上过滤，第 2 页可能整页被滤空而页码器仍显示可达 */
const filtered = computed(() =>
  logs.value.filter((l) => {
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
/** 测试日志计数：默认态读后端 stats.canary（默认视图已排除 canary，行内数不到）；
    仅看测试态 = 该查询的 total（口径即测试行数） */
const testCount = computed(() => {
  if (testFilter.value === 'only') return liveLogsTotal.value
  return liveStats.value?.canary ?? 0
})
/** 测试筛选两态切换：默认（已排除测试）→ 仅看测试 → 默认 */
function toggleTestFilter() {
  testFilter.value = testFilter.value === '' ? 'only' : ''
  void applyServerQuery()
}
/* 排查徽章：读本地筛选（修复此前读 intent 导致的空值）；live 下补充关键词/时间范围/trace/会话 */
const timeRangeLabels = { today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部' } as const
const filterLabel = computed(() =>
  [
    timeRange.value !== 'week' ? timeRangeLabels[timeRange.value] : '',
    testFilter.value === 'only' ? '仅看测试' : '',
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

const statusPills = computed(() => {
  const st = liveStats.value
  return [
    { id: 'err', label: '失败', count: st?.error },
    { id: 'warn', label: '超时', count: st?.timeout },
    { id: 'ok', label: '成功', count: st?.success }
  ]
})

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
/* 状态条筛选徽章 / 清除按钮已提升为全局 .mk-status__filter / .mk-status__clear（见 shared.css） */

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
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
}

/* 加载失败横幅：外形走 .mk-alert--row（shared.css），已不再需要本页私有样式 */

/* 表头与列表布局见下方 exec-* 区块 */

/* ========== 5 列表格（mk-table 布局）：时间 / 调用 / 模型·Tokens / 耗时 / Trace ==========
   列宽设计（内容区 1180px、1440 视口）：
   - 时间：--mk-col-time-full（110px）等宽 HH:MM:SS，跨天 MM-DD HH:MM 不截断
   - 调用：width auto 吸收剩余空间（≈650px），主行标题 ellipsis
   - 模型 / Tokens：--excl-model 176px（模型名 116 + 用量 P/C 60），两行堆叠
   - 耗时：--excl-dur 84px（"123.4ms" 7ch 右对齐）
   - Trace：--excl-trace 116px（"gw:…8y4tm4" 11ch 右对齐）
   视觉基调与审计日志对齐（2026-09）：主体统一 12.5px、行 padding 6px 13px、
   失败行不再整行红底（错误语义交给红标题 + 状态 pill），整体更清爽易扫。 */
.exec-table { }
.exec-table th.right,
.exec-table td.right { text-align: right; }
.exec-table thead th { white-space: nowrap; }
/* 行高对齐审计日志节奏（2026-09 统一：td 8px 13px ≈ 43px 行高）：
   双行消息列因副行略高，但主行 12.5px 后整体与审计页同密度 */
.exec-table th { padding: 8px 13px; }
.exec-table td { padding: 8px 13px; }

.exec-row--open { background: #f6f9ff; }
/* 连通性/探活测试行：弱化（降饱和降透明度），保留可读但不再与业务日志抢眼 */
.exec-row--test { opacity: 0.62; }
.exec-row--test:hover { opacity: 0.85; }
.exec-row--test.exec-row--open { opacity: 0.9; }
.exec-kind-group { display: inline-flex; align-items: center; gap: 5px; }
/* 类型徽章（流程/Skill/网关/调用）：中性浅灰 pill，与审计动作 chip 同风格——低调可读不抢色 */
.exec-kind-group .mk-badge {
  background: #f0f2f5;
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  padding: 1px 7px;
}
html[data-theme='dark'] .exec-kind-group .mk-badge { background: #2d2d2f; color: #a2a5a9; }
/* 测试标签：灰底小徽章（与类型徽章并排，业务日志不出现） */
.exec-test-tag {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--mk-line, #e6ebf4);
  color: var(--mk-muted, #5b6577);
  white-space: nowrap;
}
html[data-theme='dark'] .exec-test-tag { background: #313235; color: #a2a5a9; }
.exec-cell { min-width: 0; }
.exec-cell__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.exec-cell__line + .exec-cell__line { margin-top: 1px; }
/* 消息主行：标题截断不换行（title 全值）；12.5px 与审计日志主体同字号，
   用字重/颜色表达语义差异（红=错误摘要，灰蓝=内容预览，弱化=成功），
   不再用更大字号抢视觉——整表更清爽、可扫性更强 */
.exec-title {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  min-width: 0;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 消息列语义变体：错误摘要(红) / 内容预览(灰蓝) / 成功弱化——告别恒显「执行完成」与状态列重复 */
.exec-title--err { color: var(--mk-red, #dc2626); font-weight: 650; }
.exec-title--err:hover { text-decoration: underline; }
.exec-title--preview { color: var(--mk-muted, #5b6577); font-weight: 550; }
.exec-title--ok { color: var(--mk-faint, #5f6f8c); font-weight: 500; }
/* 链路入口图标按钮：主行右侧,常显弱化/hover 高亮,点击直达 Trace(替代隐藏的 Trace 列)
   2026-09-24 桌面端验收：22px 低于鼠标可点下限，抬到 24px */
.exec-trace-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mk-faint);
  cursor: pointer;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.exec-trace-btn svg { width: 15px; height: 15px; }
.exec-trace-btn:hover { background: var(--mk-blue-bg, #eff6ff); color: var(--mk-blue, #2c63d0); }
.exec-cell__sub { flex-wrap: wrap; gap: 5px; }
/* 节点列：等宽短名，长名 ellipsis（title 全值，点击开 Skill 抽屉）。
   display:inline-block 必须显式声明——span 为 inline 元素时 max-width/overflow/ellipsis 全部失效，
   长节点名会溢出节点列侵入消息列（实测 46 字符节点名溢出 132px 与标题重叠） */
.exec-stage {
  display: inline-block;
  font-size: var(--mk-fs-micro);
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
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.exec-tokens {
  display: inline-block;
  font-size: var(--mk-fs-micro);
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
  font-size: var(--mk-fs-micro);
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
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.exec-dur {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.exec-trace {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  cursor: pointer;
}
.exec-trace:hover { color: var(--mk-amber); text-decoration: underline; }

/* 展开详情行（colspan=5）：浅底 + 内容盒内聚，干扰最小化 */
.exec-detail td { padding: 6px 14px 14px; background: #fbfcfe; vertical-align: top; }
html[data-theme='dark'] .exec-detail td { background: #161718; }
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
  font-size: var(--mk-fs-micro);
}
.exec-detail__meta .mk-badge {
  background: #f0f2f5;
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  padding: 1px 7px;
}
html[data-theme='dark'] .exec-detail__meta .mk-badge { background: #2d2d2f; color: #a2a5a9; }
.exec-detail__meta > span { white-space: nowrap; }

/* 窄屏自适应：min-width 只保证默认 5 列(时间/节点/调用/耗时/状态)在窄容器内不塌陷 ≈620px;
   用户开启全部 9 列时由列定宽自然撑超(≈962px),容器横向滚动(AntD Table 标准行为)。
   原 min-width:962px 在 5 列默认下也硬撑导致 1080px 视口多余滚动。 */
.mk-table-scroll .exec-table { min-width: 620px; }

/* ---------- 行内 chip（沿用；2026-09 降噪：与主行字号差从 3px 收窄到 ~1px，
   错误码红底 chip 改为轻红文字——错误语义由红标题与状态 pill 承担，副行只作元数据） ---------- */
.tline__errcode {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-red, #dc2626);
  white-space: nowrap;
}
.tline__http {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-red, #dc2626);
  white-space: nowrap;
}
.tline__recovered {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-amber);
  white-space: nowrap;
}
.tline__drift {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-amber);
  white-space: nowrap;
}
.tline__session { font-size: var(--mk-fs-micro); color: var(--mk-blue, #2c63d0); cursor: pointer; }
.tline__session:hover { text-decoration: underline; }
/* Prompt 契约展开区 */
.tline__prompt { border-left: 3px solid rgba(217, 119, 6, 0.4); padding-left: 10px; }
.tline__prompt-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
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
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.tline__none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.tline__none--err { color: var(--mk-red); font-weight: 600; }
.tline__section { display: grid; gap: 4px; }
.tline__label { font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }
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
.tline-attempt__no { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-muted); }
.tline-attempt__retry { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-amber); }
.tline-attempt__cache { font-weight: 700; color: var(--mk-green, #15803d); }
.tline-attempt__dur { margin-left: auto; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.tline-attempt__meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.tline-attempt__err { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-red); word-break: break-all; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3，高度换算回逻辑坐标） ========== */
@media (min-width: 2000px) {
  .log-auto { font-size: var(--mk-fs-micro); }
  .mk-status__filter { font-size: var(--mk-fs-micro); }
  .mk-status__clear { font-size: var(--mk-fs-body); }
  /* 列宽：时间列由 shared.css 4K token 覆盖（--mk-col-time-full），固定列 4K 档字号放大 */
  .exec-time,
  .exec-dur,
  .exec-trace,
  .exec-stage,
  .exec-model__name { font-size: var(--mk-fs-micro); }
  .exec-title { font-size: var(--mk-fs-body); }
  .exec-tokens,
  .exec-status { font-size: var(--mk-fs-micro); }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift { font-size: var(--mk-fs-micro); }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: var(--mk-fs-micro); }
  .tline__none,
  .tline__label { font-size: var(--mk-fs-micro); }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: var(--mk-fs-micro); }
  .tline-attempt__err { font-size: var(--mk-fs-micro); }
  .exec-detail__box pre { font-size: var(--mk-fs-micro); }
  .tline-attempt__no { font-size: var(--mk-fs-micro); }
  .tline-attempt__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000px 档 */
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：字号继续放大 */
  .log-auto { font-size: var(--mk-fs-micro); }
  .mk-status__filter { font-size: var(--mk-fs-micro); }
  .mk-status__clear { font-size: var(--mk-fs-body); }
  .exec-table { }
  .exec-time,
  .exec-dur,
  .exec-trace,
  .exec-stage,
  .exec-model__name { font-size: var(--mk-fs-micro); }
  .exec-title { font-size: var(--mk-fs-body); }
  .exec-tokens,
  .exec-status { font-size: var(--mk-fs-micro); }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift { font-size: var(--mk-fs-micro); }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: var(--mk-fs-micro); }
  .tline__none,
  .tline__label { font-size: var(--mk-fs-micro); }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: var(--mk-fs-micro); }
  .tline-attempt__err { font-size: var(--mk-fs-micro); }
  .exec-detail__box pre { font-size: var(--mk-fs-micro); }
  .tline-attempt__no { font-size: var(--mk-fs-micro); }
  .tline-attempt__meta { font-size: var(--mk-fs-micro); }
}

/* ================= 暗色模式（D1 补完）：执行日志终端页 ================= */
html[data-theme='dark'] {

  .exec-row--open { background: #252627; }
  .exec-detail td { background: #19191a; }
  .exec-detail__box { background: #141415; border-color: #2a2b2d; }
  .exec-detail__box pre { color: var(--mk-pre-fg); }
  .tline { background: #19191a; border-color: #2a2b2d; }
  .tline-attempt { background: #1b1c1d; border-color: #2a2b2d; }
  .tline-attempt--fail { background: #241a1a; border-left-color: var(--mk-red); }


}

/* ================= D3 表格增强：列设置菜单 ================= */









/* ================= 成本金额条（成本 tab 顶部） ================= */
.cost-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 14px;
}
.cost-strip__main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.cost-strip__label { color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); font-weight: 600; }
.cost-strip__value { font-size: var(--mk-fs-18); font-weight: 750; color: var(--mk-green, #16a34a); font-variant-numeric: tabular-nums; }
.cost-strip__value--unknown { color: var(--mk-amber, #d97706); }
.cost-strip__hint { color: var(--mk-faint, #5f6f8c); font-size: var(--mk-fs-micro); }
.cost-strip__missing {
  margin-left: auto;
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mk-amber, #d97706);
  font-size: var(--mk-fs-micro);
}
.cost-strip--unknown { border-left: 3px solid var(--mk-amber, #d97706); }

</style>
