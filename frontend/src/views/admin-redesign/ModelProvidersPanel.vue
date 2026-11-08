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
       运行面读数（配置漂移告警）另取 GET /admin/model-registry：编辑面只有配置值，
       把「这个模型现在能不能用」也算在这里会让两个接口互相复述。
       2026-11-04 用户「去掉降级这个功能，不要」：备用链与部署冷却随降级整条下线，
       运行面只保留告警徽标。 -->
  <section class="mk-card mpp">
    <!-- 2026-10-27 用户「这个重新设计，可以先放到第三个」：卡头承接通道身份与状态——
         平台通道 + 平台内置 + 连接状态，右侧是写盘状态与本页动作；详情里不再单起一行标题。
         2026-10-28 三卡重构：本卡只负责「对话模型」这一类能力，连接参数仍是平台通道。
         2026-11-04 用户「还是不要左右结构了，把链接做到这个卡片右上角吧」：
         连接从独立左栏挪进卡头右组——卡片恢复单列（模型清单独占整卡宽度），
         「这条通道接在哪」与「这张卡是什么」同处一行，右边就是它接的地址与密钥状态。
         2026-11-04 用户「对话与推理模型是不是换个标准名字好点」：卡题改「对话模型」，
         与「向量模型 / 重排模型」同一套角色命名；「推理」不再是一类模型。 -->
    <div class="mk-card__head">
      <div class="mpp-head__id">
        <h3 class="mk-card__title">对话模型</h3>
        <span class="mpp-type mpp-type--platform" :title="registryPathTitle">LLM</span>
        <!-- 宿主注入的连接状态（「连接正常 · N 前」）：与通道身份同一行 -->
        <slot v-if="selected" name="head-status" />
        <span v-if="headBadge" class="mk-badge" :class="headBadge.cls">{{ headBadge.label }}</span>
      </div>
      <div class="mk-card__head-right mpp-head__conn">
        <button v-if="registry?.readOnly" type="button" class="mk-btn mk-btn--sm mk-btn--danger" disabled title="当前为只读状态，无法在本页修改，请让部署人员开放写权限">
          只读
        </button>
        <!-- 2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
             卡头右组只剩这一颗按钮。连接（地址 / 密钥 / 重试 / RPM / 重置此通道）
             与上游模型清单一并收进弹窗——此前是「连接设置」与「添加模型」两个入口，
             填地址、拉清单、挑模型本来是同一件事，却要分三处点。 -->
        <button
          v-if="selected"
          type="button"
          class="mk-btn mk-btn--sm mk-btn--primary mpp-add"
          :disabled="busy || registry?.readOnly"
          :title="pullAddTitle"
          @click="onPullAdd"
        >＋ 添加模型</button>
      </div>
    </div>

    <div v-if="actionError" class="mk-alert mk-alert--row mpp-alert" role="alert">
      <span class="mk-alert__msg">{{ actionError }}</span>
      <button type="button" class="mk-alert__btn" @click="actionError = ''">知道了</button>
    </div>
    <div v-for="(w, i) in writeWarnings" :key="`w-${i}`" class="mk-alert mk-alert--row mpp-alert" role="status">
      <span class="mk-alert__msg">{{ w }}</span>
    </div>
    <p v-if="registry?.readOnly" class="mpp-note">
      当前为只读状态，只能查看。请让部署人员开放写权限后再编辑。
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
      <!-- 单列（2026-11-04 用户「还是不要左右结构了，把链接做到这个卡片右上角吧」）：
           连接搬进卡头右组之后，正文只剩一块——模型清单，独占整卡宽度。
           此前是两栏（左连接 / 右列表），连接被拎成 300px 的独立左栏、模型表被挤到 995px 里；
           用户不需要这条通道接在哪与挂了哪些模型分成两竖列并排看，连接已上移到卡片右上，
           正文这一段回到「一张清单」的本来形态。 -->
      <template v-if="selected">
        <section id="mpp-platform-panel-models" class="mpp-models">
          <!-- 上游异常（获取失败 / 有未保存清单）与卡头徽标同源，跟着列表一起看 -->
          <slot name="models-meta" />

          <!-- 空模型时的下一步（2026-10-28 新人视角）：不丢一张空表，直接说清先做什么。
               2026-11-05 合并弹窗后，连接与模型清单在同一处，「去配置连接」不再指向卡头，
               而是直接把那张弹窗打开。 -->
          <div v-if="selected.enabled && !selected.models.length" class="mpp-setup">
            <div class="mpp-setup__text">
              <strong>还没有挂载模型</strong>
              <span>点「＋ 添加模型」填服务地址与密钥、拉到上游清单，再勾要挂的模型。手动录入在弹窗底部。</span>
            </div>
            <button
              type="button"
              class="mk-btn mk-btn--sm"
              :disabled="busy || registry?.readOnly"
              @click="onPullAdd"
            >添加模型</button>
          </div>

          <!-- 对话模型列表（2026-10-28 用户「喜欢下面的设计」）：与向量 / 重排区同一套
               「身份 + 状态 + 行内动作」语言，不用带列头的表格。
               2026-11-03：每行补一行参数摘要——行里必须看得见配了什么，
               否则「配置」仍是一枚通向未知的按钮。 -->
          <div v-if="selected.models.length" class="mpp-models__list">
            <div v-for="m in selected.models" :key="m.id" class="mpp-model-row">
              <div class="mpp-model-row__main">
                <div class="mpp-model-row__idline">
                  <span class="mono mpp-model-row__id" :title="m.id">{{ m.id }}</span>
                  <!-- 平台默认（P0 2026-11-04）：这一枚就是「没单独配的 Skill 走哪个」的答案，
                       与下面「设为默认」动作同源。缺省时谁都没标，「默认：未设置」在工具栏顶部兜底。
                       2026-11-05 用户「右侧 pill 优化一下」：改实心主色——整行只有它是「被选中的」，
                       颜色要压得住右边的能力胶囊（两者此前都是蓝 tint 底，实测 rgba .18 / .16，看不出差别）。 -->
                  <span
                    v-if="isDefaultModel(m)"
                    class="mk-badge mpp-default-chip"
                    title="平台当前默认，未单独配模型的 Skill 都继承它"
                  >默认</span>
                  <span v-for="tag in functionTags(m)" :key="tag" class="mk-badge mk-badge--muted mpp-fn__chip">{{ tag }}</span>
                </div>
                <!-- 测试结果是这一行的第二行读数，与 id 行同一左缘、不占动作列
                     （2026-11-05 用户「调用通过确实还是换行好看一些」）：
                     判词带色，时延退成弱色——一条读数里只有「通过 / 失败」是结论。 -->
                <span
                  v-if="testResults[m.id]"
                  class="mk-rowres"
                  :class="{ 'mk-rowres--bad': !testResults[m.id].ok }"
                  :title="testResults[m.id].text"
                ><span class="mk-rowres__verdict">{{ testResults[m.id].ok ? '调用通过' : '调用失败' }}</span><span
                  v-if="testResults[m.id].latency"
                  class="mk-rowres__meta"
                >· {{ testResults[m.id].latency }}</span></span>
                <!-- 2026-11-04 用户「不要这种文案，上『Avoid unnecessary secondary labels and
                     descriptions. Let the layout do the explaining.』」：每行原有的参数摘要
                     （默认输出 / 输出上限 / 并发 / 已配单价）整行撤除——它在 配置 弹层里，
                     行上只要 id、能力标签与动作；没配参数的模型也不再写「参数全部跟随默认」。 -->
              </div>
              <!-- 2026-11-05 用户「这个小绿点代表什么」：那枚「当前可被选中调用」的小圆点删掉。
                   它是**无条件渲染**的——2026-11-04 撤掉冷却徽标后条件那一侧就没了，
                   于是每一行都亮着同一枚点，含义退化成「这一行存在」，等于没有信息。
                   状态格此后只在真有告警时出现，没有告警就整格不渲染。 -->
              <div v-if="modelWarnings(m).length" class="mpp-model-row__status">
                <span class="mk-badge mk-badge--warn mpp-label" :title="modelWarnings(m).join('\n')">⚠ {{ warningLabel(m) }}</span>
              </div>
              <div class="mpp-rowacts">
                <!-- 2026-11-07 用户「设置为默认从 ⋯ 里提出来」：行内四枚平铺，
                     不用先点 ⋯ 再猜里面有什么。已是默认的那一行不渲染「设为默认」——
                     它此刻无动作可做，禁用一枚不能点的链接只会制造噪音。 -->
                <button
                  v-if="!isDefaultModel(m)"
                  type="button"
                  class="mk-link"
                  :disabled="busy || registry?.readOnly"
                  title="没单独指定模型的 Skill 都走这个模型"
                  @click="requestDefault(m)"
                >设为默认</button>
                <button
                  type="button"
                  class="mk-link"
                  :disabled="busy || registry?.readOnly"
                  title="配置这个模型的生成参数、能力、限额与价格"
                  @click="modelEditor?.openWith({ providerId: selected.id, model: m })"
                >配置</button>
                <button type="button" class="mk-link mk-link--hold mk-link--hold-test" :disabled="testingId === m.id" @click="testModel(selected, m.id)">{{ testingId === m.id ? '测试中…' : '测试' }}</button>
                <!-- 删除（不可撤销）与上面三枚拉开一段距离（准则 2 防误触）。
                     被任一「默认模型」写源引用就置灰：后端必然会拒绝（默认指向已删模型 =
                     对应路由落空），不该让用户在确认弹窗里走完一遍才被告知。 -->
                <button
                  type="button"
                  class="mk-link mk-link--danger mpp-rowacts__danger"
                  :disabled="busy || registry?.readOnly || !!defaultRefOf(m)"
                  :title="defaultRefOf(m) ? `${defaultRefOf(m)}，请先把那一处默认模型改到别的模型再删除` : '删除这个模型'"
                  :aria-label="defaultRefOf(m) ? `删除 ${m.id}（正被${defaultRefOf(m)}引用，需先改默认）` : `删除 ${m.id}`"
                  @click="removeModel(m)"
                >删除</button>
              </div>
            </div>
          </div>
          <p v-if="!selected.enabled" class="mpp-empty">
            这条通道已停用，其中的模型不会被调用。
          </p>
        </section>
      </template>
      <MkEmptyState v-else compact title="还没有接入通道" />
    </div>

    <PullModelsDialog
      ref="pullDialog"
      :provider-id="selected?.id ?? ''"
      :models="fetchableModels"
      :registered="[...registeredIds]"
      :loading="pullLoading"
      :error="pullError"
      :stale="pullStale"
      :allow-manual="!registry?.readOnly"
      @confirm="addSelected"
      @manual="openManualAdd"
      @refetch="emit('fetchUpstream', 'refetch')"
    >
      <!-- 2026-11-07 连接配置提回页顶（用户「提回去」）：本面板不再往弹窗里透传
           连接段——一处事实一个控件，连接只属于页顶那张「服务连接」卡。 -->
    </PullModelsDialog>
    <ModelEditorDialog ref="modelEditor" @saved="onModelSaved" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminApiConfigApi, adminModelProvidersApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import ModelEditorDialog, { type ModelLike } from './ModelEditorDialog.vue'
