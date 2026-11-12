<template>
  <div :class="embedded ? 'ac-host ac-host--embedded' : 'mk-page mk-page--fill ac-host'">
    <!-- 2026-11-03 用户拍板：本页**不做限宽，通栏**（推翻了当天上午按 SPEC §10 加的 .mk-narrow）。
         理由是同页五个页签宽度必须一致——「会话安全」是表格、「数据导出」是三列勾选，
         两者只能通栏；只有本页与「访问与注册」被收到 1200，来回切页签卡片会一宽一窄地跳。 -->
    <!-- 嵌入「系统设置」时页头归宿主，本组件不再自带页头与主操作——与访问与注册嵌入态同一写法。
         2026-11-03：页面级「刷新注册表」按钮从两个页头一并撤除（用户「最右上角那个多余的
         按钮…移入运维工具或合并处理，保持顶部干净」）——它重读的是本机登记文件，与卡片同源，
         现收进卡片右上的图标钮，悬停说明「不向上游拉取」。 -->
    <MkPageHead v-if="!embedded" title="模型与接入" />
    <!-- 页首 KPI 带已撤（2026-10-14 用户拍板「模型与接入的 kpi 也不要了」）：原两处带
         都是把下方卡里已有的读数抄一遍——密钥在连接页签（API Key 行的「留空 = 沿用已配置」
         + 连接徽标）、模型清单在模型页签、默认模型在生成参数页签。
         撤带后这些事实各有唯一出口，页首只留页名与主操作。 -->

    <!-- 单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，这个页面我觉得
         可以和前面的合并了」）：一级页签「接入 / 调用」撤除，本页自上而下两段——
         ① 供应商面板：左列表 / 右详情；平台详情的二级页签 = 模型 / 连接 / 基础设施 / 生成参数
         ② 调用策略（尝试与重试、退避与超时、平台出站速率 + 近 1 小时 429 读数）
         「平台默认生成参数」并进平台详情第四个页签：它就是「这些模型默认怎么生成」，
         与模型表是同一个对象，此前单独一张卡叫「平台默认生成参数」，读起来像另一套设置。
         旧键 ?tab=routing / runtime / model-routing 仍归一到这里（TAB_ALIAS），书签不失效。 -->
    <div class="ac-tab-body ac-conn-body" id="ac-panel-access">
      <!-- 模型与接入是一个数据域：live 配置、对话模型、向量 / 重排任一失败都只出一处页面级
           错误态。子面板通过 error-change 上报，宿主统一接管重试；否则同一次后端失败会同时
           出现「接入通道读取失败」「模型配置读取失败」与「配置读取失败」三套文案。 -->
      <div v-if="panelFailure" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">{{ panelFailureText }}：列表为空不代表未配置</span>
        <button type="button" class="mk-alert__btn" @click="retryAll">重试</button>
      </div>

      <!-- 服务连接（2026-11-07 用户「提回去」）：连接参数回到页面最上方常驻。
           2026-11-05 曾把它整段并进「＋ 添加模型」弹窗（「只保留添加模型」），代价是
           主页面完全看不见「我连的是哪个地址、密钥配没配」——而这恰恰是进本页的第一件事。
           2026-11-09 用户走查（图 1/2）：折叠态那行长 URL + 重试参数、以及点「修改连接」
           在页面里原地展开的大表单，都把下面的模型清单顶得很重。
           现在收起态只留一句摘要（通道 · 主机 · 密钥状态），编辑一律进「配置服务连接」弹窗；
           没配地址（首次部署 / 启动脚本没给 AI_API_URL）时弹窗自动打开，
           「填地址 → 保存并获取模型」这条一步到位的流程不变。 -->
      <section class="mk-card ac-conn">
        <div class="mk-card__head ac-conn__head">
          <div class="ac-conn__id">
            <h3 class="mk-card__title">服务连接</h3>
            <!-- 就绪 = 地址 + 密钥都齐（2026-11-11）：原判据只看 keySet，地址清空后
                 卡头仍报「已就绪」，与下方向导弹窗的「待配置」互相矛盾。 -->
            <span v-if="configUnknown" class="mk-badge mk-badge--warn" title="配置读取失败，当前不是确定态">读取失败</span>
            <span v-else-if="connReady" class="mk-badge mk-badge--ok" title="地址与密钥齐全，可以测试连接">已就绪</span>
            <span v-else class="mk-badge mk-badge--warn" :title="connMissingText">待配置</span>
          </div>
          <div class="mk-card__head-right ac-conn-summary">
            <span class="ac-conn-summary__chan">默认全局通道</span>
            <span class="ac-conn-summary__dot" aria-hidden="true">·</span>
            <!-- 只给主机：完整地址（含路径 / 查询）进 title 与弹窗，收起态不再拖一条长 URL
                 （2026-11-09 用户「隐藏具体 URL 和参数细节」） -->
            <span class="mono ac-conn-summary__addr" :title="configUnknown ? '配置读取失败，地址未知' : (form.apiUrl || '未配置服务地址')">{{ configUnknown ? '配置读取失败' : summaryHost }}</span>
            <span class="ac-conn-summary__dot" aria-hidden="true">·</span>
            <span class="ac-conn-summary__key">{{ configUnknown ? '密钥状态未知' : (keySet ? '密钥已配置' : '未配置密钥') }}</span>
            <button type="button" class="mk-btn mk-btn--sm" :disabled="testing || configUnknown || !form.apiUrl.trim()" @click="testConn">{{ testing ? '测试中…' : '测试连接' }}</button>
            <!-- 2026-11-09 设计语言收敛：打开配置弹窗这类「开关」一律 mk-link
                 （会改服务状态的命令才走 mk-btn--sm：测试连接 / 保存），
                 与向量 / 重排卡头里的「连接配置」同一形态。 -->
            <button type="button" class="mk-link" @click="openConnDialog">连接配置</button>
          </div>
        </div>
      </section>

      <!-- 配置服务连接（2026-11-09）：原先是页面内原地展开的表单（把模型清单整片顶下去），
           现在是一枚小号弹窗——主界面只管模型，连接细节在弹窗里改。 -->
      <Teleport to="body">
        <div v-if="connOpen" ref="connMaskRef" class="mk-modal">
          <div ref="connPanelRef" class="mk-modal__panel ac-conn-dlg" role="dialog" aria-modal="true" aria-label="配置服务连接">
            <div class="mk-modal__head">
              <h3 class="mk-modal__title">配置服务连接</h3>
              <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeConnDialog">✕</button>
            </div>
            <div class="mk-modal__body">
              <div class="ac-conn-pair">
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

              <template v-if="isLive && reliability">
                <div class="ac-conn-policy">
                  <label class="mk-field">
                    <span class="mk-field__label">最大重试</span>
                    <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" :max="limMax('maxUpstreamAttempts', 10)" class="mk-field__input" @input="markDirty('reliability')" />
                    <span class="mk-field__hint">含首次调用，单位为次</span>
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">重试间隔（毫秒）</span>
                    <input v-model.number="reliability.retryBaseDelayMs" type="number" :min="limMin('minRetryBaseDelayMs', 100)" :max="limMax('maxRetryBaseDelayMs', 60000)" step="100" class="mk-field__input" @input="markDirty('reliability')" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">RPM 上限</span>
                    <input v-model.number="reliability.platformRpmLimit" type="number" min="0" max="100000" step="10" class="mk-field__input" @input="markDirty('reliability')" />
                    <span class="mk-field__hint">0 表示不限</span>
                  </label>
                </div>
              </template>

              <div v-if="configLoadFailed && !reliability" class="mk-alert mk-alert--row" role="alert">
                <span class="mk-alert__msg">调用策略读取失败</span>
                <button type="button" class="mk-alert__btn" @click="retryConfigLoad">重试</button>
              </div>
            </div>

            <!-- 危险动作贴左端、与主按钮隔开（准则 2：删/重置不留在一排正向动作里） -->
            <div class="mk-modal__foot ac-conn__foot">
              <button
                type="button"
                class="mk-btn mk-btn--danger-ghost ac-conn__danger"
                :disabled="resetting"
                title="只清本条通道的地址、密钥与模型清单"
                @click="resetConfig"
              >{{ resetting ? '重置中…' : '重置此通道' }}</button>
              <button type="button" class="mk-btn" @click="closeConnDialog">取消</button>
              <button
                type="button"
                class="mk-btn mk-btn--primary ac-conn__save"
                :disabled="saving || fetching || !form.apiUrl.trim() || (!connDirty && !needsSetup)"
                :title="connDirty || needsSetup ? '保存地址与密钥（会同时落盘重试策略）' : '没有未保存的改动'"
                @click="saveConn"
              >{{ saving || fetching ? '保存中…' : (needsSetup ? '保存并获取模型' : '保存连接配置') }}</button>
            </div>
          </div>
        </div>
      </Teleport>

      <ModelProvidersPanel
        ref="providersRef"
        :upstream="models"
        :upstream-types="fetchedModelTypes"
        :default-model="defaultModel"
        :pull-loading="fetching"
        :pull-error="fetchError"
        :pull-stale="pullStale"
        :suppress-error="panelFailure"
        @error-change="providersFailed = $event"
        @registered="onProvidersRegistered"
        @default-candidates="onDefaultCandidates"
        @fetch-upstream="onFetchClick"
        @set-default="onSetDefault"
        @remove-model="onModelRemoved"
      >
        <!-- 连接状态与「修改连接」都已上移页顶的服务连接卡（2026-11-07）：本卡不重复
             呈现通道事实，卡头只留「＋ 添加模型」。 -->
        <template #head-status />

        <!-- 上游清单的落盘状态：此前只有一枚「未保存」贴在第 1 行上方，被读成
             「第 1 行有未保存改动 / 设为默认没生效」。这里把主语写全（本次拉取的清单），
             并给出唯一的解法按钮——不用再去弹窗里找「重新获取」。 -->
        <template #models-meta>
          <p v-if="(fetchError && !models.length) || hasUnsavedModels" class="ac-models-meta ac-models__line">
            <span v-if="fetchError && !models.length" :title="`错误原文：${fetchError}`">获取失败，请检查服务地址与密钥</span>
            <template v-if="hasUnsavedModels">
              <span class="mk-badge mk-badge--warn">清单未保存</span>
              <span class="ac-models__save-hint">本次拉到的 {{ models.length }} 个模型还没落盘</span>
              <button type="button" class="mk-link" :disabled="saving" @click="saveModelList">保存清单</button>
            </template>
          </p>
        </template>
      </ModelProvidersPanel>

      <!-- 2026-10-28 用户「按能力角色拆成三个独立卡片」：向量 / 重排不再嵌在对话卡里，
           各自一张卡、各自一套连接（默认复用主通道，也可独立端点）。 -->
      <InfraModelsPanel
        ref="infraRef"
        :suppress-error="panelFailure"
        @error-change="infraFailed = $event"
      />

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
/* Eye 与 EyeOff 成对使用（密钥显隐两态）：此前只导入了 EyeOff，
   点「显示密钥」后切到 <Eye> 是空白图标（f66cd78d 漏了孪生图标，2026-09-29 补） */
