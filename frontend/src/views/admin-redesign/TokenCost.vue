<template>
  <div class="mk-page">
    <!-- 页头（newui/admin 原型 pagehead）：标题 + 口径副文 + 主操作上移；
         原状态条承担的「身份+口径+刷新」迁入页头，三个数字仍归下方 KPI 卡
         （避免同一批数在页头与 KPI 区各说一遍，2026-09-29 口径延续）。
         sub 用原型固定文案（2026-10-01 页头对齐批）；动态窗口/测试流量口径
         转为页名悬停 hint——筛选条上窗口 pill 与 DataScopeToggle 本就可见 -->
    <MkPageHead
      title="成本分析"
      sub="按模型、Skill 与时间维度追踪模型调用成本"
      :hint="`近 ${days} 天 · ${includeTest ? '含测试' : '仅真实用户'}`"
    >
      <template #actions>
        <!-- 导出报表（原型 pagehead 动作位真实化）：当前窗口三张明细表合一个 CSV，客户端生成 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="!summary || summaryEmpty" title="导出当前窗口的 Skill 明细 / 用户排行 / 模型排行（CSV）" @click="exportCsv">
          导出报表
        </button>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="() => load(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>

    <!-- 调用成本 2026-09-29 收编进概览区（原私有 cost-strip 金额条与全站 KPI 语言不一致；
         单价未配置/加载失败态由 KPI 卡 hint + tone 承担）。2026-10-01 成本批：成本升为第一张卡 -->

    <!-- 加载失败（优先于空态） -->
    <MkEmptyState
      v-if="loadFailed && !summary"
      icon="◌"
      min
      title="Token 成本数据加载失败"
      description="无法从后端拉取用量统计，请重试或稍后再来。"
      action-text="重试"
      @action="() => load(true)"
    />

    <!-- 首载骨架：KPI 卡 + 趋势图 + 排行占位（对齐全站 MockSkeleton 语言） -->
    <template v-else-if="!summary && loading">
      <div class="tc-filterbar tc-filterbar--skeleton"></div>
      <section class="mk-kpi-grid">
        <div v-for="i in 4" :key="i" class="mk-kpi tc-skel-kpi"><MkSkeleton w="60%" :h="26" /><MkSkeleton w="40%" :h="12" /></div>
      </section>
      <section class="mk-card">
        <div class="mk-card__head"><MkSkeleton w="180" :h="14" /></div>
        <MkSkeleton class="tc-skel-pad" variant="bars" :count="7" :h="150" :radius="4" />
      </section>
      <section class="mk-card">
        <div class="mk-card__head"><MkSkeleton w="180" :h="14" /></div>
        <MkSkeleton class="tc-skel-pad" variant="rows" :count="4" :h="22" :radius="8" />
      </section>
    </template>

    <!-- 加载完成（含空窗口）：后端 getSummary 恒返回对象，「!summary」整页空态不可达——空窗口
         改判 summary.totals.calls===0，在筛选条之下渲染一次 MkEmptyState，替掉 4 处零值卡 + 「暂无数据」 -->
    <template v-else>
      <!-- 筛选条（范围 + 数据范围，独立一行，对齐 TraceWaterfall 筛选条形态）：空窗口同样常驻，窗口切换不被遮 -->
      <div class="tc-filterbar">
        <div class="mk-pills tc-pills">
          <button
            v-for="p in rangePills"
            :key="p.days"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': days === p.days }"
            :aria-pressed="days === p.days"
            @click="days = p.days"
          >
            {{ p.label }}
          </button>
        </div>
        <DataScopeToggle v-if="isLive" v-model="includeTest" />
      </div>
      <MkEmptyState
        v-if="summaryEmpty"
        min
        icon="◌"
        title="这个时间窗暂无 LLM 调用"
        :description="`近 ${days} 天${includeTest ? '（含测试）' : ''}没有任何调用记录，产生调用后这里展示 Token 用量、趋势与排行。`"
        :action-text="days !== 90 ? '看近 90 天' : ''"
        @action="days = 90"
      />
      <template v-else>
      <!-- 概览卡（统一走共享 .mk-kpi-grid + MkKpi；原型 renderCost 1771-1772 metricCard 四卡）。
           数据源核查（2026-10-01，只读后端 /admin/token-cost/summary）：
           金额已随接口返回（totals.usd / pricedCalls / callsMissingPricing），但**只按所选窗口聚合**——
           无分日金额（trend 仅 date/tokens/calls/failed）、无自然月窗口、无会话维度、无缓存命中明细
           （agent_call_logs 无 cachedTokens 列）。故按可得口径如实重排，缺项不编造金额/不拿 0 冒充：
           ① 调用成本＝当前窗口金额（窗口随 pills 切换，口径见 hint）；
           ② 单次调用均值＝金额 ÷ 已定价调用（原型「单会话均值」无会话维度，如实降级到每次调用）；
           ③ 总 Token＝用量基线（成本卡的分母，保留）；
           ④ P1#25（2026-10-02 人类可读性）：原「缓存命中率」恒「—」死卡（接口无此口径）占 KPI 位，
              换活卡「失败调用」——totals.failed 后端已返回，失败信号值得首屏一位。 -->
      <section class="mk-kpi-grid">
        <!-- hint = 原型 metricCard 的一短句口径；长解释收进卡 title 悬停（复刻调整 2026-10-02：
             此前 28px 数字下拖整句「待补单价模型 3 个：deepseek-v4-flash、…」小字，非原型节奏）。
             P1#25：单价未配置态可点直达「模型与接入」补单价（决策就近，不再只留一句提示）。 -->
        <MkKpi
          label="调用成本"
          :value="costLoading ? '…' : costFailed ? '加载失败' : costUsd !== null ? `≈ $${fmtCostUsd(costUsd)}` : (costPricedCalls === 0 && costMissingCalls === 0) ? '无调用' : '单价未配置'"
          :tone="costFailed ? 'warn' : ''"
          :hint="costHintShort"
          :title="costHint"
          :clickable="pricingMissing"
          @click="pricingMissing && goModelConfig()"
        />
        <MkKpi
          label="单次调用均值"
          :value="costLoading ? '…' : costFailed ? '—' : costPerCall !== null ? `≈ $${fmtCostUsd(costPerCall)}` : '—'"
          :hint="perCallHintShort"
          :title="perCallHint"
        />
        <MkKpi label="总 Token" :value="summary ? fmtTokens(summary.totals.tokens) : '—'" :hint="`prompt ${summary ? fmtTokens(summary.totals.promptTokens) : '—'} · completion ${summary ? fmtTokens(summary.totals.completionTokens) : '—'} · ${summary ? summary.totals.calls : '—'} 次调用`" />
        <MkKpi
          label="失败调用"
          :value="failedCallsText"
          :tone="failedCalls > 0 ? 'bad' : ''"
          :hint="failedCalls > 0 ? `占总调用 ${failedPct}（重试后终态失败）` : '无失败调用'"
          :title="failedHint"
        />
      </section>

      <!-- 趋势图（原型 renderCost 1773-1777：近 7 天成本趋势 · barchart + sub「单位：元」）。
           数据源核查：/admin/token-cost/summary 的 trend 只有 {date,tokens,calls,failed}，**无分日金额**，
           无法画「元」柱；故如实画 Token 单柱并在卡头写明单位（不假装是钱），同时淘汰原双柱的 failed
           系列（失败数移入卡尾 note 与柱 title，不再与用量混读）。 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <!-- 卡头 = 原型形态（title + 单位 sub）；口径细节收 title 悬停，右侧只留跨页跳转。
               P1#25：「接口未提供金额」暴露实现细节 → 「暂无分日金额」（原因留 title） -->
          <div class="tc-card-head__main" title="本页为 token-cost 端点精确聚合（含重试后终态失败）· 口径：本地自然日；趋势接口暂无分日金额，无法画金额柱；总览「LLM 用量」卡为近 7 天汇总 hero">
            <h3 class="mk-card__title">近 {{ days }} 天用量趋势</h3>
            <span class="mk-card__meta">单位：Token（暂无分日金额）</span>
          </div>
          <div class="tc-head-links">
            <button type="button" class="mk-link" @click="goOverview">总览趋势 →</button>
            <button type="button" class="mk-link" @click="goExecLogs()">逐调用明细 →</button>
          </div>
        </div>
        <!-- 趋势柱：走全 admin 统一图表语言 OvBars（2026-09-29 自 MkChart/ECharts 换入）。
             2026-10-01 成本批：原 Token+failed 双柱改为单柱序列（金额缺失，单位=Token）。 -->
        <OvBars v-if="trend.length" :cols="trendCols" :bar-width="44" :min-bars-height="150" />
        <p v-if="trend.length" class="mk-card__note">
          合计 {{ fmtTokens(trend.reduce((acc, d) => acc + d.tokens, 0)) }} token · {{ trend.reduce((acc, d) => acc + d.calls, 0) }} 次调用 · 失败 {{ trend.reduce((acc, d) => acc + d.failed, 0) }} 次
        </p>
        <p v-else class="mk-card__note">近 {{ days }} 天暂无调用记录。</p>
      </section>

      <!-- 按 Skill 成本明细（原型 renderCost 1778-1784：Skill/调用/Token 用量/成本/占比 五列，
           占比 = meter + mono%）。后端 by-skill 条目已带成本桶（usd/pricedCalls/callsMissingPricing），
           故补真实金额列；单价未配置的 Skill 显式写「单价未配置」且不计入占比（不拿 0 冒充金额）。 -->
      <section class="mk-card tc-card tc-card--skill">
        <div class="mk-card__head">
          <h3 class="mk-card__title">按 Skill 成本明细</h3>
          <div class="mk-card__head-right">
            <span class="mk-card__meta">{{ bySkill.length }} 个<template v-if="skillAllUnpriced"> · 均未配置单价（成本列以 — 表示）</template><template v-else-if="!skillAll && bySkill.length > skillLimit"> · 显示前 {{ skillLimit }}</template></span>
            <button
              v-if="bySkill.length > skillLimit"
              type="button"
              class="tc-more"
              @click="skillAll = !skillAll"
            >
              {{ skillAll ? '收起' : `查看全部 ${bySkill.length}` }}
            </button>
          </div>
        </div>
        <div v-if="skillRows.length" class="tc-skilltable" role="table" aria-label="按 Skill 成本明细">
          <div class="tc-skilltable__head" role="row">
            <span role="columnheader">Skill</span>
            <span role="columnheader">调用</span>
            <span role="columnheader">Token 用量</span>
            <span role="columnheader">成本</span>
            <span role="columnheader">占比</span>
          </div>
          <!-- EG19：整行可点下钻，键盘等价 tabindex + Enter/Space（此前 div role=row 无 tabindex，键盘不可达） -->
          <div
            v-for="r in skillRows"
            :key="r.key"
            class="tc-skilltable__row"
            role="row"
            tabindex="0"
            :title="skillRowTitle(r)"
            @click="goSkillLogs(r)"
            @keydown.enter.prevent="goSkillLogs(r)"
            @keydown.space.prevent="goSkillLogs(r)"
          >
            <span class="tc-st__name" role="cell"><strong :title="r.display || r.key">{{ r.display || r.key }}</strong></span>
            <span class="tc-st__num" role="cell">{{ r.calls }}</span>
            <span class="tc-st__num" role="cell">{{ fmtTokens(r.tokens) }}</span>
            <span class="tc-st__cost" role="cell">{{ skillAllUnpriced ? '—' : skillRowCost(r) }}</span>
            <span class="tc-st__share" role="cell">
              <span class="mk-minibar"><span class="mk-minibar__fill" :style="{ width: skillShareW(r) }"></span></span>
              <span class="tc-st__pct">{{ skillSharePct(r) }}</span>
            </span>
          </div>
        </div>
        <p v-if="skillRows.length" class="mk-card__note">
          成本＝已定价调用金额合计（USD）· 单价未配置的 Skill 不计入占比 · 点击行可到执行日志看该 Skill 逐调用明细<template v-if="skillCostTotal <= 0">（当前无已定价调用，占比按 Token 计）</template>
        </p>
        <p v-else class="mk-card__note">暂无数据。</p>
      </section>

      <div class="tc-ranks">
        <section class="mk-card tc-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">用户用量排行</h3>
            <div class="mk-card__head-right">
              <!-- D13：中小用户此前不可见——加按 用户ID/昵称/邮箱 的服务端搜索（不改动 summary/趋势） -->
              <MkFilterSearch v-model="userQuery" placeholder="搜索用户 ID / 昵称 / 邮箱" />
              <span class="mk-card__meta">{{ userQuery ? `匹配 ${byUser.length}` : `Top ${byUser.length}` }}<template v-if="!userAll && byUser.length > userLimit"> · 显示前 {{ userLimit }}</template></span>
              <button
                v-if="byUser.length > userLimit"
                type="button"
                class="tc-more"
                @click="userAll = !userAll"
              >
                {{ userAll ? '收起' : `查看全部 ${byUser.length}` }}
              </button>
            </div>
          </div>
          <TcRankTable v-if="byUser.length" :items="userRows" variant="user" :total-tokens="totalTokens" />
          <p v-else class="mk-card__note">{{ userQuery ? `没有匹配「${userQuery}」的用户` : '暂无数据。' }}</p>
        </section>

        <section class="mk-card tc-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">模型用量排行</h3>
            <span class="mk-card__meta">{{ byModel.length }} 个</span>
          </div>
          <TcRankTable v-if="byModel.length" :items="byModel" variant="model" :total-tokens="totalTokens" />
          <p v-else class="mk-card__note">暂无数据。</p>
        </section>
      </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isLive, intent, tokenCostCacheKey, tokenCostFilters } from './store'
