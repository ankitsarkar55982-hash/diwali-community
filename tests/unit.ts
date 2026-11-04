import { validateTicket, newToken, safeEqual, TICKET_NO } from '../supabase/functions/_shared/ticket.ts';
import { corsFor } from '../supabase/functions/_shared/cors.ts';
import { sniff } from '../supabase/functions/_shared/image.ts';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
let fails = 0; const t = (n: string, c: boolean) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const root0 = new URL('..', import.meta.url).pathname;
// --- repository layout ---
const walk = (dir: string, rel = ''): { files: string[]; empty: string[] } => { const o = { files: [] as string[], empty: [] as string[] }; const es = readdirSync(dir, { withFileTypes: true }); if (!es.length && rel) o.empty.push(rel); for (const e of es) { const p = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { const s = walk(dir + '/' + e.name, p); o.files.push(...s.files); o.empty.push(...s.empty); } else o.files.push(p); } return o; };
const tree = walk(root0);
const EXPECT = ['.env.example', '.gitignore', 'README.md', 'backend.js', 'config.js', 'index.html', 'supabase/config.toml',
  'supabase/migrations/20261101000000_init.sql', 'supabase/migrations/20261101000100_tickets.sql', 'supabase/migrations/20261103000000_analytics.sql',
  'tests/unit.ts', 'tests/e2e.py', 'tests/responsive.py', 'tests/common.py', 'tests/functions.test.mjs', 'tests/fn_hooks.mjs',
  'supabase/functions/_shared/util.ts', 'supabase/functions/_shared/cors.ts', 'supabase/functions/_shared/image.ts', 'supabase/functions/_shared/ticket.ts',
  ...['upload-photo', 'gallery', 'report-photo', 'ticket-submit', 'ticket-status', 'track', 'admin'].map((d) => `supabase/functions/${d}/index.ts`)];
const missing = EXPECT.filter((f) => !tree.files.includes(f));
t('layout: every expected file is in its required folder' + (missing.length ? ' — MISSING/MISPLACED: ' + missing.join(', ') : ''), missing.length === 0);
const extra = tree.files.filter((f) => !EXPECT.includes(f));
t('layout: no unexpected files anywhere' + (extra.length ? ' — UNEXPECTED: ' + extra.join(', ') : ''), extra.length === 0);
t('layout: config.toml, .sql, tests are NOT in the root', !tree.files.some((f) => !f.includes('/') && /\.(toml|sql|py|ts|mjs)$/.test(f)));
t('layout: no empty placeholder folders', tree.empty.length === 0, tree.empty);
if (fails) { console.log('\nLayout is wrong, so the remaining tests were not run. Fix the folders listed above (see README: "If your repository already has files in the wrong place").'); process.exit(1); }
const ok = { name: '', email: '', category: 'gallery', title: 'Photo missing', description: 'My photo does not show up.' };
t('valid ticket, optional name/email become null', validateTicket(ok).value?.name === null && validateTicket(ok).value?.email === null);
t('bad category rejected', !!validateTicket({ ...ok, category: 'x' }).error);
t('short title rejected', !!validateTicket({ ...ok, title: 'hi' }).error);
t('short description rejected', !!validateTicket({ ...ok, description: 'short' }).error);
t('bad email rejected', !!validateTicket({ ...ok, email: 'nope' }).error);
t('good email accepted', validateTicket({ ...ok, email: 'a@b.co' }).value?.email === 'a@b.co');
t('description truncated to 2000', validateTicket({ ...ok, description: 'x'.repeat(5000) }).value?.description.length === 2000);
t('control chars stripped', validateTicket({ ...ok, title: 'ab\u0000c\u0007d' }).value?.title === 'abcd');
const a = newToken(), b = newToken();
t('tokens are unique, URL-safe, long', a !== b && /^[A-Za-z0-9_-]{30,}$/.test(a));
t('safeEqual works', safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'ab'));
t('ticket id format', TICKET_NO.test('DIWALI-2026-0001') && !TICKET_NO.test('DIWALI-26-1') && !TICKET_NO.test("DIWALI-2026-0001'; drop"));

