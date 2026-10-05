<template>
  <div class="mk-page mk-page--fill skills-host">
    <!-- 页头（newui/admin pagehead）：页名对齐原型（Skill 与提示词）+ 随 tab 切换的口径副文。
         2026-10-04 页头状态条退役：运行读数迁下方 MkKpi 卡带（仅 run 页签渲染）；
         「失败节点」不再单列——卡头「仅看需关注」pill 已带同源计数并承载筛选。
         唯一页级动作 = Prompt 评估页签的「批量跑评估」（原 /admin/prompt-eval 页头动作随
         场景下线上移至此，经面板 defineExpose 驱动）；run/模型路由页签仍无页级动作 -->
    <MkPageHead title="Skill 与提示词" :sub="headSub">
      <template #actions>
        <!-- running：批量/试跑期间互斥禁用，防止并发多批真实 LLM 调用重复烧 token -->
        <button
          v-if="tab === 'prompt-eval'"
          type="button"
          class="mk-btn mk-btn--primary"
          :disabled="!pePanel?.canRunBatch || pePanel?.running"
          @click="pePanel?.runBatch()"
        >{{ pePanel?.running ? '评估运行中…' : '批量跑评估' }}</button>
      </template>
    </MkPageHead>
    <section v-if="tab === 'run'" class="mk-kpi-grid" aria-label="Skill 运行统计">
      <MkKpi label="Skill" :value="liveLoading && !cards.length ? '…' : cards.length" :title="skillCountHint || '全量注册的 Skill 数'" />
      <!-- live 三态（评审「状态三态缺失」）：对账加载中 → 「…」；加载失败 → 「?」（读不到 ≠ 0）；
           就绪且为 0 → 红 0（全 draft 是真异常，必须显性报警而非静默消失） -->
      <MkKpi
        label="live"
        :value="recLoading ? '…' : recError ? '?' : liveCount"
        :tone="!recLoading && !recError && liveCount === 0 ? 'bad' : ''"
        hint="ACTIVE prompt 生效"
        :title="recLoading
          ? '完成度对账加载中，live 计数暂不可用'
          : recError
            ? `完成度对账加载失败：${recError}；读不到对账 ≠ 0 个 live`
            : liveCount === 0
              ? '对账已就绪且 status=live 的 Skill 数为 0：所有 Skill 均未走完上线门槛（draft → live），属真异常'
              : '完成度对账 status=live（ACTIVE prompt 生效）的 Skill 数'"
      />
      <MkKpi
        label="成功率"
        :value="rangeRefreshing ? '…' : (overallRateText ?? '—')"
        :tone="overallRateTone"
        :hint="totalCalls ? `${okCalls}/${totalCalls} · ${rangeLabel}` : rangeLabel"
        :title="`窗口内成功率 = ${RATE_MEANING}；${RATE_THRESHOLD_NOTE}`"
      />
      <MkKpi
        label="平均耗时"
        :value="rangeRefreshing ? '…' : avgLatencyText"
        hint="成功调用按调用量加权"
        :title="`统计窗口：${rangeLabel}`"
      />
      <MkKpi v-if="idleCount > 0" label="空闲" :value="idleCount" title="窗口内无调用的 Skill 数（空闲是信号不是故障，不着色）" />
    </section>

    <!-- 视图切换（原型 .tabs 下划线页签：12px/600、激活蓝字+2px 蓝下划线、通栏底线；
         2026-10-01 由 mk-pills 胶囊迁入——胶囊只做筛选 chips，视图/分区切换归页签）：
         Skill 运行 / 模型路由 / Prompt 评估。健康检查 · 漂移 · 对账三 tab 已退役（2026-09-29 用户拍板）：
         三者本就是同一份报表的三刀，合一后独立成 /admin/health-center，侧栏落在「系统」组。
         Prompt 评估 2026-10-04 由独立场景 /admin/prompt-eval 折入（内层用例/历史页签用 ?peTab=） -->
    <div class="tabs skills-tabs" role="tablist" aria-label="Skill 视图切换">
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'run'" @click="switchTab('run')">Skill 运行</button>
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'model-routing'" @click="switchTab('model-routing')">模型路由</button>
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'prompt-eval'" @click="switchTab('prompt-eval')">Prompt 评估</button>
    </div>

    <!-- ===== Tab1: Skill 运行（原 Skills.vue 全量内容） ===== -->
    <template v-if="tab === 'run'">

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" :aria-pressed="!onlyAttention" @click="onlyAttention = false">全部</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" :aria-pressed="onlyAttention" @click="onlyAttention = true">仅看需关注<span class="mk-pill__count">{{ errorCount }}</span></button>
          </div>
          <!-- P1② 归属 Agent 筛选（原型 renderSkillHub 1662-1706 工具条）：
               label「归属 Agent」+ select（全部 Agent + 每 Agent 名（N）），change 即筛。
               2026-10-05 CP1：全部档去计数（与 KPI「Skill N」/ 卡头计数三处复读，单源交 KPI） -->
          <label class="sk-filter-label" for="skillAgentFilter">归属 Agent</label>
          <select id="skillAgentFilter" v-model="agentFilter" class="mk-filter__select" aria-label="按归属 Agent 筛选">
            <option value="">全部 Agent</option>
            <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}（{{ a.count }}）</option>
          </select>
          <select v-model="categoryFilter" class="mk-filter__select" aria-label="按类别筛选">
            <option value="">全部类别</option>
            <option v-for="c in categoryOptions" :key="c" :value="c">{{ categoryText(c) }}</option>
          </select>
          <select v-model="statsRange" class="mk-filter__select" aria-label="统计窗口">
            <option value="7d">近 7 天</option>
            <option value="24h">近 24 小时</option>
            <option value="30d">近 30 天</option>
            <option value="all">全部</option>
          </select>
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / ID / 类别" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
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

      <MockSkeletonTable v-if="liveLoading && !cards.length" :cols="11" />
      <template v-else>
      <!-- 列表视图：列对齐 + 排序，问题浮顶 -->
      <div class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed，2026-10-01 对齐 Users 判例），
             单元格 nowrap、列按内容自然分宽；Skill 名/副行两行都设 max-width 截断兜底，
             防长名单列独吃宽度（上限引用 --mk-cell-main-max token） -->
        <table v-if="filtered.length" class="mk-table sk-table">
          <!-- P1① 列结构对齐原型 renderSkillHub 1662-1706 的 8 列：
               Skill / 归属 Agent / 版本 / 路由模型 / 24h 调用 / P95 / 通过率 / 完成度。
               数据来源核查见脚本「路由 · 版本元数据」小节；P95 接口缺失 → 恒「—」且默认隐藏。
               原型没有、但本页有的真实信息（类别 / 最近调用）排在原型列之后，操作列收尾。 -->
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('skill')"
                @click="toggleSort('skill')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('skill')">Skill<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('agent')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('agent')"
                @click="toggleSort('agent')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('agent')">归属 Agent<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- 版本：/admin/skills 的 definition.version（原型「版本」列） -->
              <th v-if="showCol('version')" scope="col">版本</th>
              <!-- 路由模型：skill-model-configs/coverage 的生效 model；未配置 → 「平台默认」 -->
              <th v-if="showCol('routing')" scope="col" title="skill-model-configs 生效模型；未单独配置 = 平台默认；无覆盖行 = —">路由模型</th>
              <!-- 原型「24h 调用」：本页窗口由「统计窗口」下拉决定（默认近 7 天），故列名取中性「调用」，口径随窗口 -->
              <th
                v-if="showCol('calls')"
                scope="col"
                class="mk-th--right mk-th--sortable"
                :aria-sort="sortState('calls')"
                @click="toggleSort('calls')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('calls')" title="统计窗口内调用次数（随「统计窗口」下拉切换，默认近 7 天）">调用<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- P95 占位：后端仅日志聚合提供 p50/p99，无技能级 P95；不编造数字。
                   整列恒「—」无信息量（评审 P3）→ 默认隐藏，「列」菜单可手动开启 -->
              <th v-if="showCol('p95')" scope="col" class="mk-th--right" title="接口未提供技能级 P95（后端仅日志聚合 p50/p99）→ 恒「—」；默认隐藏，可在「列」菜单开启">P95</th>
              <th
                v-if="showCol('rate')"
                scope="col"
                class="mk-th--right mk-th--sortable"
                :aria-sort="sortState('rate')"
                @click="toggleSort('rate')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('rate')" :title="`窗口内成功率（= ${RATE_MEANING}）；${RATE_THRESHOLD_NOTE}`">成功率<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <!-- 完成度 = 对账 completion status（draft → live）；原列名「状态」与行首健康点双语义 → 更名 -->
              <th
                v-if="showCol('status')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('status')"
                @click="toggleSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('status')" title="完成度对账 status（draft → live）">完成度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('cat')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('cat')"
                @click="toggleSort('cat')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('cat')">类别<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="showCol('last')">最近调用</th>
              <th scope="col" class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in paged" :key="s.id" class="sk-row" tabindex="0" @click="openSubPage('skill', s.id)" @keydown.enter.self.prevent="openSubPage('skill', s.id)">
              <td>
                <div class="sk-cell">
                  <span class="sk-dot" :class="`sk-dot--${s.health}`" role="img" :aria-label="healthLabel(s.health)" :title="healthLabel(s.health)"></span>
                  <div class="mk-cell-main">
                    <strong class="sk-name-main mk-ellipsis" :title="s.name">{{ s.name }}</strong>
                    <!-- 原型副行 = desc：/admin/skills 的 description；缺失时回落显示 skill id。
                         <1600 时「最近调用」列收进副行（showCol 同源），消掉中宽档表格横滚 -->
                    <span class="sk-subline">
                      <span class="sk-sub" :class="{ 'sk-sub--id': !descOf(s.id) }" :title="descOf(s.id) || s.id">{{ descOf(s.id) || s.id }}</span>
                      <span v-if="!showCol('last')" class="sk-recent" :title="'最近调用 ' + (s.lastAt || '—')">{{ s.lastAt }}</span>
                    </span>
                  </div>
                </div>
              </td>
              <td v-if="showCol('agent')">
                <span v-if="s.agentId" class="sk-agent-tag" :title="s.agentId">{{ s.agentName || s.agentId }}</span>
                <span v-else class="mk-na">工具类</span>
              </td>
              <td v-if="showCol('version')"><span class="mono">{{ versionOf(s.id) }}</span></td>
              <td v-if="showCol('routing')"><span class="mono sk-model" :title="routingTitleOf(s.id)">{{ routingOf(s.id) }}</span></td>
              <td v-if="showCol('calls')"><span class="mono">{{ s.calls }}</span></td>
              <td v-if="showCol('p95')"><span class="mk-na" title="接口未提供技能级 P95（后端仅日志聚合 p50/p99）">—</span></td>
              <td v-if="showCol('rate')">
                <!-- 行级设计（批C）：数字+比例条（与网格卡 sk-card__rate 同语言，消灭同页双形态）；
                     精度/阈值/兜底走 rate-utils 单点（99.9% 不再显示 100%，无调用显「—」不显 0%） -->
                <div class="sk-rate" :class="rateTone(s)" :title="rowRateTitle(s)">
                  <b>{{ successRateText(s.calls, s.errors) || '—' }}</b>
                  <span v-if="s.calls" class="sk-rate__bar" aria-hidden="true"><i :style="{ width: (successRateOf(s.calls, s.errors) ?? 0) + '%' }"></i></span>
                </div>
              </td>
              <td v-if="showCol('status')">
                <!-- 状态列（原「完成度」列折入）：对账 completion → mk-badge--rec-* pill；
                     对账未就绪三态：加载中 / 加载失败 / 不在对账口径（此前失败与无数据同显「—」，整列塌成无意义符号） -->
                <span
                  v-if="completionBadgeOf(s.id)"
                  class="mk-badge"
                  :class="completionBadgeOf(s.id)!.cls"
                  :title="completionBadgeOf(s.id)!.title"
                >{{ completionBadgeOf(s.id)!.text }}</span>
                <span v-else-if="recLoading" class="mk-na" title="对账报告加载中，状态暂不可用">…</span>
                <span v-else-if="recError" class="mk-na sk-rec-fail" :title="`对账加载失败：${recError}`">对账失败</span>
                <span v-else class="mk-na" title="对账报告中无此 Skill（外挂能力等不在对账口径内）">—</span>
              </td>
              <td v-if="showCol('cat')"><span class="mk-badge mk-badge--muted" :title="s.category">{{ categoryText(s.category) }}</span></td>
              <td v-if="showCol('last')"><span :class="{ 'mk-na': !s.calls }">{{ s.lastAt }}</span></td>
              <td>
                <div class="mk-actions">
                  <!-- 轻运营直达：跳过抽屉一跳，直接进设计页「协议」页签改提示词
                       （原型操作列：文字小钮 .btn--sm 形态，对齐 Users 判例） -->
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDesign(s.id)">设计</button>
                  <!-- 失败行直达证据（评审「异常→动作→证据断链」：排障从 4 跳压到 1 跳）：
                       复用 store.investigateAgent（agent+status=err intent 深链执行日志）；
                       行级拿不到错误类别，errorCategory 置空交日志页自筛 -->
                  <button v-if="s.errors > 0" type="button" class="mk-btn mk-btn--sm" title="跳转执行日志：已过滤该 Skill 的失败调用" @click.stop="investigateAgent(s.id)">查失败</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <MkEmptyState
        v-if="skillsError && !cards.length"
        title="Skill 数据加载失败"
        :description="skillsError"
        action-text="重试"
        @action="retrySkills"
      />
      <MkEmptyState
        v-else-if="!filtered.length"
        :title="onlyAttention ? '没有需关注的 Skill' : keyword ? '当前筛选无 Skill' : '暂无运行数据'"
        :description="onlyAttention ? '窗口内没有成功率低于 90% 的节点（需关注 = 健康点红档）。' : keyword ? '换个关键词试试。' : ''"
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
    </template>

    <!-- ===== Tab2: 模型路由（原型 renderSkillHub 1665-1681 routing 分支） =====
         原型结构：4 metricCard（承载模型 / 已路由 Skill / 主模型覆盖 / 降级策略）
         + 「Skill 模型路由」小节头 + 5 列表（Skill / 归属 Agent / 路由模型 / 备用模型 / 状态）。
         覆盖矩阵（SkillModelCoverage）保留为增强，置于原型结构之下。 -->
    <div v-if="tab === 'model-routing'" class="mk-card mk-card--fill sk-routing">
      <div class="sk-routing__top">
        <!-- 4 卡数据全部从现有 skills 列表 + coverage 派生（去重模型数 / 已路由 Skill 数 /
             主模型覆盖占比 / 降级策略），不引入新端点、不编造 -->
        <div class="mk-kpi-grid">
          <MkKpi
            label="承载模型"
            :value="routeModelCount"
            hint="去重模型"
            :title="routeModelTitle"
          />
          <MkKpi
            label="已路由 Skill"
            :value="cards.length"
            hint="全部 Skill"
            title="主目录 Skill 数（不含外挂能力）"
          />
          <MkKpi
            label="主模型覆盖"
            :value="primaryCoverageText"
            :hint="primaryModelLabel"
            :title="primaryCoverageTitle"
          />
          <!-- 降级策略（原硬编码 value="自动" 删）：真实口径 = 自定义兜底链计数，未加载显 — 不伪装 -->
          <MkKpi
            label="降级策略"
            :value="fallbackPolicyText"
            :title="fallbackPolicyTitle"
          />
        </div>
        <div class="sk-routing__head">
          <span class="mk-card__title">Skill 模型路由</span>
          <span class="mk-card__meta">覆盖矩阵见下方</span>
        </div>
      </div>

      <div class="sk-routing__scroll">
        <table v-if="cards.length" class="mk-table sk-table">
          <thead>
            <tr>
              <th scope="col">Skill</th>
              <th scope="col">归属 Agent</th>
              <th scope="col">路由模型</th>
              <th scope="col">备用模型</th>
              <th scope="col">完成度</th>
            </tr>
          </thead>
          <tbody>
            <!-- 原型行 data-action="open-skill"：本页行点击同样进 Skill 详情 -->
            <tr v-for="s in cards" :key="s.id" class="sk-row" tabindex="0" @click="openSubPage('skill', s.id)" @keydown.enter.self.prevent="openSubPage('skill', s.id)">
              <td><strong class="sk-name-main mk-ellipsis" :title="s.name">{{ s.name }}</strong></td>
              <td><span class="mono sk-routing__sub" :title="s.agentId || '工具类'">{{ agentLabelOf(s) }}</span></td>
              <td><span class="mono" :title="routingTitleOf(s.id)">{{ routingOf(s.id) }}</span></td>
              <td><span class="mono sk-routing__sub" :title="fallbackTitleOf(s.id)">{{ fallbackOf(s.id) }}</span></td>
              <td>
                <span v-if="completionBadgeOf(s.id)" class="mk-badge" :class="completionBadgeOf(s.id)!.cls" :title="completionBadgeOf(s.id)!.title">{{ completionBadgeOf(s.id)!.text }}</span>
                <span v-else-if="recLoading" class="mk-na" title="对账报告加载中，状态暂不可用">…</span>
                <span v-else class="mk-na" title="对账报告中无此 Skill（外挂能力等不在对账口径内）">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <MkEmptyState v-else title="暂无 Skill" description="主目录没有可路由的 Skill。" />

        <!-- 覆盖矩阵（技能 × 通道 × 参数 × 兜底）：原型无此块，作为增强保留在原型结构之下 -->
        <div class="sk-routing__matrix">
          <SkillModelCoverage />
        </div>
      </div>
    </div>

    <!-- ===== Tab3: Prompt 评估（原 /admin/prompt-eval 独立场景，2026-10-04 折入；旧 URL 走
         router 重定向 ?tab=cases|runs → ?peTab=）。内层 评估用例/评估历史 页签寻址用 ?peTab=
         （宿主 ?tab= 归本页页签所有，不共键）；主操作「批量跑评估」在宿主页头（pePanel ref 驱动） -->
    <PromptEvalPanel v-else-if="tab === 'prompt-eval'" ref="pePanel" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { skillStatOf, openSubPage, isLive, intent, investigateAgent } from './store'
