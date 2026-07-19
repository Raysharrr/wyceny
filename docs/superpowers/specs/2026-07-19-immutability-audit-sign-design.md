# Slice 8 — Niezmienność + audit_log + podpis (F-7) — design

Data: 2026-07-19 · Status: zaakceptowany na checkpoincie (a) · Poprzednik: Slice 7 (cechy/wagi, F-6)
Źródła: wiki `roadmap.md` (NOW), ADR-011, PRD FR-12/NFR-1/NFR-3/NFR-6, spike wiki-repo
`tools/spike/2026-07-19-podpis-image-render/` (PASS).

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś praca rzeczoznawcy kończy się na „Zatwierdź operat": aplikacja generuje dokument DOCX+PDF
i zamraża go, ale formalnie nic nie mówi o podpisie — a to podpis, złożony uprawnieniami
rzeczoznawcy, czyni operat operatem. Ten slice domyka ostatni krok cyklu.

Rzeczoznawca raz wgrywa w swoim **profilu** skan własnoręcznego podpisu (obraz, tak jak
pieczęć w szablonie). Od tej pory na każdej **zatwierdzonej** wycenie, którą prowadzi, widzi
przycisk **„Podpisz operat"**. Kliknięcie generuje finalną wersję dokumentu — identyczną co do
treści z zatwierdzoną, ale z jego podpisem wklejonym w komórkę „Pieczęć i podpis rzeczoznawcy
majątkowego" na stronie tytułowej — i nieodwołalnie zamyka wycenę: status **PODPISANY**,
z datą. Od tego momentu żadna edycja nie jest możliwa — ani z formularza, ani „od zaplecza":
sama baza danych odrzuca każdą próbę zmiany. Tak jak nie da się poprawić długopisu na
wydrukowanym i podpisanym operacie.

Jeśli po podpisaniu trzeba coś zmienić (bo zmienił się stan prawny, bo klient wrócił po
aktualizację), jedyna droga to **„Utwórz nową wersję"**: aplikacja kopiuje dane do nowego
szkicu powiązanego z poprzednikiem („wersja 2, zastępuje operat z 19.07"), ale każde
skopiowane dane trzeba na nowo zweryfikować i potwierdzić — pełny cykl potwierdź → zatwierdź
→ podpisz od początku, bo za nową wersję rzeczoznawca znów bierze odpowiedzialność. Stara
wersja zostaje na zawsze, z dokumentami — ślad „co wiedzieliśmy i co podpisaliśmy".

W tle aplikacja zaczyna prowadzić **dziennik zdarzeń**: każde utworzenie wyceny, zapis
szkicu, każde „Potwierdź…", zatwierdzenie i podpis zostawia wpis — kto, kiedy, co. To wymóg
prawny (ślad dowodowy do odpowiedzialności zawodowej), ale też fundament pod przyszłe metryki
jakości pracy z AI (ile propozycji rzeczoznawca przyjmuje bez zmian).

**Pod maską:** podpis to re-render zamrożonych danych wejściowych tym samym mechanizmem co
przy zatwierdzeniu (deterministyczny — test pilnuje, że treść nie drgnęła), z obrazem podpisu
przez moduł image docxtemplatera (zwalidowany spikiem); niezmienność egzekwuje trigger
Postgresa — jedyna warstwa, której nie omija nawet superuser, którym łączy się aplikacja;
dziennik i zamrożone dokumenty są append-only na poziomie bazy; a hash SHA-256 obu plików
w dzienniku pozwala w każdej chwili dowieść, że podpisany dokument to dokładnie ten dokument.

## Outcome i DoD

**Outcome (roadmap NOW):** operat write-once po podpisie (**F-7**), ślad dowodowy. `Must-Legal`.

**DoD:**

- Pełny cykl na prodzie: upload skanu → szkic → zatwierdź → **podpisz** (dokument z podpisem,
  hash w audycie) → próba edycji odrzucona → „Utwórz nową wersję" → nowy szkic z linkiem.
- **F-7 w CI (adversarial):** edycja podpisanego odrzucona na ścieżce akcji serwerowej,
  adaptera i surowego SQL (trigger); DELETE odrzucony; `audit_log` i `document` append-only
  dowiedzione surowym SQL.
- Audit_log wpis dla każdej mutacji każdej wyceny; F-1 golden 1 044 400 zł nietknięte;
  F-4/F-9/F-12 zielone.

## Decyzje brainstormu (2026-07-19, z userem)

1. Podpis w MVP = **skan podpisu wgrany do aplikacji, wklejany do dokumentu** (nie sam flip
   statusu; podpis kwalifikowany = LATER).
2. Skan trafia do dokumentu **przy podpisie** (approve daje dokument bez podpisu — do
   przeglądu; sign renderuje wersję finalną).
3. Audit_log = **wszystkie mutacje** (create / draft_saved / confirm* / approved / signed /
   version_created). Odczyty i pobrania — poza zakresem.
4. Wersjonowanie **w tym slice**: „Utwórz nową wersję" na podpisanym (kopia → szkic,
   `supersedes`, prowenancja zresetowana do `to_verify`).
