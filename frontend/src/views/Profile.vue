<template>
  <CapabilityShell title="账户">
    <div class="profile-page">
      <div v-if="!profileLoading && profileLoadError" class="uc-card">
        <div class="uc-errorbar" role="alert">
          {{ profileLoadError }}
          <button type="button" class="uc-errorbar__retry" @click="loadUserProfile">重新加载</button>
        </div>
      </div>

      <div v-if="profileLoading" class="uc-loading">
        <span class="uc-spinner"></span>
        加载账户信息…
      </div>

      <template v-if="!profileLoading && !profileLoadError">
        <!-- 资料卡（原型 2026-09-30 wf-profile）：头像 + 名字 + 身份行，XP 收进身份行不再单独立卡 -->
        <article class="uc-card profile-hero">
          <div class="profile-identity">
            <span class="profile-avatar" aria-hidden="true">{{ user.name?.charAt(0) || '用' }}</span>
            <div class="profile-identity__main">
              <div class="profile-name-row">
                <template v-if="editingName">
                  <input
                    v-model="nameDraft"
                    class="uc-field__input profile-name-input"
                    maxlength="64"
                    placeholder="输入新用户名"
                    aria-label="用户名"
                    @keyup.enter="handleSaveName"
                  />
                  <button type="button" class="uc-btn uc-btn--primary uc-btn--sm" :disabled="nameSubmitting" @click="handleSaveName">
                    {{ nameSubmitting ? '保存中…' : '保存' }}
                  </button>
                  <button type="button" class="uc-btn uc-btn--sm" :disabled="nameSubmitting" @click="cancelEditName">取消</button>
                </template>
                <template v-else>
                  <h2>{{ user.name || '未命名用户' }}</h2>
                  <button type="button" class="uc-btn uc-btn--link" @click="startEditName">编辑</button>
                </template>
              </div>
              <span class="profile-identity__role">学习者 · Lv.{{ user.level || 1 }} · {{ user.xp || 0 }} XP</span>
              <p class="profile-meta">{{ user.email || '未绑定邮箱' }} · 注册于 {{ formatDateShort(user.createdAt) }} · 最近登录 {{ formatDateShort(user.lastLoginAt) }}</p>
            </div>
          </div>
        </article>

        <!-- 学习概览 KPI（原型 wf-kpis）：连续天数（会话推算，与学习状态页同口径）+ 成就解锁（轻请求）+ 已掌握概念（图谱 stability） -->
        <div class="profile-kpis" role="list" aria-label="学习概览">
          <div class="profile-kpi" role="listitem">
            <strong>{{ kpi.streak ?? '—' }}</strong>
            <span>连续天数</span>
          </div>
          <div class="profile-kpi" role="listitem">
            <strong>{{ kpi.achievements ?? '—' }}</strong>
            <span>已解锁成就</span>
          </div>
          <div class="profile-kpi" role="listitem">
            <strong>{{ kpi.mastery ?? '—' }}</strong>
            <span>已掌握知识点</span>
          </div>
        </div>

        <!-- 快捷入口列表卡（原型 wf-list 同构） -->
        <section class="uc-card">
          <ul class="profile-menu">
            <li>
              <router-link to="/user/achievements" class="profile-menu__item">
                <Trophy :size="18" :stroke-width="1.75" aria-hidden="true" />
                <span>我的成就</span>
                <span class="profile-menu__chev" aria-hidden="true">›</span>
              </router-link>
            </li>
            <li>
              <router-link to="/user/learning-history" class="profile-menu__item">
                <History :size="18" :stroke-width="1.75" aria-hidden="true" />
                <span>学习历史</span>
                <span class="profile-menu__chev" aria-hidden="true">›</span>
              </router-link>
            </li>
            <li>
              <router-link to="/user/settings" class="profile-menu__item">
                <Settings :size="18" :stroke-width="1.75" aria-hidden="true" />
                <span>设置</span>
                <span class="profile-menu__chev" aria-hidden="true">›</span>
              </router-link>
            </li>
          </ul>
        </section>

        <!-- 「修改密码」「注销账号」两张卡已整体迁到 views/user/Settings.vue（设置页的
             「账号安全」分区）：原型账户段只有 资料卡 + 3 KPI + 快捷入口三块（2038-2069）。 -->
        </template>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { History, Settings, Trophy } from 'lucide-vue-next'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
