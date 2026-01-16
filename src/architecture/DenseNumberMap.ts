/**
 * A Map-like data structure optimised for dense integer keys mapping to numbers.
 *
 * Uses a Float64Array for storage with a separate Uint8Array to track which
 * indices have been set. This provides better cache locality and reduced
 * memory overhead compared to Map<number, number> for dense indices.
 *
 * Issue #1041: Use TypedArray for dense neuron state storage.
 */
export class DenseNumberMap {
  private values: Float64Array;
  private presence: Uint8Array;
  private capacity: number;

  /**
   * Creates a new DenseNumberMap with the specified initial capacity.
   * @param initialCapacity Initial size of the backing arrays
   */
  constructor(initialCapacity: number = 16) {
    this.capacity = Math.max(1, initialCapacity);
    this.values = new Float64Array(this.capacity);
    this.presence = new Uint8Array(this.capacity);
  }

  /**
   * Sets the value at the specified index.
   * @param index The integer index (must be >= 0)
   * @param value The number value to store
   * @returns this (for chaining)
   */
  set(index: number, value: number): this {
    if (index >= this.capacity) {
      this.grow(index + 1);
    }
    this.values[index] = value;
    this.presence[index] = 1;
    return this;
  }

  /**
   * Gets the value at the specified index.
   * @param index The integer index
   * @returns The value at the index, or undefined if not set
   */
  get(index: number): number | undefined {
    if (index >= this.capacity || this.presence[index] === 0) {
      return undefined;
    }
    return this.values[index];
  }

  /**
   * Checks if a value has been set at the specified index.
   * @param index The integer index
   * @returns true if a value exists at the index
   */
  has(index: number): boolean {
    return index < this.capacity && this.presence[index] === 1;
  }

  /**
   * Clears all values from the map.
   */
  clear(): void {
    this.presence.fill(0);
  }

  /**
   * Grows the backing arrays to accommodate larger indices.
   * @param newCapacity Minimum required capacity
   */
  private grow(newCapacity: number): void {
    // Double the capacity or use newCapacity, whichever is larger
    const targetCapacity = Math.max(this.capacity * 2, newCapacity);
    const newValues = new Float64Array(targetCapacity);
    const newPresence = new Uint8Array(targetCapacity);

    // Copy existing data
    newValues.set(this.values);
    newPresence.set(this.presence);

    this.values = newValues;
    this.presence = newPresence;
    this.capacity = targetCapacity;
  }
}
