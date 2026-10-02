<template>
  <div class="mshell" :data-collapsed="collapsed || forcedCollapse ? 'true' : 'false'" :data-navopen="mobileNavOpen ? 'true' : 'false'">
    <!-- 迷你侧边栏（导航 + 侧栏再设计展示） -->
    <aside class="mshell__side">
      <div class="mshell__brand">
        <!-- 展开：长方形全 logo（图标 + 问流）；折叠：正方形图标。
             暗色用深色版资产（深墨字标→浅色，保留品牌蓝），而非 CSS 提亮滤镜。
             折叠开关不在这里——原型把「收起导航」放在侧栏底部（见 .mshell__foot），
             品牌行只承担品牌。 -->
        <img :src="theme === 'dark' ? '/logo-dark.png' : '/logo.png'" alt="问流" class="mshell__logo-full" />
        <img :src="theme === 'dark' ? '/favicon-dark.png' : '/favicon.png'" alt="问流" class="mshell__logo-mark" />
      </div>
      <!-- aria-label：页面内存在多个 <nav>/地标时读屏需要可区分的名称 -->
      <nav class="mshell__nav" aria-label="管理导航">
        <!-- 置顶独立入口（D5）：驾驶舱类页面渲染在分组上方，无组标题 -->
        <div v-if="pinnedScenes.length" class="mshell__pinned">
          <button
            v-for="item in pinnedScenes"
            :key="item.id"
            type="button"
            class="mshell__item"
            :class="{ 'mshell__item--active': item.id === current }"
            :aria-current="item.id === current ? 'page' : undefined"
            :title="item.label"
            @click="go(item)"
          >
            <span class="mshell__item-glyph" aria-hidden="true"><component :is="item.icon" :size="17" :stroke-width="1.75" /></span>
            <span class="mshell__item-label">{{ item.label }}</span>
            <span
              v-if="badgeOf(item)"
              class="mshell__item-badge"
              :class="{ 'mshell__item-badge--alarm': isAlarmBadge(item) }"
              :title="badgeTitle(item)"
            >{{ badgeOf(item) }}</span>
          </button>
        </div>
        <!-- 分组标题是「标签」不是入口（走查 2026-09-27 用户反馈「组名比组大」：
             原组头=可点按钮+图标+徽章+箭头，视觉比组内页面项还重，层级倒置。
             现改为纯文字小标签、分组恒展开，页面项成为导航唯一主体） -->
        <section v-for="group in groupedScenes" :key="group.title" class="mshell__group">
          <div
            class="mshell__caption"
            :class="{ 'mshell__caption--active': groupContainsCurrent(group.title) }"
            :title="`${group.title}（${group.items.length} 页）`"
          >
            {{ group.title }}
          </div>
          <div class="mshell__group-body">
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="mshell__item"
              :class="{ 'mshell__item--active': item.id === current }"
              :aria-current="item.id === current ? 'page' : undefined"
              :title="item.label"
              @click="go(item)"
            >
              <span class="mshell__item-glyph" aria-hidden="true"><component :is="item.icon" :size="17" :stroke-width="1.75" /></span>
              <span class="mshell__item-label">{{ item.label }}</span>
              <span
                v-if="badgeOf(item)"
                class="mshell__item-badge"
                :class="{ 'mshell__item-badge--alarm': isAlarmBadge(item) }"
                :title="badgeTitle(item)"
              >{{ badgeOf(item) }}</span>
            </button>
          </div>
        </section>
      </nav>
      <!-- 左侧底部：收起/展开导航一行（原型 .side__foot = 单个 nav__item）。
           刷新/术语/密度/主题 四个工具钮已上移顶栏右侧（原型侧栏底部只有这一行）。 -->
      <footer class="mshell__foot">
        <button
          type="button"
          class="mshell__collapse"
          :title="forcedCollapse ? '窄屏下侧栏保持图标轨' : collapsed ? '展开导航' : '收起导航'"
          :aria-label="forcedCollapse ? '窄屏下侧栏保持图标轨' : collapsed ? '展开导航' : '收起导航'"
          :aria-expanded="collapsed || forcedCollapse ? 'false' : 'true'"
          :disabled="forcedCollapse"
          @click="toggleCollapse"
        >
          <span class="mshell__collapse-icon" aria-hidden="true">
            <!-- 展开态显示「收起」（面板箭头向左），收起态显示「展开」（箭头向右） -->
            <PanelLeftClose v-if="!collapsed && !forcedCollapse" :size="17" :stroke-width="1.75" />
            <PanelLeftOpen v-else :size="17" :stroke-width="1.75" />
          </span>
          <span class="mshell__collapse-label">{{ collapsed ? '展开导航' : '收起导航' }}</span>
        </button>
      </footer>
    </aside>

    <!-- 移动端抽屉遮罩（原型 .navscrim 判例：点遮罩收抽屉；≤768 渲染） -->
    <button
      v-if="mobileNavOpen"
      type="button"
      class="mshell__navscrim"
      aria-label="关闭导航"
      @click="mobileNavOpen = false"
    ></button>

    <!-- 主区：顶栏（面包屑 / 搜索 / 主题 / 账户，newui/admin 原型壳）+ 内容 -->
    <div class="mshell__main">
      <header class="mshell__top">
        <!-- 移动端菜单钮（原型 ≤768 判例：抽屉开合；桌面 display:none） -->
        <button
          type="button"
          class="mshell__menu-btn"
          aria-label="打开导航"
          :aria-expanded="mobileNavOpen ? 'true' : 'false'"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <Menu :size="18" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <button
          v-if="crumb"
          type="button"
          class="mshell__top-back"
          :title="`返回${topTitle}`"
          aria-label="返回上一级"
          @click="$emit('crumb-click')"
        >
          <ChevronLeft :size="18" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <div class="mshell__top-crumb">
          <strong class="mshell__top-title">{{ topTitle }}</strong>
          <span v-if="topSub" class="mshell__top-sub">/ {{ topSub }}</span>
        </div>
        <div class="mshell__top-grow" aria-hidden="true"></div>
        <div class="mshell__search" ref="searchRef">
          <Search :size="15" :stroke-width="1.75" aria-hidden="true" class="mshell__search-icon" />
          <input
            v-model="searchQuery"
            class="mshell__search-input"
            type="text"
            placeholder="搜索页面…"
            aria-label="搜索页面，按 / 聚焦"
            @focus="searchOpen = true"
            @input="searchOpen = true"
            @keydown.enter.prevent="searchGoFirst"
            @keydown.escape.prevent="closeSearch"
          />
          <kbd class="mshell__search-kbd" aria-hidden="true">/</kbd>
          <div v-if="searchOpen && searchQuery.trim()" class="mshell__search-pop" role="listbox" aria-label="页面搜索结果">
            <button
              v-for="hit in searchHits"
              :key="hit.id"
              type="button"
              role="option"
              :aria-selected="hit.id === current"
              class="mshell__search-hit"
              @click="searchGo(hit)"
            >
              <component :is="hit.icon" :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span class="mshell__search-hit-label">{{ hit.label }}</span>
              <span class="mshell__search-hit-group">{{ hit.group }}</span>
            </button>
            <div v-if="!searchHits.length" class="mshell__search-empty">没有匹配的页面</div>
          </div>
        </div>
        <!-- 工具钮：刷新 / 术语表 / 密度（原型侧栏底部只有「收起导航」一行，
             这四个低频工具钮回归顶栏右侧；主题钮紧随其后） -->
        <button
          type="button"
          class="mshell__top-btn"
          :disabled="liveLoading"
          :title="liveLoading ? '刷新中…' : '刷新真实数据'"
          :aria-label="liveLoading ? '刷新中…' : '刷新真实数据'"
          @click="refreshData"
        >
          <RotateCw :size="16" :stroke-width="1.75" :class="{ 'mshell__spin': liveLoading }" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="mshell__top-btn"
          title="运营术语表 / 这是什么"
          aria-label="运营术语表 / 这是什么"
          @click="$emit('glossary')"
        >
          <CircleHelp :size="16" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <button
          v-if="release"
          type="button"
          class="mshell__top-btn"
          :title="density === 'compact' ? '当前紧凑密度 · 点击切换标准' : '当前标准密度 · 点击切换紧凑'"
          :aria-label="density === 'compact' ? '切换到标准密度' : '切换到紧凑密度'"
          @click="toggleDensity"
        >
          <!-- 标准密度：四条均匀行线；紧凑密度：上两行收紧、下两行疏（形似压缩） -->
          <svg v-if="density !== 'compact'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 6.5h16"/><path d="M4 11h16"/><path d="M4 15.5h16"/><path d="M4 20h16"/></svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 5.5h16"/><path d="M4 9.5h16"/><path d="M4 16h16"/><path d="M4 20h16"/></svg>
        </button>
        <button
          type="button"
          class="mshell__top-btn"
          :title="theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'"
          :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'"
          @click="toggleTheme"
        >
          <Sun v-if="theme === 'dark'" :size="16" :stroke-width="1.75" aria-hidden="true" />
          <Moon v-else :size="16" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <div v-if="release" class="mshell__user" ref="userMenuRef">
          <button
            type="button"
            class="mshell__userchip"
            :aria-expanded="userMenuOpen ? 'true' : 'false'"
            aria-haspopup="menu"
            @click="userMenuOpen = !userMenuOpen"
          >
            <span class="mshell__user-avatar" aria-hidden="true">{{ adminName.slice(0, 1).toUpperCase() }}</span>
            <span class="mshell__user-name">{{ adminName }}</span>
          </button>
          <div v-if="userMenuOpen" class="mshell__user-menu" role="menu">
            <!-- 账户菜单（原型 2772-2776：登录页预览 / 账户设置 / 退出登录）。
                 登录页预览与账户设置是导航项（.mshell__user-nav），退出登录是动作项
                 （.mshell__user-item，销毁当前会话）——语义分组不同故类名区分。 -->
            <button type="button" role="menuitem" class="mshell__user-nav" @click="openLoginPreview">
              <Shield :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>登录页预览</span>
            </button>
            <button type="button" role="menuitem" class="mshell__user-nav" @click="openAccountSettings">
              <Users :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>账户设置</span>
            </button>
            <button type="button" role="menuitem" class="mshell__user-item" @click="logout">
              <LogOut :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>退出登录</span>
            </button>
          </div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, CircleHelp, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RotateCw, Search, Shield, Sun, Users } from 'lucide-vue-next'
