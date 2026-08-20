import type { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

export interface ModelCatalogItem {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly name: string
  readonly description?: string
}

export interface ModelCatalog {
  readonly models: readonly ModelCatalogItem[]
  readonly failures: readonly string[]
}

export interface ModelReasoningEffort {
  readonly id: ReasoningEffortId
  readonly name: string
  readonly description?: string
}

export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: ReasoningEffortId
}

export interface ModelCatalogPort {
  list(signal: AbortSignal): Promise<ModelCatalog>
  resolveReasoning(provider: string, model: string, signal: AbortSignal): Promise<ModelReasoning | undefined>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads the live adapter catalog while preserving models from healthy providers. */
export function createModelCatalog(
  llm: Pick<LlmRuntime, 'listModels' | 'listProviders' | 'resolveModelInfo'>,
): ModelCatalogPort {
  return {
    async list(signal: AbortSignal): Promise<ModelCatalog> {
      const providers = llm.listProviders()
      const results = await Promise.all(providers.map(async (provider) => {
        try {
          const models = await llm.listModels(provider.id)
          return {
            models: models.map((model): ModelCatalogItem => ({
              provider: provider.id,
              providerName: provider.name,
              model: model.id,
              name: model.name,
              ...(model.description === undefined ? {} : { description: model.description }),
            })),
            failures: [] as readonly string[],
          }
        } catch (error) {
          return {
            models: [] as readonly ModelCatalogItem[],
            failures: [`${provider.name}（${provider.id}）：${errorMessage(error)}`],
          }
        }
      }))
      if (signal.aborted) return { models: [], failures: [] }
      return {
        models: results.flatMap((result) => result.models),
        failures: results.flatMap((result) => result.failures),
      }
    },
    async resolveReasoning(provider, model, signal): Promise<ModelReasoning | undefined> {
      const reasoning = (await llm.resolveModelInfo(provider, model, signal)).reasoning
      if (signal.aborted || reasoning === undefined) return undefined
      return {
        efforts: reasoning.efforts.map((effort) => ({
          id: effort.id,
          name: effort.name,
          ...(effort.description === undefined ? {} : { description: effort.description }),
        })),
        ...(reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
      }
    },
  }
}
