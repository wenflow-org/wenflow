<template>
  <!-- ===== 加载完成：原型 renderSkillDetail 的完整版式 =====
       hero（头像「S」+ 技能名 + 归属 Agent · 类别副文 + 健康/类别/模型/版本 pills + 动作）
       → 单张卡承载 MkSubTabs（6 页签：协议/试跑/版本/运行时/工程/字段路由，原型 dtab 组 skill）
       → 各页签内容卡（原型卡片/表格/代码块词汇）。
       Prompt 编辑是弹层（原型 openPromptModal：modal modal--wide），不是页签。 -->
  <div v-if="view" class="mk-page skd">
    <!-- 身份以**英文 canonical id** 为主（用户拍板 2026-10-14：中文名只是别名，且代码注册表与声明源
         实测 17/34 不同名，拿中文当身份会认错技能——如当时显示的「学习路径规划」并不是声明源里的名字）；
         中文名降为副行别名，只出现一次。 -->
    <MkDetailHero avatar="S" :title="view.id" :sub="heroSub">
      <template #pills>
        <!-- 健康徽标：带窗口词（「N 次失败」不带窗口会被读成全量，评审「窗口冒充全量」）且可点
             → 运行时页签（健康+证据先于配置，评审「结论埋深」） -->
        <button type="button" class="mk-badge skd-badge-btn" :class="healthBadge.cls" :title="healthBadge.title" @click="goRuntimeTab">{{ healthBadge.text }}</button>
        <!-- 类别人话（Skills.vue:194 同字段判例）：裸枚举 teaching → 「教学」，title 保留原值备查 -->
        <span class="mk-badge mk-badge--muted" :title="`类别：${view.category}（来源：${view.categorySource}）`">{{ categoryText(view.category) }}</span>
        <!-- 2026-10-24 用户「还是重复部分」：生效模型只在运行时「生效值」里出现一次（带来源），
             hero 不再重复一枚模型徽标——同一页同一事实两处读数。 -->
        <span v-if="promptVersionText" class="mk-badge mk-badge--info">线上生效 {{ promptVersionText }}</span>
      </template>
      <!-- 2026-10-23：详情各域跟随顶栏刷新广播（liveRefreshSeq → load(true)），hero 不再出刷新钮 -->
    </MkDetailHero>

    <!-- 页签卡（原型：单张卡内 subtabs + subpane）。
         2026-10-15 设计页平铺：每个页签 = 上方「只读概览（本页原有区块）」+ 下方「设计页可编辑区块」
         （skill-design/*-tab 子组件）。重复先留着（用户拍板「先平铺」）。
         visited + v-show 惰性挂载（原设计页 #128 判例）：首次激活才挂载、之后保状态。 -->
    <section class="mk-card skd-body">
      <MkSubTabs :tabs="TABS" v-model="tab" />
      <div class="skd-pane">
        <!-- ========== 协议（原型 protocol：输入/输出契约 vrow + System Prompt 代码卡） ========== -->
        <div v-if="designTabShown('protocol')" v-show="tab === 'protocol'" class="skd-bloc">
          <div class="skd-grid">
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">输入契约</h3>
                <span class="mk-card__meta">{{ contractIns.length }} 字段</span>
              </div>
              <div class="skd-pad skd-rows">
                <MkLoading v-if="routingsLoading && !routings" inline text="字段契约加载中…" />
                <template v-else-if="routingsNotApplicable">
                  <p class="mk-empty--line">{{ AUX_CONTRACT_NA_TEXT }}</p>
                </template>
                <template v-else-if="routingsFailed">
                  <div class="mk-alert mk-alert--row" role="alert">
                    <span class="mk-alert__msg">字段契约加载失败。</span>
                    <button type="button" class="mk-alert__btn" @click="load(true)">重试</button>
                  </div>
                </template>
                <template v-else>
                  <div v-for="f in contractIns" :key="f.fieldId" class="skd-vrow">
                    <span class="mono skd-vrow__name" :title="f.fieldId">{{ f.fieldId }}</span>
                    <span class="mk-badge mk-badge--info">入参</span>
                    <span class="skd-vrow__desc" :title="f.description || ''">{{ f.description || '—' }}</span>
                    <span class="mono skd-vrow__type">{{ f.valueType || '—' }}</span>
                    <!-- #131：改用与输出契约同一单源 roleLabel(f.promptRole)，不再用二值
                         「必填/可选」覆盖真实 promptRole（隐式推断/控制信号等被一律译成「可选」） -->
                    <span class="mk-badge" :class="roleCls(f.promptRole)">{{ roleLabel(f.promptRole) }}</span>
                    <span v-if="f.promptRole === 'hard-required'" class="mk-badge mk-badge--warn">必填</span>
                  </div>
                  <p v-if="!contractIns.length" class="mk-empty--line">该 Skill 暂无输入字段声明（无编排路由或全部为产出字段）。</p>
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
                <template v-else-if="routingsNotApplicable">
                  <p class="mk-empty--line">{{ AUX_CONTRACT_NA_TEXT }}</p>
                </template>
                <template v-else-if="routingsFailed">
                  <div class="mk-alert mk-alert--row" role="alert">
                    <span class="mk-alert__msg">字段契约加载失败。</span>
                    <button type="button" class="mk-alert__btn" @click="load(true)">重试</button>
                  </div>
                </template>
                <template v-else>
                  <div v-for="f in contractOuts" :key="f.fieldId" class="skd-vrow">
                    <span class="mono skd-vrow__name" :title="f.fieldId">{{ f.fieldId }}</span>
                    <span class="mk-badge mk-badge--ok">出参</span>
                    <span class="skd-vrow__desc" :title="f.description || ''">{{ f.description || '—' }}</span>
                    <span class="mono skd-vrow__type">{{ f.valueType || '—' }}</span>
                    <span class="mk-badge mk-badge--muted">{{ roleLabel(f.promptRole) }}</span>
                  </div>
                  <p v-if="!contractOuts.length" class="mk-empty--line">该 Skill 暂无产出字段声明。</p>
                </template>
              </div>
            </section>
          </div>
          <!-- 回合状态机：原型 renderSkillDetail 2384-2386（.steps/.step 圆点序列）；core YAML 无该字段 → 空态 -->
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">回合状态机</h3>
              <span class="mk-card__meta">{{ coreStateNodes.length ? `${coreStateNodes.length} 个状态` : '无状态机声明' }}</span>
            </div>
            <div class="skd-pad">
              <div v-if="coreStateNodes.length" class="skd-steps">
                <!-- #148：不再把第 1 个节点无条件标成「当前」——core YAML 无 stateMachine/states
                     字段（也无「当前态」数据源），aria-current 与蓝染是自造状态；
                     状态机只作序列展示，真实当前态等后端字段下发后再着色 -->
                <div
                  v-for="(n, i) in coreStateNodes"
                  :key="`${n}-${i}`"
                  class="skd-step"
                >
                  <span class="skd-step__n">{{ i + 1 }}</span>{{ n }}
                </div>
              </div>
              <p v-else class="mk-empty--line" title="core YAML 未声明 stateMachine / states 字段">该 Skill 未声明回合状态机。</p>
            </div>
          </section>
          <div class="skd-grid">
            <!-- 终止条件：原型 renderSkillDetail 2388-2390（.ranklist/.rankrow）；core YAML 无该字段 → 空态 -->
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">终止条件</h3>
              </div>
              <div class="skd-pad">
                <div v-if="coreTerminations.length" class="skd-ranklist">
                  <div v-for="(t, i) in coreTerminations" :key="`${t}-${i}`" class="skd-rankrow">{{ t }}</div>
                </div>
                <p v-else class="mk-empty--line" title="core YAML 未声明 termination / limits 字段">该 Skill 未声明终止条件。</p>
              </div>
            </section>
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">System Prompt</h3>
                <div class="mk-card__head-right">
                  <span class="mk-card__meta">{{ promptStateText }}</span>
                  <button type="button" class="mk-btn mk-btn--sm" @click="openPromptModal">查看 Prompt</button>
                </div>
              </div>
              <div class="skd-pad">
                <pre class="skd-code">{{ systemPromptCap || (promptFailed ? '生效 Prompt 加载失败，请刷新重试。' : '暂无生效 Prompt。') }}</pre>
                <p v-if="promptTruncated" class="mk-card__note">已截断：仅显示前 1200 字（共 {{ promptLen }} 字），完整内容见本页签的核心文件编辑器。</p>
              </div>
            </section>
          </div>
          <!-- 设计页「协议」内容（核心 YAML 编辑与发布 + 编译预览 + 运行时契约投影） -->
          <ProtocolTab :skill-id="skillId" :reload-tick="coreReloadTick" @published="onPublished" />
        </div>

        <!-- ========== 试跑（原型 trial：样例输入 + 执行链路 + 输出 + 对比；唯一的输入/运行入口在 TrialTab） ========== -->
        <div v-if="designTabShown('trial')" v-show="tab === 'trial'" class="skd-bloc">
          <!-- 设计页「试跑」内容（表达试跑编辑器 + 当前生效 Prompt 参照 + 最近调用） -->
          <TrialTab
            :skill-id="skillId"
            :file-path="coreFilePath"
            :refresh-tick="refreshTick"
            @failures="recentFailures = $event"
            @dirty="(d) => onTabDirty('trial', d)"
          />
        </div>

        <!-- ========== 版本（原型 versions：.tbl 表格；日期/作者/变更说明有字段才补列） ========== -->
        <div v-if="designTabShown('versions')" v-show="tab === 'versions'" class="skd-bloc">
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">Prompt 版本</h3>
              <div class="mk-card__head-right">
                <span class="mk-card__meta">{{ versionsStateText }}</span>
              </div>
            </div>
            <div class="skd-tablewrap">
              <table v-if="versions.length" class="mk-table">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>名称</th>
                    <!-- 原型 versions 表含 日期/作者/变更说明（index.html 2344-2346）：列表返回了才补列，空则省略 -->
                    <th v-if="hasVersionMeta">日期</th>
                    <th v-if="hasVersionMeta">作者</th>
                    <th v-if="hasVersionMeta" class="skd-th-wrap">变更说明</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="v in versions" :key="v.id">
                    <td class="mono">v{{ v.version }}</td>
                    <td>{{ v.name || '—' }}</td>
                    <td v-if="hasVersionMeta" class="mono">{{ fmtDate(v.createdAt) }}</td>
                    <td v-if="hasVersionMeta">{{ v.createdBy || '—' }}</td>
                    <td v-if="hasVersionMeta" class="skd-td-wrap" :title="versionDescTitle(v)">{{ versionDescText(v) }}</td>
                    <td><span class="mk-badge" :class="v.status === 'ACTIVE' ? 'mk-badge--ok' : 'mk-badge--muted'">{{ versionStatusText(v.status) }}</span></td>
                  </tr>
                </tbody>
              </table>
              <div class="skd-pad" v-else>
                <MkLoading v-if="versionsLoading" inline text="版本加载中…" />
                <div v-else-if="versionsFailed" class="mk-alert mk-alert--row" role="alert">
                  <span class="mk-alert__msg">版本列表加载失败。</span>
                  <button type="button" class="mk-alert__btn" @click="load(true)">重试</button>
                </div>
                <p v-else class="mk-empty--line">暂无 Prompt 版本记录。</p>
              </div>
            </div>
          </section>
          <!-- 设计页「版本」内容（在线变体 A/B + 核心文件版本回滚 + Prompt 版本 diff） -->
          <VersionsTab
            :skill-id="skillId"
            :refresh-tick="refreshTick"
            @core-rolled-back="onCoreRolledBack"
            @dirty="(d) => onTabDirty('versions', d)"
          />
        </div>

        <!-- ========== 运行时（原型 runtime：指标卡 + 模型与路由 + 保存配置；SkillDrawer 的配置/探测/最近调用迁入此页签） ========== -->
        <div v-if="designTabShown('runtime')" v-show="tab === 'runtime'" class="skd-bloc">
          <!-- 原型 renderSkillDetail 2349-2350：4 张独立 metricCard（KPI label/value/foot）。
               审核 #146：原页内私有 .skd-metric（与 MkKpi 同解剖，值档/4K 档各成一套）收编共享
               MkKpi + .mk-kpi-grid，档位由原语自带。
               2026-10-16 KPI 审计补完：四张卡此前完全没有窗口词（同页「N 次失败」徽标却带窗口），
               数字会被读成全量。窗口词挂读数带头一次，不在四张卡上各说一遍（同一口径不复读四行）。 -->
          <div class="skd-metric-band">
            <div class="mk-section__head">
              <h4 class="mk-section__title">运行指标</h4>
              <span class="mk-card__meta">{{ statsRangeLabel }}</span>
            </div>
            <section class="mk-kpi-grid" aria-label="运行指标">
              <MkKpi label="调用次数" :value="stat.calls" />
              <MkKpi label="失败" :value="stat.calls ? stat.errors : '—'" :tone="stat.calls > 0 && stat.errors > 0 ? 'bad' : ''" />
              <MkKpi label="成功率" :value="successRate" :tone="rateTone" />
              <MkKpi label="平均耗时" :value="stat.calls ? fmtMs(stat.avgMs) : '—'" />
            </section>
          </div>
          <p v-if="statsNote" class="mk-card__note">统计来源：{{ statsNote }}</p>
          <!-- 运行时限制 / 模型配置 / 模型测试三张卡 2026-10-19 从本页删除：
               它们与下方 RuntimeTab（设计区块）渲染的是同一套配置的第二份可编辑副本
               （同一份 skill_model_configs、两个独立表单各自保存），页面上同题两遍，
               而且各改各的互不可见。改由 RuntimeTab 单点承载（用户「要重新优化设计，
               参考模型接入的设计」）；本页只留只读读数：运行指标 + 最近调用。
               运行时限制那点信息（请求超时）在 RuntimeTab 的「生效值」胶囊与超时字段里已有。 -->
          <!-- 设计页「运行时」内容（路由层/生成参数/备用模型速览 + 完整运行时配置 + 模型测试） -->
          <RuntimeTab
            :skill-id="skillId"
            :refresh-tick="refreshTick"
            @dirty="(d) => onTabDirty('runtime', d)"
          />
          <!-- 最近调用（SkillDrawer「概览」迁入：点行跳执行日志 Trace） -->
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">最近调用</h3>
              <!-- #150：有数据时也带窗口口径——列表是日志采样窗口内的最近 5 条（store.recentSpansOf
                   默认 limit=5），裸「N 条」会被读成全量（同屏指标卡可能显示 27852 次调用） -->
              <span class="mk-card__meta">{{ recent.length ? `最近 ${recent.length} 条（近 7 天）` : '近 7 天记录' }}</span>
            </div>
            <div class="skd-pad skd-rows">
              <button v-for="s in recent" :key="s.id" type="button" class="skd-call" :title="recentRowTitle(s)" @click="goTrace(s.traceId)">
                <span class="skd-dot" :class="`is-${s.status}`" role="img" :aria-label="statusDotLabel(s.status)" :title="statusDotLabel(s.status)"></span>
                <span class="skd-call__title">{{ recentRowText(s) }}</span>
                <span class="mono skd-call__ms">{{ fmtMs(s.durationMs) }}</span>
              </button>
              <p v-if="!recent.length" class="mk-empty--line">近 7 天暂无该 Skill 的调用记录。指标由统计接口聚合，统计范围与列表不同，以指标卡为准。</p>
            </div>
          </section>
        </div>

        <!-- ========== 工程（原型 engineering：工程信息 kv；依赖与发布见下方 EngineeringTab） ========== -->
        <div v-if="designTabShown('engineering')" v-show="tab === 'engineering'" class="skd-bloc">
          <div class="skd-grid">
            <section class="mk-card">
              <div class="mk-card__head">
                <h3 class="mk-card__title">工程信息</h3>
              </div>
              <div class="skd-pad">
                <div class="mk-facts">
                  <div><span>Skill ID</span><strong class="mono" :title="view.id">{{ view.id }}</strong></div>
                  <div><span>归属 Agent</span><strong>{{ view.agentName || view.agentId || '—' }}</strong></div>
                  <div><span>类别</span><strong :title="`类别枚举：${view.category}（来源：${view.categorySource}）`">{{ categoryText(view.category) }}</strong></div>
                  <div v-if="coreFilePath"><span>核心文件</span><strong class="mono" :title="coreFilePath">{{ coreFilePath }}</strong></div>
                  <div><span>统计来源</span><strong>{{ statsNote || '—' }}</strong></div>
                </div>
              </div>
            </section>
          </div>
          <!-- 设计页「工程」内容（基础信息 + 依赖与发布 + 运行时契约 + 协议视图 + Skill 规则总览）。
               2026-10-23 走查：顶部原本还有一张「依赖与发布」卡，与 EngineeringTab 里的同名区块
               同源同内容，同一页签出现两遍；卡片版撤除，依赖 chips / 发布链只留 EngineeringTab 一处。 -->
          <EngineeringTab v-if="overviewItem" :skill-id="skillId" :overview="overviewItem" />
        </div>

        <!-- ========== 字段路由（原型 fields：字段流转表格 + note）
             列形差异：原型 5 列 = 字段/来源/目标/转换规则/脱敏（index.html 2374-2377）；
             本表 6 列把「来源+目标」并在「流向」、把脱敏并进属性 badges；仅当后端下发 masked 布尔才补「脱敏」列。 ========== -->
        <div v-if="designTabShown('routing')" v-show="tab === 'routing'" class="skd-bloc">
          <section class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">字段路由</h3>
              <div class="mk-card__head-right">
                <span class="mk-card__meta">{{ routingRowsStateText }}</span>
              </div>
            </div>
            <div class="skd-tablewrap">
              <table v-if="routingRows.length" class="mk-table">
                <thead>
                  <tr>
                    <th>字段</th><th>角色</th><th class="skd-th-wrap">说明</th><th>流向</th><th>渲染</th><th>属性</th>
                    <th v-if="hasMaskedCol">脱敏</th>
                  </tr>
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
                    <td v-if="hasMaskedCol">
                      <span class="mk-badge" :class="r.masked ? 'mk-badge--warn' : 'mk-badge--muted'">{{ r.masked ? '已脱敏' : '明文' }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="skd-pad" v-else>
                <MkLoading v-if="routingsLoading" inline text="字段路由加载中…" />
                <p v-else-if="routingsNotApplicable" class="mk-empty--line">该 Skill 为辅助类（无编排阶段归属），字段路由不适用。</p>
                <div v-else-if="routingsFailed" class="mk-alert mk-alert--row" role="alert">
                  <span class="mk-alert__msg">字段路由加载失败。</span>
                  <button type="button" class="mk-alert__btn" @click="load(true)">重试</button>
                </div>
                <p v-else class="mk-empty--line">该 Skill 暂无产出行（无编排路由声明）。</p>
              </div>
            </div>
            <div class="skd-pad">
              <p class="mk-card__note">标注「内部」的字段不进入用户可见回复。</p>
            </div>
          </section>
          <!-- 设计页「字段路由」内容（字段影响范围血缘 + 加字段向导） -->
          <RoutingTab :skill-id="skillId" />
        </div>
      </div>
    </section>

    <!-- ===== Prompt 弹层（原型 openPromptModal：modal modal--wide；草稿保存/发布在设计页完成） ===== -->
    <Teleport to="body">
      <div v-if="pmOpen" ref="pmMaskRef" class="mk-modal">
        <div ref="pmPanelRef" class="mk-modal__panel mk-modal__panel--wide skd-pm" role="dialog" aria-modal="true" aria-label="编辑 Prompt">
          <div class="mk-modal__head">
            <h2 class="mk-modal__title">编辑 Prompt · {{ view?.name }}</h2>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closePromptModal">✕</button>
          </div>
          <div class="mk-modal__body skd-pm__body">
            <!-- #135：此处是「起草」区，草稿不再随关闭/跳转静默丢弃——关闭或跳设计页前写
                 sessionStorage（skd-prompt-draft:<skillId>），下次打开自动恢复并提示；另给「复制」带走 -->
            <p v-if="pmDraftRestored" class="skd-draft-note" role="status">
              已恢复上次未提交的草稿（{{ pmDraftSavedAt }}）。「前往核心文件编辑」不会携带草稿，可先「复制内容」。
            </p>
            <label class="skd-field">
              <span>system</span>
              <textarea v-model="pmText" class="mk-input mono skd-ta" rows="12" spellcheck="false"></textarea>
            </label>
            <label class="skd-field">
              <span>变更说明</span>
              <input v-model="pmNote" class="mk-input" placeholder="例如：优化诊断追问策略" />
              <em class="skd-hint">Prompt 内容以源文件为准。</em>
            </label>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="copyPromptDraft">复制内容</button>
            <button type="button" class="mk-btn" @click="closePromptModal">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" @click="goDesignWithDraft()">前往核心文件编辑 →</button>
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
 * → 单张卡内 6 个 subtab（运行时 / 协议 / 试跑 / 版本 / 工程 / 字段路由；2026-10 可读性批把运行时置首：
 *   健康+证据先于配置；页签写/读 ?tab=，深链/刷新可寻址）
 * → Prompt 编辑是弹层（openPromptModal：modal modal--wide），不是页签。
 * 数据口径：全部来自现有接口的真实字段——live 注册表档案 + workbench meta +
 * effective-prompt + skill_model_configs + model-probe + 字段路由 + Prompt 版本 + core YAML；
 * 原型有而后端没有数据源的展示项一律空态并注明来源缺失（回合状态机 / 终止条件 / 执行链路 /
 * 试跑对比 / 依赖 chips / 四段发布流 / 脱敏列 / 版本日期作者），绝不硬造：
 *  - 回合状态机 / 终止条件 / 依赖 chips：防御式读 core YAML（stateMachine/states/termination/limits/inputs），
 *    当前 CoreFile schema 无这些字段 → 空态；
 *  - 执行链路 / 试跑对比：testSkill 仅回 output/success/duration → 执行链路空态、试跑对比整卡省略；
 *  - 四段发布流：后端无阶段状态接口 → 空态；
 * 功能口径：SkillDrawer 的四页签能力全部迁入对应页签（概览→运行时指标+最近调用、
 * Prompt→协议页签 System Prompt 卡、模型配置/模型测试→运行时页签）。
 * 2026-10-15：独立「Skill 设计页」退役，其可编辑六页签内容**平铺进本页**——
 * 每个页签 = 上方只读概览（本页原有区块）+ 下方设计区块（skill-design/*-tab 子组件），
 * 重复暂留（用户拍板「先平铺」）；脏态守卫（协议编辑器 / 运行时 / 试跑 / 版本）见文件尾。
 * /admin/skills/:agentId 与 /admin/skill-workbench/:agentId 深链已重定向到本页。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { subPage, closeSubPage, setSubPageLabel, skillStatOf, recentSpansOf, openTrace, type TraceSpan } from './store'
import { liveSkillProfiles, liveExtraProfiles, liveSkillStatsRange, liveRefreshSeq } from './live'
/* P2-15（设计评审）：版本状态走共享字典（与设计页 versions-tab 同域同词：ARCHIVED→已归档），
   删本页本地 versionStatusText（只映射 ACTIVE/DRAFT，ARCHIVED 直出英文） */
