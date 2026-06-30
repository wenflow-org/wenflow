<!--
  AgentEditor (Prompt 二级编辑页)
  ============================================================
  路由：/admin/skills/:agentId
  父路由列表页：/admin/skills
  设计：
    - 顶部 header（返回 + skill 名 + 健康 + 全局按钮）占满宽度但极薄
    - 主体：chip 切换 4 个 Pane；当前 Pane 占满剩余空间
    - 编辑 Pane 是默认；AI 起草 / 评估 / 工程视图同级
    - 不再嵌套 380px sidebar，编辑器吃满整屏
-->
<template>
  <div class="agent-editor-page">
    <!-- ============ 顶部 header ============ -->
    <header class="ed-head">
      <div class="ed-head__left">
        <button class="ed-back" @click="goBackList" title="返回列表">
          <el-icon><ArrowLeft /></el-icon>
          <span>返回列表</span>
        </button>
        <div v-if="currentAgent" class="ed-title-block">
          <div class="ed-title-row">
            <span class="ed-kind">SKILL</span>
            <h1 class="ed-title">{{ currentAgent.displayName || currentAgent.agentId }}</h1>
            <span :class="['ed-health', `ed-health--${currentAgent.health}`]">
              {{ healthLabel(currentAgent.health) }}
            </span>
            <span v-if="workbenchMeta?.parentAgent" class="ed-parent-agent" :title="`隶属于 ${workbenchMeta.parentAgent.name}`">
              <span class="ed-parent-arrow">↑</span>
              <span class="ed-parent-name">{{ workbenchMeta.parentAgent.name }}</span>
            </span>
          </div>
          <div class="ed-meta-row">
            <code class="ed-id">{{ currentAgent.agentId }}</code>
            <span v-if="currentAgent.file" class="ed-meta-chip">
              <span class="k">FILE</span>
              <span class="v">{{ currentAgent.file.path }}</span>
            </span>
            <span v-if="currentAgent.db && currentAgent.db.version" class="ed-meta-chip">
              <span class="k">DB ACTIVE</span>
              <el-tag size="small" type="info">v{{ currentAgent.db.version }}</el-tag>
            </span>
            <span v-if="workbenchMeta?.stats?.totalCalls" class="ed-meta-chip ed-meta-chip--info">
              <span class="k">调用</span>
              <span class="v">{{ workbenchMeta.stats.totalCalls }}</span>
            </span>
            <span v-if="workbenchMeta?.stats?.successRate != null" class="ed-meta-chip ed-meta-chip--info">
              <span class="k">成功率</span>
              <span class="v">{{ workbenchMeta.stats.successRate }}%</span>
            </span>
            <span v-if="workbenchMeta?.stats?.avgDuration" class="ed-meta-chip ed-meta-chip--info">
              <span class="k">平均耗时</span>
              <span class="v">{{ workbenchMeta.stats.avgDuration }}ms</span>
            </span>
            <span v-if="workbenchMeta?.modelConfig" class="ed-meta-chip">
              <span class="k">温度</span>
              <span class="v">{{ workbenchMeta.modelConfig.temperature }}</span>
            </span>
            <span v-if="currentAgent.drift === 'file-vs-db-mismatch'" class="ed-meta-chip ed-meta-chip--warn">
              File ↔ DB 漂移
            </span>
            <span v-if="currentAgent.tsFallback" class="ed-meta-chip ed-meta-chip--warn">
              .ts 兜底
            </span>
          </div>
        </div>
        <div v-else class="ed-loading">加载中…</div>
      </div>
      <div class="ed-head__right">
        <el-button :icon="Refresh" :loading="loading" size="small" @click="loadAll">刷新</el-button>
        <el-button size="small" @click="openProtocolDrawer">协议视图</el-button>
        <el-button size="small" type="primary" plain @click="openRulesOverview">规则总览</el-button>
        <el-button 
          size="small" 
          type="warning" 
          plain
          @click="openPromptLab"
          title="使用实验台编辑（Beta）"
        >
          <el-icon><MagicStick /></el-icon>
          实验台
        </el-button>
      </div>
    </header>

    <!-- ============ Tabs (chip-pill 风格) ============ -->
    <nav class="ed-pills" v-if="currentAgent">
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="['ed-pill', { 'ed-pill--active': activeTab === t.key }]"
        @click="activeTab = t.key"
      >
        <span class="ed-pill__icon"><el-icon><component :is="t.icon" /></el-icon></span>
        <span class="ed-pill__label">{{ t.label }}</span>
      </button>
    </nav>

    <!-- ============ Pane Body ============ -->
    <main class="ed-body" v-if="currentAgent">
      <!-- File ↔ DB 漂移警告 -->
      <el-alert
        v-if="currentAgent.drift === 'file-vs-db-mismatch'"
        type="warning"
        :closable="false"
        show-icon
        class="drift-warning"
      >
        <template #title>
          <strong>检测到 File ↔ DB 不一致</strong>
        </template>
        <div class="drift-warning__content">
          <p>该 Skill 的 Prompt 在两处存在差异：</p>
          <ul>
            <li><strong>文件源</strong>：<code>{{ currentAgent.file?.path || 'prompts/skill.*.md' }}</code></li>
            <li><strong>数据库</strong>：当前 ACTIVE 版本（v{{ currentAgent.db?.version || '?' }}）</li>
          </ul>
          <p class="drift-warning__advice">
            <strong>建议：</strong>
            <span v-if="activeTab === 'edit'">在此页面编辑会修改数据库版本。如需同步文件源，请使用「实验台」或手动编辑 <code>prompts/</code> 文件。</span>
            <span v-else>切换到「编辑工作台」查看详情并选择编辑入口。</span>
          </p>
        </div>
      </el-alert>

      <PromptWorkbench
        v-show="activeTab === 'edit'"
        :agent-id="currentAgent.agentId"
      />
      <PromptPreviewPane
        v-show="activeTab === 'preview'"
        :agent="currentAgent"
      />
      <SkillRuntimeConfigPane
        v-if="currentAgent.kind === 'skill'"
        v-show="activeTab === 'runtime'"
        :agent-id="currentAgent.agentId"
        @changed="onSkillRuntimeChanged"
      />
      <PromptEngineeringPane
        v-show="activeTab === 'engineering'"
        :agent="currentAgent"
      />
    </main>

    <!-- ============ 协议视图抽屉 ============ -->
    <el-drawer
      v-model="protocolDrawerVisible"
      title="协议视图（只读）"
      direction="rtl"
      size="640px"
    >
      <div v-if="protocolView" class="protocol-drawer">
        <p class="protocol-drawer__intro">
          Goal → Path、Path → Learn 之间的契约形态。只读上下文。
        </p>
        <article
          v-for="proto in protocolView.protocols"
          :key="proto.id"
          class="protocol-block"
        >
          <header class="protocol-block__head">
            <h3>{{ proto.title }}</h3>
            <span :class="['protocol-status', `protocol-status--${proto.status}`]">
              {{ proto.statusLabel }}
            </span>
          </header>
          <p class="protocol-block__summary">{{ proto.summary }}</p>
          <details class="protocol-block__details">
            <summary>Schema · {{ proto.schema.interface }}</summary>
            <div class="protocol-block__file">
              <code>{{ proto.schema.file }}</code>
            </div>
            <table class="protocol-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>类型</th>
                  <th>必填</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in proto.schema.fields" :key="f.name">
                  <td><code>{{ f.name }}</code></td>
                  <td><code>{{ f.type }}</code></td>
                  <td>
                    <span v-if="f.required" class="req req--yes">是</span>
                    <span v-else class="req req--no">否</span>
                  </td>
                  <td>{{ f.description }}</td>
                </tr>
              </tbody>
            </table>
            <div class="protocol-block__call-sites">
              <strong>调用点：</strong>
              <ul>
                <li v-for="site in proto.callSites" :key="site">
                  <code>{{ site }}</code>
                </li>
              </ul>
            </div>
          </details>
        </article>
        <ul class="protocol-notes">
          <li v-for="(note, idx) in protocolView.notes" :key="idx">{{ note }}</li>
        </ul>
      </div>
    </el-drawer>

    <!-- ============ 规则总览抽屉 ============ -->
    <el-drawer
      v-model="rulesDrawerVisible"
      title="Skill 规则总览"
      direction="rtl"
      size="720px"
    >
      <div v-if="rulesOverview" class="rules-overview">
        <div class="rules-overview__summary">
          <div class="rules-stat">
            <strong>{{ rulesOverview.summary.totalRules }}</strong>
            <span>规则项</span>
          </div>
          <div class="rules-stat">
            <strong>{{ rulesOverview.summary.totalPrefixes }}</strong>
            <span>前缀</span>
          </div>
          <div class="rules-stat">
            <strong>{{ rulesOverview.summary.totalAgentsWithRules }}</strong>
            <span>已规则化的 agent</span>
          </div>
          <div class="rules-stat" :class="rulesOverview.summary.conflictPrefixCount > 0 ? 'rules-stat--bad' : ''">
            <strong>{{ rulesOverview.summary.conflictPrefixCount }}</strong>
            <span>前缀冲突</span>
          </div>
        </div>

        <el-alert
          v-if="rulesOverview.conflictPrefixes.length > 0"
          type="warning"
          :closable="false"
          show-icon
          class="rules-conflict"
        >
          <template #title>prefix 冲突</template>
          <ul style="margin: 4px 0; padding-left: 20px; font-size: 12px">
            <li
              v-for="c in rulesOverview.conflictPrefixes"
              :key="c.prefix"
            >
              <code>{{ c.prefix }}</code> 同时被
              <code v-for="(id, i) in c.agentIds" :key="id">{{ id }}{{ i < c.agentIds.length - 1 ? ', ' : '' }}</code>
              使用 — 请改 prefix 避免歧义
            </li>
          </ul>
        </el-alert>

        <article
          v-for="(rules, prefix) in rulesOverview.byPrefix"
          :key="prefix"
          class="rules-group"
        >
          <header class="rules-group__head">
            <span class="rules-group__prefix">R-{{ prefix }}-NN</span>
            <span class="rules-group__count">{{ (rules as any[]).length }} 条</span>
            <span class="rules-group__owner">
              {{ groupOwner(rules as any[]) }}
            </span>
          </header>
          <ul class="rules-group__list">
            <li v-for="r in (rules as any[])" :key="r.ruleId + r.agentId" class="rules-row">
              <code class="rules-row__id">{{ r.ruleId }}</code>
              <span class="rules-row__text">{{ r.text }}</span>
              <button
                class="rules-row__jump"
                @click="jumpToAgent(r.agentId)"
                :title="`跳到 ${r.agentDisplayName}`"
              >→</button>
            </li>
          </ul>
        </article>
      </div>
      <div v-else-if="rulesOverviewLoading" class="rules-loading">加载中…</div>
    </el-drawer>

    <!-- SkillNodeWorkbench 已并入「模型运行时」一级 tab；旧抽屉移除 -->
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Refresh, Edit, VideoPlay, DataAnalysis, Setting, SetUp, MagicStick } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import {
  adminPromptOpsApi,
  adminAgentPromptsApi,
  adminSkillWorkbenchApi
} from '@/api/adminApi';
import SkillRuntimeConfigPane from './components/promptOps/SkillRuntimeConfigPane.vue';
import PromptWorkbench from './components/promptOps/PromptWorkbench.vue';
import PromptPreviewPane from './components/promptOps/PromptPreviewPane.vue';
import PromptEngineeringPane from './components/promptOps/PromptEngineeringPane.vue';
import { toast } from '../../utils/toast';

