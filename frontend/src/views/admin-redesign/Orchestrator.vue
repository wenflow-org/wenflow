<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名与侧栏条目一致（2026-10-26 走查：侧栏已改
         「字段流转」——看的是字段在 Skill 间怎么流，不是一张拓扑图；页头却还叫「编排图」）。
         2026-10-04 状态条退役，读数迁页首 KPI 带；2026-10-12 按用户走查再收一层：
         三张纯读数卡撤（阶段/Skill 进总览卡头 meta），无警时页头直接接页签（详见下方告警条注释） -->
    <MkPageHead title="字段流转" />
    <!-- 页头刷新已撤（2026-10-16 用户走查「这个刷新是不是重了，有一个固定的刷新了」）：
         本页原先另有一颗页头「刷新」，实测与顶栏固定刷新各打一半数据——页头打运行时定义/
         阶段清单/对账，顶栏打拓扑/目录/其余全域，用户按任一颗都会以为整页刷了。
         现全站统一由顶栏那一颗（loadLiveData(true)）驱动：本页自有域 watch(liveRefreshSeq)
         重跑（见下方 watch），不再有第二颗语义重叠的刷新钮。 -->

    <!-- 页级告警已撤（2026-10-12 用户拍板「这个应该放到健康中心」）：拓扑完整性的页级信号
         （未解析步骤 / W4 哈希漂移）统一归健康中心检查项（orchestration-steps / w4-corehash，
         本页删去告警条后不再有 KPI 或告警条；健康中心那两项可深链回本页「字段旅程」）。
         行级证据（交接明细表的「未解析 N / 哈希漂移 N」徽章）2026-10-13 随该表整体删除——
         该表与「字段旅程」页签同源重复，且两处字段数互相打架（7 vs 25）；治理信号现只在健康中心。
         原告警条的实现历史：2026-10-04 状态条退役 → 页首 KPI 带（阶段/Skill/交接 + 两枚红卡）
         → 2026-10-12 三张纯读数卡撤、红卡改行式告警条 → 同日告警整体迁健康中心。 -->

    <!-- 一级页签（2026-10-13 用户拍板）：总览 + 五个阶段。
         阶段此前是与页签并排的**第二条**控制条（「阶段选择」胶囊行），一屏两套导航重复；
         现合成一条：阶段升为一级页签，点开即该阶段的「字段旅程」内容，
         「字段路由 / 治理」降为该阶段内的二级页签（见下方 orch-stage-view）。
         键盘契约（审核 #97）：role=tablist/tab 兑现 roving tabindex + 左右方向键循环切换。 -->
    <div class="tabs orch-top-tabs" role="tablist" aria-label="字段流转视图" @keydown="onTopTabKeydown">
      <button
        id="orch-tab-overview"
        type="button" role="tab" class="tab"
        :aria-selected="pane === 'overview'"
        aria-controls="orch-pane-overview"
        :tabindex="pane === 'overview' ? 0 : -1"
        @click="goOverview"
      >总览</button>
      <button
        v-for="s in stages"
        :key="s.id"
        :id="`orch-tab-${s.id}`"
        type="button" role="tab" class="tab"
        :aria-selected="pane !== 'overview' && active === s.id"
        aria-controls="orch-stage-view"
        :tabindex="pane !== 'overview' && active === s.id ? 0 : -1"
        :title="stageTabTitle(s)"
        @click="selectStageTab(s.id)"
      >{{ stageTabLabel(s) }}<span class="tab__count">{{ s.skills.length }}</span></button>
    </div>

    <!-- ===== 总览：全旅程 odg 画布（newui/admin odg-canvas 形态）=====
         五阶段并列列（阶段头 + Skill 节点 + 入/出参 chip + 产出字段），
         列间 SVG 三次贝塞尔连线（仅箭头：字段明细由列脚 outs 行 +
         「字段旅程」页签两处承载，边标签曾以 6 行字段名画在 120px 间隙里压住
         相邻列节点文字——实测四条边全相交，2026-10-04 撤），layoutOrch 在
         渲染/窗口 resize 时重算；点 Skill 节点进入该技能详情二级页（原型 open-skill）。 -->
    <div v-if="stages.length" v-show="pane === 'overview'" id="orch-pane-overview" role="tabpanel" aria-labelledby="orch-tab-overview" class="orch-pane orch-overview">
      <section class="mk-card mk-card--fill orch-odg-page">
      <div class="mk-card__head">
        <!-- 卡题 2026-10-05 改名：原「字段数据旅程」与「字段旅程」页签撞车（两处都自称旅程）——
             本卡是五阶段全貌，归属「总览」；单阶段旅程图归「字段旅程」页签 -->
        <h3 class="mk-card__title">管线总览</h3>
        <!-- 2026-10-12：原页首「阶段 / Skill」两张读数卡收进卡头右组（列表卡头统一语法：
             计数 meta 归 head-right）——单行不占画布高度。阶段数画布五列可见这里点明（窄屏
             画布横向滚动时兜底）；Skill 总数是本页唯一非显然读数，title 保留 F8-4 三源口径 -->
        <div class="mk-card__head-right">
          <span v-if="stages.length" class="mk-card__meta" :title="skillKpiTitle">{{ stages.length }} 阶段 · {{ totalSkills }} 个 Skill</span>
          <button
            v-if="contractFailed"
            type="button"
            class="mk-btn mk-btn--sm"
            @click="retryStageContracts"
          >字段契约重试</button>
          <!-- 画布缩放（2026-10-13 用户：居中 / 可拖动 / 可放大）：**滚轮直接缩放**，连续无档位
               （触控板双指捏合走同一条，浏览器把它合成 ctrlKey 的 wheel）；指针处为锚点。
               这里只留一枚读数 —— 当前比例，点它回到 100%（默认态 = 撑满可视宽） -->
          <button type="button" class="mk-btn mk-btn--sm orch-odg-zoom__val" @click="odgZoom = 1">{{ Math.round(odgZoom * 100) }}%</button>
        </div>
      </div>
      <div
        ref="odgScrollEl"
        class="orch-odg-scroll"
        :class="{ 'is-panning': odgPanning }"
        @pointerdown="onOdgPointerDown"
        @pointermove="onOdgPointerMove"
        @pointerup="onOdgPointerUp"
        @pointercancel="onOdgPointerUp"
        @click.capture="onOdgClickCapture"
        @wheel.prevent="onOdgWheelZoom"
      >
        <div ref="odgCanvasEl" class="orch-odg-canvas" :style="odgCanvasStyle">
          <svg ref="odgSvgEl" class="orch-odg-svg" aria-hidden="true" />
          <div v-for="(s, i) in stages" :key="s.id" class="orch-odg-col">
            <header class="orch-odg-colhead">
              <span class="orch-odg-no">{{ i + 1 }}</span>
              <span class="orch-odg-colname" :title="s.name">{{ s.name }}</span>
              <span class="orch-odg-agent mono" :title="s.agentId">{{ s.agentId }}</span>
            </header>
            <div class="orch-odg-body">
              <button
                v-for="(sk, j) in s.skills"
                :key="sk.id"
                type="button"
                class="orch-odg-node"
                :title="skillNodeTitle(sk, s)"
                @click="openSkillFromOverview(sk.id)"
              >
                <span class="orch-odg-idx mono">{{ i + 1 }}.{{ j + 1 }}</span>
                <span class="orch-odg-nodename">{{ sk.name }}</span>
                <!-- Skill 名称（id）：中文是平台显示名，运营要拿它去对 Skill 目录 / 执行日志，
                     少了对不上号（2026-10-13 用户：现在用的还是中文，希望加上 skill 名称） -->
                <span class="orch-odg-slug mono">{{ sk.id }}</span>
              </button>
            </div>
            <footer class="orch-odg-foot">
              <!-- 字段契约三态：未加载显「…」（不按 0 渲染——加载完成前「入 0」与「真无必填」不可分辨；
                   部分阶段确无必填入参，加载后「入 0」属实）。
                   2026-10-24：计数单独一行，字段名另占一行并允许两行——不再用 nowrap+ellipsis
                   把唯一字段信息裁成一条。 -->
              <div class="orch-odg-counts">
                <span
                  v-for="kind in (['in', 'out'] as const)"
                  :key="kind"
                  class="orch-odg-chip"
                  :class="contractOf(s.id).failed ? 'orch-odg-chip--failed' : `orch-odg-chip--${kind}`"
                  :title="contractChipTitle(s.id, kind)"
                >{{ kind === 'in' ? '入' : '出' }} {{ contractCountText(s.id, kind) }}</span>
              </div>
              <span class="orch-odg-fields" :title="contractOf(s.id).outs.join(' · ')">{{ contractOf(s.id).outs.slice(0, 4).join(' · ') }}<template v-if="contractOf(s.id).outs.length > 4">…</template></span>
            </footer>
          </div>
        </div>
      </div>

      </section>
    </div>

    <!-- 阶段工作区：占满剩余视高（fill 布局，底部不再有空白）。
         旅程图 = 卡内画布滚动（工具条/旅程条吸顶）；路由/治理 = 面板内滚；页面本身不滚。

         2026-10-13 页签保活（修「切页签重复请求」）：原先四页签是 v-else-if 互斥，
         每次切回都重新挂载 → 旅程 7 个请求 / 路由 2 个 / 治理 2 个各发一遍（实测）。
         现改「首访挂载 + v-show 切换」：visited 里的页签挂载后常驻，切回零请求；
         未访问过的页签仍不挂载（不在首屏白拉数据）。阶段切换仍按原契约重取
         （DataFlowGraph 的 :key 与 FieldRoutingTable/DriftAuditPanel 的 watch(stage)）。 -->
    <div v-if="pane !== 'overview'" id="orch-stage-view" role="tabpanel" :aria-labelledby="`orch-tab-${active}`" class="orch-stage-view">
    <!-- 二级页签（阶段内）：字段旅程 / 字段路由 / 治理 三枚并列，
         阶段页签点开默认落字段旅程。右端「编排文件」是字段路由的唯一声明源入口。 -->
    <div class="orch-subtabs-row">
      <div class="tabs orch-subtabs" role="tablist" aria-label="阶段视图" @keydown="onSubTabKeydown">
        <button
          v-for="sp in SUB_PANES"
          :key="sp.id"
          :id="`orch-tab-${sp.id}`"
          type="button" role="tab" class="tab"
          :aria-selected="pane === sp.id"
          :aria-controls="`orch-pane-${sp.id}`"
          :tabindex="pane === sp.id ? 0 : -1"
          @click="pane = sp.id"
        >{{ sp.label }}</button>
      </div>
      <button
        v-if="current"
        type="button"
        class="mk-btn mk-btn--sm orch-subtabs__action"
        @click="openOrchestrationFile"
      >编排文件</button>
    </div>
    <DataFlowGraph
      v-if="current && visitedPanes.has('journey')"
      v-show="pane === 'journey'"
      id="orch-pane-journey"
      role="tabpanel"
      aria-label="字段旅程"
      class="orch-pane orch-pane--journey"
      :key="`${active}-${flowKey}`"
      :stage="active"
      @changed="onRoutingChanged"
      @stage="onStageChange"
    />
    <section v-if="current && visitedPanes.has('routing')" v-show="pane === 'routing'" id="orch-pane-routing" role="tabpanel" aria-labelledby="orch-tab-routing" class="mk-card mk-card--fill orch-pane orch-routing">
      <div class="mk-card__head">
        <h3 class="mk-card__title">字段路由</h3>
        <!-- meta 换同源口径（2026-10-05 页签重设计）：原「输入 0/0 · 输出 0/0」来自
             liveSkillCatalog 的阶段级变量流——catalog 对多数阶段为空，出假零，与表内
             25 行字段同页打架。改用字段契约 stageFieldContract（与画布 chips
             同源同数）：必填入参 = hard-required，产出 = 三产出角色；未加载显「…」 -->
        <span class="mk-card__meta">
          <!-- 未加载显「…」（与画布 chips 同一三态约定；规则 5 禁内联「加载中」文案） -->
          <template v-if="contractOf(active).failed">字段契约未加载</template>
          <template v-else-if="!contractOf(active).loaded">…</template>
          <template v-else>必填入参 {{ contractOf(active).ins.length }} · 产出 {{ contractOf(active).outs.length }}</template>
        </span>
      </div>
      <FieldRoutingTable ref="routingRef" :stage="active" @changed="onRoutingChanged" />
    </section>
    <section v-if="current && visitedPanes.has('governance')" v-show="pane === 'governance'" id="orch-pane-governance" role="tabpanel" aria-labelledby="orch-tab-governance" class="mk-card mk-card--fill orch-pane orch-pane--scroll">
      <div class="mk-card__head">
        <h3 class="mk-card__title">治理：{{ TERMS.driftContract }}报告 + 变更审计</h3>
        <!-- 口径摆面上（2026-10-05）：原「对账已上线 37/37」与「Skill 定义 32」表面打架——
             37 含插件（skill-catalog 口径）、32 是运行时 Skill 定义数，两数不同源不冲突，
             但必须自解释才不像「数字对不上」 -->
        <span class="mk-card__meta" :title="govMetaTitle">
          编排定义 {{ orchCount }} · Skill 定义 {{ skillDefCount }}
        </span>
      </div>
      <!-- 定义明细（definitionNotes 调试转储）2026-10-05 撤：Skill 行名称字段全空
           （API 无 name/title 字段）、编排行与总览/字段路由信息重复，且双定义接口
           为此白拉——治理回归三折叠本体（新建字段/漂移报告/最近变更） -->
      <DriftAuditPanel :stage="active" @open-orchestration="fixDriftFromGovernance" />
    </section>
    </div><!-- /orch-stage-view -->

    <!-- 无阶段数据兜底：id/aria-label 随当前 pane 动态给出，保证各页签的
         aria-controls 在此状态下仍指向真实面板（与上面各页签互斥：stages 为空才渲染）。
         2026-10-13 两级页签改造后「字段旅程」不再有自己的 tab 元素，故这里由 aria-labelledby
         改为 aria-label（不再是「指向某枚页签」，而是面板自报其名） -->
    <div v-if="!stages.length" :id="`orch-pane-${pane}`" role="tabpanel" :aria-label="paneLabel" class="orch-pane orch-pane--center">
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
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dataSource, openSubPage } from './store'
import { liveTopoNodes, liveSkillCatalog, liveLoading, liveFailures, reloadLiveTopology, liveRefreshSeq, errMsg } from './live'
import { TERMS } from './terms'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi, adminSkillsApi, type SkillReconciliationReport } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import DataFlowGraph from './DataFlowGraph.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import { onTabRowKeydown } from '@/utils/rovingTablist'

