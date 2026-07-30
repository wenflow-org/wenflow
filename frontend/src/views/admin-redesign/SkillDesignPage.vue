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
        <span class="mk-status__meta mono">{{ overview.agentId }}</span>
        <span v-if="overview.file" class="mk-status__meta mono sdp-ellipsis" :title="overview.file.path">{{ overview.file.path }}</span>
        <span v-if="overview.db?.version" class="mk-status__meta">DB ACTIVE <b class="mono">v{{ overview.db.version }}</b></span>
        <span v-if="workbenchMeta?.stats" class="mk-status__meta">
          调用 <b class="mono">{{ workbenchMeta.stats.totalCalls }}</b>
          · 成功率 <b class="mono">{{ workbenchMeta.stats.successRate ?? '—' }}%</b>
          · 均耗 <b class="mono">{{ fmtMs(workbenchMeta.stats.avgDuration || 0) }}</b>
        </span>
        <span v-if="recentFailures > 0" class="mk-status__meta sdp-bad-text">近 60 条 {{ recentFailures }} 失败</span>
        <span v-if="overview.drift === 'file-vs-db-mismatch'" class="mk-badge mk-badge--warn">版本不一致</span>
        <span v-if="overview.tsFallback" class="mk-badge mk-badge--warn">代码兜底</span>
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadAll">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button type="button" class="mk-status__action mk-status__action--primary sdp-action-fix" @click="goDryRun">
          试跑
        </button>
      </div>
      <div v-else class="mk-status mk-status--muted">
        <span class="mk-status__dot"></span>
        <strong class="mk-status__title">{{ loading ? '加载中…' : skillId }}</strong>
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
                <button type="button" class="sdp-btn sdp-btn--primary sdp-btn--sm" :disabled="trialRunning" @click="runTrial">
                  {{ trialRunning ? '运行中…' : '运行预览' }}
                </button>
              </span>
            </header>
            <textarea v-model="trialInput" class="sdp-json mono" rows="7" placeholder='{"input": "…"}'></textarea>
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
            <pre class="sdp-prompt__code">{{ (promptView === 'source' ? compileInfo?.source : compileInfo?.compiled) || '暂无内容' }}</pre>
            <p class="sdp-prompt__hint">
              File-as-Truth：正式内容只能修改 <code class="mono">{{ overview.file?.path || 'prompts/skill.*.md' }}</code>，经部署同步生效。
            </p>
          </section>
        </div>

        <!-- 最近调用（全宽） -->
        <section class="sdp-block">
          <header class="sdp-block__head">
            <h4>最近调用</h4>
            <span class="sdp-block__meta">点「重跑」用真实输入立即复现</span>
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
                      <pre class="mono">{{ log.detail.input }}</pre>
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
              <p v-else class="sdp-none">近 60 条日志窗口内无调用。</p>
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
                <button type="button" class="mk-link" :disabled="!coreLoaded || coreCompiling" @click="previewCore">
                  {{ coreCompiling ? '编译中…' : '编译预览' }}
                </button>
                <button type="button" class="sdp-btn sdp-btn--primary sdp-btn--sm" :disabled="!coreLoaded || corePublishing" @click="publishCore(false)">
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
                @click="coreViewMode = 'form'"
              >表单</button>
              <button
                type="button"
                class="sdp-pw__viewbtn"
                :class="{ 'sdp-pw__viewbtn--active': coreViewMode === 'raw' }"
                @click="coreViewMode = 'raw'"
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

            <!-- 表单视图 -->
            <div v-if="coreViewMode === 'form'" class="sdp-pwform">
              <template v-if="coreForm">
                <!-- 身份 -->
                <section class="sdp-pwform__card">
                  <h5>身份</h5>
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
                </section>

                <!-- 规则 -->
                <section class="sdp-pwform__card">
                  <h5>执行规则 <b class="mono">{{ coreForm.rules.length }}</b></h5>
                  <div v-for="i in coreForm.rules.length" :key="i - 1" class="sdp-pwform__listitem">
                    <span class="sdp-pwform__idx mono">{{ i }}</span>
                    <textarea v-model="coreForm.rules[i - 1]" rows="2" class="sdp-input" @input="coreDirty = true"></textarea>
                    <span class="sdp-pwform__itemops">
                      <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.rules, i - 1, -1)">↑</button>
                      <button type="button" class="mk-link" :disabled="i === coreForm.rules.length" @click="moveItem(coreForm.rules, i - 1, 1)">↓</button>
                      <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.rules, i - 1)">删</button>
                    </span>
                  </div>
                  <button type="button" class="mk-link" @click="addItem(coreForm.rules)">+ 添加规则</button>
                </section>

                <!-- 输出字段（高危：字段冻结守门） -->
                <section class="sdp-pwform__card sdp-pwform__card--danger">
                  <h5>输出字段 <b class="mono">{{ coreForm.fields.length }}</b></h5>
                  <p class="sdp-pwform__warn">增删字段、改型、改名会触发字段冻结守门（受限/阻断需开发确认引用才能发布）。</p>
                  <div class="sdp-pwform__fields">
                    <div class="sdp-pwform__fieldrow sdp-pwform__fieldrow--head">
                      <span>name</span><span>type</span><span>可选</span><span>desc（生成指令）</span><span>turn</span><span></span>
                    </div>
                    <div v-for="(f, i) in coreForm.fields" :key="i" class="sdp-pwform__fieldrow">
                      <input v-model="f.name" class="sdp-input mono" placeholder="fieldName" @input="coreDirty = true" />
                      <select v-model="f.baseType" class="sdp-input" @change="coreDirty = true">
                        <option v-for="t in CORE_FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
                      </select>
                      <input v-model="f.optional" type="checkbox" @change="coreDirty = true" />
                      <input v-model="f.desc" class="sdp-input" placeholder="功能描述" @input="coreDirty = true" />
                      <input v-model="f.turn" type="checkbox" @change="coreDirty = true" />
                      <button type="button" class="mk-link mk-link--danger" @click="removeField(i)">删</button>
                    </div>
                  </div>
                  <button type="button" class="mk-link" @click="addField">+ 添加字段</button>
                </section>

                <!-- 约束 -->
                <section class="sdp-pwform__card">
                  <h5>自检约束 <b class="mono">{{ coreForm.constraints.length }}</b></h5>
                  <div v-for="i in coreForm.constraints.length" :key="i - 1" class="sdp-pwform__listitem">
                    <span class="sdp-pwform__idx mono">-</span>
                    <textarea v-model="coreForm.constraints[i - 1]" rows="2" class="sdp-input" @input="coreDirty = true"></textarea>
                    <span class="sdp-pwform__itemops">
                      <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.constraints, i - 1, -1)">↑</button>
                      <button type="button" class="mk-link" :disabled="i === coreForm.constraints.length" @click="moveItem(coreForm.constraints, i - 1, 1)">↓</button>
                      <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.constraints, i - 1)">删</button>
                    </span>
                  </div>
                  <button type="button" class="mk-link" @click="addItem(coreForm.constraints)">+ 添加约束</button>
                </section>

                <!-- 参数 -->
                <section class="sdp-pwform__card">
                  <h5>生成参数</h5>
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
                </section>
              </template>
              <p v-else class="sdp-none">{{ coreMissing ? '该 Skill 暂无核心文件' : '加载中…' }}</p>
            </div>

            <!-- 源码视图 -->
            <textarea
              v-else
              v-model="coreText"
              class="sdp-pw__textarea mono"
              spellcheck="false"
              :placeholder="coreMissing ? '该 Skill 暂无核心文件（prompts/core/' + skillId + '.yaml）' : '加载中…'"
              :disabled="!coreLoaded"
              @input="coreDirty = true"
            ></textarea>
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
              <button type="button" class="sdp-btn sdp-btn--primary sdp-btn--sm" :disabled="corePublishing" @click="publishCore(true)">
                人工确认无误，强制发布
              </button>
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
            <span class="sdp-sec-meta">{{ promptVersions.length }} 个版本 · 发布后建议回工作台试跑验证</span>
          </header>
          <p v-if="versionMsg" class="sdp-versions-msg">
            {{ versionMsg }}
            <button v-if="versionMsg.startsWith('已发布')" type="button" class="mk-link" @click="tab = 'trial'">去试跑验证 →</button>
          </p>
          <div class="mk-table-wrap">
            <table class="mk-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>状态</th>
                  <th>名称</th>
                  <th style="text-align: right">操作</th>
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
                      <button
                        v-if="v.status !== 'ACTIVE'"
                        type="button"
                        class="mk-link"
                        :disabled="versionBusy === v.id"
                        @click="publishVersion(v)"
                      >
                        发布
                      </button>
                      <button
                        v-if="v.status === 'DRAFT'"
                        type="button"
                        class="mk-link mk-link--danger"
                        :disabled="versionBusy === v.id"
                        @click="deleteVersion(v)"
                      >
                        删除
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
          本页只配置 endpoint / model 路由 / 超时 / 逻辑重试。温度与 Max Tokens 由 ACTIVE Prompt（File-as-Truth）管理，保存时不会写入节点覆盖表。
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
            <button type="button" class="sdp-btn sdp-btn--danger" :disabled="rtSaving" @click="resetRuntime">恢复默认</button>
            <button type="button" class="sdp-btn" :disabled="rtSaving" @click="loadRuntime">刷新</button>
            <button type="button" class="sdp-btn sdp-btn--primary" :disabled="rtSaving" @click="saveRuntime">
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

        <section v-if="overview.tsFallback" class="sdp-eng">
          <header class="sdp-sec-head"><h4>.ts 兜底常量</h4></header>
          <p class="sdp-eng__desc">以下 TypeScript 常量目前作为 <code class="mono">callPrompt</code> 的 <code class="mono">defaultSystemPrompt</code> 兜底。</p>
          <table class="sdp-kv">
            <tbody>
              <tr><th>file</th><td><code class="mono">{{ overview.tsFallback.file }}</code></td></tr>
              <tr><th>const name</th><td><code class="mono">{{ overview.tsFallback.constName }}</code></td></tr>
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
          <p v-else class="sdp-none">本节点没有登记规则。</p>
        </section>
      </div>
    </template>

    <div v-if="toast" class="mk-toast sdp-toast" :class="toastCls">{{ toast }}</div>
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
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  adminAgentPromptsApi,
  adminAgentsApi,
  adminPlatformSettingsApi,
  adminPromptOpsApi,
  adminPromptWorkbenchApi,
  adminSkillWorkbenchApi,
  adminSkillsApi
} from '@/api/adminApi'
import './mock-shared.css'

