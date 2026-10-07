<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名随 tab（审计日志/登录审计）+ 导出/刷新上移。
         无统计带（2026-10-02 用户拍板「新UI没有kpi条」：原型 renderAudit = pageTitle +
         card(tabs+table)，页头之下直接是列表卡；总数在分页 foot「共 N 条」单源可见） -->
    <MkPageHead :title="statusTitle" sub="管理员操作与登录行为的完整审计追踪">
      <template #actions>
        <!-- 导出的是服务端分页返回的当前页（非全量筛选结果），文案如实标注；无数据时禁用 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="!rows.length" @click="exportCurrentPage">导出本页</button>
        <!-- 刷新 = 重取当前页（保留页码与列表，不闪骨架）；筛选/排序变更才回第 1 页（审核 #153） -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="refreshPage">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>

    <!-- 单卡容器（原型 renderAudit：card > .tabs 页签 + 页签体，对齐 Users.vue 卡内页签判例）：
         操作审计 / 登录审计两个页签体与页签共用一张卡。页签为原型 .tabs 下划线页签：
         12px/600、激活蓝字+2px 蓝下划线、通栏底线（2026-10-01 由 mk-pills 胶囊迁入——
         胶囊只做筛选 chips，视图/分区切换归页签） -->
    <div class="mk-card mk-card--fill">
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

      <!-- 筛选卡片头（关键词 / 时间范围 / 列） -->
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 时间范围常驻回显（B14/F6-2）：timeRange 默认 'today'，而后端按日界
               （Asia/Shanghai）过滤——选择器只活在「高级筛选」弹层里，卡头原先无任何
               可见提示，空态/低条数被读成「从未发生过」（实测操作审计默认 3 条、
               登录审计直接空态；改「全部」后 87474 / 3927）。此 chip 常驻显示当前生效
               档位（值随 select 单源联动），点击即展开同一弹层改范围。 -->
          <button
            type="button"
            class="mk-pill al-range"
            :class="{ 'mk-pill--active': timeRange !== 'today' }"
            :aria-expanded="advOpen"
            :title="`当前生效时间范围：${timeRangeLabels[timeRange]}（点击展开高级筛选修改）`"
            @click="advOpen = !advOpen"
          ><span class="al-range__k">时间范围</span> <b class="al-range__v">{{ timeRangeLabels[timeRange] }}</b></button>
          <MkFilterSearch
            v-model="keyword"
            :placeholder="tab === 'login' ? '用户名 / IP，回车查询' : '关键词，回车查询'"
            @keydown.enter="applyFilters"
          />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
          <!-- 失败 TOP 下钻的常驻状态（审核 #152）：弹层关闭后仍可见可退；徽章计数含 failedOnly，
               点击 = 退出下钻（与弹层内已激活 chip 同义） -->
          <button
            v-if="failedOnly"
            type="button"
            class="al-fails__chip al-fails__chip--on"
            aria-pressed="true"
            :title="`只看失败：${failedAction ? failureLabel(failedAction) : '全部失败'}（点击退出下钻）`"
            @click="filterByFailure(failedAction)"
          >只看失败 ×</button>
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
        <div class="mk-card__head-right">
          <!-- 2026-10-05 卡头统一弹层法：动作/时间下拉自主行收进共享 .mk-adv 弹层，
               失败 TOP 快捷下钻同迁（此前在头部右区占位致 1440 折两行）；触发钮标生效数 -->
          <!-- 列设置仅操作审计页签有效（登录表 6 列为固定列，不读 colVisible）；
               在登录页签隐藏，避免出现「勾选无效却写 localStorage 的隐式副作用」 -->
          <MkCols v-if="tab === 'operation'" :col-defs="alColDefs" :storage-key="AL_COLS_KEY" v-model:hidden="hiddenCols" />
          <div class="mk-adv">
            <button
              type="button"
              class="mk-btn mk-btn--sm"
              :aria-expanded="advOpen"
              @click="advOpen = !advOpen"
            >
              <Filter :size="14" :stroke-width="1.75" />高级筛选<span v-if="advCount" class="mk-pill__count">{{ advCount }}</span>
            </button>
            <div v-if="advOpen" class="mk-adv__mask" @click="advOpen = false"></div>
            <div v-show="advOpen" class="mk-adv__pop" @click.stop>
              <label v-if="tab === 'operation'" class="mk-adv__field">
                <span class="mk-cell-sub">动作快筛</span>
                <!-- 动作快筛（2026-10-05 重设计）：调试期自动化调用（如「推进虚拟会话」连发 20+ 行）
                     淹没人工操作。选项=当前页 30 行动作聚合（口径如实标注，非全量 TOP）；下钻走
                     keyword 搜索（path 稳定尾段 contains / 语义键），与失败 TOP chip 同机制、
                     同一搜索框真源（手动改搜索词后下拉自动回落）。 -->
                <select
                  :value="activeActionValue"
                  class="mk-filter__select"
                  aria-label="按动作筛选"
                  title="按动作快筛（当前页动作聚合；搜索词写入关键词框，可再叠加其他关键词）"
                  @change="applyActionFilter(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">全部动作</option>
                  <option v-for="a in actionOptions" :key="a.value" :value="a.value">{{ a.label }} {{ a.count }}</option>
                </select>
              </label>
              <label class="mk-adv__field">
                <span class="mk-cell-sub">时间范围</span>
                <select v-model="timeRange" class="mk-filter__select" aria-label="时间范围" @change="applyFilters">
                  <option value="today">今天</option>
                  <option value="yesterday">昨天</option>
                  <option value="week">近 7 天</option>
                  <option value="month">近 30 天</option>
                  <option value="all">全部</option>
                </select>
              </label>
              <!-- 失败 TOP 快捷下钻（近 2000 条失败内聚合）：点击 = 只看失败 + path 首段关键词，
                   再点已激活 chip 退出；自头部右区迁入（同一机制，只换家不换行为） -->
              <div v-if="failureByAction.length" class="al-fails al-fails--pop">
                <span class="al-fails__label" title="失败最多的动作（近 2000 条失败内聚合），点击 chip 下钻只看失败">失败 TOP</span>
                <!-- P2：span→button。后端 /admin/audit-logs 支持 success=true/false 白名单参数（parseSuccess），
                     点击 = 只看失败 + path 首段关键词；再点已激活的 chip 退出下钻 -->
                <button
                  v-for="f in failureByAction"
                  :key="f.action"
                  type="button"
                  class="al-fails__chip"
                  :class="{ 'al-fails__chip--on': failedOnly && failedAction === f.action }"
                  :title="f.action"
                  :aria-pressed="failedOnly && failedAction === f.action"
                  @click="filterByFailure(f.action)"
                >{{ failureLabel(f.action) }} <b>{{ f.count }}</b></button>
              </div>
            </div>
          </div>
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
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），列随 colVisible 增删、
             按内容自然分宽；操作者/路径/IP 等长值由局部 max-width 截断兜底 -->
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th
                v-if="colVisible('time')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('createdAt')"
                @click="toggleAlSort('createdAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('createdAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="colVisible('admin')">操作者</th>
              <th v-if="colVisible('action')">动作</th>
              <th v-if="!noTargetTypes && colVisible('tt')" title="操作对象类别（如 用户 / 公告 / 会话）">目标类型</th>
              <th v-if="colVisible('target')">目标</th>
              <th
                v-if="colVisible('result')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('success')"
                @click="toggleAlSort('success')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('success')">结果<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="colVisible('ip')">IP</th>
              <th class="mk-th--right" aria-hidden="true"></th>
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
                  {{ log.adminName || (log.adminId ? shortId(log.adminId) : '—') }}
                </td>
                <td v-if="colVisible('action')" :title="log.action">
                  <template v-if="methodOf(log)">
                    <span class="log-path mono" :title="`${methodOf(log)} ${log.path || ''}`">{{ actionLabelOf(log) }}</span>
                    <span class="log-action-sep" aria-hidden="true">·</span>
                    <span class="log-method" :class="`log-method--${methodOf(log).toLowerCase()}`">{{ methodOf(log) }}</span>
                  </template>
                  <span v-else class="log-action">{{ actionText(log.action) }}</span>
                </td>
                <td v-if="!noTargetTypes && colVisible('tt')" class="log-tt" :title="log.targetType || '当前记录未写入目标类型'">{{ targetTypeText(log.targetType) }}</td>
                <td v-if="colVisible('target')" class="log-target mono" :title="log.targetId || ''">{{ log.targetId ? shortId(log.targetId) : '—' }}</td>
                <td v-if="colVisible('result')"><span class="mk-badge" :class="log.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ log.success ? '成功' : '失败' }}</span></td>
                <td v-if="colVisible('ip')" class="log-ip mono" :title="log.ip || ''">{{ ipText(log.ip) }}</td>
                <td class="mk-th--right log-arrow" aria-hidden="true">▸</td>
              </tr>
              <tr v-if="openId === log.id" class="log-payload-row">
                <td :colspan="visibleAlCols">
                  <div :id="`audit-payload-${log.id}`" class="log-payload">
                    <div class="log-payload-meta">
                      <span>{{ log.method }} {{ log.path }} · HTTP {{ log.statusCode }}<template v-if="log.durationMs != null"> · {{ fmtMs(log.durationMs) }}</template></span>
                      <span v-if="log.userAgent" class="log-ua" :title="log.userAgent">{{ log.userAgent }}</span>
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
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap -->
        <table class="mk-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('createdAt')"
                @click="toggleAlSort('createdAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('createdAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th>用户名</th>
              <th>IP</th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('success')"
                @click="toggleAlSort('success')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('success')">结果<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th>原因</th>
              <th class="mk-th--right al-act">操作</th>
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
              <td class="log-admin" :title="a.username">{{ a.username || '—' }}</td>
              <td class="log-ip mono" :title="a.ip || ''">{{ ipText(a.ip) }}</td>
              <td><span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span></td>
              <td class="log-reason" :title="a.reason || ''">{{ reasonText(a.reason) }}</td>
              <td class="mk-th--right al-act">
                <button
                  v-if="a.success && a.username"
                  type="button"
                  class="mk-link"
                  title="在「会话安全」页查看该用户当前的登录会话（设备/状态/强制下线）"
                  @click="goSessions(a.username)"
                >查看会话 →</button>
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

    <!-- 空态（P1-1/P2-8，2026-09-27 走查）：
         min：本页是 .mk-card--fill 应用式布局，未传 :min 时空态贴卡片头、下方 60-70% 视口空白；
         文案按 tab 分流，筛选无结果时登录 tab 也说「无登录记录」而非统一的「无审计记录」 -->
    <MkEmptyState
      v-else
      :id="panelId"
      role="tabpanel"
      :aria-labelledby="tabId"
      min
      :title="isFiltered ? (tab === 'login' ? '当前筛选无登录记录' : '当前筛选无审计记录') : tab === 'login' ? '暂无登录审计' : '暂无审计记录'"
      :description="emptyDescription"
      :action-text="isFiltered ? '清除筛选' : ''"
      @action="clearFilters"
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
import { KeyRound, Lock, Filter } from 'lucide-vue-next'
import { useEscape } from './useEscape'
import { useRoute, useRouter } from 'vue-router'
import { adminAuditApi, type AuditLogQuery } from '@/api/adminApi'
import { errMsg, shortId } from './live'
import { prettyPayload } from './payload-format'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import { useIsNarrow } from './useIsNarrow'
import MkCols from '@/components/mk/MkCols.vue'
import { actionText, targetTypeText, ipText, pathActionText } from './statusText'
import { useTableSort } from './useTableSort'
import SavedViewsBar from './SavedViewsBar.vue'
import { useSavedViews, sameViewQuery, type SavedView } from './useSavedViews'

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

