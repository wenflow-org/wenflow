<template>
  <div v-if="detailError" class="mk-page ld">
    <!-- 返回入口在壳层顶栏（面包屑 back）；错误态保留重试 -->
    <MkEmptyState
      icon="◌"
      tone="error"
      title="详情加载失败"
      description="暂时无法获取该学习者的完整快照。"
      action-text="重试"
      @action="loadDetail(subPage?.id)"
    />
  </div>
  <div v-else-if="loading" class="mk-page ld">
    <MkLoading min text="正在加载学习者详情…" />
  </div>
  <div v-else-if="d" class="mk-page ld">

    <!-- 详情页头（newui/admin hero 形态，MkDetailHero）：返回钮在壳层顶栏，页内不重复 -->
    <MkDetailHero :avatar="d.name.charAt(0)" :title="d.name" :sub="d.email">
      <template #pills>
        <span class="mk-badge" :class="trendBadge">趋势：{{ trendText }}</span>
        <span class="mk-badge" :class="fatigueBadge">疲劳：{{ d.fatigue }}</span>
        <span class="mk-badge" :class="snapshotBadge" :title="snapshotHint">快照 {{ d.snapshot.version }} · {{ d.snapshot.generatedAt }}</span>
      </template>
      <template #actions>
        <button type="button" class="mk-btn" :disabled="recomputing" @click="recompute">
          {{ recomputing ? '重算中…' : '重算快照' }}
        </button>
      </template>
    </MkDetailHero>

    <!-- 状态条（原型 renderLearnerDetail 的 statstrip：hero 与 subtabs 之间的一行四格读数）。
         全部来自已加载的 Detail：进度/阶段/任务/最近会话窗口。 -->
    <section class="mk-card">
      <div class="statstrip" role="list" aria-label="学习者概览">
        <div class="statstrip__stat" role="listitem">
          <span class="statstrip__label">路径进度</span>
          <!-- P2 双分母标注：本格按路径全部任务折算，「当前里程碑」行另有里程碑内分母，title 写明口径 -->
          <span class="statstrip__value" :title="pctTitle">{{ d.pct }}%</span>
        </div>
        <div class="statstrip__stat" role="listitem">
          <span class="statstrip__label">当前阶段</span>
          <span class="statstrip__value" :title="d.stage">{{ d.stage || '—' }}</span>
        </div>
        <div class="statstrip__stat" role="listitem">
          <span class="statstrip__label">当前任务</span>
          <span class="statstrip__value" :title="d.task">{{ d.task || '—' }}</span>
        </div>
        <div class="statstrip__stat" role="listitem">
          <span class="statstrip__label">最近会话</span>
          <!-- P2：「（加载窗口）」角标改 title 口径；「最近」语义上移进读数 -->
          <span class="statstrip__value" :title="recentSessionsHint">最近 {{ d.sessions.length }} 条</span>
        </div>
      </div>
    </section>

    <!-- Tab 栏（6 → 3 合并：总览 / 画像 / 证据；旧 tab 名由 normalizeLearnerTab 重定向）。
         形态换 MkSubTabs（newui/admin 下划线式，替换胶囊 mk-pill） -->
    <MkSubTabs
      :tabs="tabs.map((t) => ({ key: t.id, label: t.label }))"
      :model-value="tab"
      @update:model-value="switchTab"
    />

    <!-- ============ 总览：进度 + 概念掌握图形 + 活跃 + 会话 + 建议行动 ============ -->
    <div v-if="tab === 'overview'" class="ld-grid">
      <div class="ld-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">当前进度</h3>
            <span class="mk-badge mk-badge--info" :title="pctTitle">{{ d.pct }}%</span>
            <!-- 路径下钻：进路径详情二级页（原型「学习者详情 → 路径」同款；无真实 pathId 时隐藏） -->
            <button v-if="currentPathId" type="button" class="mk-link" @click="openPathDetail">查看路径结构 →</button>
          </div>
          <div class="ld-progress">
            <strong>{{ d.path }}</strong>
            <span class="ld-progress__stage">{{ d.stage }}</span>
            <span class="mk-minibar ld-progress__bar"><i class="mk-minibar__fill" :style="{ width: d.pct + '%' }"></i></span>
            <p class="ld-progress__task">正在做：{{ d.task || '—' }}</p>
            <p v-if="milestoneTasks" class="ld-progress__task">当前里程碑：已完成 {{ milestoneTasks.done }}/{{ milestoneTasks.total }} 个任务</p>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">概念掌握</h3>
            <span class="mk-card__meta">{{ conceptBars.length }} 个概念</span>
          </div>
          <!-- T2 硬约束 2：结论行常驻（数字全部由现有 conceptBars 的 tone 派生，未新增判断） -->
          <p v-if="conceptBars.length" class="mk-section__conclusion">
            共 {{ conceptBars.length }} 个概念：{{ conceptBars.filter((c) => c.tone === 'ok').length }} 个转移就绪、{{
              conceptBars.filter((c) => c.tone === 'warn' || c.tone === 'bad').length
            }} 个待巩固<template v-if="conceptBars.filter((c) => c.tone === 'muted').length"
              >、{{ conceptBars.filter((c) => c.tone === 'muted').length }} 个证据不足</template
            >。
          </p>
          <details v-if="conceptBars.length" class="ld-bars-details">
            <summary class="mk-section__summary">逐概念明细</summary>
            <div class="ld-bars">
            <div v-for="c in conceptBars" :key="c.label" class="ld-bar">
              <div class="ld-bar__head">
                <strong :title="`转移就绪：${c.readiness} · 误解风险：${c.risk}`">{{ c.label }}</strong>
                <span class="ld-bar__badges">
                  <span class="mk-badge" :class="barToneBadge(c.tone)">{{ c.readiness }}</span>
                  <span class="ld-bar__risk" :class="`ld-bar__risk--${c.riskTone}`">误解风险 {{ c.risk }}</span>
                  <span v-if="c.evidenceCount > 0" class="ld-bar__ev" :title="`证据 ${c.evidenceCount} 条`">{{ c.evidenceCount }} 证据</span>
                </span>
              </div>
              <span class="mk-minibar ld-bar__track">
                <i class="mk-minibar__fill" :data-tone="c.tone === 'muted' ? undefined : c.tone" :class="{ 'ld-bar__fill--muted': c.tone === 'muted' }" :style="{ width: c.width + '%' }"></i>
              </span>
            </div>
            </div>
          </details>
          <p v-else class="ld-none">
            {{ '暂无概念账本数据' }}
            <span class="ld-none__hint">重算快照后由知识记忆服务生成。</span>
          </p>
        </section>

        <!-- 最近会话（真实接口 userId 过滤）：填平原左栏下方空旷，行点击下钻只读座舱 -->
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近会话</h3>
            <span class="mk-card__meta">
              <MkLoading v-if="ldSessLoading" inline min text="加载中…" />
              <template v-else-if="ldSessError">加载失败</template>
              <!-- 「最近」语义恒在：左栏只取窗口前 5 条，裸「N 条」会被读成总量 -->
              <template v-else>{{ ldSessionRows.length > recentSessionRows.length ? `最近 ${recentSessionRows.length} 条 · 共 ${ldSessionRows.length}` : `最近 ${recentSessionRows.length} 条` }}</template>
            </span>
          </div>
          <MkRowList :empty="!recentSessionRows.length" :loading="ldSessLoading" empty-text="暂无教学会话" empty-hint="该学习者上课后，这里会出现会话列表。">
            <MkRow
              v-for="s in recentSessionRows"
              :key="s.id"
              clickable
              :title="s.topic"
              :sub="s.subText"
              :time="s.startAgo"
              @click="openSessionCockpit(s.id)"
            >
              <template #lead>
                <span class="mk-badge" :class="sessBadgeCls(s.status)">{{ statusText(s.status) || '—' }}</span>
              </template>
            </MkRow>
          </MkRowList>
        </section>

        <!-- 学习状态追踪（原型 renderLearnerDetail 概览 pane 2189 / lsm 样式 517-522）：
             与证据 tab 指标卡同源（dynamicState.metrics）。同屏不同 tab 复用，证据 tab 保持不动。 -->
        <section v-if="dynamicState" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">学习状态追踪</h3>
            <span class="mk-card__meta">LSS · KTL · LF · LSB</span>
          </div>
          <div class="ld-lsm">
            <div v-for="r in learningStateRows" :key="r.label" class="ld-lsm__row">
              <span class="ld-lsm__label">{{ r.label }}</span>
              <span class="mk-minibar ld-lsm__track">
                <i
                  class="mk-minibar__fill"
                  :data-tone="r.tone === 'muted' ? undefined : r.tone"
                  :class="{ 'ld-bar__fill--muted': r.tone === 'muted' }"
                  :style="{ width: r.width + '%' }"
                ></i>
              </span>
              <span class="ld-lsm__val">{{ r.value }}</span>
              <span class="ld-lsm__hint">{{ r.hint }}</span>
            </div>
          </div>
        </section>

        <!-- 学习者画像 kv（原型 2190）：邮箱/层级/路径数/最近活跃（注册来源无后端字段，不硬造） -->
        <section v-if="portraitRows.length" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">学习者画像</h3>
            <span class="mk-card__meta">账号与路径概要</span>
          </div>
          <div class="ld-kv">
            <div v-for="kv in portraitRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
      </div>

      <div class="ld-col">
        <!-- （原「7 天活跃趋势」卡已移除：trend7d 无任何数据来源，恒为 0 的假卡只会渲染
             「学习者产生会话后将自动生成」的误导空态；后端 learner-models 无按日活跃接口） -->
        <section class="mk-card">
          <div class="mk-card__head">
            <!-- 更名「最近动态」：卡内取的是合并时间线前 6 条（教学/目标/路径域事件，不只 session） -->
            <h3 class="mk-card__title">最近动态</h3>
            <span class="mk-card__meta">人类化证据</span>
          </div>
          <div class="ld-sessions">
            <div v-for="(s, i) in d.sessions" :key="i" class="ld-session">
              <span class="ld-session__dot" :class="`is-${s.tone}`"></span>
              <div class="ld-session__main">
                <strong>{{ evidenceTypeZh(s.title) }}</strong>
                <span>{{ s.result }}</span>
                <span v-if="s.concepts && s.concepts.length" class="ld-chips">
                  <span v-for="c in s.concepts.slice(0, 3)" :key="c" class="ld-chip">{{ c }}</span>
                </span>
              </div>
              <span class="ld-session__time">{{ s.time }}</span>
            </div>
            <p v-if="!d.sessions.length" class="ld-none">暂无会话记录</p>
          </div>
        </section>

        <section v-if="teachingHints" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">建议行动</h3>
            <span class="mk-card__meta">教学建议摘要</span>
          </div>
          <div class="ld-actions">
            <p v-if="teachingHints.recommendedApproach"><span class="ld-actions__k">方式</span>{{ teachingHints.recommendedApproach }}</p>
            <p v-if="teachingHints.promptEnhancement"><span class="ld-actions__k">Prompt</span>{{ teachingHints.promptEnhancement }}</p>
            <p v-if="riskFactors.length"><span class="ld-actions__k ld-actions__k--warn">风险</span>{{ riskFactors.join('；') }}</p>
          </div>
        </section>

        <!-- 关联实体（P1：HubSpot/SF 侧栏关联卡模式；跨实体跳转记忆来源） -->
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">关联实体</h3>
            <span class="mk-card__meta">相关记录</span>
          </div>
          <div class="ld-related">
            <button type="button" class="ld-related__item" @click="goUser">
              <span class="ld-related__icon" aria-hidden="true">人</span>
              <span class="ld-related__main">
                <strong>用户账号</strong>
                <span>查看该用户的账号与角色</span>
              </span>
              <i class="ld-related__go">→</i>
            </button>
            <button type="button" class="ld-related__item" @click="switchTab('evidence')">
              <span class="ld-related__icon" aria-hidden="true">证</span>
              <span class="ld-related__main">
                <strong>学习证据</strong>
                <span>查看该学习者的证据明细</span>
              </span>
              <i class="ld-related__go">→</i>
            </button>
          </div>
        </section>
      </div>
    </div>

    <!-- ============ 画像：认知 + 偏好情绪 + 行为历史 + 课程控制 + 派生 + 记忆 + 教学建议 ============ -->
    <div v-else-if="tab === 'profile'" class="ld-tabpage">
      <template v-if="profile">
        <section class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">认知特征</h3></div>
          <div class="ld-kv">
            <div v-for="kv in cognitiveRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">偏好与情绪</h3></div>
          <div class="ld-kv">
            <div v-for="kv in preferenceRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="behaviorRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">学习行为基线</h3></div>
          <div class="ld-kv">
            <div v-for="kv in behaviorRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="historyRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">互动历史</h3></div>
          <div class="ld-kv">
            <div v-for="kv in historyRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="curriculumRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">课程控制</h3></div>
          <div class="ld-kv">
            <div v-for="kv in curriculumRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="derivedRows.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">派生洞察</h3></div>
          <div class="ld-kv">
            <div v-for="kv in derivedRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
        </section>
        <section v-if="narrativeInsights.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">叙述洞察</h3></div>
          <div class="ld-insights">
            <p v-for="(n, i) in narrativeInsights" :key="i">{{ n }}</p>
          </div>
        </section>
        <section v-if="memoryRows.length || foundations.reusable.length || foundations.blocked.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">全局信号与背景</h3></div>
          <div class="ld-kv">
            <div v-for="kv in memoryRows" :key="kv.label" class="ld-kv__row">
              <span>{{ kv.label }}</span>
              <strong>{{ kv.value }}</strong>
            </div>
          </div>
          <div class="ld-found">
            <div>
              <span class="ld-concept-label ld-concept-label--ok">可复用基础 {{ foundations.reusable.length }}</span>
              <div class="ld-concept-list">
                <span v-for="c in foundations.reusable" :key="c" class="ld-concept ld-concept--ok">{{ c }}</span>
                <span v-if="!foundations.reusable.length" class="ld-none">—</span>
              </div>
            </div>
            <div>
              <span class="ld-concept-label ld-concept-label--bad">被阻塞基础 {{ foundations.blocked.length }}</span>
              <div class="ld-concept-list">
                <span v-for="c in foundations.blocked" :key="c" class="ld-concept ld-concept--bad">{{ c }}</span>
                <span v-if="!foundations.blocked.length" class="ld-none">—</span>
              </div>
            </div>
          </div>
        </section>
        <section v-if="memoryTraces.length" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">记忆痕迹与保持率（FSRS）</h3>
            <button type="button" class="mk-link" @click="goMemoryReview">记忆与复习 →</button>
          </div>
          <table class="mk-table">
            <thead>
              <tr><th>概念</th><th>掌握度</th><th>稳定性（天）</th><th>难度</th><th>保持率</th><th>到期</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in memoryTraces" :key="t.conceptKey">
                <td>{{ t.label || t.conceptKey }}</td>
                <td>{{ Math.round((t.masteryScore || 0) * 100) }}%</td>
                <td>{{ t.fsrsStability != null ? t.fsrsStability.toFixed(1) : '—' }}</td>
                <td>{{ t.fsrsDifficulty != null ? t.fsrsDifficulty.toFixed(1) : '—' }}</td>
                <td>
                  <!-- 记忆强度列（原型 memory pane 的 meterrow 词汇：meter 条 + mono %） -->
                  <span v-if="t.retrievability != null" class="ld-mt">
                    <span class="mk-minibar ld-mt__bar"><i class="mk-minibar__fill" :data-tone="t.retrievability < 0.5 ? 'bad' : t.retrievability < 0.8 ? 'warn' : 'ok'" :style="{ width: Math.round(t.retrievability * 100) + '%' }"></i></span>
                    <em>{{ Math.round(t.retrievability * 100) }}%</em>
                  </span>
                  <span v-else class="ld-none">未初始化</span>
                </td>
                <td :title="t.dueAt ? new Date(t.dueAt).toLocaleString() : undefined">{{ t.dueAt ? dueText(t.dueAt) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section v-if="controlFlags.length" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">教学控制信号</h3></div>
          <div class="ld-flags">
            <span v-for="f in controlFlags" :key="f.text" class="mk-badge" :class="f.on ? 'mk-badge--warn' : 'mk-badge--muted'">
              {{ f.text }}：{{ f.on ? '是' : '否' }}
            </span>
          </div>
        </section>
        <section v-if="teachingHints" class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">强调 / 避免</h3></div>
          <div class="ld-two">
            <div>
              <span class="ld-concept-label ld-concept-label--ok">强调</span>
              <div class="ld-concept-list">
                <span v-for="c in teachingHints.emphasize || []" :key="c" class="ld-concept ld-concept--ok">{{ c }}</span>
                <span v-if="!(teachingHints.emphasize || []).length" class="ld-none">—</span>
              </div>
            </div>
            <div>
              <span class="ld-concept-label ld-concept-label--bad">避免</span>
              <div class="ld-concept-list">
                <span v-for="c in teachingHints.avoid || []" :key="c" class="ld-concept ld-concept--bad">{{ c }}</span>
                <span v-if="!(teachingHints.avoid || []).length" class="ld-none">—</span>
              </div>
            </div>
          </div>
        </section>
      </template>
      <MkEmptyState
        v-else
        icon="◌"
        title="暂无认知画像数据"
        description="重算快照后由知识记忆服务生成；画像/派生洞察等卡将随快照一起更新。"
        action-text="重算快照"
        :action-busy="recomputing"
        @action="recompute"
      />
    </div>

    <!-- ============ 证据：指标卡横排 + 左时间线 / 右曲线·建议·密度 两栏 ============ -->
    <div v-else-if="tab === 'evidence'" class="ld-tabpage">
      <template v-if="dynamicState">
        <div class="ld-metrics">
          <MkKpi
            v-for="m in metricCards"
            :key="m.label"
            :label="m.label"
            :value="m.value"
            :hint="m.hint"
            :tone="m.tone"
          />
        </div>
      </template>

      <div class="ld-ev-grid">
        <!-- 左栏：证据时间线（主内容） -->
        <section class="mk-card ld-ev-main">
          <div class="mk-card__head">
            <h3 class="mk-card__title">证据时间线</h3>
            <!-- 标注「仅最近 20 条」：接口侧 limit=20（live.ts liveGetLearnerEvidence），列表非全量，防「共 N 条」误读 -->
            <span class="mk-card__meta">{{ evidence.length }} 条学习事件（仅最近 20 条）· 点色=信号，条=置信</span>
          </div>
          <!-- T2 硬约束 2「结论与细节分层」：结论行常驻可见，明细折叠。
               结论文字完全取自本卡已有数据（条数 + 卡片里本来就标的「证据不足」），未新增判断。
               P2 口径：「共 N 条」改「最近 N 条」——接口侧 limit=20，列表不是全量 -->
          <p v-if="evidence.length" class="mk-section__conclusion">
            最近 {{ evidence.length }} 条学习事件（接口窗口上限 20），其中
            {{ evidence.filter((e) => evidenceLowConfidence(e.score) && !isDomainEvidence(e.title)).length }} 条置信度低于 50%（仅供参照）。
          </p>
          <!-- T2「结论与细节分层」：结论行常驻，明细可折叠；默认展开——
               折着的时间线让左栏只剩一行结论、主视区大面积空白（实测 19 条事件全收在折叠里）。
               P2：带 sessionId 的行可点下钻只读座舱（与教学会话 pane 同一 openSessionCockpit） -->
          <details v-if="evidence.length" class="ld-ev-details" open>
            <summary class="mk-section__summary">逐条明细</summary>
            <div class="ld-evidence">
            <div
              v-for="(e, i) in evidence"
              :key="i"
              class="ld-ev"
              :class="{ 'ld-ev--link': !!e.sessionId }"
              :role="e.sessionId ? 'button' : undefined"
              :tabindex="e.sessionId ? 0 : undefined"
              :title="e.sessionId ? '点击打开该事件的会话座舱' : undefined"
              @click="e.sessionId && openSessionCockpit(e.sessionId)"
              @keydown.enter="e.sessionId && openSessionCockpit(e.sessionId)"
            >
              <span class="ld-ev__rail" aria-hidden="true"></span>
              <span
                class="ld-ev__dot"
                :class="`is-${evidenceDotTone(e.signal, e.score, e.title)}`"
                :title="evidenceFullTooltip(e.title, e.signal, e.score, { sessionId: e.sessionId, taskId: e.taskId, happenedAt: e.happenedAt })"
              ></span>
              <div class="ld-ev__main">
                <div class="ld-ev__top">
                  <strong>{{ evidenceTypeZh(e.title) }}</strong>
                  <span class="ld-ev__signal" :class="`is-${evidenceDotTone(e.signal, e.score, e.title)}`">{{ evidenceSignalZh(e.signal, e.title) || '—' }}</span>
                  <span v-if="evidenceLowConfidence(e.score) && !isDomainEvidence(e.title)" class="ld-ev__lack" title="置信度低于 50%，结论仅供参考">证据不足</span>
                </div>
                <span v-if="e.detail" class="ld-ev__detail">{{ e.detail }}</span>
                <span class="ld-ev__conf" :title="evidenceFullTooltip(e.title, e.signal, e.score, { sessionId: e.sessionId, taskId: e.taskId, happenedAt: e.happenedAt })">
                  <i
                    class="ld-ev__confbar"
                    :class="`is-${evidenceConfidenceTone(e.score)}`"
                    :style="{ width: Math.max(3, Math.round(e.score * 100)) + '%' }"
                  ></i>
                  <em>{{ Math.round(e.score * 100) }}%</em>
                </span>
                <span v-if="e.concepts.length" class="ld-chips">
                  <span v-for="c in e.concepts.slice(0, 4)" :key="c" class="ld-chip">{{ c }}</span>
                </span>
                <span v-if="e.sessionId || e.taskId" class="ld-ev__src">
                  {{ e.sessionId ? `会话 ${shortId(e.sessionId)}` : '' }}{{ e.sessionId && e.taskId ? ' · ' : '' }}{{ e.taskId ? `任务 ${shortId(e.taskId)}` : '' }}
                </span>
              </div>
              <span class="ld-ev__time">{{ e.time }}</span>
            </div>
          </div>
          </details>
          <p v-else class="ld-none">
            {{ '暂无证据记录' }}
            <span class="ld-none__hint">学习事件累积后自动生成。</span>
          </p>
        </section>

        <!-- 右栏：压力曲线（上移）+ 趋势与建议 + 概念证据密度 -->
        <div class="ld-ev-side">
          <!-- 学习压力记录曲线：LSS/LF/LSB 真实指标历史（learning_metrics），与指标卡同源 -->
          <section class="mk-card ld-load">
            <div class="mk-card__head">
              <h3 class="mk-card__title">学习压力记录</h3>
              <div class="ld-load__controls">
                <div class="mk-seg">
                  <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': loadRange === 42 }" @click="loadRange = 42">42 天</button>
                  <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': loadRange === 90 }" @click="loadRange = 90">90 天</button>
                </div>
              </div>
            </div>
            <div v-if="hasLoad" class="ld-load__body">
              <div class="ld-load__legend">
                <span><i class="ld-load__dot is-lss"></i>LSS 压力</span>
                <span><i class="ld-load__dot is-lf"></i>LF 疲劳</span>
                <span><i class="ld-load__dot is-lsb"></i>LSB 状态</span>
                <span v-if="loadDisplayDay" class="ld-load__chip" :class="`ld-load__chip${loadZoneCls(loadZoneOf(loadDisplayDay))}`">
                  {{ loadZoneCls(loadZoneOf(loadDisplayDay)) === '--fresh' ? '状态良好' : loadZoneCls(loadZoneOf(loadDisplayDay)) === '--optimal' ? '需要休息' : '高风险' }}
                </span>
              </div>
              <MkChart :option="loadChartOption" height="260px" />
              <div v-if="loadDisplayDay" class="ld-load__info">
                <b>{{ loadDisplayDay.label }}</b>
                <span class="is-lss-t">LSS {{ loadFmt(loadDisplayDay.lss) }}</span>
                <span class="is-lf-t">LF {{ loadFmt(loadDisplayDay.lf) }}</span>
                <span class="is-lsb-t">LSB {{ loadFmt(loadDisplayDay.lsb) }}</span>
              </div>
              <div class="ld-load__zones">
                <span><i class="ld-load__dot is-lss"></i>LSS 学习压力（0-10，越高越累）</span>
                <span><i class="ld-load__dot is-lf"></i>LF 疲劳度（0-10，≥6 警戒）</span>
                <span><i class="ld-load__dot is-lsb"></i>LSB 状态平衡（KTL-LF，负=状态差）</span>
              </div>
            </div>
            <div v-else class="ld-none">
              {{ '暂无压力记录' }}
              <span class="ld-none__hint">学习者完成会话/任务后，系统会记录每次的压力评估。</span>
            </div>
          </section>

          <section v-if="dynamicState" class="mk-card">
            <div class="mk-card__head"><h3 class="mk-card__title">趋势与建议</h3></div>
            <div class="ld-kv">
              <div v-for="kv in dynamicRows" :key="kv.label" class="ld-kv__row">
                <span>{{ kv.label }}</span>
                <strong>{{ kv.value }}</strong>
              </div>
            </div>
          </section>

          <!-- 概念证据密度：概念名 + 证据条 + 计数；有证据置顶、无证据折叠 -->
          <section v-if="conceptStats.length" class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">概念证据密度</h3>
              <span class="mk-card__meta">各概念关联的学习事件数</span>
            </div>
            <div class="ld-bars ld-bars--dense">
              <div v-for="c in conceptStats" :key="c.label" class="ld-bar" :class="{ 'ld-bar--empty': c.count === 0 }">
                <div class="ld-bar__head">
                  <strong :title="evidenceDensityTooltip(c.label, c.count)">{{ c.label }}</strong>
                  <span class="ld-bar__badges">
                    <span class="ld-bar__ev" :class="{ 'ld-bar__ev--zero': c.count === 0 }" :title="evidenceDensityTooltip(c.label, c.count)">
                      {{ c.count === 0 ? '暂无' : `${c.count} 条` }}
                    </span>
                  </span>
                </div>
                <span class="mk-minibar ld-bar__track">
                  <i class="mk-minibar__fill" :data-tone="c.tone === 'muted' ? undefined : c.tone" :class="{ 'ld-bar__fill--muted': c.tone === 'muted' }" :style="{ width: c.width + '%' }"></i>
                </span>
              </div>
            </div>
          </section>
          <!-- 预测校准：实证命中率 + 校准分布 + 最近预测 vs 实际 -->
          <section v-if="predictionCalib && (predictionCalib.stats.total > 0 || predictionCalib.recent.length)" class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">预测校准</h3>
              <!-- 结论常驻：卡头给结论（就地派生），原「非自报置信度」说明降级到 title -->
              <span class="mk-card__meta" title="预测器实证命中率（非自报置信度）">{{ calibConclusion }}</span>
            </div>
            <div class="ld-cal">
              <div class="ld-cal__hits">
                <div class="ld-cal__hit">
                  <span>卡壳命中率</span>
                  <strong :class="calHitCls(predictionCalib?.stats.stallHitRate)">
                    {{ predictionCalib?.stats.stallHitRate != null ? `${Math.round(predictionCalib.stats.stallHitRate * 100)}%` : '—' }}
                  </strong>
                  <em>n={{ predictionCalib?.stats.total ?? 0 }}{{ (predictionCalib?.stats.total ?? 0) < 5 ? ' · 样本不足' : '' }}</em>
                </div>
                <div class="ld-cal__hit">
                  <span>基调命中率</span>
                  <strong :class="calHitCls(predictionCalib?.stats.toneHitRate)">
                    {{ predictionCalib?.stats.toneHitRate != null ? `${Math.round(predictionCalib.stats.toneHitRate * 100)}%` : '—' }}
                  </strong>
                  <em>&nbsp;</em>
                </div>
              </div>
              <details class="ld-cal-details">
                <summary class="mk-section__summary">校准分布与最近预测</summary>
                <div class="ld-cal__buckets">
                <div v-for="b in predictionCalib?.stats.calibration ?? []" :key="b.range" class="ld-cal__bucket">
                  <span class="ld-cal__range">{{ b.range }}</span>
                  <span class="mk-minibar ld-cal__bar"><i class="mk-minibar__fill" data-tone="warn" :style="{ width: calBarWidth(b) }"></i></span>
                  <span class="ld-cal__val">{{ b.hardRate != null ? `${Math.round(b.hardRate * 100)}%` : '—' }} (n={{ b.n }})</span>
                </div>
              </div>
              <div v-if="predictionCalib?.recent?.length" class="ld-cal__recent">
                <div v-for="p in predictionCalib.recent.slice(0, 5)" :key="p.id" class="ld-cal__row">
                  <span class="ld-cal__task" :title="p.rationale">{{ shortId(p.taskId) || '任务' }}</span>
                  <span class="ld-cal__risk">风险 {{ Math.round(p.stallRisk * 100) }}%</span>
                  <span class="ld-cal__outcome" :class="calOutcomeCls(p.outcome)">
                    {{ calOutcomeZh(p.outcome) }}
                  </span>
                </div>
              </div>
              </details>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- ============ 知识图谱：概念图画布（节点=概念，边=前置/属于）
         卡片走 .mk-card 原语（原 ld-card* 是不存在的私有类，渲染成无样式裸块） ============ -->
    <div v-else-if="tab === 'graph'" class="ld-tabpage">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">知识图谱</h3>
          <span v-if="graphMeta" class="mk-card__meta">
            <template v-if="graphMeta.truncated">已截断，共 {{ graphMeta.totalConcepts }} 个概念 · </template>
            默认展示全部路径的聚合图
          </span>
        </div>
        <MkGraphExplorer
          :nodes="graphNodes"
          :edges="graphEdges"
          :paths="graphMeta?.paths ?? []"
          :path-id="graphPathId"
          :theme="graphTheme"
          :loading="graphLoading"
          :error="graphError"
          height="560px"
          empty-hint="这位学习者还没有概念图数据——路径生成后 kc-mapper 会产出前置依赖，随概念身份注册表物化进图。"
          @update:path-id="onGraphPathChange"
        />
      </section>
    </div>

    <!-- ============ 学习路径（原型 renderLearnerDetail 2165-2171）：路径卡栅格 → PathDetail ============ -->
    <div v-else-if="tab === 'paths'" class="ld-tabpage">
      <section v-if="pathInfo && pathInfo.id" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">学习路径</h3>
          <span class="mk-card__meta">当前路径快照</span>
        </div>
        <div class="ld-pathgrid">
          <button type="button" class="ld-pathcard" @click="openPathDetail">
            <div class="ld-pathcard__top">
              <strong>{{ pathInfo.title || '未命名路径' }}</strong>
              <span class="mk-badge" :class="`mk-badge--${pathStatus.tone}`">{{ pathStatus.text }}</span>
            </div>
            <div class="ld-pathcard__mid">
              <span class="ld-pathcard__step">{{ pathInfo.task || pathInfo.stage || '—' }}</span>
              <span class="ld-pathcard__mono">{{ pathInfo.done }} / {{ pathInfo.total }} 里程碑</span>
            </div>
            <span class="mk-minibar ld-pathcard__meter">
              <i class="mk-minibar__fill" :data-tone="pathInfo.pct >= 100 ? 'ok' : undefined" :style="{ width: pathInfo.pct + '%' }"></i>
            </span>
          </button>
        </div>
      </section>
      <!-- 空态 CTA：原型为「发起目标对话」，但本页没有目标对话入口；改用可执行的重算快照（路径由快照物化） -->
      <MkEmptyState
        v-else
        icon="◌"
        title="还没有学习路径"
        description="为这位学习者澄清目标后，路径会在这里出现。"
        action-text="重算快照"
        :action-busy="recomputing"
        @action="recompute"
      />
    </div>

    <!-- ============ 教学会话（原型 2172-2177）：7 列表格，行点击进会话座舱 ============ -->
    <div v-else-if="tab === 'sessions'" class="ld-tabpage">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">教学会话</h3>
          <span class="mk-card__meta" title="口径：该学习者最近 20 条教学会话窗口；阶段=后端按里程碑归因">
            <MkLoading v-if="ldSessLoading" inline min text="加载中…" />
            <template v-else>{{ ldSessError ? '加载失败' : (ldStageFilter === 'all' ? `${ldSessionRows.length} 条` : `${ldSessionRowsFiltered.length} / ${ldSessionRows.length} 条`) }}</template>
          </span>
        </div>
        <!-- 阶段切换器：档位与计数从会话窗口派生（见 ldStageChips）；单阶段不渲染 -->
        <div v-if="!ldSessLoading && !ldSessError && ldStageChips.length > 1" class="ld-stagechips" role="group" aria-label="按阶段筛选会话">
          <button
            type="button" class="mk-pill" :class="{ 'mk-pill--active': ldStageFilter === 'all' }"
            :aria-pressed="ldStageFilter === 'all'" @click="ldStageFilter = 'all'"
          >全部 · {{ ldSessionRows.length }}</button>
          <button
            v-for="c in ldStageChips" :key="c.key" type="button" class="mk-pill"
            :class="{ 'mk-pill--active': ldStageFilter === c.key }" :aria-pressed="ldStageFilter === c.key"
            @click="ldStageFilter = c.key"
          >{{ c.label }} · {{ c.count }}</button>
        </div>
        <div v-if="ldSessionRows.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <!-- P2 列序纠偏：主题是人读的行身份，裸 UUID 首列没有判读价值——主题置首，
                   会话 ID 缩短为末列（title 保留全 ID） -->
              <tr><th>主题</th><th>Skill</th><th>阶段</th><th>回合</th><th>时长</th><th>状态</th><th>时间</th><th>会话 ID</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in ldSessionRowsFiltered" :key="s.id" class="ld-pane-row" @click="openSessionCockpit(s.id)">
                <td class="ld-strong" :title="s.topic">{{ s.topic }}</td>
                <td>{{ s.skill }}</td>
                <td><span class="mk-badge mk-badge--info">{{ s.stage }}</span></td>
                <td class="ld-mono" title="口径：用户消息条数（后端无独立回合计数）">{{ s.turns }}</td>
                <td class="ld-mono">{{ s.duration }}</td>
                <td><span class="mk-badge" :class="sessPaneBadgeCls(s.status)">{{ statusText(s.status) || '—' }}</span></td>
                <td class="ld-mono ld-sub">{{ s.startAgo }}</td>
                <td class="ld-mono ld-sub" :title="s.id">{{ shortId(s.id) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <MkEmptyState v-else icon="◌" title="暂无教学会话" description="该学习者还没有产生回合记录。" />
      </section>
    </div>

    <!-- ============ 记忆与复习（原型 2178-2183）：6 列表格（FSRS 单源） ============ -->
    <div v-else-if="tab === 'memory'" class="ld-tabpage">
      <section v-if="memoryPaneRows.length" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">记忆与复习（FSRS）</h3>
          <button type="button" class="mk-link" @click="goMemoryReview">打开记忆与复习 →</button>
        </div>
        <div class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr><th>知识点</th><th>记忆强度</th><th>复习到期</th><th>来源</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in memoryPaneRows" :key="r.key">
                <td class="ld-strong">{{ r.label }}</td>
                <td>
                  <span v-if="r.strength != null" class="ld-mt">
                    <span class="mk-minibar ld-mt__bar">
                      <i class="mk-minibar__fill" :data-tone="r.tone === 'info' ? undefined : r.tone" :style="{ width: r.strength + '%' }"></i>
                    </span>
                    <em>{{ r.strength }}%</em>
                  </span>
                  <span v-else class="ld-none">未初始化</span>
                </td>
                <td class="ld-sub" :title="r.dueAbs || undefined">{{ r.due }}</td>
                <td class="ld-sub" title="后端无出处字段，以提取次数/最近提取时间近似标注">{{ r.source }}</td>
                <td><span class="mk-badge" :class="`mk-badge--${r.tone}`">{{ r.stateText }}</span></td>
                <td>
                  <!-- 后端无单点复习接口 → 深链记忆与复习页（userId 契约见 memoryReviewUrl） -->
                  <button type="button" class="mk-btn mk-btn--sm" @click="goMemoryReview">复习</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <MkEmptyState v-else icon="◌" title="暂无记忆数据" description="该学习者还没有 FSRS 记忆痕迹；完成教学回合后自动生成。" />
    </div>

    <!-- ============ 操作记录（原型 2184-2187）：feed/feedrow；口径见注释 ============ -->
    <div v-else-if="tab === 'audit'" class="ld-tabpage">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">操作记录</h3>
          <span class="mk-card__meta">学习事件时间线 · 最近 {{ auditRows.length }} 条</span>
        </div>
        <div v-if="auditRows.length" class="ld-feed">
          <div v-for="(a, i) in auditRows" :key="i" class="ld-feedrow">
            <span class="ld-feedrow__time">{{ a.time }}</span>
            <div class="ld-feedrow__main">
              <span class="ld-feedrow__action">{{ a.action }}</span>
              <span class="ld-feedrow__detail">{{ a.detail }}</span>
            </div>
          </div>
        </div>
        <MkEmptyState v-else icon="◌" title="暂无操作记录" description="该学习者还没有学习事件流水。" />
      </section>
      <!-- 口径标注：后台无管理侧审计流水接口；此处为学习事件（learner_evidence），非管理员操作审计 -->
      <p class="ld-none">
        口径说明：后台暂未提供管理侧审计流水接口，本页以学习者学习事件（learner_evidence）如实渲染，语义为「学习事件」而非「管理员操作审计」。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { subPage, openSubPage, setSubPageLabel } from './store'
import { liveLearners, liveGetLearnerDetail, liveGetLearnerEvidence, liveGetLearnerPredictions, liveRecomputeLearner, liveGetMemoryTraces, timeAgo, errMsg, type LearnerEvidenceRaw, type LoadCurvePoint, type PredictionCalibration, type MemoryTraceRow } from './live'
import { evidenceDotTone, evidenceLowConfidence, evidenceSignalZh, evidenceTypeZh, evidenceFullTooltip, evidenceConfidenceTone, evidenceDensityTooltip } from './evidence'
import { conceptBarTone, conceptBarWidth, memoryReviewUrl, transferReadinessZh, misconceptionRiskZh, normalizeLearnerTab, levelWordZh, levelBadgeZh } from './learner-profile'
import { adminMemoryReviewApi, adminTeachingSessionsApi, getUserIncludingDeleted } from '@/api/adminApi'
import { statusText } from './statusText'
import type { ConceptBarTone, ConceptLedgerItem, LearnerTab } from './learner-profile'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import type { EChartsCoreOption } from 'echarts/core'
import MkChart from '@/components/mk/MkChart.vue'
import MkGraphExplorer from '@/components/mk/MkGraphExplorer.vue'
import type { MkGraphNode, MkGraphEdge } from '@/components/mk/MkGraph.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'
import MkRowList from '@/components/mk/MkRowList.vue'
import MkRow from '@/components/mk/MkRow.vue'
import { useIsDark } from '@/composables/useIsDark'
import { MK_CHART_PALETTES } from '@/components/mk/chartPalette'

const isDark = useIsDark()

interface Detail {
  name: string
  email: string
  trend: 'up' | 'down' | 'flat'
  fatigue: string
  path: string
  stage: string
  task: string
  pct: number
  /** 进度分母口径（P2 双分母标注）：pct 按路径全部任务折算，与「当前里程碑」行的里程碑内分母区分 */
  taskDone: number
  taskTotal: number
  concepts: { mastered: string[]; struggling: string[]; fragile: string[] }
  sessions: { time: string; title: string; result: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; concepts?: string[] }[]
  snapshot: { version: string; generatedAt: string }
}

interface EvidenceItem {
  title: string
  detail: string
  time: string
  score: number
  signal: string
  concepts: string[]
  sessionId?: string
  taskId?: string
  happenedAt?: string
}

const liveDetail = ref<Detail | null>(null)
const rawDetail = ref<Record<string, unknown> | null>(null)
const liveEvidence = ref<EvidenceItem[]>([])
const memoryTraces = ref<MemoryTraceRow[]>([])
/** 学习压力记录曲线：learning_metrics 历史（LSS/KTL/LF/LSB），来自 evidence 接口 loadCurve */
const loadCurveRaw = ref<LoadCurvePoint[]>([])
/** 预测校准（实证命中率 + 最近预测），异步加载失败为 null */
const predictionCalib = ref<PredictionCalibration | null>(null)
const recomputing = ref(false)

/**
 * 页签（原型 renderLearnerDetail 2159-2163：subtabs 由 4 项扩到 8 项）。
 * 名称对齐原型：总览→概览、知识图谱→图谱；新增 学习路径/教学会话/记忆与复习/操作记录。
 * 新增 id 只在本页扩展——共享的 learner-profile.ts `LearnerTab` 仍是 4 项联合（未改动），
 * 本地 normalizeLdTab 先识别 8 项，再回落共享 normalizeLearnerTab 处理旧 6-tab 深链重定向。
 */
const LD_TAB_IDS = ['overview', 'profile', 'evidence', 'graph', 'paths', 'sessions', 'memory', 'audit'] as const
type LdTab = (typeof LD_TAB_IDS)[number] | LearnerTab
function isLdTab(v: unknown): v is (typeof LD_TAB_IDS)[number] {
  return typeof v === 'string' && (LD_TAB_IDS as readonly string[]).includes(v)
}
function normalizeLdTab(v: unknown): LdTab {
  const s = String(v || '').toLowerCase()
  return isLdTab(s) ? s : normalizeLearnerTab(s)
}

const tab = ref<LdTab>('overview')

const tabs = [
  { id: 'overview' as const, label: '概览' },
  { id: 'profile' as const, label: '画像' },
  { id: 'evidence' as const, label: '证据' },
  { id: 'graph' as const, label: '图谱' },
  { id: 'paths' as const, label: '学习路径' },
  { id: 'sessions' as const, label: '教学会话' },
  { id: 'memory' as const, label: '记忆与复习' },
  { id: 'audit' as const, label: '操作记录' }
]

/* ── 知识图谱（概念图画布）：进入 tab 才加载，避免给总览页拖一个额外请求 ── */
const graphNodes = ref<MkGraphNode[]>([])
const graphEdges = ref<MkGraphEdge[]>([])
const graphMeta = ref<{ nodeCount: number; edgeCount: number; totalConcepts: number; truncated: boolean; paths: Array<{ id: string; title: string | null }> } | null>(null)
const graphLoading = ref(false)
const graphError = ref('')
/** 路径筛选：空 = 全部路径（用户级聚合图）。切换要重新请求——后端按 pathId 收敛节点与边 */
const graphPathId = ref<string | null>(null)
/** 当前学习路径 ID（currentPath.learningPathId / 列表兜底 base.pathId）：路径详情下钻用 */
const currentPathId = ref<string | null>(null)
/**
 * 学习路径 pane 的卡数据（原型 2165-2171）：直接来自快照 currentPath 与列表兜底，
 * 不复用「当前进度」卡 DOM——它已是该学习者能拿到的全部路径信息（快照只存当前路径）。
 */
const pathInfo = ref<{ id: string | null; title: string; stage: string; task: string; done: number; total: number; pct: number } | null>(null)
/** 学习者画像 kv 卡：用户详情补充的层级/路径数/注册时间（后端 findUserDetailForAdmin） */
const userRecord = ref<{ currentLevel: string; xp: number; pathCount: number; createdAt: string } | null>(null)
/** 跟随 admin 主题（暗色用同族配色，见 MkGraph 的 colorOf） */
const graphTheme = computed<'light' | 'dark'>(() =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
)
async function loadConceptGraph(userId: string, pathId: string | null = graphPathId.value) {
  if (!userId) return
  graphLoading.value = true
  graphError.value = ''
  try {
    const res = await adminMemoryReviewApi.conceptGraph(userId, pathId ? { pathId } : undefined)
    const data = res?.data?.data ?? res?.data ?? {}
    graphNodes.value = Array.isArray(data.nodes) ? data.nodes : []
    graphEdges.value = Array.isArray(data.edges) ? data.edges : []
    graphMeta.value = data.meta ?? null
  } catch (error) {
    graphError.value = `概念图加载失败：${errMsg(error)}`
    graphNodes.value = []
    graphEdges.value = []
    graphMeta.value = null
  } finally {
    graphLoading.value = false
  }
}
/** 路径下拉：切路径即重新拉取（不清空旧图，避免闪白） */
function onGraphPathChange(pathId: string | null) {
  graphPathId.value = pathId
  const id = subPage.value?.id
  if (id) void loadConceptGraph(String(id), pathId)
}
// 进入图 tab 时按需加载（同一学习者只加载一次；切走不清空，回来即见）
watch([tab, () => subPage.value?.id], ([t, id], [, prevId]) => {
  // 换学习者：路径筛选与选中态都要复位，否则会带着上一个人的 pathId 去查
  if (prevId && prevId !== id) graphPathId.value = null
  if (t === 'graph' && id && !graphNodes.value.length && !graphLoading.value) void loadConceptGraph(String(id))
})

/* P0-2 tab 路由化：?tab= 深链/刷新保持（与 subPage 的 view/id 同级，不侵入 AdminConsole 机制） */
const tabRoute = useRoute()
const tabRouter = useRouter()
// URL → tab（深链/刷新/前进后退）
watch(
  () => tabRoute.query.tab,
  (t) => {
    if (typeof t === 'string' && t && t !== tab.value) tab.value = normalizeLdTab(t)
  },
  { immediate: true }
)
// tab → URL（replace：不污染历史栈）
watch(tab, (t) => {
  const cur = tabRoute.query.tab
  const target = t === 'overview' ? undefined : t
  if (cur !== target) void tabRouter.replace({ query: { ...tabRoute.query, ...(target ? { tab: target } : {}) } })
})

/** 深链兼容：旧 6-tab 名（cognitive/dynamic/memory/teaching）重定向到新 tab（本地 8 项优先） */
function switchTab(id: string) {
  tab.value = normalizeLdTab(id)
}

/** 详情加载：成功全量数据；失败但有列表兜底 → 显示兜底；失败且无兜底 → 明确错误态 */
const detailError = ref(false)
/** 请求超时保护：详情接口挂起时不再无限「加载中…」，超时后走兜底/错误态 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('详情请求超时')), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/** 详情加载序号：id 快速切换时旧请求后到会覆盖新数据——last-wins 守卫（忙时新加载不被丢弃，直接重跑） */
let detailLoadSeq = 0
/** 上次成功发起加载的学习者 id：区分「换人」与「同人重算」 */
let lastLoadedId: string | null = null

/** 换学习者时清空派生 state：graphNodes/predictionCalib/memoryTraces/loadCurveRaw 等是
    异步独立加载的模块级 ref，不重置会把上一个人的图谱/校准/压力曲线渲染到新详情页上 */
function resetDerivedState(id: string) {
  liveDetail.value = null
  rawDetail.value = null
  liveEvidence.value = []
  memoryTraces.value = []
  loadCurveRaw.value = []
  predictionCalib.value = null
  ldSessionRows.value = []
  currentPathId.value = null
  pathInfo.value = null
  userRecord.value = null
  // 图谱仅在进入 graph tab 时按需加载（无 watch 兜底重拉）：
  // 只在真正换人时清空；同人重算/刷新若也清空会留下一张再不加载的空图
  if (id !== lastLoadedId) {
    graphNodes.value = []
    graphEdges.value = []
    graphMeta.value = null
    graphPathId.value = null
  }
}

// ===== 最近会话（概览左栏 + 教学会话 pane；teaching-sessions 支持 userId 过滤，行点击下钻只读座舱） =====
interface LdSessionRow {
  id: string
  topic: string
  subText: string
  status: string
  startAgo: string
  /** 教学会话 pane：Skill 列（后端 subject / taskType） */
  skill: string
  /** 教学会话 pane：阶段列（后端 progress 里程碑序号，deriveTeachingSessionProgress 推导） */
  stage: string
  /** 阶段切换器用数值序号（stage 展示串之外的原始 milestoneIndex；缺省 null 不入档） */
  msIndex: number | null
  /** 教学会话 pane：回合列（口径=用户消息条数，后端无独立回合计数） */
  turns: string
  /** 教学会话 pane：时长列（后端 duration，秒） */
  duration: string
}
const ldSessionRows = ref<LdSessionRow[]>([])
/** 概览左栏「最近会话」卡只取前 5 条；教学会话 pane 用全量（同源） */
const recentSessionRows = computed(() => ldSessionRows.value.slice(0, 5))

/* ---------- 阶段切换器（用户诉求「切换学习者不同阶段」）----------
   档位从会话行的 milestoneIndex 派生（后端 deriveTeachingSessionProgress 已归因，零新契约）；
   只有一个阶段时不渲染切换器（单档即全部，无筛选价值）。 */
const ldStageFilter = ref<string>('all')
const ldStageChips = computed(() => {
  const counts = new Map<number, number>()
  for (const r of ldSessionRows.value) if (r.msIndex != null) counts.set(r.msIndex, (counts.get(r.msIndex) || 0) + 1)
  return [...counts.keys()].sort((a, b) => a - b).map((i) => ({ key: String(i), label: `里程碑 ${i}`, count: counts.get(i) as number }))
})
const ldSessionRowsFiltered = computed(() => {
  if (ldStageFilter.value === 'all') return ldSessionRows.value
  const idx = Number(ldStageFilter.value)
  return ldSessionRows.value.filter((r) => r.msIndex === idx)
})
const ldSessLoading = ref(false)
const ldSessError = ref(false)
/** 状态徽章降噪（对齐 TeachingSessions.statusBadge）：仅异常态上色，正常态灰 */
const sessBadgeCls = (s: string) =>
  s === 'failed' || s === 'timeout' || s === 'discarded' || s === 'finalization_failed'
    ? 'mk-badge--bad'
    : s === 'superseded'
      ? 'mk-badge--warn'
      : 'mk-badge--muted'

function openSessionCockpit(sessionId: string) {
  const sp = subPage.value
  openSubPage('session-real', sessionId, sp ? { from: { view: sp.view, id: sp.id, label: liveDetail.value?.name } } : undefined)
}

/** 会话时长（后端 duration 秒）→ mm 分 ss 秒；0/缺省显 — */
function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}

/** 教学会话 pane 状态徽章：完成绿 / 进行中蓝 / 异常红 / 被替代琥珀 / 其余灰（与普通状态文案同字典） */
function sessPaneBadgeCls(s: string): string {
  if (s === 'completed' || s === 'done' || s === 'succeeded' || s === 'success') return 'mk-badge--ok'
  if (s === 'active' || s === 'running' || s === 'in_progress' || s === 'started') return 'mk-badge--info'
  if (s === 'failed' || s === 'timeout' || s === 'discarded' || s === 'finalization_failed') return 'mk-badge--bad'
  if (s === 'superseded' || s === 'paused') return 'mk-badge--warn'
  return 'mk-badge--muted'
}

/** 当前学习路径 → 路径详情二级页（只认真实 pathId；缺 ID 时入口不渲染） */
function openPathDetail() {
  if (currentPathId.value) openSubPage('path', currentPathId.value)
}

async function loadLdSessions(id: string) {
  const seq = detailLoadSeq
  ldSessLoading.value = true
  ldSessError.value = false
  const stale = () => seq !== detailLoadSeq || subPage.value?.id !== id
  try {
    // limit 20：教学会话 pane 需要更完整列表（原概览卡只展示 5 条，由 recentSessionRows 截取）
    const res = await adminTeachingSessionsApi.list({ userId: id, limit: 20, includeTest: subPage.value?.includeTest })
    // 竞态守卫与 loadDetail 同款：换人/重载后丢弃旧响应
    if (stale()) return
    const body = res.data?.data ?? res.data ?? {}
    ldSessionRows.value = ((body.items as Record<string, unknown>[]) || []).map((s) => {
      const progress = (s.progress || null) as { milestoneIndex?: number; totalMilestones?: number } | null
      return {
        id: String(s.id),
        topic: String(s.topic || s.taskId || '未命名会话'),
        subText: `${String(s.subject || '—')} · ${Number(s.messageCount || 0)} 条消息`,
        status: String(s.status || ''),
        startAgo: timeAgo(String(s.startTime || '')),
        skill: String(s.subject || s.taskType || '—'),
        stage: progress && progress.totalMilestones ? `里程碑 ${progress.milestoneIndex || 0}/${progress.totalMilestones}` : '—',
        msIndex: progress && typeof progress.milestoneIndex === 'number' && progress.milestoneIndex > 0 ? progress.milestoneIndex : null,
        turns: String(Number(s.messageCount || 0)),
        duration: formatDuration(Number(s.duration || 0))
      }
    })
    // 换人/重载后旧筛选档可能已不存在（阶段集合随会话窗口变化）→ 回到「全部」
    if (!ldStageChips.value.some((c) => c.key === ldStageFilter.value)) ldStageFilter.value = 'all'
  } catch {
    if (!stale()) ldSessError.value = true
  } finally {
    if (!stale()) ldSessLoading.value = false
  }
}

async function loadDetail(id: string | undefined) {
  if (!id) return
  const seq = ++detailLoadSeq
  resetDerivedState(id)
  lastLoadedId = id
  detailError.value = false
  // 深链保持：URL 明确带 ?tab= 时尊重它，否则回落总览。
  // （此前无条件置 'overview'，会把 ?tab=profile/evidence/graph 的深链与刷新全部冲掉——
  //  与上方「P0-2 tab 路由化：?tab= 深链/刷新保持」的约定相矛盾，实测发现。）
  const urlTab = typeof tabRoute.query.tab === 'string' ? tabRoute.query.tab.trim() : ''
  tab.value = urlTab ? normalizeLdTab(urlTab) : 'overview'
  const base = liveLearners.value.find((l) => l.userId === id)
  const pathId = base?.pathId
  // 从用户详情显式进入学习者画像时携带 includeTest（虚拟/测试账号可查，默认视图仍排除）
  const includeTest = subPage.value?.includeTest
  // 面包屑先以列表兜底名回写（详情加载成功后覆盖为详情名）
  if (base?.name) setSubPageLabel(base.name)
  // 竞态守卫：任一 await 之后 id 已变（或已触发更新的加载）→ 丢弃本响应
  const stale = () => seq !== detailLoadSeq || subPage.value?.id !== id
  try {
    // 详情与证据并行（此前串行 await：两个独立接口白等一趟 RTT）
    const [raw, evidenceRes] = await Promise.all([
      withTimeout(liveGetLearnerDetail(id, pathId, includeTest), 12000) as Promise<Record<string, unknown>>,
      liveGetLearnerEvidence(id, pathId, includeTest).catch(() => ({ items: [], domain: [], loadCurve: [] }))
    ])
    if (stale()) return
    const model = (raw.model as Record<string, unknown>) || raw
    const km = ((model.knowledgeMemory as Record<string, unknown>) || (raw.knowledgeMemory as Record<string, unknown>) || {}) as Record<string, unknown>
    const currentPath = (km.currentPath || {}) as Record<string, unknown>
    // 路径详情下钻的真实 ID：优先快照里的 currentPath.learningPathId，列表兜底 base.pathId
    currentPathId.value = String(currentPath.learningPathId || base?.pathId || '') || null
    const progress = (currentPath.progress || {}) as Record<string, number>
    const globalSignals = (km.globalSignals || {}) as Record<string, unknown>
    const conceptStates = Array.isArray(currentPath.conceptStates)
      ? (currentPath.conceptStates as { label?: string; status?: string }[])
      : []
    const totalTasks = Number(progress.totalTasks || 0)
    const completedTasks = Number(progress.completedTasks || 0)
    const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    // 学习路径 pane 卡数据：快照 currentPath + 列表兜底（快照只含当前路径，故栅格通常单卡）
    pathInfo.value = {
      id: currentPathId.value,
      title: String((currentPath.pathTitle as string) || model.pathTitle || ''),
      stage: base?.currentMilestone || String(progress.totalMilestones ? `已完成 ${progress.completedMilestones ?? 0}/${progress.totalMilestones} 个里程碑` : ''),
      task: base?.currentTask || '',
      done: Number(progress.completedMilestones || 0),
      total: Number(progress.totalMilestones || 0),
      pct
    }
    const mapEvidence = (e: Record<string, unknown>): EvidenceItem => {
      const raw = e as LearnerEvidenceRaw
      return {
        title: String(raw.type || raw.kind || '学习事件'),
        detail: String(raw.detail || raw.signal || ''),
        time: timeAgo(String(raw.happenedAt || raw.createdAt || '')),
        signal: String(raw.signal || ''),
        score: Number(raw.score || 0),
        concepts: Array.isArray(raw.conceptKeys) ? raw.conceptKeys.map(String) : [],
        sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
        taskId: raw.taskId ? String(raw.taskId) : undefined,
        happenedAt: raw.happenedAt ? String(raw.happenedAt) : undefined
      }
    }
    // 教学域 4 类 + 目标/路径域（learner_evidence 表持久化事件）合并为完整时间线，按时间倒序
    const merged = [
      ...evidenceRes.items.map(mapEvidence),
      ...evidenceRes.domain.map(mapEvidence)
    ].sort((a, b) => {
      const ta = a.happenedAt ? new Date(a.happenedAt).getTime() : 0
      const tb = b.happenedAt ? new Date(b.happenedAt).getTime() : 0
      return tb - ta
    })
    liveEvidence.value = merged
    loadCurveRaw.value = evidenceRes.loadCurve || []
    // 校准/记忆痕迹：fire-and-forget 但必须带序号守卫，否则旧 id 的迟响应会写穿新详情
    void liveGetLearnerPredictions(id, includeTest).then((calib) => {
      if (stale()) return
      predictionCalib.value = calib
    })
    void liveGetMemoryTraces({ userId: id, includeVirtual: includeTest })
      .then((rows) => {
        if (stale()) return
        memoryTraces.value = rows
      })
      .catch(() => {
        if (stale()) return
        memoryTraces.value = []
      })
    liveDetail.value = {
      name: base?.name || String(model.userName || id),
      email: base?.email || '',
      trend: base?.trend || 'flat',
      fatigue: base?.fatigue || '低',
      path: String((currentPath.pathTitle as string) || model.pathTitle || '尚未开始学习'),
      stage: base?.currentMilestone || String(progress.totalMilestones ? `已完成 ${progress.completedMilestones ?? 0}/${progress.totalMilestones} 个里程碑` : ''),
      task: base?.currentTask || '未开始',
      pct,
      taskDone: completedTasks,
      taskTotal: totalTasks,
      concepts: {
        mastered: (globalSignals.masteredConcepts as string[]) || [],
        struggling: base?.struggling || conceptStates.filter((c) => c.status === 'struggling').map((c) => String(c.label)),
        fragile: base?.fragile || conceptStates.filter((c) => c.status === 'fragile').map((c) => String(c.label))
      },
      sessions: liveEvidence.value.slice(0, 6).map((e) => ({
        time: e.time,
        title: e.title,
        result: evidenceSignalZh(e.signal, e.title) || e.detail || '—',
        tone: evidenceDotTone(e.signal, e.score, e.title),
        concepts: e.concepts
      })),
      snapshot: {
        version: base ? `置信 ${(base.confidence * 100).toFixed(0)}%${evidenceLowConfidence(base.confidence) ? ' · 证据不足' : ''}` : '—',
        generatedAt: timeAgo(base?.generatedAt)
      }
    }
    // 面包屑回写详情名（内部 ID → 中文名；title 仍保留全 ID）
    setSubPageLabel(liveDetail.value.name)
    // 用户记录：原先仅在列表兜底缺失时拉取（补真实姓名/邮箱）。现恒拉一次，
    // 一并为「学习者画像」kv 卡取层级/路径数/注册时间（后端 findUserDetailForAdmin 的 xp/_count.createdAt）；
    // 深链直达时它同时负责 h1 姓名回填（快照里没存昵称的账号，否则 h1 是裸 user_id）。
    void getUserIncludingDeleted(id)
      .then((res) => {
        if (stale()) return
        const u = ((res.data?.data ?? res.data ?? {}) as Record<string, unknown>)
        const counts = (u._count || {}) as Record<string, unknown>
        userRecord.value = {
          currentLevel: String(u.currentLevel || ''),
          xp: Number(u.xp || 0),
          pathCount: Number(counts.learning_paths || 0),
          createdAt: String(u.createdAt || '')
        }
        const nm = String(u.name || '')
        if (nm && liveDetail.value && liveDetail.value.name === id) {
          liveDetail.value = { ...liveDetail.value, name: nm, email: String(u.email || liveDetail.value.email) }
          setSubPageLabel(nm)
        }
      })
      .catch(() => { /* 用户记录失败不阻塞详情页 */ })
    // 总览左栏「最近会话」：独立接口，失败不影响主详情
    void loadLdSessions(id)
  } catch (e) {
    if (stale()) return
    if (base) {
      // 列表兜底：详情接口失败时至少展示列表里已有的信息
      liveDetail.value = {
        name: base.name,
        email: base.email,
        trend: base.trend,
        fatigue: base.fatigue,
        path: base.pathTitle || '尚未开始学习',
        stage: base.currentMilestone || '',
        task: base.currentTask || '未开始',
        pct: 0,
        taskDone: 0,
        taskTotal: 0,
        concepts: { mastered: [], struggling: base.struggling, fragile: base.fragile },
        sessions: [],
        snapshot: {
          version: `置信 ${(base.confidence * 100).toFixed(0)}%${evidenceLowConfidence(base.confidence) ? ' · 证据不足' : ''}`,
          generatedAt: timeAgo(base.generatedAt)
        }
      }
      setSubPageLabel(base.name)
      // 列表兜底也保留路径下钻能力（pathId 来自 liveLearners 列表行）
      currentPathId.value = base.pathId || null
      pathInfo.value = base.pathId
        ? { id: base.pathId, title: base.pathTitle || '尚未开始学习', stage: base.currentMilestone || '', task: base.currentTask || '', done: 0, total: 0, pct: 0 }
        : null
      toast.error(`详情接口暂时不可用，已显示列表快照：${errMsg(e)}`)
    } else {
      detailError.value = true
    }
  }
}

/** 关联实体（P1）：查看该学习者的用户账号（记忆返回来源） */
function goUser() {
  const id = subPage.value?.id
  if (!id) return
  openSubPage('user', id, { includeTest: subPage.value?.includeTest })
}

/**
 * 记忆与复习（归并凭据 / 回滚 / 到期明细）：跨页深链到 `/admin/memory-review?userId=…`。
 * 该页已支持 `userId` 深链（见 MemoryReview.vue 的 onMounted 注释），此前缺的正是"从学习者详情进去"这一环。
 */
function goMemoryReview() {
  const id = subPage.value?.id
  if (!id) return
  void tabRouter.push(memoryReviewUrl(id))
}

watch(
  () => subPage.value?.id,
  (id) => {
    void loadDetail(id)
  },
  { immediate: true, flush: 'sync' }
)

async function recompute() {
  const id = subPage.value?.id
  if (!id || recomputing.value) return
  const name = liveDetail.value?.name || id
  const ok = await askConfirm({
    title: '重算快照',
    message: `确认重算「${name}」的学习者快照？将重新分析其学习状态与概念掌握情况。`,
    confirmText: '重算',
    danger: false
  })
  if (!ok) return
  recomputing.value = true
  try {
    const base = liveLearners.value.find((l) => l.userId === id)
    await liveRecomputeLearner(id, base?.pathId)
    toast.success('快照已重算')
    const prevTab = tab.value
    await loadDetail(id)
    tab.value = prevTab
  } catch (e) {
    toast.error(`重算失败：${errMsg(e)}`)
  } finally {
    recomputing.value = false
  }
}

const loading = computed(() => !liveDetail.value && !detailError.value)

/** 进度口径（P2 双分母标注）：statstrip % 按路径全部任务折算；「当前里程碑」行是里程碑内任务分母 */
const pctTitle = computed(() => {
  const v = d.value
  if (!v) return ''
  return v.taskTotal > 0
    ? `路径进度 ${v.pct}%：按路径全部任务折算（任务 ${v.taskDone}/${v.taskTotal}）；下方「当前里程碑」行用的是里程碑内分母`
    : `路径进度 ${v.pct}%：按路径全部任务折算（暂无任务分母）`
})
/** statstrip「最近会话」口径：d.sessions 是最近学习事件前 6 条，非会话全量 */
const recentSessionsHint = '口径：最近学习事件前 6 条（非会话全量）；完整教学会话列表见「教学会话」页签'

const d = computed<Detail | null>(() => {
  if (detailError.value) return null
  return liveDetail.value || null
})

/* ---------- Tab 数据推导 ---------- */
const profile = computed(() => (rawDetail.value?.profile || null) as Record<string, unknown> | null)
const dynamicState = computed(() => (rawDetail.value?.dynamicState || null) as Record<string, unknown> | null)
interface TeachingHintsShape {
  recommendedApproach?: string
  promptEnhancement?: string
  emphasize?: string[]
  avoid?: string[]
  riskFactors?: string[]
}

const teachingHints = computed(() => (rawDetail.value?.teachingHints || null) as TeachingHintsShape | null)
const knowledgeMemory = computed(() => (rawDetail.value?.knowledgeMemory || null) as Record<string, unknown> | null)
const controlState = computed(() => (rawDetail.value?.learningControlState || null) as Record<string, unknown> | null)
/** 证据记录：后端 learner-models 证据接口 */
const evidence = computed(() => liveEvidence.value)

/** 后端快照的英文枚举 → 中文（参照 LearnerCenter mapTrend/mapFatigue 模式） */
const EN_ZH: Record<string, string> = {
  high: '高', medium: '中', low: '低',
  intuitive: '直觉型', logical: '逻辑型', visual: '视觉型', practical: '实践型', mixed: '混合型',
  'concept-confusion': '概念混淆', 'application-difficulty': '应用困难', 'principle-misunderstanding': '原理误解', none: '无',
  scattered: '零散', systematic: '系统', blank: '空白',
  overconfident: '偏高', accurate: '准确', underconfident: '偏低',
  video: '视频', reading: '阅读', practice: '实践',
  'theory-first': '理论优先', 'practice-first': '实践优先', balanced: '均衡',
  short: '短', long: '长',
  easy: '简单', hard: '挑战',
  interest: '兴趣驱动', 'problem-solving': '问题驱动', 'external-pressure': '外部压力', career: '职业目标',
  confident: '自信', moderate: '适中', anxious: '焦虑',
  improving: '上升', stable: '稳定', declining: '下降',
  rising: '上升', falling: '下降',
  strong: '良好', weak: '较弱',
  slow: '放缓', fast: '加快',
  immediate: '即时', delayed: '延迟', 'on-request': '按需',
  small: '小步', large: '大步',
  true: '是', false: '否',
  /* 用户详情 currentLevel（学习者画像 kv 卡层级）——等级词汇单点在 learner-profile.ts levelWordZh */
  beginner: levelWordZh('beginner'), intermediate: levelWordZh('intermediate'), advanced: levelWordZh('advanced')
}
const zh = (v: unknown): string => {
  const s = String(v ?? '')
  return EN_ZH[s] ?? s
}

/** 会话/任务 ID 缩短显示：取末 8 位（前缀是稳定类型标识，末段是随机部分，足够区分） */
function shortId(id?: string): string {
  if (!id) return ''
  const s = String(id)
  return s.length <= 8 ? s : s.slice(-8)
}

/** 是否为 goal/path 域证据（目标澄清/路径事件：置信度=过程完成度，不套学习成败语义） */
function isDomainEvidence(type: string): boolean {
  return ['goal:understanding:updated', 'path:created', 'path:generated', 'path:adjusted', 'path:completed'].includes(type)
}

function kvRows(obj: Record<string, unknown> | null, labels: Record<string, string>) {
  if (!obj) return [] as { label: string; value: string }[]
  return Object.entries(labels)
    .filter(([key]) => obj[key] != null && obj[key] !== '')
    .map(([key, label]) => ({ label, value: zh(obj[key]) }))
}

const cognitiveRows = computed(() =>
  kvRows((profile.value?.cognitive || null) as Record<string, unknown> | null, {
    metacognitionLevel: '元认知水平',
    thinkingStyle: '思维风格',
    confusionPattern: '困惑模式',
    priorKnowledgeStructure: '先备知识结构',
    selfAssessmentAccuracy: '自评准确度'
  })
)

const preferenceRows = computed(() => [
  ...kvRows((profile.value?.preferences || null) as Record<string, unknown> | null, {
    preferredStyle: '偏好风格',
    theoryVsPractice: '理论 vs 实践',
    sessionLength: '单次时长',
    preferredDifficulty: '难度偏好',
    prefersHints: '是否偏好提示'
  }),
  ...kvRows((profile.value?.emotional || null) as Record<string, unknown> | null, {
    motivationTrigger: '动机触发',
    urgencyLevel: '紧迫感',
    confidenceLevel: '自信水平',
    frustrationTolerance: '挫败耐受',
    rewardSensitivity: '奖励敏感度'
  })
])

/** 画像补充展示：学习行为基线（behavioral）——运营价值：判断「节奏是否适合当前干预」 */
const behaviorRows = computed(() =>
  kvRows((profile.value?.behavioral || null) as Record<string, unknown> | null, {
    avgResponseTime: '平均响应（秒）',
    avgMessageLength: '平均消息长度（字）',
    avgInteractionInterval: '互动间隔（分钟）',
    engagementLevel: '投入度',
    consistencyScore: '一致性'
  })
)

/** 画像补充展示：互动历史（history）——运营价值：总盘子与主题分布，判断是否深耕单一主题 */
const historyRows = computed(() => {
  const h = (profile.value?.history || null) as Record<string, unknown> | null
  if (!h) return [] as { label: string; value: string }[]
  const rows = kvRows(h, {
    totalSessions: '总会话数',
    totalMessages: '总消息数',
    avgSessionDuration: '平均会话时长（分钟）'
  })
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  if (arr(h.topicsExplored).length) rows.push({ label: '探索主题', value: arr(h.topicsExplored).slice(0, 8).join('、') })
  if (arr(h.conceptsStruggled).length) rows.push({ label: '挣扎过概念', value: arr(h.conceptsStruggled).slice(0, 8).join('、') })
  if (arr(h.conceptsMastered).length) rows.push({ label: '已掌握概念', value: arr(h.conceptsMastered).slice(0, 8).join('、') })
  return rows
})

/** 画像补充展示：课程控制（curriculumControls）——运营价值：平台侧可执行的粒度/密度/复习策略 */
const curriculumRows = computed(() =>
  kvRows((profile.value?.curriculumControls || null) as Record<string, unknown> | null, {
    taskGranularityLevel: '任务粒度',
    conceptDensityLevel: '概念密度',
    reviewFrequencyLevel: '复习频率',
    progressionStrategyNote: '推进策略'
  })
)

/** 画像补充展示：派生洞察（derivedInsights）——运营价值：速度/最佳时长/建议方式直接落到干预动作 */
const derivedRows = computed(() => {
  const dv = (profile.value?.derivedInsights || null) as Record<string, unknown> | null
  if (!dv) return [] as { label: string; value: string }[]
  const rows = kvRows(dv, {
    learningVelocity: '学习速度',
    optimalSessionLength: '最佳单次时长（分钟）',
    recommendedDifficulty: '推荐难度',
    suggestedApproach: '建议方式'
  })
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  if (arr(dv.strengths).length) rows.push({ label: '优势', value: arr(dv.strengths).slice(0, 5).join('、') })
  if (arr(dv.riskFactors).length) rows.push({ label: '风险因素', value: arr(dv.riskFactors).slice(0, 5).join('、') })
  return rows
})

const narrativeInsights = computed(() => {
  const n = profile.value?.narrativeInsights
  if (!n) return [] as string[]
  if (Array.isArray(n)) return n.map(String)
  return Object.values(n as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v.map(String) : [String(v)])).slice(0, 6)
})

const metricCards = computed(() => {
  const m = (dynamicState.value?.metrics || {}) as Record<string, number>
  const fmt = (v?: number) => (v == null ? '—' : v.toFixed(1))
  /* 后端语义核实（backend/src/services/learning/learning-state.service.ts）：
     LSS=Learning Stress Score 学习压力（0-10，越高越累）、KTL=Knowledge Training Load 训练负荷
     （LSS 的慢 EWMA，高=负荷重）、LF=Learning Fatigue 疲劳（≥6 警戒）；三者均为负荷类——
     高值是坏（红）、低值是好（绿）。LSB=KTL−LF 状态平衡，正=状态好。此前负荷类高值标绿与
     同卡图例「越高越累」自相矛盾，已按真实语义反转。 */
  const toneLoad = (v?: number): 'ok' | 'bad' | '' => {
    if (v == null || v === 0) return ''
    return v >= 7 ? 'bad' : v <= 4 ? 'ok' : ''
  }
  const toneBalance = (v?: number): 'ok' | 'bad' | '' => {
    if (v == null || v === 0) return ''
    return v >= 1 ? 'ok' : v <= -3 ? 'bad' : ''
  }
  const hint = (v?: number, fallback = '') => (v == null || v === 0 ? '暂无数据' : fallback)
  return [
    { label: 'LSS 学习压力', value: fmt(m.lss), hint: hint(m.lss, '0-10，越高越累'), tone: toneLoad(m.lss) },
    { label: 'KTL 训练负荷', value: fmt(m.ktl), hint: hint(m.ktl, '压力长期累积（慢 EWMA）'), tone: toneLoad(m.ktl) },
    { label: 'LF 学习疲劳', value: fmt(m.lf), hint: hint(m.lf, '越高越疲劳，≥6 警戒'), tone: m.lf != null && m.lf > 0 && m.lf >= 6 ? 'bad' : toneLoad(m.lf) },
    { label: 'LSB 状态平衡', value: fmt(m.lsb), hint: hint(m.lsb, 'KTL−LF，正=状态好'), tone: toneBalance(m.lsb) }
  ]
})

const dynamicRows = computed(() => {
  /* recommendedInteraction 是 {hintTiming, encouragement, challenge} 对象，拆三项展示 */
  const ri = dynamicState.value?.recommendedInteraction
  const riRows: { label: string; value: string }[] = []
  if (ri != null) {
    const o = ri as Record<string, unknown>
    if (typeof o === 'string') {
      riRows.push({ label: '建议互动', value: zh(o) })
    } else {
      if (o.hintTiming != null && o.hintTiming !== '') riRows.push({ label: '提示时机', value: zh(o.hintTiming) })
      if (o.encouragement != null && o.encouragement !== '') riRows.push({ label: '鼓励方式', value: zh(o.encouragement) })
      if (o.challenge != null && o.challenge !== '') riRows.push({ label: '挑战设计', value: zh(o.challenge) })
    }
  }
  return [
    ...kvRows(dynamicState.value, {
      recentTrend: '近期趋势',
      fatigueRisk: '疲劳风险',
      confidenceTrend: '置信趋势',
      recentSessionQuality: '近期会话质量'
    }),
    ...kvRows(dynamicState.value, {
      recommendedPacing: '建议节奏'
    }),
    ...riRows
  ]
})

const controlFlags = computed(() => {
  const c = controlState.value
  if (!c) return [] as { text: string; on: boolean }[]
  return [
    { text: '避免新概念', on: !!c.shouldAvoidNewConcepts },
    { text: '优先巩固', on: !!c.shouldPreferConsolidation },
    { text: '建议休息', on: !!c.shouldOfferBreak }
  ]
})

/** 全局信号与背景摘要（globalBackground 对象不做全量 JSON 倾倒，出摘要 + 可复用/被阻塞 chip 区） */
const memoryRows = computed(() => {
  const km = knowledgeMemory.value
  if (!km) return [] as { label: string; value: string }[]
  const rows: { label: string; value: string }[] = []
  const gs = km.globalSignals
  if (gs != null) {
    if (typeof gs === 'string') {
      rows.push({ label: '全局信号', value: gs })
    } else {
      const o = gs as Record<string, unknown>
      const arr = (v: unknown) => (Array.isArray(v) ? v.length : 0)
      rows.push({ label: '全局信号', value: `已掌握 ${arr(o.masteredConcepts)} · 挣扎 ${arr(o.strugglingConcepts)} · 脆弱 ${arr(o.fragileConcepts)}` })
    }
  }
  const gb = km.globalBackground
  if (gb != null && typeof gb !== 'string') {
    const o = gb as Record<string, unknown>
    const ledgerCount = Array.isArray(o.conceptLedger) ? o.conceptLedger.length : 0
    const confusionCount = Array.isArray(o.recurringConfusions) ? o.recurringConfusions.length : 0
    rows.push({
      label: '全局背景',
      value: `概念账本 ${ledgerCount} 项 · 反复困惑 ${confusionCount} 项 · 可复用基础 ${Array.isArray(o.reusableFoundations) ? o.reusableFoundations.length : 0} · 被阻塞基础 ${Array.isArray(o.blockedFoundations) ? o.blockedFoundations.length : 0}`
    })
  }
  return rows
})

const foundations = computed<{ reusable: string[]; blocked: string[] }>(() => {
  const gb = (knowledgeMemory.value as Record<string, unknown> | null)?.globalBackground
  if (!gb || typeof gb !== 'object') return { reusable: [], blocked: [] }
  const o = gb as Record<string, unknown>
  return {
    reusable: Array.isArray(o.reusableFoundations) ? o.reusableFoundations.map(String) : [],
    blocked: Array.isArray(o.blockedFoundations) ? o.blockedFoundations.map(String) : []
  }
})

/* ---------- 概念掌握图形化（conceptLedger 单源，旧快照回退三组列表） ---------- */
interface ConceptBar {
  label: string
  tone: ConceptBarTone
  width: number
  readiness: string
  risk: string
  riskTone: 'ok' | 'warn' | 'bad'
  evidenceCount: number
}

const conceptBars = computed<ConceptBar[]>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const ledger = (km?.globalBackground as Record<string, unknown> | undefined)?.conceptLedger
  if (Array.isArray(ledger) && ledger.length) {
    return (ledger as ConceptLedgerItem[])
      .map((item) => ({
        label: String(item.label || item.conceptKey || '未命名概念'),
        tone: conceptBarTone(item),
        width: conceptBarWidth(item.transferReadiness),
        readiness: transferReadinessZh(item.transferReadiness),
        risk: misconceptionRiskZh(item.misconceptionRisk),
        riskTone: (String(item.misconceptionRisk || '').toLowerCase() === 'high' ? 'bad' : String(item.misconceptionRisk || '').toLowerCase() === 'medium' ? 'warn' : 'ok') as ConceptBar['riskTone'],
        evidenceCount: Number(item.evidenceCount || 0)
      }))
      .slice(0, 24)
  }
  // 旧快照回退：无 ledger 时按 mastered/struggling/fragile 三组构建
  const c = d.value?.concepts
  if (!c) return []
  const fallback: ConceptBar[] = []
  for (const label of c.mastered) fallback.push({ label, tone: 'ok', width: 90, readiness: '可迁移', risk: '低', riskTone: 'ok', evidenceCount: 0 })
  for (const label of c.fragile) fallback.push({ label, tone: 'warn', width: 55, readiness: '待巩固', risk: '中', riskTone: 'warn', evidenceCount: 0 })
  for (const label of c.struggling) fallback.push({ label, tone: 'bad', width: 25, readiness: '不宜迁移', risk: '高', riskTone: 'bad', evidenceCount: 0 })
  return fallback
})

