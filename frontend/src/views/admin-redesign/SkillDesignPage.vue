<template>
  <div class="mk-page sdp">
    <!-- 顶部：返回 + 身份 + 全局操作 -->
    <header class="sdp-head">
      <button type="button" class="sdp-back" @click="goConsole">← 控制台</button>
      <template v-if="overview">
        <span class="sdp-icon" :style="{ '--hue': tone.hue, '--soft': tone.soft }" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z" />
            <path d="M8 8 13.8 5M8 8 2.2 5M8 8v6.2" />
          </svg>
        </span>
        <div class="sdp-title">
          <div class="sdp-title__row">
            <h1>{{ overview.displayName || skillId }}</h1>
            <span class="mk-badge" :class="healthBadgeCls">{{ healthLabel }}</span>
            <span v-if="workbenchMeta?.parentAgent" class="sdp-parent" :style="{ color: tone.hue }">
              ↑ {{ workbenchMeta.parentAgent.name }}
            </span>
          </div>
          <div class="sdp-title__meta">
            <code class="mono">{{ overview.agentId }}</code>
            <span v-if="overview.file" class="sdp-chip mono" :title="overview.file.path">{{ overview.file.path }}</span>
            <span v-if="overview.db?.version" class="sdp-chip">DB ACTIVE <b class="mono">v{{ overview.db.version }}</b></span>
            <span v-if="workbenchMeta?.stats" class="sdp-chip">
              调用 <b class="mono">{{ workbenchMeta.stats.totalCalls }}</b>
              · 成功率 <b class="mono">{{ workbenchMeta.stats.successRate ?? '—' }}%</b>
              · 均耗 <b class="mono">{{ fmtMs(workbenchMeta.stats.avgDuration || 0) }}</b>
            </span>
            <span v-if="recentFailures > 0" class="sdp-chip sdp-chip--bad">近 60 条日志 {{ recentFailures }} 失败</span>
            <span v-if="overview.drift === 'file-vs-db-mismatch'" class="sdp-chip sdp-chip--warn">版本不一致</span>
            <span v-if="overview.tsFallback" class="sdp-chip sdp-chip--warn">代码兜底</span>
          </div>
        </div>
      </template>
      <div v-else class="sdp-title__loading">{{ loading ? '加载中…' : '' }}</div>
      <div class="sdp-head__actions">
        <button type="button" class="sdp-btn" :disabled="loading" @click="loadAll">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button type="button" class="sdp-btn sdp-btn--primary" @click="goDryRun">Dry Run</button>
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

      <!-- ========== 工作台：Prompt + 试跑 + 最近调用（调试闭环同屏） ========== -->
      <div v-show="tab === 'workbench'" class="sdp-pane">
        <div class="sdp-workbench">
          <!-- 左：Prompt 内容 -->
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

          <!-- 右：试跑 + 最近调用 -->
          <div class="sdp-side">
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
            <button v-if="versionMsg.startsWith('已发布')" type="button" class="mk-link" @click="tab = 'workbench'">去试跑验证 →</button>
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
  adminSkillWorkbenchApi,
  adminSkillsApi
} from '@/api/adminApi'
import { editSkillInPromptLab } from './mockStore'
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

/** Dry Run → 控制台 Prompt Lab（预选本 Skill） */
function goDryRun() {
  editSkillInPromptLab(skillId.value)
  void router.push('/admin/console')
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

/* ---------- Tabs ---------- */
type TabKey = 'workbench' | 'versions' | 'runtime' | 'engineering'
const tab = ref<TabKey>('workbench')
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'workbench', label: '工作台' },
  { key: 'versions', label: '版本' },
  { key: 'runtime', label: '运行时' },
  { key: 'engineering', label: '工程' }
]
// ?tab= 直达 + 旧链接兼容
const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
if (['workbench', 'versions', 'runtime', 'engineering'].includes(qTab)) tab.value = qTab as TabKey
if (qTab === 'edit' || qTab === 'inspect') tab.value = 'workbench'
if (qTab === 'preview' || qTab === 'trial') tab.value = 'workbench'

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
  tab.value = 'workbench'
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
  if (agentIdParam.value) void loadAll()
})
onMounted(() => {
  void loadAll()
  if (tab.value === 'engineering') void loadEngineering()
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
  max-width: 1280px;
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
  display: flex;
  align-items: flex-start;
  gap: 12px;
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
  padding: 8px 0;
  white-space: nowrap;
}
.sdp-back:hover { text-decoration: underline; }
.sdp-icon {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: var(--soft);
  color: var(--hue);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.sdp-icon svg { width: 20px; height: 20px; }
.sdp-title { min-width: 0; flex: 1; display: grid; gap: 6px; }
.sdp-title__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sdp-title__row h1 { margin: 0; font-size: 19px; font-weight: 600; color: #16233c; }
.sdp-parent { font-size: 12px; font-weight: 600; }
.sdp-title__meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sdp-title__meta > code { font-size: 11px; color: var(--mk-faint); }
.sdp-title__loading { flex: 1; color: var(--mk-faint); font-size: 13px; padding: 10px 0; }
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
.sdp-head__actions { display: flex; gap: 8px; flex-shrink: 0; padding-top: 4px; }

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
</style>
