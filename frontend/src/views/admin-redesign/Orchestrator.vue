<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名 + 刷新上移；状态条退位为纯状态摘要（阶段/Skill/交接/未解析/W4） -->
    <MkPageHead title="编排图" sub="顶层 Agent 数据流转逻辑图 · 字段血缘与阶段交接">
      <template #actions>
        <!-- 刷新此前只重拉 definitions， stages / 对账仍是旧值（治理面板数字对不上）→ 三个域全拉 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="refreshing" @click="refreshAll">{{ refreshing ? '刷新中…' : '刷新' }}</button>
      </template>
    </MkPageHead>
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta">{{ pageLoading ? '—' : stages.length }} 阶段 · {{ pageLoading ? '—' : totalSkills }} 个 Skill</span>
      <!-- 原型 statusbar meta「N 处阶段交接」：线性拓扑下 = 阶段数 - 1 -->
      <span class="mk-status__meta">{{ pageLoading ? '—' : handoffCount }} 处阶段交接</span>
      <!-- 红字必须可点（评审「异常→动作→证据断链」+ P1#27）：
           未解析 → 页内切「字段旅程」面板并定位首个含未解析步骤的阶段（DataFlowGraph 的「未解析」徽章即名单）；
           哈希漂移 → 跳健康中心（W4 coreHash 检查的归属页；本页治理面板的 DriftAuditPanel 只覆盖契约漂移） -->
      <button
        v-if="unresolvedCount > 0"
        type="button"
        class="mk-status__meta mk-status__meta--bad mk-status__meta-link"
        title="点击切到「字段旅程」面板：红「未解析」徽章即名单（定位到首个含未解析步骤的阶段）"
        @click="goUnresolved"
      >未解析 {{ unresolvedCount }}</button>
      <button
        v-if="w4Drifted.length"
        type="button"
        class="mk-status__meta mk-status__meta--bad mk-status__meta-link"
        title="W4 core 哈希漂移名单在健康中心的健康检查（w4-corehash）；点击跳转"
        @click="goHashDrift"
      >{{ TERMS.driftHashQualified }} {{ w4Drifted.length }}</button>
    </div>

    <!-- 阶段导航：五个 tab = 五个阶段（浏览 + 编辑 + 治理都在阶段工作区内）——chrome 固定 -->
    <div class="orch-stage-tabs" role="tablist">
      <button
        v-for="s in stages"
        :key="s.id"
        type="button"
        role="tab"
        class="orch-stage-tab"
        :class="{ 'is-active': !['sandbox', 'overview'].includes(pane) && active === s.id }"
        :aria-selected="!['sandbox', 'overview'].includes(pane) && active === s.id"
        :title="stageTabTitle(s)"
        @click="selectStage(s.id)"
      >
        <span class="orch-stage-tab__name">{{ s.name.replace(/阶段$/, '') }}</span>
        <span class="orch-stage-tab__meta">{{ s.skills.length }} Skill</span>
      </button>
    </div>

    <!-- 子面板页签（原型 .tabs 下划线页签：2026-10-01 由 mk-pills 胶囊迁入——
         胶囊只做筛选 chips，视图/分区切换归页签）：五个面板统一可达——
         总览（全旅程 odg 画布，缺省）/字段旅程/字段路由/治理/沙盘 -->
    <div class="tabs orch-pane-tabs" role="tablist" aria-label="编排图子面板">
      <button v-for="pt in ORCH_PANES" :key="pt.id" type="button" role="tab" class="tab"
        :aria-selected="pane === pt.id" @click="pane = pt.id">{{ pt.label }}</button>
    </div>

    <!-- ===== 总览：全旅程 odg 画布（newui/admin odg-canvas 形态）=====
         五阶段并列列（阶段头 + Skill 节点 + 入/出参 chip + 产出字段），
         列间 SVG 三次贝塞尔连线（箭头 + 下一阶段入参字段标签），layoutOrch 在
         渲染/窗口 resize 时重算；点 Skill 节点进入该技能详情二级页（原型 open-skill）。 -->
    <div v-if="pane === 'overview' && stages.length" class="orch-pane orch-overview">
      <section class="mk-card mk-card--fill orch-odg-page">
      <div class="mk-card__head">
        <h3 class="mk-card__title">字段数据旅程（逻辑图 · 字段血缘）</h3>
        <!-- 图例（原型 card__tools：卡头右侧只放工具/图例，title 独占左侧） -->
        <div class="mk-card__head-right">
          <span class="orch-odg-chip orch-odg-chip--in">阶段入参</span>
          <span class="orch-odg-chip orch-odg-chip--out">阶段产出</span>
        </div>
      </div>
      <div class="orch-odg-scroll">
        <div ref="odgCanvasEl" class="orch-odg-canvas">
          <svg ref="odgSvgEl" class="orch-odg-svg" aria-hidden="true" />
          <div v-for="(s, i) in stages" :key="s.id" class="orch-odg-col">
            <header class="orch-odg-colhead">
              <span class="orch-odg-no">{{ i + 1 }}</span>
              <span class="orch-odg-colname">{{ s.name }}</span>
              <span class="orch-odg-agent mono">{{ s.agentId }}</span>
            </header>
            <div class="orch-odg-body">
              <button
                v-for="(sk, j) in s.skills"
                :key="sk.id"
                type="button"
                class="orch-odg-node"
                :title="`查看「${sk.name}」详情`"
                @click="openSkillFromOverview(sk.id)"
              >
                <span class="orch-odg-idx mono">{{ i + 1 }}.{{ j + 1 }}</span>
                <span class="orch-odg-nodename">{{ sk.name }}</span>
                <span class="orch-odg-nodemeta mono">{{ s.agentId }}</span>
              </button>
            </div>
            <footer class="orch-odg-foot">
              <!-- 字段契约三态：未加载显「…」（不按 0 渲染——加载完成前「入 0」与「真无必填」不可分辨；
                   部分阶段确无必填入参，加载后「入 0」属实） -->
              <span class="orch-odg-chip orch-odg-chip--in" :title="contractOf(s.id).loaded ? `必填入参 ${contractOf(s.id).ins.length} 个` : '字段契约加载中…'">入 {{ contractOf(s.id).loaded ? contractOf(s.id).ins.length : '…' }}</span>
              <span class="orch-odg-chip orch-odg-chip--out" :title="contractOf(s.id).loaded ? `产出字段 ${contractOf(s.id).outs.length} 个` : '字段契约加载中…'">出 {{ contractOf(s.id).loaded ? contractOf(s.id).outs.length : '…' }}</span>
              <span class="orch-odg-fields" :title="contractOf(s.id).outs.join(' · ')">{{ contractOf(s.id).outs.slice(0, 4).join(' · ') }}<template v-if="contractOf(s.id).outs.length > 4">…</template></span>
            </footer>
          </div>
        </div>
      </div>
      </section>

      <!-- 阶段交接明细（原型 1624-1629 独立卡，5 列）：交接 = 相邻阶段 id 对（mono 小写）、
           上/下游 Agent（mono）；传递字段口径 = 下游阶段的必填入参（stageFieldContract.ins，
           字段路由 hard-required），即原型 s.in（1651 行）的真实数据对应物——本页 stages 拓扑
           只有 consumes/produces 汇总、无原型式 in/outs；字段数 = 传递字段条数。
           画布连线标签（layoutOrch）仍标上游产出（outs）：连线沿边流动的是上游产出，
           交接表登记的是下游准入契约，两处口径差是有意的 -->
      <section class="mk-card orch-handoff">
        <div class="mk-card__head">
          <h3 class="mk-card__title">阶段交接明细</h3>
        </div>
        <div class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr><th>交接</th><th>上游 Agent</th><th>下游 Agent</th><th>传递字段</th><th class="mk-th--right">字段数</th></tr>
            </thead>
            <tbody>
              <tr v-for="(h, i) in stageHandoffs" :key="i">
                <td class="mono orch-handoff__pair">{{ h.from }} → {{ h.to }}</td>
                <td class="mono">{{ h.fromAgent }}</td>
                <td class="mono">{{ h.toAgent }}</td>
                <td class="orch-handoff__fields">
                  <!-- 点号长串 → 徽章列表（2026-10-03 反馈「字段密集堆叠」）：7 个键名连成
                       一句独吞 65% 列宽，键名边界只能靠 · 猜；逐枚徽章可数可扫，列宽随之收回 -->
                  <template v-if="h.fields.length">
                    <span v-for="f in h.fields" :key="f" class="mk-badge mk-badge--sm mono">{{ f }}</span>
                  </template>
                  <span v-else class="mk-na">—</span>
                </td>
                <td class="mk-num">{{ h.fields.length }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <div v-else-if="pane === 'overview'" class="orch-pane orch-pane--center">
      <!-- 总览无数据：走与既有一致的加载/空态（stages 为空时 current 也为空） -->
      <template v-if="pageLoading">
        <MockSkeletonTable :cols="6" :rows="8" />
        <MkLoading text="编排数据加载中…" />
      </template>
      <MkEmptyState
        v-else-if="topoFailure"
        tone="error"
        icon="⚠"
        title="编排阶段数据加载失败"
        :description="topoFailure"
        action-text="重试"
        @action="retryStages"
      />
      <MkEmptyState
        v-else
        title="暂无编排阶段数据"
        description="后端未登记任何阶段：编排文件与拓扑 Agent 均为空。"
      />
    </div>

    <!-- 阶段工作区：占满剩余视高（fill 布局，底部不再有空白）。
         旅程图 = 卡内画布滚动（工具条/旅程条吸顶）；路由/治理/沙盘 = 面板内滚；页面本身不滚 -->
    <DataFlowGraph
      v-else-if="current && pane === 'journey'"
      class="orch-pane orch-pane--journey"
      :key="`${active}-${flowKey}`"
      :stage="active"
      @changed="onRoutingChanged"
      @stage="onStageChange"
    />
    <section v-else-if="current && pane === 'routing'" class="mk-card mk-card--fill orch-pane orch-routing">
      <div class="mk-card__head">
        <h3 class="mk-card__title">字段路由与编排文件</h3>
        <!-- 阶段级变量流：截断只显示前 5 项，必须把总数说出来（此前静默 slice） -->
        <span class="mk-card__meta" :title="ioContractTitle(current)">
          {{ current.skills.length }} Skill · 输入 {{ current.consumes.length }}/{{ current.consumesTotal }} 字段 · 输出 {{ current.produces.length }}/{{ current.producesTotal }} 字段
        </span>
      </div>
      <FieldRoutingTable :stage="active" @changed="onRoutingChanged" />
    </section>
    <section v-else-if="current && pane === 'governance'" class="mk-card mk-card--fill orch-pane orch-pane--scroll">
      <div class="mk-card__head">
        <h3 class="mk-card__title">治理：{{ TERMS.driftContract }}报告 + 变更审计</h3>
        <!-- 运行时定义与对账口径落到治理面板：orchCount/skillDefCount/recReport 此前只写不读 -->
        <span class="mk-card__meta" :title="govMetaTitle">
          编辑后核对文件与库一致 · 编排定义 {{ orchCount }} · Skill 定义 {{ skillDefCount }}<template v-if="recReport"> · 对账已上线 {{ recLiveCount }}/{{ recTotalCount }}</template>
        </span>
      </div>
      <!-- 定义明细（definitionNotes 此前只写不读，两个定义接口等于白拉） -->
      <ul v-if="definitionNotes.length" class="orch-gov-defs">
        <li v-for="(n, i) in definitionNotes" :key="i" class="orch-gov-defs__item">{{ n }}</li>
      </ul>
      <DriftAuditPanel :stage="active" />
    </section>
    <div v-else-if="pane === 'sandbox'" class="orch-pane orch-pane--scroll">
      <SandboxView />
    </div>
    <div v-else class="orch-pane orch-pane--center">
      <!-- 首屏骨架：此前是居中小 spinner，4K 下整页空白只挂一行字 -->
      <template v-if="pageLoading">
        <MockSkeletonTable :cols="6" :rows="8" />
        <MkLoading text="编排数据加载中…" />
      </template>
      <!-- 接口失败 ≠ 没有数据：此前拓扑/阶段拉取失败也落「暂无编排阶段数据」，
           管理员无从判断是该重试还是后端本就为空 -->
      <MkEmptyState
        v-else-if="topoFailure"
        tone="error"
        icon="⚠"
        title="编排阶段数据加载失败"
        :description="topoFailure"
        action-text="重试"
        @action="retryStages"
      />
      <MkEmptyState
        v-else
        title="暂无编排阶段数据"
        description="后端未登记任何阶段：编排文件与拓扑 Agent 均为空。"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dataSource, openSubPage } from './store'
