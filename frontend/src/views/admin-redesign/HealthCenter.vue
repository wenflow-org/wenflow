<template>
  <div class="mk-page">
    <!-- 页头只留页名 + 报告新鲜度（轮询页不放刷新钮，强制复检走失败态重试与修复后 refresh(true)） -->
    <MkPageHead title="健康中心">
      <template #actions>
        <span v-if="refreshNote" class="hc-refresh-note" role="status">{{ refreshNote }}</span>
      </template>
    </MkPageHead>

    <MkEmptyState
      v-if="failed"
      tone="error"
      icon="!"
      title="健康报告加载失败"
      :description="errorText"
      action-text="重试"
      action-busy-text="重试中…"
      :action-busy="loading"
      min
      @action="refresh(true)"
    />

    <!-- 首载骨架（R3）：页头注记保持可用（加载期显「检测中…」，2026-10-04 状态条退役后原
         「健康报告检测中…」说明由页头注记承担），内容区用共享 MkSkeleton 版式占位，避免数秒空白。
         版式与真实内容一致：KPI 行 + 健康检查卡（原首块是引导卡骨架，随引导卡一并撤除） -->
    <div v-else-if="loading && !displayReport" class="hc-skel" aria-hidden="true">
      <div class="mk-kpi-grid">
        <div v-for="i in 4" :key="i" class="mk-kpi hc-skel__kpi">
          <MkSkeleton w="48%" :h="12" />
          <MkSkeleton w="64%" :h="26" :radius="8" />
        </div>
      </div>
      <section class="mk-card">
        <div class="mk-card__head"><MkSkeleton w="140" :h="14" /></div>
        <MkSkeleton class="hc-skel__rows" variant="rows" :count="7" :h="22" :radius="8" />
      </section>
    </div>

    <template v-else-if="displayReport">
      <!-- 「本页看什么？」引导卡 2026-09-29 撤除（用户：「这个说明文不需要占位了吧」）：
           它原本的职责是解释「三个 tab 各是什么」，合一成页后三段标题自解释；
           术语本身（ACTIVE / W1-W4 / 哈希漂移 / 遥测漂移…）在顶栏「运营术语表」的「健康」类下
           有更细的词条，口径留在各段标题与卡片的 title 上，不必再占 48px 首屏。
           下面删掉 kpi 前的引导卡后，概要 KPI 上移到首屏。 -->

      <!-- 概要 KPI（共享 MkKpi：标签 + 需处理数，0 = 好；点击落到具体项） -->
      <div class="mk-kpi-grid">
        <MkKpi
          label="检查异常"
          :value="healthAbnormal"
          :tone="healthAbnormalTone"
          clickable
          :title="healthAbnormalTitle"
          @click="goAbnormalCheck"
        />
        <MkKpi
          label="契约与哈希不一致"
          :value="driftActionable"
          :tone="driftActionable > 0 ? 'warn' : 'ok'"
          clickable
          :title="driftCardTitle"
          @click="goDriftCheck"
        />
        <MkKpi
          label="一致性核查异常"
          :value="reconAbnormal"
          :tone="reconAbnormal > 0 ? 'warn' : 'ok'"
          clickable
          :title="reconCardTitleWithTotal"
          @click="goReconDiff"
        />
        <MkKpi
          label="完成度未达标"
          :value="global.abnormalSkills"
          :tone="global.abnormalSkills > 0 ? 'warn' : 'ok'"
          clickable
          :title="completionCardTitle"
          @click="goReconUnmet"
        />
      </div>

      <!-- 四域页签（2026-10-04 用户拍板：区块平铺改页签）——与概要 KPI 四卡一一对应：
           卡=各域「需处理数」裁决且常驻页首（不因切页签消失，规避 2026-09-29 tab 时代
           「刀口切错、异常域藏在没打开的页签里」的旧问题），点卡=切页签（原锚点滚动退役）；
           页签本体只承载域内明细。?tab= 深链可刷新/分享还原
           键盘契约（审核 #78）：role=tablist/tab 兑现 roving tabindex + 左右方向键循环切换，
           每个页签 aria-controls 到对应 role=tabpanel 的内容容器 -->
      <div class="tabs hc-tabs" role="tablist" aria-label="健康中心视图切换" @keydown="onTabKeydown">
        <button
          v-for="(t, i) in HC_TABS"
          :key="t.id"
          :id="`hc-tab-${t.id}`"
          :ref="(el) => setTabRef(el, i)"
          type="button"
          role="tab"
          class="tab"
          :aria-selected="hcTab === t.id"
          :aria-controls="`hc-panel-${t.id}`"
          :tabindex="hcTab === t.id ? 0 : -1"
          @click="switchTab(t.id)"
        >{{ t.label }}</button>
      </div>

      <div v-if="hcTab === 'health'" id="hc-panel-health" role="tabpanel" aria-labelledby="hc-tab-health" class="hc-panel">

      <!-- 检查明细：按基准真源分域，异常域默认展开、全正常域折叠。
           页首 4 张 KPI 是唯一全局读数，卡内不再复读同一批数字。 -->
      <section class="mk-card" id="hc-health">
        <div class="mk-card__head">
          <h3 class="mk-card__title">检查明细</h3>
        </div>
        <!-- 最近修复：修复后的证据就地留在本卡一行，不再整卡插到页签顶部 -->
        <div v-if="recentFixes.length" id="hc-fixlog" class="hc-fixlog">
          <span class="hc-fixlog__label">最近修复</span>
          <div v-for="f in recentFixes" :key="f.key" class="hc-fixlog__row">
            <span class="hc-fixlog__time">{{ f.time }}</span>
            <span class="hc-fixlog__item">{{ f.label }}</span>
            <span v-if="f.backupDir" class="hc-fixlog__path">{{ f.backupDir }}</span>
            <span
              v-else
              class="hc-fixlog__path hc-fixlog__path--none"
              title="该修复只写数据库、不产生文件产物，审计记录已保留"
            >无需文件备份</span>
            <button v-if="f.backupDir" type="button" class="mk-link" @click="copyBackupDir(f.backupDir)">复制</button>
            <button
              v-if="f.auditId"
              type="button"
              class="mk-link"
              @click="goAuditFix(f.auditId)"
            >审计 #{{ f.auditId }}</button>
          </div>
        </div>
        <div class="hc-checks">
            <p v-if="!sortedHealthItems.length" :class="LINE_EMPTY">暂无检查项数据</p>
            <!-- 每个基准域一组：组头给域内状态分布，异常域默认展开 -->
            <details
              v-for="group in healthGroups"
              :id="`hc-group-${group.base}`"
              :key="group.base"
              class="hc-group"
              :open="group.abnormal > 0"
            >
              <summary class="hc-group__summary">
                <span class="hc-check__dot" :class="`hc-check__dot--${group.tone}`"></span>
                <span class="hc-group__name">{{ group.name }}</span>
                <span class="hc-group__sep" aria-hidden="true">·</span>
                <span class="hc-group__stats">
                  <span v-if="group.error" class="hc-group__stat hc-group__stat--error">异常 <b>{{ group.error }}</b></span>
                  <span v-if="group.warn" class="hc-group__stat hc-group__stat--warn">需关注 <b>{{ group.warn }}</b></span>
                  <span v-if="group.ok" class="hc-group__stat">正常 <b>{{ group.ok }}</b></span>
                  <span v-if="group.info" class="hc-group__stat">观测 <b>{{ group.info }}</b></span>
                </span>
              </summary>
              <div class="hc-checks">
                <div v-for="item in group.items" :id="`hc-check-${item.id}`" :key="item.id" class="hc-check" :class="`hc-check--${item.severity}`">
                  <button type="button" class="hc-check__row" :aria-expanded="detailOpen(item.id)" @click="toggleDetail(item.id)">
                    <span class="hc-check__dot" :class="`hc-check__dot--${item.severity}`"></span>
                    <span class="hc-check__main">
                      <strong>{{ item.label }}</strong>
                      <span>{{ item.cause }}</span>
                    </span>
                    <span v-if="item.detail.length" class="hc-check__caret">{{ detailOpen(item.id) ? '▾' : '▸' }}</span>
                  </button>
                  <span class="hc-check__metrics">
                    <span class="hc-check__num" :title="countTitle(item)">{{ item.count }}</span>
                    <span class="hc-check__sem" :class="{ 'hc-check__sem--neutral': item.severity === 'ok' || !item.count }" :title="semHint(item.semantics)">{{ semanticsText(item) }}</span>
                  </span>
                  <span v-if="rowJumpLabel(item) || item.severity !== 'ok'" class="hc-check__actions">
                    <button v-if="rowJumpLabel(item)" type="button" class="mk-link" @click="runRowJump(item)">{{ rowJumpLabel(item) }}</button>
                    <button v-if="item.action === 'fixable' && item.severity !== 'ok'" type="button" class="mk-btn mk-btn--sm" :disabled="fixingId === item.id" @click="fix(item.id)">{{ fixingId === item.id ? '修复中…' : '修复' }}</button>
                    <button v-else-if="item.action === 'manual' && item.severity !== 'ok' && canJumpAway(item.id)" type="button" class="mk-btn mk-btn--sm" @click="jump(item.id)">查看 →</button>
                  </span>
                  <div v-if="detailOpen(item.id) && item.detail.length" class="hc-check__detail">
                    <p v-for="(d, i) in visibleDetail(item)" :key="i">{{ d }}</p>
                    <p v-if="detailTruncated(item)" class="hc-check__detail-more">{{ detailMoreText(item) }}</p>
                  </div>
                </div>
              </div>
            </details>
          </div>
      </section>
      </div>

      <!-- 技能核查 + 完成度：完成度即对账 completion 列的汇总，与对账表同页 -->
      <div v-else id="hc-panel-recon" role="tabpanel" aria-labelledby="hc-tab-recon" class="hc-panel">
        <section>
        <!-- @openSkill 此前未绑定 → 对账行点击无反应（审计 附 A #5）。绑定到全局 skill 抽屉。 -->
        <SkillReconciliation @openSkill="openSkillDrawer" />
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from '@/utils/toast'
import { errMsg, liveRefreshSeq, timeAgo } from './live'
import { askConfirm } from './useConfirm'
import { useSafePolling } from '@/composables/useSafePolling'
import { isLive, openSkillDrawer } from './store'
import {
  adminHealthCenterApi,
  type HealthCenterItem,
  type HealthCenterItemId,
  type HealthCenterSummaryReport,
  type HealthDriftSummary,
  type HealthGlobalSummary,
  type HealthReconciliationSummary,
} from '@/api/adminApi'
import { SEMANTICS_META } from './glossaryMeta'
import { TERMS } from './terms'
import { EXTRA_CAPABILITY_SKILLS } from './capabilityCatalog'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import SkillReconciliation from './SkillReconciliation.vue'

