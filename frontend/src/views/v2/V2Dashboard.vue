<template>
  <div class="dash v2-page">
    <V2Nav />

    <main class="dash__main">
      <!-- 问候栏（headline/subtitle 由学习者 skill 回填）：原型两行结构（newui wf-greet）——
           21px 问候独占一行 + 下方 12.5px 日期行；副标是 Vue 多出的功能，降级为日期行内的
           行内续写（不新增第三行），整行排不下时靠日期行的省略号截断 -->
      <div v-if="!loadError" class="greet">
        <div class="greet__main">
          <!-- P3-39（设计评审）：视觉主标题原是无语义 strong，h1 挂在今日行动卡 14px 任务标题上
               （大纲与视觉权重倒挂）——greet 升 h1（读屏大纲恢复页面结构，样式不变）、
               今日行动卡 action__title 降 h2 -->
          <h1 class="greet__headline">{{ greetHeadline }}</h1>
          <span class="greet__date">{{ dateText }}<template v-if="greetSub && !tipVisible"> · <span class="greet__sub">{{ greetSub }}</span></template></span>
        </div>
        <!-- 连续学习天数的唯一出处：0 态也给一句话，不整块消失（2026-09-25 去重：
             原侧栏 mini 卡把同一个数字再显示一遍，现 mini 只留鼓励文案）。
             P2-21（2026-10-04 全站评审 confirmed）：「今天还没开始」后缀撤除——它与本周节奏卡
             week__note「今天还没点亮 · 学一会儿就能续上」条件恒同、同陈述双写；
             提醒单源留给 week__note（streakNote 逻辑保留），徽章只报天数 -->
        <div class="streak" :class="{ 'streak--off': streakDays === 0 }" title="连续学习天数">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
          <template v-if="streakDays > 0">连续 {{ streakDays }} 天</template>
          <template v-else>点亮连续记录</template>
        </div>
      </div>

      <!-- AI 提示条（warningCopy/paceHint 回填，按状态分级）：Sparkles 紫标注=AI 生成，全站 AI 要素统一语言 -->
      <div v-if="!loadError && tipText && !tipDismissed" class="tip" :class="`tip--${tipTone}`">
        <span class="tip__icon">
          <Sparkles :size="15" :stroke-width="1.75" />
        </span>
        <p>{{ tipText }}</p>
        <button type="button" class="tip__close" title="知道了" @click="tipDismissed = true">×</button>
      </div>

      <!-- 加载 -->
      <div v-if="loading" class="dash__loading">
        <SkeletonLoader variant="dashboard" />
      </div>

      <!-- 整页加载失败：整屏终态（原型 wf-error 形态，走统一结果组件，与 paths 页同一用法） -->
      <V2ResultState
        v-else-if="loadError"
        tone="error"
        title="学习台加载失败"
        description="网络似乎不太稳定，检查连接后可以重试。"
        action-text="重试"
        @action="loadAll"
      />

      <template v-else>
        <!-- 主区：今日行动 + 路径进度 -->
        <div class="dash__grid-main">
          <!-- 进行中：今日行动卡 -->
          <section v-if="pageState === 'active'" class="card action">
            <template v-if="resting">
              <div class="action__eyebrow action__eyebrow--rest"><span>今天休息</span></div>
              <h2 class="action__title">给自己放个小假</h2>
              <p class="action__desc">想回来的时候，任务还在这里等你。</p>
              <div class="action__footer">
                <button type="button" class="btn-primary" @click="setResting(false)">恢复学习</button>
              </div>
            </template>
            <template v-else>
              <!-- 阶段标签挪到 head 右侧单行（原型 wf-action__tag）；「来自路径」是 Vue 多出的
                   出处说明，仍留在 eyebrow 左侧、排不下时省略 -->
              <div class="action__eyebrow">
                <span>今日行动</span>
                <span class="action__from">来自路径「{{ primaryPath?.title }}」</span>
                <span class="action__tag">阶段 {{ stageInfo }} · {{ todayTask?.kind || '任务' }}</span>
              </div>
              <h2 class="action__title">{{ todayTask?.title || '今天没有待办任务' }}</h2>
              <p v-if="actionDesc" class="action__desc action__desc--task">{{ actionDesc }}</p>
              <p v-if="actionReason" class="action__reason">
                <Sparkles :size="13" :stroke-width="1.75" />
                <span>{{ actionReason }}</span>
              </p>
              <!-- 分钟数只在底部进度条行出现一次（2026-09-25 去掉 meta 的「约 N 分钟」；
                   P1-6 2026-10-04 再撤句尾「还剩约 N 分钟」——0/30 已隐含余量，镜像复读且
                   nowrap 下把它推出 390 视口，「去处理」随之不可点） -->
              <div class="action__foot">
                <div class="action__today">
                  <div class="action__today-bar"><i :style="{ width: todayBarPct + '%' }"></i></div>
                  <span>今日已学 {{ todayMinutes }} / {{ todayTask?.minutes || 25 }} 分钟</span>
                </div>
                <!-- 调控提醒位（2026-09-27）：有待确认的调整建议时在行动卡就地露头，
                     不用进学习状态页才能发现；点击进入该页调控区处理 -->
                <router-link v-if="pendingControl" to="/learning-state" class="action__control">
                  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 7 12H5l7-12zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z"/></svg>
                  <span class="action__control-text">AI 建议调整「{{ pendingControl.pathTitle || primaryPath?.title || '当前路径' }}」的后续安排</span>
                  <b>去处理</b>
                </router-link>
                <div class="action__actions">
                  <!-- 主 CTA 独大（2026-09-27 信噪比重设计）：学习台的职责是分发「现在做什么」，
                       导览出口（学习状态/成就/全部路径）各有导航与快捷入口，不再挤主 CTA 的位置 -->
                  <template v-if="skillActions.length">
                    <router-link :to="skillActions[0].to" class="btn-primary">
                      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                      {{ skillActions[0].label }}
                    </router-link>
                  </template>
                  <template v-else>
                    <button type="button" v-if="todayTask" class="btn-primary" @click="goLearn">
                      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                      开始学习
                    </button>
                    <router-link v-else to="/learning-paths" class="btn-primary">查看全部路径</router-link>
                  </template>
                  <!-- P2-22（2026-10-04 全站评审 confirmed）：「今天休息」触控 36px 低于 44px 地板，
                       与同排 44px 主按钮并排不齐——独立 .action__rest 类补齐（不污染通用 .link-muted，
                       本页其余 link-muted 是纯文字链，仍走 36px 紧凑带登记口径） -->
                  <button type="button" class="link-muted action__rest" @click="setResting(true)">今天休息</button>
                </div>
              </div>
            </template>
          </section>

          <section v-else-if="pageState === 'attention'" class="card action action--alert">
            <div class="action__eyebrow action__eyebrow--alert">
              <span>需要先处理</span>
              <span class="action__from">路径「{{ primaryPath?.title }}」</span>
            </div>
            <h2 class="action__title">这版路径没生成出来，重试一般能好</h2>
            <p class="action__desc">{{ primaryPath?.errorText || '生成失败。你的目标和已确认信息都保留着，不会丢。' }}</p>
            <div class="action__meta">
              <span class="tag tag--red">{{ primaryPath?.retryType === 'stage_design' ? '阶段任务失败' : '主结构失败' }}</span>
              <span class="tag">信息已保留</span>
            </div>
            <div class="action__footer">
              <button type="button" class="btn-primary" :class="{ 'btn-primary--off': retrying }" @click="doRetry">
                <span v-if="retrying" class="spinner spinner--sm"></span>
                {{ retrying ? '正在重新生成…' : '重新生成路径' }}
              </button>
              <router-link :to="`/learning-path/${primaryPath?.id}`" class="btn-ghost">查看详情</router-link>
              <router-link to="/goal-conversation" class="link-muted">先修改目标</router-link>
            </div>
          </section>

          <!-- 生成中：等待态（区别于失败红卡，禁用重试） -->
          <section v-else-if="pageState === 'generating'" class="card action action--gen">
            <div class="action__eyebrow">
              <span>路径生成中</span>
              <span class="action__from">来自路径「{{ primaryPath?.title }}」</span>
            </div>
            <h2 class="action__title">路径正在生成，稍等一下</h2>
            <p class="action__desc">生成一般需要 1-2 分钟，这一页会自动检查进度，完成后直接出现今日行动。你也可以先去别的页面看看。</p>
            <div class="action__meta">
              <span class="tag tag--cyan">正在生成</span>
              <span class="tag">信息已保留</span>
            </div>
            <div class="action__footer">
              <span class="btn-primary btn-primary--off" title="路径生成中，暂不可重试">
                <span class="spinner spinner--sm"></span>
                正在生成…
              </span>
              <router-link :to="`/learning-path/${primaryPath?.id}`" class="btn-ghost">查看详情</router-link>
              <router-link to="/learning-paths" class="link-muted">查看全部路径</router-link>
            </div>
          </section>

          <!-- 新手态：引导卡（占满双列——原右侧「还没有学习路径」占位卡与这里同屏
               说两遍同一件事，走查 2026-09-27 冗余项，合并为一处，行动留给本卡） -->
          <section v-else class="card action action--empty">
            <!-- 图标盘（原型 wf-empty__art 形态）：66px 圆角盘 + 30px 图标，卡片其余结构保留 -->
            <span class="action__art" aria-hidden="true"><Box :size="30" :stroke-width="1.6" /></span>
            <h2 class="action__title">用 2 分钟，理出一条能执行的路径</h2>
            <p class="action__desc">{{ guidanceEmptyText }}</p>
            <div class="action__examples">
              <router-link v-for="e in examples" :key="e.text" :to="{ path: '/goal-conversation', query: { seed: e.seed } }" class="example">{{ e.text }}</router-link>
            </div>
            <div class="action__footer">
              <router-link to="/goal-conversation" class="btn-primary">开始规划目标</router-link>
              <router-link to="/learning-paths" class="link-muted">先看看路径长什么样</router-link>
            </div>
          </section>

          <!-- 路径进度条卡（2026-09-27 信噪比重设计）：5 阶段全量标题是路径详情页的内容，
               学习台只保留「当前位置 + 一句话 + 去向」；阶段全量列表与预估投入见详情页 -->
          <aside v-if="primaryPath" class="card path">
            <div class="path__head">
              <div class="path__title">
                <strong>{{ primaryPath.title }}</strong>
                <span class="path__sub">{{ pathStageSummary }}</span>
              </div>
              <span class="badge" :class="pathBadge.cls">{{ pathBadge.text }}</span>
            </div>
            <div class="path__foot">
              <div class="path__progress"><i :style="{ width: primaryPath.percent + '%' }"></i></div>
              <div class="path__nums">
                <span>整体 {{ primaryPath.percent }}%</span>
                <span v-if="currentStageNote">{{ currentStageNote }}</span>
              </div>
              <router-link :to="`/learning-path/${primaryPath.id}`" class="path__detail-link">路径详情 ›</router-link>
            </div>
          </aside>
        </div>

        <!-- 今日安排：预算台账 + 到期复习合成一张连续分区卡。
             原折叠在「今日详情」里，但「今天学什么/复习什么」是每天的主体信息，不该收起（批17）。 -->
        <section v-if="agendaVisible" class="card agenda">
          <div class="agenda__head">
            <strong>今日安排</strong>
            <span v-if="agendaMeta" class="agenda__meta">{{ agendaMeta }}</span>
          </div>

          <!-- 预算（多目标调度台账） -->
          <div v-if="sourceFailed.budget" class="agenda__fail">
            预算数据加载失败。<button type="button" class="agenda__retry" @click="loadAll">重试</button>
          </div>
          <template v-else-if="todaySchedule?.activeGoals?.length">
            <div class="agenda__group">今日预算 · {{ todaySchedule.activeGoals.length }} 个目标</div>
            <!-- 原型 wf-budget：第一行 名称/认知度/数字，第二行独立进度条（原一行内嵌条已拆开） -->
            <ul class="budget__list">
              <li v-for="g in todaySchedule.activeGoals" :key="g.goalId" class="budget__item">
                <router-link v-if="g.pathId" :to="'/learning-path/' + g.pathId" class="budget__row budget__link" :title="'查看「' + g.title + '」的路径详情'">
                  <span class="budget__name">{{ g.title }}</span>
                  <span v-if="g.cognitiveBandwidth" class="budget__bw">{{ bandwidthLabel(g.cognitiveBandwidth) }}</span>
                  <span class="budget__num">{{ g.consumedMinutes }} / {{ g.plannedMinutes }} 分钟</span>
                </router-link>
                <div v-else class="budget__row">
                  <span class="budget__name">{{ g.title }}</span>
                  <span v-if="g.cognitiveBandwidth" class="budget__bw">{{ bandwidthLabel(g.cognitiveBandwidth) }}</span>
                  <span class="budget__num">{{ g.consumedMinutes }} / {{ g.plannedMinutes }} 分钟</span>
                </div>
                <div class="budget__bar"><i :style="{ width: Math.min((g.consumedMinutes / Math.max(g.plannedMinutes, 1)) * 100, 100) + '%' }"></i></div>
              </li>
            </ul>
          </template>

          <!-- 复习（到期旧知回捞）——2026-09-27 信噪比重设计：
               16 项逐条罗列 + 五种数字口径（课上接/排队/到期/明天/额度）的信息都在页面里，
               但学习者要做的决定只有一个：照常去上课。概念明细、记忆强度、排队台账
               属于学习状态页，学习台只保留「会发生什么 + 去上课」。 -->
          <template v-if="reviewBlockVisible">
            <div v-if="sourceFailed.review" class="agenda__fail">
              复习数据加载失败。<button type="button" class="agenda__retry" @click="loadAll">重试</button>
            </div>
            <template v-else-if="reviewDue.length">
              <!-- 2026-09-27 二次去重：①「今日复习」组标与卡头 meta「复习 N 项」重复，删除；
                   ②分隔线只在有预算分区的上方存在时才画；③原来的「去上课」按钮与上方主 CTA
                   指向同一节课（且漏带 pathId），属重复入口，收掉——本行只做信息说明。 -->
              <div v-if="todaySchedule?.activeGoals?.length" class="agenda__divider" role="presentation"></div>
              <div class="review__plan">
                <div class="review__plan-body">
                  <strong>{{ reviewHeadline }}</strong>
                  <span>{{ reviewFooterHint }}</span>
                </div>
              </div>
            </template>
          </template>
        </section>

        <!-- 快捷入口整块移除（2026-09-27 信噪比重设计）：学习状态/全部路径/成就
             三项与主导航重复（学习状态、学习路径在导航条；成就在个人中心），
             且每个数字在各自页面重复展示。学习台的信息职责回归「今天做什么」。 -->

        <!-- 学习节奏常显（2026-09-27）：信噪比重设计后主区已收敛，折叠开关失去存在
             意义——藏内容的成本（一次点击+预期管理）高于滚动成本，本周节奏直接展开。
             「展开整月」保留（原型同款）：整月日历卡已按原型收成一行 month-summary，
             这个开关现在控制摘要行的显隐，属于低频回看的第二档。 -->
        <div class="dash__grid-week">
          <section class="card week">
            <div class="card-head">
              <strong>本周节奏</strong>
              <button type="button" v-if="hasAnyMinutes" class="link-muted" @click="monthOpen = !monthOpen">{{ monthOpen ? '收起整月 ›' : '展开整月 ›' }}</button>
            </div>
            <div v-if="sourceFailed.week" class="dash__source-fail">学习记录加载失败，节奏暂不可用。<button type="button" class="dash__source-retry" @click="loadAll">重试</button></div>
            <div v-else-if="hasAnyMinutes" class="week__grid">
              <button
                v-for="d in weekDays"
                :key="d.date"
                type="button"
                class="day"
                :class="{ 'day--today': d.isToday, 'day--selected': selectedDate === d.date }"
                @click="selectDay(d.date)"
              >
                <span class="day__label">{{ d.weekLabel }}</span>
                <span class="day__cell" :class="`day__cell--h${d.level}`">{{ d.dayNum }}</span>
                <span class="day__min">{{ d.minutes ? d.minutes + '分' : '—' }}</span>
              </button>
            </div>
            <div v-else class="week__empty">完成第一次学习后，这里会点亮你的节奏。</div>
            <div v-if="hasAnyMinutes" class="week__stats">
              <span>本周 <b>{{ weekTotal }}</b> 分钟</span>
              <span><b>{{ weekActiveDays }}</b> 天有学习</span>
            </div>
            <div v-if="streakNote || nearestAchievement" class="week__notes">
              <p v-if="streakNote" class="week__note">
                <Flame :size="14" :stroke-width="1.75" aria-hidden="true" />
                <span>{{ streakNote }}</span>
              </p>
              <p v-if="nearestAchievement" class="week__note week__note--achv">
                <Medal :size="14" :stroke-width="1.75" aria-hidden="true" />
                <span>成就「{{ nearestAchievement.name }}」{{ nearestAchievement.achieved ? '即将解锁 · ' : '' }}{{ nearestAchievement.hint }}</span>
              </p>
            </div>
            <!-- 整月日历卡整体移除（原型 1659 的一行摘要替位）：月导航/7 列网格/图例/右侧当日明细
                 归学习历史页，这里只留一行 month-summary；「全部历史 ›」入口从被删的当日明细面板
                 迁到本行，避免唯一入口随卡一起消失 -->
            <div v-if="monthOpen && hasAnyMinutes" class="month-summary">
              本月节奏：{{ monthTotals.minutes }} 分钟 · {{ monthTotals.days }} 天有学习 · {{ monthTotals.sessions }} 次<template v-if="streakDays > 0"> · 连续 {{ streakDays }} 天</template>
              <router-link to="/user/learning-history" class="month-summary__more">全部历史 ›</router-link>
            </div>
          </section>
        </div>
      </template>
    </main>

    <!-- 当天学习复盘抽屉 -->
    <transition name="sheet">
      <div v-if="daySheetOpen" class="sheet-mask" @click.self="daySheetOpen = false">
        <aside ref="daySheetRef" class="sheet" role="dialog" aria-modal="true" aria-label="当天学习明细" tabindex="-1">
          <header class="sheet__head">
            <div class="sheet__head-main">
              <div class="sheet__date">{{ daySheet.title }}</div>
              <h3 class="sheet__headline">{{ daySheet.headline }}</h3>
            </div>
            <div class="sheet__head-right">
              <span class="sheet__zone" :class="`sheet__zone--${daySheet.zoneCls}`">{{ daySheet.zone }}</span>
              <button type="button" class="sheet__close" title="关闭" @click="daySheetOpen = false">×</button>
            </div>
          </header>

          <div class="sheet__scroll">
            <div v-if="daySheet.count > 0" class="sheet__summary">
              <div><small>总时长</small><strong>{{ daySheet.minutes }} 分钟</strong></div>
              <div><small>学习次数</small><strong>{{ daySheet.count }} 次</strong></div>
              <div><small>状态摘要</small><strong>{{ daySheet.stateSummary }}</strong></div>
              <div class="sheet__summary-wide"><small>主要内容</small><strong>{{ daySheet.primaryTask }}</strong></div>
            </div>

            <!-- 空日 analysis 与「学习记录」空态同文案，重复展示（2026-09-26 走查 07 号截图） -->
            <div v-if="daySheet.count > 0" class="sheet__block">
              <h4>当天观察</h4>
              <p>{{ daySheet.analysis }}</p>
            </div>

            <div class="sheet__block">
              <h4>学习记录</h4>
              <div v-if="daySheet.count === 0" class="sheet__empty">这一天没有学习记录。可以休息，也可以补一次短时学习。</div>

              <article v-for="s in daySheet.sessions" :key="s.id" class="scard">
                <div class="scard__head">
                  <div class="scard__title">
                    <strong>{{ s.title }}</strong>
                    <small>{{ s.timeRange }}</small>
                  </div>
                  <span class="scard__duration">{{ s.durationText }}</span>
                </div>

                <div class="scard__chips">
                  <span class="chip">{{ s.statusLabel }}</span>
                  <span v-if="s.understanding !== null" class="chip chip--blue">理解 {{ s.understanding }}%</span>
                  <span v-if="s.engagement !== null" class="chip chip--cyan">投入 {{ s.engagement }}%</span>
                  <span v-if="s.cognitiveLabel" class="chip chip--purple">认知 · {{ s.cognitiveLabel }}</span>
                </div>

                <div v-if="s.confusions.length" class="scard__confuse">
                  卡点：{{ s.confusions.join('、') }}
                </div>

                <div v-if="s.stages.length" class="scard__stages">
                  <template v-for="(st, i) in s.stages" :key="i">
                    <span class="scard__stage">{{ st.label }}</span>
                    <span v-if="i < s.stages.length - 1" class="scard__stage-sep">›</span>
                  </template>
                </div>

                <button v-if="s.events.length" type="button" class="scard__toggle" @click="toggleSessionEvents(s.id)">
                  {{ openSessionEvents.has(s.id) ? '收起课堂事件 ⌃' : `课堂事件 ${s.events.length} 条 ⌄` }}
                </button>
                <ol v-if="openSessionEvents.has(s.id)" class="scard__events">
                  <li v-for="(e, i) in s.events" :key="i">
                    <span class="scard__event-time">{{ e.time }}</span>
                    <span class="scard__event-text">{{ e.summary }}</span>
                  </li>
                </ol>
              </article>
            </div>
          </div>
        </aside>
      </div>
    </transition>

    <!-- AI 生成提示：置于页面底部、靠近页脚 -->
    <!-- AI 生成提示：位于页脚上方，紧贴页脚（两者作为整体沉底） -->
    <div class="dash__foot">
      <div class="dash__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Box, Flame, Medal, Sparkles } from 'lucide-vue-next';
