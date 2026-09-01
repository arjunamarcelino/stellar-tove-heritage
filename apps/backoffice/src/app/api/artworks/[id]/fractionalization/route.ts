import { proxyToBackend } from '@/lib/api-proxy';
import { validateId } from '@/lib/validation';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const error = validateId(id);
  if (error) return error;
  return proxyToBackend(request, `/backoffice/artworks/${id}/fractionalization`);
}
