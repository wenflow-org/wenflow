<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="mk-status">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Skill 工作台</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">核心文件 {{ cores.length }}</span>
      <span class="mk-status__meta pw-ok">同步 {{ countBy('synced') }}</span>
      <span class="mk-status__meta pw-warn">待编译发布 {{ countBy('pending-compile') }}</span>
      <div class="pl-actions">
        <button type="button" class="mk-status__action" @click="openScaffold">
          新建 Skill
        </button>
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadList">
          <span v-if="loading"><span class="mk-spinner"></span> 刷新中…</span><span v-else>刷新</span>
        </button>
      </div>
    </div>

    <p class="pw-lead">编辑与发布在 Skill 设计页的「协议」页签；「新建 Skill」生成骨架（core.yaml + 户口簿条目 + 编排契约 + handler 占位）。</p>


    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">核心文件</h3>
        <span class="mk-card__meta">{{ cores.length }} 个</span>
      </div>
      <div class="mk-table-scroll">
      <table v-if="cores.length" class="mk-table mk-table--click">
        <thead>
          <tr>
            <th>Skill</th>
            <th>结构</th>
            <th>输出</th>
            <th>coreHash</th>
            <th>状态</th>
            <th class="mk-th--right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in shownCores" :key="item.skillId" @click="openDesign(item.skillId)">
            <td><code class="mono">{{ item.skillId }}</code></td>
            <td class="mk-na">{{ item.fields }} 字段 · {{ item.channels.length }} 通道</td>
            <td class="mk-na">{{ item.outputMedia }}<template v-if="item.deltaOutput"> · delta</template></td>
            <td><code class="mono pw-hash">{{ shortHash(item.coreHash) }}</code></td>
            <td>
              <span class="mk-badge" :class="statusBadge(item.status)">{{ statusLabel(item.status) }}</span>
            </td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click.stop="openDesign(item.skillId)">协议 / 发布 →</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div v-if="canMoreCores" class="pw-more">
        <button type="button" class="mk-link" @click="loadMoreCores">
          加载更多（已显示 {{ shownCores.length }} / {{ cores.length }}）
        </button>
      </div>
      <div v-if="!cores.length && !loading" class="mk-empty">
        <span v-if="!loadError" class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>{{ loadError ? '清单加载失败' : '未发现核心文件' }}</strong>
        <span v-if="loadError">{{ loadError }}</span>
        <button v-if="loadError" type="button" class="mk-empty__action" @click="loadList">重试</button>
        <span v-else>编辑与发布入口在 Skill 设计页的「协议」页签。</span>
      </div>
    </section>

    <!-- 新建 Skill 弹窗（scaffold 一条龙） -->
    <div v-if="scaffoldOpen" ref="scaffoldMaskRef" class="mk-modal">
      <div ref="scaffoldPanelRef" class="mk-modal__panel sc-panel" role="dialog" aria-label="新建 Skill">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ result ? '新建 Skill · 完成' : '新建 Skill' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeScaffold">✕</button>
        </div>
        <div class="mk-modal__body">
          <!-- 结果展示 -->
          <template v-if="result">
            <div class="sc-result__head">
              <span class="mk-badge" :class="result.status === 'created' ? 'mk-badge--ok' : 'mk-badge--warn'">
                {{ result.status === 'created' ? '已创建' : '已补全（幂等重放）' }}
              </span>
              <code class="mono sc-result__id">{{ result.skillId }}</code>
              <span class="mk-badge sc-badge-kind">{{ kindLabel(result.kind) }}</span>
            </div>
            <p class="sc-result__note">{{ result.note }}</p>
            <div class="sc-result__section">
              <strong class="sc-result__title">生成文件（{{ result.generated.length }}）</strong>
              <ul class="sc-result__files">
                <li v-for="file in result.generated" :key="file"><code class="mono">{{ file }}</code></li>
              </ul>
            </div>
            <div class="sc-result__section">
              <strong class="sc-result__title">完成度（completion）</strong>
              <span class="mk-badge" :class="completionBadge(result.completion.status)">{{ completionLabel(result.completion.status) }}</span>
              <!-- 滚动修复 #8（顺带）：完成度清单默认折叠，不纵向平铺撑长弹窗 -->
              <details class="sc-result__completion">
                <summary>明细（{{ result.completion.items.length }} 项）</summary>
                <ul class="sc-result__items">
                  <li v-for="item in result.completion.items" :key="item.id" class="sc-result__item">
                    <span :class="`sc-dot sc-dot--${itemOk(item.ok)}`"></span>
                    <span>{{ item.label }}</span>
                    <span v-if="item.hint" class="sc-result__hint">{{ item.hint }}</span>
                  </li>
                </ul>
              </details>
            </div>
            <details class="sc-result__snippets" v-if="result.snippets.length">
              <summary>注册片段（复制后手工粘贴，scaffold 不自动改写 TS）</summary>
              <div v-for="snippet in result.snippets" :key="snippet.title" class="sc-result__snippet">
                <strong class="sc-result__snippet-title">{{ snippet.title }}</strong>
                <pre class="mono sc-result__pre">{{ snippet.content }}</pre>
              </div>
            </details>
          </template>

          <!-- 表单 -->
          <template v-else>
            <div class="sc-form">
              <label class="sc-field">
                <span class="sc-field__label">skillId <em>*</em></span>
                <input v-model="form.skillId" class="sc-field__input mono" placeholder="kebab-case，如 my-new-skill" spellcheck="false" />
              </label>
              <label class="sc-field">
                <span class="sc-field__label">kind <em>*</em></span>
                <select v-model="form.kind" class="sc-field__input">
                  <option value="mainline">mainline（主链，进编排字段路由）</option>
                  <option value="aux">aux（v4-aux-skills 旁挂）</option>
                  <option value="handler-only">handler-only（无 LLM prompt）</option>
                </select>
              </label>
              <template v-if="form.kind === 'mainline'">
                <label class="sc-field">
                  <span class="sc-field__label">stage <em>*</em></span>
                  <select v-model="form.stage" class="sc-field__input">
                    <option value="">— 选择阶段 —</option>
                    <option v-for="stage in meta.stages" :key="stage" :value="stage">{{ stage }}</option>
                  </select>
                </label>
                <label class="sc-field">
                  <span class="sc-field__label">parentAgent <em>*</em></span>
                  <select v-model="form.parentAgent" class="sc-field__input">
                    <option value="">— 选择归属 Agent —</option>
                    <option v-for="agent in meta.agents" :key="agent.id" :value="agent.id">{{ agent.id }}（{{ agent.name }}）</option>
                  </select>
                </label>
              </template>
              <label class="sc-field">
                <span class="sc-field__label">displayName</span>
                <input v-model="form.displayName" class="sc-field__input" placeholder="中文展示名（可选）" />
              </label>
              <label class="sc-field">
                <span class="sc-field__label">description</span>
                <textarea v-model="form.description" class="sc-field__input sc-field__textarea" rows="2" placeholder="一句话职责描述（可选）"></textarea>
              </label>
            </div>
            <p v-if="scaffoldMsg" class="sc-msg" :class="{ 'sc-msg--error': scaffoldError }">{{ scaffoldMsg }}</p>
          </template>
        </div>
        <div class="mk-modal__foot">
          <template v-if="result">
            <button type="button" class="mk-btn" @click="closeScaffold">关闭</button>
            <button type="button" class="mk-btn mk-btn--primary" @click="openDesign(result.skillId)">打开设计页（协议页签）→</button>
          </template>
          <template v-else>
            <button type="button" class="mk-btn" :disabled="scaffolding" @click="closeScaffold">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="scaffolding" @click="submitScaffold">
              {{ scaffolding ? '生成中…' : '生成骨架' }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { adminPromptWorkbenchApi, adminSkillsApi, type SkillScaffoldMeta, type SkillScaffoldResult } from '@/api/adminApi';
import { useEscape } from './useEscape';
import { useOverlay, useMaskClose } from './useOverlay';
import { useLoadMore } from './useLoadMore';
import { intent } from './store'
import { toast } from '@/utils/toast'

interface CoreListItem {
  skillId: string;
  fields: number;
  channels: string[];
  stateAdvance: boolean;
  deltaOutput: boolean;
  outputMedia: string;
  coreHash: string;
  publishedHash: string | null;
  status: 'synced' | 'pending-compile' | 'no-prompt';
}

const router = useRouter();
const cores = ref<CoreListItem[]>([]);
const loading = ref(false);
const loadError = ref('');

/* 滚动修复 #8：核心文件表 15 行/页（客户端切片，加载更多翻页） */
const { shown: shownCores, canMore: canMoreCores, loadMore: loadMoreCores } = useLoadMore(computed(() => cores.value), 15);

function countBy(status: string) {
  return cores.value.filter((c) => c.status === status).length;
}

function shortHash(hash?: string | null) {
  return hash ? `${hash.slice(0, 10)}…` : '—';
}

function statusLabel(status: string) {
  if (status === 'synced') return '已同步';
  if (status === 'pending-compile') return '待编译发布';
  return '无 Prompt';
}

function statusBadge(status: string) {
  if (status === 'synced') return 'mk-badge--ok';
  if (status === 'pending-compile') return 'mk-badge--warn';
  return 'mk-badge--muted';
}

/** 编辑统一入口：Skill 设计页「协议」页签 */
function openDesign(skillId: string) {
  void router.push(`/admin/skills/${encodeURIComponent(skillId)}?tab=protocol`);
}

async function loadList() {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await adminPromptWorkbenchApi.getCoreList();
    cores.value = res.data?.items || [];
  } catch (e: any) {
    cores.value = [];
    loadError.value = `清单加载失败：${e?.message || e}`;
    toast.error(`清单加载失败：${e?.message || e}`);
  } finally {
    loading.value = false;
  }
}

