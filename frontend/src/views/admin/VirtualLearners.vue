<template>
  <div class="learner-lab-page">
    <section class="page-header">
      <div class="page-header__copy">
        <span class="page-header__eyebrow">Admin</span>
        <h1>虚拟学习者</h1>
        <p>集中管理画像、故事池与 Goal / Path / Learn 运行样本。</p>
      </div>

      <div class="page-header__actions">
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>
          新建虚拟学习者
        </el-button>
        <el-button :loading="loading" @click="loadProfiles">
          <el-icon><Refresh /></el-icon>
          刷新数据
        </el-button>
      </div>
    </section>

    <section class="summary-grid">
      <article
        v-for="item in summaryCards"
        :key="item.label"
        class="summary-card"
        :class="item.tone"
      >
        <span class="summary-card__label">{{ item.label }}</span>
        <strong class="summary-card__value">{{ item.value }}</strong>
        <span class="summary-card__helper">{{ item.helper }}</span>
      </article>
    </section>

    <div class="toolbar-card">
      <div class="toolbar-card__group">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索名称 / 学习目标"
          clearable
          class="toolbar-card__search"
          @input="debouncedSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="toolbar-card__group toolbar-card__group--hint">先缩小范围，再进入详情或开局。</div>
    </div>

    <main class="page-shell">
      <section class="lab-main">
        <section class="lab-panel lab-panel--profiles">
          <div class="lab-panel__head">
            <div class="lab-panel__head-left">
              <el-checkbox
                v-if="!loading && filteredProfiles.length > 0"
                :model-value="isAllSelected"
                @change="toggleSelectAll"
              />
              <div>
                <div class="lab-panel__title">虚拟学习者列表</div>
                <div class="lab-panel__meta lab-panel__meta--stack">按样本查看画像、故事准备度和最近运行状态。</div>
              </div>
            </div>
            <div class="lab-panel__head-right">
              <template v-if="selectedIds.size > 0">
                <span class="select-count">已选 {{ selectedIds.size }} 项</span>
                <el-button type="danger" size="small" @click="handleBatchDelete">批量删除</el-button>
              </template>
              <div v-else class="lab-panel__meta">共 {{ filteredProfiles.length }} 个样本</div>
            </div>
          </div>

          <div v-if="loading" class="empty-state">正在加载虚拟学习者...</div>
          <div v-else-if="filteredProfiles.length === 0" class="empty-state">暂无匹配的虚拟学习者</div>
          <div v-else class="profile-grid">
            <article
              v-for="row in pagedProfiles"
              :key="row.id"
              class="profile-card"
              :class="{ 'profile-card--selected': selectedIds.has(row.id) }"
            >
              <div class="profile-card__primary">
                <div class="profile-card__head">
                  <el-checkbox
                    :model-value="selectedIds.has(row.id)"
                    @change="toggleSelect(row.id)"
                    @click.stop
                  />
                  <div class="avatar-badge">{{ row.userName?.charAt(0) || '?' }}</div>
                  <div class="profile-card__identity">
                    <strong>{{ row.userName }}</strong>
                    <span>{{ row.profile?.occupation || '未填写职业' }}</span>
                  </div>
                </div>

                <div class="profile-meta-row">
                  <span v-if="row.profile?.age">{{ row.profile.age }}岁</span>
                  <span>{{ getStoryPool(row).length }} 个故事</span>
                  <span>{{ row.simulationMode === 'ai' ? 'AI画像' : '手动画像' }}</span>
                </div>

                <p class="profile-card__summary">{{ row.profile?.background || row.profile?.corePersonality || '进入详情查看人物画像与故事目录。' }}</p>
              </div>

              <div class="profile-card__stats">
                <div class="mini-stat">
                  <span>会话数</span>
                  <strong>{{ row.sessionCount || 0 }}</strong>
                </div>
                <div class="mini-stat mini-stat--soft">
                  <span>最近阶段</span>
                  <strong>{{ row.sessions?.[0] ? getSessionStageLabel(row.sessions[0].currentStage) : '未开始' }}</strong>
                </div>
              </div>

              <div class="profile-card__footer">
                <el-button type="primary" @click="goToProfile(row)">详情</el-button>
                <el-button @click="openStartSessionDialog(row)">开局</el-button>
                <el-dropdown trigger="click">
                  <el-button>
                    更多
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item @click="openSessionDrawer(row)">查看会话</el-dropdown-item>
                      <el-dropdown-item @click="openEditDialog(row)">编辑画像</el-dropdown-item>
                      <el-dropdown-item @click="handleDelete(row)">删除画像</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </article>
          </div>

          <div class="pagination-row" v-if="pagination.total > pagination.limit">
            <el-pagination
              v-model:current-page="pagination.page"
              :page-size="pagination.limit"
              :total="pagination.total"
              layout="total, prev, pager, next"
              @current-change="handlePageChange"
            />
          </div>
        </section>

        <section class="lab-panel lab-panel--sessions">
          <div class="lab-panel__head">
            <div>
              <div class="lab-panel__title">最近诊断样本</div>
              <div class="lab-panel__meta lab-panel__meta--stack">快速回到最近一次虚拟学习者运行。</div>
            </div>
          </div>

          <div v-if="recentSessions.length === 0" class="empty-state small">还没有可回看的样本</div>
          <div v-else class="session-list session-list--compact">
            <article v-for="item in recentSessions" :key="item.id" class="session-row">
              <div class="session-row__top">
                <div class="session-row__main">
                  <div class="session-row__identity">
                    <strong>{{ item.profileName }}</strong>
                    <span>{{ getSessionStatusLabel(item.status) }} / {{ getSessionStageLabel(item.currentStage) }}</span>
                  </div>
                  <p>{{ item.goal || '暂无学习目标' }}</p>
                </div>
                <el-button type="primary" link @click="goToSession(item.id)">进入诊断</el-button>
              </div>
              <div class="session-row__meta">
                <span v-if="item.roundCount !== null">{{ item.roundCount }} 轮</span>
                <span class="session-row__active">最后活跃 {{ formatRelativeTime(item.updatedAt) }}</span>
              </div>
            </article>
          </div>
        </section>
      </section>
    </main>

    <el-dialog
      v-model="createDialogVisible"
      :title="editingProfile ? '编辑虚拟学习者' : '新建虚拟学习者'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="学习者称呼" prop="name">
          <el-input v-model="formData.name" placeholder="这个虚拟学习者怎么称呼，如：小林 / 王姐 / 店长A" />
        </el-form-item>
        <div class="ai-generate-hint">用于在人物详情、会话和故事中称呼这个学习者。</div>

        <el-divider>基础身份</el-divider>
        <div class="ai-generate-section">
          <el-button type="primary" plain :loading="generatingScenario" @click="handleGeneratePersona">
            <el-icon><MagicStick /></el-icon>
            AI 一键生成身份
          </el-button>
        </div>
        <div class="ai-generate-hint ai-generate-hint--block">
          这里只创建虚拟学习者身份。AI 一键生成会补全基础身份与稳定特质；故事池请在创建后进入人物详情页单独生成和维护。
        </div>

        <el-form-item label="年龄">
          <el-input-number v-model="formData.profile.age" :min="18" :max="60" style="width: 120px" />
        </el-form-item>

        <el-form-item label="职业">
          <el-input v-model="formData.profile.occupation" placeholder="如：产品经理、工程师、学生" />
        </el-form-item>

        <el-form-item label="学历">
          <el-input v-model="formData.profile.education" placeholder="如：本科、硕士、大专" />
        </el-form-item>

        <el-form-item label="背景描述">
          <el-input v-model="formData.profile.background" type="textarea" :rows="2" placeholder="简要背景经历..." />
        </el-form-item>

        <el-divider>稳定特质</el-divider>
        <div class="ai-generate-hint ai-generate-hint--block">
          这组字段描述这个人长期稳定的表达习惯、求助方式和受压反应。
        </div>

        <el-form-item label="核心人格">
          <el-input v-model="formData.profile.corePersonality" placeholder="如：遇到真实压力时会先保留判断，不会一上来把话说满" />
        </el-form-item>

        <el-form-item label="情感底色">
          <el-input v-model="formData.profile.emotionalBaseline" type="textarea" :rows="2" placeholder="如：平时不一定明显表达，但在连续受挫或公开出错时会明显紧张" />
        </el-form-item>

        <el-form-item label="求助模式">
          <el-input v-model="formData.profile.helpSeekingPattern" type="textarea" :rows="2" placeholder="如：先自己试，卡两次才问；一旦开口就希望对方给具体例子" />
        </el-form-item>

        <el-form-item label="对抗模式">
          <el-input v-model="formData.profile.adversarialPattern" type="textarea" :rows="2" placeholder="如：建议太理想化时，会先说时间不够或条件不允许" />
        </el-form-item>

        <el-form-item label="元认知特征">
          <el-input v-model="formData.profile.metacognitiveProfile" type="textarea" :rows="2" placeholder="如：能感觉到自己没懂，但不太会立刻说清具体卡点" />
        </el-form-item>

        <el-form-item label="负荷容忍度">
          <el-input v-model="formData.profile.cognitiveLoadTolerance" placeholder="如：信息一多就容易先抓表面，之后才慢慢整理重点" />
        </el-form-item>

        <el-form-item label="纠错方式">
          <el-input v-model="formData.profile.memoryRepairPattern" placeholder="如：忘了会先模糊带过，被追问后才承认没记住" />
        </el-form-item>

        <el-divider>内部信息</el-divider>
        <el-form-item label="管理员备注">
          <el-input v-model="formData.notes" type="textarea" :rows="2" placeholder="仅管理员可见的补充说明" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ editingProfile ? '保存修改' : '创建样本' }}
        </el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="sessionDrawerVisible"
      :title="`${currentSessionProfile?.userName || ''} 的会话记录`"
      size="620px"
      direction="rtl"
    >
      <div class="drawer-summary">
        <strong>{{ currentSessionProfile?.learningGoal || '暂无学习目标' }}</strong>
        <span v-if="getStoryPool(currentSessionProfile).length">{{ getStoryPool(currentSessionProfile).length }} 个故事</span>
      </div>

      <div v-if="getStoryPool(currentSessionProfile).length" class="story-pool-preview">
        <article v-for="(story, index) in getStoryPool(currentSessionProfile)" :key="story.id || index" class="story-pool-card">
          <div class="story-pool-card__head">
            <strong>{{ story.title || `故事 ${index + 1}` }}</strong>
            <el-tag size="small" effect="plain">{{ getStorySourceLabel(story.sourceType) }}</el-tag>
          </div>
          <p>{{ story.storyOutline || story.visibleOpening || '暂无故事摘要' }}</p>
          <div class="story-pool-card__meta">{{ story.triggerEvent || '暂无触发事件' }}</div>
          <div class="story-pool-card__actions">
            <el-button type="primary" link size="small" @click="startSession(currentSessionProfile, story)">用此故事开局</el-button>
          </div>
        </article>
      </div>

      <el-table :data="currentSessions" v-loading="sessionsLoading" stripe size="small">
        <template #empty>
          <el-empty description="暂无会话记录" :image-size="60" />
        </template>

        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="getSessionStatusType(row.status)" size="small">
              {{ getSessionStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="阶段" width="90" align="center">
          <template #default="{ row }">
            <el-tag type="info" size="small" effect="plain">
              {{ getSessionStageLabel(row.currentStage) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" min-width="150">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="goToSession(row.id)">诊断</el-button>
            <el-button type="danger" link size="small" @click="deleteSession(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <el-dialog v-model="startSessionDialogVisible" title="选择故事" width="560px">
      <div class="start-session-panel">
        <div class="start-session-panel__head">
          <strong>{{ startSessionTarget?.userName || '虚拟学习者' }}</strong>
          <span>先选故事，再进入详情与实验</span>
        </div>
        <div v-if="getStoryPool(startSessionTarget).length" class="start-session-story-list">
          <label
            v-for="(story, index) in getStoryPool(startSessionTarget)"
            :key="story.id || index"
            class="start-session-story"
            :class="{ active: startSessionStoryIndex === index }"
          >
            <input v-model="startSessionStoryIndex" type="radio" :value="index" />
            <div>
              <strong>{{ story.title || `故事 ${index + 1}` }}</strong>
              <p>{{ story.storyOutline || story.visibleOpening || '暂无故事摘要' }}</p>
            </div>
          </label>
        </div>
        <div v-else class="empty-state small">这个学习者还没有故事池，先进入详情页生成故事，再开始实验。</div>
      </div>
      <template #footer>
        <el-button @click="startSessionDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmStartSession">{{ startSessionPrimaryActionLabel }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'

const router = useRouter()
const loading = ref(false)
const submitting = ref(false)
const generatingScenario = ref(false)
const profiles = ref<any[]>([])
const searchKeyword = ref('')
const selectedIds = ref<Set<string>>(new Set())
const isAllSelected = computed(() => {
  return pagedProfiles.value.length > 0 && pagedProfiles.value.every(p => selectedIds.value.has(p.id))
})
const pagination = ref({
  page: 1,
  limit: 12,
  total: 0
})

const createDialogVisible = ref(false)
const sessionDrawerVisible = ref(false)
const sessionsLoading = ref(false)
const currentSessionProfile = ref<any>(null)
const currentSessions = ref<any[]>([])
const scenarioDraft = ref<any | null>(null)
const editingProfile = ref<any>(null)
const formRef = ref()
const startSessionDialogVisible = ref(false)
const startSessionTarget = ref<any | null>(null)
const startSessionStoryIndex = ref(0)

const startSessionPrimaryActionLabel = computed(() => {
  return getStoryPool(startSessionTarget.value).length ? '用该故事进入详情' : '进入详情生成故事'
})

const formData = ref({
  name: '',
  profile: {
    age: undefined as number | undefined,
    occupation: '',
    education: '',
    background: ''
  },
  simulationMode: 'manual',
  simulationTemperature: 0.8,
  personalityTraits: {
    verbosity: 'normal',
    enthusiasm: 'normal',
    confusionStyle: 'direct'
  },
  notes: ''
})

const formRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }]
}

const filteredProfiles = computed(() => {
  return profiles.value.filter((p: any) => {
    const searchTarget = `${p.userName || ''} ${p.learningGoal || ''}`.toLowerCase()
    if (searchKeyword.value && !searchTarget.includes(searchKeyword.value.toLowerCase())) {
      return false
    }
    return true
  })
})

const pagedProfiles = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.limit
  const end = start + pagination.value.limit
  return filteredProfiles.value.slice(start, end)
})

