import { CSRF_HEADER } from "@netforge/contracts";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { minutes } from "../common/clock.js";
import { APP_ORIGIN, Browser, expectStatus, OTHER_PASSWORD, PASSWORD, signedIn, startTestApp, type TestApp } from "../test-support/test-app.js";

/*
 * Critères de sécurité vérifiables (spécification §14.7), sur une vraie base
 * PostgreSQL, une horloge contrôlée et une boîte d'envoi de test.
 */
let test: TestApp;

beforeEach(async () => {
  test = await startTestApp();
});

afterEach(async () => {
  await test.close();
});

const code = (response: request.Response) => (response.body as { code?: string }).code;
/** Compte de la session du navigateur de test (null : aucune session valide). */
const accountOf = async (browser: Browser): Promise<unknown> => ((await browser.get("/api/auth/session")).body as { account: unknown }).account;
const sessionCookie = (response: request.Response): string | undefined =>
  ([] as string[]).concat(response.headers["set-cookie"] ?? []).find((cookie) => cookie.startsWith("nf_session=") || cookie.startsWith("__Host-nf_session="));

async function register(browser: Browser, email: string, password = PASSWORD): Promise<void> {
  expectStatus(await browser.post("/api/auth/register", { email, password }), 202);
}

describe("inscription puis connexion avant validation", () => {
  it("refuse les fonctions privées tant que l'adresse n'est pas validée", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    const login = await browser.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
    expect([login.status, code(login)]).toEqual([403, "auth.email-not-verified"]);
    expect(sessionCookie(login)).toBeUndefined();
    expect(await accountOf(browser)).toBeNull();
    expect((await browser.get("/api/projects")).status).toBe(401);
  });

  it("envoie un lien dont le jeton est dans le fragment de l'URL, avec l'origine configurée", async () => {
    await register(new Browser(test), "eleve@exemple.test");
    const [mail] = test.mail.outbox;
    expect(mail?.to).toBe("eleve@exemple.test");
    expect(mail?.text).toContain(`${APP_ORIGIN}/confirmer-email#t=`);
    expect(mail?.text).not.toContain(PASSWORD);
    expect(mail?.html).toContain("Confirmer mon adresse");
  });
});

describe("validation de l'adresse : valide, expirée, altérée, rejouée", () => {
  it("valide une seule fois, avec le mot de passe de l'inscription", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    const token = test.mail.lastToken("eleve@exemple.test");
    const wrong = await browser.post("/api/auth/verify-email", { token, password: OTHER_PASSWORD });
    expect([wrong.status, code(wrong)]).toEqual([400, "auth.password-mismatch"]);
    expectStatus(await browser.post("/api/auth/verify-email", { token, password: PASSWORD }), 200);
    const replay = await browser.post("/api/auth/verify-email", { token, password: PASSWORD });
    expect([replay.status, code(replay)]).toEqual([400, "auth.token-consumed"]);
    // Pas de connexion automatique : il faut se connecter.
    expect(await accountOf(browser)).toBeNull();
    expectStatus(await browser.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD }), 200);
  });

  it("refuse un jeton altéré ou expiré (horloge contrôlée)", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    const token = test.mail.lastToken("eleve@exemple.test");
    const altered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(code(await browser.post("/api/auth/verify-email", { token: altered, password: PASSWORD }))).toBe("auth.token-invalid");
    test.clock.advance(minutes(24 * 60 + 1));
    expect(code(await browser.post("/api/auth/verify-email", { token, password: PASSWORD }))).toBe("auth.token-expired");
  });

  it("deux consommations simultanées d'un même jeton : une seule réussit", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    const token = test.mail.lastToken("eleve@exemple.test");
    const results = await Promise.all([0, 1, 2].map(() => browser.post("/api/auth/verify-email", { token, password: PASSWORD })));
    expect(results.map((response) => response.status).sort()).toEqual([200, 400, 400]);
    expect(results.filter((response) => response.status === 400).map(code)).toEqual(["auth.token-consumed", "auth.token-consumed"]);
  });
});