import { MOCK_SCENES, type MockSceneDef } from './manifest'
import { liveNavBadges, alarmNavBadges, loadLiveData, liveLoading } from './live'
import { adminAuthApi, clearAdminSession } from '@/api/adminApi'
import { readTheme, writeTheme, applyDocumentTheme } from '@/utils/theme'

const props = defineProps<{ current: string; crumb?: string; crumbTitle?: string; crumbClickable?: boolean; release?: boolean }>()
const emit = defineEmits<{ (e: 'navigate', id: string): void; (e: 'glossary'): void; (e: 'crumb-click'): void }>()

/* 滚动修复 #9：回到顶部按钮（内容区滚动时出现）；
   应用式布局下真正滚动的是页面级容器（admin 为 .mk-page），
   而非 .mshell__content —— 故运行时解析实际滚动宿主，并以捕获阶段监听其滚动。 */
const contentEl = ref<HTMLElement | null>(null)
const backtopVisible = ref(false)

/** 解析当前真正可滚动的内容容器：优先 .mshell__content，其次页面级 .mk-page。 */
function scrollHost(): HTMLElement | null {
  const el = contentEl.value
  if (!el) return null
  if (el.scrollHeight - el.clientHeight > 4) return el
  const inner = el.querySelector<HTMLElement>('.mk-page')
  if (inner && inner.scrollHeight - inner.clientHeight > 4) return inner
  return el
}
function onScroll() {
  const host = scrollHost()
  backtopVisible.value = !!host && host.scrollTop > 200
}
function backToTop() {
  scrollHost()?.scrollTo({ top: 0, behavior: 'smooth' })
}
onMounted(() => {
  // 滚动事件不冒泡，但捕获阶段可命中后代滚动容器（.mk-page）
  contentEl.value?.addEventListener('scroll', onScroll, { passive: true, capture: true })
  onScroll()
  document.addEventListener('click', onDocDown)
  document.addEventListener('keydown', onGlobalKey)
  collapseMq = window.matchMedia('(max-width: 1024px)')
  syncForcedCollapse()
  collapseMq.addEventListener('change', syncForcedCollapse)
  mobileMq = window.matchMedia('(max-width: 768px)')
  syncMobileNavViewport()
  mobileMq.addEventListener('change', syncMobileNavViewport)
})
onBeforeUnmount(() => {
  contentEl.value?.removeEventListener('scroll', onScroll, true)
  document.removeEventListener('click', onDocDown)
  document.removeEventListener('keydown', onGlobalKey)
  collapseMq?.removeEventListener('change', syncForcedCollapse)
  mobileMq?.removeEventListener('change', syncMobileNavViewport)
})

