'use client';

import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const queryClient = useQueryClient();

  console.error(error);

  const handleReset = () => {
    queryClient.clear();
    reset();
  };

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        Something went wrong. Please try again.
      </p>
      <Button onClick={handleReset}>Try again</Button>
    </div>
  );
}
