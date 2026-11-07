import { createRoutes } from './lib/routes.js'
import { createStore } from './lib/store.js'
import { createSync } from './lib/sync.js'
import { renderMemoryPrompt } from './lib/prompt.js'
import { registerMemoryTools } from './lib/tools.js'
import { ensureDir, errorText, resolveDataDir } from './lib/util.js'

/**
 * dsh-memory-nebula — Host half.
 *
 * Owns one JSON store of long-term memories, exposes it to the model through a budgeted prompt
 * section and five tools, to the Web UI through `/memory-nebula/api/*`, and to other devices
 * through a shared folder or peer HTTP endpoints.
 */

export const inject = ['webServer', 'tools']

const logger = {
  info: (...args) => console.log('[memory-nebula]', ...args),
  warn: (...args) => console.warn('[memory-nebula]', ...args),
  error: (...args) => console.error('[memory-nebula]', ...args),
}

function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

async function resolveAccountId(ctx) {
  try {
    const account = ctx.get('deepseekAccount')
    if (!account) return null
    if (typeof account.getPlatformSession === 'function') {
      const session = await account.getPlatformSession()
      if (session && session.userId) return String(session.userId)
    }
    if (typeof account.getDeviceIdentity === 'function') {
      const identity = await account.getDeviceIdentity()
      if (identity && identity.userId) return String(identity.userId)
    }
  } catch {
    /* an unsigned or unavailable account is not an error: local memories still work */
  }
  return null
}

export async function apply(ctx, config = {}) {
  const dataDir = resolveDataDir(config)
  await ensureDir(dataDir)

  const store = createStore({ dataDir, config: { ...(config.settings ?? {}), ...config }, logger })
  await store.load()

  const accountId = await resolveAccountId(ctx)
  if (accountId) store.setAccount(accountId)

  const sync = createSync({ store, dataDir, logger })

  const latestUser = new Map()
  const touchedTurn = new Map()
  const sections = new Map()
  const attachErrors = []

  // Sessions that were already open when this plugin loaded get the block too, without a restart.
  const agentsService = ctx.get('agents')

  const promptStats = () => ({
    sections: sections.size,
    liveAgents: agentsService && typeof agentsService.list === 'function' ? agentsService.list().length : null,
    errors: attachErrors.slice(-5),
  })

  // Sections live on each agent's own context; this plugin still owns their lifetime.
  ctx.effect(() => () => {
    for (const dispose of [...sections.values()]) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        /* the agent scope is already gone */
      }
    }
    sections.clear()
  }, 'memory-nebula prompt sections')

  for (const route of createRoutes({ store, sync, config, runtime: { promptStats } })) {
    ctx.effect(() => ctx.webServer.register(route), `memory-nebula route ${route.path}`)
  }

  registerMemoryTools(ctx, { store, config })

  ctx.on('agent/inbox/claimed', (payload) => {
    if (!payload || !payload.agent) return
    latestUser.set(payload.agent.id, {
      text: messageText(payload.message),
      turn: Number(payload.turn) || 0,
    })
  })

  function attachPrompt(agent) {
    if (!agent || !agent.ctx || !agent.ctx.systemPrompt) return
    if (sections.has(agent.id)) return
    try {
      const dispose = agent.ctx.systemPrompt.section({
        name: 'memory-nebula',
        order: Number(config.promptOrder) || 58,
        interpolate: false,
        text: () => {
          const current = latestUser.get(agent.id)
          const query = current ? current.text : ''
          let built
          try {
            built = renderMemoryPrompt({ store, query, settings: store.getSettings() })
          } catch (error) {
            logger.warn(`记忆注入失败：${errorText(error)}`)
            return ''
          }
          const turn = current ? current.turn : 0
          if (built.injected.length && touchedTurn.get(agent.id) !== turn) {
            touchedTurn.set(agent.id, turn)
            for (const id of built.injected) store.touch(id)
          }
          return built.text
        },
      })
      sections.set(agent.id, dispose)
    } catch (error) {
      const message = errorText(error)
      // A section left over from an earlier plugin generation already serves this session; the
      // store is process-wide, so that section reads the same data as this one would.
      if (/already registered/.test(message)) {
        sections.set(agent.id, null)
        return
      }
      attachErrors.push({ at: Date.now(), session: agent.id, message })
      if (attachErrors.length > 10) attachErrors.shift()
      logger.warn(`记忆提示段注册失败：${message}`)
    }
  }

  ctx.on('agent/created', (payload) => attachPrompt(payload && payload.agent))

  if (agentsService && typeof agentsService.list === 'function') {
    for (const agent of agentsService.list()) attachPrompt(agent)
  }

  ctx.on('agent/disposed', (payload) => {
    const agent = payload && payload.agent
    if (!agent) return
    try {
      sections.get(agent.id)?.()
    } catch {
      /* the agent scope is already gone */
    }
    sections.delete(agent.id)
    latestUser.delete(agent.id)
    touchedTurn.delete(agent.id)
  })

  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        store.runDecay()
      } catch (error) {
        logger.warn(`记忆老化失败：${errorText(error)}`)
      }
    }, 60 * 60_000)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'memory-nebula decay timer')

  let lastSyncAt = 0
  ctx.effect(() => {
    const timer = setInterval(() => {
      const settings = store.getSettings().sync
      if (!settings.enabled) return
      const intervalMs = Math.max(1, settings.intervalMinutes) * 60_000
      if (Date.now() - lastSyncAt < intervalMs) return
      lastSyncAt = Date.now()
      void sync.run('interval').catch((error) => logger.warn(`记忆同步失败：${errorText(error)}`))
    }, 60_000)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'memory-nebula sync timer')

  ctx.effect(() => () => {
    void store.save()
  }, 'memory-nebula flush')

  logger.info(`记忆星图已就绪：${store.data.memories.length} 条记忆，数据目录 ${dataDir}`)
}
