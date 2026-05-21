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
  taskProfile: {
    knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
    cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
    displayLabel: string | null;
    learningObjectives: string[];
    coreConcept: string | null;
  };
  teachingStrategyGuidance: {
    knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
    cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
    objectiveFocus: string[];
    coreConcept: string | null;
    explanationStyle: string;
    interactionPattern: string;
    targetDepth: string;
    preferredStrategies: string[];
    responseConstraints: string[];
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

function parsePathPromptTemplate(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function dedupeConcepts(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeConcept(value)).filter(Boolean) as string[]));
}

function resolveTaskConceptFromPath(task: any, path: any): { id: string | null; name: string | null; description: string | null } {
  const linkedConceptId = normalizeConcept((task as any).linkedConceptId || (task as any).coreConcept);
  const promptTemplate = parsePathPromptTemplate(path?.aiPromptTemplate);
  const cognitiveCore = promptTemplate?.cognitiveCore || promptTemplate?.cognitiveDesign;
  const concepts = Array.isArray(cognitiveCore?.coreConcepts) ? cognitiveCore.coreConcepts : [];

  if (linkedConceptId) {
    const matched = concepts.find((concept: any) => normalizeConcept(concept?.id) === linkedConceptId);
    if (matched) {
      return {
        id: normalizeConcept(matched.id),
        name: normalizeConcept(matched.name),
        description: normalizeConcept(matched.description)
      };
    }
  }

  return {
    id: linkedConceptId,
    name: normalizeConcept((task as any).linkedConceptName) || linkedConceptId,
    description: null
  };
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

function buildTeachingStrategyGuidance(taskProfile: TeachingScenarioContext['taskProfile']) {
  const knowledgeType = taskProfile.knowledgeType;
  const cognitiveLevel = taskProfile.cognitiveLevel;
  const objectiveFocus = taskProfile.learningObjectives.slice(0, 4);
  const coreConcept = taskProfile.coreConcept;

  const byKnowledgeType: Record<NonNullable<TeachingScenarioContext['taskProfile']['knowledgeType']>, {
    explanationStyle: string;
    interactionPattern: string;
    preferredStrategies: string[];
    responseConstraints: string[];
  }> = {
    factual: {
      explanationStyle: 'Give concise, concrete explanations that emphasize precise definitions, key facts, and recognition cues.',
      interactionPattern: 'Use quick recall checks, contrast similar terms, and verify exact understanding before moving on.',
      preferredStrategies: ['retrieval-practice', 'definition-check', 'contrastive-example'],
      responseConstraints: ['Avoid over-expanding into theory not needed for the current fact set.'],
    },
    conceptual: {
      explanationStyle: 'Explain underlying ideas, relationships, and why the concept works, using analogies only when they sharpen understanding.',
      interactionPattern: 'Prompt the learner to compare, classify, and explain connections in their own words.',
      preferredStrategies: ['conceptual-scaffolding', 'compare-and-contrast', 'why-explanation'],
      responseConstraints: ['Do not reduce the lesson to memorized definitions without showing relationships.'],
    },
    procedural: {
      explanationStyle: 'Teach as a sequence of steps with decision points, examples, and common failure cases.',
      interactionPattern: 'Guide the learner through doing the task step by step, then fade support as they gain traction.',
      preferredStrategies: ['worked-example', 'step-by-step-coaching', 'error-correction'],
      responseConstraints: ['Do not stay only at abstract explanation; anchor the reply in execution.'],
    },
    metacognitive: {
      explanationStyle: 'Focus on planning, self-monitoring, reflection, and how to choose an approach.',
      interactionPattern: 'Ask the learner to justify choices, inspect mistakes, and decide what to try next.',
      preferredStrategies: ['self-explanation', 'reflection-prompt', 'strategy-selection'],
      responseConstraints: ['Do not answer everything directly; preserve space for learner reflection and self-correction.'],
    },
  };

  const byCognitiveLevel: Record<NonNullable<TeachingScenarioContext['taskProfile']['cognitiveLevel']>, {
    targetDepth: string;
    responseConstraints: string[];
  }> = {
    remember: {
      targetDepth: 'Target recognition and accurate recall only; do not force deeper transfer in the same turn.',
      responseConstraints: ['Keep the goal at recall depth unless the learner clearly shows readiness for more.'],
    },
    understand: {
      targetDepth: 'Target comprehension, paraphrasing, and basic explanation of meaning.',
      responseConstraints: ['Prefer explanation and interpretation over complex production tasks.'],
    },
    apply: {
      targetDepth: 'Target use of the concept or process on a concrete example or small task.',
      responseConstraints: ['Include at least one concrete application or execution cue.'],
    },
    analyze: {
      targetDepth: 'Target breakdown of structure, comparison of parts, and diagnosis of why something works or fails.',
      responseConstraints: ['Ask the learner to inspect structure, assumptions, or error sources.'],
    },
    evaluate: {
      targetDepth: 'Target judgment with criteria, tradeoff analysis, and reasoned justification.',
      responseConstraints: ['Require explicit reasoning or criteria when comparing alternatives.'],
    },
    create: {
      targetDepth: 'Target synthesis into a new artifact, plan, or original solution.',
      responseConstraints: ['Push toward producing something new, not only explaining existing material.'],
    },
  };

  const knowledgeGuidance = knowledgeType ? byKnowledgeType[knowledgeType] : {
    explanationStyle: 'Explain clearly with concrete examples matched to the current task.',
    interactionPattern: 'Use a guided back-and-forth that checks understanding before adding complexity.',
    preferredStrategies: ['scaffolding', 'example'],
    responseConstraints: [] as string[],
  };

  const levelGuidance = cognitiveLevel ? byCognitiveLevel[cognitiveLevel] : {
    targetDepth: 'Target a practical next step without exceeding the learner’s demonstrated readiness.',
    responseConstraints: [] as string[],
  };

  return {
    knowledgeType,
    cognitiveLevel,
    objectiveFocus,
    coreConcept,
    explanationStyle: knowledgeGuidance.explanationStyle,
    interactionPattern: knowledgeGuidance.interactionPattern,
    targetDepth: levelGuidance.targetDepth,
    preferredStrategies: knowledgeGuidance.preferredStrategies,
    responseConstraints: [
      ...knowledgeGuidance.responseConstraints,
      ...levelGuidance.responseConstraints,
    ],
  };
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
  const resolvedConcept = resolveTaskConceptFromPath(task, path);
  const primaryConcepts = dedupeConcepts([
    resolvedConcept.name,
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
  const taskProfile = {
    knowledgeType: (task as any).knowledgeType || null,
    cognitiveLevel: (task as any).cognitiveLevel || null,
    displayLabel: (task as any).displayLabel || null,
    learningObjectives: parseLearningObjectives((task as any).learningObjectives),
    coreConcept: resolvedConcept.name,
  } as TeachingScenarioContext['taskProfile'];

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
    taskProfile,
    teachingStrategyGuidance: buildTeachingStrategyGuidance(taskProfile),
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
