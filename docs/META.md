# Connecting Facebook, Instagram and WhatsApp (Meta)

One Meta app feeds the admin's **Messenger**, with a Messages tab (Messenger, Instagram Direct and WhatsApp messages, with
replies) and a **Comments** tab (public comments on the Page's and Instagram account's posts; a comment
with a Tunisian phone number becomes a customer with a "Call back" task, and the customers team is
notified). Everything arrives at one webhook: `POST https://api.kachabiti.com/api/webhooks/meta`
(`api/src/crm/meta-webhook.controller.ts`). Without it the CRM works by hand.

## 1. Before you start

- A **Meta Business portfolio** (business.facebook.com) that owns the Facebook Page.
- The Instagram account switched to **Professional** (Business) and linked to the Page
  (Instagram → Settings → Account type; Page → Settings → Linked accounts).
- For WhatsApp: a phone number for the **WhatsApp Business Platform**. A number already used in
  the WhatsApp Business *app* must be moved (or use Meta's "coexistence" onboarding).
- **Business verification** of the portfolio (Business settings → Security centre): Meta asks
  for it before the app can go live.

## 2. Create the app

1. developers.facebook.com → My Apps → Create app → type **Business**, linked to the portfolio.
2. Add the products **Webhooks**, **Messenger**, **Instagram** (Instagram API with Facebook
   Login) and **WhatsApp**.
3. App settings → Basic: copy the **App secret** → `META_APP_SECRET`.
4. Choose any long random text as the verify token → `META_VERIFY_TOKEN`.

## 3. Connect with Facebook (Messenger, Instagram and comments)

No token to copy: an owner or admin connects the Page in Admin → Messenger → Connections. It needs, once:

1. Facebook Login for Business → Settings → Valid OAuth Redirect URIs: the site's exact address
   (`NEXT_PUBLIC_SITE_URL`) followed by `/api/admin/meta/callback`.
2. Facebook Login for Business → Configurations → Create: assets Pages and Instagram accounts, and
   the permissions below without the WhatsApp ones. A system-user token that never expires is best;
   with a user token Meta may ask to connect again after about 90 days (Connections shows the date).
   Copy its ID → `META_LOGIN_CONFIG_ID`.
3. App settings → Basic: the **App ID** → `META_APP_ID`.

Put them on the server with `META_APP_SECRET` and `META_VERIFY_TOKEN` (step 4), subscribe the webhook
(step 5; the button connects the Page itself), then click **Connect with Facebook** and choose the Page.
One Page at a time: choosing another replaces it. Its token is stored encrypted with a key made from
`AUTH_SECRET`, so changing that secret means connecting again. A connected Page wins over
`META_PAGE_ACCESS_TOKEN`, which stays as the fallback. Staff who can't connect see no button.

## 3b. Tokens by hand (WhatsApp, or without the button)

Business settings → Users → **System users** → add one (Admin) → Assign assets: the Page, the
Instagram account, the WhatsApp account (full control) → **Generate token** for the app, with:

`pages_show_list, pages_manage_metadata, pages_read_engagement, pages_read_user_content,
pages_messaging, instagram_basic, instagram_manage_comments, instagram_manage_messages,
whatsapp_business_messaging, whatsapp_business_management`

- The Page's token (from the system user's token: `GET /me/accounts`) → `META_PAGE_ACCESS_TOKEN`
- The system user's token → `WHATSAPP_TOKEN`
- WhatsApp → API setup: the number's **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`

## 4. Put them on the server

GitHub → Settings → Secrets → `PROD_ENV`, add (values quoted if they contain spaces):

```
META_APP_ID=…
META_LOGIN_CONFIG_ID=…
META_APP_SECRET=…
META_VERIFY_TOKEN=…
META_PAGE_ACCESS_TOKEN=…
WHATSAPP_TOKEN=…
WHATSAPP_PHONE_NUMBER_ID=…
```

