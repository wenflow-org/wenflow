<template>
  <!-- ===== 加载完成：原型 renderSkillDetail 的完整版式 =====
       hero（头像「S」+ 技能名 + 归属 Agent · 类别副文 + 健康/类别/模型/版本 pills + 动作）
       → 单张卡承载 MkSubTabs（6 页签：协议/试跑/版本/运行时/工程/字段路由，原型 dtab 组 skill）
       → 各页签内容卡（原型卡片/表格/代码块词汇）。
       Prompt 编辑是弹层（原型 openPromptModal：modal modal--wide），不是页签。 -->
  <div v-if="view" class="mk-page skd">
    <MkDetailHero avatar="S" :title="view.name" :sub="heroSub">
      <template #pills>
        <span class="mk-badge" :class="healthBadge.cls" :title="healthBadge.title">{{ healthBadge.text }}</span>
        <span class="mk-badge mk-badge--muted" :title="`类别：${view.category}`">{{ view.category }}</span>
        <span v-if="modelLabel" class="mk-badge mk-badge--muted mono" :title="'生效模型（skill_model_configs 覆盖或 ACTIVE Prompt 声明）'">{{ modelLabel }}</span>
        <span v-if="promptVersionText" class="mk-badge mk-badge--info">ACTIVE {{ promptVersionText }}</span>
      </template>
      <template #actions>
        <button type="button" class="mk-btn" :disabled="loading" @click="load(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button type="button" class="mk-btn mk-btn--primary" @click="goDesign()">打开设计页 →</button>
      </template>
    </MkDetailHero>

    <!-- 页签卡（原型：单张卡内 subtabs + subpane；内容用 v-if 切换，与原型重渲染同语义） -->
    <section class="mk-card skd-body">
      <MkSubTabs :tabs="TABS" v-model="tab" />
      <div class="skd-pane">
        <!-- ========== 协议（原型 protocol：输入/输出契约 vrow + System Prompt 代码卡） ========== -->
        <template v-if="tab === 'protocol'">
          <div class="skd-grid">
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">输入契约</h3>
                <span class="mk-card__meta">{{ contractIns.length }} 字段</span>
              </div>
              <div class="skd-pad skd-rows">
                <MkLoading v-if="routingsLoading && !routings" inline text="字段契约加载中…" />
                <template v-else-if="routingsFailed">
                  <p class="skd-none">字段契约加载失败。<button type="button" class="mk-link" @click="load(true)">重试</button></p>
                </template>
                <template v-else>
                  <div v-for="f in contractIns" :key="f.fieldId" class="skd-vrow">
                    <span class="mono skd-vrow__name" :title="f.fieldId">{{ f.fieldId }}</span>
                    <span class="mk-badge mk-badge--info">入参</span>
                    <span class="skd-vrow__desc" :title="f.description || ''">{{ f.description || '—' }}</span>
                    <span class="mono skd-vrow__type">{{ f.valueType || '—' }}</span>
                    <span class="mk-badge" :class="f.promptRole === 'hard-required' ? 'mk-badge--warn' : 'mk-badge--muted'">{{ f.promptRole === 'hard-required' ? '必填' : '可选' }}</span>
                  </div>
                  <p v-if="!contractIns.length" class="skd-none">该 Skill 暂无输入字段声明（无编排路由或全部为产出字段）。</p>
                </template>
              </div>
            </section>
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">输出契约</h3>
                <span class="mk-card__meta">{{ contractOuts.length }} 字段</span>
              </div>
              <div class="skd-pad skd-rows">
                <MkLoading v-if="routingsLoading && !routings" inline text="字段契约加载中…" />
                <template v-else-if="routingsFailed">
                  <p class="skd-none">字段契约加载失败。<button type="button" class="mk-link" @click="load(true)">重试</button></p>
                </template>
                <template v-else>
                  <div v-for="f in contractOuts" :key="f.fieldId" class="skd-vrow">
                    <span class="mono skd-vrow__name" :title="f.fieldId">{{ f.fieldId }}</span>
                    <span class="mk-badge mk-badge--ok">出参</span>
                    <span class="skd-vrow__desc" :title="f.description || ''">{{ f.description || '—' }}</span>
                    <span class="mono skd-vrow__type">{{ f.valueType || '—' }}</span>
                    <span class="mk-badge mk-badge--muted">{{ roleLabel(f.promptRole) }}</span>
                  </div>
                  <p v-if="!contractOuts.length" class="skd-none">该 Skill 暂无产出字段声明。</p>
                </template>
              </div>
            </section>
          </div>
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">System Prompt</h3>
              <div class="mk-card__head-right">
                <span class="mk-card__meta">{{ promptStateText }}</span>
                <button type="button" class="mk-btn mk-btn--sm" @click="openPromptModal">编辑 Prompt</button>
              </div>
            </div>
            <div class="skd-pad">
              <pre class="skd-code">{{ systemPromptCap || (promptFailed ? '生效 Prompt 加载失败，请刷新重试。' : '暂无生效 Prompt。') }}</pre>
              <p v-if="promptTruncated" class="skd-none">已截断：仅显示前 1200 字（共 {{ promptLen }} 字），完整内容在设计页查看。</p>
            </div>
          </section>
        </template>

        <!-- ========== 试跑（原型 trial：样例输入 textarea + 输出 code；执行链路/对比评分后端无此数据，不硬造） ========== -->
        <template v-else-if="tab === 'trial'">
          <div class="skd-grid">
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">样例输入</h3>
                <span class="mk-card__meta">JSON · 可编辑</span>
              </div>
              <div class="skd-pad">
                <textarea v-model="trialInput" class="mk-input mono skd-ta" rows="7" spellcheck="false" aria-label="样例输入" placeholder='{"input": "…"}'></textarea>
                <div class="skd-ta-foot">
                  <span class="skd-none">
                    <template v-if="trialResult">上次试跑 {{ trialResult.success ? '成功' : '失败' }}<template v-if="trialResult.duration != null"> · {{ fmtMs(trialResult.duration) }}</template></template>
                    <template v-else>尚未试跑</template>
                  </span>
                  <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="trialRunning" @click="runTrial">
                    {{ trialRunning ? '运行中…' : '试跑' }}
                  </button>
                </div>
                <p v-if="trialError" class="skd-error">{{ trialError }}</p>
              </div>
            </section>
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">样例输出</h3>
                <span v-if="trialResult" class="mk-badge" :class="trialResult.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ trialResult.success ? '成功' : '失败' }}</span>
              </div>
              <div class="skd-pad">
                <pre class="skd-code skd-code--tall">{{ trialOutputText || '尚无试跑结果：在左侧输入 JSON 后点「试跑」。' }}</pre>
              </div>
            </section>
          </div>
          <p class="skd-note">试跑直接调用该 Skill 的真实 handler 执行；重跑日志、ACTIVE Prompt 参照等完整诊断在设计页「试跑」页签。</p>
        </template>

        <!-- ========== 版本（原型 versions：.tbl 表格；日期/作者/回滚后端未随列表返回，不硬造） ========== -->
        <template v-else-if="tab === 'versions'">
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">Prompt 版本</h3>
              <div class="mk-card__head-right">
                <span class="mk-card__meta">{{ versionsStateText }}</span>
                <button type="button" class="mk-btn mk-btn--sm" @click="goDesign('versions')">对比 / 回滚 →</button>
              </div>
            </div>
            <div class="skd-tablewrap">
              <table v-if="versions.length" class="mk-table">
                <thead>
                  <tr><th>版本</th><th>名称</th><th>状态</th></tr>
                </thead>
                <tbody>
                  <tr v-for="v in versions" :key="v.id">
                    <td class="mono">v{{ v.version }}</td>
                    <td>{{ v.name || '—' }}</td>
                    <td><span class="mk-badge" :class="v.status === 'ACTIVE' ? 'mk-badge--ok' : 'mk-badge--muted'">{{ versionStatusText(v.status) }}</span></td>
                  </tr>
                </tbody>
              </table>
              <div class="skd-pad" v-else>
                <MkLoading v-if="versionsLoading" inline text="版本加载中…" />
                <p v-else-if="versionsFailed" class="skd-none">版本列表加载失败。<button type="button" class="mk-link" @click="load(true)">重试</button></p>
                <p v-else class="skd-none">暂无 Prompt 版本记录。</p>
              </div>
            </div>
            <div class="mk-card__foot">
              <span class="mk-card__meta">版本 diff 对比与 core 回滚在设计页「版本」页签完成</span>
              <button type="button" class="mk-btn mk-btn--sm" @click="goDesign('versions')">打开版本管理 →</button>
            </div>
          </section>
        </template>

        <!-- ========== 运行时（原型 runtime：指标卡 + 模型与路由 + 保存配置；SkillDrawer 的配置/探测/最近调用迁入此页签） ========== -->
        <template v-else-if="tab === 'runtime'">
          <div class="skd-metrics" role="list" aria-label="运行指标">
            <div class="skd-metric" role="listitem">
              <span class="skd-metric__label">调用次数</span>
              <strong class="skd-metric__value">{{ stat.calls }}</strong>
            </div>
            <div class="skd-metric" role="listitem">
              <span class="skd-metric__label">失败</span>
              <strong class="skd-metric__value" :class="{ 'is-bad': stat.calls > 0 && stat.errors > 0 }">{{ stat.calls ? stat.errors : '—' }}</strong>
            </div>
            <div class="skd-metric" role="listitem">
              <span class="skd-metric__label">成功率</span>
              <strong class="skd-metric__value" :class="rateTone ? `is-${rateTone}` : ''">{{ successRate }}</strong>
            </div>
            <div class="skd-metric" role="listitem">
              <span class="skd-metric__label">平均耗时</span>
              <strong class="skd-metric__value">{{ stat.calls ? fmtMs(stat.avgMs) : '—' }}</strong>
            </div>
          </div>
          <p v-if="statsNote" class="skd-note">统计口径：{{ statsNote }}</p>
          <div class="skd-grid">
            <!-- 模型配置（SkillDrawer「模型配置」页签整体迁入：skill_model_configs CRUD） -->
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">模型配置</h3>
                <span class="mk-card__meta">{{ rtForm.enabled ? '独立路由' : '继承上层 / 平台默认' }}</span>
              </div>
              <div class="skd-pad skd-stack">
                <label class="skd-check">
                  <input v-model="rtForm.enabled" type="checkbox" />
                  <span>独立配置<em>关闭 = 继承 Agent / 平台默认</em></span>
                </label>
                <div class="skd-fgrid">
                  <label class="skd-field">
                    <span>模型层级</span>
                    <select v-model="rtForm.tier" class="mk-input" :disabled="!rtForm.enabled">
                      <option value="chat">chat</option>
                      <option value="reasoning">reasoning</option>
                    </select>
                  </label>
                  <label class="skd-field">
                    <span>模型<em>Prompt 声明 model 时不生效</em></span>
                    <input v-model="rtForm.model" class="mk-input mono" :disabled="!rtForm.enabled" placeholder="留空继承默认" spellcheck="false" />
                  </label>
                  <label class="skd-field">
                    <span>思考模式</span>
                    <select v-model="rtForm.thinkingMode" class="mk-input" :disabled="!rtForm.enabled">
                      <option value="default">跟随继承值 / 模型默认</option>
                      <option value="enabled">开启</option>
                      <option value="disabled">关闭</option>
                    </select>
                  </label>
                  <label class="skd-field">
                    <span>思考强度</span>
                    <select v-model="rtForm.reasoningEffort" class="mk-input" :disabled="!rtForm.enabled || rtForm.thinkingMode === 'disabled'">
                      <option value="default">跟随继承值 / 模型默认</option>
                      <option value="low">low</option>
                      <option value="high">high</option>
                      <option value="max">max</option>
                    </select>
                  </label>
                  <label class="skd-field">
                    <span>请求超时（ms）</span>
                    <input v-model.number="rtForm.requestTimeoutMs" type="number" min="10000" max="300000" step="10000" class="mk-input" :disabled="!rtForm.enabled" placeholder="继承" />
                  </label>
                </div>
                <p v-if="rtMsg" class="skd-msg" :class="{ 'is-err': rtErr }">{{ rtMsg }}</p>
                <div class="skd-actions">
                  <button type="button" class="mk-btn skd-btn--danger" :disabled="rtSaving" @click="resetRuntimeConfig">恢复默认</button>
                  <button type="button" class="mk-btn" :disabled="rtSaving" @click="refreshRuntimeConfig">刷新</button>
                  <button type="button" class="mk-btn mk-btn--primary" :disabled="rtSaving" @click="saveRuntimeConfig">
                    {{ rtSaving ? '保存中…' : '保存配置' }}
                  </button>
                </div>
                <p class="skd-none">模型仅当该 Skill 的 ACTIVE Prompt 未声明 model 时生效；生成参数（含 model）以 ACTIVE Prompt 为准。</p>
              </div>
            </section>
            <!-- 模型测试（SkillDrawer「模型测试」页签整体迁入：model-probe 直发上游，不落库） -->
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">模型测试</h3>
                <span class="mk-card__meta">直发上游 · 不落库</span>
              </div>
              <div class="skd-pad skd-stack">
                <div class="skd-fgrid">
                  <label class="skd-field">
                    <span>思考模式</span>
                    <select v-model="probeForm.thinkingMode" class="mk-input">
                      <option value="default">跟随配置（{{ cfgThinkingLabel }}）</option>
                      <option value="enabled">开启</option>
                      <option value="disabled">关闭</option>
                    </select>
                  </label>
                  <label class="skd-field">
                    <span>思考强度</span>
                    <select v-model="probeForm.reasoningEffort" class="mk-input" :disabled="probeForm.thinkingMode === 'disabled'">
                      <option value="default">跟随配置（{{ cfgEffortLabel }}）</option>
                      <option value="low">low</option>
                      <option value="high">high</option>
                      <option value="max">max</option>
                    </select>
                  </label>
                </div>
                <p v-if="probeResolved" class="skd-resolved mono">生效：{{ probeResolved.model }} · {{ probeResolved.thinkingMode }} / {{ probeResolved.reasoningEffort }}</p>
                <div class="skd-actions">
                  <button type="button" class="mk-btn mk-btn--primary" :disabled="probeRunning" @click="runModelProbe">
                    {{ probeRunning ? '探测中…（最长 180s）' : '开始探测' }}
                  </button>
                  <span v-if="probeError" class="skd-error">{{ probeError }}</span>
                </div>
                <div v-if="probeResult" class="skd-probe" :class="probeResult.jsonOk === 'ok' ? 'is-ok' : 'is-bad'">
                  <div class="skd-probe__grid">
                    <div><span>总耗时</span><strong class="mono">{{ fmtMs(probeResult.durationMs) }}</strong></div>
                    <div><span>首字 TTFT</span><strong class="mono">{{ probeResult.ttftContentMs != null ? fmtMs(probeResult.ttftContentMs) : '—' }}</strong></div>
                    <div><span>JSON</span><strong class="mono" :class="probeResult.jsonOk === 'ok' ? 'is-ok' : 'is-bad'">{{ probeResult.jsonOk }}</strong></div>
                    <div><span>输出字符</span><strong class="mono">{{ probeResult.contentChars }}</strong></div>
                    <div><span>completion</span><strong class="mono">{{ probeResult.completionTokens ?? '—' }}</strong></div>
                    <div><span>finish</span><strong class="mono">{{ probeResult.finish || '—' }}</strong></div>
                  </div>
                  <pre v-if="probeResult.contentPreview" class="skd-code skd-code--short mono">{{ probeResult.contentPreview }}</pre>
                </div>
                <p class="skd-none">探测用 ACTIVE Prompt + 当前路由直发上游，测「改档位后真实延迟 / JSON / token」；先验证再保存配置。</p>
              </div>
            </section>
          </div>
          <!-- 最近调用（SkillDrawer「概览」迁入：点行跳执行日志 Trace） -->
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">最近调用</h3>
              <span class="mk-card__meta">{{ recent.length ? `${recent.length} 条` : '近 60 条日志窗口' }}</span>
            </div>
            <div class="skd-pad skd-rows">
              <button v-for="s in recent" :key="s.id" type="button" class="skd-call" :title="`traceId：${s.traceId}`" @click="goTrace(s.traceId)">
                <span class="skd-dot" :class="`is-${s.status}`" role="img" :aria-label="statusDotLabel(s.status)" :title="statusDotLabel(s.status)"></span>
                <span class="skd-call__title">{{ s.title }}</span>
                <span class="mono skd-call__ms">{{ fmtMs(s.durationMs) }}</span>
              </button>
              <p v-if="!recent.length" class="skd-none">日志窗口内无调用（统计为全量口径）。</p>
            </div>
          </section>
        </template>

        <!-- ========== 工程（原型 engineering：工程信息 kv；仓库/值班/SLO/依赖后端未返回，不硬造） ========== -->
        <template v-else-if="tab === 'engineering'">
          <div class="skd-grid">
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">工程信息</h3>
              </div>
              <div class="skd-pad">
                <div class="mk-facts">
                  <div><span>Skill ID</span><strong class="mono" :title="view.id">{{ view.id }}</strong></div>
                  <div><span>归属 Agent</span><strong>{{ view.agentName || view.agentId || '—' }}</strong></div>
                  <div><span>类别</span><strong>{{ view.category }}</strong></div>
                  <div v-if="coreFilePath"><span>核心文件</span><strong class="mono" :title="coreFilePath">{{ coreFilePath }}</strong></div>
                  <div><span>统计口径</span><strong>{{ statsNote || '—' }}</strong></div>
                </div>
              </div>
            </section>
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">协议规则与依赖</h3>
              </div>
              <div class="skd-pad skd-stack">
                <p class="skd-none">完整工程视图（协议规则 / 依赖视图 / 发布流水）由设计页「工程」页签承载。</p>
                <div class="skd-actions">
                  <button type="button" class="mk-btn mk-btn--primary" @click="goDesign('engineering')">打开工程视图 →</button>
                </div>
              </div>
            </section>
          </div>
        </template>

        <!-- ========== 字段路由（原型 fields：字段流转表格 + note） ========== -->
        <template v-else>
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">字段路由</h3>
              <div class="mk-card__head-right">
                <span class="mk-card__meta">{{ routingRowsStateText }}</span>
                <button type="button" class="mk-btn mk-btn--sm" @click="goDesign('routing')">编辑字段路由 →</button>
              </div>
            </div>
            <div class="skd-tablewrap">
              <table v-if="routingRows.length" class="mk-table">
                <thead>
                  <tr><th>字段</th><th>角色</th><th class="skd-th-wrap">说明</th><th>流向</th><th>渲染</th><th>属性</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in routingRows" :key="`${r.agentId}:${r.fieldId}`">
                    <td class="mono">{{ r.fieldId }}</td>
                    <td><span v-if="r.roleLabel" class="mk-badge" :class="r.roleCls">{{ r.roleLabel }}</span><span v-else class="mk-na">—</span></td>
                    <td class="skd-td-wrap">{{ r.desc || '—' }}</td>
                    <td class="mono">{{ r.handoffText }}</td>
                    <td><span class="mk-badge" :class="r.render === 'visible' ? 'mk-badge--render-visible' : 'mk-badge--render-hidden'">{{ r.render === 'visible' ? '可见' : '隐藏' }}</span></td>
                    <td>
                      <span v-if="r.internal" class="mk-badge mk-badge--flow-internal">内部</span>
                      <span v-if="r.accumulate" class="mk-badge mk-badge--flow-accumulate">累计</span>
                      <span v-if="!r.internal && !r.accumulate" class="mk-na">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="skd-pad" v-else>
                <MkLoading v-if="routingsLoading" inline text="字段路由加载中…" />
                <p v-else-if="routingsFailed" class="skd-none">字段路由加载失败。<button type="button" class="mk-link" @click="load(true)">重试</button></p>
                <p v-else class="skd-none">该 Skill 暂无产出行（无编排路由声明）。</p>
              </div>
            </div>
            <div class="skd-pad">
              <p class="skd-note skd-note--flat">字段路由决定 Skill 与上下游 Agent 之间传递的结构化字段；标注「内部」的字段不进入用户可见回复。</p>
            </div>
          </section>
        </template>
      </div>
    </section>

    <!-- ===== Prompt 编辑弹层（原型 openPromptModal：modal modal--wide；草稿保存/发布在设计页完成） ===== -->
    <Teleport to="body">
      <div v-if="pmOpen" ref="pmMaskRef" class="mk-modal">
        <div ref="pmPanelRef" class="mk-modal__panel mk-modal__panel--wide skd-pm" role="dialog" aria-modal="true" aria-label="编辑 Prompt">
          <div class="mk-modal__head">
            <h2 class="mk-modal__title">编辑 Prompt · {{ view.name }}</h2>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closePromptModal">✕</button>
          </div>
          <div class="mk-modal__body skd-pm__body">
            <label class="skd-field">
              <span>system</span>
              <textarea v-model="pmText" class="mk-input mono skd-ta" rows="12" spellcheck="false"></textarea>
            </label>
            <label class="skd-field">
              <span>变更说明</span>
              <input v-model="pmNote" class="mk-input" placeholder="例如：优化诊断追问策略" />
              <em class="skd-hint">Prompt 内容以 core 文件为单源（File-as-Truth）：此处供查看与起草，草稿保存与发布在设计页「协议」页签完成。</em>
            </label>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="closePromptModal">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" @click="goDesign('protocol')">前往设计页编辑 →</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>

  <!-- ===== 未找到：ID 未注册或 live/meta 均不可得 ===== -->
  <div v-else-if="notFound" class="mk-page skd">
    <MkEmptyState
      icon="◌"
      title="未找到该 Skill"
      :description="`「${skillId}」可能未注册或 ID 有误。`"
      action-text="返回列表"
      @action="closeSubPage"
    />
  </div>

  <!-- ===== 首次加载：骨架屏（形状走 MkSkeleton 版式） ===== -->
  <div v-else class="mk-page skd">
    <div class="skd-skel" aria-hidden="true">
      <MkSkeleton variant="identity" :avatar="52" />
      <MkSkeleton variant="cards" :count="1" :h="120" :cols="1" :radius="12" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 技能详情二级页（newui 原型 renderSkillDetail 的落点，2026-10-01 新建）。
 *
 * 原型口径：hero（S 头像 + 技能名 + 归属副文 + 状态/版本/路由 pills + 动作）
 * → 单张卡内 6 个 subtab（协议 / 试跑 / 版本 / 运行时 / 工程 / 字段路由，dtab 组 skill）
 * → Prompt 编辑是弹层（openPromptModal：modal modal--wide），不是页签。
 * 数据口径：全部来自现有接口的真实字段——live 注册表档案 + workbench meta +
 * effective-prompt + skill_model_configs + model-probe + 字段路由 + Prompt 版本；
 * 原型有而后端没有的展示项（回合状态机 / 终止条件 / 试跑对比评分 / 仓库与值班 /
 * 依赖 chips / 版本日期作者 / 脱敏列）一律不渲染，绝不硬造。
 * 功能口径：SkillDrawer 的四页签能力全部迁入对应页签（概览→运行时指标+最近调用、
 * Prompt→协议页签 System Prompt 卡、模型配置/模型测试→运行时页签），
 * 深度编辑（协议发布 / 版本回滚 / 字段路由编辑）仍由 /admin/skills/:id 设计页承载，
 * 本页用原型动作钮的形态显式跳转，能力一个不丢。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { subPage, closeSubPage, setSubPageLabel, skillStatOf, recentSpansOf, openTrace } from './store'
