<template>
  <Teleport to="body">
    <div v-if="confirmState.open" ref="maskRef" class="mk-modal">
      <div
        ref="panelRef"
        class="mk-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mk-confirm-title"
      >
        <!-- 结构 = 原型 openConfirm（newui .modal）：ovl__head（shield 图标 + 标题）/
             ovl__body 正文 / ovl__foot（取消左、危险确认右，均右对齐）三段贴边排布 -->
        <div class="mk-confirm__head">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v5.5c0 4.4-3 7.6-7 9.5-4-1.9-7-5.1-7-9.5V6z" />
          </svg>
          <h2 id="mk-confirm-title" class="mk-confirm__title">{{ confirmState.title }}</h2>
        </div>
        <div class="mk-confirm__body">
          <p class="mk-confirm__msg">{{ confirmState.message }}</p>
          <label v-if="confirmState.input" class="mk-confirm__input">
            <span>{{ confirmState.input.label }}</span>
            <input
              v-model="confirmState.inputValue"
              type="text"
              class="mk-field__input"
              :placeholder="confirmState.input.placeholder || ''"
              @keydown.enter="confirm()"
            />
          </label>
        </div>
        <div class="mk-confirm__actions">
          <button type="button" class="mk-btn" :disabled="confirmState.busy" @click="settleConfirm(false)">取消</button>
          <button
            type="button"
            class="mk-btn"
            :class="confirmState.danger ? 'mk-btn--danger' : 'mk-btn--primary'"
            :disabled="confirmState.busy"
            @click="confirm"
          >
            {{ confirmState.busy ? '处理中…' : confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { confirmState, settleConfirm } from './useConfirm'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'

/** 全局确认对话框（单例）：替换 window.confirm / prompt，接入焦点管理/滚动锁定/Esc */
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => confirmState.open), panelRef)
useMaskClose(maskRef, () => { if (!confirmState.busy) settleConfirm(false) })
useEscape(() => confirmState.open, () => { if (!confirmState.busy) settleConfirm(false) })

function confirm() {
  if (confirmState.busy) return
  if (confirmState.input) {
    settleConfirm(confirmState.inputValue.trim() || null)
  } else if (confirmState.busyMode) {
    /* busy 模式：**立即 resolve(true)** 让调用方开始干活，同时弹窗保持打开并进入 busy 态
       （按钮禁用 + 「处理中…」），由业务完成后的 done()/failConfirm() 真正关闭。

       此处必须 resolve：调用方的既有写法是
         const ok = await askConfirm({ busy: true, … }); if (!ok) return; …业务…; doneConfirm()
       若像原实现那样只置 busy 而不 settle，调用方会永久挂起、业务代码永不执行、
       done() 永不被调用 → 弹窗卡死在「处理中…」（死锁，见 __tests__/confirm.busy.test.ts）。 */
    const resolve = confirmState.resolve
    confirmState.resolve = null
    confirmState.busy = true
    resolve?.(true)
  } else {
    settleConfirm(true)
  }
}
</script>

<style scoped>
/* 口径源：newui/UI-分支优化设计 index.html 的 .modal / .ovl__head / .ovl__body / .ovl__foot /
   @keyframes popIn（openConfirm()）。三段贴边排布：head 16px + 分隔线、body 16px、
   foot 12×16 + 分隔线；卡 480px、r-modal、popIn 入场。 */
.mk-confirm {
  width: min(480px, 100%);
  padding: 0;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-modal);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-modal);
  display: grid;
  animation: mk-pop-in 0.18s cubic-bezier(0.2, 0.7, 0.3, 1);
}
@keyframes mk-pop-in {
  from { transform: translateY(8px) scale(0.98); opacity: 0.4; }
  to { transform: none; opacity: 1; }
}
.mk-confirm__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid var(--mk-line);
}
.mk-confirm__head svg { flex: none; }
.mk-confirm__title { margin: 0; font-size: var(--mk-fs-16); font-weight: 700; }
.mk-confirm__body {
  padding: 16px;
  display: grid;
  gap: 12px;
}
.mk-confirm__msg {
  margin: 0;
  font-size: var(--mk-fs-body);
  line-height: 1.7;
  color: var(--mk-muted);
  white-space: pre-wrap;
}
.mk-confirm__input { display: grid; gap: 6px; }
.mk-confirm__input span { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
.mk-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--mk-line);
}

