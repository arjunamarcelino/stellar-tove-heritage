import { createHash } from 'node:crypto';
import {
  StrKey,
  xdr,
  Address,
  Contract,
  nativeToScVal,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Account,
  Operation,
} from '@stellar/stellar-sdk';
import {
  DeployPasskeyWalletInput,
  DeployPasskeyWalletResult,
  BuildTransferInput,
  BuildTransferResult,
  SubmitSignedTransferInput,
  SubmitTransferResult,
  ReadWalletHoldingsInput,
  WalletHolding,
  BuildBidInput,
  BuildBidResult,
  SubmitSignedBidInput,
  SubmitBidResult,
  BuildCancelBidInput,
  BuildCancelBidResult,
  SubmitSignedCancelBidInput,
  SubmitCancelBidResult,
  BuildSellerQuoteAuthInput,
  BuildSellerQuoteAuthResult,
  AttachSellerQuoteAuthInput,
  AttachSellerQuoteAuthResult,
  BuildAcceptQuoteInput,
  BuildAcceptQuoteResult,
  SubmitSignedAcceptQuoteInput,
  AcceptQuoteOutcome,
  IRelayerService,
} from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { computeHostPayloadHash, computeAuthDigest, encodeAuthPayloadScVal } from '@modules/relayer/auth-entry-encoding';
import { verifyPasskeyAuthorization } from '@modules/relayer/passkey-authorization';
import { verifyBidAuthorization } from '@modules/relayer/bid-authorization';
import {
  buildSubmitBidOperation,
  buildSubmitBidRootInvocation,
} from '@modules/relayer/bid-invocation';
import { verifyCancelBidAuthorization } from '@modules/relayer/cancel-authorization';
import {
  buildCancelBidOperation,
  buildCancelBidRootInvocation,
} from '@modules/relayer/cancel-invocation';
import {
  verifyAcceptQuoteAuthorization,
  verifySellerQuoteAuthEntry,
} from '@modules/relayer/accept-authorization';
import {
  buildAcceptQuoteOperation,
  buildBuyerRootInvocation,
  buildSellerRootInvocation,
  type AcceptQuoteArgs,
} from '@modules/relayer/accept-quote-invocation';
import { buildKeyData } from '@modules/relayer/signer-encoding';

const FAKE_SOURCE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const FAKE_EXP_LEDGER = 1_000_000;
// Fake settlement infra addresses (the verifier does not pin treasury/artist — the enforcing re-sim does).
const FAKE_TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const FAKE_ARTIST = StrKey.encodeContract(Buffer.alloc(32, 6));
const FAKE_VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 7));
const FAKE_PASSPHRASE = Networks.TESTNET;

/**
 * In-memory relayer for tests. Deterministic. `buildTransfer` emits a REAL offline Soroban tx (no
 * live simulate) so `submitSignedTransfer` can run the REAL fail-closed verification end-to-end;
 * on a valid assertion it returns a deterministic success instead of touching the chain.
 */
export class FakeRelayerService implements IRelayerService {
  readonly calls: DeployPasskeyWalletInput[] = [];
  readonly buildCalls: BuildTransferInput[] = [];
  readonly submitCalls: SubmitSignedTransferInput[] = [];
  readonly buildBidCalls: BuildBidInput[] = [];
  readonly submitBidCalls: SubmitSignedBidInput[] = [];
  readonly buildCancelBidCalls: BuildCancelBidInput[] = [];
  readonly submitCancelBidCalls: SubmitSignedCancelBidInput[] = [];
  private shouldFail = false;
  private shouldFailBuild = false;
  private shouldFailBidBuild = false;
  private shouldFailBidSubmit = false;
  private shouldExpireBid = false;
  private shouldFailCancelBuild = false;
  private shouldFailCancelSubmit = false;
  private nextBidId = 0;
  // walletContract -> (tokenContract -> scaled balance). Tests seed holdings before calling export.
  private readonly holdings = new Map<string, Map<string, string>>();

