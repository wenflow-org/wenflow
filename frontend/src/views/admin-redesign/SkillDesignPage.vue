<template>
  <div class="mk-page sdp">
    <!-- 顶部：返回 + 状态条（与 console 统一的运维简报语言） -->
    <header class="sdp-head">
      <button type="button" class="sdp-back" @click="goConsole">← 控制台</button>
      <div v-if="overview" class="mk-status" :class="statusToneCls">
        <span class="mk-status__dot"></span>
        <strong class="mk-status__title">{{ overview.displayName || skillId }}</strong>
        <span class="mk-badge" :class="healthBadgeCls">{{ healthLabel }}</span>
        <span v-if="workbenchMeta?.parentAgent" class="sdp-parent" :style="{ color: tone.hue }">
          ↑ {{ workbenchMeta.parentAgent.name }}
        </span>
        <span class="mk-status__sep"></span>
        <span
          class="mk-status__meta mono sdp-ellipsis"
          :title="`${overview.agentId}${overview.file ? ' · ' + overview.file.path : ''}`"
        >{{ overview.agentId }}<template v-if="overview.file"> · {{ shortFilePath(overview.file.path) }}</template></span>
        <span v-if="overview.db?.version" class="mk-status__meta">DB ACTIVE <b class="mono">v{{ overview.db.version }}</b></span>
        <span v-if="workbenchMeta?.stats" class="mk-status__meta">
          调用 <b class="mono">{{ workbenchMeta.stats.totalCalls }}</b>
          · 成功率 <b class="mono">{{ workbenchMeta.stats.successRate ?? '—' }}%</b>
          · 均耗 <b class="mono">{{ fmtMs(workbenchMeta.stats.avgDuration || 0) }}</b>
        </span>
        <span v-if="recentFailures > 0" class="mk-status__meta sdp-bad-text">近 8 条 {{ recentFailures }} 失败</span>
        <span v-if="overview.drift === 'file-vs-db-mismatch'" class="mk-badge mk-badge--warn">版本不一致</span>
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadAll">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button type="button" class="mk-status__action mk-status__action--primary sdp-action-fix" @click="goDryRun">
          试跑
        </button>
      </div>
      <div v-else class="mk-status mk-status--muted">
        <span class="mk-status__dot"></span>
        <strong class="mk-status__title">{{ loading ? '加载中…' : loadFailed ? '概览加载失败' : skillId }}</strong>
        <button v-if="loadFailed && !loading" type="button" class="mk-status__action" @click="loadAll">重试</button>
      </div>
    </header>

    <!-- 漂移警告 -->
    <div v-if="overview?.drift === 'file-vs-db-mismatch'" class="sdp-drift">
      <strong>源文件与运行 Prompt 不一致</strong>
      <code class="mono">{{ overview.file?.path || 'prompts/skill.*.md' }}</code>
      <span>DB ACTIVE v{{ overview.db?.version || '?' }}</span>
      <span>请修改文件并通过部署同步处理</span>
    </div>

    <div v-if="notFound" class="mk-empty">
      <strong>未找到 Skill「{{ skillId }}」</strong>
      <span>它可能未注册或 ID 有误。</span>
    </div>

    <template v-if="overview">
      <!-- Tabs -->
      <nav class="sdp-tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="sdp-tab"
          :class="{ 'sdp-tab--active': tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>

      <!-- ========== 试跑：试跑 + ACTIVE 参照 + 最近调用（验证闭环） ========== -->
      <div v-show="tab === 'trial'" class="sdp-pane">
        <div class="sdp-workbench">
          <!-- 左：试跑 -->
          <section class="sdp-block">
            <header class="sdp-block__head">
              <h4>试跑</h4>
              <span class="sdp-block__meta">
                <button type="button" class="mk-link" :disabled="!trialInput.trim()" @click="formatTrialJson">格式化</button>
                <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="trialRunning" @click="runTrial">
                  {{ trialRunning ? '运行中…' : '运行预览' }}
                </button>
              </span>
            </header>
            <!-- 试跑输入（JSON 语法高亮覆盖层） -->
            <div class="sdp-codehl sdp-codehl--json">
              <pre class="sdp-codehl__pre mono" aria-hidden="true"><code v-html="trialHighlighted"></code></pre>
              <textarea
                ref="trialTextareaRef"
                v-model="trialInput"
                class="sdp-json mono sdp-codehl__ta"
                rows="7"
                wrap="off"
                spellcheck="false"
                placeholder='{"input": "…"}'
                @input="syncTrialHlScroll()"
                @scroll="syncTrialHlScroll"
              ></textarea>
            </div>
            <div v-if="trialResult" class="sdp-trial__meta">
              <span class="mk-badge" :class="trialResult.success ? 'mk-badge--ok' : 'mk-badge--bad'">
                {{ trialResult.success ? '成功' : '失败' }}
              </span>
              <span class="sdp-chip">耗时 <b class="mono">{{ trialResult.duration ?? '—' }}ms</b></span>
              <span class="sdp-chip">{{ trialResult.cached ? '缓存' : '实时' }}</span>
              <button type="button" class="mk-link" @click="clearTrial">清空</button>
            </div>
            <div v-if="trialError" class="sdp-error">{{ trialError }}</div>
            <pre v-if="trialOutputText" class="sdp-output mono">{{ trialOutputText }}</pre>
          </section>

          <!-- 右：ACTIVE Prompt 只读参照 -->
          <section class="sdp-prompt">
            <header class="sdp-block__head">
              <div class="sdp-viewswitch">
                <button
                  type="button"
                  class="sdp-viewswitch__btn"
                  :class="{ 'sdp-viewswitch__btn--active': promptView === 'source' }"
                  @click="promptView = 'source'"
                >
                  源内容
                </button>
                <button
                  type="button"
                  class="sdp-viewswitch__btn"
                  :class="{ 'sdp-viewswitch__btn--active': promptView === 'compiled' }"
                  @click="promptView = 'compiled'"
                >
                  编译产物
                </button>
              </div>
              <button type="button" class="mk-link" @click="copy(promptView === 'source' ? compileInfo?.source || '' : compileInfo?.compiled || '')">
                复制
              </button>
            </header>
            <div class="sdp-prompt__facts">
              <span>DB ACTIVE <b class="mono">v{{ compileInfo?.promptVersion ?? '—' }}</b></span>
              <span>Hash <code class="mono">{{ shortHash(compileInfo?.sourceHash) }}</code></span>
              <span>{{ compileInfo?.status || '—' }}</span>
              <span class="sdp-prompt__used">{{ effectivePrompt?.prompt?._usedCompiled ? '运行时使用编译产物' : '运行时使用源内容' }}</span>
            </div>
            <p v-if="inspectError" class="sdp-none sdp-bad-text">Prompt 检视加载失败。<button type="button" class="mk-link" @click="loadInspect">重试</button></p>
            <pre class="sdp-prompt__code">{{ (promptView === 'source' ? compileInfo?.source : compileInfo?.compiled) || (inspectError ? '加载失败，请重试' : '暂无内容') }}</pre>
            <p class="sdp-prompt__hint">
              File-as-Truth：正式内容只能修改 <code class="mono">{{ overview.file?.path || 'prompts/skill.*.md' }}</code>，经部署同步生效。
            </p>
          </section>
        </div>

        <!-- 最近调用（全宽） -->
        <section class="sdp-block">
          <header class="sdp-block__head">
            <h4>最近调用</h4>
            <span class="sdp-block__meta">重跑：用真实输入复现</span>
          </header>
              <div v-if="recentLogs.length" class="sdp-logs">
                <div
                  v-for="log in recentLogs"
                  :key="log.id"
                  class="sdp-log"
                  :class="{ 'is-open': openLogId === log.id }"
                >
                  <button type="button" class="sdp-log__main" @click="toggleLogDetail(log)">
                    <span class="sdp-log__dot" :class="`is-${log.status}`"></span>
                    <span class="sdp-log__time mono">{{ log.time }}</span>
                    <span class="sdp-log__dur mono">{{ fmtMs(log.durationMs) }}</span>
                    <span class="sdp-log__summary">{{ log.summary }}</span>
                  </button>
                  <button
                    type="button"
                    class="sdp-log__rerun"
                    :disabled="log.loading || trialRunning"
                    @click="rerun(log)"
                  >
                    {{ log.loading ? '…' : '重跑' }}
                  </button>
                  <div v-if="openLogId === log.id && log.detail" class="sdp-log__detail">
                    <div v-if="log.detail.input" class="sdp-log__io">
                      <span>输入</span>
                      <pre class="mono">{{ displayCap(log.detail.input) }}</pre>
                    </div>
                    <div v-if="log.detail.output" class="sdp-log__io">
                      <span>输出</span>
                      <pre class="mono">{{ log.detail.output }}</pre>
                    </div>
                    <div v-if="log.detail.error" class="sdp-log__io sdp-log__io--err">
                      <span>错误</span>
                      <pre class="mono">{{ log.detail.error }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <p v-if="recentLogsLoading" class="sdp-none">日志加载中…</p>
              <p v-else-if="recentLogsError" class="sdp-none sdp-bad-text">近 8 条日志加载失败。<button type="button" class="mk-link" @click="loadRecentLogs">重试</button></p>
              <p v-else class="sdp-none">近 8 条日志窗口内无调用。</p>
        </section>
      </div>

      <!-- ========== 协议（core YAML · SSOT 编辑与发布） ========== -->
      <div v-show="tab === 'protocol'" class="sdp-pane">
        <div class="sdp-pw">
          <!-- 左：core 编辑器 -->
          <section class="sdp-block">
            <header class="sdp-block__head">
              <h4>核心文件 <code class="mono">prompts/core/{{ skillId }}.yaml</code></h4>
              <span class="sdp-block__meta">
                <span v-if="coreDirty" class="mk-badge mk-badge--muted">未保存</span>
                <button type="button" class="mk-link" :disabled="!coreLoaded || coreSaving" @click="saveCore">
                  {{ coreSaving ? '保存中…' : '保存并校验' }}
                </button>
                <button type="button" class="mk-link" :disabled="!coreLoaded || coreCompiling || coreDirty" :title="coreDirty ? '有未保存修改，请先保存' : ''" @click="previewCore">
                  {{ coreCompiling ? '编译中…' : '编译预览' }}
                </button>
                <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="!coreLoaded || corePublishing || coreDirty" :title="coreDirty ? '有未保存修改，请先保存' : ''" @click="publishCore(false)">
                  {{ corePublishing ? '发布中…' : '发布' }}
                </button>
              </span>
            </header>
            <p class="sdp-pw__hint">
              core YAML 是业务 SSOT：发布后确定性编译为五块 Prompt（<code class="mono">skill.{{ skillId }}.md</code> + DB ACTIVE），运行时立即生效。
            </p>
            <div class="sdp-pw__viewswitch">
              <button
                type="button"
                class="sdp-pw__viewbtn"
                :class="{ 'sdp-pw__viewbtn--active': coreViewMode === 'form' }"
                @click="switchCoreView('form')"
              >表单</button>
              <button
                type="button"
                class="sdp-pw__viewbtn"
                :class="{ 'sdp-pw__viewbtn--active': coreViewMode === 'raw' }"
                @click="switchCoreView('raw')"
              >源码</button>
            </div>
            <div v-if="coreClassification" class="sdp-pw__classify" :class="`sdp-pw__classify--${coreClassification.level}`">
              <strong>编辑分级：{{ coreLevelLabel(coreClassification.level) }}</strong>
              <ul><li v-for="(m, i) in coreClassification.messages" :key="i">{{ m }}</li></ul>
            </div>
            <div v-if="coreDiagnostics.length" class="sdp-pw__diag">
              <div v-for="(dg, i) in coreDiagnostics" :key="i" class="sdp-pw__diag-item">
                <span class="mono">{{ dg.code }}</span>
                <span>{{ dg.message }}</span>
              </div>
            </div>
            <div v-if="coreInputWarnings.length" class="sdp-pw__diag sdp-pw__diag--warn">
              <div v-for="(w, i) in coreInputWarnings" :key="i" class="sdp-pw__diag-item">
                <span class="mono">{{ w.code }}</span>
                <span>{{ w.message }}</span>
              </div>
            </div>

            <!-- 表单视图 -->
            <div v-if="coreViewMode === 'form'" class="sdp-pwform">
              <template v-if="coreForm">
                <!-- 身份 -->
                <section class="sdp-pwform__card">
                  <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('identity')">
                    <span>身份</span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('identity') }">▾</i>
                  </button>
                  <div v-show="openFormSections.has('identity')" class="sdp-pwform__cardbody">
                  <label class="sdp-pwform__field">
                    <span>identity（角色定位）</span>
                    <textarea v-model="coreForm.identity" rows="3" class="sdp-input" @input="coreDirty = true"></textarea>
                  </label>
                  <div class="sdp-pwform__field">
                    <span>channels（材料池，至少一个）</span>
                    <div class="sdp-pwform__checks">
                      <label v-for="c in CORE_CHANNELS" :key="c" class="sdp-pwform__check">
                        <input type="checkbox" :checked="coreForm.channels.includes(c)" @change="toggleChannel(c)" />
                        <code class="mono">{{ c }}</code>
                      </label>
                    </div>
                  </div>
                  <div class="sdp-pwform__row3">
                    <label class="sdp-pwform__check">
                      <input v-model="coreForm.stateAdvance" type="checkbox" @change="coreDirty = true" />
                      stateAdvance
                    </label>
                    <label class="sdp-pwform__check">
                      <input v-model="coreForm.deltaOutput" type="checkbox" @change="coreDirty = true" />
                      deltaOutput
                    </label>
                    <label class="sdp-pwform__field">
                      <span>outputMedia</span>
                      <select v-model="coreForm.outputMedia" class="sdp-input" @change="coreDirty = true">
                        <option v-for="m in CORE_OUTPUT_MEDIA" :key="m" :value="m">{{ m }}</option>
                      </select>
                    </label>
                  </div>
                  </div>
                </section>

                <!-- 输入声明（上游字段引用） -->
                <section class="sdp-pwform__card">
                  <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('inputs')">
                    <span>输入声明 <b class="mono">{{ coreForm.inputs.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('inputs') }">▾</i>
                  </button>
                  <div v-show="openFormSections.has('inputs')" class="sdp-pwform__cardbody">
                  <p class="sdp-pwform__note">
                    声明本 Skill 消费的输入。ref 前缀 = 来源分类：<code class="mono">skill:xxx.fieldPath</code>（上游 Skill 模型输出）/
                    <code class="mono">sandbox:agent.key</code>（编排注入，对照沙盘说明书 <code class="mono">prompts/agent-snapshots.md</code>）/
                    <code class="mono">user:path</code>（用户/平台，绿灯）。保存/发布时对账（skill→handoff、sandbox→沙盘注册表、user→通过）。
                  </p>
                  <div v-for="(input, i) in coreForm.inputs" :key="i" class="sdp-pwform__inputrow">
                    <input v-model="input.name" class="sdp-input" placeholder="别名 name（可选）" @input="coreDirty = true" />
                    <input v-model="input.type" class="sdp-input" placeholder="类型 type（可选）" @input="coreDirty = true" />
                    <input v-model="input.ref" class="sdp-input mono" placeholder="skill:path-planning.milestones | sandbox:path.normalizedInput | user:latestMessage" @input="coreDirty = true" />
                    <input v-model="input.desc" class="sdp-input" placeholder="用途说明 desc（可选）" @input="coreDirty = true" />
                    <button type="button" class="mk-link mk-link--danger" @click="removeInput(i)">删除</button>
                  </div>
                  <button type="button" class="mk-link" @click="addInput">+ 添加输入声明</button>
                  </div>
                </section>

                <!-- 规则 -->
                <section class="sdp-pwform__card">
                  <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('rules')">
                    <span>执行规则 <b class="mono">{{ coreForm.rules.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('rules') }">▾</i>
                  </button>
                  <div v-show="openFormSections.has('rules')" class="sdp-pwform__cardbody">
                  <div v-for="i in coreForm.rules.length" :key="i - 1" class="sdp-pwform__listitem">
                    <span class="sdp-pwform__idx mono">{{ i }}</span>
                    <textarea v-model="coreForm.rules[i - 1]" rows="2" class="sdp-input" @input="coreDirty = true"></textarea>
                    <span class="sdp-pwform__itemops">
                      <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.rules, i - 1, -1)">↑</button>
                      <button type="button" class="mk-link" :disabled="i === coreForm.rules.length" @click="moveItem(coreForm.rules, i - 1, 1)">↓</button>
                      <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.rules, i - 1)">删除</button>
                    </span>
                  </div>
                  <button type="button" class="mk-link" @click="addItem(coreForm.rules)">+ 添加规则</button>
                  </div>
                </section>

                <!-- 输出字段（高危：字段冻结守门） -->
                <section class="sdp-pwform__card sdp-pwform__card--danger">
                  <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('fields')">
                    <span>输出字段 <b class="mono">{{ coreForm.fields.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('fields') }">▾</i>
                  </button>
                  <div v-show="openFormSections.has('fields')" class="sdp-pwform__cardbody">
                  <p class="sdp-pwform__warn">增删字段、改型、改名会触发字段冻结守门。</p>
                  <div class="sdp-pwform__fields">
                    <div class="sdp-pwform__fieldrow sdp-pwform__fieldrow--head">
                      <span>name</span><span>type</span><span>可选</span><span>desc（生成指令）</span><span>turn</span><span></span>
                    </div>
                    <div v-for="(f, i) in coreForm.fields" :key="i" class="sdp-pwform__fieldrow">
                      <input v-model="f.name" class="sdp-input mono" placeholder="fieldName" @input="coreDirty = true" />
                      <select v-model="f.baseType" class="sdp-input" @change="coreDirty = true">
                        <option v-for="t in CORE_FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
                      </select>
                      <input v-model="f.optional" type="checkbox" aria-label="可选" @change="coreDirty = true" />
                      <input v-model="f.desc" class="sdp-input" placeholder="功能描述" @input="coreDirty = true" />
                      <input v-model="f.turn" type="checkbox" aria-label="turn（回合输出）" @change="coreDirty = true" />
                      <button type="button" class="mk-link mk-link--danger" @click="removeField(i)">删除</button>
                    </div>
                  </div>
                  <button type="button" class="mk-link" @click="addField">+ 添加字段</button>
                  </div>
                </section>

                <!-- 约束 -->
                <section class="sdp-pwform__card">
                  <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('constraints')">
                    <span>自检约束 <b class="mono">{{ coreForm.constraints.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('constraints') }">▾</i>
                  </button>
                  <div v-show="openFormSections.has('constraints')" class="sdp-pwform__cardbody">
                  <div v-for="i in coreForm.constraints.length" :key="i - 1" class="sdp-pwform__listitem">
                    <span class="sdp-pwform__idx mono">-</span>
                    <textarea v-model="coreForm.constraints[i - 1]" rows="2" class="sdp-input" @input="coreDirty = true"></textarea>
                    <span class="sdp-pwform__itemops">
                      <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.constraints, i - 1, -1)">↑</button>
                      <button type="button" class="mk-link" :disabled="i === coreForm.constraints.length" @click="moveItem(coreForm.constraints, i - 1, 1)">↓</button>
                      <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.constraints, i - 1)">删除</button>
                    </span>
                  </div>
                  <button type="button" class="mk-link" @click="addItem(coreForm.constraints)">+ 添加约束</button>
                  </div>
                </section>

                <!-- 参数 -->
                <section class="sdp-pwform__card">
                  <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('params')">
                    <span>生成参数</span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('params') }">▾</i>
                  </button>
                  <div v-show="openFormSections.has('params')" class="sdp-pwform__cardbody">
                  <div class="sdp-pwform__row3">
                    <label class="sdp-pwform__field">
                      <span>temperature</span>
                      <input v-model.number="coreForm.params.temperature" type="number" step="0.1" min="0" max="2" class="sdp-input" @input="coreDirty = true" />
                    </label>
                    <label class="sdp-pwform__field">
                      <span>maxTokens</span>
                      <input v-model.number="coreForm.params.maxTokens" type="number" step="100" min="1" class="sdp-input" @input="coreDirty = true" />
                    </label>
                    <label class="sdp-pwform__field">
                      <span>failurePolicy</span>
                      <select v-model="coreForm.params.failurePolicy" class="sdp-input" @change="coreDirty = true">
                        <option v-for="p in CORE_FAILURE_POLICIES" :key="p" :value="p">{{ p }}</option>
                      </select>
                    </label>
                  </div>
                  </div>
                </section>
              </template>
              <p v-else class="sdp-none">{{ coreMissing ? '该 Skill 暂无核心文件' : '加载中…' }}</p>
            </div>

            <!-- 源码视图（YAML 语法高亮覆盖层） -->
            <div v-else class="sdp-codehl">
              <pre class="sdp-codehl__pre mono" aria-hidden="true"><code v-html="coreHighlighted"></code></pre>
              <textarea
                ref="coreTextareaRef"
                v-model="coreText"
                class="sdp-pw__textarea mono sdp-codehl__ta"
                spellcheck="false"
                wrap="off"
                :placeholder="coreMissing ? '该 Skill 暂无核心文件（prompts/core/' + skillId + '.yaml）' : '加载中…'"
                :disabled="!coreLoaded"
                @input="coreDirty = true; syncHlScroll()"
                @scroll="syncHlScroll"
              ></textarea>
            </div>
            <div v-if="corePublishResult" class="sdp-pw__publish" :class="`sdp-pw__publish--${corePublishResult.ok ? 'ok' : 'bad'}`">
              <template v-if="corePublishResult.ok">
                已发布：{{ corePublishResult.agentId }} v{{ corePublishResult.version }} · coreHash
                <span class="mono">{{ coreShortHash(corePublishResult.coreHash) }}</span>
              </template>
              <template v-else>{{ corePublishResult.message }}</template>
            </div>
            <div v-if="coreUncertain" class="sdp-pw__uncertain">
              <strong>含义冻结判定不确定</strong>
              <p>{{ coreUncertain.rationale || 'judge 无法确定语义等价性' }}</p>
              <ul><li v-for="(f, i) in coreUncertain.findings || []" :key="i">[{{ f.severity }}] {{ f.aspect }}：{{ f.issue }}</li></ul>
              <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="corePublishing || coreDirty" @click="publishCore(true)">
                人工确认无误，强制发布
              </button>
            </div>
            <div v-if="corePublishIssues.length" class="sdp-pw__uncertain">
              <strong>发布被阻断（{{ corePublishIssues.length }} 个问题）</strong>
              <p>{{ corePublishIssues[0].message || '编译/校验未通过，请先处理以下问题' }}</p>
              <ul>
                <li v-for="(f, i) in corePublishIssues" :key="i">
                  <template v-if="f.code || f.severity">[{{ f.code || f.severity }}]</template>
                  {{ f.message || f.aspect || f.issue }}
                </li>
              </ul>
            </div>
          </section>

          <!-- 右：编译预览 / 版本 / 血缘 -->
          <section class="sdp-block">
            <header class="sdp-block__head">
              <span class="sdp-pw__pills">
                <button type="button" class="sdp-pw__pill" :class="{ 'sdp-pw__pill--active': coreSideTab === 'preview' }" @click="coreSideTab = 'preview'">编译预览</button>
                <button type="button" class="sdp-pw__pill" :class="{ 'sdp-pw__pill--active': coreSideTab === 'versions' }" @click="openCoreVersions">版本历史</button>
                <button type="button" class="sdp-pw__pill" :class="{ 'sdp-pw__pill--active': coreSideTab === 'lineage' }" @click="openCoreLineage">字段血缘</button>
              </span>
            </header>
            <div v-if="coreSideTab === 'preview'" class="sdp-pw__pane">
              <div v-if="coreGates" class="sdp-pw__gates">
                <div class="sdp-pw__gate" :class="coreGateCls(coreGates.structure?.length === 0)">
                  结构合法 {{ coreGates.structure?.length === 0 ? '✓' : `✗ ${coreGates.structure?.length}` }}
                </div>
                <div class="sdp-pw__gate" :class="coreGateCls(coreGates.fieldFreeze?.length === 0)">
                  字段冻结 {{ coreGates.fieldFreeze?.length === 0 ? '✓' : `✗ ${coreGates.fieldFreeze?.length}` }}
                </div>
                <div v-if="coreGates.semantic" class="sdp-pw__gate" :class="coreGateCls(coreGates.semanticDecision === 'pass')">
                  含义冻结 {{ coreGates.semantic.verdict }}（{{ coreGates.semanticDecision }}）
                </div>
                <div
                  v-if="Array.isArray(coreGates.inputHandoff)"
                  class="sdp-pw__gate"
                  :class="coreGateCls(coreGates.inputHandoff.length === 0)"
                >
                  输入对账 {{ coreGates.inputHandoff.length === 0 ? '✓' : `⚠ ${coreGates.inputHandoff.length} 条 advisory` }}
                </div>
                <div v-for="(issue, i) in coreGates.inputHandoff || []" :key="`ih-${i}`" class="sdp-pw__gate-issue">
                  [{{ issue.code }}] {{ issue.message }}
                </div>
                <div v-for="(issue, i) in [...(coreGates.structure || []), ...(coreGates.fieldFreeze || [])]" :key="i" class="sdp-pw__gate-issue">
                  [{{ issue.code }}] {{ issue.message }}
                </div>
              </div>
              <div v-if="coreCompiledMeta" class="sdp-pw__meta mono">
                coreHash {{ coreShortHash(coreCompiledMeta.coreHash) }} · coreVersion {{ coreCompiledMeta.coreVersion }}
              </div>
              <pre class="sdp-pw__pre">{{ coreCompiledPrompt || '点击「编译预览」查看五块产物（dry run，不写入）。' }}</pre>
            </div>
            <div v-else-if="coreSideTab === 'versions'" class="sdp-pw__pane">
              <div v-if="coreVersionsLoading" class="sdp-none">加载中…</div>
              <table v-else class="sdp-pw__table">
                <thead>
                  <tr><th>版本</th><th>coreHash</th><th>coreVer</th><th>状态</th><th>发布者</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="v in coreVersions" :key="v.version" :class="{ 'sdp-pw__table-active': v.status === 'ACTIVE' }">
                    <td class="mono">v{{ v.version }}</td>
                    <td class="mono">{{ coreShortHash(v.coreHash) }}</td>
                    <td class="mono">{{ v.coreVersion ?? '—' }}</td>
                    <td>{{ v.status }}</td>
                    <td>{{ v.createdBy }}</td>
                    <td>
                      <button
                        v-if="v.status !== 'ACTIVE' && v.rollbackable"
                        type="button"
                        class="mk-link"
                        :disabled="coreRollbacking"
                        @click="rollbackCore(v.version)"
                      >回滚</button>
                      <span v-else-if="v.status !== 'ACTIVE'" class="sdp-pw__audit" title="该历史版本没有可验证的 core 快照，只保留审计用途">仅审计</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!coreVersionsLoading && !coreVersions.length" class="sdp-none">暂无版本记录</p>
            </div>
            <div v-else class="sdp-pw__pane">
              <table class="sdp-pw__table">
                <thead><tr><th>字段</th><th>消费者（爆炸半径）</th></tr></thead>
                <tbody>
                  <tr v-for="(entry, i) in coreLineage" :key="i">
                    <td class="mono">{{ entry.field }}</td>
                    <td><div v-for="(c, j) in entry.consumers" :key="j" class="sdp-pw__consumer">{{ c }}</div></td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!coreLineage.length" class="sdp-none">该 skill 暂无血缘注册（后台消费或未登记）</p>
            </div>
          </section>
        </div>
      </div>

      <!-- ========== 版本 ========== -->
      <div v-show="tab === 'versions'" class="sdp-pane">
        <section class="sdp-versions">
          <header class="sdp-sec-head">
            <h4>版本管理</h4>
            <span class="sdp-sec-meta">{{ promptVersions.length }} 个版本</span>
          </header>
          <p v-if="versionMsg" class="sdp-versions-msg" :class="{ 'is-err': versionErr }">{{ versionMsg }}</p>
          <div class="mk-table-wrap">
            <table class="mk-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>状态</th>
                  <th>名称</th>
                  <th class="mk-th--right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="v in promptVersions" :key="v.id">
                  <td><span class="sdp-vtag mono">v{{ v.version }}</span></td>
                  <td>
                    <span class="mk-badge" :class="v.status === 'ACTIVE' ? 'mk-badge--ok' : 'mk-badge--muted'">{{ v.status }}</span>
                  </td>
                  <td><span class="sdp-vname" :title="v.name">{{ v.name || '—' }}</span></td>
                  <td>
                    <div class="mk-actions">
                      <button
                        v-if="v.status !== 'ACTIVE'"
                        type="button"
                        class="mk-link"
                        :disabled="versionBusy === v.id"
                        @click="compareWithActive(v)"
                      >
                        {{ compareLoading === v.id ? '对比中…' : '对比生效版' }}
                      </button>
                      <span v-if="v.status === 'ACTIVE'" class="mk-na">当前生效</span>
                    </div>
                  </td>
                </tr>
                <tr v-if="!promptVersions.length">
                  <td colspan="4"><span class="mk-na">暂无版本记录</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 对比结果 -->
          <div v-if="compareResult" class="sdp-diff">
            <div class="sdp-diff__head">
              <span class="mono">{{ compareResult.aLabel }} ↔ {{ compareResult.bLabel }}</span>
              <span class="sdp-diff__count" :class="{ 'is-clean': compareResult.changedLines === 0 }">
                {{ compareResult.changedLines ? `${compareResult.changedLines} 行变更` : '内容一致' }}
              </span>
              <button type="button" class="mk-link" @click="compareResult = null">收起</button>
            </div>
            <div class="sdp-diff__body mono">
              <template v-for="(grp, gi) in compareResult.groups" :key="gi">
                <div v-if="grp.gap" class="sdp-diff__gap">…</div>
                <div v-for="(line, li) in grp.lines" :key="li" class="sdp-diff__line" :class="`is-${line.type}`">
                  <span class="sdp-diff__no">{{ line.no }}</span>
                  <span class="sdp-diff__text">{{ line.text }}</span>
                </div>
              </template>
              <p v-if="!compareResult.groups.length && compareResult.changedLines === 0" class="sdp-diff__same">两版本内容完全一致。</p>
            </div>
          </div>
        </section>
      </div>

      <!-- ========== 运行时 ========== -->
      <div v-show="tab === 'runtime'" class="sdp-pane">
        <div class="sdp-notice">
          <strong>路由与可靠性</strong>
          只配置 endpoint / model 路由 / 超时 / 逻辑重试；温度与 Max Tokens 由 ACTIVE Prompt 管理。
        </div>

        <div class="sdp-chiprows">
          <div class="sdp-chiprow">
            <span class="sdp-chiprow__label">路由层</span>
            <span class="mk-badge" :class="rtForm.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">
              {{ rtForm.enabled ? '独立路由' : '继承上层 / 平台默认' }}
            </span>
            <span class="sdp-chip">超时 <b class="mono">{{ rtForm.requestTimeoutMs ? Math.round(rtForm.requestTimeoutMs / 1000) + 's' : '继承' }}</b></span>
            <span class="sdp-chip">Logical 预算 <b class="mono">{{ effectiveLogicalRetries }}</b> 次</span>
            <span class="sdp-chip">思考 <b class="mono">{{ thinkingLabel }}</b></span>
          </div>
          <div class="sdp-chiprow">
            <span class="sdp-chiprow__label">生成参数（只读）</span>
            <span class="sdp-chip sdp-chip--amber">T=<b class="mono">{{ generationParams?.temperature ?? '—' }}</b></span>
            <span class="sdp-chip sdp-chip--amber">Max=<b class="mono">{{ generationParams?.maxTokens ?? '—' }}</b></span>
            <span class="sdp-chip">{{ generationParams?.model || '继承路由模型' }}</span>
            <span class="sdp-chip">来源={{ generationParams?.sources?.temperature || generationParams?.owner || 'ACTIVE Prompt' }}</span>
          </div>
        </div>

        <div class="sdp-form mk-card">
          <div v-if="rtLoadFailed" class="sdp-error">运行时配置加载失败，已重置为默认值。<button type="button" class="mk-link" @click="loadRuntime">重试</button></div>
          <label class="sdp-field sdp-field--check">
            <input v-model="rtForm.enabled" type="checkbox" />
            <span>独立配置<em>关闭后继承调用 Agent 或平台默认</em></span>
          </label>
          <div class="sdp-form__grid">
            <label class="sdp-field">
              <span>模型层级</span>
              <select v-model="rtForm.tier" class="sdp-input" :disabled="!rtForm.enabled">
                <option value="chat">chat</option>
                <option value="reasoning">reasoning</option>
              </select>
            </label>
            <label class="sdp-field">
              <span>模型（留空继承）</span>
              <input v-model="rtForm.model" class="sdp-input mono" :disabled="!rtForm.enabled" placeholder="继承 Agent / 平台默认" />
            </label>
            <label class="sdp-field">
              <span>思考模式</span>
              <select v-model="rtForm.thinkingMode" class="sdp-input" :disabled="!rtForm.enabled">
                <option value="default">跟随继承值 / 模型默认</option>
                <option value="enabled">开启</option>
                <option value="disabled">关闭</option>
              </select>
            </label>
            <label class="sdp-field">
              <span>思考强度</span>
              <select v-model="rtForm.reasoningEffort" class="sdp-input" :disabled="!rtForm.enabled || rtForm.thinkingMode === 'disabled'">
                <option value="default">跟随继承值 / 模型默认</option>
                <option value="high">high</option>
                <option value="max">max</option>
              </select>
            </label>
            <label class="sdp-field">
              <span>请求超时（ms）</span>
              <input v-model.number="rtForm.requestTimeoutMs" type="number" min="10000" max="300000" step="10000" class="sdp-input" :disabled="!rtForm.enabled" placeholder="继承" />
            </label>
          </div>

          <div class="sdp-divider">
            <strong>失败处理与重试</strong>
            <span>逻辑重试独立于模型覆盖；传输重试由平台统一管理。</span>
          </div>

          <div class="sdp-form__grid">
            <label class="sdp-field">
              <span>Logical Retry（平台默认 {{ platformLogicalRetries }} 次）</span>
              <select v-model="logicalRetryMode" class="sdp-input">
                <option value="inherit">继承平台默认</option>
                <option value="disabled">禁用</option>
                <option value="custom" :disabled="platformLogicalRetries <= 0">自定义</option>
              </select>
            </label>
            <label v-if="logicalRetryMode === 'custom'" class="sdp-field">
              <span>最大逻辑重试次数</span>
              <input v-model.number="customLogicalRetries" type="number" :min="1" :max="platformLogicalRetries" step="1" class="sdp-input" />
            </label>
            <label class="sdp-field">
              <span>业务回退</span>
              <input class="sdp-input" model-value="由 Skill 代码定义" disabled />
            </label>
          </div>

          <div class="sdp-form__footer">
            <p v-if="rtMsg" class="sdp-form__msg" :class="{ 'is-err': rtErr }">{{ rtMsg }}</p>
            <button type="button" class="mk-btn sdp-btn--danger" :disabled="rtSaving" @click="resetRuntime">恢复默认</button>
            <button type="button" class="mk-btn" :disabled="rtSaving" @click="loadRuntime">刷新</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="rtSaving" @click="saveRuntime">
              {{ rtSaving ? '保存中…' : '保存配置' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 工程 ========== -->
      <div v-show="tab === 'engineering'" class="sdp-pane">
        <section class="sdp-eng">
          <header class="sdp-sec-head"><h4>基础信息</h4></header>
          <table class="sdp-kv">
            <tbody>
              <tr><th>kind</th><td><code class="mono">{{ overview.kind }}</code></td></tr>
              <tr><th>agentId</th><td><code class="mono">{{ overview.agentId }}</code></td></tr>
              <tr v-if="overview.file"><th>file path</th><td><code class="mono">{{ overview.file.path }}</code></td></tr>
              <tr v-if="overview.file?.hash"><th>file hash</th><td><code class="mono">{{ shortHash(overview.file.hash) }}</code></td></tr>
              <tr v-if="overview.db?.id"><th>DB ACTIVE id</th><td><code class="mono">{{ overview.db.id }}</code></td></tr>
              <tr v-if="overview.db?.version"><th>DB ACTIVE version</th><td><code class="mono">v{{ overview.db.version }}</code></td></tr>
              <tr v-if="overview.db?.useCount !== undefined"><th>调用次数</th><td>{{ overview.db.useCount }}</td></tr>
              <tr v-if="overview.db?.model"><th>默认模型</th><td><code class="mono">{{ overview.db.model }}</code></td></tr>
              <tr v-if="overview.db?.publishedAt"><th>发布时间</th><td>{{ fmtTime(String(overview.db.publishedAt)) }}</td></tr>
              <tr v-if="overview.drift">
                <th>漂移状态</th>
                <td><code class="mono" :class="overview.drift === 'in-sync' ? 'sdp-ok' : 'sdp-warn'">{{ overview.drift }}</code></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="overview.runtimeContract" class="sdp-eng">
          <header class="sdp-sec-head">
            <h4>运行时契约</h4>
            <span class="sdp-sec-meta mono">{{ overview.runtimeContractSource === 'manifest' ? 'prompt-lab/manifests' : 'buildDefaultRuntimeContract' }}</span>
          </header>
          <table class="sdp-kv">
            <tbody>
              <tr><th>version</th><td><code class="mono">{{ overview.runtimeContract.version }}</code></td></tr>
              <tr><th>contextMode</th><td><code class="mono">{{ overview.runtimeContract.contextMode }}</code></td></tr>
              <tr v-if="overview.runtimeContract.businessState?.domain"><th>domain</th><td><code class="mono">{{ overview.runtimeContract.businessState.domain }}</code></td></tr>
              <tr v-if="overview.runtimeContract.businessState?.phases"><th>phases</th><td><code class="mono">{{ overview.runtimeContract.businessState.phases.join(', ') }}</code></td></tr>
              <tr v-if="overview.runtimeContract.businessState?.defaultPhase"><th>defaultPhase</th><td><code class="mono">{{ overview.runtimeContract.businessState.defaultPhase }}</code></td></tr>
              <tr v-if="overview.runtimeContract.businessState?.terminalPhases"><th>terminalPhases</th><td><code class="mono">{{ overview.runtimeContract.businessState.terminalPhases.join(', ') }}</code></td></tr>
              <tr v-if="overview.runtimeContract.contextUpdate?.mode"><th>contextUpdate.mode</th><td><code class="mono">{{ overview.runtimeContract.contextUpdate.mode }}</code></td></tr>
              <tr><th>outputEnvelope</th><td><code class="mono">{{ overview.runtimeContract.outputEnvelope }}</code></td></tr>
            </tbody>
          </table>
        </section>

        <section class="sdp-eng">
          <header class="sdp-sec-head">
            <h4>协议视图</h4>
            <span class="sdp-sec-meta">{{ protocols.length ? `${protocols.length} 组协议` : '' }}</span>
          </header>
          <div v-if="protocols.length" class="sdp-protocols">
            <article v-for="p in protocols" :key="p.id" class="sdp-protocol">
              <header>
                <strong>{{ p.title }}</strong>
                <span class="mk-badge mk-badge--muted">{{ p.statusLabel }}</span>
              </header>
              <p>{{ p.summary }}</p>
              <span class="sdp-protocol__sites mono">{{ p.callSites }}</span>
            </article>
          </div>
          <p v-if="engProtoFailed" class="sdp-none sdp-bad-text">协议数据加载失败。<button type="button" class="mk-link" @click="retryEngineering">重试</button></p>
          <p v-else class="sdp-none">暂无协议数据。</p>
        </section>

        <section class="sdp-eng">
          <header class="sdp-sec-head">
            <h4>Skill 规则总览</h4>
            <span class="sdp-sec-meta" v-if="rulesOverview">
              {{ rulesOverview.summary.totalRules }} 规则 · {{ rulesOverview.summary.totalPrefixes }} 前缀
              <template v-if="rulesOverview.summary.conflictPrefixCount > 0">
                · <b class="sdp-warn">{{ rulesOverview.summary.conflictPrefixCount }} 冲突</b>
              </template>
            </span>
          </header>
          <div v-if="rulesOverview?.conflictPrefixes?.length" class="sdp-conflict">
            <strong>prefix 冲突：</strong>
            <span v-for="c in rulesOverview.conflictPrefixes" :key="c.prefix">
              <code class="mono">{{ c.prefix }}</code> 同时被 <code class="mono">{{ c.agentIds.join(', ') }}</code> 使用
            </span>
          </div>
          <div v-if="nodeRules.length" class="sdp-rules">
            <div v-for="r in nodeRules" :key="r.ruleId" class="sdp-rule">
              <span class="sdp-rule__id mono">{{ r.ruleId }}</span>
              <span class="sdp-rule__text">{{ r.text }}</span>
            </div>
          </div>
          <p v-if="engRulesFailed" class="sdp-none sdp-bad-text">规则数据加载失败。</p>
          <p v-else class="sdp-none">本节点没有登记规则。</p>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * SkillDesignPage（Prompt 二级设计页 · 调试闭环重设计）
 * 路由：/admin/skills/:agentId
 * 设计主线：复现问题 / 安全变更 / 性能排障 三条工作流
 *   工作台 = Prompt 内容 + 试跑 + 最近调用（真实输入一键重跑）同屏
 *   版本 = 版本表 + 行级 diff（全宽）
 *   运行时 = 路由/可靠性表单
 *   工程 = 低频 kv / 契约 / 协议 / 规则
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import hljs from 'highlight.js/lib/core'
import yaml from 'highlight.js/lib/languages/yaml'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark.css'
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('json', json)
import {
  adminAgentPromptsApi,
  adminAgentsApi,
  adminPlatformSettingsApi,
  adminPromptOpsApi,
  adminPromptWorkbenchApi,
  adminSkillWorkbenchApi,
  adminSkillsApi
} from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import { AGENT_TONES } from './store'
import './shared.css'
import { toast } from '@/utils/toast'

/* ---------- 路由与基础 ---------- */
const route = useRoute()
const router = useRouter()

const agentIdParam = computed(() => {
  const v = route.params.agentId
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : ''
})
const skillId = computed(() => agentIdParam.value.replace(/^skill:/, ''))

async function goConsole() {
  void router.push('/admin/console')
}

/** Dry Run → 试跑页签 */
function goDryRun() {
  tab.value = 'trial'
}

/* ---------- 阶段色（与拓扑/抽屉同套，单源 store.AGENT_TONES） ---------- */
const tone = computed(() => {
  const pid = workbenchMeta.value?.parentAgent?.id || ''
  return AGENT_TONES[pid] || { hue: '#3478f6', soft: 'rgba(52, 120, 246, 0.1)' }
})

/* ---------- Toast ---------- */
/* ---------- 总览与元数据 ---------- */
interface OverviewItem {
  agentId: string
  kind: string
  displayName: string
  health: 'good' | 'warn' | 'risk'
  file: { path?: string; hash?: string } | null
  db: { id?: string; version?: number | string; hash?: string; useCount?: number; model?: string; publishedAt?: string } | null
  drift: 'in-sync' | 'file-vs-db-mismatch' | null
  runtimeContract?: {
    version?: string
    contextMode?: string
    businessState?: { domain?: string; phases?: string[]; defaultPhase?: string; terminalPhases?: string[] } | null
    contextUpdate?: { mode?: string } | null
    outputEnvelope?: string
  } | null
  runtimeContractSource?: 'manifest' | 'default' | null
}

interface WorkbenchMeta {
  skill?: { id: string; name: string; description: string }
  parentAgent?: { id: string; name: string } | null
  modelConfig?: { temperature?: number } | null
  stats?: { totalCalls: number; successRate: number | null; avgDuration: number }
}

const loading = ref(false)
const notFound = ref(false)
const overview = ref<OverviewItem | null>(null)
const workbenchMeta = ref<WorkbenchMeta | null>(null)

const healthLabel = computed(() => ({ good: '健康', warn: '需关注', risk: '风险' })[overview.value?.health || 'warn'])
const healthBadgeCls = computed(() =>
  overview.value?.health === 'good' ? 'mk-badge--ok' : overview.value?.health === 'warn' ? 'mk-badge--warn' : 'mk-badge--bad'
)
/** 状态条圆点色调（与 console mk-status 语言一致） */
const statusToneCls = computed(() =>
  overview.value?.health === 'good' ? 'mk-status--ok' : overview.value?.health === 'warn' ? 'mk-status--warn' : 'mk-status--bad'
)

/* ---------- Tabs ---------- */
type TabKey = 'protocol' | 'trial' | 'versions' | 'runtime' | 'engineering'
/* 页签按任务流：协议(改) → 试跑(验) → 版本(看线上) → 运行时(调) → 工程(查)；默认落协议 */
const tab = ref<TabKey>('protocol')
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'protocol', label: '协议' },
  { key: 'trial', label: '试跑' },
  { key: 'versions', label: '版本' },
  { key: 'runtime', label: '运行时' },
  { key: 'engineering', label: '工程' }
]
// ?tab= 直达 + 旧链接兼容（workbench 已拆入试跑）
function applyQTab() {
  const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (['protocol', 'trial', 'versions', 'runtime', 'engineering'].includes(qTab)) tab.value = qTab as TabKey
  if (qTab === 'workbench' || qTab === 'inspect' || qTab === 'preview' || qTab === 'trial') tab.value = 'trial'
  if (qTab === 'edit') tab.value = 'protocol'
}
applyQTab()
watch(() => route.query.tab, applyQTab)