import { Eye, EyeOff } from 'lucide-vue-next'
import { onBeforeRouteLeave } from 'vue-router'
import { dataSource, isLive } from './store'
import ModelProvidersPanel from './ModelProvidersPanel.vue'
import InfraModelsPanel from './InfraModelsPanel.vue'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  liveSetDefaultModel,
  errMsg,
  liveFailures,
  loadLiveData
} from './live'
import { adminPlatformSettingsApi, adminApiConfigApi } from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { toast } from '@/utils/toast'

/* ---------- 宿主：单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，
   这个页面我觉得可以和前面的合并了」）----------
   一级页签「接入 / 调用」撤除，本页自上而下两段：供应商面板 / 调用策略。
   平台那条供应商的详情里再分二级页签：模型 / 连接 / 基础设施 / 生成参数。
   已迁出：虚拟学习者容量 → /admin/virtual-learners；外挂能力 → /admin/addons（2026-10-19）。
   2026-11-01 起本页是「系统设置」宿主里的第一个页签（模型与接入），
   旧键（含 ?tab=model / virtual / security / access 等）的改投**全部在路由层**
   （router/index.ts 的 /admin/api-config 别名），本组件不再自己读写 ?tab=：
   组件里那份归一化 watch 会删掉宿主当前合法的页签（它把 access 当旧键清掉、
   把 security / virtual 整页弹走），合并后必须让位给路由。 */