  failNext(): void {
    this.shouldFail = true;
  }

  failNextBuild(): void {
    this.shouldFailBuild = true;
  }

  /** Make the next `buildBid` reject (simulation_failed) / the next `submitSignedBid` reject (transfer_failed). */
  failNextBidBuild(): void {
    this.shouldFailBidBuild = true;
  }
  failNextBidSubmit(): void {
    this.shouldFailBidSubmit = true;
  }
  /** Make the next `assertBidNotExpired` reject as expired (the /submit + /cancel challenge-expiry pre-check). */
  expireNextBid(): void {
    this.shouldExpireBid = true;
  }

  /** Make the next `buildCancelBid` reject (simulation_failed) / next `submitSignedCancelBid` reject (transfer_failed). */
  failNextCancelBuild(): void {
    this.shouldFailCancelBuild = true;
  }
  failNextCancelSubmit(): void {
    this.shouldFailCancelSubmit = true;
  }

  assertBidNotExpired(_txXdr: string): Promise<void> {
    void _txXdr;
    if (this.shouldExpireBid) {
      this.shouldExpireBid = false;
      return Promise.reject(new RelayerTransferError('expired'));
    }
    return Promise.resolve();
  }

  /** Seed a wallet's on-chain balance of a token for `readWalletHoldings` (TOV-40 export tests). */
  setHolding(walletContract: string, tokenContract: string, amountScaled: string): void {
    const forWallet = this.holdings.get(walletContract) ?? new Map<string, string>();
    forWallet.set(tokenContract, amountScaled);
    this.holdings.set(walletContract, forWallet);
  }

  readWalletHoldings(input: ReadWalletHoldingsInput): Promise<WalletHolding[]> {
    const forWallet = this.holdings.get(input.walletContract) ?? new Map<string, string>();
    return Promise.resolve(
      input.tokenContracts.map((tokenContract) => ({
        tokenContract,
        amountScaled: forWallet.get(tokenContract) ?? '0',
      })),
    );
  }