import { errMsg, isPageCacheFresh, markPageFetched } from './live'
import { adminTokenCostApi } from '@/api/adminApi'
import DataScopeToggle from './DataScopeToggle.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import OvBars from './OvBars.vue'
import TcRankTable, { type RankRow } from './TcRankTable.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import { toast } from '@/utils/toast'

interface Summary {
  days: number
  includeTest: boolean
  totals: { tokens: number; promptTokens: number; completionTokens: number; calls: number; failed: number }
  trend: Array<{ date: string; tokens: number; calls: number; failed: number }>
}

// 筛选状态存于 store（与金额条同源）；此处以可写计算属性保持既有模板绑定
const days = computed({
  get: () => tokenCostFilters.days,
  set: (v: number) => { tokenCostFilters.days = v }
})
const includeTest = computed({
  get: () => tokenCostFilters.includeTest,
  set: (v: boolean) => { tokenCostFilters.includeTest = v }
})
const loading = ref(false)
const loadFailed = ref(false)

const summary = ref<Summary | null>(null)
/* by-skill 条目在后端 RankEntry（= CostBucket）上已带成本字段；
   本地接口补类型，供「按 Skill 成本明细」渲染真实金额列与金额占比 */
interface SkillCostRow extends RankRow {
  usd?: number | null
  pricingKnown?: boolean
  pricedCalls?: number
  callsMissingPricing?: number
}
const bySkill = ref<SkillCostRow[]>([])
const byUser = ref<RankRow[]>([])
const byModel = ref<RankRow[]>([])