import { liveTopoNodes, liveSkillCatalog, liveLoading, liveFailures, errMsg, reloadLiveTopology } from './live'
import { TERMS } from './terms'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi, adminSkillsApi, type SkillReconciliationReport } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import DataFlowGraph from './DataFlowGraph.vue'
import SandboxView from './SandboxView.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MockSkeletonTable from './SkeletonTable.vue'

/** 阶段工作区子面板:总览(全旅程 odg 画布,缺省)/字段旅程/字段路由/治理;沙盘为顶层独立面板(深链 ?tab=sandbox 兼容) */
type OrchPane = 'overview' | 'journey' | 'routing' | 'governance' | 'sandbox'
const ORCH_PANES: Array<{ id: OrchPane; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'journey', label: '字段旅程' },
  { id: 'routing', label: '字段路由' },
  { id: 'governance', label: '治理' },
  { id: 'sandbox', label: '沙盘契约' },
]
const pane = ref<OrchPane>('overview')

/** 字段流转图数据版本：行级编辑/字段路由变更后 +1 触发重挂载刷新 */
const flowKey = ref(0)
function onRoutingChanged() {
  flowKey.value++
}
/** 图内锚点跳转切阶段：同步 active（tab 高亮跟随） */
function onStageChange(s: string) {
  active.value = s
}

