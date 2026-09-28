/**
 * OAuth redirect allow-list for dynamic client registration (deno).
 * Cursor registers https://www.cursor.com/… callbacks; refusing them left Cursor retrying
 * /register thousands of times a day.
 */
import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isAllowedRedirect } from '../oauth.ts'

Deno.test('known client callbacks are allowed', () => {
  assert(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback'))
  assert(isAllowedRedirect('https://chatgpt.com/connector_platform_oauth_redirect'))
  assert(isAllowedRedirect('https://www.cursor.com/agents/mcp/oauth/callback'))
  assert(isAllowedRedirect('https://cursor.com/agents/mcp/oauth/callback'))
  assert(isAllowedRedirect('http://localhost:33418/callback'))
})

Deno.test('look-alikes, plain http and credentials are refused', () => {
  assertFalse(isAllowedRedirect('http://www.cursor.com/callback'))
  assertFalse(isAllowedRedirect('https://www.cursor.com.evil.example/callback'))
  assertFalse(isAllowedRedirect('https://evilcursor.com/callback'))
  assertFalse(isAllowedRedirect('https://user:pw@www.cursor.com/callback'))
  assertFalse(isAllowedRedirect('https://ray.run/callback'))
  assertFalse(isAllowedRedirect('cursor://anysphere/callback'))
})
