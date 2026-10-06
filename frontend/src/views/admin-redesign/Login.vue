<template>
  <div class="auth v2-page">
    <main class="auth__main">
      <router-link to="/" class="auth__logo">
        <img :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="问流 WenFlow" />
      </router-link>

      <div class="auth__card">
        <section class="auth__form-side">
          <div class="auth__card-top">
            <span class="auth__pill">管理后台</span>
            <router-link to="/" class="auth__back">← 返回首页</router-link>
          </div>

          <div class="head">
            <h1>管理员登录</h1>
            <p>登录后管理用户、日志与系统配置。</p>
          </div>

          <form class="form" :aria-busy="loading" @submit.prevent="handleLogin">
            <div v-if="loginError" class="errorbar" role="alert">{{ loginError }}</div>
            <label class="field" :class="{ 'field--error': errors.name }">
              <span class="field__label">管理员账号</span>
              <input
                ref="nameInput"
                v-model.trim="loginForm.name"
                type="text"
                class="field__input"
                placeholder="请输入管理员账号"
                autocomplete="username"
                :aria-invalid="!!errors.name"
                :aria-describedby="errors.name ? 'login-err-name' : undefined"
                @blur="touch('name')"
                @input="loginError = ''"
              />
              <span v-if="errors.name" id="login-err-name" class="field__error" role="alert">{{ errors.name }}</span>
            </label>

            <label class="field" :class="{ 'field--error': errors.password }">
              <span class="field__label">密码</span>
              <span class="field__pwd">
                <input
                  ref="passwordInput"
                  v-model="loginForm.password"
                  :type="showPwd ? 'text' : 'password'"
                  class="field__input"
                  placeholder="请输入密码"
                  autocomplete="current-password"
                  :aria-invalid="!!errors.password"
                  :aria-describedby="errors.password ? 'login-err-password' : undefined"
                  @blur="touch('password')"
                  @input="loginError = ''"
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
              <span v-if="errors.password" id="login-err-password" class="field__error" role="alert">{{ errors.password }}</span>
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
          <!-- 审核 #26（2026-10-06）：原型 aside 的硬编码运营看板（绿点「运行平稳」+ 92 分 +
               学习漏斗 128/86/64/217）不得照搬——SPEC §9 第 5 条要求改写为三条真实安全机制。
               三条均可核实：会话凭 HttpOnly Cookie（adminApi.ts 会话标记）、失败/429 限流
               （本页 handleLogin 分支）、会话失效跨标签广播（adminApi.ts clearAdminSession）。 -->
          <div class="demo">
            <p class="demo__tagline">WenFlow 管理后台</p>
            <div class="demo__intro">
              <p>AI 教学模拟 · 学习路径编排 · 实时观测</p>
            </div>

            <div class="demo__panel">
              <div class="demo__panel-head">
                <strong>安全机制</strong>
                <span>真实实现</span>
              </div>
              <ul class="demo__feed demo__feed--facts">
                <li v-for="item in securityFacts" :key="item.text">
                  <strong>{{ item.text }}</strong>
                  <span>{{ item.detail }}</span>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <footer class="auth__footer">
      <img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="" class="auth__footer-logo" />
      <span>WenFlow Admin</span>
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
/** 是否已提交过一次（审核 #23）：首次提交前 blur 不出字段级红字 */
const submitted = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)

/* 审核 #26：侧栏改为三条可核实的真实安全机制（SPEC §9 第 5 条），
   原硬编码漏斗（末段 217 > 首段 128，自相矛盾）与「运行平稳 92」假看板整层退役 */
const securityFacts = [
  { text: '会话凭据走 HttpOnly Cookie', detail: '前端只记「已登录」标记，令牌不进 JS/localStorage' },
  { text: '登录失败与 429 限流', detail: '凭证错误走顶部横幅；频繁尝试提示稍后再试' },
  { text: '登出跨标签页广播', detail: '会话失效即时清除本地标记并同步其它标签页' }
]