/** 证据页「概念证据密度」：优先 ledger（evidenceCount），回退 conceptStates（masteryScore 归一化）。
 *  排序：有证据的概念置顶（按条数降序），无证据的沉底折叠，避免 14 行「0 证据」刷屏 */
const conceptStats = computed<{ label: string; count: number; tone: ConceptBarTone; width: number }[]>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const ledger = (km?.globalBackground as Record<string, unknown> | undefined)?.conceptLedger
  if (Array.isArray(ledger) && ledger.length) {
    const max = Math.max(1, ...(ledger as ConceptLedgerItem[]).map((i) => Number(i.evidenceCount || 0)))
    return (ledger as ConceptLedgerItem[])
      .map((item) => ({
        label: String(item.label || item.conceptKey || '未命名概念'),
        count: Number(item.evidenceCount || 0),
        tone: conceptBarTone(item),
        width: Number(item.evidenceCount || 0) > 0
          ? Math.max(8, Math.round((Number(item.evidenceCount || 0) / max) * 100))
          : 8
      }))
      .sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || b.count - a.count || a.label.localeCompare(b.label, 'zh'))
      .slice(0, 16)
  }
  const states = (km?.currentPath as Record<string, unknown> | undefined)?.conceptStates
  if (Array.isArray(states) && states.length) {
    const max = Math.max(1, ...(states as { masteryScore?: number }[]).map((s) => Number(s.masteryScore || 0) * 100))
    return (states as { label?: string; masteryScore?: number }[])
      .map((s) => ({
        label: String(s.label || '未命名概念'),
        count: Math.round(Number(s.masteryScore || 0) * 100),
        tone: 'muted' as ConceptBarTone,
        width: Math.max(8, Math.round((Number(s.masteryScore || 0) * 100 / max) * 100))
      }))
      .slice(0, 16)
  }
  return []
})

