<template>
  <div v-if="data" class="mk-page">
    <!-- 页头（原型 pageTitle）：面包屑管「我在哪」，页头管「这页是什么 + 主操作」 -->
    <MkPageHead title="平台总览" :sub="headSub">
      <template #actions>
        <!-- 刷新状态独立于副文：副文只放事实段（运行全景/数据截至/最近活动），
             避免长句在页头副文盒内断词换行（视觉走查 2026-10-03）。
             本页 10s 轮询，手动「刷新」钮与之重复（对齐执行日志/健康中心先例：轮询页不放刷新钮）。
             正常态不显示任何刷新注记（2026-10-22 用户「这个提示不要」）；只有展示旧数据或
             熔断停止时才出现（后者本身变可点恢复钮，一键恢复不丢）。 -->
        <button
          v-if="autoRefreshStopped"
          type="button"
          class="ov-refresh-note ov-refresh-note--warn ov-refresh-note--action"
          :disabled="liveRefreshing"
          @click="refreshNow"
        >{{ liveRefreshing ? '恢复中…' : '自动刷新已停止 · 恢复刷新' }}</button>
        <span
          v-else-if="overviewStale"
          class="ov-refresh-note ov-refresh-note--warn"
          role="status"
        >展示上次成功数据</span>
      </template>
    </MkPageHead>

    <!-- KPI：统一走共享 MkKpi（clickable 渲染真 <button>，Enter/Space/焦点环天然可用）+ .mk-kpi-grid。
         卡面副行 = 口径短语（live.ts kpis.hint：范围 / 分母 / 筛选），数值类（趋势、分解、对照、
         总用户数、活跃 Skill 数）一律随长释进 tooltip——2026-10-19 用户走查「hint 在报读数」，
         卡面不再同屏出现两个不同量纲的数（趋势口径 = 昨日同时刻窗口，后端 overview/stats 基线字段）。 -->
    <div class="mk-kpi-grid">
      <MkKpi
        v-for="(k, i) in kpiCards"
        :key="k.label"
        clickable
        :label="k.label"
        :value="k.value"
        :hint="k.hint"
        :title="kpiTitle(k)"
        @click="jump(kpiTargets[i].scene, kpiTargets[i].tab)"
      />
      <!-- 完课量（#105 读侧接入，2026-10-19）：收束事件统一观测的按轨拆分，
           点卡进教学会话页看逐条轨道/通道。与上方四卡不同源（含虚拟/测试）。
           2026-10-21 用户「五个就一个有，也不要了，直接把这个做到上面」：五卡里只有本卡
           带副行，整排被抬高一档——分解移到数值行内（valueNote），副行只留给取数三态。 -->
      <MkKpi
        clickable
        :label="closureKpi.label"
        :value="closureKpi.value"
        :value-note="closureKpi.note"
        :hint="closureKpi.hint"
        :hint-tone="closureKpi.hintTone"
        :title="closureKpi.title"
        @click="jump('teaching-sessions')"
      />
    </div>

    <!-- 系统状态（原型 .statusbar）：点色=结论、粗体=标题、meta=子项、右端=动作。
          密度优化（2026-10-03）：原来「结论 + 异常项（长句） + 健康/仿真/总结 + 动作」全挤一条，
          且 .mk-status__meta-link 的负外边距把 gap 吃光 → 读成一堵字墙。
          按「结论 / 明细」两层重组：
            行 1 = 结论（点 + 粗体标题）+ 右端动作出口；
            行 2 = 全部明细项（关注项 + 子系统状态），各带 22px 真实间隙、从属层。
          关注项文案较长（agentId + 采样窗口口径），与结论同行必然折行，故移入明细行。
          用显式列布局（--stack）而非 flex-basis:100% 换行：后者在 grid 行固有高度里
          百分比 basis 对不确定宽度解析失败，行高按单行 48px 定死、第二行溢出被裁
          （2026-10-03 实测 gridTemplateRows 该行 48px / scrollHeight 87px）。
          块序对齐原型 1353-1398：pagehead → KPI 栅格 → statusbar → 教学闭环卡。 -->
    <div class="mk-status ov-status--stack" :class="`mk-status--${data.tone}`">
      <div class="ov-row">
        <span class="mk-status__dot"></span>
        <span class="mk-status__title">{{ health.headline }}</span>
        <!-- 结论行的 __sep 已撤（明细项搬到第二行后，分隔线右侧无内容可分隔——
             裸评审 2026-10-03 实测为悬空 1×13px 竖线残留） -->
        <!-- subline（今日调用/失败）与 KPI 前两卡完全重复，不进状态条——
             1280 实测它会把结论行动作挤换行（2026-10-01 视觉回顾） -->
        <div class="mk-status__actions">
          <button
            type="button"
            class="mk-status__action"
            :title="statusAction.title"
            @click="statusAction.run()"
          >{{ statusAction.label }}</button>
        </div>
      </div>
      <!-- 明细行 = 通道状态（调用/健康/仿真），不带动作项——去冗余（2026-10-03 用户反馈
           「同一批异常出现 3 次」）：agent 失败/总结事项是「要做的事」，全数归底部待处理卡
           （那有按钮），事件流保有原始逐条；横幅只回答「各通道现在什么状态」。
           2026-10-22 用户：标题只写「需要关注」，今日失败数下移到这里，与「健康 · 1 项异常」同级。 -->
      <div class="ov-row ov-subs">
        <button
          v-if="todayFailed > 0"
          type="button"
          class="mk-status__meta-link"
          :class="health.tone === 'bad' ? 'mk-status__meta--bad' : 'mk-status__meta--warn'"
          @click="investigateTodayFailures"
        >调用 · 今日失败 {{ todayFailed }} 次</button>
        <button
          type="button"
          class="mk-status__meta-link"
          :class="healthTone === 'bad' ? 'mk-status__meta--bad' : healthTone === 'warn' ? 'mk-status__meta--warn' : healthTone === 'ok' ? 'mk-status__meta--ok' : ''"
          :title="healthTitle"
          @click="healthChipClick"
        >健康 · {{ healthText }}</button>
        <button
          type="button"
          class="mk-status__meta-link"
          :class="simTone === 'bad' ? 'mk-status__meta--bad' : simTone === 'warn' ? 'mk-status__meta--warn' : simTone === 'ok' ? 'mk-status__meta--ok' : ''"
          :title="simTitle"
          @click="jump('virtual-learners')"
        >仿真 · {{ simHeadline }}</button>
      </div>
    </div>

    <!-- 教学闭环（原型 .loop 招牌块）：五环各一卡，读数全真实。
         口径：对话/路径/评估来自 overview/stats（随 10s 轮询）；
         教学回合=会话累计、记忆复习=到期待办（进页拉一次）。 -->
    <div class="mk-card">
      <div class="mk-card__head">
        <span class="mk-card__title">教学闭环</span>
        <!-- 原型副文「目标对话 → … → 记忆复习」撤（2026-10-03 用户反馈文案重复）：
             五张阶段卡本身就是这条链，副文是逐字预告 -->

      </div>
      <div class="ov-card__body">
        <div class="loop">
          <template v-for="(s, i) in loopStages" :key="s.name">
            <span v-if="i" class="loop__arrow" aria-hidden="true"></span>
            <div
              class="loop__step"
              :class="`loop__step--${s.tone}`"
              role="button"
              tabindex="0"
              :title="s.title"
              @click="jump(s.scene)"
              @keydown.enter.self.prevent="jump(s.scene)"
              @keydown.space.self.prevent="jump(s.scene)"
            >
              <span class="loop__no">阶段 {{ i + 1 }}</span>
              <span class="loop__name">{{ s.name }}</span>
              <span class="loop__meta">{{ s.meta }}</span>
              <!-- 错误内联（2026-10-03 反馈「失败标记与责任阶段割裂」）：失败数贴在
                   责任阶段的指标行，amber 底色由此自证；点击即筛失败路径 -->
              <span class="loop__valrow">
                <span class="loop__val">{{ s.val }}</span>
                <button
                  v-if="s.ringFailed"
                  type="button"
                  class="mk-badge mk-badge--sm mk-badge--warn loop__fail"
                  @click.stop="retryLoopExtras"
                >重试</button>
                <button
                  v-if="s.failN"
                  type="button"
                  class="mk-badge mk-badge--sm mk-badge--bad loop__fail"
                  title="生成失败的路径数"
                  @click.stop="jumpToFailedPaths"
                >失败 {{ s.failN }}</button>
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 动作队列带（原 Row B，2026-10-03 上移进首屏）：待处理事项是全页唯一
         要求操作的板块，不能落在折叠线下；Top 5 与虚拟学习者看板作参考位同行 -->
    <div class="row3">
      <div class="mk-card">
        <div class="mk-card__head">
          <span class="mk-card__title">Skill 调用量 Top 5</span>
          <!-- 2026-10-21 用户「除了 kpi 面板，其他地方也有这种文案」：卡头 meta 只留时间窗，
               账号口径（仅真实账号 / 含管理员发起的仿真任务）进 title -->
          <span class="mk-card__meta" title="仅真实账号（含管理员发起的仿真任务）">近 7 天</span>
        </div>
        <div class="ov-card__body">
          <div class="ranklist">
            <!-- 列头（评审 2026-10-10）：调用/失败拆成右对齐两列后补表头，
                 用户不用再靠 meta 文案猜「4497 · 683」哪段是哪口径 -->
            <div v-if="data.topSkills.length" class="rankrow rankrow--head" aria-hidden="true">
              <span class="rankrow__idx"></span>
              <span class="rankrow__grow">Skill</span>
              <span class="rankrow__bar"></span>
              <span class="rankrow__val rankrow__calls rankrow__val--col">调用</span>
              <span class="rankrow__val rankrow__col-failed">失败</span>
            </div>
            <div
              v-for="(s, i) in data.topSkills"
              :key="s.agentId"
              class="rankrow rankrow--link"
              role="button"
              tabindex="0"
              @click="openSubPage('skill', skillIdOf(s.agentId))"
              @keydown.enter.self.prevent="openSubPage('skill', skillIdOf(s.agentId))"
              @keydown.space.self.prevent="openSubPage('skill', skillIdOf(s.agentId))"
            >
              <span class="rankrow__idx">{{ i + 1 }}</span>
              <span class="rankrow__grow" :title="skillIdOf(s.agentId)">{{ skillDisplayName(s.agentId) }}</span>
              <!-- 占比条（mk-minibar 共享原语）：名次数字只给序，条给「梯队差距」一眼可读；
                   无金银铜——排序徽章是装饰不编码信息 -->
              <span class="mk-minibar rankrow__bar" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: topBarPct(Number(s.calls)) }"></i></span>
              <!-- 调用/失败拆两列右对齐（评审 2026-10-10）：原先「4497 · 683」挤一格，
                   无列对齐也无表头，分不清哪段是失败数；零失败给「–」保列形 -->
              <span class="rankrow__val mono rankrow__calls">{{ s.calls }}</span>
              <span class="rankrow__val mono rankrow__failed" :class="{ 'rankrow__failed--zero': !s.failed }">{{ s.failed || '–' }}</span>
            </div>
          </div>
          <p v-if="!data.topSkills.length" class="note">近 7 天暂无调用，无排行。</p>
        </div>
      </div>

      <div class="mk-card ov-card--todo">
        <div class="mk-card__head">
          <span class="mk-card__title">待处理事项</span>
          <!-- 口径副文（#4）：动作来自 200 条日志采样窗口的 Top 失败，与状态条的「今日失败」不同源；
               只写在 title，不占可见行。卡头不挂条数徽章（2026-10-22 用户「右上角的 4 不要」）。 -->
          <span class="mk-card__meta">近 7 天</span>
        </div>
        <div class="ov-card__body">
          <div class="ranklist">
            <div v-for="t in todoItems" :key="t.key" class="rankrow rankrow--todo">
              <!-- 只留主句：口径副行（健康中心 · 全量检查清单 / 按最近 200 条调用统计）
                   2026-10-22 用户「不要这种」已删，完整口径仍在 title -->
              <div class="todo-main">
                <span class="todo-text" :title="t.text">{{ t.main }}</span>
              </div>
              <!-- 动作默认文字链态（评审 2026-10-10）：整排同款胶囊按钮是视觉噪声，
                   降为蓝字轻链、悬浮再起底色 -->
              <button type="button" class="todo-act" @click="t.action()">{{ t.actLabel }} →</button>
            </div>
          </div>
          <p v-if="!todoItems.length" class="note">没有待处理的事项。</p>
        </div>
      </div>

      <!-- 第三卡：虚拟学习者看板（2026-10-19 用户「这块区域 4K 下看着也很空，可以做三个看板，
           我倾向于做一个虚拟学习者的在这里」）。
           原型 row3 第三卡「学习状态分布」当年因后端无聚合数据不落；虚拟学习者现在有全量统计
           （列表接口的 sessionStats/并发配额 + 运行统计接口），且本页 boot 域已含 virtuals，
           不新增任何接口。读数只放「平台整体」视角的六格，逐人明细留在虚拟学习者页。
           三态与全站同律（虚拟学习者页同一套）：加载中「…」、失败「不可用」+ 重试，
           绝不把「没拉到」渲染成真实 0。 -->
      <div class="mk-card ov-card--vl">
        <div class="mk-card__head">
          <span class="mk-card__title">虚拟学习者</span>
          <span class="mk-card__head-right">
            <button type="button" class="mk-btn mk-btn--sm" @click="jump('virtual-learners')">进入 →</button>
          </span>
        </div>
        <div class="ov-card__body">
          <MkStatStrip class="ov-vl__strip" layout="grid" :items="vlTiles" aria-label="虚拟学习者读数" />
          <p v-if="vlBoardState === 'error'" class="ov-vl__state ov-vl__state--bad" role="alert">
            <span>虚拟学习者统计不可用</span>
            <button type="button" class="mk-link" @click="retryVlBoard">重试</button>
          </p>
          <MkLoading v-else-if="vlBoardState === 'loading'" inline text="统计加载中…" />
        </div>
      </div>
    </div>
    <!-- 趋势带（原 Row A，2026-10-03 下移）：图表/事件流是二阶信息，退居动作队列之后；
         构图叙事 = 出什么事(状态条) → 哪个阶段(闭环) → 要做什么(动作带) → 趋势如何 -->
    <div class="row2">
      <div class="mk-card ov-card--chart">
        <div class="mk-card__head">
          <span class="mk-card__title">近 7 天活跃学习者</span>
          <span class="mk-card__meta">单位：人</span>
          <span class="mk-card__head-right">
            <button type="button" class="mk-btn mk-btn--sm" @click="jump('people')">用户与学习者 →</button>
          </span>
        </div>
        <div class="ov-card__body">
          <!-- P1#2：手写 .barchart 无「今日进行中」语义（清晨当日累计尚小 → 柱高塌陷读成活跃崩塌），
               换全站统一 OvBars：零值「·」+ 今日列高亮内建；今日列 title 补「截至现在」防误读。
               审核 #1（2026-10-06）：本卡补空态——四张列表/图表卡中唯一没有空态文案，
               growth7d 为空时整块留白会被读成渲染坏了。 -->
          <OvBars v-if="barchartCols.length" :cols="barchartCols" :bar-width="40" :min-bars-height="120" />
          <p v-else class="note">近 7 天暂无活跃数据。</p>
        </div>
      </div>
      <div class="mk-card ov-card--feed">
        <div class="mk-card__head">
          <span class="mk-card__title">最近事件</span>
          <span class="mk-card__meta">近 24h</span>
        </div>
        <div class="ov-card__body">
          <div
            ref="feedRef"
            class="feed feed--capped"
            :class="{ 'feed--capped--overflow': feedOverflow }"
          >
            <div
              v-for="(f, i) in feedRows"
              :key="`f${i}`"
              class="feedrow"
              :class="{ 'feedrow--bad': f.tone === 'bad', 'feedrow--link': f.tone === 'bad' || f.tone === 'warn' }"
              :title="feedTitle(f)"
              :role="(f.tone === 'bad' || f.tone === 'warn') ? 'button' : undefined"
              :tabindex="(f.tone === 'bad' || f.tone === 'warn') ? 0 : undefined"
              @click="feedJump(f)"
              @keydown.enter.self.prevent="feedJump(f)"
              @keydown.space.self.prevent="feedJump(f)"
            >
              <span class="feedrow__time">{{ f.time }}</span>
              <div class="feedrow__grow">
                <span class="t">{{ f.text }}</span>
                <span class="d">{{ f.desc }}</span>
              </div>
            </div>
          </div>
          <p v-if="!feedRows.length && data.feed.length" class="note">近期动态均来自测试 / 模拟账号，已按当前视角隐藏。</p>
          <p v-else-if="!feedRows.length" class="note">近 24h 暂无动态。</p>
        </div>
      </div>
    </div>


  </div>
  <MkLoading v-else-if="liveLoading" min text="正在加载真实数据…" />
  <!-- 加载失败是错误事实，不是中性空态（审核 #4，2026-10-06）：走原语 tone="error"
       （红系图标 + role=alert），与同页另三态（加载/空/有数据）纪律一致 -->
  <MkEmptyState
    v-else
    min
    tone="error"
    title="真实数据暂不可用，请刷新或稍后重试。"
    description="无法加载总览数据，可能是服务未启动或网络不可达。"
    action-text="重试"
    @action="retryOverview"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
