import { api, cookieSessao, criarSessao, permitir, HttpError, mesmaOrigem } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";
import { loginComLatitude } from "@/lib/latitudeAuth.js";
import { loginOuCriarViaLatitude } from "@/lib/users.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Login com o mesmo e-mail/senha do Latitude — entra direto, cria a conta na primeira vez.
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
  const okEmail = await permitir(`latlogin:e:${email}`, 8, 900);
  const okIp = await permitir(`latlogin:i:${ip}`, 40, 900);
  if (!okEmail || !okIp) throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos e tente de novo.");

  let achado;
  try {
    achado = await loginComLatitude(email, senha);
  } catch {
    throw new HttpError(502, "Não foi possível falar com o Latitude agora. Tente de novo em instantes.");
  }
  if (!achado) {
    await auditar(null, "login_latitude_falhou", { email });
    throw new HttpError(401, "E-mail ou senha do Latitude incorretos, ou a conta não é da My Broker.");
  }

  const { user, senhaHash } = await loginOuCriarViaLatitude(achado);
  await auditar(user.id, "login_latitude", {});
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookieSessao(criarSessao(user.id, senhaHash)) },
  });
});
