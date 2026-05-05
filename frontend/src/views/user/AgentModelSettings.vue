<template>
  <div class="agent-model-settings">
    <h2>我的模型偏好</h2>
    
    <el-alert type="info" :closable="false" style="margin-bottom: 20px;">
      您可以自定义特定 Agent 的模型参数，覆盖系统默认配置。
    </el-alert>
    
    <el-table :data="configs" v-loading="loading">
      <el-table-column prop="agentId" label="Agent" width="200" />
      <el-table-column prop="model" label="我的模型" width="150">
        <template #default="{ row }">
          {{ row.model || '使用系统默认' }}
        </template>
      </el-table-column>
      <el-table-column prop="temperature" label="我的温度" width="100">
        <template #default="{ row }">
          {{ row.temperature ?? '系统默认' }}
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="启用覆盖" width="100">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" @change="toggleOverride(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button size="small" @click="editOverride(row)">设置</el-button>
          <el-button size="small" type="danger" @click="resetOverride(row)">重置</el-button>
        </template>
      </el-table-column>
    </el-table>
    
    <el-dialog v-model="editDialogVisible" title="自定义配置">
      <el-form :model="editForm">
        <el-form-item label="Agent">
          <el-input v-model="editForm.agentId" disabled />
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="editForm.temperature" :min="0" :max="1" :step="0.1" show-input />
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="editForm.maxTokens" :min="100" :max="8000" />
        </el-form-item>
        <el-form-item label="自定义模型">
          <el-input v-model="editForm.model" placeholder="留空使用系统配置" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveOverride">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '@/utils/api';
import { toast } from '../../utils/toast';

interface UserAgentConfig {
  agentId: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
}

const configs = ref<UserAgentConfig[]>([]);
const loading = ref(false);
const editDialogVisible = ref(false);
const editForm = ref<UserAgentConfig>({
  agentId: '',
  enabled: false
});

const fetchConfigs = async () => {
  loading.value = true;
  try {
    const res = await api.get('/user/agent-model-settings');
    configs.value = res.data?.data || [];
  } catch (error) {
    toast.error('获取配置失败');
  }
  loading.value = false;
};

const toggleOverride = async (row: UserAgentConfig) => {
  try {
    await api.put(`/user/agent-model-settings/${row.agentId}/toggle`, { enabled: row.enabled });
    toast.success(row.enabled ? '已启用覆盖' : '已禁用覆盖');
  } catch (error) {
    toast.error('操作失败');
    fetchConfigs();
  }
};

const editOverride = (row: UserAgentConfig) => {
  editForm.value = { ...row };
  editDialogVisible.value = true;
};

const saveOverride = async () => {
  try {
    await api.put(`/user/agent-model-settings/${editForm.value.agentId}`, editForm.value);
    toast.success('配置已保存');
    editDialogVisible.value = false;
    fetchConfigs();
  } catch (error) {
    toast.error('保存失败');
  }
};

const resetOverride = async (row: UserAgentConfig) => {
  try {
    await api.delete(`/user/agent-model-settings/${row.agentId}`);
    toast.success('已重置为系统默认');
    fetchConfigs();
  } catch (error) {
    toast.error('重置失败');
  }
};

onMounted(() => fetchConfigs());
</script>

<style scoped>
.agent-model-settings {
  padding: 20px;
}
</style>