describe("compte précréé par un tiers et nouvelle inscription", () => {
  it("le titulaire de l'adresse reprend la création avec ses propres identifiants ; ceux du tiers sont invalidés", async () => {
    const attacker = new Browser(test);
    await register(attacker, "victime@exemple.test", "mot de passe choisi par le tiers");
    const victim = new Browser(test);
    const token = test.mail.lastToken("victime@exemple.test");
    // La victime ne connaît pas ce mot de passe : la confirmation simple est refusée…
    expect(code(await victim.post("/api/auth/verify-email", { token, password: PASSWORD }))).toBe("auth.password-mismatch");
    // … mais la possession de l'adresse lui permet de choisir de nouveaux identifiants.
    expectStatus(await victim.post("/api/auth/verify-email/restart", { token, password: PASSWORD }), 200);
    const attackerLogin = await attacker.post("/api/auth/login", { email: "victime@exemple.test", password: "mot de passe choisi par le tiers" });
    expect([attackerLogin.status, code(attackerLogin)]).toEqual([401, "auth.invalid-credentials"]);
    expectStatus(await victim.post("/api/auth/login", { email: "victime@exemple.test", password: PASSWORD }), 200);
  });

  it("une nouvelle inscription avec une adresse existante ne remplace jamais le mot de passe", async () => {
    await signedIn(test, "eleve@exemple.test");
    test.clock.advance(minutes(2));
    const other = new Browser(test);
    const again =await other.post("/api/auth/register", { email: "ELEVE@exemple.test", password: OTHER_PASSWORD });
    expect([again.status, again.body]).toEqual([202, { status: "accepted" }]);
    expect(test.mail.outbox.at(-1)?.subject).toContain("un compte existe déjà");
    expect((await other.post("/api/auth/login", { email: "eleve@exemple.test", password: OTHER_PASSWORD })).status).toBe(401);
    expectStatus(await other.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD }), 200);
  });

  it("répond de la même façon que le compte existe ou non", async () => {
    await signedIn(test, "connu@exemple.test");
    const browser = new Browser(test);
    const known = await browser.post("/api/auth/forgot-password", { email: "connu@exemple.test" });
    const unknown = await browser.post("/api/auth/forgot-password", { email: "inconnu@exemple.test" });
    expect([known.status, known.body]).toEqual([unknown.status, unknown.body]);
    const failKnown = await browser.post("/api/auth/login", { email: "connu@exemple.test", password: OTHER_PASSWORD });
    const failUnknown = await browser.post("/api/auth/login", { email: "inconnu@exemple.test", password: OTHER_PASSWORD });
    expect([failKnown.status, failKnown.body]).toEqual([failUnknown.status, failUnknown.body]);
  });
});

describe("finalité des jetons et réinitialisation", () => {
  it("refuse un jeton de validation présenté à la réinitialisation, et inversement", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    const verifyToken = test.mail.lastToken("eleve@exemple.test");
    expect(code(await browser.post("/api/auth/reset-password", { token: verifyToken, password: OTHER_PASSWORD }))).toBe("auth.token-invalid");
    expectStatus(await browser.post("/api/auth/verify-email", { token: verifyToken, password: PASSWORD }), 200);
    test.clock.advance(minutes(2));
    expectStatus(await browser.post("/api/auth/forgot-password", { email: "eleve@exemple.test" }), 202);
    const resetToken = test.mail.lastToken("eleve@exemple.test");
    expect(code(await browser.post("/api/auth/verify-email", { token: resetToken, password: PASSWORD }))).toBe("auth.token-invalid");
  });

  it("après réinitialisation, l'ancienne session et l'ancien mot de passe sont refusés, le titulaire est prévenu", async () => {
    const browser = await signedIn(test, "eleve@exemple.test");
    expect(await accountOf(browser)).not.toBeNull();
    test.clock.advance(minutes(2));
    const visitor = new Browser(test);
    expectStatus(await visitor.post("/api/auth/forgot-password", { email: "eleve@exemple.test" }), 202);
    const token = test.mail.lastToken("eleve@exemple.test");
    expect(code(await visitor.post("/api/auth/reset-password", { token, password: "court" }))).toBe("auth.password-too-short");
    expectStatus(await visitor.post("/api/auth/reset-password", { token, password: OTHER_PASSWORD }), 200);
    expect(test.mail.outbox.at(-1)?.subject).toContain("mot de passe a été modifié");
    expect(await accountOf(browser)).toBeNull();
    expect((await visitor.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD })).status).toBe(401);
    expectStatus(await visitor.post("/api/auth/login", { email: "eleve@exemple.test", password: OTHER_PASSWORD }), 200);
    expect(code(await visitor.post("/api/auth/reset-password", { token, password: "encore une autre phrase" }))).toBe("auth.token-consumed");
  });

  it("une adresse non validée reçoit un lien de validation, pas de réinitialisation", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    test.clock.advance(minutes(2));
    expectStatus(await browser.post("/api/auth/forgot-password", { email: "eleve@exemple.test" }), 202);
    expect(test.mail.outbox.at(-1)?.subject).toContain("confirmez votre adresse");
  });
});