/** 动作列展示（P2-16）：语义名优先；老数据（action 存原始串）按 path 兜底映射；都没有才回退原始 path */
function actionLabelOf(log: AuditLogRow): string {
  const mapped = actionText(log.action)
  if (mapped !== log.action) return mapped
  return pathActionText(log.path, log.method) || log.path || mapped
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
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('today')
/* 高级筛选弹层（2026-10-05 卡头统一：动作/时间/失败 TOP 自主行收进共享 .mk-adv），
   Esc 关闭走共享 useEscape（与教学会话同一外壳） */
const advOpen = ref(false)
useEscape(() => advOpen.value, () => { advOpen.value = false })
/* 生效筛选计数（触发钮角标）：动作快筛 / 非默认时间范围 / 只看失败下钻——
   下钻态此前不计入，弹层关闭后工具栏无任何可见指示（审核 #152） */
const advCount = computed(
  () =>
    (activeActionValue.value ? 1 : 0) +
    (timeRange.value !== 'today' ? 1 : 0) +
    (failedOnly.value ? 1 : 0)
)

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
/** 失败 TOP chip 下钻态：success=false（后端白名单参数）+ path 首段做 keyword contains */
const failedOnly = ref(false)
const failedAction = ref('')
/** P2-16：失败按动作聚合 TOP（后端 /stats 返回），作为「失败 N」的下钻入口 */
const failureByAction = ref<Array<{ action: string; count: number }>>([])
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
  sortState: alSortState
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
  { key: 'time', label: '时间', title: '操作时间' },
  { key: 'admin', label: '操作者', title: '管理员账号' },
  { key: 'action', label: '动作', title: 'HTTP 方法与路径' },
  { key: 'tt', label: '目标类型', title: '操作对象类别' },
  { key: 'target', label: '目标', title: '操作对象 ID' },
  { key: 'result', label: '结果', title: '成功 / 失败' },
  { key: 'ip', label: 'IP', title: '来源 IP' },
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
    /* 只看失败（失败 TOP chip 下钻）：后端 parseSuccess 白名单 true/false */
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
    if (seq === fetchSeq) loadError.value = errMsg(e)
  }
  return seq
}

