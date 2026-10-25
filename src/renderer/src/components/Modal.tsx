import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal modal-wide' : 'modal'}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  )
}

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn | null>(null)
export const useConfirm = (): ConfirmFn => {
  const fn = useContext(ConfirmCtx)
  if (!fn) throw new Error('ConfirmProvider missing')
  return fn
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null)
  const confirm = useCallback<ConfirmFn>((options) => new Promise((resolve) => setState({ options, resolve })), [])
  const finish = (value: boolean) => {
    state?.resolve(value)
    setState(null)
  }
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.options.title} onClose={() => finish(false)}>
          <p>{state.options.message}</p>
          <div className="form-actions">
            <button onClick={() => finish(false)} autoFocus>
              Cancel
            </button>
            <button className={state.options.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>
              {state.options.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  )
}
