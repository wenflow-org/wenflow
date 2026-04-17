<template>
  <div class="agent-model-config">
    <h2>Agent 模型配置</h2>
    
    <div class="action-bar">
      <el-button type="primary" @click="initializeDefaults">初始化默认配置</el-button>
      <el-button @click="refresh">刷新</el-button>
    </div>
    
    <el-table :data="configs" v-loading="loading">
      <el-table-column prop="agentId" label="Agent ID" width="200" />
      <el-table-column prop="tier" label="模型层级" width="100">
        <template #default="{ row }">
          <el-tag>{{ row.tier }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="model" label="模型" width="150">
        <template #default="{ row }">
          {{ row.model || '使用平台默认' }}
        </template>
      </el-table-column>
      <el-table-column prop="temperature" label="温度" width="80" />
      <el-table-column prop="maxTokens" label="Max Tokens" width="100" />
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" @change="updateConfig(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button size="small" @click="editConfig(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="deleteConfig(row)">重置</el-button>
        </template>
      </el-table-column>
    </el-table>
    
    <el-dialog v-model="editDialogVisible" title="编辑配置">
      <el-form :model="editForm">
        <el-form-item label="Agent ID">
          <el-input v-model="editForm.agentId" disabled />
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="editForm.temperature" :min="0" :max="1" :step="0.1" show-input />
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="editForm.maxTokens" :min="100" :max="8000" />
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="editForm.model" placeholder="留空使用平台默认" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { adminAxios } from '@/api/adminApi';

interface AgentModelConfig {
  agentId: string;
  tier: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
}

const configs = ref<AgentModelConfig[]>([]);
const loading = ref(false);
const editDialogVisible = ref(false);
const editForm = ref<AgentModelConfig>({
  agentId: '',
  tier: '',
  enabled: true
});

const fetchConfigs = async () => {
  loading.value = true;
  try {
    const res = await adminAxios.get('/admin/agent-model-configs');
    configs.value = res.data?.data || [];
  } catch (error) {
    ElMessage.error('获取配置失败');
  }
  loading.value = false;
};

const initializeDefaults = async () => {
  try {
    await adminAxios.post('/admin/agent-model-configs/initialize');
    ElMessage.success('默认配置已初始化');
    fetchConfigs();
  } catch (error) {
    ElMessage.error('初始化失败');
  }
};

const updateConfig = async (row: AgentModelConfig) => {
  try {
    await adminAxios.put(`/admin/agent-model-configs/${row.agentId}`, row);
    ElMessage.success('状态已更新');
  } catch (error) {
    ElMessage.error('更新失败');
    fetchConfigs();
  }
};

const editConfig = (row: AgentModelConfig) => {
  editForm.value = { ...row };
  editDialogVisible.value = true;
};

const saveConfig = async () => {
  try {
    await adminAxios.put(`/admin/agent-model-configs/${editForm.value.agentId}`, editForm.value);
    ElMessage.success('配置已更新');
    editDialogVisible.value = false;
    fetchConfigs();
  } catch (error) {
    ElMessage.error('保存失败');
  }
};

const deleteConfig = async (row: AgentModelConfig) => {
  try {
    await adminAxios.delete(`/admin/agent-model-configs/${row.agentId}`);
    ElMessage.success('配置已重置');
    fetchConfigs();
  } catch (error) {
    ElMessage.error('删除失败');
  }
};

const refresh = () => fetchConfigs();

onMounted(() => fetchConfigs());
</script>

<style scoped>
.agent-model-config {
  padding: 20px;
}
.action-bar {
  margin-bottom: 20px;
}
</style>