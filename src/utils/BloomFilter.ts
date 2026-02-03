/**
 * BloomFilter - A probabilistic data structure for fast duplicate detection.
 *
 * Bloom filters provide a space-efficient way to test whether an element is
 * a member of a set, with a tunable false positive rate. They guarantee:
 * - No false negatives: If mayContain() returns false, the item is definitely not in the set
 * - Possible false positives: If mayContain() returns true, the item might be in the set
 *
 * This implementation is designed for fast duplicate detection during the
 * de-duplication phase of the NEAT evolution loop (Issue #1292).
 *
 * Performance characteristics:
 * - O(k) time for add and mayContain operations, where k is the hash count
 * - O(m) space, where m is the bit array size
 *
 * @example
 * ```ts
 * // Create filter for 1000 items with 1% false positive rate
 * const filter = BloomFilter.create(1000, 0.01);
 *
 * filter.add("creature-uuid-1");
 * filter.add("creature-uuid-2");
 *
 * // Fast check - if false, definitely not in set
 * if (filter.mayContain("creature-uuid-3")) {
 *   // Might be a duplicate, do full check
 * }
 * ```
 */
export class BloomFilter {
  /** The bit array storing the filter state */
  private readonly bits: Uint8Array;

  /** Number of hash functions to use */
  private readonly hashCount: number;

  /** Size of the bit array in bits */
  private readonly bitSize: number;

  /** Number of items added to the filter */
  private itemCount: number = 0;

  /** Text encoder for string hashing */
  private static readonly TE = new TextEncoder();

  /**
   * Creates a new BloomFilter with the specified size and hash count.
   *
   * For optimal performance, use the static `create` method which
   * automatically calculates optimal parameters based on expected
   * items and desired false positive rate.
   *
   * @param size - The size of the bit array in bits (default: 8192)
   * @param hashCount - The number of hash functions to use (default: 7)
   */
  constructor(size: number = 8192, hashCount: number = 7) {
    // Ensure size is at least 8 (1 byte)
    this.bitSize = Math.max(8, size);

    // Ensure hash count is at least 1
    this.hashCount = Math.max(1, hashCount);

    // Allocate byte array (ceiling division to ensure enough bytes)
    this.bits = new Uint8Array(Math.ceil(this.bitSize / 8));
  }

  /**
   * The size of the bit array in bits.
   */
  get size(): number {
    return this.bitSize;
  }

  /**
   * The number of items added to the filter.
   * Note: This is an approximation as items are not tracked individually.
   */
  get count(): number {
    return this.itemCount;
  }

  /**
   * Adds an item to the Bloom filter.
   *
   * After adding, mayContain() will return true for this item.
   * This operation cannot be undone (use counting Bloom filter for removals).
   *
   * @param key - The string key to add
   */
  add(key: string): void {
    const hashes = this.getHashes(key);
    for (const hash of hashes) {
      const bitIndex = hash % this.bitSize;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      this.bits[byteIndex] |= 1 << bitOffset;
    }
    this.itemCount++;
  }

  /**
   * Tests whether an item may be contained in the filter.
   *
   * - Returns `false`: Item is definitely NOT in the set
   * - Returns `true`: Item MAY be in the set (possible false positive)
   *
   * Use this as a fast first-pass check before performing expensive
   * operations like full UUID comparison.
   *
   * @param key - The string key to check
   * @returns true if the item might be in the filter, false if definitely not
   */
  mayContain(key: string): boolean {
    const hashes = this.getHashes(key);
    for (const hash of hashes) {
      const bitIndex = hash % this.bitSize;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      if ((this.bits[byteIndex] & (1 << bitOffset)) === 0) {
        return false; // Definitely not in the set
      }
    }
    return true; // Might be in the set
  }

  /**
   * Clears all items from the filter, resetting it to empty state.
   * This is more efficient than creating a new filter.
   */
  clear(): void {
    this.bits.fill(0);
    this.itemCount = 0;
  }