defineOptions({ name: 'ApiConfigPage' })

/* 嵌入「系统设置」时不渲染自己的页头（页头与「刷新注册表」归宿主） */
const props = withDefaults(defineProps<{ embedded?: boolean; active?: boolean }>(), { embedded: false, active: true })
void props

/** 供应商面板（BYOK）：页头「刷新注册表」与写后重取都走它的 refresh */
const providersRef = ref<{ refresh?: (force?: boolean) => void; openHostPull?: () => void } | null>(null)
/** 向量 / 重排面板：页面级重试时一并重拉 */
const infraRef = ref<{ load?: () => void } | null>(null)

/* ---------- 平台默认模型（P0 2026-11-04） ----------
   为什么这里要有：默认模型只认 DB `platform_api_configs.defaultModel`，文件里的 `defaults`
   只是展示（MODEL_GATEWAY_DESIGN.md §0 补记）。2026-10-28 把「平台默认与别名」整块撤出后，
   纯 UI 部署（不写 env AI_MODEL）走完「填地址 → 拉清单 → 挂模型」也没有落点，
   运行时 `router.resolveModel` 直接抛 `AI model is not configured`——流程缺的正是这一步。 */
const defaultModel = computed(() => cfg.value?.defaultModel ?? '')
/** 已挂载的模型 id（面板回传）：默认只能在这些里选，删模型时也用它挑替补 */
const mountedModelIds = ref<string[]>([])

/**
 * 首个挂载模型自动成为平台默认（只在默认为空时兜底一次）。
 * 已有默认绝不改写——默认是「没单独配的 Skill 走哪个」的落点，静默换掉它等于换掉一批技能的行为。
 * 失败不抛给用户：这是兜底便利，不是用户动作；他仍可在模型行的 ⋯ 里手动设。
 * 2026-11-11 路径 A：本页只有平台通道，候选就是它挂载的对话模型。
 */
const defaultSeeded = ref(false)
async function seedDefaultModel(): Promise<void> {
  if (defaultSeeded.value || saving.value) return
  // 连接设置还有未保存改动时先不种：写默认会重拉配置回显，把未保存的连接改动冲掉
  if (dirty.value.has('conn')) return
  if (!cfg.value || defaultModel.value || !mountedModelIds.value.length) return
  defaultSeeded.value = true
  try {
    const first = mountedModelIds.value[0]
    await liveSetDefaultModel({ defaultModel: first })
    toast.success(`已把「${first}」设为平台默认模型`)
  } catch {
    defaultSeeded.value = false
  }
}

