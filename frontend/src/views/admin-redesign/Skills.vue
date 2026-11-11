<template>
  <div class="mk-page mk-page--fill skills-host">
    <!-- 页头（newui/admin pagehead）：页名与侧栏条目一致（2026-10-26 走查：侧栏已改
         「Skill 目录」——评估拆独立页后本页只剩目录，页头却还叫「Skill 与提示词」，
         点进来看到两个名字）。2026-10-04 页头状态条退役：运行读数迁下方 MkKpi 卡带；
         「失败节点」不再单列——卡头「仅看需关注」pill 已带同源计数并承载筛选。
         页级动作：「批量模型配置」（跨 Skill 对照/批量套用，2026-10-24 由独立的
         「模型路由」页签收进弹窗——单技能配置在详情「运行时」里，本页只留跨技能工具）。
         2026-10-25 用户「拆成单页，把这个 tab 撤掉，放到组里」：Prompt 评估已拆为独立页
         （侧栏 Skill 组），本页只剩目录，故页头与读数带不再随页签切换。 -->
    <MkPageHead title="Skill 目录">
      <template #actions>
        <button type="button" class="mk-btn" @click="openBulk">批量模型配置</button>
      </template>
    </MkPageHead>
    <!-- 读数带槽位（2026-10-14 用户两次校订后的定稿）：**页头之下、内容之上**，读数在前、
         视图在后 —— 与全站同一形态（判例 ExecLogs 带@22 / 页签@34、HealthCenter MkKpi@58 /
         页签@104）。 -->
    <section class="mk-kpi-grid" aria-label="Skill 运行统计">
      <!-- #72：列表加载失败时 cards=[] 会落成 0——读不到 ≠ 0 个，显「—」 -->
      <MkKpi
        label="Skill"
        :value="liveLoading && !cards.length ? '…' : skillsError && !cards.length ? '—' : cards.length"
        :tone="skillsError && !cards.length ? 'muted' : ''"
        :title="skillsError && !cards.length ? `Skill 列表加载失败：${skillsError}` : ''"
      />
      <!-- live 三态（评审「状态三态缺失」）：对账加载中 → 「…」；加载失败 → 「?」（读不到 ≠ 0）；
           就绪且为 0 → 红 0（全 draft 是真异常，必须显性报警而非静默消失） -->
      <MkKpi
        label="已上线"
        :value="recLoading ? '…' : recError ? '?' : liveCount"
        :tone="!recLoading && !recError && liveCount === 0 ? 'bad' : ''"
        :title="recLoading ? '上线状态加载中' : recError ? `上线状态加载失败：${recError}` : '只数主目录技能。健康中心按登记册全量（含插件与 handler-only）统计，多于本页，两数不同源'"
      />
      <MkKpi
        label="成功率"
        :value="rangeRefreshing ? '…' : (overallRateText ?? '—')"
        :tone="overallRateTone"
        :title="`统计窗口：${rangeLabel} · 含虚拟学习者。${RATE_THRESHOLD_NOTE || ''}（总览页 Top 5 只统计真实账号发起的调用，故同一 Skill 两页次数不同）`"
      />
      <MkKpi
        label="平均耗时"
        :value="rangeRefreshing ? '…' : avgLatencyText"
        :title="`统计窗口：${rangeLabel}。按调用次数加权的平均耗时，含失败调用与虚拟学习者。只统计窗口内有调用的目录 Skill`"
      />
      <!-- P-49（#74）：异常 Skill 此前只活在筛选 pill 上；0 时不渲染，避免占位。
           2026-10-26 评审：这枚读数即「仅看需关注」筛选，点击直接收敛列表，不再让读者往下找 pill。
           同日动线收口：可点 KPI 一律是开关（再点取消）——原先只单向置 true，
           点第二下没反应，与同组学习状态/复习积压/目标对话的 KPI 语法相反。 -->
      <MkKpi
        v-if="errorCount > 0"
        label="需关注 Skill"
        :value="errorCount"
        tone="bad"
        clickable
        :title="`统计窗口：${rangeLabel}。成功率低于 90%（红档）的 Skill 数。90–97% 的「有失败」不计入。点击仅看这些`"
        :class="{ 'sk-kpi--on': onlyAttention }"
        :aria-pressed="onlyAttention"
        @click="onlyAttention = !onlyAttention"
      />
    </section>

    <!-- 2026-10-25 起本页只剩目录（读数带与页签当时拆到独立页）；2026-11-01 那个独立页
         整体下线，侧栏 Skill 组只剩「字段流转 / Skill 目录 / 插件」。 -->

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <!-- 卡头左组（全站列表页语法：2026-10-15 用户「列表统一设计，搜索放右侧」）：
             下拉筛选在左、搜索在右。本页左组 = 关注 / 归属 / 窗口 三个维度，
             与 LearnerCenter / MemoryReview 同一形态（筛选左、搜索右）。 -->
        <div class="mk-filter">
          <MkPillSelect
            v-model="focusSelect"
            label="关注"
            aria-label="按关注度筛选"
            :options="focusOptions"
            :active="onlyAttention"
          />
          <MkPillSelect
            v-model="agentFilter"
            label="归属"
            aria-label="按归属 Agent 筛选"
            :options="agentSelectOptions"
            :active="!!agentFilter"
          />
          <MkPillSelect
            v-model="statsRange"
            label="窗口"
            aria-label="统计窗口"
            :options="statsRangeOptions"
            :active="statsRange !== '7d'"
          />
        </div>
        <!-- 卡头右组（全站列表页语法）：搜索 → 排序。排序走下拉 + 方向按钮
             （2026-10-28 重新设计：本页是 Skill 条目清单，排序不再用可点表头排序，
             而是下拉 + 方向按钮；列头仍承担「调用次数 / 成功率 / 最近更新 / 归属 / 名称」
             的可点排序，与下拉共用同一 useTableSort 单点）。 -->
        <div class="mk-card__head-right">
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / ID" />
          <span class="sk-sort-label">排序</span>
          <MkSelect
            v-model="sortSelect"
            :options="SORT_OPTIONS"
            aria-label="排序字段"
          />
          <button
            type="button"
            class="mk-btn mk-btn--sm"
            :disabled="!sortKey"
            title="切换排序方向"
            @click="toggleDir"
          >{{ sortDir === 'asc' ? '升序' : '降序' }}</button>
        </div>
      </div>

      <!-- 统计窗口切换失败（已有数据时此前静默吞掉：KPI 副文已换新窗口口径、数字却还是旧窗口，
           页面无任何提示）→ 卡内显式错误条 + 重试，不把故障混进旧数字 -->
      <div v-if="liveSkillsError && cards.length" class="mk-alert mk-alert--row sk-live-err" role="alert">
        <span class="mk-alert__msg">{{ rangeLabelOf(statsRange) }}窗口统计加载失败：{{ liveSkillsError }}（仍为{{ rangeLabel }}的数据）</span>
        <button type="button" class="mk-alert__btn" @click="retrySkills">重试</button>
      </div>

      <!-- 健康点图例（2026-11-11 困惑测试 #73）：行首四色点此前只有各自悬停才知含义，
           与「需关注」筛选的关系（只覆盖红档）也不可见。 -->
      <p class="sk-health-legend">
        状态点：
        <span class="sk-health-legend__item"><i class="sk-dot sk-dot--ok"></i>健康</span>
        <span class="sk-health-legend__item"><i class="sk-dot sk-dot--warn"></i>有失败（成功率 &lt;97%）</span>
        <span class="sk-health-legend__item"><i class="sk-dot sk-dot--error"></i>异常（&lt;90%，即「需关注」）</span>
        <span class="sk-health-legend__item"><i class="sk-dot sk-dot--idle"></i>空闲（未调用）</span>
        <span class="sk-health-legend__note">「需关注」筛选只收红档（异常）</span>
      </p>

      <MockSkeletonTable v-if="liveLoading && !cards.length" :cols="7" />
      <template v-else>
      <!-- 目录表（2026-11-09 重新设计）：固定列宽表，中区不再留空。
           列 = Skill 信息 | 归属 Agent | 路由模型 | 最近更新 | 调用次数 | 成功率 | 操作。
           调用次数 / 成功率 两列自带右对齐可点表头（与全站表格同形态）；成功率列
           用「语义色点 + 常态墨色数字」表达档位（见 .sk-rate 注释，D 项规则）。
           行点击直达详情（与编排图节点、批量弹窗同名入口同一落点）。 -->
      <div v-if="filtered.length" class="mk-table-scroll">
        <table class="mk-table mk-table--click mk-table--fixed sk-catalog">
          <colgroup>
            <col class="sk-c-info" />
            <col class="sk-c-agent" />
            <col class="sk-c-model" />
            <col class="sk-c-updated" />
            <col class="sk-c-calls" />
            <col class="sk-c-rate" />
            <col class="sk-c-act" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="sk-c-info mk-th--sortable" :aria-sort="sortState('skill')" @click="toggle('skill')">
                <button type="button" class="mk-th__btn" @click.stop="toggle('skill')">Skill 信息<span class="mk-th__caret" aria-hidden="true"></span></button>
              </th>
              <th scope="col" class="sk-c-agent mk-th--sortable" :aria-sort="sortState('agent')" @click="toggle('agent')">
                <button type="button" class="mk-th__btn" @click.stop="toggle('agent')">归属 Agent<span class="mk-th__caret" aria-hidden="true"></span></button>
              </th>
              <th scope="col" class="sk-c-model">路由模型</th>
              <th scope="col" class="sk-c-updated mk-th--sortable" :aria-sort="sortState('last')" @click="toggle('last')">
                <button type="button" class="mk-th__btn" @click.stop="toggle('last')">最近更新<span class="mk-th__caret" aria-hidden="true"></span></button>
              </th>
              <!-- 调用次数 / 成功率：右对齐 + 可排序（A 项：补齐两列表头，与数字列口径一致） -->
              <th scope="col" class="sk-c-calls mk-th--right mk-num mk-th--sortable" :aria-sort="sortState('calls')" @click="toggle('calls')">
                <button type="button" class="mk-th__btn" :title="`统计窗口：${rangeLabel} · 含虚拟学习者（与总览 Top 5 的真实账号统计不同）`" @click.stop="toggle('calls')">调用次数<span class="mk-th__caret" aria-hidden="true"></span></button>
              </th>
              <th scope="col" class="sk-c-rate mk-th--right mk-num mk-th--sortable" :aria-sort="sortState('rate')" @click="toggle('rate')">
                <button type="button" class="mk-th__btn" :title="`统计窗口：${rangeLabel} · 含虚拟学习者。${RATE_THRESHOLD_NOTE || ''}`" @click.stop="toggle('rate')">成功率<span class="mk-th__caret" aria-hidden="true"></span></button>
              </th>
              <th scope="col" class="sk-c-act mk-c-act mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in paged"
              :key="s.id"
              tabindex="0"
              :aria-label="`打开 ${s.id} 详情`"
              @click="openDesign(s.id)"
              @keydown.enter.self.prevent="openDesign(s.id)"
              @keydown.space.self.prevent="openDesign(s.id)"
            >
              <!-- Skill 信息：健康点 + 中文名（主）/ 英文 ID + 版本（副） -->
              <td class="sk-c-info">
                <div class="sk-info">
                  <span class="sk-dot" :class="`sk-dot--${s.health}`" role="img" :aria-label="healthLabel(s.health)" :title="healthLabel(s.health)"></span>
                  <div class="mk-cell-main">
                    <!-- 2026-11-08 主次对调：中文名提拔为主标题，英文 ID 降为浅灰等宽副标题。
                         目录没有登记中文名时回落 id 作主标题。 -->
                    <button type="button" class="sk-name-main sk-name-link mk-ellipsis" :class="{ 'sk-name-main--id': !skTitleOf(s) }" :title="nameTitleOf(s)" @click.stop="openDesign(s.id)">{{ skTitleOf(s) || s.id }}</button>
                    <span class="mk-cell-subline">
                      <span v-if="skTitleOf(s)" class="sk-alias sk-alias--mono" :title="`内部标识：${s.id}`">{{ s.id }}</span>
                      <button v-if="versionOf(s.id) !== '—'" type="button" class="mono sk-version-link" :title="versionTitleOf(s.id)" @click.stop="openVersions(s.id)">{{ versionOf(s.id) }}</button>
                      <span v-else class="sk-ver-na mk-na" :title="versionTitleOf(s.id)">—</span>
                    </span>
                  </div>
                </div>
              </td>
              <!-- 归属 Agent：有归属显示标签，无归属显示「未归属」徽章（B 项中区成列，不再悬空） -->
              <td class="sk-c-agent">
                <span v-if="s.agentId" class="sk-agent-tag" :title="s.agentId"><span class="sk-agent-tag__text">{{ s.agentName || s.agentId }}</span></span>
                <span v-else class="mk-badge mk-badge--sm mk-badge--muted">未归属</span>
              </td>
              <!-- 路由模型：coverage 生效 model（空=平台默认）；未加载 → 「—」 -->
              <td class="sk-c-model">
                <span class="sk-model-chip" :title="routingTitleOf(s.id)">{{ routingOf(s.id) }}</span>
              </td>
              <!-- 最近更新 -->
              <td class="sk-c-updated">
                <!-- 相对时间（2 小时前）为主口径，绝对时刻（YYYY-MM-DD HH:mm）进 title：
                     全站口径统一，且相对时间跨会话不会变成「昨天」却无法还原到具体时刻。 -->
                <span class="sk-recent" :class="{ 'mk-na': !s.calls }" :title="recentTitleOf(s)">{{ s.lastAt }}</span>
              </td>
              <!-- 调用次数 -->
              <td class="sk-c-calls mk-num">
                <b :title="`${rangeLabel}内调用 ${s.calls} 次`">{{ s.calls }}</b>
              </td>
              <!-- 成功率（D 项：色点承载档位色，数字恒为 --mk-ink，不再对文字着色） -->
              <td class="sk-c-rate mk-num">
                <span class="sk-rate">
                  <span class="sk-dot sk-dot--sm" :class="rateDotClass(s)" aria-hidden="true"></span>
                  <span :title="rowRateTitle(s)">{{ successRateText(s.calls, s.errors) || '—' }}</span>
                </span>
              </td>
              <!-- 操作（E 项：查看失败记录 提到操作列，无失败显示弱化占位；详情与行点击同源） -->
              <td class="sk-c-act">
                <div class="mk-actions">
                  <button v-if="s.errors > 0" type="button" class="mk-link sk-fail-link" :title="failLinkTitle(s)" @click.stop="investigateAgent(s.id)">查看失败记录</button>
                  <span v-else class="mk-na sk-act-na" title="该窗口内无失败调用">—</span>
                  <button type="button" class="mk-link sk-detail-link" :title="`打开 ${s.id} 详情`" @click.stop="openDesign(s.id)">详情</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 整页空态（加载失败 / 筛选无匹配）：min 吃掉卡内剩余高度并居中 -->
      <MkEmptyState
        v-if="skillsError && !cards.length"
        min
        :title="SKILLS_LOAD_FAIL_TITLE"
        :description="skillsError"
        action-text="重试"
        @action="retrySkills"
      />
      <MkEmptyState
        v-else-if="!filtered.length"
        min
        :title="onlyAttention ? '没有需关注的 Skill' : isFiltered ? '当前筛选无 Skill' : '暂无 Skill'"
        :description="isFiltered ? `筛掉的都是这些条件：${emptyFilterText}。` : '目录里还没有登记 Skill。'"
        :action-text="isFiltered ? '清除筛选' : ''"
        @action="clearFilters"
      />
      </template>
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片 -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </div>

    <!-- ===== 批量模型配置（2026-10-24 用户「这个页面和 Skill 内部运行时重复了」）=====
         跨 Skill 的对照表与批量套用不属于「点开某一个 Skill」的流程，但也不该再占一个
         一级页签：同一份模型/参数在详情「运行时」里已经能逐项改。收进页头弹窗，
         页签只留运行与评估；旧 ?tab=model-routing 深链由路由监听打开本弹窗。 -->
    <Teleport to="body">
      <div v-if="bulkOpen" ref="bulkMaskRef" class="mk-modal">
        <div
          ref="bulkPanelRef"
          class="mk-modal__panel skills-bulk"
          role="dialog"
          aria-modal="true"
          aria-labelledby="skills-bulk-title"
        >
          <div class="mk-modal__head">
            <h3 id="skills-bulk-title" class="mk-modal__title">批量模型配置</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="bulkOpen = false">✕</button>
          </div>
          <div class="mk-modal__body">
            <!-- 读数带（原「模型路由」页签的页面级读数槽位）：前 3 张从 skills 列表 +
                 coverage 派生（去重模型数 / 已路由 Skill 数 / 主模型覆盖占比）。 -->
            <section class="mk-kpi-grid" aria-label="Skill 模型路由统计">
              <MkKpi label="承载模型" :value="routeModelCount" />
              <!-- 2026-10-31 三轮评审：本卡 29 与下方覆盖表「共 31 个技能」上下相距 20px，
                   两个裸数并排读作口径打架。2026-11-02 起本卡与覆盖表同源计数（分母就是覆盖表），
                   两个数字天然一致，悬停只留一句「这一行数的是什么」。 -->
              <MkKpi label="已路由 Skill" :value="routedSkillCount" :hint="coverageReady ? '覆盖表已登记的路由行数（含未入目录的平台内部 / 工具 Skill）' : ''" />
              <MkKpi
                label="主模型覆盖"
                :value="primaryCoverageText"
                :hint="coverageReady ? '使用最多的模型占已路由 Skill 的比例。未单独配置的按解析后的平台默认模型计入。目录页「Skill」只数入目录档案，本表多出平台内部 / 工具 Skill' : ''"
              />
            </section>
            <SkillModelCoverage
              embedded
              :skill-names="skillNamesBySkill"
              :agent-labels="agentLabelsBySkill"
              :completion="completionBySkill"
              :rec-loading="recLoading"
              :rec-error="recError"
              :platform-default-model="registryDefaultModel"
              @applied="refreshCoverage"
              @open-skill="openSkillFromBulk"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import { useRoute, useRouter } from 'vue-router'
