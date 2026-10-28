/**
 * Reads the shipper's dashboard on Colissimo's website (colissimodelivery.tn/expediteur), for what
 * its API doesn't give: every parcel of the account with its status, and a parcel's full history.
 * Read-only: it signs in with COLISSIMO_PORTAL_USER / COLISSIMO_PORTAL_PASSWORD, keeps the session
 * cookie in memory and parses the HTML pages. When Colissimo changes its pages, this breaks (with
 * a clear error) and nothing else does.
 */

const BASE =
  process.env.COLISSIMO_PORTAL_URL ||
  'https://colissimodelivery.tn/expediteur/';

export const portalConfigured = () =>
  !!(
    process.env.COLISSIMO_PORTAL_USER && process.env.COLISSIMO_PORTAL_PASSWORD
  );

export class PortalError extends Error {}

export interface PortalParcel {
  barcode: string;
  client: string;
  phones: string[];
  agency: string | null;
  destination_agency: string | null;
  driver: string | null;
  price: number | null;
  status: string;
  status_code: string | null;
  added_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export interface PortalParcelDetail {
  barcode: string;
  /** The "Label : value" fields of the parcel page (Client, Adresse, Téléphone, Montant…), as shown. */
  fields: { label: string; value: string }[];
  /** "Historique de modification": changes made to the parcel. */
  changes: { date: string; motif: string }[];
  /** The status history, oldest first. */
  history: {
    status: string;
    note: string | null;
    date: string;
    driver: string | null;
  }[];
}

// --- HTML helpers (the pages are simple server-rendered tables) ---

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const rowsOf = (html: string) =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) =>
      [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]),
    )
    .filter((cells) => cells.length > 0);

const blank = (value: string) =>
  value === '' || value === '—' || value === '-' ? null : value;