/* 对账报告只由 SkillReconciliation 自取：AdminConsole 的 <component :is> 不传 props，
   页面声明 prop 分支只会得到一份永远为空的报告。 */

/** 插件数（MCP + 能力 Skill）：健康中心/对账的登记总数含它们，Skill 运行页不含——口径标注用 */
const extraCapabilityCount = EXTRA_CAPABILITY_SKILLS.length

/** 只读观测不计入「需处理」：漂移卡仅统计契约漂移 + W4 哈希漂移 */
const driftActionable = computed(() => (displayReport.value?.drift?.contract || 0) + (displayReport.value?.drift?.hash || 0))
/** 对账异常口径：只计「对账」页签内可定位的异常——登记缺项（表内 diff=unregistered 行）+
    无生效版本（表内 diff=active-missing 行）+ 失效注册（页内「失效注册残留」块/卡头 pill，同 zombieRegistration）。
    2026-10-07 F6-3 修正：原口径把 zombieActive（失效生效版本）与 unwired（接线不一致）计入，但这两类
    对应对账页签内**没有**任何行/pill 可定位（失效生效版本的 skill 已不在户口簿活跃集，对账表不收录），
    造成 KPI 亮 2 而「仅看异常」0 行、卡头 pill 只写「失效注册 1」的同屏互斥口径。
    现两类剔出 KPI，改由 title 如实披露并指向各自可定位的健康检查行（w1-active / w3-wiring）。
    2026-10-09 从零走查 F2 收口：对账接口的 orphanRegistrations 补上与 zombieRegistration 同源的
    退役豁免（isRetiredSkill），两处失效注册口径现已一致（退役行单列 orphanRetiredExempt 注记）。 */
