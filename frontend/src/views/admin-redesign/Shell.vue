<template>
  <div class="mshell">
    <!-- 迷你侧边栏（同时是导航与「侧栏再设计」演示） -->
    <aside class="mshell__side">
      <div class="mshell__brand">
        <!-- 展开：长方形全 logo（图标 + 问流）；折叠：正方形图标 -->
        <img src="/logo.png" alt="问流" class="mshell__logo-full" />
        <img src="/favicon.png" alt="问流" class="mshell__logo-mark" />
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
            <span v-if="badgeOf(item)" class="mshell__item-badge" :class="{ 'mshell__item-badge--alarm': isAlarmBadge(item) }">{{ badgeOf(item) }}</span>
          </button>
        </section>
      </nav>
      <div class="mshell__foot">
        <span class="mshell__kbd">⌘K</span>
        <span>命令面板</span>
      </div>
    </aside>

    <!-- 主区 -->
    <div class="mshell__main">
      <header class="mshell__topbar">
        <div class="mshell__crumbs">
          <span class="mshell__crumb-group">{{ currentScene?.group }}</span>
          <span class="mshell__crumb-sep">/</span>
          <strong>{{ currentScene?.label }}</strong>
          <template v-if="crumb">
            <span class="mshell__crumb-sep">/</span>
            <span class="mshell__crumb-sub">{{ crumb }}</span>
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
            <span class="mshell__refresh-icon" :class="{ 'is-spinning': liveLoading }">↻</span>
            <span class="mshell__refresh-label">{{ liveLoading ? '刷新中' : '刷新' }}</span>
          </button>
          <button type="button" class="mshell__search" @click="$emit('palette')">
            <span class="mshell__search-icon">⌕</span>
            <span class="mshell__search-hint">命令面板</span>
            <span class="mshell__kbd">⌘K</span>
          </button>
          <template v-if="release">
            <span class="mshell__admin">{{ adminName }}</span>
            <button type="button" class="mshell__logout" @click="logout">退出</button>
          </template>
        </div>
      </header>
      <main class="mshell__content">
        <slot />
      </main>
      <footer class="mshell__footer">
        <div class="mshell__footer-left">
          <img src="/favicon.png" alt="" class="mshell__footer-logo" />
          <span class="mshell__footer-name">WenFlow Admin</span>
          <span class="mshell__footer-ver">v{{ version }}</span>
        </div>
        <div class="mshell__footer-right">
          <span class="mshell__footer-source" :class="dataSource === 'live' ? 'mshell__footer-source--live' : ''">
            <i class="mshell__footer-dot" aria-hidden="true"></i>{{ sourceLabel }}
          </span>
          <span class="mshell__footer-sep">·</span>
          <span>© {{ year }}</span>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MOCK_SCENES, type MockSceneDef } from './manifest'
import { dataSource } from './store'
import { liveNavBadges, alarmNavBadges, loadLiveData, liveLoading } from './live'
import { adminAuthApi } from '@/api/adminApi'
import { version as appVersion } from '../../../package.json'

const props = defineProps<{ current: string; crumb?: string; release?: boolean }>()
const emit = defineEmits<{ (e: 'navigate', id: string): void; (e: 'palette'): void }>()

const version = appVersion
const year = new Date().getFullYear()

const sourceLabel = computed(() => (dataSource.value === 'live' ? '真实数据' : '演示数据'))

function refreshData() {
  if (liveLoading.value) return
  void loadLiveData()
}

function badgeOf(item: MockSceneDef): string {
  if (dataSource.value === 'live') {
    return liveNavBadges.value[item.id] || ''
  }
  return item.badge || ''
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
  } finally {
    window.location.replace('/admin/login')
  }
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
  min-height: 720px;
  background: #f6f8fc;
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
  gap: 8px;
  padding: 2px 8px 0;
}
.mshell__logo-full {
  height: 32px;
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
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #8492ab;
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
  font-size: 12.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: 0.12s ease;
}
.mshell__item:hover { background: #f6f9ff; color: #1a2a44; }
.mshell__item--active {
  background: #eef5ff;
  color: #1f57cc;
  box-shadow: inset 3px 0 0 #3478f6;
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
.mshell__item--active .mshell__item-glyph { background: #dbe9ff; color: #1f57cc; }
.mshell__item-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef2fa;
  color: #8492ab;
  font-size: 10.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.mshell__item--active .mshell__item-badge { background: #dbe9ff; color: #1f57cc; }
.mshell__item-badge--alarm {
  background: #fee2e2;
  color: #dc2626;
  animation: mshell-alarm-pulse 1.6s ease-in-out infinite;
}
@keyframes mshell-alarm-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.32); }
  50% { box-shadow: 0 0 0 4px rgba(220, 38, 38, 0); }
}

.mshell__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid #eef2fa;
  color: #8492ab;
  font-size: 11.5px;
}
.mshell__kbd {
  padding: 1px 6px;
  border: 1px solid #e1e8f2;
  border-radius: 5px;
  background: #fafbfc;
  font-size: 10.5px;
  font-weight: 700;
}

