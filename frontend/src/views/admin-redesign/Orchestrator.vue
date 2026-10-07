<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名 + 刷新上移；2026-10-04 状态条退役，读数迁页首 KPI 带 -->
    <MkPageHead title="编排图" sub="顶层 Agent 数据流转逻辑图 · 字段血缘与阶段交接">
      <template #actions>
        <!-- 刷新此前只重拉 definitions， stages / 对账仍是旧值（治理面板数字对不上）→ 三个域全拉 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="refreshing" @click="refreshAll">{{ refreshing ? '刷新中…' : '刷新' }}</button>
      </template>
    </MkPageHead>
    <!-- KPI 带（2026-10-04 状态条退役）：阶段/Skill/交接三张读数卡；未解析/哈希漂移为条件红卡，
         保留可点跳转（红字必须可点，评审「异常→动作→证据断链」+ P1#27）：未解析 → 页内切「字段旅程」
         面板并定位首个含未解析步骤的阶段；哈希漂移 → 健康中心（W4 coreHash 检查归属页，本页
         治理面板 DriftAuditPanel 只覆盖契约漂移）。加载中显「—」不按 0 渲染 -->
    <section class="mk-kpi-grid">
      <!-- 审核 #113：失败态 KPI 也走「—」三态——原式 pageLoading 只在加载窗口成立，拓扑失败后
           stages 恒空、pageLoading 回落 false，KPI 带把「不知道」渲染成 0（与正文失败空态同屏打架）。
           加载中或失败一律「—」，不按 0 渲染 -->
      <MkKpi label="阶段" :value="kpiUnknown ? '—' : stages.length" />
      <!-- F8-4（2026-10-07 走查）：本页三处 Skill 总数各说各的域——本卡 Σ 阶段挂载的拓扑
           节点（21）、侧栏「Skill 与提示词」徽章（Skill 目录档案数，31）、治理卡「Skill 定义」
           （runtime-definitions 条目数，32），此前只有本卡无任何口径说明，运营无从判断信哪个。
           按「阶段交接」KPI 同一惯例补 hint（可见口径）+ title（三源关系） -->
      <MkKpi label="Skill" :value="kpiUnknown ? '—' : totalSkills" hint="拓扑内挂载 Skill 数" :title="skillKpiTitle" />
      <MkKpi label="阶段交接" :value="kpiUnknown ? '—' : handoffCount" hint="线性拓扑 = 阶段数 − 1" />
      <MkKpi
        v-if="unresolvedCount > 0"
        label="未解析"
        :value="unresolvedCount"
        tone="bad"
        clickable
        title="点击切到「字段旅程」面板：红「未解析」徽章即名单（定位到首个含未解析步骤的阶段）"
        @click="goUnresolved"
      />
      <MkKpi
        v-if="w4Drifted.length"
        :label="TERMS.driftHashQualified"
        :value="w4Drifted.length"
        tone="bad"
        clickable
        title="W4 core 哈希漂移名单在健康中心的健康检查（w4-corehash）；点击跳转"
        @click="goHashDrift"
      />
    </section>

    <!-- 子面板页签（原型 .tabs 下划线页签：2026-10-01 由 mk-pills 胶囊迁入——
         胶囊只做筛选 chips，视图/分区切换归页签）：四个面板统一可达——
         总览（全旅程 odg 画布，缺省）/字段旅程/字段路由/治理/沙盘。
         键盘契约（审核 #97）：role=tablist/tab 兑现 roving tabindex + 左右方向键循环切换，
         每页签 aria-controls 到对应 role=tabpanel 内容容器 -->
    <div class="tabs orch-pane-tabs" role="tablist" aria-label="编排图子面板" @keydown="onPaneTabKeydown">
      <button v-for="(pt, i) in ORCH_PANES" :key="pt.id" :id="`orch-tab-${pt.id}`" :ref="(el) => setPaneTabRef(el, i)" type="button" role="tab" class="tab"
        :aria-selected="pane === pt.id" :aria-controls="`orch-pane-${pt.id}`" :tabindex="pane === pt.id ? 0 : -1" @click="pane = pt.id">{{ pt.label }}</button>
    </div>

    <!-- 阶段选择 chips（2026-10-05 阶段导航大卡退役）：大卡与页首 KPI 带对同一批数字数两遍
         （KPI「阶段 5 · Skill 21」 vs 五卡各带「N Skill」），且总览画布本身就是五阶段——撤。
         选择职能下沉为轻量 chips，只在单阶段视图（字段旅程/字段路由/治理）出现；总览/沙盘
         不出现（总览画布即五阶段全貌，沙盘与阶段无关）。阶段是范围选择，按 2026-10-01 约定
         归胶囊语言（胶囊=筛选 chips、页签=视图切换） -->
    <div v-if="stageScoped" class="orch-stage-pills" role="group" aria-label="阶段选择">
      <button
        v-for="s in stages"
        :key="s.id"
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': active === s.id }"
        :aria-pressed="active === s.id"
        :title="stageTabTitle(s)"
        @click="selectStage(s.id)"
      >
        {{ s.name.replace(/阶段$/, '') }}
        <span class="mk-pill__count">{{ s.skills.length }}</span>
      </button>
    </div>

    <!-- ===== 总览：全旅程 odg 画布（newui/admin odg-canvas 形态）=====
         五阶段并列列（阶段头 + Skill 节点 + 入/出参 chip + 产出字段），
         列间 SVG 三次贝塞尔连线（仅箭头：字段明细由列脚 outs 行 + 交接明细表 +
         「字段旅程」页签三处承载，边标签曾以 6 行字段名画在 120px 间隙里压住
         相邻列节点文字——实测四条边全相交，2026-10-04 撤），layoutOrch 在
         渲染/窗口 resize 时重算；点 Skill 节点进入该技能详情二级页（原型 open-skill）。 -->
    <div v-if="pane === 'overview' && stages.length" id="orch-pane-overview" role="tabpanel" aria-labelledby="orch-tab-overview" class="orch-pane orch-overview">
      <section class="mk-card mk-card--fill orch-odg-page">
      <div class="mk-card__head">
        <!-- 卡题 2026-10-05 改名：原「字段数据旅程」与「字段旅程」页签撞车（两处都自称旅程）——
             本卡是五阶段全貌，归属「总览」；单阶段旅程图归「字段旅程」页签 -->
        <h3 class="mk-card__title">管线总览 · 五阶段字段血缘</h3>
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
                :title="`查看「${sk.name}」（${s.agentId}）详情`"
                @click="openSkillFromOverview(sk.id)"
              >
                <span class="orch-odg-idx mono">{{ i + 1 }}.{{ j + 1 }}</span>
                <span class="orch-odg-nodename">{{ sk.name }}</span>
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
           空值三态（与画布 chips 同一原则）：无必填入参显「无必填入参」、契约未加载显「…」，
           不按 0/— 渲染——「真无必填」与「没加载」不可分辨即是编造 -->
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
                <td class="mono orch-handoff__pair">
                  {{ h.from }} → {{ h.to }}
                  <!-- 治理信号随行（口径与页首 KPI 带两枚红卡同源，2026-10-04 状态条退役）；点跳转复用红卡落点。
                       审核 #96：徽章入口原是无 role/tabindex 的 span + @click，键盘不可达；改真 <button> -->
                  <button v-if="h.unresolvedN" type="button" class="mk-badge mk-badge--sm mk-badge--warn orch-handoff__badge-btn" title="该交接上游阶段存在未解析步骤（末段含下游阶段，四行合计 = 页首读数） · 点击切「字段旅程」定位" @click="goUnresolved()">未解析 {{ h.unresolvedN }}</button>
                  <button v-if="h.driftN" type="button" class="mk-badge mk-badge--sm mk-badge--bad orch-handoff__badge-btn" title="该交接上游 Agent 命中 W4 core 哈希漂移名单（末段含下游 Agent，四行合计 = 页首读数） · 点击跳健康中心" @click="goHashDrift()">哈希漂移 {{ h.driftN }}</button>
                </td>
                <td class="mono orch-handoff__agent">{{ h.fromAgent }}</td>
                <td class="mono orch-handoff__agent">{{ h.toAgent }}</td>
                <td class="orch-handoff__fields">
                  <!-- 点号长串 → 徽章列表（2026-10-03 反馈「字段密集堆叠」）：7 个键名连成
                       一句独吞 65% 列宽，键名边界只能靠 · 猜；逐枚徽章可数可扫，列宽随之收回。
                       空值三态：loaded 且无必填 →「无必填入参」；未加载 →「…」（不编造 0） -->
                  <template v-if="h.fields.length">
                    <span v-for="f in h.fields" :key="f" class="mk-badge mk-badge--sm mono">{{ f }}</span>
                  </template>
                  <span v-else-if="h.loaded" class="mk-na" title="该阶段字段契约无必填入参（hard-required），交接不设准入字段">无必填入参</span>
                  <span v-else class="mk-na" title="字段契约加载中…">…</span>
                </td>
                <td class="mk-num">{{ h.loaded ? h.fields.length : '…' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <div v-else-if="pane === 'overview'" id="orch-pane-overview" role="tabpanel" aria-labelledby="orch-tab-overview" class="orch-pane orch-pane--center">
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
         旅程图 = 卡内画布滚动（工具条/旅程条吸顶）；路由/治理 = 面板内滚；页面本身不滚 -->
    <DataFlowGraph
      v-else-if="current && pane === 'journey'"
      id="orch-pane-journey"
      role="tabpanel"
      aria-labelledby="orch-tab-journey"
      class="orch-pane orch-pane--journey"
      :key="`${active}-${flowKey}`"
      :stage="active"
      @changed="onRoutingChanged"
      @stage="onStageChange"
    />
    <section v-else-if="current && pane === 'routing'" id="orch-pane-routing" role="tabpanel" aria-labelledby="orch-tab-routing" class="mk-card mk-card--fill orch-pane orch-routing">
      <div class="mk-card__head">
        <h3 class="mk-card__title">字段路由与编排文件</h3>
        <!-- meta 换同源口径（2026-10-05 页签重设计）：原「输入 0/0 · 输出 0/0」来自
             liveSkillCatalog 的阶段级变量流——catalog 对多数阶段为空，出假零，与表内
             25 行字段同页打架。改用字段契约 stageFieldContract（与画布 chips/交接明细
             同源同数）：必填入参 = hard-required，产出 = 三产出角色；未加载显「…」 -->
        <span class="mk-card__meta" :title="routingMetaTitle">
          <!-- 未加载显「…」（与画布 chips 同一三态约定；规则 5 禁内联「加载中」文案，
               口径解释在 :title 里） -->
          <template v-if="!contractOf(active).loaded">…</template>
          <template v-else>必填入参 {{ contractOf(active).ins.length }} · 产出 {{ contractOf(active).outs.length }} · {{ current.skills.length }} Skill</template>
        </span>
      </div>
      <FieldRoutingTable :stage="active" @changed="onRoutingChanged" />
    </section>
    <section v-else-if="current && pane === 'governance'" id="orch-pane-governance" role="tabpanel" aria-labelledby="orch-tab-governance" class="mk-card mk-card--fill orch-pane orch-pane--scroll">
      <div class="mk-card__head">
        <h3 class="mk-card__title">治理：{{ TERMS.driftContract }}报告 + 变更审计</h3>
        <!-- 口径摆面上（2026-10-05）：原「对账已上线 37/37」与「Skill 定义 32」表面打架——
             37 含外挂能力（skill-catalog 口径）、32 是运行时 Skill 定义数，两数不同源不冲突，
             但必须自解释才不像「数字对不上」 -->
        <span class="mk-card__meta" :title="govMetaTitle">
          编辑后核对文件与库一致 · 编排定义 {{ orchCount }} · Skill 定义 {{ skillDefCount }}<template v-if="recReport"> · 对账 live {{ recLiveCount }}/{{ recTotalCount }}（口径含外挂能力）</template>
        </span>
      </div>
      <!-- 定义明细（definitionNotes 调试转储）2026-10-05 撤：Skill 行名称字段全空
           （API 无 name/title 字段）、编排行与总览/字段路由信息重复，且双定义接口
           为此白拉——治理回归三折叠本体（新建字段/漂移报告/最近变更） -->
      <DriftAuditPanel :stage="active" />
    </section>
    <!-- 无阶段数据兜底：id/aria-labelledby 随当前 pane 动态给出，保证 journey/routing/governance
         的 aria-controls 在此状态下仍指向真实面板（v-else 与上面各分支互斥，无重复 id） -->
    <div v-else :id="`orch-pane-${pane}`" role="tabpanel" :aria-labelledby="`orch-tab-${pane}`" class="orch-pane orch-pane--center">
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
import { liveTopoNodes, liveSkillCatalog, liveLoading, liveFailures, reloadLiveTopology } from './live'
import { TERMS } from './terms'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi, adminSkillsApi, type SkillReconciliationReport } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import DataFlowGraph from './DataFlowGraph.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MockSkeletonTable from './SkeletonTable.vue'

/** 阶段工作区子面板:总览(全旅程 odg 画布,缺省)/字段旅程/字段路由/治理。
     沙盘契约 2026-10-05 下线（内容被 总览列脚 + 字段旅程 + 字段路由 三处覆盖，
     自我定位即「深链次要入口」）；旧深链 ?tab=sandbox 落总览 */
type OrchPane = 'overview' | 'journey' | 'routing' | 'governance'
const ORCH_PANES: Array<{ id: OrchPane; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'journey', label: '字段旅程' },
  { id: 'routing', label: '字段路由' },
  { id: 'governance', label: '治理' },
]
const pane = ref<OrchPane>('overview')
/* 页签键盘契约（审核 #97）：roving tabindex（仅选中项可 Tab 进入）+ 左右方向键循环切换并移动焦点，
   兑现 role=tablist/role=tab 的 ARIA tabs 语义（此前四页签全在 Tab 序、方向键无反应，属半套契约） */
