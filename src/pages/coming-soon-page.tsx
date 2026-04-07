export function ComingSoonPage({ title }: { title: string }) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-slate-600 dark:text-slate-300">
        Coming Soon. This module is under construction.
      </p>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        Coming Soon
      </span>
    </section>
  )
}