import { liveSkillProfiles, liveExtraProfiles, errMsg } from './live'
import {
  adminSkillsApi,
  adminSkillWorkbenchApi,
  adminFieldRoutingsApi,
  adminAgentPromptsApi,
  adminPromptOpsApi
} from '@/api/adminApi'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'

/* ===== 6 页签（原型 tabs 数组：key 与设计页 ?tab= 深链键对齐，便于互跳） ===== */
const TABS: Array<{ key: string; label: string }> = [
  { key: 'protocol', label: '协议' },
  { key: 'trial', label: '试跑' },
  { key: 'versions', label: '版本' },
  { key: 'runtime', label: '运行时' },
  { key: 'engineering', label: '工程' },
  { key: 'fields', label: '字段路由' }
]
const tab = ref('protocol')

const router = useRouter()
const skillId = computed(() => (subPage.value?.view === 'skill' ? subPage.value.id || '' : ''))

/* ===== 身份：live 注册表档案优先，workbench meta 兜底（外挂能力 / 深链时注册表可能未就绪） ===== */
interface SkillIdentity { id: string; name: string; category: string; agentId: string; agentName: string }
/** workbench meta 松散契约（后端字段可选并持续新增；按已知键读取，不硬造展示） */
interface WorkbenchMeta {
  parentAgent?: { id?: string; name?: string }
  skill?: { id?: string; name?: string; category?: string }
  modelConfig?: { model?: string; tier?: string; llmRequest?: { model?: string; source?: string } }
  stats?: { source?: string; range?: string }
}
const meta = ref<WorkbenchMeta | null>(null)
const liveProfile = computed(() => {
  const id = skillId.value
  if (!id) return null
  return (
    liveSkillProfiles.value.find((p) => p.id === id) ||
    liveExtraProfiles.value.find((p) => p.id === id) ||
    null
  )
})
const view = computed<SkillIdentity | null>(() => {
  const lp = liveProfile.value
  if (lp) {
    return {
      id: lp.id,
      name: lp.name,
      category: lp.category,
      agentId: lp.agentId || '',
      agentName: lp.agentName || String(meta.value?.parentAgent?.name || '')
    }
  }
  const m = meta.value
  if (m) {
    return {
      id: skillId.value,
      name: m.skill?.name || skillId.value,
      category: m.skill?.category || '—',
      agentId: m.parentAgent?.id || '',
      agentName: m.parentAgent?.name || m.parentAgent?.id || ''
    }
  }
  return null
})
const notFound = ref(false)
const loading = ref(false)