import { overviewHealth, investigateAgent, investigateTodayFailures, statusActionOf, intent, dataSource, openSubPage } from './store';
import {
  liveOverviewFull, overviewHideTest, refreshLiveOverview, liveLoading, liveRefreshing,
  liveVirtualRunStats, liveVirtualStatsError, liveVirtualStatsLoaded, liveVirtualStatsLoading,
  liveVirtualSessionStats, liveAutopilotConcurrency, liveFailures,
  retryLiveVirtualStats, loadLiveData,
  liveIncludeVirtual, skillDisplayName,
  recentActivityText, type LiveOverviewFull
} from './live';
import OvBars from './OvBars.vue';
import { closureTrackText } from './statusText';
import { adminDashboardApi, adminHealthCenterApi, adminMemoryReviewApi, adminTeachingSessionsApi } from '@/api/adminApi';
import MkPageHead from '@/components/mk/MkPageHead.vue';
import MkKpi from '@/components/mk/MkKpi.vue';
import MkStatStrip from '@/components/mk/MkStatStrip.vue';
import type { MkStatItem } from '@/components/mk/MkStatStrip.vue';
import MkEmptyState from '@/components/mk/MkEmptyState.vue';
import MkLoading from '@/components/mk/MkLoading.vue';
import { useSafePolling } from '@/composables/useSafePolling';
import { failureRateTone } from './rate-utils'

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

