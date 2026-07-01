import type { PortWorker } from "../ports/worker";

/**
 * HTTP adapter for {@link PortWorker}, backed by the Python worker service.
 */
export function httpWorker(baseUrl: string): PortWorker {
  return {
    async amountInWords(amount: number): Promise<string> {
      const response = await fetch(`${baseUrl}/amount-in-words`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = (await response.json()) as { words: string };
      return data.words;
    },
  };
}
