declare module "docxtemplater-image-module-free" {
  import type Docxtemplater from "docxtemplater";

  interface ImageModuleOptions {
    centered?: boolean;
    getImage(tagValue: string, tagName: string): Buffer;
    getSize(img: Buffer, tagValue: string, tagName: string): [number, number];
  }
  export default class ImageModule {
    constructor(options: ImageModuleOptions);
    /**
     * Typed against docxtemplater's own `Module`, so a subclass overriding it
     * (`OperatImageModule` in adapters/docx-render.ts) still passes as one.
     */
    render(
      part: Docxtemplater.DXT.Part,
      options: Docxtemplater.DXT.RenderOptions,
    ): Docxtemplater.DXT.Rendered | null;
  }
}

declare module "docxtemplater-image-module-free/js/templates" {
  /** Inline `<w:drawing>` for relationship `rId<rId>`, size in EMU. */
  export function getImageXml(rId: number, size: [number, number]): string;
}
