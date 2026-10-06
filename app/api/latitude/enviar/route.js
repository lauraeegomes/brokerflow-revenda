import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { auditar, query } from "@/lib/db.js";
import { kvLerInterno, kvGravarInterno, visivel, equipeDe } from "@/lib/kv.js";
import { pendenciasDoEnvio } from "@/lib/checklist.js";
import { enviarParaLatitude, deBrokerFlow, acharCorretor, paraNumero, LatitudeError, EMPRESAS_LATITUDE, AGENCIA_PADRAO } from "@/lib/latitudeAdapter.ts";
import { baixarFoto } from "@/lib/fotos.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCK_MS = 10 * 60 * 1000;
const URL_IMOVEIS = "https://www.latitude.app.br/immobile?identificador=1120";

function dataUrlParaBytes(u) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(String(u || ""));
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: new Uint8Array(Buffer.from(m[2], "base64")) };
}

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
  const key = `cap:${captId}`;

  const row = await kvLerInterno(key);
  if (!row) throw new HttpError(404, "Captação não encontrada.");
  if (!visivel(user, row.owner_id, await equipeDe(user))) throw new HttpError(403, "Sem permissão para esta captação.");
  const rec = JSON.parse(row.value);

  if (rec.latitudeImovelId) {
    return Response.json(
      { error: "Esta captação já foi enviada ao Latitude.", imovelId: rec.latitudeImovelId },
      { status: 409 },
    );
  }
  if (rec.latLock && Date.now() - Date.parse(rec.latLock) < LOCK_MS) {
    throw new HttpError(409, "Já existe um envio em andamento para esta captação. Aguarde alguns minutos.");
  }
  const pendencias = pendenciasDoEnvio(rec);
  if (pendencias.length) {
    return Response.json({ error: "Checklist incompleto: " + pendencias.join(" "), pendencias }, { status: 422 });
  }

  // trava otimista: só segue se ninguém alterou o registro desde a leitura
  const comLock = JSON.stringify({ ...rec, latLock: new Date().toISOString() });
  const trava = await query("UPDATE kv SET value = $2 WHERE key = $1 AND value = $3 RETURNING key", [key, comLock, row.value]);
  if (trava.rows.length === 0) throw new HttpError(409, "A captação foi alterada agora. Recarregue e tente de novo.");

  const f = rec.f || {};
  try {
    // Fotos novas ficam no bucket (x.path); captações salvas antes dessa mudança ainda têm a
    // imagem embutida no próprio registro (x.dataUrl) — os dois formatos continuam funcionando.
    const aprovadas = (rec.fotos || []).filter((x) => x.status === "aprovada").slice(0, 30);
    const fotos = (
      await Promise.all(
        aprovadas.map(async (x, i) => {
          const d = x.path ? await baixarFoto(x.path).catch(() => null) : dataUrlParaBytes(x.refinadaUrl || x.dataUrl);
          return d ? { nome: `foto-${String(i + 1).padStart(2, "0")}.${d.mime.includes("png") ? "png" : "jpg"}`, bytes: d.bytes, mime: d.mime } : null;
        }),
      )
    ).filter(Boolean);

    const agencia = [body?.agencia, f.agencia].find((a) => Object.hasOwn(EMPRESAS_LATITUDE, a)) ?? AGENCIA_PADRAO;
    let corretorId = null;
    try {
      corretorId = await acharCorretor(String(f.corretor || ""), EMPRESAS_LATITUDE[agencia]);
    } catch {
      corretorId = null;
    }

    const tipoRotulo = { casa: "Casa", apartamento: "Apartamento", terreno: "Terreno", comercial: "Imóvel comercial", rural: "Imóvel rural" }[rec.cat] || "Imóvel";
    const input = {
      ...deBrokerFlow({
        captureId: captId,
        cat: rec.cat,
        subcat: rec.subcatCasa || null,
        titulo: rec.tituloAnuncio || `${tipoRotulo}${f.bairro ? " em " + f.bairro : ""}`,
        precoFinal: paraNumero(rec.precoFinal) || paraNumero(f.preco_pedido),
        f,
        corretorId,
        fotos,
      }),
      agencia,
    };
    const r = await enviarParaLatitude(input, { publicar: false });

    const agora = new Date();
    const pend = [...r.camposIncompletos];
    if (!corretorId) pend.push("corretor de captação não localizado no Latitude pelo nome informado");
    const novo = {
      ...rec,
      latStatus: "concluido",
      latitudeImovelId: r.imovelId,
      latitudeSentAt: agora.toISOString(),
      latitudePendencias: pend,
      historico: [
        ...(rec.historico || []),
        {
          data: agora.toLocaleDateString("pt-BR"),
          hora: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          responsavel: user.nome,
          descricao: `Enviado ao Latitude como rascunho de imóvel (${r.imovelId}) — ${r.fotosEnviadas} foto(s)`,
        },
      ],
    };
    delete novo.latLock;
    await kvGravarInterno(key, novo, row.owner_id, user.id);
    await auditar(user.id, "latitude_enviado", { captId, imovelId: r.imovelId, fotos: r.fotosEnviadas });
    return Response.json({
      ok: true,
      imovelId: r.imovelId,
      pessoaCriada: r.pessoaCriada,
      fotosEnviadas: r.fotosEnviadas,
      pendencias: pend,
      link: URL_IMOVEIS,
    });
  } catch (e) {
    // libera a trava para permitir nova tentativa
    const atual = await kvLerInterno(key);
    if (atual) {
      const r2 = JSON.parse(atual.value);
      delete r2.latLock;
      await kvGravarInterno(key, r2, atual.owner_id, user.id);
    }
    await auditar(user.id, "latitude_erro", { captId, erro: String(e?.message || e).slice(0, 300) });
    const msg = e instanceof LatitudeError ? `O Latitude recusou o envio: ${e.message}` : `Falha ao enviar ao Latitude: ${e?.message || e}`;
    return Response.json({ error: msg }, { status: 502 });
  }
});
