<template>
  <CapabilityShell title="账户">
    <div class="profile-page">
      <div v-if="!profileLoading && profileLoadError" class="uc-card">
        <div class="uc-errorbar" role="alert">
          {{ profileLoadError }}
          <button type="button" class="uc-errorbar__retry" @click="loadUserProfile">重新加载</button>
        </div>
      </div>

      <div v-if="profileLoading" class="uc-loading">
        <span class="uc-spinner"></span>
        加载账户信息…
      </div>

      <template v-if="!profileLoading && !profileLoadError">
        <!-- 资料卡 -->
        <article class="uc-card">
          <div class="profile-identity">
            <div class="profile-avatar">{{ user.name?.charAt(0) || '用' }}</div>
            <div class="profile-identity__main">
              <div class="profile-name-row">
                <template v-if="editingName">
                  <input
                    v-model="nameDraft"
                    class="uc-field__input profile-name-input"
                    maxlength="64"
                    placeholder="输入新用户名"
                    @keyup.enter="handleSaveName"
                  />
                  <button type="button" class="uc-btn uc-btn--primary uc-btn--sm" :disabled="nameSubmitting" @click="handleSaveName">
                    {{ nameSubmitting ? '保存中…' : '保存' }}
                  </button>
                  <button type="button" class="uc-btn uc-btn--sm" :disabled="nameSubmitting" @click="cancelEditName">取消</button>
                </template>
                <template v-else>
                  <h2>{{ user.name || '未命名用户' }}</h2>
                  <button type="button" class="uc-btn uc-btn--link" @click="startEditName">编辑</button>
                </template>
              </div>
              <p class="profile-email">{{ user.email || '未绑定邮箱' }}</p>
            </div>
          </div>

          <div class="profile-stats">
            <div class="stat-card">
              <span>经验值（XP）</span>
              <strong>{{ user.xp || 0 }}</strong>
            </div>
            <div class="stat-card">
              <span>等级</span>
              <strong>{{ user.level || 1 }} 级</strong>
            </div>
          </div>
        </article>

        <!-- 账号安全：修改密码 -->
        <article class="uc-card">
          <div class="uc-card__head">
            <div>
              <h3>修改密码</h3>
              <p>定期更换密码，保障账号安全</p>
            </div>
          </div>
          <div class="pwd-grid">
            <label class="uc-field">
              <span class="uc-field__label">当前密码</span>
              <input v-model="pwdForm.oldPassword" type="password" class="uc-field__input" placeholder="输入当前密码" />
            </label>
            <label class="uc-field">
              <span class="uc-field__label">新密码</span>
              <input v-model="pwdForm.newPassword" type="password" class="uc-field__input" placeholder="至少 8 位，含字母和数字" />
            </label>
            <label class="uc-field">
              <span class="uc-field__label">确认新密码</span>
              <input v-model="pwdForm.confirmPassword" type="password" class="uc-field__input" placeholder="再输入一次新密码" />
            </label>
          </div>
          <div class="uc-card__foot">
            <button type="button" class="uc-btn uc-btn--primary" :disabled="!pwdCanSubmit" @click="handleChangePassword">
              {{ pwdSubmitting ? '更新中…' : '更新密码' }}
            </button>
          </div>
        </article>

        <!-- 协助排查 -->
        <article class="uc-card">
          <template v-if="projectionGrantLoading">
            <div class="uc-loading">
              <span class="uc-spinner"></span>
              读取授权状态…
            </div>
          </template>
          <template v-else>
          <div class="uc-card__head uc-card__head--spread">
            <div>
              <h3>协助排查</h3>
              <p>{{ projectionGrantStatusLabel }}{{ projectionGrantStatus === 'active' ? ` · ${projectionGrantExpiresAtLabel}` : '' }}</p>
            </div>
            <button type="button" class="uc-btn uc-btn--sm" @click="loadProjectionGrant">刷新</button>
          </div>

          <template v-if="!projectionGrantLoadError">
            <div class="grant-form-grid">
              <div class="uc-field">
                <span class="uc-field__label">范围</span>
                <div class="grant-scope-fixed">仅学习台</div>
              </div>
              <label class="uc-field">
                <span class="uc-field__label">时长（小时）</span>
                <input
                  v-model.number="projectionGrantForm.expiresInHours"
                  type="number"
                  min="1"
                  max="168"
                  class="uc-field__input"
                />
              </label>
            </div>
            <label class="uc-field grant-form-full">
              <span class="uc-field__label">说明（可选）</span>
              <textarea v-model="projectionGrantForm.note" class="uc-field__input" rows="2" maxlength="200" placeholder="问题简述"></textarea>
            </label>
            <div class="uc-card__foot">
              <button type="button" class="uc-btn uc-btn--primary" :disabled="projectionGrantSubmitting" @click="handleCreateProjectionGrant">
                {{ projectionGrantSubmitting ? '提交中…' : projectionGrantActionLabel }}
              </button>
              <button type="button" class="uc-btn" :disabled="projectionGrantStatus !== 'active' || projectionGrantSubmitting" @click="handleRevokeProjectionGrant">
                {{ projectionGrantRevoking ? '撤销中…' : '撤销' }}
              </button>
            </div>
          </template>
          </template>
        </article>

        <!-- 危险操作：注销 -->
        <article class="uc-card uc-card--danger">
          <div class="uc-card__head">
            <div>
              <h3>注销账号</h3>
              <p>注销后账号将被标记为已删除，学习数据将无法继续访问；此操作不可自助撤销（可联系管理员恢复）。</p>
            </div>
          </div>
          <div class="danger-form">
            <input v-model="deactivatePassword" type="password" class="uc-field__input" placeholder="输入当前密码确认注销" @keyup.enter="handleDeactivate" />
            <button type="button" class="uc-btn uc-btn--danger" :disabled="deactivating" @click="handleDeactivate">
              {{ deactivating ? '注销中…' : '注销账号' }}
            </button>
          </div>
        </article>
        </template>
    </div>

    <UcConfirm :state="confirmState" />
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
import UcConfirm from '@/components/user/UcConfirm.vue'
import { useUcConfirm } from '@/components/user/useUcConfirm'
import {
  createUserProjectionGrant,
  getProjectionGrantStatus,
  getUserProjectionGrant,
  normalizeProjectionGrant,
  revokeUserProjectionGrant,
  type ProjectionGrant,
  type ProjectionGrantScope
} from '@/api/userCustom'
import { toast } from '@/utils/toast'
import request from '@/utils/api'
import { useUserStore } from '../stores/user'
import '@/components/user/uc.css'

