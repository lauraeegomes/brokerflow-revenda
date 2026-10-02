import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { kvLerInterno, visivel, equipeDe } from "@/lib/kv.js";
import { subirFoto } from "@/lib/fotos.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sobe uma foto da captação para o bucket (fora do registro — é o que permite passar de ~15 fotos).
export const POST = api(async (request) => {
  const user = await exigirUsuario(request);
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  const captId = String(body?.captId || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(captId)) throw new HttpError(400, "Código da captação inválido.");

  // A captação pode ainda não ter sido salva (primeira foto de uma captação nova) — nesse caso
  // não há registro no kv ainda, e quem está criando obviamente pode subir fotos para ela.
  const row = await kvLerInterno(`cap:${captId}`);
  if (row && !visivel(user, row.owner_id, await equipeDe(user))) {
    throw new HttpError(403, "Sem permissão para esta captação.");
  }

  const path = await subirFoto(captId, body?.dataUrl);
  return Response.json({ path });
});
