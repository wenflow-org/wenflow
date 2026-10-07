<template>
  <!-- 2026-10-05：整卡折叠退役（details 包壳）——唯一挂载点是健康中心的「对账」页签，
       页签已承担分区，卡头回归常驻；?recon=1 深链保留自动滚动定位 -->
  <section ref="recPanelRef" class="mk-card sk-rec">
    <div class="mk-card__head">
      <div class="sk-rec__title">
        <h3 class="mk-card__title">技能对账</h3>
        <span class="mk-card__meta" title="核对四个来源的登记是否一致：配置文件清单（manifest）、系统运行注册（gateway）、生效版本（ACTIVE prompt）、技能登记册">配置文件 × 运行注册 × 生效版本 × 登记册</span>
        <!-- 口径说明（审核 #83）：对账数据不在页面 60s 轮询内，进入本页签时拉取一次；
             手刷钮仅在自取模式出现（宿主下发报告时数据归宿主，刷新由宿主承担） -->
        <span class="mk-card__meta" title="对账报告不随健康中心 60s 轮询，切换进入本页签时拉取一次；失败态可重试">进入本页签时刷新 · 不随 60s 轮询</span>
        <button v-if="recDiff" type="button" class="mk-link sk-rec__clear" @click="clearRecDiff">✕ 清除差集定位</button>
      </div>
      <MkLoading v-if="recLoading" inline />
      <template v-else-if="recReport">
        <!-- 口径 pill（中性 mk-pill）+ 异常计数（mk-badge 语气，替代自造色块） -->
        <div class="sk-rec__pills">
          <span class="mk-pill" :title="`技能登记册全量（含外挂能力）vs 目录`">已上线 {{ recReport.summary.byStatus.live || 0 }} / {{ recReport.summary.total }}</span>
          <span v-if="recReport.summary.unregistered" class="mk-badge mk-badge--bad">未注册 {{ recReport.summary.unregistered }}</span>
          <span v-if="recReport.summary.activeMissing" class="mk-badge mk-badge--warn" title="缺 ACTIVE：无生效版本">无生效版本 {{ recReport.summary.activeMissing }}</span>
          <span v-if="recReport.summary.orphanRegistrations" class="mk-badge mk-badge--bad" title="登记册已删除/不存在，但注册记录仍残留（幽灵注册）">失效注册 {{ recReport.summary.orphanRegistrations }}</span>
          <span v-else class="mk-pill">失效注册 0</span>
        </div>
        <!-- 常驻手刷钮撤（审核 #83）：对账数据不随 60s 轮询，进入本页签即挂载重拉；
             轮询家族规则「轮询页不放刷新钮」，失败/空态仍保留重试逃生动作 -->
      </template>
    </div>

    <MkEmptyState
      v-if="recError"
      title="对账数据加载失败"
      :description="recError"
      action-text="重试"
      @action="refresh"
    />
    <!-- 行列表骨架（形状走 MkSkeleton，本类只保留卡片内边距） -->
    <MkSkeleton
      v-else-if="recLoading && !recReport"
      class="sk-rec__skeleton"
      variant="rows"
      :count="8"
      :h="26"
    />
    <template v-else-if="recReport">
      <div class="sk-rec-tools">
        <div class="mk-pills">
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !recOnlyAbnormal }" :aria-pressed="!recOnlyAbnormal" @click="recOnlyAbnormal = false">全部</button>
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': recOnlyAbnormal }" :aria-pressed="recOnlyAbnormal" @click="recOnlyAbnormal = true">仅看异常</button>
        </div>
        <!-- 2026-10-07 F6-3：异常口径与卡头 pill / 概要「对账异常」KPI 统一为「未注册 / 无生效版本 / 失效注册残留」
             三项（完成度非 live 属「完成度」页签与第 4 张 KPI 的域，不再并进对账异常——原口径把两域混算，
             造成 KPI 与筛选行集互斥） -->
        <span class="mk-card__meta" title="异常 = 未注册（配置声明缺失）/ 无生效版本（缺 ACTIVE）/ 失效注册残留（登记册已删但注册仍残留）">异常 = 未注册 / 无生效版本 / 失效注册残留</span>
      </div>
      <div class="mk-table-scroll">
        <table v-if="recReport.items.length && recPageRows.length" class="mk-table sk-table sk-rec-table mk-table--fixed">
          <colgroup>
            <col style="width:var(--mk-col-text)">
            <col style="width:var(--mk-col-badge)">
            <col style="width:var(--mk-col-badge)">
            <col style="width:var(--mk-col-badge)">
            <col style="width:var(--mk-col-badge)">
            <col style="width:var(--mk-col-text)">
          </colgroup>
          <thead>
            <tr>
              <th>Skill</th>
              <th title="manifest：是否在配置文件中声明">配置声明</th>
              <th title="gateway 注册：是否已在系统运行中注册">运行注册</th>
              <th title="ACTIVE prompt：是否有生效版本">生效版本</th>
              <th>完成度</th>
              <th title="差集：本表只列未注册 / 无生效版本两类异常；登记册成员恒为「已登记」故不再单列。失效注册残留（登记册已删但注册仍在）列在表下「失效注册残留」块，同属对账异常但无户口簿行可挂">差集</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(e, i) in recPageRows" :key="e.kind === 'group' ? `g-${e.group.parentAgent}-${i}` : e.row.skillId">
              <tr v-if="e.kind === 'group'" class="sk-rec-group">
                <td colspan="6">
                  <span class="sk-rec-group__name">{{ e.group.parentAgent }}</span>
                  <span class="sk-rec-group__meta">下辖 {{ e.group.items.length }} 条</span>
                  <span class="sk-rec-group__meta">live {{ e.group.liveCount }} / {{ e.group.items.length }}</span>
                </td>
              </tr>
              <tr
                v-else
                class="sk-row"
                :class="{ 'sk-rec-flash': recDiff && e.row.diff === recDiff }"
                tabindex="0"
                @click="$emit('openSkill', e.row.skillId)"
                @keydown.enter.prevent="$emit('openSkill', e.row.skillId)"
              >
                <td>
                  <div class="sk-cell">
                    <span class="sk-dot" :class="`sk-dot--${recDotTone(e.row)}`"></span>
                    <div class="mk-cell-main">
                      <strong class="sk-id-main" :title="e.row.skillId">{{ e.row.skillId }}</strong>
                      <span class="sk-name-desc">{{ e.row.displayName || recKindText(e.row.kind) }}<template v-if="e.row.stage"> · {{ e.row.stage }}</template></span>
                    </div>
                  </div>
                </td>
                <td>
                  <span :class="['sk-rec-yn', e.row.manifest ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ e.row.manifest ? '✓' : '✗' }}</span>
                  <span v-if="e.row.kind === 'aux' && !e.row.manifest" class="mk-badge mk-badge--muted sk-rec-tag">免注册</span>
                </td>
                <td>
                  <span :class="['sk-rec-yn', e.row.registered ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ e.row.registered ? '✓' : '✗' }}</span>
                  <span v-if="e.row.registrationExempt" class="mk-badge mk-badge--muted sk-rec-tag">豁免</span>
                </td>
                <td>
                  <span :class="['sk-rec-yn', e.row.active ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ e.row.active ? '✓' : '✗' }}</span>
                  <span v-if="e.row.noPromptFile" class="mk-badge mk-badge--muted sk-rec-tag">纯函数</span>
                </td>
                <td>
                  <span class="mk-badge" :class="`mk-badge--rec-${e.row.completion.status}`" :title="recGateDetail(e.row.completion)">{{ recStatusText(e.row.completion.status) }}</span>
                </td>
                <td>
                  <span v-if="e.row.diff === 'unregistered'" class="mk-badge mk-badge--bad">未注册</span>
                  <span v-else-if="e.row.diff === 'active-missing'" class="mk-badge mk-badge--warn" title="缺 ACTIVE：无生效版本">无生效版本</span>
                  <span v-else class="mk-na">—</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <!-- EG21：筛选后 0 行时表体不再空白——落共享空态 MkEmptyState（compact 档，
             一句现状结论），而非手写 .mk-empty（设计守卫规则 4）。 -->
        <MkEmptyState
          v-else-if="recReport.items.length"
          compact
          :title="recEmptyText"
        />
      </div>
      <div v-if="recCanMore" class="mk-list-more">
        <button type="button" class="mk-link" @click="recLoadMore">加载更多（已显示 {{ recShown.length }} / {{ recFlat.length }}）</button>
      </div>
      <div v-if="recReport.orphanRegistrations.length" class="sk-rec-orphans">
        <strong title="登记册已删除/不存在，但注册记录仍残留">失效注册残留</strong>
        <span v-for="orphan in recReport.orphanRegistrations" :key="orphan.name" class="mk-badge mk-badge--bad">{{ orphan.name }}</span>
      </div>
      <div class="sk-rec-legend">
        <span v-for="s in recStatusOrder" :key="s" class="sk-rec-legend__item">
          <i class="mk-badge" :class="`mk-badge--rec-${s}`"></i>{{ recStatusText(s) }}
        </span>
        <span class="mk-card__meta">技能登记册口径 {{ recReport.summary.total }} 条 · {{ recReport.generatedAt ? '对账于 ' + new Date(recReport.generatedAt).toLocaleString() : '' }}</span>
      </div>
    </template>
    <MkEmptyState
      v-else
      title="暂无对账数据"
      description="技能尚未登记，或对账报告暂不可用。可点击「刷新」重试。"
      action-text="刷新"
      :action-busy="recLoading"
      action-busy-text="刷新中…"
      @action="refresh"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { isLive } from "./store";
