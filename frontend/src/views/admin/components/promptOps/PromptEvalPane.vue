<!--
  PromptEvalPane
  ============================================================
  - 评估集 CRUD（prompt_eval_cases）
  - 选 prompt 来源（ACTIVE / 草稿 / customPrompt 粘贴）+ 跑评估
  - 历史运行（prompt_eval_runs）+ 单次详情
  - 仅 skill:goal-conversation 支持多轮重复跑；其他 agent 给出明确提示
-->
<template>
  <div class="eval-pane">
    <el-alert
      v-if="!isGoalAgent"
      type="warning"
      :closable="false"
      show-icon
      class="non-goal-alert"
    >
      <template #title>当前 agent 不支持批量评估</template>
      <div style="font-size: 12.5px; line-height: 1.7">
        Phase 1 的轻量评测器仅对接 <code>skill:goal-conversation</code>。
        其他 agent 的稳定性评测需要在后端为该 agent 接入 checker 规则后才能开通——
        本期不做。建议在「编辑 Prompt」页签里使用「单条试跑」做快速验证。
      </div>
    </el-alert>

    <template v-else>
      <!-- 评估集 -->
      <section class="eval-section">
        <header class="eval-section__head">
          <h4>评估用例 ({{ evalCases.length }})</h4>
          <div style="display: flex; gap: 8px">
            <el-button size="small" @click="openImportSamplesDialog">📥 从最近调用导入</el-button>
            <el-button size="small" type="primary" @click="openCaseEditor()">+ 新增用例</el-button>
          </div>
        </header>
        <div v-if="evalCases.length === 0" class="eval-empty">
          还没有用例。给当前 agent 加几条「典型对话场景」作为黄金样本。
        </div>
        <ul v-else class="case-list">
          <li v-for="c in evalCases" :key="c.id" class="case-item">
            <div class="case-item__main">
              <div class="case-item__head">
                <code class="case-item__id">{{ c.caseId }}</code>
                <strong class="case-item__name">{{ c.name }}</strong>
                <el-switch
                  v-model="c.enabled"
                  size="small"
                  inline-prompt
                  active-text="启用"
                  inactive-text="停用"
                  @change="toggleEnabled(c)"
                />
              </div>
              <p v-if="c.description" class="case-item__desc">{{ c.description }}</p>
              <div class="case-item__messages">
                <span class="msg-pill">{{ c.messages.length }} 条消息</span>
                <span class="msg-preview">
                  最后一条: "{{ truncate(getLastMessage(c.messages), 60) }}"
                </span>
              </div>
              <div v-if="c.expectations" class="case-item__expectations">
                <span v-if="c.expectations.expectedStage" class="exp-chip">
                  阶段=<code>{{ c.expectations.expectedStage }}</code>
                </span>
                <span
                  v-for="f in c.expectations.mustIncludeFields || []"
                  :key="f"
                  class="exp-chip exp-chip--include"
                >必含: <code>{{ f }}</code></span>
                <span
                  v-for="p in c.expectations.mustNotInclude || []"
                  :key="p"
                  class="exp-chip exp-chip--exclude"
                >禁含: "{{ truncate(p, 20) }}"</span>
              </div>
            </div>
            <div class="case-item__actions">
              <el-button size="small" link @click="openCaseEditor(c)">编辑</el-button>
              <el-button size="small" link type="danger" @click="deleteCase(c)">删除</el-button>
            </div>
          </li>
        </ul>
      </section>

      <!-- 跑评估 -->
      <section class="eval-section">
        <header class="eval-section__head">
          <h4>运行评估</h4>
        </header>
        <div class="run-config">
          <el-form label-position="top" size="small">
            <div class="run-config__row">
              <el-form-item label="Prompt 来源">
                <el-select v-model="runConfig.source">
                  <el-option label="DB ACTIVE 版本" value="active" />
                  <el-option label="自定义（粘贴）" value="custom" />
                </el-select>
              </el-form-item>
              <el-form-item label="重复次数（每用例）">
                <el-input-number
                  v-model="runConfig.repeatCount"
                  :min="1"
                  :max="5"
                  size="small"
                />
              </el-form-item>
              <el-form-item label=" ">
                <el-button
                  type="primary"
                  size="small"
                  :loading="running"
                  :disabled="evalCases.filter((c) => c.enabled).length === 0 && !runConfig.customPrompt"
                  @click="runEval"
                >▶ 跑评估</el-button>
              </el-form-item>
            </div>

            <el-form-item v-if="runConfig.source === 'custom'" label="自定义 System Prompt">
              <el-input
                v-model="runConfig.customPrompt"
                type="textarea"
                :rows="6"
                placeholder="粘贴你正在调试的 prompt..."
              />
            </el-form-item>
          </el-form>
        </div>

        <!-- 即时结果 -->
        <div v-if="lastRunSummary" class="run-summary">
          <div class="run-summary__head">
            <h5>本次运行</h5>
            <span class="run-summary__time">
              {{ lastRunSummary.totalRuns }} 次调用 · {{ Math.round(lastRunSummary.avgDurationMs) }}ms 均延
            </span>
          </div>
          <div class="run-summary__metrics">
            <div :class="['metric', lastRunSummary.passRate >= 80 ? 'metric--ok' : 'metric--bad']">
              <span class="metric__v">{{ lastRunSummary.passRate }}%</span>
              <span class="metric__l">通过率</span>
            </div>
            <div class="metric metric--neutral">
              <span class="metric__v">{{ lastRunSummary.structuredSuccessRate }}%</span>
              <span class="metric__l">结构化成功</span>
            </div>
            <div class="metric metric--neutral">
              <span class="metric__v">{{ lastRunSummary.passedCount }}/{{ lastRunSummary.totalRuns }}</span>
              <span class="metric__l">通过/总计</span>
            </div>
          </div>
          <details class="run-results-details">
            <summary>逐条结果</summary>
            <ul>
              <li v-for="r in lastRunResults" :key="r.caseId + '-' + r.runIndex">
                <span :class="['run-tick', r.passed ? 'run-tick--pass' : 'run-tick--fail']">
                  {{ r.passed ? '✓' : '×' }}
                </span>
                <code>{{ r.caseId }}</code>
                <span class="run-stage">stage={{ r.output.stage }}</span>
                <span class="run-time">{{ r.durationMs }}ms</span>
                <details class="inline-checks">
                  <summary>检查项</summary>
                  <ul>
                    <li v-for="(passed, key) in r.checks" :key="key">
                      <code>{{ key }}</code>
                      <span :class="passed ? 'hit-y' : 'hit-n'">{{ passed ? '✓' : '×' }}</span>
                    </li>
                  </ul>
                </details>
              </li>
            </ul>
          </details>
        </div>
      </section>

      <!-- 历史 -->
      <section class="eval-section">
        <header class="eval-section__head">
          <h4>历史运行（最近 {{ evalRuns.length }} 次）</h4>
        </header>
        <div v-if="evalRuns.length === 0" class="eval-empty">还没有运行过。</div>
        <table v-else class="history-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>来源</th>
              <th>用例</th>
              <th>通过率</th>
              <th>结构化</th>
              <th>耗时</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in evalRuns" :key="r.id">
              <td>{{ formatTime(r.createdAt) }}</td>
              <td>
                <code class="src-chip">{{ r.promptSource }}</code>
                <span v-if="r.promptVersion"> v{{ r.promptVersion }}</span>
              </td>
              <td>{{ r.caseCount }}/{{ r.totalRuns }}</td>
              <td>
                <span :class="r.summary.passRate >= 80 ? 'pass-y' : 'pass-n'">
                  {{ r.summary.passRate ?? 0 }}%
                </span>
              </td>
              <td>{{ r.summary.structuredSuccessRate ?? 0 }}%</td>
              <td>{{ Math.round((r.durationMs || 0) / 1000) }}s</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- 从最近调用导入对话框 -->
    <el-dialog
      v-model="importDialogVisible"
      title="📥 从最近调用导入用例"
      width="800px"
      append-to-body
    >
      <p class="import-intro">
        从该 agent 最近的真实调用记录中挑几条作为评估用例。
        勾选后点「导入选中」即批量加入评估集，避免手动拼示例。
      </p>
      <div v-if="importSamplesLoading" class="import-loading">加载中…</div>
      <div v-else-if="importSamples.length === 0" class="import-empty">
        最近没有调用记录。先让用户跑一会儿，再回来取数据。
      </div>
      <ul v-else class="import-list">
        <li
          v-for="s in importSamples"
          :key="s.id"
          class="import-item"
          :class="{ 'import-item--checked': importSelected.has(s.id) }"
        >
          <label class="import-item__label">
            <input
              type="checkbox"
              :checked="importSelected.has(s.id)"
              @change="toggleImport(s.id)"
            />
            <div class="import-item__main">
              <div class="import-item__head">
                <span :class="['import-tick', s.success ? 'import-tick--ok' : 'import-tick--fail']">
                  {{ s.success ? '✓' : '×' }}
                </span>
                <span class="import-time">{{ formatTime(s.createdAt) }}</span>
                <span v-if="s.outputStage" class="import-stage">stage={{ s.outputStage }}</span>
                <span v-if="s.promptVersion" class="import-version">
                  v{{ s.promptVersion }}
                </span>
                <span class="import-duration">{{ s.durationMs }}ms</span>
              </div>
              <div class="import-input">{{ s.inputPreview || '（无输入预览）' }}</div>
              <div class="import-meta">
                {{ s.messages.length }} 条消息
                <span v-if="s.conversationId">· conv {{ s.conversationId.slice(0, 8) }}</span>
              </div>
            </div>
          </label>
        </li>
      </ul>
      <template #footer>
        <span style="margin-right: auto; color: #94a3b8; font-size: 12px">
          已选 {{ importSelected.size }} / {{ importSamples.length }}
        </span>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="importing"
          :disabled="importSelected.size === 0"
          @click="onImportSelected"
        >导入选中（{{ importSelected.size }}）</el-button>
      </template>
    </el-dialog>

    <!-- 用例编辑对话框 -->
    <el-dialog
      v-model="caseDialogVisible"
      :title="editingCase?.id ? '编辑用例' : '新增用例'"
      width="640px"
      append-to-body
    >
      <el-form v-if="editingCase" label-position="top" size="small">
        <div class="case-form__row">
          <el-form-item label="caseId" required>
            <el-input v-model="editingCase.caseId" placeholder="如 case-base-1" />
          </el-form-item>
          <el-form-item label="名称" required>
            <el-input v-model="editingCase.name" placeholder="如：基础理解 - 编程入门" />
          </el-form-item>
        </div>
        <el-form-item label="描述">
          <el-input v-model="editingCase.description" placeholder="（可选）" />
        </el-form-item>
        <el-form-item label="消息序列（最后一条必须是 user）" required>
          <div class="msg-list">
            <div
              v-for="(msg, idx) in editingCase.messages"
              :key="idx"
              class="msg-row"
            >
              <el-select v-model="msg.role" size="small" style="width: 110px">
                <el-option label="user" value="user" />
                <el-option label="assistant" value="assistant" />
              </el-select>
              <el-input
                v-model="msg.content"
                type="textarea"
                :rows="2"
                placeholder="消息内容"
              />
              <el-button
                size="small"
                link
                type="danger"
                :disabled="editingCase.messages.length === 1"
                @click="editingCase.messages.splice(idx, 1)"
              >×</el-button>
            </div>
            <el-button size="small" @click="editingCase.messages.push({ role: 'user', content: '' })">
              + 加消息
            </el-button>
          </div>
        </el-form-item>
        <details class="case-form__exp">
          <summary>期望（可选）</summary>
          <el-form-item label="期望阶段">
            <el-input
              v-model="editingCaseExp.expectedStage"
              placeholder="如 understanding / proposing / ready"
            />
          </el-form-item>
          <el-form-item label="必须包含字段（点回车添加）">
            <el-input
              v-model="newMustField"
              size="small"
              placeholder="如 internal.core.stage"
              @keyup.enter="addMustField"
            />
            <div class="exp-tags">
              <el-tag
                v-for="f in editingCaseExp.mustIncludeFields"
                :key="f"
                size="small"
                closable
                @close="
                  editingCaseExp.mustIncludeFields = editingCaseExp.mustIncludeFields.filter((x) => x !== f)
                "
              >{{ f }}</el-tag>
            </div>
          </el-form-item>
          <el-form-item label="禁止包含短语（点回车添加）">
            <el-input
              v-model="newMustNotPhrase"
              size="small"
              placeholder="如「（这一段保留供调试参考）」"
              @keyup.enter="addMustNotPhrase"
            />
            <div class="exp-tags">
              <el-tag
                v-for="p in editingCaseExp.mustNotInclude"
                :key="p"
                size="small"
                type="danger"
                closable
                @close="
                  editingCaseExp.mustNotInclude = editingCaseExp.mustNotInclude.filter((x) => x !== p)
                "
              >{{ p }}</el-tag>
            </div>
          </el-form-item>
        </details>
      </el-form>
      <template #footer>
        <el-button @click="caseDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="caseSaving" @click="saveCase">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { adminPromptOpsApi } from '@/api/adminApi';
