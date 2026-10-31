/**
 * 虚拟会话座舱：选择某节课堂的访问判据（纯函数，便于回归）。
 *
 * 允许三种来源：
 * 1. 当前绑定的课堂；
 * 2. 已登记在教学历史里的课堂（restart / completed 等）；
 * 3. 同一虚拟会话、同一学习者、同一路径下的课堂——延伸课（#124）和复习课
 *    不会写进 stageResults.teachingSessionHistory，但它们是同一路径的真实课堂，
 *    座舱必须能打开它们的 wrapup / transcript。
 */
export interface TeachingSessionAccessInput {
  requestedId: string;
  currentId: string | null;
  archivedIds: ReadonlySet<string> | readonly string[];
  requestedPathId: string | null | undefined;
  sessionPathId: string | null | undefined;
  requestedUserId: string | null | undefined;
  sessionUserId: string | null | undefined;
}

export function canReadTeachingSession(input: TeachingSessionAccessInput): boolean {
  if (!input.requestedId) return false;
  if (input.requestedId === input.currentId) return true;
  const archived = input.archivedIds instanceof Set ? input.archivedIds : new Set(input.archivedIds);
  if (archived.has(input.requestedId)) return true;
  return Boolean(
    input.requestedPathId
    && input.sessionPathId
    && input.requestedPathId === input.sessionPathId
    && input.requestedUserId
    && input.sessionUserId
    && input.requestedUserId === input.sessionUserId
  );
}
