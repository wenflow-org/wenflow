<template>
  <!-- 协议（core YAML · SSOT 编辑与发布） -->
  <div class="sdp-pw">
    <!-- 2026-11-06 整合：宿主层原来另有一组只读卡（输入契约 / 输出契约 / 回合状态机 / 终止条件 /
         System Prompt），与下面这个编辑器渲染的是同一份数据的两层。现在合成一张卡两态：
         查看 = 只读呈现，编辑 = 核心文件表单 / 源码 / 预览。 -->
    <div class="sdp-pw__bar">
      <!-- 2026-11-11（困惑测试 #79）：三组同款分段（本处 / 核心文件 / 字段路由）原来只有选项值、
           控制对象只在 aria-label 里。对象名提升为可见标签。 -->
      <span class="sdp-pw__seglabel">核心文件</span>
      <div class="mk-seg" role="group" aria-label="核心文件查看 / 编辑切换">
        <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': viewMode === 'read' }" @click="viewMode = 'read'">查看</button>
        <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': viewMode === 'edit' }" @click="viewMode = 'edit'">编辑</button>
      </div>
      <!-- 查看态在这里给文件路径；编辑态的卡片标题已带同一路径，不再重复印第二遍。 -->
      <span v-if="viewMode === 'read'" class="sdp-pw__file mono">prompts/core/{{ skillId }}.yaml</span>
    </div>

    <!-- ===== 查看态：契约 / 流程 / 生效 Prompt ===== -->
    <template v-if="viewMode === 'read'">
      <div class="sdp-pw__grid">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">输入契约</h3>
            <span class="mk-card__meta">{{ readInputs.length }} 字段</span>
          </div>
          <div class="sdp-pw__body">
            <MkLoading v-if="!coreLoaded && !coreMissing" inline text="输入声明加载中…" />
            <template v-else>
              <!-- 2026-11-11（困惑测试 #82）：ref 前缀释义原先只在编辑态说明段里；只读视图补一行图例 -->
              <p class="sdp-pw__legend">
                来源前缀：skill: 上游 Skill · sandbox: 编排注入 · user: 用户 / 平台。字段说明为 core YAML 原文，面向生成引擎。
              </p>
              <div v-for="(f, i) in readInputs" :key="`${f.ref}-${i}`" class="sdp-crow">
                <span class="mono sdp-crow__name" :title="f.name || f.ref">{{ f.name || '—' }}</span>
                <span class="mk-badge mk-badge--muted" :title="`来源声明：${f.ref || '—'}`">{{ refSourceLabel(f.ref) }}</span>
                <span class="sdp-crow__desc" :title="f.desc || f.note || ''">{{ f.desc || f.note || f.ref || '—' }}</span>
                <span class="mono sdp-crow__type" :title="f.type || '—'">{{ f.type || '—' }}</span>
              </div>
              <p v-if="!readInputs.length" class="mk-empty--line">core YAML 未声明输入（inputs）。</p>
            </template>
          </div>
        </section>
        <!-- 右栏：流程（core 声明的状态机 / 终止条件与运行时清单的阶段集合合成一张卡）。
             2026-11-08 用户「图 4 右边塞了一堵 20 行密密麻麻的纯英文变量墙（输出契约 48 字段），
             连个中文解释都没有，根本没法读」——那张「输出契约」卡整张删除：它的逐字段中英对照
             就在同一页签下方的「字段流向」表里（带说明 / 角色 / 流向），这里再平铺一遍纯英文名
             既读不动也是重复。 -->
        <div class="sdp-pw__col">
        <section class="mk-card">
          <div class="mk-card__head">
          <h3 class="mk-card__title">流程</h3>
          <span class="mk-card__meta">{{ flowMeta }}</span>
        </div>
        <div class="sdp-pw__body sdp-pw__flow">
          <div v-if="coreStateNodes.length" class="sdp-flowrow">
            <span class="sdp-flowrow__label">core 状态机</span>
            <span class="sdp-flowrow__chips">
              <span v-for="(n, i) in coreStateNodes" :key="`sn-${i}`" class="mk-badge mk-badge--muted mono">{{ n }}</span>
            </span>
          </div>
          <div v-if="runtimePhases.length" class="sdp-flowrow">
            <span class="sdp-flowrow__label">运行时阶段</span>
            <span class="sdp-flowrow__chips">
              <span
                v-for="p in runtimePhases"
                :key="p"
                class="mk-badge mono"
                :class="p === runtimeDefaultPhase ? 'mk-badge--info' : 'mk-badge--muted'"
                :title="p === runtimeDefaultPhase ? '默认阶段' : ''"
              >{{ p }}</span>
            </span>
          </div>
          <div v-if="coreTerminations.length || runtimeTerminalPhases.length" class="sdp-flowrow">
            <span class="sdp-flowrow__label">终止</span>
            <span class="sdp-flowrow__chips">
              <span v-for="(t, i) in coreTerminations" :key="`ct-${i}`" class="mk-badge mk-badge--muted">{{ t }}</span>
              <span v-for="t in runtimeTerminalPhases" :key="`rt-${t}`" class="mk-badge mk-badge--muted mono">{{ t }}</span>
            </span>
          </div>
          <p v-if="!hasFlow" class="mk-empty--line">core YAML 与运行时清单都没有声明阶段或终止条件。</p>
        </div>
        </section>
        </div>
      </div>

      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">System Prompt</h3>
          <div class="mk-card__head-right">
            <span class="mk-card__meta">{{ promptState }}</span>
            <button type="button" class="mk-btn mk-btn--sm" @click="emit('open-prompt')">查看 Prompt</button>
          </div>
        </div>
        <div class="sdp-pw__body">
          <!-- P0 错误态（2026-11-11）：拉取失败时此前只剩一句「暂无生效 Prompt。」——
               把「请求失败」读成「确实没有生效版本」。失败给可读原因 + 重试，空态只在成功但无版本时出现。 -->
          <div v-if="promptError" class="mk-alert mk-alert--row" role="alert">
            <span class="mk-alert__msg">生效 Prompt 加载失败：{{ promptError }}</span>
            <button type="button" class="mk-alert__btn" @click="emit('reload')">重试</button>
          </div>
          <!-- 2026-11-08 用户「图 5 印了一半被截断的 System Prompt（截断在「11. 连 半个字上」）」：
               改为容器内滚动展示全文（max-height + overflow-y），不再在 1200 字处硬切半句话。 -->
          <pre v-else class="sdp-pw__pre sdp-pw__pre--scroll">{{ systemPrompt || '暂无生效 Prompt。' }}</pre>
        </div>
      </section>
    </template>

    <!-- ===== 编辑态：核心文件 ===== -->
    <section v-else class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">核心文件 <code class="mono">prompts/core/{{ skillId }}.yaml</code></h3>
        <div class="mk-card__head-right">
          <span v-if="coreEditorState.dirty" class="mk-badge mk-badge--muted">未保存</span>
          <button type="button" class="mk-link" :disabled="!coreLoaded || coreSaving || coreCompiling" @click="saveAndCompile">
            {{ coreSaving ? '保存中…' : '保存并编译' }}
          </button>
          <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="!coreLoaded || corePublishing || coreEditorState.dirty" :title="coreEditorState.dirty ? '有未保存修改，请先保存' : ''" @click="requestPublish">
            {{ corePublishing ? '发布中…' : '发布' }}
          </button>
        </div>
      </div>
      <!-- 2026-11-11（困惑测试 #80）：这是线上生效的生产源文件，进入编辑没有任何警示；
           两个动作的差别（写盘 vs 立即生效）也只在点击后的弹窗里。 -->
      <p class="sdp-pw__prodnote">
        这是线上生效的生产源文件：保存并编译 = 写盘 + 编译（暂不生效）。发布 = 运行时立即生效（可在「版本」页签回滚）。
      </p>
      <div class="sdp-pw__views">
        <span class="sdp-pw__seglabel">核心文件</span>
        <div class="mk-seg" role="group" aria-label="核心文件表单 / 源码 / 预览切换">
          <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': coreViewMode === 'form' }" @click="switchCoreView('form')">表单</button>
          <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': coreViewMode === 'raw' }" @click="switchCoreView('raw')">源码</button>
          <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': coreViewMode === 'preview' }" @click="switchCoreView('preview')">预览</button>
        </div>
        <!-- 展开/收起（2026-10-31 四轮评审 P1-7）：teaching-turn 这类 2.7 万字的 Prompt
             在固定高（≈30 行）的编辑器里滚动阅读很吃力——给一个整屏档 -->
        <button
          v-if="coreViewMode === 'raw'"
          type="button"
          class="mk-link"
          :aria-pressed="coreRawTall"
          :title="coreRawTall ? '收起到常规高度' : '展开到整屏高度，便于通读长 Prompt'"
          @click="coreRawTall = !coreRawTall"
        >{{ coreRawTall ? '收起' : '展开' }}</button>
      </div>
      <div v-if="coreClassification" class="sdp-pw__classify" :class="`sdp-pw__classify--${coreClassification.level}`">
        <strong>编辑分级：{{ coreLevelLabel(coreClassification.level) }}</strong>
        <ul><li v-for="(m, i) in coreClassification.messages" :key="i">{{ m }}</li></ul>
      </div>
      <div v-if="coreDiagnostics.length" class="sdp-pw__diag">
        <div v-for="(dg, i) in coreDiagnostics" :key="i" class="sdp-pw__diag-item">
          <span class="mono">{{ dg.code }}</span>
          <span>{{ dg.message }}</span>
        </div>
      </div>
      <!-- 本地表单校验失败（#125）：挂到对应卡片，不再只在保存后由服务端 diagnostics 笼统列出 -->
      <p v-if="coreFormIssue" class="sdp-pw__diag sdp-pw__diag--err" role="alert">
        <strong>{{ coreFormIssue.message }}</strong>
        <button type="button" class="mk-link" @click="coreFormIssue = null">知道了</button>
      </p>
      <div v-if="coreInputWarnings.length" class="sdp-pw__diag sdp-pw__diag--warn">
        <div v-for="(w, i) in coreInputWarnings" :key="i" class="sdp-pw__diag-item">
          <span class="mono">{{ w.code }}</span>
          <span>{{ w.message }}</span>
        </div>
      </div>

      <!-- 表单视图 -->
      <div v-if="coreViewMode === 'form'" class="sdp-pwform">
        <template v-if="coreForm">
          <!-- 身份 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" :aria-expanded="openFormSections.has('identity')" aria-controls="core-sec-identity" @click="toggleFormSection('identity')">
              <span>身份</span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('identity') }" aria-hidden="true">▾</i>
            </button>
            <div id="core-sec-identity" v-show="openFormSections.has('identity')" class="sdp-pwform__cardbody">
            <label class="sdp-pwform__field">
              <span>identity（角色定位）</span>
              <textarea v-model="coreForm.identity" rows="3" class="mk-input" @input="markDirty"></textarea>
            </label>
            <div class="sdp-pwform__field">
              <span>channels（材料池，至少一个）</span>
              <div class="sdp-pwform__checks">
                <label v-for="c in CORE_CHANNELS" :key="c" class="sdp-pwform__check">
                  <input type="checkbox" :checked="coreForm.channels.includes(c)" @change="toggleChannel(c)" />
                  <code class="mono">{{ c }}</code>
                </label>
              </div>
            </div>
            <div class="sdp-pwform__row3">
              <label class="sdp-pwform__check">
                <input v-model="coreForm.stateAdvance" type="checkbox" @change="markDirty" />
                stateAdvance
              </label>
              <label class="sdp-pwform__check">
                <input v-model="coreForm.deltaOutput" type="checkbox" @change="markDirty" />
                deltaOutput
              </label>
              <label class="sdp-pwform__field">
                <span>outputMedia</span>
                <MkSelect
                  v-model="coreForm.outputMedia"
                  :options="CORE_OUTPUT_MEDIA_OPTIONS"
                  aria-label="输出媒体"
                  block
                  @change="markDirty"
                />
              </label>
            </div>
            </div>
          </section>

          <!-- 输入声明（上游字段引用） -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" :aria-expanded="openFormSections.has('inputs')" aria-controls="core-sec-inputs" @click="toggleFormSection('inputs')">
              <span>输入声明 <b class="mono">{{ coreForm.inputs.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('inputs') }" aria-hidden="true">▾</i>
            </button>
            <div id="core-sec-inputs" v-show="openFormSections.has('inputs')" class="sdp-pwform__cardbody">
            <p class="sdp-pwform__note">
              声明本 Skill 消费的输入。ref 前缀 = 来源分类：<code class="mono">skill:xxx.fieldPath</code>（上游 Skill 模型输出）/
              <code class="mono">sandbox:agent.key</code>（编排注入，对照沙盘说明书 <code class="mono">prompts/agent-snapshots.md</code>）/
              <code class="mono">user:path</code>（用户/平台，绿灯）。保存/发布时核对（skill→移交、sandbox→沙盘注册表、user→通过）。
              这一份就是同页签只读「输入契约」卡的数据源，两处条目数一致。
            </p>
            <!-- 列头（2026-10-31 三轮评审）：与下方「输出字段」表头同款轻量行，五列网格同模板 -->
            <div v-if="coreForm.inputs.length" class="sdp-pwform__inputrow sdp-pwform__inputrow--head" aria-hidden="true">
              <span>name</span><span>type</span><span>ref（来源）</span><span>desc（用途说明）</span><span></span>
            </div>
            <div v-for="(input, i) in coreForm.inputs" :key="i" class="sdp-pwform__inputrow">
              <!-- 占位符只给字段名（name/type/ref/desc 就是要填的键），不追「（可选）」：
                   ref 已用真实示例演示取值格式，可选性由「只有 ref 是必填」的校验提示表达 -->
              <input v-model="input.name" class="mk-input" placeholder="别名 name" @input="markDirty" />
              <input v-model="input.type" class="mk-input" placeholder="类型 type" @input="markDirty" />
              <input v-model="input.ref" class="mk-input mono" placeholder="skill:path-planning.milestones | sandbox:path.normalizedInput | user:latestMessage" @input="markDirty" />
              <input v-model="input.desc" class="mk-input" placeholder="用途说明 desc" @input="markDirty" />
              <button type="button" class="mk-link mk-link--danger" @click="removeInput(i)">删除</button>
            </div>
            <button type="button" class="mk-link" @click="addInput">+ 添加输入声明</button>
            </div>
          </section>

          <!-- 规则 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" :aria-expanded="openFormSections.has('rules')" aria-controls="core-sec-rules" @click="toggleFormSection('rules')">
              <span>执行规则 <b class="mono">{{ coreForm.rules.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('rules') }" aria-hidden="true">▾</i>
            </button>
            <div id="core-sec-rules" v-show="openFormSections.has('rules')" class="sdp-pwform__cardbody">
            <div v-for="i in coreForm.rules.length" :key="i - 1" class="sdp-pwform__listitem">
              <span class="sdp-pwform__idx mono">{{ i }}</span>
              <textarea v-model="coreForm.rules[i - 1]" rows="2" class="mk-input" @input="markDirty"></textarea>
              <span class="sdp-pwform__itemops">
                <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.rules, i - 1, -1)">↑</button>
                <button type="button" class="mk-link" :disabled="i === coreForm.rules.length" @click="moveItem(coreForm.rules, i - 1, 1)">↓</button>
                <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.rules, i - 1)">删除</button>
              </span>
            </div>
            <button type="button" class="mk-link" @click="addItem(coreForm.rules)">+ 添加规则</button>
            </div>
          </section>

          <!-- 输出字段（高危：字段冻结守门） -->
          <section class="sdp-pwform__card sdp-pwform__card--danger">
            <button type="button" class="sdp-pwform__cardhead" :aria-expanded="openFormSections.has('fields')" aria-controls="core-sec-fields" @click="toggleFormSection('fields')">
              <span>输出字段 <b class="mono">{{ coreForm.fields.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('fields') }" aria-hidden="true">▾</i>
            </button>
            <div id="core-sec-fields" v-show="openFormSections.has('fields')" class="sdp-pwform__cardbody">
            <p class="sdp-pwform__warn">增删字段、改型、改名会触发字段冻结守门。</p>
            <!-- 2026-11-02 评审：同屏两套条目数（只读「输出契约」26 行 vs 这里 8 个字段）
                 没交代层级关系，读作互相打脸。这里说清两者各是什么。 -->
            <p class="sdp-pwform__note">
              这里是 core 文件声明的输出字段，可直接编辑。同页签只读的「输出契约」取的是编排产出行的全量，含隐式推断与控制信号这类内部出参，条目数通常更多。
            </p>
            <div class="sdp-pwform__fields">
              <div class="sdp-pwform__fieldrow sdp-pwform__fieldrow--head">
                <span>name</span><span>type</span><span>可选</span><span>desc（生成指令）</span><span>turn</span><span></span>
              </div>
              <div v-for="(f, i) in coreForm.fields" :key="i" class="sdp-pwform__fieldrow">
                <input v-model="f.name" class="mk-input mono" placeholder="fieldName" @input="markDirty" />
                <MkSelect
                  v-model="f.baseType"
                  :options="CORE_FIELD_TYPE_OPTIONS"
                  aria-label="type"
                  block
                  @change="markDirty"
                />
                <input v-model="f.optional" type="checkbox" aria-label="可选" @change="markDirty" />
                <!-- desc 用 textarea（2026-10-31 四轮评审 P1-7）：生成指令常是整句说明，
                     单行 input 只留最前面十几个字（如「2026-09-27 起停用」这类关键约束被截掉），
                     也没有任何查看全文的入口；换成可纵向拖拽的多行框 -->
                <textarea v-model="f.desc" rows="1" class="mk-input sdp-pwform__fielddesc" placeholder="功能描述" @input="markDirty"></textarea>
                <input v-model="f.turn" type="checkbox" aria-label="turn（回合输出）" @change="markDirty" />
                <button type="button" class="mk-link mk-link--danger" @click="removeField(i)">删除</button>
              </div>
            </div>
            <button type="button" class="mk-link" @click="addField">+ 添加字段</button>
            </div>
          </section>

          <!-- 约束 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" :aria-expanded="openFormSections.has('constraints')" aria-controls="core-sec-constraints" @click="toggleFormSection('constraints')">
              <span>自检约束 <b class="mono">{{ coreForm.constraints.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('constraints') }" aria-hidden="true">▾</i>
            </button>
            <div id="core-sec-constraints" v-show="openFormSections.has('constraints')" class="sdp-pwform__cardbody">
            <div v-for="i in coreForm.constraints.length" :key="i - 1" class="sdp-pwform__listitem">
              <span class="sdp-pwform__idx mono">-</span>
              <textarea v-model="coreForm.constraints[i - 1]" rows="2" class="mk-input" @input="markDirty"></textarea>
              <span class="sdp-pwform__itemops">
                <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.constraints, i - 1, -1)">↑</button>
                <button type="button" class="mk-link" :disabled="i === coreForm.constraints.length" @click="moveItem(coreForm.constraints, i - 1, 1)">↓</button>
                <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.constraints, i - 1)">删除</button>
              </span>
            </div>
            <button type="button" class="mk-link" @click="addItem(coreForm.constraints)">+ 添加约束</button>
            </div>
          </section>

          <!-- 参数 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" :aria-expanded="openFormSections.has('params')" aria-controls="core-sec-params" @click="toggleFormSection('params')">
              <span>生成参数</span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('params') }" aria-hidden="true">▾</i>
            </button>
            <!-- 生成参数：2026-11-06 起只读（用户「有没有重叠功能部分」）。
                 这三个值原本与运行时「模型与路由 → 配置」弹层各自可编辑、各自落盘，而运行时那份
                 优先级更高（本 Skill 覆盖 → Prompt 文件声明 → 代码默认 → 平台默认）——在这里改
                 temperature 会被运行时静默盖掉。现在本卡只报声明值，改值统一走运行时；
                 要改核心文件自己的声明走「源码」视图。 -->
            <div id="core-sec-params" v-show="openFormSections.has('params')" class="sdp-pwform__cardbody">
              <div class="mk-facts mk-facts--rows">
                <div><span>temperature</span><strong class="mono">{{ coreForm.params.temperature }}</strong></div>
                <div><span>maxTokens</span><strong class="mono">{{ coreForm.params.maxTokens }}</strong></div>
                <div><span>failurePolicy</span><strong class="mono">{{ coreForm.params.failurePolicy }}</strong></div>
              </div>
              <p class="mk-card__note">运行时以「模型与路由 → 配置」里的值为准，这里是核心文件的声明值。</p>
            </div>
          </section>
        </template>
        <MkLoading v-else-if="!coreMissing" inline />
        <p v-else class="sdp-none">该 Skill 暂无核心文件</p>
      </div>

      <!-- 源码视图（YAML 语法高亮覆盖层）。v-else 会连 preview 档一起命中——
           切到「预览」时 YAML 编辑器仍整块挂在上方（2026-10-31 三轮评审），
           三档视图互斥改为显式 else-if -->
      <div v-else-if="coreViewMode === 'raw'" class="sdp-codehl" :class="{ 'sdp-codehl--tall': coreRawTall }">
        <pre class="sdp-codehl__pre mono" aria-hidden="true"><code v-html="coreHighlighted"></code></pre>
        <textarea
          ref="coreTextareaRef"
          v-model="coreText"
          class="sdp-pw__textarea mono sdp-codehl__ta"
          spellcheck="false"
          wrap="off"
          :placeholder="coreMissing ? '该 Skill 暂无核心文件（prompts/core/' + skillId + '.yaml）' : '加载中…'"
          :disabled="!coreLoaded"
          @input="markDirty; syncHlScroll()"
          @scroll="syncHlScroll"
        ></textarea>
      </div>
      <div v-if="corePublishResult" class="sdp-pw__publish" :class="`sdp-pw__publish--${corePublishResult.ok ? 'ok' : 'bad'}`">
        <template v-if="corePublishResult.ok">
          已发布：{{ corePublishResult.agentId }} v{{ corePublishResult.version }} · coreHash
          <span class="mono" :title="corePublishResult.coreHash">{{ coreShortHash(corePublishResult.coreHash) }}</span>
        </template>
        <template v-else>{{ corePublishResult.message }}</template>
      </div>
      <div v-if="coreUncertain" class="sdp-pw__uncertain">
        <strong>含义冻结判定不确定</strong>
        <p>{{ coreUncertain.rationale || 'judge 无法确定语义等价性' }}</p>
        <ul><li v-for="(f, i) in coreUncertain.findings || []" :key="i">[{{ f.severity }}] {{ f.aspect }}：{{ f.issue }}</li></ul>
        <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="corePublishing || coreEditorState.dirty" @click="publishCore(true)">
          人工确认无误，强制发布
        </button>
      </div>
      <div v-if="corePublishIssues.length" class="sdp-pw__uncertain">
        <strong>发布被阻断（{{ corePublishIssues.length }} 个问题）</strong>
        <p>{{ corePublishIssues[0].message || '编译/校验未通过，请先处理以下问题' }}</p>
        <ul>
          <li v-for="(f, i) in corePublishIssues" :key="i">
            <template v-if="f.code || f.severity">[{{ f.code || f.severity }}]</template>
            {{ f.message || f.aspect || f.issue }}
          </li>
        </ul>
      </div>
    <!-- 预览视图（编译门禁 + 产物）。原独立右栏在左表单拉长时右侧留出整条空白列
         （2026-10-31 外部评审：右 1/3 纯黑真空 ~2900px）；收进「表单 / 源码 / 预览」
         视图切换后单栏铺满，无空洞。v-show 保留 DOM：门禁/产物状态不随切视图丢。 -->
    <div v-show="coreViewMode === 'preview'" class="sdp-pw__previewpane">
      <header class="mk-section__head">
        <h4>编译预览</h4>
        <!-- #126：保存（表单↔源码切换时的自动保存）只写盘、不编译，预览与磁盘可能不一致 →
             内容变更后显式标「待重新编译」 -->
        <span>
          <span v-if="corePreviewStale" class="mk-badge mk-badge--warn">内容已变更，待重新编译</span>
        </span>
      </header>
      <div class="sdp-pw__pane">
        <div v-if="coreGates" class="sdp-pw__gates">
          <div class="sdp-pw__gate" :class="coreGateCls(coreGates.structure?.length === 0)">
            结构合法 {{ coreGates.structure?.length === 0 ? '✓' : `✗ ${coreGates.structure?.length}` }}
          </div>
          <div class="sdp-pw__gate" :class="coreGateCls(coreGates.fieldFreeze?.length === 0)">
            字段冻结 {{ coreGates.fieldFreeze?.length === 0 ? '✓' : `✗ ${coreGates.fieldFreeze?.length}` }}
          </div>
          <div v-if="coreGates.semantic" class="sdp-pw__gate" :class="coreGateCls(coreGates.semanticDecision === 'pass')">
            含义冻结 {{ coreGates.semantic.verdict }}（{{ coreGates.semanticDecision }}）
          </div>
          <div
            v-if="Array.isArray(coreGates.inputHandoff)"
            class="sdp-pw__gate"
            :class="coreGateCls(coreGates.inputHandoff.length === 0)"
          >
            输入一致性核查 {{ coreGates.inputHandoff.length === 0 ? '通过' : `${coreGates.inputHandoff.length} 条提醒` }}
          </div>
          <div v-for="(issue, i) in coreGates.inputHandoff || []" :key="`ih-${i}`" class="sdp-pw__gate-issue">
            [{{ issue.code }}] {{ issue.message }}
          </div>
          <div v-for="(issue, i) in [...(coreGates.structure || []), ...(coreGates.fieldFreeze || [])]" :key="i" class="sdp-pw__gate-issue">
            [{{ issue.code }}] {{ issue.message }}
          </div>
        </div>
        <div v-if="coreCompiledMeta" class="sdp-pw__meta mono">
          coreHash <span :title="coreCompiledMeta.coreHash">{{ coreShortHash(coreCompiledMeta.coreHash) }}</span> · coreVersion {{ coreCompiledMeta.coreVersion }}
        </div>
        <!-- 空态只说状态不教用法（2026-11-04 文案口径：原「点「保存并编译」后显示…」是交互说明书，改述当前状态） -->
        <pre class="sdp-pw__pre">{{ coreCompiledPrompt || '暂无编译产物（dry run，不写入）。' }}</pre>
      </div>
    </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 协议 tab：core YAML（SSOT）编辑 / 编译 / 发布（3 步发布链：保存并编译 → 发布 → 语义不确定强制发布）
 * 版本历史已并入顶层「版本」tab，字段血缘已并入「字段路由」tab（双层 tab 压平）。
 */
