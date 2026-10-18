<template>
  <div class="mk-page">
    <!-- 页头（newui/admin 原型 pagehead）：标题 + 口径副文 + 主操作上移；
         原状态条承担的「身份+口径+刷新」迁入页头，三个数字仍归下方 KPI 卡
         （避免同一批数在页头与 KPI 区各说一遍，2026-09-29 口径延续）。
         sub 用原型固定文案（2026-10-01 页头对齐批）；动态窗口/测试流量口径
         转为页名悬停 hint——窗口 pill 与数据视角开关就在同一动作区，取值本就可见 -->
    <MkPageHead
      title="成本分析"
      sub="按模型、Skill 与时间维度追踪模型调用成本"
      :hint="`近 ${days} 天 · ${includeTest ? '含测试' : '仅真实用户'}`"
    >
      <template #actions>
        <!-- 时间窗口 + 数据视角（2026-10-16 用户走查「这个地方不应该这么设计」）：
             原为独立一张通栏描边筛选条——1300px 宽只放 337px 控件，读作一张空卡，
             且全站仅此一处用「自己的卡装筛选」。收进页头动作区：窗口 pill 在前、
             数据视角开关随后，与学习组各页 DataScopeToggle 同一位。切换不依赖已加载
             数据，失败态下仍能降档重试（F8-3 语义保留）。 -->
        <div class="mk-pills tc-pagehead-pills" role="group" aria-label="时间窗口">
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
        <!-- 导出报表（原型 pagehead 动作位真实化）：当前窗口三张明细表合一个 CSV，客户端生成 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="!summary || summaryEmpty" title="导出当前窗口的 Skill 明细 / 用户排行 / 模型排行（CSV）" @click="exportCsv">
          导出报表
        </button>
        <!-- 刷新必须同时重拉金额卡：此前只调 load()（summary/趋势/三表），
             「调用成本 / 单次调用均值」不在其列——金额卡一旦落到「加载失败」，
             用刷新永远恢复不了，只有切窗口 pill 能救。 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="refreshAll">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>

    <!-- 调用成本 2026-09-29 收编进概览区（原私有 cost-strip 金额条与全站 KPI 语言不一致；
         单价未配置/加载失败态由 KPI 卡 hint + tone 承担）。2026-10-01 成本批：成本升为第一张卡 -->

    <!-- 加载失败（优先于空态）——审核 #113：补 tone="error"（role=alert + 错误配色，全站失败态统一），
         并给重试按钮 actionBusy 反馈（与 ExecLogs 失败态对齐） -->
    <MkEmptyState
      v-if="loadFailed && !summary"
      icon="◌"
      tone="error"
      min
      title="Token 成本数据加载失败"
      description="用量统计加载失败。可更换时间范围重试，或稍后再来。"
      action-text="重试"
      action-busy-text="重试中…"
      :action-busy="loading"
      @action="() => load(true)"
    />

    <!-- 首载骨架：KPI 卡 + 趋势图 + 排行占位（对齐全站 MockSkeleton 语言） -->
    <template v-else-if="!summary && loading">
      <!-- 冷载反馈（F8-3）：全表聚合冷载可达 20s+，8s 后给一句「仍在计算」，避免长时间只有
           骨架被读成卡死（热载命中 5min TTL 缓存 <1s，不会触发） -->
      <p v-if="slowLoad" class="mk-card__note" role="status">正在统计近 {{ days }} 天调用记录，首次可能需数十秒…</p>
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
             P1#25：单价未配置态可点直达「模型与接入」。W6（2026-10-10）当时该页还没有单价编辑入口；
             2026-10-18 BYOK 模型编辑器补上单价（输入 / 缓存命中 / 输出，USD per 1M tokens）后，
             补价路径=「接入与模型」→ 供应商 → 模型行「编辑」→ 单价，落回 llm-providers.json 的 pricing 块。
             2026-10-14 用户评审：状态词此前占着 28px 数值位（「调用成本 / 单价未配置」），
             被读成主数值——数值位改为暗灰占位「—」，原因与动作由 hint 一行承担（该卡仍可点）。 -->
        <MkKpi
          label="调用成本"
          :value="costLoading ? '…' : costFailed ? '加载失败' : costUsd !== null ? `≈ $${fmtCostUsd(costUsd)}` : '—'"
          :tone="costFailed ? 'warn' : pricingMissing ? 'muted' : ''"
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
        <MkKpi label="总 Token" :value="summary ? fmtTokens(summary.totals.tokens) : '—'" :hint="`输入 ${summary ? fmtTokens(summary.totals.promptTokens) : '—'} · 输出 ${summary ? fmtTokens(summary.totals.completionTokens) : '—'}`" title="输入与输出相加即总量。调用次数见「单次调用均值」卡" />
        <MkKpi
          label="失败调用"
          :value="failedCallsText"
          :tone="failedCalls > 0 ? 'bad' : ''"
          :hint="failedCalls > 0 ? `占总调用 ${failedPct}（重试后仍失败）` : '无失败调用'"
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
          <div class="tc-card-head__main" title="金额按本地自然日汇总，含重试后仍失败的调用。趋势图暂无分日金额，仅展示 Token 量">
            <h3 class="mk-card__title">近 {{ days }} 天用量趋势</h3>
            <span class="mk-card__meta">单位：Token（暂无分日金额）</span>
          </div>
          <div class="tc-head-links">
            <button type="button" class="mk-link" @click="goOverview">总览趋势 →</button>
            <button type="button" class="mk-link" @click="goExecLogs()">逐调用明细 →</button>
          </div>
        </div>
        <!-- 窗口合计释义行（2026-10-16 用户走查：原为卡尾脚注，贴卡左缘、矮在图下，读作事后补丁）：
             移到卡头正下方当释义行，读数据前先给口径。与 KPI 同源的 totals 渲染（审核 #111），
             全页同一事实只用一个数据源；「未按日拆分」说明为何逐日柱合计略低于总量（不是漏统计）。
             2026-10-16 KPI 审计补完：原句把「N 次调用 / 失败 K 次」也念了一遍，而上面 KPI 带的
             「总 Token」插文与「失败调用」值已经说过——同一分母不两处说。此行只留图表侧独有的事实：
             Token 合计与「有多少次没按日拆分」。 -->
        <p
          v-if="trend.length"
          class="mk-card__note tc-card__note"
          :title="summary && trendCallsShortfall > 0 ? `逐日柱按自然日聚合，跨日窗口头部不足一日的 ${trendCallsShortfall} 次调用只计入总量，故柱合计略低于总量` : ''"
        >
          逐日合计 {{ fmtTokens(summary?.totals.tokens ?? 0) }} token
        </p>
        <p v-else class="mk-card__note tc-card__note">近 {{ days }} 天暂无调用记录。</p>
        <!-- 趋势柱：走全 admin 统一图表语言 OvBars（2026-09-29 自 MkChart/ECharts 换入）。
             2026-10-01 成本批：原 Token+failed 双柱改为单柱序列（金额缺失，单位=Token）。
             2026-10-06 审核修复：此前写死 bar-width=44 且不传 labelEvery/showNums，
             90 天时 90 列各带柱顶数字与日期标签互相压印（实测 70 对重叠、柱宽被压到 4.7px）。
             按窗口收口：柱宽随列数收窄，>30 天隐藏柱顶数字、日期按 12 列稀显。 -->
        <!-- 图表区内衬（审核 #130）：OvBars 原直挂 .mk-card 无左右内边距，柱带与「今日」高亮列
             贴到卡片圆角边缘（1px），与同卡卡头 16px / 下方明细表 14px 不同档；包一层与明细表同档内衬 -->
        <div class="tc-trendbody">
          <OvBars
            v-if="trend.length"
            :cols="trendCols"
            :bar-width="days <= 7 ? 44 : days <= 30 ? 20 : 10"
            :show-nums="days <= 30"
            :label-every="days <= 7 ? 1 : days <= 30 ? 4 : 12"
            :min-bars-height="150"
          />
        </div>
        <!-- 趋势卡尾 note（审核 #111）：原由 trend.reduce 求和，与 KPI 的 totals 在非整日窗口
             （窗口头部不足一日的行只进总量）下同屏两值（7 天窗 224218 vs KPI 224298）。
             改为与 KPI 同源的 totals 渲染，全页同一事实只用一个数据源。 -->
      </section>

      <!-- 按 Skill 成本明细（原型 renderCost 1778-1784：Skill/调用/Token 用量/成本/占比 五列，
           占比 = meter + mono%）。后端 by-skill 条目已带成本桶（usd/pricedCalls/callsMissingPricing），
           故补真实金额列；单价未配置的 Skill 显式写「单价未配置」且不计入占比（不拿 0 冒充金额）。
           2026-10-14 用户评审两处改：① 成本列不再逐行复读「单价未配置」（状态词污染整页），
           行内一律暗灰 —，原因收进行 title 与卡头；② 原五列纯 fr 在宽屏把每个数值摊到
           自己列的最右（实测 996px 卡里 Skill 列 282px 只放 85px 文字），补 prompt/completion/均次
           Token 三列把横向空间填成数据（用户的「要么补列填满、要么别让列间空 500px」）。 -->
      <section class="mk-card tc-card tc-card--skill">
        <div class="mk-card__head">
          <h3 class="mk-card__title">{{ SKILL_COST_TITLE }}</h3>
          <div class="mk-card__head-right">
            <span class="mk-card__meta">{{ bySkill.length }} 个 Skill</span>
            <!-- 未配置单价是可执行的配置缺口，用徽章单列（原做法挤在读数行里，会让「N 个」被读成缺价数） -->
            <span v-if="skillAllUnpriced" class="mk-badge mk-badge--muted" title="这些 Skill 的模型都没配单价，成本列显示「—」，不计入成本合计">均未配置单价</span>
            <span v-else-if="skillUnpriced > 0" class="mk-badge mk-badge--muted" :title="`其中 ${skillUnpriced} 个 Skill 的模型未配单价，成本列显示「—」，不计入成本合计`">{{ skillUnpriced }} 个未配置单价</span>
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
        <!-- 成本口径释义行（2026-10-16 用户走查：原卡尾脚注连挂两个括号、贴卡左缘读作补丁）：
             移卡头下方、拆成两句人话——「成本怎么算」+「占比怎么算」，不再一句套两层括号 -->
        <p class="mk-card__note tc-card__note" title="未配置单价的模型不计入成本合计，其成本列显示「—」">
          成本＝已定价调用的金额合计（美元）。未配置单价的模型显示「—」，不计入合计。占比优先按金额计算，全部未配置单价时改按 Token 计算。
        </p>
        <div v-if="skillRows.length" class="tc-skilltable" role="table" :aria-label="SKILL_COST_TITLE">
          <div class="tc-skilltable__head" role="row">
            <span role="columnheader">Skill</span>
            <span role="columnheader">调用</span>
            <span role="columnheader">Token 用量</span>
            <span role="columnheader">输入</span>
            <span role="columnheader">输出</span>
            <span role="columnheader">均次 Token</span>
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
            <span class="tc-st__num tc-st__num--dim" role="cell">{{ fmtTokens(r.promptTokens ?? 0) }}</span>
            <span class="tc-st__num tc-st__num--dim" role="cell">{{ fmtTokens(r.completionTokens ?? 0) }}</span>
            <span class="tc-st__num tc-st__num--dim" role="cell">{{ perCallTokens(r) }}</span>
            <span class="tc-st__cost" :class="{ 'tc-st__cost--none': !hasCost(r) }" role="cell">{{ skillRowCost(r) }}</span>
            <span class="tc-st__share" role="cell">
              <span class="mk-minibar"><span class="mk-minibar__fill" :style="{ width: skillShareW(r) }"></span></span>
              <span class="tc-st__pct">{{ skillSharePct(r) }}</span>
            </span>
          </div>
        </div>
        <p v-else class="mk-card__note tc-card__note">暂无数据。</p>
      </section>

      <div class="tc-ranks">
        <section class="mk-card tc-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">用户用量排行</h3>
            <div class="mk-card__head-right">
              <!-- D13：中小用户此前不可见——加按 用户ID/昵称/邮箱 的服务端搜索（不改动 summary/趋势） -->
              <MkFilterSearch v-model="userQuery" placeholder="搜索用户 ID / 昵称 / 邮箱" />
              <span class="mk-card__meta">{{ userQuery ? `匹配 ${byUser.length}` : `Top ${byUser.length}` }}<template v-if="!userAll && byUser.length > userLimit"> · 显示前 {{ userLimit }}</template></span>
              <!-- G8（2026-10-10）：搜索失败静默保留旧列表时的行内 stale 提示——此前失败无任何反馈，
                   meta「匹配 N」仍按输入框实时读数，与表格脱源（N 是旧结果的行数）。对齐 Skills.vue
                   liveSkillsError 行内告警判例：辅助数据失败不弹遮主表的 toast，但必须指认数据来源 -->
              <span v-if="byUserStale" class="mk-card__meta tc-user-stale">
                上次搜索失败，显示的是{{ byUserSource ? `「${byUserSource}」` : '默认 Top 榜' }}的结果
              </span>
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

