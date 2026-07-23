<template>
  <div class="profile-page">
    <header class="page-header">
      <div class="page-header__main">
        <el-button text @click="router.push('/admin/virtual-learners')">
          <el-icon><ArrowLeft /></el-icon>
          返回总控台
        </el-button>
        <div class="title-wrap">
          <span class="page-header__eyebrow">虚拟学习者详情</span>
          <h1>{{ profileData?.userName || '加载中' }}</h1>
          <div class="title-meta">
            <el-tag v-if="storyPool.length" size="small" type="warning" effect="plain">
              {{ storyPool.length }} 个故事
            </el-tag>
            <span class="profile-entry-chip">{{ projectionCards[0]?.value || '未运行' }}</span>
            <span class="profile-entry-chip">最近故事：{{ projectionCards[3]?.value || '--' }}</span>
            <span class="profile-entry-chip">{{ profileData?.email || '账号待同步' }}</span>
          </div>
        </div>
      </div>
      <div class="page-header__actions">
        <el-button type="primary" @click="openProjectionDialog">投影入口</el-button>
        <el-button type="success" plain @click="quickLearnVisible = true">快速代学</el-button>
        <el-button plain @click="openLatestSessionInspector">最近会话诊断</el-button>
        <el-dropdown trigger="click">
          <el-button>
            更多
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="openEditDialog">编辑画像</el-dropdown-item>
              <el-dropdown-item :disabled="draftStoriesLoading" @click="generateStoryDraft">生成新故事</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <main class="layout-shell">
      <section class="main">
        <el-tabs v-model="activeTab" class="profile-tabs">
          <!-- Tab 1: 人物概览 -->
          <el-tab-pane label="人物概览" name="overview">
            <section class="panel profile-overview">
              <div class="panel-head panel-head--profile">
                <div class="panel-head__title-wrap">
                  <div class="panel-title">人物概览</div>
                </div>
              </div>
              <div class="profile-overview__content">
                <div class="profile-summary-card">
                  <div class="profile-header profile-header--compact">
                    <div class="profile-avatar">{{ profileData?.userName?.charAt(0) || '?' }}</div>
                    <div class="profile-identity">
                      <strong>{{ profileData?.userName || '--' }}</strong>
                      <span>{{ profileData?.profile?.occupation || '虚拟学习者' }}</span>
                    </div>
                  </div>
                  <div class="profile-summary-card__intro">
                    <h2 class="text-clamp-2">{{ personaHeadline }}</h2>
                    <p class="text-clamp-3">{{ personaNarrative }}</p>
                  </div>
                </div>
                <div class="profile-overview__facts">
                  <article v-for="item in personaFactCards" :key="item.label" class="persona-fact-card">
                    <span>{{ item.label }}</span>
                    <strong>{{ item.value }}</strong>
                  </article>
                </div>
              </div>
            </section>

            <section class="panel trait-panel">
              <div class="panel-head">
                <div>
                  <div class="panel-title">人物反应</div>
                </div>
              </div>
              <div class="trait-grid">
                <article v-for="item in traitSummaryCards" :key="item.label" class="trait-card">
                  <span>{{ item.label }}</span>
                  <strong class="text-clamp-2">{{ item.value }}</strong>
                  <p v-if="item.helper" class="text-clamp-2">{{ item.helper }}</p>
                </article>
              </div>
              <el-collapse class="raw-json-collapse">
                <el-collapse-item name="profile-json">
                  <template #title>
                    <div class="raw-json-collapse__title">
                      <span>画像 JSON（调试）</span>
                    </div>
                  </template>
                  <pre class="raw-json-block">{{ profileRawJson }}</pre>
                </el-collapse-item>
              </el-collapse>
            </section>
          </el-tab-pane>

          <!-- Tab 2: 故事目录 -->
          <el-tab-pane name="stories">
            <template #label>
              故事目录 <el-badge v-if="storyPool.length" :value="storyPool.length" class="tab-badge" />
            </template>
            <section class="panel story-pool-panel">
              <div class="panel-head">
                <div>
                  <div class="panel-title">故事目录</div>
                </div>
                <div class="draft-actions">
                  <el-button :loading="draftStoriesLoading" @click="generateStoryDraft">生成新故事</el-button>
                </div>
              </div>

              <div v-if="storySummaries.length" class="story-list story-list--compact">
                <article
                  v-for="(story, index) in storySummaries"
                  :key="story.key || story.storyId || index"
                  class="story-feature-card"
                  :class="{ active: selectedStoryKey === getStoryKey(story, index) }"
                >
                  <button type="button" class="story-feature-card__main" @click="selectStory(story, index)">
                    <div class="story-feature-card__head">
                      <span class="story-feature-card__index">
                        故事 {{ index + 1 }}
                      </span>
                      <span class="story-feature-card__source">{{ getStorySourceLabel(story.sourceType) }}</span>
                    </div>
                    <strong>{{ story.storyTitle || story.title || `故事 ${index + 1}` }}</strong>
                    <p class="text-clamp-2" :title="story.storyOutline || story.storyTriggerEvent || ''">
                      {{ summarizeStory(story.storyOutline || story.storyTriggerEvent || '未填写摘要', 56) }}
                    </p>

                    <div v-if="story.pressurePoints && story.pressurePoints.length > 0" class="story-feature-card__pressures">
                      <span class="pressure-label">压力点 {{ story.pressurePoints.length }}</span>
                      <div class="pressure-tags">
                        <el-tag
                          v-for="(point, idx) in story.pressurePoints.slice(0, 3)"
                          :key="idx"
                          size="small"
                          type="warning"
                          effect="plain"
                        >
                          {{ summarizeStory(point, 18) }}
                        </el-tag>
                        <el-tag v-if="story.pressurePoints.length > 3" size="small" effect="plain">
                          +{{ story.pressurePoints.length - 3 }}
                        </el-tag>
                      </div>
                    </div>

                    <div class="story-feature-card__lines story-feature-card__lines--inline">
                      <span>目标 {{ story.stats?.goalCount || 0 }}</span>
                      <span>路径 {{ story.stats?.pathCount || 0 }}</span>
                      <span>学习 {{ story.stats?.learnCount || 0 }}</span>
                    </div>
                  </button>
                  <div class="story-feature-card__actions">
                    <el-button size="small" type="primary" @click="openStoryOverview(story)">学情概览</el-button>
                    <el-button size="small" type="danger" plain @click="deleteStory(story, story.index)">删除</el-button>
                  </div>

                  <!-- 高级诊断：来自 scenario-designer 的隐藏字段（hiddenDetails / behaviorHooks / goalSeed / disclosurePlan / misdiagnosis） -->
                  <details
                    v-if="hasAdvancedDiagnostic(story)"
                    class="story-advanced-diag"
                  >
                    <summary>高级诊断 · hidden fields</summary>
                    <div class="story-advanced-diag__body">
                      <div v-if="getStoryHiddenDetails(story).length" class="adv-row">
                        <span class="adv-row__label">隐藏细节</span>
                        <ul>
                          <li v-for="(item, didx) in getStoryHiddenDetails(story)" :key="`hd-${didx}`">{{ item }}</li>
                        </ul>
                      </div>
                      <div v-if="getStoryBehaviorHooks(story).length" class="adv-row">
                        <span class="adv-row__label">行为钩子</span>
                        <ul>
                          <li v-for="(item, hidx) in getStoryBehaviorHooks(story)" :key="`bh-${hidx}`">{{ item }}</li>
                        </ul>
                      </div>
                      <div v-if="getStoryMisdiagnosis(story)" class="adv-row adv-row--text">
                        <span class="adv-row__label">误诊假设</span>
                        <p>{{ getStoryMisdiagnosis(story) }}</p>
                      </div>
                      <div v-if="getStoryGoalSeed(story)" class="adv-row adv-row--object">
                        <span class="adv-row__label">目标种子</span>
                        <pre>{{ JSON.stringify(getStoryGoalSeed(story), null, 2) }}</pre>
                      </div>
                      <div v-if="getStoryDisclosurePlan(story)" class="adv-row adv-row--object">
                        <span class="adv-row__label">披露计划</span>
                        <pre>{{ JSON.stringify(getStoryDisclosurePlan(story), null, 2) }}</pre>
                      </div>
                    </div>
                  </details>
                </article>
              </div>

              <div v-else class="empty-box">还没有故事</div>
            </section>
          </el-tab-pane>

      <!-- Tab 3: 运行历史 -->
      <el-tab-pane name="sessions">
        <template #label>
          运行历史 <el-badge v-if="sessions.length" :value="sessions.length" class="tab-badge" />
        </template>

        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">运行历史</div>
            <div class="panel-meta">{{ sessions.length }} 个会话</div>
          </div>

          <template v-if="sessions.length === 0 && !loading">
            <div class="empty-session-state">
              <h3>还没有会话</h3>
              <el-button type="primary" @click="handleStartSession">创建会话</el-button>
            </div>
          </template>
          <template v-else>
            <el-table :data="sessions" v-loading="loading" stripe size="small" @row-click="setActiveSession">
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <el-tag :type="getSessionStatusType(row.status)" size="small">{{ getSessionStatusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>

              <el-table-column label="阶段" width="90" align="center">
                <template #default="{ row }">
                  <el-tag type="info" size="small" effect="plain">{{ getSessionStageLabel(row.currentStage) }}</el-tag>
                </template>
              </el-table-column>

              <el-table-column label="故事" min-width="150">
                <template #default="{ row }">
                  <el-button
                    v-if="row.storyContext?.storyId"
                    type="primary"
                    link
                    size="small"
                    @click.stop="openStoryOverviewById(row.storyContext.storyId)"
                  >
                    {{ row.storyContext?.title || row.storyContext?.storyTitle || '进入故事' }}
                  </el-button>
                  <span v-else>{{ row.storyContext?.title || '--' }}</span>
                </template>
              </el-table-column>

              <el-table-column label="轮次" width="70" align="center">
                <template #default="{ row }">{{ row.roundCount ?? '-' }}</template>
              </el-table-column>

              <el-table-column label="绑定" min-width="180">
                <template #default="{ row }">
                  <div class="binding-stack">
                    <span>goal: {{ row.bindings?.goalConversationId ? 'yes' : '--' }}</span>
                    <span>path: {{ row.bindings?.learningPathId ? 'yes' : '--' }}</span>
                    <span>learn: {{ row.bindings?.teachingSessionId ? 'yes' : '--' }}</span>
                  </div>
                </template>
              </el-table-column>

            <el-table-column label="最后活跃" min-width="120">
              <template #default="{ row }">{{ formatRelativeTime(row.updatedAt) }}</template>
            </el-table-column>

            <el-table-column label="当前焦点" width="110" align="center">
              <template #default="{ row }">
                <el-tag v-if="highlightedSessionId && row.id === highlightedSessionId" size="small" type="warning">当前会话</el-tag>
                <span v-else class="muted-marker">--</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="220" align="center" fixed="right">
              <template #default="{ row }">
                  <el-button type="primary" link size="small" @click.stop="openSessionInspector(row.id)">诊断</el-button>
                  <el-button type="primary" link size="small" :disabled="!row.bindings?.goalConversationId" @click.stop="openDebugGoal(row)">调试 Goal</el-button>
                  <el-button type="danger" link size="small" @click.stop="deleteSession(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </section>
      </el-tab-pane>
    </el-tabs>
  </section>
</main>

    <el-dialog v-model="editDialogVisible" title="编辑画像" width="640px" destroy-on-close>
        <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="学习者称呼" prop="name">
          <el-input v-model="formData.name" placeholder="如：小林 / 王姐 / 店长A" />
        </el-form-item>
          <el-divider>基础身份</el-divider>
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
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleUpdateProfile">保存修改</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="storyEditDialogVisible" :title="storyEditDialogTitle" width="640px" destroy-on-close>
      <el-form ref="storyFormRef" :model="storyFormData" :rules="storyFormRules" label-width="100px">
        <el-form-item label="故事标题" prop="title">
          <el-input v-model="storyFormData.title" maxlength="80" show-word-limit placeholder="如：第一次独立复盘" />
        </el-form-item>
        <el-form-item label="故事摘要" prop="storyOutline">
          <el-input v-model="storyFormData.storyOutline" type="textarea" :rows="4" maxlength="300" show-word-limit placeholder="简要场景与卡点" />
        </el-form-item>
        <el-form-item label="触发事件" prop="storyTriggerEvent">
          <el-input v-model="storyFormData.storyTriggerEvent" type="textarea" :rows="3" maxlength="160" show-word-limit placeholder="触发事件" />
        </el-form-item>
        <el-form-item label="自然开场" prop="visibleOpening">
          <el-input v-model="storyFormData.visibleOpening" type="textarea" :rows="3" maxlength="180" show-word-limit placeholder="第一轮开场" />
        </el-form-item>
        <el-form-item label="压力点" prop="pressurePointsText">
          <el-input v-model="storyFormData.pressurePointsText" type="textarea" :rows="3" maxlength="240" show-word-limit placeholder="每行一个压力点" />
        </el-form-item>
        <el-divider>问题基础</el-divider>
        <el-form-item label="熟悉度">
          <el-select v-model="storyFormData.problemKnowledge.domainFamiliarity" placeholder="选择熟悉度">
            <el-option label="低" value="low" />
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
          </el-select>
        </el-form-item>
        <el-form-item label="已经会的">
          <el-input v-model="storyFormData.problemKnowledge.knownConceptsText" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="每行一个已掌握点" />
        </el-form-item>
        <el-form-item label="容易卡的">
          <el-input v-model="storyFormData.problemKnowledge.struggleConceptsText" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="每行一个卡点" />
        </el-form-item>
        <el-form-item label="自我判断">
          <el-input v-model="storyFormData.problemKnowledge.selfAssessment" type="textarea" :rows="2" maxlength="180" show-word-limit placeholder="自我判断" />
        </el-form-item>
        <el-form-item label="隐藏缺口">
          <el-input v-model="storyFormData.problemKnowledge.hiddenGapsText" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="每行一个隐藏缺口" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="storyEditDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="storySubmitting" @click="saveStoryEdits">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="projectionDialogVisible" title="前台 / 调试入口" width="720px" destroy-on-close>
      <div class="projection-runtime" v-loading="projectionLoading">
        <template v-if="testProjection">
          <section class="projection-runtime__focus">
            <div>
              <div class="panel-title">建议入口</div>
              <div class="panel-meta text-clamp-2">{{ projectionSummary }}</div>
            </div>
            <el-button plain @click="openProjectionEntry(testProjection.recommendedEntry)">
              打开{{ projectionEntryLabelMap[testProjection.recommendedEntry] }}
            </el-button>
          </section>

          <section class="projection-runtime__section">
              <div class="panel-title">前台入口</div>
              <div class="projection-runtime__actions">
              <el-button @click="openProjectionEntry('dashboard')">学习台</el-button>
              <el-button :disabled="!testProjection.entries?.formal?.goal" @click="openProjectionEntry('goal')">目标</el-button>
              <el-button :disabled="!testProjection.entries?.formal?.path" @click="openProjectionEntry('path')">路径</el-button>
              <el-button :disabled="!testProjection.entries?.formal?.learn" @click="openProjectionEntry('learn')">学习</el-button>
            </div>
          </section>

          <section class="projection-runtime__section">
              <div class="panel-title">调试入口</div>
              <div class="projection-runtime__actions">
              <el-button plain :disabled="!testProjection.entries?.test?.goal" @click="openTestDebugEntry('goal')">调试 Goal</el-button>
              <el-button plain :disabled="!testProjection.entries?.test?.path" @click="openTestDebugEntry('path')">调试 Path</el-button>
              <el-button plain :disabled="!testProjection.entries?.test?.learn" @click="openTestDebugEntry('learn')">调试 Learn</el-button>
            </div>
          </section>
        </template>
      </div>
    </el-dialog>

    <QuickLearnPanel v-model:visible="quickLearnVisible" :profile-id="profileId" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'
import { setProjectionToken } from '@/utils/projection'
import QuickLearnPanel from './components/virtual/QuickLearnPanel.vue'

interface ProfileStory {
  storyId?: string
  id?: string
  key?: string
  index: number
  title?: string
  storyTitle?: string
  storyOutline?: string
  storyTriggerEvent?: string
  visibleOpening?: string
  sourceType?: string
  pressurePoints?: string[]
  stats?: { goalCount?: number; pathCount?: number; learnCount?: number; [key: string]: unknown }
  [key: string]: unknown
}

interface SessionStoryContext {
  storyId?: string
  title?: string
  storyTitle?: string
  triggerEvent?: string
  [key: string]: unknown
}

interface ProfileSessionBindings {
  goalConversationId?: string
  learningPathId?: string
  teachingSessionId?: string
  currentTaskId?: string
  [key: string]: unknown
}

interface ProfileSessionRuntime {
  bindings?: ProfileSessionBindings
  story?: SessionStoryContext
  stageStatus?: {
    goal?: { stage?: string; learnerState?: unknown; [key: string]: unknown }
    learning?: { currentTaskTitle?: string; currentMilestoneTitle?: string; [key: string]: unknown }
    [key: string]: unknown
  }
  learnerState?: { goal?: unknown; [key: string]: unknown }
  [key: string]: unknown
}

interface ProfileSession {
  id: string
  status?: string
  currentStage?: string
  roundCount?: number
  updatedAt?: string
  createdAt?: string
  bindings?: ProfileSessionBindings
  storyContext?: SessionStoryContext | null
  runtime?: ProfileSessionRuntime
  goalStage?: string | null
  learnerState?: unknown
  currentTaskTitle?: string | null
  currentMilestoneTitle?: string | null
  stageResults?: Record<string, unknown>
  [key: string]: unknown
}

interface VirtualLearnerDetail {
  id: string
  userName?: string
  email?: string
  simulationMode?: string
  simulationTemperature?: number
  personalityTraits?: { verbosity?: string; enthusiasm?: string; confusionStyle?: string; [key: string]: unknown }
  notes?: string
  profile?: {
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
    behavioralProfileSummary?: string
    availableTime?: string
    selfAwarenessPattern?: string
    planningFollowThrough?: string
    selfRegulationStyle?: string
    overloadReaction?: string
    storyPool?: ProfileStory[]
    [key: string]: unknown
  }
  sessions?: ProfileSession[]
  [key: string]: unknown
}

type ProjectionEntryKey = 'dashboard' | 'goal' | 'path' | 'learn'

interface TestProjection {
  recommendedEntry: ProjectionEntryKey
  recommendedReason?: string
  activeStory?: { storyId?: string; title?: string; [key: string]: unknown } | null
  latestSession?: { id?: string; updatedAt?: string; [key: string]: unknown } | null
  entries?: {
    formal?: Partial<Record<ProjectionEntryKey, string>>
    test?: Partial<Record<'goal' | 'path' | 'learn', string>>
    [key: string]: unknown
  }
  [key: string]: unknown
}

const getErrorMessage = (error: unknown, fallback: string) => {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

const router = useRouter()
const route = useRoute()
const profileId = route.params.profileId as string
const routeStoryId = computed(() => String(route.params.storyId || ''))
const routeSessionId = computed(() => typeof route.query.sessionId === 'string' ? route.query.sessionId : '')
const profileData = ref<VirtualLearnerDetail | null>(null)
const sessions = ref<ProfileSession[]>([])
const storySummaries = ref<ProfileStory[]>([])
const loading = ref(false)
const editDialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const storyFormRef = ref<FormInstance>()
const selectedStoryKey = ref<string | null>(null)
const draftStoriesLoading = ref(false)
const storyEditDialogVisible = ref(false)
const storySubmitting = ref(false)
const editingStoryIndex = ref<number | null>(null)
const projectionDialogVisible = ref(false)
const quickLearnVisible = ref(false)
const projectionLoading = ref(false)
const testProjection = ref<TestProjection | null>(null)
const activeTab = ref('overview')

const projectionEntryLabelMap: Record<string, string> = {
  dashboard: 'Dashboard',
  goal: 'Goal',
  path: 'Path',
  learn: 'Learn'
}

const summarizeStory = (value: string, limit = 84) => {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact
}

const compactText = (value: string | null | undefined, fallback = '--', limit = 72) => {
  return summarizeStory(value || fallback, limit)
}

const formData = ref({
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

const formRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }]
}

const storyFormData = ref({
  title: '',
  storyOutline: '',
  storyTriggerEvent: '',
  visibleOpening: '',
  pressurePointsText: '',
  problemKnowledge: {
    domainFamiliarity: 'low',
    knownConceptsText: '',
    struggleConceptsText: '',
    selfAssessment: '',
    hiddenGapsText: ''
  }
})

const storyFormRules = {
  title: [{ required: true, message: '请输入故事标题', trigger: 'blur' }],
  storyOutline: [{ required: true, message: '请输入故事摘要', trigger: 'blur' }],
  storyTriggerEvent: [{ required: true, message: '请输入触发事件', trigger: 'blur' }],
  visibleOpening: [{ required: true, message: '请输入自然开场', trigger: 'blur' }],
  pressurePointsText: [{ required: true, message: '请输入至少一个压力点', trigger: 'blur' }]
}

const storyEditDialogTitle = computed(() => {
  return '编辑故事'
})

const storyPool = computed(() => {
  const pool = profileData.value?.profile?.storyPool
  return Array.isArray(pool) ? pool : []
})

const highlightedSessionId = computed(() => routeSessionId.value)

const stageProjection = computed(() => ({
  goal: sessions.value.filter((item) => item.bindings?.goalConversationId).length,
  path: sessions.value.filter((item) => item.bindings?.learningPathId).length,
  learning: sessions.value.filter((item) => item.bindings?.teachingSessionId || item.bindings?.currentTaskId).length,
}))

const latestProjectionSession = computed(() => sessions.value[0] || null)

const projectionCards = computed(() => [
  {
    label: '账号状态',
    value: latestProjectionSession.value ? getSessionStatusLabel(latestProjectionSession.value.status) : '未运行',
    meta: latestProjectionSession.value ? `阶段 ${getSessionStageLabel(latestProjectionSession.value.currentStage)}` : '暂无运行记录'
  },
  {
    label: '故事数量',
    value: `${storyPool.value.length} 个`,
    meta: '生成后即可直接进入 Goal'
  },
  {
    label: '平台投影',
    value: `${stageProjection.value.goal}/${stageProjection.value.path}/${stageProjection.value.learning}`,
    meta: 'Goal / Path / Learn 已生成数'
  },
  {
    label: '最近故事',
    value: latestProjectionSession.value?.storyContext?.title || '--',
    meta: latestProjectionSession.value?.storyContext?.triggerEvent || '尚未从故事进入平台'
  },
  {
    label: '运行模式',
    value: profileData.value?.simulationMode === 'ai' ? 'AI 模式' : '正式/手动',
    meta: profileData.value?.email || '查看这个账号在前台的投影入口'
  }
])

const personaHeadline = computed(() => {
  const occupation = profileData.value?.profile?.occupation || '学习者'
  const summary = compactText(
    profileData.value?.profile?.behavioralProfileSummary || profileData.value?.profile?.corePersonality,
    '带着真实限制来求助',
    40
  )
  return `${occupation}，${summary}`
})

const personaNarrative = computed(() => {
  return compactText(
    profileData.value?.profile?.background,
    '稳定人物底座，具体冲突看下方故事。',
    96
  )
})

const personaFactCards = computed(() => [
  { label: '职业', value: profileData.value?.profile?.occupation || '--' },
  { label: '年龄', value: profileData.value?.profile?.age ? `${profileData.value.profile.age} 岁` : '--' },
  { label: '可用时间', value: getAvailableTimeLabel(profileData.value?.profile?.availableTime) },
  { label: '故事数量', value: `${storyPool.value.length} 个` }
])

const traitSummaryCards = computed(() => {
  const p: NonNullable<VirtualLearnerDetail['profile']> = profileData.value?.profile || {}
  return [
    {
      label: '核心人格',
      value: compactText(
        p.corePersonality || p.behavioralProfileSummary,
        '先判断建议是否贴近现实。',
        44
      ),
      helper: p.behavioralProfileSummary ? summarizeStory(p.behavioralProfileSummary, 52) : ''
    },
    {
      label: '情感底色',
      value: compactText(p.emotionalBaseline, '压力上来时才更明显。', 44),
      helper: ''
    },
    {
      label: '求助与对抗',
      value: compactText(p.helpSeekingPattern, '遇到卡点后会按自己的节奏求助。', 44),
      helper: p.adversarialPattern ? summarizeStory(p.adversarialPattern, 52) : ''
    },
    {
      label: '自我觉察',
      value: compactText(
        p.selfAwarenessPattern || p.metacognitiveProfile,
        '能感觉到不顺，但未必马上说清。',
        44
      ),
      helper: summarizeStory(p.planningFollowThrough || p.selfRegulationStyle || '', 52)
    },
    {
      label: '负荷反应',
      value: compactText(
        p.overloadReaction || p.cognitiveLoadTolerance,
        '信息一多时会先抓可执行点。',
        44
      ),
      helper: p.memoryRepairPattern ? summarizeStory(p.memoryRepairPattern, 52) : ''
    }
  ]
})

const profileRawJson = computed(() => {
  const profile = profileData.value?.profile
  if (!profile) return '{}'
  return JSON.stringify(profile, null, 2)
})

const projectionSessionMeta = computed(() => {
  if (!testProjection.value?.latestSession?.updatedAt) return '当前还没有运行记录'
  return `最近活跃 ${formatRelativeTime(testProjection.value.latestSession.updatedAt)}`
})

const projectionSummary = computed(() => {
  if (!testProjection.value) return ''

  const parts = [compactText(testProjection.value.recommendedReason, '', 36)]

  if (testProjection.value.activeStory?.title) {
    parts.push(`故事 ${summarizeStory(testProjection.value.activeStory.title, 18)}`)
  }

  if (projectionSessionMeta.value !== '当前还没有运行记录') {
    parts.push(projectionSessionMeta.value)
  }

  return summarizeStory(parts.filter(Boolean).join(' · '), 72)
})

const getAvailableTimeLabel = (value?: string) => {
  switch (value) {
    case 'minimal': return '很少'
    case 'moderate': return '一般'
    case 'abundant': return '充足'
    default: return '--'
  }
}

const formatTime = (time: string | null | undefined) => {
  if (!time) return '--'
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const formatRelativeTime = (time: string | null | undefined) => {
  if (!time) return '--'
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

const getSessionStatusType = (status: string | undefined) => {
  switch (status) {
    case 'running': return 'success'
    case 'completed': return 'info'
    case 'failed': return 'danger'
    default: return 'warning'
  }
}

const getSessionStatusLabel = (status: string | undefined) => {
  switch (status) {
    case 'created': return '已创建'
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return status || '未知'
  }
}

const getSessionStageLabel = (stage: string | undefined) => {
  switch (stage) {
    case 'goal': return 'Goal'
    case 'path': return 'Path'
    case 'learning': return 'Learn'
    default: return stage || '-'
  }
}

// 与后端数据模型对齐：story.sourceType 由 virtual-learner-scenario-designer 写入，
// 实际存储枚举为 work / life / study / self_management（见 backend/src/skills/virtual-learner-scenario-designer/index.ts）
const getStorySourceLabel = (sourceType?: string) => {
  switch (sourceType) {
    case 'work':
      return '工作'
    case 'life':
      return '生活'
    case 'study':
      return '学习'
    case 'self_management':
      return '自我管理'
    default:
      return sourceType || '未知来源'
  }
}

// ===== 故事高级诊断字段（5 个来自 scenario-designer 的 hidden fields） =====
// 后端 /stories 接口已通过 `...story` 透出这些字段；前端原本从未展示。
const getStoryHiddenDetails = (story: ProfileStory): string[] => {
  const value = (story as Record<string, unknown>).hiddenDetails
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}
const getStoryBehaviorHooks = (story: ProfileStory): string[] => {
  const value = (story as Record<string, unknown>).behaviorHooks
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}
const getStoryMisdiagnosis = (story: ProfileStory): string => {
  const value = (story as Record<string, unknown>).misdiagnosis
  return typeof value === 'string' ? value : ''
}
const getStoryGoalSeed = (story: ProfileStory): Record<string, unknown> | null => {
  const value = (story as Record<string, unknown>).goalSeed
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}
const getStoryDisclosurePlan = (story: ProfileStory): Record<string, unknown> | null => {
  const value = (story as Record<string, unknown>).disclosurePlan
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}
const hasAdvancedDiagnostic = (story: ProfileStory) =>
  getStoryHiddenDetails(story).length > 0
  || getStoryBehaviorHooks(story).length > 0
  || !!getStoryMisdiagnosis(story)
  || !!getStoryGoalSeed(story)
  || !!getStoryDisclosurePlan(story)

const getStoryKey = (story: ProfileStory | null | undefined, index: number) => story?.id || `story-${index}`

const selectStory = (story: ProfileStory, index: number) => {
  selectedStoryKey.value = getStoryKey(story, index)
}

const openStoryOverview = (story: ProfileStory) => {
  const targetId = String(story?.storyId || story?.id || story?.key || '')
  if (!targetId) {
    ElMessage.warning('这个故事暂时没有可用标识')
    return
  }
  router.push(`/admin/virtual-learners/${profileId}/stories/${targetId}`)
}

const openStoryOverviewById = (storyId: string) => {
  if (!storyId) {
    ElMessage.warning('这个故事暂时没有可用标识')
    return
  }
  router.push(`/admin/virtual-learners/${profileId}/stories/${storyId}`)
}

const parsePressurePoints = (value: string) => {
  return value
    .split(/\r?\n|[;,，；]/)
    .map((item) => item.trim())
    .filter((item, index, list) => !!item && list.indexOf(item) === index)
}

const normalizeSession = (session: ProfileSession): ProfileSession => {
  const runtime: ProfileSessionRuntime = session?.runtime || {}
  const bindings: ProfileSessionBindings = runtime.bindings || session?.bindings || {}
  const goalRuntime: { stage?: string; learnerState?: unknown; [key: string]: unknown } = runtime.stageStatus?.goal || {}
  const learningRuntime: { currentTaskTitle?: string; currentMilestoneTitle?: string; [key: string]: unknown } = runtime.stageStatus?.learning || {}
  const learnerStateRuntime: { goal?: unknown; [key: string]: unknown } = runtime.learnerState || {}

  return {
    ...session,
    runtime,
    bindings,
    storyContext: session?.storyContext || runtime.story || null,
    goalStage: session?.goalStage || goalRuntime.stage || null,
    learnerState: session?.learnerState || learnerStateRuntime.goal || goalRuntime.learnerState || null,
    currentTaskTitle: session?.currentTaskTitle || learningRuntime.currentTaskTitle || null,
    currentMilestoneTitle: session?.currentMilestoneTitle || learningRuntime.currentMilestoneTitle || null,
    stageResults: session?.stageResults || {},
  }
}

const normalizeSessions = (items: ProfileSession[]) => {
  return Array.isArray(items) ? items.map(normalizeSession) : []
}

const syncSelectedStoryFromRoute = () => {
  if (!storySummaries.value.length) {
    selectedStoryKey.value = null
    return
  }

  if (!routeStoryId.value) {
    if (!selectedStoryKey.value) {
      selectedStoryKey.value = getStoryKey(storySummaries.value[0], 0)
    }
    return
  }

  const matched = storySummaries.value.find((story, index: number) => {
    const candidateId = String(story?.storyId || story?.id || story?.key || '')
    return candidateId === routeStoryId.value || getStoryKey(story, index) === routeStoryId.value
  })

  if (matched) {
    selectedStoryKey.value = getStoryKey(matched, storySummaries.value.indexOf(matched))
  }
}

const loadProfile = async () => {
  loading.value = true
  try {
    const [profileRes, storiesRes] = await Promise.all([
      adminApi.getVirtualLearner(profileId),
      adminApi.getVirtualLearnerStories(profileId)
    ])

    if (profileRes.data?.success) {
      profileData.value = profileRes.data.data
      sessions.value = normalizeSessions(profileRes.data.data.sessions || [])
      if (storiesRes.data?.success) {
        storySummaries.value = Array.isArray(storiesRes.data.data?.stories) ? storiesRes.data.data.stories : []
      }
      syncSelectedStoryFromRoute()
    } else {
      ElMessage.error(profileRes.data?.error || '加载失败')
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '加载失败'))
  } finally {
    loading.value = false
  }
}

const generateStoryDraft = async () => {
  draftStoriesLoading.value = true
  try {
    const res = await adminApi.draftVirtualLearnerStories(profileId)
    if (res.data?.success) {
      ElMessage.success('故事已生成并自动保存')
      await loadProfile()
      const lastStory = [...storyPool.value]
        .map((story, index: number) => ({ story, index }))
        .at(-1)

      if (lastStory) {
        selectStory(lastStory.story, lastStory.index)
      }
    } else {
      ElMessage.error(res.data?.error || '故事生成失败')
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '故事生成失败'))
  } finally {
    draftStoriesLoading.value = false
  }
}

const saveStoryEdits = async () => {
  if (editingStoryIndex.value === null) return
  const valid = await storyFormRef.value?.validate().catch(() => false)
  if (!valid) return

  storySubmitting.value = true
  try {
    // problemKnowledge 未声明在 updateStoryStatus 的 payload 类型中，但后端接口支持该字段；
    // 经中间变量传入以避免对象字面量的超额属性检查（不改变提交内容）
    const payload = {
      title: storyFormData.value.title,
      storyOutline: storyFormData.value.storyOutline,
      storyTriggerEvent: storyFormData.value.storyTriggerEvent,
      visibleOpening: storyFormData.value.visibleOpening,
      pressurePoints: parsePressurePoints(storyFormData.value.pressurePointsText),
      problemKnowledge: {
        domainFamiliarity: storyFormData.value.problemKnowledge.domainFamiliarity,
        knownConcepts: parsePressurePoints(storyFormData.value.problemKnowledge.knownConceptsText),
        struggleConcepts: parsePressurePoints(storyFormData.value.problemKnowledge.struggleConceptsText),
        selfAssessment: storyFormData.value.problemKnowledge.selfAssessment.trim(),
        hiddenGaps: parsePressurePoints(storyFormData.value.problemKnowledge.hiddenGapsText)
      }
    }
    const res = await adminApi.updateStoryStatus(profileId, editingStoryIndex.value, payload)

    if (!res.data?.success) {
      throw new Error(res.data?.error || '保存失败')
    }

    ElMessage.success('故事已更新')
    storyEditDialogVisible.value = false
    await loadProfile()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '保存失败'))
  } finally {
    storySubmitting.value = false
  }
}

