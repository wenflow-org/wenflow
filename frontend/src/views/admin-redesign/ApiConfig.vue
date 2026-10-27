<template>
  <div class="mk-page mk-page--fill ac-host">
    <MkPageHead title="模型与接入">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" @click="providersRef?.refresh?.(true)">刷新注册表</button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" :disabled="fetching || !providersReady" @click="onFetchClick">
          <MkLoading v-if="fetching" inline text="拉取中…" />
          <span v-else>{{ !providersReady ? '读取配置中…' : models.length ? '重新拉取' : '连接并拉取' }}</span>
        </button>
      </template>
    </MkPageHead>
    <!-- 页首 KPI 带已撤（2026-10-14 用户拍板「模型与接入的 kpi 也不要了」）：原两处带
         都是把下方卡里已有的读数抄一遍——密钥在连接页签（API Key 行的「留空 = 沿用已配置」
         + 连接徽标）、模型清单在模型页签、默认模型在生成参数页签。
         撤带后这些事实各有唯一出口，页首只留页名与主操作。 -->

    <!-- 单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，这个页面我觉得
         可以和前面的合并了」）：一级页签「接入 / 调用」撤除，本页自上而下两段——
         ① 供应商面板：左列表 / 右详情；平台详情的二级页签 = 模型 / 连接 / 基础设施 / 生成参数
         ② 调用策略（尝试与降级、退避与超时、平台出站速率 + 近 1 小时 429 / 冷却读数）
         「平台默认生成参数」并进平台详情第四个页签：它就是「这些模型默认怎么生成」，
         与模型表是同一个对象，此前单独一张卡叫「平台默认生成参数」，读起来像另一套设置。
         旧键 ?tab=routing / runtime / model-routing 仍归一到这里（TAB_ALIAS），书签不失效。 -->
    <div class="ac-tab-body ac-conn-body" id="ac-panel-access">
      <!-- 接入域（live 层）读取失败：表单全空不得伪装成「未配置」，显式失败 + 重试 -->
      <div v-if="apiConfigFailed" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">配置读取失败：为空不代表未配置</span>
        <button type="button" class="mk-alert__btn" @click="retryApiConfigLoad">重试</button>
      </div>
      <ModelProvidersPanel
        ref="providersRef"
        :upstream="models"
        @changed="onProvidersChanged"
        @registered="onProvidersRegistered"
        @platform-tab="platformTabKey = $event"
      >
        <template #card-actions>
          <button type="button" class="mk-btn mk-btn--sm mk-btn--danger" :disabled="resetting" @click="resetConfig">
            {{ resetting ? '重置中…' : '重置接入配置' }}
          </button>
        </template>
        <!-- 平台通道的连接：服务地址 / 密钥 / 连通性验证。它属于「平台」这条供应商本身，
             不再是弹窗里的一个分区。2026-10-26 起它是平台详情的「连接」页签，块头不再复述
             「连接」二字（页签已说明区域），只留状态徽标与保存钮。 -->
        <template #platform-detail>
          <div ref="platformConnRef" class="ac-conn mpp-block">
            <div class="mpp-block__head">
              <span class="mk-badge" :class="connBadge.cls" :title="connBadgeTitle">{{ connBadge.text }}</span>
              <button
                v-if="dirty.has('conn')"
                type="button"
                class="ac-sec__save"
                :disabled="saving"
                @click="saveGroups(['conn'])"
              >{{ saving ? '保存中…' : '保存连接' }}</button>
            </div>
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
                    <!-- 2026-10-27 原生 select → MkSelect：选项随上游清单动态生成；
                         非对话模型的提示已并入可见 label（MkSelect 选项无逐项 title）。 -->
                    <MkSelect
                      v-model="testModel"
                      :options="testModelOptions"
                      aria-label="测试模型"
                      :disabled="!models.length"
                      block
                    />
                  </label>
                  <button type="button" class="mk-btn mk-btn--primary ac-test__btn" :disabled="!models.length || testing" @click="runTest">
                    <MkLoading v-if="testing" inline text="测试中…" />
                    <span v-else>运行测试</span>
                  </button>
                  <span v-if="testResult" class="ac-test__result">
                    <span class="mk-badge" :class="testResult.ok ? 'mk-badge--ok' : 'mk-badge--bad'">{{ testResult.ok ? '测试通过' : '测试失败' }}</span>
                    <span class="ac-test__meta mono">{{ testResult.latency || '—' }}{{ testResult.usage ? ` · ${testResult.usage}` : '' }}</span>
                    <span class="ac-test__text" :class="{ 'ac-test__text--bad': !testResult.ok }" :title="testResult.text">「{{ testResult.text }}」</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 上游模型（只报已拉取/已添加的读数，逐条清单由面板渲染） -->
        <template #models-meta>
          <p class="ac-models-meta ac-models__line">
            <span class="ac-models-meta__title">上游模型</span>
            <span v-if="fetchError && !models.length" :title="`错误原文：${fetchError}`">拉取失败，请检查服务地址与密钥</span>
            <span v-else-if="models.length">{{ upstreamSummary }}</span>
            <span v-else>尚未拉取</span>
            <span v-if="hasUnsavedModels" class="mk-badge mk-badge--warn">未保存</span>
          </p>
        </template>

        <!-- 基础设施（向量化 / 重排）：平台这条供应商自己的能力，收进平台详情第三个页签。
             2026-10-26 用户「这个地方就可以配置重排序嵌入模型」——原先它自成一张卡挂在
             页面最下方，改嵌入模型要滚过整个模型表，而且「平台」被拆成两处看。 -->
        <template #platform-infra>
          <InfraModelsPanel embedded />
        </template>
        <!-- 生成参数（思考模式 / 思考强度 / 输出格式 + 别名映射）：平台这条供应商的生成默认，
             收进平台详情第四个页签。2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的
             模型吗，这个页面我觉得可以和前面的合并了」——此前它是本页最上方一张独立卡，
             叫「平台默认生成参数」，读起来像另一套设置；其实它就是「这些模型默认怎么生成」，
             与模型表同一个对象。模型级覆盖优先（模型编辑里的「用平台默认」），这里兜底。
             别名映射表是这些默认的解析结果，一并跟过来。 -->
        <template #platform-generation>
          <div class="mpp-block__head">
            <span class="mpp-sec">生成参数</span>
            <span v-if="runtimeDefaultInfo" class="ac-gen-default__inline">
              <span class="ac-gen-default__sep" aria-hidden="true">·</span>
              默认模型 <b class="mono">{{ runtimeDefaultInfo.model || '—' }}</b>
              <span class="mk-badge" :class="runtimeDefaultInfo.source === '环境变量' ? 'mk-badge--warn' : 'mk-badge--muted'">{{ runtimeDefaultInfo.source }}</span>
            </span>
            <button v-if="dirty.has('route')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['route'])">{{ saving ? '保存中…' : '保存生成参数' }}</button>
          </div>
          <div class="ac-gen-body">
            <div class="ac-cols">
              <div class="ac-cols__main">
                <div class="ac-sec__title">默认思考</div>
                <div class="ac-row ac-row--2 ac-think">
                  <label class="mk-field">
                    <span class="mk-field__label">思考模式</span>
                    <!-- 2026-10-27 原生 select → MkSelect -->
                    <MkSelect
                      v-model="form.defaultThinkingMode"
                      :options="THINKING_MODE_OPTIONS"
                      aria-label="思考模式"
                      @change="setThinkingMode"
                      block
                    />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">思考强度</span>
                    <!-- 2026-10-27 原生 select → MkSelect -->
                    <MkSelect
                      v-model="form.defaultReasoningEffort"
                      :options="EFFORT_OPTIONS"
                      aria-label="思考强度"
                      :disabled="!thinkingOn"
                      @change="setEffort"
                      block
                    />
                  </label>
                </div>
              </div>
              <div class="ac-cols__side">
                <div class="ac-sec__title">结构化输出</div>
                <div class="ac-row ac-row--2">
                  <label class="mk-field">
                    <span class="mk-field__label">输出格式</span>
                    <!-- 2026-10-27 原生 select → MkSelect：v-model 保留联合值类型，
                         change 只负责标脏 -->
                    <MkSelect
                      v-model="form.defaultResponseFormat"
                      :options="RESPONSE_FORMAT_OPTIONS"
                      aria-label="输出格式"
                      @change="markDirty('route')"
                      block
                    />
                  </label>
                </div>
              </div>
            </div>
            <details class="ac-fold">
              <summary class="ac-fold__bar">
                <span class="ac-fold__title">内置别名映射表</span>
                <span class="ac-fold__mark" aria-hidden="true"></span>
              </summary>
              <ModelRegistryOverview ref="registryRef" class="ac-registry ac-registry--aliases" :parts="['aliases']" @defaults="registryDefaults = $event" />
            </details>
          </div>
        </template>
      </ModelProvidersPanel>

      <!-- ===== 调用策略（2026-10-26 重建）=====
           2026-10-26 用户「不用写那么详细，分那么多，就最大重试、间隔、rpm 就够了」：
           原先三组八个控件（上游尝试 / 传输重试 / 逻辑重试 / 退避基数 / Retry-After /
           单次超时 / 随机抖动 / RPM）是一份网关调参台，而这一页的读者只想知道
           「重试几次、隔多久、出站多快」。收成三个字段一行；没露出的几项沿用库里现值，
           保存时原样回传（不会因为界面不显示而被重置成默认值），一句注解说明这点。
           右侧仍是这些参数的效果面：近 1 小时 429 与冷却模型。 -->
      <section v-if="isLive && (reliability || configLoadFailed)" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">调用策略</h3>
          <button v-if="dirty.has('reliability')" type="button" class="ac-sec__save" :disabled="saving" @click="saveGroups(['reliability'])">{{ saving ? '保存中…' : '保存参数' }}</button>
        </div>
        <div class="ac-body ac-policy">
          <div class="ac-policy__form">
            <div v-if="configLoadFailed && !reliability" class="mk-alert mk-alert--row ac-config-error" role="alert">
              <span class="mk-alert__msg">配置读取失败</span>
              <button type="button" class="mk-alert__btn" @click="retryConfigLoad">重试</button>
            </div>
            <!-- 不变式违例升格为卡级告警：三个数字里最该先读的一句 -->
            <div v-if="reliability && fallbackDisabled" class="mk-alert mk-alert--row ac-fallback-alert" role="alert">
              <span class="mk-alert__msg">当前重试预算下「模型降级」永远不会触发：同模型重试会先耗尽尝试次数，请把「最大重试」调大</span>
            </div>
            <div v-if="reliability" class="ac-policy__fields">
              <label class="mk-field">
                <span class="mk-field__label">最大重试</span>
                <span class="ac-policy__control">
                  <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" :max="limMax('maxUpstreamAttempts', 10)" class="mk-field__input" @input="markDirty('reliability')" />
                  <em class="ac-policy__unit">次</em>
                </span>
              </label>
              <label class="mk-field">
                <span class="mk-field__label">重试间隔</span>
                <span class="ac-policy__control">
                  <input v-model.number="reliability.retryBaseDelayMs" type="number" :min="limMin('minRetryBaseDelayMs', 100)" :max="limMax('maxRetryBaseDelayMs', 60000)" step="100" class="mk-field__input" @input="markDirty('reliability')" />
                  <em class="ac-policy__unit">毫秒</em>
                </span>
              </label>
              <label class="mk-field">
                <span class="mk-field__label">出站 RPM 上限</span>
                <span class="ac-policy__control">
                  <input v-model.number="reliability.platformRpmLimit" type="number" min="0" max="100000" step="10" class="mk-field__input" @input="markDirty('reliability')" />
                  <em class="ac-policy__unit">次/分</em>
                </span>
              </label>
            </div>
            <!-- 一句说清这个数字的口径（它是总尝试上限，不是「同模型重试几次」）：
                 其余细项仍生效、仍随保存原样回传，只是不再占版面 -->
            <p v-if="reliability" class="ac-policy__note">
              「最大重试」是总尝试上限，含首次调用与改用备用模型。出站 RPM 超出后排队等待，0 = 不限。单次超时、退避上限、抖动沿用当前配置。
            </p>          </div>
          <!-- 运行读数：参数的效果面。原先挂在「调用健康」卡里，与参数隔着两张卡的卡头，
               读者要自己把「我把重试调高了」和「还在挨 429」对上。 -->
          <aside class="ac-policy__side" aria-label="近 1 小时调用读数">
            <div class="ac-policy__side-title">{{ readoutWindowText }}</div>
            <div v-if="rateLimitReadout" class="ac-policy__stats">
              <div class="ac-stat" :class="{ 'ac-stat--alert': rateLimitReadout.count429 > 0 }">
                <b>{{ rateLimitReadout.count429 }}</b>
                <span>上游 429</span>
              </div>
              <div class="ac-stat" :class="{ 'ac-stat--alert': rateLimitReadout.coolingDown > 0 }">
                <b>{{ rateLimitReadout.coolingDown }}</b>
                <span>冷却中模型</span>
              </div>
            </div>
            <div v-else-if="rateLimitFailed" class="ac-policy__readout-fail" role="alert">
              读数读取失败
              <button type="button" class="mk-link" :disabled="rateLimitLoading" @click="loadRateLimitReadout">{{ rateLimitLoading ? '读取中…' : '重试' }}</button>
            </div>
            <div v-else class="ac-policy__readout-fail">读数读取中…</div>
            <button type="button" class="mk-link ac-policy__link" @click="goHealthCenter">健康中心 →</button>
          </aside>
        </div>
      </section>

      <!-- 后台跑批（2026-10-28 从运维工具迁入）：这页看的是「上游系统跑得怎么样」——
           供应商连通性与后台批处理是否空转同属一类可见性需求。
           口径与 scripts/audit-batch-throughput 同一纯函数（窗口内全部尝试，含失败）。 -->
      <section v-if="isLive" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">后台跑批</h3>
          <span class="mk-card__meta">最近 {{ throughput?.windowMinutes ?? 60 }} 分钟 · 下限 {{ throughput?.minRpm ?? 20 }} 条/分<template v-if="throughput?.idle"> · 空闲</template></span>
          <div class="mk-card__head-right">
            <button type="button" class="mk-btn mk-btn--sm" :disabled="throughputLoading" @click="loadThroughput">{{ throughputLoading ? '读取中…' : '刷新' }}</button>
          </div>
        </div>
        <p class="ac-throughput__note">后台批处理每分钟实际处理多少条。低于下限的分钟越多，越可能已经停摆。</p>
        <div v-if="throughputFailed" class="mk-alert mk-alert--row ac-throughput__error" role="alert">
          <span class="mk-alert__msg">吞吐读取失败</span>
          <button type="button" class="mk-alert__btn" :disabled="throughputLoading" @click="loadThroughput">重试</button>
        </div>
        <div v-else class="ac-throughput__stats">
          <div class="ac-stat"><b>{{ throughput?.avgRpm ?? '—' }}</b><span>平均 条/分</span></div>
          <div class="ac-stat"><b>{{ throughput?.worstRpm ?? '—' }}</b><span>最低单分钟</span></div>
          <div class="ac-stat"><b>{{ throughput?.lowMinutes ?? '—' }}</b><span>低于下限分钟</span></div>
          <div class="ac-stat" :class="{ 'ac-stat--alert': throughput?.alert }"><b>{{ throughput?.longestLowRun ?? '—' }}</b><span>最长连续低于下限</span></div>
        </div>
        <p v-if="throughput?.alert" class="ac-throughput__alert" role="alert">⚠ {{ throughput.alertReason }}</p>
      </section>

    </div>
    <!-- 底部保存条（脏位跨分段不丢）：多组脏恒出；单组脏仅当该组的分段保存钮不在当前
         可见区域时出——否则同屏两颗保存钮。 -->
    <div v-if="showSaveBar" class="ac-save">
      <span class="ac-save__dot"></span>
      <span>{{ dirtyGroups.join(' + ') }} · {{ dirty.size }} 组未保存变更</span>
      <button type="button" class="mk-link" :disabled="saving" @click="discardAll">放弃</button>
      <button type="button" class="ac-save__primary" :disabled="saving" @click="saveAll">
        {{ saving ? '保存中…' : '保存变更' }}
      </button>
    </div>
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
import { modelKindOf } from './platformModelKind'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  liveRunModelTest,
  timeAgo,
  errMsg,
  liveFailures,
  loadLiveData
} from './live'
import { adminPlatformSettingsApi, adminApiConfigApi, adminOpsApi, type ThroughputReportLike } from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSelect from '@/components/mk/MkSelect.vue'
import { toast } from '@/utils/toast'

