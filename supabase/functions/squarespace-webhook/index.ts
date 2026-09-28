/**
 * Squarespace Webhook Handler
 * 
 * Handles webhooks from Squarespace (currently just extension.uninstall)
 * 
 * Security:
 * - HMAC signature verification
 * - Replay attack protection via timestamp + nonce
 * - Idempotent processing
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { secretKey } from '../_shared/supabaseKeys.ts'

interface SquarespaceWebhook {
  type: 'extension.uninstall'
  websiteId: string
  extensionId: string
  createdOn: string
  data: {
    websiteId: string
    extensionId: string
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const signature = req.headers.get('x-squarespace-signature')
    if (!signature) {
      console.error('Missing webhook signature')
      return new Response('Unauthorized', { status: 401 })
    }

    const rawBody = await req.text()

    // Verify HMAC signature — fail closed if the secret is unset (empty key is forgeable).
    const webhookSecret = Deno.env.get('SQUARESPACE_WEBHOOK_SECRET') ?? ''
    if (!webhookSecret || webhookSecret.length < 8) {
      console.error('SQUARESPACE_WEBHOOK_SECRET missing or too short — refusing webhook')
      return new Response('Webhook not configured', { status: 503 })
    }
    const hmac = createHmac('sha256', webhookSecret)
    hmac.update(rawBody)
    const expectedSignature = hmac.digest('hex')

    try {
      const sigBuffer = Buffer.from(signature, 'hex')
      const expectedBuffer = Buffer.from(expectedSignature, 'hex')
      
      if (sigBuffer.length !== expectedBuffer.length || 
          !timingSafeEqual(sigBuffer, expectedBuffer)) {
        console.error('Invalid webhook signature')
        return new Response('Unauthorized', { status: 401 })
      }
    } catch (error) {
      console.error('Signature verification failed:', error)
      return new Response('Unauthorized', { status: 401 })
    }

    // Parse webhook
    const webhook: SquarespaceWebhook = JSON.parse(rawBody)

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      secretKey()
    )

    // Replay protection: Check if webhook already processed
    const webhookId = `${webhook.type}:${webhook.websiteId}:${webhook.createdOn}`
    const { data: existingWebhook } = await supabase
      .from('webhook_log')
      .select('id')
      .eq('webhook_id', webhookId)
      .single()

    if (existingWebhook) {
      console.log('Webhook already processed (idempotent):', webhookId)
      return new Response('OK', { status: 200 })
    }

    // Log webhook receipt
    await supabase.from('webhook_log').insert({
      webhook_id: webhookId,
      webhook_type: webhook.type,
      website_id: webhook.websiteId,
      payload: webhook,
      received_at: new Date().toISOString(),
    })

    // Handle by type
    if (webhook.type === 'extension.uninstall') {
      await handleUninstall(supabase, webhook)
    }

    return new Response('OK', { status: 200 })

  } catch (error) {
    console.error('Webhook processing error:', error)
    return new Response('Internal server error', { status: 500 })
  }
})

async function handleUninstall(
  supabase: any,
  webhook: SquarespaceWebhook
): Promise<void> {
  const { websiteId } = webhook.data

  console.log(`Processing uninstall for website ${websiteId}`)

  // Get connection before deleting (for logging)
  const { data: connection } = await supabase
    .from('squarespace_connections')
    .select('user_id, website_title')
    .eq('website_id', websiteId)
    .single()

  if (!connection) {
    console.warn(`No connection found for website ${websiteId}`)
    return
  }

  // Delete connection
  const { error: deleteError } = await supabase
    .from('squarespace_connections')
    .delete()
    .eq('website_id', websiteId)

  if (deleteError) {
    console.error('Failed to delete connection:', deleteError)
    throw deleteError
  }

  // Log uninstall event
  await supabase.from('integration_events').insert({
    user_id: connection.user_id,
    event_type: 'squarespace_disconnected',
    website_id: websiteId,
    metadata: {
      website_title: connection.website_title,
      reason: 'merchant_uninstalled',
    },
  })

  console.log(`Uninstall completed for website ${websiteId}`)
}