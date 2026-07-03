# gui-cache

This repo contains a reusable GUI cache layer on top of simulang.

- `src/` is the library: cache keys, descriptor matching, replay/heal logic,
  and the generic `createCachedSimulang(...)` agent wrapper.
- `examples/` contains app-specific demo/test automation for Outlook and
  Microsoft Teams. Those scripts are intentionally outside the library.

## Run the demos

```sh
npm run check:outlook
npm run check:teams
```

The Outlook demo verifies cached `Search` and `Inbox` descriptors, then reads
visible inbox rows live. The Teams demo verifies cached Teams navigation
controls, then reads unread chat previews live.

The runnable demos are intentionally thin. Their core shape is:

```js
import gui from './gui.mjs'

gui.findApp('outlook')
const result = await gui.act('check first 5 emails, return subject, sender, content, and other info')
```

App-specific tree walking/parsing lives under `examples/apps/...`, not in the
generic cache library.

The cache stores reusable UI grounding, such as descriptors for stable controls.
It does not cache returned Outlook email content or Teams chat content; those
are read live on each `gui.act(...)` call.

Note: selecting unread messages in Outlook may cause Outlook itself to mark
them read depending on the user's mail settings. URLs in extracted content are
redacted to `[url]` before they are printed or returned.