/* ---------- 宿主：单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，
   这个页面我觉得可以和前面的合并了」）----------
   一级页签「接入 / 调用」撤除，本页自上而下两段：供应商面板 / 调用策略。
   平台那条供应商的详情里再分二级页签：模型 / 连接 / 基础设施 / 生成参数。
   已迁出：虚拟学习者容量 → /admin/virtual-learners；安全与访问 → /admin/access-control；
   外挂能力 → /admin/addons（2026-10-19）。旧深链一律由 TAB_ALIAS / 路由改投。 */

/** 旧页签键别名归一：站内「配置 →」与量测脚本曾用 ?tab=model / ?tab=registry / ?tab=model-routing。
    2026-10-26 起本页没有一级页签，所有旧键（含 connection / overview / runtime /
    model-routing / virtual-learners）都只是「打开这一页」，归一后清掉 tab 参数，
    书签不 404，也不会在 URL 上留下一个不存在的页签。 */
const LEGACY_TAB_KEYS = new Set([
  'model', 'registry', 'connection', 'overview', 'runtime', 'model-routing', 'virtual-learners',
])
/** 已迁出的旧页签 → 独立页（旧书签直接落到新家，不在本页停一下再让人自己找） */
const MOVED_TABS: Record<string, string> = {
  security: '/admin/access-control',
  virtual: '/admin/virtual-learners',
}
const route = useRoute()
const router = useRouter()
/** 供应商面板（BYOK）：页头「刷新注册表」与写后重取都走它的 refresh */
const providersRef = ref<{ refresh?: (force?: boolean) => void; openHostPull?: () => void } | null>(null)
/** 已登记模型 id（面板回传）：上游清单的关系句与折叠共用这一次计算 */
const registeredModelIds = ref<string[]>([])
/** 供应商面板首次回传即视为注册表已就绪：页头拉取钮此前按 apiUrl 判禁用，首屏地址未回填时点不动 */
const providersLoaded = ref(false)
function onProvidersRegistered(ids: string[]) {
  registeredModelIds.value = ids
  providersLoaded.value = true
}
/** 注册表已就绪：面板首次回传，或 live 配置已到（首屏未回填地址时按钮不该点不动） */
const providersReady = computed(() => providersLoaded.value || !!cfg.value)
function onFetchClick() {
  if (!providersReady.value || !form.apiUrl) {
    focusPlatformConnection()
    return
  }
  void fetchModels()
}
/* 平台连接表单已内联进供应商详情（2026-10-25 撤掉「平台设置」浮窗）：
   页头拉取钮在地址未就绪时把视线带到这段表单。 */
