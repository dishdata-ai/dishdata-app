import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders `value` as a QR code PNG. Dark-on-light so it scans & prints cleanly. */
export function QrCode({ value, size = 128, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2, // 2x for crisp printing
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => active && setSrc(url))
      .catch(() => active && setSrc(""));
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!src) return <div className={className} style={{ width: size, height: size }} />;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="QR code"
      className={className}
      style={{ imageRendering: "pixelated", borderRadius: 6 }}
    />
  );
}
