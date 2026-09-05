# Ostrý pilot e-mailových upozornění MARKETY

Pilot je omezen na jednoho klienta a jediný typ události: novou potvrzenou
odstávku. Migrace pilot sama neaktivuje a nic neodešle.

## Bezpečnostní podmínky aktivace

- Resend doména, API klíč a webhook musí být připravené.
- Stejný klient musí mít alespoň jeden úspěšně doručený TEST.
- Klient musí být v režimu STÍNOVÝ a mít platného odesílatele a aktivní TO.
- Současně nesmí běžet jiný TEST ani ostrý pilot.
- Administrátor musí v UI výslovně potvrdit skutečné TO/CC.
- Nová verze pravidla dostane čas aktivace `now()`; starší události se negenerují.

## Chování pilotu

- Plánovač běží každých pět minut.
- Jedna odstávka vytvoří jeden e-mail pro všechny dosud potvrzené prodejny klienta.
- Před odesláním běží pětiminutové seskupovací okno.
- Odesílací worker během pilotu převezme nejvýše jednu zprávu v jedné dávce.
- Worker smí převzít pouze položku klienta, který je stále v aktivním režimu.
- Bounce nebo complaint automaticky vypne pilot a zruší dosud nepřevzaté položky.
- Ruční ukončení pilotu vypne dispatch a zruší plánované, čekající a chybové
  ostré položky. Již odeslané zprávy zůstanou v historii.

## Doporučený postup

1. Spusťte `database/power-outages-market-client-email-live-pilot.sql`.
2. Ověřte, že všechny řádky auditu mají `is_correct = true`.
3. Nasaďte aplikaci a znovu ověřte, že je globální odesílání vypnuté.
4. Zkontrolujte skutečné TO/CC pilotního klienta.
5. Zaškrtněte výslovné potvrzení a aktivujte pilot.
6. Sledujte první skutečnou událost, historii zprávy a webhook doručení.
7. Po vyhodnocení pilot ručně ukončete nebo pokračujte podle schváleného plánu.
