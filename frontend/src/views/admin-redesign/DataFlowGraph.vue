<template>
  <div class="dfg" :style="semanticVars">
    <MkLoading v-if="loading" />
    <MkEmptyState v-else-if="error" tone="error" :title="error" action-text="重试" @action="load" />

    <!-- 本阶段单独失败（其余阶段成功，故整体 error 不置位）：不能画成空白画布 + 「0 字段 · 0 步」，
         那与「这阶段真没数据」无从分辨。给失败态与重试入口。 -->
    <MkEmptyState
      v-else-if="!flow && stageErrors[active]"
      tone="error"
      :title="stageErrors[active]"
      description="本阶段的字段路由接口没有返回数据，其余阶段已加载，可重试。"
      action-text="重试"
      @action="load"
    />

    <!-- 工作区：工具栏 + 流水线画布 -->
    <div v-else class="dfg-frame">
      <div class="dfg-toolbar">
        <div class="dfg-toolbar__status">
          <span class="dfg-stage-dot" :style="{ background: toneOf(flow?.stageId || '').hue }"></span>
          <strong class="dfg-title">{{ flow?.stageName || '' }}<span class="dfg-title__agent mono"> {{ flow?.agentId }}</span></strong>
          <span class="dfg-meta">{{ flow ? flow.fieldCount : '—' }} 字段 · {{ flow ? flow.steps.length : '—' }} 步</span>
          <!-- 搜索命中反馈（审核 #114）：无命中此前与空闲态完全一致（画布原样、无提示），
               用户分不清「没这个字段」还是「搜索没生效」；有输入即报命中数，0 命中给醒目提示。
               清除入口复用搜索框右侧 ✕（v-if="query"） -->
          <span v-if="query.trim()" class="dfg-meta dfg-hitnote" :class="{ 'dfg-hitnote--none': !queryHitCount }">
            {{ queryHitCount ? `${queryHitCount} 个字段命中` : '无匹配字段' }}
          </span>
        </div>
        <div class="dfg-toolbar__controls">
          <div class="dfg-search">
            <input
              v-model="query"
              type="search"
              class="dfg-search__input"
              placeholder="搜索字段 / 数据族 / Skill"
              spellcheck="false"
              @input="onQueryInput"
            />
            <button v-if="query" type="button" class="dfg-search__clear" title="清除" @click="clearQuery">✕</button>
          </div>
          <label class="dfg-switch" title="显示流转中被隐藏的字段（对外不可见，含内部字段与累积字段）">
            <input type="checkbox" v-model="showHidden" />
            <span>隐藏字段</span>
          </label>
          <label class="dfg-switch" title="显示步间连线（默认淡显，聚焦时点亮）">
            <input type="checkbox" v-model="edgeFaded" />
            <span>连线</span>
          </label>
          <!-- 缩放读数（2026-10-13）：滚轮在画布上直接连续缩放（指针为锚点），拖动可平移；
               这里只显示当前比例，点它回 100% -->
          <button type="button" class="mk-btn mk-btn--sm dfg-zoom__val" title="当前缩放比例" @click="dfgZoom = 1">{{ Math.round(dfgZoom * 100) }}%</button>
        </div>
      </div>

      <!-- 图性质说明：本图是字段数据旅程（逻辑图·字段血缘），非拓扑图 -->
      <p class="dfg-caption">
        <strong>字段路由与流转</strong>
      </p>


      <!-- 缩放视口 + 内容层（2026-10-13 用户：字段旅程也要支持缩放）：
           视口（.dfg-view）承担滚动与阅读栏宽度，内容层（.dfg-pipe）承担网格排版并吃 zoom ——
           两者必须分开：直接 zoom 滚动容器会让视口跟着内容一起放大，永远没有可平移的余量
           （实测 150% 时视口可视宽 = 内容可视宽 = 1590，右侧直接溢出卡片）。
           滚轮缩放 / 拖动平移挂在视口上（指针所在的元素）。 -->
      <div
        ref="viewRef"
        class="dfg-view"
        :class="{ 'is-panning': dfgPanning }"
        @wheel.prevent="onDfgWheelZoom"
        @pointerdown="onDfgPointerDown"
        @pointermove="onDfgPointerMove"
        @pointerup="onDfgPointerUp"
        @pointercancel="onDfgPointerUp"
        @click.capture="onDfgClickCapture"
      >
      <div
        ref="pipeRef"
        class="dfg-pipe"
        :class="{ 'is-dimmed': !!focusKey }"
        :style="dfgZoomStyle"
      >
        <!-- 连线层（Bus 总线：卡右缘 → 右侧走廊 → 目标卡右缘，不穿卡片内容） -->
        <svg class="dfg-edges" :width="pipeW" :height="pipeH" aria-hidden="true">
          <g v-for="(e, i) in edgeGeoms" :key="i">
            <template v-if="e.d">
              <path
                :d="e.d"
                fill="none"
                :stroke="e.hue"
                :stroke-width="e.highlight ? 2.2 : 1.2"
                :opacity="e.op"
                :class="{ 'is-hot': e.highlight }"
                stroke-linecap="round"
              />
              <circle :cx="e.x1" :cy="e.y1" r="3" :fill="e.hue" :opacity="e.dotOp" />
              <path :d="e.arrow" :fill="e.hue" :opacity="e.dotOp" />
            </template>
          </g>
        </svg>

        <!-- 三段并列（2026-10-13 用户：核心是让运营可视化看到「本阶段和上下游的配合」）：
             上游（入口交接）｜ 本阶段（闸口 + 步骤链）｜ 下游（出口移交）。
             连线按「同列 → 右侧走廊 Bus、跨列 → 水平贝塞尔」自适配（见 renderEdges），
             所以窄档折回单列栈时不用另写一套路由。 -->
        <div class="dfg-cols">
        <div v-if="entryVisible.length" class="dfg-col dfg-col--up">
        <!-- ===== ① 入口交接（跨阶段输入） ===== -->
        <section v-if="flow && entryVisible.length" data-card-key="__entry__" class="dfg-gate dfg-gate--entry" :class="{ 'is-flash': flashKey === '__entry__' }" :style="{ '--hz': toneOf(flow.entryFrom?.stageId || '').hue }">
          <header class="dfg-gate__head">
            <span class="dfg-gate__icon">⇣</span>
            <div class="dfg-gate__title">
              <!-- 卡题即「切到对端阶段」入口（2026-10-13 删掉顶部概览条后把跳转能力挪到这里：
                   顶部那条与这两张卡是同一条事实的复读，而跳转是唯一不能跟着丢的能力） -->
              <button
                type="button"
                class="dfg-gate__src"
                :title="`前往 ${flow.entryFrom?.stageName}（${flow.entryFrom?.stageId}-agent），看这些字段在那边是怎么产出的`"
                @click="switchStage(flow.entryFrom!.stageId)"
              >入口 · 来自 {{ flow.entryFrom?.stageName }}<span class="dfg-gate__jump">↗</span></button>
              <span class="dfg-gate__sub">{{ entryVisible.length }} 个字段经 {{ flow.entryFrom?.stageId }}-agent 移交进入本阶段</span>
            </div>
            <span class="dfg-gate__count">{{ entryVisible.length }} 字段</span>
            <span v-for="p in farPorts['__entry__'] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
          </header>
          <div class="dfg-chips">
            <button
              v-for="c in entryShown"
              :key="`e-${c.id}`"
              type="button"
              class="dfg-chip"
              :class="chipClass(c, 'entry')"
              :style="{ '--hz': c.hue }"
              :data-chip-id="c.id"
              data-chip-role="entry"
              :title="chipTitle(c)"
              @click="openField(c)"
              @mouseenter="hoverChip = c.id"
              @mouseleave="hoverChip = ''"
            >
              <i class="dfg-chip__dot" :style="{ background: c.hue }"></i>
              <span class="dfg-chip__name mono">{{ c.short }}</span>
              <span v-if="c.valueType" class="dfg-chip__type">{{ c.valueType }}</span>
              <span v-if="c.accumulate" class="dfg-chip__flag dfg-chip__flag--accum" title="累积进学习者状态">累</span>
            </button>
            <!-- 折叠开关常显（审核 #99）：此前 v-if 只在折叠中渲染，展开后按钮消失 → 无法收起 -->
            <button v-if="entryVisible.length > ENTRY_LIMIT" type="button" class="dfg-chip dfg-chip--more" @click="expandedEntry = !expandedEntry">
              {{ expandedEntry ? '收起' : `+${entryVisible.length - ENTRY_LIMIT} 更多` }}
            </button>
          </div>
        </section>
        </div><!-- /上游列 -->

        <!-- ===== 中间：Agent 内部步骤链 ===== -->
        <div v-if="flowSteps.length" class="dfg-col dfg-col--main">
        <template v-for="step in flowSteps" :key="step.index">
          <!-- 桥接闸口（入口整装 / 分发） -->
          <section v-if="step.kind === 'bridge-entry' && step.outputChips.length" :data-card-key="step.agentId" class="dfg-step dfg-step--gate" :class="{ 'is-flash': flashKey === step.agentId }" :style="{ '--hz': toneOf(flow!.stageId).hue }">
            <header class="dfg-step__head">
              <span class="dfg-step__idx">⇡</span>
              <strong class="dfg-step__name">{{ step.name }}</strong>
              <span class="dfg-step__badge dfg-step__badge--gate">分发上游字段</span>
              <span class="dfg-step__agent mono">{{ step.agentId }}</span>
              <span class="dfg-step__spacer"></span>
              <span class="dfg-step__count">{{ step.outputChips.length }} 字段</span>
              <span v-for="p in farPorts[step.agentId] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
            </header>
            <div class="dfg-step__body">
              <p class="dfg-step__note">上游字段在此重命名后分发给内部 Skill</p>
              <div class="dfg-chips" :data-gate-anchor="step.agentId">
                <button
                  v-for="c in stepShown(step, 'out')"
                  :key="`g-${c.id}`"
                  type="button"
                  class="dfg-chip"
                  :class="chipClass(c, 'gate')"
                  :style="{ '--hz': c.hue }"
                  :data-chip-id="c.id"
                  data-chip-role="gate"
                  :title="chipTitle(c)"
                  @click="openField(c)"
                  @mouseenter="hoverChip = c.id"
                  @mouseleave="hoverChip = ''"
                >
                  <i class="dfg-chip__dot" :style="{ background: c.hue }"></i>
                  <span class="dfg-chip__name mono">{{ c.short }}</span>
                  <span v-if="c.internal" class="dfg-chip__flag" title="内部字段">内</span>
                  <span v-if="c.handoffTargets.length" class="dfg-chip__to mono">{{ c.toTags.length ? c.toTags[0].label : c.handoffTargets[0] }}<template v-if="c.handoffTargets.length > 1"> +{{ c.handoffTargets.length - 1 }}</template></span>
                </button>
                <button v-if="stepOverflow(step, 'out')" type="button" class="dfg-chip dfg-chip--more" @click="toggleStep(step)">
                  {{ expandedSteps.has(step.agentId) ? '收起' : `+${stepFolded(step, 'out')} 更多` }}
                </button>
              </div>
            </div>
          </section>

          <!-- 服务 / 跨阶段 / 无契约 Skill 步骤（无字段契约，如实展示） -->
          <section v-else-if="step.kind === 'service' || step.kind === 'cross-agent' || step.kind === 'orphan'" :data-card-key="step.agentId" class="dfg-step dfg-step--bare" :class="{ 'is-unresolved': step.unresolved, 'is-orphan': step.kind === 'orphan', 'is-flash': flashKey === step.agentId }">
            <header class="dfg-step__head">
              <span class="dfg-step__idx">{{ step.index }}</span>
              <strong class="dfg-step__name">{{ step.name }}</strong>
              <span
                v-if="step.kind !== 'orphan'"
                class="dfg-step__badge"
                :class="step.kind === 'service' ? 'dfg-step__badge--svc' : 'dfg-step__badge--cross'"
              >{{ step.kind === 'service' ? '代码服务' : '跨阶段引用' }}</span>
              <span v-else class="dfg-step__badge dfg-step__badge--warn" title="该 Skill 已注册，但没有声明任何字段的产出与输入，未接入数据流转">无字段路由</span>
              <span v-if="step.unresolved" class="dfg-step__badge dfg-step__badge--warn" :title="UNRESOLVED_HINT">未解析</span>
              <span v-if="step.fromStage" class="dfg-step__stage mono" @click="switchStage(step.fromStage!)" title="跳到该阶段">→ {{ stageNameOf(step.fromStage) }}</span>
              <span v-if="step.role" class="dfg-step__role">{{ step.role }}</span>
              <template v-if="step.kind === 'orphan'">
                <span class="dfg-step__agent mono">{{ step.agentId }}</span>
              </template>
              <span class="dfg-step__spacer"></span>
              <span v-if="step.condition" class="dfg-step__cond" :title="step.condition">触发：{{ step.condition }}</span>
              <span v-if="step.loopOver" class="dfg-step__cond">循环：{{ step.loopOver }}</span>
              <span v-if="step.kind === 'orphan'" class="dfg-step__count" title="该 Skill 没有字段的路由记录，不参与阶段内数据流转">无字段流转</span>
              <span v-for="p in farPorts[step.agentId] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
            </header>
          </section>

          <!-- Skill 步骤卡 -->
          <section v-else :data-card-key="step.agentId" class="dfg-step" :class="{ 'has-inputs': step.inputChips.length, 'is-flash': flashKey === step.agentId }" :style="{ '--hz': stepHue(step) }">
            <header class="dfg-step__head">
              <span class="dfg-step__idx">{{ step.index }}</span>
              <strong class="dfg-step__name">{{ step.name }}</strong>
              <span class="dfg-step__badge">Skill</span>
              <span v-if="step.unresolved" class="dfg-step__badge dfg-step__badge--warn" :title="UNRESOLVED_HINT">未解析</span>
              <span class="dfg-step__agent mono">{{ step.agentId }}</span>
              <span class="dfg-step__spacer"></span>
              <span v-if="step.condition" class="dfg-step__cond" :title="step.condition">触发：{{ step.condition }}</span>
              <span v-if="step.loopOver" class="dfg-step__cond">循环：{{ step.loopOver }}</span>
              <span class="dfg-step__count">{{ step.outputChips.length }} 产出</span>
              <span v-for="p in farPorts[step.agentId] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
            </header>
            <div class="dfg-step__body">
              <!-- 流入 -->
              <div v-if="step.inputChips.length" class="dfg-step__rows">
                <div class="dfg-step__row">
                  <span class="dfg-step__rowlabel">流入</span>
                  <div class="dfg-chips">
                    <button
                      v-for="c in stepShown(step, 'in')"
                      :key="`in-${c.id}`"
                      type="button"
                      class="dfg-chip dfg-chip--in"
                      :class="chipClass(c, 'in')"
                      :style="{ '--hz': c.hue }"
                      :data-chip-id="c.id"
                      data-chip-role="in"
                      :title="`${chipTitle(c)}\n来源：${c.agentId}`"
                      @click="openField(c)"
                      @mouseenter="hoverChip = c.id"
                      @mouseleave="hoverChip = ''"
                    >
                      <i class="dfg-chip__dot" :style="{ background: c.hue }"></i>
                      <span class="dfg-chip__name mono">{{ c.short }}</span>
                      <span v-if="c.internal" class="dfg-chip__flag" title="内部字段">内</span>
                      <span v-if="c.accumulate" class="dfg-chip__flag dfg-chip__flag--accum" title="累积进学习者状态">累</span>
                    </button>
                    <button v-if="stepOverflow(step, 'in')" type="button" class="dfg-chip dfg-chip--more" @click="toggleStep(step)">
                      {{ expandedSteps.has(step.agentId) ? '收起' : `+${stepFolded(step, 'in')} 更多` }}
                    </button>
                  </div>
                </div>
              </div>
              <!-- 产出 -->
              <div v-if="step.outputChips.length" class="dfg-step__rows">
                <div class="dfg-step__row">
                  <span class="dfg-step__rowlabel">产出</span>
                  <div class="dfg-chips">
                    <button
                      v-for="c in stepShown(step, 'out')"
                      :key="`out-${c.id}`"
                      type="button"
                      class="dfg-chip"
                      :class="chipClass(c, 'out')"
                      :style="{ '--hz': c.hue }"
                      :data-chip-id="c.id"
                      data-chip-role="out"
                      :title="chipTitle(c)"
                      @click="openField(c)"
                      @mouseenter="hoverChip = c.id"
                      @mouseleave="hoverChip = ''"
                    >
                      <i class="dfg-chip__dot" :style="{ background: c.hue }"></i>
                      <span class="dfg-chip__name mono">{{ c.short }}</span>
                      <span v-if="c.internal" class="dfg-chip__flag" title="内部字段">内</span>
                      <span v-if="c.accumulate" class="dfg-chip__flag dfg-chip__flag--accum" title="累积进学习者状态">累</span>
                      <template v-if="c.toTags.length">
                        <span
                          v-for="t in c.toTags.slice(0, 2)"
                          :key="t.target"
                          class="dfg-chip__to mono"
                          :class="{ 'dfg-chip__to--stage': t.kind === 'stage' }"
                        >{{ t.kind === 'stage' ? `→ ${t.label}` : `→ ${t.label}` }}</span>
                      </template>
                    </button>
                    <button v-if="stepOverflow(step, 'out')" type="button" class="dfg-chip dfg-chip--more" @click="toggleStep(step)">
                      {{ expandedSteps.has(step.agentId) ? '收起' : `+${stepFolded(step, 'out')} 更多` }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
        </div><!-- /本阶段列 -->

        <!-- ===== ② 出口移交（跨阶段输出） ===== -->
        <div v-if="flow && flow.exit.length" class="dfg-col dfg-col--down">
        <section v-if="flow && flow.exit.length" data-card-key="__exit__" class="dfg-gate dfg-gate--exit" :class="{ 'is-flash': flashKey === '__exit__' }" :style="{ '--hz': toneOf(flow.exitTo?.stageId || '').hue }">
          <header class="dfg-gate__head">
            <span class="dfg-gate__icon">⇢</span>
            <div class="dfg-gate__title">
              <button
                type="button"
                class="dfg-gate__src"
                :title="`前往 ${flow.exitTo?.stageName}（${flow.exitTo?.stageId}-agent），看这些字段在那边是怎么被消费的`"
                @click="switchStage(flow.exitTo!.stageId)"
              >出口 · 交给 {{ flow.exitTo?.stageName }}<span class="dfg-gate__jump">↗</span></button>
              <span class="dfg-gate__sub">{{ flow.agentId }} 汇总 {{ flow.exit.length }} 个字段，整体移交下一阶段</span>
            </div>
            <span class="dfg-gate__count">{{ flow.exit.length }} 字段</span>
            <span v-for="p in farPorts['__exit__'] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)">来自 {{ p.peerLabel }}<b>{{ p.count }}</b></span>
          </header>
          <div class="dfg-chips">
            <button
              v-for="c in exitShown"
              :key="`x-${c.id}`"
              type="button"
              class="dfg-chip"
              :class="chipClass(c, 'exit')"
              :style="{ '--hz': c.hue }"
              :data-chip-id="c.id"
              data-chip-role="exit"
              :title="chipTitle(c)"
              @click="openField(c)"
              @mouseenter="hoverChip = c.id"
              @mouseleave="hoverChip = ''"
            >
              <i class="dfg-chip__dot" :style="{ background: c.hue }"></i>
              <span class="dfg-chip__name mono">{{ c.short }}</span>
              <span v-if="c.valueType" class="dfg-chip__type">{{ c.valueType }}</span>
              <span v-if="c.internal" class="dfg-chip__flag" title="内部字段">内</span>
              <span v-if="c.accumulate" class="dfg-chip__flag dfg-chip__flag--accum" title="累积进学习者状态">累</span>
            </button>
            <!-- 折叠开关常显（审核 #99）：此前 v-if 只在折叠中渲染，展开后按钮消失 → 无法收起 -->
            <button v-if="(flow?.exit.length || 0) > ENTRY_LIMIT" type="button" class="dfg-chip dfg-chip--more" @click="expandedExit = !expandedExit">
              {{ expandedExit ? '收起' : `+${(flow?.exit.length || 0) - ENTRY_LIMIT} 更多` }}
            </button>
          </div>
        </section>
        </div><!-- /下游列 -->
        </div><!-- /三段并列 -->

        <!-- 空态：原型 .empty 词表（图标 + 结论 + 说明 + 行动入口），不再裸一句话 -->
        <MkEmptyState
          v-if="flow && !flow.steps.length && !flow.entry.length && !flow.exit.length"
          icon="⇅"
          title="该阶段暂无字段路由数据"
          description="编排文件未声明字段路由，可在「字段路由」页编辑编排文件后回来。"
          action-text="刷新"
          compact
          @action="load"
        />
      </div>
      </div>
    </div>

    <!-- 数据族图例 -->
    <div v-if="flow && flow.families.length" class="dfg-legend" :class="{ 'is-dimmed': !!focusKey && !familyFocus }">
      <button
        v-for="f in flow.families.slice(0, 12)"
        :key="f.name"
        type="button"
        class="dfg-legend__item"
        :class="{ 'is-on': familyFocus === f.name }"
        @click="toggleFamily(f.name)"
        @mouseenter="hoverFamily = f.name"
        @mouseleave="hoverFamily = ''"
      >
        <i :style="{ background: f.hue }"></i>{{ f.name }}<b>{{ f.count }}</b>
      </button>
    </div>

    <!-- 字段详情抽屉（含行级编辑，同步回写编排文件） -->
    <Teleport to="body">
      <div v-if="selected" class="mk-drawer">
        <!-- 遮罩关闭走 useMaskClose（按下-松开守卫）：防在抽屉内选中文本/拖动画布到遮罩松手误关 -->
        <div ref="maskRef" class="mk-drawer__mask" @click="selected = null"></div>
        <!-- 模态语义（审核 #95）：useOverlay 统一提供锁滚 + aria-modal + 聚焦面板 + Tab 陷阱 + 关闭回焦
             （与 FieldRoutingTable 编排文件弹窗同款接法） -->
        <aside ref="drawerPanelRef" class="mk-drawer__panel dfg-drawer" role="dialog" aria-label="字段详情" :style="semanticVars">
          <header class="mk-drawer__head">
            <div class="mk-drawer__heading">
              <h3 class="mk-drawer__title mono">{{ selected.fieldId }}</h3>
              <p class="mk-drawer__sub">{{ selected.description || '—' }}</p>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="selected = null">✕</button>
          </header>

          <div class="dfg-drawer__body">
            <!-- 首段徽章行（原型 .ovl__body 首段 pills）：角色 / 可见性 / 锁定 / 内部信令 / 累积，均为字段既有属性 -->
            <div class="dfg-drawer__pills">
              <span class="mk-badge" :class="`mk-badge--role-${selected.role}`">{{ roleLabel(selected.role) }}（{{ selected.role }}）</span>
              <span class="mk-badge" :class="`mk-badge--render-${selected.render}`">{{ selected.render }}</span>
              <span class="mk-badge" :class="`mk-badge--lock-${selected.lockLevel}`">{{ lockLabel(selected.lockLevel) }}</span>
              <span v-if="selected.internal" class="mk-badge dfg-badge--internal">内部字段</span>
              <span v-if="selected.accumulate" class="mk-badge dfg-badge--accum">累积进学习者状态</span>
            </div>

            <!-- 事实清单（原型 dl.kv：96px 标签列不画线，值可嵌徽标；dfg- 保留字段着色块） -->
            <div class="mk-facts mk-facts--rows">
              <div>
                <span>产出方</span>
                <strong class="mono">{{ selected.agentId }}</strong>
              </div>
              <div>
                <span>数据族</span>
                <strong>
                  <span class="dfg-dl__family" :style="{ background: selected.hue }"></span>{{ selected.family }}
                </strong>
              </div>
              <div>
                <span>类型</span>
                <dd class="mono">{{ selected.valueType || '—' }}</dd>
              </div>
              <div>
                <span>存储字段名</span>
                <strong class="mono">{{ selected.persistKey || selected.fieldId }}</strong>
              </div>
              <div v-if="selected.pathInRawOutput">
                <span>抽取路径</span>
                <strong class="mono">{{ selected.pathInRawOutput }}</strong>
              </div>
              <div v-if="selected.notes">
                <span>备注</span>
                <strong>{{ selected.notes }}</strong>
              </div>
            </div>

            <!-- 数据旅程：裸分组改走区块文法（原型 section = 区块头 + 内容，不再自绘虚线框） -->
            <section class="dfg-section">
              <header class="mk-section__head"><h4>数据旅程</h4></header>
              <div class="dfg-flow__list">
                <span class="dfg-flow__chip">{{ journeyOf('producer') }}</span>
                <span class="dfg-flow__arrow">→</span>
                <template v-if="journeyOf('consumers').length">
                  <span v-for="c in journeyOf('consumers')" :key="c" class="dfg-flow__chip dfg-flow__chip--soft mono">{{ c }}</span>
                  <span class="dfg-flow__arrow">→</span>
                  <span class="dfg-flow__chip dfg-flow__chip--out">{{ journeyOf('handoff') }}</span>
                </template>
                <span v-else class="dfg-flow__chip dfg-flow__chip--out">{{ journeyOf('handoff') }}</span>
              </div>
              <p class="dfg-flow__hint">{{ journeyHint() }}</p>
            </section>

            <!-- 行级编辑：嵌套无边框卡（原型 .card box-shadow:none + card__head/card__body，内为 field 式表单行） -->
            <section v-if="!selected.locked" class="mk-card">
              <div class="mk-card__head">
                <h4 class="mk-card__title">行级编辑</h4>
                <span class="mk-card__meta">会同步回写编排文件</span>
              </div>
              <div class="dfg-edit">
                <div class="dfg-field">
                  <span class="dfg-field__label">可见性</span>
                  <span class="dfg-edit__pills">
                    <button type="button" class="dfg-pill" :class="{ 'is-on': editDraft.render === 'visible' }" @click="editDraft.render = 'visible'">可见</button>
                    <button type="button" class="dfg-pill" :class="{ 'is-on': editDraft.render === 'hidden' }" @click="editDraft.render = 'hidden'">隐藏</button>
                  </span>
                </div>
                <div class="dfg-field">
                  <label class="dfg-field__label" for="dfg-handoff">移交</label>
                  <input id="dfg-handoff" v-model="editDraft.handoffText" class="dfg-edit__input mono" placeholder="阶段名 / skill:id / agent，逗号分隔，留空则不转交" spellcheck="false" />
                </div>
                <div class="dfg-field">
                  <span class="dfg-field__label">累积</span>
                  <label class="dfg-check"><input type="checkbox" v-model="editDraft.accumulate" /><span>累积进学习者状态</span></label>
                </div>
                <div class="dfg-field">
                  <span class="dfg-field__label">内部</span>
                  <label class="dfg-check"><input type="checkbox" v-model="editDraft.internal" /><span>仅供平台内部使用</span></label>
                </div>
                <div class="dfg-field">
                  <label class="dfg-field__label" for="dfg-edit-notes">备注</label>
                  <input id="dfg-edit-notes" v-model="editDraft.notes" class="dfg-edit__input" placeholder="备注（可选）" spellcheck="false" />
                </div>
                <p v-if="editMsg" class="dfg-edit__msg" :class="{ 'is-error': editError }">{{ editMsg }}</p>
              </div>
            </section>
            <!-- 锁定字段：原型 .note 语气（只读说明，不给编辑表单） -->
            <p v-else class="dfg-note">该字段为平台锁定：属性由编排文件或平台自动生成，请使用「编排文件」入口修改。</p>
          </div>

          <!-- 底部动作（原型 .ovl__foot：取消在左、主钮右、常驻滚动区外）：编辑动作自表单尾部上提，
               正文只滚内容、保存/还原不随长 kv 滚走 -->
          <footer class="mk-drawer__foot">
            <button type="button" class="mk-btn" @click="selected = null">关闭</button>
            <template v-if="!selected.locked">
              <button type="button" class="mk-btn" :disabled="saving" @click="resetDraft">还原</button>
              <button type="button" class="mk-btn mk-btn--primary" :disabled="saving || !dirty" @click="saveEdit">
                {{ saving ? '保存中…' : '保存修改' }}
              </button>
            </template>
          </footer>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { adminFieldRoutingsApi, adminRuntimeDefinitionsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import { ensureLiveTopologyRaw } from './live'
import {
  buildStageFlow, familyHue, type FlowChip, type FlowStep, type StageFlow, type DefStepLike,
  STAGE_ORDER, STAGE_LABELS,
} from './dataFlow'
import type { StageDetailLike } from './fieldFlowLayout'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { AGENT_TONES } from './store'

/* ================= props / emits（与 FieldFlowGraph 同接口，Orchestrator 无缝替换） ================= */
const props = defineProps<{ stage: string }>()
const emit = defineEmits<{ changed: []; stage: [string] }>()

/* 文案单源（R6 复读单源化）：工具步骤卡与 Skill 步骤卡的「未解析」悬停释共用一份 */
const UNRESOLVED_HINT = '编排文件里没有解析到这一步的定义'

/* ================= 状态 ================= */
const loading = ref(false)
const error = ref('')
const detailByStage = ref<Record<string, StageDetailLike | null>>({})
/** 逐阶段失败原因：五阶段并发拉取时只要有一个失败就记在这里（此前只留 firstErr，
    且只有「五个全失败」才置整体 error，单个阶段失败会画成空白画布）。 */
const stageErrors = ref<Record<string, string>>({})
const orchDefs = ref<Record<string, DefStepLike[]>>({})
const stageNames = ref<Record<string, string>>({})
const showHidden = ref(false)
const edgeFaded = ref(true) // 默认淡化连线（悬停/聚焦点亮）；关 = 不画步间连线（端口徽标仍可用）
const query = ref('')
const selected = ref<FlowChip | null>(null)
const saving = ref(false)
const editMsg = ref('')
const editError = ref(false)
const editDraft = reactive({ render: 'visible', handoffText: '', accumulate: false, internal: false, notes: '' })

/** 旅程聚焦：悬停 / 搜索 / 数据族高亮（同字段链 + 同族字段不压暗） */
const hoverChip = ref('')
const hoverFamily = ref('')
const familyFocus = ref('')
const focusKey = computed(() => query.value.trim() || hoverChip.value || familyFocus.value)

/* ================= 数据加载 ================= */
async function load() {
  loading.value = true
  error.value = ''
  try {
    /* 拓扑走 live 层共享获取（ensureLiveTopologyRaw）：与 boot 的 topology 域共用同一
       请求/缓存——此前本组件每次 load（切阶段/flowKey 重挂载都会触发）都独立拉一遍
       同一接口，重口径下成倍放大编排页加载时间。
       2026-09-28 去调用统计后拓扑响应已是纯定义；这里只为触发共享缓存（Orchestrator
       的阶段/成员清单同样消费它），本组件不再读返回体。 */
    const [stagesRes, defRes] = await Promise.all([
      adminFieldRoutingsApi.getStages().catch(() => null),
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions().catch(() => null),
      ensureLiveTopologyRaw().catch(() => ({} as Record<string, unknown>)),
    ])
    const stagesBody = stagesRes?.data?.data as { stages?: Array<{ id: string; displayName: string }> } | undefined
    if (stagesBody?.stages?.length) {
      stageNames.value = Object.fromEntries(stagesBody.stages.map((s) => [s.id, (s.displayName || '').replace(/阶段$/, '')]))
    }
    const orchBody = defRes?.data?.data ?? defRes?.data ?? []
    const orchItems = Array.isArray(orchBody) ? orchBody : orchBody.items || orchBody.orchestrators || []
    const defMap: Record<string, DefStepLike[]> = {}
    for (const o of orchItems as Array<Record<string, unknown>>) {
      const steps = (o.steps || []) as DefStepLike[]
      if (o.id) defMap[String(o.id)] = steps
    }
    orchDefs.value = defMap

    const results = await Promise.allSettled(
      STAGE_ORDER.map(async (s) => {
        const res = await adminFieldRoutingsApi.getStageDetail(s)
        return { stage: s, detail: (res.data?.data as StageDetailLike) || null }
      })
    )
    const next: Record<string, StageDetailLike | null> = {}
    const errs: Record<string, string> = {}
    let firstErr = ''
    results.forEach((r, i) => {
      const s = STAGE_ORDER[i]
      if (r.status === 'fulfilled') {
        next[s] = r.value.detail
      } else {
        next[s] = null
        const msg = (r.reason as any)?.response?.data?.error?.message || (r.reason as any)?.message || `阶段 ${s} 加载失败`
        errs[s] = msg
        if (!firstErr) firstErr = msg
      }
    })
    detailByStage.value = next
    stageErrors.value = errs
    if (!Object.values(next).some((d) => d)) error.value = firstErr || '字段流转加载失败'
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message || e?.message || '字段流转加载失败'
  } finally {
    loading.value = false
  }
}
watch(() => props.stage, () => { selected.value = null; void load() }, { immediate: true })

/* ================= 组装（flow 重算由 computed 驱动，保存后 +1 触发刷新） ================= */
const flowKey = ref(0)
defineExpose({
  reload: load,
  bump: () => { flowKey.value++; void load() },
})
function onRoutingChanged() {
  emit('changed')
  void load()
}

const flows = computed<Record<string, StageFlow>>(() => {
  void flowKey.value
  const names = stageNames.value
  const defByAgent = orchDefs.value
  const out: Record<string, StageFlow> = {}
  for (const sid of STAGE_ORDER) {
    const d = detailByStage.value[sid]
    if (!d) continue
    out[sid] = buildStageFlow(sid, d, detailByStage.value, defByAgent[`${sid}-agent`] || [], names)
  }
  return out
})

const active = ref(props.stage)
const flow = computed<StageFlow | undefined>(() => flows.value[active.value] || flows.value[props.stage])
watch(() => props.stage, (s) => { if (s) active.value = s }, { immediate: true })

function switchStage(id: string) {
  if (id === active.value) return
  active.value = id
  emit('stage', id)
  query.value = ''
  focusId.value = ''
  selected.value = null
}

/* ================= 角色词表（后端 promptRoleMeta，多阶段同源） ================= */
const roleMeta = computed(() => {
  for (const s of STAGE_ORDER) {
    const meta = (detailByStage.value[s] as any)?.promptRoleMeta
    if (meta?.length) return meta
  }
  return []
})
function roleLabel(role: string) {
  const m = roleMeta.value.find((r: { id: string }) => r.id === role)
  return m?.label || role
}
function lockLabel(level?: string) {
  if (level === 'system-locked') return '平台锁定'
  if (level === 'structure-locked') return '平台锁定'
  return '可编辑'
}
function stageNameOf(id: string) {
  return stageNames.value[id] || STAGE_LABELS[id] || id
}
function toneOf(id: string) {
  return AGENT_TONES[`${id}-agent`] || { hue: '#64748b', soft: 'rgba(100,116,139,0.08)' }
}

/** 数据族语义色注入：值取自 dataFlow.ts 的 familyHue（唯一源 = FAMILY_COLORS），
 *  CSS 以 var(--fam-*) 消费，消除组件内二次硬编码字面量。 */
const semanticVars: Record<string, string> = {
  '--fam-path': familyHue('path'),                    // 数据起点 / 路径
  '--fam-classroom': familyHue('classroomContext'),   // 数据终点 / 内部信令
  '--fam-understanding': familyHue('understanding'),  // 上游交接
  '--fam-core': familyHue('core'),                    // 中性兜底
  '--fam-knowledge': familyHue('knowledge'),          // 累积 / 知识
}

/* ================= 可见性与折叠 ================= */
/** 步骤卡 + 可见芯片副本（flowSteps 元素类型；模板 / 折叠 / 轨道线共用） */
type WalkStep = FlowStep & {
  inputChips: FlowChip[]
  outputChips: FlowChip[]
  chips: FlowChip[]
}
function visibleChips(chips: FlowChip[]) {
  return showHidden.value ? chips : chips.filter((c) => c.render === 'visible' || c.handoffTargets.length > 0 || c.accumulate)
}
const ENTRY_LIMIT = 8
const OUTPUT_LIMIT = 8
const INPUT_LIMIT = 6
/* 入口/出口折叠状态各自独立（审核 #99）：此前两处共用 expandedEntry，点任一处会同时展开另一处 */
const expandedEntry = ref(false)
const expandedExit = ref(false)
const expandedSteps = ref<Set<string>>(new Set())
function toggleStep(step: WalkStep) {
  const next = new Set(expandedSteps.value)
  if (next.has(step.agentId)) next.delete(step.agentId)
  else next.add(step.agentId)
  expandedSteps.value = next
}
/** 卡内输入/输出截断：展开返回全量，否则保留前 N + 「+M 更多」 */
function stepShown(step: WalkStep, which: 'in' | 'out') {
  const chips = which === 'in' ? step.inputChips : step.outputChips
  if (expandedSteps.value.has(step.agentId)) return chips
  return chips.slice(0, which === 'in' ? INPUT_LIMIT : OUTPUT_LIMIT)
}
function stepFolded(step: WalkStep, which: 'in' | 'out') {
  if (expandedSteps.value.has(step.agentId)) return 0
  const chips = which === 'in' ? step.inputChips : step.outputChips
  return Math.max(0, chips.length - (which === 'in' ? INPUT_LIMIT : OUTPUT_LIMIT))
}
/** 是否超过折叠阈值（与展开态无关）：折叠开关的显示条件，保证展开后按钮仍在、可收起（审核 #99） */
function stepOverflow(step: WalkStep, which: 'in' | 'out') {
  const chips = which === 'in' ? step.inputChips : step.outputChips
  return chips.length > (which === 'in' ? INPUT_LIMIT : OUTPUT_LIMIT)
}

const entryVisible = computed(() => visibleChips(flow.value?.entry || []))
const entryShown = computed(() => (expandedEntry.value ? entryVisible.value : entryVisible.value.slice(0, ENTRY_LIMIT)))
const exitShown = computed(() => (expandedExit.value ? flow.value?.exit || [] : (flow.value?.exit || []).slice(0, ENTRY_LIMIT)))

/* ================= 步骤卡芯片（过滤 + 折叠后） ================= */

/** 步骤 + 可见芯片副本（模板直接使用；filter 与折叠状态驱动轨道线重算） */
const flowSteps = computed(() => {
  const f = flow.value
  if (!f) return []
  return f.steps.map((s) => {
    const inputChips = visibleChips(s.inputs)
    const outputChips = visibleChips(s.outputs)
    return {
      ...s,
      inputChips,
      outputChips,
      chips: [...inputChips, ...outputChips],
    }
  })
})

/* ================= 行程高亮 ================= */
const focusId = ref('')
function relatedOf(c: FlowChip | null): Set<string> {
  const set = new Set<string>()
  if (!c) return set
  set.add(c.id)
  // 同字段全部副本（入口/闸口/输入/产出/出口）
  for (const s of flowSteps.value) {
    for (const x of [...s.inputChips, ...s.outputChips]) if (x.fieldId === c.fieldId) set.add(x.id)
  }
  for (const x of entryVisible.value) if (x.fieldId === c.fieldId) set.add(x.id)
  for (const x of flow.value?.exit || []) if (x.fieldId === c.fieldId) set.add(x.id)
  return set
}
const relatedIds = computed(() => {
  if (familyFocus.value) return new Set<string>()
  const c = flowSteps.value.flatMap((s) => [...s.inputChips, ...s.outputChips]).find((x) => x.id === focusId.value)
    || entryVisible.value.find((x) => x.id === focusId.value)
    || flow.value?.exit.find((x) => x.id === focusId.value)
    || null
  return relatedOf(c)
})
function chipClass(c: FlowChip, role: string) {
  const focused = focusId.value && focusId.value === c.id
  const sameField = focusId.value && relatedIds.value.has(c.id)
  const famHit = familyFocus.value && c.family === familyFocus.value
  const hoverHit = hoverChip.value && hoverChip.value === c.id
  return {
    'is-family': famHit,
    'is-focused': focused || hoverHit,
    'is-related': sameField || famHit || hoverHit,
    'is-dimmed': (!!focusId.value && !sameField && !focused)
      || (!!familyFocus.value && !famHit)
      || (!!hoverChip.value && hoverChip.value !== c.id && !sameField),
    'is-inner': role === 'in',
    'is-exit': role === 'exit',
    'is-entry': role === 'entry',
  }
}
function chipMatchesQuery(c: FlowChip, q: string): boolean {
  return c.fieldId.toLowerCase().includes(q) ||
    c.family.toLowerCase().includes(q) ||
    c.agentId.toLowerCase().includes(q) ||
    c.description.toLowerCase().includes(q) ||
    (c.persistKey || '').toLowerCase().includes(q)
}
/** 搜索命中字段数（审核 #114：工具栏可见反馈，0 命中显「无匹配字段」；未搜索时为 0 且不渲染） */
const queryHitCount = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return 0
  return flowSteps.value.flatMap((s) => [...s.inputChips, ...s.outputChips]).filter((c) => chipMatchesQuery(c, q)).length
})
function onQueryInput() {
  const q = query.value.trim().toLowerCase()
  if (!q) { focusId.value = ''; return }
  const all = flowSteps.value.flatMap((s) => [...s.inputChips, ...s.outputChips])
  const hit = all.find((c) => chipMatchesQuery(c, q))
  if (hit) {
    focusId.value = hit.id
    const step = flowSteps.value.find((s) => [...s.inputChips, ...s.outputChips].some((x) => x.id === hit.id))
    if (step) {
      const next = new Set(expandedSteps.value)
      next.add(step.agentId)
      expandedSteps.value = next
    }
  } else {
    focusId.value = ''
  }
}
function clearQuery() {
  query.value = ''
  focusId.value = ''
}
function toggleFamily(name: string) {
  familyFocus.value = familyFocus.value === name ? '' : name
  focusId.value = ''
}

