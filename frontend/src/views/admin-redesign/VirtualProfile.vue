<template>
  <div v-if="notFound" class="mk-page vp">
    <div class="mk-empty">
      <strong>未找到该虚拟学习者</strong>
      <span>样本可能已被删除，或链接已失效。</span>
      <button type="button" class="mk-link" @click="closeSubPage">← 虚拟学习者</button>
    </div>
  </div>
  <div v-else-if="detailError" class="mk-page vp">
    <div class="mk-empty">
      <span class="mk-empty__icon" aria-hidden="true">◌</span>
      <strong>画像加载失败</strong>
      <span>暂时无法获取该虚拟学习者的画像与故事池。</span>
      <button type="button" class="mk-empty__action" @click="loadDetail(subPage?.id)">重试</button>
    </div>
  </div>
  <div v-else-if="d" class="mk-page vp">
    <header class="vp-top">
      <button type="button" class="mk-back" @click="closeSubPage">← 虚拟学习者</button>
      <div class="vp-top__main">
        <span class="vp-avatar" :class="avatarClassOf(d.name)" aria-hidden="true">{{ d.name.slice(0, 1) }}</span>
        <div class="vp-top__meta">
          <h1 class="vp-top__name">{{ d.name }}</h1>
          <span v-if="d.archetype" class="mk-badge mk-badge--info">{{ d.archetype }}</span>
          <span v-if="levelLabel" class="vp-top__level">{{ levelLabel }}</span>
          <!-- 仿真质量常驻徽章：最近一次黑盒终局评估（裁判 / 保真），未评估显示灰标 -->
          <span v-if="isLive" class="vp-quality" :class="qualityTone" :title="qualityTitle">
            <template v-if="qualityReferee || qualityFidelity">
              {{ qualityReferee ? `质量 ${qualityReferee}` : '质量 —' }}<template v-if="qualityFidelity"> · 保真 {{ qualityFidelity }}</template>
              <span class="vp-quality__time">{{ qualityTime }}</span>
            </template>
            <template v-else>未评估</template>
          </span>
        </div>
        <div v-if="isLive" class="vp-top__actions">
          <button type="button" class="mk-status__action" @click="quickLearnOpen = true">账号自动学习</button>
          <button type="button" class="mk-status__action" @click="editOpen = true">编辑画像</button>
        </div>
      </div>
    </header>

    <!-- 详情接口失败但有列表兜底：明确提示，避免静默降级 -->
    <div v-if="fallbackNotice" class="vp-fallback">
      <span>详情加载失败，正在展示列表缓存数据</span>
      <button type="button" class="mk-link" @click="loadDetail(subPage?.id)">重试</button>
    </div>


    <!-- 统计条：故事/运行/进行中 + 长期倾向（KPI 卡片风格） -->
    <div class="vp-overview">
      <div class="vp-overview__item">
        <b>{{ displayStories.length }}</b>
        <span>故事</span>
      </div>
      <div class="vp-overview__item">
        <b>{{ allRuns.length }}</b>
        <span>运行</span>
      </div>
      <div v-if="runningCount > 0" class="vp-overview__item is-live">
        <b>{{ runningCount }}</b>
        <span>进行中</span>
      </div>
      <div v-if="failedCount > 0" class="vp-overview__item is-failed">
        <b>{{ failedCount }}</b>
        <span>失败</span>
      </div>
      <div class="vp-overview__item vp-overview__goal">
        <span>长期倾向</span>
        <strong :title="d.goal || '由故事产生当次学习需求'">{{ d.goal || '由故事产生当次学习需求' }}</strong>
      </div>
    </div>

    <!-- 工作流指引：告诉管理员这个页面是做什么的、下一步怎么走 -->
    <div class="vp-guide">
      <span class="vp-guide__icon" aria-hidden="true">🗺️</span>
      <div class="vp-guide__steps">
        <span class="vp-guide__step" :class="{ 'is-done': displayStories.length > 0 }">① 生成故事</span>
        <span class="vp-guide__arrow">→</span>
        <span class="vp-guide__step" :class="{ 'is-done': selectedStoryId }">② 选中故事</span>
        <span class="vp-guide__arrow">→</span>
        <span class="vp-guide__step" :class="{ 'is-active': runningCount > 0, 'is-done': allRuns.length > 0 && runningCount === 0 }">③ 运行</span>
        <span class="vp-guide__arrow">→</span>
        <span class="vp-guide__step">④ 前台验收</span>
      </div>
      <div class="vp-guide__hint">
        <template v-if="!displayStories.length">先点「生成第一条故事」让 AI 设计学习场景</template>
        <template v-else-if="!allRuns.length">选一个故事，点「运行」开始 Goal → Path → Learn 全链路</template>
        <template v-else-if="runningCount > 0">正在运行中，可切换到「验收」tab 查看前台投影</template>
        <template v-else>全部运行完成，切换「验收」tab 投影到前台查看效果</template>
      </div>
    </div>

    <!-- 分页：故事池是主工作区，画像/运行/验收各归其页 -->
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

        <section v-if="activeTab === 'stories'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">故事池 · {{ displayStories.length }}</h3>
            <div class="vp-stories-head">
              <span class="mk-card__meta">一人多故事；选中故事运行，走 Goal → Path → Learn</span>
              <button
                v-if="isLive"
                type="button"
                class="mk-status__action"
                :class="{ 'mk-status__action--primary': !displayStories.length }"
                :disabled="storyBusy"
                @click="generateStory"
              >
                {{ storyBusy ? '生成中…' : displayStories.length ? '再生成故事' : '生成第一条故事' }}
              </button>
            </div>
          </div>
          <p v-if="isLive && !displayStories.length" class="vp-next">
            先生成故事，再进入学习链路。
          </p>
          <div v-if="displayStories.length" class="vp-stories">
            <div
              v-for="(s, i) in displayStories"
              :key="s.id || i"
              class="vp-story"
              :class="{
                'is-selected': selectedStoryId === (s.id || String(i)),
                'is-open': openStoryId === (s.id || String(i))
              }"
            >
              <!-- 管理行：选中 + 标题/状态 + 阶段计数 + 最近结果 + 操作 -->
              <div
                class="vp-story__row"
                role="button"
                tabindex="0"
                :aria-pressed="selectedStoryId === (s.id || String(i))"
                :aria-expanded="openStoryId === (s.id || String(i))"
                @click="selectStory(s, i)"
                @keydown.enter.prevent="selectStory(s, i)"
                @keydown.space.prevent="selectStory(s, i)"
              >
                <span class="vp-story__radio" aria-hidden="true"></span>
                <div class="vp-story__meta">
                  <strong class="vp-story__title">{{ s.title }}</strong>
                  <span class="mk-badge" :class="s.status === 'ready' ? 'mk-badge--ok' : 'mk-badge--muted'">
                    {{ storyStatusLabel(s) }}
                  </span>
                  <span v-if="(s.runCount || 0) > 0" class="vp-story__runcount" :title="`共运行 ${s.runCount} 次`">运行 {{ s.runCount }}</span>
                </div>
                <span class="vp-story__stages" :title="`累计：Goal ${s.goalCount || 0} · Path ${s.pathCount || 0} · Learn ${s.learnCount || 0}`">
                  <template v-if="stageTotal(s) > 0">G{{ s.goalCount || 0 }} · P{{ s.pathCount || 0 }} · L{{ s.learnCount || 0 }}</template>
                  <template v-else>未开始</template>
                </span>
                <span class="vp-story__latest" :class="storyLatestText(s).cls">{{ storyLatestText(s).text }}</span>
                <div class="vp-story__ops" @click.stop>
                  <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" :disabled="running || runFullBusy" @click="runStory(s, i)">
                    {{ running ? '运行中…' : '运行' }}
                  </button>
                    <button
                      type="button"
                      class="mk-btn mk-btn--sm mk-btn--ghost"
                      :disabled="running || runFullBusy"
                      :title="runFullTitle"
                      @click="runFullStory(s, i)"
                    >
                      {{ runFullBusy ? '一键学完中…' : '一键学完' }}
                    </button>
                  <button type="button" class="mk-link" :disabled="storyBusy" @click="openEditStory(i)">编辑</button>
                  <button type="button" class="mk-link mk-link--danger" :disabled="storyBusy" @click="removeStory(i)">删除</button>
                </div>
                <span class="vp-story__chevron" aria-hidden="true">▸</span>
              </div>

              <!-- 详情（展开行）：摘要 / 生命周期（累计·当前·投影）/ 运行历史 / 高级诊断 -->
              <div v-if="openStoryId === (s.id || String(i))" class="vp-story__detail" @click.stop>
                <p class="vp-detail__outline">{{ s.outline }}</p>

                <div class="vp-lc" :class="{ 'is-stalled': progressOf(s).stalled, 'is-running': progressOf(s).running }">
                       <div class="vp-lc__row">
                         <span class="vp-lc__label">阶段</span>
                         <div class="vp-lc__stage-labels">
                           <span class="vp-lc__stage-label" title="目标对话：AI 与学习者澄清学习目标、确定要学什么">Goal</span>
                           <span class="vp-lc__stage-label" title="路径生成：根据学习目标生成个性化的学习路径和任务">Path</span>
                           <span class="vp-lc__stage-label" title="教学回合：教师 Agent 与虚拟学习者进行多轮交互教学">Learn</span>
                         </div>
                       </div>
                       <div class="vp-lc__row">
                         <span class="vp-lc__label">累计</span>
                    <div class="vp-lc__counts">
                      <span
                        v-for="(st, idx) in LC_BARS"
                        :key="st.key"
                        class="vp-lc__count"
                        :class="{ 'is-on': stageCount(s, idx) > 0 }"
                      >
                        {{ st.label }} <b>{{ stageCount(s, idx) }}</b>
                      </span>
                    </div>
                  </div>
                  <div class="vp-lc__row">
                    <span class="vp-lc__label">当前</span>
                    <span class="vp-lc__current" :class="{ 'vp-lc__current--stalled': progressOf(s).stalled }">
                      <template v-if="progressOf(s).running">
                        <span class="vp-lc__pulse" aria-hidden="true"></span>
                        {{ progressOf(s).stageLabel }} 进行中
                        <template v-if="progressOf(s).stalled">· 疑似卡顿（{{ progressOf(s).idleMins }} 分钟无新事件）</template>
                      </template>
                      <template v-else-if="s.latestRun">
                        最近完成：{{ progressOf(s).stageLabel || '—' }} ·
                        <b class="vp-lc__result" :class="`is-${runToneOf(s.latestRun.status)}`">{{ formatRunResult(s.latestRun.status) }}</b>
                        · {{ timeAgo(String(s.latestRun.updatedAt || s.latestRun.createdAt || '')) }}
                      </template>
                      <template v-else>尚未运行</template>
                    </span>
                  </div>
                  <div v-if="allStageLinks(s).length" class="vp-lc__row">
                    <span class="vp-lc__label">投影</span>
                    <div class="vp-lc__links">
                      <button
                        v-for="l in allStageLinks(s)"
                        :key="l.label"
                        type="button"
                        class="vp-lc__link"
                        @click="openLink(l.url)"
                      >{{ l.label }}</button>
                    </div>
                  </div>
                </div>

                <!-- 运行历史（该故事维度） -->
                <div class="vp-runs-block">
                  <div class="vp-runs-block__head">
                    <span>运行历史 · 最近 {{ runsForStory(s).slice(0, STORY_RUN_RECENT_N).length }} 条摘要</span>
                    <button v-if="s.latestRun?.sessionId" type="button" class="mk-link" @click="openSubPage('session', s.latestRun.sessionId)">最新控制台 →</button>
                  </div>
                  <template v-if="runsForStory(s).length">
                    <div v-for="(r, ri) in runsForStory(s).slice(0, STORY_RUN_RECENT_N)" :key="r.sessionId || ri" class="vp-run">
                      <div class="vp-run__head">
                        <strong>{{ formatRunStage(r.stage) }}</strong>
                        <span class="vp-run__result" :class="`is-${r.tone}`">{{ formatRunResult(r.result) }}<template v-if="r.pathId"> · Path</template></span>
                      </div>
                      <div class="vp-run__sub">
                        <span>{{ r.time }}</span>
                      </div>
                      <div v-if="isLive && r.sessionId" class="vp-run__ops">
                        <button type="button" class="mk-link" @click="openSubPage('session', r.sessionId)">打开控制台</button>
                        <button type="button" class="mk-link mk-link--danger" :disabled="sessionBusy" @click="removeSession(r.sessionId)">删除</button>
                      </div>
                    </div>
                    <div class="vp-story-runs__more">
                      <span>共 {{ runsForStory(s).length }} 条；全部运行见「运行」tab</span>
                      <button type="button" class="mk-link" @click="goRunsTab">查看全部 →</button>
                    </div>
                  </template>
                  <p v-else class="vp-none">这个故事还没有运行记录</p>
                </div>

                <!-- 高级诊断（scenario-designer 调试字段，与故事管理分区） -->
                <details v-if="hasAdvancedFields(s)" class="vp-story-item__advanced" >
                  <summary>高级诊断（scenario-designer 调试字段）</summary>
                  <div class="vp-adv-body">
                    <div v-if="getHiddenDetails(s).length" class="vp-adv-row">
                      <span class="vp-adv-row__label">隐藏细节</span>
                      <ul>
                        <li v-for="(item, didx) in getHiddenDetails(s)" :key="`hd-${didx}`">{{ item }}</li>
                      </ul>
                    </div>
                    <div v-if="getBehaviorHooks(s).length" class="vp-adv-row">
                      <span class="vp-adv-row__label">行为钩子</span>
                      <ul>
                        <li v-for="(item, hidx) in getBehaviorHooks(s)" :key="`bh-${hidx}`">{{ item }}</li>
                      </ul>
                    </div>
                    <div v-if="getMisdiagnosis(s)" class="vp-adv-row vp-adv-row--text">
                      <span class="vp-adv-row__label">误诊假设</span>
                      <p>{{ getMisdiagnosis(s) }}</p>
                    </div>
                    <div v-if="getGoalSeed(s)" class="vp-adv-row vp-adv-row--object">
                      <span class="vp-adv-row__label">目标种子</span>
                      <pre>{{ JSON.stringify(getGoalSeed(s), null, 2) }}</pre>
                    </div>
                    <div v-if="getDisclosurePlan(s)" class="vp-adv-row vp-adv-row--object">
                      <span class="vp-adv-row__label">披露计划</span>
                      <pre>{{ JSON.stringify(getDisclosurePlan(s), null, 2) }}</pre>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
          <p v-else class="vp-none">还没有故事。</p>
        </section>

        <section v-if="activeTab === 'runs'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">全部运行 <span class="mk-card__meta">按故事分组</span></h3>
            <span class="mk-badge mk-badge--muted">{{ allRuns.length }} 条</span>
          </div>
          <div v-if="runsGrouped.length" class="vp-run-groups">
            <div v-for="g in runsGrouped" :key="g.key" class="vp-run-group">
              <div class="vp-run-group__head">
                <strong>{{ g.title }}</strong>
                <span class="vp-run-group__count">{{ g.runs.length }} 条</span>
              </div>
              <div class="vp-run-group__body">
                <div v-for="(r, i) in g.runs" :key="r.sessionId || i" class="vp-run">
                  <div class="vp-run__head">
                    <strong>{{ formatRunStage(r.stage) }}</strong>
                    <span class="vp-run__result" :class="`is-${r.tone}`">{{ formatRunResult(r.result) }}<template v-if="r.pathId"> · Path</template></span>
                  </div>
                  <div class="vp-run__sub">
                    <span>{{ r.time }}</span>
                    <template v-if="r.storyTitle && g.key !== '__orphan__' && g.title !== r.storyTitle"> · {{ r.storyTitle }}</template>
                  </div>
                  <div v-if="isLive && r.sessionId" class="vp-run__ops">
                    <button type="button" class="mk-link" @click="openSubPage('session', r.sessionId)">打开控制台</button>
                    <button type="button" class="mk-link mk-link--danger" :disabled="sessionBusy" @click="removeSession(r.sessionId)">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="vp-none">还没有运行记录</p>
        </section>

        <section v-if="isLive && activeTab === 'verify'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">前台投影验收</h3>
          </div>
          <div class="vp-tools">
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('dashboard')">
              {{ projecting ? '生成中…' : '投影首页' }}
            </button>
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('goal')">目标投影</button>
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('paths')">路径</button>
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('state')">状态</button>
          </div>
        </section>
    </div>

    <QuickLearnPanel
      v-if="isLive && subPage?.id"
      v-model:visible="quickLearnOpen"
      :profile-id="subPage.id"
    />

    <!-- 编辑画像 -->
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

    <!-- 编辑故事（P2-2 前端化：PUT /:id/stories/:storyIndex） -->
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
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="editStoryOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="storySaving" @click="saveStory">
            {{ storySaving ? '保存中…' : '保存故事' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="mk-page">
    <button type="button" class="mk-back" @click="closeSubPage">← 虚拟学习者</button>
    <div class="mk-empty">
      <strong>{{ isLive ? '加载中…' : '该样本暂无更多演示数据' }}</strong>
      <span>{{ isLive ? '正在拉取真实画像' : '演示详情仅覆盖部分样本。' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { subPage, closeSubPage, virtualProfiles, openSubPage, isLive } from './store'
import { liveGetVirtualDetail, liveVirtuals, timeAgo, errMsg } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { setProjectionToken } from '@/utils/projection'
import QuickLearnPanel from '@/views/admin/components/virtual/QuickLearnPanel.vue'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import {
  sessionStageIndex,
  stallState,
  extractQuality,
  STORY_RUN_RECENT_N,
  RUNS_TAB_WINDOW,
  VLAB_STAGES,
  VLAB_STAGE_LABELS,
  type QualityScore
} from './vlab'

/* 推进条四段标签（模板遍历用；VLAB_STAGES 顺序与标签一一对应） */
const VLAB_STAGE_LABELS_ARR = VLAB_STAGES.map((s) => VLAB_STAGE_LABELS[s])

interface RunItem {
  time: string
  stage: string
  result: string
  tone: 'ok' | 'warn' | 'bad'
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
const stories = ref<StoryItem[]>([])
const selectedStoryId = ref<string | null>(null)
/** 详情加载失败（无列表兜底数据时）→ 明确错误态 + 重试 */
const detailError = ref(false)
/** 详情接口失败但有列表兜底 → 展示兜底数据 + 提示条（区别于 detailError 全失败态） */
const fallbackNotice = ref(false)

/* 分页：故事池是主工作区（默认页），画像/运行/验收各归其页 */
type ProfileTab = 'stories' | 'runs' | 'profile' | 'verify'
const activeTab = ref<ProfileTab>('stories')

/* demo 模式的故事池（按样本给出有差异的演示故事） */
const DEMO_STORIES: Record<string, StoryItem[]> = {
  'vl-001': [
    { id: 'demo-s1', index: 0, title: '周五下午的老板突袭', outline: '17:40 老板临时要周报汇总，她只有 40 分钟做完 3 小时的活', status: 'ready', runCount: 2, pathId: 'demo-p1', goalCount: 2, pathCount: 1, learnCount: 3 },
    { id: 'demo-s2', index: 1, title: '模板救星', outline: '她找到去年的周报模板，但数据源格式变了，VLOOKUP 全报错', status: 'ready', runCount: 1, pathId: null, goalCount: 1, pathCount: 0, learnCount: 0 },
    { id: 'demo-s3', index: 2, title: '最后一次手工周报', outline: '同事告诉她"其实可以自动化"，她决定这次真的学会', status: 'draft', runCount: 0, pathId: null, goalCount: 0, pathCount: 0, learnCount: 0 }
  ],
  'vl-002': [
    { id: 'demo-s4', index: 0, title: '十年教案的思维惯性', outline: '她把学习路径排成"学期课程表"，两周还没写第一行代码', status: 'ready', runCount: 1, pathId: 'demo-p2', goalCount: 1, pathCount: 1, learnCount: 2 },
    { id: 'demo-s5', index: 1, title: '被推着的第一个项目', outline: '里程碑倒逼：本周必须交出一份真实数据分析，哪怕很糙', status: 'ready', runCount: 0, pathId: null, goalCount: 0, pathCount: 0, learnCount: 0 }
  ],
  'vl-003': [
    { id: 'demo-s6', index: 0, title: '截稿日前 30 天', outline: '导师下了最后通牒，她却在擦桌子、整理文献、做一切与论文无关的事', status: 'ready', runCount: 1, pathId: null, goalCount: 1, pathCount: 0, learnCount: 0 },
    { id: 'demo-s7', index: 1, title: '周末爆发户', outline: 'weekday 低效、周末爆发——系统需要适应她的节奏而不是纠正', status: 'draft', runCount: 0, pathId: null, goalCount: 0, pathCount: 0, learnCount: 0 }
  ]
}
const displayStories = computed<StoryItem[]>(() => {
  if (isLive.value) return stories.value
  // demo 模式：未知 ID 不回退到其他样本的故事，显示空故事池（配合「未找到」空态）
  return DEMO_STORIES[subPage.value?.id || ''] || []
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

/* 展开控制：点击故事行 = 选中（业务语义：按此故事运行）+ 切换展开（查看详情）。
   选中与展开解耦：openStoryId 只控制详情渲染，selectedStoryId 只控制运行目标 */
const openStoryId = ref<string | null>(null)
function selectStory(s: StoryItem, index: number) {
  const id = s.id || String(index)
  selectedStoryId.value = id
  openStoryId.value = openStoryId.value === id ? null : id
}

function storyPayload(s?: StoryItem | null, index?: number) {
  const target = s || selectedStory.value
  if (!target) return {}
  if (target.id) return { storyId: target.id }
  const idx = typeof index === 'number' ? index : target.index
  if (typeof idx === 'number') return { storyIndex: idx }
  return {}
}

// ===== 故事高级诊断字段（来自 scenario-designer 的 5 个 hidden fields） =====
const getHiddenDetails = (s: StoryItem): string[] =>
  Array.isArray(s.hiddenDetails) ? s.hiddenDetails : []
const getBehaviorHooks = (s: StoryItem): string[] =>
  Array.isArray(s.behaviorHooks) ? s.behaviorHooks : []
const getMisdiagnosis = (s: StoryItem): string =>
  typeof s.misdiagnosis === 'string' ? s.misdiagnosis : ''
const getGoalSeed = (s: StoryItem): Record<string, unknown> | null =>
  s.goalSeed && typeof s.goalSeed === 'object' ? s.goalSeed : null
const getDisclosurePlan = (s: StoryItem): Record<string, unknown> | null =>
  s.disclosurePlan && typeof s.disclosurePlan === 'object' ? s.disclosurePlan : null
const hasAdvancedFields = (s: StoryItem) =>
  getHiddenDetails(s).length > 0
  || getBehaviorHooks(s).length > 0
  || !!getMisdiagnosis(s)
  || !!getGoalSeed(s)
  || !!getDisclosurePlan(s)
const running = ref(false)
const runFullBusy = ref(false)
const runFullTitle = '一键完成 Goal → Path → Learn 全流程，自动跑完所有教学任务'
const saving = ref(false)
const storyBusy = ref(false)
const sessionBusy = ref(false)
const projecting = ref(false)
const quickLearnOpen = ref(false)
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
  storySaving.value = true
  try {
    await adminVirtualLearnersApi.updateStory(id, editStoryIndex.value, {
      title: f.title.trim() || undefined,
      storyOutline: f.storyOutline.trim() || undefined,
      storyTriggerEvent: f.storyTriggerEvent.trim() || undefined,
      visibleOpening: f.visibleOpening.trim() || undefined,
      pressurePoints: splitList(f.pressurePoints),
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
      openStoryId.value = selectedStoryId.value
    } else if (selectedStoryId.value && !stories.value.some((s, i) => (s.id || String(i)) === selectedStoryId.value)) {
      selectedStoryId.value = null
      openStoryId.value = null
    }

    liveDetail.value = {
      name: String(p.name || raw.userName || id),
      archetype: String(p.occupation || p.archetype || '自定义样本'),
      story: String(p.background || raw.notes || '（未填写故事）'),
      goal: String(raw.learningGoal || '未设置目标'),
      level: String(raw.knowledgeLevel || 'beginner'),
      notes: String(raw.notes || ''),
      traits: Object.entries(traitsRaw).slice(0, 5).map(([k, v]) => `${k}: ${String(v)}`),
      runs: sessions.slice(0, RUNS_TAB_WINDOW).map((s) => {
        const storyMeta = parseSessionStory(s)
        const sessionBindings = (s.bindings || {}) as Record<string, unknown>
        const pathId = sessionBindings.learningPathId ? String(sessionBindings.learningPathId) : s.learningPathId ? String(s.learningPathId) : null
        return {
          time: timeAgo(String(s.createdAt || s.startedAt || '')),
          stage: String(s.currentStage || s.stage || s.phase || 'goal'),
          result: String(s.status || s.result || 'created'),
          tone: (s.status === 'error' || s.status === 'failed' || s.status === 'timeout'
            ? 'bad'
            : s.status === 'completed' || s.status === 'succeeded'
              ? 'ok'
              : 'warn') as RunItem['tone'],
          sessionId: String(s.id || s.sessionId || ''),
          storyId: storyMeta.storyId,
          storyTitle: storyMeta.title,
          pathId
        }
      }),
      quality: extractQuality(sessions),
      aiProfile: [
        { label: '知识水平', value: String(raw.knowledgeLevel || '—') },
        { label: '模拟模式', value: String(raw.simulationMode || '—') },
        { label: '性格基线', value: String(p.emotionalBaseline || p.corePersonality || '—') }
      ]
    }
  } catch {
    if (seq !== loadSeq) return
    const base = liveVirtuals.value.find((v) => v.id === id)
    if (base) {
      fallbackNotice.value = true
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
    } else {
      detailError.value = true
    }
  }
}

watch(
  () => [subPage.value?.id, isLive.value] as const,
  async ([id, live]) => {
    if (id && live) await loadDetail(id)
  },
  { immediate: true }
)

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
async function generateStory() {
  const id = subPage.value?.id
  if (!id || storyBusy.value) return
  storyBusy.value = true
  try {
    await adminVirtualLearnersApi.draftVirtualLearnerStories(id)
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
          existingPersonaSeed: {
            name: base?.name,
            learningGoal: base?.goal,
            notes: base?.story
          }
        })
        const d = g.data?.data ?? g.data ?? {}
        const seed = (d.personaSeed || d) as Record<string, unknown>
        await adminVirtualLearnersApi.updateVirtualLearner(id, { profile: { ...seed } })
        await adminVirtualLearnersApi.draftVirtualLearnerStories(id)
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
    confirmText: '删除'
  })
  if (!ok) return
  storyBusy.value = true
  try {
    await adminVirtualLearnersApi.deleteStory(id, index)
    await loadDetail(id)
    toast.success('故事已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    storyBusy.value = false
  }
}

/* 会话：必须绑定故事（一人多故事 → 一故事一 Path） */
async function runStory(story?: StoryItem, index?: number) {
  const id = subPage.value?.id
  if (!id || running.value) return
  if (isLive.value) {
    const target = story || selectedStory.value
    if (!target && displayStories.value.length !== 1) {
      toast.error('请先选择一个故事；每个故事对应一套学习任务（Path）')
      return
    }
    if (target) selectStory(target, typeof index === 'number' ? index : target.index ?? 0)
  }
  running.value = true
  try {
    if (isLive.value) {
      const payload = storyPayload(story, index)
      const res = await adminVirtualLearnersApi.startVirtualSession(id, payload)
      const session = res.data?.data ?? res.data ?? {}
      const storyLabel = selectedStoryTitle.value || story?.title || '故事'
      toast.success(`已按「${storyLabel}」启动：${String(session.id || session.sessionId || '').slice(0, 14)}…`)
      await loadDetail(id)
    } else {
      await new Promise((r) => setTimeout(r, 900))
      toast.success('演示运行完成：Goal 对话 8 轮收敛')
    }
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally {
    running.value = false
  }
}

/* 一键学完：创建 session 后立即调用 run-full，Goal → Path → Learn 全流程自动跑完 */
async function runFullStory(story?: StoryItem, index?: number) {
  const id = subPage.value?.id
  if (!id || running.value || runFullBusy.value) return
  if (isLive.value) {
    const target = story || selectedStory.value
    if (!target && displayStories.value.length !== 1) {
      toast.error('请先选择一个故事；每个故事对应一套学习任务（Path）')
      return
    }
    if (target) selectStory(target, typeof index === 'number' ? index : target.index ?? 0)
  }
  runFullBusy.value = true
  try {
    if (isLive.value) {
      const payload = storyPayload(story, index)
      const res = await adminVirtualLearnersApi.startVirtualSession(id, payload)
      const session = res.data?.data ?? res.data ?? {}
      const sid = String(session.id || session.sessionId || '')
      const storyLabel = selectedStoryTitle.value || story?.title || '故事'
      toast.success(`已按「${storyLabel}」启动一键全流程：${sid.slice(0, 14)}…`)
      try {
        const fullRes = await adminVirtualLearnersApi.virtualSessionRunFull(sid, { maxRounds: 20, maxMilestones: 10, continueOnTaskComplete: true })
        const result = fullRes.data?.data ?? {}
        if (result.success) {
          toast.success(`一键全流程完成！${result.goalRounds || 0} 轮 Goal · ${result.learningSteps || 0} 步 Learn`)
        } else {
          toast.error(`一键全流程未完成：${result.error || '未知错误'}`)
        }
      } catch (e) {
        toast.error(`一键全流程执行失败：${errMsg(e)}`)
      }
      await loadDetail(id)
    }
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally {
    runFullBusy.value = false
  }
}

async function removeSession(sessionId: string) {
  if (!sessionId || sessionBusy.value) return
  const ok = await askConfirm({
    title: '删除会话',
    message: '确认删除该会话？\n运行记录将一并清理，该操作不可撤销。',
    confirmText: '删除'
  })
  if (!ok) return
  sessionBusy.value = true
  try {
    await adminVirtualLearnersApi.deleteVirtualSession(sessionId)
    const id = subPage.value?.id
    if (id) await loadDetail(id)
    toast.success('会话已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    sessionBusy.value = false
  }
}

/* 投影到前台（多入口） */
async function openProjection(entry: 'dashboard' | 'goal' | 'paths' | 'state' = 'dashboard') {
  const id = subPage.value?.id
  if (!id || projecting.value) return
  projecting.value = true
  try {
    const res = await adminVirtualLearnersApi.createProjectionToken(id, { scope: 'full' })
    const body = res.data?.data ?? res.data ?? {}
    const token = String(body.token || body.projectionToken || '')
    if (!token) throw new Error('未返回投影 token')
    setProjectionToken(token, { virtualLearnerId: id })
    const href =
      entry === 'goal' ? '/goal-conversation'
        : entry === 'paths' ? '/learning-paths'
          : entry === 'state' ? '/learning-state'
            : '/dashboard'
    window.open(href, '_blank')
    toast.success(`已在新窗口打开投影：${href}`)
  } catch (e) {
    toast.error(`投影失败：${errMsg(e)}`)
  } finally {
    projecting.value = false
  }
}

const runningCount = computed(() =>
  displayStories.value.reduce((n, s) => n + (s.runningCount || 0), 0)
)
const failedCount = computed(() =>
  allRuns.value.filter((r) => r.tone === 'bad').length
)
const tabs = computed(() => {
  const list: Array<{ key: ProfileTab; label: string; count?: number }> = [
    { key: 'stories', label: '故事池', count: displayStories.value.length },
    { key: 'runs', label: '运行', count: (d.value?.runs || []).length },
    { key: 'profile', label: '画像' }
  ]
  if (isLive.value) list.push({ key: 'verify', label: '验收' })
  return list
})
const levelLabel = computed(() => ({
  beginner: '零基础',
  elementary: '入门',
  intermediate: '中级',
  advanced: '进阶'
}[d.value?.level || ''] || d.value?.level || ''))

/** demo 模式：未知 ID 一律显示「未找到」空态，严禁回退展示其他人的数据 */
const notFound = computed(() => !isLive.value && !virtualProfiles.some((x) => x.id === subPage.value?.id))

const d = computed<Detail | undefined>(() => {
  if (isLive.value) return liveDetail.value || undefined
  const demo = virtualProfiles.find((x) => x.id === subPage.value?.id)
  if (!demo) return undefined
  return { ...demo, level: 'beginner', notes: '', quality: { referee: null, fidelity: null } }
})

/* 全部运行 feed（人物级全量运行流；故事卡只展示最近摘要，职责分离见 D1） */
const allRuns = computed<RunItem[]>(() => (d.value?.runs || []).slice(0, RUNS_TAB_WINDOW))

/* 故事卡「运行历史」→「运行」tab 全量视图 */
function goRunsTab() {
  activeTab.value = 'runs'
}

/* 单个故事的运行历史（故事卡内展开） */
function runsForStory(story: StoryItem): RunItem[] {
  const runs = d.value?.runs || []
  const sid = story.id
  if (!sid) return []
  const matched = runs.filter((r) => r.storyId && r.storyId === sid)
  return matched.length ? matched : runs.filter((r) => r.storyTitle === story.title)
}

function storyStatusLabel(s: StoryItem): string {
  if (selectedStoryId.value === (s.id || String(s.index ?? 0))) return '已选'
  return s.status === 'ready' ? '就绪' : s.status || '草稿'
}

/* 打开故事 projection 深链（前台正式页 / 测试台调试页）：
   与 QuickLearnPanel 同模式——先取投影 token 写入 localStorage，再开新窗，避免前台被登录墙拦截 */
async function openLink(url?: string | null) {
  if (!url) return
  const id = subPage.value?.id
  if (!id) {
    window.open(url, '_blank')
    return
  }
  try {
    const res = await adminVirtualLearnersApi.createProjectionToken(id, { scope: 'full' })
    const body = res.data?.data ?? res.data ?? {}
    const token = String(body.token || body.projectionToken || '')
    if (!token) throw new Error('未返回投影 token')
    setProjectionToken(token, { virtualLearnerId: id })
    window.open(url, '_blank')
  } catch (e) {
    toast.error(`打开投影失败：${errMsg(e)}`)
  }
}

function formatRunStage(stage: string) {
  const s = String(stage || '').toLowerCase()
  if (s === 'running' || s === 'created' || s === 'completed' || s === 'failed' || s === 'error' || s === 'timeout') {
    // 容错：旧数据若 stage/result 仍反了，按状态词不当作阶段
    return '会话'
  }
  if (s.includes('goal')) return '目标对话'
  if (s.includes('path')) return '路径生成'
  if (s.includes('learn') || s.includes('teach')) return '教学回合'
  if (s.includes('wrap')) return '课后产出'
  if (s.includes('scenario') || s.includes('story')) return '故事'
  return stage || '会话'
}

function formatRunResult(result: string) {
  const r = String(result || '').toLowerCase()
  if (r.includes('goal') && !['running', 'created', 'completed', 'failed', 'error', 'timeout'].includes(r)) {
    return '目标对话'
  }
  if (r === 'running') return '进行中'
  if (r === 'created') return '已创建'
  if (r === 'completed' || r === 'success' || r === 'succeeded') return '已完成'
  if (r === 'failed' || r === 'error') return '失败'
  if (r === 'timeout') return '超时'
  if (r === 'paused') return '已暂停'
  return result || '—'
}

/* ---- 生命周期条（vp-lc）辅助：阶段计数 / 投影链接 / 结果色调 ---- */
const STAGE_COUNT_KEYS = ['goalCount', 'pathCount', 'learnCount', null] as const
const STAGE_PROJ_KEYS = ['goal', 'path', 'learn', null] as const
/** 四段标签（VLAB_STAGE_LABELS_ARR 的下标 0-2 对应 goal/path/learn 计数） */
function stageCount(s: StoryItem, idx: number): number {
  const key = STAGE_COUNT_KEYS[idx]
  return key ? Number((s as unknown as Record<string, unknown>)[key] || 0) : 0
}
function stageTotal(s: StoryItem): number {
  return (s.goalCount || 0) + (s.pathCount || 0) + (s.learnCount || 0)
}
/** 某阶段的前台/调试投影链接（formal/test 并存时都展示） */
function stageLinksOf(s: StoryItem, idx: number): Array<{ label: string; url: string }> {
  const key = STAGE_PROJ_KEYS[idx]
  const p = s.projection
  if (!key || !p) return []
  const out: Array<{ label: string; url: string }> = []
  if (p.formal?.[key]) out.push({ label: '前台', url: p.formal[key] as string })
  if (p.test?.[key]) out.push({ label: '调试', url: p.test[key] as string })
  return out
}
function runToneOf(status: string): 'ok' | 'warn' | 'bad' {
  const r = String(status || '').toLowerCase()
  if (r === 'completed' || r === 'success' || r === 'succeeded') return 'ok'
  if (r === 'running' || r === 'created' || r === 'paused') return 'warn'
  return 'bad'
}
/** 全部阶段的投影链接平铺（带阶段前缀，如「Goal 前台」「Path 调试」） */
function allStageLinks(s: StoryItem): Array<{ label: string; url: string }> {
  const p = s.projection
  if (!p) return []
  const out: Array<{ label: string; url: string }> = []
  const keys: Array<['goal' | 'path' | 'learn', string]> = [['goal', 'Goal'], ['path', 'Path'], ['learn', 'Learn']]
  for (const [key, stage] of keys) {
    if (p.formal?.[key]) out.push({ label: `${stage} 前台`, url: p.formal[key] as string })
    if (p.test?.[key]) out.push({ label: `${stage} 调试`, url: p.test[key] as string })
  }
  return out
}

/* 生命周期累计分区：三阶段标签（与 stageCount 下标对应） */
const LC_BARS = [
  { key: 'goal', label: 'Goal' },
  { key: 'path', label: 'Path' },
  { key: 'learn', label: 'Learn' },
] as const

/** 管理行「最近」摘要：进行中 / 最近结果（色调）/ 未运行 */
function storyLatestText(s: StoryItem): { text: string; cls: string } {
  if ((s.runningCount || 0) > 0) return { text: `${s.runningCount} 个进行中`, cls: 'is-running' }
  if (s.latestRun) {
    const tone = runToneOf(s.latestRun.status)
    return {
      text: `${formatRunResult(s.latestRun.status)} · ${timeAgo(String(s.latestRun.updatedAt || s.latestRun.createdAt || ''))}`,
      cls: `is-${tone}`,
    }
  }
  return { text: '未运行', cls: 'is-none' }
}

/** 运行 tab：按故事分组的时间线（含「未关联故事」兜底组） */
interface StoryRunGroup { key: string; title: string; runs: RunItem[] }
const runsGrouped = computed<StoryRunGroup[]>(() => {
  const all = d.value?.runs || []
  const groups: StoryRunGroup[] = []
  const knownStoryIds = new Set<string>()
  for (const s of displayStories.value) {
    if (s.id) knownStoryIds.add(s.id)
    const runs = runsForStory(s)
    if (runs.length) groups.push({ key: s.id || s.title, title: s.title, runs })
  }
  const orphanRuns = all.filter((r) =>
    !(r.storyId && knownStoryIds.has(r.storyId))
    && !(r.storyTitle && displayStories.value.some((s) => s.title === r.storyTitle))
  )
  if (orphanRuns.length) groups.push({ key: '__orphan__', title: '未关联故事', runs: orphanRuns })
  return groups
})

/* ---- V2：会话推进条（Goal→Path→Learn→Wrapup 点亮 + 卡顿高亮） ---- */
interface StoryProgress {
  visible: boolean
  running: boolean
  activeIndex: number
  stageLabel: string
  stalled: boolean
  idleMins: number
}
function progressOf(s: StoryItem): StoryProgress {
  const run = s.latestRun || null
  const running = (s.runningCount || 0) > 0 && !!run && String(run.status || '').toLowerCase() === 'running'
  let activeIndex = sessionStageIndex(run?.currentStage)
  // 无明确阶段（旧数据/已完成会话）：按生命周期计数推导已走通段
  if (activeIndex < 0 && !running) {
    if ((s.learnCount || 0) > 0) activeIndex = 2
    else if ((s.pathCount || 0) > 0) activeIndex = 1
    else if ((s.goalCount || 0) > 0) activeIndex = 0
  }
  const stall = stallState(run ? { status: run.status, updatedAt: run.updatedAt, createdAt: run.createdAt } : null)
  const stageLabel =
    activeIndex >= 0
      ? VLAB_STAGE_LABELS[VLAB_STAGES[Math.min(activeIndex, VLAB_STAGES.length - 1)]]
      : running ? '推进中' : '已完成'
  return {
    visible: running || activeIndex >= 0,
    running,
    activeIndex,
    stageLabel,
    stalled: stall.stalled,
    idleMins: stall.idleMins
  }
}

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

/* ---- 运行中会话的静默轮询刷新（不打断当前视图；卡顿/推进实时可见） ---- */
const VLAB_POLL_MS = 30_000
let pollTimer: ReturnType<typeof setInterval> | null = null
watch(
  () => [subPage.value?.id, isLive.value] as const,
  ([id, live]) => {
    if (!id || !live) return
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(() => {
      // 有运行中会话才静默重拉（否则零额外请求）
      const runningTotal = displayStories.value.reduce((n, s) => n + (s.runningCount || 0), 0)
      if (runningTotal > 0 && subPage.value?.id) void quietReload(subPage.value.id)
    }, VLAB_POLL_MS)
  },
  { immediate: true }
)
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
})

/** 静默重拉：走 loadDetail 的 quiet 模式（不清空视图，轮询不闪屏） */
async function quietReload(id: string) {
  await loadDetail(id, true)
}
</script>

<style scoped>
/* 故事编辑弹窗：宽面板 + 问题知识分区（P2-2） */
.mk-modal__panel--wide { width: min(720px, 100%); }
.vp-pk {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #e8ecf2;
  border-radius: 12px;
  background: #fafbfd;
}
.vp-pk > .mk-field__label { font-size: 11.5px; color: var(--mk-faint); font-weight: 700; }
.vp-pk .mk-field { margin-bottom: 0; }

.vp {
  gap: 18px;
  padding: 18px 22px 28px;
}
.vp-top {
  display: grid;
  gap: 4px;
}
.vp-top__main {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
/* 首字头像：与虚拟学习者列表同色板（按名称哈希取色，同一人恒定同色） */
.vp-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 800;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
}
.vp-avatar--0 { background: #3b82f6; }
.vp-avatar--1 { background: #8b5cf6; }
.vp-avatar--2 { background: #10b981; }
.vp-avatar--3 { background: #f59e0b; }
.vp-avatar--4 { background: #ef4444; }
.vp-avatar--5 { background: #06b6d4; }
.vp-avatar--6 { background: #ec4899; }
.vp-avatar--7 { background: #64748b; }
.vp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: 6px;
  width: fit-content;
  transition: background 0.14s ease, transform 0.1s ease;
}
.vp-back:hover { background: #eff6ff; }
.vp-back:active { transform: translateY(1px); }
.vp-top__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.vp-top__name {
  margin: 0;
  font-size: 20px;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.vp-top__level { font-size: 11.5px; color: var(--mk-faint); font-weight: 700; }
.vp-top__actions {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 统计条：stat 胶囊（与列表页「运行概览」胶囊同语言；数字+标签横向排布） */
.vp-overview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.vp-overview__item {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 14px;
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  background: var(--mk-surface);
}
.vp-overview__item b {
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
  line-height: 1.2;
}
.vp-overview__item span {
  font-size: 11.5px;
  color: var(--mk-faint);
  font-weight: 600;
  letter-spacing: 0.03em;
}
.vp-overview__item.is-live b { color: #047857; }
.vp-overview__item.is-live { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.25); }
.vp-overview__item.is-failed b { color: var(--mk-red, #dc2626); }
.vp-overview__item.is-failed { background: rgba(220, 38, 38, 0.06); border-color: rgba(220, 38, 38, 0.2); }
.vp-overview__goal {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 480px;
}
.vp-overview__goal span { font-size: 11px; flex-shrink: 0; }
.vp-overview__goal strong {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 工作流指引 */
.vp-guide {
  margin: 10px 0 0;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.vp-guide__icon { font-size: 15px; flex-shrink: 0; }
.vp-guide__steps { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vp-guide__step {
  font-size: 11.5px; font-weight: 700; color: var(--mk-faint);
  padding: 3px 9px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap;
}
.vp-guide__step.is-done { color: #047857; background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.25); }
.vp-guide__step.is-active { color: #047857; background: rgba(16, 185, 129, 0.14); border-color: rgba(16, 185, 129, 0.4); }
.vp-guide__arrow { font-size: 12px; color: #c4ccd9; font-weight: 700; }
.vp-guide__hint { font-size: 12px; color: var(--mk-muted); margin-left: auto; max-width: 480px; text-align: right; }

/* 生命周期阶段标签 */
.vp-lc__stage-labels { display: flex; align-items: center; gap: 5px; }
.vp-lc__stage-label {
  font-size: 10.5px; font-weight: 700; color: var(--mk-faint);
  padding: 2px 8px; border-radius: 4px; background: #f4f6f9; border: 1px solid #eef1f6; cursor: help;
}

/* 分页：统一 mk-pills 分段控件 */
.vp-tabs { width: fit-content; }
.vp-tab__count {
  font-family: var(--mk-mono, ui-monospace, monospace);
  font-size: 11px;
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
  font-size: 14px;
  line-height: 1.8;
}
.vp-traits { display: flex; gap: 8px; flex-wrap: wrap; }
.vp-trait {
  padding: 4px 11px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 12px;
  font-weight: 700;
}
.vp-goal {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #eef5ff;
}
.vp-goal span { font-size: 11.5px; color: var(--mk-faint); font-weight: 700; }
.vp-goal strong { color: var(--mk-blue); font-size: 14px; line-height: 1.45; }

.vp-profile { display: grid; }
.vp-profile__row {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 13px;
  align-items: start;
}
.vp-profile__row:last-child { border-bottom: none; }
.vp-profile__row span { color: var(--mk-faint); padding-top: 1px; }
.vp-profile__row strong { font-weight: 600; line-height: 1.55; word-break: break-word; }

.vp-stories-head {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
/* ===== 故事池：管理行 + 展开详情（功能分区） ===== */
.vp-stories { display: grid; gap: 8px; padding: 12px; }

/* 管理行：radio + 标题/状态 + 阶段计数 + 最近结果 + 操作，一行扫完 */
.vp-story {
  display: grid;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow: hidden;
}
.vp-story__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  min-width: 0;
  transition: background 0.12s ease;
}
.vp-story__row:hover { background: #f6f9ff; }
.vp-story.is-selected .vp-story__row { background: #f0f7ff; }
.vp-story.is-open .vp-story__row { border-bottom: 1px dashed #e3e9f3; }
.vp-story__radio {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid #c4ccd9;
  background: #fff;
  transition: border-color 0.14s ease;
}
.vp-story.is-selected .vp-story__radio {
  border-color: var(--mk-blue);
  background: radial-gradient(circle, var(--mk-blue) 0 4px, #fff 4.5px);
}
.vp-story__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}
.vp-story__title {
  font-size: 13.5px;
  line-height: 1.4;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vp-story__runcount {
  font-family: var(--mk-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 700;
  color: var(--mk-muted);
  padding: 1px 7px;
  border-radius: 999px;
  background: #f0f2f5;
  flex-shrink: 0;
}
/* 阶段计数：G5 · P2 · L1 紧凑摘要 */
.vp-story__stages {
  font-family: var(--mk-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 700;
  color: var(--mk-faint);
  background: #f7f8fa;
  border: 1px solid #eef1f6;
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
  flex-shrink: 0;
}
/* 最近结果：色调徽标 */
.vp-story__latest {
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 110px;
}
.vp-story__latest.is-ok { color: var(--mk-green, #16a34a); }
.vp-story__latest.is-bad { color: var(--mk-red, #dc2626); }
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
.vp-story__ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.vp-story__chevron {
  color: #c4ccd9;
  font-size: 12px;
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.vp-story.is-open .vp-story__chevron { transform: rotate(90deg); }

/* 详情展开行：摘要 / 生命周期 / 运行历史 / 高级诊断 分区 */
.vp-story__detail {
  display: grid;
  gap: 10px;
  padding: 12px 14px 14px 40px;
  background: #fcfdff;
}
.vp-detail__outline {
  margin: 0;
  font-size: 12.5px;
  color: var(--mk-muted);
  line-height: 1.6;
  padding: 9px 12px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e2e8f0;
}

@keyframes vp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}
.vp-story-runs__more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 2px 2px;
  font-size: 11px;
  color: var(--mk-faint);
}

/* V3：仿真质量常驻徽章 */
.vp-quality {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.vp-quality__time { font-weight: 600; opacity: 0.75; }
.vp-quality--ok { color: #1a7f4b; background: #e8f7ee; }
.vp-quality--warn { color: var(--mk-amber, #b7791f); background: #fff5e6; }
.vp-quality--bad { color: #dc2626; background: #fdecec; }
.vp-quality--none { color: var(--mk-faint); background: #f0f2f5; }

/* ===== 生命周期分区（详情内三行）：累计 / 当前 / 投影 ===== */
.vp-lc {
  display: grid;
  gap: 7px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e2e8f0;
  font-size: 12px;
  color: var(--mk-muted);
}
.vp-lc.is-stalled { border-color: rgba(217, 119, 6, 0.45); background: #fffaf0; }
.vp-lc__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.vp-lc__label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #a8b3c6;
  width: 36px;
  flex-shrink: 0;
}
/* 累计：三阶段计数 pill */
.vp-lc__counts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.vp-lc__count {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #f4f6f9;
  border: 1px solid #eef1f6;
  font-size: 11px;
  font-weight: 600;
  color: var(--mk-faint);
  white-space: nowrap;
}
.vp-lc__count b {
  font-family: var(--mk-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--mk-muted);
}
.vp-lc__count.is-on { background: #eef5ff; border-color: rgba(44, 99, 208, 0.3); }
.vp-lc__count.is-on b { color: var(--mk-blue, #2c63d0); font-weight: 800; }
/* 当前：运行中（脉冲）/ 最近完成（色调结果） */
.vp-lc__current {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  flex-wrap: wrap;
}
.vp-lc__current--stalled { color: var(--mk-amber, #b7791f); }
.vp-lc__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mk-amber, #b7791f);
  animation: vp-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}
.vp-lc__result { font-weight: 800; font-variant-numeric: tabular-nums; }
.vp-lc__result.is-ok { color: var(--mk-green, #16a34a); }
.vp-lc__result.is-warn { color: var(--mk-amber, #b7791f); }
.vp-lc__result.is-bad { color: var(--mk-red, #dc2626); }
/* 投影：集中链接 chips */
.vp-lc__links {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.vp-lc__link {
  border: 0;
  background: #e8f0fe;
  padding: 2px 8px;
  border-radius: 5px;
  font: inherit;
  color: var(--mk-blue, #2c63d0);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.vp-lc__link:hover { background: #dbe8fd; }
.vp-story-runs {
  margin-top: 4px;
  border-top: 1px dashed #e3e9f3;
  padding-top: 8px;
  display: grid;
  gap: 2px;
}
.vp-story-runs__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.vp-story-runs__head .mk-link {
  text-transform: none;
  letter-spacing: 0;
  font-size: 12px;
}
.vp-story-runs .vp-run { padding: 8px 12px; }
.vp-story-runs .vp-none { padding: 10px 2px; }

/* 运行历史（故事详情内分区）：标题行 + 记录列表，明显边框 */
.vp-runs-block {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}
.vp-runs-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.vp-runs-block__head .mk-link {
  text-transform: none;
  letter-spacing: 0;
  font-size: 12px;
}
.vp-runs-block .vp-run {
  margin: 8px 10px;
}
.vp-runs-block .vp-run:last-child { margin-bottom: 10px; }
.vp-runs-block .vp-none { padding: 12px; }

/* 运行 tab：按故事分组 */
.vp-run-groups { display: grid; gap: 10px; padding: 12px; }
.vp-run-group {
  border: 1px solid #eef1f6;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.vp-run-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #eef1f6;
}
.vp-run-group__head strong {
  font-size: 12.5px;
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vp-run-group__count {
  font-size: 11px;
  font-weight: 700;
  color: var(--mk-faint);
  flex-shrink: 0;
}
.vp-run-group__body { display: grid; }


.vp-runs { display: grid; gap: 6px; padding: 8px; }
/* 运行记录：三行卡片（阶段+结果 / 时间 / 操作） */
.vp-run {
  display: grid;
  gap: 3px;
  padding: 9px 12px;
  border: 1px solid #e8edf4;
  border-radius: 10px;
  background: #fff;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.vp-run:hover { border-color: rgba(44, 99, 208, 0.35); background: #fbfdff; }
.vp-run__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.vp-run__head strong { font-size: 13px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vp-run__result {
  font-size: 11.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}
.vp-run__result.is-ok { color: var(--mk-green, #16a34a); }
.vp-run__result.is-warn { color: var(--mk-amber, #b7791f); }
.vp-run__result.is-bad { color: var(--mk-red, #dc2626); }
.vp-run__sub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--mk-faint);
  min-width: 0;
}
.vp-run__sub span { white-space: nowrap; }
.vp-run__ops {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
}
.vp-run__ops .mk-link { font-size: 12px; }


.vp-next {
  margin: 0 18px 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #eef5ff;
  border: 1px solid rgba(44, 99, 208, 0.18);
  color: var(--mk-accent-deep, #1f57cc);
  font-size: 13px;
  line-height: 1.6;
}
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
  font-size: 12.5px;
  font-weight: 600;
}
.vp-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 4px 16px 12px;
}
.vp-tool {
  border: 1px solid var(--mk-line);
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
  text-align: center;
}
.vp-tool:hover:not(:disabled) {
  border-color: rgba(44, 99, 208, 0.35);
  color: var(--mk-blue);
  background: #f7faff;
}
.vp-tool:disabled { opacity: 0.55; cursor: default; }
.vp-tool--primary {
  grid-column: 1 / -1;
  background: linear-gradient(135deg, var(--mk-blue, #2c63d0), var(--mk-accent-deep, #1f57cc));
  border-color: transparent;
  color: #fff;
}
.vp-tool--primary:hover:not(:disabled) {
  color: #fff;
  background: linear-gradient(135deg, #2f6eef, #1a4fbf);
}
.vp-tools__hint {
  margin: 0 16px 14px;
  font-size: 12px;
  color: var(--mk-faint);
  line-height: 1.5;
}

@media (max-width: 1100px) {
  .vp { padding: 16px; }
  .vp-overview__goal { margin-left: 0; flex-basis: 100%; }
}

/* =====故事高级诊断折叠区 ===== */
.vp-story-item__advanced {
  margin-top: 4px;
  font-size: 11px;
}
.vp-story-item__advanced > summary {
  list-style: none;
  cursor: pointer;
  color: var(--mk-faint);
  font-weight: 700;
  padding: 2px 0;
}
.vp-story-item__advanced > summary::-webkit-details-marker { display: none; }
.vp-story-item__advanced > summary::before { content: '▸'; margin-right: 4px; font-size: 10px; }
.vp-story-item__advanced[open] > summary::before { content: '▾'; }

.vp-adv-body {
  padding: 6px 0 2px;
  display: grid;
  gap: 8px;
}
.vp-adv-row {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 8px;
  align-items: start;
  font-size: 11.5px;
  color: var(--mk-muted);
  line-height: 1.5;
}
.vp-adv-row__label { color: var(--mk-faint); font-weight: 700; }
.vp-adv-row ul { margin: 0; padding-left: 16px; color: var(--mk-ink); }
.vp-adv-row--text p { margin: 0; color: var(--mk-ink); }
.vp-adv-row--object pre {
  margin: 0;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px solid var(--mk-line);
  border-radius: 4px;
  font-size: 10.5px;
  color: var(--mk-ink);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .vp-back { font-size: 15px; }
  .vp-top__name { font-size: 23.5px; }
  .vp-top__level { font-size: 13.5px; }
  .vp-avatar { width: 52px; height: 52px; font-size: 21px; }
  .vp-overview__item b { font-size: 18px; }
  .vp-overview__item span { font-size: 13px; }
  .vp-overview__goal span { font-size: 13px; }
  .vp-overview__goal strong { font-size: 14.5px; }
  .vp-hero__story { font-size: 16.5px; }
  .vp-trait { font-size: 14px; }
  .vp-goal span { font-size: 13.5px; }
  .vp-goal strong { font-size: 16.5px; }
  .vp-profile__row { font-size: 15px; }
  .vp-lc { font-size: 13px; }
  .vp-lc__label { font-size: 12px; width: 44px; }
  .vp-lc__count { font-size: 12.5px; }
  .vp-lc__count b { font-size: 13px; }
  .vp-lc__link { font-size: 12.5px; }
  .vp-story__title { font-size: 15px; }
  .vp-detail__outline { font-size: 14px; }
  .vp-story__stages { font-size: 12.5px; }
  .vp-story__latest { font-size: 13px; }
  .vp-run__head strong { font-size: 15px; }
  .vp-run__result, .vp-run__sub { font-size: 13px; }
  .vp-run-group__head strong { font-size: 14px; }
  .vp-story-runs__head { font-size: 13px; }
  .vp-story-runs__head .mk-link { font-size: 14px; }
  .vp-none { font-size: 15px; }
  .vp-next { font-size: 15px; }
  .vp-tool { font-size: 14.5px; }
  .vp-adv-row { font-size: 13.5px; }
  .vp-adv-row--object pre { font-size: 12.5px; }
  .vp-tab__count { font-size: 13px; margin-left: 4px; }
  .vp-fallback { font-size: 14.5px; padding: 12px 16px; }
  .vp-overview { gap: 12px; }
  .vp-overview__item { padding: 12px 16px; }
  .vp-trait { padding: 5px 13px; }
  .vp-goal { padding: 14px 16px; }
  .vp-profile__row { grid-template-columns: 126px minmax(0, 1fr); padding: 14px 21px; }
  .vp-stories { gap: 12px; padding: 14px; }
  .vp-story__row { padding: 12px 18px; }
  .vp-story__detail { padding: 14px 18px 16px 48px; }
  .vp-lc { padding: 12px 14px; }
  .vp-run { padding: 11px 14px; }
  .vp-run-groups { padding: 14px; }
  .vp-none { padding: 21px; }
  .vp-next { padding: 14px 16px; }
  .vp-tools { padding: 5px 19px 14px; }
  .vp-tool { padding: 12px 14px; }
  .vp-adv-row { grid-template-columns: 88px 1fr; }
  .vp-adv-row--object pre { padding: 7px 10px; max-height: 210px; }
  .vp-story-item__advanced { font-size: 13px; }
  .vp-story-item__advanced > summary::before { font-size: 12px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号升到 2800 级（17px 级） */
  .vp-back { font-size: 17.5px; }
  .vp-top__name { font-size: 27.5px; }
  .vp-top__level { font-size: 16px; }
  .vp-avatar { width: 60px; height: 60px; font-size: 24px; }
  .vp-overview__item b { font-size: 20px; }
  .vp-overview__item span { font-size: 15px; }
  .vp-overview__goal span { font-size: 15px; }
  .vp-overview__goal strong { font-size: 16.5px; }
  .vp-hero__story { font-size: 19.5px; }
  .vp-trait { font-size: 16.5px; }
  .vp-goal span { font-size: 16px; }
  .vp-goal strong { font-size: 19.5px; }
  .vp-profile__row { font-size: 17.5px; }
  .vp-lc { font-size: 17px; }
  .vp-lc__label { font-size: 14.5px; width: 52px; }
  .vp-lc__count { font-size: 15px; }
  .vp-lc__count b { font-size: 15.5px; }
  .vp-lc__link { font-size: 15px; }
  .vp-story__title { font-size: 17.5px; }
  .vp-detail__outline { font-size: 16.5px; }
  .vp-story__stages { font-size: 15px; }
  .vp-story__latest { font-size: 15.5px; }
  .vp-run__head strong { font-size: 17.5px; }
  .vp-run__result, .vp-run__sub { font-size: 15.5px; }
  .vp-run-group__head strong { font-size: 16.5px; }
  .vp-story-runs__head { font-size: 15px; }
  .vp-story-runs__head .mk-link { font-size: 16.5px; }
  .vp-none { font-size: 17.5px; }
  .vp-next { font-size: 17.5px; }
  .vp-tool { font-size: 17px; }
  .vp-adv-row { font-size: 16px; }
  .vp-adv-row--object pre { font-size: 14.5px; }
  .vp-tab__count { font-size: 15.5px; margin-left: 5px; }
  .vp-fallback { font-size: 17px; padding: 14px 19px; }
  .vp-overview { gap: 14px; }
  .vp-overview__item { padding: 14px 19px; }
  .vp-trait { padding: 6px 15px; }
  .vp-goal { padding: 16px 19px; }
  .vp-profile__row { grid-template-columns: 148px minmax(0, 1fr); padding: 16px 24px; }
  .vp-stories { gap: 14px; padding: 16px; }
  .vp-story__row { padding: 14px 22px; }
  .vp-story__detail { padding: 16px 22px 18px 58px; }
  .vp-lc { padding: 14px 16px; }
  .vp-run { padding: 13px 16px; }
  .vp-run-groups { padding: 16px; }
  .vp-none { padding: 24px; }
  .vp-next { padding: 16px 19px; }
  .vp-tools { padding: 6px 22px 16px; }
  .vp-tool { padding: 14px 16px; }
  .vp-adv-row { grid-template-columns: 103px 1fr; }
  .vp-adv-row--object pre { padding: 8px 12px; max-height: 245px; }
  .vp-story-item__advanced { font-size: 15px; }
  .vp-story-item__advanced > summary::before { font-size: 14px; }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .vp-back { font-size: 20.5px; }
  .vp-top__name { font-size: 32px; }
  .vp-top__level { font-size: 18.5px; }
  .vp-avatar { width: 68px; height: 68px; font-size: 27px; }
  .vp-overview__item b { font-size: 22px; }
  .vp-overview__item span { font-size: 17px; }
  .vp-overview__goal span { font-size: 17px; }
  .vp-overview__goal strong { font-size: 19px; }
  .vp-hero__story { font-size: 22.5px; }
  .vp-trait { font-size: 19px; }
  .vp-goal span { font-size: 18.5px; }
  .vp-goal strong { font-size: 22.5px; }
  .vp-profile__row { font-size: 20.5px; }
  .vp-lc { font-size: 20px; }
  .vp-lc__label { font-size: 17px; width: 60px; }
  .vp-lc__count { font-size: 17.5px; }
  .vp-lc__count b { font-size: 18px; }
  .vp-lc__link { font-size: 17.5px; }
  .vp-story__title { font-size: 20.5px; }
  .vp-detail__outline { font-size: 19.5px; }
  .vp-story__stages { font-size: 17.5px; }
  .vp-story__latest { font-size: 18px; }
  .vp-run__head strong { font-size: 20.5px; }
  .vp-run__result, .vp-run__sub { font-size: 18px; }
  .vp-run-group__head strong { font-size: 19.5px; }
  .vp-story-runs__head { font-size: 17.5px; }
  .vp-story-runs__head .mk-link { font-size: 19px; }
  .vp-none { font-size: 20.5px; }
  .vp-next { font-size: 20.5px; }
  .vp-tool { font-size: 20px; }
  .vp-adv-row { font-size: 19px; }
  .vp-adv-row--object pre { font-size: 17px; }
  .vp-tab__count { font-size: 18px; margin-left: 6px; }
  .vp-fallback { font-size: 20px; padding: 16px 22px; }
  .vp-overview { gap: 16px; }
  .vp-overview__item { padding: 16px 22px; }
  .vp-trait { padding: 7px 18px; }
  .vp-goal { padding: 19px 22px; }
  .vp-profile__row { grid-template-columns: 174px minmax(0, 1fr); padding: 19px 28px; }
  .vp-stories { gap: 16px; padding: 19px; }
  .vp-story__row { padding: 16px 26px; }
  .vp-story__detail { padding: 18px 26px 20px 68px; }
  .vp-lc { padding: 16px 19px; }
  .vp-run { padding: 15px 19px; }
  .vp-run-groups { padding: 19px; }
  .vp-none { padding: 28px; }
  .vp-next { padding: 19px 22px; }
  .vp-tools { padding: 7px 26px 19px; }
  .vp-tool { padding: 16px 19px; }
  .vp-adv-row { grid-template-columns: 121px 1fr; }
  .vp-adv-row--object pre { padding: 9px 14px; max-height: 285px; }
  .vp-story-item__advanced { font-size: 17.5px; }
  .vp-story-item__advanced > summary::before { font-size: 16px; }
}
</style>