/* ---------- 路由与基础 ---------- */
const route = useRoute()
const router = useRouter()

const agentIdParam = computed(() => {
  const v = route.params.agentId
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : ''
})
const skillId = computed(() => agentIdParam.value.replace(/^skill:/, ''))

function goConsole() {
  void router.push('/admin/console')
}

/** Dry Run → 试跑页签 */
function goDryRun() {
  tab.value = 'trial'
}

/* ---------- 阶段色（与拓扑/抽屉同套） ---------- */
const AGENT_TONES: Record<string, { hue: string; soft: string }> = {
  'goal-agent': { hue: '#4f46e5', soft: 'rgba(79, 70, 229, 0.1)' },
  'path-agent': { hue: '#0d9488', soft: 'rgba(13, 148, 136, 0.1)' },
  'teaching-agent': { hue: '#3478f6', soft: 'rgba(52, 120, 246, 0.1)' },
  'learner-agent': { hue: '#d97706', soft: 'rgba(217, 119, 6, 0.1)' },
  'virtual-agent': { hue: '#7c3aed', soft: 'rgba(124, 58, 237, 0.1)' }
}
const tone = computed(() => {
  const pid = workbenchMeta.value?.parentAgent?.id || ''
  return AGENT_TONES[pid] || { hue: '#3478f6', soft: 'rgba(52, 120, 246, 0.1)' }
})

