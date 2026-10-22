<template>
  <div class="mk-page mk-page--fill ac-host">
    <!-- 页头（newui/admin pagehead）：页名 + 各 tab 的主操作上移（2026-10-04 状态条退役：页头只剩页名与主操作） -->
    <MkPageHead title="模型与接入" sub="管理模型供应商、基础设施模型、Skill 路由与后台访问安全策略">
      <template #actions>
        <!-- 本页唯一主操作升 primary（2026-10-04 全站评审 P3#37：此前 sm 次要形态，
             动作权重与视觉权重倒挂）；sm 档保留，与页头动作位其余刷新钮同高 -->
        <button v-if="tab === 'access'" type="button" class="mk-btn mk-btn--sm" @click="providersRef?.refresh?.(true)">刷新注册表</button>
        <button v-if="tab === 'access'" type="button" class="mk-btn mk-btn--sm mk-btn--primary" :disabled="fetching || !form.apiUrl" @click="fetchModels">
          <MkLoading v-if="fetching" inline text="拉取中…" />
          <span v-else>{{ models.length ? '重新拉取' : '连接并拉取' }}</span>
        </button>
        <!-- 刷新钮只挂在真有远端数据源的页签（接入与模型含只读注册表）；其余配置 tab 的
             读取失败重试走卡内 mk-alert「重试」，页头不放无效刷新。
             （外挂能力 2026-10-19 拆出独立页时带走它自己的刷新钮，这里不再有第三个分支） -->
        <!-- 重置为默认（#13）：后端 POST /admin/api-config/reset 此前无前端入口。高风险不可撤销，
             二次确认在 resetConfig 内；三个配置 tab 常驻，与「分组保存」并列但语义是整页级 -->
        <button v-if="isConfigTab" type="button" class="mk-btn mk-btn--sm" :disabled="resetting" @click="resetConfig">{{ resetting ? '重置中…' : '重置为默认' }}</button>
      </template>
    </MkPageHead>
    <!-- 页首 KPI 带已撤（2026-10-14 用户拍板「模型与接入的 kpi 也不要了」）：原两处带
         （配置 tab 的 密钥/模型清单/默认路由、总览 tab 的 注册模型/漂移提示）都是把下方卡里
         已有的读数抄一遍——密钥在连接卡（API Key 行的「留空 = 沿用已配置」+ 卡头连接徽标）、
         模型清单在模型清单卡（chips 或空态句）、默认路由在路由页签的三条路由行、漂移清单在
         注册表总览自己的「配置漂移」小节。撤带后这些事实各有唯一出口，页首只留页名与主操作。 -->

    <!-- 视图切换（原型 .tabs 下划线页签）：2026-10-05 CM1 收敛到共享 MkSubTabs（原页内 .tabs/.tab
         本地拷贝退役）；外挂能力计数走 MkSubTabs 的 count 角标，形态与其余二级页签一致。
         2026-10-14 用户拍板重设计：7 页签 → 4 ——
         · 接入与模型 = 原「接入与验证」（连接 / 模型清单 / 连通性验证）+ 原「模型总览」（注册表只读）
           两张卡本就在互相指路（模型清单空态句写「平台实际在用模型见『模型总览』tab」），
           合成一页后「拉取 → 看注册表解析结果」是一条动线。
         · 接入与模型 = 供应商/模型 + 基础设施模型 + 默认生成参数（思考 / 结构化输出）+ 别名映射；
         · 调用与健康 = 调用策略 + 调用健康
           （调用参数 / 降级守卫 / 能力健康）+ 注册表的路由两分区（默认路由解析结果 / 别名映射）
           + 原「虚拟学习者」页签的压测参数卡——全属「调用怎么走、上游容量多少、挂了怎么办」。
         · 安全与访问（4 张策略卡）、外挂能力（能力目录）自成域，原样保留。
         旧键 ?tab=connection / overview / runtime / virtual-learners 全部走 TAB_ALIAS 归一，
         书签与站内深链不失效。 -->
    <MkSubTabs
      class="ac-tabs"
      :tabs="acTabs"
      :model-value="tab"
      aria-label="模型与接入视图切换"
      id-base="ac"
      @update:model-value="onTabChange"
    />

    <!-- ===== Tab1-4：接入与模型 / 调用与健康 / 虚拟学习者 / 安全与访问（2026-09-29 由单一大 tab 拆分，每 tab 一张语义卡；分段保存按钮随卡） ===== -->
    <template v-if="isConfigTab">
    <template v-if="tab === 'access'">
    <!-- 2026-10-05 满屏重排：mk-narrow 限宽列在宽屏下「一张卡悬着」（用户实测批注）。
         去限宽，单卡拆三卡满宽三列（窄屏 ≤1100px 回落单列）。
         2026-10-18 BYOK 重做：本页签从「连接卡 + 只读能力表」改成左供应商列表 / 右详情
         （ModelProvidersPanel）。平台通道的服务地址与密钥作为那条通道的详情内容经
         #platform-detail 插槽注入——它们仍归 platform_api_configs、走既有的脏位保存；
         其余供应商与全部模型的增删改即时保存，落回 llm-providers.json。 -->
    <div class="ac-tab-body ac-conn-body" id="ac-panel-access" role="tabpanel" aria-labelledby="ac-tab-access">
      <!-- 接入域（live 层）读取失败：表单全空不得伪装成「未配置」，显式失败 + 重试（置顶一次，管三张卡） -->
      <div v-if="apiConfigFailed" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">配置读取失败：为空不代表未配置，请重试</span>
        <button type="button" class="mk-alert__btn" @click="retryApiConfigLoad">重试</button>
      </div>
      <ModelProvidersPanel
        ref="providersRef"
        :upstream="models"
        @changed="onProvidersChanged"
        @registered="registeredModelIds = $event"
      >
        <!-- 平台通道 = 那条端点沿用连接设置的供应商：服务地址与密钥仍归 platform_api_configs
             （连接设置），走既有的脏位保存（本页脚保存条），不混进「即时保存」的注册表编辑。
             表单嵌在供应商详情里，读者看到的是「这一个供应商怎么连」。 -->
        <template #platform-detail>
          <div class="ac-conn">
            <div class="ac-conn__bar">
              <!-- connBadge 附「N 前」（P1#32 子集）：连接状态是上次拉取/探测落库的结果，
                   无时间的「连接正常」会把陈旧快照读成实时健康，误导熔断判断 -->
              <span class="mk-badge" :class="connBadge.cls" :title="connBadgeTitle">{{ connBadge.text }}</span>
              <button v-if="dirty.has('conn')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['conn'])">{{ saving ? '保存中…' : '保存连接' }}</button>
            </div>
            <!-- 左右双列（2026-10-15 用户重组）：左=填地址/密钥，右=连通性验证——
                 「填完地址 → 顺手在右边点测试」一条动线；右列在窄屏（≤1100）回落整行 -->
            <div class="ac-body ac-conn2">
              <div class="ac-conn2__col">
                <label class="mk-field">
                  <span class="mk-field__label">服务地址</span>
                  <input class="mk-field__input" v-model="form.apiUrl" placeholder="https://api.example.com/v1" @input="markDirty('conn')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">API Key</span>
                  <span class="ac-key-wrap">
                    <span class="ac-key-input-row">
                      <input
                        class="mk-field__input"
                        :type="keyVisible ? 'text' : 'password'"
                        v-model="form.apiKey"
                        autocomplete="new-password"
                        :placeholder="keySet ? '留空 = 沿用已配置' : '输入 API Key'"
                        @input="markDirty('conn')"
                      />
                      <button
                        v-if="keySet || form.apiKey"
                        type="button"
                        class="ac-key-toggle"
                        :title="keyVisible ? '隐藏' : '显示'"
                        @click="keyVisible = !keyVisible"
                      ><Eye v-if="keyVisible" :size="15" :stroke-width="1.75" />
                        <EyeOff v-else :size="15" :stroke-width="1.75" /></button>
                    </span>
                    <em v-if="keyHintNeeded" class="ac-keyhint">更换服务地址需重新输入密钥</em>
                  </span>
                </label>
              </div>
              <div class="ac-conn2__col ac-conn2__col--test">
                <span class="ac-sec__title">连通性验证</span>
                <div class="ac-test">
                  <label class="mk-field ac-test__model">
                    <span class="mk-field__label">测试模型</span>
                    <select class="mk-field__select" :disabled="!models.length" :value="testModel" @change="testModel = ($event.target as HTMLSelectElement).value">
                      <option v-if="!models.length" value="">无可用模型（等待拉取）</option>
                      <option v-for="m in models" :key="m" :value="m" :title="modelTestHint(m)">{{ modelTestLabel(m) }}</option>
                    </select>
                  </label>
                  <button type="button" class="mk-btn mk-btn--primary ac-test__btn" :disabled="!models.length || testing" @click="runTest">
                    <MkLoading v-if="testing" inline text="测试中…" />
                    <span v-else>运行测试</span>
                  </button>
                  <span v-if="testResult" class="ac-test__result">
                    <span class="mk-badge" :class="testResult.ok ? 'mk-badge--ok' : 'mk-badge--bad'">{{ testResult.ok ? '测试通过' : '测试失败' }}</span>
                    <span class="ac-test__meta mono">{{ testResult.latency || '—' }}{{ testResult.usage ? ` · ${testResult.usage}` : '' }}</span>
                    <!-- 回文/错误原文全值进 title（审核 #162）：视觉仍单行截断，但运营可悬停核对模型真实输出 -->
                    <span class="ac-test__text" :class="{ 'ac-test__text--bad': !testResult.ok }" :title="testResult.text">「{{ testResult.text }}」</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <!-- 上游模型（2026-10-21 用户走查「不需要注释型文案」）：只报已拉取/已添加的读数，
             逐条添加的清单由面板渲染；未保存状态留在徽章 title 里。 -->
        <template #models-meta>
          <p class="ac-models-meta ac-models__line">
            <span class="ac-models-meta__title">上游模型</span>
            <span v-if="fetchError && !models.length" :title="`错误原文：${fetchError}`">拉取失败，请检查服务地址与密钥</span>
            <span v-else-if="models.length">{{ upstreamSummary }}</span>
            <span v-else>尚未拉取</span>
            <span v-if="hasUnsavedModels" class="mk-badge mk-badge--warn" title="本次拉取仅在「保存连接」后生效">未保存</span>
          </p>
        </template>
        <!-- 基础设施模型：embedding/rerank 是平台必需配置，不是插件；嵌进平台详情，不再单独占一张卡。 -->
        <template #platform-infra>
          <InfraModelsPanel embedded />
        </template>
        <!-- 默认生成参数：Skill 未覆盖时仍会继承的思考 / 结构化输出；别名映射表是查证用的只读参考。 -->
        <template #platform-generation>
          <div class="ac-gen-panel">
            <div v-if="dirty.has('route')" class="ac-gen-panel__bar">
              <button type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['route'])">{{ saving ? '保存中…' : '保存生成参数' }}</button>
            </div>
            <!-- 能力健康内联提示（原 ranklist 下 statusbar，2026-10-05 重设计移到区块前：域级状态先于配置项）：
                 取真实降级守卫 / 能力健康，均无异常则整条省略（不硬造） -->
            <div v-if="routeWarnText" class="ac-route-warn" role="status">
              <span class="ac-route-warn__dot"></span>
              <span>{{ routeWarnText }}</span>
            </div>
            <!-- 2026-10-21 用户走查：平台模型已按 Skill 配置，默认路由三行退役；
                 本块只保留 Skill 未覆盖时仍会继承的生成默认（思考 / 结构化输出）。 -->
            <div class="ac-cols">
              <div class="ac-cols__main">
                <!-- 默认思考：平台级默认（未单独配置的 Skill 继承此默认；skill 级可在设计页运行时 tab 覆盖）。
                     2026-10-14：原「启用思考」开关与「思考模式」下拉是**同一个字段的两个控件**——
                     开关只是 `defaultThinkingMode !== 'disabled'` 的派生态（关闭 ⇔ 下拉的「关闭」档），
                     且它表达不了「强制开启」，勾上只能落到「跟随模型默认」，是有损视图。
                     同屏一处事实两个控件，还带来「强度灰了、模式没灰」的不一致。现只留真字段那一个控件。 -->
                <div class="ac-sec__title">默认思考</div>
                <div class="ac-row ac-row--2 ac-think">
                  <label class="mk-field">
                    <span class="mk-field__label">思考模式</span>
                    <select
                      class="mk-field__select"
                      :value="form.defaultThinkingMode"
                      @change="setThinkingMode(($event.target as HTMLSelectElement).value)"
                    >
                      <option value="default">跟随模型默认</option>
                      <option value="enabled">强制开启</option>
                      <option value="disabled">关闭</option>
                    </select>
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">思考强度</span>
                    <select
                      class="mk-field__select"
                      :disabled="!thinkingOn"
                      :value="form.defaultReasoningEffort"
                      @change="setEffort(($event.target as HTMLSelectElement).value)"
                    >
                      <option value="default">跟随模型默认</option>
                      <option value="low">低（low）</option>
                      <option value="high">高（high）</option>
                      <option value="max">最高（max）</option>
                    </select>
                  </label>
                </div>
              </div>
              <div class="ac-cols__side">
                <!-- 结构化输出：平台级默认（json 媒介 Skill 的请求附 response_format，上游解码层强制 JSON；
                     需渠道支持——2026-10-02 对本渠道直连实测为真强制；skill 级 paramOverrides.responseFormat 可覆盖/显式关闭） -->
                <div class="ac-sec__title">结构化输出<span class="ac-sec__hint">对输出 JSON 的 Skill 强制 JSON</span></div>
                <!-- 与左侧「思考模式 / 思考强度」同宽（同列里同类控件两种宽度是偶然差异，不是层级） -->
                <div class="ac-row ac-row--2">
                  <label class="mk-field">
                    <span class="mk-field__label">输出格式</span>
                    <select
                      class="mk-field__select"
                      :value="form.defaultResponseFormat"
                      @change="form.defaultResponseFormat = ($event.target as HTMLSelectElement).value as 'none' | 'json_object'; markDirty('route')"
                    >
                      <option value="none">关闭（默认行为）</option>
                      <option value="json_object">JSON 对象</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <!-- 注册表切片（2026-10-15 用户重组）：只剩「别名映射」一片，默认收起成折叠条——
                 它是查证用的参考表（chat / reasoning / light 各指向哪个模型），不是每次进页都要读的
                 运行态。 -->
            <details class="ac-fold">
              <summary class="ac-fold__bar">
                <span class="ac-fold__title">内置别名映射表</span>
                <span class="ac-fold__hint">逻辑别名（chat / reasoning / light 等）实际指向的候选模型与默认选中项 · 只读</span>
                <span class="ac-fold__mark" aria-hidden="true"></span>
              </summary>
              <ModelRegistryOverview ref="registryRef" class="ac-registry ac-registry--aliases" :parts="['aliases']" @defaults="registryDefaults = $event" />
            </details>
          </div>
        </template>
      </ModelProvidersPanel>
    </div>
    </template>
    <template v-else-if="tab === 'routing'">
    <div class="ac-tab-body" id="ac-panel-routing" role="tabpanel" aria-labelledby="ac-tab-routing">
      <!-- ===== 调用策略（2026-10-20 重新设计）=====
           原「AI 调用与健康」是一张 954px 的大卡，把四类东西叠在一起：请求重试、上游容量、
           虚拟学习者模拟、探针与健康。四者的读者与变更频率都不同（策略一次定、容量按负载调、
           模拟是压测、健康是读数）。现按域拆卡：调用策略 / 调用健康；虚拟学习者已独立成页签。 -->
      <section v-if="isLive && (reliability || configLoadFailed)" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">调用策略</h3>
          <button v-if="dirty.has('reliability')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['reliability'])">{{ saving ? '保存中…' : '保存参数' }}</button>
        </div>
        <div class="ac-body">
          <div v-if="configLoadFailed && !reliability" class="mk-alert mk-alert--row ac-config-error" role="alert">
            <span class="mk-alert__msg">配置读取失败</span>
            <button type="button" class="mk-alert__btn" @click="retryConfigLoad">重试</button>
          </div>
          <!-- 不变式违例升格为卡级告警：7 个数字里最该先读的一句 -->
          <div v-if="reliability && fallbackDisabled" class="mk-alert mk-alert--row ac-fallback-alert" role="alert">
            <span class="mk-alert__msg">当前配置下「模型降级」永远不会触发，请增大「上游最大尝试」或减小「传输重试」</span>
          </div>
          <div v-if="reliability" class="ac-groups ac-groups--3">
            <div class="ac-group">
              <div class="ac-group__title" title="降级触发条件：1 + 传输重试 ＜ 上游最大尝试（例：3 次尝试、1 次传输重试时仍留一次降级机会）">尝试与降级</div>
              <div class="ac-group__fields">
                <label class="mk-field">
                  <span class="mk-field__label">上游最大尝试</span>
                  <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" :max="limMax('maxUpstreamAttempts', 10)" class="mk-field__input ac-field--num" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">传输重试</span>
                  <input v-model.number="reliability.maxTransportRetries" type="number" min="0" :max="limMax('maxTransportRetries', 5)" class="mk-field__input ac-field--num" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">逻辑重试</span>
                  <input v-model.number="reliability.maxLogicalRetries" type="number" min="0" :max="limMax('maxLogicalRetries', 5)" class="mk-field__input ac-field--num" @input="markDirty('reliability')" />
                </label>
              </div>
            </div>
            <div class="ac-group">
              <div class="ac-group__title">退避与超时</div>
              <div class="ac-group__fields">
                <label class="mk-field">
                  <span class="mk-field__label">退避基数（毫秒）</span>
                  <input v-model.number="reliability.retryBaseDelayMs" type="number" :min="limMin('minRetryBaseDelayMs', 100)" :max="limMax('maxRetryBaseDelayMs', 60000)" step="100" class="mk-field__input ac-field--num" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">Retry-After 上限（毫秒）</span>
                  <input v-model.number="reliability.maxRetryAfterMs" type="number" min="0" :max="limMax('maxRetryAfterMs', 30000)" step="1000" class="mk-field__input ac-field--num" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">单次超时（毫秒）</span>
                  <input v-model.number="reliability.defaultRequestTimeoutMs" type="number" :min="limMin('minRequestTimeoutMs', 1000)" :max="limMax('maxRequestTimeoutMs', 600000)" step="1000" class="mk-field__input ac-field--num" @input="markDirty('reliability')" />
                </label>
              </div>
              <label class="mk-field mk-field--switch">
                <input type="checkbox" v-model="reliability.jitterEnabled" @change="markDirty('reliability')" />
                <span class="mk-field__label" style="margin:0">随机抖动</span>
              </label>
              <span class="ac-group__hint">退避从基数开始逐次翻倍。429 时按上游 Retry-After 等待，不超过上限</span>
            </div>
            <div class="ac-group">
              <div class="ac-group__title" title="只管真实用户与平台自身，虚拟学习者通道单独计量（见「虚拟学习者」页签）">平台出站速率</div>
              <div class="ac-group__fields">
                <label class="mk-field">
                  <span class="mk-field__label">平台全局 RPM 上限（0=不限）</span>
                  <input v-model.number="reliability.platformRpmLimit" type="number" min="0" max="100000" step="10" class="mk-field__input ac-field--num" @input="markDirty('reliability')" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>


      <!-- ===== 调用健康（2026-10-20 独立成卡）=====
           探针设置与探测结果放回同一张卡：读者只有一个问题「现在哪几项不可用」。 -->
      <section v-if="isLive" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">调用健康</h3>
          <span class="mk-badge" :class="healthBadgeCls" :title="healthLabelTip || undefined">{{ healthLabel }}</span>
        </div>
        <div class="ac-body">
          <!-- 探针（定期探测能力健康）：全站 mk-field 行式配置（与其他开关一致），开启后显示间隔 -->
          <div v-if="probe.loaded" class="ac-probe">
            <div class="ac-probe__main">
              <label class="mk-field mk-field--switch ac-probe__switch">
                <input
                  type="checkbox"
                  :checked="probe.enabled"
                  :disabled="probeBusy"
                  @change="setProbeEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="mk-field__label" style="margin:0">能力探针</span>
              </label>
              <em class="ac-probe__desc">{{ probe.enabled ? `每 ${probe.intervalSec}s 自动探测 5 项核心能力并更新结果` : '关闭后不自动探测，可手动「立即探测」' }}</em>
            </div>
            <div class="ac-probe__ctrl">
              <label v-if="probe.enabled" class="mk-field ac-probe__interval">
                <span class="mk-field__label">间隔</span>
                <input
                  v-model.number="probe.intervalSec"
                  type="number"
                  :min="Math.ceil(probe.minIntervalMs / 1000)"
                  :max="Math.floor(probe.maxIntervalMs / 1000)"
                  step="30"
                  class="mk-field__input"
                  :disabled="probeBusy"
                  @change="saveProbeInterval"
                />
                <em class="ac-probe__unit">秒</em>
              </label>
              <button
                type="button"
                class="mk-status__action"
                :class="{ 'ac-probe--alert': health?.stale && !probe.enabled }"
                :disabled="healthProbing"
                @click="probeHealth"
              >
                {{ healthProbing ? `探测中… ${probeElapsedSec}s` : '立即探测' }}
              </button>
            </div>
          </div>
          <!-- 探针设置单独读取失败：不得静默消失（原实现整段不渲染，用户以为平台没有探针能力） -->
          <div v-else-if="configLoadFailed" class="ac-rel__note ac-rel__error">
            探针设置读取失败，无法确认能力探针开关状态
            <button type="button" class="mk-link" @click="retryConfigLoad">重试</button>
          </div>

          <div class="ac-sec__title">
            能力健康
            <span v-if="healthSummaryText" class="mk-badge" :class="healthSummaryBadge">{{ healthSummaryText }}</span>
            <span class="ac-sec__sub">
              <span v-if="health?.stale">上次探测 {{ timeAgo(health.checkedAt) }} · 结果已过期</span>
              <span v-else-if="health?.checkedAt">最近探测 {{ timeAgo(health.checkedAt) }}</span>
              <span v-else-if="health">尚未探测</span>
            </span>
          </div>
          <!-- D12：限流读数放在能力健康之前——先回答「现在是不是在挨 429」，再看单项能力 -->
          <div v-if="rateLimitReadout" class="ac-rel__note" :class="{ 'ac-rel__error': rateLimitReadout.count429 > 0 }" role="status">
            近 1 小时上游限流（429）{{ rateLimitReadout.count429 }} 次 · 冷却中模型 {{ rateLimitReadout.coolingDown }} 个
          </div>
          <!-- 失败态必须优先于旧快照可见（2026-10-14 #18） -->
          <div v-if="healthFailed" class="ac-rel__note ac-rel__error" role="alert">
            上次探测失败{{ healthFailText ? `：${healthFailText}` : '，结果不可用' }}
            <button type="button" class="mk-link" :disabled="healthProbing" @click="probeHealth">{{ healthProbing ? '探测中…' : '重试' }}</button>
          </div>
          <!-- 能力胶囊：状态色点 + 能力名 + 状态词；失败原因 / 响应耗时 / 最近探测收进 title -->
          <div v-if="health" class="ac-hpills" role="list" aria-label="模型能力健康探测">
            <span
              v-for="c in health.capabilities"
              :key="c.id"
              class="ac-hpill"
              :class="`is-${c.status}`"
              role="listitem"
              :title="capPillTitle(c)"
            >
              <span class="ac-hpill__dot" aria-hidden="true"></span>
              <span class="ac-hpill__id mono">{{ c.id }}</span>
              <span class="ac-hpill__state">{{ capStateText(c.status) }}</span>
            </span>
          </div>
          <MkLoading v-else-if="!healthFailed" inline text="探测结果加载中…" />
        </div>
      </section>

    </div>
    </template>
    <template v-else-if="tab === 'virtual'">
    <div class="ac-tab-body" id="ac-panel-virtual" role="tabpanel" aria-labelledby="ac-tab-virtual">
      <!-- ===== 虚拟学习者运行配置（2026-10-21 独立页签）=====
           速率、并发、日期模拟同属「虚拟学习者能跑多少、跑到哪天」；
           此前挂在「调用与健康」里与调用参数混读，现独立成页签。 -->
      <section v-if="isLive" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">运行配置</h3>
        </div>
        <div class="ac-body">
          <div class="ac-group">
            <div class="ac-group__title" title="出站速率、最高并发与日期模拟同属虚拟学习者通道的容量治理">容量</div>
            <div class="ac-group__fields">
              <label class="mk-field">
                <span class="mk-field__label">虚拟学习者 RPM 上限（0=不限）</span>
                <span class="ac-vl-rpm">
                  <input
                    v-model.number="vlRpmInput"
                    type="number"
                    min="0"
                    max="100000"
                    step="10"
                    class="mk-field__input"
                    aria-label="虚拟学习者专属出站 RPM 上限"
                    :disabled="vlRpmFailed"
                    :title="vlRpmFailed ? '设置未加载：已禁用编辑，避免用默认值覆盖服务端配置' : undefined"
                    @input="vlRpmDirty = true"
                    @keydown.enter.prevent="saveVlRpm"
                  />
                  <button
                    type="button"
                    class="mk-btn mk-btn--sm"
                    :disabled="!vlRpmDirty || vlRpmSaving || vlRpmFailed"
                    @click="saveVlRpm"
                  >{{ vlRpmSaving ? '保存中…' : '保存' }}</button>
                  <span v-if="vlRpmDirty" class="ac-vl-rpm__dirty">未保存</span>
                </span>
                <span v-if="vlRpmFailed" class="mk-field__hint ac-vl-rpm__failed" role="alert">设置未加载，保存已禁用（请刷新重试）</span>
              </label>
            </div>
            <VirtualLabLoadSettings />
          </div>
        </div>
      </section>
    </div>
    </template>

    <template v-else-if="tab === 'security'">
    <!-- 2026-10-15 用户重组：原四卡 2×2 宫格改成「左一（网络与 IP 访问控制）+ 右二（注册与防刷配额）」——
         左卡管「谁能连进来」（访问来源模式 + 私有网络服务两段：前者管入站来源、后者管服务端出站目标），
         右列两张小卡管「谁能注册进来」（自助注册开关 + 单 IP 每日配额），各只有一个开关，
         平铺在宫格里会把左卡挤成半屏空白。分区标题行承担组级 badge 与「保存策略」。 -->
    <div class="ac-tab-body ac-sec-body" id="ac-panel-security" role="tabpanel" aria-labelledby="ac-tab-security">
      <div class="ac-sec__title ac-sec-head">
        安全与访问
        <span class="mk-badge mk-badge--info">平台策略 · 即时生效</span>
        <button v-if="dirty.has('policy')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['policy'])">{{ saving ? '保存中…' : '保存策略' }}</button>
      </div>
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">访问来源与网络</h3>
        </div>
        <div class="ac-body ac-policy__item">
          <div class="ac-group__title" title="管理端入口允许哪些来源访问：公网 / 仅内网 / 仅白名单">访问来源模式</div>
          <!-- 原型 index.html:1793-1798 访问来源模式：radio 单选卡片
               （radiogroup + role=radio + aria-checked，Enter/Space 可切）；
               键盘契约（审核 #160）：roving tabindex（仅选中项可 Tab 进入）+ 左右方向键循环切换，
               取值与提交逻辑不变，仍为 policy.adminAccessMode -->
          <div class="ac-radio-row" role="radiogroup" aria-label="访问来源模式" @keydown="onAccessKeydown">
            <span
              v-for="(opt, i) in accessOptions"
              :key="opt.id"
              :ref="(el) => setAccessRef(el, i)"
              class="ac-radio"
              role="radio"
              :tabindex="policy.adminAccessMode === opt.id ? 0 : -1"
              :aria-checked="policy.adminAccessMode === opt.id"
              @click="setAccessMode(opt.id)"
              @keydown.enter.prevent="setAccessMode(opt.id)"
              @keydown.space.prevent="setAccessMode(opt.id)"
            >
              <span class="ac-radio__mark" aria-hidden="true">{{ policy.adminAccessMode === opt.id ? '●' : '○' }}</span>
              <span class="ac-radio__text">
                <span class="ac-radio__title">{{ opt.label }}</span>
                <span class="ac-radio__sub">{{ opt.sub }}</span>
              </span>
            </span>
          </div>
          <span v-if="policy.adminAccessMode === 'any'" class="ac-policy__warn">公网开放 · 入口无访问限制</span>
          <label v-if="policy.adminAccessMode === 'private'" class="mk-field">
            <span class="mk-field__label">额外允许的客户端 IP（每行一个，可留空）</span>
            <textarea
              class="mk-field__textarea ac-textarea"
              rows="2"
              :value="policy.adminAllowedIps.join('\n')"
              @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
              placeholder="203.0.113.10"
            ></textarea>
          </label>
        </div>
        <div class="ac-body ac-policy__item ac-policy__item--sep">
          <!-- 私有网络服务（2026-10-15 并入本卡）：访问来源模式管「谁能连进来」（入站来源），
               这条管「服务端能往哪里发请求」（出站目标）。两段同处一卡，段落标题承担原卡标题。 -->
          <div class="ac-group__title" title="服务端是否允许请求内网/私有地址：仅白名单时只放行「允许的 Host / IP」里的地址">私有网络服务</div>
          <div class="mk-seg" role="group" aria-label="私有网络服务">
            <button
              type="button"
              class="mk-seg__item"
              :class="{ 'mk-seg__item--active': policy.allowPrivateNetwork }"
              :aria-pressed="policy.allowPrivateNetwork"
              @click="policy.allowPrivateNetwork = true; markDirty('policy')"
            >
              允许
            </button>
            <button
              type="button"
              class="mk-seg__item"
              :class="{ 'mk-seg__item--active': !policy.allowPrivateNetwork }"
              :aria-pressed="!policy.allowPrivateNetwork"
              @click="policy.allowPrivateNetwork = false; markDirty('policy')"
            >
              仅白名单
            </button>
          </div>
          <label v-if="!policy.allowPrivateNetwork" class="mk-field">
            <span class="mk-field__label">允许的 Host / IP（每行一个）</span>
            <textarea
              class="mk-field__textarea ac-textarea"
              rows="2"
              :value="policy.privateNetworkHosts.join('\n')"
              @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
              placeholder="192.168.1.20"
            ></textarea>
          </label>
        </div>
      </section>
      <!-- 右列两张小卡（注册与防刷配额）：各自只有一个开关，叠成右列与左卡等高 -->
      <div class="ac-sec-stack">
      <!-- 新用户注册（live） -->
      <section v-if="isLive && registrationEnabled !== null" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">新用户注册</h3>
        </div>
        <div class="ac-body ac-policy__item">
          <!-- 2026-10-14 用户评审：原「开放注册 / 关闭注册」并排双按钮读不出是分段视图还是动作钮
               （两枚都像按钮、都带选中态，语义靠猜）。布尔配置改用 MkSwitch：一个控件 + 一个状态词。
               「当前：任何人可注册」那句状态文字随之下沉成开关的状态词（同一事实不再两处）。 -->
          <MkSwitch
            :model-value="registrationEnabled"
            :busy="registrationBusy"
            aria-label="允许新用户自助注册"
            :state-text="registrationEnabled ? '任何人均可注册' : '仅管理员创建'"
            :title="registrationEnabled ? '关闭后新账号只能由管理员手动创建' : '开放后任何人可自助注册账号'"
            @update:model-value="setRegistration"
          />
        </div>
      </section>
      <!-- 单 IP 每日注册配额（live；默认关，避免误伤同一内网/出口的正常注册） -->
      <section v-if="isLive && registerIpQuotaEnabled !== null" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">{{ IP_QUOTA_TITLE }}</h3>
        </div>
        <div class="ac-body ac-policy__item">
          <div class="ac-quota-row">
            <MkSwitch
              :model-value="registerIpQuotaEnabled"
              :busy="quotaBusy"
              :aria-label="IP_QUOTA_TITLE"
              :state-text="quotaEnabledText"
              @update:model-value="setQuotaEnabled"
            />
            <label v-if="registerIpQuotaEnabled" class="ac-quota-field">
              <span class="mk-field__label">每日上限</span>
              <input
                type="number"
                class="mk-field__input"
                min="1"
                max="100"
                :value="quotaInput"
                :disabled="quotaBusy"
                @change="onQuotaInput"
              />
              <em>个 / IP</em>
            </label>
          </div>
          <span class="ac-policy__hint">同一公网出口 IP 24 小时内最多注册 {{ quotaInput || 5 }} 个账号（批量注册风险出现时再开）</span>
        </div>
      </section>
      </div><!-- /ac-sec-stack -->
    </div>
    </template>

    <!-- 保存条（四个配置 tab 共享；脏位跨 tab 不丢）：单组脏时用该分区的保存钮，多组才出整页保存 -->
    <div v-if="dirty.size > 1" class="ac-save">
      <span class="ac-save__dot"></span>
      <span>{{ dirtyGroups.join(' + ') }} · {{ dirty.size }} 组未保存变更</span>
      <button type="button" class="mk-link" :disabled="saving" @click="discardAll">放弃</button>
      <button type="button" class="ac-save__primary" :disabled="saving" @click="saveAll">
        {{ saving ? '保存中…' : '保存变更' }}
      </button>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
