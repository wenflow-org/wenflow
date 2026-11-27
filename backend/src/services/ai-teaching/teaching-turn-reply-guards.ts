/* eslint-disable @typescript-eslint/no-explicit-any -- 教学回合上下文/模型产出的动态形状，字段由上游契约与运行时校验兜底 */
/**
 * 教学回合回复守卫与修复重调（2026-11-27 从 teaching-turn-engine.ts 拆出）。
 *
 * 模型产出回复后、落库前的确定性质量闸：算式复算、裸选择题、简答答案键、
 * 板面/位置指认、已答不推进、行列指称、判分口径一致性与肯定语护栏。
 * 命中问题按既有纪律最多重调一次；复检仍不合格只打遥测放行，绝不阻塞课堂。
 * 纯文本进出：入参是本轮已生成的 TeachingTurnOutput，返回修好的新对象。
 */
import { logger } from '../../utils/logger';
import { executeSkill } from '../../skills';
import { teachingTurnAgentDefinition } from '../../skills/teaching-turn';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import { recordDegradation } from '../../skills/degradation-telemetry';
import type { ProcessStudentMessageOptions } from './AITeachingCoordinator';
import type { TeachingSessionRecord, TeachingSessionMessage } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';
import { withTimeoutSignal } from './teaching-classroom-flow';
import { buildTeachingTurnInput, extractTeachingOutput } from './teaching-turn-shared';
import { findArithmeticMismatches, describeMismatchesForRepair } from './teaching-arithmetic-guard';
import { buildCheckpointCodeArbitration, findUnfurnishedChoiceQuestion, type TeachingCheckpoint } from './teaching-checkpoint';
import { parseSessionArtifacts } from './checkpoint-shared';
import { collectSpecTextFragments, findUnmatchedBoardReferences, findDanglingBoardPositionReferences, referencesBoardWithoutBoardAvailable } from './board-intent';
import type { BoardState } from './board-state';
import { fixBoardAxisDeixis } from './board-lesson';
import { findPreviousAssistantReply } from './teaching-repetition-guard';
import { findRepeatedQuestionAfterAnswer } from './question-loop-guard';
import { ensureVerdictOpening, repairContradictedPassedVerdict, shouldGuardReplyForFailedConcept, stripAffirmationsOnFailedVerdict } from './checkpoint-feedback-guard';
import { stripTrailingQuestionParagraph, ARITHMETIC_REPAIR_BUDGET_MS, ARITHMETIC_REPAIR_TIMEOUT_MS } from './teaching-turn-preparation';

export interface TeachingReplyGuardParams {
  rawTeachingOutput: TeachingTurnOutput | null;
  turnInput: Awaited<ReturnType<typeof buildTeachingTurnInput>>;
  turnStartedAt: number;
  session: TeachingSessionRecord;
  context: TeachingScenarioContext;
  board: BoardState | null;
  boardForTurn: BoardState | null;
  updatedMessages: TeachingSessionMessage[];
  message: string;
  submittedCheckpoint: TeachingCheckpoint | null;
  checkpointJudgement: ProcessStudentMessageOptions['checkpointJudgement'];
  exitTicketTurn: { graded: boolean };
  exitTicketVerdict: { passed: boolean; detail: string | null } | null;
  previousTeachingState: Record<string, any>;
  failedConceptFollowupGuard?: boolean;
}

