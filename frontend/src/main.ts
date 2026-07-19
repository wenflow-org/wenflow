import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { ElLoading } from 'element-plus';
import 'element-plus/dist/index.css';

import App from './App.vue';
import router from './router';
import {
  ADMIN_SESSION_CLEAR_EVENT_KEY,
  adminAuthApi,
  clearAdminSession,
  handleAdminAuthenticationFailure,
  isAdminSessionClearBroadcast,
  setAdminProtectedLocationResolver
} from './api/adminApi';
import './styles/main.css';
import './styles/tremor-theme.css';  // Tremor 风格主题
import './styles/admin-theme.css';

function currentRouteRequiresAdminAuth(): boolean {
  const currentRoute = router.currentRoute.value;
  const normalizedPath = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (normalizedPath !== '/admin' && !normalizedPath.startsWith('/admin/')) return false;
  if (normalizedPath === '/admin/login') return false;

  const resolvedRoute = router.resolve(
    window.location.pathname + window.location.search + window.location.hash
  );
  if (resolvedRoute.matched.some((route) => route.meta.requiresAdminAuth === true)) return true;

  const currentRoutePath = currentRoute.path.toLowerCase().replace(/\/+$/, '') || '/';
  if (
    currentRoutePath === normalizedPath
    && currentRoute.matched.some((route) => route.meta.requiresAdminAuth === true)
  ) {
    return true;
  }

  // 未匹配或大小写变体的 admin URL 也必须 fail-closed，避免缓存页面因路由解析差异被解封。
  return true;
}

setAdminProtectedLocationResolver(currentRouteRequiresAdminAuth);

const ADMIN_SESSION_CONCEALED_CLASS = 'admin-session-concealed';
const ADMIN_SESSION_SHELL_ID = 'admin-session-validation-shell';
const ADMIN_OVERLAY_SELECTOR = [
  'body > .el-popper',
  'body > .el-overlay',
  'body > .el-message',
  'body > .el-notification',
  'body > .el-loading-mask'
].join(', ');

let adminLoginRedirecting = false;
let adminSessionValidationInFlight: Promise<void> | null = null;

interface AdminSessionShellElements {
  root: HTMLElement;
  detail: HTMLElement;
  retryButton: HTMLButtonElement;
}

let adminSessionShell: AdminSessionShellElements | null = null;

function ensureAdminSessionShell(): AdminSessionShellElements {
  if (adminSessionShell) return adminSessionShell;

  const root = document.createElement('main');
  root.id = ADMIN_SESSION_SHELL_ID;
  root.setAttribute('aria-labelledby', `${ADMIN_SESSION_SHELL_ID}-title`);

  const card = document.createElement('section');
  card.className = 'admin-session-validation-card';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'admin-session-validation-eyebrow';
  eyebrow.textContent = 'WenFlow Admin';

  const title = document.createElement('h1');
  title.id = `${ADMIN_SESSION_SHELL_ID}-title`;
  title.textContent = '无法确认管理员会话';

  const detail = document.createElement('p');
  detail.className = 'admin-session-validation-detail';
  detail.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'admin-session-validation-actions';

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.className = 'admin-session-validation-button admin-session-validation-button--primary';
  retryButton.textContent = '重新验证';
  retryButton.addEventListener('click', () => {
    void validateRestoredAdminSession();
  });

  const loginButton = document.createElement('button');
  loginButton.type = 'button';
  loginButton.className = 'admin-session-validation-button';
  loginButton.textContent = '返回登录';
  loginButton.addEventListener('click', () => {
    if (adminLoginRedirecting) return;
    clearAdminSession();
    redirectToAdminLogin();
  });

  actions.append(retryButton, loginButton);
  card.append(eyebrow, title, detail, actions);
  root.append(card);
  document.body.append(root);

  adminSessionShell = { root, detail, retryButton };
  return adminSessionShell;
}

function updateAdminSessionShell(validating: boolean): void {
  const shell = ensureAdminSessionShell();
  shell.root.setAttribute('aria-busy', String(validating));
  shell.detail.textContent = validating
    ? '正在重新验证，请稍候。验证完成前不会显示管理页面内容。'
    : '会话验证服务暂时不可用。你可以重新验证，或安全返回登录页。';
  shell.retryButton.disabled = validating;
}

function markAdminOverlaysConcealed(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true
  }));
  document.querySelectorAll<HTMLElement>(ADMIN_OVERLAY_SELECTOR).forEach((element) => {
    element.classList.add('admin-bfcache-overlay-concealed');
  });
}

function concealAdminApp(): void {
  ensureAdminSessionShell();
  document.documentElement.classList.add(ADMIN_SESSION_CONCEALED_CLASS);
  document.body.classList.add(ADMIN_SESSION_CONCEALED_CLASS);
}

function restoreAdminApp(): void {
  document.documentElement.classList.remove(ADMIN_SESSION_CONCEALED_CLASS);
  document.body.classList.remove(ADMIN_SESSION_CONCEALED_CLASS);
  adminSessionShell?.root.setAttribute('aria-busy', 'false');
}

function redirectToAdminLogin(): void {
  if (adminLoginRedirecting) return;

  adminLoginRedirecting = true;
  const redirect = window.location.pathname + window.location.search + window.location.hash;
  window.location.replace(`/admin/login?redirect=${encodeURIComponent(redirect)}`);
}

function validateRestoredAdminSession(): Promise<void> {
  if (adminSessionValidationInFlight) return adminSessionValidationInFlight;

  concealAdminApp();
  updateAdminSessionShell(true);
  adminSessionValidationInFlight = adminAuthApi.getMe()
    .then((response) => {
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`管理员会话校验返回非 2xx 状态: ${response.status}`);
      }
      if (!adminLoginRedirecting && currentRouteRequiresAdminAuth()) restoreAdminApp();
    })
    .catch((error) => {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        handleAdminAuthenticationFailure();
        return;
      }

      updateAdminSessionShell(false);
      console.warn(
        '[admin-bfcache-session-check-failed]',
        status ?? error?.code ?? 'network-error'
      );
    })
    .finally(() => {
      adminSessionValidationInFlight = null;
    });

  return adminSessionValidationInFlight;
}

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
// Element Plus 组件由 unplugin-vue-components 按需自动引入；
// 此处仅注册全局指令与语言包（locale 通过 App.vue 的 el-config-provider 下发）
app.use(ElLoading);

// 渲染期未捕获错误的最后防线：至少落盘，避免静默丢失
app.config.errorHandler = (err, _instance, info) => {
  console.error('[vue-error]', info, err);
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled-rejection]', event.reason);
});

window.addEventListener('pagehide', () => {
  if (!currentRouteRequiresAdminAuth()) return;

  concealAdminApp();
  updateAdminSessionShell(true);
  markAdminOverlaysConcealed();
});

window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  if (!currentRouteRequiresAdminAuth()) {
    restoreAdminApp();
    return;
  }

  concealAdminApp();
  void validateRestoredAdminSession();
});

window.addEventListener('storage', (event) => {
  if (event.key !== ADMIN_SESSION_CLEAR_EVENT_KEY || !isAdminSessionClearBroadcast(event.newValue)) return;

  const requiresAdminAuth = currentRouteRequiresAdminAuth();
  if (requiresAdminAuth) concealAdminApp();
  try {
    clearAdminSession(false);
  } catch (error) {
    console.error('[admin-cross-tab-session-clear-error]', error);
  }
  if (!requiresAdminAuth) return;

  try {
    redirectToAdminLogin();
  } catch (error) {
    console.error('[admin-cross-tab-redirect-error]', error);
  }
});

app.mount('#app');
