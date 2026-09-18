"use client";

import { useEffect, useState } from "react";

const card = { background: "#fff", borderRadius: 12, padding: "36px 32px", width: "100%", maxWidth: 400, boxShadow: "0 8px 32px rgba(9,47,104,.12)" };
const input = { width: "100%", padding: "12px 14px", border: "1.5px solid #dfe3ec", borderRadius: 8, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", margin: "6px 0 14px" };
const rot = { fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5 };

export default function ConviteForm({ token }) {
  const [info, setInfo] = useState(null);
  const [invalido, setInvalido] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch(`/api/invite?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setInvalido(true));
  }, [token]);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (senha.length < 10) return setErro("A senha precisa ter pelo menos 10 caracteres.");
    if (senha !== confirma) return setErro("As senhas não conferem.");
    setEnviando(true);
    try {
      const r = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, senha }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não foi possível salvar a senha.");
      window.location.href = "/";
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "linear-gradient(160deg,#092f68,#1e43f9)" }}>
      <form onSubmit={salvar} style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#1e43f9", marginBottom: 6 }}>MyBroker Imobiliária</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#092f68", marginBottom: 6 }}>Criar sua senha</div>

        {invalido && <div style={{ fontSize: 13, color: "#991b1b", background: "#fef2f2", padding: "12px 14px", borderRadius: 8 }}>Este convite é inválido ou expirou. Peça um novo link à diretoria.</div>}
        {!info && !invalido && <div style={{ fontSize: 13, color: "#5a606e" }}>Verificando convite…</div>}

        {info && (
          <>
            <div style={{ fontSize: 13, color: "#5a606e", marginBottom: 20 }}>Olá, <b>{info.nome}</b>. Defina a senha de acesso para <b>{info.email}</b>.</div>
            <label style={rot}>Nova senha (mín. 10 caracteres)</label>
            <input style={input} type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoFocus />
            <label style={rot}>Repita a senha</label>
            <input style={input} type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required />
            {erro && <div role="alert" style={{ fontSize: 12, color: "#991b1b", background: "#fef2f2", padding: "8px 12px", borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
            <button type="submit" disabled={enviando} style={{ width: "100%", padding: "13px 16px", background: enviando ? "#93a4d9" : "#1e43f9", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: enviando ? "default" : "pointer", fontFamily: "inherit" }}>
              {enviando ? "Salvando…" : "Salvar e entrar"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
