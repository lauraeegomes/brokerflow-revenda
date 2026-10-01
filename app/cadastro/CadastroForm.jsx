"use client";

import { useState } from "react";

const card = { background: "#fff", borderRadius: 12, padding: "36px 32px", width: "100%", maxWidth: 420, boxShadow: "0 8px 32px rgba(9,47,104,.12)" };
const input = { width: "100%", padding: "12px 14px", border: "1.5px solid #dfe3ec", borderRadius: 8, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", margin: "6px 0 14px" };
const rot = { fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5 };

export default function CadastroForm() {
  const [f, setF] = useState({ nome: "", email: "", whatsapp: "", senha: "", confirma: "" });
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function enviar(e) {
    e.preventDefault();
    setErro("");
    if (f.senha.length < 10) return setErro("A senha precisa ter pelo menos 10 caracteres.");
    if (f.senha !== f.confirma) return setErro("As senhas não conferem.");
    setEnviando(true);
    try {
      const r = await fetch("/api/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: f.nome, email: f.email, whatsapp: f.whatsapp, senha: f.senha }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não foi possível concluir o cadastro.");
      window.location.href = "/";
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "linear-gradient(160deg,#092f68,#1e43f9)" }}>
      <form onSubmit={enviar} style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#1e43f9", marginBottom: 6 }}>MyBroker Imobiliária</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#092f68", marginBottom: 6 }}>Criar conta</div>

        <div style={{ fontSize: 12, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", padding: "10px 12px", borderRadius: 8, marginBottom: 20, lineHeight: 1.5 }}>
          Tem acesso ao Latitude? Não precisa criar conta — use o mesmo e-mail e senha de lá na{" "}
          <a href="/login" style={{ color: "#1e43f9", fontWeight: 700 }}>tela de login</a>.
        </div>
        <label style={rot}>Nome completo *</label>
        <input style={input} value={f.nome} onChange={set("nome")} required autoFocus autoComplete="name" />
        <label style={rot}>E-mail *</label>
        <input style={input} type="email" value={f.email} onChange={set("email")} required autoComplete="username" />
        <label style={rot}>WhatsApp</label>
        <input style={input} value={f.whatsapp} onChange={set("whatsapp")} placeholder="(34) 99999-9999" autoComplete="tel" />
        <label style={rot}>Senha (mín. 10 caracteres) *</label>
        <input style={input} type="password" value={f.senha} onChange={set("senha")} required autoComplete="new-password" />
        <label style={rot}>Repita a senha *</label>
        <input style={input} type="password" value={f.confirma} onChange={set("confirma")} required autoComplete="new-password" />
        {erro && <div role="alert" style={{ fontSize: 12, color: "#991b1b", background: "#fef2f2", padding: "8px 12px", borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
        <button type="submit" disabled={enviando} style={{ width: "100%", padding: "13px 16px", background: enviando ? "#93a4d9" : "#1e43f9", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: enviando ? "default" : "pointer", fontFamily: "inherit" }}>
          {enviando ? "Criando…" : "Criar conta e entrar"}
        </button>
        <div style={{ fontSize: 12, color: "#5a606e", marginTop: 16, textAlign: "center" }}>
          Já tem conta? <a href="/login" style={{ color: "#1e43f9", fontWeight: 700 }}>Entrar</a>
        </div>
      </form>
    </div>
  );
}