interface AgentOverviewItem {
  agentId: string;
  kind: 'skill';
  displayName: string;
  description: string | null;
  sources: { file: boolean; db: boolean; tsFallback: boolean };
  health: 'good' | 'warn' | 'risk';
  file: any;
  db: any;
  tsFallback: any;
  drift: 'in-sync' | 'file-vs-db-mismatch' | null;
  schemaLint?: any;
}

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const currentAgent = ref<AgentOverviewItem | null>(null);
const activeTab = ref<'edit' | 'preview' | 'runtime' | 'engineering'>('edit');

const tabs = computed(() => {
  const base: { key: 'edit' | 'preview' | 'runtime' | 'engineering'; label: string; icon: any }[] = [
    { key: 'edit', label: '编辑工作台', icon: Edit },
    { key: 'preview', label: '试运行', icon: VideoPlay }
  ];
  if (currentAgent.value?.kind === 'skill') {
    base.push({ key: 'runtime', label: '模型运行时', icon: Setting });
  }
  base.push({ key: 'engineering', label: '工程视图', icon: SetUp });
  return base;
});

const promptVersions = ref<any[]>([]);
const activePrompt = ref<any>(null);
const activePromptLoading = ref(false);

// Skill 工作台综合元数据（隶属 Agent / 模型配置 / 调用统计 / 字段契约）
const workbenchMeta = ref<{
  skill?: { id: string; name: string; description: string; category: string; aliases: string[]; ioContractVersion: string; noPromptFile: boolean };
  parentAgent?: { id: string; name: string; monitoringGroup: string } | null;
  modelConfig?: any;
  contract?: any;
  stats?: { totalCalls: number; successCalls: number; successRate: number | null; avgDuration: number; lastCalledAt: string | null };
} | null>(null);