const route = useRoute()
const router = useRouter()

/** ?stage=&tab= 直达（Skill 设计页字段路由 tab → 编排图页跳转闭环；旧 /admin/topology 重定向落位阶段视图） */
function applyStageQuery() {
  const qStage = typeof route.query.stage === 'string' && route.query.stage.trim() ? route.query.stage.trim() : ''
  const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (qStage) active.value = qStage
  // ?tab= 语义:overview(缺省)/journey/routing/governance/sandbox;legacy:drift→治理,topology→旅程
  if (qTab === 'sandbox') pane.value = 'sandbox'
  else if (qTab === 'routing') pane.value = 'routing'
  else if (qTab === 'governance' || qTab === 'drift') pane.value = 'governance'
  else if (qTab === 'journey' || qTab === 'topology') pane.value = 'journey'
  else pane.value = 'overview'

}

function selectStage(id: string) {
  active.value = id
  if (pane.value === 'sandbox') pane.value = 'journey'
  flowKey.value++
}



const defsLoading = ref(false)
const defsLoaded = ref(false)
/** 阶段清单端点拉取中（与 defsLoading / recLoading 共同驱动状态条「刷新」忙碌态） */
const stagesLoading = ref(false)
const orchCount = ref(0)
const skillDefCount = ref(0)
const definitionNotes = ref<string[]>([])
const orchDefs = ref<Array<Record<string, any>>>([])