/* ---------- Prompt 内容 ---------- */
interface CompileInfo {
  promptVersion?: number | string
  sourceHash?: string
  status?: string
  source?: string
  compiled?: string
}
interface EffectivePrompt {
  prompt?: { _usedCompiled?: boolean; version?: number | string; systemPrompt?: string }
}
const compileInfo = ref<CompileInfo | null>(null)
const effectivePrompt = ref<EffectivePrompt | null>(null)
const promptView = ref<'source' | 'compiled'>('source')
const inspectError = ref(false)

const shortHash = (v?: string | null) => (v ? v.slice(0, 12) : '—')

async function loadInspect() {
  const id = skillId.value
  inspectError.value = false
  let ciOk = true
  let epOk = true
  const ci = await adminPromptOpsApi
    .getPromptCompileInfo(`skill:${id}`)
    .catch(() => { ciOk = false; return null })
  const ep = await adminSkillsApi
    .getEffectiveSkillPrompt(id)
    .catch(() => { epOk = false; return null })
  if (id !== skillId.value) return
  inspectError.value = !ciOk || !epOk
  compileInfo.value = ci?.data?.data ?? null
  effectivePrompt.value = ep?.data?.data ?? null
}

/* ---------- 版本管理 ---------- */
interface VersionItem { id: string; version: string | number; status: string; name: string }
const promptVersions = ref<VersionItem[]>([])
const versionBusy = ref('')
const compareLoading = ref('')
const versionMsg = ref('')
const versionErr = ref(false)
interface DiffLine { type: 'added' | 'removed'; no: number | string; text: string }
interface DiffGroup { gap: boolean; lines: DiffLine[] }
const compareResult = ref<{ aLabel: string; bLabel: string; changedLines: number; groups: DiffGroup[] } | null>(null)

