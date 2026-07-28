/* Decodes an uploaded mediaAsset's dataUrl into an HTMLImageElement. Toolcraft
   owns the upload/FileReader path; this only turns the resulting dataUrl into
   a drawable source for the unmodified engine. */
export function decodeHalftoneImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the uploaded image."));
    image.src = dataUrl;
  });
}
