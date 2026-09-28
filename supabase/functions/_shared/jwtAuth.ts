import {createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {publishableKey } from './supabaseKeys.ts'
export async function userIdFromRequest(req: Request): Promise<string | null> {
const authHeader =req.headers.get('Authorization') ?? req.headers.get('authorization')
if (!authHeader) return null
const url =Deno.env.get('SUPABASE_URL') ?? ''
const anonKey =publishableKey()
if (!url || !anonKey) return null
const client =createClient(url,anonKey,{
global: {headers: {Authorization: authHeader } },
auth: {persistSession: false },
})
try {
const {data,error } =await client.auth.getUser()
if (error || !data?.user) return null
return data.user.id
} catch {
return null
}
}