async function loadVersions() {
  const id = skillId.value
  const res = await adminAgentPromptsApi.getPromptVersions({ agentId: `skill:${id}` }).catch(() => null)
  if (id !== skillId.value) return
  const body = res?.data?.data ?? res?.data ?? []
  const items = Array.isArray(body) ? body : body.list || body.items || body.versions || []
  // ACTIVE 优先排前，避免切片后「对比生效版」误报没有生效版本
  const sorted = [...(items as Array<Record<string, unknown>>)].sort(
    (a, b) => Number(String(b.status === 'ACTIVE')) - Number(String(a.status === 'ACTIVE'))
  )
  promptVersions.value = sorted.slice(0, 12).map((v: Record<string, unknown>) => ({
    id: String(v.id || ''),
    version: (v.version as string | number) ?? '—',
    status: String(v.status || '—'),
    name: String(v.name || '')
  }))
}

async function compareWithActive(v: VersionItem) {
  const active = promptVersions.value.find((x) => x.status === 'ACTIVE')
  if (!active) {
    versionMsg.value = '当前没有生效版本可作对比基准'
    versionErr.value = true
    return
  }
  if (compareLoading.value) return
  compareLoading.value = v.id
  versionMsg.value = ''
  versionErr.value = false
  try {
    const res = await adminAgentPromptsApi.comparePrompts(active.id, v.id)
    const d = res.data?.data ?? res.data ?? {}
    const diffs = (d.diffs || []) as Array<Record<string, unknown>>
    const groups: DiffGroup[] = []
    let current: DiffLine[] = []
    const flush = () => {
      if (current.length) {
        groups.push({ gap: groups.length > 0, lines: current })
        current = []
      }
    }
    for (const row of diffs) {
      const type = String(row.type)
      if (type === 'same') {
        flush()
        continue
      }
      if (type === 'added') current.push({ type: 'added', no: Number(row.bLine || 0), text: String(row.bText ?? '') })
      else if (type === 'removed') current.push({ type: 'removed', no: Number(row.aLine || 0), text: String(row.aText ?? '') })
      else if (type === 'modified') {
        current.push({ type: 'removed', no: Number(row.aLine || 0), text: String(row.aText ?? '') })
        current.push({ type: 'added', no: Number(row.bLine || 0), text: String(row.bText ?? '') })
      }
      if (current.length >= 300) {
        flush()
        break
      }
    }
    flush()
    compareResult.value = {
      aLabel: `v${active.version}（生效）`,
      bLabel: `v${v.version}`,
      changedLines: Number(d.changedLines || 0),
      groups
    }
  } catch (e) {
    versionMsg.value = `对比失败：${errText(e)}`
    versionErr.value = true
  } finally {
    compareLoading.value = ''
  }
}