import { computed, ref, watch } from 'vue'
import hljs from 'highlight.js/lib/core'
import yaml from 'highlight.js/lib/languages/yaml'
import 'highlight.js/styles/github-dark.css'
import { adminPromptWorkbenchApi } from '@/api/adminApi'
import { askConfirm } from '../useConfirm'
import { toast } from '@/utils/toast'
import { coreEditorState, coreShortHash, errText, toFormField, toCoreFieldPayload, type CoreFormField } from './sdp-shared'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkSelect from '@/components/mk/MkSelect.vue'

hljs.registerLanguage('yaml', yaml)

const props = defineProps<{
  skillId: string
  reloadTick: number
  /** 生效 Prompt 全文（截断与来源文案在查看态里处理） */
  systemPrompt: string
  promptState: string
  /** 生效 Prompt 拉取失败的可读原因；非空时查看态给错误态 + 重试，而不是「暂无生效 Prompt」 */
  promptError?: string
  /** 运行时契约（Prompt 清单）：查看态的「流程」卡读它的阶段集合与终止阶段 */
  runtimeContract: {
    businessState?: { phases?: string[]; defaultPhase?: string; terminalPhases?: string[] }
  } | null
}>()
const emit = defineEmits<{ (e: 'published'): void; (e: 'open-prompt'): void; (e: 'reload'): void }>()

