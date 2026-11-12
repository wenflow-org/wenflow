<template>
  <CapabilityShell title="调用日志">
    <template #actions>
      <div class="actions">
        <button type="button" class="uc-btn uc-btn--sm" :disabled="exporting" @click="exportLogs('json')">
          {{ exportingFormat === 'json' ? '导出中...' : '导出 JSON' }}
        </button>
        <button type="button" class="uc-btn uc-btn--sm" :disabled="exporting" @click="exportLogs('csv')">
          {{ exportingFormat === 'csv' ? '导出中...' : '导出 CSV' }}
        </button>
        <button type="button" class="uc-btn uc-btn--primary uc-btn--sm" @click="copyDiagnosticsSummary">
          复制排查信息
        </button>
      </div>
    </template>
    <div class="agent-logs-page">

    <!-- 筛选器 -->
    <div class="filters">
      <label class="filter-item">
        <span class="filter-label">Agent</span>
        <div class="filter-select">
          <MkSelect v-model="filters.agentId" :options="AGENT_OPTIONS" aria-label="Agent" block />
        </div>
      </label>
      <label class="filter-item">
        <span class="filter-label">活动类型</span>
        <div class="filter-select">
          <MkSelect v-model="filters.capabilityType" :options="CAPABILITY_OPTIONS" aria-label="活动类型" block />
        </div>
      </label>
      <label class="filter-item">
        <span class="filter-label">状态</span>
        <div class="filter-select">
          <MkSelect v-model="filters.success" :options="SUCCESS_OPTIONS" aria-label="状态" block />
        </div>
      </label>
      <label class="filter-item">
        <span class="filter-label">时间范围</span>
        <div class="filter-dates">
          <input v-model="startDateInput" type="date" class="uc-field__input" aria-label="开始日期" @change="onStartDateChange" />
          <span class="filter-dates__sep">至</span>
          <input v-model="endDateInput" type="date" class="uc-field__input" aria-label="结束日期" @change="onEndDateChange" />
        </div>
      </label>
      <label class="filter-item filter-item--switch">
        <span class="uc-switch">
          <input type="checkbox" v-model="filters.includeSystem" />
          <span class="uc-switch__track"></span>
        </span>
        <span class="filter-switch-label">{{ filters.includeSystem ? '显示底层调用' : '隐藏底层调用' }}</span>
      </label>
      <div class="filter-actions">
        <button type="button" class="uc-btn uc-btn--primary uc-btn--sm" :disabled="loading" @click="queryLogs">
          {{ loading ? '查询中…' : '查询' }}
        </button>
        <button type="button" class="uc-btn uc-btn--sm" @click="resetFilters">重置</button>
      </div>
    </div>

    <div v-if="!loadError" class="stats">
      <!-- 2026-11-04：pagination.total 是折叠后的记录数（同一次调用的重复行已去重、同会话多轮归成一条），
           不是原始调用次数，故不写「总调用」；导出与列表同走折叠视图，两处条数一致。 -->
      <div class="stat-card">
        <span>记录条数（折叠后）</span>
        <strong>{{ loading ? '—' : pagination.total }}</strong>
      </div>
      <div class="stat-card">
        <span>成功率（本页）</span>
        <strong>{{ hasPageSamples ? successRate + '%' : '—' }}</strong>
      </div>
      <div class="stat-card">
        <span>平均耗时（本页）</span>
        <strong>{{ hasPageSamples ? formatDuration(avgDuration) : '—' }}</strong>
      </div>
      <div class="stat-card">
        <span>Token（本页）</span>
        <strong>{{ hasTokenSamples ? `${formatTokenCount(totalTokens)} tokens` : '—' }}</strong>
      </div>
    </div>

    <!-- 日志列表 -->
    <article class="uc-card uc-card--flush logs-card">
      <div v-if="loadError" class="uc-errorbar" role="alert" style="margin: 16px">
        {{ loadError }}
        <button type="button" class="uc-errorbar__retry" @click="loadLogs">重新加载</button>
      </div>

      <div v-else-if="loading && !displayLogs.length" class="uc-loading">
        <span class="uc-spinner"></span>
        加载日志…
      </div>

      <div v-else-if="!displayLogs.length" class="uc-empty">
        <strong>{{ emptyStateTitle }}</strong>
        <span>{{ emptyStateHint }}</span>
        <button v-if="hasActiveFilters" type="button" class="uc-btn uc-btn--sm uc-empty__action" @click="resetFilters">
          清除筛选
        </button>
      </div>

      <template v-else>
      <!-- 窄屏（10 列 1080px 表塞进 ~361px）首屏只见 3 列、操作列要横拖才够得着，
           此前无任何横拖提示；补一行常显提示 + 常显横滚条（桌面档不显示不占位，走查 #43） -->
      <p class="scroll-hint" aria-hidden="true">← 左右滑动查看全部列 →</p>
      <div class="uc-table-wrap logs-scroll">
        <table class="uc-table logs-table" aria-label="调用日志列表">
          <thead>
            <tr>
              <th>Agent</th>
              <th>来源</th>
              <th>能力</th>
              <th>状态</th>
              <th>耗时</th>
              <th>Token</th>
              <th>模型</th>
              <th>错误</th>
              <th>时间</th>
              <th class="uc-table__right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in displayLogs" :key="row.id">
              <td>{{ formatAgentId(row) }}</td>
              <td><span class="uc-badge" :class="sourceBadgeClass(row)">{{ getLogSourceLabel(row) }}</span></td>
              <td class="uc-table__muted">{{ getCapabilityTypeLabel(row.agentId) }}</td>
              <td><span class="uc-badge" :class="row.success ? 'uc-badge--ok' : 'uc-badge--bad'">
                {{ row.success ? '成功' : '失败' }}
              </span></td>
              <td class="uc-table__muted">{{ formatDuration(row.durationMs) }}</td>
              <td class="uc-table__muted">{{ formatTokenCount(row.tokensUsed) }}</td>
              <td class="uc-table__muted" :title="`来源：${getModelSourceInfo(row).label}`">{{ getModelSourceInfo(row).display }}</td>
              <td class="uc-table__muted logs-error-cell">{{ row.error || '-' }}</td>
              <td class="uc-table__muted">{{ formatDate(row.calledAt) }}</td>
              <td class="uc-table__right">
                <button type="button" class="uc-btn uc-btn--link" :aria-label="`查看「${formatAgentId(row)}」的日志详情`" @click="viewDetail(row)">详情</button>
                <button type="button" class="uc-btn uc-btn--link" :aria-label="`复制「${formatAgentId(row)}」的排查信息`" @click="copyLogFeedback(row)">复制</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 手作分页 -->
      <div class="pagination">
        <span class="pagination__total">共 {{ pagination.total }} 条</span>
        <div class="pagination__size">
          <MkSelect
            v-model="pagination.limit"
            :options="LIMIT_OPTIONS"
            aria-label="每页条数"
            size="sm"
            block
            @change="onLimitChange"
          />
        </div>
        <div class="pagination__nav">
          <button type="button" class="uc-btn uc-btn--sm" :disabled="pagination.page <= 1 || loading" @click="goPage(pagination.page - 1)">上一页</button>
          <span class="pagination__page">第 {{ pagination.page }} / {{ totalPages }} 页</span>
          <button type="button" class="uc-btn uc-btn--sm" :disabled="pagination.page >= totalPages || loading" @click="goPage(pagination.page + 1)">下一页</button>
        </div>
      </div>
      </template>
    </article>

    <!-- 详情弹窗 -->
    <div v-if="detailVisible && currentLog" class="uc-dialog-mask" @click.self="closeDetail">
      <!-- 弹窗可访问性：Esc 关闭 / 打开时聚焦关闭钮 / Tab 圈禁复用 admin-redesign 的
           useEscape + useOverlay（后者顺带锁背景滚动、关闭后焦点回落触发元素） -->
      <div ref="detailPanel" class="uc-dialog uc-dialog--detail" role="dialog" aria-modal="true" aria-label="日志详情与诊断">
        <div class="uc-dialog__head">
          <h3>日志详情与诊断</h3>
          <button type="button" class="uc-dialog__close" aria-label="关闭" @click="closeDetail">✕</button>
        </div>
        <div class="uc-dialog__body">
          <div v-if="detailError" class="uc-errorbar" role="alert" style="margin-bottom: 12px">
            {{ detailError }}
          </div>

          <div v-if="detailLoading" class="uc-loading">
            <span class="uc-spinner"></span>
            加载详情…
          </div>

          <template v-else>
          <details class="detail-collapse" open>
            <summary>基础信息</summary>
            <div class="detail-facts">
              <div class="detail-fact"><span>ID</span><strong>{{ currentLog.id }}</strong></div>
              <div class="detail-fact"><span>Agent</span><strong>{{ currentLog.agentId }}</strong></div>
              <div class="detail-fact"><span>能力类型</span><strong>{{ getCapabilityTypeLabel(currentLog.agentId) }}</strong></div>
              <div class="detail-fact"><span>状态</span><span class="uc-badge" :class="currentLog.success ? 'uc-badge--ok' : 'uc-badge--bad'">
                {{ currentLog.success ? '成功' : '失败' }}
              </span></div>
              <div class="detail-fact"><span>耗时</span><strong>{{ formatDuration(currentLog.durationMs) }}</strong></div>
              <div class="detail-fact"><span>Token</span><strong>{{ formatTokenCount(currentLog.tokensUsed) }}</strong></div>
              <div class="detail-fact"><span>模型来源</span><strong>{{ getModelSourceInfo(currentLog).label }}</strong></div>
              <div class="detail-fact"><span>Provider</span><strong>{{ getModelSourceInfo(currentLog).providerName }}</strong></div>
              <div class="detail-fact detail-fact--wide"><span>Provider 地址</span><strong>{{ getModelSourceInfo(currentLog).providerBaseUrl }}</strong></div>
              <div class="detail-fact"><span>时间</span><strong>{{ formatDate(currentLog.calledAt) }}</strong></div>
              <div class="detail-fact"><span>Trace ID</span><strong>{{ currentLog.traceId || detailMetadata.traceId || '-' }}</strong></div>
              <div class="detail-fact"><span>错误码</span><strong>{{ currentLog.errorCode || detailMetadata.errorCode || '-' }}</strong></div>
              <div class="detail-fact"><span>来源入口</span><strong>{{ currentLog.sourceEntry || detailMetadata.sourceEntry || '-' }}</strong></div>
              <div class="detail-fact"><span>调用方</span><strong>{{ currentLog.callerAgent || detailMetadata.callerAgent || '-' }}</strong></div>
            </div>
          </details>

          <details v-if="currentLog.error" class="detail-collapse" open>
            <summary>错误信息</summary>
            <div class="detail-error-box">{{ currentLog.error }}</div>
          </details>

          <details class="detail-collapse" open>
            <summary>输入与上下文</summary>
            <pre class="code-block">{{ formatJson(currentLog.metadata) }}</pre>
          </details>

          <details class="detail-collapse" open>
            <summary>输入 / 输出摘要</summary>
            <div class="io-block">
              <span class="io-label">输入 (input)</span>
              <pre class="code-block">{{ formatTextBlock(currentLog.input) }}</pre>
            </div>
            <div class="io-block">
              <span class="io-label">输出 (output)</span>
              <pre class="code-block">{{ formatTextBlock(currentLog.output) }}</pre>
            </div>
          </details>
          </template>
        </div>
        <div class="uc-dialog__foot">
          <button type="button" class="uc-btn dialog-btn--close" @click="closeDetail">关闭</button>
          <button type="button" class="uc-btn uc-btn--primary" :disabled="!currentLog" @click="copyLogFeedback(currentLog)">
            复制
          </button>
        </div>
      </div>
    </div>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from '../../utils/toast';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { getAgentLogDetail, getAgentLogs, exportAgentLogs } from '@/api/userCustom';