async function goPage(p: number) {
  if (p < 1 || p === page.value) return
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
  try {
    const res = await adminAuditApi.getAuditStats(buildParams(1))
    if (seq !== statsSeq) return // 已有更新的统计请求在途/完成：丢弃过期响应
    const stats = res.data?.data?.stats
    if (stats) {
      total.value = typeof stats.total === 'number' ? stats.total : total.value
    }
    const byAction = res.data?.data?.failureByAction
    failureByAction.value = Array.isArray(byAction)
      ? byAction.filter((f: { action?: unknown; count?: unknown }) => typeof f?.action === 'string' && Number(f?.count) > 0)
      : []
  } catch {
    if (seq !== statsSeq) return
    failureByAction.value = []
  }
}

/** 失败聚合项展示名：语义名优先；老数据 action 为 `METHOD /path` → 取 path 兜底映射（已归一化动态 id） */
function failureLabel(action: string): string {
  const mapped = actionText(action)
  if (mapped !== action) return mapped
  const methodMatch = action.match(/^([A-Z]+)\s/)
  const method = methodMatch ? methodMatch[1] : ''
  const path = action.replace(/^[A-Z]+ /, '')
  return pathActionText(path, method) || action
}

/** 下钻关键词：老数据 action 是 `METHOD /path`（含真实 id，统计侧已归一化为 :id），
    精确 action 过滤命中不了 → 取 path 首段做 contains（path 列在 keyword 搜索白名单内）；
    语义键（非 API 动作）原样搜 action 列 */
