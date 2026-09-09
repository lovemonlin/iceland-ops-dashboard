interface CloudflareRequest extends Request {
  cf?: { timezone?: unknown };
}

const ALLOWED_ORIGIN = "https://lovemonlin.github.io";

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Vary: "Origin",
  };

  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  }

  return headers;
}

const worker = {
  fetch(request: CloudflareRequest): Response {
    const origin = request.headers.get("Origin");
    if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403, headers: corsHeaders(origin) });
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders(origin), "Access-Control-Allow-Methods": "GET, OPTIONS" },
      });
    }
    if (request.method !== "GET") return new Response(null, { status: 405, headers: corsHeaders(origin) });

    const timezone = request.cf?.timezone;
    if (typeof timezone !== "string" || !timezone) return new Response(null, { status: 204, headers: corsHeaders(origin) });
    return Response.json({ timezone }, { headers: corsHeaders(origin) });
  },
};

export default worker;
