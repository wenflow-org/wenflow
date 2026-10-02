<template>
  <div class="frt">
    <!-- 吸顶操作条（滚动修复 #1：长表关键操作常驻顶部） -->
    <div class="frt__stickybar">
      <div class="frt__toolbar">
        <button type="button" class="mk-btn" :disabled="!stage" @click="openOrchestration">编排文件</button>
        <span class="frt__toolbar-hint">编辑 prompts/orchestration/{{ stage }}.yaml（字段路由唯一声明源）</span>
      </div>
    </div>
    <!-- 原型 .note--info：入口说明（不再自搓虚线蓝框） -->
    <p class="note note--info frt__notice">
      行级编辑已收敛：修改字段路由请使用右上角「编排文件」按钮，保存后新建行即时生效，已有行修改后点「{{ TERMS.syncToDb }}」
    </p>

    <!-- core 联动提示条（M3 轻量：当前 stage 各 skill 的 fields-sync 状态角标） -->
    <div v-if="skillSyncs.length" class="note frt-syncbar">
      <span class="frt-syncbar__title">core 联动</span>
      <button
        v-for="s in skillSyncs"
        :key="s.skillId"
        type="button"
        class="frt-syncbar__badge mk-badge"
        :class="s.tone === 'err' ? 'mk-badge--bad' : `mk-badge--${s.tone}`"
        :title="s.title"
        @click="goSkill(s.skillId)"
      >
        <code class="mono">{{ s.skillId }}</code>
        <template v-if="s.sync">
          <span v-if="s.sync.missing.length" class="frt-syncbar__count">{{ TERMS.statusMissing }} {{ s.sync.missing.length }}</span>
          <span v-else-if="s.sync.state === 'ok'">✓ {{ TERMS.fieldsSynced }}</span>
          <span v-else-if="s.sync.state === 'no-core'">core 缺失</span>
          <span v-else-if="s.sync.state === 'no-routings'">无产出行</span>
          <span v-else>✓ 已声明</span>
          <span v-if="s.sync.orphan.length" class="frt-syncbar__count">{{ TERMS.statusOrphan }} {{ s.sync.orphan.length }}</span>
          <span v-if="s.sync.typeMismatch.length" class="frt-syncbar__count">类型不一致 {{ s.sync.typeMismatch.length }}</span>
        </template>
        <span v-else class="frt-syncbar__count">未核对</span>
      </button>
      <span class="frt-syncbar__hint">该字段未登记 core 声明 / 未登记路由 → 去 Skill 设计页补全（字段路由 tab）</span>
    </div>
    <div v-else-if="skillSyncLoading" class="note frt-syncbar frt-syncbar--muted">
      <span class="frt-syncbar__title">core 联动</span>
      <span class="frt-syncbar__hint">逐 skill 核对 core 声明状态…</span>
    </div>

    <!-- 图例：角色 / render / 锁定 / 流转 一句话人话表（可折叠） -->
    <details class="frt__legend" :open="legendOpen" @toggle="legendOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="mk-section__summary mk-section__summary--muted">图例：字段角色 / 对外可见性 / 锁定 / 流转 —— 不懂就看这里</summary>
      <div class="frt__legend-body">
        <div class="frt__legend-group frt__legend-group--roles">
          <h5 class="frt__legend-title">字段角色（promptRole）</h5>
          <ul v-if="roleMeta.length" class="frt__legend-list">
            <li v-for="m in roleMeta" :key="m.id" class="frt__legend-item">
              <span class="mk-badge" :class="`mk-badge--role-${m.id}`">{{ m.label }}</span>
              <span class="frt__legend-en mono">{{ m.id }}</span>
              <span class="frt__legend-hint">{{ m.hint }}</span>
            </li>
          </ul>
          <p v-else class="frt__legend-loading">角色词表待后端下发…</p>
        </div>
        <div class="frt__legend-group">
          <h5 class="frt__legend-title">render（是否对外可见）</h5>
          <ul class="frt__legend-list">
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--render-visible" title="render: visible">可见</span>
              <span class="frt__legend-hint">可见：会出现在对外交付（用户 / 界面）</span>
            </li>
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--render-hidden" title="render: hidden">隐藏</span>
              <span class="frt__legend-hint">隐藏：仅内部流转，不对外展示</span>
            </li>
          </ul>
          <h5 class="frt__legend-title">流转（handoff / internal / accumulate）</h5>
          <ul class="frt__legend-list">
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--flow-handoff">handoff</span>
              <span class="frt__legend-hint">移交：字段产完后交给谁——下一阶段名（如 path）/ agent / skill；空 = 不转交</span>
            </li>
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--flow-internal">internal</span>
              <span class="frt__legend-hint">内部信令：仅供平台内部 / UI 控制使用，不进业务状态</span>
            </li>
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--flow-accumulate">accumulate</span>
              <span class="frt__legend-hint">累积：值会累积进学习者状态（画像 / 上下文），供后续阶段持续使用</span>
            </li>
          </ul>
          <h5 class="frt__legend-title">落库键（persistKey）</h5>
          <ul class="frt__legend-list">
            <li class="frt__legend-item">
              <span class="frt__legend-hint">字段值最终写入主库的键路径；与字段名不一致的字段（如 reply → 消息正文）单独标注，一致时默认显示字段名</span>
            </li>
          </ul>
          <h5 class="frt__legend-title">锁定</h5>
          <ul class="frt__legend-list">
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--lock-system">系统锁</span>
              <span class="frt__legend-hint">平台派生 / 代码消费，admin 不可直接改（需改编排文件）</span>
            </li>
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--lock-structure">结构锁</span>
              <span class="frt__legend-hint">结构约束锁定，修改需谨慎</span>
            </li>
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--lock-editable">可编辑</span>
              <span class="frt__legend-hint">可自由调整（仍走编排文件入口）</span>
            </li>
          </ul>
        </div>
      </div>
      <p class="frt__legend-foot">
        机制说明见仓库 <span class="mono">prompts/orchestration/_README.md</span> · 术语查「这是什么」抽屉
      </p>
    </details>

    <!-- 搜索 / 角色过滤 -->
    <div class="mk-filter frt__filter">
      <MkFilterSearch v-model="keyword" type="search" placeholder="搜索字段名 / 含义 / 角色 / 可见性 / 移交…" />
      <select v-model="roleFilter" class="mk-filter__select" aria-label="按角色过滤">
        <option value="">全部角色</option>
        <option v-for="m in roleMeta" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
      </select>
      <select v-model="sortKey" class="mk-filter__select" aria-label="组内排序字段">
        <option value="">默认顺序</option>
        <option value="field">字段名</option>
        <option value="role">角色</option>
        <option value="render">可见性</option>
        <option value="type">类型</option>
        <option value="meaning">含义</option>
      </select>
      <button
        type="button"
        class="mk-btn mk-btn--sm"
        :disabled="!sortKey"
        :title="sortDir === 'asc' ? '当前升序，点击切换为降序' : '当前降序，点击切换为升序'"
        @click="toggleDir"
      >{{ sortDir === 'asc' ? '升序' : '降序' }}</button>
      <button v-if="filterActive" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
      <span v-if="filterActive" class="frt__filter-count">命中 {{ filteredTotal }} / {{ routings.length }} 行</span>
    </div>

    <MkLoading v-if="loading" />
    <MkEmptyState v-else-if="error" tone="error" :title="error" action-text="重试" compact @action="loadStage" />
    <template v-else>
      <!-- 空态带 CTA（原型 .empty）：本阶段无任何 Agent 分组 -->
      <MkEmptyState
        v-if="!agents.length"
        title="该阶段暂无字段路由"
        description="编排文件未声明字段路由，或接口暂不可用。可点击「重试」重新拉取。"
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
          <div v-if="rowsOf(agent.agentId).length" class="frt__scroll mk-table-scroll">
            <!-- 原型 .tbl：自动布局（去 mk-table--fixed 与 <colgroup>），
                 单元格 nowrap；长文本列（含义）走 wrap 列，长标识列 max-width+ellipsis 截断 -->
            <table class="mk-table mk-table--dense frt__table">
              <thead>
                <tr>
                  <th scope="col">字段</th>
                  <th scope="col" class="frt__wrap">含义</th>
                  <th scope="col">类型</th>
                  <th scope="col">角色</th>
                  <th scope="col">可见性</th>
                  <th scope="col">移交</th>
                  <th scope="col">内部</th>
                  <th scope="col">累积</th>
                  <th scope="col">落库键</th>
                  <th scope="col">锁定</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rowsOf(agent.agentId)" :key="row.id">
                  <td class="frt__fieldcell">
                    <span class="mono frt__field" :title="row.fieldId">{{ row.fieldId }}</span>
                    <span v-if="pathParts(row.fieldId).length > 1" class="frt__fieldpath" :title="row.fieldId">{{ pathParts(row.fieldId).join(' · ') }}</span>
                    <span v-if="pathOf(row.fieldId)" class="frt__fieldpath" :title="`抽取路径（pathInRawOutput）：${pathOf(row.fieldId)}`">抽取 → {{ String(pathOf(row.fieldId)).split('.').pop() }}</span>
                  </td>
                  <td class="frt__meaning">
                    <span class="frt__meaning-text" :title="meaningTitle(row)">{{ descOf(row.fieldId) || '—' }}</span>
                  </td>
                  <td class="mono">{{ typeOf(row.fieldId) }}</td>
                  <td>
                    <span
                      v-if="roleMetaOf(row.fieldId)"
                      class="mk-badge"
                      :class="`mk-badge--role-${roleMetaOf(row.fieldId)!.id}`"
                      :title="roleMetaOf(row.fieldId)!.hint"
                    >{{ roleMetaOf(row.fieldId)!.label }}</span>
                    <span v-else class="mk-na">—</span>
                  </td>
                  <td>
                    <span
                      class="mk-badge"
                      :class="`mk-badge--render-${row.render}`"
                      :title="renderHint(row)"
                    >{{ renderText(row.render) }}</span>
                  </td>
                  <td><span class="mono frt__handoff" :title="handoffTitle(row)">{{ formatHandoff(row.handoff) }}</span></td>
                  <td>{{ row.internal ? '是' : '否' }}</td>
                  <td>{{ row.accumulate ? '是' : '否' }}</td>
                  <td>
                    <span
                      class="mono frt__persist"
                      :class="{ 'frt__persist--alias': persistKeyOf(row) !== row.fieldId }"
                      :title="persistKeyOf(row) === row.fieldId
                        ? '落库键与字段名一致'
                        : `值实际写入 ${persistKeyOf(row)}`"
                    >{{ persistKeyOf(row) }}</span>
                  </td>
                  <td><span class="mk-badge" :class="`mk-badge--lock-${row.locks?.level || 'editable'}`" :title="lockHint(row.locks?.level)">{{ lockLabel(row.locks?.level) }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- 空态带 CTA：筛选无命中 → 清除筛选；否则仅说明 -->
          <MkEmptyState
            v-else
            compact
            :title="filterActive ? '无匹配行' : '该 Agent 无字段路由行'"
            :description="filterActive ? '试试调整搜索关键词或角色过滤。' : '本阶段该 Agent 暂无产出行声明。'"
            :action-text="filterActive ? '清除筛选' : ''"
            @action="clearFilter"
          />
          <!-- 每 agent 组分页（统一 mk-pagination 页码器：固定 15 行/页，隐藏每页条数） -->
          <Pagination
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
            <span class="frt__orch-quick-item"><b>字段角色</b>{{ roleNames }}（promptRole）</span>
            <span class="frt__orch-quick-item"><b>对外可见性</b>可见 / 隐藏（render）</span>
            <span class="frt__orch-quick-item"><b>流转去向</b>阶段名（goal/path/teaching/profile/simulation）或 agent / skill:（handoff）</span>
            <span class="frt__orch-quick-item"><b>落库键</b>仅落库键与 fieldId 不一致时标注（persistKey）</span>
          </div>
          <textarea
            v-model="orchContent"
            class="frt__orch-textarea mono"
            rows="26"
            spellcheck="false"
            placeholder="编排文件 YAML 原文…"
          ></textarea>
          <p v-if="orchMsg" class="note note--info frt__orch-msg">{{ orchMsg }}</p>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" :disabled="orchSaving || orchSyncing || orchPruning" @click="closeOrchestration">关闭</button>
          <button type="button" class="mk-btn" :disabled="orchSaving || orchSyncing || orchPruning" @click="runPrune(false)">
            {{ orchPruning ? '清理中…' : '清理孤儿行' }}
          </button>
          <button
            v-if="pruneConfirming"
            type="button"
            class="mk-btn mk-btn--danger"
            :disabled="orchSaving || orchSyncing || orchPruning"
            @click="runPrune(true)"
          >确认清理冗余配置</button>
          <button type="button" class="mk-btn" :disabled="orchSaving || orchSyncing || orchPruning" @click="forceSync">{{ TERMS.syncToDb }}</button>
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
import { useRouter } from 'vue-router';
import { adminFieldRoutingsApi } from '@/api/adminApi';
import { useEscape } from './useEscape';
import { useOverlay, useMaskClose } from './useOverlay';
import { toast } from '@/utils/toast';
import { askConfirm } from './useConfirm';
import { TERMS } from './terms';
import { errMsg } from './live';
import Pagination from './Pagination.vue';
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue';
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
const legendOpen = ref(false);

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
function pathParts(fieldId: string) { return fieldId.split('.'); }
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
/** render 枚举 → 中文（原始值保留在 title 的 renderHint）；未知取值回显原值，避免被误标为「可见」 */
function renderText(render: string) {
  if (render === 'hidden') return '隐藏'
  if (render === 'visible') return '可见'
  return render
}

function renderHint(row: RoutingItem) {
  const base = row.render === 'hidden'
    ? '隐藏：仅内部流转，不对外展示'
    : row.render === 'visible'
      ? '可见：会出现在对外交付（用户 / 界面）'
      : `render 取值不在受控词表：${row.render}`;
  return row.visibilityPreset ? `${base}\n可见性预设：${row.visibilityPreset}` : base;
}
function lockLabel(level?: string) {
  if (level === 'system-locked') return '系统锁';
  if (level === 'structure-locked') return '结构锁';
  return '可编辑';
}
function lockHint(level?: string) {
  if (level === 'system-locked') return '系统锁：平台派生 / 代码消费，admin 不可直接改（需改编排文件）';
  if (level === 'structure-locked') return '结构锁：结构约束锁定，修改需谨慎';
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
    await loadSkillSyncs();
  } catch (e: any) {
    // 人话化走全站单源 errMsg（此前直出 e?.message，网关/限流黑话管理员看不懂）
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

/* ============ core 联动（M3 轻量）：当前 stage 各 skill 的 fields-sync 状态角标 ============ */

interface SkillSyncBadge {
  skillId: string;
  sync: {
    state?: string;
    missing: Array<unknown>;
    orphan: Array<unknown>;
    typeMismatch: Array<unknown>;
  } | null;
  tone: 'ok' | 'warn' | 'err' | 'muted';
  title: string;
}

const router = useRouter();
const skillSyncs = ref<SkillSyncBadge[]>([]);
const skillSyncLoading = ref(false);

/**
 * 批量拉当前 stage 全部 skill 的 core-sync 投影（GET /field-routings/skill-batch?stage=X）。
 * P2 N+1 收尾：此前逐 skill GET /skill/:skillId + Promise.all（请求数 = skill 数），
 * 现改一次批量拉全。响应字段与旧逐个拉取的合并结果对齐，无需字段映射：
 *   data.skills[i].skillId   ↔ 旧由 agentId 去前缀反解
 *   data.skills[i].core.sync ↔ 旧 res.data.data.core.sync
 * 唯一差异 promptRoleMeta 收敛到 data 顶层（本函数不消费该元信息）。
 * 失败静默降级（角标整体不显示）：批量为单请求，部分成功语义不再保留（旧版可跳过单 skill 失败）。
 * save/sync/prune 后维持全量 loadStage：三者均整阶段文件改动，全量刷新语义正确，无需增量。
 */
async function loadSkillSyncs() {
  const skillAgents = agents.value
    .map((a) => a.agentId)
    .filter((id) => id.startsWith('skill:'));
  if (!skillAgents.length) {
    skillSyncs.value = [];
    skillSyncLoading.value = false;
    return;
  }
  skillSyncLoading.value = true;
  try {
    const res = await adminFieldRoutingsApi.getSkillBatch(props.stage);
    // 与旧逐个拉取同口径：只保留当前 stage 详情 agents 里登记的 skill，
    // 编排文件与 skills.yaml 极端漂移时不引入多余额标
    const want = new Set(skillAgents.map((id) => id.replace(/^skill:/, '')));
    skillSyncs.value = ((res.data?.data?.skills ?? []) as Array<{ skillId: string; core?: { sync?: SkillSyncBadge['sync'] } }>)
      .filter((s) => want.has(s.skillId))
      .map((s) => {
        const sync = s.core?.sync ?? null;
        const tone = !sync
          ? 'muted'
          : sync.missing.length
            ? 'err'
            : sync.orphan.length || sync.typeMismatch.length
              ? 'warn'
              : 'ok';
        const title = [
          sync?.state === 'no-core' ? 'core 文件缺失（协议 tab 未建核心声明）' : '',
          sync ? `${TERMS.statusMissing} ${sync.missing.length} · ${TERMS.statusOrphan} ${sync.orphan.length} · 类型不一致 ${sync.typeMismatch.length}` : 'core 投影不可用'
        ].filter(Boolean).join('\n');
        return { skillId: s.skillId, sync, tone, title };
      });
  } catch {
    skillSyncs.value = [];
  } finally {
    skillSyncLoading.value = false;
  }
}

function goSkill(skillId: string) {
  void router.push({ path: `/admin/skills/${skillId}`, query: { tab: 'routing' } });
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

/** 弹窗关闭统一入口（✕/关闭/遮罩/Esc 共用）：有未保存修改时先确认再丢 */
async function closeOrchestration() {
  if (orchOpen.value && orchDirty.value) {
    // 脏检查兜底：此前四个关闭路径都直连 orchOpen=false，编辑中的 YAML 改动会被静默丢弃
    const ok = await askConfirm({
      title: '放弃未保存的修改？',
      message: '编排文件内容已被修改且尚未保存到文件，关闭将丢弃这些改动。',
      confirmText: '丢弃并关闭',
      danger: true,
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
        msg += '；确认无误后点「确认清理冗余配置」执行';
        pruneConfirming.value = true;
      } else {
        msg += '；无待清理孤儿行';
        pruneConfirming.value = false;
      }
    } else {
      msg = `已清理 ${data.deletedCount ?? 0} 行孤儿数据（契约 ${byTable('agent_contracts')} · 字段 ${byTable('field_definitions')} · 路由 ${byTable('agent_field_routings')}）`;
      if (Array.isArray(data.auditIds) && data.auditIds.length) {
        msg += `；审计留痕 ${data.auditIds.length} 条（孤儿清理）`;
      }
      pruneConfirming.value = false;
    }
    if (protectedCount) {
      msg += `；admin 覆盖行跳过 ${protectedCount} 条（只报告不删）`;
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
    message: `将以当前编辑内容覆写 prompts/orchestration/${props.stage}.yaml。此操作只写编排文件，不影响数据库；落库需再点「${TERMS.syncToDb}」。`,
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
    message: `将对「${props.stage}」阶段执行全量对账：以编排 YAML 为唯一声明源，覆写 agent_contracts / field_definitions / agent_field_routings 三表；admin 覆盖行跳过（只报告不改）。`,
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
      msg += `；跳过 admin 覆盖行 ${skipped.length} 条（${sample}${skipped.length > 5 ? '…' : ''}）`;
    } else {
      msg += '；无 admin 覆盖行被跳过';
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
</script>

<style scoped>
.frt__toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
/* 吸顶操作条（滚动修复 #1）：长表关键操作常驻顶部，负 margin 满宽于 tab 面板。
   磨砂底走 token 混色（原亮/暗两份 rgba 硬编码已删） */
.frt__stickybar {
  position: sticky;
  top: 0;
  z-index: 25;
  margin: -14px -16px 14px;
  padding: 10px 16px 8px;
  /* 粘性表头：94% 半透明 + backdrop-filter: blur(8px) 的毛玻璃已退役
     （批次 D，2026-10-02），改为不透明面 + 1px 下缘线。
     粘性表头下滚时内容会从其下穿过，半透明无模糊会让文字「糊在一起」，
     比纯平面更难读；规范的做法是给足不透明面 + 发丝线，靠线表达「这层在上面」。
     box-shadow: var(--mk-shadow-sm) 保留——那是规范内的悬浮档，不是彩色光晕。 */
  background: var(--mk-surface);
  border-bottom: 1px solid var(--mk-line);
  box-shadow: var(--mk-shadow-sm);
}
.frt__stickybar .frt__toolbar { margin-bottom: 0; }
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
.frt__notice { font-weight: 600; }
.frt__toolbar-hint { color: var(--mk-faint); font-size: var(--mk-fs-micro); }

/* ========== core 联动提示条（M3） ========== */
.frt-syncbar {
  display: flex;
  align-items: center;
  gap: 6px 12px;
  flex-wrap: wrap;
  margin: 0 0 12px;
}
.frt-syncbar--muted { color: var(--mk-muted); }
.frt-syncbar__title { font-weight: 800; color: var(--mk-blue); }
/* 胶囊徽章走全局 .mk-badge（--ok/--warn/--bad/--muted 四态）；本类只保留按钮复位与悬停反馈 */
.frt-syncbar__badge {
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
  transition: filter 0.12s ease;
}
.frt-syncbar__badge:hover { filter: brightness(0.97); }
.frt-syncbar__badge code { font-size: var(--mk-fs-micro); }
.frt-syncbar__count { font-size: var(--mk-fs-micro); font-variant-numeric: tabular-nums; }
.frt-syncbar__hint { color: var(--mk-muted); }

/* ========== 图例（可折叠） ========== */
.frt__legend {
  margin: 0 0 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-sm);
}
/* 折叠头走 .mk-section__summary（shared.css） */
/* hover 基调由 .mk-section__summary 提供（统一 → --mk-blue） */
.frt__legend-body {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
  padding: 4px 14px 10px;
}
@media (max-width: 860px) {
  .frt__legend-body { grid-template-columns: 1fr; }
}
.frt__legend-title {
  margin: 0 0 6px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mk-faint);
}
.frt__legend-group--roles + .frt__legend-group .frt__legend-title { margin-top: 10px; }
.frt__legend-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.frt__legend-loading { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.frt__legend-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
.frt__legend-en { flex-shrink: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.frt__legend-hint { font-size: var(--mk-fs-micro); color: var(--mk-muted); min-width: 0; }
.frt__legend-foot {
  margin: 0;
  padding: 6px 14px 10px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
}
.frt__legend-foot .mono { font-size: var(--mk-fs-micro); color: var(--mk-blue); }

/* ========== 搜索 / 过滤 ========== */
.frt__filter { margin-bottom: 12px; }
.frt__filter-count { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; font-variant-numeric: tabular-nums; }

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
/* 表格本体已并入 mk-table mk-table--dense：仅保留滚动容器（限高 + 粘性表头生效） */
/* 横向+纵向滚动容器（滚动修复 #1）：表头 sticky 吸顶，容器限高内部滚动，页面本体不被撑长 */
.frt__scroll { overflow: auto; max-height: 62vh; }
/* 原型 .tbl td nowrap：自动布局下单元格单行，列按内容自然分宽 */
.frt__table td { white-space: nowrap; }
@media (max-width: 860px) {
  .frt__table { min-width: 1060px; }
}

/* 字段列：点分名 + 层级分段小字。
   行高统一修复：fieldId 由 word-break:break-all 改单行 ellipsis（不再折行撑高） */
.frt__fieldcell { max-width: 300px; display: grid; gap: 2px; min-width: 0; }
.frt__field { display: block; min-width: 0; color: var(--mk-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frt__fieldpath {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 原型 .tbl td.wrap：含义是长文本列 → 换行不截断（完整文案仍在 title） */
.frt__table th.frt__wrap, .frt__table td.frt__wrap { white-space: normal; min-width: 220px; }
.frt__meaning { min-width: 220px; }
.frt__meaning-text {
  display: block;
  max-width: 340px;
  white-space: normal;
  overflow-wrap: anywhere;
  color: var(--mk-muted);
  line-height: 1.5;
}

/* 角色徽章（7 类着色，与图例共用） */
/* render 徽章 */
/* 流转徽章（图例） */
/* 落库键列：截断上限统一引用 token（原散落 180px） */
.frt__persist { display: inline-block; max-width: var(--mk-col-id); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.frt__persist--alias { color: var(--mk-amber); background: var(--mk-amber-bg); border-radius: var(--mk-radius-sm); padding: 0 5px; }

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

.frt__handoff { max-width: var(--mk-col-id); color: var(--mk-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (min-width: 2000px) {
  .frt__toolbar-hint { font-size: var(--mk-fs-micro); }
  .frt__notice { font-size: var(--mk-fs-micro); padding: 11px 14px; }
  .frt__legend-title { font-size: var(--mk-fs-micro); }
  .frt__legend-loading { font-size: var(--mk-fs-micro); }
  .frt__legend-en { font-size: var(--mk-fs-micro); }
  .frt__legend-hint { font-size: var(--mk-fs-micro); }
  .frt__legend-foot { font-size: var(--mk-fs-micro); }
  .frt__legend-foot .mono { font-size: var(--mk-fs-micro); }
  .frt__filter-count { font-size: var(--mk-fs-micro); }
  .frt__orch-summary { font-size: var(--mk-fs-micro); }
  .frt__orch-textarea { font-size: var(--mk-fs-micro); padding: 14px; }
  .frt__orch-msg { font-size: var(--mk-fs-micro); }
  .frt__orch-quick { font-size: var(--mk-fs-micro); }
  .frt__agentdesc { font-size: var(--mk-fs-micro); }
  .frt__fieldpath { font-size: var(--mk-fs-micro); }
  .frt__persist { font-size: var(--mk-fs-micro); }
  }

@media (min-width: 2800px) {
  .frt__toolbar-hint { font-size: var(--mk-fs-micro); }
  .frt__notice { font-size: var(--mk-fs-micro); padding: 13px 17px; }
  .frt__legend-title { font-size: var(--mk-fs-micro); }
  .frt__legend-loading { font-size: var(--mk-fs-micro); }
  .frt__legend-en { font-size: var(--mk-fs-micro); }
  .frt__legend-hint { font-size: var(--mk-fs-micro); }
  .frt__legend-foot { font-size: var(--mk-fs-micro); }
  .frt__legend-foot .mono { font-size: var(--mk-fs-micro); }
  .frt__filter-count { font-size: var(--mk-fs-micro); }
  .frt__orch-summary { font-size: var(--mk-fs-micro); }
  .frt__orch-textarea { font-size: var(--mk-fs-micro); padding: 17px; }
  .frt__orch-msg { font-size: var(--mk-fs-micro); }
  .frt__orch-quick { font-size: var(--mk-fs-micro); }
  .frt__agentdesc { font-size: var(--mk-fs-micro); }
  .frt__fieldpath { font-size: var(--mk-fs-micro); }
  .frt__persist { font-size: var(--mk-fs-micro); }
}

/* 暗色模式：色值全部走 --mk-* token（surface/line/blue-bg/faint/bg 随主题自动翻转），
   原先的亮色硬编码 + 暗色补丁段已删（无残留规则）。 */
</style>
