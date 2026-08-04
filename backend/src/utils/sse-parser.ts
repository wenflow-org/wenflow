/**
 * SSE (Server-Sent Events) 流解析器。
 *
 * 面向 OpenAI 兼容 /chat/completions 流式响应（data: 行 + [DONE] 终止），
 * 也兼容通用 SSE 字段（event/data/注释行）。
 *
 * 说明：
 * - 以字节缓冲，仅在完整行边界做 UTF-8 解码，避免多字节字符被 chunk 边界截断。
 * - 空行触发一个事件分发；data 多行按 SSE 规范以 \n 拼接。
 */
export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  private buffer: Buffer = Buffer.alloc(0);
  private eventType = 'message';
  private dataLines: string[] = [];

  /**
   * 喂入一段原始字节，返回本次输入完成的 SSE 事件（可为空数组）。
   */
  push(chunk: Buffer): SseEvent[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const events: SseEvent[] = [];
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf(0x0a)) !== -1) {
      const rawLine = this.buffer.subarray(0, newlineIndex);
      this.buffer = this.buffer.subarray(newlineIndex + 1);
      const line = rawLine.length > 0 && rawLine[rawLine.length - 1] === 0x0d
        ? rawLine.subarray(0, rawLine.length - 1)
        : rawLine;
      this.processLine(line.toString('utf8'), events);
    }
    return events;
  }

  /**
   * 流结束时调用：处理尾部未以换行结束的残留行（通常没有）。
   */
  finish(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer.length > 0) {
      const line = this.buffer.toString('utf8');
      this.buffer = Buffer.alloc(0);
      this.processLine(line, events);
    }
    this.flushPending(events);
    return events;
  }

  private processLine(line: string, events: SseEvent[]): void {
    if (line === '') {
      this.flushPending(events);
      return;
    }
    if (line.startsWith(':')) return;
    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const value = colonIndex === -1 ? '' : line.slice(colonIndex + 1).replace(/^ /, '');
    if (field === 'event') {
      this.eventType = value || 'message';
    } else if (field === 'data') {
      this.dataLines.push(value);
    }
    // 忽略 id/retry 等其余字段
  }

  private flushPending(events: SseEvent[]): void {
    if (this.dataLines.length === 0) {
      this.eventType = 'message';
      return;
    }
    events.push({
      event: this.eventType || 'message',
      data: this.dataLines.join('\n')
    });
    this.dataLines = [];
    this.eventType = 'message';
  }
}