/* ================= 轨道线（SVG：实测 DOM 位置，Bus 总线端口路由） ================= */
const viewRef = ref<HTMLElement | null>(null)   // 滚动视口（缩放/平移的宿主）
const pipeRef = ref<HTMLElement | null>(null)   // 内容层（网格排版 + zoom）
const pipeW = ref(0)
const pipeH = ref(0)
const edgeGeoms = ref<EdgeGeom[]>([])

/* ===== 画布缩放（2026-10-13 用户：字段旅程也要支持缩放）=====
   zoom 套在**内容层**（.dfg-pipe）而不是滚动视口上：zoom 参与布局，套在视口上会让视口可视宽
   跟着内容一起放大（实测 150% 时视口 1590 = 内容 1590），右侧溢出卡片且没有可平移余量。
   语义同总览画布（见 Orchestrator.vue）：**指定 px = 层自有宽，肉眼宽 = 自有宽 × zoom**，
   所以内容层的宽度必须由 JS 给「基准宽」的 px（width:auto / 100% 会被父级可视宽钉住，
   放大时卡片文字涨、卡片框不涨 → 文字溢框）。
   坐标换算（measure）：实测 rect 是**视口可视 px**，而 SVG 与列坐标都在层自有 px 里，
   所以整套量测除以 zoom；滚动量也在视口 px 里，同除。 */