/** 查看 / 编辑：同一个页签的两态（2026-11-06 整合，原宿主只读块与本编辑器是两层） */
const viewMode = ref<'read' | 'edit'>('read')
const runtimePhases = computed(() => props.runtimeContract?.businessState?.phases ?? [])
const runtimeDefaultPhase = computed(() => props.runtimeContract?.businessState?.defaultPhase ?? '')
const runtimeTerminalPhases = computed(() => props.runtimeContract?.businessState?.terminalPhases ?? [])

/** 查看态·输入契约：core YAML 的 inputs 声明（与编辑态同一份数据，另加来源前缀人话） */
const readInputs = computed(() => (coreForm.value?.inputs ?? []) as { name?: string; type?: string; ref?: string; desc?: string; note?: string }[])
function refSourceLabel(ref?: string): string {
  const r = String(ref || '')
  if (r.startsWith('skill:')) return '上游 Skill'
  if (r.startsWith('sandbox:')) return '编排注入'
  if (r.startsWith('user:')) return '用户 / 平台'
  return '声明'
}
/** 原型 steps / ranklist 的字段名（当前 core schema 无这些字段 → 一律空态，防御式读取） */
function toStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>
          return String(o.name ?? o.label ?? o.title ?? o.state ?? o.id ?? '')
        }
        return String(x)
      })
      .filter(Boolean)
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => `${k}：${v == null ? '—' : String(v)}`)
  }
  return raw == null ? [] : [String(raw)]
}
const coreStateNodes = computed(() => toStringList(coreSnap.value?.stateMachine ?? coreSnap.value?.states))
const coreTerminations = computed(() => toStringList(coreSnap.value?.termination ?? coreSnap.value?.terminations ?? coreSnap.value?.limits))
const hasFlow = computed(() =>
  !!(coreStateNodes.value.length || coreTerminations.value.length || runtimePhases.value.length || runtimeTerminalPhases.value.length)
)
const flowMeta = computed(() => {
  const parts: string[] = []
  if (runtimePhases.value.length) parts.push(`${runtimePhases.value.length} 个运行时阶段`)
  if (coreStateNodes.value.length) parts.push(`${coreStateNodes.value.length} 个 core 状态`)
  return parts.join(' · ') || '无流程声明'
})