import { toast } from '../../../../utils/toast';

interface Props {
  agent: any;
  evalCases: any[];
  evalRuns: any[];
  activePrompt: any | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'reload-cases'): void;
  (e: 'reload-runs'): void;
}>();

const isGoalAgent = computed(
  () => props.agent?.agentId === 'skill:goal-conversation'
);

const runConfig = ref({
  source: 'active' as 'active' | 'custom',
  customPrompt: '',
  repeatCount: 1,
});

const running = ref(false);
const lastRunSummary = ref<any>(null);
const lastRunResults = ref<any[]>([]);

const caseDialogVisible = ref(false);

// 导入最近调用样本
const importDialogVisible = ref(false);
const importSamplesLoading = ref(false);
const importSamples = ref<any[]>([]);
const importSelected = ref<Set<string>>(new Set());
const importing = ref(false);

async function openImportSamplesDialog() {
  importDialogVisible.value = true;
  importSelected.value = new Set();
  if (!props.agent?.agentId) return;
  importSamplesLoading.value = true;
  try {
    const r = await adminPromptOpsApi.getRecentCallSamples(props.agent.agentId, 30);
    importSamples.value = (r.data?.data || []).filter(
      (s: any) => Array.isArray(s.messages) && s.messages.length > 0
    );
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '加载样本失败');
    importSamples.value = [];
  } finally {
    importSamplesLoading.value = false;
  }
}

