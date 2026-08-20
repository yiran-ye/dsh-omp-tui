import { describe, expect, it } from 'vitest'
import { executeHarnessCommand } from '../src/runtime/command-execution.js'

describe('Harness Slash Command 兼容分派', () => {
  it('向 rc.7 的三参数 execute 传递 AbortSignal', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const commands = {
      async execute(_agent: object, _line: string, signal: AbortSignal) {
        receivedSignal = signal
        return 'legacy'
      },
    }

    await expect(executeHarnessCommand(commands, {}, '/plan', controller.signal)).resolves.toBe('legacy')
    expect(receivedSignal).toBe(controller.signal)
  })

  it('向 rc.8 的四参数 execute 传递空图片列表和 AbortSignal', async () => {
    const controller = new AbortController()
    let receivedImages: readonly unknown[] | undefined
    let receivedSignal: AbortSignal | undefined
    const commands = {
      async execute(_agent: object, _line: string, images: readonly unknown[], signal: AbortSignal) {
        receivedImages = images
        receivedSignal = signal
        return 'current'
      },
    }

    await expect(executeHarnessCommand(commands, {}, '/plan', controller.signal)).resolves.toBe('current')
    expect(receivedImages).toEqual([])
    expect(receivedSignal).toBe(controller.signal)
  })
})
