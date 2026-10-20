import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { query, auditar } from "@/lib/db.js";
import { prepararPlacas, validarCodigo, validarPlaca } from "@/lib/placasDb.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = api(async request => {
  await exigirUsuario(request, ["diretoria", "backoffice", "gerente"]);
  await prepararPlacas();
  const { rows } = await query(`SELECT v.placa_id, v.codigo_imovel, i.agencia,
    i.valor, i.bairro, i.titulo, i.imagem_url
    FROM placas_vinculos v INNER JOIN placas_imoveis i ON i.codigo=v.codigo_imovel
    ORDER BY v.placa_id LIMIT 1000`);
  return Response.json({ vinculos: rows });
});

export const PUT = api(async request => {
  const user = await exigirUsuario(request, ["diretoria", "backoffice"]);
  const body = await request.json().catch(() => { throw new HttpError(400, "JSON inválido."); });
  const placaId = validarPlaca(body?.placaId);
  const codigo = validarCodigo(body?.codigoImovel);
  if (!placaId || !codigo) throw new HttpError(400, "Placa ou código inválido.");
  await prepararPlacas();
  const { rows } = await query("SELECT codigo FROM placas_imoveis WHERE codigo=$1", [codigo]);
  if (!rows.length) throw new HttpError(404, "Importe o imóvel antes de associá-lo à placa.");
  await query(`INSERT INTO placas_vinculos (placa_id, codigo_imovel, atualizado_por)
    VALUES ($1,$2,$3) ON CONFLICT (placa_id) DO UPDATE SET
    codigo_imovel=EXCLUDED.codigo_imovel, atualizado_por=EXCLUDED.atualizado_por,
    atualizado_em=now()`, [placaId, codigo, user.id]);
  await auditar(user.id, "placa_vinculada", { placaId, codigo });
  return Response.json({ placaId, codigoImovel: codigo });
});
