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
      if (!response.ok) {
        throw new Error(
          `worker /amount-in-words responded ${response.status} ${response.statusText}`,
        );
      }
      const data = (await response.json()) as { words: string };
      return data.words;
    },
    async convertToPdf(docx: Buffer): Promise<Buffer> {
      const response = await fetch(`${baseUrl}/convert-to-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        body: new Uint8Array(docx),
      });
      if (!response.ok) {
        throw new Error(
          `worker /convert-to-pdf responded ${response.status} ${response.statusText}`,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