/* ---------- 试跑 ---------- */
const trialInput = ref('{\n  "input": "用一句话介绍你自己"\n}')
const trialRunning = ref(false)
const trialResult = ref<{ success?: boolean; duration?: number; cached?: boolean; output?: unknown; data?: unknown } | null>(null)
const trialError = ref('')

const trialOutputText = computed(() => {
  if (!trialResult.value) return ''
  const payload = trialResult.value.output ?? trialResult.value.data ?? trialResult.value
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
})

function formatTrialJson() {
  try {
    trialInput.value = JSON.stringify(JSON.parse(trialInput.value), null, 2)
  } catch (e) {
    toast.error(`JSON 不合法：${errText(e)}`)
  }
}

function clearTrial() {
  trialResult.value = null
  trialError.value = ''
}

async function runTrial() {
  const id = skillId.value
  let payload: unknown
  try {
    payload = JSON.parse(trialInput.value || '{}')
  } catch (e) {
    toast.error(`输入 JSON 不合法：${errText(e)}`)
    return
  }
  if (trialRunning.value) return
  trialRunning.value = true
  trialError.value = ''
  try {
    const res = await adminSkillsApi.testSkill(id, payload)
    if (id !== skillId.value) return
    trialResult.value = res.data?.data ?? res.data ?? null
  } catch (e) {
    if (id !== skillId.value) return
    trialResult.value = null
    trialError.value = `试运行失败：${errText(e)}`
  } finally {
    trialRunning.value = false
  }
}

/* ---------- 最近调用（真实输入一键重跑） ---------- */
interface LogRow {
  id: string
  status: 'ok' | 'err' | 'timeout'
  time: string
  durationMs: number
  summary: string
  loading: boolean
  detail: { input?: string; output?: string; error?: string } | null
}
const recentLogs = ref<LogRow[]>([])
const recentLogsError = ref(false)
const recentLogsLoading = ref(false)
const openLogId = ref('')

const recentFailures = computed(() => recentLogs.value.filter((l) => l.status !== 'ok').length)

function mapLogStatus(s: unknown): LogRow['status'] {
  return s === 'error' ? 'err' : s === 'timeout' ? 'timeout' : 'ok'
}

async function loadRecentLogs() {
  const id = skillId.value
  recentLogsError.value = false
  recentLogsLoading.value = true
  try {
    const res = await adminAgentsApi.getLogs({ agentName: `skill:${id}`, limit: 8, timeRange: 'week' }).catch(() => null)
    if (id !== skillId.value) return
    if (!res) {
      recentLogsError.value = true
      recentLogs.value = []
      return
    }
    const body = res?.data?.data ?? res?.data ?? {}
    const items: Record<string, unknown>[] = Array.isArray(body) ? body : body.items || body.logs || []
    recentLogs.value = items.map((l) => {
      const status = mapLogStatus(l.status)
      const errText = String(l.errorMessage || l.error || '')
      return {
        id: String(l.id),
        status,
        time: timeAgo(String(l.createdAt || '')),
        durationMs: Number(l.durationMs || 0),
        summary: status === 'ok' ? '成功' : errText.slice(0, 60) || (status === 'timeout' ? '超时' : '失败'),
        loading: false,
        detail: null
      }
    })
  } finally {
    if (id === skillId.value) recentLogsLoading.value = false
  }
}

/** 拉详情（输入/输出），供展开与重跑共用；input 保留完整原文供重跑，展示时再截断 */
async function ensureLogDetail(log: LogRow): Promise<void> {
  if (log.detail || log.loading) return
  log.loading = true
  try {
    const res = await adminAgentsApi.getLogDetail(log.id)
    const body = res.data?.data ?? res.data ?? {}
    const d = (body.log || body) as Record<string, unknown>
    const raw = (v: unknown): string | undefined => {
      if (v == null) return undefined
      return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    }
    const cap = (v: unknown): string | undefined => {
      if (v == null) return undefined
      const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
      return s.length > 3000 ? `${s.slice(0, 3000)}\n…（截断）` : s
    }
    log.detail = {
      input: raw(d.input ?? d.userPayload ?? d.requestPayload),
      output: cap(d.output ?? d.modelOutput ?? d.responsePayload),
      error: cap(d.errorMessage ?? d.error)
    }
  } catch {
    log.detail = { error: '详情加载失败' }
  } finally {
    log.loading = false
  }
}

async function toggleLogDetail(log: LogRow) {
  if (openLogId.value === log.id) {
    openLogId.value = ''
    return
  }
  openLogId.value = log.id
  await ensureLogDetail(log)
}

/** 一键重跑：真实输入填入试跑并立即运行 */
async function rerun(log: LogRow) {
  await ensureLogDetail(log)
  if (!log.detail?.input) {
    toast.error('该调用没有可用输入')
    return
  }
  trialInput.value = log.detail.input
  tab.value = 'trial'
  toast.info('已填入真实输入，正在重跑…')
  await runTrial()
}

/* ---------- 运行时 ---------- */
interface RuntimeForm {
  tier: 'chat' | 'reasoning'
  model: string
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | 'high' | 'max'
  requestTimeoutMs: number | null
  enabled: boolean
}
const rtForm = ref<RuntimeForm>({
  tier: 'chat',
  model: '',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  requestTimeoutMs: null,
  enabled: false
})
const rtSaving = ref(false)
const rtMsg = ref('')
const rtErr = ref(false)
const rtLoadFailed = ref(false)
const platformLogicalRetries = ref(1)
const logicalRetryMode = ref<'inherit' | 'disabled' | 'custom'>('inherit')
const customLogicalRetries = ref(1)
const generationParams = ref<{ model?: string | null; temperature?: number | null; maxTokens?: number | null; sources?: Record<string, string>; owner?: string } | null>(null)

const effectiveLogicalRetries = computed(() =>
  logicalRetryMode.value === 'inherit' ? platformLogicalRetries.value : logicalRetryMode.value === 'disabled' ? 0 : customLogicalRetries.value
)
const thinkingLabel = computed(() =>
  rtForm.value.thinkingMode === 'enabled' ? '开启' : rtForm.value.thinkingMode === 'disabled' ? '关闭' : '继承/默认'
)

