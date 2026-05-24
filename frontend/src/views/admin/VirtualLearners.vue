<template>
  <div class="admin-virtual-learners">
    <div class="bg-layer">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">虚拟用户模拟</span>
      <h1 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><UserFilled /></el-icon>
        虚拟学习者模拟测试
      </h1>
      <p class="page-hero__subtitle">创建虚拟用户画像，模拟真实学习者体验流程</p>
    </div>

    <div class="toolbar admin-list-toolbar">
      <div class="toolbar-left admin-list-toolbar__group">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索虚拟用户名称"
          style="width: 260px"
          clearable
          @input="debouncedSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-select
          v-model="filterLevel"
          placeholder="知识水平"
          style="width: 140px; margin-left: 0.75rem"
          clearable
        >
          <el-option label="初学者" value="beginner" />
          <el-option label="中级" value="intermediate" />
          <el-option label="高级" value="advanced" />
        </el-select>
      </div>

      <div class="toolbar-right admin-list-toolbar__group">
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>
          创建虚拟用户
        </el-button>
        <el-button @click="loadProfiles" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div class="table-container admin-list-card">
      <el-table
        v-loading="loading"
        :data="filteredProfiles"
        stripe
        style="min-width: 100%"
      >
        <template #empty>
          <el-empty description="暂无虚拟用户，点击上方按钮创建" />
        </template>

        <el-table-column label="虚拟用户" min-width="200">
          <template #default="{ row }">
            <div class="profile-cell">
              <strong class="profile-cell__name">{{ row.userName }}</strong>
              <span class="profile-cell__email">{{ row.email }}</span>
              <span class="profile-cell__meta">{{ row.knowledgeLevel }} | 密码: {{ row.password }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="学习目标" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="goal-text">{{ row.learningGoal }}</span>
          </template>
        </el-table-column>

        <el-table-column label="画像信息" min-width="160">
          <template #default="{ row }">
            <div class="profile-info">
              <span v-if="row.profile?.occupation">{{ row.profile.occupation }}</span>
              <span v-if="row.profile?.age">{{ row.profile.age }}岁</span>
              <span v-if="!row.profile?.occupation && !row.profile?.age">-</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="模拟模式" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.simulationMode === 'ai' ? 'success' : 'info'" size="small">
              {{ row.simulationMode === 'ai' ? 'AI自动' : '手动' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="会话" width="80" align="center">
          <template #default="{ row }">
            <span class="session-count">{{ row.sessionCount || 0 }}</span>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="280" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="openSessionDrawer(row)">
              会话({{ row.sessionCount || 0 }})
            </el-button>
            <el-button type="primary" link size="small" @click="startSession(row)">
              启动模拟
            </el-button>
            <el-button type="default" link size="small" @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container" v-if="pagination.total > pagination.limit">
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="handlePageChange"
        />
      </div>
    </div>

    <el-dialog
      v-model="createDialogVisible"
      :title="editingProfile ? '编辑虚拟用户' : '创建虚拟用户'"
      width="600px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="formData.name" placeholder="虚拟用户显示名称" />
        </el-form-item>

        <el-form-item label="学习目标" prop="learningGoal">
          <el-input
            v-model="formData.learningGoal"
            type="textarea"
            :rows="3"
            placeholder="描述这个虚拟用户想要学习什么..."
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
            AI生成画像
          </el-button>
          <span class="ai-generate-hint" v-if="!formData.learningGoal || !formData.knowledgeLevel">
            需先填写学习目标和知识水平
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
          <el-input
            v-model="formData.profile.background"
            type="textarea"
            :rows="2"
            placeholder="简要描述背景经历..."
          />
        </el-form-item>

        <el-divider>模拟配置</el-divider>

        <el-form-item label="模拟模式">
          <el-radio-group v-model="formData.simulationMode">
            <el-radio value="manual">手动控制</el-radio>
            <el-radio value="ai">AI自动扮演</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="性格设定" v-if="formData.simulationMode === 'ai'">
          <div class="personality-settings">
            <div class="personality-item">
              <span class="label">回复长度:</span>
              <el-radio-group v-model="formData.personalityTraits.verbosity" size="small">
                <el-radio value="terse">简洁</el-radio>
                <el-radio value="normal">适中</el-radio>
                <el-radio value="verbose">详细</el-radio>
              </el-radio-group>
            </div>
            <div class="personality-item">
              <span class="label">态度倾向:</span>
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
          <el-input v-model="formData.notes" type="textarea" :rows="2" placeholder="管理员备注..." />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ editingProfile ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="sessionDrawerVisible"
      :title="`${currentSessionProfile?.userName || ''} 的模拟会话`"
      size="520px"
      direction="rtl"
    >
      <el-table :data="currentSessions" v-loading="sessionsLoading" stripe size="small">
        <template #empty>
          <el-empty description="暂无会话记录" :image-size="60" />
        </template>

        <el-table-column label="状态" width="80" align="center">
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

        <el-table-column label="创建时间" width="140">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="goToSession(row.id)">
              进入
            </el-button>
            <el-button type="danger" link size="small" @click="deleteSession(row.id)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { UserFilled, Plus, Refresh, Search, MagicStick } from '@element-plus/icons-vue';
import { adminApi } from '@/api/adminApi';

const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const generatingProfile = ref(false);
const profiles = ref<any[]>([]);
const searchKeyword = ref('');
const filterLevel = ref('');
const pagination = ref({
  page: 1,
  limit: 20,
  total: 0
});

const createDialogVisible = ref(false);
const sessionDrawerVisible = ref(false);
const sessionsLoading = ref(false);
const currentSessionProfile = ref<any>(null);
const currentSessions = ref<any[]>([]);
const editingProfile = ref<any>(null);
const formRef = ref();

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
});

const formRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  learningGoal: [{ required: true, message: '请输入学习目标', trigger: 'blur' }],
  knowledgeLevel: [{ required: true, message: '请选择知识水平', trigger: 'change' }]
};

