<template>
  <div class="prompt-stability-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">测试站点</span>
      <h2 class="page-hero__title">
        <el-icon class="title-icon"><MagicStick /></el-icon>
        Prompt 稳定性测试
      </h2>
      <p class="page-hero__subtitle">
        <el-tag type="warning" effect="plain" size="small" style="margin-right: 8px">测试环境</el-tag>
        加载 Prompt、运行多轮脚本、执行轻量检查器并统计结构化稳定性。
      </p>
    </div>

    <div class="panel-grid">
      <el-card class="panel-card" shadow="hover">
        <template #header>
          <div class="panel-card__header">
            <span>运行配置</span>
          </div>
        </template>

        <el-form label-position="top" class="config-form">
          <el-form-item label="Agent">
            <el-select v-model="form.agentId" class="field" clearable filterable placeholder="选择 Agent">
              <el-option label="目标对话 Agent" value="goal-conversation-agent" />
              <el-option label="路径规划 Agent" value="path-agent" />
              <el-option label="AI 授课 Agent" value="ai-teaching-agent" />
              <el-option label="学习者画像与状态中心" value="learner-model-agent" />
              <el-option label="学习者编排器" value="learner-orchestrator" />
            </el-select>
          </el-form-item>

          <el-form-item label="Prompt 版本">
            <el-select v-model="form.promptVersionId" class="field" clearable filterable placeholder="默认使用 ACTIVE 版本">
              <el-option
                v-for="item in promptOptions"
                :key="item.id"
                :label="item.label"
                :value="item.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="自定义 Prompt 覆盖">
            <el-input
              v-model="form.customPrompt"
              type="textarea"
              :rows="8"
              resize="vertical"
              placeholder="可选。留空则使用所选版本或 ACTIVE 版本。"
            />
          </el-form-item>

          <el-form-item label="模型覆盖">
            <el-input v-model="form.model" placeholder="可选，留空则沿用 Prompt 配置模型" />
          </el-form-item>

          <el-form-item label="重复次数">
            <el-input-number v-model="form.repeatCount" :min="1" :max="20" :step="1" />
          </el-form-item>
        </el-form>
      </el-card>

      <el-card class="panel-card" shadow="hover">
        <template #header>
          <div class="panel-card__header">
            <span>检查器</span>
            <el-tag size="small" effect="plain">{{ checkers.length }} 项</el-tag>
          </div>
        </template>

        <el-collapse>
          <el-collapse-item v-for="item in checkers" :key="item.key" :title="item.label">
            <div class="checker-item__desc">{{ item.description }}</div>
          </el-collapse-item>
        </el-collapse>
      </el-card>
    </div>

    <el-card class="editor-card" shadow="hover">
      <template #header>
        <div class="panel-card__header">
          <span>测试脚本</span>
          <el-button text @click="loadExample">载入示例</el-button>
        </div>
      </template>

      <div class="editor-card__hint">
        输入 JSON 数组。每个 case 形如：<code>{`{ name, previousState?, messages: [{ role, content }] }`}</code>
        <el-select v-model="selectedTemplate" placeholder="选择模板" size="small" clearable style="margin-left: 12px" @change="applyTemplate">
          <el-option label="沟通收敛模板" value="communication" />
          <el-option label="Excel 自动化模板" value="excel" />
          <el-option label="基础模板" value="basic" />
        </el-select>
      </div>
      <el-input
        v-model="casesJson"
        type="textarea"
        :rows="16"
        resize="vertical"
        class="json-editor"
        placeholder='[
  {
    "name": "case-1",
    "previousState": { "stage": "understanding", "confidence": 0 },
    "messages": [
      { "role": "user", "content": "我想提升职场沟通" },
      { "role": "assistant", "content": "你最想先改善哪个场景？" },
      { "role": "user", "content": "向上汇报" }
    ]
  }
]'
      />

      <div class="editor-card__actions">
        <el-button type="primary" :loading="running" @click="runEvaluation">
          {{ running ? `运行中 ${runningProgress.current}/${runningProgress.total}` : '运行评测' }}
        </el-button>
        <el-button @click="formatJson">格式化</el-button>
        <el-button @click="clearResults">清空结果</el-button>
      </div>
    </el-card>

    <div v-if="result" ref="resultsSection" class="results-block">
      <div class="results-header">
        <div>
          <h3>评测结果</h3>
          <p>运行完成后，这里会展示聚合统计、分布概览和每次运行明细。</p>
        </div>
        <el-tag type="success" effect="plain">{{ result.config.totalRuns }} 次运行</el-tag>
      </div>

      <div class="summary-grid">
        <el-card class="summary-card summary-card--blue" shadow="hover">
          <div class="label">结构化成功率</div>
          <div class="value">{{ result.summary.structuredSuccessRate }}%</div>
        </el-card>
        <el-card class="summary-card summary-card--green" shadow="hover">
          <div class="label">Proposing 比例</div>
          <div class="value">{{ result.summary.proposingRate }}%</div>
        </el-card>
        <el-card class="summary-card summary-card--orange" shadow="hover">
          <div class="label">检查器通过率</div>
          <div class="value">{{ result.summary.checkerPassRate }}%</div>
        </el-card>
        <el-card class="summary-card summary-card--red" shadow="hover">
          <div class="label">平均 Attempt</div>
          <div class="value">{{ result.summary.avgAttemptCount }}</div>
        </el-card>
      </div>

      <el-card class="panel-card" shadow="hover">
        <template #header>
          <div class="panel-card__header">
            <span>分布概览</span>
            <span class="panel-card__meta">{{ result.config.totalRuns }} runs</span>
          </div>
        </template>

        <div class="distribution-grid">
          <div class="distribution-item">
            <div class="distribution-item__label">Prompt 版本</div>
            <div class="distribution-item__value">v{{ result.config.promptVersion || 'custom' }}</div>
          </div>
          <div class="distribution-item">
            <div class="distribution-item__label">失败次数</div>
            <div class="distribution-item__value">{{ result.summary.failureCount }}</div>
          </div>
          <div class="distribution-item distribution-item--wide">
            <div class="distribution-item__label">Parse Mode 分布</div>
            <div class="tag-row">
              <el-tag v-for="(count, key) in result.summary.parseModeDistribution" :key="key" size="small" effect="plain">
                {{ key }}: {{ count }}
              </el-tag>
            </div>
          </div>
          <div class="distribution-item distribution-item--wide">
            <div class="distribution-item__label">Failure Type 分布</div>
            <div class="tag-row">
              <el-tag v-for="(count, key) in result.summary.failureTypeDistribution" :key="key" size="small" effect="plain" type="warning">
                {{ key }}: {{ count }}
              </el-tag>
            </div>
          </div>
        </div>
      </el-card>

      <el-card class="panel-card" shadow="hover">
        <template #header>
          <div class="panel-card__header">
            <span>运行明细</span>
            <div class="table-filters">
              <el-checkbox v-model="showOnlyFailed" size="small">只看失败</el-checkbox>
              <el-input v-model="caseFilter" placeholder="搜索 Case" clearable size="small" style="width: 120px" />
            </div>
          </div>
        </template>

        <el-table :data="filteredResults" size="small" stripe>
          <el-table-column prop="caseName" label="Case" min-width="140" />
          <el-table-column prop="runIndex" label="Run" width="70" />
          <el-table-column label="结构化" width="100">
            <template #default="{ row }">
              <el-tag :type="row.debug.structuredOutputValid ? 'success' : 'danger'" size="small">
                {{ row.debug.structuredOutputValid ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="output.stage" label="Stage" width="120" />
          <el-table-column prop="debug.attemptCount" label="Attempt" width="90" />
          <el-table-column prop="debug.parseMode" label="Parse" width="110" />
          <el-table-column prop="debug.failureType" label="Failure" min-width="170" />
          <el-table-column prop="durationMs" label="耗时(ms)" width="100" />
          <el-table-column label="检查" width="80">
            <template #default="{ row }">
              <el-icon :color="allChecksPass(row) ? '#34d399' : '#f59e0b'" :size="18">
                <SuccessFilled v-if="allChecksPass(row)" />
                <WarningFilled v-else />
              </el-icon>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="selectResult(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <el-drawer v-model="detailVisible" title="运行详情" size="min(56%, 860px)" destroy-on-close>
      <template v-if="selectedResult">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="Case">{{ selectedResult.caseName }}</el-descriptions-item>
          <el-descriptions-item label="Run">#{{ selectedResult.runIndex }}</el-descriptions-item>
          <el-descriptions-item label="Stage">{{ selectedResult.output.stage }}</el-descriptions-item>
          <el-descriptions-item label="Confidence">{{ selectedResult.output.confidence }}</el-descriptions-item>
          <el-descriptions-item label="Parse Mode">{{ selectedResult.debug.parseMode }}</el-descriptions-item>
          <el-descriptions-item label="Attempt Count">{{ selectedResult.debug.attemptCount }}</el-descriptions-item>
          <el-descriptions-item label="Failure Type">{{ selectedResult.debug.failureType }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="selectedResult.debug.violations?.length" class="detail-block">
          <h4>Violations</h4>
          <div class="tag-row">
            <el-tag v-for="item in selectedResult.debug.violations" :key="item" type="warning" effect="plain">{{ item }}</el-tag>
          </div>
        </div>

        <div class="detail-block">
          <h4>用户可见输出</h4>
          <pre v-html="highlightJson(selectedResult.output.userVisible || '')"></pre>
        </div>

        <div class="detail-block">
          <h4>Attempts</h4>
          <div v-for="attempt in selectedResult.debug.attempts" :key="attempt.attemptIndex" class="attempt-card">
            <div class="attempt-card__meta">Attempt {{ attempt.attemptIndex }} · {{ attempt.parseMode }} · {{ attempt.failureType || 'none' }} · {{ attempt.structuredOutputValid ? 'valid' : 'invalid' }}</div>
            <div v-if="attempt.violations?.length" class="tag-row">
              <el-tag v-for="item in attempt.violations" :key="`${attempt.attemptIndex}-${item}`" type="warning" effect="plain" size="small">{{ item }}</el-tag>
            </div>
            <pre v-html="highlightJson(attempt.rawContent || '')"></pre>
          </div>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { MagicStick, SuccessFilled, WarningFilled } from '@element-plus/icons-vue';
import { adminAgentPromptsApi, adminPromptStabilityApi, type PromptStabilityEvalResult } from '@/api/adminApi';
import { toast } from '@/utils/toast';

interface PromptOption {
  id: string;
  label: string;
}

const form = ref({
  agentId: 'goal-conversation-agent',
  promptVersionId: '',
  customPrompt: '',
  model: '',
  repeatCount: 3
});

const promptOptions = ref<PromptOption[]>([]);
const running = ref(false);
const runningProgress = ref({ current: 0, total: 0 });
const selectedTemplate = ref('');
const detailVisible = ref(false);
const selectedResult = ref<PromptStabilityEvalResult | null>(null);
const result = ref<any | null>(null);
const resultsSection = ref<HTMLElement | null>(null);

const checkers = [
  { key: 'singleQuestionRule', label: '单问题约束', description: '检查用户可见输出中的问号数量是否不超过 1。' },
  { key: 'stageValid', label: 'Stage 合法性', description: '检查返回 stage 是否属于 understanding / proposing / ready / completed。' },
  { key: 'nextQuestionsSingle', label: 'nextQuestions 长度', description: '检查 nextQuestions 是否只保留 0-1 个问题。' },
  { key: 'noWrappedUserVisibleJson', label: '用户可见输出非 JSON 包裹', description: '检查 userVisible 没有被额外 JSON fenced block 包裹。' }
];

const exampleCases = [
  {
    name: '沟通收敛测试',
    previousState: {
      stage: 'understanding',
      confidence: 0.2,
      understanding: {
        surface_goal: '提高职场沟通能力'
      },
      collected: {
        surface_goal: '提高职场沟通能力'
      }
    },
    messages: [
      { role: 'user', content: '我想提高职场沟通能力' },
      { role: 'assistant', content: '你最想先改善哪个沟通场景？' },
      { role: 'user', content: '向上汇报总被说没重点、和同事沟通容易误会' }
    ]
  },
  {
    name: 'Excel 自动化测试',
    previousState: {
      stage: 'understanding',
      confidence: 0.25,
      understanding: {
        surface_goal: '用 Python 自动化处理 Excel 报表，每天节省时间',
        available_resources: {
          time_horizon: '每天',
          time_budget: ''
        },
        motivation: '节省每日处理Excel报表的时间',
        urgency: '中'
      },
      collected: {
        surface_goal: '用 Python 自动化处理 Excel 报表，每天节省时间',
        motivation: '节省每日处理Excel报表的时间',
        urgency: '中'
      }
    },
    messages: [
      { role: 'user', content: '我想用 Python 自动化处理 Excel 报表，每天能节省时间' },
      { role: 'assistant', content: '你目前处理的是哪种类型的 Excel 报表？' },
      { role: 'user', content: '固定格式的销售数据报表' },
      { role: 'assistant', content: '每天处理这个报表时，最花时间的是哪一步？' },
      { role: 'user', content: '数据清洗/格式整理' }
    ]
  }
];

const casesJson = ref(JSON.stringify(exampleCases, null, 2));

const templates = {
  communication: exampleCases[0],
  excel: exampleCases[1],
  basic: {
    name: '基础测试',
    previousState: { stage: 'understanding', confidence: 0 },
    messages: [
      { role: 'user', content: '我想学习一项新技能' }
    ]
  }
};

const applyTemplate = (templateKey: string) => {
  if (templateKey && templates[templateKey as keyof typeof templates]) {
    const templateArray = [templates[templateKey as keyof typeof templates]];
    casesJson.value = JSON.stringify(templateArray, null, 2);
  }
};

const loadPromptOptions = async () => {
  try {
    const response: any = await adminAgentPromptsApi.getPromptVersions({ agentId: form.value.agentId });
    const list = Array.isArray(response.data?.data?.list) ? response.data.data.list : [];
    promptOptions.value = list
      .map((item: any) => ({
        id: item.id,
        label: `v${item.version} · ${item.status || 'UNKNOWN'} · ${item.name || item.agentId}`
      }))
      .sort((a: PromptOption, b: PromptOption) => b.label.localeCompare(a.label));
  } catch (error) {
    console.error('加载 Prompt 列表失败:', error);
    toast.error('加载 Prompt 列表失败');
  }
};

const parseCases = () => {
  try {
    const parsed = JSON.parse(casesJson.value);
    if (!Array.isArray(parsed)) {
      throw new Error('测试脚本必须是数组');
    }
    return parsed;
  } catch (error: any) {
    throw new Error(error?.message || '测试脚本 JSON 不合法');
  }
};

const runEvaluation = async () => {
  try {
    running.value = true;
    const cases = parseCases();
    runningProgress.value = { current: 0, total: form.value.repeatCount * cases.length };

    const response: any = await adminPromptStabilityApi.run({
      agentId: form.value.agentId,
      promptVersionId: form.value.promptVersionId || undefined,
      customPrompt: form.value.customPrompt.trim() || undefined,
      model: form.value.model.trim() || undefined,
      repeatCount: form.value.repeatCount,
      cases
    });

    runningProgress.value = { current: runningProgress.value.total, total: runningProgress.value.total };
    result.value = response.data?.data || null;
    await nextTick();
    resultsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast.success('评测完成');
  } catch (error: any) {
    console.error('运行评测失败:', error);
    toast.error(error?.response?.data?.error?.message || error?.message || '运行评测失败');
  } finally {
    running.value = false;
  }
};

const formatJson = () => {
  try {
    casesJson.value = JSON.stringify(parseCases(), null, 2);
    toast.success('已格式化 JSON');
  } catch (error: any) {
    toast.error(error?.message || 'JSON 格式化失败');
  }
};

const clearResults = () => {
  result.value = null;
  selectedResult.value = null;
  detailVisible.value = false;
};

const loadExample = () => {
  casesJson.value = JSON.stringify(exampleCases, null, 2);
};

const selectResult = (row: PromptStabilityEvalResult) => {
  selectedResult.value = row;
  detailVisible.value = true;
};

const highlightJson = (json: string): string => {
  if (!json) return '';
  try {
    return json
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (true|false|null)/g, ': <span class="json-bool">$1</span>');
  } catch {
    return json;
  }
};

const showOnlyFailed = ref(false);
const caseFilter = ref('');

const filteredResults = computed(() => {
  let results = result.value?.results || [];
  if (showOnlyFailed.value) {
    results = results.filter(r => !r.debug.structuredOutputValid);
  }
  if (caseFilter.value) {
    results = results.filter(r => r.caseName.includes(caseFilter.value));
  }
  return results;
});

const allChecksPass = (row: any): boolean => {
  return row.checks.singleQuestionRule && row.checks.stageValid && row.checks.nextQuestionsSingle && row.checks.noWrappedUserVisibleJson;
};

watch(() => form.value.agentId, (newAgentId) => {
  if (newAgentId) {
    form.value.promptVersionId = '';
    promptOptions.value = [];
    void loadPromptOptions();
  }
});

onMounted(() => {
  void loadPromptOptions();
});
</script>

<style scoped>
.prompt-stability-page {
  position: relative;
  min-height: 100%;
}

.bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.15;
}

.bg-orb--1 {
  width: 460px;
  height: 460px;
  top: -180px;
  right: -120px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%);
  animation: orb-d 26s ease-in-out infinite;
}

