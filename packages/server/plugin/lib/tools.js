import { clip, shortDate, timeAgo } from './util.js'

/**
 * The five memory tools. They are deliberately few and cheap: one write, three reads/edits, one
 * delete. Retrieval is fuzzy and budgeted, so a tool call returns a handful of short lines instead
 * of the whole store.
 */

const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
}

function originOf(exec) {
  const agent = exec && exec.agent
  return {
    sessionId: agent && typeof agent.id === 'string' ? agent.id : undefined,
  }
}

function compactItem(store, record, score, query) {
  return {
    id: record.id,
    layer: record.layer,
    kind: record.kind,
    date: shortDate(record.createdAt),
    when: timeAgo(record.updatedAt || record.createdAt),
    ...(typeof score === 'number' ? { score: Math.round(score * 100) / 100 } : {}),
    tags: record.tags,
    text: clip(record.summary || record.text, 220),
    ...(record.decayStage >= 3 ? { faded: true } : {}),
  }
}

export function memoryToolDefinitions({ store, config = {} }) {
  return [
    {
      name: 'memory_save',
      description:
        '把值得长期记住的东西写进记忆星图（跨会话、跨设备生效）。只记稳定的内容：用户偏好与习惯、身份背景、长期项目约定、重要决定及其理由、明确的承诺与待办；不要记寒暄、临时状态、一次性的中间过程或能从代码里读到的事实。每条自带主语和结论，不依赖当前对话上下文。importance 取 0-1，用户强调过的给 0.85 以上；pin=true 表示永不遗忘（只有用户要求「一直记住」时才用）。返回新记忆的 id。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句完整、可独立看懂的记忆内容（不超过 500 字）。' },
          tags: { type: 'array', items: { type: 'string' }, description: '1-3 个短标签，用于星图连线与检索。' },
          kind: { type: 'string', enum: ['fact', 'preference', 'event', 'task', 'person', 'insight'], description: '记忆种类，默认 fact。' },
          importance: { type: 'number', description: '重要度 0-1，默认 0.55。' },
          pin: { type: 'boolean', description: '是否置为核心记忆、永不淡化。' },
        },
        required: ['text'],
      },
      output: textOutput,
      execute: async (args, exec) => {
        const record = store.create({
          text: args?.text,
          tags: args?.tags,
          kind: args?.kind,
          importance: args?.importance,
          pinned: args?.pin === true,
          ...originOf(exec),
        })
        return JSON.stringify({
          ok: true,
          id: record.id,
          layer: record.layer,
          message: record.pinned ? '已记为核心记忆，不会随时间淡化。' : '已记住。',
        })
      },
    },
    {
      name: 'memory_search',
      description:
        '在长期记忆里做模糊检索（不是全文硬匹配）：关键词、近义词、标签、部分字词都能命中，按相关度、层级和新鲜度排序。query 用自然短句或几个关键词；layer 可限定 core/important/normal/faded（omit 表示全部）；limit 默认 6、最多 20。返回每条记忆的 id、层级、日期、相关度和摘要；要看原文再用 memory_get。没有命中不代表没有发生过，换一组词再查。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词或一句话。' },
          layer: { type: 'string', enum: ['all', 'core', 'important', 'normal', 'faded'], description: '限定层级，默认 all。' },
          limit: { type: 'integer', description: '返回条数，默认 6。' },
        },
        required: ['query'],
      },
      output: textOutput,
      execute: async (args) => {
        const query = String(args?.query ?? '').trim()
        if (!query) return JSON.stringify({ ok: false, error: 'query 不能为空' })
        const limit = Math.max(1, Math.min(20, Number(args?.limit) || 6))
        const hits = store.search(query, { limit, layer: args?.layer })
        for (const hit of hits) store.touch(hit.record.id)
        return JSON.stringify({
          ok: true,
          query,
          count: hits.length,
          items: hits.map((hit) => compactItem(store, hit.record, hit.score, query)),
        })
      },
    },
    {
      name: 'memory_get',
      description: '按 id 读一条记忆的全文和元信息（层级、标签、创建时间、访问次数、衰减阶段）。被时间淡化的记忆只有摘要，会明确标注。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'memory_search 或 memory_save 返回的记忆 id。' },
        },
        required: ['id'],
      },
      output: textOutput,
      execute: async (args) => {
        const record = store.get(args?.id)
        if (!record) return JSON.stringify({ ok: false, error: '没有这条记忆（可能已被遗忘或删除）' })
        store.touch(record.id)
        return JSON.stringify({
          ok: true,
          ...store.describe(record),
          text: record.text || null,
          summary: record.summary || null,
          faded: record.layer === 'faded',
          note: record.layer === 'faded' && !record.text ? '内容已随时间淡化，只剩要点。' : undefined,
        })
      },
    },
    {
      name: 'memory_update',
      description: '修改一条已存在的记忆：text 改内容（会重置它的老化时钟）、tags 换标签、importance 调重要度、pin 置顶或取消、layer 直接改层级。用于用户纠正、补充细节，或要求「这件事以后按新的来」。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要修改的记忆 id。' },
          text: { type: 'string', description: '新的完整内容。' },
          tags: { type: 'array', items: { type: 'string' }, description: '新的标签列表。' },
          importance: { type: 'number', description: '新的重要度 0-1。' },
          pin: { type: 'boolean', description: 'true 置为核心记忆，false 取消置顶。' },
          layer: { type: 'string', enum: ['core', 'important', 'normal', 'faded'], description: '直接指定层级。' },
        },
        required: ['id'],
      },
      output: textOutput,
      execute: async (args) => {
        const id = String(args?.id ?? '')
        const patch = {}
        for (const key of ['text', 'tags', 'importance', 'pin', 'layer']) {
          if (args && args[key] !== undefined) patch[key === 'pin' ? 'pinned' : key] = args[key]
        }
        const record = store.update(id, patch)
        if (!record) return JSON.stringify({ ok: false, error: '没有这条记忆' })
        return JSON.stringify({ ok: true, id: record.id, layer: record.layer, tags: record.tags, importance: record.importance })
      },
    },
    {
      name: 'memory_forget',
      description: '删除一条记忆，不可撤销。只在用户明确说「忘掉这个」或内容确认是错的时使用；由时间自然淡化不需要手动删除。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的记忆 id。' },
        },
        required: ['id'],
      },
      output: textOutput,
      execute: async (args) => {
        const ok = store.forget(args?.id)
        return JSON.stringify(ok ? { ok: true, message: '已删除。' } : { ok: false, error: '没有这条记忆' })
      },
    },
  ]
}

export function registerMemoryTools(ctx, deps) {
  const disposers = []
  for (const definition of memoryToolDefinitions(deps)) {
    ctx.effect(() => ctx.tools.register(definition), `memory-nebula tool ${definition.name}`)
  }
  return disposers
}
