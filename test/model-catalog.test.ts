import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { createModelCatalog } from '../src/runtime/model-catalog.js'

describe('模型目录', () => {
  it('保留可读取 Provider 的模型，并报告局部读取失败', async () => {
    const catalog = createModelCatalog({
      listProviders: () => [
        { id: 'deepseek', name: 'DeepSeek' },
        { id: 'broken', name: 'Broken Provider' },
      ],
      listModels: async (provider) => {
        if (provider === 'broken') throw new Error('认证失败')
        return [{
          provider,
          id: 'deepseek-chat',
          name: 'DeepSeek Chat',
          description: '通用对话模型',
        }]
      },
      resolveModelInfo: async (provider, model) => ({
        provider,
        id: model,
        name: 'DeepSeek Chat',
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('low'), name: 'low' },
            { id: ReasoningEffortId('high'), name: 'high', description: '更深入地思考' },
          ],
          defaultEffort: ReasoningEffortId('high'),
        },
      }),
    })

    await expect(catalog.list(new AbortController().signal)).resolves.toEqual({
      models: [{
        provider: 'deepseek',
        providerName: 'DeepSeek',
        model: 'deepseek-chat',
        name: 'DeepSeek Chat',
        description: '通用对话模型',
      }],
      failures: ['Broken Provider（broken）：认证失败'],
    })

    await expect(catalog.resolveReasoning(
      'deepseek',
      'deepseek-chat',
      new AbortController().signal,
    )).resolves.toEqual({
      efforts: [
        { id: 'low', name: 'low' },
        { id: 'high', name: 'high', description: '更深入地思考' },
      ],
      defaultEffort: 'high',
    })
  })
})