const protocolDrawerVisible = ref(false);
const protocolView = ref<any>(null);

const rulesDrawerVisible = ref(false);
const rulesOverviewLoading = ref(false);
const rulesOverview = ref<any>(null);

// 注：旧的 SkillNodeWorkbench 抽屉已被「模型运行时」一级 tab 取代

const agentIdParam = computed(() => {
  const v = route.params.agentId;
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : '';
});

function healthLabel(h: 'good' | 'warn' | 'risk'): string {
  if (h === 'good') return '健康';
  if (h === 'warn') return '需关注';
  return '风险';
}

function goBackList() {
  void router.push({ name: 'AdminAgentRegistry' });
}

function openPromptLab() {
  void router.push({ name: 'AdminPromptLab' });
}

async function loadAll() {
  if (!agentIdParam.value) return;
  loading.value = true;
  try {
    const r = await adminPromptOpsApi.getAgentOverview();
    const items = (r.data?.data?.items || []) as AgentOverviewItem[];
    const found = items.find((x) => x.agentId === agentIdParam.value) || null;
    if (!found) {
      toast.error(`未找到 skill: ${agentIdParam.value}`);
      currentAgent.value = null;
      return;
    }
    currentAgent.value = found;
    await Promise.all([
      loadPromptDetailForAgent(found.agentId),
      loadWorkbenchMeta(found.agentId)
    ]);
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadPromptDetailForAgent(agentId: string) {
  activePromptLoading.value = true;
  try {
    const versionsRes = await adminAgentPromptsApi.getPromptVersions({ agentId });
    const nextVersions = versionsRes.data?.data?.list || [];
    const active = nextVersions.find((v: any) => v.status === 'ACTIVE');
    let nextActive = null;
    if (active) {
      const detailRes = await adminAgentPromptsApi.getPromptDetail(active.id);
      nextActive = detailRes.data?.data || null;
    }
    promptVersions.value = nextVersions;
    activePrompt.value = nextActive;
  } catch (err: any) {
    activePrompt.value = null;
    promptVersions.value = [];
    toast.error(err?.response?.data?.error?.message || 'Prompt 加载失败');
  } finally {
    activePromptLoading.value = false;
  }
}

async function loadWorkbenchMeta(agentId: string) {
  try {
    const r: any = await adminSkillWorkbenchApi.getMeta(agentId);
    workbenchMeta.value = r.data?.data || null;
  } catch (err: any) {
    workbenchMeta.value = null;
    // 不打 toast，仅作为辅助信息；缺失时不影响 Prompt 编辑流程
    console.warn('[skill-workbench-meta] 加载失败', err);
  }
}

async function openProtocolDrawer() {
  protocolDrawerVisible.value = true;
  if (!protocolView.value) {
    try {
      const r = await adminPromptOpsApi.getProtocolView();
      protocolView.value = r.data?.data || null;
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || '协议视图加载失败');
    }
  }
}

async function openRulesOverview() {
  rulesDrawerVisible.value = true;
  if (rulesOverview.value) return;
  rulesOverviewLoading.value = true;
  try {
    const r = await adminPromptOpsApi.getSkillRulesOverview();
    rulesOverview.value = r.data?.data || null;
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '规则总览加载失败');
  } finally {
    rulesOverviewLoading.value = false;
  }
}

