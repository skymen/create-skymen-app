#!/usr/bin/env node

import { createInterface } from "readline";
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { execSync, spawnSync } from "child_process";
import { resolve, basename } from "path";

const TEMPLATE_REPO = "https://github.com/skymen/tauri-vue-template.git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let rl;

function ask(question, defaultValue = "") {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  return new Promise((res) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      res(answer.trim() || defaultValue);
    });
  });
}

function askYN(question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((res) => {
    rl.question(`${question} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") return res(defaultYes);
      res(a === "y" || a === "yes");
    });
  });
}

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function runCapture(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

function commandExists(cmd) {
  return spawnSync("which", [cmd], { encoding: "utf-8" }).status === 0;
}

function copyToClipboard(text) {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync("pbcopy", { input: text });
    } else if (platform === "linux") {
      try {
        execSync("xclip -selection clipboard", { input: text });
      } catch {
        execSync("xsel --clipboard --input", { input: text });
      }
    } else if (platform === "win32") {
      execSync("clip", { input: text });
    }
    return true;
  } catch {
    return false;
  }
}

function openUrl(url) {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${url}"`);
    } else if (platform === "linux") {
      execSync(`xdg-open "${url}"`);
    } else if (platform === "win32") {
      execSync(`start "" "${url}"`);
    }
    return true;
  } catch {
    return false;
  }
}

function abort(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Init steps (run inside the cloned project)
// ---------------------------------------------------------------------------

async function fillConfig(dest) {
  console.log("\n--- Project Configuration ---\n");

  const dirName = basename(dest);

  const name = await ask("Package name (kebab-case)", dirName);
  const productName = await ask("Product name (display name)", name);
  const description = await ask("Description", "A Tauri App");
  const author = await ask("Author");
  const license = await ask("License", "MIT");
  const identifier = await ask(
    "Bundle identifier (reverse-DNS)",
    `com.${author || "example"}.${name}`
  );

  console.log("\n--- GitHub ---\n");
  const ghOwner = await ask("GitHub owner (username or org)", author);
  const ghRepo = await ask("GitHub repo name", name);

  console.log("\n--- Window ---\n");
  const winTitle = await ask("Window title", productName);
  const winWidth = parseInt(await ask("Window width", "800"), 10);
  const winHeight = parseInt(await ask("Window height", "600"), 10);

  const config = {
    name,
    productName,
    version: "0.0.0",
    identifier,
    description,
    author,
    license,
    github: {
      owner: ghOwner,
      repo: ghRepo,
    },
    window: {
      title: winTitle,
      width: winWidth,
      height: winHeight,
    },
    updater: {
      active: false,
      pubkey: "",
    },
    icons: {
      svg: "assets/icon.svg",
      png: "assets/icon.png",
    },
  };

  writeFileSync(
    resolve(dest, "template.config.json"),
    JSON.stringify(config, null, 2) + "\n"
  );
  console.log("\n[ok] template.config.json written.");

  return config;
}

async function generateUpdaterKey(dest, config) {
  const generate = await askYN("\nGenerate Tauri updater keypair?");
  if (!generate) return;

  const keyPath = resolve(dest, ".tauri-updater.key");
  const pubPath = resolve(dest, ".tauri-updater.key.pub");

  if (existsSync(keyPath)) {
    const overwrite = await askYN(
      "Updater key already exists. Overwrite?",
      false
    );
    if (!overwrite) {
      if (existsSync(pubPath)) {
        config.updater.pubkey = readFileSync(pubPath, "utf-8").trim();
        config.updater.active = true;
      }
      return;
    }
  }

  console.log("Generating updater keypair...\n");

  const password = await ask("Private key password (leave empty for none)");

  try {
    // Build command with optional password flag
    let cmd = `npx tauri signer generate -w "${keyPath}" --force --ci`;
    if (password) {
      cmd += ` -p "${password}"`;
    }

    const result = execSync(cmd, {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "inherit"],
    });

    const pubkeyMatch = result.match(/^(dW[A-Za-z0-9+/=]+)$/m);
    if (pubkeyMatch) {
      config.updater.pubkey = pubkeyMatch[1];
      config.updater.active = true;
      writeFileSync(pubPath, pubkeyMatch[1] + "\n");
      console.log(`\n[ok] Private key: ${keyPath}`);
      console.log(`[ok] Public key:  ${pubPath}`);

      const privateKey = readFileSync(keyPath, "utf-8").trim();

      console.log(
        "\nYou need to add the private key as a TAURI_SIGNING_PRIVATE_KEY secret in your GitHub repo."
      );
      console.log("Private key:\n");
      console.log(privateKey);
      console.log();

      if (copyToClipboard(privateKey)) {
        console.log("[ok] Private key copied to clipboard.");
      } else {
        console.log(
          "(Could not copy to clipboard — copy the key above manually.)"
        );
      }

      if (config.github?.owner && config.github?.repo) {
        const secretsUrl = `https://github.com/${config.github.owner}/${config.github.repo}/settings/secrets/actions/new`;
        const openPage = await askYN(
          `\nOpen GitHub secrets page in your browser?`
        );
        if (openPage) {
          if (!openUrl(secretsUrl)) {
            console.log("Could not open browser. Go to:");
            console.log(`  ${secretsUrl}`);
          }
        } else {
          console.log(`\nAdd the secret manually at:\n  ${secretsUrl}`);
        }
        console.log("\nName the secret: TAURI_SIGNING_PRIVATE_KEY");
      } else {
        console.log(
          "\nNo GitHub owner/repo configured — add the secret manually later at:"
        );
        console.log(
          "  https://github.com/<owner>/<repo>/settings/secrets/actions/new"
        );
        console.log("  Name: TAURI_SIGNING_PRIVATE_KEY");
      }
    } else {
      console.log(
        "Could not extract pubkey from output. You can set it manually in template.config.json."
      );
      console.log("Raw output:", result);
    }
  } catch (e) {
    console.error("Failed to generate updater key. You can do it manually:");
    console.error(`  npx tauri signer generate -w "${keyPath}"`);
  }

  // Update config file with pubkey
  writeFileSync(
    resolve(dest, "template.config.json"),
    JSON.stringify(config, null, 2) + "\n"
  );
}

