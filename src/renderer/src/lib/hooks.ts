import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data?: T
  error?: string
  loading: boolean
}

/** Charge une ressource asynchrone, avec rechargement manuel. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ loading: enabled })
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false })
      return
    }
    let alive = true
    setState((prev) => ({ ...prev, loading: true, error: undefined }))
    loaderRef.current().then(
      (data) => {
        if (alive) setState({ data, loading: false })
      },
      (err: unknown) => {
        if (alive) setState({ error: err instanceof Error ? err.message : String(err), loading: false })
      }
    )
    return () => {
      alive = false
    }
  }, [...deps, tick, enabled])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export function useInterval(callback: () => void, delay: number | null): void {
  const ref = useRef(callback)
  ref.current = callback
  useEffect(() => {
    if (delay === null) return
    const id = setInterval(() => ref.current(), delay)
    return () => clearInterval(id)
  }, [delay])
}

export const clamp = (n: number, min = 0, max = 100): number => Math.min(max, Math.max(min, n))

/** Compteur qui s'incrémente périodiquement, utile comme dépendance de rechargement. */
export function useTicker(active: boolean, ms = 5000): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return tick
}