const platformConnRef = ref<HTMLElement | null>(null)
function focusPlatformConnection() {
  platformConnRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
}
/** 读数异常时的出口：本页只报读数，处理在健康中心 */
function goHealthCenter() {
  void router.push('/admin/health-center')
}
/* D12（2026-10-22 拍板 B）：近 1 小时 429 / 冷却模型读数。
   数据来自只读的 model-registry 总览（429 计数取 agent_call_logs，冷却取部署健康快照）。
   2026-10-26 单页后不再有「切到调用页才加载」的时机，随页面进入直接读。 */
const rateLimitReadout = ref<{ windowMinutes: number; count429: number; coolingDown: number } | null>(null)
const rateLimitFailed = ref(false)
const rateLimitLoading = ref(false)
async function loadRateLimitReadout() {
  rateLimitLoading.value = true
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    rateLimitReadout.value = (res as { data?: { data?: { rateLimit?: typeof rateLimitReadout.value } } })?.data?.data?.rateLimit ?? null
    rateLimitFailed.value = !rateLimitReadout.value
  } catch {
    rateLimitReadout.value = null
    rateLimitFailed.value = true
  } finally {
    rateLimitLoading.value = false
  }
}
/* 后台跑批吞吐（2026-10-28 从运维工具迁入）：与调用策略同属「上游跑得怎么样」的读数。
   窗口 60 分钟 / 下限 20 条/分，与 CLI 默认一致；失败时显式报错，不把 0 当成停摆。 */
