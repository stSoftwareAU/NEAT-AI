/** Keeps a shared native handle open until its asynchronous users have finished. */
export class DiscoveryLibraryLifetime {
  private active = 0;
  private closeRequested = false;

  constructor(private readonly closeHandle: () => void) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
      if (this.active === 0 && this.closeRequested) {
        this.closeRequested = false;
        this.closeHandle();
      }
    }
  }

  close(): void {
    if (this.active > 0) {
      this.closeRequested = true;
    } else {
      this.closeHandle();
    }
  }
}
