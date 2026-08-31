<template>
  <div class="frt">
    <!-- 吸顶操作条（滚动修复 #1：长表关键操作常驻顶部） -->
    <div class="frt__stickybar">
      <div class="frt__toolbar">
        <button type="button" class="frt__toolbar-btn" :disabled="!stage" @click="openOrchestration">编排文件</button>
        <span class="frt__toolbar-hint">编辑 prompts/orchestration/{{ stage }}.yaml（字段路由唯一声明源）</span>
      </div>
    </div>
    <p class="frt__notice">
      行级编辑已收敛：修改字段路由请使用右上角「编排文件」按钮，保存后新建行即时生效，已有行修改后点「{{ TERMS.syncToDb }}」
    </p>

    <!-- core 联动提示条（M3 轻量：当前 stage 各 skill 的 fields-sync 状态角标） -->
    <div v-if="skillSyncs.length" class="frt-syncbar">
      <span class="frt-syncbar__title">core 联动</span>
      <a
        v-for="s in skillSyncs"
        :key="s.skillId"
        class="frt-syncbar__badge"
        :class="`frt-syncbar__badge--${s.tone}`"
        :title="s.title"
        href="#"
        @click.prevent="goSkill(s.skillId)"
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
      </a>
      <span class="frt-syncbar__hint">该字段未登记 core 声明 / 未登记路由 → 去 Skill 设计页补全（字段路由 tab）</span>
    </div>
    <div v-else-if="skillSyncLoading" class="frt-syncbar frt-syncbar--muted">
      <span class="frt-syncbar__title">core 联动</span>
      <span class="frt-syncbar__hint">逐 skill 核对 core 声明状态…</span>
    </div>

    <!-- 图例：角色 / render / 锁定 / 流转 一句话人话表（可折叠） -->
    <details class="frt__legend" :open="legendOpen" @toggle="legendOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="frt__legend-summary">图例：字段角色 / render / 锁定 / 流转 —— 不懂就看这里</summary>
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
              <span class="mk-badge mk-badge--render-visible">visible</span>
              <span class="frt__legend-hint">可见：会出现在对外交付（用户 / 界面）</span>
            </li>
            <li class="frt__legend-item">
              <span class="mk-badge mk-badge--render-hidden">hidden</span>
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
        机制说明见仓库 <span class="mono">prompts/orchestration/_README.md</span> · 设计落盘
        <span class="mono">doc/FIELD_ROUTING_UX_REDESIGN.md</span> · 术语查「这是什么」抽屉
      </p>
    </details>

    <!-- 搜索 / 角色过滤 -->
    <div class="mk-filter frt__filter">
      <input v-model="keyword" class="mk-filter__input" type="search" placeholder="搜索字段名 / 含义 / 角色 / render / 移交…" />
      <select v-model="roleFilter" class="mk-filter__select" aria-label="按角色过滤">
        <option value="">全部角色</option>
        <option v-for="m in roleMeta" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
      </select>
      <span v-if="filterActive" class="frt__filter-count">命中 {{ filteredTotal }} / {{ routings.length }} 行</span>
    </div>

    <div v-if="loading" class="frt__empty">加载中…</div>
    <div v-else-if="error" class="frt__empty">{{ error }}<button type="button" class="mk-empty__action" @click="loadStage">重试</button></div>
    <template v-else>
      <div v-for="agent in agents" :key="agent.agentId" class="frt__agent">
        <div class="frt__agenthead">
          <span class="frt__agentname mono">{{ agent.agentId }}</span>
          <span class="frt__agentdesc">{{ agent.description }}</span>
          <span class="frt__agentcount">{{ filteredOf(agent.agentId).length }}<template v-if="filterActive"> / {{ routingsOf(agent.agentId).length }}</template> 行</span>
        </div>
        <div class="frt__scroll mk-table-scroll">
          <table class="mk-table mk-table--dense">
            <thead>
              <tr>
                <th scope="col">字段</th>
                <th scope="col">含义</th>
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
                  <span v-if="pathOf(row.fieldId)" class="frt__fieldpath" :title="`抽取路径（pathInRawOutput）：${pathOf(row.fieldId)}`">抽取 → {{ pathOf(row.fieldId) }}</span>
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
                  >{{ row.render }}</span>
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
              <tr v-if="rowsOf(agent.agentId).length === 0">
                <td colspan="10" class="frt__emptyrow">
                  {{ routingsOf(agent.agentId).length ? '无匹配行，试试调整搜索或角色过滤' : '该 Agent 无字段路由行' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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

    <!-- 编排文件编辑弹窗 -->
    <Teleport to="body">
    <div v-if="orchOpen" ref="orchMaskRef" class="mk-modal">
      <div ref="orchPanelRef" class="mk-modal__panel frt__orch-panel" role="dialog" aria-label="编排文件编辑">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">编排文件 · {{ stage }}.yaml</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="orchOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <div class="frt__orch-summary">
            <span class="mono">prompts/orchestration/{{ stage }}.yaml</span>
            <span>契约 {{ orchSummary.contractCount }} · 字段 {{ orchSummary.fieldCount }} · 路由 {{ orchSummary.routingCount }}</span>
          </div>
          <!-- 值域速查条：编辑时对照填写 -->
          <div class="frt__orch-quick">
            <span class="frt__orch-quick-title">值域速查：</span>
            <span class="frt__orch-quick-item"><b>promptRole</b>{{ roleNames }}</span>
            <span class="frt__orch-quick-item"><b>render</b>visible / hidden</span>
            <span class="frt__orch-quick-item"><b>handoff</b>阶段名（goal/path/teaching/profile/simulation）或 agent / skill:</span>
            <span class="frt__orch-quick-item"><b>persistKey</b>仅落库键与 fieldId 不一致时标注</span>
          </div>
          <textarea
            v-model="orchContent"
            class="frt__orch-textarea mono"
            rows="26"
            spellcheck="false"
            placeholder="编排文件 YAML 原文…"
          ></textarea>
          <p v-if="orchMsg" class="frt__orch-msg">{{ orchMsg }}</p>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" :disabled="orchSaving || orchSyncing || orchPruning" @click="orchOpen = false">关闭</button>
          <button type="button" class="mk-btn frt__prune" :disabled="orchSaving || orchSyncing || orchPruning" @click="runPrune(false)">
            {{ orchPruning ? '清理中…' : '清理孤儿行' }}
          </button>
          <button
            v-if="pruneConfirming"
            type="button"
            class="mk-btn frt__prune--danger"
            :disabled="orchSaving || orchSyncing || orchPruning"
            @click="runPrune(true)"
          >确认清理（删除数据库行）</button>
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
import Pagination from './Pagination.vue';

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
/* 筛选/搜索变化 → 页码回到第 1 页（与 useLoadMore 同语义） */
watch([keyword, roleFilter], () => { agentPages.value = {}; });

const fieldMap = () => new Map(fields.value.map((f) => [f.fieldId, f]));

function typeOf(fieldId: string) { return fieldMap().get(fieldId)?.valueType || '—'; }
function descOf(fieldId: string) { return fieldMap().get(fieldId)?.description || ''; }
function roleOf(fieldId: string) { return fieldMap().get(fieldId)?.promptRole || ''; }
function roleMetaOf(fieldId: string) {
  const role = roleOf(fieldId);
  if (!role) return undefined;
  const meta = roleMeta.value.find((m) => m.id === role);
  return meta || { id: role, label: role, hint: role };
}
function pathParts(fieldId: string) { return fieldId.split('.'); }
function routingsOf(agentId: string) { return routings.value.filter((r) => r.agentId === agentId); }

const filterActive = computed(() => Boolean(keyword.value.trim() || roleFilter.value));
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
  return routingsOf(agentId).filter(matches);
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
  const ev = fieldMap().get(row.fieldId)?.enumValues;
  if (Array.isArray(ev) && ev.length) parts.push(`取值：${ev.join(' / ')}`);
  const path = pathOf(row.fieldId);
  if (path) parts.push(`抽取路径（pathInRawOutput）：${path}`);
  if (row.notes) parts.push(`备注：${row.notes}`);
  return parts.join('\n');
}

/** 落库键：编排声明了 persistKey 用 persistKey，否则默认与 fieldId 一致 */
function persistKeyOf(row: RoutingItem) {
  const k = fieldMap().get(row.fieldId)?.persistKey;
  return k || row.fieldId;
}
/** 字段值在产出方原始输出里的物理抽取路径（pathInRawOutput，可空） */
function pathOf(fieldId: string) {
  return fieldMap().get(fieldId)?.pathInRawOutput || '';
}
function renderHint(row: RoutingItem) {
  const base = row.render === 'hidden' ? '隐藏：仅内部流转，不对外展示' : '可见：会出现在对外交付（用户 / 界面）';
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
    error.value = e?.message || '加载失败';
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

/** 逐 skill 拉 M1 单 skill 投影（GET /field-routings/skill/:skillId），失败静默降级（角标不显示） */
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
  const results = await Promise.all(
    skillAgents.map(async (agentId) => {
      const skillId = agentId.replace(/^skill:/, '');
      try {
        const res = await adminFieldRoutingsApi.getSkillRoutings(skillId);
        const sync = res.data?.data?.core?.sync ?? null;
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
        return { skillId, sync, tone, title };
      } catch {
        return null;
      }
    })
  );
  skillSyncLoading.value = false;
  skillSyncs.value = results.filter((r): r is SkillSyncBadge => r !== null);
}

function goSkill(skillId: string) {
  void router.push({ path: `/admin/skills/${skillId}`, query: { tab: 'routing' } });
}

// ============ 编排文件编辑（单源化批次 C） ============

const orchOpen = ref(false);
const orchContent = ref('');
const orchSummary = ref({ contractCount: 0, fieldCount: 0, routingCount: 0 });
const orchSaving = ref(false);
const orchSyncing = ref(false);
const orchPruning = ref(false);
const pruneConfirming = ref(false);
const orchMsg = ref('');
const orchPanelRef = ref<HTMLElement | null>(null);
const orchMaskRef = ref<HTMLElement | null>(null);

useEscape(() => orchOpen.value, () => { orchOpen.value = false; });
useOverlay(orchOpen, orchPanelRef);
useMaskClose(orchMaskRef, () => { orchOpen.value = false; });

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
        msg += '；确认无误后点「确认清理（删除数据库行）」执行';
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
/* 吸顶操作条（滚动修复 #1）：长表关键操作常驻顶部，负 margin 满宽于 tab 面板 */
.frt__stickybar {
  position: sticky;
  top: 0;
  z-index: 25;
  margin: -14px -16px 14px;
  padding: 10px 16px 8px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(230, 235, 244, 0.9);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
}
.frt__stickybar .frt__toolbar { margin-bottom: 0; }
.frt__notice {
  margin: 0 0 14px;
  padding: 8px 12px;
  border: 1px dashed rgba(44, 99, 208, 0.45);
  border-radius: 9px;
  background: #f0f5ff;
  color: var(--mk-blue, #2c63d0);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.55;
}
.frt__toolbar-btn {
  padding: 8px 16px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 8px;
  background: var(--mk-surface, #fff);
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.frt__toolbar-btn:hover { background: #f6f9ff; border-color: rgba(44, 99, 208, 0.4); }
.frt__toolbar-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.frt__toolbar-hint { color: var(--mk-faint, #71809a); font-size: 12px; }

/* ========== core 联动提示条（M3） ========== */
.frt-syncbar {
  display: flex;
  align-items: center;
  gap: 6px 12px;
  flex-wrap: wrap;
  margin: 0 0 12px;
  padding: 8px 12px;
  border: 1px dashed rgba(44, 99, 208, 0.4);
  border-radius: 9px;
  background: #f0f5ff;
  font-size: 11.5px;
  line-height: 1.5;
}
.frt-syncbar--muted { border-color: var(--mk-line, #e6ebf4); background: #fafbfd; }
.frt-syncbar__title { font-weight: 800; color: var(--mk-blue, #2c63d0); }
.frt-syncbar__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 11px;
  text-decoration: none;
  transition: filter 0.12s ease;
}
.frt-syncbar__badge:hover { filter: brightness(0.97); }
.frt-syncbar__badge code { font-size: 10.5px; }
.frt-syncbar__badge--ok { background: var(--mk-green-bg, #ecfdf5); color: var(--mk-green, #15803d); }
.frt-syncbar__badge--warn { background: var(--mk-amber-bg, #fffbeb); color: var(--mk-amber, #b45309); }
.frt-syncbar__badge--err { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.frt-syncbar__badge--muted { background: #eef2fa; color: var(--mk-muted, #5b6577); }
.frt-syncbar__count { font-size: 10.5px; }
.frt-syncbar__hint { color: var(--mk-muted, #5b6577); }

/* ========== 图例（可折叠） ========== */
.frt__legend {
  margin: 0 0 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 10px;
  background: var(--mk-surface, #fff);
  box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06));
}
.frt__legend-summary {
  padding: 9px 14px;
  cursor: pointer;
  user-select: none;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-muted, #5b6577);
  list-style: none;
  transition: color 0.14s ease;
}
.frt__legend-summary::-webkit-details-marker { display: none; }
.frt__legend-summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 7px;
  color: var(--mk-blue, #2c63d0);
  transition: transform 0.14s ease;
}
.frt__legend[open] .frt__legend-summary::before { transform: rotate(90deg); }
.frt__legend-summary:hover { color: var(--mk-ink, #1a2a44); }
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
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint, #71809a);
}
.frt__legend-group--roles + .frt__legend-group .frt__legend-title { margin-top: 10px; }
.frt__legend-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.frt__legend-loading { margin: 0; font-size: 11.5px; color: var(--mk-faint, #71809a); }
.frt__legend-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
.frt__legend-en { flex-shrink: 0; font-size: 11px; color: var(--mk-faint, #71809a); }
.frt__legend-hint { font-size: 12px; color: var(--mk-muted, #5b6577); min-width: 0; }
.frt__legend-foot {
  margin: 0;
  padding: 6px 14px 10px;
  font-size: 11px;
  color: var(--mk-faint, #71809a);
}
.frt__legend-foot .mono { font-size: 11px; color: var(--mk-blue, #2c63d0); }

/* ========== 搜索 / 过滤 ========== */
.frt__filter { margin-bottom: 12px; }
.frt__filter-count { font-size: 11.5px; color: var(--mk-faint, #71809a); font-weight: 600; }

.frt__orch-panel { width: min(820px, 100%); }
.frt__orch-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #fafbfd;
  color: var(--mk-muted, #5b6577);
  font-size: 12px;
}
.frt__orch-summary .mono { color: var(--mk-blue, #2c63d0); font-weight: 600; }
.frt__orch-textarea {
  width: 100%;
  min-height: 420px;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 10px;
  background: #fbfcfe;
  color: var(--mk-ink, #1a2a44);
  font-size: 12px;
  line-height: 1.55;
  resize: vertical;
  outline: none;
}
.frt__orch-textarea:focus { border-color: var(--mk-blue, #2c63d0); }
.frt__orch-msg {
  margin: 0;
  padding: 9px 12px;
  border: 1px solid rgba(44, 99, 208, 0.35);
  border-radius: 9px;
  background: #f0f5ff;
  color: var(--mk-blue, #2c63d0);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}

/* 清理孤儿行按钮（P2：预检只报告；确认态红色危险按钮） */
.frt__prune {
  border-color: rgba(180, 83, 9, 0.35);
  color: var(--mk-amber, #b45309);
}
.frt__prune--danger {
  border-color: rgba(220, 38, 38, 0.45);
  background: var(--mk-red, #dc2626);
  color: #fff;
}
.frt__prune--danger:hover {
  background: var(--mk-red-strong);
  border-color: var(--mk-red-strong);
}
.frt__agent { margin-bottom: 18px; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 12px; overflow: hidden; background: var(--mk-surface, #fff); box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06)); }
.frt__agenthead { padding: 10px 14px; background: #fafbfd; border-bottom: 1px solid var(--mk-line, #e6ebf4); display: flex; align-items: baseline; gap: 10px; }
.frt__agentname { font-weight: 700; color: var(--mk-ink, #1a2a44); }
.frt__agentdesc { color: var(--mk-faint, #71809a); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frt__agentcount { margin-left: auto; padding: 1px 9px; border-radius: 999px; background: #eef2fa; color: var(--mk-muted, #5b6577); font-size: 11px; font-weight: 700; white-space: nowrap; }
/* 表格本体已并入 mk-table mk-table--dense（shared.css）：仅保留滚动容器（限高 + 粘性表头生效） */
/* 横向+纵向滚动容器（滚动修复 #1）：表头 sticky 吸顶，容器限高内部滚动，页面本体不被撑长 */
.frt__scroll { overflow: auto; max-height: 62vh; }
@media (max-width: 860px) {
  .mk-table--dense { min-width: 1060px; }
}

/* 字段列：点分名 + 层级分段小字。
   行高统一修复：fieldId 由 word-break:break-all 改单行 ellipsis（不再折行撑高） */
.frt__fieldcell { max-width: 300px; display: grid; gap: 2px; min-width: 0; }
.frt__field { display: block; min-width: 0; color: var(--mk-ink, #1a2a44); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frt__fieldpath {
  font-size: 10.5px;
  color: var(--mk-faint, #71809a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 含义列：3 行 clamp → 2 行（-webkit-box 精确行数，替代 max-height:3em 裁半行），
   行高上限 119px → ~85px，与字段列单行化叠加后行高统一 */
.frt__meaning { min-width: 200px; max-width: 340px; }
.frt__meaning-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--mk-muted, #5b6577);
  line-height: 1.5;
}

/* 角色徽章（7 类着色，与图例共用） */
/* render 徽章 */
/* 流转徽章（图例） */
/* 落库键列：截断上限统一引用 token（原散落 180px） */
.frt__persist { display: inline-block; max-width: var(--mk-col-id); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mk-muted, #5b6577); font-size: 11px; }
.frt__persist--alias { color: var(--mk-amber, #b45309); background: #fffbeb; border-radius: 5px; padding: 0 5px; }

/* 编排弹窗值域速查条 */
.frt__orch-quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  padding: 7px 12px;
  margin-top: 8px;
  border: 1px dashed rgba(44, 99, 208, 0.4);
  border-radius: 9px;
  background: #f0f5ff;
  font-size: 11.5px;
  color: var(--mk-muted, #5b6577);
  line-height: 1.5;
}
.frt__orch-quick-title { font-weight: 800; color: var(--mk-blue, #2c63d0); }
.frt__orch-quick-item b { margin-right: 4px; color: var(--mk-ink, #1a2a44); }

.frt__handoff { max-width: var(--mk-col-id); color: var(--mk-faint, #71809a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frt__empty { padding: 30px; color: var(--mk-faint, #71809a); text-align: center; }
.frt__emptyrow { color: var(--mk-faint, #71809a); text-align: center; padding: 14px; }

@media (min-width: 2000px) {
  .frt__toolbar-btn { font-size: 14px; padding: 10px 20px; }
  .frt__toolbar-hint { font-size: 13.5px; }
  .frt__notice { font-size: 13.5px; padding: 9px 14px; }
  .frt__legend-summary { font-size: 14px; padding: 11px 17px; }
  .frt__legend-title { font-size: 12px; }
  .frt__legend-loading { font-size: 13px; }
  .frt__legend-en { font-size: 12px; }
  .frt__legend-hint { font-size: 13.5px; }
  .frt__legend-foot { font-size: 12px; }
  .frt__legend-foot .mono { font-size: 12px; }
  .frt__filter-count { font-size: 13px; }
  .frt__orch-summary { font-size: 13.5px; }
  .frt__orch-textarea { font-size: 13.5px; padding: 14px; }
  .frt__orch-msg { font-size: 13.5px; }
  .frt__orch-quick { font-size: 13px; }
  .frt__agentdesc { font-size: 13.5px; }
  .frt__agentcount { font-size: 12px; padding: 2px 11px; }
  .frt__fieldpath { font-size: 12px; }
  .frt__persist { font-size: 12px; }
  }

@media (min-width: 2800px) {
  .frt__toolbar-btn { font-size: 16.5px; padding: 12px 24px; }
  .frt__toolbar-hint { font-size: 16px; }
  .frt__notice { font-size: 16px; padding: 11px 17px; }
  .frt__legend-summary { font-size: 16.5px; padding: 13px 21px; }
  .frt__legend-title { font-size: 14px; }
  .frt__legend-loading { font-size: 15.5px; }
  .frt__legend-en { font-size: 14px; }
  .frt__legend-hint { font-size: 16px; }
  .frt__legend-foot { font-size: 14px; }
  .frt__legend-foot .mono { font-size: 14px; }
  .frt__filter-count { font-size: 15.5px; }
  .frt__orch-summary { font-size: 16px; }
  .frt__orch-textarea { font-size: 16px; padding: 17px; }
  .frt__orch-msg { font-size: 16px; }
  .frt__orch-quick { font-size: 15.5px; }
  .frt__agentdesc { font-size: 16px; }
  .frt__agentcount { font-size: 14px; padding: 3px 13px; }
  .frt__fieldpath { font-size: 14px; }
  .frt__persist { font-size: 14px; }
}

/* ================= 暗色模式（D1 补完）：字段路由表 ================= */
html[data-theme='dark'] {
  .frt__toolbar { background: #141c2b; border-color: #232f45; }
  .frt__toolbar-btn:hover { background: #1f2b40; }
  .frt-syncbar--muted { background: #141c2b; }
  .frt-syncbar__badge--muted { background: #253049; }
  .frt__tablewrap { background: #141c2b; }
  .frt__agenthead { background: #131b2a; }
  .frt__agentcount { background: #253049; }
  .frt__persist--alias { background: rgba(251, 191, 36, 0.12); }
  .frt__fieldrow:hover { background: #1b2740; }
}
</style>
