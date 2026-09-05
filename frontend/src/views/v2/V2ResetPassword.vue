<template>
  <V2AuthLayout>
    <form class="reset" @submit.prevent="submit">
      <div class="head">
        <h2>{{ hasToken ? '设置新密码' : '找回密码' }}</h2>
        <p v-if="!hasToken">输入注册时使用的用户名，重置链接将通过可用通道发送。</p>
        <p v-else>输入新密码完成重置，重置后所有已登录设备将退出。</p>
      </div>

      <div v-if="formError" class="errorbar" role="alert">
        {{ formError }}
      </div>

      <template v-if="hasToken">
        <label class="field">
          <span class="field__label">新密码</span>
          <span class="field__pwd">
            <input
              v-model="form.newPassword"
              type="password"
              class="field__input"
              placeholder="至少 8 位，且需同时包含字母和数字"
              :disabled="submitting"
            />
            <button type="button" class="field__eye" @click="showPwd = !showPwd" :aria-label="showPwd ? '隐藏密码' : '显示密码'">
              <svg v-if="!showPwd" viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
              <svg v-else viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.2-3.2c-1.6.8-3.4 1.3-5.3 1.3-5 0-9.3-3-11-7a12.4 12.4 0 0 1 4.7-5.5L2.1 3.5zM12 5c1.4 0 2.8.3 4 .9L8.9 8.8A4.48 4.48 0 0 1 12 7.5a4.5 4.5 0 0 1 4.5 4.5c0 1.2-.4 2.2-1.1 3l2.9 2.9c2-1.3 3.6-3.2 4.7-5.4-2-3.7-6.1-6-11-6z"/></svg>
            </button>
          </span>
          <span v-if="errors.newPassword" class="field__error">{{ errors.newPassword }}</span>
        </label>

        <label class="field">
          <span class="field__label">确认新密码</span>
          <input
            v-model="form.confirmPassword"
            type="password"
            class="field__input"
            placeholder="请再次输入新密码"
            :disabled="submitting"
          />
          <span v-if="errors.confirmPassword" class="field__error">{{ errors.confirmPassword }}</span>
        </label>
      </template>

      <template v-else>
        <label class="field">
          <span class="field__label">用户名</span>
          <input
            v-model="form.name"
            type="text"
            class="field__input"
            placeholder="请输入注册用户名"
            :disabled="submitting"
          />
          <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
        </label>
      </template>

      <button type="submit" class="btn-primary btn-primary--block" :disabled="submitting">
        {{ submitting ? '提交中…' : (hasToken ? '重置密码' : '发送重置链接') }}
      </button>

      <div class="switch">
        <span>想起来了？</span>
        <button type="button" @click="goLogin">返回登录</button>
      </div>
    </form>
  </V2AuthLayout>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from '@/utils/toast';
import { authAPI } from '@/api/auth';
import V2AuthLayout from './V2AuthLayout.vue';

const router = useRouter();
const route = useRoute();

const hasToken = computed(() => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  return Boolean(token && token.length >= 20);
});

const submitting = ref(false);
const showPwd = ref(false);
const formError = ref('');
const form = reactive({
  name: '',
  newPassword: '',
  confirmPassword: ''
});
const errors = reactive({ name: '', newPassword: '', confirmPassword: '' });

async function submit() {
  formError.value = '';
  errors.name = '';
  errors.newPassword = '';
  errors.confirmPassword = '';

  if (hasToken.value) {
    if (!form.newPassword) errors.newPassword = '请输入新密码';
    else if (form.newPassword.length < 8 || !/[a-zA-Z]/.test(form.newPassword) || !/[0-9]/.test(form.newPassword)) {
      errors.newPassword = '密码至少 8 位，且需同时包含字母和数字';
    }
    if (form.confirmPassword !== form.newPassword) errors.confirmPassword = '两次输入的密码不一致';
    if (errors.newPassword || errors.confirmPassword) return;
  } else {
    if (!form.name.trim()) {
      errors.name = '请输入用户名';
      return;
    }
  }

  submitting.value = true;
  try {
    if (hasToken.value) {
      await authAPI.resetPassword(String(route.query.token), form.newPassword);
      toast.success('密码已重置，请使用新密码登录');
      await router.replace('/login');
    } else {
      await authAPI.forgotPassword(form.name.trim());
      formError.value = '如果该用户名存在，重置链接已发送。当前环境请在后端日志中查看链接。';
    }
  } catch (error: unknown) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '操作失败，请稍后重试';
    formError.value = message;
    toast.error(message);
  } finally {
    submitting.value = false;
  }
}

function goLogin() {
  router.replace({ path: '/login', query: route.query.redirect ? { redirect: String(route.query.redirect) } : undefined });
}
</script>

<style scoped>
.head { display: grid; gap: 5px; }
.head h2 { margin: 0; font-size: 22px; }
.head p { margin: 0; font-size: 13px; color: var(--muted); }

.reset { display: grid; gap: 14px; }
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
.field__error { font-size: 11.5px; color: #c0454a; font-weight: 600; }

.btn-primary--block {
  justify-content: center;
  width: 100%;
  padding: 12px;
  font-size: 14.5px;
}
.btn-primary--block:disabled { opacity: 0.6; cursor: default; box-shadow: none; }

.errorbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: #c0454a;
  font-size: 13px;
  font-weight: 600;
}

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

.field__pwd { position: relative; display: block; }
.field__pwd .field__input { padding-right: 42px; }
.field__eye {
  position: absolute;
  right: 10px; top: 50%;
  transform: translateY(-50%);
  border: 0; background: transparent;
  color: var(--faint);
  cursor: pointer;
  padding: 4px;
  display: flex;
}
.field__eye:hover { color: var(--muted); }
</style>
