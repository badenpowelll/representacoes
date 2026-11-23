/**
 * Perfis de busca prontos: CNAEs que costumam comprar de cada tipo de indústria.
 * Ponto de partida editável; a representação ajusta na tela de Prospecção.
 */
export type ProspectPreset = { key: string; label: string; segment: string; cnaes: string[] };

export const PROSPECT_PRESETS: ProspectPreset[] = [
  {
    key: "material-hospitalar",
    label: "Material hospitalar",
    segment: "Saúde",
    cnaes: [
      "8610101", // hospitais
      "8610102", // pronto-socorro e urgência
      "8630501", // ambulatório com procedimentos cirúrgicos
      "8630502", // ambulatório com exames complementares
      "8630503", // consultórios e clínicas (consultas)
      "8630504", // odontologia
      "8640202", // laboratórios clínicos
      "8640203", // diálise e nefrologia
      "8640205", // diagnóstico por imagem
      "8711502", // instituições de longa permanência para idosos
      "8621601", // UTI móvel
      "4773300", // varejo de artigos médicos e ortopédicos
    ],
  },
];

export function findPreset(key: string | null | undefined): ProspectPreset | undefined {
  return PROSPECT_PRESETS.find((p) => p.key === key);
}

/** "8610-1/01, 8630503 e 4771701" → códigos de 7 dígitos únicos, na ordem. */
export function parseCnaeList(text: string): { codes: string[]; invalid: string[] } {
  const tokens = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    const d = t.replace(/\D/g, "");
    if (/^\d{7}$/.test(d)) {
      if (!codes.includes(d)) codes.push(d);
    } else invalid.push(t);
  }
  return { codes, invalid };
}

export function formatCnae(code: string): string {
  return /^\d{7}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4, 5)}/${code.slice(5)}` : code;
}