// --- CORS ---
const A = 'https://a.example.com,https://b.vercel.app/';
t('cors: unset env allows *', corsFor('https://x.com', undefined)['Access-Control-Allow-Origin'] === '*');
t('cors: listed origin echoed', corsFor('https://a.example.com', A)['Access-Control-Allow-Origin'] === 'https://a.example.com');
t('cors: trailing slash in env list tolerated', corsFor('https://b.vercel.app', A)['Access-Control-Allow-Origin'] === 'https://b.vercel.app');
t('cors: unlisted origin gets no Allow-Origin', corsFor('https://evil.com', A)['Access-Control-Allow-Origin'] === undefined);
t('cors: Vary: Origin always set', corsFor(null, A)['Vary'] === 'Origin');
t('cors: headers allow apikey + authorization', /apikey/.test(corsFor(null, A)['Access-Control-Allow-Headers']) && /authorization/.test(corsFor(null, A)['Access-Control-Allow-Headers']));
// --- image sniffing (same rule for photos and ticket screenshots) ---
t('sniff: jpeg', sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === 'jpeg');
t('sniff: png', sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])) === 'png');
t('sniff: raw WebP/GIF/text rejected server-side (browser converts WebP first)', sniff(new TextEncoder().encode('RIFF....WEBP')) === null && sniff(new TextEncoder().encode('GIF89a')) === null && sniff(new TextEncoder().encode('<script>')) === null);
// --- project configuration checks ---
const root = new URL('..', import.meta.url).pathname;
const fnDirs = readdirSync(root + 'supabase/functions').filter((d) => d !== '_shared');
const cfg = readFileSync(root + 'supabase/config.toml', 'utf8');
t('every function dir has index.ts and a config.toml entry', fnDirs.every((d) => existsSync(root + `supabase/functions/${d}/index.ts`) && cfg.includes(`[functions.${d}]`)), fnDirs.join(','));
t('migration files use <14-digit timestamp>_name.sql', readdirSync(root + 'supabase/migrations').every((f) => /^\d{14}_[a-z_]+\.sql$/.test(f)) && readdirSync(root + 'supabase/migrations').length === 3);
const sorted = readdirSync(root + 'supabase/migrations').slice().sort();
t('migration order: init < tickets < analytics', /init/.test(sorted[0]) && /tickets/.test(sorted[1]) && /analytics/.test(sorted[2]));
const used = new Set<string>();
for (const d of [...fnDirs.map((d) => `supabase/functions/${d}/index.ts`), 'supabase/functions/_shared/util.ts']) for (const m of readFileSync(root + d, 'utf8').matchAll(/Deno\.env\.get\('([A-Z_]+)'\)/g)) used.add(m[1]);
const AUTO = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], OURS = ['IP_SALT', 'ALLOWED_ORIGIN'];
t('functions read only known env vars: ' + [...used].join(','), [...used].every((v) => AUTO.includes(v) || OURS.includes(v)));
const envEx = readFileSync(root + '.env.example', 'utf8');
t('.env.example documents every variable you must set', OURS.every((v) => new RegExp('^' + v + '=', 'm').test(envEx)));
t('.env.example holds no real secrets', !/eyJ|sk_|service_role_key\s*=/i.test(envEx.replace(/#.*$/gm, '')));
const fe = ['index.html', 'backend.js', 'config.js'].map((f) => readFileSync(root + f, 'utf8')).join('\n');
t('no service-role key or secrets in frontend files', !/service_role|SERVICE_ROLE|eyJ[A-Za-z0-9_-]{20,}/.test(fe));
t('frontend calls only existing functions', [...fe.matchAll(/call\('([a-z-]+)'|functions\/v1\/([a-z-]+)/g)].every((m) => fnDirs.includes(m[1] || m[2])));
t('greeting fields never referenced by backend.js or functions', !/#to'|#from'|#msg'|texts\(\)|shareText/.test(readFileSync(root + 'backend.js', 'utf8')) && fnDirs.every((d) => !/greeting_message|recipient|sender_name/i.test(readFileSync(root + `supabase/functions/${d}/index.ts`, 'utf8'))));
const readme = readFileSync(root + 'README.md', 'utf8');
t('README has no old migration names or multi-name deploy command', !/001_init|002_tickets/.test(readme) && !/functions deploy [a-z-]+ [a-z-]+/.test(readme));
const used2 = new Set([...fe.matchAll(/call\('([a-z-]+)'|functions\/v1\/([a-z-]+)/g)].map((m) => m[1] || m[2]));
t('layout: every function folder is used by the frontend (no placeholders)', fnDirs.every((d) => used2.has(d)), fnDirs.filter((d) => !used2.has(d)));
t('layout: every function folder is exactly one index.ts (no stubs)', fnDirs.every((d) => readdirSync(root + 'supabase/functions/' + d).join() === 'index.ts' && readFileSync(root + `supabase/functions/${d}/index.ts`, 'utf8').split('\n').length > 12));
t('README documents the real folder paths', ['supabase/config.toml', 'supabase/migrations/', 'tests/unit.ts', 'supabase/functions/'].every((p) => readme.includes(p)));
process.exit(fails ? 1 : 0);
