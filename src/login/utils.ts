import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt } from "jose";

export interface StatePayload {
  redirect_uri: string;
  client_state: string;
  scopes: string;
}

export interface CodePayload {
  token: string;
}

function keyBytes(secret: string): Uint8Array {
  const bytes = new Uint8Array(secret.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function signState(
  payload: StatePayload,
  secret: string,
  ttlSeconds = 600,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(keyBytes(secret));
}

export async function verifyState(
  token: string,
  secret: string,
): Promise<StatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, keyBytes(secret));
    return {
      redirect_uri: payload.redirect_uri as string,
      client_state: payload.client_state as string,
      scopes: payload.scopes as string,
    };
  } catch {
    return null;
  }
}

export async function encryptCode(
  payload: CodePayload,
  secret: string,
  ttlSeconds = 300,
): Promise<string> {
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(keyBytes(secret));
}

export async function decryptCode(
  token: string,
  secret: string,
): Promise<CodePayload | null> {
  try {
    const { payload } = await jwtDecrypt(token, keyBytes(secret));
    return { token: payload.token as string };
  } catch {
    return null;
  }
}

export function pickHeaders(src: Headers, filter: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of filter) {
    const value = src.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}