/** 阶段工作区子面板：总览（五阶段全貌，缺省）+ 阶段内三枚子视图（字段旅程 / 字段路由 / 治理）。
     沙盘契约 2026-10-05 下线（内容被 总览列脚 + 字段旅程 + 字段路由 三处覆盖，
     自我定位即「深链次要入口」）；旧深链 ?tab=sandbox 落总览。
     2026-10-13 两级页签改造（用户拍板）：阶段升为一级页签、点开即该阶段的「字段旅程」；
     2026-10-26 字段旅程补回自己的页签：此前只能靠「再点一次当前阶段页签」回程，
     进了路由/治理后页签行两枚都不是选中态，使用者会以为卡住。 */
type OrchSubPane = 'journey' | 'routing' | 'governance'
type OrchPane = 'overview' | OrchSubPane
const SUB_PANES: Array<{ id: OrchSubPane; label: string }> = [
  { id: 'journey', label: '字段旅程' },
  { id: 'routing', label: '字段路由' },
  { id: 'governance', label: '治理' },
]
const pane = ref<OrchPane>('overview')
/** 当前 pane 的可读名（无阶段数据兜底面板的 aria-label 用） */
const paneLabel = computed(() => {
  if (pane.value === 'overview') return '总览'
  return SUB_PANES.find((p) => p.id === pane.value)?.label ?? ''
})
/* 页签键盘契约（审核 #97）：roving tabindex（仅选中项可 Tab 进入）+ 左右方向键循环切换并移动焦点，
   兑现 role=tablist/role=tab 的 ARIA tabs 语义。实现已抽到 @/utils/rovingTablist，
   一级（总览+阶段）、二级（阶段内子视图）与其它页面的页签行共用同一份。 */
