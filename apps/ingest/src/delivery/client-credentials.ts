const TIMEOUT_MS = 5000;
/** Renew this long before the token's own expiry, so a request never leaves with a stale one. */
const EARLY_RENEWAL_MS = 30_000;

/** Where the sink gets a bearer token. */
export interface TokenSource {
  token(): Promise<string>;
  /** Forget the cached token, e.g. after the server refused it. */
  invalidate(): void;
}

/**
 * OAuth 2.0 client credentials (RFC 6749 §4.4) against the command center's identity provider
 * (ADR-0006). The pipeline is a confidential client with a service account; its token is
 * verified by the command center exactly like an operator's.
 *
 * One token is cached until shortly before it expires, and concurrent callers share one request
 * for a new one.
 */
export class ClientCredentials implements TokenSource {
  private cached?: { value: string; renewAt: number };
  private pending?: Promise<string>;

  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async token(): Promise<string> {
    if (this.cached && this.now() < this.cached.renewAt) return this.cached.value;
    this.pending ??= this.fetchToken().finally(() => (this.pending = undefined));
    return this.pending;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<string> {
    const response = await this.fetchFn(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // The body of a token error names the problem (`invalid_client` …) and never a secret.
      const text = await response.text().catch(() => '');
      throw new Error(`token request → ${response.status} ${text.slice(0, 200)}`);
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('token response has no access_token');
    const lifetimeMs = (body.expires_in ?? 60) * 1000;
    this.cached = {
      value: body.access_token,
      renewAt: this.now() + Math.max(lifetimeMs - EARLY_RENEWAL_MS, lifetimeMs / 2),
    };
    return body.access_token;
  }
}