const recentSessions = computed(() => {
  const sessions = profiles.value.flatMap((profile: any) =>
    (profile.sessions || []).map((session: any) => ({
      ...session,
      profileName: profile.userName,
      goal: profile.learningGoal,
      goalReady: session.currentStage === 'path' || session.currentStage === 'learning' || session.status === 'completed',
      pathReady: !!session.learningPathId || session.currentStage === 'learning' || session.status === 'completed',
      learnStarted: session.currentStage === 'learning' || session.status === 'completed',
      learnCompleted: session.status === 'completed',
      roundCount: typeof session.roundCount === 'number' ? session.roundCount : null
    }))
  )

  return sessions
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8)
})

const summaryCards = computed(() => {
  const totalProfiles = profiles.value.length
  const totalSessions = profiles.value.reduce((sum: number, item: any) => sum + (item.sessionCount || 0), 0)
  const autoProfiles = profiles.value.filter((item: any) => item.simulationMode === 'ai').length
  const activeProfiles = profiles.value.filter((item: any) => (item.sessionCount || 0) > 0).length
  const withStories = profiles.value.filter((item: any) => getStoryPool(item).length > 0).length

  const allSessions = profiles.value.flatMap((item: any) => item.sessions || [])
  const completedSessions = allSessions.filter((item: any) => item.status === 'completed').length
  const failedSessions = allSessions.filter((item: any) => item.status === 'failed').length
  const runningSessions = allSessions.filter((item: any) => item.status === 'running').length
  const goalReadySessions = allSessions.filter((item: any) => item.currentStage === 'path' || item.currentStage === 'learning' || item.status === 'completed').length
  const pathReadySessions = allSessions.filter((item: any) => item.learningPathId || item.currentStage === 'learning' || item.status === 'completed').length
  const learnCompletedSessions = completedSessions

  const totalSessionBase = Math.max(allSessions.length, 1)
  const goalReadyRate = `${Math.round((goalReadySessions / totalSessionBase) * 100)}%`
  const pathReadyRate = `${Math.round((pathReadySessions / totalSessionBase) * 100)}%`
  const learnCompletionRate = `${Math.round((learnCompletedSessions / totalSessionBase) * 100)}%`

  return [
    {
      label: '样本与故事',
      value: `${totalProfiles}`,
      helper: `${withStories} 个有故事，${totalProfiles - withStories} 个待补故事`,
      tone: 'tone-blue'
    },
    {
      label: '实验进度',
      value: String(totalSessions),
      helper: `${runningSessions} 运行中 / ${completedSessions} 完成 / ${failedSessions} 失败`,
      tone: 'tone-dark'
    },
    {
      label: 'Goal / Path',
      value: `${goalReadyRate} / ${pathReadyRate}`,
      helper: `${goalReadySessions}/${allSessions.length || 0} 进入 Path，${pathReadySessions}/${allSessions.length || 0} 生成路径`,
      tone: 'tone-green'
    },
    {
      label: 'Learn 完成率',
      value: learnCompletionRate,
      helper: `${learnCompletedSessions}/${allSessions.length || 0} 完整跑通，${autoProfiles} 个 AI 画像样本`,
      tone: 'tone-amber'
    }
  ]
})

