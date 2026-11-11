import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type ApiErrorCode } from "@netforge/contracts";

/**
 * Argon2id natif de Node (crypto.argon2, OpenSSL 3.2+), paramètres de la
 * fiche OWASP « Password Storage » (consultée le 2026-11-11) : m = 19 Mio,
 * t = 2, p = 1. Empreinte au format PHC : les paramètres d'origine restent
 * lisibles si on les renforce plus tard.
 */
export const ARGON2_PARAMETERS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

interface Argon2Settings {
  memory: number;
  passes: number;
  parallelism: number;
}

const b64 = (buffer: Buffer) => buffer.toString("base64").replace(/=+$/, "");

function derive(password: string, salt: Buffer, settings: Argon2Settings, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, nonce: salt, ...settings, tagLength }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Forme canonique : NFKC (recommandation NIST SP 800-63B), appliquée au contrôle comme au hachage. */
const canonical = (password: string) => password.normalize("NFKC");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const { memory, passes, parallelism, tagLength } = ARGON2_PARAMETERS;
  const hash = await derive(canonical(password), salt, { memory, passes, parallelism }, tagLength);
  return `$argon2id$v=19$m=${String(memory)},t=${String(passes)},p=${String(parallelism)}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!match) return false;
  const [, memory, passes, parallelism, salt, hash] = match;
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await derive(canonical(password), Buffer.from(salt ?? "", "base64"), { memory: Number(memory), passes: Number(passes), parallelism: Number(parallelism) }, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const SEQUENCES = ["0123456789012345678901234567890123456789", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz", "azertyuiopqsdfghjklmwxcvbnazertyuiop", "qwertyuiopasdfghjklzxcvbnmqwertyuiop"];

/**
 * Politique de mot de passe : 12 caractères au moins, par décision du
 * propriétaire (D-050), quand OWASP et le NIST SP 800-63B-4 demandent 15 sans
 * second facteur ; l'interface recommande 15 ou plus. Jusqu'à 128 (phrases de
 * passe) ; tous caractères admis, espaces compris ; aucune règle de composition.
 * Refus des choix trivialement devinables : un seul caractère répété, suite
 * de clavier ou d'alphabet, l'adresse e-mail elle-même. La comparaison avec
 * des listes de mots de passe divulgués (service externe) n'est pas faite.
 */
export function checkPasswordPolicy(password: string, emailKey: string): ApiErrorCode | null {
  const value = canonical(password);
  // Longueur en points de code Unicode (une lettre accentuée compte pour un caractère).
  const length = Array.from(value).length;
  if (length < PASSWORD_MIN_LENGTH) return "auth.password-too-short";
  if (length > PASSWORD_MAX_LENGTH) return "auth.password-too-long";
  const lower = value.toLowerCase();
  const local = emailKey.slice(0, emailKey.lastIndexOf("@"));
  if (/^(.)\1*$/su.test(value)) return "auth.password-weak";
  if (lower === emailKey || lower.replace(/\s+/g, "") === local) return "auth.password-weak";
  if (SEQUENCES.some((sequence) => sequence.includes(lower))) return "auth.password-weak";
  return null;
}
