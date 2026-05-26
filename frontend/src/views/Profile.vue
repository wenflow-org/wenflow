<template>
  <CapabilityShell
    title="账户设置"
    description="学习者画像、知识背景与路径调整建议已并入学习状态页。这里保留账户概览与快捷入口。"
  >
    <div class="profile-page">
      <section class="overview-grid">
        <article class="glass-card overview-card overview-card--hero">
          <div class="card-header">账户概览</div>
          <div class="profile-info">
            <el-avatar :size="72" class="user-avatar-large">
              {{ user.name?.charAt(0) || '用' }}
            </el-avatar>
            <h3 class="user-name-large">{{ user.name || '未命名用户' }}</h3>
            <p class="user-email">{{ user.email || '未绑定邮箱' }}</p>
            <div class="user-stats">
              <div class="stat-item"><span class="stat-label">XP</span><span class="stat-value">{{ user.xp || 0 }}</span></div>
              <div class="stat-item"><span class="stat-label">等级</span><span class="stat-value">{{ user.level || 1 }}</span></div>
              <div class="stat-item"><span class="stat-label">节奏</span><span class="stat-value">{{ paceLabel }}</span></div>
            </div>
          </div>
        </article>

        <article class="glass-card overview-card">
          <div class="card-header">学习档案已迁移</div>
          <div class="stats-content">
            <p class="stats-tip">学习者画像、知识背景、重调建议等内容现在统一放在「学习状态」页，减少主导航中的重复页面。</p>
            <div class="action-row">
              <el-button type="primary" @click="router.push('/learning-state')">前往学习状态</el-button>
              <el-button @click="goCurrentPath">查看当前路径</el-button>
            </div>
          </div>
        </article>
      </section>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { useUserStore } from '../stores/user';
import { userAPI, type LearnerCenterSnapshot } from '../api/user';

const router = useRouter();
const userStore = useUserStore();

const user = ref({
  name: '',
  email: '',
  xp: 0,
  level: 1,
  role: 'user'
});
const learnerCenter = ref<LearnerCenterSnapshot | null>(null);

const paceLabel = computed(() => {
  const pace = learnerCenter.value?.learningControlState?.paceMode;
  if (pace === 'recover') return '恢复';
  if (pace === 'push') return '推进';
  return '稳定';
});

const goCurrentPath = () => {
  const pathId = learnerCenter.value?.knowledgeMemory?.currentPath?.learningPathId;
  if (pathId) {
    router.push(`/learning-path/${pathId}`);
    return;
  }
  router.push('/learning-paths');
};

onMounted(async () => {
  await Promise.all([loadUserProfile(), loadLearnerCenter()]);
});

async function loadUserProfile() {
  await userStore.fetchProfile();
  if (userStore.user) {
    user.value = {
      name: userStore.user.name,
      email: userStore.user.email,
      xp: userStore.user.xp,
      level: userStore.user.level,
      role: (userStore.user as any).role || 'user'
    };
  }
}

async function loadLearnerCenter() {
  learnerCenter.value = await userAPI.getLearnerCenter({ scope: 'global' });
}
</script>

<style scoped lang="scss">
.profile-page {
  display: grid;
  gap: 1.5rem;
}

.glass-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
}

[data-theme='dark'] .glass-card {
  background: rgba(26, 37, 47, 0.7);
  border-color: rgba(255, 255, 255, 0.1);
}

.overview-grid,
.content-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
}

.overview-card,
.section-card {
  padding: 1.125rem;
}

.overview-card--hero {
  min-height: 240px;
}

.card-header,
.section-card__head h3 {
  color: var(--text-primary);
}

.card-header {
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-light);
  font-weight: 700;
}

.section-card__head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.section-kicker {
  font-size: 12px;
  color: var(--text-secondary);
}

.section-copy {
  margin: 0 0 14px;
  color: var(--text-primary);
  line-height: 1.7;
}

.profile-info {
  text-align: center;
}

.user-avatar-large {
  margin-bottom: 1rem;
}

.user-name-large {
  margin: 0 0 0.5rem;
  color: var(--text-primary);
}

.user-email {
  margin: 0 0 1rem;
  color: var(--text-secondary);
}

.user-stats,
.state-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.stat-item,
.state-card,
.note-card,
.mini-card {
  padding: 10px;
  background: var(--bg-muted);
  border-radius: var(--radius-lg);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label,
.state-card__label,
.subhead,
.empty-inline {
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-value,
.state-card__value {
  font-weight: 700;
  color: var(--text-primary);
}

.state-card__desc,
.note-card p,
.mini-card p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.profile-notes,
.list-grid,
.knowledge-sections {
  display: grid;
  gap: 12px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-muted);
  color: var(--text-primary);
}

.chip--good {
  background: rgba(103, 194, 58, 0.12);
  color: #3a8b20;
}

.chip--warn {
  background: rgba(245, 108, 108, 0.12);
  color: #c45656;
}

.action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.section-card--warning {
  border-color: rgba(245, 108, 108, 0.25);
}

@media (max-width: 768px) {
  .overview-grid,
  .content-grid,
  .user-stats,
  .state-grid {
    grid-template-columns: 1fr;
  }
}
</style>
