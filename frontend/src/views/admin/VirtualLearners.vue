<template>
  <div class="admin-page learner-lab-page">
    <AdminPageHeader
      title="虚拟学习者"
      :icon="User"
      :highlights="virtualLearnerHighlights"
    >
      <template #actions>
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>
          新建虚拟学习者
        </el-button>
        <el-button :loading="loading" @click="loadProfiles">
          <el-icon><Refresh /></el-icon>
          刷新数据
        </el-button>
        <el-popover placement="bottom-end" :width="440" trigger="click">
          <template #reference>
            <el-button>实验说明</el-button>
          </template>
          <div class="experiment-guide">
            <strong>实验流程</strong>
            <p>正式稳定性测试使用黑盒 API；实验结束后由旁路裁判生成独立报告。</p>
            <ol>
              <li v-for="item in experimentSteps" :key="item.step">
                <span>{{ item.title }}</span>
                <small>{{ item.desc }}</small>
              </li>
            </ol>
          </div>
        </el-popover>
      </template>
    </AdminPageHeader>

    <section class="summary-grid">
      <article v-for="item in summaryCards" :key="item.label" class="summary-card" :class="item.tone">
        <div class="summary-card__top">
          <span class="summary-card__icon"><el-icon><component :is="item.icon" /></el-icon></span>
          <span class="summary-card__label">{{ item.label }}</span>
        </div>
        <div class="summary-card__body">
          <strong class="summary-card__value">{{ item.value }}</strong>
          <span class="summary-card__helper">{{ item.helper }}</span>
        </div>
        <div class="summary-card__bar"><i :style="{ width: `${item.progress}%` }"></i></div>
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
      <div class="toolbar-card__filters">
        <button
          v-for="item in profileFilterOptions"
          :key="item.value"
          type="button"
          class="filter-chip"
          :class="{ active: activeFilter === item.value }"
          :aria-pressed="activeFilter === item.value"
          @click="setFilter(item.value)"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.count }}</strong>
        </button>
      </div>
    </div>

    <div v-if="filteredProfiles.length > 20 && groupedByInitial.length > 1" class="alphabet-index">
      <button
        v-for="letter in groupedByInitial"
        :key="letter.initial"
        type="button"
        class="alphabet-btn"
        @click="scrollToLetter(letter.initial)"
      >
        {{ letter.initial }}
      </button>
    </div>

    <main class="page-shell">
      <section class="lab-main">
        <section class="lab-panel lab-panel--profiles">
          <div class="lab-panel__head">
            <div class="lab-panel__head-left">
              <el-checkbox
                v-if="!loading && pagedProfiles.length > 0"
                :model-value="isAllSelected"
                :indeterminate="isSelectionIndeterminate"
                @change="toggleSelectAll"
              />
              <div>
                <div class="lab-panel__title">虚拟学习者列表</div>
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
          <el-result
            v-else-if="loadError && profiles.length === 0"
            icon="error"
            title="虚拟学习者加载失败"
            :sub-title="loadError"
          >
            <template #extra>
              <el-button type="primary" @click="loadProfiles">重新加载</el-button>
            </template>
          </el-result>
          <div v-else-if="filteredProfiles.length === 0" class="empty-state">无匹配虚拟学习者</div>
          <div v-else class="profile-accordion">
            <template v-for="group in pagedProfilesGrouped" :key="group.initial">
              <div v-if="filteredProfiles.length > 20" class="group-header" :data-letter="group.initial">
                {{ group.initial }}
              </div>
              
              <article
                v-for="row in group.profiles"
                :key="row.id"
                class="profile-accordion-item"
                :class="{ 
                  'profile-accordion-item--expanded': isProfileExpanded(row.id),
                  'profile-accordion-item--selected': selectedIds.has(row.id)
                }"
              >
                <!-- VLearner 头部（可点击展开/折叠） -->
                <div class="profile-accordion-header" @click="toggleProfileExpand(row.id)">
                  <div class="profile-accordion-header__left">
                    <el-checkbox
                      :model-value="selectedIds.has(row.id)"
                      @change="toggleSelect(row.id)"
                      @click.stop
                    />
                    <el-icon class="expand-icon">
                      <component :is="isProfileExpanded(row.id) ? ArrowDown : ArrowRight" />
                    </el-icon>
                    <div class="avatar-badge">{{ row.userName?.charAt(0) || '?' }}</div>
                    <div class="profile-accordion-header__identity">
                      <strong>{{ row.userName }}</strong>
                      <span class="profile-meta-compact">
                        {{ row.profile?.occupation || '未填写职业' }}
                        <template v-if="row.profile?.age"> · {{ row.profile.age }}岁</template>
                        <template v-if="row.profile?.education"> · {{ row.profile.education }}</template>
                      </span>
                    </div>
                  </div>
                  
                  <div class="profile-accordion-header__right">
                    <span class="meta-badge">
                      <el-icon><Collection /></el-icon> {{ getStoryPool(row).length }}
                    </span>
                    <span class="meta-badge">
                      <el-icon><TrendCharts /></el-icon> {{ row.sessionCount || 0 }}
                    </span>
                    <span class="status-pill" :class="getProfileStageStatus(row).className">
                      {{ getProfileStageStatus(row).label }}
                    </span>
                    <el-dropdown trigger="click" @click.stop>
                      <el-button class="profile-card__more admin-icon-button" size="small" aria-label="更多操作">
                        <el-icon><MoreFilled /></el-icon>
                      </el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item @click="goToProfile(row)">查看详情</el-dropdown-item>
                          <el-dropdown-item @click="openEditDialog(row)">编辑画像</el-dropdown-item>
                          <el-dropdown-item @click="openSessionDrawer(row)">会话记录</el-dropdown-item>
                          <el-dropdown-item @click="handleDelete(row)">删除画像</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>

                <!-- VLearner 展开内容（Story 列表） -->
                <div v-show="isProfileExpanded(row.id)" class="profile-accordion-content">
                  <div class="profile-accordion-actions">
                    <el-button size="small" @click="goToProfile(row)">查看完整详情</el-button>
                    <el-button size="small" @click="generateStoryForProfile(row)">
                      <el-icon><MagicStick /></el-icon> 生成新故事
                    </el-button>
                  </div>
                  
                  <div v-if="getStoryPool(row).length === 0" class="empty-story-hint">暂无故事</div>
                  
                  <div v-else class="story-list">
                    <article
                      v-for="(story, storyIndex) in getStoryPool(row)"
                      :key="story.storyId || story.id || storyIndex"
                      class="story-card"
                    >
                      <div class="story-card__header">
                        <div class="story-card__title">
                          <span class="story-card__icon">📖</span>
                          <strong>{{ story.title || story.storyTitle || `故事 ${storyIndex + 1}` }}</strong>
                          <el-tag size="small" effect="plain">{{ getStorySourceLabel(story.sourceType) }}</el-tag>
                        </div>
                      </div>
                      
                      <p class="story-card__outline">
                        {{ summarizeStory(story.storyOutline || story.storyTriggerEvent || '暂无故事摘要') }}
                      </p>
                      
                      <div v-if="story.pressurePoints && story.pressurePoints.length > 0" class="story-card__pressures">
                        <span class="pressure-label">💥 对抗剖析点 ({{ story.pressurePoints.length }})：</span>
                        <div class="pressure-tags">
                          <el-tag
                            v-for="(point, idx) in story.pressurePoints.slice(0, 3)"
                            :key="idx"
                            size="small"
                            type="warning"
                            effect="plain"
                          >
                            {{ point }}
                          </el-tag>
                          <el-tag v-if="story.pressurePoints.length > 3" size="small" type="info" effect="plain">
                            +{{ story.pressurePoints.length - 3 }} 更多
                          </el-tag>
                        </div>
                      </div>
                      
                      <div class="story-card__stats">
                        <template v-if="!getStorySessionStats(row, story.storyId || story.id).isEmpty">
                          <span class="stat-item">
                            运行：{{ getStorySessionStats(row, story.storyId || story.id).total }} 次
                          </span>
                          <span class="stat-item stat-item--success">
                            完成：{{ getStorySessionStats(row, story.storyId || story.id).completed }} 次
                          </span>
                          <span class="stat-item">
                            完成率：{{ getStorySessionStats(row, story.storyId || story.id).completionRate }}%
                          </span>
                          <span class="stat-item stat-item--muted">
                            最近：{{ formatRelativeTime(getStorySessionStats(row, story.storyId || story.id).lastRunTime) }}
                          </span>
                        </template>
                        <span v-else class="stat-item stat-item--warning">待测试</span>
                      </div>
                      
                      <div class="story-card__actions">
                        <el-button type="primary" size="small" @click="openStoryLaunch(row, story)">
                          开始实验
                        </el-button>
                        <el-button size="small" @click="openStoryDetail(row, story)">准备详情</el-button>
                      </div>
                    </article>
                  </div>
                </div>
              </article>
            </template>
          </div>

          <div class="pagination-row" v-if="filteredProfiles.length > pagination.limit">
            <el-pagination
              v-model:current-page="pagination.page"
              :page-size="pagination.limit"
              :total="filteredProfiles.length"
              layout="total, prev, pager, next"
              @current-change="handlePageChange"
            />
          </div>

          <div v-if="profilesTruncated" class="truncation-hint" role="status">
            仅显示最新 {{ profiles.length }} / {{ serverTotal }} 个画像，其余未加载；请通过搜索或筛选缩小范围。
          </div>
        </section>
      </section>
    </main>

    <el-dialog
      v-model="createDialogVisible"
      :title="editingProfile ? '编辑虚拟学习者' : '新建虚拟学习者'"
      width="min(640px, calc(100vw - 24px))"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="学习者称呼" prop="name">
          <el-input v-model="formData.name" placeholder="如：小林 / 王姐 / 店长A" />
        </el-form-item>

        <el-divider>基础身份</el-divider>
        <div class="ai-generate-section">
          <el-button type="primary" plain :loading="generatingScenario" @click="handleGeneratePersona">
            <el-icon><MagicStick /></el-icon>
            AI 一键生成身份
          </el-button>
        </div>
        <el-form-item label="年龄">
          <el-input-number v-model="formData.profile.age" :min="18" :max="60" style="width: 120px" />
        </el-form-item>

        <el-form-item label="职业">
          <el-input v-model="formData.profile.occupation" placeholder="如：产品经理" />
        </el-form-item>

        <el-form-item label="学历">
          <el-input v-model="formData.profile.education" placeholder="如：本科" />
        </el-form-item>

        <el-form-item label="背景描述">
          <el-input v-model="formData.profile.background" type="textarea" :rows="2" placeholder="简要背景" />
        </el-form-item>

        <el-divider>稳定特质</el-divider>

        <el-form-item label="核心人格">
          <el-input v-model="formData.profile.corePersonality" placeholder="长期反应特征" />
        </el-form-item>

        <el-form-item label="情感底色">
          <el-input v-model="formData.profile.emotionalBaseline" type="textarea" :rows="2" placeholder="常见情绪基调" />
        </el-form-item>

        <el-form-item label="求助模式">
          <el-input v-model="formData.profile.helpSeekingPattern" type="textarea" :rows="2" placeholder="遇阻时怎么求助" />
        </el-form-item>

        <el-form-item label="对抗模式">
          <el-input v-model="formData.profile.adversarialPattern" type="textarea" :rows="2" placeholder="不认同时的反应" />
        </el-form-item>

        <el-form-item label="元认知特征">
          <el-input v-model="formData.profile.metacognitiveProfile" type="textarea" :rows="2" placeholder="如何觉察卡点" />
        </el-form-item>

        <el-form-item label="负荷容忍度">
          <el-input v-model="formData.profile.cognitiveLoadTolerance" placeholder="信息过载时的反应" />
        </el-form-item>

        <el-form-item label="纠错方式">
          <el-input v-model="formData.profile.memoryRepairPattern" placeholder="出错后的修正方式" />
        </el-form-item>

        <el-divider>内部信息</el-divider>
        <el-form-item label="管理员备注">
          <el-input v-model="formData.notes" type="textarea" :rows="2" placeholder="管理员备注" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">
            {{ editingProfile ? '保存修改' : '创建并生成故事' }}
          </el-button>
        </template>
      </el-dialog>

    <el-drawer
      v-model="sessionDrawerVisible"
      :title="`${currentSessionProfile?.userName || ''} 的会话记录`"
      size="min(calc(100vw - 24px), 620px)"
      direction="rtl"
    >
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

    <el-dialog v-model="startSessionDialogVisible" title="启动虚拟学习者实验" width="min(640px, calc(100vw - 24px))" class="launch-dialog">
      <div class="start-session-panel">
        <div class="start-session-panel__head">
          <div>
            <strong>{{ startSessionTarget?.userName || '虚拟学习者' }}</strong>
            <p>选择 Story 和运行模式。正式稳定性测试建议使用黑盒 API。</p>
          </div>
          <el-tag type="info" effect="plain">{{ getStoryPool(startSessionTarget).length }} 个 Story</el-tag>
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
              <p>{{ summarizeStory(story.storyOutline || story.visibleOpening || '暂无故事摘要', 48) }}</p>
            </div>
          </label>
        </div>
        <div v-else class="empty-state small">暂无故事，请先到详情页生成。</div>

        <div v-if="getStoryPool(startSessionTarget).length" class="launch-options">
          <div class="launch-option-group">
            <span class="launch-option-group__label">运行模式</span>
            <el-radio-group v-model="launchMode" class="launch-mode-grid">
              <el-radio-button value="blackbox">
                <strong>黑盒 API</strong>
                <span>用户接口 + 旁路裁判</span>
              </el-radio-button>
              <el-radio-button value="assisted">
                <strong>辅助模拟</strong>
                <span>内部调试链路</span>
              </el-radio-button>
            </el-radio-group>
          </div>
          <div class="launch-option-group">
            <span class="launch-option-group__label">对抗预算</span>
            <el-select v-model="launchFrictionBudget" style="width: 100%">
              <el-option label="完全合作" value="none" />
              <el-option label="低：轻微顾虑" value="low" />
              <el-option label="正常：真实阻力" value="normal" />
              <el-option label="高：压力场景" value="high" />
              <el-option label="压测：高摩擦" value="stress_test" />
            </el-select>
          </div>
          <div class="launch-contract">
            <span>实验链路</span>
            <strong>{{ launchMode === 'blackbox' ? 'Goal → Path → Learn → Referee' : 'Goal → Path Review → Learn → Wrapup' }}</strong>
            <p>{{ launchMode === 'blackbox' ? '虚拟学习者只接收公开 Observation，内部诊断只供终局裁判读取。' : '用于内部调试和快速定位，不作为正式黑盒稳定性结论。' }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="startSessionDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="launchingSession" @click="confirmStartSession">{{ startSessionPrimaryActionLabel }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown,
  ArrowRight,
  Collection,
  DataAnalysis,
  Finished,
  MagicStick,
  MoreFilled,
  Plus,
  Refresh,
  Search,
  TrendCharts,
  User
} from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'
import AdminPageHeader from './components/AdminPageHeader.vue'

