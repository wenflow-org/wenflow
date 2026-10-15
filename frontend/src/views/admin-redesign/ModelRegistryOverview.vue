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
                      {{ alias.source === 'db-override' ? '平台覆盖' : '平台内置' }}
                    </span>
                  </td>
                  <td class="mono">{{ alias.members.length ? alias.members.join(' → ') : '（无可用模型）' }}</td>
                  <td class="mono">{{ alias.selected ?? '—' }}</td>
                  <td>
                    <span class="mono">{{ alias.selectedWhenRequiringThinking ?? '—' }}</span>
                    <span v-if="alias.degradedWhenRequiringThinking" class="mk-badge mk-badge--warn ac-mr-badge" title="候选模型都不支持思考，已退回该别名的第一个模型。发起请求时会自动去掉思考参数">降级</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="data.aliases.some((a) => a.dbMembers)" class="ac-mr-note" title="这些别名以平台配置为准">
            平台覆盖的别名：
            <span v-for="alias in data.aliases.filter((a) => a.dbMembers)" :key="`db-${alias.alias}`" class="mono ac-mr-note__item">
              {{ alias.alias }} = {{ alias.dbMembers?.join(', ') }}
            </span>
          </p>
        </section>

        <!-- ②b 模型供应商：File-as-Truth 目录（llm-providers.json）的通道视图。
             形态对齐原型 index.html:345-357 .mlist/.mrow 与 1819-1823 供应商行：
             38px badge 方块（名前 2 字）+ 主行「名 · 用途」+ 副行「id · 承载 N 个模型 · 端点/密钥」
             + 右侧 ok/warn/off 状态徽标。原型 mrow 的 QPS/成本目录未下发，按「缺字段省略」不硬造 -->
        <section v-if="shows('providers')" class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">模型供应商</h3>
            <span class="mk-card__meta" title="模型目录以配置文件为准（改动后自动生效）。不自带端点的供应商沿用平台统一的连接配置，自带端点的供应商在路由时使用自己的地址与密钥">
              只读 · 来自配置文件
            </span>
          </div>
          <p v-if="data.registry?.source === 'embedded-fallback'" class="ac-mr-note">
            未读到配置文件，当前为内置默认目录：{{ data.registry?.path }}
          </p>
          <p v-else-if="data.registry?.lastError" class="ac-mr-note" :title="data.registry?.lastError">
            最近一次更新失败，仍在使用上一次可用的模型目录。
          </p>
          <div v-if="data.providers?.length" class="ac-mr-mlist" role="list">
            <div v-for="p in data.providers" :key="p.id" class="ac-mr-mrow" role="listitem">
              <span class="ac-mr-mrow__badge" aria-hidden="true">{{ providerBadge(p) }}</span>
              <div class="ac-mr-mrow__grow">
                <div class="ac-mr-mrow__t">
                  <span class="ac-mr-mrow__name" :title="p.name">{{ p.name }}</span>
                  <span v-if="p.description" class="ac-mr-mrow__kind" :title="p.description">· {{ p.description }}</span>
                  <span v-if="p.recommended" class="mk-badge mk-badge--info">推荐</span>
                </div>
                <div class="ac-mr-mrow__d">
                  <span class="mono">{{ p.id }}</span>
                  <span class="ac-mr-mrow__sep">·</span>
                  <span>承载 {{ p.modelIds.length }} 个模型</span>
                  <template v-if="p.endpointSource === 'own'">
                    <span class="ac-mr-mrow__sep">·</span>
                    <span class="mono">{{ p.baseUrl }}</span>
                    <span class="ac-mr-mrow__sep">·</span>
                    <span>密钥{{ p.keyConfigured ? '已配置' : '未配置' }}</span>
                  </template>
                  <template v-else>
                    <span class="ac-mr-mrow__sep">·</span>
                    <span>沿用平台连接配置</span>
                  </template>
                </div>
              </div>
              <span class="mk-badge ac-mr-mrow__state" :class="providerState(p).cls">{{ providerState(p).label }}</span>
            </div>
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
        </section>

        <!-- ③ 模型能力与限额：目录文件 = 唯一写源。状态列（2026-10-15 用户重组）：
             部署冷却从独立尾巴卡落进行内；模型级配置提示以 ⚠ 徽标挂行（全串进 title） -->
        <section v-if="shows('limits')" class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">模型能力与限额</h3>
            <span class="mk-card__meta" title="模型目录以配置文件为准，此表只读。降级时只更换模型，连接地址与密钥不变">只读 · 降级仅换模型名</span>
          </div>
          <div class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead>
                <tr>
                  <th>模型</th><th>状态</th><th>供应商</th><th>档位</th><th>思考</th><th>推理强度</th>
                  <th>输出上限</th><th>默认输出</th><th>推理预留</th><th>并发上限</th><th>备用模型</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="model in data.models" :key="model.id">
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
                  <td>
                    <span class="mono">{{ model.providerId }}</span>
                    <span v-if="model.hasOwnEndpoint" class="ac-mr-label" title="该供应商自带端点：路由时整体切换 endpoint/key">独立端点</span>
                  </td>
                  <!-- 档位列：表头有「档位」而此前缺这一格，整行从第 3 列起右移一列
                       （「档位」列显示思考徽标、「并发上限」列显示降级链、「降级链」恒空），
                       诊断页数值与标签错配会被读成真实配置。 -->
                  <td><span class="mk-badge mk-badge--muted">{{ model.tier || '—' }}</span></td>
                  <td>
                    <span class="mk-badge" :class="model.capabilities.supportsThinking ? 'mk-badge--ok' : 'mk-badge--muted'">
                      {{ model.capabilities.supportsThinking ? '支持' : '不支持' }}
                    </span>
                  </td>
                  <td>{{ model.capabilities.supportsReasoningEffort ? '支持' : '—' }}</td>
                  <td class="mono">{{ model.limits.maxOutputTokens ?? '—' }}</td>
                  <td class="mono">{{ model.limits.defaultMaxTokens ?? '—' }}</td>
                  <td class="mono">{{ model.limits.reasoningReserveTokens || '—' }}</td>
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
              </tbody>
            </table>
          </div>
          <!-- 非模型级配置提示（2026-10-15 用户重组：原「配置提示」独立卡退役）：
               目录兜底 / 密钥缺失 / 别名类告警无法挂到某一行，收在表尾一条注（无则不渲染，不留空卡） -->
          <div v-if="globalWarnings.length" class="ac-mr-warnings">
            <div v-for="(warning, index) in globalWarnings" :key="index" class="mk-alert mk-alert--row" role="alert">
              <span class="mk-alert__msg">{{ warning }}</span>
            </div>
          </div>
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