/* 文案单源（R6 复读单源化）：卡标题与成本表的 aria-label 共用一份 */
const SKILL_COST_TITLE = '按 Skill 成本明细'

interface Summary {
  days: number
  includeTest: boolean
  totals: {
    tokens: number; promptTokens: number; completionTokens: number; calls: number; failed: number
    /* 成本桶（审核 #110：与 summary 同响应下发，不再单发一次请求；后端 totals 原样携带） */
    usd?: number | null; pricingKnown?: boolean; pricedCalls?: number; callsMissingPricing?: number
  }
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
/* 冷载反馈（F8-3）：全表聚合冷载实测 11.6s（7 天）/ 21.7s（90 天），后端缓存预热只在
   20s 后首次进 TTL、且默认 7d 口径——换窗口/冷启动后首访必然吃满一次全表聚合。
   超过阈值仍在加载时给一句「仍在计算」，避免长时间只有骨架被读成卡死。 */
const SLOW_LOAD_HINT_MS = 8000
const slowLoad = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | null = null
function clearSlowTimer() {
  if (slowTimer) { clearTimeout(slowTimer); slowTimer = null }
  slowLoad.value = false
}

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
/* G8（2026-10-10）：用户排行搜索失败 stale 提示——失败保留旧 byUser 时置位（成功清空），
   卡头渲染「上次搜索失败，显示的是「X」的结果」弱化小字；byUserSource 记录当前列表
   对应的查询（''=默认 Top 榜），供文案如实指认数据来源。 */
const byUserStale = ref(false)
const byUserSource = ref('')

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
    // G8：成功即清 stale 并记录数据来源（当前查询；''=默认 Top 榜）
    byUserStale.value = false
    byUserSource.value = userQuery.value.trim()
  } catch {
    /* 排行属辅助信息：失败保留旧值，不弹错遮挡主表；但必须置 stale 行内提示——
       此前完全静默，卡头 meta「匹配 N」与表格脱源无感知（G8）。过期响应（已有更新一笔
       在途）不置位，由新一笔的结果决定最终状态 */
    if (seq === userSeq) byUserStale.value = true
  }
}
watch(userQuery, () => {
  if (userQueryTimer) clearTimeout(userQueryTimer)
  userQueryTimer = setTimeout(() => { void loadByUser() }, 300)
})
onBeforeUnmount(() => {
  if (userQueryTimer) clearTimeout(userQueryTimer)
  clearSlowTimer()
})

