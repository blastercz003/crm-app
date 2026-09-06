# Plný produkční režim e-mailů MARKETY

## Co je podporováno

- Nová plánovaná odstávka.
- Změna termínu plánované odstávky včetně původního a nového termínu.
- Zrušení plánované odstávky.
- Připomenutí 24 hodin před začátkem.
- Výhradní pravidlo Bez objednávky – 3 dny předem.

První čtyři pravidla lze libovolně kombinovat. Třídenní pravidlo je výhradní a
nelze je zapnout současně s jiným pravidlem.

## Bezpečnost aktivace

Každá nově aktivovaná verze pravidla dostane vlastní `activated_at`. Do ostrého
sledování vstoupí jen odstávky, které byly do produkční databáze poprvé uložené
od tohoto okamžiku. Dříve známá odstávka se proto zpětně neodešle ani po novém
spárování s prodejnou, změně, zrušení nebo dosažení 24hodinového či
72hodinového kontrolního okamžiku. U nové odstávky se její další události
sledují normálně.

Aktivace klienta vyžaduje:

1. platného odesílatele z ověřené domény Resendu,
2. alespoň jednoho aktivního příjemce TO,
3. doručený TEST stejného klienta,
4. vybrané pravidlo nebo pravidla,
5. výslovné potvrzení administrátora.

## Pravidlo Bez objednávky – 3 dny předem

Zdroj pravdy je stejná tabulka `power_outage_job_links`, ze které aplikace
zobrazuje zelenou fajfku. Plánovač zahrne pouze potvrzené prodejny bez vazby na
zakázku. Bezprostředně před voláním Resendu se stav načte znovu. Prodejna s nově
přiřazenou zakázkou se z e-mailu odstraní; pokud nezůstane žádná prodejna,
zpráva se zruší bez odeslání.

## Nasazení

1. Spustit `database/power-outages-market-client-email-full-production.sql`.
2. Ověřit, že všechny auditní řádky vracejí `is_correct = true`.
3. Nasadit aplikaci.
4. U každého klienta uložit dočasnou vlastní adresu jako aktivní TO.
5. U každého klienta ověřit doručený TEST.
6. Ve STÍNOVÉM režimu vybrat pravidla.
7. Zaškrtnout potvrzení a zapnout ostrý režim.

Migrace sama nezapíná žádného klienta a nevytváří žádnou ostrou zprávu.
