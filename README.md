# Cavara

Storefront for Cavara (https://cavarabd.com), premium home decor in Bangladesh. Server-rendered with
TanStack Start and React 19, deployed to Cloudflare Workers.

## Requirements

Bun 1.4.4 (pinned in `package.json` and `.mise.toml`).

## Commands

| Command                   | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `bun install`             | Install dependencies                                |
| `bun run dev`             | Dev server at http://localhost:3000                 |
| `bun run typecheck`       | Type check with Bun's native checker                |
| `bun test`                | Unit tests in `src/test/`                           |
| `bun run check`           | Type check and tests in parallel                    |
| `bun run build`           | Build for development (D1 `cavara-dev`)             |
| `bun run build:prod`      | Build for production (D1 `cavara-prod`)             |
| `bun run preview`         | Serve the built Worker locally                      |
| `bun run format`          | Format with oxfmt                                   |
| `bun run deploy`          | Check, production build, deploy Worker `cavara-web` |
| `bun run deploy:dev`      | Check, dev build, deploy Worker `cavara-web-dev`    |
| `bun run seed:generate`   | Regenerate `migrations/0002_seed_catalog.sql`       |
| `bun run db:migrate:dev`  | Apply pending migrations to `cavara-dev`            |
| `bun run db:migrate:prod` | Apply pending migrations to `cavara-prod`           |

## Layout

- `src/routes/` — pages (`/`, `/products/$slug`)
- `src/components/` — home, layout, product, store and UI components
- `src/domain/` — pure catalogue helpers
- `src/lib/` — query options (`useCatalog`), config, theme, bag/order helpers
- `src/server/` — server functions, D1 repositories, bindings
- `migrations/` — D1 schema and seed (`wrangler d1 migrations`)
- `scripts/seed/` — original catalogue and the seed generator
- `src/styles/site.css` — all styles and theme tokens
- `src/test/` — `bun test` suites
- `public/` — icons, brand assets and `product-images/`

## Deploying

Pushing to `main` releases https://cavarabd.com (`.github/workflows/deploy.yml`): checks, production build,
`bun run db:release:prod`, `wrangler deploy`, smoke test. The database step applies pending migrations only if
they are already on `cavara-dev`, after recording a Time Travel bookmark and storing a SQL export in the R2 bucket
`cavara-backups`. `.github/workflows/backup.yml` exports `cavara-prod` there every night (kept 90 days).
Both need the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

| Command                   | What it does                                                |
| ------------------------- | ----------------------------------------------------------- |
| `bun run db:release:prod` | Back up `cavara-prod`, then apply migrations already on dev |
| `bun run db:backup:prod`  | Time Travel bookmark and SQL export to R2, no migration     |

## Images

Product images live in R2 (`cavara-images-dev`, `cavara-images-prod`) and are served at `/media/<key>`.
`public/product-images/` is not in git; it is only the source for `bun scripts/r2/upload-product-images.ts`.
