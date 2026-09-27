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
        <!-- 资料 hero 卡：横贯全宽 -->
        <article class="uc-card profile-hero">
          <div class="profile-identity">
            <div class="profile-avatar">{{ user.name?.charAt(0) || '用' }}</div>
            <div class="profile-identity__main">
              <div class="profile-name-row">
                <template v-if="editingName">
                  <input
                    v-model="nameDraft"
                    class="uc-field__input profile-name-input"
                    maxlength="64"
                    placeholder="输入新用户名"
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
              <p class="profile-email">{{ user.email || '未绑定邮箱' }}</p>
              <p class="profile-meta">注册于 {{ formatDateShort(user.createdAt) }} · 最近登录 {{ formatDateShort(user.lastLoginAt) }}</p>
            </div>
            <div class="profile-stats">
              <div class="stat-card">
                <span>经验值（XP）</span>
                <strong>{{ user.xp || 0 }}</strong>
              </div>
              <div class="stat-card">
                <span>等级</span>
                <strong>{{ user.level || 1 }} 级</strong>
              </div>
            </div>
          </div>
        </article>

        <!-- 账号安全双栏（2026-09-27 区域利用率重排）：改密主栏 + 注销危区右栏。
             此前两张卡各自整行、内容只占左半屏，右侧一半全是死空白。 -->
        <div class="profile-cols">
          <article class="uc-card uc-card--pwd">
            <div class="uc-card__head">
              <div>
                <h3>修改密码</h3>
                <p>定期更换密码，保障账号安全</p>
              </div>
            </div>
            <div class="pwd-grid">
              <label class="uc-field pwd-field pwd-field--wide">
                <span class="uc-field__label">当前密码</span>
                <input v-model="pwdForm.oldPassword" type="password" class="uc-field__input" placeholder="输入当前密码" />
              </label>
              <label class="uc-field pwd-field">
                <span class="uc-field__label">新密码</span>
                <input v-model="pwdForm.newPassword" type="password" class="uc-field__input" placeholder="至少 8 位，含字母和数字" />
              </label>
              <label class="uc-field pwd-field">
                <span class="uc-field__label">确认新密码</span>
                <input v-model="pwdForm.confirmPassword" type="password" class="uc-field__input" placeholder="再输入一次" />
              </label>
            </div>
            <div class="uc-card__foot">
              <button type="button" class="uc-btn uc-btn--primary" :disabled="!pwdCanSubmit || pwdSubmitting" @click="handleChangePassword">
                {{ pwdSubmitting ? '更新中…' : '更新密码' }}
              </button>
            </div>
          </article>

          <!-- 危险操作：注销 -->
          <article class="uc-card uc-card--danger">
            <div class="uc-card__head">
              <div>
                <h3>注销账号</h3>
                <p>注销后账号将被标记为已删除，学习数据将无法继续访问；此操作不可自助撤销（可联系管理员恢复）。</p>
              </div>
            </div>
            <div class="danger-form">
              <input v-model="deactivatePassword" type="password" class="uc-field__input" placeholder="输入当前密码确认注销" @keyup.enter="handleDeactivate" />
              <button type="button" class="uc-btn uc-btn--danger" :disabled="deactivating" @click="handleDeactivate">
                {{ deactivating ? '注销中…' : '注销账号' }}
              </button>
            </div>
          </article>
        </div>
        </template>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
import { askConfirm, doneConfirm, failConfirm } from '@/views/admin-redesign/useConfirm'
import { toast } from '@/utils/toast'
import request from '@/utils/api'
import { useUserStore } from '../stores/user'
import '@/components/user/uc.css'

const router = useRouter()
const userStore = useUserStore()
const api = request

/* ---------- 修改密码 ---------- */
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const pwdSubmitting = ref(false)
const pwdCanSubmit = computed(() =>
  pwdForm.oldPassword.length > 0 && pwdForm.newPassword.length >= 8 && pwdForm.confirmPassword.length > 0
)