// 简报数据即 live.ts 的总览全量类型（单一事实源）
type BriefData = LiveOverviewFull;

const health = computed(() => overviewHealth.value);

// 健康结论与行动项同源：health 提示异常时即使静态 actions 为空也要给出排查入口
// （2026-10-06 审核 #5）：原只认 warn，tone='bad'（成功率<80 且失败≥3）时红结论与
// 「没有待处理的事项」同屏。放宽为 warn/bad——muted（空闲/未就绪）不伪造失败结论。
const effectiveActions = computed(() => {
  if (!data.value) return [];
  if (data.value.actions.length) return data.value.actions;
  const tone = health.value.tone;
  if (tone === 'warn' || tone === 'bad') {
    // 兜底动作不伪造 agentId：空串让 investigateAgent 只带失败状态筛选
    return [{ text: '教学流程出现失败，检查模型服务与限流配置', tone: 'bad' as Tone, agentId: '', link: '' }];
  }
  return [];
});

const data = computed<BriefData | null>(() => liveOverviewFull.value);

/* ===== 教学闭环条（原型 .loop）=====
   五环规模：对话/路径/评估在 overview/stats 里（随轮询刷新）；
   教学回合（会话累计）与记忆复习（到期待办）进页拉一次——低频口径不进轮询。 */
const teachTotal = ref<number | null>(null);
const memDue = ref<number | null>(null);
/** 进页两环读数三态（走查 F1-3）：6-10s 的慢请求此前与「无数据」共用「—」，
 *  失败还静默吞掉。加载中/失败必须有可区分的呈现，失败给可重试的失败态。 */
type LoopExtraState = 'loading' | 'ready' | 'failed';
const teachState = ref<LoopExtraState>('loading');
const memState = ref<LoopExtraState>('loading');
/** P2 异常→动作闭环：五环各接深链（跳目标页 scene），点击行为与 title 同步披露 */
interface LoopStage { name: string; meta: string; val: string; tone: 'active' | 'done' | 'alert'; title?: string; scene: string; failN?: number; ringFailed?: boolean }
const loopStages = computed<LoopStage[]>(() => {
  const d = data.value;
  const evalOk = (d?.wrapup.evaluationModel ?? 0) + (d?.wrapup.evaluationAiFallback ?? 0);
  const pathsFailed = d?.loop.pathsFailed ?? 0;
  return [
    {
      name: '目标对话', meta: '澄清真实目标与约束',
      val: `${d?.loop.conversationsActive ?? 0} 进行中`, tone: 'active',
      title: '进行中的目标对话数',
      scene: 'goal-conversations',
    },
    {
      // P2：失败环不再恒 done——有失败路径时转 alert（着色条件与计数随 title 披露）
      name: '路径规划', meta: '生成阶段化学习路径',
      val: `${d?.loop.pathsActive ?? 0} 进行中`, tone: pathsFailed > 0 ? 'alert' : 'done',
      failN: pathsFailed > 0 ? pathsFailed : undefined,
      scene: 'learning-paths',
    },
    {
      name: '教学回合', meta: '回合式讲解与追问',
      val: teachState.value === 'loading'
        ? '加载中…'
        : teachState.value === 'failed'
          ? '读数获取失败'
          : `${(teachTotal.value ?? 0).toLocaleString()} 累计`,
      tone: teachState.value === 'failed' ? 'alert' : 'done',
      ringFailed: teachState.value === 'failed',
      title: teachState.value === 'failed'
        ? '教学会话累计数获取失败'
        : '教学会话累计数',
      scene: 'teaching-sessions',
    },
    {
      // 口径（#3）：evalOk 是「最近 sampleSize 条 wrapup 日志」里的成功条数（结构上 ≤ sampleSize），
      // 与另外四环的全量口径不同源——数值必须带分母，否则与「320 待办 / 208 累计」并排会被读成漏斗塌陷
      name: '课后评估', meta: '产出与掌握度评估',
      val: `${evalOk}/${d?.wrapup.sampleSize ?? 0} 次完成`, tone: 'done',
      title: `最近 ${d?.wrapup.sampleSize ?? 0} 次课后总结中 ${evalOk} 次评估完成 · 失败 ${d?.wrapup.evaluationFailed ?? 0}`,
      scene: 'teaching-sessions',
    },
    {
      name: '记忆复习', meta: '按遗忘曲线安排复习',
      val: memState.value === 'loading'
        ? '加载中…'
        : memState.value === 'failed'
          ? '读数获取失败'
          : `${memDue.value ?? 0} 待办`,
      tone: memState.value === 'failed' || (memDue.value ?? 0) > 0 ? 'alert' : 'done',
      ringFailed: memState.value === 'failed',
      title: memState.value === 'failed'
        ? '到期待办数获取失败 · 点「重试」重新获取'
        : '到期未复习的记忆条数',
      scene: 'memory-review',
    },
  ];
});
/* P2 异常→动作闭环：路径失败 pill → 学习路径列表并落「失败」筛选（OpsContent 消费 intent.statusFilter） */
function jumpToFailedPaths() {
  intent.agentFilter = '';
  intent.traceId = '';
  intent.sessionId = '';
  intent.errorCategory = '';
  intent.timeRange = '';
  intent.tab = '';
  intent.statusFilter = 'failed';
  intent.scene = 'learning-paths';
}
async function loadLoopExtras() {
  teachState.value = 'loading';
  memState.value = 'loading';
  try {
    // 口径随全站「含测试」开关（D12）：此前写死仅真实口径拉取，开关开着时同指标相差约 35 倍
    // 口径随全站「真实/测试」视角联动（D12 判例）：测试视角下到期待办只数虚拟/测试账号
    const r = await adminMemoryReviewApi.overview({ limit: 1, includeVirtual: liveIncludeVirtual.value, testOnly: liveIncludeVirtual.value || undefined });
    memDue.value = Number(r.data?.data?.totals?.due ?? 0);
    memState.value = 'ready';
  } catch { memState.value = 'failed'; /* 不阻塞页面：环上呈现可重试的失败态 */ }
  try {
    const r = await adminTeachingSessionsApi.list({ limit: 1, includeTest: liveIncludeVirtual.value });
    teachTotal.value = Number(r.data?.data?.total ?? 0);
    teachState.value = 'ready';
  } catch { teachState.value = 'failed'; /* 同上 */ }
}
/** 失败环手动重试（走查 F1-3）：失败不再只能靠切口径或刷整页恢复 */
function retryLoopExtras() { void loadLoopExtras(); }
/* 口径切换（全站「含测试」开关）后重拉闭环条两个进页口径，避免与已切口径的其他页同指标不同源 */
watch(liveIncludeVirtual, () => { void loadLoopExtras() });

/* 页头副文（原型 pageTitle p）：数据截至 + 刷新语义（P2 文案纠偏）。
   - 「数据截至」只绑定真实拉到数据的时刻（不再拿挂载时刻冒充；未拉到前不渲染该段）；
   - 失败指数退避至 60s，连续失败熔断后停止——页头注记变为「点击恢复」钮（手动刷新不再单设按钮）；
   - recency：由 live.ts 已映射的 24h 逐小时脉搏推「最近真实活动 HH:00（约 N 小时前）」。 */
const headSub = computed(() => {
  const parts: string[] = [];
  if (lastUpdated.value) parts.push(`数据截至 ${lastUpdated.value}`);
  const recency = recentActivityText(data.value?.pulse || []);
  if (recency) parts.push(recency);
  return parts.join(' · ');
});

/* 恢复刷新（熔断注记点击）：成功即打点真实数据时刻并重启轮询 */
function refreshNow() {
  void refreshOverviewTracked(true).then((ok) => {
    if (!ok) return;
    lastUpdated.value = nowHm();
    if (autoRefreshStopped.value) {
      autoRefreshStopped.value = false;
      // stop+start（useSafePolling.reset 在 isActive 时不重排定时器，需显式重启）
      stopAutoRefresh();
      startAutoRefresh();
    }
  });
}

/* ===== KPI（原型 .kpi）=====
   ▲▼趋势已恢复（2026-10-01）：基线改「昨日同时刻」等长窗口（后端 todayCallsBaseline/
   activeTodayBaseline），不再与昨日全日直接比——旧趋势 foot 因「今日进行中 vs 昨日全日」
   失真下线（凌晨 ▼-97% 实证），等的就是这个口径。口径注释（全量含虚拟/测试、总用户）
   退到悬停 tooltip（hint），foot 只留 超时/失败/新增 与基线说明。 */