/* Eye 与 EyeOff 成对使用（密钥显隐两态）：此前只导入了 EyeOff，
   点「显示密钥」后切到 <Eye> 是空白图标（f66cd78d 漏了孪生图标，2026-09-29 补） */
import { Eye, EyeOff } from 'lucide-vue-next'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { dataSource, isLive } from './store'
import ModelRegistryOverview from './ModelRegistryOverview.vue'
import ModelProvidersPanel from './ModelProvidersPanel.vue'
import InfraModelsPanel from './InfraModelsPanel.vue'
import { splitUpstreamByRegistry } from './modelNameMatch'
import VirtualLabLoadSettings from './VirtualLabLoadSettings.vue'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  liveRunModelTest,
  liveSaveNetworkPolicy,
  timeAgo,
  errMsg,
  liveFailures,
  loadLiveData,
  registrationEnabled,
  registerIpQuotaEnabled,
  registerIpDailyQuota,
  updateRegistrationSetting,
  updateRegisterIpQuotaSetting
} from './live'
import { adminPlatformSettingsApi, adminCapabilityProbeApi, adminSystemApi, adminApiConfigApi, adminVirtualLearnersApi } from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import { toast } from '@/utils/toast'

/* ---------- 宿主：接入与模型 · 调用与健康 · 虚拟学习者 · 安全与访问 ----------
   ?tab=model|overview 双向同步；只读 ModelRegistryOverview 的别名切片挂在接入页的默认生成参数卡里。
   2026-10-19 用户拍板「外挂能力」从本宿主拆回独立页（/admin/addons，侧栏 Skill 组）：
   原来那个页签与它的角标计数、刷新分支一并撤除；旧深链 ?tab=addons 由路由改投。 */
