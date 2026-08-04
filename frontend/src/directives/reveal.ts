import type { Directive } from 'vue'

/**
 * v-reveal — 滚动进入视口时揭示元素（淡入 + 上浮）。
 *
 * 用法：
 *   <section v-reveal />                    进入视口 25% 时揭示一次
 *   <li v-reveal="{ delay: i * 70 }" />     带阶梯延迟（毫秒）
 *
 * 样式依赖 main.css 中的 .rv / .rv-in；全局 prefers-reduced-motion
 * 规则会把过渡压到瞬时，因此无需额外降级处理。
 *
 * 揭示完成后会把 .rv/.rv-in 与内联 transition-delay 一并移除，
 * 让元素恢复组件自身定义的 transition（如 hover 抬升），避免冲突。
 */

interface RevealOptions {
  delay?: number
}

let sharedObserver: IntersectionObserver | null = null
const cleanupTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

function getObserver(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const el = entry.target as HTMLElement
          el.classList.add('rv-in')
          sharedObserver?.unobserve(el)

          const delay = parseFloat(el.style.transitionDelay) || 0
          cleanupTimers.set(
            el,
            setTimeout(() => {
              el.classList.remove('rv', 'rv-in')
              el.style.transitionDelay = ''
              cleanupTimers.delete(el)
            }, 1000 + delay)
          )
        })
      },
      { threshold: 0.25, rootMargin: '0px 0px -8% 0px' }
    )
  }
  return sharedObserver
}

export const vReveal: Directive<HTMLElement, RevealOptions | number | undefined> = {
  mounted(el, binding) {
    el.classList.add('rv')
    const delay = typeof binding.value === 'number' ? binding.value : binding.value?.delay
    if (delay) el.style.transitionDelay = `${delay}ms`
    getObserver().observe(el)
  },
  unmounted(el) {
    sharedObserver?.unobserve(el)
    const timer = cleanupTimers.get(el)
    if (timer) {
      clearTimeout(timer)
      cleanupTimers.delete(el)
    }
  }
}

export default vReveal
