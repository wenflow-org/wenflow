<!--
  PromptEditPane
  ============================================================
  - 左：当前 ACTIVE 只读对照（File ↔ DB）
  - 右：草稿编辑器（大文本框 + 参数）
  - 顶部动作：从 ACTIVE fork / 选已有 DRAFT / 新空草稿
  - 底部：保存草稿 / 保存并发布
  - 监听 sessionStorage 中 AI 起草内容
-->
<template>
  <div class="edit-pane">
    <!-- 顶部动作条 -->
    <div class="edit-toolbar">
      <div class="edit-toolbar__left">
        <el-radio-group v-model="draftMode" size="small">
          <el-radio-button value="fork">基于 ACTIVE 修改</el-radio-button>
          <el-radio-button value="existing">选已有草稿</el-radio-button>
          <el-radio-button value="empty">空白起草</el-radio-button>
        </el-radio-group>
        <el-select
          v-if="draftMode === 'existing'"
          v-model="selectedDraftId"
          placeholder="选择草稿"
          size="small"
          style="width: 220px"
        >
          <el-option
            v-for="d in draftVersions"
            :key="d.id"
            :label="d.name"
            :value="d.id"
          >
            <el-tag size="small" effect="plain" type="info">v{{ d.version }}</el-tag>
            <span>{{ d.name }}</span>
          </el-option>
        </el-select>
        <span v-if="draftMode === 'fork'" class="toolbar-hint">
           <el-tag size="small" effect="plain" type="info">v{{ nextVersion }}</el-tag> 在当前 ACTIVE 基础上修改
        </span>
        <span v-if="draftMode === 'empty'" class="toolbar-hint">
          <el-tag size="small" effect="plain" type="info">v{{ nextVersion }}</el-tag> 完全空白
        </span>
      </div>
      <div class="edit-toolbar__right">
        <el-button size="small" @click="resetForm">重置</el-button>
        <el-button
          size="small"
          type="primary"
          :loading="saving"
          @click="onSaveDraft"
        >保存草稿</el-button>
        <el-button
          v-if="form.id"
          size="small"
          type="success"
          :loading="publishing"
          @click="$emit('publish', form.id)"
        >发布该版本</el-button>
      </div>
    </div>

    <!-- 双栏 -->
    <div :class="['edit-grid', { 'edit-grid--collapsed': refCollapsed }]">
      <!-- 左：参考（File / DB） -->
      <section class="edit-col edit-col--ref">
        <header class="edit-col__head" @click="refCollapsed = !refCollapsed" style="cursor: pointer">
          <h4>
            <span class="ref-toggle">{{ refCollapsed ? '▶' : '▼' }}</span>
            参考 · 当前生效
          </h4>
          <span v-if="!refCollapsed" class="edit-col__hint">
            File-as-Truth：<code>prompts/*.md</code> 是源
          </span>
        </header>

        <div v-show="!refCollapsed">
        <div
          v-if="!activePromptLoading && !agent.file && !activePrompt"
          class="edit-col__empty"
        >
          <el-alert type="warning" :closable="false" show-icon>
            <template #title>该 agent 当前在 File / DB 都没有 prompt</template>
            <div style="font-size: 12px">
              运行时只能依赖
              <code v-if="agent.tsFallback">{{ agent.tsFallback.constName }}</code>
              <span v-else>缺失的兜底常量</span>
              。建议先用「AI 起草」生成第一版。
            </div>
          </el-alert>
        </div>

        <div v-else class="ref-stack">
          <!-- File -->
          <article v-if="agent.file" class="ref-card">
            <header class="ref-card__head">
              <span class="ref-card__tag ref-card__tag--file">FILE</span>
              <code class="ref-card__path">{{ agent.file.path }}</code>
              <span class="ref-card__meta">
                {{ agent.file.charCount }} 字
              </span>
            </header>
            <pre class="ref-card__body">{{ agent.file.preview }}</pre>
            <div class="ref-card__actions">
              <el-button
                size="small"
                link
                type="primary"
                @click="loadFullText('file')"
              >展开全文</el-button>
            </div>
          </article>

          <!-- DB ACTIVE -->
          <article v-if="activePrompt" class="ref-card">
            <header class="ref-card__head">
              <span class="ref-card__tag ref-card__tag--db">DB ACTIVE</span>
              <span class="ref-card__path"><el-tag size="small" effect="plain" type="info">v{{ activePrompt.version }}</el-tag> {{ activePrompt.name }}</span>
              <span class="ref-card__meta">
                T={{ activePrompt.temperature ?? '—' }} ·
                Max={{ activePrompt.maxTokens ?? '—' }} ·
                {{ (activePrompt.systemPrompt || '').length }} 字
              </span>
            </header>
            <pre class="ref-card__body">{{ truncatePromptText(activePrompt.systemPrompt) }}</pre>
            <div class="ref-card__actions">
              <el-button
                size="small"
                link
                type="primary"
                @click="loadFullText('db')"
              >展开全文</el-button>
              <el-button
                size="small"
                link
                @click="copyToDraft(activePrompt.systemPrompt)"
              >→ 复制到草稿</el-button>
            </div>
          </article>

          <!-- Drift 提示 -->
          <el-alert
            v-if="agent.drift === 'file-vs-db-mismatch'"
            type="warning"
            :closable="false"
            show-icon
          >
            <template #title>File 与 DB ACTIVE 内容不一致</template>
            <div style="font-size: 12px; line-height: 1.7">
              文件改了但 DB 还没同步，或反过来。
              下一次服务重启会按 File-as-Truth 同步策略 ARCHIVE 当前 ACTIVE 并以文件为准。
            </div>
          </el-alert>
        </div>
        </div>
      </section>
      <section class="edit-col edit-col--editor">
        <header class="edit-col__head">
          <h4>草稿 {{ form.id ? `· 编辑 v${form.version}` : '· 新建' }}</h4>
          <span v-if="aiDraftSourceFlag" class="edit-col__ai">
            AI 起草内容已注入
          </span>
        </header>

        <!-- 编辑器工具栏（移至顶部，不在 form-item 内） -->
        <div class="editor-toolbar">
          <el-radio-group v-model="editorMode" size="small">
            <el-radio-button value="sectioned">
              分块
              <span v-if="schemaLintBadge" :class="['mini-lint', schemaLintBadge.ok ? 'mini-lint--ok' : 'mini-lint--warn']">
                {{ schemaLintBadge.text }}
              </span>
            </el-radio-button>
            <el-radio-button value="edit">文本</el-radio-button>
            <el-radio-button value="diff" :disabled="!activePrompt">
              Diff
            </el-radio-button>
            <el-radio-button value="outline">大纲</el-radio-button>
          </el-radio-group>
          <div class="editor-toolbar__right">
            <el-button
              size="small"
              link
              type="primary"
              @click="findDialogOpen = !findDialogOpen"
            >查找/替换</el-button>
            <span class="editor-meta">
              {{ form.systemPrompt.length }} 字 ·
              {{ lineCount }} 行
              <span v-if="charDelta !== null" :class="charDelta > 0 ? 'delta-up' : 'delta-down'">
                {{ charDelta > 0 ? '+' : '' }}{{ charDelta }} vs ACTIVE
              </span>
            </span>
          </div>
        </div>

        <el-form label-position="top" size="small" class="draft-form">
          <div class="draft-form__row">
            <el-form-item label="名称" required>
              <el-input
                v-model="form.name"
                placeholder="如：v8-加强目标确认"
              />
            </el-form-item>
            <el-form-item label="备注">
              <el-input
                v-model="form.description"
                placeholder="本次改动的目的（可选）"
              />
            </el-form-item>
          </div>

          <el-form-item label="System Prompt" required>

            <!-- 查找替换面板 -->
            <div v-if="findDialogOpen" class="find-panel">
              <el-input
                v-model="findText"
                size="small"
                placeholder="查找"
                clearable
                style="width: 220px"
                @keyup.enter="onFindNext"
              />
              <el-input
                v-model="replaceText"
                size="small"
                placeholder="替换为（可选）"
                clearable
                style="width: 220px"
              />
              <el-button size="small" @click="onFindNext">下一个</el-button>
              <el-button size="small" @click="onReplaceCurrent" :disabled="!findText">
                替换
              </el-button>
              <el-button size="small" type="primary" @click="onReplaceAll" :disabled="!findText">
                全部替换 ({{ matchCount }})
              </el-button>
              <el-button size="small" link @click="findDialogOpen = false">关闭</el-button>
            </div>

            <!-- 编辑模式 -->
            <!-- 分块模式 -->
            <div v-show="editorMode === 'sectioned'" class="sectioned-mode">
              <div v-if="schemaLoading" class="sectioned-loading">
                正在解析 prompt 结构…
              </div>
              <div v-else-if="!schemaData" class="sectioned-empty">
                没有可解析的 prompt。先在「文本」模式写一些内容。
              </div>
              <SectionedPromptEditor
                v-else
                :schema="schemaData.schema"
                :suggested-rule-prefix="schemaData.suggestedRulePrefix"
                :field-stage="schemaData.fieldGovernanceStage || null"
                :agent-id="props.agent?.agentId || ''"
                @change="onSectionedChange"
                @field-created="loadSchemaForCurrentDraft"
              />
            </div>

            <!-- 文本模式 -->
            <div v-show="editorMode === 'edit'" class="editor-wrap">
              <div class="editor-gutter">
                <div
                  v-for="n in lineCount"
                  :key="n"
                  class="editor-gutter__line"
                  :class="{ 'editor-gutter__line--active': n === currentLine }"
                >{{ n }}</div>
              </div>
              <textarea
                ref="textareaRef"
                v-model="form.systemPrompt"
                class="editor-textarea"
                :placeholder="textareaPlaceholder"
                spellcheck="false"
                @scroll="syncGutterScroll"
                @keyup="updateCurrentLine"
                @click="updateCurrentLine"
              />
            </div>

            <!-- Diff 模式 -->
            <div v-show="editorMode === 'diff'" class="diff-wrap">
              <div class="diff-head">
                <span class="diff-label diff-label--old">- ACTIVE v{{ activePrompt?.version }}</span>
                <span class="diff-label diff-label--new">+ 草稿</span>
                <span class="diff-stat">
                  +{{ diffStats.added }} 行 · -{{ diffStats.removed }} 行 ·
                  {{ diffStats.unchanged }} 行不变
                </span>
              </div>
              <div class="diff-body">
                <div
                  v-for="(line, idx) in diffLines"
                  :key="idx"
                  :class="['diff-line', `diff-line--${line.type}`]"
                >
                  <span class="diff-marker">{{
                    line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
                  }}</span>
                  <span class="diff-content">{{ line.text || ' ' }}</span>
                </div>
                <div v-if="diffLines.length === 0" class="diff-empty">
                  没有差异，草稿与 ACTIVE 完全一致。
                </div>
              </div>
            </div>

            <!-- 大纲模式 -->
            <div v-show="editorMode === 'outline'" class="outline-wrap">
              <div v-if="outline.length === 0" class="outline-empty">
                没有识别到段落标题。Prompt 里可以用「【XX】」「## XX」「[XX]」格式作为段落标题，本视图会自动抽取。
              </div>
              <ul v-else class="outline-list">
                <li
                  v-for="item in outline"
                  :key="item.lineNumber"
                  class="outline-item"
                  :class="`outline-item--${item.level}`"
                  @click="jumpToLine(item.lineNumber)"
                >
                  <span class="outline-line-no">L{{ item.lineNumber }}</span>
                  <span class="outline-text">{{ item.text }}</span>
                </li>
              </ul>
            </div>
          </el-form-item>

          <!-- 
            运行时参数已移至"模型运行时" Tab 统一配置
            Temperature/MaxTokens/Model 不再在 Prompt 版本中设置
            请在 AgentEditor 的"模型运行时" Tab 中配置 Skill 独立参数
          -->
          <el-alert
            type="info"
            :closable="false"
            show-icon
            style="margin-bottom: 16px;"
          >
            <template #title>
              运行时参数配置已迁移
            </template>
            <p style="margin: 0; font-size: 13px; line-height: 1.5;">
              Temperature、MaxTokens、Model 等参数现在统一在 <strong>"模型运行时" Tab</strong> 中配置。<br>
              Prompt 版本中的参数已废弃，不再影响实际运行。
            </p>
          </el-alert>
        </el-form>

        <div v-if="draftVersions.length > 0" class="draft-list">
          <header class="draft-list__head">
            <h5>草稿历史（{{ draftVersions.length }}）</h5>
          </header>
          <ul>
            <li v-for="d in draftVersions" :key="d.id">
              <span class="draft-row__v">v{{ d.version }}</span>
              <span class="draft-row__name">{{ d.name }}</span>
              <span class="draft-row__time">{{ formatTime(d.updatedAt) }}</span>
              <el-button size="small" link type="primary" @click="loadDraft(d.id)">
                打开
              </el-button>
              <el-button size="small" link type="danger" @click="$emit('delete', d.id)">
                删除
              </el-button>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <!-- 全文对话框 -->
    <el-dialog
      v-model="fullTextDialog.visible"
      :title="fullTextDialog.title"
      width="60%"
      append-to-body
    >
      <div v-if="fullTextDialog.version" class="full-text-meta">
        <el-tag size="small" type="info">DB ACTIVE</el-tag>
        <el-tag size="small" effect="plain">{{ fullTextDialog.version }}</el-tag>
      </div>
      <pre class="full-text">{{ fullTextDialog.content }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { adminAgentPromptsApi, adminPromptOpsApi } from '@/api/adminApi';
import { toast } from '../../../../utils/toast';
import SectionedPromptEditor from './SectionedPromptEditor.vue';

interface Props {
  agent: any;
  promptVersions: any[];
  activePrompt: any | null;
  activePromptLoading: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'reload'): void;
  (e: 'publish', id: string): void;
  (e: 'save-draft', payload: any): void;
  (e: 'delete', id: string): void;
}>();

const draftMode = ref<'fork' | 'existing' | 'empty'>('fork');
const refCollapsed = ref(false);
const selectedDraftId = ref<string>('');
const saving = ref(false);
const publishing = ref(false);
const aiDraftSourceFlag = ref(false);

const form = ref({
  id: '',
  version: 0,
  name: '',
  description: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 4000,
});

const fullTextDialog = ref({
  visible: false,
  title: '',
  version: '',
  content: '',
});

const draftVersions = computed(() =>
  (props.promptVersions || []).filter((v: any) => v.status === 'DRAFT')
);

const nextVersion = computed(() => {
  const versions = props.promptVersions || [];
  const max = versions.reduce(
    (m: number, v: any) => Math.max(m, Number(v.version) || 0),
    0
  );
  return max + 1;
});

const charDelta = computed(() => {
  if (!props.activePrompt?.systemPrompt) return null;
  return form.value.systemPrompt.length - props.activePrompt.systemPrompt.length;
});

// ============================================================
// 编辑器：模式 / 行号 / 查找替换 / 大纲 / Diff
// ============================================================
const editorMode = ref<'sectioned' | 'edit' | 'diff' | 'outline'>('sectioned');

// =========== Sectioned 视图状态 ===========
const schemaLoading = ref(false);
const schemaData = ref<{
  schema: any;
  suggestedRulePrefix: string;
  source: 'db' | 'file' | 'none';
  fieldGovernanceStage?: string | null;
} | null>(null);
const schemaLintBadge = computed(() => {
  if (!schemaData.value) return null;
  const s = schemaData.value.schema;
  if (s.conformant && s.warnings.length === 0) {
    return { ok: true, text: '✓' };
  }
  return { ok: false, text: '⚠' + (s.warnings.length || '') };
});

async function loadSchemaForCurrentDraft() {
  if (!props.agent?.agentId) return;
  schemaLoading.value = true;
  try {
    const r = await adminPromptOpsApi.getPromptSchema(props.agent.agentId);
    schemaData.value = r.data?.data || null;
    // 仅当 form.systemPrompt 与后端 promptText 确实不同时（用户真改过）才用客户端重解析 lint；
    // 且必须保留后端的 v2 字段（blocks / wfBlocks / archetype），否则字段表/分权锁/徽章会失效。
    const backendText = r.data?.data?.promptText || '';
    if (
      form.value.systemPrompt &&
      schemaData.value &&
      form.value.systemPrompt.trim() !== backendText.trim()
    ) {
      const v1 = parseSchemaClient(form.value.systemPrompt);
      schemaData.value = {
        ...schemaData.value,
        schema: { ...schemaData.value.schema, ...v1 },
      };
    }
  } catch {
    schemaData.value = null;
  } finally {
    schemaLoading.value = false;
  }
}

// 客户端轻量再解析（只在用户改了 prompt 后重做 lint，不调后端）
function parseSchemaClient(promptText: string) {
  const text = (promptText || '').replace(/\r\n/g, '\n').trim();
  const h1Match = (text.split('\n', 1)[0] || '').match(/^#\s+(.+?)\s*$/);
  const title = h1Match ? h1Match[1] : null;

  const lines = text.split('\n');
  const sections: Array<{ heading: string; body: string[] }> = [];
  let currentHeading = '';
  let currentBody: string[] = [];
  let inSection = false;
  const preludeLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (inSection) sections.push({ heading: currentHeading, body: currentBody });
      currentHeading = m[1].trim();
      currentBody = [];
      inSection = true;
    } else if (inSection) {
      currentBody.push(l);
    } else {
      if (i === 0 && h1Match) continue;
      preludeLines.push(l);
    }
  }
  if (inSection) sections.push({ heading: currentHeading, body: currentBody });

  let identity = '';
  let rulesRaw = '';
  let output = '';
  const extras: any[] = [];
  sections.forEach((s, idx) => {
    const cat = classifySectionClient(s.heading);
    const body = s.body.join('\n').trim();
    if (cat === 'identity' && !identity) identity = body;
    else if (cat === 'rules' && !rulesRaw) rulesRaw = body;
    else if (cat === 'output' && !output) output = body;
    else extras.push({ heading: s.heading, body, order: idx });
  });
  const preludeText = preludeLines.join('\n').trim();
  if (!identity && preludeText) identity = preludeText;

  const rules = parseRuleItemsClient(rulesRaw);
  const warnings: string[] = [];
  if (!identity) warnings.push('缺少 ## 身份定义 段落');
  if (!rulesRaw) warnings.push('缺少 ## 执行规则 段落');
  if (!output) warnings.push('缺少 ## 输出规格 段落');
  if (rulesRaw && rules.length === 0)
    warnings.push('执行规则段没有 R-XX-NN 编号项');
  const conformant = !!identity && !!rulesRaw && !!output && rules.length > 0;
  return {
    title,
    identity,
    rulesRaw,
    rules,
    output,
    extras,
    conformant,
    warnings,
  };
}

function classifySectionClient(heading: string): string {
  // 与后端 prompt-schema 的 HEADING_ALIASES 精确对齐：按标准标题表查，不再模糊正则猜。
  // 后端是唯一权威；此处仅用于编辑时的轻量 lint 预览（保存后以后端 schema 为准）。
  const t = heading.trim()
  const TABLE: Record<string, string> = {
    身份定义: 'identity',
    身份说明: 'identity',
    角色定义: 'identity',
    输入说明: 'input',
    输入约定: 'input',
    执行规则: 'rules',
    行为准则: 'rules',
    设计原则: 'rules',
    评估原则: 'rules',
    状态机: 'state_machine',
    阶段定义: 'state_machine',
    阶段推进门槛: 'state_machine',
    输出规格: 'output',
    输出格式: 'output',
    输出说明: 'output',
    返回格式: 'output',
    边界约束: 'constraints',
    禁止事项: 'constraints',
    质量控制: 'quality',
    评分参考: 'quality',
    最终自检: 'quality',
    示例: 'examples',
    样例: 'examples'
  }
  return TABLE[t] || 'extras'
}

function parseRuleItemsClient(raw: string) {
  const lines = (raw || '').split('\n');
  const result: any[] = [];
  for (const line of lines) {
    const m = /^\s*(R-([A-Z]+)-(\d+))\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (m) {
      result.push({
        id: m[1],
        prefix: m[2],
        index: parseInt(m[3], 10),
        text: m[4],
      });
    }
  }
  return result;
}

function onSectionedChange(payload: { systemPrompt: string; rules: any[] }) {
  form.value.systemPrompt = payload.systemPrompt;
  // 客户端 lint 刷新：只更新 v1 lint 字段，保留后端 v2 字段（blocks/wfBlocks/archetype），
  // 否则编辑器会从 v2 分块模式回退到 v1，字段表/分权锁丢失。
  if (schemaData.value) {
    const v1 = parseSchemaClient(payload.systemPrompt);
    schemaData.value = {
      ...schemaData.value,
      schema: {
        ...schemaData.value.schema,
        conformant: v1.conformant,
        warnings: v1.warnings,
      },
    };
  }
}
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const currentLine = ref(1);
const findDialogOpen = ref(false);
const findText = ref('');
const replaceText = ref('');

const textareaPlaceholder =
  '在这里写 system prompt…\n变量插值用 {{ var }}（如该 agent 支持）';

const lineCount = computed(() => {
  const text = form.value.systemPrompt || '';
  const n = text.split('\n').length;
  return Math.max(1, n);
});

function updateCurrentLine(e: Event) {
  const ta = e.target as HTMLTextAreaElement;
  if (!ta) return;
  const pos = ta.selectionStart || 0;
  const before = ta.value.slice(0, pos);
  currentLine.value = (before.match(/\n/g) || []).length + 1;
}

function syncGutterScroll(e: Event) {
  const ta = e.target as HTMLTextAreaElement;
  const gutter = ta?.parentElement?.querySelector('.editor-gutter') as HTMLElement;
  if (gutter) gutter.scrollTop = ta.scrollTop;
}

// 查找
const matchCount = computed(() => {
  const q = findText.value;
  if (!q) return 0;
  const text = form.value.systemPrompt || '';
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(q, idx)) !== -1) {
    count++;
    idx += q.length;
  }
  return count;
});

let lastFindIndex = -1;
function onFindNext() {
  if (!findText.value || !textareaRef.value) return;
  const text = form.value.systemPrompt || '';
  const startPos = lastFindIndex + 1;
  let pos = text.indexOf(findText.value, startPos);
  if (pos === -1) pos = text.indexOf(findText.value, 0);
  if (pos === -1) {
    toast.info?.('未找到匹配');
    return;
  }
  lastFindIndex = pos;
  textareaRef.value.focus();
  textareaRef.value.setSelectionRange(pos, pos + findText.value.length);
  // 滚到该位置
  const linesBefore = text.slice(0, pos).split('\n').length;
  const lineHeight = 22; // 与 CSS line-height 对齐
  textareaRef.value.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);
}

function onReplaceCurrent() {
  if (!findText.value || !textareaRef.value) return;
  const ta = textareaRef.value;
  const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
  if (sel === findText.value) {
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    form.value.systemPrompt = before + replaceText.value + after;
    lastFindIndex = before.length + replaceText.value.length - 1;
  } else {
    onFindNext();
  }
}

function onReplaceAll() {
  if (!findText.value) return;
  const before = form.value.systemPrompt;
  const after = before.split(findText.value).join(replaceText.value);
  if (before === after) return;
  form.value.systemPrompt = after;
  toast.success(`已替换 ${matchCount.value} 处`);
}

// 大纲：从 prompt 抽段落标题
interface OutlineItem {
  lineNumber: number;
  text: string;
  level: 'h1' | 'h2' | 'block';
}
const outline = computed<OutlineItem[]>(() => {
  const text = form.value.systemPrompt || '';
  const lines = text.split('\n');
  const result: OutlineItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // ## 标题 / # 标题
    if (/^#{1,6}\s+/.test(line)) {
      const level = (line.match(/^#+/) || [''])[0].length;
      result.push({
        lineNumber: i + 1,
        text: line.replace(/^#+\s*/, ''),
        level: level <= 1 ? 'h1' : level <= 2 ? 'h2' : 'block',
      });
      continue;
    }
    // 【段落】 / 【XXX】（行首）
    const cnBracket = line.match(/^[【〔[](.{1,30}?)[】〕\]]\s*[:：]?\s*$/);
    if (cnBracket) {
      result.push({ lineNumber: i + 1, text: cnBracket[1], level: 'block' });
      continue;
    }
    // 段落内的 【XXX】 也算 block
    const inlineBracket = line.match(/^【(.{1,30}?)】/);
    if (inlineBracket) {
      result.push({ lineNumber: i + 1, text: inlineBracket[1], level: 'block' });
      continue;
    }
  }
  return result;
});

