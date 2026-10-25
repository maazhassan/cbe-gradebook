import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS } from '@shared/types'
import type { Api, ApiEnvelope } from '@shared/types'

// Only the named operations in API_METHODS are exposed; there is no generic invoke or SQL access.
const api = Object.fromEntries(
  API_METHODS.map((method) => [
    method,
    async (...args: unknown[]) => {
      const result = (await ipcRenderer.invoke(`api:${method}`, ...args)) as ApiEnvelope<unknown>
      if (!result.ok) throw new Error(result.error)
      return result.data
    }
  ])
) as unknown as Api

contextBridge.exposeInMainWorld('api', api)
