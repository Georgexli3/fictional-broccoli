/**
 * SHA-256 helpers using the Web Crypto API.
 *
 * The hash of an uploaded PDF is the cache key for KV (parse cache) and the
 * KB exclusion key (so an active proposal isn't fed to itself as past-work
 * context). Computing it client-side before upload means we know the key
 * before we even talk to the server.
 */

export async function sha256OfArrayBuffer(
  buffer: ArrayBuffer,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bufferToHex(digest);
}

export async function sha256OfFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return sha256OfArrayBuffer(buffer);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}
