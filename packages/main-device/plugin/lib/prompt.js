import { clip, estimateTokens, shortDate } from './util.js'

/**
 * What actually reaches the model.
 *
 * The block is assembled per request: the core/important tiers always (they are the things that
 * must not be forgotten), then only the memories that fuzzy-match the current user message. Every
 * line is budgeted, so a large store costs a bounded number of tokens instead of growing the prompt.
 */

const LAYER_LABEL = { core: '核心', important: '重要', normal: '普通', faded: '淡化' }
const LAYER_ORDER = { core: 0, important: 1, normal: 2, faded: 3 }

function sortTier(a, b) {
  return LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || b.importance - a.importance || b.updatedAt - a.updatedAt
}

function lineOf(record, budget) {
  const body = record.layer === 'faded' && !record.text ? record.summary : record.summary || record.text
  return `- ${record.id} ｜${shortDate(record.createdAt)}｜${LAYER_LABEL[record.layer] ?? record.layer}｜${clip(body, budget)}`
}

/**
 * @returns {{ sections: Array<{key:string,title:string,items:Array<object>}>, text: string, tokens: number }}
 */
export function buildContext({ store, query = '', settings, now = Date.now() }) {
  const config = settings ?? store.getSettings()
  const totalChars = config.promptBudgetChars
  let used = 0
  const seen = new Set()
  const sections = []

  const coreTier = store.data.memories
    .filter((record) => record.layer === 'core' || record.layer === 'important' || record.pinned)
    .sort(sortTier)
  const coreItems = []
  for (const record of coreTier) {
    const line = lineOf(record, 200)
    const length = Array.from(line).length
    if (used + length > config.coreBudgetChars) continue
    used += length
    seen.add(record.id)
    coreItems.push({ record, line })
  }
  if (coreItems.length) {
    sections.push({
      key: 'tier',
      title: '核心与重要（永不淡化）',
      items: coreItems.map(({ record }) => ({ id: record.id, layer: record.layer, date: shortDate(record.createdAt), text: clip(record.summary || record.text, 200) })),
    })
  }

  const hits = query && query.trim()
    ? store.search(query, { limit: Math.max(1, config.relevantLimit) })
    : []
  const relevantItems = []
  let relevantUsed = 0
  for (const hit of hits) {
    if (seen.has(hit.record.id)) continue
    const line = lineOf(hit.record, 200)
    const length = Array.from(line).length
    if (relevantUsed + length > config.relevantBudgetChars) break
    if (used + length > totalChars) break
    used += length
    relevantUsed += length
    seen.add(hit.record.id)
    relevantItems.push({ hit, line })
  }
  if (relevantItems.length) {
    sections.push({
      key: 'relevant',
      title: query ? `与「${clip(query, 24)}」相关` : '相关',
      items: relevantItems.map(({ hit }) => ({
        id: hit.record.id,
        layer: hit.record.layer,
        date: shortDate(hit.record.createdAt),
        score: Math.round(hit.score * 100) / 100,
        text: clip(hit.record.summary || hit.record.text, 200),
      })),
    })
  }

  if (!sections.length) return { sections: [], text: '', tokens: 0 }

  const total = store.data.memories.length
  const header = `## 记忆星图（跨会话长期记忆 ${total} 条，以下只列重要与相关的部分）`
  const parts = [header]
  for (const section of sections) {
    parts.push(`【${section.title}】`)
    for (const item of section.key === 'tier' ? coreItems : relevantItems) parts.push(item.line)
  }
  parts.push('需要更多细节时用 memory_search 模糊检索；这里是节选，不是全部事实。用户要求记住或纠正时，用 memory_save / memory_update 落库。')
  const text = parts.join('\n')
  return { sections, text, tokens: estimateTokens(text) }
}

export function renderMemoryPrompt(options) {
  const built = buildContext(options)
  const injected = built.sections.flatMap((section) => section.items.map((item) => item.id))
  return { text: built.text, injected, tokens: built.tokens }
}
