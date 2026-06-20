import { useEffect, useRef, useState } from "react";
import { ScanLine, CameraOff } from "lucide-react";
import { Modal, Button, Input, Field } from "@/components/ui";

// BarcodeDetector is not yet in the TS DOM lib — declare the slice we use.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/**
 * Scan-to-locate. Uses the native BarcodeDetector + camera where available
 * (Chrome / Android), and always offers a manual code-entry fallback
 * (Safari / iOS, or when camera permission is denied).
 */
export function ScanModal({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!open || !supported) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code", "code_128", "ean_13"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              onDetected(codes[0].rawValue.trim());
              return; // caller closes the modal
            }
          } catch {
            /* transient decode errors are expected between frames */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setCameraError("Camera unavailable — enter the code manually.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, supported, onDetected]);

  const submitManual = () => {
    const code = manual.trim();
    if (code) onDetected(code);
  };

  return (
    <Modal open={open} onClose={onClose} title="Scan to locate">
      <div className="space-y-4">
        {supported && !cameraError ? (
          <div className="relative overflow-hidden rounded-xl border border-line bg-black">
            <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-32 w-32 rounded-xl border-2 border-brand-400/80" />
            </div>
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-zinc-200">
              <ScanLine className="h-3.5 w-3.5" /> Point at an item label
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] p-3 text-sm text-zinc-400">
            <CameraOff className="h-4 w-4 shrink-0" />
            {cameraError ?? "Live scanning isn't supported in this browser. Enter the item code below."}
          </div>
        )}

        <Field label="Or enter item code / SKU">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="e.g. EQ-ESP-01"
            onKeyDown={(e) => e.key === "Enter" && submitManual()}
            autoFocus={!supported}
          />
        </Field>
        <Button className="w-full" disabled={!manual.trim()} onClick={submitManual}>
          Look up item
        </Button>
      </div>
    </Modal>
  );
}
