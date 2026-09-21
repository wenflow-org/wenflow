<template>
  <div class="ac-tab-body">
    <div v-if="failed" class="mk-alert mk-alert--row ac-error" role="alert">
      <span class="mk-alert__msg">模型总览加载失败：{{ errorText }}</span>
      <button type="button" class="mk-status__action" @click="refresh(true)">重试</button>
    </div>

    <MkLoading v-else-if="!data" inline text="加载中…" />

    <template v-else>
      <!-- ① 默认路由：配置值 → 解析结果（回答"改成别名后到底用哪个模型"） -->
      <section class="mk-card">
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
            </tbody>
          </table>
        </div>
      </section>

      <!-- ② 别名映射：一处切换的落点 -->
      <section class="mk-card">
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

      <!-- ③ 模型能力与限额：代码注册表 = 唯一写源 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">模型能力与限额</h3>
          <span class="mk-card__meta">唯一写源 = 后端代码注册表（models.config.ts）；此表只读</span>
        </div>
        <div class="mk-table-scroll">
          <table class="mk-table mk-table--dense">
            <thead>
              <tr>
                <th>模型</th><th>档位</th><th>思考</th><th>推理强度</th>
                <th>输出上限</th><th>缺省输出</th><th>推理预留</th><th>并发上限</th><th>降级链</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="model in data.models" :key="model.id">
                <td>
                  <span class="mono">{{ model.id }}</span>
                  <span class="ac-mr-label">{{ model.label }}</span>
                </td>
                <td>{{ model.tier }}</td>
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
      <section class="mk-card">
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
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">配置提示</h3>
          <span class="mk-card__meta">未注册模型 / 别名为空 / 模型未被引用 / 废弃的 prompt 模型副本</span>
        </div>
        <div v-if="data.warnings.length" class="ac-mr-warnings">
          <div v-for="(warning, index) in data.warnings" :key="index" class="mk-alert mk-alert--row mk-alert--warn" role="alert">
            <span class="mk-alert__msg">{{ warning }}</span>
          </div>
        </div>
        <MkEmptyState v-else compact title="没有发现配置漂移。" />
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
  models: Array<{
    id: string
    label: string
    tier: string
    provider: string
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
  }
  fallbackChains: Array<{
    model: string
    fallbacks: string[]
    effectiveFallbacks: string[]
    truncated: boolean
  }>
  runtime?: { maxModelCandidates: number }
  cooldowns: Array<{ key: string; providerId: string; endpoint: string; model: string; remainingMs: number }>
  warnings: string[]
  deprecatedPromptModelCount: number
}

const emit = defineEmits<{ count: [payload: { models: number; warnings: number }] }>()

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
.ac-mr-badge {
  margin-left: 6px;
}
.ac-mr-label {
  margin-left: 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-12);
}
.ac-mr-note {
  margin: 8px 0 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-12);
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
</style>
