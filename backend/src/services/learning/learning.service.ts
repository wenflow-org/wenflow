// 学习服务
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import aiService from '../ai/ai.service';
import stateTrackingService from './state-tracking.service';
import achievementService from '../achievements/achievement.service';
import { updateLearningMetrics } from '../metrics/LearningMetricService';
import { progressAgentHandler } from '../../agents/progress-agent';
import type { AgentInput, AgentContext } from '../../agents/protocol';
import { runWithContext } from '../../gateway/openai-client';

// Anderson 框架 Skills
import { executeSkill } from '../../skills';
import { goalTypeIdentifierDefinition } from '../../skills/goal-type-identifier';
import { batchAndersonLabelerDefinition } from '../../skills/batch-anderson-labeler';
import { labelGeneratorDefinition } from '../../skills/label-generator';

interface CreateGoalData {
  userId: string;
  description: string;
  subject?: string;
}

interface GeneratePathData {
  userId: string;
  description: string;
  subject?: string;
  deadline?: Date;
  deadlineText?: string;
  sourceConversationId?: string;
  existingPathId?: string;
  userProfile?: {
    skillLevel?: string;
    currentSkillLevel?: string;
    learningStyle?: string;
    timePerDay?: string;
    learningGoal?: string;
    cognitiveProfile?: {
      metacognition_level?: string;
      thinking_style?: string;
      prior_knowledge_structure?: string;
      confusion_pattern?: string;
      self_assessment_accuracy?: string;
    };
    emotionalProfile?: {
      motivation_trigger?: string;
      urgency_level?: string;
      confidence_level?: string;
    };
    problemContext?: any;
    priorKnowledge?: any[];
    daysPerWeek?: number;
  };
}

interface CompleteTaskData {
  taskId: string;
  userId: string;
  actualMinutes?: number;
  subjectiveDifficulty?: number;
  notes?: string;
  rating?: number;
}

