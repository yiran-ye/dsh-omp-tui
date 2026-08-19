import type {
  AssistantTranscriptEntry,
  SessionEventLike,
  StreamBlock,
  ToolTranscriptEntry,
  TranscriptEntry,
  TuiSnapshot,
  UserTranscriptEntry,
} from './state.js'

type UnknownRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: UnknownRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function numberField(record: UnknownRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function collectContent(content: unknown): { text: string; reasoning: string } {
  if (!Array.isArray(content)) return { text: '', reasoning: '' }
  const text: string[] = []
  const reasoning: string[] = []
  for (const candidate of content) {
    if (!isRecord(candidate)) continue
    const type = stringField(candidate, 'type')
    if (type === 'text') {
      const value = stringField(candidate, 'text')
      if (value !== undefined) text.push(value)
    } else if (type === 'reasoning') {
      const value = stringField(candidate, 'text')
      if (value !== undefined) reasoning.push(value)
    } else if (type === 'tool-result') {
      const nested = collectContent(candidate.content)
      if (nested.text.length > 0) text.push(nested.text)
      if (nested.reasoning.length > 0) reasoning.push(nested.reasoning)
    } else if (type === 'image') {
      text.push('[image]')
    }
  }
  return { text: text.join('\n\n'), reasoning: reasoning.join('\n\n') }
}

function upsertTranscript(snapshot: TuiSnapshot, entry: TranscriptEntry): TuiSnapshot {
  const index = snapshot.transcript.findIndex((candidate) => candidate.key === entry.key)
  if (index === -1) return { ...snapshot, transcript: [...snapshot.transcript, entry] }
  const transcript = [...snapshot.transcript]
  transcript[index] = entry
  return { ...snapshot, transcript }
}

function userEntry(event: SessionEventLike): UserTranscriptEntry | undefined {
  if (!isRecord(event.data)) return undefined
  const content = collectContent(event.data.content)
  const source = isRecord(event.data.source) ? event.data.source : undefined
  const sourceKind = source === undefined ? undefined : stringField(source, 'kind')
  if (source === undefined || sourceKind !== 'plugin') {
    return {
      kind: 'user',
      key: `user:${event.seq}`,
      seq: event.seq,
      text: content.text,
      injected: false,
    }
  }

  const plugin = stringField(source, 'plugin') ?? 'plugin'
  const form = stringField(source, 'form')
  const summary = form === 'notice' ? stringField(source, 'summary') : undefined
  const label = [plugin, form].filter((part): part is string => part !== undefined).join(' · ')
  return {
    kind: 'user',
    key: `user:${event.seq}`,
    seq: event.seq,
    text: summary ?? `Injected context · ${label}`,
    detail: content.text,
    injected: true,
    sourceLabel: label,
  }
}

function assistantKey(turn: number, step: number): string {
  return `assistant:${turn}:${step}`
}

function updateStreamBlock(
  blocks: readonly StreamBlock[],
  index: number,
  kind: StreamBlock['kind'],
  text: string,
  replace: boolean,
): readonly StreamBlock[] {
  const blockIndex = blocks.findIndex((block) => block.index === index)
  if (blockIndex === -1) return [...blocks, { index, kind, text }].sort((left, right) => left.index - right.index)
  const previous = blocks[blockIndex]
  if (previous === undefined) return blocks
  const next = [...blocks]
  next[blockIndex] = { index, kind, text: replace ? text : `${previous.text}${text}` }
  return next
}

function projectStreamBlocks(blocks: readonly StreamBlock[]): { text: string; reasoning: string } {
  return {
    text: blocks.filter((block) => block.kind === 'text').map((block) => block.text).join('\n\n'),
    reasoning: blocks.filter((block) => block.kind === 'reasoning').map((block) => block.text).join('\n\n'),
  }
}

function reduceAssistantChunk(snapshot: TuiSnapshot, event: SessionEventLike): TuiSnapshot {
  if (!isRecord(event.data) || !isRecord(event.data.chunk)) return snapshot
  const turn = numberField(event.data, 'turn')
  const step = numberField(event.data, 'step')
  const chunk = event.data.chunk
  const chunkType = stringField(chunk, 'type')
  const blockIndex = numberField(chunk, 'index')
  if (turn === undefined || step === undefined || blockIndex === undefined) return snapshot

  const key = assistantKey(turn, step)
  const previous = snapshot.transcript.find(
    (entry): entry is AssistantTranscriptEntry => entry.kind === 'assistant' && entry.key === key,
  )
  let blocks = previous?.blocks ?? []
  if (chunkType === 'text-delta' || chunkType === 'reasoning-delta') {
    const value = stringField(chunk, 'text')
    if (value === undefined) return snapshot
    blocks = updateStreamBlock(blocks, blockIndex, chunkType === 'text-delta' ? 'text' : 'reasoning', value, false)
  } else if (chunkType === 'block-end' && isRecord(chunk.block)) {
    const blockType = stringField(chunk.block, 'type')
    const value = stringField(chunk.block, 'text')
    if ((blockType === 'text' || blockType === 'reasoning') && value !== undefined) {
      blocks = updateStreamBlock(blocks, blockIndex, blockType, value, true)
    } else {
      return snapshot
    }
  } else {
    return snapshot
  }
  const projected = projectStreamBlocks(blocks)
  return upsertTranscript(snapshot, {
    kind: 'assistant',
    key,
    seq: event.seq,
    turn,
    step,
    text: projected.text,
    reasoning: projected.reasoning,
    streaming: true,
    blocks,
  })
}

function reduceAssistantMessage(snapshot: TuiSnapshot, event: SessionEventLike): TuiSnapshot {
  if (!isRecord(event.data) || !isRecord(event.data.message)) return snapshot
  const turn = numberField(event.data, 'turn')
  const step = numberField(event.data, 'step')
  if (turn === undefined || step === undefined) return snapshot
  const projected = collectContent(event.data.message.content)
  return upsertTranscript(snapshot, {
    kind: 'assistant',
    key: assistantKey(turn, step),
    seq: event.seq,
    turn,
    step,
    text: projected.text,
    reasoning: projected.reasoning,
    streaming: false,
    blocks: [],
  })
}

function reduceToolCall(snapshot: TuiSnapshot, event: SessionEventLike): TuiSnapshot {
  if (!isRecord(event.data)) return snapshot
  const callId = stringField(event.data, 'callId')
  const name = stringField(event.data, 'name')
  const argumentsText = stringField(event.data, 'arguments')
  if (callId === undefined || name === undefined || argumentsText === undefined) return snapshot
  return upsertTranscript(snapshot, {
    kind: 'tool',
    key: `tool:${callId}`,
    seq: event.seq,
    callId,
    name,
    arguments: argumentsText,
    result: undefined,
    resultMeta: undefined,
    status: 'running',
    startedAt: event.time,
    durationMs: undefined,
  })
}

function reduceToolResult(snapshot: TuiSnapshot, event: SessionEventLike): TuiSnapshot {
  if (!isRecord(event.data) || !isRecord(event.data.message)) return snapshot
  const content = event.data.message.content
  if (!Array.isArray(content)) return snapshot
  const toolResult = content.find(
    (candidate): candidate is UnknownRecord => isRecord(candidate) && candidate.type === 'tool-result',
  )
  if (toolResult === undefined) return snapshot
  const callId = stringField(toolResult, 'toolCallId')
  if (callId === undefined) return snapshot
  const previous = snapshot.transcript.find(
    (entry): entry is ToolTranscriptEntry => entry.kind === 'tool' && entry.callId === callId,
  )
  const projected = collectContent(toolResult.content)
  const isError = toolResult.isError === true || event.data.error !== undefined
  return upsertTranscript(snapshot, {
    kind: 'tool',
    key: `tool:${callId}`,
    seq: event.seq,
    callId,
    name: previous?.name ?? 'unknown-tool',
    arguments: previous?.arguments ?? '{}',
    result: projected.text || projected.reasoning,
    resultMeta: event.data.meta,
    status: isError ? 'error' : 'success',
    startedAt: previous?.startedAt ?? event.time,
    durationMs: previous === undefined ? undefined : Math.max(0, event.time - previous.startedAt),
  })
}

function updateHarness(
  snapshot: TuiSnapshot,
  key: 'permissionPreset' | 'sandboxMode' | 'approvalPolicy' | 'agentPreset',
  value: string | undefined,
): TuiSnapshot {
  if (value === undefined) return snapshot
  return { ...snapshot, harness: { ...snapshot.harness, [key]: value } }
}

export function reduceSessionEvent(current: TuiSnapshot, event: SessionEventLike): TuiSnapshot {
  if (!Number.isInteger(event.seq) || event.seq <= current.lastSeq) return current
  let snapshot = current
  switch (event.type) {
    case 'user/message': {
      const entry = userEntry(event)
      if (entry !== undefined) snapshot = upsertTranscript(snapshot, entry)
      break
    }
    case 'assistant/chunk':
      snapshot = reduceAssistantChunk(snapshot, event)
      break
    case 'assistant/message':
      snapshot = reduceAssistantMessage(snapshot, event)
      break
    case 'tool/call':
      snapshot = reduceToolCall(snapshot, event)
      break
    case 'tool/result':
      snapshot = reduceToolResult(snapshot, event)
      break
    case 'turn/start':
      if (isRecord(event.data)) snapshot = { ...snapshot, currentTurn: numberField(event.data, 'turn') }
      break
    case 'turn/end':
      snapshot = { ...snapshot, currentTurn: undefined, currentStep: undefined }
      break
    case 'step/start':
      if (isRecord(event.data)) snapshot = { ...snapshot, currentStep: numberField(event.data, 'step') }
      break
    case 'step/end':
      snapshot = { ...snapshot, currentStep: undefined }
      break
    case 'permission/preset':
      if (isRecord(event.data)) snapshot = updateHarness(snapshot, 'permissionPreset', stringField(event.data, 'preset'))
      break
    case 'sandbox/mode':
      if (isRecord(event.data)) snapshot = updateHarness(snapshot, 'sandboxMode', stringField(event.data, 'mode'))
      break
    case 'approval/policy':
      if (isRecord(event.data)) snapshot = updateHarness(snapshot, 'approvalPolicy', stringField(event.data, 'policy'))
      break
    case 'agent-preset/selected':
      if (isRecord(event.data)) snapshot = updateHarness(snapshot, 'agentPreset', stringField(event.data, 'agentPreset'))
      break
    case 'session/end-seed':
    case 'request/header':
    case 'request/context':
    case 'todo/write':
      break
    default:
      snapshot = { ...snapshot, unknownEventCount: snapshot.unknownEventCount + 1 }
  }
  return snapshot === current ? { ...snapshot, lastSeq: event.seq } : { ...snapshot, lastSeq: event.seq }
}
