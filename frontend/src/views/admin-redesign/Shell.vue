<template>
  <div class="mshell" :data-collapsed="collapsed ? 'true' : 'false'">
    <!-- 迷你侧边栏（导航 + 侧栏再设计展示） -->
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
      <!-- 命令面板入口（原顶栏「命令面板 Ctrl+K」迁入侧栏，C5 顶部搜索条形态；折叠态仅放大镜） -->
      <button type="button" class="mshell__search" @click="$emit('palette')">
        <span class="mshell__search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span>
        <span class="mshell__search-hint">命令面板</span>
        <span class="mshell__kbd">{{ kbdMod }}K</span>
      </button>
      <nav class="mshell__nav">
        <!-- 置顶独立入口（D5）：驾驶舱类页面渲染在分组上方，无组标题 -->
        <div v-if="pinnedScenes.length" class="mshell__pinned">
          <button
            v-for="item in pinnedScenes"
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
        </div>
        <section v-for="group in groupedScenes" :key="group.title" class="mshell__group" :data-open="isGroupOpen(group.title) ? 'true' : 'false'">
          <button
            type="button"
            class="mshell__group-head"
            :class="{ 'mshell__group-head--active': groupContainsCurrent(group.title) }"
            :aria-expanded="isGroupOpen(group.title)"
            :title="`${group.title}（${group.items.length} 项）`"
            @click="toggleGroup(group.title)"
          >
            <svg class="mshell__group-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="groupIcon(group.title)"></svg>
            <span class="mshell__group-name">{{ group.title }}</span>
            <span v-if="groupBadgeCount(group.title)" class="mshell__group-badge" :class="{ 'mshell__group-badge--alarm': groupHasAlarm(group.title) }" :title="groupBadgeTitle(group.title)">{{ groupBadgeCount(group.title) }}</span>
            <span class="mshell__group-arrow" aria-hidden="true">▸</span>
          </button>
          <div v-show="isGroupOpen(group.title)" class="mshell__group-body">
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
          </div>
        </section>
      </nav>
      <!-- 左侧底部：工具行（刷新/这是什么/密度/主题，原顶栏迁入）+ 用户区（admin + 退出） -->
      <footer class="mshell__foot">
        <div class="mshell__tools">
          <button
            type="button"
            class="mshell__tool"
            :disabled="liveLoading"
            :title="liveLoading ? '刷新中…' : '刷新真实数据'"
            :aria-label="liveLoading ? '刷新中…' : '刷新真实数据'"
            @click="refreshData"
          >
            <span class="mshell__refresh-icon" :class="{ 'is-spinning': liveLoading }"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></span>
          </button>
          <button type="button" class="mshell__tool" title="运营术语表 / 这是什么" aria-label="运营术语表 / 这是什么" @click="$emit('glossary')">
            <span class="mshell__tool-icon mshell__tool-icon--q">?</span>
          </button>
          <template v-if="release">
            <button
              type="button"
              class="mshell__tool"
              :title="density === 'compact' ? '当前紧凑密度 · 点击切换标准' : '当前标准密度 · 点击切换紧凑'"
              :aria-label="density === 'compact' ? '切换到标准密度' : '切换到紧凑密度'"
              @click="toggleDensity"
            >
              <span class="mshell__tool-icon" aria-hidden="true">{{ density === 'compact' ? '⊟' : '⊞' }}</span>
            </button>
            <button
              type="button"
              class="mshell__tool"
              :title="theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'"
              :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'"
              @click="toggleTheme"
            >
              <span class="mshell__tool-icon" aria-hidden="true">{{ theme === 'dark' ? '☀' : '☾' }}</span>
            </button>
          </template>
        </div>
        <template v-if="release">
          <div class="mshell__user">
            <span class="mshell__user-avatar" aria-hidden="true">{{ adminName.slice(0, 1).toUpperCase() }}</span>
            <span class="mshell__user-name">{{ adminName }}</span>
            <button type="button" class="mshell__logout" :title="'退出登录'" aria-label="退出登录" @click="logout">退出</button>
          </div>
        </template>
        <div class="mshell__brandline">
          <span class="mshell__foot-name">WenFlow Admin</span>
          <span class="mshell__foot-ver mono">v{{ version }}</span>
        </div>
      </footer>
    </aside>

    <!-- 主区 -->
    <div class="mshell__main">
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
import { MOCK_SCENES, type MockSceneDef } from './manifest'
import { liveNavBadges, alarmNavBadges, loadLiveData, liveLoading } from './live'
import { adminAuthApi, clearAdminSession } from '@/api/adminApi'
import { readTheme, writeTheme, applyDocumentTheme } from '@/utils/theme'
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