/* ================= 完成度对账（reconciliation + readiness W4，live-only） ================= */
const recReport = ref<SkillReconciliationReport | null>(null)
const w4Drifted = ref<string[]>([])
/** 对账拉取中（供「刷新」按钮统一忙碌态） */
const recLoading = ref(false)

async function loadReconciliation() {
  recLoading.value = true
  try {
    const [rec, read] = await Promise.all([
      adminSkillsApi.getReconciliation().catch(() => null),
      adminSkillsApi.getReadiness(false).catch(() => null),
    ])
    recReport.value = rec?.data?.data ?? null
    const checks = (read?.data?.data as { checks?: { W4?: { drifted?: string[] } } } | undefined)?.checks
    w4Drifted.value = checks?.W4?.drifted || []
  } finally {
    recLoading.value = false
  }
}

/** 对账口径（治理面板）：已上线 = status=live 的行数 / 登记总数 */
const recLiveCount = computed(() => recReport.value?.summary.byStatus?.live ?? 0)
const recTotalCount = computed(() => recReport.value?.summary.total ?? 0)

async function loadDefinitions() {
  defsLoading.value = true
  try {
    const [orchRes, agentRes] = await Promise.all([
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions(),
      adminRuntimeDefinitionsApi.getAgentDefinitions()
    ])
    const orchBody = orchRes.data?.data ?? orchRes.data ?? []
    const agentBody = agentRes.data?.data ?? agentRes.data ?? []
    const orchItems = Array.isArray(orchBody) ? orchBody : orchBody.items || orchBody.orchestrators || []
    // 后端 getAgentDefinitions 返回的是 skill 条目（含 agent 归属），计数口径为 Skill 定义数
    const skillItems = Array.isArray(agentBody) ? agentBody : agentBody.items || agentBody.agents || []
    orchCount.value = orchItems.length
    skillDefCount.value = skillItems.length
    orchDefs.value = orchItems
    definitionNotes.value = [
      ...orchItems.slice(0, 6).map((o: Record<string, unknown>) =>
        `编排 ${String(o.id || o.name || '—')} · ${String(o.title || o.label || o.description || '').slice(0, 48)}`
      ),
      ...skillItems.slice(0, 6).map((a: Record<string, unknown>) =>
        `Skill ${String(a.id || a.skillId || '—')} · ${String(a.name || a.title || '').slice(0, 40)}`
      )
    ]
    defsLoaded.value = true
  } catch (e) {
    definitionNotes.value = [`定义拉取失败：${errMsg(e)}`]
  } finally {
    defsLoading.value = false
  }
}

onMounted(() => {
  void loadDefinitions()
  void loadReconciliation()
  void loadStages()
})
// 阶段清单与运行时定义按真实源拉取（初始 onMounted 时后端可能尚未就绪，切换后重试）
watch(dataSource, () => {
  void loadStages()
  if (!defsLoaded.value) void loadDefinitions()
  if (!recReport.value) void loadReconciliation()
})

/** 状态条「刷新」：三个域（阶段清单 / 运行时定义 / 对账）全拉，避免只刷一半 */
const refreshing = computed(() => defsLoading.value || stagesLoading.value || recLoading.value)
async function refreshAll() {
  if (refreshing.value) return
  await Promise.all([loadDefinitions(), loadStages(), loadReconciliation()])
}

interface SkillNode { id: string; name: string; produces: string[] }
interface DefStep { step: number; role?: string; condition?: string; loopOver?: string; agentId?: string; resolved?: { displayName?: string; kind?: string; nodeKind?: string; unresolved?: boolean } }
interface Stage {
  id: string
  name: string
  agentId: string
  consumes: string[]
  produces: string[]
  /** 阶段级变量流总数（consumes/produces 本身最多显示前 5 项） */
  consumesTotal: number
  producesTotal: number
  skills: SkillNode[]
  defSteps?: DefStep[]
}

const active = ref('goal')
/* 阶段/子面板变化回写 ?stage=&tab=(对齐全站"切换可寻址"约定;此前只读深链,
   刷新丢失所在阶段与子面板)。overview 为缺省档,不占 URL。 */
watch([active, pane], ([s, p]) => {
  const curStage = typeof route.query.stage === 'string' ? route.query.stage : ''
  const curTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  const wantTab = p !== 'overview' ? p : ''
  if (s === curStage && curTab === wantTab) return
  const q: Record<string, string> = { ...(route.query as Record<string, string>), stage: s }
  if (wantTab) q.tab = wantTab
  void router.replace({ query: q })
})
applyStageQuery()
watch(() => route.query, applyStageQuery)
const defById = computed(() => new Map(orchDefs.value.map((d) => [d.id, d])))// 阶段清单统一后端源：GET /admin/field-routings/stages（派生自编排文件），
// 全量消费、不过滤后端结果
const stageList = ref<Array<{ id: string; displayName: string }>>([])