/** 显式设默认：连接设置还有未保存改动时先挡下——写默认会重新拉配置回显，
    未保存的连接改动会被「丢弃未保存的配置修改?」拦一次，把一次点击变成一次意外提问。 */
async function onSetDefault(modelId: string): Promise<void> {
  if (saving.value) return
  if (dirty.value.has('conn')) {
    toast.error('连接设置还有未保存的改动，先保存再设默认模型')
    return
  }
  try {
    await liveSetDefaultModel({ defaultModel: modelId })
    toast.success(`平台默认已设为 ${modelId}`)
  } catch (e) {
    toast.error(`设置默认模型失败：${errMsg(e)}`)
  }
}

/** 删掉默认模型后改指下一个可用模型：默认不能指向已不存在的 id，否则调用同样失败 */
async function onModelRemoved(modelId: string): Promise<void> {
  if (modelId !== defaultModel.value) return
  const next = mountedModelIds.value.find((id) => id !== modelId) ?? ''
  try {
    await liveSetDefaultModel({ defaultModel: next })
    toast.success(next ? `原默认模型已删除，平台默认改为 ${next}` : '原默认模型已删除，请另设平台默认模型')
  } catch (e) {
    toast.error(`更新默认模型失败：${errMsg(e)}`)
  }
}

function onProvidersRegistered(): void {
  /* 注册表就绪曾经用来解锁「保存并获取模型」按钮（首屏地址未回填时点不动）。
     合并弹窗后这颗按钮在弹窗里、拉取地址取自连接段，不再需要这个就绪位；
     保留处理器只为槽位契约不变（面板变更时仍会回传）。 */
}

/** 默认候选（平台通道挂载的对话模型）：空默认时顺手种一个 */
function onDefaultCandidates(ids: string[]): void {
  mountedModelIds.value = ids
  void seedDefaultModel()
}

/* 2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
   连接不再有自己的入口与弹层，它成了「添加模型」弹窗的第一段。
   因此这里不再有「先开连接设置填地址」的分支——地址空着也直接发拉取，
   拉取前的校验在 fetchModels 里（地址为空 / 换了地址没重填密钥，都先给一句人话）。 */
function onFetchClick(source: 'open' | 'refetch' = 'refetch') {
  void fetchModels(source)
}


/** 连接段有未保存改动：用户主动拉清单会连连接一起落盘，但只改重试 / RPM 时得有个显式保存出口 */
const connDirty = computed(() => dirty.value.has('conn') || dirty.value.has('reliability'))

/**
 * 保存连接（2026-11-07 提回页顶后改名：它不再属于那张弹窗）。
 * 「换了地址却没重填密钥」在这里也要拦：否则旧密钥会被存到新地址上，
 * 之后每次调用都撞一个不属于它的端点。
 *
 * 首次配置（没地址 / 没密钥）走另一条：保存并**立刻拉一份清单**，把用户直接送到勾选弹窗——
 * 这就是「填地址 + Key → 保存并获取模型」那一步，不该让人存完再自己去找入口。
 */
async function saveConn(): Promise<void> {
  if (!form.apiUrl.trim()) {
    toast.error('服务地址不能为空')
    return
  }
  if (keyHintNeeded.value) {
    toast.error('请先重填 API Key 再保存')
    return
  }
  if (needsSetup.value) {
    /* 首次配置：保存并立刻拉清单 → 关掉本弹窗，把位置让给「添加模型」勾选弹窗
       （fetchModels 成功后会 openHostPull，两个 .mk-modal 叠在一起会挡住勾选面板）；
       拉失败时把弹窗还给用户，好让他就地改地址 / 重填密钥。 */
    connOpen.value = false
    await fetchModels('refetch')
    if (props.active && connectionStatus.value === 'failed') connOpen.value = true
    return
  }
  const ok = await saveGroups(['conn', 'reliability'])
  if (ok) connOpen.value = false
}

/**
 * 只保存「本次拉到的模型清单」（2026-11-07）：
 * 主列表上方那枚徽章此前只有一句「未保存」，唯一的解法藏在弹窗的「重新获取」里，
 * 等于把一次点击变成一次寻路。现在徽章旁边直接给这枚动作。
 * saveGroups 只提交处于脏位的域，所以这里先立 conn 脏位——清单的归属规则本就挂在连接上。
 */
async function saveModelList(): Promise<void> {
  if (saving.value || !models.value.length) return
  markDirty('conn')
  const ok = await saveGroups(['conn'], { silent: true })
  if (ok) toast.success(`已保存模型清单（${models.value.length} 个）`)
}

/** 清单是不是过期：拉来的那批属于另一个地址（换了地址但还没重拉），先用旧的选模型会挂错端点 */
const pullStale = computed(
  () => models.value.length > 0 && fetchedModelsEndpoint.value !== form.apiUrl.trim()
)

