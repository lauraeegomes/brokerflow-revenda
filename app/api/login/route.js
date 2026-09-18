import { api, entrar, cookieSessao, permitir, HttpError, mesmaOrigem } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";

export const dynamic = "force-dynamic";

export const POST = api(async (request) => {
  if (!mesmaOrigem(request)) throw new HttpError(403, "Origem inválida.");
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const senha = String(body?.senha || "");
  if (!email || !senha || senha.length > 200 || email.length > 200) throw new HttpError(400, "Informe e-mail e senha.");

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "desconhecido";
  const okEmail = await permitir(`login:e:${email}`, 8, 900);
  const okIp = await permitir(`login:i:${ip}`, 40, 900);
  if (!okEmail || !okIp) throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos e tente de novo.");

  const r = await entrar(email, senha);
  if (r?.pendente) throw new HttpError(403, "Seu cadastro ainda está aguardando aprovação da diretoria.");
  if (!r) {
    await auditar(null, "login_falhou", { email });
    throw new HttpError(401, "E-mail ou senha incorretos.");
  }
  await auditar(r.user.id, "login", {});
  return new Response(JSON.stringify({ user: r.user }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookieSessao(r.token) },
  });
});
