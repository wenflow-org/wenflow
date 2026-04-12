<template>
  <CapabilityShell
    title="账户概览"
    description="查看账号信息与学习进度。"
  >
    <div class="profile-page">
      <section class="overview-grid">
        <article class="glass-card overview-card">
          <div class="card-header">账号信息</div>
          <div class="profile-info">
            <el-avatar :size="72" class="user-avatar-large">
              {{ user.name?.charAt(0) || '用' }}
            </el-avatar>
            <h3 class="user-name-large">{{ user.name || '未命名用户' }}</h3>
            <p class="user-email">{{ user.email || '未绑定邮箱' }}</p>
            <div class="user-stats">
              <div class="stat-item"><span class="stat-label">XP</span><span class="stat-value">{{ user.xp || 0 }}</span></div>
              <div class="stat-item"><span class="stat-label">等级</span><span class="stat-value">{{ user.level || 1 }}</span></div>
              <div class="stat-item"><span class="stat-label">角色</span><span class="stat-value">{{ user.role || 'user' }}</span></div>
            </div>
          </div>
        </article>

        <article class="glass-card overview-card">
          <div class="card-header">API 自定义</div>
          <div class="stats-content">
            <p class="stats-tip">配置自己的 API 后，将替代平台默认模型进行调用。</p>
            <div class="coming-soon">
              <span class="soon-icon">🚧</span>
              <span class="soon-text">正在开发中</span>
            </div>
          </div>
        </article>
      </section>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { useUserStore } from '../stores/user';

const userStore = useUserStore();

const user = ref({
  name: '',
  email: '',
  xp: 0,
  level: 1,
  role: 'user'
});

onMounted(async () => {
  await loadUserProfile();
});

async function loadUserProfile() {
  try {
    await userStore.fetchProfile();
  } finally {
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
}

async function loadConfig() {
  try {

  } catch {
    console.error('加载配置失败');
  }
}

async function testConnection() {
  if (!userConfig.endpoint) {
    ElMessage.warning('请填写模型端点');
    return;
  }
  
  if (!userConfig.apiKey && !userConfig.hasApiKey) {
    ElMessage.warning('请填写 API Key');
    return;
  }
  
  testing.value = true;
  try {
    await testApiConnection({
      endpoint: userConfig.endpoint,
      apiKey: userConfig.apiKey,
      model: userConfig.chatModel || 'deepseek-chat',
    });
    ElMessage.success('连接成功！');
  } catch (error: any) {
    ElMessage.error(error.message || '连接失败');
  } finally {
    testing.value = false;
  }
}

async function saveConfig() {
  if (!userConfig.endpoint) {
    ElMessage.warning('请填写模型端点');
    return;
  }
  
  if (!userConfig.chatModel) {
    ElMessage.warning('请填写对话模型');
    return;
  }
  
  saving.value = true;
  try {
    await updateUserApiConfig({
      endpoint: userConfig.endpoint,
      apiKey: userConfig.apiKey,
      chatModel: userConfig.chatModel,
      reasoningModel: userConfig.reasoningModel || userConfig.chatModel,
      enabled: true,
    });
    ElMessage.success('配置已保存');
    await loadConfig();
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function clearConfig() {
  userConfig.endpoint = '';
  userConfig.apiKey = '';
  userConfig.chatModel = '';
  userConfig.reasoningModel = '';
  userConfig.hasApiKey = false;
  
  try {
    await updateUserApiConfig({
      endpoint: '',
      apiKey: '',
      chatModel: '',
      reasoningModel: '',
      enabled: false,
    });
    ElMessage.success('已清空配置，将使用平台默认');
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败');
  }
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

[data-theme="dark"] .glass-card {
  background: rgba(26, 37, 47, 0.7);
  border-color: rgba(255, 255, 255, 0.1);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
}

.card-header {
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-light);
  font-weight: 700;
  font-size: 1rem;
  color: var(--text-primary);
}

.overview-card {
  padding: 1.125rem;
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

.user-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  background: var(--bg-muted);
  border-radius: var(--radius-lg);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-value {
  font-weight: 700;
  color: var(--text-primary);
}

.stats-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 2rem 0;
}

.stats-tip {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 1.5rem;
  background: var(--bg-muted);
  border-radius: var(--radius-xl);
}

.soon-icon {
  font-size: 3rem;
}

.soon-text {
  font-size: 14px;
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}
</style>