import { api, cookieSessao, permitir, HttpError, mesmaOrigem } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";
import { cadastrar } from "@/lib/users.js";

export const dynamic = "force-dynamic";

// Auto-cadastro público: a pessoa cria a própria senha e já entra, sem aprovação da diretoria.
export const POST = api(async (request) => {
  if (!mesmaOrigem(request)) throw new HttpError(403, "Origem inválida.");
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "desconhecido";
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
  const okIp = await permitir(`cadastro:i:${ip}`, 5, 3600);
  const okEmail = await permitir(`cadastro:e:${email}`, 3, 86400);
  if (!okIp || !okEmail) throw new HttpError(429, "Muitas tentativas. Tente novamente mais tarde.");

  const { user, token } = await cadastrar({ ...body, email });
  await auditar(user.id, "cadastro_criado", { email });
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookieSessao(token) },
  });
});