import { categoryText, errorCategoryText, versionStatusText } from './statusText'
import { errorCodeLabel } from './terms'
import { successRateText, successRateTone } from './rate-utils'
import {
  adminSkillsApi,
  adminSkillWorkbenchApi,
  adminFieldRoutingsApi,
  adminAgentPromptsApi,
  adminPromptOpsApi,
  adminPromptWorkbenchApi
} from '@/api/adminApi'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
/* 设计页能力平铺（2026-10-15 用户拍板：独立设计页退役，内容就地铺进本页）——
   6 个 tab 正文是自包含子组件（各自 scoped 样式），直接挂到本页各页签只读区块下方。
   各子组件的脏态经 @dirty 上报，离开守卫见文件尾（原 SkillDesignPage 的守卫整套迁入）。 */
import { coreEditorState, type TrialInputDecl } from './skill-design/sdp-shared'
import ProtocolTab from './skill-design/protocol-tab.vue'
import TrialTab from './skill-design/trial-tab.vue'
import VersionsTab from './skill-design/versions-tab.vue'
import RuntimeTab from './skill-design/runtime-tab.vue'
import EngineeringTab from './skill-design/engineering-tab.vue'
import RoutingTab from './skill-design/routing-tab.vue'

/* 文案单源：输入/输出契约两块空态共用一句（R6 复读单源化）；思考模式/思考强度
   两个下拉的继承项共用一句。 */
