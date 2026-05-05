<template>
  <div class="admin-auth-page">
    <div class="admin-auth-bg">
      <div class="admin-auth-orb admin-auth-orb--1"></div>
      <div class="admin-auth-orb admin-auth-orb--2"></div>
      <div class="admin-auth-grid"></div>
    </div>

    <router-link to="/" class="admin-auth-logo">
      <img src="/logo.png" alt="问流 WenFlow" />
    </router-link>

    <main class="admin-auth-shell">
      <aside class="admin-auth-brand">
        <span class="admin-auth-kicker">Admin Console</span>
        <h1>管理学习系统的真实运行状态。</h1>
        <p>集中查看用户、路径、对话与学习数据，把平台运维动作落在可追踪的管理面板里。</p>

        <div class="admin-auth-metrics">
          <article v-for="item in adminPoints" :key="item.title" class="admin-auth-metric">
            <span>{{ item.label }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.desc }}</p>
          </article>
        </div>
      </aside>

      <section class="admin-auth-panel">
        <div class="admin-auth-card">
          <div class="admin-auth-card__top">
            <span>受限入口</span>
            <ThemeSwitcher />
          </div>

          <div class="admin-auth-card__header">
            <h2>管理员登录</h2>
            <p>使用管理员账号进入 WenFlow 管理平台。</p>
          </div>

          <el-form ref="formRef" :model="loginForm" :rules="rules" label-position="top" size="large" class="admin-auth-form" @keyup.enter="handleLogin">
            <el-form-item label="用户名" prop="name">
              <el-input v-model="loginForm.name" placeholder="请输入管理员用户名" prefix-icon="User" clearable autocomplete="username" />
            </el-form-item>

            <el-form-item label="密码" prop="password">
              <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" prefix-icon="Lock" show-password autocomplete="current-password" />
            </el-form-item>

            <div class="admin-auth-meta">
              <el-checkbox v-model="loginForm.remember">记住我</el-checkbox>
            </div>

            <el-button type="primary" :loading="loading" class="admin-auth-submit" @click="handleLogin">
              {{ loading ? '登录中...' : '进入管理平台' }}
            </el-button>
          </el-form>

          <div class="admin-auth-note">
            管理员账号由系统管理员统一分配。首次登录或权限异常时，请联系平台维护人员。
          </div>
        </div>

        <router-link to="/" class="admin-auth-footer">返回用户平台</router-link>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { type FormInstance, type FormRules } from 'element-plus';
import { adminAuthApi } from '@/api/adminApi';
import ThemeSwitcher from '@/components/ThemeSwitcher.vue';
import { toast } from '../../utils/toast';

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);

const adminPoints = [
  { label: '01', title: '运行概览', desc: '观察用户、路径和教学会话的整体状态。' },
  { label: '02', title: '数据追踪', desc: '定位学习行为、Agent 输出与系统事件。' },
  { label: '03', title: '权限管理', desc: '围绕用户、配置和后台能力进行集中维护。' }
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

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    const response: any = await adminAuthApi.login(loginForm);

    if (response.data.success) {
      const { token, user } = response.data.data;

      const storage = loginForm.remember ? localStorage : sessionStorage;
      storage.setItem('admin_token', token);
      storage.setItem('admin_user', JSON.stringify(user));

      toast.success('登录成功');
      router.push('/admin/dashboard');
    } else {
      toast.error(response.data.message || '登录失败，请检查账号密码');
    }
  } catch (error: any) {
    console.error('登录失败:', error);
    toast.error(error.response?.data?.error?.message || '登录失败，请检查账号密码');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.admin-auth-page {
  --admin-ink: #14181f;
  --admin-muted: #667085;
  --admin-gold: #bd8d3a;
  --admin-green: #14433b;
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background: #ece7dc;
  color: var(--admin-ink);
}

.admin-auth-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.admin-auth-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.24;
}

.admin-auth-orb--1 {
  width: 560px;
  height: 560px;
  top: -160px;
  left: -120px;
  background: radial-gradient(circle, rgba(20, 67, 59, 0.3), transparent 70%);
}

.admin-auth-orb--2 {
  width: 520px;
  height: 520px;
  right: -150px;
  bottom: -150px;
  background: radial-gradient(circle, rgba(189, 141, 58, 0.32), transparent 70%);
}

.admin-auth-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(20, 24, 31, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(20, 24, 31, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(circle at center, black 48%, transparent 86%);
}

.admin-auth-logo {
  position: absolute;
  z-index: 2;
  top: 28px;
  left: 36px;
  display: inline-flex;
}

.admin-auth-logo img {
  height: 54px;
  width: auto;
}

.admin-auth-shell {
  position: relative;
  z-index: 1;
  width: min(1240px, calc(100% - 72px));
  min-height: 100vh;
  margin: 0 auto;
  padding: 98px 0 72px;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(420px, 0.92fr);
  gap: 28px;
  align-items: center;
}

.admin-auth-brand {
  min-height: 640px;
  border-radius: 34px;
  padding: 46px;
  color: #fff;
  background: linear-gradient(145deg, #101d1b, #19312e 54%, #201b13);
  box-shadow: 0 28px 80px rgba(20, 24, 31, 0.28);
  display: grid;
  align-content: space-between;
  gap: 32px;
  position: relative;
  overflow: hidden;
}

.admin-auth-brand::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 16% 20%, rgba(189, 141, 58, 0.18), transparent 34%), radial-gradient(circle at 82% 76%, rgba(93, 145, 132, 0.16), transparent 38%);
}