/* —— 顶栏（newui/admin 原型壳）：面包屑 / 页面搜索 / 主题 / 账户菜单 —— */
const userMenuOpen = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const searchOpen = ref(false)

const currentScene = computed(() => MOCK_SCENES.find((s) => s.id === props.current))
/* 详情页（有 crumb）：主标题=子页实体名；副行=父页名（原型：如「用户与学习者」）。
   L1 页：主标题=页面名、副行=分组。
   修复：原先无 from 时副行取 crumbTitle（与实体名相同），顶栏出现「沈奕航 / 沈奕航」重复。
   现详情页副行取父页名：有上级取上级（crumb 首段），无上级取当前一级页名；
   若与主标题同名则退到分组，确保主副不再同名。 */
const topTitle = computed(() => {
  if (props.crumb) {
    const parts = props.crumb.split(' / ')
    return parts[parts.length - 1] || props.crumb
  }
  return currentScene.value?.label ?? '管理控制台'
})
const topSub = computed(() => {
  if (props.crumb) {
    const parts = props.crumb.split(' / ')
    if (parts.length > 1) return parts[0] || ''
    const parentPage = currentScene.value?.label ?? ''
    if (parentPage && parentPage !== topTitle.value) return parentPage
    return currentScene.value?.group ?? ''
  }
  return currentScene.value?.group ?? ''
})

const searchHits = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return MOCK_SCENES.filter((s) => `${s.label} ${s.group}`.toLowerCase().includes(q)).slice(0, 8)
})
function searchGo(scene: MockSceneDef) {
  closeSearch()
  go(scene)
}
function searchGoFirst() {
  const first = searchHits.value[0]
  if (first) searchGo(first)
}
function closeSearch() {
  searchOpen.value = false
  searchQuery.value = ''
}
/** `/` 全局聚焦页面搜索（输入态不抢焦点） */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    userMenuOpen.value = false
    mobileNavOpen.value = false
    return
  }
  if (e.key !== '/') return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
  searchRef.value?.querySelector<HTMLInputElement>('input')?.focus()
}
function onDocDown(e: MouseEvent) {
  if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) userMenuOpen.value = false
  if (searchRef.value && !searchRef.value.contains(e.target as Node)) searchOpen.value = false
}

/* ≤1024 强制折叠（原型口径：窄屏只留图标轨）；用户的手动折叠只在宽屏生效 */
const forcedCollapse = ref(false)
let collapseMq: MediaQueryList | null = null
function syncForcedCollapse() {
  forcedCollapse.value = !!collapseMq?.matches
}

/* 移动端抽屉（原型 ≤768 判例：菜单钮 + 滑入侧栏 + 遮罩；桌面无此态）。
   关闭时机：点遮罩 / Esc / 切导航（current 变化）/ 放大回桌面宽度。 */
const mobileNavOpen = ref(false)
let mobileMq: MediaQueryList | null = null
function syncMobileNavViewport() {
  if (mobileMq && !mobileMq.matches) mobileNavOpen.value = false
}
watch(() => props.current, () => { mobileNavOpen.value = false })

/* D1 暗色模式：统一走 utils/theme.ts SSOT（readTheme/writeTheme）。
   背景：主题 key 已收敛到 v2_theme（用户侧 ThemeToggle 原 key）+ wenflow-theme 兼容 key，
   Shell 若仍独立写 wf_admin_theme 会与用户侧脱节——用户切日间后换页被
   readTheme() 按 v2_theme 旧值覆盖（黑白闪/主题随页面变化）。 */
const theme = ref<'light' | 'dark'>(readTheme())
function applyTheme() {
  applyDocumentTheme(theme.value)
  writeTheme(theme.value)
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
  return liveNavBadges.value[item.id] || ''
}