import { formatWaited } from '../v2/learningPathProgress';
import { useEscape } from '@/views/admin-redesign/useEscape';
import { useOverlay } from '@/views/admin-redesign/useOverlay';
import dayjs from 'dayjs';
import MkSelect from '@/components/mk/MkSelect.vue';
import '@/components/user/uc.css';

interface AgentLogItem {
  id: string;
  agentId?: string;
  success?: boolean;
  durationMs?: number;
  tokensUsed?: number;
  error?: string | null;
  errorCode?: string | null;
  calledAt?: string;
  traceId?: string | null;
  sourceEntry?: string | null;
  callerAgent?: string | null;
  logSource?: string;
  /** 折叠会话组的代表调用真实 id（组 id 是合成键，详情接口只认真实 id） */
  repLogId?: string;
  /** 折叠会话组内的调用次数 / 明细（后端归并附带） */
  groupCount?: number;
  groupItems?: Array<{ id: string; agentId: string; calledAt: string; success?: boolean; durationMs?: number; errorCode?: string | null; phase?: string | null }>;
  /** 实际模型名（折叠会话由后端从组内网关 span 提取） */
  model?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
}

interface AgentLogQueryParams {
  page?: number;
  limit?: number;
  agentId?: string;
  capabilityType?: string;
  success?: boolean;
  includeSystem?: boolean;
  startDate?: string;
  endDate?: string;
  format?: 'json' | 'csv';
}