const milestoneTasks = computed<{ done: number; total: number } | null>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const p = (km?.currentPath as Record<string, unknown> | undefined)?.progress as Record<string, unknown> | undefined
  const total = Number(p?.totalTasksInMilestone || 0)
  const done = Number(p?.completedTasksInMilestone ?? 0)
  return total > 0 ? { done, total } : null
})

/* ---------- 学习压力记录曲线（learning_metrics 真实指标：LSS/LF/LSB 历史趋势） ---------- */
const loadRange = ref<42 | 90>(42)
/** 压力趋势点（含坐标）：直接来自 learning_metrics 历史，无分钟 EWMA 推导 */
type LoadPoint = {
  date: string
  label: string
  lss: number | null
  lf: number | null
  lsb: number | null
}
const loadSeries = computed<LoadPoint[]>(() => {
  const days = loadRange.value
  const now = new Date()
  const keyOf = (offset: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const map = new Map(loadCurveRaw.value.map((p) => [p.date, p]))
  const out: Omit<LoadPoint, 'x' | 'ylss' | 'ylf' | 'ylsb'>[] = []
  // 压力曲线从最早有记录的那天开始画（避免一大段空数据）；无记录时回退到窗口起点
  let start = 0
  for (let i = days - 1; i >= 0; i--) {
    if (map.has(keyOf(i))) { start = i; break }
  }
  for (let i = start; i >= 0; i--) {
    const key = keyOf(i)
    const p = map.get(key)
    const d = new Date(key + 'T00:00:00')
    out.push({
      date: key,
      label: `${d.getMonth() + 1}月${d.getDate()}日`,
      lss: p?.lss ?? null,
      lf: p?.lf ?? null,
      lsb: p?.lsb ?? null
    })
  }
  return out as LoadPoint[]
})
const hasLoad = computed(() => loadSeries.value.some((p) => p.lss != null || p.lf != null || p.lsb != null))

/* ECharts option：LSS/LF/LSB 统一 0-10 轴（LF 偶发略超 10，上界放宽到 12 防贴顶裁切）；
   下界随数据自适应——LSB=KTL−LF 理论可到 −10，固定 -4 会截断曲线（无负值时仍取 -4 留白）；
   参考线：LSB=0（状态平衡线）与 LF=6（疲劳警戒线）；tooltip 跟随 + 平滑曲线 + 坐标轴刻度 */
const loadChartOption = computed<EChartsCoreOption>(() => {
  const pal = MK_CHART_PALETTES[isDark.value ? 'dark' : 'light'];
  const labels = loadSeries.value.map((p) => p.label)
  const lss = loadSeries.value.map((p) => p.lss)
  const lf = loadSeries.value.map((p) => p.lf)
  const lsb = loadSeries.value.map((p) => p.lsb)
  return {
    animationDuration: 400,
    grid: { left: 34, right: 16, top: 18, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (v: unknown) => (v == null ? '—' : Number(v).toFixed(1)),
    },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, interval: Math.max(0, Math.floor(labels.length / 8)) },
    },
    yAxis: {
      type: 'value',
      // min 用回调：数据里出现 < -4 的 LSB（如 KTL=0、LF=10 → −10）时下界跟着走，避免截断
      min: (e: { min: number }) => Math.min(-4, e.min),
      max: 12,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: 'LSS 压力',
        type: 'line',
        data: lss,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2, color: pal.primary },
        itemStyle: { color: pal.primary },
      },
      {
        name: 'LF 疲劳',
        type: 'line',
        data: lf,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2, color: pal.danger },
        itemStyle: { color: pal.danger },
      },
      {
        name: 'LSB 状态',
        type: 'line',
        data: lsb,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2, color: pal.success },
        itemStyle: { color: pal.success },
      },
      /* 参考线：LSB=0 平衡线（灰虚）与 LF=6 疲劳警戒线（红虚） */
      {
        name: '平衡线',
        type: 'line',
        data: Array(labels.length).fill(0),
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', width: 1, color: 'rgba(23,32,51,0.18)' },
        tooltip: { show: false },
      },
      {
        name: '疲劳警戒',
        type: 'line',
        data: Array(labels.length).fill(6),
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', width: 1, color: 'rgba(220,38,38,0.35)' },
        tooltip: { show: false },
      },
    ],
  }
})

