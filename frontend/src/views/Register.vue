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
          <span class="auth-brand__eyebrow">第一次使用问流</span>
          <h1>从一个模糊目标，生成一条能开始的路径。</h1>
          <p>先不用准备完整计划。说出最近想解决的问题，问流会通过几轮提问，帮你找到可以开始的一步。</p>

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
            <router-link to="/" class="auth-back-link">← 返回首页</router-link>
          </div>

          <div class="auth-card__header">
            <h2>创建账号</h2>
            <p>注册后进入学习台，从一个真实问题开始推进。</p>
          </div>

          <div v-if="registrationCheckFailed" class="auth-registration-state auth-registration-state--error" role="alert">
            <strong>暂时无法确认是否开放注册</strong>
            <p>为避免提交失败，请先重新查询注册状态。</p>
            <button type="button" class="auth-registration-state__action" :disabled="registrationChecking" @click="loadRegistrationStatus">
              {{ registrationChecking ? '正在重试...' : '重新查询' }}
            </button>
          </div>

          <div v-else-if="registrationEnabled === null" class="auth-registration-state" role="status" aria-live="polite">
            <strong>正在确认注册状态...</strong>
          </div>

          <div v-else-if="!registrationEnabled" class="auth-registration-state">
            <strong>{{ registrationTemporaryUnavailable ? '新账号注册暂时不可用' : '当前暂未开放注册' }}</strong>
            <p>
              {{ registrationTemporaryUnavailable
                ? '核心学习服务正在恢复，请稍后再试。'
                : '你可以先查看产品介绍，开放后再创建账号。' }}
            </p>
            <button
              v-if="registrationTemporaryUnavailable"
              type="button"
              class="auth-registration-state__action"
              :disabled="registrationChecking"
              @click="loadRegistrationStatus"
            >
              {{ registrationChecking ? '正在重试...' : '重新查询' }}
            </button>
            <router-link v-else to="/" class="auth-registration-state__action">返回首页</router-link>
          </div>

          <el-form
            v-else
            ref="formRef"
            :model="registerForm"
            :rules="rules"
            label-position="top"
            size="large"
            class="auth-form"
            :aria-busy="loading"
            @submit.prevent="handleRegister"
          >
            <el-form-item label="用户名" prop="name">
              <el-input v-model="registerForm.name" placeholder="请输入用户名" prefix-icon="User" autocomplete="username" clearable />
            </el-form-item>

            <el-form-item label="密码" prop="password">
              <el-input v-model="registerForm.password" type="password" placeholder="请输入密码" prefix-icon="Lock" autocomplete="new-password" show-password />
            </el-form-item>

            <ul v-if="registerForm.password.length > 0" class="auth-password-rules">
              <li :class="{ 'is-ok': passwordChecks.length }">
                <span class="auth-password-rules__icon" aria-hidden="true">{{ passwordChecks.length ? '✓' : '○' }}</span>
                至少 8 位
              </li>
              <li :class="{ 'is-ok': passwordChecks.letter }">
                <span class="auth-password-rules__icon" aria-hidden="true">{{ passwordChecks.letter ? '✓' : '○' }}</span>
                包含字母
              </li>
              <li :class="{ 'is-ok': passwordChecks.digit }">
                <span class="auth-password-rules__icon" aria-hidden="true">{{ passwordChecks.digit ? '✓' : '○' }}</span>
                包含数字
              </li>
            </ul>
            <p v-else class="auth-hint">密码至少 8 位，且需同时包含字母和数字。</p>

            <el-form-item label="确认密码" prop="confirmPassword">
              <el-input v-model="registerForm.confirmPassword" type="password" placeholder="请再次输入密码" prefix-icon="Lock" autocomplete="new-password" show-password />
            </el-form-item>

            <el-button type="primary" native-type="submit" :loading="loading" :disabled="loading" class="auth-submit">
              {{ loading ? '正在创建账号...' : '创建账号' }}
            </el-button>

            <div class="auth-switch">
              <span>已有账号？</span>
              <button type="button" @click="goToLogin">立即登录</button>
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
import { useUserStore } from '../stores/user';
import { authAPI } from '../api/auth';
import '../styles/auth.css';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);
const registrationEnabled = ref<boolean | null>(null);
const registrationChecking = ref(false);
const registrationCheckFailed = ref(false);
const registrationTemporaryUnavailable = ref(false);

