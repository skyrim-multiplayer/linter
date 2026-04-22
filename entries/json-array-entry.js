import { BaseEntry } from "./base-entry.js";

/**
 * Entry representing a single element within a JSON array file.
 * id includes the element index for display; path points to the source file.
 */
export class JsonArrayEntry extends BaseEntry {
  #filePath;
  #index;
  #element;

  constructor(filePath, index, element) {
    super();
    this.#filePath = filePath;
    this.#index = index;
    this.#element = element;
  }

  get id() {
    return `${this.#filePath}[${this.#index}]`;
  }

  get path() {
    return this.#filePath;
  }

  get metadata() {
    return { index: this.#index, element: this.#element };
  }
}
