import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  credentialsRequestSchema,
  emailRequestSchema,
  tokenPasswordRequestSchema,
  type AcceptedResponse,
  type CsrfResponse,
  type DoneResponse,
  type SessionResponse,
  type SessionState,
} from "@netforge/contracts";
import type { Request, Response } from "express";
import { parseBody } from "../common/api-error.js";
import type { User } from "../generated/prisma/client.js";
import { CsrfService } from "../security/csrf.service.js";
import { AccountGuard, ClientIp, CurrentUser } from "./account.guard.js";
import { AuthService, toAccount } from "./auth.service.js";
import { SessionsService } from "./sessions.service.js";

const ACCEPTED: AcceptedResponse = { status: "accepted" };
const DONE: DoneResponse = { status: "done" };

/** Routes des comptes : validation des entrées puis délégation au service (aucune logique ici). */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly csrf: CsrfService,
  ) {}

  /** Jeton CSRF de la session ou de la pré-session (aucune modification d'état côté compte). */
  @Get("csrf")
  token(@Req() request: Request, @Res({ passthrough: true }) response: Response): CsrfResponse {
    return { csrfToken: this.csrf.issue(request, response) };
  }

  /** État de la session : compte (adresse validée, session valide) ou null ; jamais d'erreur pour un visiteur. */
  @Get("session")
  async session(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<SessionState> {
    const active = await this.sessions.resolve(request);
    return { account: active ? toAccount(active.user) : null, csrfToken: this.csrf.issue(request, response) };
  }

  @Post("register")
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() body: unknown, @ClientIp() ip: string): Promise<AcceptedResponse> {
    const { email, password } = parseBody(credentialsRequestSchema, body);
    await this.auth.register(email, password, ip);
    return ACCEPTED;
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: unknown, @ClientIp() ip: string): Promise<DoneResponse> {
    const { token, password } = parseBody(tokenPasswordRequestSchema, body);
    await this.auth.verifyEmail(token, password, ip);
    return DONE;
  }

  @Post("verify-email/restart")
  @HttpCode(HttpStatus.OK)
  async restart(@Body() body: unknown, @ClientIp() ip: string): Promise<DoneResponse> {
    const { token, password } = parseBody(tokenPasswordRequestSchema, body);
    await this.auth.restartVerification(token, password, ip);
    return DONE;
  }

  @Post("resend-verification")
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(@Body() body: unknown, @ClientIp() ip: string): Promise<AcceptedResponse> {
    await this.auth.resendVerification(parseBody(emailRequestSchema, body).email, ip);
    return ACCEPTED;
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @ClientIp() ip: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<SessionResponse> {
    const { email, password } = parseBody(credentialsRequestSchema, body);
    return this.auth.login(email, password, ip, response, { revoke: () => this.sessions.revokeRequestSession(request) });
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<DoneResponse> {
    await this.sessions.revokeCurrent(request, response);
    return DONE;
  }

  @Post("logout-all")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccountGuard)
  async logoutAll(@CurrentUser() user: User, @Res({ passthrough: true }) response: Response): Promise<DoneResponse> {
    await this.sessions.revokeAll(user.id);
    this.sessions.clear(response);
    return DONE;
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgot(@Body() body: unknown, @ClientIp() ip: string): Promise<AcceptedResponse> {
    await this.auth.forgotPassword(parseBody(emailRequestSchema, body).email, ip);
    return ACCEPTED;
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async reset(@Body() body: unknown, @ClientIp() ip: string): Promise<DoneResponse> {
    const { token, password } = parseBody(tokenPasswordRequestSchema, body);
    await this.auth.resetPassword(token, password, ip);
    return DONE;
  }
}