describe("sessions : déconnexion, expiration, révocation globale", () => {
  it("une session déconnectée est inutilisable, même en rejouant le cookie", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    expectStatus(await browser.post("/api/auth/verify-email", { token: test.mail.lastToken("eleve@exemple.test"), password: PASSWORD }), 200);
    const login = await browser.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
    const cookie = sessionCookie(login)?.split(";")[0] ?? "";
    browser.csrf = (login.body as { csrfToken: string }).csrfToken;
    expectStatus(await browser.post("/api/auth/logout"), 200);
    const replay = await request(test.app.getHttpServer()).get("/api/auth/session").set("Cookie", cookie);
    expect((replay.body as { account: unknown }).account).toBeNull();
  });

  it("« Déconnecter tous mes appareils » révoque les autres sessions", async () => {
    const laptop = await signedIn(test, "eleve@exemple.test");
    const phone = new Browser(test);
    const login = await phone.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
    phone.csrf = (login.body as { csrfToken: string }).csrfToken;
    expectStatus(await laptop.post("/api/auth/logout-all"), 200);
    expect(await accountOf(phone)).toBeNull();
    expect(await accountOf(laptop)).toBeNull();
  });

  it("expire après 60 minutes d'inactivité et 12 heures au plus, même active", async () => {
    const idle = await signedIn(test, "eleve@exemple.test");
    test.clock.advance(minutes(59));
    expect(await accountOf(idle)).not.toBeNull();
    test.clock.advance(minutes(61));
    expect(await accountOf(idle)).toBeNull();

    const active = new Browser(test);
    const login = await active.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
    expectStatus(login, 200);
    for (let elapsed = 0; elapsed < 12 * 60 - 30; elapsed += 30) {
      test.clock.advance(minutes(30));
      expect(await accountOf(active)).not.toBeNull();
    }
    test.clock.advance(minutes(31));
    expect(await accountOf(active)).toBeNull();
  });

  it("n'accepte la session que par son cookie : ni paramètre d'URL, ni en-tête Authorization", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    expectStatus(await browser.post("/api/auth/verify-email", { token: test.mail.lastToken("eleve@exemple.test"), password: PASSWORD }), 200);
    const login = await browser.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
    const secret = sessionCookie(login)?.split(";")[0]?.split("=")[1] ?? "";
    const server = test.app.getHttpServer();
    expect((await request(server).get(`/api/auth/session?session=${secret}`)).body).toMatchObject({ account: null });
    expect((await request(server).get("/api/auth/session").set("Authorization", `Bearer ${secret}`)).body).toMatchObject({ account: null });
    expect(JSON.stringify(login.body)).not.toContain(secret);
  });
});

