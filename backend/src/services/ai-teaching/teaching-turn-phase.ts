/* eslint-disable @typescript-eslint/no-explicit-any -- 教学回合上下文/模型产出的动态形状，字段由上游契约与运行时校验兜底 */
/**
 * 教学回合的阶段协议解析（2026-11-27 从 teaching-turn-engine.ts 拆出）。
 *
 * 调老师之前先定下：本轮处在哪个阶段、能不能出题、屏幕上的板露到哪一段。
 * 教学段坐标系与段数夹取也在这里统一收口（板是「一块板管一节课」的真理源）。
 */
import type { ProcessStudentMessageOptions } from './AITeachingCoordinator';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';
import type { TeachingCheckpoint } from './teaching-checkpoint';
import type { BoardState } from './board-state';
import { isDegenerateFirstBoard } from './board-state';
import { boardSegmentCount } from './board-lesson';
import {
  collectLessonEvidence,
  type ExitTicket,
  type LessonContract,
} from './lesson-contract';
import {
  detectLearnerSkipRequest,
  resolveLessonPhaseTurn,
  segmentsFromBoard,
  segmentsFromKcs,
  type LessonPhaseState,
  type LessonPhaseTurnView,
  type LessonSegment,
} from './lesson-phase';

export interface TurnPhaseResolution {
  taughtSoFar: string;
  lessonSegments: LessonSegment[];
  phaseView: LessonPhaseTurnView | null;
}

export interface TurnPhaseParams {
  session: TeachingSessionRecord;
  board: BoardState | null;
  persistedPhaseState: LessonPhaseState | null;
  lessonPhaseEnabled: boolean;
  lessonContract: LessonContract;
  context: TeachingScenarioContext;
  previousTeachingAssistantCount: number;
  isResumeContinue: boolean;
  submittedCheckpoint: TeachingCheckpoint | null;
  checkpointJudgement: ProcessStudentMessageOptions['checkpointJudgement'];
  previousTeachingState: Record<string, any>;
  previousCheckpointRows: unknown[];
  endIntentIsEnd: boolean;
  message: string;
  exitTicketState: ExitTicket | null;
}

export function resolveTurnPhaseView(params: TurnPhaseParams): TurnPhaseResolution {
  const {
    session, board, persistedPhaseState, lessonPhaseEnabled, lessonContract, context,
    previousTeachingAssistantCount, isResumeContinue, submittedCheckpoint, checkpointJudgement,
    previousTeachingState, previousCheckpointRows, endIntentIsEnd, message, exitTicketState,
  } = params;

  const taughtSoFar = session.messages
    .filter((m) => m.role === 'assistant' && !(m.analysis as { openingMode?: unknown } | undefined)?.openingMode)
    .map((m) => String(m.content || ''))
    .join('\n');
  const boardSegments = board ? segmentsFromBoard(board.figure?.maskedSpec) : [];
  // 单一坐标系（2026-11-26 工程外审）：有分段板书时，教学段一律取板书分段。
  // 此前「持久化段优先」——板晚到或板段数与持久段数不等时，boardReveal 按教学段算、
  // 实际露板按板段算，两套坐标互相矛盾（教学 2 段 / 板 4 段时，整合阶段指令说「还有空行」、
  // 板上却已全露）。板是「一块板管一节课」的真理源，段数跟板走。
  const lessonSegments: LessonSegment[] = boardSegments.length > 0
    ? boardSegments
    : persistedPhaseState?.segments?.length
      ? persistedPhaseState.segments
      : segmentsFromKcs(lessonContract.coreKcs.map((kc) => kc.name), context.taskTitle);
  // 段数变了就把持久状态里的段列表与当前段号一起夹回来（不改阶段、不清进度）
  const phaseStateForTurn = persistedPhaseState && persistedPhaseState.segments.length !== lessonSegments.length
    ? { ...persistedPhaseState, segments: lessonSegments, segment: Math.min(persistedPhaseState.segment, lessonSegments.length) }
    : persistedPhaseState;
  const phaseView: LessonPhaseTurnView | null = !lessonPhaseEnabled ? null : resolveLessonPhaseTurn(phaseStateForTurn, {
    teachingTurns: previousTeachingAssistantCount,
    isResume: isResumeContinue,
    isSubmission: !!submittedCheckpoint,
    verdictPassed: submittedCheckpoint ? checkpointJudgement?.passed === true : null,
    pendingCheckpoint: !submittedCheckpoint && !!previousTeachingState.pendingCheckpoint,
    endIntent: endIntentIsEnd,
    learnerSkipRequested: detectLearnerSkipRequest(message),
    studentMessage: message,
    contract: lessonContract,
    evidence: collectLessonEvidence({
      contract: lessonContract,
      checkpointHistory: previousCheckpointRows,
      exitTickets: exitTicketState ? [exitTicketState] : [],
      knowledgeState: session.knowledgeState,
      teachingTurns: previousTeachingAssistantCount,
    }),
    segments: lessonSegments,
    exploratory: context.entryState === 'exploratory',
    taughtText: taughtSoFar,
    acceptanceCriteria: context.currentTaskContext.acceptanceCriteria ?? null,
    board: board && !isDegenerateFirstBoard(board)
      ? { segmentCount: boardSegmentCount(board.figure?.maskedSpec) }
      : null,
  });

  return { taughtSoFar, lessonSegments, phaseView };
}