const AUX_CONTRACT_NA_TEXT = '该 Skill 为辅助类（无编排阶段归属），字段契约不适用。'

/* ===== 6 页签（运行时置首：健康+证据先于配置，评审「结论埋深」）
   #149：键与设计页 ?tab= 深链键真对齐——「字段路由」设计页键是 routing，本页原写 fields
   导致跨页互跳时该档丢失（被归一到默认档）。现统一为 routing；已分享的旧链 ?tab=fields
   由 normalizeSkdTab 做别名兼容，不失效。 ===== */
const TABS: Array<{ key: string; label: string }> = [
  { key: 'runtime', label: '运行时' },
  { key: 'protocol', label: '协议' },
  { key: 'trial', label: '试跑' },
  { key: 'versions', label: '版本' },
  { key: 'engineering', label: '工程' },
  { key: 'routing', label: '字段路由' }
]
const DEFAULT_TAB = 'runtime'
const tab = ref(DEFAULT_TAB)

/* ?skdTab= 写/读（tab 路由化，判例 LearnerDetail P0-2 / Orchestrator ?stage=&tab=）：
   深链/刷新/前进后退保持所在页签——此前页签不写 URL，刷新即回协议页。
   #133：键必须与宿主列表页 Skills 的 ?tab=（run/prompt-eval）分开——
   本页在 /admin/skills?view=skill&id=… 上，与列表共用一个 ?tab= 会互相覆盖
   （详情内切页签 → 列表键被写成 versions → Esc 关闭后列表被静默重置为「Skill 运行」）。 */
