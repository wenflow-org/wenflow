<template>
  <CapabilityShell
    title="账户概览"
    description="查看账户信息和当前学习进度。更详细的学习分析可前往“学习状态”。"
  >
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
          <div class="profile-card__head">
            <span class="section-kicker">账户概览</span>
          </div>

          <div class="profile-identity">
            <el-avatar :size="76" class="profile-avatar">
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
            <span class="status-chip">{{ paceLabel }}</span>
          </div>

          <p class="card-copy">{{ currentPathDescription }}</p>

          <div class="snapshot-list">
            <div class="snapshot-item">
              <span>路径状态</span>
              <strong>{{ currentPathMeta }}</strong>
            </div>
            <div class="snapshot-item">
              <span>下一步</span>
              <strong>{{ nextActionLabel }}</strong>
            </div>
          </div>

          <div class="action-row">
            <el-button type="primary" @click="goCurrentPath">{{ currentPathId ? '继续当前路径' : '查看学习路径' }}</el-button>
            <el-button @click="router.push('/learning-state')">查看学习状态</el-button>
          </div>
        </article>
      </section>

      <section v-if="!learnerCenterLoadError" class="profile-grid profile-grid--bottom">
        <article class="glass-card profile-card">
          <div class="profile-card__head">
            <div>
              <span class="section-kicker">快捷入口</span>
              <h3>常用入口</h3>
            </div>
          </div>

          <div class="shortcut-list">
            <button type="button" class="shortcut-card" @click="router.push('/learning-state')">
              <span>学习状态</span>
              <strong>查看节奏、掌握度与建议</strong>
              <p>查看近期学习状态和下一步建议。</p>
            </button>
            <button type="button" class="shortcut-card" @click="goCurrentPath">
              <span>当前路径</span>
              <strong>回到正在推进的学习路径</strong>
              <p>没有进行中的路径时，会打开学习路径总览。</p>
            </button>
            <button type="button" class="shortcut-card" @click="router.push('/goal-conversation')">
              <span>新目标</span>
              <strong>规划新的学习目标</strong>
              <p>从一个新的问题开始整理学习方向。</p>
            </button>
          </div>
        </article>

        <article class="glass-card profile-card">
          <div class="profile-card__head">
            <div>
              <span class="section-kicker">状态摘要</span>
          <h3>当前状态</h3>
            </div>
          </div>

          <div class="snapshot-list snapshot-list--stacked">
            <div class="snapshot-item">
              <span>路径状态</span>
              <strong>{{ currentPathMeta }}</strong>
            </div>
            <div class="snapshot-item">
              <span>节奏模式</span>
              <strong>{{ paceLabel }}</strong>
            </div>
            <div class="snapshot-item">
              <span>推荐动作</span>
              <strong>{{ nextActionLabel }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section>
        <article v-loading="projectionGrantLoading" class="glass-card profile-card grant-card">
          <div class="profile-card__head profile-card__head--spread">
            <div>
              <span class="section-kicker">问题协助</span>
              <h3>授权工作人员协助排查问题</h3>
            </div>
            <div class="grant-card__head-actions">
              <el-tag :type="projectionGrantStatusTagType" effect="plain">{{ projectionGrantStatusLabel }}</el-tag>
              <el-button size="small" @click="loadProjectionGrant">刷新授权状态</el-button>
            </div>
          </div>

          <p class="card-copy">
            授权后，平台工作人员可在限定时间内查看你选择的页面，用于排查你反馈的问题。授权不包含你的登录密码。
          </p>

          <div v-if="projectionGrantMessage" class="grant-card__notice">
            {{ projectionGrantMessage }}
          </div>

          <div v-if="!projectionGrantLoadError" class="snapshot-list grant-card__summary">
            <div class="snapshot-item">
              <span>当前状态</span>
              <strong>{{ projectionGrantStatusLabel }}</strong>
            </div>
            <div class="snapshot-item">
              <span>开放范围</span>
              <strong>{{ projectionGrantScopeLabel }}</strong>
            </div>
            <div class="snapshot-item">
              <span>创建时间</span>
              <strong>{{ projectionGrantGrantedAtLabel }}</strong>
            </div>
            <div class="snapshot-item">
              <span>到期时间</span>
              <strong>{{ projectionGrantExpiresAtLabel }}</strong>
            </div>
          </div>

          <div v-if="!projectionGrantLoadError" class="grant-card__note">
            <span>协助说明</span>
            <strong>{{ projectionGrantNoteLabel }}</strong>
          </div>

          <div v-if="!projectionGrantLoadError" class="grant-form-grid">
            <label class="grant-form-field">
              <span>开放范围</span>
              <el-select v-model="projectionGrantForm.scope">
                <el-option label="仅查看学习台" value="dashboard" />
                <el-option label="查看全部学习页面" value="full" />
              </el-select>
            </label>

            <label class="grant-form-field">
              <span>有效时长（小时）</span>
              <el-input-number v-model="projectionGrantForm.expiresInHours" :min="1" :max="168" />
            </label>
          </div>

          <label v-if="!projectionGrantLoadError" class="grant-form-field grant-form-field--full">
            <span>协助说明</span>
            <el-input
              v-model="projectionGrantForm.note"
              type="textarea"
              :rows="3"
              maxlength="200"
              show-word-limit
              placeholder="例如：同意工作人员在 24 小时内查看学习台，协助定位我反馈的问题。"
            />
          </label>

          <div v-if="!projectionGrantLoadError" class="action-row">
            <el-button type="primary" :loading="projectionGrantSubmitting" @click="handleCreateProjectionGrant">
              {{ projectionGrantActionLabel }}
            </el-button>
            <el-button :disabled="projectionGrantStatus !== 'active' || projectionGrantSubmitting" :loading="projectionGrantRevoking" @click="handleRevokeProjectionGrant">
              立即撤销授权
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
const currentPathTitle = computed(() => learnerCenter.value?.knowledgeMemory?.currentPath?.pathTitle || '还没有进行中的学习路径')
const currentPathDescription = computed(() => {
  if (currentPathId.value) {
    return '从这里快速回到当前路径，继续推进最近正在学的任务和阶段。'
  }
  return '你还没有进行中的路径，可以先规划目标或查看学习路径总览。'
})
const currentPathMeta = computed(() => (currentPathId.value ? '进行中的学习路径' : '暂无进行中的路径'))
const nextActionLabel = computed(() => (currentPathId.value ? '继续当前路径' : '规划或选择一条路径'))
const projectionGrantStatus = computed(() => getProjectionGrantStatus(projectionGrant.value))
const projectionGrantStatusLabel = computed(() => {
  if (projectionGrantLoadError.value) return '读取失败'
  if (projectionGrantStatus.value === 'active') return '已授权'
  if (projectionGrantStatus.value === 'expired') return '授权已过期'
  if (projectionGrantStatus.value === 'revoked') return '授权已撤销'
  return '未授权'
})
const projectionGrantStatusTagType = computed(() => {
  if (projectionGrantStatus.value === 'active') return 'success'
  if (projectionGrantStatus.value === 'expired') return 'warning'
  if (projectionGrantStatus.value === 'revoked') return 'info'
  return 'info'
})
const projectionGrantScopeLabel = computed(() => {
  const scope = projectionGrant.value?.scope || projectionGrantForm.scope
  return scope === 'full' ? '查看全部学习页面' : '仅查看学习台'
})
const projectionGrantGrantedAtLabel = computed(() => formatDateTime(projectionGrant.value?.grantedAt))
const projectionGrantExpiresAtLabel = computed(() => formatDateTime(projectionGrant.value?.expiresAt))
const projectionGrantNoteLabel = computed(() => projectionGrant.value?.note?.trim() || '未填写协助说明')
const projectionGrantActionLabel = computed(() => (projectionGrantStatus.value === 'active' ? '更新授权范围' : `授权 ${projectionGrantForm.expiresInHours} 小时`))

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
      projectionGrantMessage.value = '当前还没有生效中的协助授权。'
    }
  } catch (error: any) {
    projectionGrant.value = null
    if (error?.response?.status === 404) {
      projectionGrantMessage.value = '当前还没有生效中的协助授权。'
      return
    }
    projectionGrantMessage.value = '协助授权读取失败，请稍后重试。'
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
      projectionGrantMessage.value = '协助授权已撤销。'
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

<style scoped lang="scss">
.profile-page {
  display: grid;
  gap: 1.5rem;
}

.glass-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(248, 250, 255, 0.72));
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 24px;
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 36px rgba(31, 87, 204, 0.07);
}