function toggleImport(id: string) {
  const next = new Set(importSelected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  importSelected.value = next;
}

async function onImportSelected() {
  if (importSelected.value.size === 0) return;
  importing.value = true;
  try {
    let count = 0;
    let failed = 0;
    for (const sampleId of Array.from(importSelected.value)) {
      const s = importSamples.value.find((x) => x.id === sampleId);
      if (!s) continue;
      try {
        await adminPromptOpsApi.createEvalCase({
          agentId: props.agent.agentId,
          caseId: `imported-${s.id.slice(0, 8)}-${Date.now().toString(36)}`,
          name: `导入 · ${formatTime(s.createdAt).slice(5)} · ${(s.inputPreview || '').slice(0, 24) || '无预览'}`,
          description: `从真实调用导入。conv=${s.conversationId || '-'}`,
          messages: s.messages,
          enabled: true,
        });
        count++;
      } catch {
        failed++;
      }
    }
    toast.success(`已导入 ${count} 条${failed ? `，${failed} 条失败` : ''}`);
    importDialogVisible.value = false;
    emit('reload-cases');
  } finally {
    importing.value = false;
  }
}
const caseSaving = ref(false);
const editingCase = ref<any>(null);
const editingCaseExp = ref({
  expectedStage: '',
  mustIncludeFields: [] as string[],
  mustNotInclude: [] as string[],
});
const newMustField = ref('');
const newMustNotPhrase = ref('');

function getLastMessage(messages: any[]): string {
  if (!Array.isArray(messages) || !messages.length) return '';
  return String(messages[messages.length - 1]?.content || '');
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatTime(value: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function openCaseEditor(c?: any) {
  if (c) {
    editingCase.value = JSON.parse(JSON.stringify(c));
    editingCaseExp.value = {
      expectedStage: c.expectations?.expectedStage || '',
      mustIncludeFields: c.expectations?.mustIncludeFields || [],
      mustNotInclude: c.expectations?.mustNotInclude || [],
    };
  } else {
    editingCase.value = {
      caseId: '',
      name: '',
      description: '',
      messages: [{ role: 'user', content: '' }],
    };
    editingCaseExp.value = {
      expectedStage: '',
      mustIncludeFields: [],
      mustNotInclude: [],
    };
  }
  caseDialogVisible.value = true;
}

function addMustField() {
  const v = newMustField.value.trim();
  if (v && !editingCaseExp.value.mustIncludeFields.includes(v)) {
    editingCaseExp.value.mustIncludeFields.push(v);
    newMustField.value = '';
  }
}

function addMustNotPhrase() {
  const v = newMustNotPhrase.value.trim();
  if (v && !editingCaseExp.value.mustNotInclude.includes(v)) {
    editingCaseExp.value.mustNotInclude.push(v);
    newMustNotPhrase.value = '';
  }
}

async function saveCase() {
  if (!editingCase.value) return;
  if (!editingCase.value.name?.trim()) {
    toast.error('请填名称');
    return;
  }
  const messages = (editingCase.value.messages || []).filter((m: any) => m.content?.trim());
  if (!messages.length) {
    toast.error('至少 1 条消息');
    return;
  }
  if (messages[messages.length - 1].role !== 'user') {
    toast.error('最后一条必须是 user');
    return;
  }
  const expectations = {
    expectedStage: editingCaseExp.value.expectedStage?.trim() || undefined,
    mustIncludeFields: editingCaseExp.value.mustIncludeFields.length
      ? editingCaseExp.value.mustIncludeFields
      : undefined,
    mustNotInclude: editingCaseExp.value.mustNotInclude.length
      ? editingCaseExp.value.mustNotInclude
      : undefined,
  };
  caseSaving.value = true;
  try {
    if (editingCase.value.id) {
      await adminPromptOpsApi.updateEvalCase(editingCase.value.id, {
        name: editingCase.value.name,
        description: editingCase.value.description,
        messages,
        expectations: hasContent(expectations) ? expectations : null,
      });
    } else {
      await adminPromptOpsApi.createEvalCase({
        agentId: props.agent.agentId,
        caseId: editingCase.value.caseId || `case-${Date.now().toString(36)}`,
        name: editingCase.value.name,
        description: editingCase.value.description || undefined,
        messages,
        expectations: hasContent(expectations) ? expectations : undefined,
      });
    }
    caseDialogVisible.value = false;
    toast.success('已保存');
    emit('reload-cases');
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '保存失败');
  } finally {
    caseSaving.value = false;
  }
}

function hasContent(o: any): boolean {
  if (!o) return false;
  return Object.values(o).some(
    (v) => v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  );
}

async function deleteCase(c: any) {
  try {
    await ElMessageBox.confirm(`删除用例「${c.name}」？`, '确认', {
      type: 'warning',
    });
    await adminPromptOpsApi.deleteEvalCase(c.id);
    toast.success('已删除');
    emit('reload-cases');
  } catch (err: any) {
    if (err === 'cancel') return;
    toast.error(err?.response?.data?.error?.message || '删除失败');
  }
}

async function toggleEnabled(c: any) {
  try {
    await adminPromptOpsApi.updateEvalCase(c.id, { enabled: c.enabled });
  } catch {
    toast.error('更新失败');
    c.enabled = !c.enabled;
  }
}

async function runEval() {
  running.value = true;
  lastRunSummary.value = null;
  lastRunResults.value = [];
  try {
    const payload: any = {
      agentId: props.agent.agentId,
      repeatCount: runConfig.value.repeatCount,
    };
    if (runConfig.value.source === 'custom') {
      if (!runConfig.value.customPrompt.trim()) {
        toast.error('请粘贴 customPrompt');
        running.value = false;
        return;
      }
      payload.customPrompt = runConfig.value.customPrompt;
    }
    const r = await adminPromptOpsApi.runEval(payload);
    lastRunSummary.value = r.data?.data?.summary;
    lastRunResults.value = r.data?.data?.results || [];
    toast.success(`完成：${lastRunSummary.value?.passedCount}/${lastRunSummary.value?.totalRuns} 通过`);
    emit('reload-runs');
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '评估失败');
  } finally {
    running.value = false;
  }
}

watch(
  () => props.agent?.agentId,
  () => {
    lastRunSummary.value = null;
    lastRunResults.value = [];
    runConfig.value.customPrompt = '';
  }
);
</script>

<style scoped>
.eval-pane {
  display: grid;
  gap: 18px;
}

.non-goal-alert code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  padding: 1px 5px;
  border-radius: 3px;
}

