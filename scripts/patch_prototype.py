"""Adapta o protótipo (Artifact do Claude.ai) para rodar no servidor.
Uso:  python scripts/patch_prototype.py
Lê  scripts/BrokerFlowRevenda.original.jsx  e grava  components/BrokerFlowRevenda.jsx
Cada troca exige exatamente 1 ocorrência do trecho original; se o protótipo mudar, o script falha (de propósito).
"""
import os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEM = os.path.join(RAIZ, "scripts", "BrokerFlowRevenda.original.jsx")
DESTINO = os.path.join(RAIZ, "components", "BrokerFlowRevenda.jsx")

s = open(ORIGEM, encoding="utf-8").read()


def trocar(antigo, novo, nome):
    global s
    n = s.count(antigo)
    if n != 1:
        sys.exit(f"[FALHA] '{nome}': esperado 1 ocorrência, encontrado {n}")
    s = s.replace(antigo, novo)
    print(f"[ok] {nome}")


# 1) cabeçalho Next.js
s = '"use client";\nimport React from "react";\n' + s.lstrip("\n")
print("[ok] cabeçalho use client + import React")

# 2) autenticação: usuários e sessão passam a vir do servidor
ini = s.index("const SEED_USERS=[")
fim = s.index("function GestaoUsuarios(")
bloco_novo = '''async function getUsers(){
  const r=await fetch("/api/users",{credentials:"same-origin"});
  if(r.status===401){window.location.href="/login";return [];}
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||"Erro ao carregar usuários");
  return j.users||[];
}
async function saveUsers(users){
  const r=await fetch("/api/users",{method:"PUT",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({users})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const m=j.error||"Erro ao salvar usuários";alert(m);throw new Error(m);}
  return j.users||users;
}
async function clearSession(){try{await fetch("/api/logout",{method:"POST",credentials:"same-origin"});}catch(e){}}

'''
s = s[:ini] + bloco_novo + s[fim:]
print("[ok] getUsers/saveUsers/clearSession via API")

# 3) App: usuário vem da sessão do servidor (não entra mais automaticamente como admin)
trocar(
    "export default function App(){\n  const [usuarioAtual,setUsuarioAtual]=useState(null);\n  const [authLoading,setAuthLoading]=useState(true);",
    "export default function App({usuarioInicial}){\n  const [usuarioAtual,setUsuarioAtual]=useState(usuarioInicial||null);\n  const [authLoading,setAuthLoading]=useState(false);",
    "App recebe usuário da sessão",
)
trocar(
    """  useEffect(()=>{
    getUsers().then(users=>{
      const admin=users.find(u=>u.perfil==="diretoria"&&u.status==="ativo")||users.find(u=>u.status==="ativo")||users[0]||null;
      setUsuarioAtual(admin);
      setAuthLoading(false);
    }).catch(()=>setAuthLoading(false));
  },[]);

""",
    "",
    "remove auto-login como admin",
)
trocar(
    'async function handleLogout(){await clearSession();setUsuarioAtual(null);setMode("home");}',
    'async function handleLogout(){await clearSession();window.location.href="/login";}',
    "logout redireciona para /login",
)

# 4) limite de registro: 4 MB (o corpo de uma função na Vercel é limitado a 4,5 MB)
trocar("const LIMITE_SEGURO=4.5*1024*1024; // margem sob o limite real de 5MB",
       "const LIMITE_SEGURO=4.0*1024*1024; // margem sob o limite de 4,5MB do servidor", "limite de registro 4 MB")
trocar("acima do limite seguro de 4.5MB", "acima do limite seguro de 4MB", "mensagem do limite")

# 5) título do anúncio passa a ser gravado e restaurado
trocar("fotos,descComercial,descAprovada,galeriaConfirmada,latStatus,\n      historico,",
       "fotos,descComercial,descAprovada,tituloAnuncio,galeriaConfirmada,latStatus,\n      historico,", "grava título no registro")
trocar("    setDescAprovada(item.descAprovada||false);\n    setGaleriaConfirmada",
       "    setDescAprovada(item.descAprovada||false);\n    setTituloAnuncio(item.tituloAnuncio||\"\");\n    setGaleriaConfirmada", "restaura título ao abrir")
trocar('setFotos([]);setDescComercial("");setDescAprovada(false);setGaleriaConfirmada(false);',
       'setFotos([]);setDescComercial("");setTituloAnuncio("");setDescAprovada(false);setGaleriaConfirmada(false);', "limpa título na nova captação")

