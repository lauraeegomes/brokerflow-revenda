"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { instalarShims } from "./shims";

const Carregando = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 14, color: "#5a606e" }}>
    Carregando…
  </div>
);

// O protótipo usa window/document no carregamento: só roda no navegador.
const App = dynamic(() => import("./BrokerFlowRevenda.jsx"), { ssr: false, loading: Carregando });

export default function BrokerFlowClient({ user }) {
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    instalarShims();
    setPronto(true);
  }, []);
  return pronto ? <App usuarioInicial={user} /> : <Carregando />;
}