async function handleChangePassword() {
  if (pwdSubmitting.value) return
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    toast.error('两次输入的新密码不一致')
    return
  }
  if (!/[a-zA-Z]/.test(pwdForm.newPassword) || !/[0-9]/.test(pwdForm.newPassword)) {
    toast.error('新密码需同时包含字母和数字')
    return
  }
  pwdSubmitting.value = true
  try {
    await request.post('/auth/change-password', {
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword
    })
    toast.success('密码已更新，下次登录请使用新密码')
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
  } catch (e: any) {
    toast.error(e?.message || e?.response?.data?.error?.message || '修改失败，请稍后再试')
  } finally {
    pwdSubmitting.value = false
  }
}

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
// 注销
const deactivatePassword = ref('')
const deactivating = ref(false)
onMounted(async () => {
  await loadUserProfile()
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

// ---- 注销 ----
async function handleDeactivate() {
  if (!deactivatePassword.value) {
    toast.error('请输入当前密码以确认注销')
    return
  }
  const ok = await askConfirm({
    title: '注销账号',
    message: '注销后账号将被标记为已删除，学习数据将无法继续访问；此操作不可自助撤销。确定注销吗？',
    confirmText: '确认注销',
    danger: true,
    busy: true
  })
  if (!ok) return
  deactivating.value = true
  try {
    await api.post('/users/me/deactivate', { password: deactivatePassword.value })
    await userStore.logout()
    toast.success('账号已注销')
    await router.replace('/login')
    doneConfirm()
  } catch (error: any) {
    toast.error(getErrorMessage(error, '注销失败，请稍后重试'))
    failConfirm()
  } finally {
    deactivating.value = false
    deactivatePassword.value = ''
  }
}
</script>

<style scoped>
.profile-page {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.profile-content {
  display: grid;
  gap: 16px;
  min-height: 200px;
  min-width: 0;
}

.profile-hero {
  padding: 24px 26px;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 18px;
}

.profile-avatar {
  width: 96px;
  height: 96px;
  border-radius: 999px;
  /* 去蓝紫跨色相渐变与蓝色光晕（2026-09-26 视觉走查）：与 V2Nav 头像同一扁平语言
     （blue 12% 底 + blue-deep 字），暗色随 token 翻转 */
  background: color-mix(in srgb, var(--blue, #3478f6) 12%, transparent);
  color: var(--blue-deep, #1f57cc);
  /* 34 → 24（2026-09-27 桌面刻度统一）：这是头像圆里的字母，不是页面标题 */
  font-size: 24px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--blue) 10%, transparent);
}

.profile-identity__main {
  min-width: 0;
  flex: 1;
}

.profile-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.profile-name-row h2 {
  margin: 0;
  /* 24 → 20：用户名是页面级标题，不是展示字 */
  font-size: 20px;
  letter-spacing: -0.01em;
}

.profile-name-input {
  width: 220px;
  max-width: 100%;
}

.profile-email {
  margin: 5px 0 0;
  color: var(--muted, #5b6577);
  font-size: 14px;
}

.profile-meta {
  margin: 4px 0 0;
  color: var(--faint, #67758f);
  font-size: 12px;
}

.profile-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  flex: 0 1 auto;
  min-width: 0;
}

/* 账号安全双栏（2026-09-27）：改密主栏 1.7fr + 注销危区 1fr，
   两张卡等高（默认 stretch），改密按钮由 foot margin-top:auto 压到同一底线 */
.profile-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: 16px;
  min-width: 0;
}

@media (max-width: 1100px) {
  .profile-cols {
    grid-template-columns: 1fr;
  }
}

/* 修改密码卡：列内与注销卡等高，按钮贴底 */
.uc-card--pwd {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 卡脚上留白：桌面 16px；移动端收到 12px（见本文件移动块里的覆盖——这里不能直接改，
   否则 1440 也吃到了）。 */
.uc-card--pwd .uc-card__foot {
  margin-top: auto;
  padding-top: 16px;
}

.uc-card--pwd .pwd-grid {
  flex: 0 0 auto;
  align-content: start;
}

@media (max-width: 1100px) {
  .profile-identity {
    flex-direction: column;
    align-items: flex-start;
  }

  .profile-stats {
    width: 100%;
  }
}

.stat-card {
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--line, #e3e9f4);
  background: var(--canvas, #f3f6fb);
  display: grid;
  gap: 6px;
  min-width: 132px;
  overflow: hidden;
}

.stat-card span {
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #67758f);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-card strong {
  /* 22 → 20：统计卡数字档 */
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink, #172033);
  overflow-wrap: anywhere;
}

.pwd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.pwd-field--wide {
  grid-column: 1 / -1;
}

@media (max-width: 560px) {
  .pwd-grid {
    grid-template-columns: 1fr;
  }
}

.uc-card__foot {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.uc-card--danger {
  border-color: rgba(239, 117, 120, 0.35);
}

.danger-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.danger-form .uc-field__input {
  max-width: 320px;
}

.confirm-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink, #172033);
}
</style>

<style scoped>
/* 移动端重新排版（用户："个人中心也是很大，要针对移动端重新设计大小"）。
   390 下资料卡 354px：≤900 的 `.profile-identity` 改成了竖排（头像 96 独占一行），
   加两栏统计卡全宽，一张"我是谁"的卡就吃掉半屏。这里改回横向：
   头像 56 + 姓名/邮箱/注册信息同一行，两张统计卡换成下一行的紧凑横条。

   放文件末尾：.profile-avatar / .profile-hero / .stat-card 的基础规则在前面的块里，
   而 ≤900 / ≤560 / ≤640 三个媒体块也在中间，同权重下后出现者胜。 */
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
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 10%, transparent);
  }

  .profile-name-row {
    gap: 6px;
  }

  /* 昵称 18 → 16：页标题 h1 已收到 18，昵称再同档分不出主次 */
  .profile-name-row h2 {
    font-size: 16px;
  }

  .profile-email {
    margin-top: 3px;
    font-size: 12.5px;
  }

  .profile-meta {
    margin-top: 2px;
    font-size: 12px;
  }

  /* 统计卡换行到下一行，两张并排 */
  .profile-stats {
    flex: 1 1 100%;
    width: 100%;
    gap: 8px;
  }

  .stat-card {
    min-width: 0;
    padding: 8px 10px;
    gap: 2px;
  }

  /* 12px 是移动端最小可读字号（业界共识），11px 原来是压过头的 */
  .stat-card span {
    font-size: 12px;
  }

  .stat-card strong {
    font-size: 17px;
  }

  .pwd-grid {
    gap: 10px;
  }

  .uc-card__foot {
    margin-top: 12px;
    padding-top: 12px;
  }

  /* 卡脚上留白 16 → 12（按钮与上方字段之间，390 下偏松）。
     权重 (0,2,0) 压住基础规则里的同权重版本。 */
  .uc-card--pwd .uc-card__foot {
    padding-top: 12px;
  }

  .danger-form {
    gap: 8px;
  }

  .confirm-desc {
    font-size: 13px;
    line-height: 1.6;
  }

  /* 资料卡再收一档（2026-09-24 反馈「个人中心五个选项里的内容都偏大」）：
     390 下 hero 卡 182px 高，统计卡 8px 上下边距 + 17px 数字是主要开销。
     只收内边距与数字，标签字号抬回 12px（见上面 stat-card span）——卡片可以紧，字不能更小。
     横向跟 .uc-card 的 14px 对齐（2026-09-26 对齐走查）：原来是 12px，同页堆叠时
     内容左缘比下面几张卡左 2px，一列卡看着就是「没对齐」。 */
  .profile-hero { padding: 12px 14px; }
  .stat-card { padding: 6px 10px; }
  .stat-card strong { font-size: 16px; }
  .uc-card__foot { margin-top: 10px; padding-top: 10px; }
}
</style>
