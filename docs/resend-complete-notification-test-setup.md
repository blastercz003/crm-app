# Resend TEST pro KOMPLETNÍ

Tato integrace je oddělená od e-mailů MARKETY. Nepoužívá žádnou proměnnou
`RESEND_*`, marketový endpoint, marketový webhook ani marketové databázové
tabulky. V kroku 10A neexistuje LIVE odesílání ani automatický odesílací cron.

## 1. Databázový základ

V Supabase SQL Editoru spusťte celý soubor
`database/power-outages-complete-notification-email-resend-test.sql` a poté
samostatně audit
`database/power-outages-complete-notification-email-resend-test-audit.sql`.

Instalace nechá TEST vypnutý a nevytvoří žádnou zásilku.

## 2. Nasazení aplikace

Nasaďte aktuální verzi aplikace na Vercel. Teprve potom bude dostupný samostatný
webhook:

`https://<produkční-doména>/api/power-outages/complete/notification-emails/test/webhook`

## 3. Samostatná odesílací doména v Resendu

V Resendu otevřete **Domains** a přidejte samostatnou odesílací subdoménu pro
KOMPLETNÍ, například `odstavky.example.cz`. DNS záznamy, které Resend zobrazí,
vložte u správce DNS a vyčkejte na stav **Verified**.

Doména MARKETY se tím nemění.

## 4. Samostatný API klíč

V Resendu otevřete **API Keys → Create API Key**:

1. Name: `COMPLETE outage notifications TEST`.
2. Permission: **Sending access**.
3. Domain: vyberte pouze novou doménu KOMPLETNÍ.
4. Vytvořený klíč ihned bezpečně uložte; nikdy jej neposílejte do chatu ani
   nevkládejte do zdrojového kódu.

## 5. Proměnné ve Vercelu

V projektu otevřete **Settings → Environment Variables** a pro Production
nastavte:

- `COMPLETE_RESEND_API_KEY` = nový omezený klíč `re_...`
- `COMPLETE_RESEND_SENDING_DOMAIN` = ověřená doména bez `https://`
- `COMPLETE_RESEND_DOMAIN_VERIFIED` = `true`
- `COMPLETE_RESEND_TEST_RECIPIENT` = jedna interní testovací adresa
- `COMPLETE_RESEND_FROM_EMAIL` = odesílatel na nové doméně, např. `odstavky@odstavky.example.cz`
- `COMPLETE_RESEND_FROM_NAME` = např. `B-Energy · plánované odstávky`
- `COMPLETE_RESEND_REPLY_TO_EMAIL` = firemní adresa pro odpovědi; lze ponechat prázdné

Proměnnou `COMPLETE_RESEND_WEBHOOK_SECRET` zatím nevytvářejte. Po uložení
proměnných proveďte redeploy.

## 6. Samostatný webhook v Resendu

V Resendu vytvořte nový webhook s URL z kroku 2. Zapněte události:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.complained`
- `email.failed`
- `email.suppressed`

Z detailu tohoto webhooku zkopírujte jeho signing secret `whsec_...` a ve
Vercelu jej uložte jako `COMPLETE_RESEND_WEBHOOK_SECRET`. Proveďte další
redeploy. Marketový webhook ani `RESEND_WEBHOOK_SECRET` neměňte.

## 7. Kontrola konfigurace

Přihlášený administrátor otevře:

`https://<produkční-doména>/api/power-outages/complete/notification-emails/test/send`

GET pouze vrátí bezpečný diagnostický stav. Nevrací žádný klíč ani tajemství a
nic neodesílá. TEST lze spustit až po zeleném auditu a samostatném potvrzení.

## 8. Jeden kontrolní e-mail

POST na stejný endpoint je dostupný pouze přihlášenému administrátorovi. Vybere
nejbližší platný SHADOW plán a odešle jej výhradně na
`COMPLETE_RESEND_TEST_RECIPIENT`. Skutečný firemní kontakt se použije pouze jako
auditní informace uvnitř výrazně označeného testovacího náhledu.

Po výsledku jednoho pokusu se TEST automaticky vypne. V kroku 10A neexistuje
žádná cesta k LIVE odesílání.
