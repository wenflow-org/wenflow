<template>
  <!-- 工程：基础信息 / 依赖与发布 / 运行时契约 / 上下游调用协议 / Skill 规则总览（低频只读区块）。
       2026-11-06 整合：五块统一走卡 + 共享段头 + 共享键值（.mk-facts--rows），
       原先手搓的 .sdp-kv 表（自带灰底列与硬编码色值）整套下线；
       与宿主「工程信息」那张 kv 卡合并成一份（宿主那份已删）。 -->
  <div class="sdp-pane">
    <section class="mk-card">
      <div class="mk-card__head"><h3 class="mk-card__title">基础信息</h3></div>
      <div class="sdp-eng__body">
        <div class="mk-facts mk-facts--rows">
          <div><span title="kind">类型</span><strong class="mono">{{ overview.kind }}</strong></div>
          <div v-if="overview.db?.version">
            <span title="db.version">生效版本</span>
            <strong class="mono">v{{ overview.db.version }}</strong>
          </div>
          <!-- B19-F7-3：agent_prompts.useCount 列（2026-10-31 四轮评审撤除）——
               该计数列后端从未递增（全库检索无任何 increment 写点），恒显 0，
               与运行时 KPI/版本页签的真实调用数（调用日志聚合 191 次）同屏打架。
               数据列启用前不再上屏「0」，避免把假零读成真没调用。 -->
          <!-- 2026-11-06：标签写「发布时记录的模型」——它是发布时写进 agent_prompts 的值，
               运行时实际用哪个由「模型与路由」那张卡决定（两处口径不同，标签写「默认模型」
               会被读成「现在跑的就是它」）。 -->
          <div v-if="overview.db?.model">
            <span>发布时记录的模型</span>
            <strong class="mono" title="发布时记录下来的模型，运行时实际用哪个由「模型与路由」决定">{{ overview.db.model }}</strong>
          </div>
          <div v-if="overview.db?.publishedAt"><span>发布时间</span><strong>{{ fmtTime(String(overview.db.publishedAt)) }}</strong></div>
          <!-- 2026-11-11（困惑测试 #87）：标签「不一致状态」不说是谁和谁不一致，值「已同步」也不说比的是什么。
               后端比的是磁盘 prompt 文件正文哈希 vs agent_prompts 生效记录正文哈希（prompt-ops-overviews.ts）。 -->
          <div v-if="overview.drift">
            <span title="磁盘 Prompt 文件正文与数据库生效记录正文的内容哈希是否一致。已同步 = 两边正文相同">不一致状态</span>
            <strong class="mono" :class="overview.drift === 'in-sync' ? 'sdp-ok' : 'sdp-warn'">{{ driftLabel(overview.drift) }}</strong>
          </div>
        </div>

        <!-- 开发者底层工程元数据（2026-11-08 用户「把 TypeScript 代码文件路径和行号、数据库种子 ID
             全摆在明面上」）：机器标识（Agent 标识 / Prompt 文件路径 / 文件哈希 / 生效记录 ID）
             折进默认收起的抽屉，日常读「这个 Skill 是什么、发布的哪一版」不需要它们，
             排障要时再展开。 -->
        <details class="sdp-adv">
          <summary class="sdp-adv__sum">开发者底层工程元数据</summary>
          <div class="mk-facts mk-facts--rows sdp-adv__body">
            <div><span title="agentId">Agent 标识</span><strong class="mono">{{ overview.agentId }}</strong></div>
            <!-- 2026-11-02 评审：这一行是 core 编译出来的 Prompt 文件（agent-overview 的 file.path），
                 不是可编辑的核心文件；标签写「文件路径」会与协议页签的 prompts/core/<id>.yaml 撞名。 -->
            <div v-if="overview.file">
              <span title="file.path">Prompt 文件</span>
              <strong class="mono" :title="overview.file.path">{{ overview.file.path }}</strong>
            </div>
            <div v-if="overview.file?.hash">
              <span title="file.hash">Prompt 文件哈希</span>
              <strong class="mono" :title="`${overview.file.hash}（编译产物 prompts/${skillId}.md 的正文哈希）`">{{ shortHash(overview.file.hash) }}</strong>
            </div>
            <div v-if="overview.db?.id">
              <span title="db.id">生效记录 ID</span>
              <strong class="mono">{{ overview.db.id }}</strong>
            </div>
          </div>
        </details>
      </div>
    </section>

    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">依赖与发布</h3>
        <span class="mk-card__meta">{{ coreDeps.length ? `${coreDeps.length} 项上游依赖` : '无依赖声明' }}</span>
      </div>
      <div class="sdp-eng__body">
        <!-- 依赖取 core YAML inputs 的 skill: / sandbox: 引用（原型 renderSkillDetail 2367-2371 的 chips） -->
        <div v-if="coreDeps.length" class="sdp-deps">
          <span v-for="d in coreDeps" :key="d" class="mk-badge mk-badge--muted mono" :title="d">{{ d }}</span>
        </div>
        <div v-else-if="coreDepsFailed" class="mk-alert mk-alert--row" role="alert">
          <span class="mk-alert__msg">核心文件读取失败，依赖清单不可得。</span>
        </div>
        <p v-else class="mk-empty--line" title="core YAML 未声明 inputs 的 skill: / sandbox: 引用">该 Skill 未声明输入依赖。</p>
        <!-- 四段发布流（草稿/评审/灰度/回滚）后端无阶段状态接口 → 只说明真实存在的两步 -->
        <p class="mk-card__note" title="草稿 / 评审 / 灰度 / 回滚状态暂未提供">发布链：保存并编译 → 发布（暂无草稿 / 评审 / 灰度阶段状态）。</p>
      </div>
    </section>

    <section v-if="overview.runtimeContract" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">运行时契约</h3>
        <span class="mk-card__meta mono">{{ overview.runtimeContractSource === 'manifest' ? 'prompts/manifests' : 'buildDefaultRuntimeContract' }}</span>
      </div>
      <div class="sdp-eng__body">
        <!-- 阶段集合 / 默认阶段 / 终止阶段 三行 2026-11-06 移进「协议」页签的「流程」卡：
             它们与 core 声明的状态机是同一件事的两个来源，摆在两页会互相打脸（协议说没声明、
             这里列着两个阶段）。本卡只留与流程无关的技术封套。 -->
        <div class="mk-facts mk-facts--rows">
          <div><span title="version">契约版本</span><strong class="mono">{{ overview.runtimeContract.version }}</strong></div>
          <div><span title="contextMode">上下文模式</span><strong class="mono">{{ overview.runtimeContract.contextMode }}</strong></div>
          <div v-if="overview.runtimeContract.businessState?.domain">
            <span title="domain">业务域</span>
            <strong class="mono">{{ overview.runtimeContract.businessState.domain }}</strong>
          </div>
          <div v-if="overview.runtimeContract.contextUpdate?.mode">
            <span title="contextUpdate.mode">上下文更新模式</span>
            <strong class="mono">{{ overview.runtimeContract.contextUpdate.mode }}</strong>
          </div>
          <div><span title="outputEnvelope">输出封装</span><strong class="mono">{{ overview.runtimeContract.outputEnvelope }}</strong></div>
        </div>
      </div>
    </section>

    <section class="mk-card">
      <div class="mk-card__head">
        <!-- 2026-11-11（困惑测试 #90）：本卡是 Goal→Path / Path→Learn 的跨服务调用协议，
             与「指令与字段」页签的「核心文件查看/编辑」重名不同物，改名避撞。 -->
        <h3 class="mk-card__title">上下游调用协议</h3>
        <span class="mk-card__meta">{{ protocols.length ? `${protocols.length} 组协议` : '' }}</span>
      </div>
      <div class="sdp-eng__body">
        <!-- #116 三态互斥：加载中 / 失败 / 空。此前 engLoaded 只是普通变量、无 loading ref，
             「暂无协议数据」在数据到达前就渲染，把「加载中」当「没有」呈现给用户 -->
        <MkLoading v-if="engLoading" inline text="协议数据加载中…" />
        <div v-else-if="protocols.length" class="sdp-protocols">
          <article v-for="p in protocols" :key="p.id" class="sdp-protocol">
            <header>
              <strong>{{ p.title }}</strong>
              <span class="mk-badge mk-badge--muted">{{ p.statusLabel }}</span>
            </header>
            <p>{{ p.summary }}</p>
            <span class="sdp-protocol__sites mono">{{ p.callSites }}</span>
          </article>
        </div>
        <div v-else-if="engProtoFailed" class="mk-alert mk-alert--row" role="alert">
          <span class="mk-alert__msg">协议数据加载失败。</span>
          <button type="button" class="mk-alert__btn" @click="retryEngineering">重试</button>
        </div>
        <p v-else class="mk-empty--line">暂无协议数据。</p>
      </div>
    </section>

    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">Skill 规则总览</h3>
        <!-- 口径拆开说（2026-10-31 四轮评审）：本块是 R-XX-NN 登记表（Agent 提示词规则注册表），
             与本 Skill core YAML 里的执行规则（协议页签那份）是两个来源；登记表为空时
             不再裸显「0 规则 · 0 前缀」跟协议页的 83 条规则打架 -->
        <span class="mk-card__meta" v-if="rulesOverview?.summary && (rulesOverview.summary.totalRules ?? 0) > 0">
          {{ rulesOverview.summary.totalRules ?? 0 }} 规则 · {{ rulesOverview.summary.totalPrefixes ?? 0 }} 前缀
          <template v-if="(rulesOverview.summary.conflictPrefixCount ?? 0) > 0">
            · <b class="sdp-warn">{{ rulesOverview.summary.conflictPrefixCount }} 冲突</b>
          </template>
        </span>
        <span v-else-if="!engLoading" class="mk-card__meta">R-XX-NN 登记表当前为空</span>
      </div>
      <div class="sdp-eng__body">
        <div v-if="rulesOverview?.conflictPrefixes?.length" class="sdp-conflict">
          <strong>prefix 冲突：</strong>
          <span v-for="c in rulesOverview.conflictPrefixes" :key="c.prefix">
            <code class="mono">{{ c.prefix }}</code> 同时被 <code class="mono">{{ c.agentIds.join(', ') }}</code> 使用
          </span>
        </div>
        <MkLoading v-if="engLoading" inline text="规则数据加载中…" />
        <div v-else-if="nodeRules.length" class="sdp-rules">
          <div v-for="r in nodeRules" :key="r.ruleId" class="sdp-rule">
            <span class="sdp-rule__id mono">{{ r.ruleId }}</span>
            <span class="sdp-rule__text">{{ r.text }}</span>
          </div>
        </div>
        <div v-else-if="engRulesFailed" class="mk-alert mk-alert--row" role="alert">
          <span class="mk-alert__msg">规则数据加载失败。</span>
          <button type="button" class="mk-alert__btn" @click="retryEngineering">重试</button>
        </div>
        <p v-else-if="coreRulesCount > 0" class="mk-empty--line">
          本节点没有登记 R-XX-NN 规则。执行规则 {{ coreRulesCount }} 条写在 core YAML 里。
        </p>
        <p v-else class="mk-empty--line">本节点没有登记规则。</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 工程 tab：基础信息 kv / 运行时契约 / 协议视图 / Skill 规则总览（4 个低频只读区块）
 */
