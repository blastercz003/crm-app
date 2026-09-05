# Resend worker a webhook – krok 6

Krok 6 přidává odesílací worker a podepsaný webhook. Po migraci zůstává `dispatch_enabled = false`, takže CRON sice bezpečně kontroluje frontu, ale žádný e-mail neodešle.

## Pořadí nasazení

1. Spusťte `database/power-outages-market-client-email-worker.sql` v Supabase SQL editoru.
2. Nasaďte aktuální verzi aplikace na Vercel.
3. Ověřte, že veřejná produkční URL endpointu existuje:
   `https://VASE-APLIKACE/api/power-outages/client-emails/webhook`
   Běžné otevření v prohlížeči nemusí fungovat; endpoint přijímá pouze podepsaný `POST` od Resendu.
4. Teprve potom vytvořte webhook v Resendu.

## Vytvoření webhooku v Resendu

1. V Resendu otevřete **Webhooks**.
2. Klikněte na **Add Webhook**.
3. Jako endpoint zadejte produkční HTTPS adresu:
   `https://VASE-APLIKACE/api/power-outages/client-emails/webhook`
4. Vyberte události:
   - `email.sent`
   - `email.delivered`
   - `email.delivery_delayed`
   - `email.bounced`
   - `email.complained`
   - `email.failed`
   - `email.suppressed`
5. Webhook uložte.
6. V detailu webhooku zobrazte **Signing Secret** začínající `whsec_`.

## Signing secret ve Vercelu

V **Vercel → Project → Settings → Environment Variables** přidejte:

```text
KEY: RESEND_WEBHOOK_SECRET
VALUE: whsec_...
ENVIRONMENT: Production
```

Hodnotu nevkládejte do databáze, SQL, chatu ani repozitáře. Po uložení proveďte nový production deployment.

## Bezpečnostní vlastnosti

- endpoint ověřuje hlavičky `svix-id`, `svix-timestamp` a `svix-signature` nad nezměněným raw tělem požadavku;
- stejná webhooková událost se díky `svix-id` uloží nejvýše jednou;
- webhook doručený dříve než odpověď send API se dodatečně spojí podle Resend `email_id`;
- odesílací dávka má dvouminutový lease a nepřekrývá se s další dávkou;
- přechodné chyby používají postupnou prodlevu;
- stínové zprávy `mode_at_plan = shadow` nelze workerem vyzvednout;
- idempotency key je stabilně odvozený z interního ID zprávy;
- odesílání odstávek a e-mailový worker běží v oddělených CRONech.

## Stav po kroku 6

Webhook může být připravený a ověřený, ale žádná zpráva se stále neposílá. Režim TEST, přesměrování všech zpráv na interní adresu a první kontrolované odeslání patří až do kroku 7.
