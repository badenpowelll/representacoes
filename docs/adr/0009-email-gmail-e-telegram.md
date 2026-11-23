# ADR 0009 — Envio pelo Gmail, robô de respostas e bot do Telegram

Status: aceito (23/11/2026). Pedido do Baden: a representação usa Google Workspace, quer
enviar pelo sistema com texto padrão e assinatura próprios, ser avisado na hora no
Telegram quando um cliente responder e responder pelo próprio Telegram.

## Decisão

- **Envio**: API do Gmail com OAuth (authorization code + PKCE S256 + state) da conta de
  cada usuário. Para Workspace, o administrador cria um app OAuth **interno** (gratuito, sem
  verificação do Google). Escopos: `gmail.send` e `gmail.readonly`. O refresh token fica
  cifrado (AES-256-GCM, `EMAIL_TOKEN_KEY`) e não é legível pelo navegador.
- **Checagens antes de todo envio** (`email_prepare_send`): papel, contato da empresa,
  elegibilidade (base legal, finalidade, oposição), supressão do endereço efetivo e limite
  de 500 por usuário em 24 h. Chave de idempotência: o mesmo envio nunca sai duas vezes; só
  um envio que falhou pode ser repetido.
- **Modo de teste**: sem `EMAIL_SENDING=gmail` e credenciais, tudo é registrado e nada sai.
- **Texto padrão**: modelo da indústria → padrão da representação (`message_defaults`) →
  padrão do sistema. Assinatura em `commercial_contexts.email_signature`.
- **Robô de respostas**: o Gmail avisa um tópico do Pub/Sub (camada gratuita) que chama
  `/api/email/gmail/push?token=…`. O aviso não é confiável: só dispara a leitura incremental
  (`history.list`) da conta. Só são guardadas mensagens de conversas (`threadId`) que o
  sistema iniciou, de remetentes que não são a própria conta, e que não são automáticas.
  Uma rotina diária da Vercel renova o aviso (vale 7 dias) e lê as caixas de novo.
- **Telegram**: bot oficial (gratuito). O usuário liga o chat com código de uso único
  (hash no banco, 15 min). O webhook exige o `secret_token` combinado e conversa privada.
  Responder a um aviso envia o texto pelo Gmail, na mesma conversa (`threadId`,
  `In-Reply-To`, `References`), com a assinatura, passando pelas mesmas checagens como o
  próprio usuário (`app.act_as` + `email_prepare_send`). Só o chat ligado ao dono da conexão
  pode responder.
- **Oposição**: resposta que começa com "SAIR" (ou equivalentes) registra a oposição do
  contato e suprime o endereço na hora; respostas seguintes pelo bot são recusadas.
- **Chave de serviço**: usada só nos webhooks e na rotina, chamando funções `svc_*`
  concedidas apenas a `service_role`.

## Consequências

- Conteúdo de e-mails é dado não confiável: guardado e mostrado como texto, nunca
  interpretado; o aviso no Telegram vai sem formatação.
- Contas conectadas antes do escopo de leitura precisam conectar de novo para o robô.
- Não testado contra Google e Telegram reais (hosts bloqueados no ambiente de
  desenvolvimento e credenciais ainda não criadas). Lógica coberta por testes de banco e
  unitários.

## Configuração (Baden / administrador do Workspace)

1. Google Cloud: criar projeto, ativar Gmail API e Pub/Sub, tela de consentimento
   **Interna**, cliente OAuth "Aplicativo da Web" com redirect
   `https://SEU-APP/api/email/google/callback`.
2. Pub/Sub: tópico `rep360-gmail`; dar a `gmail-api-push@system.gserviceaccount.com` o papel
   "Publicador do Pub/Sub" no tópico; assinatura **push** para
   `https://SEU-APP/api/email/gmail/push?token=GMAIL_PUSH_SECRET`.
3. Telegram: @BotFather → `/newbot`; depois
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://SEU-APP/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`.
4. Vercel: cadastrar as variáveis do `.env.example` (seção e-mail, robô e Telegram) e
   `SUPABASE_SERVICE_ROLE_KEY`.
