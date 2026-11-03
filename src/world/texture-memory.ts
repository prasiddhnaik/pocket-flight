import * as T from "three";

const isBitmap = (image: unknown): image is ImageBitmap =>
  typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;

/** Frees the page's copy of an image once every texture using it reaches the GPU. */
export function releaseAfterUpload(textures: T.Texture[]) {
  const waiting = new Set(textures);
  for (const texture of textures)
    texture.onUpdate = () => {
      waiting.delete(texture);
      if (waiting.size) return;
      const image = textures[0].image as unknown;
      if (isBitmap(image)) image.close();
      else if (image instanceof HTMLCanvasElement) image.width = image.height = 0;
    };
}

/** Halves oversized scenery images in the browser and releases them after upload. */
export async function compactSceneryTextures(textures: T.Texture[], limit: number) {
  if (typeof createImageBitmap === "undefined") return;
  const bySource = new Map<T.Source, T.Texture[]>();
  for (const texture of textures)
    bySource.set(texture.source, [...(bySource.get(texture.source) ?? []), texture]);
  await Promise.all(
    [...bySource.values()].map(async (shared) => {
      const [first] = shared,
        image = first.image as ImageBitmap | HTMLImageElement,
        scale = Math.min(1, limit / Math.max(image.width, image.height));
      const flip = first.flipY && !isBitmap(image);
      if (scale < 1 || flip) {
        const smaller = await createImageBitmap(image, {
          resizeWidth: Math.round(image.width * scale),
          resizeHeight: Math.round(image.height * scale),
          resizeQuality: "high",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
          imageOrientation: flip ? "flipY" : "from-image",
        });
        if (isBitmap(image)) image.close();
        first.image = smaller;
        for (const texture of shared) {
          if (flip) texture.flipY = false;
          texture.needsUpdate = true;
        }
      }
      if (isBitmap(first.image)) releaseAfterUpload(shared);
    }),
  );
}