type ProfileFilter = 'all' | 'ready' | 'needsStory' | 'running' | 'review'
type LaunchMode = 'blackbox' | 'assisted'

interface VirtualStory {
  storyId?: string
  id?: string
  title?: string
  storyTitle?: string
  storyOutline?: string
  storyTriggerEvent?: string
  visibleOpening?: string
  sourceType?: string
  pressurePoints?: string[]
}

interface VirtualSessionSummary {
  id: string
  status?: string
  currentStage?: string
  storyId?: string
  story?: { id?: string }
  learningPathId?: string
  roundCount?: number
  createdAt?: string
  updatedAt?: string
}

interface VirtualLearnerProfileData {
  age?: number
  occupation?: string
  education?: string
  background?: string
  corePersonality?: string
  emotionalBaseline?: string
  helpSeekingPattern?: string
  adversarialPattern?: string
  metacognitiveProfile?: string
  cognitiveLoadTolerance?: string
  memoryRepairPattern?: string
  storyPool?: VirtualStory[]
}

interface VirtualLearnerProfile {
  id: string
  userName?: string
  learningGoal?: string
  simulationMode?: string
  simulationTemperature?: number
  personalityTraits?: {
    verbosity?: string
    enthusiasm?: string
    confusionStyle?: string
  }
  notes?: string
  profile?: VirtualLearnerProfileData
  sessions?: VirtualSessionSummary[]
  sessionCount?: number
}