const tabRoute = useRoute()
const TAB_KEYS = new Set(TABS.map((t) => t.key))
/** #149：旧深链别名——本页「字段路由」历史键 fields（设计页键是 routing），
    归一读取以免已分享链接失效；写回一律用 routing */
const TAB_ALIASES: Record<string, string> = { fields: 'routing' }
function normalizeSkdTab(t: unknown): string {
  if (typeof t !== 'string') return DEFAULT_TAB
  const key = TAB_ALIASES[t] || t
  return TAB_KEYS.has(key) ? key : DEFAULT_TAB
}
/* 2026-10-24 修键冲突：编排图用 ?tab=routing 表示「字段路由」子视图，本页也有同键页签。
   此前无 skdTab 时无条件回退读 ?tab=，从编排图点进详情会误落「字段路由」。
   现在只兼容宿主列表/旧链的历史键，且显式排除 routing。 */
const LEGACY_TAB_KEYS = new Set(['runtime', 'protocol', 'trial', 'versions', 'engineering', 'fields'])
/** 读：优先本页自己的 skdTab；旧深链（?tab=versions 等）仍兼容，但不读 routing */
function readTabFromQuery(): string {
  const q = tabRoute?.query
  const own = q?.skdTab
  if (typeof own === 'string') return normalizeSkdTab(own)
  const legacy = q?.tab
  if (typeof legacy === 'string' && LEGACY_TAB_KEYS.has(legacy)) return normalizeSkdTab(legacy)
  return DEFAULT_TAB
}
/** 写回键（#133）：URL 上已有「本页页签键」的 ?tab= 时属旧深链，继续写回同一键（向后兼容）；
    否则一律写本页独立键 skdTab，绝不动宿主列表的 run/prompt-eval */
function useLegacyTabKey(): boolean {
  const t = tabRoute?.query?.tab
  // 旧别名（fields）同样视为本页键；routing 归编排图，不认领（见上）
  return typeof t === 'string' && LEGACY_TAB_KEYS.has(t)
}
// URL → tab（深链/刷新/前进后退；route 可能缺位——二级页可被无路由宿主挂载，防御式读取）
watch(
  [() => tabRoute?.query?.skdTab, () => tabRoute?.query?.tab],
  () => {
    const v = readTabFromQuery()
    if (v !== tab.value) tab.value = v
  },
  { immediate: true }
)
// tab → URL（replace 不污染历史栈；缺省档不占 URL，与 Orchestrator overview 缺省不写同约定）
watch(tab, (t) => {
  if (!router) return
  // 无匹配路由的宿主（测试/嵌入场景）不做 URL 回写，避免 vue-router「No match」噪声
  if (!router.currentRoute.value.matched.length) return
  const key = useLegacyTabKey() ? 'tab' : 'skdTab'
  const cur = typeof tabRoute?.query?.[key] === 'string' ? (tabRoute.query[key] as string) : ''
  if (t === DEFAULT_TAB) {
    if (cur) void router.replace({ query: { ...tabRoute.query, [key]: undefined } }).catch(() => {})
  } else if (cur !== t) {
    void router.replace({ query: { ...tabRoute.query, [key]: t } }).catch(() => {})
  }
})

/** hero 健康徽标点击：跳运行时页签（健康+证据先于配置） */
function goRuntimeTab() {
  tab.value = 'runtime'
}

/* ===== 设计页能力平铺：每个页签下半部挂设计页子组件 =====
   #128 判例（原 SkillDesignPage）：已激活过的页签才挂载、之后 v-show 保状态——
   否则切页签会反复卸载重建子组件（编辑器草稿/表单态丢失），且各子组件 immediate watch
   会在首屏齐发请求。visited 随页签激活单调增长。 */
const visited = reactive(new Set<string>([DEFAULT_TAB]))
watch(tab, (t) => visited.add(t))
/** 子组件重拉信号：发布 / 回滚后自增，各 tab 子组件 watch 它重拉（与编辑器内容无关） */
const refreshTick = ref(0)
const coreReloadTick = ref(0)
/** 试跑页签上报的「近 8 条失败」计数（原设计页状态条用；本页暂无状态条，保留接收以免子组件报错） */
const recentFailures = ref(0)
/** 工程页签所需的完整 overview 条目（agent-overview 命中项；file/db/drift/runtimeContract 齐给）。
    形状与 skill-design/engineering-tab.vue 的 Overview 契约一致（该子组件按此取数）。 */
interface OverviewItem {
  kind: string
  agentId: string
  displayName?: string
  health?: string
  file?: { path?: string; hash?: string } | null
  db?: { id?: string; version?: number | string; hash?: string; useCount?: number; model?: string; publishedAt?: string } | null
  drift: 'in-sync' | 'file-vs-db-mismatch' | null
  runtimeContract?: Record<string, unknown> | null
  runtimeContractSource?: 'manifest' | 'default' | null
}
const overviewItem = ref<OverviewItem | null>(null)

/** 某一页签的设计能力是否已激活（决定是否挂载其子组件） */
const designTabShown = (key: string) => visited.has(key)

/* ===== 脏态多源登记（原 SkillDesignPage 整套迁入）=====
   coreEditorState 只管协议编辑器；运行时/试跑/版本等页签的未保存改动经 @dirty 上报。
   守卫按「任一处脏」拦截：进入别的 skill / 关闭本页 / 真正换 route record 时确认。 */
const tabDirty = reactive<Record<string, { dirty: boolean; label: string }>>({})
function onTabDirty(key: string, payload: { dirty: boolean; label: string }) {
  tabDirty[key] = payload
}
/** 当前所有未保存改动的来源（人话标签），空数组 = 无脏 */
function dirtyParts(): string[] {
  const parts: string[] = []
  if (coreEditorState.dirty) parts.push('协议编辑器')
  for (const v of Object.values(tabDirty)) if (v.dirty) parts.push(v.label)
  return parts
}
const anyDirty = () => dirtyParts().length > 0
const dirtySummary = () => dirtyParts().join('、')

