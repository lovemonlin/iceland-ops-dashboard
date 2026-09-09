/** Optional Cloudflare Worker endpoint; NEXT_PUBLIC values are inlined during static build. */
export const IP_TIMEZONE_ENDPOINT = process.env.NEXT_PUBLIC_IP_TIMEZONE_ENDPOINT ?? "";
export const IP_TIMEZONE_TIMEOUT_MS = 3_000;
