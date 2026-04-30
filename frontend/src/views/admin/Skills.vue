<template>
  <div class="skills-management">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">
        <el-icon><Operation /></el-icon>
        Skills 管理
      </h2>
      <p class="page-desc">查看和管理平台所有 Skill 的运行状态与统计信息</p>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-content">
            <div class="stat-icon stat-icon--primary">
              <el-icon :size="24"><Operation /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalSkills }}</div>
              <div class="stat-label">Skill 总数</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-content">
            <div class="stat-icon stat-icon--success">
              <el-icon :size="24"><Promotion /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalCalls }}</div>
              <div class="stat-label">总调用次数</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-content">
            <div class="stat-icon stat-icon--warning">
              <el-icon :size="24"><CircleCheck /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.avgSuccessRate }}%</div>
              <div class="stat-label">平均成功率</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-content">
            <div class="stat-icon stat-icon--danger">
              <el-icon :size="24"><Timer /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.avgLatency }}ms</div>
              <div class="stat-label">平均延迟</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 分类统计 -->
    <el-card shadow="never" class="category-card">
      <template #header>
        <div class="card-header">
          <span>分类统计</span>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col :xs="12" :sm="8" :md="4" v-for="cat in categories" :key="cat.name">
          <div class="category-item" :class="{ active: activeCategory === cat.name }" @click="activeCategory = cat.name">
            <div class="category-name">{{ cat.label }}</div>
            <div class="category-count">{{ cat.count }} 个</div>
            <div class="category-calls">{{ cat.totalCalls }} 次调用</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 搜索和筛选 -->
    <div class="filter-bar">
      <el-input
        v-model="searchQuery"
        placeholder="搜索 Skill 名称或描述..."
        prefix-icon="Search"
        clearable
        class="search-input"
      />
      <el-select v-model="sortBy" placeholder="排序方式" class="sort-select">
        <el-option label="按名称" value="name" />
        <el-option label="按调用次数" value="calls" />
        <el-option label="按成功率" value="success" />
        <el-option label="按延迟" value="latency" />
      </el-select>
    </div>

    <!-- Skill 卡片列表 -->
    <div class="skills-grid" v-loading="loading">
      <el-card
        v-for="skill in filteredSkills"
        :key="skill.name"
        shadow="hover"
        class="skill-card"
        @click="openDetail(skill)"
      >
        <div class="skill-header">
          <div class="skill-title-row">
            <h3 class="skill-name">{{ skill.name }}</h3>
            <el-tag :type="getCategoryType(skill.category)" size="small">{{ getCategoryLabel(skill.category) }}</el-tag>
          </div>
          <div class="skill-version">v{{ skill.version }}</div>
        </div>
        <p class="skill-desc">{{ skill.description }}</p>
        <div class="skill-tags">
          <el-tag v-for="cap in skill.capabilities.slice(0, 3)" :key="cap" size="small" type="info" effect="plain">{{ cap }}</el-tag>
          <el-tag v-if="skill.capabilities.length > 3" size="small" type="info" effect="plain">+{{ skill.capabilities.length - 3 }}</el-tag>
        </div>
        <div class="skill-stats">
          <div class="skill-stat">
            <span class="stat-icon">📞</span>
            <span class="stat-value">{{ formatNumber(skill.stats.callCount) }}</span>
            <span class="stat-label">调用</span>
          </div>
          <div class="skill-stat">
            <span class="stat-icon">✅</span>
            <span class="stat-value" :class="{ 'text-danger': skill.stats.successRate < 0.8 }">{{ (skill.stats.successRate * 100).toFixed(0) }}%</span>
            <span class="stat-label">成功率</span>
          </div>
          <div class="skill-stat">
            <span class="stat-icon">⏱️</span>
            <span class="stat-value">{{ formatLatency(skill.stats.avgLatency) }}</span>
            <span class="stat-label">延迟</span>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 空状态 -->
    <el-empty v-if="!loading && filteredSkills.length === 0" description="未找到匹配的 Skill" />

    <!-- Skill 详情弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :title="`Skill 详情: ${selectedSkill?.name || ''}`"
      width="800px"
      top="5vh"
      class="skill-detail-dialog"
    >
      <div v-if="selectedSkill" class="detail-content">
        <!-- 基本信息 -->
        <el-descriptions title="基本信息" :column="2" border>
          <el-descriptions-item label="名称">{{ selectedSkill.name }}</el-descriptions-item>
          <el-descriptions-item label="版本">v{{ selectedSkill.version }}</el-descriptions-item>
          <el-descriptions-item label="分类">
            <el-tag :type="getCategoryType(selectedSkill.category)">{{ getCategoryLabel(selectedSkill.category) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ formatDate(selectedSkill.registeredAt) }}</el-descriptions-item>
          <el-descriptions-item label="最后调用" :span="2">{{ selectedSkill.lastCalledAt ? formatDate(selectedSkill.lastCalledAt) : '从未调用' }}</el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">{{ selectedSkill.description }}</el-descriptions-item>
        </el-descriptions>

        <!-- 能力标签 -->
        <div class="detail-section">
          <h4>能力标签</h4>
          <el-tag v-for="cap in selectedSkill.capabilities" :key="cap" class="capability-tag">{{ cap }}</el-tag>
        </div>

        <!-- 输入 Schema -->
        <div class="detail-section">
          <h4>输入参数</h4>
          <el-table :data="getSchemaFields(selectedSkill.inputSchema)" border size="small">
            <el-table-column prop="name" label="参数名" width="180" />
            <el-table-column prop="type" label="类型" width="100" />
            <el-table-column prop="required" label="必填" width="60">
              <template #default="{ row }">
                <el-tag :type="row.required ? 'danger' : 'info'" size="small">{{ row.required ? '是' : '否' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="说明" />
          </el-table>
        </div>

        <!-- 输出 Schema -->
        <div class="detail-section">
          <h4>输出字段</h4>
          <el-table :data="getSchemaFields(selectedSkill.outputSchema)" border size="small">
            <el-table-column prop="name" label="字段名" width="180" />
            <el-table-column prop="type" label="类型" width="100" />
            <el-table-column prop="description" label="说明" />
          </el-table>
        </div>

        <!-- 统计数据 -->
        <div class="detail-section">
          <h4>统计数据</h4>
          <el-row :gutter="16">
            <el-col :span="8">
              <div class="detail-stat">
                <div class="detail-stat-value">{{ formatNumber(selectedSkill.stats.callCount) }}</div>
                <div class="detail-stat-label">总调用次数</div>
              </div>
            </el-col>
            <el-col :span="8">
              <div class="detail-stat">
                <div class="detail-stat-value" :class="{ 'text-danger': selectedSkill.stats.successRate < 0.8 }">
                  {{ (selectedSkill.stats.successRate * 100).toFixed(1) }}%
                </div>
                <div class="detail-stat-label">成功率</div>
              </div>
            </el-col>
            <el-col :span="8">
              <div class="detail-stat">
                <div class="detail-stat-value">{{ formatLatency(selectedSkill.stats.avgLatency) }}</div>
                <div class="detail-stat-label">平均延迟</div>
              </div>
            </el-col>
          </el-row>
        </div>

        <!-- 测试执行 -->
        <div class="detail-section">
          <h4>测试执行</h4>
          <div class="test-panel">
            <el-input
              v-model="testInput"
              type="textarea"
              :rows="6"
              placeholder='输入 JSON 格式的参数，例如: {"topic": "Python基础", "type": "explanation", "targetLevel": "beginner"}'
              class="test-input"
            />
            <div class="test-actions">
              <el-button type="primary" @click="executeTest" :loading="testing">
                <el-icon><VideoPlay /></el-icon>
                执行测试
              </el-button>
              <el-button @click="fillSampleInput">
                <el-icon><Document /></el-icon>
                填充示例
              </el-button>
            </div>
            <div v-if="testResult" class="test-result">
              <div class="test-result-header">
                <span>执行结果</span>
                <el-tag :type="testResult.success ? 'success' : 'danger'" size="small">
                  {{ testResult.success ? '成功' : '失败' }}
                </el-tag>
                <span class="test-duration">{{ testResult.duration }}ms</span>
              </div>
              <pre class="test-output">{{ formatJson(testResult.output) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import {
  Operation,
  Promotion,
  CircleCheck,
  Timer,
  Search,
  VideoPlay,
  Document
} from '@element-plus/icons-vue';
import { adminSkillsApi } from '@/api/adminApi';

interface Skill {
  name: string;
  version: string;
  category: string;
  description: string;
  capabilities: string[];
  dependencies?: string[];
  inputSchema?: any;
  outputSchema?: any;
  stats: {
    callCount: number;
    successRate: number;
    avgLatency: number;
  };
  lastCalledAt?: string;
  registeredAt?: string;
}

interface Category {
  name: string;
  label: string;
  count: number;
  totalCalls: number;
  avgSuccessRate: number;
}

const loading = ref(false);
const testing = ref(false);
const skills = ref<Skill[]>([]);
const categories = ref<Category[]>([]);
const searchQuery = ref('');
const activeCategory = ref('all');
const sortBy = ref('name');
const detailVisible = ref(false);
const selectedSkill = ref<Skill | null>(null);
const testInput = ref('');
const testResult = ref<any>(null);

const stats = computed(() => {
  const totalSkills = skills.value.length;
  const totalCalls = skills.value.reduce((sum, s) => sum + s.stats.callCount, 0);
  const avgSuccessRate = totalSkills > 0
    ? ((skills.value.reduce((sum, s) => sum + s.stats.successRate, 0) / totalSkills) * 100).toFixed(1)
    : '0';
  const avgLatency = totalSkills > 0
    ? Math.round(skills.value.reduce((sum, s) => sum + s.stats.avgLatency, 0) / totalSkills)
    : 0;
  return { totalSkills, totalCalls, avgSuccessRate, avgLatency };
});

const filteredSkills = computed(() => {
  let result = [...skills.value];

  if (activeCategory.value !== 'all') {
    result = result.filter(s => s.category === activeCategory.value);
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query)
    );
  }

  switch (sortBy.value) {
    case 'calls':
      result.sort((a, b) => b.stats.callCount - a.stats.callCount);
      break;
    case 'success':
      result.sort((a, b) => b.stats.successRate - a.stats.successRate);
      break;
    case 'latency':
      result.sort((a, b) => a.stats.avgLatency - b.stats.avgLatency);
      break;
    default:
      result.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
});

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    parsing: '解析类',
    generation: '生成类',
    analysis: '分析类',
    retrieval: '检索类',
    computation: '计算类'
  };
  return labels[category] || category;
}

function getCategoryType(category: string): string {
  const types: Record<string, string> = {
    parsing: '',
    generation: 'success',
    analysis: 'warning',
    retrieval: 'info',
    computation: 'danger'
  };
  return types[category] || '';
}

function formatNumber(num: number): string {
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return Math.round(ms).toString();
}

function formatDate(date?: string): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN');
}