const profileBuckets = computed(() => {
  const total = profiles.value.length
  const withStories = profiles.value.filter((item: any) => getStoryPool(item).length > 0).length
  const inProgress = profiles.value.filter((item: any) => (item.sessions || []).some((session: any) => session.status === 'running')).length
  const completed = profiles.value.filter((item: any) => (item.sessions || []).some((session: any) => session.status === 'completed')).length

  return [
    {
      label: '有故事可跑',
      value: String(withStories),
      helper: `${total - withStories} 个仍需补故事`
    },
    {
      label: '实验进行中',
      value: String(inProgress),
      helper: '当前仍有运行中的样本'
    },
    {
      label: '已有完成样本',
      value: String(completed),
      helper: '至少完成过一次 Learn'
    }
  ]
})

const formatTime = (time: string | Date | null) => {
  if (!time) return '-'
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const formatRelativeTime = (time: string | Date | null) => {
  if (!time) return '-'
  const now = Date.now()
  const diff = now - new Date(time).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  return formatTime(time)
}

const debouncedSearch = () => {
  pagination.value.page = 1
}

const loadProfiles = async () => {
  loading.value = true
  try {
    const res = await adminApi.getVirtualLearners({
      page: 1,
      limit: 100
    })
    if (res.data?.success) {
      profiles.value = res.data.data?.profiles || []
      pagination.value.total = profiles.value.length
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const handlePageChange = (page: number) => {
  pagination.value.page = page
}

const resetForm = () => {
  scenarioDraft.value = null
  formData.value = {
    name: '',
    profile: {
      age: undefined,
      occupation: '',
      education: '',
      background: '',
      corePersonality: '',
      emotionalBaseline: '',
      helpSeekingPattern: '',
      adversarialPattern: '',
      metacognitiveProfile: '',
      cognitiveLoadTolerance: '',
      memoryRepairPattern: ''
    },
    simulationMode: 'manual',
    simulationTemperature: 0.8,
    personalityTraits: { verbosity: 'normal', enthusiasm: 'normal', confusionStyle: 'direct' },
    notes: ''
  }
}

const openCreateDialog = () => {
  editingProfile.value = null
  resetForm()
  createDialogVisible.value = true
}

const openEditDialog = (profile: any) => {
  scenarioDraft.value = null
  editingProfile.value = profile
  formData.value = {
    name: profile.userName || '',
    profile: {
      age: profile.profile?.age,
      occupation: profile.profile?.occupation || '',
      education: profile.profile?.education || '',
      background: profile.profile?.background || '',
      corePersonality: profile.profile?.corePersonality || '',
      emotionalBaseline: profile.profile?.emotionalBaseline || '',
      helpSeekingPattern: profile.profile?.helpSeekingPattern || '',
      adversarialPattern: profile.profile?.adversarialPattern || '',
      metacognitiveProfile: profile.profile?.metacognitiveProfile || '',
      cognitiveLoadTolerance: profile.profile?.cognitiveLoadTolerance || '',
      memoryRepairPattern: profile.profile?.memoryRepairPattern || ''
    },
    simulationMode: profile.simulationMode || 'manual',
    simulationTemperature: profile.simulationTemperature || 0.8,
    personalityTraits: {
      verbosity: profile.personalityTraits?.verbosity || 'normal',
      enthusiasm: profile.personalityTraits?.enthusiasm || 'normal',
      confusionStyle: profile.personalityTraits?.confusionStyle || 'direct'
    },
    notes: profile.notes || ''
  }
  createDialogVisible.value = true
}

const handleGeneratePersona = async () => {
  generatingScenario.value = true
  try {
    const res = await adminApi.generatePersona()
    const persona = res.data?.data
    if (res.data?.success && persona?.personaSeed) {
      scenarioDraft.value = null
      const personaSeed = persona.personaSeed
      formData.value.name = formData.value.name || personaSeed.nameHint || personaSeed.occupation || '随机样本'
      formData.value.profile.age = personaSeed.age
      formData.value.profile.occupation = personaSeed.occupation || ''
      formData.value.profile.education = personaSeed.education || ''
      formData.value.profile.background = personaSeed.background || ''
      formData.value.profile.corePersonality = personaSeed.corePersonality || ''
      formData.value.profile.emotionalBaseline = personaSeed.emotionalBaseline || ''
      formData.value.profile.helpSeekingPattern = personaSeed.helpSeekingPattern || ''
      formData.value.profile.adversarialPattern = personaSeed.adversarialPattern || ''
      formData.value.profile.metacognitiveProfile = personaSeed.metacognitiveProfile || ''
      formData.value.profile.cognitiveLoadTolerance = personaSeed.cognitiveLoadTolerance || ''
      formData.value.profile.memoryRepairPattern = personaSeed.memoryRepairPattern || ''
      ElMessage.success('学习者身份已生成')
    } else {
      ElMessage.error(res.data?.error || '学习者身份生成失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '学习者身份生成失败')
  } finally {
    generatingScenario.value = false
  }
}

const getStorySourceLabel = (value: string) => {
  switch (value) {
    case 'work':
      return '工作'
    case 'life':
      return '生活'
    case 'study':
      return '学习'
    case 'self_management':
      return '自我管理'
    default:
      return value || '故事'
  }
}

const getStoryPool = (profile: any) => {
  if (!profile) return []
  const profileData = profile.profile || {}
  return Array.isArray(profileData.storyPool) ? profileData.storyPool.filter((story: any) => story && typeof story === 'object') : []
}

const handleSubmit = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  submitting.value = true
  try {
    if (editingProfile.value) {
      const res = await adminApi.updateVirtualLearner(editingProfile.value.id, formData.value)
      if (res.data?.success) {
        ElMessage.success('更新成功')
        createDialogVisible.value = false
        loadProfiles()
      }
    } else {
      const res = await adminApi.createVirtualLearner(formData.value)
      if (res.data?.success) {
        ElMessage.success('创建成功')
        createDialogVisible.value = false
        loadProfiles()
      }
    }
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (profile: any) => {
  try {
    await ElMessageBox.confirm(`确定删除虚拟学习者 "${profile.userName}"？该用户的学习数据也会被删除。`, '确认删除', { type: 'warning' })
    const res = await adminApi.deleteVirtualLearner(profile.id)
    if (res.data?.success) {
      ElMessage.success('删除成功')
      loadProfiles()
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(pagedProfiles.value.map(p => p.id))
  }
}

const toggleSelect = (id: string) => {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

const handleBatchDelete = async () => {
  const count = selectedIds.value.size
  if (count === 0) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${count} 个虚拟学习者？相关学习数据也会被删除。`,
      '批量删除',
      { type: 'warning' }
    )
    const ids = Array.from(selectedIds.value)
    const results = await Promise.allSettled(
      ids.map(id => adminApi.deleteVirtualLearner(id))
    )
    const successCount = results.filter(r => r.status === 'fulfilled' && (r as any).value?.data?.success).length
    const failCount = count - successCount
    if (successCount > 0) {
      ElMessage.success(`成功删除 ${successCount} 个`)
    }
    if (failCount > 0) {
      ElMessage.warning(`${failCount} 个删除失败`)
    }
    selectedIds.value = new Set()
    loadProfiles()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '批量删除失败')
    }
  }
}

const getSessionStatusType = (status: string) => {
  switch (status) {
    case 'running':
      return 'success'
    case 'completed':
      return 'info'
    case 'failed':
      return 'danger'
    default:
      return 'warning'
  }
}

const getSessionStatusLabel = (status: string) => {
  switch (status) {
    case 'created':
      return '已创建'
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return status || '未知'
  }
}

const getSessionStageLabel = (stage: string) => {
  switch (stage) {
    case 'goal':
      return 'Goal'
    case 'path':
      return 'Path'
    case 'learning':
      return 'Learn'
    default:
      return stage || '-'
  }
}

const goToProfile = (profile: any) => {
  router.push(`/admin/virtual-learners/${profile.id}`)
}

const openSessionDrawer = async (profile: any) => {
  currentSessionProfile.value = profile
  currentSessions.value = profile.sessions || []
  sessionDrawerVisible.value = true

  sessionsLoading.value = true
  try {
    const res = await adminApi.getVirtualLearner(profile.id)
    if (res.data?.success) {
      currentSessions.value = res.data.data?.sessions || []
    }
  } catch {
    // ignore drawer refresh errors
  } finally {
    sessionsLoading.value = false
  }
}

const goToSession = (sessionId: string) => {
  sessionDrawerVisible.value = false
  router.push(`/admin/virtual-session/${sessionId}`)
}

const openStartSessionDialog = (profile: any) => {
  startSessionTarget.value = profile
  startSessionStoryIndex.value = 0
  startSessionDialogVisible.value = true
}

const confirmStartSession = async () => {
  if (!startSessionTarget.value) return
  const storyPool = getStoryPool(startSessionTarget.value)
  const story = storyPool[startSessionStoryIndex.value] || storyPool[0]
  try {
    const res = await adminApi.startVirtualSession(startSessionTarget.value.id, story ? { storyId: story.id, storyIndex: startSessionStoryIndex.value } : undefined)
    if (res.data?.success) {
      ElMessage.success('已创建 session，进入人物控制中心')
      startSessionDialogVisible.value = false
      router.push(`/admin/virtual-learners/${startSessionTarget.value.id}?sessionId=${res.data.data?.id}`)
    }
  } catch (error: any) {
    ElMessage.error(error.message || '启动失败')
  }
}

const deleteSession = async (sessionId: string) => {
  try {
    await ElMessageBox.confirm('确定删除此会话？相关数据将被清除。', '确认删除', { type: 'warning' })
    const res = await adminApi.deleteVirtualSession(sessionId)
    if (res.data?.success) {
      ElMessage.success('会话已删除')
      currentSessions.value = currentSessions.value.filter((s: any) => s.id !== sessionId)
      loadProfiles()
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const startSession = async (profile: any, story?: any) => {
  try {
    const res = await adminApi.startVirtualSession(profile.id, story ? { storyId: story.id } : undefined)
    if (res.data?.success) {
      ElMessage.success('已创建 session，进入人物控制中心')
      router.push(`/admin/virtual-learners/${profile.id}?sessionId=${res.data.data?.id}`)
    }
  } catch (error: any) {
    ElMessage.error(error.message || '启动失败')
  }
}

onMounted(() => {
  loadProfiles()
})
</script>

<style scoped>
.learner-lab-page {
  min-height: 100vh;
  padding: 16px;
  background: #f3f5f9;
}

.page-header,
.summary-grid,
.page-shell {
  max-width: 1440px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 16px 18px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e5eaf2;
  margin-bottom: 12px;
}

.page-header__eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eaf0fb;
  color: #2355d8;
  font-size: 12px;
  font-weight: 700;
}

.page-header__copy {
  display: grid;
  gap: 6px;
}

.page-header h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.page-header p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: #66758b;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.summary-card {
  min-height: 96px;
  padding: 14px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e5eaf2;
}

.summary-card__label {
  display: block;
  font-size: 12px;
  color: #7b8598;
  margin-bottom: 8px;
}

.summary-card__value {
  display: block;
  font-size: 22px;
  line-height: 1.1;
}

.summary-card__helper {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.45;
  color: #5f6b7d;
}

.tone-blue {
  background: linear-gradient(180deg, #f7faff, #ffffff);
}

.tone-dark {
  background: linear-gradient(180deg, #fafbfd, #ffffff);
}

.tone-green {
  background: linear-gradient(180deg, #f7fcf8, #ffffff);
}

.tone-amber {
  background: linear-gradient(180deg, #fffaf3, #ffffff);
}

.toolbar-card {
  max-width: 1440px;
  margin: 0 auto 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e5eaf2;
}

.toolbar-card__group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-card__group--hint {
  font-size: 12px;
  color: #8b94a6;
}

.toolbar-card__search {
  width: min(360px, 100%);
}

.page-shell {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.lab-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lab-panel {
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 16px;
  padding: 16px;
}

.lab-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.lab-panel__title {
  font-size: 13px;
  font-weight: 700;
  color: #1f2937;
}

.lab-panel__meta {
  font-size: 12px;
  color: #8b94a6;
  white-space: nowrap;
}

.lab-panel__meta--stack {
  display: block;
  margin-top: 4px;
  white-space: normal;
  line-height: 1.5;
}

.lab-panel__head-left,
.lab-panel__head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.story-draft-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.story-draft-panel__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid #e6ebf2;
  border-radius: 14px;
  background: #fafcff;
}

.story-draft-panel__head strong {
  font-size: 13px;
  color: #1f2937;
}

.story-draft-panel__head span {
  font-size: 12px;
  color: #6b7280;
}

.story-draft-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 10px;
}

.story-card {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid #e8edf5;
  background: #ffffff;
}

.story-card.primary {
  border-color: #c9dafd;
  background: #f7faff;
}

.story-card__head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.story-card__head strong {
  font-size: 13px;
  color: #1f2937;
}

.story-card p {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #475569;
}

.story-card__line {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.story-card__line:last-child {
  margin-bottom: 0;
}

.story-card__line span {
  font-size: 11px;
  color: #8b94a6;
}

.story-card__line strong {
  font-size: 12px;
  line-height: 1.5;
  color: #334155;
  font-weight: 500;
}

.story-pool-preview {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.story-pool-card {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid #e6ebf2;
  background: #fafcff;
}

.story-pool-card__head,
.start-session-panel__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}

.story-pool-card p,
.start-session-story p,
.start-session-panel__head span {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #5f6b7d;
}

.story-pool-card__meta {
  margin-top: 8px;
  font-size: 11px;
  color: #8b94a6;
}

.story-pool-card__actions {
  margin-top: 8px;
}

.start-session-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.start-session-story-list {
  display: grid;
  gap: 10px;
}

.start-session-story {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid #e6ebf2;
  background: #fff;
  cursor: pointer;
}

.start-session-story.active {
  border-color: #c8dafd;
  background: #f7faff;
}

.start-session-story input {
  margin-top: 3px;
}

.start-session-story strong {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: #1f2937;
}

.select-count {
  font-size: 12px;
  color: #8b94a6;
}

.profile-card--selected {
  border-color: #c8dafd;
  background: #f8faff;
}

.filter-stack,
.session-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint-compact {
  font-size: 13px;
  color: #5f6b7d;
}

.profile-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.profile-card {
  border: 1px solid #e7ecf3;
  border-radius: 16px;
  padding: 14px;
  background: #fff;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(180px, 0.85fr) auto;
  gap: 14px;
  align-items: center;
}

.profile-card__head,
.profile-card__primary,
.profile-card__footer,
.profile-meta-row,
.profile-stats,
.session-row__meta,
.task-row {
  display: flex;
  align-items: center;
}

.profile-card__head {
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}

.profile-card__primary {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.avatar-badge {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: linear-gradient(135deg, #315fd7, #5b8cff);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  flex-shrink: 0;
}

.profile-card__identity {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.profile-card__identity strong {
  font-size: 15px;
}

.profile-card__identity span {
  font-size: 12px;
  color: #7a8597;
}

.profile-meta-row {
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #6b7280;
}

.profile-meta-row span {
  padding: 2px 7px;
  border-radius: 999px;
  background: #f4f6fa;
}

.profile-card__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.mini-stat {
  min-width: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #edf1f6;
}

.mini-stat--soft {
  background: #fafbfd;
}

.mini-stat span {
  display: block;
  font-size: 11px;
  color: #8b94a6;
  margin-bottom: 4px;
}

.mini-stat strong {
  font-size: 12px;
  color: #334155;
}

.profile-card__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.profile-card__summary {
  margin: 0;
  color: #5f6b7d;
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.profile-card__footer .el-button {
  flex-shrink: 0;
  font-size: 12px;
  padding: 6px 12px;
}

.pagination-row {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.session-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 0;
  border-bottom: 1px solid #edf1f6;
}

.session-row__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.session-row__main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.session-row__identity {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.session-row__identity span {
  font-size: 11px;
  color: #8b94a6;
  white-space: nowrap;
}

.session-row:last-child {
  border-bottom: none;
}

.session-row strong {
  display: block;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-row p {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.session-funnel {
  display: none;
}

.session-row__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #8b94a6;
}

.session-row__active {
  color: #6b7280;
  font-style: italic;
}

.session-row__top .el-button {
  flex-shrink: 0;
}

.session-list--compact {
  gap: 0;
}

.empty-state {
  padding: 26px;
  border-radius: 16px;
  text-align: center;
  background: #fbfcfe;
  border: 1px dashed #dce4ee;
  color: #8b94a6;
}

.empty-state.small {
  padding: 20px;
}

.drawer-summary {
  margin-bottom: 16px;
  padding: 14px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid #e7ecf3;
}

.drawer-summary strong {
  display: block;
  margin-bottom: 6px;
}


.personality-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.personality-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.personality-item .label {
  font-size: 13px;
  color: #6b7280;
}

.ai-generate-section {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-generate-hint {
  font-size: 12px;
  color: #9ca3af;
}

@media (max-width: 1440px) {
  .summary-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 1280px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-card {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }

  .profile-card__footer {
    justify-content: flex-start;
  }

  .toolbar-card {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-card__search {
    width: 100%;
  }
}

@media (max-width: 980px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .page-header {
    flex-direction: column;
  }

  .page-header__actions {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .learner-lab-page {
    padding: 14px;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
