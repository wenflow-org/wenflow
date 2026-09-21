<template>
  <div class="mk-page mk-page--fill ac-host">
    <!-- 单行健康条（模型 tab 展示接入态；外挂能力 tab 展示能力数） -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">模型与接入</strong>
      <span class="mk-status__sep"></span>
      <template v-if="tab === 'model'">
        <span class="mk-status__meta" title="服务商 API Key 是否已配置">密钥：{{ keySet ? '已配置' : '未配置' }}</span>
        <span class="mk-status__meta" :title="modelListTitle">模型清单：{{ models.length ? `${models.length} 个` : '未拉取' }}</span>
        <span class="mk-status__meta" :title="routeTitle">默认路由：{{ routeCount }}/3</span>
        <span v-if="isLive && lastCheckedText" class="mk-status__meta" title="连通性 / 能力探测时间">上次探测：{{ lastCheckedText }}</span>
      </template>
      <template v-else-if="tab === 'overview'">
        <span class="mk-status__meta" title="后端能力注册表（唯一写源）中的模型数">模型：{{ registryCount.models }} 个</span>
        <span class="mk-status__meta" :title="registryCount.warnings ? '存在配置漂移提示' : '无配置漂移'">提示：{{ registryCount.warnings }} 条</span>
        <span class="mk-status__meta">只读</span>
      </template>
      <template v-else>
        <span class="mk-status__meta">外挂能力 {{ addonsCount }} 个</span>
      </template>
      <span class="mk-status__actions">
        <button v-if="tab === 'model'" type="button" class="mk-status__action" :disabled="fetching || !form.apiUrl" @click="fetchModels">
          <MkLoading v-if="fetching" inline text="拉取中…" />
          <span v-else>{{ models.length ? '重新拉取' : '连接并拉取' }}</span>
        </button>
        <button v-else-if="tab === 'overview'" type="button" class="mk-status__action" @click="registryRef?.refresh?.(true)">刷新</button>
        <button v-else type="button" class="mk-status__action" @click="addonsRef?.refresh?.()">刷新</button>
      </span>
    </div>

    <!-- 视图切换 pills（唯一的 tab 控件）：接入与模型 / 模型总览 / 外挂能力 -->
    <div class="mk-pills ac-tabs">
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'model' }" @click="switchTab('model')">接入与模型</button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'overview' }" @click="switchTab('overview')">模型总览</button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'addons' }" @click="switchTab('addons')">外挂能力<span class="mk-pill__count">{{ addonsCount }}</span></button>
    </div>

    <!-- ===== Tab1: 接入与模型（原 ApiConfig 全量内容） ===== -->
    <template v-if="tab === 'model'">
    <div class="ac-tab-body">
    <!-- 主布局：左列(接入与模型+安全与访问 纵向) / 右列(AI 调用与健康) -->
    <div class="ac-layout">
      <div class="ac-layout__main">
        <!-- 接入与模型（全宽：连接 → 模型/路由 → 连通性验证） -->
        <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">接入与模型</h3>
        <span class="mk-badge" :class="connBadge.cls">{{ connBadge.text }}</span>
      </div>
      <div class="ac-body">
        <!-- 连接凭证：地址与密钥并排，密钥附显示切换 -->
        <div class="ac-sec__title">连接<button v-if="dirty.has('conn')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['conn'])">{{ saving ? '保存中…' : '保存连接' }}</button></div>
        <div class="ac-row ac-row--2-1">
          <label class="mk-field mk-field--row">
            <span class="mk-field__label">服务地址</span>
            <input class="mk-filter__input" v-model="form.apiUrl" placeholder="https://api.example.com/v1" @input="markDirty('conn')" />
          </label>
          <label class="mk-field mk-field--row">
            <span class="mk-field__label">API Key</span>
            <span class="ac-key-wrap">
              <span class="ac-key-input-row">
                <input
                  class="mk-filter__input"
                  :type="keyVisible ? 'text' : 'password'"
                  v-model="form.apiKey"
                  :placeholder="keySet ? '已配置，留空沿用' : '输入 API Key'"
                  @input="markDirty('conn')"
                />
                <button
                  v-if="keySet || form.apiKey"
                  type="button"
                  class="ac-key-toggle"
                  :title="keyVisible ? '隐藏' : '显示'"
                  @click="keyVisible = !keyVisible"
                ><svg v-if="keyVisible" viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                  <svg v-else viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button>
              </span>
              <em v-if="keyHintNeeded" class="ac-keyhint">⚠ 更换服务地址需重新输入密钥</em>
            </span>
          </label>
        </div>
        <label class="mk-field">
          <span class="mk-field__label">可用模型</span>
          <div class="ac-models">
            <template v-if="models.length">
              <span v-for="m in models" :key="m" class="ac-model">{{ m }}</span>
            </template>
            <div v-else class="ac-models__empty">
              <span class="ac-models__empty-icon" aria-hidden="true">﹢</span>
              <span v-if="fetchError">拉取失败：{{ fetchError }}。请检查服务地址 / 密钥后重试。</span>
              <span v-else>模型清单尚未拉取（连接状态：{{ connBadge.text }}）。下方「路由默认」标「当前生效」的是平台实际在用模型；点击右上角「连接并拉取」获取服务商列表。</span>
            </div>
          </div>
        </label>
        <div class="ac-sec__title">路由默认<span class="ac-sec__hint">可填具体模型 id，也可填逻辑别名（chat / reasoning / light）；清单未拉取时也能直接输入</span><button v-if="dirty.has('route')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['route'])">{{ saving ? '保存中…' : '保存路由' }}</button></div>
        <div class="ac-row ac-row--3">
          <label class="mk-field">
            <span class="mk-field__label">对话默认</span>
            <input
              class="mk-filter__input mono"
              list="ac-model-options"
              :value="form.defaultModel"
              placeholder="模型 id 或别名"
              title="可填逻辑别名（chat / reasoning / light），或从已拉取清单中选择"
              @input="form.defaultModel = ($event.target as HTMLInputElement).value; markDirty('route')"
            />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">推理默认</span>
            <input
              class="mk-filter__input mono"
              list="ac-model-options"
              :value="form.defaultReasoningModel"
              placeholder="模型 id 或别名"
              title="推理档：别名 reasoning 会按能力过滤到支持思考的成员"
              @input="form.defaultReasoningModel = ($event.target as HTMLInputElement).value; markDirty('route')"
            />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">评估默认</span>
            <input
              class="mk-filter__input mono"
              list="ac-model-options"
              :value="form.defaultEvaluationModel"
              placeholder="模型 id 或别名"
              title="评估档：同样支持逻辑别名"
              @input="form.defaultEvaluationModel = ($event.target as HTMLInputElement).value; markDirty('route')"
            />
          </label>
        </div>
        <!-- 路由默认的候选：已拉取模型清单 + 后端注册表里的逻辑别名 -->
        <datalist id="ac-model-options">
          <option v-for="m in models" :key="`model-${m}`" :value="m" />
          <option v-for="a in aliasOptions" :key="`alias-${a}`" :value="a" />
        </datalist>

        <!-- 默认思考：平台级开关 + 强度（未单独配置的 Skill 继承此默认；skill 级可在设计页运行时 tab 覆盖） -->
        <div class="ac-sec__title">默认思考<span class="ac-sec__hint">未单独配置的 Skill 继承此默认；可在 Skill 设计页「运行时」单独覆盖</span><button v-if="dirty.has('route')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['route'])">{{ saving ? '保存中…' : '保存路由' }}</button></div>
        <div class="ac-row ac-row--3 ac-think">
          <label class="mk-field mk-field--switch">
            <input
              type="checkbox"
              :checked="thinkingOn"
              @change="setThinkingOn(($event.target as HTMLInputElement).checked)"
            />
            <span class="mk-field__label" style="margin:0">启用思考</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">思考强度</span>
            <select
              class="mk-filter__select"
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
          <label class="mk-field">
            <span class="mk-field__label">思考模式</span>
            <select
              class="mk-filter__select"
              :value="form.defaultThinkingMode"
              @change="setThinkingMode(($event.target as HTMLSelectElement).value)"
            >
              <option value="default">跟随模型默认</option>
              <option value="enabled">强制开启</option>
              <option value="disabled">关闭</option>
            </select>
          </label>
        </div>

        <!-- 连通性验证（并入卡体末段） -->
        <div class="ac-sec__title">连通性验证</div>
        <div class="ac-test">
          <label class="mk-field ac-test__model">
            <span class="mk-field__label">测试模型</span>
            <select class="mk-filter__select" :disabled="!models.length" :value="testModel" @change="testModel = ($event.target as HTMLSelectElement).value">
              <option v-if="!models.length" value="">无可用模型（等待拉取）</option>
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
            </select>
          </label>
          <button type="button" class="mk-btn mk-btn--primary ac-test__btn" :disabled="!models.length || testing" @click="runTest">
            <MkLoading v-if="testing" inline text="测试中…" />
            <span v-else>运行测试</span>
          </button>
          <span v-if="testResult" class="ac-test__result">
            <span class="mk-badge" :class="testResult.ok ? 'mk-badge--ok' : 'mk-badge--bad'">{{ testResult.ok ? '测试通过' : '测试失败' }}</span>
            <span class="ac-test__meta mono">{{ testResult.latency || '—' }}{{ testResult.usage ? ` · ${testResult.usage}` : '' }}</span>
            <span class="ac-test__text" :class="{ 'ac-test__text--bad': !testResult.ok }">「{{ testResult.text }}」</span>
          </span>
        </div>
      </div>
    </section>

      <!-- 安全与访问（左列第二张卡：2×2 宫格，填满左列下方） -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">安全与访问</h3>
          <span class="mk-badge mk-badge--info">平台策略 · 热生效</span>
          <button v-if="dirty.has('policy')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['policy'])">{{ saving ? '保存中…' : '保存策略' }}</button>
        </div>
        <div class="ac-policy ac-policy--2x2">
          <div class="ac-policy__item">
            <span class="ac-policy__label">Admin 访问范围</span>
            <div class="mk-seg">
              <button
                v-for="opt in accessOptions"
                :key="opt.id"
                type="button"
                class="mk-seg__item"
                :class="{ 'mk-seg__item--active': policy.adminAccessMode === opt.id }"
                @click="policy.adminAccessMode = opt.id; markDirty('policy')"
              >
                {{ opt.label }}
              </button>
            </div>
            <span v-if="policy.adminAccessMode === 'any'" class="ac-policy__warn">⚠ 公网开放 · 入口无访问限制</span>
            <label v-if="policy.adminAccessMode === 'private'" class="mk-field">
              <span class="mk-field__label">额外允许的客户端 IP（每行一个，可留空）</span>
              <textarea
                class="mk-filter__input ac-textarea"
                rows="2"
                :value="policy.adminAllowedIps.join('\n')"
                @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
                placeholder="203.0.113.10"
              ></textarea>
            </label>
          </div>
          <div class="ac-policy__item">
            <span class="ac-policy__label">私有网络服务</span>
            <div class="mk-seg">
              <button
                type="button"
                class="mk-seg__item"
                :class="{ 'mk-seg__item--active': policy.allowPrivateNetwork }"
                @click="policy.allowPrivateNetwork = true; markDirty('policy')"
              >
                允许
              </button>
              <button
                type="button"
                class="mk-seg__item"
                :class="{ 'mk-seg__item--active': !policy.allowPrivateNetwork }"
                @click="policy.allowPrivateNetwork = false; markDirty('policy')"
              >
                仅白名单
              </button>
            </div>
            <label v-if="!policy.allowPrivateNetwork" class="mk-field">
              <span class="mk-field__label">允许的 Host / IP（每行一个）</span>
              <textarea
                class="mk-filter__input ac-textarea"
                rows="2"
                :value="policy.privateNetworkHosts.join('\n')"
                @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
                placeholder="192.168.1.20"
              ></textarea>
            </label>
          </div>
          <!-- 新用户注册（live） -->
          <div v-if="isLive && registrationEnabled !== null" class="ac-policy__item">
            <span class="ac-policy__label">新用户注册</span>
            <span class="ac-policy__desc">{{ registrationEnabled ? '任何人可注册' : '仅管理员创建' }}</span>
            <button
              type="button"
              class="mk-seg__item ac-policy__toggle"
              :class="{ 'mk-seg__item--active': true }"
              :disabled="registrationBusy"
              @click="toggleRegistration"
            >
              {{ registrationBusy ? '切换中…' : registrationEnabled ? '关闭注册' : '开放注册' }}
            </button>
          </div>
          <!-- 单 IP 每日注册配额（live；默认关，避免误伤同一内网/出口的正常注册） -->
          <div v-if="isLive && registerIpQuotaEnabled !== null" class="ac-policy__item">
            <span class="ac-policy__label">单 IP 每日注册配额</span>
            <span class="ac-policy__desc">{{ quotaEnabledText }}，超过后该 IP 当天无法再创建账号</span>
            <div class="ac-quota-row">
              <div class="mk-seg ac-quota-seg" role="group" aria-label="单 IP 每日注册配额开关">
                <button
                  type="button"
                  class="mk-seg__item"
                  :class="{ 'mk-seg__item--active': registerIpQuotaEnabled }"
                  :disabled="quotaBusy"
                  @click="setQuotaEnabled(true)"
                >启用</button>
                <button
                  type="button"
                  class="mk-seg__item"
                  :class="{ 'mk-seg__item--active': !registerIpQuotaEnabled }"
                  :disabled="quotaBusy"
                  @click="setQuotaEnabled(false)"
                >关闭</button>
              </div>
              <label v-if="registerIpQuotaEnabled" class="ac-quota-field">
                <span class="mk-field__label">每日上限</span>
                <input
                  type="number"
                  class="mk-filter__input"
                  min="1"
                  max="100"
                  :value="quotaInput"
                  :disabled="quotaBusy"
                  @change="onQuotaInput"
                />
                <em>个 / IP</em>
              </label>
            </div>
            <span class="ac-policy__hint">默认关闭。启用后，同一公网出口 IP 24 小时内最多注册 {{ quotaInput || 5 }} 个账号，适合在批量注册风险显现时开启。</span>
          </div>
        </div>
      </section>
      </div><!-- /ac-layout__main -->

      <!-- AI 调用与健康（右列） -->
      <div class="ac-layout__side">
      <section v-if="isLive && (reliability || probe.loaded || configLoadFailed)" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">AI 调用与健康</h3>
        <span class="mk-badge" :class="healthBadgeCls">{{ healthLabel }}</span>
      </div>

      <div v-if="configLoadFailed && !reliability && !probe.loaded" class="mk-alert mk-alert--row ac-config-error" role="alert">
        <span class="mk-alert__msg">配置读取失败</span>
        <button type="button" class="mk-alert__btn" @click="retryConfigLoad">重试</button>
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
          <em class="ac-probe__desc">{{ probe.enabled ? `每 ${probe.intervalSec}s 自动探测 5 项核心能力，保持健康快照不过期` : '关闭时快照不自动刷新，可手动「立即探测」' }}</em>
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
              class="mk-filter__input"
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
            {{ healthProbing ? '探测中…' : '立即探测' }}
          </button>
        </div>
      </div>

      <!-- 两列：左 = 调用参数，右 = 能力健康 -->
      <div class="ac-cols">
        <!-- 左列：调用参数（重试 / 超时 / 探测 分组） -->
        <div v-if="reliability || probe.loaded" class="ac-cols__main">
          <div class="ac-sec__title">调用参数<button v-if="dirty.has('reliability')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['reliability'])">{{ saving ? '保存中…' : '保存参数' }}</button></div>
          <div class="ac-groups">
            <div v-if="reliability" class="ac-group">
              <div class="ac-group__title">重试与超时</div>
              <div v-if="fallbackDisabled" class="ac-keyhint">⚠ 当前配置下「模型降级」永远不会触发:降级要求「1 + 传输重试 &lt; 上游最大尝试」。如需保留降级能力,请增大上游最大尝试或减小传输重试。</div>
              <div class="ac-group__fields">
                <label class="mk-field">
                  <span class="mk-field__label">上游最大尝试</span>
                  <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" :max="limMax('maxUpstreamAttempts', 10)" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">传输重试</span>
                  <input v-model.number="reliability.maxTransportRetries" type="number" min="0" :max="limMax('maxTransportRetries', 5)" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">逻辑重试</span>
                  <input v-model.number="reliability.maxLogicalRetries" type="number" min="0" :max="limMax('maxLogicalRetries', 5)" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">退避基数（毫秒）</span>
                  <input v-model.number="reliability.retryBaseDelayMs" type="number" :min="limMin('minRetryBaseDelayMs', 100)" :max="limMax('maxRetryBaseDelayMs', 60000)" step="100" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">Retry-After 上限（毫秒）</span>
                  <input v-model.number="reliability.maxRetryAfterMs" type="number" min="0" :max="limMax('maxRetryAfterMs', 30000)" step="1000" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">单次超时（毫秒）</span>
                  <input v-model.number="reliability.defaultRequestTimeoutMs" type="number" :min="limMin('minRequestTimeoutMs', 1000)" :max="limMax('maxRequestTimeoutMs', 600000)" step="1000" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field mk-field--switch">
                  <input type="checkbox" v-model="reliability.jitterEnabled" @change="markDirty('reliability')" />
                  <span class="mk-field__label" style="margin:0">随机抖动</span>
                </label>
              </div>
            </div>
            <div v-if="reliability" class="ac-group">
              <div class="ac-group__title">出站速率（平台全局）</div>
              <div class="ac-group__fields">
                <label class="mk-field">
                  <span class="mk-field__label">平台全局 RPM 上限（0=不限）</span>
                  <input v-model.number="reliability.platformRpmLimit" type="number" min="0" max="100000" step="10" class="mk-filter__input" @input="markDirty('reliability')" />
                  <span class="mk-field__hint">真实用户与平台自身调用的出站 LLM 请求速率上限；虚拟学习者走独立通道，不计入此处</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- 右列：能力健康 -->
        <div v-if="isLive" class="ac-cols__side">
          <div class="ac-sec__title">
            能力健康
            <span v-if="healthSummaryText" class="mk-badge" :class="healthSummaryBadge">{{ healthSummaryText }}</span>
            <span class="ac-sec__sub">
              <span v-if="health?.stale" class="ac-health__stale">上次探测 {{ timeAgo(health.checkedAt) }} · 快照已过期</span>
              <span v-else-if="health?.checkedAt" class="ac-health__stale">最近探测 {{ timeAgo(health.checkedAt) }}</span>
              <span v-else-if="health" class="ac-health__stale">尚未探测</span>
            </span>
          </div>
          <div v-if="health" class="ac-health">
            <div class="ac-health__head" aria-hidden="true">
              <span></span>
              <span>能力</span>
              <span>信息</span>
              <span>响应</span>
              <span>最近探测</span>
            </div>
            <div v-for="c in health.capabilities" :key="c.id" class="ac-health__row">
              <span class="ac-health__dot" :class="`is-${c.status}`"></span>
              <span class="ac-health__id mono">{{ c.id }}</span>
              <span class="ac-health__msg">{{ c.message }}</span>
              <span class="ac-health__lat mono">{{ c.latencyMs != null ? `${c.latencyMs}ms` : '—' }}</span>
              <span class="ac-health__time">{{ c.checkedAt ? timeAgo(c.checkedAt) : '未探测' }}</span>
            </div>
          </div>
          <div v-else-if="healthFailed" class="ac-rel__note ac-rel__error">
            健康快照不可用
            <button type="button" class="mk-link" :disabled="healthProbing" @click="probeHealth">{{ healthProbing ? '探测中…' : '重试' }}</button>
          </div>
          <MkLoading v-else inline text="健康快照加载中…" />
          <div class="ac-health__foot">
            <span v-if="health?.stale" class="ac-health__stale">快照已过期 · 使用上方「立即探测」或开启能力探针自动刷新</span>
            <span v-else-if="health?.checkedAt" class="ac-health__stale">快照有效 · 最近 {{ timeAgo(health.checkedAt) }} 更新</span>
          </div>
        </div>
      </div>
      </div><!-- /ac-body -->
      </section>
      </div><!-- /ac-layout__side -->
    </div><!-- /ac-layout -->

    <!-- 保存条：脏位分域标注（连接/路由/策略/可靠性/探测） -->
    <div v-if="dirty.size > 0" class="ac-save">
      <span class="ac-save__dot"></span>
      <span>{{ dirtyGroups.join(' + ') }} · {{ dirty.size }} 组未保存变更</span>
      <button type="button" class="mk-link" :disabled="saving" @click="discardAll">放弃</button>
      <button type="button" class="ac-save__primary" :disabled="saving" @click="saveAll">
        {{ saving ? '保存中…' : '保存变更' }}
      </button>
    </div>
    </div><!-- /ac-tab-body -->
    </template>

    <!-- ===== Tab2: 模型总览（只读；消费 /api/admin/model-registry） ===== -->
    <ModelRegistryOverview v-else-if="tab === 'overview'" ref="registryRef" @count="registryCount = $event" />

    <!-- ===== Tab3: 外挂能力（Addons embedded） ===== -->
    <Addons v-else ref="addonsRef" embedded @count="addonsCount = $event" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { dataSource, isLive } from './store'