interface KpiCard { label: string; value: string; foot: string; hint: string; note?: string; trend?: { pct: string; up: boolean } }
const kpiCards = computed<KpiCard[]>(() =>
  (data.value?.kpis ?? []).map((k) => ({ label: k.label, value: k.value, foot: k.foot, hint: k.hint, note: k.note, trend: k.trend }))
);

/* ===== 完课量（#105 读侧接入，2026-10-19）=====
   「管理端同屏不同源」的读侧收口：真实侧与虚拟侧不再各算各的——统一数收束事件
   （learner_evidence 已投影的 task:completed 行，口径单点 closure-observability.ts）。
   家法同上方四卡：hint 一行可见口径（真实 / 虚拟 / 未标记分解），长释进 title 悬停。
   与上方四卡不同源：本卡含虚拟学习者与测试账号（拆分自证），不并入真实口径读数；
   历史无 track 行如实显示「未标记」，不回填、不猜；读数以已投影事件为准（消费滞后时偏小）。 */
type ClosureSummary = {
  total: number
  byTrack: Record<string, number>
  bySource: Record<string, number>
  pathCompletions: number
}
const closureState = ref<'loading' | 'ready' | 'error'>('loading')
const closureSummary = ref<ClosureSummary | null>(null)
async function loadClosure() {
  try {
    const res = await adminDashboardApi.getClosureSummary()
    const body = (res.data?.data ?? res.data ?? {}) as Partial<ClosureSummary>
    closureSummary.value = {
      total: Number(body.total ?? 0),
      byTrack: (body.byTrack || {}) as Record<string, number>,
      bySource: (body.bySource || {}) as Record<string, number>,
      pathCompletions: Number(body.pathCompletions ?? 0),
    }
    closureState.value = 'ready'
  } catch {
    closureState.value = 'error' // 不伪造 0：次态由卡片 hint 如实呈报
  }
}
/** 通道/轨道文案单源在 statusText.ts（与教学会话页「轨道」列共用，两页不各译一份） */
const closureKpi = computed(() => {
  if (closureState.value !== 'ready' || !closureSummary.value) {
    return {
      label: '完课量',
      value: '—',
      note: '',
      hint: closureState.value === 'error' ? '读数加载失败' : '读数加载中…',
      hintTone: (closureState.value === 'error' ? 'warn' : '') as '' | 'warn',
      title: '完课量：收束事件的统一观测（#105）——任务完成按真实 / 虚拟学习者拆分',
    }
  }
  const s = closureSummary.value
  const human = s.byTrack.human ?? 0
  const virtual = s.byTrack['virtual-learner'] ?? 0
  const unmarked = (s.byTrack.legacy ?? 0) + (s.byTrack.unknown ?? 0)
  const unmarkedLabel = closureTrackText('legacy')
  const hintParts = [`真实 ${human}`, `虚拟 ${virtual}`]
  if (unmarked > 0) hintParts.push(`${unmarkedLabel} ${unmarked}`)
  const titleParts = [
    '本卡含虚拟学习者与测试账号，与上方真实口径 KPI 不同源。',
  ].filter(Boolean)
  return {
    label: '完课量',
    value: `${s.total}`,
    /* 分解挂在数值行内，不再单独占一行（2026-10-21） */
    note: hintParts.join(' · '),
    hint: '',
    hintTone: '' as const,
    title: titleParts.join(''),
  }
});

/* ===== 近 7 天活跃学习者（OvBars 全站统一柱图语言，2026-10-02 P1#2）=====
   原手写 .barchart 无「今日进行中」语义：清晨当日累计尚小时柱高塌陷，读成「活跃崩塌」。
   OvBars 内建零值「·」与今日列高亮；今日列 label 改「今日」、title 补「截至现在（非全日）」。
   柱顶数值 = 活跃人数（主序列），新增人数保留在 title（口径与原手写版一致）。 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const todayKey = computed(() => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
});
const activeMax = computed(() => Math.max(1, ...(data.value?.growth7d.map((g) => g.activeUsers) || [])));
/** 与 TokenCost.trendCols 同规则：零值不画残影柱（0%），微值保底 6% 可见 */
const barPct = (v: number, max: number) => (v > 0 ? `${Math.max(Math.round((v / max) * 100), 6)}%` : '0%');
const barchartCols = computed(() => (data.value?.growth7d || []).map((g) => {
  const d = new Date(`${g.date}T00:00:00`);
  const active = g.activeUsers || 0;
  const isToday = g.date === todayKey.value;
  const cap = Number.isNaN(d.getTime()) ? g.date.slice(5) : WEEKDAYS[d.getDay()];
  return {
    key: g.date,
    label: isToday ? '今日' : cap,
    today: isToday,
    num: String(active),
    title: `${g.date}：活跃 ${active} 人 · 新增 ${g.newUsers}${isToday ? ' · 今日数据截至现在（非全日）' : ''}`,
    bars: [{ pct: barPct(active, activeMax.value), tone: 'blue' as const }],
  };
}));

/* 系统健康摘要：拉统一健康清单（60s 缓存），只取 warn/error 计数。
   P1#3 三态纪律：加载中 / 加载失败 / 空清单 / 有数据是四种不同事实，
   不得全部坍缩成「加载中」，更不能让「拉不到」冒充正常——失败态着弱琥珀并给重试出口。 */
const healthCheck = ref<{ total: number; warn: number; error: number } | null>(null);
const healthState = ref<'loading' | 'ready' | 'error' | 'empty'>('loading');
const healthTone = computed<Tone>(() => {
  if (healthState.value === 'error') return 'warn';
  if (healthState.value === 'empty') return 'muted';
  if (healthState.value !== 'ready' || !healthCheck.value) return 'muted';
  return healthCheck.value.error > 0 ? 'bad' : healthCheck.value.warn > 0 ? 'warn' : 'ok';
});
const healthText = computed(() => {
  if (healthState.value === 'error') return '加载失败（可重试）';
  if (healthState.value === 'empty') return '无检查项';
  if (healthState.value !== 'ready' || !healthCheck.value) return '健康检查加载中';
  if (healthCheck.value.error > 0) return `${healthCheck.value.error} 项异常`;
  if (healthCheck.value.warn > 0) return `${healthCheck.value.warn} 项需关注`;
  return `${healthCheck.value.total} 项检查全部正常`;
});
const healthTitle = computed(() => {
  if (healthState.value === 'error') return '健康检查清单加载失败';
  if (healthState.value === 'empty') return '健康中心暂无检查项';
  if (healthState.value === 'loading') return '健康检查加载中';
  return '查看健康中心完整检查清单';
});
function healthChipClick() {
  // 失败态点击 = 就地重试（健康中心仍可从状态条右侧动作进入），兑现「可重试」承诺
  if (healthState.value === 'error') { void loadHealth(); return; }
  jump('health-center');
}

/** 今日失败数：读同屏「今日成功率」KPI 的 foot（唯一已发布读数），不另造一份计数 */
const todayFailed = computed(() => {
  const foot = data.value?.kpis?.find((k) => k.label === '今日成功率')?.foot || ''
  const m = /失败\s*(\d+)/.exec(foot)
  return m ? Number(m[1]) : 0
})

/** 结论行右端动作：按结论自己的口径派生。
    此前硬编码「查看健康中心」——结论写「需要关注：今日失败 17 次」时，右端按钮却把人
    送到系统检查清单（14 项系统检查），在那里找不到这 17 条失败（2026-10-13 运营走查 O3）。
    「需要关注」（今日失败 / 今日成功率两类触发）→ 去执行日志按「失败 + 今天」排查；
    其余（运行平稳 / 空闲 / 统计未就绪）→ 维持健康中心入口。健康项本身在明细行另有链接。 */
const statusAction = computed(() => {
  if (statusActionOf(health.value?.headline || '') === 'investigate-today') {
    return {
      label: '去排查',
      run: investigateTodayFailures
    }
  }
  return { label: '查看健康中心', title: healthTitle.value, run: () => jump('health-center') }
})
async function loadHealth() {
  try {
    const res = await adminHealthCenterApi.get()
    const items = res.data?.data?.items ?? []
    if (!items.length) {
      healthState.value = 'empty'
      return
    }
    healthCheck.value = {
      total: items.length,
      warn: items.filter((i) => i.severity === 'warn').length,
      error: items.filter((i) => i.severity === 'error').length,
    }
    healthState.value = 'ready'
  } catch {
    // 失败保留上次成功计数（不回置 null），状态转 error 如实呈现
    healthState.value = 'error'
  }
}
/* 仿真通道摘要：失败率用「系统失败率」；阈值 ≥50% 红、≥20% 或存在失败 黄、无会话灰。
   P1#3 同律：「未加载 / 加载失败」≠「空闲」——消费 live.ts P1#19 暴露的三态状态位，
   统计未落地前不渲染「仿真空闲」，失败态如实降级为需关注。 */