interface PersonaSeed {
  nameHint?: string
  age?: number
  personalityTraits?: {
    verbosity?: string
    enthusiasm?: string
    confusionStyle?: string
  }
  [key: string]: unknown
}

// 优先使用后端返回的中文错误消息，其次用场景化兜底文案；
// 不直接展示 axios 原始英文消息（如 "Request failed with status code 500"）
const getErrorMessage = (error: unknown, fallback: string) => {
  const err = error as { response?: { data?: { error?: { message?: unknown } } } } | null
  const backendMessage = err?.response?.data?.error?.message
  return typeof backendMessage === 'string' && backendMessage ? backendMessage : fallback
}

const PERSONA_PROFILE_TEXT_FIELDS = [
  'occupation',
  'education',
  'background',
  'corePersonality',
  'emotionalBaseline',
  'helpSeekingPattern',
  'adversarialPattern',
  'metacognitiveProfile',
  'cognitiveLoadTolerance',
  'memoryRepairPattern'
] as const

const createEmptyFormData = () => ({
  name: '',
  profile: {
    age: undefined as number | undefined,
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
  personalityTraits: {
    verbosity: 'normal',
    enthusiasm: 'normal',
    confusionStyle: 'direct'
  },
  notes: ''
})

type VirtualLearnerForm = ReturnType<typeof createEmptyFormData>
type VirtualLearnerProfileDraft = VirtualLearnerForm['profile']

const router = useRouter()
const loading = ref(false)
const loadError = ref('')
const submitting = ref(false)
const generatingScenario = ref(false)
const profiles = ref<VirtualLearnerProfile[]>([])
// 服务端画像总数（用于检测 limit=100 截断并提示，> profiles.length 时说明有未加载数据）
const serverTotal = ref(0)
const profilesTruncated = computed(() => serverTotal.value > profiles.value.length)
const searchKeyword = ref('')
const activeFilter = ref<ProfileFilter>('all')
const selectedIds = ref<Set<string>>(new Set())
const focusedProfileId = ref('')
const isAllSelected = computed(() => {
  return pagedProfiles.value.length > 0 && pagedProfiles.value.every(p => selectedIds.value.has(p.id))
})
// EP 标准全选模式：当前页部分选中时全选 checkbox 显示半选态
const isSelectionIndeterminate = computed(() => {
  if (!pagedProfiles.value.length) return false
  const selectedCount = pagedProfiles.value.filter(p => selectedIds.value.has(p.id)).length
  return selectedCount > 0 && selectedCount < pagedProfiles.value.length
})
const pagination = ref({
  page: 1,
  limit: 12,
  total: 0
})

const createDialogVisible = ref(false)
const sessionDrawerVisible = ref(false)
const sessionsLoading = ref(false)
const currentSessionProfile = ref<VirtualLearnerProfile | null>(null)
const currentSessions = ref<VirtualSessionSummary[]>([])
const scenarioDraft = ref<Record<string, unknown> | null>(null)
const editingProfile = ref<VirtualLearnerProfile | null>(null)
const formRef = ref()
const startSessionDialogVisible = ref(false)
const startSessionTarget = ref<VirtualLearnerProfile | null>(null)
const startSessionStoryIndex = ref(0)
const launchMode = ref<LaunchMode>('blackbox')
const launchFrictionBudget = ref<'none' | 'low' | 'normal' | 'high' | 'stress_test'>('normal')
const launchingSession = ref(false)
const expandedProfileIds = ref<Set<string>>(new Set())

const startSessionPrimaryActionLabel = computed(() => {
  if (!getStoryPool(startSessionTarget.value).length) return '进入详情页'
  return launchMode.value === 'blackbox' ? '创建黑盒实验' : '创建辅助会话'
})

const getPipelineBucket = (profile: VirtualLearnerProfile): Exclude<ProfileFilter, 'all'> => {
  if (getStoryPool(profile).length === 0) return 'needsStory'
  const sessions = profile.sessions || []
  if (sessions.some((session) => session.status === 'running' || session.status === 'created')) return 'running'
  if (sessions.some((session) => ['completed', 'failed', 'abandoned'].includes(session.status || ''))) return 'review'
  return 'ready'
}

const experimentSteps = [
  { step: '01', title: '准备样本', desc: '完善稳定画像和至少一个 Story。' },
  { step: '02', title: '选择 Story', desc: '固定开场、压力点和问题知识。' },
  { step: '03', title: '黑盒运行', desc: '通过普通用户 API 推进 Goal、Path、Learn。' },
  { step: '04', title: '裁判评审', desc: '终态后生成独立报告。' }
]

const summarizeStory = (value: string, limit = 72) => {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact
}

const formData = ref<VirtualLearnerForm>(createEmptyFormData())

const formRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }]
}

const profileMatchesFilter = (profile: VirtualLearnerProfile, filter: ProfileFilter) => {
  return filter === 'all' || getPipelineBucket(profile) === filter
}

const filteredProfiles = computed(() => {
  return profiles.value.filter((p) => {
    const searchTarget = `${p.userName || ''} ${p.learningGoal || ''}`.toLowerCase()
    if (searchKeyword.value && !searchTarget.includes(searchKeyword.value.toLowerCase())) {
      return false
    }
    return profileMatchesFilter(p, activeFilter.value)
  })
})

const runnableProfileCount = computed(() => profiles.value.filter((item) => getPipelineBucket(item) === 'ready').length)

const profileFilterOptions = computed(() => {
  const getCount = (filter: ProfileFilter) => profiles.value.filter((profile) => profileMatchesFilter(profile, filter)).length
  return [
    { label: '全部', value: 'all' as ProfileFilter, count: getCount('all') },
    { label: '可运行', value: 'ready' as ProfileFilter, count: getCount('ready') },
    { label: '待准备', value: 'needsStory' as ProfileFilter, count: getCount('needsStory') },
    { label: '运行中', value: 'running' as ProfileFilter, count: getCount('running') },
    { label: '待评审', value: 'review' as ProfileFilter, count: getCount('review') }
  ]
})

