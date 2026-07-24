# Backend limitations

Neither backend provides a fully reliable “native DOM” equivalent.

The core issue is that **both depend on macOS Accessibility**, which is a dynamic graph supplied by the application—not a stable, standards-based tree like a browser DOM.

### Simulang

Its main observed limitation is traversal behavior:

- Outlook’s AX graph contains duplicate/cyclic relationships.
- Simulang’s depth-first walker revisits those nodes.
- It can exhaust `maxNodes` before reaching Message List.
- Breadth-first traversal works, so the underlying elements are accessible.
- Some child-read failures appear as empty children, making diagnosis difficult.

This looks fixable or containable through better traversal, deduplication, and diagnostics.

### CUA Driver

Its main limitations are snapshot consistency and action delivery:

- It sometimes returns a recursive menu-only snapshot without the Message List.
- Snapshot indices and tokens are ephemeral.
- Outlook rows do not expose `AXPress`, requiring a foreground coordinate click.
- Structural extraction paths can become stale.
- Screenshot-only targets cannot yet become durable cached actions.

Our cache layer already handles ephemeral handles and stale recipes. The malformed snapshot is the harder upstream issue.

### The practical difference

CUA Driver is currently preferred because, despite its limitations, it has repeatedly produced a finite snapshot containing the Message List and completed live extraction.

Simulang may be closer than we previously thought: breadth-first search reaches the same tree. Once we fix our traversal strategy, it may also complete the workflow.

So the current decision is not:

> CUA works; Simulang is incapable.

It is:

> Both are imperfect AX clients. CUA has completed bounded live Outlook runs,
> but all-Inbox completion and extraction healing remain unreliable. Simulang
> has a reproduced traversal problem with a promising workaround.

---

This is the canonical record of known Simulang and CUA Driver limitations for
the native Outlook workflow. It distinguishes backend behavior from Outlook,
macOS Accessibility (AX), and this project's cache layer. A limitation should
be recorded here only after it is reproducible or supported by backend source.

## Current decision

Use CUA Driver for the first complete Outlook workflow and preserve Simulang.
Both remain behind the app-agnostic cached API. This is a current engineering
choice, not a claim that CUA is universally better.

| Backend | Outlook status | Main reason |
| --- | --- | --- |
| CUA Driver | Primary working path | Produces bounded, serializable AX-plus-screenshot snapshots and has completed live Inbox extraction. |
| Simulang | Preserved; workflow incomplete | Its depth-first `scoredSearch` can revisit duplicate Outlook AX nodes until its node budget is exhausted. Breadth-first traversal reaches the Message List. |

## Shared native-GUI constraints

These constraints are not specific to either backend:

- **AX is a live graph, not a durable DOM.** Applications can rebuild nodes,
  expose duplicate relationships, virtualize rows, and change structure while
  a workflow runs.
- **Runtime handles expire.** Live nodes, element indices, tokens, process IDs,
  and window IDs must be resolved again from the current UI; none are cache
  artifacts.
- **Not every element exposes an AX action.** Outlook message cells currently
  expose frames but no press action. Clicking them requires physical input,
  which temporarily places Outlook in the foreground.
- **Screenshots help grounding but not deterministic identity.** A visual point
  can be used for one current run, but without durable AX identity it cannot be
  safely cached for replay.
- **Application content stays live.** Email sender, subject, and body values are
  never cached. Only the recipe for finding them may be cached.

## Simulang

### Depth-first search can exhaust its node budget

Status: **reproduced** with Simulang JS 6.0.1 and 10.1.0.

This project currently calls:

```js
scope.scoredSearch(
  TraversalOrder.DepthFirst,
  1000,
  true,
  query,
  threshold,
)
```

Against the live Outlook Inbox, searching for `Search` returned 998 nodes with
one identical signature, while searching for `Message List` returned zero.
The same query with `TraversalOrder.BreadthFirst` reached the Message List
table, rows, and cells. CUA independently returned a complete finite snapshot
containing `AXTable "Message List"`.

