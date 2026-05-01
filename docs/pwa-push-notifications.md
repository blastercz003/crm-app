# PWA Push Notifications

This app supports browser push notifications through the Web Push standard with
VAPID keys. The internal CRM notification center remains the source of truth;
push notifications are an additional delivery channel.

## Local setup

Required local environment variables:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@b-energy.cz
SUPABASE_SERVICE_ROLE_KEY=...
```

Optional local-only test controls:

```env
NEXT_PUBLIC_PUSH_TEST_CONTROLS_ENABLED=true
```

Do not enable `NEXT_PUBLIC_PUSH_TEST_CONTROLS_ENABLED` in production unless you
intentionally want the hidden test buttons to be visible.

## Database setup

Run:

```sql
-- database/push-subscriptions.sql
```

This creates `public.push_subscriptions` with RLS policies. Users can manage only
their own subscriptions. Server-side push delivery uses `SUPABASE_SERVICE_ROLE_KEY`
to read subscriptions for notification recipients.

## Production setup

Set these environment variables on the hosting provider:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@b-energy.cz
SUPABASE_SERVICE_ROLE_KEY=...
```

Never expose `VAPID_PRIVATE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` with a
`NEXT_PUBLIC_` prefix.

## iPhone test flow

1. Deploy the app over HTTPS.
2. Open the production URL in Safari on iPhone.
3. Add the app to the Home Screen.
4. Open the app from the Home Screen icon.
5. Go to `/settings/password`.
6. Tap the push notification enable button.
7. Allow notifications in the iOS prompt.
8. Create a CRM notification for that user.
9. Verify both the internal CRM notification and the iOS notification arrive.

## Safety notes

- `createNotification` first writes the internal notification to Supabase.
- Push delivery happens only after the internal notification is stored.
- Push errors are caught so they do not break CRM workflows.
- Expired push subscriptions are removed when the push provider returns a gone or
  not found response.

## Badge behavior

- Push payloads include `badgeCount`, based on the recipient's unread internal
  CRM notifications.
- The service worker sets the Home Screen app badge when a push arrives.
- `/dashboard` and `/notifications` sync the badge to the current unread count
  when the app is opened.
- The badge depends on browser support. It is intended for installed Home Screen
  web apps on supported iOS/iPadOS versions.
