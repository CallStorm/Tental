/** App chrome is light-only; dark / system modes are removed. */
export function applyTheme() {
  const root = document.documentElement
  root.classList.remove('dark')
  root.classList.add('light')
}