describe("cookies de production", () => {
  it("préfixe __Host-, Secure, HttpOnly, SameSite=Lax, Path=/ et aucun Domain en HTTPS", async () => {
    await signedIn(test, "eleve@exemple.test");
    await test.close();
    test = await startTestApp({ APP_ORIGIN: "https://netforge.exemple.test" }, { reset: false });
    const server = test.app.getHttpServer();
    const csrf = await request(server).get("/api/auth/csrf");
    const presession = ([] as string[]).concat(csrf.headers["set-cookie"] ?? [])[0] ?? "";
    expect(presession).toMatch(/^__Host-nf_pre=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=7200; Secure$/);
    // Le client de test parle HTTP : le cookie Secure est renvoyé à la main, comme le ferait un navigateur en HTTPS.
    const login = await request(server)
      .post("/api/auth/login")
      .set("Cookie", presession.split(";")[0] ?? "")
      .set(CSRF_HEADER, (csrf.body as { csrfToken: string }).csrfToken)
      .set("Origin", "https://netforge.exemple.test")
      .send({ email: "eleve@exemple.test", password: PASSWORD });
    expect(login.status).toBe(200);
    const session = sessionCookie(login) ?? "";
    expect(session).toMatch(/^__Host-nf_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$/);
    expect(session).not.toMatch(/Domain=/i);
  });
});

describe("CSRF : origine étrangère ou jeton absent", () => {
  it("refuse une modification sans jeton, avec le jeton d'une autre session ou depuis une autre origine", async () => {
    const server = test.app.getHttpServer();
    const noToken = await request(server).post("/api/auth/register").send({ email: "a@exemple.test", password: PASSWORD });
    expect([noToken.status, code(noToken)]).toEqual([403, "csrf.invalid"]);

    const browser = new Browser(test);
    const other = new Browser(test);
    await other.refreshCsrf();
    const stolen = await browser.agent.post("/api/auth/register").set(CSRF_HEADER, other.csrf).send({ email: "a@exemple.test", password: PASSWORD });
    expect(code(stolen)).toBe("csrf.invalid");

    await browser.refreshCsrf();
    const foreign = await browser.agent.post("/api/auth/register").set(CSRF_HEADER, browser.csrf).set("Origin", "https://site-malveillant.exemple").send({ email: "a@exemple.test", password: PASSWORD });
    expect(code(foreign)).toBe("csrf.invalid");
    const crossSite = await browser.agent.post("/api/auth/register").set(CSRF_HEADER, browser.csrf).set("Sec-Fetch-Site", "cross-site").send({ email: "a@exemple.test", password: PASSWORD });
    expect(code(crossSite)).toBe("csrf.invalid");
    expect(test.mail.outbox).toHaveLength(0);
  });

  it("renouvelle le jeton à la connexion : celui de la pré-session ne vaut plus", async () => {
    const browser = await signedIn(test, "eleve@exemple.test");
    const fresh = new Browser(test);
    await fresh.refreshCsrf();
    const presessionToken = fresh.csrf;
    const login = await fresh.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
    fresh.csrf = presessionToken;
    expect(code(await fresh.post("/api/auth/logout-all"))).toBe("csrf.invalid");
    fresh.csrf = (login.body as { csrfToken: string }).csrfToken;
    expectStatus(await fresh.post("/api/auth/logout-all"), 200);
    expect(await accountOf(browser)).toBeNull();
  });
});

