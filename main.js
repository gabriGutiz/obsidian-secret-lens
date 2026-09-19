const { Plugin, Modal, Notice, MarkdownView } = require("obsidian");

const ENV_FILE = ".env";
const SECRET_PATTERN = /\$\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const INLINE_SECRET_PATTERN = /\bsecret\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

module.exports = class SecretParserPlugin extends Plugin {
  secrets = {};

  async onload() {
    await this.loadSecrets();
    this.addStyles();

    this.registerMarkdownCodeBlockProcessor("secret", (source, element) => {
      this.renderSecretBlock(source, element);
    });

    this.registerMarkdownPostProcessor((element) => {
      element.querySelectorAll("code").forEach((code) => {
        if (code.parentElement && code.parentElement.closest("pre")) return;
        INLINE_SECRET_PATTERN.lastIndex = 0;
        if (!INLINE_SECRET_PATTERN.test(code.textContent || "")) return;

        code.addClass("secret-lens-inline");
        code.setText(this.replaceInlineSecrets(code.textContent || ""));
      });
    });

    this.addCommand({
      id: "reload-secrets",
      name: "Reload secrets from .env",
      callback: async () => {
        await this.loadSecrets();
        this.app.workspace.trigger("layout-change");
        new Notice("Secrets reloaded from .env");
      },
    });

    this.addCommand({
      id: "create-secret",
      name: "Create secret",
      callback: () => this.createSecret(),
    });

    this.addCommand({
      id: "insert-existing-secret",
      name: "Insert existing secret",
      callback: () => this.insertExistingSecret(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu) => {
        menu.addItem((item) => {
          item
            .setTitle("Create secret")
            .setIcon("key")
            .onClick(() => this.createSecret());
        });
        menu.addItem((item) => {
          item
            .setTitle("Insert existing secret")
            .setIcon("key-round")
            .onClick(() => this.insertExistingSecret());
        });
      })
    );
  }

  async loadSecrets() {
    try {
      const contents = await this.app.vault.adapter.read(ENV_FILE);
      this.secrets = parseEnv(contents);
    } catch {
      this.secrets = {};
    }
  }

  async createSecret() {
    new SecretModal(this.app, (name, value) => this.saveSecret(name, value)).open();
  }

  insertExistingSecret() {
    const names = Object.keys(this.secrets).sort();
    if (!names.length) {
      new Notice("No secrets found in .env");
      return;
    }

    new ExistingSecretModal(this.app, names, (name, format) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.editor) {
        new Notice("Open a note before inserting a secret");
        return;
      }

      const text =
        format === "multiline"
          ? `\`\`\`secret\n\${{${name}}}\n\`\`\``
          : `\`secret(${name})\``;
      view.editor.replaceSelection(text);
    }).open();
  }

  async saveSecret(name, value) {
    const normalizedName = name.trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(normalizedName)) {
      new Notice("Secret names may only contain letters, numbers, and underscores");
      return;
    }

    if (value.includes("\n") || value.includes("\r")) {
      new Notice("Secret values cannot contain line breaks");
      return;
    }

    let contents = "";
    try {
      contents = await this.app.vault.adapter.read(ENV_FILE);
    } catch {
      // The .env file will be created below when it does not exist.
    }

    const entry = `${normalizedName}=${formatEnvValue(value)}`;
    const existingEntry = new RegExp(
      `^(\\s*(?:export\\s+)?${normalizedName}\\s*=).*$`,
      "m"
    );

    if (existingEntry.test(contents)) {
      contents = contents.replace(existingEntry, entry);
    } else {
      if (contents && !contents.endsWith("\n")) contents += "\n";
      contents += `${entry}\n`;
    }

    await this.app.vault.adapter.write(ENV_FILE, contents);
    await this.loadSecrets();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.editor) {
      view.editor.replaceSelection(
        `\`\`\`secret\n\${{${normalizedName}}}\n\`\`\``
      );
    }
    this.app.workspace.trigger("layout-change");
    new Notice(`Secret ${normalizedName} saved to .env`);
  }

  renderSecretBlock(source, element) {
    const block = element.createDiv({ cls: "secret-lens-block" });
    const header = block.createDiv({ cls: "secret-lens-header" });
    const label = header.createDiv({ cls: "secret-lens-label" });
    label.setText("SECRET");

    const copyButton = header.createEl("button", {
      cls: "secret-lens-copy",
      text: "Copy",
      attr: { type: "button" },
    });
    const value = block.createDiv({ cls: "secret-lens-content" });
    const resolvedValue = this.replaceSecrets(source);
    value.setText(resolvedValue);

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(resolvedValue);
        new Notice("Secret copied");
      } catch {
        new Notice("Could not copy secret");
      }
    });
  }

  replaceSecrets(source) {
    return source.replace(/\$\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (placeholder, name) => {
      return Object.prototype.hasOwnProperty.call(this.secrets, name)
        ? this.secrets[name]
        : placeholder;
    });
  }

  replaceInlineSecrets(source) {
    INLINE_SECRET_PATTERN.lastIndex = 0;
    return source.replace(INLINE_SECRET_PATTERN, (match, name) => {
      return Object.prototype.hasOwnProperty.call(this.secrets, name)
        ? this.secrets[name]
        : match;
    });
  }

  addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .secret-lens-block {
        margin: 1em 0;
        padding: 0.8em 1em;
        border: 1px solid var(--interactive-accent);
        border-left: 4px solid var(--interactive-accent);
        border-radius: 6px;
        background: var(--background-secondary);
      }

      .secret-lens-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1em;
      }

      .secret-lens-label {
        color: var(--text-muted);
        font-size: 0.7em;
        font-weight: 700;
        letter-spacing: 0.12em;
      }

      .secret-lens-copy {
        padding: 0.2em 0.65em;
        color: var(--text-muted);
        font-size: 0.8em;
        cursor: pointer;
      }

      .secret-lens-content {
        margin-top: 0.45em;
        color: var(--text-normal);
        font-family: var(--font-monospace);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .secret-lens-inline {
        padding: 0.1em 0.35em;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        color: var(--text-accent);
        background: var(--background-secondary);
      }

      .secret-lens-modal-input {
        display: block;
        width: 100%;
        margin: 0.6em 0;
      }
    `;
    document.head.appendChild(style);
    this.register(() => style.remove());
  }
};

class SecretModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Create secret" });

    const nameInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Secret name, e.g. API_KEY",
    });
    nameInput.addClass("secret-lens-modal-input");

    const valueInput = contentEl.createEl("input", {
      type: "password",
      placeholder: "Secret value",
    });
    valueInput.addClass("secret-lens-modal-input");

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelButton = buttons.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());

    const saveButton = buttons.createEl("button", {
      text: "Save",
      cls: "mod-cta",
    });
    saveButton.addEventListener("click", () => this.submit(nameInput, valueInput));

    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.submit(nameInput, valueInput);
    });
    valueInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.submit(nameInput, valueInput);
    });

    window.setTimeout(() => nameInput.focus(), 0);
  }

  submit(nameInput, valueInput) {
    if (!nameInput.value.trim()) {
      new Notice("Enter a secret name");
      nameInput.focus();
      return;
    }

    this.close();
    void this.onSubmit(nameInput.value, valueInput.value);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ExistingSecretModal extends Modal {
  constructor(app, names, onSubmit) {
    super(app);
    this.names = names;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Insert existing secret" });

    const select = contentEl.createEl("select");
    select.addClass("secret-lens-modal-input");
    for (const name of this.names) {
      select.createEl("option", { text: name, value: name });
    }

    const format = contentEl.createEl("select");
    format.addClass("secret-lens-modal-input");
    format.createEl("option", { text: "Inline", value: "inline" });
    format.createEl("option", { text: "Multiline", value: "multiline" });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelButton = buttons.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());

    const insertButton = buttons.createEl("button", {
      text: "Insert",
      cls: "mod-cta",
    });
    insertButton.addEventListener("click", () => {
      this.close();
      this.onSubmit(select.value, format.value);
    });

    window.setTimeout(() => select.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

function parseEnv(contents) {
  const values = {};

  for (const line of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/
    );
    if (!match) continue;

    values[match[1]] = unquoteEnvValue(match[2]);
  }

  return values;
}

function unquoteEnvValue(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'")
    ) {
      if (first === '"') {
        try {
          return JSON.parse(value);
        } catch {
          // Fall back to the unquoted value for non-JSON dotenv syntax.
        }
      }
      return value.slice(1, -1);
    }
  }

  return value.replace(/\s+#.*$/, "").trim();
}

function formatEnvValue(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(value)) return value;
  return JSON.stringify(value);
}