function jumpToLine(lineNumber: number) {
  editorMode.value = 'edit';
  void nextTick(() => {
    const ta = textareaRef.value;
    if (!ta) return;
    const text = form.value.systemPrompt || '';
    const lines = text.split('\n');
    let pos = 0;
    for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
      pos += lines[i].length + 1;
    }
    ta.focus();
    ta.setSelectionRange(pos, pos + (lines[lineNumber - 1] || '').length);
    const lineHeight = 22;
    ta.scrollTop = Math.max(0, (lineNumber - 5) * lineHeight);
    currentLine.value = lineNumber;
  });
}

// Diff：极简的逐行对比（基于 LCS 思路简化版）
interface DiffLine {
  type: 'add' | 'del' | 'eq';
  text: string;
}
const diffLines = computed<DiffLine[]>(() => {
  const old = (props.activePrompt?.systemPrompt || '').split('\n');
  const next = (form.value.systemPrompt || '').split('\n');
  return computeLineDiff(old, next);
});

const diffStats = computed(() => {
  let added = 0, removed = 0, unchanged = 0;
  for (const d of diffLines.value) {
    if (d.type === 'add') added++;
    else if (d.type === 'del') removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
});

function computeLineDiff(a: string[], b: string[]): DiffLine[] {
  // LCS 表
  const m = a.length, n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // 回溯
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'eq', text: a[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.unshift({ type: 'del', text: a[i - 1] });
      i--;
    } else {
      result.unshift({ type: 'add', text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    result.unshift({ type: 'del', text: a[--i] });
  }
  while (j > 0) {
    result.unshift({ type: 'add', text: b[--j] });
  }
  // 折叠：完全相同 → 不显示
  // 但保留差异行附近的上下文
  const filtered: DiffLine[] = [];
  for (let k = 0; k < result.length; k++) {
    const cur = result[k];
    if (cur.type !== 'eq') {
      filtered.push(cur);
      continue;
    }
    // 如果前后 2 行内有差异，保留作为上下文
    const nearby = result
      .slice(Math.max(0, k - 2), Math.min(result.length, k + 3))
      .some((d) => d.type !== 'eq');
    if (nearby) filtered.push(cur);
  }
  return filtered;
}

function truncatePromptText(text: string): string {
  if (!text) return '';
  if (text.length <= 600) return text;
  return text.slice(0, 600) + '\n...（点「展开全文」查看完整内容）';
}

function formatTime(value: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function applyMode() {
  if (draftMode.value === 'fork') {
    if (props.activePrompt) {
      form.value = {
        id: '',
        version: nextVersion.value,
        name: `v${nextVersion.value}-${(props.activePrompt.name || 'draft').replace(/^v\d+-/, '')}`,
        description: '',
        systemPrompt: props.activePrompt.systemPrompt || '',
        temperature: props.activePrompt.temperature ?? 0.7,
        maxTokens: props.activePrompt.maxTokens ?? 4000,
      };
    } else if (props.agent?.file) {
      // 没 ACTIVE 用 file：preview 已被后端截断，从 prompt-schema 接口取完整 promptText 作为起点
      let fullText = props.agent.file.preview || '';
      try {
        const r = await adminPromptOpsApi.getPromptSchema(props.agent.agentId);
        const pt = r.data?.data?.promptText;
        if (typeof pt === 'string' && pt.length > 0) fullText = pt;
      } catch {
        // 取不到时回退到 preview
      }
      form.value = {
        id: '',
        version: nextVersion.value,
        name: `v${nextVersion.value}-from-file`,
        description: '',
        systemPrompt: fullText,
        temperature: props.agent.file.temperature ?? 0.7,
        maxTokens: props.agent.file.maxTokens ?? 4000,
      };
    } else {
      resetForm();
    }
  } else if (draftMode.value === 'empty') {
    form.value = {
      id: '',
      version: nextVersion.value,
      name: `v${nextVersion.value}-blank`,
      description: '',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 4000,
    };
  }
}

async function loadDraft(id: string) {
  try {
    const r = await adminAgentPromptsApi.getPromptDetail(id);
    const d = r.data?.data;
    if (!d) return;
    form.value = {
      id: d.id,
      version: d.version,
      name: d.name || '',
      description: d.description || '',
      systemPrompt: d.systemPrompt || '',
      temperature: d.temperature ?? 0.7,
      maxTokens: d.maxTokens ?? 4000,
    };
    selectedDraftId.value = id;
    draftMode.value = 'existing';
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '草稿加载失败');
  }
}

function resetForm() {
  form.value = {
    id: '',
    version: nextVersion.value,
    name: '',
    description: '',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4000,
  };
  selectedDraftId.value = '';
  aiDraftSourceFlag.value = false;
}

function onSaveDraft() {
  if (!form.value.systemPrompt.trim()) {
    toast.error('System Prompt 不能为空');
    return;
  }
  if (!form.value.name.trim()) {
    toast.error('请填名称');
    return;
  }
  saving.value = true;
  emit('save-draft', {
    id: form.value.id || undefined,
    agentId: props.agent.agentId,
    name: form.value.name,
    description: form.value.description,
    systemPrompt: form.value.systemPrompt,
    temperature: form.value.temperature,
    maxTokens: form.value.maxTokens,
  });
  setTimeout(() => {
    saving.value = false;
  }, 1500);
}

async function loadFullText(source: 'file' | 'db') {
  if (source === 'db' && props.activePrompt) {
    fullTextDialog.value = {
      visible: true,
      title: `${props.activePrompt.name}`,
      version: `v${props.activePrompt.version}`,
      content: props.activePrompt.systemPrompt,
    };
  } else if (source === 'file' && props.agent.file) {
    // file.preview 在后端被截断到 240 字，这里走 prompt-schema 接口取完整 promptText
    let fullText = props.agent.file.preview || '';
    try {
      const r = await adminPromptOpsApi.getPromptSchema(props.agent.agentId);
      const pt = r.data?.data?.promptText;
      if (typeof pt === 'string' && pt.length > 0) fullText = pt;
    } catch {
      // 取不到时回退到 preview
    }
    fullTextDialog.value = {
      visible: true,
      title: `FILE · ${props.agent.file.path}`,
      version: '',
      content: fullText,
    };
  }
}

function copyToDraft(text: string) {
  draftMode.value = 'fork';
  form.value.systemPrompt = text || '';
  toast.success('已复制到草稿');
}

// 监听 AI 起草
function checkAIDraft() {
  if (!props.agent?.agentId) return;
  const key = `promptOps:ai-draft:${props.agent.agentId}`;
  const draft = sessionStorage.getItem(key);
  if (draft) {
    form.value.systemPrompt = draft;
    form.value.name =
      form.value.name || `v${nextVersion.value}-ai-draft`;
    aiDraftSourceFlag.value = true;
    sessionStorage.removeItem(key);
    draftMode.value = 'empty';
  }
}

watch(
  () => selectedDraftId.value,
  (next) => {
    if (next) {
      void loadDraft(next);
    }
  }
);

watch(
  () => draftMode.value,
  () => {
    void applyMode();
  }
);

watch(
  () => props.activePrompt,
  () => {
    if (draftMode.value === 'fork' && !form.value.id) {
      void applyMode();
    }
  },
  { deep: true }
);

watch(
  () => props.agent?.agentId,
  () => {
    // 切换 skill 时把模式回到 fork，并清掉 form.id 让 watch activePrompt 在新数据到位时重填
    draftMode.value = 'fork';
    form.value.id = '';
    selectedDraftId.value = '';
    aiDraftSourceFlag.value = false;
    checkAIDraft();
    void loadSchemaForCurrentDraft();
  }
);

onMounted(() => {
  void applyMode();
  checkAIDraft();
  void loadSchemaForCurrentDraft();
});

defineExpose({});
</script>

<style scoped>
.edit-pane {
  display: grid;
  gap: 12px;
}

.edit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  flex-wrap: wrap;
}

.edit-toolbar__left {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.toolbar-hint {
  font-size: 11.5px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.edit-toolbar__right {
  display: flex;
  gap: 6px;
}

.edit-grid {
  display: grid;
  grid-template-columns: minmax(0, 320px) 1fr;
  gap: 14px;
  transition: grid-template-columns 0.2s ease;
}

.edit-grid--collapsed {
  grid-template-columns: 44px 1fr;
}

.ref-toggle {
  font-size: 10px;
  margin-right: 4px;
  color: #94a3b8;
}

.edit-col {
  display: grid;
  gap: 10px;
  align-content: start;
}

.edit-col--ref {
  overflow: hidden;
}

.edit-col--editor {
  min-width: 0;
}

.edit-col--editor :deep(.el-form-item__content) {
  width: 100%;
  min-width: 0;
}

.edit-col--editor :deep(.el-form-item) {
  width: 100%;
  min-width: 0;
}

.edit-col__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f1f5f9;
  user-select: none;
}

.edit-col__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  color: #1a2a44;
  white-space: nowrap;
}

.edit-col__hint {
  font-size: 11px;
  color: #94a3b8;
}

.edit-col__hint code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 3px;
  color: #475569;
}

.edit-col__ai {
  font-size: 11.5px;
  color: #6d28d9;
  font-weight: 700;
}

.edit-col__empty {
  padding: 24px 0;
}

.ref-stack {
  display: grid;
  gap: 10px;
}

.ref-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fafbfd;
}