const heroSub = computed(() => {
  const v = view.value
  if (!v) return ''
  const who = v.agentName || v.agentId || '—'
  return `${who} · ${v.category}`
})

/* ===== hero pills ===== */
const stat = computed(() =>
  skillId.value ? skillStatOf(skillId.value) : { calls: 0, errors: 0, avgMs: 0, lastAt: '从未' }
)
/** 头部健康徽章三分态（与 Skills.vue / SkillDrawer 同口径）：异常 / 空闲（0 调用）/ 健康 */
const healthBadge = computed<{ cls: string; text: string; title: string }>(() => {
  if (stat.value.errors > 0) {
    return { cls: 'mk-badge--bad', text: `${stat.value.errors} 次失败`, title: '窗口内存在失败调用' }
  }
  if (stat.value.calls === 0) {
    return { cls: 'mk-badge--muted', text: '空闲', title: '窗口内无调用（从未调用不等于健康）' }
  }
  return { cls: 'mk-badge--ok', text: '健康', title: '窗口内调用全部成功' }
})

/* ===== 生效 Prompt（协议页签 System Prompt 卡 + hero 版本 pill + 弹层预填） ===== */
interface EffectivePrompt { prompt?: { version?: number | string; name?: string; systemPrompt?: string } }
const prompt = ref<EffectivePrompt | null>(null)
const promptFailed = ref(false)
const promptVersionText = computed(() => {
  const p = prompt.value?.prompt
  if (!p) return ''
  return [p.version != null ? `v${String(p.version)}` : '', String(p.name || '')].filter(Boolean).join(' · ')
})
const promptStateText = computed(() => {
  if (promptFailed.value) return '加载失败'
  return promptVersionText.value ? `生效版本 ${promptVersionText.value}` : '生效版本加载中…'
})
const systemPromptText = computed(() => String(prompt.value?.prompt?.systemPrompt || ''))
/** 页内截断上限与 SkillDrawer 一致（slice(0, 1200)），完整内容在设计页 */
const PROMPT_CAP = 1200
const systemPromptCap = computed(() => systemPromptText.value.slice(0, PROMPT_CAP))
const promptLen = computed(() => systemPromptText.value.length)
const promptTruncated = computed(() => promptLen.value > PROMPT_CAP)