/** Skill 排行默认展示行数；超出可一键展开全部 */
const skillLimit = 6
const skillAll = ref(false)

/** 用户排行默认展示行数（与模型卡等高，避免右列过长失衡）；超出可一键展开全部 */
const userLimit = 5
const userAll = ref(false)

/* D13：by-user 此前只拉 Top-20，中小用户（如 7 天 10 万 token 的测试账号）在任何视图不可见，
   且无按用户搜索/下钻。现拉取上限抬到后端封顶 100，并加按 用户ID/昵称/邮箱 的服务端搜索
   （后端 /by-user 增 q 过滤；列表仍是待复习/用量倒序切片展示）。 */
const userFetchLimit = 100
const userQuery = ref('')
let userSeq = 0
let userQueryTimer: ReturnType<typeof setTimeout> | null = null

/** by-user 参数装配：q 仅在有关键词时带出（避免空串污染后端过滤） */
function fetchByUser() {
  const params: { days?: number; includeTest?: boolean; limit?: number; q?: string } = {
    days: days.value,
    includeTest: includeTest.value,
    limit: userFetchLimit,
  }
  const q = userQuery.value.trim()
  if (q) params.q = q
  return adminTokenCostApi.getByUser(params)
}
/** 仅重拉用户排行（搜索变更时，不动 summary/趋势/明细），并丢弃过期响应 */
async function loadByUser() {
  const seq = ++userSeq
  try {
    const res = await fetchByUser()
    if (seq !== userSeq) return
    byUser.value = (res.data?.data?.items ?? []) as RankRow[]
    userAll.value = false
  } catch {
    /* 排行属辅助信息：失败保留旧值，不弹错遮挡主表 */
  }
}
watch(userQuery, () => {
  if (userQueryTimer) clearTimeout(userQueryTimer)
  userQueryTimer = setTimeout(() => { void loadByUser() }, 300)
})
onBeforeUnmount(() => {
  if (userQueryTimer) clearTimeout(userQueryTimer)
})