const DFG_ZOOM_MIN = 0.25
const DFG_ZOOM_MAX = 3
const DFG_ZOOM_WHEEL_K = 0.0015
const dfgZoom = ref(1)
/** 内容层基准宽（= 100% 时视口内容宽）；只在量得到宽度时更新 */
const dfgBaseW = ref(0)
const dfgZoomStyle = computed(() => ({
  zoom: String(dfgZoom.value),
  width: dfgBaseW.value ? `${dfgBaseW.value}px` : undefined,
}))
function sampleDfgBaseW() {
  const view = viewRef.value
  if (!view || !view.clientWidth) return
  const cs = getComputedStyle(view)
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  dfgBaseW.value = Math.max(0, Math.round(view.clientWidth - pad))
}
/** 滚轮缩放：连续无档位，以指针为锚点（锚点用「视口滚动量 + 层自有坐标」换算，
    缩放前后让指针下的那一点停在原地） */
async function onDfgWheelZoom(e: WheelEvent) {
  const view = viewRef.value
  if (!view) return
  const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
  const before = dfgZoom.value
  dfgZoom.value = Math.min(DFG_ZOOM_MAX, Math.max(DFG_ZOOM_MIN, before * Math.exp(-raw * DFG_ZOOM_WHEEL_K)))
  const next = dfgZoom.value
  if (next === before) return
  const r0 = view.getBoundingClientRect()
  const px = (e.clientX - r0.left + view.scrollLeft) / before
  const py = (e.clientY - r0.top + view.scrollTop) / before
  await nextTick()
  const r1 = view.getBoundingClientRect()
  view.scrollLeft = px * next - (e.clientX - r1.left)
  view.scrollTop = py * next - (e.clientY - r1.top)
}

