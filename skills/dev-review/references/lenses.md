# Review lenses

Select only lenses relevant to the diff. Complexity, craft, and testing are mandatory. Each reviewer reads its matching file before inspecting the change.

| Lens file | Dispatch when the diff touches |
|---|---|
| [`lenses/complexity.md`](lenses/complexity.md) | Always |
| [`lenses/craft.md`](lenses/craft.md) | Always |
| [`lenses/testing.md`](lenses/testing.md) | Always |
| [`lenses/react.md`](lenses/react.md) | React components, hooks, context, or rendering |
| [`lenses/build-perf.md`](lenses/build-perf.md) | Frontend rendering, data fetching, dependencies, bundles, or build config |
| [`lenses/types.md`](lenses/types.md) | TypeScript |
| [`lenses/a11y.md`](lenses/a11y.md) | Interactive UI, forms, semantics, or focus behavior |
| [`lenses/design-eng.md`](lenses/design-eng.md) | New or changed visible UI |
| [`lenses/fe-security.md`](lenses/fe-security.md) | Browser trust boundaries, auth, URLs, HTML injection, or new frontend dependencies |
| [`lenses/language-runtime.md`](lenses/language-runtime.md) | Server-side code |
| [`lenses/distsys.md`](lenses/distsys.md) | Concurrency, remote calls, queues, retries, caching, or async work |
| [`lenses/data-layer.md`](lenses/data-layer.md) | SQL, schemas, migrations, ORMs, or transactions |
| [`lenses/be-security.md`](lenses/be-security.md) | Input, auth, serialization, paths, queries, crypto, or new backend dependencies |
| [`lenses/perf-ops.md`](lenses/perf-ops.md) | Hot paths, resource use, observability, or deployment |
