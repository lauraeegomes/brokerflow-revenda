import { api, cookieSessao, criarSessao, permitir, HttpError, mesmaOrigem } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";
import { infoConvite, aceitarConvite } from "@/lib/users.js";

export const dynamic = "force-dynamic";

const ip = (request) => (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "desconhecido";

// Mostra para quem o convite foi emitido (sem exigir login).
export const GET = api(async (request) => {
  if (!(await permitir(`convite:i:${ip(request)}`, 60, 900))) throw new HttpError(429, "Muitas tentativas.");
  const token = new URL(request.url).searchParams.get("token");
  const info = await infoConvite(token);
  if (!info) throw new HttpError(404, "Convite inválido ou expirado.");
  return Response.json(info);
});

// Define a senha e já entra no sistema.
export const POST = api(async (request) => {
  if (!mesmaOrigem(request)) throw new HttpError(403, "Origem inválida.");
  if (!(await permitir(`convite:i:${ip(request)}`, 60, 900))) throw new HttpError(429, "Muitas tentativas.");
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  const { id, senhaHash } = await aceitarConvite(body?.token, body?.senha);
  await auditar(id, "convite_aceito", {});
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookieSessao(criarSessao(id, senhaHash)) },
  });
});