/* 角标语义说明：红色=告警（近 7 天执行失败数，点击进入执行日志后自动平息）；
   其余=数据量计数。角标语义 =「数据量」；页面数只在分组悬浮里以「页」表达，两者不混用 */
const BADGE_MEANING: Record<string, string> = {
  'virtual-learners': '虚拟学习者数量',
  skills: 'Skill 数量',
  'ops-hub': '已发布公告数量',
  'execution-logs': '近 7 天执行失败次数',
}
function badgeTitle(item: MockSceneDef): string {
  const count = badgeOf(item)
  if (!count) return ''
  if (alarmNavBadges.has(item.id)) {
    return `近 7 天执行失败 ${count} 次（告警徽章：红色；进入执行日志页后自动平息）`
  }
  return `${BADGE_MEANING[item.id] || item.label}：${count}`
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
  const cur = Number(liveNavBadges.value[item.id] || 0)
  const read = Number(alarmRead.value[item.id] || 0)
  return alarmNavBadges.has(item.id) && cur > 0 && cur > read
}

function go(item: MockSceneDef) {
  markAlarmRead(item)
  emit('navigate', item.id)
}

/* release 模式：管理员信息与退出登录 */
/** localStorage 非响应式：computed 无响应式依赖会永久缓存，登录写入后本页不刷新名字。
     改为 setup 时读一次 ref + storage 事件（跨标签页写入也会同步刷新）。 */
const ADMIN_USER_KEY = 'admin_user'
function readAdminName(): string {
  try {
    const raw = localStorage.getItem(ADMIN_USER_KEY) || sessionStorage.getItem(ADMIN_USER_KEY)
    if (!raw) return 'admin'
    return String(JSON.parse(raw).name || 'admin')
  } catch {
    return 'admin'
  }
}
const adminName = ref(readAdminName())
window.addEventListener('storage', (e) => {
  if (e.key === ADMIN_USER_KEY || e.key === null) adminName.value = readAdminName()
})

async function logout() {
  try {
    await adminAuthApi.logout()
  } catch {
    // 登出接口失败：本地清理会话再跳转，避免守卫检测到残留会话又弹回控制台
    clearAdminSession()
  }
  // 带 redirect：登录成功后回到登出时的深链（含二级页 ?view=&id=，Login.safeRedirect 已做同源校验）
  const back = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)
  window.location.replace(`/admin/login?redirect=${back}`)
}

/* 账户菜单导航项（原型 2772-2776）。
   两项目标均为真实路由，故以新标签页打开，保留当前管理会话上下文：
   - /admin/login 为管理端登录页；已登录时守卫会弹回总览（未「记住我」的新标签页则是真实登录页）。
   - 管理端无独立账户页，账户设置落到用户侧个人中心 /user/account。 */
function openLoginPreview() {
  userMenuOpen.value = false
  window.open('/admin/login', '_blank', 'noopener,noreferrer')
}
function openAccountSettings() {
  userMenuOpen.value = false
  window.open('/user/account', '_blank', 'noopener,noreferrer')
}

/** 置顶独立入口（D5）：pinned 项渲染在分组上方（无组标题） */
const pinnedScenes = computed(() => MOCK_SCENES.filter((s) => s.pinned))

const groupedScenes = computed(() => {
  const groups: Array<{ title: string; items: MockSceneDef[] }> = []
  for (const scene of MOCK_SCENES) {
    if (scene.pinned) continue // 置顶项不进分组
    let g = groups.find((x) => x.title === scene.group)
    if (!g) {
      g = { title: scene.group, items: [] }
      groups.push(g)
    }
    g.items.push(scene)
  }
  return groups
})

/* 当前页所在组：仅用于给所在组的「标签」上强调色（分组已恒展开，不再有折叠状态机
   —— 走查 2026-09-27 用户反馈「组名比组大」：组头降级为纯文字标签，见模板注释） */
const groupContainsCurrent = (title: string) => groupedScenes.value.find((g) => g.title === title)?.items.some((i) => i.id === props.current) ?? false
/* 告警平息口径：进入告警场景即视为已读（侧栏 go() 之外，TabBar/深链直达也应平息；
   用 props.current watch 而非仅 Shell 点击，保证各导航路径一致） */
watch(
  () => props.current,
  (cur) => {
    const item = MOCK_SCENES.find((s) => s.id === cur)
    if (item && alarmNavBadges.has(item.id)) markAlarmRead(item)
  },
  { immediate: true }
)
/* 组级徽章聚合已随「组头降级为标签」移除：计数仍显示在具体页面项上
   （虚拟学习者/Skill 与提示词/执行日志…），告警脉冲由 mshell__item-badge--alarm 承担 */
</script>

<style scoped>
.mshell {
  display: grid;
  /* 侧栏宽度 244px = newui「UI-分支优化设计」原型 --nav-w。原 208px 是按「子项缩进 24px」
     那套层级量出来的；原型改成扁平导航（项与分组标签同一起点、图标自带 10px 间隙），
     244px 才能让标签+计数在同一行不折行。折叠轨仍 64px（--nav-w-min）。 */
  grid-template-columns: 244px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--mk-bg, #f7f8fa);
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
}

