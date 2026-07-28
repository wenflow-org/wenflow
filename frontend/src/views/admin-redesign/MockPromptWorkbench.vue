<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="mk-status">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Prompt 工作台（v4）</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">核心文件 {{ cores.length }}</span>
      <span class="mk-status__meta pw-ok">同步 {{ countBy('synced') }}</span>
      <span class="mk-status__meta pw-warn">待编译发布 {{ countBy('pending-compile') }}</span>
      <div class="pl-actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadList">
          <span v-if="loading"><span class="mk-spinner"></span> 刷新中…</span><span v-else>刷新</span>
        </button>
      </div>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="pw-grid">
      <!-- 左：skill 清单 -->
      <section class="mk-card pw-list">
        <div class="mk-card__head">
          <h3 class="mk-card__title">核心文件</h3>
          <span class="mk-card__meta">{{ cores.length }} 个</span>
        </div>
        <div class="pw-list__body">
          <button
            v-for="item in cores"
            :key="item.skillId"
            type="button"
            class="pw-skill"
            :class="{ 'pw-skill--active': item.skillId === activeSkill }"
            @click="selectSkill(item.skillId)"
          >
            <span class="pw-skill__dot" :class="`pw-skill__dot--${statusTone(item.status)}`"></span>
            <span class="pw-skill__id mono">{{ item.skillId }}</span>
            <span class="pw-skill__meta">{{ item.fields }} 字段 · {{ item.channels.length }} 通道</span>
          </button>
          <p v-if="!cores.length && !loading" class="pw-empty">未发现核心文件</p>
        </div>
      </section>

      <!-- 中：编辑器 -->
      <section class="mk-card pw-editor">
        <div class="mk-card__head">
          <h3 class="mk-card__title">核心文件 · {{ activeSkill || '未选择' }}</h3>
          <div class="pw-head-actions">
            <span v-if="editDirty" class="mk-badge mk-badge--muted">未保存</span>
            <button type="button" class="mk-link" :disabled="!activeSkill || saving" @click="save">
              <span v-if="saving"><span class="mk-spinner"></span> 保存中…</span><span v-else>保存并校验</span>
            </button>
            <button type="button" class="mk-link" :disabled="!activeSkill || compiling" @click="preview">
              <span v-if="compiling"><span class="mk-spinner"></span> 编译中…</span><span v-else>编译预览</span>
            </button>
            <button type="button" class="mk-status__action mk-status__action--primary" :disabled="!activeSkill || publishing" @click="publish(false)">
              <span v-if="publishing"><span class="mk-spinner"></span> 发布中…</span><span v-else>发布</span>
            </button>
          </div>
        </div>

        <!-- 编辑分级与校验信息 -->
        <div v-if="classification" class="pw-classify" :class="`pw-classify--${classification.level}`">
          <strong>编辑分级：{{ levelLabel(classification.level) }}</strong>
          <ul><li v-for="(m, i) in classification.messages" :key="i">{{ m }}</li></ul>
        </div>
        <div v-if="diagnostics.length" class="pw-diag">
          <div v-for="(d, i) in diagnostics" :key="i" class="pw-diag__item">
            <span class="pw-diag__code mono">{{ d.code }}</span>
            <span>{{ d.message }}</span>
          </div>
        </div>

        <textarea
          v-model="editorText"
          class="pw-textarea mono"
          spellcheck="false"
          placeholder="选择左侧核心文件开始编辑…"
          @input="editDirty = true"
        ></textarea>

        <!-- 发布结果 -->
        <div v-if="publishResult" class="pw-publish" :class="`pw-publish--${publishResult.ok ? 'ok' : 'bad'}`">
          <template v-if="publishResult.ok">
            已发布：{{ publishResult.agentId }} v{{ publishResult.version }} · coreHash
            <span class="mono">{{ shortHash(publishResult.coreHash) }}</span>
          </template>
          <template v-else>{{ publishResult.message }}</template>
        </div>
        <div v-if="uncertain" class="pw-uncertain">
          <strong>含义冻结判定不确定</strong>
          <p>{{ uncertain.rationale || 'judge 无法确定语义等价性' }}</p>
          <ul><li v-for="(f, i) in uncertain.findings || []" :key="i">[{{ f.severity }}] {{ f.aspect }}：{{ f.issue }}</li></ul>
          <button type="button" class="mk-status__action mk-status__action--primary" :disabled="publishing" @click="publish(true)">
            人工确认无误，强制发布
          </button>
        </div>
      </section>

      <!-- 右：预览 / 版本 / 血缘 -->
      <section class="mk-card pw-side">
        <div class="mk-card__head">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': sideTab === 'preview' }" @click="sideTab = 'preview'">编译预览</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': sideTab === 'versions' }" @click="openVersions">版本历史</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': sideTab === 'lineage' }" @click="openLineage">字段血缘</button>
          </div>
        </div>

        <!-- 编译预览 -->
        <div v-if="sideTab === 'preview'" class="pw-pane">
          <div v-if="gates" class="pw-gates">
            <div class="pw-gate" :class="gateCls(gates.structure?.length === 0)">
              结构合法 {{ gates.structure?.length === 0 ? '✓' : `✗ ${gates.structure?.length}` }}
            </div>
            <div class="pw-gate" :class="gateCls(gates.fieldFreeze?.length === 0)">
              字段冻结 {{ gates.fieldFreeze?.length === 0 ? '✓' : `✗ ${gates.fieldFreeze?.length}` }}
            </div>
            <div v-if="gates.semantic" class="pw-gate" :class="gateCls(gates.semanticDecision === 'pass')">
              含义冻结 {{ gates.semantic.verdict }}（{{ gates.semanticDecision }}）
            </div>
            <div v-for="(issue, i) in [...(gates.structure || []), ...(gates.fieldFreeze || [])]" :key="i" class="pw-gate-issue">
              [{{ issue.code }}] {{ issue.message }}
            </div>
          </div>
          <div v-if="compiledMeta" class="pw-meta mono">
            coreHash {{ shortHash(compiledMeta.coreHash) }} · coreVersion {{ compiledMeta.coreVersion }}
          </div>
          <pre class="pw-pre">{{ compiledPrompt || '点击「编译预览」查看五块产物（dry run，不写入）。' }}</pre>
        </div>

        <!-- 版本历史 -->
        <div v-else-if="sideTab === 'versions'" class="pw-pane">
          <div v-if="versionsLoading" class="pw-empty"><span class="mk-spinner"></span> 加载中…</div>
          <table v-else class="pw-table">
            <thead>
              <tr><th>版本</th><th>coreHash</th><th>coreVer</th><th>状态</th><th>发布者</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="v in versions" :key="v.version" :class="{ 'pw-table__active': v.status === 'ACTIVE' }">
                <td class="mono">v{{ v.version }}</td>
                <td class="mono">{{ shortHash(v.coreHash) }}</td>
                <td class="mono">{{ v.coreVersion ?? '—' }}</td>
                <td>{{ v.status }}</td>
                <td>{{ v.createdBy }}</td>
                <td>
                  <button
                    v-if="v.status !== 'ACTIVE'"
                    type="button"
                    class="mk-link"
                    :disabled="rollbacking"
                    @click="rollback(v.version)"
                  >回滚</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!versionsLoading && !versions.length" class="pw-empty">暂无版本记录</p>
        </div>

        <!-- 字段血缘 -->
        <div v-else class="pw-pane">
          <table class="pw-table">
            <thead><tr><th>字段</th><th>消费者（爆炸半径）</th></tr></thead>
            <tbody>
              <tr v-for="(entry, i) in lineage" :key="i">
                <td class="mono">{{ entry.field }}</td>
                <td><div v-for="(c, j) in entry.consumers" :key="j" class="pw-consumer">{{ c }}</div></td>
              </tr>
            </tbody>
          </table>
          <p v-if="!lineage.length" class="pw-empty">该 skill 暂无血缘注册（后台消费或未登记）</p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { adminPromptWorkbenchApi } from '@/api/adminApi';

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

