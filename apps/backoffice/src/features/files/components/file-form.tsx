'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { slugify } from '@/lib/url-params';

import {
  createFileSchema,
  updateFileSchema,
  MAX_FILE_SIZE,
  ACCEPTED_FILE_TYPE,
  type FileRecord,
  type CreateFileData,
  type UpdateFileData,
} from '../schemas';
import { formatFileSize } from '../file-display';

interface CreateFileFormProps {
  mode: 'create';
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  isPending?: boolean;
  progress?: number;
  error?: string | null;
}

interface EditFileFormProps {
  mode: 'edit';
  initialData: FileRecord;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  isPending?: boolean;
  progress?: number;
  error?: string | null;
}

type FileFormProps = CreateFileFormProps | EditFileFormProps;

function validateFile(file: File): string | null {
  if (file.type !== ACCEPTED_FILE_TYPE && !file.name.toLowerCase().endsWith('.pdf')) {
    return 'Only PDF files are accepted';
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File must be under ${formatFileSize(MAX_FILE_SIZE)}`;
  }
  return null;
}

function CreateFormInner({ onSubmit, onCancel, isPending = false, progress = 0, error }: CreateFileFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateFileData>({
    resolver: zodResolver(createFileSchema),
    mode: 'onBlur',
  });

  const isSlugManuallyEdited = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const title = watch('title');

  useEffect(() => {
    if (isSlugManuallyEdited.current || !title) return;
    const timer = setTimeout(() => {
      setValue('urlPath', slugify(title), { shouldValidate: false });
    }, 200);
    return () => clearTimeout(timer);
  }, [title, setValue]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setFileError(validationError);
      setSelectedFile(null);
      return;
    }

    setFileError(null);
    setSelectedFile(file);
  }

  function onFormSubmit(data: CreateFileData) {
    if (!selectedFile) {
      setFileError('Please select a PDF file');
      return;
    }

    const formData = new FormData();
    formData.append('title', data.title);
    formData.append('urlPath', data.urlPath);
    formData.append('file', selectedFile);
    onSubmit(formData);
  }

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...register('title')} />
        {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="urlPath">URL Path</Label>
        <Input
          id="urlPath"
          {...register('urlPath', {
            onChange: () => {
              isSlugManuallyEdited.current = true;
            },
          })}
        />
        <p className="text-xs text-muted-foreground">
          Public URL slug. Auto-generated from title, or enter manually.
        </p>
        {errors.urlPath && <p className="text-sm text-destructive">{errors.urlPath.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="file">PDF File</Label>
        <Input
          ref={fileInputRef}
          id="file"
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
        />
        {selectedFile && (
          <p className="text-xs text-muted-foreground">
            {selectedFile.name} ({formatFileSize(selectedFile.size)})
          </p>
        )}
        {fileError && <p className="text-sm text-destructive">{fileError}</p>}
      </div>

      {isPending && progress > 0 && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{progress}% uploaded</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Uploading...' : 'Upload File'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EditFormInner({
  initialData,
  onSubmit,
  onCancel,
  isPending = false,
  progress = 0,
  error,
}: EditFileFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UpdateFileData>({
    resolver: zodResolver(updateFileSchema),
    mode: 'onBlur',
    defaultValues: {
      title: initialData.title,
      urlPath: initialData.urlPath,
      isActive: initialData.isActive,
    },
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const isActive = watch('isActive');
  const urlPath = watch('urlPath');
  const urlPathChanged = urlPath !== initialData.urlPath;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setFileError(validationError);
      setSelectedFile(null);
      return;
    }

    setFileError(null);
    setSelectedFile(file);
  }

  function onFormSubmit(data: UpdateFileData) {
    const formData = new FormData();
    if (data.title != null && data.title !== initialData.title) formData.append('title', data.title);
    if (data.urlPath != null && data.urlPath !== initialData.urlPath) formData.append('urlPath', data.urlPath);
    if (data.isActive !== initialData.isActive) formData.append('isActive', String(data.isActive));
    if (selectedFile) formData.append('file', selectedFile);
    onSubmit(formData);
  }

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...register('title')} />
        {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="urlPath">URL Path</Label>
        <Input id="urlPath" {...register('urlPath')} />
        {urlPathChanged && (
          <p className="text-sm text-amber-600">
            Changing the URL path will break existing public links to this file.
          </p>
        )}
        {errors.urlPath && <p className="text-sm text-destructive">{errors.urlPath.message}</p>}
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="isActive"
          checked={isActive}
          onCheckedChange={(checked) => setValue('isActive', checked)}
        />
        <Label htmlFor="isActive">Active</Label>
        <span className="text-xs text-muted-foreground">
          {isActive ? 'File is publicly accessible' : 'Public URL returns 404'}
        </span>
      </div>

      <div className="space-y-2">
        <Label htmlFor="file">Replace PDF (optional)</Label>
        <Input id="file" type="file" accept=".pdf,application/pdf" onChange={handleFileChange} />
        <p className="text-xs text-muted-foreground">
          Current: {initialData.originalFilename} ({formatFileSize(initialData.fileSize)})
        </p>
        {selectedFile && (
          <p className="text-xs text-muted-foreground">
            New: {selectedFile.name} ({formatFileSize(selectedFile.size)})
          </p>
        )}
        {fileError && <p className="text-sm text-destructive">{fileError}</p>}
      </div>

      {isPending && progress > 0 && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{progress}% uploaded</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function FileForm(props: FileFormProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        {props.mode === 'create' ? <CreateFormInner {...props} /> : <EditFormInner {...props} />}
      </CardContent>
    </Card>
  );
}
