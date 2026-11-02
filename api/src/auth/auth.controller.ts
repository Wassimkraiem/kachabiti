import { createHash, randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import type { CookieOptions, Request, Response } from 'express';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import {
  ACCESS_COOKIE,
  ACCESS_SECONDS,
  readCookie,
  REFRESH_COOKIE,
  REFRESH_SECONDS,
  signAccessToken,
} from '@shared/auth-session';
import { ApiError, Zod } from '../common/api';
import { gmail, sendAccountMail } from '../common/mail';
import { clientIp, rateLimit } from '../common/rate-limit';
import { config } from '../config';
import { Database } from '../db/database';
import type { DB } from '../db/types';
import { CurrentUserId, Public } from './decorators';

// Accounts, sessions and e-mailed links (confirm, reset), replacing Supabase Auth.
// Passwords are bcrypt like Supabase's, so the copied accounts keep their passwords.

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const BCRYPT_COST = 10;
// Compared against when the e-mail is unknown, so a miss takes as long as a wrong password.
const dummyHash = hash('not-a-real-password', BCRYPT_COST);

const MINUTE = 60_000;
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(72); // bcrypt reads at most 72 bytes
const locale = z.enum(['en', 'fr', 'ar']).default('ar');
/** Only same-site paths, as the login page allows. */
const safePath = (path: unknown) =>
  typeof path === 'string' && /^\/(?![/\\])/.test(path) ? path : '/';

const signInSchema = z.object({
  email,
  password: z.string().min(1).max(200),
  locale,
});
const signUpSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(1).max(100),
  redirect: z.string().optional(),
  locale,
});
const forgotSchema = z.object({ email, locale });
const resetSchema = z.object({ token: z.string().min(20).max(200), password });
const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});
const profileSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(50).default(''),
  country: z.string().trim().max(100).default(''),
  city: z.string().trim().max(100).default(''),
  address: z.string().trim().max(300).default(''),
});

type Locale = z.infer<typeof locale>;
const MAIL: Record<
  'confirm' | 'reset',
  Record<Locale, [string, string, string]>
> = {
  confirm: {
    en: [
      'Confirm your Kachabity account',
      'Open this link to activate your account.',
      'Activate my account',
    ],
    fr: [
      'Confirmez votre compte Kachabity',
      'Ouvrez ce lien pour activer votre compte.',
      'Activer mon compte',
    ],
    ar: [
      'تأكيد حسابك في كشابيتي',
      'افتح هذا الرابط لتفعيل حسابك.',
      'تفعيل حسابي',
    ],
  },
  reset: {
    en: [
      'Reset your Kachabity password',
      'Open this link within an hour to choose a new password.',
      'Choose a new password',
    ],
    fr: [
      'Réinitialisez votre mot de passe Kachabity',
      'Ouvrez ce lien dans l’heure pour choisir un nouveau mot de passe.',
      'Choisir un mot de passe',
    ],
    ar: [
      'إعادة تعيين كلمة المرور في كشابيتي',
      'افتح هذا الرابط خلال ساعة لاختيار كلمة مرور جديدة.',
      'اختيار كلمة مرور جديدة',
    ],
  },
};
const IGNORE: Record<Locale, string> = {
  en: "If you didn't ask for this, ignore this e-mail.",
  fr: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  ar: 'إذا لم تطلب ذلك، تجاهل هذه الرسالة.',
};

type Account = {
  id: string;
  email: string | null;
  app_metadata: unknown;
  user_metadata: unknown;
};

/** What the storefront and admin see of an account (never the hash or tokens). */
const publicUser = (user: Account) => ({
  id: user.id,
  email: user.email,
  user_metadata: (user.user_metadata ?? {}) as Record<string, unknown>,
});

const cookie = (seconds: number): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.ENV === 'production',
  path: '/',
  maxAge: seconds * 1000,
});

@Controller('auth')
@Public()
export class AuthController {
  private readonly logger = new Logger('Auth');

  constructor(private readonly db: Database) {}

