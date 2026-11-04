// Node loader hooks: swap the two remote Deno imports for local stand-ins so the REAL function code can run under Node.
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('npm:@supabase/supabase-js')) return { url: 'data:text/javascript,export const createClient=(...a)=>globalThis.__fakeClient(...a);', shortCircuit: true };
  if (spec.startsWith('https://deno.land/x/imagescript')) return { url: 'data:text/javascript,' + encodeURIComponent(`export class Image{static RESIZE_AUTO=-1;width=100;height=100;static async decode(b){if(globalThis.__decodeFail)throw new Error('bad');return new Image()}resize(){return this}async encodeJPEG(){return new Uint8Array([0xff,0xd8,0xff,0xe0,1,2,3])}}`), shortCircuit: true };
  return next(spec, ctx);
}