/* 抓取式拖动平移：放大后视口两轴都有滚动范围（overflow: auto 由视口给） */
const dfgPanning = ref(false)
let dfgPanStart: { x: number; y: number; left: number; top: number; id: number; moved: boolean } | null = null
/* 拖动后浏览器仍会补发一次 click（落点可能在某枚字段芯片上）→ 捕获阶段吞掉，避免误开字段抽屉 */
let dfgSuppressClick = false
function onDfgPointerDown(e: PointerEvent) {
  const view = viewRef.value
  if (!view || e.button !== 0 || e.pointerType === 'touch') return
  dfgPanStart = { x: e.clientX, y: e.clientY, left: view.scrollLeft, top: view.scrollTop, id: e.pointerId, moved: false }
}
function onDfgPointerMove(e: PointerEvent) {
  const view = viewRef.value
  if (!view || !dfgPanStart || e.pointerId !== dfgPanStart.id) return
  const dx = e.clientX - dfgPanStart.x
  const dy = e.clientY - dfgPanStart.y
  if (!dfgPanStart.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 4) return
    dfgPanStart.moved = true
    dfgPanning.value = true
    window.getSelection()?.removeAllRanges()
  }
  view.scrollLeft = dfgPanStart.left - dx
  view.scrollTop = dfgPanStart.top - dy
  e.preventDefault()
}
function onDfgPointerUp(e: PointerEvent) {
  if (!dfgPanStart || e.pointerId !== dfgPanStart.id) return
  const moved = dfgPanStart.moved
  dfgPanStart = null
  dfgPanning.value = false
  if (moved) {
    dfgSuppressClick = true
    window.setTimeout(() => { dfgSuppressClick = false }, 0)
  }
}
function onDfgClickCapture(e: MouseEvent) {
  if (!dfgSuppressClick) return
  dfgSuppressClick = false
  e.stopPropagation()
  e.preventDefault()
}
  /**
   * 边几何（Bus 总线路由：不穿卡片内容）
   * - 端口锚点位于「卡片外缘」：源=所在卡右缘、目标=所在卡左缘（芯片中线高度，钳制在卡内）
   * - 路径 = 源卡右缘 → 右侧走廊（垂直）→ 目标卡左缘，正交折线 + 圆角
   * - far（跨多卡长程，spanY > FAR_SPAN）不画线，由卡头端口徽标承接（点击滚动聚焦）
   */
  type EdgeMode = 'near' | 'far'

  interface EdgeGeom {
    d: string
    hue: string
    x1: number
    y1: number
    x2: number
    y2: number
    arrow: string            // 终点箭头（指向目标芯片，向左）
    op: number
    dotOp: number
    highlight: boolean
    dimmed: boolean
    mode: EdgeMode
    fieldId: string
    from: string
    to: string
  }
  const FAR_SPAN = 700
  const laneOf = (i: number) => i % 4
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const nodeRects = ref(new Map<string, DOMRect>())
// 槽位 → 所属卡片 key；卡片 key → 管道局部矩形（端口总线锚点用）
let slotCard = new Map<string, string>()
let cardRects = new Map<string, DOMRect>()