watch(
  () => rtForm.value.thinkingMode,
  (m) => {
    if (m === 'disabled') rtForm.value.reasoningEffort = 'default'
  }
)

/** 默认运行时表单（与初始定义一致）；切 skill / 404 时显式回退，避免残留上一个 skill 的数据 */
function resetRtForm() {
  rtForm.value = {
    tier: 'chat',
    model: '',
    thinkingMode: 'default',
    reasoningEffort: 'default',
    requestTimeoutMs: null,
    enabled: false
  }
  logicalRetryMode.value = 'inherit'
  customLogicalRetries.value = 1
}

async function loadRuntime() {
  const id = skillId.value
  rtLoadFailed.value = false
  const [skillRes, relRes] = await Promise.allSettled([
    adminSkillsApi.getSkillModelConfig(id),
    adminPlatformSettingsApi.getReliabilitySettings()
  ])
  if (id !== skillId.value) return
  if (skillRes.status === 'rejected') rtLoadFailed.value = true
  if (relRes.status === 'fulfilled') {
    platformLogicalRetries.value = Number(relRes.value.data?.data?.settings?.maxLogicalRetries ?? 1)
  }
  if (skillRes.status === 'fulfilled') {
    const raw = (skillRes.value.data?.data || null) as (RuntimeForm & { maxLogicalRetries?: number | null; generationParams?: typeof generationParams.value }) | null
    generationParams.value = raw?.generationParams || null
    rtForm.value = {
      tier: raw?.tier === 'reasoning' ? 'reasoning' : 'chat',
      model: raw?.model || '',
      thinkingMode: raw?.thinkingMode || 'default',
      reasoningEffort: raw?.reasoningEffort || 'default',
      requestTimeoutMs: raw?.requestTimeoutMs ?? null,
      enabled: raw?.enabled === true
    }
    logicalRetryMode.value = raw?.maxLogicalRetries == null ? 'inherit' : raw.maxLogicalRetries === 0 ? 'disabled' : 'custom'
    customLogicalRetries.value = raw?.maxLogicalRetries && raw.maxLogicalRetries > 0 ? Math.min(raw.maxLogicalRetries, platformLogicalRetries.value || 1) : 1
  } else {
    // 无独立配置（404）等失败：显式重置为默认值，不残留上一 skill
    resetRtForm()
    generationParams.value = null
  }
}

async function saveRuntime() {
  if (rtSaving.value) return
  rtSaving.value = true
  rtMsg.value = ''
  // v-model.number 空输入会得到 ''/NaN：保存前归一为 null，避免 400
  const normNum = (v: unknown): number | null => {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return null
    return Number(v)
  }
  try {
    await adminSkillsApi.updateSkillModelConfig(skillId.value, {
      tier: rtForm.value.tier,
      model: rtForm.value.model || undefined,
      thinkingMode: rtForm.value.thinkingMode,
      reasoningEffort: rtForm.value.thinkingMode === 'disabled' ? 'default' : rtForm.value.reasoningEffort,
      requestTimeoutMs: rtForm.value.enabled ? normNum(rtForm.value.requestTimeoutMs) : null,
      maxLogicalRetries: logicalRetryMode.value === 'inherit' ? null : logicalRetryMode.value === 'disabled' ? 0 : normNum(customLogicalRetries.value),
      enabled: rtForm.value.enabled
    })
    rtErr.value = false
    rtMsg.value = '路由/可靠性已更新（生成参数仍由 ACTIVE Prompt 管理）'
    await loadRuntime()
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `保存失败：${errText(e)}`
  } finally {
    rtSaving.value = false
  }
}

async function resetRuntime() {
  if (rtSaving.value) return
  const ok = await askConfirm({
    title: '恢复默认配置',
    message: '确定恢复该 Skill 的默认模型配置吗？\n独立配置将被删除，恢复为继承上层 / 平台默认。',
    confirmText: '恢复默认'
  })
  if (!ok) return
  rtSaving.value = true
  rtMsg.value = ''
  try {
    await adminSkillsApi.deleteSkillModelConfig(skillId.value)
    rtErr.value = false
    rtMsg.value = '已恢复默认（继承上层 / 平台）'
    await loadRuntime()
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `恢复失败：${errText(e)}`
  } finally {
    rtSaving.value = false
  }
}

/* ---------- 协议：core YAML（SSOT）编辑 / 编译 / 发布 ---------- */
const CORE_CHANNELS = ['dialogue', 'state', 'task', 'evidence', 'learner', 'path'] as const
const CORE_FIELD_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'object[]', 'string[]'] as const
const CORE_FAILURE_POLICIES = ['retry', 'fallback', 'propagate'] as const
const CORE_OUTPUT_MEDIA = ['json', 'markdown', 'text'] as const

interface CoreFormField {
  name: string
  baseType: string
  optional: boolean
  desc: string
  turn: boolean
}
interface CoreFormState {
  identity: string
  channels: string[]
  stateAdvance: boolean
  deltaOutput: boolean
  outputMedia: string
  inputs: { ref: string; note: string; name?: string; type?: string; desc?: string }[]
  rules: string[]
  constraints: string[]
  examples: string[]
  fields: CoreFormField[]
  params: { temperature: number; maxTokens: number; failurePolicy: string }
}

interface CoreDiagnostic { code: string; message: string }
interface CoreClassification { level: 'safe' | 'restricted' | 'blocked'; messages: string[] }
interface CoreVersionRow {
  version: number; status: string; coreHash: string | null; coreVersion: number | null
  createdBy: string; publishedAt: string | null; rollbackable: boolean
}
interface CoreLineageEntry { field: string; consumers: string[] }

const coreText = ref('')
const coreLoaded = ref(false)
const coreMissing = ref(false)
const coreDirty = ref(false)
const coreSaving = ref(false)
const coreCompiling = ref(false)
const corePublishing = ref(false)
const coreRollbacking = ref(false)

/* 源码视图：YAML 语法高亮覆盖层（高亮层与 textarea 同步滚动） */
const coreTextareaRef = ref<HTMLTextAreaElement | null>(null)
const coreHighlighted = computed(() => {
  if (!coreText.value) return ''
  try {
    return hljs.highlight(coreText.value, { language: 'yaml', ignoreIllegals: true }).value
  } catch {
    return coreText.value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c)
  }
})
function syncHlScroll() {
  syncHlScrollFor(coreTextareaRef)
}

/** 通用高亮层滚动同步（core YAML / 试跑 JSON 共用） */
function syncHlScrollFor(taRef: { value: HTMLTextAreaElement | null }) {
  const ta = taRef.value
  if (!ta) return
  const pre = ta.parentElement?.querySelector('.sdp-codehl__pre') as HTMLElement | null
  if (pre) {
    pre.scrollTop = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
  }
}

/** 试跑输入 JSON 高亮 */
const trialTextareaRef = ref<HTMLTextAreaElement | null>(null)
function syncTrialHlScroll() {
  syncHlScrollFor(trialTextareaRef)
}
const trialHighlighted = computed(() => {
  if (!trialInput.value) return ''
  try {
    return hljs.highlight(trialInput.value, { language: 'json', ignoreIllegals: true }).value
  } catch {
    return trialInput.value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c)
  }
})
const coreDiagnostics = ref<CoreDiagnostic[]>([])
const coreInputWarnings = ref<CoreDiagnostic[]>([])
const coreClassification = ref<CoreClassification | null>(null)
const coreSideTab = ref<'preview' | 'versions' | 'lineage'>('preview')
const coreGates = ref<any>(null)
const coreCompiledPrompt = ref('')
const coreCompiledMeta = ref<{ coreHash: string; coreVersion: number } | null>(null)
const corePublishResult = ref<{ ok: boolean; message?: string; agentId?: string; version?: number; coreHash?: string } | null>(null)
const coreUncertain = ref<any>(null)
const corePublishIssues = ref<Array<Record<string, unknown>>>([])
const coreVersions = ref<CoreVersionRow[]>([])
const coreVersionsLoading = ref(false)
const coreLineage = ref<CoreLineageEntry[]>([])
const coreViewMode = ref<'form' | 'raw'>('form')
/**
 * 切换表单/源码视图：当前视图有未保存修改时先保存到磁盘，再重拉使两视图同步，
 * 避免「表单改动切到源码后保存覆盖」或反向丢失（保存失败阻止切换）。
 */
async function switchCoreView(mode: 'form' | 'raw') {
  if (mode === coreViewMode.value) return
  if (coreDirty.value && coreLoaded.value) {
    const saved = await saveCore()
    if (!saved) return
  }
  coreViewMode.value = mode
  // raw 视图保存后 coreForm 未回读：统一重拉保持两视图一致
  if (mode === 'form' && coreLoaded.value) {
    coreRequested = false
    await ensureCoreLoaded()
  }
}

const coreForm = ref<CoreFormState | null>(null)
let coreRequested = false

/* 协议表单折叠：高频段（身份/输入/输出字段）默认展开，低频段默认收起 */
const openFormSections = ref<Set<string>>(new Set(['identity', 'inputs', 'fields']))
function toggleFormSection(key: string) {
  const next = new Set(openFormSections.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openFormSections.value = next
}

/* ---------- 表单视图：CoreFile JSON → 表单状态 ---------- */
function initCoreForm(core: Record<string, unknown> | null) {
  if (!core) {
    coreForm.value = null
    return
  }
  const fields = Array.isArray(core.fields) ? core.fields : []
  const params = (core.params || {}) as Record<string, unknown>
  coreForm.value = {
    identity: String(core.identity || ''),
    channels: Array.isArray(core.channels) ? core.channels.map((c) => String(c)) : [],
    stateAdvance: core.stateAdvance === true,
    deltaOutput: core.deltaOutput === true,
    outputMedia: String(core.outputMedia || 'json'),
    inputs: Array.isArray(core.inputs)
      ? (core.inputs as Array<Record<string, unknown>>).map((item) => ({
          ref: String(item.ref || ''),
          note: String(item.note || ''),
          name: String(item.name || ''),
          type: String(item.type || ''),
          desc: String(item.desc || '')
        }))
      : [],
    rules: Array.isArray(core.rules) ? core.rules.map((r) => String(r)) : [],
    constraints: Array.isArray(core.constraints) ? core.constraints.map((c) => String(c)) : [],
    examples: Array.isArray(core.examples) ? (core.examples as unknown[]).map((e) => String(e)) : [],
    fields: fields.map((f) => {
      const item = f as Record<string, unknown>
      const rawType = String(item.type || 'string')
      return {
        name: String(item.name || ''),
        baseType: rawType.replace(/\?$/, ''),
        optional: rawType.endsWith('?'),
        desc: String(item.desc || ''),
        turn: item.turn === true
      }
    }),
    params: {
      temperature: Number(params.temperature ?? 0.5),
      maxTokens: Number(params.maxTokens ?? 8000),
      failurePolicy: String(params.failurePolicy || 'retry')
    }
  }
}

/** 表单状态 → PUT mode=form 的 core 载荷（type 合成 baseType + ? 后缀） */
function buildCorePayload() {
  const f = coreForm.value
  if (!f) return null
  return {
    identity: f.identity,
    channels: f.channels,
    stateAdvance: f.stateAdvance,
    deltaOutput: f.deltaOutput,
    outputMedia: f.outputMedia,
    inputs: f.inputs.filter((item) => item.ref.trim()).map((item) => ({
      ref: item.ref.trim(),
      ...(item.name?.trim() ? { name: item.name.trim() } : {}),
      ...(item.type?.trim() ? { type: item.type.trim() } : {}),
      ...(item.desc?.trim() ? { desc: item.desc.trim() } : {}),
      ...(item.note.trim() ? { note: item.note.trim() } : {})
    })),
    rules: f.rules,
    constraints: f.constraints,
    ...(f.examples.length ? { examples: f.examples } : {}),
    fields: f.fields.map((item) => ({
      name: item.name,
      type: `${item.baseType}${item.optional ? '?' : ''}`,
      desc: item.desc,
      turn: item.turn
    })),
    params: {
      temperature: f.params.temperature,
      maxTokens: f.params.maxTokens,
      failurePolicy: f.params.failurePolicy
    }
  }
}

function toggleChannel(c: string) {
  const f = coreForm.value
  if (!f) return
  const idx = f.channels.indexOf(c)
  if (idx >= 0) f.channels.splice(idx, 1)
  else f.channels.push(c)
  coreDirty.value = true
}

function moveItem(list: string[], i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item)
  coreDirty.value = true
}
function addItem(list: string[]) {
  list.push('')
  coreDirty.value = true
}
function removeItem(list: string[], i: number) {
  list.splice(i, 1)
  coreDirty.value = true
}
function addField() {
  coreForm.value?.fields.push({ name: '', baseType: 'string', optional: false, desc: '', turn: false })
  coreDirty.value = true
}
function removeField(i: number) {
  coreForm.value?.fields.splice(i, 1)
  coreDirty.value = true
}
function addInput() {
  coreForm.value?.inputs.push({ ref: '', note: '', name: '', type: '', desc: '' })
  coreDirty.value = true
}
function removeInput(i: number) {
  coreForm.value?.inputs.splice(i, 1)
  coreDirty.value = true
}

const coreShortHash = (hash?: string | null) => (hash ? `${hash.slice(0, 10)}…` : '—')
const coreGateCls = (ok: boolean) => (ok ? 'sdp-pw__gate--ok' : 'sdp-pw__gate--bad')
function coreLevelLabel(level: string) {
  if (level === 'safe') return '安全（可发布）'
  if (level === 'restricted') return '受限（需开发确认）'
  return '阻断（需开发同步）'
}

async function ensureCoreLoaded() {
  if (coreRequested) return
  coreRequested = true
  const id = skillId.value
  coreDiagnostics.value = []
  try {
    const res = await adminPromptWorkbenchApi.getCore(id)
    if (id !== skillId.value) return
    coreText.value = res.data?.raw || ''
    coreDiagnostics.value = res.data?.diagnostics || []
    initCoreForm((res.data?.core || null) as Record<string, unknown> | null)
    coreLoaded.value = true
    coreMissing.value = false
  } catch (e) {
    if (id !== skillId.value) return
    coreText.value = ''
    coreLoaded.value = false
    coreMissing.value = true
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status !== 404) {
      // 非 404 允许重试；404 视为该 skill 无核心文件，保持锁定
      coreRequested = false
      toast.error(`核心文件读取失败：${errText(e)}`)
    }
  }
}

