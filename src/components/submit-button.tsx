"use client";
import { useFormStatus } from "react-dom";
import { Button } from "./ui";

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (pendingText ?? "Enviando...") : children}
    </Button>
  );
}