import { skillStatOf, isLive, intent, investigateAgent, openSubPage } from './store'
import { liveSkillProfiles, liveExtraProfiles, liveSkillStatsRange, refreshLiveSkills, liveFailures, liveLoading, errMsg, liveRefreshSeq } from './live'
import { completionMetaOf } from './glossaryMeta'
import { formatTime } from './cockpitFormat'
import { RATE_THRESHOLD_NOTE, successRateOf, successRateText, successRateTone, rateToneOf } from './rate-utils'
import MockSkeletonTable from './SkeletonTable.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import MkSelect from '@/components/mk/MkSelect.vue'
import Pagination from './Pagination.vue'
import { useTableSort } from './useTableSort'
import { useListQueryState } from './learner-profile'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import SkillModelCoverage from './SkillModelCoverage.vue'
import { adminSkillsApi, adminApiConfigApi, type SkillCompletion, type SkillReconciliationReport } from '@/api/adminApi'

/* ================= 目录页（2026-10-25 用户「拆成单页，把这个 tab 撤掉，放到组里」：
   本页只剩目录（Prompt 评估当时拆成的独立页 2026-11-01 已整体下线，旧深链改投回本页）；
   「模型路由」2026-10-24 退役——路由是 Skill 的属性，单技能配置在详情「运行时」里改，
   跨 Skill 对照与批量套用收进页头「批量模型配置」弹窗） ================= */