const pagedProfiles = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.limit
  const end = start + pagination.value.limit
  return filteredProfiles.value.slice(start, end)
})

const groupedByInitial = computed(() => {
  const grouped = new Map<string, VirtualLearnerProfile[]>()

  pagedProfiles.value.forEach((profile) => {
    const initial = (profile.userName?.charAt(0) || '?').toUpperCase()
    if (!grouped.has(initial)) {
      grouped.set(initial, [])
    }
    grouped.get(initial)!.push(profile)
  })
  
  return Array.from(grouped.entries())
    .map(([initial, profiles]) => ({ initial, profiles }))
    .sort((a, b) => a.initial.localeCompare(b.initial))
})

const pagedProfilesGrouped = computed(() => {
  if (filteredProfiles.value.length <= 20) {
    return [{ initial: '', profiles: pagedProfiles.value }]
  }
  return groupedByInitial.value
})

const recentSessions = computed(() => {
  const sessions = profiles.value.flatMap((profile) =>
    (profile.sessions || []).map((session) => ({
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
    .sort((a, b) => new Date((b.updatedAt || b.createdAt)!).getTime() - new Date((a.updatedAt || a.createdAt)!).getTime())
    .slice(0, 8)
})

const summaryCards = computed(() => {
  const totalProfiles = profiles.value.length
  const totalSessions = profiles.value.reduce((sum: number, item) => sum + (item.sessionCount || 0), 0)
  const autoProfiles = profiles.value.filter((item) => item.simulationMode === 'ai').length
  const withStories = profiles.value.filter((item) => getStoryPool(item).length > 0).length

  const allSessions = profiles.value.flatMap((item) => item.sessions || [])
  const completedSessions = allSessions.filter((item) => item.status === 'completed').length
  const failedSessions = allSessions.filter((item) => item.status === 'failed').length
  const runningSessions = allSessions.filter((item) => item.status === 'running').length
  const goalReadySessions = allSessions.filter((item) => item.currentStage === 'path' || item.currentStage === 'learning' || item.status === 'completed').length
  const pathReadySessions = allSessions.filter((item) => item.learningPathId || item.currentStage === 'learning' || item.status === 'completed').length
  const learnCompletedSessions = completedSessions

  const totalSessionBase = Math.max(allSessions.length, 1)
  const goalReadyRate = `${Math.round((goalReadySessions / totalSessionBase) * 100)}%`
  const pathReadyRate = `${Math.round((pathReadySessions / totalSessionBase) * 100)}%`
  const learnCompletionRate = `${Math.round((learnCompletedSessions / totalSessionBase) * 100)}%`
  const storyProgress = totalProfiles > 0 ? Math.round((withStories / totalProfiles) * 100) : 0
  const runningProgress = totalSessions > 0 ? Math.round((runningSessions / totalSessions) * 100) : 0
  const pathProgress = Math.round((pathReadySessions / totalSessionBase) * 100)
  const learnProgress = Math.round((learnCompletedSessions / totalSessionBase) * 100)

  return [
    {
      label: '样本与故事',
      value: `${totalProfiles}`,
      helper: `${withStories} 个有故事，${totalProfiles - withStories} 个待补故事`,
      tone: 'tone-blue',
      icon: Collection,
      progress: storyProgress
    },
    {
      label: '实验进度',
      value: String(totalSessions),
      helper: `${runningSessions} 运行中 / ${completedSessions} 完成 / ${failedSessions} 失败`,
      tone: 'tone-dark',
      icon: DataAnalysis,
      progress: runningProgress
    },
    {
      label: 'Goal / Path',
      value: `${goalReadyRate} / ${pathReadyRate}`,
      helper: `${goalReadySessions}/${allSessions.length || 0} 进入 Path，${pathReadySessions}/${allSessions.length || 0} 生成路径`,
      tone: 'tone-green',
      icon: TrendCharts,
      progress: pathProgress
    },
    {
      label: 'Learn 完成率',
      value: learnCompletionRate,
      helper: `${learnCompletedSessions}/${allSessions.length || 0} 完整跑通，${autoProfiles} 个 AI 画像样本`,
      tone: 'tone-amber',
      icon: Finished,
      progress: learnProgress
    }
  ]
})

const virtualLearnerHighlights = computed(() => [
  { label: `${profiles.value.length} 个样本`, tone: 'info' as const },
  { label: `${recentSessions.value.length} 个最近诊断`, tone: 'neutral' as const },
  { label: `${runnableProfileCount.value} 个可运行`, tone: 'success' as const },
  { label: activeFilter.value === 'all' ? '当前查看全部样本' : `筛选 ${profileFilterOptions.value.find(item => item.value === activeFilter.value)?.label || activeFilter.value}`, tone: 'warning' as const }
])

const formatTime = (time: string | Date | null | undefined) => {
  if (!time) return '-'
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const formatRelativeTime = (time: string | Date | null | undefined) => {
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

const setFilter = (value: ProfileFilter) => {
  activeFilter.value = value
  pagination.value.page = 1
  selectedIds.value = new Set()
}

const loadProfiles = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await adminApi.getVirtualLearners({
      page: 1,
      limit: 100
    })
    if (res.data?.success) {
      profiles.value = res.data.data?.profiles || []
      // 服务端返回全量 total；超过本次 limit 拉取数量时说明列表被截断
      serverTotal.value = Number(res.data.data?.pagination?.total ?? profiles.value.length)
      pagination.value.total = profiles.value.length
    }
  } catch (error) {
    loadError.value = '无法获取虚拟学习者数据，请检查服务连接后重试。'
    ElMessage.error(getErrorMessage(error, '加载失败'))
  } finally {
    loading.value = false
  }
}

const handlePageChange = (page: number) => {
  pagination.value.page = page
}

const scrollToLetter = (letter: string) => {
  const element = document.querySelector(`[data-letter="${letter}"]`)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const hasCompletePersonaProfile = (profile: VirtualLearnerProfileDraft) => {
  return PERSONA_PROFILE_TEXT_FIELDS.every((field) => normalizeText(profile[field]))
}

const buildExistingPersonaSeed = () => {
  const currentProfile = formData.value.profile
  return {
    nameHint: normalizeText(formData.value.name) || undefined,
    age: typeof currentProfile.age === 'number' ? currentProfile.age : undefined,
    occupation: normalizeText(currentProfile.occupation) || undefined,
    education: normalizeText(currentProfile.education) || undefined,
    background: normalizeText(currentProfile.background) || undefined,
    corePersonality: normalizeText(currentProfile.corePersonality) || undefined,
    emotionalBaseline: normalizeText(currentProfile.emotionalBaseline) || undefined,
    helpSeekingPattern: normalizeText(currentProfile.helpSeekingPattern) || undefined,
    adversarialPattern: normalizeText(currentProfile.adversarialPattern) || undefined,
    metacognitiveProfile: normalizeText(currentProfile.metacognitiveProfile) || undefined,
    cognitiveLoadTolerance: normalizeText(currentProfile.cognitiveLoadTolerance) || undefined,
    memoryRepairPattern: normalizeText(currentProfile.memoryRepairPattern) || undefined,
    personalityTraits: {
      ...formData.value.personalityTraits
    }
  }
}

const applyPersonaSeedToForm = (personaSeed: PersonaSeed, options: { preferExisting?: boolean } = {}) => {
  const preferExisting = options.preferExisting ?? false
  const currentForm = formData.value
  const currentProfile = currentForm.profile
  const currentTraits = currentForm.personalityTraits
  const generatedProfile: PersonaSeed = personaSeed && typeof personaSeed === 'object' ? { ...personaSeed } : {}
  delete generatedProfile.personalityTraits

  const pickText = (currentValue: string, generatedValue: unknown) => {
    if (preferExisting && normalizeText(currentValue)) {
      return currentValue
    }
    return normalizeText(generatedValue) || currentValue || ''
  }

  const nextProfile: VirtualLearnerProfileDraft & Record<string, unknown> = {
    ...generatedProfile,
    age: preferExisting && typeof currentProfile.age === 'number'
      ? currentProfile.age
      : (typeof generatedProfile.age === 'number' ? generatedProfile.age : currentProfile.age),
    occupation: pickText(currentProfile.occupation, generatedProfile.occupation),
    education: pickText(currentProfile.education, generatedProfile.education),
    background: pickText(currentProfile.background, generatedProfile.background),
    corePersonality: pickText(currentProfile.corePersonality, generatedProfile.corePersonality),
    emotionalBaseline: pickText(currentProfile.emotionalBaseline, generatedProfile.emotionalBaseline),
    helpSeekingPattern: pickText(currentProfile.helpSeekingPattern, generatedProfile.helpSeekingPattern),
    adversarialPattern: pickText(currentProfile.adversarialPattern, generatedProfile.adversarialPattern),
    metacognitiveProfile: pickText(currentProfile.metacognitiveProfile, generatedProfile.metacognitiveProfile),
    cognitiveLoadTolerance: pickText(currentProfile.cognitiveLoadTolerance, generatedProfile.cognitiveLoadTolerance),
    memoryRepairPattern: pickText(currentProfile.memoryRepairPattern, generatedProfile.memoryRepairPattern)
  }

  formData.value = {
    ...currentForm,
    name: preferExisting && normalizeText(currentForm.name)
      ? currentForm.name
      : (normalizeText(personaSeed?.nameHint) || currentForm.name || normalizeText(generatedProfile.occupation) || '随机样本'),
    profile: nextProfile,
    simulationMode: 'ai',
    personalityTraits: {
      verbosity: preferExisting && normalizeText(currentTraits.verbosity)
        ? currentTraits.verbosity
        : (personaSeed?.personalityTraits?.verbosity || currentTraits.verbosity || 'normal'),
      enthusiasm: preferExisting && normalizeText(currentTraits.enthusiasm)
        ? currentTraits.enthusiasm
        : (personaSeed?.personalityTraits?.enthusiasm || currentTraits.enthusiasm || 'normal'),
      confusionStyle: preferExisting && normalizeText(currentTraits.confusionStyle)
        ? currentTraits.confusionStyle
        : (personaSeed?.personalityTraits?.confusionStyle || currentTraits.confusionStyle || 'direct')
    }
  }
}

const resetForm = () => {
  scenarioDraft.value = null
  formData.value = createEmptyFormData()
}

const openCreateDialog = () => {
  editingProfile.value = null
  resetForm()
  createDialogVisible.value = true
}

const openEditDialog = (profile: VirtualLearnerProfile) => {
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
    const res = await adminApi.generatePersona({
      existingPersonaSeed: buildExistingPersonaSeed()
    })
    const persona = res.data?.data
    if (res.data?.success && persona?.personaSeed) {
      scenarioDraft.value = null
      applyPersonaSeedToForm(persona.personaSeed)
      ElMessage.success('学习者身份已生成')
    } else {
      ElMessage.error(res.data?.error || '学习者身份生成失败')
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '学习者身份生成失败'))
  } finally {
    generatingScenario.value = false
  }
}

const getStorySourceLabel = (value: string | undefined) => {
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

const getStoryPool = (profile: VirtualLearnerProfile | null | undefined): VirtualStory[] => {
  if (!profile) return []
  const profileData = profile.profile || {}
  return Array.isArray(profileData.storyPool) ? profileData.storyPool.filter((story) => story && typeof story === 'object') : []
}

const getStorySessionStats = (profile: VirtualLearnerProfile | null | undefined, storyId: string | undefined) => {
  const sessions = profile?.sessions || []
  const storySessions = sessions.filter((s) => s.storyId === storyId || s.story?.id === storyId)
  const total = storySessions.length
  const completed = storySessions.filter((s) => s.status === 'completed').length
  const running = storySessions.filter((s) => s.status === 'running').length
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0
  
  const lastSession = storySessions.length > 0 ? storySessions[0] : null
  const lastRunTime = lastSession ? lastSession.updatedAt || lastSession.createdAt : null
  
  return {
    total,
    completed,
    running,
    completionRate,
    lastRunTime,
    isEmpty: total === 0
  }
}

const getLatestSession = (profile: VirtualLearnerProfile) => {
  const sessions = profile?.sessions || []
  return sessions[0] || null
}

const getProfileStageStatus = (profile: VirtualLearnerProfile) => {
  const latest = getLatestSession(profile)
  if (!latest) return { label: '未开始', className: 'status-pill--idle' }
  if (latest.status === 'failed') return { label: '失败', className: 'status-pill--danger' }
  if (latest.status === 'completed') return { label: '已完成', className: 'status-pill--success' }
  if (latest.status === 'running') return { label: getSessionStageLabel(latest.currentStage), className: 'status-pill--running' }
  return { label: getSessionStageLabel(latest.currentStage), className: 'status-pill--idle' }
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
      const res = await adminApi.updateVirtualLearner(editingProfile.value.id, {
        ...formData.value,
        profile: {
          ...(editingProfile.value.profile || {}),
          ...formData.value.profile
        }
      })
      if (res.data?.success) {
        ElMessage.success('更新成功')
        createDialogVisible.value = false
        loadProfiles()
      }
    } else {
      let autoPersonaApplied = false
      if (!hasCompletePersonaProfile(formData.value.profile)) {
        const personaRes = await adminApi.generatePersona({
          existingPersonaSeed: buildExistingPersonaSeed()
        })
        const persona = personaRes.data?.data
        if (!personaRes.data?.success || !persona?.personaSeed) {
          throw new Error(personaRes.data?.error || '学习者身份生成失败')
        }
        applyPersonaSeedToForm(persona.personaSeed, { preferExisting: true })
        autoPersonaApplied = true
      }

      const res = await adminApi.createVirtualLearner(formData.value)
      if (res.data?.success) {
        const createdProfileId = res.data?.data?.id
        let storyCreated = false

        if (createdProfileId) {
          try {
            const storyRes = await adminApi.draftVirtualLearnerStories(createdProfileId)
            storyCreated = !!storyRes.data?.success
          } catch {
            storyCreated = false
          }
        }

        if (storyCreated) {
          ElMessage.success(autoPersonaApplied ? '创建成功，已自动补全画像并生成故事' : '创建成功，已自动生成 1 个故事')
        } else {
          ElMessage.warning(autoPersonaApplied ? '创建成功，已自动补全画像；故事生成失败，请进入详情页重试' : '创建成功，但自动生成故事失败，请进入详情页重试')
        }
        createDialogVisible.value = false
        loadProfiles()
      }
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '操作失败'))
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (profile: VirtualLearnerProfile) => {
  try {
    await ElMessageBox.confirm(`确定删除虚拟学习者 "${profile.userName}"？该用户的学习数据也会被删除。`, '确认删除', { type: 'warning' })
    const res = await adminApi.deleteVirtualLearner(profile.id)
    if (res.data?.success) {
      ElMessage.success('删除成功')
      loadProfiles()
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, '删除失败'))
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

const toggleProfileExpand = (profileId: string) => {
  const next = new Set(expandedProfileIds.value)
  if (next.has(profileId)) {
    next.delete(profileId)
  } else {
    next.add(profileId)
  }
  expandedProfileIds.value = next
}

const isProfileExpanded = (profileId: string) => {
  return expandedProfileIds.value.has(profileId)
}

const openStoryDetail = (profile: VirtualLearnerProfile, story: VirtualStory) => {
  const storyId = story.storyId || story.id || story.title
  router.push(`/admin/virtual-learners/${profile.id}/stories/${storyId}`)
}

const openStoryLaunch = (profile: VirtualLearnerProfile, story: VirtualStory) => {
  startSessionTarget.value = profile
  startSessionStoryIndex.value = Math.max(0, getStoryPool(profile).findIndex((item) =>
    (item.storyId || item.id) === (story.storyId || story.id)
  ))
  launchMode.value = 'blackbox'
  launchFrictionBudget.value = 'normal'
  startSessionDialogVisible.value = true
}

const generateStoryForProfile = async (profile: VirtualLearnerProfile) => {
  try {
    await adminApi.draftVirtualLearnerStories(profile.id)
    ElMessage.success('故事生成成功')
    loadProfiles()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '生成故事失败'))
  }
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
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.data?.success).length
    const failCount = count - successCount
    if (successCount > 0) {
      ElMessage.success(`成功删除 ${successCount} 个`)
    }
    if (failCount > 0) {
      ElMessage.warning(`${failCount} 个删除失败`)
    }
    selectedIds.value = new Set()
    loadProfiles()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, '批量删除失败'))
    }
  }
}

