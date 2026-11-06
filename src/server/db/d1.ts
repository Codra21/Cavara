// The subset of the Workers D1 API that Cavara uses, copied from the signatures `wrangler types` generates
// (wrangler 4.158.0, worker-configuration.d.ts). The full generated runtime types are not included in the build
// because they redefine DOM globals (Element, append…) and break browser code. Re-check after upgrading wrangler.

export interface D1Meta {
  duration: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  [key: string]: unknown;
}

export interface D1Result<T = unknown> {
  success: true;
  meta: D1Meta;
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in order as one SQL transaction; any failure rolls back the whole batch. */
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

// R2: the subset Cavara uses, copied from the same generated file.
export interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata | Headers;
  customMetadata?: Record<string, string>;
}

export interface R2Object {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly httpMetadata?: R2HTTPMetadata;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2ObjectBody extends R2Object {
  get body(): ReadableStream;
  text(): Promise<string>;
}

// Cron triggers: the subset of the generated ScheduledController and ExecutionContext that Cavara uses.
export interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
}

/** Bindings declared in wrangler.jsonc. */
export interface CloudflareEnv {
  DB: D1Database;
  /** Product images (R2). */
  IMAGES: R2Bucket;
  /** Public origin of the image bucket's custom domain. Blank: images are served by the Worker at /media/<key>. */
  IMAGE_BASE_URL?: string;
  /** Owner sign-in name (Worker var). Defaults to "owner". */
  ADMIN_USERNAME?: string;
  /** Owner password (Worker secret; .dev.vars locally). Blank disables the admin. */
  ADMIN_SECRET?: string;
  /** R2 key (in IMAGES) of the public catalogue snapshot. Blank turns snapshots off (local dev on a local D1). */
  CATALOG_SNAPSHOT_KEY?: string;
  /** Cloudflare account the usage alert reads analytics for (var). */
  USAGE_ACCOUNT_ID?: string;
  /** API token with Account Analytics Read (secret). */
  CF_ANALYTICS_TOKEN?: string;
  /** Telegram bot token (secret). Shared by usage alerts now and order alerts in unit 8. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Telegram chat for usage alerts (secret). Order alerts use TELEGRAM_CHAT_ID. */
  TELEGRAM_USAGE_CHAT_ID?: string;
}
