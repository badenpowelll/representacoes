# ADR 0007 — Identidade visual Argos Soluções

**Status:** aceito (23/11/2026, pedido do proprietário: "deixar mais profissionalizado, pode usar nosso design system e brand")

## Contexto
O Rep360 tinha o visual padrão do Tailwind (fundo branco, bordas pretas, botões azuis, menu em linha).
A Argos Soluções forneceu as Diretrizes de Marca (ago/2026), o Brandbook 2026 e o Argos Design
System 2.0 (biblioteca React com tokens e classes `ads-*`, não publicada no npm). Várias frentes
de trabalho editam as mesmas telas ao mesmo tempo, então reescrever cada página geraria conflitos.

## Decisão
- **Tokens no tema, não página a página.** `src/app/globals.css` traz as cores oficiais
  (Navy `#000F37`, Orange `#FF5D00`, Gray `#D1D2D2`, Rust `#B02500`, Tints) e os tokens
  semânticos do Design System 2.0. A paleta do Tailwind foi remapeada: `blue-*` vira o navy,
  `neutral-*` vira cinzas azulados, `red-600/700/800` vira o terracota. Estilos de base cobrem
  campos, botões com borda, cartões (`rounded-lg border`), tabelas e links. As classes
  utilitárias de cada tela continuam valendo por cima.
- **Componentes base:** `Button` primário em laranja com texto navy (branco sobre laranja tem
  contraste 3,1:1 e não é usado em texto), `Field`, `Alert` e `EmptyState` nas cores da marca.
  `AppShell` (`src/components/app-shell.tsx`) substitui o menu em linha por menu lateral agrupado
  com ícones, item ativo marcado em laranja, barra superior com representação e papel, e gaveta
  no celular.
- **Logo:** só o arquivo JPEG colorido foi fornecido. Usamos a versão a cores sobre fundo branco
  ou cinza claro (permitido pelo guia), com o fundo branco externo removido. Em fundo navy
  não aparece logo (o guia exige a versão monocromática branca, que ainda não existe); ali só
  texto. Não recriamos o wordmark ARGOS digitando o nome.
- **Tipografia:** a Argos Sans não foi fornecida; Inter (via `next/font`, auto-hospedada no
  build, sem custo) é a alternativa provisória indicada pelo Design System.
- **Tema escuro desligado por ora:** as variantes `dark:` só valem com `data-theme="dark"` no
  `<html>`. O tema escuro da marca ainda não foi homologado.
- O pacote `@argos/design-system` não foi instalado: não está publicado e o React 19 do Rep360
  não foi testado nele. Os tokens foram trazidos para o CSS do app; migrar para os componentes
  `ads-*` fica para quando o pacote for publicado.

## Consequências
- Telas novas herdam a identidade sem esforço; usar `bg-argos-*`/`text-argos-*` para cores da marca.
- Pendências: versão branca do logo, arquivos da Argos Sans, homologação do tema escuro.