/** 发布核心文件后：编辑态已落库 → 复位协议脏标记 + 触发各 tab 重拉 */
function onPublished() {
  coreEditorState.dirty = false
  refreshTick.value++
}
/** 核心文件回滚后：同上重拉（回滚本身已改库） */
function onCoreRolledBack() {
  refreshTick.value++
  coreReloadTick.value++
}

/* 脏态离开保护（2026-10-15 设计页迁入本页后沿用同一套机制）：
   「关闭本页」是同路由的 query 变化（closeSubPage 去掉 ?view/?id）+ 宿主 <component :key>
   立即卸载本页——异步确认根本来不及拦，脏改动会被静默丢弃。
   故用 flush:'sync' 的 watch：subPage 一变即**同步复原**（Vue 本轮渲染仍见到复原值，
   组件不卸载），再弹确认：
     - 取消：保持复原（留在页内），AdminConsole 的 subPage→URL watch 合并中间态，URL 无抖动；
     - 确认：置放行标记并真正关闭 / 切到目标 skill。
   真正的跨记录导航（登出、跳公开页）仍由下方 onBeforeRouteLeave 兜底；刷新/关窗由 beforeunload 兜底。 */
let allowLeave = false
watch(
  subPage,
  (sp, prev) => {
    if (allowLeave || !prev || prev.view !== 'skill') return
    const leaving = !sp || sp.view !== 'skill' || sp.id !== prev.id
    if (!leaving || !anyDirty()) return
    const target = sp // 想去哪：null=关闭；否则=新落点（切 skill 或跳别的二级页）
    subPage.value = prev // 同步复原，阻止卸载
    void (async () => {
      const ok = await askConfirm({
        title: target ? '切换 Skill' : '离开 Skill 详情',
        message: `当前 Skill 有未保存的修改（${dirtySummary()}），离开后将丢失，确定离开？`,
        confirmText: '离开并放弃修改',
        danger: false
      })
      if (!ok) return
      allowLeave = true
      if (target) subPage.value = target
      else closeSubPage()
    })()
  },
  { flush: 'sync' }
)

/* 跨记录路由离开（侧栏切场景 / 登出 / 跳公开页等真正换 route record）兜底确认；
   确认放行时置 allowLeave，避免 AdminConsole 清页后再触发上面的 subPage 守卫双确认。 */
onBeforeRouteLeave(async () => {
  if (!anyDirty()) return true
  const ok = await askConfirm({
    title: '离开 Skill 详情',
    message: `当前 Skill 有未保存的修改（${dirtySummary()}），离开后将丢失，确定离开？`,
    confirmText: '离开并放弃修改',
    danger: false
  })
  if (ok) allowLeave = true
  return ok === true
})

function onPageBeforeUnload(e: BeforeUnloadEvent) {
  if (anyDirty()) {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', onPageBeforeUnload)
})
/* 顶栏刷新：与旧 hero 刷新钮同一入口（各域强制重拉） */
watch(liveRefreshSeq, () => { void load(true) })
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onPageBeforeUnload)
  /* #F3（原设计页判例）：coreEditorState 是模块级单例——卸载时显式复位，避免下次进入
     带出上一次的脏标记产生幽灵确认。tabDirty 随组件实例销毁，无需处理。 */
  coreEditorState.dirty = false
})

const router = useRouter()
const skillId = computed(() => (subPage.value?.view === 'skill' ? subPage.value.id || '' : ''))

/* ===== 身份：live 注册表档案优先，workbench meta 兜底（外挂能力 / 深链时注册表可能未就绪） ===== */
/** 类别权威源（#138）：live 技能列表接口（与 Skills 列表同源）优先——同一技能在两个接口返回
    不同枚举（live category='generation' / workbench meta category='teaching'），此前静默合成
    导致同页不同加载时刻显示两种类别。现显式披露来源，避免无解释的跳变。 */
interface SkillIdentity { id: string; name: string; category: string; categorySource: string; agentId: string; agentName: string }
/** workbench meta 松散契约（后端字段可选并持续新增；按已知键读取，不硬造展示） */
interface WorkbenchMeta {
  parentAgent?: { id?: string; name?: string }
  skill?: { id?: string; name?: string; category?: string }
  modelConfig?: { model?: string; tier?: string; llmRequest?: { model?: string; source?: string } }
  /** stats.source 枚举 = 后端 UnifiedSkillStats.source（skill-runtime-contract.service.ts:27）；
      'none' 由 skills.ts:975 在无统计行时落为字面量（truthy，非「未返回」） */
  stats?: { source?: 'prompt_call_logs' | 'agent_call_logs' | 'none' | string; range?: string }
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
      // #138：类别权威源 = live 技能列表（与 Skills 列表同源），显式披露
      categorySource: '技能列表 /admin/skills',
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
      categorySource: 'workbench-meta（备用：已上线档案未就绪）',
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
  // 类别走人话（Skills.vue 同字段判例）：裸枚举 teaching → 「教学」
  // 中文名是**别名**（标题已是英文 canonical id），故排在副行首位、不再进标题与面包屑
  return `${v.name} · ${who} · ${categoryText(v.category)}`
})

/* ===== hero pills ===== */
const stat = computed(() =>
  skillId.value ? skillStatOf(skillId.value) : { calls: 0, errors: 0, avgMs: 0, lastAt: '从未' }
)
/** 统计窗口词（liveSkillStatsRange 与 Skill 列表「统计窗口」同源）：「N 次失败」不带窗口会被读成全量 */
const STAT_RANGE_LABELS: Record<string, string> = { '7d': '近 7 天', '24h': '近 24 小时', '30d': '近 30 天', all: '全部时间' }
const statsRangeLabel = computed(() => STAT_RANGE_LABELS[liveSkillStatsRange.value] || '近 7 天')
/** 头部健康徽章三分态（与 Skills.vue 同口径）：异常 / 空闲（0 调用）/ 健康；
    2026-10-24 用户「还是重复部分」：运行时 KPI 已给失败数与窗口，hero 只报状态词，
    次数与窗口放 title（既不复读，也不让「N 次失败」失去窗口口径）；徽标可点 → 运行时页签 */
const healthBadge = computed<{ cls: string; text: string; title: string }>(() => {
  if (stat.value.errors > 0) {
    return { cls: 'mk-badge--bad', text: '异常', title: `${statsRangeLabel.value}窗口内 ${stat.value.errors} 次失败（数字见运行时指标）` }
  }
  if (stat.value.calls === 0) {
    return { cls: 'mk-badge--muted', text: '空闲', title: `${statsRangeLabel.value}窗口内无调用（从未调用不等于健康）` }
  }
  return { cls: 'mk-badge--ok', text: '健康', title: `${statsRangeLabel.value}窗口内调用全部成功` }
})

/* ===== 生效 Prompt（协议页签 System Prompt 卡 + hero 版本 pill + 弹层预填） ===== */
interface EffectivePrompt { prompt?: { version?: number | string; name?: string; systemPrompt?: string } }
const prompt = ref<EffectivePrompt | null>(null)
const promptFailed = ref(false)
/** 请求是否已返回（区分「加载中」与「成功但无生效版本」——此前空数据永久停留「加载中…」） */
const promptLoaded = ref(false)
const promptVersionText = computed(() => {
  const p = prompt.value?.prompt
  if (!p) return ''
  return [p.version != null ? `v${String(p.version)}` : '', String(p.name || '')].filter(Boolean).join(' · ')
})
const promptStateText = computed(() => {
  if (promptFailed.value) return '加载失败'
  if (promptLoaded.value && !promptVersionText.value) return '暂无生效版本'
  return promptVersionText.value ? `生效版本 ${promptVersionText.value}` : '生效版本加载中…'
})
const systemPromptText = computed(() => String(prompt.value?.prompt?.systemPrompt || ''))
/** 页内截断上限与 SkillDrawer 一致（slice(0, 1200)），完整内容在设计页 */
const PROMPT_CAP = 1200
const systemPromptCap = computed(() => systemPromptText.value.slice(0, PROMPT_CAP))
const promptLen = computed(() => systemPromptText.value.length)
const promptTruncated = computed(() => promptLen.value > PROMPT_CAP)

/* ===== 生效模型（运行时「生效值」单点展示；hero 不再重复徽标） ===== */

