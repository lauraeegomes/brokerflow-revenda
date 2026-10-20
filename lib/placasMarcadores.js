import { visualAgencia } from "./placasAgencias.js";

/**
 * Padrão visual de marcadores para o mapa existente.
 * A cor representa a agência. Estado pendente NÃO apaga a identidade da agência:
 * placas sem vínculo continuam com sua cor e recebem contorno tracejado.
 * Cinza é reservado a registros sem agência definida.
 */
export function estiloMarcadorPlaca({ agencia, codigoImovel } = {}) {
  const { cor, nome } = visualAgencia(agencia);
  const vinculado = Boolean(codigoImovel);
  return {
    fillColor: cor,
    color: vinculado ? "#FFFFFF" : "#94A3B8",
    weight: vinculado ? 2 : 3,
    fillOpacity: vinculado ? 1 : 0.75,
    dashArray: vinculado ? null : "4 3",
    radius: 9,
    title: `${nome} — ${vinculado ? "placa vinculada" : "placa pendente"}`,
  };
}

export const LEGENDA_PLACAS = Object.freeze([
  { agencia: "santa_monica", nome: "Santa Mônica", cor: "#155EEF" },
  { agencia: "zona_sul", nome: "Zona Sul", cor: "#000000" },
  { agencia: null, nome: "Sem agência definida", cor: "#64748B" },
]);