import { errMsg } from "./live";
import { completionMetaOf } from "./glossaryMeta";
import { useLoadMore } from "./useLoadMore";
import MkEmptyState from "@/components/mk/MkEmptyState.vue";
import MkLoading from "@/components/mk/MkLoading.vue";
import MkSkeleton from "@/components/mk/MkSkeleton.vue";
import { adminSkillsApi, type SkillCompletion, type SkillReconciliationReport } from "@/api/adminApi";
// adminSkillsApi 仍被自取模式（无 report prop）使用

const props = defineProps<{ report?: SkillReconciliationReport | null; error?: string | null }>();
const emit = defineEmits<{ (e: "openSkill", id: string): void; (e: "refresh"): void }>();

const ownReport = ref<SkillReconciliationReport | null>(null);
const ownError = ref("");
/** 宿主（Skills 目录表）是唯一拉取方并经 prop 下发（避免同屏双请求）；prop 缺省（独立挂载/测试）时自取。
    报告与错误都用 computed 收敛两条来源，下游 watch/模板无需感知差别（失败态仍走「重试」→ 事件回流宿主） */
const recReport = computed<SkillReconciliationReport | null>(() =>
  props.report !== undefined ? props.report : ownReport.value
);
const recError = computed<string>(() => (props.error !== undefined ? props.error || "" : ownError.value));
const recLoading = ref(false);
const recOnlyAbnormal = ref(false);
const route = useRoute();
const recDiff = ref("");
const recPanelRef = ref<HTMLElement | null>(null);
let recDeepLinked = false;