import { computed, ref, watch } from 'vue'
import { adminPromptOpsApi, adminPromptWorkbenchApi } from '@/api/adminApi'
import { TERMS } from '../terms'
import { formatTime } from '../cockpitFormat'
import { shortHash } from './sdp-shared'
import MkLoading from '@/components/mk/MkLoading.vue'

const props = defineProps<{ skillId: string; overview: Overview }>()

interface Overview {
  kind: string
  agentId: string
  file?: { path?: string; hash?: string } | null
  db?: { id?: string; version?: number | string; hash?: string; useCount?: number; model?: string; publishedAt?: string } | null
  drift: 'in-sync' | 'file-vs-db-mismatch' | null
  runtimeContract?: {
    version?: string
    contextMode?: string
    businessState?: { domain?: string; phases?: string[]; defaultPhase?: string; terminalPhases?: string[] } | null
    contextUpdate?: { mode?: string } | null
    outputEnvelope?: string
  } | null
  runtimeContractSource?: 'manifest' | 'default' | null
}

interface Protocol { id: string; title: string; statusLabel: string; summary: string; callSites: string }
interface RuleItem { ruleId: string; text: string; agentId: string }
const protocols = ref<Protocol[]>([])
const rulesOverview = ref<{ summary: { totalRules: number; totalPrefixes: number; conflictPrefixCount: number }; conflictPrefixes: Array<{ prefix: string; agentIds: string[] }>; byPrefix: Record<string, RuleItem[]> } | null>(null)
let engLoaded = false
const engLoading = ref(false)
const engProtoFailed = ref(false)
const engRulesFailed = ref(false)

