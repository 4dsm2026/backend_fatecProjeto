# Cenários de integração de chamados

Os arquivos `ticket-scenarios.ts` e `../journeys/j1-ticket-lifecycle.ts` registram testes de API real. A execução temporária `tickets.real.ts` usa um MySQL descartável, migrations e login real; nenhum cenário usa mocks de Prisma ou da API. Ela ficará isolada até ser substituída pela infraestrutura compartilhada da equipe.

Com Docker Desktop aberto, na pasta do backend:

```bash
pnpm exec prisma generate
pnpm exec vitest run --config tests/integration/tickets/vitest.tickets.config.ts
```

Essa execução usa `mysql:8.0.39`, alinhada ao compose atual, e não faz parte de `pnpm test`. O container é descartado ao finalizar. O plano da equipe prevê posteriormente validar a migração para MySQL 8.4 e unificar todos os módulos em um único harness.

Em 12/11/2026, a suíte passou com 18 testes: criação e triagem de Outros, validação/autenticação, acesso e arquivamento, matriz de estados e papéis, mensagens, filtros/paginação, reabertura aos 29/30/31 dias e jornada J1.

Quando a infraestrutura estiver pronta, o arquivo de entrada de integração deverá chamar:

```ts
import { registerTicketScenarios } from "./tickets/ticket-scenarios";
import { registerJ1 } from "./journeys/j1-ticket-lifecycle";

// prepare vem da infraestrutura compartilhada e implementa PrepareTicketFixtures.
registerTicketScenarios(prepare);
registerJ1(prepare);
```

`prepare` deve limpar o banco descartável e criar, para cada teste, um setor com funcionário vinculado, dois alunos, um técnico, um backoffice e um administrador. Os tokens precisam vir de `POST /sessions` real. `setEncerradoEm` altera apenas a data no banco real do container, para preparar o cenário de prazo. As assinaturas estão em `fixtures.ts`.

O contrato de integração com a infraestrutura é uma proposta local de Matheus e deverá ser alinhado com Otávio e Rodrigo. Não instalar outro harness aqui nem misturar a configuração unitária com a de integração.

Os testes de 29 e 31 dias verificam os lados do prazo. O teste exato de 30 dias congela apenas `Date` durante a requisição e restaura o relógio em `finally`; os timers de rede continuam reais.
