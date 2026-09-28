/** SPA crawlers inherit index.html robots until JS runs. Public pages re-assert index; auth pages noindex. */

export function setRobots(content: 'index, follow' | 'noindex, nofollow') {
  let el = document.head.querySelector('meta[name="robots"]')
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', 'robots')
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}
