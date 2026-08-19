import z from '@deepseek-ai/schemastery'

export interface Config {
  readonly resume?: string
  readonly agentPreset?: string
  readonly maxToolLines?: number
}

export const Config: z<Config> = z.object({
  resume: z.string(),
  agentPreset: z.string(),
  maxToolLines: z.number().min(1).max(100).default(8),
})
