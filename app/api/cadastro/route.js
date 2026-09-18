import { api, permitir, HttpError, mesmaOrigem } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";
import { cadastrar } from "@/lib/users.js";

export const dynamic = "force-dynamic";

const MENSAGEM = "Cadastro recebido! A diretoria vai analisar e liberar seu acesso. Você poderá entrar com o e-mail e a senha que acabou de criar.";

// Auto-cadastro público. A pessoa cria a própria senha, mas só entra depois da aprovação da diretoria.
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

  const { id } = await cadastrar({ ...body, email });
  await auditar(id, id ? "cadastro_criado" : "cadastro_email_existente", { email });
  return Response.json({ ok: true, mensagem: MENSAGEM });
});