const rangePills = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
]

const trend = computed(() => summary.value?.trend || [])
const totalTokens = computed(() => summary.value?.totals.tokens || 0)
/* 审核 #111：趋势卡尾 note 改用 totals（与 KPI 同源）。若窗口头部不足一日的行只进总量
   （后端口径），totals.calls 会略大于 trend 逐日合计——此差额用于 note 里如实自证口径。 */
const trendCallsShortfall = computed(() => {
  const t = summary.value?.totals.calls ?? 0
  const sum = trend.value.reduce((acc, d) => acc + d.calls, 0)
  return Math.max(0, t - sum)
})
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
  return `近 ${days.value} 天 · 按 ${costPricedCalls.value} 次已定价调用折算`
})

/* Skill 明细表占比分母：优先已定价金额合计；全未定价时退回 Token 占比（并在表尾注明） */
const skillCostTotal = computed(() =>
  bySkill.value.reduce((acc, r) => acc + (typeof r.usd === 'number' ? r.usd : 0), 0)
)
function skillRowCost(r: SkillCostRow): string {
  return typeof r.usd === 'number' ? `≈ $${fmtCostUsd(r.usd)}` : '—'
}
/** 有无已定价金额（决定成本列占位色：无 → 暗灰） */
function hasCost(r: SkillCostRow): boolean {
  return typeof r.usd === 'number'
}
/** 未配置单价的 Skill 数（卡头一句状态。此前逐行打「单价未配置」五个亮白字，
    2026-10-14 用户评审：状态词污染整页——行内一律暗灰 —，原因收进卡头 + 行 title） */