const reconAbnormal = computed(() => {
  const r = reconciliation.value
  return r.missingRegistration + r.missingActive + r.zombieRegistration
})
const completionLive = computed(() => displayReport.value?.completion?.live || 0)
/** 第 4 卡（完成度未达标）title：value=未达标数（需处理语义，0=好），达成数（已上线 N/M）下沉 hint；
    阈值/口径在 title 披露——live 为完成度最高档，登记总数含插件 */
const completionCardTitle = computed(() => {
  const total = reconciliation.value.total
  return `未完成上线的技能 ${global.value.abnormalSkills} 个，已上线 ${completionLive.value}/${total}（含插件）`
})

/** 概要卡 tooltip：解释口径，避免红色数字误读 */
const driftCardTitle = computed(() => {
  const parts = [`需处理：${driftActionable.value} 项（配置改后未同步/发布生效）`]
  // 2026-10-19 用户走查「KPI hint 在报读数」：两类可行动不一致的条数从副行下沉到本长释
  if (driftActionable.value > 0) parts.push(`其中文件与线上 ${drift.value.contract} 条、编译产物 ${drift.value.hash} 条`)
  if (drift.value.runtime > 0) parts.push(`另 ${drift.value.runtime} 条运行观测记录为只读参考，不计入需处理`)
  return parts.join('；')
})
/** 一致性核查卡 title：三项细分 + 登记总数（原副行「登记 N 项」的落点，2026-10-19 下沉） */
const reconCardTitleWithTotal = computed(() => `${reconCardTitle.value}。登记总数 ${reconciliation.value.total} 项`)
const reconCardTitle = computed(() => {
  const r = reconciliation.value
  const parts = [
    `登记缺项 ${r.missingRegistration}`,
    `无生效版本 ${r.missingActive}`,
    `失效注册 ${r.zombieRegistration}`,
  ]
  // 2026-10-07 F6-3：未计入本卡的两类如实披露并指路——它们在「对账」页签内没有可定位的行/pill，
  // 各自的可定位项住在健康检查页签的对应行，不并入本卡以免「KPI 亮 N 而筛选 0 行」
  const excluded: string[] = []
  if (r.zombieActive > 0) excluded.push(`失效生效版本 ${r.zombieActive}（不计入完成度统计）`)
  if (r.unwired > 0) excluded.push(`接线不一致 ${r.unwired}（见健康检查「接线一致性核查 W3」一行）`)
  const exclNote = excluded.length ? `。另有未计入本卡：${excluded.join('、')}` : ''
  const note = r.zombieSkillActive > 0 ? `（另有 ${r.zombieSkillActive} 条失效生效版本，与健康检查「生效版本检查」是同一批数据，不重复计数）` : ''
  const scope = extraCapabilityCount > 0 ? `（登记总数含 ${extraCapabilityCount} 个插件，Skill 运行页不含）` : ''
  return parts.join(' · ') + exclNote + note + scope
})
/** 页头注记只报报告新鲜度 */
const refreshNote = computed(() => {
  if (loading.value) return '检测中…'
  const iso = displayReport.value?.generatedAt
  return iso ? `更新于 ${timeAgo(iso)}` : ''
})

/** 概要卡落点：检查异常 / 契约与哈希不一致定位到具体检查行，两张核查卡落到对应筛选 */
function goAbnormalCheck() {
  focusCheck(firstAbnormalCheckId())
}
function goDriftCheck() {
  focusCheck(drift.value.contract > 0 ? 'field-routing-contract' : 'w4-corehash')
}
function goReconDiff() {
  goReconFilter('abnormal')
}
function goReconUnmet() {
  goReconFilter('unmet')
}
function goReconFilter(diff: 'abnormal' | 'unmet') {
  hcTab.value = 'recon'
  // 落核查页时清掉检查行深链，否则 60s 轮询刷新 items 会把页签拉回健康检查
  void router.replace({ query: { ...omitQuery(['check']), tab: 'recon', diff } })
}
/** 首个异常检查项：没有异常时落在「检查明细」卡头 */
function firstAbnormalCheckId(): HealthCenterItemId | null {
  const item = sortedHealthItems.value.find((i) => isHealthAbnormal(i))
  return item?.id ?? null
}
function focusCheck(id: HealthCenterItemId | null) {
  if (!id) {
    document.getElementById('hc-health')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    return
  }
  hcTab.value = 'health'
  if (deepCheckId.value === id) {
    void locateCheck(id)
    return
  }
  void router.replace({ query: { ...omitQuery(['diff', 'recon']), tab: 'health', check: id } })
}

const router = useRouter()
const route = useRoute()

/* ---------- 两域页签（2026-10-14 页签收敛）----------
   原四页签（健康检查 / 漂移 / 对账 / 完成度）与概要 KPI 四卡一一对应，实测后两页签只有
   一卡孤零零两行跳转（漂移 186px 卡 + 下方 244px 死区）、一卡五根横线（完成度 196px），
   属「为了对齐 KPI 卡数而拆页签」的架构病。收敛依据：
   - 漂移本就是健康检查项的一个子集（w4-corehash / field-routing-contract / field-routing /
     runtime-prompt 四项的 semantics=baseline-drift|runtime-info），具体漂移行与明细一直在
     健康检查列表里；漂移卡独有的只是三个跨页跳转 → 收进对应检查行的动作区（DRIFT_JUMPS），
     不再单开一页（同一批计数已在 KPI 卡说过一次，不在第三处复读）。
   - 完成度分布是「对账表完成度列」的汇总（SkillReconciliation 自己的注释即此口径）→ 并入对账页。
   结果：健康与漂移（服务卡 + 检查列表） / 对账与完成度（完成度构成带 + 对账表），两页都有实内容。
   ?tab= 深链照旧可刷新/分享还原，旧键 drift→health、completion→recon 走别名不 404。 */