/* ===== 统计口径（运行时页签说明行）：指标数值来自 liveSkillStatsMap（随 Skill 列表「统计窗口」切换），
   此前照抄 meta.stats.range 造成「口径写全量、数字是 7 天窗口」的失真 → 说明对齐真实窗口 ===== */
/** 来源枚举 → 人话（后端 UnifiedSkillStats.source：prompt_call_logs | agent_call_logs | none）。
    F8-6：'none' = 窗口内没有可判源的日志（skills.ts:975 落字面量），不是口径名——
    与未返回同义，一律回落「Skill 执行日志」，绝不把英文枚举印给运营；未知新枚举同样不裸直出。 */
const STATS_SOURCE_TEXT: Record<string, string> = {
  prompt_call_logs: 'Prompt 调用日志',
  agent_call_logs: 'Skill 执行日志'
}
const statsNote = computed(() => {
  const src = STATS_SOURCE_TEXT[String(meta.value?.stats?.source || '')] || 'Skill 执行日志'
  // 窗口词已由 KPI 卡头右侧显示，这里只报来源，不重复窗口与「与列表一致」的解释
  return src
})

/* ===== 指标（运行时页签 KPI 卡；0 与未知分开；阈值/精度走 rate-utils 单点） ===== */
/** 成功率 tone → MkKpi 的 tone prop（'muted' 无数据档已由 MkKpi 支持 → 直通） */
const rateTone = computed<'ok' | 'warn' | 'bad' | 'muted' | ''>(() => successRateTone(stat.value.calls, stat.value.errors))
const successRate = computed(() => successRateText(stat.value.calls, stat.value.errors) ?? '—')

const fmtMs = (ms: number | null | undefined) => (ms == null || ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

/* ===== 字段路由（协议页签输入/输出契约 + 字段路由页签表格） ===== */
interface FieldRow { fieldId: string; promptRole?: string; valueType?: string; description?: string; masked?: boolean }
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
/** EG15：kind=aux 辅助类技能后端返回 422「无编排阶段归属」——这是「不适用」而非「加载失败」，
    分开标记以免把不适用呈现成坏了+重试。 */
const routingsNotApplicable = ref(false)

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
      accumulate: !!r.accumulate,
      // 原型「脱敏」列语义（index.html 2374-2377）：后端 field-routings 无 masked 布尔 → 列不渲染
      masked: typeof f?.masked === 'boolean' ? f.masked : undefined
    }
  })
})
/** 原型字段路由 5 列（字段/来源/目标/转换规则/脱敏）vs 本表 6 列（来源+目标并在「流向」、脱敏变属性 badges）：
   仅当后端真的下发了 masked 布尔才补出「脱敏」列，否则保持现状并省略（无数据不硬造）。 */
const hasMaskedCol = computed(() => routingRows.value.some((r) => typeof r.masked === 'boolean'))
/** 422 + 「无编排阶段归属（kind=aux）」= 辅助类技能不适用字段路由，而非加载失败（EG15） */
function isRoutingsNotApplicable(e: unknown): boolean {
  const err = e as { response?: { status?: number; data?: { error?: { message?: string } | string } } } | undefined
  if (err?.response?.status !== 422) return false
  const body = err.response.data?.error
  const message = typeof body === 'string' ? body : String(body?.message || '')
  return message.includes('无编排阶段归属')
}
const routingRowsStateText = computed(() => {
  if (routingsLoading.value) return '加载中…'
  if (routingsNotApplicable.value) return '不适用'
  if (routingsFailed.value) return '加载失败'
  return `${routingRows.value.length} 行`
})

/* ===== Prompt 版本（版本页签；日期/作者/变更说明取自 agent-prompts 列表真实字段，有才补列） ===== */
interface VersionItem {
  id: string
  version: string | number
  status: string
  name: string
  createdAt: string
  createdBy: string
  description: string
}
const versions = ref<VersionItem[]>([])
const versionsLoading = ref(false)
const versionsFailed = ref(false)
const versionsStateText = computed(() => {
  if (versionsLoading.value) return '加载中…'
  if (versionsFailed.value) return '加载失败'
  // 列表是「最近 12 条」截断窗口（下方 slice(0, 12)）：「共 N 个」冒充全量 → 改窗口词
  return `最近 ${versions.value.length} 个`
})
/* versionStatusText 改用 statusText.ts 共享字典（P2-15）：本地函数已删，历史字面量在字典补键对齐 */
/** 原型 versions 表含 日期/作者/变更说明（index.html 2344-2346）；三项均空则省略列 */
const hasVersionMeta = computed(() => versions.value.some((v) => v.createdAt || v.createdBy || v.description))
/* P2-18（2026-10-04 全站评审）：变更说明列常被冒充——同步占位「从文件 X.md 加载」与
   prompt-lab 克隆时写入的提示词正文首行（「你是…」开头）都不是变更说明；
   两种形态显「—」+ title 说明原因，真实说明照旧直出（实测 12 行中 10 行被冒充） */
const versionDescText = (v: VersionItem): string => {
  const d = (v.description || '').trim()
  if (!d || /^从文件 .+\.md 加载$/.test(d) || /^你是/.test(d)) return '—'
  return d
}
const versionDescTitle = (v: VersionItem): string | undefined => {
  const d = (v.description || '').trim()
  if (!d) return '版本未附带变更说明'
  if (/^从文件 .+\.md 加载$/.test(d)) return `同步占位（${d}），非变更说明`
  if (/^你是/.test(d)) return '该行是提示词正文首行的摘录，非变更说明'
  return undefined
}
const fmtDate = (v?: string) => {
  if (!v) return '—'
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleDateString('zh-CN')
}

/* ===== core 文件路径（工程页签；prompt-ops agent-overview 真实字段） ===== */
const coreFilePath = ref('')

/* ===== core YAML 投影（协议页签「回合状态机 / 终止条件」+ 工程页签「依赖」） =====
   原型 SKILL_STATE_MACHINE / SKILL_TERMINATIONS / SKILL_ENGINEERING.deps（index.html 1229-1250）
   的数据取 core YAML（prompt-lab getCore）；当前 CoreFile schema 无 stateMachine / states /
   termination / limits 字段 → 一律空态，不硬造（字段名按原型口径做防御式读取，便于后续后端补齐）。 */
interface CoreInputRef extends TrialInputDecl { ref?: string; kind?: string }
interface CoreSnap {
  stateMachine?: unknown
  states?: unknown
  termination?: unknown
  terminations?: unknown
  limits?: unknown
  inputs?: CoreInputRef[]
}
const coreSnap = ref<CoreSnap | null>(null)

/** 任意形状 → 字符串列表（原型 steps/ranklist 只吃字符串；对象键值转「键：值」，对象项取 name/label） */
function toStringList(raw: unknown): string[] {
  if (raw == null) return []
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : []
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (x == null) return ''
        if (typeof x === 'string') return x
        if (typeof x === 'object') {
          const o = x as Record<string, unknown>
          return String(o.name ?? o.label ?? o.title ?? o.state ?? o.id ?? '')
        }
        return String(x)
      })
      .filter(Boolean)
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => `${k}：${v == null ? '—' : String(v)}`)
  }
  return [String(raw)]
}