const CORE_CHANNELS = ['dialogue', 'state', 'task', 'evidence', 'learner', 'path'] as const

const CORE_FIELD_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'object[]', 'string[]'] as const
const CORE_OUTPUT_MEDIA = ['json', 'markdown', 'text'] as const

/* 下拉选项（MkSelect）：值 = 原 option 的 :value，文案 = 原 option 文本（逐字） */
const CORE_FIELD_TYPE_OPTIONS: { value: string; label: string }[] = CORE_FIELD_TYPES.map((t) => ({ value: t, label: t }))
const CORE_OUTPUT_MEDIA_OPTIONS: { value: string; label: string }[] = CORE_OUTPUT_MEDIA.map((m) => ({ value: m, label: m }))

interface CoreFormState {
  identity: string
  channels: string[]
  stateAdvance: boolean
  deltaOutput: boolean
  outputMedia: string
  inputs: { ref: string; note: string; name?: string; type?: string; desc?: string }[]
  rules: string[]
  constraints: string[]
  examples: string[]
  fields: CoreFormField[]
  params: { temperature: number; maxTokens: number; failurePolicy: string }
}

interface CoreDiagnostic { code: string; message: string }
interface CoreClassification { level: 'safe' | 'restricted' | 'blocked'; messages: string[] }

const coreText = ref('')
const coreLoaded = ref(false)
const coreMissing = ref(false)
const coreSaving = ref(false)
const coreCompiling = ref(false)
const corePublishing = ref(false)

/* 源码视图：YAML 语法高亮覆盖层（高亮层与 textarea 同步滚动） */
const coreTextareaRef = ref<HTMLTextAreaElement | null>(null)
const coreHighlighted = computed(() => {
  if (!coreText.value) return ''
  try {
    return hljs.highlight(coreText.value, { language: 'yaml', ignoreIllegals: true }).value
  } catch {
    return coreText.value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c)
  }
})
function syncHlScroll() {
  const ta = coreTextareaRef.value
  if (!ta) return
  const pre = ta.parentElement?.querySelector('.sdp-codehl__pre') as HTMLElement | null
  if (pre) {
    pre.scrollTop = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
  }
}

