# Apple Pay Automation

Apple Pay capture is handled by an iOS Shortcuts personal automation, not by an
ExpenseTracker App Intent.

## Shortcut recipe

After authoring the Shortcut on-device, share it via iCloud and paste that
link into the iOS setup screen/docs. The repository cannot generate the
personal automation link itself.

1. Create a personal automation with trigger **Transaction** / **Apple Pay**.
2. Add **UUID** and keep it as the suggestion `id`.
3. Add **Get Dictionary** with:
   - `id`: UUID from step 2
   - `merchant`: merchant from the transaction
   - `amount`: amount in cents
   - `currency`: transaction currency code
   - `captured_at`: current Unix timestamp
   - `card_name`: card name, if available
   - `source`: `shortcut`
4. Add **Get Contents of URL**:
   - URL: `https://<your-host>/api/wallet-suggestions`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer <sync-secret>`
     - `Content-Type: application/json`
     - `Idempotency-Key: <same UUID as id>`
   - Request body: the dictionary from step 3.
5. In the failure branch, add the JSON payload to Reminders so failed captures
   are visible and can be retried manually.

Suggestions remain `pending` until accepted in the PWA/iOS review screen.