function measure(attempt = 0) {
  const root = pipeRef.value
  const view = viewRef.value
  if (!root || !view) return
  const z = dfgZoom.value || 1
  const rr = root.getBoundingClientRect()
  /* 先等「布局吃进当前 zoom」再量：写 zoom/宽度之后，布局要等到下一次绘制才刷新
     （离屏渲染实测 ~60ms），其间量到的是中间态，连线与卡片当场错位。
     判据 = 层自有宽（rect ÷ zoom）回到基准宽（两者在同一趟布局里生效）；
     最多等 ~160ms 就照画，绝不死等。 */
  if (dfgBaseW.value && Math.abs(rr.width / z - dfgBaseW.value) > 1 && attempt < 8) {
    window.setTimeout(() => measure(attempt + 1), 20)
    return
  }
  /* pipe 现在是**内容层**（滚动视口是外层 .dfg-view）：
     ① 层的自有尺寸 = 实测尺寸 ÷ zoom（SVG 与卡片都在层自有 px 里）；
     ② 卡片/芯片 rect 相对**内容层** rect 的差值本身就含滚动量（层随滚动一起移动），
        所以**不再加回 scrollLeft/Top**——原实现参照物是滚动容器自身（容器边界不随自身滚动
        移动），才需要加回滚动量。这里再加一次就是双计（实测 135% 时坐标整体偏大 1.107 倍）。 */
  pipeW.value = rr.width / z
  pipeH.value = rr.height / z
  const map = new Map<string, DOMRect>()
  const slotMap = new Map<string, string>()
  const cardMap = new Map<string, DOMRect>()
  const rect = (r: DOMRect) =>
    new DOMRect((r.left - rr.left) / z, (r.top - rr.top) / z, r.width / z, r.height / z)
  for (const el of root.querySelectorAll<HTMLElement>('[data-card-key]')) {
    const key = el.getAttribute('data-card-key') || ''
    cardMap.set(key, rect(el.getBoundingClientRect()))
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-chip-id][data-chip-role]')) {
    const id = `${el.getAttribute('data-chip-id')}|${el.getAttribute('data-chip-role')}`
    map.set(id, rect(el.getBoundingClientRect()))
    const card = el.closest<HTMLElement>('[data-card-key]')
    if (card) slotMap.set(id, card.getAttribute('data-card-key') || '')
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-gate-anchor]')) {
    const id = `gate|${el.getAttribute('data-gate-anchor')}`
    map.set(id, rect(el.getBoundingClientRect()))
    const card = el.closest<HTMLElement>('[data-card-key]')
    if (card) slotMap.set(id, card.getAttribute('data-card-key') || '')
  }
  nodeRects.value = map
  slotCard = slotMap
  cardRects = cardMap
  renderEdges()
}

function rectOf(role: string, id: string) {
  return nodeRects.value.get(`${id}|${role}`)
}

const edgeSet = computed(() => {
  const f = flow.value
  if (!f) return []
  const visibleFields = new Set(visibleChips(f.entry).map((c) => c.fieldId))
  for (const s of flowSteps.value) {
    for (const c of [...s.inputChips, ...s.outputChips]) visibleFields.add(c.fieldId)
  }
  for (const c of flow.value?.exit || []) visibleFields.add(c.fieldId)
  return f.edges.filter((e) => visibleFields.has(e.fieldId))
})

/** 长程端口徽标：跨多卡不画线 → 卡头显示「↳ N 下游 / N 上游」，点击滚动聚焦 */
const farPorts = ref<Record<string, Array<{ dir: 'out' | 'in'; count: number; peer: string; peerLabel: string }>>>({})
const flashKey = ref('')

function cardLabelOf(key: string) {
  const f = flow.value
  if (!f) return key
  if (key === '__entry__') return f.entryFrom?.stageName ? `入口·${f.entryFrom.stageName}` : '上游'
  if (key === '__exit__') return '出口'
  const s = flowSteps.value.find((x) => x.agentId === key)
  return s ? s.name.replace(/ Skill$/, '') : key
}

