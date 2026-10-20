# Integração de imóveis e placas — fase 1

Esta branch preserva o BrokerFlow atual. Não substitui a tela/mapa de placas publicado no Latitude (o código dessa tela não consta do repositório analisado). Não inclui SDR.

## Endpoints internos (sessão BrokerFlow obrigatória)

- `GET /api/placas/imoveis?page=1&limit=30&agencia=zona_sul` — diretoria, backoffice ou gerente.
- `POST /api/placas/imoveis` — importar lote JSON de 1 a 200 imóveis; diretoria/backoffice.
- `GET /api/placas/vinculos` — listar associações; diretoria/backoffice/gerente.
- `PUT /api/placas/vinculos` — associar uma placa existente ao código de imóvel já importado; diretoria/backoffice.

Exemplo de importação:

```json
{"imoveis":[{"codigo":"390351","agencia":"santa_monica","valor":650000}]}
```

Exemplo de vínculo:

```json
{"placaId":"placa-001","codigoImovel":"390351"}
```

O identificador `placaId` deverá ser exatamente o identificador persistido pelo mapa existente, após acesso ao código dele. Esses endpoints **não** criam placas, coordenadas ou interface.

## Relatórios Locare (20/10/2026)

Foram extraídas linhas com código e preço dos dois PDFs, gerando o arquivo de importação em CSV separado. A extração automática reconheceu 1.689 registros de Santa Mônica e 1.520 da Zona Sul, ante os totais anunciados nos cabeçalhos de 1.692 e 1.522. **Faltam 5 linhas para conferência manual; o CSV não é um espelho integral garantido dos relatórios.** Não incluir nome/telefone de proprietário ou captador na base pública.

## Validações antes de produção

1. Conferir as cinco linhas não recuperadas e os valores do CSV com a origem.
2. Confirmar banco `DATABASE_URL` de produção e executar backup.
3. Validar autenticação/perfis e importação em ambiente de teste; importar lotes de até 200 registros.
4. Localizar o código atual do mapa de placas instalado no Latitude; integrar usando IDs reais, sem recriar o mapa.
5. Testar controle de acesso, listagem e vínculo antes de qualquer merge/publicação.

Nenhuma alteração na branch main ou no deploy Latitude é feita nesta fase.