import { toast } from '@/utils/toast'
import request from '@/utils/api'
import { learningAPI } from '@/api/learning'
import { unwrapArray } from '@/views/v2/unwrap'
import { computeStreakDays } from '@/views/v2/streak'
import { localDateKeyFromIso } from '@/utils/date'
import { useUserStore } from '../stores/user'
import '@/components/user/uc.css'

const userStore = useUserStore()

/* ---------- 学习概览 KPI（原型 wf-kpis 三卡） ----------
   连续天数走全站唯一口径 computeStreakDays（views/v2/streak.ts，P1-1 2026-10-04）：
   原先直读 users.streakDays 库字段快照（无实时刷新机制），与学习状态页的实时推算
   跨页打架（同账号同天 1 vs 0），现拉会话按同一算法推算；成就与概念掌握各发一个
   轻请求，失败静默显示「—」，不阻塞资料卡渲染。 */
const kpi = ref<{ streak?: number; achievements?: number; mastery?: number }>({})

async function loadKpis() {
  try {
    const res = await request.get('/users/me/sessions', { params: { limit: 500 } })
    const list = unwrapArray<{ startTime?: string; durationMinutes?: number }>(res)
    const minutesByDate = new Map<string, number>()
    for (const s of list) {
      const key = localDateKeyFromIso(typeof s.startTime === 'string' ? s.startTime : null)
      if (!key) continue
      minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + (typeof s.durationMinutes === 'number' ? s.durationMinutes : 0))
    }
    kpi.value.streak = computeStreakDays(minutesByDate)
  } catch { /* 静默：KPI 缺数好过卡报错 */ }
  try {
    const res = await request.get('/achievements/all')
    const items = unwrapArray<{ unlocked?: boolean }>(res)
    kpi.value.achievements = items.filter((a) => a.unlocked).length
  } catch { /* 静默：KPI 缺数好过卡报错 */ }
  try {
    const graph = (await learningAPI.getConceptGraph()) as { nodes?: Array<{ stability?: string | null }> } | null
    const nodes = Array.isArray(graph?.nodes) ? graph!.nodes! : []
    kpi.value.mastery = nodes.filter((n) => n.stability === 'stable').length
  } catch { /* 静默 */ }
}

/* ---------- 修改密码 / 注销账号 ----------
   两张卡（含本文件原「账号安全双栏」布局）已整体迁到 views/user/Settings.vue：
   原型账户段（index.html 2038-2069）只保留资料卡 + 3 KPI + 快捷入口。 */

const user = ref({
  name: '',
  email: '',
  xp: 0,
  level: 1,
  role: 'user',
  createdAt: '',
  lastLoginAt: null as string | null
})
const profileLoading = ref(true)
const profileLoadError = ref('')
// 用户名编辑
const editingName = ref(false)
const nameDraft = ref('')
const nameSubmitting = ref(false)
onMounted(async () => {
  await loadUserProfile()
  void loadKpis()
})