export async function runTeachingReplyGuards(params: TeachingReplyGuardParams): Promise<TeachingTurnOutput | null> {
  const {
    turnInput, turnStartedAt, session, context, board, boardForTurn,
    updatedMessages, message, submittedCheckpoint, checkpointJudgement,
    exitTicketTurn, exitTicketVerdict, previousTeachingState, failedConceptFollowupGuard,
  } = params;
  let rawTeachingOutput = params.rawTeachingOutput;
  // 内容正确性第一刀（2026-10-08，宽域 A 轨 3/10 课 P0 的可检出形态）：回复里的算式
  // 确定性复算，命中即带修复指令重调一次（前缀 KV 缓存使重调远便宜于全新回合）；
  // 复检仍错→只打遥测放行，绝不阻塞课堂。repairInstruction 的模型侧承接条款见
  // teaching-turn.yaml「算式正确性」条。
  {
    const mismatches = findArithmeticMismatches(rawTeachingOutput?.reply);
    if (mismatches.length > 0) {
      logger.warn('[AITeaching] 回复算式复算不匹配，触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        mismatches: mismatches.map((m) => m.expr),
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          // 照 supplementaryMaterial 的既有注入风格：scenario 上挂修复指令（模板条款「若输入
          // scenario.repairInstruction 存在」承接），重调共享前缀 → KV 缓存命中率高。
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复中的算式被确定性复算判定有误：${describeMismatchesForRepair(mismatches)}。本轮必须输出修正后的完整回复：只修正上述算式及受其影响的数值与结论表述，其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              // 175-3：修复重调同样要能取消——超时后放行原回复，但底层重调必须停，不能继续占租约外的 token。
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'ARITHMETIC_REPAIR_TIMEOUT: 算式修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && findArithmeticMismatches(candidate.reply).length === 0) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 算式修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'MODEL_ARITHMETIC_MISMATCH',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.arithmetic', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-corrective-instruction' : 'flagged-only',
        rootCauseMessage: mismatches.map((m) => m.expr).join('; '),
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 出题附料确定性检测（修复批 11-②，交流体验评审 §20.4#2「盲答判对」）：正文抛选择题形态
  // 而本轮既无 control.checkpoint（结构化选项由前端渲染）、正文也无内联选项列表——学员只能
  // 盲答，教师还会采认盲答（u19 实证），评估作废。命中即带修复指令重调一次（与第一刀同形态：
  // scenario.repairInstruction + 前缀 KV 缓存）；复检仍缺→打遥测放行，绝不阻塞课堂。
  {
    const bareChoice = findUnfurnishedChoiceQuestion(
      rawTeachingOutput?.reply,
      !!(rawTeachingOutput?.control?.checkpoint?.options?.length),
    );
    if (bareChoice) {
      logger.warn('[AITeaching] 正文裸选择题（无选项/无材料），触发附料修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        snippet: bareChoice.snippet,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复在正文里出了一道选择题（「${bareChoice.snippet}」），但选项没有随文给出——学生只能盲答，这会让作答与评估都失效。本轮必须输出修正后的完整回复：要么把选项完整列出（逐项编号或 A/B/C 随文给出，选项材料必须在你给出的内容里），要么改成不需要选项的问法（让学生用自己的话作答、或直接对上文材料作答）；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'CHOICE_MATERIAL_REPAIR_TIMEOUT: 附料修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && !findUnfurnishedChoiceQuestion(
              candidate.reply,
              !!(candidate.control?.checkpoint?.options?.length),
            )) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 附料修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.choiceQuestion', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-supply-options-instruction' : 'flagged-only',
        rootCauseMessage: `bare choice question without options/material: ${bareChoice.snippet}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 简答题答案键缺件（2026-11-26 A6 实录 + 工程外审 P1）：short_answer 不带 expectedKeywords
  // 等于一张没有评分标准的裸题——判分只能退回模型参考判定，还会多耗一个回合。
  // 处理顺序与上一条裸选择题同形：先带修复指令重调一次；复检仍缺→本题不上屏（从输出里摘掉题卡，
  // 并剪掉正文末尾的悬空追问），打遥测。阶段机这一轮 checksInPhase 不加，下一轮仍会要求出题，
  // 指令会再次点名「答案键必须给」。
  {
    const checkpointDraft = rawTeachingOutput?.control?.checkpoint;
    const hasExpectedKeywords = Array.isArray(checkpointDraft?.expectedKeywords)
      && checkpointDraft!.expectedKeywords.some((keyword) => String(keyword ?? '').trim());
    if (checkpointDraft?.type === 'short_answer' && !hasExpectedKeywords) {
      logger.warn('[AITeaching] 简答题缺 expectedKeywords，触发补键重调', {
        userId: context.userId,
        taskId: context.taskId,
        question: String(checkpointDraft.question ?? '').slice(0, 80),
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = '你上一条回复里的简答题没有给 expectedKeywords（评分要点），这张题无法判定对错。本轮必须输出修正后的完整回复：为这道简答题补 1–3 组 expectedKeywords（每组只放「任何正确作答都会出现的核心词」，同义写法用半角竖线 | 并列；不得用题干里已经出现的词），其余内容（讲解、知识看板、control 字段、语气、篇幅）原样保留；绝不可向学生提及任何校验或系统检查。';
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'SHORT_ANSWER_KEY_REPAIR_TIMEOUT: 补答案键重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            const repairedCheckpoint = candidate?.control?.checkpoint;
            if (candidate?.reply
              && repairedCheckpoint?.type === 'short_answer'
              && Array.isArray(repairedCheckpoint.expectedKeywords)
              && repairedCheckpoint.expectedKeywords.some((keyword) => String(keyword ?? '').trim())) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 补答案键重调失败', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['checkpoint.expectedKeywords', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-supply-answer-key' : 'drop-checkpoint',
        rootCauseMessage: `short_answer checkpoint without expectedKeywords: ${String(checkpointDraft.question ?? '').slice(0, 120)}`,
      });
      if (repairedOutput) {
        rawTeachingOutput = repairedOutput;
      } else if (rawTeachingOutput) {
        // 补不回来：不上屏。剪掉正文末尾那道题的追问，避免学生看到一道没有作答卡的悬空题。
        if (rawTeachingOutput.control) {
          delete (rawTeachingOutput.control as { checkpoint?: unknown }).checkpoint;
        }
        rawTeachingOutput = { ...rawTeachingOutput, reply: stripTrailingQuestionParagraph(rawTeachingOutput.reply || '') };
      }
    }
  }
  // 指认-板面交叉核对（修复批 13-①，BOARD_MISMATCH 指认落空形态可复算杠杆，§22.3 定性）：
  // reply 里带板面指认语境的引号片段（看板上「X」/标着「X」的那条线）在当前持久板面上找不到，
  // 学习者按指认看板会对不上（批 L/M 实证：指认的连线 rev 里不存在、右栏行数不符）。命中即带
  // 修复指令重调一次（同前两刀机制）；复检仍缺→打遥测放行，绝不阻塞课堂。
  if (board) {
    const boardFaceText = collectSpecTextFragments(
      board.figure?.maskedSpec ?? board.figure?.fullSpec ?? null,
    ).join(' ');
    const priorTeacherText = updatedMessages
      .filter((m) => m?.role === 'assistant')
      .map((m) => String((m as { content?: unknown }).content ?? ''))
      .join('\n');
    const boardRefMisses = findUnmatchedBoardReferences({
      reply: rawTeachingOutput?.reply,
      boardText: boardFaceText,
      priorTeacherText,
      // 滞后引用判定（批 38-③）：历史板面出现过、当前已无的指认对象不再被引对话豁免
      priorBoardText: (parseSessionArtifacts(session.teachingState).boardHistory as
        | Array<{ spec: Record<string, unknown> }>
        | undefined)
        ?.map((h) => collectSpecTextFragments(h?.spec ?? null).join(' '))
        .join(' '),
    });
    if (boardRefMisses.misses.length > 0) {
      logger.warn('[AITeaching] 板面指认与当前板面不符（指认落空），触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        misses: boardRefMisses.misses,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复指认了板面上的具体内容（${boardRefMisses.misses.map((m) => `「${m}」`).join('、')}），但当前板面上找不到它们——学习者按指认看板会对不上。本轮必须输出修正后的完整回复：要么把指认改为当前板面上真实存在的元素（引号内逐字使用板面现有文本），要么删去对不存在元素的指认、只用口头讲解承接；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'BOARD_REFERENCE_REPAIR_TIMEOUT: 板面指认修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && findUnmatchedBoardReferences({
              reply: candidate.reply,
              boardText: boardFaceText,
              priorTeacherText,
              priorBoardText: (parseSessionArtifacts(session.teachingState).boardHistory as
                | Array<{ spec: Record<string, unknown> }>
                | undefined)
                ?.map((h) => collectSpecTextFragments(h?.spec ?? null).join(' '))
                .join(' '),
            }).misses.length === 0) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 板面指认修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardReference', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-board-reference-instruction' : 'flagged-only',
        rootCauseMessage: `board references not found on current board: ${boardRefMisses.misses.join(' | ').slice(0, 160)}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 位置/槽位指认存在性守卫（修复批 38-①，u01L2 reeval31 实证：位置/计数形态没有引号片段，
  // 批 13-① 内容守卫抓不住——「右栏第 3 行我留了空槽」而右栏只有 2 行）。F1 越界行/帧指认
  // + F2 空槽承诺无空位 → 修复指令重调一次；复检仍犯→打遥测放行，绝不阻塞课堂。
  if (board) {
    const positionSpec = board.figure?.maskedSpec ?? board.figure?.fullSpec ?? null;
    const positionMisses = findDanglingBoardPositionReferences({
      reply: rawTeachingOutput?.reply,
      spec: positionSpec,
    });
    if (positionMisses.misses.length > 0) {
      logger.warn('[AITeaching] 板面位置指认越界/空槽承诺无空位，触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        misses: positionMisses.misses,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复指认了板面上的位置（${positionMisses.misses.map((m) => `「${m}」`).join('、')}），但当前板面上不存在这些位置——学习者按指认去找会落空。本轮必须输出修正后的完整回复：先数一遍当前板面的行数/帧数，把指认改到真实存在的行/格/帧上（或逐字引用板面现有文本），也可以删去该位置指认、只用口头讲解承接；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'BOARD_POSITION_REPAIR_TIMEOUT: 板面位置指认修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && findDanglingBoardPositionReferences({
              reply: candidate.reply,
              spec: positionSpec,
            }).misses.length === 0) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 板面位置指认修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardPositionRef', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-board-position-ref-instruction' : 'flagged-only',
        rootCauseMessage: `dangling board position references: ${positionMisses.misses.join(' | ').slice(0, 160)}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 无板面时的板面指认检测（修复批 15-②，BOARD_DANGLING_TRACE 批 14 critical：本课无板面
  // 而教师用「看板上/那份图」说话——学习者面对不存在的参照物）。命中即带修复指令重调一次：
  // 删去板面指认、用口头描述承接；复检仍犯→打遥测放行。
  if (!board) {
    const absentBoardRef = referencesBoardWithoutBoardAvailable(rawTeachingOutput?.reply);
    if (absentBoardRef) {
      logger.warn('[AITeaching] 本课无板面而回复指认板面（证据链断裂），触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        snippet: absentBoardRef.snippet,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复指认了板面/图示（「${absentBoardRef.snippet}」），但本课当前没有任何板面——学习者在屏幕上找不到你说的那份材料。本轮必须输出修正后的完整回复：删去对板面/图示的指认，把需要指认的内容改用口头完整描述（原句引用任务材料原文即可）；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'BOARD_ABSENT_REPAIR_TIMEOUT: 无板面指认修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && !referencesBoardWithoutBoardAvailable(candidate.reply)) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 无板面指认修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardReference', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-board-absent-instruction' : 'flagged-only',
        rootCauseMessage: `board referenced but no board exists: ${absentBoardRef.snippet}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 已答不推进守卫（修复批 19-①，F_LOOP u17 批 R critical 可复算杠杆）：学员实质性作答后
  // 教师原样重复同一问句——学员开始自我怀疑（「是不是我没理解对」）。命中即带修复指令重调
  // 一次（先反馈作答再推进）；复检仍犯→打遥测放行。
  {
    const prevAssistant = findPreviousAssistantReply(updatedMessages);
    const repeatedQuestion = findRepeatedQuestionAfterAnswer({
      priorTeacherReply: prevAssistant,
      learnerReply: message,
      currentReply: rawTeachingOutput?.reply,
    });
    if (repeatedQuestion) {
      logger.warn('[AITeaching] 学员已作答而教师原样重复同一问句（已答不推进），触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        repeated: repeatedQuestion.repeated,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `学员刚刚已经回答了你的提问（「${repeatedQuestion.repeated}」），你却在原样重复同一个问题——这会让学员怀疑自己理解错了。本轮必须输出修正后的完整回复：第一句先对学员的作答给出明确反馈（对/不对+一句话为什么），然后推进到下一步（新情形追问/下一知识点/更小一步），不得原样重复上一轮的任何问句；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'QUESTION_LOOP_REPAIR_TIMEOUT: 已答不推进修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && !findRepeatedQuestionAfterAnswer({
              priorTeacherReply: prevAssistant,
              learnerReply: message,
              currentReply: candidate.reply,
            })) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 已答不推进修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.questionLoop', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-answered-advance-instruction' : 'flagged-only',
        rootCauseMessage: `question repeated after substantive learner answer: ${repeatedQuestion.repeated}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 指称修正（2026-11-26）：老师把「列」说成「行」（或反之）时按板上标签原文改回，不重调模型。
  // 实录里老师两次说「「[H] 由谁产生」那一行」而它是列——学生按「行」去找找不到，指令不可执行。
  if (rawTeachingOutput?.reply && boardForTurn) {
    const deixis = fixBoardAxisDeixis(rawTeachingOutput.reply, boardForTurn);
    if (deixis.fixed.length > 0) {
      logger.info('[AITeaching] 板书指称修正：行列称谓与板上标签对不上，已按标签改回', {
        sessionId: session.id,
        fixes: deixis.fixed.slice(0, 4),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardDeixis'],
        mitigationApplied: 'fix-board-axis-deixis-by-label',
        rootCauseMessage: deixis.fixed.slice(0, 4).join(' ｜ '),
      });
      rawTeachingOutput = { ...rawTeachingOutput, reply: deixis.reply };
    }
  }
    // 检查点反馈硬门（拍板 #5 切口1，2026-10-08）：代码判错的作答回合，老师回复不得出现
  // 肯定语——此前只有提示词软约束（b52576b4 裁决注入），话术与判分脱钩从未被度量与拦截。
  // 命中即句子级剥离 + 遥测（MODEL_AFFIRMATION_MISMATCH）；切口2 的落库计数=本遥测为分子、
  // learner_evidence 的 code 失败 checkpoint:result 行为分母。整句全中/剥后过短时
  // flagged-only 放行原文（回复不能被剥空）。纯函数与样本库见 checkpoint-feedback-guard.ts。
  if (rawTeachingOutput?.reply && submittedCheckpoint
    && checkpointJudgement?.judgedBy === 'code'
    && checkpointJudgement.passed === false) {
    const screened = stripAffirmationsOnFailedVerdict(rawTeachingOutput.reply);
    if (screened.stripped.length > 0) {
      logger.warn('[AITeaching] 检查点判错但回复含肯定语（反馈硬门）', {
        sessionId: session.id,
        checkpointId: submittedCheckpoint.id,
        strippedCount: screened.stripped.length,
        applied: screened.applied,
        samples: screened.stripped.slice(0, 3),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'MODEL_AFFIRMATION_MISMATCH',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.affirmation', `task:${context.taskId}`],
        mitigationApplied: screened.applied ? 'strip-affirmation-sentences' : 'flagged-only',
        rootCauseMessage: screened.stripped.slice(0, 3).join(' ｜ '),
      });
      if (screened.applied) {
        rawTeachingOutput = { ...rawTeachingOutput, reply: screened.reply };
      }
    }
  }
  // 检查点反馈硬门（对称方向，2026-10-28 f3 实拍）：代码判对、模型却否定作答。
  // 实测答案键 A / 学生选 A / checkpointHistory.passed=true，模型仍说「这道不对」并逼学生重写三行。
  // 命中即换成确定性确认（保留原回复最后一个问句），并单列遥测；不阻断课堂。
  if (rawTeachingOutput?.reply && submittedCheckpoint
    && checkpointJudgement?.judgedBy === 'code'
    && checkpointJudgement.passed === true) {
    const repaired = repairContradictedPassedVerdict(rawTeachingOutput.reply);
    if (repaired !== rawTeachingOutput.reply) {
      logger.warn('[AITeaching] 检查点判对但回复否定作答（反馈硬门·对称）', {
        sessionId: session.id,
        checkpointId: submittedCheckpoint.id,
        before: String(rawTeachingOutput.reply).slice(0, 120),
        after: repaired.slice(0, 120),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'MODEL_NEGATION_ON_PASSED_CHECKPOINT',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.verdict', `task:${context.taskId}`],
        mitigationApplied: 'replace-with-deterministic-confirmation',
        rootCauseMessage: String(rawTeachingOutput.reply).slice(0, 200),
      });
      rawTeachingOutput = { ...rawTeachingOutput, reply: repaired };
    }
  }
  // 裁决句兜底（2026-11-26）：上面两道硬门都是「命中才修」——模型只要不写裁决句就都放行。实录里学生
  // 看到作答处标红，老师却说「你选的是 A，我们来看看…」，通篇没说对错。代码裁决回合，反馈首句必须
  // 明确给结论；没有就补一句确定性裁决（不替换模型的话术）。课末终检的裁决回合同理。
  {
    const checkpointVerdictTurn = !!submittedCheckpoint && checkpointJudgement?.judgedBy === 'code';
    const exitVerdictTurn = exitTicketTurn.graded && !!exitTicketVerdict;
    if (rawTeachingOutput?.reply && (checkpointVerdictTurn || exitVerdictTurn)) {
      const verdictPassed = checkpointVerdictTurn
        ? checkpointJudgement!.passed === true
        : exitTicketVerdict!.passed === true;
      const aligned = ensureVerdictOpening(rawTeachingOutput.reply, verdictPassed);
      if (aligned !== rawTeachingOutput.reply) {
        logger.info('[AITeaching] 反馈首句未给裁决，已补确定性裁决句', {
          sessionId: session.id,
          verdictPassed,
          before: String(rawTeachingOutput.reply).slice(0, 80),
        });
        recordDegradation({
          source: 'ai-teaching/teaching-turn-engine',
          faultCategory: 'SCHEMA_VIOLATION',
          severity: 'P2_DEGRADED',
          impactedDimensions: ['teachingReply.verdict', `task:${context.taskId}`],
          mitigationApplied: 'prepend-deterministic-verdict-opening',
          rootCauseMessage: `reply opened without a verdict on a code-judged turn (passed=${verdictPassed})`,
        });
        rawTeachingOutput = { ...rawTeachingOutput, reply: aligned };
      }
    }
  }
  // 失败检查点概念的**后续回合**肯定语护栏（#84，2026-10-19 实证）：提交轮硬门只管当轮——
  // zhongkao-streaming 批实测两次 code failed（缺要点）后，老师在随后自由回合仍称
  // 「你答对了/这一关你走通了」。口径收紧（精度优先）：仅当本回合知识点命中会话内
  // code 失败概念时剥离；遥测单列一类，不污染切口2 一致性口径（#85 双臂 A 臂可显式关闭）。
  const judgingFailedThisTurn = !!(submittedCheckpoint
    && checkpointJudgement?.judgedBy === 'code'
    && checkpointJudgement.passed === false);
  if (failedConceptFollowupGuard !== false && rawTeachingOutput?.reply && !judgingFailedThisTurn) {
    const failedConceptNames = buildCheckpointCodeArbitration(previousTeachingState.checkpointHistory).codeFailedConceptNames;
    if (shouldGuardReplyForFailedConcept({
      currentPoint: rawTeachingOutput.knowledge?.currentPoint,
      failedConceptNames,
      judgingThisTurn: judgingFailedThisTurn,
    })) {
      const screened = stripAffirmationsOnFailedVerdict(rawTeachingOutput.reply);
      if (screened.stripped.length > 0) {
        logger.warn('[AITeaching] 失败检查点概念的后续回合仍含肯定语（#84 护栏）', {
          sessionId: session.id,
          currentPoint: rawTeachingOutput.knowledge?.currentPoint,
          failedConceptNames: failedConceptNames.slice(0, 3),
          strippedCount: screened.stripped.length,
          applied: screened.applied,
        });
        recordDegradation({
          source: 'ai-teaching/teaching-turn-engine',
          faultCategory: 'MODEL_AFFIRMATION_AFTER_FAILED_CHECKPOINT',
          severity: 'P2_DEGRADED',
          impactedDimensions: ['teachingReply.affirmation', `task:${context.taskId}`],
          mitigationApplied: screened.applied ? 'strip-affirmation-sentences' : 'flagged-only',
          rootCauseMessage: screened.stripped.slice(0, 3).join(' ｜ '),
        });
        if (screened.applied) {
          rawTeachingOutput = { ...rawTeachingOutput, reply: screened.reply };
        }
      }
    }
  }
  return rawTeachingOutput;
}