const AC_TABS = ['access', 'routing', 'virtual', 'security'] as const
type AcTab = (typeof AC_TABS)[number]

/* 文案单源（R6 复读单源化）：卡标题与开关的 aria-label 共用一份 */
const IP_QUOTA_TITLE = '单 IP 每日注册配额'
/** 旧页签键别名归一：站内「配置 →」与量测脚本曾用 ?tab=model / ?tab=registry / ?tab=model-routing；
    这些键不在白名单，watcher 原会静默把用户送到「接入与验证」，深链/书签永远落不到目标页签。
    2026-10-14：connection/overview→access、runtime→routing；
    2026-10-21 用户拍板：虚拟学习者配置独立成页签 → virtual-learners→virtual。 */
const TAB_ALIAS: Record<string, AcTab> = {
  model: 'access',
  registry: 'access',
  connection: 'access',
  overview: 'access',
  runtime: 'routing',
  'model-routing': 'routing',
  'virtual-learners': 'virtual',
}
const tab = ref<AcTab>('access')
/** 底部保存条挂载的 tab（脏位跨 tab 不丢）：四个配置页签都可写 */
const isConfigTab = computed(() => ['access', 'routing', 'virtual', 'security'].includes(tab.value))
const route = useRoute()
const router = useRouter()
/** 页签定义（CM1：收敛到 MkSubTabs）。
    2026-10-19 三页签 → 2026-10-21 四页签：虚拟学习者配置从「调用与健康」独立成页签
    （用户：「虚拟学习者的配置，先独立一个tab在模型与接入里面」）。 */
const acTabs = computed(() => [
  { key: 'access', label: '接入与模型' },
  { key: 'routing', label: '调用与健康' },
  { key: 'virtual', label: '虚拟学习者' },
  { key: 'security', label: '安全与访问' },
])
function onTabChange(key: string) {
  switchTab(key as AcTab)
}
/** 供应商面板（BYOK）：页头「刷新注册表」与写后重取都走它的 refresh */
const providersRef = ref<{ refresh?: (force?: boolean) => void } | null>(null)
/** 已登记模型 id（面板回传）：上游清单的关系句与折叠共用这一次计算 */
const registeredModelIds = ref<string[]>([])
/* D12（2026-10-22 拍板 B）：近 1 小时 429 / 冷却模型读数。
   数据来自只读的 model-registry 总览（429 计数取 agent_call_logs，冷却取部署健康快照），
   只在「调用与健康」页签加载，不额外增加接入页的首屏请求。 */
const rateLimitReadout = ref<{ windowMinutes: number; count429: number; coolingDown: number } | null>(null)
async function loadRateLimitReadout() {
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    rateLimitReadout.value = (res as { data?: { data?: { rateLimit?: typeof rateLimitReadout.value } } })?.data?.data?.rateLimit ?? null
  } catch {
    rateLimitReadout.value = null
  }
}
watch(tab, (t) => {
  if (t === 'routing' && isLive.value) void loadRateLimitReadout()
}, { immediate: true })

