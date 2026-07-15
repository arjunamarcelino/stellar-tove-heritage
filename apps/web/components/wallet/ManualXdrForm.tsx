'use client';

import { useState } from 'react';
import { publicKeySchema, signedXdrSchema } from '@/lib/wallet/schemas';

interface ManualXdrFormProps {
  xdr: string | null;
  onRequestChallenge: (publicKey: string) => Promise<void>;
  onVerify: (signedXdr: string) => Promise<void>;
  disabled: boolean;
}

export default function ManualXdrForm({
  xdr,
  onRequestChallenge,
  onVerify,
  disabled,
}: ManualXdrFormProps) {
  const [pkInput, setPkInput] = useState('');
  const [xdrInput, setXdrInput] = useState('');
  const [pkError, setPkError] = useState('');
  const [xdrError, setXdrError] = useState('');

  function handleRequestChallenge(e: React.FormEvent) {
    e.preventDefault();
    setPkError('');
    const parsed = publicKeySchema.safeParse(pkInput.trim());
    if (!parsed.success) {
      setPkError(parsed.error.issues[0]?.message ?? 'Invalid public key');
      return;
    }
    void onRequestChallenge(parsed.data);
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setXdrError('');
    const parsed = signedXdrSchema.safeParse(xdrInput.trim());
    if (!parsed.success) {
      setXdrError(parsed.error.issues[0]?.message ?? 'Invalid XDR');
      return;
    }
    void onVerify(parsed.data);
  }

  if (!xdr) {
    return (
      <form onSubmit={handleRequestChallenge} className="flex flex-col gap-3">
        <label className="font-body text-xs text-parchment/60">Your Stellar public key</label>
        <input
          type="text"
          value={pkInput}
          onChange={(e) => setPkInput(e.target.value)}
          placeholder="G..."
          maxLength={56}
          className="rounded-lg border border-parchment/20 bg-parchment/5 px-3 py-2 font-body text-sm text-parchment placeholder:text-parchment/30 focus:border-sienna focus:outline-none"
          disabled={disabled}
        />
        {pkError && <p className="font-body text-xs text-red-400">{pkError}</p>}
        <button
          type="submit"
          disabled={disabled || !pkInput.trim()}
          className="rounded-lg bg-sienna px-4 py-2 font-body text-sm text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Get Challenge
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="font-body text-xs text-parchment/60">
        Sign this XDR with your wallet and paste the result below
      </label>
      <code className="block max-h-24 overflow-auto rounded-lg bg-ink/80 p-3 font-mono text-xs text-parchment/80 break-all">
        {xdr}
      </code>
      <form onSubmit={handleVerify} className="flex flex-col gap-3">
        <textarea
          value={xdrInput}
          onChange={(e) => setXdrInput(e.target.value)}
          placeholder="Paste signed XDR here..."
          rows={3}
          className="rounded-lg border border-parchment/20 bg-parchment/5 px-3 py-2 font-body text-sm text-parchment placeholder:text-parchment/30 focus:border-sienna focus:outline-none"
          disabled={disabled}
        />
        {xdrError && <p className="font-body text-xs text-red-400">{xdrError}</p>}
        <button
          type="submit"
          disabled={disabled || !xdrInput.trim()}
          className="rounded-lg bg-sienna px-4 py-2 font-body text-sm text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Verify Signature
        </button>
      </form>
    </div>
  );
}
