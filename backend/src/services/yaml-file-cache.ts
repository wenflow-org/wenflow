/**
 * YAML 文件解析内存缓存（mtime 失效）
 *
 * 目标：消灭 admin 字段路由 N+1 场景的重复解析（ADMIN_PERFORMANCE_AUDIT P4 /
 * 重构总决策 P1-1）——skills.yaml 与编排文件每次请求各解析一次，改为
 * 一次请求内共享 + 跨请求按文件 mtime 命中缓存。
 *
 * 失效策略：每次调用做一次 statSync（微秒级开销），仅当文件 mtimeMs + size
 * 与缓存条目一致时命中；任一变化即重解析。因此：
 *   - 文件不存在/不可读 → 不缓存，直接透传解析（调用方负责抛错）——
 *     测试用临时路径天然可绕过旧内容（mtime/size 不同即失效）；
 *   - 解析抛错 → 不写入缓存；
 *   - clearYamlFileCache() 提供强制清空（scaffold 写盘等主动失效场景）。
 */
import * as fs from 'fs';

interface YamlCacheEntry<T> {
  mtimeMs: number;
  size: number;
  value: T;
}

const cache = new Map<string, YamlCacheEntry<unknown>>();

/** 清空全部解析缓存（主动失效：文件写盘后调用） */
export function clearYamlFileCache(): void {
  cache.clear();
}

/**
 * 以文件 mtime+size 为键的解析缓存封装。
 * parse 仅当首次调用或文件变化时执行；返回值必须是可复用的不可变数据
 * （调用方不得改写解析结果，否则污染缓存）。
 */
export function cachedFileParse<T>(filePath: string, parse: () => T): T {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // 文件不存在/不可读：不缓存（测试临时路径可绕过，调用方负责抛错）
    return parse();
  }
  const hit = cache.get(filePath);
  if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.value as T;
  }
  const value = parse();
  cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}
