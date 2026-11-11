import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { renderMail, type MailKind, type MailParams } from "./templates.js";

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Envoi indisponible (aucun serveur configuré, ou échec après nouvel essai). */
export class MailUnavailableError extends Error {
  constructor() {
    super("Service de courrier indisponible");
    this.name = "MailUnavailableError";
  }
}

/** Transport de courrier, indépendant du fournisseur (SMTP en local comme en production). */
export abstract class MailTransport {
  abstract readonly available: boolean;
  abstract send(mail: OutgoingMail): Promise<void>;
}

/** Délais bornés : la réponse HTTP attend l'acceptation du serveur d'envoi. */
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

export class SmtpMailTransport extends MailTransport {
  readonly available = true;
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transporter = createTransport({ url: smtpUrl, ...SMTP_TIMEOUTS });
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  }
}

/** Aucun serveur configuré : les parcours de compte sont signalés indisponibles, jamais réussis. */
export class DisabledMailTransport extends MailTransport {
  readonly available = false;
  send(): Promise<void> {
    return Promise.reject(new MailUnavailableError());
  }
}

export function createMailTransport(config: AppConfig): MailTransport {
  return config.mail.smtpUrl && config.mail.from ? new SmtpMailTransport(config.mail.smtpUrl, config.mail.from) : new DisabledMailTransport();
}

/**
 * Courriers de NetForge. L'acceptation par le serveur d'envoi est attendue
 * (un nouvel essai au plus) ; elle ne garantit pas la remise en boîte de
 * réception, et l'interface ne le prétend jamais. Les liens, porteurs de
 * jetons, ne sont jamais journalisés.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger("Courrier");

  constructor(
    private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get available(): boolean {
    return this.transport.available;
  }

  async send<K extends MailKind>(kind: K, to: string, params: MailParams[K]): Promise<void> {
    if (!this.transport.available) throw new MailUnavailableError();
    const mail = { to, ...renderMail(kind, params, this.config.appOrigin) };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.transport.send(mail);
        return;
      } catch (error) {
        // Ni destinataire complet, ni lien : seulement le type de courrier et le nom de l'erreur.
        this.logger.warn(`Échec d'envoi (${kind}, essai ${String(attempt)}) : ${error instanceof Error ? error.name : "erreur"}`);
      }
    }
    throw new MailUnavailableError();
  }
}
