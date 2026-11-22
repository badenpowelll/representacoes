"use client";
import Link from "next/link";
import { useActionState } from "react";
import { initialState } from "@/lib/action-state";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requestPasswordReset, signIn, signUp, updatePassword } from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, initialState);
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-4" noValidate>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <input type="hidden" name="next" value={next ?? "/app"} />
      <Field label="E-mail" name="email"
        defaultValue={state.values?.email} type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" required error={state.fieldErrors?.password} />
      <SubmitButton pendingText="Entrando...">Entrar</SubmitButton>
      <p className="text-sm">
        <Link href="/recuperar-senha" className="underline">
          Esqueci minha senha
        </Link>{" "}
        ·{" "}
        <Link href="/cadastro" className="underline">
          Criar conta
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUp, initialState);
  if (state.ok) return <Alert kind="success">{state.message}</Alert>;
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-4" noValidate>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <Field label="Nome completo" name="full_name"
        defaultValue={state.values?.full_name} autoComplete="name" required error={state.fieldErrors?.full_name} />
      <Field label="E-mail" name="email"
        defaultValue={state.values?.email} type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <Field
        label="Senha"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="Mínimo de 10 caracteres."
        error={state.fieldErrors?.password}
      />
      <SubmitButton pendingText="Criando conta...">Criar conta</SubmitButton>
      <p className="text-sm">
        Já tem conta?{" "}
        <Link href="/entrar" className="underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action] = useActionState(requestPasswordReset, initialState);
  if (state.ok) return <Alert kind="success">{state.message}</Alert>;
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-4" noValidate>
      <Field label="E-mail" name="email"
        defaultValue={state.values?.email} type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <SubmitButton>Enviar link</SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useActionState(updatePassword, initialState);
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-4" noValidate>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <Field label="Nova senha" name="password" type="password" autoComplete="new-password" required error={state.fieldErrors?.password} />
      <SubmitButton>Salvar nova senha</SubmitButton>
    </form>
  );
}