async function saveCore() {
  if (!coreLoaded.value || coreSaving.value) return
  coreSaving.value = true
  coreClassification.value = null
  coreDiagnostics.value = []
  coreInputWarnings.value = []
  try {
    if (coreViewMode.value === 'form') {
      const payload = buildCorePayload()
      if (!payload) throw new Error('表单未加载')
      const res = await adminPromptWorkbenchApi.saveCoreForm(skillId.value, payload)
      coreClassification.value = res.data?.classification || null
      coreInputWarnings.value = res.data?.inputWarnings || []
      // 回读：raw 源码与表单状态同步到磁盘真值
      coreRequested = false
      await ensureCoreLoaded()
    } else {
      const res = await adminPromptWorkbenchApi.saveCore(skillId.value, coreText.value)
      coreClassification.value = res.data?.classification || null
      coreInputWarnings.value = res.data?.inputWarnings || []
    }
    coreDirty.value = false
    toast.success(`已保存（${coreLevelLabel(coreClassification.value?.level || 'safe')}），状态：待编译发布`)
    return true
  } catch (e) {
    const data = (e as { response?: { data?: { diagnostics?: CoreDiagnostic[]; error?: string } } })?.response?.data
    coreDiagnostics.value = data?.diagnostics || []
    toast.error(data?.error || `保存失败：${errText(e)}`)
    return false
  } finally {
    coreSaving.value = false
  }
}

async function previewCore() {
  if (!coreLoaded.value || coreCompiling.value) return
  coreCompiling.value = true
  coreSideTab.value = 'preview'
  coreGates.value = null
  coreCompiledPrompt.value = ''
  coreDiagnostics.value = []
  try {
    // 预览是 dry run：不触发语义 judge（避免误置「含义冻结」不确定态）
    const res = await adminPromptWorkbenchApi.compileCore({ skillId: skillId.value, semanticJudge: false })
    coreGates.value = res.data?.gates || null
    coreCompiledPrompt.value = res.data?.prompt || ''
    coreCompiledMeta.value = { coreHash: res.data?.coreHash, coreVersion: res.data?.coreVersion }
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string; diagnostics?: CoreDiagnostic[] } } })?.response?.data
    // 编译错误落入行内诊断区（可停留查看），toast 仅作补充
    const message = data?.error || errText(e)
    coreDiagnostics.value = data?.diagnostics?.length ? data.diagnostics : [{ code: 'COMPILE_FAILED', message }]
    toast.error(`编译失败：${message}`)
  } finally {
    coreCompiling.value = false
  }
}

async function publishCore(confirmUncertain: boolean) {
  if (!coreLoaded.value || corePublishing.value) return
  let developerApproval: { reference: string } | undefined
  if (coreClassification.value && coreClassification.value.level !== 'safe') {
    const reference = await askConfirm({
      title: coreClassification.value.level === 'blocked' ? '发布被阻止：需开发确认' : '发布需开发确认',
      message:
        coreClassification.value.level === 'blocked'
          ? '字段删除或类型变更须先完成消费者同步。\n请输入对应开发提交、PR 或变更单引用：'
          : '新增字段须经开发确认消费者接入。\n请输入对应开发提交、PR 或变更单引用：',
      confirmText: '提交并发布',
      danger: coreClassification.value.level === 'blocked',
      input: { label: '开发提交 / PR / 变更单引用', placeholder: '例如 pr#123 或 提交哈希' }
    })
    if (!reference || typeof reference !== 'string') {
      toast.error('未提供开发确认引用，已取消发布')
      return
    }
    developerApproval = { reference }
  }
  corePublishing.value = true
  corePublishResult.value = null
  coreUncertain.value = null
  corePublishIssues.value = []
  try {
    const res = await adminPromptWorkbenchApi.publishCore({
      skillId: skillId.value,
      confirmUncertain: confirmUncertain || undefined,
      developerApproval
    })
    corePublishResult.value = {
      ok: true,
      agentId: res.data?.agentId,
      version: res.data?.version,
      coreHash: res.data?.coreHash
    }
    toast.success(`发布成功：v${res.data?.version}（运行时已生效）`)
    // 发布改 ACTIVE：同步刷新检视与版本页数据
    await Promise.all([loadInspect(), loadVersions(), loadOverviewLite()])
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    const data = (e as { response?: { data?: any } })?.response?.data || {}
    if (status === 409 && data?.code === 'SEMANTIC_UNCERTAIN') {
      // 仅语义 judge 不确定（409）提供「强制发布」兜底
      coreUncertain.value = data?.judgement || {}
      toast.warning('含义冻结不确定，需人工确认')
    } else {
      if (data?.classification) coreClassification.value = data.classification
      corePublishResult.value = { ok: false, message: data?.error || `发布失败：${errText(e)}` }
      // 422 issues 只展示问题列表，不提供强制发布入口
      if (data?.issues?.length) {
        corePublishIssues.value = data.issues
      }
      toast.error(data?.error || '发布被阻断')
    }
  } finally {
    corePublishing.value = false
  }
}

/** 发布/回滚后只刷新 overview 芯片（不重跑全量 loadAll） */
async function loadOverviewLite() {
  const r = await adminPromptOpsApi.getAgentOverview().catch(() => null)
  const items = (r?.data?.data?.items || []) as OverviewItem[]
  const found = items.find((x) => x.agentId === `skill:${skillId.value}` || x.agentId === skillId.value) || null
  if (found) overview.value = found
}

async function openCoreVersions() {
  coreSideTab.value = 'versions'
  coreVersionsLoading.value = true
  try {
    const res = await adminPromptWorkbenchApi.getCoreVersions(skillId.value)
    coreVersions.value = res.data?.versions || []
  } catch (e) {
    toast.error(`版本加载失败：${errText(e)}`)
  } finally {
    coreVersionsLoading.value = false
  }
}

async function rollbackCore(version: number) {
  if (coreRollbacking.value) return
  const ok = await askConfirm({
    title: '回滚版本',
    message: `确认回滚 ${skillId.value} 到 v${version}？\n现行文件与 ACTIVE 将被替换。`,
    confirmText: '回滚'
  })
  if (!ok) return
  coreRollbacking.value = true
  try {
    await adminPromptWorkbenchApi.rollbackCore(skillId.value, version)
    toast.success(`已回滚到 v${version}`)
    // 回滚替换了磁盘文件：重新拉取 core，避免编辑器与磁盘不一致
    coreRequested = false
    coreDirty.value = false
    await ensureCoreLoaded()
    await openCoreVersions()
    await Promise.all([loadInspect(), loadVersions(), loadOverviewLite()])
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string } } })?.response?.data
    toast.error(data?.error || `回滚失败：${errText(e)}`)
  } finally {
    coreRollbacking.value = false
  }
}

async function openCoreLineage() {
  coreSideTab.value = 'lineage'
  try {
    const res = await adminPromptWorkbenchApi.getCoreLineage(skillId.value)
    coreLineage.value = res.data?.lineage || []
  } catch (e) {
    toast.error(`血缘加载失败：${errText(e)}`)
  }
}

/* ---------- 工程：协议与规则 ---------- */
interface Protocol { id: string; title: string; statusLabel: string; summary: string; callSites: string }
interface RuleItem { ruleId: string; text: string; agentId: string }
const protocols = ref<Protocol[]>([])
const rulesOverview = ref<{ summary: { totalRules: number; totalPrefixes: number; conflictPrefixCount: number }; conflictPrefixes: Array<{ prefix: string; agentIds: string[] }>; byPrefix: Record<string, RuleItem[]> } | null>(null)
let engLoaded = false
const engProtoFailed = ref(false)
const engRulesFailed = ref(false)

const nodeRules = computed(() => {
  if (!rulesOverview.value) return [] as RuleItem[]
  const full = `skill:${skillId.value}`
  const out: RuleItem[] = []
  for (const list of Object.values(rulesOverview.value.byPrefix || {})) {
    for (const r of list || []) {
      if (r.agentId === full || r.agentId === skillId.value) out.push(r)
    }
  }
  return out
})

async function loadEngineering() {
  if (engLoaded) return
  engLoaded = true
  let pvOk = true
  let roOk = true
  const [pv, ro] = await Promise.all([
    adminPromptOpsApi.getProtocolView().catch(() => { pvOk = false; return null }),
    adminPromptOpsApi.getSkillRulesOverview().catch(() => { roOk = false; return null })
  ])
  engProtoFailed.value = !pvOk
  engRulesFailed.value = !roOk
  const pBody = pv?.data?.data ?? pv?.data ?? {}
  protocols.value = ((pBody.protocols as Record<string, unknown>[]) || []).map((p) => ({
    id: String(p.id || ''),
    title: String(p.title || p.id || ''),
    statusLabel: String(p.statusLabel || p.status || ''),
    summary: String(p.summary || ''),
    callSites: String(p.callSites || '')
  }))
  rulesOverview.value = (ro?.data?.data ?? ro?.data ?? null) as typeof rulesOverview.value
}

function retryEngineering() {
  engLoaded = false
  void loadEngineering()
}

watch(tab, (t) => {
  if (t === 'engineering') void loadEngineering()
  if (t === 'protocol') void ensureCoreLoaded()
})

/* ---------- 工具 ---------- */
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

/** 展开详情展示截断（detail 保留完整原文供重跑） */
function displayCap(v?: string) {
  return v && v.length > 3000 ? `${v.slice(0, 3000)}\n…（截断）` : v || ''
}

/** 状态条文件路径短显：保留最后两段 */
function shortFilePath(p?: string) {
  if (!p) return ''
  const parts = p.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}
