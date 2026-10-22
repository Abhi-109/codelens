# CodeLens brand

## The mark

A rounded-square **C** — a code block seen through a lens — with a single filled
focus dot at its optical centre. The opening on the right is the execution path
leaving the frame; the dot is the step in focus. There is nothing else in it,
which is why it still reads at 16×16.

The wordmark is **Bahnschrift SemiBold** (wght 600, wdth 95) with tightened
tracking, outlined to paths in `src/brand/wordmarkPath.js`. No font file ships
with the site, so the lockup is identical on every platform.

## Palette

| Name | Hex | Use |
|---|---|---|
| Obsidian | `#101010` | Dark brand surface; the one-colour logo |
| Warm white | `#F5F3ED` | Wordmark on obsidian |
| Electric lime | `#C7FF5E` | Mark on obsidian |
| Graphite | `#1C1C1A` | Secondary dark surface |

On a light surface the whole logo is obsidian. Lime never sits on white: use a
monochrome file instead. In the app the colours come from `--logo-mark` and
`--logo-word` in `src/styles/tokens.css`, so the same component switches with
the theme.

## Files

`public/brand/`

- `codelens-logo.svg` — primary horizontal lockup, for dark surfaces
- `codelens-logo-mono-black.svg` — one colour, for light surfaces
- `codelens-logo-mono-white.svg` — one colour, for dark surfaces
- `codelens-mark.svg` — lime symbol
- `codelens-mark-mono-black.svg`, `codelens-mark-mono-white.svg`
- `codelens-logo-1200.png`, `codelens-mark-512.png` — transparent raster exports
  (the lockup PNG keeps the warm-white wordmark, so it is for dark surfaces)

`public/`

- `favicon.svg`, `favicon-16.png`, `favicon-32.png`
- `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
- `site.webmanifest`

The favicon and app icons place the lime mark on an obsidian square, so they
stay visible on light and dark browser chrome. The square is full-bleed for
`icon-192`/`icon-512` so a platform mask can round it; the favicon has its own
rounded corners.

## Usage

- Keep clear space of at least one focus-dot diameter around the lockup.
- Minimum size: 16px for the mark, 24px high for the lockup.
- Use the standalone mark when there is not enough width for the wordmark.
- Do not stretch, rotate, recolour outside the palette, add shadows, or put the
  lime mark on a light background.
- Do not use the mark as a bullet, a loading spinner, or a generic icon.

## In the app

`src/brand/BrandLogo.jsx` exports `BrandLogo` (horizontal lockup) and
`BrandMark` (standalone symbol). The nav logo is decorative because the home
link already has the accessible name; standalone uses expose
`role="img"` with the name “CodeLens”.