const loadDisplayDay = computed(() => loadSeries.value[loadSeries.value.length - 1] ?? null)
const loadFmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))
/** 压力语义：LF 高 = 疲劳高；LSB = KTL-LF，负 = 状态不佳 */
function loadZoneOf(p: LoadPoint): 'fresh' | 'optimal' | 'risk' {
  if (p.lsb == null) return p.lf != null && p.lf >= 6 ? 'risk' : 'optimal'
  if (p.lsb >= 0) return 'fresh'
  if (p.lsb >= -3) return 'optimal'
  return 'risk'
}
const loadZoneCls = (z: 'fresh' | 'optimal' | 'risk') => (z === 'fresh' ? '--fresh' : z === 'optimal' ? '--optimal' : '--risk')

/* ---------- 预测校准（实证命中率） ---------- */
/** 预测校准结论（卡头结论常驻，就地派生；无样本时保持说明文案） */
const calibConclusion = computed(() => {
  const s = predictionCalib.value?.stats
  if (!s || !(s.total > 0)) return '预测器实证命中率（非自报置信度）'
  const pct = (r: number | null | undefined) => (r != null ? `${Math.round(r * 100)}%` : '—')
  return `卡壳 ${pct(s.stallHitRate)} · 基调 ${pct(s.toneHitRate)} · n=${s.total}`
})