const deleteStory = async (_story: ProfileStory, index: number) => {
  try {
    await ElMessageBox.confirm('确定删除此故事？', '确认删除', { type: 'warning' })
    const res = await adminApi.deleteStory(profileId, index)
    if (res.data?.success) {
      ElMessage.success('故事已删除')
      await loadProfile()
    } else {
      ElMessage.error(res.data?.error || '删除失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, '删除失败'))
    }
  }
}

const handleStartSession = async (story?: ProfileStory, storyIndex?: number) => {
  try {
    const payload = story ? { storyId: story.id, storyIndex } : undefined
    const res = await adminApi.startVirtualSession(profileId, payload)
    if (res.data?.success) {
      ElMessage.success('会话已创建，进入诊断控制台')
      router.push(`/admin/virtual-session/${res.data.data?.id}`)
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '创建会话失败'))
  }
}

const openSessionInspector = (sessionId: string) => {
  router.push(`/admin/virtual-session/${sessionId}`)
}

const setActiveSession = (session: ProfileSession) => {
  if (!session?.id) return
  openSessionInspector(session.id)
}

const openLatestSessionInspector = () => {
  if (!latestProjectionSession.value?.id) {
    ElMessage.info('这个账号还没有运行记录')
    return
  }
  openSessionInspector(latestProjectionSession.value.id)
}

