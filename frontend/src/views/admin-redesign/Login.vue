<template>
  <div class="auth v2-page">
    <!-- newui 原型 renderLogin 分栏布局：左品牌栏 + 右登录表单，≤1024 收成单列 -->
    <main class="login">
      <div class="login__shell">
        <aside class="login__aside">
          <img class="brand__logo" :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="问流 WenFlow" />
          <div class="login__lead">
            <h2>学习始于对真实问题的澄清，而非对课程的选择。</h2>
            <p>管理员控制台：管理学习者、教学闭环、编排图与平台运行状态。</p>
          </div>
          <div class="login__points">
            <span class="login__point"><i>1</i>JWT 身份 + 数据库管理员权限双重校验</span>
            <span class="login__point"><i>2</i>来源网络策略限制（默认仅私有网段）</span>
            <span class="login__point"><i>3</i>拒绝 Projection / Synthetic 身份登录</span>
          </div>
        </aside>

        <div class="login__panel">
          <div class="login__card">
            <img class="brand__logo login__brandsm" :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="问流 WenFlow" />
            <div>
              <h1>登录管理后台</h1>
              <p class="lead">使用管理员账户登录 WenFlow Admin Console</p>
            </div>

            <form class="form" :aria-busy="loading" @submit.prevent="handleLogin">
              <div v-if="loginError" class="errorbar" role="alert">{{ loginError }}</div>
              <label class="field" :class="{ 'field--error': errors.name }">
                <span class="field__label">管理员账号 <span class="req">*</span></span>
                <input
                  v-model.trim="loginForm.name"
                  type="text"
                  class="field__input"
                  placeholder="请输入管理员账号"
                  autocomplete="username"
                  autofocus
                  :aria-invalid="!!errors.name"
                  :aria-describedby="errors.name ? 'login-err-name' : undefined"
                  @blur="touch('name')"
                  @input="loginError = ''"
                />
                <span v-if="errors.name" id="login-err-name" class="field__error">{{ errors.name }}</span>
              </label>

              <label class="field" :class="{ 'field--error': errors.password }">
                <span class="field__label">密码 <span class="req">*</span></span>
                <span class="field__pwd">
                  <input
                    v-model="loginForm.password"
                    :type="showPwd ? 'text' : 'password'"
                    class="field__input"
                    placeholder="请输入密码"
                    autocomplete="current-password"
                    :aria-invalid="!!errors.password"
                    :aria-describedby="errors.password ? 'login-err-password' : undefined"
                    @blur="touch('password')"
                  />
                  <button
                    type="button"
                    class="field__eye"
                    :aria-label="showPwd ? '隐藏密码' : '显示密码'"
                    @click="showPwd = !showPwd"
                  >
                    <Eye v-if="showPwd" :size="17" :stroke-width="1.75" />
                    <EyeOff v-else :size="17" :stroke-width="1.75" />
                  </button>
                </span>
                <span v-if="errors.password" id="login-err-password" class="field__error">{{ errors.password }}</span>
              </label>

              <label class="remember">
                <input v-model="loginForm.remember" type="checkbox" />
                <span>记住本机登录状态</span>
              </label>

              <button type="submit" class="btn-primary btn-primary--block" :disabled="loading">
                {{ loading ? '正在登录…' : '登录后台' }}
              </button>

              <div class="switch">
                <span>没有账号或无法登录？</span>
                <strong>请联系平台所有者开通</strong>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>

    <footer class="auth__footer">
      <img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="" class="auth__footer-logo" />
      <span>WenFlow Admin</span>
      <router-link to="/" class="auth__back">← 返回首页</router-link>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
/* 密码显隐图标：模板用了 <Eye>/<EyeOff> 却从未 import → 按钮点得动但图标空白
   （同 EyeOff 幽灵图标一类，2026-09-29 修） */
import { Eye, EyeOff } from 'lucide-vue-next'
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();
import { useRoute, useRouter } from 'vue-router'
import { adminAuthApi, markAdminSession } from '@/api/adminApi'
import { toast } from '../../utils/toast'
import { consumeAuthFlashMessage } from '../../utils/authFlash'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const showPwd = ref(false)

