// Pure validation helpers (no Deno APIs) so they can be unit-tested.
export const CATEGORIES = ['photo_upload', 'gallery', 'greeting_card', 'download_share', 'website_bug', 'other'];
export const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export function validateTicket(f: Record<string, unknown>) {
  const name = clean(f.name, 80), email = clean(f.email, 120), title = clean(f.title, 120), description = clean(f.description, 2000);
  const category = String(f.category ?? '');
  if (!CATEGORIES.includes(category)) return { error: 'Please choose a category.' };
  if (title.length < 3) return { error: 'Please enter a short title (at least 3 characters).' };
  if (description.length < 10) return { error: 'Please describe the issue (at least 10 characters).' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address does not look right.' };
  return { value: { name: name || null, email: email || null, category, title, description } };
}
export const newToken = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export const TICKET_NO = /^DIWALI-\d{4}-\d{4,}$/;
