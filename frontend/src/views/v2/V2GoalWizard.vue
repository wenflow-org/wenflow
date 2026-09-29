<template>
  <Teleport to="body">
    <div v-if="open" class="wiz" role="dialog" aria-modal="true" aria-label="分步创建学习目标" @click.self="emit('close')">
      <div class="wiz__card">
        <header class="wiz__head">
          <h3 class="wiz__title">规划一个新目标</h3>
          <button type="button" class="wiz__x" aria-label="关闭" @click="emit('close')">✕</button>
        </header>

        <!-- 步骤点条（原型 wf-steps 形态：24px 圆点 + 连线） -->
        <ol class="wiz__steps" aria-label="创建步骤">
          <li v-for="(s, i) in STEPS" :key="s" class="wiz__step" :class="{ 'is-on': step === i + 1, 'is-done': step > i + 1 }">
            <span class="wiz__step-dot" aria-hidden="true">{{ step > i + 1 ? '✓' : i + 1 }}</span>
            <span class="wiz__step-label">{{ s }}</span>
          </li>
        </ol>

        <!-- Step 1：目标 + 方向卡 -->
        <div v-if="step === 1" class="wiz__pane">
          <label class="wiz__label" for="wiz-goal">先说清你想解决的事</label>
          <textarea
            id="wiz-goal"
            v-model="goal"
            class="wiz__input"
            rows="3"
            :maxlength="300"
            placeholder="例：每周 Excel 周报太花时间，想用 Python 自动化"
          ></textarea>
          <p v-if="scenes.length" class="wiz__label wiz__label--sub">或者从这些方向挑一个</p>
          <div class="wiz__options">
            <button
              v-for="c in scenes.slice(0, 3)"
              :key="c.seed"
              type="button"
              class="wiz__radio"
              :class="{ 'is-on': goal === c.title }"
              @click="pickScene(c)"
            >
              <b>{{ c.title }}</b>
              <span>{{ c.desc }}</span>
            </button>
          </div>
        </div>

        <!-- Step 2：每天投入 -->
        <div v-else-if="step === 2" class="wiz__pane">
          <p class="wiz__label">每天大概能投入多少时间？</p>
          <div class="wiz__options">
            <button
              v-for="t in TIMES"
              :key="t"
              type="button"
              class="wiz__radio"
              :class="{ 'is-on': time === t }"
              @click="time = t"
            >
              <b>{{ t }}</b>
            </button>
          </div>
          <p class="wiz__hint">路径的任务量会按这个预算切分；之后随时可以调整。</p>
        </div>

        <!-- Step 3：基础水平 + 确认摘要 -->
        <div v-else class="wiz__pane">
          <p class="wiz__label">你在这个方向上的基础大概是什么水平？</p>
          <div class="wiz__options">
            <button
              v-for="l in LEVELS"
              :key="l"
              type="button"
              class="wiz__radio"
              :class="{ 'is-on': level === l }"
              @click="level = l"
            >
              <b>{{ l }}</b>
            </button>
          </div>
          <div class="wiz__summary">
            <div class="wiz__row"><span>目标</span><b>{{ goal }}</b></div>
            <div class="wiz__row"><span>每天投入</span><b>{{ time }}</b></div>
            <div class="wiz__row"><span>基础水平</span><b>{{ level }}</b></div>
          </div>
        </div>

        <footer class="wiz__foot">
          <button v-if="step > 1" type="button" class="wiz__btn" @click="step -= 1">上一步</button>
          <span class="wiz__foot-grow"></span>
          <button v-if="step < 3" type="button" class="wiz__btn wiz__btn--primary" :disabled="!canNext" @click="step += 1">下一步</button>
          <button v-else type="button" class="wiz__btn wiz__btn--primary" :disabled="!canNext || sending" @click="finish">
            {{ sending ? '正在生成…' : '生成路径' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * 目标新建三步向导（newui/home wfWizard 形态）：目标输入+方向卡 → 每天投入 →
 * 基础水平+确认摘要。末步「生成路径」把三步答案合成一条开场消息，
 * 交给目标规划对话的真实链路（live.send）——不做假延时、不假生成。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    sending?: boolean;
    /** 入口态已有的方向卡（标题+种子文案），作 step1 的快捷选项 */
    scenes?: Array<{ title: string; seed: string; desc?: string }>;
    /** 打开时预填：用户已在入口输入框敲了一半的目标 */
    seed?: string;
  }>(),
  { sending: false, scenes: () => [], seed: '' },
);
const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm', text: string): void }>();

const scenes = computed(() => props.scenes ?? []);
const STEPS = ['说清目标', '每天投入', '基础与确认'];
const TIMES = ['15 分钟', '30 分钟', '1 小时', '不固定'];
const LEVELS = ['零基础', '有一些基础', '比较熟练'];