const coreDiagnostics = ref<CoreDiagnostic[]>([])
const coreInputWarnings = ref<CoreDiagnostic[]>([])
const coreClassification = ref<CoreClassification | null>(null)
const coreGates = ref<any>(null)
const coreCompiledPrompt = ref('')
const coreCompiledMeta = ref<{ coreHash: string; coreVersion: number } | null>(null)
const corePublishResult = ref<{ ok: boolean; message?: string; agentId?: string; version?: number; coreHash?: string } | null>(null)
const coreUncertain = ref<any>(null)
const corePublishIssues = ref<Array<Record<string, unknown>>>([])
const coreViewMode = ref<'form' | 'raw' | 'preview'>('form')
/** 源码视图整屏档（2026-10-31 四轮评审 P1-7）：长 Prompt 通读用；切回表单/预览不保留 */
const coreRawTall = ref(false)
const coreForm = ref<CoreFormState | null>(null)
/** core YAML 原文对象：查看态的「流程」卡要读 stateMachine / termination（表单没覆盖这两个字段） */
const coreSnap = ref<Record<string, unknown> | null>(null)
/** 编译预览是否已过期（#126）：保存只写盘、不重编译，预览内容可能落后于磁盘 */
const corePreviewStale = ref(false)
let coreRequested = false

function markDirty() {
  coreEditorState.dirty = true
  // 用户继续编辑 → 收起上一次的字段级校验提示（#125）
  coreFormIssue.value = null
}

/* 协议表单折叠：高频段（身份/输入/输出字段）默认展开，低频段默认收起 */
const openFormSections = ref<Set<string>>(new Set(['identity', 'inputs', 'fields']))
function toggleFormSection(key: string) {
  const next = new Set(openFormSections.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openFormSections.value = next
}

/**
 * 切换表单/源码/预览视图：当前视图有未保存修改时先保存到磁盘，再重拉使两视图同步，
 * 避免「表单改动切到源码后保存覆盖」或反向丢失（保存失败阻止切换）。
 */
async function switchCoreView(mode: 'form' | 'raw' | 'preview') {
  if (mode === coreViewMode.value) return
  if (coreEditorState.dirty && coreLoaded.value) {
    const saved = await saveCore()
    if (!saved) return
  }
  coreViewMode.value = mode
  // raw 视图保存后 coreForm 未回读：统一重拉保持两视图一致
  if (mode === 'form' && coreLoaded.value) {
    coreRequested = false
    await ensureCoreLoaded()
  }
}

/* CoreFile 字段 ⇄ 表单字段的投影/回写是 #9 的关键点，提到 sdp-shared 便于单测：
   enumValues / properties 表单不编辑但必须原样透传，否则无编辑保存会静默删掉嵌套子字段。 */

/* ---------- 表单视图：CoreFile JSON → 表单状态 ---------- */
function initCoreForm(core: Record<string, unknown> | null) {
  coreSnap.value = core
  if (!core) {
    coreForm.value = null
    return
  }
  const fields = Array.isArray(core.fields) ? core.fields : []
  const params = (core.params || {}) as Record<string, unknown>
  coreForm.value = {
    identity: String(core.identity || ''),
    channels: Array.isArray(core.channels) ? core.channels.map((c) => String(c)) : [],
    stateAdvance: core.stateAdvance === true,
    deltaOutput: core.deltaOutput === true,
    outputMedia: String(core.outputMedia || 'json'),
    inputs: Array.isArray(core.inputs)
      ? (core.inputs as Array<Record<string, unknown>>).map((item) => ({
          ref: String(item.ref || ''),
          note: String(item.note || ''),
          name: String(item.name || ''),
          type: String(item.type || ''),
          desc: String(item.desc || '')
        }))
      : [],
    rules: Array.isArray(core.rules) ? core.rules.map((r) => String(r)) : [],
    constraints: Array.isArray(core.constraints) ? core.constraints.map((c) => String(c)) : [],
    examples: Array.isArray(core.examples) ? (core.examples as unknown[]).map((e) => String(e)) : [],
    fields: fields.map(toFormField),
    params: {
      temperature: Number(params.temperature ?? 0.5),
      maxTokens: Number(params.maxTokens ?? 8000),
      failurePolicy: String(params.failurePolicy || 'retry')
    }
  }
}

/** 表单状态 → PUT mode=form 的 core 载荷（type 合成 baseType + ? 后缀） */
function buildCorePayload() {
  const f = coreForm.value
  if (!f) return null
  return {
    identity: f.identity,
    channels: f.channels,
    stateAdvance: f.stateAdvance,
    deltaOutput: f.deltaOutput,
    outputMedia: f.outputMedia,
    inputs: f.inputs.filter((item) => item.ref.trim()).map((item) => ({
      ref: item.ref.trim(),
      ...(item.name?.trim() ? { name: item.name.trim() } : {}),
      ...(item.type?.trim() ? { type: item.type.trim() } : {}),
      ...(item.desc?.trim() ? { desc: item.desc.trim() } : {}),
      ...(item.note.trim() ? { note: item.note.trim() } : {})
    })),
    rules: f.rules,
    constraints: f.constraints,
    ...(f.examples.length ? { examples: f.examples } : {}),
    fields: f.fields.map(toCoreFieldPayload),
    params: {
      temperature: f.params.temperature,
      maxTokens: f.params.maxTokens,
      failurePolicy: f.params.failurePolicy
    }
  }
}

function toggleChannel(c: string) {
  const f = coreForm.value
  if (!f) return
  const idx = f.channels.indexOf(c)
  if (idx >= 0) f.channels.splice(idx, 1)
  else f.channels.push(c)
  markDirty()
}

function moveItem(list: string[], i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item)
  markDirty()
}
function addItem(list: string[]) {
  list.push('')
  markDirty()
}
function removeItem(list: string[], i: number) {
  list.splice(i, 1)
  markDirty()
}
function addField() {
  coreForm.value?.fields.push({ name: '', baseType: 'string', optional: false, desc: '', turn: false })
  markDirty()
}
function removeField(i: number) {
  coreForm.value?.fields.splice(i, 1)
  markDirty()
}
function addInput() {
  coreForm.value?.inputs.push({ ref: '', note: '', name: '', type: '', desc: '' })
  markDirty()
}
function removeInput(i: number) {
  coreForm.value?.inputs.splice(i, 1)
  markDirty()
}

const coreGateCls = (ok: boolean) => (ok ? 'sdp-pw__gate--ok' : 'sdp-pw__gate--bad')
function coreLevelLabel(level: string) {
  if (level === 'safe') return '安全（可发布）'
  if (level === 'restricted') return '受限（需开发确认）'
  return '阻断（需开发同步）'
}

async function ensureCoreLoaded() {
  if (coreRequested) return
  coreRequested = true
  const id = props.skillId
  coreDiagnostics.value = []
  try {
    const res = await adminPromptWorkbenchApi.getCore(id)
    if (id !== props.skillId) return
    coreText.value = res.data?.raw || ''
    coreDiagnostics.value = res.data?.diagnostics || []
    initCoreForm((res.data?.core || null) as Record<string, unknown> | null)
    coreLoaded.value = true
    coreMissing.value = false
  } catch (e) {
    if (id !== props.skillId) return
    coreText.value = ''
    coreSnap.value = null
    coreLoaded.value = false
    coreMissing.value = true
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status !== 404) {
      // 非 404 允许重试；404 视为该 skill 无核心文件，保持锁定
      coreRequested = false
      toast.error(`核心文件读取失败：${errText(e)}`)
    }
  }
}

/* 表单本地校验（#125）：channels 至少一个 / 字段 name 非空且唯一 / 规则不留空行。
   界面上写着「channels（材料池，至少一个）」但此前取消全部通道仍可保存，错误只在保存后
   由服务端 diagnostics 列出、不定位卡片。这里先本地拦下并挂到对应卡。 */