// ============ 新建 Skill（scaffold 一条龙） ============

const scaffoldOpen = ref(false);
const scaffolding = ref(false);
const scaffoldMsg = ref('');
const scaffoldError = ref(false);
const result = ref<SkillScaffoldResult | null>(null);
const meta = ref<SkillScaffoldMeta>({ kinds: ['mainline', 'aux', 'handler-only'], stages: [], agents: [] });
const form = ref({ skillId: '', kind: 'mainline' as 'mainline' | 'aux' | 'handler-only', stage: '', parentAgent: '', displayName: '', description: '' });
const scaffoldPanelRef = ref<HTMLElement | null>(null);
const scaffoldMaskRef = ref<HTMLElement | null>(null);

useEscape(() => scaffoldOpen.value, () => { closeScaffold(); });
useOverlay(scaffoldOpen, scaffoldPanelRef);
useMaskClose(scaffoldMaskRef, () => { closeScaffold(); });

/* 命令面板快捷动作「新建 Skill」：直达并打开 scaffold 弹窗 */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-skill') {
      intent.quickAction = ''
      void openScaffold()
    }
  },
  { immediate: true }
)

function errOf(e: any) {
  return e?.response?.data?.error?.message || e?.message || '操作失败';
}

function kindLabel(kind: string) {
  if (kind === 'mainline') return 'mainline';
  if (kind === 'aux') return 'aux';
  return 'handler-only';
}

