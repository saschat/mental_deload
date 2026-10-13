// Polite HTTP for the indexer: one request at a time per host, a pause between
// requests, retries on transient failures, and an honest user agent.

export const USER_AGENT = "mental-deload-activities (+https://github.com/saschat/mental_deload)";

// swissfamilyfun.com refuses user agents that do not look like a browser,
// while Overpass refuses ones that do. Hosts listed here get this one, which
// still names the project at the end.
const BROWSER_USER_AGENT = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 ${USER_AGENT}`;
const BROWSER_HOSTS = new Set(["swissfamilyfun.com", "www.swissfamilyfun.com"]);
// Open-Meteo stalls requests whose user agent carries a "(+https://…)" link.
const BARE_HOSTS = new Set(["api.open-meteo.com"]);

function userAgentFor(host: string): string {
  if (BROWSER_HOSTS.has(host)) return BROWSER_USER_AGENT;
  if (BARE_HOSTS.has(host)) return "mental-deload-activities";
  return USER_AGENT;
}

const DEFAULT_DELAY_MS = 1000;

export interface HttpOptions {
  /** Milliseconds between requests to the same host (robots.txt crawl delay). */
  delayMs?: Record<string, number>;
  log?: (msg: string) => void;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Http {
  private queues = new Map<string, Promise<unknown>>();
  private last = new Map<string, number>();
  private readonly opts: HttpOptions;
  requests = 0;

  constructor(opts: HttpOptions = {}) {
    this.opts = opts;
  }

  private delayFor(host: string): number {
    return this.opts.delayMs?.[host] ?? DEFAULT_DELAY_MS;
  }

  /** Serialise requests per host so the pause holds even when sources run in parallel. */
  private schedule<T>(host: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(host) ?? Promise.resolve();
    const next = prev.then(async () => {
      const wait = (this.last.get(host) ?? 0) + this.delayFor(host) - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await job();
      } finally {
        this.last.set(host, Date.now());
      }
    });
    this.queues.set(
      host,
      next.catch(() => undefined),
    );
    return next;
  }

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const host = new URL(url).host;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const res = await this.schedule(host, () =>
          fetch(url, {
            ...init,
            headers: { "User-Agent": userAgentFor(host), "Accept-Language": "de-CH,de;q=0.9,en;q=0.8", ...init.headers },
            signal: AbortSignal.timeout(60_000),
          }),
        );
        this.requests += 1;
        if (res.ok) return res;
        const retry = res.status === 429 || res.status >= 500;
        if (!retry || attempt >= 3) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
        this.opts.log?.(`HTTP ${res.status} for ${url}, retrying`);
      } catch (e) {
        if (e instanceof HttpError || attempt >= 3) throw e;
        this.opts.log?.(`${(e as Error).message} for ${url}, retrying`);
      }
      await sleep(2000 * attempt);
    }
  }

  async text(url: string, init?: RequestInit): Promise<string> {
    return (await this.request(url, init)).text();
  }

  async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.request(url, { ...init, headers: { Accept: "application/json", ...init?.headers } })).json() as Promise<T>;
  }
}