type HcTab = 'health' | 'recon'
const HC_TABS: Array<{ id: HcTab; label: string }> = [
  { id: 'health', label: '健康检查' },
  { id: 'recon', label: '技能核查' },
]
const hcTab = ref<HcTab>('health')
function switchTab(t: HcTab) {
  if (hcTab.value === t) return
  hcTab.value = t
  const query = t === 'recon'
    ? omitQuery(['check'])
    : omitQuery(['diff', 'recon'])
  query.tab = t
  // 页签与深链定位参数一一对应：切走时丢掉另一页签的定位键，避免 URL 与屏幕互相矛盾
  if (route.query.tab !== t || Object.keys(query).length !== Object.keys(route.query).length) {
    void router.replace({ query })
  }
}
function omitQuery(keys: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(route.query)) {
    if (keys.includes(k) || v == null) continue
    out[k] = Array.isArray(v) ? v.map(String) : String(v)
  }
  return out
}
/* 页签键盘契约（审核 #78）：roving tabindex（仅选中项可 Tab 进入）+ 左右方向键循环切换并移动焦点，
   兑现 role=tablist/role=tab 的 ARIA tabs 语义（此前四页签全在 Tab 序、方向键无反应，属半套契约） */
const hcTabEls = ref<(HTMLButtonElement | null)[]>([])
function setTabRef(el: unknown, i: number) {
  hcTabEls.value[i] = (el as HTMLButtonElement) || null
}
function onTabKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = HC_TABS.length
  const cur = HC_TABS.findIndex((t) => t.id === hcTab.value)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight') next = (from + 1) % n
  else if (e.key === 'ArrowLeft') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else next = n - 1
  e.preventDefault()
  switchTab(HC_TABS[next].id)
  // 切换后把焦点移到新选中页签（ARIA tabs 惯例）；等 DOM 的 tabindex 更新后再聚焦
  void nextTick(() => hcTabEls.value[next]?.focus())
}
/* 旧深链键别名（2026-10-14 页签收敛）：drift 域并入健康检查页、completion 域并入对账页，
   书签/分享链照常落地，不静默回默认页（与 ApiConfig TAB_ALIAS 同一处置） */
const HC_TAB_ALIAS: Record<string, HcTab> = { drift: 'health', completion: 'recon' }
watch(() => route.query.tab, (t) => {
  const v = HC_TABS.find((x) => x.id === t)?.id ?? HC_TAB_ALIAS[String(t ?? '')]
  if (v && v !== hcTab.value) hcTab.value = v
}, { immediate: true })

const report = ref<HealthCenterSummaryReport | null>(null)
const loading = ref(false)
const failed = ref(false)
const errorText = ref('')
const fixingId = ref<HealthCenterItemId | null>(null)

const displayReport = computed(() => report.value)
/** 健康检查项按 severity 降序（error→warn→ok），异常优先视觉 */
const severityOrder: Record<string, number> = { error: 0, warn: 1, ok: 2 }
const sortedHealthItems = computed(() => {
  const items = displayReport.value?.health?.items ?? []
  return [...items].sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))
})

/** 一行式内联空态修饰（共享原语 .mk-empty--line；与 VirtualProfile / VirtualLearnerCards 同判例：
    经 :class 绑定引用，避免设计守卫把字面量误判为「页面手写 .mk-empty 结构」） */
const LINE_EMPTY = 'mk-empty--line'

const global = computed<HealthGlobalSummary>(
  () => displayReport.value?.global || { total: 0, aux: 0, mainline: 0, handlerOnly: 0, abnormalSkills: 0 },
)
const drift = computed<HealthDriftSummary>(
  () => displayReport.value?.drift || { contract: 0, hash: 0, runtime: 0 },
)
const reconciliation = computed<HealthReconciliationSummary>(
  () =>
    displayReport.value?.reconciliation || {
      total: 0, missingRegistration: 0, zombieRegistration: 0,
      missingActive: 0, zombieActive: 0, zombieSkillActive: 0, unwired: 0,
    },
)
const healthAbnormal = computed(() => displayReport.value?.health.abnormal ?? 0)
/** 异常档位与 KPI / 卡头徽标共用：error→bad 红，warn→warn 琥珀，全正常→ok。
    2026-10-24 修复：KPI 此前固定 warn、卡头固定 bad，同一读数两套颜色。 */
const healthAbnormalTone = computed<'ok' | 'warn' | 'bad'>(() => {
  const items = displayReport.value?.health.items || []
  if (items.some((i) => i.severity === 'error')) return 'bad'
  if (items.some((i) => i.severity === 'warn')) return 'warn'
  return 'ok'
})
/** 检查异常卡悬停：口径 + 本次总数（2026-10-19 用户走查「KPI hint 在报读数」——总数从副行
    下沉到本长释，副行只留口径短语。CP2/CP9 的「值不在 title 复读」仍成立：这里是分母不是值） */
const healthAbnormalTitle = computed(() => {
  const total = displayReport.value?.health?.summary?.total
  const base = '统计「异常」与「需关注」两档检查项，「观测」项仅供参考，不计入异常'
  return total == null ? base : `${base}。本次健康检查共 ${total} 项`
})

/* ---------- 检查项分域：异常/关注项展开，正常项收进折叠组 ----------
   D17：谓词须与后端 abnormal 口径一致——info 是「只读观测项」，不计入异常（告警流同样只收
   warn/error）。此前 info 且 count>0 也进高亮组，致高亮行数 > KPI「检查异常」数（同屏双口径）。 */
function isHealthAbnormal(item: HealthCenterItem): boolean {
  return item.severity === 'error' || item.severity === 'warn' || (item.severity !== 'info' && item.count > 0)
}