const runStats = liveVirtualRunStats
const simTone = computed<Tone>(() => {
  if (liveVirtualStatsError.value) return 'warn'
  if (!liveVirtualStatsLoaded.value) return 'muted'
  const r = runStats.value
  if (!r.totalSessions && !r.todayCalls) return 'muted'
  // 阈值跨页单源（2026-10-16 用户拍板「不要非零就红」）：与虚拟学习者页同口径
  return failureRateTone(r.systemFailureRate, r.failed)
})
const simHeadline = computed(() => {
  if (liveVirtualStatsError.value) return '统计加载失败'
  if (!liveVirtualStatsLoaded.value) return '统计加载中'
  const r = runStats.value
  if (!r.totalSessions && !r.todayCalls) return '仿真空闲'
  if (r.systemFailureRate >= 20) return `需要关注：系统失败率 ${r.systemFailureRate}%`
  return '运行平稳'
})
const simTitle = computed(() => {
  const parts: string[] = ['虚拟学习者 / 仿真运行情况（仅统计虚拟学习者与测试账号）']
  if (liveVirtualStatsError.value) parts.push(`统计加载失败：${liveVirtualStatsError.value}`)
  else if (!liveVirtualStatsLoaded.value) parts.push('统计加载中…')
  return parts.join(' · ')
})

/* ===================== row3 第三卡：虚拟学习者看板 =====================
   与状态条的「仿真 ·」读数同源（live.ts 的 virtuals 域与运行统计域），本页 boot 时就已拉取。
   三态判定刻意与虚拟学习者页同一套（VirtualLearners.vue 的 statsState）：列表域失败必须并入，
   因为 live.ts 只在列表 GET 成功后才去拉运行统计——列表失败时统计保持初值 0 而
   liveVirtualStatsError 仍为空，于是「没拉到」会被渲染成完成率 0% 的假绿。 */