/* 主区 */
.mshell__main { display: grid; grid-template-rows: auto 1fr auto; min-width: 0; }
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
.mshell__crumb-group { color: #8492ab; font-size: 12px; font-weight: 600; }
.mshell__crumb-sep { color: #c3cede; margin: 0 2px; }
.mshell__crumb-sub {
  color: #3478f6;
  font-size: 12px;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mshell__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fafbfc;
  color: #8492ab;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.mshell__search-hint { white-space: nowrap; }
.mshell__content { min-width: 0; }

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
.mshell__refresh:hover:not(:disabled) { color: #3478f6; border-color: rgba(52, 120, 246, 0.4); }
.mshell__refresh:disabled { cursor: default; color: #8492ab; }
.mshell__refresh-icon { display: inline-block; font-size: 13px; line-height: 1; }
.mshell__refresh-icon.is-spinning { animation: mshell-spin 0.9s linear infinite; }
@keyframes mshell-spin { to { transform: rotate(360deg); } }
.mshell__admin { font-size: 12px; font-weight: 700; color: #1a2a44; }
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

/* 页脚 */
.mshell__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-top: 1px solid #e1e8f2;
  background: #fff;
  color: #8492ab;
  font-size: 12px;
}
.mshell__footer-left,
.mshell__footer-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.mshell__footer-logo { height: 18px; width: 18px; border-radius: 5px; object-fit: contain; }
.mshell__footer-name { font-weight: 700; color: #5b6577; }
.mshell__footer-ver {
  font-size: 11px; color: #b3bfd0;
  font-variant-numeric: tabular-nums;
  padding: 1px 7px; border-radius: 999px;
  background: #f1f5fb; border: 1px solid #e3e9f4;
}
.mshell__footer-source { display: inline-flex; align-items: center; gap: 6px; }
.mshell__footer-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #c3cede;
}
.mshell__footer-source--live { color: #218a56; }
.mshell__footer-source--live .mshell__footer-dot { background: var(--green, #31b16f); }
.mshell__footer-sep { color: #c3cede; }

/* 大屏（2000+）：侧栏加宽、字号放大；2800+（4K）再升一档（zoom 之上叠加） */
@media (min-width: 2000px) {
  .mshell {
    grid-template-columns: 280px minmax(0, 1fr);
  }
  .mshell__side { padding: 18px 14px 14px; gap: 18px; }
  .mshell__logo-full { height: 48px; }
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
  .mshell__logo-full { height: 60px; }
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
  .mshell__logo-full { height: 72px; }
  .mshell__group-title { font-size: 17.5px; padding: 0 16px 9px; }
  .mshell__item { font-size: 20px; padding: 16px 16px; gap: 12px; }
  .mshell__item-badge { font-size: 16.5px; padding: 4px 12px; }
  .mshell__foot { font-size: 17.5px; padding: 14px 16px; }
  .mshell__topbar { min-height: 92px; padding: 12px 32px; }
  .mshell__crumb-group,
  .mshell__crumb-sub { font-size: 18.5px; }
  .mshell__search { padding: 12px 16px; font-size: 18.5px; }
}

@media (max-width: 860px) {
  .mshell { grid-template-columns: 64px minmax(0, 1fr); }
  .mshell__item-label,
  .mshell__item-badge,
  .mshell__group-title,
  .mshell__foot span:last-child,
  .mshell__search { display: none; }
  /* 窄屏图标栏：显示单字图标，悬停提示全名 */
  .mshell__item { justify-content: center; padding: 4px 0; }
  .mshell__item-glyph { display: inline-flex; }

  /* 折叠：长方形 logo 换正方形图标 */
  .mshell__logo-full { display: none; }
  .mshell__logo-mark { display: block; }
  .mshell__brand { justify-content: center; padding: 2px 0 0; }
}
</style>
