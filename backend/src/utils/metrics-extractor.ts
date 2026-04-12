// 指标提取工具
// 从对话历史中提取数值指标，用于基线计算和状态评估

import { Message } from '../types/state';

export interface ExtractedMetrics {
  /**
   * 响应时间（秒）
   * 从上一条消息到当前消息的时间间隔
   */
  responseTime: number
  
  /**
   * 消息长度（字符数）
   * 当前消息的字符数量
   */
  messageLength: number
  
  /**
   * 交互间隔（分钟）
   * 两次用户消息之间的时间间隔
   */
  interactionInterval: number
}

/**
 * 辅助函数：获取时间戳的毫秒数
 */
function getTimestampMs(timestamp: string | Date): number {
  if (typeof timestamp === 'string') {
    return new Date(timestamp).getTime()
  }
  return timestamp.getTime()
}

/**
 * 从对话历史提取数值指标
 * @param messages 历史消息列表
 * @param newMessage 新添加的消息
 * @returns 提取的指标
 */
export function extractMetrics(
  messages: Message[],
  newMessage: Message
): ExtractedMetrics {
  // 1. 计算消息长度
  const messageLength = newMessage.content.length
  
  // 2. 计算响应时间（秒）
  // 从上一条消息到当前消息的时间间隔
  let responseTime = 0
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1]
    const lastTime = getTimestampMs(lastMessage.timestamp)
    const currentTime = getTimestampMs(newMessage.timestamp)
    const timeDiff = currentTime - lastTime
    responseTime = Math.floor(timeDiff / 1000) // 转换为秒
  }
  
  // 3. 计算交互间隔（分钟）
  // 找到上一个用户消息，计算时间间隔
  let interactionInterval = 0
  
  // 如果当前是用户消息，找上一个用户消息
  if (newMessage.role === 'user') {
    // 从后往前找最后一个用户消息（不包括当前这条）
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const prevTime = getTimestampMs(messages[i].timestamp)
        const currTime = getTimestampMs(newMessage.timestamp)
        const timeDiff = currTime - prevTime
        interactionInterval = Math.floor(timeDiff / 60000) // 转换为分钟
        break
      }
    }
    // 如果没有找到上一个用户消息，使用第一条消息的时间
    if (interactionInterval === 0 && messages.length > 0) {
      const firstMessage = messages[0]
      const firstTime = getTimestampMs(firstMessage.timestamp)
      const currTime = getTimestampMs(newMessage.timestamp)
      const timeDiff = currTime - firstTime
      interactionInterval = Math.floor(timeDiff / 60000)
    }
  } else {
    // 如果当前是 AI 消息，找上一个用户消息
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const prevTime = getTimestampMs(messages[i].timestamp)
        const currTime = getTimestampMs(newMessage.timestamp)
        const timeDiff = currTime - prevTime
        interactionInterval = Math.floor(timeDiff / 60000)
        break
      }
    }
  }
  
  return {
    responseTime,
    messageLength,
    interactionInterval
  }
}

/**
 * 计算消息的平均长度
 * @param messages 消息列表
 * @returns 平均长度
 */
export function calculateAverageMessageLength(messages: Message[]): number {
  if (messages.length === 0) {
    return 0
  }
  
  const totalLength = messages.reduce((sum, msg) => sum + msg.content.length, 0)
  return totalLength / messages.length
}

/**
 * 计算用户消息的平均响应时间
 * @param messages 消息列表
 * @returns 平均响应时间（秒）
 */
export function calculateAverageResponseTime(messages: Message[]): number {
  if (messages.length < 2) {
    return 0
  }
  
  let totalTime = 0
  let count = 0
  
  for (let i = 1; i < messages.length; i++) {
    const prevTime = getTimestampMs(messages[i - 1].timestamp)
    const currTime = getTimestampMs(messages[i].timestamp)
    const timeDiff = currTime - prevTime
    totalTime += timeDiff
    count++
  }
  
  return totalTime / count / 1000 // 转换为秒
}

/**
 * 计算交互间隔的统计信息
 * @param messages 消息列表
 * @returns 平均交互间隔（分钟）
 */
export function calculateAverageInteractionInterval(messages: Message[]): number {
  const userMessages = messages.filter(m => m.role === 'user')
  
  if (userMessages.length < 2) {
    return 0
  }
  
  let totalInterval = 0
  
  for (let i = 1; i < userMessages.length; i++) {
    const prevTime = getTimestampMs(userMessages[i - 1].timestamp)
    const currTime = getTimestampMs(userMessages[i].timestamp)
    const timeDiff = currTime - prevTime
    totalInterval += timeDiff
  }
  
  return totalInterval / (userMessages.length - 1) / 60000 // 转换为分钟
}