import { liveSkillProfiles, liveSkillStatsRange, refreshLiveSkills, liveFailures, liveLoading, errMsg } from './live'
import { categoryText } from './statusText'
import { COMPLETION_META, completionMetaOf } from './glossaryMeta'
import { EXTRA_CAPABILITY_SKILLS } from './capabilityCatalog'
import { RATE_THRESHOLD_NOTE, successRateOf, successRateText, successRateTone, rateToneOf } from './rate-utils'
import MockSkeletonTable from './SkeletonTable.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import Pagination from './Pagination.vue'
import { useIsNarrow } from './useIsNarrow'
import { useTableSort } from './useTableSort'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import SkillModelCoverage from './SkillModelCoverage.vue'
import { adminSkillsApi, type SkillCompletion, type SkillReconciliationReport } from '@/api/adminApi'

/* ================= 宿主：Skill 运行 · 模型路由 · Prompt 评估（原 5 tab，健康中心 2026-09-29
   独立成页；Prompt 评估 2026-10-04 由 /admin/prompt-eval 场景折入，Skill 组侧栏 3→2） =================
   健康中心由独立场景折入本宿主 tab（侧栏 15→14 项）；?tab= 双向同步，深链/刷新/前进后退可寻址；
   唯一 tab 控件 = 本行页签（健康中心内不再嵌套 pills，R1）。 */
