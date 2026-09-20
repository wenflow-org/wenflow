/**
 * 检查点域（V2LearningPage.vue 拆分）：
 * 状态 refs + 流式提交（onJudgement 先行上锁、判定后 delta 逐段补齐）、
 * 跳过、传输失败回退非流式、「已处理」对账收起；checkpointCloseTimer 内聚并在 dispose 清理
 */
import { ref, type Ref } from 'vue';
import { toast } from '@/utils/toast';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { isCheckpointAlreadyHandled } from '@/utils/checkpoint';

export function useCheckpointFlow(
  session: Ref<{ sessionId: string; revision: number } | null>,
  typing: Ref<boolean>
) {
  const checkpoint = ref<Record<string, any> | null>(null);
  const selectedOptions = ref<string[]>([]);
  const answerText = ref('');
  const checkpointFeedback = ref('');
  const checkpointPassed = ref(false);
  /** 检查点提交 in-flight：与导师流式（typing）分离，避免「停止生成」按钮误显、结算等待遗漏 */
  const checkpointPending = ref(false);
  /** 检查点通过后的展示窗口内锁：防止 1.6s 内重复提交同一检查点 */
  const checkpointSubmitting = ref(false);
  /** 代码裁决已出、导师讲解仍在流式到达（期间不给「继续」，避免讲解被截断） */
  const checkpointStreaming = ref(false);
  /** 检查点通过后的自动关闭 timer（提交/卸载时清理，防竞态） */
  let checkpointCloseTimer = 0;

  function toggleOption(id: string) {
    if (!checkpoint.value) return;
    if (checkpoint.value.type === 'multi_choice') {
      const i = selectedOptions.value.indexOf(id);
      if (i >= 0) selectedOptions.value.splice(i, 1);
      else selectedOptions.value.push(id);
    } else {
      selectedOptions.value = [id];
    }
  }

  /** 收起检查点卡片并复位本地状态 */
  function resetCheckpointUi() {
    window.clearTimeout(checkpointCloseTimer);
    checkpoint.value = null;
    checkpointFeedback.value = '';
    checkpointPassed.value = false;
    checkpointSubmitting.value = false;
    checkpointStreaming.value = false;
    selectedOptions.value = [];
    answerText.value = '';
  }

  /** 用户读完反馈后手动收起检查点（答错时不再提供重交入口） */
  function dismissCheckpoint() {
    resetCheckpointUi();
  }

  /** 尽力向前同步 revision（撞上「已处理」时用；失败不阻断，下次进页面会重拉） */
  async function resyncSessionRevision(): Promise<void> {
    if (!session.value) return;
    try {
      const detail = await aiTeachingAPI.getSessionDetail(session.value.sessionId);
      if (detail && Number.isInteger(detail.revision)) session.value.revision = detail.revision;
    } catch {
      /* 忽略 */
    }
  }

  async function submitCheckpoint() {
    // checkpointPending 必须一并拦住：提交请求内含一次教学回合（LLM，数十秒），
    // 期间再点一次会打出第二个必然失败的请求（走查实测：第一次 200、第二次 404
    // → 误报「提交失败，再试一次」，且卡片留在页面上反复失败）
    if (!checkpoint.value || !session.value || typing.value || checkpointSubmitting.value || checkpointPending.value) return;
    // 空值校验：空选项/空简答直接提示，不消耗一轮 AI 判定
    if (checkpoint.value.options?.length && !selectedOptions.value.length) {
      checkpointFeedback.value = '请先选择一个选项';
      return;
    }
    if (!checkpoint.value.options?.length && !answerText.value.trim()) {
      checkpointFeedback.value = '请先写下你的回答';
      return;
    }
    const payload: Record<string, any> = {};
    if (checkpoint.value.options?.length) payload.selectedOptionIds = selectedOptions.value;
    else payload.answerText = answerText.value;
    checkpointPending.value = true;
    checkpointFeedback.value = '';
    checkpointStreaming.value = false;
    try {
      const checkpointId = checkpoint.value.id;
      const sessionId = session.value.sessionId;
      const revision = session.value.revision;
      let streamed = '';
      let r: Record<string, any>;
      try {
        // 流式提交（走查 B-1）：先到 `judgement`（代码裁决的对错，立即可得），
        // 导师讲解随后用 delta 逐段补齐；因此用户可以"秒知对错"而不用干等整个教学回合。
        r = await aiTeachingAPI.streamSubmitCheckpoint(sessionId, checkpointId, payload, revision, {
          onJudgement: (j: { passed: boolean; judgedBy: string; detail: string | null }) => {
            checkpointPassed.value = j.passed === true;
            // 立即上锁：代码已判定，不再允许重交（重交必然 404，见走查 P2）
            checkpointSubmitting.value = true;
            checkpointStreaming.value = true;
            checkpointFeedback.value = j.passed
              ? '回答正确。导师接着讲…'
              : '这道没答对，导师正在给你讲…';
          },
          onDelta: (t: string) => {
            streamed += t;
            checkpointFeedback.value = streamed;
          },
        }) as unknown as Record<string, any>;
      } catch (streamError: any) {
        // 连接层失败且**未收到任何内容**时才安全回退（收到过 judgement/delta 就不能重发：
        // 服务端可能已经消费了检查点）
        if (!streamError?.transport) throw streamError;
        r = await aiTeachingAPI.submitCheckpoint(sessionId, checkpointId, payload, revision) as unknown as Record<string, any>;
      }
      session.value.revision = r.revision ?? session.value.revision + 1;
      checkpointPassed.value = r.passed === true;
      // 后端把整段导师回复放在 feedback（答错时即纠正正文），需要留足阅读时间
      checkpointFeedback.value = r.feedback || (r.passed ? '回答正确' : r.hint || '再想想');
      checkpointStreaming.value = false;
      // 提交成功后服务端已消费该检查点：一律上锁。
      // 答错时旧实现保持可提交（nextAction='review'），用户重交必然 404（走查 P2）
      checkpointSubmitting.value = true;
      if (r.passed) {
        // 答对：3s 后自动收起；延长自 1.6s，避免「刚看到答对了就消失」
        window.clearTimeout(checkpointCloseTimer);
        checkpointCloseTimer = window.setTimeout(() => {
          checkpoint.value = null;
          checkpointFeedback.value = '';
          checkpointSubmitting.value = false;
        }, 3000);
      }
      // 答错：保留卡片让用户读完纠正，由「继续 ›」/Esc 收起（不再提供重交入口）
    } catch (e: any) {
      if (isCheckpointAlreadyHandled(e)) {
        // 服务端已消费（重复提交 / 响应丢失后重试）：不算失败，收起卡片并向前同步
        resetCheckpointUi();
        await resyncSessionRevision();
        toast.info('这个检查点已经提交过了，已为你同步进度');
      } else {
        // 判错路径已经「上锁 + 只有继续按钮」，若此后流断掉（讲解没到 final），
        // 必须把讲解中状态清掉，否则卡片会永远卡在「导师正在讲解…」没有出口
        // （子代理回归走查发现的边界）。对错已由代码裁决得到，保留它即可。
        if (checkpointStreaming.value) {
          checkpointStreaming.value = false;
          checkpointFeedback.value = checkpointPassed.value
            ? '回答正确（导师讲解未能送达，可继续）。'
            : '这道没答对（导师讲解未能送达，可继续）。';
          toast.info('导师讲解没能送达，对错判定不受影响，可继续。');
        } else {
          checkpointFeedback.value = '提交失败，再试一次';
        }
      }
    } finally {
      checkpointPending.value = false;
      checkpointStreaming.value = false;
    }
  }

  async function skipCheckpoint() {
    if (!checkpoint.value || !session.value || typing.value || checkpointPending.value || checkpointSubmitting.value) return;
    const cp = checkpoint.value;
    checkpoint.value = null;
    checkpointPending.value = true;
    try {
      const r = await aiTeachingAPI.submitCheckpoint(session.value.sessionId, cp.id, { skip: true }, session.value.revision) as unknown as Record<string, any>;
      session.value.revision = typeof r?.revision === 'number' ? r.revision : session.value.revision + 1;
    } catch (e: any) {
      toast.error(e?.message || e?.response?.data?.error?.message || '跳过检查点失败');
      // 失败恢复检查点，允许用户重试或改作答
      checkpoint.value = cp;
    } finally {
      checkpointPending.value = false;
    }
  }

  /** 卸载清理：通过后的自动收起 timer */
  function disposeCheckpoint() {
    window.clearTimeout(checkpointCloseTimer);
  }

  return {
    checkpoint, selectedOptions, answerText, checkpointFeedback, checkpointPassed,
    checkpointPending, checkpointSubmitting, checkpointStreaming,
    toggleOption, dismissCheckpoint, submitCheckpoint, skipCheckpoint, disposeCheckpoint
  };
}
