export const LOGO_MAX_BYTES = 1_500_000;
export const LOGO_ACCEPT = ["image/png", "image/jpeg"];

export const EVERGREEN_DEMO_LOGO_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAqUlEQVR42u3awRGDMBAEwc3IREH+4fjjghgQkos7+nEBTP9Am+P3Pd58AQAAAAAAANbfZ98uX3mAkeh/Y+Tp4ashUil+BUKqxc9GSLXw2RCpHD8DAUD1+LsI6RB/ByFd4kcRAHSKH0EAAKBZ/FUEAAAAAAAAAAAAAAAAAPA1CACAf4IAvAt4GfI2CMA+wELERshKzE7QUtRWGAAAAAAAAAAAAAAAAADa3gnC2I35JWlQawAAAABJRU5ErkJggg==";

export function evergreenDemoLogoDataUrl() {
  return `data:image/png;base64,${EVERGREEN_DEMO_LOGO_PNG}`;
}

export function evergreenDemoLogoBytes() {
  return Uint8Array.from(atob(EVERGREEN_DEMO_LOGO_PNG), (char) => char.charCodeAt(0));
}

export function agencyLogoPath(agencyId: string) {
  return `agency/${agencyId}/logo`;
}

export function canManageAgencyLogo(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "degreed_professional_manager",
  ].includes(roleKey);
}

export function validateLogoFile(file: File) {
  if (!LOGO_ACCEPT.includes(file.type)) {
    throw new Error("Upload a PNG or JPEG logo.");
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error("Keep the logo under 1.5 MB.");
  }
}

export function imageFormatFromDataUrl(dataUrl: string): "PNG" | "JPEG" {
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) {
    return "JPEG";
  }
  return "PNG";
}

export async function blobToDataUrl(blob: Blob) {
  const mime = blob.type || "image/png";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
