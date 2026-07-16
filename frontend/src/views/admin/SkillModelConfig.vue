<template>
  <div class="admin-page skill-model-config">
    <AdminPageHeader
      title="外挂组件目录"
      :icon="Operation"
      :highlights="componentConfigHighlights"
    >
      <template #actions>
        <el-button @click="refresh">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </AdminPageHeader>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索组件 ID / 名称" clearable class="search" />
        <el-select v-model="statusFilter" placeholder="工作状态" clearable class="select">
          <el-option label="正常" value="working" />
          <el-option label="占位" value="placeholder" />
          <el-option label="简化" value="simplified" />
          <el-option label="模拟" value="mock" />
        </el-select>
        <el-checkbox v-model="onlyEnabled">仅看独立配置</el-checkbox>
      </div>
      <div class="admin-list-toolbar__group">
        <p class="component-toolbar-note">{{ filteredConfigs.length }} / {{ configs.length }} 个组件满足当前筛选</p>
      </div>
    </div>

    <div class="admin-list-card">
      <el-table :data="filteredConfigs" v-loading="loading" stripe>
        <el-table-column label="Skill" min-width="280">
          <template #default="{ row }">
            <div class="skill-cell">
              <strong class="skill-cell__name">{{ getSkillDisplayName(row) }}</strong>
              <span class="skill-cell__id">调用名：{{ row.skillId }}</span>
              <span class="skill-cell__meta">{{ row.tier }}</span>
              <span v-if="getSkillHint(row.skillId)" class="skill-cell__hint">{{ getSkillHint(row.skillId) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最后调用日期" min-width="170">
          <template #default="{ row }">
            <div class="last-called-cell">
              <strong>{{ formatLastCalledRelative(row.lastCalledAt) }}</strong>
              <span>{{ formatDateTime(row.lastCalledAt) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="140">
          <template #default="{ row }">
            <div class="status-cell">
              <el-tag v-if="row.status" :type="getStatusTagType(row.status)" size="small">
                {{ getStatusLabel(row.status) }}
              </el-tag>
              <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                {{ row.enabled ? '独立配置' : '继承' }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="配置策略" min-width="240">
          <template #default="{ row }">
            <div class="strategy-cell">
              <span class="strategy-cell__model">{{ row.model || '平台默认模型' }}</span>
              <div class="strategy-cell__tags">
                <el-tag :type="thinkingTagType(row.thinkingMode)">{{ formatThinkingMode(row.thinkingMode) }}</el-tag>
                <el-tag :type="effortTagType(row.reasoningEffort)">{{ formatReasoningEffort(row.reasoningEffort) }}</el-tag>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="参数摘要" min-width="180">
          <template #default="{ row }">
            <div class="params-cell">
              <div class="params-cell__row">
                <span>温度 {{ row.temperature ?? '--' }}</span>
                <span>最大输出 {{ row.maxTokens ?? '--' }}</span>
              </div>
              <div class="params-cell__row params-cell__row--sub">
                <el-tag size="small" type="info">{{ formatTimeout(row.requestTimeoutMs) }}</el-tag>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="openSkillWorkbench(row)">快速查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <section class="admin-mobile-list" v-loading="loading" aria-label="外挂组件列表">
      <article v-for="config in filteredConfigs" :key="config.skillId" class="admin-mobile-card">
        <div class="admin-mobile-card__head">
          <div class="skill-cell">
            <strong class="skill-cell__name">{{ getSkillDisplayName(config) }}</strong>
            <span class="skill-cell__id">{{ config.skillId }}</span>
          </div>
          <el-tag v-if="config.status" :type="getStatusTagType(config.status)" size="small">
            {{ getStatusLabel(config.status) }}
          </el-tag>
        </div>
        <div class="admin-mobile-card__section">
          <span>配置策略</span>
          <strong>{{ config.model || '平台默认模型' }}</strong>
        </div>
        <div class="admin-mobile-card__tags">
          <el-tag :type="config.enabled ? 'success' : 'info'" size="small">{{ config.enabled ? '独立配置' : '继承' }}</el-tag>
          <el-tag size="small" type="info">温度 {{ config.temperature ?? '--' }}</el-tag>
          <el-tag size="small" type="info">最大输出 {{ config.maxTokens ?? '--' }}</el-tag>
        </div>
        <div class="admin-mobile-card__footer">
          <span>{{ formatLastCalledRelative(config.lastCalledAt) }}</span>
          <el-button type="primary" plain @click="openSkillWorkbench(config)">快速查看</el-button>
        </div>
      </article>
      <el-empty v-if="!loading && filteredConfigs.length === 0" description="没有匹配的外挂组件" />
    </section>

    <SkillNodeWorkbench v-model:visible="skillWorkbenchVisible" :skill-id="currentSkillId" @changed="fetchConfigs" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Operation, Refresh } from '@element-plus/icons-vue';
import { adminSkillsApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';
import SkillNodeWorkbench from './components/SkillNodeWorkbench.vue';
import { toast } from '../../utils/toast';
import { EXTRA_COMPONENT_VISIBLE_SKILLS } from './capabilityCatalog';

interface SkillModelConfig {
  skillId: string;
  displayName?: string;
  status?: 'working' | 'placeholder' | 'simplified' | 'mock';
  lastCalledAt?: string | null;
  tier: string;
  model?: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  temperature?: number;
  maxTokens?: number;
  requestTimeoutMs?: number | null;
  enabled: boolean;
}

const configs = ref<SkillModelConfig[]>([]);
const loading = ref(false);
const keyword = ref('');
const statusFilter = ref('');
const onlyEnabled = ref(false);
const summary = ref<{ total: number; working: number; simplified: number; needsAttention: number } | null>(null);

const skillWorkbenchVisible = ref(false);
const currentSkillId = ref('');
const route = useRoute();

const filteredConfigs = computed(() => {
  return configs.value.filter(config => {
    const visibleByScope = EXTRA_COMPONENT_VISIBLE_SKILLS.has(config.skillId);
    const byKeyword = !keyword.value || `${config.skillId} ${config.displayName || ''}`.toLowerCase().includes(keyword.value.toLowerCase());
    const byStatus = !statusFilter.value || config.status === statusFilter.value;
    const byEnabled = !onlyEnabled.value || config.enabled;
    return visibleByScope && byKeyword && byStatus && byEnabled;
  });
});

const componentConfigHighlights = computed(() => [
  { label: summary.value ? `正常 ${summary.value.working}` : '等待统计', tone: 'success' as const },
  { label: summary.value ? `简化 ${summary.value.simplified}` : '等待统计', tone: 'warning' as const }
]);

const SKILL_HINTS: Record<string, string> = {
  'path-scene-framing': '整理路径生成所需的输入。',
  'stage-designer': '生成阶段任务与任务标签。',
};

const SKILL_CN_NAMES: Record<string, string> = {
  'text-structure-analyzer': '文本结构分析器',
  'retrieval': '内容检索器',
  'web-extractor': '网页内容提取器',
  'image-analyzer': '图片分析器',
  'memory-search': '学习记忆搜索器',
  'smart-search': '智能搜索器',
  'label-generator': '动态标签生成器',
  'path-scene-framing': '路径场景构图',
  'stage-designer': '阶段任务设计器',
  'adaptive-guidance-copy': '动态引导文案生成器',
  'goal-profile-inference': '目标阶段画像推断器',
  'learning-pattern-distiller': '学习模式蒸馏器',
  'session-knowledge-distiller': '课堂知识蒸馏器',
  'dialogue-concept-extractor': '对话概念抽取器',
  'virtual-learner-persona-designer': '虚拟学习者身份设计器',
  'virtual-learner-scenario-designer': '虚拟学习者故事设计器',
  'peer-reinforcement': '同伴强化',
};

const toSkillPromptAgentId = (skillId: string) => `skill:${skillId}`;

const getSkillHint = (skillId?: string) => {
  if (!skillId) return '';
  return SKILL_HINTS[skillId] || '';
};

const getSkillDisplayName = (row: SkillModelConfig) => {
  return SKILL_CN_NAMES[row.skillId] || row.displayName || row.skillId;
};

const fetchConfigs = async () => {
  loading.value = true;
  try {
    const res = await adminSkillsApi.getSkillModelConfigs();
    configs.value = (res.data?.data || []).filter((config: SkillModelConfig) => EXTRA_COMPONENT_VISIBLE_SKILLS.has(config.skillId));
    updateSummary();
  } catch {
    toast.error('获取 Skill 配置失败');
  }
  loading.value = false;
};

const syncKeywordFromRoute = () => {
  const scope = typeof route.query.scope === 'string' ? route.query.scope.trim() : '';
  const skillId = typeof route.query.skillId === 'string' ? route.query.skillId.trim().replace(/^skill:/, '') : '';
  keyword.value = skillId || scope;
};

const openRequestedSkillFromQuery = () => {
  const rawSkillId = typeof route.query.skillId === 'string' ? route.query.skillId.trim() : '';
  if (!rawSkillId || !configs.value.length) return;

  const normalizedSkillId = rawSkillId.replace(/^skill:/, '');
  const matchedConfig = configs.value.find((item) => item.skillId === normalizedSkillId);
  if (!matchedConfig) return;
  if (currentSkillId.value === matchedConfig.skillId && skillWorkbenchVisible.value) return;

  openSkillWorkbench(matchedConfig);
};

const updateSummary = () => {
  const total = configs.value.length;
  const working = configs.value.filter(c => c.status === 'working').length;
  const simplified = configs.value.filter(c => c.status === 'simplified').length;
  const needsAttention = configs.value.filter(c => c.status === 'placeholder' || c.status === 'mock').length;
  summary.value = { total, working, simplified, needsAttention };
};

const formatThinkingMode = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return '开启';
  if (thinkingMode === 'disabled') return '关闭';
  return '继承/默认';
};

const formatReasoningEffort = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'high') return 'high';
  if (reasoningEffort === 'max') return 'max';
  return '继承/默认';
};

const thinkingTagType = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return 'warning';
  if (thinkingMode === 'disabled') return 'success';
  return 'info';
};

const effortTagType = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'max') return 'danger';
  if (reasoningEffort === 'high') return 'warning';
  return 'info';
};

