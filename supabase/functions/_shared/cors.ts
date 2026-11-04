// Pure helper (unit-tested). ALLOWED_ORIGIN = comma-separated list of exact site origins, e.g. https://diwali.example.com,https://my-app.vercel.app
// Unset = '*' (fine for local development; set it in production).
export function corsFor(origin: string | null, allowed?: string | null): Record<string, string> {
  const base = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' };
  const list = (allowed ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (!list.length) return { ...base, 'Access-Control-Allow-Origin': '*' };
  if (origin && list.includes(origin)) return { ...base, 'Access-Control-Allow-Origin': origin };
  return base; // no Allow-Origin header: browsers block the response
}
