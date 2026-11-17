export interface Env {
  ASSETS: Fetcher;
  // Uncomment after creating and configuring D1:
  // DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  DAILY_API_KEY?: string;
  APP_BASE_URL?: string;
}

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