async function loadStages() {
  stagesLoading.value = true
  try {
    const res = await adminFieldRoutingsApi.getStages()
    const stages = res.data?.data?.stages || []
    if (stages.length) {
      stageList.value = stages
      if (!stages.some((s: { id: string }) => s.id === active.value)) {
        active.value = stages[0].id
      }
    }
  } catch {
    // 端点不可用：stageList 置空（由拓扑 Agent 节点派生，仍为真实数据）
    stageList.value = []
  } finally {
    stagesLoading.value = false
  }
}

const stages = computed<Stage[]>(() => {
  // 拓扑未就绪（为空/拉取失败）时返回空数组，渲染空态
  if (!liveTopoNodes.value.length) return []

  // 阶段清单以 GET stages（编排文件派生）为准，无白名单过滤；
  // 该端点失败时退化为拓扑 Agent 节点派生（仍为真实数据）。
  // stage → 顶层 Agent 的约定映射 <stage>-agent 与后端 STAGE_AGENT_MAP 同源
  // （每个编排文件 contracts 中 manifest kind=agent 者均为 <stage>-agent）；
  // 拓扑中查不到 Agent 的阶段仍展示（真实字段路由 tab 可用），成员列表为空。
  const list = stageList.value.length
    ? stageList.value
    : liveTopoNodes.value
        .filter((n) => n.type === 'agent')
        .map((n) => ({ id: n.id.replace(/-agent$/, ''), displayName: n.label }))
  return list.map((s) => {
    const agentId = `${s.id}-agent`
    const members = liveTopoNodes.value.filter(
      (n) => n.type === 'skill' && n.parentAgentId === agentId
    )
    // 真实变量流：来自 prompt-ops skill-catalog 的 input/output 字段
    const catalogAgent = liveSkillCatalog.value.find((a) => a.agentId === agentId)
    const catalogById = new Map((catalogAgent?.skills || []).map((c) => [c.skillId, c]))
    const skills = members.map((node) => {
      const id = node.id.replace(/^skill:/, '')
      const catalog = catalogById.get(id)
      return {
        id,
        name: node.label.replace(/ Skill$/, ''),
        produces: catalog?.outputFields || []
      }
    })
    // 阶段级变量：下辖 Skill 输入 = 消费，输出 = 产出
    const allInputs = [...new Set(skills.flatMap((skill) => catalogById.get(skill.id)?.inputFields || []))]
    const allOutputs = [...new Set(skills.flatMap((skill) => skill.produces))]
    // 定义级步骤（编排定义实时编译，含 role/condition/loopOver/resolved）
    const def = defById.value.get(agentId)
    return {
      id: s.id,
      name: s.displayName,
      agentId,
      // 截断到前 5 项，但总数随数据带出（面板/ tooltip 报「共 N 项」）
      consumes: allInputs.slice(0, 5),
      produces: allOutputs.slice(0, 5),
      consumesTotal: allInputs.length,
      producesTotal: allOutputs.length,
      skills,
      defSteps: def?.steps || []
    }
  })
})

/* ===== 总览 odg 画布（newui/admin odg-canvas）：列间贝塞尔连线 + 下一阶段入参标签 ===== */
const odgCanvasEl = ref<HTMLElement | null>(null)
const odgSvgEl = ref<SVGSVGElement | null>(null)

/* 入/出口径来自字段路由注册表（真数据源，后端词表）：
   入 = hard-required（必填，缺了本阶段无法推进；部分阶段确无必填 → 入 0 属实）；
   出 = proposal-output + public-reply + derived-presentation（方案产出/公开回复/派生展示，
   对外可见或可供下游消费的产出）。连线标签标注来源阶段的产出（沿边流动的内容）。 */
interface StageFieldContract {
  ins: string[]
  outs: string[]
  /** 字段契约是否已加载（此前加载完成前按 0 渲染：「入 0」与「真无必填」不可分辨，评审「状态三态缺失」） */
  loaded?: boolean
}
const OUT_ROLES = ['proposal-output', 'public-reply', 'derived-presentation']
const stageFieldContract = ref<Record<string, StageFieldContract>>({})
async function loadStageFieldContracts(ids: string[]) {
  const results = await Promise.allSettled(
    ids.map((id) => adminFieldRoutingsApi.getStageDetail(id)),
  )
  const map: Record<string, StageFieldContract> = {}
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const fields = (r.value.data?.data?.fields ?? []) as Array<{ promptRole?: string; camelName?: string | null; fieldId: string }>
    map[ids[i]] = {
      ins: fields.filter((f) => f.promptRole === 'hard-required').map((f) => f.camelName || f.fieldId),
      outs: fields.filter((f) => OUT_ROLES.includes(f.promptRole || '')).map((f) => f.camelName || f.fieldId),
      loaded: true,
    }
  })
  stageFieldContract.value = map
}
watch(
  stages,
  (s) => {
    if (s.length) void loadStageFieldContracts(s.map((x) => x.id))
  },
  { immediate: true },
)
function contractOf(id: string): StageFieldContract {
  return stageFieldContract.value[id] ?? { ins: [], outs: [], loaded: false }
}

/** 状态条「未解析 N」红字落地（可点）：切 journey 面板 + 定位首个含未解析步骤的阶段；
    ?stage=&tab= 回写由下方既有 watch 承接（:369-377 先例），刷新/分享可还原 */
