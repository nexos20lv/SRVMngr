import type { SrvApi } from '../shared/api'

declare global {
  interface Window {
    srv: SrvApi
  }
}

export {}
