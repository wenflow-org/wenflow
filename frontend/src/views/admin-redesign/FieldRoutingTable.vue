<template>
  <div class="frt">
    <!-- 搜索 / 角色过滤 -->
    <div class="mk-filter frt__filter">
      <MkFilterSearch v-model="keyword" type="search" placeholder="搜索字段 / 含义 / 角色 / 移交" />
      <MkSelect
        v-model="roleFilter"
        :options="roleFilterOptions"
        aria-label="按角色过滤"
      />
      <MkSelect
        v-model="sortKey"
        :options="SORT_OPTIONS"
        aria-label="组内排序字段"
      />
      <button
        type="button"
        class="mk-btn mk-btn--sm"
        :disabled="!sortKey"
        title="切换排序方向"
        @click="toggleDir"
      >{{ sortDir === 'asc' ? '升序' : '降序' }}</button>
      <span v-if="filterActive" class="frt__filter-count">命中 {{ filteredTotal }} / {{ routings.length }} 行</span>
    </div>

    <MkLoading v-if="loading" />
    <MkEmptyState v-else-if="error" tone="error" :title="error" action-text="重试" compact @action="loadStage" />
    <template v-else>
      <!-- 空态带 CTA（原型 .empty）：本阶段无任何 Agent 分组 -->
      <MkEmptyState
        v-if="!agents.length"
        title="该阶段暂无字段路由"
        action-text="重试"
        @action="loadStage"
      />
      <template v-else>
        <div v-for="agent in agents" :key="agent.agentId" class="mk-card frt__agent">
          <!-- 原型 .card__head：title（agent）+ sub（描述）+ 右侧行数（mk-badge--muted） -->
          <div class="mk-card__head frt__agenthead">
            <h4 class="mk-card__title frt__agentname mono">{{ agent.agentId }}</h4>
            <span class="mk-card__meta frt__agentdesc">{{ agent.description }}</span>
            <span class="mk-badge mk-badge--muted">{{ filteredOf(agent.agentId).length }}<template v-if="filterActive"> / {{ routingsOf(agent.agentId).length }}</template> 行</span>
          </div>
          <div v-if="rowsOf(agent.agentId).length" class="frt__scroll">
            <!-- 2026-10-28 用户「既然是个列表，就遵守列表的设计」：字段路由本质是一组字段条目，
                 不是需要横向对齐的宽表。撤掉表头与列布局，按站内列表范式一行一个字段：
                 左列角色（lead）、主区字段名 + 含义 + 元信息、右列可见性/内部/累积。 -->
            <ul class="frt__list" role="list">
              <li v-for="row in rowsOf(agent.agentId)" :key="row.id" class="frt__item">
                <span class="frt__role">
                  <span
                    v-if="roleMetaOf(row.fieldId)"
                    class="mk-badge"
                    :class="`mk-badge--role-${roleMetaOf(row.fieldId)!.id}`"
                    :title="roleMetaOf(row.fieldId)!.hint"
                  >{{ roleMetaOf(row.fieldId)!.label }}</span>
                  <span v-else class="mk-na">—</span>
                </span>
                <div class="frt__itemmain">
                  <div class="frt__itemhead">
                    <span class="mono frt__field" :title="fieldTitle(row)">{{ row.fieldId }}</span>
                    <span class="frt__itemspacer" aria-hidden="true"></span>
                    <span
                      class="mk-badge"
                      :class="`mk-badge--render-${row.render}`"
                      :title="renderHint(row)"
                    >{{ renderText(row.render) }}</span>
                    <span v-if="row.internal" class="mk-badge mk-badge--muted">内部</span>
                    <span v-if="row.accumulate" class="mk-badge mk-badge--muted">累积</span>
                  </div>
                  <p class="frt__meaning" :title="meaningTitle(row)">{{ descOf(row.fieldId) || '—' }}</p>
                  <div class="frt__metaline">
                    <span class="mono frt__type">{{ typeOf(row.fieldId) }}</span>
                    <span
                      v-if="formatHandoff(row.handoff)"
                      class="mono frt__handoff"
                      :title="handoffTitle(row)"
                    >移交 → {{ formatHandoff(row.handoff) }}</span>
                    <span
                      v-if="persistKeyOf(row) !== row.fieldId"
                      class="frt__alias"
                      :title="`值实际保存到 ${persistKeyOf(row)}`"
                    >存为 {{ persistKeyOf(row) }}</span>
                    <span
                      v-if="row.locks?.level === 'system-locked' || row.locks?.level === 'structure-locked'"
                      class="mk-badge frt__lockchip"
                      :class="`mk-badge--lock-${row.locks?.level}`"
                      :title="lockHint(row.locks?.level)"
                    >{{ lockLabel(row.locks?.level) }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </div>
          <!-- 空态带 CTA：筛选无命中 → 清除筛选；否则仅说明 -->
          <MkEmptyState
            v-else
            compact
            :title="filterActive ? '无匹配行' : '该 Agent 没有字段的路由记录'"
            :action-text="filterActive ? '清除筛选' : ''"
            @action="clearFilter"
          />
          <!-- 每 agent 组分页（统一 mk-pagination 页码器：固定 15 行/页，隐藏每页条数）。
               审核 #112：0 命中时原无条件渲染「共 0 条 · 第 1 / 1 页」+禁用翻页，五张卡叠五份
               空页码器（像还有内容）——有行才出页码器，0 命中只留上方 MkEmptyState -->
          <Pagination
            v-if="filteredOf(agent.agentId).length"
            :page="pageOf(agent.agentId) + 1"
            :total="filteredOf(agent.agentId).length"
            :page-size="AGENT_PAGE_SIZE"
            :hide-size="true"
            :show-total="true"
            @update:page="setPage(agent.agentId, ($event as number) - 1)"
          />
        </div>
      </template>
    </template>

    <!-- 编排文件编辑弹窗 -->
    <Teleport to="body">
    <div v-if="orchOpen" ref="orchMaskRef" class="mk-modal">
      <div ref="orchPanelRef" class="mk-modal__panel mk-modal__panel--wide frt__orch-panel" role="dialog" aria-label="编排文件编辑">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">编排文件 · {{ stage }}.yaml</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeOrchestration">✕</button>
        </div>
        <div class="mk-modal__body">
          <div class="frt__orch-summary">
            <span class="mono">prompts/orchestration/{{ stage }}.yaml</span>
            <span>契约 {{ orchSummary.contractCount }} · 字段 {{ orchSummary.fieldCount }} · 路由 {{ orchSummary.routingCount }}</span>
          </div>
          <!-- 值域速查条：编辑时对照填写（原型 .note--info） -->
          <div class="note note--info frt__orch-quick">
            <span class="frt__orch-quick-title">值域速查：</span>
            <span class="frt__orch-quick-item"><b>字段角色</b>{{ roleNames }}</span>
            <span class="frt__orch-quick-item"><b>对外可见性</b>可见 / 隐藏（render）</span>
            <span class="frt__orch-quick-item"><b>流转去向</b>阶段名（goal/path/teaching/profile/simulation）或 agent / skill:</span>
            <span class="frt__orch-quick-item"><b>存储字段名</b>仅存储字段名与字段名不一致时标注</span>
          </div>
          <textarea
            v-model="orchContent"
            class="frt__orch-textarea mono"
            rows="26"
            spellcheck="false"
            placeholder="编排文件 YAML 原文"
          ></textarea>
          <p v-if="orchMsg" class="note note--info frt__orch-msg">{{ orchMsg }}</p>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" :disabled="orchSaving || orchSyncing || orchPruning" @click="closeOrchestration">关闭</button>
          <div class="mk-menu frt__orch-more">
            <button
              type="button"
              class="mk-btn"
              aria-haspopup="menu"
              :aria-expanded="orchMoreOpen"
              :disabled="orchSaving || orchSyncing || orchPruning"
              @click="orchMoreOpen = !orchMoreOpen"
            >更多</button>
            <div v-if="orchMoreOpen" class="mk-menu__pop" @click.stop>
              <button type="button" class="mk-menu__item" @click="menuSync">{{ TERMS.syncToDb }}</button>
              <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuPrune">
                {{ orchPruning ? '清理中…' : '清理孤儿行' }}
              </button>
            </div>
          </div>
          <button
            v-if="pruneConfirming"
            type="button"
            class="mk-btn mk-btn--danger"
            :disabled="orchSaving || orchSyncing || orchPruning"
            @click="runPrune(true)"
          >确认清理冗余配置</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="orchSaving || orchSyncing || orchPruning" @click="saveOrchestration">
            {{ orchSaving ? '保存中…' : TERMS.saveToFile }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { adminFieldRoutingsApi } from '@/api/adminApi';
import { useEscape } from './useEscape';
import { useOverlay, useMaskClose } from './useOverlay';
import { toast } from '@/utils/toast';
import { askConfirm } from './useConfirm';
import { TERMS } from './terms';
import { errMsg } from './live';
import Pagination from './Pagination.vue';
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue';
import MkSelect from '@/components/mk/MkSelect.vue';
import { useTableSort } from './useTableSort';
import MkLoading from '@/components/mk/MkLoading.vue';
import MkEmptyState from '@/components/mk/MkEmptyState.vue';

interface FieldItem {
  fieldId: string;
  valueType?: string;
  promptRole?: string;
  description?: string | null;
  enumValues?: unknown;
  locks?: { level?: string };
  pathInRawOutput?: string | null;
  persistKey?: string | null;
}
interface AgentItem { agentId: string; description?: string }

/* 可见性释义单源（R6 复读单源化）：行悬停提示 renderHint 用 */
const RENDER_VISIBLE_HINT = '可见：会出现在对外交付（用户 / 界面）'
const RENDER_HIDDEN_HINT = '隐藏：仅内部流转，不对外展示'
interface RoutingItem {
  id: string;
  agentId: string;
  fieldId: string;
  render: string;
  handoff: string | string[] | null;
  internal: boolean;
  accumulate: boolean;
  locks?: { level?: string };
  notes?: string | null;
  visibilityPreset?: string | null;
}

/** promptRole 人话：后端 yaml-vocabulary 单源下发（getStageDetail 响应 promptRoleMeta），前端不再各写一份 */
interface RoleMeta { id: string; label: string; hint: string }

const props = defineProps<{ stage: string }>();
const emit = defineEmits<{ changed: [] }>();

const roleMeta = ref<RoleMeta[]>([]);

const fields = ref<FieldItem[]>([]);
const agents = ref<AgentItem[]>([]);
const routings = ref<RoutingItem[]>([]);
const loading = ref(false);
const error = ref('');
const keyword = ref('');
const roleFilter = ref('');
const roleFilterOptions = computed(() => [
  { value: '', label: '全部角色' },
  ...roleMeta.value.map((m) => ({ value: m.id, label: `${m.label}（${m.id}）` }))
]);
const SORT_OPTIONS = [
  { value: '', label: '默认顺序' },
  { value: 'field', label: '字段名' },
  { value: 'role', label: '角色' },
  { value: 'render', label: '可见性' },
  { value: 'type', label: '类型' },
  { value: 'meaning', label: '含义' }
];

/* 组内排序：数据完整（一次拉取本阶段全部路由行 → 按 agent 分组 → 本地分页），
   默认保持后端编排顺序（promptRole/fieldId 升序），下拉选字段 + 升/降按钮切换。
   本表列窄（badge 64px）不适合表头箭头，故用下拉式而非可排序表头。 */
const { sortKey, sortDir, toggleDir, sortRows } = useTableSort<RoutingItem>({
  accessors: {
    field: (r) => r.fieldId,
    meaning: (r) => descOf(r.fieldId),
    type: (r) => typeOf(r.fieldId),
    role: (r) => roleMetaOf(r.fieldId)?.label || '',
    render: (r) => r.render,
    persist: (r) => persistKeyOf(r),
    lock: (r) => r.locks?.level || ''
  },
  defaultDir: 'asc',
  storageKey: 'wf_field_routing_sort'
});

/* ============ 每 agent 组分页（滚动修复 #1） ============ */
const AGENT_PAGE_SIZE = 15;
const agentPages = ref<Record<string, number>>({});

function pagesOf(agentId: string) {
  return Math.max(1, Math.ceil(filteredOf(agentId).length / AGENT_PAGE_SIZE));
}
function pageOf(agentId: string) {
  const p = agentPages.value[agentId] || 0;
  return Math.min(p, pagesOf(agentId) - 1);
}
function setPage(agentId: string, p: number) {
  agentPages.value = { ...agentPages.value, [agentId]: Math.min(Math.max(p, 0), pagesOf(agentId) - 1) };
}
function rowsOf(agentId: string) {
  const list = filteredOf(agentId);
  const p = pageOf(agentId);
  return list.slice(p * AGENT_PAGE_SIZE, (p + 1) * AGENT_PAGE_SIZE);
}
/* 筛选/搜索/排序变化 → 页码回到第 1 页（与 useLoadMore 同语义） */
watch([keyword, roleFilter, sortKey, sortDir], () => { agentPages.value = {}; });

/** fieldId → 字段声明映射：computed 缓存（原函数式每次调用重建 Map，逐行渲染即重建 N 次） */
const fieldMap = computed(() => new Map(fields.value.map((f) => [f.fieldId, f])));

function typeOf(fieldId: string) { return fieldMap.value.get(fieldId)?.valueType || '—'; }
function descOf(fieldId: string) { return fieldMap.value.get(fieldId)?.description || ''; }
function roleOf(fieldId: string) { return fieldMap.value.get(fieldId)?.promptRole || ''; }
function roleMetaOf(fieldId: string) {
  const role = roleOf(fieldId);
  if (!role) return undefined;
  const meta = roleMeta.value.find((m) => m.id === role);
  return meta || { id: role, label: role, hint: role };
}
function routingsOf(agentId: string) { return routings.value.filter((r) => r.agentId === agentId); }

const filterActive = computed(() => Boolean(keyword.value.trim() || roleFilter.value));
function clearFilter() {
  keyword.value = '';
  roleFilter.value = '';
}
const filteredTotal = computed(() => routings.value.filter(matches).length);

/** 弹窗速查条：promptRole 取值清单（后端词表下发；未加载时显示占位） */
const roleNames = computed(() => {
  const names = roleMeta.value.map((m) => `${m.id}(${m.label})`).join(' · ');
  return names ? `：${names}` : '：加载中…';
});

function matches(r: RoutingItem) {
  if (roleFilter.value && roleOf(r.fieldId) !== roleFilter.value) return false;
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return true;
  const meta = roleMetaOf(r.fieldId);
  const hay = [
    r.fieldId,
    descOf(r.fieldId),
    meta?.label || '',
    meta?.hint || '',
    r.render,
    r.visibilityPreset || '',
    formatHandoff(r.handoff),
    lockLabel(r.locks?.level),
    r.notes || '',
    pathOf(r.fieldId),
    persistKeyOf(r),
  ].join(' ').toLowerCase();
  return hay.includes(kw);
}

function filteredOf(agentId: string) {
  return sortRows(routingsOf(agentId).filter(matches));
}

function formatHandoff(raw: string | string[] | null) {
  if (!raw) return '';
  if (Array.isArray(raw)) return raw.join(', ');
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.join(', ') : raw;
  } catch {
    return raw;
  }
}
function handoffTitle(row: RoutingItem) {
  const parts: string[] = [];
  if (row.handoff) parts.push(`移交 → ${formatHandoff(row.handoff)}`);
  if (row.visibilityPreset) parts.push(`可见性预设：${row.visibilityPreset}`);
  if (row.notes) parts.push(`备注：${row.notes}`);
  return parts.join('\n');
}
function meaningTitle(row: RoutingItem) {
  const parts: string[] = [];
  const desc = descOf(row.fieldId);
  if (desc) parts.push(desc);
  const ev = fieldMap.value.get(row.fieldId)?.enumValues;
  if (Array.isArray(ev) && ev.length) parts.push(`取值：${ev.join(' / ')}`);
  const path = pathOf(row.fieldId);
  if (path) parts.push(`抽取路径（pathInRawOutput）：${path}`);
  if (row.notes) parts.push(`备注：${row.notes}`);
  return parts.join('\n');
}

/** 落库键：编排声明了 persistKey 用 persistKey，否则默认与 fieldId 一致 */
function persistKeyOf(row: RoutingItem) {
  const k = fieldMap.value.get(row.fieldId)?.persistKey;
  return k || row.fieldId;
}
/** 字段值在产出方原始输出里的物理抽取路径（pathInRawOutput，可空） */
function pathOf(fieldId: string) {
  return fieldMap.value.get(fieldId)?.pathInRawOutput || '';
}
/** 字段名 tooltip：嵌套字段补原始抽取路径；路径与字段名相同时不重复 */
function fieldTitle(row: RoutingItem) {
  const path = pathOf(row.fieldId);
  return path && path !== row.fieldId ? `${row.fieldId}\n抽取路径：${path}` : row.fieldId;
}
/** render 枚举 → 中文（原始值保留在 title 的 renderHint）；未知取值回显原值，避免被误标为「可见」 */
function renderText(render: string) {
  if (render === 'hidden') return '隐藏'
  if (render === 'visible') return '可见'
  return render
}

function renderHint(row: RoutingItem) {
  const base = row.render === 'hidden'
    ? RENDER_HIDDEN_HINT
    : row.render === 'visible'
      ? RENDER_VISIBLE_HINT
      : `可见性取值不在可选值列表：${row.render}`;
  return row.visibilityPreset ? `${base}\n可见性预设：${row.visibilityPreset}` : base;
}
function lockLabel(level?: string) {
  if (level === 'system-locked') return '平台锁定';
  if (level === 'structure-locked') return '平台锁定';
  return '可编辑';
}
function lockHint(level?: string) {
  if (level === 'system-locked') return '平台锁定：平台自动生成，管理员不可直接改（需改编排文件）';
  if (level === 'structure-locked') return '平台锁定：结构约束锁定，修改需谨慎';
  return '可编辑：可自由调整（仍走编排文件入口）';
}

async function loadStage() {
  if (!props.stage) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await adminFieldRoutingsApi.getStageDetail(props.stage);
    fields.value = res.data?.data?.fields || [];
    agents.value = res.data?.data?.agents || [];
    routings.value = res.data?.data?.routings || [];
    roleMeta.value = res.data?.data?.promptRoleMeta || [];
    agentPages.value = {};
  } catch (e: any) {
    // 人话化走全站单源 errMsg（此前直出 e?.message，网关/限流黑话管理员看不懂）
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}
// ============ 编排文件编辑（单源化批次 C） ============

const orchOpen = ref(false);
const orchContent = ref('');
/** 打开时快照：关闭前与当前内容比对，脏（不一致）则确认再丢，防 ✕/遮罩/Esc 静默弃稿 */
const orchBaseline = ref('');
const orchDirty = computed(() => orchContent.value !== orchBaseline.value);
const orchSummary = ref({ contractCount: 0, fieldCount: 0, routingCount: 0 });
const orchSaving = ref(false);
const orchSyncing = ref(false);
const orchPruning = ref(false);
const pruneConfirming = ref(false);
const orchMsg = ref('');
const orchPanelRef = ref<HTMLElement | null>(null);
const orchMaskRef = ref<HTMLElement | null>(null);
const orchMoreOpen = ref(false);

function menuSync() {
  orchMoreOpen.value = false;
  void forceSync();
}
function menuPrune() {
  orchMoreOpen.value = false;
  void runPrune(false);
}

/** 弹窗关闭统一入口（✕/关闭/遮罩/Esc 共用）：有未保存修改时先确认再丢 */
async function closeOrchestration() {
  if (orchOpen.value && orchDirty.value) {
    // 脏检查兜底：此前四个关闭路径都直连 orchOpen=false，编辑中的 YAML 改动会被静默丢弃
    const ok = await askConfirm({
      title: '放弃未保存的修改？',
      message: '编排文件内容已被修改且尚未保存到文件，关闭将丢弃这些改动。',
      confirmText: '丢弃并关闭',
      /* danger:false = 「放弃未保存修改」统一档（2026-10-06 审核 §主题 7）：
         与 Skill 详情页三处（刷新/切换 Skill/关闭本页）同语义，
         原为 true 造成同一语义两页分级相反。doc/ADMIN_VISUAL_LAYER_SPEC.md §0.5「危险确认」的
         19 处清单以此档为准，本条已登记。 */
      danger: false,
    });
    if (!ok) return;
  }
  orchOpen.value = false;
}

useEscape(() => orchOpen.value, () => { void closeOrchestration(); });
useOverlay(orchOpen, orchPanelRef);
useMaskClose(orchMaskRef, () => { void closeOrchestration(); });

function errOf(e: any) {
  return e?.response?.data?.error?.message || e?.message || '操作失败';
}

async function openOrchestration() {
  orchMsg.value = '';
  pruneConfirming.value = false;
  try {
    const res = await adminFieldRoutingsApi.getOrchestrationFile(props.stage);
    const data = res.data?.data || {};
    orchContent.value = data.content || '';
    orchBaseline.value = orchContent.value; // 记录打开时快照，供脏检查比对
    orchSummary.value = data.parsed || { contractCount: 0, fieldCount: 0, routingCount: 0 };
    orchOpen.value = true;
  } catch (e: any) {
    toast.error(errOf(e));
  }
}

/**
 * 清理孤儿行（P2 补全，变更路径审计 C 缺口）：编排文件为唯一声明源，
 * 声明删除 → DB 孤儿行清理。流程：先预检展示候选清单 → 确认后执行
 * （执行前逐行写配置变更审计；admin 覆盖行只报告不删）。
 */
async function runPrune(apply: boolean) {
  orchMsg.value = '';
  orchPruning.value = true;
  try {
    const res = await adminFieldRoutingsApi.pruneOrchestrationFile(props.stage, !apply);
    const data = res.data?.data || {};
    const candidates: Array<{ table: string; key: string }> = Array.isArray(data.candidates) ? data.candidates : [];
    const byTable = (t: string) => candidates.filter((c) => c.table === t).length;
    const protectedCount: number = Array.isArray(data.protectedRows) ? data.protectedRows.length : 0;

    let msg = '';
    if (data.dryRun) {
      msg = `预检：孤儿行 ${candidates.length} 条（契约 ${byTable('agent_contracts')} · 字段 ${byTable('field_definitions')} · 路由 ${byTable('agent_field_routings')}）`;
      if (candidates.length) {
        msg += '。确认无误后清理冗余配置';
        pruneConfirming.value = true;
      } else {
        msg += '。无待清理孤儿行';
        pruneConfirming.value = false;
      }
    } else {
      msg = `已清理 ${data.deletedCount ?? 0} 行孤儿数据（契约 ${byTable('agent_contracts')} · 字段 ${byTable('field_definitions')} · 路由 ${byTable('agent_field_routings')}）`;
      if (Array.isArray(data.auditIds) && data.auditIds.length) {
        msg += `。已记录审计 ${data.auditIds.length} 条`;
      }
      pruneConfirming.value = false;
    }
    if (protectedCount) {
      msg += `。平台覆盖的字段跳过 ${protectedCount} 条（只报告不删）`;
    }
    orchMsg.value = msg;

    if (!data.dryRun) {
      toast.success('孤儿行清理完成');
      await loadStage();
      emit('changed');
    }
  } catch (e: any) {
    orchMsg.value = errOf(e);
    pruneConfirming.value = false;
  } finally {
    orchPruning.value = false;
  }
}

async function saveOrchestration() {
  orchMsg.value = '';
  if (!orchContent.value.trim()) {
    orchMsg.value = '内容为空，未保存';
    return;
  }
  // 写盘前轻量确认：保存即覆写磁盘上的字段路由唯一声明源（对齐 forceSync 的二次确认；落库另走「同步到 DB」）
  const ok = await askConfirm({
    title: TERMS.saveToFile,
    message: `将以当前编辑内容覆写 prompts/orchestration/${props.stage}.yaml。此操作只写编排文件，不影响数据库。`,
    confirmText: '保存到文件',
    danger: false,
  });
  if (!ok) return;
  orchSaving.value = true;
  try {
    const res = await adminFieldRoutingsApi.saveOrchestrationFile(props.stage, orchContent.value);
    const data = res.data?.data || {};
    orchSummary.value = {
      contractCount: Number(data.contractCount) || 0,
      fieldCount: Number(data.fieldCount) || 0,
      routingCount: Number(data.routingCount) || 0,
    };
    orchMsg.value = data.syncHint || '已保存';
    orchBaseline.value = orchContent.value; // 保存成功后重置脏基线，关闭不再拦截
    toast.success('编排文件已保存');
    await loadStage();
    emit('changed');
  } catch (e: any) {
    orchMsg.value = errOf(e);
  } finally {
    orchSaving.value = false;
  }
}

async function forceSync() {
  // 安全审计 K-M1：同步（全量对账覆写三表）执行前二次确认，注明影响范围
  const ok = await askConfirm({
    title: TERMS.syncToDb,
    message: `将对「${props.stage}」阶段执行全量一致性核查：以编排文件为准，覆写字段契约、字段定义与字段路由，平台覆盖的字段跳过（只报告不改）。`,
    confirmText: '执行同步',
    danger: false,
  })
  if (!ok) return
  orchMsg.value = '';
  orchSyncing.value = true;
  try {
    const res = await adminFieldRoutingsApi.syncOrchestrationFile(props.stage);
    const data = res.data?.data || {};
    const skipped: Array<{ table: string; key: string }> = Array.isArray(data.skippedAdminRows) ? data.skippedAdminRows : [];
    let msg = `${TERMS.reconcile}完成：契约 ${data.contractsUpdated ?? 0} · 字段 ${data.fieldsUpdated ?? 0} · 路由 ${data.routingsUpdated ?? 0} · 新建 ${data.createdCount ?? 0}`;
    if (skipped.length) {
      const sample = skipped.slice(0, 5).map((s) => `${s.table}:${s.key}`).join('、');
      msg += `。跳过平台覆盖的字段 ${skipped.length} 条（${sample}${skipped.length > 5 ? '…' : ''}）`;
    } else {
      msg += '。无平台覆盖的字段被跳过';
    }
    orchMsg.value = msg;
    toast.success(TERMS.syncDone);
    await loadStage();
    emit('changed');
  } catch (e: any) {
    orchMsg.value = errOf(e);
  } finally {
    orchSyncing.value = false;
  }
}

onMounted(() => void loadStage());
watch(() => props.stage, () => void loadStage());

/** 编排文件弹窗的宿主在阶段页签行（Orchestrator），由它经 ref 调起 */
defineExpose({ openOrchestration });
</script>

<style scoped>
/* 原型 .note：说明/提示行（surface-2 底 + muted 小字；--info 走品牌蓝底） */
.note {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.55;
}
.note--info { background: var(--mk-blue-bg); color: var(--mk-blue); }
/* 暗色对比度（2026-10-06 复核）：--mk-blue(#5b8def) 压在 --mk-blue-bg(16% 蓝 tint，合成 #293244)
   上仅 3.98:1 < 4.5。暗色覆写文字色为同族提亮档 --mk-badge-info-fg(#9db8f5，实测 6.49:1)，底色不动。 */
html[data-theme='dark'] .note--info { color: var(--mk-badge-info-fg); }

/* ========== 搜索 / 过滤 ========== */
.frt__filter { margin-bottom: 12px; }
.frt__filter-count { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; font-variant-numeric: tabular-nums; }
/* 弹窗底部的整文件级动作收在「更多」里：菜单在底栏内向上展开（弹窗 overflow:hidden，
   向下展开会被裁掉） */
.frt__orch-more { position: relative; }
.frt__orch-more .mk-menu__pop { top: auto; bottom: calc(100% + 4px); }

.frt__orch-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-bg);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.frt__orch-summary .mono { color: var(--mk-blue); font-weight: 600; }
.frt__orch-textarea {
  width: 100%;
  min-height: 420px;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-bg);
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
  line-height: 1.55;
  resize: vertical;
  outline: none;
}
.frt__orch-textarea:focus { border-color: var(--mk-blue); }
/* 提示/速查/结果行统一走 .note（视觉在 .note/.note--info，本类只留边距） */
.frt__orch-msg { margin: 0; font-weight: 600; }