.bg-orb--2 {
  width: 380px;
  height: 380px;
  left: -100px;
  top: 220px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
  animation: orb-d 30s ease-in-out infinite reverse;
}

@keyframes orb-d {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 30px) scale(0.95); }
}

.page-hero,
.panel-grid,
.editor-card,
.results-block {
  position: relative;
  z-index: 1;
}

.page-hero {
  margin-bottom: 1.5rem;
  padding: 24px 28px;
  border-radius: 20px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92));
  backdrop-filter: blur(16px);
}

.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 10%, white);
  color: var(--color-primary-dark, #1f57cc);
  font-size: 12px;
  font-weight: 700;
}

.page-hero__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.page-hero__subtitle {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.9375rem;
}

.title-icon {
  color: var(--color-primary);
}

.panel-grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 20px;
  margin-bottom: 20px;
}

.panel-card,
.editor-card {
  border-radius: 24px;
}

.panel-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
}

.panel-card__meta {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.field,
.config-form :deep(.el-select),
.config-form :deep(.el-input),
.config-form :deep(.el-textarea) {
  width: 100%;
}

.checker-list {
  display: grid;
  gap: 12px;
}

.checker-item {
  padding: 14px 16px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-surface) 90%, white);
  border: 1px solid var(--border-default);
}

