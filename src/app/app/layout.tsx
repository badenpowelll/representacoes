// Área autenticada: sempre renderizada por requisição (depende da sessão).
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