function applyRecQuery() {
  const recon = String(route.query.recon || "");
  const diff = typeof route.query.diff === "string" ? route.query.diff : "";
  recDeepLinked = recon === "1" || recon === "true";
  recDiff.value = diff === "unregistered" || diff === "active-missing" || diff === "live" ? diff : "";
}
function clearRecDiff() { recDiff.value = ""; }

watch(recReport, async (report) => {
  if (!report || !recDeepLinked) return;
  await nextTick();
  recPanelRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
});

async function refresh() {
  // prop 模式下数据归宿主所有 → 事件回流请宿主重拉，避免出现两份各自为政的报告状态
  if (props.report !== undefined) {
    emit("refresh");
    return;
  }
  recLoading.value = true;
  ownError.value = "";
  try {
    const res = await adminSkillsApi.getReconciliation();
    ownReport.value = res.data?.data ?? null;
  } catch (e) {
    ownError.value = errMsg(e);
    ownReport.value = null;
  } finally {
    recLoading.value = false;
  }
}

// isLive 翻转的刷新节奏由宿主承担（prop 模式），仅自取模式在此响应
watch(isLive, () => { if (props.report === undefined) refresh(); });
onMounted(() => { applyRecQuery(); refresh(); });

const recStatusOrder = ["draft", "handler-ready", "core-ready", "fields-synced", "live"] as const;
const recStatusText = (status: string) => completionMetaOf(status)?.label || status;

const REC_AGENT_ORDER = ["goal-agent", "path-agent", "teaching-agent", "profile-agent", "simulation-agent"];
type RecRow = SkillReconciliationReport["items"][number];
interface RecGroup { parentAgent: string; items: RecRow[]; liveCount: number; }
type RecEntry = { kind: "group"; group: RecGroup } | { kind: "row"; row: RecRow };

