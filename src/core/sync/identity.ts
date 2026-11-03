// RFC 4122 UUIDv5, kept synchronous so migrations stay inside one IndexedDB transaction.
const namespace = '657df8b8-5ae7-5ca9-84b1-55d4ae92905c';
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function uuid5(name: string, ns = namespace): string {
  const bytes = [...ns.replace(/-/g, '').matchAll(/../g)].map(match => parseInt(match[0], 16));
  bytes.push(...new TextEncoder().encode(name));
  const bitLength = bytes.length * 8; bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLength >>> (i * 8)) & 255);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const rotate = (v: number, bits: number) => (v << bits) | (v >>> (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Int32Array(80);
    for (let i = 0; i < 16; i++) w[i] = (bytes[offset + i * 4]! << 24) | (bytes[offset + i * 4 + 1]! << 16) | (bytes[offset + i * 4 + 2]! << 8) | bytes[offset + i * 4 + 3]!;
    for (let i = 16; i < 80; i++) w[i] = rotate(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const temp = (rotate(a, 5) + f + e + k + w[i]!) | 0;
      e = d; d = c; c = rotate(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const result = [h0, h1, h2, h3, h4].flatMap(v => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]).slice(0, 16);
  result[6] = (result[6]! & 15) | 80; result[8] = (result[8]! & 63) | 128;
  const hex = result.map(v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
