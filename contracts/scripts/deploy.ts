/**
 * Deploy PythiaMarkets to Fuji.
 *
 *   DEPLOYER_PRIVATE_KEY=0x... RESOLVER_ADDRESS=0x... npx hardhat run scripts/deploy.ts --network fuji
 *
 * Writes contracts/deployments/fuji.json and copies the ABI to resolver/abis and
 * frontend/src/abi. Attempts Snowtrace verification afterwards (non-fatal).
 */
import fs from "node:fs";
import path from "node:path";
import { ethers, network, run, artifacts } from "hardhat";

const root = path.resolve(__dirname, "../..");

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  const resolver = process.env.RESOLVER_ADDRESS;
  if (!resolver || !ethers.isAddress(resolver)) {
    throw new Error("Set RESOLVER_ADDRESS (the resolver service's EOA) in the environment / .env");
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set DEPLOYER_PRIVATE_KEY");
  const net = await ethers.provider.getNetwork();
  console.log("network  :", network.name, net.chainId.toString());
  console.log("deployer :", deployer.address);
  console.log("resolver :", resolver);
  console.log("balance  :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "AVAX");

  const factory = await ethers.getContractFactory("PythiaMarkets");
  const markets = await factory.deploy(deployer.address, resolver);
  const tx = markets.deploymentTransaction()!;
  console.log("deploy tx:", tx.hash);
  await markets.waitForDeployment();
  const address = await markets.getAddress();
  const receipt = await tx.wait();
  console.log("PythiaMarkets:", address);

  const artifact = await artifacts.readArtifact("PythiaMarkets");
  const deployment = {
    network: "fuji",
    chainId: Number(net.chainId),
    contract: "PythiaMarkets",
    address,
    owner: deployer.address,
    resolver,
    deployTx: tx.hash,
    deployBlock: receipt?.blockNumber,
    deployedAt: new Date().toISOString(),
    explorer: `https://testnet.snowtrace.io/address/${address}`,
    chainlinkAvaxUsdFeed: "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD",
  };
  writeJson(path.join(__dirname, "../deployments/fuji.json"), deployment);
  for (const dest of [
    path.join(root, "resolver/abis/PythiaMarkets.abi.json"),
    path.join(root, "frontend/src/abi/PythiaMarkets.abi.json"),
  ]) {
    writeJson(dest, artifact.abi);
    console.log("ABI ->", path.relative(root, dest));
  }
  console.log("deployment ->", "contracts/deployments/fuji.json");

  // Verification (Routescan/Snowtrace). Wait for the explorer to index the contract.
  console.log("verifying on Snowtrace (may take a moment)...");
  await new Promise((r) => setTimeout(r, 20_000));
  try {
    await Promise.race([
      run("verify:verify", { address, constructorArguments: [deployer.address, resolver] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("verify timed out after 120s")), 120_000)),
    ]);
    console.log("verified:", deployment.explorer + "#code");
  } catch (e) {
    const msg = (e as Error).message;
    if (/already verified/i.test(msg)) console.log("already verified");
    else console.error(`VERIFY FAILED: ${msg}\nRetry: npx hardhat verify --network fuji ${address} ${deployer.address} ${resolver}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