const loading = ref(false);
const logs = ref<AgentLogItem[]>([]);
const detailVisible = ref(false);
const currentLog = ref<AgentLogItem | null>(null);
/** 详情弹窗根元素：useOverlay 的焦点圈禁 / 初始聚焦作用域 */
const detailPanel = ref<HTMLElement | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const loadError = ref('');
const exportingFormat = ref<'' | 'json' | 'csv'>('');
const exporting = computed(() => exportingFormat.value !== '');

const route = useRoute();
const router = useRouter();

const filters = reactive({
  agentId: '',
  capabilityType: '',
  success: undefined as boolean | undefined,
  includeSystem: false,
  startDate: '',
  endDate: ''
});

/* 已提交给服务端的筛选快照。表单（filters）只在下拉/输入时改动，点「查询」才生效；
   表格、统计、导出、详情都读这份快照，避免「改了能力下拉、还没点查询，本页表格就先变了」
   这种一半生效的中间态。 */
const applied = reactive({
  agentId: '',
  capabilityType: '',
  success: undefined as boolean | undefined,
  includeSystem: false,
  startDate: '',
  endDate: ''
});

// 手作日期筛选（原生 date input）
const startDateInput = ref(filters?.startDate || '');
const endDateInput = ref(filters?.endDate || '');

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
});

/* 筛选/分页下拉的选项表（2026-10-27 原生 select → MkSelect 自绘弹层）。
   文案与原 option 逐字一致；success 三态保留 undefined，不能归一成空串。 */
const AGENT_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'skill:path-planning', label: 'Path Agent' },
  /* #218：下拉曾挂已废弃 id（teaching-agent / ai-teaching-agent / learner-model-agent，
     线上 0 行），「Agent=AI 授课」恒空。改为 manifest 中的真实 id
     （skill:teaching-turn 是授课真实执行体）。 */
  { value: 'skill:teaching-turn', label: 'AI 授课' },
  { value: 'skill:learner-state-review', label: 'Learner State Hub' }
];
const CAPABILITY_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'goal', label: '目标对话' },
  { value: 'path', label: '路径规划' },
  { value: 'teaching', label: '教学讲解' },
  { value: 'tutoring', label: '辅导答疑' },
  /* 与 getCapabilityTypeLabel 的 profile 标签同词（能力列显示「学习者模型」），
     此前筛选项叫「学习画像更新」、表格里叫「学习者模型」，同一类两条名 */
  { value: 'profile', label: '学习者模型' },
  { value: 'system', label: '系统底层调用' }
];
const SUCCESS_OPTIONS: Array<{ value: boolean | undefined; label: string }> = [
  { value: undefined, label: '全部' },
  { value: true, label: '成功' },
  { value: false, label: '失败' }
];
const LIMIT_OPTIONS = [
  { value: 10, label: '10 条/页' },
  { value: 20, label: '20 条/页' },
  { value: 50, label: '50 条/页' },
  { value: 100, label: '100 条/页' }
];

/* ---------- 筛选态 ↔ URL ----------
   查询过的筛选、页码、每页条数写进 query：刷新、浏览器返回、把链接发给别人都不丢。
   默认值不写键，URL 保持干净；replace 不影响历史项，也不清掉同页其它 query
   （与学习路径列表的 filter/q 同口径）。 */
const QUERY_KEYS = ['agent', 'capability', 'success', 'system', 'from', 'to', 'page', 'limit'] as const;