interface Diagnostic { code: string; message: string }
interface Classification { level: 'safe' | 'restricted' | 'blocked'; messages: string[] }
interface VersionRow {
  version: number; status: string; coreHash: string | null; coreVersion: number | null;
  createdBy: string; publishedAt: string | null;
}
interface LineageEntry { field: string; consumers: string[] }

const props = defineProps<{ state?: string }>();
void props;

const cores = ref<CoreListItem[]>([]);
const loading = ref(false);
const activeSkill = ref('');
const editorText = ref('');
const editDirty = ref(false);
const saving = ref(false);
const compiling = ref(false);
const publishing = ref(false);
const rollbacking = ref(false);

const diagnostics = ref<Diagnostic[]>([]);
const classification = ref<Classification | null>(null);
const toast = ref('');
const toastCls = ref('mk-toast--ok');

const sideTab = ref<'preview' | 'versions' | 'lineage'>('preview');
const gates = ref<any>(null);
const compiledPrompt = ref('');
const compiledMeta = ref<{ coreHash: string; coreVersion: number } | null>(null);
const publishResult = ref<{ ok: boolean; message?: string; agentId?: string; version?: number; coreHash?: string } | null>(null);
const uncertain = ref<any>(null);

const versions = ref<VersionRow[]>([]);
const versionsLoading = ref(false);
const lineage = ref<LineageEntry[]>([]);