const rangePills = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
]

const trend = computed(() => summary.value?.trend || [])
const totalTokens = computed(() => summary.value?.totals.tokens || 0)
/* 空窗口判据：后端 getSummary 恒返回对象（totals 全 0），「!summary」整页空态不可达；
   以 calls === 0 判空，筛选项（时间窗/测试流量）切换后用户仍可换窗自救 */
const summaryEmpty = computed(() => !!summary.value && summary.value.totals.calls === 0)
const skillRows = computed(() => bySkill.value.slice(0, skillAll.value ? bySkill.value.length : skillLimit))
const userRows = computed(() => byUser.value.slice(0, userAll.value ? byUser.value.length : userLimit))

/* 单次调用均值（原型「单会话均值」的可得口径）：仅按已定价调用折算。
   token-cost 只给 per-user/model/skill 聚合，**无会话维度**，如实不称「会话」。 */
const costPerCall = computed(() =>
  costUsd.value !== null && costPricedCalls.value > 0 ? costUsd.value / costPricedCalls.value : null
)
const perCallHint = computed(() => {
  if (costLoading.value) return '金额统计中'
  if (costFailed.value) return '金额统计拉取失败，可刷新重试'
  if (costUsd.value === null) return '无已定价调用，暂不可算'
  return `近 ${days.value} 天 · 按 ${costPricedCalls.value} 次已定价调用折算（接口无会话维度）`
})

