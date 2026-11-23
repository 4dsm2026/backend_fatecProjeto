import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'

const messages = []
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET' && url.pathname === '/health') return res.end('{"ok":true}')
  if (req.method === 'GET' && url.pathname === '/__mailbox') {
    const to = url.searchParams.get('to')
    return res.end(JSON.stringify(to ? messages.filter(m => m.to.includes(to)) : messages))
  }
  if (req.method === 'DELETE' && url.pathname === '/__mailbox') {
    messages.length = 0
    res.statusCode = 204
    return res.end()
  }
  if (req.method === 'POST' && url.pathname === '/emails') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const to = Array.isArray(data.to) ? data.to : [data.to]
        if (!to.every(item => typeof item === 'string') || typeof data.html !== 'string') throw new Error('invalid')
        const id = randomUUID()
        messages.push({ id, to, subject: data.subject, html: data.html })
        res.statusCode = 200
        res.end(JSON.stringify({ id }))
      } catch {
        res.statusCode = 400
        res.end('{"message":"invalid email"}')
      }
    })
    return
  }
  res.statusCode = 404
  res.end('{"message":"not found"}')
}).listen(3000, '0.0.0.0')