/** 回合状态机节点（原型 steps 圆点序列，index.html 2384-2386）；无字段 → [] */
const coreStateNodes = computed<string[]>(() => {
  const c = coreSnap.value
  return c ? toStringList(c.stateMachine ?? c.states) : []
})
/** 终止条件（原型 ranklist，index.html 2388-2390）；无字段 → [] */
const coreTerminations = computed<string[]>(() => {
  const c = coreSnap.value
  return c ? toStringList(c.termination ?? c.terminations ?? c.limits) : []
})
/* 上游依赖（原型 chips，index.html 2368）现由 EngineeringTab 单点渲染；
   2026-10-23 撤掉本页重复的卡片版后，这里不再自己算一份。 */

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
      promptLoaded.value = false
      try {
        const res = await adminSkillsApi.getEffectiveSkillPrompt(id)
        if (!guard(true)) return
        prompt.value = (res.data?.data ?? res.data ?? null) as EffectivePrompt | null
        promptLoaded.value = true
      } catch {
        if (guard(true)) { prompt.value = null; promptFailed.value = true; promptLoaded.value = true }
      }
    })(),
    // 字段路由（协议契约 + 字段路由页签）
    (async () => {
      routingsLoading.value = true
      routingsFailed.value = false
      routingsNotApplicable.value = false
      try {
        const res = await adminFieldRoutingsApi.getSkillRoutings(id)
        if (!guard(true)) return
        routings.value = (res.data?.data ?? res.data ?? null) as RoutingsData | null
      } catch (e) {
        if (!guard(true)) return
        routings.value = null
        routingsNotApplicable.value = isRoutingsNotApplicable(e)
        routingsFailed.value = !routingsNotApplicable.value
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
          name: String(v.name || ''),
          createdAt: v.createdAt ? String(v.createdAt) : '',
          createdBy: v.createdBy ? String(v.createdBy) : '',
          description: v.description ? String(v.description) : ''
        }))
      } catch {
        if (guard(true)) { versions.value = []; versionsFailed.value = true }
      } finally {
        if (guard(true)) versionsLoading.value = false
      }
    })(),
    // core 文件路径（工程页签）+ 完整 overview 条目（工程页签子组件 EngineeringTab 需要 file/db/drift/runtimeContract）
    (async () => {
      coreFilePath.value = ''
      overviewItem.value = null
      try {
        const res = await adminPromptOpsApi.getAgentOverview()
        if (!guard(true)) return
        const items = (res.data?.data?.items || []) as OverviewItem[]
        const found = items.find((x) => x.agentId === `skill:${id}` || x.agentId === id) || null
        coreFilePath.value = String(found?.file?.path || '')
        overviewItem.value = found
      } catch {
        if (guard(true)) { coreFilePath.value = ''; overviewItem.value = null }
      }
    })(),
    // core YAML 投影（协议页签状态机/终止条件 + 工程页签依赖；prompt-lab getCore）
    (async () => {
      try {
        const res = await adminPromptWorkbenchApi.getCore(id)
        if (!guard(true)) return
        coreSnap.value = (res.data?.core ?? null) as CoreSnap | null
      } catch {
        if (guard(true)) coreSnap.value = null
      }
    })()
  ]
  await Promise.all(jobs)
  if (seq !== loadSeq || skillId.value !== id) return
  loading.value = false
  // 身份双源（live 档案 / meta）都拿不到才算未找到：live boot 未完成时 meta 兜底
  if (!view.value) notFound.value = true
  // 面包屑与标题同源（英文 canonical id）：中文别名只在 hero 副行出现一次，
  // 否则「面包屑中文 / 标题英文」又成一件事两种说法
  else setSubPageLabel(view.value.id)
}

/* ===== 换技能（含深链 / 关闭）的复位 watch 统一放在文件尾：
   immediate 回调在 setup 期同步执行，必须排在全部状态声明之后（const 无提升）。 ===== */

/* ===== 治理动作：切到对应设计页签（2026-10-15 设计页退役并平铺进本页后）=====
   原先 goDesign 是「push ?view=skill-design 跳独立页」；现设计能力已在本页各页签就地铺开，
   跳转改为**就地切页签**（visited.add 保证其子组件挂载），不再有跨页路由跳转。 */
function goDesign(tabKey?: string) {
  const key = tabKey && TAB_KEYS.has(tabKey) ? tabKey : DEFAULT_TAB
  visited.add(key)
  tab.value = key as typeof tab.value
}

/** 最近调用行 → 执行日志 Trace（动线与 SkillDrawer goTrace 一致：先收详情再跳） */
function goTrace(traceId: string) {
  closeSubPage()
  openTrace(traceId)
}

/* ===== 最近调用（运行时页签；SkillDrawer 概览迁入） ===== */
const recent = computed(() => (skillId.value ? recentSpansOf(skillId.value) : []))
const statusDotLabel = (s: string) => (s === 'ok' ? '成功' : s === 'err' ? '失败' : '超时')
/** F7-4：失败行的行标题此前直出 span.title（live.ts:193 把引擎异常原文 slice(0,40) 塞进标题），
    列表里读到的是一串截断代码异常，既不可读也不指向动作。现失败行标题 = 错误类别人话
    （errorCategoryText 单源；无类别时回落 errorCodeLabel，再回落「执行失败」），
    原始异常原文与 traceId 一并进 title（详情/tooltip），点行仍跳执行日志 Trace。 */
function recentRowText(s: TraceSpan): string {
  if (s.status === 'ok') return s.title || '执行完成'
  if (s.status === 'warn') return '执行超时'
  // 兜底类别 'error' 的字典值是「失败」：与前缀重复，按无类别处理（不渲染「执行失败 · 失败」）
  const cat = errorCategoryText(s.errorCategory)
  if (cat && cat !== '失败') return `执行失败 · ${cat}`
  const code = errorCodeLabel(s.errorCode)
  return code ? `执行失败 · ${code}` : '执行失败'
}
function recentRowTitle(s: TraceSpan): string {
  const parts = [`traceId：${s.traceId}`]
  if (s.status !== 'ok') {
    const raw = s.errorMessage || s.detail || ''
    if (raw) parts.push(raw)
    if (s.errorCode) parts.push(`错误码：${s.errorCode}`)
  }
  return parts.join('\n')
}

/* 模型配置 / 模型测试的状态与动作 2026-10-19 迁出本页：
   宿主原本自己维护一份 rtForm/probeForm 并渲染同名的两张卡，与设计区块 RuntimeTab 构成
   同一份 skill_model_configs 的两个独立编辑器（各存各的、互不可见）。现由 RuntimeTab 单点承载，
   本页只留只读读数（运行指标 / 最近调用）。 */
/* ===== 换技能（含深链 / 关闭）：全量复位 + 重拉（判例 PathDetail 的 pathId watch）。
   声明位置约束：immediate 回调在 setup 期同步执行，本 watch 必须排在全部状态声明之后
   （resetTrial 是函数声明可提升，trial 的 const 状态不行）。 */
watch(
  skillId,
  (id) => {
    loadSeq += 1
    meta.value = null
    prompt.value = null
    promptFailed.value = false
    promptLoaded.value = false
    routings.value = null
    routingsLoading.value = false
    routingsFailed.value = false
    routingsNotApplicable.value = false
    versions.value = []
    versionsLoading.value = false
    versionsFailed.value = false
    coreFilePath.value = ''
    coreSnap.value = null
    overviewItem.value = null
    notFound.value = false
    // 深链保持：URL 明确带合法 ?tab= 时尊重它，否则回落运行时（健康+证据先于配置）
    tab.value = readTabFromQuery()
    visited.add(tab.value)
    if (id) void load()
  },
  { immediate: true }
)

/* ===== Prompt 弹层（原型 openPromptModal；外壳走共享 .mk-modal 原语，wide 档）。
   #135：这是「起草 + 查看」区，唯一前进动作是跳设计页（不携带草稿）——
   草稿按 skill 写 sessionStorage（skd-prompt-draft:<skillId>），下次打开自动恢复并提示，
   再给「复制内容」把草稿带走；不再让输入随关闭/跳转静默丢弃 */
const pmOpen = ref(false)
const pmText = ref('')
const pmNote = ref('')
const pmDraftRestored = ref(false)
const pmDraftSavedAt = ref('')
const pmMaskRef = ref<HTMLElement | null>(null)
const pmPanelRef = ref<HTMLElement | null>(null)

const pmDraftKey = () => `skd-prompt-draft:${skillId.value}`