The observed failure is therefore not “Simulang cannot access Outlook.” Its
depth-first traversal revisits duplicate representations in Outlook's AX graph
and consumes `maxNodes` before reaching the target branch. Structural collapse
does not avoid the behavior.

Current workaround:

- use breadth-first search for this tree;
- deduplicate returned candidates before ranking;
- consider a DFS-to-BFS fallback when one signature dominates the result set.

Preferred upstream fix:

- track visited platform AX element identity while walking;
- do not enqueue an already-visited element;
- deduplicate `scoredSearch` results;
- report whether `maxNodes` was exhausted.

### Search and child-read diagnostics are limited

Status: **confirmed from the public Simulang JS API/source contract**.

- `maxNodes` limits visited nodes, not returned results.
- `scoredSearch` returns only nodes tied for the global maximum above the
  threshold, which can produce many duplicate-looking results.
- `AccessibilityNode.children()` converts an unreadable or torn-down subtree
  into an empty array. Callers cannot distinguish a real leaf from a failed
  child read.
- Full app-root traversal can be expensive. During this investigation an
  Outlook app-root snapshot process was killed before producing a result;
  window-rooted bounded search is safer.

These are traversal and observability limitations. They do not prevent direct
AX actions when the desired node has been found.

## CUA Driver

### Outlook can intermittently return a recursive menu-only snapshot

Status: **reproduced intermittently**.

CUA normally exposes `AXTable "Message List"`, its cells, and
`AXWebArea "Reading Pane"`. It has also returned approximately 3,961 menu
elements with neither the Message List nor Reading Pane, including at lower
depth limits. No cache or model can compile a durable action from structure
that is absent.

Current behavior is fail-closed: report the unhealthy snapshot and do not issue
a blind click. Useful upstream improvements are cycle/deduplication and more
reliable window-rooted traversal.

### Element handles are snapshot-local

Status: **expected API behavior**.

`element_index` and `element_token` are replaced by each
`get_window_state`. Before dispatch, the cache resolves its durable descriptor
against a fresh snapshot and uses only the new handle/frame. Caching either
ephemeral value would be incorrect.

### Outlook message rows require foreground physical input

Status: **reproduced**.

CUA supports background delivery when an element exposes an accessibility
action. Outlook message cells expose no such action, so the library converts a
fresh AX frame to window-local pixels, fronts Outlook, clicks once, and restores
the previous application. A failed or uncertain dispatch is never retried.

### Structural recipes can become stale

Status: **expected and covered by self-healing**.

Native GUI extraction has no CSS selector language. Recipes use a root
descriptor plus validated structural paths, roles, ordinals, and identity
tokens. UI changes can invalidate them. The cache re-grounds a stale recipe
with Pi and updates it before continuing. Unrelated same-role siblings no
longer invalidate a field, but changes to the field's own validated position
still do.

### Operational dependencies

CUA requires:

- a running CUA Driver daemon;
- macOS Accessibility permission;
- Screen Recording permission for screenshot-assisted grounding.

## Reproduction

With Outlook open to Inbox:

```sh
# Compare Simulang DFS/BFS against a CUA snapshot without reading email bodies.
npm run probe:outlook:trees

# Run the preserved Simulang workflow.
GUI_CACHE_MODEL=0 npm run check:outlook

# Run the bounded three-message imperative CUA workflow.
npm run check:outlook:cua

# Exercise the explicit all-Inbox loop with a three-item safety cap. This exits
# incomplete because hitting the cap does not prove the end of Inbox.
OUTLOOK_MAX_EMAILS=3 npm run check:outlook:cua:all
```

Expected tree-probe signature for the known Simulang issue:

```text
Simulang DFS:  Message List = 0; Search ≈ node limit; one signature
Simulang BFS:  Message List > 0; table/row/cell roles present
CUA snapshot:  finite, not truncated; AXTable "Message List" present
```

Results can change as Outlook, macOS, Simulang, and CUA Driver evolve. Record
the backend version and whether the target window was visible whenever this
document is updated.