/* 徽章语义说明：红色=告警（近 7 天执行失败数，点击进入执行日志后自动平息）；
   其余浅蓝/中性=普通计数徽章。统一在 title 注明，避免红/蓝无解释并存 */
function badgeTitle(item: MockSceneDef): string {
  const count = badgeOf(item)
  if (!count) return ''
  if (alarmNavBadges.has(item.id)) {
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

/* ===== 组级折叠（对齐 AntD SubMenu 模式）：组标题点击展开/收起，
   当前页所在组自动展开；状态 localStorage 持久化 ===== */
/** 组标题 SVG 图标（lucide 风格线性图标，内联 path） */
const GROUP_ICONS: Record<string, string> = {
  学习者: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'Skill 管理': '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  运营: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  配置: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  观测: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
}
function groupIcon(title: string): string {
  return GROUP_ICONS[title] || ''
}
const GROUP_OPEN_KEY = 'wf_admin_group_open'
const openGroups = ref<Set<string>>(loadOpenGroups())
function loadOpenGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(GROUP_OPEN_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}
function persistOpenGroups() {
  try { localStorage.setItem(GROUP_OPEN_KEY, JSON.stringify([...openGroups.value])) } catch { /* ignore */ }
}
function isGroupOpen(title: string): boolean {
  if (collapsed.value) return true // 整栏折叠（64px 图标）时所有项可见
  return openGroups.value.has(title)
}
function toggleGroup(title: string) {
  const next = new Set(openGroups.value)
  if (next.has(title)) next.delete(title)
  else next.add(title)
  openGroups.value = next
  persistOpenGroups()
}
/** 当前页所在组：导航后自动展开（其他组保持用户状态） */
const groupContainsCurrent = (title: string) => groupedScenes.value.find((g) => g.title === title)?.items.some((i) => i.id === props.current) ?? false
watch(
  () => props.current,
  (cur: string) => {
    if (!cur || collapsed.value) return
    const g = groupedScenes.value.find((x) => x.items.some((i) => i.id === cur))
    if (g && !openGroups.value.has(g.title)) {
      openGroups.value = new Set(openGroups.value).add(g.title)
      persistOpenGroups()
    }
  },
  { immediate: true }
)
/* 告警平息口径：进入告警场景即视为已读（侧栏 go() 之外，TabBar/命令面板/深链直达也应平息；
   用 props.current watch 而非仅 Shell 点击，保证各导航路径一致） */
watch(
  () => props.current,
  (cur) => {
    const item = MOCK_SCENES.find((s) => s.id === cur)
    if (item && alarmNavBadges.has(item.id)) markAlarmRead(item)
  },
  { immediate: true }
)
/* 组徽章聚合：组内项徽章计数求和；含告警项时红色警示 */
const groupItems = (title: string) => groupedScenes.value.find((g) => g.title === title)?.items ?? []
const groupBadgeCount = (title: string) => {
  let total = 0
  for (const item of groupItems(title)) total += Number(badgeOf(item) || 0)
  return total || ''
}
const groupHasAlarm = (title: string) => groupItems(title).some((i) => isAlarmBadge(i))
function groupBadgeTitle(title: string): string {
  const items = groupItems(title)
  const parts = items.filter((i) => badgeOf(i)).map((i) => `${i.label} ${badgeOf(i)}`)
  return parts.join(' · ') || `${title}：计数`
}
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
  font-size: var(--mk-fs-13);
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
/* 置顶独立入口区（D5）：驾驶舱入口，与分组间用分隔线区分 */
.mshell__pinned {
  display: grid;
  gap: 2px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--mk-line, #e1e8f2);
  margin-bottom: 2px;
}
/* 置顶入口比组内子项略收高度：驾驶舱入口不再显高（用户反馈 2026-09-05） */
  .mshell__pinned .mshell__item { font-weight: 800; padding-top: 6px; padding-bottom: 6px; }
.mshell__group { display: grid; gap: 1px; }
/* 组头（可点击折叠）：组图标 + 组名 + 聚合徽章 + 箭头 */
.mshell__group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px 5px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-14);
  font-weight: 800;
  letter-spacing: 0;
  color: #2b3a55;
  cursor: pointer;
  border-radius: 8px;
  transition: color 0.12s ease, background 0.12s ease;
}
.mshell__group-head:hover { color: var(--mk-accent-deep, #1f57cc); background: rgba(90, 110, 140, 0.06); }
.mshell__group-head--active { color: var(--mk-accent-deep, #1f57cc); }
.mshell__group-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--mk-faint);
  transition: color 0.12s ease;
}
.mshell__group-head:hover .mshell__group-icon,
.mshell__group-head--active .mshell__group-icon { color: var(--mk-accent-deep, #1f57cc); }
.mshell__group-name { flex: 1; text-align: left; }
.mshell__group-badge {
  padding: 0 6px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-faint);
  font-size: var(--mk-fs-11);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
}
.mshell__group-badge--alarm {
  background: #fee2e2;
  color: #b91c1c;
  animation: mshell-alarm-pulse 1.6s ease-in-out infinite;
}
.mshell__group-arrow {
  font-size: 9px;
  opacity: 0.65;
  transition: transform 0.15s ease;
}
.mshell__group[data-open='true'] .mshell__group-arrow { transform: rotate(90deg); }
.mshell__group-body { display: grid; gap: 1px; }
/* 子项层级：组内子项相对组标题缩进，强化从属关系（对齐 AntD inline menu 缩进层级） */
.mshell__group-body .mshell__item { padding-left: 22px; }
.mshell__group-body .mshell__item .mshell__item-glyph {
  width: 20px;
  height: 20px;
  font-size: var(--mk-fs-11);
}
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
  font-size: var(--mk-fs-13);
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
  font-size: var(--mk-fs-11);
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

/* 左侧底部：工具行 + 用户区 + 品牌行（原顶栏功能迁入侧栏 C5） */
.mshell__foot {
  display: grid;
  gap: 8px;
  padding: 10px 10px 8px;
  border-top: 1px solid #eef2fa;
  flex-shrink: 0;
}
/* 工具行：刷新 / 这是什么 / 密度 / 主题，一行 icon 按钮（title 兜底语义，节省纵向空间） */
.mshell__tools {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-start;
}
.mshell__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #8a97ab;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.mshell__tool:hover { background: #eef2fa; color: var(--mk-blue, #2c63d0); }
.mshell__tool:disabled { opacity: 0.45; cursor: default; }
.mshell__tool-icon { font-size: var(--mk-fs-13); line-height: 1; }
.mshell__tool-icon--q {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--mk-blue, #2c63d0);
  color: #fff;
  font-size: var(--mk-fs-10);
  font-weight: 800;
}
.mshell__refresh-icon.is-spinning { animation: mshell-spin 0.8s linear infinite; }
@keyframes mshell-spin { to { transform: rotate(360deg); } }

/* 用户区：头像 + 用户名 + 退出 */
.mshell__user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 2px;
  border-top: 1px solid #f2f5fb;
}
.mshell__user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #dbe9ff;
  color: var(--mk-accent-deep, #1f57cc);
  font-size: var(--mk-fs-11);
  font-weight: 800;
  flex-shrink: 0;
}
.mshell__user-name {
  flex: 1;
  min-width: 0;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mshell__logout {
  border: 0;
  background: transparent;
  color: var(--mk-faint);
  font: inherit;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}
.mshell__logout:hover { background: rgba(220, 38, 38, 0.08); color: var(--mk-red, #dc2626); }

/* 品牌行弱化 */
.mshell__brandline {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-11);
}
.mshell__foot-name { font-weight: 700; color: #8a97ab; letter-spacing: 0.02em; }
.mshell__foot-ver {
  font-size: var(--mk-fs-11);
  color: #b4c0d2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mshell__kbd {
  padding: 1px 6px;
  border: 1px solid #e1e8f2;
  border-radius: 5px;
  background: #fafbfc;
  font-size: var(--mk-fs-11);
  font-weight: 700;
}

/* 侧栏搜索条（原顶栏「命令面板 Ctrl+K」迁入）：全宽搜索框形态，折叠态仅放大镜 */
.mshell__search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 10px 8px;
  padding: 7px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fafbfc;
  color: var(--mk-faint);
  font: inherit;
  font-size: var(--mk-fs-12);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
}
.mshell__search:hover { border-color: rgba(44, 99, 208, 0.45); background: #f3f7ff; }
.mshell__search-hint { white-space: nowrap; }

/* 主区：高度锁定在壳层（shell 100dvh）内，content 行 1fr 承接剩余高度 */
.mshell__main { display: grid; grid-template-rows: 1fr; min-width: 0; height: 100%; min-height: 0; }
/* 内容区：应用式布局的唯一滚动容器（侧栏/工具行固定，内容区内滚；
   列表页用 .mk-page--fill 让表格区内滚、分页器吸底。
   flex 列：TabBar（.mk-tabbar）固定吸顶，页面块（其余子元素）独占剩余高度并内滚，
   fill 页 height:100% 相对页面块计算 → 无 TabBar 38px 导致的整页多余滚动 */
.mshell__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.mshell__content > :not(.mk-tabbar) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 1440px 中间档：侧栏适度放大（幅度约为 2000 档一半） */
@media (min-width: 1440px) {
  .mshell { grid-template-columns: 240px minmax(0, 1fr); }
  .mshell__item { font-size: 13.5px; padding: 9px 11px; }
  .mshell__group-title { font-size: 11.5px; }
  .mshell__item-badge { font-size: 11.5px; }
  .mshell__search { font-size: 13px; }
  .mshell__logo-full { height: 58px; }
}

/* 大屏（2000+）：侧栏加宽、字号放大；2800+（4K）再升一档（zoom 之上叠加） */
@media (min-width: 1920px) {
  .mshell { grid-template-columns: 260px minmax(0, 1fr); }
  .mshell__item { font-size: 14px; padding: 10px 12px; }
  .mshell__group-title { font-size: 12px; }
  .mshell__item-badge { font-size: 12px; }
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
  .mshell__search { padding: 8px 12px; font-size: 13.5px; }
  .mshell__tool { width: 30px; height: 30px; }
  .mshell__user-avatar { width: 28px; height: 28px; }
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
  .mshell__search { padding: 10px 14px; font-size: 16px; }
  .mshell__tool { width: 36px; height: 36px; }
  .mshell__tool-icon { font-size: 16px; }
  .mshell__user-avatar { width: 32px; height: 32px; }
  .mshell__user-name { font-size: 14px; }
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
  .mshell__search { padding: 12px 16px; font-size: 18.5px; }
  .mshell__tool { width: 42px; height: 42px; }
  .mshell__tool-icon { font-size: 19px; }
  .mshell__user-avatar { width: 38px; height: 38px; }
  .mshell__user-name { font-size: 17px; }
}

/* 侧栏折叠（D5）：用户切换 data-collapsed 驱动 icon-only 模式；
   与 <860px 媒体查询兜底共用同一套隐藏规则 */
.mshell[data-collapsed='true'] { grid-template-columns: 64px minmax(0, 1fr); }
.mshell[data-collapsed='true'] .mshell__item-label,
.mshell[data-collapsed='true'] .mshell__item-badge,
.mshell[data-collapsed='true'] .mshell__group-head { display: none; }
/* 折叠态：搜索条收为仅放大镜 icon 方块；工具/用户区收为 icon 列 */
.mshell[data-collapsed='true'] .mshell__search {
  margin: 2px 8px 8px;
  padding: 0;
  width: 34px;
  height: 30px;
  justify-content: center;
}
.mshell[data-collapsed='true'] .mshell__search-hint,
.mshell[data-collapsed='true'] .mshell__search .mshell__kbd { display: none; }
.mshell[data-collapsed='true'] .mshell__foot {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 10px 8px 8px;
}
.mshell[data-collapsed='true'] .mshell__tools {
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.mshell[data-collapsed='true'] .mshell__user { flex-direction: column; gap: 4px; justify-content: center; padding: 6px 0; }
.mshell[data-collapsed='true'] .mshell__user-name { display: none; }
.mshell[data-collapsed='true'] .mshell__logout { padding: 4px; }
.mshell[data-collapsed='true'] .mshell__brandline { display: none; }
.mshell[data-collapsed='true'] .mshell__item { justify-content: center; padding: 4px 0; }
.mshell[data-collapsed='true'] .mshell__group-body .mshell__item { padding-left: 0; }
.mshell[data-collapsed='true'] .mshell__item-glyph { display: inline-flex; }
.mshell[data-collapsed='true'] .mshell__logo-full { display: none; }
.mshell[data-collapsed='true'] .mshell__logo-mark { display: block; }
.mshell[data-collapsed='true'] .mshell__brand { justify-content: center; padding: 2px 0 0; }
.mshell[data-collapsed='true'] .mshell__collapse { position: absolute; right: -14px; top: 18px; }
.mshell[data-collapsed='true'] .mshell__pinned { justify-content: center; padding-bottom: 8px; border-bottom-color: #232f45; }
.mshell[data-collapsed='true'] .mshell__group { margin-top: 10px; }

/* 折叠按钮（展开态右上角，悬停显示 tooltip 由 title 提供） */
.mshell__collapse {
  border: 1px solid var(--mk-line, #e1e8f2);
  background: var(--mk-surface, #fff);
  color: var(--mk-muted, #5b6577);
  width: 24px; height: 24px;
  border-radius: 7px;
  font-size: var(--mk-fs-12); line-height: 1;
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
  .mshell__group-head { display: none; }
  /* 窄屏图标栏：搜索/工具/用户区收为 icon（命令面板入口在侧栏搜索条，不能整体隐藏） */
  .mshell__search {
    margin: 2px 8px 8px;
    padding: 0;
    width: 34px;
    height: 30px;
    justify-content: center;
  }
  .mshell__search-hint,
  .mshell__search .mshell__kbd { display: none; }
  .mshell__foot {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 10px 8px 8px;
  }
  .mshell__tools { flex-direction: column; gap: 6px; align-items: center; }
  .mshell__user { flex-direction: column; gap: 4px; justify-content: center; padding: 6px 0; }
  .mshell__user-name { display: none; }
  .mshell__logout { padding: 4px; }
  .mshell__brandline { display: none; }
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
  .mshell { background: #0f1624; color: #e6edf7; }
  .mshell__side { background: #131b2a; border-right-color: #232f45; }
  .mshell__pinned { border-bottom-color: #232f45; }
  .mshell__group-head { color: #c9d6e8; }
  .mshell__group-head:hover { color: #7aa2ff; background: rgba(120, 140, 170, 0.08); }
  .mshell__group-head--active { color: #7aa2ff; }
  .mshell__group-icon { color: #6b7c96; }
  .mshell__group-head:hover .mshell__group-icon,
  .mshell__group-head--active .mshell__group-icon { color: #7aa2ff; }
  .mshell__group-badge { background: #1d2739; color: #6b7c96; }
  .mshell__group-badge--alarm { background: rgba(220, 38, 38, 0.18); color: #fca5a5; }
  .mshell__item-badge--alarm { background: rgba(220, 38, 38, 0.18); color: #fca5a5; }
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
  .mshell__collapse { background: #131b2a; border-color: #232f45; color: #9fb0c8; }
  .mshell__collapse:hover { color: #7aa2ff; border-color: rgba(91, 141, 239, 0.4); }
  .mshell__search { background: #131b2a; border-color: #232f45; color: #6b7c96; }
  .mshell__search:hover { background: #1b2740; border-color: rgba(91, 141, 239, 0.4); }
  .mshell__kbd { background: #1d2739; border-color: #2a3850; }
  .mshell__tool { color: #6b7c96; }
  .mshell__tool:hover { background: #1b2740; color: #7aa2ff; }
  .mshell__tool-icon--q { background: var(--mk-blue); }
  .mshell__user { border-top-color: #1f2a3d; }
  .mshell__user-avatar { background: #1d2739; color: #7aa2ff; }
  .mshell__user-name { color: #e6edf7; }
  .mshell__logout { color: #64748b; }
  .mshell__logout:hover { background: rgba(220, 38, 38, 0.14); color: #f87171; }
}
</style>