const getSessionStatusType = (status: string | undefined) => {
  switch (status) {
    case 'running':
      return 'success'
    case 'completed':
      return 'info'
    case 'abandoned':
      return 'warning'
    case 'failed':
      return 'danger'
    default:
      return 'warning'
  }
}

const getSessionStatusLabel = (status: string | undefined) => {
  switch (status) {
    case 'created':
      return '已创建'
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'abandoned':
      return '已放弃'
    case 'failed':
      return '失败'
    default:
      return status || '未知'
  }
}

const getSessionStageLabel = (stage: string | undefined) => {
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

const goToProfile = (profile: VirtualLearnerProfile) => {
  router.push(`/admin/virtual-learners/${profile.id}`)
}

const openSessionDrawer = async (profile: VirtualLearnerProfile) => {
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

const confirmStartSession = async () => {
  if (!startSessionTarget.value) return
  const storyPool = getStoryPool(startSessionTarget.value)
  const story = storyPool[startSessionStoryIndex.value] || storyPool[0]

  if (!story) {
    startSessionDialogVisible.value = false
    router.push(`/admin/virtual-learners/${startSessionTarget.value.id}`)
    return
  }

  launchingSession.value = true
  try {
    const payload = {
      storyId: story.storyId || story.id,
      storyIndex: startSessionStoryIndex.value,
      frictionBudget: launchFrictionBudget.value
    }
    const res = launchMode.value === 'blackbox'
      ? await adminApi.startBlackboxVirtualSession(startSessionTarget.value.id, payload)
      : await adminApi.startVirtualSession(startSessionTarget.value.id, payload)
    const created = res.data?.data || res.data
    const sessionId = created?.id || created?.sessionId
    if (!res.data?.success || !sessionId) throw new Error(res.data?.error || '会话创建成功但未返回 sessionId')
    ElMessage.success(launchMode.value === 'blackbox' ? '黑盒实验已创建' : '辅助会话已创建')
    startSessionDialogVisible.value = false
    router.push(`/admin/virtual-session/${sessionId}`)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || error.message || '启动失败')
  } finally {
    launchingSession.value = false
  }
}

const deleteSession = async (sessionId: string) => {
  try {
    await ElMessageBox.confirm('确定删除此会话？相关数据将被清除。', '确认删除', { type: 'warning' })
    const res = await adminApi.deleteVirtualSession(sessionId)
    if (res.data?.success) {
      ElMessage.success('会话已删除')
      currentSessions.value = currentSessions.value.filter((s) => s.id !== sessionId)
      loadProfiles()
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, '删除失败'))
    }
  }
}

