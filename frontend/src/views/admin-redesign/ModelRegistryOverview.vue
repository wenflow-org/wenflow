<template>
  <div class="ac-tab-body">
    <!-- 错误态统一走 MkEmptyState tone=error（批24；原行内 mk-alert 自拼重试钮） -->
    <MkEmptyState
      v-if="failed"
      tone="error"
      title="模型总览加载失败"
      :description="errorText"
      action-text="重试"
      @action="refresh(true)"
    />

    <MkLoading v-else-if="!data" inline text="加载中…" />

    <template v-else>
      <!-- 分区卡（批24；2026-10-15 用户重组）：默认路由解析结果改为宿主行内展示（「所配即所得」），
           部署冷却落进限额表「状态」列、配置提示落进行级徽标 + 表尾注——三个尾巴分区随之退役 -->
      <section class="mk-card">

        <!-- ② 别名映射：一处切换的落点 -->
        <section v-if="shows('aliases')" class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">别名映射</h3>
          </div>
          <div class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead>
                <tr><th>别名</th><th>候选来源</th><th>候选模型（按序）</th><th>默认选中</th><th>需要思考时</th></tr>
              </thead>
              <tbody>
                <tr v-for="alias in data.aliases" :key="alias.alias">
                  <td class="mono">{{ alias.alias }}</td>
                  <td>
                    <span class="mk-badge" :class="alias.source === 'db-override' ? 'mk-badge--warn' : 'mk-badge--muted'">
                      {{ alias.source === 'db-override' ? '界面覆盖' : '内置默认' }}
                    </span>
                  </td>
                  <td class="mono">{{ alias.members.length ? alias.members.join(' → ') : '（无可用模型）' }}</td>
                  <td class="mono">
                    <template v-if="alias.selected">{{ alias.selected }}</template>
                    <span v-else class="mk-na">—</span>
                  </td>
                  <td>
                    <span v-if="alias.selectedWhenRequiringThinking" class="mono">{{ alias.selectedWhenRequiringThinking }}</span>
                    <span v-else class="mk-na">—</span>
                    <span v-if="alias.degradedWhenRequiringThinking" class="mk-badge mk-badge--warn ac-mr-badge" title="候选模型都不支持思考，已退回该别名的第一个模型。发起请求时会自动去掉思考参数">降级</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="data.aliases.some((a) => a.dbMembers)" class="ac-mr-note" title="这些别名以界面配置为准">
            界面覆盖的别名：
            <span v-for="alias in data.aliases.filter((a) => a.dbMembers)" :key="`db-${alias.alias}`" class="mono ac-mr-note__item">
              {{ alias.alias }} = {{ alias.dbMembers?.join(', ') }}
            </span>
          </p>
        </section>

        <!-- ② 模型供应商与能力限额（2026-10-15 用户拍板合并）：原「模型供应商」列表与
             「模型能力与限额」表同源于 llm-providers.json，并排铺开被读成「一份文件说两遍」。
             现按文件的真实层级合成一块：供应商=组头，其模型=组内能力行。 -->
        <section v-if="shows('providers')" class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">模型供应商与能力限额</h3>
            <span class="mk-card__meta">
              只读
            </span>
          </div>
          <p v-if="data.registry?.source === 'embedded-fallback'" class="ac-mr-note">
            未读到配置文件，当前为内置默认目录：{{ data.registry?.path }}
          </p>
          <p v-else-if="data.registry?.lastError" class="ac-mr-note" :title="data.registry?.lastError">
            最近一次更新失败，仍在使用上一次可用的模型目录。
          </p>
          <div v-if="providerGroups.length" class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead>
                <tr>
                  <th>模型</th><th>状态</th><th>档位</th><th>思考</th><th>推理强度</th>
                  <th>输出上限</th><th>默认输出</th><th>推理预留</th><th>并发上限</th><th>备用模型</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="g in providerGroups" :key="g.id">
                  <!-- 组头：供应商行（原「模型供应商」列表行形态；38px 方块徽标 + 名/用途 + id/承载/端点 + 状态徽标） -->
                  <tr class="ac-mr-pgroup">
                    <td colspan="10">
                      <div class="ac-mr-mrow ac-mr-mrow--flat">
                        <span class="ac-mr-mrow__badge" aria-hidden="true">{{ g.badge }}</span>
                        <div class="ac-mr-mrow__grow">
                          <div class="ac-mr-mrow__t">
                            <span class="ac-mr-mrow__name" :title="g.name">{{ g.name }}</span>
                            <span v-if="g.description" class="ac-mr-mrow__kind" :title="g.description">· {{ g.description }}</span>
                          </div>
                          <div class="ac-mr-mrow__d">
                            <span class="mono">{{ g.id }}</span>
                            <span class="ac-mr-mrow__sep">·</span>
                            <span>承载 {{ g.declaredCount }} 个模型</span>
                            <template v-if="g.endpointSource === 'own'">
                              <span class="ac-mr-mrow__sep">·</span>
                              <span class="mono">{{ g.baseUrl }}</span>
                              <span class="ac-mr-mrow__sep">·</span>
                              <span>密钥{{ g.keyConfigured ? '已配置' : '未配置' }}</span>
                            </template>
                            <template v-else>
                              <span class="ac-mr-mrow__sep">·</span>
                              <span>沿用平台连接配置</span>
                            </template>
                          </div>
                        </div>
                        <span class="mk-badge ac-mr-mrow__state" :class="g.state.cls">{{ g.state.label }}</span>
                      </div>
                    </td>
                  </tr>
                  <!-- 组内模型能力行 -->
                  <tr v-for="model in g.models" :key="model.id" class="ac-mr-mmodel">
                    <td>
                      <span class="mono">{{ model.id }}</span>
                      <span class="ac-mr-label">{{ model.label }}</span>
                    </td>
                    <td>
                      <span v-if="cooldownOf(model)" class="mk-badge mk-badge--warn" :title="`该部署已触发熔断冷却，降级时会被跳过（剩余 ${Math.ceil(cooldownOf(model)!.remainingMs / 1000)}s）`">
                        ⏳ 冷却中（剩余 {{ Math.ceil(cooldownOf(model)!.remainingMs / 1000) }}s）
                      </span>
                      <span v-else class="mk-badge mk-badge--ok" title="该部署无冷却记录">● 健康</span>
                      <span
                        v-if="modelWarnings(model).length"
                        class="mk-badge mk-badge--warn ac-mr-rowwarn"
                        :title="modelWarnings(model).join('\n')"
                      >⚠</span>
                    </td>
                    <!-- 档位列：表头有「档位」而此前缺这一格，整行会右移、数值与标签错配 -->
                    <td>
                      <span v-if="model.tier" class="mk-badge mk-badge--muted">{{ model.tier }}</span>
                      <span v-else class="mk-na">—</span>
                    </td>
                    <td>
                      <span class="mk-badge" :class="model.capabilities.supportsThinking ? 'mk-badge--ok' : 'mk-badge--muted'">
                        {{ model.capabilities.supportsThinking ? '支持' : '不支持' }}
                      </span>
                    </td>
                    <td>
                      <span v-if="model.capabilities.supportsReasoningEffort">支持</span>
                      <span v-else class="mk-na">—</span>
                    </td>
                    <td class="mono">
                      <template v-if="model.limits.maxOutputTokens != null">{{ model.limits.maxOutputTokens }}</template>
                      <span v-else class="mk-na">—</span>
                    </td>
                    <td class="mono">
                      <template v-if="model.limits.defaultMaxTokens != null">{{ model.limits.defaultMaxTokens }}</template>
                      <span v-else class="mk-na">—</span>
                    </td>
                    <td class="mono">
                      <template v-if="model.limits.reasoningReserveTokens != null">{{ model.limits.reasoningReserveTokens }}</template>
                      <span v-else class="mk-na">—</span>
                    </td>
                    <td class="mono">{{ model.limits.maxParallelRequests ?? '不限' }}</td>
                    <td class="mono">
                      <template v-if="model.fallbacks.length">
                        {{ effectiveFallbacks(model.fallbacks).join(' → ') }}
                        <span
                          v-if="model.fallbacks.length > effectiveFallbacks(model.fallbacks).length"
                          class="ac-mr-label"
                          title="运行时最多使用主模型加 1 个备用模型，声明的备用再长也只生效前段"
                        >(声明 {{ model.fallbacks.length }} 个，实际生效 {{ effectiveFallbacks(model.fallbacks).length }} 个)</span>
                      </template>
                      <template v-else>—</template>
                    </td>
                  </tr>
                  <!-- 该供应商没有参与路由的模型（停用条目 / 未登记）：一行说明，不留空组 -->
                  <tr v-if="!g.models.length" class="ac-mr-pempty">
                    <td colspan="10">
                      {{ g.enabled ? '该供应商下暂无已登记的模型。' : '该供应商当前停用，其模型不参与路由。' }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <!-- 空态给出口（R6D）：目录只读，接入配置（服务地址 / 密钥 / 模型清单）在
               「模型与接入 → 接入与模型」页签，就地给跳转，不再只留一句说明 -->
          <MkEmptyState
            v-else
            compact
            title="模型目录中没有登记供应商，编辑目录配置文件后自动生效。"
            action-text="去模型接入配置"
            @action="goAccessConfig"
          />
          <!-- 非模型级配置提示（目录兜底 / 密钥缺失 / 别名类告警无法挂到某一行，收在表尾一条注） -->
          <div v-if="globalWarnings.length" class="ac-mr-warnings">
            <div v-for="(warning, index) in globalWarnings" :key="index" class="mk-alert mk-alert--row" role="alert">
              <span class="mk-alert__msg">{{ warning }}</span>
            </div>
          </div>
          <!-- 上游有、平台没登记的模型（2026-10-16 用户走查）：原在连接卡铺成 30+ 个 chip，与
               本表并列成两份模型名单。收到这里，折叠着——它们只在排查「某个模型为什么不能用」
               时才有用（答案是：没登记）。名字按厂家前缀归一比对，见 modelNameMatch。
               未拉取上游清单时不渲染，免得给一个恒为 0 的折叠。 -->
          <details v-if="upstreamUnregistered.length" class="ac-mr-upstream">
            <summary class="mk-card__head mk-section__summary">
              <h4 class="mk-card__title">上游还有 {{ upstreamUnregistered.length }} 个未登记</h4>
              <span class="mk-card__meta">不参与路由</span>
            </summary>
            <div class="ac-mr-upstream__body">
              <span v-for="name in upstreamUnregistered" :key="name" class="ac-mr-upstream__item mono" :title="name">{{ name }}</span>
            </div>
          </details>
        </section>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminApiConfigApi } from '@/api/adminApi'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { errMsg } from './live'