[data-theme='dark'] .glass-card {
  background: linear-gradient(180deg, rgba(26, 37, 47, 0.84), rgba(15, 24, 32, 0.76));
  border-color: rgba(96, 165, 250, 0.1);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.22);
}

.profile-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 1.25rem;
}

.profile-grid--bottom {
  grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.75fr);
}

.profile-card {
  padding: 1.4rem;
}

.profile-card__head {
  margin-bottom: 1rem;
}

.profile-card__head--spread {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-kicker {
  display: inline-flex;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-secondary-dark);
}

.profile-card h2,
.profile-card h3 {
  margin: 0;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.2rem;
}

.profile-avatar {
  border: 2px solid rgba(255, 255, 255, 0.75);
  box-shadow: 0 14px 28px rgba(52, 120, 246, 0.16);
}

.profile-identity p,
.card-copy,
.shortcut-card p {
  margin: 8px 0 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.profile-stats,
.shortcut-list,
.snapshot-list {
  display: grid;
  gap: 12px;
}

.profile-stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.stat-card,
.snapshot-item,
.shortcut-card {
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.05), rgba(67, 176, 216, 0.035));
}

[data-theme='dark'] .stat-card,
[data-theme='dark'] .snapshot-item,
[data-theme='dark'] .shortcut-card {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(67, 176, 216, 0.05));
  border-color: rgba(96, 165, 250, 0.1);
}