/* ========== 大屏/4K 适配 ==========
   宽度改引全站共享档位 token（2026-10-06 审核 §主题 3）：此前自搓 480→500→600→700，
   与 .mk-modal__panel 的 480→620→760→900 脱钩，4K 下确认框比同族弹窗明显窄。
   确认框是「基础档弹窗」，取共享 token 的基础档值（带字面兜底，
   未加载 mk-primitives.css 的用户页也能渲染）。 */
@media (min-width: 2000px) {
  .mk-confirm { width: min(var(--mk-modal-w-lg, 620px), 100%); }
  .mk-confirm__head, .mk-confirm__body { padding: 20px 24px; }
  .mk-confirm__title { font-size: var(--mk-fs-emphasis); }
  .mk-confirm__msg { font-size: var(--mk-fs-body); }
  .mk-confirm__input span { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .mk-confirm { width: min(var(--mk-modal-w-xl, 760px), 100%); }
  .mk-confirm__title { font-size: var(--mk-fs-emphasis); }
  .mk-confirm__msg { font-size: var(--mk-fs-body); }
  .mk-confirm__input span { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  /* 4K（确认框 Teleport 到 body，无 zoom）：加宽 + 字号继续放大 */
  .mk-confirm { width: min(var(--mk-modal-w-xxl, 900px), 100%); }
  .mk-confirm__title { font-size: 23px; }
  .mk-confirm__msg { font-size: var(--mk-fs-emphasis); }
  .mk-confirm__input span { font-size: var(--mk-fs-emphasis); }
}
</style>

<style>
/* 非 scoped（Teleport 到 body）：遮罩 + 按钮基础样式自包含，保证未加载
   mk-primitives.css 的 v2 用户页/学习页弹窗仍居中、按钮与全站 mk 体系一致。

   取值必须与 mk-primitives.css 的 canonical 逐项一致（2026-10-06 审核 §主题 3）：
   此前本文件各定义一份 `.mk-modal`/`.mk-btn`，admin 页两份同文档并存，谁生效取决于
   样式注入顺序（admin 侧懒加载晚注入 → 拿到本文件的值），于是同一枚确认框在 admin 页
   与用户页渲染出两套遮罩深浅与按钮尺寸/圆角/字重。改成同值后顺序不再重要。
   令牌源 tokens.css 经 main.css 全局加载，用户页亦可用。 */
.mk-modal {
  position: fixed;
  inset: 0;
  z-index: var(--mk-z-modal, 300);
  background: var(--wf-overlay);
  display: grid;
  place-items: center;
  padding: 20px;
}
.mk-btn {
  padding: 5px 14px;
  border-radius: var(--mk-radius-md);
  border: 1px solid var(--mk-line, #e1e8f2);
  background: var(--mk-surface, #fff);
  color: var(--mk-ink, #1a2a44);
  font: inherit;
  font-size: var(--mk-fs-body);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.mk-btn:hover { background: var(--mk-btn-hover-bg, #f6f9ff); }
.mk-btn:disabled { opacity: 0.6; cursor: default; }
.mk-btn--primary {
  background: var(--mk-blue-fill, #2f6ae0);
  border-color: var(--mk-blue-fill, #2f6ae0);
  color: var(--mk-on-fill);
}
.mk-btn--primary:hover { background: var(--mk-blue-fill-hover, #1f57cc); }
/* 危险按钮：红底白字。复用全站 .mk-btn--danger 语义类（而非自定义类名），
   否则在 admin 页会与 mk-primitives.css 的 .mk-btn 同特异性竞争、被后者按层叠顺序覆盖为白底。 */
.mk-btn--danger {
  border: 1px solid var(--mk-red-fill, #dc2626);
  background: var(--mk-red-fill, #dc2626);
  color: var(--mk-on-fill);
}
.mk-btn--danger:hover { background: var(--mk-red-fill-strong, #b91c1c); border-color: var(--mk-red-fill-strong, #b91c1c); }
/* 暗色覆写：与 mk-primitives.css 同源同值（Confirm 独立承载，不依赖 admin shared.css 加载）。
   遮罩/悬停底色已全部走 token，无需再写死 hex。 */
</style>