function countBy(status: string) {
  return cores.value.filter((c) => c.status === status).length;
}

function statusTone(status: string) {
  if (status === 'synced') return 'ok';
  if (status === 'pending-compile') return 'warn';
  return 'muted';
}

function gateCls(ok: boolean) {
  return ok ? 'pw-gate--ok' : 'pw-gate--bad';
}

function shortHash(hash?: string | null) {
  return hash ? `${hash.slice(0, 10)}…` : '—';
}

function levelLabel(level: string) {
  if (level === 'safe') return '安全（可发布）';
  if (level === 'restricted') return '受限（需开发确认）';
  return '阻断（需开发同步）';
}

function showToast(text: string, ok = true) {
  toast.value = text;
  toastCls.value = ok ? 'mk-toast--ok' : 'mk-toast--bad';
  setTimeout(() => { toast.value = ''; }, 3200);
}

async function loadList() {
  loading.value = true;
  try {
    const res = await adminPromptWorkbenchApi.getCoreList();
    cores.value = res.data?.items || [];
  } catch (e: any) {
    showToast(`清单加载失败：${e?.message || e}`, false);
  } finally {
    loading.value = false;
  }
}

async function selectSkill(skillId: string) {
  activeSkill.value = skillId;
  classification.value = null;
  diagnostics.value = [];
  publishResult.value = null;
  uncertain.value = null;
  gates.value = null;
  compiledPrompt.value = '';
  compiledMeta.value = null;
  try {
    const res = await adminPromptWorkbenchApi.getCore(skillId);
    editorText.value = res.data?.raw || '';
    diagnostics.value = res.data?.diagnostics || [];
    editDirty.value = false;
  } catch (e: any) {
    editorText.value = '';
    showToast(`核心文件读取失败：${e?.message || e}`, false);
  }
}

async function save() {
  if (!activeSkill.value) return;
  saving.value = true;
  classification.value = null;
  diagnostics.value = [];
  try {
    const res = await adminPromptWorkbenchApi.saveCore(activeSkill.value, editorText.value);
    classification.value = res.data?.classification || null;
    editDirty.value = false;
    showToast(`已保存（${levelLabel(res.data?.classification?.level || 'safe')}），状态：待编译发布`);
    void loadList();
  } catch (e: any) {
    diagnostics.value = e?.response?.data?.diagnostics || [];
    showToast(e?.response?.data?.error || `保存失败：${e?.message || e}`, false);
  } finally {
    saving.value = false;
  }
}

async function preview() {
  if (!activeSkill.value) return;
  compiling.value = true;
  sideTab.value = 'preview';
  gates.value = null;
  compiledPrompt.value = '';
  try {
    const res = await adminPromptWorkbenchApi.compileCore({ skillId: activeSkill.value });
    gates.value = res.data?.gates || null;
    compiledPrompt.value = res.data?.prompt || '';
    compiledMeta.value = { coreHash: res.data?.coreHash, coreVersion: res.data?.coreVersion };
  } catch (e: any) {
    showToast(e?.response?.data?.error || `编译失败：${e?.message || e}`, false);
  } finally {
    compiling.value = false;
  }
}

async function publish(confirmUncertain: boolean) {
  if (!activeSkill.value) return;
  publishing.value = true;
  publishResult.value = null;
  uncertain.value = null;
  try {
    const res = await adminPromptWorkbenchApi.publishCore({
      skillId: activeSkill.value,
      confirmUncertain: confirmUncertain || undefined,
    });
    publishResult.value = {
      ok: true,
      agentId: res.data?.agentId,
      version: res.data?.version,
      coreHash: res.data?.coreHash,
    };
    showToast(`发布成功：v${res.data?.version}`);
    void loadList();
  } catch (e: any) {
    const status = e?.response?.status;
    const data = e?.response?.data || {};
    if (status === 409 && data?.code === 'SEMANTIC_UNCERTAIN') {
      uncertain.value = data?.judgement || {};
      showToast('含义冻结不确定，需人工确认', false);
    } else {
      publishResult.value = {
        ok: false,
        message: data?.error || `发布失败：${e?.message || e}`,
      };
      if (data?.issues?.length) {
        uncertain.value = { findings: data.issues, rationale: data.error };
      }
      showToast(data?.error || '发布被阻断', false);
    }
  } finally {
    publishing.value = false;
  }
}

