<template>
  <!-- 供应商编辑（新增 / 修改，2026-10-18 BYOK 重做）。
       即时保存：面板里的「保存」直接落盘（不是脏位 + 底部保存条）——与 ZCode / Cherry Studio
       同款；唯一的例外是平台通道的地址与密钥，那些在连接设置里按脏位保存。
       平台通道不出「服务地址/密钥」字段：它的端点在 platform_api_configs，两个写源会互相打架。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="供应商设置">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ isCreate ? '添加供应商' : `供应商设置 · ${provider?.name || provider?.id}` }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div v-if="error" class="mk-alert mk-alert--row" role="alert">
            <span class="mk-alert__msg">{{ error }}</span>
          </div>

          <label v-if="isCreate" class="mk-field">
            <span class="mk-field__label">供应商 ID</span>
            <input
              v-model="form.id"
              class="mk-field__input mono"
              placeholder="acme-gateway"
              autocomplete="off"
              @input="error = ''"
            />
            <span v-if="idHint" class="mk-field__hint">{{ idHint }}</span>
          </label>

          <label class="mk-field">
            <span class="mk-field__label">显示名称</span>
            <input v-model="form.name" class="mk-field__input" placeholder="Acme 网关" @input="error = ''" />
          </label>

          <label class="mk-field">
            <span class="mk-field__label">用途说明</span>
            <!-- 占位符不写「选填」：非必填由没有 * 表达 -->
            <input v-model="form.description" class="mk-field__input" @input="error = ''" />
          </label>

          <template v-if="!isPlatform">
            <label class="mk-field">
              <span class="mk-field__label">服务地址</span>
              <input
                v-model="form.baseUrl"
                class="mk-field__input mono"
                placeholder="https://api.example.com/v1"
                autocomplete="off"
                @input="error = ''"
              />
            </label>

            <label v-if="isCreate" class="mk-field">
              <span class="mk-field__label">API Key</span>
              <input
                v-model="form.apiKey"
                class="mk-field__input"
                type="password"
                autocomplete="new-password"
                :placeholder="provider?.keyHint ? `已配置 ${provider.keyHint}` : '输入 API Key'"
                @input="error = ''"
              />
            </label>
          </template>

          <label class="mk-field">
            <span class="mk-field__label">系统提示词</span>
            <MkSelect
              v-model="form.supportsSystemRole"
              :options="SUPPORTS_SYSTEM_ROLE_OPTIONS"
              aria-label="系统提示词"
              block
            />
          </label>

          <label v-if="isCreate" class="mk-field mk-field--switch">
            <input v-model="form.enabled" type="checkbox" />
            <span>{{ enabledLabel }}</span>
          </label>
        </div>

        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" :disabled="busy" @click="close">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="busy || !canSubmit" @click="submit">
            {{ busy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { adminModelProvidersApi } from '@/api/adminApi'
import { errMsg } from './live'
import MkSelect from '@/components/mk/MkSelect.vue'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'

/** 打开弹层所需的最小供应商形状（宿主传注册表条目，也可以是「新建」的空壳） */
export interface ProviderLike {
  id: string
  name: string
  description: string | null
  enabled: boolean
  baseUrl: string | null
  keyHint: string | null
  /** null = 未声明（按端点来源推导）；true/false = 显式声明 */
  supportsSystemRole?: boolean | null
}

const emit = defineEmits<{ saved: [{ providerId: string; warnings: string[] }] }>()

const open = ref(false)
const busy = ref(false)
const error = ref('')
const isCreate = ref(true)
const provider = ref<ProviderLike | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const form = reactive({
  id: '', name: '', description: '', baseUrl: '', apiKey: '', enabled: true,
  /** auto = 未声明（跟随端点来源）；keep/fold = 显式声明 */
  supportsSystemRole: 'auto' as 'auto' | 'keep' | 'fold'
})

/* 系统提示词三态：文案与旧原生 select 逐字一致 */
const SUPPORTS_SYSTEM_ROLE_OPTIONS: Array<{ value: 'auto' | 'keep' | 'fold'; label: string }> = [
  { value: 'auto', label: '自动（按端点来源）' },
  { value: 'keep', label: '保留 system 消息' },
  { value: 'fold', label: '合并进用户消息' }
]

const isPlatform = computed(() => !isCreate.value && provider.value?.id === 'platform')
/** 平台通道停用是允许的（整团队改用自建网关时的正当操作），后端会拦住「全平台无路可走」那种 */
const enabledLabel = '参与路由'

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const idHint = computed(() => {
  const id = form.id.trim()
  if (!id) return ''
  if (id === 'platform') return '「platform」是平台通道保留 ID'
  if (!ID_PATTERN.test(id)) return '非法：只能用小写字母、数字、下划线、连字符，且以字母或数字开头'
  return ''
})

const canSubmit = computed(() => {
  if (isCreate.value && !ID_PATTERN.test(form.id.trim())) return false
  if (!form.name.trim()) return false
  if (!isPlatform.value && !form.baseUrl.trim()) return false
  return true
})

function openWith(target: ProviderLike | null): void {
  isCreate.value = !target
  provider.value = target
  error.value = ''
  form.id = target?.id ?? ''
  form.name = target?.name ?? ''
  form.description = target?.description ?? ''
  form.baseUrl = target?.baseUrl ?? ''
  form.apiKey = ''
  form.enabled = target?.enabled ?? true
  form.supportsSystemRole = target?.supportsSystemRole === true
    ? 'keep'
    : target?.supportsSystemRole === false ? 'fold' : 'auto'
  open.value = true
}

function close(): void {
  if (busy.value) return
  open.value = false
}

useEscape(() => open.value, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

async function submit(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      enabled: form.enabled,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      supportsSystemRole: form.supportsSystemRole === 'keep'
        ? true
        : form.supportsSystemRole === 'fold' ? false : null
    }
    const res = isCreate.value
      ? await adminModelProvidersApi.create({ ...payload, id: form.id.trim() })
      : await adminModelProvidersApi.update(provider.value!.id, payload)
    const data = res?.data ?? {}
    const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : []
    const providerId = isCreate.value ? form.id.trim() : provider.value!.id
    emit('saved', { providerId, warnings })
    open.value = false
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

defineExpose({ openWith })
</script>

<style scoped>
.mk-field__hint {
  display: block;
  margin-top: 4px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
</style>
