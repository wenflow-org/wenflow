/**
 * 黑盒实验：理解检查点的作答动作构造（纯函数，便于单测）。
 *
 * 背景（18 号复核报告 P1-3）：黑盒链路此前**结构上无法消费检查点**——
 * 模拟器输入里没有"当前有待答检查点"，`autoStep` 从不产出 `submit_answer`，
 * 适配器又把 `submit_answer` 发到普通聊天接口。结果：一旦平台出题，既不会提交、
 * 也不会再出新题，`checkpointHistory` 恒为 0。
 */
import type { LearnerAction, LearnerObservation } from './contracts'

export type VisibleCheckpoint = NonNullable<LearnerObservation['visibleCheckpoint']>
export type CheckpointAnswerDraft = { selectedOptionIds?: string[]; answerText?: string } | null | undefined

/** 选项答案的展示文本（与平台内部格式一致，仅用于轨迹/日志可读性） */
function formatChoiceAnswer(checkpoint: VisibleCheckpoint, optionIds: string[]): string {
  const options = checkpoint.options || []
  return optionIds
    .map((id) => {
      const option = options.find((item) => item.id === id)
      return option ? `${option.id}. ${option.text}` : id
    })
    .join('；')
}

/**
 * 由「待答检查点 + 模拟器作答草案」构造提交动作。
 *
 * 兜底顺序（宁可答错也不让链路卡死）：
 *  1. 草案给出**合法选项 id** → `submit_answer`（单选只取一个；非法 id 丢弃）；
 *  2. 草案给出文本（简答）→ `submit_answer`（作为 answerText 提交）；
 *  3. 都没有且 `allowSkip` → `submit_answer{skip}`（走**检查点提交接口**的 skip；
 *     注意不是任务级 `skip` 动作，后者在黑盒里是明确不支持的）；
 *  4. 都没有且不允许跳过 → 选中第一个选项（实验环境可接受，且正好覆盖"答错→可重答"路径）。
 */
export function buildCheckpointAction(checkpoint: VisibleCheckpoint, draft: CheckpointAnswerDraft): LearnerAction {
  const optionIds = new Set((checkpoint.options || []).map((option) => option.id))
  const picked = Array.isArray(draft?.selectedOptionIds)
    ? draft!.selectedOptionIds.filter((id) => optionIds.has(id))
    : []
  if (picked.length > 0) {
    const selected = checkpoint.type === 'single_choice' ? picked.slice(0, 1) : picked
    return {
      type: 'submit_answer',
      answer: formatChoiceAnswer(checkpoint, selected),
      checkpointId: checkpoint.id,
      selectedOptionIds: selected,
    }
  }
  const text = typeof draft?.answerText === 'string' ? draft.answerText.trim() : ''
  if (text) {
    return { type: 'submit_answer', answer: text, checkpointId: checkpoint.id }
  }
  if (checkpoint.allowSkip === true) {
    return { type: 'submit_answer', answer: '（跳过这个检查点）', checkpointId: checkpoint.id, skip: true }
  }
  const first = checkpoint.options?.[0]
  if (first) {
    return {
      type: 'submit_answer',
      answer: formatChoiceAnswer(checkpoint, [first.id]),
      checkpointId: checkpoint.id,
      selectedOptionIds: [first.id],
    }
  }
  return { type: 'submit_answer', answer: '我暂时没有把握，先按自己的理解作答。', checkpointId: checkpoint.id }
}
