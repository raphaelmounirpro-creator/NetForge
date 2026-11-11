/**
 * Gabarits des courriers : version texte et version HTML sobre, identité
 * NetForge, un bouton, l'explication de l'expiration. Ni mot de passe, ni
 * donnée de projet, ni pièce jointe. Les jetons voyagent dans le fragment de
 * l'URL (#…) : jamais envoyés au serveur web, donc absents des journaux
 * d'accès et des en-têtes Referer.
 */
export interface MailParams {
  "verify-email": { token: string; ttlMinutes: number };
  "reset-password": { token: string; ttlMinutes: number };
  "password-changed": Record<string, never>;
  "already-registered": Record<string, never>;
}
export type MailKind = keyof MailParams;

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function duration(minutes: number): string {
  if (minutes % (24 * 60) === 0) return `${String(minutes / (24 * 60))} jour(s)`;
  if (minutes % 60 === 0) return `${String(minutes / 60)} heure(s)`;
  return `${String(minutes)} minutes`;
}

function layout(title: string, paragraphs: readonly string[], action: { label: string; url: string } | null): string {
  const body = paragraphs.map((paragraph) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(paragraph)}</p>`).join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#ffb34d;color:#101923;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#4a5868">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur : ${escapeHtml(action.url)}</p>`
    : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f1ea;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#15212c"><div style="max-width:560px;margin:0 auto;padding:32px 24px"><p style="margin:0 0 24px;font-weight:700;font-size:18px">NetForge</p><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}<p style="margin:32px 0 0;font-size:12px;color:#4a5868">Courrier automatique de NetForge, laboratoire réseau et fibre optique. Ne répondez pas à ce message.</p></div></body></html>`;
}

function text(title: string, paragraphs: readonly string[], action: { label: string; url: string } | null): string {
  return [`NetForge — ${title}`, "", ...paragraphs.flatMap((paragraph) => [paragraph, ""]), ...(action ? [`${action.label} : ${action.url}`, ""] : []), "Courrier automatique de NetForge. Ne répondez pas à ce message."].join("\n");
}

function build(subject: string, title: string, paragraphs: readonly string[], action: { label: string; url: string } | null): Rendered {
  return { subject, text: text(title, paragraphs, action), html: layout(title, paragraphs, action) };
}

export function renderMail<K extends MailKind>(kind: K, params: MailParams[K], appOrigin: string): Rendered {
  switch (kind) {
    case "verify-email": {
      const { token, ttlMinutes } = params as MailParams["verify-email"];
      return build(
        "NetForge : confirmez votre adresse e-mail",
        "Confirmez votre adresse e-mail",
        [
          "Une inscription à NetForge a été demandée avec cette adresse.",
          `Pour activer le compte, ouvrez le lien ci-dessous puis confirmez avec le mot de passe choisi à l'inscription. Le lien est valable ${duration(ttlMinutes)} et ne sert qu'une fois.`,
          "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera activé sans vous.",
        ],
        { label: "Confirmer mon adresse", url: `${appOrigin}/confirmer-email#t=${token}` },
      );
    }
    case "reset-password": {
      const { token, ttlMinutes } = params as MailParams["reset-password"];
      return build(
        "NetForge : réinitialisation du mot de passe",
        "Choisissez un nouveau mot de passe",
        [
          "Une réinitialisation du mot de passe de votre compte NetForge a été demandée.",
          `Le lien ci-dessous est valable ${duration(ttlMinutes)} et ne sert qu'une fois. Après le changement, toutes vos sessions ouvertes seront fermées.`,
          "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.",
        ],
        { label: "Choisir un nouveau mot de passe", url: `${appOrigin}/reinitialiser-mot-de-passe#t=${token}` },
      );
    }
    case "password-changed":
      return build(
        "NetForge : votre mot de passe a été modifié",
        "Mot de passe modifié",
        [
          "Le mot de passe de votre compte NetForge vient d'être modifié et toutes les sessions ouvertes ont été fermées.",
          "Si vous n'êtes pas à l'origine de ce changement, utilisez sans attendre « Mot de passe oublié ? » sur la page de connexion.",
        ],
        { label: "Se connecter", url: `${appOrigin}/connexion` },
      );
    case "already-registered":
      return build(
        "NetForge : un compte existe déjà avec cette adresse",
        "Un compte existe déjà",
        [
          "Une nouvelle inscription a été demandée avec cette adresse, mais un compte NetForge l'utilise déjà. Rien n'a été modifié.",
          "Si c'est vous, connectez-vous, ou utilisez « Mot de passe oublié ? » si vous ne vous souvenez plus du mot de passe.",
        ],
        { label: "Se connecter", url: `${appOrigin}/connexion` },
      );
  }
  throw new Error("type de courrier inconnu");
}
