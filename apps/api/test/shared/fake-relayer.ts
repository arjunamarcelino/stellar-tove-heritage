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
  IRelayerService,
} from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { computeHostPayloadHash, computeAuthDigest } from '@modules/relayer/auth-entry-encoding';
import { verifyPasskeyAuthorization } from '@modules/relayer/passkey-authorization';

const FAKE_SOURCE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const FAKE_EXP_LEDGER = 1_000_000;

/**
 * In-memory relayer for tests. Deterministic. `buildTransfer` emits a REAL offline Soroban tx (no
 * live simulate) so `submitSignedTransfer` can run the REAL fail-closed verification end-to-end;
 * on a valid assertion it returns a deterministic success instead of touching the chain.
 */
export class FakeRelayerService implements IRelayerService {
  readonly calls: DeployPasskeyWalletInput[] = [];
  readonly buildCalls: BuildTransferInput[] = [];
  readonly submitCalls: SubmitSignedTransferInput[] = [];
  private shouldFail = false;
  private shouldFailBuild = false;
  // walletContract -> (tokenContract -> scaled balance). Tests seed holdings before calling export.
  private readonly holdings = new Map<string, Map<string, string>>();

  failNext(): void {
    this.shouldFail = true;
  }

  failNextBuild(): void {
    this.shouldFailBuild = true;
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
}