.eval-section {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  background: white;
}

.eval-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.eval-section__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  color: #1a2a44;
}

.eval-empty {
  padding: 20px;
  text-align: center;
  color: #94a3b8;
  font-size: 12.5px;
}

.case-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.case-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #f1f5f9;
}

.case-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.case-item__id {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  background: #e2e8f0;
  color: #475569;
  padding: 1px 5px;
  border-radius: 3px;
}

.case-item__name {
  font-size: 13px;
  color: #1a2a44;
}

.case-item__desc {
  margin: 4px 0;
  font-size: 12px;
  color: #62758f;
  line-height: 1.6;
}

.case-item__messages {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  margin: 4px 0;
}

.msg-pill {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  background: rgba(52, 120, 246, 0.08);
  color: #1e40af;
  padding: 1px 6px;
  border-radius: 3px;
}

.msg-preview {
  color: #94a3b8;
  font-style: italic;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-item__expectations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.exp-chip {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  background: #f1f5f9;
  color: #475569;
}

.exp-chip code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.95em;
  background: transparent;
  color: inherit;
  padding: 0;
}

.exp-chip--include {
  background: rgba(22, 163, 74, 0.08);
  color: #15803d;
}

.exp-chip--exclude {
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
}

.case-item__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.run-config {
  background: #f8fafc;
  padding: 12px 14px;
  border-radius: 8px;
}

