"use client";
import { useActionState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { startTotpEnroll, verifyTotp, type EnrollState } from "./actions";

function CodeForm({ factorId, next, state, action }: { factorId: string; next: string; state: EnrollState; action: (f: FormData) => void }) {
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <Field label="Código de 6 dígitos" name="code" inputMode="numeric" autoComplete="one-time-code"
        maxLength={6} required error={state.fieldErrors?.code} defaultValue={state.values?.code} />
      <SubmitButton pendingText="Verificando...">Verificar</SubmitButton>
    </form>
  );
}

export function EnrollTotp({ next }: { next: string }) {
  const [enroll, start] = useActionState(startTotpEnroll, {});
  const [verify, check] = useActionState(verifyTotp, {});
  if (!enroll.factorId) {
    return (
      <form action={start} className="flex flex-col gap-4">
        {enroll.message && <Alert kind="error">{enroll.message}</Alert>}
        <SubmitButton pendingText="Gerando...">Configurar aplicativo autenticador</SubmitButton>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p>Escaneie o QR code no seu aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password etc.).</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL SVG gerada pelo Supabase Auth */}
      <img src={enroll.qrCode} alt="QR code para o aplicativo autenticador" width={200} height={200} className="rounded bg-white p-2" />
      <p className="text-sm">
        Sem câmera? Digite a chave: <code data-testid="totp-secret" className="break-all font-mono">{enroll.secret}</code>
      </p>
      <CodeForm factorId={enroll.factorId} next={next} state={verify} action={check} />
    </div>
  );
}

export function ChallengeTotp({ factorId, next }: { factorId: string; next: string }) {
  const [state, action] = useActionState(verifyTotp, {});
  return <CodeForm factorId={factorId} next={next} state={state} action={action} />;
}
