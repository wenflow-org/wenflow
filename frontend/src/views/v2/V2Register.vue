<template>
  <V2AuthLayout>
    <div class="head">
      <h2>加入问流</h2>
      <p>注册后进入学习台，从一个真实问题开始推进。</p>
    </div>

    <!-- 注册状态：查询中 -->
    <div v-if="status === 'checking'" class="state">
      <span class="spinner spinner--sm spinner--blue"></span>
      <p>正在准备注册页面…</p>
    </div>

    <!-- 注册状态：暂不可用 -->
    <div v-else-if="status !== 'enabled'" class="state state--warn">
      <template v-if="status === 'temporaryUnavailable'">
        <strong>核心学习服务正在恢复</strong>
        <p>暂时无法创建账号，稍后再试。</p>
      </template>
      <template v-else-if="status === 'disabled'">
        <strong>当前暂未开放注册</strong>
        <p>如需账号，请联系管理员。</p>
      </template>
      <template v-else>
        <strong>无法确认注册状态</strong>
        <p>网络异常，请重试。</p>
      </template>
      <div class="state__actions">
        <button type="button" class="btn-primary" @click="loadStatus">重新查询</button>
      </div>
    </div>

    <form v-else class="form" :aria-busy="loading" @submit.prevent="handleRegister">
      <label class="field" :class="{ 'field--error': errors.name }">
        <span class="field__label">用户名</span>
        <input v-model.trim="form.name" type="text" class="field__input" placeholder="2 - 20 个字符" autocomplete="username" autofocus @blur="touch('name')" />
        <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
      </label>

      <label class="field" :class="{ 'field--error': errors.password }">
        <span class="field__label">密码</span>
        <span class="field__pwd">
          <input v-model="form.password" :type="showPwd ? 'text' : 'password'" class="field__input" placeholder="请输入密码" autocomplete="new-password" @blur="touch('password')" />
          <button type="button" class="field__eye" :aria-label="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
            <svg v-if="showPwd" viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 5c-5 0-9.3 3-11 7 1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>
            <svg v-else viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.2-3.2c-1.6.8-3.4 1.3-5.3 1.3-5 0-9.3-3-11-7a12.4 12.4 0 0 1 4.7-5.5L2.1 3.5zM12 5c1.4 0 2.8.3 4 .9L8.9 8.8A4.48 4.48 0 0 1 12 7.5a4.5 4.5 0 0 1 4.5 4.5c0 1.2-.4 2.2-1.1 3l2.9 2.9c2-1.3 3.6-3.2 4.7-5.4-2-3.7-6.1-6-11-6z"/></svg>
          </button>
        </span>
        <ul v-if="form.password.length > 0" class="rules">
          <li :class="{ 'is-ok': checks.length }"><i>{{ checks.length ? '✓' : '○' }}</i>至少 8 位</li>
          <li :class="{ 'is-ok': checks.letter }"><i>{{ checks.letter ? '✓' : '○' }}</i>包含字母</li>
          <li :class="{ 'is-ok': checks.digit }"><i>{{ checks.digit ? '✓' : '○' }}</i>包含数字</li>
        </ul>
        <p v-else class="hint">密码至少 8 位，且需同时包含字母和数字。</p>
        <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
      </label>

      <label class="field" :class="{ 'field--error': errors.confirm }">
        <span class="field__label">确认密码</span>
        <input v-model="form.confirm" :type="showPwd ? 'text' : 'password'" class="field__input" placeholder="请再次输入密码" autocomplete="new-password" @blur="touch('confirm')" />
        <span v-if="errors.confirm" class="field__error">{{ errors.confirm }}</span>
      </label>

      <button type="submit" class="btn-primary btn-primary--block" :disabled="loading">
        {{ loading ? '正在创建账号…' : '创建账号' }}
      </button>

      <p v-if="dailyQuota > 0" class="quota-hint">
        同一 IP 每天最多注册 {{ dailyQuota }} 个账号（防批量注册）
      </p>

      <div class="switch">
        <span>已有账号？</span>
        <button type="button" @click="goLogin">立即登录</button>
      </div>
    </form>
  </V2AuthLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from '@/utils/toast';
