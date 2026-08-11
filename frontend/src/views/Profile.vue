<template>
  <CapabilityShell title="账户">
    <div class="profile-page">
      <el-result v-if="!profileLoading && profileLoadError" icon="error" title="账户信息加载失败" :sub-title="profileLoadError">
        <template #extra>
          <el-button type="primary" @click="loadUserProfile">重新加载</el-button>
        </template>
      </el-result>

      <el-alert v-if="learnerCenterLoadError" type="error" :closable="false" show-icon title="学习概览加载失败">
        <template #default>
          <span>{{ learnerCenterLoadError }}</span>
          <el-button link type="primary" @click="loadLearnerCenter">重新加载</el-button>
        </template>
      </el-alert>

      <!-- P1 修复：初次加载整页 v-loading 遮罩，避免硬空白 -->
      <div v-loading="profileLoading" element-loading-text="加载账户信息…" class="profile-content">
      <template v-if="!profileLoading && !profileLoadError">
      <section class="profile-grid">
        <article class="glass-card profile-card profile-card--hero">
          <div class="profile-identity">
            <el-avatar :size="64" class="profile-avatar">
              {{ user.name?.charAt(0) || '用' }}
            </el-avatar>
            <div class="profile-identity__main">
              <div class="profile-name-row">
                <template v-if="editingName">
                  <el-input
                    v-model="nameDraft"
                    size="small"
                    maxlength="64"
                    class="profile-name-input"
                    placeholder="输入新用户名"
                    @keyup.enter="handleSaveName"
                  />
                  <el-button size="small" type="primary" :loading="nameSubmitting" @click="handleSaveName">保存</el-button>
                  <el-button size="small" :disabled="nameSubmitting" @click="cancelEditName">取消</el-button>
                </template>
                <template v-else>
                  <h2>{{ user.name || '未命名用户' }}</h2>
                  <el-button size="small" text type="primary" @click="startEditName">编辑</el-button>
                </template>
              </div>
              <p>{{ user.email || '未绑定邮箱' }}</p>
            </div>
          </div>

          <div class="profile-stats">
            <article class="stat-card">
              <span>经验值（XP）</span>
              <strong>{{ user.xp || 0 }}</strong>
            </article>
            <article class="stat-card">
              <span>等级</span>
              <strong>{{ user.level || 1 }} 级</strong>
            </article>
            <article class="stat-card">
              <span>当前节奏</span>
              <strong>{{ paceLabel }}</strong>
            </article>
          </div>
        </article>

        <article v-if="!learnerCenterLoadError" class="glass-card profile-card">
          <div class="profile-card__head profile-card__head--spread">
            <div>
              <span class="section-kicker">当前学习</span>
              <h3>{{ currentPathTitle }}</h3>
            </div>
            <span v-if="currentPathId" class="status-chip">{{ paceLabel }}</span>
          </div>

          <div class="action-row">
            <el-button type="primary" @click="goCurrentPath">{{ currentPathId ? '继续当前路径' : '查看学习路径' }}</el-button>
            <el-button @click="router.push('/learning-state')">学习状态</el-button>
            <el-button @click="router.push('/goal-conversation')">新目标</el-button>
          </div>
        </article>
      </section>

      <section>
        <article class="glass-card profile-card">
          <div class="profile-card__head">
            <div>
              <span class="section-kicker">账号安全</span>
              <h3>修改密码</h3>
            </div>
          </div>

          <div class="grant-form-grid">
            <label class="grant-form-field">
              <span>当前密码</span>
              <el-input v-model="pwdForm.oldPassword" type="password" show-password placeholder="输入当前密码" />
            </label>
            <label class="grant-form-field">
              <span>新密码</span>
              <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少 8 位，含字母和数字" />
            </label>
            <label class="grant-form-field">
              <span>确认新密码</span>
              <el-input v-model="pwdForm.confirmPassword" type="password" show-password placeholder="再输入一次新密码" />
            </label>
          </div>

          <div class="action-row">
            <el-button type="primary" :loading="pwdSubmitting" :disabled="!pwdCanSubmit" @click="handleChangePassword">
              更新密码
            </el-button>
          </div>
        </article>
      </section>

      <section>
        <article class="glass-card profile-card profile-card--danger">
          <div class="profile-card__head">
            <div>
              <span class="section-kicker">危险操作</span>
              <h3>注销账号</h3>
            </div>
          </div>
          <p class="danger-desc">注销后账号将被标记为已删除，所有学习数据将无法继续访问。此操作需要输入当前密码确认，且不可自助撤销（可联系管理员恢复）。</p>
          <div class="danger-form">
            <el-input
              v-model="deactivatePassword"
              type="password"
              show-password
              placeholder="输入当前密码确认注销"
              style="max-width: 320px"
              @keyup.enter="handleDeactivate"
            />
            <el-button type="danger" plain :loading="deactivating" @click="handleDeactivate">注销账号</el-button>
          </div>
        </article>
      </section>

      <section>
        <article v-loading="projectionGrantLoading" class="glass-card profile-card grant-card">
          <div class="profile-card__head profile-card__head--spread">
            <div>
              <span class="section-kicker">协助排查</span>
              <h3>{{ projectionGrantStatusLabel }}{{ projectionGrantStatus === 'active' ? ` · ${projectionGrantExpiresAtLabel}` : '' }}</h3>
            </div>
            <el-button size="small" @click="loadProjectionGrant">刷新</el-button>
          </div>

          <div v-if="!projectionGrantLoadError" class="grant-form-grid">
            <label class="grant-form-field">
              <span>范围</span>
              <el-select v-model="projectionGrantForm.scope">
                <el-option label="仅学习台" value="dashboard" />
              </el-select>
            </label>

            <label class="grant-form-field">
              <span>时长（小时）</span>
              <el-input-number v-model="projectionGrantForm.expiresInHours" :min="1" :max="168" />
            </label>
          </div>

          <label v-if="!projectionGrantLoadError" class="grant-form-field grant-form-field--full">
            <span>说明（可选）</span>
            <el-input
              v-model="projectionGrantForm.note"
              type="textarea"
              :rows="2"
              maxlength="200"
              show-word-limit
              placeholder="问题简述"
            />
          </label>

          <div v-if="!projectionGrantLoadError" class="action-row">
            <el-button type="primary" :loading="projectionGrantSubmitting" @click="handleCreateProjectionGrant">
              {{ projectionGrantActionLabel }}
            </el-button>
            <el-button :disabled="projectionGrantStatus !== 'active' || projectionGrantSubmitting" :loading="projectionGrantRevoking" @click="handleRevokeProjectionGrant">
              撤销
            </el-button>
          </div>
        </article>
      </section>
      </template>
      </div>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
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
import { userAPI, type LearnerCenterSnapshot } from '../api/user'

