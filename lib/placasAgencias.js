// Uma única fonte de cores para API e futuro mapa Leaflet existente.
export const AGENCIAS = Object.freeze({
  santa_monica: Object.freeze({ nome: "Santa Mônica", cor: "#155EEF" }),
  zona_sul: Object.freeze({ nome: "Zona Sul", cor: "#EA580C" }),
});
export function visualAgencia(agencia) {
  return AGENCIAS[agencia] || { nome: "Sem agência", cor: "#64748B" };
}
