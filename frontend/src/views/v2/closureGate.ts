/**
 * 课堂收束门禁的共享口径（2026-11-21）。
 *
 * 同一组 409 既会从课堂页（V2LearningPage）弹出，也会从学习反馈页
 * （LearningEvaluationPage）的「完成任务」弹出。两页此前各写一套：
 * 课堂页按 code 给不同去向，反馈页只认末问/小测两条、契约门直接落成通用失败 toast。
 * 这里把「提示文案 + 下一步入口」收敛成一份，保证两页对同一个门禁说同一句话。
 *
 * 去向约定（durable action）：
 * - 每条门禁都保留学员自己能推进的动作（回答 / 作答 / 继续学习）；
 * - 每条门禁都提供同一个**持久出口**「结束学习（不计入完成）」（end_only）——
 *   服务端 end_only 以 allowOpenQuestion 豁免全部收束判据，任何门禁下都可用，
 *   不是只在某条分支里才出现的临时按钮。
 */

export type ClosureGateAction = 'composer' | 'checkpoint' | 'dismiss'

export type ClosureGateCode =
  | 'FINALIZATION_PENDING_CHECKPOINT'
  | 'FINALIZATION_OPEN_QUESTION'
  | 'FINALIZATION_LAST_CHECKPOINT_FAILED'
  | 'LESSON_CONTRACT_NOT_MET'

export interface ClosureGateCopy {
  title: string
  action: ClosureGateAction
  actionLabel: string
  guide?: string
}

/** 持久出口：结束学习不计入完成（服务端 end_only）。课堂页与反馈页共用同一文案。 */
export const END_WITHOUT_FINISH_LABEL = '提前结束（不计完成）'

/** 课堂页「仍然完成结算」只对末问门禁开放（未答小测/末次检查仍硬拦）。 */
export const CLOSURE_GATE_CODES: ClosureGateCode[] = [
  'FINALIZATION_PENDING_CHECKPOINT',
  'FINALIZATION_OPEN_QUESTION',
  'FINALIZATION_LAST_CHECKPOINT_FAILED',
  'LESSON_CONTRACT_NOT_MET',
]

export function isClosureGateCode(code: unknown): code is ClosureGateCode {
  return typeof code === 'string' && (CLOSURE_GATE_CODES as string[]).includes(code)
}

export const CLOSURE_GATE_COPY: Record<ClosureGateCode, ClosureGateCopy> = {
  /* 2026-11-01 课堂走查：答完一问后老师常紧接新问题 / 新小测，再点结算又吃 409——
     循环缺「先把这一轮讲完再结算」的引导。服务端 409 响应体带 error.code（ai-teaching
     路由统一错误出口），按原因各补一句「为什么被拦 + 现在该做什么」。
     2026-11-03 真人走查修正：原话「老师回应完这一轮，再来结算课堂」是**空头支票**——
     这位老师每轮都以提问收尾，实测连答 4 轮才等到一次不问的回应。改成如实说明
     「可能还会再拦」+ 指出随时可用的出口（结束学习不计入完成），学员不必在循环里干等。 */
  FINALIZATION_OPEN_QUESTION: {
    title: '先回答老师的问题',
    action: 'composer',
    actionLabel: '去回答',
    guide: '回答后可结算（若老师继续提问会再拦）；也可「仍然完成结算」（该问记入待验证）或提前结束（不计完成）。'
  },
  FINALIZATION_PENDING_CHECKPOINT: {
    title: '先完成这道小测',
    action: 'checkpoint',
    actionLabel: '去作答',
    guide: '答完本轮小测后再结算。'
  },
  FINALIZATION_LAST_CHECKPOINT_FAILED: {
    title: '先把最后一道小测处理完',
    action: 'checkpoint',
    actionLabel: '去查看'
  },
  /* 2026-11-20 课堂走查：契约门 409（LESSON_CONTRACT_NOT_MET）此前落到通用失败弹窗
     「课堂结算遇到问题，稍后重试」——实际不是故障，是核心 KC 缺证据，重试永远同一结果，
     还把用户往「查看学习反馈」这个死胡同里推。服务端 error.message 已带逐条缺口，
     与上面三条门禁同样走页内常驻提示，把原因原文和「继续作答」出口一起给到。 */
  LESSON_CONTRACT_NOT_MET: {
    title: '还差几步才能完成本节课',
    action: 'composer',
    actionLabel: '继续学习'
  }
}

export function resolveClosureGateCopy(code: string): ClosureGateCopy {
  if (isClosureGateCode(code)) return CLOSURE_GATE_COPY[code]
  return {
    title: '课堂还有未完成的问答',
    action: 'composer',
    actionLabel: '去看看'
  }
}

/** 反馈页的默认说明（服务端 message 缺失时使用） */
export function resolveClosureGateMessage(code: string, message?: string | null): string {
  const text = String(message || '').trim()
  if (text) return text
  if (code === 'FINALIZATION_PENDING_CHECKPOINT') return '还有一道题没有作答，先完成这道题再结束课堂'
  if (code === 'FINALIZATION_LAST_CHECKPOINT_FAILED') return '最后一道检查题还没答对，先再试一次或跳过它'
  if (code === 'LESSON_CONTRACT_NOT_MET') return '本课尚有核心目标未完成，请继续学习或提前结束。'
  return '先完成课内问答，再结束课堂。'
}