function openPromptModal() {
  pmDraftRestored.value = false
  pmDraftSavedAt.value = ''
  let draft: { text?: string; note?: string; at?: string } | null = null
  try {
    const raw = sessionStorage.getItem(pmDraftKey())
    if (raw) draft = JSON.parse(raw) as { text?: string; note?: string; at?: string }
  } catch { /* 隐私模式忽略 */ }
  if (draft && typeof draft.text === 'string' && draft.text !== systemPromptText.value) {
    pmText.value = draft.text
    pmNote.value = draft.note || ''
    pmDraftRestored.value = true
    pmDraftSavedAt.value = draft.at || ''
  } else {
    pmText.value = systemPromptText.value
    pmNote.value = ''
  }
  pmOpen.value = true
}
/** 关闭时保留草稿（与生效内容一致则清掉，避免残留过期草稿） */
function persistPromptDraft() {
  try {
    if (pmText.value && pmText.value !== systemPromptText.value || pmNote.value.trim()) {
      sessionStorage.setItem(pmDraftKey(), JSON.stringify({ text: pmText.value, note: pmNote.value, at: new Date().toLocaleString('zh-CN', { hour12: false }) }))
    } else {
      sessionStorage.removeItem(pmDraftKey())
    }
  } catch { /* 隐私模式忽略 */ }
}
function closePromptModal() {
  persistPromptDraft()
  pmOpen.value = false
}
/** 跳设计页：先落草稿（设计页无接收通道，草稿留在本页下次可恢复），再走既有跳转 */
function goDesignWithDraft() {
  persistPromptDraft()
  void goDesign('protocol')
}
async function copyPromptDraft() {
  if (!pmText.value) return
  try {
    await navigator.clipboard.writeText(pmText.value)
    toast.success('已复制 Prompt 内容')
  } catch {
    toast.error('复制失败：剪贴板不可用')
  }
}
/* 弹层开合行为四件套：Esc（栈顶优先）/ 遮罩 / 焦点陷阱 / 滚动锁（判例 PathDetail 任务弹层） */
useOverlay(computed(() => pmOpen.value), pmPanelRef)
useMaskClose(pmMaskRef, closePromptModal)
useEscape(() => pmOpen.value, closePromptModal)
/* 页面级 Esc：弹层未开时 Esc 关详情页（关闭 = 清 ?view=&id= 回列表，判例二级页范式）。
   #136：焦点在输入框/文本域/下拉等编辑态时不关页——此前在试跑输入里按 Esc 会直接关掉整个详情页、
   未保存输入静默丢失（表单未保存改动的同类风险同源：模型配置表单/试跑输入均无离开守卫）。 */
useEscape(
  () => !pmOpen.value,
  () => {
    const ae = document.activeElement as HTMLElement | null
    const tag = ae?.tagName
    if (ae && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable)) return
    if (subPage.value?.view === 'skill') closeSubPage()
  }
)
</script>

<style scoped>
.skd { gap: 16px; }
/* 骨架版式（形状）走 MkSkeleton；本类只管外层堆叠 */
.skd-skel { display: grid; gap: 14px; padding-top: 8px; }

/* ===== 页签卡（原型：单张卡 subtabs + subpane） ===== */
.skd-body { overflow: clip; }
/* hero 健康徽标可点（button 复用 .mk-badge 皮）：只重置按钮默认 chrome，视觉与相邻 badge 同语言 */
.skd-badge-btn { border: 0; cursor: pointer; font: inherit; }
.skd-pane { display: grid; gap: 12px; padding: 16px; border-top: 1px solid var(--mk-line); }
/* 2026-10-15 设计页平铺：每个页签一个 .skd-bloc（只读概览 + 设计页可编辑区块纵向堆叠）。
   块内用同款纵向 gap，块与块之间由 .skd-pane 的 gap 统一。 */
.skd-bloc { display: grid; gap: 16px; align-content: start; }
/* 运行指标读数带（2026-10-16）：窗口词挂带头部一次，与四张卡的间距收紧到 8px，
   读起来是「一张带子」而不是「孤立标题 + 一排卡」。 */
.skd-metric-band { display: grid; gap: 8px; }
.skd-bloc > * { min-width: 0; }
/* #134：grid 子项默认 min-width:auto 会被内容撑开，窄屏（1366/1280）下字段路由表被容器裁掉、
   .skd-tablewrap 的 overflow-x:auto 拿不到滚动条（右侧「属性/脱敏」列不可达）。
   与 mk-primitives 的 `.mk-page > * { min-width: 0 }` 同款修法，让子项可收缩、横滚真正接管。 */
.skd-pane > * { min-width: 0; }
.skd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.skd-grid > .mk-card { box-shadow: none; }
.skd-pad { padding: 12px 16px; display: grid; gap: 10px; align-content: start; }

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
/* 字段名（行的标识）：原 max-width 220 + 单行 ellipsis，1080p 实测 23 处读不全
   （最长 understanding.available_resources.time_budget 需 ~420px）。改 300 宽 + 最多两行折行
   （line-clamp 判例见 MkStatStrip/SessionCockpit）：≤300 的仍单行，更长的折两行不截断。
   描述列让出 80px——描述本就像句子会换行、且带 title，属次要信息。 */
.skd-vrow__name {
  font-weight: 700; flex: none; max-width: 300px;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden; overflow-wrap: anywhere;
}
.skd-vrow__desc { flex: 1; min-width: 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skd-vrow__type { flex: none; color: var(--mk-muted); font-size: var(--mk-fs-micro); }

/* ===== 协议：回合状态机 steps（原型 .steps/.step，index.html 434-439） ===== */
.skd-steps { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.skd-step { display: flex; align-items: center; gap: 6px; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.skd-step__n {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--mk-surface-3);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}

/* ===== 协议/试跑：ranklist 与 meterrow（原型 .ranklist/.rankrow/.meter，index.html 297-302 / 2340） ===== */
.skd-ranklist { display: grid; gap: 2px; }
.skd-rankrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--mk-line);
  min-width: 0;
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
}
.skd-rankrow:last-child { border-bottom: 0; }

/* ===== 工程：依赖 chips（原型 .chips，index.html 2368） ===== */

/* ===== 代码井（原型 .code：深底 mono 块；System Prompt / 试跑输出 / 探测预览共用） ===== */
.skd-code {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-code-bg);
  border: 1px solid var(--mk-code-border);
  color: var(--mk-code-fg);
  font: var(--mk-fs-micro)/1.65 var(--mk-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

/* ===== 试跑 ===== */
.skd-ta { width: 100%; }

/* ===== 版本 / 字段路由表格（原型 .tbl 包壳） ===== */
.skd-tablewrap { overflow-x: auto; }
.skd-tablewrap .mk-table td { white-space: nowrap; }
.skd-tablewrap .mk-table .skd-td-wrap { white-space: normal; min-width: 160px; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.skd-tablewrap .mk-table th.skd-th-wrap { white-space: normal; }

/* ===== 运行时：指标卡（原型 metricCard 四张独立卡）走共享 MkKpi + .mk-kpi-grid（审核 #146），
   本文件的 .skd-metric* 私有实现已删（含值档与 4K 档覆写，原语自带全档位） ===== */

/* ===== 试跑表单字段（标签 + 控件） ===== */
.skd-field { display: grid; gap: 4px; min-width: 0; }
.skd-field > span { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.skd-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 5px; }

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

/* ===== 说明行 / 卡内空态：复用共享原语（.mk-card__note / .mk-empty--line），
   不再私持 .skd-none / .skd-note（#147）===== */
/* P3-23（设计评审）：试跑页签未跑态收敛——「尚未试跑」只在样例输入卡脚注说一次，
   执行链路 / 样例输出两卡未跑时显统一占位灰块（不再各自成句复读）。
   注：本类是「96px 虚线占位块」复刻件（与 .mk-empty--line 的一行式空态不同事实），
   若产品确认保留，需在 ADMIN_VISUAL_LAYER_SPEC §6 词汇表登记。 */


/* ===== Prompt 弹层（原型 modal--wide；面板宽走 .mk-modal__panel--wide 原语） ===== */
.skd-pm__body { display: grid; gap: 14px; }
.skd-hint { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
/* 草稿恢复提示（#135）：中性信息条 */
.skd-draft-note {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}

/* ===== 大屏/4K 适配（全站 mk 体系档位） ===== */
@media (min-width: 2000px) {
  .skd-vrow__name { font-size: var(--mk-fs-micro); }
  .skd-call { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .skd-vrow__name { font-size: var(--mk-fs-micro); }
  .skd-call { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .skd-vrow__name { font-size: var(--mk-fs-body); }
  .skd-call { font-size: var(--mk-fs-emphasis); }
  .skd-call__ms { font-size: var(--mk-fs-body); }
}
</style>
