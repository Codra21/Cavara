# Cavara

Storefront for Cavara (https://cavarabd.com), premium home decor in Bangladesh. Server-rendered with
TanStack Start and React 19, deployed to Cloudflare Workers.

## Requirements

Bun 1.4.4 (pinned in `package.json` and `.mise.toml`).

## Commands

| Command              | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `bun install`        | Install dependencies                                 |
| `bun run dev`        | Dev server at http://localhost:3000                  |
| `bun run typecheck`  | Type check with Bun's native checker                 |
| `bun test`           | Unit tests in `src/test/`                            |
| `bun run check`      | Type check and tests in parallel                     |
| `bun run build`      | Client bundle and Worker build in `dist/`            |
| `bun run preview`    | Serve the built Worker locally                       |
| `bun run format`     | Format with oxfmt                                    |
| `bun run deploy`     | Check, build and deploy with Wrangler                |

## Layout

- `src/routes/` — pages (`/`, `/products/$slug`)
- `src/components/` — home, layout, product, store and UI components
- `src/lib/` — catalogue data and helpers, config, bag/order helpers
- `src/styles/site.css` — all styles and theme tokens
- `src/test/` — `bun test` suites
- `public/` — icons, brand assets and `product-images/`

`public/product-images/` is not in git. Copy it in locally before running the dev server or tests; product images
move to R2 in a later step.
