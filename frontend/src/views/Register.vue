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
          <span class="auth-brand__eyebrow">新学习者入口</span>
          <h1>从一个模糊目标，开始生成第一版路径。</h1>
          <p>先不用准备完整计划。说出你最近想解决的问题，问流会陪你把目标缩小到可以行动。</p>

          <div class="auth-brand__points">
            <article v-for="item in registerPoints" :key="item.title" class="auth-point">
              <strong>{{ item.title }}</strong>
              <span>{{ item.desc }}</span>
            </article>
          </div>
        </div>
      </aside>

      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-card__top">
            <span class="auth-card__pill">注册</span>
            <ThemeSwitcher />
          </div>

          <div class="auth-card__header">
            <h2>创建账号</h2>
            <p>注册后直接进入学习台，开始你的第一次目标规划。</p>
          </div>

          <el-form ref="formRef" :model="registerForm" :rules="rules" label-position="top" size="large" class="auth-form" @keyup.enter="handleRegister">
            <el-form-item label="用户名" prop="name">
              <el-input v-model="registerForm.name" placeholder="请输入用户名" prefix-icon="User" clearable />
            </el-form-item>

            <el-form-item label="密码" prop="password">
              <el-input v-model="registerForm.password" type="password" placeholder="至少 8 位，需包含字母和数字" prefix-icon="Lock" show-password />
            </el-form-item>

            <p class="auth-hint">密码至少 8 位，且必须同时包含字母和数字。</p>

            <el-form-item label="确认密码" prop="confirmPassword">
              <el-input v-model="registerForm.confirmPassword" type="password" placeholder="请再次输入密码" prefix-icon="Lock" show-password />
            </el-form-item>

            <el-button type="primary" :loading="loading" class="auth-submit" @click="handleRegister">
              {{ loading ? '创建中...' : '创建账号并开始' }}
            </el-button>

            <div class="auth-switch">
              <span>已有账号？</span>
              <button type="button" @click="router.push('/login')">立即登录</button>
            </div>
          </el-form>
        </div>

        <router-link to="/" class="auth-footer-link">返回首页</router-link>
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
import ThemeSwitcher from '../components/ThemeSwitcher.vue';

const router = useRouter();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const registerPoints = [
  { title: '先说出目标', desc: '不用写完整计划，只需要描述最近想解决什么。' },
  { title: '一起缩小范围', desc: '通过几轮追问，把目标变成可执行的问题。' },
  { title: '生成第一版路径', desc: '注册后即可进入学习台，继续规划与学习。' }
];

const registerForm = reactive({
  name: '',
  password: '',
  confirmPassword: ''
});

const validatePass2 = (rule: any, value: any, callback: any) => {
  if (value === '') {
    callback(new Error('请再次输入密码'));
  } else if (value !== registerForm.password) {
    callback(new Error('两次输入密码不一致'));
  } else {
    callback();
  }
};

const validatePassword = (rule: any, value: string, callback: any) => {
  if (!value) {
    callback(new Error('请输入密码'));
    return;
  }
  if (value.length < 8) {
    callback(new Error('密码长度不能少于 8 位'));
    return;
  }
  if (!/[a-zA-Z]/.test(value)) {
    callback(new Error('密码必须包含字母'));
    return;
  }
  if (!/[0-9]/.test(value)) {
    callback(new Error('密码必须包含数字'));
    return;
  }
  callback();
};

const rules: FormRules = {
  name: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 20, message: '用户名长度在 2 到 20 个字符', trigger: 'blur' }
  ],
  password: [{ required: true, validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ required: true, validator: validatePass2, trigger: 'blur' }]
};

const handleRegister = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    loading.value = true;

    try {
      await userStore.register(registerForm.name, registerForm.password);
      toast.success('注册成功');
      router.push('/dashboard');
    } catch (error: any) {
      toast.error(error.message || '注册失败，请稍后重试');
    } finally {
      loading.value = false;
    }
  });
};
</script>

<style scoped>
.auth-page {
  --auth-ink: #172033;
  --auth-muted: #66758d;
  --auth-blue: #3478f6;
  --auth-blue-deep: #1f57cc;
  min-height: 100vh;
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
  margin: 0 auto;
  padding: 98px 0 72px;
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(420px, 0.98fr);
  gap: 28px;
  align-items: center;
}

.auth-brand {
  min-height: 620px;
  border-radius: 32px;
  padding: 44px;
  background: linear-gradient(180deg, #16233c, #0f172a);
  color: #fff;
  position: relative;
  overflow: hidden;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.24);
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
  font-size: clamp(38px, 4.2vw, 58px);
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
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
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
  gap: 18px;
}

.auth-card {
  width: min(100%, 520px);
  padding: 36px;
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(37, 99, 235, 0.08);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
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

.auth-card__header p,
.auth-hint {
  margin: 0;
  color: var(--auth-muted);
  line-height: 1.7;
}

.auth-hint {
  margin-top: -2px;
  font-size: 12px;
}

.auth-form {
  display: grid;
  gap: 18px;
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
.auth-footer-link {
  border: 0;
  background: transparent;
  color: var(--auth-blue-deep);
  font: inherit;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.auth-footer-link {
  color: color-mix(in srgb, var(--auth-ink) 68%, white);
}

:deep(.el-form-item) {
  margin-bottom: 0;
}

:deep(.el-form-item.is-error) {
  margin-bottom: 18px;
}

:deep(.el-form-item__error) {
  padding-top: 5px;
  line-height: 1.35;
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
</style>
