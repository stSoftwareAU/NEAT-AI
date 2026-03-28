let rngTestQueue: Promise<void> = Promise.resolve();

export async function withRngTestLock<T>(
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = rngTestQueue;
  let release!: () => void;
  rngTestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