/** 注册表读数（只读总览回传）：上游清单与「已添加」的对照只用 models 这一段。
    与总览 tab 的 getModelRegistry 是同一份接口，不重复请求。 */
interface RegistryDefaults {
  models: Array<{ id: string; providerId: string; fallbacks: string[] }>
}
const registryDefaults = ref<RegistryDefaults | null>(null)
/** 别名映射切片：供应商面板改完注册表后在同一页签内就地重取，避免读旧表 */
const registryRef = ref<{ refresh?: (force?: boolean) => Promise<void> | void } | null>(null)
watch(
  () => route?.query?.tab,
  (t) => {
    const raw = typeof t === 'string' ? t : ''
    const alias = TAB_ALIAS[raw]
    const v = (AC_TABS as readonly string[]).includes(raw) ? (raw as AcTab) : alias ?? null
    if (v) {
      if (v !== tab.value) tab.value = v
      /* 旧键已展开成有效键：回写 URL（switchTab 的 replace 同款），书签/深链不再停在别名 */
      if (alias && route && router && route.query.tab !== v) {
        void router.replace({ query: { ...route.query, tab: v } })
      }
    } else if (tab.value !== 'access') {
      tab.value = 'access'
    }
  },
  { immediate: true }
)
function switchTab(t: AcTab) {
  tab.value = t
  if (route && router && route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}

/* ---------- AI 能力健康快照 ---------- */
interface CapHealth {
  id: string
  status: 'operational' | 'degraded' | 'unavailable' | 'unknown'
  checkedAt: string | null
  latencyMs: number | null
  message: string
  /** 失败码（PROBE_TIMEOUT / AUTH_INVALID / QUOTA_EXHAUSTED…）：服务端已记下，前端不可吞掉 */
  failureCode?: string | null
}
interface CapSnapshot {
  overall: CapHealth['status']
  checkedAt: string | null
  stale: boolean
  capabilities: CapHealth[]
}
const health = ref<CapSnapshot | null>(null)
const healthFailed = ref(false)
/** 最近一次探测失败原因（客户端异常原文：超时 / 网络 / 5xx）——失败态可见时同显 */
const healthFailText = ref('')
const healthProbing = ref(false)
/** 探测进行中的已用秒数（探测最长可达数分钟，纯「探测中…」读不出是否还在跑） */
const probeElapsedSec = ref(0)
let probeTimer: ReturnType<typeof setInterval> | null = null

/** 能力胶囊的状态词（与卡头 healthLabel 同词表：未知档统一叫「待确认」，不谎称进行中） */
const CAP_STATE_TEXT: Record<CapHealth['status'], string> = {
  operational: '正常',
  degraded: '降级',
  unavailable: '不可用',
  unknown: '待确认',
}
function capStateText(status: CapHealth['status']): string {
  return CAP_STATE_TEXT[status] ?? status
}
/** 胶囊悬停详情：探测结论常显在胶囊上，证据（服务端消息 / 失败码 / 响应耗时 / 探测时间）进 title */
function capPillTitle(c: CapHealth): string {
  const parts = [capStateText(c.status), c.message]
  if (c.failureCode) parts.push(`失败码：${c.failureCode}`)
  parts.push(c.latencyMs != null ? `响应 ${c.latencyMs}ms` : '无响应耗时')
  parts.push(c.checkedAt ? `最近探测 ${timeAgo(c.checkedAt)}` : '尚未探测')
  return parts.join(' · ')
}

/** 汇总角标：「5 能力 · 1 异常」——异常 = degraded/unavailable；unknown 归「待确认」，不假装实时 */const healthSummaryText = computed(() => {
  const caps = health.value?.capabilities ?? []
  if (!caps.length) return ''
  const abnormal = caps.filter((c) => c.status === 'unavailable' || c.status === 'degraded').length
  const unknown = caps.filter((c) => c.status === 'unknown').length
  if (abnormal > 0) return `${caps.length} 能力 · ${abnormal} 异常`
  if (unknown > 0) return `${caps.length} 能力 · ${unknown} 待确认`
  return `${caps.length} 能力 · 全部正常`
})
const healthSummaryBadge = computed(() => {
  const caps = health.value?.capabilities ?? []
  if (!caps.length) return 'mk-badge--muted'
  if (caps.some((c) => c.status === 'unavailable')) return 'mk-badge--bad'
  if (caps.some((c) => c.status === 'degraded')) return 'mk-badge--warn'
  if (caps.some((c) => c.status === 'unknown')) return 'mk-badge--muted'
  return 'mk-badge--ok'
})

/* 探测时间单源 = 连接卡卡角 badge（connBadge「N 前」，P3 2026-10-04 撤状态条「上次探测」复读）。
   同页时间源统一纪律保留：badge 与能力行「最近探测」同源（健康快照 checkedAt），
   DB lastCheckedAt 仅在快照不可用时兜底——消除「8 分钟前 vs 9 小时前」双写分叉 */

/* 未知档统一用「待确认」（与同页汇总角标 healthSummaryText 同词，2026-10-11 走查：
   原卡头「状态确认中」与角标「待确认」同屏两词，且「确认中」谎称进行中——探针关闭时
   不会自动探测，该档会一直挂着） */
const healthLabel = computed(
  () =>
    ({ operational: '全部正常', degraded: '部分降级', unavailable: '存在不可用', unknown: '待确认' })[
      health.value?.overall || 'unknown'
    ]
)
const healthLabelTip = computed(() =>
  !health.value?.overall || health.value.overall === 'unknown'
    ? '状态未知：能力探针关闭或尚未探测，可点「立即探测」获取各能力状态'
    : ''
)
const healthBadgeCls = computed(
  () =>
    ({
      operational: 'mk-badge--ok',
      degraded: 'mk-badge--warn',
      unavailable: 'mk-badge--bad',
      unknown: 'mk-badge--muted',
      '': 'mk-badge--muted',
    } as Record<string, string>)[health.value?.overall || '']
)

/** 页面进入自动探测（方案 c）：组件挂载期间快照过期时自动补一次探测，避免「已过期」常驻；
    只自动一次（避免 deep watch 重复触发烧 LLM 调用），重新进入页面（重新挂载）再触发 */
let autoProbeDone = false
async function loadHealth() {
  try {
    const res = await adminSystemApi.getCapabilities()
    health.value = res.data?.data ?? res.data ?? null
    healthFailed.value = false
    if (health.value?.stale && !autoProbeDone) {
      // 探针设置未就绪时先等它，避免「探针已关闭」却自动探测：
      // 自动探测与启动金丝雀一样，应受能力探针开关约束。
      if (!probe.loaded) await loadProbe()
      if (!probe.enabled) return
      autoProbeDone = true
      void probeHealth()
    }
  } catch {
    // 失败标记不可用（不再显示永久的「加载中…」），保留旧快照供重试后对比
    healthFailed.value = true
  }
}

/** 静默刷新快照（不改 healthFailed）：探测失败后拉一次，取服务端已记下的 failureCode */
async function refreshHealthSnapshot() {
  try {
    const res = await adminSystemApi.getCapabilities()
    const snap = (res.data?.data ?? res.data ?? null) as CapSnapshot | null
    if (snap) health.value = snap
  } catch {
    /* 保留旧快照 */
  }
}

async function probeHealth() {
  if (healthProbing.value) return
  healthProbing.value = true
  healthFailText.value = ''
  probeElapsedSec.value = 0
  if (probeTimer) clearInterval(probeTimer)
  probeTimer = setInterval(() => { probeElapsedSec.value += 1 }, 1000)
  try {
    const res = await adminSystemApi.probeCapabilities()
    health.value = res.data?.data ?? res.data ?? null
    healthFailed.value = false
  } catch (e) {
    healthFailed.value = true
    healthFailText.value = errMsg(e)
    // 客户端失败（超时/网络）时，服务端可能已落盘结构化失败码——拉一次快照补齐
    void refreshHealthSnapshot()
  } finally {
    healthProbing.value = false
    if (probeTimer) { clearInterval(probeTimer); probeTimer = null }
  }
}

/* ---------- 表单状态（live 一套交互） ---------- */
/**
 * 接入域（live 层 getConfig）读取失败：表单全空 + 卡内 alert 显式说明「下方为空不代表未配置」。
 * 原实现失败时 keySet/models 全为初始值，读数伪装成确定态「未配置 / 未拉取」——把「读不到」
 * 说成「没配置」，是审计不可接受的假信号。（2026-10-14 页首 KPI 带撤除后，失败态只剩卡内
 * alert 一个出口，该 alert 因此不可省。）失败态由 liveFailures.apiConfig 驱动（live.ts 已导出；
 * 读取成功后自动清除，无需本地维护）。
 */
const apiConfigFailed = computed(() => !!liveFailures.value.apiConfig)
/** 重试：重新走中央加载器拉取 apiConfig 域（liveFetchAt 未落 → 不会被 TTL 缓存跳过） */
function retryApiConfigLoad() {
  void loadLiveData()
}
const form = reactive({
  apiUrl: '',
  apiKey: '',
  defaultModel: '',
  defaultReasoningModel: '',
  defaultEvaluationModel: '',
  defaultThinkingMode: 'default' as 'default' | 'enabled' | 'disabled',
  defaultReasoningEffort: 'default' as 'default' | 'low' | 'high' | 'max',
  defaultResponseFormat: 'none' as 'none' | 'json_object'
})
const policy = reactive({
  adminAccessMode: 'private' as 'loopback' | 'private' | 'any',
  adminAllowedIps: [] as string[],
  allowPrivateNetwork: true,
  privateNetworkHosts: [] as string[]
})
const fetchedModels = ref<string[]>([])
const keySet = ref(false)
const keyVisible = ref(false)
const connectionStatus = ref('unknown')
/** 本次会话内「连接并拉取」成功的时刻（connBadge「N 前」的时间源优先级高于 DB 落库值） */
const connCheckedAt = ref('')
/** 最近一次「连接并拉取」的失败原因：展示在模型清单空态，避免错误上下文丢失（刷新即消失） */
const fetchError = ref('')
/** 曾成功拉取过模型列表（含从已保存配置载入）：此后提交才携带 availableModels，避免空数组清空后端列表 */
const modelsFetchedOnce = ref(false)
/** 模型清单的拉取来源端点:与表单地址一致才允许随连接保存 */
const fetchedModelsEndpoint = ref('')
/** 已保存的服务地址：endpoint 被改动且 Key 留空时提示重新输入密钥 */
const savedApiUrl = ref('')

const dirty = ref<Set<string>>(new Set())
/** 正在保存的域（#19）：保存请求在途时，实时配置会因这次保存而回显、触发下方守卫 watch，
 *  而 dirty 要到请求全部返回后才清。守卫据此把在途域排除出「未保存」，避免「保存成功却被
 *  问要不要丢弃未保存修改」的假信号（更坏情况是点「覆盖」丢改动）。 */
const savingGroups = ref<Set<string>>(new Set())
function markDirty(group: string) {
  dirty.value = new Set([...dirty.value, group])
}

/** 脏位分域标注：5 组 → 保存条列出具体未保存组（连接/生成参数/策略/可靠性/探测） */
const DIRTY_GROUP_LABELS: Record<string, string> = {
  conn: '连接',
  route: '生成参数',
  policy: '策略',
  reliability: '可靠性',
  probe: '探测'
}
const dirtyGroups = computed(() => [...dirty.value].map((g) => DIRTY_GROUP_LABELS[g] || g))

function splitLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean)
}

/* AI 可靠性（live 加载） */
interface Reliability {
  maxUpstreamAttempts: number
  maxTransportRetries: number
  maxLogicalRetries: number
  defaultRequestTimeoutMs: number
  retryBaseDelayMs: number
  maxRetryAfterMs: number
  jitterEnabled: boolean
  platformRpmLimit: number
}
const reliability = ref<Reliability | null>(null)
const configLoadFailed = ref(false)

const probe = reactive({
  enabled: false,
  intervalSec: 120,
  minIntervalMs: 10_000,
  maxIntervalMs: 86_400_000,
  loaded: false,
  lastEnabled: false,
  lastIntervalSec: 120
})
/** 探针开关/间隔独立保存中状态（不走底部统一保存条，热生效） */
const probeBusy = ref(false)

async function persistProbe(payload: { enabled?: boolean; intervalMs?: number }) {
  if (probeBusy.value || !probe.loaded) return
  probeBusy.value = true
  try {
    const res = await adminCapabilityProbeApi.updateSettings(payload)
    const d = res.data?.data ?? {}
    if (typeof d.enabled === 'boolean') {
      probe.enabled = d.enabled
      probe.lastEnabled = d.enabled
    }
    if (typeof d.intervalMs === 'number') {
      probe.intervalSec = Math.round(d.intervalMs / 1000)
      probe.lastIntervalSec = probe.intervalSec
    }
    toast.success(payload.enabled === false ? '能力探针已关闭，健康快照不再自动刷新' : '探针设置已保存并生效')
  } catch (e) {
    toast.error(`探针设置保存失败：${errMsg(e)}`)
  } finally {
    probeBusy.value = false
  }
}

