<template>
  <div class="login-page">
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
            问流 WenFlow
          </h1>
          <p class="brand-subtitle">Your Personal AI Learning Companion</p>
          <div class="brand-features">
            <div class="feature-item">
              <span class="feature-icon">📚</span>
              <span>个性化学习路径规划</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">🤖</span>
              <span>AI 智能辅导</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">📊</span>
              <span>学习进度追踪</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">🏆</span>
              <span>成就系统激励</span>
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
            <h2 class="login-title">欢迎回来</h2>
            <p class="login-subtitle">登录账号开始学习</p>
          </div>

          <el-form
            :model="loginForm"
            :rules="rules"
            ref="formRef"
            label-position="top"
            size="large"
            class="login-form"
            @keyup.enter="handleLogin"
          >
            <el-form-item label="用户名" prop="name">
              <el-input
                v-model="loginForm.name"
                type="text"
                placeholder="请输入用户名"
                prefix-icon="User"
                clearable
              />
            </el-form-item>

            <el-form-item label="密码" prop="password">
              <el-input
                v-model="loginForm.password"
                type="password"
                placeholder="请输入密码"
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
                @click="handleLogin"
                :loading="loading"
                class="login-button"
              >
                {{ loading ? '登录中...' : '登录' }}
              </el-button>
            </el-form-item>

            <el-divider>
              <span class="divider-text">或者</span>
            </el-divider>

            <div class="register-tips">
              <span>还没有账号？</span>
              <el-link type="primary" @click="handleGoRegister">
                立即注册
              </el-link>
            </div>
          </el-form>
        </div>

        <!-- 页脚链接 -->
        <div class="login-footer">
          <el-link @click="$router.push('/')">
            ← 返回首页
          </el-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">

import { reactive, ref } from 'vue';

import { useRouter } from 'vue-router';

import { ElMessage, type FormInstance, type FormRules } from 'element-plus';

import { useUserStore } from '../stores/user';
import { authAPI } from '../api/auth';

import ThemeSwitcher from '../components/ThemeSwitcher.vue';



const router = useRouter();

const userStore = useUserStore();

const formRef = ref<FormInstance>();

const loading = ref(false);



const loginForm = reactive({

  name: '',

  password: '',

  remember: false

});



const rules: FormRules = {

  name: [
    { required: true, message: '请输入用户名', trigger: 'blur' }
  ],

  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于 6 位', trigger: 'blur' }
  ]

};



const handleLogin = async () => {

  if (!formRef.value) return;



  await formRef.value.validate(async (valid) => {

    if (valid) {

      loading.value = true;



      try {

        await userStore.login(loginForm.name, loginForm.password);

        ElMessage.success('登录成功');



        // 如果选择了记住我，可以扩展功能

        if (loginForm.remember) {

          localStorage.setItem('rememberMe', 'true');

        }



        router.push('/dashboard');

      } catch (error: any) {

        console.error('登录失败:', error);

        ElMessage.error(error.message || '登录失败，请检查用户名和密码');

      } finally {

        loading.value = false;

      }

    }

  });

};

const handleGoRegister = async () => {
  try {
    const status = await authAPI.getRegistrationStatus();
    if (!status.registrationEnabled) {
      ElMessage.warning('平台注册已关闭，暂不支持新用户注册');
      return;
    }

    router.push('/register');
  } catch (error) {
    router.push('/register');
  }
};

</script>

<style scoped>
.login-page {
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

[data-theme="dark"] .login-page {
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
  animation: float 20s infinite ease-in-out;
}

.gradient-orb-1 {
  width: 400px;
  height: 400px;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  top: -100px;
  left: -100px;
  animation-delay: 0s;
}

.gradient-orb-2 {
  width: 300px;
  height: 300px;
  background: linear-gradient(135deg, var(--color-danger) 0%, var(--color-danger-light) 100%);
  bottom: -50px;
  right: -50px;
  animation-delay: 7s;
}

.gradient-orb-3 {
  width: 250px;
  height: 250px;
  background: linear-gradient(135deg, var(--color-progress) 0%, var(--color-progress-light) 100%);
  top: 50%;
  right: 10%;
  animation-delay: 14s;
}

@keyframes float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -50px) scale(1.1);
  }
  66% {
    transform: translate(-20px, 30px) scale(0.9);
  }
}

.login-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  max-width: 1000px;
  width: 100%;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 24px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  position: relative;
  z-index: 1;
  transition: background var(--transition-normal), box-shadow var(--transition-normal);
}

[data-theme="dark"] .login-container {
  background: rgba(15, 24, 32, 0.95);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.4);
}

[data-theme="dark"] .login-form-wrapper {
  background: var(--bg-surface);
}

/* 左侧品牌区 */
.login-brand {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  padding: 3rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  color: white;
  position: relative;
  overflow: hidden;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .login-brand {
  background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-secondary-dark) 100%);
}

.login-brand::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  opacity: 0.3;
}

.brand-content {
  position: relative;
  z-index: 1;
}

.brand-title {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.title-icon {
  font-size: 2.5rem;
}

.brand-subtitle {
  font-size: 1rem;
  opacity: 0.9;
  margin-bottom: 2rem;
  font-weight: 300;
}

.brand-features {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.95rem;
  opacity: 0.95;
}

.feature-icon {
  font-size: 1.25rem;
}

/* 右侧表单区 */
.login-form-wrapper {
  padding: 3rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: white;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .login-form-wrapper {
  background: var(--bg-surface);
}

.login-card {
  width: 100%;
}

.login-header {
  margin-bottom: 2rem;
}

.header-top {
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
  font-size: 0.95rem;
  transition: color var(--transition-normal);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.login-button {
  width: 100%;
  height: 44px;
  font-size: 1rem;
  font-weight: 600;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  border: none;
  transition: all 0.3s ease;
}

.login-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
}

.login-button:active {
  transform: translateY(0);
}

[data-theme="dark"] .login-button {
  background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-secondary-dark) 100%);
}

[data-theme="dark"] .login-button:hover {
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
}

.divider-text {
  color: var(--text-muted);
  font-size: 0.875rem;
  transition: color var(--transition-normal);
}

.register-tips {
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: color var(--transition-normal);
}

.login-footer {
  margin-top: 2rem;
  text-align: center;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .login-container {
    grid-template-columns: 1fr;
  }

  .login-brand {
    display: none;
  }

  .login-form-wrapper {
    padding: 2rem;
  }

  .login-page {
    padding: 1rem;
  }
}

/* Element Plus 样式覆盖 */
:deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
  transition: color var(--transition-normal);
}

:deep(.el-input__wrapper) {
  border-radius: 8px;
  padding: 12px 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

:deep(.el-input__wrapper:hover) {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
}

:deep(.el-checkbox__label) {
  color: var(--text-secondary);
  transition: color var(--transition-normal);
}

:deep(.el-divider__text) {
  color: var(--text-muted);
  font-size: 0.875rem;
  transition: color var(--transition-normal);
}

:deep(.el-link) {
  font-weight: 600;
}

/* 夜间模式下的 Element Plus 覆盖 */
[data-theme="dark"] :deep(.el-form-item__label) {
  color: var(--text-primary);
}

[data-theme="dark"] :deep(.el-input__wrapper) {
  background: var(--bg-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

[data-theme="dark"] :deep(.el-input__wrapper:hover) {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

[data-theme="dark"] :deep(.el-checkbox__label) {
  color: var(--text-secondary);
}

[data-theme="dark"] :deep(.el-divider__text) {
  color: var(--text-muted);
}
</style>