onMounted(() => {
  loadProfiles()
})

watch(filteredProfiles, () => {
  const maxPage = Math.max(Math.ceil(filteredProfiles.value.length / pagination.value.limit), 1)
  if (pagination.value.page > maxPage) {
    pagination.value.page = maxPage
  }

  if (!filteredProfiles.value.length) {
    focusedProfileId.value = ''
    return
  }

  if (!filteredProfiles.value.some((item) => item.id === focusedProfileId.value)) {
    focusedProfileId.value = filteredProfiles.value[0].id
  }
})
</script>

<style scoped>
.learner-lab-page {
  min-height: 100vh;
  color: #1f2937;
  display: flex !important;
  flex-direction: column;
  gap: 12px;
}

.learner-lab-page :deep(.admin-page-header) {
  margin-bottom: 12px;
  padding-bottom: 12px;
  height: fit-content;
}

.learner-lab-page :deep(.admin-page-header__highlights) {
  margin-top: 6px;
}

.page-header,
.summary-grid,
.toolbar-card,
.page-shell {
  max-width: 1440px;
  margin: 0 auto;
  width: 100%;
}

.experiment-guide > strong {
  color: var(--admin-text-primary);
  font-size: 14px;
}

.experiment-guide > p {
  margin: 8px 0 12px;
  color: var(--admin-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.experiment-guide ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 20px;
}

.experiment-guide li span,
.experiment-guide li small {
  display: block;
}

.experiment-guide li span {
  color: var(--admin-text-primary);
  font-size: 12px;
  font-weight: 700;
}

.experiment-guide li small {
  margin-top: 2px;
  color: var(--admin-text-muted);
  line-height: 1.45;
}

.lab-main {
  width: 100%;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
  margin-bottom: 12px;
}

.summary-card {
  --card-accent: #2f6fed;
  display: grid;
  gap: 14px;
  min-height: 134px;
  padding: 16px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 10px 24px rgba(31, 41, 55, 0.045);
}

.summary-card__top,
.summary-card__body,
.profile-card__head,
.profile-card__footer,
.profile-meta-row,
.profile-card__signals,
.session-row__meta {
  display: flex;
  align-items: center;
}

.summary-card__top {
  gap: 9px;
}

.summary-card__icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--card-accent) 12%, white);
  color: var(--card-accent);
}

.summary-card__label {
  color: #697386;
  font-size: 12px;
  font-weight: 700;
}

.summary-card__body {
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.summary-card__value {
  color: #1f2937;
  font-size: 26px;
  line-height: 1;
  white-space: nowrap;
}

.summary-card__helper {
  color: #667085;
  font-size: 12px;
  line-height: 1.45;
}

.summary-card__bar {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf2f7;
}

.summary-card__bar i {
  display: block;
  height: 100%;
  min-width: 6px;
  border-radius: inherit;
  background: var(--card-accent);
}

.tone-dark {
  --card-accent: #475467;
}

.tone-green {
  --card-accent: #15957b;
}

.tone-amber {
  --card-accent: #d9822b;
}

.toolbar-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  width: 100%;
  height: fit-content;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(209, 218, 235, 0.7);
  background: #fafbfc;
}

.page-shell {
  margin-top: 0;
}

