import { buildApp } from "./app"

buildApp().then(app => {
  const PORT = Number(process.env.PORT) || 3333

  app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => app.log.info(`🚀 Server ouvindo na porta ${PORT}`))
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
})
