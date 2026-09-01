'use client';

import { useParams } from 'next/navigation';

import { UserDetail } from '@/features/users/components/user-detail';

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();

  return <UserDetail userId={params.id} />;
}
