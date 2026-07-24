# TODOs

- Resolve a model-selected screenshot coordinate back to the AX element at
  that point. If the element has durable identity and matches the visual
  target, compile it into a cacheable AX action; otherwise keep the coordinate
  click as a single-run fallback.
- Expose one backend-independent `element.click()` operation (like javascript,
  for every element, we can do `element.click()`, regardless of whether the
  element is actually clickable). On each replay, resolve the element fresh,
  prefer its semantic AX action, and otherwise click a validated point inside its
  current frame. Keep focus changes, delivery strategy, and uncertain-dispatch
  handling internal to the cache layer rather than requiring workflow authors to
  choose accessibility versus pixel input. Keep these implementation constraints
  in mind:
  - Treat AX actions and physical input as separate primitives; the cache layer
    owns the policy for choosing between them.
  - Do not assume `AXPress` and a coordinate click are semantically equivalent;
    validate the target, chosen point, and expected outcome.
  - Account for foreground focus, pointer movement, window occlusion, display
    scaling, and coordinate conversion before physical input.
  - Never fall back after an uncertain AX dispatch, because doing so could
    execute the action twice.
  - Use workflow context—risk, preconditions, postconditions, and whether
    foreground input is acceptable—to decide if fallback is safe.
- a `see()` method to return AX tree if small, or a screenshot of current
  screen when AX tree is huge?
  - AX tree retrieval should always be called with keyword? so it's more like a
  `search in AX tree`, rather than `look at AX tree and decide what to click`
- Extend scope-qualified workflows with explicit data flow. The runtime can now
  route cached `act`/`extract` pairs across declared applications, but it cannot
  yet bind a live extraction from one scope into a later text-entry action in
  another scope. Add named step outputs and variable references without
  persisting the live values in workflow or action cache entries.
- Expand CUA `observe()` from its current zero-or-one resolved action into a
  ranked list of useful structured actions when a workflow needs to inspect or
  iterate multiple current-UI targets. Keep ephemeral element handles private;
  returned actions should contain only compiled replay data.
