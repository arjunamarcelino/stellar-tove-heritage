'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { dateTimeFormatter } from '@/lib/date-format';

import { useReviewSubmission } from '../hooks/use-submission-mutations';
import { reviewFormSchema, type ReviewFormData, type Submission } from '../schemas';
import { submissionStatusVariant } from '../submission-display';

const isSafeUrl = (url: string) => /^https?:\/\//.test(url);

interface SubmissionReviewSheetProps {
  submission: Submission | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubmissionReviewSheet({
  submission,
  open,
  onOpenChange,
}: SubmissionReviewSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Review Submission</SheetTitle>
          <SheetDescription>Review the submitted evidence and approve or reject it.</SheetDescription>
        </SheetHeader>
        {submission && (
          <SheetBody
            submission={submission}
            onReviewed={() => {
              setTimeout(() => onOpenChange(false), 150);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  submission,
  onReviewed,
}: {
  submission: Submission;
  onReviewed: () => void;
}) {
  const reviewMutation = useReviewSubmission(submission.id);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ReviewFormData>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: { adminNotes: '', status: 'accepted' },
  });

  const isPending = submission.status === 'pending';

  function onReview(status: 'accepted' | 'rejected') {
    setValue('status', status);
    handleSubmit((data) => {
      reviewMutation.mutate(data, { onSuccess: onReviewed });
    })();
  }

  return (
    <div className="space-y-6 pt-4">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Status</p>
          <Badge variant={submissionStatusVariant[submission.status]}>{submission.status}</Badge>
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground">Evidence</p>
          {submission.linkUrl && (
            <div>
              {isSafeUrl(submission.linkUrl) ? (
                <a
                  href={submission.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline break-all"
                >
                  {submission.linkUrl}
                </a>
              ) : (
                <span className="text-sm break-all">{submission.linkUrl}</span>
              )}
            </div>
          )}
          {submission.textContent && (
            <p className="text-sm whitespace-pre-wrap">{submission.textContent}</p>
          )}
          {submission.fileUrl && (
            <div>
              {isSafeUrl(submission.fileUrl) ? (
                <a
                  href={submission.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  View File
                </a>
              ) : (
                <span className="text-sm">File attached</span>
              )}
            </div>
          )}
          {!submission.linkUrl && !submission.textContent && !submission.fileUrl && (
            <p className="text-sm text-muted-foreground">No evidence provided</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">User</p>
            <p className="font-mono text-xs">{submission.userId.slice(0, 8)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mission</p>
            <p className="font-mono text-xs">{submission.missionId.slice(0, 8)}</p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground">Submitted</p>
          <p className="text-sm">{dateTimeFormatter.format(new Date(submission.createdAt))}</p>
        </div>

        {submission.reviewedAt && (
          <div>
            <p className="text-sm font-medium text-muted-foreground">Reviewed</p>
            <p className="text-sm">{dateTimeFormatter.format(new Date(submission.reviewedAt))}</p>
          </div>
        )}

        {submission.adminNotes && (
          <div>
            <p className="text-sm font-medium text-muted-foreground">Admin Notes</p>
            <p className="text-sm">{submission.adminNotes}</p>
          </div>
        )}
      </div>

      {isPending && (
        <div className="space-y-4 border-t pt-4">
          <div className="space-y-2">
            <Label htmlFor="adminNotes">Admin Notes</Label>
            <Textarea
              id="adminNotes"
              placeholder="Feedback visible to the user"
              {...register('adminNotes')}
            />
            {errors.adminNotes && (
              <p className="text-sm text-destructive">{errors.adminNotes.message}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onReview('accepted')} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? 'Saving...' : 'Accept'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => onReview('rejected')}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending ? 'Saving...' : 'Reject'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
