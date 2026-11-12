/* eslint-disable @next/next/no-img-element */
// First letter (or digit) of the product name, e.g. "Peak Milk Tin 400g" -> "P".
const initials = (name: string) => (name.match(/[A-Za-z0-9]/)?.[0] ?? "•").toUpperCase();

export default function Thumb({ src, alt }: { src: string | null; alt: string }) {
  return src ? <img className="thumb" src={src} alt={alt} /> : <div className="thumb" aria-hidden>{initials(alt)}</div>;
}
