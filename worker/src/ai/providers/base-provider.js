export class BaseAiProvider {
  constructor({ id, name } = {}) {
    this.id = id || "base";
    this.name = name || "Base AI Provider";
  }

  async complete() {
    throw new Error("AI provider is not implemented.");
  }
}