const router = useRouter()
const userStore = useUserStore()
const api = request

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
const learnerCenter = ref<LearnerCenterSnapshot | null>(null)
const profileLoading = ref(true)
const profileLoadError = ref('')
const learnerCenterLoadError = ref('')
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

const paceLabel = computed(() => {
  const pace = learnerCenter.value?.learningControlState?.paceMode
  if (pace === 'recover') return '恢复'
  if (pace === 'push') return '推进'
  return '稳定'
})

const currentPathId = computed(() => learnerCenter.value?.knowledgeMemory?.currentPath?.learningPathId || '')
const currentPathTitle = computed(() => learnerCenter.value?.knowledgeMemory?.currentPath?.pathTitle || '暂无进行中的路径')
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

const goCurrentPath = () => {
  if (currentPathId.value) {
    router.push(`/learning-path/${currentPathId.value}`)
    return
  }
  router.push('/learning-paths')
}

onMounted(async () => {
  await Promise.all([loadUserProfile(), loadLearnerCenter(), loadProjectionGrant()])
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

async function loadLearnerCenter() {
  learnerCenterLoadError.value = ''
  try {
    learnerCenter.value = await userAPI.getLearnerCenter({ scope: 'global' })
  } catch (error: any) {
    learnerCenter.value = null
    learnerCenterLoadError.value = getErrorMessage(error, '无法读取学习概览，请稍后重试。')
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

// ---- 用户名编辑（P1-6：资料编辑 UI） ----
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

// ---- 用户自助注销（P0-3：密码确认 + 软删除） ----
async function handleDeactivate() {
  if (!deactivatePassword.value) {
    toast.error('请输入当前密码以确认注销')
    return
  }
  try {
    await ElMessageBox.confirm(
      '注销后账号将被标记为已删除，学习数据将无法继续访问；此操作不可自助撤销。确定注销吗？',
      '注销账号',
      { confirmButtonText: '确认注销', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
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
}

async function handleCreateProjectionGrant() {
  if (projectionGrantRevoking.value) return
  const wasActive = projectionGrantStatus.value === 'active'
  projectionGrantSubmitting.value = true
  try {
    const res = await createUserProjectionGrant({
      scope: projectionGrantForm.scope,
      expiresInHours: projectionGrantForm.expiresInHours,
      note: projectionGrantForm.note
    })

    projectionGrant.value = normalizeProjectionGrant(res)
    if (!projectionGrant.value) {
      await loadProjectionGrant()
    } else {
      hydrateProjectionGrantForm(projectionGrant.value)
      projectionGrantMessage.value = ''
    }
    toast.success(wasActive ? '授权已更新' : '授权已创建')
  } catch (error: any) {
    toast.error(getErrorMessage(error, wasActive ? '更新授权失败' : '创建授权失败'))
  } finally {
    projectionGrantSubmitting.value = false
  }
}

async function handleRevokeProjectionGrant() {
  if (projectionGrantSubmitting.value) return
  if (projectionGrantStatus.value !== 'active') {
    toast.info('当前没有可撤销的协助授权')
    return
  }

  try {
    await ElMessageBox.confirm(
      '撤销后，工作人员将不能再凭这份授权查看你的页面，确认继续吗？',
      '撤销协助授权',
      { type: 'warning' }
    )
  } catch {
    return
  }

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
}
</script>

<style scoped>
.profile-page {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.profile-content {
  min-height: 200px;
}

.profile-page .el-result {
  background: #fff;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 16px;
  padding: 32px;
}
.profile-page {
  display: grid;
  gap: 16px;
}

.profile-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  gap: 16px;
}

.profile-card {
  padding: 20px;
}

.profile-card__head {
  margin-bottom: 14px;
}

.profile-card__head--spread {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-kicker {
  display: inline-block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--blue-deep, #1f57cc);
}

.profile-card h2,
.profile-card h3 {
  margin: 0;
  color: var(--ink, #172033);
  letter-spacing: -0.02em;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
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
}

.profile-name-input {
  width: 220px;
  max-width: 100%;
}

.profile-card--danger {
  border-color: rgba(239, 117, 120, 0.35);
}

.danger-desc {
  margin: 0 0 14px;
  color: var(--muted, #5b6577);
  line-height: 1.65;
  font-size: 13.5px;
}

.danger-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.profile-avatar {
  background: var(--blue-deep, #1f57cc) !important;
  color: #fff !important;
  font-weight: 800;
  border: 0;
  box-shadow: none;
}

.profile-identity p,
.card-copy {
  margin: 6px 0 0;
  color: var(--muted, #5b6577);
  line-height: 1.65;
  font-size: 13.5px;
}

.profile-stats,
.snapshot-list {
  display: grid;
  gap: 10px;
}

.profile-stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.stat-card,
.snapshot-item {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--line, #e3e9f4);
  background: #f7faff;
}

.stat-card span,
.snapshot-item span {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #8492ab);
}

.stat-card strong,
.snapshot-item strong {
  display: block;
  margin-top: 6px;
  color: var(--ink, #172033);
  line-height: 1.45;
  font-size: 14px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: var(--blue-deep, #1f57cc);
  font-size: 12px;
  font-weight: 800;
}

.action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.grant-card {
  display: grid;
  gap: 14px;
}

.grant-card__head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.grant-card__notice {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px dashed rgba(52, 120, 246, 0.25);
  background: rgba(52, 120, 246, 0.04);
  color: var(--muted, #5b6577);
  line-height: 1.6;
  font-size: 13px;
}

.grant-card__summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grant-form-field span {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #8492ab);
}

.grant-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.grant-form-field {
  display: grid;
  gap: 6px;
}

.grant-form-field--full {
  width: 100%;
}

.grant-form-field :deep(.el-select),
.grant-form-field :deep(.el-input-number),
.grant-form-field :deep(.el-textarea) {
  width: 100%;
}

@media (max-width: 1100px) {
  .profile-grid,
  .profile-stats,
  .grant-card__summary,
  .grant-form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .profile-card {
    padding: 16px;
  }

  .profile-card__head--spread,
  .profile-identity,
  .action-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .action-row :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
