import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { allowedBrowserOrigins, appOrigin, CLOUD_ORIGIN, SELF_HOST_DEFAULT_ORIGIN } from '../appOrigin.ts'

const env = (vars: Record<string, string>) => ({ get: (name: string) => vars[name] })

Deno.test('cloud: app origin is rankdelta.ai and CORS keeps the cloud domains', () => {
  const e = env({})
  assertEquals(appOrigin(e), CLOUD_ORIGIN)
  const allowed = allowedBrowserOrigins(['https://astroseo.ai'], e)
  for (const o of ['https://rankdelta.ai', 'https://www.rankdelta.ai', 'https://astroseo.ai', 'http://localhost:5173']) {
    assert(allowed.has(o), o)
  }
  assertFalse(allowed.has(SELF_HOST_DEFAULT_ORIGIN))
})

Deno.test('self-host without APP_ORIGIN: the Docker origin works out of the box, cloud domains are not trusted', () => {
  const e = env({ SELF_HOST: 'true' })
  assertEquals(appOrigin(e), SELF_HOST_DEFAULT_ORIGIN)
  const allowed = allowedBrowserOrigins(['https://astroseo.ai'], e)
  assert(allowed.has('http://localhost:8080'))
  assertFalse(allowed.has('https://rankdelta.ai'))
  assertFalse(allowed.has('https://astroseo.ai'))
})

Deno.test('self-host with APP_ORIGIN and ALLOWED_ORIGINS: both are allowed, trailing slashes ignored', () => {
  const e = env({ SELF_HOST: 'TRUE', APP_ORIGIN: 'https://seo.agency.test/', ALLOWED_ORIGINS: ' https://staging.agency.test/ ,' })
  assertEquals(appOrigin(e), 'https://seo.agency.test')
  const allowed = allowedBrowserOrigins([], e)
  assert(allowed.has('https://seo.agency.test'))
  assert(allowed.has('https://staging.agency.test'))
  assertFalse(allowed.has('http://localhost:8080'))
})