function calHitCls(rate: number | null | undefined): string {
  if (rate == null) return ''
  return rate >= 0.7 ? 'is-good' : rate >= 0.5 ? 'is-mid' : 'is-bad'
}
function calBarWidth(b: { n: number; hardRate: number | null }): string {
  if (!b.n || b.hardRate == null) return '4%'
  return `${Math.max(4, Math.round(b.hardRate * 100))}%`
}
function calOutcomeZh(outcome: string | null | undefined): string {
  if (!outcome) return '待回写'
  return { smooth: '顺畅', struggled: '挣扎', failed: '未完成' }[outcome] || outcome
}
function calOutcomeCls(outcome: string | null | undefined): string {
  if (!outcome) return 'is-pending'
  return outcome === 'smooth' ? 'is-smooth' : 'is-hard'
}

const riskFactors = computed(() => (teachingHints.value?.riskFactors || []) as string[])

/* ---------- 概览：学习状态追踪（lsm，原型 renderLearnerDetail 2189 / 样式 517-522） ----------
   与证据 tab 指标卡同源（dynamicState.metrics）；原型 lsm 的 ktl/320、lf/220 是原型自造量纲，
   后端 KTL/LF 与 LSS 同为 0-10（learning-state.service.ts）——故宽度按真实 0-10 归一，
   tone 对齐本页 metricCards 的负荷语义（高=坏）。 */