function goUnresolved() {
  const hit = stages.value.find((s) => (s.defSteps || []).some((d) => d.resolved?.unresolved))
  if (hit) active.value = hit.id
  pane.value = 'journey'
}
/** 状态条「哈希漂移 N」红字落地（可点）：W4 coreHash 检查归属健康中心
    （本页治理面板 DriftAuditPanel 只覆盖契约漂移，hash 名单在那边） */
function goHashDrift() {
  // ?check= 定位到 w4-corehash 检查行（健康中心深链展开+滚动）
  void router.push({ path: '/admin/health-center', query: { check: 'w4-corehash' } })
}

/** 相邻阶段交接（原型 1624-1629 五列）：交接列用阶段 id（原型 s.id，本页 id 本就小写 mono）；
 *  传递字段口径 = 下游阶段的必填入参（stageFieldContract.ins，字段路由 hard-required），
 *  即原型 s.in 的真实数据对应物——本页 stages 拓扑只有 consumes/produces 汇总，无独立 in/outs。
 *  画布连线标签（layoutOrch）仍标上游产出（outs）：连线沿边流动的是上游产出，
 *  交接表登记的是下游准入契约，两处口径差是有意的 */
const stageHandoffs = computed(() => {
  const out: Array<{ from: string; to: string; fromAgent: string; toAgent: string; fields: string[] }> = []
  for (let i = 0; i < stages.value.length - 1; i++) {
    const up = stages.value[i]
    const down = stages.value[i + 1]
    out.push({
      from: up.id,
      to: down.id,
      fromAgent: up.agentId,
      toAgent: down.agentId,
      fields: contractOf(down.id).ins,
    })
  }
  return out
})

/** 状态条「N 处阶段交接」：拓扑为线性列时 = 阶段数 - 1（原型 statusbar meta 口径） */
const handoffCount = computed(() => Math.max(stages.value.length - 1, 0))

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] ?? ch)
}

/** 画布重算：列位置量出后画三次贝塞尔（箭头 + 下一阶段入参字段标签，白衬底防穿字） */
function layoutOrch() {
  const svg = odgSvgEl.value
  const canvas = odgCanvasEl.value
  if (!svg || !canvas) return
  const cols = Array.from(canvas.querySelectorAll<HTMLElement>('.orch-odg-col'))
  if (cols.length < 2) return
  const W = canvas.scrollWidth
  const H = canvas.scrollHeight
  svg.setAttribute('width', String(W))
  svg.setAttribute('height', String(H))
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  let out = '<defs><marker id="orchOdgArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z"/></marker></defs>'
  for (let i = 0; i < cols.length - 1; i++) {
    const a = cols[i]
    const b = cols[i + 1]
    const x1 = a.offsetLeft + a.offsetWidth + 2
    const y1 = a.offsetTop + Math.round(a.offsetHeight / 2)
    const x2 = b.offsetLeft - 6
    const y2 = b.offsetTop + Math.round(b.offsetHeight / 2)
    const dx = Math.max(26, Math.round((x2 - x1) / 2))
    out += `<path class="orch-odg-edge" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}" marker-end="url(#orchOdgArrow)"/>`
    const fields = contractOf(stages.value[i].id).outs.slice(0, 6)
    const midx = Math.round((x1 + x2) / 2)
    const lineH = 13
    const startY = Math.round((y1 + y2) / 2 - ((fields.length - 1) * lineH) / 2)
    out += `<text class="orch-odg-edge-label">${fields
      .map((f, k) => `<tspan x="${midx}" y="${startY + k * lineH}">${escapeXml(f)}</tspan>`)
      .join('')}</text>`
  }
  svg.innerHTML = out
}

/** 总览 odg 节点点击：进该 Skill 详情二级页（原型 odg-node data-action="open-skill" → go("skill")；
    节点携带真实 skill id（拓扑 skill: 前缀已剥），与 Skills API / 抽屉同一定位参数） */
function openSkillFromOverview(id: string) {
  openSubPage('skill', id)
}

let odgRaf = 0
function onOdgResize() {
  cancelAnimationFrame(odgRaf)
  odgRaf = requestAnimationFrame(layoutOrch)
}
onMounted(() => {
  window.addEventListener('resize', onOdgResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onOdgResize)
  cancelAnimationFrame(odgRaf)
})
watch([pane, stages, flowKey], async () => {
  if (pane.value !== 'overview') return
  await nextTick()
  layoutOrch()
})

const totalSkills = computed(() => stages.value.reduce((sum, stage) => sum + stage.skills.length, 0))
const unresolvedCount = computed(() =>
  stages.value.reduce(
    (sum, st) => sum + (st.defSteps || []).filter((d) => d.resolved?.unresolved).length,
    0
  )
)
// 空拓扑时 current 为 undefined，模板由 v-if="current" 保护
const current = computed<Stage | undefined>(() => stages.value.find((s) => s.id === active.value) || stages.value[0])
// 首屏加载中（live boot 未完成且尚无阶段数据）：用于抑制「0 阶段 / 暂无数据」的假空态
const pageLoading = computed(() => liveLoading.value && !stages.value.length)
// 概览卡结论点色/标题（唯一动态状态载体；状态条只剩身份 + 数量）
const statusTone = computed(() => {
  if (!stages.value.length) return 'muted'
  // P1#27：哈希漂移计入状态点（此前正文红字「哈希漂移 N」、状态点仍绿——告警语义自相矛盾）
  if (w4Drifted.value.length) return 'bad'
  const unresolved = stages.value.some((s) => s.defSteps?.some((d) => d.resolved?.unresolved))
  return unresolved ? 'warn' : 'ok'
})

