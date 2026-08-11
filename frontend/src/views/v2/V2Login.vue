<template>
  <V2AuthLayout>
    <div class="head">
      <h2>欢迎回来</h2>
      <p>登录后，从上次停下的地方继续。</p>
    </div>

    <form class="form" :aria-busy="loading" @submit.prevent="handleLogin">
      <div v-if="formError" class="errorbar" role="alert">{{ formError }}</div>

      <label class="field" :class="{ 'field--error': errors.name }">
        <span class="field__label">用户名</span>
        <input
          v-model.trim="form.name"
          type="text"
          class="field__input"
          placeholder="请输入用户名"
          autocomplete="username"
          autofocus
          @blur="touch('name')"
          @input="formError = ''"
        />
        <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
      </label>

      <label class="field" :class="{ 'field--error': errors.password }">
        <span class="field__label">密码</span>
        <span class="field__pwd">
          <input
            v-model="form.password"
            :type="showPwd ? 'text' : 'password'"
            class="field__input"
            placeholder="请输入密码"
            autocomplete="current-password"
            @blur="touch('password')"
            @input="formError = ''"
          />
          <button type="button" class="field__eye" :aria-label="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
            <svg v-if="showPwd" viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 5c-5 0-9.3 3-11 7 1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>
            <svg v-else viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.2-3.2c-1.6.8-3.4 1.3-5.3 1.3-5 0-9.3-3-11-7a12.4 12.4 0 0 1 4.7-5.5L2.1 3.5zM12 5c1.4 0 2.8.3 4 .9L8.9 8.8A4.48 4.48 0 0 1 12 7.5a4.5 4.5 0 0 1 4.5 4.5c0 1.2-.4 2.2-1.1 3l2.9 2.9c2-1.3 3.6-3.2 4.7-5.4-2-3.7-6.1-6-11-6z"/></svg>
          </button>
        </span>
        <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
      </label>

      <button type="submit" class="btn-primary btn-primary--block" :disabled="loading">
        {{ loading ? '正在登录…' : '登录' }}
      </button>

      <div class="switch">
        <span>还没有账号？</span>
        <button type="button" @click="goRegister">立即注册</button>
      </div>

      <div class="forgot-row">
        <router-link :to="{ path: '/reset-password', query: safeRedirect ? { redirect: safeRedirect } : undefined }" class="forgot-link">
          忘记密码？
        </router-link>
      </div>
    </form>
  </V2AuthLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from '@/utils/toast';
import { consumeAuthFlashMessage } from '@/utils/authFlash';
import { useUserStore } from '@/stores/user';
import { authAPI } from '@/api/auth';
import V2AuthLayout from './V2AuthLayout.vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const loading = ref(false);

const LAST_NAME_KEY = 'v2_last_username';

const form = reactive({
  name: localStorage.getItem(LAST_NAME_KEY) || '',
  password: ''
});
const errors = reactive({ name: '', password: '' });
const showPwd = ref(false);
const formError = ref('');

function touch(key: 'name' | 'password') {
  if (key === 'name') errors.name = form.name ? '' : '请输入用户名';
  if (key === 'password') errors.password = form.password ? '' : '请输入密码';
}

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

async function handleLogin() {
  touch('name');
  touch('password');
  if (errors.name || errors.password || loading.value) return;

  loading.value = true;
  try {
    await userStore.login(form.name, form.password);
    localStorage.setItem(LAST_NAME_KEY, form.name);
    toast.success('登录成功');
    await router.replace(safeRedirect.value || '/dashboard');
  } catch (error: unknown) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '登录失败，请检查用户名和密码';
    formError.value = message;
    toast.error(message);
  } finally {
    loading.value = false;
  }
}

async function goRegister() {
  try {
    const status = await authAPI.getRegistrationStatus();
    if (!status.registrationEnabled) {
      toast.warning('当前暂未开放注册');
      return;
    }
  } catch {
    /* 状态查询失败时仍允许进入注册页，由注册页自行处理 */
  }
  router.push({ path: '/register', query: safeRedirect.value ? { redirect: safeRedirect.value } : undefined });
}

onMounted(() => {
  const message = consumeAuthFlashMessage();
  if (message) toast.error(message);
});
</script>

<style scoped>
.head { display: grid; gap: 5px; }
.head h2 { margin: 0; font-size: 22px; }
.head p { margin: 0; font-size: 13px; color: var(--muted); }

.form { display: grid; gap: 14px; }
.field { display: grid; gap: 6px; }
.field__label { font-size: 12.5px; font-weight: 700; color: var(--muted); }
.field__input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 11px 14px;
  font: inherit; font-size: 14px;
  color: var(--ink);
  background: var(--surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}
.field__input:focus {
  border-color: rgba(52, 120, 246, 0.55);
  box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.12);
}
.field--error .field__input { border-color: rgba(239, 117, 120, 0.6); }
.field--error .field__input:focus { box-shadow: 0 0 0 3px rgba(239, 117, 120, 0.12); }
.field__error { font-size: 11.5px; color: #c0454a; font-weight: 600; }

.btn-primary--block {
  justify-content: center;
  width: 100%;
  padding: 12px;
  font-size: 14.5px;
}
.btn-primary--block:disabled { opacity: 0.6; cursor: default; box-shadow: none; }

.switch {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  font-size: 13px; color: var(--muted);
}
.switch button {
  border: 0; background: transparent;
  color: var(--blue-deep);
  font: inherit; font-weight: 800;
  cursor: pointer; padding: 0;
}
.switch button:hover { text-decoration: underline; }

.forgot-row {
  display: flex;
  justify-content: center;
  margin-top: -4px;
}
.forgot-link {
  font-size: 12.5px;
  color: var(--muted);
  text-decoration: none;
}
.forgot-link:hover {
  color: var(--blue-deep);
  text-decoration: underline;
}
</style>

<style scoped>
.field__pwd { position: relative; display: block; }
.field__pwd .field__input { padding-right: 42px; }
.field__eye {
  position: absolute;
  right: 8px; top: 50%;
  transform: translateY(-50%);
  width: 30px; height: 30px;
  border: 0; border-radius: 8px;
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  display: grid; place-items: center;
}
.field__eye:hover { color: var(--blue-deep); background: rgba(52, 120, 246, 0.07); }
</style>