function touch(key: 'name' | 'password') {
  // 审核 #23（2026-10-06）：首次提交前的 blur 不该报错——只是从账号框点到密码框，
  // 红字与 aria-invalid 就出现，读作「刚填的就被判错」。提交过一次后 blur 校验照旧。
  if (!submitted.value) return
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
  // 审核 #24②：重试必须先清掉上一次的横幅，否则旧失败文案跨请求留着
  loginError.value = ''
  // 审核 #23：提交过一次后，blur 才允许出字段级红字
  submitted.value = true
  touch('name')
  touch('password')
  if (errors.name || errors.password) {
    // 审核 #25①：字段级错误已内联（role=alert），焦点同时落到第一个非法输入
    const firstInvalid = errors.name ? nameInput.value : passwordInput.value
    firstInvalid?.focus()
    return
  }
  if (loading.value) return

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
      // 服务端失败统一进顶部横幅：凭证错误不属于「用户名格式」字段级问题，不挂到 errors.name。
      // 审核 #25③：横幅 role=alert 已播报一次，同文 toast 是第二次重复播报——只留横幅（常驻可读）。
      loginError.value = msg
    }
  } catch (error: any) {
    const status = error?.response?.status
    const msg = status === 429 ? '登录尝试过于频繁，请稍后再试'
      : !status || status >= 500 ? '服务暂时不可用，请稍后重试'
      : error.response?.data?.error?.message || '登录失败，请检查账号密码'
    loginError.value = msg
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // 审核 #33（2026-10-06）：模板 autofocus 在懒加载路由下不可靠（实测落地焦点停在 div，
  // 键盘用户要 Tab 4 次才进账号框）。改为挂载后显式聚焦账号输入框。
  // 延后到路由 afterEach（router/index.ts:492 把焦点交给 #app-main）之后执行，
  // 否则会被它覆盖回 div；rAF 在浏览器下一帧跑，晚于 nextTick 的 afterEach 回调。
  requestAnimationFrame(() => nameInput.value?.focus())
  const message = consumeAuthFlashMessage()
  if (message) {
    // 审核 #24③：会话失效原因原先只落在 4s 后自动消失的 toast 里，用户看不出为何回到登录页——
    // 同时写进常驻横幅（可读、role=alert 播报），toast 保留作即时提醒
    loginError.value = message
    toast.error(message)
  }
})
</script>

<style scoped>
.auth {
  min-height: 100vh;
  position: relative;
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
  height: 84px;
  width: auto;
  display: block;
}

.auth__card {
  width: min(820px, 100%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl);
  box-shadow: var(--mk-shadow-pop);
  overflow: hidden;
}

/* 大屏（2000-2799）：卡片与内容放大；2800+ 交由 v2.css zoom 机制 */
@media (min-width: 2000px) and (max-width: 2799px) {
  .auth__logo img { height: 96px; }
  .auth__card {
    width: min(1080px, 100%);
    border-radius: var(--mk-radius-xl);
  }
  .auth__form-side { padding: 36px 40px 28px; gap: 22px; }
  .auth__demo-side { padding: 36px 36px 38px; }
  .auth__main { gap: 36px; }
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
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  /* 审核 #30（2026-10-06）：静态文字不用交互蓝（SPEC §0「蓝只许出现在可交互/选中上」），
     胶囊保留形状，文字降为中性色 */
  color: var(--mk-muted);
  background: color-mix(in srgb, var(--mk-blue) 9%, transparent);
  padding: 5px 12px;
  border-radius: 999px;
}

.auth__back {
  /* 热区：原来只有文字行高 19px，低于 24px 鼠标可点下限；纵向补内边距到 ~27px */
  display: inline-block;
  padding: 4px 2px;
  font-size: var(--mk-fs-micro);
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

.head :is(h1, h2) {
  margin: 0;
  font-size: 22px;
}

.head p {
  margin: 0;
  font-size: var(--mk-fs-body);
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
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--muted);
}

.field__input {
  width: 100%;
  border: 1px solid var(--line);
  /* 审核 #21（2026-10-06）：控件档圆角 = --mk-radius-md(8px)，原 12px 是面板档 */
  border-radius: var(--mk-radius-md);
  padding: 11px 14px;
  font: inherit;
  font-size: var(--mk-fs-body);
  color: var(--ink);
  background: var(--surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

/* 禁用态底色档（对齐 .mk-field__input:disabled）：缺了它禁用输入框与可编辑态同貌 */
.field__input:disabled {
  background: var(--mk-input-disabled-bg);
  cursor: not-allowed;
}

.field__input:focus {
  border-color: var(--mk-blue);
  box-shadow: var(--mk-focus-ring);
}

/* 审核 #32（2026-10-06）：输入族焦点环收敛为一套——本地已是「蓝边 + ring」，
   再叠 v2.css 全局 :focus-visible 的 2px outline 会成双环（中间留缝）。
   此处对输入框关掉全局 outline，保留蓝边 + ring（SPEC §0.5 输入族口径）。 */
.field__input:focus-visible {
  outline: none;
}

.field--error .field__input {
  border-color: color-mix(in srgb, var(--wf-color-danger) 60%, transparent);
}

.field--error .field__input:focus {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-color-danger) 12%, transparent);
}

