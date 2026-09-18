import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { kvGet, kvSet, kvDelete, kvList } from "@/lib/kv.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Ponte do `window.storage` do protótipo. Toda operação exige sessão e respeita as permissões por perfil.
export const POST = api(async (request) => {
  const user = await exigirUsuario(request);
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  switch (body?.op) {
    case "get":
      return Response.json({ value: await kvGet(user, body.key) });
    case "set":
      await kvSet(user, body.key, body.value);
      return Response.json({ ok: true });
    case "delete":
      await kvDelete(user, body.key);
      return Response.json({ ok: true });
    case "list":
      return Response.json({ keys: await kvList(user, body.prefix) });
    default:
      throw new HttpError(400, "Operação inválida.");
  }
});
