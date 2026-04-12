import { ContentStrategySelector, selectContentStrategy, inferCognitiveLoad } from '../index';

describe('ContentStrategySelector', () => {
  let selector: ContentStrategySelector;

  beforeEach(() => {
    selector = new ContentStrategySelector();
  });

  describe('selectStrategy', () => {
    it('should select interactive for high cognitive load reading', () => {
      const result = selector.selectStrategy({
        taskType: 'reading',
        cognitiveLoad: 'high',
        estimatedMinutes: 60
      });

      expect(result.strategy).toBe('interactive');
      expect(result.agentId).toBe('content-agent-interactive');
      expect(result.confidence).toBe(1.0);
    });

    it('should select light-interactive for medium cognitive load reading', () => {
      const result = selector.selectStrategy({
        taskType: 'reading',
        cognitiveLoad: 'medium',
        estimatedMinutes: 30
      });

      expect(result.strategy).toBe('light-interactive');
      expect(result.agentId).toBe('content-agent-v3');
    });

    it('should select light-interactive for case-study', () => {
      const result = selector.selectStrategy({
        taskType: 'case-study',
        cognitiveLoad: 'high',
        estimatedMinutes: 45
      });

      expect(result.strategy).toBe('light-interactive');
    });

    it('should select traditional for practice tasks', () => {
      const result = selector.selectStrategy({
        taskType: 'practice',
        cognitiveLoad: 'medium',
        estimatedMinutes: 30
      });

      expect(result.strategy).toBe('traditional');
    });

    it('should select traditional for project tasks', () => {
      const result = selector.selectStrategy({
        taskType: 'project',
        cognitiveLoad: 'high',
        estimatedMinutes: 90
      });

      expect(result.strategy).toBe('traditional');
    });

    it('should select traditional for low cognitive load', () => {
      const result = selector.selectStrategy({
        taskType: 'reading',
        cognitiveLoad: 'low',
        estimatedMinutes: 15
      });

      expect(result.strategy).toBe('traditional');
    });

    it('should infer cognitive load when not provided', () => {
      const result = selector.selectStrategy({
        taskType: 'reading',
        estimatedMinutes: 60
      });

      expect(result.strategy).toBe('interactive');
      expect(result.confidence).toBe(0.8);
    });
  });

  describe('inferCognitiveLoad', () => {
    it('should infer high from reading >= 45 minutes', () => {
      const load = selector.inferCognitiveLoad({
        taskType: 'reading',
        estimatedMinutes: 45
      });
      expect(load).toBe('high');
    });

    it('should infer medium from practice tasks', () => {
      const load = selector.inferCognitiveLoad({
        taskType: 'practice',
        estimatedMinutes: 30
      });
      expect(load).toBe('medium');
    });

    it('should infer high from difficulty >= 7', () => {
      const load = selector.inferCognitiveLoad({
        difficulty: 8
      });
      expect(load).toBe('high');
    });

    it('should infer medium from difficulty 4-6', () => {
      const load = selector.inferCognitiveLoad({
        difficulty: 5
      });
      expect(load).toBe('medium');
    });

    it('should infer low from short tasks', () => {
      const load = selector.inferCognitiveLoad({
        taskType: 'reading',
        estimatedMinutes: 10
      });
      expect(load).toBe('low');
    });

    it('should infer medium from case-study', () => {
      const load = selector.inferCognitiveLoad({
        taskType: 'case-study'
      });
      expect(load).toBe('medium');
    });

    it('should infer high from long practice/project', () => {
      const load = selector.inferCognitiveLoad({
        taskType: 'practice',
        estimatedMinutes: 60
      });
      expect(load).toBe('high');
    });
  });

  describe('validateSelection', () => {
    it('should return valid for correct selection', () => {
      const selection = selector.selectStrategy({
        taskType: 'reading',
        cognitiveLoad: 'high'
      });

      const validation = selector.validateSelection(selection);
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toHaveLength(0);
    });

    it('should warn on low confidence', () => {
      const validation = selector.validateSelection({
        strategy: 'traditional',
        agentId: 'content-agent-v3',
        reason: 'test',
        confidence: 0.5
      });

      expect(validation.valid).toBe(false);
      expect(validation.warnings).toContain('低置信度选择 (0.5)，建议提供更多任务信息');
    });
  });

  describe('convenience functions', () => {
    it('selectContentStrategy should work', () => {
      const result = selectContentStrategy({
        taskType: 'reading',
        cognitiveLoad: 'high'
      });

      expect(result.strategy).toBe('interactive');
    });

    it('inferCognitiveLoad should work', () => {
      const load = inferCognitiveLoad({
        taskType: 'practice',
        estimatedMinutes: 30
      });

      expect(load).toBe('medium');
    });
  });

  describe('getAllStrategies', () => {
    it('should return all strategy configs', () => {
      const strategies = selector.getAllStrategies();
      expect(strategies.length).toBeGreaterThan(0);
    });
  });

  describe('selectStrategies (batch)', () => {
    it('should select strategies for multiple tasks', () => {
      const tasks = [
        { taskType: 'reading' as const, cognitiveLoad: 'high' as const },
        { taskType: 'practice' as const, cognitiveLoad: 'medium' as const },
        { taskType: 'case-study' as const, cognitiveLoad: 'medium' as const }
      ];

      const results = selector.selectStrategies(tasks);

      expect(results).toHaveLength(3);
      expect(results[0].strategy).toBe('interactive');
      expect(results[1].strategy).toBe('traditional');
      expect(results[2].strategy).toBe('light-interactive');
    });
  });
});