const paneTabEls = ref<(HTMLButtonElement | null)[]>([])
function setPaneTabRef(el: unknown, i: number) {
  paneTabEls.value[i] = (el as HTMLButtonElement) || null
}
function onPaneTabKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = ORCH_PANES.length
  const cur = ORCH_PANES.findIndex((p) => p.id === pane.value)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight') next = (from + 1) % n
  else if (e.key === 'ArrowLeft') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else next = n - 1
  e.preventDefault()
  pane.value = ORCH_PANES[next].id
  // 切换后焦点跟随新页签（ARIA tabs 惯例）；等 tabindex 更新后再聚焦
  void nextTick(() => paneTabEls.value[next]?.focus())
}
/** 单阶段视图（字段旅程/字段路由/治理）才需要阶段选择 chips——总览画布即五阶段全貌
     （原阶段导航大卡的显示条件同此，2026-10-05 大卡退役后沿用） */
const stageScoped = computed(() => ['journey', 'routing', 'governance'].includes(pane.value))

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

/** ?stage=&tab= 直达（Skill 设计页字段路由 tab → 编排图页跳转闭环；旧 /admin/topology 重定向落位阶段视图）。
    审核 #118：无法识别的 ?tab= 值此前静默回落总览且不回写 URL——URL 声称的面板 ≠ 渲染的面板
    （如 ?tab=flow 实际渲染总览），量测/分享链接都会对不上；现与 ?stage= 的校正同纪律：
    未知 tab 不留脏参数，清掉 tab 并按真实面板回写 URL。 */