function groupOwner(rules: any[]): string {
  const owners = new Set(rules.map((r) => r.agentDisplayName));
  if (owners.size === 1) {
    return Array.from(owners)[0];
  }
  return `${owners.size} 个 agent ⚠`;
}

function jumpToAgent(agentId: string) {
  rulesDrawerVisible.value = false;
  void router.push({ name: 'AdminAgentEditor', params: { agentId } });
}

async function publishPrompt(id: string) {
  try {
    await ElMessageBox.confirm('确认发布？这会归档当前 ACTIVE 版本。', '发布确认', {
      type: 'warning'
    });
    await adminAgentPromptsApi.publishPrompt(id);
    toast.success('发布成功');
    await loadAll();
  } catch (err: any) {
    if (err === 'cancel') return;
    toast.error(err?.response?.data?.error?.message || '发布失败');
  }
}

async function saveDraft(payload: {
  id?: string;
  agentId: string;
  systemPrompt: string;
  name: string;
  description?: string;
  temperature?: number;
  maxTokens?: number;
}) {
  try {
    if (payload.id) {
      await adminAgentPromptsApi.updatePrompt(payload.id, {
        name: payload.name,
        description: payload.description,
        systemPrompt: payload.systemPrompt,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      });
      toast.success('草稿已更新');
    } else {
      await adminAgentPromptsApi.createPrompt({
        agentId: payload.agentId,
        name: payload.name,
        description: payload.description,
        systemPrompt: payload.systemPrompt,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      });
      toast.success('草稿已创建');
    }
    await loadPromptDetailForAgent(payload.agentId);
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '保存失败');
  }
}

