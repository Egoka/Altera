> Этот файл целиком попадает в README проекта claude.ai/design и читается дизайн-агентом, поэтому написан по-английски. Все имена ниже сверены со сборкой; при изменении `main.css` или ролей шрифтов в компонентах — обновить.

# Altera — foundations only (no components)

Altera is a cultural magazine (art, photography, music, sport, travel; Russian and English). This project is a **tokens-and-fonts foundation**: the site itself is Vue/Nuxt, so `window.Altera` exports nothing and there are no component cards. Build screens from generic HTML/React elements and style them with the tokens and fonts below; ignore the React-component loading advice in the generated sections.

## Setup

- Link `styles.css` once. It `@import`s `fonts/fonts.css` (every brand `@font-face`, files shipped) and `_ds_bundle.css` (every theme token, declared on `:root` inside `@layer theme`).
- Tokens are Tailwind v4 theme variables used as plain CSS custom properties: `color: var(--color-zinc-900)`. **No utility classes ship** — write CSS or inline styles, never `text-zinc-900`.
- Dark mode: the site puts class `dark` on `<html>` and swaps zinc pairs by hand (`--color-zinc-900` text on white; `--color-zinc-300` or `--color-zinc-100` text on `--color-zinc-950`). The only token remap in the build is `body.dark { --color-primary-* }` (in `@layer base`), which turns the primary scale into greys — do not rely on it for a dark theme.

## Vocabulary (real names from `_ds_bundle.css`)

| Family | Names | Use |
|---|---|---|
| Brand accent | `--color-primary`, `--color-primary-50` … `--color-primary-900` (orange-red, `#ff5a1f` at 500); `--color-secondary-*` is an identical copy | dates, hover links, active elements — sparingly |
| Greys | `--color-zinc-50` … `--color-zinc-950` (Tailwind defaults, oklch) | text, rules, borders, backgrounds — the site's real greyscale |
| States | `--color-accent-*`, `--color-success-*`, `--color-warning-*`, `--color-error-*`, `--color-neutral-*` (50 … 900) | app states; note the site itself uses `--color-red-500` for "follow" and dates |
| Fonts | `--font-waterway`, `--font-garamond-libre`, `--font-cormorant`, `--font-bergamasco`, `--font-sans`, `--font-serif` | roles below |
| Scale | `--text-xs` … `--text-5xl` (each with `--text-*--line-height`), `--font-weight-light` … `--font-weight-bold`, `--tracking-wide` / `--tracking-wider` / `--tracking-widest`, `--leading-tight` / `--leading-relaxed`, `--spacing` (0.25rem unit: `calc(var(--spacing) * 4)`), `--radius-sm` / `--radius-md` / `--radius-lg`, `--container-3xl` (48rem reading measure), `--container-7xl` (80rem page), `--breakpoint-sm` / `--breakpoint-md` / `--breakpoint-lg` / `--breakpoint-xl` | |

Declared but **not shipped** (by decision they fall back to system fonts): `--font-inter`, `--font-poppins`, `--font-roboto`, `--font-open-sans`, and `--font-bergamasco` (the repo holds only empty placeholder files, so the wordmark renders in the serif fallback). Do not use them.

## Typography roles (as the site uses them)

- **Waterway** (`--font-waterway`, one weight): page and section titles only — bold, `letter-spacing: var(--tracking-widest)`, `--text-5xl` on page headers, `--text-3xl` on feed sections, colour `--color-zinc-900`.
- **Garamond Libre** (`--font-garamond-libre`, 400/700 + italic): article and card headlines (medium or bold, `line-height: var(--leading-tight)`, `--color-zinc-900`), decks and descriptions (light, `--color-zinc-600` or `--color-zinc-700`, `--leading-relaxed`), article body.
- **Cormorant SC** (`--font-cormorant`, small caps, 300–700): author bylines and captions — uppercase, `--tracking-wide`, normal weight.
- **Wordmark**: the site sets `--font-bergamasco` on the logo, but no Bergamasco file ships (see above), so the wordmark is effectively `--font-serif`, light weight, about 2.2rem. Do not put Bergamasco anywhere else.
- **System sans** (`--font-sans`): the html root, kickers and section labels, dates — `--text-xs`, bold, uppercase, `--tracking-wider`; dates in `--color-red-500` at 80% opacity.
- **`--font-serif`** (Georgia stack): small text buttons ("read more", "Follow") — `--text-xs`, uppercase, `--color-zinc-500`.

## Layout

Page container `max-width: var(--container-7xl)` with 1rem / 1.5rem / 2rem side padding at base / `--breakpoint-sm` / `--breakpoint-lg`; reading measure `max-width: var(--container-3xl)`; card grids 1 → 2 → 3 columns at `--breakpoint-sm` / `--breakpoint-lg`. Rules and borders: 1px `--color-zinc-200` (dark: `--color-zinc-800`). Radii stay small: `--radius-sm` on images, `--radius-md` on tags and buttons.

## Where the truth lives

`_ds_bundle.css` (every token; Altera's own block starts at `--color-primary`, after Tailwind's defaults), `fonts/fonts.css`, and `guidelines/docs/vision/06-design-system.md` — the owner-approved design direction (Russian). Its §3 describes a *planned* semantic palette (`--color-paper`, `--color-ink`, `--color-rule`) that is **not** in this build: map those intents onto the zinc scale and `--color-primary-*` above.

## Idiomatic snippet (an article card, as the site renders it)

```jsx
<article style={{ fontFamily: "var(--font-garamond-libre)", color: "var(--color-zinc-900)" }}>
  <img src={cover} alt="" style={{ width: "100%", height: "13rem", objectFit: "cover", borderRadius: "var(--radius-sm)" }} />
  <h3 style={{ margin: "calc(var(--spacing) * 2) 0 0", fontSize: "var(--text-xl)", fontWeight: "var(--font-weight-medium)", lineHeight: "var(--leading-tight)" }}>
    The Quiet Rooms of Vilhelm Hammershøi
  </h3>
  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "calc(var(--spacing) * 3)" }}>
    <span style={{ fontFamily: "var(--font-cormorant)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)", color: "var(--color-zinc-600)" }}>Anna Petrova</span>
    <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-xs)", fontWeight: "var(--font-weight-bold)", textTransform: "uppercase", letterSpacing: "var(--tracking-wider)", color: "var(--color-zinc-500)" }}>Art</span>
  </div>
</article>
```
