import prisma from '../../config/database';
import learningStateService from '../learning/learning-state.service';
import { learnerModelAgent } from '../../agents/learner-model-agent';
import type { LearnerSnapshot, TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import type { TeachingSessionRecord } from './TeachingSessionRepository';

export interface TeachingScenarioContext {
  userId: string;
  taskId: string;
  learningPathId: string;
  milestoneId: string;
  subject: string;
  topic: string;
  taskTitle: string;
  taskDescription: string;
  taskType: 'reading' | 'practice' | 'project' | 'quiz';
  taskKnowledgeScope: {
    primaryConcepts: string[];
    prerequisiteConcepts: string[];
  };
  canStartLearning: boolean;
  learningBlockedReason: string | null;
  learnerSnapshot: LearnerSnapshot;
  teachingProjection: TeachingLearnerProjection;
  userProfile: any;
  learningState: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  } | null;
  pathContext: {
    pathTitle?: string;
    pathSummary?: string | null;
    subject?: string | null;
  };
  previousSession?: {
    sessionId: string;
    messages: TeachingSessionRecord['messages'];
    knowledgePoints: TeachingSessionRecord['knowledgeState'];
  } | null;
}

function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parsePathSummary(raw: string | null | undefined): string | null {
  const parsed = parseJsonSafe(raw);
  const summary = parsed?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function dedupeConcepts(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeConcept(value)).filter(Boolean) as string[]));
}

function parseLearningObjectives(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return dedupeConcepts(parsed.map((item) => String(item)));
    }
    if (typeof parsed === 'string') {
      return dedupeConcepts([parsed]);
    }
  } catch {
    return dedupeConcepts([raw]);
  }
  return [];
}

export async function buildTeachingScenarioContext(
  userId: string,
  taskId: string,
  previousSession?: TeachingSessionRecord | null
): Promise<TeachingScenarioContext> {
  const task = await prisma.subtasks.findUnique({
    where: { id: taskId },
    include: {
      milestones: {
        include: {
          learning_paths: true,
        }
      }
    }
  });

  if (!task || !task.milestones?.learning_paths) {
    throw new Error('任务不存在');
  }

  const path = task.milestones.learning_paths;
  if (path.userId !== userId) {
    throw new Error('无权访问此任务');
  }

  const learningState = await learningStateService.getCurrentState(userId);
  const learnerResult = await learnerModelAgent.getSnapshot({
    userId,
    learningPathId: path.id,
    milestoneId: task.milestoneId,
    taskId: task.id,
    mode: 'teaching',
  });
  const learnerSnapshot = learnerResult.snapshot;
  const teachingProjection = learnerProjectionService.toTeachingProjection(learnerSnapshot);
  const primaryConcepts = dedupeConcepts([
    (task as any).coreConcept,
    (task as any).displayLabel,
    ...parseLearningObjectives((task as any).learningObjectives),
  ]);
  const prerequisiteConcepts = (learnerSnapshot.knowledgeMemory.currentPath?.prerequisiteGaps || [])
    .map((item) => item.label)
    .filter((label) => primaryConcepts.some((concept) => label.includes(concept) || concept.includes(label)))
    .slice(0, 2);

  const canStartLearning = previousSession?.status === 'active'
    ? true
    : path.status === 'active';

  return {
    userId,
    taskId: task.id,
    learningPathId: path.id,
    milestoneId: task.milestoneId,
    subject: path.subject || '综合',
    topic: task.title,
    taskTitle: task.title,
    taskDescription: task.description || '',
    taskType: (task.taskType as 'reading' | 'practice' | 'project' | 'quiz') || 'practice',
    taskKnowledgeScope: {
      primaryConcepts,
      prerequisiteConcepts,
    },
    canStartLearning,
    learningBlockedReason: canStartLearning ? null : '学习内容还在准备中，请稍候再开始学习。',
    learnerSnapshot,
    teachingProjection,
    userProfile: learnerSnapshot.profile,
    learningState: learningState ? {
      lss: learningState.lss,
      ktl: learningState.ktl,
      lf: learningState.lf,
      lsb: learningState.lsb,
    } : null,
    pathContext: {
      pathTitle: path.title || path.name,
      pathSummary: parsePathSummary(path.aiPromptTemplate),
      subject: path.subject,
    },
    previousSession: previousSession ? {
      sessionId: previousSession.id,
      messages: previousSession.messages,
        knowledgePoints: previousSession.knowledgeState,
      } : null,
  };
}