/* ===== 生效模型（hero pill + 运行时） ===== */
const modelLabel = computed(() => {
  const cfg = meta.value?.modelConfig || {}
  const llm = cfg.llmRequest || {}
  return String(llm.model || cfg.model || (cfg.tier ? `档位 ${String(cfg.tier)}` : '')) || ''
})

/* ===== 统计口径（运行时页签说明行；SkillDrawer statsSourceNote 同源） ===== */
const statsNote = computed(() => {
  const s = meta.value?.stats || {}
  if (!s.source) return ''
  const src =
    s.source === 'prompt_call_logs'
      ? 'Prompt 调用日志'
      : s.source === 'agent_call_logs'
        ? 'Skill 执行日志'
        : String(s.source)
  const range = s.range === 'all' ? '全量' : String(s.range || '全量')
  return `${src} · ${range}（与列表 / 拓扑统一）`
})

/* ===== 指标（运行时页签 metric 格；0 与未知分开） ===== */
const rateTone = computed(() => {
  if (!stat.value.calls) return 'na'
  if (stat.value.errors === 0) return 'ok'
  const r = ((stat.value.calls - stat.value.errors) / stat.value.calls) * 100
  return r >= 95 ? 'warn' : 'bad'
})
const successRate = computed(() => {
  if (!stat.value.calls) return '—'
  const r = ((stat.value.calls - stat.value.errors) / stat.value.calls) * 100
  return `${r.toFixed(1)}%`
})

