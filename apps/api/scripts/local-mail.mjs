// Boîte de courrier de développement (pnpm mail:local) : aucun courrier n'est envoyé.
//
// Serveur SMTP local (port 1025, sans authentification ni TLS, n'écoute que
// sur 127.0.0.1) qui capture les messages de l'API, et page de lecture sur
// http://localhost:8025 (JSON sur /messages, pour les parcours navigateur).
// Messages gardés en mémoire (200 au plus) : ils disparaissent à l'arrêt.
// Réservé au développement : à utiliser avec SMTP_URL=smtp://localhost:1025.
// Utilisable aussi comme module (parcours navigateur des comptes).

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

const MAX_MESSAGES = 200;

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function page(messages) {
  const items = messages
    .map((mail) => `<article><h2>${escape(mail.subject)}</h2><p><strong>À :</strong> ${escape(mail.to)} · ${escape(mail.receivedAt)}</p><pre>${escape(mail.text)}</pre></article>`)
    .join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Courrier local NetForge</title><meta http-equiv="refresh" content="5"><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem}article{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}pre{white-space:pre-wrap}</style></head><body><h1>Courrier local NetForge</h1><p>Messages capturés par la boîte de développement (aucun n'a été envoyé). Actualisation toutes les 5 secondes.</p>${items || "<p>Aucun message pour l'instant.</p>"}</body></html>`;
}

/** Démarre la capture ; renvoie une fonction d'arrêt. */
export async function startMailCapture({ smtpPort = 1025, httpPort = 8025, log = console.log } = {}) {
  const messages = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    size: 1024 * 1024,
    logger: false,
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((mail) => {
          messages.unshift({
            id: messages.length + 1,
            receivedAt: new Date().toISOString(),
            from: mail.from?.text ?? "",
            to: Array.isArray(mail.to) ? mail.to.map((item) => item.text).join(", ") : (mail.to?.text ?? ""),
            subject: mail.subject ?? "",
            text: mail.text ?? "",
          });
          messages.length = Math.min(messages.length, MAX_MESSAGES);
          log(`Courrier capturé : « ${mail.subject ?? ""} » → ${messages[0].to}`);
          callback();
        })
        .catch((error) => callback(error));
    },
  });
  const http = createServer((request, response) => {
    if (request.url === "/messages") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ messages }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
    response.end(page(messages));
  });
  await new Promise((resolve) => smtp.listen(smtpPort, "127.0.0.1", resolve));
  await new Promise((resolve) => http.listen(httpPort, "127.0.0.1", resolve));
  return async () => {
    await new Promise((resolve) => smtp.close(resolve));
    await new Promise((resolve) => http.close(resolve));
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const smtpPort = Number(process.env.MAIL_SMTP_PORT ?? 1025);
  const httpPort = Number(process.env.MAIL_HTTP_PORT ?? 8025);
  await startMailCapture({ smtpPort, httpPort });
  console.log(`SMTP de développement sur 127.0.0.1:${String(smtpPort)} (SMTP_URL=smtp://localhost:${String(smtpPort)})`);
  console.log(`Lecture des courriers : http://localhost:${String(httpPort)}. Ctrl+C pour arrêter.`);
}
