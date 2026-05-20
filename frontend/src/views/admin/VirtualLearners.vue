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

        <el-table-column label="操作" width="220" fixed="right" align="center">
          <template #default="{ row }">
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
    if (res.success) {
      profiles.value = res.data.profiles;
      pagination.value.total = res.data.pagination.total;
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
    if (res.success && res.data) {
      formData.value.profile.age = res.data.age;
      formData.value.profile.occupation = res.data.occupation;
      formData.value.profile.education = res.data.education;
      formData.value.profile.background = res.data.background;
      if (res.data.personalityTraits) {
        formData.value.personalityTraits = {
          ...formData.value.personalityTraits,
          ...res.data.personalityTraits
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
      if (res.success) {
        ElMessage.success('更新成功');
        createDialogVisible.value = false;
        loadProfiles();
      }
    } else {
      const res = await adminApi.createVirtualLearner(formData.value);
      if (res.success) {
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
    if (res.success) {
      ElMessage.success('删除成功');
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
    if (res.success) {
      ElMessage.success('模拟会话已启动');
      router.push(`/admin/virtual-session/${res.data.id}`);
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
  filter: blur(80px);
}

.bg-orb--1 {
  width: 400px;
  height: 400px;
  background: var(--bg-gradient-1, rgba(99, 102, 241, 0.15));
  top: -100px;
  left: -100px;
}

.bg-orb--2 {
  width: 300px;
  height: 300px;
  background: var(--bg-gradient-2, rgba(168, 85, 247, 0.1));
  bottom: -50px;
  right: -50px;
}

.page-hero {
  position: relative;
  z-index: 1;
  margin-bottom: 24px;
}

.pill {
  display: inline-block;
  padding: 4px 12px;
  background: var(--glass-bg-light, rgba(255, 255, 255, 0.1));
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 8px;
}

.admin-page-title {
  font-size: 28px;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-page-title__icon {
  font-size: 28px;
}

.page-hero__subtitle {
  color: var(--text-secondary, #6b7280);
  margin: 8px 0 0;
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