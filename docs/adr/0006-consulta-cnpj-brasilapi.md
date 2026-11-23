# ADR 0006 — Preenchimento automático por CNPJ (BrasilAPI)

**Status:** aceito (23/11/2026, pedido do proprietário: "tudo que for preenchido com CNPJ automatizar", com todos os dados disponíveis: razão social, endereço, telefone, sócios)

## Contexto
Indústrias, empresas (CRM) e prospects são cadastrados por CNPJ. Digitar razão social,
CNAE, endereço e UF/município à mão é lento e propenso a erro. A Receita Federal publica
esses dados como dados abertos; a BrasilAPI (`brasilapi.com.br/api/cnpj/v1/{cnpj}`)
os expõe de graça, sem chave. Existe um serviço pago de nome parecido ("APIBrasil"),
que **não** foi usado (nada com custo sem aprovação).

## Decisão
- A consulta roda **só no servidor** (`lookupCnpj`, server action). O navegador nunca
  fala com a API. O servidor valida vínculo e permissão (`crm.write` ou `catalog.write`)
  e os dígitos verificadores antes de chamar.
- A resposta é **dado não confiável**: validada com zod, campos truncados, CEP/telefone/
  e-mail/UF/IBGE/CNAE conferidos por formato; o CNPJ gravado é sempre o pedido, nunca o
  da resposta. Timeout de 8 s, limite de 512 KB, sem redirecionamento, corpo não vai a log.
- O resultado completo fica em `public.cnpj_registry`, **um registro por (tenant, CNPJ)**,
  com RLS por tenant como qualquer dado privado (leitura: todos os papéis; escrita: quem
  cadastra). Guarda campos estruturados (situação, abertura, natureza, porte, capital,
  CNAEs, endereço, telefones, e-mail, Simples/MEI, matriz/filial, quadro societário) e o
  JSON bruto. A consulta é reaproveitada por 30 dias; "Atualizar dados da Receita" força
  nova consulta. Se a API falhar, a última consulta salva é usada.
- No formulário, o campo CNPJ consulta ao completar 14 dígitos (ou ao sair do campo, ou
  pelo botão) e preenche só campos **vazios ou preenchidos por ele mesmo**: o que o usuário
  digitou é preservado. UF/município são preenchidos quando a UF está vazia. Situação
  diferente de ATIVA mostra alerta.
- Origem do dado (LGPD): quando vazia, vira "Receita Federal (dados abertos) via BrasilAPI".

## LGPD — quadro societário
O QSA traz nomes de pessoas físicas e CPF já mascarado pela Receita. Base legal: dados
tornados manifestamente públicos (art. 7º, §§ 3º e 4º), com finalidade de qualificação
comercial da empresa. Sócios **não** viram contatos nem entram em campanhas
automaticamente; para isso seria preciso cadastrá-los como contato com base legal própria.
A exclusão da representação apaga as consultas (cascade).

## Consequências
- Testes locais/e2e usam `CNPJ_API_BASE_URL` apontando para um servidor simulado; o
  override só vale com `APP_ENV=development` e host localhost.
- Sem limite de taxa próprio ainda: a BrasilAPI é de uso justo e responde 429 quando
  necessário (mensagem amigável). Pendente: limite por tenant e fila se o volume crescer.
- Pendente: provedor de reserva (ex.: outra fonte pública gratuita) caso a BrasilAPI fique
  instável; exclusão/retenção específica das consultas (hoje acompanham o tenant).

## Adendo (23/11/2026) — site e canais de contato editáveis
A pedido do proprietário ("me permitir editar site, telefone e e-mail; posso fazer
pesquisas e encontrar algo"), indústrias e empresas têm `website` e `contact_channels`
(lista de canais com tipo — telefone, WhatsApp, e-mail, endereço, outro —, rótulo livre
como Comercial/Licitações/Financeiro, e origem `receita` ou `manual`). Ficam na própria
entidade e **nunca** são alterados por uma nova consulta à Receita: a Receita só sugere
telefones e e-mail no cadastro. A origem é recalculada no servidor ao salvar (igual ao
dado da Receita → `receita`; senão `manual`). O banco valida o formato de cada canal
(`app.valid_contact_channels`). Canais são institucionais; pessoas seguem em `contacts`,
com base legal própria. Migration `20261123000200_contact_info.sql`.