.admin-auth-brand > * {
  position: relative;
  z-index: 1;
}

.admin-auth-kicker,
.admin-auth-card__top span {
  width: fit-content;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.admin-auth-kicker {
  color: rgba(245, 238, 220, 0.72);
}

.admin-auth-brand h1,
.admin-auth-card__header h2 {
  margin: 0;
  line-height: 1.08;
  letter-spacing: -0.045em;
}

.admin-auth-brand h1 {
  max-width: 12ch;
  font-size: clamp(40px, 4.5vw, 62px);
}

.admin-auth-brand > p {
  max-width: 36ch;
  margin: 0;
  color: rgba(245, 238, 220, 0.74);
  font-size: 18px;
  line-height: 1.8;
}

.admin-auth-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.admin-auth-metric {
  min-height: 168px;
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: grid;
  align-content: start;
  gap: 9px;
  transition: background 0.3s ease;
}

.admin-auth-metric:hover {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
}

.admin-auth-metric span {
  color: var(--admin-gold);
  font-size: 12px;
  font-weight: 900;
}

.admin-auth-metric strong {
  color: #fff;
  font-size: 16px;
}

.admin-auth-metric p {
  margin: 0;
  color: rgba(245, 238, 220, 0.72);
  font-size: 13px;
  line-height: 1.65;
}

.admin-auth-panel {
  display: grid;
  justify-items: center;
  gap: 18px;
}

.admin-auth-card {
  width: min(100%, 520px);
  padding: 36px;
  border-radius: 30px;
  background: rgba(255, 252, 246, 0.92);
  border: 1px solid rgba(20, 67, 59, 0.1);
  box-shadow: 0 24px 60px rgba(20, 24, 31, 0.14);
  display: grid;
  gap: 28px;
  backdrop-filter: blur(18px);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.admin-auth-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 28px 68px rgba(20, 24, 31, 0.2);
}

.admin-auth-card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.admin-auth-card__top span {
  padding: 7px 12px;
  border-radius: 999px;
  color: var(--admin-green);
  background: rgba(20, 67, 59, 0.1);
}

.admin-auth-card__header {
  display: grid;
  gap: 10px;
}

.admin-auth-card__header h2 {
  font-size: clamp(30px, 3vw, 42px);
}

.admin-auth-card__header p {
  margin: 0;
  color: var(--admin-muted);
  line-height: 1.7;
}

.admin-auth-form {
  display: grid;
  gap: 18px;
}

.admin-auth-meta {
  margin-top: -6px;
}

.admin-auth-submit {
  width: 100%;
  min-height: 50px;
  border: none;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 900;
  background: linear-gradient(135deg, var(--admin-green), color-mix(in srgb, var(--admin-green) 80%, black));
  box-shadow: 0 16px 34px color-mix(in srgb, var(--admin-green) 22%, transparent);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.admin-auth-submit:hover {
  transform: translateY(-1px);
  box-shadow: 0 20px 40px color-mix(in srgb, var(--admin-green) 30%, transparent);
}

.admin-auth-note {
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(20, 67, 59, 0.06);
  color: var(--admin-muted);
  font-size: 13px;
  line-height: 1.7;
}

.admin-auth-footer {
  color: color-mix(in srgb, var(--admin-ink) 68%, white);
  font-size: 14px;
  font-weight: 900;
  text-decoration: none;
}

:deep(.el-form-item) {
  margin-bottom: 0;
}

:deep(.el-form-item__label) {
  color: var(--admin-ink);
  font-weight: 800;
}

:deep(.el-input__wrapper) {
  min-height: 52px;
  border-radius: 16px;
  box-shadow: 0 0 0 1px rgba(120, 113, 108, 0.2) inset;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px rgba(20, 67, 59, 0.42) inset, 0 0 0 4px rgba(20, 67, 59, 0.12);
}

@media (max-width: 1080px) {
  .admin-auth-metrics {
    grid-template-columns: 1fr;
  }

  .admin-auth-metric {
    min-height: auto;
  }
}

@media (max-width: 920px) {
  .admin-auth-shell {
    grid-template-columns: 1fr;
    width: min(100% - 36px, 620px);
  }

  .admin-auth-brand {
    display: none;
  }
}

@media (max-width: 560px) {
  .admin-auth-logo {
    left: 18px;
    top: 18px;
  }

  .admin-auth-logo img {
    height: 46px;
  }

  .admin-auth-shell {
    width: min(100% - 28px, 620px);
    padding-top: 88px;
  }

  .admin-auth-card {
    padding: 24px;
  }
}
</style>
