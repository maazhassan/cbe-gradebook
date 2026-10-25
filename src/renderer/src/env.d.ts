import type { Api, MacroEvent } from '@shared/types'

declare global {
  interface Window {
    api: Api
    onMacroEvent: (listener: (event: MacroEvent) => void) => () => void
  }
}
