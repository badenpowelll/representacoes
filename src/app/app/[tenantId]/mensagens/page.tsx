import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui";
import { googleConfig, sendingMode } from "@/lib/email/google";
import { hasTokenKey } from "@/lib/email/crypto";
import { loadTenantTemplates } from "@/lib/mensagens/load";
import { PURPOSE_LABELS, SYSTEM_TEMPLATES, type Purpose } from "@/lib/mensagens/templates";
import { CATALOG_VARIABLES } from "@/lib/catalogos/envio";
import { TEMPLATE_VARIABLES } from "@/lib/prospeccao/messages";
import { telegramConfig } from "@/lib/telegram/bot";
import { createTelegramLink, disconnectGmail, resetDefaultTemplate, saveDefaultTemplate, saveSignature, unlinkTelegram } from "./actions";

export const metadata = { title: "Mensagens · Rep360" };

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";
const GMAIL_MSG: Record<string, { kind: "success" | "error" | "info"; text: string }> = {
  conectado: { kind: "success", text: "Conta Google conectada. Os e-mails passam a sair por ela." },
  desconectado: { kind: "info", text: "Conta Google desconectada e acesso revogado." },
  cancelado: { kind: "info", text: "Conexão cancelada no Google." },
  nao_configurado: { kind: "error", text: "O envio pelo Google ainda não foi configurado no servidor (veja as instruções abaixo)." },
  sem_refresh: { kind: "error", text: "O Google não liberou o acesso contínuo. Remova o Rep360 em myaccount.google.com/permissions e conecte de novo." },
  estado_invalido: { kind: "error", text: "A conexão expirou ou veio de outra sessão. Tente de novo." },
  sem_permissao: { kind: "error", text: "Seu papel não permite conectar e-mail de envio." },
  falhou: { kind: "error", text: "Não foi possível concluir a conexão com o Google. Tente de novo." },
};
const ERR: Record<string, string> = {
  permissao: "Só administradores e gerentes editam os textos padrão.",
  texto: "Confira o texto (mínimo de 10 caracteres) e o assunto do e-mail.",
  assinatura: "A assinatura pode ter até 1.000 caracteres.",
  salvar: "Não foi possível salvar. Tente de novo.",
  permissao_tg: "Seu papel não permite responder clientes pelo Telegram.",
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ gmail?: string; erro?: string; salvo?: string; restaurado?: string; tg?: string; telegram?: string }>;
}) {
  const { tenantId } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(tenantId);
  const editable = can(ctx.role, "catalog.write");
  const supabase = await createSupabaseServerClient();
  const [templates, { data: conns }, { data: sent }, { data: tgLink }] = await Promise.all([
    loadTenantTemplates(supabase, tenantId),
    supabase.from("email_connections").select("user_id, email_address, status, last_error, connected_at, reads_inbox").eq("tenant_id", tenantId),
    supabase
      .from("email_messages")
      .select("id, to_address, subject, status, created_at, from_address, error")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("telegram_links").select("username, linked_at").eq("tenant_id", tenantId).eq("user_id", ctx.userId).maybeSingle(),
  ]);
  const tg = telegramConfig();
  const tgCode = sp.tg && /^[A-Za-z0-9_-]{16,64}$/.test(sp.tg) ? sp.tg : null;
  const mine = conns?.find((c) => c.user_id === ctx.userId && c.status !== "revoked");
  const mode = sendingMode();
  const configured = Boolean(googleConfig()) && hasTokenKey();
  const gm = sp.gmail ? GMAIL_MSG[sp.gmail] : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Mensagens</h1>
        <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
          Textos padrão e assinatura desta representação, usados na prospecção e no envio de catálogos, e a conta de e-mail que envia
          direto pelo sistema.
        </p>
      </div>
      {gm && <Alert kind={gm.kind}>{gm.text}</Alert>}
      {sp.erro && ERR[sp.erro] && <Alert kind="error">{ERR[sp.erro]}</Alert>}
      {sp.salvo && <Alert kind="success">{sp.salvo === "assinatura" ? "Assinatura salva." : "Texto padrão salvo."}</Alert>}
      {sp.restaurado && <Alert kind="info">Voltou ao texto padrão do sistema.</Alert>}

      <section aria-labelledby="conta" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="conta" className="font-medium">E-mail de envio (Google Workspace)</h2>
        <p className="text-sm">
          Modo atual:{" "}
          <strong>{mode === "gmail" ? "envio real pelo Gmail" : "teste (os e-mails são registrados, mas não saem)"}</strong>
        </p>
        {mine ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Conectado como <strong>{mine.email_address}</strong>
              {mine.status === "error" && <span className="text-red-700 dark:text-red-300"> · acesso expirado, conecte de novo</span>}
            </span>
            {mine.status === "error" && configured && (
              <a href={`/api/email/google/start?tenant=${tenantId}`} className="rounded-md border px-3 py-1">Conectar de novo</a>
            )}
            <form action={disconnectGmail}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <button className="rounded-md border px-3 py-1">Desconectar</button>
            </form>
          </div>
        ) : configured ? (
          <a href={`/api/email/google/start?tenant=${tenantId}`} className="self-start rounded-md bg-blue-700 px-4 py-2 font-medium text-white">
            Conectar conta Google Workspace
          </a>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Para enviar de verdade, o administrador do Google Workspace cria um app OAuth interno (gratuito) e as credenciais são
            cadastradas no servidor (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, EMAIL_TOKEN_KEY e EMAIL_SENDING=gmail). Até lá, o
            botão &quot;Enviar pelo sistema&quot; funciona em modo de teste.
          </p>
        )}
        <p className="text-xs text-neutral-500">
          Permissões pedidas ao Google: enviar e-mails e ler a caixa só para achar respostas às conversas que o sistema começou (nada é
          apagado nem alterado, e os outros e-mails são ignorados). O acesso fica cifrado no servidor e pode ser revogado aqui ou em
          myaccount.google.com/permissions. Limite: 500 envios por usuário a cada 24 horas.
        </p>
      </section>

      <section id="telegram" aria-labelledby="telegram-h" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="telegram-h" className="font-medium">Avisos e respostas pelo Telegram</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Quando um cliente responder um e-mail que você enviou pelo sistema, o aviso chega na hora no seu Telegram. Para responder, toque em
          Responder na mensagem e escreva: o texto sai pelo seu Gmail, na mesma conversa, com a sua assinatura. Se o cliente responder
          &quot;SAIR&quot;, a oposição é registrada sozinha. Gratuito.
        </p>
        {sp.telegram === "desligado" && <Alert kind="info">Telegram desligado. Você não recebe mais avisos.</Alert>}
        {!tg ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Ainda não configurado no servidor: crie o bot no @BotFather (gratuito) e cadastre TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME e
            TELEGRAM_WEBHOOK_SECRET.
          </p>
        ) : tgLink ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Ligado{tgLink.username ? <> como <strong>@{tgLink.username}</strong></> : null} desde{" "}
              {new Date(tgLink.linked_at as string).toLocaleDateString("pt-BR")}
              {mine && !mine.reads_inbox && <span className="text-amber-700 dark:text-amber-300"> · conecte a conta Google de novo para liberar a leitura das respostas</span>}
            </span>
            <form action={unlinkTelegram}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <button className="rounded-md border px-3 py-1">Desligar</button>
            </form>
          </div>
        ) : tgCode ? (
          <div className="flex flex-col gap-2 text-sm">
            {tg.username && (
              <a href={`https://t.me/${tg.username}?start=${tgCode}`} target="_blank" rel="noreferrer" className="self-start rounded-md bg-blue-700 px-4 py-2 font-medium text-white">
                Abrir o Telegram e ligar
              </a>
            )}
            <p>
              Ou envie ao bot{tg.username ? <> @{tg.username}</> : null}: <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">/start {tgCode}</code>{" "}
              (vale 15 minutos, uma vez só). Depois, recarregue esta página.
            </p>
          </div>
        ) : (
          <form action={createTelegramLink}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <button className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white">Ligar Telegram</button>
          </form>
        )}
      </section>

      <section aria-labelledby="assinatura" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="assinatura" className="font-medium">Assinatura de e-mail da representação</h2>
        <form action={saveSignature} className="flex flex-col gap-2">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <label htmlFor="email_signature" className="sr-only">Assinatura</label>
          <textarea id="email_signature" name="email_signature" rows={4} maxLength={1000} defaultValue={templates.signature ?? ""}
            disabled={!editable} className={input} placeholder={"Equipe Comercial\nSua Representação\n(84) 99999-0000"} />
          <p className="text-xs text-neutral-500">Entra no fim de todo e-mail, antes da linha &quot;responda SAIR&quot;.</p>
          {editable && <button className="self-start rounded-md border px-3 py-2">Salvar assinatura</button>}
        </form>
      </section>

      <section aria-labelledby="textos" className="flex flex-col gap-4">
        <h2 id="textos" className="font-medium">Textos padrão da representação</h2>
        <p className="text-xs text-neutral-500">
          Variáveis: {TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(", ")}; no catálogo também{" "}
          {CATALOG_VARIABLES.filter((v) => !TEMPLATE_VARIABLES.some((t) => t.key === v.key)).map((v) => `{{${v.key}}}`).join(", ")}. Um
          modelo salvo numa indústria (na Prospecção) vale só para ela e tem prioridade.
        </p>
        {(["prospeccao", "catalogo"] as Purpose[]).flatMap((purpose) =>
          (["email", "whatsapp"] as const).map((channel) => {
            const t = templates[purpose][channel];
            const custom = t !== SYSTEM_TEMPLATES[purpose][channel];
            const id = `${purpose}-${channel}`;
            return (
              <form key={id} action={saveDefaultTemplate} aria-labelledby={`t-${id}`} className="flex flex-col gap-2 rounded-lg border p-4">
                <h3 id={`t-${id}`} className="text-sm font-medium">
                  {PURPOSE_LABELS[purpose]} · {channel === "email" ? "E-mail" : "WhatsApp"}{" "}
                  <span className="font-normal text-neutral-500">({custom ? "texto da representação" : "padrão do sistema"})</span>
                </h3>
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="purpose" value={purpose} />
                <input type="hidden" name="channel" value={channel} />
                {channel === "email" && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span>Assunto</span>
                    <input name="subject" defaultValue={t.subject ?? ""} maxLength={200} disabled={!editable} className={input} />
                  </label>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  <span>Texto</span>
                  <textarea name="body" rows={channel === "email" ? 9 : 3} defaultValue={t.body} maxLength={5000} disabled={!editable} className={input} />
                </label>
                {editable && (
                  <div className="flex gap-2">
                    <button className="rounded-md border px-3 py-2">Salvar texto</button>
                    {custom && (
                      <button formAction={resetDefaultTemplate} className="rounded-md px-3 py-2 text-sm underline">Voltar ao padrão do sistema</button>
                    )}
                  </div>
                )}
              </form>
            );
          }),
        )}
      </section>

      <section aria-labelledby="historico" className="flex flex-col gap-2">
        <h2 id="historico" className="font-medium">Últimos e-mails enviados pelo sistema</h2>
        {!sent?.length ? (
          <p className="text-sm text-neutral-500">Nenhum ainda.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {sent.map((m) => (
              <li key={m.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>{m.subject} → {m.to_address}</span>
                <span className="text-neutral-500">
                  {{ sent: "enviado", sandbox: "teste (não saiu)", failed: "falhou", queued: "na fila" }[m.status as string]} ·{" "}
                  {new Date(m.created_at).toLocaleString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
