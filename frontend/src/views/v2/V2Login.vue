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
            autocomplete="current-password"
            @blur="touch('password')"
            @input="formError = ''"
          />
          <button type="button" class="field__eye" :aria-label="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
            <Eye v-if="showPwd" :size="17" :stroke-width="1.75" />
            <EyeOff v-else :size="17" :stroke-width="1.75" />
          </button>
        </span>
        <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
      </label>

      <label class="remember-row">
        <input type="checkbox" v-model="remember" class="remember-cb" />
        <span>记住我</span>
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
import { Eye, EyeOff } from 'lucide-vue-next';
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
const remember = ref(false);
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
    await userStore.login(form.name, form.password, remember.value);
    // 「记住我」勾选才记住用户名：未勾选仍写入会让勾选框语义落空（走查 2026-09-27 P3）
    if (remember.value) localStorage.setItem(LAST_NAME_KEY, form.name);
    else localStorage.removeItem(LAST_NAME_KEY);
    toast.success('登录成功');
    // 新用户引导：未完成 onboarding → 跳转引导页
    if (userStore.user?.onboardingCompleted === false) {
      await router.replace('/onboarding');
    } else {
      await router.replace(safeRedirect.value || '/dashboard');
    }
  } catch (error: unknown) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '登录失败，请检查用户名和密码';
    formError.value = message;
    // 行内 errorbar 为主，toast 只留给网络类错误（走查 2026-09-27 P3 三页统一）
    if (isNetworkError(error)) toast.error(message);
  } finally {
    loading.value = false;
  }
}

/* http 层约定：断网/超时的 reject 不带 status 字段，业务错误一定带 */
function isNetworkError(error: unknown): boolean {
  return !(error && typeof error === 'object' && 'status' in error);
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
.head h2 { margin: 0; font-size: 20px; }
.head p { margin: 0; font-size: 13px; color: var(--muted); }

.form { display: grid; gap: 14px; }
.field { display: grid; gap: 6px; }
.field__label { font-size: 12.5px; font-weight: 700; color: var(--muted); }
.field__input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl);
  padding: 11px 14px;
  font: inherit; font-size: 14px;
  color: var(--ink);
  background: var(--surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}
.field__input:focus {
  border-color: color-mix(in srgb, var(--blue) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 12%, transparent);
}
.field--error .field__input { border-color: color-mix(in srgb, var(--red) 60%, transparent); }
.field--error .field__input:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 12%, transparent); }
.field__error { font-size: 12px; color: var(--red-ink); font-weight: 600; }

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
  cursor: pointer;
  padding: 5px 8px;
  min-height: 36px;
  border-radius: var(--mk-radius-md);
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
  /* ≥36px 可点高度（走查 2026-09-27：19px 高的文字链触控不达标） */
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 6px;
}
.forgot-link:hover {
  color: var(--blue-deep);
  text-decoration: underline;
}

.remember-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  /* 整行都是可点区域，高度给到 44（走查 2026-09-27：勾选框本体只有 24×24） */
  min-height: 44px;
  margin-bottom: 4px;
}
.remember-cb {
  appearance: none;
  -webkit-appearance: none;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 1.5px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  cursor: pointer;
  position: relative;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.remember-cb:hover { border-color: color-mix(in srgb, var(--blue) 50%, transparent); }
.remember-cb:checked { background: var(--blue); border-color: var(--blue); }
.remember-cb:checked::after {
  content: '';
  position: absolute;
  left: 7px; top: 3px;
  width: 6px; height: 11px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
</style>

<style scoped>
.field__pwd { position: relative; display: block; }
.field__pwd .field__input { padding-right: 42px; }
.field__eye {
  position: absolute;
  right: 4px; top: 50%;
  transform: translateY(-50%);
  /* 34→36：低于仓库「可点元素不低于 36px」的硬线；登录/注册不在 mobile:spec 的
     测量清单里，所以一直没被门禁抓到（2026-10-08 用户侧视觉检查报出）。 */
  width: 36px; height: 36px;
  border: 0; border-radius: var(--mk-radius-md);
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  display: grid; place-items: center;
}

.field__eye:hover { color: var(--blue-deep); background: rgba(52, 120, 246, 0.07); }
</style>