const filteredProfiles = computed(() => {
  return profiles.value.filter(p => {
    if (searchKeyword.value && !p.userName?.toLowerCase().includes(searchKeyword.value.toLowerCase())) {
      return false;
    }
    if (filterLevel.value && p.knowledgeLevel !== filterLevel.value) {
      return false;
    }
    return true;
  });
});

const formatTime = (time: string | Date | null) => {
  if (!time) return '-';
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const debouncedSearch = () => {
  pagination.value.page = 1;
};

const loadProfiles = async () => {
  loading.value = true;
  try {
    const res = await adminApi.getVirtualLearners({
      page: pagination.value.page,
      limit: pagination.value.limit
    });
    if (res.data?.success) {
      profiles.value = res.data.data?.profiles || [];
      pagination.value.total = res.data.data?.pagination?.total || 0;
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = (page: number) => {
  pagination.value.page = page;
  loadProfiles();
};

const openCreateDialog = () => {
  editingProfile.value = null;
  formData.value = {
    name: '',
    learningGoal: '',
    knowledgeLevel: 'beginner',
    profile: { age: undefined, occupation: '', education: '', background: '' },
    simulationMode: 'manual',
    simulationTemperature: 0.8,
    personalityTraits: { verbosity: 'normal', enthusiasm: 'normal', confusionStyle: 'direct' },
    notes: ''
  };
  createDialogVisible.value = true;
};

const openEditDialog = (profile: any) => {
  editingProfile.value = profile;
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
  };
  createDialogVisible.value = true;
};

const handleGenerateProfile = async () => {
  generatingProfile.value = true;
  try {
    const res = await adminApi.generateProfile({
      learningGoal: formData.value.learningGoal,
      knowledgeLevel: formData.value.knowledgeLevel,
      simulationMode: formData.value.simulationMode,
      personalityTraits: formData.value.personalityTraits
    });
    if (res.data?.success && res.data?.data) {
      const generated = res.data.data;
      formData.value.profile.age = generated.age;
      formData.value.profile.occupation = generated.occupation;
      formData.value.profile.education = generated.education;
      formData.value.profile.background = generated.background;
      if (generated.personalityTraits) {
        formData.value.personalityTraits = {
          ...formData.value.personalityTraits,
          ...generated.personalityTraits
        };
      }
      ElMessage.success('画像已生成');
    }
  } catch (error: any) {
    ElMessage.error(error.message || '生成画像失败');
  } finally {
    generatingProfile.value = false;
  }
};

const handleSubmit = async () => {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  submitting.value = true;
  try {
    if (editingProfile.value) {
      const res = await adminApi.updateVirtualLearner(editingProfile.value.id, formData.value);
      if (res.data?.success) {
        ElMessage.success('更新成功');
        createDialogVisible.value = false;
        loadProfiles();
      }
    } else {
      const res = await adminApi.createVirtualLearner(formData.value);
      if (res.data?.success) {
        ElMessage.success('创建成功');
        createDialogVisible.value = false;
        loadProfiles();
      }
    }
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败');
  } finally {
    submitting.value = false;
  }
};

const handleDelete = async (profile: any) => {
  try {
    await ElMessageBox.confirm(
      `确定删除虚拟用户 "${profile.userName}"？该用户的所有学习数据也将被删除。`,
      '确认删除',
      { type: 'warning' }
    );
    const res = await adminApi.deleteVirtualLearner(profile.id);
    if (res.data?.success) {
      ElMessage.success('删除成功');
      loadProfiles();
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
};

const getSessionStatusType = (status: string) => {
  switch (status) {
    case 'running': return 'success';
    case 'completed': return 'info';
    case 'failed': return 'danger';
    default: return 'warning';
  }
};

const getSessionStatusLabel = (status: string) => {
  switch (status) {
    case 'created': return '已创建';
    case 'running': return '运行中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    default: return status || '未知';
  }
};

const getSessionStageLabel = (stage: string) => {
  switch (stage) {
    case 'goal': return 'Goal';
    case 'path': return '路径';
    case 'learning': return '学习';
    default: return stage || '-';
  }
};

const openSessionDrawer = async (profile: any) => {
  currentSessionProfile.value = profile;
  currentSessions.value = profile.sessions || [];
  sessionDrawerVisible.value = true;
  
  sessionsLoading.value = true;
  try {
    const res = await adminApi.getVirtualLearner(profile.id);
    if (res.data?.success) {
      currentSessions.value = res.data.data?.sessions || [];
    }
  } catch {} finally {
    sessionsLoading.value = false;
  }
};

const goToSession = (sessionId: string) => {
  sessionDrawerVisible.value = false;
  router.push(`/admin/virtual-session/${sessionId}`);
};

const deleteSession = async (sessionId: string) => {
  try {
    await ElMessageBox.confirm('确定删除此会话？相关数据将被清除。', '确认删除', { type: 'warning' });
    const res = await adminApi.deleteVirtualSession(sessionId);
    if (res.data?.success) {
      ElMessage.success('会话已删除');
      currentSessions.value = currentSessions.value.filter(s => s.id !== sessionId);
      loadProfiles();
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
};

const startSession = async (profile: any) => {
  try {
    const res = await adminApi.startVirtualSession(profile.id);
    if (res.data?.success) {
      ElMessage.success('模拟会话已启动');
      router.push(`/admin/virtual-session/${res.data.data?.id}`);
    }
  } catch (error: any) {
    ElMessage.error(error.message || '启动失败');
  }
};

onMounted(() => {
  loadProfiles();
});
</script>

<style scoped>
.admin-virtual-learners {
  padding: 24px;
  min-height: 100vh;
  position: relative;
}

.bg-layer {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.15;
}

.bg-orb--1 {
  width: 460px;
  height: 460px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%);
  top: -180px;
  left: -100px;
  animation: orb-d 26s ease-in-out infinite;
}

.bg-orb--2 {
  width: 380px;
  height: 380px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
  bottom: -50px;
  right: -50px;
  animation: orb-d 30s ease-in-out infinite reverse;
}

@keyframes orb-d {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 30px) scale(0.95); }
}

.page-hero {
  position: relative;
  z-index: 1;
  margin-bottom: 1.5rem;
  padding: 24px 28px;
  border-radius: 20px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92));
  backdrop-filter: blur(16px);
}

.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 10%, white);
  color: var(--color-primary-dark, #1f57cc);
  font-size: 12px;
  font-weight: 700;
}

.admin-page-title {
  margin: 8px 0 0;
  font-size: 1.5rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  letter-spacing: -0.03em;
}

.admin-page-title__icon {
  font-size: 1.25rem;
  color: var(--color-primary);
}

.page-hero__subtitle {
  color: var(--text-secondary);
  margin: 4px 0 0;
  font-size: 0.9375rem;
}

.toolbar {
  position: relative;
  z-index: 1;
  margin-bottom: 16px;
}

.admin-list-toolbar {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.admin-list-toolbar__group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-container {
  position: relative;
  z-index: 1;
}

.admin-list-card {
  background: var(--glass-bg-light, rgba(255, 255, 255, 0.05));
  border-radius: 12px;
  border: 1px solid var(--glass-border-light, rgba(255, 255, 255, 0.1));
  padding: 16px;
}

.profile-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.profile-cell__name {
  font-weight: 600;
}

.profile-cell__email {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.profile-cell__meta {
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
}

.goal-text {
  color: var(--text-primary, #374151);
}

.profile-info {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.session-count {
  font-weight: 600;
}

.pagination-container {
  margin-top: 16px;
  display: flex;
  justify-content: center;
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
  color: var(--text-secondary, #6b7280);
}

.ai-generate-section {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-generate-hint {
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
}
</style>