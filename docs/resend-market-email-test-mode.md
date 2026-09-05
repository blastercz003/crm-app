# Resend TEST režim pro MARKETY

TEST režim doručuje všechny automatické i ručně vyvolané kontrolní zprávy pouze
na jednu interní adresu uloženou v serverové proměnné `RESEND_TEST_RECIPIENT`.
Původní adresáti klienta se používají jen pro náhled a audit a Resendu se jako
příjemci nepředají.

## Nasazení kroku 7

1. V Supabase SQL editoru spusťte celý soubor
   `database/power-outages-market-client-email-test-mode.sql` bez RLS impersonace.
2. Zkontrolujte, že všechny řádky závěrečného auditu vrátí `is_correct = true`.
3. Ve Vercelu otevřete projekt, `Settings` → `Environment Variables`.
4. Přidejte proměnnou:
   - KEY: `RESEND_TEST_RECIPIENT`
   - VALUE: jediná interní adresa, na kterou smí přijít testovací e-maily
   - ENVIRONMENTS: `Production`
5. Uložte proměnnou a proveďte nový production deployment.

## Bezpečný test

1. V tabu MARKETY otevřete administrátorský panel `E-mailová upozornění`.
2. U vybraného jediného klienta vyplňte odesílatele, Reply-To a původní TO/CC.
3. Klienta uložte jako `STÍNOVÝ` a zapněte pravidlo `Nová potvrzená odstávka`.
4. Klikněte na `Spustit TEST`.
5. Klikněte na `Odeslat testovací e-mail`.
6. V historii ověřte přechod `Ve frontě` → `Odesláno` → `Doručeno`.
7. Zkontrolujte mobilní i desktopový vzhled, diakritiku a Reply-To.
8. Klikněte na `Ukončit TEST`.

Ukončení TESTU vypne odesílání a zruší všechny dosud neodeslané testovací
položky. Pokud právě běží jediný odesílací pokus, ukončení se odmítne a lze jej
bezpečně zopakovat po několika sekundách.
