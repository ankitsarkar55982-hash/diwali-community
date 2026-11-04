import { createClient } from 'npm:@supabase/supabase-js@2';
export const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
import { corsFor } from './cors.ts';
export const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
// Wraps every function: CORS (per-request origin check), preflight, and a safe 500 for anything unexpected.
export function serve(h: (req: Request) => Promise<Response> | Response) {
  Deno.serve(async (req) => {
    const c = corsFor(req.headers.get('origin'), Deno.env.get('ALLOWED_ORIGIN'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c });
    if (req.headers.get('origin') && !c['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed' }, 403);
    let res: Response;
    try { res = await h(req); } catch (_e) { console.error('unhandled error'); res = json({ error: 'Server error' }, 500); }
    for (const [k, v] of Object.entries(c)) res.headers.set(k, v);
    return res;
  });
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function sha(d: string | Uint8Array) {
  const buf = await crypto.subtle.digest('SHA-256', typeof d === 'string' ? new TextEncoder().encode(d) : d);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Visitor key = salted hash of IP. The raw IP is never stored.
export const visitor = (req: Request) => {
  const salt = Deno.env.get('IP_SALT');
  if (!salt || salt.length < 16) { console.error('IP_SALT is missing or shorter than 16 characters'); throw new Error('config'); } // fail closed
  return sha(((req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown') + salt);
};
export async function limited(sb: ReturnType<typeof db>, key: string, action: string, max: number, mins: number) {
  const since = new Date(Date.now() - mins * 60000).toISOString();
  const { count } = await sb.from('rate_limits').select('*', { count: 'exact', head: true }).eq('key', key).eq('action', action).gte('created_at', since);
  if ((count ?? 0) >= max) return true;
  await sb.from('rate_limits').insert({ key, action });
  if (Math.random() < 0.02) await sb.from('rate_limits').delete().lt('created_at', new Date(Date.now() - 864e5).toISOString());
  return false;
}