const loginForm = reactive({
  name: '',
  password: '',
  remember: false
})

const errors = reactive({
  name: '',
  password: ''
})
const loginError = ref('')

function touch(key: 'name' | 'password') {
  if (key === 'name') errors.name = loginForm.name ? '' : '请输入管理员账号'
  if (key === 'password') errors.password = loginForm.password ? '' : '请输入密码'
}

const safeRedirect = () => {
  const value = Array.isArray(route.query.redirect) ? route.query.redirect[0] : route.query.redirect
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/admin/overview'
  try {
    const target = new URL(value, window.location.origin)
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/admin/')) {
      return '/admin/overview'
    }
    // 旧运营后台书签 /admin/console → 新总览（router 亦有 /admin/console 兼容重定向）
    if (
      target.pathname === '/admin/console' ||
      target.pathname === '/admin/login'
    ) {
      return '/admin/overview'
    }
    // 深链恢复：校验通过后回到管理员原本要去的页面（含 query/hash）
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return '/admin/overview'
  }
}

const handleLogin = async () => {
  touch('name')
  touch('password')
  if (errors.name || errors.password || loading.value) return

  loading.value = true
  try {
    const response = await adminAuthApi.login(loginForm)

    if (response.data.success) {
      const { user } = response.data.data

      markAdminSession(loginForm.remember)
      const storage = loginForm.remember ? localStorage : sessionStorage
      storage.setItem('admin_user', JSON.stringify(user))

      toast.success('登录成功')
      await router.replace(safeRedirect())
    } else {
      const msg = response.data.message || '登录失败，请检查账号密码'
      // 服务端失败统一进顶部横幅：凭证错误不属于「用户名格式」字段级问题，不挂到 errors.name
      loginError.value = msg
      toast.error(msg)
    }
  } catch (error: any) {
    const status = error?.response?.status
    const msg = status === 429 ? '登录尝试过于频繁，请稍后再试'
      : !status || status >= 500 ? '服务暂时不可用，请稍后重试'
      : error.response?.data?.error?.message || '登录失败，请检查账号密码'
    loginError.value = msg
    toast.error(msg)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  const message = consumeAuthFlashMessage()
  if (message) toast.error(message)
})
</script>

<style scoped>
.auth {
  min-height: 100vh;
  position: relative;
}

/* ===== newui 原型 renderLogin（2026-09-30 复刻）=====
   .login 主舞台 flex 居中偏右；.login__shell 双栏白卡；
   左 .login__aside 品牌栏（上下 space-between），右 .login__panel 表单。 */
.login {
  flex: 1;
  min-height: calc(100vh - 128px);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: var(--mk-space-6) clamp(20px, 5vw, 72px);
}

.login__shell {
  width: 100%;
  max-width: 1180px;
  min-height: 560px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  overflow: hidden;
  box-shadow: var(--mk-shadow-modal);
}

.login__aside {
  /* 原型渐变锚点 #000/#06122e 用 --mk-code-bg（双主题恒暗 token）+ color-mix 表达：
     亮色档 ≈ 原型深蓝；暗色档 --mk-blue 提亮后混入仍压得住白字，无需另写补丁 */
  background: radial-gradient(
    120% 90% at 12% 8%,
    color-mix(in srgb, var(--mk-blue) 92%, var(--mk-code-bg)) 0%,
    var(--mk-blue) 42%,
    color-mix(in srgb, var(--mk-blue) 55%, var(--mk-code-bg)) 100%
  );
  color: rgba(255, 255, 255, 1);
  padding: var(--mk-space-8);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--mk-space-5);
}

.login__aside .brand__logo {
  filter: brightness(0) invert(1);
  height: 30px;
  width: auto;
  display: block;
  align-self: flex-start;
}

.login__lead {
  display: grid;
  gap: var(--mk-space-4);
}

