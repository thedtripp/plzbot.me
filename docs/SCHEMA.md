# Canonical fingerprint schema (v1)

This document is the source of truth for design intent; `src/shared/schema/types.ts` is the
enforced implementation. If they ever disagree, the code is a bug.

## Design goals recap

The schema must stay extensible, preserve raw data, separate normalization from derivation from
interpretation, explicitly represent absence, work for partial (non-browser) clients, and be
persistence-ready without being persisted in the MVP. Everything below is in service of those
goals; where a choice trades one goal against another, that trade-off is called out.

## The observation pipeline

```
raw observation → normalized value → derived attribute → interpretation / assessment
```

These are four distinct object shapes, not four fields on one object, because they have
different cardinalities and lifecycles: a single observation can feed multiple derived
attributes (e.g. the User-Agent string alone feeds a derived OS guess, a derived browser-family
guess, and a derived "engine" guess), and a single assessment typically cites several
observations *and* derived attributes across categories (e.g. an automation assessment citing
both `navigator.webdriver` and a TLS/UA mismatch).

## `Observation`

```ts
interface Observation<Raw = unknown, Normalized = unknown> {
  id: string;                 // stable dotted path, e.g. "http.headers.user_agent"
  category: SignalCategory;   // coarse grouping, see below
  source: "server" | "client";
  collectionMethod: string;   // e.g. "http_header", "tls_clienthello_raw",
                               // "navigator_property", "canvas_2d_render", "not_configured"
  status: ObservationStatus;  // "observed" | "unsupported" | "unavailable"
                               // | "not_applicable" | "error"
  raw: Raw | null;            // exactly what was received/measured; null iff status !== "observed"
  normalized: Normalized | null;
  error?: string;              // present iff status === "error"
  observedAt: string;          // ISO-8601 timestamp of this specific observation
}
```

Key decisions:

- **`status` is a closed enum, not a boolean "available" flag**, because "the browser doesn't
  support this API" (`unsupported`), "this client is not a browser so the question doesn't apply"
  (`not_applicable`), "we could ask but chose not to / infra doesn't expose it here"
  (`unavailable`), and "we tried and it threw" (`error`) are different facts with different
  educational value. Collapsing them into `null` would satisfy "don't crash" but violate "do not
  silently omit information and make it look as though it was never tested."
- **`raw` is preserved even when it looks useless**, e.g. a header string is stored verbatim
  alongside any parsed/normalized form, per the explicit instruction not to prematurely discard
  attributes because usefulness is uncertain.
- **`normalized` is nullable and separate from `raw`**, so a consumer can always tell whether a
  given value came from the wire or from our parsing logic — important because normalization can
  be wrong or lossy and a reviewer/educator needs to be able to check it against the source.
- **`id` is a flat dotted string, not a nested object path**, so that the interpretation layer
  and the signal catalog (`docs`/`interpret/catalog.ts`) can reference any observation by a
  single stable key regardless of where it lives in the response tree, and so new signals can be
  added without changing a discriminated union of "paths."

## `SignalCategory`

```
"network" | "tls" | "http" | "http2" | "client_hints"
| "browser.navigator" | "browser.screen" | "browser.hardware" | "browser.graphics"
| "browser.audio" | "browser.fonts" | "browser.media" | "browser.storage"
| "browser.apis" | "browser.automation"
```

Server-observed categories and client-observed categories are disjoint namespaces
(`browser.*` is always `source: "client"`), which is what lets the top-level `Fingerprint`
document keep `server` and `client` as separate optional trees while still allowing every
individual `Observation` to be looked up, filtered, or rendered generically by category without
the consumer needing to know which side of the client/server split produced it.

## `DerivedAttribute`

```ts
interface DerivedAttribute<Value = unknown> {
  id: string;                  // e.g. "derived.ja3_hash", "derived.os_guess"
  derivedFrom: string[];       // Observation ids (and/or other derived ids) it was computed from
  value: Value | null;
  method: string;               // human-readable description of the computation
  status: "computed" | "unavailable" | "error";
  error?: string;
}
```