const step = ref(1);
const goal = ref('');
const time = ref('30 分钟');
const level = ref('有一些基础');

watch(
  () => props.open,
  (open) => {
    if (open) {
      step.value = 1;
      goal.value = props.seed?.trim() || '';
      time.value = '30 分钟';
      level.value = '有一些基础';
    }
  },
);

const canNext = computed(() => (step.value === 1 ? goal.value.trim().length > 0 : true));

function pickScene(c: { title: string; seed: string }) {
  goal.value = c.title;
  // 方向卡自带更完整的种子文案：留作生成路径时的开场底稿
  sceneSeed.value = c.seed;
}
const sceneSeed = ref('');

function finish() {
  const g = goal.value.trim();
  if (!g) return;
  // 方向卡的种子文案比标题更完整：优先用种子，否则用用户输入的目标
  const base = sceneSeed.value.trim() && scenes.value.some((c) => c.title === g) ? sceneSeed.value.trim() : g;
  emit('confirm', `${base}。我每天能投入约 ${time.value}，基础水平${level.value}。请先帮我收敛目标，再生成可执行的学习路径。`);
}
</script>

<style scoped>
.wiz {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(10, 18, 36, 0.45);
}
.wiz__card {
  width: min(100%, 540px);
  max-height: min(86dvh, 720px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 20px 22px;
  box-shadow: 0 24px 64px rgba(16, 26, 48, 0.22);
}
.wiz__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.wiz__title { margin: 0; font-size: 17px; font-weight: 800; color: var(--ink); }
.wiz__x {
  border: 0; background: transparent; color: var(--faint);
  font-size: 15px; cursor: pointer; padding: 4px 8px; border-radius: 8px;
}
.wiz__x:hover { background: var(--mk-surface-2); color: var(--ink); }

/* 步骤点条 */
.wiz__steps {
  list-style: none; margin: 14px 0 4px; padding: 0;
  display: flex; gap: 6px;
}
.wiz__step { flex: 1; display: grid; justify-items: center; gap: 4px; }
.wiz__step-dot {
  width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center;
  font-size: 12px; font-weight: 800;
  background: var(--mk-surface-2); color: var(--muted);
  border: 1px solid var(--line);
}
.wiz__step.is-on .wiz__step-dot {
  background: var(--blue); color: #fff; border-color: var(--blue);
}
.wiz__step.is-done .wiz__step-dot { background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue-deep); border-color: transparent; }
.wiz__step-label { font-size: 12px; font-weight: 700; color: var(--muted); }
.wiz__step.is-on .wiz__step-label { color: var(--ink); }

/* 分-pane */
.wiz__pane { display: grid; gap: 10px; padding: 14px 0 4px; }
.wiz__label { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--ink); }
.wiz__label--sub { margin-top: 6px; font-weight: 600; color: var(--muted); }
.wiz__input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--mk-bg, #f7f8fa);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  line-height: 1.6;
  padding: 10px 12px;
  resize: vertical;
  min-height: 74px;
  outline: none;
}
.wiz__input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 12%, transparent); }
.wiz__hint { margin: 0; font-size: 12.5px; color: var(--faint); }

/* 选项卡（原型 wf-radio 卡形态） */
.wiz__options { display: grid; gap: 8px; }
.wiz__radio {
  display: grid; gap: 2px; text-align: left;
  padding: 11px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  font: inherit;
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
}
.wiz__radio b { font-size: 13.5px; font-weight: 700; color: var(--ink); }
.wiz__radio span { font-size: 12.5px; color: var(--muted); }
.wiz__radio:hover { border-color: color-mix(in srgb, var(--blue) 45%, transparent); }
.wiz__radio.is-on { border-color: var(--blue); background: color-mix(in srgb, var(--blue) 6%, var(--surface)); }
.wiz__radio.is-on b { color: var(--blue-deep); }

/* 确认摘要 */
.wiz__summary { display: grid; gap: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.wiz__row {
  display: grid; grid-template-columns: 84px 1fr; gap: 10px;
  padding: 9px 12px;
  background: var(--mk-surface-2);
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.wiz__row:last-child { border-bottom: 0; }
.wiz__row span { color: var(--muted); }
.wiz__row b { color: var(--ink); overflow-wrap: anywhere; }

.wiz__foot { display: flex; align-items: center; gap: 8px; padding-top: 14px; }
.wiz__foot-grow { flex: 1; }
.wiz__btn {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.15s ease;
}
.wiz__btn:hover:not(:disabled) { transform: translateY(-1px); }
.wiz__btn--primary {
  border: 0;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--blue) 30%, transparent);
}
.wiz__btn:disabled { opacity: 0.55; cursor: default; transform: none; }
@media (max-width: 640px) {
  .wiz { padding: 10px; align-items: end; }
  .wiz__card { max-height: 92dvh; }
}
</style>
