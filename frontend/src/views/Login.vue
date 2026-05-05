<template>
  <div class="auth-page">
    <div class="auth-bg-layer">
      <div class="auth-bg-orb auth-bg-orb--1"></div>
      <div class="auth-bg-orb auth-bg-orb--2"></div>
      <div class="auth-bg-grid"></div>
    </div>

    <router-link to="/" class="auth-home-link">
      <img src="/logo.png" alt="问流 WenFlow" />
    </router-link>

    <main class="auth-shell">
      <aside class="auth-brand">
        <div class="auth-brand__content">
          <span class="auth-brand__eyebrow">WenFlow</span>
          <h1>不是先找课，而是先找到真正的问题。</h1>
          <p>登录后回到你的目标、路径和学习进展，从当前最小的一步继续。</p>

          <div class="auth-brand__points">
            <article v-for="item in loginPoints" :key="item.title" class="auth-point">
              <strong>{{ item.title }}</strong>
              <span>{{ item.desc }}</span>
            </article>
          </div>
        </div>
      </aside>

      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-card__top">
            <span class="auth-card__pill">登录</span>
            <router-link to="/" class="auth-back-link">← 返回首页</router-link>
          </div>

          <div class="auth-card__header">
            <h2>欢迎回来</h2>
            <p>登录后，继续你的目标、路径和学习进展。</p>
          </div>

          <el-form ref="formRef" :model="loginForm" :rules="rules" label-position="top" size="large" class="auth-form" @keyup.enter="handleLogin">
            <el-form-item label="用户名或邮箱" prop="name">
              <el-input v-model="loginForm.name" type="text" placeholder="请输入用户名或邮箱" prefix-icon="User" clearable />
            </el-form-item>

            <el-form-item label="密码" prop="password">
              <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" prefix-icon="Lock" show-password />
            </el-form-item>

            <div class="auth-meta">
              <el-checkbox v-model="loginForm.remember">记住登录状态</el-checkbox>
            </div>

            <el-button type="primary" :loading="loading" class="auth-submit" @click="handleLogin">
              {{ loading ? '登录中...' : '登录并继续' }}
            </el-button>

            <div class="auth-switch">
              <span>还没有账号？</span>
              <button type="button" @click="handleGoRegister">立即注册</button>
            </div>
          </el-form>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { type FormInstance, type FormRules } from 'element-plus';
import { toast } from '../utils/toast';
import { useUserStore } from '../stores/user';
import { authAPI } from '../api/auth';

const router = useRouter();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const loginPoints = [
  { title: '继续目标', desc: '回到你已经整理过的目标、问题和学习路径。' },
  { title: '接上学习', desc: '从当前最小任务继续，不被内容淹没。' },
  { title: '看见进展', desc: '看见已经掌握的部分，也看见下一步该补哪里。' }
];

const loginForm = reactive({
  name: '',
  password: '',
  remember: false
});

const rules: FormRules = {
  name: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
};

const handleLogin = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    loading.value = true;
    try {
      await userStore.login(loginForm.name, loginForm.password);
      toast.success('登录成功');

      if (loginForm.remember) {
        localStorage.setItem('rememberMe', 'true');
      }

      router.push('/dashboard');
    } catch (error: any) {
      console.error('登录失败:', error);
      toast.error(error.message || '登录失败，请检查用户名和密码');
    } finally {
      loading.value = false;
    }
  });
};

const handleGoRegister = async () => {
  try {
    const status = await authAPI.getRegistrationStatus();
    if (!status.registrationEnabled) {
      toast.warning('平台注册已关闭，暂不支持新用户注册');
      return;
    }

    router.push('/register');
  } catch (error) {
    router.push('/register');
  }
};
</script>

<style scoped>
.auth-page {
  --auth-ink: #172033;
  --auth-muted: #66758d;
  --auth-blue: #3478f6;
  --auth-blue-deep: #1f57cc;
  min-height: 100vh;
  min-height: 100dvh;
  position: relative;
  overflow: hidden;
  background: #f3f6fb;
  color: var(--auth-ink);
}

.auth-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.auth-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.22;
}

.auth-bg-orb--1 {
  width: 520px;
  height: 520px;
  top: -120px;
  left: -120px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.28), transparent 70%);
}

.auth-bg-orb--2 {
  width: 460px;
  height: 460px;
  right: -120px;
  bottom: -120px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
}

.auth-bg-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(15, 23, 42, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.035) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: radial-gradient(circle at center, black 48%, transparent 88%);
}

.auth-home-link {
  position: absolute;
  z-index: 2;
  top: 28px;
  left: 36px;
  display: inline-flex;
}