# 6) precificação: pesquisa em referências da web (servidor) — função principal do sistema
trocar(
    '''      const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:4000,tools:[{type:"web_search_20250305",name:"web_search"}],messages:[{role:"user",content:prompt}]})});
      setLoadMsg("Analisando...");const data=await r.json();''',
    '''      const r=await fetch("/api/precificar",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({prompt,area:f.area||null})});
      setLoadMsg("Analisando...");const data=await r.json().catch(()=>({}));
      if(!r.ok||data?.error){const m=data?.error?.message||data?.error;setError(typeof m==="string"&&m?m:"Não foi possível pesquisar preços agora.");return;}''',
    "precificação via /api/precificar",
)

# 7) envio ao Latitude: chamada real
trocar(
    '''              function enviarParaLatitudeStub(){
                setLatStatus("processando");
                registrarHistorico("Payload Latitude gerado");
                registrarHistorico("Envio ao Latitude iniciado");
                setTimeout(()=>{
                  setLatStatus("pendente_integracao");
                  registrarHistorico("Imóvel preparado — aguardando integração real do Latitude");
                  toast&&toast("Imóvel preparado para o Latitude.");
                },1200);
              }''',
    '''              async function enviarParaLatitudeStub(){
                setLatStatus("processando");
                registrarHistorico("Envio ao Latitude iniciado");
                try{
                  const r=await fetch("/api/latitude/enviar",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({captId})});
                  const j=await r.json().catch(()=>({}));
                  if(r.ok||(r.status===409&&j.imovelId)){
                    setLatInfo({imovelId:j.imovelId,pendencias:j.pendencias||[]});
                    setLatStatus("concluido");
                    registrarHistorico("Imóvel enviado ao Latitude como rascunho");
                    toast&&toast(r.ok?"✅ Imóvel enviado ao Latitude.":"Esta captação já estava no Latitude.");
                  }else{
                    setLatStatus(null);
                    registrarHistorico("Falha no envio ao Latitude");
                    toast&&toast("❌ "+(j.error||"Não foi possível enviar ao Latitude.")+(r.status===422?" (salve as alterações e tente de novo)":""));
                  }
                }catch(e){
                  setLatStatus(null);
                  toast&&toast("❌ Erro de conexão ao enviar ao Latitude.");
                }
              }''',
    "envio real ao Latitude",
)
trocar('  const pubStatus=latStatus==="concluido"?"publicado":null;',
       '  const pubStatus=latStatus==="concluido"?"publicado":null;\n  const [latInfo,setLatInfo]=useState(null);', "estado latInfo")
trocar(
    '                      {latStatus==="pendente_integracao"?(',
    '''                      {latStatus==="concluido"?(
                        <div>
                          <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:6,padding:"14px 16px",marginBottom:12}}>
                            <div style={{fontSize:12,fontWeight:700,color:"#065f46",marginBottom:4}}>✅ Enviado ao Latitude</div>
                            <div style={{fontSize:12,color:"#047857",lineHeight:1.6}}>O imóvel foi criado como <strong>rascunho</strong> no Latitude{latInfo?.imovelId?` (código ${latInfo.imovelId})`:""}. O backoffice deve abrir <strong>Imóveis</strong> no Latitude, completar o que estiver pendente e publicar.</div>
                          </div>
                          {latInfo?.pendencias?.length>0&&(
                            <div style={{fontSize:12,color:"#78350f",background:"#fffcf0",border:"1px solid #fde68a",borderRadius:6,padding:"10px 14px",marginBottom:12,lineHeight:1.6}}>
                              <strong>Pendências no Latitude:</strong>
                              <ul style={{margin:"6px 0 0 18px",padding:0}}>{latInfo.pendencias.map((p,i)=><li key={i}>{p}</li>)}</ul>
                            </div>
                          )}
                          <a href="https://www.latitude.app.br/immobile?identificador=1120" target="_blank" rel="noreferrer" style={{display:"inline-block",padding:"10px 18px",background:C.b2,color:"#fff",borderRadius:4,fontWeight:700,fontSize:12,textDecoration:"none"}}>Abrir Imóveis no Latitude →</a>
                        </div>
                      ):latStatus==="pendente_integracao"?(''',
    "bloco 'enviado ao Latitude'",
)

open(DESTINO, "w", encoding="utf-8").write(s)
print(f"\nGravado: {DESTINO} ({len(s):,} caracteres)")