const SKILLS_TABS = ['run', 'model-routing', 'prompt-eval'] as const
type SkillsTab = (typeof SKILLS_TABS)[number]
const tab = ref<SkillsTab>('run')
const route = useRoute()
const router = useRouter()
/* Prompt 评估面板动作面（defineExpose）：页头「批量跑评估」的禁用态与点击经模板 ref 驱动 */
interface PromptEvalPanelExpose { running: boolean; canRunBatch: boolean; runBatch: () => Promise<void> }
const pePanel = ref<PromptEvalPanelExpose | null>(null)
const PromptEvalPanel = defineAsyncComponent(() => import('./PromptEvalPanel.vue'))
/** 轻运营直达：列表行「设计」→ 设计页「协议」页签（改提示词的唯一编辑点） */
function openDesign(id: string) {
  void router.push(`/admin/skills/${encodeURIComponent(id)}?tab=protocol`)
}

/** 退役 tab 的老深链（健康检查/漂移/对账）改投独立页；只认现役 tab，其余回落 run */
const RETIRED_TABS = new Set(['health', 'drift', 'recon'])
const toHealthCenter = (extra: Record<string, string> = {}) =>
  void router.replace({ path: '/admin/health-center', query: extra })

watch(
  () => route?.query?.tab,
  (t) => {
    if (typeof t === 'string' && RETIRED_TABS.has(t)) {
      // 老书签 / 旧文档链接：/admin/skills?tab=health → /admin/health-center（?recon=/?diff= 等定位参数一并带走）
      const { tab: _drop, ...rest } = route.query as Record<string, string>
      toHealthCenter(rest)
      return
    }
    const v = typeof t === 'string' && (SKILLS_TABS as readonly string[]).includes(t) ? (t as SkillsTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'run') tab.value = 'run'
  },
  { immediate: true }
)
function switchTab(t: SkillsTab) {
  tab.value = t
  if (route && router && route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}
/* 页头副文（原型 1698）：随 tab 切换口径——运行=目录/版本/提示词，模型路由=路由与降级策略，
   Prompt 评估=用例集与历史运行（沿原独立页副文） */
const headSub = computed(() =>
  tab.value === 'model-routing'
    ? 'Skill 的模型路由与降级策略'
    : tab.value === 'prompt-eval'
      ? '提示词质量评测 · 用例集与历史运行'
      : 'Skill 目录、版本与提示词管理'
)
/* 跨页深链：intent.tab 指向退役 tab（旧调用方还在传 health/drift/recon）也改投独立页 */
watch(
  () => intent.tab,
  (t) => {
    if (!t) return
    if (RETIRED_TABS.has(t)) {
      intent.tab = ''
      toHealthCenter()
      return
    }
    if ((SKILLS_TABS as readonly string[]).includes(t)) {
      tab.value = t as SkillsTab
      intent.tab = ''
    }
  },
  { immediate: true }
)
type Health = 'ok' | 'idle' | 'warn' | 'error'
/** 目录表行（档案 + 实时统计 + 健康态） */
interface SkillRow {
  id: string
  name: string
  category: string
  agentId: string
  agentName?: string
  calls: number
  errors: number
  avgMs: number
  lastAt: string
  health: Health
}

const onlyAttention = ref(false)
const keyword = ref('')
const categoryFilter = ref('')
/** 归属 Agent 筛选（P1②）：'' = 全部；'__none__' = 无归属（工具类） */
const agentFilter = ref('')

/* D3 表格增强：列显隐（持久化 / 点击外部与 Esc 关闭由共享 MkCols 组件承担；Skill 列固定）。
   列序对齐原型 8 列（Skill/归属 Agent/版本/路由模型/调用/P95/通过率/状态），
   随后是本页独有的真实列（类别/最近调用），操作列固定收尾。 */
const SK_COLS_KEY = 'wf_skills_hidden_cols'
/** P95 整列恒「—」（后端无技能级 P95）→ 默认隐藏（MkCols defaultHidden：仅首访生效，已存配置尊重用户） */
const SK_COLS_DEFAULT_HIDDEN = ['p95'] as const
const skColDefs = [
  { key: 'agent', label: '归属 Agent', title: '所属顶层 Agent' },
  { key: 'version', label: '版本', title: 'registry definition.version' },
  { key: 'routing', label: '路由模型', title: '生效模型；未配置=平台默认；无覆盖行=—' },
  { key: 'calls', label: '调用', title: '统计窗口内调用次数（随窗口筛选）' },
  { key: 'p95', label: 'P95', title: '接口未提供技能级 P95，恒「—」；默认隐藏' },
  { key: 'rate', label: '成功率', title: '窗口内成功率' },
  { key: 'status', label: '完成度', title: '完成度对账 status（draft→live）' },
  { key: 'cat', label: '类别', title: 'Skill 类别' },
  { key: 'last', label: '最近调用', title: '最近调用时间' },
] as const
const hiddenCols = ref<Set<string>>(new Set())

/* 移动端仅保留核心列：隐藏版本/路由/调用/P95/类别/最近调用，减少横向滚动 */
const isNarrow = useIsNarrow()
/* 中宽档（<1600）：「最近调用」列收进 Skill 名副行——本表 1440 自然宽超容器 136px（布局量测），裁掉最次要列即收回 */
const isMid = useIsNarrow(1600)
/* 小宽档（<1320，Users 判例）：再收「版本」列——1280 带仍余 48px 容器级横滚（LAYOUT-12） */
const isSmall = useIsNarrow(1320)
const MOBILE_HIDDEN_COLS = new Set(['version', 'routing', 'calls', 'p95', 'cat', 'last'])
const SMALL_HIDDEN_COLS = new Set(['version'])
const showCol = (key: string) =>
  !hiddenCols.value.has(key) &&
  !(isNarrow.value && MOBILE_HIDDEN_COLS.has(key)) &&
  !(isMid.value && key === 'last') &&
  !(isSmall.value && SMALL_HIDDEN_COLS.has(key))
/* 列菜单同源：被档位强制收起的列不出现在菜单里（菜单可勾却不见 = 说谎） */
const menuColDefs = computed<ReadonlyArray<{ key: string; label: string; title: string }>>(() => {
  let list: ReadonlyArray<{ key: string; label: string; title: string }> = skColDefs
  if (isMid.value) list = list.filter((c) => c.key !== 'last')
  if (isSmall.value) list = list.filter((c) => !SMALL_HIDDEN_COLS.has(c.key))
  return list
})
const statsRange = liveSkillStatsRange

/** 类别下拉动态化：取当前档案实际出现的类别（覆盖 standard/teaching/simulation/tool） */
const categoryOptions = computed(() => {
  const seen: string[] = []
  cards.value.forEach((c) => {
    const key = String(c.category || '').toLowerCase()
    if (key && !seen.includes(key)) seen.push(key)
  })
  return seen
})

/** 归属 Agent 下拉选项（P1② 原型 toolbar）：按 agentId 聚合 + 计数；无归属归「工具类」 */
interface AgentOption { id: string; label: string; count: number }
const agentOptions = computed<AgentOption[]>(() => {
  const m = new Map<string, AgentOption>()
  for (const c of cards.value) {
    const id = c.agentId || '__none__'
    const label = c.agentName || c.agentId || '工具类'
    const cur = m.get(id)
    if (cur) cur.count += 1
    else m.set(id, { id, label, count: 1 })
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh'))
})

/** 成功率含义短句（KPI 卡与列头 title 共用本页单源，避免「= 成功调用 / 总调用」逐字复读两套） */
const RATE_MEANING = '成功调用 / 总调用'

/** 成功率单元格 title：比例 + 全站统一阈值披露；无分母说明兜底口径（不按 0% 计） */
function rowRateTitle(s: { calls: number; errors: number }): string {
  if (!s.calls) return '窗口内无调用：无分母不显示成功率（不按 0% 计）'
  return `成功率 ${s.calls - s.errors}/${s.calls}；${RATE_THRESHOLD_NOTE}`
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
watch(statsRange, async () => {
  rangeRefreshing.value = true
  try {
    await refreshLiveSkills()
    liveSkillsError.value = ''
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

/* 表格排序：默认失败数优先（问题浮顶，保持既有行为），表头可点切换。
   数据为 live 注册表全量（有界）→ 客户端排序是诚实的；截断/服务端分页列表不适用本机制。 */
const { sortState, toggle: toggleSort, sortRows, sortKey, sortDir } = useTableSort<SkillRow>({
  accessors: {
    errors: (s) => s.errors,
    skill: (s) => s.name || s.id,
    agent: (s) => s.agentName || s.agentId || '',
    calls: (s) => s.calls,
    /** 状态列排序 = 完成度五档序号（0=draft … 4=live，无对账行排末尾） */
    status: (s) => completionRank(s.id),
    rate: (s) => successRateOf(s.calls, s.errors),
    cat: (s) => s.category || ''
  },
  defaultKey: 'errors',
  defaultDir: 'desc',
  storageKey: 'wf_skills_sort'
})

const filtered = computed(() => {
  let list = cards.value
  // "仅看需关注"只含失败节点；"从未调用"（idle）是常态不是问题
  if (onlyAttention.value) list = list.filter((c) => c.health === 'error')
  if (agentFilter.value === '__none__') list = list.filter((c) => !c.agentId)
  else if (agentFilter.value) list = list.filter((c) => c.agentId === agentFilter.value)
  if (categoryFilter.value) list = list.filter((c) => String(c.category || '').toLowerCase() === categoryFilter.value)
  const q = keyword.value.trim().toLowerCase()
  if (q) list = list.filter((c) => `${c.name} ${c.id} ${c.category}`.toLowerCase().includes(q))
  return sortRows(list)
})

/* 「仅看需关注」计数与筛选谓词同源（D3）：health==='error'（成功率<90% 红档）。
   旧实现用 errors>0 计数，与点击后 health==='error' 的谓词不同源（徽标 25 vs 点出 9），
   成功率 90–97% 的大失败量节点被漏掉。 */
const errorCount = computed(() => cards.value.filter((c) => c.health === 'error').length)

/* ===== Skill 运营概览（sk-dash：窗口内聚合 + 结论 + KPI） ===== */
const totalCalls = computed(() => cards.value.reduce((a, c) => a + c.calls, 0))
const totalErrors = computed(() => cards.value.reduce((a, c) => a + c.errors, 0))
const okCalls = computed(() => Math.max(0, totalCalls.value - totalErrors.value))
/** 口径提示：Skill 运行页不含外挂能力（MCP + 能力 Skill），而健康中心/对账的登记总数含它们——避免「31/28/3」三处数字无从解释 */
const skillCountHint = computed(
  () => (EXTRA_CAPABILITY_SKILLS.length
    ? `不含 ${EXTRA_CAPABILITY_SKILLS.length} 个外挂能力（见「外挂能力」页）；健康中心 / 对账的登记总数含它们`
    : ''),
)
/** 状态条成功率：精度/阈值/兜底走 rate-utils 单点（P1#26：1 位小数，99.9% 不再显示 100%） */
const overallRateText = computed(() => successRateText(totalCalls.value, totalErrors.value))
/** 2026-10-04 状态条退役：成功率 KPI tone——rate-utils 的 muted（无分母）对 MkKpi 显空档 */
const overallRateTone = computed<'' | 'ok' | 'warn' | 'bad'>(() => {
  const t = successRateTone(totalCalls.value, totalErrors.value)
  return t === 'muted' ? '' : t
})
const idleCount = computed(() => cards.value.filter((c) => c.calls === 0).length)
const avgLatencyMs = computed(() => {
  const called = cards.value.filter((c) => c.calls > 0 && c.avgMs > 0)
  if (!called.length) return null
  return Math.round(called.reduce((a, c) => a + c.calls * c.avgMs, 0) / called.reduce((a, c) => a + c.calls, 0))
})
const avgLatencyText = computed(() => (avgLatencyMs.value == null ? '—' : avgLatencyMs.value >= 1000 ? `${(avgLatencyMs.value / 1000).toFixed(1)}s` : `${avgLatencyMs.value}ms`))
const RANGE_LABELS: Record<string, string> = { '7d': '近 7 天', '24h': '近 24 小时', '30d': '近 30 天', all: '全部时间' }
const rangeLabel = computed(() => RANGE_LABELS[statsRange.value] || '近期')

const isFiltered = computed(() => onlyAttention.value || !!keyword.value.trim() || !!categoryFilter.value || !!agentFilter.value)
function clearFilters() {
  onlyAttention.value = false
  keyword.value = ''
  categoryFilter.value = ''
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
watch([onlyAttention, keyword, categoryFilter, agentFilter, sortKey, sortDir], () => {
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
})

onMounted(() => {
  refreshReconciliation()
  // 版本/描述（/admin/skills）与路由模型/兜底链（skill-model-configs/coverage）：
  // live 层未透出这两组字段，本页按原型列结构自取（只读数据源，不改 live.ts）
  void refreshSkillMeta()
  void refreshCoverage()
})

/** 完成度五档色标（draft → live）；文案单源：glossaryMeta.ts（与后端 glossary-content 对齐） */
const recStatusText = (status: string) =>
  completionMetaOf(status)?.label || status

/** 目录表完成度列数据源：复用对账面板 completion（live 模式一次拉取合并加载），
    skillId → SkillCompletion；目录行不在对账口径（外挂等）时返回 null 显示 — */
const recCompletionOf = computed(() => {
  const m = new Map<string, SkillCompletion>()
  for (const r of recReport.value?.items ?? []) m.set(r.skillId, r.completion)
  return m
})

/** 状态条「N 个 live」（原型 statusbar meta）：完成度对账 status=live（已上线）的 Skill 数 */
const liveCount = computed(() =>
  cards.value.filter((c) => recCompletionOf.value.get(c.id)?.status === 'live').length
)

/** 完成度序号（0=draft … 4=live；无对账行 → null 排末尾），供表头排序 */
function completionRank(skillId: string): number | null {
  const c = recCompletionOf.value.get(skillId)
  if (!c) return null
  const i = COMPLETION_META.findIndex((m) => m.status === c.status)
  return i >= 0 ? i : null
}

function completionBadgeOf(skillId: string): { cls: string; text: string; title: string } | null {
  const c = recCompletionOf.value.get(skillId)
  if (!c) return null
  return { cls: `mk-badge--rec-${c.status}`, text: recStatusText(c.status), title: recGateDetail(c) }
}

/** 行健康点：live 绿、差集红、其余灰 */
/** 完成度徽标 tooltip：首个失败档的依据文本 */
function recGateDetail(completion: SkillCompletion): string {
  const gates: Array<[string, string]> = [
    ['draft', '户口簿'],
    ['handlerReady', 'handler 注册'],
    ['coreReady', 'core 文件'],
    ['fieldsSynced', '字段路由'],
    ['live', 'ACTIVE prompt'],
  ]
  for (const [key, label] of gates) {
    const gate = completion.gates[key as keyof typeof completion.gates]
    if (!gate?.ok) return `${label}：${gate?.detail || '未通过'}`
  }
  return '全部门槛通过'
}

/* ================= 路由 · 版本元数据（P1① 原型列结构的数据来源） =================
   原型 renderSkillHub 1662-1706 的 8 列里，版本/路由模型/备用模型三列不在 live.ts 的
   LiveSkillProfile（id/name/category/agentId/agentName）里，故本页直接取两个只读端点：
   - GET /admin/skills（同 live 注册表源）：definition.version + description
   - GET /admin/skill-model-configs/coverage：生效 model / fallbackChain（未配置=平台默认）
   列可得性核查：
     Skill ✓ / 归属 Agent ✓ / 版本 ✓ / 路由模型 ✓ / 调用 ✓（stats.callCount，窗口随筛选）
     / P95 ✗（后端仅日志聚合 p50/p99，无技能级 P95 → 占位「—」）/ 通过率 ✓（stats.successRate）
     / 状态 ✓（对账 completion status）
   本页不外发这两个请求的结果，也不改动 live.ts 的档案口径。 */
interface SkillMetaEntry { version: string; description: string }
interface SkillRouteEntry { model: string | null; fallbackChain: string[] | null }

const skillMetaById = ref<Map<string, SkillMetaEntry>>(new Map())
const coverageById = ref<Map<string, SkillRouteEntry>>(new Map())
/** coverage 是否成功拉到（空列表也算就绪）：区分「没拉到」与「确实无模型配置」 */
const coverageReady = ref(false)

async function refreshSkillMeta(): Promise<void> {
  try {
    const res = await adminSkillsApi.getSkills({ range: statsRange.value })
    const body = res.data?.data ?? res.data ?? {}
    const items: Array<Record<string, unknown>> = Array.isArray(body) ? body : body.skills || body.items || []
    const m = new Map<string, SkillMetaEntry>()
    for (const s of items) {
      const id = String(s.skillId || s.id || s.name || '')
      if (!id) continue
      m.set(id, { version: String(s.version || ''), description: String(s.description || '') })
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
    const data = res.data?.data as { skills?: Array<{ skillId: string; model: string | null; fallbackChain: string[] | null }> } | undefined
    const m = new Map<string, SkillRouteEntry>()
    for (const r of data?.skills || []) {
      if (!r.skillId) continue
      m.set(r.skillId, { model: r.model ?? null, fallbackChain: Array.isArray(r.fallbackChain) ? r.fallbackChain : null })
    }
    coverageById.value = m
    coverageReady.value = true
  } catch {
    coverageById.value = new Map()
    coverageReady.value = false
  }
}

/** Skill 副行：description 优先，缺失回落 id（原型 .sub） */
function descOf(skillId: string): string {
  return skillMetaById.value.get(skillId)?.description || ''
}

/** 版本列：registry definition.version（如 1.1.0）→ 显示 v1.1.0；缺失「—」 */
function versionOf(skillId: string): string {
  const v = skillMetaById.value.get(skillId)?.version
  if (!v) return '—'
  return /^v/i.test(v) ? v : `v${v}`
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
  if (!row) return '覆盖矩阵无此 Skill 行（未登记 skill-model-config）'
  return row.model ? `生效模型：${row.model}` : '未单独配置模型：走平台默认'
}

/** 备用模型列（路由表）：兜底链 → 「A → B」；无 → 「—」 */
function fallbackOf(skillId: string): string {
  const chain = coverageById.value.get(skillId)?.fallbackChain
  return chain && chain.length ? chain.join(' → ') : '—'
}

function fallbackTitleOf(skillId: string): string {
  const chain = coverageById.value.get(skillId)?.fallbackChain
  return chain && chain.length ? `兜底链：${chain.join(' → ')}` : '无自定义兜底链（registry 默认）'
}

/** 归属 Agent 文案（路由表 mono 副行） */
function agentLabelOf(s: { agentId: string; agentName?: string }): string {
  return s.agentName || s.agentId || '工具类'
}

/* ---- 路由页签 4 metricCard 派生（全部来自 cards + coverage，不新增端点） ---- */
/** 有生效路由标签的 Skill（含「平台默认」桶）；未加载 coverage 时为空 */
const routingLabels = computed(() =>
  coverageReady.value
    ? cards.value.map((c) => routingOf(c.id)).filter((v) => v !== '—')
    : []
)
const routeModelCount = computed<number | string>(() =>
  routingLabels.value.length ? new Set(routingLabels.value).size : '—'
)
const routeModelTitle = computed(() =>
  routingLabels.value.length
    ? `去重模型 ${new Set(routingLabels.value).size} 个（含「平台默认」桶）`
    : '模型覆盖数据未加载或无生效路由'
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
const primaryModelLabel = computed(() => primaryModel.value.label || '未配置')
const primaryCoverageTitle = computed(() =>
  routingLabels.value.length
    ? `${primaryModel.value.count} / ${cards.value.length} 个 Skill 使用「${primaryModel.value.label}」`
    : '模型覆盖数据未加载'
)
/** 降级策略副行：有自定义兜底链数 → 计数；否则 registry 默认 */
const fallbackConfigured = computed(() =>
  cards.value.filter((c) => (coverageById.value.get(c.id)?.fallbackChain?.length ?? 0) > 0).length
)
/** 降级策略卡（原硬编码「自动」）：真实口径 = 自定义兜底链计数；覆盖数据未加载显 — */
const fallbackPolicyText = computed(() => {
  if (!coverageReady.value) return '—'
  return fallbackConfigured.value > 0 ? `${fallbackConfigured.value} 个自定义兜底链` : 'registry 默认'
})
const fallbackPolicyTitle = computed(() =>
  coverageReady.value
    ? `模型重试耗尽后按兜底链自动切换；${fallbackConfigured.value > 0 ? `当前 ${fallbackConfigured.value} 个 Skill 配了自定义兜底链` : '无自定义兜底链：走 registry 默认'}`
    : '兜底配置未加载（skill-model-configs/coverage 拉取失败或未就绪）'
)
</script>

<style scoped>
/* ================= 宿主布局（tab 宿主：运行 tab 内滚；模型路由 tab 自管） ================= */
/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （mk-primitives.css），本页不再私持拷贝。 */

/* 列表视图 */
.sk-row { cursor: pointer; }
/* Skill 格 min-width：本表 11 列自动布局，Skill 名列会被调用/通过率等数字列挤窄
   （2026-10-02 视觉核对实测主行截成 4 字）——给内容格兜底宽度 */
.sk-cell { display: flex; align-items: center; gap: 10px; min-width: 200px; }
/* 原型 .tbl：自动布局 + 单元格 nowrap（列按内容自然分宽，不再 colgroup 定宽） */
.sk-table td { white-space: nowrap; }
/* 中文名主行（正文重色）；副行 = description（原型 .sub），缺失回落 skill id（等宽）。
   截断上限统一引用 token（--mk-cell-main-max）：自动布局下防长 Skill 名/长副行独吃列宽 */
.sk-name-main {
  font-weight: 700;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
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
/* 回落显示 skill id 时保留等宽语义 */
.sk-sub--id { font-family: var(--mk-mono); }
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
/* 完成度列：对账拉取失败的行内提示（红字 + title 带原因） */
.sk-rec-fail { color: var(--mk-red); font-weight: 700; }

/* 指标阈值着色 */
.sk-rate--bad { color: var(--mk-red); font-weight: 700; }
.sk-rate--warn { color: var(--mk-amber); font-weight: 700; }
/* 列表成功率列（批C）：数字+比例条 */
.sk-rate { display: grid; gap: 3px; justify-items: end; }
.sk-rate b { font-variant-numeric: tabular-nums; }
.sk-rate__bar { display: block; width: 56px; height: 4px; border-radius: var(--mk-radius-pill); background: var(--mk-line); overflow: hidden; }
.sk-rate__bar i { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: var(--mk-green); }
.sk-rate--warn .sk-rate__bar i { background: var(--mk-amber); }
.sk-rate--bad .sk-rate__bar i { background: var(--mk-red); }

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
.sk-filter-label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); white-space: nowrap; }

/* ===== 模型路由页签（原型 renderSkillHub 1665-1681 routing 分支）=====
   KPI 栅格 + 小节头固定在上，路由表与覆盖矩阵共用下方滚动区 */
.sk-routing__top { flex: none; padding: 14px 16px 0; display: grid; gap: 12px; }
.sk-routing__head { display: flex; align-items: baseline; gap: 10px; }
.sk-routing__scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 16px; }
.sk-routing__sub { color: var(--mk-muted); }
/* 覆盖矩阵（增强块）与原型路由表分隔 */
.sk-routing__matrix { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--mk-line); }

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