/* ---------- 检查明细分域（2026-10-21 用户拍板：服务瓦片退役，分组并进明细列表） ----------
   分组字段 = HealthCenterItem.base（后端 health-center.service.ts buildItem 逐项标注「谁是真源」）。
   组头给域内状态分布，异常域默认展开、全正常域折叠——层级只剩「KPI → 分域 → 逐项」。 */
/** 域中文名：与各检查项 cause 文案同口径，不再另写一句域说明 */
const SERVICE_GROUP_NAMES: Record<HealthCenterItem['base'], string> = {
  'file:core.yaml': '核心文件',
  'file:manifest': '契约清单',
  'file:orchestration': '编排声明',
  'file:skills.yaml': '技能登记册',
  bidirectional: `双向${TERMS.reconcile}`,
  'db:managed': '数据库托管',
  runtime: '运行时遥测',
}
/** 组序按域内最高严重度：异常域排前，10 秒内先看到哪里出事 */
const GROUP_TONE_ORDER: Record<string, number> = { error: 0, warn: 1, ok: 2, info: 3 }
const healthGroups = computed(() => {
  const byBase = new Map<HealthCenterItem['base'], HealthCenterItem[]>()
  // 用已按 severity 排好的清单：组内异常行在前，展开后第一眼就是问题所在
  for (const item of sortedHealthItems.value) {
    const list = byBase.get(item.base)
    if (list) list.push(item)
    else byBase.set(item.base, [item])
  }
  return [...byBase.entries()]
    .map(([base, list]) => {
      const severityCount = (s: HealthCenterItem['severity']): number => list.filter((i) => i.severity === s).length
      const error = severityCount('error')
      const warn = severityCount('warn')
      const ok = severityCount('ok')
      const info = severityCount('info')
      return {
        base,
        name: SERVICE_GROUP_NAMES[base] || base,
        items: list,
        total: list.length,
        ok,
        error,
        warn,
        info,
        abnormal: list.filter(isHealthAbnormal).length,
        // 审核 #100：info-only 域不再亮绿「正常」——绿只代表真正查过且无异常
        tone: error > 0 ? 'error' : warn > 0 ? 'warn' : ok > 0 ? 'ok' : 'info',
      }
    })
    .sort((a, b) => (GROUP_TONE_ORDER[a.tone] ?? 9) - (GROUP_TONE_ORDER[b.tone] ?? 9))
})
/** 检查行的跨页入口：漂移项去对应面板，运行时告警项去执行日志 / 运维工具 */
interface RowJump { label: string; go: () => void }
function rowJump(item: HealthCenterItem): RowJump | null {
  if (item.id === 'w4-corehash' && drift.value.hash > 0) return { label: '去发布 →', go: () => goDrift('hash') }
  if (item.id === 'runtime-prompt' && drift.value.runtime > 0) return { label: '执行日志 →', go: () => goDrift('runtime') }
  if (item.id === 'runtime-degradation' && item.count > 0) {
    return { label: '执行日志 →', go: () => void router.push('/admin/execution-logs') }
  }
  if (item.id === 'runtime-outbox-dead' && item.count > 0) {
    return { label: '运维工具 →', go: () => void router.push('/admin/ops-hub?tab=tools') }
  }
  return null
}
function rowJumpLabel(item: HealthCenterItem): string {
  return rowJump(item)?.label ?? ''
}
function runRowJump(item: HealthCenterItem) {
  rowJump(item)?.go()
}

/** 时刻 HH:mm（修复记录用时；后端检查项无逐项时间，事件流撤除后本函数只服务修复日志） */
function hhmm(iso: string | undefined): string {
  const ts = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(ts)) return '--:--'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 行内明细展开状态（默认：异常/关注项展开，正常项收起） */
const detailOpenIds = ref<Set<string>>(new Set())
/* G4（2026-10-10）：只播种一次。此前 watch 对每份新 items 数组都重播种——本页 60s 轮询
   每轮替换 report（health.items 新数组引用），把用户手动收起/展开的明细打回默认态
   （外部评审命中）。取舍：轮询后新出现的异常项不再自动展开——服务卡红点/告警事件流
   仍会突出它，?check= 深链（下方 watch）也仍可展开定位目标行；两相权衡保用户态优先。 */
let detailSeeded = false
function seedDetailOpen(items: HealthCenterItem[]) {
  if (detailSeeded) return
  detailSeeded = true
  const s = new Set<string>()
  for (const i of items) if (isHealthAbnormal(i)) s.add(i.id)
  detailOpenIds.value = s
}
watch(() => displayReport.value?.health.items, (items) => { if (items) seedDetailOpen(items) }, { immediate: true })

/** ?check=<id> 深链（Orchestrator「哈希漂移 N」与页首 KPI 卡）：展开目标行并滚动定位。
    注意在 seed 之后执行（同源 watcher 按注册顺序，上面先播种默认展开集）。 */