/** 宿主（系统设置）的页头「刷新注册表」经此转发，不必去摸供应商面板的子 ref */
defineExpose({ refresh: () => retryAll() })

/** 注册表读数（只读总览回传）：上游清单与「已添加」的对照只用 models 这一段。
    与生成参数页签的别名映射是同一份接口，不重复请求。
    2026-11-01：原先这里还有一条 ?tab= 归一化 watch（LEGACY_TAB_KEYS / MOVED_TABS），
    已随「系统设置」合并整体迁到路由层——宿主自己拥有 ?tab=，组件再删改就会冲掉宿主页签。 */
/* ---------- 表单状态（live 一套交互） ---------- */
/**
 * 接入域（live 层 getConfig）读取失败：表单全空 + 卡内 alert 显式说明「下方为空不代表未配置」。
 * 原实现失败时 keySet/models 全为初始值，读数伪装成确定态「未配置 / 未拉取」——把「读不到」
 * 说成「没配置」，是审计不可接受的假信号。（2026-10-14 页首 KPI 带撤除后，失败态只剩卡内
 * alert 一个出口，该 alert 因此不可省。）失败态由 liveFailures.apiConfig 驱动（live.ts 已导出；
 * 读取成功后自动清除，无需本地维护）。
 */
const apiConfigFailed = computed(() => !!liveFailures.value.apiConfig)
/** 子面板读取失败：由各自 error-change 上报，宿主统一出一处页面级错误态 */
const providersFailed = ref(false)
const infraFailed = ref(false)
const panelFailure = computed(() => apiConfigFailed.value || providersFailed.value || infraFailed.value)
/** 横幅按失败源分主语：只坏向量 / 重排时不能再说「列表为空」或泛指整页 */
const panelFailureText = computed(() => {
  const parts: string[] = []
  if (apiConfigFailed.value) parts.push('连接配置')
  if (providersFailed.value) parts.push('对话模型')
  if (infraFailed.value) parts.push('向量 / 重排')
  return parts.length ? `${parts.join('、')}读取失败` : '模型与接入读取失败'
})
/** 页面级重试：三条同域请求一起重拉，避免只恢复其中一块、错误态互相打架 */
function retryAll() {
  void loadLiveData()
  providersRef.value?.refresh?.(true)
  infraRef.value?.load?.()
}
/* 2026-10-28 用户「这一块彻底不要了」：平台默认与别名（思考模式 / 思考强度 / 输出格式 /
   别名映射）整块撤出。模型级生成参数仍在模型编辑里，平台不再提供一份兜底默认。 */

const form = reactive({
  apiUrl: '',
  apiKey: '',
})
const fetchedModels = ref<string[]>([])
/** 上游模型软分类（id → llm/embedding/reranker/unknown）：与清单同一次拉取返回 */
const fetchedModelTypes = ref<Record<string, string>>({})
const keySet = ref(false)
/** 配置是否成功读到过：失败时 keySet/form 都是空初始值，不能当作「未配置」 */
const configLoaded = ref(false)
const keyVisible = ref(false)
const connectionStatus = ref('unknown')
/** 本次会话内「获取模型」成功的时刻（connBadge「N 前」的时间源优先级高于 DB 落库值） */
const connCheckedAt = ref('')
/** 最近一次「获取模型」的失败原因：展示在模型清单空态，避免错误上下文丢失（刷新即消失） */
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

/** 脏位分域标注：保存条列出具体未保存组（连接 / 全站策略） */
const DIRTY_GROUP_LABELS: Record<string, string> = {
  conn: '连接',
  reliability: '全站策略'
}
const dirtyGroups = computed(() => [...dirty.value].map((g) => DIRTY_GROUP_LABELS[g] || g))

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
  configLoaded.value = true
  form.apiUrl = cfg.value.apiUrl
  form.apiKey = ''
  fetchedModels.value = [...cfg.value.availableModels]
  fetchedModelsEndpoint.value = cfg.value.apiUrl
  keySet.value = cfg.value.apiKeyConfigured
  connectionStatus.value = cfg.value.connectionStatus
  savedApiUrl.value = cfg.value.apiUrl
  modelsFetchedOnce.value = true
  dirty.value = new Set()
  /* 首次部署（启动脚本没给 AI_API_URL、库里也没有）：直接展开连接表单。
     这条判断必须放在这里而不是 setup 里——配置是异步拉回来的，初始那一拍 form.apiUrl
     恒为空，放在 setup 会让「已配好的通道」也一进来就展开。 */
  if (props.active && !cfg.value.apiUrl.trim()) connOpen.value = true
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
        title: '丢弃未保存的配置修改',
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
    message: `尚未保存的配置组:${dirtyGroups.value.join(' / ')}。离开将丢弃这些修改。`,
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

/* 2026-10-21 用户走查：平台模型按 Skill 配置，默认路由三行退役（含解析读数与「未登记」警示）。
   2026-10-28 用户「这一块彻底不要了」：平台默认 / 思考 / 结构化输出整块也撤出，
   生成参数只保留在单个模型的编辑里。 */