const throughput = ref<ThroughputReportLike | null>(null)
const throughputLoading = ref(false)
const throughputFailed = ref(false)
async function loadThroughput() {
  throughputLoading.value = true
  throughputFailed.value = false
  try {
    const res = await adminOpsApi.throughput({ window: 60, minRpm: 20 })
    throughput.value = res.data?.data ?? null
  } catch {
    throughputFailed.value = true
  } finally {
    throughputLoading.value = false
  }
}

watch(isLive, (live) => {
  if (live) {
    void loadRateLimitReadout()
    void loadThroughput()
  }
}, { immediate: true })
/** 读数窗口按后端给的值写，不硬编码「近 1 小时」——窗口若改，标题跟着改 */
const readoutWindowText = computed(() => {
  const m = rateLimitReadout.value?.windowMinutes
  if (!m || m < 60) return m ? `近 ${m} 分钟` : '近期调用'
  const h = Math.round((m / 60) * 10) / 10
  return `近 ${h} 小时`
})

/** 注册表读数（只读总览回传）：上游清单与「已添加」的对照只用 models 这一段。
    与生成参数页签的别名映射是同一份接口，不重复请求。 */
interface RegistryDefaults {
  models: Array<{ id: string; providerId: string; fallbacks: string[] }>
  /** 运行时实际默认与来源（2026-10-24）：平台没配时可能来自 env 兜底，界面必须能说清 */
  runtimeDefaults?: {
    model: string | null
    source: 'ui' | 'env' | 'none'
    reasoningModel: string | null
    reasoningSource: 'ui' | 'env' | 'none'
  }
}
const registryDefaults = ref<RegistryDefaults | null>(null)
/** 运行时默认模型（只读）：平台配了 → 界面配置；平台没配、运行时落 env → 环境变量 */
const runtimeDefaultInfo = computed(() => {
  const r = registryDefaults.value?.runtimeDefaults
  if (!r) return null
  const source = r.source === 'ui' ? '界面配置' : r.source === 'env' ? '环境变量' : '未配置'
  return { model: r.model, source }
})
/** 别名映射切片：供应商面板改完注册表后在同一页签内就地重取，避免读旧表 */
const registryRef = ref<{ refresh?: (force?: boolean) => Promise<void> | void } | null>(null)
watch(
  () => route?.query?.tab,
  (t) => {
    const raw = typeof t === 'string' ? t : ''
    // 已迁出的页签：直接送到新家（旧书签/旧文档链接不失效）
    const moved = MOVED_TABS[raw]
    if (moved) {
      const rest = { ...(route.query as Record<string, string>) }
      delete rest.tab
      void router.replace({ path: moved, query: rest })
      return
    }
    /* 本页已无一级页签（2026-10-26）：旧键（access / routing / model / runtime…）一律清掉，
       只保留「打开这一页」的语义。不认识的键同样清掉，避免 URL 上留一个不存在的页签。 */
    if (raw && (LEGACY_TAB_KEYS.has(raw) || raw === 'access' || raw === 'routing')) {
      const rest = { ...(route.query as Record<string, string>) }
      delete rest.tab
      void router.replace({ query: rest })
    }
  },
  { immediate: true }
)
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
/* 2026-10-27 原生 select → MkSelect：选项文案与原 <option> 逐字一致；
   `as const` 让值保持联合类型，v-model 不改写 form 的字段类型。 */