/* ---------- Toast ---------- */
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

/* ---------- 总览与元数据 ---------- */
interface OverviewItem {
  agentId: string
  kind: string
  displayName: string
  health: 'good' | 'warn' | 'risk'
  file: { path?: string; hash?: string } | null
  db: { id?: string; version?: number | string; hash?: string; useCount?: number; model?: string; publishedAt?: string } | null
  tsFallback: { file?: string; constName?: string } | null
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
const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
if (['protocol', 'trial', 'versions', 'runtime', 'engineering'].includes(qTab)) tab.value = qTab as TabKey
if (qTab === 'workbench' || qTab === 'inspect' || qTab === 'preview' || qTab === 'trial') tab.value = 'trial'
if (qTab === 'edit') tab.value = 'protocol'

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

const shortHash = (v?: string | null) => (v ? v.slice(0, 12) : '—')

async function loadInspect() {
  const [ci, ep] = await Promise.all([
    adminPromptOpsApi.getPromptCompileInfo(`skill:${skillId.value}`).catch(() => null),
    adminSkillsApi.getEffectiveSkillPrompt(skillId.value).catch(() => null)
  ])
  compileInfo.value = ci?.data?.data ?? null
  effectivePrompt.value = ep?.data?.data ?? null
}

/* ---------- 版本管理 ---------- */
interface VersionItem { id: string; version: string | number; status: string; name: string }
const promptVersions = ref<VersionItem[]>([])
const versionBusy = ref('')
const compareLoading = ref('')
const versionMsg = ref('')
interface DiffLine { type: 'added' | 'removed'; no: number | string; text: string }
interface DiffGroup { gap: boolean; lines: DiffLine[] }
const compareResult = ref<{ aLabel: string; bLabel: string; changedLines: number; groups: DiffGroup[] } | null>(null)

async function loadVersions() {
  const res = await adminAgentPromptsApi.getPromptVersions({ agentId: `skill:${skillId.value}` }).catch(() => null)
  const body = res?.data?.data ?? res?.data ?? []
  const items = Array.isArray(body) ? body : body.list || body.items || body.versions || []
  promptVersions.value = items.slice(0, 12).map((v: Record<string, unknown>) => ({
    id: String(v.id || ''),
    version: (v.version as string | number) ?? '—',
    status: String(v.status || '—'),
    name: String(v.name || '')
  }))
}

async function publishVersion(v: VersionItem) {
  if (versionBusy.value) return
  if (!window.confirm(`发布 v${v.version}「${v.name}」为生效版本？当前生效版本将下线。`)) return
  versionBusy.value = v.id
  versionMsg.value = ''
  try {
    await adminAgentPromptsApi.publishPrompt(v.id)
    await Promise.all([loadVersions(), loadInspect()])
    compareResult.value = null
    versionMsg.value = `已发布 v${v.version}`
  } catch (e) {
    versionMsg.value = `发布失败：${errText(e)}`
  } finally {
    versionBusy.value = ''
  }
}

async function deleteVersion(v: VersionItem) {
  if (versionBusy.value) return
  if (!window.confirm(`删除草稿 v${v.version}「${v.name}」？该操作不可撤销。`)) return
  versionBusy.value = v.id
  versionMsg.value = ''
  try {
    await adminAgentPromptsApi.deletePrompt(v.id)
    await loadVersions()
    compareResult.value = null
    versionMsg.value = `已删除草稿 v${v.version}`
  } catch (e) {
    versionMsg.value = `删除失败：${errText(e)}`
  } finally {
    versionBusy.value = ''
  }
}

async function compareWithActive(v: VersionItem) {
  const active = promptVersions.value.find((x) => x.status === 'ACTIVE')
  if (!active) {
    versionMsg.value = '当前没有生效版本可作对比基准'
    return
  }
  if (compareLoading.value) return
  compareLoading.value = v.id
  versionMsg.value = ''
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
    showToast(`JSON 不合法：${errText(e)}`, 'mk-toast--bad')
  }
}

