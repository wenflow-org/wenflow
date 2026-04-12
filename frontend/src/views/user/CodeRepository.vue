<template>
  <CapabilityShell title="代码仓库" description="高级扩展入口。管理自定义 Agent / Skill / MCP Tool 的源码，用于支撑能力替换与本地扩展。">
    <template #actions>
      <el-button type="primary" @click="showCreateDialog">
        <el-icon><Plus /></el-icon>
        新建代码
      </el-button>
    </template>
    <div class="code-repo-page">

    <!-- 统计卡片 -->
    <div class="stats">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">总仓库数</div>
              <div class="value">{{ repositories.length }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">Agent 代码</div>
              <div class="value">{{ countByType('AGENT') }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">Skill 代码</div>
              <div class="value">{{ countByType('SKILL') }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">MCP 工具</div>
              <div class="value">{{ countByType('MCP_TOOL') }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 筛选器 -->
    <div class="filters">
      <el-form :inline="true">
        <el-form-item label="类型">
          <el-select v-model="filterType" placeholder="全部" clearable @change="loadRepositories">
            <el-option label="Agent" value="AGENT" />
            <el-option label="Skill" value="SKILL" />
            <el-option label="MCP 工具" value="MCP_TOOL" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filterStatus" placeholder="全部" clearable @change="loadRepositories">
            <el-option label="活跃" value="active" />
            <el-option label="归档" value="archived" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="searchKeyword" placeholder="搜索名称或描述" clearable @change="loadRepositories" />
        </el-form-item>
      </el-form>
    </div>

    <!-- 代码仓库列表 -->
    <div class="repo-list">
      <el-row :gutter="20" v-loading="loading">
        <el-col :span="8" v-for="repo in filteredRepos" :key="repo.id">
          <el-card shadow="hover" class="repo-card">
            <template #header>
              <div class="card-header">
                <span class="repo-name">{{ repo.name }}</span>
                <el-tag :type="repo.type === 'AGENT' ? 'primary' : repo.type === 'SKILL' ? 'success' : 'warning'" size="small">
                  {{ getTypeLabel(repo.type) }}
                </el-tag>
              </div>
            </template>
            <div class="repo-content">
              <p class="repo-description">{{ repo.description || '暂无描述' }}</p>
              <div class="repo-meta">
                <span>版本：{{ repo.version }}</span>
                <el-tag :type="repo.status === 'active' ? 'success' : 'info'" size="small">
                  {{ repo.status === 'active' ? '活跃' : '归档' }}
                </el-tag>
              </div>
              <div class="repo-time">
                更新于：{{ formatDate(repo.updatedAt) }}
              </div>
            </div>
            <template #footer>
              <div class="card-actions">
                <el-button link type="primary" @click="viewDetail(repo)">查看</el-button>
                <el-button link type="primary" @click="editRepo(repo)">编辑</el-button>
                <el-button link type="primary" @click="testCode(repo)">测试</el-button>
                <el-button link type="danger" @click="deleteRepo(repo)">删除</el-button>
              </div>
            </template>
          </el-card>
        </el-col>
      </el-row>

      <el-empty v-if="!loading && filteredRepos.length === 0" description="暂无代码仓库" />
    </div>

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑代码' : '新建代码'"
      width="900px"
      @close="resetForm"
    >
      <el-form :model="formData" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="formData.name" placeholder="my-agent" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="formData.type" placeholder="请选择类型">
            <el-option label="Agent" value="AGENT" />
            <el-option label="Skill" value="SKILL" />
            <el-option label="MCP 工具" value="MCP_TOOL" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" placeholder="简要描述代码功能" />
        </el-form-item>
        <el-form-item label="代码" required>
          <div class="code-editor-wrapper">
            <el-input
              v-model="formData.code"
              type="textarea"
              :rows="20"
              placeholder="export async function execute(input) {&#10;  // 在这里编写你的代码&#10;  return { output: 'Hello' };&#10;}"
              style="font-family: 'Courier New', monospace;"
            />
          </div>
        </el-form-item>
        <el-form-item label="输入 Schema">
          <el-input
            v-model="formData.inputSchema"
            type="textarea"
            :rows="5"
            placeholder='{"type": "object", "properties": {...}}'
            style="font-family: 'Courier New', monospace;"
          />
        </el-form-item>
        <el-form-item label="输出 Schema">
          <el-input
            v-model="formData.outputSchema"
            type="textarea"
            :rows="5"
            placeholder='{"type": "object", "properties": {...}}'
            style="font-family: 'Courier New', monospace;"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailVisible" title="代码详情" width="900px">
      <el-descriptions :column="2" border v-if="currentRepo">
        <el-descriptions-item label="名称">{{ currentRepo.name }}</el-descriptions-item>
        <el-descriptions-item label="类型">
          <el-tag :type="currentRepo.type === 'AGENT' ? 'primary' : 'success'" size="small">
            {{ getTypeLabel(currentRepo.type) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="版本">{{ currentRepo.version }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="currentRepo.status === 'active' ? 'success' : 'info'" size="small">
            {{ currentRepo.status === 'active' ? '活跃' : '归档' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="描述" :span="2">{{ currentRepo.description || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">{{ formatDate(currentRepo.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间" :span="2">{{ formatDate(currentRepo.updatedAt) }}</el-descriptions-item>
        <el-descriptions-item label="代码" :span="2">
          <pre class="code-block">{{ currentRepo.code }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>

    <!-- 测试对话框 -->
    <el-dialog v-model="testVisible" title="测试代码" width="800px">
      <el-form label-width="100px">
        <el-form-item label="测试输入">
          <el-input
            v-model="testInput"
            type="textarea"
            :rows="5"
            placeholder='{"message": "Hello"}'
            style="font-family: 'Courier New', monospace;"
          />
        </el-form-item>
        <el-form-item label="执行结果">
          <el-input
            v-model="testResult"
            type="textarea"
            :rows="10"
            readonly
            style="font-family: 'Courier New', monospace;"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="testVisible = false">关闭</el-button>
        <el-button type="primary" @click="runTest" :loading="testing">运行测试</el-button>
      </template>
    </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import {
  getCodeRepositories,
  saveCodeRepository,
  deleteCodeRepository,
  testCodeRepository
} from '@/api/userCustom';
import dayjs from 'dayjs';

const loading = ref(false);
const submitting = ref(false);
const testing = ref(false);
const repositories = ref<any[]>([]);
const dialogVisible = ref(false);
const detailVisible = ref(false);
const testVisible = ref(false);
const isEdit = ref(false);
const currentRepo = ref<any>(null);
const testRepo = ref<any>(null);
const filterType = ref('');
const filterStatus = ref('');
const searchKeyword = ref('');
const testInput = ref('');
const testResult = ref('');

const formData = reactive({
  id: '',
  name: '',
  type: 'AGENT' as 'AGENT' | 'SKILL' | 'MCP_TOOL',
  code: '',
  description: '',
  inputSchema: '',
  outputSchema: ''
});

const filteredRepos = computed(() => {
  return repositories.value.filter(repo => {
    if (filterType.value && repo.type !== filterType.value) return false;
    if (filterStatus.value && repo.status !== filterStatus.value) return false;
    if (searchKeyword.value) {
      const keyword = searchKeyword.value.toLowerCase();
      return repo.name.toLowerCase().includes(keyword) ||
        (repo.description && repo.description.toLowerCase().includes(keyword));
    }
    return true;
  });
});

onMounted(() => {
  loadRepositories();
});

const loadRepositories = async () => {
  loading.value = true;
  try {
    const params: any = {};
    if (filterType.value) params.type = filterType.value;
    if (filterStatus.value) params.status = filterStatus.value;

    const res = await getCodeRepositories(params);
    repositories.value = res.data;
  } catch (error) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const countByType = (type: string) => {
  return repositories.value.filter(r => r.type === type).length;
};

const getTypeLabel = (type: string) => {
  const labels: any = { AGENT: 'Agent', SKILL: 'Skill', MCP_TOOL: 'MCP 工具' };
  return labels[type] || type;
};

const formatDate = (date: string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

const showCreateDialog = () => {
  isEdit.value = false;
  dialogVisible.value = true;
};

const viewDetail = (repo: any) => {
  currentRepo.value = repo;
  detailVisible.value = true;
};

const editRepo = (repo: any) => {
  isEdit.value = true;
  currentRepo.value = repo;
  formData.id = repo.id;
  formData.name = repo.name;
  formData.type = repo.type;
  formData.code = repo.code || '';
  formData.description = repo.description || '';
  formData.inputSchema = repo.inputSchema || '';
  formData.outputSchema = repo.outputSchema || '';
  dialogVisible.value = true;
};

const testCode = (repo: any) => {
  testRepo.value = repo;
  testInput.value = '';
  testResult.value = '';
  testVisible.value = true;
};

const deleteRepo = async (repo: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除代码仓库 "${repo.name}" 吗？`, '确认删除', {
      type: 'warning'
    });
    
    await deleteCodeRepository(repo.id);
    ElMessage.success('删除成功');
    loadRepositories();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败');
    }
  }
};

const submitForm = async () => {
  if (!formData.name || !formData.type || !formData.code) {
    ElMessage.warning('请填写必填项');
    return;
  }

  submitting.value = true;
  try {
    await saveCodeRepository({
      name: formData.name,
      type: formData.type,
      code: formData.code,
      description: formData.description,
      inputSchema: formData.inputSchema ? JSON.parse(formData.inputSchema) : undefined,
      outputSchema: formData.outputSchema ? JSON.parse(formData.outputSchema) : undefined
    });
    
    ElMessage.success('保存成功');
    dialogVisible.value = false;
    loadRepositories();
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    submitting.value = false;
  }
};

const runTest = async () => {
  if (!testRepo.value) return;
  
  testing.value = true;
  try {
    let input;
    try {
      input = JSON.parse(testInput.value || '{}');
    } catch {
      input = { text: testInput.value };
    }

    const res = await testCodeRepository(testRepo.value.id, input);
    testResult.value = JSON.stringify(res.data, null, 2);
  } catch (error: any) {
    testResult.value = `执行失败：${error.message}`;
  } finally {
    testing.value = false;
  }
};

const resetForm = () => {
  formData.id = '';
  formData.name = '';
  formData.type = 'AGENT';
  formData.code = '';
  formData.description = '';
  formData.inputSchema = '';
  formData.outputSchema = '';
  currentRepo.value = null;
};
</script>

<style scoped lang="scss">
.code-repo-page {
  .stats {
    margin-bottom: 20px;

    .stat-item {
      text-align: center;

      .label {
        font-size: 14px;
        color: var(--text-secondary);
        margin-bottom: 8px;
      }

      .value {
        font-size: 24px;
        font-weight: bold;
        color: var(--text-primary);
      }
    }
  }

  .filters {
    margin-bottom: 20px;
    padding: 18px 20px 2px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(20px);
    box-shadow: var(--shadow-md);
  }

  .repo-list {
    :deep(.el-card) {
      background: rgba(255, 255, 255, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.3);
      backdrop-filter: blur(20px);
      box-shadow: var(--shadow-md);
    }

    .el-row {
      row-gap: 20px;
    }

    .repo-card {
      height: 100%;
      border-radius: 24px;

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .repo-name {
          font-weight: bold;
          font-size: 16px;
        }
      }

      .repo-content {
        .repo-description {
          color: var(--text-secondary);
          margin-bottom: 10px;
          min-height: 40px;
        }

        .repo-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 13px;
          color: var(--text-muted);
        }

        .repo-time {
          font-size: 12px;
          color: var(--text-muted);
        }
      }

      .card-actions {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }
    }
  }

  .code-editor-wrapper {
    :deep(textarea) {
      font-family: 'Courier New', monospace !important;
      font-size: 13px;
    }
  }

  .code-block {
    background: var(--bg-muted);
    border: 1px solid var(--border-light);
    padding: 15px;
    border-radius: 8px;
    max-height: 400px;
    overflow: auto;
    font-family: 'Courier New', monospace;
    font-size: 13px;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text-primary);
  }
}

[data-theme="dark"] .code-repo-page .filters {
  background: rgba(26, 37, 47, 0.72);
  border-color: rgba(255, 255, 255, 0.1);
}
</style>
