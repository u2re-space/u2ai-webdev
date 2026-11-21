---
name: fest-lib
description: |
  API reference for the fest-live stack (@fest-lib/*): lure (reactive DOM/UI), ssre (SSR over
  Fastify), object (reactivity), core, dom, uniform, style-lib, icon, image.
  Trigger when the project uses or builds on @fest-lib/* packages, when the stack is `lure` or
  `ssre`, or when the task names lure / ssre / fest-lib / fest-live.
---

# The fest-live stack (fest-lib)

The house stack of reactive DOM. All packages are ESM-only, TypeScript-first, Node 20+. The
layering is fixed — a package imports only the ones below it:

```
core (0.5) ── dom · uniform · object (1) ── lure (2) ── icon · image
                └────────────── ssre (backend, never imports lure/dom)
```

- `@fest-lib/core` — `getValue`, type/empty guards, `createDeferred`, `debounce`, channels,
  mapped collections, WeakRef wrappers, DOM-ctor polyfills (window/worker/Node).
- `@fest-lib/object` — reactivity: `observe`, `affected`, refs (`numberRef`, `stringRef`,
  `booleanRef`, `autoRef`, `promised`, `propRef`), `computed`, `derivate`, `conditional`,
  `bindBy`/`assign`/`link`, `iterated`, `safe`. Subscriptions never retain the target;
  updates fire only on a real change. `affected(obj, cb)` (or `affected([obj, key], cb)`)
  returns an unsubscribe function — keep it and call it.
- `@fest-lib/uniform` — one channel API over workers/ports/BroadcastChannel/WebSocket:
  `createUnifiedChannel(name)` with `.expose`/`.connect`/`.proxy`; request/response through
  `createInvoker(channelName)` (the first argument is the string name, not an instance).
- `@fest-lib/dom` — Agate viewport/zoom/measure, decor (appear/shape/animation), style and
  behavior mixins, `loadInlineStyle(css, root?, layer?)` / `loadStyleSheet` (inject CSS
  without a bundler plugin).
- `@fest-lib/style-lib` — CSS-in-JS (`S` tagged template / `css`), Typed OM, adopted
  stylesheets, WAAPI helpers. Peer of lure.

## lure — client UI

```js
import { E, H, M, Q, T, C, S } from "@fest-lib/lure";
import { observe, iterated } from "@fest-lib/object";

const el = E("div", {
    attributes: { id: "app" },
    classList: new Set(["box"]),
    style: { padding: "8px" },
    on: { click: () => console.log("hi") },
}, ["Hello"]);

const items = iterated(["A", "B"]);
const list = H`<ul>${M(items, (x) => H`<li>${x}</li>`)}</ul>`;
items.push("C"); // the DOM updates
```

| API | Role |
|---|---|
| `E(tag \| node, props, children)` | create or wrap a node and bind it |
| `H\`html\`` / `H(" ")` | parse HTML or a tagged template |
| `M(list, mapFn)` | reactive list → nodes |
| `Q(selector, root?)` | live query wrapper |
| `T(string \| ref)` | text node |
| `C(ref, factory)` | swap the node when the ref changes |
| `S\`css\`` | controllable stylesheet (CSS-in-JS) |

`H` prefixes: `attr:*` attribute · `prop:*` property · `on:*` / `@*` event · `ref` / `ref:*`
assign. Overlays and triggers: `withTriggerModifiers`, `bindOutsideDismiss`,
`resolvePlacement` / `placeOverlay`, `registerTransientOverlay`. Forms: `formLink` /
`bindForms` / `FormBinding`; mount lifecycle is opt-in (`bindWhileConnected`). Drag:
`bindDraggable(target, onEnd)`. JSX is optional (`jsxFactory` → `createElement`).

House rules for lure:
- Build the DOM with the factories; do not write `.innerHTML` with string concatenation —
  prefer `H` templates, they parse and bind.
- Keep state in `@fest-lib/object` refs/observables; the nodes bind, they do not store.
- Lists render through `M` over `iterated`; never rebuild children by hand.
- Styles are plain CSS through `@fest-lib/style-lib` (`S`) or a stylesheet the project owns;
  class names stay in the stylesheet, the markup does not inline design values.
- Icons are `<ui-icon icon="house" icon-style="duotone">` from `@fest-lib/icon` (Phosphor
  names, OPFS-cached); define it once: `customElements.get("ui-icon") ||
  customElements.define("ui-icon", UIPhosphorIcon)`.

## ssre — server rendering

Backend-first sibling of lure: the same `E`/`H`/`M` ideas and object.ts refs, but the HTML is
rendered on the server. No DOM, no overlays, no drag. It must not import lure or dom.

```js
import Fastify from "fastify";
import { createHub, ssrePlugin, numberRef, E, M, observe } from "@fest-lib/ssre";

const hub = createHub();
const count = hub.store("count", numberRef(0));
hub.action("inc", () => { count.value += 1; });

const app = Fastify();
await app.register(ssrePlugin({ hub }));
app.get("/", (_, reply) => reply.ssre({
    title: "SSR.E",
    factory: () => E("main", {}, [
        E("p", {}, ["Count: ", count]),
        E("button", { on: { click: "inc" } }, "+1"),
    ]),
}));
```

- The document carries `#ssre-scenario` JSON and an inline hydrate script: the bindings stay
  live without lure. The optional frontend (lure / app modules) loads after the page.
- Live updates: SSE by default (`GET /ssre/channel`), `POST /ssre/channel` applies
  `{ t: "set" | "action" }`; WebSocket and socket.io are optional peers.
- CSS on the server is vanilla only: reactivity goes proxy refs → CSS custom properties —
  `cssVars({ "--pad": padRef }, { typed: { "--pad": "px" } }, hub)`; no SCSS in a ssre page.
- Icons: `Icon({ icon, src })` emits `<ui-icon>`; the drawing is the client `@fest-lib/icon`.
- Vite is supported through `ssreVite()` (`@fest-lib/ssre/vite`) when a bundler is wanted —
  the house scaffold does not add one: the server runs straight from the source (`tsx`).
- File access is sandboxed: `createFsRoot(dir)` (`@fest-lib/ssre/fs`) — paths cannot leave
  the root.

House rules for ssre:
- One hub per server; stores and actions live on the hub, not in module globals.
- The server renders the page; the client hydrates. Do not write a second DOM in a client
  script — bind to the scenario the server already shipped.
- Every interactive element goes through a hub action (`on: { click: "actionName" }`), not
  through ad-hoc fetch calls.

## Version pins (npm, checked 2026-11)

core 0.1.40 · dom 0.1.63 · object 0.1.53 · uniform 0.1.41 · style-lib 0.1.36 ·
lure 0.1.92 · ssre 0.1.21 · icon 0.1.41. The scaffold pins them with `^`; keep the pins
that the manifest already has — the installer adds what is missing, the roles never edit
versions.
