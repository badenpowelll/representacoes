import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rep360 — Inteligência comercial para representações",
  description: "Prospecção, catálogos e funil de vendas para empresas de representação comercial.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
