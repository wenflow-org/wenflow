<template>
  <div class="dfg">
    <div v-if="loading" class="dfg-empty">加载中…</div>
    <div v-else-if="error" class="dfg-empty dfg-empty--error">
      {{ error }}
      <button type="button" class="mk-empty__action" @click="load">重试</button>
    </div>

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
        </div>
      </div>

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
        <span v-else class="dfg-journey__node dfg-journey__node--up is-empty">
          <span class="dfg-journey__dir">↑ 链首</span>
          <strong>无上游输入</strong>
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
        <span v-else class="dfg-journey__node dfg-journey__node--down is-empty">
          <span class="dfg-journey__dir">↓ 终点</span>
          <strong>本阶段为链尾（累积进学习者状态）</strong>
        </span>
      </div>

      <div
        ref="pipeRef"
        class="dfg-pipe"
        :class="{ 'is-dimmed': !!focusKey }"
      >
        <!-- 连线层（轨道线：同字段 产出 → 消费 / 产出 → 出口） -->
        <svg class="dfg-edges" :width="pipeW" :height="pipeH" aria-hidden="true">
          <g v-for="(e, i) in edgeGeoms" :key="i">
            <path
              :d="e.d"
              fill="none"
              :stroke="e.hue"
              :stroke-width="e.highlight ? 2.4 : 1.4"
              :opacity="e.highlight ? 0.95 : e.dimmed ? 0.06 : 0.4"
              :stroke-linecap="'round'"
            />
            <circle v-if="e.highlight || true" :cx="e.x1" :cy="e.y1" r="2.4" :fill="e.hue" :opacity="e.highlight ? 0.9 : 0.35" />
            <circle :cx="e.x2" :cy="e.y2" r="2.4" :fill="e.hue" :opacity="e.highlight ? 0.9 : 0.35" />
          </g>
        </svg>

        <!-- ===== ① 入口交接（跨阶段输入） ===== -->
        <section v-if="flow && entryVisible.length" class="dfg-gate dfg-gate--entry" :style="{ '--hz': toneOf(flow.entryFrom?.stageId || '').hue }">
          <header class="dfg-gate__head">
            <span class="dfg-gate__icon">⇣</span>
            <div class="dfg-gate__title">
              <strong>入口 · 来自 {{ flow.entryFrom?.stageName }}</strong>
              <span class="dfg-gate__sub">{{ entryVisible.length }} 个字段经 {{ flow.entryFrom?.stageId }}-agent 移交进入本阶段</span>
            </div>
            <span class="dfg-gate__count">{{ entryVisible.length }} 字段</span>
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
          <section v-if="step.kind === 'bridge-entry' && step.outputChips.length" class="dfg-step dfg-step--gate" :style="{ '--hz': toneOf(flow!.stageId).hue }">
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

          <!-- 服务 / 跨阶段步骤（无字段契约，如实展示） -->
          <section v-else-if="step.kind === 'service' || step.kind === 'cross-agent'" class="dfg-step dfg-step--bare" :class="{ 'is-unresolved': step.unresolved }">
            <header class="dfg-step__head">
              <span class="dfg-step__idx">{{ step.index }}</span>
              <strong class="dfg-step__name">{{ step.name }}</strong>
              <span
                class="dfg-step__badge"
                :class="step.kind === 'service' ? 'dfg-step__badge--svc' : 'dfg-step__badge--cross'"
              >{{ step.kind === 'service' ? '代码服务' : '跨阶段引用' }}</span>
              <span v-if="step.unresolved" class="dfg-step__badge dfg-step__badge--warn" title="编排定义中该步骤未解析到契约">未解析</span>
              <span v-if="step.fromStage" class="dfg-step__stage mono" @click="switchStage(step.fromStage!)" title="点击跳到该阶段">→ {{ stageNameOf(step.fromStage) }}</span>
              <span v-if="step.role" class="dfg-step__role">{{ step.role }}</span>
              <span class="dfg-step__spacer"></span>
              <span v-if="step.condition" class="dfg-step__cond" :title="step.condition">触发：{{ step.condition }}</span>
              <span v-if="step.loopOver" class="dfg-step__cond" :title="`循环 ${step.loopOver}`">循环：{{ step.loopOver }}</span>
            </header>
          </section>

          <!-- Skill 步骤卡 -->
          <section v-else class="dfg-step" :class="{ 'has-inputs': step.inputChips.length }" :style="{ '--hz': stepHue(step) }">
            <header class="dfg-step__head">
              <span class="dfg-step__idx">{{ step.index }}</span>
              <strong class="dfg-step__name">{{ step.name }}</strong>
              <span class="dfg-step__badge">Skill</span>
              <span v-if="step.unresolved" class="dfg-step__badge dfg-step__badge--warn" title="编排定义中该步骤未解析到契约">未解析</span>
              <span class="dfg-step__agent mono">{{ step.agentId }}</span>
              <template v-if="step.calls != null">
                <span class="dfg-step__stat" :class="{ 'is-err': step.failed > 0 }">{{ fmtCalls(step.calls) }} 调用<template v-if="step.failed"> · {{ fmtCalls(step.failed) }}✗</template></span>
              </template>
              <span class="dfg-step__spacer"></span>
              <span v-if="step.condition" class="dfg-step__cond" :title="step.condition">触发：{{ step.condition }}</span>
              <span v-if="step.loopOver" class="dfg-step__cond" :title="`循环 ${step.loopOver}`">循环：{{ step.loopOver }}</span>
              <span class="dfg-step__count">{{ step.outputChips.length }} 产出</span>
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
        <section v-if="flow && flow.exit.length" class="dfg-gate dfg-gate--exit" :style="{ '--hz': toneOf(flow.exitTo?.stageId || '').hue }">
          <header class="dfg-gate__head">
            <span class="dfg-gate__icon">⇢</span>
            <div class="dfg-gate__title">
              <strong>出口 · 交给 {{ flow.exitTo?.stageName }}</strong>
              <span class="dfg-gate__sub">{{ flow.agentId }} 汇总 {{ flow.exit.length }} 个字段，整体移交下一阶段</span>
            </div>
            <span class="dfg-gate__count">{{ flow.exit.length }} 字段</span>
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

    <!-- 字段详情抽屉（含行级编辑，同步回写编排文件） -->
    <Teleport to="body">
      <div v-if="selected" class="dfg-drawer-mask" @click.self="selected = null">
        <aside class="dfg-drawer" role="dialog" aria-label="字段详情">
          <div class="dfg-drawer__head">
            <div>
              <h3 class="dfg-drawer__title mono">{{ selected.fieldId }}</h3>
              <p class="dfg-drawer__sub">{{ selected.description || '—' }}</p>
            </div>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="selected = null">✕</button>
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
                  <button type="button" class="dfg-pill" :class="{ 'is-on': editDraft.render === 'visible' }" @click="editDraft.render = 'visible'">visible</button>
                  <button type="button" class="dfg-pill" :class="{ 'is-on': editDraft.render === 'hidden' }" @click="editDraft.render = 'hidden'">hidden</button>
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
import { adminFieldRoutingsApi, adminRuntimeDefinitionsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'
import { liveTopoNodes } from './live'
import {
  buildStageFlow, fmtCalls, type FlowChip, type FlowStep, type StageFlow, type DefStepLike,
  STAGE_ORDER, STAGE_LABELS,
} from './dataFlow'
import type { StageDetailLike } from './fieldFlowLayout'
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
const showHidden = ref(false)
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
    const [stagesRes, defRes] = await Promise.all([
      adminFieldRoutingsApi.getStages().catch(() => null),
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions().catch(() => null),
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
    out[sid] = buildStageFlow(sid, d, detailByStage.value, defByAgent[`${sid}-agent`] || [], topo as any, names)
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

/* ================= 可见性与折叠 ================= */
/** 步骤卡 + 可见芯片副本（flowSteps 元素类型；模板 / 折叠 / 轨道线共用） */
type WalkStep = FlowStep & { inputChips: FlowChip[]; outputChips: FlowChip[]; chips: FlowChip[] }
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
  return f.steps.map((s) => ({
    ...s,
    inputChips: visibleChips(s.inputs),
    outputChips: visibleChips(s.outputs),
    chips: [...visibleChips(s.inputs), ...visibleChips(s.outputs)],
  }))
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

/* ================= 轨道线（SVG：实测 DOM 位置，跨槽位连线） ================= */
const pipeRef = ref<HTMLElement | null>(null)
const pipeW = ref(0)
const pipeH = ref(0)
const edgeGeoms = ref<Array<{ d: string; hue: string; x1: number; y1: number; x2: number; y2: number; highlight: boolean; dimmed: boolean }>>([])
const nodeRects = ref(new Map<string, DOMRect>())

function measure() {
  const root = pipeRef.value
  if (!root) return
  const rr = root.getBoundingClientRect()
  pipeW.value = root.scrollWidth
  pipeH.value = root.scrollHeight
  const map = new Map<string, DOMRect>()
  for (const el of root.querySelectorAll<HTMLElement>('[data-chip-id][data-chip-role]')) {
    const id = `${el.getAttribute('data-chip-id')}|${el.getAttribute('data-chip-role')}`
    const r = el.getBoundingClientRect()
    map.set(id, new DOMRect(r.left - rr.left, r.top - rr.top, r.width, r.height))
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-gate-anchor]')) {
    const r = el.getBoundingClientRect()
    map.set(`gate|${el.getAttribute('data-gate-anchor')}`, new DOMRect(r.left - rr.left, r.top - rr.top, r.width, r.height))
  }
  nodeRects.value = map
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

function renderEdges() {
  const f = flow.value
  if (!f || !nodeRects.value.size) return
  const outs: Array<{ d: string; hue: string; x1: number; y1: number; x2: number; y2: number; highlight: boolean; dimmed: boolean; fieldId: string; from: string; to: string }> = []
  for (const e of edgeSet.value) {
    let from: DOMRect | undefined
    let to: DOMRect | undefined
    if (e.kind === 'internal') {
      from = rectOf('out', e.from)
      to = rectOf('in', e.to)
      if (!to) to = rectOf('gate', e.to) // 桥接闸口直接分发的输入副本
    } else if (e.kind === 'exit') {
      from = rectOf('out', e.from)
      to = rectOf('exit', e.to)
    } else {
      from = rectOf('entry', e.from)
      to = nodeRects.value.get(`gate|${f.agentId}`)
    }
    if (!from || !to) continue
    const x1 = from.right, y1 = from.top + from.height / 2
    const x2 = to.left, y2 = to.top + to.height / 2
    const d = `M ${x1} ${y1} C ${x1 + 30} ${y1}, ${Math.max(x1 + 30, x2 - 30)} ${y2}, ${x2} ${y2}`
    const linked = relatedIds.value.has(e.from) && relatedIds.value.has(e.to)
    outs.push({
      d, hue: e.hue, x1, y1, x2, y2,
      highlight: linked || (!!hoverChip.value && hoverChip.value === e.from) || (!!familyFocus.value && e.fieldId.startsWith(`${familyFocus.value}.`)),
      dimmed: (!!focusId.value || !!familyFocus.value || !!hoverChip.value) && !linked,
      fieldId: e.fieldId, from: e.from, to: e.to,
    })
  }
  edgeGeoms.value = outs
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

/* ================= 抽屉 ================= */
function chipTitle(c: FlowChip) {
  const parts = [c.description || c.fieldId]
  if (c.handoffTargets.length) parts.push(`移交 → ${c.handoffTargets.join(', ')}`)
  if (c.pathInRawOutput) parts.push(`抽取路径：${c.pathInRawOutput}`)
  if (c.persistKey && c.persistKey !== c.fieldId) parts.push(`落库键：${c.persistKey}`)
  return parts.join('\n')
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
  background: #fff;
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
  background: linear-gradient(180deg, #fbfcff, #f6f8fc);
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
  background: #fbfcfe;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.dfg-search__input:focus { border-color: var(--mk-blue); box-shadow: 0 0 0 3px rgba(44, 99, 208, 0.12); }
.dfg-search__clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 50%; background: #e2e8f0; color: var(--mk-muted);
  font-size: 9px; line-height: 1; cursor: pointer; padding: 0;
}
.dfg-search__clear:hover { background: #cbd5e1; color: var(--mk-ink); }
.dfg-switch { display: inline-flex; align-items: center; gap: 5px; font-size: var(--mk-fs-12); color: var(--mk-muted); cursor: pointer; }

/* 旅程概览条 */
.dfg-journey {
  display: flex; align-items: stretch; gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #f8fafd, #f4f7fc);
  border-bottom: 1px solid var(--mk-line);
}
.dfg-journey__node {
  flex: 1; min-width: 0;
  display: grid; gap: 1px; align-content: center;
  padding: 7px 12px;
  border: 1px solid var(--mk-line); border-radius: 10px;
  background: #fff; font: inherit; text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.dfg-journey__node:hover { border-color: var(--mk-blue); box-shadow: 0 2px 8px rgba(44, 99, 208, 0.1); }
.dfg-journey__node.is-empty { cursor: default; background: #fafbfd; }
.dfg-journey__node--up { border-color: color-mix(in srgb, #2c63d0 30%, var(--mk-line)); }
.dfg-journey__node--down { border-color: color-mix(in srgb, #8aa6d8 45%, var(--mk-line)); }
.dfg-journey__dir { font-size: 10px; font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; }
.dfg-journey__node strong {
  font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dfg-journey__meta { font-size: var(--mk-fs-11); font-weight: 600; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.dfg-journey__pipe {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  padding: 0 4px; flex-shrink: 0;
}
.dfg-journey__pipe i { width: 2px; height: 14px; border-radius: 2px; }
.dfg-journey__hub {
  font-size: 10px; font-weight: 700; color: var(--mk-faint);
  writing-mode: vertical-rl; letter-spacing: 0.08em; white-space: nowrap;
}

/* 流水线画布 */
.dfg-pipe {
  position: relative;
  padding: 16px 20px 28px;
  max-width: 1060px;
  margin: 0 auto;
  display: grid;
  gap: 14px;
  align-content: start;
  transition: opacity 0.15s ease;
}
.dfg-pipe.is-dimmed { opacity: 1; }
.dfg-edges { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 3; }

/* 进出闸口卡 */
.dfg-gate {
  position: relative; z-index: 2;
  border: 1px dashed color-mix(in srgb, var(--hz) 45%, var(--mk-line));
  border-radius: 12px;
  background: color-mix(in srgb, var(--hz) 4%, #fff);
  padding: 10px 14px 12px;
}
.dfg-gate--exit { background: color-mix(in srgb, var(--hz) 5%, #f8fafd); }
.dfg-gate__head { display: flex; align-items: center; gap: 9px; }
.dfg-gate__icon {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px; color: #fff; font-size: 12px; font-weight: 800; flex-shrink: 0;
  background: var(--hz);
}
.dfg-gate__title { display: grid; gap: 1px; min-width: 0; flex: 1; }
.dfg-gate__title strong { font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink); }
.dfg-gate__sub { font-size: var(--mk-fs-11); color: var(--mk-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dfg-gate__count {
  flex-shrink: 0; font-size: 11px; font-weight: 800; color: var(--mk-muted);
  background: #eef2fa; padding: 2px 9px; border-radius: 999px; font-variant-numeric: tabular-nums;
}
.dfg-gate .dfg-chips { margin-top: 9px; }

/* 步骤卡 */
.dfg-step {
  position: relative; z-index: 2;
  border: 1px solid color-mix(in srgb, var(--hz) 18%, var(--mk-line));
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}
.dfg-step--gate {
  border-style: dashed;
  background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 6%, #fff), #fff 55%);
}
.dfg-step--bare { border-style: dashed; background: #fafbfd; }
.dfg-step--bare.is-unresolved { border-color: color-mix(in srgb, var(--mk-amber) 45%, var(--mk-line)); }
.dfg-step__head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px 6px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 7%, #fff), #fff 70%);
  border-bottom: 1px solid color-mix(in srgb, var(--hz) 10%, #eef2f8);
}
.dfg-step--bare .dfg-step__head { border-bottom: 0; padding-bottom: 5px; }
.dfg-step__idx {
  width: 21px; height: 21px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px; background: var(--hz); color: #fff;
  font-size: 11px; font-weight: 800; flex-shrink: 0;
}
.dfg-step--gate .dfg-step__idx { border-radius: 50%; }
.dfg-step__name { font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink); }
.dfg-step__badge {
  padding: 1px 7px; border-radius: 999px; background: #eef2fa; color: var(--mk-muted);
  font-size: 9.5px; font-weight: 800;
}
.dfg-step__badge--gate { background: color-mix(in srgb, var(--hz) 14%, #fff); color: color-mix(in srgb, var(--hz) 75%, #1a2a44); }
.dfg-step__badge--svc { background: #f0f2f5; color: #5b6577; }
.dfg-step__badge--cross { background: #f4f0ff; color: #7c3aed; }
.dfg-step__badge--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.dfg-step__agent { font-size: 11px; color: var(--mk-faint); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfg-step__stat { flex-shrink: 0; font-size: 10.5px; font-weight: 800; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.dfg-step__stat.is-err { color: var(--mk-red); }
.dfg-step__spacer { flex: 1; }
.dfg-step__cond {
  flex-shrink: 0; font-size: 10.5px; font-weight: 700; color: var(--mk-amber);
  background: var(--mk-amber-bg); border-radius: 6px; padding: 1px 7px;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfg-step__role { font-size: 10.5px; font-weight: 700; color: var(--mk-faint); }
.dfg-step__stage {
  flex-shrink: 0; font-size: 10.5px; font-weight: 700; color: var(--mk-blue);
  cursor: pointer; background: #eff6ff; border-radius: 6px; padding: 1px 7px;
}
.dfg-step__stage:hover { background: #dbeafe; }
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
  background: #fff;
  font: inherit; color: var(--mk-ink); text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease, filter 0.12s ease;
}
.dfg-chip:hover { border-color: var(--hz); box-shadow: 0 2px 8px color-mix(in srgb, var(--hz) 22%, transparent); }
.dfg-chip--in { background: color-mix(in srgb, var(--hz) 5%, #fff); }
.dfg-chip--more {
  border-style: dashed; border-color: var(--mk-line); border-left-width: 3px;
  background: #fff; color: var(--mk-blue); font-weight: 700;
}
.dfg-chip--more:hover { border-color: var(--mk-blue); background: #eff6ff; }
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
  background: #f0f2f5; border-radius: 5px; padding: 0 5px; line-height: 1.7;
}
.dfg-chip__flag {
  flex-shrink: 0; font-size: 9px; font-weight: 800; color: #7c3aed;
  background: #f3e8ff; border-radius: 5px; padding: 0 5px; line-height: 1.8;
}
.dfg-chip__flag--accum { color: #b45309; background: #fffbeb; }
.dfg-chip__to {
  flex-shrink: 0; font-size: 9.5px; font-weight: 700; color: var(--mk-blue);
  background: #eff6ff; border-radius: 6px; padding: 0 6px; line-height: 1.8;
  max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfg-chip__to--stage { background: color-mix(in srgb, var(--hz) 12%, #fff); color: var(--mk-ink); font-weight: 800; }

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
.dfg-legend__item:hover { background: #eff6ff; }
.dfg-legend__item.is-on { border-color: var(--mk-blue); background: #eff6ff; color: var(--mk-blue); }
.dfg-legend__hint { margin-left: auto; font-size: var(--mk-fs-11); color: var(--mk-faint); }

/* 空态 */
.dfg-empty { padding: 40px; text-align: center; color: var(--mk-faint); }
.dfg-empty--error { color: var(--mk-red); }

/* ========== 抽屉 ========== */
.dfg-drawer-mask {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(15, 23, 42, 0.4);
  display: flex; justify-content: flex-end;
}
.dfg-drawer {
  width: min(460px, 100%);
  height: 100%;
  background: #fff;
  display: flex; flex-direction: column;
  box-shadow: -8px 0 30px rgba(15, 23, 42, 0.12);
  animation: dfg-slide 0.22s ease;
}
@keyframes dfg-slide { from { transform: translateX(24px); opacity: 0; } }
.dfg-drawer__head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--mk-line);
}
.dfg-drawer__title { font-size: var(--mk-fs-14); font-weight: 800; color: var(--mk-ink); word-break: break-all; }
.dfg-drawer__sub { margin-top: 3px; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.dfg-drawer__body { flex: 1; overflow-y: auto; padding: 14px 18px 24px; display: grid; gap: 16px; align-content: start; }

.dfg-dl { margin: 0; display: grid; gap: 7px; }
.dfg-dl__title { margin: 0 0 8px; font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-blue); text-transform: uppercase; letter-spacing: 0.04em; }
.dfg-dl__row { display: grid; grid-template-columns: 76px 1fr; gap: 8px; align-items: baseline; }
.dfg-dl__row dt { font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-faint); text-transform: uppercase; letter-spacing: 0.04em; }
.dfg-dl__row dd { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-ink); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dfg-dl__family { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

.dfg-flow { border: 1px dashed rgba(44, 99, 208, 0.4); border-radius: 10px; padding: 10px 12px; background: #f0f5ff; }
.dfg-flow__list { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dfg-flow__chip { padding: 2px 9px; border-radius: 999px; background: var(--mk-blue); color: #fff; font-size: var(--mk-fs-11); font-weight: 700; }
.dfg-flow__chip--soft { background: #dbeafe; color: #1f57cc; }
.dfg-flow__chip--out { background: #8aa6d8; }
.dfg-flow__arrow { color: var(--mk-blue); font-weight: 800; }
.dfg-flow__hint { margin: 7px 0 0; font-size: var(--mk-fs-11); color: var(--mk-muted); line-height: 1.5; }

.dfg-edit { border: 1px solid var(--mk-line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 10px; }
.dfg-edit--locked { background: #fafbfd; }
.dfg-edit__row { display: grid; grid-template-columns: 84px 1fr; gap: 8px; align-items: center; }
.dfg-edit__label { font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); }
.dfg-edit__pills { display: inline-flex; gap: 4px; padding: 2px; background: #f1f5f9; border-radius: 8px; width: fit-content; }
.dfg-pill { padding: 4px 12px; border: 0; border-radius: 6px; background: transparent; font: inherit; font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); cursor: pointer; }
.dfg-pill.is-on { background: #fff; color: var(--mk-blue); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); }
.dfg-edit__input { padding: 6px 10px; border: 1px solid var(--mk-line); border-radius: 8px; font: inherit; font-size: var(--mk-fs-12); background: #fbfcfe; outline: none; }
.dfg-edit__input:focus { border-color: var(--mk-blue); }
.dfg-check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-12); color: var(--mk-muted); cursor: pointer; }
.dfg-edit__msg { margin: 0; padding: 8px 10px; border-radius: 8px; background: #f0f5ff; color: var(--mk-blue); font-size: var(--mk-fs-12); font-weight: 600; }
.dfg-edit__msg.is-error { background: #fef2f2; color: var(--mk-red); }
.dfg-edit__locked-hint { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.dfg-edit__actions { display: flex; justify-content: flex-end; gap: 8px; }
.dfg-tag { padding: 0 5px; border-radius: 999px; font-size: 9px; font-weight: 800; line-height: 1.6; }
.dfg-tag--internal { background: #f3e8ff; color: #7c3aed; }
.dfg-tag--accum { background: #fffbeb; color: #b45309; }

/* ================= 暗色模式 ================= */
html[data-theme='dark'] {
  .dfg-frame { background: #141c2b; border-color: #232f45; }
  .dfg-toolbar { background: linear-gradient(180deg, #1a2436, #151e2e); border-bottom-color: #232f45; }
  .dfg-search__input { background: #131b2a; border-color: #2a3850; color: var(--mk-ink); }
  .dfg-search__clear { background: #2a3850; color: #9fb0c8; }
  .dfg-journey { background: linear-gradient(180deg, #141c2b, #121a29); border-bottom-color: #232f45; }
  .dfg-journey__node { background: #17202f; border-color: #2a3850; }
  .dfg-journey__node.is-empty { background: #131b2a; }
  .dfg-journey__dir { color: #6b7c96; }
  .dfg-journey__node strong { color: #c7d3e8; }
  .dfg-journey__hub { color: #6b7c96; }
  .dfg-pipe { background: linear-gradient(180deg, #141c2b, #101725); }
  .dfg-gate { background: color-mix(in srgb, var(--hz) 7%, #121a29); border-color: color-mix(in srgb, var(--hz) 40%, #2a3850); }
  .dfg-gate--exit { background: color-mix(in srgb, var(--hz) 8%, #141c2b); }
  .dfg-gate__title strong { color: #c7d3e8; }
  .dfg-gate__count { background: #253049; color: #9fb0c8; }
  .dfg-step { background: #141c2b; border-color: color-mix(in srgb, var(--hz) 20%, #2a3850); }
  .dfg-step--gate { background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 9%, #16202f), #141c2b 60%); }
  .dfg-step--bare { background: #131b2a; }
  .dfg-step--bare.is-unresolved { border-color: color-mix(in srgb, var(--mk-amber) 45%, #2a3850); }
  .dfg-step__head { background: linear-gradient(180deg, color-mix(in srgb, var(--hz) 10%, #17202f), #141c2b 70%); border-bottom-color: color-mix(in srgb, var(--hz) 12%, #232f45); }
  .dfg-step__name { color: #c7d3e8; }
  .dfg-step__badge { background: #253049; color: #9fb0c8; }
  .dfg-step__badge--gate { background: color-mix(in srgb, var(--hz) 22%, #17202f); color: #9db8f5; }
  .dfg-step__badge--svc { background: #253049; color: #9fb0c8; }
  .dfg-step__badge--cross { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; }
  .dfg-step__badge--warn { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
  .dfg-step__cond { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
  .dfg-step__stage { background: rgba(91, 141, 239, 0.16); color: #9db8f5; }
  .dfg-chip { background: #17202f; border-color: color-mix(in srgb, var(--hz) 32%, #2a3850); color: #c7d3e8; }
  .dfg-chip--in { background: color-mix(in srgb, var(--hz) 9%, #131b2a); }
  .dfg-chip--more { background: #17202f; }
  .dfg-chip--more:hover { background: #1b2a45; }
  .dfg-chip__type { background: #253049; color: #9fb0c8; }
  .dfg-chip__flag { background: rgba(192, 132, 252, 0.16); color: #d8b4fe; }
  .dfg-chip__flag--accum { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
  .dfg-chip__to { background: #1b2a45; color: #7aa2ff; }
  .dfg-chip__to--stage { background: color-mix(in srgb, var(--hz) 16%, #17202f); color: #c7d3e8; }
  .dfg-legend { background: #141c2b; }
  .dfg-legend__item:hover { background: #1b2740; }
  .dfg-legend__item.is-on { background: rgba(91, 141, 239, 0.18); border-color: rgba(91, 141, 239, 0.45); color: #9db8f5; }
  .dfg-drawer { background: #141c2b; }
  .dfg-drawer__head { border-bottom-color: #232f45; }
  .dfg-drawer__body { background: #141c2b; }
  .dfg-flow { background: #1b2a45; border-color: rgba(91, 141, 239, 0.4); }
  .dfg-flow__chip--soft { background: #1b2a45; color: #9db8f5; }
  .dfg-flow__chip--out { background: #2c3a55; }
  .dfg-edit--locked { background: #131b2a; }
  .dfg-edit__pills { background: #1a2436; }
  .dfg-pill.is-on { background: #232f45; color: #7aa2ff; }
  .dfg-edit__input { background: #131b2a; border-color: #2a3850; color: var(--mk-ink); }
  .dfg-edit__msg { background: #1b2a45; color: #7aa2ff; }
  .dfg-edit__msg.is-error { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
  .dfg-tag--internal { background: rgba(192, 132, 252, 0.16); color: #d8b4fe; }
  .dfg-tag--accum { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
}
</style>
