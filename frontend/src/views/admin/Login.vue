<template>
  <div class="auth v2-page">
    <div class="auth__bg" aria-hidden="true"></div>

    <main class="auth__main">
      <router-link to="/" class="auth__logo">
        <img src="/logo.png" alt="问流 WenFlow" />
      </router-link>

      <div class="auth__card">
        <section class="auth__form-side">
          <div class="auth__card-top">
            <span class="auth__pill">管理后台</span>
            <router-link to="/" class="auth__back">← 返回首页</router-link>
          </div>

          <div class="head">
            <h2>管理员登录</h2>
            <p>登录后管理用户、日志与系统配置。</p>
          </div>

          <form class="form" :aria-busy="loading" @submit.prevent="handleLogin">
            <label class="field" :class="{ 'field--error': errors.name }">
              <span class="field__label">管理员账号</span>
              <input
                v-model.trim="loginForm.name"
                type="text"
                class="field__input"
                placeholder="请输入管理员账号"
                autocomplete="username"
                :aria-invalid="!!errors.name"
                :aria-describedby="errors.name ? 'login-err-name' : undefined"
                @blur="touch('name')"
              />
              <span v-if="errors.name" id="login-err-name" class="field__error">{{ errors.name }}</span>
            </label>

            <label class="field" :class="{ 'field--error': errors.password }">
              <span class="field__label">密码</span>
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
                  <svg v-if="showPwd" viewBox="0 0 24 24" width="17" height="17">
                    <path
                      fill="currentColor"
                      d="M12 5c-5 0-9.3 3-11 7 1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
                    />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" width="17" height="17">
                    <path
                      fill="currentColor"
                      d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.2-3.2c-1.6.8-3.4 1.3-5.3 1.3-5 0-9.3-3-11-7a12.4 12.4 0 0 1 4.7-5.5L2.1 3.5zM12 5c1.4 0 2.8.3 4 .9L8.9 8.8A4.48 4.48 0 0 1 12 7.5a4.5 4.5 0 0 1 4.5 4.5c0 1.2-.4 2.2-1.1 3l2.9 2.9c2-1.3 3.6-3.2 4.7-5.4-2-3.7-6.1-6-11-6z"
                    />
                  </svg>
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
        </section>

        <aside class="auth__demo-side">
          <div class="demo">
            <p class="demo__tagline">WenFlow 管理后台</p>

            <div class="demo__status">
              <span class="demo__dot"></span>
              <strong>运行平稳</strong>
              <span class="demo__score">92</span>
            </div>

            <div class="demo__panel">
              <div class="demo__panel-head">
                <strong>学习漏斗</strong>
                <span>近 7 天</span>
              </div>
              <div class="demo__funnel">
                <div v-for="item in funnel" :key="item.label" class="demo__funnel-item">
                  <small>{{ item.label }}</small>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
            </div>

            <div class="demo__panel">
              <div class="demo__panel-head">
                <strong>动态</strong>
                <span>实时</span>
              </div>
              <ul class="demo__feed">
                <li v-for="item in feed" :key="item.text">
                  <strong>{{ item.text }}</strong>
                  <span>{{ item.time }}</span>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <footer class="auth__footer">
      <img src="/favicon.png" alt="" class="auth__footer-logo" />
      <span>WenFlow Admin</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminAuthApi, markAdminSession } from '@/api/adminApi'
import { toast } from '../../utils/toast'
import { consumeAuthFlashMessage } from '../../utils/authFlash'
import '@/views/v2/v2.css'

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

const funnel = [
  { label: '用户', value: '128' },
  { label: '目标', value: '86' },
  { label: '路径', value: '64' },
  { label: '完成', value: '217' }
]

const feed = [
  { text: '路径「Excel 自动化」生成成功', time: '6 分钟前' },
  { text: '新用户注册：liu**@163.com', time: '18 分钟前' },
  { text: '学习者快照重算完成 ×12', time: '1 小时前' }
]

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
      toast.error(response.data.message || '登录失败，请检查账号密码')
    }
  } catch (error: any) {
    console.debug('管理员登录请求失败:', error?.response?.status ?? error?.code ?? 'network-error')
    toast.error(error.response?.data?.error?.message || '登录失败，请检查账号密码')
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

.auth__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(560px 300px at 12% -4%, rgba(52, 120, 246, 0.07), transparent 60%),
    radial-gradient(480px 260px at 88% 104%, rgba(141, 107, 255, 0.06), transparent 60%);
}

.auth__main {
  position: relative;
  min-height: calc(100vh - 56px);
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 30px;
  padding: 48px 20px 40px;
}

.auth__logo {
  display: inline-flex;
}

.auth__logo img {
  height: 52px;
  width: auto;
  display: block;
}