const registerPoints = [
  { title: '先说出目标', desc: '不用写完整计划，只需要描述最近想解决什么。' },
  { title: '一起缩小范围', desc: '通过几轮追问，把目标变成可执行的问题。' },
  { title: '生成第一版路径', desc: '先得到一条能开始执行的路线，后续再根据反馈调整。' }
];

const registerForm = reactive({
  name: '',
  password: '',
  confirmPassword: ''
});

// 密码规则实时反馈（视觉提示；校验仍在 blur 时由 el-form 给出）
const passwordChecks = computed(() => ({
  length: registerForm.password.length >= 8,
  letter: /[a-zA-Z]/.test(registerForm.password),
  digit: /[0-9]/.test(registerForm.password)
}));

const validatePass2 = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (value === '') {
    callback(new Error('请再次输入密码'));
  } else if (value !== registerForm.password) {
    callback(new Error('两次输入密码不一致'));
  } else {
    callback();
  }
};

const validatePassword = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请输入密码'));
    return;
  }
  if (value.length < 8) {
    callback(new Error('密码至少 8 位'));
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
    { min: 2, max: 20, message: '用户名长度需为 2 到 20 个字符', trigger: 'blur' }
  ],
  password: [{ required: true, validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ required: true, validator: validatePass2, trigger: 'blur' }]
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

const handleRegister = async () => {
  if (!formRef.value || loading.value || registrationEnabled.value !== true || registrationCheckFailed.value) return;

  loading.value = true;

  try {
    const valid = await formRef.value.validate().catch(() => false);
    if (!valid) return;

    await userStore.register(registerForm.name, registerForm.password);
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
};

const loadRegistrationStatus = async () => {
  if (registrationChecking.value) return;

  registrationChecking.value = true;
  registrationCheckFailed.value = false;
  registrationTemporaryUnavailable.value = false;
  registrationEnabled.value = null;

  try {
    const status = await authAPI.getRegistrationStatus();
    registrationEnabled.value = status.registrationEnabled;
    registrationTemporaryUnavailable.value = status.temporaryUnavailable === true;
  } catch (error) {
    registrationCheckFailed.value = true;
  } finally {
    registrationChecking.value = false;
  }
};

const goToLogin = () => {
  router.replace({ path: '/login', query: safeRedirect.value ? { redirect: safeRedirect.value } : undefined });
};

onMounted(loadRegistrationStatus);
</script>

<style scoped>
/* 公共样式见 src/styles/auth.css，此处仅保留注册页差异部分 */
.auth-registration-state {
  display: grid;
  gap: 12px;
  padding: 20px;
  border: 1px solid rgba(37, 99, 235, 0.12);
  border-radius: 16px;
  background: #f8fafc;
  color: var(--auth-muted);
}

.auth-registration-state strong {
  color: var(--auth-ink);
  font-size: 17px;
}

.auth-registration-state p {
  margin: 0;
  line-height: 1.6;
}

.auth-registration-state__action {
  width: fit-content;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--auth-blue-deep);
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.auth-registration-state--error {
  border-color: rgba(220, 38, 38, 0.16);
  background: rgba(254, 242, 242, 0.72);
}

.auth-registration-state__action:disabled {
  cursor: wait;
  opacity: 0.65;
}

.auth-hint {
  margin: 0;
  margin-top: -2px;
  color: var(--auth-muted);
  line-height: 1.7;
  font-size: 12px;
}

.auth-password-rules {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  margin-top: -2px;
  padding: 0;
  list-style: none;
  font-size: 12px;
  line-height: 1.7;
  color: var(--auth-muted);
}

.auth-password-rules li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color 0.2s ease;
}

.auth-password-rules li.is-ok {
  color: #15803d;
}

.auth-password-rules__icon {
  font-weight: 700;
}

:deep(.el-form-item.is-error) {
  margin-bottom: 18px;
}

:deep(.el-form-item__error) {
  padding-top: 5px;
  line-height: 1.35;
}

.auth-registration-state__action:focus-visible {
  outline: 3px solid rgba(52, 120, 246, 0.28);
  outline-offset: 4px;
  border-radius: 8px;
}
</style>
