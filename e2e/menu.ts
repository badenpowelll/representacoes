import type { Page } from "@playwright/test";

/** Grupo do menu lateral de cada tela (o menu mostra só os grupos; os itens abrem ao clicar). */
const GROUP_OF: Record<string, string> = {
  Painel: "Visão geral",
  Contexto: "Visão geral",
  Indústrias: "Representação",
  Territórios: "Representação",
  Catálogos: "Representação",
  Produtos: "Representação",
  Empresas: "Comercial",
  Leads: "Comercial",
  Compatibilidade: "Comercial",
  Funil: "Comercial",
  Equipe: "Organização",
};

/** Navega pelo menu lateral, abrindo o grupo quando ele está recolhido. */
export async function openMenu(page: Page, item: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Principal" });
  const link = nav.getByRole("link", { name: item, exact: true });
  if (!(await link.isVisible())) {
    await nav.getByRole("button", { name: GROUP_OF[item] }).click();
  }
  await link.click();
}
