"use client";

import { useState } from "react";

const card = { background: "#fff", borderRadius: 12, padding: "36px 32px", width: "100%", maxWidth: 380, boxShadow: "0 8px 32px rgba(9,47,104,.12)" };
const input = { width: "100%", padding: "12px 14px", border: "1.5px solid #dfe3ec", borderRadius: 8, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 14 };

export default function LoginForm({ semUsuarios }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não foi possível entrar.");
      window.location.href = "/";
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "linear-gradient(160deg,#092f68,#1e43f9)" }}>
      <form onSubmit={entrar} style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#1e43f9", marginBottom: 6 }}>MyBroker Imobiliária</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#092f68", letterSpacing: -0.5, marginBottom: 4 }}>BrokerFlow Revenda</div>
        <div style={{ fontSize: 13, color: "#5a606e", marginBottom: 24 }}>Entre com o e-mail e a senha do seu acesso.</div>

        {semUsuarios && (
          <div style={{ fontSize: 12, background: "#fffcf0", border: "1px solid #fde68a", color: "#78350f", padding: "10px 12px", borderRadius: 8, marginBottom: 14, lineHeight: 1.5 }}>
            Nenhum usuário cadastrado ainda. Defina <b>ADMIN_EMAIL</b> e <b>ADMIN_PASSWORD</b> nas variáveis de ambiente e reinicie para criar o primeiro administrador.
          </div>
        )}

        <label style={{ fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5 }}>E-mail</label>
        <input style={{ ...input, marginTop: 6 }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />

        <label style={{ fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5 }}>Senha</label>
        <input style={{ ...input, marginTop: 6 }} type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />

        {erro && <div role="alert" style={{ fontSize: 12, color: "#991b1b", background: "#fef2f2", padding: "8px 12px", borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

        <button type="submit" disabled={enviando} style={{ width: "100%", padding: "13px 16px", background: enviando ? "#93a4d9" : "#1e43f9", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: enviando ? "default" : "pointer", fontFamily: "inherit" }}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
        <div style={{ fontSize: 11, color: "#8a90a0", marginTop: 16, textAlign: "center" }}>
          Primeiro acesso? Use o link de convite enviado pela diretoria.
        </div>
      </form>
    </div>
  );
}