import Addons from './Addons.vue'
import ModelRegistryOverview from './ModelRegistryOverview.vue'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  liveRunModelTest,
  liveSaveNetworkPolicy,
  timeAgo,
  errMsg
} from './live'
import { adminPlatformSettingsApi, adminCapabilityProbeApi, adminSystemApi, adminApiConfigApi } from '@/api/adminApi'
import {
  registrationEnabled,
  registerIpQuotaEnabled,
  registerIpDailyQuota,
  updateRegistrationSetting,
  updateRegisterIpQuotaSetting
} from './live'
import { askConfirm } from './useConfirm'
import MkLoading from '@/components/mk/MkLoading.vue'
import { toast } from '@/utils/toast'

/* ---------- 宿主：接入与模型 · 模型总览 · 外挂能力 ----------
   ?tab=model|overview|addons 双向同步；模型总览嵌入只读 ModelRegistryOverview，
   外挂能力嵌入 Addons（embedded，域计数上报宿主） */
const AC_TABS = ['model', 'overview', 'addons'] as const
type AcTab = (typeof AC_TABS)[number]
const tab = ref<AcTab>('model')
const route = useRoute()
const router = useRouter()
const addonsCount = ref(0)
const addonsRef = ref<{ refresh?: () => void } | null>(null)
const registryCount = ref({ models: 0, warnings: 0 })
const registryRef = ref<{ refresh?: (force?: boolean) => void } | null>(null)

