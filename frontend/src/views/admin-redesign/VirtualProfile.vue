<template>
  <div v-if="detailError" class="mk-page vp">
    <MkEmptyState
      icon="◌"
      title="画像加载失败"
      description="暂时无法获取该虚拟学习者的画像与故事池。"
      action-text="重试"
      @action="loadDetail(subPage?.id)"
    />
  </div>
  <div v-else-if="d" class="mk-page vp">
    <header class="mk-entity mk-entity--flat">
      <button type="button" class="mk-back" @click="closeSubPage">← 虚拟学习者</button>
      <div class="mk-entity__main">
        <span class="mk-entity__avatar mk-entity__avatar--round" :class="avatarClassOf(d.name)" aria-hidden="true">{{ d.name.slice(0, 1) }}</span>
        <div class="mk-entity__name-row">
          <h1 class="mk-entity__name mk-entity__name--lg">{{ d.name }}</h1>
          <!-- 生命周期状态（无活动会话/运行中…）：身份信息，与名字同行；操作行只留可点按钮 -->
          <span v-if="isLive" class="vp-life" :class="`vp-life--${lifeTone}`" :title="lifeHint">
            <span class="vp-life__dot" aria-hidden="true"></span>{{ lifeLabel }}
          </span>
          <span v-if="d.archetype" class="mk-badge mk-badge--info">{{ d.archetype }}</span>
          <span v-if="levelLabel" class="vp-top__level">{{ levelLabel }}</span>
          <span v-if="goalText" class="vp-top__goal" :title="'长期倾向：影响模拟行为与学习需求'">{{ goalText }}</span>
          <!-- 仿真质量徽章：只在已评估时显示（「未评估」灰标是空态噪声，详见画像 tab） -->
          <span
            v-if="isLive && (qualityReferee || qualityFidelity)"
            class="vp-quality"
            :class="qualityTone"
            :title="qualityTitle"
          >{{ qualityReferee ? `质量 ${qualityReferee}` : '质量 —' }}<template v-if="qualityFidelity"> · 保真 {{ qualityFidelity }}</template><span class="vp-quality__time">{{ qualityTime }}</span></span>
        </div>
        <!-- 头部只留身份信息（状态 + 属性 pill）；全部操作收进下方统一操作台，见 vp-toolbar -->
      </div>
    </header>

    <!-- 详情接口失败但有列表兜底：明确提示，避免静默降级 -->
    <div v-if="fallbackNotice" class="vp-fallback">
      <span>详情加载失败，正在展示列表缓存数据</span>
      <button type="button" class="mk-link" @click="loadDetail(subPage?.id)">重试</button>
    </div>


    <!-- 分页：故事池是主工作区，画像/运行/验收各归其页（数量即 tab 角标，不再单设 KPI 行） -->
    <div class="mk-pills vp-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
        <span v-if="t.count !== undefined" class="vp-tab__count">{{ t.count }}</span>
      </button>
    </div>

    <!-- 统一操作台：按钮不再散落（头部/卡头/卡片三处），按三类固定槽位集中
         左「主动作」每个 tab 一个高频动作 | 中「视图筛选」当前 tab 的过滤器 | 右「⋯ 管理」账号级低频 -->
    <div v-if="isLive" class="vp-toolbar">
      <template v-if="activeTab === 'stories'">
        <button
          type="button"
          class="mk-status__action"
          :class="{ 'mk-status__action--primary': !displayStories.length }"
          :disabled="storyBusy"
          :title="storySampleType === 'student'
            ? '生成传统学生故事（考试节点/课纲压力/作业情境/家长同伴环境）'
            : '用 AI 生成新的故事脚本（基于该虚拟人画像与指定领域），生成后可运行'"
          @click="generateStory"
        >
          {{ storyBusy ? '生成中…' : '生成故事' }}
        </button>
        <div class="vp-sample-pills" role="radiogroup" aria-label="故事样本类型">
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': storySampleType === 'general' }"
            @click="storySampleType = 'general'"
          >通用</button>
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': storySampleType === 'student' }"
            title="生成传统学生故事：考试节点/课纲压力/作业情境/家长与同伴环境"
            @click="storySampleType = 'student'"
          >传统学生</button>
        </div>
      </template>
      <button
        v-else-if="activeTab === 'memory'"
        type="button"
        class="mk-status__action"
        :disabled="memoryLoading"
        title="重新读取记忆池数据"
        @click="loadMemory(true)"
      >
        <MkLoading v-if="memoryLoading" inline /><template v-else>刷新</template>
      </button>

      <span class="vp-toolbar__spacer" aria-hidden="true"></span>

      <!-- 视图筛选：当前 tab 的过滤器（故事池生命周期 / 运行流水状态） -->
      <div v-if="activeTab === 'stories' && displayStories.length" class="vp-filters">
        <button
          v-for="opt in storyFilterOptions"
          :key="opt.key"
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': storyFilter === opt.key }"
          @click="storyFilter = opt.key"
        >
          {{ opt.label }} <span class="vp-filter-count">{{ opt.count }}</span>
        </button>
      </div>
      <div v-else-if="activeTab === 'runs'" class="vp-filters">
        <button
          v-for="opt in runFilterOptions"
          :key="opt.key"
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': runsFilter === opt.key }"
          @click="runsFilter = opt.key"
        >
          {{ opt.label }} <span class="vp-filter-count">{{ opt.count }}</span>
        </button>
      </div>

      <!-- 账号级低频操作集中入口 -->
      <div class="mk-menu">
        <button
          type="button"
          class="mk-menu__btn"
          aria-label="更多操作"
          aria-haspopup="menu"
          :aria-expanded="openMenu === 'ops'"
          title="更多操作：座舱 / 生命周期 / 账号自动学习 / 编辑画像"
          @click.stop="toggleMenu('ops')"
        >⋯</button>
        <div v-if="openMenu === 'ops'" class="mk-menu__pop" :style="popStyle" @click.stop>
          <button
            v-for="c in lifeControls"
            :key="c.key"
            type="button"
            class="mk-menu__item"
            :class="{ 'mk-menu__item--danger': c.tone === 'danger' }"
            :disabled="sessionBusy"
            :title="c.hint"
            @click="runLifeAction(c); closeMenu()"
          >{{ c.label }}</button>
          <div v-if="lifeControls.length" class="mk-menu__sep" aria-hidden="true"></div>
          <button type="button" class="mk-menu__item" title="账号自动学习：批量自动运行该虚拟人的全部故事/课程（独立于单个故事运行）" @click="closeMenu(); quickLearnOpen = true">账号自动学习</button>
          <button type="button" class="mk-menu__item" title="编辑画像与偏好：修改名称、长期倾向、知识水平、个性特质等" @click="closeMenu(); editOpen = true">画像与偏好</button>
        </div>
      </div>
    </div>

    <div class="vp-body">
        <section v-if="activeTab === 'profile'" class="mk-card vp-hero">
          <div class="vp-hero__body">
            <p class="vp-hero__story">{{ d.story || '暂无人物背景' }}</p>
            <div v-if="d.traits?.length" class="vp-traits">
              <span v-for="t in d.traits" :key="t" class="vp-trait">{{ t }}</span>
            </div>
            <div class="vp-goal">
              <span>长期倾向（可选）</span>
              <strong>{{ d.goal || '由故事产生当次学习需求' }}</strong>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'profile'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">画像字段</h3>
          </div>
          <div class="vp-profile">
            <div v-for="p in d.aiProfile" :key="p.label" class="vp-profile__row">
              <span>{{ p.label }}</span>
              <strong>{{ p.value }}</strong>
            </div>
          </div>
        </section>

        <!-- 运行预算：画像级持久配置（LLM 重试 + 回合上限 + 默认难度）；新会话创建时作为初始值，座舱可临时覆盖 -->
        <section v-if="activeTab === 'profile' && isLive" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">运行预算</h3>
            <span class="mk-card__meta">新会话默认值 · 座舱可临时覆盖</span>
          </div>
          <div class="vp-budget">
            <label class="mk-field" :class="{ 'mk-field--error': budgetErrors.maxRetriesPerStep }">
              <span class="mk-field__label">单步最大重试</span>
              <input v-model.number="budgetForm.maxRetriesPerStep" type="number" min="1" max="20" class="mk-field__input" @input="budgetDirty = true" />
              <span v-if="budgetErrors.maxRetriesPerStep" class="mk-field__err">{{ budgetErrors.maxRetriesPerStep }}</span>
              <span class="mk-field__hint">每次上游 LLM 调用失败后的重试次数（一个教学回合含多次上游调用）</span>
            </label>
            <label class="mk-field" :class="{ 'mk-field--error': budgetErrors.maxRetriesTotal }">
              <span class="mk-field__label">会话 AI 调用上限</span>
              <input v-model.number="budgetForm.maxRetriesTotal" type="number" min="1" max="1000" class="mk-field__input" @input="budgetDirty = true" />
              <span v-if="budgetErrors.maxRetriesTotal" class="mk-field__err">{{ budgetErrors.maxRetriesTotal }}</span>
              <span class="mk-field__hint">单个会话累计 AI 调用（含重试）达到上限即终止，防止无限跑下去；故事可单独覆盖</span>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">每课回合上限</span>
              <input v-model.number="budgetForm.turnCapPerLesson" type="number" min="1" max="100" class="mk-field__input" @input="budgetDirty = true" />
              <span class="mk-field__hint">每课自动推进的回合预算：座舱「自动推进本课 / 自动驾驶」的默认上限</span>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">默认难度</span>
              <select v-model="budgetForm.frictionBudget" class="mk-field__select" @change="budgetDirty = true">
                <option value="none">无</option>
                <option value="low">低</option>
                <option value="normal">正常</option>
                <option value="high">高</option>
                <option value="stress_test">压力测试</option>
              </select>
              <span class="mk-field__hint">新会话的默认难度（可在座舱按会话临时调整）</span>
            </label>
          </div>
          <div class="mk-card__foot">
            <span v-if="budgetSavedAt" class="mk-card__meta">已保存 · {{ budgetSavedAt }}</span>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="budgetSaving" @click="saveBudget">
              {{ budgetSaving ? '保存中…' : '保存预算' }}
            </button>
          </div>
        </section>

        <!-- 记忆池：这个虚拟学习者"记住了什么"（已掌握 / 到期复习 / 易混淆 / 最近完成事项） -->
        <section v-if="activeTab === 'memory'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">记忆池 · {{ memoryCount }}</h3>
            <span class="mk-card__meta">课后沉淀 · 学过的会被记住，快忘了的会显示为复习点</span>
            <!-- 刷新已上移至统一操作台「主动作」槽 -->
          </div>

          <MkLoading v-if="isLive && memoryLoading && !memoryData" text="正在读取记忆…" />

          <MkEmptyState
            v-else-if="isLive && memoryLoadFailed"
            tone="error"
            title="记忆池加载失败"
            description="暂时无法读取该虚拟学习者的记忆数据。"
            action-text="重试"
            compact
            @action="loadMemory(true)"
          />

          <MkEmptyState
            v-else-if="isLive && memoryEmpty"
            title="记忆池还是空的"
            description="完成课程后，学到的概念和做过的事会沉淀到这里。还没有学习记录时，记忆池为空是正常的。"
            compact
          />

          <template v-else>
            <!-- 概览 -->
            <div class="vp-memory__overview" v-if="!isLive || memoryData">
              <div class="vp-memory__stat">
                <strong>{{ memoryCounts.mastered }}</strong>
                <span>已掌握</span>
              </div>
              <div class="vp-memory__stat" :class="{ 'vp-memory__stat--warn': memoryCounts.dueReview > 0 }">
                <strong>{{ memoryCounts.dueReview }}</strong>
                <span>到期复习</span>
              </div>
              <div class="vp-memory__stat" :class="{ 'vp-memory__stat--warn': memoryCounts.struggling > 0 }">
                <strong>{{ memoryCounts.struggling }}</strong>
                <span>易混淆</span>
              </div>
              <div class="vp-memory__stat">
                <strong>{{ memoryCounts.completed }}</strong>
                <span>完成事项</span>
              </div>
            </div>

            <!-- 已掌握 -->
            <div v-if="memoryMastered.length" class="vp-memory__group">
              <div class="vp-memory__group-head">
                <h4 class="vp-memory__group-title">已掌握</h4>
                <span class="mk-card__meta">历次课后沉淀的概念</span>
              </div>
              <div class="vp-tags">
                <span v-for="m in memoryMastered" :key="m.name" class="vp-tag vp-tag--ok">{{ m.name }}</span>
              </div>
            </div>

            <!-- 到期复习点 -->
            <div v-if="memoryDueReview.length" class="vp-memory__group">
              <div class="vp-memory__group-head">
                <h4 class="vp-memory__group-title">到期复习点</h4>
                <span class="mk-card__meta">学过但快忘了 · 下一节课会以"旧知唤醒"回到课堂</span>
              </div>
              <div class="vp-memory__review">
                <div v-for="r in memoryDueReview" :key="r.name" class="vp-memory__review-item">
                  <span class="vp-tag vp-tag--warn">{{ r.name }}</span>
                  <span class="vp-memory__retention" :title="`保留率 ${Math.round(r.retention * 100)}%`">
                    保留 {{ Math.round(r.retention * 100) }}%
                  </span>
                </div>
              </div>
            </div>

            <!-- 记忆保持曲线（Q2/Q8）：到期 / 已掌握概念的保留率随天数衰减 -->
            <div v-if="memoryCurveConcepts.length" class="vp-memory__group">
              <div class="vp-memory__group-head">
                <h4 class="vp-memory__group-title">记忆保持曲线</h4>
                <span class="mk-card__meta">横轴＝距上次复习天数 · 纵轴＝预计还记得的比例</span>
              </div>
              <p class="vp-memory__curve-hint">
                老师下次会先带你回捞这些点：曲线越陡、当前保留越低，越优先回捞。
              </p>
              <div class="vp-memory__curve-legend">
                <span
                  v-for="(item, i) in memoryChartLegend"
                  :key="`mc-${i}-${item.name}`"
                  class="vp-memory__curve-legend-item"
                >
                  <i class="vp-memory__curve-dot" :style="{ background: item.color }" aria-hidden="true"></i>
                  <span class="vp-memory__curve-name" :title="item.name">{{ item.name }}</span>
                  <span class="vp-memory__curve-now" :class="{ 'is-due': item.due }">
                    现在 {{ item.currentPercent }}%<template v-if="item.elapsedDays > 0"> · 已过 {{ item.elapsedDays }} 天</template>
                  </span>
                </span>
              </div>
              <MkChart :option="memoryChartOption" height="240px" />
            </div>

            <!-- 易混淆 / 卡点 -->
            <div v-if="memoryStruggling.length" class="vp-memory__group">
              <div class="vp-memory__group-head">
                <h4 class="vp-memory__group-title">易混淆 / 卡点</h4>
                <span class="mk-card__meta">仍在学习或反复出问题的概念</span>
              </div>
              <div class="vp-tags">
                <span v-for="s in memoryStruggling" :key="s.name" class="vp-tag vp-tag--warn">{{ s.name }}</span>
              </div>
            </div>

            <!-- 最近完成事项（成果物） -->
            <div v-if="memoryCompleted.length" class="vp-memory__group">
              <div class="vp-memory__group-head">
                <h4 class="vp-memory__group-title">最近完成的事</h4>
                <span class="mk-card__meta">成果物 · 新故事生成时会延续这些</span>
              </div>
              <div class="vp-memory__completed">
                <div v-for="(c, ci) in memoryCompleted" :key="c.taskId || `mc-${ci}`" class="vp-memory__completed-item">
                  <span class="vp-memory__completed-dot" aria-hidden="true">✓</span>
                  <div class="vp-memory__completed-body">
                    <strong>{{ c.title }}</strong>
                    <span v-if="c.deliverable" class="vp-memory__deliverable">成果：{{ c.deliverable }}</span>
                    <span v-if="c.memoryDelta" class="vp-memory__delta" :title="`自评校准：${c.selfCalibration || '—'}`">
                      记忆：{{ c.memoryDelta }}
                    </span>
                    <span v-if="c.completedAt" class="mk-card__meta">{{ formatMemoryTime(c.completedAt) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </section>

        <section v-if="activeTab === 'stories'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">故事池 · {{ displayStories.length }}</h3>
            <!-- 筛选/生成/样本类型已上移至统一操作台；卡头只留对象级条件操作（勾选后批量） -->
            <div class="vp-stories-head">
              <!-- 批量操作（对齐一级页：勾选后批量运行/删除） -->
              <template v-if="isLive && displayStories.length">
                <label class="vp-story-select-all" :title="allStoriesSelected ? '取消全选' : '全选所有故事'">
                  <input type="checkbox" :checked="allStoriesSelected" @change="toggleAllStories" aria-label="全选故事" />
                  <span>已选 {{ selectedStoryKeys.size }}</span>
                </label>
                <button v-if="selectedStoryKeys.size" type="button" class="mk-btn mk-btn--sm mk-btn--primary" :disabled="running" title="为每个勾选的故事启动一次新的实验会话" @click="batchRunStories">批量运行</button>
                <button v-if="selectedStoryKeys.size" type="button" class="mk-btn mk-btn--sm" :disabled="storyBusy" title="对勾选故事的最新会话开启自动驾驶（不新建会话；已运行的自动跳过）" @click="batchAutopilotStories('start')">批量启动</button>
                <button v-if="selectedStoryKeys.size" type="button" class="mk-btn mk-btn--sm" :disabled="storyBusy" title="停止勾选故事最新会话的自动驾驶（学习进度保留）" @click="batchAutopilotStories('stop')">批量停止</button>
                <button v-if="selectedStoryKeys.size" type="button" class="mk-btn mk-btn--sm mk-btn--danger" :disabled="storyBusy" title="删除勾选的故事（不可恢复）" @click="batchRemoveStories">批量删除</button>
              </template>
            </div>
          </div>
          <!-- 空态三态：底层无故事 / 筛选无匹配（故事存在但过滤后为空） -->
          <MkEmptyState
            v-if="isLive && !stories.length"
            title="故事池为空"
            description="故事产生学习需求；点击「生成故事」由 AI 根据画像与倾向产出开场故事。"
            compact
          />
          <div v-else-if="isLive && !displayStories.length && storyFilter" class="vp-none">
            当前筛选无匹配
            <button type="button" class="mk-link" @click="storyFilter = ''">查看全部故事</button>
          </div>
          <div v-else-if="!isLive && !displayStories.length" class="vp-none">还没有故事。</div>
          <div v-if="displayStories.length" class="vp-stories">
            <div
              v-for="(s, i) in displayStories"
              :key="s.id || i"
              class="vp-story"
              :class="{ 'is-selected': selectedStoryId === (s.id || String(i)) }"
            >
              <!-- 列表行：checkbox 多选（不触发行）+ 点击行 = 选中 + 进入该故事会话座舱 -->
              <div
                class="vp-story__row"
                role="button"
                tabindex="0"
                :aria-pressed="selectedStoryId === (s.id || String(i))"
                :title="s.latestRun?.sessionId ? '进入该故事最新会话座舱' : '选中该故事；尚无会话，可点击「运行」启动'"
                @click="selectStory(s, i)"
                @keydown.enter.prevent="selectStory(s, i)"
                @keydown.space.prevent="selectStory(s, i)"
              >
                <label class="vp-story__checkbox" :class="{ 'is-checked': selectedStoryKeys.has(storyKey(s, i)) }" :title="selectedStoryKeys.has(storyKey(s, i)) ? '取消勾选' : '勾选（可批量运行/删除）'" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selectedStoryKeys.has(storyKey(s, i))"
                    :aria-label="`勾选 ${s.title}`"
                    @change="toggleStorySelect(s, i)"
                  />
                </label>
                <span class="vp-story__radio" aria-hidden="true"></span>
                <div class="vp-story__main">
                  <div class="vp-story__meta">
                    <strong class="vp-story__title">{{ s.title }}</strong>
                    <span class="mk-badge" :class="s.status === 'ready' ? 'mk-badge--ok' : 'mk-badge--muted'">
                      {{ storyStatusLabel(s) }}
                    </span>
                    <span v-if="storyBudgetBadge(s)" class="vp-story__budget-badge" :title="'故事级预算：' + storyBudgetBadge(s) + '；留空字段继承角色级'">预算自定义</span>
                  </div>
                  <p class="vp-story__outline" :title="s.outline">{{ s.outline || '暂无故事概述' }}</p>
                  <div class="vp-story__stats">
                    <span v-if="(s.runCount || 0) > 0" class="vp-story__stats-item" title="共运行的会话次数">运行 {{ s.runCount }} 次</span>
                    <span v-if="stageCountsText(s)" class="vp-story__stats-item" title="会话进度：目标对话 / 路径规划 / 教学回合 的累计会话数（0 段省略）">{{ stageCountsText(s) }}</span>
                    <!-- 双轴状态：生命周期徽章（轴 A）+ 阶段条（轴 B）；与一级页同源组件 -->
                    <template v-if="s.latestRun?.sessionId">
                      <RunStateBadge :status="storyRunState(s)" :hint="`${formatRunResult(s.latestRun?.status || '')} · ${timeAgo(String(s.latestRun?.updatedAt || s.latestRun?.createdAt || ''))}`" :pulse="false" />
                      <RunStageBar
                        :stage="s.latestRun?.currentStage || null"
                        :status="storyRunState(s)"
                        :task-progress="null"
                        :show-task-text="false"
                      />
                    </template>
                    <span v-else class="vp-story__latest">未运行</span>
                  </div>
                </div>
                <div class="vp-story__ops" @click.stop>
                  <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" :disabled="running" :title="'用这个故事启动一次新的实验会话（进入座舱）'" @click="runStory(s, i)">
                    {{ running ? '进行中…' : '▶ 运行' }}
                  </button>
                  <!-- 低频操作收进 ⋯ 菜单：卡片只留主操作「运行」 -->
                  <div class="mk-menu">
                    <button
                      type="button"
                      class="mk-menu__btn"
                      aria-label="更多故事操作"
                      aria-haspopup="menu"
                      :aria-expanded="openMenu === `story-${storyKey(s, i)}`"
                      title="编辑 / 删除故事"
                      @click.stop="toggleMenu(`story-${storyKey(s, i)}`)"
                    >⋯</button>
                    <div v-if="openMenu === `story-${storyKey(s, i)}`" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" :disabled="storyBusy" title="编辑故事：标题、概述、故事级预算（留空继承角色级）" @click="openEditStory(i); closeMenu()">编辑</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" :disabled="storyBusy" title="删除该故事（不可恢复）" @click="removeStory(i); closeMenu()">删除</button>
                    </div>
                  </div>
                </div>
                <span class="vp-story__chevron" aria-hidden="true">▸</span>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'timeline'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">日程 · 日期模拟</h3>
            <span class="mk-badge mk-badge--muted">{{ timelineSessionOptions.length }} 个会话</span>
          </div>
          <p class="vp-timeline__hint">
            按自然日聚合该会话的学习负担、学习状态、系统干预与难度调整（只读；数据源为已落地的学习状态聚合 / 温故配额 / 难度调整留痕）。日期模拟默认关闭，此处展示的是既有历史的自然日读数。
          </p>
          <p v-if="!timelineSessionOptions.length" class="vp-timeline__empty">
            暂无可查看的会话：该虚拟人还没有历史会话，先运行一次故事或账号自动学习。
          </p>
          <template v-else>
            <label class="mk-field vp-timeline__picker">
              <span class="mk-field__label">会话</span>
              <select v-model="timelineSessionId" class="mk-field__select">
                <option v-for="opt in timelineSessionOptions" :key="opt.sessionId" :value="opt.sessionId">{{ opt.label }}</option>
              </select>
            </label>
            <DayTimeline v-if="timelineSessionId" :session-id="timelineSessionId" :from="0" :to="29" />
          </template>
        </section>

        <section v-if="activeTab === 'runs'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">会话流水 · {{ allRuns.length }}</h3>
            <span class="mk-card__meta">按时间倒序 · 与故事池互补：那里按故事看，这里按会话发生时间看</span>
          </div>
          <p v-if="!allRuns.length" class="vp-none">还没有运行记录</p>
          <div v-else-if="!runRows.length" class="vp-none">
            当前筛选无运行
            <button type="button" class="mk-link" @click="runsFilter = ''">查看全部</button>
          </div>
          <div v-else class="vp-run-flow">
            <div v-for="g in runDayGroups" :key="g.key" class="vp-run-day">
              <div class="vp-run-day__label">{{ g.title }}</div>
              <div v-for="(r, i) in g.runs" :key="r.sessionId || `${r.stage}-${r.time}-${i}`" class="vp-run-row">
                <span class="vp-run-row__time mono">{{ runHm(r.createdAt) }}</span>
                <span class="vp-run-row__story" :title="r.storyTitle || '未关联故事'">{{ r.storyTitle || '未关联故事' }}</span>
                <RunStateBadge :status="r.result" :hint="`${formatRunResult(r.result)}${r.pathId ? ' · 关联学习路径' : ''}`" :pulse="false" />
                <RunStageBar
                  :stage="r.stage"
                  :status="r.result"
                  :task-progress="null"
                  :show-task-text="false"
                />
                <div v-if="isLive && r.sessionId" class="vp-run-row__ops">
                  <button type="button" class="mk-link" title="进入该会话的座舱：查看对话、推进/自动/暂停/终止等细粒度控制" @click="openSessionCockpit(r.sessionId)">打开座舱</button>
                  <button type="button" class="mk-link mk-link--danger" :disabled="sessionBusy" title="删除该会话（仅终态可删，不可恢复）" @click="removeSession(r.sessionId)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </section>
    </div>

    <QuickLearnPanel
      v-if="isLive && subPage?.id"
      v-model:visible="quickLearnOpen"
      :profile-id="subPage.id"
    />

    <!-- 编辑画像 -->
    <Teleport to="body">
    <div v-if="editOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="编辑画像">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">编辑画像</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="editOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': editErrors.name }">
            <span class="mk-field__label">名称</span>
            <input v-model="editForm.name" class="mk-field__input" />
            <span v-if="editErrors.name" class="mk-field__err">{{ editErrors.name }}</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">长期倾向（可选，非故事目标）</span>
            <input v-model="editForm.goal" class="mk-field__input" placeholder="可留空；当次需求来自故事" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">知识水平</span>
            <select v-model="editForm.level" class="mk-field__select">
              <option value="beginner">零基础</option>
              <option value="elementary">入门</option>
              <option value="intermediate">中级</option>
              <option value="advanced">进阶</option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">故事 / 备注</span>
            <textarea v-model="editForm.notes" class="mk-field__textarea" rows="4"></textarea>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="editOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="saving" @click="saveProfile">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- 编辑故事（P2-2 前端化：PUT /:id/stories/:storyIndex） -->
    <Teleport to="body">
    <div v-if="editStoryOpen" ref="storyMaskRef" class="mk-modal">
      <div ref="storyPanelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="编辑故事">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">编辑故事 · {{ editStoryForm.title || `故事 ${(editStoryIndex ?? 0) + 1}` }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="editStoryOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field">
            <span class="mk-field__label">标题</span>
            <input v-model="editStoryForm.title" class="mk-field__input" placeholder="故事标题（启动实验时展示）" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">场景（storyOutline）</span>
            <textarea v-model="editStoryForm.storyOutline" class="mk-field__textarea" rows="3" placeholder="故事发生场景：时间、处境、触发的事件"></textarea>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">触发事件（storyTriggerEvent）</span>
            <input v-model="editStoryForm.storyTriggerEvent" class="mk-field__input" placeholder="会话开始时描述给学习者的可见开场事件" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">可见开场（visibleOpening）</span>
            <textarea v-model="editStoryForm.visibleOpening" class="mk-field__textarea" rows="3" placeholder="学习者可见的开场白（黑盒链路使用）"></textarea>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">对抗点（pressurePoints，每行一条）</span>
            <textarea v-model="editStoryForm.pressurePoints" class="mk-field__textarea" rows="3" placeholder="压力点列表：每条一行"></textarea>
          </label>
          <div class="vp-pk">
            <span class="mk-field__label">问题知识（problemKnowledge）</span>
            <label class="mk-field">
              <span class="mk-field__label">领域熟悉度</span>
              <select v-model="editStoryForm.problemKnowledge.domainFamiliarity" class="mk-field__select">
                <option value="low">低（完全陌生）</option>
                <option value="medium">中（略知一二）</option>
                <option value="high">高（有相关经验）</option>
              </select>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">已知概念（逗号分隔）</span>
              <input v-model="editStoryForm.problemKnowledge.knownConcepts" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">易混淆概念（逗号分隔）</span>
              <input v-model="editStoryForm.problemKnowledge.struggleConcepts" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">隐藏盲区（逗号分隔，学习者不自知）</span>
              <input v-model="editStoryForm.problemKnowledge.hiddenGaps" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">自我评估（自评表述）</span>
              <input v-model="editStoryForm.problemKnowledge.selfAssessment" class="mk-field__input" />
            </label>
          </div>
          <!-- 故事级预算覆盖（可选）：缺省继承角色级预算 -->
          <div class="vp-pk">
            <span class="mk-field__label">故事级预算（可选，留空继承角色级）</span>
            <label class="mk-field">
              <span class="mk-field__label">单步最大重试</span>
              <input v-model="editStoryForm.budget.maxRetriesPerStep" type="number" min="1" max="20" class="mk-field__input" placeholder="留空 = 继承角色级（默认 8）" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">会话 AI 调用上限</span>
              <input v-model="editStoryForm.budget.maxRetriesTotal" type="number" min="1" max="1000" class="mk-field__input" placeholder="留空 = 继承角色级（默认 600）" />
              <span class="mk-field__hint">单个会话累计 AI 调用（含重试）达到上限即终止；防本故事无限跑</span>
            </label>
          </div>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="editStoryOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="storySaving" @click="saveStory">
            {{ storySaving ? '保存中…' : '保存故事' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>
  </div>

  <div v-else class="mk-page">
    <button type="button" class="mk-back" @click="closeSubPage">← 虚拟学习者</button>
    <MkEmptyState
      title="加载中…"
      description="正在拉取真实画像。"
    />
  </div>
</template>

<script lang="ts">
/**
 * 记忆保持曲线（Q2 记忆看板）纯函数：ECharts option 构造器。
 * 放在普通 <script> 块以便单测直接 import（与 AdminConsole.vue 的注册表同法）；
 * 逻辑全部无副作用，空数据返回可渲染的空 option（不抛错）。
 */
import type { EChartsCoreOption } from 'echarts/core'

/** 看板曲线配色（按概念顺序取色；与图例同一顺序，保证颜色一致） */
export const MEMORY_CURVE_COLORS = ['#2c63d0', '#dc2626', '#15803d', '#b7791f', '#7c3aed', '#0891b2'] as const

export function memoryCurveColor(index: number): string {
  return MEMORY_CURVE_COLORS[index % MEMORY_CURVE_COLORS.length]
}

export interface MemoryCurveConcept {
  name: string
  label?: string | null
  bucket?: 'due' | 'mastered' | 'other'
  curve: {
    days: number[]
    retention: number[]
    elapsedDays: number
    currentRetention: number
  }
}

function memoryDayLabel(day: number): string {
  return day === 0 ? '刚复习' : `第${day}天`
}

/** 遗忘曲线 x 轴为采样日 [0,1,3,7,14,30]；y 轴统一 0-1（百分比展示） */
export function buildMemoryRetentionChartOption(
  concepts: MemoryCurveConcept[],
  options: { isDark?: boolean } = {}
): EChartsCoreOption {
  const days = Array.isArray(concepts[0]?.curve?.days) ? concepts[0].curve.days : []
  const labels = days.map(memoryDayLabel)
  const axisLine = options.isDark ? 'rgba(230,237,247,0.22)' : 'rgba(23,32,51,0.15)'
  const splitLine = options.isDark ? 'rgba(230,237,247,0.08)' : 'rgba(23,32,51,0.06)'
  const series = concepts.map((concept, index) => {
    const color = memoryCurveColor(index)
    return {
      name: concept.label || concept.name || `概念${index + 1}`,
      type: 'line' as const,
      data: Array.isArray(concept.curve?.retention) ? concept.curve.retention : [],
      smooth: true,
      symbol: 'circle',
      symbolSize: 4,
      connectNulls: true,
      lineStyle: { width: 2, color },
      itemStyle: { color }
    }
  })
  return {
    animationDuration: 400,
    grid: { left: 42, right: 16, top: 16, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (value: unknown) => (value == null ? '—' : `${Math.round(Number(value) * 100)}%`)
    },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: axisLine } },
      axisTick: { show: false },
      axisLabel: { color: '#8492ab', fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      splitLine: { lineStyle: { color: splitLine } },
      axisLabel: {
        color: '#8492ab',
        fontSize: 11,
        formatter: (value: number) => `${Math.round(value * 100)}%`
      }
    },
    series
  }
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { statusText } from './statusText'
import { subPage, closeSubPage, openSubPage, setSubPageLabel, isLive } from './store'
import { liveGetVirtualDetail, liveVirtuals, timeAgo, errMsg } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import QuickLearnPanel from './QuickLearnPanel.vue'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import {
  VS_STATE_META,
  vlabControlsFor,
  type VsControlDef,
  type VsControlKey,
  type VsLifecycleState
} from './vlab-controls'
import RunStateBadge from './RunStateBadge.vue'
import RunStageBar from './RunStageBar.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkChart from '@/components/mk/MkChart.vue'
import DayTimeline from './DayTimeline.vue'
import { useSafePolling } from '@/composables/useSafePolling'
import { useRowMenu } from './useRowMenu'
import { useIsDark } from '@/composables/useIsDark'
import {
  extractQuality,
  RUNS_TAB_WINDOW,
  type QualityScore
} from './vlab'

interface RunItem {
  time: string
  /** 原始创建时间 ISO（会话流水按日期分组用；time 是相对时间文案） */
  createdAt?: string
  stage: string
  result: string
  tone: 'ok' | 'warn' | 'bad'
  paused?: boolean
  sessionId?: string
  storyId?: string | null
  storyTitle?: string | null
  pathId?: string | null
}

interface Detail {
  name: string
  archetype: string
  story: string
  goal: string
  level: string
  notes: string
  traits: string[]
  runs: RunItem[]
  aiProfile: { label: string; value: string }[]
  /** V3：最近一次黑盒终局评估（裁判 / 保真分） */
  quality: { referee: QualityScore | null; fidelity: QualityScore | null }
  /** LLM 重试预算（以虚拟学习者为单位） */
  simulationBudget?: {
    maxRetriesPerStep: number
    maxRetriesTotal: number
    consumedRetries?: number
  }
  /** 运行偏好（画像级持久，新会话创建时作为 simulationConfig 初始值） */
  runtimePrefs?: {
    turnCapPerLesson?: number
    frictionBudget?: string
  }
}

interface StoryLatestRun {
  sessionId: string
  status: string
  currentStage: string
  updatedAt?: string
  createdAt?: string
}

interface StoryProjection {
  formal?: { goal?: string | null; path?: string | null; learn?: string | null }
  test?: { goal?: string | null; path?: string | null; learn?: string | null }
}

interface StoryItem {
  id?: string
  index?: number
  title: string
  outline: string
  status: string
  runCount?: number
  pathId?: string | null
  // 平台视角：Goal → Path → Learn 生命周期计数
  goalCount?: number
  pathCount?: number
  learnCount?: number
  runningCount?: number
  latestRun?: StoryLatestRun | null
  projection?: StoryProjection | null
  // 来自 scenario-designer 的隐藏字段（高级诊断）——保留原始对象用于折叠展示
  hiddenDetails?: string[]
  behaviorHooks?: string[]
  misdiagnosis?: string
  goalSeed?: Record<string, unknown> | null
  disclosurePlan?: Record<string, unknown> | null
  /** 后端故事原始对象（编辑回填：storyTriggerEvent/visibleOpening/pressurePoints/problemKnowledge） */
  raw?: Record<string, unknown>
}

const liveDetail = ref<Detail | null>(null)
/** 主题感知：图表坐标轴/网格线颜色随暗色切换（与 LearnerDetail 负荷曲线同源） */
const isDark = useIsDark()
const stories = ref<StoryItem[]>([])
const selectedStoryId = ref<string | null>(null)
/** 故事多选（对齐一级页批量操作）：勾选多个故事后可批量运行/删除；与单选运行目标并存 */
const selectedStoryKeys = ref<Set<string>>(new Set())
function storyKey(s: StoryItem, i: number): string {
  return s.id || String(i)
}
function toggleStorySelect(s: StoryItem, i: number) {
  const k = storyKey(s, i)
  const next = new Set(selectedStoryKeys.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  selectedStoryKeys.value = next
}
const allStoriesSelected = computed(() =>
  displayStories.value.length > 0 && displayStories.value.every((s, i) => selectedStoryKeys.value.has(storyKey(s, i)))
)
function toggleAllStories() {
  const next = new Set<string>()
  if (!allStoriesSelected.value) {
    displayStories.value.forEach((s, i) => next.add(storyKey(s, i)))
  }
  selectedStoryKeys.value = next
}
/** 批量运行：为每个勾选的故事启动一个新会话（串行，逐个提示） */
async function batchRunStories() {
  const list = displayStories.value
  const targets = list
    .map((s, i) => ({ s, i, k: storyKey(s, i) }))
    .filter(({ k }) => selectedStoryKeys.value.has(k))
  if (!targets.length) { toast.error('请先勾选要运行的故事'); return }
  const id = subPage.value?.id
  if (!id || running.value) return
  running.value = true
  let ok = 0
  for (const { s, i } of targets) {
    try {
      const payload = storyPayload(s, i)
      const res = await adminVirtualLearnersApi.startVirtualSession(id, payload)
      const session = res.data?.data ?? res.data ?? {}
      toast.success(`已按「${s.title || '故事'}」启动：${String(session.id || session.sessionId || '').slice(0, 14)}…`)
      ok++
    } catch (e) {
      toast.error(`「${s.title || '故事'}」启动失败：${errMsg(e)}`)
    }
  }
  running.value = false
  if (ok > 0) {
    selectedStoryKeys.value = new Set()
    await loadDetail(id)
  }
}
/** 批量启动/停止自动驾驶：对勾选故事的最新会话开启/停止 autopilot（不新建会话；已运行/已停止的自动跳过） */
async function batchAutopilotStories(action: 'start' | 'stop') {
  const list = displayStories.value
  const targets = list
    .map((s, i) => ({ s, i, k: storyKey(s, i) }))
    .filter(({ k }) => selectedStoryKeys.value.has(k))
  if (!targets.length) { toast.error('请先勾选要操作的故事'); return }
  const id = subPage.value?.id
  if (!id || storyBusy.value) return

  const withSession = targets.filter((t) => t.s.latestRun?.sessionId)
  const noSession = targets.length - withSession.length
  if (!withSession.length) {
    toast.error(action === 'start' ? '勾选的故事都没有会话；请先「批量运行」创建会话' : '勾选的故事都没有会话，无需停止')
    return
  }
  const verb = action === 'start' ? '启动自动驾驶' : '停止自动驾驶'
  const ok = await askConfirm({
    title: `批量${verb}`,
    message: `将${action === 'start' ? '为' : '停止'}勾选的 ${withSession.length} 个故事的最新会话${action === 'start' ? '开启自动驾驶（target=final 直达 Path 全部完成），已运行的自动跳过' : '的自动驾驶，学习进度保留'}`,
    confirmText: verb,
    danger: false
  })
  if (!ok) return

  storyBusy.value = true
  let done = 0
  let skipped = 0
  let failed = 0
  for (const { s } of withSession) {
    const sid = String(s.latestRun?.sessionId || '')
    try {
      if (action === 'start') {
        await adminVirtualLearnersApi.autopilotStart(sid, { target: 'final' })
      } else {
        await adminVirtualLearnersApi.autopilotStop(sid)
      }
      done++
    } catch (e) {
      const msg = errMsg(e)
      if (msg.includes('已有全自动运行') || msg.includes('没有正在运行')) { skipped++; continue }
      failed++
      toast.error(`「${s.title || '故事'}」${verb}失败：${msg}`)
    }
  }
  storyBusy.value = false
  if (done > 0 || skipped > 0) {
    toast.success(`已${verb} ${done} 个${skipped ? `（跳过 ${skipped}）` : ''}${noSession ? `（${noSession} 个无会话跳过）` : ''}${failed ? `，失败 ${failed}` : ''}`)
    selectedStoryKeys.value = new Set()
    await loadDetail(id)
  }
}
/** 批量删除：确认后逐个删除勾选的故事 */
async function batchRemoveStories() {
  const list = displayStories.value
  const targets = list
    .map((s, i) => ({ s, i, k: storyKey(s, i) }))
    .filter(({ k }) => selectedStoryKeys.value.has(k))
  if (!targets.length) { toast.error('请先勾选要删除的故事'); return }
  const id = subPage.value?.id
  if (!id || storyBusy.value) return
  const ok = await askConfirm({
    title: '批量删除故事',
    message: `确认删除勾选的 ${targets.length} 个故事？\n关联的运行记录将一并清理，该操作不可撤销。`,
    confirmText: '批量删除',
    busy: true
  })
  if (!ok) return
  storyBusy.value = true
  let done = 0
  // 索引随删除变化：必须从后往前删，避免删第 0 个后第 1 个顶上来导致错位
  const indexes = targets.map(({ i }) => i).sort((a, b) => b - a)
  try {
    for (const i of indexes) {
      try {
        await adminVirtualLearnersApi.deleteStory(id, i)
        done++
      } catch (e) {
        toast.error(`删除第 ${i + 1} 个故事失败：${errMsg(e)}`)
      }
    }
    storyBusy.value = false
    if (done > 0) {
      selectedStoryKeys.value = new Set()
      await loadDetail(id)
      toast.success(`已删除 ${done} 个故事`)
    }
    doneConfirm()
  } catch (e) {
    storyBusy.value = false
    failConfirm()
    throw e
  }
}
/** 详情加载失败（无列表兜底数据时）→ 明确错误态 + 重试 */
const detailError = ref(false)
/** 详情接口失败但有列表兜底 → 展示兜底数据 + 提示条（区别于 detailError 全失败态） */
const fallbackNotice = ref(false)

/* 分页：故事池是主工作区（默认页），记忆池/画像/运行各归其页 */
type ProfileTab = 'stories' | 'runs' | 'timeline' | 'profile' | 'memory'
const activeTab = ref<ProfileTab>('stories')

const storyFilter = ref('')
const storyFilterOptions = computed(() => {
  const base = stories.value
  const count = (pred: (s: StoryItem) => boolean) => base.filter(pred).length
  const running = count((s) => (s.runningCount || 0) > 0)
  const paused = count((s) => !!s.latestRun && ['paused'].includes(String(s.latestRun.status || '').toLowerCase()))
  const failed = count((s) => !!s.latestRun && ['failed', 'abandoned', 'timeout'].includes(String(s.latestRun.status || '').toLowerCase()))
  const completed = count((s) => !!s.latestRun && String(s.latestRun.status || '').toLowerCase() === 'completed')
  return [
    { key: '', label: '全部', count: base.length },
    { key: 'running', label: '进行中', count: running },
    { key: 'paused', label: '已暂停', count: paused },
    { key: 'failed', label: '需关注', count: failed },
    { key: 'completed', label: '已完成', count: completed },
  ]
})
const displayStories = computed<StoryItem[]>(() => {
  let list = stories.value
  const sf = storyFilter.value
  if (!sf) return list
  if (sf === 'running') return list.filter((s) => (s.runningCount || 0) > 0)
  if (sf === 'paused') return list.filter((s) => !!s.latestRun && String(s.latestRun.status || '').toLowerCase() === 'paused')
  if (sf === 'failed') return list.filter((s) => !!s.latestRun && ['failed', 'abandoned', 'timeout'].includes(String(s.latestRun.status || '').toLowerCase()))
  if (sf === 'completed') return list.filter((s) => !!s.latestRun && String(s.latestRun.status || '').toLowerCase() === 'completed')
  return list
})

const selectedStory = computed(() => {
  const list = displayStories.value
  if (!list.length) return null
  if (selectedStoryId.value) {
    return list.find((s, i) => (s.id || String(i)) === selectedStoryId.value) || null
  }
  return list.length === 1 ? list[0] : null
})
const selectedStoryTitle = computed(() => selectedStory.value?.title || '')

/** 从二级页进入三级座舱：记忆来源（当前画像），返回时回到本页 */
function openSessionCockpit(sessionId: string) {
  const pid = subPage.value?.id || ''
  openSubPage('session', sessionId, {
    from: { view: 'virtual', id: pid, label: subPage.value?.label }
  })
}

/* 点击故事行：有会话 → 进入该故事最新会话座舱（核心控制在三级页）；无会话 → 仅选中为运行目标 */
function selectStory(s: StoryItem, index: number) {
  const id = s.id || String(index)
  selectedStoryId.value = id
  if (s.latestRun?.sessionId) {
    openSessionCockpit(s.latestRun.sessionId)
  }
}

function storyPayload(s?: StoryItem | null, index?: number) {
  const target = s || selectedStory.value
  if (!target) return {}
  if (target.id) return { storyId: target.id }
  const idx = typeof index === 'number' ? index : target.index
  if (typeof idx === 'number') return { storyIndex: idx }
  return {}
}

const running = ref(false)
const saving = ref(false)
const storyBusy = ref(false)
const sessionBusy = ref(false)
const quickLearnOpen = ref(false)

/* ===== 运行预算（画像 tab 常驻卡片；画像级持久，新会话创建时作为初始值） ===== */
const budgetForm = ref({
  maxRetriesPerStep: 8,
  maxRetriesTotal: 600,
  turnCapPerLesson: 40,
  frictionBudget: 'normal'
})
const budgetErrors = ref<{ maxRetriesPerStep?: string; maxRetriesTotal?: string }>({})
const budgetSaving = ref(false)
const budgetSavedAt = ref('')
/** 表单脏标记：用户改过之后，轮询/刷新不再回填覆盖（避免编辑中被 30s 静默轮询重置） */
const budgetDirty = ref(false)
function fillBudgetForm() {
  if (budgetDirty.value) return
  const b = liveDetail.value?.simulationBudget
  const rp = liveDetail.value?.runtimePrefs
  budgetForm.value = {
    maxRetriesPerStep: b?.maxRetriesPerStep ?? 8,
    maxRetriesTotal: b?.maxRetriesTotal ?? 600,
    turnCapPerLesson: rp?.turnCapPerLesson ?? 40,
    frictionBudget: rp?.frictionBudget || 'normal'
  }
  budgetErrors.value = {}
}
watch(liveDetail, () => fillBudgetForm())
async function saveBudget() {
  const id = subPage.value?.id
  if (!id || budgetSaving.value) return
  budgetErrors.value = {}
  const perStep = Math.round(Number(budgetForm.value.maxRetriesPerStep))
  const total = Math.round(Number(budgetForm.value.maxRetriesTotal))
  if (!Number.isFinite(perStep) || perStep < 1 || perStep > 20) {
    budgetErrors.value.maxRetriesPerStep = '单步重试须为 1–20 的整数'
    return
  }
  if (!Number.isFinite(total) || total < 1 || total > 500) {
    budgetErrors.value.maxRetriesTotal = '总重试预算须为 1–1000 的整数'
    return
  }
  budgetSaving.value = true
  try {
    await adminVirtualLearnersApi.updateVirtualLearner(id, {
      simulationBudget: { maxRetriesPerStep: perStep, maxRetriesTotal: total },
      runtimePrefs: {
        turnCapPerLesson: Math.min(100, Math.max(1, Math.round(Number(budgetForm.value.turnCapPerLesson)))),
        frictionBudget: budgetForm.value.frictionBudget
      }
    })
    budgetDirty.value = false
    await loadDetail(id)
    budgetSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    toast.success('运行预算已保存')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    budgetSaving.value = false
  }
}

const editOpen = ref(false)
const editForm = ref({ name: '', goal: '', level: 'beginner', notes: '' })
const editErrors = ref<{ name?: string }>({})
useEscape(() => editOpen.value, () => { editOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => editOpen.value), panelRef)
useMaskClose(maskRef, () => { editOpen.value = false })

/* ===== 故事编辑（P2-2 前端化：复用 PUT /:id/stories/:storyIndex） ===== */
interface StoryEditForm {
  title: string
  storyOutline: string
  storyTriggerEvent: string
  visibleOpening: string
  pressurePoints: string
  problemKnowledge: {
    domainFamiliarity: string
    knownConcepts: string
    struggleConcepts: string
    hiddenGaps: string
    selfAssessment: string
  }
  /** 故事级预算覆盖（可留空 = 继承角色级） */
  budget: {
    maxRetriesPerStep: string
    maxRetriesTotal: string
  }
}
const editStoryOpen = ref(false)
const editStoryIndex = ref<number | null>(null)
const storySaving = ref(false)
const editStoryForm = ref<StoryEditForm>({
  title: '',
  storyOutline: '',
  storyTriggerEvent: '',
  visibleOpening: '',
  pressurePoints: '',
  problemKnowledge: {
    domainFamiliarity: 'low',
    knownConcepts: '',
    struggleConcepts: '',
    hiddenGaps: '',
    selfAssessment: ''
  },
  budget: {
    maxRetriesPerStep: '',
    maxRetriesTotal: ''
  }
})
const storyPanelRef = ref<HTMLElement | null>(null)
const storyMaskRef = ref<HTMLElement | null>(null)
useEscape(() => editStoryOpen.value, () => { if (!storySaving.value) editStoryOpen.value = false })
useOverlay(computed(() => editStoryOpen.value), storyPanelRef)
useMaskClose(storyMaskRef, () => { if (!storySaving.value) editStoryOpen.value = false })

function openEditStory(index: number) {
  const s = displayStories.value[index]
  if (!s || storySaving.value) return
  const raw = s.raw || {}
  const pk = (raw.problemKnowledge && typeof raw.problemKnowledge === 'object'
    ? raw.problemKnowledge
    : {}) as Record<string, unknown>
  const b = (raw.budget && typeof raw.budget === 'object' ? raw.budget : {}) as Record<string, unknown>
  editStoryForm.value = {
    title: String(raw.title || s.title || ''),
    storyOutline: String(raw.storyOutline || raw.outline || s.outline || ''),
    storyTriggerEvent: String(raw.storyTriggerEvent || raw.triggerEvent || ''),
    visibleOpening: String(raw.visibleOpening || ''),
    pressurePoints: Array.isArray(raw.pressurePoints)
      ? (raw.pressurePoints as string[]).join('\n')
      : '',
    problemKnowledge: {
      domainFamiliarity: String(pk.domainFamiliarity || 'low'),
      knownConcepts: Array.isArray(pk.knownConcepts) ? (pk.knownConcepts as string[]).join('，') : '',
      struggleConcepts: Array.isArray(pk.struggleConcepts) ? (pk.struggleConcepts as string[]).join('，') : '',
      hiddenGaps: Array.isArray(pk.hiddenGaps) ? (pk.hiddenGaps as string[]).join('，') : '',
      selfAssessment: String(pk.selfAssessment || '')
    },
    budget: {
      maxRetriesPerStep: Number.isFinite(Number(b.maxRetriesPerStep)) ? String(b.maxRetriesPerStep) : '',
      maxRetriesTotal: Number.isFinite(Number(b.maxRetriesTotal)) ? String(b.maxRetriesTotal) : ''
    }
  }
  editStoryIndex.value = index
  editStoryOpen.value = true
}

async function saveStory() {
  const id = subPage.value?.id
  if (!id || editStoryIndex.value === null || storySaving.value) return
  const f = editStoryForm.value
  const splitList = (v: string) => v.split(/[\n,，;；]/).map((x) => x.trim()).filter(Boolean)
  const familiarities = ['low', 'medium', 'high']
  // 故事级预算：留空 = 继承角色级；有值才提交
  const budget: Record<string, number> = {}
  const stepRaw = String(f.budget.maxRetriesPerStep ?? '').trim()
  const totalRaw = String(f.budget.maxRetriesTotal ?? '').trim()
  if (stepRaw) {
    const v = Math.round(Number(stepRaw))
    if (Number.isFinite(v)) budget.maxRetriesPerStep = Math.min(20, Math.max(1, v))
  }
  if (totalRaw) {
    const v = Math.round(Number(totalRaw))
    if (Number.isFinite(v)) budget.maxRetriesTotal = Math.min(1000, Math.max(1, v))
  }
  storySaving.value = true
  try {
    await adminVirtualLearnersApi.updateStory(id, editStoryIndex.value, {
      title: f.title.trim() || undefined,
      storyOutline: f.storyOutline.trim() || undefined,
      storyTriggerEvent: f.storyTriggerEvent.trim() || undefined,
      visibleOpening: f.visibleOpening.trim() || undefined,
      pressurePoints: splitList(f.pressurePoints),
      budget,
      problemKnowledge: {
        domainFamiliarity: (familiarities.includes(f.problemKnowledge.domainFamiliarity)
          ? f.problemKnowledge.domainFamiliarity
          : 'low') as 'low' | 'medium' | 'high',
        knownConcepts: splitList(f.problemKnowledge.knownConcepts),
        struggleConcepts: splitList(f.problemKnowledge.struggleConcepts),
        hiddenGaps: splitList(f.problemKnowledge.hiddenGaps),
        selfAssessment: f.problemKnowledge.selfAssessment.trim()
      }
    })
    editStoryOpen.value = false
    editStoryIndex.value = null
    await loadDetail(id)
    toast.success('故事已更新')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    storySaving.value = false
  }
}

/** 清洗故事标题：检测乱码（U+FFFD replacement char 或连续 ?）并 fallback 到「故事 N」 */
function sanitizeStoryTitle(raw: unknown, index: number): string {
  const title = String(raw || '')
  if (!title.trim()) return `故事 ${index + 1}`
  // 检测 replacement char（UTF-8 截断产生的 U+FFFD）
  if (title.includes('\uFFFD')) return `故事 ${index + 1}`
  // 检测连续 3+ 个 ? （可能是编码损坏）
  if (/\?{3,}/.test(title)) return `故事 ${index + 1}`
  // 检测末尾截断（标题以非标点/非汉字结尾且过短）
  if (title.length < 4 && !/[\u4e00-\u9fffA-Za-z0-9）」】]/.test(title.slice(-1))) return `故事 ${index + 1}`
  return title
}

function mapStoryItem(s: Record<string, unknown>, index: number): StoryItem {
  const stats = (s.stats || {}) as Record<string, unknown>
  const latestRunRaw = (s.latestRun || null) as Record<string, unknown> | null
  const bindings = ((latestRunRaw?.bindings || {}) as Record<string, unknown>)
  const pathId = bindings.learningPathId ? String(bindings.learningPathId) : null
  const latestRun: StoryLatestRun | null = latestRunRaw && latestRunRaw.sessionId
    ? {
        sessionId: String(latestRunRaw.sessionId),
        status: String(latestRunRaw.status || ''),
        currentStage: String(latestRunRaw.currentStage || ''),
        updatedAt: latestRunRaw.updatedAt ? String(latestRunRaw.updatedAt) : undefined,
        createdAt: latestRunRaw.createdAt ? String(latestRunRaw.createdAt) : undefined
      }
    : null
  const projectionRaw = (s.projection || null) as StoryProjection | null
  return {
    id: String(s.storyId || s.id || s.key || `story-${index}`),
    index: typeof s.index === 'number' ? Number(s.index) : index,
    title: sanitizeStoryTitle(s.storyTitle || s.title, index),
    outline: String(s.storyOutline || s.outline || s.storyTriggerEvent || s.triggerEvent || ''),
    status: String(s.status || 'draft'),
    runCount: Number(stats.totalRuns ?? 0),
    goalCount: Number(stats.goalCount ?? 0),
    pathCount: Number(stats.pathCount ?? (pathId ? 1 : 0)),
    learnCount: Number(stats.learnCount ?? 0),
    runningCount: Number(stats.runningCount ?? 0),
    latestRun,
    projection: projectionRaw && typeof projectionRaw === 'object' ? projectionRaw : null,
    pathId,
    hiddenDetails: Array.isArray(s.hiddenDetails)
      ? s.hiddenDetails.map((item) => String(item)).filter(Boolean) : undefined,
    behaviorHooks: Array.isArray(s.behaviorHooks)
      ? s.behaviorHooks.map((item) => String(item)).filter(Boolean) : undefined,
    misdiagnosis: typeof s.misdiagnosis === 'string' && s.misdiagnosis ? s.misdiagnosis : undefined,
    goalSeed: s.goalSeed && typeof s.goalSeed === 'object'
      ? s.goalSeed as Record<string, unknown> : undefined,
    disclosurePlan: s.disclosurePlan && typeof s.disclosurePlan === 'object'
      ? s.disclosurePlan as Record<string, unknown> : undefined,
    raw: s
  }
}

function parseSessionStory(session: Record<string, unknown>) {
  const direct = session.storyContext as Record<string, unknown> | undefined
  if (direct && typeof direct === 'object') {
    return {
      storyId: direct.storyId ? String(direct.storyId) : null,
      title: direct.title ? String(direct.title) : null
    }
  }
  try {
    const stage = typeof session.stageResults === 'string'
      ? JSON.parse(session.stageResults)
      : (session.stageResults || {})
    const story = (stage as Record<string, unknown>)?.story as Record<string, unknown> | undefined
    if (!story || typeof story !== 'object') return { storyId: null, title: null }
    return {
      storyId: story.storyId ? String(story.storyId) : null,
      title: story.title ? String(story.title) : null
    }
  } catch {
    return { storyId: null, title: null }
  }
}

/** 加载序号：quiet 轮询与手动加载竞态时丢弃旧响应（last-wins） */
let loadSeq = 0

async function loadDetail(id?: string, quiet = false) {
  if (!id) return
  const seq = ++loadSeq
  if (!quiet) {
    liveDetail.value = null
    stories.value = []
    detailError.value = false
    fallbackNotice.value = false
  }
  try {
    const [raw, storiesRes] = await Promise.all([
      liveGetVirtualDetail(id) as Promise<Record<string, unknown>>,
      adminVirtualLearnersApi.getVirtualLearnerStories(id).catch(() => null)
    ])
    if (seq !== loadSeq) return
    const p = (raw.profile as Record<string, unknown>) || {}
    const sessions = (raw.sessions || raw.virtual_sessions || []) as Record<string, unknown>[]
    const traitsRaw = (raw.personalityTraits || p.traits || {}) as Record<string, unknown>

    const storiesBody = storiesRes?.data?.data ?? storiesRes?.data ?? null
    const apiStories = Array.isArray(storiesBody?.stories) ? storiesBody.stories as Record<string, unknown>[] : null
    if (apiStories) {
      stories.value = apiStories.map((s, i) => mapStoryItem(s, i))
    } else {
      const storyPool = (p.storyPool || raw.storyPool || raw.stories || []) as Record<string, unknown>[]
      stories.value = storyPool.map((s, i) => mapStoryItem(s, i))
    }

    if (stories.value.length === 1) {
      selectedStoryId.value = stories.value[0].id || '0'
    } else if (selectedStoryId.value && !stories.value.some((s, i) => (s.id || String(i)) === selectedStoryId.value)) {
      selectedStoryId.value = null
    }

    liveDetail.value = {
      name: String(p.name || raw.userName || id),
      archetype: String(p.occupation || p.archetype || '自定义样本'),
      story: String(p.background || raw.notes || '（未填写故事）'),
      goal: String(raw.learningGoal || ''),
      level: String(raw.knowledgeLevel || 'beginner'),
      notes: String(raw.notes || ''),
      traits: Object.entries(traitsRaw).slice(0, 5).map(([k, v]) => `${k}: ${String(v)}`),
      runs: sessions.slice(0, RUNS_TAB_WINDOW).map((s) => {
        const storyMeta = parseSessionStory(s)
        const sessionBindings = (s.bindings || {}) as Record<string, unknown>
        const pathId = sessionBindings.learningPathId ? String(sessionBindings.learningPathId) : s.learningPathId ? String(s.learningPathId) : null
        return {
          time: timeAgo(String(s.createdAt || s.startedAt || '')),
          createdAt: String(s.createdAt || s.startedAt || ''),
          stage: String(s.currentStage || s.stage || s.phase || 'goal'),
          result: String(s.status || s.result || 'created'),
          tone: (s.status === 'error' || s.status === 'failed' || s.status === 'timeout'
            ? 'bad'
            : s.status === 'completed' || s.status === 'succeeded'
              ? 'ok'
              : 'warn') as RunItem['tone'],
          paused: (() => {
            try {
              const sr = typeof s.stageResults === 'string' ? JSON.parse(s.stageResults || '{}') : (s.stageResults || {})
              return !!(sr?.teaching?.paused)
            } catch { return false }
          })(),
          sessionId: String(s.id || s.sessionId || ''),
          storyId: storyMeta.storyId,
          storyTitle: storyMeta.title,
          pathId
        }
      }),
      quality: extractQuality(sessions),
      aiProfile: [
        { label: '知识水平', value: { beginner: '零基础', elementary: '入门', intermediate: '中级', advanced: '进阶' }[String(raw.knowledgeLevel)] || String(raw.knowledgeLevel || '—') },
        { label: '性格基线', value: String(p.emotionalBaseline || p.corePersonality || '—') }
      ],
      simulationBudget: (() => {
        const b = (p.simulationBudget || {}) as Record<string, unknown>
        if (!b.maxRetriesPerStep && !b.maxRetriesTotal) return undefined
        return {
          maxRetriesPerStep: Number(b.maxRetriesPerStep) || 8,
          maxRetriesTotal: Number(b.maxRetriesTotal) || 600,
          consumedRetries: Number(b.consumedRetries) || 0
        }
      })(),
      runtimePrefs: (() => {
        const rp = (p.runtimePrefs || {}) as Record<string, unknown>
        if (rp.turnCapPerLesson === undefined && rp.frictionBudget === undefined) return undefined
        return {
          turnCapPerLesson: Number(rp.turnCapPerLesson) || undefined,
          frictionBudget: rp.frictionBudget ? String(rp.frictionBudget) : undefined
        }
      })()
    }
    // 深链/刷新进入时 subPage 只有 id（label 缺失 → 面包屑退化成裸 ID），加载出名字后回填
    setSubPageLabel(liveDetail.value.name)
  } catch {
    if (seq !== loadSeq) return
    const base = liveVirtuals.value.find((v) => v.id === id)
    if (base) {      fallbackNotice.value = true
      liveDetail.value = {
        name: base.name,
        archetype: '自定义样本',
        story: base.story || '（未填写故事）',
        goal: base.goal,
        level: base.level || 'beginner',
        notes: base.story,
        traits: [],
        runs: [],
        quality: { referee: null, fidelity: null },
        aiProfile: [{ label: '知识水平', value: base.level || '—' }]
      }
      setSubPageLabel(base.name)
    } else {
      detailError.value = true
    }
  }
}

watch(
  () => subPage.value?.id,
  async (id) => {
    if (id) await loadDetail(id)
    if (id) void loadMemory(false)
  },
  { immediate: true }
)

/* ===== 记忆池 ===== */
/** 单条概念的遗忘曲线（后端 retention-series 派生） */
interface MemoryConceptCurve {
  days: number[]
  retention: number[]
  elapsedDays: number
  currentRetention: number
}
/** 单条概念的完整记忆读数（stability 天 / lastSeenAt / extractionCount / 当前 retention + 曲线） */
interface MemoryConcept {
  name: string
  label: string | null
  masteryScore: number
  stability: number
  stabilityLabel?: string | null
  lastSeenAt: string | null
  extractionCount: number
  retention: number
  bucket: 'due' | 'mastered' | 'other'
  curve: MemoryConceptCurve
}
interface MemoryData {
  mastered: Array<{ name: string }>
  dueReview: Array<{ name: string; retention: number }>
  struggling: Array<{ name: string }>
  recentCompleted: Array<{
    taskId: string | null
    title: string
    artifactType: string | null
    deliverable: string | null
    completedAt: string
    memoryDelta?: string | null
    selfCalibration?: string | null
  }>
  counts: { mastered: number; dueReview: number; struggling: number; completed: number }
  /** Q2/Q8：有痕迹概念的遗忘曲线（可空，旧响应兼容） */
  concepts?: MemoryConcept[]
  asOf?: string
}
const memoryData = ref<MemoryData | null>(null)
const memoryLoading = ref(false)
const memoryLoadFailed = ref(false)

const memoryMastered = computed(() => memoryData.value?.mastered || [])
const memoryDueReview = computed(() => memoryData.value?.dueReview || [])
const memoryStruggling = computed(() => memoryData.value?.struggling || [])
const memoryCompleted = computed(() => memoryData.value?.recentCompleted || [])
const memoryCounts = computed(() => memoryData.value?.counts || { mastered: 0, dueReview: 0, struggling: 0, completed: 0 })
const memoryCount = computed(() => {
  const c = memoryCounts.value
  return c.mastered + c.dueReview + c.struggling + c.completed
})
const memoryEmpty = computed(() => {
  const c = memoryCounts.value
  return c.mastered + c.dueReview + c.struggling + c.completed === 0
})

/** 看板曲线：到期 / 已掌握概念（后端已按 due→mastered、当前保留率升序排序并截断） */
const memoryCurveConcepts = computed(() =>
  (memoryData.value?.concepts || []).filter(
    (c) =>
      (c.bucket === 'due' || c.bucket === 'mastered') &&
      Array.isArray(c.curve?.retention) &&
      c.curve.retention.length > 0
  )
)
const memoryChartOption = computed<EChartsCoreOption>(() =>
  buildMemoryRetentionChartOption(memoryCurveConcepts.value, { isDark: isDark.value })
)
/** 图例与曲线同序取色（memoryCurveColor(index)），并给出当前保留率/已过天数 */
const memoryChartLegend = computed(() =>
  memoryCurveConcepts.value.map((c, index) => ({
    name: c.label || c.name,
    color: memoryCurveColor(index),
    currentPercent: Math.round((c.curve?.currentRetention ?? c.retention ?? 0) * 100),
    elapsedDays: c.curve?.elapsedDays ?? 0,
    due: c.bucket === 'due'
  }))
)

async function loadMemory(force = false) {
  const id = subPage.value?.id
  if (!id) return
  if (memoryLoading.value && !force) return
  memoryLoading.value = true
  memoryLoadFailed.value = false
  try {
    const res = await adminVirtualLearnersApi.getVirtualLearnerMemory(id)
    const body = res.data?.data ?? res.data ?? null
    const d = body || {}
    memoryData.value = {
      mastered: Array.isArray(d.mastered) ? d.mastered : [],
      dueReview: Array.isArray(d.dueReview) ? d.dueReview : [],
      struggling: Array.isArray(d.struggling) ? d.struggling : [],
      recentCompleted: Array.isArray(d.recentCompleted) ? d.recentCompleted : [],
      counts: d.counts || { mastered: 0, dueReview: 0, struggling: 0, completed: 0 },
      concepts: Array.isArray(d.concepts) ? (d.concepts as MemoryConcept[]) : [],
      asOf: typeof d.asOf === 'string' ? d.asOf : undefined
    }
  } catch {
    memoryLoadFailed.value = true
    if (!force) memoryData.value = null
  } finally {
    memoryLoading.value = false
  }
}

function formatMemoryTime(value: string): string {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return value
  }
}

/* 编辑画像 */
function openEdit() {
  if (!liveDetail.value) return
  editForm.value = {
    name: liveDetail.value.name,
    goal: liveDetail.value.goal,
    level: liveDetail.value.level,
    notes: liveDetail.value.notes || liveDetail.value.story
  }
  editErrors.value = {}
  editOpen.value = true
}

async function saveProfile() {
  const id = subPage.value?.id
  if (!id || saving.value) return
  editErrors.value = {}
  if (!editForm.value.name.trim()) {
    editErrors.value.name = '请填写画像名称'
    return
  }
  saving.value = true
  try {
    await adminVirtualLearnersApi.updateVirtualLearner(id, {
      name: editForm.value.name.trim(),
      learningGoal: editForm.value.goal.trim(),
      knowledgeLevel: editForm.value.level,
      notes: editForm.value.notes.trim()
    })
    await loadDetail(id)
    editOpen.value = false
    toast.success('画像已保存（真实写入）')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}
watch(editOpen, (v) => v && openEdit())

/* 故事池 */
/** 故事样本类型：general=自由生成 / student=传统学生（考试节点/课纲压力/作业情境） */
const storySampleType = ref<'general' | 'student'>('general')
async function generateStory() {
  const id = subPage.value?.id
  if (!id || storyBusy.value) return
  storyBusy.value = true
  try {
    await adminVirtualLearnersApi.draftVirtualLearnerStories(id, storySampleType.value === 'student' ? { sampleType: 'student' } : undefined)
    await loadDetail(id)
    toast.success('新故事已生成')
  } catch (e) {
    const msg = errMsg(e)
    // 画像字段不完整（旧样本缺 learningStyle 等）：先 AI 补全画像再重试一次
    if (msg.includes('personaSeed') || msg.includes('SCENARIO_OUTPUT_INVALID')) {
      try {
        toast.info('画像不完整，正在 AI 补全后重试…')
        const base = liveVirtuals.value.find((v) => v.id === id)
        const g = await adminVirtualLearnersApi.generatePersona({
          ...(storySampleType.value === 'student' ? { sampleType: 'student' } : {}),
          existingPersonaSeed: {
            name: base?.name,
            learningGoal: base?.goal,
            notes: base?.story
          }
        })
        const d = g.data?.data ?? g.data ?? {}
        const seed = (d.personaSeed || d) as Record<string, unknown>
        await adminVirtualLearnersApi.updateVirtualLearner(id, { profile: { ...seed } })
        await adminVirtualLearnersApi.draftVirtualLearnerStories(id, storySampleType.value === 'student' ? { sampleType: 'student' } : undefined)
        await loadDetail(id)
        toast.success('画像已补全，新故事已生成')
      } catch (e2) {
        toast.error(`生成失败：${errMsg(e2)}`)
      }
    } else {
      toast.error(`生成失败：${msg}`)
    }
  } finally {
    storyBusy.value = false
  }
}

async function removeStory(index: number) {
  const id = subPage.value?.id
  if (!id || storyBusy.value) return
  const ok = await askConfirm({
    title: '删除故事',
    message: `确认删除第 ${index + 1} 个故事？\n关联的运行记录将一并清理，该操作不可撤销。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  storyBusy.value = true
  try {
    await adminVirtualLearnersApi.deleteStory(id, index)
    await loadDetail(id)
    toast.success('故事已删除')
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    storyBusy.value = false
  }
}

/* 会话：必须绑定故事（一人多故事 → 一故事一 Path） */
async function runStory(story?: StoryItem, index?: number) {
  const id = subPage.value?.id
  if (!id || running.value) return
  const target = story || selectedStory.value
  if (!target && displayStories.value.length !== 1) {
    toast.error('请先选择一个故事；每个故事对应一套学习任务（Path）')
    return
  }
  if (target) selectStory(target, typeof index === 'number' ? index : target.index ?? 0)
  running.value = true
  try {
    const payload = storyPayload(story, index)
    const res = await adminVirtualLearnersApi.startVirtualSession(id, payload)
    const session = res.data?.data ?? res.data ?? {}
    const storyLabel = selectedStoryTitle.value || story?.title || '故事'
    toast.success(`已按「${storyLabel}」启动：${String(session.id || session.sessionId || '').slice(0, 14)}…`)
    await loadDetail(id)
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally {
    running.value = false
  }
}

async function removeSession(sessionId: string) {
  if (!sessionId || sessionBusy.value) return
  const ok = await askConfirm({
    title: '删除会话',
    message: '确认删除该会话？\n运行记录将一并清理，该操作不可撤销。',
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  sessionBusy.value = true
  try {
    await adminVirtualLearnersApi.deleteVirtualSession(sessionId)
    const id = subPage.value?.id
    if (id) await loadDetail(id)
    toast.success('会话已删除')
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    sessionBusy.value = false
  }
}

/* ===== 会话状态管理 ===== */
/** 当前活跃会话 ID（进行中或最近失败的） */
const activeSessionId = computed(() => {
  const runs = allRuns.value
  // 优先找 running
  const running = runs.find(r => r.result === 'running' || r.result === 'created')
  if (running?.sessionId) return running.sessionId
  // 其次找最近的 failed
  const failed = runs.find(r => r.tone === 'bad')
  return failed?.sessionId || null
})
/** 会话生命周期状态（统一模型 vlab-controls：状态徽章 + 合法操作，三层共用）
 *  派生自最新会话：paused 由 teaching.paused 派生；failed/abandoned 在 tone=bad 下合并展示 */
const lifeState = computed<VsLifecycleState>(() => {
  const runs = allRuns.value
  if (!runs.length) return 'idle'
  const pausedRun = runs.find(r => r.paused && (r.result === 'running' || r.result === 'created'))
  if (pausedRun) return 'paused'
  if (runs.some(r => r.result === 'running' || r.result === 'created')) return 'running'
  if (runs.some(r => r.tone === 'bad')) return 'failed'
  if (runs.some(r => r.tone === 'ok')) return 'completed'
  return 'idle'
})
const lifeMeta = computed(() => VS_STATE_META[lifeState.value])
const lifeLabel = computed(() => lifeMeta.value.label)
const lifeTone = computed(() => lifeMeta.value.tone)
const lifeHint = computed(() => lifeMeta.value.hint)
const lifeHandlers: Partial<Record<VsControlKey, () => void>> = {
  pause: pauseSession,
  resume: resumeSession,
  stop: stopSession,
  retry: retrySession,
  cockpit: goCockpit
}
const lifeControls = computed(() => vlabControlsFor(lifeState.value).filter((c) => lifeHandlers[c.key]))
function runLifeAction(c: VsControlDef) {
  const fn = lifeHandlers[c.key]
  if (!fn) return
  if (c.confirm) {
    void askConfirm({ title: c.confirm.title, message: c.confirm.message, confirmText: c.confirm.confirmText }).then((ok) => {
      if (ok) fn()
    })
    return
  }
  fn()
}
async function pauseSession() {
  if (!activeSessionId.value) return
  sessionBusy.value = true
  try {
    await adminVirtualLearnersApi.pauseVirtualSession(activeSessionId.value)
    toast.success('会话已暂停')
    void loadDetail(subPage.value?.id, true)
  } catch (e) { toast.error(`暂停失败：${errMsg(e)}`) }
  finally { sessionBusy.value = false }
}
async function resumeSession() {
  if (!activeSessionId.value) return
  sessionBusy.value = true
  try {
    await adminVirtualLearnersApi.resumeVirtualSession(activeSessionId.value)
    toast.success('会话已恢复 · 再次触发自动学习后继续推进')
    void loadDetail(subPage.value?.id, true)
  } catch (e) { toast.error(`恢复失败：${errMsg(e)}`) }
  finally { sessionBusy.value = false }
}
async function stopSession() {
  if (!activeSessionId.value) return
  // 确认由统一模型执行（vlab-controls stop.confirm），此处只执行动作
  sessionBusy.value = true
  try {
    await adminVirtualLearnersApi.stopVirtualLearning(activeSessionId.value)
    toast.success('学习已停止')
    void loadDetail(subPage.value?.id, true)
  } catch (e) { toast.error(`停止失败：${errMsg(e)}`) }
  finally { sessionBusy.value = false }
}
async function retrySession() {
  if (!activeSessionId.value) return
  // 确认由统一模型执行（vlab-controls retry.confirm），此处只执行动作
  sessionBusy.value = true
  try {
    await adminVirtualLearnersApi.restartVirtualLearning(activeSessionId.value)
    toast.success('学习已重启')
    void loadDetail(subPage.value?.id, true)
  } catch (e) { toast.error(`重启失败：${errMsg(e)}`) }
  finally { sessionBusy.value = false }
}
function goCockpit() {
  if (activeSessionId.value) openSessionCockpit(activeSessionId.value)
}

const tabs = computed(() => {
  const list: Array<{ key: ProfileTab; label: string; count?: number }> = [
    { key: 'stories', label: '故事池', count: displayStories.value.length },
    { key: 'runs', label: '运行', count: (d.value?.runs || []).length },
    { key: 'timeline', label: '日程', count: timelineSessionOptions.value.length },
    { key: 'memory', label: '记忆池', count: memoryCount.value },
    { key: 'profile', label: '画像' }
  ]
  return list
})
const levelLabel = computed(() => ({
  beginner: '零基础',
  elementary: '入门',
  intermediate: '中级',
  advanced: '进阶'
}[d.value?.level || ''] || d.value?.level || ''))

/* 长期倾向归一化：库里曾以字面量「未设置目标 / 未设置」落盘（无值占位），
   展示层一律按「未设置」处理，避免出现「长期倾向：未设置目标」这种同义反复 */
const goalText = computed(() => {
  const g = String(d.value?.goal || '').trim()
  return !g || g === '未设置目标' || g === '未设置' ? '' : g
})

const d = computed<Detail | undefined>(() => liveDetail.value || undefined)

/* 全部运行 feed（人物级全量运行流） */
const allRuns = computed<RunItem[]>(() => (d.value?.runs || []).slice(0, RUNS_TAB_WINDOW))

/* ---- 日程 tab：日期模拟按天时间线（只读聚合） ---- */
const timelineSessionId = ref('')
const timelineSessionOptions = computed(() =>
  allRuns.value
    .filter((r) => !!r.sessionId)
    .map((r) => ({
      sessionId: String(r.sessionId),
      label: `${formatRunResult(r.result)} · ${r.storyTitle || '未关联故事'} · ${timeAgo(r.time)}`,
    })),
)
watch(
  () => timelineSessionOptions.value.length,
  () => {
    if (!timelineSessionId.value && timelineSessionOptions.value.length) {
      timelineSessionId.value = timelineSessionOptions.value[0].sessionId
    }
  },
  { immediate: true },
)

function storyStatusLabel(s: StoryItem): string {
  if (selectedStoryId.value === (s.id || String(s.index ?? 0))) return '已选'
  if (s.status === 'ready') return '就绪'
  if (s.status === 'draft' || !s.status) return '草稿'
  return s.status
}

/** 阶段会话数摘要：只显示有数的段（「路径 0 · 教学 0」是零值噪声，无会话阶段不占位） */
function stageCountsText(s: StoryItem): string {
  const parts: string[] = []
  if ((s.goalCount || 0) > 0) parts.push(`目标 ${s.goalCount}`)
  if ((s.pathCount || 0) > 0) parts.push(`路径 ${s.pathCount}`)
  if ((s.learnCount || 0) > 0) parts.push(`教学 ${s.learnCount}`)
  return parts.join(' · ')
}

/** 故事级预算覆盖徽标文案（无覆盖返回空串） */
function storyBudgetBadge(s: StoryItem): string {
  const b = storyBudgetOf(s)
  if (!b) return ''
  const parts: string[] = []
  if (Number.isFinite(Number(b.maxRetriesPerStep))) parts.push(`单步 ${b.maxRetriesPerStep}`)
  if (Number.isFinite(Number(b.maxRetriesTotal))) parts.push(`总量 ${b.maxRetriesTotal}`)
  return parts.join(' · ')
}
function storyBudgetOf(s: StoryItem): Record<string, unknown> | null {
  const b = (s.raw?.budget || null) as unknown
  return b && typeof b === 'object' ? b as Record<string, unknown> : null
}

function formatRunResult(result: string) {
  const r = String(result || '').toLowerCase()
  // 非 running/created/… 的 goal* 值（如 goal_reached）单独给「Goal」
  if (r.includes('goal') && !['running', 'created', 'completed', 'failed', 'error', 'timeout'].includes(r)) return 'Goal'
  // 状态词一律走全局字典（单源）；字典未覆盖的值不直出英文枚举
  const t = statusText(r)
  return t === r || !t ? '—' : t
}

/**
 * 故事最新会话的合成生命周期状态（轴 A，供 RunStateBadge / RunStageBar 使用）
 * 合成规则：会话终态优先；runningCount>0 且 latestRun running → running；
 * 其余按 latestRun.status 原样（含 paused/failed/completed/abandoned）
 */
function storyRunState(s: StoryItem): string {
  if ((s.runningCount || 0) > 0 && s.latestRun?.status === 'running') return 'running'
  const st = String(s.latestRun?.status || '').toLowerCase()
  if (['completed', 'incomplete', 'failed', 'abandoned', 'paused', 'created', 'timeout', 'cancelled'].includes(st)) return st
  if (st === 'running') return 'running'
  return st || 'created'
}

/** 会话流水的日期分组（组内保持时间倒序） */
interface RunDayGroup { key: string; title: string; runs: RunItem[] }
/* —— 会话流水（运行 tab）：与故事池互补的两个轴
   故事池 = 按故事看（教材库存视角，卡片自带各故事的最近会话）；
   这里   = 按时间看（会话流水视角：全部会话按时间倒序、按日期分组），
   两个 tab 因此不再是同一数据的重复展示。 */
const RUN_FILTERS = [
  { key: '', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' },
] as const
const runsFilter = ref('')
function isRunActive(r: RunItem): boolean {
  return r.result === 'running' || r.result === 'created'
}
const runFilterOptions = computed(() =>
  RUN_FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    count: f.key === ''
      ? allRuns.value.length
      : f.key === 'active'
        ? allRuns.value.filter(isRunActive).length
        : f.key === 'done'
          ? allRuns.value.filter((r) => r.tone === 'ok' || r.result === 'completed').length
          : allRuns.value.filter((r) => r.tone === 'bad').length,
  }))
)
/** 时间倒序 + 筛选（与 runFilterOptions 同口径） */
const runRows = computed<RunItem[]>(() => {
  const rows = allRuns.value.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  if (runsFilter.value === 'active') return rows.filter(isRunActive)
  if (runsFilter.value === 'done') return rows.filter((r) => r.tone === 'ok' || r.result === 'completed')
  if (runsFilter.value === 'failed') return rows.filter((r) => r.tone === 'bad')
  return rows
})
/** 会话流水行内时刻 HH:mm（完整日期见日期分组头） */
function runHm(iso?: string): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return '--:--'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
function dayLabelOf(iso?: string): { key: string; label: string } {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return { key: 'unknown', label: '时间未知' }
  const p = (n: number) => String(n).padStart(2, '0')
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const now = new Date()
  const today = `${p(now.getMonth() + 1)}-${p(now.getDate())}`
  if (md === today) return { key: md, label: '今天' }
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (md === `${p(yest.getMonth() + 1)}-${p(yest.getDate())}`) return { key: md, label: '昨天' }
  return { key: md, label: `${d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}-`}${md}` }
}
/** 按日期分组（今天/昨天/日期；组内保持时间倒序） */
const runDayGroups = computed<RunDayGroup[]>(() => {
  const groups: RunDayGroup[] = []
  for (const r of runRows.value) {
    const { key, label } = dayLabelOf(r.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.runs.push(r)
    else groups.push({ key, title: label, runs: [r] })
  }
  return groups
})

/* ---- V3：仿真质量常驻徽章（最近一次裁判 / 保真分） ---- */
const qualityReferee = computed<number | null>(() => d.value?.quality?.referee?.score ?? null)
const qualityFidelity = computed<number | null>(() => d.value?.quality?.fidelity?.score ?? null)
const qualityTime = computed(() => {
  const at = d.value?.quality?.referee?.evaluatedAt || d.value?.quality?.fidelity?.evaluatedAt
  return at ? timeAgo(at) : ''
})
const qualityTitle = computed(() => {
  const r = d.value?.quality?.referee
  const f = d.value?.quality?.fidelity
  const parts: string[] = []
  if (r) parts.push(`裁判 ${r.score}（${new Date(r.evaluatedAt).toLocaleString('zh-CN', { hour12: false })}）`)
  if (f) parts.push(`保真 ${f.score}（${new Date(f.evaluatedAt).toLocaleString('zh-CN', { hour12: false })}）`)
  return parts.length ? parts.join(' · ') : '尚无黑盒终局评估（裁判 / 保真）'
})
const qualityTone = computed(() => {
  const scores = [qualityReferee.value, qualityFidelity.value].filter((v): v is number => v !== null)
  if (!scores.length) return 'vp-quality--none'
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  if (avg >= 80) return 'vp-quality--ok'
  if (avg >= 60) return 'vp-quality--warn'
  return 'vp-quality--bad'
})

/* 首字头像配色：按名称哈希取色（与虚拟学习者列表同 8 色板） */
function avatarClassOf(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `vp-avatar--${h % 8}`
}

/* ---- 头部「更多操作」⋯ 菜单（复用行内菜单模型：点击外部/Esc/方向键关闭，fixed 定位防裁切） ---- */
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

/* ---- 进行中会话的静默轮询刷新（setTimeout 链 + 并发守卫 + 指数退避） ---- */
const VLAB_POLL_MS = 30_000
const { start: startPolling, stop: stopPolling } = useSafePolling(
  async () => {
    const runningTotal = displayStories.value.reduce((n, s) => n + (s.runningCount || 0), 0)
    if (runningTotal > 0 && subPage.value?.id) await quietReload(subPage.value.id)
  },
  {
    interval: VLAB_POLL_MS,
    maxBackoff: 120000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
  }
)
watch(
  () => subPage.value?.id,
  (id) => {
    if (!id) {
      stopPolling()
      return
    }
    startPolling()
  },
  { immediate: true }
)

/** 静默重拉：走 loadDetail 的 quiet 模式（不清空视图，轮询不闪屏） */
async function quietReload(id: string) {
  await loadDetail(id, true)
}
</script>

<style scoped>
/* 故事编辑弹窗：宽面板 + 问题知识分区（P2-2）；宽度随全站 .mk-modal__panel--wide token */
.vp-pk {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #e8ecf2;
  border-radius: 12px;
  background: var(--mk-surface-2);
}
.vp-pk > .mk-field__label { font-size: var(--mk-fs-12); color: var(--mk-faint); font-weight: 700; }
.vp-pk .mk-field { margin-bottom: 0; }

.vp {
  gap: 18px;
  padding: 18px 22px 28px;
}
/* 页头身份区走 .mk-entity（shared.css）：--flat + --round 头像 + --lg 名字。
   以下是头像色板（按名称哈希取色，同一人恒定同色）：只给 background，形状来自原语。 */
.vp-avatar--0 { background: #3b82f6; }
.vp-avatar--1 { background: #8b5cf6; }
.vp-avatar--2 { background: #10b981; }
.vp-avatar--3 { background: #f59e0b; }
.vp-avatar--4 { background: #ef4444; }
.vp-avatar--5 { background: #06b6d4; }
.vp-avatar--6 { background: #ec4899; }
.vp-avatar--7 { background: #64748b; }
.vp-top__level { font-size: var(--mk-fs-12); color: var(--mk-faint); font-weight: 700; }
/* 页头主操作走 .mk-entity__actions（shared.css） */
/* 生命周期状态徽章（vlab-controls 唯一语义：进行中/已暂停/已失败/已终止/已完成…） */
.vp-life {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--mk-line);
  background: #fff;
  font-size: var(--mk-fs-12);
  font-weight: 800;
  color: var(--mk-ink);
  white-space: nowrap;
}
.vp-life__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-faint); }
.vp-life--ok .vp-life__dot { background: var(--mk-green); }
.vp-life--warn .vp-life__dot { background: var(--mk-amber); }
.vp-life--bad .vp-life__dot { background: var(--mk-red); }
.vp-life--muted .vp-life__dot { background: var(--mk-faint); }

/* 故事池空态（与全站空数据态同一语言） */
/* 身份区：长期倾向（随名字走，不再挤统计条） */
.vp-top__goal {
  font-size: var(--mk-fs-12);
  font-weight: 600;
  color: var(--mk-muted);
  background: var(--mk-surface-2);
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  padding: 2px 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}
/* 工作流指引 */

/* 分页：统一 mk-pills 分段控件 */
.vp-tabs { width: fit-content; }
/* 空态文案基类：原先只有 ≥2000px 的字号/内边距覆写、缺基础规则，导致故事池与
   运行记录的空文案没有颜色与内边距（审计 附 A #6）。与 .ld-none / .ud-none 同规格。 */
.vp-none { margin: 0; padding: 18px 16px; color: var(--mk-faint); font-size: var(--mk-fs-12_5); }
.vp-tab__count {
  font-family: var(--mk-mono, ui-monospace, monospace);
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  margin-left: 3px;
}
.mk-pill--active .vp-tab__count { color: var(--mk-blue); }

.vp-body { display: grid; gap: 14px; }

.vp-hero__body {
  padding: 18px 20px 20px;
  display: grid;
  gap: 14px;
}
.vp-hero__story {
  margin: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-14);
  line-height: 1.8;
}
.vp-traits { display: flex; gap: 8px; flex-wrap: wrap; }
.vp-trait {
  padding: 4px 11px;
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-12);
  font-weight: 700;
}
.vp-goal {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--mk-blue-bg);
}
.vp-goal span { font-size: var(--mk-fs-12); color: var(--mk-faint); font-weight: 700; }
.vp-goal strong { color: var(--mk-blue); font-size: var(--mk-fs-14); line-height: 1.45; }

.vp-profile { display: grid; }
.vp-profile__row {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--mk-surface-2);
  font-size: var(--mk-fs-13);
  align-items: start;
}
.vp-profile__row:last-child { border-bottom: none; }
.vp-profile__row span { color: var(--mk-faint); padding-top: 1px; }
.vp-profile__row strong { font-weight: 600; line-height: 1.55; word-break: break-word; }

/* 运行预算卡片：4 字段网格 + 底部保存操作条 */
.vp-budget {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  padding: 16px 18px;
}
@media (max-width: 700px) {
  .vp-budget { grid-template-columns: 1fr; }
}
/* .mk-card__foot 基础规则与暗色已提升为全局（见 shared.css）；此处仅保留本页的宽屏内边距档位 */

/* ===== 统一操作台（tabs 下一行；主动作 | 视图筛选 | ⋯ 管理 三段固定槽位） ===== */
.vp-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
}
.vp-toolbar__spacer { flex: 1 1 auto; min-width: 0; }
.vp-stories-head {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.vp-sample-pills {
  display: inline-flex;
  gap: 4px;
}
/* ===== 故事池：列表（选中 → 运行目标；展开 → 详情区） ===== */
.vp-stories { display: grid; gap: 8px; padding: 12px; }
/* 故事池状态过滤 chips（操作台「视图筛选」槽；对齐一级页 vl-filters） */
.vp-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vp-filter-count { font-weight: 800; margin-left: 2px; opacity: 0.75; }

.vp-story {
  display: grid;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow: hidden;
  transition: border-color 0.14s ease;
}
.vp-story:hover { border-color: rgba(44, 99, 208, 0.35); }
.vp-story.is-selected { border-color: rgba(44, 99, 208, 0.5); }

/* 列表行：radio + 主区（标题/状态 + 简述 + 统计）+ 操作 + 展开 */
.vp-story__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  min-width: 0;
  transition: background 0.12s ease;
}
.vp-story__row:hover { background: var(--mk-blue-bg); }
.vp-story.is-selected .vp-story__row { background: var(--mk-blue-bg); }
.vp-story__radio {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid #c4ccd9;
  background: #fff;
  transition: border-color 0.14s ease;
}
.vp-story.is-selected .vp-story__radio {
  border-color: var(--mk-blue);
  background: radial-gradient(circle, var(--mk-blue) 0 4.5px, #fff 5px);
}
/* 多选 checkbox（对齐一级页批量操作） */
.vp-story__checkbox {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.vp-story__checkbox input {
  width: 15px;
  height: 15px;
  accent-color: var(--mk-blue, var(--mk-blue-fill));
  cursor: pointer;
}
.vp-story-select-all {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
}
.vp-story-select-all input { width: 14px; height: 14px; accent-color: var(--mk-blue, var(--mk-blue-fill)); cursor: pointer; }
/* 主区：标题行 + 简述 + 统计行 */
.vp-story__main {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}
.vp-story__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.vp-story__title {
  font-size: var(--mk-fs-14);
  font-weight: 800;
  line-height: 1.4;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vp-story__budget-badge {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-amber, #b7791f);
  background: #fff7e8;
  border: 1px solid rgba(217, 119, 6, 0.25);
  padding: 1px 8px;
  border-radius: 999px;
  flex-shrink: 0;
  white-space: nowrap;
}
/* 简述：单行截断，次要文字色 */
.vp-story__outline {
  margin: 0;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  line-height: 1.5;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 统计行：运行次数 / 阶段进度（中文术语）/ 最近结果 */
.vp-story__stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  min-width: 0;
}
.vp-story__stats-item {
  font-size: var(--mk-fs-12);
  color: var(--mk-faint);
  font-weight: 600;
  white-space: nowrap;
}
.vp-story__stats-item:first-child::before {
  content: '🕐 ';
  font-size: var(--mk-fs-11);
}
.vp-story__stats-item:nth-child(2)::before {
  content: '📈 ';
  font-size: var(--mk-fs-11);
}
/* 最近结果：色调徽标 */
.vp-story__latest {
  font-size: var(--mk-fs-12);
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
}
.vp-story__latest.is-ok { color: var(--mk-green, #16a34a); }
.vp-story__latest.is-bad { color: var(--mk-red, var(--mk-red)); }
.vp-story__latest.is-warn { color: var(--mk-amber, #b7791f); }
.vp-story__latest.is-running { color: var(--mk-amber, #b7791f); }
.vp-story__latest.is-running::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 5px;
  animation: vp-pulse 1.4s ease-in-out infinite;
}
.vp-story__latest.is-none { color: var(--mk-faint); font-weight: 600; }
/* 行内操作 */
.vp-story__ops {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.vp-story__ops .mk-link { font-size: var(--mk-fs-12); }
.vp-story__chevron {
  color: #c4ccd9;
  font-size: var(--mk-fs-12);
  flex-shrink: 0;
}

@keyframes vp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}

/* V3：仿真质量常驻徽章 */
.vp-quality {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  white-space: nowrap;
}
.vp-quality__time { font-weight: 600; opacity: 0.75; }
.vp-quality--ok { color: #1a7f4b; background: var(--mk-green-bg); }
.vp-quality--warn { color: var(--mk-amber, #b7791f); background: var(--mk-amber-bg); }
.vp-quality--bad { color: var(--mk-red); background: var(--mk-red-bg); }
.vp-quality--none { color: var(--mk-faint); background: var(--mk-surface-2); }

/* 运行 tab：会话流水（按时间倒序 + 日期分组；轴与故事池互补） */
.vp-run-flow { display: grid; gap: 14px; padding: 12px; }
.vp-run-day { display: grid; gap: 6px; }
.vp-run-day__label {
  font-size: var(--mk-fs-11);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--mk-faint);
  padding: 2px 2px 0;
}
.vp-run-row {
  display: grid;
  grid-template-columns: 52px minmax(96px, 0.9fr) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: var(--mk-surface);
  transition: border-color 0.12s ease;
}
.vp-run-row:hover { border-color: rgba(44, 99, 208, 0.35); }
.vp-run-row__time { font-size: var(--mk-fs-12); color: var(--mk-faint); white-space: nowrap; }
.vp-run-row__story {
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vp-run-row__ops { display: flex; align-items: center; gap: 12px; }
.vp-run-row__ops .mk-link { font-size: var(--mk-fs-12); }


.vp-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.25);
  color: var(--mk-amber);
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
}

@media (max-width: 1100px) {
  .vp { padding: 16px; }
}

/* =====故事高级诊断折叠区 ===== */


/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .vp-top__level { font-size: 13.5px; }
  .vp-hero__story { font-size: 16.5px; }
  .vp-trait { font-size: var(--mk-fs-14); }
  .vp-goal span { font-size: 13.5px; }
  .vp-goal strong { font-size: 16.5px; }
  .vp-profile__row { font-size: var(--mk-fs-15); }
  .vp-story__title { font-size: var(--mk-fs-15); }
  .vp-story__outline { font-size: 13.5px; }
  .vp-story__stats-item { font-size: var(--mk-fs-13); }
  .vp-story__latest { font-size: var(--mk-fs-13); }
  .vp-none { font-size: var(--mk-fs-15); }
  .vp-tab__count { font-size: var(--mk-fs-13); margin-left: 4px; }
  .vp-fallback { font-size: 14.5px; padding: 12px 16px; }
  .vp-trait { padding: 5px 13px; }
  .vp-goal { padding: 14px 16px; }
  .vp-profile__row { grid-template-columns: 126px minmax(0, 1fr); padding: 14px 21px; }
  .vp-budget { gap: 16px 21px; padding: 19px 21px; }
  .mk-card__foot { padding: 12px 21px; }
  .vp-stories { gap: 8px; padding: 14px; }
  .vp-story__row { padding: 10px 16px; }
  .vp-run-row { padding: 11px 14px; }
  .vp-run-flow { padding: 14px; }
  .vp-none { padding: 21px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号升到 2800 级（17px 级） */
  .vp-top__level { font-size: var(--mk-fs-16); }
  .vp-hero__story { font-size: 19.5px; }
  .vp-trait { font-size: 16.5px; }
  .vp-goal span { font-size: var(--mk-fs-16); }
  .vp-goal strong { font-size: 19.5px; }
  .vp-profile__row { font-size: 17.5px; }
  .vp-story__title { font-size: 17.5px; }
  .vp-story__outline { font-size: var(--mk-fs-16); }
  .vp-story__stats-item { font-size: 15.5px; }
  .vp-story__latest { font-size: 15.5px; }
  .vp-none { font-size: 17.5px; }
  .vp-tab__count { font-size: 15.5px; margin-left: 5px; }
  .vp-fallback { font-size: 17px; padding: 14px 19px; }
  .vp-trait { padding: 6px 15px; }
  .vp-goal { padding: 16px 19px; }
  .vp-profile__row { grid-template-columns: 148px minmax(0, 1fr); padding: 16px 24px; }
  .vp-budget { gap: 19px 24px; padding: 22px 24px; }
  .mk-card__foot { padding: 14px 24px; }
  .vp-stories { gap: 10px; padding: 16px; }
  .vp-story__row { padding: 12px 20px; }
  .vp-run-row { padding: 13px 16px; }
  .vp-none { padding: 24px; }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .vp-top__level { font-size: 18.5px; }
  .vp-hero__story { font-size: 22.5px; }
  .vp-trait { font-size: 19px; }
  .vp-goal span { font-size: 18.5px; }
  .vp-goal strong { font-size: 22.5px; }
  .vp-profile__row { font-size: 20.5px; }
  .vp-story__title { font-size: 20.5px; }
  .vp-story__outline { font-size: 19px; }
  .vp-story__stats-item { font-size: 18.5px; }
  .vp-story__latest { font-size: var(--mk-fs-18); }
  .vp-none { font-size: 20.5px; }
  .vp-tab__count { font-size: var(--mk-fs-18); margin-left: 6px; }
  .vp-fallback { font-size: var(--mk-fs-20); padding: 16px 22px; }
  .vp-trait { padding: 7px 18px; }
  .vp-goal { padding: 19px 22px; }
  .vp-profile__row { grid-template-columns: 174px minmax(0, 1fr); padding: 19px 28px; }
  .vp-budget { gap: 22px 28px; padding: 26px 28px; }
  .mk-card__foot { padding: 16px 28px; }
  .vp-stories { gap: 12px; padding: 19px; }
  .vp-story__row { padding: 15px 24px; }
  .vp-run-row { padding: 15px 19px; }
  .vp-none { padding: 28px; }
}

/* ===== 记忆池 ===== */
.vp-memory__overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 16px 18px;
}
.vp-memory__stat {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--mk-surface-2);
  display: grid;
  gap: 2px;
}
.vp-memory__stat strong { font-size: var(--mk-fs-20); line-height: 1.2; color: var(--mk-green); }
.vp-memory__stat span { font-size: var(--mk-fs-12); color: var(--mk-faint, #8a94a6); }
.vp-memory__stat--warn strong { color: var(--mk-amber); }
.vp-memory__group {
  padding: 4px 18px 18px;
}
.vp-memory__group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.vp-memory__group-title {
  margin: 0;
  font-size: var(--mk-fs-13);
  font-weight: 700;
  color: var(--mk-ink);
}
.vp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.vp-tag {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: var(--mk-fs-12);
  font-weight: 600;
  line-height: 1.4;
  border: 1px solid transparent;
}
.vp-tag--ok {
  color: #1f7a45;
  background: #e8f6ee;
  border-color: #cfe9da;
}
.vp-tag--warn {
  color: #a06a00;
  background: #fdf3e3;
  border-color: #f2dfbc;
}
.vp-memory__review {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.vp-memory__review-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.vp-memory__retention {
  font-size: var(--mk-fs-12);
  color: var(--mk-faint, #8a94a6);
}
/* 记忆保持曲线（Q2/Q8）：说明 + 概念图例（与曲线同序取色）+ ECharts */
.vp-memory__curve-hint {
  margin: 0 0 10px;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  line-height: 1.6;
}
.vp-memory__curve-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 10px;
}
.vp-memory__curve-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--mk-fs-12);
  min-width: 0;
}
.vp-memory__curve-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.vp-memory__curve-name {
  font-weight: 700;
  color: var(--mk-ink);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vp-memory__curve-now {
  color: var(--mk-faint, #8a94a6);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.vp-memory__curve-now.is-due { color: var(--mk-amber); font-weight: 700; }
.vp-memory__completed {
  display: grid;
  gap: 8px;
}
.vp-memory__completed-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e8ecf2;
  border-radius: 10px;
  background: var(--mk-surface-2);
}
.vp-memory__completed-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e8f6ee;
  color: #1f9d55;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mk-fs-11);
  font-weight: 800;
  flex-shrink: 0;
  margin-top: 2px;
}
.vp-memory__completed-body {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.vp-memory__completed-body strong { font-size: var(--mk-fs-13); color: var(--mk-ink); }
.vp-memory__deliverable {
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
}
.vp-memory__delta {
  font-size: var(--mk-fs-12);
  color: var(--mk-faint, #8a94a6);
  font-style: italic;
}

/* ================= 暗色模式（D1 补完）：虚拟画像页 ================= */
html[data-theme='dark'] {
  .vp-top { background: #19191a; border-color: #2a2b2d; }
  .vp-tab { background: #202122; }
  .vp-tab.is-active { background: rgba(91, 141, 239, 0.16); color: #7aa2ff; }
  .vp-story__row:hover { background: #252627; }
  .vp-story.is-selected .vp-story__row { background: rgba(91, 141, 239, 0.12); }
  .vp-quality--ok { color: #6ee7a0; background: rgba(74, 222, 128, 0.12); }
  .vp-quality--warn { color: #fcd34d; background: rgba(251, 191, 36, 0.12); }
  .vp-quality--bad { color: #fca5a5; background: rgba(248, 113, 113, 0.12); }
  .vp-quality--none { background: #2d2d2f; }
  .vp-top__goal { background: #202122; }
  .vp-life--ok { background: rgba(74, 222, 128, 0.12); }
  .vp-life--warn { background: rgba(251, 191, 36, 0.12); }
  .vp-life--bad { background: rgba(248, 113, 113, 0.12); }
  .vp-life--muted { background: #2d2d2f; border-color: #393a3c; }
  .vp-story { background: #19191a; border-color: #2a2b2d; }
  .vp-story__radio { background: #202122; }
  .vp-story.is-selected { background: rgba(91, 141, 239, 0.1); border-color: rgba(91, 141, 239, 0.35); }
  /* 补漏：特征标签/目标/预算徽章/运行卡/工具/记忆统计/警告标签 */
  .vp-trait { background: #2d2d2f; color: #afb1b6; }
  .vp-goal { background: #19191a; border-color: #2a2b2d; }
  .vp-story__budget-badge { background: #232325; color: #afb1b6; }
  .vp-memory__stat { background: #19191a; border-color: #2a2b2d; }
  .vp-tag--warn { background: rgba(251, 191, 36, 0.12); color: #fcd34d; }
  .vp-pk { background: #19191a; border-color: #2a2b2d; }

  .vp-tag--ok { background: rgba(62, 201, 132, 0.14); color: #3ec984; }
  .vp-memory__completed-item { background: #19191a; }
  .vp-memory__completed-dot { background: rgba(62, 201, 132, 0.25); }
}
</style>