import { splitUpstreamByRegistry } from './modelNameMatch'

interface ModelRegistryOverviewData {
  generatedAt: string
  providers: Array<{
    id: string
    name: string
    description?: string
    enabled: boolean
    recommended: boolean
    endpointSource: 'inherit' | 'own'
    baseUrl: string | null
    apiKeyEnv: string | null
    keyConfigured: boolean | null
    modelIds: string[]
  }>
  registry: {
    path: string
    source: 'file' | 'embedded-fallback'
    mtimeMs: number | null
    lastError: string | null
    fileDefaults: { chat: string; reasoning: string }
  }
  models: Array<{
    id: string
    label: string
    tier: string
    provider: string
    providerId: string
    providerName?: string
    hasOwnEndpoint: boolean
    keyConfigured: boolean | null
    capabilities: { supportsThinking: boolean; supportsReasoningEffort: boolean }
    limits: {
      maxOutputTokens: number | null
      defaultMaxTokens: number | null
      reasoningReserveTokens: number
      maxParallelRequests: number | null
    }
    fallbacks: string[]
    pricingConfigured: boolean
    description?: string
  }>
  aliases: Array<{
    alias: string
    source: 'code' | 'db-override'
    members: string[]
    dbMembers: string[] | null
    selected: string | null
    selectedWhenRequiringThinking: string | null
    degradedWhenRequiringThinking: boolean
  }>
  defaults: {
    defaultModelConfigured: string | null
    defaultModelResolved: string | null
    defaultModelSource: 'alias' | 'concrete' | 'unset'
    defaultReasoningModelConfigured: string | null
    defaultReasoningModelResolved: string | null
    defaultReasoningModelSource: 'alias' | 'concrete' | 'unset'
    // 后端暂未返回评估档字段，按可选声明；模板据此显示 '—' 占位
    defaultEvaluationModelConfigured?: string | null
    defaultEvaluationModelResolved?: string | null
    defaultEvaluationModelSource?: 'alias' | 'concrete' | 'unset'
  }
  /** 运行时实际默认（含 env 兜底来源）；defaults 只报平台行上配了什么 */
  runtimeDefaults?: {
    model: string | null
    source: 'ui' | 'env' | 'none'
    reasoningModel: string | null
    reasoningSource: 'ui' | 'env' | 'none'
  }
  fallbackChains: Array<{
    model: string
    fallbacks: string[]
    effectiveFallbacks: string[]
    truncated: boolean
  }>
  runtime?: { maxModelCandidates: number; fallbackSwapsModelOnly: boolean }
  cooldowns: Array<{ key: string; providerId: string; endpoint: string; model: string; remainingMs: number }>
  warnings: string[]
  deprecatedPromptModelCount: number
}

