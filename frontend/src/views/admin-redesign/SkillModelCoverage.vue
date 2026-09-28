<template>
  <!-- Skill × 模型 × 参数 × 兜底 覆盖矩阵 -->
  <div class="skc">
    <div class="skc__bar">
      <p class="skc__hint">
        技能全集（prompts 注册表）× 实际路由。<b>未配置 = 走平台默认</b>（2026-09-28 曾因此把 7 个课后技能静默漏到旧通道）。
        对多个技能套用同一份通道/模型/参数/兜底配置：
      </p>
      <div class="skc__apply">
        <input v-model="bulk.endpoint" class="mk-input mono" placeholder="endpoint（http://host:30001）" :class="{ 'is-err': bulkErr }" />
        <input v-model="bulk.apiKey" class="mk-input mono" type="password" placeholder="apiKey" :class="{ 'is-err': bulkErr }" />
        <input v-model="bulk.model" class="mk-input mono" placeholder="model（留空=不覆盖）" />
        <button type="button" class="mk-btn mk-btn--primary" :disabled="bulkSaving || !selected.length" @click="applyBulk">
          {{ bulkSaving ? '套用中…' : `套用到 ${selected.length} 个技能` }}
        </button>
        <button type="button" class="mk-link" :disabled="loading" @click="load"><MkLoading v-if="loading" inline min text="加载中…" /><template v-else>刷新</template></button>
      </div>
      <p v-if="bulkMsg" class="skc__msg" :class="{ 'is-err': bulkErr }">{{ bulkMsg }}</p>
    </div>

    <table class="skc__table">
      <thead>
        <tr>
          <th><input type="checkbox" :checked="allChecked" @change="toggleAll(($event.target as HTMLInputElement).checked)" /></th>
          <th>Skill</th>
          <th>路由来源</th>
          <th>model</th>
          <th>参数覆盖</th>
          <th>兜底链</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in rows" :key="s.skillId">
          <td><input v-model="selected" type="checkbox" :value="s.skillId" /></td>
          <td class="mono">{{ s.skillId }}</td>
          <td>
            <span class="mk-badge" :class="s.source === 'platform-default' ? 'mk-badge--muted' : 'mk-badge--ok'">
              {{ s.source === 'platform-default' ? '平台默认(未配置)' : s.source === 'skill-channel' ? '独立通道' : '仅技能模型' }}
            </span>
          </td>
          <td class="mono">{{ s.model || '继承' }}</td>
          <td class="mono">{{ s.paramOverrides ? JSON.stringify(s.paramOverrides) : '—' }}</td>
          <td class="mono">{{ s.fallbackChain && s.fallbackChain.length ? s.fallbackChain.join(' → ') : 'registry默认' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminSkillsApi } from '@/api/adminApi'
import MkLoading from '@/components/mk/MkLoading.vue'

interface Row {
  skillId: string
  endpoint: string | null
  model: string | null
  tier: string
  source: 'skill-channel' | 'skill-model-only' | 'platform-default'
  paramOverrides: Record<string, number> | null
  fallbackChain: string[] | null
}

const rows = ref<Row[]>([])
const loading = ref(false)
const selected = ref<string[]>([])
const bulk = ref({ endpoint: '', apiKey: '', model: '' })
const bulkSaving = ref(false)
const bulkMsg = ref('')
const bulkErr = ref(false)

/** axios 错误文本归一（unknown 收窄；管理端错误体 {error:{message}}） */
function httpErrText(e: unknown): string {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || String(e)
}

const allChecked = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length)

function toggleAll(on: boolean) {
  selected.value = on ? rows.value.map(r => r.skillId) : []
}

async function load() {
  loading.value = true
  try {
    const res = await adminSkillsApi.getSkillModelCoverage()
    const data = res.data?.data as { skills?: Row[] } | undefined
    rows.value = data?.skills || []
  } catch (e: unknown) {
    bulkErr.value = true
    bulkMsg.value = `加载失败：${httpErrText(e)}`
  } finally {
    loading.value = false
  }
}

async function applyBulk() {
  if (bulkSaving.value || !selected.value.length) return
  bulkSaving.value = true
  bulkMsg.value = ''
  bulkErr.value = false
  try {
    const res = await adminSkillsApi.bulkApplySkillModelConfig({
      skillIds: selected.value,
      endpoint: bulk.value.endpoint.trim(),
      apiKey: bulk.value.apiKey.trim(),
      model: bulk.value.model.trim() || undefined,
      tier: 'chat',
    })
    const data = res.data?.data as { applied?: number; failed?: number; results?: Array<{ skillId: string; ok: boolean; error?: string }> } | undefined
    const failed = (data?.results || []).filter(r => !r.ok)
    bulkErr.value = failed.length > 0
    bulkMsg.value = `已套用 ${data?.applied ?? 0} 个，失败 ${failed.length} 个${failed.length ? '：' + failed.map(f => `${f.skillId}(${f.error})`).join('；') : ''}`
    await load()
  } catch (e: unknown) {
    bulkErr.value = true
    bulkMsg.value = `套用失败：${httpErrText(e)}`
  } finally {
    bulkSaving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.skc { display: grid; gap: 12px; }
.skc__hint { font-size: var(--mk-fs-body); color: var(--mk-muted); line-height: 1.6; margin: 0; }
.skc__apply { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.skc__apply .mk-input { max-width: 280px; }
.skc__apply .is-err { border-color: var(--mk-red, #c0392b); }
.skc__msg { font-size: var(--mk-fs-micro); margin: 0; }
.skc__msg.is-err { color: var(--mk-red, #c0392b); }
.skc__table { width: 100%; border-collapse: collapse; font-size: var(--mk-fs-body); }
.skc__table th, .skc__table td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--mk-line, #e5e7ee); }
.skc__table th { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.mono { font-family: var(--mk-mono, monospace); font-size: var(--mk-fs-micro); }
</style>