const openProjectionDialog = async () => {
  if (!profileData.value?.id) {
    ElMessage.warning('当前账号信息不完整')
    return
  }

  try {
    projectionLoading.value = true
    const res = await adminApi.getVirtualLearnerTestProjection(profileData.value.id)
    if (!res.data?.success) {
      throw new Error(res.data?.error || '获取投影入口失败')
    }

    testProjection.value = res.data.data || null
    projectionDialogVisible.value = true
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '获取投影入口失败'))
  } finally {
    projectionLoading.value = false
  }
}

const ensureProjectionToken = async () => {
  if (!profileData.value?.id) {
    throw new Error('当前账号信息不完整')
  }

  const latestSession = testProjection.value?.latestSession || null
  const activeStory = testProjection.value?.activeStory || null
  const res = await adminApi.createProjectionToken(profileData.value.id, {
    scope: 'full',
    virtualSessionId: latestSession?.id || undefined,
    storyId: activeStory?.storyId || undefined
  })

  if (!res.data?.success) {
    throw new Error(res.data?.error || '创建前台投影失败')
  }

  const projectionToken = res.data.data?.token
  if (!projectionToken) {
    throw new Error('投影 token 缺失')
  }

  setProjectionToken(projectionToken, {
    profileId: profileData.value.id,
    userName: profileData.value.userName,
    email: profileData.value.email,
    scope: 'full',
    storyId: activeStory?.storyId || null,
    virtualSessionId: latestSession?.id || null
  })
}