/* 分区裁剪（2026-10-14 用户拍板；2026-10-15 合并后收敛为两片）：宿主按域挂本组件的切片——
   「别名映射」是路由域事实，归「调用与健康」页签；「providers」= 供应商与能力限额合并块，
   留「接入与模型」。切片只裁剪渲染范围，数据仍是一次 getModelRegistry。 */
type MrPart = 'aliases' | 'providers'
/* 默认值就地写死（不能引用本地常量：defineProps 会被提升到 setup 之外，编译器会拦下） */
const props = withDefaults(defineProps<{ parts?: MrPart[]; upstream?: string[] }>(), {
  parts: () => ['aliases', 'providers'],
  /** 上游中转站返回的原始模型清单（宿主传入，本组件不做拉取） */
  upstream: () => []
})
const shows = (p: MrPart) => props.parts.includes(p)

const emit = defineEmits<{
  count: [payload: { models: number; warnings: number }]
  aliases: [aliases: string[]]
  /** 路由解析结果回传宿主（2026-10-15「所配即所得」）：宿主在三条角色行下展示
   *  「实际生效 / 来源 / 降级备用」，原解析结果表退役 */
  defaults: [payload: { defaults: ModelRegistryOverviewData['defaults']; models: ModelRegistryOverviewData['models']; runtime?: ModelRegistryOverviewData['runtime']; runtimeDefaults?: ModelRegistryOverviewData['runtimeDefaults'] }]
}>()