/* 清理孤儿行（P2：预检只报告，普通文字钮；确认态走全局 .mk-btn--danger 危险钮，自搓红/琥珀变体已删） */
/* flex-shrink: 0 —— 拆回独立 tab 后 .frt 被外层 fill 容器约束高度，
   无 shrink:0 时 flex 子项按比例压扁（仿真 10 卡只剩 5-11px 细条），
   改为不收缩 + 外层 .frt 容器自身滚动。
   卡体走全局 .mk-card（描边/圆角/底/阴影统一），本类只留堆叠与表格圆角裁切 */
.frt__agent { flex-shrink: 0; margin-bottom: 18px; overflow: hidden; }
/* 卡头走全局 .mk-card__head（title + sub）；本类不再覆写底色/描边/内边距 */
.frt__agenthead { gap: 10px; }
.frt__agentname { font-weight: 700; }
/* 描述作为 sub：单行截断，不与右侧行数徽章抢位 */
.frt__agentdesc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 字段列表（2026-10-28 用户「既然是个列表，就遵守列表的设计」）：一行一个字段条目，
   不再用宽表 + 列头。首行字段名/角色/状态，次行含义，末行类型与路由元信息。
   列表随页面滚动，不设内部 max-height（列表页不需要表头吸顶，也就不需要嵌套滚动）。 */