/* Skill 列表加载失败标题：表格视图与空态共用一份文案（R6 复读单源化） */
const SKILLS_LOAD_FAIL_TITLE = 'Skill 数据加载失败'
const route = useRoute()
const router = useRouter()
/** 列表两个视图的共同落点：Skill 详情页（2026-10-15 设计页平铺后，详情页自带设计能力）。
 *  2026-10-14 方案 B：行点击直接走这里，列表侧不再单设「设计」小钮（同落点两入口冗余）。
 *  2026-10-26：落点页签显式写 runtime——不依赖 SkillDetail 的 DEFAULT_TAB 常量，
 *  详情页默认页签一改，列表下钻不会跟着漂移。 */
function openDesign(id: string) {
  openSubPage('skill', id, { tab: 'runtime' })
}
/** 版本列 → 详情「版本」页签（回滚入口与读数同格，不再靠表头 title 指路） */
function openVersions(id: string) {
  openSubPage('skill', id, { tab: 'versions' })
}

/** 退役 tab 的老深链（健康检查/漂移/对账）改投独立页 */
const RETIRED_TABS = new Set(['health', 'drift', 'recon'])
/** 旧「模型路由」页签 → 页头弹窗（旧书签/旧文档链接不失效） */
const LEGACY_ROUTING_TAB = 'model-routing'
const bulkOpen = ref(false)
const bulkPanelRef = ref<HTMLElement | null>(null)
const bulkMaskRef = ref<HTMLElement | null>(null)
useEscape(() => bulkOpen.value, () => { bulkOpen.value = false })
useOverlay(computed(() => bulkOpen.value), bulkPanelRef)
useMaskClose(bulkMaskRef, () => { bulkOpen.value = false })
function openBulk() {
  bulkOpen.value = true
}
/** 弹窗里点 Skill 名 → 关掉弹窗再进详情（覆盖层不叠在子页之上；落点是同一个详情页） */
function openSkillFromBulk(id: string) {
  bulkOpen.value = false
  openDesign(id)
}
const toHealthCenter = (extra: Record<string, string> = {}) =>
  void router.replace({ path: '/admin/health-center', query: extra })
/** 去掉宿主页签键后的其余 query（改投别的页时只带走定位参数） */
function withoutTabKey(): Record<string, string> {
  const q = { ...(route.query as Record<string, string>) }
  delete q.tab
  return q
}

watch(
  () => route?.query?.tab,
  (t) => {
    if (typeof t === 'string' && RETIRED_TABS.has(t)) {
      // 老书签 / 旧文档链接：/admin/skills?tab=health → /admin/health-center（?recon=/?diff= 等定位参数一并带走）
      toHealthCenter(withoutTabKey())
      return
    }
    // 旧「模型路由」页签：落到运行列表并打开页头弹窗，地址收敛为 ?tab=run
    if (t === LEGACY_ROUTING_TAB) {
      openBulk()
      if (route && router) void router.replace({ query: { ...route.query, tab: 'run' } })
      return
    }
  },
  { immediate: true }
)
/* 跨页深链：intent.tab 指向退役 tab（旧调用方还在传 health/drift/recon）也改投独立页；
   指向 Prompt 评估（2026-10-25 拆页）同样改投新独立页 */
watch(
  () => intent.tab,
  (t) => {
    if (!t) return
    if (RETIRED_TABS.has(t)) {
      intent.tab = ''
      toHealthCenter()
      return
    }
  },
  { immediate: true }
)
type Health = 'ok' | 'idle' | 'warn' | 'error'
/** 目录表行（档案 + 实时统计 + 健康态） */
interface SkillRow {
  id: string
  name: string
  agentId: string
  agentName?: string
  calls: number
  errors: number
  avgMs: number
  lastAt: string
  /** 原始调用时间（排序用；展示仍是 lastAt 的相对时间） */
  lastCalledAt?: string
  health: Health
}