  /**
   * Generates multiple hash values for a given key using double hashing technique.
   *
   * Uses the formula: hash_i(key) = hash1(key) + i * hash2(key)
   * This is a well-known technique that produces k independent hashes
   * from just two base hashes.
   *
   * @param key - The string to hash
   * @returns Array of hash values
   */
  private getHashes(key: string): number[] {
    const data = BloomFilter.TE.encode(key);

    // Use FNV-1a hash for first hash (good distribution)
    const hash1 = this.fnv1aHash(data);

    // Use DJB2 hash for second hash (different distribution pattern)
    const hash2 = this.djb2Hash(data);

    const hashes: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      // Double hashing formula: h(i) = h1 + i * h2
      // Use unsigned 32-bit to prevent negative numbers
      const combined = (hash1 + i * hash2) >>> 0;
      hashes.push(combined);
    }

    return hashes;
  }

  /**
   * FNV-1a hash function.
   *
   * A simple, fast hash with good distribution properties.
   * Uses 32-bit version for performance.
   *
   * @param data - The byte array to hash
   * @returns 32-bit unsigned hash value
   */
  private fnv1aHash(data: Uint8Array): number {
    const FNV_PRIME = 0x01000193;
    const FNV_OFFSET_BASIS = 0x811c9dc5;

    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = Math.imul(hash, FNV_PRIME);
    }

    return hash >>> 0; // Convert to unsigned 32-bit
  }

  /**
   * DJB2 hash function.
   *
   * Classic hash function with good properties for strings.
   *
   * @param data - The byte array to hash
   * @returns 32-bit unsigned hash value
   */
  private djb2Hash(data: Uint8Array): number {
    let hash = 5381;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) + hash) + data[i]; // hash * 33 + c
    }
    return hash >>> 0; // Convert to unsigned 32-bit
  }

  /**
   * Calculates optimal Bloom filter parameters for a given capacity and false positive rate.
   *
   * Uses the formulas:
   * - Optimal size (m): m = -n * ln(p) / (ln(2)^2)
   * - Optimal hash count (k): k = (m/n) * ln(2)
   *
   * @param expectedItems - Expected number of items to be added
   * @param falsePositiveRate - Desired false positive probability (e.g., 0.01 for 1%)
   * @returns Object containing recommended size and hashCount
   */
  static optimalParameters(
    expectedItems: number,
    falsePositiveRate: number,
  ): { size: number; hashCount: number } {
    // Validate inputs
    const n = Math.max(1, expectedItems);
    const p = Math.max(0.0001, Math.min(0.99, falsePositiveRate));

    // Calculate optimal bit array size: m = -n * ln(p) / (ln(2)^2)
    const size = Math.ceil(-n * Math.log(p) / (Math.LN2 * Math.LN2));

    // Calculate optimal hash count: k = (m/n) * ln(2)
    const hashCount = Math.max(1, Math.round((size / n) * Math.LN2));

    return { size, hashCount };
  }

  /**
   * Creates a BloomFilter with optimal parameters for the expected usage.
   *
   * This is the recommended way to create a BloomFilter when you know
   * approximately how many items will be added and what false positive
   * rate is acceptable.
   *
   * @param expectedItems - Expected number of items to be added
   * @param falsePositiveRate - Desired false positive probability (default: 0.01 for 1%)
   * @returns A new BloomFilter instance with optimal parameters
   *
   * @example
   * ```ts
   * // Create filter for 500 creatures with 1% false positive rate
   * const filter = BloomFilter.create(500, 0.01);
   * ```
   */
  static create(
    expectedItems: number,
    falsePositiveRate: number = 0.01,
  ): BloomFilter {
    const { size, hashCount } = BloomFilter.optimalParameters(
      expectedItems,
      falsePositiveRate,
    );
    return new BloomFilter(size, hashCount);
  }
}