.stat-card span,
.snapshot-item span,
.shortcut-card span {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-card strong,
.snapshot-item strong,
.shortcut-card strong {
  display: block;
  margin-top: 8px;
  color: var(--color-primary-dark);
  line-height: 1.45;
}

[data-theme='dark'] .stat-card strong,
[data-theme='dark'] .snapshot-item strong,
[data-theme='dark'] .shortcut-card strong {
  color: #9fc3ff;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(67, 176, 216, 0.12);
  color: #2f89a8;
  font-size: 12px;
  font-weight: 700;
}

.action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.action-row :deep(.el-button--primary) {
  border: none;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
}

.action-row :deep(.el-button:not(.el-button--primary)) {
  border-color: rgba(52, 120, 246, 0.16);
  color: var(--color-primary-dark);
  background: rgba(255, 255, 255, 0.56);
}

[data-theme='dark'] .action-row :deep(.el-button:not(.el-button--primary)) {
  border-color: rgba(96, 165, 250, 0.16);
  color: #b8d2ff;
  background: rgba(15, 23, 42, 0.36);
}

.shortcut-list {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grant-card {
  display: grid;
  gap: 16px;
}

.grant-card__head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.grant-card__notice {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px dashed rgba(52, 120, 246, 0.16);
  background: rgba(52, 120, 246, 0.04);
  color: var(--text-secondary);
  line-height: 1.6;
}

.grant-card__summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.grant-card__note {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.05), rgba(67, 176, 216, 0.035));
}

.grant-card__note span,
.grant-form-field span {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
}

.grant-card__note strong {
  color: var(--color-primary-dark);
  line-height: 1.6;
}

.grant-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.grant-form-field {
  display: grid;
  gap: 8px;
}

.grant-form-field--full {
  width: 100%;
}

.grant-form-field :deep(.el-select),
.grant-form-field :deep(.el-input-number),
.grant-form-field :deep(.el-textarea) {
  width: 100%;
}

[data-theme='dark'] .grant-card__notice {
  border-color: rgba(96, 165, 250, 0.16);
  background: rgba(37, 99, 235, 0.1);
}

[data-theme='dark'] .grant-card__note {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(67, 176, 216, 0.05));
  border-color: rgba(96, 165, 250, 0.1);
}

[data-theme='dark'] .grant-card__note strong {
  color: #9fc3ff;
}

.shortcut-card {
  text-align: left;
  cursor: pointer;
}

.shortcut-card:hover {
  border-color: rgba(52, 120, 246, 0.16);
}

.snapshot-list--stacked {
  grid-template-columns: 1fr;
}

@media (max-width: 1100px) {
  .profile-grid,
  .profile-grid--bottom,
  .shortcut-list,
  .profile-stats,
  .grant-card__summary,
  .grant-form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .profile-card {
    padding: 1.15rem;
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
