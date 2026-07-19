/**
 * 行级文本 diff（LCS 最长公共子序列）
 * 用于 Prompt Dry Run 候选产物与 Source 的对照展示。
 * Prompt 规模在数百行内，O(n*m) DP 可接受。
 */

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

export interface DiffResult {
  lines: DiffLine[]
  added: number
  removed: number
}

export function diffLines(oldText: string, newText: string): DiffResult {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'del', text: a[i] })
      removed++
      i++
    } else {
      lines.push({ type: 'add', text: b[j] })
      added++
      j++
    }
  }
  while (i < n) {
    lines.push({ type: 'del', text: a[i] })
    removed++
    i++
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j] })
    added++
    j++
  }

  return { lines, added, removed }
}