const THINKING_MODE_OPTIONS = [
  { value: 'default', label: '跟随模型默认' },
  { value: 'enabled', label: '强制开启' },
  { value: 'disabled', label: '关闭' }
] as const
const EFFORT_OPTIONS = [
  { value: 'default', label: '跟随模型默认' },
  { value: 'low', label: '低（low）' },
  { value: 'high', label: '高（high）' },
  { value: 'max', label: '最高（max）' }
] as const
const RESPONSE_FORMAT_OPTIONS = [
  { value: 'none', label: '关闭（默认行为）' },
  { value: 'json_object', label: 'JSON 对象' }
] as const

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

/** 脏位分域标注：保存条列出具体未保存组（连接 / 生成参数 / 调用策略 / 探测） */
const DIRTY_GROUP_LABELS: Record<string, string> = {
  conn: '连接',
  route: '生成参数',
  reliability: '调用策略'
}
const dirtyGroups = computed(() => [...dirty.value].map((g) => DIRTY_GROUP_LABELS[g] || g))
/** 平台详情当前二级页签（面板回传）：'' = 当前选的不是平台 */
const platformTabKey = ref('')
/** 脏组的分段保存钮此刻是否在屏上：在屏则由它承担保存，不出底部条（避免同屏两颗保存钮）。
    单页后「连接 / 生成参数」藏在平台详情的二级页签里——只有停在该页签时它的保存钮才可见，
    切走后必须由底部条接手，否则单组脏没有任何保存入口。 */