const deepCheckId = computed(() => (typeof route.query.check === 'string' ? route.query.check.trim() : ''))
watch([deepCheckId, () => displayReport.value?.health.items], async ([cid, items]) => {
  if (!cid || !items?.length || !items.some((i) => i.id === cid)) return
  await locateCheck(cid)
}, { immediate: true })
async function locateCheck(id: string) {
  hcTab.value = 'health'
  const s = new Set(detailOpenIds.value)
  s.add(id)
  detailOpenIds.value = s
  // 目标若在折叠的分域组里，先展开它（等分组节点挂上再按 id 找）
  await nextTick()
  openGroupOf(id)
  await nextTick()
  document.getElementById(`hc-check-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function detailOpen(id: string): boolean { return detailOpenIds.value.has(id) }
/** 展开目标检查项所在的分域组（明细行在 <details> 里，折叠时滚动定位不可见） */
function openGroupOf(id: string) {
  const base = displayReport.value?.health.items.find((i) => i.id === id)?.base
  if (!base) return
  const el = document.getElementById(`hc-group-${base}`) as HTMLDetailsElement | null
  if (el) el.open = true
}
function toggleDetail(id: string) {
  const s = new Set(detailOpenIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  detailOpenIds.value = s
}

/** 明细截断：防止几十条遥测把页面拉爆 */
const DETAIL_LIMIT = 20
function visibleDetail(item: HealthCenterItem): string[] {
  // 运行时遥测：后端按 Skill 归并 + 带最近时间 → 先本地化再截断（归并后行数通常很少）
  if (item.id === 'runtime-prompt') return runtimePromptLines(item).slice(0, DETAIL_LIMIT)
  return item.detail.slice(0, DETAIL_LIMIT)
}
/** 运行时遥测明细本地化：后端 `agent ×N @ ISO` → `agent ×N｜最近 9月6日 10:14` */
function runtimePromptLines(item: HealthCenterItem): string[] {
  return item.detail.map((line) => {
    const at = line.lastIndexOf(' @ ')
    if (at < 0) return line
    const ts = new Date(line.slice(at + 3)).getTime()
    return Number.isFinite(ts) ? `${line.slice(0, at)}｜最近 ${formatLocalTime(ts)}` : line
  })
}
function formatLocalTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}
function detailTruncated(item: HealthCenterItem): boolean { return item.detail.length > DETAIL_LIMIT }
/** 截断提示单源（R6 复读单源化）：异常区与折叠区两处明细尾注共用一份 */
function detailMoreText(item: HealthCenterItem): string {
  return `共 ${item.detail.length} 条明细，仅显示前 ${DETAIL_LIMIT} 条`
}

/* ---------- 数字带单位 + 语义标签提示 ---------- */
const COUNT_UNITS: Record<string, string> = {
  'baseline-drift': '处不一致',
  consistency: '处偏差',
  'override-record': '条覆盖记录',
  'runtime-info': '条遥测记录',
}
function countTitle(item: HealthCenterItem): string {
  const unit = COUNT_UNITS[item.semantics] || '项'
  const detail = item.detail.length ? `（明细 ${item.detail.length} 条）` : ''
  return `${item.count} ${unit}${detail}`
}
function semHint(semantics: HealthCenterItem['semantics']): string {
  return SEMANTICS_META.find((m) => m.id === semantics)?.hint || ''
}

/* ---------- 健康检查项展示 ---------- */
/* 语义标签词表单源（审核 #103）：glossaryMeta.SEMANTICS_META 自称「HealthCenter 徽章人话，前端唯一来源」，
   本地 map 键值逐字重复——删本地拷贝直接引用，词表回单源 */
function semanticsLabel(semantics: HealthCenterItem['semantics']) {
  return SEMANTICS_META.find((m) => m.id === semantics)?.label || semantics
}
/** 行内语义词（2026-10-24）：正常项 / 零计数不再挂「偏差 / 不一致」这类异常词，
    改为中性描述，避免正常行自带告警语义。 */
function semanticsText(item: HealthCenterItem): string {
  if (item.severity === 'ok') return '正常'
  if (!item.count) return '无异常'
  return semanticsLabel(item.semantics)
}

async function refresh(force = false, throwOnError = false) {
  loading.value = true
  failed.value = false
  try {
    const res = await adminHealthCenterApi.getSummary(force)
    report.value = res.data?.data ?? null
  } catch (e) {
    failed.value = true
    errorText.value = errMsg(e)
    // 轮询路径（throwOnError=true）必须把异常抛出，useSafePolling 才能累计失败次数触发退避/断路器；
    // 手动路径（onMounted / 重试按钮）保持吞异常只做 UI 失败态，避免未捕获 rejection
    if (throwOnError) throw e
  } finally {
    loading.value = false
  }
}

/* ---------- 跳转（2B 起全部 router 导航；入口卡 → 明细页） ---------- */
/** 归一 skillId：去 skill: 前缀并校验词法，不合法返回 null（detail 是自由文本，宁缺毋滥） */
function normSkillId(token: string | undefined): string | null {
  const t = (token ?? '').replace(/^skill:/, '')
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(t) ? t : null
}
/** 从检查项明细尽力提取首个 skillId（hash/yaml 异常跳 Skill 工作台时深链 ?skill= 定位用）。
    后端 detail 为自由文本，按各检查项的实际格式宽松解析：w4 行首是 agentId（`skill:<id> status=…`）、
    params 行首是裸 skillId（`<id> <字段>：core=…`，缺声明行首是「[提示]」自然解析不出）、
    yaml 交叉校验的 skillId 内嵌在全角冒号后（`…：<id>` / `…：<id>=`）。提取不到则退回不带参跳转。 */
function extractSkillId(id: HealthCenterItemId): string | null {
  const lines = displayReport.value?.health.items.find((i) => i.id === id)?.detail ?? []
  if (id === 'w4-corehash') return normSkillId(lines[0]?.split(/\s+/)[0])
  if (id === 'params-consistency') {
    for (const line of lines) {
      const hit = normSkillId(line.split(/\s+/)[0])
      if (hit) return hit
    }
    return null
  }
  for (const line of lines) {
    const m = /[：:]\s*([a-z0-9]+(?:-[a-z0-9]+)*)(?:[=\s]|$)/.exec(line)
    if (m) return m[1]
  }
  return null
}
/** Skill 详情深链（2026-10-24）：目标改到可见场景 /admin/skills 的二级页。
    原目标是隐藏场景 skill-workbench，且 ?skill= 无人消费——点进去既定位不到技能，
    也没有侧栏高亮/面包屑。能定位到具体 skill 时落「协议」页签（发布/哈希相关）。 */
function workbenchPath(id: HealthCenterItemId): string {
  const skillId = extractSkillId(id)
  return skillId
    ? `/admin/skills?view=skill&id=${encodeURIComponent(skillId)}&skdTab=protocol`
    : '/admin/skills'
}
function goDrift(kind: keyof HealthDriftSummary) {
  if (kind === 'contract') void router.push('/admin/orchestrator?tab=drift')
  // hash 漂移即健康项 w4-corehash 的口径（HealthDriftSummary 注释），深链带上首个漂移 skill
  else if (kind === 'hash') void router.push(workbenchPath('w4-corehash'))
  else void router.push('/admin/execution-logs')
}

/** manual 项跳对应面板：字段路由/契约维度 → 编排图漂移 tab；参数/契约/yaml → Skill 工作台；
    其余（W1/W2/W3 对账族等）**留在本页**：它们的检查行就在本页健康检查区，
    展开明细并滚过去即可——原兜底指向 /admin/skills?tab=health，那是本页被抽出前的宿主，
    2026-09-29 抽出后那条路径只会绕一圈回到本页（Skills 侧还会把退役 tab 改投回来）。 */
/** 只有真正跨页的 manual 项才给「查看 →」；其余项的 jump 只是展开本行明细，
    与点击行主体同一动作，不再重复一个按钮 */
const EXTERNAL_JUMP_IDS = new Set([
  'field-routing',
  'field-routing-contract',
  'fields-sync',
  'orchestration-steps',
  'yaml-crosscheck',
  'params-consistency'
])
const canJumpAway = (id: string) => EXTERNAL_JUMP_IDS.has(id)

/** 最近修复 → 审计日志：按 ID 关键词直达（审计页已支持 ?q= 筛选，2026-10-24） */
function goAuditFix(auditId: string) {
  void router.push({ path: '/admin/audit-logs', query: { q: auditId } })
}

function jump(id: HealthCenterItemId) {
  // 2026-10-24：字段路由/字段同步属于「字段路由表」，不是治理/漂移面板（drift→governance 会落错）
  if (id === 'field-routing' || id === 'field-routing-contract' || id === 'fields-sync') void router.push('/admin/orchestrator?tab=routing')
  // 编排步骤解析（2026-10-12 从编排图页告警条搬进健康中心）：原页级告警的落点在此复现——
  // 编排图「字段旅程」面板里红「未解析」徽章即名单（切面板后按阶段 chips 逐段核对）
  else if (id === 'orchestration-steps') void router.push('/admin/orchestrator?tab=journey')
  else if (id === 'yaml-crosscheck' || id === 'params-consistency') void router.push(workbenchPath(id))
  else {
    // 域内定位（2026-10-04 平铺改页签）：先切到健康检查页签，再展开目标行并滚动定位
    hcTab.value = 'health'
    if (!detailOpen(id)) toggleDetail(id)
    openGroupOf(id)
    void nextTick().then(() => {
      document.getElementById(`hc-check-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
}

/* ---------- 最近修复（会话内证据）----------
   修复成功结果（时间/检查项/备份目录/审计 id）落在检查明细卡内一行；刷新即清，
   权威记录在审计日志与后端备份目录。 */
interface SessionFixRecord {
  key: number
  label: string
  time: string
  backupDir: string | null
  auditId?: string
}
const recentFixes = ref<SessionFixRecord[]>([])

async function copyBackupDir(dir: string) {
  try {
    await navigator.clipboard.writeText(dir)
    toast.success('备份目录已复制')
  } catch {
    toast.error('复制失败')
  }
}

async function fix(id: HealthCenterItemId) {
  const item = displayReport.value?.health.items.find((i) => i.id === id)
  // 确认框只留后果：修复即刻在线上生效，产物固化进代码库由工程同学提交收尾。
  const ok = await askConfirm({
    title: '一键修复',
    message: `将执行「${item?.label || id}」的自动修复。\n修复前自动备份，结果写入审计日志。\n产物若是代码库跟踪文件：修复即刻在线上生效，未提交前下次部署可能回退。`,
    confirmText: '执行修复',
    danger: false,
  })
  if (!ok) return
  fixingId.value = id
  try {
    const res = await adminHealthCenterApi.fix(id)
    const data = res.data?.data
    if (!data) throw new Error('修复响应为空')
    recentFixes.value.unshift({
      key: Date.now(),
      label: item?.label || id,
      time: hhmm(new Date().toISOString()),
      backupDir: data.backupDir,
      auditId: data.auditId,
    })
    if (recentFixes.value.length > 5) recentFixes.value.length = 5
    toast.success(data.gitCommitHint)
    // 修复后强制复检并刷新（后端已写审计，缓存已失效）
    await refresh(true)
  } catch (e: any) {
    const hint = e?.response?.data?.error?.fixHint
    toast.error(`修复失败：${errMsg(e)}${hint ? `（${hint}）` : ''}`)
  } finally {
    fixingId.value = null
  }
}

/* 60s 自动轮询：统一走 useSafePolling（并发守卫 + 指数退避 + 断路器 + 页面隐藏跳过），
   替代此前无防护的裸 setInterval。
   审核 #79：refresh 默认吞异常只做 UI 失败态，轮询回调因此永不抛出 → 失败计数恒 0、
   退避/断路器形同虚设。轮询路径传 throwOnError=true 把异常透出，让安全轮询真正生效。 */
const { start: startPolling, stop: stopPolling } = useSafePolling(
  async () => {
    if (isLive.value && !loading.value) await refresh(false, true)
  },
  {
    interval: 60_000,
    maxBackoff: 300_000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
  }
)
onMounted(() => {
  // ?refresh=1：深链强制重算（避开 60s 缓存）
  const force = route.query.refresh === '1' || route.query.refresh === 'true'
  if (isLive.value) void refresh(force)
  startPolling()
})
// 顶栏刷新：本页报告与对账都随 liveRefreshSeq 重拉（轮询页自身没有刷新钮）
watch(liveRefreshSeq, () => { if (isLive.value) void refresh(true) })
onUnmounted(() => {
  stopPolling()
})
defineExpose({ refresh })
</script>

<style scoped>
/* 页签内容容器（审核 #78：role=tabpanel）：原 <template> 不产生 DOM，卡片直接是 .mk-page 的
   grid 子项吃页面 gap；包一层 div 后需自持同款堆叠节拍与 min-width:0，避免卡间距塌陷/横向溢出 */
.hc-panel { display: grid; gap: var(--mk-stack-gap); align-content: start; min-width: 0; }
/* 页头报告新鲜度注记（轮询页不放手动刷新钮） */
.hc-refresh-note { flex: none; align-self: center; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
/* 首载骨架（R3）：形状由 MkSkeleton 提供，本类只补占位布局与间距 */
.hc-skel__kpi { display: grid; gap: 8px; align-content: start; }
.hc-skel__rows { padding: 12px 16px 14px; }
/* 滚动锚点（技能对账外层：组件自身即卡，这里只留定位不留卡盒） */
/* 四域页签（2026-10-04 平铺改页签）：样式 2026-10-05 CM1 收敛到全局
   .tabs/.tab（mk-primitives.css），本页不再私持拷贝。 */
/* 漂移页签一致空态（2026-10-04：页签常驻，无漂移显 ok 空态卡而非隐匿整段） */

/* 检查明细分域组（2026-10-21：服务瓦片退役，每组一个可折叠标题行；
   组内检查行沿用 .hc-check 文法，组头与行同一条 16px 内衬轴） */
.hc-group { border-top: 1px solid var(--mk-line); }
.hc-group:first-of-type { border-top: 0; }
.hc-group__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 16px;
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.hc-group__summary::-webkit-details-marker { display: none; }
.hc-group__summary::before {
  content: "▸";
  flex: none;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  transition: transform 0.14s ease;
}
.hc-group[open] > .hc-group__summary::before { transform: rotate(90deg); }
.hc-group__name { min-width: 0; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.hc-group__sep { color: var(--mk-faint); }
.hc-group__stats { display: flex; flex-wrap: wrap; gap: 4px 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.hc-group__stats > span + span::before { content: "/"; margin: 0 10px; color: var(--mk-faint); }
.hc-group__stats b { color: var(--mk-ink); font-weight: 700; font-variant-numeric: tabular-nums; }
/* 异常/需关注两桶按 tone 着色，与检查行圆点同色词汇；正常/观测保持中性 */
.hc-group__stat--error, .hc-group__stat--error b { color: var(--mk-red); }
.hc-group__stat--warn, .hc-group__stat--warn b { color: var(--mk-amber); }
/* 组内最后一行不再叠一条分隔线（组头已有上边线） */
.hc-group > .hc-checks > .hc-check:last-child { border-bottom: 0; }

/* 健康检查行 */
/* 三列固定骨架：主列 | 计数+语义 | 动作列。动作列宽度固定后，所有行的计数/语义
   与动作钮都落在同一竖线上，不再随行内文案长短跳动。 */
.hc-check {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 128px 172px;
  gap: 0 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--mk-line);
}
/* 子行左缩进 16px：父组名（组头）在子行标题左侧，层级一眼可读 */
/* 32→48：32 时子行标题与父组名几乎同 x（实测 331 vs 332），层级读不出来 */
.hc-group > .hc-checks > .hc-check { padding-left: 48px; }
.hc-check:last-child { border-bottom: none; }
.hc-check__row { display: flex; align-items: center; gap: 10px; padding: 10px 0; min-width: 0; background: none; border: 0; font: inherit; text-align: left; cursor: pointer; }
.hc-check__metrics { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
.hc-check__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.hc-check__dot--ok { background: var(--mk-green); }
.hc-check__dot--warn { background: var(--mk-amber); }
.hc-check__dot--error { background: var(--mk-red); }
.hc-check__dot--info { background: var(--mk-blue); }
.hc-check__main { flex: 1; min-width: 0; display: grid; gap: 2px; }
/* 行标题比说明高一档：异常的主语要压过 cause 小字 */
.hc-check__main strong { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.hc-check__main span { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.hc-check__num { font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink); min-width: 30px; text-align: right; font-variant-numeric: tabular-nums; }
.hc-check__sem { font-size: var(--mk-fs-micro); color: var(--mk-muted); background: var(--mk-line); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
/* 正常 / 零计数用中性底，不继承异常语义的着色 */
.hc-check__sem--neutral { background: var(--mk-surface-3); color: var(--mk-faint); }
.hc-check__caret { color: var(--mk-faint); font-size: var(--mk-fs-micro); flex: none; }
.hc-check__actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px 8px; min-width: 0; }

/* 最近修复：卡头下方一行，修复后只增一行 */
.hc-fixlog {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
}
.hc-fixlog__label { font-weight: 700; color: var(--mk-ink); }
.hc-fixlog__row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.hc-fixlog__time { flex: none; color: var(--mk-faint); font-family: var(--mk-mono); font-variant-numeric: tabular-nums; }
.hc-fixlog__item { flex: none; color: var(--mk-ink); }
.hc-fixlog__path { min-width: 0; overflow-wrap: anywhere; color: var(--mk-muted); font-family: var(--mk-mono); }
.hc-fixlog__path--none { color: var(--mk-faint); font-family: inherit; }
.hc-check__detail { grid-column: 1 / -1; padding: 0 0 10px 18px; display: grid; gap: 4px; }
/* 检查明细是中文说明 + 数值混排，走正文无衬线（等宽只给 id/代码类机器串） */
.hc-check__detail p { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); overflow-wrap: anywhere; }
.hc-check__detail-more { color: var(--mk-amber) !important; }

/* 窄屏：动作区（跳转/修复钮）改到行下方，否则固定列把标题挤成一字一行 */
@media (max-width: 700px) {
  .hc-group__summary { flex-wrap: wrap; }
  .hc-check { grid-template-columns: minmax(0, 1fr); }
  .hc-check__actions { flex-wrap: wrap; padding: 0 0 10px 18px; }
}

/* 4K：检查行跟随全站节奏（概要 KPI 由 MkKpi 自带档位） */
@media (min-width: 2000px) {
  .hc-check__main strong { font-size: var(--mk-fs-emphasis); }
  .hc-check__num { font-size: var(--mk-fs-emphasis); }
}
@media (min-width: 2800px) {
  .hc-check__main strong { font-size: var(--mk-fs-emphasis); }
  .hc-check__num { font-size: var(--mk-fs-emphasis); }
}
@media (min-width: 3600px) {
  .hc-check__main strong { font-size: var(--mk-fs-emphasis); }
  .hc-check__main span, .hc-check__sem { font-size: var(--mk-fs-body); }
  .hc-check__num { font-size: var(--mk-fs-emphasis); }
}
</style>