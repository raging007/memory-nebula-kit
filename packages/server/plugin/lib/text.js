import { clip } from './util.js'

/**
 * Text side of the memory system: tokenization that works for Chinese without a dictionary
 * (Han bigrams plus latin words), extractive compression, and fuzzy relevance scoring.
 */

const HAN_RUN = /[\u3400-\u9fff]+/g
const WORD = /[a-z0-9][a-z0-9_+#.-]*/g

const STOP = new Set([
  '的', '了', '是', '在', '和', '与', '也', '就', '都', '而', '及', '或', '把', '被', '对', '里', '上', '下',
  '不', '很', '会', '要', '想', '说', '这', '那', '有', '没', '个', '一', '些', '很', '还', '又', '再', '让',
  '什么', '怎么', '这个', '那个', '可以', '需要', '如果', '因为', '所以', '但是', '我们', '你们', '他们',
  '自己', '一个', '一下', '就是', '还是', '没有', '不是', '已经', '现在', '时候', '东西', '这样', '那样',
  '以及', '的话', '然后', '而且', '或者', '不过', '其实', '应该', '可能', '比较', '觉得', '知道', '看到',
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'have', 'from', 'are', 'was', 'were', 'but',
  'not', 'they', 'will', 'would', 'can', 'could', 'should', 'about', 'into', 'than', 'then', 'them', 'its',
])

export function cleanText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

export function normalize(text) {
  return cleanText(text).toLowerCase()
}

/** Unique search tokens: latin words plus overlapping Han bigrams. */
export function rawTokens(text) {
  const out = []
  const source = normalize(text)
  if (!source) return out
  for (const match of source.matchAll(WORD)) {
    const word = match[0].replace(/[.+-]+$/, '')
    if (word.length >= 2) out.push(word)
  }
  for (const run of source.match(HAN_RUN) ?? []) {
    if (run.length === 1) out.push(run)
    else for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2))
  }
  return out
}

export function tokenSet(text) {
  const set = new Set()
  for (const token of rawTokens(text)) if (!STOP.has(token)) set.add(token)
  return set
}

export function keywords(text, limit = 6) {
  const counts = new Map()
  for (const token of rawTokens(text)) {
    if (STOP.has(token) || token.length < 2) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  const ordered = [...counts.entries()]
    .map(([token, count]) => ({ token, weight: count * (2 + Math.min(4, Array.from(token).length)) }))
    .sort((a, b) => b.weight - a.weight || a.token.localeCompare(b.token))
  const picked = []
  for (const { token } of ordered) {
    if (picked.some((kept) => kept.includes(token) || token.includes(kept))) continue
    picked.push(token)
    if (picked.length >= limit) break
  }
  return picked
}

const SENTENCE_END = /(?<=[。！？!?；;…\n])/

export function splitSentences(text) {
  return String(text ?? '')
    .split(SENTENCE_END)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Extractive compression: keep the sentences that carry decisions, numbers, names and the head,
 * in their original order, within `maxChars`. Deterministic, cheap, and good enough to degrade a
 * memory gradually instead of dropping it in one step.
 */
export function summarize(text, maxChars, terms = []) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const chars = Array.from(flat)
  if (chars.length <= maxChars) return flat
  const sentences = splitSentences(flat)
  const wanted = terms.filter(Boolean).map(normalize).filter(Boolean)
  const scored = sentences.map((sentence, index) => {
    const length = Array.from(sentence).length
    let score = 1
    if (index === 0) score += 1.6
    if (/\d/.test(sentence)) score += 0.7
    if (sentence.length <= 60) score += 0.4
    if (sentence.length > 160) score -= 0.5
    for (const term of wanted) if (normalize(sentence).includes(term)) score += 1.2
    return { sentence, index, score, length }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  const keep = []
  let used = 0
  for (const entry of scored) {
    if (used + entry.length + 1 > maxChars) continue
    keep.push(entry)
    used += entry.length + 1
    if (used >= maxChars * 0.85) break
  }
  if (!keep.length) {
    const head = Array.from(sentences[0] ?? flat)
    return `${head.slice(0, Math.max(0, maxChars - 1)).join('')}…`
  }
  keep.sort((a, b) => a.index - b.index)
  const joined = keep.map((entry) => entry.sentence).join(' ')
  return Array.from(joined).length > maxChars ? `${Array.from(joined).slice(0, maxChars - 1).join('')}…` : joined
}

/** One-line stub that survives forgetting: what it was about, plus when. */
export function makeStub(record) {
  const terms = (record.tags?.length ? record.tags : keywords(`${record.text ?? ''} ${record.summary ?? ''}`, 5))
    .map((term) => String(term).trim())
    .filter(Boolean)
  const about = terms.length ? terms.join('、') : clip(record.summary || record.text || '', 24)
  return about ? `关于「${clip(about, 40)}」（内容已随时间淡化）` : '（内容已随时间淡化）'
}

/** A window of `max` characters around the first query hit. */
export function excerpt(text, query, max = 160) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!source) return ''
  const at = query ? normalize(source).indexOf(normalize(query)) : -1
  if (at < 0) return clip(source, max)
  const chars = Array.from(source)
  const head = Array.from(source.slice(0, at)).length
  const from = Math.max(0, head - Math.floor(max / 3))
  return `${from > 0 ? '…' : ''}${chars.slice(from, from + max).join('')}`
}

const LAYER_WEIGHT = { core: 1.3, important: 1.16, normal: 1, faded: 0.38 }

/**
 * Fuzzy score of one memory against a free-text query: token overlap with partial credit for
 * latin prefixes, a phrase bonus, tag bonus, then layer, importance and freshness weighting.
 * Returns 0..1.
 */
export function scoreMemory(record, query, now = Date.now()) {
  const q = normalize(query)
  if (!q) return 0
  const queryTokens = tokenSet(query)
  if (!queryTokens.size) return q.length >= 2 ? 0.2 : 0
  const docText = normalize([
    record.text,
    record.summary,
    record.kind,
    ...(record.tags ?? []),
    ...(record.entities ?? []),
  ].filter(Boolean).join(' '))
  const docTokens = tokenSet(docText)
  let matched = 0
  let partial = 0
  for (const token of queryTokens) {
    if (docTokens.has(token)) {
      matched += 1
      continue
    }
    if (token.length >= 3 && /^[a-z0-9]/.test(token)) {
      for (const docToken of docTokens) {
        if (docToken.startsWith(token) || token.startsWith(docToken)) {
          partial += 0.7
          break
        }
      }
    }
  }
  const overlap = (matched + partial) / queryTokens.size
  let bonus = 0
  if (q.length >= 2 && docText.includes(q)) bonus += 0.45
  for (const tag of record.tags ?? []) {
    const normalized = normalize(tag)
    if (normalized && (q.includes(normalized) || normalized.includes(q))) {
      bonus += 0.18
      break
    }
  }
  const relevance = Math.min(1, overlap * 0.85 + Math.min(0.6, bonus))
  if (relevance <= 0) return 0
  const importance = typeof record.importance === 'number' ? record.importance : 0.5
  const last = Math.max(record.updatedAt ?? 0, record.lastAccessAt ?? 0, record.createdAt ?? 0)
  const ageDays = Math.max(0, (now - last) / 86_400_000)
  const freshness = Math.exp(-ageDays / 120)
  const layerWeight = LAYER_WEIGHT[record.layer] ?? 1
  const score = relevance * layerWeight * (0.72 + 0.35 * importance + 0.15 * freshness)
  return Math.max(0, Math.min(1, score))
}
