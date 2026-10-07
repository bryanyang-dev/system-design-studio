import type { Diagram, DiagramContent, DiagramSummary, Version } from './domain';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Your local draft is preserved.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.detail;
    const message = typeof detail === 'string' ? detail : detail?.message;
    throw new ApiError(response.status, message ?? (response.status === 422 ? 'Some fields are invalid. Check labels and numeric values.' : 'The server could not complete the request. Check that PostgreSQL and the backend are running.'));
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const api = {
  list: () => request<DiagramSummary[]>('/diagrams'),
  get: (id: string) => request<Diagram>(`/diagrams/${id}`),
  create: (content: Partial<DiagramContent> = {}) => request<Diagram>('/diagrams', { method: 'POST', body: JSON.stringify(content) }),
  save: (id: string, content: DiagramContent, version: number) => request<Diagram>(`/diagrams/${id}`, {
    method: 'PATCH', body: JSON.stringify({ ...content, expected_version: version }),
  }),
  remove: (id: string, version: number) => request<void>(`/diagrams/${id}?expected_version=${version}`, { method: 'DELETE' }),
  versions: (id: string) => request<Version[]>(`/diagrams/${id}/versions`),
  restore: (id: string, version: number, expected: number) => request<Diagram>(`/diagrams/${id}/restore`, {
    method: 'POST', body: JSON.stringify({ version, expected_version: expected }),
  }),
};
