import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Secret aléatoire de 32 octets (256 bits), encodé en base64url (43 caractères). */
export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Empreinte SHA-256 hexadécimale d'un secret aléatoire (jamais d'un mot de passe). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacBase64Url(key: string, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("base64url");
}

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