function formatJson(obj: any): string {
  try {
    return typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function getSchemaFields(schema: any): Array<{ name: string; type: string; required: boolean; description: string }> {
  if (!schema || !schema.properties) return [];
  return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: prop.type || 'any',
    required: prop.required || false,
    description: prop.description || '-'
  }));
}

function getSampleInput(skillName: string): string {
  const samples: Record<string, any> = {
    'content-generation': {
      topic: 'Python 基础语法',
      type: 'explanation',
      targetLevel: 'beginner',
      style: 'casual',
      length: 'medium'
    },
    'quiz-generation': {
      topic: 'Python 变量与数据类型',
      content: 'Python 中的变量和数据类型包括整数、浮点数、字符串、列表、字典等。',
      questionCount: 5,
      questionTypes: ['multiple-choice', 'short-answer'],
      difficulty: 'easy'
    },
    'time-estimator': {
      content: 'Python 基础语法学习材料，包含变量、数据类型、运算符、控制流等基础内容。',
      contentType: 'reading',
      difficulty: 'easy',
      userLevel: 'beginner'
    },
    'text-structure-analyzer': {
      text: '第一章 概述\n\n本章介绍 Python 的基本概念...\n\n第二章 变量\n\n变量是存储数据的容器...',
      detectOutline: true,
      detectChapters: true,
      extractKeywords: true
    },
    'pdf-parser': {
      filePath: '/path/to/document.pdf',
      extractImages: false,
      ocrEnabled: false
    },
    'answer-generation': {
      question: 'Python 中列表和元组有什么区别？',
      context: 'Python 基础数据类型',
      userLevel: 'beginner',
      style: 'socratic'
    },
    'code-explainer': {
      code: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
      language: 'python',
      detailLevel: 'intermediate'
    },
    'retrieval': {
      query: 'Python 列表推导式',
      topK: 5,
      threshold: 0.7
    }
  };
  return JSON.stringify(samples[skillName] || { /* 请根据 inputSchema 填写参数 */ }, null, 2);
}

