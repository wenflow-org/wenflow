<template>
  <!-- 模型供应商与模型（BYOK 重做，2026-10-18；2026-10-19 去分区；2026-10-28 新人视角收敛）。
       左=供应商列表（当前通道 + 其余启用中的上游；停用条目默认收起），右=选中供应商的详情
       （服务地址、密钥三件套、模型清单可增删改、上游未登记折叠；当前通道的服务地址与密钥、
        连通性验证由宿主经 #platform-detail 注入）。
       2026-10-19 用户「就不分区，不要做什么平台提供，对于运营来说就是平台本身，自行接入又是什么
       意义呢」：原先按 id==='platform' 硬切「平台提供 / 自行接入」两组，详情头还挂「平台提供」
       徽标——那是「这条通道是谁给的」的来历视角，运营不需要，两栏看着还像两种东西。现在平铺成
       一份供应商清单（当前通道排最前），来历词全部撤掉。
       2026-10-28 用户「不应该出现新建供应商，走两家供应商的事情」：撤掉「添加供应商」入口，
       新人只需要把当前通道配好；停用的示例条目不占第一屏。价格不再占模型表一列，收进模型编辑的
       高级设置（单价只服务成本分析，不是接入路径）。
       编辑是**即时保存**：点保存就落盘并热生效，不并入页脚保存条——只有当前通道的服务地址与
       密钥仍是连接设置的脏位保存（那段表单由宿主经 #platform-detail 插槽注入）。
       运行面读数（冷却/健康/配置漂移告警）另取 GET /admin/model-registry：编辑面只有配置值，
       把「这个模型现在能不能用」也算在这里会让两个接口互相复述。 -->
  <section class="mk-card mpp">
    <div class="mk-card__head">
      <h3 class="mk-card__title">接入通道</h3>
      <span class="mk-card__meta" :title="registryPathTitle">{{ registryMeta }}</span>
      <button v-if="registry?.readOnly" type="button" class="mk-btn mk-btn--sm mk-btn--danger" disabled title="配置文件所在目录不可写，请在部署侧开放写权限">
        只读
      </button>
    </div>

    <div v-if="actionError" class="mk-alert mk-alert--row mpp-alert" role="alert">
      <span class="mk-alert__msg">{{ actionError }}</span>
      <button type="button" class="mk-alert__btn" @click="actionError = ''">知道了</button>
    </div>
    <div v-for="(w, i) in writeWarnings" :key="`w-${i}`" class="mk-alert mk-alert--row mpp-alert" role="status">
      <span class="mk-alert__msg">{{ w }}</span>
    </div>
    <p v-if="registry?.readOnly" class="mpp-note">
      注册表文件所在目录当前不可写，页面只能查看。请由部署侧开放写权限后再编辑。
    </p>

    <MkLoading v-if="loading && !view" inline text="读取接入通道…" />
    <MkEmptyState
      v-else-if="failed"
      tone="error"
      title="接入通道读取失败"
      :description="errorText"
      action-text="重试"
      @action="refresh(true)"
    />

    <div v-else class="mpp-body">
      <!-- 左：供应商列表（启用中的平铺一份清单，当前通道在最前；停用条目默认收起）
           2026-10-28 用户「不应该出现新建供应商，走两家供应商的事情」：撤掉「添加供应商」。
           新人只需要把当前通道配好；停用的示例条目不再占据第一屏，需要时再展开。 -->
      <aside class="mpp-list" role="tablist" aria-label="接入通道" @keydown="onTablistKeydown">
        <div
          v-for="p in orderedProviders"
          :key="p.id"
          class="mpp-item"
          :class="{ 'mpp-item--on': p.id === selectedId, 'mpp-item--off': !p.enabled }"
          role="tab"
          :aria-selected="p.id === selectedId"
          :data-provider="p.id"
          :tabindex="p.id === selectedId ? 0 : -1"
          @click="select(p.id)"
          @keydown.enter.prevent="select(p.id)"
          @keydown.space.prevent="select(p.id)"
        >
          <span class="mpp-item__dot" :class="`mpp-item__dot--${p.status}`" :title="statusLabel(p)" aria-hidden="true"></span>
          <span class="mpp-item__grow">
            <span class="mpp-item__name">{{ providerName(p) }}</span>
            <span class="mpp-item__meta">{{ providerTypeLabel(p) }} · {{ p.models.length }} 个模型<template v-if="!p.enabled"> · 已停用</template></span>
          </span>
          <MkSwitch
            :model-value="p.enabled"
            :disabled="busy"
            :aria-label="`启用通道 ${providerName(p)}`"
            @update:model-value="(v: boolean) => toggleEnabled(p, v)"
          />
        </div>
        <button
          v-if="disabledCount"
          type="button"
          class="mk-link mpp-show-disabled"
          @click="showDisabled = !showDisabled"
        >{{ showDisabled ? '收起已停用' : `显示已停用（${disabledCount}）` }}</button>
      </aside>

      <!-- 右：详情 -->
      <div v-if="selected" class="mpp-detail">
        <div class="mpp-detail__head">
          <div class="mpp-detail__id">
            <strong class="mpp-detail__name">{{ providerName(selected) }}</strong>
            <span class="mpp-type" :class="{ 'mpp-type--platform': selected.id === 'platform' }">{{ providerTypeLabel(selected) }}</span>
            <span v-if="selected.id !== 'platform'" class="mono mpp-detail__code">{{ selected.id }}</span>
            <span v-else class="mpp-detail__code">继承平台端点 · 一条通道 = 服务地址 + 凭据 + 模型清单</span>
            <!-- 状态徽标只出「能不能用」；当前通道（endpointSource=inherit）不出徽标——
                 它用不用得了由下面「连接」段的连接徽标回答，同屏两处说同一件事是复读 -->
            <span v-if="headBadge" class="mk-badge" :class="headBadge.cls">{{ headBadge.label }}</span>
          </div>
          <div class="mpp-detail__acts">
            <button
              v-if="selected.id !== 'platform'"
              type="button"
              class="mk-btn mk-btn--sm"
              :disabled="busy || registry?.readOnly"
              @click="openSettings(selected)"
            >设置</button>
            <button
              v-if="selected.id !== 'platform'"
              type="button"
              class="mk-btn mk-btn--sm mk-btn--danger"
              :disabled="busy || registry?.readOnly"
              @click="removeProvider(selected)"
            >删除</button>
          </div>
        </div>
        <p v-if="selected.description && selected.id !== 'platform'" class="mpp-detail__desc">{{ selected.description }}</p>

        <!-- 平台详情二级页签（2026-10-26）：模型 / 连接 / 基础设施 / 生成参数。
             用户「这个地方就可以配置重排序嵌入模型」「我不知为啥还要有默认设置。不就是配置的模型吗」——
             向量化与重排、生成默认都是平台这条供应商自己的能力，原先各自独立成卡挂在页面
             别处，与「平台」分成两处看。内容用 v-show 不用 v-if：切页签不重建表单，
             基础设施面板的已加载状态也留着。 -->
        <MkSubTabs
          v-if="selected.id === 'platform'"
          v-model="platformTab"
          :tabs="platformTabs"
          id-base="mpp-platform"
          class="mpp-subtabs"
        />

        <!-- 平台通道的连接（服务地址 / 密钥 / 连通性验证）由宿主经 #platform-detail 就地注入：
             2026-10-25 用户「这个组整个页面我觉得做的不好」——它此前藏在「平台设置」弹窗里，
             改个地址要先点「设置」，而它本身就是「平台」这条供应商的连接属性，
             和右侧模型表属于同一个对象的两面。 -->
        <div
          v-if="selected.id === 'platform'"
          v-show="platformTab === 'conn'"
          id="mpp-platform-panel-conn"
          role="tabpanel"
          aria-labelledby="mpp-platform-tab-conn"
        >
          <slot name="platform-detail" />
        </div>

        <template v-if="selected.id !== 'platform'">
          <div class="mpp-block">
            <div class="mpp-block__head">
              <span class="mpp-sec">连接与鉴权</span>
              <!-- 2026-10-27 P1：同步上游模型绑在这条通道的地址与密钥上，就地闭环 -->
              <button
                type="button"
                class="mk-btn mk-btn--sm"
                :disabled="pulling || !selected.keyHint"
                :title="selected.keyHint ? '用这条通道的地址与密钥拉取 /models' : '先保存密钥'"
                @click="pullModels(selected)"
              >{{ pulling ? '同步中…' : pulled.length ? '重新同步上游模型' : '同步上游模型' }}</button>
            </div>
          <div class="mpp-endpoint">
            <div class="mpp-endpoint__row">
              <span class="mpp-endpoint__label">服务地址</span>
              <span class="mono mpp-endpoint__value">{{ selected.baseUrl }}</span>
            </div>
            <div class="mpp-endpoint__row">
              <span class="mpp-endpoint__label">API Key</span>
              <span class="mpp-endpoint__key">
                <input
                  v-model="keyDraft"
                  class="mk-field__input"
                  :type="keyVisible ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="selected.keyHint ? `已配置 ${selected.keyHint}，留空 = 沿用` : '输入 API Key'"
                  :disabled="registry?.readOnly"
                />
                <button
                  v-if="selected.keyHint || keyDraft"
                  type="button"
                  class="mpp-key-toggle"
                  :title="keyVisible ? '隐藏' : '显示'"
                  @click="keyVisible = !keyVisible"
                >{{ keyVisible ? '隐藏' : '显示' }}</button>
              </span>
              <span class="mpp-endpoint__acts">
                <button
                  type="button"
                  class="mk-btn mk-btn--sm mk-btn--primary"
                  :disabled="busy || !keyDraft.trim() || registry?.readOnly"
                  @click="saveKey(selected)"
                >保存密钥</button>
                <button type="button" class="mk-btn mk-btn--sm" :disabled="busy || registry?.readOnly" @click="clearKey(selected)">移除密钥</button>
              </span>
            </div>
          </div>
          </div>
        </template>

        <div
          v-show="selected.id !== 'platform' || platformTab === 'models'"
          :id="selected.id === 'platform' ? 'mpp-platform-panel-models' : undefined"
          :role="selected.id === 'platform' ? 'tabpanel' : undefined"
          :aria-labelledby="selected.id === 'platform' ? 'mpp-platform-tab-models' : undefined"
          class="mpp-block mpp-models"
        >
          <div class="mpp-models__head">
            <!-- 平台详情只有一页：标题直接给模型计数（原页签计数随页签一起退役）。
                 上游清单状态与计数同一行（2026-10-24 走查）：原先是表头之上独立一条，
                 读起来像一行空记录。 -->
            <div class="mpp-models__title">
              <span class="mpp-sec">模型<span class="mpp-sec__count">{{ selected.models.length }} 个</span></span>
              <slot v-if="selected.id === 'platform'" name="models-meta" />
            </div>
            <span class="mpp-models__acts">
              <!-- 拉取结果收进浮窗（2026-10-24）：清单不在详情里铺开，勾选后再逐个配置。
                   拉取过一次就保留入口，关掉浮窗还能回来再选。 -->
              <button v-if="pullableCount" type="button" class="mk-link" @click="openPull">
                选择要添加的（{{ pullableCount }}）
              </button>
              <button type="button" class="mk-btn mk-btn--sm" :disabled="busy || registry?.readOnly" @click="openManualAdd">＋ 添加模型</button>
            </span>
          </div>

          <!-- 上游清单不再铺在详情里（2026-10-24 用户「拉取作为浮窗」）：拉取只拿到清单，
               勾选与用途分流都在 PullModelsDialog 里做——详情区只留已登记模型这张表。 -->

          <!-- 空模型时的下一步（2026-10-28 新人视角）：不丢一张空表，直接说清先做什么 -->
          <div v-if="selected.enabled && !selected.models.length" class="mpp-setup">
            <div class="mpp-setup__text">
              <strong>还没有登记模型</strong>
              <span>先配置服务地址与 API Key，再拉取上游模型，或手动添加模型 ID。</span>
            </div>
            <button
              v-if="selected.id === 'platform'"
              type="button"
              class="mk-btn mk-btn--sm"
              @click="platformTab = 'conn'"
            >去配置连接</button>
            <button
              v-else
              type="button"
              class="mk-btn mk-btn--sm"
              :disabled="busy || registry?.readOnly"
              @click="openManualAdd"
            >添加模型</button>
          </div>

          <div v-if="selected.models.length || !selected.enabled" class="mk-table-scroll">
            <table class="mk-table mk-table--dense mpp-table">
              <colgroup>
                <col style="width: 30%" /><col style="width: 21%" /><col style="width: 20%" /><col style="width: 14%" /><col style="width: 15%" />
              </colgroup>
              <thead>
                <tr>
                  <th>本地模型</th>
                  <th title="当前版本本地名即上游模型名，后续支持独立映射">上游模型名</th>
                  <th>功能</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <!-- 按用途分组（2026-10-21 用户「按功能区分一下」）：同一张表里用分组行切段，
                     不拆多张表——列宽与对齐保持一处。组内再按能力标「功能」列，运营一眼看得出
                     哪个模型能思考、能调推理强度、能读图。 -->
                <template v-for="g in modelGroups" :key="g.tier">
                  <tr class="mpp-group">
                    <td colspan="5">
                      <span class="mpp-group__name">{{ g.label }}</span>
                      <span class="mpp-group__count">{{ g.models.length }} 个</span>
                      <span class="mpp-group__hint">{{ g.hint }}</span>
                    </td>
                  </tr>
                  <tr v-for="m in g.models" :key="m.id">
                  <td class="mpp-model">
                    <span class="mono mpp-model__id">{{ m.id }}</span>
                    <span v-if="m.label && m.label !== m.id" class="mpp-desc" :title="m.label">{{ m.label }}</span>
                    <span
                      v-if="testResults[m.id]"
                      class="mpp-rowtest"
                      :class="{ 'mpp-rowtest--bad': !testResults[m.id].ok }"
                      :title="testResults[m.id].text"
                    >{{ testResults[m.id].ok ? '调用通过' : '调用失败' }}<template v-if="testResults[m.id].latency"> · {{ testResults[m.id].latency }}</template></span>
                  </td>
                  <td class="mpp-upstream">
                    <span class="mono" :title="upstreamNameOf(m)">{{ upstreamNameOf(m) }}</span>
                    <span v-if="upstreamNameOf(m) === m.id" class="mpp-desc">同本地名</span>
                  </td>
                  <td class="mpp-fn">
                    <span v-for="tag in functionTags(m)" :key="tag" class="mpp-fn__chip">{{ tag }}</span>
                    <span v-if="!functionTags(m).length" class="mpp-fn__none">基础对话</span>
                  </td>
                  <td>
                    <span v-if="cooldownOf(m)" class="mk-badge mk-badge--warn" :title="`已触发熔断冷却，降级时会被跳过（剩余 ${Math.ceil(cooldownOf(m)!.remainingMs / 1000)}s）`">冷却中</span>
                    <span v-else class="mk-badge mk-badge--ok">● 健康</span>
                    <span v-if="modelWarnings(m).length" class="mk-badge mk-badge--warn mpp-label" :title="modelWarnings(m).join('\n')">⚠ {{ warningLabel(m) }}</span>
                  </td>
                  <td class="mpp-rowacts">
                    <!-- 高频两枚平铺（测试 / 编辑）；删除是低频且不可撤销，收进 ⋯ 菜单
                         ——与公告、账号、虚拟学习者同一套行内操作层级（useRowMenu 同源） -->
                    <button type="button" class="mk-link" :disabled="testingId === m.id" @click="testModel(selected, m.id)">{{ testingId === m.id ? '测试中…' : '测试' }}</button>
                    <button type="button" class="mk-link" :disabled="busy || registry?.readOnly" @click="modelEditor?.openWith({ providerId: selected.id, model: m })">编辑</button>
                    <div class="mk-menu">
                      <button
                        type="button"
                        class="mk-menu__btn"
                        aria-label="更多操作"
                        aria-haspopup="menu"
                        :aria-expanded="openMenu === m.id"
                        @click.stop="toggleMenu(m.id)"
                      >⋯</button>
                      <div v-if="openMenu === m.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                        <button
                          type="button"
                          class="mk-menu__item mk-menu__item--danger"
                          role="menuitem"
                          :disabled="busy || registry?.readOnly"
                          @click="removeModel(m)"
                        >删除</button>
                      </div>
                    </div>
                  </td>
                  </tr>
                </template>
                <tr v-if="!selected.models.length">
                  <td colspan="5" class="mpp-empty">
                    这条通道当前停用，模型不参与路由。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 基础设施（向量化 / 重排）：平台这条供应商自己的能力，收进详情第三个页签。
             2026-10-26 用户「这个地方就可以配置重排序嵌入模型」——此前它是页面最下方一张
             独立卡，和「平台」分成两处，改个嵌入模型得往下滚过整个模型表。 -->
        <div
          v-if="selected.id === 'platform'"
          v-show="platformTab === 'infra'"
          id="mpp-platform-panel-infra"
          role="tabpanel"
          aria-labelledby="mpp-platform-tab-infra"
          class="mpp-block mpp-infra"
        >
          <slot name="platform-infra" />
        </div>

        <!-- 生成参数（思考模式 / 思考强度 / 输出格式）：模型级的生成默认。
             2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，这个页面我觉得
             可以和前面的合并了」——它此前是接入页最下方一张独立卡，叫「平台默认生成参数」；
             可它就是「这些模型默认怎么生成」，属于平台这条供应商，与模型表同一个对象。
             模型级覆盖优先（ModelEditorDialog 的「用平台默认」），这里兜底。 -->
        <div
          v-if="selected.id === 'platform'"
          v-show="platformTab === 'generation'"
          id="mpp-platform-panel-generation"
          role="tabpanel"
          aria-labelledby="mpp-platform-tab-generation"
          class="mpp-block mpp-generation"
        >
          <slot name="platform-generation" />
        </div>
      </div>
      <MkEmptyState v-else compact title="还没有接入通道" />
    </div>

    <PullModelsDialog
      ref="pullDialog"
      :provider-name="selected ? providerName(selected) : ''"
      :provider-id="selected?.id ?? ''"
      :models="fetchableModels"
      :registered="[...registeredIds]"
      @confirm="startConfigure"
      @navigate="onPullNavigate"
    />
    <ProviderEditorDialog ref="providerEditor" @saved="onProviderSaved" />
    <ModelEditorDialog ref="modelEditor" :fallback-options="fallbackOptions" @saved="onModelSaved" @closed="onEditorClosed" />
    <!-- 逐个配置队列：常驻进度与「跳过剩余」，中途关掉模型弹窗也能知道还剩几个 -->
    <div v-if="configureQueue.length" class="mpp-queue" role="status">
      <span>还剩 {{ configureQueue.length }} 个模型未配置</span>
      <button type="button" class="mk-link" @click="skipRemaining">跳过剩余</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { adminApiConfigApi, adminModelProvidersApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import ProviderEditorDialog, { type ProviderLike } from './ProviderEditorDialog.vue'
import ModelEditorDialog, { type ModelLike } from './ModelEditorDialog.vue'
import PullModelsDialog from './PullModelsDialog.vue'
import { modelKindOf } from './platformModelKind'
import { askConfirm } from './useConfirm'
import { useRowMenu } from './useRowMenu'
import { errMsg } from './live'
import { toast } from '@/utils/toast'

/** 注册表编辑视图（后端 services/admin/model-providers.service.ts 的 ProviderRegistryView） */
interface ProviderView extends ProviderLike {
  id: string
  name: string
  description: string | null
  enabled: boolean
  recommended: boolean
  endpointSource: 'inherit' | 'own'
  baseUrl: string | null
  apiKeyEnv: string | null
  keySource: 'db' | 'env' | 'none'
  keyHint: string | null
  status: 'ready' | 'unconfigured' | 'inherit' | 'disabled'
  supportsSystemRole: boolean | null
  models: ModelLike[]
}
interface ProvidersView {
  registry: { path: string; source: 'file' | 'embedded-fallback'; mtimeMs: number | null; lastError: string | null; readOnly: boolean }
  providers: ProviderView[]
}
/** 运行面读数（GET /admin/model-registry 的子集）：冷却、告警、候选上限 */
interface RegistryHealth {
  models: Array<{ id: string; providerId: string }>
  cooldowns: Array<{ providerId: string; model: string; remainingMs: number }>
  warnings: string[]
  runtime?: { maxModelCandidates: number }
}

const props = withDefaults(defineProps<{
  /** 上游模型清单（宿主连接设置里拉到的，平台通道用） */
  upstream?: string[]
}>(), { upstream: () => [] })

const emit = defineEmits<{
  /** 注册表被改动（增删改）→ 宿主决定是否重取别名/默认解析 */
  changed: []
  /** 已登记的模型 id（宿主用它算「上游还有几个没登记」的关系句，避免两处各算一遍） */
  registered: [ids: string[]]
  /** 平台详情当前页签（宿主据此判断「连接 / 生成参数」的分段保存钮是否在屏上，
      不在屏时由底部保存条接手，否则单组脏会没有保存入口） */
  platformTab: [key: string]
}>()

const view = ref<ProvidersView | null>(null)
const health = ref<RegistryHealth | null>(null)
const loading = ref(false)
const failed = ref(false)
const errorText = ref('')
const busy = ref(false)
const actionError = ref('')
const writeWarnings = ref<string[]>([])
const selectedId = ref('')
/** 已停用供应商默认收起：新人第一眼只看到正在用的通道，示例/停用条目不占清单 */
const showDisabled = ref(false)
const keyDraft = ref('')
const keyVisible = ref(false)
const testingId = ref('')
const pulling = ref(false)
/** 单模型测试结果（按模型 id 落在行内，不再用卡上方一条全局结果条） */
const testResults = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
const pulled = ref<string[]>([])
const router = useRouter()
/** 行内 ⋯ 菜单（低频/危险操作）：与公告、账号、虚拟学习者同一套实现 */
const { openMenu, toggleMenu, popStyle } = useRowMenu()

const providerEditor = ref<InstanceType<typeof ProviderEditorDialog> | null>(null)
const modelEditor = ref<InstanceType<typeof ModelEditorDialog> | null>(null)
const pullDialog = ref<InstanceType<typeof PullModelsDialog> | null>(null)
/** 勾选后逐个配置的待办队列（保存一个进下一个；数量用于弹层标题 2/5） */
const configureQueue = ref<string[]>([])
const configureTotal = ref(0)

const providers = computed(() => view.value?.providers ?? [])
/** 目录文件状态（路径/可写/最近一次热重载错误）：模板里多处按它决定是否禁用编辑 */
const registry = computed(() => view.value?.registry ?? null)
const selected = computed(() => providers.value.find((p) => p.id === selectedId.value) ?? null)
/* 平台详情的二级页签（2026-10-26 用户「这个地方就可以配置重排序嵌入模型」+
   「我不知为啥还要有默认设置。不就是配置的模型吗，这个页面我觉得可以和前面的合并了」）：
   向量化 / 重排 / 生成默认都是平台这条供应商自己的能力，原来各自独立成卡挂在页面别处，
   与「当前通道」是两处；现在收进通道详情，和连接、模型并列。页签只对平台出现——
   示例供应商没有基础设施与平台级生成默认。用组件内状态不写 URL：二级写键会与一级抢。 */
const platformTab = ref<'models' | 'conn' | 'infra' | 'generation'>('models')
const platformTabs = computed(() => [
  { key: 'models', label: '模型', count: selected.value?.models.length },
  { key: 'conn', label: '连接与鉴权' },
  { key: 'infra', label: '基础设施' },
  { key: 'generation', label: '平台默认与别名' },
])
/* 当前页签回传宿主：连接与生成参数的分段保存钮只在该页签可见，
   宿主据此决定单组脏时要不要出底部保存条（否则切走页签就没有保存入口）。 */
watch([platformTab, selectedId], () => {
  emit('platformTab', selected.value?.id === 'platform' ? platformTab.value : '')
}, { immediate: true })

/* 2026-10-21 用户「不要了」：卡头 meta 只留可写/只读这个会改变操作的结论，
   数据来源（来自模型目录文件）与生效方式进 title */
const registryMeta = computed(() => {
  const r = view.value?.registry
  if (!r) return ''
  if (r.readOnly) return '只读'
  return '改动即时生效'
})
const registryPathTitle = computed(() => {
  const r = view.value?.registry
  if (!r) return ''
  const parts = [`目录文件：${r.path}`]
  if (r.lastError) parts.push(`最近更新失败：${r.lastError}`)
  return parts.join('\n')
})

/** 供应商展示名：文件里的 dev 默认名「平台」不带到界面上——没有平台默认这回事，
    它就是「这个部署当前实际调用的通道」。别的部署给 platform 起了真名就照实显示。 */
function providerName(p: ProviderView): string {
  return p.id === 'platform' && p.name === '平台' ? '平台通道' : p.name
}
/** 通道类型：平台内置 / 自建。接入通道 = 一个服务地址 + 一套凭据 + 模型清单。 */
function providerTypeLabel(p: ProviderView): string {
  return p.id === 'platform' ? '平台内置' : '自建通道'
}
/** 上游物理模型名：P2 独立映射落地前就是本地 id */
function upstreamNameOf(m: ModelLike): string {
  return (m.upstreamModelId || '').trim() || m.id
}
/** 平铺一份清单：当前通道在最前；停用条目默认不出现，由清单底部一行展开 */
const disabledCount = computed(() => providers.value.filter((p) => !p.enabled).length)
const orderedProviders = computed(() => {
  const list = showDisabled.value ? providers.value : providers.value.filter((p) => p.enabled)
  return [...list.filter((p) => p.id === 'platform'), ...list.filter((p) => p.id !== 'platform')]
})

const registeredIds = computed(() => new Set(selected.value?.models.map((m) => m.id) ?? []))
/** 上游模型清单：平台通道来自连接设置（宿主注入），自带端点来自本页「获取模型列表」 */
const fetchableModels = computed(() =>
  selected.value?.endpointSource === 'inherit' ? props.upstream : pulled.value
)
/** 还能登记进模型清单的对话模型数：拉取结果里已添加的不再计入 */
const pullableCount = computed(() =>
  fetchableModels.value.filter((name) => modelKindOf(name) === 'chat' && !registeredIds.value.has(name)).length
)

const fallbackOptions = computed(() =>
  providers.value.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`))
)

/** 已登记模型 id 回传宿主（上游清单的关系句由宿主渲染，数据同源一次算） */
function emitRegistered(): void {
  emit('registered', providers.value.flatMap((p) => p.models.map((m) => m.id)))
}

function statusLabel(p: ProviderView): string {
  if (p.status === 'disabled') return '已停用'
  if (p.status === 'inherit') return '用连接设置里的地址与密钥'
  if (p.status === 'unconfigured') return '还没配置密钥'
  return '可用'
}
/** 详情头徽标：只出「能不能用」。「用连接设置」这一档返回 null——那句话由下面「连接」段
    的连接徽标回答（同屏一处事实一个控件）。 */
function statusBadge(p: ProviderView): { cls: string; label: string } | null {
  if (p.status === 'inherit') return null
  if (p.status === 'disabled') return { cls: 'mk-badge--muted', label: '已停用' }
  if (p.status === 'unconfigured') return { cls: 'mk-badge--warn', label: '待配置密钥' }
  return { cls: 'mk-badge--ok', label: '可用' }
}
const headBadge = computed(() => (selected.value ? statusBadge(selected.value) : null))

function cooldownOf(m: ModelLike) {
  return (health.value?.cooldowns ?? []).find((c) => c.model === m.id && c.providerId === selected.value?.id) ?? null
}
function modelWarnings(m: ModelLike): string[] {
  return (health.value?.warnings ?? []).filter((w) => w.includes(`模型「${m.id}」`))
}
/**
 * 状态列里的告警徽标必须自带一句人话（2026-10-24 用户「警告图标是什么」）：
 * 只有 ⚠ 时没人知道该修什么。当前唯一的告警类型是「未被别名引用」，
 * 其它新增类型统一退回「告警」，细节仍在 title 里。
 */
function warningLabel(m: ModelLike): string {
  const ws = modelWarnings(m)
  return ws.length && ws.every((w) => w.includes('未被任何别名引用')) ? '未被引用' : '告警'
}
/** 未配单价 = 成本分析页这个模型的金额会显示「—」，是可在模型编辑高级设置里补的配置缺口 */
const MODEL_GROUPS = [
  { tier: 'chat' as const, label: '对话', hint: '常规教学、工具调用与高频 Skill' },
  { tier: 'reasoning' as const, label: '推理', hint: '长思考与复杂判断' }
]
/** 按用途（对话 / 推理）分组；空组不渲染，单组时也保留组头——它就是这个模型的功能归属 */
const modelGroups = computed(() => {
  const models = selected.value?.models ?? []
  return MODEL_GROUPS
    .map((g) => ({ ...g, models: models.filter((m) => m.tier === g.tier) }))
    .filter((g) => g.models.length > 0)
})
/** 模型能力标签：功能列只列「有没有」，用途由分组行表达，不在此复述 */
function functionTags(m: ModelLike): string[] {
  const tags: string[] = []
  if (m.supportsThinking) tags.push('思考')
  if (m.supportsReasoningEffort) tags.push('推理强度')
  if (m.vision) tags.push('读图')
  return tags
}
/** 列表是一组 role=tab：按 WAI-ARIA 走 roving tabindex + 方向键，避免 N 个供应商占 N 个 Tab 位 */
function onTablistKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const items = orderedProviders.value
  if (!items.length) return
  e.preventDefault()
  const cur = items.findIndex((p) => p.id === selectedId.value)
  const next = e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (cur < 0 ? 0 : (cur + 1) % items.length)
        : (cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length)
  select(items[next].id)
  nextTick(() => {
    const host = e.currentTarget as HTMLElement | null
    host?.querySelector<HTMLElement>(`[data-provider="${items[next].id}"]`)?.focus()
  })
}

function select(id: string): void {
  selectedId.value = id
  /* 切供应商时二级页签归位到「模型」：从平台切到示例供应商再切回来，不该停在上一家的页签 */
  platformTab.value = 'models'
  keyDraft.value = ''
  keyVisible.value = false
  testResults.value = {}
  pulled.value = []
  configureQueue.value = []
  configureTotal.value = 0
}

/** 选中项被删/首次加载后归位：优先当前通道，其次第一个可见供应商。
    停用条目默认收起，选中项若刚被停用也要让位，避免详情停在一个清单里看不到的供应商。 */
function ensureSelection(): void {
  const visible = showDisabled.value ? providers.value : providers.value.filter((p) => p.enabled)
  if (visible.some((p) => p.id === selectedId.value)) return
  const first = visible.find((p) => p.id === 'platform') ?? visible[0]
  selectedId.value = first?.id ?? ''
}
/** 收起已停用时，详情不能停在一个已经不在清单里的供应商 */
watch(showDisabled, () => {
  if (!showDisabled.value) ensureSelection()
})

async function refresh(force = false): Promise<void> {
  if (view.value && !force) return
  loading.value = true
  failed.value = false
  try {
    const [providersRes, registryRes] = await Promise.all([
      adminModelProvidersApi.get(),
      adminModelRegistryHealth()
    ])
    view.value = (providersRes?.data?.data ?? null) as ProvidersView | null
    health.value = registryRes
    ensureSelection()
    emitRegistered()
  } catch (e) {
    failed.value = true
    errorText.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

/**
 * 运行面读数失败不该让整块面板报「读取失败」：它只喂状态列与告警角标，
 * 缺了就按「没有冷却记录」渲染，编辑面照常用。
 */
async function adminModelRegistryHealth(): Promise<RegistryHealth | null> {
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    return (res?.data?.data ?? null) as RegistryHealth | null
  } catch {
    return null
  }
}

/** 写接口统一回吐最新视图：直接换掉本地数据，不再多一次 GET */
function adopt(payload: unknown, warnings: string[]): void {
  const data = (payload as { data?: unknown })?.data ?? payload
  if (data && typeof data === 'object' && 'providers' in (data as object)) {
    view.value = data as ProvidersView
    ensureSelection()
    emitRegistered()
  }
  writeWarnings.value = warnings
  emit('changed')
}

async function toggleEnabled(p: ProviderView, value: boolean): Promise<void> {
  if (!value) {
    const ok = await askConfirm({
      title: `停用通道「${providerName(p)}」`,
      message: `停用后它的 ${p.models.length} 个模型立即退出路由。`,
      confirmText: '停用',
      danger: true,
    })
    if (!ok) return
  }
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.update(p.id, { enabled: value })
    adopt(res?.data, res?.data?.warnings ?? [])
    toast.success(value ? `「${providerName(p)}」已启用` : `「${providerName(p)}」已停用，模型退出路由`)
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function saveKey(p: ProviderView): Promise<void> {
  if (!keyDraft.value.trim()) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.update(p.id, { apiKey: keyDraft.value.trim() })
    adopt(res?.data, res?.data?.warnings ?? [])
    keyDraft.value = ''
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function clearKey(p: ProviderView): Promise<void> {
  const ok = await askConfirm({
    title: '移除已保存的密钥',
    message: `移除「${p.name}」当前保存的密钥后，运行时会回落到服务器环境变量 ${p.apiKeyEnv || '（未配置）'}。若两处都没有，它的模型会直接报错。`,
    confirmText: '移除密钥'
  })
  if (ok !== true) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.removeKey(p.id)
    adopt(res?.data, res?.data?.warnings ?? [])
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function removeProvider(p: ProviderView): Promise<void> {
  const ok = await askConfirm({
    title: `删除通道「${p.name}」`,
    message: `将从模型目录里删掉这条通道和它下面的 ${p.models.length} 个模型，并清除已保存的密钥。删掉后引用这些模型的默认路由与别名会失效（系统会拦下那种情况）。`,
    confirmText: '删除通道'
  })
  if (ok !== true) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.remove(p.id)
    select('')
    adopt(res?.data, res?.data?.warnings ?? [])
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function removeModel(m: ModelLike): Promise<void> {
  const ok = await askConfirm({
    title: `删除模型「${m.id}」`,
    message: '从模型目录里删掉它，此后不再参与路由。若它正被默认路由或别名引用，系统会拦下并说明。',
    confirmText: '删除模型'
  })
  if (ok !== true) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.removeModel(selected.value!.id, m.id)
    adopt(res?.data, res?.data?.warnings ?? [])
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

function onProviderSaved(payload: { providerId: string; warnings: string[] }): void {
  void reloadAfterDialog(payload.providerId, payload.warnings)
}
async function onModelSaved(payload: { modelId: string; warnings: string[] }): Promise<void> {
  const fromQueue = configureQueue.value.length > 0
  if (fromQueue) configureQueue.value = configureQueue.value.filter((id) => id !== payload.modelId)
  await reloadAfterDialog(null, payload.warnings)
  if (fromQueue) openNextConfigure()
}

/**
 * 弹层保存后：写接口的回吐在弹层里被吃掉了，这里重新拉一次视图（唯一需要再拉一次的场景），
 * 并把告警透传到面板顶部。
 */
async function reloadAfterDialog(providerId: string | null, warnings: string[]): Promise<void> {
  if (providerId) selectedId.value = providerId
  await refresh(true)
  writeWarnings.value = warnings
  emit('changed')
}

async function testModel(p: ProviderView, modelId: string): Promise<void> {
  testingId.value = modelId
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.test(p.id, { modelId })
    testResults.value = {
      ...testResults.value,
      [modelId]: { ok: true, latency: `${res?.data?.data?.durationMs ?? 0}ms`, text: res?.data?.data?.content ?? '' }
    }
  } catch (e) {
    testResults.value = { ...testResults.value, [modelId]: { ok: false, latency: '', text: errMsg(e) } }
  } finally {
    testingId.value = ''
  }
}

async function pullModels(p: ProviderView): Promise<void> {
  pulling.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.pullModels(p.id)
    pulled.value = (res?.data?.data?.models ?? []) as string[]
    if (pulled.value.length) openPull()
    else actionError.value = '通道返回了空清单：确认这个服务地址是否提供 /models'
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    pulling.value = false
  }
}

/** 打开拉取结果浮窗：清单只用于勾选，不再在详情里铺开 */
function openPull(): void {
  if (!selected.value) return
  if (!fetchableModels.value.length) {
    actionError.value = '还没有拉取到模型'
    return
  }
  pullDialog.value?.openWith()
}

/** 平台通道同步上游清单后直接弹浮窗；顺便把选中项归位到平台通道 */
function openHostPull(): void {
  if (selectedId.value !== 'platform') select('platform')
  openPull()
}

/** 手动新增：清掉勾选队列，避免保存后误跳到上一个批次的下一个模型 */
function openManualAdd(): void {
  if (!selected.value) return
  configureQueue.value = []
  configureTotal.value = 0
  modelEditor.value?.openWith({ providerId: selected.value.id, model: null })
}

/** 浮窗确认：按勾选顺序逐个打开模型设置，保存一个自动进下一个 */
function startConfigure(ids: string[]): void {
  if (!selected.value || !ids.length) return
  configureQueue.value = [...ids]
  configureTotal.value = ids.length
  openNextConfigure()
}

function openNextConfigure(): void {
  const id = configureQueue.value[0]
  if (!id || !selected.value) {
    configureQueue.value = []
    configureTotal.value = 0
    return
  }
  const step = configureTotal.value > 1
    ? { index: configureTotal.value - configureQueue.value.length + 1, total: configureTotal.value }
    : undefined
  modelEditor.value?.openWith({ providerId: selected.value.id, model: null, presetId: id, step })
}

/** 跳过剩余：队列清空，已保存的模型保持原样 */
function skipRemaining(): void {
  configureQueue.value = []
  configureTotal.value = 0
  modelEditor.value?.close?.()
}

/** 模型弹窗被关掉（取消/ESC/遮罩）：队列没有续接入口，直接清空避免「还剩 N 个」常挂 */
function onEditorClosed(): void {
  configureQueue.value = []
  configureTotal.value = 0
}

/** 非对话模型的去向：基础设施在同页「基础设施模型」卡，生图/决策在插件页 */
function onPullNavigate(target: 'infra' | 'plugins'): void {
  if (target === 'plugins') {
    void router.push('/admin/addons')
    return
  }
  if (selectedId.value !== 'platform') select('platform')
  document.getElementById('ac-infra')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 供应商「设置」：打开注册表编辑弹层（平台通道的按钮已撤，连接表单就在详情下方） */
function openSettings(p: ProviderView): void {
  providerEditor.value?.openWith(p)
}

onMounted(() => {
  void refresh()
})

defineExpose({ refresh, openPull, openHostPull })
</script>

<style scoped>
.mpp-alert { margin: 8px 14px 0; }
.mpp-note {
  margin: 8px 14px 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 2026-10-20 走查：接入页是一张满高工作台——卡片撑满页签剩余高度，左列表 / 右详情各自内滚，
   不在长屏上留出整屏空白（此前卡随内容高度，1920×1080 下方空 300+px）。 */
.mpp { display: flex; flex-direction: column; min-height: 0; }
.mpp-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 0;
  border-top: 1px solid var(--mk-line);
  flex: 1 1 auto;
  min-height: 0;
}
@media (max-width: 900px) {
  .mpp-body { grid-template-columns: minmax(0, 1fr); }
  .mpp-list { border-right: 0; border-bottom: 1px solid var(--mk-line); }
}
.mpp-list {
  padding: 10px;
  border-right: 1px solid var(--mk-line);
  overflow-y: auto;
  min-height: 0;
}
.mpp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border-radius: var(--mk-radius-md);
  cursor: pointer;
}
.mpp-item:hover { background: var(--mk-surface-2); }
.mpp-item--on { background: var(--mk-surface-2); box-shadow: inset 2px 0 0 var(--mk-accent-deep); }
.mpp-item__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--mk-muted);
}
.mpp-item__dot--ready { background: var(--mk-green); }
.mpp-item__dot--unconfigured { background: var(--mk-amber); }
.mpp-item__dot--disabled { background: var(--mk-muted); }
.mpp-item__dot--inherit { background: var(--mk-accent-deep); }
.mpp-item__grow { min-width: 0; flex: 1 1 auto; }
.mpp-item__name { display: block; font-size: var(--mk-fs-body); }
.mpp-item__meta {
  display: block;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mpp-item--off { opacity: 0.72; }
.mpp-show-disabled {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 6px;
  text-align: left;
}
.mpp-detail { padding: 12px 16px 16px; min-width: 0; overflow-y: auto; }
/* 平台详情二级页签（模型 / 连接 / 基础设施 / 生成参数）：页签条下已有分隔线，面板不再自带一条 */
.mpp-subtabs { margin-top: 4px; }
.mpp-detail > .mpp-models { margin-top: 0; padding-top: 0; border-top: 0; }
.mpp-detail > .mpp-infra { margin-top: 0; padding-top: 0; border-top: 0; }
.mpp-detail > .mpp-generation { margin-top: 0; padding-top: 0; border-top: 0; }
.mpp-infra, .mpp-generation { margin-top: 14px; }
/* 连接页签里的 #platform-detail 自带 .mpp-block 节奏（含顶部发丝线），页签下再压一条会双线 */
.mpp-detail > div[role='tabpanel'] > .ac-conn { margin-top: 0; padding-top: 0; border-top: 0; }

/* 详情分区：连接 / 模型清单 / 上游，三块同一套标题 + 发丝线节奏（v4：1px 发丝线分隔） */
.mpp-block { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mk-line); }
.mpp-block:first-of-type { margin-top: 10px; }
.mpp-block__head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.mpp-detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.mpp-detail__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mpp-detail__name { font-size: var(--mk-fs-emphasis); }
.mpp-detail__code { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* 通道类型：平台内置 / 自建通道 */
.mpp-type {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.mpp-type--platform {
  background: color-mix(in srgb, var(--mk-blue) 10%, transparent);
  color: var(--mk-blue);
}
.mpp-detail__acts { display: inline-flex; gap: 6px; }
.mpp-detail__desc {
  margin: 6px 0 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.mpp-endpoint {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
}
.mpp-endpoint__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mpp-endpoint__row + .mpp-endpoint__row { margin-top: 8px; }
.mpp-endpoint__label {
  flex: 0 0 72px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.mpp-endpoint__value { min-width: 0; overflow-wrap: anywhere; font-size: var(--mk-fs-body); }
.mpp-endpoint__key { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.mpp-key-toggle {
  background: none;
  border: 0;
  padding: 2px 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.mpp-endpoint__acts { display: inline-flex; gap: 6px; flex: 0 0 auto; }
.mpp-models { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mk-line); }
.mpp-models__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}
/* 计数与上游清单状态同一行：两个都弱化，动作按钮仍独占右侧 */
.mpp-models__title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; min-width: 0; }
.mpp-models__acts { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.mpp-sec { font-size: var(--mk-fs-body); }
.mpp-sec__count {
  margin-left: 8px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 上游清单已移入 PullModelsDialog（2026-10-24 用户「拉取作为浮窗」），详情区只留已登记模型表 */
.mpp-table { width: 100%; }
.mpp-label {
  margin-left: 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.mpp-desc {
  display: block;
  margin-top: 2px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 模型格承载 id + 显示名 + 最近一次测试结果 */
.mpp-model { min-width: 220px; }
.mpp-model__id { overflow-wrap: anywhere; }
/* 上游模型名：当前版本与本地名相同，后续独立映射后在此显示差异 */
.mpp-upstream .mono { overflow-wrap: anywhere; }
.mpp-rowtest { display: block; margin-top: 2px; color: var(--mk-green); font-size: var(--mk-fs-micro); }
.mpp-rowtest--bad { color: var(--mk-red); }
/* 空模型时的下一步：一句话 + 一个动作，不丢一张只有表头的空表 */
.mpp-setup {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin: 4px 0 12px;
  padding: 12px 14px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
}
.mpp-setup__text { display: grid; gap: 4px; min-width: 0; }
.mpp-setup__text strong { font-size: var(--mk-fs-body); color: var(--mk-ink); }
.mpp-setup__text span { font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); }
/* 功能分组行：一张表里切段（对话 / 推理），组内不再复述用途。
   不覆写内边距：6px 纵向曾把单行小字单元格压到 30px，低于 SPEC §3 的 40px 行高下限
   （SkillReconciliation 同款判例）。跟随 .mk-table td 的档位节奏。 */
.mpp-group td {
  background: var(--mk-surface-2);
  border-top: 1px solid var(--mk-line);
}
.mpp-group__name { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.mpp-group__count { margin-left: 6px; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.mpp-group__hint { margin-left: 10px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 功能列：能力标签；「基础对话」是缺省态，弱化成正文色不抢眼。
   标签允许换行——窄档功能列只有百来像素，nowrap 会把整表宽度顶出去。 */
.mpp-fn { white-space: normal; min-width: 88px; }
.mpp-fn__chip {
  display: inline-block; margin-right: 4px; margin-bottom: 2px; padding: 1px 7px;
  border-radius: 999px; background: var(--mk-blue-bg);
  font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue);
  white-space: nowrap;
}
.mpp-fn__none { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.mpp-rowacts { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.mpp-empty { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mpp-queue {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
</style>
