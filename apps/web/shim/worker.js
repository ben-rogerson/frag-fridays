// YouTube embed relay for the Frag Friday loading screen.
//
// YouTube refuses embeds whose embedding origin is an IP-literal http page
// (widget onError 150), which is exactly what the game server is. This
// Worker serves a tiny page on a real https domain (workers.dev) that hosts
// the actual YouTube iframe; the game page iframes THIS page instead, so
// YouTube sees an acceptable origin. postMessage traffic (infoDelivery and
// onError events) is relayed transparently in both directions, so the
// client's dead-embed fallback works unchanged.
//
// The player keeps its own controls: unmute, next/previous track and
// fullscreen are YouTube's, not ours. That needs clicks to reach the inner
// iframe (no pointer-events: none) and fullscreen delegated down BOTH
// hops - the game page's iframe allows it into this page, and the iframe
// below allows it into YouTube.
//
// Each load starts on a random track. YouTube's embed URL can only take a
// fixed &index=, and nothing server-side knows how long the playlist is,
// so the jump happens over the widget API instead: the player reports its
// playlist as an array of ids, and playVideoAt lands on one of them. That
// keeps working as tracks are added to or removed from the playlist.
//
// Deploy: npx wrangler deploy  (from this directory)

const page = (list) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<script>
  const list = ${JSON.stringify(list)};
  const f = document.createElement('iframe');
  // muted autoplay is the only autoplay browsers allow without a gesture;
  // the viewer unmutes with the player's own control
  f.src = 'https://www.youtube-nocookie.com/embed/videoseries'
    + '?list=' + list
    + '&autoplay=1&mute=1&loop=1'
    + '&playsinline=1&rel=0&iv_load_policy=3&enablejsapi=1'
    + '&origin=' + encodeURIComponent(location.origin);
  f.allow = 'autoplay; encrypted-media; fullscreen';
  f.allowFullscreen = true;
  document.body.appendChild(f);

  // Random track. The widget only reports anything after a 'listening'
  // handshake, and the game page sends its own, but the shim must also
  // work opened directly - so it beats until the playlist array turns up.
  // The first report lands while the player is still cueing, so the jump
  // happens before playback rather than as a visible skip. Anything that
  // goes wrong here (no array, one-track playlist) just leaves the
  // playlist starting at the top.
  var jumped = false;
  window.addEventListener('message', function (e) {
    if (jumped || e.source !== f.contentWindow || typeof e.data !== 'string') return;
    try {
      var list = JSON.parse(e.data).info.playlist;
      if (!Array.isArray(list) || list.length < 2) return;
      jumped = true;
      f.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: 'playVideoAt',
        args: [Math.floor(Math.random() * list.length)],
      }), '*');
    } catch (err) { /* not a widget message */ }
  });
  var beat = setInterval(function () {
    if (jumped) return clearInterval(beat);
    f.contentWindow && f.contentWindow.postMessage(
      JSON.stringify({ event: 'listening', id: 'shim', channel: 'widget' }), '*');
  }, 400);
  setTimeout(function () { clearInterval(beat); }, 15000);

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

// default lets the bare URL show the loading-screen playlist for a quick check
const DEFAULT_LIST = 'PLvwKS1s3ePT9xTAxDVGON6RAutiBm4hoZ'

export default {
  fetch(request) {
    const url = new URL(request.url)
    const list =
      (url.searchParams.get('list') || '').replace(/[^\w-]/g, '') || DEFAULT_LIST
    return new Response(page(list), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  },
}
