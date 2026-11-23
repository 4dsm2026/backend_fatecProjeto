import { expect, it } from 'vitest'
import { prepareTicketFixtures } from '../_setup/prepareTicketFixtures'
import { createTestApp } from '../_setup/createTestApp'
import { registerTicketScenarios } from './ticket-scenarios'
import { registerJ1 } from '../journeys/j1-ticket-lifecycle'

// Ambos os conjuntos usam a mesma API e o mesmo MySQL do globalSetup.
it('inicia a API compartilhada com banco conectado antes dos cenários', async () => {
  const { baseUrl } = await createTestApp()
  const response = await fetch(new URL('/health', baseUrl))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'ok', db: 'connected' })
})
registerTicketScenarios(prepareTicketFixtures)
registerJ1(prepareTicketFixtures)
