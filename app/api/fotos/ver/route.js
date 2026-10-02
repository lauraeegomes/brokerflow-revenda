import { exigirUsuario, HttpError } from "@/lib/auth.js";
import { kvLerInterno, visivel, equipeDe } from "@/lib/kv.js";
import { baixarFoto, captIdDoCaminho } from "@/lib/fotos.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Serve uma foto do bucket privado — só para quem pode ver a captação dona dela.
export async function GET(request) {
  try {
    const user = await exigirUsuario(request);
    const path = new URL(request.url).searchParams.get("path") || "";
    const captId = captIdDoCaminho(path);
    if (!captId) throw new HttpError(400, "Caminho de foto inválido.");

    const row = await kvLerInterno(`cap:${captId}`);
    if (!row) throw new HttpError(404, "Captação não encontrada.");
    if (!visivel(user, row.owner_id, await equipeDe(user))) throw new HttpError(403, "Sem permissão para esta foto.");

    const foto = await baixarFoto(path);
    if (!foto) throw new HttpError(404, "Foto não encontrada.");
    return new Response(foto.bytes, {
      status: 200,
      headers: { "Content-Type": foto.mime, "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Erro interno." }, { status: 500 });
  }
}