const openProjectionEntry = async (entry: ProjectionEntryKey) => {
  const target = testProjection.value?.entries?.formal?.[entry]
  if (!target) {
    ElMessage.info(`当前没有可打开的 ${projectionEntryLabelMap[entry]} 入口`)
    return
  }

  try {
    await ensureProjectionToken()
    window.open(target, '_blank')
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '打开投影入口失败'))
  }
}

const openTestDebugEntry = (entry: 'goal' | 'path' | 'learn') => {
  const target = testProjection.value?.entries?.test?.[entry]
  if (!target) {
    ElMessage.info(`当前没有可打开的 ${projectionEntryLabelMap[entry]} 调试入口`)
    return
  }

  window.open(target, '_blank')
}

const openDebugGoal = (session?: ProfileSession | null) => {
  if (!session?.bindings?.goalConversationId) return
  router.push(`/admin/test/goal-full/${session.bindings.goalConversationId}?virtualSessionId=${session.id}&viewMode=debug`)
}

const deleteSession = async (sessionId: string) => {
  try {
    await ElMessageBox.confirm('确定删除此会话？相关数据将被清除。', '确认删除', { type: 'warning' })
    const res = await adminApi.deleteVirtualSession(sessionId)
    if (res.data?.success) {
      ElMessage.success('会话已删除')
      sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, '删除失败'))
    }
  }
}

