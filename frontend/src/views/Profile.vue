<template>
  <CapabilityShell
    title="账户设置"
    description="查看你的账户信息、当前学习节奏与最近的学习入口。学习者画像和更细的诊断信息已统一收口到学习状态页。"
  >
    <div class="profile-page">
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
              <span>XP</span>
              <strong>{{ user.xp || 0 }}</strong>
            </article>
            <article class="stat-card">
              <span>等级</span>
              <strong>Lv. {{ user.level || 1 }}</strong>
            </article>
            <article class="stat-card">
              <span>当前节奏</span>
              <strong>{{ paceLabel }}</strong>
            </article>
          </div>
        </article>

        <article class="glass-card profile-card">
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
            <el-button type="primary" @click="goCurrentPath">查看当前路径</el-button>
            <el-button @click="router.push('/learning-state')">前往学习状态</el-button>
          </div>
        </article>
      </section>

      <section class="profile-grid profile-grid--bottom">
        <article class="glass-card profile-card">
          <div class="profile-card__head">
            <div>
              <span class="section-kicker">快捷入口</span>
              <h3>继续当前学习闭环</h3>
            </div>
          </div>

          <div class="shortcut-list">
            <button type="button" class="shortcut-card" @click="router.push('/learning-state')">
              <span>学习状态</span>
              <strong>查看节奏、掌握度与建议</strong>
              <p>统一查看学习者画像、状态趋势和重调建议。</p>
            </button>
            <button type="button" class="shortcut-card" @click="goCurrentPath">
              <span>当前路径</span>
              <strong>回到正在推进的学习路径</strong>
              <p>如果还没有激活路径，会跳转到学习路径总览。</p>
            </button>
            <button type="button" class="shortcut-card" @click="router.push('/goal-conversation')">
              <span>新目标</span>
              <strong>从一个新问题重新开始规划</strong>
              <p>切换主题或重新整理方向时，从这里发起新的目标规划。</p>
            </button>
          </div>
        </article>

        <article class="glass-card profile-card">
          <div class="profile-card__head">
            <div>
              <span class="section-kicker">状态摘要</span>
              <h3>学习快照</h3>
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
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
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

const paceLabel = computed(() => {
  const pace = learnerCenter.value?.learningControlState?.paceMode
  if (pace === 'recover') return '恢复'
  if (pace === 'push') return '推进'
  return '稳定'
})

const currentPathId = computed(() => learnerCenter.value?.knowledgeMemory?.currentPath?.learningPathId || '')
const currentPathTitle = computed(() => learnerCenter.value?.knowledgeMemory?.currentPath?.pathTitle || '还没有激活中的学习路径')
const currentPathDescription = computed(() => {
  if (currentPathId.value) {
    return '从这里快速回到当前路径，继续推进最近正在学的任务和阶段。'
  }
  return '你还没有激活中的路径，可以先去目标规划或学习路径总览创建新的学习路线。'
})
const currentPathMeta = computed(() => (currentPathId.value ? '进行中的学习路径' : '暂无进行中路径'))
const nextActionLabel = computed(() => (currentPathId.value ? '回到当前路径继续学习' : '先创建或选择一条路径'))

const goCurrentPath = () => {
  if (currentPathId.value) {
    router.push(`/learning-path/${currentPathId.value}`)
    return
  }
  router.push('/learning-paths')
}

onMounted(async () => {
  await Promise.all([loadUserProfile(), loadLearnerCenter()])
})

async function loadUserProfile() {
  await userStore.fetchProfile()
  if (userStore.user) {
    user.value = {
      name: userStore.user.name,
      email: userStore.user.email,
      xp: userStore.user.xp,
      level: userStore.user.level,
      role: (userStore.user as any).role || 'user'
    }
  }
}

async function loadLearnerCenter() {
  learnerCenter.value = await userAPI.getLearnerCenter({ scope: 'global' })
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
  .profile-stats {
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