function failureKeyword(action: string): string {
  const m = action.match(/^[A-Z]+\s+(\/[^/]+)/)
  return m ? m[1] : action
}

/** 失败 TOP chip 下钻：只看失败 + 该动作关键词；再点已激活的 chip = 退出下钻（关键词一并还原） */
function filterByFailure(action: string) {
  if (failedOnly.value && failedAction.value === action) {
    failedOnly.value = false
    failedAction.value = ''
    keyword.value = ''
  } else {
    failedOnly.value = true
    failedAction.value = action
    keyword.value = failureKeyword(action)
  }
  void applyFilters()
}

async function applyFilters() {
  loadError.value = ''
  loading.value = true
  page.value = 1
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

const isFiltered = computed(() => !!keyword.value.trim() || timeRange.value !== 'today' || failedOnly.value)
function clearFilters() {
  keyword.value = ''
  timeRange.value = 'today'
  failedOnly.value = false
  failedAction.value = ''
  void applyFilters()
}

/* —— 保存视图：筛选组合命名存档（localStorage），pill 一键恢复 ——
   本页筛选未入 URL（仅 ?tab= 深链），保存视图即「可命名的筛选快捷方式」，价值比执行日志页更高 */
const { views: savedViews, save: saveViewToStore, remove: removeView } = useSavedViews('wf_audit_saved_views')

const TIME_RANGES = ['today', 'yesterday', 'week', 'month', 'all'] as const
const timeRangeLabels = { today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部' } as const

/** 空态副文案（B14/F6-2）：未筛选时补一句时间范围口径——默认「今天」下清空只说明
    今天无记录，不等于历史从未发生（会话安全页跳登录审计最易误读）。
    未筛选 ⇒ timeRange 必为默认档（isFiltered 口径已含时间范围）。 */
const emptyDescription = computed(() => {
  const base = tab.value === 'login' ? '管理员登录成功/失败都会在此留痕' : '管理员的增删改操作会自动记录留痕'
  if (isFiltered.value) return base
  return `${base} · 默认时间范围「${timeRangeLabels[timeRange.value]}」，点卡头「时间范围」可改`
})

/** 当前筛选快照（仅含非默认值；tab 默认「操作审计」不存） */
function filterSnapshot(): Record<string, string> {
  const snap: Record<string, string> = {}
  if (tab.value !== 'operation') snap.tab = tab.value
  if (keyword.value.trim()) snap.q = keyword.value.trim()
  if (timeRange.value !== 'today') snap.range = timeRange.value
  return snap
}

/** 快照可读摘要（pill 悬停说明 / 命名建议） */
const filterLabel = computed(() => {
  const parts: string[] = []
  if (timeRange.value !== 'today') parts.push(timeRangeLabels[timeRange.value])
  if (keyword.value.trim()) parts.push(`关键词「${keyword.value.trim()}」`)
  if (tab.value === 'login') parts.push('登录审计')
  return parts.join(' · ') || ''
})
function describeQuery(q: Record<string, string>): string {
  const parts: string[] = []
  if (q.range) parts.push(timeRangeLabels[q.range as keyof typeof timeRangeLabels] || q.range)
  if (q.q) parts.push(`关键词「${q.q}」`)
  if (q.tab === 'login') parts.push('登录审计')
  return parts.join(' · ') || '默认筛选'
}
function savedViewTitle(v: SavedView): string {
  return `${describeQuery(v.query)}（点击应用 · × 删除）`
}

/** 应用保存视图：整体重写筛选后重查（tab 相同也走 applyFilters——keyword/range 无 watch） */
function applySavedView(v: SavedView) {
  const q = v.query || {}
  tab.value = q.tab === 'login' ? 'login' : 'operation'
  syncTabQuery(tab.value)
  /* 下钻态不在保存视图快照内：应用视图时一并还原，避免残留「只看失败」 */
  failedOnly.value = false
  failedAction.value = ''
  keyword.value = q.q || ''
  timeRange.value = (TIME_RANGES as readonly string[]).includes(q.range)
    ? (q.range as typeof timeRange.value)
    : 'today'
  void applyFilters()
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

const statusTitle = computed(() => (tab.value === 'login' ? '登录审计' : '审计日志'))

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
  void applyFilters()
})

/** 会话安全深链：?user=用户名 → 只看该用户当前会话（系统工具宿主「会话安全」tab） */
function goSessions(username: string) {
  void router.push({ path: '/admin/ops-center', query: { tab: 'security', user: username } })
}

/** 导出当前筛选页为 JSON（与 ExecLogs.exportJson 同款：仅当前页 rows，非全量筛选结果）。
    操作审计 / 登录审计两个 tab 共用——rows 随 tab 取对应列表，文件名带 scope 区分 */
function exportCurrentPage() {
  const blob = new Blob([JSON.stringify(rows.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-logs-${tab.value}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
/* 本页无统计带（原型 renderAudit 页头下直接是列表卡，2026-10-02 撤） */

/* ================= 视图切换（原型 .tabs 下划线页签） =================
   2026-10-01 由 mk-pills 胶囊迁入；样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （mk-primitives.css），本页不再私持拷贝。 */

/* 加载失败错误态 */

/* 表格容器：全站 mk-table 标准表格（4K 由 shared.css 档位覆盖；窄屏表内横向滚动）。
   卡内内容区（原 .log-body 自绘边框随 mk-card 统一收敛，不再重复描边）。
   2026-10-06：.log-body 包裹层已拆（#139/#140），th nowrap 由 mk-primitives.css 的
   .mk-table th 承担，纵向滚动与表头 sticky 交给 .mk-card--fill > .mk-table-scroll。 */

/* 行状态：失败行淡红底 + 展开行高亮（行首 3px 色条已撤，2026-10-03 用户拍板：
   与级别列同源冗余、语义不可发现；失败语义由级别徽章 + 淡红底承载） */
.log-tr { cursor: pointer; }
.log-tr--err { background: rgba(220, 38, 38, 0.04); }
.log-tr--open td { background: var(--mk-blue-bg); }
.log-tr--open .log-arrow { transform: rotate(90deg); }

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
/* HTTP 方法徽标：按方法着色（颜色仅作识别辅助） */
.log-method {
  display: inline-block;
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  border-radius: var(--mk-radius-sm);
  padding: 1px 7px;
  margin-right: 7px;
  vertical-align: middle;
}
.log-method--get { background: var(--mk-blue-bg); color: #1d4ed8; }
.log-method--post { background: var(--mk-green-bg); color: #047857; }
.log-method--put { background: var(--mk-amber-bg); color: var(--mk-amber); }
.log-method--patch { background: #f5f3ff; color: #6d28d9; }
.log-method--delete { background: var(--mk-red-bg); color: var(--mk-red-strong); }
.log-method--options,
.log-method--head { background: var(--mk-badge-virtual-bg); color: #475569; }
/* 动作名与方法之间的分隔符：避免「POST探测模型能力」这类无分隔粘连（复制文本也不再黏在一起） */
.log-action-sep {
  display: inline-block;
  margin: 0 6px;
  color: var(--mk-faint);
  font-weight: 700;
  vertical-align: middle;
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
  /* 200px（原 240px）：路径 + 分隔符 + 方法徽章同行内联排布，241+18+55 = 314px 超过
     动作列 1440 下的内容盒（≈301px），方法徽章被挤到第二行、行高翻倍。200px 留出余量
     后三者同行；完整路径仍在 title 与展开行里。 */
  max-width: 200px;
  vertical-align: middle;
}
/* 非 API 动作（中文标签）：中性蓝 chip */
/* UI 复查 #11：操作列是末列，贴表格右缘过紧，补右留白 */
.al-act { padding-right: 16px; }
/* LY9：1280 档动作列（方法徽标 + 动作名 + 路径）折行致近半数行高 46→70px。
   收紧路径 max-width 并锁方法徽标单行，三者保持同行不折。 */
@media (max-width: 1439px) {
  .log-path { max-width: 150px; }
  .log-method { white-space: nowrap; }
  .log-action { max-width: 200px; }
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
/* 时间范围常驻回显 chip（B14/F6-2）：复用 .mk-pill 描边胶囊外观，默认档为中性灰，
   非默认档（已改范围）走 .mk-pill--active 浅蓝激活态；点击展开高级筛选弹层。 */
.al-range { display: inline-flex; align-items: center; gap: 5px; }
.al-range__k { color: var(--mk-faint); font-weight: 600; }
.al-range__v { font-weight: 800; font-variant-numeric: tabular-nums; }
/* P2-16：失败 TOP 聚合 chip（点击下钻到该动作的失败记录） */
.al-fails { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; max-width: 48%; }
/* 弹层内档位：不受头部右区 48% 限宽，chip 允许换行铺开 */
.al-fails--pop { max-width: none; }
.al-fails__label { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-faint); }
.al-fails__chip {
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  background: transparent;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  padding: 2px 8px;
  /* LY14：下钻态 chip 被 max-width:48% 压到 106px，内部计数折到第二行把卡头撑高；
     单行不折，超出由 .al-fails 的 flex-wrap 换行承载。 */
  white-space: nowrap;
  /* span→button：重置按钮默认字体并补手型 */
  cursor: pointer;
  font-family: inherit;
}
.al-fails__chip--on { border-color: var(--mk-red, #dc2626); color: var(--mk-red, #dc2626); }
.al-fails__chip b { color: var(--mk-red-strong); font-variant-numeric: tabular-nums; }
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
   箭头列显式定宽 + 居中 + overflow hidden：auto 布局下表头空列宽度随内容抖动，
   大字号/旋转动画下字符可能溢出列边界压到相邻列（用户反馈展开后箭头与邻列视觉重叠） */
.mk-table-scroll table th:last-child { width: 36px; }
.log-arrow {
  display: block;
  width: 36px;
  max-width: 36px;
  min-width: 36px;
  margin-left: auto;
  text-align: center;
  overflow: hidden;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  transition: transform 0.15s ease;
}

.log-payload { display: grid; gap: 8px; }
.log-payload-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
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

/* ================= 暗色模式：仅方法徽标需单独配色。行底/嵌套面已随
   --mk-blue-bg / --mk-surface-2 / --mk-line 变量自动适配，
   原嵌套块与扁平规则两组重复覆盖一并删除 ================= */
html[data-theme='dark'] .log-method--get { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--wf-color-primary-light); }
html[data-theme='dark'] .log-method--post { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
html[data-theme='dark'] .log-method--put { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
html[data-theme='dark'] .log-method--patch { background: color-mix(in srgb, var(--mk-purple) 16%, transparent); color: var(--wf-color-accent-light); }
html[data-theme='dark'] .log-method--delete { background: color-mix(in srgb, var(--wf-color-danger) 14%, transparent); color: var(--wf-color-danger); }
html[data-theme='dark'] .log-method--options,
html[data-theme='dark'] .log-method--head { background: #2d2d2f; color: var(--mk-muted); }

/* ================= 空态撑满主区剩余高度（P1-1，2026-09-27 走查「空态利用」）=================
   本页是 .mk-page--fill + .mk-card--fill 应用式布局，空态带 mk-empty--min 后若不按本页壳层
   覆写，会用全局默认口径（100dvh - 230px）——本页卡内还有页签切换行与筛选头两层，默认值会
   把空态撑出卡片导致底部裁切。
   2026-10-06（审核 #156）：原「逐项推导常量」--mk-empty-min-h: min(calc(100dvh - 258px), 1200px)
   比实测可用高度大 5px（推导漏算 .mk-page--fill 的 12px gap），盒底越出卡片下缘被 overflow:clip
   裁切；窗口更矮/卡头更高时会真顶破。改为让空态盒直接吃掉卡内剩余高度（父卡已是 flex 列）：
   flex:1 + min-height:0 恒定不溢，也不再依赖任何手工常量。
   骨架/错误态/列表分支不带 mk-empty--min，不受影响。 */
.mk-card--fill > .mk-empty--min {
  flex: 1;
  min-height: 0;
}
</style>
