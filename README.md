# AutoTab Insight MVP

MVP funcional para analise automatica de arquivos tabulares (CSV/XLSX/XLS), com foco em:

- leitura e normalizacao robusta de dados
- inferencia heuristica do tipo de dataset
- suporte a CSV baguncado de checklist/inspecao (incluindo estilo SafetyCulture)
- interpretacao semantica de respostas (sim/nao/pass/fail/conforme/na)
- revisao manual opcional de regras e pesos
- dashboards automaticos adaptativos
- insights e alertas textuais
- exportacao de resumo da analise

## Stack adotada

- **Next.js 16 + TypeScript**
- React para frontend
- API routes no proprio Next para backend do processamento
- `papaparse` + `xlsx` para leitura de arquivos
- `recharts` para dashboards

## Como rodar localmente

```bash
npm install
npm run dev
```

Acesse: `http://localhost:3000`

### Comandos uteis

```bash
npm run typecheck
npm run lint
npm run build
```

## Fluxo de uso

1. Entrar na pagina inicial e selecionar um arquivo CSV/XLSX/XLS.
2. Escolher modo:
   - **Analise rapida**: executa heuristicas automaticas.
   - **Analise revisada**: abre etapa opcional para revisar interpretacao e pesos.
3. Se desejar, ajustar:
   - modo de interpretacao binaria
   - comportamento de perguntas ambiguas
   - pesos por pergunta e por secao
   - criticidade de perguntas
4. Gerar analise final.
5. Consultar:
   - visao geral do arquivo
   - dashboards automaticos
   - resumo analitico
   - insights e alertas
   - previa dos dados interpretados
   - transparencia de regras aplicadas
6. Exportar resumo textual em `.txt`.

## Arquivos de exemplo

Pasta `samples/`:

- `sales_simple.csv`: exemplo limpo e geral de vendas.
- `inspection_messy_safetyculture_like.csv`: exemplo baguncado simulando exportacao de checklist/inspecao similar a SafetyCulture.

## Arquitetura resumida

### Backend (API)

- `app/api/analyze/route.ts`
  - recebe arquivo base64 + modo de analise + regras opcionais
  - executa pipeline:
    1. parse (`lib/parser.ts`)
    2. normalizacao (`lib/normalizer.ts`)
    3. inferencia (`lib/heuristics.ts`)
    4. analise e dashboards (`lib/analysis.ts`)
  - retorna resultado completo para UI

- `app/api/export-summary/route.ts`
  - gera arquivo textual do resumo (insights/alertas/transparencia)

### Frontend

- `app/page.tsx`: orquestra fluxo upload -> revisao opcional -> resultado
- `components/RuleReviewPanel.tsx`: revisao manual de regras/pesos
- `components/ResultsView.tsx`: apresentacao final do dashboard e analise
- `components/ChartRenderer.tsx`: renderer dinamico de widgets de grafico/tabela
- `components/StatCards.tsx`: cards executivos

### Nucleo analitico

- `lib/types.ts`: contratos tipados entre camadas
- `lib/parser.ts`: leitura robusta CSV/XLSX/XLS, inclusive com cabecalho deslocado
- `lib/normalizer.ts`: limpeza de headers, tratamento de vazios, deduplicacao de colunas
- `lib/heuristics.ts`: inferencia de tipo de dataset e funcoes auxiliares de inspecao
- `lib/analysis.ts`: metricas, widgets automaticos, insights, alertas e transparencia
- `lib/pipeline.ts`: composicao do fluxo backend

## Observacoes de robustez

- Se a classificacao tiver baixa confianca, o sistema sinaliza essa incerteza.
- Se houver estrutura ruim (muitos vazios/inconsistencias), gera alertas explicitos.
- Em checklist/inspecao, "sim" e "nao" nao sao tratados de forma ingenua:
  - a pergunta e analisada semanticamente (sentido positivo/negativo)
  - respostas sao convertidas em `falha real`, `nao falha`, `na`, `indeterminado`
- A analise revisada permite corrigir essas regras antes do dashboard final.
