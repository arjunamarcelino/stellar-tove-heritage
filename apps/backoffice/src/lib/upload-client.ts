import { ApiError } from '@/types/api';

export function uploadRequest<T>(
  method: string,
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<T>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new ApiError('Invalid response format', xhr.status, 'INVALID_RESPONSE'));
        }
      } else {
        let message = 'An unexpected error occurred';
        let code = 'UNKNOWN_ERROR';
        try {
          const errorData = JSON.parse(xhr.responseText);
          message = errorData.error?.message ?? errorData.message ?? message;
          code = errorData.error?.code ?? code;
        } catch {
          // response wasn't JSON
        }
        reject(new ApiError(message, xhr.status, code));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new ApiError('Network error', 0, 'NETWORK_ERROR'));
    });

    xhr.addEventListener('abort', () => {
      reject(new ApiError('Upload aborted', 0, 'UPLOAD_ABORTED'));
    });

    xhr.open(method, url);
    xhr.setRequestHeader('X-CSRF-Protection', '1');
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}
