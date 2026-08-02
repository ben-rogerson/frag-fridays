// YouTube embed relay for the Frag Friday loading screen.
//
// YouTube refuses embeds whose embedding origin is an IP-literal http page
// (widget onError 150), which is exactly what the game server is. This
// Worker serves a tiny page on a real https domain (workers.dev) that hosts
// the actual YouTube iframe; the game page iframes THIS page instead, so
// YouTube sees an acceptable origin. postMessage traffic (widget API
// commands like mute/unMute, and infoDelivery/onError events back) is
// relayed transparently in both directions, so the client's sound toggle
// and error fallback work unchanged.
//
// Deploy: npx wrangler deploy  (from this directory)

const page = (v, start) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; }
</style>
</head>
<body>
<script>
  const v = ${JSON.stringify(v)};
  const start = ${JSON.stringify(start)};
  const f = document.createElement('iframe');
  f.src = 'https://www.youtube-nocookie.com/embed/' + v
    + '?autoplay=1&mute=1&controls=0&loop=1&playlist=' + v
    + '&start=' + start
    + '&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&enablejsapi=1'
    + '&origin=' + encodeURIComponent(location.origin);
  f.allow = 'autoplay; encrypted-media';
  document.body.appendChild(f);
  window.addEventListener('message', (e) => {
    if (e.source === window.parent) {
      f.contentWindow && f.contentWindow.postMessage(e.data, '*');
    } else if (e.source === f.contentWindow) {
      window.parent.postMessage(e.data, '*');
    }
  });
</script>
</body>
</html>`

export default {
  fetch(request) {
    const url = new URL(request.url)
    const v = (url.searchParams.get('v') || '').replace(/[^\w-]/g, '')
    const start = Math.max(0, parseInt(url.searchParams.get('start') || '0', 10) || 0)
    if (!v) return new Response('missing ?v=<videoId>', { status: 400 })
    return new Response(page(v, start), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  },
}