const formatTimeout = (timeoutMs?: number | null) => {
  if (!timeoutMs || Number.isNaN(Number(timeoutMs))) return '继承';
  return `${Math.round(Number(timeoutMs) / 1000)}s`;
};

const getStatusTagType = (status?: 'working' | 'placeholder' | 'simplified' | 'mock') => {
  if (status === 'working') return 'success';
  if (status === 'placeholder') return 'danger';
  if (status === 'simplified') return 'warning';
  if (status === 'mock') return 'info';
  return '';
};

const getStatusLabel = (status?: 'working' | 'placeholder' | 'simplified' | 'mock') => {
  if (status === 'working') return '正常';
  if (status === 'placeholder') return '占位';
  if (status === 'simplified') return '简化';
  if (status === 'mock') return '模拟';
  return '';
};

const getPromptStatusLabel = (status?: string | null) => {
  if (!status) return '未知';
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE') return '已生效';
  if (normalized === 'BUILT_IN' || normalized === 'FALLBACK') return '代码内置';
  if (normalized === 'GENERATED') return '默认草案';
  if (normalized === 'ARCHIVED') return '已归档';
  if (normalized === 'DRAFT') return '草稿';
  if (normalized === 'PUBLISHED') return '已发布';
  if (normalized === 'STAGING') return '预发布';
  return '未知';
};