function onTopTabKeydown(e: KeyboardEvent) {
  onTabRowKeydown(e, (i) => {
    if (i === 0) goOverview()
    else {
      const s = stages.value[i - 1]
      if (s) selectStageTab(s.id)
    }
  })
}
function onSubTabKeydown(e: KeyboardEvent) {
  onTabRowKeydown(e, (i) => {
    const sp = SUB_PANES[i]
    if (sp) pane.value = sp.id
  })
}
function goOverview() {
  pane.value = 'overview'
}
/** 阶段页签：切过去并落在该阶段默认视图（字段旅程）。 */
function selectStageTab(id: string) {
  active.value = id
  pane.value = 'journey'
  flowKey.value++
}

/** 已访问过的页签（2026-10-13 保活）：首访才挂载，之后 v-show 常驻——切回不重取数据。
    未访问的页签不挂载，避免首屏把三个面板的数据一起白拉。 */
const visitedPanes = ref<Set<OrchPane>>(new Set<OrchPane>(['overview']))
watch(pane, (p) => {
  if (visitedPanes.value.has(p)) return
  visitedPanes.value = new Set<OrchPane>([...visitedPanes.value, p])
}, { immediate: true })

/** 字段流转图数据版本：行级编辑/字段路由变更后 +1 触发重挂载刷新 */
const flowKey = ref(0)
function onRoutingChanged() {
  flowKey.value++
}
/** 字段路由面板的编排文件弹窗宿主：入口在阶段页签行，弹窗仍由面板持有（数据与保存动作都在那边） */
const routingRef = ref<{ openOrchestration: () => void } | null>(null)
function openOrchestrationFile() {
  if (!visitedPanes.value.has('routing')) {
    visitedPanes.value = new Set<OrchPane>([...visitedPanes.value, 'routing'])
  }
  void nextTick(() => routingRef.value?.openOrchestration())
}
/** 治理里看到不一致 → 落到字段路由并直接开编排文件（修复入口与证据同屏） */
function fixDriftFromGovernance() {
  pane.value = 'routing'
  openOrchestrationFile()
}
/** 图内锚点跳转切阶段：同步 active（tab 高亮跟随） */
function onStageChange(s: string) {
  active.value = s
}

const route = useRoute()
const router = useRouter()

/** ?stage=&tab= 直达（Skill 设计页字段路由 tab → 编排图页跳转闭环；旧 /admin/topology 重定向落位阶段视图）。
    审核 #118：无法识别的 ?tab= 值此前静默回落总览且不回写 URL——URL 声称的面板 ≠ 渲染的面板
    （如 ?tab=flow 实际渲染总览），量测/分享链接都会对不上；现与 ?stage= 的校正同纪律：
    未知 tab 不留脏参数，清掉 tab 并按真实面板回写 URL。 */
function applyStageQuery() {
  const qStage = typeof route.query.stage === 'string' && route.query.stage.trim() ? route.query.stage.trim() : ''
  const qTab = typeof route.query.tab === 'string' ? route.query.tab.trim() : ''
  if (qStage) active.value = qStage
  // ?tab= 语义:overview(缺省)/journey/routing/governance;legacy:drift→治理,topology→旅程,
  // field-routings→字段路由（SkillFieldRouting 的「→ 编排图页」用这个值）,
  // sandbox→总览（2026-10-05 沙盘契约下线,内容已被 总览/字段旅程/字段路由 覆盖）
  const knownTab = qTab === '' || qTab === 'routing' || qTab === 'governance' || qTab === 'drift' || qTab === 'journey' || qTab === 'topology' || qTab === 'field-routings'
  if (qTab === 'routing' || qTab === 'field-routings') pane.value = 'routing'
  else if (qTab === 'governance' || qTab === 'drift') pane.value = 'governance'
  else if (qTab === 'journey' || qTab === 'topology') pane.value = 'journey'
  else pane.value = 'overview'
  if (!knownTab) {
    const q: Record<string, string> = { ...(route.query as Record<string, string>) }
    delete q.tab
    q.stage = active.value
    void router.replace({ query: q })
  }
}



const defsLoading = ref(false)
const defsLoaded = ref(false)
/** 阶段清单端点拉取中（与 defsLoading / recLoading 共同驱动页头「刷新」忙碌态） */
const stagesLoading = ref(false)
const orchCount = ref(0)
const skillDefCount = ref(0)
const orchDefs = ref<Array<Record<string, any>>>([])

/* ================= 完成度对账（reconciliation，live-only） =================
   注：原 /readiness W4 拉取随「阶段交接明细」的哈希漂移徽章一并删除（2026-10-13）——
   该请求此前只为那一列徽章供数。W4 coreHash 名单与检查项仍在健康中心 w4-corehash。 */
const recReport = ref<SkillReconciliationReport | null>(null)
/** 对账拉取中（供「刷新」按钮统一忙碌态） */
const recLoading = ref(false)