const fmtMs = (ms: number | null | undefined) => (ms == null || ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

/* ===== 字段路由（协议页签输入/输出契约 + 字段路由页签表格） ===== */
interface FieldRow { fieldId: string; promptRole?: string; valueType?: string; description?: string }
interface RoutingRow { agentId: string; fieldId: string; render: string; handoff: string[]; internal: boolean; accumulate: boolean; notes?: string }
interface RoleMeta { id: string; label: string; hint?: string }
interface RoutingsData {
  stage?: string
  agentId?: string
  routings: RoutingRow[]
  fields: FieldRow[]
  promptRoleMeta?: RoleMeta[]
}
const routings = ref<RoutingsData | null>(null)
const routingsLoading = ref(false)
const routingsFailed = ref(false)

/** 输出方向角色（与 Orchestrator.vue 的 OUT_ROLES 同一套语义：对外可见或可供下游消费） */
const OUT_ROLES = ['proposal-output', 'public-reply', 'derived-presentation']
const contractIns = computed<FieldRow[]>(() => {
  const fs = routings.value?.fields || []
  return fs.filter((f) => !OUT_ROLES.includes(f.promptRole || ''))
})
const contractOuts = computed<FieldRow[]>(() => {
  const fs = routings.value?.fields || []
  return fs.filter((f) => OUT_ROLES.includes(f.promptRole || ''))
})

/** promptRole 人话：后端 yaml-vocabulary 单源下发（promptRoleMeta），前端不再各写一份 */
const roleLabel = (roleId?: string) => {
  if (!roleId) return '—'
  const m = (routings.value?.promptRoleMeta || []).find((x) => x.id === roleId)
  return m?.label || roleId
}
const roleCls = (roleId?: string) => (roleId ? `mk-badge--role-${roleId}` : 'mk-badge--muted')

/** 字段路由表格行（routings 产出行 ∪ fields 段详情） */
const routingRows = computed(() => {
  const fieldMap = new Map((routings.value?.fields || []).map((f) => [f.fieldId, f]))
  return (routings.value?.routings || []).map((r) => {
    const f = fieldMap.get(r.fieldId)
    const handoffText = (r.handoff || []).length ? r.handoff.join(' · ') : r.internal ? '内部' : '—'
    return {
      agentId: r.agentId,
      fieldId: r.fieldId,
      roleLabel: roleLabel(f?.promptRole),
      roleCls: roleCls(f?.promptRole),
      desc: r.notes || f?.description || '',
      handoffText,
      render: r.render === 'hidden' ? 'hidden' : 'visible',
      internal: !!r.internal,
      accumulate: !!r.accumulate
    }
  })
})
const routingRowsStateText = computed(() => {
  if (routingsLoading.value) return '加载中…'
  if (routingsFailed.value) return '加载失败'
  return `${routingRows.value.length} 行`
})

/* ===== Prompt 版本（版本页签；日期/作者后端未随列表返回，不渲染） ===== */
interface VersionItem { id: string; version: string | number; status: string; name: string }
const versions = ref<VersionItem[]>([])
const versionsLoading = ref(false)
const versionsFailed = ref(false)
const versionsStateText = computed(() => {
  if (versionsLoading.value) return '加载中…'
  if (versionsFailed.value) return '加载失败'
  return `共 ${versions.value.length} 个`
})
const versionStatusText = (s: string) => (s === 'ACTIVE' ? '生效' : s === 'DRAFT' ? '草稿' : s || '—')

/* ===== core 文件路径（工程页签；prompt-ops agent-overview 真实字段） ===== */
const coreFilePath = ref('')

/* ===== 总加载（各域独立容错：单域失败不拖垮整页，页签内给出局部错误态） ===== */
let loadSeq = 0
async function load(force = false) {
  const id = skillId.value
  if (!id) return
  if (loading.value && !force) return
  const seq = ++loadSeq
  loading.value = true
  notFound.value = false

  const guard = (ok: boolean) => seq === loadSeq && skillId.value === id && ok

  const jobs = [
    // workbench meta：归属 / 类别 / 生效模型 / 统计口径
    (async () => {
      try {
        const res = await adminSkillWorkbenchApi.getMeta(id)
        if (!guard(true)) return
        meta.value = (res.data?.data ?? res.data ?? null) as WorkbenchMeta | null
      } catch {
        if (guard(true)) meta.value = null
      }
    })(),
    // 生效 Prompt（协议页签 + hero 版本 pill）
    (async () => {
      promptFailed.value = false
      try {
        const res = await adminSkillsApi.getEffectiveSkillPrompt(id)
        if (!guard(true)) return
        prompt.value = (res.data?.data ?? res.data ?? null) as EffectivePrompt | null
      } catch {
        if (guard(true)) { prompt.value = null; promptFailed.value = true }
      }
    })(),
    // 模型配置表单（运行时页签）
    (async () => {
      await loadRuntimeConfig(id, (ok) => guard(ok))
    })(),
    // 字段路由（协议契约 + 字段路由页签）
    (async () => {
      routingsLoading.value = true
      routingsFailed.value = false
      try {
        const res = await adminFieldRoutingsApi.getSkillRoutings(id)
        if (!guard(true)) return
        routings.value = (res.data?.data ?? res.data ?? null) as RoutingsData | null
      } catch {
        if (guard(true)) { routings.value = null; routingsFailed.value = true }
      } finally {
        if (guard(true)) routingsLoading.value = false
      }
    })(),
    // Prompt 版本（版本页签）
    (async () => {
      versionsLoading.value = true
      versionsFailed.value = false
      try {
        const res = await adminAgentPromptsApi.getPromptVersions({ agentId: `skill:${id}` })
        if (!guard(true)) return
        const body = res.data?.data ?? res.data ?? []
        const items = Array.isArray(body) ? body : body.list || body.items || body.versions || []
        // ACTIVE 优先排前（布尔直转数字；勿写 Number(String(bool))——'true' → NaN 等于不排序）
        const sorted = [...(items as Array<Record<string, unknown>>)].sort(
          (a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')
        )
        versions.value = sorted.slice(0, 12).map((v: Record<string, unknown>) => ({
          id: String(v.id || ''),
          version: (v.version as string | number) ?? '—',
          status: String(v.status || '—'),
          name: String(v.name || '')
        }))
      } catch {
        if (guard(true)) { versions.value = []; versionsFailed.value = true }
      } finally {
        if (guard(true)) versionsLoading.value = false
      }
    })(),
    // core 文件路径（工程页签）
    (async () => {
      coreFilePath.value = ''
      try {
        const res = await adminPromptOpsApi.getAgentOverview()
        if (!guard(true)) return
        const items = (res.data?.data?.items || []) as Array<{ agentId?: string; file?: { path?: string } }>
        const found = items.find((x) => x.agentId === `skill:${id}` || x.agentId === id) || null
        coreFilePath.value = String(found?.file?.path || '')
      } catch {
        if (guard(true)) coreFilePath.value = ''
      }
    })()
  ]
  await Promise.all(jobs)
  if (seq !== loadSeq || skillId.value !== id) return
  loading.value = false
  // 身份双源（live 档案 / meta）都拿不到才算未找到：live boot 未完成时 meta 兜底
  if (!view.value) notFound.value = true
  else setSubPageLabel(view.value.name)
}

/* ===== 换技能（含深链 / 关闭）的复位 watch 统一放在文件尾：
   immediate 回调在 setup 期同步执行，必须排在全部状态声明之后（const 无提升）。 ===== */

/* ===== 治理动作：设计页跳转（深度编辑仍在 /admin/skills/:id，判例 SkillDrawer goPromptLab） ===== */
function goDesign(tabKey?: string) {
  const id = skillId.value
  closeSubPage()
  void router.push(`/admin/skills/${encodeURIComponent(id)}${tabKey ? `?tab=${tabKey}` : ''}`)
}

/** 最近调用行 → 执行日志 Trace（动线与 SkillDrawer goTrace 一致：先收详情再跳） */
function goTrace(traceId: string) {
  closeSubPage()
  openTrace(traceId)
}

/* ===== 最近调用（运行时页签；SkillDrawer 概览迁入） ===== */
const recent = computed(() => (skillId.value ? recentSpansOf(skillId.value) : []))
const statusDotLabel = (s: string) => (s === 'ok' ? '成功' : s === 'err' ? '失败' : '超时')

/* ===== 试跑（试跑页签；adminSkillsApi.testSkill 与设计页 trial-tab 同一接口） ===== */
const trialInput = ref('{\n  "input": "用一句话介绍你自己"\n}')
const trialRunning = ref(false)
const trialResult = ref<{ success?: boolean; duration?: number; cached?: boolean; output?: unknown; data?: unknown } | null>(null)
const trialError = ref('')
const trialOutputText = computed(() => {
  if (!trialResult.value) return ''
  const payload = trialResult.value.output ?? trialResult.value.data ?? trialResult.value
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
})
function resetTrial() {
  trialRunning.value = false
  trialResult.value = null
  trialError.value = ''
}
async function runTrial() {
  const id = skillId.value
  if (!id || trialRunning.value) return
  let payload: unknown
  try {
    payload = JSON.parse(trialInput.value || '{}')
  } catch (e) {
    trialError.value = `输入 JSON 不合法：${errMsg(e)}`
    return
  }
  trialRunning.value = true
  trialError.value = ''
  try {
    const res = await adminSkillsApi.testSkill(id, payload)
    if (id !== skillId.value) return
    trialResult.value = res.data?.data ?? res.data ?? null
  } catch (e) {
    if (id !== skillId.value) return
    trialResult.value = null
    trialError.value = `试跑失败：${errMsg(e)}`
  } finally {
    if (id === skillId.value) trialRunning.value = false
  }
}

/* ===== 模型配置（运行时页签；SkillDrawer 表单整体迁入，skill_model_configs CRUD） ===== */
interface RtForm {
  enabled: boolean
  tier: 'chat' | 'reasoning'
  model: string
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | 'low' | 'high' | 'max'
  requestTimeoutMs: number | null
}
const defaultRtForm = (): RtForm => ({
  enabled: false,
  tier: 'chat',
  model: '',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  requestTimeoutMs: null,
})
const rtForm = ref<RtForm>(defaultRtForm())
const rtSaving = ref(false)
const rtMsg = ref('')
const rtErr = ref(false)

async function loadRuntimeConfig(id: string, guard: (ok: boolean) => boolean) {
  try {
    const res = await adminSkillsApi.getSkillModelConfig(id)
    if (!guard(true)) return
    const raw = res.data?.data ?? res.data ?? {}
    rtForm.value = {
      enabled: raw?.enabled === true,
      tier: raw?.tier === 'reasoning' ? 'reasoning' : 'chat',
      model: raw?.model || '',
      thinkingMode: raw?.thinkingMode || 'default',
      reasoningEffort: raw?.reasoningEffort || 'default',
      requestTimeoutMs: raw?.requestTimeoutMs ?? null,
    }
  } catch {
    if (guard(true)) rtForm.value = defaultRtForm()
  }
  // 探测表单跟随当前生效配置（与 SkillDrawer syncProbeConfig 同语义）
  cfgThinking.value = rtForm.value.thinkingMode
  cfgEffort.value = rtForm.value.reasoningEffort
  probeForm.value = { thinkingMode: 'default', reasoningEffort: 'default' }
}

/** 配置卡「刷新」钮：click 事件不能当 id 传（vue-tsc 捕获的签名问题），显式包一层 */
function refreshRuntimeConfig() {
  const id = skillId.value
  if (!id || rtSaving.value) return
  void loadRuntimeConfig(id, (ok) => ok)
}

async function saveRuntimeConfig() {
  const id = skillId.value
  if (!id || rtSaving.value) return
  rtSaving.value = true
  rtMsg.value = ''
  rtErr.value = false
  try {
    await adminSkillsApi.updateSkillModelConfig(id, {
      tier: rtForm.value.tier,
      model: rtForm.value.model || undefined,
      thinkingMode: rtForm.value.thinkingMode,
      reasoningEffort: rtForm.value.thinkingMode === 'disabled' ? 'default' : rtForm.value.reasoningEffort,
      requestTimeoutMs: rtForm.value.enabled ? (rtForm.value.requestTimeoutMs ?? null) : null,
      enabled: rtForm.value.enabled,
    })
    rtMsg.value = '已保存（endpoint / 超时 / 思考档生效；model 以 ACTIVE Prompt 为准）'
    await loadRuntimeConfig(id, (ok) => ok)
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `保存失败：${errMsg(e)}`
  } finally {
    rtSaving.value = false
  }
}

async function resetRuntimeConfig() {
  const id = skillId.value
  if (!id || rtSaving.value) return
  rtSaving.value = true
  rtMsg.value = ''
  rtErr.value = false
  try {
    await adminSkillsApi.deleteSkillModelConfig(id)
    rtMsg.value = '已恢复默认（继承上层 / 平台）'
    await loadRuntimeConfig(id, (ok) => ok)
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `恢复失败：${errMsg(e)}`
  } finally {
    rtSaving.value = false
  }
}

/* ===== 模型测试（运行时页签；SkillDrawer model-probe 整体迁入） ===== */
interface ProbeForm {
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | 'low' | 'high' | 'max'
}
interface ProbeResult {
  durationMs?: number
  ttftContentMs?: number | null
  contentChars?: number
  completionTokens?: number | null
  finish?: string
  jsonOk?: string
  contentPreview?: string
  resolved?: { model?: string; thinkingMode?: string; reasoningEffort?: string }
}
const probeForm = ref<ProbeForm>({ thinkingMode: 'default', reasoningEffort: 'default' })
const cfgThinking = ref<'default' | 'enabled' | 'disabled'>('default')
const cfgEffort = ref<'default' | 'low' | 'high' | 'max'>('default')
const probeRunning = ref(false)
const probeError = ref('')
const probeResult = ref<ProbeResult | null>(null)

const cfgThinkingLabel = computed(() =>
  cfgThinking.value === 'enabled' ? '开启' : cfgThinking.value === 'disabled' ? '关闭' : '继承/默认'
)
const cfgEffortLabel = computed(() => (cfgEffort.value === 'default' ? '继承/默认' : cfgEffort.value))
const probeResolved = computed(() => probeResult.value?.resolved || null)

function resetProbe() {
  probeRunning.value = false
  probeError.value = ''
  probeResult.value = null
  probeForm.value = { thinkingMode: 'default', reasoningEffort: 'default' }
}

async function runModelProbe() {
  const id = skillId.value
  if (!id || !view.value || probeRunning.value) return
  probeRunning.value = true
  probeError.value = ''
  probeResult.value = null
  try {
    const res = await adminSkillsApi.modelProbe(id, {
      thinkingMode: probeForm.value.thinkingMode,
      reasoningEffort: probeForm.value.reasoningEffort,
    })
    if (id !== skillId.value) return
    const body = res.data?.data ?? res.data ?? {}
    if (body.thinkingMode !== 'default' && (body.thinkingMode as string) !== cfgThinking.value) {
      body.thinkingMode = probeForm.value.thinkingMode
    }
    probeResult.value = body
  } catch (e) {
    if (id !== skillId.value) return
    probeError.value = `探测失败：${errMsg(e)}`
  } finally {
    if (id === skillId.value) probeRunning.value = false
  }
}

/* ===== 换技能（含深链 / 关闭）：全量复位 + 重拉（判例 PathDetail 的 pathId watch）。
   声明位置约束：immediate 回调在 setup 期同步执行，本 watch 必须排在全部状态声明之后
   （resetTrial/resetProbe 是函数声明可提升，rtMsg/probeForm 等 const 不行）。 */
watch(
  skillId,
  (id) => {
    loadSeq += 1
    meta.value = null
    prompt.value = null
    promptFailed.value = false
    routings.value = null
    routingsLoading.value = false
    routingsFailed.value = false
    versions.value = []
    versionsLoading.value = false
    versionsFailed.value = false
    coreFilePath.value = ''
    notFound.value = false
    tab.value = 'protocol'
    resetTrial()
    resetProbe()
    rtMsg.value = ''
    if (id) void load()
  },
  { immediate: true }
)

/* ===== Prompt 编辑弹层（原型 openPromptModal；外壳走共享 .mk-modal 原语，wide 档） ===== */
const pmOpen = ref(false)
const pmText = ref('')
const pmNote = ref('')
const pmMaskRef = ref<HTMLElement | null>(null)
const pmPanelRef = ref<HTMLElement | null>(null)

function openPromptModal() {
  pmText.value = systemPromptText.value
  pmNote.value = ''
  pmOpen.value = true
}
function closePromptModal() {
  pmOpen.value = false
}
/* 弹层开合行为四件套：Esc（栈顶优先）/ 遮罩 / 焦点陷阱 / 滚动锁（判例 PathDetail 任务弹层） */
useOverlay(computed(() => pmOpen.value), pmPanelRef)
useMaskClose(pmMaskRef, closePromptModal)
useEscape(() => pmOpen.value, closePromptModal)
/* 页面级 Esc：弹层未开时 Esc 关详情页（关闭 = 清 ?view=&id= 回列表，判例二级页范式） */
useEscape(
  () => !pmOpen.value,
  () => { if (subPage.value?.view === 'skill') closeSubPage() }
)
</script>

<style scoped>
.skd { gap: 16px; }
/* 骨架版式（形状）走 MkSkeleton；本类只管外层堆叠 */
.skd-skel { display: grid; gap: 14px; padding-top: 8px; }

/* ===== 页签卡（原型：单张卡 subtabs + subpane） ===== */
.skd-body { overflow: clip; }
.skd-pane { display: grid; gap: 12px; padding: 16px; border-top: 1px solid var(--mk-line); }
.skd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.skd-grid > .mk-card { box-shadow: none; }
.skd-pad { padding: 12px 16px; display: grid; gap: 10px; align-content: start; }
.skd-stack { display: grid; gap: 12px; }

/* ===== 协议：vrow 契约行（原型 protoRow：mono 名 + 方向 pill + 描述 + 类型 + 必填 pill） ===== */
.skd-rows { display: grid; gap: 0; }
.skd-vrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--mk-line);
  min-width: 0;
}
.skd-vrow:last-child { border-bottom: 0; }
.skd-vrow__name { font-weight: 700; flex: none; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skd-vrow__desc { flex: 1; min-width: 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skd-vrow__type { flex: none; color: var(--mk-muted); font-size: var(--mk-fs-micro); }

/* ===== 代码井（原型 .code：深底 mono 块；System Prompt / 试跑输出 / 探测预览共用） ===== */
.skd-code {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-code-bg);
  border: 1px solid var(--mk-code-border);
  color: var(--mk-code-fg);
  font: 12px/1.65 var(--mk-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}
.skd-code--tall { max-height: 320px; }
.skd-code--short { max-height: 160px; font-size: var(--mk-fs-micro); }

/* ===== 试跑 ===== */
.skd-ta { width: 100%; }
.skd-ta-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.skd-error { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-red); font-weight: 600; }

/* ===== 版本 / 字段路由表格（原型 .tbl 包壳） ===== */
.skd-tablewrap { overflow-x: auto; }
.skd-tablewrap .mk-table td { white-space: nowrap; }
.skd-tablewrap .mk-table .skd-td-wrap { white-space: normal; min-width: 160px; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.skd-tablewrap .mk-table th.skd-th-wrap { white-space: normal; }
.skd-na, .mk-na { color: var(--mk-faint); }

/* ===== 运行时：指标格（原型 metricCard 四格） ===== */
.skd-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl); overflow: hidden; background: var(--mk-surface); }
.skd-metric { display: grid; gap: 4px; padding: 12px 16px; }
.skd-metric + .skd-metric { border-left: 1px solid var(--mk-line); }
.skd-metric__label { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.skd-metric__value {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-emphasis);
  font-weight: 600;
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
}
.skd-metric__value.is-bad { color: var(--mk-red); }
.skd-metric__value.is-ok { color: var(--mk-green); }
.skd-metric__value.is-warn { color: var(--mk-amber); }
.skd-metric__value.is-na { color: var(--mk-faint); }