5. Podpisuje **wyłącznie właściciel** wyceny; skan z jego profilu; brak skanu = polski błąd
   z linkiem do profilu.
6. Mechanika obrazu: **re-render przy podpisie** (wybór usera; podejście B) — moduł
   `docxtemplater-image-module-free`, zwalidowany spikiem; mitygacje dryfu poniżej.
7. Defaulty zaakceptowane w designie: **trigger DB + CAS** (defense-in-depth), **SHA-256**
   bajtów DOCX i PDF w audycie przy podpisie.

## Model danych — migracja 0009 (pierwsza DDL od 0008)

Wzorzec: kolumny przez `drizzle-kit generate`, triggery/funkcje raw SQL (precedens 0003/0005).
Kolejność deployu: **migracja prod (`railway run`) → deploy web** (lekcja Slice 3).

- **Tabela `audit_log`** (nowa): `id bigserial PK · valuation_id uuid (bez FK CASCADE) ·
actor_id text NOT NULL · action text NOT NULL · at timestamptz NOT NULL DEFAULT now() ·
meta jsonb`. Akcje (zamknięta lista w domenie): `created`, `draft_saved`,
  `sample_confirmed`, `subject_confirmed`, `kw_confirmed`, `features_confirmed`, `approved`,
  `signed`, `version_created`.
- **`valuation`**: `+ signed_at timestamptz NULL` · `+ supersedes_id uuid NULL`
  (self-reference). Przy podpisie `doc_url`/`docx_url` przestawiane na finalne klucze
  (`…-signed.docx/.pdf`); wiersze `document` wersji zatwierdzonej ZOSTAJĄ (ślad), przestają
  być serwowane.