function queryString(key: string): string {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

function readQueryState() {
  const agentId = AGENT_OPTIONS.some((o) => o.value === queryString('agent')) ? queryString('agent') : '';
  const capabilityType = CAPABILITY_OPTIONS.some((o) => o.value === queryString('capability'))
    ? queryString('capability')
    : '';
  const successRaw = queryString('success');
  const success = successRaw === 'true' ? true : successRaw === 'false' ? false : undefined;
  const dateOf = (key: string) => (/^\d{4}-\d{2}-\d{2}$/.test(queryString(key)) ? queryString(key) : '');
  const page = Number.parseInt(queryString('page'), 10);
  const limit = Number.parseInt(queryString('limit'), 10);
  return {
    filters: {
      agentId,
      capabilityType,
      success,
      includeSystem: queryString('system') === '1',
      startDate: dateOf('from'),
      endDate: dateOf('to')
    },
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: LIMIT_OPTIONS.some((o) => o.value === limit) ? limit : 20
  };
}

function applyQueryState() {
  const state = readQueryState();
  Object.assign(filters, state.filters);
  Object.assign(applied, state.filters);
  startDateInput.value = state.filters.startDate;
  endDateInput.value = state.filters.endDate;
  pagination.page = state.page;
  pagination.limit = state.limit;
}

function syncQueryToUrl() {
  const next: Record<string, string> = { ...(route.query as Record<string, string>) };
  for (const key of QUERY_KEYS) delete next[key];
  if (applied.agentId) next.agent = applied.agentId;
  if (applied.capabilityType) next.capability = applied.capabilityType;
  if (typeof applied.success === 'boolean') next.success = applied.success ? 'true' : 'false';
  if (applied.includeSystem) next.system = '1';
  if (applied.startDate) next.from = applied.startDate;
  if (applied.endDate) next.to = applied.endDate;
  if (pagination.page > 1) next.page = String(pagination.page);
  if (pagination.limit !== 20) next.limit = String(pagination.limit);
  void router.replace({ query: next }).catch(() => {});
}

const hasActiveFilters = computed(() => {
  const f = applied;
  return !!(f.agentId || f.capabilityType || typeof f.success === 'boolean' || f.includeSystem || f.startDate || f.endDate);
});

// 统计口径与表格一致：基于 displayLogs（客户端能力过滤后的当前页）。
// 此前用未过滤的 logs，筛选「学习者模型」时成功率/耗时仍是全页的，数字对不上表。
const successRate = computed(() => {
  if (displayLogs.value.length === 0) return 0;
  const successCount = displayLogs.value.filter(l => l.success).length;
  return ((successCount / displayLogs.value.length) * 100).toFixed(1);
});

const avgDuration = computed(() => {
  if (displayLogs.value.length === 0) return 0;
  const total = displayLogs.value.reduce((sum, l) => sum + (l.durationMs || 0), 0);
  return Math.round(total / displayLogs.value.length);
});

/** 裸毫秒 → 人读时长（account/iphone/5）：统计卡 90272ms、详情 50622ms 直拼不可读。
    口径复用 v2/learningPathProgress.formatWaited（「1 分 30 秒 / 42 秒 / 1 小时 2 分」），
    异常值回退裸数加单位。 */
function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '-';
  return formatWaited(ms) ?? `${ms}ms`;
}

/** Token 计数：空值统一 '-'（与时长/错误列同符号）；有值加千分位，0 是真实值不吞掉 */
function formatTokenCount(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '-';
  return value.toLocaleString('en-US');
}

const totalTokens = computed(() => {
  return displayLogs.value.reduce((sum, l) => sum + (l.tokensUsed || 0), 0);
});

/** 本页是否有任何一条带 Token 读数：全空时统计卡显示「—」而不是「0 tokens」
    （0 会被读成「确实消耗了 0」，与本页日志未上报 Token 是两回事）。 */
const hasTokenSamples = computed(() =>
  displayLogs.value.some((l) => typeof l.tokensUsed === 'number' && Number.isFinite(l.tokensUsed))
);

const displayLogs = computed(() => {
  return applied.capabilityType
    ? logs.value.filter((log) => getCapabilityType(log.agentId) === applied.capabilityType)
    : logs.value;
});

/* 平台里结构性没有对应 agent 的能力类：筛选必然为空，不能沿用通用「暂无日志」
   （会被读成筛选或加载出错）。只有 tutoring 属于这一类——manifest 里没有任何
   辅导类 Agent/Skill（backend services/users/capability-groups 显式映射为空集）。
   profile 不在此列：#218 复核确认库里确有该类调用（skill:learning-predictor /
   skill:learner-state-review 等），后端能力筛选按 Profile 监控组全量成员派生，
   因此不能再写「平台暂无学习者模型类调用记录」这种与事实相反的文案。 */
const STRUCTURAL_EMPTY_CAPABILITIES: Record<string, string> = {
  tutoring: '平台暂无辅导类调用记录'
};
const structuralEmptyText = computed(() => STRUCTURAL_EMPTY_CAPABILITIES[applied.capabilityType] || '');
const emptyStateTitle = computed(() => structuralEmptyText.value || '暂无日志');
/* 空态副文精简到一句指令（§7.3）：原「可切换到其他活动类型查看」既隔空指路（门禁 R2）
   又把「怎么操作」写了一遍，改为直接说换个类型试试。 */
const emptyStateHint = computed(() =>
  structuralEmptyText.value ? '换个活动类型试试' : '调整筛选条件或稍后再来查看'
);

// 本页无样本时不能把「无样本」写成 0 分：成功率 / 平均耗时是「0%」「0ms」会被读成
// 「全部失败 / 零耗时」（走查 2026-10-08 #51，本页空态与「总调用 0」并排）。
// 无样本时模板显示「—」，只在有日志时才给百分比与耗时。
const hasPageSamples = computed(() => displayLogs.value.length > 0);
const detailMetadata = computed(() => parseMetadata(currentLog.value?.metadata));

/* 竞态守卫代际号：last-wins，快速翻页/连点详情时丢弃过期响应 */
let loadLogsSeq = 0;
let detailSeq = 0;

onMounted(() => {
  // 刷新/返回时从 URL 恢复查询过的筛选与页码，再按该口径拉数据
  applyQueryState();
  loadLogs();
});

/**
 * 列表 / 详情 / 导出共用的筛选口径。详情也必须带上同一组筛选：
 * 折叠组的 groupCount/groupItems 由后端用列表 where 复算，不带筛选就会退回默认口径，
 * 出现「同一条折叠行点进去条数变了」（#225）。
 */
const buildFilterParams = (): AgentLogQueryParams => {
  const params: AgentLogQueryParams = {};
  if (applied.agentId) params.agentId = applied.agentId;
  if (applied.capabilityType) params.capabilityType = applied.capabilityType;
  if (typeof applied.success === 'boolean') params.success = applied.success;
  params.includeSystem = applied.includeSystem;
  if (applied.startDate) params.startDate = applied.startDate;
  if (applied.endDate) params.endDate = applied.endDate;
  return params;
};