/* 侧边栏 */
.mshell__side {
  display: flex;
  flex-direction: column;
  background: var(--mk-side-bg);
  border-right: 1px solid var(--mk-side-line);
  /* 内边距/间距对齐原型 .side（12px 12px 8px，gap 8px）：导航项自带左右 10px，
     与外沿 12px 只差 2px，选中胶囊看上去近乎贴边——这是原型的读法。 */
  padding: 12px 12px 8px;
  gap: 8px;
  /* 高于抽屉遮罩(200)：抽屉打开时侧栏仍可点击，
     点击导航由 AdminConsole watch(scene) 联动关闭抽屉 */
  position: relative;
  z-index: var(--mk-z-sidebar);
}
.mshell__brand {
  display: flex;
  align-items: center;
  /* 左对齐（原型 .brand 口径）：折叠按钮靠 margin-left:auto 顶到右端，
     收紧到 34px 的字标不再居中悬浮 */
  justify-content: flex-start;
  gap: 12px;
  min-height: 44px;
  padding: 0 4px;
}
.mshell__logo-full {
  height: 34px;
  width: auto;
  display: block;
}
.mshell__logo-mark {
  display: none;
  height: 34px;
  width: 34px;
}

/* 组间距 8px：组标题自带 padding-top，原 14px gap 叠加后组间隔 ≈28px 过散（用户反馈 2026-09-29）；
   对齐原型后组间隔由 .mshell__group 的 margin-top 统一表达，容器 gap 收到 4px */
.mshell__nav { flex: 1; overflow-y: auto; display: grid; gap: 4px; align-content: start; padding-bottom: 8px; }
/* 置顶独立入口区（D5）：驾驶舱入口，与分组间用分隔线区分 */
.mshell__pinned {
  display: grid;
  gap: 2px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--mk-line, #e1e8f2);
  margin-bottom: 2px;
}
/* 置顶入口比组内子项略收高度：驾驶舱入口不再显高（用户反馈 2026-09-05）。
   注意：这里**不能写 color**——`.mshell__pinned .mshell__item`（0,2,0）会压过
   `.mshell__item--active`（0,1,0），而置顶项（平台总览）恰恰常年是选中项，
   于是它的文字被这条抢成灰色，选中态只剩浅蓝底、没有主色字。
   文字色统一由 .mshell__item / --active 决定。 */
.mshell__pinned .mshell__item { font-weight: 600; padding-top: 6px; padding-bottom: 6px; }
.mshell__group { display: grid; gap: 1px; margin-top: 12px; }
/* 分组标题 = 纯文字小标签，不是可点入口（走查 2026-09-27「组名比组大」整改：
   原组头是按钮+图标+徽章+箭头，比组内页面项还重。现在页面项是导航唯一主体，
   标签只负责分区命名；恒展开，折叠状态机已删）。
   规格对齐原型 .nav__cap：字距 0.12em + 大写，与导航项同一左起点（不再缩进子项）。 */
.mshell__caption {
  padding: 0 8px;
  margin-bottom: 2px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
.mshell__caption--active { color: var(--mk-accent-deep, var(--mk-accent-deep)); }
.mshell__group-body { display: grid; gap: 1px; }
/* 子项不再缩进：原型里分组标签与导航项共用同一左起点，层级由标签的小字/大写/字距承担，
   缩进会把「组内从属」重复表达一次并把标签+计数挤到折行 */
.mshell__group-body .mshell__item { padding-left: 10px; }
.mshell__item {
  display: flex;
  align-items: center;
  gap: 10px;
  /* 宽度交给 grid 拉伸（保持整行可点）。
     内缩 8px 与 3px 左条已撤：原型选中态是整行浅蓝胶囊（--brand-bg）+ 主色字 + 加粗，
     不再用「左条 + 内缩胶囊」双重标注（原写法在扁平导航里会读成缩进层级）。 */
  padding: 8px 10px;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: transparent;
  /* 原型 .nav__item 用 --muted（不是侧栏专用的深一档文字色）：扁平导航下
     条目与分组标签同色系，靠选中态（浅蓝胶囊+主色字）承担定位，不用整体加深 */
  color: var(--mk-muted);
  font: inherit;
  font-size: var(--mk-fs-body);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: 0.12s ease;
  margin: 0;
}
.mshell__item:hover { background: var(--mk-side-hover); color: var(--mk-ink); }
/* 点击导航后不残留聚焦描边环（选中态由 --active 底色表达）；键盘 Tab 仍有可见环 */
.mshell__item:focus { outline: none; }
.mshell__item:focus-visible { outline: 2px solid var(--mk-blue, #2f6ae0); outline-offset: -2px; }
.mshell__item--active {
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-weight: 600;
}
/* 图标常显（newui 原型壳：展开态=图标+文字，折叠轨=仅图标）。
   原型是裸线性图标（17px，无底衬），不做 28px 圆角芯片——芯片底在扁平导航里
   会把每一项都读成「可点的方块」，选中态反而被稀释。 */
.mshell__item-glyph {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  color: inherit;
  flex-shrink: 0;
}
.mshell__item-glyph svg { display: block; }
/* 子项角标紧跟标签（不右推）：短标签 + 右对齐计数会在行中间拉出一条空洞。
   规格对齐原型 .nav__badge（中性灰底 / 选中蓝底） */
.mshell__item-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--mk-surface-3);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.mshell__item--active .mshell__item-badge { background: var(--mk-blue-bg-strong); color: var(--mk-blue); }
.mshell__item-badge--alarm {
  background: var(--mk-red-bg-strong);
  color: var(--mk-red-strong);
  animation: mshell-alarm-pulse 1.6s ease-in-out infinite;
}
@keyframes mshell-alarm-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.32); }
  50% { box-shadow: 0 0 0 4px rgba(220, 38, 38, 0); }
}

/* 左侧底部：收起/展开导航一行（原型 .side__foot = 单个 nav__item）。
   规格对齐原型：上边框 1px、padding 8px 0 0、gap 2px，行本身是导航项样式
   （图标 17px + 文字，8px 10px 内边距、8px 圆角，高约 39px）。 */
