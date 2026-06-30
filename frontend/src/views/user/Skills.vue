<template>
  <CapabilityShell title="Skills 管理" description="安装、启用和测试可组合的底层能力模块，决定 Agent 在执行时能调用哪些工具。">
    <template #actions>
      <el-button type="primary" @click="showCreateDialog">
        <el-icon><Plus /></el-icon>
        添加 Skill
      </el-button>
    </template>
    <div class="user-skills-page">

    <div class="stats">
      <el-row :gutter="20">
        <el-col :span="8">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">已安装 Skills</div>
              <div class="value">{{ skills.length }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">启用中</div>
              <div class="value">{{ enabledCount }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">自定义来源</div>
              <div class="value">{{ customCount }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <div class="toolbar">
      <el-form :inline="true">
        <el-form-item label="状态">
          <el-select v-model="filterEnabled" placeholder="全部" clearable @change="loadSkills">
            <el-option label="启用中" :value="true" />
            <el-option label="已禁用" :value="false" />
          </el-select>
        </el-form-item>
      </el-form>
    </div>

    <div class="skills-list">
      <el-empty v-if="!loading && skills.length === 0" description="还没有安装任何 Skill">
        <el-button type="primary" @click="showCreateDialog">添加第一个 Skill</el-button>
      </el-empty>

      <template v-else>
        <div class="skill-card-grid">
          <el-card v-for="skill in featuredSkills" :key="skill.skillName" shadow="hover" class="skill-card">
            <div class="skill-card__header">
              <div>
                <div class="skill-card__title-row">
                  <h3>{{ skill.skillName }}</h3>
                  <el-tag :type="skill.sourceType === 'CUSTOM' ? 'success' : 'info'" size="small">
                    {{ skill.sourceType === 'CUSTOM' ? '自定义' : '平台' }}
                  </el-tag>
                </div>
                <p>{{ skill.endpoint || '未配置远端 endpoint，可直接使用仓库或内联代码。' }}</p>
              </div>
              <el-switch v-model="skill.enabled" @change="toggleSkill(skill)" />
            </div>

            <div class="skill-card__meta">
              <div class="skill-card__meta-item">
                <span>来源类型</span>
                <strong>{{ skill.sourceType === 'CUSTOM' ? '用户安装能力' : '平台能力模块' }}</strong>
              </div>
              <div class="skill-card__meta-item">
                <span>最后更新</span>
                <strong>{{ formatDate(skill.updatedAt) }}</strong>
              </div>
            </div>

            <div class="skill-card__actions">
              <el-button link type="primary" @click="editSkill(skill)">编辑</el-button>
              <el-button link type="primary" @click="testSkill(skill)">测试</el-button>
              <el-button link type="danger" @click="removeSkill(skill)">删除</el-button>
            </div>
          </el-card>
        </div>

        <div class="skills-table-panel">
          <div class="skills-table-panel__header">
            <div>
              <h3>详细配置</h3>
              <p>保留表格视图，方便查看 endpoint、更新时间和批量操作。</p>
            </div>
          </div>

      <el-table :data="skills" v-loading="loading" style="width: 100%" row-key="id">
        <el-table-column prop="skillName" label="Skill 名称" min-width="220" />
        <el-table-column prop="sourceType" label="来源" width="140">
          <template #default="{ row }">
            <el-tag :type="row.sourceType === 'CUSTOM' ? 'success' : 'info'" size="small">
              {{ row.sourceType === 'CUSTOM' ? '自定义' : '平台' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="enabled" label="状态" width="110">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" @change="toggleSkill(row)" />
          </template>
        </el-table-column>
        <el-table-column prop="endpoint" label="Endpoint" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.endpoint || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editSkill(row)">编辑</el-button>
            <el-button link type="primary" @click="testSkill(row)">测试</el-button>
            <el-button link type="danger" @click="removeSkill(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
        </div>
      </template>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑 Skill' : '新增 Skill'" width="840px" @close="resetForm">
      <el-form :model="formData" label-width="120px">
        <el-form-item label="Skill 名称" required>
          <el-input v-model="formData.skillName" :disabled="isEdit" placeholder="retrieval-helper" />
        </el-form-item>
        <el-form-item label="来源类型" required>
          <el-select v-model="formData.sourceType">
            <el-option label="平台 Skill" value="PLATFORM" />
            <el-option label="自定义 Skill" value="CUSTOM" />
          </el-select>
        </el-form-item>
        <el-form-item label="远端 Endpoint">
          <el-input v-model="formData.endpoint" placeholder="https://example.com/skill" />
        </el-form-item>
        <el-form-item label="参数配置">
          <el-input
            v-model="formData.parameters"
            type="textarea"
            :rows="6"
            placeholder='{"timeout": 3000}'
            style="font-family: 'Courier New', monospace;"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="testVisible" title="测试 Skill" width="800px">
      <el-form label-width="100px">
        <el-form-item label="测试输入">
          <el-input
            v-model="testInput"
            type="textarea"
            :rows="5"
            placeholder='{"query": "学习路径"}'
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
        <el-button type="primary" :loading="testing" @click="runTest">运行测试</el-button>
      </template>
    </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { toast } from '../../utils/toast';
import dayjs from 'dayjs';
import {
  deleteUserSkill,
  getUserSkill,
  getUserSkills,
  saveUserSkill,
  testUserSkill,
  toggleUserSkill,
  updateUserSkill
} from '@/api/userCustom';

const loading = ref(false);
const submitting = ref(false);
const testing = ref(false);
const dialogVisible = ref(false);
const testVisible = ref(false);
const isEdit = ref(false);
const skills = ref<any[]>([]);
const currentSkill = ref<any>(null);
const filterEnabled = ref<boolean | undefined>(undefined);
const testInput = ref('');
const testResult = ref('');

const formData = reactive({
  skillName: '',
  sourceType: 'CUSTOM' as 'PLATFORM' | 'CUSTOM',
  endpoint: '',
  parameters: ''
});

const enabledCount = computed(() => skills.value.filter((item) => item.enabled).length);
const customCount = computed(() => skills.value.filter((item) => item.sourceType === 'CUSTOM').length);
const featuredSkills = computed(() => {
  const enabled = skills.value.filter((item) => item.enabled);
  const disabled = skills.value.filter((item) => !item.enabled);
  return [...enabled, ...disabled].slice(0, 6);
});

onMounted(async () => {
  await loadSkills();
});

async function loadSkills() {
  loading.value = true;
  try {
    const params: { enabled?: boolean } = {};
    if (filterEnabled.value !== undefined) {
      params.enabled = filterEnabled.value;
    }
    const res = await getUserSkills(params);
    skills.value = res.data || [];
  } catch (error) {
    toast.error('加载 Skills 失败');
  } finally {
    loading.value = false;
  }
}

function showCreateDialog() {
  isEdit.value = false;
  dialogVisible.value = true;
}

async function editSkill(skill: any) {
  try {
    const res = await getUserSkill(skill.skillName);
    const detail = res.data;

    isEdit.value = true;
    currentSkill.value = detail;
    formData.skillName = detail.skillName;
    formData.sourceType = detail.sourceType || 'CUSTOM';
    formData.endpoint = detail.endpoint || '';
    formData.parameters = detail.parameters ? JSON.stringify(detail.parameters, null, 2) : '';
    dialogVisible.value = true;
  } catch {
    toast.error('加载 Skill 详情失败');
  }
}

async function submitForm() {
  if (!formData.skillName) {
    toast.warning('请填写 Skill 名称');
    return;
  }

  const payload = {
    skillName: formData.skillName,
    sourceType: formData.sourceType,
    endpoint: formData.endpoint || undefined,
    parameters: formData.parameters ? JSON.parse(formData.parameters) : undefined
  };

  submitting.value = true;
  try {
    if (isEdit.value && currentSkill.value) {
      await updateUserSkill(formData.skillName, payload);
    } else {
      await saveUserSkill(payload);
    }
    toast.success('保存成功');
    dialogVisible.value = false;
    resetForm();
    await loadSkills();
  } catch (error: any) {
    toast.error(error.message || '保存失败');
  } finally {
    submitting.value = false;
  }
}

async function toggleSkill(skill: any) {
  try {
    await toggleUserSkill(skill.skillName, skill.enabled);
    toast.success(skill.enabled ? '已启用' : '已禁用');
  } catch {
    skill.enabled = !skill.enabled;
    toast.error('操作失败');
  }
}

function testSkill(skill: any) {
  currentSkill.value = skill;
  testInput.value = '';
  testResult.value = '';
  testVisible.value = true;
}

async function runTest() {
  if (!currentSkill.value) return;

  testing.value = true;
  try {
    let input: any;
    try {
      input = JSON.parse(testInput.value || '{}');
    } catch {
      input = { text: testInput.value };
    }

    const res = await testUserSkill(currentSkill.value.skillName, input);
    testResult.value = JSON.stringify(res.data, null, 2);
  } catch (error: any) {
    testResult.value = `执行失败：${error.message}`;
  } finally {
    testing.value = false;
  }
}

async function removeSkill(skill: any) {
  try {
    await ElMessageBox.confirm(`确定删除 Skill "${skill.skillName}" 吗？`, '确认删除', { type: 'warning' });
    await deleteUserSkill(skill.skillName);
    toast.success('删除成功');
    await loadSkills();
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error('删除失败');
    }
  }
}

function resetForm() {
  formData.skillName = '';
  formData.sourceType = 'CUSTOM';
  formData.endpoint = '';
  formData.parameters = '';
  currentSkill.value = null;
}

function formatDate(date: string) {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
}
</script>

<style scoped lang="scss">
.user-skills-page {
  .stats,
  .toolbar {
    margin-bottom: 20px;
  }

  .toolbar,
  .skills-list {
    padding: 18px 20px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(20px);
    box-shadow: var(--shadow-md);
  }

  .skill-card-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }

  .skill-card {
    border-radius: 22px;

    &__header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;

      p {
        margin: 8px 0 0;
        color: var(--el-text-color-secondary);
        line-height: 1.6;
        word-break: break-word;
      }
    }

    &__title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;

      h3 {
        margin: 0;
        font-size: 18px;
        color: var(--el-text-color-primary);
        word-break: break-word;
      }
    }

    &__meta {
      display: grid;
      gap: 12px;
      margin-bottom: 14px;
    }

    &__meta-item {
      display: grid;
      gap: 6px;
      padding: 12px 14px;
      border-radius: 16px;
      background: var(--bg-muted);

      span {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }

      strong {
        color: var(--el-text-color-primary);
        line-height: 1.6;
        word-break: break-word;
      }
    }

    &__actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }

  .skills-table-panel {
    min-width: 0;

    &__header {
      margin-bottom: 16px;

      h3 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      p {
        margin: 0;
        color: var(--el-text-color-secondary);
        line-height: 1.6;
      }
    }

    :deep(.el-table) {
      width: 100%;
    }
  }

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

  :deep(.stats .el-card) {
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(20px);
    border-radius: 20px;
    box-shadow: var(--shadow-md);
  }

  @media (max-width: 1024px) {
    .skill-card-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .toolbar,
    .skills-list {
      padding: 16px;
    }
  }
}

[data-theme="dark"] .user-skills-page .toolbar,
[data-theme="dark"] .user-skills-page .skills-list {
  background: rgba(26, 37, 47, 0.72);
  border-color: rgba(255, 255, 255, 0.1);
}
</style>
