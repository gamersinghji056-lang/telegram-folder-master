export class BaseAiProvider {
  constructor({ id, name, roles = [] } = {}) {
    this.id = id || "base";
    this.name = name || "Base AI Provider";
    this.roles = roles;
  }

  async complete() {
    throw new Error("AI provider is not implemented.");
  }
}
