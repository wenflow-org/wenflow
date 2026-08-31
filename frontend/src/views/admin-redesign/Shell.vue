<template>
  <div class="mshell" :data-collapsed="collapsed ? 'true' : 'false'">
    <!-- 迷你侧边栏（同时是导航与「侧栏再设计」演示） -->
    <aside class="mshell__side">
      <div class="mshell__brand">
        <!-- 展开：长方形全 logo（图标 + 问流）；折叠：正方形图标 -->
        <img src="/logo.png" alt="问流" class="mshell__logo-full" />
        <img src="/favicon.png" alt="问流" class="mshell__logo-mark" />
        <button
          type="button"
          class="mshell__collapse"
          :title="collapsed ? '展开侧栏' : '收起侧栏'"
          :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
          @click="toggleCollapse"
        >
          <span aria-hidden="true">{{ collapsed ? '»' : '«' }}</span>
        </button>
      </div>
      <nav class="mshell__nav">
        <section v-for="group in groupedScenes" :key="group.title" class="mshell__group">
          <div class="mshell__group-title">{{ group.title }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="mshell__item"
            :class="{ 'mshell__item--active': item.id === current }"
            :title="item.label"
            @click="go(item)"
          >
            <span class="mshell__item-glyph">{{ item.glyph }}</span>
            <span class="mshell__item-label">{{ item.label }}</span>
            <span
              v-if="badgeOf(item)"
              class="mshell__item-badge"
              :class="{ 'mshell__item-badge--alarm': isAlarmBadge(item) }"
              :title="badgeTitle(item)"
            >{{ badgeOf(item) }}</span>
          </button>
        </section>
      </nav>
      <!-- 左侧底部：极简品牌行（数据源状态由顶栏演示横幅/徽章兜底；命令面板入口在右上角） -->
      <footer class="mshell__foot">
        <span class="mshell__foot-name">WenFlow Admin</span>
        <span class="mshell__foot-ver mono">v{{ version }}</span>
      </footer>
    </aside>

    <!-- 主区 -->
    <div class="mshell__main">
      <!-- 阶段 0 R1：demo 数据源存在时（开发态手动切换/后端不可用残留）置顶横幅，防止真假混淆 -->
      <div v-if="dataSource === 'demo' && !liveLoading" class="mshell__demo" role="alert">
        <strong class="mshell__demo-title">演示数据</strong>
        <span class="mshell__demo-text">当前展示内置演示数据（离线预览），非真实平台数据，操作不会写入系统</span>
        <button type="button" class="mshell__demo-btn" @click="refreshData">连接真实数据</button>
      </div>
      <header class="mshell__topbar">
        <div class="mshell__crumbs">
          <span class="mshell__crumb-group">{{ currentScene?.group }}</span>
          <span class="mshell__crumb-sep">/</span>
          <strong>{{ currentScene?.label }}</strong>
          <span v-if="dataSource === 'demo'" class="mk-badge mk-badge--warn mshell__demo-badge">演示模式</span>
          <template v-if="crumb">
            <span class="mshell__crumb-sep">/</span>
            <span class="mshell__crumb-sub" :title="crumbTitle || crumb">{{ crumb }}</span>
          </template>
        </div>
        <div class="mshell__topbar-right">
          <button
            type="button"
            class="mshell__refresh"
            :disabled="liveLoading"
            title="刷新真实数据"
            @click="refreshData"
          >
            <span class="mshell__refresh-icon" :class="{ 'is-spinning': liveLoading }"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></span>
            <span class="mshell__refresh-label">{{ liveLoading ? '刷新中' : '刷新' }}</span>
          </button>
          <button type="button" class="mshell__help" title="运营术语表 / 这是什么" @click="$emit('glossary')">
            <span class="mshell__help-icon">?</span>
            <span class="mshell__help-label">这是什么</span>
          </button>
          <button type="button" class="mshell__search" @click="$emit('palette')">
            <span class="mshell__search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span>
            <span class="mshell__search-hint">命令面板</span>
            <span class="mshell__kbd">{{ kbdMod }}K</span>
          </button>
          <template v-if="release">
            <button
              type="button"
              class="mshell__density"
              :title="density === 'compact' ? '当前紧凑密度 · 点击切换标准' : '当前标准密度 · 点击切换紧凑'"
              :aria-label="density === 'compact' ? '切换到标准密度' : '切换到紧凑密度'"
              @click="toggleDensity"
            >
              <span class="mshell__density-icon" aria-hidden="true">{{ density === 'compact' ? '⊟' : '⊞' }}</span>
            </button>
            <button
              type="button"
              class="mshell__theme"
              :title="theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'"
              :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'"
              @click="toggleTheme"
            >
              <span class="mshell__theme-icon" aria-hidden="true">{{ theme === 'dark' ? '☀' : '☾' }}</span>
            </button>
            <span class="mshell__admin">{{ adminName }}</span>
            <button type="button" class="mshell__logout" @click="logout">退出</button>
          </template>
        </div>
      </header>
      <main ref="contentEl" class="mshell__content">
        <slot />
      </main>
      <!-- 滚动修复 #9：回到顶部（>2 屏长页出现，全站统一由 Shell 挂载） -->
      <button
        type="button"
        class="mk-backtop"
        :class="{ 'mk-backtop--show': backtopVisible }"
        aria-label="回到顶部"
        @click="backToTop"
      >
        <span class="mk-backtop__icon" aria-hidden="true">↑</span>
        <span>回到顶部</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { MOCK_SCENES, type MockSceneDef } from './manifest'
import { dataSource } from './store'
import { liveNavBadges, alarmNavBadges, loadLiveData, liveLoading } from './live'
import { adminAuthApi, clearAdminSession } from '@/api/adminApi'
import { version as appVersion } from '../../../package.json'

const props = defineProps<{ current: string; crumb?: string; crumbTitle?: string; release?: boolean }>()
const emit = defineEmits<{ (e: 'navigate', id: string): void; (e: 'palette'): void; (e: 'glossary'): void }>()

/* 滚动修复 #9：回到顶部按钮（内容区滚动 >2 屏时出现）；
   滚动容器已从 window 收敛到 .mshell__content（应用式布局：侧栏固定，右侧独立滚动） */
const contentEl = ref<HTMLElement | null>(null)
const backtopVisible = ref(false)
function onScroll() {
  const el = contentEl.value
  backtopVisible.value = el ? el.scrollTop > el.clientHeight : false
}
function backToTop() {
  contentEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
onMounted(() => {
  contentEl.value?.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => contentEl.value?.removeEventListener('scroll', onScroll))

const version = appVersion
/** 按平台显示快捷键修饰符：Mac 显示 ⌘，Windows/Linux 显示 Ctrl */
const kbdMod = computed(() => /Mac|iPhone|iPod|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl + ')

/* D1 暗色模式：localStorage 持久化 + 默认跟随系统 prefers-color-scheme。
   key 说明：wf_admin_theme 为本项目主 key；同步写 wenflow-theme（router beforeEach 的旧兼容 key），
   避免路由导航时被 resolveUserTheme 按旧 key 覆盖回系统色（"切暗色后换页回日间" bug）。 */
const THEME_KEY = 'wf_admin_theme'
const LEGACY_THEME_KEY = 'wenflow-theme'
const theme = ref<'light' | 'dark'>(loadTheme())
function loadTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
    // 兼容：旧机制 key 有值时沿用
    const legacy = localStorage.getItem(LEGACY_THEME_KEY)
    if (legacy === 'light' || legacy === 'dark') return legacy
  } catch { /* 隐私模式忽略 */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme.value)
  try {
    localStorage.setItem(THEME_KEY, theme.value)
    localStorage.setItem(LEGACY_THEME_KEY, theme.value)
  } catch { /* ignore */ }
}
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme()
}
applyTheme()

/* D3 表格增强：全局密度切换（compact/standard），localStorage 持久化 */
const DENSITY_KEY = 'wf_admin_density'
const density = ref<'compact' | 'standard'>(loadDensity())
function loadDensity(): 'compact' | 'standard' {
  try {
    const saved = localStorage.getItem(DENSITY_KEY)
    if (saved === 'compact' || saved === 'standard') return saved
  } catch { /* 隐私模式忽略 */ }
  return 'standard'
}
function applyDensity() {
  if (density.value === 'compact') document.documentElement.setAttribute('data-density', 'compact')
  else document.documentElement.removeAttribute('data-density')
  try { localStorage.setItem(DENSITY_KEY, density.value) } catch { /* ignore */ }
}
function toggleDensity() {
  density.value = density.value === 'compact' ? 'standard' : 'compact'
  applyDensity()
}
applyDensity()

/* 侧栏折叠（D5 导航优化）：用户可切换 完整 ↔ 图标 64px，localStorage 持久化；
   <860px 由媒体查询强制折叠（兜底） */
const COLLAPSE_KEY = 'wf_admin_collapsed'
const collapsed = ref(false)
try {
  collapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1'
} catch { /* 隐私模式忽略 */ }
function toggleCollapse() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0') } catch { /* ignore */ }
}

