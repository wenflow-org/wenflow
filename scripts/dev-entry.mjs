#!/usr/bin/env node
/**
 * 跨平台开发入口：`npm run dev`。
 *
 * - Windows  → start-dev.ps1
 * - 其他系统 → start-dev.sh
 *
 * 参数原样透传，例如 `npm run dev -- --no-browser`。
 * 这样 README 里可以统一推荐 `npm run dev`，不必区分操作系统。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const passthrough = process.argv.slice(2)
const isWindows = process.platform === 'win32'

const command = isWindows ? 'powershell' : 'bash'
const script = join(root, isWindows ? 'start-dev.ps1' : 'start-dev.sh')
const args = isWindows
  ? ['-ExecutionPolicy', 'Bypass', '-File', script, ...passthrough]
  : [script, ...passthrough]

const result = spawnSync(command, args, { stdio: 'inherit', cwd: root })
process.exit(result.status ?? 1)
