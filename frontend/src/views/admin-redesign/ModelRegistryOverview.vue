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
      <!-- 五个关注点折成一张连续分区卡（批24）：同构 5 卡堆叠是"数据库文档页"观感，
           分区由卡头分隔线承担；表内数据语义不变 -->
      <section class="mk-card">
        <!-- ① 默认路由：配置值 → 解析结果（回答"改成别名后到底用哪个模型"） -->
        <section class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">默认路由（解析结果）</h3>
            <span class="mk-card__meta">平台配置可写具体模型，也可写逻辑别名；此处展示解析后的实际模型</span>
          </div>
          <div class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead>
                <tr><th>用途</th><th>配置值</th><th>实际使用</th><th>来源</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>对话默认</td>
                  <td class="mono">{{ data.defaults.defaultModelConfigured ?? '未设置' }}</td>
                  <td class="mono">{{ data.defaults.defaultModelResolved ?? '—' }}</td>
                  <td><span class="mk-badge" :class="sourceBadge(data.defaults.defaultModelSource)">{{ sourceLabel(data.defaults.defaultModelSource) }}</span></td>
                </tr>
                <tr>
                  <td>推理默认</td>
                  <td class="mono">{{ data.defaults.defaultReasoningModelConfigured ?? '未设置' }}</td>
                  <td class="mono">{{ data.defaults.defaultReasoningModelResolved ?? '—' }}</td>
                  <td><span class="mk-badge" :class="sourceBadge(data.defaults.defaultReasoningModelSource)">{{ sourceLabel(data.defaults.defaultReasoningModelSource) }}</span></td>
                </tr>
                <tr>
                  <!-- 评估默认：宿主「默认路由 x/3」按对话/推理/评估三档计数，本表须三行齐全；
                       后端 /model-registry 暂未下发评估档字段，先渲染 '—' 占位（数据源待后端补齐后自动展示） -->
                  <td>评估默认</td>
                  <td class="mono">{{ data.defaults.defaultEvaluationModelConfigured ?? '—' }}</td>
                  <td class="mono">{{ data.defaults.defaultEvaluationModelResolved ?? '—' }}</td>
                  <td>
                    <span v-if="data.defaults.defaultEvaluationModelSource" class="mk-badge" :class="sourceBadge(data.defaults.defaultEvaluationModelSource)">{{ sourceLabel(data.defaults.defaultEvaluationModelSource) }}</span>
                    <span v-else class="mono">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ② 别名映射：一处切换的落点 -->
        <section class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">别名映射</h3>
            <span class="mk-card__meta">业务/配置只写别名，由模型层按顺序与能力展开为具体部署</span>
          </div>
          <div class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead>
                <tr><th>别名</th><th>成员来源</th><th>成员（按序）</th><th>默认选中</th><th>需要思考时</th></tr>
              </thead>
              <tbody>
                <tr v-for="alias in data.aliases" :key="alias.alias">
                  <td class="mono">{{ alias.alias }}</td>
                  <td>
                    <span class="mk-badge" :class="alias.source === 'db-override' ? 'mk-badge--warn' : 'mk-badge--muted'">
                      {{ alias.source === 'db-override' ? 'DB 覆盖' : '代码注册表' }}
                    </span>
                  </td>
                  <td class="mono">{{ alias.members.length ? alias.members.join(' → ') : '（无可用成员）' }}</td>
                  <td class="mono">{{ alias.selected ?? '—' }}</td>
                  <td>
                    <span class="mono">{{ alias.selectedWhenRequiringThinking ?? '—' }}</span>
                    <span v-if="alias.degradedWhenRequiringThinking" class="mk-badge mk-badge--warn ac-mr-badge" title="没有成员支持思考，已退化为该别名第一位成员；请求侧会自动裁掉思考参数">降级</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="data.aliases.some((a) => a.dbMembers)" class="ac-mr-note">
            DB 覆盖声明（platform_api_configs.chatModels / reasoningModels / lightModels）：
            <span v-for="alias in data.aliases.filter((a) => a.dbMembers)" :key="`db-${alias.alias}`" class="mono ac-mr-note__item">
              {{ alias.alias }} = {{ alias.dbMembers?.join(', ') }}
            </span>
          </p>
        </section>

        <!-- ②b 模型供应商：File-as-Truth 目录（llm-providers.json）的通道视图 -->
        <section class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">模型供应商</h3>
            <span class="mk-card__meta">
              唯一写源 = File-as-Truth 模型目录（config/llm-providers.json，改动热重载）；继承通道沿用平台路由解析，自带端点的供应商在路由时整体切换 endpoint/key
            </span>
          </div>
          <p v-if="data.registry?.source === 'embedded-fallback'" class="ac-mr-note">
            当前目录来自内置兜底（未读到配置文件）：{{ data.registry?.path }}
          </p>
          <p v-else-if="data.registry?.lastError" class="ac-mr-note">
            最近一次热重载失败，沿用上一次好目录：{{ data.registry?.lastError }}
          </p>
          <div class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead>
                <tr><th>供应商</th><th>端点</th><th>密钥</th><th>推荐</th><th>状态</th><th>模型</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in data.providers" :key="p.id">
                  <td>
                    <span class="mono">{{ p.id }}</span>
                    <span class="ac-mr-label">{{ p.name }}</span>
                  </td>
                  <td class="mono">
                    <template v-if="p.endpointSource === 'own'">{{ p.baseUrl }}</template>
                    <template v-else>继承平台路由</template>
                  </td>
                  <td class="mono">
                    <template v-if="p.endpointSource === 'own'">{{ p.apiKeyEnv }}（{{ p.keyConfigured ? '已配置' : '未配置' }}）</template>
                    <template v-else>—</template>
                  </td>
                  <td>
                    <span v-if="p.recommended" class="mk-badge mk-badge--ok">推荐</span>
                    <template v-else>—</template>
                  </td>
                  <td>
                    <span class="mk-badge" :class="p.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">{{ p.enabled ? '启用' : '停用' }}</span>
                  </td>
                  <td class="mono">{{ p.modelIds.join(', ') || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ③ 模型能力与限额：目录文件 = 唯一写源 -->
        <section class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">模型能力与限额</h3>
            <span class="mk-card__meta">唯一写源 = File-as-Truth 模型目录（llm-providers.json）；此表只读。降级仅切换模型名，网关与密钥沿用主调用</span>
          </div>
          <div class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead>
                <tr>
                  <th>模型</th><th>供应商</th><th>档位</th><th>思考</th><th>推理强度</th>
                  <th>输出上限</th><th>缺省输出</th><th>推理预留</th><th>并发上限</th><th>降级链</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="model in data.models" :key="model.id">
                  <td>
                    <span class="mono">{{ model.id }}</span>
                    <span class="ac-mr-label">{{ model.label }}</span>
                  </td>
                  <td>
                    <span class="mono">{{ model.providerId }}</span>
                    <span v-if="model.hasOwnEndpoint" class="ac-mr-label" title="该供应商自带端点：路由时整体切换 endpoint/key">独立端点</span>
                  </td>
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
                        title="运行时最多主模型+1跳 fallback(MAX_MODEL_CANDIDATES),声明链更长也只生效前段"
                      >(声明 {{ model.fallbacks.length }} 层,运行时生效 {{ effectiveFallbacks(model.fallbacks).length }} 层)</span>
                    </template>
                    <template v-else>—</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ④ 部署冷却（进程内快照，只有真的触发过降级/限流时才有内容） -->
        <section class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">部署冷却</h3>
            <span class="mk-card__meta">按 provider + 端点 + 模型隔离；冷却中的部署在降级时会被跳过</span>
          </div>
          <div v-if="data.cooldowns.length" class="mk-table-scroll">
            <table class="mk-table mk-table--dense">
              <thead><tr><th>提供方</th><th>端点</th><th>模型</th><th>剩余</th></tr></thead>
              <tbody>
                <tr v-for="item in data.cooldowns" :key="item.key">
                  <td class="mono">{{ item.providerId }}</td>
                  <td class="mono">{{ item.endpoint }}</td>
                  <td class="mono">{{ item.model }}</td>
                  <td class="mono">{{ Math.ceil(item.remainingMs / 1000) }}s</td>
                </tr>
              </tbody>
            </table>
          </div>
          <MkEmptyState v-else compact title="当前没有冷却中的部署（部署全部健康）。" />
        </section>

        <!-- ⑤ 配置漂移告警 -->
        <section class="ac-mr-sect">
          <div class="mk-card__head">
            <h3 class="mk-card__title">配置提示</h3>
            <span class="mk-card__meta">未注册模型 / 别名为空 / 模型未被引用 / 废弃的 prompt 模型副本</span>
          </div>
          <div v-if="data.warnings.length" class="ac-mr-warnings">
            <!-- 配置提示 = 警示语义：走 .note--warn 琥珀档（.mk-alert 本体红档留给错误，
                 不存在的 mk-alert--warn 幽灵类已删，改由容器覆写着色） -->
            <div v-for="(warning, index) in data.warnings" :key="index" class="mk-alert mk-alert--row" role="alert">
              <span class="mk-alert__msg">{{ warning }}</span>
            </div>
          </div>
          <MkEmptyState v-else compact title="没有发现配置漂移。" />
        </section>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

const emit = defineEmits<{
  count: [payload: { models: number; warnings: number }]
  aliases: [aliases: string[]]
}>()

const data = ref<ModelRegistryOverviewData | null>(null)
const failed = ref(false)
const errorText = ref('')

/** 运行时模型候选上限(含主模型);后端 registry runtime 缺失时按现状 2 兜底 */
function runtimeMaxCandidates(): number {
  return data.value?.runtime?.maxModelCandidates ?? 2
}
function effectiveFallbacks(fallbacks: string[]): string[] {
  return fallbacks.slice(0, Math.max(0, runtimeMaxCandidates() - 1))
}

function sourceLabel(source: 'alias' | 'concrete' | 'unset'): string {
  if (source === 'alias') return '别名'
  if (source === 'concrete') return '具体模型'
  return '未设置'
}
function sourceBadge(source: 'alias' | 'concrete' | 'unset'): string {
  if (source === 'alias') return 'mk-badge--ok'
  if (source === 'concrete') return 'mk-badge--muted'
  return 'mk-badge--warn'
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
