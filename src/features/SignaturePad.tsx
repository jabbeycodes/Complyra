import NewSignaturePad from "./signatures/SignaturePad";

/**
 * Legacy typed-name signature flows (acknowledgment sheets) still collect a
 * free-text mark alongside the typed name. This re-exports the hardened
 * touch canvas (touch-action:none, pointer capture, DPR scaling) with the
 * legacy (dataUrl: string) callback shape — "" when blank.
 */
export default function SignaturePad({
  onChange,
}: {
  onChange: (dataUrl: string) => void;
}) {
  return <NewSignaturePad onChange={(url) => onChange(url ?? "")} />;
}