async function loadReconciliation() {
  recLoading.value = true
  try {
    const rec = await adminSkillsApi.getReconciliation().catch(() => null)
    recReport.value = rec?.data?.data ?? null
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
    defsLoaded.value = true
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

/* 顶栏固定「刷新」驱动本页自有域（2026-10-16）：这三个域不在 boot 域内，原先靠本页
   页头的第二颗刷新钮重拉；现在页头钮已撤，改为 watch 顶栏刷新广播（liveRefreshSeq 在
   loadLiveData(true) 里自增）。拓扑/目录本就是 boot 域，顶栏那次已一并刷新。 */
watch(liveRefreshSeq, () => {
  void Promise.all([loadDefinitions(), loadStages(), loadReconciliation()])
})

interface SkillNode { id: string; name: string; produces: string[] }
interface DefStep { step: number; role?: string; condition?: string; loopOver?: string; agentId?: string; resolved?: { displayName?: string; kind?: string; nodeKind?: string; unresolved?: boolean } }
interface Stage {
  id: string
  name: string
  agentId: string
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
  else delete q.tab // 审核 #118：overview 为缺省档不占 URL——切回总览时清掉旧 tab，不留脏参数
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
    // 定义级步骤（编排定义实时编译，含 role/condition/loopOver/resolved）
    const def = defById.value.get(agentId)
    return {
      id: s.id,
      name: s.displayName,
      agentId,
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
   对外可见或可供下游消费的产出，展示在列脚 outs 行）。 */
interface StageFieldContract {
  ins: string[]
  outs: string[]
  /** 字段契约是否已加载（此前加载完成前按 0 渲染：「入 0」与「真无必填」不可分辨，评审「状态三态缺失」） */
  loaded?: boolean
  /** 该阶段契约拉取失败的原因（失败与「加载中」必须可分辨） */
  failed?: string
}
const OUT_ROLES = ['proposal-output', 'public-reply', 'derived-presentation']
const stageFieldContract = ref<Record<string, StageFieldContract>>({})
/** 字段契约整体失败（任一阶段失败即给卡头「字段契约重试」） */
const contractFailed = computed(() => Object.values(stageFieldContract.value).some((c) => c.failed))
/** promptRole 人话（后端 yaml-vocabulary 单源下发；前端不写第二份）——悬停时把「入/出」的
    口径连同「缺了会怎样 / 由谁派生」一起摆出来，让数字自带解释（2026-10-14 用户：悬停信息兼顾业务与技术查验） */
const roleMetaById = ref<Record<string, { label: string; hint: string }>>({})
/** hard-required 的判定口径 = 阶段自身字段定义里 promptRole 为 hard-required 的条数；
    教学/画像/仿真三阶段入参被归为隐式推断，故「入 0」属实而非未加载（详见卡头注释） */
function contractTitle(kind: 'in' | 'out', n: number): string {
  if (kind === 'in') {
    const m = roleMetaById.value['hard-required']
    return `必填入参 ${n} 个${m ? ` · ${m.label}：${m.hint}` : ''}`
  }
  const roles = OUT_ROLES.map((r) => roleMetaById.value[r]?.label || r).join(' / ')
  return `产出字段 ${n} 个 · 统计含：${roles}`
}
/** 在途去重（按键签名）：顶栏刷新同时改动 topology（boot 域）与 stageList（本页域），
    两次都会让 `stages` 重算、各触发一次本函数——同一批 id 的重复拉取并成一笔；
    签名不同（真的换了阶段集）时照常再拉 */
let stageContractInflight: { key: string; p: Promise<void> } | null = null
async function loadStageFieldContracts(ids: string[]) {
  const key = ids.join('|')
  if (stageContractInflight) {
    if (stageContractInflight.key === key) { await stageContractInflight.p; return }
    await stageContractInflight.p
  }
  const p = (async () => {
    const results = await Promise.allSettled(
      ids.map((id) => adminFieldRoutingsApi.getStageDetail(id)),
    )
    const map: Record<string, StageFieldContract> = {}
    let meta: Array<{ id: string; label: string; hint: string }> = []
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') {
        map[ids[i]] = { ins: [], outs: [], loaded: false, failed: errMsg(r.reason) }
        return
      }
      const data = r.value.data?.data
      const fields = (data?.fields ?? []) as Array<{ promptRole?: string; camelName?: string | null; fieldId: string }>
      if (!meta.length && Array.isArray(data?.promptRoleMeta) && data.promptRoleMeta.length) {
        meta = data.promptRoleMeta
      }
      map[ids[i]] = {
        ins: fields.filter((f) => f.promptRole === 'hard-required').map((f) => f.camelName || f.fieldId),
        outs: fields.filter((f) => OUT_ROLES.includes(f.promptRole || '')).map((f) => f.camelName || f.fieldId),
        loaded: true,
      }
    })
    // 已加载的阶段覆盖旧值，失败阶段保留失败态；成功阶段不因同批其他失败而回退成「加载中」
    stageFieldContract.value = { ...stageFieldContract.value, ...map }
    if (meta.length) {
      roleMetaById.value = Object.fromEntries(meta.map((m) => [m.id, { label: m.label, hint: m.hint }]))
    }
  })().finally(() => { if (stageContractInflight?.p === p) stageContractInflight = null })
  stageContractInflight = { key, p }
  await p
}
watch(
  stages,
  (s) => {
    if (s.length) void loadStageFieldContracts(s.map((x) => x.id))
  },
  { immediate: true },
)
/** 契约失败重试：清掉在途签名后按当前阶段集重拉（此前失败永远停在「入 …」且无重试） */
async function retryStageContracts() {
  stageContractInflight = null
  await loadStageFieldContracts(stages.value.map((s) => s.id))
}
function contractOf(id: string): StageFieldContract {
  return stageFieldContract.value[id] ?? { ins: [], outs: [], loaded: false }
}
/** 列脚读数三态：失败 → 「未加载」；未完成 → 「…」；就绪 → 数字 */
function contractCountText(id: string, kind: 'in' | 'out'): string {
  const c = contractOf(id)
  if (c.failed) return '未加载'
  if (!c.loaded) return '…'
  return String(kind === 'in' ? c.ins.length : c.outs.length)
}
function contractChipTitle(id: string, kind: 'in' | 'out'): string {
  const c = contractOf(id)
  if (c.failed) return `字段契约未加载：${c.failed}`
  if (!c.loaded) return '字段契约加载中'
  return contractTitle(kind, kind === 'in' ? c.ins.length : c.outs.length)
}

/** 画布重算：列位置量出后画三次贝塞尔连线（仅箭头；字段明细不在边上渲染，
     见总览卡头注释——边标签曾压住相邻列节点文字，2026-10-04 撤） */
/** 画布重算：列位置量出后画连线（仅箭头；字段明细不在边上渲染，
     见总览卡头注释——边标签曾压住相邻列节点文字，2026-10-04 撤） */
function layoutOrch() {
  const svg = odgSvgEl.value
  const canvas = odgCanvasEl.value
  if (!svg || !canvas) return
  /* 隐藏态（v-show → display:none）尺寸为 0：跳过，待可见时由 ResizeObserver 重算，
     避免把 SVG 宽高写成 0 后不再自愈 */
  if (!odgScrollEl.value?.clientWidth) return
  const cols = Array.from(canvas.querySelectorAll<HTMLElement>('.orch-odg-col'))
  if (cols.length < 2) return
  const W = canvas.scrollWidth
  const H = canvas.scrollHeight
  svg.setAttribute('width', String(W))
  svg.setAttribute('height', String(H))
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  let out = '<defs><marker id="orchOdgArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z"/></marker></defs>'
  /**
   * 组的垂直中点（2026-10-24 用户「向右下角的曲线指向下个组的中间，而不是指向第一列的
   * agent 名字」）：组 = 阶段头 + 该阶段全部 Skill 卡 + 字段列脚，取这条内容带的中点。
   * 不能取拉伸后的列中点（列被画布拉到同高，中点会落在列底空白里——2026-10-21 的老问题）；
   * 也不能锚在阶段头那一行，那是标题，不是交接点。
   * 坐标用 offset*：列的定位祖先是 .orch-odg-canvas，头/脚的 offsetTop 已是画布坐标，
   * 且不随 zoom 变，SVG 因此不用重算。
   */
  const groupMidY = (col: HTMLElement): number => {
    const head = col.querySelector<HTMLElement>('.orch-odg-colhead')
    const foot = col.querySelector<HTMLElement>('.orch-odg-foot')
    const top = head ? head.offsetTop : col.offsetTop
    let bottom: number
    if (foot) {
      bottom = foot.offsetTop + foot.offsetHeight
    } else {
      const nodes = col.querySelectorAll<HTMLElement>('.orch-odg-node')
      const last = nodes[nodes.length - 1]
      bottom = last ? last.offsetTop + last.offsetHeight : col.offsetTop + col.offsetHeight
    }
    return Math.round((top + bottom) / 2)
  }
  /** 出发端仍取阶段头中线：每条线都从本组标题右侧出发，向右下汇入下一组中点 */
  const headMidY = (col: HTMLElement): number => {
    const head = col.querySelector<HTMLElement>('.orch-odg-colhead')
    return head ? head.offsetTop + Math.round(head.offsetHeight / 2) : col.offsetTop
  }
  for (let i = 0; i < cols.length - 1; i++) {
    const a = cols[i]
    const b = cols[i + 1]
    const x1 = a.offsetLeft + a.offsetWidth + 2
    const y1 = headMidY(a)
    const x2 = b.offsetLeft - 6
    const y2 = groupMidY(b)
    /* 曲线从本组标题右侧出发，向右下角汇入下一组中点：两端切线都水平——离开时不斜切
       标题行，到达时箭头水平扎进组心；纵向落差全部在跨列间隙里完成，不压卡片。 */
    const dx = Math.max(26, Math.round((x2 - x1) / 2))
    const d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
    out += `<path class="orch-odg-edge" d="${d}" marker-end="url(#orchOdgArrow)"/>`
  }
  svg.innerHTML = out
}

/** 总览 odg 节点点击：进该 Skill 详情二级页（原型 odg-node data-action="open-skill" → go("skill")；
    节点携带真实 skill id（拓扑 skill: 前缀已剥），与 Skills API / 抽屉同一定位参数） */
function openSkillFromOverview(id: string) {
  openSubPage('skill', id)
}

/* ===== 总览画布缩放（2026-10-13 用户：居中 / 可拖动 / 可放大）=====
   用 zoom 而不是 transform: scale —— zoom 参与布局，放大后滚动区出现**真实**滚动范围
   （transform 只是视觉放大，滚不到被"放大到框外"的部分）；且实测列的自有坐标
   （offsetLeft/offsetWidth）不随 zoom 变，连线与列不会错位，无需随缩放重算 SVG。
   宽度必须由 JS 给 px（见 odgCanvasStyle 注释）。 */
/* 缩放范围只做安全夹逼，**不设档位**：滚轮连续缩放（用户拍板「不要固定比例」）。
   下限 0.25 保证五列仍肉眼看得出结构，上限 3 之后画布已远超一屏、再放大只增滚动量。 */
const ODG_ZOOM_MIN = 0.25
const ODG_ZOOM_MAX = 3
/** 滚轮 → 缩放比：指数曲线（每格 deltaY=100 ≈ ×1.16），手感与地图/画布类工具一致 */
const ODG_ZOOM_WHEEL_K = 0.0015
const odgZoom = ref(1)
/** 画布基准宽 = 滚动区内容宽（clientWidth − 左右 padding），zoom=1 时的可视宽 */
const odgBaseW = ref(0)
/* 宽度为什么必须显式给 px：zoom 的百分比语义会把 `width: 100%` 钉死在容器宽
   （实测 50%~200% 下画布可视宽恒为容器宽，缩小时根本看不出变小）。撤掉画布级
   min-width 后语义变得干净：**指定 px = 画布自有宽，肉眼宽 = 自有宽 × zoom**——
   于是给「基准宽」的定值即可，任何缩放比例的列自有坐标都等于 100% 那套（连线因此不用重算）。 */
const odgCanvasStyle = computed(() => ({
  zoom: String(odgZoom.value),
  width: odgBaseW.value ? `${odgBaseW.value}px` : undefined,
}))
/** 缩放比例安全夹逼（滚轮连续缩放，只夹上下限、不吸附档位） */
function setOdgZoom(z: number) {
  odgZoom.value = Math.min(ODG_ZOOM_MAX, Math.max(ODG_ZOOM_MIN, z))
}
/** 基准宽从容器算（自动扣掉 scoped 样式里的左右内边距，不留魔法数），
    只在量得到宽度时更新——隐藏态（v-show → display:none）clientWidth 为 0，不能把它写成 0 */
function sampleOdgBaseW() {
  const el = odgScrollEl.value
  if (!el || !el.clientWidth) return
  const cs = getComputedStyle(el)
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  odgBaseW.value = Math.max(0, Math.round(el.clientWidth - pad))
}
/** 滚轮缩放（触控板双指捏合同样派发 wheel，Chrome 会带上 ctrlKey）：以指针为锚点——
    缩放前后让指针下的那一点停在原地，否则放大后视野会一路漂向左上角。
    连续缩放：比例按 deltaY 指数变化，不吸附任何档位。 */
async function onOdgWheelZoom(e: WheelEvent) {
  const el = odgScrollEl.value
  const canvas = odgCanvasEl.value
  if (!el || !canvas) return
  /* deltaMode 归一：0=像素（多数鼠标/触控板），1=行（Firefox 鼠标），2=页 */
  const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
  const before = odgZoom.value
  setOdgZoom(before * Math.exp(-raw * ODG_ZOOM_WHEEL_K))
  const next = odgZoom.value
  if (next === before) return
  const r0 = canvas.getBoundingClientRect()
  const ax = (e.clientX - r0.left) / r0.width
  const ay = (e.clientY - r0.top) / r0.height
  odgZoom.value = next
  await nextTick()
  const r1 = canvas.getBoundingClientRect()
  el.scrollLeft += ax * (r1.width - r0.width)
  el.scrollTop += ay * (r1.height - r0.height)
}

/* ===== 总览画布抓取式拖动平移（2026-10-13）=====
   五列在窄档（<1600：5×196 + 4×48 = 1172）超出卡宽，原先只能拨横滚条才见第 4-5 列。
   补「按住拖动」平移：空白与节点上都能起手，位移 ≤ 4px 仍按点击处理（节点点击进 Skill
   详情不受影响）；触摸指针交还原生滚动，不抢手势。 */
const odgScrollEl = ref<HTMLElement | null>(null)
const odgPanning = ref(false)
let odgPanStart: { x: number; y: number; left: number; top: number; id: number; moved: boolean } | null = null
/* 拖动后浏览器仍会补发一次 click（落点可能在节点上）→ 捕获阶段吞掉，避免误进详情 */
let odgSuppressClick = false

function onOdgPointerDown(e: PointerEvent) {
  const el = odgScrollEl.value
  if (!el || e.button !== 0 || e.pointerType === 'touch') return
  odgPanStart = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId, moved: false }
}