const onlyAttention = ref(false)
/** 卡头「关注」下拉的布尔代理（原两枚 chip：全部 / 仅看需关注） */
const focusSelect = computed({
  get: () => (onlyAttention.value ? 'attention' : 'all'),
  set: (v: string) => { onlyAttention.value = v === 'attention' }
})
const focusOptions = [
  { value: 'all', label: '全部' },
  { value: 'attention', label: '仅看需关注' }
]
const keyword = ref('')
/** 归属 Agent 筛选（P1②）：'' = 全部；'__none__' = 无归属 */
const agentFilter = ref('')

/* 列表行（2026-10-28 重新设计）：一行一个 Skill，不再有列显隐。
   排序走工具条下拉，键与方向仍由 useTableSort 单点持久化。 */
const statsRange = liveSkillStatsRange

/** 归属 Agent 下拉选项（P1② 原型 toolbar）：按 agentId 聚合 + 计数；无归属归「未归属」 */
interface AgentOption { id: string; label: string; count: number }
const agentOptions = computed<AgentOption[]>(() => {
  const m = new Map<string, AgentOption>()
  for (const c of cards.value) {
    const id = c.agentId || '__none__'
    const label = c.agentName || c.agentId || '未归属'
    const cur = m.get(id)
    if (cur) cur.count += 1
    else m.set(id, { id, label, count: 1 })
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh'))
})
/** 胶囊内嵌下拉的两组选项（2026-10-26 卡头统一）：
 *  归属 = 空值「全部 Agent」+ 带计数的 Agent 名；窗口 = 统计范围（默认近 7 天）。
 *  2026-11-02 评审两处：①「全部 Agent」不给计数，读者对不上其余各项之和；
 *  ②「未归属」按拼音插在各类 Agent 之间，读起来像一个 Agent 名。现补齐计数，
 *  并把「未归属」固定压尾——它是「没有归属」这一桶，不是某类 Agent。 */
const agentSelectOptions = computed(() => {
  const withCount = (a: AgentOption) => ({ value: a.id, label: `${a.label}（${a.count}）` })
  return [
    { value: '', label: `全部 Agent（${cards.value.length}）` },
    ...agentOptions.value.filter((a) => a.id !== '__none__').map(withCount),
    ...agentOptions.value.filter((a) => a.id === '__none__').map(withCount)
  ]
})
const statsRangeOptions = [
  { value: '7d', label: '近 7 天' },
  { value: '24h', label: '近 24 小时' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部' },
]

/** 成功率含义短句（KPI 卡与列头 title 共用本页单源，避免「= 成功调用 / 总调用」逐字复读两套） */

/** 成功率单元格 title：比例 + 全站统一阈值披露；无分母说明兜底口径（不按 0% 计） */
function rowRateTitle(s: { calls: number; errors: number }): string {
  if (!s.calls) return '该窗口内暂无调用，暂无成功率'
  return `成功率 ${s.calls - s.errors}/${s.calls}。${RATE_THRESHOLD_NOTE}`
}

/** 最近更新的悬停：绝对时刻统一 YYYY-MM-DD HH:mm（全站口径）。
 *  可见列仍是相对时间（2 小时前），绝对时刻只在 title，避免同列两套主口径。
 *  无原始时间戳时（历史数据）退回可见文案，不硬造日期。 */
function recentTitleOf(s: { calls: number; lastAt: string; lastCalledAt?: string }): string {
  if (!s.calls) return '该窗口内暂无调用'
  if (!s.lastCalledAt) return `最近调用：${s.lastAt}`
  const abs = formatTime(s.lastCalledAt)
  return abs ? `最近调用：${abs}` : `最近调用：${s.lastAt}`
}

/** 失败入口的悬停说明：这是一个动作（跳执行日志看失败），不是状态标记。
 *  2026-11-02 评审：三个字的「查失败」看不出是标记还是可点操作，标签本身也说不出跳去哪。 */
function failLinkTitle(s: { id: string; errors: number }): string {
  return `在执行日志里查看 ${s.id} 的 ${s.errors} 条失败调用（${rangeLabel.value}）`
}

/** 成功率档位 → 色点类名（D 项统一规则：**色点承载档位色，百分比数字恒为 --mk-ink**）。
 *  此前三种状态三种写法（绿点白字 / 黄点黄字 / 红点红字），读者无法从「文字有没有变色」
 *  判断档位；现在文字一律常态墨色，只有点着色——与行首健康点同一套语义色。 */
function rateDotClass(s: { calls: number; errors: number }): string {
  const tone = successRateTone(s.calls, s.errors)
  return tone === 'bad' ? 'sk-dot--error' : tone === 'warn' ? 'sk-dot--warn' : tone === 'ok' ? 'sk-dot--ok' : 'sk-dot--idle'
}
// 时间窗口切换 → 按新窗口重新拉取统计；期间状态条展示局部 loading，摘掉旧窗口数字
const rangeRefreshing = ref(false)
/* 已生效窗口（只有成功拉到新窗口数据才推进）：切换失败时 KPI 数字仍是旧窗口的，
   副文口径必须跟着数字走，否则出现「旧窗口数字 + 新窗口口径」的自相矛盾读数（#85） */
const appliedRange = ref(statsRange.value)
watch(statsRange, async () => {
  rangeRefreshing.value = true
  try {
    await refreshLiveSkills()
    liveSkillsError.value = ''
    appliedRange.value = statsRange.value
    // 版本/描述与统计同源（/admin/skills），窗口切换后一并重取
    void refreshSkillMeta()
  } catch (e) {
    liveSkillsError.value = errMsg(e)
  } finally {
    rangeRefreshing.value = false
  }
})

/** live 拉取失败：初始装载失败（liveFailures.skills）或窗口切换/重试失败（本地） */
const liveSkillsError = ref('')
const skillsError = computed(() => liveSkillsError.value || liveFailures.value.skills || '')

async function retrySkills() {
  liveSkillsError.value = ''
  try {
    await refreshLiveSkills()
    appliedRange.value = statsRange.value
    if (liveFailures.value.skills) delete liveFailures.value.skills
  } catch (e) {
    liveSkillsError.value = errMsg(e)
  }
}

// 卡片数据 = 档案 + 实时统计（live 注册表；为空即空态）
const cards = computed<SkillRow[]>(() => {
  const profiles = liveSkillProfiles.value.map((p) => ({ ...p, promptVersion: '', description: '' }))
  return profiles.map((p) => {
    const stat = skillStatOf(p.id)
    // P2（2026-10-04 全站评审）：健康点挂 rate-utils 共享阈值档——errors>0 即红点曾让
    // 24/31 个 Skill 全挂红灯（本窗口成功率 94.9%），指示器饱和失去分辨力。
    // 现在：成功率 <90% 红「异常」（可闪）、<97% 琥珀「有失败」、其余绿/灰；
    // 无分母（calls=0）= 空闲。
    const rate = successRateOf(stat.calls, stat.errors)
    const tone = rateToneOf(rate)
    const health: Health =
      stat.calls === 0 || rate === null ? 'idle' : tone === 'bad' ? 'error' : tone === 'warn' ? 'warn' : 'ok'
    return { ...p, ...stat, health }
  })
})

/** 健康状态文案（状态点 tooltip + aria-label 共用）：状态点是无内容的 span，
    仅靠 title 时触屏/读屏拿不到状态（且 title 会成为行可访问名的首词） */
function healthLabel(health: Health): string {
  if (health === 'error') return '异常'
  if (health === 'warn') return '有失败'
  if (health === 'idle') return '空闲'
  return '健康'
}

/* ================= 路由 · 版本元数据（P1① 原型列结构的数据来源） =================
   原型 renderSkillHub 1662-1706 的 8 列里，版本/路由模型两列不在 live.ts 的
   LiveSkillProfile（id/name/category/agentId/agentName）里，故本页直接取两个只读端点：
   - GET /admin/skills（同 live 注册表源）：promptVersion / promptName + description
   - GET /admin/skill-model-configs/coverage：生效 model（未配置=平台默认）
   列可得性核查：
     Skill ✓ / 归属 Agent ✓ / Prompt 版本 ✓ / 路由模型 ✓ / 调用 ✓（stats.callCount，窗口随筛选）
     / P95 ✗（后端仅日志聚合 p50/p99，无技能级 P95 → 占位「—」）/ 通过率 ✓（stats.successRate）
     / 状态 ✓（对账 completion status）
   「版本」列的单一来源（2026-10-24 用户「什么是版本，单一源头」）：服务端按
   ACTIVE Prompt 基线最高版本回填 promptVersion，与详情 hero「线上生效 vN」、
   运行时定义 activePrompt.version 同一条规则；不再用 definition.version（代码语义版本）。
   本页不外发这两个请求的结果，也不改动 live.ts 的档案口径。
   ※ 状态声明必须在 useTableSort 之前（版本/路由排序访问器在 setup 期就可能被求值，
     放到下方会撞 TDZ：恢复上次排序为「版本」时页面直接白屏）。 */
interface SkillMetaEntry { promptVersion: number | null; promptName: string; description: string }
interface SkillRouteEntry { model: string | null; effectiveModel: string | null; inherited: boolean; tier: string }

const skillMetaById = ref<Map<string, SkillMetaEntry>>(new Map())
const coverageById = ref<Map<string, SkillRouteEntry>>(new Map())
/** coverage 是否成功拉到（空列表也算就绪）：区分「没拉到」与「确实无模型配置」 */
const coverageReady = ref(false)

/* 列表排序（2026-10-28 重设计：列表没有表头，排序走工具条下拉 + 方向按钮）。
   默认「需关注优先」= 失败数降序（问题浮顶，保持既有行为）。
   数据为 live 注册表全量（有界）→ 客户端排序是诚实的；截断/服务端分页列表不适用本机制。 */
const { sortRows, sortKey, sortDir, toggle, toggleDir, sortState } = useTableSort<SkillRow>({
  accessors: {
    errors: (s) => s.errors,
    /* 主行是 canonical id（2026-10-25 英文为主）：排序也按 id，与可见身份一致 */
    skill: (s) => s.id,
    agent: (s) => s.agentName || s.agentId || '',
    calls: (s) => s.calls,
    rate: (s) => successRateOf(s.calls, s.errors),
    /* 最近调用用原始时间戳（lastAt 是「2 天前」文案，字符串比较无意义） */
    last: (s) => (s.lastCalledAt ? Date.parse(s.lastCalledAt) : null)
  },
  defaultKey: 'errors',
  defaultDir: 'desc',
  /* 名称/归属按 A→Z 读，其余指标按「大在前」读 */
  defaultDirOf: { skill: 'asc', agent: 'asc' },
  storageKey: 'wf_skills_list_sort'
})

/* 排序下拉：换字段走 useTableSort.toggle（同时按该字段的直觉方向复位并持久化）。
   2026-10-28 实际走查：此前直接改 sortKey/sortDir，绕过 persist——选完字段切页再回来
   会恢复成上一次持久化的方向；改走 toggle 后下拉与方向按钮共用同一持久化单点。 */
const SORT_OPTIONS = [
  { value: 'errors', label: '失败数优先' },
  { value: 'calls', label: '调用次数' },
  { value: 'rate', label: '成功率' },
  { value: 'last', label: '最近调用' },
  { value: 'skill', label: 'Skill 名称' },
  { value: 'agent', label: '归属 Agent' },
]
const sortSelect = computed({
  get: () => sortKey.value,
  set: (key: string) => {
    if (key !== sortKey.value) toggle(key)
  },
})

/* 覆盖矩阵复用运行表的路由上下文（2026-10-24 合并两张重复表）：
   归属 Agent、完成度都从这里取，矩阵不再另查一份。
   computed 惰性求值，函数声明可后置（completionBadgeOf 在下方定义）。 */
const agentLabelsBySkill = computed<Record<string, string>>(() =>
  Object.fromEntries([
    ...cards.value.map((s) => [s.id, agentLabelOf(s)]),
    // 外挂能力 Skill 不在主目录（isExtraSkill 过滤），但覆盖表（31 行）里有它们：
    // 补上归属文案，避免弹窗里出现「裸 id + —」的行（2026-10-31 四轮评审 P1-5）
    ...liveExtraProfiles.value.map((p) => [p.id, p.agentName || p.agentId || '工具类'])
  ])
)
const skillNamesBySkill = computed<Record<string, string>>(() =>
  Object.fromEntries([
    ...cards.value.map((s) => [s.id, s.name || s.id]),
    ...liveExtraProfiles.value.map((p) => [p.id, p.name || p.id])
  ])
)
const completionBySkill = computed<Record<string, { text: string; cls: string; title: string }>>(() => {
  const out: Record<string, { text: string; cls: string; title: string }> = {}
  for (const s of cards.value) {
    const badge = completionBadgeOf(s.id)
    if (badge) out[s.id] = badge
  }
  return out
})

const filtered = computed(() => {
  let list = cards.value
  // "仅看需关注"只含失败节点；"从未调用"（idle）是常态不是问题
  if (onlyAttention.value) list = list.filter((c) => c.health === 'error')
  if (agentFilter.value === '__none__') list = list.filter((c) => !c.agentId)
  else if (agentFilter.value) list = list.filter((c) => c.agentId === agentFilter.value)
  const q = keyword.value.trim().toLowerCase()
  // 搜索覆盖「id / 中文别名 / description」三处：主行改成英文 id 后，只搜 id 会让按中文名找人的用法失效
  if (q) list = list.filter((c) => `${c.id} ${c.name} ${descOf(c.id)}`.toLowerCase().includes(q))
  return sortRows(list)
})

/* 「仅看需关注」计数与筛选谓词同源（D3）：health==='error'（成功率<90% 红档）。
   旧实现用 errors>0 计数，与点击后 health==='error' 的谓词不同源（徽标 25 vs 点出 9），
   成功率 90–97% 的大失败量节点被漏掉。 */
const errorCount = computed(() => cards.value.filter((c) => c.health === 'error').length)

/* ===== Skill 运营概览（sk-dash：窗口内聚合 + 结论 + KPI） ===== */
const totalCalls = computed(() => cards.value.reduce((a, c) => a + c.calls, 0))
const totalErrors = computed(() => cards.value.reduce((a, c) => a + c.errors, 0))
/** 状态条成功率：精度/阈值/兜底走 rate-utils 单点（P1#26：1 位小数，99.9% 不再显示 100%） */
const overallRateText = computed(() => successRateText(totalCalls.value, totalErrors.value))
/** 2026-10-04 状态条退役：成功率 KPI tone——rate-utils 的 muted（无分母）对 MkKpi 显空档 */
const overallRateTone = computed<'' | 'ok' | 'warn' | 'bad'>(() => {
  const t = successRateTone(totalCalls.value, totalErrors.value)
  return t === 'muted' ? '' : t
})
const avgLatencyMs = computed(() => {
  const called = cards.value.filter((c) => c.calls > 0 && c.avgMs > 0)
  if (!called.length) return null
  return Math.round(called.reduce((a, c) => a + c.calls * c.avgMs, 0) / called.reduce((a, c) => a + c.calls, 0))
})
const avgLatencyText = computed(() => (avgLatencyMs.value == null ? '—' : avgLatencyMs.value >= 1000 ? `${(avgLatencyMs.value / 1000).toFixed(1)}s` : `${avgLatencyMs.value}ms`))
const RANGE_LABELS: Record<string, string> = { '7d': '近 7 天', '24h': '近 24 小时', '30d': '近 30 天', all: '全部时间' }
/** 口径文案取「已生效窗口」（appliedRange）而非下拉当前值：切换失败时数字没换，口径也不能换 */
const rangeLabel = computed(() => RANGE_LABELS[appliedRange.value] || '近期')
const rangeLabelOf = (r: string) => RANGE_LABELS[r] || '近期'

const isFiltered = computed(() => onlyAttention.value || !!keyword.value.trim() || !!agentFilter.value)
/** 筛选空态「筛掉的是什么」单源：把当前生效的条件列成一句人话。
 *  2026-11-02 评审：空态此前只有「当前筛选无 Skill」，读者看不出是哪条条件筛没的，
 *  也不知道该松哪一项（工具栏上只留一个搜索词标签时尤其难认）。 */
const emptyFilterText = computed(() => {
  const parts: string[] = []
  if (onlyAttention.value) parts.push('关注 = 仅看需关注')
  if (agentFilter.value === '__none__') parts.push('归属 = 未归属')
  else if (agentFilter.value) {
    const hit = agentOptions.value.find((a) => a.id === agentFilter.value)
    parts.push(`归属 = ${hit?.label || agentFilter.value}`)
  }
  const q = keyword.value.trim()
  if (q) parts.push(`搜索词 = ${q}`)
  return parts.join('，')
})
function clearFilters() {
  onlyAttention.value = false
  keyword.value = ''
  agentFilter.value = ''
}

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   筛选条件 / 排序变化才回第 1 页；后台数据刷新（轮询/窗口切换）不重置页码，
   否则每次刷新都把用户翻到的页拽回去；越界时收敛到最后一页；
   recShown 属对账明细，仍用加载更多 */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

/* 列表状态 ↔ URL（2026-10-14 方案 B 的收尾）：行点击改跳设计页后本页会被卸载，此前是子页浮层
   （列表保持挂载）所以筛选不丢；现按 house 组合式单点 useListQueryState 落 URL
   （判例 Users / LearnerCenter / VirtualLearners / TeachingSessions 同一单点），
   顺带把深链与刷新还原一起修好。键：?q= / ?page= / ?size= / ?pill=（attn=仅看需关注）
   + extra ?agent=。
   - 排序（?sort=/?dir=）**故意不在这里**：useTableSort 已带 storageKey 存 localStorage，
     跨卸载/跨会话都活着，再进 URL 只会让链接变脏。
   - agent 不给白名单：选项由数据派生（agentOptions 依赖 cards 异步加载），
     挂载时白名单还是空集，会把合法深链当脏值丢掉；未知取值最多筛出空表，而空态带「清除筛选」出口。
   - **调用位置必须在下方的「筛选变化回第 1 页」watch 之前**：本组合式在 setup 期同步落位 URL
     状态，若那个 watch 已存在，深链 ?q=…&page=3 会在落位后立刻被拽回第 1 页。 */
const attnPill = computed({
  get: () => (onlyAttention.value ? 'attn' : 'all'),
  set: (v: string) => { onlyAttention.value = v === 'attn' }
})
useListQueryState({
  pill: attnPill,
  keyword,
  page,
  pageSize,
  allowedPills: ['all', 'attn'],
  defaultPageSize: 15,
  extra: [
    { key: 'agent', get: () => agentFilter.value, set: (v) => { agentFilter.value = v } }
  ],
  /** 类别筛选随该列一起撤（2026-10-24）：旧深链 ?cat= 仍从 URL 摘掉，不留说不通的状态 */
  retired: ['cat']
})

watch([onlyAttention, keyword, agentFilter, sortKey, sortDir], () => {
  page.value = 1
})
watch(filtered, (list) => {
  const maxPage = Math.max(1, Math.ceil(list.length / pageSize.value))
  if (page.value > maxPage) page.value = maxPage
})

// 页级状态基调（statusTone/hostTone/activeCount）已随 2026-10-04 状态条退役删除——
// KPI 卡各自带 tone，空闲/异常信号在卡级承载

/* 行级成功率显示/着色直接用 rate-utils 的 successRateText / successRateTone（单点口径，见上方 import） */

/* ================= 对账数据（目录表完成度列投影） =================
   本页只用它渲染「完成度」列与排序（对账明细面板自 2026-09-29 起在独立页
   /admin/health-center，那边自行拉取，不再经本页下发）。 */
const recReport = ref<SkillReconciliationReport | null>(null)
const recLoading = ref(false)
const recError = ref('')

async function refreshReconciliation() {
  recLoading.value = true
  recError.value = ''
  try {
    const res = await adminSkillsApi.getReconciliation()
    recReport.value = res.data?.data ?? null
  } catch (e) {
    recError.value = errMsg(e)
    recReport.value = null
  } finally {
    recLoading.value = false
  }
}

watch(isLive, () => {
  refreshReconciliation()
  void refreshSkillMeta()
  void refreshCoverage()
  void refreshRegistry()
})

onMounted(() => {
  refreshReconciliation()
  // 版本/描述（/admin/skills）与路由模型/兜底链（skill-model-configs/coverage）：
  // live 层未透出这两组字段，本页按原型列结构自取（只读数据源，不改 live.ts）
  void refreshSkillMeta()
  void refreshCoverage()
})

/* 顶栏刷新（liveRefreshSeq 广播）：本页自有域（版本/描述、路由模型、已上线对账）
   不在 boot 域内，必须各自重拉，否则按钮按下去读数仍是旧值（对照 SkillDetail.vue） */
watch(liveRefreshSeq, () => {
  refreshReconciliation()
  void refreshSkillMeta()
  void refreshCoverage()
})

/* 弹窗里的「平台默认」展示依赖 registry 解析后的默认模型（/admin/model-registry）：懒加载，
   打开时才拉；拉取失败（registryDefaultModel 仍空）时下次打开自动重试 */
watch(bulkOpen, (open) => {
  if (open && !registryDefaultModel.value) void refreshRegistry()
})

/** 完成度五档文案（draft → live）；文案单源：glossaryMeta.ts（与后端 glossary-content 对齐）。
 *  列表列已撤（2026-10-24），本页只剩「已上线」KPI 与批量弹窗的 completion 投影要它 */
const recStatusText = (status: string) =>
  completionMetaOf(status)?.label || status

/** 对账完成度数据源：复用对账面板 completion（live 模式一次拉取合并加载），
    skillId → SkillCompletion。列表不再渲染该列，仍供「已上线」KPI 与批量模型配置弹窗的
    completion 投影（那个弹窗按 Skill 列完成度徽标） */
const recCompletionOf = computed(() => {
  const m = new Map<string, SkillCompletion>()
  for (const r of recReport.value?.items ?? []) m.set(r.skillId, r.completion)
  return m
})

/** 状态条「N 个 live」（原型 statusbar meta）：完成度对账 status=live（已上线）的 Skill 数 */
const liveCount = computed(() =>
  cards.value.filter((c) => recCompletionOf.value.get(c.id)?.status === 'live').length
)

function completionBadgeOf(skillId: string): { cls: string; text: string; title: string } | null {
  const c = recCompletionOf.value.get(skillId)
  if (!c) return null
  return { cls: `mk-badge--rec-${c.status}`, text: recStatusText(c.status), title: recGateDetail(c) }
}

/** 行健康点：live 绿、差集红、其余灰 */
/** 完成度徽标 tooltip：首个失败档的依据文本 */
function recGateDetail(completion: SkillCompletion): string {
  const gates: Array<[string, string]> = [
    ['draft', '基础档案'],
    ['handlerReady', 'handler 注册'],
    ['coreReady', 'core 文件'],
    ['fieldsSynced', '字段路由'],
    ['live', '生效提示词'],
  ]
  for (const [key, label] of gates) {
    const gate = completion.gates[key as keyof typeof completion.gates]
    if (!gate?.ok) return `${label}：${gate?.detail || '未通过'}`
  }
  return '全部门槛通过'
}

/* ---- registry 平台默认模型（只读 /admin/model-registry）----
   未单独指定模型的 Skill 实际跑哪个模型由 registry 解析别名后的真值决定
   （2026-11-04 用户「去掉降级这个功能，不要」：registry 兜底链 / 冷却已随降级下线，
   这里只留解析后的平台默认模型 id）。 */
/** 平台默认模型（registry 解析别名后的真值）：未显式配模型的 Skill 按它显示实际生效模型。
    平台只有一个默认（2026-11-04 起不再有「推理档平台默认模型」）。 */
const registryDefaultModel = ref('')

async function refreshRegistry(): Promise<void> {
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    const data = res.data?.data as {
      defaults?: { defaultModelResolved?: string | null }
    } | undefined
    registryDefaultModel.value = String(data?.defaults?.defaultModelResolved || '')
  } catch {
    registryDefaultModel.value = ''
  }
}

async function refreshSkillMeta(): Promise<void> {
  try {
    const res = await adminSkillsApi.getSkills({ range: statsRange.value })
    const body = res.data?.data ?? res.data ?? {}
    const items: Array<Record<string, unknown>> = Array.isArray(body) ? body : body.skills || body.items || []
    const m = new Map<string, SkillMetaEntry>()
    for (const s of items) {
      const id = String(s.skillId || s.id || s.name || '')
      if (!id) continue
      const promptVersion = Number(s.promptVersion)
      m.set(id, {
        promptVersion: Number.isFinite(promptVersion) && promptVersion > 0 ? promptVersion : null,
        promptName: String(s.promptName || ''),
        description: String(s.description || '')
      })
    }
    skillMetaById.value = m
  } catch {
    // 元数据拉取失败：版本列回退「—」，不影响表格其余列
    skillMetaById.value = new Map()
  }
}

async function refreshCoverage(): Promise<void> {
  try {
    const res = await adminSkillsApi.getSkillModelCoverage()
    const data = res.data?.data as { skills?: Array<{ skillId: string; model: string | null; effectiveModel?: string | null; inherited?: boolean; tier?: string }> } | undefined
    const m = new Map<string, SkillRouteEntry>()
    for (const r of data?.skills || []) {
      if (!r.skillId) continue
      m.set(r.skillId, {
        model: r.model ?? null,
        // 旧后端没有 effectiveModel：退回 model（缺省显示「—」，不拿「平台默认」占位）
        effectiveModel: r.effectiveModel ?? r.model ?? null,
        inherited: r.inherited ?? !r.model,
        tier: r.tier === 'reasoning' ? 'reasoning' : 'chat'
      })
    }
    coverageById.value = m
    coverageReady.value = true
  } catch {
    coverageById.value = new Map()
    coverageReady.value = false
  }
}

/** Skill 描述（服务端目录返回的 description）：只用于搜索匹配与悬停全文。
    2026-10-25 用户「这个功能简介，可以做到详情页里面」：可见副行不再印它——
    列表一行只回答「这是谁」，简介搬进详情 hero 的 :desc（长句在表格里必被截断）。 */
function descOf(skillId: string): string {
  return skillMetaById.value.get(skillId)?.description || ''
}
/**
 * 列表行主标题（2026-11-08 用户「把中文名提拔为主标题」）：
 * 取目录登记的中文 displayName，去掉末尾重复的「 Skill」——29 行每行都印一遍同一个词。
 * 目录未登记中文名（name 为空或等于 id）时返回空串，调用方回落 canonical id 作主标题，
 * 副行此时不渲染（避免同一个 id 上下印两遍）。
 */
function skTitleOf(s: { id: string; name?: string }): string {
  const alias = (s.name || '').trim()
  if (!alias || alias === s.id) return ''
  return alias.replace(/\s*Skill\s*$/i, '').trim() || alias
}
/** 名称格悬停全文：id + 中文别名 + description。可见副行只留别名，简介靠这里与详情页看全 */
function nameTitleOf(s: { id: string; name?: string }): string {
  const alias = (s.name || '').trim()
  const desc = descOf(s.id)
  const parts = [s.id]
  if (alias && alias !== s.id) parts.push(alias)
  if (desc) parts.push(desc)
  return parts.join(' · ')
}

/** 版本列 = 线上生效的 Prompt 版本（无 ACTIVE Prompt → 「—」，不拿 definition.version 顶替） */
function versionOf(skillId: string): string {
  const v = skillMetaById.value.get(skillId)?.promptVersion
  return typeof v === 'number' ? `v${v}` : '—'
}

/** 版本格 title：说清这是「线上生效 Prompt」的版本，并给出 Prompt 名（便于对版本页签） */
function versionTitleOf(skillId: string): string {
  const entry = skillMetaById.value.get(skillId)
  if (!entry?.promptVersion) return '暂无线上生效 Prompt（当前只有代码内置或按定义生成的草案）'
  return entry.promptName
    ? `线上生效 Prompt：${entry.promptName}`
    : `线上生效 Prompt v${entry.promptVersion}`
}

/** 路由模型列：直接显示运行时实际使用的模型（未单独配置时就是平台默认那一个模型）。
    2026-11-10 用户「不要有平台默认这个东西出现，模型配置是什么，就是什么」——
    这一列回答「跑的是哪台模型」，不是「有没有单独配」，不再用配置动作占位。
    覆盖数据未加载 → 「—」，不猜。 */
function routingOf(skillId: string): string {
  if (!coverageReady.value) return '—'
  const row = coverageById.value.get(skillId)
  if (!row) return '—'
  return row.effectiveModel || '—'
}

function routingTitleOf(skillId: string): string {
  if (!coverageReady.value) return '模型覆盖数据未加载'
  const row = coverageById.value.get(skillId)
  if (!row) return '该 Skill 没有模型配置记录，显示 —'
  if (!row.effectiveModel) return '平台还没有可用模型：先在 API 配置里配置一个'
  return row.inherited
    ? `生效模型：${row.effectiveModel}（该 Skill 未单独配置，跟随平台模型）`
    : `生效模型：${row.effectiveModel}（该 Skill 单独配置）`
}

/** 归属 Agent 文案（路由表 mono 副行） */
function agentLabelOf(s: { agentId: string; agentName?: string }): string {
  return s.agentName || s.agentId || '工具类'
}

/* ---- 批量模型配置弹窗的 3 张读数（原「模型路由」页签 KPI 带）----
   2026-11-04 用户「去掉降级这个功能，不要」：原「降级策略」KPI 随降级整条下线。 */
/** 有生效路由标签的 Skill：**与覆盖表同一份数据**——这三张卡说的就是下面那张覆盖表。
    2026-11-02 评审：此前取 Skill 目录（29 行）当分母，与表头「共 31 个技能」上下并排
    读作两个数字打架，且 29 行全走同一个模型时算出的「主模型覆盖 100%」与 31 也对不上。
    覆盖表已登记的行本身就是「已路由」（行内 source 三档必居其一），故直接按覆盖表计数。 */
const routingLabels = computed<string[]>(() =>
  coverageReady.value
    ? [...coverageById.value.values()].map((r) => r.effectiveModel).filter((m): m is string => Boolean(m))
    : []
)
const routeModelCount = computed<number | string>(() =>
  routingLabels.value.length ? new Set(routingLabels.value).size : '—'
)
/** 已路由 Skill 数 = 覆盖表已登记的行数（与表头「共 N 个技能」同源，不再与目录数混用） */
const routedSkillCount = computed<number | string>(() =>
  coverageReady.value ? routingLabels.value.length : '—'
)
/** 主模型覆盖 = 使用最多的那个模型占全部已路由 Skill 的比例 */
const primaryModel = computed(() => {
  const counts = new Map<string, number>()
  for (const v of routingLabels.value) counts.set(v, (counts.get(v) || 0) + 1)
  let label = ''
  let count = 0
  for (const [k, n] of counts) if (n > count) { label = k; count = n }
  return { label, count }
})
const primaryCoverageText = computed(() =>
  routingLabels.value.length ? `${Math.round((primaryModel.value.count / routingLabels.value.length) * 100)}%` : '—'
)
</script>

<style scoped>
/* ================= 宿主布局（tab 宿主：运行 tab 内滚；评估面板自管） ================= */
/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （mk-primitives.css），本页不再私持拷贝。 */

/* 批量模型配置弹窗（2026-10-24）：对照表 + 套用表单列多，走宽档面板；
   body 允许内部横滚，不让宽表把面板撑破 */
.skills-bulk { width: min(var(--mk-modal-w-wide-xxl, 1160px), 100%); }
.skills-bulk .mk-modal__body { min-width: 0; }
/* 统计刷新失败条：卡内位置 + 不参与 fill 伸缩 */
.sk-live-err { flex: none; margin: 10px 16px 0; }
/* ===== 目录表（2026-11-09 重新设计：固定列宽宽表） =====
   此前一行一个 flex 列表，中区（归属 / 版本 / 最近更新）全挤在左格，
   1920 下左格到右侧读数之间空出约 1000px 纯空白。改为真列结构：
   归属 Agent / 路由模型 / 最近更新 各自成列，中区由真实内容填满。
   列宽：百分比 + px 下限（见下方 .sk-c-*）；100% 之和让 fixed 表在 1920 铺满不留 void，
   min-width 之和（822px）保证 1280 不横滚。 */
.sk-catalog { table-layout: fixed; }
/* 表头即列宽契约：colgroup 与 th 同用这些类（th 上的宽度在 fixed 表里被忽略，
   但测试与阅读都从 th 读列宽，两处保持同一套类名）。
   列宽只给「百分比 + px 下限」：fixed 表把 100% 的余量按各列百分比权重摊到所有列，
   1920 下自然铺满、不留 void（不加 max-width，否则在 1920 处各列触顶后会留出空白）；
   1280 下 min-width 之和（220+150+120+100+88+96+168 = 822px）远小于容器，不触发横滚。 */
/* 2026-11-11（1280 复核）：归属 / 路由模型两列原 14% / 13%，1280 下扣掉单元格内衬只剩
   ~106px——「虚拟学习者 Agent」「deepseek-v4.1-flash」每行都被省略，读者要靠悬停才能分辨
   模型。把 Skill 信息列让出 5 个点补到这两列（27 / 16 / 17，路由模型列最紧，
   18 字符的 deepseek-v4.1-flash 需要 ~149px 内容宽），身份与读数仍然完整；
   百分比合计仍 100%，min-width 之和不变（822px），1280 不触发横滚。 */
.sk-c-info { width: 27%; min-width: 220px; }
.sk-c-agent { width: 16%; min-width: 150px; }
.sk-c-model { width: 17%; min-width: 120px; }
.sk-c-updated { width: 9%; min-width: 100px; }
.sk-c-calls { width: 8%; min-width: 88px; }
.sk-c-rate { width: 9%; min-width: 96px; }
.sk-c-act { width: 14%; min-width: 168px; }
/* 表格单元格不再撑 64px 行高：本表是单行 + 副行，行高由内容决定（与列表页一致） */
.sk-catalog tbody td { height: auto; }
/* Skill 信息格：健康点 + 主副行 */
.sk-info { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.sk-info .mk-cell-main { min-width: 0; }
.sk-info .sk-dot { margin-top: 6px; }
.sk-alias {
  min-width: 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.4;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 副行的英文 ID（2026-11-08 主次对调）：等宽 + 浅灰，读者一眼知道那是内部标识不是名字 */
.sk-alias--mono { font-family: var(--mk-mono); }
/* 路由模型：长模型名省略、全名走 title */
.sk-model-chip {
  display: inline-block;
  max-width: 100%;
  padding: 1px 7px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
/* 最近更新：相对时间，等宽数字 */
.sk-recent { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 排序工具条：字段下拉 + 方向按钮 */
.sk-sort-label { flex: none; font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }
/* 可点 KPI 的选中态（需关注 Skill ↔ 仅看需关注）：蓝只给交互与选中，
   与 MemoryReview .mr-kpi--on / LearnerCenter .lc-kpi--on / GoalConversations .gc-kpi--on 同判例 */
.sk-kpi--on { border-color: var(--mk-blue); }
/* 主行中文名（正文重色）：与详情 hero 同一身份口径 */
.sk-name-main {
  display: block;
  max-width: 100%;
  font-weight: 700;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 主行是 canonical id（目录未登记中文名）：机器串走等宽 */
.sk-name-main--id { font-family: var(--mk-mono); }
/* 主行是可点的入口（蓝 = 可交互）；按钮复位成文本排版，行高与纯文本行一致 */
.sk-name-link {
  padding: 0; border: 0; background: none; text-align: left;
  color: var(--mk-blue-text); cursor: pointer; font-size: inherit;
}
.sk-name-link:hover { text-decoration: underline; }
/* 版本 → 详情「版本」页签（回滚入口与读数同格） */
.sk-version-link {
  flex: none;
  padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--mk-blue-text); font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
}
.sk-version-link:hover { text-decoration: underline; }
/* 无线上生效 Prompt 时的版本占位（「—」不是可点入口，走 .mk-na 弱化） */
.sk-ver-na { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); }
/* 操作列里的失败入口（E 项：从 Skill 信息副行提到操作列，与「详情」同级） */
.sk-fail-link { padding: 0; font-size: var(--mk-fs-micro); line-height: 1.5; white-space: nowrap; }
.sk-detail-link { padding: 0; font-size: var(--mk-fs-micro); line-height: 1.5; white-space: nowrap; }
.sk-act-na { font-size: var(--mk-fs-micro); }
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
/* 健康点图例（2026-11-11 困惑测试 #73） */
.sk-health-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 0 14px 8px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.sk-health-legend__item { display: inline-flex; align-items: center; gap: 5px; }
.sk-health-legend__note { color: var(--mk-faint); }
/* 成功率列的小色点（D 项：色点承载档位色，数字恒为 --mk-ink） */
.sk-dot--sm { display: inline-block; width: 6px; height: 6px; margin-right: 6px; vertical-align: middle; }
.sk-dot--ok { background: var(--mk-green); }
.sk-dot--idle { background: var(--mk-faint); }
/* P2（2026-10-04 全站评审）：琥珀「有失败」中间档（errors>0 但成功率 ≥90%）；
   红档才闪——闪键帧此前引用 SkillReconciliation scoped 编译名，本页从未生效（死动画），补本地定义 */
.sk-dot--warn { background: var(--mk-amber); }
.sk-dot--error { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
@keyframes sk-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
/* 成功率读数（D 项统一规则）：**色点带档位色，百分比文字恒为常态墨色**——
   不再按档位给文字着色（此前绿点白字 / 黄点黄字 / 红点红字三种写法并存，
   读者无法从「文字有没有变色」判断档位）。 */
.sk-rate {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
  font-size: var(--mk-fs-body);
  font-weight: 700;
  color: var(--mk-ink);
  white-space: nowrap;
}

/* 归属 Agent 标签 */
.sk-agent-tag {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 2px 9px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-line);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}
.sk-agent-tag__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sk-agent-tag::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mk-blue, #2f6ae0);
  margin-right: 6px;
  flex-shrink: 0;
}

/* 窄档让位：先收路由模型列，再收归属列（身份与读数始终保留） */
@media (max-width: 1100px) {
  .sk-c-model { display: none; }
}
@media (max-width: 900px) {
  .sk-c-agent { display: none; }
}

/* 大屏档位（mk 体系：2000 ≈×1.15，2800 ≈×1.17，3600 ≈×1.3） */
@media (min-width: 2000px) {
  .sk-dot { width: 10px; height: 10px; }
  .sk-agent-tag { font-size: var(--mk-fs-micro); padding: 3px 11px; }
}
@media (min-width: 2800px) {
  .sk-dot { width: 12px; height: 12px; }
  .sk-agent-tag { font-size: var(--mk-fs-micro); padding: 4px 13px; }
}
@media (min-width: 3600px) {
  .sk-dot { width: 14px; height: 14px; }
  .sk-agent-tag { font-size: var(--mk-fs-body); padding: 5px 15px; }
}

/* ================= 暗色模式（D1 补完）：Skill 运行 ================= */
html[data-theme='dark'] {
  .sk-agent-tag { background: var(--wf-bg-hover); color: var(--mk-muted); }
}

</style>