async function initGit(dest) {
  console.log("\nInitializing git repository...");
  run("git init", dest);
  run("git add .", dest);
  run('git commit -m "Initial commit from create-skymen-app"', dest);
  console.log("[ok] Git repository initialized with initial commit.");
}

async function pushToGitHub(dest, config) {
  if (!config.github?.owner || !config.github?.repo) {
    console.log("\nSkipping GitHub push (no owner/repo configured).");
    return;
  }

  const push = await askYN(
    `\nCreate and push to GitHub repo ${config.github.owner}/${config.github.repo}?`
  );
  if (!push) return;

  if (!commandExists("gh")) {
    console.log(
      "GitHub CLI (gh) not found. Install it: https://cli.github.com/"
    );
    console.log("Then run manually:");
    console.log(
      `  gh repo create ${config.github.owner}/${config.github.repo} --private --source=. --push`
    );
    return;
  }

  const visibility = await ask("Visibility (public/private)", "private");

  try {
    run(
      `gh repo create ${config.github.owner}/${config.github.repo} --${visibility} --source=. --push`,
      dest
    );
    console.log(
      `[ok] Pushed to https://github.com/${config.github.owner}/${config.github.repo}`
    );
  } catch (e) {
    console.error("Failed to create/push repo. You can do it manually:");
    console.error(
      `  gh repo create ${config.github.owner}/${config.github.repo} --${visibility} --source=. --push`
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const target = process.argv[2];

  if (!target) {
    console.log("Usage: npm create skymen-app <project-name>");
    console.log("       npx create-skymen-app <project-name>");
    process.exit(0);
  }

  const dest = resolve(process.cwd(), target);

  if (existsSync(dest)) {
    abort(`Directory "${target}" already exists.`);
  }

  console.log(`\nScaffolding into ${target}...\n`);

  // 1. Clone template
  try {
    run(`git clone --depth 1 "${TEMPLATE_REPO}" "${dest}"`);
  } catch {
    abort("Failed to clone template repo. Make sure git is installed.");
  }

  // 2. Remove the template's .git so the user starts fresh
  rmSync(resolve(dest, ".git"), { recursive: true, force: true });

  // 3. Install dependencies
  console.log("\nInstalling dependencies...\n");
  try {
    run("npm install", dest);
  } catch {
    abort("npm install failed.");
  }

  // 4. Interactive setup
  rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n=== Project Setup ===");

  const config = await fillConfig(dest);

  // Apply config to all project files
  console.log("\nApplying configuration to project files...");
  run("node scripts/config.js", dest);

  await generateUpdaterKey(dest, config);

  // Re-apply config in case updater pubkey was added
  if (config.updater?.pubkey) {
    run("node scripts/config.js", dest);
  }

  await initGit(dest);
  await pushToGitHub(dest, config);

  rl.close();

  console.log("\n=== Done! ===");
  console.log("Next steps:\n");
  console.log(`  cd ${target}`);
  console.log("  npm run tauri dev\n");
}

main().catch((err) => {
  console.error(err);
  if (rl) rl.close();
  process.exit(1);
});