/* Skill 明细表占比分母：优先已定价金额合计；全未定价时退回 Token 占比（并在表尾注明） */
const skillCostTotal = computed(() =>
  bySkill.value.reduce((acc, r) => acc + (typeof r.usd === 'number' ? r.usd : 0), 0)
)
function skillRowCost(r: SkillCostRow): string {
  if (typeof r.usd === 'number') return `≈ $${fmtCostUsd(r.usd)}`
  if ((r.callsMissingPricing ?? 0) > 0) return '单价未配置'
  return '—'
}
/** P2（2026-10-04 全站评审）：全部 Skill 均未定价时，成本列整列同词「单价未配置」收敛为
    卡头 meta 一句状态（行内显「—」，表尾 note 已有解释不丢信息）；混合定价时恢复逐行显示。 */
const skillAllUnpriced = computed(() =>
  bySkill.value.length > 0 && bySkill.value.every((r) => typeof r.usd !== 'number')
)
function skillShareNum(r: SkillCostRow): number {
  const total = skillCostTotal.value
  if (total > 0) return typeof r.usd === 'number' ? (r.usd / total) * 100 : 0
  return totalTokens.value > 0 ? (r.tokens / totalTokens.value) * 100 : 0
}
function skillShareW(r: SkillCostRow): string {
  const p = skillShareNum(r)
  return `${Math.max(p > 0 ? 3 : 0, p)}%`
}
function skillSharePct(r: SkillCostRow): string {
  const p = skillShareNum(r)
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}
function skillRowTitle(r: SkillCostRow): string {
  return `${r.display || r.key} · ${r.calls} 次调用 · Token ${fmtTokens(r.tokens)} · 成本 ${skillRowCost(r)} · 点击查看该 Skill 的逐调用明细`
}

/* 成本卡副行（长版，收进 KPI 卡 title 悬停）：数值本身只给结论。
   原型此位为「今日成本·预算」——接口无分日金额也无预算配置，故如实给当前窗口口径。 */
const costHint = computed(() => {
  if (costLoading.value) return '金额统计中'
  if (costFailed.value) return '金额统计拉取失败，可刷新重试；不影响下方逐调用明细'
  const window = `近 ${days.value} 天`
  if (costUsd.value !== null) {
    const priced = `${window} · 已定价 ${costPricedCalls.value} 次`
    return costMissingCalls.value > 0 ? `${priced} · ${costMissingCalls.value} 次未定价（未计入）` : priced
  }
  if (costPricedCalls.value === 0 && costMissingCalls.value === 0) return `${window}没有带 token 的 LLM 调用`
  const missing = missingPricingModels.value
  return missing.length
    ? `${window} · 暂不展示金额 · 待补单价模型 ${missing.length} 个：${missing.join('、')}；点击本卡直达「模型与接入」补单价`
    : `${window} · models.config.ts 的 pricing 尚未填权威单价，暂不展示金额；点击本卡直达「模型与接入」补单价`
})

/* KPI hint 短口径（原型 metricCard 的 hint 是一短句）：长解释走卡 title 悬停 */
const costHintShort = computed(() => {
  if (costLoading.value) return '金额统计中'
  if (costFailed.value) return '金额统计失败'
  if (costUsd.value !== null) return `近 ${days.value} 天 · 已定价 ${costPricedCalls.value} 次`
  if (costPricedCalls.value === 0 && costMissingCalls.value === 0) return `近 ${days.value} 天无调用`
  const n = missingPricingModels.value.length
  // P2（2026-10-04 全站评审）：「单价未配置」已在卡值位出现，hint 不再复读同一状态词
  return `近 ${days.value} 天${n > 0 ? ` · 待补 ${n} 个模型单价` : ''} · 点击去模型接入`
})
const perCallHintShort = computed(() => {
  if (costLoading.value) return '金额统计中'
  if (costFailed.value || costPerCall.value === null) return '无已定价调用'
  return `按 ${costPricedCalls.value} 次已定价调用折算`
})

/* 导出报表（原型 pagehead 动作位真实化）：当前窗口三张明细表合一个 CSV，客户端从
   已加载数据生成；BOM 头保证 Excel 打开中文不乱码；未定价成本如实写「单价未配置」 */
function exportCsv() {
  if (!bySkill.value.length) return
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const sharePct = (tokens: number) =>
    totalTokens.value > 0 ? ((tokens / totalTokens.value) * 100).toFixed(1) : '0.0'
  const lines: string[] = [
    `成本分析 · 近 ${days.value} 天 · ${includeTest.value ? '含测试' : '仅真实用户'} · 导出于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '[按 Skill 成本明细]',
    'Skill,调用,Token,prompt,completion,成本USD,占比%',
    ...bySkill.value.map((r) =>
      [esc(r.display || r.key), r.calls, r.tokens, r.promptTokens ?? '', r.completionTokens ?? '',
        typeof r.usd === 'number' ? r.usd.toFixed(4) : '单价未配置', sharePct(r.tokens)].join(',')),
    '',
    '[用户用量排行]',
    '用户,邮箱,调用,失败,Token,占比%',
    ...byUser.value.map((r) =>
      [esc(r.display), esc(r.email || ''), r.calls, r.failed, r.tokens, sharePct(r.tokens)].join(',')),
    '',
    '[模型用量排行]',
    '模型,调用,失败,Token,占比%',
    ...byModel.value.map((r) =>
      [esc(r.display), r.calls, r.failed, r.tokens, sharePct(r.tokens)].join(',')),
  ]
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `token-cost-${days.value}d-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`报表已导出（${bySkill.value.length} 个 Skill · 近 ${days.value} 天）`)
}