import PullModelsDialog from './PullModelsDialog.vue'
import { inferModelCapabilities } from './modelCapabilityInference'
import { normalizeEfforts } from './reasoningEfforts'
import { askConfirm } from './useConfirm'
import { errMsg } from './live'
import { toast } from '@/utils/toast'

/** 注册表编辑视图（后端 services/admin/model-providers.service.ts 的 ProviderRegistryView） */
interface ProviderView {
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
/** 运行面读数（GET /admin/model-registry 的子集）：告警 + 文件默认（删除守卫的第二处写源） */
interface RegistryHealth {
  models: Array<{ id: string; providerId: string }>
  warnings: string[]
  registry?: { fileDefaults?: { chat: string; reasoning: string } }
}

const props = withDefaults(defineProps<{
  /** 上游模型清单（宿主连接设置里拉到的，平台通道用） */
  upstream?: string[]
  /** 平台默认模型：没单独指定模型的 Skill 都走它。空 = 未设置，运行时不可用。
      平台只有这一个默认（2026-11-04 用户「为什么还在区分默认推理和对话，没有这个了」）。 */
  defaultModel?: string
  /** 上游清单正在拉取（宿主在执行「获取模型」）：弹窗列表区给进度 */
  pullLoading?: boolean
  /** 上一次拉取失败的人话原因（弹窗里清单空时显示） */
  pullError?: string
  /** 连接在清单之后被改过：清单过期，先重拉再选 */
  pullStale?: boolean
}>(), {
  upstream: () => [],
  defaultModel: '',
  pullLoading: false,
  pullError: '',
  pullStale: false,
})

const emit = defineEmits<{
  /** 注册表被改动（增删改）→ 宿主决定是否重取别名/默认解析 */
  changed: []
  /** 已登记的模型 id（宿主用它算「上游还有几个没登记」的关系句，避免两处各算一遍） */
  registered: [ids: string[]]
  /** 平台通道已挂载的模型 id（只这一条通道，不含停用示例供应商）：宿主据此种/校正平台默认 */
  platformModels: [ids: string[]]
  /** ③ 点「添加模型」时清单还没拉过：请宿主先做 ②（拉取 + 落盘连接，成功后宿主会开勾选浮窗）。
      这条把原先「静默转手动录入」的死路补成一步可预期的动作。 */
  /** open = 打开弹窗时顺带拉的一次（只读）；refetch = 用户点「获取模型 / 重新获取」 */
  fetchUpstream: [source: 'open' | 'refetch']
  /** 设为平台默认（P0）：默认模型存 DB platform_api_configs，不在注册表文件里，
      所以本面板只发意图，由宿主（持有 live 配置）落盘。平台只有一个默认——推理与否
      由 Skill 的思考模式 / 推理强度决定，不由换模型决定。 */
  setDefault: [modelId: string]
  /** 模型被删除后通知宿主：若删的正是平台默认，宿主负责改指到下一个可用模型，
      否则默认会指向一个已不存在的 id（运行时同样报错）。 */
  removeModel: [modelId: string]
}>()

const view = ref<ProvidersView | null>(null)
const health = ref<RegistryHealth | null>(null)
const loading = ref(false)
const failed = ref(false)
const errorText = ref('')
const busy = ref(false)
const actionError = ref('')
const writeWarnings = ref<string[]>([])
const testingId = ref('')
/** 单模型测试结果（按模型 id 落在行内，不再用卡上方一条全局结果条） */
const testResults = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
/** 行内 ⋯ 菜单（低频/危险操作）：与公告、账号、虚拟学习者同一套实现 */

const modelEditor = ref<InstanceType<typeof ModelEditorDialog> | null>(null)
const pullDialog = ref<InstanceType<typeof PullModelsDialog> | null>(null)

const providers = computed(() => view.value?.providers ?? [])
/** 目录文件状态（路径/可写/最近一次热重载错误）：模板里多处按它决定是否禁用编辑 */
const registry = computed(() => view.value?.registry ?? null)
/** 这一页只呈现平台通道（2026-10-27 用户「这个区域不要了」）：自建通道不再在页面里切换 */
const selected = computed(() => providers.value.find((p) => p.id === 'platform') ?? null)

/* 2026-10-21 用户「不要了」：卡头不再挂数据来源 / 生效方式；路径与最近错误进 LLM 徽标 title */
const registryPathTitle = computed(() => {
  const r = view.value?.registry
  if (!r) return ''
  const parts = [`配置文件：${r.path}`]
  if (r.lastError) parts.push(`最近更新失败：${r.lastError}`)
  return parts.join('\n')
})

const registeredIds = computed(() => new Set(selected.value?.models.map((m) => m.id) ?? []))
/** 上游模型清单：平台通道的清单来自连接设置（宿主注入）。只喂「添加模型」的勾选浮窗——
    页面上不再单独出「已获取 N 个」的读数（2026-11-04 用户「上游清单这个我不太想要了」）。 */
const fetchableModels = computed(() => props.upstream)
/** 添加入口的悬停全文：它自带「先拉清单」这一步（这条暗规则写在按钮上，不藏） */
const pullAddTitle = '按当前服务地址与密钥向上游拉取模型清单，拉到后勾选要挂载的模型'

/* ---------- 平台默认模型（P0 2026-11-04） ---------- */
/** 行内「默认」徽章的判据：平台默认就是这个模型（只认运行时那个源 = DB） */
function isDefaultModel(m: ModelLike): boolean {
  return !!props.defaultModel && m.id === props.defaultModel
}
/**
 * 删除守卫的「这个模型被哪一处默认引用」（空串 = 可以删）。判据必须与后端 deleteModel 一致。
 *
 * - **注册表文件 `defaults.chat/reasoning`**：后端会拒（它删掉文件自身就不自洽，selfCheck 也过不去），
 *   所以这里置灰，别让用户走完确认弹窗才被告知。
 * - **平台 DB 默认（这个模型的「默认」徽章判据）有意不挡**：后端 #177（2026-11-05）下线了
 *   「运行期引用门禁」一族，DB 默认是可修复的——删完 onModelRemoved 会把默认改指下一个已挂载模型。
 *   此前这里连 DB 默认一起置灰，等于把 #177 决定允许、且下面已经写好修复流程的动作又锁死，
 *   而且提示语指向错的源（说「请先将其他模型设为默认」，用户照着做也解不开文件那一处）。
 *
 * 数据来自本面板已拉取的 `/admin/model-registry`（`registry.fileDefaults`），不加请求。
 */
function defaultRefOf(m: ModelLike): string {
  const fd = health.value?.registry?.fileDefaults
  if (fd && (m.id === fd.chat || m.id === fd.reasoning)) return '注册表文件里的默认模型'
  return ''
}
/** 「设为默认」只发意图：默认模型存 DB，由持有 live 配置的宿主落盘 */
function requestDefault(m: ModelLike): void {
  emit('setDefault', m.id)
}

/** 已登记模型 id 回传宿主（上游清单的关系句由宿主渲染，数据同源一次算） */
function emitRegistered(): void {
  emit('registered', providers.value.flatMap((p) => p.models.map((m) => m.id)))
  /* 平台默认只能选平台通道上的模型：`registered` 是全部供应商的并集（含停用的示例条目），
     拿它当默认候选会把默认指到别的通道去，所以单独回传这一条通道的清单。 */
  emit('platformModels', selected.value?.models.map((m) => m.id) ?? [])
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
/** 模型能力标签：能力列只列「有没有」，类型不在这张表里猜。
 *  推理强度带档位读数（2026-11-05）：一台模型认哪几档是它自己的事，
 *  只写「推理强度」看不出这台模型到底能发 low 还是 max。 */
function functionTags(m: ModelLike): string[] {
  const tags: string[] = []
  if (m.supportsThinking) tags.push('思考')
  if (m.reasoningEfforts.length) tags.push(`推理强度 ${m.reasoningEfforts.join(' / ')}`)
  if (m.vision) tags.push('视觉')
  return tags
}
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
 * 缺了就按「没有告警」渲染，编辑面照常用。
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
    emitRegistered()
  }
  writeWarnings.value = warnings
  emit('changed')
}

