// https front door for the game server: cs.benrogerson.dev -> VPS:27016.
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

export default {
  fetch(request) {
    const url = new URL(request.url)
    return fetch(ORIGIN + url.pathname + url.search, request)
  },
}