function completionLabel(status: string) {
  const labels: Record<string, string> = {
    draft: 'draft',
    'handler-ready': 'handler-ready',
    'core-ready': 'core-ready',
    'fields-synced': 'fields-synced',
    live: 'live',
  };
  return labels[status] || status;
}

function completionBadge(status: string) {
  if (status === 'live') return 'mk-badge--ok';
  if (status === 'fields-synced' || status === 'core-ready') return 'mk-badge--warn';
  return 'mk-badge--muted';
}

function itemOk(ok: boolean | null) {
  if (ok === true) return 'ok';
  if (ok === false) return 'bad';
  return 'na';
}

function resetForm() {
  form.value = { skillId: '', kind: 'mainline', stage: '', parentAgent: '', displayName: '', description: '' };
  result.value = null;
  scaffoldMsg.value = '';
  scaffoldError.value = false;
}

async function openScaffold() {
  resetForm();
  scaffoldOpen.value = true;
  if (meta.value.agents.length === 0) {
    try {
      const res = await adminSkillsApi.getScaffoldMeta();
      meta.value = res.data?.data || meta.value;
    } catch (e: any) {
      scaffoldMsg.value = `表单元数据加载失败：${errOf(e)}`;
      scaffoldError.value = true;
    }
  }
}

function closeScaffold() {
  scaffoldOpen.value = false;
}

function validateForm(): string {
  const f = form.value;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.skillId)) return 'skillId 须为 kebab-case（小写字母/数字，短横线分隔）';
  if (f.kind === 'mainline') {
    if (!f.stage) return 'mainline 必选 stage';
    if (!f.parentAgent) return 'mainline 必选 parentAgent';
  }
  return '';
}

async function submitScaffold() {
  scaffoldMsg.value = '';
  scaffoldError.value = false;
  const invalid = validateForm();
  if (invalid) {
    scaffoldMsg.value = invalid;
    scaffoldError.value = true;
    return;
  }
  scaffolding.value = true;
  try {
    const payload: any = {
      skillId: form.value.skillId,
      kind: form.value.kind,
      displayName: form.value.displayName || undefined,
      description: form.value.description || undefined,
    };
    if (form.value.kind === 'mainline') {
      payload.stage = form.value.stage;
      payload.parentAgent = form.value.parentAgent;
    }
    const res = await adminSkillsApi.scaffold(payload);
    result.value = res.data?.data || null;
    toast.success(result.value?.status === 'completed' ? '已补齐缺失生成物' : 'Skill 骨架已生成');
    await loadList();
  } catch (e: any) {
    scaffoldMsg.value = errOf(e);
    scaffoldError.value = true;
  } finally {
    scaffolding.value = false;
  }
}

