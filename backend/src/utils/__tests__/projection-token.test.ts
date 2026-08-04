process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters';

import jwt from 'jsonwebtoken';
import { signProjectionToken, verifyProjectionToken } from '../projection-token';

describe('synthetic projection token', () => {
  const base = {
    targetUserId: 'virtual-user-1',
    sourceProfileId: 'profile-1',
    issuedByAdminId: 'admin-1',
    grantSource: 'synthetic' as const,
    virtualSessionId: 'session-1',
    scope: 'full' as const,
    capabilities: ['goal:write', 'goal:read'] as const,
    experimentId: 'exp-1',
    runId: 'run-1',
    type: 'projection' as const
  };

  it('保留绑定身份、实验与 capability claims', () => {
    const token = signProjectionToken({ ...base, capabilities: [...base.capabilities] });
    expect(verifyProjectionToken(token)).toEqual(expect.objectContaining({
      targetUserId: 'virtual-user-1',
      sourceProfileId: 'profile-1',
      experimentId: 'exp-1',
      runId: 'run-1',
      capabilities: ['goal:write', 'goal:read']
    }));
  });

  it('拒绝未知 capability', () => {
    const token = jwt.sign({ ...base, capabilities: ['admin:write'] }, process.env.JWT_SECRET as string, {
      algorithm: 'HS256'
    });
    expect(() => verifyProjectionToken(token)).toThrow('capability');
  });

  it('拒绝缺少实验绑定的 synthetic token', () => {
    const token = jwt.sign({ ...base, experimentId: undefined }, process.env.JWT_SECRET as string, {
      algorithm: 'HS256'
    });
    expect(() => verifyProjectionToken(token)).toThrow('合成用户 token');
  });
});
