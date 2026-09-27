<template>
  <span ref="wrapRef" class="imm-menu">
    <button
      type="button"
      class="imm-menu__btn"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      title="更多"
      @click="toggle"
    >⋯</button>
    <Transition name="imm-pop">
      <!-- 插槽内容是真 button 列表（keyboard 原生可达），容器只做点击委托收起菜单；
           不标 role="menu"——menu 语义要求子项为 menuitem，与真按钮不符 -->
      <div v-if="open" class="imm-menu__pop" @click="onItemClick">
        <slot />
      </div>
    </Transition>
  </span>
</template>

<script setup lang="ts">
/* 沉浸页「⋯ 更多」菜单（2026-09-26 批12 抽取）：
   课堂页与评估页此前各自维护一份触发器 + 弹层 + 点外关闭/Esc 逻辑，已出现漂移
   （评估页弹层被后续卡片盖住）。开合机制内聚到这里，菜单项由使用方以默认插槽传入
   （插槽内容编译在父作用域，沿用各自的 item 样式）；点击弹层内任意项自动关闭。 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const open = ref(false);
const wrapRef = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
}
function onItemClick() {
  open.value = false;
}
function onDocClick(e: MouseEvent) {
  if (!open.value || !wrapRef.value) return;
  if (!wrapRef.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
.imm-menu { position: relative; display: inline-flex; flex-shrink: 0; }
.imm-menu__btn {
  width: 44px; height: 44px;
  display: grid; place-items: center;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: var(--mk-radius-md, 10px);
  background: var(--surface, #fff);
  color: var(--muted, #5b6577);
  font-size: 17px;
  line-height: 1;
  padding: 0 0 2px;
  cursor: pointer;
  font-family: inherit;
}
.imm-menu__btn:hover { color: var(--blue-deep, #1f57cc); border-color: color-mix(in srgb, var(--blue, #3478f6) 40%, transparent); }
.imm-menu__pop {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  min-width: 156px;
  display: grid;
  gap: 2px;
  padding: 6px;
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 12px;
  box-shadow: 0 14px 34px rgba(23, 32, 51, 0.14);
}
.imm-pop-enter-active,
.imm-pop-leave-active { transition: opacity var(--mk-dur-fast, 120ms) var(--mk-ease-out, ease), transform var(--mk-dur-fast, 120ms) var(--mk-ease-out, ease); }
.imm-pop-enter-from,
.imm-pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