describe("limites anti-abus partagées", () => {
  it("bloque la recherche de mot de passe sans verrouillage permanent, malgré une IP transférée falsifiée", async () => {
    await signedIn(test, "eleve@exemple.test");
    const attacker = new Browser(test);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await attacker.post("/api/auth/login", { email: "eleve@exemple.test", password: `essai numero ${String(attempt)} faux` });
      expect(response.status).toBe(401);
    }
    const blocked = await attacker.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
    expect([blocked.status, code(blocked)]).toEqual([429, "auth.rate-limited"]);
    expect((blocked.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    // En-tête falsifié : sans proxy de confiance configuré, il est ignoré.
    const spoofed = await attacker.agent
      .post("/api/auth/login")
      .set(CSRF_HEADER, attacker.csrf)
      .set("X-Forwarded-For", "203.0.113.77")
      .send({ email: "eleve@exemple.test", password: PASSWORD });
    expect(spoofed.status).toBe(429);
    // Autre instance de l'API, même base : la limite persiste.
    const second = await startTestApp({}, { reset: false });
    try {
      second.clock.advance(test.clock.now().getTime() - second.clock.now().getTime());
      const other = new Browser(second);
      const elsewhere = await other.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD });
      expect(elsewhere.status).toBe(429);
    } finally {
      await second.close();
    }
  });

  it("libère le compte à la fin de la fenêtre", async () => {
    await signedIn(test, "eleve@exemple.test");
    const browser = new Browser(test);
    for (let attempt = 0; attempt < 10; attempt += 1) await browser.post("/api/auth/login", { email: "eleve@exemple.test", password: "mauvaise phrase de passe" });
    expect((await browser.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD })).status).toBe(429);
    test.clock.advance(minutes(16));
    expectStatus(await browser.post("/api/auth/login", { email: "eleve@exemple.test", password: PASSWORD }), 200);
  });

  it("borne les renvois : un courrier par minute et cinq par heure, réponses identiques", async () => {
    const browser = new Browser(test);
    await register(browser, "eleve@exemple.test");
    for (let index = 0; index < 3; index += 1) {
      const response = await browser.post("/api/auth/resend-verification", { email: "eleve@exemple.test" });
      expect([response.status, response.body]).toEqual([202, { status: "accepted" }]);
    }
    expect(test.mail.outbox).toHaveLength(1);
    for (let index = 0; index < 10; index += 1) {
      test.clock.advance(minutes(1.5));
      await browser.post("/api/auth/resend-verification", { email: "eleve@exemple.test" });
    }
    expect(test.mail.outbox).toHaveLength(5);
  });
});

describe("panne ou absence du service de courrier", () => {
  it("aucun faux succès, aucun compte créé ou activé", async () => {
    test.mail.failing = true;
    const browser = new Browser(test);
    const response = await browser.post("/api/auth/register", { email: "eleve@exemple.test", password: PASSWORD });
    expect([response.status, code(response)]).toEqual([503, "auth.mail-unavailable"]);
    expect(await test.prisma.user.count()).toBe(0);
    test.mail.available = false;
    expect(code(await browser.post("/api/auth/resend-verification", { email: "eleve@exemple.test" }))).toBe("auth.mail-unavailable");
  });
});

describe("politique de mot de passe et d'adresse", () => {
  it("refuse les mots de passe trop courts, trop longs ou trivialement devinables", async () => {
    const browser = new Browser(test);
    const attempt = async (password: string) => code(await browser.post("/api/auth/register", { email: "eleve@exemple.test", password }));
    expect(await attempt("quatorze carac")).toBe("auth.password-too-short");
    expect(await attempt("x".repeat(129))).toBe("auth.password-too-long");
    expect(await attempt("aaaaaaaaaaaaaaaaaaaa")).toBe("auth.password-weak");
    expect(await attempt("123456789012345678")).toBe("auth.password-weak");
    expect(await attempt("eleve@exemple.test")).toBe("auth.password-weak");
    expect(test.mail.outbox).toHaveLength(0);
  });

  it("compare les adresses sans tenir compte de la casse, sans retirer points ni suffixe « + »", async () => {
    const browser = new Browser(test);
    await register(browser, "  Jean.Dupont+lab@Exemple.TEST ");
    expect(test.mail.outbox[0]?.to).toBe("Jean.Dupont+lab@exemple.test");
    expectStatus(await browser.post("/api/auth/verify-email", { token: test.mail.lastToken("jean.dupont+lab@exemple.test"), password: PASSWORD }), 200);
    expectStatus(await browser.post("/api/auth/login", { email: "jean.dupont+lab@exemple.test", password: PASSWORD }), 200);
    expect((await browser.post("/api/auth/login", { email: "jeandupont@exemple.test", password: PASSWORD })).status).toBe(401);
    expect(code(await new Browser(test).post("/api/auth/register", { email: "pas-une-adresse", password: PASSWORD }))).toBe("auth.invalid-email");
  });
});
