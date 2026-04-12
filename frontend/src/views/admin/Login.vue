<template>
  <div class="admin-login-page">
    <!-- 背景装饰 -->
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
      <div class="gradient-orb gradient-orb-3"></div>
    </div>

    <div class="login-container">
      <!-- 左侧品牌区 -->
      <div class="login-brand">
        <div class="brand-content">
          <h1 class="brand-title">
            <span class="title-icon">🎓</span>
            问流 WenFlow · 管理平台
          </h1>
          <p class="brand-subtitle">Admin Dashboard</p>
          <div class="brand-features">
            <div class="feature-item">
              <span class="feature-icon">📊</span>
              <span>实时监控平台运行状态</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">🤖</span>
              <span>Agent 工作情况追踪</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">👥</span>
              <span>用户管理与数据分析</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">💬</span>
              <span>目标对话调试管理</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧登录表单 -->
      <div class="login-form-wrapper">
        <div class="login-card">
          <div class="login-header">
            <div class="header-top">
              <ThemeSwitcher />
            </div>
            <h2 class="login-title">管理员登录</h2>
            <p class="login-subtitle">使用管理员账号登录管理平台</p>
          </div>

          <el-form
            ref="formRef"
            :model="loginForm"
            :rules="rules"
            class="login-form"
            @keyup.enter="handleLogin"
          >
            <el-form-item prop="name">
              <el-input
                v-model="loginForm.name"
                placeholder="用户名或邮箱"
                size="large"
                prefix-icon="User"
                clearable
              />
            </el-form-item>

            <el-form-item prop="password">
              <el-input
                v-model="loginForm.password"
                type="password"
                placeholder="密码"
                size="large"
                prefix-icon="Lock"
                show-password
              />
            </el-form-item>

            <el-form-item>
              <el-checkbox v-model="loginForm.remember">
                记住我
              </el-checkbox>
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="loading"
                class="login-button"
                @click="handleLogin"
              >
                {{ loading ? '登录中...' : '登录' }}
              </el-button>
            </el-form-item>

            <el-divider>
              <span class="divider-text">提示</span>
            </el-divider>

            <div class="login-tips">
              <p>默认管理员账号：</p>
              <ul>
                <li>用户名：<code>admin</code></li>
                <li>密码：<code>admin123</code></li>
              </ul>
            </div>
          </el-form>
        </div>

        <!-- 页脚链接 -->
        <div class="login-footer">
          <router-link to="/" class="footer-link">
            ← 返回用户平台
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { adminAuthApi } from '@/api/adminApi';
import ThemeSwitcher from '@/components/ThemeSwitcher.vue';

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);

const loginForm = reactive({
  name: '',
  password: '',
  remember: false,
});

const rules: FormRules = {
  name: [
    { required: true, message: '请输入用户名或邮箱', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少 6 位', trigger: 'blur' },
  ],
};

const handleLogin = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    loading.value = true;
    try {
      const response: any = await adminAuthApi.login(loginForm);
      
      if (response.data.success) {
        const { token, user } = response.data.data;
        
        // 保存 token 和用户信息
        localStorage.setItem('admin_token', token);
        localStorage.setItem('admin_user', JSON.stringify(user));
        
        ElMessage.success('登录成功');
        router.push('/admin/dashboard');
      }
    } catch (error: any) {
      console.error('登录失败:', error);
      ElMessage.error(error.response?.data?.error?.message || '登录失败，请检查账号密码');
    } finally {
      loading.value = false;
    }
  });
};
</script>

<style scoped>
.admin-login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  padding: 2rem;
  position: relative;
  overflow: hidden;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .admin-login-page {
  background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-secondary-dark) 100%);
}

/* 动态背景 */
.animated-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.3;
  animation: float 20s ease-in-out infinite;
}

.gradient-orb-1 {
  width: 600px;
  height: 600px;
  background: rgba(255, 255, 255, 0.3);
  top: -200px;
  right: -100px;
}

[data-theme="dark"] .gradient-orb-1 {
  background: rgba(0, 0, 0, 0.2);
}

.gradient-orb-2 {
  width: 500px;
  height: 500px;
  background: rgba(255, 255, 255, 0.2);
  bottom: -150px;
  left: -100px;
}

[data-theme="dark"] .gradient-orb-2 {
  background: rgba(0, 0, 0, 0.15);
}

@keyframes float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(30px, -50px) scale(1.1);
  }
}

/* 登录容器 */
.login-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  max-width: 1200px;
  width: 100%;
  background: var(--bg-surface);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2);
  z-index: 1;
  transition: background var(--transition-normal), box-shadow var(--transition-normal);
}

[data-theme="dark"] .login-container {
  background: var(--bg-elevated);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.4);
}

/* 品牌区 */
.login-brand {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  padding: 4rem;
  color: white;
  display: flex;
  align-items: center;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .login-brand {
  background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-secondary-dark) 100%);
  color: var(--text-primary);
}

.brand-content {
  max-width: 400px;
}

.brand-title {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.title-icon {
  font-size: 2.5rem;
}

.brand-subtitle {
  font-size: 1.125rem;
  opacity: 0.9;
  margin-bottom: 3rem;
}

.brand-features {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 1rem;
}

.feature-icon {
  font-size: 1.75rem;
}

/* 表单区 */
.login-form-wrapper {
  padding: 4rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  transition: background var(--transition-normal);
}

.login-card {
  margin-bottom: 2rem;
}

.login-header {
  margin-bottom: 2rem;
}

.login-header .header-top {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.login-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
  transition: color var(--transition-normal);
}

.login-subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
  transition: color var(--transition-normal);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.login-button {
  width: 100%;
  height: 50px;
  font-size: 1.125rem;
  font-weight: 600;
}

.divider-text {
  color: var(--text-muted);
  font-size: 0.875rem;
  transition: color var(--transition-normal);
}

.login-tips {
  background: var(--bg-muted);
  padding: 1.5rem;
  border-radius: 12px;
  border: 1px solid var(--border-default);
  transition: background var(--transition-normal), border-color var(--transition-normal);
}

.login-tips p {
  margin: 0 0 0.75rem 0;
  font-weight: 600;
  color: var(--text-primary);
  transition: color var(--transition-normal);
}

.login-tips ul {
  margin: 0;
  padding-left: 1.5rem;
  color: var(--text-secondary);
  transition: color var(--transition-normal);
}

.login-tips li {
  margin-bottom: 0.5rem;
}

.login-tips code {
  background: var(--bg-surface);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  color: var(--color-primary);
  border: 1px solid var(--border-light);
  transition: background var(--transition-normal), color var(--transition-normal), border-color var(--transition-normal);
}

.login-footer {
  text-align: center;
}

.footer-link {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s ease;
}

.footer-link:hover {
  color: var(--color-secondary);
}

/* 响应式 */
@media (max-width: 968px) {
  .login-container {
    grid-template-columns: 1fr;
  }

  .login-brand {
    display: none;
  }

  .login-form-wrapper {
    padding: 3rem 2rem;
  }
}
</style>