async function setProbeEnabled(on: boolean) {
  await persistProbe({ enabled: on })
}

async function saveProbeInterval(e?: Event) {
  // 从 DOM 取值（change 触发时 v-model 可能尚未刷新，直接读 input 最可靠）
  let raw: string | undefined
  if (e && e.target instanceof HTMLInputElement) raw = e.target.value
  const sec = raw !== undefined ? Number(raw) : probe.intervalSec
  const minSec = Math.ceil(probe.minIntervalMs / 1000)
  const maxSec = Math.floor(probe.maxIntervalMs / 1000)
  if (!Number.isFinite(sec)) { probe.intervalSec = probe.lastIntervalSec; return }
  probe.intervalSec = Math.min(maxSec, Math.max(minSec, Math.round(sec)))
  if (probe.intervalSec === probe.lastIntervalSec) return
  await persistProbe({ intervalMs: probe.intervalSec * 1000 })
}

/** 可靠性设置硬上限(后端 platform settings GET 返回,前端不再自带一套) */
const reliabilityLimits = ref<Record<string, number> | null>(null)
/** 最近一次加载的设置快照:数字输入被清空时保存前回退到该值(后端要求全整数字段) */
const reliabilityBase = ref<Record<string, number | boolean> | null>(null)
function limMax(field: string, fallback: number): number {
  return Number(reliabilityLimits.value?.[field] ?? fallback)
}
function limMin(field: string, fallback: number): number {
  return Number(reliabilityLimits.value?.[field] ?? fallback)
}

/** 当前重试配置下模型降级是否永不触发(executor 守卫语义:1 + 传输重试 < 上游最大尝试) */
const fallbackDisabled = computed(() => {
  const r = reliability.value
  if (!r) return false
  const upstream = Number(r.maxUpstreamAttempts)
  const transport = Number(r.maxTransportRetries)
  if (!Number.isInteger(upstream) || !Number.isInteger(transport)) return false
  return upstream <= 1 || 1 + transport >= upstream
})

async function loadReliability() {
  try {
    const res = await adminPlatformSettingsApi.getReliabilitySettings()
    const s = res.data?.data?.settings ?? res.data?.data ?? {}
    reliability.value = {
      maxUpstreamAttempts: Number(s.maxUpstreamAttempts ?? 3),
      maxTransportRetries: Number(s.maxTransportRetries ?? 1),
      maxLogicalRetries: Number(s.maxLogicalRetries ?? 1),
      defaultRequestTimeoutMs: Number(s.defaultRequestTimeoutMs ?? 600000),
      retryBaseDelayMs: Number(s.retryBaseDelayMs ?? 2000),
      maxRetryAfterMs: Number(s.maxRetryAfterMs ?? 30000),
      jitterEnabled: s.jitterEnabled !== false,
      platformRpmLimit: Number(s.platformRpmLimit ?? 0)
    }
    // 后端 hardLimits 是校验唯一真源:表单 min/max 与保存前的空值回退都以它为准
    reliabilityLimits.value = (res.data?.data?.hardLimits ?? null) as Record<string, number> | null
    reliabilityBase.value = { ...reliability.value }
    configLoadFailed.value = false
  } catch {
    reliability.value = null
    configLoadFailed.value = true
  }
}

/* ---------- 虚拟学习者出站速率（2026-10-15 用户重组：自「压测参数」卡并入「出站速率」组） ----------
   与平台全局 RPM 是同屏对照的两条独立上限，但保存链不同：平台项属 reliability 组随「调用参数」
   保存钮提交，虚拟学习者项走 updateVirtualLabSettings——所以本字段自带上「保存」钮与脏位，
   不进宿主的统一保存条（跨链合并会把两条提交语义缠在一起）。 */
const vlRpmInput = ref(0)
const vlRpmDirty = ref(false)
const vlRpmSaving = ref(false)
/** 设置未加载位：getVirtualLabSettings 失败时禁用写控件，禁止拿初始 0 覆盖服务端已保存的上限 */
const vlRpmFailed = ref(false)

async function loadVlRpm() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const value = Math.max(0, Number(res.data?.data?.settings?.virtualLearnerRpmLimit ?? 0) || 0)
    if (!vlRpmDirty.value) vlRpmInput.value = value
    vlRpmFailed.value = false
  } catch {
    vlRpmFailed.value = true
  }
}

async function saveVlRpm() {
  if (vlRpmSaving.value || !vlRpmDirty.value || vlRpmFailed.value) return
  const value = Math.max(0, Math.min(100000, Math.round(Number(vlRpmInput.value) || 0)))
  vlRpmInput.value = value
  vlRpmSaving.value = true
  try {
    await adminVirtualLearnersApi.updateVirtualLabSettings({ virtualLearnerRpmLimit: value })
    vlRpmDirty.value = false
    toast.success(value > 0 ? `虚拟学习者 RPM 上限已设为 ${value}` : '虚拟学习者 RPM 已设为不限')
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    vlRpmSaving.value = false
  }
}

/** 探针设置加载中共享 promise：loadHealth 的自动探测需要先知道开关状态，
    避免与 watch 并发重复拉取；同一时刻只发一次 GET */
let probeLoadPromise: Promise<void> | null = null
function loadProbe(): Promise<void> {
  if (probeLoadPromise) return probeLoadPromise
  const run = (async () => {
    try {
      const res = await adminCapabilityProbeApi.getSettings()
      const d = res.data?.data ?? {}
      probe.enabled = d.enabled === true
      probe.lastEnabled = probe.enabled
      const ms = Number(d.intervalMs)
      probe.intervalSec = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 120
      probe.lastIntervalSec = probe.intervalSec
      if (typeof d.minIntervalMs === 'number') probe.minIntervalMs = d.minIntervalMs
      if (typeof d.maxIntervalMs === 'number') probe.maxIntervalMs = d.maxIntervalMs
      probe.loaded = true
      configLoadFailed.value = false
    } catch {
      probe.loaded = false
      configLoadFailed.value = true
    }
  })()
  probeLoadPromise = run
  void run.finally(() => {
    if (probeLoadPromise === run) probeLoadPromise = null
  })
  return run
}

/** 配置域重试：重新拉取可靠性 + 探测设置 */
function retryConfigLoad() {
  void loadReliability()
  void loadProbe()
}

function applyLiveConfig() {
  if (!cfg.value) return
  form.apiUrl = cfg.value.apiUrl
  form.apiKey = ''
  form.defaultModel = cfg.value.defaultModel
  form.defaultReasoningModel = cfg.value.defaultReasoningModel
  form.defaultEvaluationModel = cfg.value.defaultEvaluationModel
  form.defaultThinkingMode = cfg.value.defaultThinkingMode || 'default'
  form.defaultReasoningEffort = cfg.value.defaultReasoningEffort || 'default'
  form.defaultResponseFormat = cfg.value.defaultResponseFormat === 'json_object' ? 'json_object' : 'none'
  fetchedModels.value = [...cfg.value.availableModels]
  fetchedModelsEndpoint.value = cfg.value.apiUrl
  keySet.value = cfg.value.apiKeyConfigured
  connectionStatus.value = cfg.value.connectionStatus
  savedApiUrl.value = cfg.value.apiUrl
  modelsFetchedOnce.value = true
  Object.assign(policy, cfg.value.networkPolicy)
  dirty.value = new Set()
}

watch(
  () => [dataSource.value, cfg.value] as const,
  async () => {
    // 全局刷新/数据源切换会用新配置覆盖表单:有未保存修改时先确认,拒绝则保留表单仅刷新后台状态
    // #19：把「正在保存」的域排除在未保存之外——保存带来的配置回显会先于 dirty 清除触发本 watch，
    // 不过滤就会在保存成功那一刻弹「丢弃未保存的配置修改」，把成功呈现成未保存。
    const pendingGroups = [...dirty.value].filter((g) => !savingGroups.value.has(g))
    if (pendingGroups.length > 0) {
      const ok = await askConfirm({
        title: '丢弃未保存的配置修改?',
        message: `配置数据已刷新,继续将覆盖以下未保存的修改:${pendingGroups.map((g) => DIRTY_GROUP_LABELS[g] || g).join(' / ')}。`,
        confirmText: '覆盖'
      })
      if (ok) applyLiveConfig()
    } else {
      applyLiveConfig()
    }
    if (!reliability.value) void loadReliability()
    if (!probe.loaded) void loadProbe()
    void loadVlRpm()
    void loadHealth()
  },
  { immediate: true, deep: true }
)

// 路由离开守卫:与其他管理页(Skill 详情页等)同款,未保存修改不静默丢失
onBeforeRouteLeave(async () => {
  if (dirty.value.size === 0) return true
  const ok = await askConfirm({
    title: '有未保存的配置修改',
    message: `尚未保存的配置组:${dirtyGroups.value.join(' / ')}。离开将丢弃这些修改,确认离开?`,
    confirmText: '丢弃并离开'
  })
  return ok === true
})

function onBeforeUnloadHandler(e: BeforeUnloadEvent) {
  if (dirty.value.size > 0) {
    e.preventDefault()
    e.returnValue = ''
  }
}
window.addEventListener('beforeunload', onBeforeUnloadHandler)
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnloadHandler)
  if (probeTimer) { clearInterval(probeTimer); probeTimer = null }
})

const models = computed(() => fetchedModels.value)

/**
 * 上游清单 ↔ 平台登记表的对齐（2026-10-16 用户走查）：连接卡只说关系（上游几个、对上几个），
 * 逐个名字的清单由模型清单的「上游未登记」折叠承载。
 * 登记 id 有两个来源、都来自同一份注册表读数：接入页由 ModelProvidersPanel 经 @registered 回传，
 * 路由页由 ModelRegistryOverview 经 @defaults 回传——谁在屏上用谁，未到时按 null 算
 * （此时只说「上游返回 N 个」，不说对上几个，避免「对上 0 个」这种假话）。
 */
const registeredIds = computed<string[] | null>(() => {
  if (registeredModelIds.value.length) return registeredModelIds.value
  const fromRegistry = registryDefaults.value?.models
  return fromRegistry ? fromRegistry.map((m) => m.id) : null
})
const upstreamSplit = computed(() => splitUpstreamByRegistry(models.value, registeredIds.value ?? []))
/** 登记表是否已回来：未回来时只说「上游 N 个」 */
const upstreamReady = computed(() => registeredIds.value !== null)

/**
 * 供应商面板改过注册表（增删改或改密钥）：别名映射与上游对照都是上一次读数的快照，
 * 先作废并就地重取，避免同一页签里读到旧表。接入页自己的登记 id 由面板当场回传。
 */
function onProvidersChanged() {
  registryDefaults.value = null
  void registryRef.value?.refresh?.(true)
}

/** 上游清单与登记表的读数（空串 = 无清单可谈，模板走空态分支）：只报数字，不写解释句 */
const upstreamSummary = computed(() => {
  const total = models.value.length
  if (!total) return ''
  if (!upstreamReady.value) return `已拉取 ${total} 个`
  const matched = upstreamSplit.value.registered.length
  return `已拉取 ${total} 个 · ${matched} 个已添加`
})

/**
 * 当前清单是否已落盘（F8-2）：拉取只写本页内存 ref，只有随「保存连接」进 availableModels 才持久化。
 * 判定条件与 saveGroups 的归属规则（`fetchedModelsEndpoint === form.apiUrl` 才携带）严格对齐——
 * 即「下一次保存连接会落盘、但后端现值还不是它」时才提示，避免改地址未拉取时误报。
 */
const hasUnsavedModels = computed(() => {
  if (!models.value.length) return false
  if (fetchedModelsEndpoint.value !== form.apiUrl.trim()) return false
  const saved = cfg.value?.availableModels ?? []
  return models.value.length !== saved.length || models.value.some((m, i) => m !== saved[i])
})

/** 思考是否非关闭态（`defaultThinkingMode !== 'disabled'`）——只作「思考强度」的可用性判据。
    2026-10-14：原「启用思考」开关（setThinkingOn）已删，它与「思考模式」下拉是同一字段的两个控件：
    开关关掉 ⇔ 下拉选「关闭」，且勾上只能落到「跟随模型默认」，表达不了「强制开启」（有损视图）。 */
const thinkingOn = computed(() => form.defaultThinkingMode !== 'disabled')

