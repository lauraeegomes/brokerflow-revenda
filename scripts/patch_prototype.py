"""Adapta o protótipo (Artifact do Claude.ai) para rodar no servidor.
Uso:  python scripts/patch_prototype.py
Lê  scripts/BrokerFlowRevenda.original.jsx  e grava  components/BrokerFlowRevenda.jsx
Cada troca exige exatamente 1 ocorrência do trecho original; se o protótipo mudar, o script falha (de propósito).
"""
import base64, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEM = os.path.join(RAIZ, "scripts", "BrokerFlowRevenda.original.jsx")
DESTINO = os.path.join(RAIZ, "components", "BrokerFlowRevenda.jsx")
ASSETS = os.path.join(RAIZ, "scripts", "assets")

s = open(ORIGEM, encoding="utf-8").read()


def trocar(antigo, novo, nome):
    global s
    n = s.count(antigo)
    if n != 1:
        sys.exit(f"[FALHA] '{nome}': esperado 1 ocorrência, encontrado {n}")
    s = s.replace(antigo, novo)
    print(f"[ok] {nome}")


def trocar_regex(padrao, novo, nome):
    """Como trocar(), mas o 'antigo' é um regex — usado quando o trecho original é grande
    demais (ou binário, como um logo em base64) para colar literalmente no script."""
    global s
    n = len(re.findall(padrao, s))
    if n != 1:
        sys.exit(f"[FALHA] '{nome}': esperado 1 ocorrência, encontrado {n}")
    s = re.sub(padrao, lambda m: novo, s, count=1)
    print(f"[ok] {nome}")


def base64_de(nome_arquivo):
    return base64.b64encode(open(os.path.join(ASSETS, nome_arquivo), "rb").read()).decode()


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

# 8) links de convite/redefinição apontam para as páginas do servidor; novo status e selo de pendentes
trocar(
    'function gerarLinkConvite(user){return `${window.location.href.split("#")[0]}#convite=${user.tokenConvite}`;}',
    'function gerarLinkConvite(user){return `${window.location.origin}/convite/${user.tokenConvite}`;}',
    "link de convite",
)
trocar(
    'copiarTexto(`${window.location.href.split("#")[0]}#convite=${t}`,user.id+"_convite");',
    'copiarTexto(`${window.location.origin}/convite/${t}`,user.id+"_convite");',
    "link de convite reenviado",
)
trocar(
    'copiarTexto(`${window.location.href.split("#")[0]}#redefinir=${t}`,u.id+"_redefinir");',
    'copiarTexto(`${window.location.origin}/convite/${t}`,u.id+"_redefinir");',
    "link de redefinir senha",
)
trocar(
    '  convite_pendente:{label:"Convite pendente",cor:"#78350f",bg:"#fefce8"},',
    '  aguardando_aprovacao:{label:"Aguardando aprovação",cor:"#9a3412",bg:"#ffedd5"},\n  convite_pendente:{label:"Convite pendente",cor:"#78350f",bg:"#fefce8"},',
    "status aguardando aprovação",
)
trocar(
    "  const [authLoading,setAuthLoading]=useState(false);",
    "  const [authLoading,setAuthLoading]=useState(false);\n  const [pendentes,setPendentes]=useState(0);\n  useEffect(()=>{if(usuarioAtual?.perfil==='diretoria')getUsers().then(l=>setPendentes(l.filter(u=>u.status==='aguardando_aprovacao').length)).catch(()=>{});},[usuarioAtual]);",
    "contagem de cadastros pendentes",
)
trocar(
    'title="Gestão de usuários" style={{background:"rgba(255,255,255,.1)",border:"none",color:"#fff",width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>👥</button>}',
    'title={pendentes>0?`Gestão de usuários — ${pendentes} cadastro(s) aguardando aprovação`:"Gestão de usuários"} style={{position:"relative",background:"rgba(255,255,255,.1)",border:"none",color:"#fff",width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>👥{pendentes>0&&<span style={{position:"absolute",top:-5,right:-5,background:"#ef4444",color:"#fff",borderRadius:10,fontSize:9,fontWeight:800,minWidth:15,height:15,lineHeight:"15px",textAlign:"center",padding:"0 3px"}}>{pendentes}</span>}</button>}',
    "selo de pendentes no botão de usuários",
)

# 9) a secretaria some do fluxo (não existe mais essa etapa)
trocar(
    "Corretor capta → Secretaria organiza → Precificação orienta → Backoffice valida → Latitude publica.",
    "Corretor capta → Precificação orienta → Backoffice valida → Latitude publica.",
    "remove 'Secretaria organiza' da frase do fluxo",
)

# 10) novo ícone da MyBroker no cabeçalho (losango azul, sem a placa preta nem o ® — a placa branca atrás do
#     ícone já vem do próprio cabeçalho, então o losango precisa ser azul, não branco)
trocar_regex(
    r'LOGO_MYBROKER_ICON="data:image/png;base64,[^"]+"',
    f'LOGO_MYBROKER_ICON="data:image/png;base64,{base64_de("logo_icone_azul.png")}"',
    "novo ícone no cabeçalho",
)

# 11) nova logo completa nos relatórios em PDF (sem a placa preta nem o ®)
trocar_regex(
    r'window\.__mbLogoFull="data:image/png;base64,[^"]+"',
    f'window.__mbLogoFull="data:image/png;base64,{base64_de("logo_horizontal_preto.png")}"',
    "nova logo nos relatórios em PDF",
)

# 12) botão visível para a diretoria mudar o perfil de alguém (antes só dava pra clicar na etiqueta colorida)
trocar(
    '''{u.id!==usuarioAtual.id&&(
                      <>
                        {u.status!=="ativo"&&u.status!=="convite_pendente"&&<button onClick={()=>alterarStatus(u.id,"ativo")}''',
    '''{u.id!==usuarioAtual.id&&(
                      <>
                        {editandoPerfil!==u.id&&<button onClick={()=>setEditandoPerfil(u.id)} style={{padding:"5px 11px",background:"#eef2ff",border:"none",borderRadius:6,fontFamily:"inherit",fontSize:10.5,fontWeight:700,cursor:"pointer",color:C.b2}}>Mudar perfil</button>}
                        {u.status!=="ativo"&&u.status!=="convite_pendente"&&<button onClick={()=>alterarStatus(u.id,"ativo")}''',
    "botão 'Mudar perfil' em Gestão de Usuários",
)

open(DESTINO, "w", encoding="utf-8").write(s)
print(f"\nGravado: {DESTINO} ({len(s):,} caracteres)")