  deployPasskeyWallet(input: DeployPasskeyWalletInput): Promise<DeployPasskeyWalletResult> {
    this.calls.push(input);
    if (this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new Error('fake relayer deploy failure'));
    }
    const digest = createHash('sha256').update(input.credentialId).digest(); // 32 bytes
    return Promise.resolve({
      contractAddress: StrKey.encodeContract(digest),
      txHash: createHash('sha256').update(`tx:${input.credentialId}`).digest('hex'),
    });
  }

  buildTransfer(input: BuildTransferInput): Promise<BuildTransferResult> {
    this.buildCalls.push(input);
    if (this.shouldFailBuild) {
      this.shouldFailBuild = false;
      return Promise.reject(new RelayerTransferError('simulation_failed'));
    }

    // Deterministic nonce from the request (a real build gets one from simulation).
    const nonceHex = createHash('sha256')
      .update(`${input.walletContract}:${input.to}:${input.amountScaled}`)
      .digest('hex')
      .slice(0, 15);
    const nonce = xdr.Int64.fromString(BigInt(`0x${nonceHex}`).toString());

    const hostFunction = new Contract(input.tokenContract)
      .call(
        'transfer',
        Address.fromString(input.walletContract).toScVal(),
        Address.fromString(input.to).toScVal(),
        nativeToScVal(BigInt(input.amountScaled), { type: 'i128' }),
      )
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const rootInvocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        hostFunction.invokeContract(),
      ),
      subInvocations: [],
    });
    const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(input.walletContract).toScAddress(),
        nonce,
        signatureExpirationLedger: FAKE_EXP_LEDGER,
        signature: xdr.ScVal.scvVoid(),
      }),
    );
    const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
    const op = Operation.invokeHostFunction({ func: hostFunction, auth: [entry] });
    const tx = new TransactionBuilder(new Account(FAKE_SOURCE, '1'), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const hostPayload = computeHostPayloadHash(Networks.TESTNET, nonce, FAKE_EXP_LEDGER, rootInvocation);
    const challenge = computeAuthDigest(hostPayload, [0]).toString('base64url');
    return Promise.resolve({ txXdr: tx.toXDR(), challenge, expiresAtLedger: FAKE_EXP_LEDGER });
  }

  submitSignedTransfer(input: SubmitSignedTransferInput): Promise<SubmitTransferResult> {
    this.submitCalls.push(input);
    // Run the REAL fail-closed verification (throws RelayerTransferError on any failure).
    try {
      verifyPasskeyAuthorization({
        txXdr: input.txXdr,
        networkPassphrase: Networks.TESTNET,
        walletContract: input.walletContract,
        tokenContract: input.tokenContract,
        contextRuleIds: [0],
        boundPublicKey: input.boundPublicKey,
        authenticatorData: input.authenticatorData,
        clientDataJSON: input.clientDataJSON,
        signatureDer: input.signature,
        rpId: input.rpId,
        allowedOrigins: input.allowedOrigins,
        maxTransferAmount: input.maxTransferAmount,
        expectedTo: input.expectedTo,
        expectedAmountScaled: input.expectedAmountScaled,
      });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('fake submit failed'));
    }
    // Simulate the on-chain drain: a confirmed transfer zeroes that holding, so a subsequent
    // readWalletHoldings reflects reality (the export live-balance-zero gate depends on this).
    this.holdings.get(input.walletContract)?.set(input.tokenContract, '0');
    return Promise.resolve({
      txHash: createHash('sha256').update(input.txXdr).digest('hex'),
      ledger: 1001,
      status: 'SUCCESS',
    });
  }

  buildBid(input: BuildBidInput): Promise<BuildBidResult> {
    this.buildBidCalls.push(input);
    if (this.shouldFailBidBuild) {
      this.shouldFailBidBuild = false;
      return Promise.reject(new RelayerTransferError('simulation_failed'));
    }
    const price = BigInt(input.priceScaled);
    const count = BigInt(input.count);

    const nonceHex = createHash('sha256')
      .update(`${input.walletContract}:${input.escrowContract}:${input.priceScaled}:${input.count}`)
      .digest('hex')
      .slice(0, 15);
    const nonce = xdr.Int64.fromString(BigInt(`0x${nonceHex}`).toString());

    // The nested submit_bid auth tree (root + inner usdc.transfer) — the real adapter takes this from
    // simulation; the fake builds it so `verifyBidAuthorization` can run end-to-end offline.
    const rootInvocation = buildSubmitBidRootInvocation({
      escrowContract: input.escrowContract,
      tokenContract: input.tokenContract,
      bidder: input.walletContract,
      price,
      count,
      idempotencyKey: input.idempotencyKey,
    });
    const hostFunction = buildSubmitBidOperation(input.escrowContract, {
      bidder: input.walletContract,
      price,
      count,
      idempotencyKey: input.idempotencyKey,
    })
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(input.walletContract).toScAddress(),
        nonce,
        signatureExpirationLedger: FAKE_EXP_LEDGER,
        signature: xdr.ScVal.scvVoid(),
      }),
    );
    const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
    const op = Operation.invokeHostFunction({ func: hostFunction, auth: [entry] });
    const tx = new TransactionBuilder(new Account(FAKE_SOURCE, '1'), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const hostPayload = computeHostPayloadHash(Networks.TESTNET, nonce, FAKE_EXP_LEDGER, rootInvocation);
    const challenge = computeAuthDigest(hostPayload, [0]).toString('base64url');
    return Promise.resolve({ txXdr: tx.toXDR(), challenge, expiresAtLedger: FAKE_EXP_LEDGER });
  }

  submitSignedBid(input: SubmitSignedBidInput): Promise<SubmitBidResult> {
    this.submitBidCalls.push(input);
    if (this.shouldFailBidSubmit) {
      this.shouldFailBidSubmit = false;
      return Promise.reject(new RelayerTransferError('transfer_failed'));
    }
    // Run the REAL fail-closed verification (throws RelayerTransferError on any failure).
    try {
      verifyBidAuthorization({
        txXdr: input.txXdr,
        networkPassphrase: Networks.TESTNET,
        walletContract: input.walletContract,
        escrowContract: input.escrowContract,
        tokenContract: input.tokenContract,
        contextRuleIds: [0],
        boundPublicKey: input.boundPublicKey,
        authenticatorData: input.authenticatorData,
        clientDataJSON: input.clientDataJSON,
        signatureDer: input.signature,
        rpId: input.rpId,
        allowedOrigins: input.allowedOrigins,
        expectedPriceScaled: input.priceScaled,
        expectedCount: input.count,
        maxCostScaled: input.maxCostScaled,
        expectedIdemKey: input.idempotencyKey,
      });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('fake bid submit failed'));
    }
    this.nextBidId += 1;
    return Promise.resolve({
      txHash: createHash('sha256').update(input.txXdr).digest('hex'),
      ledger: 1001,
      status: 'SUCCESS',
      bidId: this.nextBidId,
    });
  }

  buildCancelBid(input: BuildCancelBidInput): Promise<BuildCancelBidResult> {
    this.buildCancelBidCalls.push(input);
    if (this.shouldFailCancelBuild) {
      this.shouldFailCancelBuild = false;
      return Promise.reject(new RelayerTransferError('simulation_failed'));
    }

    const nonceHex = createHash('sha256')
      .update(`${input.caller}:${input.escrowContract}:${input.bidId}`)
      .digest('hex')
      .slice(0, 15);
    const nonce = xdr.Int64.fromString(BigInt(`0x${nonceHex}`).toString());

    // Root-only cancel_bid auth tree (no sub-invocation) — the real adapter takes this from simulation;
    // the fake builds it so `verifyCancelBidAuthorization` can run end-to-end offline.
    const rootInvocation = buildCancelBidRootInvocation({
      escrowContract: input.escrowContract,
      caller: input.caller,
      bidId: input.bidId,
    });
    const hostFunction = buildCancelBidOperation(input.escrowContract, {
      caller: input.caller,
      bidId: input.bidId,
    })
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(input.caller).toScAddress(),
        nonce,
        signatureExpirationLedger: FAKE_EXP_LEDGER,
        signature: xdr.ScVal.scvVoid(),
      }),
    );
    const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
    const op = Operation.invokeHostFunction({ func: hostFunction, auth: [entry] });
    const tx = new TransactionBuilder(new Account(FAKE_SOURCE, '1'), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const hostPayload = computeHostPayloadHash(Networks.TESTNET, nonce, FAKE_EXP_LEDGER, rootInvocation);
    const challenge = computeAuthDigest(hostPayload, [0]).toString('base64url');
    return Promise.resolve({ txXdr: tx.toXDR(), challenge, expiresAtLedger: FAKE_EXP_LEDGER });
  }

  submitSignedCancelBid(input: SubmitSignedCancelBidInput): Promise<SubmitCancelBidResult> {
    this.submitCancelBidCalls.push(input);
    if (this.shouldFailCancelSubmit) {
      this.shouldFailCancelSubmit = false;
      return Promise.reject(new RelayerTransferError('transfer_failed'));
    }
    // Run the REAL fail-closed verification (throws RelayerTransferError on any failure).
    try {
      verifyCancelBidAuthorization({
        txXdr: input.txXdr,
        networkPassphrase: Networks.TESTNET,
        expectedCaller: input.caller,
        escrowContract: input.escrowContract,
        contextRuleIds: [0],
        boundPublicKey: input.boundPublicKey,
        authenticatorData: input.authenticatorData,
        clientDataJSON: input.clientDataJSON,
        signatureDer: input.signature,
        rpId: input.rpId,
        allowedOrigins: input.allowedOrigins,
        expectedBidId: input.chainBidId,
      });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('fake cancel submit failed'));
    }
    return Promise.resolve({
      txHash: createHash('sha256').update(input.txXdr).digest('hex'),
      ledger: 1001,
      status: 'SUCCESS',
    });
  }

  // ── TOV-177: two-signature accept_quote ─────────────────────────────────────────────────────────────
  private shouldFailAcceptSubmit = false;
  private acceptRevertCode: number | null = null;

  /** Make the next `submitSignedAcceptQuote` return RELAYER_FAILED / a REVERTED{code} (seller-balance = 100). */
  failNextAcceptSubmit(): void {
    this.shouldFailAcceptSubmit = true;
  }
  revertNextAcceptSettle(contractCode: number): void {
    this.acceptRevertCode = contractCode;
  }

  private acceptArgs(t: {
    buyerWallet: string; sellerWallet: string; rfqId: Uint8Array; quoteId: Uint8Array; artworkId: Uint8Array; count: string; gross: string;
  }): AcceptQuoteArgs {
    return {
      rfqId: t.rfqId, quoteId: t.quoteId, artworkId: t.artworkId,
      buyer: t.buyerWallet, seller: t.sellerWallet, count: BigInt(t.count), gross: BigInt(t.gross),
    };
  }

  private addrEntry(wallet: string, root: xdr.SorobanAuthorizedInvocation, nonceSeed: string): xdr.SorobanAuthorizationEntry {
    const nonceHex = createHash('sha256').update(nonceSeed).digest('hex').slice(0, 15);
    const nonce = xdr.Int64.fromString(BigInt(`0x${nonceHex}`).toString());
    const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(wallet).toScAddress(),
        nonce,
        signatureExpirationLedger: FAKE_EXP_LEDGER,
        signature: xdr.ScVal.scvVoid(),
      }),
    );
    return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: root });
  }

  private challengeFor(entry: xdr.SorobanAuthorizationEntry): string {
    const creds = entry.credentials().address();
    const hp = computeHostPayloadHash(FAKE_PASSPHRASE, creds.nonce(), FAKE_EXP_LEDGER, entry.rootInvocation());
    return computeAuthDigest(hp, [0]).toString('base64url');
  }

  buildSellerQuoteAuth(input: BuildSellerQuoteAuthInput): Promise<BuildSellerQuoteAuthResult> {
    const root = buildSellerRootInvocation(input.settlerContract, this.acceptArgs(input));
    const entry = this.addrEntry(input.sellerWallet, root, `seller:${input.sellerWallet}:${input.count}:${input.gross}`);
    return Promise.resolve({ challenge: this.challengeFor(entry), expiresAtLedger: FAKE_EXP_LEDGER, sellerAuthEntryXdr: entry.toXDR('base64') });
  }

  attachSellerQuoteAuth(input: AttachSellerQuoteAuthInput): Promise<AttachSellerQuoteAuthResult> {
    let verified;
    try {
      verified = verifySellerQuoteAuthEntry({
        sellerAuthEntryXdr: input.sellerAuthEntryXdr, networkPassphrase: FAKE_PASSPHRASE,
        settlerContract: input.settlerContract, sellerWallet: input.sellerWallet,
        rfqId: input.rfqId, quoteId: input.quoteId, artworkId: input.artworkId, expectedCount: input.count, expectedGross: input.gross,
        contextRuleIds: [0], boundPublicKey: input.boundPublicKey,
        authenticatorData: input.authenticatorData, clientDataJSON: input.clientDataJSON, signatureDer: input.signature,
        rpId: input.rpId, allowedOrigins: input.allowedOrigins,
      });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('fake attach failed'));
    }
    const authPayload = encodeAuthPayloadScVal({
      verifierAddress: FAKE_VERIFIER, keyData: buildKeyData(input.boundPublicKey, input.credentialId),
      signature: verified.signatureCompact, authenticatorData: input.authenticatorData, clientDataJSON: input.clientDataJSON, contextRuleIds: [0],
    });
    verified.entry.credentials().address().signature(authPayload);
    return Promise.resolve({ signedEntryXdr: verified.entry.toXDR('base64'), expiresAtLedger: verified.signatureExpirationLedger });
  }

  buildAcceptQuote(input: BuildAcceptQuoteInput): Promise<BuildAcceptQuoteResult> {
    const root = buildBuyerRootInvocation({
      settlerContract: input.settlerContract, usdcContract: input.usdcContract, treasury: FAKE_TREASURY, artistPayout: FAKE_ARTIST, args: this.acceptArgs(input),
    });
    const entry = this.addrEntry(input.buyerWallet, root, `buyer:${input.buyerWallet}:${input.count}:${input.gross}`);
    return Promise.resolve({ challenge: this.challengeFor(entry), expiresAtLedger: FAKE_EXP_LEDGER, buyerAuthEntryXdr: entry.toXDR('base64') });
  }

  assertAcceptQuoteNotExpired(_buyerAuthEntryXdr: string): Promise<void> {
    void _buyerAuthEntryXdr;
    return Promise.resolve();
  }

  submitSignedAcceptQuote(input: SubmitSignedAcceptQuoteInput): Promise<AcceptQuoteOutcome> {
    if (this.acceptRevertCode !== null) {
      const code = this.acceptRevertCode;
      this.acceptRevertCode = null;
      return Promise.resolve({ status: 'REVERTED', contractCode: code });
    }
    if (this.shouldFailAcceptSubmit) {
      this.shouldFailAcceptSubmit = false;
      return Promise.resolve({ status: 'RELAYER_FAILED', reason: 'transfer_failed' });
    }
    // Assemble the full two-entry tx offline and run the REAL fail-closed two-entry verifier.
    const buyerEntry = xdr.SorobanAuthorizationEntry.fromXDR(input.buyerAuthEntryXdr, 'base64');
    const sellerEntry = xdr.SorobanAuthorizationEntry.fromXDR(input.storedSellerEntryXdr, 'base64');
    const op = buildAcceptQuoteOperation(input.settlerContract, this.acceptArgs(input));
    const builtOp = Operation.invokeHostFunction({ func: op.body().invokeHostFunctionOp().hostFunction(), auth: [buyerEntry, sellerEntry] });
    const tx = new TransactionBuilder(new Account(FAKE_SOURCE, '1'), { fee: BASE_FEE, networkPassphrase: FAKE_PASSPHRASE })
      .addOperation(builtOp).setTimeout(30).build();
    try {
      verifyAcceptQuoteAuthorization({
        txXdr: tx.toXDR(), networkPassphrase: FAKE_PASSPHRASE,
        settlerContract: input.settlerContract, usdcContract: input.usdcContract, buyerWallet: input.buyerWallet, sellerWallet: input.sellerWallet,
        rfqId: input.rfqId, quoteId: input.quoteId, artworkId: input.artworkId, expectedCount: input.count, expectedGross: input.gross,
        contextRuleIds: [0], boundPublicKey: input.boundPublicKey,
        authenticatorData: input.authenticatorData, clientDataJSON: input.clientDataJSON, signatureDer: input.signature,
        rpId: input.rpId, allowedOrigins: input.allowedOrigins,
      });
    } catch (err) {
      if (err instanceof RelayerTransferError) return Promise.resolve({ status: 'RELAYER_FAILED', reason: err.reason });
      throw err;
    }
    return Promise.resolve({ status: 'SUCCESS', txHash: createHash('sha256').update(tx.toXDR()).digest('hex'), ledger: 1001 });
  }
}