function setThinkingMode(v: string) {
  if (v === 'default' || v === 'enabled' || v === 'disabled') {
    form.defaultThinkingMode = v
    if (v === 'disabled') form.defaultReasoningEffort = 'default'
    markDirty('route')
  }
}
function setEffort(v: string) {
  if (v === 'default' || v === 'low' || v === 'high' || v === 'max') {
    form.defaultReasoningEffort = v
    markDirty('route')
  }
}

/* 2026-10-21 用户走查：平台模型按 Skill 配置，默认路由三行退役（含解析读数与「未登记」警示）。
   本卡只保留 Skill 未覆盖时仍会继承的思考 / 结构化输出默认。 */
/* 降级内联提示（原型 index.html:1812 statusbar）：与页面能力健康卡同源（health 快照），
   只列异常/不可用项；无异常或无快照时整条省略（不硬造）。 */
const routeWarnText = computed(() => {
  const caps = health.value?.capabilities ?? []
  const bad = caps.filter((c) => c.status === 'unavailable' || c.status === 'degraded')
  if (!bad.length) return ''
  const names = bad.map((c) => c.message || c.id).slice(0, 2).join('、')
  return `${bad.length} 项能力降级 / 不可用：${names}${bad.length > 2 ? ' 等' : ''}`
})
/* modelListTitle / routeTitle 两个说明 computed 随页首 KPI 带一并删除（2026-10-14）：
   它们只喂过那三块 MkKpi 的 title。对应的诚实性提示改由卡内承接——模型清单卡的
   「本次拉取未保存」徽标 + 持久化说明行、路由行的逐条 title。 */
/* 2026-10-04 状态条退役：页头红/黄/绿基调 statusTone 随状态条整块删除（读取失败信号由
   接入卡内 mk-alert + KPI 卡「—」读数承载，不再有整页基调色） */
const connBadge = computed(() => {
  // 附「N 前」时间戳（P1#32 子集）：连接状态是上次连通性验证的结果，无时间的「连接正常」
  // 会把陈旧快照读成实时健康。时间源 = 本次会话刚拉取成功的时刻，否则退回 DB lastCheckedAt
  // （与 connectionStatus 同源；不用健康快照 checkedAt——那是能力探测时间，语义不同）
  const at = connCheckedAt.value || cfg.value?.lastCheckedAt || ''
  const suffix = at ? ` · ${timeAgo(at)}` : ''
  if (connectionStatus.value === 'connected') return { cls: 'mk-badge--ok', text: `连接正常${suffix}` }
  if (connectionStatus.value === 'failed') return { cls: 'mk-badge--bad', text: '上次拉取失败' }
  return { cls: 'mk-badge--muted', text: '连接未探测' }
})
/** connBadge 悬停口径：说明「正常/失败」是什么时候、什么动作留下的，不冒充实时探活 */
const connBadgeTitle = computed(() => {
  const at = connCheckedAt.value || cfg.value?.lastCheckedAt || ''
  const when = at ? `上次验证：${new Date(at).toLocaleString('zh-CN', { hour12: false })}` : '尚无验证记录'
  return `${when}（「连接并拉取」成功/失败时更新）。连接状态为上次拉取的结果，非实时检测结果`
})

/** 已配置密钥但改了服务地址且 Key 留空：密钥不会随地址迁移，需提示重新输入 */
const keyHintNeeded = computed(
  () => keySet.value && !!form.apiUrl && form.apiUrl !== savedApiUrl.value && !form.apiKey.trim()
)

const accessOptions = [
  { id: 'loopback' as const, label: '仅本机', sub: 'localhost / 127.0.0.1' },
  { id: 'private' as const, label: '私有网段（推荐）', sub: '本机 + RFC1918 局域网' },
  { id: 'any' as const, label: '不限制', sub: '不建议用于公网' }
]
/** 访问来源模式切换：取值与提交逻辑不变（仅脏位标记），控件由分段按钮改为 radio 卡片 */
function setAccessMode(mode: 'loopback' | 'private' | 'any') {
  if (policy.adminAccessMode === mode) return
  policy.adminAccessMode = mode
  markDirty('policy')
}

/* 访问来源模式键盘契约（审核 #160）：roving tabindex（仅选中项可 Tab 进入）
   + 方向键循环切换并移动焦点——此前三项均 tabindex=0，键盘要按三次 Tab 才穿过 */
const accessEls = ref<(HTMLElement | null)[]>([])
function setAccessRef(el: unknown, i: number) {
  accessEls.value[i] = (el as HTMLElement) || null
}
function onAccessKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = accessOptions.length
  const cur = accessOptions.findIndex((o) => o.id === policy.adminAccessMode)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % n
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else next = n - 1
  e.preventDefault()
  setAccessMode(accessOptions[next].id)
  void nextTick(() => accessEls.value[next]?.focus())
}

/* ---------- 操作 ---------- */
const fetching = ref(false)
const testing = ref(false)
const saving = ref(false)
const testModel = ref('')
const testResult = ref<{ ok: boolean; text: string; latency?: string; usage?: string } | null>(null)

/** 测试模型默认选中项：优先配置里的默认对话模型，其次第一个非嵌入/重排序模型。
 *  不能直接取 ms[0]——上游清单是按字母排的，首个是 `BAAI/bge-large-en-v1.5`（向量模型），
 *  用 chat 端点测它只会回「Model does not exist. Please check it carefully.」，
 *  看着像配置写错了（2026-10-22 走查实测）。 */
const NON_CHAT_MODEL_PATTERN = /embedding|rerank|bge-/i
/** D7（2026-10-22 拍板 B）：非对话模型仍留在下拉里（可验证「它确实不能 chat」），
    但选项文案必须自带提示，避免运营误选后把预期失败读成配置错误。 */
const RERANK_MODEL_PATTERN = /rerank/i
function modelTestLabel(m: string): string {
  if (!NON_CHAT_MODEL_PATTERN.test(m)) return m
  return `${m}（${RERANK_MODEL_PATTERN.test(m) ? '重排' : '向量'}模型 · chat 测试不适用）`
}
function modelTestHint(m: string): string {
  return NON_CHAT_MODEL_PATTERN.test(m)
    ? '该模型不是对话模型，连通性测试失败属预期结果，不代表配置错误'
    : ''
}
watch(models, (ms) => {
  if (!ms.length) return
  if (testModel.value && ms.includes(testModel.value)) return
  const configured = form.defaultModel && ms.includes(form.defaultModel) ? form.defaultModel : ''
  const chatLike = ms.find((m) => !NON_CHAT_MODEL_PATTERN.test(m))
  testModel.value = configured || chatLike || ms[0]
}, { immediate: true })

async function fetchModels() {
  if (fetching.value || !form.apiUrl) return
  fetching.value = true
  try {
    const list = await liveFetchModels(form.apiUrl, form.apiKey)
    fetchedModels.value = list
    fetchedModelsEndpoint.value = form.apiUrl.trim()
    modelsFetchedOnce.value = true
    connectionStatus.value = 'connected'
    connCheckedAt.value = new Date().toISOString()
    fetchError.value = ''
    markDirty('conn')
    toast.info(list.length ? `已获取 ${list.length} 个模型，记得保存` : '连接成功，但服务未返回模型列表')
  } catch (e) {
    connectionStatus.value = 'failed'
    connCheckedAt.value = new Date().toISOString()
    fetchError.value = errMsg(e)
    toast.error(`连接失败：${errMsg(e)}`)
  } finally {
    fetching.value = false
  }
}

async function runTest() {
  if (testing.value || !testModel.value) return
  testing.value = true
  testResult.value = null
  const started = Date.now()
  try {
    const r = await liveRunModelTest({
      apiUrl: form.apiUrl,
      apiKey: form.apiKey,
      model: testModel.value,
      prompt: '用一句话介绍你自己。'
    })
    testResult.value = {
      ok: true,
      /* 原文全量保留（截断只由 .ac-test__text 的 CSS 承担）：title 可核对完整回文（审核 #162） */
      text: r.text,
      latency: r.latencyMs ? `${r.latencyMs}ms` : `${Date.now() - started}ms`,
      usage: r.usage
    }
  } catch (e) {
    testResult.value = { ok: false, text: errMsg(e) }
  } finally {
    testing.value = false
  }
}

/** 按域保存：只提交传入且处于脏状态的域，不动其他未保存改动。
    UI 在每个分段的标题上挂「保存」，调用方传该段对应的域。 */
async function saveGroups(groups: string[]) {
  if (saving.value) return
  const set = new Set(groups.filter((g) => dirty.value.has(g)))
  if (!set.size) return
  // 高风险确认：开放公网访问需二次确认
  if (set.has('policy') && policy.adminAccessMode === 'any') {
    const ok = await askConfirm({
      title: '开放公网访问',
      message: '你正在将 Admin 后台开放到公网/任意来源访问。\n任何能访问该服务地址的人都能看到管理入口，请确认已了解风险。',
      confirmText: '确认开放'
    })
    if (!ok) return
  }
  saving.value = true
  savingGroups.value = set
  try {
    // 分域保存:连接与路由各自独立提交(后端 PUT 为 partial 合并语义),
    // 修复「保存路由顺带落盘改了一半的连接」的范围错位
    if (set.has('conn')) {
      const payload: {
        apiUrl: string
        apiKey: string
        availableModels?: string[]
        connectionStatus?: string
        lastCheckedAt?: string
      } = {
        apiUrl: form.apiUrl,
        apiKey: form.apiKey
      }
      // 仅当模型清单来自「当前服务地址」的拉取时才携带,
      // 防止换地址后把上一个服务商的列表挂到新地址(applyLiveConfig 的回显同理按 savedApiUrl 归属)
      if (fetchedModelsEndpoint.value === form.apiUrl.trim()) payload.availableModels = fetchedModels.value
      // 拉取/测试是连接状态的真实来源；随连接域一起落盘，刷新后徽章时间不再回退到旧值
      if (connCheckedAt.value) {
        payload.connectionStatus = connectionStatus.value
        payload.lastCheckedAt = connCheckedAt.value
      }
      await liveSaveApiConfig(payload as Parameters<typeof liveSaveApiConfig>[0])
    }
    if (set.has('route')) {
      // 模型按 Skill 配置：本页只保存生成默认，不再写平台三档模型字段（partial 合并保留库中原值）
      await liveSaveApiConfig({
        defaultThinkingMode: form.defaultThinkingMode,
        defaultReasoningEffort: form.defaultReasoningEffort,
        defaultResponseFormat: form.defaultResponseFormat
      } as Parameters<typeof liveSaveApiConfig>[0])
    }
    if (set.has('policy')) {
      await liveSaveNetworkPolicy({ ...policy })
    }
    if (set.has('reliability') && reliability.value) {
      // 空值容错:v-model.number 清空后是字符串,后端要求全整数字段(400 且不定位)。
      // 保存前回退到最近一次加载值,并写回输入框,所见即所存
      const intOr = (v: unknown, fb: unknown): number => {
        if (typeof v === 'number' && Number.isInteger(v)) return v
        const f = Number(fb)
        return Number.isInteger(f) ? f : 0
      }
      const base = reliabilityBase.value ?? {}
      const sanitized = {
        maxUpstreamAttempts: intOr(reliability.value.maxUpstreamAttempts, base.maxUpstreamAttempts),
        maxTransportRetries: intOr(reliability.value.maxTransportRetries, base.maxTransportRetries),
        maxLogicalRetries: intOr(reliability.value.maxLogicalRetries, base.maxLogicalRetries),
        defaultRequestTimeoutMs: intOr(reliability.value.defaultRequestTimeoutMs, base.defaultRequestTimeoutMs),
        retryBaseDelayMs: intOr(reliability.value.retryBaseDelayMs, base.retryBaseDelayMs),
        maxRetryAfterMs: intOr(reliability.value.maxRetryAfterMs, base.maxRetryAfterMs),
        platformRpmLimit: intOr(reliability.value.platformRpmLimit, base.platformRpmLimit),
        jitterEnabled: reliability.value.jitterEnabled !== false
      }
      Object.assign(reliability.value, sanitized)
      await adminPlatformSettingsApi.updateReliabilitySettings(sanitized)
    }
    // 只清除本次已保存的域，保留其他未保存改动（探针为热生效开关，不走统一保存条）
    dirty.value = new Set([...dirty.value].filter((g) => !set.has(g)))
    toast.success('配置已保存并生效')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
    savingGroups.value = new Set()
  }
}

function saveAll() {
  return saveGroups([...dirty.value])
}

/* 重置为默认配置（#13）：后端 POST /admin/api-config/reset 能力早已存在却无前端入口。
   重置会删除已保存配置行（服务地址 / 密钥 / 默认生成参数 / 调用参数全回默认）——高风险不可撤销，
   故走二次确认；成功后强制重拉 live 配置（绕过 TTL）+ 可靠性/探针 + 健康快照，并清空脏位。 */
