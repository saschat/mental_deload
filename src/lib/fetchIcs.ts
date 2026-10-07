export class IcsFetchError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "http" | "format",
  ) {
    super(message);
  }
}

/** Google Calendar & co. hand out webcal:// links; browsers need https://. */
export function normalizeIcsUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, "https://");
}

export function withProxy(url: string, proxyPrefix: string): string {
  const prefix = proxyPrefix.trim();
  if (!prefix) return url;
  return prefix.includes("{url}") ? prefix.replace("{url}", encodeURIComponent(url)) : prefix + url;
}

/** Fetch ICS text directly from the browser (optionally via a CORS proxy prefix). */
export async function fetchIcs(url: string, proxyPrefix = ""): Promise<string> {
  const target = withProxy(normalizeIcsUrl(url), proxyPrefix);
  let res: Response;
  try {
    res = await fetch(target, { cache: "no-store" });
  } catch {
    throw new IcsFetchError(
      proxyPrefix
        ? "Could not reach the calendar through the CORS proxy. Check the proxy prefix in Settings, or download the .ics file and upload it here."
        : "The browser could not load this calendar. Most calendar servers block direct access from web apps (CORS). Download the .ics file and upload it here, or set a CORS proxy prefix in Settings.",
      "network",
    );
  }
  if (!res.ok) {
    throw new IcsFetchError(`The calendar server answered with HTTP ${res.status}. Check the URL.`, "http");
  }
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new IcsFetchError("This URL did not return an iCalendar (.ics) file.", "format");
  }
  return text;
}