/* modelListTitle / routeTitle 两个说明 computed 随页首 KPI 带一并删除（2026-10-14）：
   它们只喂过那三块 MkKpi 的 title。对应的诚实性提示改由卡内承接——模型清单卡的
   「本次拉取未保存」徽标 + 持久化说明行、路由行的逐条 title。 */
/* 2026-10-04 状态条退役：页头红/黄/绿基调 statusTone 随状态条整块删除（读取失败信号由
   接入卡内 mk-alert + KPI 卡「—」读数承载，不再有整页基调色） */
/* 连接读数只留异常（2026-11-07）：原来这一带有整枚「上次获取模型：N 前成功」徽标，
   但它的位置是弹窗标题下——连接回页顶、弹窗只挑模型之后，这枚徽标没有落点了。
   成功是一次动作的正常结果（点「重新获取」当场有 toast），不值得常驻；
   失败必须留下来：它是「拉不到清单」的唯一线索。 */

/** 已配置密钥但改了服务地址且 Key 留空：密钥不会随地址迁移，需提示重新输入 */
const keyHintNeeded = computed(
  () => keySet.value && !!form.apiUrl && form.apiUrl !== savedApiUrl.value && !form.apiKey.trim()
)

/* ---------- 操作 ---------- */
const fetching = ref(false)
const saving = ref(false)
const testing = ref(false)

/* 通道级「测试连通性」的判例（2026-11-03 撤过、2026-11-07 以新语义回来）：
   当时撤的是「一枚绿勾」——它盖不住「同地址上 A 能调、B 没权限」，还会与逐模型的
   「测试」读成两套口径。现在这枚按钮不做结论展示，只回答用户此刻最关心的一句：
   「地址 + 密钥到底能不能连上」。成功与否以 toast 说出返回了几个模型，不进徽章、
   不写库（写了就会冒充「上次获取模型」）。逐模型能不能调，仍然只看行内「测试」。 */

/** 首次配置：还没填地址、或密钥还没配 → 主动作是「保存并获取模型」而不是「保存连接配置」 */
const needsSetup = computed(() => !form.apiUrl.trim() || !keySet.value)
/** 配置读取失败且从未成功读到过：卡头/摘要不能把空初始值说成「待配置 / 未配置」 */
const configUnknown = computed(() => apiConfigFailed.value && !configLoaded.value)
/** 服务连接是否就绪：地址与密钥缺一不可（卡头徽标与页顶摘要共用同一判据） */
const connReady = computed(() => !configUnknown.value && !!form.apiUrl.trim() && keySet.value)
/** 「待配置」的具体缺口：徽标悬停要能回答还差什么，而不是只给一个状态词 */
const connMissingText = computed(() => {
  const missing: string[] = []
  if (!form.apiUrl.trim()) missing.push('服务地址')
  if (!keySet.value) missing.push('API Key')
  return missing.length ? `还缺：${missing.join('、')}` : '服务地址与 API Key 均已配置'
})
/** 连接配置弹窗开合（2026-11-09：原先是页面内展开的内联表单；没配地址时自动打开，
    首次部署就是要填它） */
const connOpen = ref(false)
const connMaskRef = ref<HTMLElement | null>(null)
const connPanelRef = ref<HTMLElement | null>(null)