async function loadSkills() {
  loading.value = true;
  try {
    const [skillsRes, categoriesRes] = await Promise.all([
      adminSkillsApi.getSkills(),
      adminSkillsApi.getCategories()
    ]);
    skills.value = skillsRes.data.data || [];
    categories.value = [{ name: 'all', label: '全部', count: skills.value.length, totalCalls: skills.value.reduce((s: any, sk: any) => s + sk.stats.callCount, 0), avgSuccessRate: 0 }, ...(categoriesRes.data.data || [])];
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error?.message || '加载 Skill 列表失败');
  } finally {
    loading.value = false;
  }
}

function openDetail(skill: Skill) {
  selectedSkill.value = skill;
  testInput.value = getSampleInput(skill.name);
  testResult.value = null;
  detailVisible.value = true;
}

function fillSampleInput() {
  if (selectedSkill.value) {
    testInput.value = getSampleInput(selectedSkill.value.name);
  }
}

async function executeTest() {
  if (!selectedSkill.value) return;

  let input: any;
  try {
    input = JSON.parse(testInput.value);
  } catch {
    ElMessage.error('请输入有效的 JSON 格式');
    return;
  }

  testing.value = true;
  testResult.value = null;
  try {
    const res = await adminSkillsApi.testSkill(selectedSkill.value.name, input);
    testResult.value = res.data.data;
    if (res.data.data.success) {
      ElMessage.success('执行成功');
    } else {
      ElMessage.warning('执行完成但返回失败状态');
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error?.message || '执行失败');
    testResult.value = {
      success: false,
      output: error.response?.data?.error?.message || 'Unknown error',
      duration: 0
    };
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  loadSkills();
});
</script>

