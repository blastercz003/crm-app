# Resend pro e-mailová upozornění MARKETY

Tento postup připraví Resend, ověřenou firemní doménu a serverové proměnné. V kroku 5 se neposílá žádný e-mail a nezakládá se ještě webhook; jeho podepsaný endpoint vznikne v kroku 6.

## Doporučené adresy

- Odesílací doména: `notify.vasedomena.cz`
- Odesílatel: `Vaše firma – Odstávky <odstavky@notify.vasedomena.cz>`
- Reply-To: existující schránka, například `odstavky@vasedomena.cz`

Samostatná subdoména odděluje reputaci automatických zpráv od běžné firemní pošty. Adresa v `Reply-To` by měla být skutečná a pravidelně kontrolovaná.

## 1. Účet

1. Otevřete `https://resend.com/signup` a založte účet pod firemním e-mailem.
2. Potvrďte adresu a zapněte vícefaktorové ověření účtu.
3. Pro začátek stačí bezplatný transactional plán. Před ostrým provozem zkontrolujte očekávaný počet příjemců, protože každý TO/CC/BCC se započítává samostatně.

## 2. Odesílací doména

1. V Resendu otevřete **Domains** a zvolte **Add Domain**.
2. Zadejte vybranou subdoménu, například `notify.vasedomena.cz`.
3. Resend zobrazí konkrétní DNS záznamy pro DKIM a SPF/Return-Path.
4. U správce DNS založte přesně zobrazené hodnoty. Názvy ani hodnoty neupravujte podle příkladů z internetu.
5. V Resendu klikněte na **Verify DNS Records** a počkejte na stav **Verified**.

DNS se často ověří během několika minut, ale globální propagace může trvat déle. Pokud poskytovatel DNS automaticky doplňuje kořenovou doménu, zkontrolujte výsledný plný název záznamu.

## 3. API klíč

1. V Resendu otevřete **API Keys** a zvolte **Create API Key**.
2. Název: `meeting-crm-production`.
3. Oprávnění: **Sending access**, nikoliv Full access.
4. Klíč začínající `re_` zkopírujte pouze jednou přímo do Vercelu.
5. Klíč neposílejte do chatu, SQL editoru, databáze ani Git repozitáře.

## 4. Serverové proměnné ve Vercelu

V projektu otevřete **Settings → Environment Variables** a pro prostředí **Production** přidejte:

```text
RESEND_API_KEY=re_...
RESEND_SENDING_DOMAIN=notify.vasedomena.cz
RESEND_DOMAIN_VERIFIED=true
```

`RESEND_DOMAIN_VERIFIED=true` nastavte teprve poté, co Resend skutečně ukazuje stav domény **Verified**.

Proměnnou `RESEND_WEBHOOK_SECRET` zatím nevytvářejte. Doplní se v kroku 6 po nasazení přijímacího endpointu a vytvoření webhooku v Resendu. Bude začínat `whsec_`.

Po změně proměnných proveďte nový production deployment; Vercel nové hodnoty nepřenese do již existujícího deploymentu.

## 5. Kontrola v aplikaci

Po deploymentu otevřete jako administrátor:

1. **Monitoring odstávek → MARKETY**
2. panel **E-mailová upozornění**
3. detail administrace

Sekce Resend musí ukázat:

- API klíč: připraven,
- odesílací doména: uvedena,
- SPF a DKIM: ověřeno,
- webhookový podpis: čeká na krok 6.

Samotné tajné hodnoty se v aplikaci nikdy nezobrazují.

## 6. Nastavení klienta pro budoucí stínový test

U vybraného klienta nastavte jako odesílatele adresu ze stejné ověřené domény, například `odstavky@notify.vasedomena.cz`. Reply-To může být existující schránka na kořenové firemní doméně. Stínové náhledy lze připravovat už nyní; skutečné odesílání zůstává globálně vypnuté.

## Pozdější krok 6

Po nasazení workeru a webhookového endpointu založíme v Resendu webhook pro události `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` a `email.suppressed`. Jeho podpisový secret uložíme jako `RESEND_WEBHOOK_SECRET` a webhookové požadavky budeme ověřovat nad nezměněným raw tělem požadavku.