Then Actions → Deploy → Run workflow (branch `main`). The webhook must answer before step 5.

## 5. Subscribe the webhook

App → Webhooks (and WhatsApp → Configuration), callback URL
`https://api.kachabiti.com/api/webhooks/meta`, verify token `META_VERIFY_TOKEN`, then subscribe:

| Object | Fields | Gives |
|---|---|---|
| Page | `messages`, `feed` | Messenger messages, Page post comments |
| Instagram | `messages`, `comments` | Instagram Direct, post and reel comments |
| WhatsApp Business Account | `messages` | WhatsApp messages |

Also connect the Page itself to the app (Messenger → Settings → "Add or remove Pages", or
`POST /{page-id}/subscribed_apps?subscribed_fields=messages,feed` with the Page token).

## 6. Go live

While the app is in **Development** mode, Meta only sends events from people who have a role on
the app (you, testers). To receive your customers' messages and comments:

1. App Review → request **Advanced access** for the permissions in step 3 (Meta wants a short
   screencast of the Messenger screen, and a privacy policy page on the site).
2. Switch the app to **Live**.

Test: comment "num 22 123 456" on a Page post from a tester account → it appears in Admin →
Messenger → Comments within seconds, with a customer and a "Call back" task, and the bell rings.

## Rules Meta enforces

- Replies (Messenger, Instagram) are free only within **24 hours** of the customer's last message;
  WhatsApp needs an approved **template** after that. Messenger shows Meta's refusal otherwise.
- Comments are received from the moment the webhook is on: older comments aren't imported.

## TikTok

Not connected yet. TikTok has no webhook like Meta's for an account's comments or messages:
comments need an approved **TikTok for Business** developer app and its comment API (read by
polling), and direct messages are only open to some regions through TikTok's partners. The
`social_comments` table already accepts `tiktok`: once an app is approved, a scheduled job that
inserts its comments gets the same phone detection, task and notification.

## Your own replies

Replies sent from Messenger, Instagram or Business Suite show in Admin → Messenger too: Facebook sends
them with the Page field `message_echoes`, Instagram with `messages`.

Conversations from before, and messages the webhook missed, are read from Meta 10 s after the API starts
and every 2 minutes (the 200 latest conversations per platform; 100 messages each on Messenger, 20 on
Instagram). Check shows the result or Meta's refusal. Messages over an hour old don't notify.

## Meta ads

Admin → Marketing → Meta ads shows the ad account's campaigns (spend, reach, impressions, clicks, CTR,
CPC, CPM, Meta's "conversations started") next to what the CRM saw: people who wrote after clicking an
ad (Meta's referral on the message, Page field `messaging_referrals`; Instagram sends it with the
message) and their orders within 30 days. Needs `ads_read` in the login configuration; the connecting
person's token is kept (encrypted) for it, then the ad account is chosen in Messenger → Connections.
Meta's spend is shown in the account's currency and is not booked in the accounts.

## Photos, audio, names

Photos, audio and videos of Messenger and Instagram are copied to the private bucket (Meta's links
expire). Agents send photos (their own or a product's) and voice messages; not on WhatsApp. Names and
profile photos come from Meta, which may need Advanced access to `pages_messaging` and **Business Asset
User Profile Access** (Messenger) or `instagram_manage_messages` (Instagram). Asked again every hour
while missing.

## Something doesn't arrive

Admin → Messenger → Connections → **Check the connection** asks Meta what is missing (secret,
permissions, linked Instagram account, subscriptions) and shows the events refused for a wrong
secret; **Repair the events** adds the missing subscriptions. It can't see Advanced Access.

## Post calendar

Admin → Marketing → Post calendar (`scheduled_posts`, `api/src/social/`) publishes on the connected
Page and its Instagram account. The login configuration also needs `pages_manage_posts` and
`instagram_content_publish`; connect the Page again after adding them.