.auth__card {
  width: min(820px, 100%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 2px 4px rgba(23, 32, 51, 0.04), 0 24px 60px rgba(23, 32, 51, 0.08);
  overflow: hidden;
}

/* 大屏（2000-2799）：卡片与内容放大；2800+ 交由 v2.css zoom 机制 */
@media (min-width: 2000px) and (max-width: 2799px) {
  .auth__logo img { height: 64px; }
  .auth__card {
    width: min(1080px, 100%);
    border-radius: 26px;
  }
  .auth__form-side { padding: 36px 40px 28px; gap: 22px; }
  .auth__demo-side { padding: 36px 36px 38px; }
  .auth__main { gap: 36px; }
  .demo__tagline { font-size: 17px; }
  .demo__msg { font-size: 15px; }
}

.auth__form-side {
  padding: 26px 28px 28px;
  display: grid;
  gap: 18px;
  align-content: start;
}

.auth__card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.auth__pill {
  font-size: 12px;
  font-weight: 800;
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.09);
  padding: 5px 12px;
  border-radius: 999px;
}

.auth__back {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--faint);
  text-decoration: none;
}

.auth__back:hover {
  color: var(--blue-deep);
}

.head {
  display: grid;
  gap: 5px;
}

.head h2 {
  margin: 0;
  font-size: 22px;
}

.head p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.form {
  display: grid;
  gap: 14px;
}

.field {
  display: grid;
  gap: 6px;
}

.field__label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--muted);
}

.field__input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 11px 14px;
  font: inherit;
  font-size: 14px;
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

.field--error .field__input {
  border-color: rgba(239, 117, 120, 0.6);
}

.field--error .field__input:focus {
  box-shadow: 0 0 0 3px rgba(239, 117, 120, 0.12);
}

.field__error {
  font-size: 11.5px;
  color: #c0454a;
  font-weight: 600;
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
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.field__eye:hover {
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.07);
}

.remember {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.remember input {
  width: 15px;
  height: 15px;
  accent-color: var(--blue);
}

.btn-primary--block {
  justify-content: center;
  width: 100%;
  padding: 12px;
  font-size: 14.5px;
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
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}

.switch strong {
  color: var(--ink);
  font-weight: 800;
}

.auth__demo-side {
  background:
    radial-gradient(320px 220px at 90% 0%, rgba(141, 107, 255, 0.1), transparent 65%),
    linear-gradient(160deg, rgba(52, 120, 246, 0.07), rgba(67, 176, 216, 0.04));
  border-left: 1px solid var(--line);
  padding: 26px 26px 28px;
  display: grid;
  align-content: center;
}

.demo {
  display: grid;
  gap: 14px;
}

.demo__tagline {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.7;
  color: var(--ink);
  max-width: 32ch;
}

.demo__status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--surface);
}

.demo__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--green);
  flex: 0 0 auto;
}

.demo__status strong {
  font-size: 13px;
}

.demo__score {
  margin-left: auto;
  font-size: 18px;
  font-weight: 800;
  color: var(--blue-deep);
  font-variant-numeric: tabular-nums;
}

.demo__panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 13px 15px;
  display: grid;
  gap: 10px;
}

.demo__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.demo__panel-head span {
  font-size: 11px;
  font-weight: 800;
  color: var(--blue-deep);
}

.demo__funnel {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.demo__funnel-item {
  display: grid;
  gap: 2px;
  padding: 8px 6px;
  border-radius: 10px;
  background: #f7faff;
  border: 1px solid #e8eefb;
  text-align: center;
}

.demo__funnel-item small {
  font-size: 10.5px;
  color: var(--faint);
  font-weight: 700;
}

.demo__funnel-item strong {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.demo__feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.demo__feed li {
  display: grid;
  gap: 2px;
}

.demo__feed strong {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
}

.demo__feed span {
  font-size: 11px;
  color: var(--faint);
}

.auth__footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: 11.5px;
  background: rgba(255, 255, 255, 0.6);
}

.auth__footer-logo {
  height: 14px;
  width: 14px;
  border-radius: 4px;
  opacity: 0.8;
}

.auth__footer-sep {
  opacity: 0.5;
}

@media (max-width: 760px) {
  .auth__card {
    grid-template-columns: 1fr;
  }

  .auth__demo-side {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 20px 22px 22px;
  }

  .demo__tagline {
    font-size: 13px;
  }

  .auth__form-side {
    padding: 22px 20px 24px;
  }
}

@media (max-width: 480px) {
  .auth__demo-side {
    display: none;
  }

  .auth__main {
    padding: 36px 14px 28px;
    min-height: calc(100vh - 52px);
  }
}
</style>