const nodeRules = computed(() => {
  if (!rulesOverview.value) return [] as RuleItem[]
  const full = `skill:${props.skillId}`
  const out: RuleItem[] = []
  for (const list of Object.values(rulesOverview.value.byPrefix || {})) {
    for (const r of list || []) {
      if (r.agentId === full || r.agentId === props.skillId) out.push(r)
    }
  }
  return out
})

/* ---------- 依赖与发布：core YAML inputs 的 skill: / sandbox: 引用即上游依赖边 ---------- */
const coreInputs = ref<Array<{ ref?: string }>>([])
/** 本 Skill core YAML 的执行规则条数（与 R-XX-NN 登记表分源说明用，2026-10-31 四轮评审） */
const coreRulesCount = ref(0)
const coreDepsFailed = ref(false)
/** #132 口径照样搬入：ref 取到空白为止（旧正则 `([^.\s]+)` 在首个「.」截断，
    sandbox:teaching.* 会被截成同一条后去重成一，依赖清单与真实数量双错） */
const coreDeps = computed<string[]>(() => {
  const out: string[] = []
  for (const i of coreInputs.value) {
    const m = /^(skill|sandbox):(\S+)/.exec(String(i?.ref || '').trim())
    if (!m) continue
    const label = `${m[1]}:${m[2]}`
    if (!out.includes(label)) out.push(label)
  }
  return out
})