const resetting = ref(false)
async function resetConfig() {
  if (resetting.value) return
  const ok = await askConfirm({
    title: '重置为默认配置',
    message: '将清空已保存的服务地址、API Key、默认生成参数与调用参数，恢复出厂默认。此操作不可撤销。',
    confirmText: '确认重置'
  })
  if (!ok) return
  resetting.value = true
  try {
    await adminApiConfigApi.resetConfig()
    await loadLiveData(true)
    await loadReliability()
    await loadProbe()
    dirty.value = new Set()
    void loadHealth()
    toast.success('配置已重置为默认值')
  } catch (e) {
    toast.error(`重置失败：${errMsg(e)}`)
  } finally {
    resetting.value = false
  }
}

function discardAll() {
  /* 配置域读取失败（cfg 为空）时 applyLiveConfig 直接 return：脏位不清、表单不回滚，
     不能假报「已放弃」——否则用户以为改动已撤。显式提示先重试。 */
  if (!cfg.value) {
    toast.error('配置尚未读取成功，表单无法回滚，请先点顶部「重试」')
    return
  }
  applyLiveConfig()
  void loadReliability()
  void loadProbe()
  toast.info('已放弃未保存的变更')
}
/* 注册开关：高风险操作，二次确认。
   分段器两段各自指定目标值（原为单按钮 toggle，按钮文案在「关闭注册/开放注册」间翻转）。 */
const registrationBusy = ref(false)
async function setRegistration(target: boolean) {
  if (registrationBusy.value || registrationEnabled.value === null) return
  if (target === registrationEnabled.value) return
  const ok = await askConfirm({
    title: target ? '开放注册' : '关闭注册',
    message: target
      ? '确认开放新用户自助注册？\n任何人都能通过注册页创建账号。'
      : '确认关闭新用户自助注册？\n关闭后新账号只能由管理员手动创建。',
    confirmText: target ? '开放注册' : '关闭注册',
    danger: target
  })
  if (!ok) return
  registrationBusy.value = true
  try {
    await updateRegistrationSetting(target)
    toast.success(target ? '注册已开放' : '注册已关闭，新账号只能由管理员创建')
  } catch (e) {
    // 失败回滚本地状态（updateRegistrationSetting 仅在成功后写回）
    registrationEnabled.value = !target
    toast.error(`切换失败：${errMsg(e)}`)
  } finally {
    registrationBusy.value = false
  }
}

/* 单 IP 每日注册配额开关：默认关；启用时引导填写上限 */
const quotaBusy = ref(false)
const quotaInput = ref(5)
watch(
  () => registerIpDailyQuota.value,
  (v) => { if (typeof v === 'number' && v >= 1 && v <= 100) quotaInput.value = v },
  { immediate: true }
)
const quotaEnabledText = computed(() => registerIpQuotaEnabled.value ? `已启用 · 每 IP 每日 ${quotaInput.value} 个` : '未启用（不限制注册数量）')

/** 配额输入只在 change 时校验：清空/非法值回退最近一次有效值（Number('')=0 是合法整数，
    会被钳到 1 静默改值，对齐同页 reliability 的 intOr 回退思路）；不即时保存，
    落盘统一走「启用/关闭配额」的 saveQuota，避免半成品数字被静默提交 */
function onQuotaInput(e: Event) {
  const input = e.target as HTMLInputElement
  const raw = input.value.trim()
  const v = Number(raw)
  if (!raw || !Number.isInteger(v) || v < 1) {
    // :value 绑定值未变时 Vue 不会重写 DOM，需手动回写输入框，保证所见即所存
    input.value = String(quotaInput.value)
    return
  }
  quotaInput.value = Math.min(100, Math.max(1, v))
}

async function setQuotaEnabled(enabled: boolean) {
  if (quotaBusy.value) return
  if (enabled && !registerIpQuotaEnabled.value) {
    const ok = await askConfirm({
      title: '启用单 IP 每日注册配额',
      message: `开启后，同一 IP 24 小时内最多注册 ${quotaInput.value} 个账号。\n若您所在网络有多个真实用户共享出口 IP，可能误伤正常注册。`,
      confirmText: '启用配额',
      danger: false
    })
    if (!ok) return
  }
  await saveQuota(enabled, quotaInput.value)
}

async function saveQuota(enabled: boolean, quota: number) {
  if (quotaBusy.value) return
  quotaBusy.value = true
  try {
    await updateRegisterIpQuotaSetting(enabled, quota)
    toast.success(enabled ? `配额已启用：每 IP 每日 ${quota} 个` : '配额已关闭，注册不再限制数量')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    quotaBusy.value = false
  }
}
</script>

<style scoped>
/* ================= 宿主布局（tab 宿主：模型 tab 内滚；嵌入子页占满剩余高度） ================= */
/* 视图切换已收敛到共享 MkSubTabs（CM1，2026-10-05）：原页内 .tabs/.tab/.tab__count
   本地拷贝退役——下划线页签的 padding/字号/hover/▸ 指示由 .mk-subtabs/.mk-subtab 单源提供。
   此处仅保留宿主级类作定位钩子（无本地样式）。 */
/* 模型 tab：内容在宿主 flex 列内独立滚动（页头/页签固定；底部保存条 sticky 于滚动容器） */
.ac-tab-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  align-content: start;
}
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度 */
.ac-host > .mk-page--fill { flex: 1 1 auto; min-height: 0; }

/* 满屏重排（2026-10-05）：mk-narrow 限宽列在宽屏下读作「一张卡悬着」（用户实测截图批注）。
   2026-10-15 用户重组后接入页只剩「连接」一张卡（连通性验证并入，
   供应商 / 能力限额为注册表只读面板），三列宫格不再有第二个卡位——保持三列会把唯一的卡
   挤成 1/3 宽。改单列：连接卡满宽，注册表随其后。安全页两列（左一右二），≤1100px 回落单列。 */
.ac-conn-body { grid-template-columns: minmax(0, 1fr); align-items: stretch; }
/* 2026-10-20 用户走查「下方大量空白」：接入页签改成满高工作台——供应商卡吃掉页签剩余高度，
   列表与详情各自内滚。窄屏（≤900）仍回落到页面滚动，卡片按内容高度。 */
.ac-conn-body { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; overflow-x: hidden; }
/* 短视口（如 1280×720）下基础设施卡按内容占高后，供应商卡会被压到不足 100px，
   详情区只剩一条内滚缝。给供应商卡保底高度，整页签改为滚动，而不是把可用区压扁。 */
.ac-conn-body > .mpp { flex: 1 1 auto; min-height: 420px; }
@media (max-width: 900px) {
  .ac-conn-body { display: grid; overflow-y: auto; }
  .ac-conn-body > .mpp { flex: none; min-height: 0; }
}
/* 接入页「默认生成参数」卡内的注册表切片（别名映射）：外层是 details，
   这里让分区直接成为 details 的子项，不出现内外双滚动容器。 */
.ac-registry--aliases { display: contents; }
.ac-sec-body { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
.ac-sec-head { grid-column: 1 / -1; }
/* 置顶告警（接入域读取失败）横跨全部列，不占卡位把卡片挤换行 */
.ac-conn-body > .mk-alert { grid-column: 1 / -1; }
/* 平台通道那条详情的连接块（2026-10-18 从独立「连接」卡搬进供应商详情）：外层卡头没了，
   状态徽标与「保存连接」收进一条细条，右侧一句说明这段表单管什么。 */
.ac-conn__bar { display: flex; align-items: center; gap: 10px; padding: 0 0 4px; flex-wrap: wrap; }
/* 槽位已在供应商详情的内衬里：连接块自身的 .ac-body 不再补一层 16px 边 */
.ac-conn .ac-body { padding: 0; }

/* 卡内内容容器：统一内边距与间距（mk-card__head 之下），全页各卡同一语言 */
.ac-body { display: grid; gap: 14px; padding: 4px 16px 16px; }
/* 接入卡左右双列（2026-10-15 用户重组）：左=地址/密钥，右=连通性验证；≤1100 回落整行 */
.ac-conn2 { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: start; }
.ac-conn2__col { display: grid; gap: 14px; align-content: start; min-width: 0; }
.ac-conn2__col--test { border-left: 1px dashed var(--mk-line); padding-left: 18px; }
.ac-row { display: grid; gap: 14px; align-items: end; }
.ac-row--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
/* 2026-10-06 审核 #159：四个配置页签的字段控件统一走 .mk-field__input/__select/__textarea
   （与 MCP 弹窗、加字段向导同原语）——原「.mk-field 下 .mk-filter__input 补 100% 宽」的补偿规则
   随控件换原语一并删除（字段原语自身即 width:100%） */
.ac-body .mk-field { margin: 0; min-width: 0; }
.ac-body .mk-field__select[disabled] { opacity: 0.6; cursor: not-allowed; }
.ac-key-wrap { display: grid; gap: 4px; min-width: 0; }
.ac-key-input-row { display: flex; align-items: center; gap: 6px; }
.ac-key-input-row .mk-field__input { flex: 1; min-width: 0; }
.ac-key-toggle {
  flex-shrink: 0;
  border: 1px solid var(--mk-line);
  background: #fafbfc;
  border-radius: var(--mk-radius-sm);
  width: 32px;
  height: 32px;
  font-size: var(--mk-fs-body);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ac-key-toggle:hover { background: var(--mk-hover-surface); border-color: var(--mk-blue, #2f6ae0); }
.ac-keyhint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-amber);
  font-weight: 600;
  font-style: normal;
  white-space: normal;
}

/* 连通性验证（卡内末段，横向内联：模型 + 按钮 + 结果） */
.ac-test {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.ac-test__model { min-width: 240px; max-width: 320px; margin: 0; }
.ac-test__result { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 6px; min-width: 0; }
.ac-test__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }
.ac-test__text {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.ac-test__text--bad { color: var(--mk-red); }
.ac-test__btn { align-self: flex-end; }

/* 上游清单关系句（2026-10-16 用户走查重排）：原 30+ 枚模型胶囊（.ac-models/.ac-model）退役——
   与下方登记表并列成两份模型名单，被读成「同一件事说两遍」。现在只说关系，逐个名字在登记表折叠里。 */
.ac-models__line { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
/* 上游对齐条（2026-10-20 从连接块搬进模型清单块）：嵌在模型块里只占一行读数，不再套第二层卡片 */
.ac-models-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.ac-models-meta__title { color: var(--mk-muted); }
/* 持久化说明（F8-2）：拉取仅本页有效的提示，比清单胶囊再轻一档；仅未保存时出现 */

/* 默认思考：模式 + 强度，同一行两列字段（2026-10-14 删冗余「启用思考」开关后由三列改两列） */

/* 策略域（2026-10-15 用户重组）：左一（网络与 IP 访问控制）+ 右二（注册与防刷配额）两列；
   左卡内两段（访问来源模式 / 私有网络服务）用虚线分隔，段落标题由 .ac-group__title 承担 */
.ac-policy__item { min-width: 0; }
/* 卡内第二段：与上方段落之间一条虚线（同 .ac-cols__side 的分隔方言） */
.ac-policy__item--sep { border-top: 1px dashed var(--mk-line); }
/* 右列两张小卡叠放；align-content:start 让卡保持内容高度（不拉伸成两张空卡） */
.ac-sec-stack { display: grid; gap: 12px; align-content: start; min-width: 0; }
.ac-policy__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.55; display: block; }
.ac-policy__warn { font-size: var(--mk-fs-micro); color: var(--mk-red); font-weight: 600; }
/* 访问来源模式：radio 单选卡片（复刻原型 index.html:1793-1798 .radio-row/.radio，
   原型 .radio[aria-checked="true"] = brand 描边 + brand 底 + brand 字 + 600 字重）。
   描边/圆角/选中态全走 --mk-* token，暗色随 token 自动适配 */
.ac-radio-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ac-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  padding: 9px 12px;
  cursor: pointer;
  font-size: var(--mk-fs-micro);
  background: var(--mk-surface);
  transition: border-color 0.14s ease, background 0.14s ease, color 0.14s ease;
}
.ac-radio:hover { border-color: var(--mk-blue); }
.ac-radio:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.ac-radio[aria-checked='true'] {
  border-color: var(--mk-blue);
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-weight: 600;
}
.ac-radio__mark { flex: none; line-height: 1; }
.ac-radio__text { display: grid; gap: 0; min-width: 0; }
.ac-radio__sub { color: var(--mk-muted); font-weight: 500; }
.ac-radio[aria-checked='true'] .ac-radio__sub { color: inherit; opacity: 0.82; }
.ac-quota-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-quota-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.ac-quota-field .mk-field__input { width: 76px; text-align: center; }
.ac-quota-field em { font-style: normal; color: var(--mk-faint); }
/* 分段小标题（连接 / 路由默认 / 默认思考 / 连通性验证 / 调用参数 / 能力健康）：
   统一简洁粗体灰字——不放大写、不加横线后缀，用留白分区（与全站表单一致） */
.ac-sec__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
}
.ac-sec__hint { font-size: var(--mk-fs-micro); font-weight: 500; color: var(--mk-faint); }
.ac-sec__sub { margin-left: auto; font-size: var(--mk-fs-micro); font-weight: 500; color: var(--mk-faint); }
/* 分段保存（方向 A）：该段有未保存改动时才出现；与底部统一保存条并存 */
.ac-sec__save {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--mk-blue) 30%, transparent);
  background: color-mix(in srgb, var(--mk-blue) 8%, transparent);
  color: var(--mk-blue);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  cursor: pointer;
}
.ac-sec__save:hover { background: color-mix(in srgb, var(--mk-blue) 16%, transparent); }
.ac-sec__save:disabled { opacity: 0.6; cursor: not-allowed; }
/* 分段控件走 .mk-seg（shared.css） */

