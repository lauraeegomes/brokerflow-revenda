import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { query, auditar } from "@/lib/db.js";
import { prepararPlacas, validarCodigo } from "@/lib/placasDb.js";
import { AGENCIAS, visualAgencia } from "@/lib/placasAgencias.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = api(async request => {
  await exigirUsuario(request, ["diretoria", "backoffice", "gerente"]);
  await prepararPlacas();
  const search = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number(search.get("page")) || 1));
  const limit = Math.max(1, Math.min(100, Number(search.get("limit")) || 30));
  const agencia = search.get("agencia");
  if (agencia && !AGENCIAS[agencia]) throw new HttpError(400, "Agência inválida.");
  const { rows } = await query(
    `SELECT codigo, agencia, valor, bairro, titulo, imagem_url FROM placas_imoveis
     WHERE ($1::text IS NULL OR agencia = $1)
     ORDER BY codigo DESC LIMIT $2 OFFSET $3`,
    [agencia || null, limit, (page - 1) * limit]
  );
  return Response.json({ imoveis: rows.map(i => ({ ...i, ...{
    agenciaNome: visualAgencia(i.agencia).nome, cor: visualAgencia(i.agencia).cor
  }})), page, limit, agencias: AGENCIAS });
});

export const POST = api(async request => {
  const user = await exigirUsuario(request, ["diretoria", "backoffice"]);
  const data = await request.json().catch(() => { throw new HttpError(400, "JSON inválido."); });
  if (!Array.isArray(data?.imoveis) || !data.imoveis.length || data.imoveis.length > 200)
    throw new HttpError(400, "Envie entre 1 e 200 imóveis por lote.");
  const validos = data.imoveis.map(item => {
    const codigo = validarCodigo(item.codigo);
    const agencia = item.agencia;
    const valor = item.valor == null || item.valor === "" ? null : Number(item.valor);
    if (!codigo || !AGENCIAS[agencia] ||
        (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > 999999999999)))
      throw new HttpError(400, "Código, agência ou valor inválido.");
    return { codigo, agencia, valor, bairro: String(item.bairro || "").slice(0, 140),
      titulo: String(item.titulo || "").slice(0, 240) };
  });
  await prepararPlacas();
  for (const item of validos) {
    await query(`INSERT INTO placas_imoveis (codigo, agencia, valor, bairro, titulo)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (codigo) DO UPDATE SET
        agencia=EXCLUDED.agencia, valor=EXCLUDED.valor,
        bairro=COALESCE(NULLIF(EXCLUDED.bairro,''),placas_imoveis.bairro),
        titulo=COALESCE(NULLIF(EXCLUDED.titulo,''),placas_imoveis.titulo),
        atualizado_em=now()`, [item.codigo, item.agencia, item.valor, item.bairro, item.titulo]);
  }
  await auditar(user.id, "placas_imoveis_importados", { total: validos.length });
  return Response.json({ importados: validos.length });
});