const learningStateRows = computed(() => {
  const m = (dynamicState.value?.metrics || {}) as Record<string, number>
  const width = (v: number | undefined) => (v == null || v === 0 ? 0 : Math.min(100, Math.round((v / 10) * 100)))
  const tone = (v: number | undefined): 'ok' | 'warn' | 'bad' | 'muted' => {
    if (v == null || v === 0) return 'muted'
    return v >= 7 ? 'bad' : v <= 4 ? 'ok' : 'warn'
  }
  return [
    { label: 'LSS 学习压力', value: m.lss ? m.lss.toFixed(1) : '—', width: width(m.lss), tone: tone(m.lss), hint: '0-10，越高越累' },
    { label: 'KTL 训练负荷', value: m.ktl ? m.ktl.toFixed(1) : '—', width: width(m.ktl), tone: tone(m.ktl), hint: '压力长期累积' },
    { label: 'LF 疲劳度', value: m.lf ? m.lf.toFixed(1) : '—', width: width(m.lf), tone: m.lf != null && m.lf >= 6 ? 'bad' : tone(m.lf), hint: '≥6 警戒' },
    {
      label: 'LSB 状态平衡',
      value: m.lsb ? `${m.lsb > 0 ? '+' : ''}${m.lsb.toFixed(1)}` : '—',
      width: m.lsb ? Math.min(100, Math.round(Math.abs(m.lsb) * 8 + 10)) : 0,
      tone: (m.lsb == null || m.lsb === 0 ? 'muted' : m.lsb >= 1 ? 'ok' : m.lsb <= -3 ? 'bad' : 'warn') as 'ok' | 'warn' | 'bad' | 'muted',
      hint: 'KTL−LF，正=状态好'
    }
  ]
})

/* ---------- 概览：学习者画像 kv（原型 2190） ----------
   后端用户详情无「注册来源」字段 → 不渲染该行（不硬造）；路径数取 _count.learning_paths，
   层级取 levelBadgeZh(xp, currentLevel)（等级词汇单点，L 公式与后端 level.util 同源）。 */
