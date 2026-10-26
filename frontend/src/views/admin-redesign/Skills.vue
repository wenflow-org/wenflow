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
        :title="recLoading ? '上线状态加载中' : recError ? `上线状态加载失败：${recError}` : ''"
      />
      <MkKpi
        label="成功率"
        :value="rangeRefreshing ? '…' : (overallRateText ?? '—')"
        :tone="overallRateTone"
        :title="`统计窗口：${rangeLabel}${RATE_THRESHOLD_NOTE ? `。${RATE_THRESHOLD_NOTE}` : ''}`"
      />
      <MkKpi
        label="平均耗时"
        :value="rangeRefreshing ? '…' : avgLatencyText"
      />
      <!-- P-49（#74）：异常 Skill 此前只活在筛选 pill 上；0 时不渲染，避免占位。
           2026-10-26 评审：这枚读数即「仅看需关注」筛选，点击直接收敛列表，不再让读者往下找 pill -->
      <MkKpi
        v-if="errorCount > 0"
        label="需关注 Skill"
        :value="errorCount"
        tone="bad"
        clickable
        @click="onlyAttention = true"
      />
    </section>

    <!-- Prompt 评估的读数带与页签 2026-10-25 拆到独立页 PromptEval.vue（用户「拆成单页，
         把这个 tab 撤掉，放到组里」）：本页只剩目录，不再有视图切换。 -->

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" :aria-pressed="!onlyAttention" @click="onlyAttention = false">全部</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" :aria-pressed="onlyAttention" @click="onlyAttention = true">仅看需关注</button>
          </div>
          <!-- 2026-10-05 卡头统一弹层法：归属 Agent 下拉收进右侧「筛选」弹层
              （统计窗口是全页 KPI 口径的视图范围开关，不是行筛选，留右区）。 -->
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
          <!-- #107：非默认序时给一键复位（此前点过别的表头就再也回不到默认序，只能清 localStorage） -->
          <button v-if="!isDefaultSort" type="button" class="mk-link" @click="resetSort">恢复默认序（失败数优先）</button>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / ID" />
          <!-- 归属 Agent 筛选（2026-10-26 评审：从「筛选」弹层移回卡头一行，选中值直接显示 Agent 名） -->
          <select v-model="agentFilter" class="mk-filter__select" aria-label="按归属 Agent 筛选">
            <option value="">全部 Agent</option>
            <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}（{{ a.count }}）</option>
          </select>
          <select v-model="statsRange" class="mk-filter__select" aria-label="统计窗口">
            <option value="7d">近 7 天</option>
            <option value="24h">近 24 小时</option>
            <option value="30d">近 30 天</option>
            <option value="all">全部</option>
          </select>
          <MkCols
            :col-defs="menuColDefs"
            :storage-key="SK_COLS_KEY"
            v-model:hidden="hiddenCols"
            :default-hidden="SK_COLS_DEFAULT_HIDDEN"
          />
          <!-- 卡头不再出「筛选后 N 个」命中数：与分页器「共 N 条」同屏复读，计数单源交分页器
               （2026-10-05 CP1 判例 Users.vue:26-29） -->
        </div>
      </div>

      <!-- 统计窗口切换失败（已有数据时此前静默吞掉：KPI 副文已换新窗口口径、数字却还是旧窗口，
           页面无任何提示）→ 卡内显式错误条 + 重试，不把故障混进旧数字 -->
      <div v-if="liveSkillsError && cards.length" class="mk-alert mk-alert--row sk-live-err" role="alert">
        <span class="mk-alert__msg">{{ rangeLabelOf(statsRange) }}窗口统计加载失败：{{ liveSkillsError }}（仍为{{ rangeLabel }}的数据）</span>
        <button type="button" class="mk-alert__btn" @click="retrySkills">重试</button>
      </div>

      <MockSkeletonTable v-if="liveLoading && !cards.length" :cols="7" />
      <template v-else>
      <!-- 列表视图：列对齐 + 排序，问题浮顶。
           0 行时不渲染滚动容器（2026-10-24 全站空态收齐）：它带 flex:1 会吃掉整卡高度，
           把下面的空态顶到卡底（实测文案上方 608px 空白）。 -->
      <div v-if="filtered.length" class="mk-table-scroll">
        <!-- 固定列宽（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）：自动布局下
             Skill / 归属 / 路由模型三列按当页最长名称分宽，翻页整表跳动；改 fixed + 逐列
             表头宽度，余量按权重摊开。长名称仍由 --mk-cell-main-max 截断兜底 -->
        <table v-if="filtered.length" class="mk-table mk-table--click mk-table--fixed sk-table">
          <!-- P1① 列结构对齐原型 renderSkillHub 1662-1706 的 8 列：
               Skill / 归属 Agent / 版本 / 路由模型 / 24h 调用 / P95 / 通过率 / 完成度。
               数据来源核查见脚本「路由 · 版本元数据」小节；P95 接口缺失 → 恒「—」且默认隐藏。
               原型里的「完成度」与不在原型里的「类别」均已撤（见下方表头处说明，
               2026-10-24 用户「有什么实际意义吗」）：现列 = 原型 8 列去掉完成度，
               加「最近调用」，操作列收尾。 -->
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable sk-c-skill"
                :aria-sort="sortState('skill')"
                @click="toggleSort('skill')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('skill')">Skill<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('agent')"
                scope="col"
                class="mk-th--sortable sk-c-agent"
                :aria-sort="sortState('agent')"
                @click="toggleSort('agent')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('agent')">归属 Agent<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- 版本 = 线上生效的 Prompt 版本（2026-10-24 用户「什么是版本，单一源头」）：
                   与详情 hero、运行时定义同一条规则；definition.version（代码语义版本）不再上这一列 -->
              <th
                v-if="showCol('version')"
                scope="col"
                class="mk-th--sortable sk-c-version"
                :aria-sort="sortState('version')"
                @click="toggleSort('version')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('version')">Prompt 版本<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- 路由模型：skill-model-configs/coverage 的生效 model；未配置 → 「平台默认」 -->
              <th
                v-if="showCol('routing')"
                scope="col"
                class="mk-th--sortable sk-c-routing"
                :aria-sort="sortState('routing')"
                @click="toggleSort('routing')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('routing')">路由模型<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- 原型「24h 调用」：本页窗口由「统计窗口」下拉决定（默认近 7 天），故列名取中性「调用」，口径随窗口 -->
              <th
                v-if="showCol('calls')"
                scope="col"
                class="mk-th--right mk-th--sortable sk-c-calls"
                :aria-sort="sortState('calls')"
                @click="toggleSort('calls')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('calls')">调用次数<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- P95 占位：后端仅日志聚合提供 p50/p99，无技能级 P95；不编造数字。
                   整列恒「—」无信息量（评审 P3）→ 默认隐藏，「列」菜单可手动开启 -->
              <th v-if="showCol('p95')" scope="col" class="mk-th--right sk-c-p95">P95</th>
              <th
                v-if="showCol('rate')"
                scope="col"
                class="mk-th--right mk-th--sortable sk-c-rate"
                :aria-sort="sortState('rate')"
                @click="toggleSort('rate')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('rate')" :title="RATE_THRESHOLD_NOTE">成功率<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- 「完成度」「类别」两列已撤（2026-10-24 用户「有什么实际意义吗」）：
                   完成度 = 对账 completion（草稿→入口→core→字段→已上线），实测 37 条对账
                   全为 live，列表 30 行里 29 行显示「已上线」、1 行无对账行显示「—」——零区分度，
                   排序也只是把那 1 个空行挑出来。它是工程侧的构建审计，判断依据全是代码/文件
                   状态，运营没有动作能改它；门槛依据与失败档文本在健康中心对账明细里。
                   类别 = Skill 定义声明的 category（本页实际只有「生成」「分析」两桶，36 条
                   分布 18/14/3/1），不参与任何运行时行为，详情 hero 已显示同一枚徽标。 -->
              <th
                v-if="showCol('last')"
                scope="col"
                class="mk-th--sortable sk-c-last"
                :aria-sort="sortState('last')"
                @click="toggleSort('last')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('last')">最近调用<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            </tr>
          </thead>
          <tbody>
            <!-- 2026-10-14 方案 B：行点击直达 Skill 详情（原「设计」小钮的同一落点）。
                 2026-10-15 设计页退役平铺进详情页后，行点击 = 详情页（自带设计能力），
                 与编排图节点下钻同一落点。 -->
            <tr v-for="s in paged" :key="s.id" class="sk-row" tabindex="0" role="button" :aria-label="`打开 ${s.id} 详情`" @click="openDesign(s.id)" @keydown.enter.self.prevent="openDesign(s.id)" @keydown.space.self.prevent="openDesign(s.id)">
              <td>
                <div class="sk-cell">
                  <span class="sk-dot" :class="`sk-dot--${s.health}`" role="img" :aria-label="healthLabel(s.health)" :title="healthLabel(s.health)"></span>
                  <div class="mk-cell-main">
                    <!-- 英文主行（2026-10-25 用户「以英文为主」）：canonical id 是身份，中文 displayName
                         只是别名——与详情页 hero 同一口径（标题=id、中文名进副行）。
                         2026-10-26 评审：id 做成蓝色链接，让「打开详情」有可见入口（整行仍可点）。 -->
                    <button type="button" class="sk-name-main sk-name-main--id sk-name-link mk-ellipsis" :title="nameTitleOf(s)" @click.stop="openDesign(s.id)">{{ s.id }}</button>
                    <!-- 副行 = 中文别名 + 排障入口；<1600 时「最近调用」列收进副行（showCol 同源） -->
                    <span class="sk-subline">
                      <span v-if="sublineOf(s)" class="sk-sub" :title="nameTitleOf(s)">{{ sublineOf(s) }}</span>
                      <button v-if="s.errors > 0" type="button" class="mk-link sk-fail-link" @click.stop="investigateAgent(s.id)">查失败</button>
                      <span v-if="!showCol('last')" class="sk-recent">{{ s.lastAt }}</span>
                    </span>
                  </div>
                </div>
              </td>
              <td v-if="showCol('agent')">
                <span v-if="s.agentId" class="sk-agent-tag" :title="s.agentId">{{ s.agentName || s.agentId }}</span>
                <!-- 无归属不用裸文本「工具类」：与同列有归属的胶囊同构，弱化灰徽标（2026-10-24） -->
                <span v-else class="mk-badge mk-badge--sm mk-badge--muted">未归属</span>
              </td>
              <td v-if="showCol('version')" class="sk-c-version"><button type="button" class="mono sk-version-link" :title="versionTitleOf(s.id)" @click.stop="openVersions(s.id)">{{ versionOf(s.id) }}</button></td>
              <!-- 路由口径是中文词（「平台默认」），不走等宽；版本号仍是机器串 -->
              <td v-if="showCol('routing')"><span class="sk-model" :title="routingTitleOf(s.id)">{{ routingOf(s.id) }}</span></td>
              <!-- 调用/P95/成功率三格挂 mk-num（2026-10-15 用户走查）：表头 mk-th--right 右对齐，
                   值格此前无 mk-num 左对齐，头与值各站一边；mk-num 同时补齐 mono/tabular 方言 -->
              <td v-if="showCol('calls')" class="mk-num">{{ s.calls }}</td>
              <td v-if="showCol('p95')" class="mk-num"><span class="mk-na">—</span></td>
              <td v-if="showCol('rate')" class="mk-num">
                <!-- 2026-10-15 用户拍板：成功率列只留百分比，比例条撤（数字+条双元素读作装饰噪音；
                     精度/阈值/兜底仍走 rate-utils 单点，tone 着色保留在数字上） -->
                <div class="sk-rate" :class="rateTone(s)" :title="rowRateTitle(s)">
                  <b>{{ successRateText(s.calls, s.errors) || '—' }}</b>
                </div>
              </td>
              <td v-if="showCol('last')"><span :class="{ 'mk-na': !s.calls }">{{ s.lastAt }}</span></td>
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
         一级页签：同一份模型/参数/备用链在详情「运行时」里已经能逐项改。收进页头弹窗，
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
                 coverage 派生（去重模型数 / 已路由 Skill 数 / 主模型覆盖占比）；降级策略另读
                 只读的 /admin/model-registry，把「registry 默认」解析成实际链，拉不到显 — 不编造 -->
            <section class="mk-kpi-grid" aria-label="Skill 模型路由统计">
              <MkKpi label="承载模型" :value="routeModelCount" />
              <MkKpi label="已路由 Skill" :value="routedSkillCount" />
              <MkKpi label="主模型覆盖" :value="primaryCoverageText" />
              <!-- 降级策略：真实口径 = 自定义兜底链计数；无自定义链时给出 registry 默认链的
                   解析结果（F7-5：空数组=「无（空链）」）。registry 未加载显 —，不伪装 -->
              <MkKpi label="降级策略" :value="fallbackPolicyText" />
            </section>
            <SkillModelCoverage
              embedded
              :skill-names="skillNamesBySkill"
              :agent-labels="agentLabelsBySkill"
              :completion="completionBySkill"
              :fallback-info="fallbackBySkill"
              :rec-loading="recLoading"
              :rec-error="recError"
              :platform-default-model="registryDefaultModel"
              :platform-default-reasoning-model="registryDefaultReasoningModel"
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
import { liveSkillProfiles, liveSkillStatsRange, refreshLiveSkills, liveFailures, liveLoading, errMsg, liveRefreshSeq } from './live'
import { completionMetaOf } from './glossaryMeta'
import { RATE_THRESHOLD_NOTE, successRateOf, successRateText, successRateTone, rateToneOf } from './rate-utils'
import MockSkeletonTable from './SkeletonTable.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import Pagination from './Pagination.vue'
import { useIsNarrow } from './useIsNarrow'
import { useTableSort } from './useTableSort'
import { useListQueryState } from './learner-profile'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import SkillModelCoverage from './SkillModelCoverage.vue'
import { adminSkillsApi, adminApiConfigApi, type SkillCompletion, type SkillReconciliationReport } from '@/api/adminApi'