- **`user`**: `+ signature_bytes bytea NULL` · `+ signature_mime text NULL` (PNG/JPEG).
  Skan tylko w DB — RODO; nigdy w repo (F-9: testy na syntetycznym podpisie ze spike'a).
- **Triggery (raw SQL, 0009):**
  1. `valuation_write_once`: `BEFORE UPDATE OR DELETE ON valuation` — gdy `OLD.status =
'signed'` → `RAISE EXCEPTION`. Superuser NIE omija triggerów (omija RLS) — to jedyna
     twarda gwarancja F-7 przy obecnym `db/client.ts`.
  2. `audit_log_append_only`: `BEFORE UPDATE OR DELETE ON audit_log` → `RAISE EXCEPTION`.
  3. `document_append_only`: `BEFORE UPDATE OR DELETE ON document` → `RAISE EXCEPTION`
     (chroni zamrożone bajty, nie tylko wskaźniki; storage.put nigdy nie nadpisuje — guard
     re-approve ze Slice 4 to już gwarantuje aplikacyjnie).

## Domena (`src/domain/valuation.ts`)

- `signValuation(v, now)`: assert `status === "approved"` → `{...v, status: "signed",
signedAt: now}`. Konsolidacja guardów (backlog Slice 3): martwy `assertNotSigned` usunięty
  lub wpięty; `assertDraft` bez zmian (nadal blokuje mutacje po approve).
- `newVersionOf(v)`: kopia pól i `inputs` z **resetem statusów prowenancji na `to_verify`**
  (źródła `source` zachowane), `supersedesId = v.id`, status `in_progress`, pola cyklu
  (`approvedAt/signedAt/docUrl/docxUrl/wr/amountInWords`) wyzerowane.
- Zamknięty typ `AuditAction` (lista jw.).

## Adapter (`valuation-drizzle.ts`) + porty

- **CAS w każdym UPDATE** (backlog Slice 3): `WHERE eq(id) AND eq(status,
expectedStatus)` — `confirm*`/`draft_saved` oczekują `in_progress`, `sign` oczekuje
  `approved`. 0 zaktualizowanych wierszy → polski błąd domenowy (nie surowy wyjątek pg).
- **Audit w tej samej transakcji co mutacja**: każda metoda mutująca robi
  `db.transaction(tx => { UPDATE …; INSERT INTO audit_log … })`. Dla `create` — insert +
  wpis `created`.
- `sign(id, user, {docKeys, hashes})`: transakcja: CAS-UPDATE (`signed`, `signed_at`,
  nowe `doc_url`/`docx_url`) + wpis `signed` z `meta = {sha256_docx, sha256_pdf}`.
- `createNewVersion(id, user)`: transakcja: INSERT kopii + wpis `version_created`
  (`meta = {supersedes: id}`).
- Port `PortValuation`: + `sign`, + `createNewVersion`; port storage bez zmian.

## Akcja podpisu (`app/actions/sign-valuation.ts`, szablon: `approve-valuation.ts`)

1. Sesja → ownership (`repo.get`) → guard `status === "approved"` (polski błąd).
2. Skan z profilu właściciela; brak → `{error: "Wgraj skan podpisu w profilu…"}`.
3. Re-render DOCX z zamrożonych `inputs` tym samym `buildDocumentModel` co approve, z
   **`dataSporzadzenia` wyprowadzoną z `approvedAt`** (fix dryfu — approve też przechodzi na
   jedną datę; domyka nit „dwa niezależne `new Date()`" ze Slice 4); słownie z workera.
4. **Kontrakt modułu image (ze spike'a — load-bearing):** model dostaje STRING-marker
   (`podpis: "sygnatariusz"`), `getImage()` zwraca Buffer skanu; przy approve `podpis: null`
   → renderuje pusto (jeden szablon, zero sekcji warunkowych). Wartość tagu NIGDY nie może
   być Bufferem (crash — moduł czyta obiekt jako `{rId, sizePixel}`).
5. PDF: istniejący `/convert-to-pdf` workera (worker NIETKNIĘTY — F-11).
6. `storage.put` nowych kluczy → SHA-256 obu plików (`node:crypto`) → `repo.sign(...)`.
7. `revalidatePath`; błąd renderu/konwersji = podpis się nie udaje (retry), wzorzec
   niezmiennika Slice 4 „zatwierdzony ⇔ ma operat" rozszerzony: „podpisany ⇔ ma finalny
   operat z podpisem".
8. **Edge legacy:** operaty zatwierdzone przed Slice 4 (`inputs` null / stub tekstowy) nie
   są podpisywalne — przycisk ukryty, guard w akcji (polski błąd); zostają `approved` na
   zawsze (w razie potrzeby: nowa wycena od zera — „Utwórz nową wersję" działa tylko na
   podpisanych).

## Szablon (F-12)

Nowy etap w `build_template.py` (wiki-repo, jedyna dozwolona ścieżka zmian szablonu):
iniekcja ` {%podpis}` inline po etykiecie „Pieczęć i podpis rzeczoznawcy majątkowego:"
z asercją `hits == 1`. UWAGA ze spike'a: tag NIE może być sklejony z tagami sekcji
`{#}{/}` w tym samym `w:t`. F-12 (test integralności szablonu) rozszerzone o obecność
tagu `{%podpis}`. Diff buildera commitowany w wiki dopiero w S6 PR (konwencja Slice 7).

## Wersjonowanie — UI i przepływ

- Na **podpisanym**: przycisk „Utwórz nową wersję" → akcja → redirect do nowego szkicu.
- Nowy szkic: baner „Wersja zastępująca operat z DD.MM.RRRR" + link do poprzednika.
- Poprzednik: adnotacja „Zastąpiony przez nowszą wersję" + link; dokumenty starej wersji
  nadal dostępne (`/api/docs` bez zmian autoryzacji).
- Lista wycen: badge PODPISANY; wersje jako osobne pozycje.

## Profil (nowa strona, minimalna)

`/profile`: podgląd + upload skanu podpisu (PNG/JPEG, limit rozmiaru ~1 MB, normalizacja
proporcji do boxa ~170×57 px — inaczej moduł rozciągnie obraz), zapis do `user`. Podgląd
przez data-URL w RSC (bez nowego endpointu). Upload = owner-only (własny profil).

## Fitness functions i testy

- **F-7 (nowa, adversarial; wzorce: `f4-approval-gate.test.ts`, `rls-isolation.test.ts`):**
  1. akcja: sign → ponowny sign / confirm* / approve na podpisanym → polski błąd;
  2. adapter: UPDATE po `signed` → odrzucony (CAS, 0 rows);
  3. **surowy SQL**: `UPDATE valuation SET address=… WHERE status='signed'` → wyjątek
     triggera; `DELETE` → wyjątek; `UPDATE/DELETE audit_log` → wyjątek; `UPDATE/DELETE
document` → wyjątek. Na prawdziwym Postgresie (CI service, `drizzle-kit migrate`).
- **Test równości treści** (mitygacja dryfu re-renderu): render approve-path i sign-path na
  tych samych zamrożonych `inputs` → identyczny tekst dokumentu (wzór: R3 ze spike'a).
- **Audit coverage test**: każda mutacja przez adapter zostawia dokładnie jeden wpis
  właściwego typu.
- **F-12**: + tag `{%podpis}` w teście integralności szablonu; render-test z markerem
  string i null.
- **F-9**: fixture podpisu WYŁĄCZNIE syntetyczny (`make_signature.py` ze spike'a);
  skan realny nigdy w repo/fixture'ach.
- F-1/F-2/F-3/F-4/F-5/F-6/F-8/F-10/F-11 — bez zmian, muszą zostać zielone.

## Deploy

Migracja 0009 przez `railway run` → `vercel deploy --prod` (web). Worker bez deployu.
**Zero nowych sekretów.** Na prodzie wyceny QA („QA S7 …") — nie kasować. Weryfikacja live:
pełny cykl DoD na świeżej wycenie + próba edycji podpisanej przez SQL na prod DB
(spodziewany wyjątek) + hash z audytu == SHA-256 pobranych plików.

## Poza zakresem (świadome cięcia)

- Audyt odczytów/pobrań; podpis kwalifikowany (LATER, spike-first).
- Parametryzacja imienia/nr uprawnień w szablonie (zostaje „Aneta Dembska … 5667" —
  szablon kancelarii; **pytanie do Anety** o docelowy model → wiki
  `deliverables/pytania-do-anety.md` w S6).
- Edycja podpisanego w JAKIEJKOLWIEK formie; przypisywanie wycen innym; diff między
  wersjami; retencja/kompresja starych snapshotów.

## Ryzyka

- `docxtemplater-image-module-free@1.1.1` nieutrzymywany, ciągnie `xmldom@0.1.31`
  (CVE-2021-21366). Wejście = własny szablon (nie attacker-controlled) → ryzyko niskie,
  zaakceptowane; fallback: podmiana bajtów medium w ZIP (podejście A z brainstormu).
- Trigger chroni od momentu migracji 0009 — okno między migracją a deployem web jest
  bezpieczne (stary kod nie umie ustawić `signed`).
- Reset prowenancji przy nowej wersji → F-4 zablokuje zatwierdzenie do ponownego
  potwierdzenia wszystkiego (zamierzone, ale UX: lista blockerów będzie długa).