/* 策略 IP 列表：走字段原语 .mk-field__textarea（审核 #159）；rows=2 的紧凑清单不需要
   原语默认 96px 最小高，覆写回 0 保持原视觉高度 */
.ac-textarea { resize: vertical; font-size: var(--mk-fs-micro); min-height: 0; }

/* 能力探针（2026-10-15 用户重组）：5 项核心能力 = 5 个紧凑胶囊（原 5 行大表占满右列，
   读下来只有一个「哪几项可用」的结论）。胶囊常显状态色点 + 能力名 + 状态词；
   失败码 / 响应耗时 / 最近探测时间进 title 供悬停核对（结论常显、证据可查）。 */
.ac-hpills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 0 6px;
}
.ac-hpill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  background: var(--mk-surface-2);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
}
.ac-hpill__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ac-hpill__id { color: var(--mk-ink); }
.ac-hpill__state { color: var(--mk-muted); }
.ac-hpill.is-operational .ac-hpill__dot { background: var(--mk-green); }
.ac-hpill.is-degraded .ac-hpill__dot { background: var(--mk-amber); }
.ac-hpill.is-unavailable .ac-hpill__dot { background: var(--mk-red); }
.ac-hpill.is-unknown .ac-hpill__dot { background: var(--mk-faint); }
/* 异常档连边框一起上色：胶囊是右列唯一的结论载体，只靠一个 8px 点区分不够 */
.ac-hpill.is-degraded { border-color: color-mix(in srgb, var(--mk-amber) 42%, var(--mk-line)); }
.ac-hpill.is-unavailable { border-color: color-mix(in srgb, var(--mk-red) 42%, var(--mk-line)); }
/* 内置别名映射表：默认收起的折叠条（查证用参考表，不必每次进页都占屏） */
.ac-fold { display: block; }
.ac-fold__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  cursor: pointer;
  list-style: none;
  font-size: var(--mk-fs-micro);
}
.ac-fold__bar::-webkit-details-marker { display: none; }
.ac-fold__bar:hover { border-color: var(--mk-blue); }
.ac-fold__title { font-weight: 700; color: var(--mk-ink); }
.ac-fold__hint { color: var(--mk-faint); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-fold__mark { margin-left: auto; color: var(--mk-faint); flex: none; }
.ac-fold__mark::before { content: '▸'; }
.ac-fold[open] .ac-fold__mark::before { content: '▾'; }
.ac-fold[open] .ac-fold__bar { border-radius: var(--mk-radius-xl) var(--mk-radius-xl) 0 0; border-bottom-color: transparent; }
.ac-route-warn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--mk-amber) 32%, var(--mk-line));
  border-radius: var(--mk-radius-md);
  background: var(--mk-amber-bg);
  color: var(--mk-amber);
  font-size: var(--mk-fs-micro);
}
.ac-route-warn__dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; }
/* stale 时「立即探测」红色脉冲（A3：承认探活默认关闭的机制性状态，引导手动探测） */
.ac-probe--alert {
  border-color: var(--mk-red) !important;
  color: var(--mk-red) !important;
  animation: ac-probe-pulse 1.6s ease infinite;
}
@keyframes ac-probe-pulse {
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--mk-red-fill) 18%, transparent); }
}

/* 探针行：AI 能力定期探测总开关（右卡第一段，开启后显示间隔；由 ac-body 统一间距，无独立边框） */
.ac-probe {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 2px 0 0;
}
.ac-probe__main { display: flex; align-items: center; gap: 12px; min-width: 200px; flex: 1; }
.ac-probe__switch { flex: none; margin: 0; }
.ac-probe__desc {
  font-style: normal;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  line-height: 1.5;
}
.ac-probe__ctrl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-probe__interval {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}
.ac-probe__interval .mk-field__input { width: 72px; text-align: center; }
.ac-probe__unit { font-style: normal; color: var(--mk-faint); font-size: var(--mk-fs-micro); }

/* 平台详情「生成参数」页签：不再套卡壳，内部按块节奏堆叠 */
.ac-gen-panel { display: grid; gap: 14px; min-width: 0; }
.ac-gen-panel__bar { display: flex; justify-content: flex-end; }
/* 调用参数 + 能力健康：两列（左参数右健康，2026-10-05 修复——注释/1100px 收合断点/
   移动端摘边距规则都证明双列是设计意图，基础 grid-template-columns 却在历史改动中丢失，
   实际一直堆叠渲染，健康表被参数组压到折叠线下）；分隔线沿用卡内原 dashed 方言。
   默认生成参数同款复用（左=默认思考，右=结构化输出），两列各自立栅同节奏 */
.ac-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.ac-cols__main, .ac-cols__side { display: grid; gap: 12px; align-content: start; min-width: 0; padding: 0; }
.ac-cols__side { border-left: 1px dashed var(--mk-line); padding-left: 18px; }
.ac-fallback-alert { margin: 0; }
.ac-groups { display: grid; gap: 12px; }
/* 策略卡三列（重试 / 超时 / 出站）：每组内部竖排，数字输入框不再被拉成整列宽 */
.ac-groups--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.ac-field--num { max-width: 140px; }
/* 单字段分组（平台 RPM / VL RPM）：字段吃满组宽，标签不再按 1/3 格折行 */
.ac-group__fields > .mk-field:only-child { grid-column: 1 / -1; }
/* 三列分组：组内只有几个数字，标题与字段贴顶，不随相邻组的高度垂直居中 */
.ac-groups--3 > .ac-group { align-content: start; }
.ac-group__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.5; }
@media (max-width: 1200px) {
  .ac-groups--3 { grid-template-columns: minmax(0, 1fr); }
}
.ac-group { display: grid; gap: 10px; }
.ac-group__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.ac-group__fields .mk-field { margin: 0; }
/* 虚拟学习者 RPM：输入框 + 自带「保存」钮（保存链与平台全局不同，见脚本注释） */
.ac-vl-rpm { display: inline-flex; align-items: center; gap: 8px; }
.ac-vl-rpm .mk-field__input { flex: 1 1 auto; min-width: 0; max-width: 120px; }
.ac-vl-rpm__dirty { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-amber); white-space: nowrap; }
.ac-vl-rpm__failed { color: var(--mk-red); font-weight: 600; }
/* 单字段分组（超时仅一项）：不拉全宽，保持与多字段组同网格节奏 */

/* 分组副标题：与 ac-sec__title 同族更轻（重试/超时） */
.ac-group__title {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--mk-faint);
}
/* 开关控件：统一走全站 mk-field--switch（原生 checkbox + label + accent-color 蓝），
   不再使用自定义 iOS 滑块（2026-09 与全站 admin 视觉对齐） */
.mk-field--switch { align-content: start; }
.mk-field--switch input[type='checkbox'] { accent-color: var(--mk-blue, #2f6ae0); cursor: pointer; }

.ac-rel__note {
  margin: 0;
  padding: 0 0 14px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
}
/* 降级提示：健康快照不可用 / 配置读取失败 */
.ac-rel__error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mk-red);
  font-weight: 600;
}
.ac-rel__error .mk-link { font-size: var(--mk-fs-micro); }
/* 配置读取失败条：外形走 .mk-alert--row，本类只保留位置 */
.ac-config-error { margin: 0 16px 4px; }

.ac-save {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 4px auto 0;
  padding: 9px 12px 9px 16px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--mk-blue) 24%, transparent);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-pop);
  font-weight: 600;
}
.ac-save__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-amber); }
.ac-save__primary {
  padding: 6px 14px;
  border-radius: 999px;
  border: 0;
  background: var(--mk-blue);
  color: var(--mk-on-fill);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ac-save__primary:disabled { opacity: 0.6; cursor: not-allowed; }


/* 侧栏占 208px，断点需按视口 1100px 触发（内容区 ≈ 892px）：满宽构图回落单列 */
@media (max-width: 1100px) {
  .ac-conn-body, .ac-sec-body, .ac-cols { grid-template-columns: 1fr; }
  .ac-cols__side { border-left: none; padding-left: 0; margin-top: 6px; }
}
@media (max-width: 800px) {
  /* 三列栅格在窄屏回落单列：此前漏掉这条，390 下「服务地址 | API Key」
     仍强行并排，服务地址输入框被 180px 下限撑破、压掉 API Key（审计 P1 2.2） */
  .ac-row--2 { grid-template-columns: 1fr; }
  .ac-group__fields, .ac-groups--3 { grid-template-columns: 1fr; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .ac-body { gap: 16px; padding: 6px 18px 18px; }
  .mk-field__label { font-size: var(--mk-fs-micro); }

  .ac-policy__warn { font-size: var(--mk-fs-micro); }
  .mk-seg { border-radius: 12px; }
  .mk-seg__item { font-size: var(--mk-fs-micro); padding: 8px 14px; }
  .ac-textarea { font-size: var(--mk-fs-micro); }
  .ac-sec__title { font-size: var(--mk-fs-micro); }
  .ac-sec__hint { font-size: var(--mk-fs-micro); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-sec__sub { font-size: var(--mk-fs-micro); }
  .ac-group__title { font-size: var(--mk-fs-micro); }
  .ac-groups { gap: 20px; padding: 4px 0 8px; }
  .ac-rel__note { font-size: var(--mk-fs-micro); }
  .ac-save { padding: 11px 14px 11px 18px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .ac-body { gap: 18px; padding: 8px 22px 22px; }
  .mk-field__label { font-size: var(--mk-fs-micro); }

  .ac-policy__warn { font-size: var(--mk-fs-micro); }
  .mk-seg__item { font-size: var(--mk-fs-micro); padding: 9px 16px; }
  .ac-textarea { font-size: var(--mk-fs-micro); }
  .ac-sec__title { font-size: var(--mk-fs-micro); }
  .ac-sec__hint { font-size: var(--mk-fs-micro); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-sec__sub { font-size: var(--mk-fs-micro); }
  .ac-group__title { font-size: var(--mk-fs-micro); }
  .ac-groups { gap: 22px; padding: 6px 0 8px; }
  .ac-rel__note { font-size: var(--mk-fs-micro); }
  .ac-save { padding: 13px 16px 13px 20px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .ac-body { gap: 20px; padding: 10px 26px 26px; }
  .mk-field__label { font-size: var(--mk-fs-body); }

  .ac-policy__warn { font-size: var(--mk-fs-body); }
  .mk-seg__item { font-size: var(--mk-fs-body); padding: 11px 19px; }
  .ac-textarea { font-size: var(--mk-fs-body); }
  .ac-sec__title { font-size: var(--mk-fs-body); }
  .ac-sec__hint { font-size: var(--mk-fs-micro); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-sec__sub { font-size: var(--mk-fs-body); }
  .ac-group__title { font-size: var(--mk-fs-body); }
  .ac-groups { gap: 26px; padding: 8px 0 10px; }
  .ac-rel__note { font-size: var(--mk-fs-body); }
  .ac-save { padding: 15px 18px 15px 24px; }
}

/* ================= 暗色模式（D1 补完）：模型与接入 ================= */
html[data-theme='dark'] {
  .ac-key-toggle:hover { background: color-mix(in srgb, var(--wf-color-primary) 14%, transparent); }
  /* 审核 #163：原 .mk-seg 覆写 #232325 对卡面 #202124 仅 3 个 sRGB 级台阶（<6），
     轨道几乎与卡面同色——删除覆写，回到 token（--mk-pills-bg 暗色 #27282c，7/8 级） */
  .ac-save { background: #19191a; border-color: var(--wf-border-light); }
  /* 补漏：密钥切换钮浅底（模型胶囊随清单胶囊退役，2026-10-16） */
  .ac-key-toggle { background: #232325; color: var(--mk-muted); }
}
</style>