.auth-home-link img {
  height: 54px;
  width: auto;
}

.auth-shell {
  position: relative;
  z-index: 1;
  width: min(1240px, calc(100% - 72px));
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  padding: 98px 0 72px;
  display: grid;
  grid-template-columns: minmax(0, 0.94fr) minmax(440px, 1.06fr);
  gap: 28px;
  align-items: center;
}

.auth-brand {
  min-height: 584px;
  border-radius: 32px;
  padding: 40px;
  background: linear-gradient(180deg, #1a2740, #121b2d);
  color: #fff;
  position: relative;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.18);
}

.auth-brand::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 18% 18%, rgba(52, 120, 246, 0.18), transparent 36%), radial-gradient(circle at 82% 78%, rgba(141, 107, 255, 0.14), transparent 38%);
}

.auth-brand__content {
  position: relative;
  z-index: 1;
  min-height: 100%;
  display: grid;
  gap: 28px;
  align-content: space-between;
}

.auth-brand__eyebrow,
.auth-card__pill {
  width: fit-content;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.auth-brand__eyebrow {
  color: rgba(203, 213, 225, 0.72);
}

.auth-brand h1,
.auth-card__header h2 {
  margin: 0;
  line-height: 1.08;
  letter-spacing: -0.045em;
}

.auth-brand h1 {
  max-width: 12ch;
  font-size: clamp(34px, 3.8vw, 52px);
}

.auth-brand p {
  max-width: 34ch;
  margin: 0;
  color: rgba(203, 213, 225, 0.72);
  font-size: 18px;
  line-height: 1.8;
}

.auth-brand__points {
  display: grid;
  gap: 14px;
}

.auth-point {
  display: grid;
  gap: 5px;
  padding: 18px 20px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.auth-point strong {
  color: #fff;
  font-size: 15px;
}

.auth-point span {
  color: rgba(203, 213, 225, 0.72);
  font-size: 14px;
  line-height: 1.65;
}

.auth-panel {
  display: grid;
  justify-items: center;
  gap: 0;
}

.auth-card {
  width: min(100%, 520px);
  padding: 36px;
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(37, 99, 235, 0.1);
  box-shadow: 0 34px 88px rgba(15, 23, 42, 0.16);
  display: grid;
  gap: 28px;
  backdrop-filter: blur(18px);
}

.auth-card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.auth-card__pill {
  padding: 7px 12px;
  border-radius: 999px;
  color: var(--auth-blue-deep);
  background: rgba(52, 120, 246, 0.1);
}

.auth-card__header {
  display: grid;
  gap: 10px;
}

.auth-card__header h2 {
  font-size: clamp(30px, 3vw, 42px);
}

.auth-card__header p {
  margin: 0;
  color: var(--auth-muted);
  line-height: 1.7;
}

.auth-form {
  display: grid;
  gap: 18px;
}

.auth-meta {
  margin-top: -6px;
}

.auth-submit {
  width: 100%;
  min-height: 50px;
  border: none;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 900;
  background: linear-gradient(135deg, var(--auth-blue), var(--auth-blue-deep));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.22);
}

.auth-switch {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: var(--auth-muted);
  font-size: 14px;
}

.auth-switch button,
.auth-back-link {
  border: 0;
  background: transparent;
  color: var(--auth-blue-deep);
  font: inherit;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.auth-back-link {
  color: color-mix(in srgb, var(--auth-ink) 68%, white);
  font-size: 14px;
}

:deep(.el-form-item) {
  margin-bottom: 0;
}

:deep(.el-form-item__label) {
  color: var(--auth-ink);
  font-weight: 800;
}

:deep(.el-input__wrapper) {
  min-height: 52px;
  border-radius: 16px;
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.18) inset;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px rgba(52, 120, 246, 0.4) inset, 0 0 0 4px rgba(52, 120, 246, 0.12);
}

@media (max-width: 920px) {
  .auth-shell {
    grid-template-columns: 1fr;
    width: min(100% - 36px, 620px);
  }

  .auth-brand {
    display: none;
  }
}

@media (max-width: 560px) {
  .auth-home-link {
    left: 18px;
    top: 18px;
  }

  .auth-home-link img {
    height: 46px;
  }

  .auth-shell {
    width: min(100% - 28px, 620px);
    padding-top: 88px;
  }

  .auth-card {
    padding: 24px;
  }
}

@media (max-width: 420px) {
  .auth-shell {
    width: min(100% - 20px, 620px);
    padding-bottom: calc(28px + var(--safe-area-bottom));
  }

  .auth-card {
    padding: 20px;
    border-radius: 24px;
  }

  .auth-card__top,
  .auth-switch {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