function applyStageQuery() {
  const qStage = typeof route.query.stage === 'string' && route.query.stage.trim() ? route.query.stage.trim() : ''
  const qTab = typeof route.query.tab === 'string' ? route.query.tab.trim() : ''
  if (qStage) active.value = qStage
  // ?tab= 语义:overview(缺省)/journey/routing/governance;legacy:drift→治理,topology→旅程,
  // sandbox→总览（2026-10-05 沙盘契约下线,内容已被 总览/字段旅程/字段路由 覆盖）
  const knownTab = qTab === '' || qTab === 'routing' || qTab === 'governance' || qTab === 'drift' || qTab === 'journey' || qTab === 'topology'
  if (qTab === 'routing') pane.value = 'routing'
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

function selectStage(id: string) {
  active.value = id
  flowKey.value++
}



const defsLoading = ref(false)
const defsLoaded = ref(false)
/** 阶段清单端点拉取中（与 defsLoading / recLoading 共同驱动页头「刷新」忙碌态） */
const stagesLoading = ref(false)
const orchCount = ref(0)
const skillDefCount = ref(0)
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

/** 页头「刷新」：三个域（阶段清单 / 运行时定义 / 对账）全拉，避免只刷一半 */
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

/** KPI「未解析」红卡落地（可点，2026-10-04 状态条退役自条上红字迁入）：切 journey 面板 +
    定位首个含未解析步骤的阶段；?stage=&tab= 回写由下方既有 watch 承接（:369-377 先例），刷新/分享可还原 */
function goUnresolved() {
  const hit = stages.value.find((s) => (s.defSteps || []).some((d) => d.resolved?.unresolved))
  if (hit) active.value = hit.id
  pane.value = 'journey'
}
/** KPI「哈希漂移」红卡落地（可点，2026-10-04 状态条退役自条上红字迁入）：W4 coreHash 检查归属健康中心
    （本页治理面板 DriftAuditPanel 只覆盖契约漂移，hash 名单在那边） */
function goHashDrift() {
  // ?check= 定位到 w4-corehash 检查行（健康中心深链展开+滚动）
  void router.push({ path: '/admin/health-center', query: { check: 'w4-corehash' } })
}

/** 相邻阶段交接（原型 1624-1629 五列）：交接列用阶段 id（原型 s.id，本页 id 本就小写 mono）；
 *  传递字段口径 = 下游阶段的必填入参（stageFieldContract.ins，字段路由 hard-required），
 *  即原型 s.in 的真实数据对应物——本页 stages 拓扑只有 consumes/produces 汇总，无独立 in/outs；
 *  loaded 随行带出：空值三态（无必填入参 / 未加载 …）不与「字段数 0」混渲染 */
const stageHandoffs = computed(() => {
  const out: Array<{ from: string; to: string; fromAgent: string; toAgent: string; fields: string[]; loaded: boolean; unresolvedN: number; driftN: number }> = []
  for (let i = 0; i < stages.value.length - 1; i++) {
    const up = stages.value[i]
    const down = stages.value[i + 1]
    // 治理信号落到行（2026-10-03 反馈：页首「未解析/哈希漂移」读数与具体交接脱钩）：
    // 未解析 = 两端阶段 defSteps 里 resolved.unresolved 的步骤数；哈希漂移 = 两端 Agent 命中 W4 coreHash 漂移名单
    const unresolvedOf = (s: typeof up) => (s.defSteps || []).filter((d) => d.resolved?.unresolved).length
    const driftOf = (agentId: string) => (w4Drifted.value || []).filter((id) => id === agentId).length
    out.push({
      from: up.id,
      to: down.id,
      fromAgent: up.agentId,
      toAgent: down.agentId,
      fields: contractOf(down.id).ins,
      loaded: contractOf(down.id).loaded === true,
      // 阶段归属不重复计（审核 #101）：与未解析同纪律——上游阶段记进本交接，末阶段（无下游交接）
      // 回记到最后一段，四行合计 === 页首 KPI 的 w4Drifted.length（每阶段恰计一次）。
      // 原 driftOf(up)+driftOf(down) 把中间阶段各计两次，合计大于页首读数，两处同源治理口径互相冲突。
      unresolvedN: unresolvedOf(up) + (i === stages.value.length - 2 ? unresolvedOf(down) : 0),
      driftN: driftOf(up.agentId) + (i === stages.value.length - 2 ? driftOf(down.agentId) : 0),
    })
  }
  return out
})

/** 「N 处阶段交接」：拓扑为线性列时 = 阶段数 - 1（原状态条 meta 口径，2026-10-04 迁 KPI 交接卡 hint） */
const handoffCount = computed(() => Math.max(stages.value.length - 1, 0))

/** 画布重算：列位置量出后画三次贝塞尔连线（仅箭头；字段明细不在边上渲染，
     见总览卡头注释——边标签曾压住相邻列节点文字，2026-10-04 撤） */
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
/** Skill KPI tooltip（F8-4 走查）：本页三处 Skill 总数各有域，本卡须自报口径——
    本卡 = 编排拓扑内挂载的 Skill 节点数（Σ 各阶段）；治理卡「Skill 定义」= 运行时
    定义条目数（GET /admin/runtime-definitions）；侧栏「Skill 与提示词」徽章 = Skill
    目录档案数（不含外挂能力）。三数不必相等，问「平台共多少 Skill」先确认口径。 */
const skillKpiTitle = computed(
  () =>
    `本卡口径：编排拓扑内挂载的 Skill 节点数（Σ 各阶段 skills，当前 ${stages.value.length} 个阶段）。` +
    '与治理卡「Skill 定义」（运行时定义条目数）及侧栏「Skill 与提示词」徽章（Skill 目录档案数，不含外挂能力）' +
    '为三个不同口径，数值不必相等'
)
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
// 2026-10-04 状态条退役：随条删除的 statusTone（概览绿点基调）无其余消费方，
// 告警语义由 KPI 带两张条件红卡（未解析/哈希漂移）直接承载

/* ================= 失败态：接口失败 ≠ 没有数据 =================
   阶段清单依赖 live boot 的 topology 域（liveFailures.topology）。
   该域失败时 liveTopoNodes 为空 → stages 为空，此前与「后端本就没数据」
   同落「暂无编排阶段数据」，把接口失败伪装成空态；这里区分并给重试。 */
const topoFailure = computed(() => liveFailures.value.topology || '')
/** KPI 带未知态（审核 #113）：加载中或拓扑失败时三张读数卡显「—」，不把未知渲染成 0 */
const kpiUnknown = computed(() => pageLoading.value || !!topoFailure.value)

async function retryStages() {
  await Promise.all([
    loadStages(),
    reloadLiveTopology()
      .then(() => { delete liveFailures.value.topology })
      // 仍失败：保留 liveFailures.topology，错误态继续给原因 + 可再次重试
      .catch(() => undefined)
  ])
}

/** 阶段 chip tooltip：skills=0 时说明去向（chip 计数只显「0」，无从判断是真空还是没拉到） */
function stageTabTitle(s: Stage): string {
  if (!s.skills.length) return '该阶段下辖 0 个 Skill：可能调度树未登记，或拓扑 / 目录尚未拉取成功'
  return `${s.name}：${s.skills.length} 个 Skill`
}

/** 字段路由卡头 tooltip：与画布 chips / 阶段交接明细同一份字段契约（同页同数纪律） */
const routingMetaTitle = computed(() => {
  const c = contractOf(active.value)
  if (!c.loaded) return '字段契约加载中（GET /admin/field-routings/stages/:id）'
  return `口径与画布 chips / 阶段交接明细同源：必填入参 = hard-required ${c.ins.length} 项；产出 = 方案产出/公开回复/派生展示 ${c.outs.length} 项`
})

/** 治理卡头 tooltip：定义与对账口径说明 */
const govMetaTitle = computed(() =>
  [
    '运行时定义：GET /admin/runtime-definitions（orchestrator / agent 两类）',
    recReport.value ? `对账：live ${recLiveCount.value} / 登记 ${recTotalCount.value}（口径含外挂能力，多于 Skill 定义数属正常）` : '对账报告不可用'
  ].join('；')
)
</script><style scoped>
/* 子面板页签（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局
   .tabs/.tab（mk-primitives.css），本页只留容器间距修饰。 */
.orch-pane-tabs { margin-bottom: 2px; }
/* ===== 阶段工作区（fill 布局：占满剩余视高，底部不再留空白；面板各自内滚，页面不滚） ===== */
.orch-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.orch-pane--scroll { overflow-y: auto; }
.orch-pane--center { justify-content: center; }
/* 总览双卡（原型：odg 画布卡 + margin-top 的交接明细卡）：画布卡弹性填满、交接卡自然高度贴底 */
.orch-overview { gap: 12px; }
/* P1-4（2026-10-04 全站评审）：fill 布局下交接明细卡自然高度（4 行 ≈394px）把上方
   「字段数据旅程」画布压成 84px 滚动缝（clientHeight=84/scrollHeight=754，五条泳道
   首行全部拦腰切断）。按本页 .frt__scroll 判例给交接卡设上限、表格区内滚，
   画布保住首屏至少一条完整泳道。
   LY5（2026-10-05 布局方案 §3）：45%→55%——1440 起让 4 行明细全见（现末行底 1032>880），
   1280 从 1.5 行提升到 2~3 行；画布仍保 ≥1 条完整泳道。不给画布加 max-height，
   4K 可见性由全局壳层（§0）修复保证，本页不加 4K 专用补丁。
   报告 §六 列为可选否决项（默认即本值）：若「画布优先、明细表可只留 1 行」是硬口径，
   按 §六 处理回 45% 即可（一行回退）。 */
.orch-overview .orch-handoff {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 55%;
  display: flex;
  flex-direction: column;
}
.orch-overview .orch-handoff .mk-table-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* 阶段交接明细（原型 .tbl 的 mono/sub/wrap 形态）：交接列 id 对弱化 mono；传递字段可换行 */
.orch-handoff__pair { color: var(--mk-muted); white-space: nowrap; }
/* 治理徽章随行：真 <button> 复用 .mk-badge 皮（审核 #96）——只补按钮默认字族与手型，
   不再对 span 手写 cursor 补丁；与阶段 id 对之间留 6px */
.orch-handoff__pair .mk-badge { margin-left: 6px; }
/* WCAG 2.5.8（Target Size, AA）要求触控目标 ≥ 24×24。本钮 1080/2K 档实测只有 20–22px 高
   （.mk-badge--sm 的 padding 1px + line-height），同排徽章间距又只有 4px，
   「相邻目标间距足够」的豁免也不成立——只有 4K 档字号放大后才到 37px。
   .mk-badge 本身已是 inline-flex + align-items:center，补 min-height 即可居中撑到 24。 */
.orch-handoff__badge-btn { font-family: inherit; cursor: pointer; min-height: 24px; }
/* 传递字段 = 逐枚徽章（mk-badge--sm），格内 flex 换行；不再用点号长串（独吞 65% 列宽） */
.orch-handoff__fields { white-space: normal; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
/* P2-12（设计评审 4.2）：上/下游 Agent 列仅 115px，simulation-agent 词中断成 simulatio/n-agent
   （body 全局 overflow-wrap:anywhere 所致）。两列回 nowrap 单行，并回 overflow-wrap:normal
   让长词 min-content 恢复整词宽度——auto 布局才能把列宽增量分给「传递字段」徽章换行列，
   不溢出容器（本表无 fixed 布局 / colgroup，无需调列宽比例）。 */
.orch-handoff__agent { white-space: nowrap; overflow-wrap: normal; }
/* 字段路由：卡头 + 工具条吸顶，仅表格区内滚（.frt__scroll 自带 .mk-table-scroll 横向滚动） */
.orch-routing .frt { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.orch-routing .frt__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* 阶段选择 chips（2026-10-05 阶段导航大卡退役）：样式走 .mk-pill 全局原语，这里只管行布局；
   页面 mk-page--fill 的 flex gap（12px）接管与页签/内容区的间距 */
.orch-stage-pills { display: flex; flex-wrap: wrap; gap: 6px; }

/* 折叠层（字段路由 / 治理）：阶段工作区的查阅层，默认收起 */
/* 折叠头走 .mk-section__summary（shared.css） */

/* 沙盘（深链次要入口）顶部条 */

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
/* 交接明细拆出独立卡后，画布滚动区接管画布卡的剩余高度（否则卡底留白） */
.orch-odg-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 12px 16px; }
.orch-odg-canvas {
  position: relative; display: flex; align-items: flex-start; gap: 100px;
  /* LY13（4K 实测）：画布容器被撑到视口宽 3798，但五列固定 232 + gap100 只到 ~1560，
     右侧空 33%（节点区右缘停在 33% 处）。改为内容宽度 + 水平居中：
     宽屏下节点组居中留白两侧均分；窄屏（内容 > 容器）margin auto 归 0，overflow 正常左对齐横滚，
     offsetLeft/offsetWidth 与 SVG 坐标系不变（连线布局不受影响）。 */
  width: max-content; margin-inline: auto;
  min-width: max-content;
}
.orch-odg-svg { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
.orch-odg-edge { fill: none; stroke: var(--mk-blue, #2f6ae0); stroke-width: 1.6; opacity: 0.85; }
.orch-odg-svg marker path { fill: var(--mk-blue, #2f6ae0); }
/* min-width:0 必须显式：flex 项默认 min-width:auto 的内容地板会被列脚 nowrap 的
   outs 长串（.orch-odg-fields）顶开——实测五列被顶到 411–1066px、画布总宽 4457px，
   1920 档只见 2/5 列（2026-10-04 注入实验：仅此一行即全部回 232px）；
   gap 100 = 5×232 + 4×100 + 卡内边距 24 ≈ 1584，1920 档五列全收 */
.orch-odg-col { flex: 0 0 232px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
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
.orch-odg-nodename { font-size: var(--mk-fs-micro, 12px); font-weight: 600; color: var(--mk-ink); }
/* 审核 #117：.orch-odg-nodemeta 规则随节点内重复 agentId 一起删（列头已承接，类无消费者） */
.orch-odg-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-top: 2px; }
.orch-odg-chip {
  font-size: var(--mk-fs-micro, 12px); padding: 1px 6px;
  border-radius: var(--mk-radius-sm, 6px);
  background: var(--mk-surface-2, #eef2fa); color: var(--mk-muted); white-space: nowrap;
}
.orch-odg-chip--in { background: color-mix(in srgb, var(--mk-blue, #2f6ae0) 10%, transparent); color: var(--mk-accent-deep, #1f57cc); }
/* 审核 #119：--out 原继承 --mk-accent-deep 蓝字，与 --in 字色相同——绿底蓝字把「产出」读成可交互蓝。
   绿系 chip 字色改绿深档，让「蓝=入参/交互、绿=产出」在字色层也成立 */
.orch-odg-chip--out { background: color-mix(in srgb, var(--mk-green, #15803d) 12%, transparent); color: var(--mk-green, #15803d); }
.orch-odg-fields {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--mk-mono, Consolas, monospace);
  font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint);
}
/* 审核 #110：1440 档卡内可用宽约 1136px，而 5×232 + 4×100 = 1560 必横滚约 448px 才见第 4-5 列，
   卡题「管线总览 · 五阶段字段血缘」的全貌在标准视野内不成立。1599 档收窄列宽与列间距
   （5×196 + 4×48 + 24 ≈ 1196，接近卡宽；仍略超则保留少量内横滚）。1920 起沿用原全展开档。
   必须放在 .orch-odg-col 基规则之后：同特异性下按源序后者胜，否则 flex-basis 被 232px 覆盖 */
@media (max-width: 1599px) {
  .orch-odg-canvas { gap: 48px; }
  .orch-odg-col { flex-basis: 196px; }
}
</style>