/** 逻辑别名候选（来自后端只读总览，避免前端硬编码与注册表漂移） */
const aliasOptions = ref<string[]>([])
onMounted(async () => {
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    const aliases = res?.data?.data?.aliases
    aliasOptions.value = Array.isArray(aliases)
      ? aliases.map((item: { alias: string }) => item.alias).filter(Boolean)
      : []
  } catch {
    aliasOptions.value = []
  }
})
watch(
  () => route?.query?.tab,
  (t) => {
    const v = typeof t === 'string' && (AC_TABS as readonly string[]).includes(t) ? (t as AcTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'model') tab.value = 'model'
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
}
interface CapSnapshot {
  overall: CapHealth['status']
  checkedAt: string | null
  stale: boolean
  capabilities: CapHealth[]
}
const health = ref<CapSnapshot | null>(null)
const healthFailed = ref(false)
const healthProbing = ref(false)

/** 汇总角标：「5 能力 · 1 异常」——异常 = degraded/unavailable；unknown 归「待确认」，不假装实时 */
const healthSummaryText = computed(() => {
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

/** 同页时间源统一：状态条「上次探测」与能力行「最近探测」同源（健康快照 checkedAt），
    DB lastCheckedAt 仅在快照不可用时兜底——消除「8 分钟前 vs 9 小时前」双写分叉 */
const lastCheckedText = computed(() => {
  if (health.value?.checkedAt) return timeAgo(health.value.checkedAt)
  if (cfg.value?.lastCheckedAt) return timeAgo(cfg.value.lastCheckedAt)
  return ''
})

const healthLabel = computed(
  () =>
    ({ operational: '全部正常', degraded: '部分降级', unavailable: '存在不可用', unknown: '状态确认中' })[
      health.value?.overall || 'unknown'
    ]
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

async function probeHealth() {
  if (healthProbing.value) return
  healthProbing.value = true
  try {
    const res = await adminSystemApi.probeCapabilities()
    health.value = res.data?.data ?? res.data ?? null
    healthFailed.value = false
  } catch {
    healthFailed.value = true
  } finally {
    healthProbing.value = false
  }
}

/* ---------- 表单状态（live 一套交互） ---------- */
const form = reactive({
  apiUrl: '',
  apiKey: '',
  defaultModel: '',
  defaultReasoningModel: '',
  defaultEvaluationModel: '',
  defaultThinkingMode: 'default' as 'default' | 'enabled' | 'disabled',
  defaultReasoningEffort: 'default' as 'default' | 'low' | 'high' | 'max'
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
/** 最近一次「连接并拉取」的失败原因：展示在模型清单空态，避免错误上下文丢失（刷新即消失） */
const fetchError = ref('')
/** 曾成功拉取过模型列表（含从已保存配置载入）：此后提交才携带 availableModels，避免空数组清空后端列表 */
const modelsFetchedOnce = ref(false)
/** 模型清单的拉取来源端点:与表单地址一致才允许随连接保存 */
const fetchedModelsEndpoint = ref('')
/** 已保存的服务地址：endpoint 被改动且 Key 留空时提示重新输入密钥 */
const savedApiUrl = ref('')

const dirty = ref<Set<string>>(new Set())
function markDirty(group: string) {
  dirty.value = new Set([...dirty.value, group])
}

/** 脏位分域标注：5 组 → 保存条列出具体未保存组（连接/路由/策略/可靠性/探测） */
const DIRTY_GROUP_LABELS: Record<string, string> = {
  conn: '连接',
  route: '路由',
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
    if (dirty.value.size > 0) {
      const ok = await askConfirm({
        title: '丢弃未保存的配置修改?',
        message: `配置数据已刷新,继续将覆盖以下未保存的修改:${[...dirty.value].join(' / ')}。`,
        confirmText: '覆盖'
      })
      if (ok) applyLiveConfig()
    } else {
      applyLiveConfig()
    }
    if (!reliability.value) void loadReliability()
    if (!probe.loaded) void loadProbe()
    void loadHealth()
  },
  { immediate: true, deep: true }
)

// 路由离开守卫:与其他管理页(SkillDesignPage)同款,未保存修改不静默丢失
onBeforeRouteLeave(async () => {
  if (dirty.value.size === 0) return true
  const ok = await askConfirm({
    title: '有未保存的配置修改',
    message: `尚未保存的域:${[...dirty.value].join(' / ')}。离开将丢弃这些修改,确认离开?`,
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
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnloadHandler))

const models = computed(() => fetchedModels.value)

/** 思考开关 = enabled(强制) 或 default(跟随模型) 视为"开"；disabled 视为"关"。
    关闭时后端仍可被 skill 级配置覆盖；此处仅表达平台默认。 */
const thinkingOn = computed(() => form.defaultThinkingMode !== 'disabled')
function setThinkingOn(on: boolean) {
  // 开 → 回到「跟随模型默认」（不强制）；关 → disabled，同时强度复位 default
  form.defaultThinkingMode = on ? (form.defaultThinkingMode === 'disabled' ? 'default' : form.defaultThinkingMode) : 'disabled'
  if (!on) form.defaultReasoningEffort = 'default'
  markDirty('route')
}

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

const ready = computed(() => keySet.value && models.value.length > 0 && !!form.defaultModel)
const routeCount = computed(() => [form.defaultModel, form.defaultReasoningModel, form.defaultEvaluationModel].filter(Boolean).length)
/** 模型清单状态说明：区分「清单未拉取」与「已就绪」，不点「默认路由 3/3」暗示整体就绪 */
const modelListTitle = computed(() =>
  models.value.length
    ? `已拉取 ${models.value.length} 个服务商模型`
    : '尚未拉取服务商模型清单；下方「路由默认」标「当前生效」的是平台实际在用模型，切换取值需先拉取清单',
)
const routeTitle = computed(
  () => `已指定 ${routeCount.value} / 3 条默认路由（对话 / 推理 / 评估）。路由数只表示已指定，不代表模型清单已就绪`,
)
const statusTone = computed(() => {
  if (ready.value) return 'mk-status--ok'
  if (keySet.value) return 'mk-status--muted'
  return 'mk-status--warn'
})
const connBadge = computed(() => {
  if (connectionStatus.value === 'connected') return { cls: 'mk-badge--ok', text: '连接正常' }
  if (connectionStatus.value === 'failed') return { cls: 'mk-badge--bad', text: '上次连接失败' }
  return { cls: 'mk-badge--muted', text: '连接未探测' }
})

/** 已配置密钥但改了服务地址且 Key 留空：密钥不会随地址迁移，需提示重新输入 */
const keyHintNeeded = computed(
  () => keySet.value && !!form.apiUrl && form.apiUrl !== savedApiUrl.value && !form.apiKey.trim()
)

const accessOptions = [
  { id: 'loopback' as const, label: '仅本机' },
  { id: 'private' as const, label: '本机 + 局域网' },
  { id: 'any' as const, label: '不限制' }
]

/* ---------- 操作 ---------- */
const fetching = ref(false)
const testing = ref(false)
const saving = ref(false)
const testModel = ref('')
const testResult = ref<{ ok: boolean; text: string; latency?: string; usage?: string } | null>(null)

watch(models, (ms) => {
  if (ms.length && !ms.includes(testModel.value)) testModel.value = ms[0]
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
    fetchError.value = ''
    markDirty('conn')
    toast.info(list.length ? `已获取 ${list.length} 个模型，记得保存` : '连接成功，但服务未返回模型列表')
  } catch (e) {
    connectionStatus.value = 'failed'
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
      text: r.text.slice(0, 80),
      latency: r.latencyMs ? `${r.latencyMs}ms` : `${Date.now() - started}ms`,
      usage: r.usage
    }
  } catch (e) {
    testResult.value = { ok: false, text: errMsg(e).slice(0, 80) }
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
  try {
    // 分域保存:连接与路由各自独立提交(后端 PUT 为 partial 合并语义),
    // 修复「保存路由顺带落盘改了一半的连接」的范围错位
    if (set.has('conn')) {
      const payload: { apiUrl: string; apiKey: string; availableModels?: string[] } = {
        apiUrl: form.apiUrl,
        apiKey: form.apiKey
      }
      // 仅当模型清单来自「当前服务地址」的拉取时才携带,
      // 防止换地址后把上一个服务商的列表挂到新地址(applyLiveConfig 的回显同理按 savedApiUrl 归属)
      if (fetchedModelsEndpoint.value === form.apiUrl.trim()) payload.availableModels = fetchedModels.value
      await liveSaveApiConfig(payload as Parameters<typeof liveSaveApiConfig>[0])
    }
    if (set.has('route')) {
      await liveSaveApiConfig({
        defaultModel: form.defaultModel,
        defaultReasoningModel: form.defaultReasoningModel,
        defaultEvaluationModel: form.defaultEvaluationModel,
        defaultThinkingMode: form.defaultThinkingMode,
        defaultReasoningEffort: form.defaultReasoningEffort
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
  }
}

function saveAll() {
  return saveGroups([...dirty.value])
}

function discardAll() {
  applyLiveConfig()
  void loadReliability()
  void loadProbe()
  toast.info('已放弃未保存的变更')
}

/* 注册开关：高风险操作，二次确认 */
const registrationBusy = ref(false)
async function toggleRegistration() {
  if (registrationBusy.value || registrationEnabled.value === null) return
  const target = !registrationEnabled.value
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

function onQuotaInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isInteger(v)) return
  quotaInput.value = Math.min(100, Math.max(1, v))
  void saveQuota(true, quotaInput.value)
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
.ac-tabs { width: fit-content; }
/* 模型 tab：内容在宿主 flex 列内独立滚动（状态条/pills 固定；底部保存条 sticky 于滚动容器） */
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

/* 卡内内容容器：统一内边距与间距（mk-card__head 之下），全页各卡同一语言 */
.ac-body { display: grid; gap: 14px; padding: 4px 16px 16px; }
.ac-row { display: grid; gap: 14px; align-items: end; }
.ac-row--2-1 { grid-template-columns: 1.6fr 1fr; }
.ac-row--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
/* mk-field 已在 shared.css 定义；此处只补 mk-field 下 .mk-filter__input 的 100% 宽 */
.mk-field .mk-filter__input,
.mk-field .mk-filter__select { width: 100%; }
.ac-body .mk-field { margin: 0; min-width: 0; }
.ac-body .mk-filter__select[disabled] { opacity: 0.6; cursor: not-allowed; }
.ac-key-wrap { display: grid; gap: 4px; min-width: 0; }
.ac-key-input-row { display: flex; align-items: center; gap: 6px; }
.ac-key-input-row .mk-filter__input { flex: 1; min-width: 0; }
.ac-key-toggle {
  flex-shrink: 0;
  border: 1px solid var(--mk-line);
  background: #fafbfc;
  border-radius: 8px;
  width: 32px;
  height: 32px;
  font-size: var(--mk-fs-14);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ac-key-toggle:hover { background: #eef5ff; border-color: var(--mk-blue, #2c63d0); }
.ac-keyhint {
  font-size: var(--mk-fs-12);
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
.ac-test__meta { font-size: var(--mk-fs-12); color: var(--mk-faint); white-space: nowrap; }
.ac-test__text {
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.ac-test__text--bad { color: var(--mk-red); }
.ac-test__btn { align-self: flex-end; }

.ac-models { display: flex; gap: 6px; flex-wrap: wrap; }
.ac-model {
  padding: 4px 10px;
  border-radius: 7px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-12);
  font-weight: 600;
}
/* 可用模型空态：引导操作而非一行弱文字（原「尚未拉取模型」独占一行显空） */
.ac-models__empty {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px dashed var(--mk-line);
  border-radius: 8px;
  background: #fafbfc;
  color: var(--mk-muted);
  font-size: var(--mk-fs-12_5);
}
.ac-models__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-size: var(--mk-fs-13);
  font-weight: 800;
  flex-shrink: 0;
}

/* 默认思考：开关 + 强度 + 模式，与「路由默认」同一三列网格语言 */
.ac-think .mk-field--switch { align-self: center; }

/* 安全与访问卡：2×2 宫格（左列 ~700px 宽），虚线分隔按行划分——
   第 1、2 项无上分隔；第 3、4 项加顶部虚线换行分隔 */
.ac-policy { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 0; padding: 6px 16px 16px; }
.ac-policy__item { display: grid; gap: 10px; align-content: start; min-width: 0; padding-left: 18px; border-left: 1px dashed #e6eaf0; }
.ac-policy__item:nth-child(odd) { padding-left: 0; border-left: none; }
.ac-policy__item:nth-child(n + 3) { padding-top: 14px; border-top: 1px dashed #e6eaf0; }
html[data-theme='dark'] .ac-policy__item { border-color: #2a3446; }
.ac-policy__label { font-size: var(--mk-fs-12_5); font-weight: 700; color: var(--mk-muted); }
.ac-policy__desc { font-size: var(--mk-fs-12_5); color: var(--mk-muted); line-height: 1.6; }
.ac-policy__hint { font-size: var(--mk-fs-12_5); color: var(--mk-faint); line-height: 1.55; display: block; }
.ac-policy__toggle { width: fit-content; }
.ac-policy__warn { font-size: var(--mk-fs-12_5); color: var(--mk-red); font-weight: 600; }
.ac-quota-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-quota-seg { width: fit-content; }
.ac-quota-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
}
.ac-quota-field .mk-filter__input { width: 76px; text-align: center; }
.ac-quota-field em { font-style: normal; color: var(--mk-faint); }
/* 主布局：左列(接入与模型 + 安全与访问 纵向叠放) / 右列(AI 调用与健康)。
   安全卡放左列下方填满空档；两栏 1.1:1 接近等宽，右列监控表亦不受挤 */
.ac-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.ac-layout__main {
  display: grid;
  gap: 12px;
  min-width: 0;
  align-content: start;
}
.ac-layout__side {
  min-width: 0;
  display: grid;
  gap: 12px;
  align-content: start;
}
.ac-layout > .mk-card, .ac-layout__main > .mk-card, .ac-layout__side > .mk-card { min-width: 0; }
/* 分段小标题（连接 / 路由默认 / 默认思考 / 连通性验证 / 调用参数 / 能力健康）：
   统一简洁粗体灰字——不放大写、不加横线后缀，用留白分区（与全站表单一致） */
.ac-sec__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  color: var(--mk-muted);
}
.ac-sec__hint { font-size: var(--mk-fs-12_5); font-weight: 500; color: var(--mk-faint); }
.ac-sec__sub { margin-left: auto; font-size: var(--mk-fs-12_5); font-weight: 500; color: var(--mk-faint); }
/* 分段保存（方向 A）：该段有未保存改动时才出现；与底部统一保存条并存 */
.ac-sec__save {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid rgba(44, 99, 208, 0.3);
  background: rgba(44, 99, 208, 0.08);
  color: var(--mk-blue);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  cursor: pointer;
}
.ac-sec__save:hover { background: rgba(44, 99, 208, 0.16); }
.ac-sec__save:disabled { opacity: 0.6; cursor: not-allowed; }
/* 分段控件走 .mk-seg（shared.css） */

.ac-textarea { resize: vertical; font-size: var(--mk-fs-12); }

/* 能力健康 */
.ac-health { display: grid; padding: 2px 0 8px; }
/* 列头（P3）：能力行各列为无标注数字（响应 ms / 相对时间），补一行表头说明语义 */
.ac-health__head {
  display: grid;
  grid-template-columns: 10px 200px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 4px 0 2px;
  border-bottom: 1px solid #f0f2f5;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.ac-health__head span:last-child { white-space: nowrap; }
.ac-health__row {
  display: grid;
  grid-template-columns: 10px 200px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid #f0f2f5;
  font-size: var(--mk-fs-12);
}
.ac-health__row:last-child { border-bottom: none; }
.ac-health__dot { width: 8px; height: 8px; border-radius: 50%; }
.ac-health__dot.is-operational { background: var(--mk-green); }
.ac-health__dot.is-degraded { background: var(--mk-amber); }
.ac-health__dot.is-unavailable { background: var(--mk-red); }
.ac-health__dot.is-unknown { background: var(--mk-faint); }
.ac-health__id { font-size: var(--mk-fs-11); color: var(--mk-ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-health__msg { color: var(--mk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-health__lat { font-size: var(--mk-fs-11); color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.ac-health__time { font-size: var(--mk-fs-11); color: var(--mk-faint); white-space: nowrap; }
.ac-health__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 0 14px;
  border-top: 1px solid #f0f2f5;
  margin-top: 4px;
}
/* stale 时「立即探测」红色脉冲（A3：承认探活默认关闭的机制性状态，引导手动探测） */
.ac-probe--alert {
  border-color: var(--mk-red) !important;
  color: var(--mk-red) !important;
  animation: ac-probe-pulse 1.6s ease infinite;
}
@keyframes ac-probe-pulse {
  50% { box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.18); }
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
  font-size: var(--mk-fs-11);
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
.ac-probe__interval .mk-filter__input { width: 72px; text-align: center; }
.ac-probe__unit { font-style: normal; color: var(--mk-faint); font-size: var(--mk-fs-11); }

.ac-health__stale { font-size: var(--mk-fs-11); color: var(--mk-faint); }

/* 调用参数 + 能力健康：右卡内纵向分区（ac-body 统一间距，无内嵌双栏/竖线） */
.ac-cols { display: grid; gap: 14px; align-items: start; }
.ac-cols__main, .ac-cols__side { min-width: 0; padding: 0; }
.ac-groups { display: grid; gap: 12px; }
.ac-group { display: grid; gap: 10px; }
.ac-group__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.ac-group__fields .mk-field { margin: 0; }
/* 单字段分组（超时仅一项）：不拉全宽，保持与多字段组同网格节奏 */

/* 分组副标题：与 ac-sec__title 同族更轻（重试/超时） */
.ac-group__title {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--mk-faint);
}
/* 开关控件：统一走全站 mk-field--switch（原生 checkbox + label + accent-color 蓝），
   不再使用自定义 iOS 滑块（2026-09 与全站 admin 视觉对齐） */
.mk-field--switch { align-content: start; }
.mk-field--switch input[type='checkbox'] { accent-color: var(--mk-blue, #2c63d0); cursor: pointer; }

.ac-rel__note {
  margin: 0;
  padding: 0 0 14px;
  font-size: var(--mk-fs-12);
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
.ac-rel__error .mk-link { font-size: var(--mk-fs-12); }
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
  border: 1px solid rgba(44, 99, 208, 0.24);
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
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ac-save__primary:disabled { opacity: 0.6; cursor: not-allowed; }


/* 侧栏占 208px，断点需按视口 1100px 触发（内容区 ≈ 892px），安全策略单列 */
@media (max-width: 1100px) {
  .ac-layout { grid-template-columns: 1fr; }
  .ac-policy { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ac-cols { grid-template-columns: 1fr; }
  .ac-cols__main { padding: 0 16px; }
  .ac-cols__side { border-left: none; padding: 0 16px; margin-top: 6px; }
}
@media (max-width: 800px) {
  /* 两列/三列栅格在窄屏回落单列：此前漏掉这两条，390 下「服务地址 | API Key」
     仍强行并排，服务地址输入框被 180px 下限撑破、压掉 API Key（审计 P1 2.2） */
  .ac-row--2-1,
  .ac-row--3 { grid-template-columns: 1fr; }
  .ac-group__fields { grid-template-columns: 1fr; }
  .ac-health__row { grid-template-columns: 10px minmax(0, 1fr) auto; }
  .ac-health__head { grid-template-columns: 10px minmax(0, 1fr) auto; }
  .ac-health__msg { display: none; }
  .ac-health__head span:nth-child(3) { display: none; }

  .ac-policy { grid-template-columns: 1fr; }
  .ac-policy__item { padding-left: 0; border-left: none; padding-top: 12px; border-top: 1px dashed #e6eaf0; }
  .ac-policy__item:first-child { padding-top: 0; border-top: none; }
  html[data-theme='dark'] .ac-policy__item { border-color: #2a3446; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .ac-body { gap: 16px; padding: 6px 18px 18px; }
  .mk-field__label { font-size: 13.5px; }
  .ac-model { font-size: var(--mk-fs-13); padding: 5px 12px; }

  .ac-policy { gap: 16px 0; padding: 6px 18px 18px; }
  .ac-policy__label { font-size: 13.5px; }
  .ac-policy__desc { font-size: var(--mk-fs-13); }
  .ac-policy__warn { font-size: var(--mk-fs-13); }
  .mk-seg { border-radius: 12px; }
  .mk-seg__item { font-size: 13.5px; padding: 8px 14px; }
  .ac-textarea { font-size: 13.5px; }
  .ac-sec__title { font-size: var(--mk-fs-13); }
  .ac-sec__hint { font-size: var(--mk-fs-12); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-sec__sub { font-size: var(--mk-fs-12_5); }
  .ac-group__title { font-size: var(--mk-fs-12_5); }
  .ac-groups { gap: 20px; padding: 4px 0 8px; }
  .ac-rel__note { font-size: var(--mk-fs-13); }
  .ac-health__row { grid-template-columns: 12px 210px 1fr auto auto; gap: 12px; padding: 9px 0; font-size: 13.5px; }
  .ac-health__head { grid-template-columns: 12px 210px 1fr auto auto; gap: 12px; padding: 5px 0 3px; font-size: var(--mk-fs-12_5); }
  .ac-health__id,
  .ac-health__lat,
  .ac-health__time { font-size: var(--mk-fs-12_5); }
  .ac-health__stale { font-size: var(--mk-fs-12_5); }
  .ac-save { padding: 11px 14px 11px 18px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .ac-body { gap: 18px; padding: 8px 22px 22px; }
  .mk-field__label { font-size: 15.5px; }
  .ac-model { font-size: var(--mk-fs-15); padding: 6px 14px; border-radius: 9px; }

  .ac-policy { gap: 18px 0; padding: 8px 22px 22px; }
  .ac-policy__label { font-size: 15.5px; }
  .ac-policy__desc { font-size: var(--mk-fs-15); }
  .ac-policy__warn { font-size: var(--mk-fs-15); }
  .mk-seg__item { font-size: 15.5px; padding: 9px 16px; }
  .ac-textarea { font-size: 15.5px; }
  .ac-sec__title { font-size: var(--mk-fs-15); }
  .ac-sec__hint { font-size: var(--mk-fs-14); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-sec__sub { font-size: 14.5px; }
  .ac-group__title { font-size: 14.5px; }
  .ac-groups { gap: 22px; padding: 6px 0 8px; }
  .ac-rel__note { font-size: var(--mk-fs-15); }
  .ac-health__row { grid-template-columns: 14px 260px 1fr auto auto; gap: 14px; padding: 11px 0; font-size: 15.5px; }
  .ac-health__head { grid-template-columns: 14px 260px 1fr auto auto; gap: 14px; padding: 6px 0 3px; font-size: 14.5px; }
  .ac-health__id,
  .ac-health__lat,
  .ac-health__time { font-size: 14.5px; }
  .ac-health__stale { font-size: 14.5px; }
  .ac-save { padding: 13px 16px 13px 20px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .ac-body { gap: 20px; padding: 10px 26px 26px; }
  .mk-field__label { font-size: var(--mk-fs-18); }
  .ac-model { font-size: 17.5px; padding: 7px 16px; }

  .ac-policy { gap: 20px 0; padding: 10px 26px 26px; }
  .ac-policy__label { font-size: var(--mk-fs-18); }
  .ac-policy__desc { font-size: 17.5px; }
  .ac-policy__warn { font-size: 17.5px; }
  .mk-seg__item { font-size: var(--mk-fs-18); padding: 11px 19px; }
  .ac-textarea { font-size: var(--mk-fs-18); }
  .ac-sec__title { font-size: 17.5px; }
  .ac-sec__hint { font-size: var(--mk-fs-16); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-sec__sub { font-size: 17px; }
  .ac-group__title { font-size: 17px; }
  .ac-groups { gap: 26px; padding: 8px 0 10px; }
  .ac-rel__note { font-size: 17.5px; }
  .ac-health__row { grid-template-columns: 16px 310px 1fr auto auto; gap: 16px; padding: 13px 0; font-size: var(--mk-fs-18); }
  .ac-health__head { grid-template-columns: 16px 310px 1fr auto auto; gap: 16px; padding: 7px 0 4px; font-size: 17px; }
  .ac-health__id,
  .ac-health__lat,
  .ac-health__time { font-size: 17px; }
  .ac-health__stale { font-size: 17px; }
  .ac-save { padding: 15px 18px 15px 24px; }
}

/* ================= 暗色模式（D1 补完）：模型与接入 ================= */
html[data-theme='dark'] {
  .ac-key-toggle:hover { background: rgba(91, 141, 239, 0.14); }
  .mk-seg { background: #1d2739; }
  .mk-seg__item--active { background: rgba(91, 141, 239, 0.22); color: #9db8f5; box-shadow: none; }
  .ac-save { background: #141c2b; border-color: #232f45; }
  /* 补漏：密钥切换钮/模型胶囊浅底 */
  .ac-key-toggle,
  .ac-model { background: #1d2739; color: #9fb0c8; }
  /* 硬编码浅色分隔线（卡内分区/健康表行）暗色适配 */
  .ac-health__head,
  .ac-health__row,
  .ac-health__foot { border-color: #232f45; }
  .ac-models__empty { background: #141c2b; border-color: #2a3850; }
}
</style>
