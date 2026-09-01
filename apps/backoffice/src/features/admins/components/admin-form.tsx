'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { adminRoleSchema } from '@/features/auth/schemas';

import {
  registerAdminSchema,
  updateAdminSchema,
  type Admin,
  type RegisterAdminData,
  type UpdateAdminData,
} from '../schemas';

interface CreateAdminFormProps {
  mode: 'create';
  onSubmit: (data: RegisterAdminData) => void;
  onCancel: () => void;
  isPending?: boolean;
  error?: string | null;
}

interface EditAdminFormProps {
  mode: 'edit';
  initialData: Admin;
  onSubmit: (data: UpdateAdminData) => void;
  onCancel: () => void;
  isPending?: boolean;
}

type AdminFormProps = CreateAdminFormProps | EditAdminFormProps;

function CreateFormInner({ onSubmit, onCancel, isPending = false, error }: CreateAdminFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RegisterAdminData>({
    resolver: zodResolver(registerAdminSchema),
    mode: 'onBlur',
    defaultValues: { role: 'admin' },
  });

  const role = watch('role');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register('email')} />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" {...register('password')} />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          12-128 characters. Must include uppercase, lowercase, number, and special character
          (!@#$%^&*).
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <Label htmlFor="firstName">First Name</Label>
        <Input id="firstName" {...register('firstName')} />
        {errors.firstName && (
          <p className="text-sm text-destructive">{errors.firstName.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="lastName">Last Name</Label>
        <Input id="lastName" {...register('lastName')} />
        {errors.lastName && (
          <p className="text-sm text-destructive">{errors.lastName.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            const parsed = adminRoleSchema.safeParse(value);
            if (parsed.success) setValue('role', parsed.data);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="superadmin">Super Admin</SelectItem>
          </SelectContent>
        </Select>
        {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : 'Create Admin'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EditFormInner({ initialData, onSubmit, onCancel, isPending = false }: EditAdminFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UpdateAdminData>({
    resolver: zodResolver(updateAdminSchema),
    mode: 'onBlur',
    defaultValues: {
      firstName: initialData.firstName,
      lastName: initialData.lastName,
      role: initialData.role,
    },
  });

  const role = watch('role');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="firstName">First Name</Label>
        <Input id="firstName" {...register('firstName')} />
        {errors.firstName && (
          <p className="text-sm text-destructive">{errors.firstName.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="lastName">Last Name</Label>
        <Input id="lastName" {...register('lastName')} />
        {errors.lastName && (
          <p className="text-sm text-destructive">{errors.lastName.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            const parsed = adminRoleSchema.safeParse(value);
            if (parsed.success) setValue('role', parsed.data);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="superadmin">Super Admin</SelectItem>
          </SelectContent>
        </Select>
        {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
      </div>

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

export function AdminForm(props: AdminFormProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        {props.mode === 'create' ? <CreateFormInner {...props} /> : <EditFormInner {...props} />}
      </CardContent>
    </Card>
  );
}
