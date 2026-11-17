import type { Env } from "./lib/env";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ status: "ok", service: "telehealthtechsolutions-api", environment: "starter" });
    }

    if (url.pathname.startsWith("/api/")) {
      // Add authenticated, tenant-scoped routes only after the identity provider
      // and authorization model have been implemented and security-tested.
      return json({
        error: "Not implemented",
        message: "This starter does not expose patient data or operational API routes yet."
      }, 501);
    }

    return env.ASSETS.fetch(request);
  }
};