import request from '@/utils/api';
import { learningAPI } from '@/api/learning';
import { toast } from '@/utils/toast';
import { useUserStore } from '@/stores/user';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
import V2ResultState from '@/components/ui/V2ResultState.vue';
import { localDateKey, localDateKeyFromIso } from '@/utils/date';
import { computeStreakDays } from './streak';
import { useCurrentTask } from '@/composables/useCurrentTask';
import { useSafePolling } from '@/composables/useSafePolling';
import { unwrapArray } from './unwrap';

const router = useRouter();
const userStore = useUserStore();

/* ================= 基础状态 ================= */
const loading = ref(true);
const tipDismissed = ref(false);
/** 「今天休息」：持久化到 localStorage（按日期），当天刷新保留，次日自动复位 */
const REST_KEY = 'wf_dash_resting_date';
const resting = ref(false);
try {
  resting.value = localStorage.getItem(REST_KEY) === localDateKey(new Date());
} catch { /* 隐私模式忽略 */ }
function setResting(v: boolean) {
  resting.value = v;
  try {
    if (v) localStorage.setItem(REST_KEY, localDateKey(new Date()));
    else localStorage.removeItem(REST_KEY);
  } catch { /* 忽略 */ }
}
const retrying = ref(false);
const monthOpen = ref(false);