const DIRTY_GROUP_TAB: Record<string, string> = {
  conn: 'conn',
  route: 'generation',
  reliability: 'page',
}
const showSaveBar = computed(() => {
  if (dirty.value.size > 1) return true
  if (dirty.value.size !== 1) return false
  const [group] = [...dirty.value]
  const home = DIRTY_GROUP_TAB[group]
  if (home === 'page') return false
  return platformTabKey.value !== home
})

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

/** 配置域重试：可靠性设置是这张卡唯一的配置源 */
function retryConfigLoad() {
  void loadReliability()
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

/** 上游清单与登记表的读数（空串 = 无清单可谈，模板走空态分支）：只报数字，不写解释句。
    2026-10-24「平台模型分几种」：上游清单是多模态混排，先报其中的对话候选数——
    向量 / 重排 / 生图 / 决策不登记进 LLM 目录。 */
const upstreamSummary = computed(() => {
  const total = models.value.length
  if (!total) return ''
  const chat = models.value.filter((id) => modelKindOf(id) === 'chat').length
  if (!upstreamReady.value) return `已拉取 ${total} 个 · 对话候选 ${chat} 个`
  const matched = upstreamSplit.value.registered.length
  return `已拉取 ${total} 个 · 对话候选 ${chat} 个 · ${matched} 个已添加`
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
/** 测试模型下拉的选项（2026-10-27 原生 select → MkSelect）：清单为空时保留原占位项。
    原 `<option :title="modelTestHint(m)">` 的逐项提示在 MkSelect 里不可表达——可见 label
    已写明「chat 测试不适用」，故不再单独保留 modelTestHint。 */
const testModelOptions = computed(() =>
  models.value.length
    ? models.value.map((m) => ({ value: m, label: modelTestLabel(m) }))
    : [{ value: '', label: '无可用模型（等待拉取）' }]
)
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
    // 拉到的清单直接进入勾选浮窗（2026-10-24 用户「拉取作为浮窗」）：先等 upstream 传进面板
    if (list.length) {
      await nextTick()
      providersRef.value?.openHostPull?.()
    }
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
    if (set.has('reliability') && reliability.value) {
      // 空值容错:v-model.number 清空后是字符串,后端要求全整数字段(400 且不定位)。
      // 保存前回退到最近一次加载值,并写回输入框,所见即所存
      const intOr = (v: unknown, fb: unknown): number => {
        if (typeof v === 'number' && Number.isInteger(v)) return v
        const f = Number(fb)
        return Number.isInteger(f) ? f : 0
      }
      const base = reliabilityBase.value ?? {}
      /* 2026-10-26 界面只露「最大重试」（= maxUpstreamAttempts，含降级跳转的总尝试上限）。
         同模型重试数、超时、退避上限、抖动这几项不再上屏，但必须原样回传库里的现值：
         后端 PUT 是 partial 合并，少传一项就等于把它重置成默认值。
         刻意不把「最大重试」联动到同模型重试数——执行器只在「上游尝试还有余量」时才会
         跳到备用模型，把同模型重试顶到 上游-1 会让降级永远不触发（本卡上面那条告警就是它）。 */
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

/* 重置接入配置：后端 POST /admin/api-config/reset 只删 platform_api_configs 一行
   （服务地址 / 密钥 / 模型清单 / 生成参数默认值），不动调用策略与访问策略。高风险不可撤销，走二次确认。 */
const resetting = ref(false)
async function resetConfig() {
  if (resetting.value) return
  const ok = await askConfirm({
    title: '重置接入配置',
    message: '将删除已保存的服务地址、API Key、模型清单与生成参数默认值。此操作不可撤销。',
    confirmText: '确认重置'
  })
  if (!ok) return
  resetting.value = true
  try {
    await adminApiConfigApi.resetConfig()
    await loadLiveData(true)
    await loadReliability()
    dirty.value = new Set()
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
  toast.info('已放弃未保存的变更')
}
</script>

<style scoped>
/* ================= 宿主布局（单页：内容内滚，嵌入子页占满剩余高度） ================= */
/* 内容在宿主 flex 列内独立滚动（页头固定；底部保存条 sticky 于滚动容器） */
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

/* 接入页 = 供应商面板一张卡（连接与基础设施在平台详情页签里），按内容高度自上而下，页签体统一内滚。
   2026-10-25 用户「这个组整个页面我觉得做的不好」：此前供应商卡被设成 flex:1 吃掉整屏剩余高度，
   而它只有 2 个供应商 / 3 个模型，卡内下方 600px 全是空白——满高工作台适合长表，
   不适合这张会随注册表变短的清单。改为按内容占高：内容多就长、内容少就短，不留假空白。 */
.ac-conn-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  overflow-x: hidden;
}
.ac-conn-body > .mpp { flex: none; }
/* 供应商面板给一个内容下限，避免模型只有一两行时详情区塌成一条 */
.ac-conn-body > .mpp { min-height: 360px; }
/* 「调用」页默认生成参数卡内的注册表切片（别名映射）：外层是 details，
   这里让分区直接成为 details 的子项，不出现内外双滚动容器。 */
.ac-registry--aliases { display: contents; }
/* 置顶告警（接入域读取失败）横跨全部列，不占卡位把卡片挤换行 */
.ac-conn-body > .mk-alert { grid-column: 1 / -1; }
/* 平台通道那条详情的连接块（2026-10-18 从独立「连接」卡搬进供应商详情）：外层卡头没了，
   状态徽标与「保存连接」收进一条细条，右侧一句说明这段表单管什么。 */
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
/* 上游对齐条（2026-10-20 从连接块搬进模型清单块）：嵌在模型标题行里只占一行读数，
   与「模型 N 个」并排（2026-10-24 走查：不再在表头之上单起一行） */
.ac-models-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
.ac-models-meta__title { color: var(--mk-muted); }
/* 持久化说明（F8-2）：拉取仅本页有效的提示，比清单胶囊再轻一档；仅未保存时出现 */

/* 默认思考：模式 + 强度，同一行两列字段（2026-10-14 删冗余「启用思考」开关后由三列改两列） */

/* 访问来源模式：radio 单选卡片（复刻原型 index.html:1793-1798 .radio-row/.radio，
   原型 .radio[aria-checked="true"] = brand 描边 + brand 底 + brand 字 + 600 字重）。
   描边/圆角/选中态全走 --mk-* token，暗色随 token 自动适配 */
/* 分段小标题（连接 / 路由默认 / 默认思考 / 连通性验证 / 默认思考与结构化输出）：
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
.ac-fold__mark { margin-left: auto; color: var(--mk-faint); flex: none; }
.ac-fold__mark::before { content: '▸'; }
.ac-fold[open] .ac-fold__mark::before { content: '▾'; }
.ac-fold[open] .ac-fold__bar { border-radius: var(--mk-radius-xl) var(--mk-radius-xl) 0 0; border-bottom-color: transparent; }
/* 平台详情「生成参数」页签：外层块头已由面板给，这里只排字段与折叠表 */
.ac-gen-body { display: grid; gap: 14px; }
/* 块头里的默认模型（只读披露）：与标题同一行，省掉一整条底衬横条 */
.ac-gen-default__inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.ac-gen-default__sep { color: var(--mk-faint); }
/* 生成参数页签的两列（左=默认思考，右=结构化输出）：两列各自立栅、同节奏；
   分隔线沿用卡内原 dashed 方言（与调用策略右栏同一种分隔）。 */
.ac-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.ac-cols__main, .ac-cols__side { display: grid; gap: 12px; align-content: start; min-width: 0; padding: 0; }
.ac-cols__side { border-left: 1px dashed var(--mk-line); padding-left: 18px; }
.ac-fallback-alert { margin: 0; }

/* ===== 调用策略（2026-10-26：三字段 + 读数）=====
   用户「不用写那么详细，分那么多，就最大重试、间隔、rpm 就够了」：三个字段一行排开，
   每个是「标签在上、输入框 + 单位在下」——与全站表单同一种形状，不再有分组标题与
   九宫格。读数从原「调用健康」卡搬进来当右栏：参数与它造成的结果在同一视平线。 */
.ac-policy {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 28px;
  align-items: start;
  padding-top: 14px;
}
.ac-policy__form { display: grid; gap: 12px; min-width: 0; }
/* 三个字段等分左栏（标签均匀铺开），控件本身封顶 220px——数字只有一两位，
   输入框不必跟着拉成整列宽，但三列仍各占一等分，不会挤在左边留半屏空白 */
.ac-policy__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}
.ac-policy__control { display: flex; align-items: center; gap: 8px; max-width: 220px; }
.ac-policy__control .mk-field__input {
  width: 100%;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.ac-policy__unit {
  font-style: normal;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  flex: none;
}
/* 字段注解：一行小字说清「重试次数含降级」「0 = 不限」，并交代没露出的细项沿用现值 */
.ac-policy__note {
  margin: 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.7;
  color: var(--mk-faint);
}

/* 右栏：近 1 小时读数（429 / 冷却模型）。读者的问题只有一个「现在挨不挨限流」 */
.ac-policy__side {
  display: grid;
  gap: 10px;
  align-content: start;
  padding-left: 24px;
  border-left: 1px dashed var(--mk-line);
}
.ac-policy__side-title {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--mk-faint);
}
.ac-policy__stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ac-stat {
  display: grid;
  gap: 2px;
  padding: 10px 12px 11px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
}
.ac-stat b { font-size: 22px; line-height: 1.15; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.ac-stat span { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ac-stat--alert { border-color: color-mix(in srgb, var(--mk-amber) 46%, var(--mk-line)); background: var(--mk-amber-bg); }
.ac-stat--alert b { color: var(--mk-amber); }
.ac-policy__readout-fail {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-red);
  font-weight: 600;
}
.ac-policy__link { justify-self: start; font-size: var(--mk-fs-micro); }
/* 后台跑批（2026-10-28 从运维工具迁入）：四格读数与调用策略右栏同一 .ac-stat 形态 */
.ac-throughput__note { margin: 0; padding: 0 16px 10px; font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); }
.ac-throughput__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; padding: 0 16px 14px; }
.ac-throughput__error { margin: 0 16px 12px; }
.ac-throughput__alert { margin: 0; padding: 0 16px 14px; font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-amber); }
@media (max-width: 900px) { .ac-throughput__stats { grid-template-columns: 1fr 1fr; } }

/* 内容区不足 1500px 时右栏落到参数下面，改成一条横读数带（不再挤窄参数三列） */
@media (max-width: 1500px) {
  .ac-policy { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .ac-policy__side {
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 14px 0 0;
    border-left: 0;
    border-top: 1px dashed var(--mk-line);
  }
  .ac-policy__stats { grid-template-columns: repeat(2, minmax(0, 168px)); }
  .ac-stat { display: flex; align-items: baseline; gap: 8px; padding: 6px 10px; }
  .ac-stat b { font-size: 18px; }
  .ac-policy__link { justify-self: end; }
}
@media (max-width: 1100px) {
  .ac-policy__fields { grid-template-columns: repeat(2, minmax(0, 200px)); }
}
@media (max-width: 800px) {
  .ac-policy__fields { grid-template-columns: minmax(0, 1fr); }
  .ac-policy__side { grid-template-columns: auto 1fr; }
  .ac-policy__link { justify-self: start; }
}
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
  .ac-conn-body, .ac-cols { grid-template-columns: 1fr; }
  .ac-cols__side { border-left: none; padding-left: 0; margin-top: 6px; }
}
@media (max-width: 800px) {
  /* 三列栅格在窄屏回落单列：此前漏掉这条，390 下「服务地址 | API Key」
     仍强行并排，服务地址输入框被 180px 下限撑破、压掉 API Key（审计 P1 2.2） */
  .ac-row--2 { grid-template-columns: 1fr; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .ac-body { gap: 16px; padding: 6px 18px 18px; }
  .mk-field__label { font-size: var(--mk-fs-micro); }

  .mk-seg { border-radius: 12px; }
  .mk-seg__item { font-size: var(--mk-fs-micro); padding: 8px 14px; }
  .ac-textarea { font-size: var(--mk-fs-micro); }
  .ac-sec__title { font-size: var(--mk-fs-micro); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-policy__fields { grid-template-columns: repeat(3, minmax(0, 220px)); gap: 22px; }
  .ac-save { padding: 11px 14px 11px 18px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .ac-body { gap: 18px; padding: 8px 22px 22px; }
  .mk-field__label { font-size: var(--mk-fs-micro); }

  .mk-seg__item { font-size: var(--mk-fs-micro); padding: 9px 16px; }
  .ac-textarea { font-size: var(--mk-fs-micro); }
  .ac-sec__title { font-size: var(--mk-fs-micro); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-policy__fields { grid-template-columns: repeat(3, minmax(0, 250px)); gap: 24px; }
  .ac-save { padding: 13px 16px 13px 20px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .ac-body { gap: 20px; padding: 10px 26px 26px; }
  .mk-field__label { font-size: var(--mk-fs-body); }

  .mk-seg__item { font-size: var(--mk-fs-body); padding: 11px 19px; }
  .ac-textarea { font-size: var(--mk-fs-body); }
  .ac-sec__title { font-size: var(--mk-fs-body); }
  .ac-cols__main { padding: 0; }
  .ac-cols__side { padding: 0; }
  .ac-policy__fields { grid-template-columns: repeat(3, minmax(0, 290px)); gap: 28px; }
  .ac-save { padding: 15px 18px 15px 24px; }
}

/* ================= 平台设置浮窗（2026-10-24）：连接 / 基础设施 / 平台默认 ================= */

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
