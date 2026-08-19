import type { LlmRuntime } from '@deepseek-ai/dsh-llm'

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

export interface ModelCatalogPort {
  list(signal: AbortSignal): Promise<ModelCatalog>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads the live adapter catalog while preserving models from healthy providers. */
export function createModelCatalog(
  llm: Pick<LlmRuntime, 'listModels' | 'listProviders'>,
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
  }
}
