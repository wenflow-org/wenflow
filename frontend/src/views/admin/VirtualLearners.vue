<template>
  <div class="learner-lab-page">
    <div class="lab-backdrop">
      <div class="lab-glow lab-glow--blue"></div>
      <div class="lab-glow lab-glow--amber"></div>
    </div>

    <section class="lab-hero">
      <div class="lab-hero__copy">
        <span class="lab-pill">Virtual Learner Lab</span>
        <h1>虚拟学习者实验总控台</h1>
      </div>

      <div class="lab-hero__actions">
        <el-button type="primary" size="large" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>
          新建虚拟学习者
        </el-button>
        <el-button size="large" :loading="loading" @click="loadProfiles">
          <el-icon><Refresh /></el-icon>
          刷新数据
        </el-button>
      </div>
    </section>

    <section class="summary-grid">
      <article v-for="item in summaryCards" :key="item.label" class="summary-card" :class="item.tone">
        <span class="summary-card__label">{{ item.label }}</span>
        <strong class="summary-card__value">{{ item.value }}</strong>
        <span class="summary-card__helper">{{ item.helper }}</span>
      </article>
    </section>

    <main class="lab-shell">
      <aside class="lab-sidebar">
        <section class="lab-panel">
          <div class="lab-panel__title">筛选器</div>
          <div class="filter-stack">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索名称 / 学习目标"
              clearable
              @input="debouncedSearch"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>

            <el-select v-model="filterLevel" placeholder="知识水平" clearable>
              <el-option label="初学者" value="beginner" />
              <el-option label="中级" value="intermediate" />
              <el-option label="高级" value="advanced" />
            </el-select>
          </div>
        </section>
      </aside>

      <section class="lab-main">
        <section class="lab-panel lab-panel--profiles">
          <div class="lab-panel__head">
            <div>
              <div class="lab-panel__title">虚拟学习者库</div>
            </div>
            <div class="lab-panel__meta">共 {{ filteredProfiles.length }} 个样本</div>
          </div>

          <div v-if="loading" class="empty-state">正在加载虚拟学习者...</div>
          <div v-else-if="filteredProfiles.length === 0" class="empty-state">暂无匹配的虚拟学习者</div>
          <div v-else class="profile-grid">
            <article v-for="row in pagedProfiles" :key="row.id" class="profile-card">
              <div class="profile-card__head">
                <div class="avatar-badge">{{ row.userName?.charAt(0) || '?' }}</div>
                <div class="profile-card__identity">
                  <strong>{{ row.userName }}</strong>
                  <span>{{ row.email }}</span>
                </div>
                <el-tag size="small" :type="row.simulationMode === 'ai' ? 'success' : 'info'">
                  {{ row.simulationMode === 'ai' ? 'AI 自动' : '手动' }}
                </el-tag>
              </div>

              <div class="profile-card__body">
                <div class="profile-kv">
                  <span>学习目标</span>
                  <strong>{{ row.learningGoal || '-' }}</strong>
                </div>
                <div class="profile-meta-row">
                  <span>{{ getKnowledgeLevelLabel(row.knowledgeLevel) }}</span>
                  <span v-if="row.profile?.occupation">{{ row.profile.occupation }}</span>
                  <span v-if="row.profile?.age">{{ row.profile.age }}岁</span>
                </div>

                <div class="profile-stats">
                  <div class="mini-stat">
                    <span>会话数</span>
                    <strong>{{ row.sessionCount || 0 }}</strong>
                  </div>
                  <div class="mini-stat">
                    <span>创建时间</span>
                    <strong>{{ formatTime(row.createdAt) }}</strong>
                  </div>
                </div>
              </div>

              <div class="profile-card__footer">
                <el-button type="primary" @click="startSession(row)">启动模拟</el-button>
                <el-button @click="openSessionDrawer(row)">会话库</el-button>
                <el-dropdown trigger="click">
                  <el-button>
                    更多
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
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
              <div class="lab-panel__title">最近实验样本</div>
            </div>
          </div>

          <div v-if="recentSessions.length === 0" class="empty-state small">还没有可回看的样本</div>
          <div v-else class="session-list">
            <article v-for="item in recentSessions" :key="item.id" class="session-row">
              <div class="session-row__main">
                <strong>{{ item.profileName }}</strong>
                <p>{{ item.goal || '暂无学习目标' }}</p>
                <div class="session-funnel">
                  <span class="session-funnel__node" :class="item.goalReady ? 'done' : 'active'">Goal</span>
                  <span class="session-funnel__line" :class="{ done: item.goalReady }"></span>
                  <span class="session-funnel__node" :class="item.pathReady ? 'done' : (item.goalReady ? 'active' : '')">Path</span>
                  <span class="session-funnel__line" :class="{ done: item.pathReady }"></span>
                  <span class="session-funnel__node" :class="item.learnStarted ? (item.learnCompleted ? 'done' : 'active') : ''">Learn</span>
                </div>
              </div>
              <div class="session-row__meta">
                <el-tag size="small" :type="getSessionStatusType(item.status)">{{ getSessionStatusLabel(item.status) }}</el-tag>
                <el-tag size="small" type="info" effect="plain">{{ getSessionStageLabel(item.currentStage) }}</el-tag>
                <span v-if="item.roundCount !== null">{{ item.roundCount }} 轮</span>
                <span>{{ formatTime(item.createdAt) }}</span>
              </div>
              <el-button type="primary" link @click="goToSession(item.id)">进入回放</el-button>
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
        <el-form-item label="名称" prop="name">
          <el-input v-model="formData.name" placeholder="虚拟学习者显示名称" />
        </el-form-item>

        <el-form-item label="学习目标" prop="learningGoal">
          <el-input
            v-model="formData.learningGoal"
            type="textarea"
            :rows="3"
            placeholder="描述这个虚拟学习者想解决什么问题、想学到什么..."
          />
        </el-form-item>

        <el-form-item label="知识水平" prop="knowledgeLevel">
          <el-select v-model="formData.knowledgeLevel" style="width: 100%">
            <el-option label="初学者" value="beginner" />
            <el-option label="中级" value="intermediate" />
            <el-option label="高级" value="advanced" />
          </el-select>
        </el-form-item>

        <el-divider>画像设定</el-divider>

        <div class="ai-generate-section">
          <el-button
            type="primary"
            :loading="generatingProfile"
            :disabled="!formData.learningGoal || !formData.knowledgeLevel"
            @click="handleGenerateProfile"
          >
            <el-icon><MagicStick /></el-icon>
            AI 生成画像
          </el-button>
          <span class="ai-generate-hint" v-if="!formData.learningGoal || !formData.knowledgeLevel">
            请先填写学习目标和知识水平
          </span>
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

        <el-divider>模拟配置</el-divider>

        <el-form-item label="模拟模式">
          <el-radio-group v-model="formData.simulationMode">
            <el-radio value="manual">手动控制</el-radio>
            <el-radio value="ai">AI 自动扮演</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="性格设定" v-if="formData.simulationMode === 'ai'">
          <div class="personality-settings">
            <div class="personality-item">
              <span class="label">回复长度</span>
              <el-radio-group v-model="formData.personalityTraits.verbosity" size="small">
                <el-radio value="terse">简洁</el-radio>
                <el-radio value="normal">适中</el-radio>
                <el-radio value="verbose">详细</el-radio>
              </el-radio-group>
            </div>
            <div class="personality-item">
              <span class="label">态度倾向</span>
              <el-radio-group v-model="formData.personalityTraits.enthusiasm" size="small">
                <el-radio value="low">冷淡</el-radio>
                <el-radio value="normal">正常</el-radio>
                <el-radio value="high">热情</el-radio>
              </el-radio-group>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="Temperature" v-if="formData.simulationMode === 'ai'">
          <el-slider v-model="formData.simulationTemperature" :min="0.5" :max="1.2" :step="0.1" show-input />
        </el-form-item>

        <el-form-item label="备注">
          <el-input v-model="formData.notes" type="textarea" :rows="2" placeholder="管理员备注" />
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
      :title="`${currentSessionProfile?.userName || ''} 的会话库`"
      size="620px"
      direction="rtl"
    >
      <div class="drawer-summary">
        <strong>{{ currentSessionProfile?.learningGoal || '暂无学习目标' }}</strong>
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
            <el-button type="primary" link size="small" @click="goToSession(row.id)">进入</el-button>
            <el-button type="danger" link size="small" @click="deleteSession(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
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
const generatingProfile = ref(false)
const profiles = ref<any[]>([])
const searchKeyword = ref('')
const filterLevel = ref('')
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
const editingProfile = ref<any>(null)
const formRef = ref()

