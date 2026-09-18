import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";
import { listar, salvarLista } from "@/lib/users.js";

export const dynamic = "force-dynamic";

// Diretoria vê tudo (inclusive links de convite); os demais só veem nome/perfil dos ativos.
export const GET = api(async (request) => {
  const user = await exigirUsuario(request);
  return Response.json({ users: await listar({ completo: user.perfil === "diretoria" }) });
});

// Somente a diretoria altera a lista (a interface envia a lista inteira).
export const PUT = api(async (request) => {
  const user = await exigirUsuario(request, ["diretoria"]);
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  await salvarLista(body?.users, user);
  await auditar(user.id, "usuarios_salvos", { total: body.users.length });
  return Response.json({ users: await listar({ completo: true }) });
});