const router = useRouter()
const userStore = useUserStore()
const api = request
const { state: confirmState, openConfirm } = useUcConfirm()

/* ---------- 修改密码 ---------- */
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const pwdSubmitting = ref(false)
const pwdCanSubmit = computed(() =>
  pwdForm.oldPassword.length > 0 && pwdForm.newPassword.length >= 8 && pwdForm.confirmPassword.length > 0
)

async function handleChangePassword() {
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    toast.error('两次输入的新密码不一致')
    return
  }
  if (!/[a-zA-Z]/.test(pwdForm.newPassword) || !/[0-9]/.test(pwdForm.newPassword)) {
    toast.error('新密码需同时包含字母和数字')
    return
  }
  pwdSubmitting.value = true
  try {
    await request.post('/auth/change-password', {
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword
    })
    toast.success('密码已更新，下次登录请使用新密码')
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
  } catch (e: any) {
    toast.error(e?.response?.data?.error?.message || e?.message || '修改失败，请稍后再试')
  } finally {
    pwdSubmitting.value = false
  }
}

const user = ref({
  name: '',
  email: '',
  xp: 0,
  level: 1,
  role: 'user'
})
const profileLoading = ref(true)
const profileLoadError = ref('')
// 用户名编辑
const editingName = ref(false)
const nameDraft = ref('')
const nameSubmitting = ref(false)
// 注销
const deactivatePassword = ref('')
const deactivating = ref(false)
const projectionGrant = ref<ProjectionGrant | null>(null)
const projectionGrantLoading = ref(false)
const projectionGrantSubmitting = ref(false)
const projectionGrantRevoking = ref(false)
const projectionGrantMessage = ref('')
const projectionGrantLoadError = ref(false)
const projectionGrantForm = reactive({
  scope: 'dashboard' as ProjectionGrantScope,
  expiresInHours: 24,
  note: ''
})