.run-config__row {
  display: grid;
  grid-template-columns: 200px 200px 1fr;
  gap: 12px;
  align-items: end;
}

.run-summary {
  margin-top: 10px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.04), white);
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 12px 14px;
}

.run-summary__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.run-summary__head h5 {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  color: #1a2a44;
}

.run-summary__time {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #94a3b8;
}

.run-summary__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.metric {
  padding: 10px 12px;
  border-radius: 8px;
  text-align: center;
}

.metric--ok {
  background: rgba(22, 163, 74, 0.08);
}
.metric--ok .metric__v {
  color: #15803d;
}

.metric--bad {
  background: rgba(220, 38, 38, 0.08);
}
.metric--bad .metric__v {
  color: #b91c1c;
}

.metric--neutral {
  background: #f1f5f9;
}
.metric--neutral .metric__v {
  color: #1a2a44;
}

.metric__v {
  display: block;
  font-size: 22px;
  font-weight: 800;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.metric__l {
  font-size: 11px;
  color: #64748b;
}

.run-results-details {
  margin-top: 10px;
}

.run-results-details summary {
  cursor: pointer;
  font-size: 11.5px;
  color: #475569;
  font-weight: 600;
}

.run-results-details > ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}

.run-results-details > ul > li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 11.5px;
}