async function loadEngineering() {
  if (engLoaded) return
  engLoaded = true
  engLoading.value = true
  let pvOk = true
  let roOk = true
  let coreOk = true
  try {
    const [pv, ro, core] = await Promise.all([
      adminPromptOpsApi.getProtocolView().catch(() => { pvOk = false; return null }),
      adminPromptOpsApi.getSkillRulesOverview().catch(() => { roOk = false; return null }),
      adminPromptWorkbenchApi.getCore(props.skillId).catch(() => { coreOk = false; return null })
    ])
    engProtoFailed.value = !pvOk
    engRulesFailed.value = !roOk
    coreDepsFailed.value = !coreOk
    const coreBody = (core?.data?.core || null) as { inputs?: Array<{ ref?: string }>; rules?: unknown[] } | null
    coreInputs.value = Array.isArray(coreBody?.inputs) ? coreBody.inputs : []
    coreRulesCount.value = Array.isArray(coreBody?.rules) ? coreBody.rules.length : 0
    const pBody = pv?.data?.data ?? pv?.data ?? {}
    protocols.value = ((pBody.protocols as Record<string, unknown>[]) || []).map((p) => ({
      id: String(p.id || ''),
      title: String(p.title || p.id || ''),
      statusLabel: String(p.statusLabel || p.status || ''),
      summary: String(p.summary || ''),
      callSites: String(p.callSites || '')
    }))
    rulesOverview.value = (ro?.data?.data ?? ro?.data ?? null) as typeof rulesOverview.value
  } finally {
    engLoading.value = false
  }
}