.lab-panel {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.lab-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 0 0 14px;
  margin-bottom: 0;
  border-bottom: var(--admin-border-subtle);
}

.toolbar-card__group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.toolbar-card__search {
  width: 100%;
}

.toolbar-card__filters {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #dfe7f1;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #5f6b7d;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.filter-chip strong {
  color: #1f2937;
  font-size: 12px;
}

.filter-chip.active {
  border-color: #2f6fed;
  background: #eef5ff;
  color: #1f5dbb;
}

.view-mode-toggle {
  flex-shrink: 0;
}

.alphabet-index {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.alphabet-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.alphabet-btn:hover {
  border-color: #3478f6;
  background: #f0f5ff;
  color: #3478f6;
}

.group-header {
  grid-column: 1 / -1;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 8px;
  color: #6b7280;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.05em;
  margin-top: 8px;
}

.lab-main,
.lab-side,
.session-list,
.story-draft-panel,
.start-session-panel,
.start-session-story-list {
  display: grid;
  gap: 12px;
}

.lab-side {
  position: sticky;
  top: 16px;
}

.lab-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.lab-panel--focus,
.lab-panel--sessions {
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
}

.lab-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 0 0 12px;
  border-bottom: var(--admin-border-subtle);
}

.lab-panel__head--stack {
  padding: 0 0 14px;
}

.lab-panel__head-left,
.lab-panel__head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lab-panel__title {
  color: var(--admin-text-primary);
  font-size: 14px;
  font-weight: 750;
}

.lab-panel__meta {
  color: var(--admin-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.lab-panel__meta--stack {
  display: block;
  margin-top: 4px;
  line-height: 1.5;
  white-space: normal;
}

.select-count {
  color: #6b7280;
  font-size: 12px;
}

.profile-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  padding: 0;
}

.profile-accordion {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
}

.profile-accordion-item {
  border: 1px solid #e6ebf2;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
  transition: all 0.2s ease;
  width: 100%;
}

.profile-accordion-item:hover {
  border-color: #d0dae8;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.profile-accordion-item--expanded {
  border-color: #3478f6;
  box-shadow: 0 2px 12px rgba(52, 120, 246, 0.12);
}

.profile-accordion-item--selected {
  background: #f0f5ff;
}

.profile-accordion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;
}

.profile-accordion-header:hover {
  background: #fafbfc;
}

.profile-accordion-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  max-width: 50%;
}