.ref-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.ref-card__tag {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
}

.ref-card__tag--file {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}

.ref-card__tag--db {
  background: rgba(52, 120, 246, 0.12);
  color: #1e40af;
}

.ref-card__path {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #475569;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-card__meta {
  font-size: 10.5px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.ref-card__body {
  margin: 0;
  padding: 8px 10px;
  background: var(--admin-bg-surface);
  border: 1px solid #f1f5f9;
  border-radius: 6px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  color: #475569;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.ref-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}

.draft-form {
  margin-top: 4px;
  width: 100%;
  min-width: 0;
}

.draft-form__row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.draft-form__row--params {
  grid-template-columns: auto auto;
  gap: 20px;
}

.draft-form :deep(.el-form-item) {
  margin-bottom: 10px;
  width: 100%;
  min-width: 0;
}

.draft-form :deep(.el-form-item__content) {
  width: 100%;
  min-width: 0;
}

.draft-form :deep(.el-form-item__label) {
  font-size: 11.5px;
  font-weight: 700;
  color: #475569;
  padding-bottom: 3px;
}

.draft-textarea :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.7;
}

/* ============ Editor 工具栏 ============ */
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
  position: sticky;
  top: 0;
  background: var(--admin-bg-surface);
  z-index: 10;
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
}