/* 审核 #21：错误文字对齐原语 .mk-field__err（micro/600），原 body/500 既大一档又轻 */
.field__error {
  font-size: var(--mk-fs-micro);
  color: var(--mk-red-strong);
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
  width: 28px;
  height: 28px;
  border: 0;
  /* 审核 #21：眼睛钮同属控件档（8px），原 6px 是行内芯片档 */
  border-radius: var(--mk-radius-md);
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.field__eye:hover {
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--mk-blue) 7%, transparent);
}

/* 审核 #31（2026-10-06）：整行 18px / 复选框 15px 低于本文件为「返回首页」定的 24px 可点下限，
   纵向补内边距到 ~24px（与 .auth__back 同判例）；勾选框同步微调 */
.remember {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  min-height: 24px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.remember input {
  width: 17px;
  height: 17px;
  accent-color: var(--blue);
}

.btn-primary--block {
  justify-content: center;
  width: 100%;
  /* 审核 #27（2026-10-06）：登录主按钮此前走用户侧面板档（实测 47px 高 / 16px 圆角），
     是全 admin 侧唯一一颗——收敛为控件档 8px 圆角 + lg 高度（padding 9px 22px ≈ 41px，
     对齐 SPEC §0.5「lg 36-40 / 登录主按钮 40」与 .mk-btn 的 8px）。
     只在本页 scoped 收敛（不动 v2.css 的认证页共享基线，避免连带注册页）；
     ≥2000 档 v2.css 的认证页阶梯（padding 14px / 16px）特异性更高，照旧接管。 */
  border-radius: var(--mk-radius-md);
  padding: 9px 22px;
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
  color: var(--muted);
  text-align: center;
}

.switch strong {
  color: var(--ink);
  font-weight: 800;
}

.auth__demo-side {
  background: color-mix(in srgb, var(--blue) 5%, var(--surface));
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
  font-size: var(--mk-fs-emphasis);
  font-weight: 600;
  line-height: 1.7;
  color: var(--ink);
  max-width: 32ch;
}

.demo__intro {
  margin: 0;
}

.demo__intro p {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--muted);
  line-height: 1.6;
}

.demo__panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl);
  padding: 13px 15px;
  display: grid;
  gap: 10px;
}

.demo__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--mk-fs-micro);
}

.demo__panel-head span {
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  /* 审核 #30：同上——「真实实现」是静态标注，不是链接 */
  color: var(--mk-faint);
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
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.45;
}

.demo__feed span {
  font-size: var(--mk-fs-micro);
  color: var(--faint);
}

/* 真实机制条目（审核 #26）：主行 + 说明副行，与登录表单同字级层级 */
.demo__feed--facts strong {
  color: var(--ink);
}
.demo__feed--facts span {
  line-height: 1.5;
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
  font-size: var(--mk-fs-micro);
  background: var(--v2nav-bg);
}

.auth__footer-logo {
  height: 14px;
  width: 14px;
  border-radius: 4px;
  opacity: 0.8;
}

/* ===== 深色模式（data-theme=dark）：统计卡/页脚随变量反转 ===== */
[data-theme='dark'] .auth__demo-side {
  background: color-mix(in srgb, var(--blue) 9%, var(--surface));
}
[data-theme='dark'] .auth__card {
  box-shadow: var(--mk-shadow-pop);
}

@media (max-width: 760px) {
  .auth__logo img { height: 60px; }

  .auth__card {
    grid-template-columns: 1fr;
  }

  .auth__demo-side {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 20px 22px 22px;
  }

  .demo__tagline {
    font-size: var(--mk-fs-body);
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

/* 审核 #35（2026-10-06）：登录页带 .v2-page 类，继承了 v2.css「为底部 dock 留白 72px」的规则，
   而 /admin/login 不渲染 V2Nav（底部 dock）——390 视口下文档比视口高 71px、页脚之下凭空多出
   一条可滚动空白带。scoped 选择器特异性高于 v2.css 的 .v2-page，就地还给真正有 dock 的页面。 */
@media (max-width: 1023.98px) {
  .auth { padding-bottom: 0; }
}
</style>