const coreFormIssue = ref<{ card: string; message: string } | null>(null)
function failForm(card: string, message: string): false {
  coreFormIssue.value = { card, message }
  // 报错卡若处于收起态先展开，保证提示可见
  if (!openFormSections.value.has(card)) {
    openFormSections.value = new Set([...openFormSections.value, card])
  }
  toast.error(message)
  return false
}
/** 返回 '' = 通过；否则为错误文案（挂到 card） */
function validateCoreForm(): { card: string; message: string } | null {
  const f = coreForm.value
  if (!f) return { card: 'identity', message: '表单未加载，请刷新后重试' }
  if (!f.channels.length) return { card: 'identity', message: 'channels（材料池）至少选一个：全部取消会让该 Skill 失去材料来源' }
  const names = f.fields.map((x) => x.name.trim())
  if (names.some((n) => !n)) return { card: 'fields', message: '输出字段：name 不能为空（空名会生成非法 core YAML）' }
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) return { card: 'fields', message: `输出字段：name 重复「${dup}」——字段名必须唯一` }
  const blankRule = f.rules.findIndex((r) => !String(r).trim())
  if (blankRule >= 0) return { card: 'rules', message: `执行规则：第 ${blankRule + 1} 条为空行，请填写或删除` }
  return null
}

async function saveCore() {
  if (!coreLoaded.value || coreSaving.value) return
  coreFormIssue.value = null
  if (coreViewMode.value === 'form') {
    const issue = validateCoreForm()
    if (issue) return failForm(issue.card, issue.message)
  }
  coreSaving.value = true
  coreClassification.value = null
  coreDiagnostics.value = []
  coreInputWarnings.value = []
  try {
    if (coreViewMode.value === 'form') {
      const payload = buildCorePayload()
      if (!payload) throw new Error('表单未加载')
      const res = await adminPromptWorkbenchApi.saveCoreForm(props.skillId, payload)
      coreClassification.value = res.data?.classification || null
      coreInputWarnings.value = res.data?.inputWarnings || []
      // 回读：raw 源码与表单状态同步到磁盘真值
      coreRequested = false
      await ensureCoreLoaded()
    } else {
      const res = await adminPromptWorkbenchApi.saveCore(props.skillId, coreText.value)
      coreClassification.value = res.data?.classification || null
      coreInputWarnings.value = res.data?.inputWarnings || []
    }
    coreEditorState.dirty = false
    // #126：保存后编译预览已过期（内容变了、门禁/产物还是上一次的），显式标脏并清旧产物
    corePreviewStale.value = true
    coreGates.value = null
    coreCompiledPrompt.value = ''
    coreCompiledMeta.value = null
    toast.success(`已保存（${coreLevelLabel(coreClassification.value?.level || 'safe')}），状态：待编译发布`)
    return true
  } catch (e) {
    const data = (e as { response?: { data?: { diagnostics?: CoreDiagnostic[]; error?: string } } })?.response?.data
    coreDiagnostics.value = data?.diagnostics || []
    toast.error(data?.error || `保存失败：${errText(e)}`)
    return false
  } finally {
    coreSaving.value = false
  }
}

async function previewCore() {
  if (!coreLoaded.value || coreCompiling.value) return
  coreCompiling.value = true
  coreGates.value = null
  coreCompiledPrompt.value = ''
  coreDiagnostics.value = []
  try {
    // 预览是 dry run：不触发语义 judge（避免误置「含义冻结」不确定态）
    const res = await adminPromptWorkbenchApi.compileCore({ skillId: props.skillId, semanticJudge: false })
    coreGates.value = res.data?.gates || null
    coreCompiledPrompt.value = res.data?.prompt || ''
    coreCompiledMeta.value = { coreHash: res.data?.coreHash, coreVersion: res.data?.coreVersion }
    corePreviewStale.value = false
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string; diagnostics?: CoreDiagnostic[] } } })?.response?.data
    // 编译错误落入行内诊断区（可停留查看），toast 仅作补充
    const message = data?.error || errText(e)
    coreDiagnostics.value = data?.diagnostics?.length ? data.diagnostics : [{ code: 'COMPILE_FAILED', message }]
    toast.error(`编译失败：${message}`)
  } finally {
    coreCompiling.value = false
  }
}

/** 发布链第 1 步：保存并编译（合并原「保存并校验」+「编译预览」两个动作，去除中间确认步） */
async function saveAndCompile() {
  if (!coreLoaded.value || coreSaving.value || coreCompiling.value) return
  const saved = await saveCore()
  if (!saved) return
  await previewCore()
}

/**
 * 发布链第 2 步：发布（保留 developerApproval 门禁 + 语义门 409）
 *
 * 发布写生产 ACTIVE 版本、运行时立即生效（可由「版本」页签回滚），与「保存并编译」（只落草稿）不同级，
 * 故与删除/回滚/重置同待遇：任何路径进入前都先过确认框。
 * - 页头「发布」→ requestPublish：safe 分类在此确认（非 safe 由下方 developerApproval 框确认）
 * - 「人工确认无误，强制发布」→ 按钮文案与 409 上下文本身即确认，直连 publishCore（不再叠一层）
 */
async function requestPublish() {
  if (coreEditorState.dirty) {
    toast.error('有未保存修改，请先「保存并编译」')
    return
  }
  const level = coreClassification.value?.level || 'safe'
  // 非 safe 分类的确认交给 developerApproval 输入框（含分级原因 + 开发引用），避免连弹两框
  if (level === 'safe') {
    const ok = await askConfirm({
      title: '发布到运行时',
      message: `确认发布 ${props.skillId} 的核心文件？\n发布后确定性编译为五块 Prompt（skill.${props.skillId}.md + 数据库线上生效版本），运行时立即生效。如需回退，可在「版本」页签回滚到历史版本。`,
      confirmText: '发布',
      /* 与公告页「发布公告」同判据：发布是正向动作（版本页签可回滚），不吃默认红底 */
      danger: false
    })
    if (!ok) return
  }
  await publishCore(false)
}

async function publishCore(confirmUncertain: boolean) {
  if (!coreLoaded.value || corePublishing.value) return
  let developerApproval: { reference: string } | undefined
  if (coreClassification.value && coreClassification.value.level !== 'safe') {
    const reference = await askConfirm({
      title: coreClassification.value.level === 'blocked' ? '发布被阻止：需开发确认' : '发布需开发确认',
      message:
        coreClassification.value.level === 'blocked'
          ? '字段删除或类型变更须先完成消费者同步。\n请输入对应开发提交、PR 或变更单引用：'
          : '新增字段须经开发确认消费者接入。\n请输入对应开发提交、PR 或变更单引用：',
      confirmText: '提交并发布',
      danger: coreClassification.value.level === 'blocked',
      input: { label: '开发提交 / PR / 变更单引用', placeholder: '例如 pr#123 或 提交哈希' }
    })
    if (!reference || typeof reference !== 'string') {
      toast.error('未提供开发确认引用，已取消发布')
      return
    }
    developerApproval = { reference }
  }
  corePublishing.value = true
  corePublishResult.value = null
  coreUncertain.value = null
  corePublishIssues.value = []
  try {
    const res = await adminPromptWorkbenchApi.publishCore({
      skillId: props.skillId,
      confirmUncertain: confirmUncertain || undefined,
      developerApproval
    })
    corePublishResult.value = {
      ok: true,
      agentId: res.data?.agentId,
      version: res.data?.version,
      coreHash: res.data?.coreHash
    }
    toast.success(`发布成功：v${res.data?.version}（运行时已生效）`)
    // 发布改 ACTIVE：通知主页面刷新 overview / 版本 / 试跑参照
    emit('published')
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    const data = (e as { response?: { data?: any } })?.response?.data || {}
    if (status === 409 && data?.code === 'SEMANTIC_UNCERTAIN') {
      // 发布链第 3 步：仅语义 judge 不确定（409）提供「强制发布」兜底
      coreUncertain.value = data?.judgement || {}
      toast.warning('含义冻结不确定，需人工确认')
    } else {
      if (data?.classification) coreClassification.value = data.classification
      corePublishResult.value = { ok: false, message: data?.error || `发布失败：${errText(e)}` }
      // 422 issues 只展示问题列表，不提供强制发布入口
      if (data?.issues?.length) {
        corePublishIssues.value = data.issues
      }
      toast.error(data?.error || '发布被阻断')
    }
  } finally {
    corePublishing.value = false
  }
}