/* 浏览器返回/前进：URL 变了（不是本页 replace 触发的那次）就重新按新口径取数。
   与当前已应用状态一致时直接跳过，避免自己写 URL 又触发一次请求。 */
watch(
  () => route.query,
  () => {
    const state = readQueryState();
    const same =
      state.filters.agentId === applied.agentId &&
      state.filters.capabilityType === applied.capabilityType &&
      state.filters.success === applied.success &&
      state.filters.includeSystem === applied.includeSystem &&
      state.filters.startDate === applied.startDate &&
      state.filters.endDate === applied.endDate &&
      state.page === pagination.page &&
      state.limit === pagination.limit;
    if (same) return;
    Object.assign(filters, state.filters);
    Object.assign(applied, state.filters);
    startDateInput.value = state.filters.startDate;
    endDateInput.value = state.filters.endDate;
    pagination.page = state.page;
    pagination.limit = state.limit;
    loadLogs();
  },
  { deep: true }
);

const loadLogs = async () => {
  // 竞态守卫：seq 代际号 last-wins，快速翻页/连点查询时丢弃过期响应
  const seq = ++loadLogsSeq;
  loading.value = true;
  loadError.value = '';
  try {
    const params: AgentLogQueryParams = {
      page: pagination.page,
      limit: pagination.limit,
      ...buildFilterParams()
    };

    const res = await getAgentLogs(params);
    if (seq !== loadLogsSeq) return; // 已有更新的请求：丢弃本次过期响应
    logs.value = res.data?.logs || [];
    pagination.total = res.data?.pagination?.total || 0;
  } catch (error: any) {
    if (seq !== loadLogsSeq) return;
    logs.value = [];
    pagination.total = 0;
    loadError.value = error?.response?.data?.error?.message || '无法读取调用日志，请稍后重试。';
    console.error('加载日志失败:', error);
  } finally {
    if (seq === loadLogsSeq) loading.value = false;
  }
};

const queryLogs = () => {
  // 表单快照 → 已应用筛选；只有这一步之后表格/统计才跟着变
  Object.assign(applied, filters);
  pagination.page = 1;
  syncQueryToUrl();
  loadLogs();
};

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.limit)));

const goPage = (page: number) => {
  if (page < 1 || page > totalPages.value || page === pagination.page) return;
  pagination.page = page;
  syncQueryToUrl();
  loadLogs();
};

const onLimitChange = () => {
  pagination.page = 1;
  syncQueryToUrl();
  loadLogs();
};

const onStartDateChange = () => {
  filters.startDate = startDateInput.value || '';
  queryLogs();
};

const onEndDateChange = () => {
  filters.endDate = endDateInput.value || '';
  queryLogs();
};

const closeDetail = () => {
  detailVisible.value = false;
  currentLog.value = null;
};

// Esc 关闭 + 焦点圈禁（useOverlay 打开时自动聚焦弹窗内首个按钮，即右上角关闭钮；
// 关闭后焦点回落触发元素、解锁背景滚动）。放在 closeDetail 之后：实参按值求值，不能前引。
useEscape(() => detailVisible.value, closeDetail);
useOverlay(detailVisible, detailPanel);

const sourceBadgeClass = (log: AgentLogItem) =>
  getLogSourceLabel(log) === '平台底层' ? 'uc-badge--muted' : 'uc-badge--info';

const resetFilters = () => {
  filters.agentId = '';
  filters.capabilityType = '';
  filters.success = undefined;
  filters.includeSystem = false;
  filters.startDate = '';
  filters.endDate = '';
  Object.assign(applied, filters);
  startDateInput.value = '';
  endDateInput.value = '';
  pagination.page = 1;
  syncQueryToUrl();
  loadLogs();
};

const viewDetail = async (log: AgentLogItem) => {
  // 竞态守卫：快速连点/先关后点时，过期响应不覆盖当前展示（按发起时 log 归属）
  const seq = ++detailSeq;
  currentLog.value = log;
  detailError.value = '';
  detailVisible.value = true;
  detailLoading.value = true;

  try {
    // 2026-11-04：折叠会话行的 id 是合成组键（path:/goal: 前缀），直接拿去查详情必然 404；
    // 有代表调用真实 id 时按它查，拿到的输入/输出才是这条会话的实际内容
    // #225：查详情同时带列表的筛选口径（折叠组的 groupCount/groupItems 由后端按同一 where 复算）
    const res = await getAgentLogDetail(log.repLogId || log.id, buildFilterParams());
    if (seq !== detailSeq) return;
    const detail = res?.data || res;
    if (detail) {
      currentLog.value = detail;
    }
  } catch (error) {
    if (seq !== detailSeq) return;
    detailError.value = '加载完整详情失败，当前展示的是列表摘要信息。';
    console.error('加载日志详情失败:', error);
  } finally {
    if (seq === detailSeq) detailLoading.value = false;
  }
};

const exportLogs = async (format: 'json' | 'csv') => {
  if (exporting.value) return;
  exportingFormat.value = format;
  try {
    const params: AgentLogQueryParams = { format, ...buildFilterParams() };

    const data = await exportAgentLogs(params);
    const blob = format === 'csv'
      ? (data as Blob)
      : new Blob([JSON.stringify((data as { data?: unknown })?.data ?? data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `agent-logs-${dayjs().format('YYYYMMDD')}.${format}`);
    toast.success('日志导出完成');
  } catch (error) {
    toast.error('日志导出失败');
    console.error('导出失败:', error);
  } finally {
    exportingFormat.value = '';
  }
};

const copyDiagnosticsSummary = async () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    filters: {
      agentId: applied.agentId || null,
      capabilityType: applied.capabilityType || null,
      success: applied.success,
      startDate: applied.startDate || null,
      endDate: applied.endDate || null
    },
    summary: {
      total: pagination.total,
      visible: displayLogs.value.length,
      successRate: successRate.value,
      avgDuration: avgDuration.value,
      totalTokens: totalTokens.value
    },
    latestLogs: displayLogs.value.slice(0, 10).map(toDiagnosticLog)
  };

  await copyText(JSON.stringify(payload, null, 2), '诊断摘要已复制');
};

