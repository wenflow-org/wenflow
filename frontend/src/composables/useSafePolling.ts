/**
 * 安全轮询 composable
 *
 * 解决 setInterval 在后端不可用时内存无限增长的问题：
 * - setTimeout 链：下一次轮询在上一次完成（成功或失败）后才调度
 * - 并发守卫：前一个请求未完成时不发新请求
 * - 指数退避：连续失败时拉长间隔（base → 2× → 4× → 8× → max），成功后恢复
 * - 断路器：连续失败 N 次后停止轮询，需手动重试
 */

import { ref, onBeforeUnmount } from 'vue'

export interface SafePollingOptions {
  /** 基础轮询间隔（ms），默认 10000 */
  interval?: number
  /** 最大退避间隔（ms），默认 60000 */
  maxBackoff?: number
  /** 连续失败多少次后触发断路器停止轮询，默认 5 */
  circuitBreakerThreshold?: number
  /** 页面隐藏时是否跳过，默认 true */
  skipWhenHidden?: boolean
  /** start() 时是否立即执行第一次；false 则等到第一个间隔后才轮询，默认 true */
  immediate?: boolean
  /** 出错回调 */
  onError?: (error: unknown, consecutiveFailures: number) => void
  /** 断路器触发回调 */
  onCircuitBroken?: (consecutiveFailures: number) => void
}

export function useSafePolling(
  fn: () => Promise<void>,
  options: SafePollingOptions = {}
) {
  const {
    interval = 10000,
    maxBackoff = 60000,
    circuitBreakerThreshold = 5,
    skipWhenHidden = true,
    immediate = true,
    onError,
    onCircuitBroken,
  } = options

  const isActive = ref(false)
  const consecutiveFailures = ref(0)
  const circuitBroken = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let polling = false

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function scheduleNext() {
    if (!isActive.value || circuitBroken.value) return
    const delay = Math.min(interval * Math.pow(2, consecutiveFailures.value), maxBackoff)
    timer = setTimeout(run, delay)
  }

  async function run() {
    if (!isActive.value || circuitBroken.value) return
    if (skipWhenHidden && document.hidden) {
      scheduleNext()
      return
    }
    // 并发守卫：上一次还在跑就跳过本轮
    if (polling) {
      scheduleNext()
      return
    }

    polling = true
    try {
      await fn()
      // 成功后重置退避
      consecutiveFailures.value = 0
    } catch (error) {
      consecutiveFailures.value++
      onError?.(error, consecutiveFailures.value)

      if (consecutiveFailures.value >= circuitBreakerThreshold) {
        circuitBroken.value = true
        onCircuitBroken?.(consecutiveFailures.value)
        return // 不再调度下一次
      }
    } finally {
      polling = false
    }

    scheduleNext()
  }

  function start() {
    if (isActive.value) return
    isActive.value = true
    circuitBroken.value = false
    consecutiveFailures.value = 0
    // 立即执行第一次（immediate: false 时跳过，等第一个间隔）
    if (immediate) {
      run()
    } else {
      scheduleNext()
    }
  }

  function stop() {
    isActive.value = false
    clearTimer()
  }

  /** 断路器触发后手动恢复 */
  function reset() {
    circuitBroken.value = false
    consecutiveFailures.value = 0
    start()
  }

  onBeforeUnmount(stop)

  return { isActive, consecutiveFailures, circuitBroken, start, stop, reset }
}