/* 跨页互跳：成本聚合页 ⇄ 明细页（执行日志行级 token）/ 总览趋势
   口径说明：本页为 token-cost 端点精确聚合（含重试终态失败）；执行日志展示逐调用行级 token 明细；
   总览「LLM 用量」卡为近 7 天汇总 hero。三处同域但粒度/窗口不同，互跳避免口径黑盒。 */
/* P1#25（2026-10-02 人类可读性）：goExecLogs 支持携 agentFilter 深链——Skill 明细行可点，
   跳执行日志即得该 Skill 的故障/用量视图（ExecLogs 已消费 intent.agentFilter；AdminConsole
   按 intentQueryParams 把筛选合进 URL，刷新/分享可还原） */
function goExecLogs(agentFilter = '') {
  intent.agentFilter = agentFilter
  intent.statusFilter = ''
  intent.errorCategory = ''
  intent.timeRange = ''
  intent.scene = 'execution-logs'
}
/** Skill 明细行点击：key 可能带 skill: 前缀（注册表口径），执行日志行内 agent 是裸名 */
function goSkillLogs(r: SkillCostRow) {
  goExecLogs(String(r.key || '').replace(/^skill:/, ''))
}
function goOverview() {
  intent.scene = 'overview'
}
/** P1#25：单价未配置 → 直达「模型与接入」补单价（决策就近） */
function goModelConfig() {
  intent.scene = 'api-config'
}

const costLoading = ref(false)
const costFailed = ref(false)
const costUsd = ref<number | null>(null)
const costPricingKnown = ref(false)
const costPricedCalls = ref(0)
const costMissingCalls = ref(0)
const missingPricingModels = ref<string[]>([])

/* P1#25 失败调用活卡（原「缓存命中率」死卡位）：totals.failed 后端已返回，
   失败率 = failed / calls（窗口随 pills），失败信号值得首屏一位 */
const failedCalls = computed(() => summary.value?.totals.failed ?? 0)
const totalCalls = computed(() => summary.value?.totals.calls ?? 0)
const failedPct = computed(() =>
  totalCalls.value > 0 ? `${Math.round((failedCalls.value / totalCalls.value) * 100)}%` : '—'
)
// P2（2026-10-04 全站评审）：值只给次数，占比单源留在 hint（此前「4%」卡内念两遍）
const failedCallsText = computed(() =>
  failedCalls.value > 0 ? `${failedCalls.value} 次` : '0 次'
)
const failedHint = computed(() => {
  const win = `近 ${days.value} 天${includeTest.value ? '（含测试）' : ''}`
  const base = `口径：${win} · 失败/总调用 = ${failedCalls.value}/${totalCalls.value}；重试后仍失败才计入（终态口径）`
  return failedCalls.value > 0
    ? `${base}；逐条失败可在「按 Skill 成本明细」点对应行直达执行日志`
    : base
})

/* P1#25 单价未配置 = 决策态：卡可点直达「模型与接入」补单价 */
const pricingMissing = computed(
  () => !costLoading.value && !costFailed.value && costUsd.value === null && !(costPricedCalls.value === 0 && costMissingCalls.value === 0)
)

/* P1#25 金额格式：固定 6 位小数改有效数字——固定 6 位对大额是噪音、对微额首屏
   全是 0.000000 读不出量级。≥1 两位小数 / ≥0.01 四位 / 更小保留 6 位；0 与非法值显「0」 */
function fmtCostUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.01) return v.toFixed(4)
  return v.toFixed(6)
}

/* 请求序号：切窗竞态下丢弃过期金额响应。旧实现在途即 return，新窗口调用被静默丢弃，
   在途旧响应回来把旧窗口金额写在新标签下且不自愈（2026-10-05 评审收敛） */