const copyLogFeedback = async (log: AgentLogItem | null) => {
  if (!log) return;

  const payload = buildFeedbackPayload(log);

  await copyText(JSON.stringify(payload, null, 2), '反馈包已复制，可直接发给开发同学');
};

const buildFeedbackPayload = (log: AgentLogItem) => {
  const metadata = parseMetadata(log?.metadata);
  return {
    copiedAt: new Date().toISOString(),
    version: 'v1',
    log: {
      id: log.id,
      agentId: log.agentId,
      agentLabel: formatAgentId(log),
      capabilityType: getCapabilityTypeLabel(log.agentId),
      success: log.success,
      durationMs: log.durationMs,
      tokensUsed: log.tokensUsed,
      error: log.error,
      errorCode: log.errorCode,
      calledAt: log.calledAt,
      traceId: log.traceId || metadata.traceId,
      sourceEntry: log.sourceEntry || metadata.sourceEntry,
      callerAgent: log.callerAgent || metadata.callerAgent,
      modelSource: getModelSourceInfo(log),
      inputPreview: formatTextBlock(log.input).slice(0, 1200),
      outputPreview: formatTextBlock(log.output).slice(0, 1200),
      metadata: {
        sessionId: metadata.sessionId,
        taskId: metadata.taskId,
        userId: metadata.userId,
        providerId: metadata.providerId,
        providerName: metadata.providerName,
        providerBaseUrl: metadata.providerBaseUrl,
        model: metadata.model,
        endpoint: metadata.endpoint,
      }
    }
  };
};

