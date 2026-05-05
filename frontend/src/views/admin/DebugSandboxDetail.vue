<template>
  <div class="debug-sandbox-detail">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h2 class="page-title">
          <el-icon class="page-title-icon"><Monitor /></el-icon>
          沙箱详情
        </h2>
      </div>
      <div class="header-actions">
        <p class="page-subtitle">查看快照详细数据和管道状态</p>
        <el-button type="danger" plain @click="deleteSnapshot">
          删除快照
        </el-button>
      </div>
    </div>

    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="10" animated />
    </div>

    <template v-else-if="snapshot">
      <!-- 流水线标签页 -->
      <el-tabs v-model="activeTab" class="pipeline-tabs">
        <!-- 第1步：原始对话 -->
        <el-tab-pane label="① 原始对话" name="a">
          <el-card shadow="hover">
            <template #header>
              <div class="card-header">
                <span class="card-title">💬 用户与AI的对话记录</span>
                <el-tag v-if="parsedMessages.length === 0" type="warning" size="small">
                  无对话数据
                </el-tag>
                <el-tag v-else type="success" size="small">
                  {{ parsedMessages.length }} 条消息
                </el-tag>
              </div>
            </template>

            <div v-if="parsedMessages.length === 0" class="empty-state">
              <el-empty description="此快照没有原始对话数据">
                <template #description>
                  <p>请重新创建快照，从对话导入或手动输入数据</p>
                </template>
              </el-empty>
            </div>

            <div v-else class="message-list">
              <div
                v-for="(msg, index) in parsedMessages"
                :key="index"
                class="message-item"
                :class="msg.role"
              >
                <div class="message-role">
                  <el-tag :type="msg.role === 'user' ? 'primary' : 'success'" size="small">
                    {{ msg.role === 'user' ? '用户' : 'AI' }}
                  </el-tag>
                </div>
                <div class="message-content">{{ msg.content }}</div>
              </div>
            </div>
          </el-card>
        </el-tab-pane>

        <!-- 第2步：方案轮廓 -->
        <el-tab-pane label="② 方案轮廓" name="proposal-outline">
          <el-card shadow="hover">
            <template #header>
              <div class="card-header">
                <span class="card-title">📝 学习方向与阶段规划</span>
                <div class="header-actions">
                  <el-tag v-if="proposalOutlineVersions.length > 0" type="info" size="small">
                    {{ proposalOutlineVersions.length }} 个版本
                  </el-tag>
                  <el-button type="primary" @click="regenerateProposalOutline" :loading="regeneratingOutline">
                    重新分析生成
                  </el-button>
                </div>
              </div>
            </template>

            <div v-if="!proposalOutline && proposalOutlineVersions.length === 0" class="empty-state">
              <el-empty description="暂无方案轮廓数据">
                <el-button type="primary" @click="regenerateProposalOutline" :loading="regeneratingOutline">
                  从对话生成
                </el-button>
              </el-empty>
            </div>

            <!-- 版本选择器 -->
            <div v-if="proposalOutlineVersions.length > 1" class="version-selector">
              <span class="label">选择版本：</span>
              <el-radio-group v-model="selectedOutlineVersion" size="small">
                <el-radio-button 
                  v-for="(version, index) in proposalOutlineVersions" 
                  :key="index" 
                  :value="index"
                >
                  {{ index === 0 ? '原始版本' : `重新生成 v${index}` }}
                </el-radio-button>
              </el-radio-group>
            </div>

            <div v-if="currentProposalOutline" class="proposal-outline">
              <!-- 版本信息 -->
              <div v-if="proposalOutlineVersions.length > 1" class="version-info">
                <el-tag :type="selectedOutlineVersion === 0 ? 'success' : 'primary'" size="small">
                  {{ selectedOutlineVersion === 0 ? '原始版本（从对话提取）' : `重新生成版本 v${selectedOutlineVersion}` }}
                </el-tag>
                <span v-if="selectedOutlineVersion > 0" class="generation-time">
                  生成时间：{{ formatTime(proposalOutlineVersions[selectedOutlineVersion].generatedAt) }}
                </span>
              </div>

              <!-- 方案方向 -->
              <div v-if="currentProposalOutline.方向" class="outline-section">
                <h4>📌 学习方向</h4>
                <p>{{ currentProposalOutline.方向 }}</p>
              </div>

              <!-- 学习阶段 -->
              <div v-if="currentProposalOutline.阶段 || currentProposalOutline['分阶段']" class="outline-section">
                <h4>📚 学习阶段</h4>
                <div class="stages-list">
                  <div
                    v-for="(stage, index) in (currentProposalOutline.阶段 || currentProposalOutline['分阶段'] || [])"
                    :key="index"
                    class="stage-item"
                  >
                    <div class="stage-header">
                      <span class="stage-badge">第 {{ index + 1 }} 阶段</span>
                    </div>
                    <div class="stage-content">{{ stage }}</div>
                  </div>
                </div>
              </div>

              <!-- 学习方式 -->
              <div v-if="currentProposalOutline.方式 || currentProposalOutline['学习方式']" class="outline-section">
                <h4>💡 学习方式</h4>
                <p>{{ currentProposalOutline.方式 || currentProposalOutline['学习方式'] }}</p>
              </div>

              <!-- 原始数据 -->
              <el-collapse class="raw-data-collapse">
                <el-collapse-item title="查看原始数据" name="raw">
                  <pre class="raw-data">{{ JSON.stringify(currentProposalOutline, null, 2) }}</pre>
                </el-collapse-item>
              </el-collapse>
            </div>
          </el-card>
        </el-tab-pane>

        <!-- 第3步：需求收集 -->
        <el-tab-pane label="③ 需求收集" name="a1">
          <el-card shadow="hover">
            <template #header>
              <div class="card-header">
                <span class="card-title">📊 需求收集版本</span>
                <el-button type="primary" @click="showRegenerateRequirementDialog">
                  重新收集
                </el-button>
              </div>
            </template>

            <div v-if="!snapshot.requirementVersions || snapshot.requirementVersions.length === 0" class="empty-state">
              <el-empty description="暂无需求收集结果">
                <el-button type="primary" @click="showRegenerateRequirementDialog">
                  运行需求收集
                </el-button>
              </el-empty>
            </div>

            <div v-else class="version-list">
              <div
                v-for="req in snapshot.requirementVersions"
                :key="req.id"
                class="version-item"
                :class="{ active: req.isActive }"
              >
                <div class="version-header">
                  <div class="version-info">
                    <span class="version-badge">v{{ req.version }}</span>
                    <el-tag v-if="req.isActive" type="success" size="small">当前激活</el-tag>
                    <span class="version-time">{{ formatTime(req.createdAt) }}</span>
                  </div>
                  <div class="version-actions">
                    <el-button v-if="!req.isActive" size="small" @click="activateRequirement(req.id)">
                      设为当前
                    </el-button>
                    <el-button type="primary" size="small" @click="showRequirementDetail(req)">
                      查看详情
                    </el-button>
                    <el-button type="success" size="small" @click="generateProposalFromRequirement(req.id)">
                      生成方案
                    </el-button>
                  </div>
                </div>
                <div class="version-summary">
                  <div class="summary-item">
                    <span class="label">真问题：</span>
                    <span class="value">{{ req.realProblem || '-' }}</span>
                  </div>
                  <div class="summary-item">
                    <span class="label">水平：</span>
                    <span class="value">{{ req.level || '-' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </el-card>
        </el-tab-pane>

        <!-- 第4步：方案生成 -->
        <el-tab-pane label="④ 方案生成" name="b1">
          <el-card shadow="hover">
            <template #header>
              <div class="card-header">
                <span class="card-title">📋 方案版本</span>
                <el-button type="primary" @click="showRegenerateProposalDialog" :disabled="!activeRequirement">
                  重新生成
                </el-button>
              </div>
            </template>

            <div v-if="!snapshot.proposals || snapshot.proposals.length === 0" class="empty-state">
              <el-empty description="暂无方案，请先完成需求收集">
                <el-button type="primary" :disabled="!activeRequirement" @click="showRegenerateProposalDialog">
                  生成第一个方案
                </el-button>
              </el-empty>
            </div>

            <div v-else class="version-list">
              <div
                v-for="proposal in snapshot.proposals"
                :key="proposal.id"
                class="version-item"
                :class="{ active: proposal.isActive }"
              >
                <div class="version-header">
                  <div class="version-info">
                    <span class="version-badge">v{{ proposal.version }}</span>
                    <el-tag v-if="proposal.isActive" type="success" size="small">当前激活</el-tag>
                    <span class="version-time">{{ formatTime(proposal.createdAt) }}</span>
                  </div>
                  <div class="version-actions">
                    <el-button v-if="!proposal.isActive" size="small" @click="activateProposal(proposal.id)">
                      设为当前
                    </el-button>
                    <el-button type="primary" size="small" @click="showProposalDetail(proposal)">
                      预览
                    </el-button>
                    <el-button type="success" size="small" @click="showRegeneratePathDialog(proposal.id)">
                      生成路径
                    </el-button>
                  </div>
                </div>
                <div class="version-summary">
                  <div class="summary-item">
                    <span class="label">周数：</span>
                    <span class="value">{{ getProposalWeeks(proposal) }} 周</span>
                  </div>
                  <div class="summary-item">
                    <span class="label">路径：</span>
                    <span class="value">{{ proposal.learningPaths?.length || 0 }} 个版本</span>
                  </div>
                </div>

                <!-- 路径版本列表 -->
                <div v-if="proposal.learningPaths && proposal.learningPaths.length > 0" class="path-versions">
                  <div class="path-list">
                    <div
                      v-for="path in proposal.learningPaths"
                      :key="path.id"
                      class="path-item"
                      :class="{ active: path.isActive }"
                    >
                      <span class="path-version">v{{ path.version }}</span>
                      <span class="path-info">{{ path.totalWeeks }} 周 · {{ path.totalTasks }} 任务</span>
                      <el-tag v-if="path.isActive" type="success" size="small">当前</el-tag>
                      <el-button v-else size="small" text @click="activatePath(path.id)">设为当前</el-button>
                      <el-button size="small" text @click="showPathDetail(path)">预览</el-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </el-card>
        </el-tab-pane>
      </el-tabs>
    </template>

    <!-- 重新收集需求对话框 -->
    <el-dialog v-model="regenerateRequirementDialogVisible" title="重新收集需求" width="500px">
      <el-form :model="requirementParams" label-width="100px">
        <el-form-item label="Prompt模板">
          <el-select v-model="requirementParams.promptTemplate" placeholder="选择模板">
            <el-option label="默认模板" value="default" />
            <el-option label="详细模板" value="detailed" />
            <el-option label="简洁模板" value="concise" />
          </el-select>
        </el-form-item>
        <el-form-item label="温度参数">
          <el-slider v-model="requirementParams.temperature" :min="0" :max="1" :step="0.1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="regenerateRequirementDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="regenerating" @click="regenerateRequirement">
          开始收集
        </el-button>
      </template>
    </el-dialog>

    <!-- 重新生成方案对话框 -->
    <el-dialog v-model="regenerateProposalDialogVisible" title="重新生成方案" width="500px">
      <el-form :model="proposalParams" label-width="100px">
        <el-form-item label="学习周期">
          <el-radio-group v-model="proposalParams.weeks">
            <el-radio-button :value="4">4周</el-radio-button>
            <el-radio-button :value="6">6周</el-radio-button>
            <el-radio-button :value="8">8周</el-radio-button>
            <el-radio-button :value="12">12周</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="难度等级">
          <el-radio-group v-model="proposalParams.difficulty">
            <el-radio-button value="easy">轻松</el-radio-button>
            <el-radio-button value="standard">标准</el-radio-button>
            <el-radio-button value="challenging">挑战</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="重点方向">
          <el-input v-model="proposalParams.focus" placeholder="如：重点学pandas，不学可视化" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="regenerateProposalDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="regeneratingProposal" @click="regenerateProposal">
          生成方案
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情查看对话框 -->
    <el-dialog v-model="detailDialogVisible" :title="detailTitle" width="700px">
      <pre class="detail-content">{{ detailContent }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { ArrowLeft, Delete, Refresh, Monitor } from '@element-plus/icons-vue';
import { adminDebugSandboxApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const router = useRouter();
const route = useRoute();
const snapshotId = computed(() => route.params.id as string);

// 状态
const loading = ref(false);
const snapshot = ref<any>(null);
const parsedMessages = ref<any[]>([]);
const activeTab = ref('a');
const activeRequirement = computed(() => snapshot.value?.requirementVersions?.find((r: any) => r.isActive));

// 对话框状态
const regenerateRequirementDialogVisible = ref(false);
const regenerateProposalDialogVisible = ref(false);
const detailDialogVisible = ref(false);
const detailTitle = ref('');
const detailContent = ref('');

// 操作状态
const regenerating = ref(false);
const regeneratingProposal = ref(false);
const regeneratingOutline = ref(false);
const currentProposalId = ref('');

// 参数
const requirementParams = reactive({
  promptTemplate: 'default',
  temperature: 0.7
});

const proposalParams = reactive({
  weeks: 8,
  difficulty: 'standard',
  focus: ''
});

// 方案轮廓版本管理
const proposalOutlineVersions = ref<any[]>([]);
const selectedOutlineVersion = ref(0);

// 当前显示的方案轮廓
const currentProposalOutline = computed(() => {
  if (proposalOutlineVersions.value.length === 0) {
    // 如果没有版本，尝试从原始对话提取
    return proposalOutline.value;
  }
  return proposalOutlineVersions.value[selectedOutlineVersion.value]?.data || null;
});

// 从原始对话提取方案轮廓
const proposalOutline = computed(() => {
  // 从对话消息中提取 AI 生成的方案轮廓
  if (!parsedMessages.value || parsedMessages.value.length === 0) return null;
  
  // 查找包含"方案轮廓"或类似关键词的 AI 消息
  const outlineMessage = parsedMessages.value.find((msg: any) => 
    msg.role === 'assistant' && 
    (msg.content.includes('方案轮廓') || msg.content.includes('📌') || msg.content.includes('分阶段'))
  );
  
  if (!outlineMessage) return null;
  
  // 解析方案轮廓内容
  const content = outlineMessage.content;
  const outline: any = {};
  
  // 提取学习方向
  const directionMatch = content.match(/📌\s*学习方向[：:]\s*(.+?)(?=\n|$)/);
  if (directionMatch) outline.方向 = directionMatch[1].trim();
  
  // 提取学习方式
  const methodMatch = content.match(/📌\s*学习方式[：:]\s*(.+?)(?=\n|$)/);
  if (methodMatch) outline.方式 = methodMatch[1].trim();
  
  // 提取学习阶段
  const stages: string[] = [];
  const stageRegex = /[•·]\s*第[一二三四五六七八九十\d]+阶段[（(]?[^)）]*[)）]?[：:]?\s*(.+?)(?=\n[•·]|\n\n|$)/g;
  let match;
  while ((match = stageRegex.exec(content)) !== null) {
    stages.push(match[1].trim());
  }
  if (stages.length > 0) outline.阶段 = stages;
  
  // 如果没有匹配到，返回原始内容
  if (Object.keys(outline).length === 0) {
    outline.原始内容 = content;
  }
  
  return outline;
});

// 初始化原始版本
watch(proposalOutline, (newOutline) => {
  if (newOutline && proposalOutlineVersions.value.length === 0) {
    proposalOutlineVersions.value.push({
      type: 'original',
      data: newOutline,
      generatedAt: new Date().toISOString()
    });
  }
}, { immediate: true });

// 加载快照详情
const loadSnapshot = async () => {
  loading.value = true;
  try {
    const response: any = await adminDebugSandboxApi.getSnapshot(snapshotId.value);
    if (response.data.success) {
      snapshot.value = response.data.data;
      parsedMessages.value = response.data.data.parsedMessages || [];
    }
  } catch (error: any) {
    toast.error('加载快照详情失败');
    console.error(error);
  } finally {
    loading.value = false;
  }
};

// 重新生成方案轮廓（调用后端 API）
const regenerateProposalOutline = async () => {
  if (parsedMessages.value.length === 0) {
    toast.warning('没有原始对话数据');
    return;
  }
  
  regeneratingOutline.value = true;
  try {
    // 调用后端 API 重新生成方案轮廓
    const response: any = await adminDebugSandboxApi.regenerateOutline(snapshotId.value, {
      temperature: 0.7
    });
    
    if (response.data.success) {
      const newOutline = response.data.data.outline;
      
      // 保存新版本
      proposalOutlineVersions.value.push({
        type: 'regenerated',
        data: newOutline,
        generatedAt: new Date().toISOString()
      });
      
      // 切换到新版本
      selectedOutlineVersion.value = proposalOutlineVersions.value.length - 1;
      
      toast.success(`方案轮廓已重新生成（版本 v${proposalOutlineVersions.value.length - 1}）`);
    }
  } catch (error: any) {
    toast.error('生成失败：' + (error.response?.data?.error || error.message));
  } finally {
    regeneratingOutline.value = false;
  }
};

// 重新收集需求
const regenerateRequirement = async () => {
  regenerating.value = true;
  try {
    const response: any = await adminDebugSandboxApi.regenerateRequirement(snapshotId.value, requirementParams);
    if (response.data.success) {
      toast.success('需求收集完成');
      regenerateRequirementDialogVisible.value = false;
      loadSnapshot();
    }
  } catch (error: any) {
    toast.error('需求收集失败');
  } finally {
    regenerating.value = false;
  }
};

// 激活需求版本
const activateRequirement = async (id: string) => {
  try {
    const response: any = await adminDebugSandboxApi.activateRequirement(id);
    if (response.data.success) {
      toast.success('已设为当前版本');
      loadSnapshot();
    }
  } catch (error: any) {
    toast.error('设置失败');
  }
};

// 显示重新收集需求对话框
const showRegenerateRequirementDialog = () => {
  regenerateRequirementDialogVisible.value = true;
};

// 显示需求详情
const showRequirementDetail = (req: any) => {
  detailTitle.value = `需求收集 v${req.version}`;
  try {
    detailContent.value = JSON.stringify(JSON.parse(req.content), null, 2);
  } catch {
    detailContent.value = req.content;
  }
  detailDialogVisible.value = true;
};

// 从需求生成方案
const generateProposalFromRequirement = (requirementId: string) => {
  currentProposalId.value = '';
  showRegenerateProposalDialog();
};

// 显示重新生成方案对话框
const showRegenerateProposalDialog = () => {
  regenerateProposalDialogVisible.value = true;
};

// 重新生成方案
const regenerateProposal = async () => {
  const reqId = activeRequirement.value?.id;
  if (!reqId) {
    toast.warning('请先激活一个需求版本');
    return;
  }

  regeneratingProposal.value = true;
  try {
    const response: any = await adminDebugSandboxApi.regenerateProposal(reqId, proposalParams);
    if (response.data.success) {
      toast.success('方案生成完成');
      regenerateProposalDialogVisible.value = false;
      loadSnapshot();
    }
  } catch (error: any) {
    toast.error('方案生成失败');
  } finally {
    regeneratingProposal.value = false;
  }
};

// 激活方案
const activateProposal = async (id: string) => {
  try {
    const response: any = await adminDebugSandboxApi.activateProposal(id);
    if (response.data.success) {
      toast.success('已设为当前版本');
      loadSnapshot();
    }
  } catch (error: any) {
    toast.error('设置失败');
  }
};

// 显示方案详情
const showProposalDetail = (proposal: any) => {
  detailTitle.value = `方案 v${proposal.version}`;
  try {
    detailContent.value = JSON.stringify(JSON.parse(proposal.content), null, 2);
  } catch {
    detailContent.value = proposal.content;
  }
  detailDialogVisible.value = true;
};

// 显示生成路径对话框
const showRegeneratePathDialog = (proposalId: string) => {
  currentProposalId.value = proposalId;
  toast.info('路径生成功能开发中');
};

// 激活路径
const activatePath = async (id: string) => {
  try {
    const response: any = await adminDebugSandboxApi.activatePath(id);
    if (response.data.success) {
      toast.success('已设为当前版本');
      loadSnapshot();
    }
  } catch (error: any) {
    toast.error('设置失败');
  }
};

// 显示路径详情
const showPathDetail = (path: any) => {
  detailTitle.value = `路径 v${path.version}`;
  try {
    detailContent.value = JSON.stringify(JSON.parse(path.content), null, 2);
  } catch {
    detailContent.value = path.content;
  }
  detailDialogVisible.value = true;
};

// 删除快照
const deleteSnapshot = async () => {
  try {
    await ElMessageBox.confirm('确定删除此快照吗？所有相关数据也将被删除', '确认删除', { type: 'warning' });
    const response: any = await adminDebugSandboxApi.deleteSnapshot(snapshotId.value);
    if (response.data.success) {
      toast.success('快照已删除');
      router.push('/admin/debug-sandbox');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error('删除失败');
    }
  }
};

// 返回
const goBack = () => {
  router.push('/admin/debug-sandbox');
};

// 获取方案周数
const getProposalWeeks = (proposal: any) => {
  try {
    const content = JSON.parse(proposal.content);
    return content.weeks || 0;
  } catch {
    return 0;
  }
};

// 格式化时间
const formatTime = (time: string) => {
  if (!time) return '-';
  return new Date(time).toLocaleString('zh-CN');
};

onMounted(() => {
  loadSnapshot();
});
</script>

<style scoped>
.debug-sandbox-detail {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 0.75rem;
}

/* 标签页 */
.pipeline-tabs {
  margin-bottom: 1rem;
}

/* 卡片 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* 消息列表 */
.message-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 500px;
  overflow-y: auto;
}

.message-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 8px;
}

.message-item.user {
  background: rgba(74, 111, 165, 0.12);
}

.message-item.assistant {
  background: rgba(46, 204, 113, 0.12);
}

.message-role {
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  white-space: pre-wrap;
  color: var(--text-primary);
  line-height: 1.5;
}

/* 版本列表 */
.version-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.version-item {
  border: 1px solid var(--glass-border-light);
  border-radius: var(--fluent-radius-md);
  padding: 1rem;
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
  background: var(--glass-bg-light);
}

.version-item.active {
  border-color: var(--color-success);
  background: rgba(46, 204, 113, 0.12);
}

.version-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.version-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.version-badge {
  background: var(--color-primary);
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
}

.version-time {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.version-actions {
  display: flex;
  gap: 0.5rem;
}

.version-summary {
  display: flex;
  gap: 2rem;
  padding: 0.5rem 0;
  border-top: 1px dashed var(--border-default);
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.summary-item .label {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.summary-item .value {
  color: var(--text-primary);
  font-weight: 500;
}

/* 路径版本 */
.path-versions {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--border-default);
}

.path-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.path-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.75rem;
  background: var(--glass-bg-light);
  border-radius: var(--fluent-radius-sm);
}

.path-item.active {
  background: color-mix(in srgb, var(--color-success) 16%, var(--bg-elevated) 84%);
}

.path-version {
  background: var(--text-secondary);
  color: var(--bg-elevated);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.path-info {
  color: var(--text-secondary);
  font-size: 0.85rem;
  flex: 1;
}

/* 空状态 */
.empty-state {
  padding: 2rem 0;
  text-align: center;
}

/* 详情对话框 */
.detail-content {
  background: var(--bg-elevated);
  padding: 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.5;
  overflow: auto;
  max-height: 400px;
  border: 1px solid var(--border-light);
}

.loading-container {
  padding: 3rem 0;
}
</style>
