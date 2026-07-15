'use client';

import { useState } from 'react';
import EyeIcon from '@/components/ui/icons/EyeIcon';
import EyeOffIcon from '@/components/ui/icons/EyeOffIcon';
import { AUTH_INPUT_CLASS } from '@/components/auth/constants';

interface PasswordInputProps {
  id: string;
  name: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}

export default function PasswordInput({ id, name, placeholder, autoComplete, disabled }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        required
        disabled={disabled}
        autoComplete={autoComplete}
        className={AUTH_INPUT_CLASS}
        placeholder={placeholder}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setVisible(!visible)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
      </button>
    </div>
  );
}
