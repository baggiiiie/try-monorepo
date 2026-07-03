# gui-cache

This repo contains a reusable GUI cache layer and an Outlook workflow that uses
it to read the top visible inbox messages.

## Run the cache-backed Outlook check

```sh
npm run check:outlook
```

This runs the reusable GUI cache layer against Outlook, verifies the cached
`Search` and `Inbox` descriptors, then selects the top 3 visible inbox rows and
returns reading-pane content. The email-reading step uses row-center mouse
clicks because Outlook exposes row boxes reliably, while row `activate()` can
return `AXError::AttributeUnsupported` on macOS.

The runnable workflow is intentionally thin. Its core shape is:

```js
import gui from '../cached-simulang.mjs'

gui.findApp('outlook')
const result = await gui.act('check first 3 emails, return subject, sender, content, and other info')
```

Outlook-specific tree walking and reading-pane parsing live behind `gui.act(...)`,
not in the workflow orchestration file.

The cache stores reusable UI grounding, such as descriptors for stable controls.
It does not cache returned email content: message rows and reading-pane text are
read live on each `gui.act(...)` call, and each selected row is verified against
the reading pane before content is returned.

Note: selecting unread messages in Outlook may cause Outlook itself to mark
them read depending on the user's mail settings. URLs in extracted content are
redacted to `[url]` before they are printed or returned.
