# Obchodní aktivita – závěrečný checklist

## Notifikace a jejich automatizace

- [ ] Na konci implementace ověřit, že produkční plánovač volá endpoint
  `/api/notifications/automations` každých 5 minut a předává platný
  `NOTIFICATIONS_AUTOMATION_TOKEN`.
- [ ] Bezpečně otestovat jednu připomínku ruční aktivity a jeden Lísteček:
  doručení 15 minut před termínem, zobrazení v existujících Notifikacích,
  případný push, správný odkaz, ochranu proti duplicitě a fungování mimo běžné
  časové okno ostatních automatických notifikací.
- [ ] Ověřit chování opožděného spuštění: nejvýše 60 minut po plánovaném čase se
  notifikace ještě odešle, starší čekající připomínka se označí jako přeskočená.