const skillUnpriced = computed(() => bySkill.value.filter((r) => typeof r.usd !== 'number').length)
/** 均次 Token（tokens / calls）：明细此前只有窗口总量，看不出「单次多重」 */
function perCallTokens(r: SkillCostRow): string {
  if (!r.calls || r.tokens <= 0) return '—'
  return fmtTokens(Math.round(r.tokens / r.calls))
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
  // 成本原因随占位一起离开行内（行内只留 —），故 title 必须把原因说全，否则信息净丢
  const cost = hasCost(r)
    ? `成本 ≈ $${fmtCostUsd(r.usd as number)}`
    : (r.callsMissingPricing ?? 0) > 0
      ? `成本：单价未配置（${r.callsMissingPricing} 次调用未计入金额）`
      : '成本：无已定价调用'
  return `${r.display || r.key} · ${r.calls} 次调用 · Token ${fmtTokens(r.tokens)} · 均次 ${perCallTokens(r)} · ${cost}`
}

/* 成本卡副行（长版，收进 KPI 卡 title 悬停）：数值本身只给结论。
   原型此位为「今日成本·预算」——接口无分日金额也无预算配置，故如实给当前窗口口径。 */
const costHint = computed(() => {
  if (costLoading.value) return '金额统计中'
  if (costFailed.value) return '金额统计拉取失败，可刷新重试'
  const window = `近 ${days.value} 天`
  if (costUsd.value !== null) {
    const priced = `${window} · 已定价 ${costPricedCalls.value} 次`
    return costMissingCalls.value > 0 ? `${priced} · ${costMissingCalls.value} 次未定价（未计入）` : priced
  }
  if (costPricedCalls.value === 0 && costMissingCalls.value === 0) return `${window}没有带 token 的 LLM 调用`
  const missing = missingPricingModels.value
  // 2026-10-10 走查 W6 时这条动线是死胡同（那页没有单价编辑入口）；2026-10-18 BYOK 模型编辑器
  // 补上单价后，点击可直达「接入与模型」，模型行的「单价未知 · 点编辑补」就是入口，
  // 保存落回 llm-providers.json 的 pricing 块并热重载（File-as-Truth）。
  return missing.length
    ? `${window} · 暂不展示金额 · 待补单价模型 ${missing.length} 个：${missing.join('、')}`
    : `${window} · 尚未配置单价，暂不展示金额`
})

