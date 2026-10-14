<script setup lang="ts">
/** 开关原语（Switch）：**开/关型的配置**用一枚开关，不用并排双按钮。
 *
 *  来历（2026-10-14 用户评审）：「开放注册 / 关闭注册」「启用 / 关闭」这类并排两段，
 *  读者分不清它是**分段视图切换器**还是**点击即生效的动作按钮**——两枚按钮都长得像按钮、
 *  都带选中态，语义靠猜。开关型配置的正确形态是「一个控件 + 一个当前状态词」。
 *
 *  为什么是组件：role=switch / aria-checked / 键盘 Space·Enter / busy 禁用 / 状态词跟随，
 *  每个调用点重写一遍就会各处分叉（本仓已有多处 checkbox 与 mk-seg 混用，即此病）。
 *
 *  分工：**布尔**用 MkSwitch；**多档枚举**用 mk-seg 分段器（如「全部 / 仅看异常」）；
 *  表单里的多项勾选仍用 `mk-field--switch` 的 checkbox（那是在填表，不是在开关一个功能）。
 *
 *  无障碍：根是真 <button role="switch">，原生吃 Enter/Space；焦点环走 mk token。
 */
withDefaults(
  defineProps<{
    modelValue: boolean
    /** 可见标签（可选）；只给状态词时用 ariaLabel 提供无障碍名 */
    label?: string
    /** 状态词（可见，跟随开关翻转）——例：「任何人均可注册 / 仅管理员创建」 */
    stateText?: string
    /** 无障碍名（label 缺失时必给，否则读屏只有「开关」两字） */
    ariaLabel?: string
    /** 悬停全文（口径、生效范围、风险提示等） */
    title?: string
    disabled?: boolean
    /** 请求在途：禁用 + 半透明，避免连点 */
    busy?: boolean
  }>(),
  { label: '', stateText: '', ariaLabel: '', title: '', disabled: false, busy: false }
)

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

function toggle(e: MouseEvent, on: boolean) {
  // 在途时按钮已被 disabled 拦住；此处只做语义翻转，真实写盘由父级承担
  if ((e.currentTarget as HTMLButtonElement).disabled) return
  emit('update:modelValue', !on)
}
</script>

<template>
  <button
    type="button"
    class="mk-switch"
    :class="{ 'mk-switch--on': modelValue, 'mk-switch--busy': busy }"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="ariaLabel || label || undefined"
    :title="title || undefined"
    :disabled="disabled || busy"
    @click="toggle($event, modelValue)"
  >
    <span class="mk-switch__track" aria-hidden="true"><span class="mk-switch__knob"></span></span>
    <span v-if="label" class="mk-switch__label">{{ label }}</span>
    <span v-if="stateText" class="mk-switch__state">{{ stateText }}</span>
  </button>
</template>

<style scoped>
.mk-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 2px 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: var(--mk-radius-sm);
}
.mk-switch:disabled { cursor: not-allowed; opacity: 0.55; }
.mk-switch:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; }
/* 轨道/旋钮：只走 token（暗色自动翻转；颜色不写死，硬编码色值会被 design:check 计入棘轮） */
.mk-switch__track {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface-3);
  transition: background 0.15s var(--mk-ease-out), border-color 0.15s var(--mk-ease-out);
}
.mk-switch__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--mk-surface);
  transition: transform 0.15s var(--mk-ease-out);
}
.mk-switch--on .mk-switch__track { background: var(--mk-green); border-color: var(--mk-green); }
.mk-switch--on .mk-switch__knob { transform: translateX(16px); }
.mk-switch__label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.mk-switch__state { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 4K：跟随全站字号节奏（轨道只放大一档，别在大屏上缩成一点） */
@media (min-width: 2000px) {
  .mk-switch__track { width: 40px; height: 22px; }
  .mk-switch__knob { width: 16px; height: 16px; }
  .mk-switch--on .mk-switch__knob { transform: translateX(18px); }
  .mk-switch__label, .mk-switch__state { font-size: var(--mk-fs-body); }
}
</style>
