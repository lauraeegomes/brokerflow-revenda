import { api, exigirUsuario, HttpError } from "@/lib/auth.js";
import { query, auditar } from "@/lib/db.js";
import { prepararPlacas, validarCodigo } from "@/lib/placasDb.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = api(async request => {
  await exigirUsuario(request, ["diretoria", "backoffice", "gerente"]);
  await prepararPlacas();
  const search = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number(search.get("page")) || 1));
  const limit = Math.max(1, Math.min(100, Number(search.get("limit")) || 30));
  const agencia = search.get("agencia");
  if (agencia && !["zona_sul", "santa_monica"].includes(agencia)) throw new HttpError(400, "Agência inválida.");
  const { rows } = await query(
    `SELECT codigo, agencia, valor, bairro, titulo, imagem_url FROM placas_imoveis
     WHERE ($1::text IS NULL OR agencia = $1)
     ORDER BY codigo DESC LIMIT $2 OFFSET $3`,
    [agencia || null, limit, (page - 1) * limit]
  );
  return Response.json({ imoveis: rows, page, limit });
});

// Aceita lote JSON da importação. Não importa nomes e telefones de proprietários.
export const POST = api(async request => {
  const user = await exigirUsuario(request, ["diretoria", "backoffice"]);
  const data = await request.json().catch(() => { throw new HttpError(400, "JSON inválido."); });
  if (!Array.isArray(data?.imoveis) || !data.imoveis.length || data.imoveis.length > 200)
    throw new HttpError(400, "Envie entre 1 e 200 imóveis por lote.");
  await prepararPlacas();
  let total = 0;
  for (const item of data.imoveis) {
    const codigo = validarCodigo(item.codigo);
    const agencia = item.agencia;
    const valor = item.valor == null || item.valor === "" ? null : Number(item.valor);
    if (!codigo || !["zona_sul", "santa_monica"].includes(agencia) ||
        (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > 999999999999)))
      throw new HttpError(400, "Código, agência ou valor inválido.");
    const bairro = String(item.bairro || "").slice(0, 140);
    const titulo = String(item.titulo || "").slice(0, 240);
    await query(`INSERT INTO placas_imoveis (codigo, agencia, valor, bairro, titulo)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (codigo) DO UPDATE SET
        agencia=EXCLUDED.agencia, valor=EXCLUDED.valor,
        bairro=COALESCE(NULLIF(EXCLUDED.bairro,''),placas_imoveis.bairro),
        titulo=COALESCE(NULLIF(EXCLUDED.titulo,''),placas_imoveis.titulo),
        atualizado_em=now()`, [codigo, agencia, valor, bairro, titulo]);
    total++;
  }
  await auditar(user.id, "placas_imoveis_importados", { total });
  return Response.json({ importados: total });
});