const formData = ref({
  name: '',
  learningGoal: '',
  knowledgeLevel: 'beginner',
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
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  learningGoal: [{ required: true, message: '请输入学习目标', trigger: 'blur' }],
  knowledgeLevel: [{ required: true, message: '请选择知识水平', trigger: 'change' }]
}

const filteredProfiles = computed(() => {
  return profiles.value.filter((p: any) => {
    const searchTarget = `${p.userName || ''} ${p.learningGoal || ''}`.toLowerCase()
    if (searchKeyword.value && !searchTarget.includes(searchKeyword.value.toLowerCase())) {
      return false
    }
    if (filterLevel.value && p.knowledgeLevel !== filterLevel.value) {
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

  const allSessions = profiles.value.flatMap((item: any) => item.sessions || [])
  const completedSessions = allSessions.filter((item: any) => item.status === 'completed').length
  const failedSessions = allSessions.filter((item: any) => item.status === 'failed').length
  const goalReadySessions = allSessions.filter((item: any) => item.currentStage === 'path' || item.currentStage === 'learning' || item.status === 'completed').length
  const pathReadySessions = allSessions.filter((item: any) => item.learningPathId || item.currentStage === 'learning' || item.status === 'completed').length
  const learnCompletedSessions = completedSessions

  const totalSessionBase = Math.max(allSessions.length, 1)
  const goalReadyRate = `${Math.round((goalReadySessions / totalSessionBase) * 100)}%`
  const pathReadyRate = `${Math.round((pathReadySessions / totalSessionBase) * 100)}%`
  const learnCompletionRate = `${Math.round((learnCompletedSessions / totalSessionBase) * 100)}%`

  return [
    {
      label: '样本池规模',
      value: String(totalProfiles),
      helper: '当前可用于实验的虚拟学习者数量',
      tone: 'tone-blue'
    },
    {
      label: '实验总会话',
      value: String(totalSessions),
      helper: `${completedSessions} 完成 / ${failedSessions} 失败`,
      tone: 'tone-dark'
    },
    {
      label: 'Goal Ready 率',
      value: goalReadyRate,
      helper: `${goalReadySessions}/${allSessions.length || 0} 个样本进入 Path`,
      tone: 'tone-green'
    },
    {
      label: 'Path 成功率',
      value: pathReadyRate,
      helper: `${pathReadySessions}/${allSessions.length || 0} 个样本生成路径`,
      tone: 'tone-amber'
    },
    {
      label: 'Learn 完成率',
      value: learnCompletionRate,
      helper: `${learnCompletedSessions}/${allSessions.length || 0} 个样本完整跑通`,
      tone: 'tone-blue'
    },
    {
      label: 'AI 自动画像',
      value: String(autoProfiles),
      helper: `${activeProfiles} 个已开始积累实验记录`,
      tone: 'tone-green'
    }
  ]
})

const getKnowledgeLevelLabel = (value: string) => {
  switch (value) {
    case 'beginner':
      return '初学者'
    case 'intermediate':
      return '中级'
    case 'advanced':
      return '高级'
    default:
      return value || '-'
  }
}

const formatTime = (time: string | Date | null) => {
  if (!time) return '-'
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  formData.value = {
    name: '',
    learningGoal: '',
    knowledgeLevel: 'beginner',
    profile: { age: undefined, occupation: '', education: '', background: '' },
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
  editingProfile.value = profile
  formData.value = {
    name: profile.userName || '',
    learningGoal: profile.learningGoal || '',
    knowledgeLevel: profile.knowledgeLevel || 'beginner',
    profile: {
      age: profile.profile?.age,
      occupation: profile.profile?.occupation || '',
      education: profile.profile?.education || '',
      background: profile.profile?.background || ''
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

const handleGenerateProfile = async () => {
  generatingProfile.value = true
  try {
    const res = await adminApi.generateProfile({
      learningGoal: formData.value.learningGoal,
      knowledgeLevel: formData.value.knowledgeLevel,
      simulationMode: formData.value.simulationMode,
      personalityTraits: formData.value.personalityTraits
    })
    if (res.data?.success && res.data?.data) {
      const generated = res.data.data
      formData.value.profile.age = generated.age
      formData.value.profile.occupation = generated.occupation
      formData.value.profile.education = generated.education
      formData.value.profile.background = generated.background
      if (generated.personalityTraits) {
        formData.value.personalityTraits = {
          ...formData.value.personalityTraits,
          ...generated.personalityTraits
        }
      }
      ElMessage.success('画像已生成')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '生成画像失败')
  } finally {
    generatingProfile.value = false
  }
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

const startSession = async (profile: any) => {
  try {
    const res = await adminApi.startVirtualSession(profile.id)
    if (res.data?.success) {
      ElMessage.success('模拟会话已启动')
      router.push(`/admin/virtual-session/${res.data.data?.id}`)
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
  padding: 24px;
  position: relative;
  background: #f6f7fb;
}

.lab-backdrop {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.lab-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.18;
}

.lab-glow--blue {
  width: 420px;
  height: 420px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.35), transparent 70%);
  top: -140px;
  left: -80px;
}

.lab-glow--amber {
  width: 360px;
  height: 360px;
  background: radial-gradient(circle, rgba(245, 158, 11, 0.22), transparent 70%);
  right: -40px;
  bottom: -30px;
}

.lab-hero,
.summary-grid,
.lab-shell {
  position: relative;
  z-index: 1;
}

.lab-hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 28px;
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(244, 247, 252, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.06);
  margin-bottom: 16px;
}

.lab-pill {
  display: inline-flex;
  padding: 5px 12px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2355d8;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 10px;
}

.lab-hero h1 {
  margin: 0 0 8px;
  font-size: 32px;
  line-height: 1.1;
}

.lab-hero__actions {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
  align-items: stretch;
}

.summary-card {
  min-height: 132px;
  padding: 16px 16px 14px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(222, 228, 239, 0.9);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.04);
}

.summary-card__label {
  display: block;
  font-size: 12px;
  color: #7b8598;
  margin-bottom: 10px;
}

.summary-card__value {
  display: block;
  font-size: 34px;
  line-height: 1.1;
}

.summary-card__helper {
  display: block;
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.45;
  color: #5f6b7d;
}

.tone-blue {
  background: linear-gradient(180deg, #f3f8ff, #ffffff);
}

.tone-dark {
  background: linear-gradient(180deg, #f8fafc, #ffffff);
}

.tone-green {
  background: linear-gradient(180deg, #f2fbf5, #ffffff);
}

.tone-amber {
  background: linear-gradient(180deg, #fff8ee, #ffffff);
}

.lab-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
}

.lab-sidebar,
.lab-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lab-panel {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(223, 228, 238, 0.92);
  border-radius: 20px;
  padding: 18px;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.04);
}

.lab-panel__head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.lab-panel__title {
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
}

.lab-panel__meta {
  font-size: 12px;
  color: #8b94a6;
  white-space: nowrap;
}

.filter-stack,
.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint-compact {
  font-size: 13px;
  color: #5f6b7d;
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.profile-card {
  border: 1px solid #e7ecf3;
  border-radius: 18px;
  padding: 16px;
  background: #fbfcfe;
}

.profile-card__head,
.profile-card__footer,
.profile-meta-row,
.profile-stats,
.session-row,
.session-row__meta,
.task-row {
  display: flex;
  align-items: center;
}

.profile-card__head {
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.avatar-badge {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1f4fd6, #7c3aed);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
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

.profile-kv {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.profile-kv span {
  font-size: 12px;
  color: #8b94a6;
}

.profile-kv strong {
  font-size: 14px;
  line-height: 1.5;
  color: #273142;
}

.profile-meta-row {
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  font-size: 12px;
  color: #6b7280;
}

.profile-meta-row span {
  padding: 4px 8px;
  border-radius: 999px;
  background: #f1f5f9;
}

.profile-stats {
  gap: 10px;
}

.mini-stat {
  flex: 1;
  padding: 10px 12px;
  border-radius: 14px;
  background: white;
  border: 1px solid #edf1f6;
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
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.pagination-row {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.session-row {
  justify-content: space-between;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid #edf1f6;
}

.session-row__main {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-row:last-child {
  border-bottom: none;
}

.session-row strong {
  display: block;
  margin-bottom: 4px;
}

.session-row p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}

.session-funnel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-funnel__node {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: #7a8597;
  font-size: 11px;
  font-weight: 700;
}

.session-funnel__node.active {
  background: #eef5ff;
  color: #1f4fd6;
}

.session-funnel__node.done {
  background: #e7f8eb;
  color: #1f8a4d;
}

.session-funnel__line {
  width: 22px;
  height: 2px;
  background: #d9e0ea;
  border-radius: 999px;
}

.session-funnel__line.done {
  background: #8fd0a8;
}

.session-row__meta {
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #8b94a6;
}

.empty-state {
  padding: 32px;
  border-radius: 18px;
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

@media (max-width: 1280px) {
  .summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .profile-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 980px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lab-shell {
    grid-template-columns: 1fr;
  }

  .lab-hero {
    flex-direction: column;
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