/* ================= 目录页（2026-10-25 用户「拆成单页，把这个 tab 撤掉，放到组里」：
   Prompt 评估拆为独立页 PromptEval.vue 并归入侧栏 Skill 组，本页只剩目录；
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

/** 退役 tab 的老深链（健康检查/漂移/对账）改投独立页；Prompt 评估同批改投新独立页 */
const RETIRED_TABS = new Set(['health', 'drift', 'recon'])
/** 旧「Prompt 评估」页签 → 独立页 /admin/prompt-eval（2026-10-25 拆页；?peTab= 原样带走） */
const LEGACY_EVAL_TAB = 'prompt-eval'
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
/** 旧评估页签 → 独立页：?peTab= 是评估页自己的内层键，原样带走（去掉宿主键 ?tab=） */
const toPromptEval = (extra: Record<string, string> = {}) =>
  void router.replace({ path: '/admin/prompt-eval', query: extra })
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
    // 旧「Prompt 评估」页签：2026-10-25 拆为独立页，老深链 /admin/skills?tab=prompt-eval → /admin/prompt-eval
    if (t === LEGACY_EVAL_TAB) {
      toPromptEval(withoutTabKey())
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
    if (t === LEGACY_EVAL_TAB) {
      intent.tab = ''
      toPromptEval()
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
const keyword = ref('')
/** 归属 Agent 筛选（P1②）：'' = 全部；'__none__' = 无归属 */
const agentFilter = ref('')

/* D3 表格增强：列显隐（持久化 / 点击外部与 Esc 关闭由共享 MkCols 组件承担；Skill 列固定）。 */
const SK_COLS_KEY = 'wf_skills_hidden_cols'
/** P95 整列恒「—」（后端无技能级 P95）→ 默认隐藏（MkCols defaultHidden：仅首访生效，已存配置尊重用户） */
const SK_COLS_DEFAULT_HIDDEN = ['p95'] as const
const skColDefs = [
  { key: 'agent', label: '归属 Agent', title: '所属顶层 Agent' },
  { key: 'version', label: '版本', title: 'Skill 定义里声明的版本号' },
  { key: 'routing', label: '路由模型', title: '生效模型。未单独配置时用平台默认，无配置数据时显示 —' },
  { key: 'calls', label: '调用', title: '统计窗口内调用次数（随窗口筛选）' },
  { key: 'p95', label: 'P95', title: '暂无数据' },
  { key: 'rate', label: '成功率', title: '窗口内成功率' },
  { key: 'last', label: '最近调用', title: '最近调用时间' },
] as const
const hiddenCols = ref<Set<string>>(new Set())

/* 移动端仅保留核心列：隐藏版本/路由/调用/P95/最近调用，减少横向滚动 */
const isNarrow = useIsNarrow()
/* 中宽档（<1600）：「最近调用」列收进 Skill 名副行——本表 1440 自然宽超容器 136px（布局量测），裁掉最次要列即收回 */
const isMid = useIsNarrow(1600)
/* 小宽档（<1320，Users 判例）：再收「版本」列——1280 带仍余 48px 容器级横滚（LAYOUT-12） */
const isSmall = useIsNarrow(1320)
const MOBILE_HIDDEN_COLS = new Set(['version', 'routing', 'calls', 'p95', 'last'])
const SMALL_HIDDEN_COLS = new Set(['version'])
const showCol = (key: string) =>
  !hiddenCols.value.has(key) &&
  !(isNarrow.value && MOBILE_HIDDEN_COLS.has(key)) &&
  !(isMid.value && key === 'last') &&
  !(isSmall.value && SMALL_HIDDEN_COLS.has(key))
/* 列菜单同源：被档位强制收起的列不出现在菜单里（菜单可勾却不见 = 说谎）；
   三档强制收起与 showCol 逐档同源（≤720 移动档此前漏了 MOBILE_HIDDEN_COLS，
   菜单里四项勾着也不显示，正是本注释自己禁止的形态） */
const menuColDefs = computed<ReadonlyArray<{ key: string; label: string; title: string }>>(() => {
  let list: ReadonlyArray<{ key: string; label: string; title: string }> = skColDefs
  if (isNarrow.value) list = list.filter((c) => !MOBILE_HIDDEN_COLS.has(c.key))
  if (isMid.value) list = list.filter((c) => c.key !== 'last')
  if (isSmall.value) list = list.filter((c) => !SMALL_HIDDEN_COLS.has(c.key))
  return list
})
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

/** 成功率含义短句（KPI 卡与列头 title 共用本页单源，避免「= 成功调用 / 总调用」逐字复读两套） */


/** 成功率单元格 title：比例 + 全站统一阈值披露；无分母说明兜底口径（不按 0% 计） */
function rowRateTitle(s: { calls: number; errors: number }): string {
  if (!s.calls) return '该窗口内暂无调用，暂无成功率'
  return `成功率 ${s.calls - s.errors}/${s.calls}。${RATE_THRESHOLD_NOTE}`
}

/** tone → 本页 sk-rate 类名（显式映射，rate-utils 只产语义 tone；ok/muted 不着色） */
const SK_RATE_TONE_CLS: Record<string, string> = {
  ok: '',
  muted: '',
  warn: 'sk-rate--warn',
  bad: 'sk-rate--bad',
}
function rateTone(s: { calls: number; errors: number }): string {
  return SK_RATE_TONE_CLS[successRateTone(s.calls, s.errors)]
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
   原型 renderSkillHub 1662-1706 的 8 列里，版本/路由模型/备用模型三列不在 live.ts 的
   LiveSkillProfile（id/name/category/agentId/agentName）里，故本页直接取两个只读端点：
   - GET /admin/skills（同 live 注册表源）：promptVersion / promptName + description
   - GET /admin/skill-model-configs/coverage：生效 model / fallbackChain（未配置=平台默认）
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
interface SkillRouteEntry { model: string | null; fallbackChain: string[] | null; tier: string }

const skillMetaById = ref<Map<string, SkillMetaEntry>>(new Map())
const coverageById = ref<Map<string, SkillRouteEntry>>(new Map())
/** coverage 是否成功拉到（空列表也算就绪）：区分「没拉到」与「确实无模型配置」 */
const coverageReady = ref(false)

/* 表格排序：默认失败数优先（问题浮顶，保持既有行为），表头可点切换。
   #107：默认键 errors 不在可见列里（表无「失败数」列），初始行序无可见列可解释，
   且点过别的表头后无法回到默认序 → 在工具条给「默认按失败数排列」可见说明 +
   非默认态一键「恢复默认序」（useTableSort.reset，此前解构未取用）。
   数据为 live 注册表全量（有界）→ 客户端排序是诚实的；截断/服务端分页列表不适用本机制。 */
const { sortState, toggle: toggleSort, sortRows, sortKey, sortDir, reset: resetSort } = useTableSort<SkillRow>({
  accessors: {
    errors: (s) => s.errors,
    /* 主行是 canonical id（2026-10-25 英文为主）：排序也按 id，否则视觉序与点击的列对不上 */
    skill: (s) => s.id,
    agent: (s) => s.agentName || s.agentId || '',
    calls: (s) => s.calls,
    rate: (s) => successRateOf(s.calls, s.errors),
    /* 2026-10-17 用户走查补列：此前这三列头不可点。版本按段补零比较（v10 不排在 v9 前）；
       最近调用用原始时间戳（lastAt 是「2 天前」文案，字符串比较无意义） */
    version: (s) => versionSortKey(s.id),
    routing: (s) => routingOf(s.id),
    last: (s) => (s.lastCalledAt ? Date.parse(s.lastCalledAt) : null)
  },
  defaultKey: 'errors',
  defaultDir: 'desc',
  storageKey: 'wf_skills_sort'
})
/** 当前是否仍在默认序（失败数降序）：非默认时工具条出「恢复默认序」按钮 */
const isDefaultSort = computed(() => sortKey.value === 'errors' && sortDir.value === 'desc')

/* 覆盖矩阵复用运行表的路由上下文（2026-10-24 合并两张重复表）：
   归属 Agent、完成度、备用链解析都从这里取，矩阵不再另查一份。
   computed 惰性求值，函数声明可后置（fallbackOf / completionBadgeOf 在下方定义）。 */
const agentLabelsBySkill = computed<Record<string, string>>(() =>
  Object.fromEntries(cards.value.map((s) => [s.id, agentLabelOf(s)]))
)
const skillNamesBySkill = computed<Record<string, string>>(() =>
  Object.fromEntries(cards.value.map((s) => [s.id, s.name || s.id]))
)
const completionBySkill = computed<Record<string, { text: string; cls: string; title: string }>>(() => {
  const out: Record<string, { text: string; cls: string; title: string }> = {}
  for (const s of cards.value) {
    const badge = completionBadgeOf(s.id)
    if (badge) out[s.id] = badge
  }
  return out
})
const fallbackBySkill = computed<Record<string, { text: string; title: string }>>(() =>
  Object.fromEntries(cards.value.map((s) => [s.id, { text: fallbackOf(s.id), title: fallbackTitleOf(s.id) }]))
)

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

/* 弹窗里的「备用模型」列依赖 registry 兜底链（/admin/model-registry）：懒加载，
   打开时才拉；拉取失败（registryReady 仍 false）时下次打开自动重试 */
watch(bulkOpen, (open) => {
  if (open && !registryReady.value) void refreshRegistry()
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

/* ---- registry 兜底链（F7-5，只读 /admin/model-registry）----
   运行时兜底来源 = skill 级 fallbackChain ?? 主模型在 llm-providers.json 的 fallbacks
   （executor.ts:378-410 / :760，超过运行时候选上限的尾部不生效）。
   「备用模型」列与「降级策略」KPI 必须给出解析后的实际链：
   显式空数组（deepseek-v4.1-flash，llm-providers.json:24）=「无（空链）」，
   不把别名成员/其他模型的降级目标张冠李戴；registry 拉不到 → —，不编造。 */
interface RegistryModelEntry { fallbacks: string[] }
const registryModels = ref<Map<string, RegistryModelEntry>>(new Map())
/** 平台默认模型（registry 解析别名后的真值）：未显式配模型的 Skill 按它解析默认链 */
const registryDefaultModel = ref('')
/** 推理档平台默认模型同上（coverage.tier=reasoning 且未配模型的行） */
const registryDefaultReasoningModel = ref('')
/** 运行时最多模型候选数（含主模型）：决定声明链实际生效的前几跳 */
const registryMaxCandidates = ref(2)
/** registry 是否成功拉到（空目录不算就绪）：区分「没拉到」与「确实无链」 */
const registryReady = ref(false)

async function refreshRegistry(): Promise<void> {
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    const data = res.data?.data as {
      models?: Array<{ id?: string; fallbacks?: unknown }>
      defaults?: { defaultModelResolved?: string | null; defaultReasoningModelResolved?: string | null }
      runtime?: { maxModelCandidates?: number }
    } | undefined
    const m = new Map<string, RegistryModelEntry>()
    for (const model of data?.models || []) {
      if (!model?.id) continue
      m.set(model.id, {
        fallbacks: Array.isArray(model.fallbacks) ? model.fallbacks.filter((x): x is string => typeof x === 'string') : []
      })
    }
    if (!m.size) throw new Error('模型目录为空')
    registryModels.value = m
    registryDefaultModel.value = String(data?.defaults?.defaultModelResolved || '')
    registryDefaultReasoningModel.value = String(data?.defaults?.defaultReasoningModelResolved || '')
    const maxCandidates = Number(data?.runtime?.maxModelCandidates)
    registryMaxCandidates.value = Number.isFinite(maxCandidates) && maxCandidates >= 1 ? maxCandidates : 2
    registryReady.value = true
  } catch {
    registryModels.value = new Map()
    registryDefaultModel.value = ''
    registryDefaultReasoningModel.value = ''
    registryReady.value = false
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
    const data = res.data?.data as { skills?: Array<{ skillId: string; model: string | null; fallbackChain: string[] | null; tier?: string }> } | undefined
    const m = new Map<string, SkillRouteEntry>()
    for (const r of data?.skills || []) {
      if (!r.skillId) continue
      m.set(r.skillId, {
        model: r.model ?? null,
        fallbackChain: Array.isArray(r.fallbackChain) ? r.fallbackChain : null,
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
/** 副行 = 中文别名（displayName）。别名与 id 相同（目录未登记中文名）或为空则不渲染。
    2026-10-25 用户「以英文为主」：主行是 canonical id，中文名降为副行（与详情页 hero 同口径）；
    同日「功能简介搬到详情页」：副行只留身份，不再拼 description。 */
function sublineOf(s: { id: string; name?: string }): string {
  const alias = (s.name || '').trim()
  return alias && alias !== s.id ? alias : ''
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

/** 版本排序键：按 Prompt 版本号数值（10 > 9），缺版本返回 null（恒排末尾） */
function versionSortKey(skillId: string): string | null {
  const v = skillMetaById.value.get(skillId)?.promptVersion
  return typeof v === 'number' ? String(v).padStart(6, '0') : null
}

/** 路由模型列：coverage 有行 → 生效 model（空=平台默认）；无行/未加载 → 「—」，不伪装成平台默认 */
function routingOf(skillId: string): string {
  if (!coverageReady.value) return '—'
  const row = coverageById.value.get(skillId)
  if (!row) return '—'
  return row.model || '平台默认'
}

function routingTitleOf(skillId: string): string {
  if (!coverageReady.value) return '模型覆盖数据未加载'
  const row = coverageById.value.get(skillId)
  if (!row) return '该 Skill 没有模型配置记录，显示 —'
  return row.model ? `生效模型：${row.model}` : '未单独配置模型：走平台默认'
}

/** Skill 无自定义链时，其生效主模型的 registry 默认兜底链（截到运行时生效上限，
    与 executor MAX_MODEL_CANDIDATES / api-config 总览同口径）；
    返回 null = 解析不到（registry 未加载 / 模型不在目录），显示层显 — 不猜 */
function registryChainOf(skillId: string): string[] | null {
  if (!coverageReady.value || !registryReady.value) return null
  const row = coverageById.value.get(skillId)
  const modelId = row?.model
    || (row?.tier === 'reasoning' ? registryDefaultReasoningModel.value : registryDefaultModel.value)
  if (!modelId) return null
  const entry = registryModels.value.get(modelId)
  if (!entry) return null
  return entry.fallbacks.slice(0, Math.max(0, registryMaxCandidates.value - 1))
}

/** 备用模型列（路由表，F7-5）：自定义兜底链优先；无 → 解析 registry 默认链
    （显式空数组显示「无（空链）」；registry/覆盖未加载或模型不在目录 → 「—」不伪装） */
function fallbackOf(skillId: string): string {
  if (!coverageReady.value) return '—'
  const row = coverageById.value.get(skillId)
  if (!row) return '—'
  if (row.fallbackChain && row.fallbackChain.length) return row.fallbackChain.join(' → ')
  const chain = registryChainOf(skillId)
  if (chain === null) return '—'
  return chain.length ? chain.join(' → ') : '无备用模型（配置为空）'
}

function fallbackTitleOf(skillId: string): string {
  if (!coverageReady.value) return '模型覆盖数据未加载'
  const row = coverageById.value.get(skillId)
  if (!row) return '该 Skill 没有备用模型配置记录，显示 —'
  if (row.fallbackChain && row.fallbackChain.length) return `Skill 自定义备用模型列表：${row.fallbackChain.join(' → ')}`
  if (!registryReady.value) return '无自定义备用模型列表。平台默认列表未加载（模型总览拉取失败或未就绪）'
  const modelId = row.model || (row.tier === 'reasoning' ? registryDefaultReasoningModel.value : registryDefaultModel.value)
  const chain = registryChainOf(skillId)
  if (chain === null) return `无自定义备用模型列表。模型「${modelId || '未知'}」不在模型目录，默认列表无法解析`
  return chain.length
    ? `无自定义备用模型列表。平台默认（${modelId}）：${chain.join(' → ')}`
    : `无自定义备用模型列表。平台默认（${modelId}）未配置备用模型，调用失败时不会自动切换`
}

/** 归属 Agent 文案（路由表 mono 副行） */
function agentLabelOf(s: { agentId: string; agentName?: string }): string {
  return s.agentName || s.agentId || '工具类'
}

/* ---- 批量模型配置弹窗的 4 张读数（原「模型路由」页签 KPI 带）---- */
/** 有生效路由标签的 Skill（含「平台默认」桶）；未加载 coverage 时为空 */
const routingLabels = computed(() =>
  coverageReady.value
    ? cards.value.map((c) => routingOf(c.id)).filter((v) => v !== '—')
    : []
)
const routeModelCount = computed<number | string>(() =>
  routingLabels.value.length ? new Set(routingLabels.value).size : '—'
)
/** 有生效路由的 Skill 数（2026-10-15 KPI 审计）：原值取 cards.length「全部 Skill」，
   与标签「已路由」矛盾——没配路由的 Skill 也被算进去了。改与同屏另两张同源（routingLabels）。 */
const routedSkillCount = computed<number | string>(() =>
  coverageReady.value ? routingLabels.value.length : '—'
)
/** 主模型覆盖 = 使用最多的那个模型占全部 Skill 的比例 */
const primaryModel = computed(() => {
  const counts = new Map<string, number>()
  for (const v of routingLabels.value) counts.set(v, (counts.get(v) || 0) + 1)
  let label = ''
  let count = 0
  for (const [k, n] of counts) if (n > count) { label = k; count = n }
  return { label, count }
})
const primaryCoverageText = computed(() =>
  routingLabels.value.length ? `${Math.round((primaryModel.value.count / cards.value.length) * 100)}%` : '—'
)
/** 降级策略副行：有自定义兜底链数 → 计数；否则 registry 默认 */
const fallbackConfigured = computed(() =>
  cards.value.filter((c) => (coverageById.value.get(c.id)?.fallbackChain?.length ?? 0) > 0).length
)
/** 主模型（覆盖占比最高）对应的 registry 模型 id：「平台默认」桶 → registry 解析后的平台默认模型 */
const primaryModelId = computed(() => {
  const label = primaryModel.value.label
  if (!label || label === '未配置') return ''
  if (label === '平台默认') return registryDefaultModel.value
  return label
})
/** 主模型的 registry 默认链（截到运行时生效上限）；null = 解析不到（不猜） */
const primaryRegistryChain = computed<string[] | null>(() => {
  if (!registryReady.value || !primaryModelId.value) return null
  const entry = registryModels.value.get(primaryModelId.value)
  if (!entry) return null
  return entry.fallbacks.slice(0, Math.max(0, registryMaxCandidates.value - 1))
})
/** 降级策略卡（原硬编码「自动」删）：真实口径 = 自定义兜底链计数；无自定义链时给出
    registry 默认链的解析结果（F7-5）；覆盖/registry 未加载显 —，不伪装。
    2026-10-17 用户走查「怎么高度还不一样呢」：数值位此前塞整句
    「无备用模型（平台默认配置为空）」，28px 下换两行，把整排 KPI 从 128px 撑到 165px，
    切页签时读数带高度跳动。数值位只留短状态，原因与链明细进 hint/title。 */
const fallbackPolicyText = computed(() => {
  if (!coverageReady.value) return '—'
  if (fallbackConfigured.value > 0) return `${fallbackConfigured.value} 个自定义`
  if (!registryReady.value) return '—'
  const chain = primaryRegistryChain.value
  if (chain === null) return '—'
  return chain.length ? `${chain.length} 个备用模型` : '无备用模型'
})
</script>

<style scoped>
/* ================= 宿主布局（tab 宿主：运行 tab 内滚；评估面板自管） ================= */
/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （mk-primitives.css），本页不再私持拷贝。 */

/* 列表视图（行可点：cursor/行内焦点环由共享 .mk-table--click 提供，不再私持拷贝） */
/* 批量模型配置弹窗（2026-10-24）：对照表 + 套用表单列多，走宽档面板；
   body 允许内部横滚，不让宽表把面板撑破 */
.skills-bulk { width: min(var(--mk-modal-w-wide-xxl, 1160px), 100%); }
.skills-bulk .mk-modal__body { min-width: 0; }
/* 统计刷新失败条：卡内位置 + 不参与 fill 伸缩 */
.sk-live-err { flex: none; margin: 10px 16px 0; }
/* Skill 格 min-width：本表约 9 列固定布局，Skill 名列会被调用/通过率等数字列挤窄
   （2026-10-02 视觉核对实测主行截成 4 字）——给内容格兜底宽度 */
.sk-cell { display: flex; align-items: center; gap: 10px; min-width: 200px; }
/* 原型 .tbl：自动布局 + 单元格 nowrap（列按内容自然分宽，不再 colgroup 定宽） */
/* 固定列宽（2026-10-22）：Skill/归属/路由模型三列在 auto 布局下按当页最长名称分宽，
   翻页跳动；fixed 后按表头定死，余量按权重摊开。宽度按 1280 现值校准，1200 档无横滚。
   2026-10-24 撤「完成度」「类别」两列后腾出的 154px 归 Skill 名（220→300，主行原本最挤）
   与「最近调用」（90→110），总量仍小于撤列前，横滚性质不变。 */
.sk-c-skill { width: 300px; }
.sk-c-agent { width: 140px; }
.sk-c-version { width: 96px; }
.sk-c-routing { width: 170px; }
/* 调用列宽按四字表头「调用次数」定（2026-10-24 用户「调用次数就写调用次数就可以了」） */
.sk-c-calls { width: 84px; }
.sk-c-p95 { width: 56px; }
.sk-c-rate { width: 70px; }
.sk-c-last { width: 110px; }
.sk-table td { white-space: nowrap; }/* fixed 档列宽即契约：200px 兜底会把 Skill 名顶出单元格 */
.sk-table .sk-cell { min-width: 0; }
/* 中文名主行（正文重色）；副行 = description（原型 .sub），缺失回落 skill id（等宽）。
   截断上限统一引用 token（--mk-cell-main-max）：自动布局下防长 Skill 名/长副行独吃列宽 */
.sk-name-main {
  font-weight: 700;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 主行是 canonical id（2026-10-25 英文为主）：机器串走等宽，与版本/路由模型列同一语义 */
.sk-name-main--id { font-family: var(--mk-mono); }
/* 主行 id 是可点的入口（蓝 = 可交互）；按钮复位成文本排版，行高与纯文本行一致 */
.sk-name-link {
  padding: 0; border: 0; background: none; text-align: left;
  color: var(--mk-blue); cursor: pointer; font-size: inherit;
}
.sk-name-link:hover { text-decoration: underline; }
/* 版本格 → 详情「版本」页签（回滚入口与读数同格） */
.sk-version-link {
  padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--mk-blue); font-family: var(--mk-mono);
}
.sk-version-link:hover { text-decoration: underline; }
/* 副行里的排障入口（原操作列 100px 整列空白撤除后并入副行） */
.sk-fail-link { flex: none; font-size: var(--mk-fs-micro); white-space: nowrap; }
.sk-sub {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  line-height: 1.5;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 副行容器：<1600 最近调用列收进来（.sk-recent），消掉 1440 的表格横向滚动 */
.sk-subline { display: flex; align-items: baseline; gap: 8px; min-width: 0; max-width: var(--mk-cell-main-max); }
.sk-subline .sk-sub { flex: 0 1 auto; max-width: none; }
.sk-recent { flex: none; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 路由模型名较长（deepseek-v4.1-flash ~180px）：中宽档封顶省略，全名走 title
   （1440 收掉「最近调用」列后仍差 ~40px 横滚，此处补齐） */
.sk-model { display: inline-block; max-width: 148px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
/* 中宽档单元格水平 padding 16→12（9 列回收 72px）：收掉「最近调用」列后仍余 ~20px
   min-content 赤本、操作列被裁；削列宽是打地鼠，padding 档一次收净 */
@media (max-width: 1599px) {
  .sk-cell .mk-cell-main { max-width: 200px; }
  .mk-table th, .mk-table td { padding-inline: 12px; }
}
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sk-dot--ok { background: var(--mk-green); }
.sk-dot--idle { background: #c3cede; }
/* P2（2026-10-04 全站评审）：琥珀「有失败」中间档（errors>0 但成功率 ≥90%）；
   红档才闪——闪键帧此前引用 SkillReconciliation scoped 编译名，本页从未生效（死动画），补本地定义 */
.sk-dot--warn { background: var(--mk-amber); }
.sk-dot--error { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
@keyframes sk-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
/* 指标阈值着色 */
.sk-rate--bad { color: var(--mk-red); font-weight: 700; }
.sk-rate--warn { color: var(--mk-amber); font-weight: 700; }
/* 列表成功率列：只留百分比（2026-10-15 用户拍板撤比例条），阈值着色（bad 红/warn 琥珀）在数字上 */
.sk-rate b { font-variant-numeric: tabular-nums; }

/* 归属 Agent 标签 */
.sk-agent-tag {
  display: inline-flex;
  align-items: center;
  max-width: 128px; /* 中宽档省略（全名走 title）：1440 收净横滚的最后一档 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--mk-line);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
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

/* 工具条「归属 Agent」label（原型 toolbar 1667）：12px 重字，与下拉同排 */

/* 大屏档位（mk 体系：2000 ≈×1.15，2800 ≈×1.17，3600 ≈×1.3） */
@media (min-width: 2000px) {
  .sk-dot { width: 10px; height: 10px; }
  .sk-agent-tag { font-size: var(--mk-fs-micro); padding: 3px 11px; }

  .sk-name-main { font-size: var(--mk-fs-micro); }
  .sk-sub { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .sk-dot { width: 12px; height: 12px; }
  .sk-agent-tag { font-size: var(--mk-fs-micro); padding: 4px 13px; }

  .sk-name-main { font-size: var(--mk-fs-micro); }
  .sk-sub { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .sk-dot { width: 14px; height: 14px; }
  .sk-agent-tag { font-size: var(--mk-fs-body); padding: 5px 15px; }

  .sk-name-main { font-size: var(--mk-fs-emphasis); }
  .sk-sub { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：Skill 运行 ================= */
html[data-theme='dark'] {
  .sk-agent-tag { background: var(--wf-bg-hover); color: var(--mk-muted); }
}

</style>
