<template>
  <Teleport to="body">
    <div v-if="open" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" :aria-label="user ? '编辑用户' : '新建用户'">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ user ? `编辑用户 · ${user.name}` : '新建用户' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
            <span class="mk-field__label">昵称 <em class="mk-field__req">*</em></span>
            <input v-model="form.name" class="mk-field__input" placeholder="例如：陈晓" />
            <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.email }">
            <span class="mk-field__label">邮箱 <em class="mk-field__req">*</em></span>
            <input v-model="form.email" class="mk-field__input" placeholder="name@example.com" />
            <span v-if="errors.email" class="mk-field__err">{{ errors.email }}</span>
          </label>
          <label v-if="isLive" class="mk-field" :class="{ 'mk-field--error': errors.password }">
            <span class="mk-field__label">{{ user ? '重置密码' : '初始密码' }} <em class="mk-field__req">*</em></span>
            <input v-model="form.password" type="password" class="mk-field__input" :placeholder="user ? '留空表示不修改' : '至少 8 位，含字母和数字'" />
            <span v-if="errors.password" class="mk-field__err">{{ errors.password }}</span>
          </label>
          <label v-if="isLive && !user" class="mk-field" :class="{ 'mk-field--error': errors.confirmPassword }">
            <span class="mk-field__label">确认密码 <em class="mk-field__req">*</em></span>
            <input v-model="form.confirmPassword" type="password" class="mk-field__input" placeholder="再输入一次" />
            <span v-if="errors.confirmPassword" class="mk-field__err">{{ errors.confirmPassword }}</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">角色</span>
            <select v-model="form.admin" class="mk-field__select">
              <option :value="false">用户</option>
              <option :value="true">管理员</option>
            </select>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="close">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : user ? '保存修改' : '创建' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isLive } from './store'
import { liveCreateUser, errMsg } from './live'
import { adminUsersApi } from '@/api/adminApi'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'

/** 新建 / 编辑用户共用的表单弹窗：账号列表行内「编辑」与详情「账号与许可」卡头「编辑」打开同一份。 */
export interface EditableUser {
  id: string
  name: string
  email: string
  admin: boolean
}

const props = defineProps<{ open: boolean; user?: EditableUser | null }>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'saved', payload: { mode: 'create' } | { mode: 'edit'; id: string; name: string; email: string; admin: boolean }): void
}>()

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/
const PASSWORD_RULE_MSG = '密码至少 8 位，且同时包含字母和数字'

const saving = ref(false)
const form = ref({ name: '', email: '', password: '', confirmPassword: '', admin: false })
const errors = ref<{ name?: string; email?: string; password?: string; confirmPassword?: string }>({})

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => props.open), panelRef)
useMaskClose(maskRef, close)
useEscape(() => props.open, close)

function close() {
  if (saving.value) return
  emit('update:open', false)
}

function resetForm() {
  const u = props.user
  form.value = u
    ? { name: u.name, email: u.email, password: '', confirmPassword: '', admin: u.admin }
    : { name: '', email: '', password: '', confirmPassword: '', admin: false }
  errors.value = {}
}

watch(() => [props.open, props.user?.id], () => {
  if (props.open) resetForm()
}, { immediate: true })

async function save() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入昵称'
  if (!form.value.email.trim()) errors.value.email = '请输入邮箱'
  else if (!/^\S+@\S+\.\S+$/.test(form.value.email.trim())) errors.value.email = '邮箱格式不正确'
  const target = props.user
  if (isLive.value && (!target || form.value.password) && !PASSWORD_RULE.test(form.value.password)) {
    errors.value.password = PASSWORD_RULE_MSG
  }
  if (isLive.value && !target && form.value.confirmPassword !== form.value.password) {
    errors.value.confirmPassword = '两次输入的密码不一致'
  }
  if (Object.keys(errors.value).length) return

  saving.value = true
  try {
    if (target) {
      await adminUsersApi.updateUser(target.id, {
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        isAdmin: form.value.admin,
        ...(form.value.password ? { password: form.value.password } : {})
      })
      toast.success('用户已更新')
      emit('saved', {
        mode: 'edit',
        id: target.id,
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        admin: form.value.admin
      })
    } else {
      await liveCreateUser({
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        password: form.value.password,
        admin: form.value.admin
      })
      toast.success('用户已创建')
      emit('saved', { mode: 'create' })
    }
    emit('update:open', false)
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}
</script>