onMounted(async () => {
  await loadList();
});
</script>

<style scoped>
.pw-ok { color: var(--mk-green, #15803d); }
.pw-warn { color: var(--mk-amber, #b45309); }
.pw-lead {
  margin: 0;
  font-size: 12.5px;
  color: var(--mk-faint, #8492ab);
  line-height: 1.7;
}
.pw-hash { font-size: 11px; }
.pl-actions { margin-left: auto; display: flex; gap: 8px; }
.mk-table--click tbody tr { cursor: pointer; }
/* 滚动修复 #8：分页加载更多按钮行 */
.pw-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
}
.sc-result__completion { margin-top: 8px; }
.sc-result__completion summary { cursor: pointer; font-size: 12px; font-weight: 700; color: var(--mk-muted, #5b6577); }
.sc-result__completion .sc-result__items { margin-top: 8px; }

/* ========== scaffold 弹窗 ========== */
.sc-panel { width: min(680px, 100%); }
.sc-form { display: flex; flex-direction: column; gap: 12px; }
.sc-field { display: flex; flex-direction: column; gap: 5px; }
.sc-field__label { font-size: 12px; font-weight: 700; color: var(--mk-muted, #5b6577); }
.sc-field__label em { color: var(--mk-red, #dc2626); font-style: normal; }
.sc-field__input {
  padding: 8px 11px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #fbfcfe;
  color: var(--mk-ink, #1a2a44);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.sc-field__input:focus { border-color: var(--mk-blue, #2c63d0); }
.sc-field__textarea { resize: vertical; min-height: 44px; line-height: 1.55; }
.sc-msg {
  margin: 10px 0 0;
  padding: 9px 12px;
  border: 1px solid rgba(44, 99, 208, 0.35);
  border-radius: 9px;
  background: #f0f5ff;
  color: var(--mk-blue, #2c63d0);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}
.sc-msg--error { border-color: rgba(220, 38, 38, 0.4); background: #fef2f2; color: var(--mk-red, #dc2626); }

.sc-result__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-result__id { font-size: 13px; font-weight: 700; color: var(--mk-ink, #1a2a44); }
.sc-badge-kind { background: #eef2fa; color: var(--mk-muted, #5b6577); }
.sc-result__note {
  margin: 10px 0 0;
  padding: 8px 12px;
  border: 1px dashed rgba(180, 83, 9, 0.45);
  border-radius: 9px;
  background: #fffbeb;
  color: var(--mk-amber, #b45309);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.55;
}
.sc-result__section { margin-top: 14px; }
.sc-result__title { display: block; font-size: 12px; font-weight: 700; color: var(--mk-muted, #5b6577); margin-bottom: 6px; }
.sc-result__files { margin: 0; padding-left: 18px; }
.sc-result__files li { font-size: 12px; color: var(--mk-blue, #2c63d0); line-height: 1.8; }
.sc-result__items { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sc-result__item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--mk-ink, #1a2a44); }
.sc-result__hint { color: var(--mk-faint, #8492ab); font-size: 11.5px; }
.sc-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sc-dot--ok { background: var(--mk-green, #15803d); }
.sc-dot--bad { background: var(--mk-red, #dc2626); }
.sc-dot--na { background: #cbd5e1; }
.sc-result__snippets { margin-top: 14px; border-top: 1px solid var(--mk-line, #e6ebf4); padding-top: 10px; }
.sc-result__snippets summary { cursor: pointer; font-size: 12px; font-weight: 700; color: var(--mk-muted, #5b6577); }
.sc-result__snippet { margin-top: 8px; }
.sc-result__snippet-title { display: block; font-size: 11.5px; color: var(--mk-blue, #2c63d0); margin-bottom: 4px; }
.sc-result__pre {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #f8fafc;
  color: var(--mk-ink, #1a2a44);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 260px;
  overflow: auto;
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .pw-lead { font-size: 14px; }
  .pw-hash { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .pw-lead { font-size: 15.5px; }
  .pw-hash { font-size: 14px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与表格正文对齐 */
  .pw-lead { font-size: 18px; }
  .pw-hash { font-size: 16.5px; }
}
</style>