/* ================= 失败态：接口失败 ≠ 没有数据 =================
   阶段清单依赖 live boot 的 topology 域（liveFailures.topology）。
   该域失败时 liveTopoNodes 为空 → stages 为空，此前与「后端本就没数据」
   同落「暂无编排阶段数据」，把接口失败伪装成空态；这里区分并给重试。 */
const topoFailure = computed(() => liveFailures.value.topology || '')

async function retryStages() {
  await Promise.all([
    loadStages(),
    reloadLiveTopology()
      .then(() => { delete liveFailures.value.topology })
      // 仍失败：保留 liveFailures.topology，错误态继续给原因 + 可再次重试
      .catch(() => undefined)
  ])
}

/** 阶段 tab tooltip：skills=0 时说明去向（此前 tab 只显示「0 Skill」，无从判断是真空还是没拉到） */
function stageTabTitle(s: Stage): string {
  if (!s.skills.length) return '该阶段下辖 0 个 Skill：可能调度树未登记，或拓扑 / 目录尚未拉取成功'
  return `${s.name}：${s.skills.length} 个 Skill`
}

/** 字段路由卡头 tooltip：阶段级变量流总量（截断前口径） */
function ioContractTitle(s: Stage): string {
  return `阶段级变量流来自下辖 Skill 的输入/输出字段（去重）；输入、输出各最多显示前 5 项，共 ${s.consumesTotal} 输入 / ${s.producesTotal} 输出`
}

/** 治理卡头 tooltip：定义与对账口径说明 */
const govMetaTitle = computed(() =>
  [
    '运行时定义：GET /admin/runtime-definitions（orchestrator / agent 两类）',
    recReport.value ? `对账：已上线 ${recLiveCount.value} / 登记 ${recTotalCount.value}（口径含外挂能力）` : '对账报告不可用'
  ].join('；')
)
</script><style scoped>
/* 治理面板：运行时定义明细（definitionNotes，micro 列表，不抢漂移报告的视觉重心） */
.orch-gov-defs {
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 3px;
}
.orch-gov-defs__item {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 阶段导航：五个 tab = 五个阶段（大分段卡，每卡含阶段名 + Skill/调用概要） */
/* 子面板页签（原型 .tabs 下划线页签，页面本地复刻；写法与 Users.vue 卡内页签同款） */
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--mk-line); }
.tab {
  border: 0;
  background: transparent;
  color: var(--mk-muted);
  padding: 9px 12px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: var(--mk-fs-micro);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color 0.14s ease, border-color 0.14s ease;
}
.tab:hover { color: var(--mk-ink); }
.tab[aria-selected='true'] { color: var(--mk-blue); border-bottom-color: var(--mk-blue); }
.orch-pane-tabs { margin-bottom: 2px; }
/* ===== 阶段工作区（fill 布局：占满剩余视高，底部不再留空白；面板各自内滚，页面不滚） ===== */
.orch-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.orch-pane--scroll { overflow-y: auto; }
.orch-pane--center { justify-content: center; }
/* 总览双卡（原型：odg 画布卡 + margin-top 的交接明细卡）：画布卡弹性填满、交接卡自然高度贴底 */
.orch-overview { gap: 12px; }
/* 阶段交接明细（原型 .tbl 的 mono/sub/wrap 形态）：交接列 id 对弱化 mono；传递字段可换行 */
.orch-handoff__pair { color: var(--mk-muted); white-space: nowrap; }
/* 传递字段 = 逐枚徽章（mk-badge--sm），格内 flex 换行；不再用点号长串（独吞 65% 列宽） */
.orch-handoff__fields { white-space: normal; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
/* 字段路由：卡头 + 工具条吸顶，仅表格区内滚（.frt__scroll 自带 .mk-table-scroll 横向滚动） */
.orch-routing .frt { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.orch-routing .frt__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* fill 布局下阶段导航的外边距由页面 gap（12px）接管 */
.mk-page--fill .orch-stage-tabs { margin: 0; }

.orch-stage-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
  margin: 10px 0 12px;
}
.orch-stage-tab {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 9px 14px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl);
  background: var(--mk-surface); font: inherit; text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
.orch-stage-tab:hover { border-color: color-mix(in srgb, var(--mk-blue) 45%, var(--mk-line)); }
.orch-stage-tab.is-active {
  border-color: var(--mk-blue);
  background: color-mix(in srgb, var(--mk-blue) 8%, transparent);
  box-shadow: inset 0 0 0 1px var(--mk-blue);
}
.orch-stage-tab__name { font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink); }
.orch-stage-tab.is-active .orch-stage-tab__name { color: var(--mk-blue); }
.orch-stage-tab__meta { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-faint); font-variant-numeric: tabular-nums; }