const openEditDialog = () => {
  if (!profileData.value) return
  const p = profileData.value
  formData.value = {
    name: p.userName || '',
    profile: {
      age: p.profile?.age,
      occupation: p.profile?.occupation || '',
      education: p.profile?.education || '',
      background: p.profile?.background || '',
      corePersonality: p.profile?.corePersonality || '',
      emotionalBaseline: p.profile?.emotionalBaseline || '',
      helpSeekingPattern: p.profile?.helpSeekingPattern || '',
      adversarialPattern: p.profile?.adversarialPattern || '',
      metacognitiveProfile: p.profile?.metacognitiveProfile || '',
      cognitiveLoadTolerance: p.profile?.cognitiveLoadTolerance || '',
      memoryRepairPattern: p.profile?.memoryRepairPattern || ''
    },
    simulationMode: p.simulationMode || 'manual',
    simulationTemperature: p.simulationTemperature || 0.8,
    personalityTraits: {
      verbosity: p.personalityTraits?.verbosity || 'normal',
      enthusiasm: p.personalityTraits?.enthusiasm || 'normal',
      confusionStyle: p.personalityTraits?.confusionStyle || 'direct'
    },
    notes: p.notes || ''
  }
  editDialogVisible.value = true
}

const handleUpdateProfile = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    const res = await adminApi.updateVirtualLearner(profileId, formData.value)
    if (res.data?.success) {
      ElMessage.success('更新成功')
      editDialogVisible.value = false
      loadProfile()
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '更新失败'))
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadProfile()
})

