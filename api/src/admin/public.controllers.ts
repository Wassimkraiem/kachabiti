import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { triggerAbandonedCartCampaign } from '@shared/abandoned-cart-email';
import { openApiSpec } from '@shared/openapi';
import { Public } from '../auth/decorators';
import { Raw } from '../common/api';
import { gmail } from '../common/mail';
import { Database } from '../db/database';

// Ports of the small routes: cart analytics, recovery e-mails, contact form, newsletter, API docs.
// Several of them never used the { success, data } wrapper, so they answer with Raw bodies as before.

const escapeHtml = (value: string | number | null | undefined) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Cart analytics (dashboard, `analytics`): ?type=abandoned&limit= or the daily series ?days=. */
@Controller('cart')
@Public()
export class CartController {
  constructor(private readonly db: Database) {}

  @Get('analytics')
  analytics(@Query() query: Record<string, string>) {
    const db = this.db as any;
    if (query.type === 'abandoned') {
      const requested = Number(query.limit || 20);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(Math.trunc(requested), 1), 100)
        : 20;
      return db
        .selectFrom('abandoned_carts')
        .selectAll()
        .orderBy('last_activity_at', 'desc')
        .limit(limit)
        .execute();
    }
    const requested = Number(query.days || 30);
    const days = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 365)
      : 30;
    return db
      .selectFrom('cart_analytics')
      .selectAll()
      .orderBy('date', 'desc')
      .limit(days)
      .execute();
  }

  @Post('send-recovery-emails')
  @HttpCode(200)
  async recoveryEmails() {
    const result = await triggerAbandonedCartCampaign();
    return new Raw({
      success: true,
      message: `Sent ${result.sent} emails, ${result.failed} failed`,
      sent: result.sent,
      failed: result.failed,
    });
  }
}

/** The storefront's contact form, sent to the shop's mailbox. */
@Controller('contact')
@Public()
export class ContactController {
  @Post()
  @HttpCode(200)
  async send(
    @Body() body: Record<string, any>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { firstName, lastName, email, phone, message, locale } = body ?? {};
    if (!firstName || !lastName || !email || !message) {
      res.status(400);
      return new Raw({ error: 'Missing required fields' });
    }
    const transport = gmail();
    if (!transport) {
      res.status(500);
      return new Raw({ error: 'Email service not configured' });
    }
    const subjects: Record<string, string> = {
      en: 'New contact message',
      fr: 'Nouveau message de contact',
      ar: 'رسالة تواصل جديدة',
    };
    const subject = subjects[locale] || subjects.en;
    // Everything here is typed by a visitor: escaped before it goes into the HTML.
    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h2>${subject}</h2>
        <p><strong>Name:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone || '-')}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>
      </div>`;
    try {
      await transport.sendMail({
        from: process.env.GMAIL_USER,
        to: process.env.CONTACT_TO_EMAIL || process.env.GMAIL_USER,
        subject,
        html,
      });
      return new Raw({ success: true });
    } catch {
      res.status(500);
      return new Raw({ error: 'Internal server error' });
    }
  }
}

@Controller('newsletter')
@Public()
export class NewsletterController {
  constructor(private readonly db: Database) {}

  @Post('subscribe')
  @HttpCode(200)
  async subscribe(
    @Body() body: Record<string, any>,
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email =
      typeof body?.email === 'string' ? body.email.toLowerCase() : '';
    if (!email.includes('@')) {
      res.status(400);
      return new Raw({ error: 'Valid email is required' });
    }
    try {
      const existing = await this.db
        .selectFrom('newsletter_subscribers')
        .select(['email', 'status'])
        .where('email', '=', email)
        .executeTakeFirst();
      if (existing?.status === 'active')
        return new Raw({
          message: 'You are already subscribed to our newsletter',
        });
      await this.db.withActor(null, async (trx) => {
        await (existing
          ? trx
              .updateTable('newsletter_subscribers')
              .set({
                status: 'active',
                subscribed_at: new Date(),
                unsubscribed_at: null,
              })
              .where('email', '=', email)
              .execute()
          : trx
              .insertInto('newsletter_subscribers')
              .values({
                email,
                status: 'active',
                ip_address: String(
                  request.headers['x-forwarded-for'] ||
                    request.headers['x-real-ip'] ||
                    '',
                ),
                user_agent: request.headers['user-agent'] || '',
                referrer: request.headers.referer || '',
              })
              .execute());
      });
    } catch {
      res.status(500);
      return new Raw({ error: 'Failed to subscribe. Please try again later.' });
    }

    const transport = gmail();
    if (transport) {
      const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://kachabity.com';
      await transport
        .sendMail({
          from: process.env.GMAIL_USER,
          to: email,
          subject: 'Welcome to Kachabity Newsletter! 🎉',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #842E1B; text-align: center;">Welcome to Kachabity! 🎉</h1>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">Thank you for subscribing to our newsletter!</p>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">You'll now receive exclusive updates on:</p>
              <ul style="font-size: 16px; color: #333; line-height: 1.8;">
                <li>New handcrafted products</li>
                <li>Special discounts and promotions</li>
                <li>Traditional Tunisian crafts stories</li>
                <li>Early access to sales</li>
              </ul>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${site}" style="background-color: #842E1B; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">Shop Now</a>
              </div>
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
              <p style="font-size: 12px; color: #999; text-align: center;">
                Not interested anymore?
                <a href="${site}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}" style="color: #842E1B;">Unsubscribe</a>
              </p>
            </div>`,
        })
        .catch(() => undefined); // the subscription stands even if the welcome e-mail fails
    }
    return new Raw({ message: 'Successfully subscribed to newsletter!' });
  }

  /** The link in every newsletter: an HTML page, not JSON. */
  @Get('unsubscribe')
  @Header('Content-Type', 'text/html')
  async unsubscribe(
    @Query('email') email: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const page = (title: string, text: string) =>
      new Raw(
        `<html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;"><h1 style="color: #842E1B;">${title}</h1><p>${text}</p></body></html>`,
      );
    if (!email) {
      res.status(400);
      return page('Invalid Request', 'No email address provided.');
    }
    try {
      await this.db.withActor(null, (trx) =>
        trx
          .updateTable('newsletter_subscribers')
          .set({ status: 'unsubscribed', unsubscribed_at: new Date() })
          .where('email', '=', email.toLowerCase())
          .execute(),
      );
    } catch {
      res.status(500);
      return page('Error', 'Failed to unsubscribe. Please try again later.');
    }
    return new Raw(`<html>
      <head><title>Unsubscribed - Kachabity</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f9f9f9; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #842E1B; margin-bottom: 20px; }
          p { color: #666; line-height: 1.6; font-size: 16px; }
          a { display: inline-block; margin-top: 20px; padding: 12px 30px; background-color: #842E1B; color: white; text-decoration: none; border-radius: 8px; }
          a:hover { background-color: #6b2516; }
        </style>
      </head>
      <body><div class="container">
        <h1>Successfully Unsubscribed 👋</h1>
        <p>You have been unsubscribed from our newsletter.</p>
        <p>We're sorry to see you go! If you change your mind, you can always resubscribe from our website.</p>
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || '/'}">Return to Kachabity</a>
      </div></body>
    </html>`);
  }
}

/** The OpenAPI spec (lib/openapi.ts) shown at /api-docs. */
@Controller('docs')
@Public()
export class DocsController {
  @Get()
  get() {
    return new Raw(openApiSpec);
  }
}
