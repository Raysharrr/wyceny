import Link from "next/link";
import { plural } from "@/lib/coop-format";

/**
 * Post-import notice about rows without a location. Rendered ONLY when there
 * are any (review 2 N-1): at 0 the link would read "Pokaż 0 wierszy" and lead
 * to other batches' rows on the "do poprawki" list.
 */
export function NeedsFixNotice({ needsFix }: { needsFix: number }) {
  if (needsFix <= 0) return null;
  return (
    <p className="mt-2 pl-6">
      Wiersze bez lokalizacji zaimportowaliśmy, ale nie wejdą do doboru po promieniu, dopóki nie
      poprawisz adresu.{" "}
      <Link href="/rejestr?lokalizacja=do-poprawki&okres=all" className="underline">
        Pokaż {needsFix} {plural(needsFix, "wiersz", "wiersze", "wierszy")}
      </Link>
    </p>
  );
}
