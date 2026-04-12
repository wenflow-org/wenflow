/**
 * Agent 协作测试
 * 
 * 测试四大核心 Agent 的互相调用
 */

import { AgentCollaborationService, createAgentCollaborationService } from '../agent-collaboration.service';
import { EventBus, createEventBus } from '../../gateway/event-bus';
import { LearningSignal } from '../../agents/protocol';
import prisma from '../../config/database';

const TEST_USER_ID = 'test-user-agent-collab';
const TEST_PATH_ID = 'test-path-collab';

describe('Agent Collaboration Service', () => {
  let collaborationService: AgentCollaborationService;
  let eventBus: EventBus;

  beforeAll(async () => {
    eventBus = createEventBus(prisma as any);
    collaborationService = createAgentCollaborationService({
      enableAutoAdjustment: true,
      adjustmentCooldown: 1000,
      minSignalsForAdjustment: 1
    });
    collaborationService.start();
  });

  afterAll(async () => {
    collaborationService.stop();
  });

  describe('Lesson Completion Flow', () => {
    it('should process lesson:completed event and trigger signal detection', async () => {
      const signalHandler = jest.fn();
      eventBus.on('learning:signal:detected', signalHandler);

      await collaborationService.completeLesson(TEST_USER_ID, {
        sessionId: 'test-session',
        lessonId: 'test-lesson',
        duration: 30,
        performance: {
          engagement: 0.8,
          understanding: 0.7,
          questionsAsked: 5,
          correctAnswers: 4,
          frustrationLevel: 0.2
        },
        topics: ['Python basics']
      });

      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Signal Detection and Path Adjustment', () => {
    it('should evaluate adjustment decision correctly', () => {
      const service = collaborationService as any;
      
      const highFatigueSignals: LearningSignal[] = [
        { type: 'fatigue-high', intensity: 0.8, timestamp: new Date().toISOString() }
      ];
      
      const decision = service.evaluateAdjustmentDecision(highFatigueSignals);
      
      expect(decision.shouldAdjustPath).toBe(true);
      expect(decision.shouldAdjustContent).toBe(true);
      expect(decision.urgency).toBe('high');
    });

    it('should handle mastery signal', () => {
      const service = collaborationService as any;
      
      const masterySignals: LearningSignal[] = [
        { type: 'mastery', intensity: 0.9, timestamp: new Date().toISOString() }
      ];
      
      const decision = service.evaluateAdjustmentDecision(masterySignals);
      
      expect(decision.shouldAdjustPath).toBe(true);
      expect(decision.urgency).toBe('low');
    });
  });

  describe('User Signal Status', () => {
    it('should return correct signal status', () => {
      const status = collaborationService.getUserSignalStatus(TEST_USER_ID);
      
      expect(status).toHaveProperty('pendingSignals');
      expect(status).toHaveProperty('lastAdjustment');
      expect(status).toHaveProperty('canAdjust');
    });
  });

  describe('Personalization Request', () => {
    it('should return personalization config', async () => {
      const result = await collaborationService.requestPersonalization(
        TEST_USER_ID,
        'content-agent',
        'content-generation'
      );

      expect(result).toHaveProperty('config');
      expect(result).toHaveProperty('promptEnhancement');
      expect(result).toHaveProperty('contentHints');
      expect(result.config).toHaveProperty('contentStyle');
      expect(result.config).toHaveProperty('pacing');
      expect(result.config).toHaveProperty('interaction');
    });
  });
});