const projectionGrantStatus = computed(() => getProjectionGrantStatus(projectionGrant.value))
const projectionGrantStatusLabel = computed(() => {
  if (projectionGrantLoadError.value) return '读取失败'
  if (projectionGrantStatus.value === 'active') return '已授权'
  if (projectionGrantStatus.value === 'expired') return '已过期'
  if (projectionGrantStatus.value === 'revoked') return '已撤销'
  return '未授权'
})
const projectionGrantExpiresAtLabel = computed(() => formatDateTime(projectionGrant.value?.expiresAt))
const projectionGrantActionLabel = computed(() => (projectionGrantStatus.value === 'active' ? '更新授权' : `授权 ${projectionGrantForm.expiresInHours} 小时`))

onMounted(async () => {
  await Promise.all([loadUserProfile(), loadProjectionGrant()])
})

function formatDateTime(value?: string | null) {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未设置'
  return date.toLocaleString('zh-CN')
}

function getErrorMessage(error: any, fallback: string) {
  return error?.response?.data?.error?.message || error?.response?.data?.error || error?.message || fallback
}

function hydrateProjectionGrantForm(grant: ProjectionGrant | null) {
  if (!grant) return
  projectionGrantForm.scope = grant.scope === 'full' ? 'full' : 'dashboard'
  projectionGrantForm.note = grant.note || grant.purpose || ''
}

async function loadUserProfile() {
  profileLoading.value = true
  profileLoadError.value = ''
  try {
    await userStore.fetchProfile()
    if (!userStore.user) throw new Error('未返回账户信息')
    user.value = {
      name: userStore.user.name,
      email: userStore.user.email,
      xp: userStore.user.xp,
      level: userStore.user.level,
      role: (userStore.user as any).role || 'user'
    }
  } catch (error: any) {
    profileLoadError.value = getErrorMessage(error, '无法读取账户信息，请稍后重试。')
  } finally {
    profileLoading.value = false
  }
}

async function loadProjectionGrant() {
  projectionGrantLoading.value = true
  projectionGrantMessage.value = ''
  projectionGrantLoadError.value = false
  try {
    const res = await getUserProjectionGrant()
    projectionGrant.value = normalizeProjectionGrant(res)
    hydrateProjectionGrantForm(projectionGrant.value)

    if (!projectionGrant.value) {
      projectionGrantMessage.value = '未授权'
    }
  } catch (error: any) {
    projectionGrant.value = null
    if (error?.response?.status === 404) {
      projectionGrantMessage.value = '未授权'
      return
    }
    projectionGrantMessage.value = '读取失败'
    projectionGrantLoadError.value = true
    console.error('读取协助授权失败:', error)
  } finally {
    projectionGrantLoading.value = false
  }
}

// ---- 用户名编辑 ----
function startEditName() {
  nameDraft.value = user.value.name || ''
  editingName.value = true
}

function cancelEditName() {
  editingName.value = false
  nameDraft.value = ''
}

async function handleSaveName() {
  const trimmed = nameDraft.value.trim()
  if (!trimmed) {
    toast.error('用户名不能为空')
    return
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(trimmed)) {
    toast.error('用户名仅支持字母、数字、下划线和连字符')
    return
  }
  nameSubmitting.value = true
  try {
    const updated = await userStore.updateProfile({ name: trimmed })
    user.value.name = updated.name || trimmed
    editingName.value = false
    toast.success('用户名已更新')
  } catch (error: any) {
    toast.error(getErrorMessage(error, '更新用户名失败'))
  } finally {
    nameSubmitting.value = false
  }
}