function formatDateShort(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getErrorMessage(error: any, fallback: string) {
  return error?.response?.data?.error?.message || error?.response?.data?.error || error?.message || fallback
}

async function loadUserProfile() {
  profileLoading.value = true
  profileLoadError.value = ''
  try {
    await userStore.fetchProfile()
    if (!userStore.user) throw new Error('未返回账户信息')
    user.value = {
      name: userStore.user.name,
      email: userStore.user.email,
      xp: userStore.user.xp,
      level: userStore.user.level,
      role: (userStore.user as any).role || 'user',
      createdAt: (userStore.user as any).createdAt || '',
      lastLoginAt: (userStore.user as any).lastLoginAt || null
    }
  } catch (error: any) {
    profileLoadError.value = getErrorMessage(error, '无法读取账户信息，请稍后重试。')
  } finally {
    profileLoading.value = false
  }
}

// ---- 用户名编辑 ----
function startEditName() {
  nameDraft.value = user.value.name || ''
  editingName.value = true
}

function cancelEditName() {
  editingName.value = false
  nameDraft.value = ''
}

async function handleSaveName() {
  const trimmed = nameDraft.value.trim()
  if (!trimmed) {
    toast.error('用户名不能为空')
    return
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(trimmed)) {
    toast.error('用户名仅支持字母、数字、下划线和连字符')
    return
  }
  nameSubmitting.value = true
  try {
    const updated = await userStore.updateProfile({ name: trimmed })
    user.value.name = updated.name || trimmed
    editingName.value = false
    toast.success('用户名已更新')
  } catch (error: any) {
    toast.error(getErrorMessage(error, '更新用户名失败'))
  } finally {
    nameSubmitting.value = false
  }
}
</script>

<style scoped>
.profile-page {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.profile-hero {
  padding: 20px 24px;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 14px;
}

.profile-avatar {
  /* 原型 wf-profile__av：54px 圆 + blue 12% 底 + blue-deep 字（去旧 96px 大头像盘） */
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--blue, #2f6ae0) 12%, transparent);
  color: var(--blue-deep);
  font-size: 21px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.profile-identity__main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
}

.profile-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.profile-name-row h2 {
  margin: 0;
  /* 原型 17px：名字是资料卡身份行，不是页面级展示字 */
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.profile-name-input {
  width: 220px;
  max-width: 100%;
}

/* 身份行（原型：学习者 · Lv.4 · 240 XP） */
.profile-identity__role {
  font-size: 12.5px;
  color: var(--faint);
}

/* 邮箱/注册时间/最近登录：原型账户段没有这一行（2044 只有身份行），
   属本仓多出的信息——降级为 12px faint 弱化小字，压在身份行下方不抢层级。 */
.profile-meta {
  margin: 0;
  color: var(--faint);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 学习概览 KPI（原型 wf-kpis/wf-kpi 三卡）：
   gap 12 → 9 对齐原型 .wf-kpis 的 gap（原型 748 行） */
.profile-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.profile-kpi {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal, 16px);
  box-shadow: var(--shadow-sm);
  padding: 13px 8px;
  display: grid;
  justify-items: center;
  gap: 2px;
  text-align: center;
}

.profile-kpi strong {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.profile-kpi span {
  /* 原型为 11px，本仓门禁下限 12px（--mk-fs-micro 档即 12px 起） */
  font-size: 12px;
  color: var(--faint);
}

/* 快捷入口列表（原型 wf-list：行 52px + 行顶分割线 + 尾部 chevron） */
.profile-menu {
  list-style: none;
  margin: 0;
  padding: 4px 18px;
}

.profile-menu__item {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 52px;
  padding: 4px 2px;
  border-top: 1px solid var(--line);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
  transition: color 0.14s ease;
}

.profile-menu li:first-child .profile-menu__item {
  border-top: 0;
}

.profile-menu__item svg {
  color: var(--muted);
  flex: none;
}

.profile-menu__item:hover {
  color: var(--blue-deep);
}

.profile-menu__chev {
  margin-left: auto;
  font-size: 18px;
  color: var(--faint);
}

@media (max-width: 1100px) {
  .profile-identity {
    flex-direction: column;
    align-items: flex-start;
  }

  .profile-kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>

<style scoped>
/* 移动端重新排版（用户："个人中心也是很大，要针对移动端重新设计大小"）。
   390 下资料卡 354px：资料卡改回横向（头像 48 + 姓名行），KPI 三卡保持一行紧凑。
   放文件末尾：基础规则在前面的块里，同权重下后出现者胜。 */
@media (max-width: 1100px) {
  .profile-hero {
    padding: 14px;
  }

  .profile-identity {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  /* 头像 56 → 48：56px 在 390 下比昵称行还高一头，hero 卡的主要开销 */
  .profile-avatar {
    width: 48px;
    height: 48px;
    font-size: 20px;
  }

  .profile-name-row {
    gap: 6px;
  }

  /* 昵称 17 → 16：页标题 h1 已收到 18，昵称再同档分不出主次 */
  .profile-name-row h2 {
    font-size: 16px;
  }

  .profile-meta {
    white-space: normal;
  }

  .profile-kpis {
    gap: 8px;
  }

  .profile-kpi {
    padding: 10px 6px;
  }

  .profile-kpi strong {
    font-size: 17px;
  }

  /* 资料卡再收一档（2026-09-24 反馈「个人中心五个选项里的内容都偏大」）：
     390 下 hero 卡主要开销是内边距与数字。横向跟 .uc-card 的 14px 对齐
     （2026-09-26 对齐走查）：原来是 12px，同页堆叠时内容左缘比下面几张卡左 2px，
     一列卡看着就是「没对齐」。 */
  .profile-hero { padding: 12px 14px; }
  .profile-kpi { padding: 8px 6px; }
  .profile-kpi strong { font-size: 16px; }
}
</style>
