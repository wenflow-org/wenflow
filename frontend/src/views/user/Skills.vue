<template>
  <CapabilityShell title="Skill 管理" description="查看平台已配置的能力模块，并控制是否启用。Skill 内容由平台统一维护。">
    <div class="user-skills-page">

    <div class="stats">
      <el-row :gutter="20">
        <el-col :span="8">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">可用 Skill</div>
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
              <div class="label">已禁用</div>
              <div class="value">{{ skills.length - enabledCount }}</div>
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
      <el-result v-if="!loading && loadError" icon="error" title="Skill 加载失败" :sub-title="loadError">
        <template #extra>
          <el-button type="primary" @click="loadSkills">重新加载</el-button>
        </template>
      </el-result>

      <el-empty v-else-if="!loading && skills.length === 0" description="当前没有可用的 Skill">
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
               <p>{{ skill.endpoint || '未配置调用地址，可直接使用当前配置。' }}</p>
              </div>
              <el-switch v-model="skill.enabled" :loading="togglingSkills.has(skill.skillName)" :disabled="togglingSkills.has(skill.skillName)" @change="toggleSkill(skill)" />
            </div>

            <div class="skill-card__meta">
              <div class="skill-card__meta-item">
               <span>来源</span>
               <strong>{{ skill.sourceType === 'CUSTOM' ? '自定义 Skill' : '平台 Skill' }}</strong>
              </div>
              <div class="skill-card__meta-item">
                <span>最后更新</span>
                <strong>{{ formatDate(skill.updatedAt) }}</strong>
              </div>
            </div>

            <div class="skill-card__actions">
              <el-button link type="primary" @click="viewSkill(skill)">查看详情</el-button>
            </div>
          </el-card>
        </div>

        <div class="skills-table-panel">
          <div class="skills-table-panel__header">
            <div>
              <h3>详细配置</h3>
         <p>查看调用地址、更新时间和操作状态。</p>
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
            <el-switch v-model="row.enabled" :loading="togglingSkills.has(row.skillName)" :disabled="togglingSkills.has(row.skillName)" @change="toggleSkill(row)" />
          </template>
        </el-table-column>
         <el-table-column prop="endpoint" label="调用地址（Endpoint）" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.endpoint || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewSkill(row)">查看详情</el-button>
          </template>
        </el-table-column>
      </el-table>
        </div>
      </template>
    </div>

    <el-dialog v-model="detailVisible" title="Skill 详情" width="min(720px, calc(100vw - 32px))">
      <el-descriptions v-if="currentSkill" :column="1" border>
        <el-descriptions-item label="名称">{{ currentSkill.skillName }}</el-descriptions-item>
        <el-descriptions-item label="来源">{{ currentSkill.sourceType === 'CUSTOM' ? '自定义 Skill' : '平台 Skill' }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ currentSkill.enabled ? '已启用' : '已禁用' }}</el-descriptions-item>
        <el-descriptions-item label="调用地址">{{ currentSkill.endpoint || '-' }}</el-descriptions-item>
        <el-descriptions-item label="参数配置">
          <pre class="skill-parameters">{{ formatParameters(currentSkill.parameters) }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatDate(currentSkill.updatedAt) }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { toast } from '../../utils/toast';
import dayjs from 'dayjs';
import { getUserSkill, getUserSkills, toggleUserSkill } from '@/api/userCustom';

interface UserSkillItem {
  skillName: string;
  sourceType?: string;
  endpoint?: string | null;
  enabled: boolean;
  updatedAt?: string;
  parameters?: unknown;
}

const loading = ref(false);
const detailVisible = ref(false);
const loadError = ref('');
const skills = ref<UserSkillItem[]>([]);
const currentSkill = ref<UserSkillItem | null>(null);
const filterEnabled = ref<boolean | undefined>(undefined);
const togglingSkills = ref(new Set<string>());

const enabledCount = computed(() => skills.value.filter((item) => item.enabled).length);
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
  loadError.value = '';
  try {
    const params: { enabled?: boolean } = {};
    // el-select clearable 清空时会置为 ''，仅布尔值才下发筛选
    if (typeof filterEnabled.value === 'boolean') {
      params.enabled = filterEnabled.value;
    }
    const res = await getUserSkills(params);
    skills.value = res.data || [];
  } catch (error) {
    skills.value = [];
    loadError.value = '无法读取 Skill 配置，请稍后重试。';
    toast.error('加载 Skill 失败');
  } finally {
    loading.value = false;
  }
}

async function viewSkill(skill: UserSkillItem) {
  try {
    const res = await getUserSkill(skill.skillName);
    currentSkill.value = res.data;
    detailVisible.value = true;
  } catch {
    toast.error('加载 Skill 详情失败');
  }
}

async function toggleSkill(skill: UserSkillItem) {
  if (togglingSkills.value.has(skill.skillName)) return;
  togglingSkills.value.add(skill.skillName);
  try {
    await toggleUserSkill(skill.skillName, skill.enabled);
    toast.success(skill.enabled ? '已启用' : '已禁用');
  } catch {
    skill.enabled = !skill.enabled;
    toast.error('操作失败');
  } finally {
    togglingSkills.value.delete(skill.skillName);
  }
}

function formatParameters(parameters: unknown) {
  if (!parameters) return '未配置';
  if (typeof parameters !== 'string') return JSON.stringify(parameters, null, 2);
  try {
    return JSON.stringify(JSON.parse(parameters), null, 2);
  } catch {
    return parameters;
  }
}

function formatDate(date?: string) {
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

  .skill-parameters {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'Courier New', monospace;
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
