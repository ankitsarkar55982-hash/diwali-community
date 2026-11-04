// The server accepts JPEG or PNG bytes only (decided by magic bytes, never by client MIME or file name).
// The website converts WebP to JPEG in the browser before upload, so the API contract is: JPEG/PNG in, re-encoded JPEG stored.
export function sniff(b: Uint8Array): 'jpeg' | 'png' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}
export const BAD_IMAGE = 'Unsupported image data. Please choose a JPG, PNG or WebP image on the website (WebP is converted automatically).';
