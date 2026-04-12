import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export interface InteractiveSessionData {
  id: string;
  userId: string;
  taskId: string;
  pathId: string;
  stage: 'ACTIVATION' | 'SEGMENT_1' | 'SEGMENT_2' | 'SEGMENT_3' | 'CHECK' | 'COMPLETED';
  activationQuestion?: string;
  segments: ContentSegment[];
  userResponses: UserResponse[];
  understandingScore?: number;
  understandingLevel?: 'passed' | 'vague' | 'deviation';
  skippedActivation: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentSegment {
  stage: string;
  content: string;
  thinkingPause?: {
    question: string;
    type: 'open' | 'choice';
    options?: string[];
  };
}

export interface UserResponse {
  stage: string;
  response: string;
  timestamp: string;
  skipped: boolean;
}

class InteractiveSessionService {
  async createSession(userId: string, taskId: string, pathId: string): Promise<InteractiveSessionData> {
    const session = await prisma.interactive_sessions.create({
      data: {
        id: `is_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        taskId,
        pathId,
        stage: 'ACTIVATION',
        segments: '[]',
        userResponses: '[]',
        skippedActivation: false,
        updatedAt: new Date()
      }
    });
    
    return this.toSessionData(session);
  }
  
  async getSession(sessionId: string): Promise<InteractiveSessionData | null> {
    const session = await prisma.interactive_sessions.findUnique({
      where: { id: sessionId }
    });
    
    return session ? this.toSessionData(session) : null;
  }
  
  async getSessionByTask(userId: string, taskId: string): Promise<InteractiveSessionData | null> {
    const session = await prisma.interactive_sessions.findFirst({
      where: { 
        userId,
        taskId,
        stage: { not: 'COMPLETED' }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return session ? this.toSessionData(session) : null;
  }
  
  async updateStage(sessionId: string, stage: string): Promise<void> {
    await prisma.interactive_sessions.update({
      where: { id: sessionId },
      data: { stage }
    });
  }
  
  async setActivationQuestion(sessionId: string, question: string): Promise<void> {
    await prisma.interactive_sessions.update({
      where: { id: sessionId },
      data: { activationQuestion: question }
    });
  }
  
  async markActivationSkipped(sessionId: string): Promise<void> {
    await prisma.interactive_sessions.update({
      where: { id: sessionId },
      data: { skippedActivation: true }
    });
  }
  
  async addUserResponse(sessionId: string, response: UserResponse): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    
    const responses = [...session.userResponses, response];
    
    await prisma.interactive_sessions.update({
      where: { id: sessionId },
      data: {
        userResponses: JSON.stringify(responses),
        updatedAt: new Date()
      }
    });
  }
  
  async addSegment(sessionId: string, segment: ContentSegment): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    
    const segments = [...session.segments, segment];
    
    await prisma.interactive_sessions.update({
      where: { id: sessionId },
      data: {
        segments: JSON.stringify(segments),
        updatedAt: new Date()
      }
    });
  }
  
  async completeSession(
    sessionId: string, 
    understandingScore: number,
    understandingLevel: 'passed' | 'vague' | 'deviation'
  ): Promise<void> {
    await prisma.interactive_sessions.update({
      where: { id: sessionId },
      data: {
        stage: 'COMPLETED',
        understandingScore,
        understandingLevel,
        completedAt: new Date()
      }
    });
  }
  
  async getUserSessions(userId: string, limit: number = 10): Promise<InteractiveSessionData[]> {
    const sessions = await prisma.interactive_sessions.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    
    return sessions.map(s => this.toSessionData(s));
  }
  
  async getSessionsByPath(pathId: string): Promise<InteractiveSessionData[]> {
    const sessions = await prisma.interactive_sessions.findMany({
      where: { pathId },
      orderBy: { createdAt: 'desc' }
    });
    
    return sessions.map(s => this.toSessionData(s));
  }
  
  private toSessionData(session: any): InteractiveSessionData {
    return {
      id: session.id,
      userId: session.userId,
      taskId: session.taskId,
      pathId: session.pathId,
      stage: session.stage,
      activationQuestion: session.activationQuestion,
      segments: JSON.parse(session.segments || '[]'),
      userResponses: JSON.parse(session.userResponses || '[]'),
      understandingScore: session.understandingScore,
      understandingLevel: session.understandingLevel,
      skippedActivation: session.skippedActivation,
      completedAt: session.completedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    };
  }
}

export const interactiveSessionService = new InteractiveSessionService();