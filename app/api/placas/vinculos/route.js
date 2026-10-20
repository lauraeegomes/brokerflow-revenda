import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { query, auditar } from "@/lib/db.js";
import { prepararPlacas, validarCodigo, validarPlaca } from "@/lib/placasDb.js";
import { AGENCIAS, visualAgencia } from "@/lib/placasAgencias.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = api(async request => {
  await exigirUsuario(request, ["diretoria", "backoffice", "gerente"]);
  await prepararPlacas();
  const agencia = new URL(request.url).searchParams.get("agencia");
  if (agencia && !AGENCIAS[agencia]) throw new HttpError(400, "Agência inválida.");
  const { rows } = await query(`SELECT p.id AS placa_id, v.codigo_imovel, p.agencia,
    i.valor, i.bairro, i.titulo, i.imagem_url
    FROM placas_registros p
    LEFT JOIN placas_vinculos v ON v.placa_id=p.id
    LEFT JOIN placas_imoveis i ON i.codigo=v.codigo_imovel
    WHERE ($1::text IS NULL OR p.agencia=$1)
    ORDER BY p.id LIMIT 5000`, [agencia || null]);
  return Response.json({ vinculos: rows.map(v => ({
    ...v, agenciaNome: visualAgencia(v.agencia).nome, cor: visualAgencia(v.agencia).cor
  })), agencias: AGENCIAS });
});

// Cadastra uma placa sem exigir que já esteja vinculada a imóvel.
export const POST = api(async request => {
  const user = await exigirUsuario(request, ["diretoria", "backoffice"]);
  const body = await request.json().catch(() => { throw new HttpError(400, "JSON inválido."); });
  const placaId = validarPlaca(body?.placaId);
  const agencia = body?.agencia;
  if (!placaId || !AGENCIAS[agencia]) throw new HttpError(400, "Placa ou agência inválida.");
  await prepararPlacas();
  const { rows } = await query(`SELECT i.agencia FROM placas_vinculos v
    JOIN placas_imoveis i ON i.codigo=v.codigo_imovel WHERE v.placa_id=$1`, [placaId]);
  if (rows.length && rows[0].agencia !== agencia)
    throw new HttpError(409, "A agência da placa deve corresponder à do imóvel vinculado.");
  await query(`INSERT INTO placas_registros(id, agencia) VALUES($1,$2)
    ON CONFLICT (id) DO UPDATE SET agencia=EXCLUDED.agencia, atualizado_em=now()`,
    [placaId, agencia]);
  await auditar(user.id, "placa_cadastrada", { placaId, agencia });
  return Response.json({ placaId, agencia, ...visualAgencia(agencia) });
});

export const PUT = api(async request => {
  const user = await exigirUsuario(request, ["diretoria", "backoffice"]);
  const body = await request.json().catch(() => { throw new HttpError(400, "JSON inválido."); });
  const placaId = validarPlaca(body?.placaId);
  const codigo = validarCodigo(body?.codigoImovel);
  if (!placaId || !codigo) throw new HttpError(400, "Placa ou código inválido.");
  await prepararPlacas();
  const { rows } = await query("SELECT codigo, agencia FROM placas_imoveis WHERE codigo=$1", [codigo]);
  if (!rows.length) throw new HttpError(404, "Importe o imóvel antes de associá-lo à placa.");
  const agencia = rows[0].agencia;
  const placa = await query("SELECT agencia FROM placas_registros WHERE id=$1", [placaId]);
  if (placa.rows.length && placa.rows[0].agencia !== agencia)
    throw new HttpError(409, "Placa e imóvel pertencem a agências diferentes.");
  await query(`INSERT INTO placas_registros(id, agencia) VALUES($1,$2)
    ON CONFLICT (id) DO NOTHING`, [placaId, agencia]);
  await query(`INSERT INTO placas_vinculos (placa_id, codigo_imovel, atualizado_por)
    VALUES ($1,$2,$3) ON CONFLICT (placa_id) DO UPDATE SET
    codigo_imovel=EXCLUDED.codigo_imovel, atualizado_por=EXCLUDED.atualizado_por,
    atualizado_em=now()`, [placaId, codigo, user.id]);
  await auditar(user.id, "placa_vinculada", { placaId, codigo, agencia });
  return Response.json({ placaId, codigoImovel: codigo, agencia, cor: visualAgencia(agencia).cor });
});