function clearTrial() {
  trialResult.value = null
  trialError.value = ''
}

async function runTrial() {
  let payload: unknown
  try {
    payload = JSON.parse(trialInput.value || '{}')
  } catch (e) {
    showToast(`输入 JSON 不合法：${errText(e)}`, 'mk-toast--bad')
    return
  }
  if (trialRunning.value) return
  trialRunning.value = true
  trialError.value = ''
  try {
    const res = await adminSkillsApi.testSkill(skillId.value, payload)
    trialResult.value = res.data?.data ?? res.data ?? null
  } catch (e) {
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
const openLogId = ref('')

const recentFailures = computed(() => recentLogs.value.filter((l) => l.status !== 'ok').length)

function mapLogStatus(s: unknown): LogRow['status'] {
  return s === 'error' ? 'err' : s === 'timeout' ? 'timeout' : 'ok'
}

async function loadRecentLogs() {
  const res = await adminAgentsApi.getLogs({ agentName: `skill:${skillId.value}`, limit: 8, timeRange: 'week' }).catch(() => null)
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
}

/** 拉详情（输入/输出），供展开与重跑共用 */
async function ensureLogDetail(log: LogRow): Promise<void> {
  if (log.detail || log.loading) return
  log.loading = true
  try {
    const res = await adminAgentsApi.getLogDetail(log.id)
    const body = res.data?.data ?? res.data ?? {}
    const d = (body.log || body) as Record<string, unknown>
    const cap = (v: unknown): string | undefined => {
      if (v == null) return undefined
      const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
      return s.length > 3000 ? `${s.slice(0, 3000)}\n…（截断）` : s
    }
    log.detail = {
      input: cap(d.input ?? d.userPayload ?? d.requestPayload),
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
    showToast('该调用没有可用输入', 'mk-toast--bad')
    return
  }
  trialInput.value = log.detail.input
  tab.value = 'trial'
  showToast('已填入真实输入，正在重跑…')
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

async function loadRuntime() {
  const [skillRes, relRes] = await Promise.allSettled([
    adminSkillsApi.getSkillModelConfig(skillId.value),
    adminPlatformSettingsApi.getReliabilitySettings()
  ])
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
    generationParams.value = null
  }
}

async function saveRuntime() {
  if (rtSaving.value) return
  rtSaving.value = true
  rtMsg.value = ''
  try {
    await adminSkillsApi.updateSkillModelConfig(skillId.value, {
      tier: rtForm.value.tier,
      model: rtForm.value.model || undefined,
      thinkingMode: rtForm.value.thinkingMode,
      reasoningEffort: rtForm.value.thinkingMode === 'disabled' ? 'default' : rtForm.value.reasoningEffort,
      requestTimeoutMs: rtForm.value.enabled ? rtForm.value.requestTimeoutMs : null,
      maxLogicalRetries: logicalRetryMode.value === 'inherit' ? null : logicalRetryMode.value === 'disabled' ? 0 : customLogicalRetries.value,
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
  if (!window.confirm('确定恢复该 Skill 的默认模型配置吗？独立配置将被删除。')) return
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
const coreDiagnostics = ref<CoreDiagnostic[]>([])
const coreClassification = ref<CoreClassification | null>(null)
const coreSideTab = ref<'preview' | 'versions' | 'lineage'>('preview')
const coreGates = ref<any>(null)
const coreCompiledPrompt = ref('')
const coreCompiledMeta = ref<{ coreHash: string; coreVersion: number } | null>(null)
const corePublishResult = ref<{ ok: boolean; message?: string; agentId?: string; version?: number; coreHash?: string } | null>(null)
const coreUncertain = ref<any>(null)
const coreVersions = ref<CoreVersionRow[]>([])
const coreVersionsLoading = ref(false)
const coreLineage = ref<CoreLineageEntry[]>([])
const coreViewMode = ref<'form' | 'raw'>('form')
const coreForm = ref<CoreFormState | null>(null)
let coreRequested = false

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
  coreDiagnostics.value = []
  try {
    const res = await adminPromptWorkbenchApi.getCore(skillId.value)
    coreText.value = res.data?.raw || ''
    coreDiagnostics.value = res.data?.diagnostics || []
    initCoreForm((res.data?.core || null) as Record<string, unknown> | null)
    coreLoaded.value = true
    coreMissing.value = false
  } catch (e) {
    coreText.value = ''
    coreLoaded.value = false
    coreMissing.value = true
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status !== 404) showToast(`核心文件读取失败：${errText(e)}`, 'mk-toast--bad')
  }
}

async function saveCore() {
  if (!coreLoaded.value || coreSaving.value) return
  coreSaving.value = true
  coreClassification.value = null
  coreDiagnostics.value = []
  try {
    if (coreViewMode.value === 'form') {
      const payload = buildCorePayload()
      if (!payload) throw new Error('表单未加载')
      const res = await adminPromptWorkbenchApi.saveCoreForm(skillId.value, payload)
      coreClassification.value = res.data?.classification || null
      // 回读：raw 源码与表单状态同步到磁盘真值
      coreRequested = false
      await ensureCoreLoaded()
    } else {
      const res = await adminPromptWorkbenchApi.saveCore(skillId.value, coreText.value)
      coreClassification.value = res.data?.classification || null
    }
    coreDirty.value = false
    showToast(`已保存（${coreLevelLabel(coreClassification.value?.level || 'safe')}），状态：待编译发布`)
  } catch (e) {
    const data = (e as { response?: { data?: { diagnostics?: CoreDiagnostic[]; error?: string } } })?.response?.data
    coreDiagnostics.value = data?.diagnostics || []
    showToast(data?.error || `保存失败：${errText(e)}`, 'mk-toast--bad')
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
  try {
    const res = await adminPromptWorkbenchApi.compileCore({ skillId: skillId.value })
    coreGates.value = res.data?.gates || null
    coreCompiledPrompt.value = res.data?.prompt || ''
    coreCompiledMeta.value = { coreHash: res.data?.coreHash, coreVersion: res.data?.coreVersion }
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string } } })?.response?.data
    showToast(data?.error || `编译失败：${errText(e)}`, 'mk-toast--bad')
  } finally {
    coreCompiling.value = false
  }
}

async function publishCore(confirmUncertain: boolean) {
  if (!coreLoaded.value || corePublishing.value) return
  let developerApproval: { reference: string } | undefined
  if (coreClassification.value && coreClassification.value.level !== 'safe') {
    const reference = window.prompt(
      coreClassification.value.level === 'blocked'
        ? '字段删除或类型变更须先完成消费者同步。请输入对应开发提交、PR 或变更单引用：'
        : '新增字段须经开发确认消费者接入。请输入对应开发提交、PR 或变更单引用：'
    )?.trim()
    if (!reference) {
      showToast('未提供开发确认引用，已取消发布', 'mk-toast--bad')
      return
    }
    developerApproval = { reference }
  }
  corePublishing.value = true
  corePublishResult.value = null
  coreUncertain.value = null
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
    showToast(`发布成功：v${res.data?.version}（运行时已生效）`)
    // 发布改 ACTIVE：同步刷新检视与版本页数据
    await Promise.all([loadInspect(), loadVersions(), loadOverviewLite()])
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    const data = (e as { response?: { data?: any } })?.response?.data || {}
    if (status === 409 && data?.code === 'SEMANTIC_UNCERTAIN') {
      coreUncertain.value = data?.judgement || {}
      showToast('含义冻结不确定，需人工确认', 'mk-toast--bad')
    } else {
      if (data?.classification) coreClassification.value = data.classification
      corePublishResult.value = { ok: false, message: data?.error || `发布失败：${errText(e)}` }
      if (data?.issues?.length) {
        coreUncertain.value = { findings: data.issues, rationale: data.error }
      }
      showToast(data?.error || '发布被阻断', 'mk-toast--bad')
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
    showToast(`版本加载失败：${errText(e)}`, 'mk-toast--bad')
  } finally {
    coreVersionsLoading.value = false
  }
}

async function rollbackCore(version: number) {
  if (coreRollbacking.value) return
  if (!window.confirm(`确认回滚 ${skillId.value} 到 v${version}？现行文件与 ACTIVE 将被替换。`)) return
  coreRollbacking.value = true
  try {
    await adminPromptWorkbenchApi.rollbackCore(skillId.value, version)
    showToast(`已回滚到 v${version}`)
    await openCoreVersions()
    await Promise.all([loadInspect(), loadVersions(), loadOverviewLite()])
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string } } })?.response?.data
    showToast(data?.error || `回滚失败：${errText(e)}`, 'mk-toast--bad')
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
    showToast(`血缘加载失败：${errText(e)}`, 'mk-toast--bad')
  }
}