function parseJsonSafe(raw: any): any {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class LearningService {
  private normalizeSessionDurationMinutes(session: {
    duration: number | null;
    startTime: Date;
    endTime: Date | null;
  }): number {
    const derivedMinutes = session.endTime
      ? Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000))
      : null;

    if (derivedMinutes !== null) {
      return derivedMinutes;
    }

    const rawDuration = session.duration ?? 0;
    if (rawDuration <= 0) {
      return 0;
    }

    // 历史兼容：部分会话把秒写入 duration，这里兜底转分钟
    return rawDuration > 24 * 60 ? Math.round(rawDuration / 60) : rawDuration;
  }

  private async attachActualMinutesToPath(path: any): Promise<any> {
    const milestones = path?.milestones || [];
    const allSubtasks = milestones.flatMap((milestone: any) => milestone.subtasks || []);
    const taskIds = allSubtasks.map((task: any) => task.id).filter(Boolean);

    if (taskIds.length === 0) {
      return path;
    }

    const sessions = await prisma.learning_sessions.findMany({
      where: {
        userId: path.userId,
        taskId: { in: taskIds },
      },
      select: {
        taskId: true,
        duration: true,
        startTime: true,
        endTime: true,
      },
    });

    const actualMinutesMap = new Map<string, number>();
    sessions.forEach((session) => {
      if (!session.taskId) return;

      const minutes = this.normalizeSessionDurationMinutes(session);
      if (minutes <= 0) return;

      actualMinutesMap.set(session.taskId, (actualMinutesMap.get(session.taskId) || 0) + minutes);
    });

    return {
      ...path,
      milestones: milestones.map((milestone: any) => ({
        ...milestone,
        subtasks: (milestone.subtasks || []).map((task: any) => ({
          ...task,
          actualMinutes: actualMinutesMap.get(task.id) ?? null,
        })),
      })),
    };
  }

  // 创建学习目标
  async createLearningGoal(data: CreateGoalData) {
    try {
      const goal = await prisma.learning_goals.create({
        data: {
          id: `lg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          title: data.description,
          description: data.description,
          updatedAt: new Date()
        }
      });

      logger.info(`学习目标创建：${goal.id}`);

      return goal;
    } catch (error) {
      logger.error('创建学习目标失败:', error);
      throw error;
    }
  }

  // 创建简单的学习路径
  async createLearningPath(data: {
    userId: string;
    name: string;
    title?: string;
    description?: string;
  }) {
    try {
      const learningPath = await prisma.learning_paths.create({
        data: {
          id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          name: data.name,
          title: data.title || data.name,
          description: data.description || '',
          updatedAt: new Date()
        }
      });

      logger.info(`学习路径创建：${learningPath.id}`);

      return learningPath;
    } catch (error) {
      logger.error('创建学习路径失败:', error);
      throw error;
    }
  }

  // 获取用户的学习目标
  async getLearningGoals(userId: string) {
    try {
      const goals = await prisma.learning_goals.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });

      return goals;
    } catch (error) {
      logger.error('获取学习目标失败:', error);
      throw error;
    }
  }

  // 使用 AI 生成学习路径 (阶段化设计)
  async generateLearningPath(data: GeneratePathData) {
    const startTime = Date.now();
    let analysis: any = null;

    try {
      logger.info('开始生成学习路径...', { userId: data.userId, goal: data.description });

try {
const { pathAgentHandler } = await import('../../agents/path-agent');
        const skillLevel = data.userProfile?.skillLevel || data.userProfile?.currentSkillLevel;
        const currentLevel = (skillLevel === 'beginner' || skillLevel === 'intermediate' || skillLevel === 'advanced')
          ? skillLevel as 'beginner' | 'intermediate' | 'advanced'
          : undefined;
        
const agentInput = {
      type: 'standard' as const,
      goal: data.description,
      currentLevel: currentLevel || 'beginner',
      timePerDay: data.userProfile?.timePerDay,
      metadata: {
        availableTime: data.userProfile?.timePerDay,
        deadline: data.deadline,
        deadlineText: data.deadlineText
      }
    };
        const agentContext = { userId: data.userId };
        
        // 使用 runWithContext 设置 agentId，确保 path-agent 使用 reasoningModel
        const agentResult = await runWithContext({
          userId: data.userId,
          agentId: 'path-agent',
          action: 'generateLearningPath'
        }, () => pathAgentHandler(agentInput, agentContext));
        
        if (agentResult.success && agentResult.path) {
          const path = agentResult.path;
          analysis = {
            pathName: path.name,
            subject: path.subject || '综合',
            difficulty: data.userProfile?.skillLevel || 'beginner',
            estimatedTotalHours: path.estimatedHours || 0,
            suggestedMilestones: (path.milestones || []).map((m: any, idx: number) => ({
              stage: m.stageNumber || idx + 1,
              name: m.title,
              description: m.description,
              goal: m.goal,
              estimatedHours: m.estimatedHours,
              tasks: (m.subtasks || []).map((t: any) => ({
                title: t.title,
                description: t.description || '',
                type: t.type || 'practice',
                estimatedMinutes: t.estimatedMinutes || 30,
                acceptanceCriteria: t.acceptanceCriteria || ''
              }))
            })),
            recommendations: [],
            feasibility: 'high'
          };
          logger.info('PathAgent 调用成功', { userId: data.userId, pathId: path.id });
        } else {
          throw new Error(agentResult.error || 'PATH_AGENT_FAILED');
        }
      } catch (agentError: any) {
        logger.error('PathAgent 调用失败，终止生成', {
          error: agentError?.message || String(agentError),
          userId: data.userId 
        });
        throw new Error(`PATH_GENERATION_FAILED: ${agentError?.message || 'unknown error'}`);
      }

      if (!analysis) {
        throw new Error('PATH_GENERATION_FAILED: empty analysis');
      }

if (!analysis.suggestedMilestones || analysis.suggestedMilestones.length === 0) {
        throw new Error('PATH_GENERATION_FAILED: suggestedMilestones is empty');
      }
      
      const milestonesData = analysis.suggestedMilestones || [];
      
      // ========================================
      // Anderson 框架标注（PathAgent v3.1）
      // ========================================
      logger.info('开始 Anderson 框架标注...', { userId: data.userId });
      
      let goalAnalysisResult: any = null;
      let taskLabels: any[] = [];
      
      try {
        // Step 1: 识别目标类型
        const goalTypeInput = {
          goal: data.description,
          context: JSON.stringify(data.userProfile || {}),
          domain: analysis.subject
        };
        
        goalAnalysisResult = await executeSkill(goalTypeIdentifierDefinition, goalTypeInput);
        logger.info('目标类型识别完成', { 
          goalType: goalAnalysisResult.goalType,
          confidence: goalAnalysisResult.confidence 
        });
        
        // Step 2: 收集所有任务
        const allTasks: any[] = [];
        for (let i = 0; i < milestonesData.length; i++) {
          const milestone = milestonesData[i];
          if (milestone.tasks && milestone.tasks.length > 0) {
            for (let j = 0; j < milestone.tasks.length; j++) {
              const task = milestone.tasks[j];
              allTasks.push({
                id: `task_${i}_${j}`,  // 添加 ID 用于标注匹配
                milestoneIndex: i,
                taskIndex: j,
                title: task.title,
                description: task.description || '',
                type: task.type || 'practice',
                stageGoal: milestone.goal || milestone.name
              });
            }
          }
        }
        
        // Step 3: 批量安德森标注
        if (allTasks.length > 0) {
          const labelerInput = {
            tasks: allTasks,
            goalType: goalAnalysisResult.goalType,
            knowledgeDistribution: goalAnalysisResult.knowledgeDistribution,
            cognitiveFocus: goalAnalysisResult.cognitiveFocus
          };
          
          const labelerResult = await executeSkill(batchAndersonLabelerDefinition, labelerInput);
          taskLabels = labelerResult.labels || [];
          
          logger.info('Anderson 标注完成', { 
            taskCount: allTasks.length,
            labeledCount: taskLabels.length 
          });
          
          // Step 4: 生成前端标签
          for (const label of taskLabels) {
            if (label.knowledgeType && label.cognitiveLevel) {
              const labelInput = {
                knowledgeType: label.knowledgeType,
                cognitiveLevel: label.cognitiveLevel,
                taskDescription: label.taskDescription || '',
                goalType: goalAnalysisResult.goalType,
                domain: analysis.subject
              };
              
              try {
                const labelResult = await executeSkill(labelGeneratorDefinition, labelInput);
                label.displayLabel = labelResult.combinedLabel || '';
                label.knowledgeLabel = labelResult.knowledgeLabel || '';
                label.cognitiveLabel = labelResult.cognitiveLabel || '';
              } catch (labelError) {
                // 标签生成失败，使用默认标签
                label.displayLabel = `${label.knowledgeType} + ${label.cognitiveLevel}`;
              }
            }
          }
          
          // Step 5: 将标注合并回任务
          for (const taskLabel of taskLabels) {
            // 从 taskId 解析索引: "task_${i}_${j}"
            const taskIdMatch = taskLabel.taskId?.match(/task_(\d+)_(\d+)/);
            if (taskIdMatch) {
              const milestoneIndex = parseInt(taskIdMatch[1]);
              const taskIndex = parseInt(taskIdMatch[2]);
              const { taskId, knowledgeType, cognitiveLevel, displayLabel, learningObjectives, coreConcept, transferable, confidence } = taskLabel;
              if (milestonesData[milestoneIndex]?.tasks?.[taskIndex]) {
                milestonesData[milestoneIndex].tasks[taskIndex] = {
                  ...milestonesData[milestoneIndex].tasks[taskIndex],
                  knowledgeType,
                  cognitiveLevel,
                  displayLabel,
                  learningObjectives,
                  coreConcept,
                  transferable,
                  annotationConfidence: confidence
                };
              }
            }
          }
        }
      } catch (andersonError: any) {
        logger.error('Anderson 标注失败，终止生成', {
          error: andersonError?.message,
          userId: data.userId
        });
        throw new Error(`PATH_LABELING_FAILED: ${andersonError?.message || 'unknown error'}`);
      }
      
      const learningPath = await prisma.$transaction(async (tx) => {
        // 如果提供了现有路径 ID，更新它；否则创建新路径
        let path;
        if (data.existingPathId) {
          path = await tx.learning_paths.update({
            where: { id: data.existingPathId },
            data: {
              title: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
              name: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
              description: (data.description && !data.description.includes('\uFFFD')) 
                ? data.description 
                : (milestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
              subject: analysis.subject || '综合',
              status: 'active',
              difficulty: analysis.difficulty || 'beginner',
              totalMilestones: milestonesData.length || 1,
              estimatedHours: analysis.estimatedTotalHours || 0,
              deadline: data.deadline || null,
              deadlineText: data.deadlineText || null,
              aiGenerated: true,
              aiPromptTemplate: JSON.stringify(analysis),
              updatedAt: new Date()
            }
          });
        } else {
          path = await tx.learning_paths.create({
            data: {
              id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              userId: data.userId,
              title: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
              name: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
              description: (data.description && !data.description.includes('\uFFFD')) 
                ? data.description 
                : (milestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
              subject: analysis.subject || '综合',
              difficulty: analysis.difficulty || 'beginner',
              totalMilestones: milestonesData.length || 1,
              estimatedHours: analysis.estimatedTotalHours || 0,
              deadline: data.deadline || null,
              deadlineText: data.deadlineText || null,
              aiGenerated: true,
              aiPromptTemplate: JSON.stringify(analysis),
              status: 'active',
              updatedAt: new Date()
            }
          });
        }

await tx.path_decompositions.create({
          data: {
            id: `pd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            userId: data.userId,
            goal: data.description,
            stages: JSON.stringify(milestonesData.map((m: any) => m.name) || []),
            milestones: JSON.stringify(milestonesData),
            subtasks: JSON.stringify(milestonesData.flatMap((m: any) => m.tasks || []) || []),
            aiAnalysis: JSON.stringify(analysis),
            feasibility: analysis.feasibility,
            difficulty: analysis.difficulty,
            recommendations: JSON.stringify(analysis.recommendations || [])
          }
        });

        for (let i = 0; i < milestonesData.length; i++) {
          const milestoneData = milestonesData[i];
          const stageNum = milestoneData.stage || i + 1;
          
          const milestone = await (tx.milestones as any).create({
            data: {
              id: `ms_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${i}`,
              learningPathId: path.id,
              stageNumber: stageNum,
              title: milestoneData.name || `里程碑${stageNum}`,
              description: milestoneData.description || '',
              goal: milestoneData.goal || '',
              estimatedHours: milestoneData.estimatedHours || 0,
              status: stageNum === 1 ? 'active' : 'locked',
              order: i,
              updatedAt: new Date()
            }
          });
          
          if (milestoneData.tasks && milestoneData.tasks.length > 0) {
            for (let j = 0; j < milestoneData.tasks.length; j++) {
              const taskData = milestoneData.tasks[j];
              await (tx.subtasks as any).create({
                data: {
                  id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${i}_${j}`,
                  milestoneId: milestone.id,
                  userId: data.userId,
                  title: taskData.title || `任务${j + 1}`,
                  description: taskData.description || '',
                  taskType: taskData.type || 'practice',
                  estimatedMinutes: taskData.estimatedMinutes || 30,
                  acceptanceCriteria: taskData.acceptanceCriteria || '',
                  order: j,
                  status: 'todo',
                  knowledgeType: taskData.knowledgeType || null,
                  cognitiveLevel: taskData.cognitiveLevel || null,
                  learningObjectives: taskData.learningObjectives ? JSON.stringify(taskData.learningObjectives) : null,
                  coreConcept: taskData.coreConcept || null,
                  displayLabel: taskData.displayLabel || null,
                  transferable: taskData.transferable ?? false,
                  annotationConfidence: taskData.annotationConfidence || null,
                  updatedAt: new Date()
                }
              });
            }
          }
        }

        await tx.learning_paths.update({
          where: { id: path.id },
          data: { totalMilestones: milestonesData.length }
        });
        
        return path;
      });
      
      const duration = Date.now() - startTime;
      logger.info(`学习路径生成完成：${learningPath.id}`, {
        userId: data.userId,
        milestoneCount: milestonesData.length,
        durationMs: duration
      });

      const fullPath = await this.getLearningPath(learningPath.id);

      return fullPath;
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error('生成学习路径失败', {
        error: error?.message || String(error),
        stack: error?.stack,
        userId: data.userId,
        goal: data.description,
        durationMs: duration
      });
      
      throw new Error(`生成学习路径失败：${error?.message || '未知错误'}。请稍后重试或联系支持。`);
    }
  }

  /**
   * 为现有学习路径补充实战任务
   */
  async generateTasksForExistingPath(data: {
    learningPathId: string;
    userId: string;
    description: string;
    userProfile?: any;
  }) {
    try {
const learningPath = await prisma.learning_paths.findUnique({
        where: { id: data.learningPathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });

      if (!learningPath) {
        throw new Error('学习路径不存在');
      }

      for (const milestone of learningPath.milestones) {
        const stageNum = milestone.stageNumber;
        logger.info(`正在为里程碑 ${stageNum} 生成实战任务...`);
        
        const contextualTopic = `总体目标：${data.description} - 当前阶段：${milestone.title || `里程碑${stageNum}`}`;
        
        try {
          const taskResult = await aiService.generateTasksForTopic(
            contextualTopic,
            stageNum,
            data.userProfile
          );

          if (taskResult.success && taskResult.internal?.tasks && taskResult.internal.tasks.length > 0) {
            for (const task of taskResult.internal.tasks) {
              await prisma.subtasks.create({
                data: {
                  id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                  milestoneId: milestone.id,
                  userId: data.userId,
                  title: task.title,
                  description: task.description,
                  taskType: task.type || 'practice',
                  estimatedMinutes: task.estimatedMinutes || 30,
                  acceptanceCriteria: task.acceptanceCriteria || '',
                  status: 'todo',
                  updatedAt: new Date()
                }
              });
            }
            logger.info(`里程碑 ${stageNum} 实战任务生成完成：${taskResult.internal.tasks.length}个任务`);
          } else {
            logger.warn(`里程碑 ${stageNum} AI 生成任务失败，使用默认任务`);
            await prisma.subtasks.create({
              data: {
                id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                milestoneId: milestone.id,
                userId: data.userId,
                title: milestone.title || `里程碑${stageNum}学习任务`,
                description: milestone.description || milestone.goal || '完成本里程碑学习内容',
                taskType: 'practice',
                estimatedMinutes: 30,
                status: 'todo',
                updatedAt: new Date()
              }
            });
          }
        } catch (taskError) {
          logger.error(`里程碑 ${stageNum} 任务生成失败:`, taskError);
          await prisma.subtasks.create({
            data: {
              id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              milestoneId: milestone.id,
              userId: data.userId,
              title: milestone.title || `里程碑${stageNum}学习任务`,
              description: milestone.description || milestone.goal || '完成本里程碑学习内容',
              taskType: 'practice',
              estimatedMinutes: 30,
              status: 'todo',
              updatedAt: new Date()
            }
          });
        }
      }

      logger.info(`学习路径生成完成：${learningPath.id}`);
      return learningPath;
    } catch (error) {
      logger.error('生成学习路径失败:', error);
      throw error;
    }
  }

// 获取学习路径详情
  async getLearningPath(pathId: string) {
    try {
      const path = await prisma.learning_paths.findUnique({
        where: { id: pathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });

      if (!path) {
        throw new Error('学习路径不存在');
      }

      const pathWithActualMinutes = await this.attachActualMinutesToPath(path);

      return {
        ...pathWithActualMinutes,
        milestones: pathWithActualMinutes.milestones,
        stages: pathWithActualMinutes.milestones,
        totalStages: path.totalMilestones
      };
    } catch (error) {
      logger.error('获取学习路径详情失败:', error);
      throw error;
    }
  }

// 获取用户的学习路径列表
  async getUserLearningPaths(userId: string) {
    try {
      const paths = await prisma.learning_paths.findMany({
        where: { userId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return paths.map(path => {
        const allTasks = path.milestones.flatMap((m: any) => m.subtasks || []);
        const totalTaskCount = allTasks.length;
        const completedTaskCount = allTasks.filter((t: any) => t.status === 'completed').length;

        return {
          ...path,
          name: path.title,
          totalStages: path.totalMilestones,
          taskSummary: {
            total: totalTaskCount,
            completed: completedTaskCount,
            progress: totalTaskCount > 0 ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0
          }
        };
      });
    } catch (error) {
      logger.error('获取用户学习路径失败:', error);
      throw error;
    }
  }

// 获取任务详情
  async getTaskDetail(taskId: string) {
    try {
      const subtask = await prisma.subtasks.findUnique({
        where: { id: taskId },
        include: {
          milestones: {
            include: {
              learning_paths: true
            }
          },
          learningContents: true
        }
      });

      if (!subtask) {
        throw new Error('任务不存在');
      }

      return {
        ...subtask,
        week: subtask.milestones,
        milestone: subtask.milestones,
        learningPath: subtask.milestones?.learning_paths,
        contents: subtask.learningContents
      };
    } catch (error) {
      logger.error('获取任务详情失败:', error);
      throw error;
    }
  }

  // 获取任务详情（别名，用于路由）
  async getTaskById(taskId: string, userId?: string) {
    return this.getTaskDetail(taskId);
  }

  // 删除学习路径
  async deleteLearningPath(pathId: string, userId: string) {
    try {
      // 验证路径存在且属于当前用户
      const path = await prisma.learning_paths.findUnique({
        where: { id: pathId }
      });

      if (!path) {
        throw new Error('学习路径不存在');
      }

      if (path.userId !== userId) {
        throw new Error('无权删除此学习路径');
      }

      // 删除路径（级联删除里程碑和子任务）
      await prisma.learning_paths.delete({
        where: { id: pathId }
      });

      logger.info(`学习路径删除：${pathId}`);
    } catch (error) {
      logger.error('删除学习路径失败:', error);
      throw error;
    }
  }

  // 完成任务
  async completeTask(data: CompleteTaskData) {
    try {
      const subtask = await prisma.subtasks.findUnique({
        where: { id: data.taskId }
      });

      if (!subtask) {
        throw new Error('任务不存在');
      }

      // 更新任务状态
      const updatedSubtask = await prisma.subtasks.update({
        where: { id: data.taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          rating: data.rating
        }
      });

// 创建学习会话记录
      await prisma.learning_sessions.create({
        data: {
          id: `ls_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          taskId: data.taskId,
          startTime: new Date(Date.now() - (data.actualMinutes || 30) * 60000),
          endTime: new Date(),
          duration: data.actualMinutes || 30,
          status: 'completed'
        }
      });

      // 更新学习指标 (LSS/KTL/LF/LSB)
      try {
        await updateLearningMetrics({
          userId: data.userId,
          taskId: data.taskId,
          durationMinutes: data.actualMinutes || 30,
          subjectiveDifficulty: data.subjectiveDifficulty,
          completed: true,
          notes: data.notes
        });
        logger.info('学习指标已更新', { userId: data.userId });
      } catch (error) {
        logger.warn('更新学习指标失败（不影响任务完成）', error);
      }

      // 更新用户 XP
      const XP_PER_TASK = 50;
      await prisma.users.update({
        where: { id: data.userId },
        data: {
          xp: { increment: XP_PER_TASK }
        }
      });

      // 检查成就达成
      try {
        await achievementService.triggerAchievementCheck(data.userId, 'task_completed');
      } catch (error) {
        logger.warn('检查成就失败（不影响任务完成）:', error);
      }

      // 调用 progress-agent 生成学习报告
      let learningReport: { reasoning?: string; suggestion?: string; recommendations?: string[] } | undefined;
      
      try {
        const agentInput: AgentInput = {
          type: 'standard',
          goal: 'task_completion_analysis',
          metadata: {
            action: 'task_complete',
            taskId: data.taskId,
            data: {
              taskTitle: subtask.title,
              timeSpent: data.actualMinutes || 30,
              subjectiveDifficulty: data.subjectiveDifficulty,
              difficulty: subtask.estimatedMinutes ? Math.min(subtask.estimatedMinutes / 30, 10) : 5
            }
          }
        };

        const agentContext: AgentContext = {
          userId: data.userId
        };

        const result = await progressAgentHandler(agentInput, agentContext);
        
        if (result.success && result.progress) {
          learningReport = {
            reasoning: result.progress.metrics.reasoning,
            suggestion: result.progress.metrics.suggestion,
            recommendations: result.progress.recommendations
          };
        }
      } catch (error) {
        logger.warn('生成学习报告失败（不影响任务完成）:', error);
      }

      logger.info(`任务完成：${subtask.id}`, { userId: data.userId });

      return {
        task: updatedSubtask,
        learningReport
      };
    } catch (error) {
      logger.error('完成任务失败:', error);
      throw error;
    }
  }

  // 获取学习进度统计
  async getLearningStats(userId: string) {
    try {
      const user = await prisma.users.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('用户不存在');
      }

      const subtasks = await prisma.subtasks.findMany({
        where: { userId }
      });

      const totalPaths = await prisma.learning_paths.count({
        where: {
          userId,
          status: {
            not: 'failed'
          }
        }
      });

      const completedSubtasks = subtasks.filter(t => t.status === 'completed');
      const inProgressSubtasks = subtasks.filter(t => t.status === 'in_progress');
      const todoSubtasks = subtasks.filter(t => t.status === 'todo');

      const totalMinutes = subtasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);

      // 获取学习状态指标
      const currentState = await stateTrackingService.getCurrentState(userId);
      const suggestion = currentState ? stateTrackingService.generateSuggestion(currentState) : null;

      return {
        user: {
          id: user.id,
          name: user.name,
          xp: user.xp,
          level: Math.floor(Math.sqrt(user.xp / 100)) + 1
        },
        subtasks: {
          total: subtasks.length,
          completed: completedSubtasks.length,
          inProgress: inProgressSubtasks.length,
          todo: todoSubtasks.length
        },
        tasks: {
          total: subtasks.length,
          completed: completedSubtasks.length,
          inProgress: inProgressSubtasks.length,
          todo: todoSubtasks.length,
          completionRate: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0
        },
        paths: {
          total: totalPaths
        },
        time: {
          totalMinutes,
          totalCompleted: totalMinutes,
          progress: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0,
          completionRate: subtasks.length > 0 ? (completedSubtasks.length / subtasks.length * 100).toFixed(1) : '0'
        },
        state: currentState,
        suggestion
      };
    } catch (error) {
      logger.error('获取学习统计失败:', error);
      throw error;
    }
  }
}

export default new LearningService();