Derived attributes are things we *compute*, as opposed to things we *observe* — a JA3 hash is a
derived attribute (computed by hashing several raw TLS observations together), not an
observation, even though it feels "raw" — because the hash doesn't exist on the wire, our code
produces it. This distinction matters for trust: an `Observation` is defensible as "this is what
the client sent"; a `DerivedAttribute` is defensible only as "this is what our algorithm computed
from what the client sent," which is a weaker and more contestable claim, and the schema makes
that provenance explicit via `derivedFrom` + `method`.

## `Assessment`

```ts
interface Assessment {
  id: string;
  category: "automation" | "consistency" | "identifiability" | "general";
  title: string;
  statement: string;            // plain-language, hedged interpretation
  confidence: "high" | "medium" | "low" | "informational";
  evidence: {
    observationIds: string[];
    derivedIds: string[];
  };
  conflicting?: boolean;         // true when evidence cited disagrees with itself
  references?: { title: string; url: string }[];
}
```

Assessments are produced by an explicit **rule engine** (`src/server/interpret/rules/*`), each
rule a pure function `(fingerprint) => Assessment[]`, so that "additional rules can easily be
added later" (spec §8) means literally "add a file that exports a function of that shape and
register it" — no shared mutable state, no ordering dependence between rules. This is also why
`confidence` has no numeric score: the spec explicitly warns against false certainty, and a
five-level qualitative scale is honest about what these rules can actually support (pattern
matches against known automation/UA strings), versus implying a calibrated probability we have no
statistical basis for.

## `Fingerprint` (top-level document)

```ts
interface Fingerprint {
  schemaVersion: "1.0.0";
  fingerprintId: string;        // random, per-request/session — NOT a stable device id
  generatedAt: string;
  request: RequestSummary;      // raw method/target/httpVersion, kept verbatim for audit
  server: {
    network: Observation[];
    tls: Observation[];
    http: Observation[];
    http2: Observation[];
    clientHints: Observation[];
  };
  client: {
    status: "not_submitted" | "submitted";
    navigator: Observation[];
    screen: Observation[];
    hardware: Observation[];
    graphics: Observation[];
    audio: Observation[];
    fonts: Observation[];
    media: Observation[];
    storage: Observation[];
    apis: Observation[];
    automation: Observation[];
  } | null;
  derived: DerivedAttribute[];
  interpretation: {
    assessments: Assessment[];
  };
}
```

- **`client` is `null`, not an empty object with empty arrays, until a submission arrives.** A
  curl request produces `client: null`. This is the schema-level embodiment of spec §4 ("client
  fingerprint, not browser fingerprint") — the absence of a browser is a first-class, valid state,
  not an error state and not indistinguishable from "the browser submitted nothing."
- Once a submission does arrive, `client.status` becomes `"submitted"`; arrays for signal groups
  the browser's collector could not run at all (rather than "ran and found unsupported") would
  still be present but empty — in practice this MVP's collector always attempts every group and
  records per-observation status, so per-group emptiness shouldn't occur, but the type allows it
  rather than assuming.
- **`fingerprintId` is explicitly documented as ephemeral**, not a cross-request device
  identifier, to avoid the schema itself implying persistent tracking capability that the MVP
  deliberately does not implement.

## Extensibility rules for future work

1. New signal → new `Observation` with a new `id`, added to the appropriate collector. No schema
   change required.
2. New computed value → new `DerivedAttribute`. No schema change required.
3. New interpretation → new rule function returning `Assessment[]`, registered in
   `src/server/interpret/rules/index.ts`. No schema change required.
4. New signal *category* (e.g. a future behavioral-biometrics category) → add one string to the
   `SignalCategory` union and one array to the relevant tree in `Fingerprint`. This is the only
   kind of change that touches the top-level type, and it's additive.
5. Persistence (future): a `Fingerprint` is already a plain JSON-serializable tree with no
   circular references and no server-only handles (sockets, streams) leaking into it — collectors
   are required to copy out primitive values, never pass through live objects — so persisting one
   is "insert this document," not a redesign. `fingerprintId` would become a foreign key; nothing
   else changes.
6. Population-level rarity/uniqueness (future): would consume `derived[]` values (which are
   already the canonicalized, comparable form) rather than raw observations, since raw values are
   too heterogeneous (arbitrary header casing, etc.) to aggregate directly.
