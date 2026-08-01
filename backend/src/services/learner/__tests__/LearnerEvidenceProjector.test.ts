const transaction = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { $transaction: transaction }
}));

import { LearnerEvidenceProjector } from '../LearnerEvidenceProjector';
import { createDomainEvent } from '../../../events/contracts';

describe('LearnerEvidenceProjector', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores evidence, projection and inbox receipt atomically', async () => {
    const tx = {
      domain_event_inbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      },
      learner_evidence: { create: jest.fn().mockResolvedValue({}) },
      learner_projections: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({})
      }
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));
    const event = createDomainEvent({
      id: 'evt-1',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-1',
      userId: 'user-1',
      source: 'test',
      data: { taskId: 'task-1', pathId: 'path-1' }
    });

    await new LearnerEvidenceProjector().handle(event);

    expect(tx.learner_evidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: 'evt-1', evidenceType: 'task:completed' })
    });
    expect(tx.learner_projections.upsert).toHaveBeenCalled();
    expect(tx.domain_event_inbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: 'evt-1' })
    });
  });

  it('does nothing when this consumer already processed the event', async () => {
    const tx = {
      domain_event_inbox: { findUnique: jest.fn().mockResolvedValue({ id: 'receipt' }) },
      learner_evidence: { create: jest.fn() },
      learner_projections: { upsert: jest.fn() }
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));

    await new LearnerEvidenceProjector().handle(createDomainEvent({
      id: 'evt-1',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-1',
      userId: 'user-1',
      source: 'test',
      data: {}
    }));

    expect(tx.learner_evidence.create).not.toHaveBeenCalled();
    expect(tx.learner_projections.upsert).not.toHaveBeenCalled();
  });
});