/* ===== 运行时：模型配置表单（SkillDrawer mt-* 迁入，统一 skd- 前缀） ===== */
.skd-check {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.skd-check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.skd-check em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
.skd-fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.skd-field { display: grid; gap: 4px; min-width: 0; }
.skd-field > span { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.skd-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 5px; }
.skd-msg { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-green); font-weight: 600; }
.skd-msg.is-err { color: var(--mk-red); }
.skd-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.skd-btn--danger { color: var(--mk-red); border-color: rgba(220, 38, 38, 0.35); background: transparent; }
.skd-btn--danger:hover { background: var(--mk-red-bg); }
.skd-resolved {
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  border: 1px dashed var(--mk-line);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.skd-probe {
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
}
.skd-probe.is-ok { border-color: rgba(34, 197, 94, 0.35); }
.skd-probe.is-bad { border-color: rgba(220, 38, 38, 0.35); }
.skd-probe__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.skd-probe__grid > div { display: grid; gap: 2px; min-width: 0; }
.skd-probe__grid span { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.skd-probe__grid strong { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
.skd-probe__grid strong.is-ok { color: var(--mk-green); }
.skd-probe__grid strong.is-bad { color: var(--mk-red); }

/* ===== 运行时：最近调用行（SkillDrawer msk__row 迁入：状态点 + 标题 + 耗时） ===== */
.skd-call {
  display: grid;
  grid-template-columns: 8px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--mk-line);
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-micro);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.skd-call:last-child { border-bottom: 0; }
.skd-call:hover { background: var(--mk-surface-2); }
.skd-dot { width: 7px; height: 7px; border-radius: 50%; }
.skd-dot.is-ok { background: var(--mk-green); }
.skd-dot.is-warn { background: var(--mk-amber); }
.skd-dot.is-err { background: var(--mk-red); }
.skd-call__title { font-weight: 500; color: var(--mk-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skd-call__ms { color: var(--mk-muted); font-size: var(--mk-fs-micro); font-variant-numeric: tabular-nums; }

/* ===== 说明行（原型 .note 词汇） ===== */
.skd-note { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.skd-note--flat { padding: 0; }
.skd-none { margin: 0; color: var(--mk-faint); font-size: var(--mk-fs-micro); }

/* ===== Prompt 弹层（原型 modal--wide；面板宽走 .mk-modal__panel--wide 原语） ===== */
.skd-pm__body { display: grid; gap: 14px; }
.skd-hint { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* ===== 大屏/4K 适配（全站 mk 体系档位） ===== */
@media (min-width: 2000px) {
  .skd-vrow__name { font-size: var(--mk-fs-micro); }
  .skd-metric__value { font-size: var(--mk-fs-emphasis); }
  .skd-call { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .skd-vrow__name { font-size: var(--mk-fs-micro); }
  .skd-metric__value { font-size: var(--mk-fs-emphasis); }
  .skd-call { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .skd-vrow__name { font-size: var(--mk-fs-body); }
  .skd-metric__value { font-size: 26px; }
  .skd-call { font-size: var(--mk-fs-emphasis); }
  .skd-call__ms { font-size: var(--mk-fs-body); }
}
</style>