/* 折叠层（字段路由 / 治理）：阶段工作区的查阅层，默认收起 */
/* 折叠头走 .mk-section__summary（shared.css） */

/* 沙盘（深链次要入口）顶部条 */

/* 4K：阶段导航与折叠层跟随全站节奏 */
@media (min-width: 2000px) {
  .orch-stage-tab { padding: 11px 16px; }
  .orch-stage-tab__name { font-size: var(--mk-fs-body); }
  .orch-stage-tab__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .orch-stage-tab { padding: 13px 19px; }
  .orch-stage-tab__name { font-size: var(--mk-fs-body); }
  .orch-stage-tab__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .orch-stage-tab { padding: 15px 22px; }
  .orch-stage-tab__name { font-size: var(--mk-fs-emphasis); }
  .orch-stage-tab__meta { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：编排图 ================= */
html[data-theme='dark'] {

  /* 阶段 tab 大分段卡 */
  .orch-stage-tab { background: #19191a; border-color: var(--wf-border-light); }
  .orch-stage-tab:hover { border-color: color-mix(in srgb, var(--mk-blue) 45%, #313235); }
  .orch-stage-tab.is-active {
    background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent);
    border-color: var(--mk-blue);
    
  }

  /* 折叠层（字段路由 / 治理） */
  /* 折叠头基调由 .mk-section__summary--muted / :hover 提供（原 #afb1b6 即 --mk-muted 暗色值） */

  /* 沙盘顶部条返回按钮 */
}
</style>
<style>
/* ===== 总览 odg 画布（newui/admin odg-canvas）：连线和字段标签由 layoutOrch 以
   innerHTML 注入，不带 scoped 属性，因此样式放在非 scoped 块并统一 .orch-odg 前缀命名空间 ===== */
/* 交接明细拆出独立卡后，画布滚动区接管画布卡的剩余高度（否则卡底留白） */
.orch-odg-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 12px 16px; }
.orch-odg-canvas { position: relative; display: flex; align-items: flex-start; gap: 120px; min-width: max-content; }
.orch-odg-svg { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
.orch-odg-edge { fill: none; stroke: var(--mk-blue, #2f6ae0); stroke-width: 1.6; opacity: 0.85; }
.orch-odg-svg marker path { fill: var(--mk-blue, #2f6ae0); }
.orch-odg-edge-label {
  fill: var(--mk-muted, #5b6577);
  font-family: var(--mk-mono, Consolas, monospace);
  font-size: var(--mk-fs-micro, 12px);
  text-anchor: middle;
  paint-order: stroke;
  stroke: var(--mk-surface, #fff);
  stroke-width: 3px;
  stroke-linejoin: round;
}
.orch-odg-col { flex: 0 0 232px; display: flex; flex-direction: column; gap: 8px; }
.orch-odg-colhead {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border: 1px solid var(--mk-line, #e6ebf4); border-radius: var(--mk-radius-lg, 10px);
  background: var(--mk-surface-2, #eef2fa);
}
.orch-odg-no {
  width: 20px; height: 20px; flex: none; display: grid; place-items: center;
  border-radius: var(--mk-radius-sm, 6px);
  background: color-mix(in srgb, var(--mk-blue, #2f6ae0) 10%, transparent);
  color: var(--mk-accent-deep, #1f57cc);
  font-size: var(--mk-fs-micro, 12px); font-weight: 700;
}
.orch-odg-colname { font-weight: 700; font-size: var(--mk-fs-micro, 12px); color: var(--mk-ink); }
.orch-odg-agent { margin-left: auto; font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint); }
.orch-odg-body { display: flex; flex-direction: column; gap: 6px; }
.orch-odg-node {
  display: grid; gap: 1px; width: 100%; padding: 8px 10px; text-align: left;
  border: 1px solid var(--mk-line, #e6ebf4); border-radius: var(--mk-radius-lg, 10px);
  background: var(--mk-surface, #fff); cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.orch-odg-node:hover { border-color: var(--mk-blue, #2f6ae0); box-shadow: var(--mk-shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.1)); }
.orch-odg-idx { font-family: var(--mk-mono, Consolas, monospace); font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint); }
.orch-odg-nodename { font-size: var(--mk-fs-13, 13px); font-weight: 600; color: var(--mk-ink); }
.orch-odg-nodemeta { font-family: var(--mk-mono, Consolas, monospace); font-size: var(--mk-fs-micro, 12px); color: var(--mk-muted); }
.orch-odg-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-top: 2px; }
.orch-odg-chip {
  font-size: var(--mk-fs-micro, 12px); padding: 1px 6px;
  border-radius: var(--mk-radius-sm, 6px);
  background: var(--mk-surface-2, #eef2fa); color: var(--mk-muted); white-space: nowrap;
}
.orch-odg-chip--in { background: color-mix(in srgb, var(--mk-blue, #2f6ae0) 10%, transparent); color: var(--mk-accent-deep, #1f57cc); }
.orch-odg-chip--out { background: color-mix(in srgb, var(--mk-green, #15803d) 12%, transparent); color: var(--mk-accent-deep, #1f57cc); }
.orch-odg-fields {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--mk-mono, Consolas, monospace);
  font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint);
}
</style>

