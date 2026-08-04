// Remote MCP server for the Frag Fridays box - claude.ai custom connector.
//
// Streamable HTTP, STATELESS (fresh transport per POST, no sessions): that's
// the simplest shape claude.ai's connector client tolerates, and it removes
// all session bookkeeping. One shared McpServer handles every request.
//
// Auth: claude.ai custom connectors can't set headers, so the secret rides
// the URL path - /mcp/<64-hex> - checked in constant time. Wrong secret gets
// a bare 404 (indistinguishable from an unknown path). Rotate by editing
// /opt/cs16/mcp.env and `docker compose up -d` in /opt/cs16/mcp, then update
// the connector URL.
import { createHash, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { McpServer } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { registerTools } from './tools.js'

const SECRET = process.env.MCP_SECRET
if (!SECRET) throw new Error('MCP_SECRET is not set (env_file /opt/cs16/mcp.env)')
const PORT = 27017

const sha = (s) => createHash('sha256').update(String(s)).digest()
const secretOk = (t) => timingSafeEqual(sha(t ?? ''), sha(SECRET))

const server = new McpServer({ name: 'frag-friday', version: '0.1.0' })
registerTools(server)

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.post('/mcp/:secret', async (req, res) => {
  if (!secretOk(req.params.secret)) return res.status(404).end()
  res.setHeader('Cache-Control', 'no-store') // the zone cache is aggressive
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => transport.close())
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})

// stateless mode has no GET event stream and no DELETE session teardown
app.all('/mcp/:secret', (req, res) => {
  res.status(secretOk(req.params.secret) ? 405 : 404).end()
})

app.use((req, res) => res.status(404).end())

app.listen(PORT, () => console.log(`[mcp] listening on :${PORT}`))