function renderEdges() {
  const f = flow.value
  if (!f || !nodeRects.value.size) return
  // 走廊：所有卡同宽同右缘，busX 在卡片右缘与管道右缘之间（lane 分散防叠）
  const outs: EdgeGeom[] = []
  const farAgg = new Map<string, Map<string, 'out' | 'in'>>()
  let lane = 0
  for (const e of edgeSet.value) {
    const fromSlot = e.kind === 'entry' ? `${e.from}|entry` : `${e.from}|out`
    let dstSlot = `${e.to}|in`
    let dstChip = rectOf('in', e.to)
    if (!dstChip && e.kind === 'internal') { dstSlot = `gate|${e.to}`; dstChip = rectOf('gate', e.to) }
    if (e.kind === 'exit') { dstSlot = `${e.to}|exit`; dstChip = rectOf('exit', e.to) }
    if (e.kind === 'entry') { dstSlot = `gate|${f.agentId}`; dstChip = nodeRects.value.get(dstSlot) }
    const srcChip = rectOf(e.kind === 'entry' ? 'entry' : 'out', e.from)
    if (!srcChip || !dstChip) continue
    const srcCardKey = slotCard.get(fromSlot)
    const dstCardKey = slotCard.get(dstSlot)
    const srcCard = srcCardKey ? cardRects.get(srcCardKey) : undefined
    const dstCard = dstCardKey ? cardRects.get(dstCardKey) : undefined
    if (!srcCard || !dstCard) continue
    /* 锚点与走线按「两卡是不是同一列」分派（2026-10-13 三段并列后新增）：
       - 同列（本阶段列内部的步骤间/闸口→步骤）：源右缘 → 列右走廊竖走 → 目标右缘（原 Bus 折线）
       - 跨列（上游→本阶段 / 本阶段→下游）：源右缘 → 目标左缘的水平三次贝塞尔（与总览画布同一语汇）。
         目的卡锚点在左缘，箭头随之朝右（指向卡内）。
       列归属直接从实测 rect 推：同列卡片 left 相同；无需新加 data 属性，窄档折回单列时自动全部走同列分支。 */
    const sameCol = Math.abs(srcCard.left - dstCard.left) < 2
    const dstIsRight = dstCard.left > srcCard.left + 2
    const dstAnchorLeft = !sameCol && dstIsRight
    const x1 = srcCard.right
    const y1 = clamp(srcChip.top + srcChip.height / 2, srcCard.top + 4, srcCard.bottom - 4)
    const x2 = dstAnchorLeft ? dstCard.left : dstCard.right
    const y2 = clamp(dstChip.top + dstChip.height / 2, dstCard.top + 4, dstCard.bottom - 4)
    const linked = relatedIds.value.has(e.from) && relatedIds.value.has(e.to)
    const highlight = linked
      || (!!hoverChip.value && hoverChip.value === e.from)
      || (!!familyFocus.value && e.fieldId.startsWith(`${familyFocus.value}.`))
    const dimmed = (!!focusId.value || !!familyFocus.value || !!hoverChip.value) && !linked
    const spanY = Math.abs(y2 - y1)
    /* far 只对同列成立：跨列边线是横向贝塞尔（永远贴着走廊横向走，不沿卡片栈竖排），
       不该被「纵向跨度大」降级成端口徽标——那是把「交给下游」这条主线藏起来。 */
    const mode: EdgeMode = sameCol && spanY > FAR_SPAN ? 'far' : 'near'
    const baseOp = edgeFaded.value ? 0.22 : 0
    const op = highlight ? 0.95 : dimmed ? 0.05 : baseOp
    const dotOp = highlight ? 0.95 : dimmed ? 0.08 : edgeFaded.value ? 0.4 : 0.15
    if (mode === 'far') {
      // 不画线：登记端口徽标（双向：源卡「下游」，目标卡「上游」）
      if (!farAgg.has(srcCardKey!)) farAgg.set(srcCardKey!, new Map())
      farAgg.get(srcCardKey!)!.set(dstCardKey!, 'out')
      if (!farAgg.has(dstCardKey!)) farAgg.set(dstCardKey!, new Map())
      farAgg.get(dstCardKey!)!.set(srcCardKey!, 'in')
      continue
    }
    let d: string
    if (!sameCol) {
      // 跨列：水平贝塞尔（控制点落在两端中点 → 曲线整体只在中点带内起伏，不会插回卡片内容）
      const dx = Math.max(24, Math.round(Math.abs(x2 - x1) / 2))
      d = dstAnchorLeft
        ? `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
        : `M ${x1} ${y1} C ${x1 - dx} ${y1} ${x2 + dx} ${y2} ${x2} ${y2}`
    } else {
      // Bus 正交折线：卡右缘 → 走廊竖走 → 目标卡右缘，Q 圆角
      const busX = x1 + 40 - laneOf(lane++) * 9
      if (Math.abs(y2 - y1) < 1) {
        d = `M ${x1} ${y1} L ${x2} ${y2}` // 同高兜底
      } else {
        const r = Math.min(6, Math.abs(y2 - y1) / 2)
        const dir = y2 > y1 ? 1 : -1
        d = [
          `M ${x1} ${y1}`,
          `L ${busX} ${y1}`,
          `Q ${busX} ${y1} ${busX} ${y1 + dir * r}`,
          `L ${busX} ${y2 - dir * r}`,
          `Q ${busX} ${y2} ${x2} ${y2}`,
        ].join(' ')
      }
    }
    outs.push({
      d,
      hue: e.hue,
      x1, y1, x2, y2,
      arrow: dstAnchorLeft
        ? `M ${x2 - 7} ${y2 - 4.2} L ${x2} ${y2} L ${x2 - 7} ${y2 + 4.2} Z`
        : `M ${x2 + 7} ${y2 - 4.2} L ${x2} ${y2} L ${x2 + 7} ${y2 + 4.2} Z`,
      op,
      dotOp,
      highlight,
      dimmed,
      mode,
      fieldId: e.fieldId, from: e.from, to: e.to,
    })
  }
  // far 徽标聚合（同 peer 多字段计一次）
  const farOut: Record<string, Array<{ dir: 'out' | 'in'; count: number; peer: string; peerLabel: string }>> = {}
  for (const [key, peers] of farAgg) {
    farOut[key] = []
    for (const [peer, dir] of peers) {
      farOut[key].push({ dir, count: 1, peer, peerLabel: cardLabelOf(peer) })
    }
  }
  farPorts.value = farOut
  edgeGeoms.value = outs
}

function focusCard(key: string) {
  const root = pipeRef.value
  if (!root) return
  const el = root.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(key)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  flashKey.value = key
  window.setTimeout(() => { if (flashKey.value === key) flashKey.value = '' }, 1500)
}

let measureRaf = 0
let measureTimer = 0
/** 一次待执行的重测（rAF 与兜底定时器竞争触发，先到者执行、另一个作废） */
let measurePending = false
function scheduleMeasure() {
  if (measurePending) return
  measurePending = true
  cancelAnimationFrame(measureRaf)
  window.clearTimeout(measureTimer)
  const run = async () => {
    if (!measurePending) return
    measurePending = false
    window.clearTimeout(measureTimer)
    await nextTick()
    /* 基准宽在每次重测入口兜一次：面板首次可见时 onMounted 早于布局（clientWidth 仍为 0），
       只有 RO 那一拍可能也量不到；放这里任何触发重测的事件都能把基准宽补上 */
    sampleDfgBaseW()
    measure()
  }
  measureRaf = requestAnimationFrame(run)
  // rAF 在后台标签页 / 嵌入式浏览器视口会被饿死（连线几何停更不恢复），
  // 兜底定时器保证重测终会执行；两者竞争，先到先跑
  measureTimer = window.setTimeout(run, 120)
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  sampleDfgBaseW()
  scheduleMeasure()
  resizeObserver = new ResizeObserver(() => {
    sampleDfgBaseW()
    scheduleMeasure()
  })
  // 观察**视口**：内容层宽度由 zoom × 基准宽算出来，视口尺寸才是布局变化的来源
  if (viewRef.value) resizeObserver.observe(viewRef.value)
  window.addEventListener('resize', scheduleMeasure)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(measureRaf)
  window.clearTimeout(measureTimer)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleMeasure)
})
watch(flowSteps, scheduleMeasure, { deep: true })
watch(edgeSet, scheduleMeasure)
watch(showHidden, scheduleMeasure)
watch(focusId, scheduleMeasure)
watch(expandedEntry, scheduleMeasure)
watch(expandedExit, scheduleMeasure)
watch(expandedSteps, scheduleMeasure, { deep: true })
watch(() => flow.value?.stageId, scheduleMeasure)
/* 缩放变化：内容层宽度与整套坐标基准都变（measure 里有 ÷zoom），必须重测；
   先 sampleDfgBaseW 是兜底——视口滚动条随缩放出现/消失会改 clientWidth */
watch(dfgZoom, () => {
  sampleDfgBaseW()
  scheduleMeasure()
})
// hover / 数据族聚焦只影响边的高亮态（无需重测 DOM），轻量重算几何
watch(hoverChip, () => { if (nodeRects.value.size) renderEdges() })
watch(familyFocus, () => { if (nodeRects.value.size) renderEdges() })
watch(edgeFaded, () => { if (nodeRects.value.size) renderEdges() })

/* ================= 抽屉 ================= */
/** 字段芯片的悬停信息：**双层结构**（2026-10-14 用户：兼顾业务与技术查验）——
    第一行中文业务名（运营一眼知道这是什么），其后逐行键值（工程照着它核对 schema）：
    字段 / 类型 · 角色 / 说明 / 移交 / 抽取路径 / 落库键。
    没拿到的项整行不出现（比如该字段不在本阶段字段定义里时 description/valueType 为空，
    就只剩「字段:」一行），不写「未标注」这类假占位、也不留孤零零的分隔符。
    角色人话来自后端词表（roleLabel），本处不写第二份。 */
function chipTitle(c: FlowChip) {
  const lines: string[] = []
  if (c.description && c.description !== c.fieldId) lines.push(c.description)
  lines.push(`字段: ${c.fieldId}`)
  const typeBits = [c.valueType, roleLabel(c.role)].filter(Boolean)
  if (c.internal) typeBits.push('内部字段')
  if (c.accumulate) typeBits.push('累积')
  if (typeBits.length) lines.push(`类型: ${typeBits.join(' · ')}`)
  if (c.notes) lines.push(`说明: ${c.notes}`)
  if (c.handoffTargets.length) lines.push(`移交: ${c.handoffTargets.join(', ')}`)
  if (c.pathInRawOutput) lines.push(`抽取路径: ${c.pathInRawOutput}`)
  if (c.persistKey && c.persistKey !== c.fieldId) lines.push(`存储字段名: ${c.persistKey}`)
  return lines.join('\n')
}

function openField(c: FlowChip) {
  selected.value = c
  focusId.value = c.id
  editMsg.value = ''
  editError.value = false
  editDraft.render = c.render
  editDraft.handoffText = c.handoffTargets.join(', ')
  editDraft.accumulate = c.accumulate
  editDraft.internal = c.internal
  editDraft.notes = c.notes || ''
}
useEscape(() => !!selected.value, () => { selected.value = null })
/* 遮罩关闭守卫（useMaskClose：按下与松开都落在遮罩上才关）：防在抽屉内选中/拖动文本、
   或从画布拖选字段到遮罩松手时误关（同 GoalConversations/OpsContent 接法） */
const maskRef = ref<HTMLElement | null>(null)
useMaskClose(maskRef, () => { selected.value = null })
/* 模态覆盖层语义（审核 #95）：此前抽屉只有 role=dialog，焦点不进抽屉、Tab 可一路走到
   底层 130+ 芯片、背景可滚、无 aria-modal、关闭不回焦。useOverlay 一次收口
   （锁滚 + aria-modal + 聚焦面板 + Tab 陷阱 + 关闭回焦），与 FieldRoutingTable 弹窗同款。 */
const drawerPanelRef = ref<HTMLElement | null>(null)
const drawerOpen = computed(() => !!selected.value)
useOverlay(drawerOpen, drawerPanelRef)

/** 旅程摘要：谁产出 / 谁消费 / 交给谁 */
function producersOf(c: FlowChip): string[] {
  if (c.agentId) return [c.agentId.replace(/^skill:/, '')]
  return []
}
function journeyOf(part: 'producer' | 'consumers' | 'handoff'): string[] | string {
  const c = selected.value
  if (!c) return part === 'consumers' ? [] : ''
  if (part === 'producer') {
    const stage = stageOfChip(c.agentId)
    return stage ? `${producersOf(c)[0]}（${stageNameOf(stage)}）` : producersOf(c)[0]
  }
  if (part === 'consumers') {
    const out: string[] = []
    for (const s of flowSteps.value) {
      if (s.inputChips.some((x) => x.fieldId === c.fieldId)) out.push(s.name.replace(/ Skill$/, ''))
    }
    return out
  }
  if (c.handoffTargets.length) {
    return c.handoffTargets.map((t) => `${t}`).join(' / ')
  }
  return c.accumulate ? '学习者状态（累积）' : '对话终点（不转交）'
}
function journeyHint() {
  const c = selected.value
  if (!c) return ''
  const consumers = (journeyOf('consumers') as string[]).filter(Boolean)
  if (consumers.length) return `同名字段在图中以轨道线相连：产出后流转到 ${consumers.join('、')} 继续使用。`
  if (flow.value?.exit.some((x) => x.fieldId === c.fieldId)) return `该字段已汇总到汇入出口，整体移交下一阶段。`
  if (c.accumulate) return '该字段不向下游移交，累积进学习者状态（画像/上下文）。'
  return '该字段为阶段内信息，不参与跨阶段流转。'
}
function stageOfChip(agentId: string): string | null {
  for (const sid of STAGE_ORDER) {
    const d = detailByStage.value[sid]
    if (d?.agents.some((a) => a.agentId === agentId)) return sid
  }
  return null
}

const dirty = computed(() => {
  if (!selected.value) return false
  return (
    editDraft.render !== selected.value.render ||
    editDraft.handoffText !== selected.value.handoffTargets.join(', ') ||
    editDraft.accumulate !== selected.value.accumulate ||
    editDraft.internal !== selected.value.internal ||
    editDraft.notes !== (selected.value.notes || '')
  )
})
function resetDraft() {
  if (!selected.value) return
  editDraft.render = selected.value.render
  editDraft.handoffText = selected.value.handoffTargets.join(', ')
  editDraft.accumulate = selected.value.accumulate
  editDraft.internal = selected.value.internal
  editDraft.notes = selected.value.notes || ''
  editMsg.value = ''
  editError.value = false
}
async function saveEdit() {
  const c = selected.value
  if (!c || saving.value) return
  saving.value = true
  editMsg.value = ''
  editError.value = false
  try {
    const handoff = editDraft.handoffText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    await adminFieldRoutingsApi.patchRouting(c.agentId, c.fieldId, {
      render: editDraft.render as 'visible' | 'hidden',
      handoff,
      internal: editDraft.internal,
      accumulate: editDraft.accumulate,
      notes: editDraft.notes || null,
    })
    editMsg.value = '已保存：编排文件与 DB 已同步'
    toast.success('字段路由已更新')
    onRoutingChanged()
  } catch (e: any) {
    editError.value = true
    editMsg.value = e?.response?.data?.error?.message || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

/** 步骤卡主题色：skill 用其 phase 色，跨阶段引用用目标阶段色 */
function stepHue(step: FlowStep): string {
  if (step.fromStage) return toneOf(step.fromStage).hue
  return toneOf(active.value).hue
}
</script>

<style scoped>
/* 工作区卡：fill 布局下根与 frame 占满编排页工作区高度，画布内部滚动 */
.dfg {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}
.dfg-frame {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-graph-canvas);
  overflow: hidden;
  box-shadow: var(--mk-shadow-sm);
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* frame 内吸顶元素：工具条 / 图性质说明，不参与高度压缩 */
.dfg-toolbar,
.dfg-caption { flex: none; }
.dfg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: var(--mk-graph-toolbar-b); /* 渐变退役（材质一律平面），取原纵向洗底的收束色 */
  border-bottom: 1px solid var(--mk-line);
}
.dfg-toolbar__status { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.dfg-stage-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-muted) 12%, transparent); }
.dfg-title { font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink); }
.dfg-title__agent { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-faint); }
.dfg-meta { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 搜索命中反馈（审核 #114）：0 命中用琥珀强调，与「命中 N」的中性读数区分 */
.dfg-hitnote { color: var(--mk-muted); }
.dfg-hitnote--none { color: var(--mk-amber); }

.dfg-toolbar__controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dfg-search { position: relative; display: inline-flex; align-items: center; }
.dfg-search__input {
  width: 200px;
  padding: 5px 26px 5px 10px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-sm);
  font: inherit; font-size: var(--mk-fs-micro);
  background: var(--mk-graph-field);
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.dfg-search__input:focus { border-color: var(--mk-blue); box-shadow: var(--mk-focus-ring); }
.dfg-search__clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; /* 16→24：WCAG 2.5.8 */
  border: 0; border-radius: 50%; background: var(--mk-graph-clear-bg); color: var(--mk-muted);
  font-size: var(--mk-fs-micro); line-height: 1; cursor: pointer; padding: 0;
}
.dfg-search__clear:hover { background: var(--mk-graph-clear-bg-hover); color: var(--mk-ink); }
.dfg-switch { display: inline-flex; align-items: center; gap: 5px; font-size: var(--mk-fs-micro); color: var(--mk-muted); cursor: pointer; }

/* 图性质说明（字段数据旅程 / 逻辑图） */
.dfg-caption {
  margin: 0; padding: 5px 14px;
  background: var(--mk-graph-canvas-2);
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro); color: var(--mk-faint);
}
.dfg-caption strong { color: var(--mk-muted); font-weight: 800; }

/* 流水线画布（2026-10-13 拆成两层：视口 + 内容层，见模板注释）：
   视口 = 滚动 + 满宽 + 画布底；内容层 = 网格排版 + zoom（缩放）。 */
.dfg-view {
  flex: 1 1 auto;
  min-height: 0;
  /* 满宽（2026-10-13 用户问「为什么没做全窗口，左右还有空白」）：
     原 `max-width: 1060px + margin: 0 auto` 是 2026-09-03 重构时手挑的「阅读栏」宽
     （无注释、无别处依赖），但同一张卡里的工具条 / 图性质说明 / 底部图例都是满宽，
     画布独自内缩 262×2 反而与上下元素错位；字段芯片是流式网格，宽了就是每行多放几枚、
     少滚几屏。width: 100% 保留（margin:auto 会让交叉轴失去 stretch，宽度跟内容缩）。 */
  width: 100%;
  /* 三段并列的折档判据挂在本层（容器查询，见 .dfg-cols 上方注释） */
  container-type: inline-size;
  /* 画布底：亮色无底（none）、暗色纵向渐变；此前只有暗色档、亮色缺配对 */
  background: var(--mk-graph-pipe-bg);
  /* 滚动条槽位常驻：缩放让滚动条出现/消失，否则 clientWidth 会跳，基准宽（= clientWidth）
     跟着抖，画布宽度与量测基准都要重算一遍 */
  scrollbar-gutter: stable;
  overflow: auto; /* 放大后两轴都要能滚（原先 overflow-x: hidden，因为 100% 时内容不超栏宽） */
  cursor: grab;
  /* 内容整体居中（2026-10-13 用户：默认以左上角为原点，希望整体视觉居中）：
     视口改 flex，内容层 .dfg-pipe 用 margin:auto 吃两侧/上下余量——
     margin:auto 同时解决两件事：① 余量存在时居中；② 内容超出视口时 auto 边距塌成 0、
     回到左上角起点，滚动条能从第一格开始滚（在**滚动容器**上用 justify-content:center
     做不到后者，会把开头裁掉）。 */
  display: flex;
}
.dfg-view.is-panning, .dfg-view.is-panning * { cursor: grabbing; }
.dfg-pipe {
  position: relative;
  padding: 16px 20px 28px;
  /* 三段并列的排布在 .dfg-cols；本层只管内边距 + 定位（SVG/量测都以本层为基准） */
  transition: opacity 0.15s ease;
  /* flex:none 必给：视口已是 flex，默认 flex-shrink:1 会为塞进视口而压缩内容层，
     放大（zoom>1）就压不出滚动条、缩没；margin:auto 见 .dfg-view 上的注释 */
  flex: none;
  margin: auto;
}
/* 三段并列：上游 | 本阶段 | 下游（2026-10-13 用户：核心是让运营可视化看到配合关系）。
   列间距 96 = 连线走廊（同列 Bus 与跨列贝塞尔都走这里，busX 最远到卡右缘 +40）。
   整组居中：宽视口下三列未必铺满，居中后左右留白对称（内容仍可压缩，不会顶出滚动条）。 */
.dfg-cols { display: flex; align-items: flex-start; justify-content: center; gap: 96px; }
.dfg-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
/* 上下游两列按字段名宽度给（芯片名 nowrap 省略号，列太窄会截断名字，运营要看到全名）；
   本阶段列吃剩余宽度（步骤卡里的芯片最多）。都可压缩，窄了先压两侧。 */
.dfg-col--up, .dfg-col--down { flex: 0 1 400px; }
/* 本阶段列吃剩余宽但要封顶（2026-10-13 用户：单看步骤卡「不那么宽，高一些」）：
   原先 flex-grow 无上限，goal 档单卡被拉到 1064px 的扁条、芯片只铺 3 行；
   封顶后卡变窄、芯片多铺几行 → 卡片变方（与右侧窄高的出口列也协调些）。
   720 是权衡值：再窄（~570，教学档五列挤压后的实际宽）芯片名会频繁截断。 */
.dfg-col--main { flex: 1 1 520px; max-width: 720px; }
/* 收窄档折回单列栈（= 改动前的形态）：列容器退场，卡片直接按 DOM 序排进单列，
   走廊回到右侧内边距 84。连线无需分档——renderEdges 按「是不是同一列」自适配。
   用**容器查询**而不是媒体查询：本布局的可用宽度取决于面板（侧栏展开/折叠差 220px），
   视口断点会在 1280 视口下把三列压成 231px 宽还不折（实测）。容器 = .dfg-view，
   容器尺寸取的是未缩放的视口宽，所以滚轮缩放不影响这条断点。 */
@container (max-width: 1100px) {
  .dfg-pipe { padding-right: 84px; }
  .dfg-cols { flex-direction: column; gap: 14px; }
  .dfg-col { display: contents; }
}
.dfg-pipe.is-dimmed { opacity: 1; }
/* 缩放读数（工具栏右端）：定宽 + 等宽数字，比例变化时按钮与左邻元素不跳 */
.dfg-zoom__val { min-width: 56px; font-variant-numeric: tabular-nums; }
.dfg-edges { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 3; }

.dfg-edges path.is-hot { stroke-dasharray: 5 4; animation: dfg-flow 0.7s linear infinite; }
@keyframes dfg-flow { to { stroke-dashoffset: -9; } }

/* 长程端口徽标（跨多卡不画线，点击滚动聚焦） */
.dfg-step__port {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-blue);
  background: var(--mk-graph-port-bg); border: 1px solid var(--mk-graph-port-line); border-radius: 999px;
  padding: 1px 7px; cursor: pointer; max-width: 160px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.dfg-step__port:hover { background: var(--mk-graph-port-bg-hover); box-shadow: 0 0 0 2px color-mix(in srgb, var(--mk-blue) 18%, transparent); }
.dfg-step__port b { font-variant-numeric: tabular-nums; }
html[data-theme='dark'] .dfg-step__port { background: var(--mk-graph-port-bg); border-color: var(--mk-graph-port-line); color: var(--mk-graph-port-ink); }
html[data-theme='dark'] .dfg-step__port:hover { background: var(--mk-graph-port-bg-hover); }

/* 滚动聚焦闪烁（点击端口徽标后目标卡闪两下） */
.dfg-step.is-flash, .dfg-gate.is-flash { animation: dfg-flash 0.7s ease 2; }
@keyframes dfg-flash {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  45% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--mk-blue) 45%, transparent); }
}

/* 进出闸口卡 */
.dfg-gate {
  position: relative; z-index: 2;
  border: 1px dashed color-mix(in srgb, var(--hz) 45%, var(--mk-line));
  border-radius: 12px;
  background: color-mix(in srgb, var(--hz) 4%, var(--mk-graph-gate));
  padding: 10px 14px 12px;
}
.dfg-gate--exit { background: color-mix(in srgb, var(--hz) 5%, var(--mk-graph-journey-a)); }
.dfg-gate__head { display: flex; align-items: center; gap: 9px; }
.dfg-gate__icon {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--mk-radius-sm); color: var(--mk-graph-on-accent); font-size: var(--mk-fs-micro); font-weight: 800; flex-shrink: 0;
  /* 2026-09-27 admin 走查：白字压 --hz 实心底最低仅 3.74:1（path 青 #0d9488）<4.5:1，
     底色混入 --mk-ink 加深为同色相深档（白字对青升到约 5.6:1、最差的琥珀约 5.0:1，白字本身不动） */
  background: color-mix(in srgb, var(--hz) 70%, var(--mk-ink));
}
.dfg-gate__title { display: grid; gap: 1px; min-width: 0; flex: 1; }
.dfg-gate__title strong { font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink); }
/* 卡题即「切到对端阶段」入口（2026-10-13 删掉顶部概览条后，把唯一不能丢的跳转能力挪到卡题上）：
   与相邻的 <strong> 同字号同粗细，只加 hover 提示，不抢标题位；justify-self:start 让下划线只压文字、
   不铺满整行（.dfg-gate__title 是 grid，默认 stretch 会把按钮拉到整列宽）。 */
.dfg-gate__src {
  justify-self: start;
  display: inline-flex; align-items: baseline; gap: 4px; min-width: 0;
  font: inherit; font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink);
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
}
.dfg-gate__src:hover { color: var(--mk-blue); text-decoration: underline; text-underline-offset: 2px; }
.dfg-gate__jump { color: var(--mk-faint); }
.dfg-gate__src:hover .dfg-gate__jump { color: var(--mk-blue); }
.dfg-gate__sub { font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dfg-gate__count {
  flex-shrink: 0; font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-muted);
  background: var(--mk-graph-badge-bg); padding: 2px 9px; border-radius: 999px; font-variant-numeric: tabular-nums;
}
.dfg-gate .dfg-chips { margin-top: 9px; }

/* 步骤卡 */
.dfg-step {
  position: relative; z-index: 2;
  border: 1px solid color-mix(in srgb, var(--hz) 18%, var(--mk-line));
  border-radius: 12px;
  background: var(--mk-graph-canvas);
  overflow: hidden;
}
.dfg-step--gate {
  border-style: dashed;
  background: var(--mk-graph-canvas); /* 渐变退役（材质一律平面） */
}
.dfg-step--bare { border-style: dashed; background: var(--mk-graph-canvas-2); }
.dfg-step--bare.is-unresolved { border-color: color-mix(in srgb, var(--mk-amber) 45%, var(--mk-line)); }
/* orphan：已注册但无字段契约的 Skill（调用统计是真实健康信号，红色警示） */
.dfg-step--bare.is-orphan {
  border-color: color-mix(in srgb, var(--mk-red) 40%, var(--mk-line));
  background: var(--mk-graph-inset); /* 渐变退役（材质一律平面） */
}
.dfg-step--bare.is-orphan .dfg-step__badge--warn { background: color-mix(in srgb, var(--mk-red) 12%, var(--mk-graph-node-top)); }
.dfg-step__head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px 6px;
  background: var(--mk-graph-canvas); /* 渐变退役（材质一律平面） */
  border-bottom: 1px solid color-mix(in srgb, var(--hz) 10%, var(--mk-graph-line-soft));
}
.dfg-step--bare .dfg-step__head { border-bottom: 0; padding-bottom: 5px; }
.dfg-step__idx {
  width: 21px; height: 21px; display: inline-flex; align-items: center; justify-content: center;
  /* 序号方对齐原型 .odg-col__no（软底 + 彩色字，非实心块）：--hz 软底 12% + 同色相深档字，
     与下方 .dfg-step__badge--gate 同一混色；原实心 --hz + 白字在浅色 --hz（青 #0d9488）仅 3.74:1 */
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--hz) 12%, var(--mk-graph-node-bg));
  color: color-mix(in srgb, var(--hz) 75%, var(--mk-ink));
  font-size: var(--mk-fs-micro); font-weight: 800; flex-shrink: 0;
}
.dfg-step--gate .dfg-step__idx { border-radius: 50%; }
.dfg-step__name { font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink); }
.dfg-step__badge {
  padding: 1px 7px; border-radius: 999px; background: var(--mk-graph-badge-bg); color: var(--mk-muted);
  font-size: var(--mk-fs-micro); font-weight: 800;
}
.dfg-step__badge--gate { background: color-mix(in srgb, var(--hz) 14%, var(--mk-graph-node-bg)); color: color-mix(in srgb, var(--hz) 75%, var(--mk-ink)); }
.dfg-step__badge--svc { background: var(--mk-graph-tag-bg); color: var(--mk-muted); }
.dfg-step__badge--cross { background: var(--mk-graph-badge-cross-bg); color: var(--fam-classroom); }
.dfg-step__badge--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
/* 卡变窄后这里不能再当「被压缩的那个」（2026-10-13）：原先 flex:1 + min-width:0 会把
   skill id 直接截成「sk…」——而 skill id 正是运营要对号入座的东西。改 0 1 auto + max-width:100%：
   卡头本就 flex-wrap，放不下时整枚 id 折到下一行（下一行独占约整卡宽，不再截断）；
   只有 id 长过整卡时才落回省略号。spacer 仍把触发/循环条件推到行尾。 */
.dfg-step__agent { font-size: var(--mk-fs-micro); color: var(--mk-faint); flex: 0 1 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfg-step__spacer { flex: 1; }
.dfg-step__cond {
  flex-shrink: 0; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-amber);
  background: var(--mk-amber-bg); border-radius: 6px; padding: 1px 7px;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfg-step__role { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); }
.dfg-step__stage {
  flex-shrink: 0; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue);
  cursor: pointer; background: var(--mk-blue-bg); border-radius: 6px; padding: 1px 7px;
}
.dfg-step__stage:hover { background: var(--mk-graph-stage-hover-bg); }
.dfg-step__count { flex-shrink: 0; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.dfg-step__body { padding: 8px 12px 10px; display: grid; gap: 7px; }
.dfg-step__note { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.dfg-step__rows { display: grid; gap: 7px; }
.dfg-step__row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.dfg-step__rowlabel {
  flex-shrink: 0; margin-top: 5px; min-width: 34px; text-align: right;
  font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em;
  }

/* 字段卡 */
.dfg-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.dfg-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; max-width: 100%;
  padding: 0 9px 0 7px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--hz) 32%, var(--mk-line));
  border-left: 3px solid var(--hz);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-graph-node-bg);
  font: inherit; color: var(--mk-ink); text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease, filter 0.12s ease;
}
.dfg-chip:hover { border-color: var(--hz); }
.dfg-chip--in { background: color-mix(in srgb, var(--hz) 5%, var(--mk-graph-inset)); }
.dfg-chip--more {
  border-style: dashed; border-color: var(--mk-line); border-left-width: 3px;
  background: var(--mk-graph-node-bg); color: var(--mk-blue); font-weight: 700;
}
.dfg-chip--more:hover { border-color: var(--mk-blue); background: var(--mk-blue-bg); }
.dfg-chip.is-dimmed { opacity: 0.3; filter: saturate(0.35); }
.dfg-chip.is-related { opacity: 1; filter: none; }
.dfg-chip.is-focused {
  border-color: var(--hz);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hz) 24%, transparent);
  z-index: 4;
}
.dfg-chip__dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dfg-chip__name {
  font-size: var(--mk-fs-micro); font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dfg-chip__type {
  flex-shrink: 0; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint);
  background: var(--mk-graph-tag-bg); border-radius: var(--mk-radius-sm); padding: 0 5px; line-height: 1.7;
}
.dfg-chip__flag {
  flex-shrink: 0; font-size: var(--mk-fs-micro); font-weight: 800; color: var(--fam-classroom);
  background: var(--mk-graph-flag-purple-bg); border-radius: var(--mk-radius-sm); padding: 0 5px; line-height: 1.8;
}
.dfg-chip__flag--accum { color: var(--fam-knowledge); background: var(--mk-amber-bg); }
.dfg-chip__to {
  flex-shrink: 0; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue);
  background: var(--mk-blue-bg); border-radius: 6px; padding: 0 6px; line-height: 1.8;
  max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfg-chip__to--stage { background: color-mix(in srgb, var(--hz) 12%, var(--mk-graph-node-bg)); color: var(--mk-ink); font-weight: 800; }

/* 图例（数据族） */
.dfg-legend {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  margin-top: 10px;
}
.dfg-legend.is-dimmed { opacity: 0.55; }
.dfg-legend__item {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  border: 1px solid transparent; background: transparent;
  font: inherit; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted);
  cursor: pointer;
}
.dfg-legend__item i { width: 8px; height: 8px; border-radius: 50%; }
.dfg-legend__item b { font-weight: 800; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.dfg-legend__item:hover { background: var(--mk-blue-bg); }
.dfg-legend__item.is-on { border-color: var(--mk-blue); background: var(--mk-blue-bg); color: var(--mk-blue); }

/* 空态走 MkEmptyState（原型 .empty 词表），此处无本地样式 */

/* ========== 抽屉（原型 openLearner 三段式：头部标题 + 正文 pills/事实/嵌套卡 + 常驻 foot） ========== */
.dfg-drawer { background: var(--mk-graph-canvas); }
.dfg-drawer__body { display: grid; gap: 16px; align-content: start; }
/* 首段徽章行（原型 .ovl__body 首段 pills）：角色 / 可见性 / 锁定 / 内部信令 / 累积 */
.dfg-drawer__pills { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
/* 内部/累积沿用画布 chip 的色彩编码（内=紫、累=琥珀），形状走共享 mk-badge 胶囊 */
.dfg-badge--internal { background: var(--mk-graph-flag-purple-bg); color: var(--fam-classroom); }
.dfg-badge--accum { background: var(--mk-amber-bg); color: var(--fam-knowledge); }

/* 事实清单（原型 dl.kv：96px 标签列、不画线、标签不描字重，值可嵌徽标/色块） */
.dfg-dl__family { width: 10px; height: 10px; border-radius: var(--mk-radius-xs); display: inline-block; }

/* 区块（原型 section = 区块头 + 内容；原 .dfg-flow 虚线自绘框并入此文法） */
.dfg-section { display: grid; gap: 8px; }
.dfg-flow__list { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dfg-flow__chip { padding: 2px 9px; border-radius: 999px; background: var(--mk-blue); color: var(--mk-graph-on-accent); font-size: var(--mk-fs-micro); font-weight: 700; }
.dfg-flow__chip--soft { background: var(--mk-graph-flow-soft-bg); color: var(--mk-accent-deep); }
.dfg-flow__chip--out { background: var(--mk-graph-flow-out); }
.dfg-flow__arrow { color: var(--mk-blue); font-weight: 800; }
.dfg-flow__hint { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }

/* 行级编辑本体（卡体/卡头由共享 mk-card 提供，此处只留排列与 field 行） */
.dfg-edit { padding: 12px 16px; display: grid; gap: 12px; }
/* field 行（原型 .field：标签 12px 700 墨色、控件在下一行） */
.dfg-field { display: grid; gap: 6px; }
.dfg-field__label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
/* 只读说明（原型 .note 语气：浅底、muted、微字号） */
.dfg-note { margin: 0; padding: 10px 12px; border-radius: var(--mk-radius-xl); background: var(--mk-surface-3); color: var(--mk-muted); font-size: var(--mk-fs-micro); line-height: 1.6; }
.dfg-edit__pills { display: inline-flex; gap: 4px; padding: 2px; background: var(--mk-graph-pills-bg); border-radius: var(--mk-radius-sm); width: fit-content; }
.dfg-pill { padding: 4px 12px; border: 0; border-radius: 6px; background: transparent; font: inherit; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); cursor: pointer; }
.dfg-pill.is-on { background: var(--mk-graph-pill-on-bg); color: var(--mk-blue); }
.dfg-edit__input { padding: 6px 10px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-sm); font: inherit; font-size: var(--mk-fs-micro); background: var(--mk-graph-field); outline: none; }
.dfg-edit__input:focus { border-color: var(--mk-blue); }
.dfg-check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted); cursor: pointer; }
.dfg-edit__msg { margin: 0; padding: 8px 10px; border-radius: var(--mk-radius-sm); background: var(--mk-graph-flow-bg); color: var(--mk-blue); font-size: var(--mk-fs-micro); font-weight: 600; }
.dfg-edit__msg.is-error { background: var(--mk-red-bg); color: var(--mk-red); }

/* ================= 暗色模式 ================= */
html[data-theme='dark'] {
  .dfg-frame { background: var(--mk-graph-canvas); border-color: var(--mk-graph-line); }
  .dfg-toolbar { background: var(--mk-graph-toolbar-b); border-bottom-color: var(--mk-graph-line); }
  .dfg-search__input { background: var(--mk-graph-field); border-color: var(--mk-line); color: var(--mk-ink); }
  .dfg-search__input:focus { box-shadow: var(--mk-focus-ring); }
  .dfg-search__clear { background: var(--mk-line); color: var(--mk-muted); }
  .dfg-search__clear:hover { background: var(--mk-graph-clear-bg-hover); color: var(--mk-ink); }
  .dfg-gate { background: color-mix(in srgb, var(--hz) 7%, var(--mk-graph-gate)); border-color: color-mix(in srgb, var(--hz) 40%, var(--mk-line)); }
  .dfg-gate--exit { background: color-mix(in srgb, var(--hz) 8%, var(--mk-graph-journey-a)); }
  /* 暗色下 --mk-ink 翻转为浅色，上面的加深混色会反向；回退实心 --hz 维持走查前表现（本次走查范围为浅色卡面） */
  .dfg-gate__icon { background: var(--hz); }
  .dfg-gate__title strong { color: var(--mk-graph-node-ink); }
  .dfg-gate__src { color: var(--mk-graph-node-ink); }
  .dfg-gate__count { background: var(--mk-graph-badge-bg); color: var(--mk-muted); }
  .dfg-step { background: var(--mk-graph-canvas); border-color: color-mix(in srgb, var(--hz) 20%, var(--mk-line)); }
  .dfg-step--gate { background: var(--mk-graph-canvas); }
  .dfg-step--bare { background: var(--mk-graph-canvas-2); }
  .dfg-step--bare.is-unresolved { border-color: color-mix(in srgb, var(--mk-amber) 45%, var(--mk-line)); }
  .dfg-step--bare.is-orphan { border-color: color-mix(in srgb, var(--mk-red) 40%, var(--mk-line)); background: var(--mk-graph-inset); }
  .dfg-step--bare.is-orphan .dfg-step__badge--warn { background: var(--mk-red-bg); }
  .dfg-step__head { background: var(--mk-graph-canvas); border-bottom-color: color-mix(in srgb, var(--hz) 12%, var(--mk-graph-line)); }
  .dfg-step__name { color: var(--mk-graph-node-ink); }
  .dfg-step__badge { background: var(--mk-graph-badge-bg); color: var(--mk-muted); }
  .dfg-step__badge--gate { background: color-mix(in srgb, var(--hz) 22%, var(--mk-surface)); color: var(--mk-graph-blue-ink); }
  .dfg-step__badge--svc { background: var(--mk-graph-tag-bg); color: var(--mk-muted); }
  .dfg-step__badge--cross { background: var(--mk-graph-flag-purple-bg); color: var(--mk-graph-accent-purple-ink); }
  .dfg-step__badge--warn { background: var(--mk-amber-bg); color: var(--mk-graph-warn-ink); }
  .dfg-step__cond { background: var(--mk-amber-bg); color: var(--mk-graph-warn-ink); }
  .dfg-step__stage { background: var(--mk-blue-bg); color: var(--mk-graph-blue-ink); }
  .dfg-step__stage:hover { background: var(--mk-graph-stage-hover-bg); color: var(--mk-graph-blue-ink-hover); }
  .dfg-chip { background: var(--mk-surface); border-color: color-mix(in srgb, var(--hz) 32%, var(--mk-line)); color: var(--mk-graph-node-ink); }
  .dfg-chip--in { background: color-mix(in srgb, var(--hz) 9%, var(--mk-graph-inset)); }
  .dfg-chip--more { background: var(--mk-surface); }
  .dfg-chip--more:hover { background: var(--mk-graph-chip-blue-bg); }
  .dfg-chip__type { background: var(--mk-graph-tag-bg); color: var(--mk-muted); }
  .dfg-chip__flag { background: var(--mk-graph-flag-purple-bg); color: var(--mk-graph-flag-purple-ink); }
  .dfg-chip__flag--accum { background: var(--mk-amber-bg); color: var(--mk-graph-warn-ink); }
  .dfg-chip__to { background: var(--mk-graph-chip-blue-bg); color: var(--mk-accent-deep); }
  .dfg-chip__to--stage { background: color-mix(in srgb, var(--hz) 16%, var(--mk-surface)); color: var(--mk-graph-node-ink); }
  .dfg-legend { background: var(--mk-graph-canvas); }
  .dfg-legend__item:hover { background: var(--mk-graph-hover-bg); }
  .dfg-legend__item.is-on { background: color-mix(in srgb, var(--mk-blue) 18%, transparent); border-color: color-mix(in srgb, var(--mk-blue) 45%, transparent); color: var(--mk-graph-blue-ink); }
  .dfg-drawer { background: var(--mk-graph-canvas); }
  .dfg-drawer__body { background: var(--mk-graph-canvas); }
  .dfg-flow__chip--soft { background: var(--mk-graph-flow-soft-bg); color: var(--mk-graph-flow-soft-ink); }
  .dfg-flow__chip--out { background: var(--mk-graph-flow-out); }
  .dfg-edit__pills { background: var(--mk-graph-pills-bg); color: var(--mk-muted); }
  .dfg-pill { color: var(--mk-muted); }
  .dfg-pill:hover { color: var(--mk-graph-node-ink); }
  .dfg-pill.is-on { background: var(--mk-graph-pill-on-bg); color: var(--mk-graph-blue-ink); }
  .dfg-edit__input { background: var(--mk-graph-field); border-color: var(--mk-line); color: var(--mk-ink); }
  .dfg-edit__msg { background: var(--mk-graph-flow-bg); color: var(--mk-accent-deep); }
  .dfg-edit__msg.is-error { background: var(--mk-red-bg); color: var(--mk-graph-err-strong-ink); }
  .dfg-badge--internal { background: var(--mk-graph-flag-purple-bg); color: var(--mk-graph-flag-purple-ink); }
  .dfg-badge--accum { background: var(--mk-amber-bg); color: var(--mk-graph-warn-ink); }
  .dfg-drawer { color: var(--mk-ink); }
}

/* 响应式（此前本组件 0 个 @media，窄屏靠 .dfg-frame overflow:hidden 静默裁切）：
   收窄右侧连线走廊（≥44px 保证 bus 折线 busX=卡右缘+40 仍在画布内），
   并给步骤头 agent 设最小宽度，避免被 flex 压成 0（原 flex:1;min-width:0 在 @820 塌成 2px）。 */
@media (max-width: 1024px) {
  .dfg-pipe { padding: 14px 16px 24px; padding-right: 56px; }
}
@media (max-width: 860px) {
  .dfg-pipe { padding: 12px 14px 20px; padding-right: 48px; gap: 12px; }
  .dfg-gate__head { flex-wrap: wrap; }
  .dfg-step__agent { flex: 1 1 140px; min-width: 140px; }
  .dfg-step__cond { max-width: 100%; }
  .dfg-search__input { width: 160px; }
}
@media (max-width: 640px) {
  .dfg-pipe { padding: 10px 12px 16px; padding-right: 44px; }
  .dfg-toolbar { padding: 8px 10px; }
  .dfg-toolbar__controls { width: 100%; gap: 8px; }
  .dfg-search { flex: 1 1 100%; }
  .dfg-search__input { width: 100%; }
  .dfg-step__rowlabel { min-width: 28px; }
}
</style>
