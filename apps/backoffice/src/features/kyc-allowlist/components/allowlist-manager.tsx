'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { classifyAddress, explorerTxUrl, isValidContractAddress } from '@/lib/stellar';

import { actionErrorCopy, mapAllowlistResult } from '../allowlist-display';
import { useAllowlistAction } from '../hooks/use-allowlist-mutations';
import { useWalletStatus } from '../hooks/use-allowlist-queries';
import type { AllowlistAction, WalletActionState } from '../schemas';
import { AllowlistActionDialog } from './allowlist-action-dialog';
import { AllowlistActions } from './allowlist-actions';
import { WalletStatusPill } from './wallet-status-pill';

// Trim, strip internal whitespace (paste artifacts) and invisible/bidi/control chars before validating.
function normalizeWallet(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '');
}

function wrongTypeMessage(kind: ReturnType<typeof classifyAddress>): string {
  switch (kind) {
    case 'account':
      return 'That’s a Stellar account (G…). Paste the Collector smart-wallet contract (C…, 56 chars).';
    case 'muxed':
      return 'That’s a muxed account (M…). Paste the Collector smart-wallet contract (C…).';
    case 'evm':
      return 'That’s an Ethereum address. Paste the Collector Stellar contract (C…).';
    default:
      return 'Enter a valid Collector smart-wallet contract address (C…, 56 chars).';
  }
}

export function AllowlistManager() {
  const { user } = useAuth();
  const canRemove = user?.role === 'superadmin';

  const [input, setInput] = useState('');
  const [lookedUpWallet, setLookedUpWallet] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Transient pill from a pending/deferred POST (confirmed/noop write the query cache instead).
  const [actionState, setActionState] = useState<WalletActionState | null>(null);
  const [dialogAction, setDialogAction] = useState<AllowlistAction | null>(null);

  const statusQuery = useWalletStatus(lookedUpWallet);
  const mutation = useAllowlistAction(lookedUpWallet ?? '');

  const pillState = actionState ?? statusQuery.data?.status ?? null;

  function handleInputChange(value: string) {
    setInputError(null);
    setActionError(null);
    setActionState(null);
    // Stale-lookup guard: editing the field clears the committed wallet (pill hidden, actions disabled).
    setLookedUpWallet(null);
    // SECURITY: never retain a pasted secret key — detect on change/paste and drop it immediately
    // (don't wait for a Look-up click), so it can't be captured by autofill/session-replay.
    if (classifyAddress(normalizeWallet(value)) === 'secret') {
      setInput('');
      setInputError('That’s a secret key — never paste a secret. Paste the Collector contract (C…).');
      return;
    }
    setInput(value);
  }

  function handleLookup() {
    const cleaned = normalizeWallet(input);
    if (!cleaned) {
      setInputError('Enter a wallet address');
      return;
    }
    const canonical = cleaned.toUpperCase();
    const kind = classifyAddress(canonical);
    if (kind === 'secret') {
      setInput(''); // SECURITY: never keep a secret key in the field
      setLookedUpWallet(null);
      setInputError('That’s a secret key — never paste a secret. Paste the Collector contract (C…).');
      return;
    }
    if (!isValidContractAddress(canonical)) {
      setInputError(wrongTypeMessage(kind));
      return;
    }
    setInput(canonical); // echo the normalized (uppercased) value back
    setInputError(null);
    setActionError(null);
    setActionState(null);
    setLookedUpWallet(canonical);
  }

  function handleConfirm(reason: string | undefined) {
    if (!lookedUpWallet || !dialogAction) return;
    const action = dialogAction;
    setActionError(null);
    mutation.mutate(
      { action, reason, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: (outcome) => {
          setDialogAction(null);
          if (outcome.kind === 'conflict') {
            toast.message(
              outcome.reason === 'in_flight'
                ? 'A request for this wallet is still processing — please wait'
                : 'No change — wallet is already in the requested state',
            );
            setActionState(null);
            return;
          }
          const ui = mapAllowlistResult(outcome.result);
          const link = ui.txHash ? explorerTxUrl(ui.txHash) : null;
          const opts = link
            ? {
                action: {
                  label: 'View tx',
                  onClick: () => window.open(link, '_blank', 'noopener,noreferrer'),
                },
              }
            : undefined;
          if (ui.toast === 'success') toast.success(ui.message, opts);
          else if (ui.toast === 'error') toast.error(ui.message);
          else toast.message(ui.message, opts);

          if (ui.toast === 'error') setActionError(ui.message);
          // `ui.pill` is transient-only (pending/deferred | null); confirmed/noop pills come from the
          // cache write in the mutation hook, so clearing actionState here reveals the cached status.
          setActionState(ui.pill);
        },
        onError: (error) => {
          setDialogAction(null);
          const message = actionErrorCopy(error);
          toast.error(message);
          setActionError(message);
        },
      },
    );
  }

  const hasWallet = !!lookedUpWallet;

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="wallet">Collector wallet</Label>
        <div className="flex gap-2">
          <Input
            id="wallet"
            value={input}
            placeholder="C… contract address"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!inputError}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleLookup();
              }
            }}
          />
          <Button variant="outline" onClick={handleLookup}>
            Look up
          </Button>
        </div>
        {inputError && (
          <p className="text-sm text-destructive" role="alert">
            {inputError}
          </p>
        )}
      </div>

      {hasWallet && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-xs break-all text-muted-foreground">{lookedUpWallet}</p>
            <WalletStatusPill state={pillState} isFetching={statusQuery.isFetching} />
          </div>

          <AllowlistActions
            canRemove={canRemove}
            pending={mutation.isPending}
            onAdd={() => {
              setActionError(null);
              setDialogAction('add');
            }}
            onRemove={() => {
              setActionError(null);
              setDialogAction('remove');
            }}
          />

          {(actionState === 'pending' || actionState === 'deferred') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActionState(null);
                void statusQuery.refetch();
              }}
            >
              Re-check status
            </Button>
          )}

          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
        </div>
      )}

      {dialogAction && lookedUpWallet && (
        <AllowlistActionDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialogAction(null);
          }}
          action={dialogAction}
          wallet={lookedUpWallet}
          isPending={mutation.isPending}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