const data = ref<ModelRegistryOverviewData | null>(null)
const failed = ref(false)
const errorText = ref('')

/** 行级状态（2026-10-15）：该模型所属部署是否在熔断冷却中（providerId + model 双键匹配） */
function cooldownOf(model: ModelRegistryOverviewData['models'][number]) {
  return (data.value?.cooldowns ?? []).find((c) => c.model === model.id && c.providerId === model.providerId) ?? null
}

/** 模型级配置提示（warning 文案里以「模型「id」」包住的，挂到对应行；其余走 globalWarnings） */
function modelWarnings(model: ModelRegistryOverviewData['models'][number]): string[] {
  return (data.value?.warnings ?? []).filter((w) => w.includes(`模型「${model.id}」`))
}
const globalWarnings = computed(() => {
  const models = data.value?.models ?? []
  return (data.value?.warnings ?? []).filter((w) => !models.some((m) => w.includes(`模型「${m.id}」`)))
})

const router = useRouter()
/** 空态出口（R6D）：跳到接入配置所在的「接入与模型」页签，路由与页签参数均为既有契约 */
function goAccessConfig() {
  void router.push({ path: '/admin/api-config', query: { tab: 'access' } })
}

/** 运行时模型候选上限(含主模型);后端 registry runtime 缺失时按现状 2 兜底 */
function runtimeMaxCandidates(): number {
  return data.value?.runtime?.maxModelCandidates ?? 2
}
function effectiveFallbacks(fallbacks: string[]): string[] {
  return fallbacks.slice(0, Math.max(0, runtimeMaxCandidates() - 1))
}

/* sourceLabel/sourceBadge 2026-10-15 随「默认路由（解析结果）」表退役——
   来源徽标的渲染迁到宿主行内提示（ApiConfig 读 emit('defaults') 的 source 字段） */

/**
 * 合并块数据：供应商=组头、其模型=组内行（同一份 llm-providers.json 的层级还原）。
 * 组序随 providers 声明序；组内模型取 models 里 providerId 命中的行（顺序随声明序）。
 * `declaredCount` 用文件里声明的模型数（含停用供应商）——组内若因停用而无行，仍有计数可读。
 */
const providerGroups = computed(() => {
  const d = data.value
  if (!d) return []
  return (d.providers ?? []).map((p) => ({
    ...p,
    badge: (p.name || p.id || '?').slice(0, 2),
    state: providerState(p),
    declaredCount: p.modelIds?.length ?? 0,
    models: (d.models ?? []).filter((m) => m.providerId === p.id)
  }))
})

/**
 * 上游清单里平台没登记的模型（2026-10-16 用户走查）。登记表就是「平台会路由的集合」，
 * 上游多出来的名字只在排查「某个模型为什么用不了」时有意义，故收进表尾折叠。
 * 名字对齐口径与连接卡的计数共用 modelNameMatch（同一个数不能在两处各算一遍）。
 */
const upstreamUnregistered = computed(() =>
  splitUpstreamByRegistry(props.upstream, (data.value?.models ?? []).map((m) => m.id)).unregistered
)