const portraitRows = computed(() => {
  const rows: { label: string; value: string }[] = []
  if (d.value?.email) rows.push({ label: '邮箱', value: d.value.email })
  const u = userRecord.value
  if (u) {
    // 等级词汇单点（learner-profile.ts）：统一「L2 · 进阶」并存格式
    const lvlBadge = levelBadgeZh(u.xp, u.currentLevel)
    if (lvlBadge) rows.push({ label: '学习层级', value: lvlBadge })
    rows.push({ label: '路径数', value: `${u.pathCount} 条` })
    if (u.createdAt) rows.push({ label: '注册时间', value: timeAgo(u.createdAt) })
  }
  const lastActive = recentSessionRows.value[0]?.startAgo || d.value?.sessions[0]?.time
  if (lastActive) rows.push({ label: '最近活跃', value: lastActive })
  return rows
})

/* ---------- 学习路径 pane：路径卡（原型 2165-2171） ---------- */
const pathStatus = computed<{ text: string; tone: 'ok' | 'info' | 'muted' }>(() => {
  const p = pathInfo.value
  if (!p) return { text: '未开始', tone: 'muted' }
  if (p.pct >= 100) return { text: '已完成', tone: 'ok' }
  if (p.pct > 0) return { text: '进行中', tone: 'info' }
  return { text: '未开始', tone: 'muted' }
})

/* ---------- 记忆与复习 pane（原型 2178-2183）：复用画像 tab 的 FSRS 单源 memoryTraces ----------
   状态/色调由 retrievability + dueAt 派生（原型 weak/due/stable/learning 四态）；
   「来源」列：后端无出处字段，用 extractionCount/lastSeenAt 近似标注（口径见 title）。 */
/* FSRS 到期三态：timeAgo 对未来时间返回「刚刚」，会把未到期复习项全部渲染成「到期：刚刚」——
   到期语义必须是 逾期/今天/N 天后；绝对时刻走 title。 */
function dueText(dueAt: string): string {
  const diffMs = new Date(dueAt).getTime() - Date.now()
  if (!Number.isFinite(diffMs)) return '—'
  const days = Math.floor(Math.abs(diffMs) / 86400000)
  if (diffMs <= 0) return days >= 1 ? `已逾期 ${days} 天` : '今天到期'
  return days >= 1 ? `${days} 天后` : '今天到期'
}

const memoryPaneRows = computed(() =>
  memoryTraces.value.map((t) => {
    const strength = t.retrievability != null ? Math.round(t.retrievability * 100) : null
    const overdue = !!t.dueAt && new Date(t.dueAt).getTime() <= Date.now()
    let state: { text: string; tone: 'ok' | 'warn' | 'bad' | 'info' }
    if (overdue) state = { text: '待复习', tone: 'warn' }
    else if (strength == null) state = { text: '未初始化', tone: 'info' }
    else if (strength < 50) state = { text: '薄弱', tone: 'bad' }
    else if (strength < 80) state = { text: '学习中', tone: 'info' }
    else state = { text: '稳固', tone: 'ok' }
    const source = t.extractionCount > 0 ? `累计提取 ${t.extractionCount} 次` : t.lastSeenAt ? `最近提取 ${timeAgo(t.lastSeenAt)}` : '—'
    return {
      key: t.conceptKey,
      label: t.label || t.conceptKey,
      strength,
      tone: state.tone,
      stateText: state.text,
      due: t.dueAt ? dueText(t.dueAt) : '—',
      dueAbs: t.dueAt ? new Date(t.dueAt).toLocaleString() : '',
      source
    }
  })
)

/* ---------- 操作记录 pane（原型 2184-2187）：feed/feedrow ----------
   口径差异：后台暂无管理侧审计流水接口（无 admin action log 端点）；此处以学习者学习事件
   时间线（liveEvidence，learner_evidence 合并域事件）如实渲染——语义是「学习事件」，非「管理员操作审计」。 */
const auditRows = computed(() =>
  liveEvidence.value.map((e) => ({
    time: e.time,
    action: evidenceTypeZh(e.title),
    detail: e.detail || evidenceSignalZh(e.signal, e.title) || '—'
  }))
)

const trendText = computed(() => (d.value?.trend === 'up' ? '↗ 上升' : d.value?.trend === 'down' ? '↘ 下降' : '→ 稳定'))
const trendBadge = computed(() => (d.value?.trend === 'up' ? 'mk-badge--ok' : d.value?.trend === 'down' ? 'mk-badge--bad' : 'mk-badge--muted'))
const fatigueBadge = computed(() => (d.value?.fatigue === '高' ? 'mk-badge--bad' : d.value?.fatigue === '中' ? 'mk-badge--warn' : 'mk-badge--ok'))
/** 低置信不渲染成风险色：中性→琥珀「证据不足」提示（与 LearnerCenter 同阈值，见 evidence.ts） */
const snapshotBadge = computed(() => {
  const v = d.value?.snapshot.version || ''
  return v.includes('证据不足') ? 'mk-badge--warn' : 'mk-badge--muted'
})
const snapshotHint = computed(() => {
  const v = d.value?.snapshot.version || ''
  return v.includes('证据不足') ? '快照置信度低于 50%，证据不足，建议重算' : '快照置信度'
})

function barToneBadge(tone: ConceptBarTone): string {
  return tone === 'ok' ? 'mk-badge--ok' : tone === 'warn' ? 'mk-badge--warn' : tone === 'bad' ? 'mk-badge--bad' : 'mk-badge--muted'
}
</script>

<style scoped>
.ld { gap: 16px; }