const formatDate = (date?: string) => {
  // 空值守卫：dayjs(undefined) 会返回当前时间，缺失时间戳应显示占位而非误导性的「现在」
  if (!date) return '-';
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

const formatAgentId = (logOrAgentId: string | AgentLogItem | null | undefined) => {
  const agentId = typeof logOrAgentId === 'string' ? logOrAgentId : logOrAgentId?.agentId;
  const metadata = typeof logOrAgentId === 'string' ? {} : parseMetadata(logOrAgentId?.metadata);

  if (!agentId || agentId === 'unknown') {
    const action = metadata.action as string | undefined;
    if (action) {
      return `平台底层调用(${action})`;
    }
    return '平台底层调用';
  }
  
  // 友好显示映射（agentId → 展示名）。
  // 来源说明：本页为用户侧执行日志，无现成 agent 清单 API 可复用；id 含
  // 历史/业务别名（ai-teaching-agent、ai-tutor 等）与 admin 注册表不同构，
  // 保持本地字典，仅作显示层映射（未命中时原样回退 agentId）。
  // #218：键以 manifest 真实 id 为准（skill:teaching-turn / skill:learner-model 等），
  // 旧 id 保留只为兼容历史行。
  const agentNames: Record<string, string> = {
    'skill:goal-conversation': '目标对话',
    'goal-agent': '目标对话',
    'skill:path-planning': '学习路径规划',
    // 2026-11-04：路径生成编排器此前未收录，行内直接印内部 id「path-agent」
    'path-agent': '路径生成',
    // 2026-11-06 文案排查 §7：原展示名「阶段任务设计」含内部词「阶段任务」（门禁 R4），
    // 改为「课程阶段设计」——同一能力，用户可读且不再直出内部生成阶段名。
    'skill:stage-designer': '课程阶段设计',
    'skill:path-reviewer': '路径评审',
    'skill:kc-mapper': '知识点映射',
    'teaching-agent': 'AI 授课',
    'skill:teaching-turn': 'AI 授课',
    'skill:peer-reinforcement': '伴学补强',
    'skill:session-wrapup': '课后总结',
    'skill:teaching-opening-generator': '课堂开场',
    'skill:board-designer': '课堂板书',
    'ai-teaching-agent': 'AI 授课',
    'profile-agent': '学习者 Agent',
    'skill:learner-model': '学习者模型',
    'skill:lesson-knowledge-enricher': '课后知识增强',
    'skill:adaptive-guidance-copy': '自适应引导文案',
    'skill:learner-progress-report': '学习进度报告',
    'skill:learner-state-review': '学习状态复盘',
    'skill:concept-consolidator': '概念归并',
    'skill:concept-load-estimator': '概念负担评估',
    'skill:replan-attribution': '重排归因',
    'skill:learning-predictor': '学习表现预测',
    'learner-model-agent': '学习者模型',
    'ai-tutor': 'AI 辅导',
    'system-call': '平台底层调用'
  };
  
  return agentNames[agentId] || agentId;
};

const getLogSourceLabel = (log: AgentLogItem) => {
  if (log.logSource === 'business') {
    return '业务层';
  }

  if (log.logSource === 'runtime') {
    return '运行时';
  }

  if (log.logSource === 'infrastructure') {
    return '平台底层';
  }

  if (String(log.id || '').startsWith('acl_')) {
    return '业务层';
  }

  if (log.agentId === 'system-call' || log.agentId === 'unknown') {
    return '平台底层';
  }

  return '业务层';
};

const getCapabilityType = (agentId?: string) => {
  // agent → 能力类型映射（显示层字典，与上方 agentNames 同源；无 agent 清单 API，
  // 保持本地映射，未命中归为 system）。
  // #218：键与后端 capabilityType 派生分组对齐（manifest monitoringGroup），
  // 否则服务端按该能力筛出的行会在客户端二次过滤（displayLogs）时被丢掉，
  // 表现为「表里只剩几行、页脚总数却是几十条」。四个能力组须 100% 覆盖 manifest id。
  // tutoring 无对应 manifest agent，保留键仅为兼容历史行。
  const mapping: Record<string, string> = {
    'skill:goal-conversation': 'goal',
    'goal-agent': 'goal',
    'skill:path-planning': 'path',
    // 2026-11-04：path-agent 是路径生成编排器，此前未收录被归到 system，
    // 同一行来源标「业务层」、能力标「平台底层调用」自相矛盾（也与「隐藏底层调用」冲突）
    'skill:stage-designer': 'path',
    'skill:path-reviewer': 'path',
    'skill:kc-mapper': 'path',
    'path-agent': 'path',
    'teaching-agent': 'teaching',
    'skill:teaching-turn': 'teaching',
    'skill:peer-reinforcement': 'teaching',
    'skill:session-wrapup': 'teaching',
    'skill:teaching-opening-generator': 'teaching',
    'skill:board-designer': 'teaching',
    'ai-teaching-agent': 'teaching',
    'ai-tutor': 'tutoring',
    'profile-agent': 'profile',
    'skill:learner-model': 'profile',
    'skill:lesson-knowledge-enricher': 'profile',
    'skill:adaptive-guidance-copy': 'profile',
    'skill:learner-progress-report': 'profile',
    'skill:learner-state-review': 'profile',
    'skill:concept-consolidator': 'profile',
    'skill:concept-load-estimator': 'profile',
    'skill:replan-attribution': 'profile',
    'skill:learning-predictor': 'profile',
    'learner-model-agent': 'profile',
    'unknown': 'system',
    'system-call': 'system'
  };

  return mapping[agentId ?? ''] || 'system';
};

const getCapabilityTypeLabel = (agentId?: string) => {
  const labels: Record<string, string> = {
    goal: '需求收集',
    path: '路径规划',
    teaching: '授课内容',
    tutoring: '辅导答疑',
    tracking: '进度追踪',
    profile: '学习者模型',
    system: '平台底层调用'
  };

  return labels[getCapabilityType(agentId)] || '系统调用';
};

const formatJson = (json: unknown) => {
  if (!json) return '';
  try {
    return JSON.stringify(typeof json === 'string' ? JSON.parse(json) : json, null, 2);
  } catch {
    return json;
  }
};

const formatTextBlock = (value: unknown) => {
  if (!value) {
    return '暂无';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '暂无';
    }

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseMetadata = (metadata: unknown): Record<string, unknown> => {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return metadata as Record<string, unknown>;
};

const MODEL_SOURCE_LABELS = { user: '用户 AI API', platform: '内置模型' } as const;

const getModelSourceInfo = (log: AgentLogItem | null) => {
  const metadata = parseMetadata(log?.metadata);
  const usesUserProvider = !!metadata.usesUserProvider;
  const modelName = (typeof log?.model === 'string' ? log.model : '')
    || (typeof metadata.model === 'string' ? metadata.model : '')
    || '';
  const trimmedModelName = modelName.trim();
  const sourceLabel = usesUserProvider ? MODEL_SOURCE_LABELS.user : MODEL_SOURCE_LABELS.platform;

  return {
    usesUserProvider,
    label: sourceLabel,
    /* 表格「模型」列优先给实际模型名（如 deepseek-v4.1-flash）；日志未带模型时退回来源标签 */
    display: trimmedModelName || sourceLabel,
    providerName: metadata.providerName || 'platform-default',
    providerBaseUrl: metadata.providerBaseUrl || '-',
    providerId: metadata.providerId || 'platform-default'
  };
};

const toDiagnosticLog = (log: AgentLogItem) => ({
  id: log.id,
  agentId: log.agentId,
  agentLabel: formatAgentId(log.agentId),
  capabilityType: getCapabilityTypeLabel(log.agentId),
  success: log.success,
  durationMs: log.durationMs,
  tokensUsed: log.tokensUsed,
  error: log.error,
  calledAt: log.calledAt,
  modelSource: getModelSourceInfo(log),
  metadata: log.metadata
});

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
};

const copyText = async (text: string, successMessage: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch {
    toast.error('复制失败，请检查浏览器权限');
  }
};
</script>

<style scoped>
.agent-logs-page {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: grid;
  gap: 16px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.filters {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 16px;
  background: var(--surface, #fff);
  box-shadow: var(--mk-shadow-sm);
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: flex-end;
}

.filter-item {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.filter-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted, #5b6577);
}

.filter-select {
  width: 150px;
}

.filter-dates {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-dates input {
  width: 130px;
  height: 42px;
}
/* 日期输入的日历钮是浏览器自绘：压到与其它图标同一灰度，悬停再提亮；
   color-scheme 让弹出的日历跟随明暗主题，不出现白底日历压在暗色页上。 */
.filter-dates input[type='date'] {
  color-scheme: light;
  cursor: pointer;
}
.filter-dates input[type='date']::-webkit-calendar-picker-indicator {
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}
.filter-dates input[type='date']:hover::-webkit-calendar-picker-indicator {
  opacity: 0.9;
}
html[data-theme='dark'] .filter-dates input[type='date'] {
  color-scheme: dark;
}

.filter-dates__sep {
  color: var(--faint, #67758f);
  font-size: 12px;
}

.filter-item--switch {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 「隐藏底层调用」这行是 label + 开关：点 label 任意处都能切换，手势目标就是 label 本身，
     原来只有 28px 高（mobile:spec 按 label 量，lt36 门禁）。 */
  min-height: 36px;
  padding-bottom: 6px;
}

.filter-switch-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted, #5b6577);
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 2px;
}

.stats {
  margin: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.stat-card {
  padding: 14px 16px;
  border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line, #e3e9f4);
  background: var(--canvas, #f3f6fb);
  box-shadow: none;
  display: grid;
  gap: 6px;

  span {
    font-size: 12px;
    font-weight: 700;
    color: var(--faint, #67758f);
  }

  strong {
    /* 22 → 20（2026-09-27 桌面数字刻度：首屏主 KPI 24 / 统计卡 20 / 行内 16） */
    font-size: 20px;
    font-weight: 800;
    color: var(--ink, #172033);
    line-height: 1.2;
  }
}

.logs-card {
  padding: 0;
  overflow: hidden;
}

.logs-table {
  min-width: 1080px;
}

/* 表头与筛选器、正文同一套中英文混排：共享 .uc-table th 的 uppercase 会把 Agent/Token
   拉成全大写，与同表中文列（来源/能力/状态…）排在一起像两种语言两种字号体系。
   取消转换后复用 12px/700 的窄体表头，只留一点字距。 */
.logs-table th {
  text-transform: none;
  letter-spacing: 0.02em;
}

/* 0 条且确有筛选时给出口：只写「调整筛选条件」会让用户自己回去猜是哪一项 */
.uc-empty__action {
  margin-top: 4px;
}

/* 横拖提示：桌面档不渲染（表能完整放下），仅窄屏档显示 */
.scroll-hint {
  display: none;
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--faint, #67758f);
  text-align: center;
  background: var(--canvas, #f3f6fb);
  border-bottom: 1px solid var(--line, #e3e9f4);
}

.logs-error-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pagination {
  margin: 0;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-top: 1px solid var(--line, #e3e9f4);
}

.pagination__total {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
}

.pagination__size {
  /* 包裹层只定宽，按钮视觉由 MkSelect 承担（2026-10-27 自绘下拉） */
  width: 110px;
}

.pagination__nav {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pagination__page {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  white-space: nowrap;
}

.uc-dialog--detail {
  width: min(880px, 100%);
}

.detail-collapse {
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 12px;
  background: var(--surface, #fff);
  overflow: hidden;
}

/* 2026-11-04 走查：弹窗体是 display:grid，三个折叠节被均分压扁（「输出 (output)」块可见 0px，
   body 又因内容被裁而无滚动余量）。min-height:min-content 让节拒绝被压到内容以下——
   总高超出弹窗时由 .uc-dialog__body 的 overflow-y 兜底滚动，输入/输出永远可达。 */
.detail-collapse {
  min-height: min-content;
}

.detail-collapse summary {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink, #172033);
  background: var(--canvas, #f3f6fb);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-collapse summary::after {
  content: '▾';
  color: var(--faint, #67758f);
  font-size: var(--mk-fs-micro);
  transition: transform 0.15s ease;
}

.detail-collapse:not([open]) summary::after {
  transform: rotate(-90deg);
}

.detail-collapse summary::-webkit-details-marker {
  display: none;
}

.detail-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  padding: 4px 0;
}

.detail-fact {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line, #e3e9f4);
  align-items: baseline;
  font-size: 13px;
}

.detail-fact--wide {
  grid-column: 1 / -1;
}

.detail-fact span {
  color: var(--faint, #67758f);
  font-size: 12px;
  font-weight: 700;
}

.detail-fact strong {
  color: var(--ink, #172033);
  word-break: break-all;
  font-weight: 600;
}

.detail-error-box {
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  /* 墨色走 token：写死的 #c0454a 在暗色下对比度不足 */
  color: var(--red-ink, #c0454a);
  border-radius: var(--mk-radius-lg);
  padding: 12px;
  margin: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.code-block {
  background: var(--canvas, #f3f6fb);
  border: 1px solid var(--line, #e3e9f4);
  padding: 10px;
  border-radius: 8px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: var(--mk-mono);
  font-size: 12px;
  color: var(--ink, #172033);
  margin: 12px;
}

.io-block {
  margin: 12px;
}

.io-block + .io-block {
  margin-top: 16px;
}

.io-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #67758f);
  margin-bottom: 6px;
}

.io-block .code-block {
  margin: 0;
}

@media (max-width: 1100px) {
  /* 窄屏才给横拖提示与常显横滚条（thumb 常驻，用户能看出右侧还有列） */
  .scroll-hint {
    display: block;
  }

  .logs-scroll {
    scrollbar-width: thin;
  }

  .logs-scroll::-webkit-scrollbar {
    height: 8px;
  }

  .logs-scroll::-webkit-scrollbar-thumb {
    background: var(--line, #cbd5e1);
    border-radius: 4px;
  }

  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* 2026-09-24 反馈「个人中心五个选项里的内容都偏大」：统计卡 14/16 → 10/12、
     数字 22 → 16px；表格单元格 uc.css 移动端块已收一轮，这里再压一档行内间距。 */
  .stat-card { padding: 10px 12px; }
  .stat-card strong { font-size: 16px; }
  .logs-table td, .logs-table th { padding: 7px 8px; }

  /* 行内两个文字动作按触控契约抬到 44×44（共享 .uc-btn--link 的 36px 是桌面档，
     本页表格在窄屏要横拖，手指更容易点偏） */
  .logs-table .uc-btn--link {
    min-height: 44px;
    padding: 10px 10px;
  }

  .actions {
    width: 100%;
    justify-content: flex-start;
  }

  /* 页头三个导出/复制按钮原本各占一整行（页头 193px），字号与内边距收紧后
     390/320 都能排成一行（~262px）；放不下时整体换行而不是把按钮压扁 */
  .actions > * {
    flex: 0 0 auto;
    padding: 8px 10px;
    font-size: 12px;
    white-space: nowrap;
  }

  /* 窄屏：筛选项整行铺开，日期区间可换行，避免两个 130px 日期输入撑破页面 */
  .filter-item {
    flex: 1 1 100%;
  }

  .filter-dates {
    flex-wrap: wrap;
  }

  .filter-dates input {
    width: auto;
    flex: 1 1 130px;
    min-width: 0;
  }

  .filter-select {
    width: 100%;
  }

  .detail-facts {
    grid-template-columns: 1fr;
  }

  .detail-fact--wide {
    grid-column: auto;
  }
}
</style>
