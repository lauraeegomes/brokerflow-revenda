/**
 * Ponte entre o protótipo (feito para o Claude.ai) e o servidor:
 *  - window.storage  → /api/storage (com sessão e permissões no servidor)
 *  - fetch("https://api.anthropic.com/v1/messages") → /api/anthropic (IA do Latitude); o protótipo não muda.
 * A precificação (pesquisa na web) chama /api/precificar diretamente (ver o patch em BrokerFlowRevenda.jsx).
 */
export function instalarShims() {
  if (typeof window === "undefined" || window.__bfShims) return;
  window.__bfShims = true;

  async function chamar(op, corpo) {
    const r = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ op, ...corpo }),
    });
    if (r.status === 401) {
      window.location.href = "/login";
      throw new Error("Sessão expirada");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
    return j;
  }

  window.storage = {
    async get(key) {
      const j = await chamar("get", { key });
      return j.value == null ? null : { key, value: j.value };
    },
    async set(key, value) {
      await chamar("set", { key, value });
      return { key, value };
    },
    async delete(key) {
      await chamar("delete", { key });
      return { key, deleted: true };
    },
    async list(prefix = "") {
      const j = await chamar("list", { prefix });
      return { keys: j.keys };
    },
  };

  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url === "https://api.anthropic.com/v1/messages") {
      return original("/api/anthropic", { ...(init || {}), credentials: "same-origin" });
    }
    return original(input, init);
  };
}
