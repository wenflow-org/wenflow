/** 后端统一响应体 { success, data } 解包（裸调 request 时使用） */
export function unwrap<T = unknown>(response: unknown): T {
  const body = response as Record<string, unknown> | null;
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  return response as T;
}

export function unwrapArray<T = Record<string, unknown>>(response: unknown): T[] {
  const data = unwrap<unknown>(response);
  return Array.isArray(data) ? (data as T[]) : [];
}