const recGroups = computed<RecGroup[]>(() => {
  if (!recReport.value) return [];
  const groups = new Map<string, RecRow[]>();
  for (const row of recReport.value.items) {
    const key = row.parentAgent || "未归属";
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ai = REC_AGENT_ORDER.indexOf(a), bi = REC_AGENT_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  return keys.map((parentAgent) => {
    const items = groups.get(parentAgent)!;
    return { parentAgent, items, liveCount: items.filter((r) => r.completion.status === "live").length };
  });
});

function matchesRecFilter(row: RecRow): boolean {
  if (recOnlyAbnormal.value && !isRecAbnormal(row)) return false;
  if (recDiff.value === "unregistered") return row.diff === "unregistered";
  if (recDiff.value === "active-missing") return row.diff === "active-missing";
  if (recDiff.value === "live") return row.completion.status === "live";
  return true;
}
/** 异常口径（2026-10-07 F6-3 与卡头 pill / 概要「对账异常」KPI 单源）：未注册 / 无生效版本（row.diff）
    + 失效注册残留（表下残留块，无户口簿行可挂）。完成度非 live 属「完成度」页签与第 4 张 KPI 的域，
    不再并进本筛选——原口径「diff ∪ 非 live」使筛选行集大于 KPI 可定位集，同屏两套互斥口径。 */
function isRecAbnormal(row: RecRow): boolean { return row.diff !== null; }

const recFlat = computed<RecEntry[]>(() => {
  const out: RecEntry[] = [];
  for (const g of recGroups.value) {
    const items = recDiff.value || recOnlyAbnormal.value ? g.items.filter(matchesRecFilter) : g.items;
    if ((recDiff.value || recOnlyAbnormal.value) && !items.length) continue;
    out.push({ kind: "group", group: { ...g, items, liveCount: items.filter((r) => r.completion.status === "live").length } });
    for (const row of items) out.push({ kind: "row", row });
  }
  return out;
});
const { shown: recShown, canMore: recCanMore, loadMore: recLoadMore } = useLoadMore(recFlat, 15);

const recPageRows = computed<RecEntry[]>(() => {
  const seen = new Set<string>();
  const out: RecEntry[] = [];
  for (const e of recShown.value) {
    if (e.kind === "group") { seen.add(e.group.parentAgent); out.push(e); }
    else {
      const key = e.row.parentAgent || "未归属";
      if (!seen.has(key)) {
        const found = recFlat.value.find((x) => x.kind === "group" && x.group.parentAgent === key);
        if (found?.kind === "group") { out.push(found); seen.add(key); }
      }
      out.push(e);
    }
  }
  return out;
});

/** 筛选后 0 行的空态文案（EG21）：把「空表体」换成可读结论——「无异常技能：N 项全部对账一致」等。
    F6-3：失效注册残留无户口簿行、不在表内，空态必须如实披露（否则与卡头「失效注册 N」pill 打架） */
const recEmptyText = computed<string>(() => {
  const total = recReport.value?.summary.total ?? 0;
  if (recDiff.value === "unregistered") return "无未注册 Skill：全部已在配置文件中声明";
  if (recDiff.value === "active-missing") return "无缺生效版本的 Skill：全部有 ACTIVE prompt";
  if (recDiff.value === "live") return "无完成度 live 的 Skill";
  const orphans = recReport.value?.orphanRegistrations.length ?? 0;
  if (orphans > 0) return `无异常技能：${total} 项全部对账一致；另有 ${orphans} 条失效注册残留（见下方「失效注册残留」）`;
  return `无异常技能：${total} 项全部对账一致`;
});

const recKindText = (kind: string) => ({ mainline: "主线", aux: "辅助", "handler-only": "纯函数" })[kind] || kind;
function recDotTone(row: RecRow) {
  if (row.diff === "unregistered") return "error";
  if (row.completion.status === "live") return "ok";
  return "idle";
}
function recGateDetail(completion: SkillCompletion): string {
  const gates: Array<[string, string]> = [
    ["draft", "技能登记册"], ["handlerReady", "handler 注册"], ["coreReady", "core 文件"],
    ["fieldsSynced", "字段路由"], ["live", "ACTIVE prompt"],
  ];
  for (const [key, label] of gates) {
    const gate = completion.gates[key as keyof typeof completion.gates];
    if (!gate?.ok) return `${label}：${gate?.detail || "未通过"}`;
  }
  return "全部门槛通过";
}

// 2026-10-05：整卡折叠退役后 openPanel/recOpen 不再有意义（唯一挂载点=健康中心「对账」页签，
// 页签即展开态）；refresh/recDiff 仍暴露给潜在宿主
defineExpose({ refresh, recReport, recDiff });
</script>
<style scoped>
.sk-rec { margin-top: 0; }
.sk-rec-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px 4px; }
.sk-rec__title { display: flex; flex-direction: column; gap: 2px; }
.sk-rec__clear { width: fit-content; }
.sk-rec-flash { animation: sk-rec-flash 1.4s ease 2; }
/* 差集定位闪烁：琥珀底走 token（暗色自动翻转，亮色档硬编码与暗色补丁已删） */
@keyframes sk-rec-flash { 0%,100% { background: transparent; } 50% { background: var(--mk-amber-bg); } }

