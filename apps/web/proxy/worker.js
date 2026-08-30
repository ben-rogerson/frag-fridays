// https front door for the game server: ff.benrogerson.dev -> VPS:27016.
//
// The client uses same-origin relative paths for everything (/websocket for
// WebRTC signalling, /valve.zip, the page itself), so a transparent reverse
// proxy is enough. fetch() passes WebSocket upgrades through to the origin,
// and game packets don't come through here at all - they flow over WebRTC
// data channels directly to the VPS, so the Worker only carries the page,
// the asset download and the signalling socket. Serving over https is what
// unlocks getUserMedia (mic voice) in the client.
//
// Deploy: npx wrangler deploy  (from this directory)

// Workers fetch() refuses IP-literal hosts (error 1003), so the VPS IP is
// spelled as an sslip.io hostname (resolves to the dashed IP, nothing more)
const ORIGIN = 'http://149-28-172-74.sslip.io:27016'

// /mcp/<secret> -> the MCP control plane (server/mcp on the box). The secret
// rides the URL path because claude.ai custom connectors can't set headers,
// which means it lands in Cloudflare request logs - rotate by editing
// /opt/cs16/mcp.env, `docker compose up -d` in /opt/cs16/mcp, and updating
// the connector URL. MCP traffic is POST (uncached) and the box replies
// Cache-Control: no-store, so the zone cache stays out of the way.
const MCP_ORIGIN = 'http://149-28-172-74.sslip.io:27017'

// The same box process also answers /admin-api/* - the back end for the
// client's secret admin route (/#/warroom). Its token travels in the
// x-ff-admin header (our own fetch can set one), so unlike /mcp/ nothing
// secret lands in the request logs.
const isControlPlane = (path) => path.startsWith('/mcp/') || path.startsWith('/admin-api/')

export default {
  fetch(request) {
    const url = new URL(request.url)
    // legacy domain redirects to ff, except /mcp/ - the claude.ai connector
    // is configured with the cs URL and won't follow redirects
    if (url.hostname === 'cs.benrogerson.dev' && !url.pathname.startsWith('/mcp/')) {
      url.hostname = 'ff.benrogerson.dev'
      return Response.redirect(url.toString(), 301)
    }
    const origin = isControlPlane(url.pathname) ? MCP_ORIGIN : ORIGIN
    return fetch(origin + url.pathname + url.search, request)
  },
}