function refreshData() {
  if (liveLoading.value) return
  void loadLiveData(true)
}

function badgeOf(item: MockSceneDef): string {
  if (dataSource.value === 'live') {
    return liveNavBadges.value[item.id] || ''
  }
  return item.badge || ''
}

/* 徽章语义说明：红色=告警（近 7 天执行失败数，点击进入执行日志后自动平息）；
   其余浅蓝/中性=普通计数徽章。统一在 title 注明，避免红/蓝无解释并存 */
function badgeTitle(item: MockSceneDef): string {
  const count = badgeOf(item)
  if (!count) return ''
  if (dataSource.value === 'live' && alarmNavBadges.has(item.id)) {
    return `近 7 天执行失败 ${count} 次（告警徽章：红色；进入执行日志页后自动平息）`
  }
  return `${item.label}：${count}`
}

/* 报警徽章可平息：已读数存 localStorage，只有失败数超过已读数才脉冲 */
const ALARM_READ_KEY = 'wf_admin_alarm_read'
const alarmRead = ref<Record<string, number>>(loadAlarmRead())

function loadAlarmRead(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ALARM_READ_KEY) || '{}') as Record<string, number>
  } catch {
    return {}
  }
}
function persistAlarmRead() {
  try {
    localStorage.setItem(ALARM_READ_KEY, JSON.stringify(alarmRead.value))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
function markAlarmRead(item: MockSceneDef) {
  const count = Number(liveNavBadges.value[item.id] || 0)
  if (alarmNavBadges.has(item.id) && count > 0 && alarmRead.value[item.id] !== count) {
    alarmRead.value = { ...alarmRead.value, [item.id]: count }
    persistAlarmRead()
  }
}

function isAlarmBadge(item: MockSceneDef): boolean {
  if (dataSource.value !== 'live') return false
  const cur = Number(liveNavBadges.value[item.id] || 0)
  const read = Number(alarmRead.value[item.id] || 0)
  return alarmNavBadges.has(item.id) && cur > 0 && cur > read
}

function go(item: MockSceneDef) {
  markAlarmRead(item)
  emit('navigate', item.id)
}

/* release 模式：管理员信息与退出登录 */
const adminName = computed(() => {
  const raw = localStorage.getItem('admin_user') || sessionStorage.getItem('admin_user')
  if (!raw) return 'admin'
  try {
    return String(JSON.parse(raw).name || 'admin')
  } catch {
    return 'admin'
  }
})

async function logout() {
  try {
    await adminAuthApi.logout()
  } catch {
    // 登出接口失败：本地清理会话再跳转，避免守卫检测到残留会话又弹回控制台
    clearAdminSession()
  }
  window.location.replace('/admin/login')
}

const currentScene = computed(() => MOCK_SCENES.find((s) => s.id === props.current))

const groupedScenes = computed(() => {
  const groups: Array<{ title: string; items: MockSceneDef[] }> = []
  for (const scene of MOCK_SCENES) {
    let g = groups.find((x) => x.title === scene.group)
    if (!g) {
      g = { title: scene.group, items: [] }
      groups.push(g)
    }
    g.items.push(scene)
  }
  return groups
})
</script>

<style scoped>
.mshell {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--mk-bg, #f7f8fa);
  color: #1a2a44;
  font-size: 13px;
}

/* 侧边栏 */
.mshell__side {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e1e8f2;
  padding: 14px 10px 10px;
  gap: 14px;
  /* 高于抽屉遮罩(200)、低于命令面板(300)：抽屉打开时侧栏仍可点击，
     点击导航由 AdminConsole watch(scene) 联动关闭抽屉 */
  position: relative;
  z-index: var(--mk-z-sidebar);
}
.mshell__brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 2px 8px 0;
}
.mshell__logo-full {
  height: 52px;
  width: auto;
  display: block;
}
.mshell__logo-mark {
  display: none;
  height: 34px;
  width: 34px;
}

.mshell__nav { flex: 1; overflow-y: auto; display: grid; gap: 14px; align-content: start; }
.mshell__group-title {
  padding: 0 10px 5px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.mshell__group { display: grid; gap: 1px; }
.mshell__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #5b6577;
  font: inherit;
  font-size: var(--mk-fs-13);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: 0.12s ease;
}
.mshell__item:hover { background: #f6f9ff; color: #1a2a44; }
.mshell__item--active {
  background: #eef5ff;
  color: var(--mk-accent-deep, #1f57cc);
  box-shadow: inset 3px 0 0 var(--mk-blue, #2c63d0);
}
.mshell__item-label { flex: 1; }
.mshell__item-glyph {
  display: none;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #eef2fa;
  color: #5b6577;
  font-size: 13px;
  font-weight: 800;
  flex-shrink: 0;
  transition: background 0.12s ease, color 0.12s ease;
}
.mshell__item--active .mshell__item-glyph { background: #dbe9ff; color: var(--mk-accent-deep, #1f57cc); }
.mshell__item-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-faint);
  font-size: 11px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.mshell__item--active .mshell__item-badge { background: #dbe9ff; color: var(--mk-accent-deep, #1f57cc); }
.mshell__item-badge--alarm {
  background: #fee2e2;
  color: #b91c1c;
  animation: mshell-alarm-pulse 1.6s ease-in-out infinite;
}
@keyframes mshell-alarm-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.32); }
  50% { box-shadow: 0 0 0 4px rgba(220, 38, 38, 0); }
}

/* 左侧底部：极简品牌行（WenFlow Admin + 版本；弱化处理，不抢导航注意力） */
.mshell__foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 12px 6px;
  border-top: 1px solid #eef2fa;
  color: var(--mk-faint);
  font-size: 11px;
  flex-shrink: 0;
}
.mshell__foot-name { font-weight: 700; color: #8a97ab; letter-spacing: 0.02em; }
.mshell__foot-ver {
  font-size: 10.5px;
  color: #b4c0d2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mshell__kbd {
  padding: 1px 6px;
  border: 1px solid #e1e8f2;
  border-radius: 5px;
  background: #fafbfc;
  font-size: 11px;
  font-weight: 700;
}

/* 主区：高度锁定在壳层（shell 100dvh）内，content 行 1fr 承接剩余高度 */
.mshell__main { display: grid; grid-template-rows: auto 1fr; min-width: 0; height: 100%; min-height: 0; }
.mshell__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 52px;
  padding: 7px 20px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #e1e8f2;
}
.mshell__crumbs { display: flex; align-items: center; gap: 8px; }
.mshell__crumb-group { color: var(--mk-faint); font-size: var(--mk-fs-12_5); font-weight: 600; }
.mshell__crumb-sep { color: #c3cede; margin: 0 2px; }
.mshell__crumb-sub {
  color: var(--mk-accent-deep);
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  font-family: var(--mk-mono);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mshell__help {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid var(--mk-blue, #2c63d0);
  border-radius: 8px;
  background: #eef5ff;
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.mshell__help:hover { background: #dce9ff; border-color: rgba(44, 99, 208, 0.55); }
.mshell__help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--mk-blue, #2c63d0);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}
.mshell__help-label { white-space: nowrap; }
.mshell__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fafbfc;
  color: var(--mk-faint);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.mshell__search-hint { white-space: nowrap; }
/* 右侧内容区：应用式布局的唯一滚动容器（侧栏/顶栏固定，内容区内滚；
   列表页用 .mk-page--fill 让表格区内滚、分页器吸底） */
.mshell__content {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 演示数据置顶横幅（阶段 0 R1）：demo 态常驻警示，防止真假混淆 */
.mshell__demo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 20px;
  background: #fffbeb;
  border-bottom: 1px solid rgba(217, 119, 6, 0.35);
  color: #92400e;
  font-size: 12px;
  position: sticky;
  top: 0;
  z-index: var(--mk-z-menu);
}
.mshell__demo-title {
  flex-shrink: 0;
  padding: 1px 9px;
  border-radius: 999px;
  background: #f59e0b;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.mshell__demo-text { flex: 1; min-width: 0; line-height: 1.5; }
.mshell__demo-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid rgba(217, 119, 6, 0.5);
  border-radius: 999px;
  background: #fff;
  color: #92400e;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.mshell__demo-btn:hover { background: #fef3c7; border-color: rgba(217, 119, 6, 0.75); }

/* release 模式：顶栏右侧管理员区 */
.mshell__topbar-right { display: flex; align-items: center; gap: 12px; }
.mshell__refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fff;
  color: #5b6577;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.mshell__refresh:hover:not(:disabled) { color: var(--mk-blue, #2c63d0); border-color: rgba(44, 99, 208, 0.4); }
.mshell__refresh:disabled { cursor: default; color: var(--mk-faint); }
.mshell__refresh-icon { display: inline-block; font-size: 13px; line-height: 1; }
.mshell__refresh-icon.is-spinning { animation: mshell-spin 0.9s linear infinite; }
@keyframes mshell-spin { to { transform: rotate(360deg); } }
.mshell__admin { font-size: 12px; font-weight: 700; color: #1a2a44; }
.mshell__theme {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fff;
  color: #5b6577;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.mshell__theme:hover { color: var(--mk-blue, #2c63d0); border-color: rgba(44, 99, 208, 0.4); }
.mshell__theme-icon { display: inline-block; }
.mshell__density {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fff;
  color: #5b6577;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.mshell__density:hover { color: var(--mk-blue, #2c63d0); border-color: rgba(44, 99, 208, 0.4); }
.mshell__density-icon { display: inline-block; font-weight: 700; }
.mshell__logout {
  border: 1px solid #e1e8f2;
  background: #fff;
  padding: 5px 12px;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: #5b6577;
  cursor: pointer;
}
.mshell__logout:hover { color: #dc2626; border-color: rgba(220, 38, 38, 0.35); }

/* 1440px 中间档：侧栏/顶栏适度放大（幅度约为 2000 档一半） */
@media (min-width: 1440px) {
  .mshell { grid-template-columns: 240px minmax(0, 1fr); }
  .mshell__item { font-size: 13.5px; padding: 9px 11px; }
  .mshell__group-title { font-size: 11.5px; }
  .mshell__item-badge { font-size: 11.5px; }
  .mshell__topbar { min-height: 56px; padding: 8px 22px; }
  .mshell__crumb-group, .mshell__crumb-sub { font-size: 13.5px; }
  .mshell__search { font-size: 13px; }
  .mshell__logo-full { height: 58px; }
}

/* 大屏（2000+）：侧栏加宽、字号放大；2800+（4K）再升一档（zoom 之上叠加） */
@media (min-width: 1920px) {
  .mshell { grid-template-columns: 260px minmax(0, 1fr); }
  .mshell__item { font-size: 14px; padding: 10px 12px; }
  .mshell__group-title { font-size: 12px; }
  .mshell__item-badge { font-size: 12px; }
  .mshell__topbar { min-height: 60px; padding: 8px 24px; }
  .mshell__crumb-group, .mshell__crumb-sub { font-size: 14px; }
  .mshell__search { font-size: 13.5px; }
  .mshell__logo-full { height: 64px; }
}
@media (min-width: 2000px) {
  .mshell {
    grid-template-columns: 280px minmax(0, 1fr);
  }
  .mshell__side { padding: 18px 14px 14px; gap: 18px; }
  .mshell__logo-full { height: 72px; }
  .mshell__group-title { font-size: 12.5px; padding: 0 12px 7px; }
  .mshell__item { font-size: 14.5px; padding: 11px 12px; gap: 8px; }
  .mshell__item-badge { font-size: 12.5px; padding: 2px 9px; }
  .mshell__foot { font-size: 13px; padding: 10px 12px; }
  .mshell__topbar { min-height: 64px; padding: 8px 24px; }
  .mshell__crumb-group,
  .mshell__crumb-sub { font-size: 13.5px; }
  .mshell__search { padding: 8px 12px; font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .mshell {
    grid-template-columns: 360px minmax(0, 1fr);
  }
  .mshell__side { padding: 22px 18px 16px; gap: 22px; }
  .mshell__logo-full { height: 72px; }
  .mshell__group-title { font-size: 15px; padding: 0 14px 8px; }
  .mshell__item { font-size: 17px; padding: 14px 14px; gap: 10px; border-radius: 10px; }
  .mshell__item-badge { font-size: 14px; padding: 3px 10px; }
  .mshell__foot { font-size: 15px; padding: 12px 14px; }
  .mshell__topbar { min-height: 78px; padding: 10px 28px; }
  .mshell__crumb-group,
  .mshell__crumb-sub { font-size: 16px; }
  .mshell__search { padding: 10px 14px; font-size: 16px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：侧栏再加宽、字号继续放大 */
  .mshell {
    grid-template-columns: 440px minmax(0, 1fr);
  }
  .mshell__side { padding: 26px 22px 18px; gap: 26px; }
  .mshell__logo-full { height: 88px; }
  .mshell__group-title { font-size: 17.5px; padding: 0 16px 9px; }
  .mshell__item { font-size: 20px; padding: 16px 16px; gap: 12px; }
  .mshell__item-badge { font-size: 16.5px; padding: 4px 12px; }
  .mshell__foot { font-size: 17.5px; padding: 14px 16px; }
  .mshell__topbar { min-height: 92px; padding: 12px 32px; }
  .mshell__crumb-group,
  .mshell__crumb-sub { font-size: 18.5px; }
  .mshell__search { padding: 12px 16px; font-size: 18.5px; }
}

/* 侧栏折叠（D5）：用户切换 data-collapsed 驱动 icon-only 模式；
   与 <860px 媒体查询兜底共用同一套隐藏规则 */
.mshell[data-collapsed='true'] { grid-template-columns: 64px minmax(0, 1fr); }
.mshell[data-collapsed='true'] .mshell__item-label,
.mshell[data-collapsed='true'] .mshell__item-badge,
.mshell[data-collapsed='true'] .mshell__group-title,
.mshell[data-collapsed='true'] .mshell__search { display: none; }
.mshell[data-collapsed='true'] .mshell__foot { display: none; }
.mshell[data-collapsed='true'] .mshell__item { justify-content: center; padding: 4px 0; }
.mshell[data-collapsed='true'] .mshell__item-glyph { display: inline-flex; }
.mshell[data-collapsed='true'] .mshell__logo-full { display: none; }
.mshell[data-collapsed='true'] .mshell__logo-mark { display: block; }
.mshell[data-collapsed='true'] .mshell__brand { justify-content: center; padding: 2px 0 0; }
.mshell[data-collapsed='true'] .mshell__collapse { position: absolute; right: -14px; top: 18px; }

/* 折叠按钮（展开态右上角，悬停显示 tooltip 由 title 提供） */
.mshell__collapse {
  border: 1px solid var(--mk-line, #e1e8f2);
  background: var(--mk-surface, #fff);
  color: var(--mk-muted, #5b6577);
  width: 24px; height: 24px;
  border-radius: 7px;
  font-size: 12px; line-height: 1;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0;
  margin-left: auto;
  flex-shrink: 0;
  transition: border-color 0.12s ease, color 0.12s ease;
}
.mshell__collapse:hover { color: var(--mk-blue, #2c63d0); border-color: rgba(44, 99, 208, 0.4); }

@media (max-width: 860px) {
  .mshell { grid-template-columns: 64px minmax(0, 1fr); }
  .mshell__item-label,
  .mshell__item-badge,
  .mshell__group-title,
  .mshell__search { display: none; }
  /* 窄屏图标栏：底部品牌/数据源/命令面板信息区整体隐藏（命令面板入口在顶栏） */
  .mshell__foot { display: none; }
  /* 窄屏图标栏：显示单字图标，悬停提示全名 */
  .mshell__item { justify-content: center; padding: 4px 0; }
  .mshell__item-glyph { display: inline-flex; }

  /* 折叠：长方形 logo 换正方形图标 */
  .mshell__logo-full { display: none; }
  .mshell__logo-mark { display: block; }
  .mshell__brand { justify-content: center; padding: 2px 0 0; }
}

/* ================= 暗色模式（D1）：壳层硬编码色覆写 ================= */
html[data-theme='dark'] {
  .mshell { background: #0f1624; color: #e6edf7; }
  .mshell__side { background: #131b2a; border-right-color: #232f45; }
  .mshell__item { color: #9fb0c8; }
  .mshell__item:hover { background: #1b2740; color: #e6edf7; }
  .mshell__item--active { background: rgba(91, 141, 239, 0.16); color: #7aa2ff; box-shadow: inset 3px 0 0 var(--mk-blue); }
  .mshell__item-glyph { background: #1d2739; color: #9fb0c8; }
  .mshell__item--active .mshell__item-glyph { background: rgba(91, 141, 239, 0.22); color: #7aa2ff; }
  .mshell__item-badge { background: #1d2739; color: #6b7c96; }
  .mshell__item--active .mshell__item-badge { background: rgba(91, 141, 239, 0.22); color: #7aa2ff; }
  .mshell__foot { border-top-color: #1f2a3d; }
  .mshell__foot-name { color: #64748b; }
  .mshell__foot-ver { color: #3d4c66; }
  .mshell__topbar { background: rgba(19, 27, 42, 0.88); border-bottom-color: #232f45; }
  .mshell__collapse { background: #131b2a; border-color: #232f45; color: #9fb0c8; }
  .mshell__collapse:hover { color: #7aa2ff; border-color: rgba(91, 141, 239, 0.4); }
  .mshell__crumb-sep { color: #3d4c66; }
  .mshell__help { background: rgba(91, 141, 239, 0.14); border-color: rgba(91, 141, 239, 0.4); color: #7aa2ff; }
  .mshell__help:hover { background: rgba(91, 141, 239, 0.24); }
  .mshell__help-icon { background: var(--mk-blue); }
  .mshell__search { background: #131b2a; border-color: #232f45; color: #6b7c96; }
  .mshell__kbd { background: #1d2739; border-color: #2a3850; }
  .mshell__refresh, .mshell__logout { background: #131b2a; border-color: #232f45; color: #9fb0c8; }
  .mshell__theme, .mshell__density { background: #131b2a; border-color: #232f45; color: #9fb0c8; }
  .mshell__theme:hover, .mshell__density:hover { color: #7aa2ff; border-color: rgba(91, 141, 239, 0.4); }
  .mshell__admin { color: #dce5f1; }
  .mshell__refresh:hover:not(:disabled) { color: #7aa2ff; border-color: rgba(91, 141, 239, 0.4); }
  .mshell__admin { color: #e6edf7; }
  .mshell__demo { background: #2a2410; border-bottom-color: rgba(251, 191, 36, 0.3); color: #fcd34d; }
  .mshell__demo-title { background: #b45309; }
  .mshell__demo-btn { background: #2a2410; border-color: rgba(251, 191, 36, 0.4); color: #fcd34d; }
  .mshell__demo-btn:hover { background: #3a2f14; }
}
</style>
