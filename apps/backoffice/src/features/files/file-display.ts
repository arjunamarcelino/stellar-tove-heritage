export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getPublicFileUrl(urlPath: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_FILES_BASE_URL;
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_FILES_BASE_URL is not configured');
  }
  return `${baseUrl}/${urlPath}`;
}

export function copyFileLink(urlPath: string, toast: { success: (msg: string) => void; error: (msg: string) => void }) {
  try {
    const url = getPublicFileUrl(urlPath);
    navigator.clipboard?.writeText(url).then(
      () => toast.success('Link copied to clipboard'),
      () => toast.error('Failed to copy link'),
    );
  } catch {
    toast.error('Failed to copy link');
  }
}

export function openFileUrl(urlPath: string, toast: { error: (msg: string) => void }) {
  try {
    const url = getPublicFileUrl(urlPath);
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    toast.error('Public file URL is not configured');
  }
}
