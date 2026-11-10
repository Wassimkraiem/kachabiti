# Storefront remake: dark for browsing, cream for buying

Date: 2026-11-10. Branch: `feature/ui-remake`. Status: waiting for approval.

## Intent

Kachabiti sells wool kachabia, burnous and dengri made in Tunisia, paid on delivery.
The storefront should feel like the landing remake (`kachabiti-landing-remake/index.html`):
near-black, cream and gold, large Arabic display type, arched photo frames, wool dust,
smooth motion. It must be easier to use than the remake: products and prices within the
first scroll, no pinned scrolling, real products from the admin, three languages.

## Goals

- One brand look across all 15 storefront pages.
- A visitor sees a product, its price and a way to buy it without scrolling far.
- Motion that feels smooth on a mid-range phone.

## Non-goals

- No change to the admin, the API, the data, prices, checkout logic or the cart.
- No new sections or features. Admin → Landing page keeps deciding the home sections,
  their order and their products.
- No new dependency.

## Anti-goals

- Pinned or hijacked scrolling (the remake's 260–340 screen-height sections).
- Forms that are hard to read. Checkout must stay at least as clear as today.
- A slower site: no extra JavaScript on pages that don't animate.

## Approaches considered

1. **Dark for browsing, cream for buying (chosen).** Header, footer, home, categories,
   product list and product page are dark. Cart, checkout, sign-in, account, order
   confirmation, contact and the text pages use the remake's light palette. Two palettes
   to keep consistent, but forms stay readable and checkout is recoloured, not redesigned.
2. **Dark everywhere.** Most uniform, but long forms on dark are harder to read and to
   get right, and it roughly doubles the work on cart, checkout and account.
3. **Global CSS overrides.** Dropped: quick, but breaks unpredictably.

Chosen by the owner: approach 1.

## Design

### Colours

Two palettes with the same variable names, so components don't care which one they are in.
Values are the remake's.

| Token | Dark | Cream |
|---|---|---|
| `surface` (page) | `#0a0705` | `#ede2d0` |
| `card` | `#17110b` | `#f7f0e6` |
| `ink` (text) | `#f4e6cf` | `#16100a` |
| `mute` (secondary text) | `#a8987f` | `#5d5245` |
| `accent` | `#d9a548` gold | `#b5651d` copper |
| `line` (borders) | ink at 22% | ink at 20% |

Defined in `app/globals.css` and exposed to Tailwind (`bg-surface`, `text-ink`, …).
The storefront is dark by default; a cream page wraps its content in `.theme-cream`.
Header and footer are always dark. The hard-coded colours (`bg-white`, `text-gray-*`,
hex values; about 580 in 64 files) are replaced by these tokens as each page is done.
The old `--wool-*` variables are removed once nothing uses them.

### Type

Reem Kufi (already self-hosted, Arabic and Latin) for all display headings, in every
language. Body text keeps the current fonts. No letter-spacing on Arabic.

### Motion

- `Reveal`: one small client component (IntersectionObserver plus a CSS transition) that
  fades and lifts content as it enters the screen, with a stagger for lists.
- Home hero: the arched product photo with a slow float, a light sweep, and wool dust on a
  canvas; pressing the photo bursts the dust, as in the remake.
- Cards: image zoom and lift on hover. Buttons: the remake's pill with a 2 px lift.
- Everything is off under `prefers-reduced-motion`.

### Pages

- **Header, mobile header, tab bar, footer:** dark, thin gold line, the wordmark centred
  on desktop, the footer ends with the large "قشابيتي" wordmark.
- **Home:** hero = giant faded word behind the arched photo of the first showcase product,
  title, one line of text, two buttons, cash-on-delivery and free-delivery notes. Then the
  admin's sections in the admin's order, restyled: categories as large photo cards
  ("three pieces"), product lists as arched cards with name and price, the two-line
  moving text band, "how to order" as four numbered cards, reels, reviews, FAQ.
- **Product list and categories:** dark, filter and sort bar kept as it works today,
  same card as the home page.
- **Product page:** dark, gallery in an arched frame, name, price, sizes and colours as
  pills, a sticky "add to cart" bar on phones.
- **Cream pages:** cart, cart drawer, checkout, sign-in, account, order confirmation,
  contact, about, shipping, privacy, terms. Recoloured to the cream palette with the same
  buttons and headings. Layout and fields unchanged.

### Order of work

1. Tokens, `Reveal`, header, footer, tab bar, product card, buttons, section heading.
2. Home.
3. Product list, categories, product page.
4. Cream pages.

The site works after each step. Nothing is committed; the owner reviews and commits.

## Calls made by the builder (check these)

- **The 3D product ring leaves the home hero.** The arched photo replaces it, which also
  removes three.js from the home page. The admin's "ring" picks stay stored but unused.
- **Reem Kufi instead of the remake's Aref Ruqaa and Lalezar.** Those would have to be
  downloaded and self-hosted; Reem Kufi is already here. They can be added later.
- **The hero photo is the first "showcase" pick** from Admin → Landing page.
- **No animation library**: CSS and one observer component.
- **The site's `prefers-color-scheme` rule is removed**: the look no longer depends on the
  visitor's system theme.

## Left to the builder

Exact spacing, sizes and breakpoints; how each existing section maps to the tokens.

## How it is checked

`npx tsc --noEmit`, `npm run lint`, then each page in the dev server in ar, fr and en,
at phone and desktop width, with an order placed through checkout on the local stack.
