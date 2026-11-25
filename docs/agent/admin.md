# Admin UI (Ant Design) and admin translations

Moved verbatim from CLAUDE.md so it loads only when needed. Keep it accurate when you change this area.

### Admin

Ant Design is used **only in the admin**; the storefront uses Tailwind plus `react-hot-toast`. Don't import `antd` in `app/[locale]` or `components/` outside `components/admin`, because it adds about 500 kB to every page. In admin forms, an `InputNumber` inside `Space.Compact` must sit in a `noStyle` `Form.Item` (see the Base Price field), or the value never reaches the form. Import `message` from `@/components/admin/antd-app`, not from `antd`: the admin layout wraps pages in antd's `<App>`, and the static API ignores the theme and warns. For searchable `Select`s whose values are ids, give options a `searchtext` and use `filterOption={searchByText}` (`components/admin/select-search.ts`). The admin layout installs `components/admin/admin-fetch-cache.ts`, which keeps the small lookup lists (categories, colors, sizes, suppliers, collections, locations) in memory for 5 minutes and clears an entry on any write to the same path. `app/admin/` is a client-rendered Ant Design dashboard (layout in `app/admin/layout.tsx`, theme in `lib/antd-config.ts`). It covers products, variants, categories, orders, stock (inventory, movements, restock, settings), team, promotions, sale banners, reels, and cart analytics, and it reads and writes through `/api` (NestJS).

**Admin language (EN / FR / AR).** The admin has its own language switch in the header (and on the login page), separate from the storefront URL locale. It's remembered per browser:
- Write UI text in English and wrap it: `const { t } = useAdminT()` then `t("Save changes")` or `t("Deleted {count} color(s)", { count })`.
- Text defined outside components (constants) is marked with `msg("…")` and translated where it's displayed with `t(value)`.
- French and Arabic live in `lib/admin-translations.ts` as `[English, French, Arabic]` rows (the ERP screens' rows are in `lib/admin-translations-erp.ts`, merged in; the original table wins on duplicates). A missing row falls back to English, so **add a row for every new string**, keeping `{placeholders}` intact.
- Arabic switches antd and the layout to right-to-left; antd's own texts (pagination, OK/Cancel, dates) and dayjs follow the language (`AdminConfig` in `app/admin/layout.tsx`).
- Never translate values that are data (HTTP methods, statuses sent to the API, ids).
