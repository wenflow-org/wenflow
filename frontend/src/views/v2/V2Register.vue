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
      <div v-if="formError" class="errorbar" role="alert">{{ formError }}</div>

      <label class="field" :class="{ 'field--error': errors.name }">
        <span class="field__label">用户名</span>
        <input v-model.trim="form.name" type="text" class="field__input" placeholder="2 - 20 个字符" autocomplete="username" autofocus @blur="touch('name')" />
        <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
      </label>

      <label class="field" :class="{ 'field--error': errors.password }">
        <span class="field__label">密码</span>
        <span class="field__pwd">
          <input v-model="form.password" :type="showPwd ? 'text' : 'password'" class="field__input" autocomplete="new-password" @blur="touch('password')" />
          <button type="button" class="field__eye" :aria-label="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
            <Eye v-if="showPwd" :size="17" :stroke-width="1.75" />
            <EyeOff v-else :size="17" :stroke-width="1.75" />
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
        <input v-model="form.confirm" :type="showPwd ? 'text' : 'password'" class="field__input" autocomplete="new-password" @blur="touch('confirm')" />
        <span v-if="errors.confirm" class="field__error">{{ errors.confirm }}</span>
      </label>

      <button type="submit" class="btn-primary btn-primary--block" :disabled="loading">
        {{ loading ? '正在创建账号…' : '创建账号' }}
      </button>

      <!-- 每 IP 配额不在页首预展示具体数字（走查 2026-09-27 P3：向访客泄露风控阈值）；
           触达限制时后端错误信息会经下方 errorbar 自然提示 -->

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
import { Eye, EyeOff } from 'lucide-vue-next';
import { toast } from '@/utils/toast';
import { useUserStore } from '@/stores/user';
import { authAPI } from '@/api/auth';
import V2AuthLayout from './V2AuthLayout.vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const loading = ref(false);

const status = ref<'checking' | 'enabled' | 'disabled' | 'temporaryUnavailable' | 'failed'>('checking');

const form = reactive({ name: '', password: '', confirm: '' });
const errors = reactive({ name: '', password: '', confirm: '' });
const showPwd = ref(false);
const formError = ref('');

const checks = computed(() => ({
  length: form.password.length >= 8,
  letter: /[a-zA-Z]/.test(form.password),
  digit: /[0-9]/.test(form.password)
}));

function touch(key: 'name' | 'password' | 'confirm') {
  if (key === 'name') {
    if (!form.name) errors.name = '请输入用户名';
    else if (form.name.length < 2 || form.name.length > 20) errors.name = '用户名长度需为 2 到 20 个字符';
    else if (!/^[\p{L}\p{N}_-]+$/u.test(form.name)) errors.name = '用户名仅支持字母、数字、下划线和连字符';
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
    if (s.registrationEnabled) status.value = 'enabled';
    else status.value = s.temporaryUnavailable ? 'temporaryUnavailable' : 'disabled';
  } catch {
    status.value = 'failed';
  }
}

async function handleRegister() {
  formError.value = '';
  touch('name');
  touch('password');
  touch('confirm');
  if (errors.name || errors.password || errors.confirm || loading.value) return;

  loading.value = true;
  try {
    // 注册成功本就应保持登录：记住会话不做成选项（走查 2026-09-27：注册页「记住我」语义冗余）
    await userStore.register(form.name, form.password, true);
    toast.success('注册成功');
    await router.replace('/onboarding');
  } catch (error: unknown) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '注册失败，请稍后重试';
    // 行内 errorbar 为主，toast 只留给网络类错误（走查 2026-09-27 P3 三页统一）
    formError.value = message;
    if (isNetworkError(error)) toast.error(message);
  } finally {
    loading.value = false;
  }
}

/* http 层约定：断网/超时的 reject 不带 status 字段，业务错误一定带 */
function isNetworkError(error: unknown): boolean {
  return !(error && typeof error === 'object' && 'status' in error);
}

function goLogin() {
  router.replace({ path: '/login', query: safeRedirect.value ? { redirect: safeRedirect.value } : undefined });
}

onMounted(loadStatus);
</script>

<style scoped>
.head { display: grid; gap: 5px; }
.head h2 { margin: 0; font-size: 20px; }
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
.spinner--blue { border-color: color-mix(in srgb, var(--blue) 20%, transparent); border-top-color: var(--blue); width: 26px; height: 26px; border-width: 3px; }

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
  box-shadow: var(--mk-focus-ring); /* 全站唯一一圈 */
}
.field--error .field__input { border-color: color-mix(in srgb, var(--red) 60%, transparent); }
.field--error .field__input:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 12%, transparent); }
.field__error { font-size: 12px; color: var(--red-ink); font-weight: 600; }

.hint { margin: 0; font-size: 12px; color: var(--faint); }
.rules { list-style: none; margin: 0; padding: 0; display: flex; gap: 12px; flex-wrap: wrap; }
.rules li { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--faint); }
.rules li.is-ok { color: var(--green); font-weight: 700; }
.rules li i { font-style: normal; }

.btn-primary--block { justify-content: center; width: 100%; padding: 12px; font-size: 14.5px; }
.btn-primary--block:disabled { opacity: 0.6; cursor: default; box-shadow: none; }

.switch { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: var(--muted); }
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
.field__eye:hover { color: var(--blue-deep); background: color-mix(in srgb, var(--blue) 7%, transparent); }
</style>