.run-tick {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 800;
  width: 16px;
  text-align: center;
}

.run-tick--pass {
  color: #15803d;
}

.run-tick--fail {
  color: #b91c1c;
}

.run-stage,
.run-time {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  color: #94a3b8;
}

.inline-checks summary {
  cursor: pointer;
  font-size: 10.5px;
  color: #64748b;
}

.inline-checks ul {
  margin: 4px 0 0;
  padding-left: 20px;
  list-style: none;
}

.inline-checks li {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
}

.inline-checks code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  background: transparent;
  color: #475569;
}

.hit-y {
  color: #15803d;
}

.hit-n {
  color: #b91c1c;
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.history-table th {
  text-align: left;
  font-weight: 700;
  font-size: 10.5px;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 6px 8px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.history-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}

.src-chip {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  background: #e2e8f0;
  color: #475569;
  padding: 1px 5px;
  border-radius: 3px;
}

.pass-y {
  color: #15803d;
  font-weight: 700;
}

.pass-n {
  color: #b91c1c;
  font-weight: 700;
}

.case-form__row {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 12px;
}

.case-form__exp {
  margin-top: 8px;
  background: #f8fafc;
  padding: 10px 12px;
  border-radius: 8px;
}

.case-form__exp summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 8px;
}

.msg-list {
  display: grid;
  gap: 6px;
}

.msg-row {
  display: grid;
  grid-template-columns: 110px 1fr 30px;
  gap: 8px;
  align-items: start;
}

.exp-tags {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* ============ 导入样本对话框 ============ */
.import-intro {
  margin: 0 0 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 12px;
  color: #475569;
  line-height: 1.7;
}

.import-loading,
.import-empty {
  padding: 30px;
  text-align: center;
  color: #94a3b8;
  font-size: 12.5px;
}

.import-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
  max-height: 480px;
  overflow-y: auto;
}

.import-item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  transition: all 0.1s ease;
}

.import-item:hover {
  background: #f1f5f9;
}

.import-item--checked {
  background: rgba(52, 120, 246, 0.06);
  border-color: #3478f6;
}

.import-item__label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  cursor: pointer;
}

.import-item__label input[type='checkbox'] {
  margin-top: 2px;
  cursor: pointer;
}

.import-item__main {
  flex: 1;
  min-width: 0;
}

.import-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
}

.import-tick {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 800;
  width: 16px;
  text-align: center;
}

.import-tick--ok { color: #15803d; }
.import-tick--fail { color: #b91c1c; }

.import-time {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #475569;
}

.import-stage,
.import-version,
.import-duration {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  background: white;
  padding: 1px 5px;
  border-radius: 3px;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

.import-input {
  margin-top: 4px;
  color: #1a2a44;
  font-size: 12px;
  line-height: 1.6;
}

.import-meta {
  margin-top: 4px;
  font-size: 10.5px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', Consolas, monospace;
}
</style>
