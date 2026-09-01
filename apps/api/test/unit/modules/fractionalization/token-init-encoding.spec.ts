import { describe, it, expect } from 'vitest';
import {
  encodeTokenInitScVal,
  TokenInitFields,
} from '../../../../src/modules/fractionalization/token-init';

// Fixed inputs → a pinned golden XDR. This is the ONLY CI check on the on-chain TokenInit encoding
// (the suites otherwise run against a fake factory), so it guards the class of bug where struct keys
// regress to scvString and every real deploy would revert. Regenerate ONLY with a reviewed encoding change.
const FIELDS: TokenInitFields = {
  artworkSalt: Buffer.alloc(32, 7),
  name: 'Northern Lights',
  symbol: 'NLIGHT',
  proxyAdmin: 'GCFJFGJDJMMCJFHIL7HDG3VGVTD6NCMNRWFMX6M3PA7YDRHFGF6E3LR5',
  artist: 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
  artistPayout: 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
  treasury: 'GCFJFGJDJMMCJFHIL7HDG3VGVTD6NCMNRWFMX6M3PA7YDRHFGF6E3LR5',
  artistRetention: 100000n,
  artistLockupUntil: 1790000000n,
  treasuryRetention: 50000n,
  treasuryLockupUntil: 1795000000n,
  kycAllowlist: 'CCNR6WXKK42KPM2ACH5M3GET3BMIJNUEEWJYEBQKEHLDI27YT5ZLNHCP',
  freezeSet: 'CAQEMD5FG23AGYK5HGIUW37ZNOD4MFQJ6X27IP6NVCE7R4QZEXRX47UZ',
  marketplaceSettler: 'CDW5RGVHGHC3LDH3XT5Z6KK2OIOVMAH7UALCTKGXWPC5COHD732J3UTR',
  minter: 'GCFJFGJDJMMCJFHIL7HDG3VGVTD6NCMNRWFMX6M3PA7YDRHFGF6E3LR5',
  usdc: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  implWasmHash: Buffer.from('7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd', 'hex'),
};

const GOLDEN_XDR =
  'AAAAEQAAAAEAAAARAAAADwAAAAZhcnRpc3QAAAAAABIAAAAAAAAAANNafHEY1cHXKSBnbTqicvITgKZlQpb8NfTaWlb9Qe0cAAAADwAAABNhcnRpc3RfbG9ja3VwX3VudGlsAAAAAAUAAAAAarE7gAAAAA8AAAANYXJ0aXN0X3BheW91dAAAAAAAABIAAAAAAAAAANNafHEY1cHXKSBnbTqicvITgKZlQpb8NfTaWlb9Qe0cAAAADwAAABBhcnRpc3RfcmV0ZW50aW9uAAAACgAAAAAAAAAAAAAAAAABhqAAAAAPAAAACmFydHdvcmtfaWQAAAAAAA0AAAAgBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcAAAAPAAAACmZyZWV6ZV9zZXQAAAAAABIAAAABIEYPpTa2A2FdOZFLb/lrh8YWCfX19D/NqIn48hkl434AAAAPAAAADmltcGxfd2FzbV9oYXNoAAAAAAANAAAAIHrYwI1uTXLa+6IcGye4kI6XTXJaRqo1RJEYWubyaUfNAAAADwAAAA1reWNfYWxsb3dsaXN0AAAAAAAAEgAAAAGbH1rqVzSns0AR+s2Yk9hYhLaEJZOCBgoh1jRr+J9ytgAAAA8AAAATbWFya2V0cGxhY2Vfc2V0dGxlcgAAAAASAAAAAe3YmqcxxbWM+7z7nylach1WAP+gFimo17PF0Tjj/vSdAAAADwAAAAZtaW50ZXIAAAAAABIAAAAAAAAAAIqSmSNLGCSU6F/OM26mrMfmiY2Nisv5m3g/gcTlMXxNAAAADwAAAARuYW1lAAAADgAAAA9Ob3J0aGVybiBMaWdodHMAAAAADwAAAAtwcm94eV9hZG1pbgAAAAASAAAAAAAAAACKkpkjSxgklOhfzjNupqzH5omNjYrL+Zt4P4HE5TF8TQAAAA8AAAAGc3ltYm9sAAAAAAAOAAAABk5MSUdIVAAAAAAADwAAAAh0cmVhc3VyeQAAABIAAAAAAAAAAIqSmSNLGCSU6F/OM26mrMfmiY2Nisv5m3g/gcTlMXxNAAAADwAAABV0cmVhc3VyeV9sb2NrdXBfdW50aWwAAAAAAAAFAAAAAGr9hsAAAAAPAAAAEnRyZWFzdXJ5X3JldGVudGlvbgAAAAAACgAAAAAAAAAAAAAAAAAAw1AAAAAPAAAABHVzZGMAAAASAAAAAVBFzV7Acpp2j9WtAlBYUt9PAo3Ogw5axSIJukhIOy8B';

describe('encodeTokenInitScVal (golden vector — Soroban TokenInit struct)', () => {
  const scv = encodeTokenInitScVal(FIELDS);

  it('encodes all 17 fields with scvSymbol keys (never scvString)', () => {
    const map = scv.map();
    expect(map).toHaveLength(17);
    const keyTypes = new Set((map ?? []).map((e) => e.key().switch().name));
    expect([...keyTypes]).toEqual(['scvSymbol']);
  });

  it('matches the pinned golden XDR (regression guard on the on-chain encoding)', () => {
    expect(scv.toXDR('base64')).toBe(GOLDEN_XDR);
  });
});
