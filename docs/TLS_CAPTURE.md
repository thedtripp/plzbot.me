# TLS ClientHello capture (JA3/JA4)

## The problem

JA3/JA4 fingerprinting needs the *raw* ClientHello: the cipher suite list, extension list,
supported-groups list, etc., in the exact order the client sent them. Node's `tls` module parses
and terminates the handshake internally via OpenSSL and does not expose those raw bytes through
any public API — there's no `SNICallback`-style hook for "here's the whole ClientHello before I
touch it."

## What doesn't work

The obvious approach: accept the raw `net.Socket` yourself (via a plain `net.createServer`),
peek the first bytes with a one-off `'data'` listener, `socket.unshift()` them back so they're
not lost, then hand the *same* socket object to `https.createServer`/`http2.createSecureServer`
via `server.emit('connection', socket)` so it can do the real TLS handshake.

This was tested directly while building this project and reliably hangs the handshake — curl
times out, and eventually `tlsClientError`/`clientError: socket hang up` fires. The cause:
`tls.TLSSocket` doesn't consume its underlying socket through the ordinary Readable-stream
`'data'`/`'read'` interface; it re-parents the socket's low-level handle to drive the OpenSSL
state machine directly. That re-parenting assumes a handle nothing has read from yet. The moment
any code (including a one-shot peek) triggers Node's stream machinery into flowing mode, the
handle is no longer in the state `TLSSocket` expects, and the handshake silently stalls.

(By contrast, handing a peeked-and-unshifted socket to a *plain* `http.Server` this same way
works fine — confirmed in the same spike — because `http.Server` parses HTTP directly over
ordinary `'data'` events, the same mechanism used to peek it. The failure is specific to
`tls.TLSSocket`'s handle-stealing.)

## What this project does instead

`src/server/tls-capture/frontProxy.ts` runs a small in-process TCP proxy:

1. A plain `net.Server` (`FrontProxy`) accepts the real client connection on the public port.
2. It peeks and accumulates bytes until a full ClientHello can be parsed (`clientHello.ts`),
   computes JA3 (`ja3.ts`) and JA4 (`ja4.ts`) from it.
3. It opens a **new** loopback TCP connection to the real TLS-terminating server
   (`http2.createSecureServer`, `app.ts`), which listens normally on a loopback-only port. Every
   socket *that* server accepts came straight from the OS accept queue and has never been read
   from by any of our code — exactly the "virgin handle" `TLSSocket` needs — so the real
   handshake completes normally.
4. Bytes are piped through in both directions (`clientSocket.pipe(upstream); upstream.pipe(clientSocket)`).
5. **Correlating the loopback connection back to the real client:** the internal server only
   ever sees `127.0.0.1` as the peer address, so `req.socket.remoteAddress` would be useless on
   its own. Rather than injecting a PROXY-protocol-style header into the byte stream (which would
   just reintroduce the same handle-stealing problem on the *internal* server's side), the proxy
   binds its outbound loopback connection to a **locally chosen source port**
   (`net.connect({ localPort, ... })`) instead of letting the OS assign one. Because we chose that
   port ourselves, we can register `{ realIp, realPort, ja3, ja4, ... }` in an in-memory map
   *before* connecting, with no race condition. The internal server's `secureConnection` event
   reports that exact same port as `tlsSocket.remotePort` (same TCP 4-tuple), so the lookup is a
   deterministic map hit, not a guess. The property is attached directly to the `TLSSocket`
   object (not the pre-TLS raw socket — those are two different JS objects for the same
   connection, and `req.socket` in application code refers to the `TLSSocket`).

This was each verified against real `curl` requests over both HTTP/1.1 and HTTP/2 (`curl --http2`)
during development before being wired into the app; see git history / `tests/server/tlsCapture.*`
for the automated version of those checks.

## Limitations, honestly stated

- **Only applies when this app terminates TLS itself.** If deployed behind a TLS-terminating
  load balancer or CDN, none of this runs — the app never sees a ClientHello at all. In that
  deployment shape, TLS observations are reported as `unavailable` with
  `collectionMethod: "unavailable_infrastructure_terminated"`, and JA3/JA4 would need to come
  from whatever the infrastructure layer provides (e.g. some CDNs inject a JA3 header) — the
  schema's `collectionMethod` field distinguishes `self_observed_clienthello` from an
  infrastructure-supplied value for exactly this reason (see docs/SCHEMA.md).
- **A single extra loopback hop per connection.** Negligible latency locally; noted for
  completeness since it's a real architectural cost, not a free abstraction.
- **The correlation port range is a fixed pool** (see `LOCAL_PORT_RANGE_START/SIZE` in
  `frontProxy.ts`), sized generously for a local educational tool. A high-throughput production
  deployment would want a larger or dynamically sized pool; this MVP does not need one.
- **JA4 is a best-effort reproduction of the published spec**, not validated against FoxIO's
  reference implementation on a large traffic corpus — see the header comment in `ja4.ts`.
