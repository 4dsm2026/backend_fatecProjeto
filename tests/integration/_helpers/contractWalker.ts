function localGetLinks(body: unknown, base: URL): URL[] {
  if (!body || typeof body !== 'object' || !('_links' in body)) return []
  const links = (body as { _links?: Record<string, unknown> })._links
  const entries = Object.values(links ?? {}).flatMap(value => Array.isArray(value) ? value : [value])
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const link = entry as { href?: unknown; method?: unknown }
    if (typeof link.href !== 'string' || link.href.includes('{') || (link.method && link.method !== 'GET')) return []
    const url = new URL(link.href, base)
    return url.origin === base.origin ? [url] : []
  })
}

/** Segue apenas links locais de leitura, limitando chamadas e evitando ciclos. */
export async function walkGetLinks(baseUrl: string, token: string, initial: string, limit = 12) {
  const origin = new URL(baseUrl).origin
  const queue = [new URL(initial, baseUrl)]
  const visited = new Set<string>()
  const results: Array<{ url: string; status: number }> = []
  while (queue.length && visited.size < limit) {
    const url = queue.shift()!
    if (url.origin !== origin || visited.has(url.href)) continue
    visited.add(url.href)
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' })
    results.push({ url: url.pathname + url.search, status: response.status })
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) continue
    for (const next of localGetLinks(await response.json(), url)) {
      if (!visited.has(next.href)) queue.push(next)
    }
  }
  return results
}