function retryEngineering() {
  engLoaded = false
  void loadEngineering()
}

/* 切换 skill：清缓存重拉 */
watch(
  () => props.skillId,
  () => {
    engLoaded = false
    protocols.value = []
    rulesOverview.value = null
    coreInputs.value = []
    coreRulesCount.value = 0
    coreDepsFailed.value = false
    void loadEngineering()
  },
  { immediate: true }
)

/** 漂移状态值人话（in-sync / file-vs-db-mismatch → 中文） */
function driftLabel(value: string) {
  return value === 'in-sync' ? TERMS.driftInSync : TERMS.driftValueMismatch
}
/** 绝对时间统一走 cockpitFormat.formatTime（YYYY-MM-DD HH:mm 单源）。
 *  原先 toLocaleString('zh-CN') 渲染成 2026/11/10 21:10:23，与列表/详情其它时间两套写法。 */
const fmtTime = (v: string) => (v ? formatTime(v) || '—' : '—')
</script>

<style scoped>
.sdp-pane { display: grid; gap: 14px; align-content: start; }
.sdp-ok { color: var(--mk-green); }
.sdp-warn { color: var(--mk-amber); }
/* 卡身：与协议页签、运行时页签同一档内边距 */
.sdp-eng__body { display: grid; gap: 10px; align-content: start; padding: 12px 16px; }
/* 开发者底层工程元数据抽屉（2026-11-08）：默认收起，展开后与原 kv 表同形 */
.sdp-adv { border-top: 1px solid var(--mk-line); padding-top: 8px; }
.sdp-adv__sum {
  cursor: pointer;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  list-style: none;
  user-select: none;
}
.sdp-adv__sum::-webkit-details-marker { display: none; }
.sdp-adv__sum::before { content: '▸ '; }
.sdp-adv[open] > .sdp-adv__sum::before { content: '▾ '; }
.sdp-adv__sum:hover { color: var(--mk-ink); }
.sdp-adv__body { margin-top: 8px; }
.sdp-protocols { display: grid; gap: 8px; }
.sdp-deps { display: flex; flex-wrap: wrap; gap: 6px; }
.sdp-protocol {
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  padding: 10px 12px;
  display: grid;
  gap: 4px;
  background: var(--mk-surface-2);
}
.sdp-protocol header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sdp-protocol strong { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); }
.sdp-protocol p { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
.sdp-protocol__sites { font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow-wrap: break-word; word-break: normal; }
.sdp-conflict {
  display: grid;
  gap: 4px;
  padding: 9px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: var(--mk-fs-micro);
}
.sdp-rules { display: grid; gap: 6px; }
.sdp-rule {
  display: grid;
  gap: 3px;
  padding: 7px 10px 7px 12px;
  border-left: 2px solid rgba(141, 107, 255, 0.45);
  background: var(--mk-surface-2);
  border-radius: 0 var(--mk-radius-sm) var(--mk-radius-sm) 0;
  font-size: var(--mk-fs-micro);
}
.sdp-rule__id { color: var(--wf-color-accent); font-size: var(--mk-fs-micro); font-weight: 700; }
.sdp-rule__text { color: var(--mk-ink); line-height: 1.55; }

/* 4K：字号跟随壳层放大（键值走 .mk-facts，档位由原语自带） */
@media (min-width: 3600px) {
  .sdp-protocol { padding: 14px 16px; }
  .sdp-protocol strong { font-size: var(--mk-fs-emphasis); }
  .sdp-protocol p { font-size: var(--mk-fs-body); }
  .sdp-protocol__sites { font-size: var(--mk-fs-body); }
  .sdp-conflict { font-size: var(--mk-fs-body); padding: 13px 16px; }
  .sdp-rule { font-size: var(--mk-fs-body); padding: 10px 12px 10px 16px; }
  .sdp-rule__id { font-size: var(--mk-fs-body); }
}

/* 暗色：色值全走 token 后只剩协议卡的两处紫调 */
[data-theme='dark'] .sdp-rule { background: rgba(141, 107, 255, 0.08); }

</style>
