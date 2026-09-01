'use client';

import { useParams } from 'next/navigation';

import { AdminDetail } from '@/features/admins/components/admin-detail';

export default function AdminDetailPage() {
  const params = useParams<{ id: string }>();

  return <AdminDetail adminId={params.id} />;
}