let costSeq = 0
async function loadCostSummary() {
  const seq = ++costSeq
  costLoading.value = true
  costFailed.value = false
  try {
    const res = await adminTokenCostApi.getSummary({ days: days.value, includeTest: includeTest.value })
    if (seq !== costSeq) return
    const totals = res.data?.data?.totals ?? null
    costUsd.value = totals?.usd ?? null
    costPricingKnown.value = totals?.pricingKnown ?? false
    costPricedCalls.value = totals?.pricedCalls ?? 0
    costMissingCalls.value = totals?.callsMissingPricing ?? 0
    missingPricingModels.value = res.data?.pricingStatus?.missingPricingModels ?? []
  } catch {
    if (seq !== costSeq) return
    /* 金额条为辅助信息：失败显式报错并可重试，绝不静默降级成「无调用」 */
    costFailed.value = true
    costUsd.value = null
    costPricingKnown.value = false
  } finally {
    if (seq === costSeq) costLoading.value = false
  }
}

/* 已加载数据对应的窗口键（D4）：缓存命中只在「同一窗口」时短路。
   切走再切回、或窗口 pill 切换时，旧窗口的 summary/趋势/明细/排行整组不可继续当作新窗口结论
   （旧实现只判 isPageCacheFresh 就 return，导致同屏「窗口标签已变、数值还是上一窗口」双口径）。 */
const loadedKey = ref<string | null>(null)
/** 请求序号（EG3）：快速连续切窗时丢弃过期响应，避免后到的旧结果覆盖新窗口 */
let loadSeq = 0

watch([days, includeTest], () => {
  const key = tokenCostCacheKey()
  // 切窗：清旧窗口数据进骨架态（loading 由 load 置真）——保证 pills 高亮与卡片数值同一响应驱动
  if (loadedKey.value && loadedKey.value !== key) {
    summary.value = null
    bySkill.value = []
    byUser.value = []
    byModel.value = []
    loadedKey.value = null
    userSeq += 1 // 作废在途的用户搜索响应，避免旧窗口结果覆盖新窗口
    // 金额卡独立于 load() 同批数据：一并清空，保证数值与窗口标签同一响应驱动，不留旧窗口读数
    costUsd.value = null
    costPricingKnown.value = false
    costPricedCalls.value = 0
    costMissingCalls.value = 0
    missingPricingModels.value = []
  }
  void load()
  void loadCostSummary()
}, { immediate: true })



