# ADR 0007 — Prospecção automática pela base aberta do CNPJ (Receita Federal)

**Status:** proposto (23/11/2026, pedido do proprietário: escolher a indústria, por exemplo
material hospitalar, e ver numa tabela as empresas compatíveis, com envio de e-mail e
WhatsApp e edição dos dados e dos textos pelo site; "quero apenas empresas reais")

## Contexto
O portal Argos (Lovable) tem um campo de prospecção que pede a um modelo de IA uma lista
de "10 a 20 empresas reais" a partir de resultados de busca na web. O modelo preenche
avaliações, coordenadas, faturamento, CNPJ e situação na Receita por estimativa: parte
desses dados pode ser inventada. A especificação do Rep360 proíbe inventar empresas ou
contatos e exige fonte e data. Fontes avaliadas:

| Fonte | Custo | Busca por CNAE/UF | Observação |
|---|---|---|---|
| Dados abertos do CNPJ (Receita) | grátis | sim (arquivos mensais) | base oficial completa, ~6 GB compactados |
| BrasilAPI / minhareceita | grátis | não (só por CNPJ) | já usada para preencher cadastro (ADR 0006) |
| Casa dos Dados, CNPJá, Econodata etc. | pago por consulta ou plano | sim | exige aprovação de custo |
| Google Maps / Places | pago após cota | por categoria | não traz CNPJ/CNAE; termos restringem armazenamento |
| IA + busca na web (modelo do portal Argos) | créditos de IA | não confiável | risco de dados inventados |

## Decisão
- Fonte: **dados abertos do CNPJ da Receita Federal**. Um importador
  (`scripts/importar-receita-cnpj.mjs`) baixa a publicação do mês, filtra só
  estabelecimentos **ativos** nas UFs dos territórios cadastrados e nos CNAEs-alvo das
  indústrias, junta a razão social (Empresas), casa o município da Receita com o código
  IBGE e grava em `ref.cnpj_establishments` (dado global de referência). Cada carga
  remove do recorte quem deixou de estar ativo e fica registrada em `ref.cnpj_imports`.
  Roda no GitHub Actions (`importar-receita.yml`, manual), dentro da cota gratuita.
- Usuários **não leem** `ref.cnpj_establishments` diretamente. `prospect_search` (SECURITY
  DEFINER) exige vínculo com o tenant e devolve só empresas com CNAE-alvo da indústria
  **dentro dos territórios** dela (minimização). E-mail e telefone bloqueados pela
  supressão do tenant não são devolvidos.
- `industries.target_cnaes` define quem é cliente de cada indústria; há um perfil pronto
  de material hospitalar (hospitais, clínicas, laboratórios, odontologia, imagem etc.).
- `prospect_add` (SECURITY INVOKER, RLS vale) leva a empresa à carteira: empresa, lead e
  um "Contato institucional" com o e-mail/telefone publicados no CNPJ, base legal
  legítimo interesse, finalidade prospecção, justificativa e origem com a referência da
  publicação; correção manual fica registrada na origem. Idempotente; auditado.
- Envio: **manual e sem custo**. O servidor confere `contact_eligibility` (agora com o
  canal WhatsApp, supressão por telefone e opt-out que bloqueia e-mail e telefone),
  acrescenta a frase de oposição ("responda SAIR"), registra a atividade e devolve um
  link `mailto:` ou `wa.me`. O usuário envia pelo próprio e-mail/WhatsApp.
- Textos editáveis por indústria e canal (`message_templates`), com variáveis
  (`{{empresa}}`, `{{cidade}}`...). Variável sem valor impede o envio.

## LGPD
E-mail e telefone do CNPJ são dados publicados pela Receita, mas podem pertencer a pessoa
física (MEI, empresário individual). Tratamento: legítimo interesse para prospecção B2B,
com justificativa gravada em cada contato, só para empresas do território e CNAE
atendidos, oposição a qualquer momento (o opt-out bloqueia e-mail e telefone), exclusão
mantendo a supressão. Sócios do QSA nunca viram contato. Recomenda-se o proprietário
validar o texto da justificativa com o jurídico antes do uso em escala.

## Consequências
- A tabela só fica cheia depois da primeira importação, que precisa do segredo
  `REP360_DATABASE_URL` no GitHub (decisão do proprietário).
- Disparo em massa por e-mail (Gmail OAuth, Fase 2) e por WhatsApp (Cloud API, custo por
  mensagem) ficam para decisão própria; esta etapa não envia nada sozinha.
- Municípios cujo nome na Receita difere do IBGE ficam sem código IBGE e só aparecem para
  territórios de estado inteiro; o importador informa quantos.