/* ---------- 工程：协议与规则 ---------- */
interface Protocol { id: string; title: string; statusLabel: string; summary: string; callSites: string }
interface RuleItem { ruleId: string; text: string; agentId: string }
const protocols = ref<Protocol[]>([])
const rulesOverview = ref<{ summary: { totalRules: number; totalPrefixes: number; conflictPrefixCount: number }; conflictPrefixes: Array<{ prefix: string; agentIds: string[] }>; byPrefix: Record<string, RuleItem[]> } | null>(null)
let engLoaded = false

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
  const [pv, ro] = await Promise.all([
    adminPromptOpsApi.getProtocolView().catch(() => null),
    adminPromptOpsApi.getSkillRulesOverview().catch(() => null)
  ])
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

watch(tab, (t) => {
  if (t === 'engineering') void loadEngineering()
  if (t === 'protocol') void ensureCoreLoaded()
})

/* ---------- 工具 ---------- */
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
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
    showToast('已复制')
  } catch {
    showToast('复制失败：剪贴板不可用', 'mk-toast--bad')
  }
}

/* ---------- 总加载 ---------- */
async function loadAll() {
  if (!skillId.value) return
  loading.value = true
  notFound.value = false
  try {
    const r = await adminPromptOpsApi.getAgentOverview()
    const items = (r.data?.data?.items || []) as OverviewItem[]
    const found = items.find((x) => x.agentId === `skill:${skillId.value}` || x.agentId === skillId.value) || null
    if (!found) {
      overview.value = null
      notFound.value = true
      return
    }
    overview.value = found
    const meta = await adminSkillWorkbenchApi.getMeta(found.agentId).catch(() => null)
    workbenchMeta.value = meta?.data?.data ?? meta?.data ?? null
    await Promise.all([loadInspect(), loadVersions(), loadRuntime(), loadRecentLogs()])
  } catch (e) {
    showToast(`加载失败：${errText(e)}`, 'mk-toast--bad')
  } finally {
    loading.value = false
  }
}