/* ===== （2026-11-08 撤）输出契约数据源：原查看态「输出契约」卡读 field-routings，
   该卡已整张删除（用户「删掉那堵 20 行纯英文变量墙」），逐字段中英对照改由同页签下方的
   「字段流向」表承载（带说明 / 角色 / 流向 / 渲染），故此处的取数与角色归纳一并删除。 ===== */

/* 切换 skill / 回滚后：复位编辑器并从磁盘重拉 */
watch(
  [() => props.skillId, () => props.reloadTick],
  () => {
    coreRequested = false
    coreLoaded.value = false
    coreMissing.value = false
    coreText.value = ''
    coreEditorState.dirty = false
    coreDiagnostics.value = []
    coreInputWarnings.value = []
    coreClassification.value = null
    coreGates.value = null
    coreCompiledPrompt.value = ''
    coreCompiledMeta.value = null
    corePublishResult.value = null
    coreUncertain.value = null
    corePublishIssues.value = []
    coreViewMode.value = 'form'
    viewMode.value = 'read'
    coreSnap.value = null
    coreRawTall.value = false
    openFormSections.value = new Set(['identity', 'inputs', 'fields'])
    corePreviewStale.value = false
    coreFormIssue.value = null
    void ensureCoreLoaded()
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- 协议（core 编辑与发布） ---------- */
/* 单栏：编译预览收进「表单 / 源码 / 预览」视图切换（2026-10-31 外部评审），
   不再有左右分栏——左表单拉长时右栏整条空白的问题随之消失 */
.sdp-pw {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
/* 查看 / 编辑 两态的工具条：左对象名 + 分段控件，右核心文件名 */
.sdp-pw__bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.sdp-pw__seglabel { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-muted); white-space: nowrap; }
.sdp-pw__file { font-size: var(--mk-fs-micro); color: var(--mk-faint); margin-left: auto; }
/* 生产源文件警示（2026-11-11 困惑测试 #80） */
.sdp-pw__prodnote {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: var(--mk-radius-lg);
  background: color-mix(in srgb, var(--mk-amber) 10%, transparent);
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
}
/* 只读输入契约的来源前缀图例（2026-11-11 困惑测试 #82） */
.sdp-pw__legend { margin: 0 0 8px; font-size: var(--mk-fs-micro); line-height: 1.55; color: var(--mk-muted); }
/* 查看态：输入 / 输出契约并排（宽屏两列，窄屏一列） */
.sdp-pw__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}
.sdp-pw__body {
  display: grid;
  gap: 2px;
  align-content: start;
  padding: 12px 16px;
}
/* 右栏：两张卡竖排（与左栏的输入契约并排对望） */
.sdp-pw__col { display: grid; gap: 14px; align-content: start; }
/* 契约行：字段名 · 来源/类型小签 · 说明 · 类型 */
.sdp-crow {
  display: grid;
  grid-template-columns: minmax(120px, 1.1fr) auto minmax(0, 2fr) auto;
  gap: 6px 10px;
  align-items: baseline;
  padding: 7px 0;
  border-bottom: 1px solid var(--mk-line);
}
.sdp-crow__name { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); overflow-wrap: anywhere; }
.sdp-crow__desc { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.55; overflow-wrap: anywhere; }
.sdp-crow__type { font-size: var(--mk-fs-micro); color: var(--mk-faint); text-align: right; }
/* 查看态·流程：一组一组的小签（core 状态机 / 运行时阶段 / 终止） */
.sdp-pw__flow { gap: 10px; }
.sdp-flowrow { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 4px 12px; align-items: baseline; }
.sdp-flowrow__label { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-muted); }
.sdp-flowrow__chips { display: flex; flex-wrap: wrap; gap: 6px; }
/* 输出契约：角色计数徽标 + 字段名清单（明细在字段路由页签） */
/* 查看态 System Prompt：容器内滚动展示全文（2026-11-08 不再在 1200 字处硬截断） */
.sdp-pw__pre--scroll { max-height: 460px; overflow-y: auto; }
/* 编辑态：表单 / 源码 / 预览 分段（与顶部「查看·编辑」同一套 .mk-seg） */
.sdp-pw__views {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 12px 18px 6px;
}
/* 展开/收起按钮贴右缘（对象标签与分段在左） */
.sdp-pw__views > .mk-link { margin-left: auto; }
.sdp-none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sdp-bad-text { color: var(--mk-red); font-weight: 700; }

.sdp-pw__textarea {
  width: 100%;
  min-height: 46vh;
  resize: vertical;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  padding: 12px;
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  background: var(--mk-surface);
  color: var(--mk-ink);
  outline: none;
  margin: 0 0 12px;
  box-sizing: border-box;
}
.sdp-pw__textarea:focus { border-color: var(--mk-blue); }

/* 源码视图：高亮覆盖层（深色编辑器） */
.sdp-codehl {
  position: relative;
  margin: 0 0 12px;
  min-height: min(46vh, 620px);
  max-height: min(74vh, 620px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mk-code-border, #1c2a40);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-code-bg, #0d1420);
  overflow: hidden;
}
.sdp-codehl__pre {
  position: absolute;
  inset: 0;
  margin: 0;
  /* 底部 26px = 12px 常规 + 14px 缓冲：容器 620px 与行高 20.8px 不成整倍，
     最后一行曾被容器下边框横向切半（2026-10-31 三轮评审）；两层 padding 必须一致，
     否则高亮层与文字错位 */
  padding: 12px 12px 26px;
  overflow: auto;
  scrollbar-width: none;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  white-space: pre;
  pointer-events: none;
}
.sdp-codehl__pre::-webkit-scrollbar { display: none; }
/* 整屏档：长 Prompt 通读（2.7 万字量级），高度按视口给，仍保持两层 padding 一致 */
.sdp-codehl--tall {
  min-height: min(84vh, 1200px);
  max-height: min(92vh, 1400px);
}
.sdp-codehl__ta {
  position: relative;
  z-index: 1;
  margin: 0;
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  padding: 12px 12px 26px;
  background: transparent;
  color: transparent;
  caret-color: #e8eef5;
  white-space: pre;
  overflow: auto;
  border-color: transparent;
}
.sdp-codehl__ta::placeholder { color: rgba(201, 212, 227, 0.4); }
.sdp-codehl__ta:focus { border-color: transparent; }
.sdp-pw__textarea:disabled:not(.sdp-codehl__ta) { background: #f6f8fc; color: var(--mk-faint); }
.sdp-pw__classify {
  margin: 0 16px 10px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  font-size: var(--mk-fs-micro);
}
.sdp-pw__classify ul { margin: 6px 0 0; padding-left: 18px; }
.sdp-pw__classify--safe { background: var(--mk-green-bg); }
.sdp-pw__classify--restricted { background: var(--mk-amber-bg); }
.sdp-pw__classify--blocked { background: var(--mk-red-bg); }
.sdp-pw__diag { margin: 0 16px 10px; display: grid; gap: 4px; }
.sdp-pw__diag--warn .sdp-pw__diag-item { color: var(--mk-amber); }
/* 本地表单校验失败（#125）：红底条 + 定位到具体卡片的文案 */
.sdp-pw__diag--err {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
}
.sdp-pw__diag-item { display: flex; gap: 8px; font-size: var(--mk-fs-micro); color: var(--mk-red); }
.sdp-pw__diag-item .mono { flex-shrink: 0; }
.sdp-pw__publish {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  font-size: var(--mk-fs-micro);
}
.sdp-pw__publish--ok { background: var(--mk-green-bg); }
.sdp-pw__publish--bad { background: var(--mk-red-bg); }
.sdp-pw__uncertain {
  margin: 0 16px 12px;
  padding: 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-amber-bg);
  font-size: var(--mk-fs-micro);
}
.sdp-pw__uncertain ul { margin: 6px 0 10px; padding-left: 18px; }
.sdp-pw__pane { display: grid; gap: 12px; align-content: start; padding: 0 18px 16px; max-height: 74vh; overflow-y: auto; }
.sdp-pw__gates { display: grid; gap: 6px; }
.sdp-pw__gate { font-size: var(--mk-fs-micro); padding: 6px 10px; border-radius: var(--mk-radius-sm); }
.sdp-pw__gate--ok { background: var(--mk-green-bg); }
.sdp-pw__gate--bad { background: var(--mk-red-bg); }
.sdp-pw__gate-issue { font-size: var(--mk-fs-micro); color: var(--mk-faint); padding-left: 10px; }
.sdp-pw__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sdp-pw__pre {
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--mk-mono);
}