/* 分区裁剪（2026-10-14 用户拍板，2026-10-15 用户重组后收敛为三片）：宿主按域挂本组件的切片——
   「别名映射」是路由域事实，归「路由与调用」页签；供应商 / 能力限额（含状态列：冷却 + 行级提示）
   留在「接入与模型」。原 routes（解析结果）/ cooldown / tips 三片退役：解析结果改由宿主
   「所配即所得」行内展示（defaults 经 emit 供出）、冷却与模型级提示落限额表状态列、
   非模型级提示收在表尾注。切片只裁剪渲染范围，数据仍是一次 getModelRegistry。 */
type MrPart = 'aliases' | 'providers' | 'limits'
/* 默认值就地写死（不能引用本地常量：defineProps 会被提升到 setup 之外，编译器会拦下） */
const props = withDefaults(defineProps<{ parts?: MrPart[] }>(), {
  parts: () => ['aliases', 'providers', 'limits']
})
const shows = (p: MrPart) => props.parts.includes(p)

const emit = defineEmits<{
  count: [payload: { models: number; warnings: number }]
  aliases: [aliases: string[]]
  /** 路由解析结果回传宿主（2026-10-15「所配即所得」）：宿主在三条角色行下展示
   *  「实际生效 / 来源 / 降级备用」，原解析结果表退役 */
  defaults: [payload: { defaults: ModelRegistryOverviewData['defaults']; models: ModelRegistryOverviewData['models']; runtime?: ModelRegistryOverviewData['runtime'] }]
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

/** mrow 方块徽标：供应商名前 2 字（原型 index.html:354 .mrow__badge） */
function providerBadge(p: ModelRegistryOverviewData['providers'][number]): string {
  return (p.name || p.id || '?').slice(0, 2)
}

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
      emit('defaults', { defaults: data.value.defaults, models: data.value.models, runtime: data.value.runtime })
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
.ac-mr-note__item {
  margin-left: 8px;
}
/* 模型供应商行列表（原型 index.html:352-357 .mlist/.mrow，容器 345）：
   方块徽标 + 名/用途主行 + id/承载/端点副行 + 右侧状态徽标 */
.ac-mr-mlist {
  display: grid;
  gap: var(--mk-space-2);
  padding: 12px 0 4px;
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