const vlBoardState = computed<'loading' | 'error' | 'ready'>(() => {
  if (liveVirtualStatsError.value || liveFailures.value.virtuals) return 'error'
  if (liveVirtualStatsLoading.value || !liveVirtualStatsLoaded.value) return 'loading'
  return 'ready'
})
/** 三态取值：只有 ready 才渲染真实数字（加载中「…」、失败「—」，不伪造 0） */
function vlValue(ready: string): string {
  if (vlBoardState.value === 'loading') return '…'
  if (vlBoardState.value === 'error') return '—'
  return ready
}
/** 百分比取整（全站判例）：0<rate<1 显「<1%」，避免 3/685 被舍入成「0%」读成「一个也没完成」 */
function vlPct(rate: number | null | undefined): string {
  const v = rate ?? 0
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`
}
const vlConcurrency = computed(() => {
  const c = liveAutopilotConcurrency.value
  return { used: Number(c?.used ?? 0), limit: Math.max(1, Number(c?.limit ?? 10)), queued: Number(c?.queued ?? 0) }
})
const vlTiles = computed<MkStatItem[]>(() => {
  const r = runStats.value
  const s = liveVirtualSessionStats.value
  const c = vlConcurrency.value
  /* 无分母不造假零（rate-utils 判例）：一条会话都没有时「完成率 0%」会被读成跑过但全失败 */
  const hasSessions = r.totalSessions > 0
  /* 着色只在 ready 生效：加载/失败态的值是「…/—」，再叠红黄会把占位符读成结论 */
  const ready = vlBoardState.value === 'ready'
  const failTone = failureRateTone(r.systemFailureRate, r.failed)
  return [
    {
      label: '学习者',
      value: vlValue(String(r.profileCount)),
      title: '含测试账号'
    },
    {
      label: '在跑运行',
      value: vlValue(String(s.running))
    },
    {
      label: '自动驾驶并发',
      value: vlValue(`${c.used}/${c.limit}`),
      tone: ready && c.used >= c.limit ? 'warn' : ''
    },
    {
      label: '无响应运行',
      value: vlValue(String(r.staleCount)),
      tone: ready && r.staleCount > 0 ? 'warn' : ''
    },
    {
      label: '完成率',
      value: vlValue(hasSessions ? vlPct(r.completionRate) : '—')
    },
    {
      label: '系统失败率',
      value: vlValue(hasSessions ? vlPct(r.systemFailureRate) : '—'),
      tone: ready && hasSessions && failTone !== 'muted' ? failTone : '',
      title: '人为终止不计入'
    }
  ]
})
/** 失败重试：live 层 retryLiveVirtualStats 只重拉统计域，列表域失败时统计仍会立刻回到失败态，
    所以必须一并重拉列表（loadLiveData 会重跑失败过的域，成功的域走 TTL 缓存不重复请求） */
function retryVlBoard() {
  if (vlBoardState.value !== 'error') return
  void retryLiveVirtualStats()
  void loadLiveData()
}

const hasWrapupStats = computed(() => {
  const w = data.value?.wrapup;
  if (!w) return false;
  return w.summaryModel > 0 || w.summaryFallback > 0 || w.evaluationModel > 0 || w.evaluationAiFallback > 0 || w.evaluationFailed > 0;
});

/* 总结质量条件行：只在出现降级/失败时露头。
   2026-10-19：「N 次兜底」改「N 次降级总结」——同一件事（总结走的是非模型兜底路径）
   在教学会话列表挂的徽章就叫「降级总结」，概览这里换个词等于同屏两个叫法。 */
const wrapupIssue = computed(() => {
  const w = data.value?.wrapup;
  if (!w || !hasWrapupStats.value) return null;
  const parts: string[] = [];
  if (w.summaryFallback > 0) parts.push(`${w.summaryFallback} 次降级总结`);
  if (w.evaluationFailed > 0) parts.push(`${w.evaluationFailed} 次失败`);
  if (!parts.length) return null;
  return {
    tone: w.evaluationFailed > 0 ? 'bad' : 'warn',
    text: `最近 ${w.sampleSize} 次课后总结：${parts.join(' · ')}`,
  };
});

// 重试按钮：force 跳过 liveLoading 守卫保证点击必重拉
async function retryOverview() {
  const ok = await refreshOverviewTracked(true)
  if (ok) lastUpdated.value = nowHm()
  // 完课量卡失败态无独立重试钮：整页重试一并重拉（与闭环两环同节奏）
  if (closureState.value !== 'ready') void loadClosure()
}

// 动态筛选：默认隐藏虚拟学习者与测试/审计账号（后端 excludeTest 已按此过滤）
const hideTestAccounts = overviewHideTest
// KPI 目标：今日调用 / 今日成功率 / 用户活跃 / 进行中对话（纯真实口径 4 卡）
const kpiTargets: Array<{ scene: string; tab?: string }> = [
  { scene: 'execution-logs' },
  { scene: 'execution-logs' },
  { scene: 'people' },
  { scene: 'goal-conversations' }
]

/* KPI 卡面副行 = 口径短语（随数据来，live.ts kpis.hint）；数值类（趋势 / 分解 / 对照 / foot）
   全部下沉到本 tooltip 长释——副行说「这个数怎么算」，tooltip 说「这一窗具体是多少」。
   （2026-10-19 用户走查：「目标对话 ｜ 累计完成 14 个」「用户活跃 ｜ 今日新增 0…」这类
   hint 在报另一个读数，不是口径；目标页由卡片点击直达，见 kpiTargets。） */
function kpiTitle(k: KpiCard): string {
  const trend = k.trend ? `较昨日同时刻 ${k.trend.pct}` : ''
  /* foot 里的 baseNote（「较昨日同时刻」/「昨日同时刻无对照」）在有趋势数字时与 trend 重复，
     只在无趋势（无对照）时才由 foot 单独承载这条说明 */
  const foot = k.trend ? k.foot.replace(/(?:^| · )较昨日同时刻$/, '') : k.foot
  return [k.hint, k.note, trend, foot].filter(Boolean).join(' · ')
}
function jump(scene: string, tab?: string) {
  if (!scene) return
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceId = ''
  // 审核 #2（2026-10-06）：补清会话深链字段——上一次 drill-in 留下的 sessionId 会让
  // 执行日志页 immediate watch 命中即切「会话模式」并提示「会话 … 未找到」；
  // traceFocus 同源（与 store.clearInvestigation 及 jumpToFailures/jumpToFailedPaths 对齐）
  intent.sessionId = ''
  intent.traceFocus = false
  intent.errorCategory = ''
  intent.timeRange = ''
  intent.tab = tab || ''
  intent.scene = scene
}

/* R5：失败归因/异常流 → 执行日志（带错误类别 + 状态 + 近 7 天时间窗筛选） */
function jumpToFailures(category: string) {
  intent.errorCategory = category || ''
  intent.statusFilter = category === 'provider_timeout' ? 'warn' : 'err'
  intent.timeRange = 'week'
  intent.agentFilter = ''
  intent.traceId = ''
  intent.sessionId = ''
  intent.scene = 'execution-logs'
}

/* 最近事件（原型 feed：时间列 + 标题/描述两行；坏/警事件可点进日志） */
const isTestAccount = (text: string) => {
  const email = String(text || '').replace(/^新用户注册：/, '');
  if (email.startsWith('virtual_') || email.endsWith('@test.local')) return true;
  return /^(audit_probe_|e2e_|ui_check|motion_review|qa_audit_)/.test(email);
};
const testFilteredFeed = computed(() => {
  const feed = data.value?.feed || [];
  return hideTestAccounts.value ? feed.filter((f) => !isTestAccount(f.text)) : feed;
});
/** 事件流视图：相邻同类失败折叠（2026-10-03 反馈「同类日志刷爆列表」）——
    同一分钟批量中止的 N 个 Skill 合并为「执行失败 ×N（同因）」，desc 列出来源；
    点击仍按首条失败类别跳日志。非坏消息/非同构文案原样透传（feedDesc 口径不变） */
interface FeedView { time: string; text: string; desc: string; tone: BriefData['feed'][number]['tone']; errorCategory?: string; count: number }
const feedRows = computed<FeedView[]>(() => {
  const out: FeedView[] = [];
  for (const f of testFilteredFeed.value) {
    const last = out[out.length - 1];
    // 「执行失败：来源（类别）」解析：捕获 1=来源、2=类别（feedRows 折叠与 desc 兜底共用此口径）
    const m = /^执行失败：(.+)（(.+)）$/.exec(f.text);
    /* 来源名走目录里的中文名（2026-10-23 运营视角）：live.ts 的原文是内部 Skill id，
       运营读不出 goal-conversation 是什么；括注里的类别保持原样 */
    const text = m ? `执行失败：${skillDisplayName(f.agentId || m[1])}（${m[2]}）` : f.text;
    if (f.tone === 'bad' && m && last && last.tone === 'bad' && last.count > 0 && last.text.startsWith('执行失败：') && last.desc.startsWith('Skill · ')) {
      // 同构坏消息追加来源（desc 形如「Skill · a、b」）；首条 desc 的单名改组名
      last.count += 1;
      // 来源名：agentId 优先；缺源时 live.ts 在标题里写「未知节点」占位，该占位不进来源清单
      const rawName = f.agentId || (m[1] !== '未知节点' ? m[1] : '');
      const name = rawName ? skillDisplayName(rawName) : '';
      if (name && !last.desc.includes(name)) last.desc = `${last.desc}、${name}`;
      continue;
    }
    out.push({ time: f.time, text, desc: feedDesc(f), tone: f.tone, errorCategory: f.errorCategory, count: 1 });
  }
  return out.slice(0, 12);
});
function feedDesc(f: BriefData['feed'][number]): string {
  if (f.agentId) return `Skill · ${skillDisplayName(f.agentId)}`
  // 失败类别不再回填副行（2026-10-04 全站评审 P3）：标题括注「（调用方中止）」已把类别说了一次，
  // 副行「失败类别 · 调用方中止」属同屏双写——类别只在标题出现一次；副行回退可点提示
  return ''
}
function feedJump(f: { tone: string; errorCategory?: string }) {
  if (f.tone !== 'bad' && f.tone !== 'warn') return
  jumpToFailures(f.errorCategory || '')
}
/** 悬浮看全文（评审 2026-10-10）：标题/副行截断后原文进 title；
 *  可点行保留「点击查看日志」提示，缀在原文之后 */
function feedTitle(f: { text: string; desc: string; tone: string }) {
  const full = f.desc ? `${f.text} ${f.desc}` : f.text
  return full
}

/* 底部渐隐只在「确有下文被裁」时挂（审核 #0，2026-10-06）：
   此前 mask-image 无条件写在 .feed--capped 上，≤4 条（元素高 <236px）时末条下缘
   照样被 22px 渐隐淡掉——把「下面还有」画在没有下文的地方。改为渲染后量 scrollHeight
   与 clientHeight 判定溢出，只在 overflow 类下挂 mask；窗口尺寸/条数变化时复测。 */
const feedRef = ref<HTMLElement | null>(null)
const feedOverflow = ref(false)
function measureFeedOverflow() {
  const el = feedRef.value
  feedOverflow.value = !!el && el.scrollHeight > el.clientHeight + 1
}
let feedRo: ResizeObserver | null = null
watch(feedRef, (el) => {
  feedRo?.disconnect()
  feedRo = null
  if (!el || typeof ResizeObserver === 'undefined') return
  feedRo = new ResizeObserver(() => measureFeedOverflow())
  feedRo.observe(el)
  measureFeedOverflow()
})
watch(feedRows, () => { void nextTick(measureFeedOverflow) })

/* 待处理事项（原型 Row B 第二卡）：与状态条同源，不另起口径。
   密度优化（2026-10-03）：text 里末尾括号是口径标注（「近 7 天 · 200 条采样」），
   与主句挤一行读着冗长 → 拆成主行 + 口径副行（副行弱化为 faint 小字）。
   只做展示层拆分，文案单一事实源仍在 live.ts。 */
const topMaxCalls = computed(() => Math.max(1, ...(data.value?.topSkills || []).map((s) => Number(s.calls) || 0)));
/** Top5 占比条：以榜首调用量为分母，下限 4% 保证末名可见（数字仍为唯一精确口径） */
const topBarPct = (calls: number) => `${Math.max(Math.round((calls / topMaxCalls.value) * 100), 4)}%`;
/** Top5 行 agentId 形如 "skill:goal-conversation"（agent_call_logs 口径）；Skill 详情二级页
    与四个只读端点（effective-prompt / skill-model-configs / field-routings / prompt-lab-core）
    都按注册表裸 id 取数——直接透传前缀会让子视图全线 404/400/500、指标恒 0（FN8）。 */
const skillIdOf = (agentId: string) => String(agentId || '').replace(/^(?:skill|agent):/, '')

interface TodoItem { key: string; text: string; main: string; tone: Tone; actLabel: string; action: () => void }
/** 去掉末尾括号口径（完整句仍进 title）：可见行只留动作本身 */
function splitTodoMain(text: string): string {
  const m = text.match(/^(.*?)\s*[（(]([^（）()]+)[）)]\s*$/)
  return m ? m[1] : text
}
const todoItems = computed<TodoItem[]>(() => {
  const items: TodoItem[] = [];
  // 健康检查异常（#5）：状态条已红/琥珀报「N 项异常」，此处必须有对应条目，
  // 否则同屏红结论配「没有待处理的事项」（healthTone 由 healthCheck error/warn 计数派生）
  const hc = healthCheck.value;
  if (healthState.value === 'ready' && hc && (hc.error > 0 || hc.warn > 0)) {
    const n = hc.error > 0 ? hc.error : hc.warn;
    const label = hc.error > 0 ? '异常' : '需关注';
    items.push({
      key: 'health',
      text: `健康检查 ${n} 项${label}`,
      main: `健康检查 ${n} 项${label}`,
      tone: (hc.error > 0 ? 'bad' : 'warn') as Tone,
      actLabel: '健康中心',
      action: () => jump('health-center'),
    });
  }
  for (const a of effectiveActions.value) {
    // 事项标题里带内部 Skill id（live.ts 原文 `${agentId} 近 7 天失败…`）：换成目录中文名
    const text = a.agentId ? a.text.replace(a.agentId, skillDisplayName(a.agentId)) : a.text
    items.push({
      key: `a-${a.agentId}-${a.text}`,
      text,
      main: splitTodoMain(text),
      tone: a.tone,
      actLabel: '去排查',
      action: () => investigateAgent(a.agentId),
    });
  }
  const w = wrapupIssue.value;
  if (w) {
    items.push({ key: 'wrapup', text: w.text, main: splitTodoMain(w.text), tone: w.tone as Tone, actLabel: '教学会话', action: () => jump('teaching-sessions') });
  }
  return items;
});

/* R6：10s 自动刷新（setTimeout 链 + 并发守卫 + 指数退避 10s→60s + 熔断停止）。
   P2「更新于」假新鲜修复：只有确认拉到新数据才更新时间戳（数据截至 = 真实数据时刻）。 */
const lastUpdated = ref('')
const overviewStale = ref(false)
/** 熔断标记：连续失败停止轮询后必须如实告知（headSub 不再宣称「自动刷新中」） */
const autoRefreshStopped = ref(false)
const nowHm = () => new Date().toTimeString().slice(0, 5)
async function refreshOverviewTracked(force = false): Promise<boolean> {
  const before = liveOverviewFull.value
  try {
    await refreshLiveOverview(force)
  } catch {
    /* live.ts 内部已吞错，理论不可达；兜底按未刷新处理 */
  }
  if (liveOverviewFull.value !== before) {
    overviewStale.value = false
    return true
  }
  if (liveRefreshing.value || liveLoading.value) return false
  overviewStale.value = true
  return false
}
const { start: startAutoRefresh, stop: stopAutoRefresh } = useSafePolling(
  async () => {
    const ok = await refreshOverviewTracked()
    if (ok) lastUpdated.value = nowHm()
  },
  {
    interval: 10000,
    maxBackoff: 60000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
    onError: (_e, n) => {
      console.warn(`[Overview] auto-refresh failed (${n}/5 consecutive)`)
    },
    onCircuitBroken: (n) => {
      autoRefreshStopped.value = true
      console.error(`[Overview] auto-refresh stopped after ${n} consecutive failures — backend may be down`)
    },
  }
)
onMounted(() => {
  void loadHealth()
  void loadLoopExtras()
  // #105 完课量拆分：低频进页口径（累计值，同闭环两环的「进页拉一次」节奏，不进 10s 轮询）
  void loadClosure()
  // 数据截至不预设挂载时刻：轮询首轮（immediate）成功拉到数据后由回调打点
  startAutoRefresh()
})
watch(dataSource, () => {
  lastUpdated.value = nowHm()
  startAutoRefresh()
})
onBeforeUnmount(() => { feedRo?.disconnect(); feedRo = null })
</script>

<style scoped>
/* =====================================================================
   总览页 = newui「UI-分支优化设计」renderOverview 的逐类复刻。
   类名与原型一一对应（card/kpi/feed/ranklist/loop）；柱图已收敛到全站统一
   OvBars 组件（2026-10-02 P1#2，手写 .barchart 退役）。
   色与圆角全走 --mk-* token（数值与原型 --brand/--r-* 同源）。
   全局原语已覆盖的：页头（MkPageHead=pagehead）、状态条（mk-status=statusbar）、
   按钮（mk-btn=btn）。原型 row3 第三卡「学习状态分布」至今不落（后端仍无学习状态聚合，
   用户拍板不做顶替卡）；2026-10-19 用户要求 row3 出三栏并「做一个虚拟学习者的在这里」，
   第三卡改为虚拟学习者看板（真读数，非顶替分布图）。
   ===================================================================== */

/* ---- 页头刷新注记（熔断态=可点恢复钮，旧数据=琥珀告警，正常=faint）---- */
.ov-refresh-note { flex: none; align-self: center; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.ov-refresh-note--warn { color: var(--mk-amber); font-weight: 600; }
/* 熔断恢复钮：复用注记形态（文字钮），下划线点出可点性 */
.ov-refresh-note--action {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--mk-fs-micro);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ov-refresh-note--action:disabled { cursor: default; opacity: 0.6; }

/* ---- 页根 grid 行轨按内容定尺（密度优化 2026-10-03）----
   .mk-page 的 auto 行轨在本页会把状态条压到 min-height（两行内容实为 89.6px，行轨只给
   48px，第二行溢出被裁；实测 gridTemplateRows 该行 48px / scrollHeight 79px）。
   归因：auto 行轨按「最小贡献」定尺，嵌套 flex 内容的 max-content 未参与。
   内容型行轨一律 max-content（同编排图步骤卡判例）。仅本页生效，不动共享 .mk-page。 */
.mk-page { grid-auto-rows: max-content; }

/* ---- 状态条两行布局（密度优化 2026-10-03）----
   .ov-status--stack 覆盖基类的单行 flex：改纵向堆叠两行（结论行 / 子系统行），
   高度随内容自动（auto），不再被 grid 行固有高度按单行 48px 定死（见模板注释）。
   行 1 沿用基类的横排间距；行 2 与行 1 之间给 1px 分隔线 + 7px 起距。 */
.ov-status--stack { flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 0; }
.ov-status--stack .ov-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-height: 30px; }
.ov-status--stack .ov-subs { gap: 8px 22px; margin-top: 3px; padding-top: 7px; border-top: 1px solid var(--mk-line); }
/* 复原 .mk-status__meta-link 的负外边距（-6px 热区补偿会把本行 gap 吃成字墙）；
   本行间隙改由 .ov-subs 的 gap 真实给出 */
.ov-status--stack .ov-subs .mk-status__meta-link { margin: 0; }
/* 结论为 warn/bad 时整条淡同色底 + 同色描边：原为本页私有配方（2026-10-03 用户反馈
   「重点预警不突出」），2026-10-04 批次五用户拍板「全站统一染底，不留一页孤例」——
   配方已提为共享 .mk-status--warn/--bad（mk-primitives.css，底/描边走 --mk-amber-bg/--mk-red-bg
   同款 token），本页私染 CSS 随之撤除，染底效果由共享类承接。 */

/* ---- KPI：壳走共享 .mk-kpi-grid + MkKpi（2026-10-06 审核 #1/#2）----
   原页内 .kpigrid/.card--kpi/.kpi* 自搓家族退役：暗色卡片描边误用 --mk-line（1.36:1）、
   可点 KPI 缺 :active、role=button 只绑 Enter。现由共享原语承担（MkKpi clickable=真 button）。 */

/* ---- 卡片体（共享 .mk-card 无 .mk-card__body 原语，衬距用本页局部类，SessionCockpit 同判例）----
   16 → 18（评审 2026-10-10「整体过度紧凑」）：卡内呼吸感加半档，页 grid gap 同步 16 → 18 */
.ov-card__body { padding: 18px; }

/* ---- 警示状态条减重（评审 2026-10-10「大面积琥珀底显脏」）----
   共享 .mk-status--warn/--bad 是 2026-10-04「全站统一染底」的拍板口径，不动共享原语；
   本页把染底降为 7% 弱填充 + 细描边——保留「这条是预警」的信号，去掉色块的压迫感 */
.ov-status--stack.mk-status--warn {
  background: color-mix(in srgb, var(--mk-amber) 7%, transparent);
  border-color: color-mix(in srgb, var(--mk-amber) 38%, var(--mk-line));
}
.ov-status--stack.mk-status--bad {
  background: color-mix(in srgb, var(--mk-red) 7%, transparent);
  border-color: color-mix(in srgb, var(--mk-red) 38%, var(--mk-line));
}

/* ---- 胶囊（原型 .pill：卡头 tools 徽标）---- */
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px; border-radius: 999px;
  font-size: var(--mk-fs-micro); font-weight: 600;
  border: 1px solid transparent; white-space: nowrap;
}

.pill__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

/* ---- 闭环条（原型 .loop）---- */
.loop { display: flex; align-items: stretch; gap: 10px; overflow-x: auto; padding: 4px 0; }
/* 流程指向增强（评审 2026-10-10「箭头微弱」）：文字箭头 → 线段 + 实心三角，
   线贯通两卡间隙、颜色提到 muted 级，指向性一眼可读 */
.loop__arrow { position: relative; width: 22px; flex: none; }
.loop__arrow::before {
  content: '';
  position: absolute; left: 3px; right: 8px; top: 50%;
  height: 2px; margin-top: -1px;
  background: color-mix(in srgb, var(--mk-muted) 60%, transparent);
}
.loop__arrow::after {
  content: '';
  position: absolute; right: 2px; top: 50%;
  transform: translateY(-50%);
  border-left: 7px solid color-mix(in srgb, var(--mk-muted) 60%, transparent);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.loop__step {
  flex: 1 1 0; min-width: 138px; display: grid; gap: 5px;
  padding: 12px 14px; border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg); background: var(--mk-surface);
  /* P2：五环可点穿（携 intent 深链跳目标页），交互 affordance 与 .card--kpi 同语言 */
  cursor: pointer;
}
.loop__step:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; }
.loop__step--active { border-color: var(--mk-blue); background: var(--mk-blue-bg); }
.loop__step--done { border-color: color-mix(in srgb, var(--mk-green) 34%, var(--mk-line)); }
.loop__step--alert { border-color: color-mix(in srgb, var(--mk-amber) 42%, var(--mk-line)); background: var(--mk-amber-bg); }
.loop__no { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.loop__name { font-weight: 700; font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.loop__meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.loop__val { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--mk-ink); }
/* 指标行 = 数值 + 失败徽章（错误内联，2026-10-03）：徽章可点，需手型与文字对齐 */
.loop__valrow { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.loop__fail { cursor: pointer; font-family: inherit; }
/* 对比度（#0）：暗色 --mk-red-bg 是 14% 半透明红，红字压在本页 .loop__step--alert 的
   半透明琥珀底上合成 3.49:1（<小字 AA 4.5）。徽章自铺不透明底板：暗色取 --mk-surface-2
   （不透明 #27282c，红字实测 ≈5.3:1），亮色档本已达标、不动。
   不用 color-mix：Chromium 把 color-mix 结果序列化为 color(srgb …)，渲染层审计
   （scripts/v4-ui-audit.mjs）的取色器只认 rgb()/rgba()，会跳过本元素底板、继续向上
   合成到琥珀底（误报 4.26:1）。不透明 token 的 computed 值即 rgb()，可被如实量到。 */
html[data-theme='dark'] .loop__fail { background: var(--mk-surface-2); }

/* ---- Row A：图（1.6fr）+ 事件（1fr）----
   等高（2026-10-03 用户指出左右卡底边错位 69px）：撤 align-items:start，
   两卡由 grid 拉齐到同一行高；差值给柱图消化（ov-card--chart 的卡体转 flex 列，
   OvBars 自带 flex:1 自适应长高），不再留中空。
   gap 16 → 18（评审 2026-10-10「过度紧凑」） */
.row2 { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 18px; align-items: stretch; }
/* 图卡也转 flex 列（补齐 2026-10-03「差值给柱图消化」的缺失一环）：.mk-card 原语是块布局，
   grid 拉高卡壳后卡体不跟随——事件卡（feed 两行折行后自然更高）把整行撑高时，
   柱图下方漏出大片卡片底空白（2026-10-10 实拍）。卡体 flex:1 后 OvBars 自身 flex:1 才有母高可撑 */
.mk-card.ov-card--chart { display: flex; flex-direction: column; }
.ov-card--chart .ov-card__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

/* 最近事件卡（评审 2026-10-10「右侧大段留白」）：卡体转 flex 列，feed 撑满剩余高度
   （行高随柱图列拉齐），不再被 236px 定高吊在半空 */
.mk-card.ov-card--feed { display: flex; flex-direction: column; }
.ov-card--feed .ov-card__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

/* 最近事件（原型 .feed--capped：时间列 + 标题/描述，限高滚动）。
   底部 22px 渐隐（mask）提示「下面还有」：内滚区边界落在条目中间时会把最后可见条的
   副标题切半行，不加暗示会被读成「内容坏了」（裸评审 2026-10-03）。浅/深色均走 alpha 遮罩。
   审核 #0（2026-10-06）：mask 只在确有溢出（scrollHeight > clientHeight，见 feedOverflow）
   时挂——条目不足一屏时渐隐会画在没有下文的地方。
   评审 2026-10-10：max-height 236 撤——改 flex 撑满所在卡（与柱图等高），
   限高转由 min-height:0 + overflow 承担。 */
.feed--capped {
  flex: 1;
  min-height: 0;
  display: grid; gap: 2px; overflow-y: auto; overscroll-behavior: contain;
  align-content: start;
}
.feed--capped--overflow {
  -webkit-mask-image: linear-gradient(180deg, black calc(100% - 22px), transparent);
  mask-image: linear-gradient(180deg, black calc(100% - 22px), transparent);
}
.feedrow { display: flex; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--mk-line); }
.feedrow:last-child { border-bottom: 0; }
.feedrow--bad .t { color: var(--mk-red); }
.feedrow--link { cursor: pointer; border-radius: var(--mk-radius-sm); }
.feedrow--link:hover { background: var(--mk-btn-hover-bg); }
.feedrow__time {
  width: 62px; flex: none; color: var(--mk-faint);
  font-size: var(--mk-fs-micro); font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
}
.feedrow__grow { min-width: 0; display: grid; gap: 2px; align-content: start; }
.feedrow__grow .t {
  font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 副行两行截断（评审 2026-10-10「强行截断/省略号重叠」）：长 skill 名折两行而非硬切一行，
   原文始终在行 title 里悬浮可读 */
.feedrow__grow .d {
  color: var(--mk-muted); font-size: var(--mk-fs-micro);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

/* ---- Row B：auto-fit 280 三小卡（gap 同页级 18，评审 2026-10-10 呼吸感）---- */
.row3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
/* Row B 第三卡（虚拟学习者看板，2026-10-19）：
   本卡内容天然比另两卡矮（它们各是 5 行清单），三卡等高下会漏出半张卡的空底——
   卡体转 flex 列，读数条 flex:1 吃满剩余高度（另两卡同款的「差值给内容消化」做法）。 */
.mk-card.ov-card--vl { display: flex; flex-direction: column; }
.ov-card--vl .ov-card__body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.ov-vl__strip {
  flex: 1; min-height: 0;
  /* 2026-10-22 用户「布局重新设计」：六格 3×2 大字块在同排三卡里显得空，
     改为两列键值行（标签左 / 数值右），三行把卡高自然填满。
     数据仍是同一组六项，三态与 title 口径不变；共享原语的 3 列 auto-fit 不再适用，
     列数写在本卡根节点上。 */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(44px, 1fr);
  column-gap: 18px;
  row-gap: 0;
}
.ov-vl__strip :deep(.mk-stat) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-right: 0;
  border-bottom: 1px solid var(--mk-line);
}
/* 末行两格不留底边；奇偶列用一条竖线分开 */
.ov-vl__strip :deep(.mk-stat:nth-last-child(-n + 2)) { border-bottom: 0; }
.ov-vl__strip :deep(.mk-stat:nth-child(even)) { border-left: 1px solid var(--mk-line); padding-left: 14px; }
.ov-vl__strip :deep(.mk-stat:nth-child(odd)) { padding-right: 14px; }
.ov-vl__strip :deep(.mk-stat:first-child) { padding-left: 0; }
.ov-vl__strip :deep(.mk-stat__label) { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ov-vl__strip :deep(.mk-stat__value) { font-size: 18px; white-space: nowrap; }
/* 4K：卡宽 ≈1100，两列会让标签与数值隔 500px；改三列两行，仍保持键值行形态 */
@media (min-width: 3300px) {
  .ov-vl__strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ov-vl__strip :deep(.mk-stat:nth-child(even)) { border-left: 0; padding-left: 0; }
  .ov-vl__strip :deep(.mk-stat:nth-child(3n + 2)),
  .ov-vl__strip :deep(.mk-stat:nth-child(3n)) { border-left: 1px solid var(--mk-line); padding-left: 14px; }
  .ov-vl__strip :deep(.mk-stat:nth-last-child(-n + 2)) { border-bottom: 1px solid var(--mk-line); }
  .ov-vl__strip :deep(.mk-stat:nth-child(n + 4)) { border-bottom: 0; }
}
/* 卡底一行状态：加载中/失败/当日读数三态同占位，不因状态不同让卡高抖动 */
.ov-vl__state {
  margin: 0; display: flex; gap: 8px; align-items: baseline;
  font-size: var(--mk-fs-micro); color: var(--mk-faint);
}
.ov-vl__state--bad { color: var(--mk-red); }
/* 轨道必须钳在容器宽（minmax(0,1fr)）：grid auto 列按 max-content 定尺，
   长 skill 名会把行撑出卡片右缘（1280 实测溢出 28px），行内 ellipsis 也永不生效 */
.ranklist { display: grid; gap: 2px; grid-template-columns: minmax(0, 1fr); }
/* 待处理事项：与左卡等高时把 4 行均分卡高，避免底部堆一块空白 */
.mk-card.ov-card--todo { display: flex; flex-direction: column; }
.ov-card--todo .ov-card__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ov-card--todo .ranklist { flex: 1; display: flex; flex-direction: column; gap: 0; }
.ov-card--todo .rankrow--todo { flex: 1; }
.rankrow { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--mk-line); }
.rankrow:last-child { border-bottom: 0; }
/* 列头行（评审 2026-10-10）：调用/失败拆列后补表头，列语义一眼可读。
   列头复用数据列的定宽类（calls/failed）保证像素级对齐，仅覆字色 */
.rankrow--head { padding: 0 0 6px; border-bottom: 0; }
.rankrow--head .rankrow__grow { color: var(--mk-faint); }
.rankrow--head .rankrow__val--col { color: var(--mk-faint); font-weight: 600; }
.rankrow__idx { width: 20px; flex: none; font-family: var(--mk-mono); color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.rankrow__grow {
  flex: 1; min-width: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rankrow--link { cursor: pointer; }
.rankrow--link:hover .rankrow__grow { color: var(--mk-blue); }
.rankrow__bar { width: 64px; flex: none; }
.rankrow__val { flex: none; font-variant-numeric: tabular-nums; font-weight: 600; font-size: var(--mk-fs-micro); color: var(--mk-ink); }
/* 调用/失败两列（评审 2026-10-10）：右对齐定宽成列；失败非零红字提示，零给「–」保列形 */
.rankrow__calls { width: 56px; text-align: right; }
.rankrow__failed { width: 44px; text-align: right; }
.rankrow__failed:not(.rankrow__failed--zero) { color: var(--mk-red); }
.rankrow__failed--zero { color: var(--mk-faint); font-weight: 500; }
/* 列头「失败」用独立类：不挂 .rankrow__failed 以免吃红字规则（表头保持中性 faint） */
.rankrow__col-failed { width: 44px; text-align: right; color: var(--mk-faint); font-weight: 600; }
/* 待处理事项行：单行主句，动作钮右对齐（口径副行 2026-10-22 已删） */
.rankrow--todo { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0 12px; }
.todo-main { display: grid; gap: 1px; min-width: 0; }
.todo-text {
  font-size: var(--mk-fs-micro); color: var(--mk-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 待办动作文字链（评审 2026-10-10）：默认轻链，悬浮再起操作底色——
   替代整排同款「去排查 →」胶囊的视觉噪声 */
.todo-act {
  border: 0; background: none; padding: 4px 8px;
  border-radius: var(--mk-radius-sm);
  font: inherit; font-size: var(--mk-fs-micro); font-weight: 700;
  color: var(--mk-blue); cursor: pointer; white-space: nowrap;
}
.todo-act:hover { background: var(--mk-blue-bg); }

/* 空态/说明行（原型 .note） */
.note {
  margin: 0; padding: 10px 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2); color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}

/* 响应式（原型：≤768 图高 132 / feed 限高同步收窄）
   ≤1100 单列后 feed 失去柱图列定高，重新给它上限防长事件流无限拉高 */
@media (max-width: 1100px) {
  .row2 { grid-template-columns: 1fr; }
  .feed--capped { max-height: 300px; }
}
</style>
