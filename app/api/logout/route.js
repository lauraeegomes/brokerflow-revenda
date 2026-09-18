import { api, cookieLimpo, HttpError, mesmaOrigem } from "@/lib/auth.js";

export const dynamic = "force-dynamic";

export const POST = api(async (request) => {
  if (!mesmaOrigem(request)) throw new HttpError(403, "Origem inválida.");
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookieLimpo() },
  });
});
