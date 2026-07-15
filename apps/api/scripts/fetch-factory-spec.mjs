// One-off: pull the FractionWalletFactory contract interface from testnet.
// Reads the deployed contract's embedded spec (SEP-48) via @stellar/stellar-sdk.
import pkg from '@stellar/stellar-sdk';
const { contract, Networks } = pkg;

const CONTRACT_ID = process.argv[2] ?? 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC';
const RPC = 'https://soroban-testnet.stellar.org';

const client = await contract.Client.from({
  contractId: CONTRACT_ID,
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RPC,
});

const spec = client.spec;

console.log('=== FUNCTIONS ===');
const typeName = (t) => {
  try {
    const s = t.switch().name.replace('scSpecType', '');
    if (s === 'Udt') return t.udt().name().toString();
    if (s === 'BytesN') return `BytesN<${t.bytesN().n()}>`;
    if (s === 'Vec') return `Vec<${typeName(t.vec().elementType())}>`;
    if (s === 'Map') return `Map<${typeName(t.map().keyType())}, ${typeName(t.map().valueType())}>`;
    if (s === 'Option') return `Option<${typeName(t.option().valueType())}>`;
    if (s === 'Result') return `Result<${typeName(t.result().okType())}>`;
    return s;
  } catch {
    return '?';
  }
};
for (const fn of spec.funcs()) {
  const name = fn.name().toString();
  const inputs = fn
    .inputs()
    .map((i) => `${i.name().toString()}: ${typeName(i.type())}`)
    .join(', ');
  const outputs = fn.outputs().map(typeName).join(', ') || 'void';
  console.log(`- ${name}(${inputs}) -> ${outputs}`);
}

console.log('\n=== JSON SCHEMA (types incl. Signer + deploy_wallet) ===');
try {
  console.log(JSON.stringify(spec.jsonSchema(), null, 2));
} catch (e) {
  console.log('jsonSchema() unavailable:', String(e));
  console.log('\n=== RAW SPEC ENTRY NAMES ===');
  for (const entry of spec.entries) {
    console.log(entry.switch().name, '-', JSON.stringify(entry.value?.().name?.().toString?.() ?? ''));
  }
}