.checker-item__name {
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.checker-item__desc {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.table-filters {
  display: flex;
  gap: 12px;
  align-items: center;
}

.json-key { color: #9cdcfe; }
.json-string { color: #ce9178; }
.json-number { color: #b5cea8; }
.json-bool { color: #569cd6; }

.editor-card {
  margin-bottom: 20px;
}

.editor-card__hint {
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.editor-card__actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.summary-card .label {
  color: var(--text-secondary);
  font-size: 13px;
}

.summary-card .value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 800;
  color: var(--text-primary);
}

.summary-card--blue {
  border-color: color-mix(in srgb, #60a5fa 18%, var(--border-default));
}

.summary-card--green {
  border-color: color-mix(in srgb, #34d399 18%, var(--border-default));
}

.summary-card--orange {
  border-color: color-mix(in srgb, #f59e0b 18%, var(--border-default));
}

.summary-card--red {
  border-color: color-mix(in srgb, #f87171 18%, var(--border-default));
}

.distribution-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.distribution-item {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--bg-surface) 92%, white);
}

.distribution-item--wide {
  grid-column: span 3;
}

.distribution-item__label {
  color: var(--text-secondary);
  font-size: 12px;
}

.distribution-item__value {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 800;
  color: var(--text-primary);
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.results-block {
  display: grid;
  gap: 20px;
}

.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--bg-surface) 92%, white);
  border: 1px solid var(--border-default);
}

.results-header h3 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 800;
  color: var(--text-primary);
}

.results-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.detail-block {
  margin-top: 18px;
}

.detail-block h4 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.detail-block pre,
.attempt-card pre {
  margin: 0;
  padding: 14px;
  border-radius: 16px;
  background: #0f172a;
  color: #dbeafe;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
}

.attempt-card {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.attempt-card__meta {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

@media (max-width: 1100px) {
  .panel-grid,
  .summary-grid,
  .distribution-grid {
    grid-template-columns: 1fr;
  }

  .results-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .distribution-item--wide {
    grid-column: span 1;
  }
}
</style>
