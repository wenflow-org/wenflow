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

      <template v-if="!profileLoading && !profileLoadError">
      <section class="profile-grid">
        <article class="glass-card profile-card profile-card--hero">
          <div class="profile-identity">
            <el-avatar :size="64" class="profile-avatar">
              {{ user.name?.charAt(0) || '用' }}
            </el-avatar>
            <div>
              <h2>{{ user.name || '未命名用户' }}</h2>
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
                <el-option label="全部学习页" value="full" />
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
import { useUserStore } from '../stores/user'
import { userAPI, type LearnerCenterSnapshot } from '../api/user'

const router = useRouter()
const userStore = useUserStore()

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