watch(() => route.params.storyId, () => {
  syncSelectedStoryFromRoute()
})
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  padding: 16px;
  background: #f6f7fb;
  color: #1f2937;
}

.page-header,
.layout-shell {
  max-width: 1440px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 14px 18px;
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 16px;
}

.page-header__main,
.page-header__actions,
.title-meta,
.panel-head,
.profile-header,
.entry-card__head,
.entry-card__actions,
.control-grid,
.story-card__head,
.story-card__meta,
.binding-stack {
  display: flex;
  align-items: center;
}

.page-header__main,
.page-header__actions,
.title-meta,
.entry-card__actions,
.story-card__meta {
  gap: 8px;
}

.page-header__main {
  align-items: flex-start;
}

.muted-marker {
  color: var(--admin-text-muted, #64748b);
  font-size: 12px;
}

.page-header__eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2355d8;
  font-size: var(--admin-text-micro);
  font-weight: 700;
}

.title-wrap h1 {
  margin: 0;
  font-size: 20px;
}

.title-wrap {
  display: grid;
  gap: 6px;
}

.profile-entry-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #607086;
  font-size: 12px;
}

.text-clamp-2,
.text-clamp-3 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.text-clamp-2 {
  -webkit-line-clamp: 2;
}

.text-clamp-3 {
  -webkit-line-clamp: 3;
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.layout-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 12px;
  padding: 18px;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
}

