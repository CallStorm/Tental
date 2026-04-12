import { VariablePicker } from '@/components/workflow/variable-picker'
import type { VariableOption } from '@/lib/workflow-graph'

type JsonSchema = {
  type?: string
  properties?: Record<string, { type?: string; description?: string }>
  required?: string[]
}

function parseSchema(raw: unknown): JsonSchema | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as JsonSchema
}

type Props = {
  schema: unknown
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  variableOptions: VariableOption[]
}

export function ToolSchemaFields({ schema, values, onChange, variableOptions }: Props) {
  const s = parseSchema(schema)
  const props = s?.properties
  if (!props || typeof props !== 'object') {
    return (
      <p className="text-xs text-slate-500">
        无可用参数 schema，请使用下方「原始 JSON」。
      </p>
    )
  }
  const required = Array.isArray(s?.required) ? s.required : []
  return (
    <div className="space-y-2">
      {Object.entries(props).map(([key, meta]) => (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-slate-600 dark:text-slate-400">
              {key}
              {required.includes(key) ? <span className="text-red-500"> *</span> : null}
              {meta.description ? (
                <span className="ml-1 text-slate-400">({meta.description})</span>
              ) : null}
            </label>
            <VariablePicker
              options={variableOptions}
              onInsert={(w) => onChange({ ...values, [key]: (values[key] ?? '') + w })}
            />
          </div>
          <input
            className="w-full rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
            value={values[key] ?? ''}
            onChange={(e) => onChange({ ...values, [key]: e.target.value })}
            placeholder={meta.type === 'integer' || meta.type === 'number' ? '数字' : '文本或变量'}
          />
        </div>
      ))}
    </div>
  )
}