/* 状态条（原型 .statstrip：hero 与 subtabs 之间的一行分格读数，格子间 1px 竖分隔） */
.statstrip { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.statstrip__stat {
  display: grid; gap: 6px; align-content: start;
  padding: 12px 16px;
  border-right: 1px solid var(--mk-line);
}
.statstrip__stat:last-child { border-right: 0; }
.statstrip__label { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.statstrip__value {
  font-size: 22px; font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums; color: var(--mk-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 页头身份区走 .mk-entity（shared.css） */

.ld-tabpage { display: grid; gap: 14px; align-content: start; }
.ld-none { margin: 0; padding: 18px 16px; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.ld-none__hint { display: block; margin-top: 4px; font-size: var(--mk-fs-micro); opacity: 0.9; }
/* 最近会话行已统一为全局原语 MkRowList/MkRow（components/mk），本页不再私有行样式 */

/* 主区双栏（左 2fr 主内容 · 右 1fr 侧栏） */
.ld-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.ld-col { display: grid; gap: 14px; align-content: start; }

.ld-progress { padding: 16px; display: grid; gap: 8px; }
.ld-progress strong { font-size: var(--mk-fs-emphasis); }
.ld-progress__stage { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* 进度条统一走 .mk-minibar（shared.css）；本类只保留外边距 */
.ld-progress__bar { margin: 4px 0; }
.ld-progress__task { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }

.ld-concept-label { font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.04em; }
.ld-concept-label--ok { color: var(--mk-green); }
.ld-concept-label--bad { color: var(--mk-red); }
.ld-concept-list { display: flex; gap: 6px; flex-wrap: wrap; }
/* 概念徽章（原型 .pill--ok/--bad 词汇：胶囊 + tone 底） */
.ld-concept {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}
.ld-concept--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.ld-concept--bad { background: var(--mk-red-bg); color: var(--mk-red); }

/* 概念掌握条（conceptLedger 图形化） */
.ld-bars { padding: 14px 16px 16px; display: grid; gap: 12px; }
.ld-bars--dense { padding-top: 12px; }
.ld-bar { display: grid; gap: 5px; }
/* 无证据概念：折叠态——半透明 + 更紧凑，降低「14 行 0 证据」的刷屏感；悬停恢复不透明度便于阅读 */
.ld-bar--empty { opacity: 0.6; gap: 3px; margin-top: -5px; }
.ld-bar--empty:hover { opacity: 1; }
.ld-bar__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.ld-bar__head strong { font-size: var(--mk-fs-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; }
.ld-bar__badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.ld-bar__risk { font-size: var(--mk-fs-micro); font-weight: 700; }
.ld-bar__risk--ok { color: var(--mk-green); }
.ld-bar__risk--warn { color: var(--mk-amber); }
.ld-bar__risk--bad { color: var(--mk-red); }
.ld-bar__ev {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  background: var(--mk-surface-2);
  border-radius: 6px;
  padding: 1px 6px;
  cursor: help;
}
.ld-bar__ev--zero { background: var(--mk-surface-2); color: var(--mk-faint); }
/* 分布条统一走 .mk-minibar + data-tone（原为 4 套渐变，属 §4 点名的违规）；
   muted 档原语没有，保留本页一个色调类 */
.ld-bar__fill--muted { background: var(--mk-faint); }

/* （.ld-trend* 柱图样式已随「7 天活跃趋势」假卡移除） */
/* 最近动态行（原型 .feedrow 词汇：行间 1px line 分隔 + mono 时间列） */
.ld-sessions { display: grid; }
.ld-session {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--mk-line);
}
.ld-session:last-child { border-bottom: none; }
.ld-session__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ld-session__dot.is-ok { background: var(--mk-green); }
.ld-session__dot.is-warn { background: var(--mk-amber); }
.ld-session__dot.is-bad { background: var(--mk-red); }
.ld-session__dot.is-muted { background: var(--mk-muted); }
.ld-session__main { flex: 1; display: grid; min-width: 0; }
.ld-session__main strong { font-size: var(--mk-fs-micro); font-weight: 600; }
.ld-session__main span { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ld-session__time { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }

/* 建议行动卡 */
.ld-actions { padding: 14px 16px; display: grid; gap: 9px; }
/* 关联实体卡（P1）：HubSpot/SF 关联卡模式 */
.ld-related { padding: 10px 12px; display: grid; gap: 6px; }
.ld-related__item {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl);
  background: var(--mk-surface); padding: 9px 12px;
  font: inherit; text-align: left; cursor: pointer;
  transition: border-color 0.12s var(--mk-ease-out);
}
/* 悬停只换描边，不位移（批次 D，2026-10-02）：相关学习是竖排列表，
   抬 1px 会让整列在鼠标经过时「跳一下」。同批把硬编码 rgba(47,106,224,.5)
   改成 var(--mk-blue) 的 color-mix —— 交互蓝只有一个来源。 */
.ld-related__item:hover { border-color: color-mix(in srgb, var(--mk-blue) 50%, transparent); }
.ld-related__item:active { transform: scale(0.98); }
.ld-related__icon {
  width: 30px; height: 30px; border-radius: var(--mk-radius-sm); flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--mk-blue) 10%, transparent); color: var(--mk-blue); font-size: var(--mk-fs-body);
}
.ld-related__main { display: grid; gap: 1px; flex: 1; min-width: 0; }
.ld-related__main strong { font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.ld-related__main span { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.ld-related__go { font-style: normal; color: var(--mk-faint); font-weight: 700; }
.ld-related__item:hover .ld-related__go { color: var(--mk-blue); }
.ld-actions p { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.7; }
.ld-actions__k {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}
.ld-actions__k--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.ld-actions .mk-status__action { justify-self: start; }

/* 概念 chip（会话/证据行内；原型 .chip 词汇：胶囊描边、surface 底、muted 字） */
.ld-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.ld-chip {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-muted);
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  padding: 0 8px;
}

/* 可复用/被阻塞基础 */
.ld-found { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 14px 16px; }
.ld-found > div { display: grid; gap: 7px; align-content: start; }

/* Tab 通用 */
/* 键值对排版（原型 dl.kv：96px 标签列网格、行间不画线、标签 12px muted、值 body 常规字重）；
   __row 以 display:contents 透传，保持模板结构而网格行为与原型 kv 一致 */
.ld-kv {
  --kv-label: 96px;
  display: grid;
  grid-template-columns: var(--kv-label) minmax(0, 1fr);
  gap: 8px 14px;
  align-items: baseline;
  padding: 14px 16px;
}
.ld-kv__row { display: contents; }
.ld-kv__row span { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ld-kv__row strong { font-weight: 400; font-size: var(--mk-fs-body); white-space: pre-wrap; overflow-wrap: anywhere; }

/* 记忆强度（原型 meterrow：meter 条 + mono %，沿用 .mk-minibar 原语） */
.ld-mt { display: inline-flex; align-items: center; gap: 8px; }
.ld-mt__bar { width: 72px; flex: none; }
.ld-mt em { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-muted); font-variant-numeric: tabular-nums; }

/* 学习状态追踪（lsm，原型 517-522）：label / track / val / hint 四列 */
.ld-lsm { padding: 14px 16px; display: grid; gap: 12px; }
.ld-lsm__row { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto 72px; align-items: center; gap: 10px; }
.ld-lsm__label { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ld-lsm__track { min-width: 80px; }
.ld-lsm__val { font-size: var(--mk-fs-micro); font-weight: 700; font-variant-numeric: tabular-nums; }
.ld-lsm__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); text-align: right; }

/* 学习路径卡栅格（原型 2165-2171） */
.ld-pathgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; padding: 14px 16px; }
.ld-pathcard {
  display: grid; gap: 8px; padding: 14px 16px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl);
  background: var(--mk-surface); font: inherit; color: inherit; text-align: left; cursor: pointer;
  transition: border-color 0.12s ease;
}
.ld-pathcard:hover { border-color: color-mix(in srgb, var(--mk-blue) 50%, transparent); }
.ld-pathcard__top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ld-pathcard__top strong { font-size: var(--mk-fs-emphasis); }
.ld-pathcard__mid { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.ld-pathcard__step { font-size: var(--mk-fs-micro); color: var(--mk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-pathcard__mono { margin-left: auto; font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }
.ld-pathcard__meter { margin-top: 2px; }

/* 表格 pane（教学会话 / 记忆与复习）：行可点击 + 等宽列 */
.ld-pane-row { cursor: pointer; }
/* 阶段切换器：chips 行夹在卡头与表格之间（mk-pill 描边胶囊原语，激活态见原语层） */
.ld-stagechips { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 16px 0; }
.ld-mono { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); }
.ld-sub { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ld-strong { font-weight: 600; }

/* 操作记录 feed（原型 .feed/.feedrow 297-304：62px mono 时间列 + 动作/详情） */
.ld-feed { display: grid; padding: 4px 16px; }
.ld-feedrow { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--mk-line); }
.ld-feedrow:last-child { border-bottom: 0; }
.ld-feedrow__time { width: 62px; flex: none; font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.ld-feedrow__main { min-width: 0; display: grid; gap: 2px; }
.ld-feedrow__action { font-size: var(--mk-fs-micro); font-weight: 600; }
.ld-feedrow__detail { font-size: var(--mk-fs-micro); color: var(--mk-muted); }

.ld-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.ld-flags { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 16px; }
.ld-insights { padding: 12px 16px; display: grid; gap: 8px; }
.ld-insights p { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.7; }
.ld-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 14px 16px; }
.ld-two > div { display: grid; gap: 7px; align-content: start; }

/* 证据时间线：竖线时间轴 + 信号徽章 + 置信度条 + 来源 */
.ld-evidence { display: grid; }
.ld-ev {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px 12px 22px;
  border-bottom: 1px solid var(--mk-line);
}
.ld-ev:last-child { border-bottom: none; }
/* P2 可点下钻（带 sessionId 的行 → 会话座舱）：悬停只换背景/光标，不做位移 */
.ld-ev--link { cursor: pointer; }
.ld-ev--link:hover { background: var(--mk-surface-2); }
.ld-ev--link:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
/* 竖线时间轴：贯穿每行左侧；单条时不显示（避免断裂） */
.ld-ev__rail {
  position: absolute;
  left: 15px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--mk-line); /* 原渐隐渐变已退役（材质一律平面），改 1px 发丝线同源实色 */
}
.ld-ev:first-child .ld-ev__rail { top: 50%; }
.ld-ev:last-child .ld-ev__rail { bottom: 50%; }
.ld-ev:only-child .ld-ev__rail { display: none; }
.ld-evidence:has(.ld-ev:only-child) .ld-ev__rail { display: none; }
/* 信号圆点：压在竖线上 */
.ld-ev__dot {
  position: relative;
  z-index: 1;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
  box-shadow: 0 0 0 3px var(--mk-surface);
}
.ld-ev__dot.is-ok { background: var(--mk-green); }
.ld-ev__dot.is-warn { background: var(--mk-amber); }
.ld-ev__dot.is-bad { background: var(--mk-red); }
.ld-ev__dot.is-muted { background: var(--mk-muted); }
.ld-ev__main { flex: 1; display: grid; gap: 3px; min-width: 0; }
.ld-ev__top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ld-ev__main strong { font-size: var(--mk-fs-micro); }
.ld-ev__detail { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
/* 信号徽章：与圆点同色的浅底小标 */
.ld-ev__signal {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
}
.ld-ev__signal.is-ok { background: var(--mk-green-bg); color: var(--mk-green); }
.ld-ev__signal.is-warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.ld-ev__signal.is-bad { background: var(--mk-red-bg); color: var(--mk-red); }
.ld-ev__signal.is-muted { background: var(--mk-surface-2); color: var(--mk-muted); }
/* 证据不足徽章（pill 语气：胶囊琥珀） */
.ld-ev__lack {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-amber);
  background: var(--mk-amber-bg);
  border-radius: 999px;
  padding: 1px 8px;
}
/* 置信度迷你条：绿(≥80%) / 蓝(50-79%) / 琥珀(<50%) */
.ld-ev__conf {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 200px;
  cursor: help;
}
.ld-ev__confbar {
  display: block;
  height: 5px;
  border-radius: var(--mk-radius-pill);
  background: var(--mk-surface-2);
  overflow: hidden;
  position: relative;
}
.ld-ev__confbar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--mk-radius-pill);
}
.ld-ev__confbar.is-ok::after { background: var(--mk-green); }
.ld-ev__confbar.is-warn::after { background: var(--mk-amber); }
.ld-ev__confbar.is-info::after { background: var(--mk-blue); }
.ld-ev__conf em { font-style: normal; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 来源行：会话/任务短 ID */
.ld-ev__src {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  opacity: 0.85;
}
.ld-ev__time { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; margin-top: 3px; }

/* ---------- 证据页两栏布局：左时间线（主） / 右曲线·建议·密度（侧） ---------- */
.ld-ev-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.ld-ev-main { min-width: 0; }
/* 时间线限高内滚：50+ 条不撑爆页面，右栏随视口露出 */
.ld-ev-main .ld-evidence { max-height: 640px; overflow-y: auto; }
.ld-ev-main .ld-evidence::-webkit-scrollbar { width: 6px; }
.ld-ev-main .ld-evidence::-webkit-scrollbar-thumb { background: #d5dce8; border-radius: var(--mk-radius-xs); }
.ld-ev-side { display: grid; gap: 14px; min-width: 0; }

/* ---------- 学习压力曲线（健康度/疲劳度 EWMA，风格对齐用户侧 V2LearningState） ---------- */
.ld-load__controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* 分段控件（42/90 天）走 .mk-seg（shared.css） */
.ld-load__body { padding: 12px 14px 14px; display: grid; gap: 10px; }
.ld-load__legend { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ld-load__dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.ld-load__dot.is-lss { background: var(--mk-blue); }
.ld-load__dot.is-lf { background: var(--mk-red); }
.ld-load__dot.is-lsb { background: var(--mk-green); }
.ld-load__chip { margin-left: auto; font-size: var(--mk-fs-micro); font-weight: 800; padding: 2px 9px; border-radius: 999px; }
.ld-load__info { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; font-size: var(--mk-fs-micro); color: var(--mk-muted); border-top: 1px dashed var(--mk-line); padding-top: 8px; }
.ld-load__info b { color: var(--mk-ink); }
.ld-load__info .is-lss-t { color: var(--mk-blue); font-weight: 700; }
.ld-load__info .is-lf-t { color: var(--mk-red); font-weight: 700; }
.ld-load__info .is-lsb-t { color: var(--mk-green); font-weight: 700; }
.ld-load__zones { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* ---------- 预测校准（实证命中率 + 校准分布 + 最近预测） ---------- */
.ld-cal { padding: 12px 14px 14px; display: grid; gap: 12px; }
.ld-cal__hits { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ld-cal__hit { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl); background: var(--mk-surface); }
.ld-cal__hit span { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
.ld-cal__hit strong { font-size: var(--mk-fs-20); font-variant-numeric: tabular-nums; }
.ld-cal__hit strong.is-good { color: var(--mk-green); }
.ld-cal__hit strong.is-mid { color: var(--mk-amber); }
.ld-cal__hit strong.is-bad { color: var(--mk-red); }
.ld-cal__hit em { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.ld-cal__buckets { display: grid; gap: 6px; }
.ld-cal__bucket { display: grid; grid-template-columns: 52px 1fr 72px; align-items: center; gap: 8px; font-size: var(--mk-fs-micro); }
.ld-cal__range { color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 校准分布条走 .mk-minibar + data-tone（原为琥珀渐变） */
.ld-cal__val { color: var(--mk-muted); font-variant-numeric: tabular-nums; text-align: right; }
.ld-cal__recent { display: grid; gap: 0; border-top: 1px dashed var(--mk-line); padding-top: 8px; }
.ld-cal__row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: var(--mk-fs-micro); border-bottom: 1px solid var(--mk-line); }
.ld-cal__row:last-child { border-bottom: none; }
.ld-cal__task { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mk-ink); font-family: var(--mk-mono); cursor: help; }
.ld-cal__risk { color: var(--mk-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ld-cal__outcome { font-size: var(--mk-fs-micro); font-weight: 700; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.ld-cal__outcome.is-smooth { color: var(--mk-green); background: var(--mk-green-bg); }
.ld-cal__outcome.is-hard { color: var(--mk-red); background: var(--mk-red-bg); }
.ld-cal__outcome.is-pending { color: var(--mk-faint); background: var(--mk-surface-2); }

@media (max-width: 1100px) {
  .ld-grid { grid-template-columns: 1fr; }
  .ld-metrics { grid-template-columns: repeat(2, 1fr); }
  .ld-two { grid-template-columns: 1fr; }
  .ld-found { grid-template-columns: 1fr; }
  .ld-ev-grid { grid-template-columns: 1fr; }
  .ld-ev-main .ld-evidence { max-height: none; overflow: visible; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .ld-none { font-size: var(--mk-fs-body); }
  .mk-row__sub { font-size: var(--mk-fs-body); }
  .ld-progress strong { font-size: var(--mk-fs-emphasis); }
  .ld-progress__stage, .ld-progress__task { font-size: var(--mk-fs-body); }
  .ld-concept-label { font-size: var(--mk-fs-micro); }
  .ld-concept { font-size: var(--mk-fs-body); }
  .ld-bar__head strong { font-size: var(--mk-fs-body); }
  .ld-bar__risk, .ld-bar__ev { font-size: var(--mk-fs-micro); }
  .ld-actions p { font-size: var(--mk-fs-body); }
  .ld-actions__k { font-size: var(--mk-fs-micro); }
  .ld-chip { font-size: var(--mk-fs-micro); }
  .ld-session__main strong { font-size: var(--mk-fs-body); }
  .ld-session__main span, .ld-session__time { font-size: var(--mk-fs-micro); }
  .ld-kv__row { font-size: var(--mk-fs-body); }
  .ld-insights p { font-size: var(--mk-fs-body); }
  .ld-ev__main strong { font-size: var(--mk-fs-body); }
  .ld-ev__main span { font-size: var(--mk-fs-micro); }
  .ld-ev__time { font-size: var(--mk-fs-micro); }
  .ld-ev__signal { font-size: var(--mk-fs-micro); }
  .ld-ev__conf em { font-size: var(--mk-fs-micro); }
  .ld-ev__src { font-size: var(--mk-fs-micro); }
  .ld-none { padding: 21px 19px; }
  .ld-none__hint { font-size: var(--mk-fs-micro); }
  .ld-progress { padding: 18px; gap: 9px; }
  .ld-concept { padding: 4px 12px; }
  .ld-bars { padding: 16px 18px 18px; }
  .ld-actions { padding: 16px 18px; }
  .ld-found { padding: 16px 18px; }
  .ld-session { padding: 13px 18px; gap: 14px; }
  .ld-session__dot { width: 9px; height: 9px; }
  .ld-kv { --kv-label: 112px; padding: 16px 18px; }
  .ld-metrics { gap: 14px; }
  .ld-flags { padding: 16px 18px; }
  .ld-insights { padding: 14px 18px; }
  .ld-two { padding: 16px 18px; }
  .ld-ev { padding: 12px 18px; gap: 14px; }
  .ld-ev__dot { width: 9px; height: 9px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000 档的基础上再升一档，对齐 mk 体系 2800（17px 级） */
  .ld-none { font-size: var(--mk-fs-body); }
  .ld-progress strong { font-size: var(--mk-fs-emphasis); }
  .ld-progress__stage, .ld-progress__task { font-size: var(--mk-fs-body); }
  .ld-concept-label { font-size: var(--mk-fs-micro); }
  .ld-concept { font-size: var(--mk-fs-body); }
  .ld-bar__head strong { font-size: var(--mk-fs-body); }
  .ld-bar__risk, .ld-bar__ev { font-size: var(--mk-fs-micro); }
  .ld-actions p { font-size: var(--mk-fs-body); }
  .ld-actions__k { font-size: var(--mk-fs-micro); }
  .ld-chip { font-size: var(--mk-fs-micro); }
  .ld-session__main strong { font-size: var(--mk-fs-body); }
  .ld-session__main span, .ld-session__time { font-size: var(--mk-fs-micro); }
  .ld-kv__row { font-size: var(--mk-fs-body); }
  .ld-insights p { font-size: var(--mk-fs-body); }
  .ld-ev__main strong { font-size: var(--mk-fs-body); }
  .ld-ev__main span { font-size: var(--mk-fs-micro); }
  .ld-ev__time { font-size: var(--mk-fs-micro); }
  .ld-ev__signal { font-size: var(--mk-fs-micro); }
  .ld-ev__conf em { font-size: var(--mk-fs-micro); }
  .ld-ev__src { font-size: var(--mk-fs-micro); }
  .ld-none { padding: 25px 22px; }
  .ld-none__hint { font-size: var(--mk-fs-micro); }
  .ld-progress { padding: 21px; gap: 10px; }
  .ld-concept { padding: 4px 14px; }
  .ld-bars { padding: 19px 21px 21px; }
  .ld-actions { padding: 19px 21px; }
  .ld-found { padding: 19px 21px; }
  .ld-session { padding: 15px 21px; gap: 16px; }
  .ld-session__dot { width: 11px; height: 11px; }
  .ld-kv { --kv-label: 128px; padding: 18px 21px; }
  .ld-metrics { gap: 16px; }
  .ld-flags { padding: 19px 21px; }
  .ld-insights { padding: 16px 21px; }
  .ld-two { padding: 19px 21px; }
  .ld-ev { padding: 14px 21px; gap: 16px; }
  .ld-ev__dot { width: 11px; height: 11px; }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .ld-none { font-size: var(--mk-fs-emphasis); }
  .ld-progress strong { font-size: 24px; }
  .ld-progress__stage, .ld-progress__task { font-size: var(--mk-fs-emphasis); }
  .ld-concept-label { font-size: var(--mk-fs-body); }
  .ld-concept { font-size: var(--mk-fs-emphasis); }
  .ld-bar__head strong { font-size: var(--mk-fs-emphasis); }
  .ld-bar__risk, .ld-bar__ev { font-size: var(--mk-fs-body); }
  .ld-actions p { font-size: var(--mk-fs-emphasis); }
  .ld-actions__k { font-size: var(--mk-fs-body); }
  .ld-chip { font-size: var(--mk-fs-body); }
  .ld-session__main strong { font-size: var(--mk-fs-emphasis); }
  .ld-session__main span, .ld-session__time { font-size: var(--mk-fs-emphasis); }
  .ld-kv__row { font-size: var(--mk-fs-emphasis); }
  .ld-insights p { font-size: var(--mk-fs-emphasis); }
  .ld-ev__main strong { font-size: var(--mk-fs-emphasis); }
  .ld-ev__main span { font-size: var(--mk-fs-emphasis); }
  .ld-ev__time { font-size: var(--mk-fs-body); }
  .ld-ev__signal { font-size: var(--mk-fs-body); }
  .ld-ev__conf em { font-size: var(--mk-fs-body); }
  .ld-ev__src { font-size: var(--mk-fs-body); }
  .ld-none { padding: 29px 26px; }
  .ld-none__hint { font-size: var(--mk-fs-emphasis); }
  .ld-progress { padding: 25px; gap: 12px; }
  .ld-concept { padding: 5px 16px; }
  .ld-bars { padding: 22px 25px 25px; }
  .ld-actions { padding: 22px 25px; }
  .ld-found { padding: 22px 25px; }
  .ld-session { padding: 17px 25px; gap: 19px; }
  .ld-session__dot { width: 13px; height: 13px; }
  .ld-kv { --kv-label: 152px; padding: 21px 25px; }
  .ld-metrics { gap: 19px; }
  .ld-flags { padding: 22px 25px; }
  .ld-insights { padding: 19px 25px; }
  .ld-two { padding: 22px 25px; }
  .ld-ev { padding: 16px 25px; gap: 19px; }
  .ld-ev__dot { width: 13px; height: 13px; }
}

/* ================= 暗色模式（D1 补完）：学习者详情 ================= */
html[data-theme='dark'] {
  /* 进度条/概念账本/校准行 深底（行分隔线已走 --mk-line token，随主题自适应，不再需要覆写） */
  .ld-progress__bar,
  .ld-bar__track,
  .ld-bar__ev--zero,
  .ld-cal__bar,
  .ld-cal__outcome.is-pending,
  .ld-ev__signal.is-muted,
  .ld-bar__ev { border-bottom-color: var(--wf-border-light); }
  .ld-bar__ev { background: var(--wf-bg-hover); }
  /* 滚动条 thumb 与行分隔线是两种语义：此前误共用一条规则，
     把 .ld-kv__row 整行背景也涂成了 thumb 灰（#393a3c），已拆开 */
  .ld-ev-main .ld-evidence::-webkit-scrollbar-thumb { background: #393a3c; }
  /* 补漏：操作提示标签/置信条/加载分段（chip/kv 已 token 化） */
  .ld-actions__k { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--wf-color-primary-light); }
  .ld-ev__confbar { background: var(--wf-bg-hover); }
}
</style>
