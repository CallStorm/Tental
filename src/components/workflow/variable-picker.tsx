import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { VariableOption } from '@/lib/workflow-graph'

type Props = {
  options: VariableOption[]
  onInsert: (wrapped: string) => void
  disabled?: boolean
}

export function VariablePicker({ options, onInsert, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (options.length === 0) return null

  return (
    <div className="relative inline-block" ref={rootRef}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        插入变量
      </Button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 max-h-52 w-64 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className="block w-full px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => {
                onInsert(`{{${o.value}}}`)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
