<template>
  <!-- Skill × 模型 × 参数 × 兜底 覆盖矩阵 -->
  <div class="mk-card skc">
    <!-- 原型 .card__head（title + sub）：卡头统一走 mk-card 词表 -->
    <div class="mk-card__head">
      <h3 class="mk-card__title">Skill × 模型 × 参数 × 兜底</h3>
      <span class="mk-card__meta">技能全集（prompts 注册表）× 实际路由</span>
    </div>
    <div class="skc__body">
      <!-- 原型 .note：说明文字走 surface-2 底 + muted 小字（不再自搓提示样式） -->
      <p class="note">
        <b>未配置 = 走平台默认</b>（2026-09-28 曾因此把 7 个课后技能静默漏到旧通道）。
        对多个技能套用同一份通道/模型/参数/兜底配置：
      </p>
      <div class="skc__apply">
        <input v-model="bulk.endpoint" class="mk-input mono" placeholder="endpoint（必填，http://host:30001）" :class="{ 'is-err': bulkErr }" />
        <input v-model="bulk.apiKey" class="mk-input mono" type="password" placeholder="apiKey（必填）" :class="{ 'is-err': bulkErr }" />
        <input v-model="bulk.model" class="mk-input mono" placeholder="model（留空=不覆盖）" list="skc-model-options" />
        <button type="button" class="mk-btn mk-btn--primary" :disabled="bulkSaving || !selected.length" @click="applyBulk">
          {{ bulkSaving ? '套用中…' : `套用到 ${selected.length} 个技能` }}
        </button>
        <button type="button" class="mk-link" :disabled="loading" @click="load"><MkLoading v-if="loading" inline min text="加载中…" /><template v-else>刷新</template></button>
      </div>
      <p v-if="bulkMsg" class="note" :class="{ 'note--bad': bulkErr }">{{ bulkMsg }}</p>

      <!-- 原型 .tbl：统一 mk-table--dense 词表；长内容列（参数/兜底链）走 wrap 列 -->
      <div v-if="rows.length" class="mk-table-scroll">
        <table class="mk-table mk-table--dense skc__table">
          <thead>
            <tr>
              <th><input type="checkbox" :checked="allChecked" @change="toggleAll(($event.target as HTMLInputElement).checked)" /></th>
              <th>Skill</th>
              <th>路由来源</th>
              <th>model</th>
              <th>参数覆盖</th>
              <th class="skc__wrap">兜底链</th>
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
              <td class="mono skc__wrap" :title="s.paramOverrides ? JSON.stringify(s.paramOverrides) : undefined">{{ s.paramOverrides ? JSON.stringify(s.paramOverrides) : '—' }}</td>
              <td class="mono skc__wrap" :title="s.fallbackChain && s.fallbackChain.length ? s.fallbackChain.join(' → ') : undefined">{{ s.fallbackChain && s.fallbackChain.length ? s.fallbackChain.join(' → ') : 'registry默认' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <MkEmptyState
        v-else-if="!loading"
        title="暂无技能覆盖数据"
        description="技能目录为空，或接口暂不可用。可点击「刷新」重新拉取。"
        action-text="刷新"
        @action="load"
      />
    </div>

    <!-- 模型目录候选（File-as-Truth llm-providers.json；带「供应商 · tier」标注） -->
    <datalist id="skc-model-options">
      <option v-for="o in catalogOptions" :key="`cat-${o.value}`" :value="o.value" :label="o.label" />
    </datalist>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminSkillsApi } from '@/api/adminApi'
import { useModelCatalog } from '@/composables/useModelCatalog'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { askConfirm } from './useConfirm'

const { options: catalogOptions, load: loadModelCatalog } = useModelCatalog()
loadModelCatalog()

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
  } catch (e) {
    bulkErr.value = true
    bulkMsg.value = `加载失败：${httpErrText(e)}`
  } finally {
    loading.value = false
  }
}

async function applyBulk() {
  if (bulkSaving.value || !selected.value.length) return
  // 空 endpoint/apiKey 会把所选技能的通道与密钥覆写成空串（静默清掉已配的独立通道，
  // 正是本卡开头那句「未配置 = 走平台默认」的同型事故）。这里显式拦住并给出原因。
  const endpoint = bulk.value.endpoint.trim()
  const apiKey = bulk.value.apiKey.trim()
  if (!endpoint || !apiKey) {
    bulkErr.value = true
    bulkMsg.value = `请先填写 ${!endpoint ? 'endpoint' : ''}${!endpoint && !apiKey ? ' 与 ' : ''}${!apiKey ? 'apiKey' : ''}：留空提交会把所选技能的通道/密钥覆写成空值。`
    return
  }
  const ok = await askConfirm({
    title: '批量套用通道配置',
    message: `将把 endpoint 与 apiKey 覆盖到选中的 ${selected.value.length} 个技能（model 留空则不覆盖）。\n这会替换这些技能已有的独立通道与密钥，且不可撤销。确定继续？`,
    confirmText: '覆盖套用',
    busy: true,
  })
  if (!ok) return
  bulkSaving.value = true
  bulkMsg.value = ''
  bulkErr.value = false
  try {
    const res = await adminSkillsApi.bulkApplySkillModelConfig({
      skillIds: selected.value,
      endpoint,
      apiKey,
      model: bulk.value.model.trim() || undefined,
      tier: 'chat',
    })
    const data = res.data?.data as { applied?: number; failed?: number; results?: Array<{ skillId: string; ok: boolean; error?: string }> } | undefined
    const failed = (data?.results || []).filter(r => !r.ok)
    bulkErr.value = failed.length > 0
    bulkMsg.value = `已套用 ${data?.applied ?? 0} 个，失败 ${failed.length} 个${failed.length ? '：' + failed.map(f => `${f.skillId}(${f.error})`).join('；') : ''}`
    await load()
  } catch (e) {
    bulkErr.value = true
    bulkMsg.value = `套用失败：${httpErrText(e)}`
  } finally {
    bulkSaving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 卡体：与 mk-card__head 的 16px 内边距同档 */
.skc { display: grid; }
.skc__body { display: grid; gap: var(--mk-space-3); padding: var(--mk-space-4); }
/* 原型 .note：说明行（surface-2 底 + muted 小字） */
.note {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
}
.note b { color: var(--mk-ink); }
.note--bad { background: var(--mk-red-bg); color: var(--mk-red); }
.skc__apply { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.skc__apply .mk-input { max-width: 280px; }
.skc__apply .is-err { border-color: var(--mk-red); }
/* 原型 .tbl td.wrap：长文本列（参数覆盖 / 兜底链）换行不截断 */
.skc__table th.skc__wrap,
.skc__table td.skc__wrap { white-space: normal; overflow-wrap: anywhere; min-width: 220px; max-width: 320px; }
</style>