watch(agentIdParam, () => {
  // 切换 skill：core 状态全部重置，协议页签下次激活时重新拉取
  coreRequested = false
  coreLoaded.value = false
  coreMissing.value = false
  coreText.value = ''
  coreDirty.value = false
  coreDiagnostics.value = []
  coreClassification.value = null
  coreGates.value = null
  coreCompiledPrompt.value = ''
  coreCompiledMeta.value = null
  corePublishResult.value = null
  coreUncertain.value = null
  coreVersions.value = []
  coreLineage.value = []
  if (agentIdParam.value) void loadAll()
  if (tab.value === 'protocol') void ensureCoreLoaded()
})
onMounted(() => {
  void loadAll()
  if (tab.value === 'engineering') void loadEngineering()
  if (tab.value === 'protocol') void ensureCoreLoaded()
})
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
.mono { font-family: var(--mk-mono); }
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

.sdp-btn {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.sdp-btn:hover { background: #f6f9ff; }
.sdp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.sdp-btn--primary { background: var(--mk-blue); border-color: var(--mk-blue); color: #fff; }
.sdp-btn--primary:hover { background: #2b64d8; }
.sdp-btn--danger { color: var(--mk-red); border-color: rgba(220, 38, 38, 0.35); background: transparent; }
.sdp-btn--sm { padding: 5px 11px; font-size: 11.5px; }

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
  border-radius: 8px;
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
  border-radius: 8px;
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
.sdp-trial__meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sdp-output {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: #101826;
  border: 1px solid #1c2a40;
  color: #9db8dc;
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
.mk-table-wrap {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
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
  z-index: 300;
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
.sdp-pw__pills { display: inline-flex; gap: 4px; background: #eef2fa; border-radius: 9px; padding: 3px; }
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
  padding: 16px 18px;
  display: grid;
  gap: 14px;
  background: #fff;
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
  grid-template-columns: minmax(120px, 1fr) 116px 34px minmax(150px, 1.6fr) 34px 30px;
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
  .sdp-pwform__fieldrow { grid-template-columns: 1fr 96px 30px; }
  .sdp-pwform__fieldrow--head { display: none; }
}
</style>
