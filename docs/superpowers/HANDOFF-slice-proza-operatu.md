# HANDOFF — slice „Proza operatu z LLM" (dla świeżej sesji implementacyjnej)

Start: przeczytaj w tej kolejności —

1. `docs/superpowers/specs/2026-08-17-proza-operatu-llm-design.md` (design + rozstrzygnięcia usera)
2. `docs/superpowers/plans/2026-08-17-proza-operatu-llm.md` (taski T0–T10)
3. wiki-repo: `wiki/decisions/ADR-014-proza-operatu-llm.md` + `tools/spike/2026-08-17-proza-operatu/RAPORT.md`

## Stan wyjściowy (2026-08-17 noc)

- Spike PASS (4 iteracje): prompt-drogowskaz działa, `spike.py` zawiera GOTOWY walidator
  liczb (pułapki: cyfra w „m2", liczby łamane wierszem, idiom „za 1 m2", nagłówki
  z few-shot) i deterministyczny trend — portować, nie wymyślać od nowa.
- Klucz Anthropic DZIAŁA lokalnie (`wyceny-app/.env.local`, wartość w cudzysłowach)
  i na Railway worker-v2 (zweryfikowane ekstrakcją end-to-end).
- Staging zweryfikowany E2E (web+worker+RCN+AI); hasła kont testowych w `.env.local`
  (`SEED_*`); wyceny QA na stagingu NIE RUSZAĆ.
- CI: main zielony; auto-CD web z pusha; worker deploy: `railway up ./apps/worker
--path-as-root --service worker-v2`.

## Decyzje usera (nie renegocjować)

- Zero hardcode'ów treści; auto-generacja przy wejściu na krok 6 + „Wygeneruj ponownie";
  bez limitu generacji, ale koszt (usage) logowany w audycie; źródło `ai` w enumie
  kernela; stała adnotacja odpowiedzialności + Pomoc.

## Pułapki znane z historii slice'ów

- **F-9: repo publiczne** — few-shot wyłącznie syntetyczny (żadnych fragmentów realnych
  operatów, adresów, cen z raw/).
- Golden F-1 (1 044 400 zł) byte-identical — proza nie dotyka silnika ani zaokrągleń.
- Szablon regenerować WYŁĄCZNIE `build_template.py` (wiki-repo); tagi obrazów/sekcji
  nigdy w jednym `<w:t>`; F-12 jedyna brama treści.
- Wzorce kodu: upload/token — kw-section; inwalidacja po edycji — Slice 11a
  (`InputsChangedError`); tx+FOR UPDATE+audyt — Slice 10; kill-switch env — KW/foto.
- Subagenci NIE pushują (`git push` robi kontroler); lefthook nie formatuje `.mdx`, CI tak.