async function deletePromptVersion(id: string) {
  try {
    await ElMessageBox.confirm('确认删除该草稿？', '删除确认', {
      type: 'warning'
    });
    await adminAgentPromptsApi.deletePrompt(id);
    toast.success('已删除');
    if (currentAgent.value) {
      await loadPromptDetailForAgent(currentAgent.value.agentId);
    }
  } catch (err: any) {
    if (err === 'cancel') return;
    toast.error(err?.response?.data?.error?.message || '删除失败');
  }
}

function onSkillRuntimeChanged() {
  // skill_model_configs 变化后刷新 workbench 元信息，使顶部 chip 同步
  void loadAll();
}

watch(agentIdParam, (next, prev) => {
  if (next && next !== prev) {
    void loadAll();
  }
});

onMounted(async () => {
  await loadAll();
});
</script>

<style scoped>
.agent-editor-page {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 14px;
  padding: 18px 24px 28px;
  min-height: calc(100vh - 56px);
  background: linear-gradient(180deg, #f7f9fd 0%, #fafbfe 60%, #ffffff 100%);
}

/* ============ Header ============ */
.ed-head {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  padding: 14px 18px;
  background: var(--admin-bg-surface);
  border-radius: 14px;
  border: 1px solid rgba(205, 216, 238, 0.9);
}

.ed-head__left {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.ed-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #e2e8f0;
  background: var(--admin-bg-surface);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  color: #475569;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}

.ed-back:hover {
  border-color: #3478f6;
  color: #1d4ed8;
  background: #eff6ff;
}

.ed-title-block {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.ed-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ed-kind {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  letter-spacing: 0.05em;
}

.ed-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  color: #1a2a44;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.ed-health {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 999px;
  white-space: nowrap;
}

.ed-health--good {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}

.ed-health--warn {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.ed-health--risk {
  background: rgba(220, 38, 38, 0.12);
  color: #b91c1c;
}

.ed-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.ed-id {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  color: #475569;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 5px;
}

.ed-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
}

.ed-meta-chip .k {
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  font-size: 10px;
}

.ed-meta-chip .v {
  color: #475569;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 600;
  font-size: 11.5px;
}

.ed-meta-chip--warn {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  font-weight: 700;
  font-size: 11px;
}

.ed-meta-chip--info {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.2);
}

.ed-meta-chip--info .k {
  color: #6366f1;
}

.ed-parent-agent {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(99, 102, 241, 0.12));
  border: 1px solid rgba(139, 92, 246, 0.25);
  font-size: 13px;
  margin-left: 8px;
}

.ed-parent-arrow {
  color: #8b5cf6;
  font-weight: 700;
}

.ed-parent-name {
  color: #6d28d9;
  font-weight: 600;
}

.ed-loading {
  color: #94a3b8;
  font-size: 13px;
}

.ed-head__right {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

/* ============ Pills ============ */
.ed-pills {
  display: flex;
  gap: 6px;
  padding: 6px;
  background: var(--admin-bg-surface);
  border-radius: 12px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  width: fit-content;
}

.ed-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}

.ed-pill:hover {
  background: #f1f5f9;
  color: #334155;
}

.ed-pill--active {
  background: #1a2a44;
  color: white;
  box-shadow: 0 2px 8px rgba(26, 42, 68, 0.18);
}

.ed-pill--active:hover {
  background: #1a2a44;
  color: white;
}

.ed-pill__icon {
  font-size: 15px;
  line-height: 1;
}

/* ============ Body ============ */
.ed-body {
  background: var(--admin-bg-surface);
  border-radius: 16px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  padding: 22px 24px;
  overflow: auto;
  min-height: 480px;
}

/* ============ Drift Warning ============ */
.drift-warning {
  margin-bottom: 20px;
}

.drift-warning__content {
  font-size: 13px;
  line-height: 1.6;
}

.drift-warning__content p {
  margin: 8px 0;
}

.drift-warning__content ul {
  margin: 8px 0;
  padding-left: 20px;
}