async function load(force = false) {
  const key = tokenCostCacheKey()
  // 仅当「同窗口 + 缓存新鲜 + 已有数据」才短路；否则一律重拉（避免旧窗口数据被读成新窗口）
  if (!force && isPageCacheFresh(key) && summary.value && loadedKey.value === key) return
  const seq = ++loadSeq
  const uSeq = userSeq // 用户搜索序号快照：窗口加载期间搜索若已接管，本批 byUser 不得回写覆盖
  loading.value = true
  loadFailed.value = false
  try {
    const params = { days: days.value, includeTest: includeTest.value }
    const [sumRes, skillRes, userRes, modelRes] = await Promise.all([
      adminTokenCostApi.getSummary(params),
      adminTokenCostApi.getBySkill(params),
      fetchByUser(),
      adminTokenCostApi.getByModel(params),
    ])
    if (seq !== loadSeq) return // 窗口已再次切换：丢弃本批过期响应
    summary.value = sumRes.data?.data ?? sumRes.data ?? null
    bySkill.value = (skillRes.data?.data?.items ?? []) as SkillCostRow[]
    if (uSeq === userSeq) byUser.value = (userRes.data?.data?.items ?? []) as RankRow[]
    byModel.value = (modelRes.data?.data?.items ?? []) as RankRow[]
    loadedKey.value = key
    markPageFetched(key)
  } catch (e) {
    if (seq !== loadSeq) return
    loadFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

/** M/D 标签（今日由 trendCols 单独给「今日」，此处不再判日） */
function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}`
}

/* 趋势柱数据映射（OvBars 列式结构，与总览 trend7dCols 同构）：
   单柱 Token（蓝）—— 原型为「近 7 天成本趋势 · 单位：元」，但接口 trend 无分日金额，
   故不画金额/双柱系列；数值行给 Token，调用/失败数进 title 与卡尾 note。 */
const trendMax = computed(() => Math.max(1, ...trend.value.map((d) => d.tokens)))
const barPct = (v: number, max: number) => `${v > 0 ? Math.max(Math.round((v / max) * 100), 6) : 3}%`
const todayKey = computed(() => {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
})
const trendCols = computed(() => trend.value.map((d) => ({
  key: d.date,
  label: d.date === todayKey.value ? '今日' : dayLabel(d.date),
  today: d.date === todayKey.value,
  num: fmtTokens(d.tokens),
  title: `${d.date}：Token ${fmtTokens(d.tokens)} · ${d.calls.toLocaleString()} 次调用 · 失败 ${d.failed.toLocaleString()} 次`,
  bars: [
    { pct: barPct(d.tokens, trendMax.value), tone: 'blue' as const },
  ],
})))
</script>

<style scoped>
/* 嵌入模式（宿主执行日志页 flex 列内）：占满剩余高度，整页接管滚动 */
.tc-pills { display: inline-flex; }
/* 筛选条（范围 + 数据范围，独立一行卡片形态） */
.tc-filterbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
/* KPI 区已改用共享 .mk-kpi-grid（2026-09-29 重设：原私有 .tc-overview
   repeat(4,1fr)/gap14 与全站 KPI 栅格不是同一套；.tc-status--bad 随状态条
   去数字一并退役 → 见下方模板注释 */

/* 趋势图：柱状图 + Y 轴刻度 + 网格线 + 柱顶数值 + 今日高亮（对齐 AntD Chart 语言） */
.tc-head-links {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}
.tc-head-links .mk-card__meta { margin-left: 0; }
/* 批D：手搓 tc-trend 柱图已换 MkChart（双系列 tokens+failed），原 80 行私有图表 CSS 与 6 处渐变 hex 一并移除 */

/* —— 用量排行 —— */
.tc-card--skill { grid-column: 1 / -1; }
.tc-ranks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  /* align-items:start 撤（2026-10-04 全站评审 P3#25，判例 42107f8e）：并排排行卡底边差 114.5px
     （右卡悬空），撤后 grid stretch 等高，与总览 Row A 同判 */
}
/* LY2（2026-10-05）：TcRankTable 半宽侧表最小内容宽 594px，卡宽 <622px 时
   .mk-card 的 overflow:clip 会静默裁掉最右「占比」列。回落档从 1200 抬到 1599——
   双列只在「每卡 ≥622px 内容宽」时成立；1201–1599 夹缝带一律单列全宽（保留 gap 与等高说明）。 */
@media (max-width: 1599px) {
  .tc-ranks { grid-template-columns: minmax(0, 1fr); }
}

/* 展开全部 / 收起（Skill 排行） */
.tc-more {
  border: 0;
  background: transparent;
  padding: 2px 8px;
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-blue);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.tc-more:hover { background: color-mix(in srgb, var(--mk-blue) 8%, transparent); }

/* 卡头「标题 + 单位副题」成组（原型 .card__head：card__title + card__sub 同排左侧）：
   单独并列时 .mk-card__head > :first-child 会独占剩余宽度把副题推右，故包一层 */
.tc-card-head__main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

/* —— 按 Skill 成本明细（原型 renderCost 1778-1784 .tbl 五列）—— */
.tc-skilltable {
  display: flex;
  flex-direction: column;
  padding: 2px 14px 0;
}
.tc-skilltable__head,
.tc-skilltable__row {
  display: grid;
  grid-template-columns:
    minmax(150px, 1.4fr)
    minmax(56px, 0.5fr)
    minmax(110px, 0.9fr)
    minmax(96px, 0.8fr)
    minmax(130px, 1fr);
  align-items: center;
  gap: 10px;
}
.tc-skilltable__head {
  padding: 7px 0 6px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--mk-faint);
}
.tc-skilltable__head > span:not(:first-child) { text-align: right; }
.tc-skilltable__row {
  padding: 7px 0;
  border-bottom: 1px solid var(--mk-table-row-line);
  transition: background 0.12s;
  /* P1#25：整行可点 → 执行日志携该 Skill 的 agentFilter 深链（hover 反馈已有，补手型） */
  cursor: pointer;
}
.tc-skilltable__row:last-child { border-bottom: none; }
.tc-skilltable__row:hover { background: var(--mk-table-row-hover-bg); }
/* EG19：行可键盘聚焦，补可见焦点环（与 vl-cell--click:focus-visible 同判例） */
.tc-skilltable__row:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.tc-st__name { min-width: 0; }
.tc-st__name strong {
  display: block;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-st__num,
.tc-st__cost,
.tc-st__pct {
  font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-ink);
  text-align: right;
  white-space: nowrap;
}
.tc-st__share {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
}
.tc-st__pct { color: var(--mk-muted); }

/* 4K 档 tc-trend 规则随 MkChart 迁移移除（批D）；MkChart 高度如需 4K 放大走其组件内档位 */

/* 暗色模式（D1 补完）：Token 成本 */
html[data-theme='dark'] {
  /* tc-trend 柱暗色渐变已随 MkChart 迁移移除（批D），图表暗色走 MK_CHART_PALETTES.dark */
  .tc-more:hover { background: rgba(91, 141, 239, 0.14); }
}

/* 首载骨架：KPI 卡 / 趋势图 / 排行行 占位（skeleton shimmer 对齐 SkillReconciliation sk-rec__skeleton 手法） */
.tc-filterbar--skeleton { height: 44px; }
.tc-skel-kpi { display: grid; gap: 8px; }
/* 骨架内边距（形状由 MkSkeleton 提供） */
.tc-skel-pad { padding: 12px 16px 16px; }
</style>