const getPromptStatusTagType = (status?: string | null) => {
  if (!status) return 'info';
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE' || normalized === 'PUBLISHED') return 'success';
  if (normalized === 'BUILT_IN' || normalized === 'FALLBACK') return 'info';
  if (normalized === 'GENERATED') return 'warning';
  if (normalized === 'STAGING') return 'warning';
  if (normalized === 'ARCHIVED') return 'info';
  if (normalized === 'DRAFT') return 'info';
  return 'info';
};

const promptSourceLabel = (source: 'db-active' | 'code-fallback' | 'generated-default' | '') => {
  if (source === 'db-active') return 'DB Active';
  if (source === 'code-fallback') return 'Code Fallback';
  if (source === 'generated-default') return 'Generated Default';
  return 'Unknown';
};

const promptSourceTagType = (source: 'db-active' | 'code-fallback' | 'generated-default' | '') => {
  if (source === 'db-active') return 'success';
  if (source === 'generated-default') return 'warning';
  if (source === 'code-fallback') return 'info';
  return 'info';
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
};

const formatLastCalledRelative = (value: string | null | undefined) => {
  if (!value) return '未调用';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未调用';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

const refresh = () => fetchConfigs();
const openSkillWorkbench = (row: SkillModelConfig) => {
  currentSkillId.value = row.skillId;
  skillWorkbenchVisible.value = true;
};

onMounted(() => {
  syncKeywordFromRoute();
  fetchConfigs();
});

watch(
  () => [route.query.scope, route.query.skillId] as const,
  () => {
    syncKeywordFromRoute();
    openRequestedSkillFromQuery();
  }
);

watch(
  () => configs.value.length,
  () => {
    openRequestedSkillFromQuery();
  }
);
</script>

<style scoped>
.skill-model-config {
  /* 继承 admin-page 的默认 padding */
}

.component-summary-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.component-toolbar-note {
  margin: 0;
  font-size: 12px;
  color: var(--admin-text-muted);
}

.admin-mobile-list {
  display: none;
}

.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title.admin-page-title { margin: 8px 0 0; font-size: 1.6rem; font-weight: 700; color: #22344d; letter-spacing: -0.03em; display: flex; align-items: center; gap: 8px; }
.admin-page-title__icon { font-size: 1.25rem; color: var(--color-primary); }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }

.skill-btn,
.table-link-btn {
  font-weight: 550;
}

.skill-btn--ghost {
  color: var(--admin-text-secondary);
}

.table-link-btn {
  min-height: 30px;
  padding: 0 12px;
}
.summary-card { border-radius: var(--radius-lg); border: 1px solid var(--border-default); background: var(--glass-bg-light); }
.summary-card .label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
.summary-card .value { font-size: 1.75rem; font-weight: 800; margin-top: 0.25rem; }
.summary-card--blue .value { color: var(--color-primary); }
.summary-card--green .value { color: #16a34a; }
.summary-card--orange .value { color: #ea580c; }
.summary-card--red .value { color: #dc2626; }
.summary-card .danger { color: #dc2626; }

.admin-list-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; position: relative; z-index: 1; }
.admin-list-toolbar__group { display: flex; align-items: center; gap: 0.5rem; }
.admin-list-toolbar .search { width: 220px; }
.admin-list-toolbar .select { width: 120px; }

.admin-list-card {
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-md);
  padding: 0;
  background: var(--admin-bg-surface);
  backdrop-filter: none;
  position: relative;
  z-index: 1;
  box-shadow: none;
  overflow: hidden;
}

.admin-list-card :deep(.el-table) {
  --el-table-border-color: rgba(52, 120, 246, 0.06);
  background: transparent;
}

.admin-list-card :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
  font-size: 0.8125rem;
  color: #7085a6;
}

.admin-list-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(52, 120, 246, 0.015);
}

.admin-list-card :deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

.admin-list-card :deep(.el-table td.el-table__cell) {
  border-bottom-color: rgba(52, 120, 246, 0.04);
}

.skill-cell {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.skill-cell__name {
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 700;
}

.skill-cell__id {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.skill-cell__meta {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.skill-cell__hint {
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

.status-cell { display: flex; gap: 0.5rem; align-items: center; }

.strategy-cell {
  display: grid;
  gap: 6px;
}

.strategy-cell__model {
  color: var(--text-primary);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.strategy-cell__tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.params-cell {
  display: grid;
  gap: 6px;
}

.params-cell__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-primary);
  font-size: 12px;
}

.params-cell__row--sub {
  justify-content: flex-start;
}

.last-called-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.last-called-cell strong {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.last-called-cell span {
  font-size: 12px;
  color: var(--text-secondary);
}

.skill-config-dialog :deep(.el-dialog) {
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  overflow: hidden;
}

.skill-config-form__notice {
  margin-bottom: 0.25rem;
}

.skill-config-dialog :deep(.el-dialog__header) {
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(247, 250, 255, 0.92));
}

.skill-config-dialog :deep(.el-dialog__title) {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.skill-config-dialog :deep(.el-dialog__body) {
  padding: 18px 22px 12px;
  background: rgba(255, 255, 255, 0.95);
}

.skill-config-dialog :deep(.el-dialog__footer) {
  padding: 12px 22px 18px;
  border-top: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(251, 253, 255, 0.95), rgba(245, 248, 253, 0.95));
}

.skill-config-form {
  display: grid;
  gap: 4px;
}

.skill-workbench {
  display: grid;
  gap: 1rem;
  min-height: 240px;
  padding-right: 4px;
  min-width: 0;
}

.workbench-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr);
  gap: 16px;
}

.workbench-hero__main {
  display: grid;
  gap: 8px;
}

.workbench-hero__kicker {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--admin-color-info-bg);
  color: var(--admin-text-brand);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.workbench-hero__main h3 {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: 1.2rem;
}

.workbench-hero__main p {
  margin: 0;
  color: var(--admin-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.workbench-hero__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.workbench-glance-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 12px;
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface-alt);
}

.workbench-glance-card__label {
  font-size: 11px;
  font-weight: 700;
  color: var(--admin-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.workbench-glance-card strong {
  color: var(--admin-text-primary);
  font-size: 14px;
}

.skill-workbench__tabs {
  min-width: 0;
}

.skill-workbench :deep(.el-tabs__content) {
  padding-top: 0.25rem;
}

.skill-workbench :deep(.el-descriptions) {
  width: 100%;
  min-width: 0;
}

.skill-workbench :deep(.el-descriptions__body) {
  overflow-x: auto;
}

.skill-workbench :deep(.el-descriptions__table) {
  min-width: 680px;
}

.chip-section {
  margin-top: 1rem;
  padding: 1rem;
  background: color-mix(in srgb, var(--bg-surface) 60%, white);
  border-radius: var(--radius-md);
}

.chip-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.chip-row:last-child {
  margin-bottom: 0;
}

.chip-label {
  min-width: 80px;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.skill-config-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.skill-config-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--text-secondary);
}

.skill-config-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.field-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.skill-prompt-drawer {
  padding: 1rem;
  display: grid;
  gap: 1rem;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.prompt-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.prompt-summary-card,
.prompt-text-card,
.prompt-versions-card {
  border: 1px solid var(--border-light, var(--border-default));
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 0.9rem;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
}

.prompt-summary-card {
  display: grid;
  gap: 0.7rem;
}

.prompt-summary-card__row,
.prompt-text-card__header,
.prompt-versions-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.prompt-summary-card__label,
.prompt-versions-card__meta,
.params-inline {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.prompt-text-card__header h4,
.prompt-versions-card__header h4 {
  margin: 0;
  color: var(--text-primary);
}

.sample-json {
  font-family: monospace;
  font-size: 0.75rem;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 1rem;
  border-radius: var(--radius-md);
  overflow: auto;
  max-height: 300px;
}

.prompt-text-card__content {
  margin-top: 0.75rem;
  max-width: 100%;
  overflow-x: auto;
}

.prompt-versions-table {
  margin-top: 0.75rem;
  max-width: 100%;
  overflow-x: auto;
}

.contract-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  min-width: 0;
}

.contract-grid--preview {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 1rem;
}

.contract-card {
  padding: 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--glass-bg-light);
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.contract-card h4 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.contract-card p {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}

.preview-textarea :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.875rem;
  border-radius: 16px;
  background: rgba(52, 120, 246, 0.03);
  border-color: rgba(52, 120, 246, 0.08);
}

:deep(.prompt-versions-table .el-table) {
  width: 100%;
  min-width: 0;
}

:deep(.prompt-versions-table .el-table__inner-wrapper) {
  min-width: 0;
}

:deep(.prompt-versions-table .el-table__body-wrapper) {
  overflow-x: auto;
}

@media (max-width: 1100px) {
  .workbench-hero {
    grid-template-columns: 1fr;
  }

  .workbench-hero__meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .contract-grid--preview {
    grid-template-columns: 1fr;
  }
}

:deep(.el-dialog) {
  max-width: calc(100vw - 32px);
}

:deep(.el-dialog__body) {
  overflow-x: hidden;
}

@media (max-width: 768px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .admin-list-toolbar { flex-direction: column; align-items: stretch; }
  .admin-list-toolbar__group { justify-content: space-between; }

  .admin-list-card {
    display: none;
  }

  .admin-mobile-list {
    display: grid;
    gap: 10px;
  }

  .admin-mobile-card {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: var(--admin-border-subtle);
    border-radius: var(--admin-radius-md);
    background: var(--admin-bg-surface);
  }

  .admin-mobile-card__head,
  .admin-mobile-card__footer,
  .admin-mobile-card__tags {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .admin-mobile-card__head,
  .admin-mobile-card__footer {
    justify-content: space-between;
  }

  .admin-mobile-card__footer {
    align-items: center;
    color: var(--admin-text-muted);
    font-size: 12px;
  }

  .admin-mobile-card__tags {
    flex-wrap: wrap;
  }

  .admin-mobile-card__section {
    display: grid;
    gap: 4px;
  }

  .admin-mobile-card__section span {
    color: var(--admin-text-muted);
    font-size: 12px;
  }

  .admin-mobile-card__section strong {
    color: var(--admin-text-primary);
    font-size: 13px;
  }
}
</style>
