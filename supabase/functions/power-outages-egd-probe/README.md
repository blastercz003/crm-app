# Power Outages EG.D Probe

Read-only network probe for the public EG.D outage endpoint. The function:

- accepts only authenticated `POST` requests;
- calls only the fixed EG.D public page and validated `api.egd.cz/blackout/*` URL;
- does not receive Supabase database credentials;
- does not write to the database;
- returns only sanitized connection and payload diagnostics.

The same protected function also supports the internal `mode: "source"` server
request. In this mode it returns a schema-neutral EG.D source snapshot to the
Next.js synchronization worker. HTTP compression is delegated to the Supabase
gateway so the Edge worker does not spend its limited CPU budget compressing a
large response. It still performs no database writes and never accepts a
caller-provided destination URL.

Production callers pin execution to `eu-central-1` using both the `x-region`
header and `forceFunctionRegion` query parameter. This prevents a US-hosted
Vercel caller from moving the EG.D request to a different Edge egress region.

Deploy with JWT verification disabled because the function performs its own
constant-time bearer-token validation:

```sh
supabase functions deploy power-outages-egd-probe --no-verify-jwt
```

Set `POWER_OUTAGES_PROBE_TOKEN` in Supabase Edge Function secrets before the
first invocation. Do not commit the token to this repository.
