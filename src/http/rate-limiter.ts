/**
 * Serializa el acceso a la red: un máximo de peticiones en vuelo y un hueco
 * mínimo entre salidas, para no golpear la tienda a ráfagas.
 */

export interface RateLimiter {
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createRateLimiter(options: {
  readonly minDelayMs: number
  readonly maxConcurrency: number
}): RateLimiter {
  const queue: Array<() => void> = []
  let inFlight = 0
  let nextSlotAt = 0

  const pump = (): void => {
    if (inFlight >= options.maxConcurrency) return
    const next = queue.shift()
    if (next === undefined) return
    inFlight += 1
    next()
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          // El hueco se reserva al arrancar la tarea, no al terminarla: así el
          // espaciado no depende de lo que tarde el servidor en responder.
          const now = Date.now()
          const waitMs = Math.max(0, nextSlotAt - now)
          nextSlotAt = Math.max(now, nextSlotAt) + options.minDelayMs

          void (async () => {
            try {
              if (waitMs > 0) await sleep(waitMs)
              resolve(await task())
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)))
            } finally {
              inFlight -= 1
              pump()
            }
          })()
        })
        pump()
      })
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