const stats = ref<Record<string, any> | null>(null);
const paths = ref<Array<Record<string, any>>>([]);
const guidance = ref<Record<string, any> | null>(null);
const sessions = ref<Array<Record<string, any>>>([]);
const achievements = ref<Array<Record<string, any>>>([]);

const userName = computed(() => userStore.user?.name || stats.value?.user?.name || '学习者');
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
});
const dateText = computed(() => {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}`;
});

const examples = [
  { text: '用 Python 自动化处理 Excel 报表', seed: '我想用 Python 自动化处理 Excel 报表，每天能节省时间' },
  { text: '提升职场沟通和表达能力', seed: '我想提升职场沟通和表达能力，在工作里更从容' },
  { text: '用 AI 工具做自媒体副业', seed: '我想用 AI 工具做自媒体副业，提高内容创作效率' },
];

/* ================= 数据加载 ================= */
const reviewDue = ref<Array<{ conceptKey: string; label: string; retention: number; reason: string; estimatedMinutes: number }>>([]);
/**
 * 课内温故计划（记忆层 · 认知负担动态调整）：今天课上实际会接几个、还有多少在排队。
 * 后端按「负担预算」裁剪（复合概念吃更多预算），比 due 列表的接口上限（20）更能代表真实工作量。
 */
const reviewPlan = ref<{
  items: Array<{ conceptKey: string; label: string; retention: number }>;
  backlogCount: number;
  budget: number;
  /** 当日额度（跨会话共享）与明日预告 */
  daily?: { date: string; limitLoad: number; usedLoad: number; remainingLoad: number };
  tomorrowCount?: number;
} | null>(null);
/** 复习行只保留一句话口径（2026-09-27 信噪比重设计）：
    主句=下节课开头会发生什么；概念明细/排队/明天/额度台账移到学习状态页。
    2026-09-27 二次修：「这节课」改「下节课开头」——不存在单独的复习课，
    回捞是带在下一节课开头做的，原文案会让人以为要另上一节复习课 */
const reviewHeadline = computed(() => {
  const planned = reviewPlan.value?.items?.length ?? 0;
  if (planned > 0) return `下节课开头会先复习 ${planned} 个旧知识点`;
  const weak = reviewDue.value.filter((item) => item.reason === 'below-threshold').length;
  if (weak > 0) return `${weak} 个知识点记忆偏弱，课开头会优先复习`;
  return `${reviewDue.value.length} 个知识点到期，上课时会带`;
});
const reviewFooterHint = computed(() => {
  const daily = reviewPlan.value?.daily;
  if (daily && daily.remainingLoad <= 0) {
    return `今日温故额度已用完（${daily.usedLoad}/${daily.limitLoad}），剩下的明天继续`;
  }
  return '没有单独的复习课，不用额外安排';
});
const todaySchedule = ref<Record<string, any> | null>(null);
const loadError = ref(false);
/** 各数据源失败标记：区块级降级提示（不整页失败，也不伪装成空态） */
const sourceFailed = ref<Record<string, boolean>>({
  budget: false,
  review: false,
  week: false
});
/**
 * SWR 快照（模块级，跨导航存活）：进入学习台先立即渲染上一次数据（无骨架屏），
 * 随后静默刷新；月历仅在快照与当前月份一致时才复用，避免闪现错月数据。
 */
function buildDashboardSnapshot() {
  return {
    stats: stats.value,
    paths: paths.value,
    sessions: sessions.value,
    achievements: achievements.value,
    reviewDue: reviewDue.value,
    reviewPlan: reviewPlan.value,
    todaySchedule: todaySchedule.value
  };
}
let dashboardSnapshot: ReturnType<typeof buildDashboardSnapshot> | null = null;

async function loadAll() {
  const snap = dashboardSnapshot;
  if (snap) {
    // 先渲快照（loading 不置 true → 不出骨架屏），随后静默刷新
    stats.value = snap.stats;
    paths.value = snap.paths;
    achievements.value = snap.achievements;
    reviewDue.value = snap.reviewDue;
    reviewPlan.value = snap.reviewPlan;
    // 会话窗口固定为「近 90 天」，快照与实时刷新同窗，复用不会闪现错窗数据
    sessions.value = snap.sessions;
    if (snap.todaySchedule) todaySchedule.value = snap.todaySchedule;
  } else {
    loading.value = true;
    loadError.value = false;
    sourceFailed.value = { budget: false, review: false, week: false };
  }
  const { start: winStart, end: winEnd } = sessionWindowDates();
  const fastGroup = await Promise.allSettled([
    learningAPI.getStats(),
    learningAPI.getPaths(),
    fetchSessions(winStart, winEnd),
    request.get('/achievements/all'),
    request.get('/ai-teaching/review/due'),
    request.get('/ai-teaching/review/plan'),
    request.get('/learning/schedule/today')
  ]);
  // 所有数据源全部失败 → 整页加载失败态（避免误渲染成新手空态）；
  // 有快照时保留旧内容静默失败（不闪错误态，下一次进入再重试）
  if (fastGroup.every((r) => r.status === 'rejected')) {
    if (!snap) {
      loading.value = false;
      loadError.value = true;
    }
    return;
  }
  const [statsR, pathsR, sessionsR, achR, dueR, planR, scheduleR] = fastGroup;
  if (statsR.status === 'fulfilled') stats.value = statsR.value as Record<string, any>;
  if (pathsR.status === 'fulfilled') paths.value = pathsR.value as unknown as Array<Record<string, any>>;
  if (sessionsR.status === 'fulfilled') sessions.value = sessionsR.value;
  else sourceFailed.value.week = true; // 本周节奏/月度摘要依赖 sessions
  if (achR.status === 'fulfilled') achievements.value = unwrapArray(achR.value);
  if (dueR.status === 'fulfilled') {
    const body = dueR.value?.data ?? dueR.value ?? {};
    reviewDue.value = Array.isArray(body.items) ? body.items : [];
  } else {
    sourceFailed.value.review = true;
  }
  if (planR.status === 'fulfilled') {
    const body = planR.value?.data ?? planR.value ?? {};
    reviewPlan.value = body && Array.isArray(body.items) ? body : null;
  }
  if (scheduleR.status === 'fulfilled') {
    const body = scheduleR.value?.data ?? scheduleR.value ?? {};
    todaySchedule.value = body;
  } else {
    sourceFailed.value.budget = true;
  }
  loading.value = false;
  dashboardSnapshot = buildDashboardSnapshot();
  // AI 引导文案独立异步：慢（模型生成可达数秒）也不阻塞首屏，失败静默降级
  learningAPI.getAdaptiveGuidance()
    .then((body) => { guidance.value = body as Record<string, any> | null; })
    .catch(() => { /* 引导缺失不影响首屏 */ });
}

/* 会话窗口：近 90 天（含今天）。原先只拉「当月」，导致：
   ① 跨月那一周（周一~周日跨月）周首屏系统性低估——上月几天不在集合里；
   ② 连续天数在月界假断档（streak.ts 遇空档即断）；
   ③ 与学习状态页/账户页（limit=500 无日期窗）同指标不同值。
   改为滚动窗口后，streak / 本周节奏 / 本月摘要共用同一份近期数据（2026-10-05 修复）。 */
const SESSION_WINDOW_DAYS = 90;
function sessionWindowDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (SESSION_WINDOW_DAYS - 1));
  return { start: localDateKey(start), end: localDateKey(end) };
}
async function fetchSessions(startDate: string, endDate: string) {
  const response = await request.get('/users/me/sessions', { params: { startDate, endDate, limit: 500 } });
  const raw: unknown = response.data ?? response;
  return (Array.isArray(raw) ? raw : []) as Array<Record<string, any>>;
}

/* ================= 页面状态推导 ================= */
interface StageView { title: string; status: 'done' | 'current' | 'todo' | 'blocked'; note: string }
interface PathView {
  id: string; title: string; sub: string; percent: number; hours?: number;
  stages: StageView[]; failed: boolean; generating: boolean; retryType: string | null; errorText: string;
}

const primaryPath = computed<PathView | null>(() => {
  if (!paths.value.length) return null;
  const p = paths.value.find((x) => x.generationLifecycle?.phase === 'ready' && x.status !== 'completed') ?? paths.value[0];
  return toPathView(p);
});

function toPathView(p: Record<string, any>): PathView {
  const lc = p.generationLifecycle;
  const failed = !!lc && lc.phase !== 'ready' && (lc.status === 'failed' || lc.status === 'stale');
  const generating = !!lc && lc.phase !== 'ready' && !failed;
  const weeks = p.milestones || p.weeks || [];
  let total = 0;
  let done = 0;
  const stages: StageView[] = weeks.map((w: Record<string, any>, i: number) => {
    const tasks = w.subtasks || w.tasks || [];
    const doneCount = tasks.filter((t: Record<string, any>) => t.status === 'completed').length;
    total += tasks.length;
    done += doneCount;
    return {
      title: w.title || `阶段 ${i + 1}`,
      status: tasks.length && doneCount === tasks.length ? 'done' : 'todo',
      note: tasks.length ? `${doneCount}/${tasks.length} 任务` : (w.goal || ''),
      tasks
    };
  });
  const firstOpen = stages.findIndex((s) => s.status !== 'done');
  stages.forEach((s, i) => {
    if (s.status !== 'done') s.status = i === firstOpen ? (failed ? 'blocked' : 'current') : 'todo';
  });
  const percent = total ? Math.round((done / total) * 100) : 0;
  return {
    id: p.id,
    title: p.title || p.name || '未命名路径',
    sub: p.deadlineText ? `目标 ${p.deadlineText}` : (p.subject || ''),
    percent,
    hours: p.estimatedHours,
    stages,
    failed,
    generating,
    retryType: lc?.retryType ?? null,
    errorText: lc?.errorMessage || ''
  };
}

const pageState = computed<'active' | 'attention' | 'generating' | 'empty'>(() => {
  if (!primaryPath.value) return 'empty';
  if (primaryPath.value.failed) return 'attention';
  if (primaryPath.value.generating) return 'generating';
  return 'active';
});

/* 生成中轮询（2026-09-27 修复）：生成卡与提示条一直承诺「完成后自动刷新」，
   但此前没有任何轮询兑现——用户在卡前干等永远不更新。现按承诺用 useSafePolling
   每 25s 拉一次 getPaths：phase 离开 generating（ready/failed）即停轮询并 loadAll
   刷新全量（失败态走手动重试卡，不再轮询）；skipWhenHidden 页面隐藏时跳过，
   连续失败有退避+断路器兜底。失败态点「重新生成」成功后 loadAll 把状态推回
   generating，这里同样接管后续轮询。 */
const generationPolling = useSafePolling(
  async () => {
    paths.value = (await learningAPI.getPaths()) as unknown as Array<Record<string, any>>;
    if (pageState.value !== 'generating') {
      // 到达终态：fn 内 stop 避免再调度（composable 约定的业务终止方式），再刷全量
      generationPolling.stop();
      await loadAll();
    }
  },
  { interval: 25000, skipWhenHidden: true }
);
watch(pageState, (state) => {
  if (state === 'generating') generationPolling.start();
  else generationPolling.stop();
}, { immediate: true });

/* ================= 今日任务 ================= */
/* 用共享 pickCurrentTask/useCurrentTask（与路径详情页 currentTask 同一算法）：
   原实现按周遍历、首个有未完成任务的周就返回——周1 有 todo、周2 有 in_progress 时
   会选成周1 的旧任务，与详情页「开始学习」指向不同课（2026-09-25 收口）。
   标题用任务本名：guidance 的 taskTitle 是同一节课的另一种说法，覆盖后会与课堂页
   标题不一致（决策链要求「今日行动 → 课堂」同一个任务）。 */
const allPathTasks = computed<Array<Record<string, any>>>(() => {
  if (pageState.value !== 'active' || !primaryPath.value) return [];
  const out: Array<Record<string, any>> = [];
  for (const w of rawWeeksOf(primaryPath.value.id)) {
    for (const t of w.subtasks || w.tasks || []) out.push(t);
  }
  return out;
});
const todayTask = useCurrentTask(allPathTasks);

function rawWeeksOf(pathId: string) {
  const p = paths.value.find((x) => x.id === pathId);
  return p?.milestones || p?.weeks || [];
}

const stageInfo = computed(() => {
  if (!primaryPath.value) return '—';
  const idx = primaryPath.value.stages.findIndex((s) => s.status === 'current' || s.status === 'blocked');
  return `${(idx >= 0 ? idx : 0) + 1} / ${primaryPath.value.stages.length || '?'}`;
});

const guidanceEmptyText = computed(() => guidanceCopy.value?.emptyStateCopy || '不用整理、不用说得很准。讲讲最近想解决的事，问流会帮你收敛成目标和阶段安排。');

/* skill 今日行动（todayActions 语义跳转解析） */
interface SkillAction { label: string; to: string; primary: boolean }
const ACTION_LABEL_BY_TO: Record<string, string> = {
  'continue-learning': '继续学习',
  'learning-state': '查看学习状态',
  achievements: '查看成就',
  'create-goal': '规划新目标',
  'path-detail': '查看路径'
};
const skillActions = computed<SkillAction[]>(() => {
  const list = guidanceCopy.value?.todayActions;
  if (!Array.isArray(list) || !list.length) return [];
  const resolve = (to?: string): string => {
    switch (to) {
      case 'continue-learning':
        // 与 goLearn 同口径带 pathId：评估页「返回学习路径」据此回详情页（2026-09-25）
        if (todayTask.value?.id) {
          return primaryPath.value ? `/learn/${todayTask.value.id}?pathId=${primaryPath.value.id}` : `/learn/${todayTask.value.id}`;
        }
        return primaryPath.value ? `/learning-path/${primaryPath.value.id}` : '/learning-paths';
      case 'learning-state':
        return '/learning-state';
      case 'achievements':
        return '/user/achievements';
      case 'create-goal':
        return '/goal-conversation';
      case 'path-detail':
        return primaryPath.value ? `/learning-path/${primaryPath.value.id}` : '/learning-paths';
      default:
        return '/learning-paths';
    }
  };
  return list.slice(0, 1).map((item: Record<string, any>) => ({
    label: item.action || item.title || ACTION_LABEL_BY_TO[item.to] || '去学习',
    to: resolve(item.to),
    primary: true
  }));
});

/* 路径条卡（2026-09-27 信噪比重设计）：阶段全量标题归路径详情页，
   这里只给「第 N/M 阶段 · 当前阶段进度」一句话 */
const currentStage = computed(() => primaryPath.value?.stages.find((s) => s.status === 'current') ?? null);
const pathStageSummary = computed(() => {
  const stages = primaryPath.value?.stages ?? [];
  if (!stages.length) return primaryPath.value?.sub || '';
  const idx = stages.findIndex((s) => s === currentStage.value);
  return idx >= 0 ? `第 ${idx + 1} / ${stages.length} 阶段 · ${currentStage.value?.title ?? ''}` : `共 ${stages.length} 个阶段`;
});
const currentStageNote = computed(() => {
  const note = currentStage.value?.note;
  return note ? `本阶段 ${note}` : '';
});

const todayBarPct = computed(() => {
  const target = todayTask.value?.minutes || 25;
  return Math.min(100, Math.round((todayMinutes.value / target) * 100));
});

/* 今日行动描述：标题已说清任务，desc 只保留「怎么做」的首句 / 首个分句，
   其余进课堂页看完整说明（2026-09-27 信噪比重设计：原 98 字含后段心理按摩）。
   长度不再按字数硬切、只由 CSS 两行截断兜底：按 32 字切会把
   「…（带时间戳、级别、进程号、消息体的那一…」切在半截、连括号都不闭合
   （2026-10-08 用户侧视觉检查报出，390/1440 两档都可见）。 */
const actionDesc = computed(() => {
  const desc = todayTask.value?.desc?.trim();
  if (!desc || desc === todayTask.value?.title) return '';
  const firstSentence = desc.split(/(?<=[。！？!?])/)[0] || desc;
  // 提示条在场时只留首个分句（纯操作说明，2026-09-27 去重规则）：
  // 提示条已承担「今天先做最小的那一步」的语义，卡片不再复述判断入口那半句
  if (tipVisible.value) return firstSentence.split(/[，；]/)[0];
  return firstSentence;
});

/* 带上 pathId 进课堂：评估页的「返回学习路径」靠它回详情页（缺省只能回列表），
   上课页也会把它透传到评估 URL（2026-09-25 断链修复） */
function goLearn() {
  if (!todayTask.value?.id) return;
  const pathId = primaryPath.value?.id;
  router.push(pathId ? { path: `/learn/${todayTask.value.id}`, query: { pathId } } : `/learn/${todayTask.value.id}`);
}

/* ================= 提示条（skill: adaptive-guidance-copy 回填 + 分级） ================= */
const guidanceCopy = computed(() => guidance.value?.copy || null);
const guidanceSummary = computed(() => guidance.value?.summary || null);

/* 调控提醒位（2026-09-27）：快照 decisions 里第一条待确认的 path-adjust。
   忽略记录与学习状态页共用同一 localStorage 键——在那边「保持原计划」过的不再来。 */
const DISMISSED_ADVISORIES_KEY = 'learning_state_dismissed_advisories';
const pendingControl = computed<Record<string, any> | null>(() => {
  const list = Array.isArray(guidance.value?.decisions) ? guidance.value.decisions : [];
  let dismissed: string[] = [];
  try { dismissed = JSON.parse(localStorage.getItem(DISMISSED_ADVISORIES_KEY) || '[]'); } catch { /* ignore */ }
  return list.find((d: Record<string, any>) => d?.kind === 'path-adjust' && !dismissed.includes(d?.id)) || null;
});

/* 今日行动依据：为什么是这节课（来自学习者快照的推荐动作，无信号则不显示） */
const actionReason = computed(() => {
  if (!todayTask.value) return '';
  const rec = guidanceSummary.value?.path?.recommendedAction;
  if (rec === 'review-prerequisites') return '前面课程发现有前置缺口，这节课先补基础再推进';
  if (rec === 'slow-down') return '最近节奏偏紧，今天先稳住这一个任务';
  if (todayTask.value.status === 'in_progress') return '接着上次的进度继续';
  return '';
});

const greetHeadline = computed(() => guidanceCopy.value?.headline || `${greeting.value}，${userName.value}`);
const greetSub = computed(() => guidanceCopy.value?.subtitle || '');

const tipTone = computed(() => {
  if (pageState.value === 'attention') return 'attention';
  if (pageState.value === 'generating') return 'normal';
  const level = guidanceSummary.value?.global?.stateLevel;
  if (level === 'recover') return 'recover';
  if (guidanceSummary.value?.global?.hasWarnings || guidanceSummary.value?.global?.warningLevel === 'critical') return 'warn';
  return 'normal';
});

const tipText = computed(() => {
  if (pageState.value === 'attention') return '路径生成失败通常是暂时的。已确认的信息都会保留，点「重新生成路径」手动重试。';
  if (pageState.value === 'generating') return '路径正在生成中，一般需要 1-2 分钟，完成后这一页会自动更新。';
  const copy = guidanceCopy.value;
  const warning = copy?.warningCopy;
  if (warning && warning !== '当前没有明显风险。') return warning;
  if (stats.value?.suggestion?.message) return stats.value.suggestion.message;
  if (copy?.paceHint && copy.paceHint !== '当前节奏稳定，继续保持。') return copy.paceHint;
  return '';
});

/* 提示条在场判定（2026-09-27 去重规则共用）：与模板 v-if="tipText && !tipDismissed" 同条件。
   副标与提示条二选一、卡片描述收成纯操作说明，都以此为界 */
const tipVisible = computed(() => !!tipText.value && !tipDismissed.value);

/* ================= 重试 ================= */
async function doRetry() {
  if (retrying.value || !primaryPath.value || primaryPath.value.generating) return;
  retrying.value = true;
  try {
    if (primaryPath.value.retryType === 'stage_design') {
      await learningAPI.retryPathEnrichment(primaryPath.value.id);
    } else {
      await learningAPI.retryPathGeneration(primaryPath.value.id);
    }
    window.setTimeout(loadAll, 4000);
  } catch {
    toast.error('重新生成失败，请稍后再试');
  } finally {
    retrying.value = false;
  }
}

/* ================= 路径徽章 ================= */
const pathBadge = computed(() => {
  if (!primaryPath.value) return { text: '', cls: '' };
  if (primaryPath.value.failed) return { text: '需要处理', cls: 'badge--red' };
  if (primaryPath.value.generating) return { text: '生成中', cls: 'badge--cyan' };
  if (primaryPath.value.percent >= 100) return { text: '已完成', cls: 'badge--green' };
  return { text: '进行中', cls: 'badge--blue' };
});

const nearestAchievement = computed(() => {
  const locked = achievements.value.filter((a) => !a.unlocked && a.progress);
  if (!locked.length) return null;
  const nearest = locked.sort((a, b) => (b.progress?.percentage ?? 0) - (a.progress?.percentage ?? 0))[0];
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString());
  /* P3-38（设计评审）：「KTL达到7.0（4.6/7）」目标与进度无缝拼接，读作两个互相矛盾的 KTL 值——
     补衔接词分家：「目标 <描述> · 进度 c/t」（description 缺失时只说进度） */
  const prog = `${fmt(nearest.progress?.current ?? 0)}/${fmt(nearest.progress?.total ?? 1)}`;
  return {
    iconUrl: typeof nearest.icon === 'string' && nearest.icon.startsWith('http') ? nearest.icon : '',
    name: nearest.name,
    achieved: (nearest.progress?.current ?? 0) >= (nearest.progress?.total ?? 1),
    hint: nearest.description ? `目标 ${nearest.description} · 进度 ${prog}` : `进度 ${prog}`
  };
});

// 本地时区日期键（口径与实现统一到 @/utils/date；此前是各页面各写一份）
/** 会话归属的本地日期键（与 minutesByDate 同口径；勿用 toISOString，UTC+8 凌晨会前移一天） */
function sessionLocalDate(s: { startTime?: string | null }): string {
  return localDateKeyFromIso(s.startTime);
}
const todayStr = localDateKey(new Date());

/** 认知带宽枚举 → 中文（light/medium/heavy 等）；stress_test 是埋造数据，对外统一显示「—」 */
function bandwidthLabel(v: string): string {
  const map: Record<string, string> = {
    light: '轻度',
    medium: '中度',
    heavy: '重度',
    stress_test: '—'
  };
  return map[v] ?? v;
}

/** 今日安排区可见性：预算/复习任一有数据或加载失败（批17 从折叠区上提，常显） */
const agendaVisible = computed(
  () =>
    Boolean(todaySchedule.value?.activeGoals?.length) ||
    reviewDue.value.length > 0 ||
    Boolean(sourceFailed.value.budget) ||
    Boolean(sourceFailed.value.review)
);
/** 复习块独立可见（预算失败但复习正常时，复习块仍要出现） */
const reviewBlockVisible = computed(() => Boolean(sourceFailed.value.review) || reviewDue.value.length > 0);
const agendaMeta = computed(() => {
  const parts: string[] = [];
  if (todaySchedule.value?.activeGoals?.length) parts.push(`预算 ${todaySchedule.value.totalPlanned} 分钟`);
  if (reviewDue.value.length) {
    // 「课上带 N」（预算裁剪后的计划数）由下方复习主句独占，卡头只报「到期 N」：
    // 同卡同屏双报同一 reviewPlan.items.length 属复读（2026-10-05 去重；拍板豁免的是异屏，不含同卡）
    parts.push(`到期 ${reviewDue.value.length}`);
  }
  return parts.join(' · ');
});
/** 激励行（原 side-stack mini 卡内容压平）：天数已在问候栏 pill，这里只给行动建议 */
const streakNote = computed(() => {
  if (streakDays.value > 0) return todayMinutes.value > 0 ? '连续记录保住了，继续保持' : '今天还没点亮 · 学一会儿就能续上';
  return '今天学 10 分钟，开始连续记录';
});
/* P1-6（2026-10-04）：「还剩约 N 分钟」句尾已撤（0/30 镜像复读且 nowrap 下把「去处理」推出视口），
   todayRemaining 计算随之退役 */

const minutesByDate = computed(() => {
  const map = new Map<string, number>();
  for (const s of sessions.value) {
    if (!s.startTime) continue;
    const date = localDateKey(new Date(s.startTime));
    map.set(date, (map.get(date) ?? 0) + (s.durationMinutes ?? 0));
  }
  return map;
});

const todayMinutes = computed(() => minutesByDate.value.get(todayStr) ?? 0);

/* P1-1（2026-10-04 全站评审）：「连续 N 天」全站统一为客户端推算（views/v2/streak.ts），
   不再优先读 users.streakDays 库字段快照——该字段无实时刷新机制，与学习状态页的
   实时推算跨页打架（同账号同天一处 1 一处 0）。 */
const streakDays = computed(() => computeStreakDays(minutesByDate.value));

/**
 * 热力等级 0-3（背景表示学习强度）。
 * 具体颜色走 CSS class（浅/暗各一套），不再用内联 `var(--x, 浅色回退)`：
 * 一旦变量没解析成功，回退值是浅色底 + 深色字，在暗色主题下会把格子渲染成"白底黑字"。
 */
function heatLevel(m: number): 0 | 1 | 2 | 3 {
  if (m <= 0) return 0;
  if (m < 30) return 1;
  if (m <= 60) return 2;
  return 3;
}

/* 本周条 */
const weekDays = computed(() => {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  return labels.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    // 用本地日期键：toISOString 是 UTC，UTC+8 凌晨会把整周前移一天，和 minutesByDate 口径对不上
    const date = localDateKey(d);
    const minutes = minutesByDate.value.get(date) ?? 0;
    return { label, weekLabel: label, dayNum: d.getDate(), date, minutes, isToday: date === todayStr, level: heatLevel(minutes) };
  });
});

const hasAnyMinutes = computed(() => [...minutesByDate.value.values()].some((m) => m > 0));
const weekTotal = computed(() => weekDays.value.reduce((s, d) => s + d.minutes, 0));
const weekActiveDays = computed(() => weekDays.value.filter((d) => d.minutes > 0).length);

/* 月度数据游标已退役（2026-10-05）：sessions 改拉「近 90 天」滚动窗口，
   月度摘要按当前自然月从窗口内过滤，不再靠翻月重拉。 */

const monthTotals = computed(() => {
  // 本月节奏只统计当前自然月（窗口含前两月，必须按前缀过滤，否则把三个月都算进「本月」）
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  let minutes = 0;
  let days = 0;
  for (const [date, m] of minutesByDate.value) {
    if (!date.startsWith(prefix)) continue;
    if (m > 0) { minutes += m; days += 1; }
  }
  const sessionsCount = sessions.value.filter((s) => sessionLocalDate(s).startsWith(prefix)).length;
  return { minutes, days, sessions: sessionsCount };
});

/* 选中日：整月日历移除后，周节奏格是唯一的日期入口——点一天直接开当天复盘抽屉
   （原「整月日历 → 当天明细 › 查看当天明细」两级入口降级为一级）。
   会话集合已是近 90 天窗口，周格内日期恒在窗内；窗口外的日期才补拉该月并「合并」进集合
   （不再整体换月——换月会丢掉窗口内其它月的数据，2026-10-05 修复）。 */
const selectedDate = ref(todayStr);
function selectDay(date: string) {
  selectedDate.value = date;
  daySheetOpen.value = true;
  const { start } = sessionWindowDates();
  if (date < start) {
    const [y, m] = date.split('-').map(Number);
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDate = new Date(y, m, 0).getDate();
    const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
    fetchSessions(first, last)
      .then((list) => {
        const byId = new Map(sessions.value.map((s) => [s.id, s]));
        for (const s of list) byId.set(s.id, s);
        sessions.value = [...byId.values()];
      })
      .catch(() => {});
  }
}

/* 选中日摘要：只保留「入口」需要的字段（日期/分钟/次数）；
   zone/topic/note 原为面板四宫格与抽屉共用，抽屉另算，此处不再产出（2026-09-25） */
const selectedInfo = computed(() => {
  const date = selectedDate.value;
  const minutes = minutesByDate.value.get(date) ?? 0;
  const daySessions = sessions.value.filter((s) => sessionLocalDate(s) === date);
  const d = new Date(date + 'T00:00:00');
  const title = `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}${date === todayStr ? ' · 今天' : ''}`;
  return { title, minutes, sessions: daySessions.length };
});

/* ================= 当天学习复盘抽屉 ================= */
const daySheetOpen = ref(false);
const openSessionEvents = ref<Set<string>>(new Set());
const daySheetRef = ref<HTMLElement | null>(null);

function onSheetKey(e: KeyboardEvent) {
  if (e.key === 'Escape') daySheetOpen.value = false;
}
watch(daySheetOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onSheetKey);
    // 打开即移焦进抽屉：role=dialog 配 aria-modal 后键盘/读屏用户要能直接在抽屉内操作
    nextTick(() => daySheetRef.value?.focus({ preventScroll: true }));
  } else {
    window.removeEventListener('keydown', onSheetKey);
  }
});
onBeforeUnmount(() => window.removeEventListener('keydown', onSheetKey));

function toggleSessionEvents(id: string) {
  const next = new Set(openSessionEvents.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openSessionEvents.value = next;
}

const COGNITIVE_LABELS: Record<string, string> = {
  remember: '记忆', understand: '理解', apply: '应用',
  analyze: '分析', evaluate: '评估', create: '创造'
};
const STAGE_LABELS: Record<string, string> = {
  opening: '开场', intervention: '干预', teaching: '授课',
  practice: '练习', review: '复习', wrapup: '收尾'
};

function fmtTime(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDuration(minutes: number) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  }
  return `${minutes} 分钟`;
}

function sessionStatusLabel(s: Record<string, any>) {
  if (s.taskStatus === 'completed') return '任务已完成';
  if (s.taskStatus === 'in_progress') return '任务进行中';
  if (s.endTime) return '本次学习已结束';
  if (s.status === 'completed') return '本次学习已结束';
  if (s.status === 'active') return '仍在进行';
  return '已记录';
}

const daySheet = computed(() => {
  const date = selectedDate.value;
  const daySessions = sessions.value
    .filter((s) => sessionLocalDate(s) === date)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  const minutes = daySessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  const primaryTask = daySessions.find((s) => s.taskTitle)?.taskTitle || '未关联具体任务';

  const sessionsView = daySessions.map((s) => {
    const ps = s.parsedState || {};
    const analysis = ps.analysis || {};
    const risk = ps.classroomContext?.risk || {};
    const confusions: string[] = risk.confusionPoints || analysis.confusionPoints || [];
    const stages = Array.isArray(ps.stageHistory)
      ? ps.stageHistory.map((h: Record<string, any>) => ({ label: STAGE_LABELS[h.stage] || h.stage || '课堂' }))
      : [];
    const events = Array.isArray(ps.classroomEventHistory)
      ? ps.classroomEventHistory
          .filter((e: Record<string, any>) => e.summary)
          .slice(0, 12)
          .map((e: Record<string, any>) => ({ time: fmtTime(e.occurredAt), summary: e.summary }))
      : [];
    return {
      id: s.id,
      title: s.taskTitle || '本次学习',
      timeRange: `${fmtTime(s.startTime)}${s.endTime ? ' - ' + fmtTime(s.endTime) : ' 开始'}`,
      durationText: fmtDuration(s.durationMinutes ?? 0),
      statusLabel: sessionStatusLabel(s),
      understanding: typeof analysis.understanding === 'number' ? Math.round(analysis.understanding * 100) : null,
      engagement: typeof analysis.engagement === 'number' ? Math.round(analysis.engagement * 100) : null,
      cognitiveLabel: analysis.cognitiveLevel ? (COGNITIVE_LABELS[analysis.cognitiveLevel] || analysis.cognitiveLevel) : '',
      confusions,
      stages,
      events
    };
  });

  // 状态摘要（沿用旧版聚合逻辑的精神：异常 > 压力 > 投入 > 平稳）
  const evals = sessionsView.filter((s) => s.engagement !== null || s.understanding !== null);
  const hasStruggle = sessionsView.some((s) => s.confusions.length > 0);
  const avgEngagement = evals.length
    ? evals.reduce((sum, s) => sum + (s.engagement ?? 0), 0) / evals.length
    : 0;
  const stateSummary = !daySessions.length
    ? '状态未评估'
    : hasStruggle
      ? '有卡点需要巩固'
      : !evals.length
        ? '状态未评估'
        : avgEngagement >= 70
          ? '专注度较好'
          : '过程平稳';

  // 当天观察（沿用旧版文案引擎：时长分档 × 状态摘要）
  const taskFragment = daySessions.length && primaryTask !== '未关联具体任务' ? `主要围绕“${primaryTask}”展开。` : '';
  let analysis = '';
  if (!daySessions.length) {
    analysis = '这一天没有学习记录。可以休息，也可以补一次短时学习。';
  } else if (minutes >= 120) {
    if (stateSummary === '有卡点需要巩固') analysis = `今天学习时长较长，累计 ${fmtDuration(minutes)}，过程中出现了卡点。建议之后安排一次针对性复习，把卡住的概念巩固下来。${taskFragment}`;
    else if (stateSummary === '专注度较好') analysis = `今天学习时长较长，累计 ${fmtDuration(minutes)}，但整体专注度不错。后续注意恢复，就能把这个节奏维持住。${taskFragment}`;
    else analysis = `今天学习时长较长，累计 ${fmtDuration(minutes)}，过程整体平稳。建议之后安排恢复。${taskFragment}`;
  } else if (minutes >= 60) {
    if (stateSummary === '有卡点需要巩固') analysis = `今天学习投入比较扎实，累计 ${fmtDuration(minutes)}，但也遇到了卡点。可以继续推进，同时记得回头巩固卡住的部分。${taskFragment}`;
    else if (stateSummary === '专注度较好') analysis = `今天学习投入比较扎实，累计 ${fmtDuration(minutes)}，专注度也不错。保持这个节奏就好。${taskFragment}`;
    else analysis = `今天学习投入比较扎实，累计 ${fmtDuration(minutes)}，过程也比较平稳。适合继续稳步推进。${taskFragment}`;
  } else {
    if (stateSummary === '有卡点需要巩固') analysis = `今天是一次轻量学习，累计 ${fmtDuration(minutes)}，但过程里出现了卡点。接下来适合放慢一点，先巩固再继续。${taskFragment}`;
    else if (stateSummary === '专注度较好') analysis = `今天完成了一次轻量学习，累计 ${fmtDuration(minutes)}，专注度不错，适合继续保持节奏。${taskFragment}`;
    else analysis = `今天完成了一次轻量学习，累计 ${fmtDuration(minutes)}，过程平稳，适合热身、复习或保持节奏。${taskFragment}`;
  }

  const zone = minutes >= 120 ? '高强度' : minutes >= 60 ? '中度' : minutes > 0 ? '轻度' : '无记录';
  const zoneCls = minutes >= 120 ? 'high' : minutes >= 60 ? 'mid' : minutes > 0 ? 'low' : 'none';

  return {
    title: selectedInfo.value.title,
    headline: !daySessions.length
      ? '这一天没有学习记录'
      : daySessions.length === 1
        ? '这一天完成了 1 次学习会话'
        : `这一天完成了 ${daySessions.length} 次学习会话`,
    count: daySessions.length,
    minutes,
    primaryTask,
    stateSummary,
    analysis,
    zone,
    zoneCls,
    sessions: sessionsView
  };
});

onMounted(loadAll);
</script>

<style scoped>
/* ---------- 布局 ---------- */
/* 页面宽度对齐原型：≥1024 档 1140、≥1440 档 1260（newui 921-935） */
.dash__main {
  max-width: 1140px; margin: 0 auto;
  padding: 22px 28px 40px;
  display: grid; gap: 16px;
}
@media (min-width: 1440px) {
  .dash__main { max-width: 1260px; }
}
/* 问候行：两行结构（21px 问候 + 12.5px 日期行），右侧琥珀 streak 药丸 */
.greet { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 2px 0; }
/* min-width: 0：让日期行的省略号接管「排不下」——副标 inline 续写在后面，
   整行 nowrap，排不下时截断而不是把 streak 药丸顶出首屏 */
.greet__main { display: grid; gap: 3px; min-width: 0; }
/* 视觉主标题（原 strong，P3-39 升 h1）：h1 默认 margin 清零，字号字重沿用原 21px/800 不变 */
.greet__main .greet__headline { margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -0.01em; color: var(--ink); }
.greet__date {
  font-size: 12.5px; color: var(--faint);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.streak {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  font-size: 12px; font-weight: 700; color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 34%, transparent);
  padding: 7px 11px; border-radius: var(--mk-radius-pill);
}
.streak--off {
  color: var(--faint);
  background: color-mix(in srgb, var(--faint) 10%, transparent);
  border-color: color-mix(in srgb, var(--faint) 28%, transparent);
}

/* ---------- AI 提示条 ---------- */
/* 底改纯色（原型 wf-tip 319-333）：蓝→青渐变底退役，1px 蓝弱边 + 6% 蓝底 */
.tip {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 11px 12px;
  border-radius: var(--mk-radius-lg);
  border: 1px solid color-mix(in srgb, var(--blue) 16%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
}
/* 图标：去掉白色阴影盒，直接着紫（v2 的紫 token 别名是 --accent = --mk-purple） */
.tip__icon { color: var(--accent); flex: none; display: grid; place-items: center; margin-top: 1px; }
.tip p { margin: 0; flex: 1; min-width: 0; font-size: 13px; line-height: 1.55; color: var(--ink); }
/* 关闭钮：视觉 28px（原型 wf-tip__close）；padding 8 把点击热区扩到 44×44，
   background-clip 让 hover 底只画在 28px 内容盒里 */
.tip__close {
  box-sizing: content-box; width: 28px; height: 28px; padding: 8px;
  background-clip: content-box;
  border: 0; background-color: transparent;
  display: grid; place-items: center;
  margin: -8px -8px 0 0;
  color: var(--faint); font-size: 19px; line-height: 1; cursor: pointer;
  border-radius: var(--mk-radius-md);
}
.tip__close:hover { background-color: color-mix(in srgb, var(--line) 55%, transparent); }

/* ---------- AI 提示（页脚上方） ---------- */
/* wrapper 用 margin-top:auto 沉底；内部是普通 block 流，footer 的 margin-top:auto 不生效 */
.dash__foot {
  margin-top: auto;
}
.dash__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.dash__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }

/* ---------- 卡片基座 ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--shadow-sm);
}
.card-head { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
/* .link-muted 全页唯一基础定义：多个 router-link 渲染成 <a>，须自带去下划线 */
.link-muted { font-size: 13px; font-weight: 600; color: var(--faint); cursor: pointer; text-decoration: none; padding: 5px 0; transition: color 0.15s ease; }
.link-muted:hover { color: var(--blue-deep); }

/* ---------- 今日预算（多目标调度台账） ---------- */

/* 今日安排（批17）：预算+复习合成一张连续分区卡，组间用细分隔线，不再两张卡叠放 */
.agenda { padding: 16px 18px; display: grid; gap: 10px; }
.agenda__head { display: flex; align-items: baseline; gap: 10px; }
.agenda__head strong { font-size: 15px; font-weight: 700; }
.agenda__meta { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
.agenda__group { font-size: 12px; font-weight: 800; letter-spacing: 0.04em; color: var(--muted); }
.agenda__divider { height: 1px; background: var(--line); margin: 2px 0; }
.agenda__fail { font-size: 13px; color: var(--muted); }
.agenda__retry {
  border: 0; background: none; padding: 0; font: inherit; font-weight: 700;
  color: var(--blue-deep); cursor: pointer;
}
.agenda__retry:hover { text-decoration: underline; }
/* 原型 wf-budget（365-373 / 1620-1629）：第一行 名称·认知度·数字，第二行独立进度条 */
.budget__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 11px; }
.budget__item { display: grid; gap: 6px; font-size: 13px; }
.budget__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.budget__link { text-decoration: none; color: inherit; }
.budget__link:hover { opacity: 0.8; }
.budget__link:hover .budget__name { color: var(--blue); }
.budget__name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.budget__bw {
  flex: none; padding: 1px 7px; border-radius: var(--mk-radius-xs);
  background: color-mix(in srgb, var(--green) 10%, transparent);
  color: var(--green-ink); font-size: 12px; font-weight: 600; white-space: nowrap;
}
.budget__num { flex: none; color: var(--faint); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* 进度条：6px + 蓝→青渐变（原实色 #10b981 已退役） */
.budget__bar { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--line) 60%, transparent); overflow: hidden; }
.budget__bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }

/* ---------- 今日复习（2026-09-27 收敛为单行计划条） ----------
   原 16 项逐条列表 + 强度条 + 五种数字口径的样式整体退役；
   学习台只说「会发生什么 + 去上课」，明细归学习状态页。 */
.review__plan {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: var(--mk-radius-md);
  background: color-mix(in srgb, var(--blue) 4%, var(--surface));
}
.review__plan-body { display: grid; gap: 3px; min-width: 0; }
.review__plan-body strong { font-size: 14px; color: var(--ink); }
.review__plan-body span { font-size: 12.5px; color: var(--muted); }

/* ---------- 主区 ---------- */
/* 列比对齐原型：等分双列（原 1.55fr / 1fr）+ 16px gap */
.dash__grid-main {  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}
.action {
  padding: 16px;
  display: flex; flex-direction: column; gap: 10px;
  position: relative; overflow: hidden;
}
/* 新手空态卡：占满双列（右侧占位卡已删，走查 2026-09-27 冗余项）；
   紧凑化，避免空态内容把页脚挤出首屏 */
.action--empty {
  grid-column: 1 / -1;
  padding: 16px;
  gap: 9px;
}
/* 空态图标盘（原型 wf-empty__art 1376-1381）：66px 圆角盘 + 30px 图标 */
.action__art {
  width: 66px; height: 66px;
  border-radius: 16px; /* 圆角阶梯：空态图标底 */
  display: grid; place-items: center;
  background: color-mix(in srgb, var(--surface) 92%, var(--ink));
  color: var(--blue);
}
.action::before {
  content: ''; position: absolute; inset: 0 auto 0 0; width: 4px;
  background: linear-gradient(180deg, var(--blue), var(--accent));
}
.action--alert::before { background: linear-gradient(180deg, var(--red), var(--amber)); }
.action--empty::before { background: linear-gradient(180deg, var(--cyan), var(--blue)); }
.action__eyebrow {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; font-weight: 800; letter-spacing: 0.06em; color: var(--blue-deep);
}
.action__eyebrow--alert { color: var(--red-ink); }
/* 出处说明（Vue 多于原型）：留在 eyebrow 左侧，排不下时省略 */
.action__from {
  font-weight: 600; letter-spacing: 0; color: var(--faint);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 阶段标签挪到 head 右侧单行（原型 wf-action__tag 339 / 1573） */
.action__tag {
  margin-left: auto; flex: none;
  font-size: 12px; font-weight: 600; color: var(--faint);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.action__title { margin: 0; font-size: 19px; line-height: 1.35; letter-spacing: -0.01em; }
.action__desc { margin: 0; font-size: 14px; line-height: 1.7; color: var(--muted); max-width: 56ch; }
/* 今日行动的说明可能很长（用户自己的任务描述），两行封顶：
   只在这一处夹，状态类文案（生成中/失败/空态）不夹，别把「你也可以先去别的页面看看」切掉 */
.action__desc--task {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
/* 行动卡提示行：原型 wf-action__note 纯文字行（图标 + 12.5px 蓝字），无底无框 */
.action__reason {
  display: flex; align-items: flex-start; gap: 6px;
  margin: 2px 0 0;
  font-size: 12.5px; line-height: 1.5;
  color: var(--blue-deep);
}
.action__reason svg { width: 13px; height: 13px; flex: none; margin-top: 2px; }
.action__reason span { min-width: 0; }
.action__meta { display: flex; gap: 8px; flex-wrap: wrap; }
.tag {
  padding: 5px 11px; border-radius: var(--mk-radius-pill);
  background: var(--line); border: 1px solid var(--line);
  font-size: 12px; font-weight: 600; color: var(--muted);
}
.tag--blue { background: color-mix(in srgb, var(--blue) 9%, transparent); border-color: color-mix(in srgb, var(--blue) 30%, transparent); color: var(--blue-deep); }
.tag--cyan { background: color-mix(in srgb, var(--cyan) 12%, transparent); border-color: color-mix(in srgb, var(--cyan) 35%, transparent); color: var(--cyan-ink); }
.tag--red { background: color-mix(in srgb, var(--wf-color-danger) 10%, transparent); border-color: color-mix(in srgb, var(--wf-color-danger) 35%, transparent); color: var(--red-ink); }
.action__footer { display: flex; align-items: center; gap: 12px; margin-top: auto; flex-wrap: wrap; }
/* 行动卡 foot（原型 wf-action__foot 345-349）：grid，今日进度行在按钮行**上方**。
   P1-6（2026-10-04）：轨道必须显式 minmax(0,1fr)——隐式 auto 轨道按子项 max-content
   定尺，今日进度行的 nowrap 文案会把轨道撑到 465px 溢出 390 视口（「去处理」随之
   落到屏外不可点），子项的收缩/省略在无约束轨道下永远不触发。 */
.action__foot { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: auto; }
.action__actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: var(--mk-radius-xl);
  /* 实色主按钮：蓝渐变与 30% 蓝色发光投影一并退役（按钮不承担层级，用留白表达） */
  background: var(--blue);
  color: var(--text-on-primary); font-size: 14px; font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease;
}
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-ghost {
  padding: 10px 18px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface);
  font-size: 14px; font-weight: 700; color: var(--muted); cursor: pointer;
}
.action__today { display: flex; align-items: center; gap: 10px; min-width: 0; }
/* P1-6（2026-10-04）：span 须可收缩（flex-shrink+min-width:0+ellipsis），否则 nowrap 文案
   在 390 视口把整行撑出屏（实测溢出 107px、「去处理」按钮落在屏外不可点） */
.action__today span { font-size: 12px; color: var(--faint); white-space: nowrap; font-variant-numeric: tabular-nums; flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 调控提醒位（2026-09-27）：有要拍板的调整时在行动卡就地露头，蓝色弱底不抢主 CTA */
.action__control {
  display: flex; align-items: center; gap: 7px;
  max-width: 100%;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--blue) 28%, transparent);
  border-radius: var(--mk-radius-lg, 12px);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  font-size: 12.5px; color: var(--muted);
  text-decoration: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.action__control:hover { border-color: color-mix(in srgb, var(--blue) 50%, transparent); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.action__control > svg { color: var(--amber-ink); flex: 0 0 auto; }
.action__control-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.action__control b { color: var(--blue-deep); font-weight: 800; white-space: nowrap; }
.action__today-bar { flex: 1; min-width: 0; height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--line) 55%, transparent); overflow: hidden; }
.action__today-bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.action__examples { display: flex; gap: 8px; flex-wrap: wrap; }
.example {
  padding: 9px 14px; border-radius: var(--mk-radius-xl);
  border: 1px dashed color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 5%, transparent);
  color: var(--blue-deep); font-size: 13px; font-weight: 600; cursor: pointer;
}

/* ---------- 路径进度卡 ---------- */
.path { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.path__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.path__title strong { font-size: 16px; }
.path__sub { display: block; margin-top: 3px; font-size: 12px; color: var(--faint); }
.badge { padding: 4px 10px; border-radius: var(--mk-radius-pill); font-size: 12px; font-weight: 800; }
.badge--blue { color: var(--blue-deep); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.badge--red { color: var(--red-ink); background: color-mix(in srgb, var(--wf-color-danger) 12%, transparent); }
/* 页脚吸底：.dash__grid-main 是 stretch，路径卡会被拉到与左侧行动卡等高；
   内容都堆在顶部时卡底会留出大片空白（2026-10-08 视觉检查：约三分之一卡高）。
   让分隔线+进度条沉到卡底，空白变成正常的卡脚留白。 */
.path__foot { border-top: 1px solid var(--line); padding-top: 12px; display: grid; gap: 8px; margin-top: auto; }
.path__progress { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--line) 55%, transparent); overflow: hidden; }
.path__progress i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.path__nums { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
</style>

<style scoped>
/* ---------- 本周节奏 ---------- */
.dash__grid-week { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.week { padding: 16px 20px; display: grid; gap: 12px; align-content: start; }
.week__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.day {
  display: grid; gap: 4px; justify-items: center;
  padding: 6px 0 4px;
  border-radius: var(--mk-radius-xl); border: 1px solid transparent;
  background: transparent; font: inherit; cursor: pointer;
  transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}
.day:hover { background: color-mix(in srgb, var(--blue) 6%, var(--surface)); }
.day--today { border-color: color-mix(in srgb, var(--blue) 45%, transparent); background: color-mix(in srgb, var(--blue) 5%, transparent); }
.day--selected { border-color: var(--blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 12%, transparent); }
/* label 与分钟同走一档微字：原为 11px，规则 16 收口到 12px 下限（原棘轮槽位释放） */
.day__label, .day__min { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
.day__label { font-weight: 700; }
.day__cell {
  width: 30px; height: 30px; border-radius: var(--mk-radius-lg);
  display: grid; place-items: center;
  font-size: 12px; font-weight: 800;
  background: color-mix(in srgb, var(--line) 55%, transparent); color: var(--muted);
}
.day__min { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } /* 脏数据（如单日 1622 分）不破格 */
/* 热力色阶（原型 394-396）：基础档 = line 弱底，h1 14% / h2 32% / h3 实色蓝 */
.day__cell--h1 { background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue-deep); }
.day__cell--h2 { background: color-mix(in srgb, var(--blue) 32%, transparent); color: var(--blue-deep); }
.day__cell--h3 { background: var(--blue); color: var(--text-on-primary); }
.week__empty {
  padding: 26px 0; text-align: center; color: var(--faint); font-size: 13px;
  border: 1px dashed var(--line); border-radius: var(--mk-radius-xl); background: color-mix(in srgb, var(--surface) 70%, var(--canvas));
}
/* 区块级数据源失败提示（区别于空态：失败可见，不伪装成无数据） */
.dash__source-fail {
  padding: 14px 16px;
  font-size: 12.5px; line-height: 1.6;
  color: var(--muted);
  background: color-mix(in srgb, var(--amber) 8%, transparent);
  border: 1px dashed color-mix(in srgb, var(--amber) 35%, transparent);
  border-radius: var(--mk-radius-lg);
}
.dash__source-retry {
  margin-left: 8px; padding: 6px 12px;
  font-size: 12px; font-weight: 700; color: var(--blue-deep);
  background: none; border: 1px solid color-mix(in srgb, var(--blue) 35%, transparent);
  border-radius: var(--mk-radius-pill); cursor: pointer;
}
.dash__source-retry:hover { background: color-mix(in srgb, var(--blue) 8%, transparent); }
.week__stats { display: flex; gap: 18px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.week__stats b { color: var(--ink); }

/* ---------- 激励小卡 ---------- */
/* 激励行（批17）：原 side-stack 两张 mini 卡压平为周节奏卡内的两行提示 */
.week__notes { display: grid; gap: 6px; border-top: 1px dashed var(--line); padding-top: 10px; }
.week__note {
  margin: 0; display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; color: var(--muted);
}
.week__note svg { flex-shrink: 0; color: var(--amber); }
.week__note--achv svg { color: var(--accent); }

/* ---------- 月度摘要（整月日历的替位：原型 1659 一行摘要） ----------
   整月日历卡（月导航/7 列网格/图例/右侧当日明细）整体移交学习历史页，
   这里只留一行统计 + 「全部历史 ›」入口。 */
.month-summary {
  margin-top: 4px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px;
  font-size: 12.5px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.month-summary__more {
  margin-left: auto;
  font-weight: 700; color: var(--blue-deep);
  text-decoration: none; white-space: nowrap;
}
.month-summary__more:hover { text-decoration: underline; }

/* ---------- 响应式 ---------- */
@media (max-width: 1100px) {
  /* 单列轨道用 minmax(0,1fr) 而非 1fr：1fr = minmax(auto,1fr)，下限仍是内容 min-content，
     折叠区里的 nowrap 内容会顺着这条链把整页顶宽（展开态 390→538px、居中按钮被迫右移）。 */
  .dash__grid-main, .dash__grid-week { grid-template-columns: minmax(0, 1fr); }
  /* 卡内标题按基线收到 14px——16px 比路径页卡标题（用户点过名的 15.5px 档）还大一档 */
  .action__title { font-size: 14px; line-height: 1.4; }
  .dash__main { padding: 16px 14px 32px; }
  .greet { flex-direction: column; align-items: flex-start; gap: 8px; }
}
</style>

<style scoped>
/* ---------- 交互补充 ---------- */
a.btn-primary { text-decoration: none; }
.example { text-decoration: none; }

.action__eyebrow--rest { color: var(--faint); }

</style>

<style scoped>
.dash__loading { display: grid; justify-items: center; padding: 64px 0; }
.badge--green { color: var(--green-ink); background: color-mix(in srgb, var(--wf-color-success) 12%, transparent); }
.badge--cyan { color: var(--cyan-ink); background: color-mix(in srgb, var(--cyan) 14%, transparent); }
/* 原型 wf-pathcard__foot .wf-btn--link（361）：左对齐的纯文字 link，
   分隔线只由 .path__foot 提供一条，本元素不再自带 border-top */
.path__detail-link {
  font-size: 12.5px; font-weight: 700; color: var(--blue-deep);
  text-decoration: none; justify-self: start;
}
.path__detail-link:hover { text-decoration: underline; }
.dash__main { width: 100%; }
</style>

<style scoped>
/* 副标降级进日期行：只管字号与颜色，省略号由 .greet__date 承担（见布局块） */
.greet__sub { font-size: 12px; color: var(--faint); }
/* 分级底色（Vue 多于原型的部分）：与 .tip 一致走纯色，不再用渐变 */
.tip--recover { border-color: color-mix(in srgb, var(--accent) 28%, transparent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.tip--recover .tip__icon { color: var(--accent); }
.tip--warn { border-color: color-mix(in srgb, var(--amber) 30%, transparent); background: color-mix(in srgb, var(--amber) 9%, transparent); }
.tip--warn .tip__icon { color: var(--amber); }
.tip--attention { border-color: color-mix(in srgb, var(--red) 25%, transparent); background: color-mix(in srgb, var(--red) 7%, transparent); }
.tip--attention .tip__icon { color: var(--red-ink); }
</style>

<style scoped>
/* 超长机器生成标题：两行截断（.pcard__title/.hero h1 是旧版遗留选择器，已随卡片退役） */
.path__title strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

<style scoped>
/* ---------- 当天学习复盘抽屉 ---------- */
.sheet-mask {
  position: fixed; inset: 0; z-index: 80;
  background: var(--wf-overlay);
  /* 批次 D（2026-10-02）：backdrop-filter: blur(2px) 已删。
     模态遮罩的职责是「压暗并隔断下层」，32% 的墨色已经做到这点；
     2px 的模糊在任何屏幕上都几乎看不出，却要为此付一次全屏合成开销，
     且在暗色主题下会让遮罩内容轻微发糊。规范材质一律平面。 */
  display: flex; justify-content: flex-end;
}
.sheet {
  width: min(480px, 100%);
  height: 100%;
  background: var(--canvas);
  border-left: 1px solid var(--line);
  box-shadow: var(--mk-shadow-pop); /* 抽屉并入弹层档（规范 §0.5：X 向偏移第四档退役） */
  display: flex; flex-direction: column;
}
.sheet__head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 18px 20px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.sheet__date { font-size: 12px; font-weight: 700; color: var(--faint); }
.sheet__headline { margin: 4px 0 0; font-size: 18px; letter-spacing: -0.01em; }
.sheet__head-right { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.sheet__zone { font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: var(--mk-radius-pill); white-space: nowrap; }
.sheet__zone--low { color: var(--cyan-ink); background: color-mix(in srgb, var(--cyan) 14%, transparent); }
.sheet__zone--mid { color: var(--amber); background: color-mix(in srgb, var(--amber) 15%, transparent); }
.sheet__zone--high { color: var(--purple-ink); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.sheet__zone--none { color: var(--faint); background: var(--canvas); }
.sheet__close {
  width: 30px; height: 30px; border-radius: 8px; /* 圆角阶梯：控件 */
  display: grid; place-items: center;
  color: var(--faint); font-size: 16px; cursor: pointer;
  border: 1px solid var(--line); background: var(--surface);
}
.sheet__close:hover { color: var(--ink); }

.sheet__scroll {
  flex: 1; overflow-y: auto;
  padding: 16px 18px 28px;
  display: grid; gap: 14px;
  align-content: start;
}
.sheet__summary {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.sheet__summary > div {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px; /* 圆角阶梯：面板 */
  padding: 11px 13px;
  display: grid; gap: 3px;
}
.sheet__summary-wide { grid-column: 1 / -1; }
.sheet__summary small { font-size: 12px; color: var(--faint); font-weight: 700; }
.sheet__summary strong { font-size: 14px; line-height: 1.4; }
.sheet__block {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px; /* 圆角阶梯：面板 */
  padding: 14px 16px;
  display: grid; gap: 10px;
}
.sheet__block h4 { margin: 0; font-size: 13px; }
.sheet__block p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.7; }
.sheet__empty {
  font-size: 13px; color: var(--faint);
  border: 1px dashed var(--line); border-radius: var(--mk-radius-xl);
  padding: 18px 14px; text-align: center;
  background: color-mix(in srgb, var(--surface) 70%, var(--canvas));
}

/* ---------- 会话卡 ---------- */
.scard {
  border: 1px solid var(--line);
  border-radius: 12px; /* 圆角阶梯：面板 */
  padding: 13px 14px;
  display: grid; gap: 9px;
  background: color-mix(in srgb, var(--surface) 80%, var(--canvas));
}
.scard + .scard { margin-top: 4px; }
.scard__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.scard__title { min-width: 0; display: grid; gap: 3px; }
.scard__title strong { font-size: 13.5px; line-height: 1.45; }
.scard__title small { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
.scard__duration {
  flex: 0 0 auto;
  font-size: 12px; font-weight: 800; color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 9%, transparent);
  padding: 4px 10px; border-radius: var(--mk-radius-pill);
  white-space: nowrap;
}
.scard__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: 12px; font-weight: 700;
  padding: 3px 9px; border-radius: var(--mk-radius-pill);
  background: var(--canvas); color: var(--muted);
}
.chip--blue { color: var(--blue-deep); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.chip--cyan { color: var(--cyan-ink); background: color-mix(in srgb, var(--cyan) 14%, transparent); }
.chip--purple { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.scard__confuse {
  font-size: 12px; color: var(--amber); font-weight: 600;
  background: color-mix(in srgb, var(--amber) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 28%, transparent);
  border-radius: 8px; /* 圆角阶梯：控件 */
  padding: 7px 10px;
  line-height: 1.55;
}
.scard__stages { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.scard__stage {
  font-size: 12px; font-weight: 700; color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 20%, transparent);
  padding: 3px 8px; border-radius: var(--mk-radius-pill);
}
.scard__stage-sep { color: var(--faint); font-size: 12px; }
.scard__toggle {
  justify-self: start;
  border: 0; background: transparent;
  color: var(--faint);
  font: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; padding: 0;
}
.scard__toggle:hover { color: var(--blue-deep); }
.scard__events {
  list-style: none; margin: 0; padding: 8px 0 0;
  border-top: 1px dashed var(--line);
  display: grid; gap: 7px;
}
.scard__events li {
  display: grid; grid-template-columns: 44px 1fr; gap: 8px;
  font-size: 12px; line-height: 1.55; color: var(--muted);
}
/* 时间列不再自写 11px：规则 16 的 <12px 棘轮本文件只留 1 个槽位（已给周格 label/分钟），
   随 .scard__events li 继承 12px */
.scard__event-time { color: var(--faint); font-variant-numeric: tabular-nums; padding-top: 2px; }

/* 抽屉动画 */
.sheet-enter-active, .sheet-leave-active { transition: opacity .22s ease; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .24s cubic-bezier(0.32, 0.72, 0.24, 1); }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateX(40px); }

/* 移动端：底部弹层 */
@media (max-width: 640px) {
  .sheet-mask { align-items: flex-end; }
  .sheet {
    width: 100%; height: auto; max-height: 86vh;
    border-left: 0;
    border-top: 1px solid var(--line);
    border-radius: 16px 16px 0 0; /* 圆角阶梯：弹层 */
  }
  .sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(60px); }
}
</style>

<style scoped>
/* 移动端防横向溢出 */
.action__eyebrow { flex-wrap: wrap; row-gap: 4px; }
.action__from { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 1100px) {
  /* greet__sub 已降级成日期行里的 inline 续写（.greet__date 承担 nowrap 省略号），
     原「独占一行 + line-clamp」的移动端覆写随之退役——父级是 inline span，
     display:-webkit-box 会在 nowrap 行里另起一块，反而把日期行撑破 */
  .action__title { overflow-wrap: anywhere; }
}
</style>

<style scoped>
/* 移动端：本周条 7 列收缩适配窄屏
   节奏区改常显（2026-09-27）后 .day 进入 mobile:spec 口径：375 下 7 列每格
   只有 ~44px 宽，格子高度不足 44——按「日历格子属次级交互」的分级口径补
   min-height ≥44 并垂直铺满（手势目标=整格），格子视觉（28px 数字块）不变。 */
@media (max-width: 1100px) {
  .week { padding: 16px 14px; }
  .week__grid { gap: 5px; }
  .day { padding: 6px 2px 8px; min-height: 44px; align-content: space-between; }
  /* 字号不随窄屏下调：基座 12px 已是下限（密度块另有 12px 兜底），缩的只有格子 */
  .day__cell { width: 28px; height: 28px; border-radius: var(--mk-radius-md); }
}
</style>

<style scoped>
/* ---------- 暗色模式覆写 ----------
   底色类元素（进度条轨道 / zone 空档 / chip）已直引 var(--line)/var(--canvas) 等令牌，
   随主题自动翻转，原 rgba(230,237,247,…) 暗色覆写整块退役。 */
</style>

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据：卡片内边距 12–16px、大留白（空态/加载）≤32px、移动端规则不写 <12px。
   实测 390 下：.action 22×26（首屏最大一块，403px 高）、.path 20×22（542px）、加载态 64px。
   必须放在文件末尾：同权重下后出现者胜，写进前面那个移动块会被它后面的基础规则吃掉。
   断点取 1100，与底部 tab 条一致（见 v2.css 里 901~1100 段的说明）。
   不动的：.badge/.quick__body small 这类桌面本来就是 11–11.5px 的微标签——单方面放大后
   手机上同一个元素比桌面还大，而且卡片会变高，与密度目标相反。 */
@media (max-width: 1100px) {
  /* 卡内节奏同步收：内边距基座已是 16（横向再由下面的「归一」规则锁 16），移动端
     余下的开销只有 gap（行动卡 10 / 路径卡 14）与页脚按钮行的 12 */
  .action { gap: 8px; }
  .action--empty { padding: 14px 16px; }
  .action__footer { gap: 8px; }
  /* 调控提醒行是触屏上的跳转入口，抬到 44 触控带（mobile:spec lt44 口径） */
  .action__control { min-height: 44px; }
  .path { padding: 14px 16px; gap: 12px; }
  .path__title strong { font-size: 14px; }
  .week__empty { padding: 18px 0; }
  .dash__loading { padding: 32px 0; }
  .sheet__head { padding: 14px 16px 12px; }
  .sheet__scroll { padding: 12px 14px 20px; }
  /* 30px 对拇指偏小（贴弹层右上角、周边无别的手势目标），抬到 36px */
  .sheet__close { width: 36px; height: 36px; }
  /* 桌面 12px、移动块里被压到 11px —— 移动端规则自己写到了下限以下，抬回 12px */
  .day__cell { font-size: 12px; }
}

/* ---------- ≤1100 密度补齐（2026-09-25 移动框架批8） ----------
   budget/review 已并入「今日安排」单卡（批17），移动密度走 .agenda。
   预算行基座已按原型改成「第一行 名称+带宽+数值 / 第二行 通栏进度条」两行结构——
   375 下进度条被压到 ~41px 是旧单行表格布局的问题，原来的 grid-areas 转卡随基座
   改版一并退役；移动端只剩两件事：行高抬到 44 触控带、名称保持省略号不破格。 */
@media (max-width: 1100px) {
  .agenda { padding: 14px; }
  .budget__item { min-height: 44px; }
  .budget__link { min-height: 44px; }
  .budget__name { min-width: 0; }
  .budget__bar { width: 100%; }

  /* ── 卡内边距归一（2026-09-26 用户侧对齐走查）─────────────────────────
     .card 基座（1414 行）只给背景/边框/圆角/阴影，内边距一直是每张卡自己写，
     移动块再各覆盖一次：.action 18 / .path 16 / .agenda 14。三张同宽全宽卡堆在
     同一列里，内容左缘落在 33/31/29 三条轨道上——眼睛看到的不是「某张卡留白不对」，
     而是「这几张卡没对齐」，比差 8px 更刺眼。
     统一到 16（本页多数派，也落在「大卡 16」的密度口径内），只动横向：竖向内边距
     是行间节奏、不是对齐轨道，不动。 */
  .dash__main .card,
  .dash__main .tip {
    padding-left: 16px;
    padding-right: 16px;
  }

  /* ── 手势目标补齐到 40px（LY17：下两处 375 实测 36–38）──────────────────
     只加最小高度与居中，不动字号与视觉。 */
  .link-muted {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
  }
  .path__detail-link {
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

/* ── P2-22（2026-10-04 全站设计评审）：「今天休息」触控 36px→44px ──────────────────
   复核实测：移动 390 该钮 h=36.0（同排主按钮 44.0、顶差 4px），桌面 1600 反而更差
   h=31.8——36px 的 min-height 原本只写在上面的 ≤1100 媒体查询里，媒体查询外没有兜底。
   基础样式（媒体查询外）+ 独立 .action__rest 类补齐 inline-flex/44px/垂直居中，
   与同排 44px 主按钮垂直对齐（.action__actions 已是 align-items:center，补高后自然对齐）；
   置于媒体查询块之后，同特异性下按文档顺序赢过上面 .link-muted 的 36px 档。 */
.action__rest {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
</style>