import { useUserStore } from '@/stores/user';
import { authAPI } from '@/api/auth';
import V2AuthLayout from './V2AuthLayout.vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const loading = ref(false);

const status = ref<'checking' | 'enabled' | 'disabled' | 'temporaryUnavailable' | 'failed'>('checking');
const dailyQuota = ref(0);

const form = reactive({ name: '', password: '', confirm: '' });
const errors = reactive({ name: '', password: '', confirm: '' });
const showPwd = ref(false);

const checks = computed(() => ({
  length: form.password.length >= 8,
  letter: /[a-zA-Z]/.test(form.password),
  digit: /[0-9]/.test(form.password)
}));

function touch(key: 'name' | 'password' | 'confirm') {
  if (key === 'name') {
    if (!form.name) errors.name = '请输入用户名';
    else if (form.name.length < 2 || form.name.length > 20) errors.name = '用户名长度需为 2 到 20 个字符';
    else errors.name = '';
  }
  if (key === 'password') {
    if (!form.password) errors.password = '请输入密码';
    else if (!checks.value.length) errors.password = '密码至少 8 位';
    else if (!checks.value.letter) errors.password = '密码必须包含字母';
    else if (!checks.value.digit) errors.password = '密码必须包含数字';
    else errors.password = '';
  }
  if (key === 'confirm') {
    if (!form.confirm) errors.confirm = '请再次输入密码';
    else if (form.confirm !== form.password) errors.confirm = '两次输入密码不一致';
    else errors.confirm = '';
  }
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

async function loadStatus() {
  status.value = 'checking';
  try {
    const s = await authAPI.getRegistrationStatus();
    dailyQuota.value = Number(s.maxAccountsPerIpPerDay) || 0;
    if (s.registrationEnabled) status.value = 'enabled';
    else status.value = s.temporaryUnavailable ? 'temporaryUnavailable' : 'disabled';
  } catch {
    status.value = 'failed';
  }
}

async function handleRegister() {
  touch('name');
  touch('password');
  touch('confirm');
  if (errors.name || errors.password || errors.confirm || loading.value) return;

  loading.value = true;
  try {
    await userStore.register(form.name, form.password);
    toast.success('注册成功');
    await router.replace(safeRedirect.value || '/dashboard');
  } catch (error: unknown) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '注册失败，请稍后重试';
    toast.error(message);
  } finally {
    loading.value = false;
  }
}

function goLogin() {
  router.replace({ path: '/login', query: safeRedirect.value ? { redirect: safeRedirect.value } : undefined });
}

onMounted(loadStatus);
</script>

<style scoped>
.head { display: grid; gap: 5px; }
.head h2 { margin: 0; font-size: 22px; }
.head p { margin: 0; font-size: 13px; color: var(--muted); }

.state {
  display: grid; justify-items: center; gap: 10px;
  padding: 28px 12px;
  text-align: center;
  color: var(--muted); font-size: 13px;
}
.state strong { font-size: 15px; color: var(--ink); }
.state p { margin: 0; }
.state__actions { display: flex; gap: 10px; margin-top: 8px; }
.state .btn-primary, .state .btn-ghost { padding: 9px 16px; font-size: 13px; }
.spinner--blue { border-color: rgba(52, 120, 246, 0.2); border-top-color: var(--blue); width: 26px; height: 26px; border-width: 3px; }

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

.hint { margin: 0; font-size: 11.5px; color: var(--faint); }
.quota-hint { margin: -4px 0 0; font-size: 11.5px; color: var(--faint); text-align: center; }
.rules { list-style: none; margin: 0; padding: 0; display: flex; gap: 12px; flex-wrap: wrap; }
.rules li { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--faint); }
.rules li.is-ok { color: var(--green); font-weight: 700; }
.rules li i { font-style: normal; }

.btn-primary--block { justify-content: center; width: 100%; padding: 12px; font-size: 14.5px; }
.btn-primary--block:disabled { opacity: 0.6; cursor: default; box-shadow: none; }

.switch { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: var(--muted); }
.switch button {
  border: 0; background: transparent;
  color: var(--blue-deep);
  font: inherit; font-weight: 800;
  cursor: pointer; padding: 0;
}
.switch button:hover { text-decoration: underline; }
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