.login__aside h2 {
  margin: 0;
  font-size: 30px;
  line-height: 1.25;
  letter-spacing: -0.02em;
  max-width: 22ch;
}

.login__aside p {
  margin: 0;
  color: rgba(255, 255, 255, 0.78);
  max-width: 40ch;
}

.login__points {
  display: grid;
  gap: 10px;
}

.login__point {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: var(--mk-fs-micro);
  color: rgba(255, 255, 255, 0.9);
}

.login__point i {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.16);
  font-style: normal;
  font-size: var(--mk-fs-micro);
  flex: none;
}

.login__panel {
  display: grid;
  place-items: center;
  padding: var(--mk-space-8) var(--mk-space-6);
  background: var(--mk-surface);
}

.login__card {
  width: min(380px, 100%);
  display: grid;
  gap: var(--mk-space-4);
}

.login__card h1 {
  margin: 0;
  font-size: 24px;
}

.login__card .lead {
  margin: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}

/* ≤1024 aside 隐藏后，卡内顶部的小 logo（原型 .login__brandsm） */
.login__brandsm {
  display: none;
  height: 28px;
  width: auto;
  margin: 0 auto;
}

/* ===== 表单 =====
   类名沿用既有 field__* / errorbar：v2.css 的暗色 autofill 与 .v2-page .errorbar 修正依赖它们 */
.form {
  display: grid;
  gap: var(--mk-space-4);
}

.field {
  display: grid;
  gap: 6px;
}

.field__label {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-ink);
}

.req {
  color: var(--mk-red);
}

/* 原型 .input：h36 / r-md / focus 蓝边 + 3px 环 */
.field__input {
  width: 100%;
  height: 36px;
  padding: 0 11px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-body);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

.field__input:focus {
  border-color: var(--mk-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-blue) 20%, transparent);
}

.field--error .field__input {
  border-color: color-mix(in srgb, var(--mk-red) 60%, transparent);
}

.field--error .field__input:focus {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-red) 12%, transparent);
}

.field__error {
  font-size: var(--mk-fs-body);
  color: var(--mk-red-strong);
  font-weight: 500;
}

.field__pwd {
  position: relative;
  display: block;
}

.field__pwd .field__input {
  padding-right: 42px;
}

.field__eye {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--mk-radius-sm);
  background: transparent;
  color: var(--mk-faint);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.field__eye:hover {
  color: var(--mk-blue);
  background: var(--mk-blue-bg);
}

.remember {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
  user-select: none;
}

.remember input {
  width: 15px;
  height: 15px;
  accent-color: var(--mk-blue);
}

/* 原型 .btn.btn--primary：h40 居中；底座样式来自 v2.css 的 .v2-page .btn-primary */
.btn-primary--block {
  justify-content: center;
  width: 100%;
  height: 40px;
  padding: 0 14px;
  font-size: var(--mk-fs-emphasis);
}

.btn-primary--block:disabled {
  opacity: 0.6;
  cursor: default;
  box-shadow: none;
}

.switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--mk-fs-body);
  color: var(--mk-muted);
  text-align: center;
}

.switch strong {
  color: var(--mk-ink);
  font-weight: 800;
}

.auth__footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--mk-line);
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  background: var(--v2nav-bg);
}

.auth__footer-logo {
  height: 14px;
  width: 14px;
  border-radius: 4px;
  opacity: 0.8;
}

.auth__back {
  /* 热区：纵向内边距补到 ~27px，高于 24px 鼠标可点下限 */
  display: inline-block;
  padding: 4px 2px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-faint);
  text-decoration: none;
}

.auth__back:hover {
  color: var(--mk-blue);
}

/* 原型 ≤1024：壳单列、aside 隐藏、卡内小 logo 显示、舞台居中 */
@media (max-width: 1024px) {
  .login {
    justify-content: center;
    padding: var(--mk-space-4);
  }

  .login__shell {
    grid-template-columns: 1fr;
  }

  .login__aside {
    display: none;
  }

  .login__brandsm {
    display: block;
  }
}
</style>
