import { EMAIL_MAX_LENGTH } from "@netforge/contracts";

export interface NormalizedEmail {
  /** Adresse conservée pour l'envoi et l'affichage : partie locale telle que saisie, domaine en minuscules. */
  readonly email: string;
  /** Clé de comparaison unique : adresse entière en minuscules. */
  readonly key: string;
}

/**
 * Politique unique de comparaison des adresses (inscription, connexion,
 * récupération) : espaces de bord retirés, forme Unicode NFC, domaine
 * insensible à la casse, partie locale comparée sans tenir compte de la
 * casse (choix du projet : la quasi-totalité des messageries l'ignorent ; la
 * forme saisie est conservée pour l'envoi). Les points et les suffixes « + »
 * ne sont jamais retirés. Seules les adresses manifestement mal formées sont
 * refusées (OWASP : pas d'expression régulière stricte).
 */
export function normalizeEmail(raw: string): NormalizedEmail | null {
  const value = raw.normalize("NFC").trim();
  if (value.length < 3 || value.length > EMAIL_MAX_LENGTH) return null;
  if (/[\s\p{Cc}]/u.test(value)) return null;
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (local.length > 64 || local.includes("@")) return null;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  if (!/^[\p{L}\p{N}.-]+$/u.test(domain)) return null;
  const email = `${local}@${domain}`;
  return { email, key: email.toLowerCase() };
}

/** Adresse partiellement masquée pour les journaux (jamais l'adresse complète). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 ? `${email.slice(0, 1)}…@${email.slice(at + 1)}` : "…";
}