function onOdgPointerMove(e: PointerEvent) {
  const el = odgScrollEl.value
  if (!el || !odgPanStart || e.pointerId !== odgPanStart.id) return
  const dx = e.clientX - odgPanStart.x
  const dy = e.clientY - odgPanStart.y
  if (!odgPanStart.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 4) return
    odgPanStart.moved = true
    odgPanning.value = true
    /* 指针捕获失败不致命（合成事件/指针已释放时浏览器会抛 NotFoundError）——平移本身照走 */
    try { el.setPointerCapture(e.pointerId) } catch { /* noop */ }
    /* 起手那一下 mousedown 已触发文本选择：进平移态时清掉，避免拖动拖出满屏蓝 */
    window.getSelection()?.removeAllRanges()
  }
  el.scrollLeft = odgPanStart.left - dx
  el.scrollTop = odgPanStart.top - dy
  e.preventDefault()
}

function onOdgPointerUp(e: PointerEvent) {
  if (!odgPanStart || e.pointerId !== odgPanStart.id) return
  const moved = odgPanStart.moved
  const el = odgScrollEl.value
  if (el?.hasPointerCapture?.(e.pointerId)) {
    try { el.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }
  odgPanStart = null
  odgPanning.value = false
  if (moved) {
    odgSuppressClick = true
    setTimeout(() => { odgSuppressClick = false }, 0)
  }
}

function onOdgClickCapture(e: MouseEvent) {
  if (!odgSuppressClick) return
  odgSuppressClick = false
  e.stopPropagation()
  e.preventDefault()
}

/* 连线重算：原先经 requestAnimationFrame 延迟，实测遮挡/后台窗口下 rAF 会被节流甚至停摆，
   于是容器宽度变了连线仍停在旧坐标（走查：resize 后箭头错位）→ 改直接重算：一次布局只读
   五列的 offsetLeft/offsetWidth 再写一次 SVG innerHTML，开销可忽略。
   统一出口 scheduleOdgLayout：0ms 宏任务去抖 + **等到布局吃进新宽度再量**。
   为什么不能量一次就算：写 `canvas.style.width` 之后，布局（以及列的最终位置）要等到下一次
   绘制才刷新——离屏/内置渲染下实测 ~60ms，其间读 offsetWidth 拿到的是旧几何，连线就滞后一档
   （症状：末条边差 2–6px，且此后没有事件再触发重算，看着像"永久错位"）。判据用
   「画布自有宽 === 基准宽」（两者在同一趟布局里生效，是"新宽度已落地"的可靠信号），
   最多等 ~160ms 就照常画，绝不死等。 */
let odgLayoutTimer: ReturnType<typeof setTimeout> | null = null
function layoutOrchWhenSettled(attempt = 0) {
  const canvas = odgCanvasEl.value
  const want = odgBaseW.value
  const settled = !canvas || !want || Math.abs(canvas.offsetWidth - want) < 1
  if (settled || attempt >= 8) {
    layoutOrch()
    return
  }
  odgLayoutTimer = setTimeout(() => {
    odgLayoutTimer = null
    layoutOrchWhenSettled(attempt + 1)
  }, 20)
}
function scheduleOdgLayout() {
  if (odgLayoutTimer) clearTimeout(odgLayoutTimer)
  odgLayoutTimer = setTimeout(() => {
    odgLayoutTimer = null
    layoutOrchWhenSettled()
  }, 0)
}
function onOdgResize() {
  scheduleOdgLayout()
}
/* 画布列宽随容器变化（侧栏折叠、页签 v-show 切换、4K 舒展档）→ 连线必须跟着重算。
   原先只监听 window resize：容器变宽而窗口没变时会留下错位连线。按 clientWidth 去重防抖。 */
let odgRo: ResizeObserver | null = null
let odgLastW = 0
function onOdgBoxResize() {
  const w = odgScrollEl.value?.clientWidth ?? 0
  if (!w || w === odgLastW) return
  odgLastW = w
  /* 基准宽也要跟着容器变（缩放后画布宽是「基准 × zoom」算出来的，基准陈旧会让
     放大态不再跟随窗口）。放大的滚动条出现会改 clientWidth → 同样经这里归一。 */
  sampleOdgBaseW()
  onOdgResize()
}
onMounted(() => {
  window.addEventListener('resize', onOdgResize)
  if (typeof ResizeObserver !== 'undefined' && odgScrollEl.value) {
    odgRo = new ResizeObserver(onOdgBoxResize)
    odgRo.observe(odgScrollEl.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onOdgResize)
  odgRo?.disconnect()
  odgRo = null
  if (odgLayoutTimer) clearTimeout(odgLayoutTimer)
})
watch([pane, stages, flowKey], async () => {
  if (pane.value !== 'overview') return
  await nextTick()
  /* 首访（含 v-show 切回）量一次基准宽：RO 的初次回调早于数据到位时容器可能还没宽，
     此处兜住「画布仍按 100% 渲染、基准宽一直为 0」的情况 */
  sampleOdgBaseW()
  scheduleOdgLayout()
})
/* 缩放/基准宽变化后重画连线：按上面的宽度语义，列的自有坐标与缩放无关，理论上不必重算——
   两个「但是」让它必要：①基准宽会在滚动条出现/消失时变（垂直滚动条吃掉 clientWidth），
   画布宽随之变、列位置跟着变；②「列布局不随缩放变」来自实测语义而非契约，一旦将来列宽规则
   改动（例如列也吃容器宽），连线就会静默错位。重算一次只读五列几何，代价可忽略。 */
watch([odgZoom, odgBaseW], () => {
  scheduleOdgLayout()
})

const totalSkills = computed(() => stages.value.reduce((sum, stage) => sum + stage.skills.length, 0))
/** Skill KPI tooltip（F8-4 走查）：本页三处 Skill 总数各有域，本卡须自报口径——
    本卡 = 编排拓扑内挂载的 Skill 节点数（Σ 各阶段）；治理卡「Skill 定义」= 运行时
    定义条目数（GET /admin/runtime-definitions）；侧栏「Skill 目录」徽章 = Skill
    目录档案数（不含插件）。三数不必相等，问「平台共多少 Skill」先确认口径。 */
const skillKpiTitle = computed(
  () =>
    `本页挂载的 Skill 数（各阶段合计，当前 ${stages.value.length} 个阶段）`
)
/* 页级「未解析」读数（原告警条用）已随告警迁健康中心（检查项 orchestration-steps）删除；
   行级读数曾挂在「阶段交接明细」表的徽章上（unresolvedOf/哈希漂移），该表 2026-10-13 整体删除。 */
// 空拓扑时 current 为 undefined，模板由 v-if="current" 保护
const current = computed<Stage | undefined>(() => stages.value.find((s) => s.id === active.value) || stages.value[0])
// 首屏加载中（live boot 未完成且尚无阶段数据）：用于抑制「0 阶段 / 暂无数据」的假空态
const pageLoading = computed(() => liveLoading.value && !stages.value.length)
// 2026-10-04 状态条退役：随条删除的 statusTone（概览绿点基调）无其余消费方；
// 告警语义（未解析/哈希漂移）2026-10-12 整体迁健康中心，本页条件告警条与随后的
// 交接明细行级徽章均已撤（后者 2026-10-13），本页不再持有任何治理读数。

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

/** 阶段页签名与画布列头同名（2026-10-26 评审）：此前页签是英文 Goal/Path/…、列头是中文
 *  「目标 Agent / 路径 Agent…」，读一屏要在脑子里做一次英中对照。阶段 id 仍是英文
 *  （与 `<stage>-agent` 同源），只在展示层换成中文；未登记的阶段回退后端显示名。 */
const STAGE_TAB_LABEL: Record<string, string> = {
  goal: '目标',
  path: '路径',
  teaching: '教学',
  profile: '学习者',
  simulation: '仿真'
}
const stageTabLabel = (s: Stage) => STAGE_TAB_LABEL[s.id] || s.name.replace(/阶段$/, '')

function stageTabTitle(s: Stage): string {
  return [s.name, `Agent: ${s.agentId}`, `Skill: ${s.skills.length} 个`].join('\n')
}

/** 总览 Skill 节点的悬停信息：中文名 / Skill id / Agent / 产出数 */
function skillNodeTitle(sk: Stage['skills'][number], s: Stage): string {
  const lines = [sk.name, `Skill: ${sk.id}`, `Agent: ${s.agentId}`]
  if (sk.produces.length) lines.push(`产出字段: ${sk.produces.length} 个`)
  return lines.join('\n')
}

/** 治理卡头读数：运行时定义条数 + 一致性核查已上线数 */
const govMetaTitle = computed(() =>
  recReport.value ? `一致性核查：已上线 ${recLiveCount.value} / 登记 ${recTotalCount.value}` : '一致性核查报告不可用'
)
</script><style scoped>
/* 一级页签（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局
   .tabs/.tab（mk-primitives.css），本页只留容器间距修饰。 */
.orch-top-tabs { margin-bottom: 2px; }
/* 二级页签（阶段内：字段旅程 / 字段路由 / 治理）：与一级同语言、弱一档（字号更小 + 不占满行宽）。
   右端挂「编排文件」入口（字段路由的唯一声明源）。 */
.orch-subtabs-row { display: flex; align-items: center; gap: 12px; margin-bottom: 2px; }
.orch-subtabs { flex: 1 1 auto; min-width: 0; }
.orch-subtabs .tab { font-weight: 600; }
.orch-subtabs__action { flex: none; }
/* 页签计数等宽：切阶段时页签宽度不跳（本页唯一会变的读数就是它） */
.orch-top-tabs .tab__count { font-variant-numeric: tabular-nums; }
/* 阶段视图容器：一级页签的 aria-controls 指向它，内部再分二级页签 + 内容。
   与 .orch-pane 同构（flex 列 + 弹性填满），保证套一层后各面板几何不变。 */
.orch-stage-view { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
/* ===== 阶段工作区（fill 布局：占满剩余视高，底部不再留空白；面板各自内滚，页面不滚） ===== */
.orch-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.orch-pane--scroll { overflow-y: auto; }
.orch-pane--center { justify-content: center; }
/* 总览单卡（2026-10-13）：画布独占一屏。阶段交接明细（含折叠区与治理徽章）当日整体删除
   （与「字段旅程」页签同源重复且字段数打架），.orch-odg-handoff* / .orch-handoff__* 样式随之退役。 */
.orch-overview { gap: 12px; }
/* 画布缩放读数（卡头右组，2026-10-13 用户「可放大」，同日改滚轮连续缩放后只剩这一枚）：
   显示当前比例、点击回 100%。定宽 + 等宽数字 = 比例变化时按钮不跳、附近元素不动 */
.orch-odg-zoom__val { min-width: 56px; font-variant-numeric: tabular-nums; }
/* 字段路由：卡头 + 工具条吸顶，仅表格区内滚（.frt__scroll 自带 .mk-table-scroll 横向滚动） */
.orch-routing .frt { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.orch-routing .frt__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* 阶段选择：2026-10-13 胶囊行并入一级页签（用户拍板），.orch-stage-pills 随之退役 */

/* 折叠层（字段路由 / 治理）：阶段工作区的查阅层，默认收起 */
/* 折叠头走 .mk-section__summary（shared.css） */

/* 沙盘（深链次要入口）顶部条 */

/* 告警条样式（.orch-alert）随页级告警迁健康中心一并删除（2026-10-12） */

/* ================= 暗色模式（D1 补完）：编排图 ================= */
html[data-theme='dark'] {

  /* 阶段选择 chips：mk-pill 暗色基调由全局原语承接，无页面私有限定 */

  /* 折叠层（字段路由 / 治理） */
  /* 折叠头基调由 .mk-section__summary--muted / :hover 提供（原 #afb1b6 即 --mk-muted 暗色值） */

  /* 沙盘顶部条返回按钮 */
}
</style>
<style>
/* ===== 总览 odg 画布（newui/admin odg-canvas）：连线和字段标签由 layoutOrch 以
   innerHTML 注入，不带 scoped 属性，因此样式放在非 scoped 块并统一 .orch-odg 前缀命名空间 ===== */
/* 2026-10-13 起总览只有这一张卡：画布滚动区接管卡片剩余高度（否则卡底留白）；
   同日拖动平移：空白处起手即抓手，平移中保持抓手并盖过节点指针态。
   同日居中（用户）：滚动区做单 flex 项容器，画布用 margin:auto 两轴居中——
   内容小于可视区时上下留白均分；放大溢出后 auto 边距归 0（起始对齐），
   不会像 justify-content:center 那样把左/上边界裁到滚动区之外够不着。
   内边距四边同值：居中态上下留白本就均分，原先「上 8 下 16」的旧内边距
   （顶左对齐时期的手工补白）会把居中结果再压偏 4px。 */
.orch-odg-scroll {
  flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px; cursor: grab;
  display: flex; align-items: flex-start;
}
/* 2026-10-24：画布纵向拉伸到滚动区高度，五列等高（原先各列按 Skill 条数自然高）。
   列脚不再随之压到底（见 .orch-odg-foot）：等高只用于列头/列宽的稳定，不改变内容流向。 */
.orch-odg-scroll { align-items: stretch; }
.orch-odg-scroll.is-panning,
.orch-odg-scroll.is-panning .orch-odg-node { cursor: grabbing; }
.orch-odg-canvas {
  position: relative; display: flex; align-items: stretch; gap: 100px;
  /* 2026-10-13 宽屏舒展：原「width: max-content + margin-inline: auto」在 4K 上五列只占
     ~1560（卡宽实测 3440 视觉 px），两侧各空约 700px。改为撑满滚动区，富余宽度由
     .orch-odg-col 的 flex-grow 摊给各列，节点与字段行随之变宽、更好读。
     2026-10-13 缩放：宽由 odgCanvasStyle 给「可视宽 × min(zoom,1)」的 px（zoom 的长度语义
     见那边注释），此处只留 100% 兜底（首帧尚未量到基准宽时用）；flex:none 保证放大后不自缩，
     把溢出交给滚动区。
     画布级 min-width 同日撤：窄档的有效最小内容宽本就由 .orch-odg-col 的地板给出
     （5×196 + 4×48 = 1172 / 5×232 + 4×100 = 1560），而画布级 min-width 会和 zoom 的宽度
     打架——实测 1584 与 1586 两档来回跳 2px，SVG 连线坐标因此滞后一档（末条边差 2px）。
     画布无底色无边线，盒子比列窄不产生任何视觉差，列溢出后滚动区照常给出滚动范围。 */
  flex: none; margin: auto;
  width: 100%;
}
/* 只保留水平居中：纵向 auto 边距会吃掉 stretch，列高回到内容高（等高列脚见下） */
.orch-odg-canvas { margin: 0 auto; }
.orch-odg-svg {
  position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible;
  /* 覆盖 main.css 里 img/svg/video/canvas 的全局 max-width:100%（2026-10-21 用户「线的位置
     不对 错位」的真因）：窄档画布容器只有 770px 宽，而连线 SVG 的语言宽是 1172（= 五列最小宽），
     max-width 把整张 SVG 等比缩到 65.7% 并按 preserveAspectRatio 垂直居中 → 4 条线整体上移、
     端点落在卡片之间的空白里。画布本来就靠滚动区承接溢出，SVG 不该被容器夹窄。 */
  max-width: none;
}
.orch-odg-edge { fill: none; stroke: var(--mk-blue, #2f6ae0); stroke-width: 1.6; opacity: 0.85; }
.orch-odg-svg marker path { fill: var(--mk-blue, #2f6ae0); }
/* 列宽地板必须显式：flex 项默认 min-width:auto 的内容地板会被列脚 nowrap 的 outs 长串
   （.orch-odg-fields）顶开——实测五列被顶到 411–1066px、画布总宽 4457px，1920 档只见 2/5 列
   （2026-10-04 注入实验）。固定地板 232px 后 flex-grow 才敢分富余宽度；不设 max-width——
   flex 只摊「可用」宽度，天然不会超出容器（设上限反而在 4K 顶出横滚）。 */
.orch-odg-col { flex: 1 1 232px; min-width: 232px; display: flex; flex-direction: column; gap: 8px; }
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
/* 阶段头必须单行：1440/1080 档 196px 列宽下 agent id 会折成第二行（实测头高 39→59），
   各列头高不一致 → 连线锚点高低不齐。名称固定、agent id 吃剩余宽度并省略（hover 看全量）。 */
.orch-odg-colname {
  font-weight: 700; font-size: var(--mk-fs-micro, 12px); color: var(--mk-ink);
  flex: 0 0 auto; white-space: nowrap;
}
.orch-odg-agent {
  margin-left: auto; font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint);
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.orch-odg-body { display: flex; flex-direction: column; gap: 6px; }
.orch-odg-node {
  display: grid; gap: 1px; width: 100%; padding: 8px 10px; text-align: left;
  border: 1px solid var(--mk-line, #e6ebf4); border-radius: var(--mk-radius-lg, 10px);
  background: var(--mk-surface, #fff); cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.orch-odg-node:hover { border-color: var(--mk-blue, #2f6ae0); box-shadow: var(--mk-shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.1)); }
.orch-odg-idx { font-family: var(--mk-mono, Consolas, monospace); font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint); }
.orch-odg-nodename { font-size: var(--mk-fs-micro, 12px); font-weight: 600; color: var(--mk-ink); }
/* Skill id（英文名）：与中文显示名分行。允许折行而不是省略号——运营要照着这枚 id
   去对 Skill 目录 / 执行日志，截断了反而对不上（长 id 如 virtual-learner-* 会占两行）。 */
.orch-odg-slug {
  font-family: var(--mk-mono, Consolas, monospace);
  font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint);
  overflow-wrap: anywhere;
}
/* 审核 #117：.orch-odg-nodemeta 规则随节点内重复 agentId 一起删（列头已承接，类无消费者） */
/* 列脚紧跟本阶段的最后一个 Skill（2026-10-24 用户「怎么固定底部了，应该跟着组走」）：
   撤掉 margin-top:auto 与 .orch-odg-body 的 flex-grow——等高列由画布 stretch 给出，
   富余高度留在列底；否则列脚会被推到整屏最下方，和它所属的分组脱开（放大后更明显）。 */
.orch-odg-foot {
  display: flex; flex-direction: column; align-items: stretch; gap: 4px;
  padding-top: 2px;
}
.orch-odg-counts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.orch-odg-chip {
  font-size: var(--mk-fs-micro, 12px); padding: 1px 6px;
  border-radius: var(--mk-radius-sm, 6px);
  background: var(--mk-surface-2, #eef2fa); color: var(--mk-muted); white-space: nowrap;
}
.orch-odg-chip--in { background: color-mix(in srgb, var(--mk-blue, #2f6ae0) 10%, transparent); color: var(--mk-accent-deep, #1f57cc); }
/* 审核 #119：--out 原继承 --mk-accent-deep 蓝字，与 --in 字色相同——绿底蓝字把「产出」读成可交互蓝。
   绿系 chip 字色改绿深档，让「蓝=入参/交互、绿=产出」在字色层也成立 */
.orch-odg-chip--out { background: color-mix(in srgb, var(--mk-green, #15803d) 12%, transparent); color: var(--mk-green, #15803d); }
/* 契约拉取失败：红字显式说出「未加载」，与「加载中 …」和「真 0 个」在视觉上可分辨 */
.orch-odg-chip--failed { background: color-mix(in srgb, var(--mk-red, #dc2626) 10%, transparent); color: var(--mk-red, #dc2626); }
.orch-odg-fields {
  min-width: 0;
  /* 字段名是列脚唯一的信息，允许折两行；超长才省略，完整值仍在 title */
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden; overflow-wrap: anywhere;
  font-family: var(--mk-mono, Consolas, monospace);
  font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint);
}
/* 审核 #110：1440 档卡内可用宽约 1136px，而 5×232 + 4×100 = 1560 必横滚约 448px 才见第 4-5 列，
   卡题「管线总览 · 五阶段字段血缘」的全貌在标准视野内不成立。1599 档收窄列宽与列间距
   （5×196 + 4×48 + 24 ≈ 1196，接近卡宽；仍略超则保留少量内横滚）。1920 起沿用原全展开档。
   必须放在 .orch-odg-col 基规则之后：同特异性下按源序后者胜，否则 flex-basis 被 232px 覆盖 */
@media (max-width: 1599px) {
  /* 画布级 min-width 随缩放改动撤（见上方注释），本档只收窄列间距与列地板 */
  .orch-odg-canvas { gap: 48px; }
  /* min 同步收窄（2026-10-13）：基规则的地板 232 会把本档的 flex-basis 架空，
     列在 1280–1599 反而放不下仍要横滚；收窄后列按可用宽度摊（不溢出、不截断） */
  .orch-odg-col { flex-basis: 196px; min-width: 196px; }
}
</style>

