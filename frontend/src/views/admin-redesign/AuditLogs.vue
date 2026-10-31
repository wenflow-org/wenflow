<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名随 tab（审计日志/登录审计）+ 导出/刷新上移。
         2026-10-27 用户「这里还有很多 pill，可以加上 KPI 面板」：失败 TOP 胶囊行退役，
         页头之下补 4 卡 KPI 带（记录总数 / 失败记录 / 失败率 / 失败动作）。 -->
    <MkPageHead title="审计日志">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" @click="goExport">导出</button>
      </template>
    </MkPageHead>

    <!-- KPI 带（2026-10-27 用户「这里还有很多 pill，可以加上 KPI 面板」）：
         原「失败 25 + 各失败动作」常驻胶囊行改成读数面板。计数只在这里出现一次，
         失败下钻收敛为两条入口——「失败记录」卡（一键只看失败）与「失败动作」下拉
         （按动作下钻，选项自带次数）；卡头不再挂一排动作胶囊。
         2026-10-27 用户「kpi 和 tab 位置反了」：KPI 是页面级读数，放在页签之上；
         页签下才是筛选头与表体。 -->
    <section class="mk-kpi-grid" aria-label="审计日志统计" :aria-busy="statsLoading || undefined">
      <MkKpi
        label="记录总数"
        :value="statsLoading ? '—' : total"
      />
      <MkKpi
        clickable
        label="失败记录"
        :value="statsLoading || statsError ? '—' : failedCount"
        :tone="failedCount && !statsError ? 'bad' : ''"
        :class="{ 'al-kpi--on': failedOnly }"
        :aria-pressed="failedOnly"
        @click="toggleFailureOnly"
      />
      <MkKpi
        label="失败率"
        :value="statsLoading || statsError ? '—' : failedRate"
        :tone="failedCount && !statsError ? 'bad' : ''"
      />
      <MkKpi
        v-if="tab === 'operation'"
        label="失败动作"
        :value="statsLoading || statsError ? '—' : failureByAction.length"
      />
    </section>

    <!-- 视图切换（2026-10-14 用户评审，与执行日志同批：此前贴在表格卡顶、通栏一条下划线，读起来像
         表格的表头）：移到页面级槽位——明细卡之上；卡片顶部回归「筛选头 + 表头」。页签为原型 .tabs
         下划线页签：12px/600、激活蓝字+2px 蓝下划线（2026-10-01 由 mk-pills 胶囊迁入） -->
    <!-- 键盘契约（审核 #154）：role=tablist/tab 兑现 roving tabindex + 左右方向键循环切换，
         每枚页签 aria-controls 到对应 role=tabpanel 的内容容器（判例 HealthCenter.vue:104-119） -->
    <div class="tabs" role="tablist" aria-label="审计视图切换" @keydown="onTabKeydown">
      <button
        v-for="(t, i) in tabs"
        :key="t.id"
        :id="`al-tab-${t.id}`"
        :ref="(el) => setTabRef(el, i)"
        type="button"
        role="tab"
        class="tab"
        :aria-selected="tab === t.id"
        :aria-controls="`al-panel-${t.id}`"
        :tabindex="tab === t.id ? 0 : -1"
        @click="switchTab(t.id)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 单卡容器（原型 renderAudit：筛选头 + 页签体同卡）：操作审计 / 登录审计两个页签体共用一张卡
         （页签已提到页面级，卡内只留筛选头与表体） -->
    <div class="mk-card mk-card--fill">
      <!-- 筛选卡片头（关键词 / 时间范围 / 列） -->
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 时间范围常驻可操作，默认「全部」：默认「今天」时首屏是空态，会被读成「没有异常」 -->
          <MkPillSelect
            v-model="timeRange"
            label="时间范围"
            aria-label="时间范围"
            :options="timeRangeOptions"
            :active="timeRange !== 'all'"
            @update:model-value="applyFilters"
          />
          <!-- 动作快筛（2026-10-27 从「筛选」弹层提到主栏）：Carbon 的筛选模式禁止把类别
               收进菜单/下拉——这里原本是一个只装单项的弹层，收起后只剩数字角标。选项仍是
               当前页动作聚合（口径如实写在「全部动作」之后），下钻走 keyword 搜索。 -->
          <MkPillSelect
            v-if="tab === 'operation'"
            :model-value="activeActionValue"
            label="动作"
            aria-label="按动作筛选"
            :options="actionSelectOptions"
            :active="!!activeActionValue"
            @update:model-value="applyActionFilter"
          />
          <!-- 失败动作下钻（2026-10-27）：替代原先「失败 N + 每个动作一枚胶囊」的常驻行。
               计数只随选项出现；空选项在失败域里读作「全部失败」，不在失败域时读作「不过滤」。 -->
          <MkPillSelect
            v-if="tab === 'operation' && failureByAction.length"
            :model-value="failedAction"
            label="失败动作"
            aria-label="按失败动作筛选"
            :options="failureSelectOptions"
            :active="failedOnly && !!failedAction"
            @update:model-value="applyFailureFilter"
          />
          <!-- 失败 TOP 常驻主行：先看到「最近什么在失败」，再点 chip 下钻 -->
          <div v-if="statsError" class="mk-alert mk-alert--row al-stats-error" role="alert">
            <span class="mk-alert__msg">失败统计不可用</span>
            <button type="button" class="mk-alert__btn" :disabled="statsLoading" @click="fetchStats">{{ statsLoading ? '重试中…' : '重试' }}</button>
          </div>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch
            v-model="keyword"
            :placeholder="tab === 'login' ? '用户名 / IP' : '关键词'"
            @keydown.enter="applyFilters"
          />
          <!-- 列设置仅操作审计页签有效（登录表 6 列为固定列，不读 colVisible）；
               在登录页签隐藏，避免出现「勾选无效却写 localStorage 的隐式副作用」 -->
          <MkCols v-if="tab === 'operation'" :col-defs="alColDefs" :storage-key="AL_COLS_KEY" v-model:hidden="hiddenCols" />
        </div>
      </div>

    <!-- 加载失败错误态 + 重试（role=tabpanel：页签关联，审核 #154） -->
    <MkEmptyState
      v-if="loadError"
      :id="panelId"
      role="tabpanel"
      :aria-labelledby="tabId"
      tone="error"
      title="审计日志加载失败"
      :description="loadError"
      action-text="重试"
      compact
      @action="applyFilters"
    />

    <!-- 加载中骨架 -->
    <!-- 登录表 6 列（时间/用户名/IP/结果/原因/操作），骨架列数与真实表头对齐 -->
    <MockSkeletonTable v-else-if="loading && !rows.length" :id="panelId" role="tabpanel" :aria-labelledby="tabId" :cols="tab === 'login' ? 6 : 7" :rows="6" />

    <!-- 操作审计列表：<template> 使 .mk-table-scroll 与 <Pagination> 成为 .mk-card--fill 的直接
         子元素（不再被 .log-body 多包一层）——表格区 flex:1 接管纵向滚动、表头 sticky 锚在真正的
         滚动体上，分页器随卡片吸底。与 ExecLogs.vue:157/356 同判例。 -->
    <template v-else-if="tab === 'operation' && logs.length">
      <div ref="scrollEl" :id="panelId" role="tabpanel" :aria-labelledby="tabId" class="mk-table-scroll">
        <!-- 固定列宽（2026-10-22 与教学组三表同判例）：动作 / 目标两列在 auto 布局下按当页最长
             内容分宽（动作 262→303px、目标 171→100px），翻页整表跳动；改 fixed + 逐列表头宽度。
             列随 colVisible 增删，固定宽度只作用于当前可见列，隐藏列不参与分配。 -->
        <table class="mk-table mk-table--click mk-table--fixed al-table">
          <thead>
            <tr>
              <th
                v-if="colVisible('time')"
                scope="col"
                class="mk-th--sortable al-c-time"
                :aria-sort="alSortState('createdAt')"
                @click="toggleAlSort('createdAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('createdAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="colVisible('admin')" scope="col" class="al-c-admin">操作者</th>
              <th v-if="colVisible('action')" scope="col" class="al-c-action">动作</th>
              <th v-if="!noTargetTypes && colVisible('tt')" scope="col" class="al-c-tt">目标类型</th>
              <th v-if="colVisible('target')" scope="col" class="al-c-target">目标</th>
              <th
                v-if="colVisible('result')"
                scope="col"
                class="mk-th--sortable al-c-result"
                :aria-sort="alSortState('success')"
                @click="toggleAlSort('success')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('success')">结果<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="colVisible('ip')" scope="col" class="al-c-ip">IP</th>
              <th class="mk-th--right al-c-expand" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="log in logs" :key="log.id">
              <tr
                class="log-tr"
                :class="[log.success ? 'log-tr--ok' : 'log-tr--err', { 'log-tr--open': openId === log.id }]"
                :aria-expanded="openId === log.id"
                :aria-controls="`audit-payload-${log.id}`"
                tabindex="0"
                @click="openId = openId === log.id ? '' : log.id"
                @keydown.enter.prevent="openId = openId === log.id ? '' : log.id"
                @keydown.space.prevent="openId = openId === log.id ? '' : log.id"
              >
                <td v-if="colVisible('time')" class="log-time mono" :title="fmtFull(log.createdAt)">{{ fmtTime(log.createdAt) }}</td>
                <td v-if="colVisible('admin')" class="log-admin" :title="log.adminName || log.adminId || ''">
                  <template v-if="log.adminName">{{ log.adminName }}</template>
                  <template v-else-if="log.adminId">{{ shortId(log.adminId) }}</template>
                  <span v-else class="mk-na">—</span>
                </td>
                <!-- 动作格两段式（2026-10-24 视觉修复）：方法徽章紧贴动作名（8px）。
                     2026-10-18 曾用两端对齐把徽章固定到格右缘，实测读成「名字」与「方法」
                     两段无关信息（徽章与动作名之间隔出整格空白）；改回同行紧贴，
                     flex-wrap 保留 1280 窄档的换行能力。 -->
                <td v-if="colVisible('action')" :title="log.action">
                  <div class="log-act-line">
                    <span v-if="methodOf(log)" class="log-path" :title="`${methodOf(log)} ${log.path || ''}`">{{ actionLabelOf(log) }}</span>
                    <span v-else class="log-action">{{ actionText(log.action) }}</span>
                    <!-- 方法徽章紧贴动作名（2026-10-24）：原两端对齐把徽章推到格右缘，
                         名字与方法读成两段无关信息。 -->
                    <span v-if="methodOf(log)" class="log-act-method">
                      <span class="log-action-sep" aria-hidden="true">·</span>
                      <span class="log-method">{{ methodOf(log) }}</span>
                    </span>
                  </div>
                </td>
                <td v-if="!noTargetTypes && colVisible('tt')" class="log-tt">
                  <template v-if="log.targetType">{{ targetTypeText(log.targetType) }}</template>
                  <span v-else class="mk-na">—</span>
                </td>
                <td v-if="colVisible('target')" class="log-target mono" :title="log.targetId || ''">
                  <button
                    v-if="log.targetId && targetLinkOf(log)"
                    type="button"
                    class="al-target-link al-ellipsis"
                    @click.stop="openTarget(log)"
                  >{{ shortId(log.targetId) }}</button>
                  <span v-else-if="log.targetId" class="al-ellipsis">{{ shortId(log.targetId) }}</span>
                  <span v-else class="mk-na">—</span>
                </td>
                <!-- 结果列一行读完：结果徽章 + HTTP 状态码/耗时（2026-10-27 用户「尽量不换行，
                     做到一行」：这两项原先压在动作格第二行，把整行撑到 65px）。 -->
                <td v-if="colVisible('result')">
                  <div class="log-result-line">
                    <span class="mk-badge" :class="log.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ log.success ? '成功' : '失败' }}</span>
                    <span v-if="log.statusCode || log.durationMs != null" class="log-result-meta mono" :title="resultMetaTitle(log)">
                      <span v-if="log.statusCode">{{ log.statusCode }}</span>
                      <span v-if="log.durationMs != null">{{ fmtMs(log.durationMs) }}</span>
                    </span>
                  </div>
                </td>
                <td v-if="colVisible('ip')" class="log-ip" :title="log.ip || ''">
                  <span v-if="(log.ip || '').trim()" class="al-ellipsis">{{ ipText(log.ip) }}</span>
                  <span v-else class="mk-na">—</span>
                </td>
                <td class="mk-th--right log-arrow" aria-hidden="true"><span class="log-arrow__i">▸</span></td>
              </tr>
              <tr v-if="openId === log.id" class="log-payload-row">
                <td :colspan="visibleAlCols">
                  <div :id="`audit-payload-${log.id}`" class="log-payload">
                    <div class="log-payload-meta">
                      <span>{{ log.method }} {{ log.path }} · HTTP {{ log.statusCode }}<template v-if="log.durationMs != null"> · {{ fmtMs(log.durationMs) }}</template></span>
                      <span v-if="log.userAgent" class="log-ua" :title="log.userAgent"><span class="log-meta-sep" aria-hidden="true">·</span>{{ log.userAgent }}</span>
                    </div>
                    <div v-if="log.requestJson" class="log-section">
                      <span class="log-label">请求</span>
                      <!-- 负载美化（2026-10-05 与执行日志同批）：紧凑单行 JSON 两格缩进，非 JSON 原样 -->
                      <pre>{{ prettyPayload(log.requestJson) }}</pre>
                    </div>
                    <div v-if="log.beforeJson" class="log-section">
                      <span class="log-label">变更前</span>
                      <pre>{{ prettyPayload(log.beforeJson) }}</pre>
                    </div>
                    <div v-if="log.afterJson" class="log-section">
                      <span class="log-label">变更后</span>
                      <pre>{{ prettyPayload(log.afterJson) }}</pre>
                    </div>
                    <p v-if="!log.requestJson && !log.beforeJson && !log.afterJson" class="log-none">无请求内容记录</p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <!-- 传统分页（方案 A）：与执行日志同一分页器形态 -->
      <Pagination
        v-model:page="currentPage"
        v-model:pageSize="currentPageSize"
        :total="total"
        :loading="loading"
      />
    </template>

    <!-- 登录审计列表：同操作审计，.mk-table-scroll / Pagination 为 .mk-card--fill 直接子元素 -->
    <template v-else-if="tab === 'login' && attempts.length">
      <div ref="scrollEl" :id="panelId" role="tabpanel" :aria-labelledby="tabId" class="mk-table-scroll">
        <!-- 固定列宽（同上判例）；登录尝试表列少、内容短，固定后翻页也不跳 -->
        <table class="mk-table mk-table--fixed al-login-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable al-c-time"
                :aria-sort="alSortState('createdAt')"
                @click="toggleAlSort('createdAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('createdAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="al-c-admin">用户名</th>
              <th scope="col" class="al-c-ip">IP</th>
              <th
                scope="col"
                class="mk-th--sortable al-c-result"
                :aria-sort="alSortState('success')"
                @click="toggleAlSort('success')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('success')">结果<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="al-c-reason">原因</th>
              <th scope="col" class="mk-th--right mk-c-act">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in attempts"
              :key="a.id"
              class="log-tr"
              :class="a.success ? 'log-tr--ok' : 'log-tr--err'"
            >
              <td class="log-time mono" :title="fmtFull(a.createdAt)">{{ fmtTime(a.createdAt) }}</td>
              <td class="log-admin" :title="a.username">
                <template v-if="a.username">{{ a.username }}</template>
                <span v-else class="mk-na">—</span>
              </td>
              <td class="log-ip" :title="a.ip || ''">
                <span v-if="(a.ip || '').trim()" class="al-ellipsis">{{ ipText(a.ip) }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td><span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span></td>
              <td class="log-reason" :title="a.reason || ''">{{ reasonText(a.reason) }}</td>
              <td class="mk-th--right al-act">
                <button
                  v-if="a.success && a.username"
                  type="button"
                  class="mk-link"
                  @click="goSessions(a.username)"
                >查看会话 →</button>
                <button
                  v-else-if="a.username"
                  type="button"
                  class="mk-link"
                  @click="searchUsername(a.username)"
                >查该用户名</button>
                <span v-else class="mk-na">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 传统分页（方案 A）：与执行日志同一分页器形态 -->
      <Pagination
        v-model:page="currentPage"
        v-model:pageSize="currentPageSize"
        :total="total"
        :loading="loading"
      />
    </template>

    <!-- 空态：一句事实 + 一个出口 -->
    <MkEmptyState
      v-else
      :id="panelId"
      role="tabpanel"
      :aria-labelledby="tabId"
      min
      :title="isFiltered ? (tab === 'login' ? '当前筛选无登录记录' : '当前筛选无审计记录') : tab === 'login' ? '暂无登录审计' : '暂无审计记录'"
      :description="emptyDescription"
      :action-text="emptyActionText"
      @action="emptyAction"
    >
      <template #icon>
        <KeyRound v-if="tab === 'login'" :size="26" :stroke-width="1.75" style="opacity:.85" />
        <Lock v-else :size="26" :stroke-width="1.75" style="opacity:.85" />
      </template>
    </MkEmptyState>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { KeyRound, Lock } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { adminAuditApi, type AuditLogQuery } from '@/api/adminApi'
import { errMsg, shortId, liveRefreshSeq } from './live'
import { prettyPayload } from './payload-format'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import { useIsNarrow } from './useIsNarrow'
import MkCols from '@/components/mk/MkCols.vue'
import { actionText, targetTypeText, ipText, pathActionText } from './statusText'
import { useTableSort } from './useTableSort'

/** admin_audit_logs 行（与后端 Prisma 模型一致） */
interface AuditLogRow {
  id: string
  adminId?: string | null
  adminName?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  beforeJson?: string | null
  afterJson?: string | null
  requestJson?: string | null
  method: string
  path: string
  statusCode: number
  success: boolean
  ip?: string | null
  userAgent?: string | null
  durationMs?: number | null
  createdAt: string
}

/** login_attempts 行（与后端 Prisma 模型一致） */
interface LoginAttemptRow {
  id: string
  scope: string
  username: string
  ip?: string | null
  success: boolean
  reason?: string | null
  createdAt: string
}

/** HTTP 方法（API 类动作显示彩色方法徽标）；非 API 动作（如「删除虚拟学习者」）返回空串 */
function methodOf(log: AuditLogRow): string {
  const m = (log.method || '').trim().toUpperCase()
  return /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(m) ? m : ''
}

/**
 * 动作列展示（P2-16）：语义名优先；老数据（action 存原始串）按 path 兜底映射。
 * 2026-10-24 用户走查：规则没覆盖的接口会把 `/api/admin/...` 整条印在列表里（如卡库 clone）。
 * 仍未命中的接口统一显示「管理操作」——完整方法与路径留在单元格悬停和展开区的请求原文里，
 * 列表不承担接口文档的职责。
 */
const RAW_ACTION_FALLBACK = '管理操作'
function actionLabelOf(log: AuditLogRow): string {
  const mapped = actionText(log.action)
  if (mapped !== log.action) return mapped
  const byPath = pathActionText(log.path, log.method)
  if (byPath) return byPath
  const raw = `${log.action || ''} ${log.path || ''}`
  return /\/api\//.test(raw) || String(log.action || '').startsWith('/') ? RAW_ACTION_FALLBACK : log.action || log.path || mapped
}

/* —— 动作快筛（2026-10-05 重设计）：当前页动作聚合 → keyword 下钻 ——
   刷屏根因是自动化调用与人工操作混排（「推进虚拟会话」单动作可占当前页 70%）；
   给动作维度一个免打字的入口。下钻词取 path 稳定尾段（/wrapup /restart 这类）：
   同资源前缀（/api/admin/virtual-learners）区分不了动作，尾段（或语义键）才能。 */
interface ActionOption {
  /** 选项唯一键：METHOD·语义名（语义动作为 语义名） */
  value: string
  label: string
  /** 写入 keyword 的下钻词：语义键或 /尾段（uuid 结尾取前一段） */
  keyword: string
  count: number
}
function pathDrillKeyword(path: string): string {
  const segs = path.split('?')[0].split('/').filter(Boolean)
  if (!segs.length) return ''
  const last = segs[segs.length - 1]
  // 尾段是动态 id（uuid / 纯数字）时取前一段，避免搜到不可复现的个体 id
  return /^[0-9a-f-]{16,}$|^\d+$/.test(last) ? `/${segs[segs.length - 2] ?? last}` : `/${last}`
}
const actionOptions = computed<ActionOption[]>(() => {
  if (tab.value !== 'operation') return []
  const map = new Map<string, ActionOption>()
  for (const log of logs.value) {
    const method = methodOf(log)
    const label = actionLabelOf(log)
    const key = method ? `${method}·${label}` : label
    let opt = map.get(key)
    if (!opt) {
      const kw = method
        ? pathDrillKeyword(log.path || '')
        : String(log.action || label)
      // label 兜底截断：语义映射未覆盖的原始 path 长达 60+ 字符，select option 撑爆卡头
      const shown = label.length > 26 ? `${label.slice(0, 26)}…` : label
      opt = { value: key, label: shown, keyword: kw, count: 0 }
      map.set(key, opt)
    }
    opt.count++
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
})
/** 下拉选中态由 keyword 单源推导：keyword 恰好等于某动作的下钻词时高亮该动作，
    手动改搜索框 / 点失败 TOP chip 后自动回落「全部动作」，不出现两处筛选各说各话 */
const activeActionValue = computed(
  () => actionOptions.value.find((a) => a.keyword && keyword.value.trim() === a.keyword)?.value ?? ''
)
/** 胶囊下拉的选项：计数是当前页 30 行的聚合口径（非全量 TOP），随 label 一起显示 */
const actionSelectOptions = computed(() => [
  { value: '', label: '全部动作' },
  ...actionOptions.value.map((a) => ({ value: a.value, label: `${a.label} ${a.count}` })),
])
function applyActionFilter(value: string) {
  const opt = actionOptions.value.find((a) => a.value === value)
  keyword.value = opt?.keyword ?? ''
  void applyFilters()
}

const tabs = [
  { id: 'operation', label: '操作审计' },
  { id: 'login', label: '登录审计' },
] as const
type TabId = (typeof tabs)[number]['id']

const tab = ref<TabId>('operation')
const keyword = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('all')

/** 页签 panel 关联（审核 #154）：id/aria-controls 成对，面板随当前页签取同名 id */
const panelId = computed(() => `al-panel-${tab.value}`)
const tabId = computed(() => `al-tab-${tab.value}`)

/* 深链：?tab=login 直达登录审计（会话安全页「审计日志 · 登录审计 →」跳入） */
const route = useRoute()
const router = useRouter()
if (route.query.tab === 'login') tab.value = 'login'

const logs = ref<AuditLogRow[]>([])
const attempts = ref<LoginAttemptRow[]>([])
const total = ref(0)
/** 失败域下钻态：success=false（后端白名单参数）+ 可选动作关键词 */
const failedOnly = ref(false)
const failedAction = ref('')
/** P2-16：失败按动作聚合 TOP（后端 /stats 返回），作为「失败动作」下拉的下钻入口 */
const failureByAction = ref<Array<{ action: string; count: number }>>([])
/** 窗口失败条数（后端 /stats 的 failed；与失败 TOP 同一次响应） */
const failedCount = ref(0)
/** /stats 失败时单独标记：空聚合既可能表示「没有失败动作」，也可能表示统计不可用，
    不区分会让用户把请求故障误读为无失败；该状态在失败 TOP 区提供说明与重试 */
const statsError = ref('')
const statsLoading = ref(false)
/** KPI：失败率与失败动作读数（统计失败时模板显示 —，不把 0 冒充结论） */
const failedRate = computed(() =>
  total.value > 0 ? `${Math.round((failedCount.value / total.value) * 100)}%` : '—'
)
/** 失败动作下拉：空值的文案随失败域变化——在失败域里=「全部失败」，否则=「不过滤」 */
const failureSelectOptions = computed(() => [
  { value: '', label: failedOnly.value ? '全部失败' : '不过滤' },
  ...failureByAction.value.map((f) => ({
    value: f.action,
    label: `${failureLabel(f.action)} ${f.count}`,
  })),
])
/** 当前页（1 基）；筛选/tab/每页条数变化回第 1 页 */
const page = ref(1)
/** 每页条数（与执行日志同一分页器形态：15/30/50/100，默认 30） */
const pageSize = ref(30)
const loading = ref(false)
const loadError = ref('')
const openId = ref('')
/** 表格纵向滚动体（.mk-card--fill 的直接子元素）；翻页后回顶要滚它而非 window */
const scrollEl = ref<HTMLElement | null>(null)

/* 服务端排序：白名单 createdAt / success（operation / login 两个 tab 共用），默认时间倒序。
   排序在后端执行（不使用 sortRows）；变更回第 1 页重查，状态 localStorage 记忆。 */
const {
  sortKey: alSortKey,
  sortDir: alSortDir,
  toggle: toggleAlSort,
  sortState: alSortState,
} = useTableSort({
  keys: ['createdAt', 'success'],
  defaultKey: 'createdAt',
  defaultDir: 'desc',
  storageKey: 'wf_audit_logs_sort'
})

const rows = computed(() => (tab.value === 'operation' ? logs.value : attempts.value))

/** 目标类型列语义（P3）：当前页全部记录未写入 targetType 时隐藏该列（表头/行/网格同步），
    后端补录该字段后自动恢复显示；title 悬停说明列含义 */
const noTargetTypes = computed(() => logs.value.length > 0 && logs.value.every((l) => !l.targetType))

/* D3 表格增强：列显隐（持久化 / 点击外部与 Esc 关闭由共享 MkCols 组件承担） */
const AL_COLS_KEY = 'wf_audit_hidden_cols'
const alColDefs = [
  { key: 'time', label: '时间' },
  { key: 'admin', label: '操作者' },
  { key: 'action', label: '动作' },
  { key: 'tt', label: '目标类型' },
  { key: 'target', label: '目标' },
  { key: 'result', label: '结果' },
  { key: 'ip', label: 'IP' },
] as const
const hiddenCols = ref<Set<string>>(new Set())
/* 窄屏（≤720）：目标类型/目标/IP 次要列随 useIsNarrow 隐藏（th/td 统一走 colVisible），
   时间/操作者/动作/结果可完整放下，免 8 列横向滚动；行详情信息不丢 */
const isNarrow = useIsNarrow()
const MOBILE_HIDDEN_AL = new Set(['tt', 'target', 'ip'])
const colVisible = (key: string) => !hiddenCols.value.has(key) && !(isNarrow.value && MOBILE_HIDDEN_AL.has(key))
const visibleAlCols = computed(() => {
  let n = alColDefs.filter((c) => colVisible(c.key)).length
  if (noTargetTypes.value) n -= 1 // 目标类型列自动隐藏
  return n + 1 // + 箭头列
})

/* 传统分页（方案 A）：页码器 v-model 桥接；翻页 = 整页替换（replace） */
const currentPage = computed({
  get: () => page.value,
  set: (p: number) => {
    void goPage(p)
  }
})
const currentPageSize = computed({
  get: () => pageSize.value,
  set: (s: number) => {
    if (s === pageSize.value) return
    pageSize.value = s
    /* 每页条数变更：回第 1 页 + 按新 pageSize 重查 */
    void applyFilters()
  }
})

function buildParams(nextPage: number, scopeOverride?: typeof tab.value): AuditLogQuery {
  return {
    page: nextPage,
    limit: pageSize.value,
    scope: scopeOverride ?? tab.value,
    keyword: keyword.value.trim() || undefined,
    timeRange: timeRange.value === 'all' ? undefined : timeRange.value,
    sort: (alSortKey.value || undefined) as AuditLogQuery['sort'],
    order: alSortDir.value,
    /* 失败域下钻（KPI 卡 / 失败动作下拉）：后端 parseSuccess 白名单 true/false */
    success: failedOnly.value ? false : undefined,
  }
}

/** 拉取指定页并整体替换列表（total 来自后端 pagination.total，驱动页码器）。
    竞态守卫：seq 代际号 last-wins 丢弃过期响应；写入目标按「发起时」的 tab 固定，
    防止快速切 tab 后旧响应把操作审计写进登录审计（或反之） */
let fetchSeq = 0
/** 返回本次请求的代际号：调用方（applyFilters）据此判断 loading 熄灭时是否仍是当代请求 */
async function fetchPage(nextPage: number): Promise<number> {
  const seq = ++fetchSeq
  const scope = tab.value
  try {
    const res = await adminAuditApi.getAuditLogs(buildParams(nextPage, scope))
    const data = res.data?.data ?? {}
    const list = (scope === 'operation' ? data.logs : data.attempts) ?? []
    if (seq !== fetchSeq) return seq // 已有更新的请求在途/完成：丢弃本次过期响应
    if (scope === 'operation') {
      logs.value = list
    } else {
      attempts.value = list
    }
    const pagination = data.pagination
    if (pagination && typeof pagination.total === 'number') total.value = pagination.total
    page.value = nextPage
    loadError.value = ''
  } catch (e) {
    if (seq === fetchSeq) {
      // 翻页失败若保留上一页行，界面与「导出本页」会把旧记录冒充为目标页数据，故清空失败页行。
      if (scope === 'operation') logs.value = []
      else attempts.value = []
      loadError.value = errMsg(e)
    }
  }
  return seq
}

async function goPage(p: number) {
  if (p < 1 || p === page.value) return
  page.value = p
  syncFiltersToRoute()
  await fetchPage(p)
  /* 翻页替换列表后滚动回顶部：滚真正的滚动体（.mk-table-scroll），而非 window——
     本页是 .mk-page--fill 应用式布局，window 不滚，滚的是卡片内表格区。
     直接置 scrollTop（jsdom 无 scrollTo 实现，且语义等价） */
  if (scrollEl.value) scrollEl.value.scrollTop = 0
}

/* stats 独立代际号：applyFilters 并行发起列表与统计，慢的旧 stats 响应
   不得覆盖新筛选的结果（与 fetchPage 同款 last-wins 守卫） */
let statsSeq = 0
async function fetchStats() {
  const seq = ++statsSeq
  statsLoading.value = true
  statsError.value = ''
  try {
    const res = await adminAuditApi.getAuditStats(buildParams(1))
    if (seq !== statsSeq) return // 已有更新的统计请求在途/完成：丢弃过期响应
    const stats = res.data?.data?.stats
    if (stats) {
      total.value = typeof stats.total === 'number' ? stats.total : total.value
      failedCount.value = typeof stats.failed === 'number' ? stats.failed : 0
    }
    const byAction = res.data?.data?.failureByAction
    failureByAction.value = Array.isArray(byAction)
      ? byAction.filter((f: { action?: unknown; count?: unknown }) => typeof f?.action === 'string' && Number(f?.count) > 0)
      : []
  } catch (e) {
    if (seq !== statsSeq) return
    // 统计失败不能伪装成零失败动作，否则用户会把不可用误读为「没有失败」。
    statsError.value = errMsg(e)
  } finally {
    if (seq === statsSeq) statsLoading.value = false
  }
}

/** 失败聚合项展示名：语义名优先；老数据 action 为 `METHOD /path` → 取 path 兜底映射（已归一化动态 id） */
function failureLabel(action: string): string {
  const mapped = actionText(action)
  if (mapped !== action) return mapped
  const methodMatch = action.match(/^([A-Z]+)\s/)
  const method = methodMatch ? methodMatch[1] : ''
  const path = action.replace(/^[A-Z]+ /, '')
  const byPath = pathActionText(path, method)
  if (byPath) return byPath
  return /\/api\//.test(path) || path.startsWith('/') ? RAW_ACTION_FALLBACK : action
}

/** 下钻关键词：老数据 action 是 `METHOD /path`（含真实 id，统计侧已归一化为 :id），
    精确 action 过滤命中不了 → 取 path 首段做 contains（path 列在 keyword 搜索白名单内）；
    语义键（非 API 动作）原样搜 action 列 */
function failureKeyword(action: string): string {
  const m = action.match(/^[A-Z]+\s+(\/[^/]+)/)
  return m ? m[1] : action
}

/** KPI「失败记录」卡：一键进入/退出失败域。若当前正按某动作下钻，先回到「全部失败」。 */
function toggleFailureOnly() {
  if (failedOnly.value && !failedAction.value) {
    failedOnly.value = false
    keyword.value = ''
  } else {
    failedOnly.value = true
    failedAction.value = ''
    keyword.value = ''
  }
  void applyFilters()
}

/** 失败动作下拉：选动作 = 只看失败 + 该动作关键词；选空值 = 退出动作下钻。
    空值在失败域里保留「只看失败」（读作「全部失败」），不悄悄把失败域一起关掉。 */
function applyFailureFilter(action: string) {
  failedAction.value = action
  if (action) {
    failedOnly.value = true
    keyword.value = failureKeyword(action)
  } else {
    keyword.value = ''
  }
  void applyFilters()
}

async function applyFilters() {
  loadError.value = ''
  loading.value = true
  page.value = 1
  syncFiltersToRoute()
  logs.value = []
  attempts.value = []
  openId.value = ''
  /* stats 与列表并行发起：列表返回即渲染（loading 只跟列表走），stats 晚到异步补——
     原串行 await 会让慢 stats 拖住首屏列表 */
  const pageTask = fetchPage(1)
  void fetchStats()
  /* 代际守卫：只有当代请求落地才熄 loading。并发筛选时过期请求先返回不得熄灭
     loading（否则新请求在途、rows 已清空 → 误渲染「当前筛选无审计记录」空态）。 */
  const seq = await pageTask
  if (seq === fetchSeq) loading.value = false
}

/** tab 回写 URL query：与 ?tab=login 深链闭环（切回默认 operation 时清掉参数） */
function syncTabQuery(id: TabId) {
  const next = { ...route.query }
  if (id === 'login') next.tab = 'login'
  else delete next.tab
  void router.replace({ query: next })
}

function switchTab(id: TabId) {
  if (tab.value === id) return
  tab.value = id
  syncTabQuery(id)
  void applyFilters()
}

/* 页签键盘契约（审核 #154）：roving tabindex（仅选中项可 Tab 进入）+ 左右方向键循环切换并移动焦点，
   兑现 role=tablist/role=tab 的 ARIA tabs 语义（判例 HealthCenter.vue:471-490） */
const tabEls = ref<(HTMLButtonElement | null)[]>([])
function setTabRef(el: unknown, i: number) {
  tabEls.value[i] = (el as HTMLButtonElement) || null
}
function onTabKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = tabs.length
  const cur = tabs.findIndex((t) => t.id === tab.value)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight') next = (from + 1) % n
  else if (e.key === 'ArrowLeft') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else next = n - 1
  e.preventDefault()
  switchTab(tabs[next].id)
  void nextTick(() => tabEls.value[next]?.focus())
}

/** 刷新当前页（审核 #153）：保留页码与列表，只重取数据；不闪骨架、不回第 1 页 */
async function refreshPage() {
  loadError.value = ''
  loading.value = true
  const seq = await fetchPage(page.value)
  void fetchStats()
  if (seq === fetchSeq) loading.value = false
}

/* 排序变更：与筛选同义，回第 1 页重查 */
watch([alSortKey, alSortDir], () => {
  void applyFilters()
})

/* 顶栏刷新：重取当前页（与旧页头钮同一语义，保留页码与列表） */
watch(liveRefreshSeq, () => { void refreshPage() })

const isFiltered = computed(() => !!keyword.value.trim() || timeRange.value !== 'all' || failedOnly.value)
function clearFilters() {
  keyword.value = ''
  timeRange.value = 'all'
  failedOnly.value = false
  failedAction.value = ''
  void applyFilters()
}
/** 空态出口：有筛选 → 清筛选；默认「全部」为空则没有更宽的时间窗可放 */
const emptyActionText = computed(() => (isFiltered.value ? '清除筛选' : ''))
function emptyAction() {
  if (isFiltered.value) clearFilters()
}

/** 目标对象可点：用户 / 会话走二级页深链（AdminConsole 的 ?view=&id= 契约），其余类型保持纯文本 */
function targetLinkOf(log: AuditLogRow): string {
  const t = String(log.targetType || '').toLowerCase()
  return t === 'user' || t === 'session' ? t : ''
}
function openTarget(log: AuditLogRow) {
  const t = targetLinkOf(log)
  const id = String(log.targetId || '')
  if (!t || !id) return
  const view = t === 'user' ? 'user' : 'session-real'
  const scene = t === 'user' ? 'people' : 'teaching-sessions'
  void router.push({ path: `/admin/${scene}`, query: { view, id } })
}
/** 登录失败/锁定行：按该用户名重查 */
function searchUsername(username: string) {
  keyword.value = username
  void applyFilters()
}

const TIME_RANGES = ['today', 'yesterday', 'week', 'month', 'all'] as const
const timeRangeLabels = { today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部' } as const
/** 胶囊内嵌下拉的选项形态（顺序即下拉顺序，默认「全部」在最前） */
const timeRangeOptions = (['all', 'today', 'yesterday', 'week', 'month'] as const).map(
  (value) => ({ value, label: timeRangeLabels[value] })
)

/* ===== 筛选 / 页码 ↔ URL（2026-10-24）=====
   此前只有 ?tab=login 入 URL，关键词/时间/失败下钻/页码切场景或返回即复位；
   与执行日志（全量筛选入 URL）同级不同规则。键：q / range / failed / action / page / size，
   缺省值不写（today / 无关键词 / 第 1 页 / 30 条）。 */
const AUDIT_FILTER_KEYS = ['q', 'range', 'failed', 'action', 'page', 'size'] as const
const AUDIT_SIZES = [15, 30, 50, 100] as const
function readFiltersFromRoute() {
  keyword.value = typeof route.query.q === 'string' ? route.query.q : ''
  const r = typeof route.query.range === 'string' ? route.query.range : ''
  timeRange.value = (TIME_RANGES as readonly string[]).includes(r) ? (r as typeof timeRange.value) : 'all'
  failedOnly.value = route.query.failed === '1'
  failedAction.value = typeof route.query.action === 'string' ? route.query.action : ''
  const p = Number(route.query.page)
  page.value = Number.isInteger(p) && p > 0 ? p : 1
  const sz = Number(route.query.size)
  pageSize.value = (AUDIT_SIZES as readonly number[]).includes(sz) ? sz : 30
}
function auditFilterSig(): string {
  return [keyword.value.trim(), timeRange.value, failedOnly.value ? '1' : '', failedAction.value, page.value, pageSize.value].join('|')
}
function syncFiltersToRoute() {
  const q = { ...route.query }
  for (const k of AUDIT_FILTER_KEYS) delete q[k]
  if (keyword.value.trim()) q.q = keyword.value.trim()
  if (timeRange.value !== 'all') q.range = timeRange.value
  if (failedOnly.value) q.failed = '1'
  if (failedAction.value) q.action = failedAction.value
  if (page.value > 1) q.page = String(page.value)
  if (pageSize.value !== 30) q.size = String(pageSize.value)
  void router.replace({ query: q })
}
/* 外部改动（返回/前进/手改地址）才重查：本页写回的同值改动不触发第二笔请求 */
watch(
  () => AUDIT_FILTER_KEYS.map((k) => route.query[k]).join('|'),
  () => {
    const before = auditFilterSig()
    readFiltersFromRoute()
    if (auditFilterSig() !== before) {
      void fetchPage(page.value)
      void fetchStats()
    }
  }
)

/** 空态：只留一句事实 */
const emptyDescription = computed(() =>
  timeRange.value === 'today' ? '今天没有记录' : ''
)

const REASON_TEXT: Record<string, string> = {
  account_locked: '账户已锁定',
  invalid_credentials: '用户名或密码错误',
  ok: '登录成功',
}
function reasonText(reason: string | null | undefined): string {
  const key = String(reason || '').toLowerCase()
  if (!key) return '—'
  return REASON_TEXT[key] || String(reason)
}

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
/** 结果列的紧凑读数在格内只写「200 18ms」；HTTP 口径与完整耗时放 title */
function resultMetaTitle(log: AuditLogRow): string {
  const parts: string[] = []
  if (log.statusCode) parts.push(`HTTP ${log.statusCode}`)
  if (log.durationMs != null) parts.push(fmtMs(log.durationMs))
  return parts.join(' · ')
}
const pad = (n: number) => String(n).padStart(2, '0')
/* 绝对时间：与执行日志统一 MM-DD HH:MM:SS（完整时间见 tooltip fmtFull） */
function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function fmtFull(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
/* 登录审计时间与操作审计同用 fmtTime（两者实现逐字符相同，P3 合并；均始终带日期） */

onMounted(() => {
  readFiltersFromRoute()
  void applyFilters()
})

/** 会话安全深链：?user=用户名 → 只看该用户当前会话（运营中心宿主「会话安全」tab） */
function goSessions(username: string) {
  void router.push({ path: '/admin/ops-hub', query: { tab: 'security', user: username } })
}

/** 导出只有运营中心数据导出页一个入口（CSV、最近 2000 条），本页不再自出 JSON */
function goExport() {
  void router.push({ path: '/admin/ops-hub', query: { tab: 'export' } })
}
</script>

<style scoped>
/* 固定列宽（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）：动作/目标两列在
   auto 布局下按当页最长内容分宽，翻页跳动；fixed 后按表头定死，余量按权重摊开。
   宽度按 1280 现值校准并留余量，1200 档无横滚。 */
.al-c-time { width: 105px; }
.al-c-admin { width: 170px; }
/* 动作列按「动作名 + 方法徽章」单行校准；HTTP 状态/耗时移到结果列，动作格不再叠第二行 */
.al-c-action { width: 205px; }
.al-c-tt { width: 90px; }
.al-c-target { width: 95px; }
/* 结果列从纯徽章升级为「结果 + HTTP 状态 + 耗时」单行，宽度相应让出 */
.al-c-result { width: 130px; }
.al-c-ip { width: 134px; }
.al-c-expand { width: 34px; }
.al-c-reason { width: 280px; }
/* 登录审计：操作列在 fixed 布局里被挤到 67px，95px 的「查看会话 →」会顶出表格右缘 23px。
   锁定最小宽后由固定布局从其他列回收空间，1920 下不再横向溢出。 */
.al-login-table .mk-c-act { width: 116px !important; }
/* fixed 档列宽即契约：行内 max-width 会顶出单元格，改成随列收缩 + 省略号 */
.al-table .log-target, .al-table .log-ip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
/* td 上的 text-overflow 在表格单元里不生效（2026-10-22 实测仍切字）：内层 span 承担截断 */
.al-ellipsis { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 目标可点（用户 / 会话）：继承单元格字号，只染字色，不撑行高 */
.al-target-link {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: var(--mk-fs-micro);
  text-align: left;
  cursor: pointer;
}
.al-target-link:hover { text-decoration: underline; }

/* 本页无统计带（原型 renderAudit 页头下直接是列表卡，2026-10-02 撤） */

/* ================= 视图切换（原型 .tabs 下划线页签） =================
   2026-10-01 由 mk-pills 胶囊迁入；样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （mk-primitives.css），本页不再私持拷贝。 */

/* 加载失败错误态 */

/* 表格容器：全站 mk-table 标准表格（4K 由 shared.css 档位覆盖；窄屏表内横向滚动）。
   卡内内容区（原 .log-body 自绘边框随 mk-card 统一收敛，不再重复描边）。
   2026-10-06：.log-body 包裹层已拆（#139/#140），th nowrap 由 mk-primitives.css 的
   .mk-table th 承担，纵向滚动与表头 sticky 交给 .mk-card--fill > .mk-table-scroll。 */

/* 行状态：失败行语义红底 + 展开行高亮。失败语义由结果徽章与红底共同承载 */
.log-tr { cursor: pointer; }
.log-tr--err { background: var(--mk-red-bg); }
.log-tr--open td { background: var(--mk-blue-bg); }
.log-tr--open .log-arrow__i { transform: rotate(90deg); }

/* 展开的 payload 行：整行铺开，不参与行点击 */
.log-payload-row { cursor: default; }
.log-payload-row td {
  padding: 4px 14px 14px 62px !important;
  /* 变量化后暗色自动适配，无需再写 dark 覆盖 */
  background: var(--mk-surface-2);
  border-bottom: 1px solid var(--mk-line);
}
.log-payload-row:hover td { background: var(--mk-surface-2); }

/* 单元格 */
.log-time {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.log-admin {
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
/* 动作格单行：动作名 + 方法徽章。2026-10-27 用户「尽量不换行，做到一行」：
   原先把 HTTP 状态/耗时放在同一格第二行，1280 档每行高 65px；现在这两项归结果列。
   flex-wrap 改 nowrap，长动作名由 .log-path 截断（title 保留全文）。 */
.log-act-line { display: flex; flex-wrap: nowrap; align-items: center; column-gap: 8px; min-width: 0; }
.log-act-method { display: inline-flex; align-items: center; flex: none; }
/* 结果列：结果徽章 + HTTP 状态码/耗时，同排单行 */
.log-result-line { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.log-result-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
}
/* HTTP 方法徽标：中性单色。语义色只留给结果列——按方法上绿/琥珀/红会被读成执行结果 */
.log-method {
  display: inline-block;
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  border-radius: var(--mk-radius-sm);
  padding: 1px 7px;
  /* 最小宽：POST 与 DELETE 字样宽窄不同，收一个下限让左缘对齐 */
  min-width: 46px;
  text-align: center;
  vertical-align: middle;
  background: var(--mk-surface-3);
  color: var(--mk-muted);
}
/* 动作名与方法之间的分隔符：两段之间隔着空白，仍留一个点，复制文本时不至于「推进虚拟会话POST」黏成一体 */
.log-action-sep {
  display: inline-block;
  margin-right: 6px;
  color: var(--mk-faint);
  font-weight: 700;
}
/* API 路径：mono 省略号 + title 全值。
   max-width 用固定值（非 100%）：表格 auto 布局按单元格 max-content 定列宽，
   百分比 max-width 在列宽计算时视为 auto → 长路径会把整列撑宽（1440 下 654px、4K 下 1543px），
   固定上限让列宽有界（与 .mk-cell-main strong 的 --mk-cell-main-max 同一机制），4K 档由媒体查询放大 */
.log-path {
  /* inline-block（非 inline）：max-width/text-overflow 只对块级盒生效 */
  display: inline-block;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 上限只为让「一条超长路径」不把动作列撑开（auto 布局按 max-content 定列宽）；
     方法徽章紧跟在本行文本之后，不靠这里的宽度定位。 */
  max-width: 200px;
  min-width: 0;
  vertical-align: middle;
}
/* 非 API 动作（中文标签）：中性蓝 chip */
/* UI 复查 #11：操作列是末列，贴表格右缘过紧，补右留白 */
.al-act { padding-right: 16px; }
/* LY9：1280 档动作列折行致近半数行高 46→70px —— 收紧路径 max-width、锁方法徽标单行，
   内容保持一行不折。2026-10-18 方法徽章拆列后本档不再需要 150px 那么紧，
   但保持收起一档：1280 内容区宽度不变，动作列多让出的宽要还给其余长列。 */
@media (max-width: 1439px) {
  /* 1280 档动作列 205px：动作名留 120px + 方法徽章约 60px + 间距，单行放得下；
     更长的动作名省略，完整值在行 title / 展开区。 */
  .log-path { max-width: 120px; }
  .log-action { max-width: 180px; }
}
/* 窄屏（≤720，次要列已随 useIsNarrow 隐藏）：操作者/动作列收为弹性宽 + 单行截断
   （全文在 title），长值不撑列 → 免横向滚动。
   （原 colgroup 固定列宽的 .al-col-* width:auto 覆盖随 fixed 布局一并退役） */
@media (max-width: 720px) {
  td.log-admin { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td .log-path { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
}

.log-action {
  display: inline-block;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  border-radius: var(--mk-radius-sm);
  padding: 1px 8px;
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
/* 失败域 KPI 激活态：与教学组 .ts-kpi--on 同构（只改描边，不做位移） */
.al-kpi--on { border-color: var(--mk-blue); }
.al-stats-error { padding: 2px 8px; }
.log-tt {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  white-space: nowrap;
}
.log-target {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-ip {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-reason {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
/* 展开指示：行末箭头，展开时旋转 90°。
   箭头列显式定宽 + 居中：auto 布局下表头空列宽度随内容抖动（用户反馈展开后箭头与邻列视觉重叠）。
   2026-10-19 用户走查「旋转后大小不对了」：原先 rotate 直接挂在 <td> 上——格子是 36×41.4 的
   非正方盒，rotate(90deg) 后外接盒变成 42.1×36（实测），箭头连背景一起横向撑出列 6px、纵向缩
   5px，字形还因为绕格心而非自身中心旋转右移约 10px。改法：格子里放 1em 正方、字形居中的内层盒，
   只转内层——正方盒绕自身中心旋转外接盒不变，字形中心也不动。
   2026-10-31 外部评审复检（展开行右侧深色竖块 100% 复现）：此前 .log-arrow 还带了
   display:block——td 被踢出单元格布局后，表格按表头算出的末列在该行没有 td 落位，
   行背景（含 .log-tr--open 的蓝底）盖不到那一格，露出表格底色成「深色竖块」。
   去掉 display:block/margin（旋转早改在内层盒上，这两个属性已无用），恢复普通单元格。 */
.mk-table-scroll table th:last-child { width: 36px; }
.log-arrow {
  width: 36px;
  /* 水平内衬清零：mk-table 的 td 有 16px 左右内衬，36px 定宽格里内容盒只剩 4px，
     比内容还窄的居中会退化成「贴内容盒左缘」（实测箭头偏列心右 4.25px）。 */
  padding-left: 0;
  padding-right: 0;
  text-align: center;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
}
.log-arrow__i {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  transition: transform 0.15s ease;
}

.log-payload { display: grid; gap: 8px; }
/* 请求行与客户端一行读；2026-10-19 用户走查「文案位置不对」：原先 space-between 把 UA 甩到
   块右缘（实测请求行止于 x=1211、UA 起于 x=1748，中间空 536px），悬在 1500px 宽的展开区右端
   与它描述的请求行脱开。改左对齐顺排，长请求行 + 长 UA 时 UA 折到第二行，不撑破块。 */
.log-payload-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: flex-start;
  gap: 12px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.log-meta-sep {
  display: inline-block;
  margin-right: 6px;
  color: var(--mk-faint);
  font-weight: 700;
}
.log-ua {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}
.log-payload pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-sm);
  /* 2026-10-05 token 化（原硬编码 #0d1420/#8ba3c7 恰为亮色值）：亮色零视觉差，
     暗色自动归队 token 暗档，与执行日志页展开区同一套 code 表面 */
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.log-section { display: grid; gap: 4px; }
.log-label { font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }

/* 大屏/4K 适配（全站 mk 体系档位；表格由 shared.css 档位覆盖） */
@media (min-width: 2000px) {
  .log-time,
  .log-target,
  .log-ip { font-size: var(--mk-fs-micro); }
  .log-admin { font-size: var(--mk-fs-body); }
  .log-method { font-size: var(--mk-fs-micro); padding: 2px 9px; }
  .log-path { font-size: var(--mk-fs-micro); max-width: 520px; }
  .log-action { font-size: var(--mk-fs-micro); max-width: 520px; }
  .log-admin { max-width: 300px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: var(--mk-fs-micro); }
  .log-payload-meta,
  .log-ua { font-size: var(--mk-fs-micro); }
  .log-label { font-size: var(--mk-fs-micro); }
  .log-payload pre { font-size: var(--mk-fs-micro); }
  .log-payload-row td { padding-left: 84px !important; }
  .log-arrow { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .log-time,
  .log-target,
  .log-ip { font-size: var(--mk-fs-micro); }
  .log-admin { font-size: var(--mk-fs-body); }
  .log-method { font-size: var(--mk-fs-micro); }
  .log-path { font-size: var(--mk-fs-micro); max-width: 640px; }
  .log-action { font-size: var(--mk-fs-micro); max-width: 640px; }
  .log-admin { max-width: 360px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: var(--mk-fs-micro); }
  .log-payload-meta,
  .log-ua { font-size: var(--mk-fs-micro); }
  .log-label { font-size: var(--mk-fs-micro); }
  .log-payload pre { font-size: var(--mk-fs-micro); }
  .log-arrow { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .log-time,
  .log-target,
  .log-ip { font-size: var(--mk-fs-body); }
  .log-admin { font-size: var(--mk-fs-emphasis); }
  .log-method { font-size: var(--mk-fs-micro); padding: 3px 11px; }
  .log-path { font-size: var(--mk-fs-body); max-width: 760px; }
  .log-action { font-size: var(--mk-fs-body); max-width: 760px; }
  .log-admin { max-width: 420px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: var(--mk-fs-body); }
  .log-payload-meta,
  .log-ua { font-size: var(--mk-fs-body); }
  .log-label { font-size: var(--mk-fs-body); }
  .log-payload pre { font-size: var(--mk-fs-body); }
  .log-payload-row td { padding-left: 100px !important; }
  .log-arrow { font-size: var(--mk-fs-body); }
}

/* 本页空态撑满主区剩余高度的覆写（P1-1「空态利用」→ 审核 #156 改为 flex:1 + min-height:0）
   已提升为共享口径（styles/mk-primitives.css 的 .mk-card--fill > .mk-empty--min，2026-10-24），
   本页不再重复定义；骨架/错误态/列表分支不带 mk-empty--min，不受影响。 */
</style>