.drift-warning__content li {
  margin: 4px 0;
}

.drift-warning__content code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  background: rgba(245, 158, 11, 0.1);
  color: #b45309;
  padding: 2px 6px;
  border-radius: 4px;
}

.drift-warning__advice {
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.08);
  border-radius: 8px;
  border-left: 3px solid #f59e0b;
}

/* ============ Drawer styles (复用列表页) ============ */
.protocol-drawer {
  padding: 0 8px;
}

.protocol-drawer__intro {
  color: #62758f;
  line-height: 1.7;
  font-size: 13px;
  background: #f8fafc;
  padding: 12px 14px;
  border-radius: 10px;
  margin-bottom: 16px;
}

.protocol-drawer__intro code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  background: rgba(52, 120, 246, 0.08);
  color: #1d4ed8;
  padding: 1px 5px;
  border-radius: 3px;
}

.protocol-block {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--admin-bg-surface);
}

.protocol-block__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.protocol-block__head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: #1a2a44;
}

.protocol-status {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}

.protocol-status--direct-call {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.protocol-status--json-blob {
  background: rgba(220, 38, 38, 0.12);
  color: #b91c1c;
}

.protocol-block__summary {
  margin: 0 0 8px;
  color: #62758f;
  font-size: 12.5px;
  line-height: 1.7;
}

.protocol-block__details summary {
  cursor: pointer;
  color: #3478f6;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
}

.protocol-block__file {
  margin: 6px 0;
  font-size: 11px;
}

.protocol-block__file code,
.protocol-table code,
.protocol-block__call-sites code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  background: #f1f5f9;
  color: #475569;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
}

.protocol-table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}

.protocol-table th {
  text-align: left;
  font-weight: 700;
  font-size: 11px;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 6px 8px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.protocol-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
  vertical-align: top;
}

.req {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
}

.req--yes {
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
}

.req--no {
  background: #f1f5f9;
  color: #94a3b8;
}

.protocol-block__call-sites {
  margin-top: 10px;
  font-size: 11.5px;
}

.protocol-block__call-sites strong {
  color: #475569;
}

.protocol-block__call-sites ul {
  margin: 4px 0 0;
  padding-left: 20px;
}

.protocol-notes {
  margin: 16px 0 0;
  padding: 12px 14px 12px 32px;
  background: var(--admin-color-warning-bg);
  border-radius: 10px;
  font-size: 12px;
  color: #9a3412;
  line-height: 1.7;
}

/* Rules drawer */
.rules-overview {
  padding: 0 8px;
}

.rules-overview__summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

.rules-stat {
  background: #f8fafc;
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}

.rules-stat strong {
  display: block;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 24px;
  font-weight: 800;
  color: #6d28d9;
}

.rules-stat span {
  font-size: 11px;
  color: #64748b;
}

.rules-stat--bad strong {
  color: #b91c1c;
}

.rules-stat--bad {
  background: rgba(220, 38, 38, 0.06);
}

.rules-conflict {
  margin-bottom: 14px;
}

.rules-conflict code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  background: rgba(245, 158, 11, 0.1);
  color: #b45309;
  padding: 1px 5px;
  border-radius: 3px;
}

.rules-group {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--admin-bg-surface);
}

.rules-group__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.rules-group__prefix {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  font-weight: 800;
  color: #6d28d9;
  background: rgba(139, 92, 246, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
}

.rules-group__count {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #475569;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 3px;
}

.rules-group__owner {
  font-size: 12px;
  color: #64748b;
}

.rules-group__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rules-row {
  display: grid;
  grid-template-columns: 86px 1fr auto;
  gap: 10px;
  align-items: start;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.7;
}

.rules-row:hover {
  background: #f8fafc;
}

.rules-row__id {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #6d28d9;
  background: transparent;
  padding: 0;
  white-space: nowrap;
}

.rules-row__text {
  color: #334155;
  word-break: break-word;
}

.rules-row__jump {
  border: 1px solid #e2e8f0;
  background: var(--admin-bg-surface);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 12px;
  color: #3478f6;
  cursor: pointer;
  height: 22px;
}

.rules-row__jump:hover {
  background: #eff6ff;
  border-color: #3478f6;
}

.rules-loading {
  padding: 60px;
  text-align: center;
  color: #94a3b8;
}

@media (max-width: 900px) {
  .ed-head {
    grid-template-columns: 1fr;
  }
  .ed-head__right {
    justify-content: flex-end;
  }
}
</style>
