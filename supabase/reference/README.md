# Dados de referência globais

## `municipios_ibge.csv`

Snapshot dos municípios brasileiros usado pela migration `20261122001300_ref_municipios.sql`.

| Campo | Valor |
|---|---|
| Colunas | `ibge_code` (7 dígitos), `uf_ibge_code` (2 dígitos), `name` |
| Registros | 5.571 |
| Coletado em | 2026-11-22 |
| Fonte | Códigos e nomes do IBGE, obtidos pelo espelho público [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) (licença MIT), arquivo `csv/municipios.csv` |
| sha256 | `a87c1c148da9006335387d08cdec22212466eb907757bf2c85ff5be465fcc49a` |

**Por que o espelho e não a API do IBGE:** o ambiente em que o snapshot foi gerado não tinha acesso de rede a `servicodados.ibge.gov.br`. O espelho reproduz os códigos oficiais do IBGE. Recomenda-se conferir contra a API oficial (`/api/v1/localidades/municipios`) quando houver acesso; divergências devem gerar um novo snapshot.

Verificações feitas na geração (e repetidas pelo script):
- código com 7 dígitos, sem duplicatas;
- os 2 primeiros dígitos do código são o código IBGE da UF;
- todas as 27 UFs presentes.

O número de municípios **não** é invariante: emancipações criam municípios novos. Os testes exigem só mais de 5.500 e as 27 UFs.

### Como atualizar
1. Substitua o CSV mantendo o cabeçalho `ibge_code,uf_ibge_code,name`.
2. Atualize esta tabela (data, fonte, sha256, registros).
3. Gere uma **nova** migration (nunca edite uma já aplicada):
   `node scripts/gerar-migration-municipios.mjs > supabase/migrations/<timestamp>_ref_municipios_<data>.sql`
   A carga é idempotente (atualiza nomes, não apaga municípios que possam estar em uso).