/** 收起态摘要里的地址：只留主机（完整地址进 title 与弹窗），长 URL 不再拖在卡片头上 */
const summaryHost = computed(() => {
  const raw = form.apiUrl.trim()
  if (!raw) return '未配置服务地址'
  try {
    return new URL(raw).host
  } catch {
    // 还只是半截输入（没有协议头）时原样给，免得摘要空着看不出他在连哪
    return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
})

function openConnDialog(): void {
  connOpen.value = true
}

/* 弹窗行为与其他浮层同一套：Esc / 遮罩点空白关闭（有未保存改动先问）、锁背景滚动、
   焦点陷阱与关闭后焦点回落。 */
useEscape(() => connOpen.value, closeConnDialog)
useMaskClose(connMaskRef, closeConnDialog)
useOverlay(connOpen, connPanelRef)

/** 关窗：有未保存改动先问一句（原内联态是「先保存再收起」——改动不能藏进一次关闭里） */
function closeConnDialog(): void {
  if (!connOpen.value) return
  if (!connDirty.value) {
    connOpen.value = false
    return
  }
  void (async () => {
    const ok = await askConfirm({
      title: '关闭并放弃连接改动',
      message: '关闭后未保存的服务地址 / 密钥 / 重试策略改动会丢弃。',
      confirmText: '放弃改动'
    })
    if (!ok) return
    // 回滚草稿：配置回显（applyLiveConfig）会一并清 dirty；可靠性设置单独重取
    applyLiveConfig()
    void loadReliability()
    connOpen.value = false
  })()
}

/** 测试连接：只探活，不落盘、不改「上次获取模型」读数 */
async function testConn(): Promise<void> {
  if (testing.value) return
  if (!form.apiUrl.trim()) {
    toast.error('先填服务地址')
    return
  }
  if (keyHintNeeded.value) {
    toast.error('换服务地址后要先填新的 API Key，再测试')
    return
  }
  testing.value = true
  try {
    const { models: list } = await liveFetchModels(form.apiUrl, form.apiKey)
    toast.success(list.length ? `连接成功，上游返回 ${list.length} 个模型` : '连接成功，上游未返回模型列表')
  } catch (e) {
    toast.error(`连接失败：${errMsg(e)}`)
  } finally {
    testing.value = false
  }
}

/**
 * 拉一份上游清单。
 *
 * `source === 'open'` 是**打开弹窗时顺带拉的那一次**：它只读——不写连接、不弹成功提示
 * （2026-11-05 用户「为什么每次点开添加模型右上角会这样」，那枚「已保存连接，获取到 36 个模型」
 * 就是每次打开都落盘一次留下的）。只有用户自己点「获取模型 / 重新获取」才把连接一起落盘：
 * 那是「填地址和 key → 获取」这条流程的提交点，选模型顺带改连接不该反过来变成写连接的时机。
 */
async function fetchModels(source: 'open' | 'refetch' = 'refetch'): Promise<void> {
  if (fetching.value) return
  const background = source === 'open'
  /* 合并弹窗后这里是唯一拉取入口，校验必须给话：地址空着点「获取模型」不能毫无反应。
     打开弹窗的那一次不给——首次部署时地址本来就还是空的。 */
  if (!form.apiUrl.trim()) {
    if (!background) toast.error('先填服务地址')
    return
  }
  /* 流程第 1 步要求「填链接和 key」：换地址却没重填密钥时，不能拿旧密钥去试新端点 */
  if (keyHintNeeded.value) {
    if (!background) toast.error('更换服务地址后需重新输入 API Key')
    return
  }
  fetching.value = true
  try {
    const { models: list, types } = await liveFetchModels(form.apiUrl, form.apiKey)
    fetchedModels.value = list
    fetchedModelTypes.value = types
    fetchedModelsEndpoint.value = form.apiUrl.trim()
    modelsFetchedOnce.value = true
    connectionStatus.value = 'connected'
    connCheckedAt.value = new Date().toISOString()
    fetchError.value = ''
    if (!background) {
      /* 获取即保存：用户流程是「填地址和 key → 获取模型」，不该再要求点一次保存。
         保存失败时不再往下走——连接没落盘，配好的模型也用不上。 */
      markDirty('conn')
      const saved = await saveGroups(['conn'], { silent: true })
      if (!saved) return
      toast.success(list.length ? `已保存连接，获取到 ${list.length} 个模型` : '已保存连接，但服务未返回模型列表')
    }
    /* 2026-11-05 合并弹窗：清单换成这次拉到的，勾选面板原地刷新。
       走到这里时弹窗通常已经开着（入口就在弹窗里）；只有宿主从别处触发时才需要开。 */
    await nextTick()
    providersRef.value?.openHostPull?.()
  } catch (e) {
    connectionStatus.value = 'failed'
    connCheckedAt.value = new Date().toISOString()
    fetchError.value = errMsg(e)
    // 弹窗与模型卡已有行内错误，不再叠同次失败的 toast
  } finally {
    fetching.value = false
  }
}

/** 按域保存：只提交传入且处于脏状态的域，不动其他未保存改动。
    UI 在每个分段的标题上挂「保存」，调用方传该段对应的域。 */
async function saveGroups(groups: string[], opts: { silent?: boolean } = {}): Promise<boolean> {
  if (saving.value) return false
  const set = new Set(groups.filter((g) => dirty.value.has(g)))
  if (!set.size) return true
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
    if (set.has('reliability') && reliability.value) {
      // 空值容错:v-model.number 清空后是字符串,后端要求全整数字段(400 且不定位)。
      // 保存前回退到最近一次加载值,并写回输入框,所见即所存
      const intOr = (v: unknown, fb: unknown): number => {
        if (typeof v === 'number' && Number.isInteger(v)) return v
        const f = Number(fb)
        return Number.isInteger(f) ? f : 0
      }
      const base = reliabilityBase.value ?? {}
      /* 2026-10-26 界面只露「最大重试」（= maxUpstreamAttempts，本次调用的总尝试上限）。
         同模型重试数、超时、退避上限、抖动这几项不再上屏，但必须原样回传库里的现值：
         后端 PUT 是 partial 合并，少传一项就等于把它重置成默认值。
         刻意不把「最大重试」联动到同模型重试数：两者是各自独立的预算。
         2026-11-04 用户「去掉降级这个功能，不要」：模型降级整条下线，原先「降级永不触发」
         那条告警一并撤除。 */
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
    if (!opts.silent) toast.success('配置已保存并生效')
    return true
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
    return false
  } finally {
    saving.value = false
    savingGroups.value = new Set()
  }
}

/* 重置接入配置：后端 POST /admin/api-config/reset 只删 platform_api_configs 一行
   （服务地址 / 密钥 / 模型清单 / 平台默认生成参数），不动全站策略与访问策略。高风险不可撤销，走二次确认。 */
const resetting = ref(false)
async function resetConfig() {
  if (resetting.value) return
  const ok = await askConfirm({
    title: '重置平台通道的接入配置',
    message: '将删除平台通道已保存的服务地址、API Key、模型清单与平台默认生成参数。此操作不可撤销。',
    confirmText: '重置'
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

/* 嵌入「系统设置」宿主时：根节点不再是 .mk-page--fill，得自己把剩余高度吃下来，
   否则里面的 .ac-tab-body（flex:1 + overflow-y:auto）没有可解析的父高度，滚动会失效 */
.ac-host--embedded {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@media (max-width: 900px) {
  .ac-host--embedded { flex: none; min-height: 0; overflow: visible; display: block; }
}

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
/* 置顶告警（接入域读取失败）横跨全部列，不占卡位把卡片挤换行 */
.ac-conn-body > .mk-alert { grid-column: 1 / -1; }

/* ---------- 页顶「服务连接」卡（2026-11-07 用户「提回去」） ----------
   收起态 = 卡头一行摘要（默认全局通道 · 地址主机 · 密钥状态）+ 两枚动作；
   连接细节（地址 / 密钥 / 重试策略）收进「配置服务连接」弹窗，不再在页面流里原地展开大表单
   （2026-11-09 用户「隐藏具体 URL 和参数细节」）。 */
.ac-conn { flex: none; }
.ac-conn__head { flex-wrap: wrap; gap: 8px 16px; }
.ac-conn__id { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 摘要行：通道名 + 地址主机 + 密钥状态不折行，两枚动作贴右 */
.ac-conn-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.ac-conn-summary__chan { color: var(--mk-muted); font-size: var(--mk-fs-micro); white-space: nowrap; }
.ac-conn-summary__addr {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
}
.ac-conn-summary__dot { color: var(--mk-faint, var(--mk-muted)); }
.ac-conn-summary__key { color: var(--mk-muted); font-size: var(--mk-fs-micro); white-space: nowrap; }
/* 配置弹窗：小号窗，不随全站 .mk-modal__panel 的 480→900 在宽屏上长到半屏（两类名提权，压过断点里的基类规则） */
.ac-conn-dlg.mk-modal__panel { width: min(560px, 100%); max-width: none; }
/* 地址与密钥并排：竖着排是这个宽度下最费的两行 */
.ac-conn-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ac-conn-policy {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
/* 三列等宽时两个错位同源于 .mk-field（display:grid 未写 align-content，默认 stretch
   会把自动行拉高填满容器）：
   ① 没有提示行的那一列，多出来的高度全灌进输入框（实测 53px vs 另有提示的 39px）；
   ② 「重试间隔（毫秒）」比另两个标签长，在 163px 栏里折成两行，把输入框顶下 14px。
   所以既要把行钉在顶部，也要让标签不折行——单加 align-items:start 治不了②（2026-11-03 实测）。 */
.ac-conn-policy .mk-field { align-content: start; }
.ac-conn-policy .mk-field__label { white-space: nowrap; }
@media (max-width: 640px) {
  .ac-conn-policy, .ac-conn-pair { grid-template-columns: minmax(0, 1fr); }
}
/* 表单脚：保存常驻（无改动时禁用）+ 一句口径说明 + 贴右端的危险动作 */
.ac-conn__foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* 危险动作与主按钮拉开距离（准则 2）：中间留出的空白就是防误触的那段距离 */
.ac-conn__danger { margin-left: auto; white-space: nowrap; }

.ac-key-wrap { display: grid; gap: 4px; min-width: 0; }
.ac-key-input-row { display: flex; align-items: center; gap: 6px; }
.ac-key-input-row .mk-field__input { flex: 1; min-width: 0; }
.ac-key-toggle {
  flex-shrink: 0;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface-2);
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
/* 上游清单关系句（2026-10-16 用户走查重排）：原 30+ 枚模型胶囊（.ac-models/.ac-model）退役——
   与下方登记表并列成两份模型名单，被读成「同一件事说两遍」。现在只说关系，逐个名字在登记表折叠里。 */
.ac-models__line { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
/* 清单未落盘：把「哪些模型、多少个、怎么存」写全，紧挨着给按钮（2026-11-07） */
.ac-models__save-hint { color: var(--mk-muted); font-size: var(--mk-fs-micro); min-width: 0; }
/* 上游对齐条（2026-10-20 从连接块搬进模型清单块）：嵌在模型标题行里只占一行读数，
   与「模型 N 个」并排（2026-10-24 走查：不再在表头之上单起一行） */
.ac-models-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}


/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mk-field__label { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .mk-field__label { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .mk-field__label { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：模型与接入 ================= */
html[data-theme='dark'] {
  .ac-key-toggle:hover { background: color-mix(in srgb, var(--wf-color-primary) 14%, transparent); }
  /* 补漏：密钥切换钮浅底（模型胶囊随清单胶囊退役，2026-10-16） */
  .ac-key-toggle { background: var(--mk-surface-2); color: var(--mk-muted); }
}
</style>
