import { SseParser } from '../sse-parser'

describe('SseParser', () => {
  it('解析标准 OpenAI SSE 事件流（含 [DONE]）', () => {
    const parser = new SseParser()
    const events = parser.push(Buffer.from(
      'data: {"id":"c1","choices":[{"delta":{"content":"你好"}}]}\n\n'
      + 'data: [DONE]\n\n'
    ))
    expect(events).toHaveLength(2)
    expect(events[0].data).toBe('{"id":"c1","choices":[{"delta":{"content":"你好"}}]}')
    expect(events[1].data).toBe('[DONE]')
  })

  it('跨 chunk 拆分的多字节 UTF-8 字符不产生乱码', () => {
    const parser = new SseParser()
    // "你" 为 3 字节 UTF-8：在 body 第 2 个字节处截断，验证按完整行解码
    const raw = Buffer.concat([
      Buffer.from('data: {"content":"'),
      Buffer.from('你好世界'),
      Buffer.from('"}\n\n')
    ])
    const prefix = Buffer.from('data: {"content":"')
    const splitAt = prefix.length + 1
    const events = parser.push(raw.subarray(0, splitAt))
    expect(events).toHaveLength(0)
    const rest = parser.push(raw.subarray(splitAt))
    expect(rest).toHaveLength(1)
    expect(JSON.parse(rest[0].data)).toEqual({ content: '你好世界' })
  })

  it('空行触发事件分发，多行 data 按 \\n 拼接', () => {
    const parser = new SseParser()
    const events = parser.push(Buffer.from('data: line1\ndata: line2\n\n'))
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('line1\nline2')
  })

  it('识别自定义 event 字段与注释行', () => {
    const parser = new SseParser()
    const events = parser.push(Buffer.from(
      ': keep-alive\n'
      + 'event: delta\n'
      + 'data: {"text":"a"}\n\n'
    ))
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('delta')
    expect(events[0].data).toBe('{"text":"a"}')
  })

  it('兼容 CRLF 行结束', () => {
    const parser = new SseParser()
    const events = parser.push(Buffer.from('data: ok\r\n\r\n'))
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('ok')
  })

  it('单次 push 分批喂入字节流', () => {
    const parser = new SseParser()
    const raw = Buffer.from('data: a\n\ndata: b\n\n')
    const events1 = parser.push(raw.subarray(0, 5))
    const events2 = parser.push(raw.subarray(5, 9))
    const events3 = parser.push(raw.subarray(9))
    expect(events1).toHaveLength(0)
    expect(events2).toHaveLength(1)
    expect(events3).toHaveLength(1)
    expect(events2[0].data).toBe('a')
    expect(events3[0].data).toBe('b')
  })

  it('finish 处理尾部无换行的残留行', () => {
    const parser = new SseParser()
    const events = parser.push(Buffer.from('data: partial'))
    expect(events).toHaveLength(0)
    expect(parser.finish()).toHaveLength(1)
  })
})