async function openVersions() {
  sideTab.value = 'versions';
  if (!activeSkill.value) return;
  versionsLoading.value = true;
  try {
    const res = await adminPromptWorkbenchApi.getCoreVersions(activeSkill.value);
    versions.value = res.data?.versions || [];
  } catch (e: any) {
    showToast(`版本加载失败：${e?.message || e}`, false);
  } finally {
    versionsLoading.value = false;
  }
}

async function rollback(version: number) {
  if (!activeSkill.value || rollbacking.value) return;
  if (!window.confirm(`确认回滚 ${activeSkill.value} 到 v${version}？现行文件与 ACTIVE 将被替换。`)) return;
  rollbacking.value = true;
  try {
    await adminPromptWorkbenchApi.rollbackCore(activeSkill.value, version);
    showToast(`已回滚到 v${version}`);
    await openVersions();
    void loadList();
  } catch (e: any) {
    showToast(e?.response?.data?.error || `回滚失败：${e?.message || e}`, false);
  } finally {
    rollbacking.value = false;
  }
}

async function openLineage() {
  sideTab.value = 'lineage';
  if (!activeSkill.value) return;
  try {
    const res = await adminPromptWorkbenchApi.getCoreLineage(activeSkill.value);
    lineage.value = res.data?.lineage || [];
  } catch (e: any) {
    showToast(`血缘加载失败：${e?.message || e}`, false);
  }
}

onMounted(() => {
  void loadList();
});
</script>

<style scoped>
.pw-grid { display: grid; grid-template-columns: 240px minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.pw-ok { color: var(--mq-ok, #2e7d32); }
.pw-warn { color: var(--mq-warn, #b26a00); }
.pw-list__body { display: grid; gap: 4px; max-height: 70vh; overflow-y: auto; }
.pw-skill { display: grid; grid-template-columns: 10px 1fr; grid-template-rows: auto auto; gap: 2px 8px; align-items: center; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; }
.pw-skill:hover { background: var(--mq-hover, rgba(0,0,0,0.04)); }
.pw-skill--active { border-color: var(--mq-accent, #4a6cf7); background: var(--mq-hover, rgba(0,0,0,0.04)); }
.pw-skill__dot { grid-row: 1 / 3; width: 8px; height: 8px; border-radius: 50%; }
.pw-skill__dot--ok { background: #2e7d32; }
.pw-skill__dot--warn { background: #b26a00; }
.pw-skill__dot--muted { background: #9aa0a6; }
.pw-skill__id { font-size: 12px; }
.pw-skill__meta { font-size: 11px; opacity: 0.65; }
.pw-head-actions { display: flex; gap: 14px; align-items: center; }
.pw-textarea { width: 100%; min-height: 52vh; resize: vertical; border: 1px solid var(--mq-border, #e0e0e0); border-radius: 8px; padding: 12px; font-size: 12px; line-height: 1.6; background: var(--mq-card-bg, #fff); }
.pw-classify { margin: 8px 0; padding: 10px 12px; border-radius: 8px; font-size: 12px; }
.pw-classify ul { margin: 6px 0 0; padding-left: 18px; }
.pw-classify--safe { background: rgba(46,125,50,0.08); }
.pw-classify--restricted { background: rgba(178,106,0,0.1); }
.pw-classify--blocked { background: rgba(183,28,28,0.1); }
.pw-diag { margin: 8px 0; display: grid; gap: 4px; }
.pw-diag__item { display: flex; gap: 8px; font-size: 12px; color: #b71c1c; }
.pw-diag__code { flex-shrink: 0; }
.pw-publish { margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 12px; }
.pw-publish--ok { background: rgba(46,125,50,0.1); }
.pw-publish--bad { background: rgba(183,28,28,0.1); }
.pw-uncertain { margin-top: 10px; padding: 12px; border-radius: 8px; background: rgba(178,106,0,0.1); font-size: 12px; }
.pw-uncertain ul { margin: 6px 0 10px; padding-left: 18px; }
.pw-pane { display: grid; gap: 10px; align-content: start; max-height: 72vh; overflow-y: auto; }
.pw-gates { display: grid; gap: 6px; }
.pw-gate { font-size: 12px; padding: 6px 10px; border-radius: 6px; }
.pw-gate--ok { background: rgba(46,125,50,0.1); }
.pw-gate--bad { background: rgba(183,28,28,0.12); }
.pw-gate-issue { font-size: 11px; opacity: 0.75; padding-left: 10px; }
.pw-meta { font-size: 11px; opacity: 0.65; }
.pw-pre { font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin: 0; }
.pw-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pw-table th, .pw-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mq-border, #eee); }
.pw-table__active { background: rgba(46,125,50,0.06); }
.pw-consumer { font-size: 11px; opacity: 0.8; padding: 1px 0; }
.pw-empty { font-size: 12px; opacity: 0.6; }
</style>