.mini-lint {
  margin-left: 4px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 3px;
}

.mini-lint--ok {
  background: rgba(22, 163, 74, 0.15);
  color: #15803d;
}

.mini-lint--warn {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}

.sectioned-mode {
  min-height: 200px;
  max-height: calc(100vh - 400px);
  overflow-y: auto;
  width: 100%;
  min-width: 0;
}

.sectioned-loading,
.sectioned-empty {
  padding: 30px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

.editor-toolbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.editor-meta {
  font-size: 11px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

/* 查找替换面板 */
.find-panel {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 10px;
  background: #f1f5f9;
  border-radius: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

/* ============ Editor 编辑区 ============ */
.editor-wrap {
  position: relative;
  display: flex;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  background: var(--admin-bg-surface);
  height: 480px;
  width: 100%;
  min-width: 0;
}

.editor-gutter {
  flex-shrink: 0;
  width: 44px;
  background: #f8fafc;
  border-right: 1px solid #e2e8f0;
  overflow: hidden;
  user-select: none;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 22px;
  color: #94a3b8;
  text-align: right;
  padding: 8px 6px 8px 0;
}

.editor-gutter__line {
  height: 22px;
}

.editor-gutter__line--active {
  color: #3478f6;
  font-weight: 700;
  background: rgba(52, 120, 246, 0.05);
}

.editor-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  padding: 8px 12px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 22px;
  color: #1a2a44;
  background: var(--admin-bg-surface);
  white-space: pre;
  overflow: auto;
  tab-size: 2;
}

.editor-textarea:focus {
  background: #fafbfd;
}

/* ============ Diff 视图 ============ */
.diff-wrap {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  background: var(--admin-bg-surface);
  max-height: 480px;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.diff-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 11px;
  flex-wrap: wrap;
}

.diff-label {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 700;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
}

.diff-label--old {
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
}

.diff-label--new {
  background: rgba(22, 163, 74, 0.1);
  color: #15803d;
}

.diff-stat {
  margin-left: auto;
  color: #64748b;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
}

.diff-body {
  overflow: auto;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 22px;
}

.diff-line {
  display: flex;
  padding: 0 8px;
  white-space: pre;
}

.diff-line--add {
  background: rgba(22, 163, 74, 0.08);
}

.diff-line--del {
  background: rgba(220, 38, 38, 0.08);
}

.diff-line--eq {
  background: var(--admin-bg-surface);
  opacity: 0.6;
}

.diff-marker {
  width: 18px;
  flex-shrink: 0;
  font-weight: 700;
  user-select: none;
}

.diff-line--add .diff-marker {
  color: #15803d;
}

.diff-line--del .diff-marker {
  color: #b91c1c;
}

.diff-content {
  flex: 1;
  word-break: break-all;
}

.diff-empty {
  padding: 30px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  font-family: system-ui;
}

/* ============ 大纲视图 ============ */
.outline-wrap {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: var(--admin-bg-surface);
  padding: 12px;
  max-height: 480px;
  overflow-y: auto;
  width: 100%;
  min-width: 0;
}

.outline-empty {
  padding: 30px;
  text-align: center;
  color: #94a3b8;
  font-size: 12.5px;
  line-height: 1.7;
}

.outline-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.outline-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 6px;
  margin-bottom: 2px;
  transition: background 0.1s ease;
}

.outline-item:hover {
  background: #f1f5f9;
}

.outline-item--h1 {
  font-weight: 800;
  color: #1a2a44;
  font-size: 14px;
}

.outline-item--h2 {
  font-weight: 700;
  color: #334155;
  font-size: 13px;
  padding-left: 24px;
}

.outline-item--block {
  color: #475569;
  font-size: 12.5px;
  padding-left: 24px;
}

.outline-line-no {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.outline-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-meta {
  display: flex;
  justify-content: space-between;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}

.delta-up {
  color: #b45309;
}

.delta-down {
  color: #15803d;
}

.draft-list {
  border-top: 1px solid #f1f5f9;
  padding-top: 12px;
  margin-top: 8px;
}

.draft-list__head h5 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 800;
  color: #475569;
}

.draft-list ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}

.draft-list li {
  display: grid;
  grid-template-columns: 50px 1fr 130px auto auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  font-size: 12px;
  background: #f8fafc;
  border-radius: 6px;
}

.draft-row__v {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 700;
  color: #6d28d9;
}

.draft-row__name {
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-row__time {
  color: #94a3b8;
  font-size: 11px;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.full-text-meta {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.full-text {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #334155;
  background: #f8fafc;
  padding: 14px 16px;
  border-radius: 8px;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1280px) {
  .edit-grid {
    grid-template-columns: 1fr;
  }
  .edit-grid--collapsed {
    grid-template-columns: 44px 1fr;
  }
}
</style>