const fmtTime = (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—')
const errText = (e: unknown) => {
  const r = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string }
  const d = r?.response?.data?.error
  return typeof d === 'string' ? d : d?.message || r?.message || '未知错误'
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!t || Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d} 天前` : new Date(t).toLocaleDateString('zh-CN')
}

async function copy(content: string) {
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    toast.success('已复制')
  } catch {
    toast.error('复制失败：剪贴板不可用')
  }
}

/* ---------- 总加载 ---------- */
const loadFailed = ref(false)
async function loadAll() {
  const id = skillId.value
  if (!id) return
  // 刷新会丢弃未保存的 core 修改，先确认
  if (coreDirty.value) {
    const ok = await askConfirm({
      title: '刷新设计页',
      message: '当前 Skill 有未保存的修改，刷新后将丢失，确定刷新？',
      confirmText: '刷新并放弃修改'
    })
    if (!ok) return
  }
  loading.value = true
  loadFailed.value = false
  notFound.value = false
  try {
    const r = await adminPromptOpsApi.getAgentOverview()
    if (id !== skillId.value) return
    const items = (r.data?.data?.items || []) as OverviewItem[]
    const found = items.find((x) => x.agentId === `skill:${id}` || x.agentId === id) || null
    if (!found) {
      overview.value = null
      notFound.value = true
      return
    }
    overview.value = found
    const meta = await adminSkillWorkbenchApi.getMeta(found.agentId).catch(() => null)
    if (id !== skillId.value) return
    workbenchMeta.value = meta?.data?.data ?? meta?.data ?? null
    await Promise.all([loadInspect(), loadVersions(), loadRuntime(), loadRecentLogs()])
  } catch (e) {
    if (id !== skillId.value) return
    loadFailed.value = true
    toast.error(`加载失败：${errText(e)}`)
  } finally {
    if (id === skillId.value) loading.value = false
  }
}

/* 脏态离开保护：切 Skill / 关闭页面 / 刷新前确认，避免静默丢编辑内容 */
let lastAgentId = ''
watch(agentIdParam, async (id) => {
  // router.replace 回弹（取消切换）会以原 id 再触发一次：直接跳过，避免误重置
  if (id === lastAgentId) return
  if (coreDirty.value && id && id !== lastAgentId) {
    const ok = await askConfirm({
      title: '切换 Skill',
      message: '当前 Skill 有未保存的修改，切换后将丢失，确定离开？',
      confirmText: '离开并放弃修改'
    })
    if (!ok) {
      // 取消：回滚 URL，不执行任何重置（回弹再进 watcher 时因 id === lastAgentId 直接跳过）
      void router.replace({ path: `/admin/skills/${lastAgentId}`, query: route.query })
      return
    }
  }
  // 确认离开或非脏切换：core 状态全部重置，协议页签下次激活时重新拉取
  coreRequested = false
  coreLoaded.value = false
  coreMissing.value = false
  coreText.value = ''
  coreDirty.value = false
  coreDiagnostics.value = []
  coreInputWarnings.value = []
  coreClassification.value = null
  coreGates.value = null
  coreCompiledPrompt.value = ''
  coreCompiledMeta.value = null
  corePublishResult.value = null
  coreUncertain.value = null
  corePublishIssues.value = []
  coreVersions.value = []
  coreLineage.value = []
  // 试跑 / 运行时状态一并清空，避免跨 skill 残留
  trialResult.value = null
  trialError.value = ''
  trialInput.value = ''
  resetRtForm()
  lastAgentId = id
  if (agentIdParam.value) void loadAll()
  if (tab.value === 'protocol') void ensureCoreLoaded()
})

/* SPA 内导航离开（返回控制台 / 跳其他路由）有未保存修改必须确认；刷新/关闭由 beforeunload 兜底 */
onBeforeRouteLeave(async () => {
  if (!coreDirty.value) return true
  const ok = await askConfirm({
    title: '离开设计页',
    message: '当前 Skill 有未保存的修改，离开后将丢失，确定离开？',
    confirmText: '离开并放弃修改'
  })
  return ok === true
})

function onPageBeforeUnload(e: BeforeUnloadEvent) {
  if (coreDirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => {
  void loadAll()
  if (tab.value === 'engineering') void loadEngineering()
  if (tab.value === 'protocol') void ensureCoreLoaded()
  window.addEventListener('beforeunload', onPageBeforeUnload)
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', onPageBeforeUnload))
</script>

<style scoped>
.sdp {
  --mk-ink: #1a2a44;
  --mk-muted: #5b6577;
  --mk-faint: #8492ab;
  --mk-line: #e1e8f2;
  --mk-bg: #f6f8fc;
  --mk-surface: #ffffff;
  --mk-blue: #3478f6;
  --mk-green: #15803d;
  --mk-green-bg: #ecfdf5;
  --mk-amber: #b45309;
  --mk-amber-bg: #fffbeb;
  --mk-red: #dc2626;
  --mk-red-bg: #fef2f2;
  --mk-mono: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  /* #app 是 flex 列容器：margin auto 会让本页收缩到内容宽，必须显式 width:100% */
  width: 100%;
  /* 全页签统一宽度：避免协议/工作台等页签切换时页面宽度跳动 */
  max-width: 1440px;
  margin: 0 auto;
  min-height: 100vh;
  font-family: Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

.sdp-ok { color: var(--mk-green); }
.sdp-warn { color: var(--mk-amber); }
.sdp-none { margin: 0; font-size: 12px; color: var(--mk-faint); }

/* ---------- 顶部 ---------- */
.sdp-head {
  display: grid;
  gap: 8px;
  align-items: start;
  padding: 4px 0 2px;
}
.sdp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
  width: fit-content;
}
.sdp-back:hover { text-decoration: underline; }
.sdp-parent { font-size: 12px; font-weight: 600; white-space: nowrap; }
.sdp-ellipsis {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdp-bad-text { color: var(--mk-red); font-weight: 700; }
.sdp-action-fix { margin-left: 0; }
.sdp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 10.5px;
  font-weight: 600;
}
.sdp-chip b { color: var(--mk-ink); font-weight: 600; }
.sdp-chip--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.sdp-chip--amber { background: var(--mk-amber-bg); color: var(--mk-amber); }
.sdp-chip--amber b { color: var(--mk-amber); }
.sdp-chip--bad { background: var(--mk-red-bg); color: var(--mk-red); }

/* 危险色修饰（mk-btn 共享按钮之上）：重置默认配置等破坏性操作 */
.sdp-btn--danger { color: var(--mk-red); border-color: rgba(220, 38, 38, 0.35); background: transparent; }
.sdp-btn--danger:hover { background: var(--mk-red-bg); }

/* ---------- 漂移警告 ---------- */
.sdp-drift {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 14px;
  border-radius: 10px;
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: 12px;
}
.sdp-drift code { font-size: 11px; }

/* ---------- Tabs ---------- */
.sdp-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: #eef2fa;
  border-radius: 10px;
  width: fit-content;
}
.sdp-tab {
  border: 0;
  background: transparent;
  padding: 6px 16px;
  border-radius: 10px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.sdp-tab--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(23, 32, 51, 0.1); }

/* ---------- 通用 pane 元素 ---------- */
.sdp-pane { display: grid; gap: 14px; align-content: start; }
.sdp-notice {
  padding: 9px 14px;
  border-radius: 10px;
  background: #eff6ff;
  border: 1px solid #dbe7f6;
  color: #41516e;
  font-size: 12px;
  line-height: 1.6;
}
.sdp-notice strong { margin-right: 6px; }
.sdp-notice code { font-size: 11px; }
.sdp-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sdp-sec-head h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.sdp-sec-meta { font-size: 11px; color: var(--mk-faint); display: inline-flex; gap: 10px; align-items: center; }

/* ---------- 工作台：左右双栏 ---------- */
.sdp-workbench {
  display: grid;
  grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 1020px) {
  .sdp-workbench { grid-template-columns: 1fr; }
}
.sdp-block, .sdp-prompt {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: #fff;
  padding: 12px 14px;
  display: grid;
  gap: 10px;
  align-content: start;
}
.sdp-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sdp-block__head h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.sdp-block__meta { display: inline-flex; align-items: center; gap: 10px; font-size: 11px; color: var(--mk-faint); }
.sdp-side { display: grid; gap: 14px; min-width: 0; }

/* Prompt 面板 */
.sdp-viewswitch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: #eef2fa;
  border-radius: 10px;
}
.sdp-viewswitch__btn {
  border: 0;
  background: transparent;
  padding: 4px 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.sdp-viewswitch__btn--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(23, 32, 51, 0.1); }
.sdp-prompt__facts {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--mk-faint);
}
.sdp-prompt__facts b { color: var(--mk-ink); }
.sdp-prompt__facts code { font-size: 10.5px; }
.sdp-prompt__used { color: var(--mk-muted); }
.sdp-prompt__code {
  margin: 0;
  height: min(58vh, 620px);
  overflow: auto;
  padding: 12px;
  border-radius: 10px;
  background: #fbfcfe;
  border: 1px solid #eef2f8;
  white-space: pre-wrap;
  word-break: break-word;
  font: 11.5px/1.65 'JetBrains Mono', Consolas, monospace;
  color: #263950;
}
.sdp-prompt__hint { margin: 0; font-size: 11px; color: var(--mk-faint); line-height: 1.6; }
.sdp-prompt__hint code { font-size: 10.5px; }

/* 试跑 */
.sdp-json {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dbe3ef;
  border-radius: 9px;
  font-size: 11px;
  line-height: 1.6;
  resize: vertical;
  background: #fbfcfe;
}
.sdp-json:focus { outline: none; border-color: var(--mk-blue); }

/* 试跑 JSON 覆盖层：高度受控（rows=7 等效），浅色容器与深色高亮层分离 */
.sdp-codehl--json,
.sdp-codehl--json .sdp-codehl__pre,
.sdp-codehl--json .sdp-codehl__ta { min-height: 0; }
.sdp-codehl--json { height: 180px; margin-bottom: 12px; }
.sdp-codehl--json .sdp-codehl__pre,
.sdp-codehl--json .sdp-codehl__ta { height: 100%; padding: 10px 12px; font-size: 11px; }
.sdp-codehl--json .sdp-codehl__ta {
  background: transparent;
  border: 0;
  border-radius: 0;
  resize: none;
}
.sdp-trial__meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sdp-output {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--mk-code-bg, #101826);
  border: 1px solid var(--mk-code-border, #1c2a40);
  color: var(--mk-code-fg, #9db8dc);
  font-size: 11px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}
.sdp-error {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mk-red-bg);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: var(--mk-red);
  font-size: 12px;
}

/* 最近调用 */
.sdp-logs { display: grid; gap: 4px; }
.sdp-log {
  display: grid;
  grid-template-columns: 1fr auto;
  border: 1px solid #e6ecf6;
  border-radius: 9px;
  background: #fff;
  overflow: hidden;
}
.sdp-log.is-open { border-color: rgba(52, 120, 246, 0.35); }
.sdp-log__main {
  display: grid;
  grid-template-columns: 8px 64px 46px 1fr;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.sdp-log__main:hover { background: #f8fbff; }
.sdp-log__dot { width: 7px; height: 7px; border-radius: 50%; }
.sdp-log__dot.is-ok { background: #15803d; }
.sdp-log__dot.is-err, .sdp-log__dot.is-timeout { background: #dc2626; }
.sdp-log__time { color: var(--mk-faint); font-size: 10px; }
.sdp-log__dur { color: var(--mk-muted); font-size: 10.5px; text-align: right; font-variant-numeric: tabular-nums; }
.sdp-log__summary {
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdp-log__rerun {
  border: 0;
  border-left: 1px solid #eef2f8;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 0 10px;
  cursor: pointer;
}
.sdp-log__rerun:hover { background: #eff6ff; }
.sdp-log__rerun:disabled { color: var(--mk-faint); cursor: not-allowed; }
.sdp-log__detail {
  grid-column: 1 / -1;
  border-top: 1px solid #eef2f8;
  padding: 8px 10px;
  display: grid;
  gap: 8px;
  background: #fbfcfe;
}
.sdp-log__io { display: grid; gap: 3px; }
.sdp-log__io span { font-size: 10px; font-weight: 700; color: var(--mk-faint); letter-spacing: 0.04em; }
.sdp-log__io pre {
  margin: 0;
  padding: 8px 10px;
  border-radius: 7px;
  background: #fff;
  border: 1px solid #eef2f8;
  font-size: 10.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  color: #41516e;
}
.sdp-log__io--err pre { background: #fef5f5; border-color: rgba(220, 38, 38, 0.25); color: #b91c1c; }

/* ---------- 版本 ---------- */
.sdp-versions { display: grid; gap: 8px; }
.sdp-versions-msg { margin: 0; font-size: 11.5px; color: var(--mk-green); font-weight: 600; display: flex; gap: 8px; align-items: center; }
.sdp-versions-msg.is-err { color: var(--mk-red); }
.mk-table-wrap {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow-x: auto;
  background: #fff;
}
.sdp-vtag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 5px;
  background: #eef2fa;
  color: #41516e;
  font-size: 10.5px;
}
.sdp-vname { color: var(--mk-muted); }
.sdp-diff {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.sdp-diff__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafd;
  border-bottom: 1px solid #eef2f8;
  font-size: 11px;
  color: var(--mk-muted);
}
.sdp-diff__count { font-weight: 700; color: var(--mk-amber); }
.sdp-diff__count.is-clean { color: var(--mk-green); }
.sdp-diff__head .mk-link { margin-left: auto; }
.sdp-diff__body {
  max-height: 380px;
  overflow-y: auto;
  padding: 6px 0;
  font-size: 10.5px;
  line-height: 1.6;
}
.sdp-diff__line {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 8px;
  padding: 1px 12px;
}
.sdp-diff__line.is-added { background: #ecfdf5; }
.sdp-diff__line.is-added .sdp-diff__text { color: #15803d; }
.sdp-diff__line.is-added .sdp-diff__no::after { content: '+'; color: #15803d; margin-left: 3px; }
.sdp-diff__line.is-removed { background: #fef2f2; }
.sdp-diff__line.is-removed .sdp-diff__text { color: #b91c1c; }
.sdp-diff__line.is-removed .sdp-diff__no::after { content: '−'; color: #b91c1c; margin-left: 3px; }
.sdp-diff__no { color: var(--mk-faint); text-align: right; user-select: none; }
.sdp-diff__text { white-space: pre-wrap; word-break: break-word; color: #41516e; }
.sdp-diff__gap { padding: 2px 12px; color: #c3cede; user-select: none; }
.sdp-diff__same { margin: 8px 12px; font-size: 11px; color: var(--mk-faint); }

/* ---------- 运行时 ---------- */
.sdp-chiprows { display: grid; gap: 8px; }
.sdp-chiprow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #fff;
}
.sdp-chiprow__label { font-size: 12px; font-weight: 600; color: var(--mk-muted); margin-right: 4px; }
.sdp-form { padding: 14px 16px; display: grid; gap: 12px; }
.sdp-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 860px) {
  .sdp-form__grid { grid-template-columns: 1fr; }
}
.sdp-field { display: grid; gap: 5px; }
.sdp-field > span { font-size: 11.5px; color: var(--mk-muted); font-weight: 600; }
.sdp-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
.sdp-field--check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdp-field--check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.sdp-input {
  width: 100%;
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid #dbe3ef;
  background: #fff;
  color: var(--mk-ink);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.sdp-input:focus { border-color: var(--mk-blue); }
.sdp-input:disabled { background: #f4f6fa; color: var(--mk-faint); }
.sdp-divider {
  display: grid;
  gap: 3px;
  padding-top: 12px;
  border-top: 1px solid var(--mk-line);
}
.sdp-divider strong { font-size: 12.5px; }
.sdp-divider span { color: var(--mk-faint); font-size: 11.5px; }
.sdp-form__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.sdp-form__msg { margin: 0 auto 0 0; font-size: 11.5px; color: var(--mk-green); font-weight: 600; }
.sdp-form__msg.is-err { color: var(--mk-red); }

/* ---------- 工程 ---------- */
.sdp-eng { display: grid; gap: 8px; }
.sdp-eng__desc { margin: 0; color: var(--mk-muted); font-size: 12px; line-height: 1.7; }
.sdp-kv {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
}
.sdp-kv th {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  color: var(--mk-muted);
  padding: 7px 12px;
  width: 180px;
  background: #f8fafc;
  border-right: 1px solid #f0f2f5;
  vertical-align: top;
}
.sdp-kv td {
  padding: 7px 12px;
  color: #334155;
  border-bottom: 1px solid #f0f2f5;
  word-break: break-all;
}
.sdp-kv tr:last-child th, .sdp-kv tr:last-child td { border-bottom: none; }
.sdp-kv code { font-size: 11px; }
.sdp-protocols { display: grid; gap: 8px; }
.sdp-protocol {
  border: 1px solid #e6ecf6;
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
  background: #fff;
}
.sdp-protocol header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sdp-protocol strong { font-size: 12.5px; font-weight: 600; color: #223252; }
.sdp-protocol p { margin: 0; font-size: 11.5px; color: var(--mk-muted); line-height: 1.6; }
.sdp-protocol__sites { font-size: 10px; color: var(--mk-faint); word-break: break-all; }
.sdp-conflict {
  display: grid;
  gap: 4px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: 11.5px;
}
.sdp-rules { display: grid; gap: 6px; }
.sdp-rule {
  display: grid;
  gap: 3px;
  padding: 7px 10px 7px 12px;
  border-left: 2px solid rgba(141, 107, 255, 0.45);
  background: #faf9ff;
  border-radius: 0 8px 8px 0;
  font-size: 12px;
}
.sdp-rule__id { color: #8d6bff; font-size: 10.5px; font-weight: 700; }
.sdp-rule__text { color: #263950; line-height: 1.55; }

/* toast 固定右下角 */
.sdp-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: var(--mk-z-modal);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
}

/* ---------- 协议（core 编辑与发布） ---------- */
.sdp-pw {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 18px;
  align-items: start;
}
@media (max-width: 1100px) {
  .sdp-pw { grid-template-columns: 1fr; }
}
.sdp-pw__hint {
  margin: 0 18px 12px;
  font-size: 12px;
  color: var(--mk-faint);
  line-height: 1.7;
}
.sdp-pw__hint code { font-size: 10.5px; }
.sdp-pw__textarea {
  width: 100%;
  min-height: 46vh;
  resize: vertical;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  background: #fff;
  color: var(--mk-ink);
  outline: none;
  margin: 0 0 12px;
  box-sizing: border-box;
}
.sdp-pw__textarea:focus { border-color: var(--mk-blue); }

/* 源码视图：高亮覆盖层（深色编辑器） */
.sdp-codehl {
  position: relative;
  margin: 0 0 12px;
  min-height: min(46vh, 620px);
  max-height: min(74vh, 620px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mk-code-border, #1c2a40);
  border-radius: 10px;
  background: var(--mk-code-bg, #0d1420);
  overflow: hidden;
}
.sdp-codehl__pre {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 12px;
  overflow: auto;
  scrollbar-width: none;
  background: var(--mk-code-bg, #0d1420);
  color: var(--mk-code-fg, #c9d4e3);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
  pointer-events: none;
}
.sdp-codehl__pre::-webkit-scrollbar { display: none; }
.sdp-codehl__ta {
  position: relative;
  z-index: 1;
  margin: 0;
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: #e8eef5;
  white-space: pre;
  overflow: auto;
  border-color: transparent;
}
.sdp-codehl__ta::placeholder { color: rgba(201, 212, 227, 0.4); }
.sdp-codehl__ta:focus { border-color: transparent; }
.sdp-pw__textarea:disabled { background: #f6f8fc; color: var(--mk-faint); }
.sdp-pw__classify {
  margin: 0 16px 10px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
}
.sdp-pw__classify ul { margin: 6px 0 0; padding-left: 18px; }
.sdp-pw__classify--safe { background: var(--mk-green-bg); }
.sdp-pw__classify--restricted { background: var(--mk-amber-bg); }
.sdp-pw__classify--blocked { background: var(--mk-red-bg); }
.sdp-pw__diag { margin: 0 16px 10px; display: grid; gap: 4px; }
.sdp-pw__diag--warn .sdp-pw__diag-item { color: var(--mk-amber); }
.sdp-pw__diag-item { display: flex; gap: 8px; font-size: 12px; color: var(--mk-red); }
.sdp-pw__diag-item .mono { flex-shrink: 0; }
.sdp-pw__publish {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
}
.sdp-pw__publish--ok { background: var(--mk-green-bg); }
.sdp-pw__publish--bad { background: var(--mk-red-bg); }
.sdp-pw__uncertain {
  margin: 0 16px 12px;
  padding: 12px;
  border-radius: 10px;
  background: var(--mk-amber-bg);
  font-size: 12px;
}
.sdp-pw__uncertain ul { margin: 6px 0 10px; padding-left: 18px; }
.sdp-pw__pills { display: inline-flex; gap: 4px; background: #eef2fa; border-radius: 10px; padding: 3px; }
.sdp-pw__pill {
  border: 0;
  background: transparent;
  padding: 5px 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.sdp-pw__pill--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1); }
.sdp-pw__pane { display: grid; gap: 12px; align-content: start; padding: 0 18px 16px; max-height: 74vh; overflow-y: auto; }
.sdp-pw__gates { display: grid; gap: 6px; }
.sdp-pw__gate { font-size: 12px; padding: 6px 10px; border-radius: 8px; }
.sdp-pw__gate--ok { background: var(--mk-green-bg); }
.sdp-pw__gate--bad { background: var(--mk-red-bg); }
.sdp-pw__gate-issue { font-size: 11px; color: var(--mk-faint); padding-left: 10px; }
.sdp-pw__meta { font-size: 11px; color: var(--mk-faint); }
.sdp-pw__pre {
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--mk-mono);
}
.sdp-pw__table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sdp-pw__table th, .sdp-pw__table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #f0f2f5;
}
.sdp-pw__table-active { background: var(--mk-green-bg); }
.sdp-pw__consumer { font-size: 11px; color: var(--mk-muted); padding: 1px 0; }
.sdp-pw__audit { font-size: 11px; color: var(--mk-faint); }

/* ---------- 协议·表单视图 ---------- */
.sdp-pw__viewswitch {
  display: inline-flex;
  gap: 4px;
  background: #eef2fa;
  border-radius: 9px;
  padding: 3px;
  margin: 0 18px 12px;
  width: fit-content;
}
.sdp-pw__viewbtn {
  border: 0;
  background: transparent;
  padding: 5px 14px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.sdp-pw__viewbtn--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1); }
.sdp-pwform {
  display: grid;
  gap: 16px;
  padding: 0 18px 18px;
}
.sdp-pwform__card {
  border: 1px solid var(--mk-line);
  border-radius: 14px;
  padding: 14px 18px;
  display: grid;
  gap: 12px;
  background: #fff;
}
.sdp-pwform__cardhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 2px 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--mk-ink);
  text-align: left;
  cursor: pointer;
}
.sdp-pwform__cardhead:hover { color: var(--mk-blue); }
.sdp-pwform__cardhead b { color: var(--mk-faint); font-weight: 600; }
.sdp-pwform__caret {
  font-style: normal;
  color: var(--mk-faint);
  transition: transform 0.15s ease;
}
.sdp-pwform__caret.is-open { transform: rotate(180deg); }
.sdp-pwform__cardbody {
  display: grid;
  gap: 12px;
  padding-top: 2px;
}
.sdp-pwform__card h5 {
  margin: 0;
  font-size: 13px;
  color: var(--mk-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdp-pwform__card h5 b { color: var(--mk-faint); font-weight: 600; }
.sdp-pwform__card--danger { border-color: rgba(180, 83, 9, 0.35); }
.sdp-pwform__warn {
  margin: 0;
  font-size: 12px;
  color: var(--mk-amber);
  line-height: 1.6;
}
.sdp-pwform__note {
  margin: 0;
  font-size: 12px;
  color: var(--mk-faint);
  line-height: 1.6;
}
.sdp-pwform__inputrow {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) minmax(160px, 1fr) 28px;
  gap: 10px;
  align-items: center;
}
@media (max-width: 860px) {
  .sdp-pwform__inputrow { grid-template-columns: 1fr 28px; }
}
.sdp-pwform__field { display: grid; gap: 6px; }
.sdp-pwform__field > span { font-size: 12px; color: var(--mk-muted); font-weight: 600; }
.sdp-pwform__checks { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.sdp-pwform__check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--mk-ink);
  cursor: pointer;
}
.sdp-pwform__check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.sdp-pwform__row3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: end;
}
@media (max-width: 860px) {
  .sdp-pwform__row3 { grid-template-columns: 1fr; }
}
.sdp-pwform__listitem {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}
.sdp-pwform__listitem textarea { min-height: 58px; }
.sdp-pwform__idx { color: var(--mk-faint); font-size: 11px; padding-top: 10px; text-align: right; }
.sdp-pwform__itemops { display: flex; gap: 6px; padding-top: 8px; }
.sdp-pwform__fields { display: grid; gap: 8px; }
.sdp-pwform__fieldrow {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 116px 34px minmax(150px, 1.6fr) 34px 52px;
  gap: 10px;
  align-items: center;
  padding: 4px 0;
}
.sdp-pwform__fieldrow--head {
  font-size: 11px;
  color: var(--mk-faint);
  font-weight: 700;
  padding-bottom: 0;
}
.sdp-pwform__fieldrow input[type='checkbox'] { width: 15px; height: 15px; accent-color: var(--mk-blue); justify-self: center; }
.sdp-pwform .sdp-input { min-height: 36px; padding: 8px 12px; font-size: 13px; }
.sdp-pwform textarea.sdp-input { line-height: 1.65; }
@media (max-width: 860px) {
  .sdp-pwform__fieldrow { grid-template-columns: 1fr 96px 52px; }
  .sdp-pwform__fieldrow--head { display: none; }
}




/* 4K：设计页放宽 + 编辑器字号跟随壳层放大 */
@media (min-width: 2000px) {
  .sdp { max-width: 2000px; }
  .sdp-pw__textarea,
  .sdp-codehl__pre,
  .sdp-json,
  .sdp-output,
  .sdp-prompt__code { font-size: 13.5px; }
  .sdp-pwform .sdp-input { font-size: 14px; }
  .sdp-eng__kvs code,
  .sdp-pw__pre { font-size: 13px; }
}
@media (min-width: 2800px) {
  .sdp { max-width: 2600px; }
  .sdp-pw__textarea,
  .sdp-codehl__pre,
  .sdp-json,
  .sdp-output,
  .sdp-prompt__code { font-size: 16px; }
  .sdp-pwform .sdp-input { font-size: 16.5px; }
  .sdp-eng__kvs code,
  .sdp-pw__pre { font-size: 15.5px; }
}
@media (min-width: 3600px) {
  /* 4K：设计页独立渲染（无全局 zoom），字号大幅放大以对齐管理台基线 */
  .sdp { max-width: 3000px; }
  .sdp-back { font-size: 19px; }
  .sdp-parent { font-size: 18px; }
  .sdp-chip { font-size: 16.5px; padding: 4px 12px; }
  .sdp-drift { font-size: 18px; padding: 14px 18px; }
  .sdp-drift code { font-size: 17px; }
  .sdp-tabs { padding: 6px; }
  .sdp-tab { font-size: 19px; padding: 10px 24px; }
  .sdp-notice { font-size: 18px; padding: 14px 18px; }
  .sdp-notice code { font-size: 17px; }
  .sdp-sec-head h4 { font-size: 17.5px; }
  .sdp-sec-meta { font-size: 17.5px; }
  .sdp-block, .sdp-prompt { padding: 16px 18px; gap: 12px; }
  .sdp-block__head h4 { font-size: 17.5px; }
  .sdp-block__meta { font-size: 17.5px; }
  .sdp-viewswitch { border-radius: 10px; }
  .sdp-viewswitch__btn { font-size: 18px; padding: 7px 18px; }
  .sdp-prompt__facts { font-size: 17.5px; gap: 18px; }
  .sdp-prompt__facts code { font-size: 16.5px; }
  .sdp-prompt__code { font-size: 19px; padding: 18px; }
  .sdp-prompt__hint { font-size: 17.5px; }
  .sdp-prompt__hint code { font-size: 16.5px; }
  .sdp-json { font-size: 19px; padding: 14px 16px; }
  .sdp-codehl--json { height: 240px; }
  .sdp-codehl--json .sdp-codehl__pre,
  .sdp-codehl--json .sdp-codehl__ta { padding: 14px 16px; font-size: 19px; }
  .sdp-output { font-size: 19px; padding: 16px; max-height: 420px; }
  .sdp-error { font-size: 18px; padding: 14px 16px; }
  .sdp-log__main { font-size: 18px; padding: 12px 14px; }
  .sdp-log__time { font-size: 16px; }
  .sdp-log__dur { font-size: 16.5px; }
  .sdp-log__rerun { font-size: 17.5px; padding: 0 14px; }
  .sdp-log__io span { font-size: 16px; }
  .sdp-log__io pre { font-size: 16.5px; padding: 12px 14px; }
  .sdp-versions-msg { font-size: 18px; }
  .sdp-vtag { font-size: 16.5px; padding: 2px 9px; }
  .sdp-diff__head { font-size: 17.5px; padding: 12px 16px; }
  .sdp-diff__body { font-size: 16.5px; max-height: 460px; }
  .sdp-diff__same { font-size: 17.5px; }
  .sdp-chiprow { padding: 14px 16px; }
  .sdp-chiprow__label { font-size: 18px; }
  .sdp-form { padding: 18px 20px; gap: 14px; }
  .sdp-field > span { font-size: 18px; }
  .sdp-input { font-size: 19px; padding: 12px 15px; }
  .sdp-divider strong { font-size: 19px; }
  .sdp-divider span { font-size: 18px; }
  .sdp-form__msg { font-size: 18px; }
  .sdp-eng__desc { font-size: 18px; }
  .sdp-kv { font-size: 18px; }
  .sdp-kv th { font-size: 17px; padding: 10px 16px; }
  .sdp-kv td { padding: 10px 16px; }
  .sdp-kv code { font-size: 17px; }
  .sdp-protocol { padding: 14px 16px; }
  .sdp-protocol strong { font-size: 19px; }
  .sdp-protocol p { font-size: 18px; }
  .sdp-protocol__sites { font-size: 16.5px; }
  .sdp-conflict { font-size: 18px; padding: 13px 16px; }
  .sdp-rule { font-size: 18px; padding: 10px 12px 10px 16px; }
  .sdp-rule__id { font-size: 16.5px; }
  .sdp-pw { grid-template-columns: minmax(0, 1fr) 520px; }
  .sdp-pw__hint { font-size: 18px; }
  .sdp-pw__hint code { font-size: 16.5px; }
  .sdp-pw__textarea,
  .sdp-codehl__pre { font-size: 19px; }
  .sdp-pwform .sdp-input { font-size: 19.5px; min-height: 46px; }
  .sdp-eng__kvs code,
  .sdp-pw__pre { font-size: 18px; }
  .sdp-pw__classify { font-size: 18px; }
  .sdp-pw__diag-item { font-size: 18px; }
  .sdp-pw__publish { font-size: 18px; }
  .sdp-pw__uncertain { font-size: 18px; }
  .sdp-pw__pill { font-size: 18px; padding: 8px 18px; }
  .sdp-pw__gate { font-size: 18px; }
  .sdp-pw__gate-issue { font-size: 17.5px; }
  .sdp-pw__meta { font-size: 17.5px; }
  .sdp-pw__table { font-size: 18px; }
  .sdp-pw__consumer { font-size: 17.5px; }
  .sdp-pw__audit { font-size: 17.5px; }
  .sdp-pw__viewbtn { font-size: 18px; padding: 8px 20px; }
  .sdp-pwform__cardhead { font-size: 19px; }
  .sdp-pwform__card h5 { font-size: 19px; }
  .sdp-pwform__warn { font-size: 18px; }
  .sdp-pwform__note { font-size: 18px; }
  .sdp-pwform__field > span { font-size: 18px; }
  .sdp-pwform__check { font-size: 18.5px; }
  .sdp-pwform__fieldrow--head { font-size: 17.5px; }
  .sdp-pwform__idx { font-size: 17px; }
}
</style>