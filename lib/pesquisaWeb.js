import { claudeConfigurado, pesquisarNaWebClaude } from "./claudeWeb.js";
import { geminiConfigurado, pesquisarNaWeb as pesquisarNaWebGemini } from "./gemini.js";

/** Escolhe o buscador: Claude (ANTHROPIC_API_KEY) tem prioridade; senão Gemini (GEMINI_API_KEY). */
export function pesquisar(prompt) {
  if (claudeConfigurado()) return pesquisarNaWebClaude(prompt).then((r) => ({ ...r, modelo: "claude-web" }));
  if (geminiConfigurado()) return pesquisarNaWebGemini(prompt).then((r) => ({ ...r, modelo: "gemini-web" }));
  return Promise.reject(new Error("A pesquisa na web não está configurada (falta ANTHROPIC_API_KEY ou GEMINI_API_KEY)."));
}