async function removeModel(m: ModelLike): Promise<void> {
  const ok = await askConfirm({
    title: `删除模型「${m.id}」`,
    message: '删除后它不再参与模型调用。若它仍被别名引用，系统会拦下并提示。',
    confirmText: '删除模型'
  })
  if (ok !== true) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.removeModel(selected.value!.id, m.id)
    adopt(res?.data, res?.data?.warnings ?? [])
    // 通知宿主：删的若正是平台默认，宿主改指下一个可用模型（默认不能指向已删的 id）
    emit('removeModel', m.id)
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function onModelSaved(payload: { modelId: string; warnings: string[] }): Promise<void> {
  await reloadAfterDialog(payload.warnings)
}

/**
 * 弹层保存后：写接口的回吐在弹层里被吃掉了，这里重新拉一次视图（唯一需要再拉一次的场景），
 * 并把告警透传到面板顶部。
 */
async function reloadAfterDialog(warnings: string[]): Promise<void> {
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

/** ③ 入口一「从上游清单添加」：清单拉过就开勾选浮窗；没拉过就先把 ② 做掉
    （宿主拉取 → 落盘连接 → 成功后宿主自己开浮窗）。这条次序写在按钮悬停里，不藏。 */
/**
 * 「＋ 添加模型」（2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」）：
 * 这一枚就是添加模型的**唯一入口**，打开的是「连接 + 上游清单」同一张弹窗。
 * 每次打开都先向上游拉一份新清单（上游新增的模型要能立刻看到）；拉取由宿主做——
 * 它持有地址与密钥。**这次拉取只读**：不写连接、不弹成功提示（2026-11-05 用户
 * 「为什么每次点开添加模型右上角会这样」）；要落盘连接得用户自己点「获取模型 / 重新获取」。
 */
function onPullAdd(): void {
  if (!selected.value) return
  pullDialog.value?.openWith()
  emit('fetchUpstream', 'open')
}

/** 打开弹窗（清单只用于勾选，不在详情里铺开）。
    已经没有「清单还没拉就不能开」这条限制：连接段就在弹窗里，空清单也能填地址重拉。 */
function openPull(): void {
  if (!selected.value) return
  if (pullDialog.value?.isOpen?.()) return
  pullDialog.value?.openWith()
}

/** 宿主拉完清单后开弹窗。
    2026-11-04：上游返回 0 个模型也开——手动录入只剩弹窗底栏这一处，不开窗就等于
    「清单里没有」没有出口；空清单的说明由弹窗自己给（「这次没有拉取到模型」）。
    2026-11-05：弹窗多半已经开着（入口就在弹窗里），此时只换清单不重开——
    重开会把用户已经勾上的选择清掉。 */
function openHostPull(): void {
  if (!selected.value) return
  if (pullDialog.value?.isOpen?.()) return
  pullDialog.value?.openWith()
}

/** 手动新增（选择器底部的兜底通道） */
function openManualAdd(): void {
  if (!selected.value) return
  modelEditor.value?.openWith({ providerId: selected.value.id, model: null })
}

/**
 * 勾选即引入（2026-11-07 用户「砍掉」二层「确认模型能力」弹窗）。
 *
 * 历史：2026-11-04 曾要求「让用户自己去勾选能力」，于是引入前多一层核对弹窗。
 * 实测那次点击的收益远小于成本——弹窗本体是四列表格 + 一个手敲档位的输入框，
 * 与「配置」里那套胶囊选择器还不是同一种语言；而真正要调能力的人本来就会去点「配置」。
 * 现在按模型名预判的能力**直接入库**，一次点击完成引入；要精修就去行内「配置」。
 *
 * 风险已知并接受：supportsThinking / reasoningEfforts / vision 是运行时的硬闸门，
 * 预判错了不会立刻报错（会在带图 / 带思考参数的调用上才暴露）。缓解手段是引入时的
 * toast 明说「按模型名预判」，且每行都有「配置」可当场改。
 */
function inferredCapabilities(ids: string[]): Array<{
  id: string
  supportsThinking: boolean
  reasoningEfforts: string[]
  vision: boolean
}> {
  return ids.map((id) => {
    const inf = inferModelCapabilities(id)
    return {
      id,
      supportsThinking: inf.supportsThinking,
      // 没开思考的模型不该带着档位落盘（后端会拒）
      reasoningEfforts: inf.supportsThinking ? normalizeEfforts(inf.reasoningEfforts) : [],
      vision: inf.vision,
    }
  })
}

/** 批量引入：能力按模型名预判后直接写入，不再有第二层确认 */
async function addSelected(ids: string[]): Promise<void> {
  if (!selected.value || !ids.length) return
  const models = inferredCapabilities(ids)
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.addModels(selected.value.id, models)
    adopt(res?.data, res?.data?.warnings ?? [])
    toast.success(`已引入 ${models.length} 个模型（能力按模型名预判，可在「配置」里调整）`)
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refresh()
})

defineExpose({ refresh, openPull, openHostPull, openAdd: onPullAdd })
</script>

<style scoped>
/* 卡片两侧统一 16px 槽（与 .mk-card__head 的 padding 一致）：告警条、说明行、
   四步正文都从这个槽开始，正文不再顶着卡片边框 */
.mpp-alert { margin: 8px 16px 0; }
.mpp-note {
  margin: 8px 16px 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 2026-10-27 用户「这个区域不要了」：左栏通道清单撤掉后，详情独占整卡宽度。
   2026-10-28 用户「两个卡片合成一个卡片」：接入与模型清单同卡，卡片按内容自然撑高。
   2026-11-04 用户「还是不要左右结构了，把链接做到这个卡片右上角吧」：连接上移卡头右组后，
   正文回到单列——只有模型清单一块，独占整卡宽度。 */
.mpp { display: flex; flex-direction: column; flex: none; }
.mpp-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  border-top: 1px solid var(--mk-line);
  padding: 14px 16px 18px;
  flex: 1 1 auto;
  min-height: 0;
}
/* 卡头右组：只剩「只读」与「＋ 添加模型」两颗按钮。连接块已经不在这里——
   2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」后，
   连接整段搬进了那张弹窗，右组只负责不被压扁、窄屏可折行。 */
.mpp-head__conn { flex-wrap: wrap; justify-content: flex-end; min-width: 0; }

.mpp-models { display: grid; gap: 10px; min-width: 0; }
/* 卡头左组：通道名 + 类型 + 连接状态（2026-10-27 由详情头并入卡头） */
.mpp-head__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
/* 通道类型：平台内置 / 自建通道 */
.mpp-type {
  padding: 1px 7px;
  border-radius: var(--mk-radius-sm);
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
.mpp-label {
  margin-left: 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 对话模型列表：与向量 / 重排配置区同一套「身份 + 状态 + 行内动作」语言，不用列头表格 */
/* 行悬停通栏到卡片内缘、行内文字回到槽内：列表 −16px + 行 16px（2026-11-04 回到单列后又适用两侧）。 */
.mpp-models__list { display: grid; margin: 0 -16px; }
.mpp-model-row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 9px 16px;
  border-bottom: 1px solid var(--mk-line);
  transition: background 0.12s var(--mk-ease-out);
}
/* 悬停整行高亮（2026-11-03 评审）：行内左侧是模型名、右端是「测试 / 编辑 / ⋯」，
   通栏后中间隔着大片空白，鼠标不跟着走就极易串行点错。分隔线之下再给一条行底。 */
.mpp-model-row:hover { background: var(--mk-table-row-hover-bg); }
.mpp-model-row:last-child { border-bottom: 0; }
/* 菜单打开时给所属行留底（2026-11-02 评审）：菜单浮在行与行之间，
   没有行高亮就分不清它是从哪一行的 ⋯ 打开的 */
.mpp-model-row__main { display: grid; gap: 3px; min-width: 0; flex: 1 1 auto; }
.mpp-model-row__idline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
/* 名称列定宽：能力胶囊因此各行同一起点，不再随模型名长短而参差（2026-11-03 评审）。
   更长的 id 走省略号 + title，不再把后面的胶囊推着走。 */
.mpp-model-row__id { width: 240px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-model-row__status { display: inline-flex; align-items: center; gap: 6px; flex: none; }
/* 空模型时的下一步：一句话 + 一个动作，不丢一张只有表头的空表 */
.mpp-setup {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
}
.mpp-setup__text { display: grid; gap: 4px; min-width: 0; }
.mpp-setup__text strong { font-size: var(--mk-fs-body); color: var(--mk-ink); }
.mpp-setup__text span { font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); }
/* 能力标签：跟在模型 ID 后面；没有额外能力时留空，不写占位文案 */
/* 能力胶囊（2026-11-05 用户「右侧 pill 优化一下」）：中性灰底弱字，整行退到二线。
   与「默认」分家——那是「这一台正在被用」（状态），这是「这一台会什么」（能力）。
   间距不再自己加 margin-right：行容器 .mpp-model-row__idline 已有 8px gap，
   再叠一个 margin 会让「id→默认」是 8px、「默认→能力」是 14px（实测），同一行两种间距。 */
.mpp-fn__chip { font-weight: 600; }
/* 默认徽章：实心主色 + 白字，全行唯一高亮。
   不用 --mk-blue 当底：它在暗色档被有意提亮成 #5b8def，白字只有 3.23:1
   （与 .mk-btn--primary 同款坑，见 mk-primitives.css:1631）。 */
.mpp-default-chip { background: var(--mk-blue-fill, #2f6ae0); color: var(--mk-on-fill); }
.mpp-rowacts { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
/* 删除与上面三枚之间多留一段空白：不可撤销动作不贴着高频正向动作放（准则 2 防误触） */
.mpp-rowacts__danger { margin-left: 12px; }
.mpp-empty { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
</style>