.profile-tabs {
  background: transparent;
}

.profile-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
  background: #fff;
  border-radius: 12px;
  padding: 8px 12px;
  border: 1px solid #e5eaf2;
}

.profile-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.profile-tabs :deep(.el-tabs__item) {
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
  padding: 10px 16px;
}

.profile-tabs :deep(.el-tabs__item.is-active) {
  color: #3478f6;
  font-weight: 600;
}

.profile-tabs :deep(.el-tabs__active-bar) {
  background-color: #3478f6;
}

.tab-badge {
  margin-left: 6px;
}

.panel-head {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-head--stack {
  flex-direction: column;
  align-items: flex-start;
}

.panel-head--profile {
  margin-bottom: 12px;
}

.panel-head__title-wrap {
  display: grid;
  gap: 4px;
}

.panel-meta {
  font-size: 12px;
  color: #8b94a6;
}

.panel-meta--block {
  max-width: 560px;
  line-height: 1.55;
}

.projection-runtime {
  display: grid;
  gap: 16px;
}

.projection-runtime__focus,
.projection-runtime__section {
  border: 1px solid #e5eaf2;
  border-radius: 14px;
  background: #fff;
}

.projection-runtime__focus {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  background: #f8fafc;
}

.projection-runtime__section {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.projection-runtime__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.draft-panel {
  display: grid;
  gap: 14px;
}

.draft-actions {
  display: flex;
  gap: 8px;
}

.draft-story-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #dbe6f8;
  border-radius: 14px;
  background: #f8fbff;
  color: #36507a;
}

.draft-story-banner strong {
  font-size: 13px;
  color: #1f2937;
}

.draft-story-banner span {
  font-size: 12px;
  color: #61708a;
}

.draft-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 12px;
}

.draft-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #d8e3f4;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.draft-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.draft-card strong {
  display: block;
  margin-bottom: 8px;
  font-size: 16px;
  color: #1f2937;
}

.draft-card p {
  margin: 0 0 10px;
  color: #526074;
  line-height: 1.65;
}

.draft-mini-list {
  display: grid;
  gap: 6px;
}

.draft-mini-list span {
  margin: 0;
  color: #5f6b7d;
  font-size: 12px;
}

.profile-header {
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid #edf1f6;
}

.profile-header--compact {
  margin-bottom: 0;
  padding-bottom: 12px;
}

.profile-avatar {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, #1f4fd6, #7c3aed);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  flex-shrink: 0;
}

.profile-identity {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-identity strong {
  font-size: 16px;
}

.profile-identity span {
  font-size: 12px;
  color: #7b8597;
}

.kv-list,
.story-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kv-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.kv-item span,
.binding-stack span,
.story-card__head span,
.story-card__meta span,
.control-card span,
.control-card em {
  font-size: 12px;
  color: #7b8597;
}

.kv-item strong,
.story-card__head strong,
.control-card strong {
  font-size: 12px;
  text-align: right;
  word-break: break-all;
}

.kv-value--truncate {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-align: left;
}

.story-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e7ecf3;
  border-radius: 14px;
  background: #fbfcfe;
}

.story-card.active {
  border-color: #c9dcff;
  background: #f5f9ff;
}

.story-card__main {
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.story-card__head,
.story-card__meta,
.binding-stack {
  justify-content: space-between;
}

.story-card p {
  margin: 8px 0;
  color: #475569;
  line-height: 1.55;
}

.control-grid {
  gap: 10px;
  flex-wrap: wrap;
}

.control-card,
.entry-card {
  flex: 1 1 220px;
  min-width: 0;
  padding: 14px;
  border: 1px solid #e7ecf3;
  border-radius: 14px;
  background: #fbfcfe;
}

.control-card strong {
  display: block;
  margin: 6px 0;
  font-size: 18px;
  color: #1f2937;
}

.control-card--focus {
  border-color: #cfddf5;
  background: linear-gradient(180deg, #f7faff, #ffffff);
}

.control-card em {
  display: block;
  font-style: normal;
  line-height: 1.5;
}

.entry-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.entry-card__head {
  justify-content: space-between;
}

.entry-card__head strong {
  font-size: 14px;
}

.entry-card__actions {
  flex-wrap: wrap;
}

.entry-card__actions--primary :deep(.el-button:not(.el-button--primary)) {
  border-color: #d6dfed;
  color: #4c617c;
}

.entry-card--debug {
  border-color: #dbe6f8;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.entry-card--formal {
  background: #fcfdff;
}

.entry-card--actions {
  background: #fbfcfe;
}

.entry-card__actions--wrap :deep(button) {
  margin: 0;
}

.binding-stack {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.empty-session-state,
.empty-box {
  text-align: center;
  padding: 28px 20px;
  background: #fbfcfe;
  border-radius: 16px;
  border: 1px dashed #dce4ee;
  color: #8b94a6;
}

.empty-session-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-session-state h3 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #1f2937;
}

.empty-session-state p {
  margin: 0 0 20px;
  font-size: 13px;
  color: #8b94a6;
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

.profile-overview {
  display: grid;
  gap: 12px;
  align-items: stretch;
}

.profile-overview__content {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.75fr);
  gap: 12px;
}

.profile-summary-card {
  display: grid;
  gap: 12px;
  padding: 0 18px 0 0;
  border-radius: 0;
  border: 0;
  border-right: 1px solid #e7ecf3;
  background: transparent;
}

.profile-summary-card__intro {
  display: grid;
  gap: 8px;
}

.profile-summary-card__intro h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.35;
}

.profile-summary-card__intro p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
  font-size: 13px;
}

