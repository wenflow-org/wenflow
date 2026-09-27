<template>
  <V2AuthLayout>
    <form class="reset" @submit.prevent="submit">
      <div class="head">
        <h2>{{ hasToken ? '设置新密码' : '找回密码' }}</h2>
        <!-- 不再复述「输入用户名」（label 已说一次，走查 2026-09-27 冗余文案项）；
             也不承诺「发送链接」——当前链路是验证身份后直接设置新密码 -->
        <p v-if="!hasToken">验证通过后即可设置新密码。</p>
        <p v-else>输入新密码完成重置，重置后所有已登录设备将退出。</p>
      </div>

      <!-- 带 token 但校验不过（伪造/截断链接）：此前静默降级为找回表单，用户不知道手里的链接已废（走查 2026-09-27 P2） -->
      <div v-if="tokenRejected" class="errorbar" role="alert">
        链接无效或已过期，请重新找回。
      </div>
      <div v-else-if="formError" class="errorbar" role="alert">
        {{ formError }}
      </div>

      <!-- 找回结果回执：不是错误，不复用红色 errorbar（走查 2026-09-27 P1） -->
      <div v-if="notice" class="noticebar" role="status">
        {{ notice }}
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
              <Eye v-if="!showPwd" :size="17" :stroke-width="1.75" />
              <EyeOff v-else :size="17" :stroke-width="1.75" />
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
            :disabled="submitting"
          />
          <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
        </label>
      </template>

      <button type="submit" class="btn-primary btn-primary--block" :disabled="submitting">
        {{ submitting ? '提交中…' : (hasToken ? '重置密码' : '提交') }}
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
import { Eye, EyeOff } from 'lucide-vue-next';
import { toast } from '@/utils/toast';
import { authAPI } from '@/api/auth';
import V2AuthLayout from './V2AuthLayout.vue';

const router = useRouter();
const route = useRoute();

const hasToken = computed(() => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  return Boolean(token && token.length >= 20);
});

/* 有 token 但长度不过：显式告知链接无效，而不是悄悄换成找回表单 */
const tokenRejected = computed(() => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  return Boolean(token) && token.length < 20;
});

const submitting = ref(false);
const showPwd = ref(false);
const formError = ref('');
const notice = ref('');
const form = reactive({
  name: '',
  newPassword: '',
  confirmPassword: ''
});
const errors = reactive({ name: '', newPassword: '', confirmPassword: '' });

async function submit() {
  formError.value = '';
  notice.value = '';
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
      // 中性回执：不承诺「发送链接」，也不提示后端日志（终端用户拿不到，走查 2026-09-27 P1）
      notice.value = '若该账号存在，重置方式已生成。';
    }
  } catch (error: unknown) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '操作失败，请稍后重试';
    formError.value = message;
    // 行内 errorbar 为主，toast 只留给网络类错误（走查 2026-09-27 P3 三页统一）
    if (isNetworkError(error)) toast.error(message);
  } finally {
    submitting.value = false;
  }
}

/* http 层约定：断网/超时的 reject 不带 status 字段，业务错误一定带 */
function isNetworkError(error: unknown): boolean {
  return !(error && typeof error === 'object' && 'status' in error);
}

function goLogin() {
  router.replace({ path: '/login', query: route.query.redirect ? { redirect: String(route.query.redirect) } : undefined });
}
</script>

<style scoped>
.head { display: grid; gap: 5px; }
.head h2 { margin: 0; font-size: 20px; }
.head p { margin: 0; font-size: 13px; color: var(--muted); }

.reset { display: grid; gap: 14px; }
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
.field__error { font-size: 12px; color: var(--red-ink); font-weight: 600; }

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
  border-radius: var(--mk-radius-xl);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
  color: var(--red-ink);
  font-size: 13px;
  font-weight: 600;
}

/* 找回结果回执：中性蓝调（错误才用红，成功提示不复用告警样式） */
.noticebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--mk-radius-xl);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 25%, transparent);
  color: var(--blue-deep);
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
  cursor: pointer;
  min-height: 36px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
}
.switch button:hover { text-decoration: underline; }

.field__pwd { position: relative; display: block; }
.field__pwd .field__input { padding-right: 42px; }
/* 34×34 与登录/注册页同规格（走查 2026-09-27：原 padding:4px 的 ≈25×25 低于触控门禁） */
.field__eye {
  position: absolute;
  right: 5px; top: 50%;
  transform: translateY(-50%);
  width: 34px; height: 34px;
  border: 0; border-radius: var(--mk-radius-md);
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  display: grid; place-items: center;
}
.field__eye:hover { color: var(--blue-deep); background: rgba(52, 120, 246, 0.07); }
</style>
