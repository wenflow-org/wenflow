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
          <h1>回到你的目标、路径和学习进度。</h1>
          <p>登录后可以继续当前任务，也可以查看最近的学习反馈。</p>

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
            <p>请输入账号信息。</p>
          </div>

          <el-form
            ref="formRef"
            :model="loginForm"
            :rules="rules"
            label-position="top"
            size="large"
            class="auth-form"
            :aria-busy="loading"
            @submit.prevent="handleLogin"
          >
            <el-form-item label="用户名" prop="name">
              <el-input v-model="loginForm.name" type="text" placeholder="请输入用户名" prefix-icon="User" autocomplete="username" clearable />
            </el-form-item>

            <el-form-item label="密码" prop="password">
              <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" prefix-icon="Lock" autocomplete="current-password" show-password />
            </el-form-item>

            <el-button type="primary" native-type="submit" :loading="loading" :disabled="loading" class="auth-submit">
              {{ loading ? '正在登录...' : '登录' }}
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
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { type FormInstance, type FormRules } from 'element-plus';
import { toast } from '../utils/toast';
import { consumeAuthFlashMessage } from '../utils/authFlash';
import { useUserStore } from '../stores/user';
import { authAPI } from '../api/auth';
import '../styles/auth.css';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const loginPoints = [
  { title: '目标和路径自动保留', desc: '回到已经整理过的目标和学习安排。' },
  { title: '继续当前任务', desc: '直接从最近正在学习的内容继续。' },
  { title: '查看学习反馈', desc: '了解已经掌握的内容和下一步建议。' }
];

const loginForm = reactive({
  name: '',
  password: ''
});

const rules: FormRules = {
  name: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
};

const safeRedirect = computed(() => {
  const value = Array.isArray(route.query.redirect) ? route.query.redirect[0] : route.query.redirect;
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;

  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
});

onMounted(() => {
  const message = consumeAuthFlashMessage();
  if (message) toast.error(message);
});

const handleLogin = async () => {
  if (!formRef.value || loading.value) return;

  loading.value = true;
  try {
    const valid = await formRef.value.validate().catch(() => false);
    if (!valid) return;

    await userStore.login(loginForm.name, loginForm.password);
    toast.success('登录成功');
    await router.replace(safeRedirect.value || '/dashboard');
  } catch (error: unknown) {
    console.error('登录失败:', error);
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '登录失败，请检查用户名和密码';
    toast.error(message);
  } finally {
    loading.value = false;
  }
};

const handleGoRegister = async () => {
  try {
    const status = await authAPI.getRegistrationStatus();
    if (!status.registrationEnabled) {
      toast.warning('当前暂未开放注册');
      return;
    }

    router.push({ path: '/register', query: safeRedirect.value ? { redirect: safeRedirect.value } : undefined });
  } catch (error) {
    router.push({ path: '/register', query: safeRedirect.value ? { redirect: safeRedirect.value } : undefined });
  }
};
</script>

<style scoped>
/* 公共样式见 src/styles/auth.css，此处仅保留登录页差异部分 */
.auth-meta {
  margin-top: -6px;
}
</style>
