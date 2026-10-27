import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { config } from '../config';

/** Gmail SMTP (GMAIL_USER, GMAIL_APP_PASSWORD), or null when e-mail isn't configured. */
export const gmail = () =>
  config.GMAIL_USER && config.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: config.GMAIL_USER, pass: config.GMAIL_APP_PASSWORD },
      })
    : null;

/**
 * Sends an account e-mail (confirmation, password reset). Without SMTP on a developer
 * machine the link is printed instead, so local sign-ups and resets still work; in
 * production it throws: an account must prove it owns its address.
 */
export async function sendAccountMail(
  to: string,
  subject: string,
  html: string,
  link: string,
) {
  const transport = gmail();
  if (!transport) {
    if (config.ENV !== 'local')
      throw new Error(
        'E-mail is not configured (GMAIL_USER, GMAIL_APP_PASSWORD).',
      );
    new Logger('Mail').log(`${subject} → ${to}: ${link}`);
    return;
  }
  await transport.sendMail({ from: config.GMAIL_USER, to, subject, html });
}
