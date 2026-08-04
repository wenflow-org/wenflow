import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 行内 ⋯ 菜单：危险/低频操作收进菜单，避免与高频操作同权平铺。
 * - 点击 ⋯ 按钮切换（stopPropagation）
 * - 点击页面其他位置自动关闭（document click）
 */
export function useRowMenu() {
  const openMenu = ref('')

  function toggleMenu(id: string) {
    openMenu.value = openMenu.value === id ? '' : id
  }
  function closeMenu() {
    openMenu.value = ''
  }

  onMounted(() => document.addEventListener('click', closeMenu))
  onBeforeUnmount(() => document.removeEventListener('click', closeMenu))

  return { openMenu, toggleMenu, closeMenu }
}