/* KPI hint 短口径（原型 metricCard 的 hint 是一短句）：长解释走卡 title 悬停 */
const costHintShort = computed(() => {
  if (costLoading.value) return '金额统计中'
  if (costFailed.value) return '金额统计失败'
  if (costUsd.value !== null) return `近 ${days.value} 天 · 已定价 ${costPricedCalls.value} 次`
  if (costPricedCalls.value === 0 && costMissingCalls.value === 0) return `近 ${days.value} 天无调用`
  const n = missingPricingModels.value.length
  // P2（2026-10-04 全站评审）：「单价未配置」已在卡值位出现，hint 不再复读同一状态词
  return `近 ${days.value} 天${n > 0 ? ` · 待补 ${n} 个模型单价` : ''} · 查看模型配置`
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
  /* 审核 #133：页面 Skill 表「占比」在配了单价时按金额算（skillShareNum），而导出原只有 Token 占比
     却同样叫「占比%」——将来配价后会给出不同数值。现 Skill 段拆成「Token占比%/成本占比%」两列，
     成本占比与页面同源（skillCostTotal 为分母），未定价时写 —（不拿 Token 占比冒充成本占比）。 */
  const costSharePct = (usd: number | null | undefined) =>
    skillCostTotal.value > 0 && typeof usd === 'number' ? ((usd / skillCostTotal.value) * 100).toFixed(1) : '—'
  const lines: string[] = [
    `成本分析 · 近 ${days.value} 天 · ${includeTest.value ? '含测试' : '仅真实用户'} · 导出于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '[按 Skill 成本明细]',
    'Skill,调用,Token,输入,输出,成本USD,Token占比%,成本占比%',
    ...bySkill.value.map((r) =>
      [esc(r.display || r.key), r.calls, r.tokens, r.promptTokens ?? '', r.completionTokens ?? '',
        typeof r.usd === 'number' ? r.usd.toFixed(4) : '单价未配置', sharePct(r.tokens), costSharePct(r.usd)].join(',')),
    '',
    '[用户用量排行]',
    '用户,邮箱,调用,失败,Token,成本USD,占比%',
    ...byUser.value.map((r) =>
      [esc(r.display), esc(r.email || ''), r.calls, r.failed, r.tokens,
        typeof r.usd === 'number' ? r.usd.toFixed(4) : '单价未配置', sharePct(r.tokens)].join(',')),
    '',
    '[模型用量排行]',
    '模型,调用,失败,Token,成本USD,占比%',
    ...byModel.value.map((r) =>
      [esc(r.display), r.calls, r.failed, r.tokens,
        typeof r.usd === 'number' ? r.usd.toFixed(4) : '单价未配置', sharePct(r.tokens)].join(',')),
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
  const base = `${win}内失败 ${failedCalls.value} / 共 ${totalCalls.value} 次（重试后仍失败才计入）`
  return base
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

/* 已加载数据对应的窗口键（D4）：缓存命中只在「同一窗口」时短路。
   切走再切回、或窗口 pill 切换时，旧窗口的 summary/趋势/明细/排行整组不可继续当作新窗口结论
   （旧实现只判 isPageCacheFresh 就 return，导致同屏「窗口标签已变、数值还是上一窗口」双口径）。 */
const loadedKey = ref<string | null>(null)
/** 请求序号（EG3）：快速连续切窗时丢弃过期响应，避免后到的旧结果覆盖新窗口。
    审核 #110：金额字段已并入 load() 的同一 summary 响应，原独立的 loadCostSummary/costSeq 删除。 */
let loadSeq = 0

watch([days, includeTest], () => {
  const key = tokenCostCacheKey()
  // 切窗：清旧窗口数据进骨架态（loading 由 load 置真）——保证 pills 高亮与卡片数值同一响应驱动
  if (loadedKey.value && loadedKey.value !== key) {
    summary.value = null
    bySkill.value = []
    byUser.value = []
    byModel.value = []
    // G8：列表清空进骨架态，stale 提示一并复位（来源随数据清空，避免空表挂着旧提示）
    byUserStale.value = false
    byUserSource.value = ''
    loadedKey.value = null
    userSeq += 1 // 作废在途的用户搜索响应，避免旧窗口结果覆盖新窗口
    // 金额卡与主数据同一响应驱动（审核 #110）：一并清空，保证数值与窗口标签一致，不留旧窗口读数
    costUsd.value = null
    costPricingKnown.value = false
    costPricedCalls.value = 0
    costMissingCalls.value = 0
    missingPricingModels.value = []
  }
  void load()
}, { immediate: true })



/** 页头「刷新」：主数据（含金额字段，审核 #110 已并入同一响应）强制重拉。 */
function refreshAll() {
  void load(true)
}

async function load(force = false) {
  const key = tokenCostCacheKey()
  // 仅当「同窗口 + 缓存新鲜 + 已有数据」才短路；否则一律重拉（避免旧窗口数据被读成新窗口）
  if (!force && isPageCacheFresh(key) && summary.value && loadedKey.value === key) return
  const seq = ++loadSeq
  const uSeq = userSeq // 用户搜索序号快照：窗口加载期间搜索若已接管，本批 byUser 不得回写覆盖
  loading.value = true
  loadFailed.value = false
  costLoading.value = true
  costFailed.value = false
  clearSlowTimer()
  slowTimer = setTimeout(() => { slowLoad.value = true }, SLOW_LOAD_HINT_MS)
  try {
    const params = { days: days.value, includeTest: includeTest.value }
    const [sumRes, skillRes, userRes, modelRes] = await Promise.all([
      adminTokenCostApi.getSummary(params),
      adminTokenCostApi.getBySkill(params),
      fetchByUser(),
      adminTokenCostApi.getByModel(params),
    ])
    if (seq !== loadSeq) return // 窗口已再次切换：丢弃本批过期响应
    const body = sumRes.data?.data ?? sumRes.data ?? null
    summary.value = body
    // 金额字段从同一 summary 响应提取（审核 #110）：不再对 /token-cost/summary 发第二次请求
    const totals = (body as Summary | null)?.totals ?? null
    costUsd.value = totals?.usd ?? null
    costPricingKnown.value = totals?.pricingKnown ?? false
    costPricedCalls.value = totals?.pricedCalls ?? 0
    costMissingCalls.value = totals?.callsMissingPricing ?? 0
    missingPricingModels.value = sumRes.data?.pricingStatus?.missingPricingModels ?? []
    bySkill.value = (skillRes.data?.data?.items ?? []) as SkillCostRow[]
    if (uSeq === userSeq) {
      byUser.value = (userRes.data?.data?.items ?? []) as RankRow[]
      // G8：窗口主数据成功回写 byUser = 新鲜数据，清 stale 并记录来源
      byUserStale.value = false
      byUserSource.value = userQuery.value.trim()
    }
    byModel.value = (modelRes.data?.data?.items ?? []) as RankRow[]
    loadedKey.value = key
    markPageFetched(key)
  } catch (e) {
    if (seq !== loadSeq) return
    loadFailed.value = true
    /* 金额条为辅助信息：失败显式报错并可重试，绝不静默降级成「无调用」 */
    costFailed.value = true
    costUsd.value = null
    costPricingKnown.value = false
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    if (seq === loadSeq) { loading.value = false; costLoading.value = false; clearSlowTimer() }
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
/* 窗口 pill 随页头动作区排布（2026-10-16）：与「导出报表/刷新」同一行，窄屏由
   MkPageHead__actions 的 flex-wrap 自动折行；不再有独立的描边筛选条。 */
.tc-pagehead-pills { display: inline-flex; }
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
/* LY2（2026-10-05，2026-10-14 重算）：TcRankTable 半宽侧表有最小内容宽，卡窄于此值
   会被 .mk-card 的 overflow:clip 静默裁掉最右「占比」列（实测强制双列 491px 卡里
   行宽 756px，末列右缘越出卡右缘 280px）。最小内容宽随 2026-10-04「审核 #112」插入
   成本列后从 594px 涨到 700px（grid 最小值合计），故每卡 ≥ 728px、内容列 ≥ 1470px、
   视口 ≥ 1754px 双列才成立（1280 面板实测内容列 = 视口 − 284）。原断点 1599 是成本列
   之前算的，1600~1753 这段会裁列——断点抬到 1799 覆盖整段。 */
@media (max-width: 1799px) {
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

/* G8：用户排行 stale 提示（卡头弱化小字）——基类 .mk-card__meta，amber 提示色区分常态读数
   （同 VirtualLearners .vl-truncated 卡头弱告警判例：meta 基类 + 单色强调，不新造告警形态） */
.tc-user-stale { color: var(--mk-amber); font-weight: 600; }

/* 卡头「标题 + 单位副题」成组（原型 .card__head：card__title + card__sub 同排左侧）：
   单独并列时 .mk-card__head > :first-child 会独占剩余宽度把副题推右，故包一层 */
.tc-card-head__main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

/* 趋势图表区内衬（审核 #130）：与下方 .tc-skilltable 同档（padding: 2px 14px 0），
   避免 OvBars 柱带/高亮列贴到卡片圆角边缘；min-width:0 保证窄屏内不溢出 */
.tc-trendbody { padding: 2px 14px 4px; min-width: 0; }

/* 卡内释义行（2026-10-16）：卡头下方的口径说明与 .tc-trendbody/.tc-skilltable 同左内衬（14px），
   不再用 .mk-card__note 默认的 2px——否则贴卡左缘、与标题/表格对不齐，读作掉在卡外 */
.tc-card__note { padding: 2px 14px 8px; }

/* —— 按 Skill 成本明细（原型 renderCost 1778-1784 .tbl 五列）—— */
.tc-skilltable {
  display: flex;
  flex-direction: column;
  padding: 2px 14px 0;
}
.tc-skilltable__head,
.tc-skilltable__row {
  display: grid;
  /* 列宽收敛（2026-10-14 用户评审）：原五列纯 fr（1.4/.5/.9/.8/1）在宽屏把每个数值摊到
     各自列的最右——996px 卡里 Skill 列拿 282px 只装 85px 文字（Skill↔调用 空 197px），
     1480px 卡里更到 ~340px 空转。现按内容给上下限（Skill 是唯一文本列，其余数字列 ~100px），
     补 Prompt/Completion/均次 Token 三列把横向空间填成数据（用户的「要么补列填满、
     要么别让列间空 500px」），余量由末列「占比」吸收——进度条是量表（轨道长度=刻度），
     不制造空转白区。
     下限合计 613 + 7×10 间隙 = 683：admin 最窄档 1280 视口的内容宽 996（表宽 968）富余，
     八列在 ~1024 视口（表宽 ~712）仍不成行溢出（溢出=最右列被 .mk-card overflow:clip 静默裁掉）。
     各列下限不低于表头文字宽（表头右对齐，窄列会让「均次 Token」折行）。 */
  /* 上限刻意压紧：grid 的「maximize tracks」先于 fr 展开，若上限留得宽，窄屏下 7 个受限列
     会先把余量吃光、末列只剩下限（实测 996px 卡里占比条塌到 39px，比改前 149px 更差）。
     上限合计 691 + 7×10 间隙：996px 卡（可用 896）下受限列刚好到顶、占列拿 ~135（条 ~113px），
     宽屏（内容 ≥1470）余量全归占列——条变长但不留空转白区。 */
  grid-template-columns:
    minmax(130px, 175px)
    minmax(44px, 62px)
    minmax(70px, 100px)
    minmax(56px, 78px)
    minmax(76px, 100px)
    minmax(62px, 84px)
    minmax(70px, 92px)
    minmax(105px, 1fr);
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
  /* 行高下限（审核 #115）：原 padding 7px 0 → 行高 35.6px < SPEC §3 的 40px；
     改 10px 0（对齐 .mk-table 的 10×16 口径），12.5px×1.65 + 20 + 1 ≈ 41.6px */
  padding: 10px 0;
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
/* 输入 / 输出 / 均次 Token 是 Token 总量的拆分与派生，弱一档避免与三个主数值抢层级 */
.tc-st__num--dim { color: var(--mk-muted); font-weight: 600; }
/* 未定价占位：暗灰（2026-10-14 用户评审——此前「单价未配置」五个亮白字逐行复读） */
.tc-st__cost--none { color: var(--mk-faint); font-weight: 600; }
.tc-st__share {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
  /* 与左侧金额列的分隔 = 列间距 10 + 14 = 24px（同一诉求：金额文字不要贴着占比条） */
  padding-left: 14px;
}
.tc-st__pct { color: var(--mk-muted); }

/* 4K 档 tc-trend 规则随 MkChart 迁移移除（批D）；MkChart 高度如需 4K 放大走其组件内档位 */

/* 暗色模式（D1 补完）：Token 成本 */
html[data-theme='dark'] {
  /* tc-trend 柱暗色渐变已随 MkChart 迁移移除（批D），图表暗色走 MK_CHART_PALETTES.dark */
  .tc-more:hover { background: rgba(91, 141, 239, 0.14); }
}

/* 首载骨架：KPI 卡 / 趋势图 / 排行行 占位（skeleton shimmer 对齐 SkillReconciliation sk-rec__skeleton 手法） */
.tc-skel-kpi { display: grid; gap: 8px; }
/* 骨架内边距（形状由 MkSkeleton 提供） */
.tc-skel-pad { padding: 12px 16px 16px; }
</style>