.profile-overview__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid #edf1f6;
}

.persona-fact-card {
  padding: 10px 12px;
  border-radius: 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #edf1f6;
}

.persona-fact-card:nth-child(2n) {
  border-left: 1px solid #edf1f6;
}

.persona-fact-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.persona-fact-card strong {
  display: block;
  font-size: var(--admin-text-title-sm);
  line-height: 1.45;
  color: #1f2937;
}

.story-pool-panel {
  display: grid;
  gap: 12px;
}

.story-list--compact {
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid #edf1f6;
}

.story-workbench {
  display: grid;
  gap: 14px;
}

.story-workbench__hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid #dbe6f8;
  background: linear-gradient(135deg, #f9fbff, #ffffff);
}

.story-workbench__copy {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.story-workbench__eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2355d8;
  font-size: var(--admin-text-micro);
  font-weight: 700;
}

.story-workbench__copy h3 {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
}

.story-workbench__copy p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.7;
}

.story-workbench__chips,
.story-workbench__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.story-workbench__actions {
  align-items: flex-start;
  justify-content: flex-end;
}

.story-stage-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.story-stage-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.story-stage-card--goal {
  border-color: #cfe0ff;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.story-stage-card--path {
  border-color: #d7ebdd;
  background: linear-gradient(180deg, #f8fff9, #ffffff);
}

.story-stage-card--learn {
  border-color: #f6dfb1;
  background: linear-gradient(180deg, #fffdf6, #ffffff);
}

.story-stage-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.story-stage-card__eyebrow {
  display: block;
  margin-bottom: 8px;
  font-size: var(--admin-text-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7b8597;
}

.story-stage-card__head strong {
  display: block;
  font-size: 16px;
  color: #1f2937;
}

.story-stage-card__meta {
  font-size: 12px;
  color: #7b8597;
}

.story-stage-card p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
  font-size: 13px;
}

.story-stage-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.story-task-picker {
  display: grid;
  gap: 8px;
  padding-top: 4px;
}

.story-task-picker span {
  font-size: 12px;
  color: #7b8597;
}

.projection-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.projection-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #dbe6f8;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.projection-card--wide p {
  margin: 10px 0 0;
  color: #5f6b7d;
  line-height: 1.6;
  font-size: 13px;
}

.projection-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.projection-card strong {
  display: block;
  color: #1f2937;
  font-size: 16px;
  line-height: 1.4;
}

.projection-card em {
  display: block;
  margin-top: 8px;
  font-style: normal;
  color: #64748b;
  font-size: 12px;
}

.projection-chip-row,
.projection-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.story-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.story-feature-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 2px;
  border-radius: 0;
  border: 0;
  border-bottom: 1px solid #edf1f6;
  background: transparent;
}

.story-feature-card.active {
  border-color: #edf1f6;
  background: #f8fafc;
}

.story-feature-card__main {
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  flex: 1;
}

.story-feature-card__head,
.story-feature-card__lines,
.story-feature-card__actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.story-feature-card__head {
  align-items: center;
  margin-bottom: 8px;
}

.story-feature-card__index,
.story-feature-card__source {
  font-size: var(--admin-text-micro);
  color: #7b8597;
}

.story-feature-card strong {
  display: block;
  margin-bottom: 8px;
  font-size: var(--admin-text-title-sm);
  line-height: 1.35;
}

.story-feature-card p {
  margin: 0;
  color: #526074;
  line-height: 1.55;
  min-height: auto;
  font-size: 13px;
}

.story-feature-card__lines {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 10px;
}

.story-feature-card__lines--inline {
  flex-direction: row;
  flex-wrap: wrap;
}

.story-feature-card__lines span {
  font-size: 12px;
  color: #6b7280;
}

.story-feature-card__pressures {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e5e7eb;
}

.pressure-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #d46b08;
  font-weight: 600;
}

.pressure-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.story-feature-card__actions {
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.engine-panel {
  display: grid;
  gap: 14px;
}

.trait-panel {
  display: grid;
  gap: 14px;
}

.raw-json-collapse {
  border-top: 1px solid #eef2f7;
  padding-top: 2px;
}

.raw-json-collapse__title {
  font-size: 13px;
  color: #425066;
}

.raw-json-block {
  margin: 0;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid #e7ecf3;
  background: #f7f9fc;
  color: #334155;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  max-height: 280px;
}

.trait-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid #edf1f6;
}

.trait-card {
  padding: 12px 14px;
  border-radius: 0;
  border: 0;
  border-bottom: 1px solid #edf1f6;
  background: transparent;
}

.trait-card:nth-child(2n) {
  border-left: 1px solid #edf1f6;
}

.trait-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.trait-card strong {
  display: block;
  margin-bottom: 8px;
  font-size: var(--admin-text-title-sm);
  line-height: 1.5;
  color: #1f2937;
}

.trait-card p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
  font-size: 13px;
}

.engine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.engine-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.engine-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.engine-card strong {
  display: block;
  margin-bottom: 8px;
  font-size: var(--admin-text-title-sm);
  line-height: 1.4;
  color: #1f2937;
}

.engine-card p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
  font-size: 13px;
}

@media (max-width: 1200px) {
  .profile-overview__content,
  .trait-grid,
  .engine-grid,
  .projection-grid,
  .story-grid,
  .story-stage-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-header__actions,
  .control-grid {
    width: 100%;
  }

  .page-header__actions,
  .title-meta {
    flex-wrap: wrap;
  }

  .story-workbench__hero {
    flex-direction: column;
  }

  .projection-runtime__focus {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* ===== 故事高级诊断折叠区 ===== */
.story-advanced-diag {
  margin: 8px 0 0;
  border-top: 1px dashed #e3e9f0;
  padding-top: 6px;
}

.story-advanced-diag > summary {
  list-style: none;
  cursor: pointer;
  font-size: 11px;
  color: #97a8be;
  user-select: none;
  padding: 4px 0;
}
.story-advanced-diag > summary::-webkit-details-marker { display: none; }
.story-advanced-diag > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 4px;
  font-size: 10px;
}
.story-advanced-diag[open] > summary::before { content: '▾'; }

.story-advanced-diag__body {
  padding: 4px 0 8px;
  display: grid;
  gap: 8px;
}

.adv-row {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 8px;
  align-items: start;
  font-size: 12px;
  color: #5f6b7d;
  line-height: 1.5;
}
.adv-row--text,
.adv-row--object {
  grid-template-columns: 76px 1fr;
}
.adv-row__label {
  color: #97a8be;
  font-weight: 500;
}
.adv-row ul {
  margin: 0;
  padding-left: 16px;
}
.adv-row ul li { color: #3c4858; }
.adv-row--text p { margin: 0; color: #3c4858; }
.adv-row--object pre {
  margin: 0;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 4px;
  font-size: 11px;
  color: #3c4858;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}
</style>
