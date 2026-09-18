/**
 * 学习检查点（checkpoint）提交的失败分类。
 *
 * 走查 P2（2026-09-18）：服务端对同一检查点只接受**一次**提交，
 * 重复提交 / 响应丢失后重试会拿到 404「理解检查不存在或已处理」。
 * 这属于「已经提交过了」而不是失败：界面应收起卡片并向前同步，
 * 不应提示「提交失败，再试一次」把用户卡在必然失败的提交上。
 */
export function isCheckpointAlreadyHandled(err: unknown): boolean {
  const e = err as
    | { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string }
    | null
    | undefined;
  const status = e?.response?.status;
  const msg = String(e?.response?.data?.error?.message ?? e?.message ?? '');
  return status === 404 || /已处理|不存在/.test(msg);
}
