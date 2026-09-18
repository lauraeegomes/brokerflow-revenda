/** Confere as travas do checklist (as mesmas da interface), agora no servidor. Retorna lista de pendências. */
export function pendenciasDoEnvio(rec) {
  const f = rec.f || {};
  const fotosOk = (rec.fotos || []).filter((x) => x.status === "aprovada").length;
  const p = [];
  if (rec.validStatus !== "aprovado") p.push("A captação ainda não foi aprovada pelo backoffice.");
  if (!rec.descAprovada) p.push("A descrição comercial ainda não foi aprovada.");
  if (fotosOk < 15) p.push(`Fotos aprovadas: ${fotosOk} (mínimo 15).`);
  if (!rec.docsVerificados) p.push("Documentos ainda não verificados.");
  if (!rec.galeriaConfirmada) p.push("Galeria ainda não confirmada.");
  if (!f._precDone) p.push("Precificação não vinculada.");
  if (!f.preco_pedido && !rec.precoFinal) p.push("Valor de venda não informado.");
  if (!(f.prop_nome && f.prop_fone)) p.push("Nome e telefone do proprietário são obrigatórios.");
  if (!f.corretor) p.push("Corretor responsável não informado.");
  return p;
}