  private accounts() {
    return this.db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'password_hash',
        'app_metadata',
        'user_metadata',
        'email_confirmed_at',
      ])
      .where('deleted_at', 'is', null);
  }

  private byEmail(address: string) {
    return this.accounts()
      .where((eb) => eb(eb.fn('lower', ['email']), '=', address))
      .executeTakeFirst();
  }

  /** Opens a session: a user_sessions row for the refresh token, and both cookies. */
  private async startSession(
    request: Request,
    response: Response,
    user: Account,
  ) {
    const refresh = newToken();
    await this.db.withActor(null, async (trx) => {
      await trx
        .insertInto('user_sessions')
        .values({
          user_id: user.id,
          token_hash: sha256(refresh),
          user_agent: request.headers['user-agent']?.slice(0, 300) ?? null,
          expires_at: new Date(Date.now() + REFRESH_SECONDS * 1000),
        })
        .execute();
      await trx
        .updateTable('users')
        .set({ last_sign_in_at: new Date() })
        .where('id', '=', user.id)
        .execute();
    });
    await this.setAccess(response, user);
    response.cookie(REFRESH_COOKIE, refresh, cookie(REFRESH_SECONDS));
    return publicUser(user);
  }

  private async setAccess(response: Response, user: Account) {
    const token = await signAccessToken(
      {
        id: user.id,
        email: user.email,
        app_metadata: (user.app_metadata ?? {}) as Record<string, unknown>,
      },
      config.AUTH_SECRET,
    );
    response.cookie(ACCESS_COOKIE, token, cookie(ACCESS_SECONDS));
  }

  private clearCookies(response: Response) {
    response.clearCookie(ACCESS_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  private async issueLink(
    userId: string,
    purpose: 'confirm' | 'reset',
    hours: number,
  ) {
    const token = newToken();
    await this.db.withActor(null, (trx) =>
      trx
        .insertInto('auth_tokens')
        .values({
          token_hash: sha256(token),
          user_id: userId,
          purpose,
          expires_at: new Date(Date.now() + hours * 60 * MINUTE),
        })
        .execute(),
    );
    return token;
  }

  /** Marks a link used (once, before it expires) and returns its account id. */
  private async useLink(
    trx: Kysely<DB>,
    token: string,
    purpose: 'confirm' | 'reset',
  ) {
    const row = await trx
      .updateTable('auth_tokens')
      .set({ used_at: new Date() })
      .where('token_hash', '=', sha256(token))
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .where('expires_at', '>', sql<string>`now()`)
      .returning('user_id')
      .executeTakeFirst();
    return row?.user_id ?? null;
  }

  private async mail(
    to: string,
    kind: 'confirm' | 'reset',
    lang: Locale,
    link: string,
  ) {
    const [subject, intro, button] = MAIL[kind][lang];
    const href = link.replace(/&/g, '&amp;');
    const html = `
      <div dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #333;">
        <h2 style="color: #842E1B;">${subject}</h2>
        <p style="line-height: 1.6;">${intro}</p>
        <p style="margin: 28px 0;"><a href="${href}" style="background: #842E1B; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none;">${button}</a></p>
        <p style="font-size: 12px; color: #999;">${IGNORE[lang]}</p>
      </div>`;
    await sendAccountMail(to, subject, html, link);
  }

  private async sendConfirmation(
    user: Account,
    lang: Locale,
    redirect: string,
  ) {
    const token = await this.issueLink(user.id, 'confirm', 24);
    const link = `${config.NEXT_PUBLIC_SITE_URL}/api/auth/confirm?token=${token}&redirect=${encodeURIComponent(safePath(redirect))}`;
    await this.mail(user.email!, 'confirm', lang, link);
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body(new Zod(signInSchema)) body: z.infer<typeof signInSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    rateLimit(`sign-in:${body.email}`, 10, 15 * MINUTE);
    rateLimit(`sign-in-ip:${clientIp(request)}`, 50, 15 * MINUTE);
    const user = await this.byEmail(body.email);
    const matches = await compare(
      body.password,
      user?.password_hash || (await dummyHash),
    );
    if (!user?.password_hash || !matches)
      throw new ApiError(
        'Invalid email or password.',
        400,
        'invalid_credentials',
      );
    if (!user.email_confirmed_at) {
      // A fresh link each time, so an expired one never locks the customer out.
      await this.sendConfirmation(user, body.locale, `/${body.locale}`).catch(
        (error) => this.logger.error('Confirmation e-mail failed', error),
      );
      throw new ApiError(
        'Confirm your email first.',
        400,
        'email_not_confirmed',
      );
    }
    return this.startSession(request, response, user);
  }

  /**
   * A confirmation link is e-mailed first. Only on a developer machine without SMTP are accounts
   * confirmed at once; production without SMTP refuses rather than create unverified accounts.
   */
  @Post('sign-up')
  @HttpCode(200)
  async signUp(
    @Body(new Zod(signUpSchema)) body: z.infer<typeof signUpSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    rateLimit(`sign-up:${clientIp(request)}`, 5, 60 * MINUTE);
    const confirm = !!gmail();
    if (!confirm && config.ENV !== 'local')
      throw new ApiError(
        'Sign-up is unavailable right now. Please try again later.',
        503,
        'email_unavailable',
      );
    const passwordHash = await hash(body.password, BCRYPT_COST);
    const user = await this.db
      .withActor(null, (trx) =>
        trx
          .insertInto('users')
          .values({
            email: body.email,
            password_hash: passwordHash,
            name: body.fullName,
            user_metadata: JSON.stringify({ full_name: body.fullName }),
            email_confirmed_at: confirm ? null : new Date(),
          })
          .returning(['id', 'email', 'app_metadata', 'user_metadata'])
          .executeTakeFirstOrThrow(),
      )
      .catch((error: { code?: string }) => {
        if (error?.code === '23505')
          throw new ApiError(
            'An account with this email already exists.',
            409,
            'user_already_exists',
          );
        throw error;
      });
    if (!confirm)
      return {
        user: await this.startSession(request, response, user),
        confirmation_sent: false,
      };
    await this.sendConfirmation(
      user,
      body.locale,
      body.redirect ?? `/${body.locale}`,
    );
    return { user: null, confirmation_sent: true };
  }

  /** The link in the confirmation e-mail: confirms, signs in and goes back to the shop. */
  @Get('confirm')
  async confirm(
    @Query('token') token: string | undefined,
    @Query('redirect') redirect: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const userId = token
      ? await this.db.withActor(null, async (trx) => {
          const id = await this.useLink(trx, token, 'confirm');
          if (id)
            await trx
              .updateTable('users')
              .set({
                email_confirmed_at: sql`coalesce(email_confirmed_at, now())`,
              })
              .where('id', '=', id)
              .execute();
          return id;
        })
      : null;
    const user = userId
      ? await this.accounts().where('id', '=', userId).executeTakeFirst()
      : undefined;
    if (!user) return response.redirect(302, '/auth');
    await this.startSession(request, response, user);
    response.redirect(302, safePath(redirect));
  }

  /** Always answers the same way, so it doesn't reveal which e-mails have accounts. */
  @Post('forgot')
  @HttpCode(200)
  async forgot(
    @Body(new Zod(forgotSchema)) body: z.infer<typeof forgotSchema>,
    @Req() request: Request,
  ) {
    rateLimit(`forgot-ip:${clientIp(request)}`, 10, 60 * MINUTE);
    rateLimit(`forgot:${body.email}`, 3, 60 * MINUTE);
    const user = await this.byEmail(body.email);
    if (user?.email) {
      const token = await this.issueLink(user.id, 'reset', 1);
      await this.mail(
        user.email,
        'reset',
        body.locale,
        `${config.NEXT_PUBLIC_SITE_URL}/${body.locale}/auth?mode=reset&token=${token}`,
      ).catch((error) => this.logger.error('Reset e-mail failed', error));
    }
    return { sent: true };
  }

  /** Sets the new password, signs out every other session and signs this one in. */
  @Post('reset')
  @HttpCode(200)
  async reset(
    @Body(new Zod(resetSchema)) body: z.infer<typeof resetSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    rateLimit(`reset-ip:${clientIp(request)}`, 10, 15 * MINUTE);
    const passwordHash = await hash(body.password, BCRYPT_COST);
    const userId = await this.db.withActor(null, async (trx) => {
      const id = await this.useLink(trx, body.token, 'reset');
      if (!id) return null;
      await trx
        .updateTable('users')
        // The link reached their inbox, which also proves the address.
        .set({
          password_hash: passwordHash,
          email_confirmed_at: sql`coalesce(email_confirmed_at, now())`,
        })
        .where('id', '=', id)
        .execute();
      await trx
        .updateTable('user_sessions')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute();
      return id;
    });
    const user = userId
      ? await this.accounts().where('id', '=', userId).executeTakeFirst()
      : undefined;
    if (!user)
      throw new ApiError('This reset link has expired.', 400, 'link_expired');
    return this.startSession(request, response, user);
  }

  /** A new access cookie from the refresh cookie (middleware.ts calls this when it expired). */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readCookie(request.headers.cookie, REFRESH_COOKIE);
    const session = token
      ? await this.db
          .selectFrom('user_sessions as s')
          .innerJoin('users as u', 'u.id', 's.user_id')
          .select([
            's.id as session_id',
            'u.id',
            'u.email',
            'u.app_metadata',
            'u.user_metadata',
          ])
          .where('s.token_hash', '=', sha256(token))
          .where('s.revoked_at', 'is', null)
          .where('s.expires_at', '>', sql<string>`now()`)
          .where('u.deleted_at', 'is', null)
          .executeTakeFirst()
      : undefined;
    if (!token || !session) {
      this.clearCookies(response);
      throw new ApiError('Sign in again', 401, 'session_expired');
    }
    // Sliding: a session used within 30 days stays open. Roles are re-read here.
    await this.db.withActor(null, (trx) =>
      trx
        .updateTable('user_sessions')
        .set({
          last_used_at: new Date(),
          expires_at: new Date(Date.now() + REFRESH_SECONDS * 1000),
        })
        .where('id', '=', session.session_id)
        .execute(),
    );
    await this.setAccess(response, session);
    response.cookie(REFRESH_COOKIE, token, cookie(REFRESH_SECONDS));
    return publicUser(session);
  }

  @Post('sign-out')
  @HttpCode(200)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readCookie(request.headers.cookie, REFRESH_COOKIE);
    if (token)
      await this.db.withActor(null, (trx) =>
        trx
          .updateTable('user_sessions')
          .set({ revoked_at: new Date() })
          .where('token_hash', '=', sha256(token))
          .where('revoked_at', 'is', null)
          .execute(),
      );
    this.clearCookies(response);
    return null;
  }

  /** The signed-in account, or null (not an error: the storefront asks on every page). */
  @Get('me')
  async me(@CurrentUserId() userId: string | null) {
    if (!userId) return null;
    const user = await this.accounts()
      .where('id', '=', userId)
      .executeTakeFirst();
    return user ? publicUser(user) : null;
  }

  /** Re-checks the current password, then signs out the account's other sessions. */
  @Put('password')
  async changePassword(
    @CurrentUserId() userId: string | null,
    @Body(new Zod(passwordSchema)) body: z.infer<typeof passwordSchema>,
    @Req() request: Request,
  ) {
    if (!userId) throw new ApiError('Sign in again', 401);
    rateLimit(`password:${userId}`, 10, 15 * MINUTE);
    const user = await this.accounts()
      .where('id', '=', userId)
      .executeTakeFirst();
    if (
      !user?.password_hash ||
      !(await compare(body.currentPassword, user.password_hash))
    )
      throw new ApiError(
        'The current password is wrong.',
        400,
        'invalid_credentials',
      );
    const passwordHash = await hash(body.newPassword, BCRYPT_COST);
    const current = readCookie(request.headers.cookie, REFRESH_COOKIE);
    await this.db.withActor(null, async (trx) => {
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash })
        .where('id', '=', userId)
        .execute();
      await trx
        .updateTable('user_sessions')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .where('token_hash', '!=', current ? sha256(current) : '')
        .execute();
    });
    return null;
  }

  /** The customer's own details; the name also shows on their reviews. */
  @Put('profile')
  async profile(
    @CurrentUserId() userId: string | null,
    @Body(new Zod(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    if (!userId) throw new ApiError('Sign in again', 401);
    const user = await this.db.withActor(null, (trx) =>
      trx
        .updateTable('users')
        .set({
          name: body.full_name,
          user_metadata: sql`user_metadata || ${JSON.stringify(body)}::jsonb`,
        })
        .where('id', '=', userId)
        .where('deleted_at', 'is', null)
        .returning(['id', 'email', 'app_metadata', 'user_metadata'])
        .executeTakeFirst(),
    );
    if (!user) throw new ApiError('Sign in again', 401);
    return publicUser(user);
  }
}