.frt__scroll { overflow: visible; }
.frt__list { margin: 0; padding: 0; list-style: none; }
.frt__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mk-line);
}
.frt__item:last-child { border-bottom: none; }

/* 左列角色：固定槽宽，主区（字段名/含义）跨行对齐；无角色的行留破折号，不塌槽 */
.frt__role { flex: none; width: 66px; display: flex; padding-top: 1px; }
.frt__itemmain { display: grid; gap: 2px; min-width: 0; flex: 1; }
.frt__itemhead { display: flex; align-items: center; gap: 6px; min-width: 0; line-height: 1.35; }
.frt__field {
  min-width: 0;
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.frt__itemhead .mk-badge { flex: none; }
.frt__itemspacer { flex: 1; min-width: 8px; }

/* 含义：列表副行单行省略，完整文案在 title；保证每行等高、扫读节奏一致 */
.frt__meaning {
  margin: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 元信息行：类型 / 抽取路径 / 移交 / 存储别名 / 锁定，均可换行 */
.frt__metaline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
}
/* 元信息之间补中点分隔；高亮 chip（存为 / 锁定）自身成块，不再加分隔 */
.frt__metaline > span + span::before {
  content: '·';
  margin-right: 8px;
  color: var(--mk-faint);
}
.frt__metaline > .frt__alias::before,
.frt__metaline > .mk-badge::before { content: none; }
.frt__type { color: var(--mk-muted); }
.frt__alias { color: var(--mk-amber); background: var(--mk-amber-bg); border-radius: var(--mk-radius-sm); padding: 0 5px; }
.frt__handoff { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frt__lockchip { font-size: var(--mk-fs-micro); padding: 0 5px; line-height: 1.5; }

/* 编排弹窗值域速查条：视觉走 .note--info，本类只留排版 */
.frt__orch-quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin-top: 8px;
  color: var(--mk-muted);
}
.frt__orch-quick-title { font-weight: 800; color: var(--mk-blue); }
.frt__orch-quick-item b { margin-right: 4px; color: var(--mk-ink); }

@media (min-width: 2000px) {
  .frt__filter-count { font-size: var(--mk-fs-micro); }
  .frt__orch-summary { font-size: var(--mk-fs-micro); }
  .frt__orch-textarea { font-size: var(--mk-fs-micro); padding: 14px; }
  .frt__orch-msg { font-size: var(--mk-fs-micro); }
  .frt__orch-quick { font-size: var(--mk-fs-micro); }
  .frt__agentdesc { font-size: var(--mk-fs-micro); }
  }

@media (min-width: 2800px) {
  .frt__filter-count { font-size: var(--mk-fs-micro); }
  .frt__orch-summary { font-size: var(--mk-fs-micro); }
  .frt__orch-textarea { font-size: var(--mk-fs-micro); padding: 17px; }
  .frt__orch-msg { font-size: var(--mk-fs-micro); }
  .frt__orch-quick { font-size: var(--mk-fs-micro); }
  .frt__agentdesc { font-size: var(--mk-fs-micro); }
}

/* 暗色模式：色值全部走 --mk-* token（surface/line/blue-bg/faint/bg 随主题自动翻转），
   原先的亮色硬编码 + 暗色补丁段已删（无残留规则）。 */
</style>