.mshell__foot {
  display: grid;
  gap: 2px;
  padding: 8px 0 0;
  border-top: 1px solid var(--mk-side-line);
  flex-shrink: 0;
}
.mshell__collapse {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: transparent;
  color: var(--mk-muted);
  font: inherit;
  font-size: var(--mk-fs-body);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: 0.12s ease;
}
.mshell__collapse:hover { background: var(--mk-side-hover); color: var(--mk-ink); }
.mshell__collapse:disabled { cursor: default; opacity: 0.5; }
.mshell__collapse:focus { outline: none; }
.mshell__collapse:focus-visible { outline: 2px solid var(--mk-blue, #2f6ae0); outline-offset: -2px; }
.mshell__collapse-icon { display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center; flex-shrink: 0; }
.mshell__collapse-icon svg { display: block; }
.mshell__collapse-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mshell__spin { animation: mshell-spin 0.8s linear infinite; }
@keyframes mshell-spin { to { transform: rotate(360deg); } }

/* 用户区（顶栏账户 chip）：头像 + 名字 → 退出菜单。
   原侧栏底部版本（带 border-top / 竖排折叠态）随底部改版删除，
   账户现在只出现在顶栏（原型 .userchip 同位置）。 */
.mshell__user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--mk-blue-bg-strong);
  color: var(--mk-accent-deep, var(--mk-accent-deep));
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  flex-shrink: 0;
}
.mshell__user-name {
  flex: 1;
  min-width: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 主区：高度锁定在壳层（shell 100dvh）内，content 行 1fr 承接剩余高度 */
.mshell__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

/* ====== 顶栏（newui 原型壳）：56px 毛玻璃条——返回/面包屑/搜索/主题/账户 ====== */
.mshell__top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  /* 左右 20px = 原型 .top（--sp-5），与页面容器的 20px 内边距对齐成同一条竖线 */
  padding: 0 20px;
  background: color-mix(in srgb, var(--mk-bg, #f7f8fa) 86%, transparent);
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  position: relative;
  z-index: 20;
}
.mshell__top-back {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface, #fff);
  color: var(--mk-ink);
  cursor: pointer;
  transition: border-color 0.14s ease, color 0.14s ease;
}
.mshell__top-back:hover { border-color: color-mix(in srgb, var(--mk-blue, #2f6ae0) 40%, transparent); color: var(--mk-blue, #2f6ae0); }
.mshell__top-crumb { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.mshell__top-title {
  font-size: var(--mk-fs-emphasis, 15px);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mshell__top-sub {
  font-size: var(--mk-fs-micro, 12px);
  color: var(--mk-faint);
  white-space: nowrap;
}
.mshell__top-grow { flex: 1 1 auto; }
.mshell__top-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: transparent;
  color: var(--mk-muted);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.mshell__top-btn:hover { background: var(--mk-hover-surface); color: var(--mk-ink); }

/* 页面搜索：场景跳转（label/组名过滤，Enter 去第一个命中） */
.mshell__search { position: relative; flex: 0 1 280px; min-width: 200px; }
.mshell__search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--mk-faint);
  pointer-events: none;
}
.mshell__search-input {
  width: 100%;
  height: 34px;
  padding: 0 34px 0 30px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface, #fff);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-micro, 12px);
  outline: none;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.mshell__search-input::placeholder { color: var(--mk-faint); }
.mshell__search-input:focus {
  border-color: color-mix(in srgb, var(--mk-blue, #2f6ae0) 45%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-blue, #2f6ae0) 12%, transparent);
}
.mshell__search-kbd {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--mk-mono, monospace);
  font-size: var(--mk-fs-micro, 12px);
  color: var(--mk-faint);
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 4px;
  padding: 0 5px;
  background: var(--mk-surface-2, #eef2fa);
  pointer-events: none;
}
.mshell__search-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  padding: 6px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface, #fff);
  box-shadow: 0 16px 40px rgba(22, 34, 55, 0.14);
  display: grid;
  gap: 2px;
  z-index: 60;
}
.mshell__search-hit {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-micro, 12px);
  font-weight: 600;
  color: var(--mk-ink);
  cursor: pointer;
  text-align: left;
}
.mshell__search-hit svg { color: var(--mk-muted); flex: none; }
.mshell__search-hit:hover { background: var(--mk-hover-surface); }
.mshell__search-hit-group { margin-left: auto; color: var(--mk-faint); font-weight: 500; }
.mshell__search-empty { padding: 10px; font-size: var(--mk-fs-micro, 12px); color: var(--mk-faint); }

/* 账户菜单（userchip）：头像 + 名字 → 退出登录。
   顶栏账户区定位（原侧栏底部的 .mshell__user 规则随底部改版删除——
   原型侧栏底部只有「收起导航」一行，账户在顶栏） */
.mshell__user { position: relative; flex: none; }
.mshell__userchip {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-micro, 12px);
  font-weight: 700;
  color: var(--mk-ink);
  padding: 4px 8px 4px 4px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.14s ease;
}
.mshell__userchip:hover { background: var(--mk-hover-surface); }
.mshell__user-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 150px;
  padding: 6px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface, #fff);
  box-shadow: 0 16px 40px rgba(22, 34, 55, 0.14);
  display: grid;
  gap: 2px;
  z-index: 60;
  transform-origin: top right;
  /* 进场动效直接用 animation（Vue Transition 的 name 派生类会被死类门禁误报） */
  animation: mshell-pop-in 0.14s var(--mk-ease-out, ease);
}
@keyframes mshell-pop-in {
  from { opacity: 0; transform: translateY(-6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .mshell__user-menu { animation: none; }
}
.mshell__user-item,
.mshell__user-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-micro, 12px);
  font-weight: 600;
  color: var(--mk-ink);
  cursor: pointer;
  text-align: left;
}
.mshell__user-item svg,
.mshell__user-nav svg { color: var(--mk-muted); flex: none; }
.mshell__user-item:hover,
.mshell__user-nav:hover { background: var(--mk-hover-surface); }

/* 内容区：应用式布局的唯一滚动容器（顶栏/侧栏固定，内容区内滚；
   列表页用 .mk-page--fill 让表格区内滚、分页器吸底。
   flex 列：页面块独占顶栏之下的剩余高度并内滚）
   注：原多标签栏（.mk-tabbar）已删除，每个页面因此多回 36px 可用高度 */
.mshell__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.mshell__content > * {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 1440px 中间档：侧栏适度放大（幅度约为 2000 档一半） */
@media (min-width: 1440px) {
  .mshell { grid-template-columns: 260px minmax(0, 1fr); }
  .mshell__item { font-size: var(--mk-fs-body); padding: 8px 11px; }
  .mshell__caption { font-size: var(--mk-fs-micro); }
  .mshell__item-badge { font-size: var(--mk-fs-micro); }
  .mshell__logo-full { height: 36px; }
}

/* 大屏（2000+）：侧栏加宽、字号放大；2800+（4K）再升一档（zoom 之上叠加）。
   宽度只随内容（字号）增长、不随屏宽膨胀——短标签配宽侧栏会在行右拉出大片空洞 */
@media (min-width: 1920px) {
  .mshell { grid-template-columns: 276px minmax(0, 1fr); }
  .mshell__item { font-size: var(--mk-fs-body); padding: 8px 12px; }
  .mshell__caption { font-size: var(--mk-fs-micro); }
  .mshell__item-badge { font-size: var(--mk-fs-micro); }
  .mshell__logo-full { height: 38px; }
}
@media (min-width: 2000px) {
  .mshell {
    grid-template-columns: 284px minmax(0, 1fr);
  }
  .mshell__side { padding: 16px 14px 12px; gap: 10px; }
  .mshell__logo-full { height: 40px; }
  .mshell__caption { font-size: var(--mk-fs-micro); }
  .mshell__item { font-size: var(--mk-fs-body); padding: 9px 12px; gap: 10px; }
  .mshell__item-badge { font-size: var(--mk-fs-micro); padding: 2px 8px; }
  .mshell__foot { font-size: var(--mk-fs-micro); }
  .mshell__user-avatar { width: 28px; height: 28px; }
}
@media (min-width: 2800px) {
  .mshell {
    grid-template-columns: 324px minmax(0, 1fr);
  }
  .mshell__side { padding: 18px 16px 12px; gap: 12px; }
  .mshell__logo-full { height: 44px; }
  .mshell__caption { font-size: var(--mk-fs-micro); }
  .mshell__item { font-size: var(--mk-fs-body); padding: 11px 14px; gap: 10px; border-radius: var(--mk-radius-md); }
  .mshell__item-badge { font-size: var(--mk-fs-micro); padding: 3px 10px; }
  .mshell__foot { font-size: var(--mk-fs-micro); }
  .mshell__user-avatar { width: 32px; height: 32px; }
  .mshell__user-name { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：侧栏再加宽、字号继续放大 */
  .mshell {
    grid-template-columns: 372px minmax(0, 1fr);
  }
  .mshell__side { padding: 20px 18px 14px; gap: 14px; }
  .mshell__logo-full { height: 52px; }
  .mshell__caption { font-size: var(--mk-fs-body); }
  .mshell__item { font-size: var(--mk-fs-emphasis); padding: 14px 16px; gap: 12px; }
  .mshell__item-badge { font-size: var(--mk-fs-body); padding: 4px 12px; }
  .mshell__foot { font-size: var(--mk-fs-body); }
  .mshell__user-avatar { width: 38px; height: 38px; }
  .mshell__user-name { font-size: var(--mk-fs-body); }
}

/* 侧栏折叠（D5）：用户切换 data-collapsed 驱动 icon-only 模式；
   与 <860px 媒体查询兜底共用同一套隐藏规则 */
.mshell[data-collapsed='true'] { grid-template-columns: 64px minmax(0, 1fr); }
.mshell[data-collapsed='true'] .mshell__item-label,
.mshell[data-collapsed='true'] .mshell__item-badge,
.mshell[data-collapsed='true'] .mshell__caption { display: none; }
/* 折叠轨里「收起导航」只剩图标（文字会撑破 64px 轨道） */
.mshell[data-collapsed='true'] .mshell__foot { padding: 8px 0 0; }
.mshell[data-collapsed='true'] .mshell__collapse { justify-content: center; padding: 8px 0; }
.mshell[data-collapsed='true'] .mshell__collapse-label { display: none; }
.mshell[data-collapsed='true'] .mshell__item { justify-content: center; padding: 4px 0; }
.mshell[data-collapsed='true'] .mshell__group-body .mshell__item { padding-left: 0; }
.mshell[data-collapsed='true'] .mshell__item-glyph { display: inline-flex; }
.mshell[data-collapsed='true'] .mshell__logo-full { display: none; }
.mshell[data-collapsed='true'] .mshell__logo-mark { display: block; }
.mshell[data-collapsed='true'] .mshell__brand { justify-content: center; padding: 2px 0 0; }
.mshell[data-collapsed='true'] .mshell__pinned { justify-content: center; padding-bottom: 8px; border-bottom: 0; }
.mshell[data-collapsed='true'] .mshell__group { margin-top: 10px; }
/* 折叠态组间分隔线:单字按钮平铺无分组上下文,用细线+留白恢复结构 */
.mshell[data-collapsed='true'] .mshell__group + .mshell__group {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--mk-line, #2f3239);
}

@media (max-width: 860px) {
  .mshell { grid-template-columns: 64px minmax(0, 1fr); }
  .mshell__item-label,
  .mshell__item-badge,
  .mshell__caption { display: none; }
  .mshell__foot { padding: 8px 0 0; }
  .mshell__collapse { justify-content: center; padding: 8px 0; }
  .mshell__collapse-label { display: none; }
  /* 窄屏图标栏：显示单字图标，悬停提示全名 */
  .mshell__item { justify-content: center; padding: 4px 0; }
  .mshell__pinned .mshell__item { padding-top: 4px; padding-bottom: 4px; }
  .mshell__group-body .mshell__item { padding-left: 0; }
  .mshell__item-glyph { display: inline-flex; }

  /* 折叠：长方形 logo 换正方形图标 */
  .mshell__logo-full { display: none; }
  .mshell__logo-mark { display: block; }
  .mshell__brand { justify-content: center; padding: 2px 0 0; }
}

/* ================= 暗色模式（D1）：壳层硬编码色覆写 ================= */
html[data-theme='dark'] {
  .mshell { background: var(--mk-bg); color: var(--mk-ink); }
  /* 侧栏夹在 bg 与 surface 之间（bg < side < card < 表头条带）。原 #19191a 距 bg 仅 5 级，
     卡片抬到 #202124 后侧栏反而比内容更"浅"，主次颠倒。 */
  .mshell__side { background: var(--mk-side-bg); border-right-color: var(--mk-side-line); }
  .mshell__pinned { border-bottom-color: #36373c; }
  /* 分组标签（次级文字）：走查实测 #808389 在侧栏底 --mk-side-bg(#1b1c1f) 上对比度 4.43:1，
     未达 WCAG 4.5:1。同色相等量提亮为 #898d94（WCAG 公式复算 5.11:1），达标且不明显破坏次级层级。 */
  .mshell__caption { color: #898d94; }
  .mshell__caption--active { color: var(--mk-accent-deep); }
  .mshell__item-badge--alarm { background: rgba(220, 38, 38, 0.18); color: #fca5a5; }
  .mshell__item:hover { background: var(--mk-side-hover); color: var(--mk-ink); }
  /* 选中态与亮色同构：整行浅蓝胶囊 + 主色字（左条/图标芯片已随扁平导航撤除） */
  .mshell__item--active { background: rgba(91, 141, 239, 0.1); color: var(--mk-accent-deep); }
  .mshell__item-badge { background: var(--mk-side-inset); color: var(--mk-faint); }
  .mshell__item--active .mshell__item-badge { background: rgba(91, 141, 239, 0.22); color: var(--mk-accent-deep); }
  .mshell__foot { border-top-color: var(--mk-side-hover); }
  .mshell__collapse { color: var(--mk-muted); }
  .mshell__collapse:hover { background: var(--mk-side-hover); color: var(--mk-accent-deep); }
  .mshell__user-avatar { background: var(--mk-side-inset); color: var(--mk-accent-deep); }
  .mshell__user-name { color: #efeff0; }
}

/* ===== 移动端抽屉（原型 ≤768 判例：menu-btn + 滑入侧栏 + navscrim）=====
   ≤1024 的强制图标轨与手动折叠在抽屉态下全部失效：抽屉永远呈现完整标签导航。
   放在折叠规则之后，靠源序覆盖同特异性选择器。 */
.mshell__menu-btn { display: none; }
@media (max-width: 768px) {
  .mshell { grid-template-columns: minmax(0, 1fr); }
  /* 原型 ≤1100 即隐藏顶栏搜索（.search{display:none}）：390 视口下搜索框挤压面包屑 */
  .mshell__search { display: none; }
  .mshell__menu-btn {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    border: 1px solid var(--mk-line, #e6ebf4);
    border-radius: var(--mk-radius-md);
    background: var(--mk-surface, #fff);
    color: var(--mk-ink);
    cursor: pointer;
  }
  .mshell__menu-btn:hover { border-color: color-mix(in srgb, var(--mk-blue, #2f6ae0) 40%, transparent); color: var(--mk-blue, #2f6ae0); }
  .mshell__side {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(280px, 82vw);
    transform: translateX(-100%);
    transition: transform 0.24s ease;
    z-index: 210;
  }
  .mshell[data-navopen='true'] .mshell__side { transform: none; box-shadow: 0 18px 48px rgba(22, 34, 55, 0.25); }
  /* 抽屉态下折叠（强制/手动）不生效：恢复完整标签导航 */
  .mshell[data-collapsed='true'] { grid-template-columns: minmax(0, 1fr); }
  .mshell[data-collapsed='true'] .mshell__item-label,
  .mshell[data-collapsed='true'] .mshell__item-badge,
  .mshell[data-collapsed='true'] .mshell__caption { display: block; }
  .mshell[data-collapsed='true'] .mshell__item { justify-content: flex-start; padding: 8px 10px; }
  .mshell[data-collapsed='true'] .mshell__group-body .mshell__item { padding-left: 10px; }
  .mshell[data-collapsed='true'] .mshell__logo-full { display: block; }
  .mshell[data-collapsed='true'] .mshell__logo-mark { display: none; }
  .mshell[data-collapsed='true'] .mshell__collapse-label { display: inline; }
  .mshell[data-collapsed='true'] .mshell__collapse { justify-content: flex-start; padding: 8px 10px; }
  .mshell[data-collapsed='true'] .mshell__foot { padding: 8px 0 0; }
  .mshell__navscrim {
    position: fixed;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgba(16, 24, 40, 0.42);
    z-index: 200;
    cursor: pointer;
  }
}
</style>