<style scoped>
.skills-management {
  padding: 1.5rem;
}

.page-header {
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-desc {
  color: var(--text-secondary);
  margin: 0;
  font-size: 0.9rem;
}

.stats-row {
  margin-bottom: 1.5rem;
}

.stat-card {
  margin-bottom: 1rem;
}

.stat-card :deep(.el-card__body) {
  padding: 1rem;
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-icon--primary {
  background: rgba(74, 111, 165, 0.12);
  color: var(--color-primary);
}

.stat-icon--success {
  background: rgba(46, 204, 113, 0.12);
  color: var(--color-success);
}

.stat-icon--warning {
  background: rgba(244, 162, 97, 0.12);
  color: var(--color-accent);
}

.stat-icon--danger {
  background: rgba(231, 111, 81, 0.12);
  color: var(--color-danger);
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

.category-card {
  margin-bottom: 1.5rem;
}

.category-item {
  padding: 0.75rem;
  border-radius: var(--fluent-radius-md);
  background: var(--glass-bg-light);
  cursor: pointer;
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
  text-align: center;
  border: 2px solid var(--glass-border-light);
}

.category-item:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: var(--color-primary-light);
}

.category-item.active {
  background: rgba(255, 255, 255, 0.85);
  border-color: var(--color-primary);
}

.category-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.category-count {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.category-calls {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.125rem;
}

.filter-bar {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  align-items: center;
}

.search-input {
  flex: 1;
}

.sort-select {
  width: 140px;
}

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

.skill-card {
  cursor: pointer;
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
  border: 1px solid var(--glass-border-light);
  background: var(--glass-bg-light);
}

.skill-card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.skill-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.skill-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.skill-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-version {
  font-size: 0.75rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.skill-desc {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0 0 0.75rem 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
}

.skill-stats {
  display: flex;
  justify-content: space-around;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-default);
}

.skill-stat {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8rem;
}

.skill-stat .stat-icon {
  font-size: 0.9rem;
}

.skill-stat .stat-value {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.85rem;
}

.skill-stat .stat-label {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.text-danger {
  color: var(--color-danger) !important;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.detail-section h4 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.75rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-default);
}

.capability-tag {
  margin-right: 0.5rem;
  margin-bottom: 0.5rem;
}

.detail-stat {
  text-align: center;
  padding: 1rem;
  background: var(--glass-bg-light);
  border-radius: var(--fluent-radius-md);
}

.detail-stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.detail-stat-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.test-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.test-input {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.85rem;
}

.test-actions {
  display: flex;
  gap: 0.5rem;
}

.test-result {
  background: var(--glass-bg-light);
  border-radius: var(--fluent-radius-md);
  padding: 1rem;
  border: 1px solid var(--glass-border-light);
}

.test-result-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.test-duration {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-left: auto;
}

.test-output {
  background: color-mix(in srgb, var(--bg-elevated) 82%, #0f172a 18%);
  color: var(--text-inverse);
  padding: 1rem;
  border-radius: 6px;
  font-size: 0.8rem;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 300px;
  margin: 0;
  font-family: 'Fira Code', 'Consolas', monospace;
}

[data-theme="dark"] .category-item {
  background: var(--glass-bg-dark);
  border-color: var(--glass-border-dark);
}

[data-theme="dark"] .category-item:hover,
[data-theme="dark"] .category-item.active {
  background: color-mix(in srgb, var(--glass-bg-dark) 95%, transparent);
}

[data-theme="dark"] .skill-card {
  background: var(--glass-bg-dark);
  border-color: var(--glass-border-dark);
}

[data-theme="dark"] .skill-card:hover {
  box-shadow: var(--shadow-lg);
}

[data-theme="dark"] .detail-stat,
[data-theme="dark"] .test-result {
  background: var(--glass-bg-dark);
}

[data-theme="dark"] .test-output {
  background: var(--bg-elevated);
}

@media (max-width: 768px) {
  .skills-management {
    padding: 1rem;
  }

  .skills-grid {
    grid-template-columns: 1fr;
  }

  .filter-bar {
    flex-direction: column;
  }

  .sort-select {
    width: 100%;
  }
}
</style>
