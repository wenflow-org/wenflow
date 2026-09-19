<template>
  <div class="dfg" :style="semanticVars">
    <MkLoading v-if="loading" />
    <MkEmptyState v-else-if="error" tone="error" :title="error" action-text="重试" @action="load" />

    <!-- 工作区：工具栏 + 流水线画布 -->
    <div v-else class="dfg-frame">
      <div class="dfg-toolbar">
        <div class="dfg-toolbar__status">
          <span class="dfg-stage-dot" :style="{ background: toneOf(flow?.stageId || '').hue }"></span>
          <strong class="dfg-title">{{ flow?.stageName || '' }}<span class="dfg-title__agent mono"> {{ flow?.agentId }}</span></strong>
          <span class="dfg-meta">{{ flow?.fieldCount || 0 }} 字段 · {{ flow?.steps.length || 0 }} 步</span>
          <template v-if="flow">
            <span class="dfg-meta" :class="{ 'dfg-meta--bad': flow.stats.failed > 0 }">
              {{ fmtCalls(flow.stats.calls) }} 调用<template v-if="flow.stats.failed"> · {{ fmtCalls(flow.stats.failed) }}✗</template>
            </span>
            <span
              v-if="flow.edgeStats"
              class="dfg-meta"
              :class="{ 'dfg-meta--bad': flow.edgeStats.deadEdgeCount > 0 }"
              :title="edgeSummaryTitle(flow.edgeStats)"
            >
              ⇄ 调用用量 {{ flow.edgeStats.usedEdgeCount }}/{{ flow.edgeStats.edgeCount }} 活跃<template v-if="flow.edgeStats.deadEdgeCount"> · {{ flow.edgeStats.deadEdgeCount }} 死边</template>
            </span>
            <span
              v-if="flow.fieldStats"
              class="dfg-meta"
              :class="{ 'dfg-meta--bad': flow.fieldStats.deadCount > 0 || flow.fieldStats.driftCount > 0 }"
              :title="fieldSummaryTitle(flow.fieldStats)"
            >
              ◇ 字段 {{ flow.fieldStats.producedCount }}/{{ flow.fieldStats.fieldCount }} 产出<template v-if="flow.fieldStats.deadCount"> · {{ flow.fieldStats.deadCount }} 死</template><template v-if="flow.fieldStats.driftCount"> · {{ flow.fieldStats.driftCount }} 漂移</template>
            </span>
          </template>
        </div>
        <div class="dfg-toolbar__controls">
          <div class="dfg-search">
            <input
              v-model="query"
              type="search"
              class="dfg-search__input"
              placeholder="搜索字段 / 数据族 / Skill…"
              spellcheck="false"
              @input="onQueryInput"
            />
            <button v-if="query" type="button" class="dfg-search__clear" title="清除" @click="clearQuery">✕</button>
          </div>
          <label class="dfg-switch" title="显示管线中的隐藏字段（render=hidden，含内部信令与累积字段）">
            <input type="checkbox" v-model="showHidden" />
            <span>隐藏字段</span>
          </label>
          <label class="dfg-switch" title="默认淡化连线，仅悬停/聚焦时点亮；关闭则不显示步间连线">
            <input type="checkbox" v-model="edgeFaded" />
            <span>连线</span>
          </label>
        </div>
      </div>

      <!-- 图性质说明：本图是字段数据旅程（逻辑图·字段血缘），非拓扑图 -->
      <p class="dfg-caption">
        <strong>字段数据旅程（逻辑图 · 字段血缘）</strong>——按字段流转组织；
        <b class="dfg-caption__ann">⇄</b> 数字为 <span class="mono">agent→skill</span> 调用用量注解
      </p>

      <!-- 旅程概览条：上一阶段 ⇣ 本 Agent ⇣ 下一阶段（一眼看清跨越边界） -->
      <div v-if="flow" class="dfg-journey">
        <button
          v-if="flow.entryFrom"
          type="button"
          class="dfg-journey__node dfg-journey__node--up"
          @click="switchStage(flow.entryFrom!.stageId)"
        >
          <span class="dfg-journey__dir">↑ 来自</span>
          <strong>{{ flow.entryFrom.stageName }}</strong>
          <span class="dfg-journey__meta">{{ flow.entry.length }} 字段交接</span>
        </button>
        <span v-else-if="flow.stageId === 'goal'" class="dfg-journey__node dfg-journey__node--up is-start">
          <span class="dfg-journey__dir">↑ 数据起点</span>
          <strong>学习者目标输入</strong>
          <span class="dfg-journey__meta">由目标对话发起，进入 goal-agent</span>
        </span>
        <span v-else class="dfg-journey__node dfg-journey__node--up is-empty">
          <span class="dfg-journey__dir">↑ 无上游交接</span>
          <strong>独立接收输入</strong>
          <span class="dfg-journey__meta">{{ flow.agentId }} 不接收其它阶段移交的字段</span>
        </span>
        <span class="dfg-journey__pipe">
          <i :style="{ background: toneOf(flow.stageId).hue }"></i>
          <span class="dfg-journey__hub mono">{{ flow.agentId }}</span>
          <i :style="{ background: toneOf(flow.stageId).hue }"></i>
        </span>
        <button
          v-if="flow.exitTo"
          type="button"
          class="dfg-journey__node dfg-journey__node--down"
          @click="switchStage(flow.exitTo!.stageId)"
        >
          <span class="dfg-journey__dir">↓ 交给</span>
          <strong>{{ flow.exitTo.stageName }}</strong>
          <span class="dfg-journey__meta">{{ flow.exit.length }} 字段移交</span>
        </button>
        <span v-else class="dfg-journey__node dfg-journey__node--down is-end">
          <span class="dfg-journey__dir">↓ 数据终点</span>
          <strong>累积进学习者状态</strong>
          <span class="dfg-journey__meta">{{ flow.agentId }} 不再向下游移交字段</span>
        </span>
      </div>

      <div
        ref="pipeRef"
        class="dfg-pipe"
        :class="{ 'is-dimmed': !!focusKey }"
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
                :class="{ 'is-hot': e.highlight, 'is-dead': e.dead }"
                stroke-linecap="round"
              />
              <circle :cx="e.x1" :cy="e.y1" r="3" :fill="e.hue" :opacity="e.dotOp" />
              <path :d="e.arrow" :fill="e.hue" :opacity="e.dotOp" />
            </template>
          </g>
        </svg>

        <!-- ===== ① 入口交接（跨阶段输入） ===== -->
        <section v-if="flow && entryVisible.length" data-card-key="__entry__" class="dfg-gate dfg-gate--entry" :class="{ 'is-flash': flashKey === '__entry__' }" :style="{ '--hz': toneOf(flow.entryFrom?.stageId || '').hue }">
          <header class="dfg-gate__head">
            <span class="dfg-gate__icon">⇣</span>
            <div class="dfg-gate__title">
              <strong>入口 · 来自 {{ flow.entryFrom?.stageName }}</strong>
              <span class="dfg-gate__sub">{{ entryVisible.length }} 个字段经 {{ flow.entryFrom?.stageId }}-agent 移交进入本阶段</span>
            </div>
            <span class="dfg-gate__count">{{ entryVisible.length }} 字段</span>
            <span v-for="p in farPorts['__entry__'] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)" :title="`长程字段流入 ${p.peerLabel}（点击定位）`">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
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
            <button v-if="entryVisible.length > ENTRY_LIMIT && !expandedEntry" type="button" class="dfg-chip dfg-chip--more" @click="expandedEntry = true">
              +{{ entryVisible.length - ENTRY_LIMIT }} 更多
            </button>
          </div>
        </section>

        <!-- ===== 中间：Agent 内部步骤链 ===== -->
        <template v-for="step in flowSteps" :key="step.index">
          <!-- 桥接闸口（入口整装 / 分发） -->
          <section v-if="step.kind === 'bridge-entry' && step.outputChips.length" :data-card-key="step.agentId" class="dfg-step dfg-step--gate" :class="{ 'is-flash': flashKey === step.agentId }" :style="{ '--hz': toneOf(flow!.stageId).hue }">
            <header class="dfg-step__head">
              <span class="dfg-step__idx">⇡</span>
              <strong class="dfg-step__name">{{ step.name }}</strong>
              <span class="dfg-step__badge dfg-step__badge--gate">入口整装</span>
              <span class="dfg-step__agent mono">{{ step.agentId }}</span>
              <template v-if="step.calls != null">
                <span class="dfg-step__stat" :class="{ 'is-err': step.failed > 0 }">{{ fmtCalls(step.calls) }} 调用<template v-if="step.failed"> · {{ fmtCalls(step.failed) }}✗</template></span>
              </template>
              <span class="dfg-step__spacer"></span>
              <span class="dfg-step__count">{{ step.outputChips.length }} 字段</span>
              <span v-for="p in farPorts[step.agentId] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)" :title="`长程字段${p.dir === 'out' ? '流向' : '来自'} ${p.peerLabel}（点击定位）`">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
            </header>
            <div class="dfg-step__body">
              <p class="dfg-step__note">上游字段在阶段闸口完成整装重命名，再分发给内部 Skill（字段带 → 目标 标签）</p>
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
                  <span v-if="c.internal" class="dfg-chip__flag" title="内部信令">内</span>
                  <span v-if="c.handoffTargets.length" class="dfg-chip__to mono">{{ c.toTags.length ? c.toTags[0].label : c.handoffTargets[0] }}<template v-if="c.handoffTargets.length > 1"> +{{ c.handoffTargets.length - 1 }}</template></span>
                </button>
                <button v-if="stepFolded(step, 'out') > 0" type="button" class="dfg-chip dfg-chip--more" @click="toggleStep(step)">
                  +{{ stepFolded(step, 'out') }} 更多
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
              <span v-else class="dfg-step__badge dfg-step__badge--warn" title="该 Skill 已在 agents 注册并产生调用，但无字段路由契约，未接入数据流水线">无数据契约</span>
              <span v-if="step.unresolved" class="dfg-step__badge dfg-step__badge--warn" title="编排定义中该步骤未解析到契约">未解析</span>
              <span v-if="step.fromStage" class="dfg-step__stage mono" @click="switchStage(step.fromStage!)" title="点击跳到该阶段">→ {{ stageNameOf(step.fromStage) }}</span>
              <span v-if="step.role" class="dfg-step__role">{{ step.role }}</span>
              <template v-if="step.kind === 'orphan' && step.calls != null">
                <span class="dfg-step__agent mono">{{ step.agentId }}</span>
                <span class="dfg-step__stat" :class="{ 'is-err': step.failed > 0 }">{{ fmtCalls(step.calls) }} 调用<template v-if="step.failed"> · {{ fmtCalls(step.failed) }}✗</template></span>
              </template>
              <span class="dfg-step__spacer"></span>
              <span v-if="step.condition" class="dfg-step__cond" :title="step.condition">触发：{{ step.condition }}</span>
              <span v-if="step.loopOver" class="dfg-step__cond" :title="`循环 ${step.loopOver}`">循环：{{ step.loopOver }}</span>
              <span v-if="step.kind === 'orphan'" class="dfg-step__count" title="该 Skill 无字段路由行，不参与阶段内数据流转">无字段流转</span>
              <span v-for="p in farPorts[step.agentId] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)" :title="`长程字段${p.dir === 'out' ? '流向' : '来自'} ${p.peerLabel}（点击定位）`">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
            </header>
          </section>

          <!-- Skill 步骤卡 -->
          <section v-else :data-card-key="step.agentId" class="dfg-step" :class="{ 'has-inputs': step.inputChips.length, 'is-flash': flashKey === step.agentId, 'is-dead-edge': step.handoff?.dead }" :style="{ '--hz': stepHue(step) }">
            <header class="dfg-step__head">
              <span class="dfg-step__idx">{{ step.index }}</span>
              <strong class="dfg-step__name">{{ step.name }}</strong>
              <span class="dfg-step__badge">Skill</span>
              <span v-if="step.unresolved" class="dfg-step__badge dfg-step__badge--warn" title="编排定义中该步骤未解析到契约">未解析</span>
              <span class="dfg-step__agent mono">{{ step.agentId }}</span>
              <template v-if="step.calls != null">
                <span class="dfg-step__stat" :class="{ 'is-err': step.failed > 0 }">{{ fmtCalls(step.calls) }} 调用<template v-if="step.failed"> · {{ fmtCalls(step.failed) }}✗</template></span>
              </template>
              <span
                v-if="step.handoff"
                class="dfg-edge-stat"
                :class="{ 'is-dead': step.handoff.dead, 'is-warn': !step.handoff.dead && (step.handoff.successRate ?? 100) < 90 }"
                :title="edgeTitle(step)"
              >⇄ {{ step.handoff.dead ? '未调用' : `${fmtCalls(step.handoff.calls)} · ${step.handoff.successRate ?? '—'}%` }}</span>
              <span
                v-if="step.fieldStat && (step.fieldStat.dead || step.fieldStat.drift)"
                class="dfg-field-stat"
                :class="{ 'is-dead': step.fieldStat.dead > 0, 'is-drift': step.fieldStat.dead === 0 && step.fieldStat.drift > 0 }"
                :title="`字段运行时：产出 ${step.fieldStat.produced} · 死字段 ${step.fieldStat.dead} · 漂移 ${step.fieldStat.drift}`"
              >◇ {{ step.fieldStat.produced }} 产出<template v-if="step.fieldStat.dead"> · {{ step.fieldStat.dead }} 死</template><template v-if="step.fieldStat.drift"> · {{ step.fieldStat.drift }} 漂移</template></span>
              <span class="dfg-step__spacer"></span>
              <span v-if="step.condition" class="dfg-step__cond" :title="step.condition">触发：{{ step.condition }}</span>
              <span v-if="step.loopOver" class="dfg-step__cond" :title="`循环 ${step.loopOver}`">循环：{{ step.loopOver }}</span>
              <span class="dfg-step__count">{{ step.outputChips.length }} 产出</span>
              <span v-for="p in farPorts[step.agentId] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)" :title="`长程字段${p.dir === 'out' ? '流向' : '来自'} ${p.peerLabel}（点击定位）`">{{ p.dir === 'out' ? '↳' : '来自' }} {{ p.peerLabel }}<b>{{ p.count }}</b></span>
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
                      <span v-if="c.internal" class="dfg-chip__flag" title="内部信令">内</span>
                      <span v-if="c.accumulate" class="dfg-chip__flag dfg-chip__flag--accum" title="累积进学习者状态">累</span>
                    </button>
                    <button v-if="stepFolded(step, 'in') > 0" type="button" class="dfg-chip dfg-chip--more" @click="toggleStep(step)">
                      +{{ stepFolded(step, 'in') }} 更多
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
                      <span v-if="c.internal" class="dfg-chip__flag" title="内部信令">内</span>
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
                    <button v-if="stepFolded(step, 'out') > 0" type="button" class="dfg-chip dfg-chip--more" @click="toggleStep(step)">
                      +{{ stepFolded(step, 'out') }} 更多
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>

        <!-- ===== ② 出口移交（跨阶段输出） ===== -->
        <section v-if="flow && flow.exit.length" data-card-key="__exit__" class="dfg-gate dfg-gate--exit" :class="{ 'is-flash': flashKey === '__exit__' }" :style="{ '--hz': toneOf(flow.exitTo?.stageId || '').hue }">
          <header class="dfg-gate__head">
            <span class="dfg-gate__icon">⇢</span>
            <div class="dfg-gate__title">
              <strong>出口 · 交给 {{ flow.exitTo?.stageName }}</strong>
              <span class="dfg-gate__sub">{{ flow.agentId }} 汇总 {{ flow.exit.length }} 个字段，整体移交下一阶段</span>
            </div>
            <span class="dfg-gate__count">{{ flow.exit.length }} 字段</span>
            <span v-for="p in farPorts['__exit__'] || []" :key="p.dir + p.peer" class="dfg-step__port" @click="focusCard(p.peer)" :title="`长程字段来自 ${p.peerLabel}（点击定位）`">来自 {{ p.peerLabel }}<b>{{ p.count }}</b></span>
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
              <span v-if="c.internal" class="dfg-chip__flag" title="内部信令">内</span>
              <span v-if="c.accumulate" class="dfg-chip__flag dfg-chip__flag--accum" title="累积进学习者状态">累</span>
            </button>
            <button v-if="(flow && flow.exit.length > ENTRY_LIMIT && !expandedEntry)" type="button" class="dfg-chip dfg-chip--more" @click="expandedEntry = true">
              +{{ (flow ? flow.exit.length : 0) - ENTRY_LIMIT }} 更多
            </button>
          </div>
        </section>

        <!-- 空态 -->
        <p v-if="flow && !flow.steps.length && !flow.entry.length && !flow.exit.length" class="dfg-empty">该阶段暂无字段路由数据</p>
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
        :title="`高亮数据族 ${f.name}（${f.count} 个字段）`"
        @click="toggleFamily(f.name)"
        @mouseenter="hoverFamily = f.name"
        @mouseleave="hoverFamily = ''"
      >
        <i :style="{ background: f.hue }"></i>{{ f.name }}<b>{{ f.count }}</b>
      </button>
      <span class="dfg-legend__hint">点色块字段 / 族名可高亮「同一条数据的旅程」</span>
    </div>

    <!-- 字段运行时命中率图例（Q9 后半程；无数据时不渲染） -->
    <div v-if="flow && flow.fieldStats" class="dfg-field-legend">
      <span class="dfg-field-legend__title">字段运行时</span>
      <span class="dfg-field-legend__item"><i class="dfg-field-legend__dot is-produced"></i>产出 {{ flow.fieldStats.producedCount }}</span>
      <span class="dfg-field-legend__item"><i class="dfg-field-legend__dot is-dead"></i>死字段 {{ flow.fieldStats.deadCount }}</span>
      <span class="dfg-field-legend__item"><i class="dfg-field-legend__dot is-drift"></i>契约漂移 {{ flow.fieldStats.driftCount }}</span>
      <span v-if="flow.fieldStats.deadRoutingEdges" class="dfg-field-legend__item"><i class="dfg-field-legend__dash"></i>死 routing 边 {{ flow.fieldStats.deadRoutingEdges }}</span>
      <span class="dfg-field-legend__hint" :title="fieldSummaryTitle(flow.fieldStats)">命中率来自 prompt_call_logs 窗口聚合（悬停字段卡看 hits/调用/命中率）</span>
    </div>

    <!-- 字段详情抽屉（含行级编辑，同步回写编排文件） -->
    <Teleport to="body">
      <div v-if="selected" class="mk-drawer">
        <div class="mk-drawer__mask" @click="selected = null"></div>
        <aside class="mk-drawer__panel dfg-drawer" role="dialog" aria-label="字段详情" :style="semanticVars">
          <div class="mk-drawer__head">
            <div>
              <h3 class="mk-drawer__title mono">{{ selected.fieldId }}</h3>
              <p class="mk-drawer__sub">{{ selected.description || '—' }}</p>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="selected = null">✕</button>
          </div>

          <div class="dfg-drawer__body">
            <dl class="dfg-dl">
              <div class="dfg-dl__row">
                <dt>产出方</dt>
                <dd class="mono">{{ selected.agentId }}</dd>
              </div>
              <div class="dfg-dl__row">
                <dt>数据族</dt>
                <dd>
                  <span class="dfg-dl__family" :style="{ background: selected.hue }"></span>{{ selected.family }}
                </dd>
              </div>
              <div class="dfg-dl__row">
                <dt>类型</dt>
                <dd class="mono">{{ selected.valueType || '—' }}</dd>
              </div>
              <div class="dfg-dl__row">
                <dt>角色</dt>
                <dd><span class="mk-badge" :class="`mk-badge--role-${selected.role}`">{{ roleLabel(selected.role) }}（{{ selected.role }}）</span></dd>
              </div>
              <div class="dfg-dl__row">
                <dt>可见性</dt>
                <dd>
                  <span class="mk-badge" :class="`mk-badge--render-${selected.render}`">{{ selected.render }}</span>
                  <span v-if="selected.internal" class="dfg-tag dfg-tag--internal">内部信令</span>
                  <span v-if="selected.accumulate" class="dfg-tag dfg-tag--accum">累积进学习者状态</span>
                </dd>
              </div>
              <div class="dfg-dl__row">
                <dt>落库键</dt>
                <dd class="mono">{{ selected.persistKey || selected.fieldId }}</dd>
              </div>
              <div class="dfg-dl__row" v-if="selected.pathInRawOutput">
                <dt>抽取路径</dt>
                <dd class="mono">{{ selected.pathInRawOutput }}</dd>
              </div>
              <div class="dfg-dl__row">
                <dt>锁定</dt>
                <dd><span class="mk-badge" :class="`mk-badge--lock-${selected.lockLevel}`">{{ lockLabel(selected.lockLevel) }}</span></dd>
              </div>
              <div class="dfg-dl__row" v-if="selected.notes">
                <dt>备注</dt>
                <dd>{{ selected.notes }}</dd>
              </div>
            </dl>

            <!-- 数据旅程：这条数据在管线里的位置 -->
            <div class="dfg-flow">
              <h4 class="dfg-dl__title">数据旅程</h4>
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
            </div>

            <!-- 行级编辑（仅可编辑行） -->
            <div v-if="!selected.locked" class="dfg-edit">
              <h4 class="dfg-dl__title">行级编辑（会同步回写编排文件）</h4>
              <div class="dfg-edit__row">
                <span class="dfg-edit__label">可见性</span>
                <span class="dfg-edit__pills">
                  <button type="button" class="dfg-pill" :class="{ 'is-on': editDraft.render === 'visible' }" @click="editDraft.render = 'visible'">可见</button>
                  <button type="button" class="dfg-pill" :class="{ 'is-on': editDraft.render === 'hidden' }" @click="editDraft.render = 'hidden'">隐藏</button>
                </span>
              </div>
              <div class="dfg-edit__row">
                <span class="dfg-edit__label">移交（handoff）</span>
                <input v-model="editDraft.handoffText" class="dfg-edit__input mono" placeholder="阶段名 / skill:id / agent，逗号分隔；空 = 不转交" spellcheck="false" />
              </div>
              <div class="dfg-edit__row">
                <span class="dfg-edit__label">累积</span>
                <label class="dfg-check"><input type="checkbox" v-model="editDraft.accumulate" /><span>accumulate（累积进学习者状态）</span></label>
              </div>
              <div class="dfg-edit__row">
                <span class="dfg-edit__label">内部</span>
                <label class="dfg-check"><input type="checkbox" v-model="editDraft.internal" /><span>internal（仅供 UI / 平台内部消费）</span></label>
              </div>
              <div class="dfg-edit__row">
                <span class="dfg-edit__label">备注</span>
                <input v-model="editDraft.notes" class="dfg-edit__input" placeholder="备注（可选）" spellcheck="false" />
              </div>
              <p v-if="editMsg" class="dfg-edit__msg" :class="{ 'is-error': editError }">{{ editMsg }}</p>
              <div class="dfg-edit__actions">
                <button type="button" class="mk-btn" :disabled="saving" @click="resetDraft">还原</button>
                <button type="button" class="mk-btn mk-btn--primary" :disabled="saving || !dirty" @click="saveEdit">
                  {{ saving ? '保存中…' : '保存修改' }}
                </button>
              </div>
            </div>
            <div v-else class="dfg-edit dfg-edit--locked">
              <h4 class="dfg-dl__title">行级编辑</h4>
              <p class="dfg-edit__locked-hint">该字段为系统锁/结构锁：属性由编排文件或代码派生，请使用「编排文件」入口修改。</p>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { adminAgentTopologyApi, adminFieldRoutingsApi, adminRuntimeDefinitionsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'
import { liveTopoNodes, liveTopoRange } from './live'
import {
  buildStageFlow, fmtCalls, familyHue, type FlowChip, type FlowStep, type StageFlow, type DefStepLike, type TopoEdgeLike,
  type FieldStat, type FieldStatsBlock,
  STAGE_ORDER, STAGE_LABELS,
} from './dataFlow'
import type { StageDetailLike } from './fieldFlowLayout'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { AGENT_TONES } from './store'

/* ================= props / emits（与 FieldFlowGraph 同接口，Orchestrator 无缝替换） ================= */
const props = defineProps<{ stage: string }>()
const emit = defineEmits<{ changed: []; stage: [string] }>()

/* ================= 状态 ================= */
const loading = ref(false)
const error = ref('')
const detailByStage = ref<Record<string, StageDetailLike | null>>({})
const orchDefs = ref<Record<string, DefStepLike[]>>({})
const stageNames = ref<Record<string, string>>({})
/** 调用隶属边（agent→skill，含后端 Q9 调用用量 stats）；供步骤卡渲染调用量/成功率/未调用 */
const topoEdges = ref<TopoEdgeLike[]>([])
/** 字段级运行时命中率块（后端 Q9 后半程；缺省 = 旧后端，无视觉变化） */
const fieldStatsRaw = ref<FieldStatsBlock | null>(null)
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
    const [stagesRes, defRes, topoRes] = await Promise.all([
      adminFieldRoutingsApi.getStages().catch(() => null),
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions().catch(() => null),
      adminAgentTopologyApi.getTopology(liveTopoRange.value).catch(() => null),
    ])
    // 隶属边用量与节点统计同源（同 range）；拉取失败时置空 → 图退回无边缘统计
    const topoBody = topoRes?.data?.data ?? topoRes?.data ?? {}
    topoEdges.value = Array.isArray(topoBody.edges) ? (topoBody.edges as TopoEdgeLike[]) : []
    // 字段命中率与拓扑同源同响应；缺失 / 旧后端 → null（图退回无字段状态）
    fieldStatsRaw.value = (topoBody.fieldStats as FieldStatsBlock | null) ?? null
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
    let firstErr = ''
    results.forEach((r, i) => {
      const s = STAGE_ORDER[i]
      if (r.status === 'fulfilled') {
        next[s] = r.value.detail
      } else {
        next[s] = null
        if (!firstErr) firstErr = (r.reason as any)?.response?.data?.error?.message || (r.reason as any)?.message || `阶段 ${s} 加载失败`
      }
    })
    detailByStage.value = next
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
  const topo = liveTopoNodes.value
  const out: Record<string, StageFlow> = {}
  for (const sid of STAGE_ORDER) {
    const d = detailByStage.value[sid]
    if (!d) continue
    out[sid] = buildStageFlow(sid, d, detailByStage.value, defByAgent[`${sid}-agent`] || [], topo as any, names, topoEdges.value, fieldStatsRaw.value)
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
  if (level === 'system-locked') return '系统锁'
  if (level === 'structure-locked') return '结构锁'
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
  /** 本步骤产出字段的运行时状态计数（Q9 后半程；无数据时全 0） */
  fieldStat: { produced: number; dead: number; drift: number }
}
function visibleChips(chips: FlowChip[]) {
  return showHidden.value ? chips : chips.filter((c) => c.render === 'visible' || c.handoffTargets.length > 0 || c.accumulate)
}
const ENTRY_LIMIT = 8
const OUTPUT_LIMIT = 8
const INPUT_LIMIT = 6
const expandedEntry = ref(false)
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

const entryVisible = computed(() => visibleChips(flow.value?.entry || []))
const entryShown = computed(() => (expandedEntry.value ? entryVisible.value : entryVisible.value.slice(0, ENTRY_LIMIT)))
const exitShown = computed(() => (expandedEntry.value ? flow.value?.exit || [] : (flow.value?.exit || []).slice(0, ENTRY_LIMIT)))

/* ================= 步骤卡芯片（过滤 + 折叠后） ================= */

/** 步骤 + 可见芯片副本（模板直接使用；filter 与折叠状态驱动轨道线重算） */
const flowSteps = computed(() => {
  const f = flow.value
  if (!f) return []
  return f.steps.map((s) => {
    const inputChips = visibleChips(s.inputs)
    const outputChips = visibleChips(s.outputs)
    const fieldStat = { produced: 0, dead: 0, drift: 0 }
    for (const c of outputChips) {
      if (!c.field) continue
      if (c.field.status === 'dead') fieldStat.dead++
      else if (c.field.status === 'drift') fieldStat.drift++
      else fieldStat.produced++
    }
    return {
      ...s,
      inputChips,
      outputChips,
      chips: [...inputChips, ...outputChips],
      fieldStat,
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
    'is-field-dead': c.field?.status === 'dead',
    'is-field-drift': c.field?.status === 'drift',
  }
}
function onQueryInput() {
  const q = query.value.trim().toLowerCase()
  if (!q) { focusId.value = ''; return }
  const all = flowSteps.value.flatMap((s) => [...s.inputChips, ...s.outputChips])
  const hit = all.find((c) =>
    c.fieldId.toLowerCase().includes(q) ||
    c.family.toLowerCase().includes(q) ||
    c.agentId.toLowerCase().includes(q) ||
    c.description.toLowerCase().includes(q) ||
    (c.persistKey || '').toLowerCase().includes(q)
  )
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
const pipeRef = ref<HTMLElement | null>(null)
const pipeW = ref(0)
const pipeH = ref(0)
const edgeGeoms = ref<EdgeGeom[]>([])
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
    /** 产出字段为死字段（Q9 后半程；虚线灰渲染） */
    dead: boolean
  }
  const FAR_SPAN = 700
  const laneOf = (i: number) => i % 4
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const nodeRects = ref(new Map<string, DOMRect>())
// 槽位 → 所属卡片 key；卡片 key → 管道局部矩形（端口总线锚点用）
let slotCard = new Map<string, string>()
let cardRects = new Map<string, DOMRect>()

function measure() {
  const root = pipeRef.value
  if (!root) return
  const rr = root.getBoundingClientRect()
  pipeW.value = root.scrollWidth
  pipeH.value = root.scrollHeight
  const map = new Map<string, DOMRect>()
  const slotMap = new Map<string, string>()
  const cardMap = new Map<string, DOMRect>()
  for (const el of root.querySelectorAll<HTMLElement>('[data-card-key]')) {
    const key = el.getAttribute('data-card-key') || ''
    const r = el.getBoundingClientRect()
    cardMap.set(key, new DOMRect(r.left - rr.left, r.top - rr.top, r.width, r.height))
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-chip-id][data-chip-role]')) {
    const id = `${el.getAttribute('data-chip-id')}|${el.getAttribute('data-chip-role')}`
    const r = el.getBoundingClientRect()
    map.set(id, new DOMRect(r.left - rr.left, r.top - rr.top, r.width, r.height))
    const card = el.closest<HTMLElement>('[data-card-key]')
    if (card) slotMap.set(id, card.getAttribute('data-card-key') || '')
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-gate-anchor]')) {
    const id = `gate|${el.getAttribute('data-gate-anchor')}`
    const r = el.getBoundingClientRect()
    map.set(id, new DOMRect(r.left - rr.left, r.top - rr.top, r.width, r.height))
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
  if (key === '__entry__') return f.entryFrom?.stageName ? `入口·${f.entryFrom.stageName}` : '链首'
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
    // 端口锚点：宿主卡「右缘」，y = 芯片中线（钳制在卡内）——线不进入卡片内部
    const x1 = srcCard.right
    const y1 = clamp(srcChip.top + srcChip.height / 2, srcCard.top + 4, srcCard.bottom - 4)
    const x2 = dstCard.right
    const y2 = clamp(dstChip.top + dstChip.height / 2, dstCard.top + 4, dstCard.bottom - 4)
    const linked = relatedIds.value.has(e.from) && relatedIds.value.has(e.to)
    const highlight = linked
      || (!!hoverChip.value && hoverChip.value === e.from)
      || (!!familyFocus.value && e.fieldId.startsWith(`${familyFocus.value}.`))
    const dimmed = (!!focusId.value || !!familyFocus.value || !!hoverChip.value) && !linked
    const spanY = Math.abs(y2 - y1)
    const mode: EdgeMode = spanY > FAR_SPAN ? 'far' : 'near'
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
    // Bus 正交折线：卡右缘 → 走廊竖走 → 目标卡右缘，Q 圆角
    const busX = x1 + 40 - laneOf(lane++) * 9
    let d: string
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
    outs.push({
      d,
      hue: e.hue,
      x1, y1, x2, y2,
      arrow: `M ${x2 + 7} ${y2 - 4.2} L ${x2} ${y2} L ${x2 + 7} ${y2 + 4.2} Z`,
      op,
      dotOp,
      highlight,
      dimmed,
      mode,
      fieldId: e.fieldId, from: e.from, to: e.to,
      dead: !!e.dead,
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
function scheduleMeasure() {
  cancelAnimationFrame(measureRaf)
  measureRaf = requestAnimationFrame(async () => {
    await nextTick()
    measure()
  })
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  scheduleMeasure()
  resizeObserver = new ResizeObserver(() => scheduleMeasure())
  if (pipeRef.value) resizeObserver.observe(pipeRef.value)
  window.addEventListener('resize', scheduleMeasure)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(measureRaf)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleMeasure)
})
watch(flowSteps, scheduleMeasure, { deep: true })
watch(edgeSet, scheduleMeasure)
watch(showHidden, scheduleMeasure)
watch(focusId, scheduleMeasure)
watch(expandedEntry, scheduleMeasure)
watch(expandedSteps, scheduleMeasure, { deep: true })
watch(() => flow.value?.stageId, scheduleMeasure)
// hover / 数据族聚焦只影响边的高亮态（无需重测 DOM），轻量重算几何
watch(hoverChip, () => { if (nodeRects.value.size) renderEdges() })
watch(familyFocus, () => { if (nodeRects.value.size) renderEdges() })
watch(edgeFaded, () => { if (nodeRects.value.size) renderEdges() })

/* ================= 抽屉 ================= */
function fieldPct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`
}

/** 字段运行时状态行（tooltip；死字段/漂移/正常产出） */
function fieldStatLine(f: FieldStat): string {
  const label = f.status === 'dead' ? '死字段（声明/路由根窗口内零产出）' : f.status === 'drift' ? '契约漂移（产出但 core 未声明）' : '正常产出'
  return `字段命中：${f.hits}/${f.totalCalls} = ${fieldPct(f.hitRate)} · ${label}`
}

function chipTitle(c: FlowChip) {
  const parts = [c.description || c.fieldId]
  if (c.field) parts.push(fieldStatLine(c.field))
  if (c.handoffTargets.length) parts.push(`移交 → ${c.handoffTargets.join(', ')}`)
  if (c.pathInRawOutput) parts.push(`抽取路径：${c.pathInRawOutput}`)
  if (c.persistKey && c.persistKey !== c.fieldId) parts.push(`落库键：${c.persistKey}`)
  return parts.join('\n')
}

/** 调用用量 tooltip：agent→skill 调用/失败/成功率/末次出现（Q9 注解） */
function edgeTitle(step: FlowStep) {
  const h = step.handoff
  if (!h) return ''
  const rate = h.successRate == null ? '—' : `${h.successRate}%`
  const last = h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleString() : '窗口内无记录'
  return [
    `调用用量 ${flow.value?.agentId || ''} → ${step.agentId}（agent→skill 注解）`,
    `调用 ${h.calls} 次 · 失败 ${h.failed} · 成功率 ${rate}`,
    `末次出现：${last}`,
    h.dead ? '⚠ 窗口内零调用（未调用 / 死边候选）' : '',
  ].filter(Boolean).join('\n')
}

/** 阶段调用用量汇总 tooltip（agent→skill） */
function edgeSummaryTitle(s: NonNullable<StageFlow['edgeStats']>) {
  return [
    `本阶段调用用量 ${s.edgeCount} 条（agent→skill）· 窗口内活跃 ${s.usedEdgeCount} · 零调用 ${s.deadEdgeCount}`,
    `调用合计 ${s.totalCalls} · 失败 ${s.failed}`,
  ].join('\n')
}

/** 阶段字段级运行时命中率汇总 tooltip（Q9 后半程） */
function fieldSummaryTitle(s: NonNullable<StageFlow['fieldStats']>) {
  return [
    '字段级运行时命中率（prompt_call_logs 窗口聚合 · 顶层键口径）',
    `本阶段字段 ${s.fieldCount} · 产出 ${s.producedCount} · 死字段 ${s.deadCount} · 漂移 ${s.driftCount}`,
    `死 routing 边 ${s.deadRoutingEdges}`,
    '⚠ 媒体产物 / deltaOutput / 校验归一化会造成死字段、漂移误报',
  ].join('\n')
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
  if (consumers.length) return `同名字段在管线中以轨道线相连：由上方步骤产出后，流转到 ${consumers.join('、')} 继续消费。`
  if (flow.value?.exit.some((x) => x.fieldId === c.fieldId)) return `该字段已汇总到出口闸口，整体移交下一阶段。`
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
/* 工作区卡 */
.dfg-frame {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-graph-canvas);
  overflow: hidden;
  box-shadow: var(--mk-shadow-sm);
}
.dfg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: linear-gradient(180deg, var(--mk-graph-toolbar-a), var(--mk-graph-toolbar-b));
  border-bottom: 1px solid var(--mk-line);
}
.dfg-toolbar__status { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.dfg-stage-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.12); }
.dfg-title { font-size: 13.5px; font-weight: 800; color: var(--mk-ink); }
.dfg-title__agent { font-size: 11px; font-weight: 600; color: var(--mk-faint); }
.dfg-meta { font-size: var(--mk-fs-12); font-weight: 600; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.dfg-meta--bad { color: var(--mk-red); font-weight: 700; }
.dfg-toolbar__controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dfg-search { position: relative; display: inline-flex; align-items: center; }
.dfg-search__input {
  width: 200px;
  padding: 5px 26px 5px 10px;
  border: 1px solid var(--mk-line); border-radius: 8px;
  font: inherit; font-size: var(--mk-fs-12);
  background: var(--mk-graph-field);
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.dfg-search__input:focus { border-color: var(--mk-blue); box-shadow: 0 0 0 3px rgba(44, 99, 208, 0.12); }
.dfg-search__clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 50%; background: var(--mk-graph-clear-bg); color: var(--mk-muted);
  font-size: 9px; line-height: 1; cursor: pointer; padding: 0;
}
.dfg-search__clear:hover { background: var(--mk-graph-clear-bg-hover); color: var(--mk-ink); }
.dfg-switch { display: inline-flex; align-items: center; gap: 5px; font-size: var(--mk-fs-12); color: var(--mk-muted); cursor: pointer; }

/* 图性质说明（字段数据旅程 / 逻辑图） */
.dfg-caption {
  margin: 0; padding: 5px 14px;
  background: var(--mk-graph-canvas-2);
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-11); color: var(--mk-faint);
}
.dfg-caption strong { color: var(--mk-muted); font-weight: 800; }
.dfg-caption__ann { color: var(--mk-blue); font-weight: 800; }

/* 旅程概览条 */
.dfg-journey {
  display: flex; align-items: stretch; gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, var(--mk-graph-journey-a), var(--mk-graph-journey-b));
  border-bottom: 1px solid var(--mk-line);
}
.dfg-journey__node {
  flex: 1; min-width: 0;
  display: grid; gap: 1px; align-content: center;
  padding: 7px 12px;
  border: 1px solid var(--mk-line); border-radius: 10px;
  background: var(--mk-graph-node-bg); font: inherit; text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.dfg-journey__node:hover { border-color: var(--mk-blue); box-shadow: 0 2px 8px rgba(44, 99, 208, 0.1); }
.dfg-journey__node.is-empty { cursor: default; background: var(--mk-graph-canvas-2); }
.dfg-journey__node.is-start {
  cursor: default;
  background: linear-gradient(180deg, var(--mk-graph-node-top), var(--mk-graph-start-b));
  border-color: color-mix(in srgb, var(--fam-path) 36%, var(--mk-line));
  border-style: dashed;
}
.dfg-journey__node.is-start .dfg-journey__dir { color: var(--fam-path); }
.dfg-journey__node.is-end {
  cursor: default;
  background: linear-gradient(180deg, var(--mk-graph-node-top), var(--mk-graph-end-b));
  border-color: color-mix(in srgb, var(--fam-classroom) 32%, var(--mk-line));
  border-style: dashed;
}
.dfg-journey__node.is-end .dfg-journey__dir { color: var(--fam-classroom); }
.dfg-journey__node--up { border-color: color-mix(in srgb, var(--fam-understanding) 30%, var(--mk-line)); }
.dfg-journey__node--down { border-color: color-mix(in srgb, var(--mk-graph-down) 45%, var(--mk-line)); }
.dfg-journey__dir { font-size: 10px; font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; }
.dfg-journey__node strong {
  font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dfg-journey__meta { font-size: var(--mk-fs-11); font-weight: 600; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
/* 中间管道：横向 hub 胶囊 + 上下短竖线（不再竖排 agentId） */
.dfg-journey__pipe {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 0 2px; flex-shrink: 0; min-width: 0;
}
.dfg-journey__pipe i { width: 2px; height: 10px; border-radius: 2px; opacity: 0.7; }
.dfg-journey__hub {
  font-size: 11px; font-weight: 700; color: var(--mk-faint);
  letter-spacing: 0.02em; white-space: nowrap;
  max-width: 150px; overflow: hidden; text-overflow: ellipsis;
  writing-mode: initial; /* 关键：不再竖排 */
  padding: 3px 10px; border-radius: 999px;
  background: color-mix(in srgb, var(--fam-core) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-core) 18%, transparent);
}

/* 流水线画布 */
.dfg-pipe {
  position: relative;
  padding: 16px 20px 28px;
  padding-right: 84px; /* 右侧走廊：Bus 连线在此垂直走线，不穿卡片 */
  max-width: 1060px;
  margin: 0 auto;
  /* 画布底：亮色无底（none）、暗色纵向渐变；此前只有暗色档、亮色缺配对 */
  background: var(--mk-graph-pipe-bg);
  display: grid;
  gap: 14px;
  align-content: start;
  transition: opacity 0.15s ease;
}
.dfg-pipe.is-dimmed { opacity: 1; }
.dfg-edges { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 3; }
.dfg-edges path.is-dead { stroke: var(--mk-faint); stroke-dasharray: 4 3; }
.dfg-edges path.is-hot { stroke-dasharray: 5 4; animation: dfg-flow 0.7s linear infinite; }
@keyframes dfg-flow { to { stroke-dashoffset: -9; } }

/* 长程端口徽标（跨多卡不画线，点击滚动聚焦） */
.dfg-step__port {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 800; color: var(--mk-blue);
  background: var(--mk-graph-port-bg); border: 1px solid var(--mk-graph-port-line); border-radius: 999px;
  padding: 1px 7px; cursor: pointer; max-width: 160px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.dfg-step__port:hover { background: var(--mk-graph-port-bg-hover); box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.18); }
.dfg-step__port b { font-variant-numeric: tabular-nums; }
html[data-theme='dark'] .dfg-step__port { background: var(--mk-graph-port-bg); border-color: var(--mk-graph-port-line); color: var(--mk-graph-port-ink); }
html[data-theme='dark'] .dfg-step__port:hover { background: var(--mk-graph-port-bg-hover); }

/* 滚动聚焦闪烁（点击端口徽标后目标卡闪两下） */
.dfg-step.is-flash, .dfg-gate.is-flash { animation: dfg-flash 0.7s ease 2; }
@keyframes dfg-flash {
  0%, 100% { box-shadow: 0 0 0 0 rgba(44, 99, 208, 0); }
  45% { box-shadow: 0 0 0 4px rgba(44, 99, 208, 0.45); }
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
  border-radius: 7px; color: var(--mk-graph-on-accent); font-size: 12px; font-weight: 800; flex-shrink: 0;
  background: var(--hz);
}
.dfg-gate__title { display: grid; gap: 1px; min-width: 0; flex: 1; }
.dfg-gate__title strong { font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink); }
.dfg-gate__sub { font-size: var(--mk-fs-11); color: var(--mk-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dfg-gate__count {
  flex-shrink: 0; font-size: 11px; font-weight: 800; color: var(--mk-muted);
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
  background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 6%, var(--mk-graph-node-top)), var(--mk-graph-canvas) 55%);
}
.dfg-step--bare { border-style: dashed; background: var(--mk-graph-canvas-2); }
.dfg-step--bare.is-unresolved { border-color: color-mix(in srgb, var(--mk-amber) 45%, var(--mk-line)); }
/* orphan：已注册但无字段契约的 Skill（调用统计是真实健康信号，红色警示） */
.dfg-step--bare.is-orphan {
  border-color: color-mix(in srgb, var(--mk-red) 40%, var(--mk-line));
  background: linear-gradient(180deg, color-mix(in srgb, var(--mk-red) 4%, var(--mk-graph-inset)), var(--mk-graph-inset) 55%);
}
.dfg-step--bare.is-orphan .dfg-step__badge--warn { background: color-mix(in srgb, var(--mk-red) 12%, var(--mk-graph-node-top)); }
.dfg-step__head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px 6px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 7%, var(--mk-graph-node-bg)), var(--mk-graph-canvas) 70%);
  border-bottom: 1px solid color-mix(in srgb, var(--hz) 10%, var(--mk-graph-line-soft));
}
.dfg-step--bare .dfg-step__head { border-bottom: 0; padding-bottom: 5px; }
.dfg-step__idx {
  width: 21px; height: 21px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px; background: var(--hz); color: var(--mk-graph-on-accent);
  font-size: 11px; font-weight: 800; flex-shrink: 0;
}
.dfg-step--gate .dfg-step__idx { border-radius: 50%; }
.dfg-step__name { font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink); }
.dfg-step__badge {
  padding: 1px 7px; border-radius: 999px; background: var(--mk-graph-badge-bg); color: var(--mk-muted);
  font-size: 9.5px; font-weight: 800;
}
.dfg-step__badge--gate { background: color-mix(in srgb, var(--hz) 14%, var(--mk-graph-node-bg)); color: color-mix(in srgb, var(--hz) 75%, var(--mk-ink)); }
.dfg-step__badge--svc { background: var(--mk-graph-tag-bg); color: var(--mk-muted); }
.dfg-step__badge--cross { background: var(--mk-graph-badge-cross-bg); color: var(--fam-classroom); }
.dfg-step__badge--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.dfg-step__agent { font-size: 11px; color: var(--mk-faint); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfg-step__stat { flex-shrink: 0; font-size: 10.5px; font-weight: 800; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.dfg-step__stat.is-err { color: var(--mk-red); }
/* 调用用量徽标（agent→skill，Q9）：正常=蓝、低成功率=琥珀、未调用=灰 */
.dfg-edge-stat {
  flex-shrink: 0; font-size: 10.5px; font-weight: 800; font-variant-numeric: tabular-nums;
  color: var(--mk-blue); background: var(--mk-blue-bg);
  border-radius: 6px; padding: 1px 7px; white-space: nowrap;
}
.dfg-edge-stat.is-warn { color: var(--mk-amber); background: var(--mk-amber-bg); }
.dfg-edge-stat.is-dead { color: var(--mk-faint); background: var(--mk-graph-badge-bg); }
/* 字段运行时状态徽标（Q9 后半程）：死字段=灰、漂移=琥珀 */
.dfg-field-stat {
  flex-shrink: 0; font-size: 10.5px; font-weight: 800; font-variant-numeric: tabular-nums;
  color: var(--mk-muted); background: var(--mk-graph-badge-bg);
  border-radius: 6px; padding: 1px 7px; white-space: nowrap;
}
.dfg-field-stat.is-dead { color: var(--mk-faint); }
.dfg-field-stat.is-drift { color: var(--mk-amber); background: var(--mk-amber-bg); }
.dfg-step.is-dead-edge { border-style: dashed; }
.dfg-step__spacer { flex: 1; }
.dfg-step__cond {
  flex-shrink: 0; font-size: 10.5px; font-weight: 700; color: var(--mk-amber);
  background: var(--mk-amber-bg); border-radius: 6px; padding: 1px 7px;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfg-step__role { font-size: 10.5px; font-weight: 700; color: var(--mk-faint); }
.dfg-step__stage {
  flex-shrink: 0; font-size: 10.5px; font-weight: 700; color: var(--mk-blue);
  cursor: pointer; background: var(--mk-blue-bg); border-radius: 6px; padding: 1px 7px;
}
.dfg-step__stage:hover { background: var(--mk-graph-stage-hover-bg); }
.dfg-step__count { flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.dfg-step__body { padding: 8px 12px 10px; display: grid; gap: 7px; }
.dfg-step__note { margin: 0; font-size: var(--mk-fs-11); color: var(--mk-muted); }
.dfg-step__rows { display: grid; gap: 7px; }
.dfg-step__row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.dfg-step__rowlabel {
  flex-shrink: 0; margin-top: 5px; min-width: 34px; text-align: right;
  font-size: 10.5px; font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em;
  text-transform: uppercase;
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
  border-radius: 8px;
  background: var(--mk-graph-node-bg);
  font: inherit; color: var(--mk-ink); text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease, filter 0.12s ease;
}
.dfg-chip:hover { border-color: var(--hz); box-shadow: 0 2px 8px color-mix(in srgb, var(--hz) 22%, transparent); }
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
  font-size: var(--mk-fs-12); font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dfg-chip__type {
  flex-shrink: 0; font-size: 9.5px; font-weight: 700; color: var(--mk-faint);
  background: var(--mk-graph-tag-bg); border-radius: 5px; padding: 0 5px; line-height: 1.7;
}
.dfg-chip__flag {
  flex-shrink: 0; font-size: 9px; font-weight: 800; color: var(--fam-classroom);
  background: var(--mk-graph-flag-purple-bg); border-radius: 5px; padding: 0 5px; line-height: 1.8;
}
.dfg-chip__flag--accum { color: var(--fam-knowledge); background: var(--mk-amber-bg); }
.dfg-chip__to {
  flex-shrink: 0; font-size: 9.5px; font-weight: 700; color: var(--mk-blue);
  background: var(--mk-blue-bg); border-radius: 6px; padding: 0 6px; line-height: 1.8;
  max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfg-chip__to--stage { background: color-mix(in srgb, var(--hz) 12%, var(--mk-graph-node-bg)); color: var(--mk-ink); font-weight: 800; }
/* 字段运行时状态：死字段=灰虚线（声明/路由根窗口内零产出）、漂移=琥珀（产出但未声明） */
.dfg-chip.is-field-dead {
  border-style: dashed; border-color: var(--mk-line); border-left-color: var(--mk-faint);
}
.dfg-chip.is-field-dead .dfg-chip__name { color: var(--mk-faint); }
.dfg-chip.is-field-dead .dfg-chip__dot { background: var(--mk-faint) !important; }
.dfg-chip.is-field-drift {
  border-color: color-mix(in srgb, var(--mk-amber) 55%, var(--mk-line));
  border-left-color: var(--mk-amber);
}
.dfg-chip.is-field-drift .dfg-chip__dot { background: var(--mk-amber) !important; }

/* 图例（数据族） */
.dfg-legend {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px solid var(--mk-line); border-radius: 10px;
  background: var(--mk-surface);
  margin-top: 10px;
}
.dfg-legend.is-dimmed { opacity: 0.55; }
.dfg-legend__item {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  border: 1px solid transparent; background: transparent;
  font: inherit; font-size: var(--mk-fs-11); font-weight: 700; color: var(--mk-muted);
  cursor: pointer;
}
.dfg-legend__item i { width: 8px; height: 8px; border-radius: 50%; }
.dfg-legend__item b { font-weight: 800; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.dfg-legend__item:hover { background: var(--mk-blue-bg); }
.dfg-legend__item.is-on { border-color: var(--mk-blue); background: var(--mk-blue-bg); color: var(--mk-blue); }
.dfg-legend__hint { margin-left: auto; font-size: var(--mk-fs-11); color: var(--mk-faint); }

/* 字段运行时命中率图例（Q9 后半程） */
.dfg-field-legend {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 7px 14px; margin-top: 6px;
  border: 1px dashed var(--mk-line); border-radius: 10px;
  background: var(--mk-surface);
  font-size: var(--mk-fs-11); color: var(--mk-muted);
}
.dfg-field-legend__title { font-weight: 800; color: var(--mk-faint); text-transform: uppercase; letter-spacing: 0.04em; }
.dfg-field-legend__item { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; }
.dfg-field-legend__dot { width: 8px; height: 8px; border-radius: 50%; }
.dfg-field-legend__dot.is-produced { background: var(--mk-blue); }
.dfg-field-legend__dot.is-dead { background: var(--mk-faint); }
.dfg-field-legend__dot.is-drift { background: var(--mk-amber); }
.dfg-field-legend__dash { width: 14px; height: 0; border-top: 2px dashed var(--mk-faint); }
.dfg-field-legend__hint { margin-left: auto; color: var(--mk-faint); }

/* 空态 */
.dfg-empty { padding: 40px; text-align: center; color: var(--mk-faint); }

/* ========== 抽屉 ========== */
.dfg-drawer { background: var(--mk-graph-canvas); }
.dfg-drawer__body { display: grid; gap: 16px; align-content: start; }

.dfg-dl { margin: 0; display: grid; gap: 7px; }
.dfg-dl__title { margin: 0 0 8px; font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-blue); text-transform: uppercase; letter-spacing: 0.04em; }
.dfg-dl__row { display: grid; grid-template-columns: 76px 1fr; gap: 8px; align-items: baseline; }
.dfg-dl__row dt { font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-faint); text-transform: uppercase; letter-spacing: 0.04em; }
.dfg-dl__row dd { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-ink); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dfg-dl__family { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

.dfg-flow { border: 1px dashed var(--mk-graph-flow-line); border-radius: 10px; padding: 10px 12px; background: var(--mk-graph-flow-bg); }
.dfg-flow__list { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dfg-flow__chip { padding: 2px 9px; border-radius: 999px; background: var(--mk-blue); color: var(--mk-graph-on-accent); font-size: var(--mk-fs-11); font-weight: 700; }
.dfg-flow__chip--soft { background: var(--mk-graph-flow-soft-bg); color: var(--mk-accent-deep); }
.dfg-flow__chip--out { background: var(--mk-graph-flow-out); }
.dfg-flow__arrow { color: var(--mk-blue); font-weight: 800; }
.dfg-flow__hint { margin: 7px 0 0; font-size: var(--mk-fs-11); color: var(--mk-muted); line-height: 1.5; }

.dfg-edit { border: 1px solid var(--mk-line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 10px; }
.dfg-edit--locked { background: var(--mk-graph-canvas-2); }
.dfg-edit__row { display: grid; grid-template-columns: 84px 1fr; gap: 8px; align-items: center; }
.dfg-edit__label { font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); }
.dfg-edit__pills { display: inline-flex; gap: 4px; padding: 2px; background: var(--mk-graph-pills-bg); border-radius: 8px; width: fit-content; }
.dfg-pill { padding: 4px 12px; border: 0; border-radius: 6px; background: transparent; font: inherit; font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); cursor: pointer; }
.dfg-pill.is-on { background: var(--mk-graph-pill-on-bg); color: var(--mk-blue); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); }
.dfg-edit__input { padding: 6px 10px; border: 1px solid var(--mk-line); border-radius: 8px; font: inherit; font-size: var(--mk-fs-12); background: var(--mk-graph-field); outline: none; }
.dfg-edit__input:focus { border-color: var(--mk-blue); }
.dfg-check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-12); color: var(--mk-muted); cursor: pointer; }
.dfg-edit__msg { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--mk-graph-flow-bg); color: var(--mk-blue); font-size: var(--mk-fs-12); font-weight: 600; }
.dfg-edit__msg.is-error { background: var(--mk-red-bg); color: var(--mk-red); }
.dfg-edit__locked-hint { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.dfg-edit__actions { display: flex; justify-content: flex-end; gap: 8px; }
.dfg-tag { padding: 0 5px; border-radius: 999px; font-size: 9px; font-weight: 800; line-height: 1.6; }
.dfg-tag--internal { background: var(--mk-graph-flag-purple-bg); color: var(--fam-classroom); }
.dfg-tag--accum { background: var(--mk-amber-bg); color: var(--fam-knowledge); }

/* ================= 暗色模式 ================= */
html[data-theme='dark'] {
  .dfg-frame { background: var(--mk-graph-canvas); border-color: var(--mk-graph-line); }
  .dfg-toolbar { background: linear-gradient(180deg, var(--mk-graph-toolbar-a), var(--mk-graph-toolbar-b)); border-bottom-color: var(--mk-graph-line); }
  .dfg-search__input { background: var(--mk-graph-field); border-color: var(--mk-line); color: var(--mk-ink); }
  .dfg-search__input:focus { box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.16); }
  .dfg-search__clear { background: var(--mk-line); color: var(--mk-muted); }
  .dfg-search__clear:hover { background: var(--mk-graph-clear-bg-hover); color: var(--mk-ink); }
  .dfg-journey { background: linear-gradient(180deg, var(--mk-graph-journey-a), var(--mk-graph-journey-b)); border-bottom-color: var(--mk-graph-line); }
  .dfg-journey__node { background: var(--mk-surface); border-color: var(--mk-line); }
  .dfg-journey__node:hover { box-shadow: 0 2px 8px rgba(91, 141, 239, 0.18); }
  .dfg-journey__node.is-empty { background: var(--mk-graph-canvas-2); }
  .dfg-journey__node.is-start { background: linear-gradient(180deg, var(--mk-graph-node-top), var(--mk-graph-start-b)); border-color: color-mix(in srgb, var(--fam-path) 36%, var(--mk-line)); }
  .dfg-journey__node.is-start .dfg-journey__dir { color: var(--mk-green); }
  .dfg-journey__node.is-end { background: linear-gradient(180deg, var(--mk-graph-node-top), var(--mk-graph-end-b)); border-color: color-mix(in srgb, var(--fam-classroom) 32%, var(--mk-line)); }
  .dfg-journey__node.is-end .dfg-journey__dir { color: var(--mk-graph-accent-purple-ink); }
  .dfg-journey__dir { color: var(--mk-faint); }
  .dfg-journey__node strong { color: var(--mk-graph-node-ink); }
  .dfg-journey__hub {
    color: var(--mk-faint-soft);
    background: color-mix(in srgb, var(--fam-core) 14%, transparent);
    border-color: color-mix(in srgb, var(--fam-core) 26%, transparent);
  }
  .dfg-gate { background: color-mix(in srgb, var(--hz) 7%, var(--mk-graph-gate)); border-color: color-mix(in srgb, var(--hz) 40%, var(--mk-line)); }
  .dfg-gate--exit { background: color-mix(in srgb, var(--hz) 8%, var(--mk-graph-journey-a)); }
  .dfg-gate__title strong { color: var(--mk-graph-node-ink); }
  .dfg-gate__count { background: var(--mk-graph-badge-bg); color: var(--mk-muted); }
  .dfg-step { background: var(--mk-graph-canvas); border-color: color-mix(in srgb, var(--hz) 20%, var(--mk-line)); }
  .dfg-step--gate { background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 9%, var(--mk-graph-node-top)), var(--mk-graph-canvas) 60%); }
  .dfg-step--bare { background: var(--mk-graph-canvas-2); }
  .dfg-step--bare.is-unresolved { border-color: color-mix(in srgb, var(--mk-amber) 45%, var(--mk-line)); }
  .dfg-step--bare.is-orphan { border-color: color-mix(in srgb, var(--mk-red) 40%, var(--mk-line)); background: linear-gradient(180deg, color-mix(in srgb, var(--mk-red) 6%, var(--mk-graph-inset)), var(--mk-graph-inset) 60%); }
  .dfg-step--bare.is-orphan .dfg-step__badge--warn { background: rgba(248, 113, 113, 0.14); }
  .dfg-step__head { background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 10%, var(--mk-surface)), var(--mk-graph-canvas) 70%); border-bottom-color: color-mix(in srgb, var(--hz) 12%, var(--mk-graph-line)); }
  .dfg-step__name { color: var(--mk-graph-node-ink); }
  .dfg-step__badge { background: var(--mk-graph-badge-bg); color: var(--mk-muted); }
  .dfg-step__badge--gate { background: color-mix(in srgb, var(--hz) 22%, var(--mk-surface)); color: var(--mk-graph-blue-ink); }
  .dfg-step__badge--svc { background: var(--mk-graph-tag-bg); color: var(--mk-muted); }
  .dfg-step__badge--cross { background: rgba(167, 139, 250, 0.16); color: var(--mk-graph-accent-purple-ink); }
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
  .dfg-legend__item.is-on { background: rgba(91, 141, 239, 0.18); border-color: rgba(91, 141, 239, 0.45); color: var(--mk-graph-blue-ink); }
  .dfg-field-legend { background: var(--mk-graph-canvas); }
  .dfg-chip.is-field-dead { border-color: var(--mk-line); border-left-color: var(--mk-faint); }
  .dfg-field-stat { background: var(--mk-graph-badge-bg); color: var(--mk-muted); }
  .dfg-drawer { background: var(--mk-graph-canvas); }
  .dfg-drawer__body { background: var(--mk-graph-canvas); }
  .dfg-flow { background: var(--mk-graph-flow-bg); border-color: var(--mk-graph-flow-line); }
  .dfg-flow__chip--soft { background: var(--mk-graph-flow-soft-bg); color: var(--mk-graph-flow-soft-ink); }
  .dfg-flow__chip--out { background: var(--mk-graph-flow-out); }
  .dfg-edit--locked { background: var(--mk-graph-canvas-2); }
  .dfg-edit__pills { background: var(--mk-graph-pills-bg); color: var(--mk-muted); }
  .dfg-pill { color: var(--mk-muted); }
  .dfg-pill:hover { color: var(--mk-graph-node-ink); }
  .dfg-pill.is-on { background: var(--mk-graph-pill-on-bg); color: var(--mk-graph-blue-ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
  .dfg-edit__input { background: var(--mk-graph-field); border-color: var(--mk-line); color: var(--mk-ink); }
  .dfg-edit__msg { background: var(--mk-graph-flow-bg); color: var(--mk-accent-deep); }
  .dfg-edit__msg.is-error { background: var(--mk-red-bg); color: var(--mk-graph-err-strong-ink); }
  .dfg-tag--internal { background: var(--mk-graph-flag-purple-bg); color: var(--mk-graph-flag-purple-ink); }
  .dfg-tag--accum { background: var(--mk-amber-bg); color: var(--mk-graph-warn-ink); }
  .dfg-drawer { color: var(--mk-ink); }
  .dfg-dl__row { color: var(--mk-ink); }
  .dfg-edit__row { color: var(--mk-ink); }
  .dfg-edit__actions { color: var(--mk-ink); }
}

/* 响应式（此前本组件 0 个 @media，窄屏靠 .dfg-frame overflow:hidden 静默裁切）：
   收窄右侧连线走廊（≥44px 保证 bus 折线 busX=卡右缘+40 仍在画布内），
   并给步骤头 agent 设最小宽度，避免被 flex 压成 0（原 flex:1;min-width:0 在 @820 塌成 2px）。 */
@media (max-width: 1024px) {
  .dfg-pipe { max-width: none; padding: 14px 16px 24px; padding-right: 56px; }
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
