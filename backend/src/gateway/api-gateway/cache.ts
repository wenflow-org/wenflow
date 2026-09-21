import { CallerInfo, ResolvedRoute, RouteCacheEntry } from './types';

export class GatewayCache {
  private routeCache = new Map<string, RouteCacheEntry>();
  private readonly ttl = 60000;
  private readonly keySeparator = '::';
  // 过期条目原本只在被再次访问时删除（键含 userId，不活跃用户条目永驻 = 慢泄漏）。
  // 容量触达阈值时做一次全表惰性清扫，均摊成本低。
  private readonly sweepThreshold = 512;

  private generateKey(caller: CallerInfo, userId?: string): string {
    return [
      userId || 'anonymous',
      caller.agentId || 'default',
      caller.skillId || 'default'
    ].join(this.keySeparator);
  }

  private parseKey(key: string): [string, string, string] {
    const parts = key.split(this.keySeparator);
    return [parts[0] || 'anonymous', parts[1] || 'default', parts[2] || 'default'];
  }

  getRoute(caller: CallerInfo, userId?: string): ResolvedRoute | null {
    const key = this.generateKey(caller, userId);
    const entry = this.routeCache.get(key);
    
    if (!entry) {
      return null;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.routeCache.delete(key);
      return null;
    }
    
    return entry.route;
  }

  setRoute(caller: CallerInfo, userId: string | undefined, route: ResolvedRoute): void {
    const key = this.generateKey(caller, userId);
    this.routeCache.set(key, {
      route,
      expiresAt: Date.now() + this.ttl
    });
    if (this.routeCache.size >= this.sweepThreshold) {
      const now = Date.now();
      for (const [cachedKey, entry] of this.routeCache) {
        if (now > entry.expiresAt) this.routeCache.delete(cachedKey);
      }
    }
  }

  invalidate(userId?: string, agentId?: string, skillId?: string): void {
    if (!userId && !agentId && !skillId) {
      this.routeCache.clear();
      return;
    }

    const keysToDelete: string[] = [];
    
    for (const key of this.routeCache.keys()) {
      const [cachedUserId, cachedAgentId, cachedSkillId] = this.parseKey(key);
      
      if (userId && cachedUserId === userId) {
        keysToDelete.push(key);
        continue;
      }
      
      if (agentId && cachedAgentId === agentId) {
        keysToDelete.push(key);
        continue;
      }

      if (skillId && cachedSkillId === skillId) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.routeCache.delete(key);
    }
  }
}
