'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { dateTimeFormatter } from '@/lib/date-format';

import { formatPriceBand, formatPublicFloat } from '../offering-display';
import type { OfferingDetail } from '../schemas';

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={mono ? 'font-mono text-sm break-all' : ''}>{value}</p>
    </div>
  );
}

/**
 * Read-only economic payload — the multisig "verify-before-sign" surface (AC2). Display only, NO form
 * controls: the offering is immutable after planning. Money is rendered BigInt-safe at full precision;
 * the raw base-unit strings are shown as auditable subtext.
 */
export function OfferingPayloadPreview({ offering }: { offering: OfferingDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Offering terms</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Price band</p>
            <p className="tabular-nums">
              {formatPriceBand(offering.lowPriceStroops, offering.highPriceStroops)}
            </p>
            <p className="font-mono text-xs text-muted-foreground break-all">
              {offering.lowPriceStroops} – {offering.highPriceStroops} (base units)
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Public float</p>
            <p className="tabular-nums">{formatPublicFloat(offering.publicFloat)}</p>
            <p className="font-mono text-xs text-muted-foreground break-all">
              {offering.publicFloat} (base units)
            </p>
          </div>
          <Field
            label="Subscription window"
            value={`${dateTimeFormatter.format(new Date(offering.windowOpenAt))} → ${dateTimeFormatter.format(
              new Date(offering.windowCloseAt),
            )}`}
          />
          <Field
            label="Attested artist"
            value={offering.attestedArtistAddress ?? 'Not attested'}
            mono={offering.attestedArtistAddress !== null}
          />
        </div>
      </CardContent>
    </Card>
  );
}