/**
 * 供应商三态（原型 statusPill ok/warn/off，index.html:1286-1299 / 1819-1823）：
 * 停用 → off；启用但自带端点且密钥未配置 → warn；其余 → ok。
 * 全部映射现有真实字段（enabled / endpointSource / keyConfigured），不引入新数据。
 */
function providerState(p: ModelRegistryOverviewData['providers'][number]): { cls: string; label: string } {
  if (!p.enabled) return { cls: 'mk-badge--muted', label: '停用' }
  if (p.endpointSource === 'own' && p.keyConfigured === false) return { cls: 'mk-badge--warn', label: '密钥未配置' }
  return { cls: 'mk-badge--ok', label: '启用' }
}

async function refresh(force = false): Promise<void> {
  if (data.value && !force) return
  failed.value = false
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    data.value = (res?.data?.data ?? null) as ModelRegistryOverviewData | null
    emit('count', {
      models: data.value?.models.length ?? 0,
      warnings: data.value?.warnings.length ?? 0
    })
    // 别名清单回传宿主（路由输入 datalist 候选）：共用本次请求，宿主不必再单独拉 getModelRegistry
    emit('aliases', (data.value?.aliases ?? []).map((a) => a.alias).filter(Boolean))
    // 路由解析结果回传宿主（「所配即所得」行内展示；即使只渲染 aliases 切片也照发——数据同源）
    if (data.value) {
      emit('defaults', {
        defaults: data.value.defaults,
        models: data.value.models,
        runtime: data.value.runtime,
        runtimeDefaults: data.value.runtimeDefaults
      })
    }
  } catch (error: unknown) {
    failed.value = true
    errorText.value = errMsg(error)
  }
}

onMounted(() => {
  void refresh()
})

defineExpose({ refresh })
</script>

<style scoped>
/* 连续分区（批24）：单卡内五个关注点，分区感由卡头分隔线承担 */
.ac-mr-sect:last-child { padding-bottom: 6px; }
.ac-mr-badge {
  margin-left: 6px;
}
.ac-mr-label {
  margin-left: 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.ac-mr-note {
  margin: 8px 0 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 上游未登记折叠：默认收起（只在排查「某模型为什么用不了」时展开） */
.ac-mr-upstream { margin: 4px 0 0; }
.ac-mr-upstream__body {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 14px 10px;
}
.ac-mr-upstream__item {
  padding: 3px 8px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.ac-mr-note__item {
  margin-left: 8px;
}
/* 模型供应商组（2026-10-15 合并块）：供应商=组头行，其模型=组内能力行。
   组头沿用 mrow 词汇（方块徽标 + 名/用途 + id/承载/端点 + 状态徽标），但进水表格后
   去掉卡片描边/底色，改由行分隔线与缩进承担层级。 */
/* 分组行不覆写内边距：跟随 .mk-table td 的档位节奏（同 SkillReconciliation 判例，
   低于 SPEC §3 的 40px 行高下限即视为不合规）。 */
.ac-mr-pgroup > td {
  background: var(--mk-surface-2);
}
.ac-mr-pgroup .ac-mr-mrow--flat {
  padding: 0;
  border: 0;
  background: none;
}
/* 组内模型行：左缘缩进一档，视觉上属于上面的供应商 */
.ac-mr-mmodel > td:first-child {
  padding-left: 20px;
  border-left: 3px solid var(--mk-line);
}
.ac-mr-pempty > td {
  padding-left: 20px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.ac-mr-mrow {
  display: flex;
  align-items: center;
  gap: var(--mk-space-3);
  padding: var(--mk-space-3);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
.ac-mr-mrow__badge {
  width: 38px;
  height: 38px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
  /* --mk-blue 压 --mk-surface-2 亮色仅 4.39:1（<4.5 AA）；--mk-accent-deep 亮色 #1f57cc 实测
     5.68:1、暗色 #7aa2ff 自动翻转（与 .mk-badge--self 同款用法） */
  color: var(--mk-accent-deep, #1f57cc);
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}
.ac-mr-mrow__grow {
  display: grid;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}
.ac-mr-mrow__t {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ac-mr-mrow__name {
  font-weight: 600;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-mr-mrow__kind {
  min-width: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-mr-mrow__d {
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-mr-mrow__sep {
  margin: 0 4px;
}
.ac-mr-mrow__state {
  flex: none;
}
.ac-mr-warnings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
}
/* 警示着色覆写（原 .mk-alert 基类红档 → 原型 .note--warn 琥珀档）：提示不是错误 */
.ac-mr-warnings .mk-alert {
  background: var(--mk-amber-bg);
  color: var(--mk-amber);
  font-size: var(--mk-fs-micro);
}
</style>