// ---- 协助排查 ----
async function handleCreateProjectionGrant() {
  if (projectionGrantSubmitting.value) return
  projectionGrantSubmitting.value = true
  try {
    await createUserProjectionGrant({
      scope: projectionGrantForm.scope,
      expiresInHours: projectionGrantForm.expiresInHours,
      note: projectionGrantForm.note
    })
    toast.success('协助授权已开通')
    await loadProjectionGrant()
  } catch (error: any) {
    toast.error(getErrorMessage(error, '开通协助授权失败'))
  } finally {
    projectionGrantSubmitting.value = false
  }
}

// ---- 手作确认弹窗（共享 UcConfirm） ----
async function handleRevokeProjectionGrant() {
  openConfirm(
    '撤销协助授权',
    '撤销后，工作人员将不能再凭这份授权查看你的页面，确认继续吗？',
    async () => {
      projectionGrantRevoking.value = true
      try {
        const res = await revokeUserProjectionGrant(projectionGrant.value?.id)
        projectionGrant.value = normalizeProjectionGrant(res)
        if (!projectionGrant.value) {
          projectionGrantMessage.value = '已撤销'
        }
        toast.success('协助授权已撤销')
        await loadProjectionGrant()
      } catch (error: any) {
        toast.error(getErrorMessage(error, '撤销协助授权失败'))
      } finally {
        projectionGrantRevoking.value = false
      }
    },
    { confirmText: '撤销', danger: true }
  )
}

// ---- 注销 ----
async function handleDeactivate() {
  if (!deactivatePassword.value) {
    toast.error('请输入当前密码以确认注销')
    return
  }
  openConfirm(
    '注销账号',
    '注销后账号将被标记为已删除，学习数据将无法继续访问；此操作不可自助撤销。确定注销吗？',
    async () => {
      deactivating.value = true
      try {
        await api.post('/users/me/deactivate', { password: deactivatePassword.value })
        await userStore.logout()
        toast.success('账号已注销')
        await router.replace('/login')
      } catch (error: any) {
        toast.error(getErrorMessage(error, '注销失败，请稍后重试'))
      } finally {
        deactivating.value = false
        deactivatePassword.value = ''
      }
    },
    { confirmText: '确认注销', danger: true }
  )
}
</script>

<style scoped>
.profile-page {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.profile-content {
  display: grid;
  gap: 16px;
  min-height: 200px;
  min-width: 0;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}

.profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--blue, #3478f6), var(--accent, #8d6bff));
  color: #fff;
  font-size: 24px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.profile-identity__main {
  min-width: 0;
  flex: 1;
}

.profile-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.profile-name-row h2 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
}

.profile-name-input {
  width: 220px;
  max-width: 100%;
}

.profile-email {
  margin: 5px 0 0;
  color: var(--muted, #5b6577);
  font-size: 13.5px;
}

.profile-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  max-width: 420px;
}

.stat-card {
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--line, #e3e9f4);
  background: var(--canvas, #f3f6fb);
  display: grid;
  gap: 6px;
}

.stat-card span {
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #67758f);
}

.stat-card strong {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink, #172033);
}

.pwd-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 900px) {
  .pwd-grid {
    grid-template-columns: 1fr;
  }
}

.uc-card__foot {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.grant-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
  max-width: 520px;
}

@media (max-width: 640px) {
  .grant-form-grid {
    grid-template-columns: 1fr;
  }
}

.grant-scope-fixed {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(52, 120, 246, 0.35);
  background: rgba(52, 120, 246, 0.07);
  color: var(--blue-deep, #1f57cc);
  font-size: 14px;
  font-weight: 700;
}

.grant-form-full {
  max-width: 520px;
}

.uc-card--danger {
  border-color: rgba(239, 117, 120, 0.35);
}

.danger-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.danger-form .uc-field__input {
  max-width: 320px;
}

.confirm-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink, #172033);
}
</style>
