# Shared Studio draft source

Private internal source package; no public license grant is supplied. The package owns the canonical workflow graph/data/checkpoint/engine, guardrail helpers, draft-store `WorkspaceError`, and browser session transport used by native source prerequisites. Legacy Studio modules re-export these package exports rather than constructing competing schemas or error classes.

Build from the containing repository with `npm --prefix packages/studio-drafts run build`. The containing repository supplies its already locked TypeScript compiler and Node types. The package emits ordinary ESM plus declarations into `dist/`; the local `file:packages/studio-drafts` dependency exposes only declared dist entry points. Root build/typecheck/test lifecycle prerequisites build this package first. Do not rely on inherited dist or a fixture-only alias.

Runtime validation is pinned to Zod **3.25.76**. Studio already locks that release; OS keeps its existing root Zod **4.4.3** and locks Zod3 inside this local package. Never force-deduplicate these majors or pass OS Zod4 schema implementations into this package. OS-native artifact DTO schemas remain single-owned OS shared source and preserve their existing Zod4 expressions.

The mirrored package source in the two repositories must remain byte-identical. Compiled outputs are generated locally, not copied from a sibling checkout. The package is not a host mount, action grant, migration, retained feature owner or crash-recovery implementation. No package import initializes a draft store, provider, listener or native schema. `ImplementationError` is not declared by the supplied native source; its actual draft-store error class is `WorkspaceError`.