/** "28/10/2026 13:38" → "2026-10-28 13:38" (Tunis time, as shown), so it sorts. */
const isoDate = (value: string) => {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? ` ${m[4]}` : ''}` : blank(value);
};

/** "79,000" → 79 */
const money = (value: string) => {
  const n = Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
  return value && Number.isFinite(n) ? n : null;
};

/** Rows of the advanced search's results table (#tableColis). */
export function parseSearch(html: string): PortalParcel[] {
  if (!/name="etat"/.test(html))
    throw new PortalError(
      "Colissimo's search page has changed: the parcel list can't be read",
    );
  const start = html.indexOf('id="tableColis"');
  if (start < 0) return []; // no results
  const table = html.slice(start, html.indexOf('</table>', start));
  return rowsOf(table)
    .filter((cells) => cells.length >= 11)
    .map((cells) => ({
      barcode: text(cells[1]),
      client: text(cells[2].match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? ''),
      phones: [...cells[2].matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]),
      agency: blank(text(cells[3])),
      destination_agency: blank(text(cells[4])),
      driver: blank(text(cells[5])),
      price: money(text(cells[6])),
      status: text(cells[7]),
      status_code: cells[7].match(/etat-(\w+)/)?.[1] ?? null,
      added_at: isoDate(text(cells[8])),
      picked_up_at: isoDate(text(cells[9])),
      delivered_at: isoDate(text(cells[10])),
    }));
}

/** A parcel's page (recherche.php?code=…): its fields, changes and status history. */
export function parseParcel(
  barcode: string,
  html: string,
): PortalParcelDetail | null {
  if (!/<b>\s*Client\s*:/.test(html)) return null;
  const fields = [...html.matchAll(/<b>([^<]+?)\s*:\s*<\/b>([\s\S]*?)<\/div>/g)]
    .map((m) => ({ label: text(m[1]), value: text(m[2]) }))
    .filter((f) => !f.label.startsWith('Historique'));
  const changes = [
    ...html.matchAll(
      /class="histo-date">([\s\S]*?)<\/span>\s*<span class="histo-motif">([\s\S]*?)<\/span>/g,
    ),
  ].map((m) => ({
    date: isoDate(text(m[1])) ?? text(m[1]),
    motif: text(m[2]),
  }));
  const table = [...html.matchAll(/<table[\s\S]*?<\/table>/g)]
    .map((m) => m[0])
    .find((t) => />\s*Etat\s*</.test(t) && />\s*Livreur\s*</.test(t));
  const history = rowsOf(table ?? '')
    .filter((cells) => cells.length >= 3)
    .map((cells) => {
      const [status, ...note] = text(cells[0]).split(' | ');
      return {
        status,
        note: blank(note.join(' | ')),
        date: text(cells[1]),
        driver: blank(text(cells[2])),
      };
    });
  // Colissimo lists them in no fixed order: oldest first ("YYYY-MM-DD hh:mm:ss" sorts as text).
  history.sort((a, b) => a.date.localeCompare(b.date));
  return { barcode, fields, changes, history };
}

// --- Session ---

const jar = new Map<string, string>();
let signingIn: Promise<void> | null = null;

async function request(path: string, body?: URLSearchParams) {
  const response = await fetch(new URL(path, BASE), {
    method: body ? 'POST' : 'GET',
    body,
    redirect: 'manual',
    headers: {
      cookie: [...jar.values()].join('; '),
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  }).catch((error: Error) => {
    throw new PortalError(
      `Colissimo's website can't be reached: ${error.message}`,
    );
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    jar.set(pair.split('=')[0], pair);
  }
  return response;
}

/** A redirect to the login page, or the login form itself: the session is gone. */
const signedOut = (response: Response, html: string) =>
  (response.status >= 300 &&
    response.status < 400 &&
    /index\.php/.test(response.headers.get('location') ?? '')) ||
  /name="username"/.test(html);

async function signIn() {
  if (!portalConfigured())
    throw new PortalError(
      'Add COLISSIMO_PORTAL_USER and COLISSIMO_PORTAL_PASSWORD (your colissimodelivery.tn login) to the server environment.',
    );
  jar.clear();
  await request('index.php');
  await request(
    'index.php',
    new URLSearchParams({
      username: process.env.COLISSIMO_PORTAL_USER!,
      password: process.env.COLISSIMO_PORTAL_PASSWORD!,
    }),
  );
  const check = await request('dashboard.php');
  if (signedOut(check, await check.text())) {
    jar.clear();
    throw new PortalError(
      'Colissimo refused the login: check COLISSIMO_PORTAL_USER and COLISSIMO_PORTAL_PASSWORD',
    );
  }
}

/** A page's HTML, signing in first or again when the session has expired. */
async function page(path: string, body?: URLSearchParams) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (jar.size === 0) {
      signingIn ??= signIn().finally(() => (signingIn = null));
      await signingIn;
    }
    const response = await request(path, body);
    const html = await response.text();
    if (!signedOut(response, html)) return html;
    jar.clear();
  }
  throw new PortalError('Colissimo keeps signing this account out');
}

/** Every parcel added between the two dates (YYYY-MM-DD; Colissimo allows 2 months at most). */
export async function searchParcels(from: string, to: string) {
  return parseSearch(
    await page(
      'recherche_avancee.php',
      new URLSearchParams({
        search: '1',
        date_range: 'custom',
        date_from: from,
        date_to: to,
        date_field: 'date_stat',
        code: '',
        client: '',
        etat: '',
        agence: '0',
        agence_dest: '0',
        livreur: '0',
      }),
    ),
  );
}

export async function parcelDetail(barcode: string) {
  return parseParcel(
    barcode,
    await page(`recherche.php?code=${encodeURIComponent(barcode)}`),
  );
}

/** The website's status names → the ones our deliveries use (the API's, see lib/colissimo-data). */
const STATUSES: Record<string, string> = {
  'En attente': 'En attente',
  'À enlever': 'A enlever',
  Enlevé: 'Enleve',
  "Anomalie d'enlèvement": 'A verifier',
  'Au dépôt': 'Au depot',
  'Inter Dépôt': 'Au depot',
  'En cours': 'En cours',
  'Rtn Inter Agence': 'Retour Inter Agence',
  'À vérifier': 'A verifier',
  Livré: 'Livrer',
  'Livré payé': 'Livre paye',
  Échange: 'Echange',
  'Rtn Expéditeur': 'Retour Expediteur',
  'Rtn Dépôt': 'Rtn depot',
  'RTN reçu': 'Retour recu',
  'RTN définitif': 'Rtn definitif',
  'Reçu payé': 'Retour recu paye',
  Inconnu: 'Inconnu',
};
export const deliveryStatus = (label: string) => STATUSES[label] ?? label;

/** "2026-10-28 13:38[:05]" (Tunis time, UTC+1 all year) → a timestamp. */
export const tunisTime = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? new Date(
        `${value.replace(' ', 'T')}${value.length === 16 ? ':00' : ''}+01:00`,
      )
    : null;

/**
 * Every parcel of the account, newest first: 2-month windows going back until 6 months in a row
 * are empty (the account's start).
 */
export async function allParcels() {
  const parcels: PortalParcel[] = [];
  const day = (d: Date) => d.toISOString().slice(0, 10);
  let end = new Date();
  for (let empty = 0; empty < 3 && end.getFullYear() >= 2020;) {
    const start = new Date(end.getTime() - 60 * 86_400_000);
    const found = await searchParcels(day(start), day(end));
    parcels.push(...found);
    empty = found.length ? 0 : empty + 1;
    end = new Date(start.getTime() - 86_400_000);
  }
  return parcels;
}

export interface PortalPayout {
  reference: string;
  date: string;
  gross: number;
  fees: number;
  account: 'cash' | 'bank';
  parcels: {
    barcode: string;
    status: 'delivered' | 'returned';
    date: string;
  }[];
}

/** "Mes paiements": Colissimo's validated payouts, each with its parcels (delivered or returned). */
export async function payouts(): Promise<PortalPayout[]> {
  const html = await page('recette.php');
  const start = html.indexOf('<table');
  if (start < 0 || !/detail_recette\.php\?id=/.test(html)) return [];
  const result: PortalPayout[] = [];
  for (const cells of rowsOf(
    html.slice(start, html.indexOf('</table>', start)),
  )) {
    const id = cells.join(' ').match(/detail_recette\.php\?id=(\d+)/)?.[1];
    if (!id || cells.length < 7 || text(cells[6]) !== 'Oui') continue;
    const detail = await page(`detail_recette.php?id=${id}`);
    const table = [...detail.matchAll(/<table[\s\S]*?<\/table>/g)]
      .map((m) => m[0])
      .find((t) => />\s*Etat\s*</.test(t) && />\s*Code\s*</.test(t));
    if (!table)
      throw new PortalError(
        "Colissimo's payout page has changed: its parcels can't be read",
      );
    result.push({
      reference: `colissimo:${id}`,
      date: text(cells[0]),
      gross: money(text(cells[1])) ?? 0,
      fees: money(text(cells[3])) ?? 0,
      account: /esp[eè]ce/i.test(text(cells[5])) ? 'cash' : 'bank',
      parcels: rowsOf(table)
        .filter((row) => row.length >= 8)
        .map((row) => ({
          barcode: text(row[0]),
          status: /^livr/i.test(text(row[4])) ? 'delivered' : 'returned',
          date: text(row[7]),
        })),
    });
  }
  return result;
}