.sk-rec__pills { display: inline-flex; gap: 6px; margin-left: auto; flex-wrap: wrap; align-items: center; }
/* 同行里 mk-pill（中性口径）与 mk-badge（异常语气）统一到同一档尺寸，避免高矮不齐 */
.sk-rec__pills > * { padding: 5px 12px; border-radius: 999px; font-size: var(--mk-fs-micro); font-weight: 600; }
.sk-rec__skeleton { padding: 12px; }
.sk-rec-table th, .sk-rec-table td { text-align: left; }
.sk-rec-yn { font-weight: 700; font-size: var(--mk-fs-body); }
.sk-rec-yn--ok { color: var(--mk-green); }
.sk-rec-yn--no { color: var(--mk-red); }
/* 免注册 / 豁免 / 纯函数：语气归 mk-badge--muted，本类只留与 ✓/✗ 的间距 */
.sk-rec-tag { margin-left: 4px; vertical-align: 1px; }
.sk-rec-orphans { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px dashed var(--mk-line); font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.sk-rec-orphans .mk-badge { margin-left: 0; }
/* 分组行不覆写内边距：单行小字单元格曾因 6px 纵向内边距落到 37px，低于 SPEC §3 的 40px 行高下限。
   跟随 .mk-table td 的档位节奏（9px 起，≥2800 档 14px）后为 43px 且随档位增长。 */
.sk-rec-group td { background: var(--mk-surface-2); border-bottom: 1px solid var(--mk-line); }
/* 分组行组名（审核 #80）：--mk-blue 在 --mk-surface-2 底上亮色仅 4.39:1（<4.5:1），
   换同色系深档 --mk-accent-deep（亮 5.68:1 / 暗 5.92:1），字号档位不动 */
.sk-rec-group__name { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-accent-deep); }
.sk-rec-group__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); margin-left: 10px; }
.sk-rec-legend { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid var(--mk-line); font-size: var(--mk-fs-micro); }
.sk-rec-legend__item { display: inline-flex; align-items: center; gap: 4px; }
.sk-rec-legend .mk-card__meta { margin-left: auto; }

/* ===== 目录行基础样式（复制自宿主 Skills.vue 的 scoped CSS） =====
   这些类（.sk-row/.sk-cell/.sk-id-main/.sk-name-desc/.sk-dot）此前只存在于宿主
   scoped style，跨组件不生效 → 对账行健康点不可见、样式全丢。scoped 隔离机制
   不动，改为本组件自带同款声明（保持与宿主目录表视觉一致）。 */
.sk-row { cursor: pointer; }
.sk-cell { display: flex; align-items: center; gap: 10px; }
.sk-id-main {
  font-family: var(--mk-mono);
  font-weight: 700;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-name-desc {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  line-height: 1.5;
  font-family: inherit;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  max-width: var(--mk-cell-main-max);
}
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sk-dot--ok { background: var(--mk-green); }
.sk-dot--idle { background: var(--mk-faint); }
.sk-dot--error { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
@keyframes sk-blink { 50% { opacity: 0.3; } }

/* 大屏档位与宿主同款（mk 体系：2000 ≈×1.15，2800 ≈×1.17，3600 ≈×1.3） */
@media (min-width: 2000px) {
  .sk-dot { width: 10px; height: 10px; }
  .sk-id-main { font-size: var(--mk-fs-micro); }
  .sk-name-desc { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .sk-dot { width: 12px; height: 12px; }
  .sk-id-main { font-size: var(--mk-fs-micro); }
  .sk-name-desc { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .sk-dot { width: 14px; height: 14px; }
  .sk-id-main { font-size: var(--mk-fs-emphasis); }
  .sk-name-desc { font-size: var(--mk-fs-body); }
}

/* 暗色模式：色值全部走 --mk-* token（surface/amber-bg/faint 随主题自动翻转），
   原先的亮色硬编码 + 暗色补丁段已删（无残留规则）。 */
</style>