.profile-accordion-header__identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.profile-accordion-header__identity strong {
  font-size: 15px;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-meta-compact {
  font-size: 13px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-accordion-header__right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.expand-icon {
  flex-shrink: 0;
  transition: transform 0.2s ease;
  color: #6b7280;
}

.meta-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #f3f4f6;
  border-radius: 999px;
  font-size: 13px;
  color: #6b7280;
  white-space: nowrap;
}

.meta-badge .el-icon {
  font-size: 14px;
}

.profile-accordion-content {
  border-top: 1px solid #e6ebf2;
  padding: 16px;
  background: #fafbfc;
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.profile-accordion-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.empty-story-hint {
  padding: 32px;
  text-align: center;
  color: #8b94a6;
  font-size: 14px;
  background: #ffffff;
  border-radius: 8px;
  border: 1px dashed #d1d5db;
}

.story-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.story-card {
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e6ebf2;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.story-card:hover {
  border-color: #3478f6;
  box-shadow: 0 2px 8px rgba(52, 120, 246, 0.08);
}

.story-card__header {
  margin-bottom: 12px;
}

.story-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.story-card__icon {
  font-size: 18px;
  flex-shrink: 0;
}

.story-card__title strong {
  font-size: 15px;
  color: #1f2937;
  flex: 1;
}

.story-card__outline {
  margin: 0 0 12px 0;
  color: #526074;
  font-size: 13px;
  line-height: 1.6;
}

.story-card__pressures {
  margin-bottom: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e5e7eb;
}

.story-card__stats {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #f9fafb;
  border-radius: 6px;
  flex-wrap: wrap;
}

.stat-item {
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.stat-item--success {
  color: #15957b;
  font-weight: 600;
}

.stat-item--warning {
  color: #d9822b;
  font-weight: 600;
}

.stat-item--muted {
  color: #9ca3af;
}

.story-card__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.launch-options,
.launch-option-group {
  display: grid;
  gap: 10px;
}

.launch-options {
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid #e6ebf2;
}

.launch-option-group__label {
  color: #344054;
  font-size: 12px;
  font-weight: 750;
}

.launch-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.launch-mode-grid :deep(.el-radio-button) {
  width: 100%;
}

.launch-mode-grid :deep(.el-radio-button__inner) {
  display: grid;
  gap: 4px;
  width: 100%;
  min-height: 66px;
  padding: 12px 14px;
  border: 1px solid #dfe7f1 !important;
  border-radius: 9px !important;
  box-shadow: none !important;
  text-align: left;
}

.launch-mode-grid :deep(.el-radio-button__inner strong),
.launch-mode-grid :deep(.el-radio-button__inner span) {
  display: block;
}

.launch-mode-grid :deep(.el-radio-button__inner span) {
  color: #7a8597;
  font-size: 11px;
}

.launch-mode-grid :deep(.el-radio-button.is-active .el-radio-button__inner) {
  border-color: #3478f6 !important;
  background: #eef5ff;
  color: #1f5dbb;
}

.launch-contract {
  display: grid;
  gap: 5px;
  padding: 13px 14px;
  border-left: 3px solid #3478f6;
  background: #f7faff;
}

.launch-contract span,
.launch-contract p {
  color: #667085;
  font-size: 11px;
}

.launch-contract p {
  margin: 0;
  line-height: 1.5;
}

.launch-contract strong {
  color: #1f2937;
  font-size: 13px;
}

.profile-card {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  padding: 14px 16px;
  border: 1px solid #e6ebf2;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  cursor: pointer;
  transition: all 0.15s ease;
}

.profile-card:hover {
  border-color: #d0dae8;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}

.profile-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: transparent;
}

.profile-card--running::before {
  background: #2f6fed;
}

.profile-card--needs-story::before {
  background: #d9822b;
}

.profile-card--completed::before {
  background: #15957b;
}

.profile-card--selected {
  background: #f0f5ff;
  border-color: #3478f6;
}

.profile-card--focused {
  box-shadow: 0 0 0 2px rgba(52, 120, 246, 0.2);
  border-color: #3478f6;
}

.profile-card__select {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.profile-card__primary {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.profile-card__head {
  gap: 10px;
  min-width: 0;
  justify-content: space-between;
}

.profile-card__identity {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.profile-card__identity strong {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

.profile-card__meta-compact {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.4;
}

.profile-card__badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: auto;
  flex-shrink: 0;
}

.profile-meta-row {
  gap: 12px;
  flex-wrap: wrap;
}

.profile-meta-row .meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #6b7280;
}

.profile-meta-row .meta-item .el-icon {
  font-size: 14px;
  color: #9ca3af;
}

.profile-card__stage-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 6px;
}

.profile-card__stage-progress .stage-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.profile-card__footer {
  gap: 8px;
  margin-top: 2px;
}

.avatar-badge {
  width: 36px;
  height: 36px;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #2f6fed, #4da3ff);
  color: #fff;
  font-size: 15px;
  font-weight: 750;
}

.avatar-badge--lg {
  width: 42px;
  height: 42px;
  font-size: 16px;
}

.focus-profile {
  display: grid;
  gap: 14px;
}

.focus-profile__hero,
.focus-metric-card {
  border: none;
  border-radius: 0;
  background: transparent;
}

.focus-profile__hero {
  padding: 0 0 12px;
  display: grid;
  gap: 10px;
  border-bottom: 1px solid #edf2f7;
}

.focus-profile__identity {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.focus-profile__copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.focus-profile__copy strong {
  color: #1f2937;
  font-size: 15px;
}

.focus-profile__copy > span {
  color: #7a8597;
  font-size: 12px;
}

.focus-profile__badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.focus-profile__summary {
  margin: 0;
  color: #5f6b7d;
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.focus-profile__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid #edf2f7;
  border-bottom: 1px solid #edf2f7;
}

.focus-metric-card {
  padding: 12px 10px;
  display: grid;
  gap: 5px;
  border-right: 1px solid #edf2f7;
}

.focus-metric-card:last-child {
  border-right: none;
}

.focus-metric-card span {
  color: #8a94a6;
  font-size: 11px;
}

.focus-metric-card strong {
  color: #1f2937;
  font-size: 14px;
}

.focus-profile__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.focus-profile__actions .el-button {
  flex: 1 1 96px;
}

.focus-profile__hint,
.focus-profile__empty {
  margin: 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.6;
}

.profile-card__identity {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.profile-card__identity strong {
  overflow: hidden;
  color: #1f2937;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-card__identity span {
  overflow: hidden;
  color: #7a8597;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-card__badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-left: auto;
}

.status-pill,
.session-status {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 22px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.status-pill--ready,
.status-pill--running,
.session-status--running {
  background: #eef5ff;
  color: #1f5dbb;
}

.status-pill--primary {
  background: #3478f6;
  color: #ffffff;
  font-weight: 600;
}

.status-pill--success,
.session-status--completed {
  background: #eaf8f4;
  color: #087767;
}

.status-pill--warning,
.session-status--created {
  background: #fff5e6;
  color: #a75d13;
}

.status-pill--danger,
.session-status--failed {
  background: #fff1f0;
  color: #b42318;
}

.status-pill--idle {
  background: #f2f4f7;
  color: #667085;
}

.mini-stat {
  min-width: 0;
  padding: 2px 0;
  border: none;
  border-radius: 0;
  background: transparent;
}

.mini-stat span {
  display: block;
  margin-bottom: 4px;
  color: #8a94a6;
  font-size: 11px;
}

.mini-stat strong {
  display: block;
  overflow: hidden;
  color: #344054;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-card__footer {
  grid-column: 3;
  justify-content: flex-start;
  gap: 7px;
  flex-wrap: wrap;
  padding-left: 12px;
}

.profile-card__footer .el-button {
  flex-shrink: 0;
  font-size: 12px;
  padding: 7px 12px;
}

.profile-card__more {
  width: 32px;
  padding: 7px 0;
}

.pagination-row {
  display: flex;
  justify-content: center;
  padding: 16px 0 0;
  border-top: 1px solid #edf2f7;
}

.truncation-hint {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #f3d19e;
  background: #fdf6ec;
  color: #b88230;
  font-size: 12.5px;
  text-align: center;
}

.session-list--compact {
  gap: 0;
}

.session-row {
  display: grid;
  gap: 8px;
  padding: 12px 0;
  border-bottom: var(--admin-border-subtle);
}

.session-row:last-child {
  border-bottom: 0;
}

.session-row__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.session-row__main {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.session-row__identity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.session-row strong {
  display: block;
  overflow: hidden;
  color: #1f2937;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-row p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.session-row__top .el-button {
  flex-shrink: 0;
  padding: 0;
}

.session-funnel {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.session-funnel--inline {
  display: inline-flex;
  gap: 4px;
}

.session-funnel span {
  padding: 4px 6px;
  border-radius: 6px;
  background: #f2f4f7;
  color: #98a2b3;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

.session-funnel--inline span {
  padding: 3px 8px;
  font-size: 11px;
}

.session-funnel span.active {
  background: #eef5ff;
  color: #1f5dbb;
}

.session-funnel span.done {
  background: #eaf8f4;
  color: #087767;
}

.session-row__meta {
  gap: 6px;
  flex-wrap: wrap;
  color: #8a94a6;
  font-size: 11px;
}

.session-row__active {
  color: #667085;
}

.empty-state {
  margin: 0;
  padding: 28px;
  border: 1px dashed #d8e1ec;
  border-radius: 8px;
  background: #fbfcfe;
  color: #8a94a6;
  text-align: center;
}

.empty-state.small {
  margin: 0;
  padding: 22px;
}

.start-session-story,
.story-card,
.story-draft-panel__head {
  border: 1px solid #e6ebf2;
  border-radius: 8px;
  background: #fbfcfe;
}

.story-draft-panel__head,
.story-card,
.start-session-story {
  padding: 12px 14px;
}

.story-card.primary,
.start-session-story.active {
  border-color: #bcd3ff;
  background: #f7fbff;
}

.story-card__head,
.start-session-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.story-card p,
.start-session-story p {
  margin: 0;
  color: #5f6b7d;
  font-size: 12px;
  line-height: 1.5;
}

.story-card__line {
  display: grid;
  gap: 2px;
  margin-bottom: 8px;
}

.story-card__line:last-child {
  margin-bottom: 0;
}

.story-card__line span {
  color: #8a94a6;
  font-size: 11px;
}

.story-card__line strong {
  color: #334155;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}

.start-session-story {
  display: flex;
  gap: 10px;
  cursor: pointer;
}

.start-session-story input {
  margin-top: 3px;
}

.start-session-story strong {
  display: block;
  margin-bottom: 4px;
  color: #1f2937;
  font-size: 13px;
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
  color: #6b7280;
  font-size: 13px;
}

.ai-generate-section {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.ai-generate-hint {
  color: #98a2b3;
  font-size: 12px;
}

@media (max-width: 1320px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .page-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .lab-side {
    position: static;
  }

  .focus-profile__metrics {
    grid-template-columns: 1fr;
  }

  .focus-metric-card {
    border-right: none;
    border-bottom: 1px solid #edf2f7;
  }

  .focus-metric-card:last-child {
    border-bottom: none;
  }
}

@media (max-width: 1380px) {
  .profile-card {
    grid-template-columns: 24px minmax(0, 1fr);
    align-items: start;
  }

  .profile-card__signals,
  .profile-card__footer {
    grid-column: 2;
  }

  .profile-card__signals {
    padding-left: 0;
    border-left: 0;
  }

  .profile-card__footer {
    padding-left: 0;
  }

  .profile-card__summary {
    -webkit-line-clamp: 3;
  }
}

@media (max-width: 1080px) {
  .toolbar-card {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-card__group,
  .toolbar-card__search {
    width: 100%;
  }

  .toolbar-card__filters {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .learner-lab-page {
    padding: 14px;
  }

  .page-header {
    flex-direction: column;
    padding: 16px;
  }

  .page-header__actions {
    width: 100%;
  }

  .page-header__actions .el-button {
    flex: 1;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .launch-mode-grid {
    grid-template-columns: 1fr;
  }

  .profile-accordion-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .profile-accordion-header__left {
    max-width: none;
    width: 100%;
  }

  .profile-accordion-header__right {
    width: 100%;
    flex-wrap: wrap;
  }

  .profile-card {
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 10px;
    padding: 14px;
  }

  .profile-card__head {
    align-items: flex-start;
  }

  .profile-card__badges {
    width: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }

  .profile-card__signals {
    grid-template-columns: 1fr;
  }

  .filter-chip {
    flex: 1;
    justify-content: center;
  }
}
</style>