/* ---------- 协议·表单视图 ---------- */
.sdp-pwform {
  display: grid;
  gap: 16px;
  padding: 0 18px 18px;
}
.sdp-pwform__card {
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  padding: 14px 18px;
  display: grid;
  gap: 12px;
  background: var(--mk-surface);
}
.sdp-pwform__cardhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 2px 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-body);
  font-weight: 700;
  color: var(--mk-ink);
  text-align: left;
  cursor: pointer;
}
.sdp-pwform__cardhead:hover { color: var(--mk-blue-text); }
.sdp-pwform__cardhead b { color: var(--mk-faint); font-weight: 600; }
.sdp-pwform__caret {
  font-style: normal;
  color: var(--mk-faint);
  transition: transform 0.15s ease;
}
.sdp-pwform__caret.is-open { transform: rotate(180deg); }
.sdp-pwform__cardbody {
  display: grid;
  gap: 12px;
  padding-top: 2px;
}
.sdp-pwform__card h5 {
  margin: 0;
  font-size: var(--mk-fs-body);
  color: var(--mk-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdp-pwform__card h5 b { color: var(--mk-faint); font-weight: 600; }
.sdp-pwform__card--danger { border-color: rgba(180, 83, 9, 0.35); }
.sdp-pwform__warn {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-amber);
  line-height: 1.6;
}
.sdp-pwform__note {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  line-height: 1.6;
}
/* 输入声明行（2026-10-31 三轮评审）：行内实有 5 个控件（name/type/ref/desc/删除），
   旧规则只给 3 列——desc 与「删除」被挤进隐式第二行，「删除」悬在行宽 60% 处，
   与下方执行规则段的排序箭头错位成一行，读作两个坏行。五列各归其位，删除贴最右。 */
.sdp-pwform__inputrow {
  display: grid;
  grid-template-columns: minmax(130px, 0.9fr) minmax(110px, 0.7fr) minmax(260px, 1.7fr) minmax(170px, 1.1fr) auto;
  gap: 10px;
  align-items: center;
}
@media (max-width: 860px) {
  .sdp-pwform__inputrow { grid-template-columns: 1fr; }
  .sdp-pwform__inputrow .mk-link { justify-self: start; }
  .sdp-pwform__inputrow--head { display: none; }
}
/* 列头行：与「输出字段」fieldrow--head 同款轻量表头（同字号/同弱色/同字重） */
.sdp-pwform__inputrow--head {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-weight: 700;
}
.sdp-pwform__field { display: grid; gap: 6px; }
.sdp-pwform__field > span { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
.sdp-pwform__checks { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.sdp-pwform__check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  cursor: pointer;
}
.sdp-pwform__check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.sdp-pwform__row3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: end;
}
@media (max-width: 860px) {
  .sdp-pwform__row3 { grid-template-columns: 1fr; }
}
.sdp-pwform__listitem {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}
.sdp-pwform__listitem textarea { min-height: 58px; }
.sdp-pwform__idx { color: var(--mk-faint); font-size: var(--mk-fs-micro); padding-top: 10px; text-align: right; }
.sdp-pwform__itemops { display: flex; gap: 6px; padding-top: 8px; }
.sdp-pwform__fields { display: grid; gap: 8px; }
.sdp-pwform__fieldrow {
  display: grid;
  /* 列宽重分配（2026-10-31 四轮评审 P1-7）：name 只存 reply/figure 这类短标识，
     原 1fr 却占约 25%；真正带说明的 desc 只有 1.6fr 且单行截断。
     现 name 收窄、desc 加宽（并且是可变高的多行框）。 */
  grid-template-columns: minmax(96px, 0.7fr) 108px 32px minmax(260px, 2.4fr) 32px 52px;
  gap: 10px;
  align-items: start;
  padding: 4px 0;
}
/* desc 多行框：默认单行高、可纵向拖拽展开（与规则 textarea 同语汇） */
.sdp-pwform__fielddesc { min-height: 36px; resize: vertical; line-height: 1.6; }
.sdp-pwform__fieldrow--head {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-weight: 700;
  padding-bottom: 0;
}
.sdp-pwform__fieldrow input[type='checkbox'] { width: 15px; height: 15px; accent-color: var(--mk-blue); justify-self: center; align-self: center; }
/* 行内对齐：desc 变高后复选框与删除钮仍居行首那条基线上 */
.sdp-pwform__fieldrow > .mk-link { align-self: center; justify-self: end; }
.sdp-pwform .mk-input { min-height: 36px; padding: 8px 12px; font-size: var(--mk-fs-body); }
.sdp-pwform textarea.mk-input { line-height: 1.65; }
@media (max-width: 860px) {
  .sdp-pwform__fieldrow { grid-template-columns: 1fr 96px 52px; }
  .sdp-pwform__fieldrow--head { display: none; }
}

/* ---------- 预览视图（编译门禁 + 产物，原右栏收编为「预览」视图） ---------- */
.sdp-pw__previewpane { display: grid; gap: 10px; }
.sdp-pw__previewpane .mk-section__head { padding: 12px 18px 0; }

/* 查看态与编辑态在窄屏的收窄 */
@media (max-width: 900px) {
  .sdp-pw__grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .sdp-crow { grid-template-columns: minmax(0, 1fr); }
  .sdp-crow__type { text-align: left; }
  .sdp-flowrow { grid-template-columns: minmax(0, 1fr); }
}

/* 4K：设计页放宽 + 编辑器字号跟随壳层放大 */
@media (min-width: 2000px) {
  .sdp-pw__textarea,
  .sdp-codehl__pre { font-size: var(--mk-fs-micro); }
  .sdp-pwform .mk-input { font-size: var(--mk-fs-body); }
  .sdp-pw__pre { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .sdp-pw__textarea,
  .sdp-codehl__pre { font-size: var(--mk-fs-micro); }
  .sdp-pwform .mk-input { font-size: var(--mk-fs-body); }
  .sdp-pw__pre { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .sdp .mk-input { font-size: var(--mk-fs-emphasis); padding: 12px 15px; }
  .sdp-pw__textarea,
  .sdp-codehl__pre { font-size: var(--mk-fs-emphasis); }
  .sdp-pwform .mk-input { font-size: var(--mk-fs-emphasis); min-height: 46px; }
  .sdp-pw__pre { font-size: var(--mk-fs-body); }
  .sdp-pw__classify { font-size: var(--mk-fs-body); }
  .sdp-pw__diag-item { font-size: var(--mk-fs-body); }
  .sdp-pw__publish { font-size: var(--mk-fs-body); }
  .sdp-pw__uncertain { font-size: var(--mk-fs-body); }
  .sdp-pw__gate { font-size: var(--mk-fs-body); }
  .sdp-pw__gate-issue { font-size: var(--mk-fs-body); }
  .sdp-pw__meta { font-size: var(--mk-fs-body); }
  .sdp-pwform__cardhead { font-size: var(--mk-fs-emphasis); }
  .sdp-pwform__card h5 { font-size: var(--mk-fs-emphasis); }
  .sdp-pwform__warn { font-size: var(--mk-fs-body); }
  .sdp-pwform__note { font-size: var(--mk-fs-body); }
  .sdp-pwform__field > span { font-size: var(--mk-fs-body); }
  .sdp-pwform__check { font-size: var(--mk-fs-emphasis); }
  .sdp-pwform__fieldrow--head { font-size: var(--mk-fs-body); }
  .sdp-pwform__idx { font-size: var(--mk-fs-body); }
}

/* 暗色模式 */
[data-theme='dark'] .sdp-pwform__card { background: var(--wf-bg-subtle); }
[data-theme='dark'] .sdp-pw__textarea:not(.sdp-codehl__ta) { background: #19191a; color: #e6edf7; }
[data-theme='dark'] .sdp-pw__textarea:disabled:not(.sdp-codehl__ta) { background: #202122; }

</style>